// 능동 스킬 등록 상한 + 패시브 확충 회귀 테스트 (2026-09-06)
//
// 규칙: 배우는 것에는 제한이 없다(능동 21종 전부 배울 수 있다). 키에 **등록**하는 것만
// 10개까지고(core/skillHotbar.MAX_REGISTERED_SKILLS), 넘기려면 기존 것을 먼저 해제해야 한다.
// 남는 스킬 포인트가 갈 곳이 있도록 패시브를 78종으로 늘렸다.
//
// Run: (vite preview --port 5199) && node skill-cap-test.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOTBAR_KEY = 'movesword-skill-hotbar-v1';
const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
	// 오프라인 샌드박스에서는 웹폰트가 안 받아진다 — 게임 오류가 아니다
	if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) {
		errors.push(msg.text());
	}
});

await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 60000 });
// 이전 런의 핫바가 남아 있으면 상한 판정이 흔들린다
await page.evaluate((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } }, HOTBAR_KEY);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(700);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 30000 });
await page.waitForTimeout(1200);

const checks = [];
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info }); };

// 포인트를 넉넉히 주고 배울 수 있는 능동 노드를 전부 배운다
const learned = await page.evaluate(() => {
	const scene = window.__gameScene;
	const tree = scene.skillTree;
	scene.enemyManager.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
	scene.progression.xpMultiplier = 0;
	for (let l = 2; l <= 120; l += 1) { scene.progression.level = l; scene.applyLevelGrowth(l); }
	// 선행 조건 때문에 여러 번 돌린다
	for (let pass = 0; pass < 8; pass += 1) {
		for (const node of tree.allNodes()) {
			if (node.kind !== 'active' || tree.levelOf(node.id) > 0) continue;
			if (tree.canLearn(node.id)) tree.learn(node.id);
		}
	}
	return tree.activeNodes().map((n) => n.id);
});

const shape = await page.evaluate(() => {
	const nodes = window.__gameScene.skillTree.allNodes();
	return {
		total: nodes.length,
		actives: nodes.filter((n) => n.kind === 'active').length,
		passives: nodes.filter((n) => n.kind === 'passive').length,
	};
});
check('트리 총 99노드 (능동 21 · 패시브 78)',
	shape.total === 99 && shape.actives === 21 && shape.passives === 78, JSON.stringify(shape));
// 배우기 자체에는 상한이 없다 — 등록 상한(10)보다 많이 배워지는 것이 핵심이다.
// (실제 개수는 선행 조건과 스킬 포인트 예산에 따라 달라지므로 고정값으로 박지 않는다)
check('등록 상한보다 많은 능동을 배울 수 있다 (배우기는 무제한)',
	learned.length > 10, `${learned.length}종 배움`);

const bar = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), HOTBAR_KEY);
check('키에 등록된 능동은 10개까지', Object.keys(bar).length === 10, `${Object.keys(bar).length}`);
check('초과분은 등록 대기 상태로 남는다',
	learned.length - Object.keys(bar).length === learned.length - 10
	&& learned.length - Object.keys(bar).length > 0,
	`${learned.length - Object.keys(bar).length}종 대기`);

// HUD 는 등록된 것만 띄운다 — 못 쓰는 스킬이 자리만 먹지 않게
const hud = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	const registered = Object.keys(JSON.parse(localStorage.getItem('movesword-skill-hotbar-v1') ?? '{}'));
	const unregistered = window.__gameScene.skillTree.activeNodes().map((n) => n.id).filter((id) => !registered.includes(id));
	return {
		registeredShown: registered.every((id) => a.iconRect(id) !== null),
		unregisteredHidden: unregistered.every((id) => a.iconRect(id) === null),
	};
});
check('HUD: 등록된 스킬은 아이콘이 있다', hud.registeredShown);
check('HUD: 미등록 스킬은 아이콘이 없다', hud.unregisteredHidden);

// 해제하면 그 자리에 다른 스킬을 등록할 수 있다
const swap = await page.evaluate((k) => {
	const scene = window.__gameScene;
	const before = JSON.parse(localStorage.getItem(k) ?? '{}');
	const victim = Object.keys(before)[0];
	const waiting = scene.skillTree.activeNodes().map((n) => n.id).find((id) => !before[id]);
	// 상한이 찬 상태에서의 등록 시도는 거부되어야 한다
	const refused = scene.skillWindow.trySetKeyForTest
		? scene.skillWindow.trySetKeyForTest(waiting, 'P')
		: null;
	scene.skillWindow.unregisterForTest(victim);
	const afterClear = Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}')).length;
	const ok = scene.skillWindow.trySetKeyForTest(waiting, 'P');
	const afterAdd = Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}')).length;
	return { victim, waiting, refused, afterClear, afterAdd, ok };
}, HOTBAR_KEY);
check('가득 찬 상태의 신규 등록은 거부된다 (reason: full)',
	swap.refused && swap.refused.ok === false && swap.refused.reason === 'full', JSON.stringify(swap.refused));
check('해제하면 9개로 줄어든다', swap.afterClear === 9, `${swap.afterClear}`);
check('빈 자리에 대기 중이던 스킬을 등록할 수 있다',
	swap.ok && swap.ok.ok === true && swap.afterAdd === 10, JSON.stringify(swap));

check('페이지/콘솔 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: `${outDir}/skill-cap-hud.png` });

for (const c of checks) {
	console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info ? `  — ${c.info}` : ''}`);
}
const passed = checks.filter((c) => c.ok).length;
console.log(`${passed}/${checks.length} 통과`);
console.log(`SKILL-CAP TEST: ${passed === checks.length ? 'PASS' : 'FAIL'}`);

await browser.close();
process.exit(passed === checks.length ? 0 : 1);
