// 화면 캡처 QA: 타이틀 → 떼지기 선택 → 인게임 → 털갈이 → 일시정지 → 상점 → 화로 되지피기.
// Run: node screenshot-test.mjs [outDir] (expects vite dev server on :5173)
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? 'shots';
const { mkdirSync } = await import('node:fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2600);
await shot('01-title');

await page.keyboard.press('Space');
await page.waitForTimeout(900);
await shot('02-select');

await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(2200);
await shot('03-game-early');

// 전투 진행
for (let i = 0; i < 5; i += 1) {
	await page.keyboard.down('D');
	await page.waitForTimeout(600);
	await page.keyboard.up('D');
	await page.keyboard.down('S');
	await page.waitForTimeout(500);
	await page.keyboard.up('S');
}
await page.waitForTimeout(1500);
await shot('04-game-combat');

// 털갈이(레벨업) 화면 — XP 를 강제로 채워 연다
await page.evaluate(() => {
	const s = window.__gameScene;
	s.progression.addXP(s.progression.xpToNext + 1);
});
await page.waitForTimeout(700);
await shot('05-levelup');
await page.keyboard.press('1');
await page.waitForTimeout(500);

// 일시정지
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('06-pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 상점 — 라운드 목표를 강제로 완료시킨다
await page.evaluate(() => {
	const s = window.__gameScene;
	s.pickupSystem.addGold(500);
	s.waveSystem.objective = { type: 'kill-count', required: 0, label: 'test' };
	// 2026-09-06: 스폰 창 종료 + 잔당 전멸이 종료 조건 — 테스트는 지름길로 채운다
	s.waveSystem.skipToRoundEnd();
	s.waveSystem.killsThisRound = 1;
});
// 클리어 배너 → 상점 진입까지 여유를 둔다
await page.waitForTimeout(3200);
await shot('07-shop');

// 상점 안 모달 (능력치)
await page.keyboard.press('U');
await page.waitForTimeout(500);
await shot('07b-shop-upgrades');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 상점 닫고 결과 화면 (사망 처리)
await page.keyboard.press('Space');
await page.waitForTimeout(700);
await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.hp = 1;
	s.applyPlayerDamage(99999, null, null);
});
await page.waitForTimeout(2600);
await shot('08-result');

// 타이틀로 → 화로 되지피기
await page.keyboard.press('T');
await page.waitForTimeout(900);
await page.keyboard.press('U');
await page.waitForTimeout(800);
await shot('09-powerup');

await browser.close();
console.log(`screenshots saved to ${outDir}/`);
