// 성능 회귀 하네스 (2026-09-01 개편).
//
// 측정치는 전부 **SwiftShader(소프트웨어 GL) 기준 상대 비교**다. 절대 fps 는 실기기와
// 무관하다 — 같은 세션 안에서 A/B 를 교차했을 때의 차이만 신뢰할 것.
//
// ⚠ 샌드박스 함정: SwiftShader(LLVM JIT)는 시작 직후 20fps → 수 분에 걸쳐 300fps+ 까지
// 단조 상승한다. 그래서 "baseline 재고 → X 끄고 재고" 식 순차 A/B 는 뒤 측정이 무조건
// 빨라져 가짜 결론을 낸다(2026-08-31 오진 사례). 이 하네스는
//   (1) WARMUP_MS 동안 예열하고
//   (2) A/B 를 여러 번 **교차**해(ABAB…) 인접 쌍만 비교한다.
//
// 시나리오 (SCENARIO 환경변수):
//   steady  기본. 라운드 ROUND(기본 60) 상당 물량으로 정지 상태 장시간 측정.
//   move    이동 8초 — 50ms+ 스파이크 횟수 측정 (청크 스트리밍/텍스처 업로드/GC 검출).
//   ab      교차 A/B. AB_OFF 로 끌 대상 선택: tiles|hud|enemies|deco|fx|none
//
// 그 밖의 환경변수: PORT(5199), ROUND(60), WARMUP_MS(20000), BLOCK_MS(4000), BLOCKS(6), MIN_ALIVE
// Run: node perf-test.mjs   (vite preview 필요)
//
// 2026-09-01 이 하네스로 얻은 결론 (교차 A/B, 라운드 60·적 175):
//   · HUD 비용 ≈ 미니맵 하나 (숨기면 20.0→24.4fps). Graphics 는 커맨드 버퍼를 매 프레임
//     다시 삼각형으로 푼다 — 스로틀은 렌더 비용을 줄이지 못한다. → 프레임 굽기 + 사각 표식.
//   · 바닥 타일 레이어 12장 = 약 10ms/frame(24.6→33.0fps). 그중 쿼드 수(768장) 탓은 ~3ms 뿐이고
//     나머지는 순수 fill 이라 구조를 바꿔도(타일 1장짜리 TileSprite) 회수할 수 없다.
//   · **이동 스파이크는 재현되지 않는다**: 같은 세션에서 이동/정지를 교차하면 50ms+ 프레임 수가
//     이동 6 · 정지 6 으로 같다. 예전의 "이동이 더 심하다"는 순차 측정(워밍업 드리프트) 아티팩트.
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const SCENARIO = process.env.SCENARIO ?? 'steady';
const ROUND = Number(process.env.ROUND ?? 60);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 20000);
const BLOCK_MS = Number(process.env.BLOCK_MS ?? 4000);
const BLOCKS = Number(process.env.BLOCKS ?? 6);
const AB_OFF = process.env.AB_OFF ?? 'tiles';
// 스파이크(50ms+)는 평상시 프레임이 충분히 빠를 때만 의미가 있다 —
// 라운드 60 물량(적 160)은 샌드박스에서 평상시가 이미 48ms라 스파이크가 묻힌다.
// move 시나리오는 MIN_ALIVE 를 낮춰(기본 24) 가벼운 상태에서 잰다.
const MIN_ALIVE = Number(process.env.MIN_ALIVE ?? (SCENARIO === 'move' ? 24 : 160));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || undefined,
  // vsync/프레임 캡을 풀지 않으면 헤드리스 rAF 가 30Hz 로 고정돼 개선이 보이지 않는다
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-crashpad', '--disk-cache-dir=/tmp/chromecacheP'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2400);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2000);

// ── 상태 주입 (대기마을 게이트를 먼저 통과해야 적이 스폰된다)
await page.evaluate(([round, minAlive]) => {
  const s = window.__gameScene;
  // 세이브가 있으면 부팅이 대기마을에서 멈춘다 — 출격시키지 않으면 enemies=0 빈 측정이 된다.
  if (s.villageSystem?.isActive) {
    s.villageSystem.depart();
  }
  s.waveSystem.round = round - 1;
  s.waveSystem.update = () => {}; // 라운드 전환/상점 차단 — 정상상태 전투만 본다
  s.enemyManager.setRound(round);
  s.enemyManager.setSpawnProfile({ spawnIntervalMs: 600, minAlive });
  // waveSystem.update 를 막았으므로 스폰 게이트를 직접 연다 (라운드 입장 연출이 꺼 둔 상태일 수 있다)
  s.enemyManager.spawningEnabled = true;
  setInterval(() => { s.enemyManager.spawningEnabled = true; s.enemyManager.minAlive = minAlive; }, 1000);
  for (let i = 0; i < 5; i += 1) s.swordOrbit.addSword(s);
  for (const sw of s.swordOrbit.swords ?? []) { sw.level = 8; sw.damage = (sw.damage ?? 20) * 3; }
  s.player.maxHp = 5000000; s.player.hp = 5000000;
  // 레벨업/증강/상점 UI 는 열지 않는다 (카드 재구축 노이즈 제거)
  if (s.levelUpSystem) { s.levelUpSystem.open = () => {}; s.levelUpSystem.pendingChoices = 0; if (s.levelUpSystem.isOpen) s.levelUpSystem.close(); }
  if (s.augmentSystem) s.augmentSystem.open = () => {};
  if (s.shopSystem) s.shopSystem.open = () => {};

  // ── 프레임 계측: rAF 델타를 미리 잡아둔 버퍼에 적재 (측정 자체가 할당하지 않게)
  const P = { buf: new Float64Array(200000), n: 0, on: false, last: 0, work: new Float64Array(200000), wn: 0 };
  window.__perf = P;
  // 프레임 캡(헤드리스 vsync)이 걸리면 rAF 델타는 전부 33.3ms 로 뭉개진다.
  // 그래서 "게임이 한 프레임에 실제로 쓴 CPU 시간"(prestep→postrender)을 따로 잰다 — 캡과 무관하다.
  let t0 = 0;
  s.game.events.on('prestep', () => { t0 = performance.now(); });
  s.game.events.on('postrender', () => {
    if (P.on && t0 > 0 && P.wn < P.work.length) P.work[P.wn++] = performance.now() - t0;
  });
  const tick = (t) => {
    if (P.on) {
      if (P.last > 0 && P.n < P.buf.length) P.buf[P.n++] = t - P.last;
      P.last = t;
    } else {
      P.last = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__perfStart = () => { const P = window.__perf; P.n = 0; P.wn = 0; P.last = 0; P.on = true; };
  window.__perfStop = () => {
    const P = window.__perf; P.on = false;
    const a = Array.prototype.slice.call(P.buf.subarray(0, P.n)).sort((x, y) => x - y);
    const n = a.length;
    if (n === 0) return { frames: 0 };
    let sum = 0; let over33 = 0; let over50 = 0; let over100 = 0;
    for (const v of a) { sum += v; if (v > 33) over33 += 1; if (v > 50) over50 += 1; if (v > 100) over100 += 1; }
    const s = window.__gameScene;
    let visibleLayers = 0;
    for (const [, c] of s.loadedChunks ?? []) if (c.layer.visible) visibleLayers += 1;
    const w = Array.prototype.slice.call(P.work.subarray(0, P.wn)).sort((x, y) => x - y);
    const wn = w.length;
    const wsum = w.reduce((a, b) => a + b, 0);
    return {
      frames: n,
      workMs: wn ? +(wsum / wn).toFixed(2) : 0,
      workP95: wn ? +w[Math.floor(wn * 0.95)].toFixed(2) : 0,
      fps: +(1000 / (sum / n)).toFixed(1),
      medianMs: +a[Math.floor(n * 0.5)].toFixed(1),
      p95Ms: +a[Math.floor(n * 0.95)].toFixed(1),
      worstMs: +a[n - 1].toFixed(1),
      over33, over50, over100,
      enemies: s.enemyManager.enemies.countActive(true),
      children: s.children.list.length,
      chunks: s.loadedChunks?.size ?? 0,
      visibleLayers,
      pool: s.chunkPool?.length ?? 0,
    };
  };
}, [ROUND, MIN_ALIVE]);

const measure = async (ms) => {
  await page.evaluate(() => window.__perfStart());
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__perfStop());
};
const fmt = (r) => `fps ${r.fps} | work ${r.workMs}ms(p95 ${r.workP95}) | median ${r.medianMs}ms p95 ${r.p95Ms}ms worst ${r.worstMs}ms`
  + ` | >33ms ${r.over33} >50ms ${r.over50} >100ms ${r.over100}`
  + ` | 적 ${r.enemies} children ${r.children} 청크 ${r.chunks}(표시 ${r.visibleLayers}, 풀 ${r.pool})`;

// ── 예열 (SwiftShader JIT 드리프트 흡수)
process.stdout.write(`예열 ${WARMUP_MS}ms …\n`);
await page.waitForTimeout(WARMUP_MS);

if (SCENARIO === 'steady') {
  const blocks = [];
  for (let i = 0; i < BLOCKS; i += 1) {
    const r = await measure(BLOCK_MS);
    blocks.push(r);
    console.log(`block${i}  ${fmt(r)}`);
  }
  const tail = blocks.slice(Math.floor(BLOCKS / 2)); // 앞 절반은 잔여 드리프트로 버린다
  const avgFps = tail.reduce((a, b) => a + b.fps, 0) / tail.length;
  const spikes = tail.reduce((a, b) => a + b.over50, 0);
  console.log(`STEADY round=${ROUND} avgFps=${avgFps.toFixed(1)} 50ms+스파이크=${spikes} (후반 ${tail.length}블록 · SwiftShader 상대치)`);
} else if (SCENARIO === 'move') {
  // 이동 8초 × 3회 (정지 8초와 교차) — 스파이크가 이동 고유인지 가른다
  const still = [];
  const moving = [];
  for (let i = 0; i < 3; i += 1) {
    still.push(await measure(8000));
    console.log(`정지 ${i}  ${fmt(still[i])}`);
    // 사각 궤적으로 8초 이동 (청크 경계를 여러 번 넘게)
    // 2026-09-04: 이동은 화살표가 기본 (W/A/S/D 는 스킬 핫키)
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => window.__perfStart());
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowRight'); await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowDown'); await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowLeft'); await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowUp');
    const r = await page.evaluate(() => window.__perfStop());
    moving.push(r);
    console.log(`이동 ${i}  ${fmt(r)}`);
  }
  const sum = (arr, k) => arr.reduce((a, b) => a + b[k], 0);
  console.log(`MOVE 이동 50ms+ 합계=${sum(moving, 'over50')} (worst ${Math.max(...moving.map((m) => m.worstMs))}ms)`
    + ` | 정지 50ms+ 합계=${sum(still, 'over50')} (worst ${Math.max(...still.map((m) => m.worstMs))}ms)`);
} else if (SCENARIO === 'ab') {
  // 교차 A/B: OFF/ON 을 번갈아 재고 인접 쌍만 비교한다
  const apply = (off, enable) => page.evaluate(([kind, on]) => {
    const s = window.__gameScene;
    if (kind === 'tiles') {
      for (const [, c] of s.loadedChunks) c.layer.setVisible(!on ? false : c.layer.visible);
      s.__abTiles = !on;
      if (!s.__abTilesPatched) {
        s.__abTilesPatched = true;
        const orig = s.cullChunkDecorations.bind(s);
        s.cullChunkDecorations = () => { orig(); if (s.__abTiles) for (const [, c] of s.loadedChunks) c.layer.setVisible(false); };
      }
    } else if (kind === 'tilequad') {
      // ON = 지금처럼 타일맵 레이어(청크당 64칸) / OFF = 화면 전체를 덮는 쿼드 1장.
      // 덮는 픽셀 수는 같다 — 차이가 크면 비용은 fill 이 아니라 **쿼드 수(배치 셋업)** 라는 뜻.
      s.__abTiles = !on;
      if (!s.__abTilesPatched) {
        s.__abTilesPatched = true;
        const orig = s.cullChunkDecorations.bind(s);
        s.cullChunkDecorations = () => { orig(); if (s.__abTiles) for (const [, c] of s.loadedChunks) c.layer.setVisible(false); };
      }
      if (!s.__quadImg) {
        s.__quadImg = s.add.image(0, 0, 'uf-fill-dark').setOrigin(0, 0).setScrollFactor(0).setDepth(-6)
          .setDisplaySize(s.scale.width, s.scale.height);
      }
      s.__quadImg.setVisible(!on);
    } else if (kind === 'hud') {
      s.setGameHudVisible(on);
    } else if (kind === 'minimap') {
      s.hudSystem.minimapG.setVisible(on);
    } else if (kind === 'hudtext') {
      for (const t of [s.hudSystem.levelText, s.hudSystem.levelLabel, s.hudSystem.xpText,
        s.hudSystem.goldText, s.hudSystem.hpText, s.hudSystem.tabHintText,
        s.waveSystem.timerText, s.waveSystem.objectiveText, s.waveSystem.objectiveCount, s.waveSystem.killText]) t?.setVisible(on);
      for (const [, l] of s.hudSystem.enemyLabels) l.setVisible(on);
    } else if (kind === 'panels') {
      for (const p of [s.hudSystem.topPanel, s.hudSystem.levelBadge, s.hudSystem.hpBarBg, s.hudSystem.hpBarBack,
        s.hudSystem.hpBarFill, s.hudSystem.xpBarBg, s.hudSystem.xpBarBack, s.hudSystem.xpBarFill,
        s.hudSystem.goldChip, s.hudSystem.furnaceIcon, s.hudSystem.hpBarG,
        s.waveSystem.hudPanel, s.waveSystem.hudObjDivider, s.waveSystem.dangerBadge]) p?.setVisible(on);
    } else if (kind === 'swordhud') {
      for (const icon of s.swordOrbit?.hudIcons ?? []) icon.setVisible(on);
    } else if (kind === 'healthbars') {
      s.visualEffects.enemyBarsG?.setVisible(on);
      s.__abBars = !on;
      if (!s.__abBarsPatched) {
        s.__abBarsPatched = true;
        const orig = s.visualEffects.drawEnemyHealthBars.bind(s.visualEffects);
        s.visualEffects.drawEnemyHealthBars = (e) => { if (!s.__abBars) orig(e); else s.visualEffects.enemyBarsG?.clear(); };
      }
    } else if (kind === 'enemies') {
      s.__abEnemies = !on;
      if (!s.__abEnemyPatched) {
        s.__abEnemyPatched = true;
        setInterval(() => { if (s.__abEnemies) for (const e of s.enemyManager.enemies.getChildren()) e.setVisible(false); }, 100);
      }
      if (on) for (const e of s.enemyManager.enemies.getChildren()) if (e.active) e.setVisible(true);
    } else if (kind === 'deco') {
      s.__abDeco = !on;
      if (!s.__abDecoPatched) {
        s.__abDecoPatched = true;
        setInterval(() => { if (s.__abDeco) for (const [, c] of s.loadedChunks) for (const d of c.decos) d.setVisible(false); }, 100);
      }
    }
  }, [off, enable]);

  for (let i = 0; i < BLOCKS; i += 1) {
    const on = i % 2 === 0; // ON(기본) / OFF 교차
    await apply(AB_OFF, on);
    await page.waitForTimeout(400);
    const r = await measure(BLOCK_MS);
    console.log(`${AB_OFF} ${on ? 'ON ' : 'OFF'}  ${fmt(r)}`);
  }
}

console.log('errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
