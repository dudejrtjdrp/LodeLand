// 스킬 책 화면 캡처 — node skillbook-shot.mjs <outDir> [W] [H]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const W = Number(process.argv[3] || 1600);
const H = Number(process.argv[4] || 900);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad',
		`--crash-dumps-dir=${process.env.CH_DUMPS || '/tmp'}`],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 30000 });
await page.waitForTimeout(1600);

const info = await page.evaluate(() => {
	const s = window.__gameScene;
	s.enemyManager.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.progression.xpMultiplier = 0;
	const t = s.skillTree;
	t.bonusPoints = 400;
	t.recompute();
	s.skillWindow.open();   // 먼저 열어야 습득 배너가 안 뜬다
	// 레퍼런스와 비슷한 상태: 사냥 갈래를 여러 레벨로 채운다
	for (let i = 0; i < 30; i += 1) t.learn('hunt-1');
	for (let i = 0; i < 30; i += 1) t.learn('hunt-2');
	for (let i = 0; i < 12; i += 1) t.learn('hunt-3');
	for (let i = 0; i < 30; i += 1) t.learn('hunt-4');
	for (let i = 0; i < 6; i += 1) t.learn('hunt-5');
	s.skillWindow.selected = 'hunt-4';
	s.skillWindow.close();
	s.skillWindow.open();
	return { points: t.points(), levels: { ...t.levels }, sel: s.skillWindow.selected };
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/skillbook-${W}x${H}.png` });

// 다른 갈래 · 잠긴 스킬
await page.evaluate(() => {
	const s = window.__gameScene;
	s.skillWindow.selectBranch('frost');
	s.skillWindow.selected = 'frost-3';
	s.skillWindow.scroll = 0;
	s.skillWindow.close(); s.skillWindow.open();
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/skillbook-frost-${W}x${H}.png` });

console.log(JSON.stringify({ info, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
