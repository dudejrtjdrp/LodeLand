// 텍스처 유닛 진단: 아틀라스가 실제로 필요한지 판단하기 위한 계측.
//
// Phaser 3 WebGL은 **멀티 텍스처 배칭**을 한다 — GPU가 허용하는 텍스처 유닛 수만큼
// 동시에 바인딩하고 정점마다 텍스처 인덱스를 넘긴다. 그래서 "텍스처가 여러 장이면
// 스프라이트마다 배치가 끊긴다"는 통념은 **동시 사용 텍스처가 유닛 수를 넘을 때만** 맞다.
// 이 스크립트는 (1) 유닛 상한과 (2) 실제로 한 화면에 동시에 쓰이는 텍스처 수를 잰다.
//
// Run: ROUND=14|35 node texunit-test.mjs   (vite preview :5199)
import { chromium } from 'playwright';

const ROUND = Number(process.env.ROUND ?? 35);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });
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

await page.evaluate((round) => {
  const s = window.__gameScene;
  s.waveSystem.round = round;
  s.waveSystem.update = () => {};
  s.enemyManager.setRound(round);
  s.enemyManager.setSpawnProfile({ spawnIntervalMs: 500, minAlive: round >= 30 ? 120 : 30 });
  s.player.maxHp = 99999; s.player.hp = 99999;
  for (let i = 0; i < 4; i += 1) s.swordOrbit.addSword(s);
  setInterval(() => {
    if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
    if (s.augmentSystem?.isOpen) s.augmentSystem.close?.();
    if (s.shopSystem?.isOpen) s.shopSystem.close?.();
  }, 300);
  const P = { frames: 0, draws: 0 };
  window.__t = P;
  s.events.on('update', () => { P.frames += 1; });
  const gl = s.game.renderer?.gl;
  P.maxUnits = gl ? gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) : null;
  P.phaserMaxTextures = s.game.renderer?.maxTextures ?? null;
  if (gl) {
    for (const fn of ['drawElements', 'drawArrays']) {
      const orig = gl[fn].bind(gl);
      gl[fn] = (...a) => { P.draws += 1; return orig(...a); };
    }
  }
}, ROUND);

await page.waitForTimeout(20000);

const out = await page.evaluate(() => {
  const s = window.__gameScene;
  const P = window.__t;
  const cam = s.cameras.main;
  const L = cam.scrollX, R = cam.scrollX + cam.width, T = cam.scrollY, B = cam.scrollY + cam.height;
  // 화면 안에서 실제로 그려지는 오브젝트들의 고유 텍스처 수
  const tex = new Set();
  let onScreen = 0;
  for (const c of s.children.list) {
    if (!c.visible) continue;
    if (typeof c.x !== 'number') continue;
    const fixed = c.scrollFactorX === 0;
    if (!fixed && (c.x < L - 120 || c.x > R + 120 || c.y < T - 120 || c.y > B + 120)) continue;
    onScreen += 1;
    if (c.texture?.key) tex.add(c.texture.key);
  }
  const enemyTypes = new Set();
  for (const e of s.enemyManager.enemies.getChildren()) {
    if (e.active && e.enemyType) enemyTypes.add(e.enemyType);
  }
  return {
    round: s.waveSystem.round,
    glMaxTextureUnits: P.maxUnits,
    phaserMaxTextures: P.phaserMaxTextures,
    drawPerFrame: +(P.draws / Math.max(1, P.frames)).toFixed(1),
    onScreenObjects: onScreen,
    distinctTexturesOnScreen: tex.size,
    textures: [...tex].sort(),
    aliveEnemies: s.enemyManager.enemies.countActive(true),
    distinctEnemyTypes: enemyTypes.size,
  };
});
await browser.close();
console.log(JSON.stringify(out, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 3)));
