// 상태이상 지속 표시 육안 QA — 상태별로 적을 세워 두고 확대 스크린샷을 찍는다.
// 실행: 프리뷰(5173) 띄운 뒤 `node qa-status-shots.mjs`  → qa-status-*.png
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1500);

const CASES = ['none', 'burn', 'poison', 'freeze', 'shock', 'bleed', 'slow', 'poison5'];

for (const kind of CASES) {
	await page.evaluate((k) => {
		const s = window.__gameScene;
		const m = s.enemyManager;
		const st = s.statusEffects;
		if (s.swordOrbit) s.swordOrbit.noLaunch = true;
		m.spawningEnabled = false;
		for (const e of m.enemies.getChildren()) if (e.active) m.recycleEnemy(e);
		m.gridBuiltAt = -1;
		// 프레임 감축이 걸리면 오버레이가 생략된다 — QA 동안만 끈다
		s.visualEffects.fxThrottle = () => 1;

		const row = [-160, 0, 160];
		for (const dx of row) {
			const e = m.spawnEnemy(s, s.player, 'skullwolf', { x: s.player.x + dx, y: s.player.y - 120 });
			if (!e) continue;
			e.hp = 1e9;
			e.maxHp = 1e9;
			e.speed = 0;
			e.setVelocity(0, 0);
			if (k === 'burn') m.applyDot(e, 20, 20000, 0xf97316);
			if (k === 'poison') m.applyDot(e, 20, 20000, 0x4ade80);
			if (k === 'poison5') {
				m.applyDot(e, 20, 20000, 0x4ade80);
				for (let i = 0; i < 5; i += 1) st.poisonStack(e, 5);
			}
			if (k === 'freeze') st.freeze(e, 20000);
			if (k === 'shock') st.shock(e, 20000);
			if (k === 'bleed') st.bleed(e, 20, 20000);
			if (k === 'slow') st.slow(e, 0.6, 20000);
		}
	}, kind);
	await page.waitForTimeout(900);
	await page.screenshot({ path: `qa-status-${kind}.png`, clip: { x: 340, y: 130, width: 600, height: 330 } });
	console.log(`shot: qa-status-${kind}.png`);
}

await browser.close();
