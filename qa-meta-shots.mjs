// 도감/타이틀 3뷰포트 시각 QA 스크린샷 (임시 QA 스크립트)
import { chromium } from 'playwright';
const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const port = process.env.PORT || '5173';
const browser = await chromium.launch(exe ? { executablePath: exe, args } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(2600);
// 도감 데이터 시딩: 카탈로그 앞쪽 40종 기록
await page.evaluate(async () => {
  const res = await fetch('/assets/index.js').catch(() => null); void res;
  window.__codex.resetCodex();
  window.__achievements.reset();
  window.__stats.resetStats();
  window.__stats.bumpStat('kills', 320); window.__stats.bumpStat('bossKills', 3);
  window.__stats.bumpStat('runs', 4); window.__stats.raiseStat('bestRound', 34);
  window.__stats.flushStats();
  window.__achievements.evaluate();
});
// 검 id 시딩은 게임 씬 없이 어렵다 — 도감 화면에서 카탈로그를 직접 읽어 기록
await page.keyboard.press('d');
await page.waitForFunction(() => !!window.__codexScene, null, { timeout: 10000 });
await page.evaluate(() => {
  const s = window.__codexScene;
  const all = s.filteredSwords();
  all.slice(0, 46).forEach((d, i) => { if (i % 2 === 0 || i < 12) window.__codex.recordSwordSeen(d.id); });
  s.scene.restart({ tab: 'swords' });
});
await page.waitForTimeout(900);
for (const [w, h] of [[1280,720],[1440,860],[1920,1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__codexScene.scene.restart({ tab: 'swords' }));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__codexScene.showSwordDetail(window.__codexScene.filteredSwords()[0].id));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/shots2/codex-${w}x${h}.png` });
  await page.evaluate(() => window.__codexScene.switchTab('achievements'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/shots2/ach-${w}x${h}.png` });
  await page.evaluate(() => window.__codexScene.switchTab('swords'));
  await page.waitForTimeout(700);
}
// 타이틀 (이어하기 없음 / 있음)
await page.setViewportSize({ width: 1280, height: 720 });
await page.evaluate(() => window.__codexScene.back());
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots2/title-1280x720.png' });
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
await page.screenshot({ path: '/tmp/shots2/title-1920x1080.png' });
await browser.close();
console.log('SHOTS OK');
