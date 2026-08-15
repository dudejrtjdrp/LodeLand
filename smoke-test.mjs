// Headless smoke test: boot → Title → CharacterSelect → GameScene → 12s of combat.
// Run: node smoke-test.mjs (expects vite dev server on :5173)
import { chromium } from 'playwright';

const errors = [];
const warnings = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
	if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500); // let BootScene finish loading assets

// Title → CharacterSelect
await page.keyboard.press('Space');
await page.waitForTimeout(800);
// CharacterSelect → GameScene (default character)
await page.keyboard.press('Space');

// Wait for the dev hook set by GameScene.create()
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1500);

const snapshot1 = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		playerHp: s.player?.hp,
		playerMaxHp: s.player?.maxHp,
		swordCount: s.swordOrbit?.swords?.length,
		reserveLen: s.swordOrbit?.reserve?.length,
		unlockedSlots: s.swordOrbit?.unlockedSlots,
		enemies: s.enemyManager?.enemies?.getChildren()?.length ?? 0,
		round: s.waveSystem?.getResults?.()?.round,
	};
});

// Move around + let combat run
for (let i = 0; i < 6; i += 1) {
	await page.keyboard.down('D');
	await page.waitForTimeout(700);
	await page.keyboard.up('D');
	await page.keyboard.down('W');
	await page.waitForTimeout(700);
	await page.keyboard.up('W');
}
await page.waitForTimeout(4000);

const snapshot2 = await page.evaluate(() => {
	const s = window.__gameScene;
	const enemies = s.enemyManager?.enemies?.getChildren() ?? [];
	const alive = enemies.filter((e) => e.active).length;
	return {
		playerAlive: !s.player?.isDead,
		playerHp: s.player?.hp,
		swordCount: s.swordOrbit?.swords?.length,
		swordStates: s.swordOrbit?.swords?.map((sw) => sw.state),
		activeEnemies: alive,
		killCount: s.waveSystem?.getResults?.()?.killCount,
		survivedMs: s.waveSystem?.getResults?.()?.survivedMs,
		xp: s.progression?.xp,
		level: s.progression?.level,
		gold: s.pickupSystem?.runGold,
		paused: s.isPaused,
	};
});

// Pause toggle check
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const pausedState = await page.evaluate(() => window.__gameScene.isPaused);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const resumedState = await page.evaluate(() => window.__gameScene.isPaused);

await browser.close();

const report = { snapshot1, snapshot2, pausedState, resumedState, errors, warnings: warnings.slice(0, 10) };
console.log(JSON.stringify(report, null, 2));

const failed =
	errors.length > 0 ||
	!snapshot2.playerAlive === undefined ||
	!(snapshot1.swordCount >= 1) ||
	!(snapshot2.activeEnemies >= 0) ||
	pausedState !== true ||
	resumedState !== false;
process.exit(failed ? 1 : 0);
