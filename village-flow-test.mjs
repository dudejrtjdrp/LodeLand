// 대기마을·특성 상성·보스바·재도전 회귀 테스트 (2026-08-31 신설).
// 검증: (1) 적 특성 원소 상성 배율 (2) CC 면역 플래그 (3) 상단 보스 HP바
//       (4) 라운드 클리어 3초 여운 → 대기마을 (5) 대장간/게이트 상호작용 → 다음 라운드 + 테마
//       (6) 사망 → '라운드 N 재도전' → 마을 복귀(라운드 시작 시점)
// Run: node village-flow-test.mjs  (vite preview :5197 필요, PORT env 로 변경 가능)
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
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2400); // 라운드 1 입장 연출이 걷히길 기다린다

// ── (1) 특성 상성: venomous(불 +40% / 독 -50%) — 저항 무시 피해로 순수 배율 측정
const traitProbe = await page.evaluate(() => {
  const s = window.__gameScene;
  // 프로브 몹이 죽으면 경험치 정산 → 레벨업 카드가 마을 흐름을 가로막는다 — 못 죽게 HP를 올린다
  const spawn = (id) => {
    const e = s.enemyManager.spawnEnemy(s, s.player, id, { x: s.player.x + 400, y: s.player.y + 400 });
    e.maxHp = 50000;
    e.hp = 50000;
    return e;
  };
  const hit = (enemy, element) => {
    const before = enemy.hp;
    s.enemyManager.takeDamage(enemy, 100, s.player, { ignoreResist: true, silent: true, element });
    return before - enemy.hp;
  };
  const a = spawn('venom-slime');
  const b = spawn('venom-slime');
  const c = spawn('venom-slime');
  const fire = hit(a, 'fire');
  const poison = hit(b, 'poison');
  const plain = hit(c, undefined);
  const blinker = spawn('blinker');
  const charger = spawn('charger');
  const slimeking = spawn('mb-slimeking');
  s.enemyManager.applyDot(slimeking, 10, 2000);
  return {
    fire, poison, plain,
    blinkerSlowImmune: blinker.slowImmune === true,
    chargerKnockback: charger.knockbackResist,
    kingDotImmune: (slimeking.dotDps ?? 0) === 0,
    traitIds: a.traitIds,
  };
});
check('특성: 불 약점 +40%', Math.abs(traitProbe.fire - 140) <= 2, `fire=${traitProbe.fire}`);
check('특성: 독 저항 -50%', Math.abs(traitProbe.poison - 50) <= 2, `poison=${traitProbe.poison}`);
check('특성: 무원소 = 기본', Math.abs(traitProbe.plain - 100) <= 2, `plain=${traitProbe.plain}`);
check('특성: 미끄러운 몸 감속 면역', traitProbe.blinkerSlowImmune);
check('특성: 굳은 심지 넉백 면역', traitProbe.chargerKnockback >= 1, `kb=${traitProbe.chargerKnockback}`);
check('특성: 막힌 핏줄 지속피해 면역', traitProbe.kingDotImmune);

// ── (2) 상단 보스바
const bossProbe = await page.evaluate(async () => {
  const s = window.__gameScene;
  s.enemyManager.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 500, y: s.player.y });
  return new Promise((resolve) => {
    setTimeout(() => {
      s.bossBar.update();
      setTimeout(() => {
        const rows = s.bossBar.rows ?? [];
        resolve({ rows: rows.length, name: rows[0]?.nameText?.text ?? '' });
      }, 260);
    }, 260);
  });
});
check('보스바: 상단 1줄 표시', bossProbe.rows === 1, `rows=${bossProbe.rows} name=${bossProbe.name}`);

// 필드 정리 (다음 단계 오염 방지)
await page.evaluate(() => {
  const s = window.__gameScene;
  s.enemyManager.clearField();
  for (const e of s.enemyManager.enemies.getChildren()) {
    if (e.active) s.enemyManager.recycleEnemy?.(e);
  }
});

// ── (3) 라운드 클리어 → 3초 여운 → 대기마을
await page.evaluate(() => {
  const s = window.__gameScene;
  s.waveSystem.objective = { type: 'kill-count', required: 0, label: '테스트' };
  // 2026-09-06: 라운드는 목표 달성 + 스폰 창(40초) 종료 + 잔당 전멸이라야 끝난다.
  // 여기서 보려는 것은 "클리어 → 여운 → 마을" 흐름이므로 지름길로 조건을 채운다.
  s.waveSystem.skipToRoundEnd();
});
await page.waitForTimeout(700);
const midIntermission = await page.evaluate(() => ({
  pending: window.__gameScene.waveSystem.pendingIntermission,
  village: window.__gameScene.villageSystem.isActive,
}));
check('여운: 클리어 직후 마을 아직 아님', midIntermission.pending === true && midIntermission.village === false,
  JSON.stringify(midIntermission));
await page.waitForFunction(() => window.__gameScene.villageSystem.isActive, null, { timeout: 8000 });
check('마을: 3초 후 입장', true);
await page.waitForTimeout(1200);

const villageProbe = await page.evaluate(() => {
  const s = window.__gameScene;
  return {
    nextRound: s.villageSystem.nextRound,
    waveHudHidden: s.waveSystem.hudG.visible === false,
    enemiesAlive: s.enemyManager.enemies.getChildren().filter((e) => e.active).length,
    levelUpOpen: s.levelUpSystem.isOpen,
  };
});
check('마을: 레벨업 오버레이 없음', villageProbe.levelUpOpen === false);
check('마을: 다음 라운드 번호', villageProbe.nextRound === 2, `next=${villageProbe.nextRound}`);
check('마을: 웨이브 HUD 숨김', villageProbe.waveHudHidden);
check('마을: 적 스폰 없음', villageProbe.enemiesAlive === 0, `alive=${villageProbe.enemiesAlive}`);

// ── (4) 대장간 상호작용 → 상점 열림/닫힘 → 마을 유지
await page.evaluate(() => {
  const s = window.__gameScene;
  const smith = s.villageSystem.stalls?.find?.((st) => st.id === 'smith')
    ?? { x: s.scale.width / 2 - 310, y: s.scale.height / 2 - 20 };
  s.player.setPosition(smith.x, smith.y + 10);
  s.player.body?.reset(smith.x, smith.y + 10);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
const smithOpen = await page.evaluate(() => window.__gameScene.villageSystem.activeWindow?.kind ?? null);
check('대장간: E → 전용 창 열림', smithOpen === 'smith', String(smithOpen));
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const afterShop = await page.evaluate(() => ({
  window: window.__gameScene.villageSystem.windowOpen,
  paused: window.__gameScene.isPaused,
  village: window.__gameScene.villageSystem.isActive,
}));
check('대장간: ESC → 마을 복귀', afterShop.window === false && afterShop.paused === false && afterShop.village === true,
  JSON.stringify(afterShop));

// ── (5) 게이트: 정찰 보고 → 출발 → 라운드 2 + 테마 적용
await page.evaluate(() => {
  const s = window.__gameScene;
  const gate = s.villageSystem.stalls.find((st) => st.id === 'gate');
  s.player.setPosition(gate.x, gate.y + 40);
  s.player.body?.reset(gate.x, gate.y + 40);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
const scoutOpen = await page.evaluate(() => window.__gameScene.villageSystem.scoutOpen);
check('게이트: E → 정찰 보고 열림', scoutOpen === true);
const expectedTheme = await page.evaluate(() => window.__gameScene.waveSystem.getRoundIntel(2).theme.id);
await page.keyboard.press('Space');
await page.waitForTimeout(2600);
const afterDepart = await page.evaluate(() => ({
  village: window.__gameScene.villageSystem.isActive,
  round: window.__gameScene.waveSystem.round,
  active: window.__gameScene.waveSystem.roundActive,
  theme: window.__gameScene.currentTheme.id,
}));
check('게이트: 출발 → 라운드 2 시작', afterDepart.village === false && afterDepart.round === 2 && afterDepart.active === true,
  JSON.stringify(afterDepart));
check('게이트: 라운드 2 테마 적용', afterDepart.theme === expectedTheme, `${afterDepart.theme} vs ${expectedTheme}`);
await page.waitForTimeout(2200); // 입장 연출 종료 대기

// ── (6) 사망 → 재도전 → 마을(라운드 시작 시점) 복귀
await page.evaluate(() => {
  const s = window.__gameScene;
  s.revivalsLeft = 0;
  s.player.maxHp = 30;
  s.player.hp = 30;
});
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const dead = await page.evaluate(() => {
    const s = window.__gameScene;
    if (!s.isGameOver && s.player && !s.player.isDead) {
      s.player.invulnerableUntil = 0;
      s.applyPlayerDamage(15, s.player.x + 20, s.player.y, 'physical', '테스트');
    }
    return s.isGameOver;
  });
  if (dead) break;
  await page.waitForTimeout(250);
}
check('사망: 게임오버 도달', await page.evaluate(() => window.__gameScene.isGameOver));
await page.waitForTimeout(1600);
const retryPos = await page.evaluate(() => {
  const s = window.__gameScene;
  let found = null;
  const visit = (obj) => {
    if (found) return;
    if (typeof obj.text === 'string' && obj.text.includes('재도전') && obj.parentContainer) {
      const m = obj.parentContainer.getWorldTransformMatrix();
      found = { x: m.tx, y: m.ty, text: obj.text };
      return;
    }
    if (obj.list) obj.list.forEach(visit);
  };
  s.children.list.forEach(visit);
  return found;
});
check('재도전: 버튼 존재', Boolean(retryPos), retryPos?.text ?? '');
if (retryPos) {
  await page.mouse.move(retryPos.x, retryPos.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForFunction(() => window.__gameScene && !window.__gameScene.isGameOver, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const afterRetry = await page.evaluate(() => ({
    village: window.__gameScene.villageSystem.isActive,
    waveRound: window.__gameScene.waveSystem.round,
    nextRound: window.__gameScene.villageSystem.nextRound,
    gold: window.__gameScene.pickupSystem.runGold,
  }));
  check('재도전: 마을에서 재시작 (라운드 시작 시점)', afterRetry.village === true && afterRetry.nextRound === 2,
    JSON.stringify(afterRetry));
}

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
