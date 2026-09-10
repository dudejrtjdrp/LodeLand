// Headless regression: 실전 경로 사망(연속 피해→사망 애니→FLAMEOUT) → '다시 시작' 클릭 → RAF 생존·플레이어 이동 검증.
// Run: node restart-test.mjs (vite dev :5173 필요)
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`http://localhost:${process.env.PORT || 5173}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2200);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(1500);
// strong enemies so the player dies naturally through repeated real hits
await page.evaluate(() => { const s = window.__gameScene; s.waveSystem.round = 25; s.player.maxHp = 40; s.player.hp = 40; s.player.armor = 0; s.player.hpRegen = 0; s.revivalsLeft = 0; });
// wiggle with real keys while dying
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  const dead = await page.evaluate(() => { const s = window.__gameScene; if (!s.isGameOver && s.player && !s.player.isDead) { s.player.invulnerableUntil = 0; s.applyPlayerDamage(12, s.player.x + 20, s.player.y); } return s.isGameOver; });
  if (dead) break;
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');
}
const died = await page.evaluate(() => window.__gameScene.isGameOver);
console.log('died naturally:', died, 'in', Date.now() - t0, 'ms');
if (!died) { console.log('did not die — abort'); await browser.close(); process.exit(1); }
await page.waitForTimeout(1500);
// click 다시 시작
const pos = await page.evaluate(() => {
  const s = window.__gameScene;
  let found = null;
  const visit = (obj) => {
    if (found) return;
    if ((obj.text === '다시 시작' || obj.text === '처음부터') && obj.parentContainer) { const m = obj.parentContainer.getWorldTransformMatrix(); found = { x: m.tx, y: m.ty }; return; }
    if (obj.list) obj.list.forEach(visit);
  };
  s.children.list.forEach(visit);
  return found;
});
await page.mouse.move(pos.x, pos.y);
await page.waitForTimeout(120);
await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
await page.waitForTimeout(3000);
// real symptom check: RAF alive? player moves with real key?
const f1 = await page.evaluate(() => window.__gameScene.game.loop.frame);
await page.waitForTimeout(800);
const f2 = await page.evaluate(() => window.__gameScene.game.loop.frame);
const x1 = await page.evaluate(() => window.__gameScene.player?.x);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(900);
await page.keyboard.up('ArrowRight');
const x2 = await page.evaluate(() => window.__gameScene.player?.x);
const st = await page.evaluate(() => ({ over: window.__gameScene.isGameOver, dead: window.__gameScene.player?.isDead, paused: window.__gameScene.physics.world.isPaused }));
await browser.close();
console.log('rafAlive:', f2 > f1, 'playerMoved:', x2 !== x1, `(x ${x1} -> ${x2})`, JSON.stringify(st));
console.log('errors:', JSON.stringify(errors.slice(0, 8)));
console.log(f2 > f1 && x2 !== x1 && !st.over && !st.dead && errors.length === 0 ? 'NATURAL DEATH RESTART: PASS' : 'NATURAL DEATH RESTART: FAIL');
