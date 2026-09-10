// 배경음(BGM)·음량 설정 회귀 테스트 (2026-09-01 신설, 같은 날 긴장도 레이어 추가).
// 검증: (1) 4트랙 로드·루프 길이 + 전투 레이어 2장(길이 정합) (2) 타이틀 트랙 재생
//       (3) 크로스페이드 ≥600ms (8) 긴장도 레이어: 동시 시작·800ms 램프·음량 곱
//       (4) 씬/상황 전환: 전투 → 보스 → 전투 → 대기마을 → 출격(전투)
//       (5) BGM 음량이 재생 중인 사운드에 반영 (6) 볼륨/음소거 localStorage 영속
//       (7) 신규 정보 전달음(lowhp·telegraph) 로드
// Run: node bgm-test.mjs  (vite preview :5197 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  // 샌드박스 QA: CHROME_BIN 으로 headless_shell 경로 주입 (movesword-sandbox-build 메모)
  executablePath: process.env.CHROME_BIN || undefined,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu',
    // 자동재생 정책 때문에 사용자 제스처 없이는 오디오가 잠긴다 (헤드리스 QA 전용 플래그)
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForFunction(() => !!window.__bgm, null, { timeout: 20000 });
await page.waitForTimeout(1200);

// ── (1) 트랙 로드 · 루프 길이 (30~60초)
const assets = await page.evaluate(() => {
  const bgm = window.__bgm;
  const cache = bgm.game.cache.audio;
  const out = {};
  for (const track of ['title', 'battle', 'boss', 'village']) {
    const entry = cache.get(`bgm-${track}`);
    out[track] = entry ? Math.round((entry.duration ?? 0) * 10) / 10 : null;
  }
  for (const layer of ['battle-layer1', 'battle-layer2']) {
    const entry = cache.get(`bgm-${layer}`);
    out[layer] = entry ? Math.round((entry.duration ?? 0) * 100) / 100 : null;
  }
  out.battleExact = (cache.get('bgm-battle')?.duration ?? 0);
  out.lowhp = !!cache.get('lowhp');
  out.telegraph = !!cache.get('telegraph');
  return out;
});
for (const track of ['title', 'battle', 'boss', 'village']) {
  const d = assets[track];
  check(`트랙 로드: ${track} (30~60초 루프)`, typeof d === 'number' && d >= 30 && d <= 60, `${d}s`);
}
// 긴장도 레이어 — base 와 **길이가 같아야** 동시 재생 싱크가 유지된다
for (const layer of ['battle-layer1', 'battle-layer2']) {
  const d = assets[layer];
  check(`레이어 로드: ${layer}`, typeof d === 'number' && d >= 30 && d <= 60, `${d}s`);
  check(`레이어 루프 정합: ${layer} 길이 = battle 길이`,
    typeof d === 'number' && Math.abs(d - assets.battleExact) < 0.02,
    `${d}s vs ${Math.round(assets.battleExact * 100) / 100}s`);
}
check('정보음 로드: 저체력 경고(lowhp)', assets.lowhp === true);
check('정보음 로드: 보스 즉살기 전조음(telegraph)', assets.telegraph === true);

// ── (2) 타이틀 씬 = 타이틀 트랙, 루프 재생
const titleState = await page.evaluate(() => {
  const bgm = window.__bgm;
  const voice = bgm.voices[0];
  return {
    current: bgm.currentTrack,
    audible: bgm.audibleTrack,
    playing: !!voice?.sound?.isPlaying,
    loop: !!voice?.sound?.loop,
    volume: voice?.sound?.volume ?? 0,
  };
});
check('타이틀: 트랙 = title', titleState.current === 'title', JSON.stringify(titleState));
check('타이틀: 루프 재생 중', titleState.playing && titleState.loop);
check('타이틀: 페이드인 완료(음량 > 0)', titleState.volume > 0, `vol=${titleState.volume}`);

// ── (3) 크로스페이드: 전환 직후 두 트랙이 겹치고, 600ms 뒤에도 아직 페이드 중
const fade = await page.evaluate(async () => {
  const bgm = window.__bgm;
  bgm.play('battle', 900);
  const snap = () => bgm.voices.map((v) => ({
    track: v.track, layer: v.layer, level: Math.round(v.level * 100) / 100,
  }));
  const immediate = snap();
  await new Promise((r) => setTimeout(r, 450));
  const mid = snap();
  await new Promise((r) => setTimeout(r, 900));
  const done = snap();
  bgm.play('title', 400);
  return { immediate, mid, done, fadeMs: 900 };
});
// 전투는 base + 강화 레이어 2장이 함께 시작하므로 보이스는 title 1 + battle 3 = 4다
check('크로스페이드: 전환 직후 두 트랙 공존 (전투는 base+레이어 3보이스)',
  fade.immediate.length === 4 && fade.immediate.filter((v) => v.track === 'battle').length === 3,
  JSON.stringify(fade.immediate));
const midOut = fade.mid.find((v) => v.track === 'title');
const midIn = fade.mid.find((v) => v.track === 'battle' && v.layer === 0);
check('크로스페이드: 450ms 시점에 아직 진행 중 (≥600ms 페이드)',
  !!midOut && midOut.level > 0.1 && midOut.level < 0.9 && !!midIn && midIn.level > 0.1 && midIn.level < 0.9,
  JSON.stringify(fade.mid));
check('크로스페이드: 완료 후 전투 트랙만 남음 (base+레이어 3)',
  fade.done.length === 3 && fade.done.every((v) => v.track === 'battle'), JSON.stringify(fade.done));

// ── (4) 씬 전환: 타이틀 → 전투
await page.waitForTimeout(600);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2400); // 라운드 1 입장 연출 + BGM 폴링(400ms)
const battleState = await page.evaluate(() => ({
  current: window.__bgm.currentTrack,
  voices: window.__bgm.voices.length,
}));
check('전투 씬: 트랙 = battle', battleState.current === 'battle', JSON.stringify(battleState));
check('전투 씬: 이전 트랙 정리됨 (전투 보이스 3만 남음)',
  battleState.voices === 3, `voices=${battleState.voices}`);

// ── (5) 보스 등장 → boss, 보스 사망 → battle 복귀
await page.evaluate(() => {
  const s = window.__gameScene;
  const boss = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 500, y: s.player.y });
  if (boss) {
    boss.maxHp = 50000;
    boss.hp = 50000;
  }
});
await page.waitForTimeout(1400);
const bossState = await page.evaluate(() => ({
  current: window.__bgm.currentTrack,
  hasBoss: window.__gameScene.bossBar.hasBoss,
}));
check('보스 등장: 트랙 = boss', bossState.current === 'boss', JSON.stringify(bossState));

await page.evaluate(() => {
  const s = window.__gameScene;
  for (const e of s.enemyManager.enemies.getChildren()) {
    if (e.active) s.enemyManager.recycleEnemy?.(e);
  }
  s.enemyManager.clearField?.();
});
await page.waitForTimeout(1400);
const afterBoss = await page.evaluate(() => window.__bgm.currentTrack);
check('보스 사망: 전투 트랙 복귀', afterBoss === 'battle', String(afterBoss));

// ── (6) 대기마을 진입 → village, 출격(depart) → battle
await page.evaluate(() => {
  const s = window.__gameScene;
  s.waveSystem.objective = { type: 'kill-count', required: 0, label: '테스트' };
  // 2026-09-06: 스폰 창 종료 + 잔당 전멸이 종료 조건 — 테스트는 지름길로 채운다
  s.waveSystem.skipToRoundEnd();
});
await page.waitForFunction(() => window.__gameScene.villageSystem.isActive, null, { timeout: 12000 });
await page.waitForTimeout(900);
const villageState = await page.evaluate(() => window.__bgm.currentTrack);
check('대기마을: 트랙 = village', villageState === 'village', String(villageState));

await page.evaluate(() => window.__gameScene.villageSystem.depart());
await page.waitForTimeout(2600);
const departState = await page.evaluate(() => ({
  current: window.__bgm.currentTrack,
  village: window.__gameScene.villageSystem.isActive,
}));
check('출격: 전투 트랙 복귀', departState.current === 'battle' && departState.village === false,
  JSON.stringify(departState));

// ── (6-b) 긴장도 레이어: base 와 동시 재생 · 800ms 램프 · 음량은 설정과 곱
const layers = await page.evaluate(async () => {
  const bgm = window.__bgm;
  // GameScene 이 400ms 마다 실제 긴장도를 밀어 넣으므로, 수동 주입 동안에는 그 폴링을
  // 잠시 멈춘다 (다음 폴링 시각을 아주 먼 미래로 밀어 두는 방식 — updateBgm 이 즉시 반환).
  const scene = window.__gameScene;
  const savedPoll = scene.bgmPollAt;
  scene.bgmPollAt = Number.MAX_SAFE_INTEGER;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r2 = (v) => Math.round(v * 100) / 100;
  const snap = () => bgm.voices
    .filter((v) => v.track === 'battle')
    .map((v) => ({
      layer: v.layer,
      mix: r2(v.mix),
      level: r2(v.level),
      volume: r2(v.sound.volume ?? 0),
      playing: !!v.sound.isPlaying,
      loop: !!v.sound.loop,
      seek: v.sound.seek ?? 0,
    }))
    .sort((a, b) => a.layer - b.layer);

  bgm.setTension(0);
  await sleep(950);
  const calm = snap();

  bgm.setTension(1);
  await sleep(260);
  const rampingRaw = snap();
  await sleep(900);
  const loud = snap();

  bgm.setTension(0);
  await sleep(1000);
  const quiet = snap();

  scene.bgmPollAt = savedPoll;
  return { calm, ramping: rampingRaw, loud, quiet };
});

check('레이어: base + 강화 2장이 동시에 루프 재생',
  layers.calm.length === 3 && layers.calm.every((v) => v.playing && v.loop),
  JSON.stringify(layers.calm.map((v) => ({ l: v.layer, p: v.playing, loop: v.loop }))));
check('레이어: base 와 재생 위치가 같다 (동시 시작 → 싱크 유지)',
  layers.calm.every((v) => Math.abs(v.seek - layers.calm[0].seek) < 0.08),
  JSON.stringify(layers.calm.map((v) => Math.round(v.seek * 1000) / 1000)));
check('레이어: 긴장도 0 이면 강화 레이어는 무음 (base 만 들린다)',
  layers.calm[0].mix === 1 && layers.calm[1].mix === 0 && layers.calm[2].mix === 0
    && layers.calm[0].volume > 0 && layers.calm[1].volume === 0,
  JSON.stringify(layers.calm.map((v) => ({ l: v.layer, mix: v.mix, vol: v.volume }))));
check('레이어: 긴장도 상승 직후 램프 중 (800ms — 즉시 켜지지 않는다)',
  layers.ramping[1].mix > 0 && layers.ramping[1].mix < 1,
  JSON.stringify(layers.ramping.map((v) => v.mix)));
check('레이어: 램프 완료 후 두 레이어 모두 최대',
  layers.loud[1].mix >= 0.99 && layers.loud[2].mix >= 0.99,
  JSON.stringify(layers.loud.map((v) => v.mix)));
check('레이어: 음량 = 설정 음량 × 페이드 × 레이어 믹스',
  Math.abs(layers.loud[1].volume - layers.loud[0].volume) < 0.02
    && layers.loud[0].volume > 0,
  JSON.stringify(layers.loud.map((v) => ({ l: v.layer, vol: v.volume }))));
check('레이어: 긴장도 하강 시 다시 빠진다 (트랙 전환 없이)',
  layers.quiet[1].mix === 0 && layers.quiet[2].mix === 0 && layers.quiet[0].level === 1,
  JSON.stringify(layers.quiet.map((v) => v.mix)));

// 긴장도 계산 자체 — GameScene.combatTension 이 0~1 을 낸다
const tension = await page.evaluate(() => {
  const s = window.__gameScene;
  return { value: window.__bgm.tensionLevel, hasSetter: typeof window.__bgm.setTension === 'function',
    round: s.waveSystem.round };
});
check('긴장도: 0~1 범위로 유지', tension.value >= 0 && tension.value <= 1 && tension.hasSetter,
  JSON.stringify(tension));

// ── (7) 음량 반영: BGM 음량이 재생 중인 사운드에 곱해진다
const volumeState = await page.evaluate(async () => {
  const s = window.__gameScene;
  s.soundSystem.setBgmVolume(0.32);
  s.soundSystem.setSfxVolume(0.44);
  await new Promise((r) => setTimeout(r, 250));
  const voice = window.__bgm.voices[0];
  return {
    soundVolume: Math.round((voice?.sound?.volume ?? -1) * 100) / 100,
    level: Math.round((voice?.level ?? 0) * 100) / 100,
    stored: JSON.parse(localStorage.getItem('movesword-settings-v1') || '{}'),
  };
});
check('음량: BGM 설정이 재생 중 트랙에 반영',
  Math.abs(volumeState.soundVolume - 0.32 * volumeState.level) < 0.02,
  JSON.stringify(volumeState));
check('음량: localStorage 저장 (bgm 0.32 / sfx 0.44)',
  volumeState.stored.bgmVolume === 0.32 && volumeState.stored.sfxVolume === 0.44,
  JSON.stringify(volumeState.stored));

// 음소거 토글 → BGM 음량 0
const muteState = await page.evaluate(async () => {
  const s = window.__gameScene;
  s.soundSystem.setMuted(true);
  await new Promise((r) => setTimeout(r, 250));
  return {
    muted: s.sound.mute,
    isMuted: s.soundSystem.isMuted(),
    stored: JSON.parse(localStorage.getItem('movesword-settings-v1') || '{}').muted,
    bgmVolume: window.__bgm.voices[0]?.sound?.volume ?? -1,
  };
});
check('음소거: 매니저·설정·BGM 음량 0', muteState.muted === true && muteState.isMuted === true
  && muteState.stored === true && muteState.bgmVolume === 0, JSON.stringify(muteState));

// ── (8) 새로고침 후에도 설정이 살아 있는가
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForFunction(() => !!window.__bgm, null, { timeout: 20000 });
await page.waitForTimeout(1200);
const persisted = await page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem('movesword-settings-v1') || '{}');
  return {
    stored,
    managerMuted: window.__bgm.manager.mute,
    track: window.__bgm.currentTrack,
  };
});
check('영속: 새로고침 후 음량 설정 유지',
  persisted.stored.bgmVolume === 0.32 && persisted.stored.sfxVolume === 0.44 && persisted.stored.muted === true,
  JSON.stringify(persisted.stored));
check('영속: 새로고침 후 음소거 상태 적용', persisted.managerMuted === true, JSON.stringify(persisted));
check('영속: 타이틀 복귀 시 title 트랙', persisted.track === 'title', String(persisted.track));

// 설정 원복 (다음 QA 오염 방지)
await page.evaluate(() => localStorage.removeItem('movesword-settings-v1'));

check('콘솔 예외 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
