// 적/장식 스프라이트시트를 텍스처 아틀라스 한 장으로 묶는다.
//
// 왜: 적 유닛 텍스처가 26장으로 흩어져 있어서, 화면에 여러 종류가 섞이면 WebGL이
// 스프라이트마다 텍스처를 갈아끼우며 배치를 flush한다 (draw call 폭증). 한 장으로
// 합치면 적 150마리가 draw call 1~2개로 끝난다. 뱀파이어 서바이벌류의 1번 최적화.
//
// 방침:
// - 프레임을 **트리밍하지 않는다**. 원본 격자 프레임을 그대로 옮겨 담아야
//   원점·히트박스·표시 크기가 한 픽셀도 안 바뀐다 (게임 감각 보존).
// - 프레임 이름은 `${textureKey}/${index}` — 기존 프레임 번호와 1:1 대응이라
//   애니메이션 정의는 generateFrameNumbers → generateFrameNames 치환만 하면 된다.
//
// Run: node scripts/build-atlas.mjs
// Out: public/atlas/enemies.png + enemies.json, public/atlas/deco.png + deco.json

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const outDir = path.join(pub, 'atlas');
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// 1) 적: 카탈로그가 실제로 참조하는 시트만 모은다 (미사용 png는 넣지 않는다)
// ---------------------------------------------------------------------------
const enemyCatalog = JSON.parse(readFileSync(path.join(root, 'src/data/enemyCatalog.json'), 'utf8'));
const enemySheets = new Map(); // textureKey -> { filePath, frameWidth, frameHeight }

for (const enemy of enemyCatalog) {
	const sheets = enemy.spriteType === 'aseprite'
		? (enemy.spritesheet ? [enemy.spritesheet] : [])
		: Object.values(enemy.spritesheets ?? {});
	for (const sheet of sheets) {
		if (!sheet?.textureKey || enemySheets.has(sheet.textureKey)) continue;
		enemySheets.set(sheet.textureKey, {
			filePath: sheet.filePath,
			frameWidth: sheet.frameWidth,
			frameHeight: sheet.frameHeight,
		});
	}
}

// ---------------------------------------------------------------------------
// 2) 장식: main.ts 의 로딩 규칙과 같은 목록 (tree/bush 는 8프레임 sway 시트)
// ---------------------------------------------------------------------------
const TREE_HEIGHTS = { 1: 256, 2: 256, 3: 192, 4: 192 };
const decoSheets = new Map();
for (let i = 1; i <= 4; i += 1) {
	decoSheets.set(`deco-tree${i}`, { filePath: `deco/tree${i}.png`, frameWidth: 192, frameHeight: TREE_HEIGHTS[i] });
	decoSheets.set(`deco-bush${i}`, { filePath: `deco/bush${i}.png`, frameWidth: 128, frameHeight: 128 });
	decoSheets.set(`deco-rock${i}`, { filePath: `deco/rock${i}.png`, frameWidth: 0, frameHeight: 0 }); // 단일 이미지
}
for (let i = 1; i <= 6; i += 1) {
	decoSheets.set(`deco-goldstone${i}`, { filePath: `deco/goldstone${i}.png`, frameWidth: 0, frameHeight: 0 });
}

// ---------------------------------------------------------------------------
// 패킹은 Pillow(Python)로 — Node에 이미지 라이브러리를 추가하지 않기 위해서.
// ---------------------------------------------------------------------------
function build(name, sheets) {
	const spec = [];
	for (const [key, s] of sheets) {
		const abs = path.join(pub, s.filePath);
		if (!existsSync(abs)) {
			console.warn(`  건너뜀 (파일 없음): ${s.filePath}`);
			continue;
		}
		spec.push({ key, file: abs, fw: s.frameWidth, fh: s.frameHeight });
	}
	// 중간 산출물은 임시 디렉토리에 둔다 — public/ 에 남으면 dist 로 딸려 들어간다.
	const specPath = path.join(tmpdir(), `movesword-atlas-${name}.spec.json`);
	writeFileSync(specPath, JSON.stringify({ name, outDir, spec }, null, 1));
	// 예전 버전이 public/atlas/ 에 남긴 스펙 파일 정리 (실패해도 빌드는 계속)
	try {
		rmSync(path.join(outDir, `.${name}.spec.json`), { force: true });
	} catch {
		// 권한 문제 등 — 남아 있어도 게임 동작에는 영향이 없다
	}
	const out = execFileSync('python3', [path.join(root, 'scripts/pack_atlas.py'), specPath], { encoding: 'utf8' });
	process.stdout.write(out);
}

console.log('적 아틀라스…');
build('enemies', enemySheets);
console.log('장식 아틀라스…');
build('deco', decoSheets);
console.log('완료. public/atlas/ 확인');
