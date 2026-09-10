// 시간 누적형 렉 계측: 라운드 14 상황을 재현하고 "화면 밖 오브젝트가 얼마나 쌓이는지" 센다.
// 30라 전투 밀도를 보는 perf-test.mjs 와 달리, 이 스크립트는 **표시 목록 인구조사**가 목적이다.
// (사용자 보고: "14라운드인데 벌써 렉이 걸려" — 적 밀도가 아니라 시간에 비례하는 비용)
//
// Run: node census-test.mjs   (vite preview :5199 필요)
import { chromium } from 'playwright';

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

// 라운드 14 상태 재현 + 플레이어를 계속 이동시켜 청크/구슬/픽업이 쌓이게 한다
await page.evaluate(() => {
  const s = window.__gameScene;
  s.waveSystem.round = 14;
  s.waveSystem.update = () => {};
  s.enemyManager.setRound(14);
  s.enemyManager.setSpawnProfile({ spawnIntervalMs: 900, minAlive: 30 });
  s.player.maxHp = 50000; s.player.hp = 50000;
  for (let i = 0; i < 3; i += 1) s.swordOrbit.addSword(s);
  // 레벨업/증강/상점 자동 닫기
  setInterval(() => {
    if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
    if (s.augmentSystem?.isOpen) s.augmentSystem.close?.();
    if (s.shopSystem?.isOpen) s.shopSystem.close?.();
  }, 300);
  // 플레이어를 원을 그리며 계속 이동 (청크 스트리밍 + 구슬/픽업 흘리기)
  let t = 0;
  window.__roam = setInterval(() => {
    t += 0.06;
    s.player.setVelocity(Math.cos(t) * 260, Math.sin(t * 0.7) * 260);
  }, 60);
  // 프레임 카운터 + WebGL draw call 계측.
  // Phaser 버전마다 renderer의 통계 프로퍼티가 달라서, gl 함수를 직접 감싸 세는 게 확실하다.
  // 텍스처가 흩어져 있으면 스프라이트마다 배치가 flush되어 이 값이 치솟는다 (아틀라스 효과 측정).
  const P = { frames: 0, draws: 0 };
  window.__c = P;
  s.events.on('update', () => { P.frames += 1; });
  const gl = s.game.renderer?.gl;
  if (gl) {
    for (const fn of ['drawElements', 'drawArrays']) {
      const orig = gl[fn].bind(gl);
      gl[fn] = (...a) => { P.draws += 1; return orig(...a); };
    }
  }
});

const census = async () => page.evaluate(() => {
  const s = window.__gameScene;
  const cam = s.cameras.main;
  const L = cam.scrollX - 100, R = cam.scrollX + cam.width + 100;
  const T = cam.scrollY - 100, B = cam.scrollY + cam.height + 100;
  let offscreen = 0;
  let visibleOffscreen = 0;
  for (const c of s.children.list) {
    if (c.scrollFactorX === 0) continue; // HUD 제외
    const x = c.x, y = c.y;
    if (typeof x !== 'number') continue;
    if (x < L || x > R || y < T || y > B) {
      offscreen += 1;
      if (c.visible) visibleOffscreen += 1;
    }
  }
  let decos = 0;
  for (const ch of s.loadedChunks.values()) decos += ch.decos.length;
  const P = window.__c;
  const fps = P.frames - (P.prev ?? 0);
  P.prev = P.frames;
  // 아틀라스 효과 확인용: 프레임당 draw call. 텍스처가 흩어져 있으면 스프라이트마다
  // 배치가 flush되어 이 값이 스프라이트 수에 비례해 치솟는다.
  const frames = fps || 1;
  const draws = P.draws - (P.prevDraws ?? 0);
  P.prevDraws = P.draws;
  return {
    fps,
    // 프레임당 draw call — 아틀라스가 제대로 먹히면 적이 몇 마리든 거의 안 늘어난다
    drawPerFrame: +(draws / frames).toFixed(1),
    children: s.children.list.length,
    offscreen,
    // 화면 밖인데도 visible=true → 매 프레임 렌더 배치에 올라가는 순수 낭비
    offscreenDrawn: visibleOffscreen,
    chunks: s.loadedChunks.size,
    decos,
    orbs: s.progression.orbs.countActive(true),
    pickups: s.pickupSystem.items.length,
    bodies: s.physics.world.bodies.size,
    enemies: s.enemyManager.enemies.countActive(true),
  };
});

// VARIANT=noAtlas: 아틀라스 이전 상태(적 텍스처 25장 분산)를 같은 빌드 안에서 재현해
// draw call 을 A/B 한다. 샌드박스는 SwiftShader(소프트웨어 렌더링)라 draw call 의 드라이버
// 오버헤드가 fps 로 나타나지 않으므로, **draw call 수 자체**를 지표로 삼는다.
if (process.env.VARIANT === 'noAtlas') {
  await page.evaluate(async () => {
    const s = window.__gameScene;
    const cat = s.enemyManager.enemyCatalog;
    const sheets = new Map();
    for (const e of cat) {
      for (const sh of Object.values(e.spritesheets ?? {})) {
        if (sh?.textureKey) sheets.set(sh.textureKey, sh);
      }
    }
    // 원본 시트를 런타임에 개별 텍스처로 로드
    await new Promise((resolve) => {
      for (const [key, sh] of sheets) {
        s.load.spritesheet(`raw-${key}`, sh.filePath, { frameWidth: sh.frameWidth, frameHeight: sh.frameHeight });
      }
      s.load.once('complete', resolve);
      s.load.start();
    });
    // 매 프레임 적을 개별 텍스처로 되돌린다 (애니메이션은 끄고 정지 프레임으로 — 텍스처 전환 비용만 비교)
    s.events.on('update', () => {
      for (const e of s.enemyManager.enemies.getChildren()) {
        if (!e.active) continue;
        const key = e.catalog?.spritesheets?.idle?.textureKey;
        if (!key) continue;
        if (e.anims?.currentAnim) e.anims.stop();
        if (e.texture?.key !== `raw-${key}`) e.setTexture(`raw-${key}`, 0);
      }
    });
  });
}

// SAMPLES=n 으로 표본 수 조절 (기본 10 × 10초). A/B 비교 땐 3 정도로 줄여 쓴다.
const SAMPLES = Number(process.env.SAMPLES ?? 10);
const rows = [];
for (let i = 0; i < SAMPLES; i += 1) {
  await page.waitForTimeout(10000);
  rows.push({ t: (i + 1) * 10, ...(await census()) });
}
await browser.close();
for (const r of rows) console.log(JSON.stringify(r));
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
