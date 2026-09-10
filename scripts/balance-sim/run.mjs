#!/usr/bin/env node
// 밸런스 시뮬 러너 — TS 모델을 esbuild 로 번들해서 그대로 실행한다.
// (게임 코드의 순수 함수를 import 하므로 TS 를 통과시켜야 한다. Phaser 는 스텁으로 대체.)
//
//   node scripts/balance-sim/run.mjs            요약 + CSV
//   node scripts/balance-sim/run.mjs --gate     임계 위반 시 exit 1
//   node scripts/balance-sim/run.mjs --json     기계 판독 출력

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// esbuild 로딩: 기본은 리포의 devDependency.
// ESBUILD_MODULE 환경변수로 다른 위치의 esbuild(예: 리눅스 샌드박스에 따로 설치한 것)를 쓸 수 있다.
async function loadEsbuild() {
	const override = process.env.ESBUILD_MODULE;
	const mod = override ? await import(pathToFileURL(override).href) : await import('esbuild');
	const api = mod.build ? mod : (mod.default ?? mod);
	if (typeof api.build !== 'function') {
		throw new Error('esbuild 를 찾지 못했습니다 — npm install 후 다시 실행하세요.');
	}
	return api;
}

const { build } = await loadEsbuild();

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const outFile = join(here, '.build', 'main.mjs');

// Phaser 스텁: 순수 로직 모듈이 끌고 오는 ui/theme 가 Phaser 를 import 하지만,
// 시뮬 경로에서는 실제로 호출되지 않는다. 무엇을 만져도 죽지 않는 프록시로 대체.
const phaserStub = {
	name: 'phaser-stub',
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'stub' }));
		pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: `
const handler = {
	get: (target, prop) => {
		if (prop === 'default') return proxy;
		if (prop === Symbol.toPrimitive) return () => 0;
		if (!(prop in target)) target[prop] = new Proxy(function () {}, handler);
		return target[prop];
	},
	apply: () => 0,
	construct: () => new Proxy(function () {}, handler),
};
const proxy = new Proxy(function () {}, handler);
export default proxy;
export const Math = proxy;
`,
			loader: 'js',
		}));
	},
};

await build({
	entryPoints: [join(here, 'entry.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node18',
	outfile: outFile,
	plugins: [phaserStub],
	logLevel: 'warning',
	absWorkingDir: repoRoot,
});

const module = await import(pathToFileURL(outFile).href);
const exitCode = module.run(process.argv.slice(2), (relPath, text) => {
	const full = resolve(repoRoot, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, text, 'utf8');
});

rmSync(join(here, '.build'), { recursive: true, force: true });
process.exit(exitCode);
