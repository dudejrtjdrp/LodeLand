// 난이도 개편 검증: 어픽스 적용, 신규 행동(charger/summoner/aura/blinker),
// 후반 스케일링, 다중 보스 구성이 크래시 없이 동작하는지 확인.
// Run: node balance-test.mjs (expects vite dev server on :5173)
//
// ※ 이것은 "런타임 무결성" 스모크 테스트다 — 수치 밸런스는 헤드리스 시뮬이 본다:
//     npm run balance-sim / npm run balance-gate  (scripts/balance-sim/, TUNING.md)
//   둘은 서로를 대체하지 않는다.
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1200);

// --- 1) 라운드 30 강제 시작: TWIN BOSS + 스케일링 + 어픽스 예산 ---
const round30 = await page.evaluate(() => {
	const s = window.__gameScene;
	s.waveSystem.startRound(30);
	const em = s.enemyManager;
	return {
		objectiveLabel: s.waveSystem.objective?.label,
		targets: s.waveSystem.objective?.targets?.map((t) => `${t.id}x${t.required}`),
		hpMult: Number(em.hpMult.toFixed(1)),
		damageMult: Number(em.damageMult.toFixed(1)),
		affixBudget: em.affixBudget,
	};
});

await page.waitForTimeout(1500);

const bossCheck = await page.evaluate(() => {
	const s = window.__gameScene;
	const alive = s.enemyManager.enemies.getChildren().filter((e) => e.active);
	const bosses = alive.filter((e) => e.catalog?.isBoss).map((e) => ({
		type: e.enemyType, name: e.enemyName, hp: e.maxHp, affixes: e.affixIds,
	}));
	const affixed = alive.filter((e) => (e.affixIds?.length ?? 0) > 0).length;
	return { aliveCount: alive.length, bosses, affixedCount: affixed };
});

// --- 2) 신규 행동 4종 + 어픽스 몹 직접 스폰 후 8초 전투 (크래시 감시) ---
const behaviorCheck = await page.evaluate(() => {
	const s = window.__gameScene;
	const em = s.enemyManager;
	const p = s.player;
	const spawn = (id, dx, dy) => em.spawnEnemy(s, p, id, { x: p.x + dx, y: p.y + dy });
	const spawned = [];
	for (const [id, dx, dy] of [
		['charger', 350, 0], ['broodcaller', -350, 0], ['banneret', 0, 350],
		['blinker', 0, -350], ['sniper', 500, 200], ['cindermaul', -400, -200],
		['swarmling', 300, 300],
	]) {
		const e = spawn(id, dx, dy);
		spawned.push({ id, ok: Boolean(e), hp: e ? e.maxHp : 0 });
	}
	return spawned;
});

await page.waitForTimeout(8000);

const afterCombat = await page.evaluate(() => {
	const s = window.__gameScene;
	const alive = s.enemyManager.enemies.getChildren().filter((e) => e.active);
	const types = {};
	for (const e of alive) {
		types[e.enemyType] = (types[e.enemyType] ?? 0) + 1;
	}
	return {
		playerAlive: !s.player.isDead,
		playerHp: Math.round(s.player.hp),
		aliveCount: alive.length,
		swarmlingsFromSummon: types['swarmling'] ?? 0,
		hazards: s.enemyManager.hazards.length,
		types,
	};
});

// --- 3) 라운드 55: GREATER 2+1 (서로 다른 중간보스 조합) ---
const round55 = await page.evaluate(() => {
	const s = window.__gameScene;
	s.waveSystem.startRound(55);
	return {
		label: s.waveSystem.objective?.label,
		targets: s.waveSystem.objective?.targets?.map((t) => `${t.id}x${t.required}`),
		hpMult: Number(s.enemyManager.hpMult.toFixed(1)),
		affixBudget: s.enemyManager.affixBudget,
	};
});

await page.waitForTimeout(2500);

const minibossCheck = await page.evaluate(() => {
	const s = window.__gameScene;
	const alive = s.enemyManager.enemies.getChildren().filter((e) => e.active);
	return {
		minibosses: alive.filter((e) => e.catalog?.isMiniboss).map((e) => ({
			type: e.enemyType, name: e.enemyName, hp: e.maxHp, affixes: e.affixIds,
		})),
		affixedShare: `${alive.filter((e) => (e.affixIds?.length ?? 0) > 0).length}/${alive.length}`,
	};
});

const result = { round30, bossCheck, behaviorCheck, afterCombat, round55, minibossCheck, errors };
console.log(JSON.stringify(result, null, 2));

await browser.close();
const failed = errors.length > 0
	|| (round30.targets ?? []).length < 2
	|| bossCheck.bosses.length < 2
	|| !afterCombat.playerAlive === undefined
	|| (round55.targets ?? []).length < 2;
process.exit(failed ? 1 : 0);
