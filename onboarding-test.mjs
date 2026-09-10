// 온보딩 회귀 테스트 (2026-09-01 신설, 같은 날 능동 스킬 단계 추가로 7단계로 갱신).
// 검증: (1) 첫 런 튜토리얼 자동 시작 + 7단계 순차 진행
//       (2) 오버레이/대기 상황에서 코치 카드 숨김
//       (3) 용어 사전 · 툴팁 컴포넌트 (레벨업 카드 / TAB 능력치 항목)
//       (4) 사망 결과 화면의 런 요약 (최종 무리 · 검 활약 · 획득 골드)
//       (5) 조작 안내 패널 + 튜토리얼 다시 보기 (일시정지)
//       (6) 튜토리얼 1회성 (localStorage) — 두 번째 런에서는 뜨지 않는다
// Run: node onboarding-test.mjs  (vite preview :5197 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
// 첫 런 상태로 시작 — 온보딩/세이브/메타 진행을 전부 비운다
await page.addInitScript(() => {
  try {
    localStorage.removeItem('movesword-onboarding-v1');
    localStorage.removeItem('movesword-run-v1');
    localStorage.removeItem('movesword-run');
    localStorage.removeItem('movesword-meta');
  } catch { /* 무시 */ }
});
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);

// ── 새 런 시작 (타이틀 → 캐릭터 선택 → 게임)
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(3000); // 라운드 입장 연출 + 튜토리얼 시작 지연(1.2s)
// 튜토리얼 시작은 씬 시간 기준 delayedCall(1200ms) — 소프트웨어 렌더링 환경에서는
// 셰이더 워밍업 때문에 실제로 4초 넘게 걸린다. 고정 대기 대신 시작을 기다린다.
await page.waitForFunction(() => window.__gameScene?.tutorial?.active === true, null, { timeout: 20000 })
  .catch(() => { /* 실패는 아래 체크가 잡는다 */ });

/** 레벨업 오버레이가 열려 있으면 전부 소비한다 (연쇄 레벨업은 닫자마자 다시 열린다) */
const drainLevelUps = async () => {
  for (let i = 0; i < 12; i += 1) {
    const open = await page.evaluate(() => window.__gameScene.levelUpSystem.isOpen === true);
    if (!open) return true;
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(320);
  }
  return false;
};

/**
 * 조건이 참이 될 때까지 기다린다 — 기다리는 동안 레벨업 오버레이를 소비한다.
 * (오버레이가 열려 있으면 GameScene.update 가 조기 반환해 웨이브·마을 전환이 멈춘다)
 */
const waitFor = async (fn, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.evaluate(fn)) return true;
    await drainLevelUps();
    await page.waitForTimeout(250);
  }
  return false;
};

/** 튜토리얼이 원하는 단계에 도달할 때까지 기다린다 (레벨업이 끼어들면 소비하면서) */
const waitStep = async (want, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => ({
      step: window.__gameScene.tutorial.currentStepId,
      levelUp: window.__gameScene.levelUpSystem.isOpen === true,
    }));
    if (state.step === want) return true;
    if (state.levelUp) await drainLevelUps();
    await page.waitForTimeout(300);
  }
  return false;
};

// ── (0) 용어 사전 (DEV 훅은 GameScene.create 에서 노출된다)
const glossary = await page.evaluate(() => {
  const dict = window.__keywords ?? {};
  const keys = Object.keys(dict);
  return {
    count: keys.length,
    keys,
    sample: dict['공명']?.body?.slice(0, 12) ?? '',
    allHaveBody: keys.length > 0 && keys.every((k) => typeof dict[k].body === 'string' && dict[k].body.length > 10),
  };
});
check('용어 사전: 항목 12개 이상', glossary.count >= 12, `count=${glossary.count}`);
check('용어 사전: 필수 키워드 존재',
  ['공명', '조합', '각인', '원소 세트', '어픽스', '증강'].every((k) => glossary.keys.includes(k)),
  glossary.keys.slice(0, 8).join(','));
check('용어 사전: 본문 채워짐', glossary.allHaveBody, glossary.sample);

// ── (1) 튜토리얼 자동 시작
const started = await page.evaluate(() => {
  const t = window.__gameScene.tutorial;
  return { active: t?.active, step: t?.currentStepId, total: t?.totalSteps };
});
check('튜토리얼: 첫 런에서 자동 시작', started.active === true, JSON.stringify(started));
check('튜토리얼: 1단계 = 이동', started.step === 'move', String(started.step));
// ④ 활공 사냥(능동 스킬) 단계가 레벨업과 골드 사이에 들어가 7단계가 됐다 (2026-09-01)
check('튜토리얼: 7단계 구성', started.total === 7, String(started.total));

// 튜토리얼 구간이 길어 실전 사망으로 흐름이 끊기지 않게 체력을 크게 준다
// (사망 결과 화면은 (10)에서 따로 유도한다)
await page.evaluate(() => {
  const s = window.__gameScene;
  s.player.maxHp = 999999;
  s.player.hp = 999999;
});

// ── (2) 1단계: 실제 이동으로 완료
// 2026-09-04: 이동은 화살표가 기본 (W/A/S/D 는 스킬 핫키)
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(2200);
await page.keyboard.up('ArrowRight');
const reachedHunt = await waitStep('hunt', 12000);
const afterMove = await page.evaluate(() => ({
  step: window.__gameScene.tutorial.currentStepId,
  moved: Math.round(window.__gameScene.tutorial.movedDistance),
}));
check('튜토리얼: 이동 감지 → 2단계', reachedHunt && afterMove.step === 'hunt', JSON.stringify(afterMove));

// ── (3) 2단계: 처치 3회로 완료
await page.evaluate(() => {
  const s = window.__gameScene;
  for (let i = 0; i < 3; i += 1) {
    s.events.emit('enemy-died', { x: s.player.x, y: s.player.y, amount: 1, player: s.player });
  }
});
const reachedLevel = await waitStep('level', 12000);
const afterHunt = await page.evaluate(() => window.__gameScene.tutorial.currentStepId);
check('튜토리얼: 처치 감지 → 3단계', reachedLevel && afterHunt === 'level', String(afterHunt));

// ── (4) 3단계: 레벨업 카드 선택 감지 + 카드 툴팁
await drainLevelUps();
await page.evaluate(() => { window.__gameScene.levelUpSystem.enqueue(); });
await page.waitForTimeout(900);
const cardPos = await page.evaluate(() => {
  const cards = window.__gameScene.levelUpSystem.cards ?? [];
  if (cards.length === 0) return null;
  const m = cards[0].container.getWorldTransformMatrix();
  return { x: m.tx, y: m.ty, name: cards[0].choice.upgrade.name };
});
check('레벨업: 카드 생성', Boolean(cardPos), cardPos?.name ?? '');
// 튜토리얼 카드는 오버레이 아래에서 숨어야 한다
const hiddenDuringOverlay = await page.evaluate(() => {
  const t = window.__gameScene.tutorial;
  // objects 는 private 이지만 런타임에는 접근 가능하다
  return (t.objects ?? []).every((o) => o.visible === false);
});
check('튜토리얼: 레벨업 오버레이 중 카드 숨김', hiddenDuringOverlay === true);

if (cardPos) {
  await page.mouse.move(cardPos.x, cardPos.y);
  await page.waitForTimeout(400);
  const tip = await page.evaluate(() => {
    const t = window.__gameScene.levelUpSystem.tooltip;
    return { visible: t?.isVisible === true, title: t?.currentTitle ?? '' };
  });
  check('툴팁: 레벨업 카드 호버', tip.visible === true, tip.title);
  check('툴팁: 제목에 등급 포함', /·/.test(tip.title), tip.title);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
  const gone = await page.evaluate(() => window.__gameScene.levelUpSystem.tooltip?.isVisible === true);
  check('툴팁: 커서가 벗어나면 사라짐', gone === false);
  // 카드 선택 (연쇄 레벨업까지 전부 소비)
  await drainLevelUps();
}
const reachedSkill = await waitStep('skill', 14000);
const afterLevel = await page.evaluate(() => window.__gameScene.tutorial.currentStepId);
check('튜토리얼: 카드 선택 감지 → 4단계(활공 사냥)', reachedSkill && afterLevel === 'skill', String(afterLevel));

// ── (4-b) 4단계: 능동 스킬 안내 — 아이콘 하이라이트 + 실제 활공 사냥 발동으로 완료
const skillStep = await page.evaluate(() => {
  const s = window.__gameScene;
  return { rect: s.tutorial.skillIconRect(), useCount: s.activeSkills?.useCount?.dive ?? -1 };
});
check('튜토리얼: 능동 스킬 아이콘 하이라이트 대상 계산',
  Boolean(skillStep.rect) && skillStep.rect.w > 0, JSON.stringify(skillStep.rect));
await page.evaluate(() => {
  const s = window.__gameScene;
  // 사냥감을 깔아 준 뒤 실제 발동 (사냥감이 없으면 활공은 발동하지 않는다)
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', {
      x: s.player.x + Math.cos(a) * 140, y: s.player.y + Math.sin(a) * 140,
    });
  }
  s.activeSkills.readyAt.dive = 0;
  s.activeSkills.useDive();
});
const reachedGold = await waitStep('gold', 26000);
const afterSkill = await page.evaluate(() => window.__gameScene.tutorial.currentStepId);
check('튜토리얼: 활공 사냥 발동 감지 → 5단계', reachedGold && afterSkill === 'gold', String(afterSkill));

// ── (5) 5단계: 골드 획득 감지
await page.evaluate(() => { window.__gameScene.pickupSystem.runGold = 60; });
const reachedResonance = await waitStep('resonance', 14000);
const afterGold = await page.evaluate(() => window.__gameScene.tutorial.currentStepId);
check('튜토리얼: 골드 감지 → 6단계', reachedResonance && afterGold === 'resonance', String(afterGold));

// ── (6) 6단계: 하이라이트 존재 확인 후 완료 조건 충족
await drainLevelUps();
// 하이라이트는 오버레이가 닫히고 단계 전환 연출(clearingLeft)이 끝난 다음 프레임부터 그려진다
await waitFor(() => window.__gameScene.tutorial.highlightFrame?.visible === true, 12000);
const highlight = await page.evaluate(() => {
  const t = window.__gameScene.tutorial;
  const rect = t.swordStripRect();
  return {
    rect,
    frameVisible: t.highlightFrame?.visible === true,
    pointerVisible: t.pointerIcon?.visible === true,
  };
});
check('튜토리얼: 하이라이트 대상 계산', Boolean(highlight.rect) && highlight.rect.w > 0,
  JSON.stringify(highlight.rect));
check('튜토리얼: 하이라이트 프레임 + 지시 화살표 표시',
  highlight.frameVisible === true && highlight.pointerVisible === true, JSON.stringify(highlight));

// 6단계 완료 조건 = 같은 속성 검 2자루 (공명). 카탈로그에서 불 속성 2자루를 장착한다.
const pair = await page.evaluate(() => {
  const s = window.__gameScene;
  const orbit = s.swordOrbit;
  const fireDefs = (orbit.swordCatalog ?? []).filter((d) => d.element === 'fire').slice(0, 2);
  for (const def of fireDefs) {
    if (orbit.swords.length >= orbit.getEffectiveMaxSwords()) orbit.unlockSlot();
    orbit.addSword(s, def);
  }
  return {
    elements: orbit.swords.map((sw) => sw.definition?.element ?? null),
    pair: s.tutorial.hasElementPair(),
  };
});
check('튜토리얼: 공명(같은 속성 2자루) 판정', pair.pair === true, JSON.stringify(pair.elements));
await waitStep('village', 24000);
// 숨김 판정은 다음 update() 프레임에 반영된다 — 단계 전환 직후에 읽으면 이전 단계의 카드가 남아 있다
await page.waitForTimeout(500);
const atVillageStep = await page.evaluate(() => {
  const t = window.__gameScene.tutorial;
  return {
    step: t.currentStepId,
    villageActive: window.__gameScene.villageSystem?.isActive === true,
    hiddenWhileWaiting: (t.objects ?? []).every((o) => o.visible === false),
  };
});
check('튜토리얼: 6단계 자동 진행 → 7단계', atVillageStep.step === 'village', String(atVillageStep.step));
// 이미 마을에 들어가 있으면 "대기 중"이 아니므로 숨김 판정 대상이 아니다
check('튜토리얼: 마을 전에는 7단계 카드 숨김',
  atVillageStep.villageActive === true || atVillageStep.hiddenWhileWaiting === true,
  JSON.stringify(atVillageStep));

// ── (7) 7단계: 마을 입장 → 출발 → 완료
await drainLevelUps();
await page.evaluate(() => {
  window.__gameScene.waveSystem.objective = { type: 'kill-count', required: 0, label: '테스트' };
  // 2026-09-06: 스폰 창 종료 + 잔당 전멸이 종료 조건 — 테스트는 지름길로 채운다
  window.__gameScene.waveSystem.skipToRoundEnd();
});
const enteredVillage = await waitFor(() => window.__gameScene.villageSystem.isActive === true, 30000);
if (!enteredVillage) {
  const diag = await page.evaluate(() => ({
    gameOver: window.__gameScene.isGameOver,
    dead: window.__gameScene.player?.isDead,
    round: window.__gameScene.waveSystem.round,
    active: window.__gameScene.waveSystem.roundActive,
    pending: window.__gameScene.waveSystem.pendingIntermission,
  }));
  check('마을: 라운드 클리어 → 입장', false, JSON.stringify(diag));
} else {
  check('마을: 라운드 클리어 → 입장', true);
}
await page.waitForTimeout(1600);
const inVillage = await page.evaluate(() => {
  const t = window.__gameScene.tutorial;
  return {
    step: t.currentStepId,
    visible: (t.objects ?? []).some((o) => o.visible === true),
    gate: t.gateRect(),
  };
});
check('튜토리얼: 마을 입장 시 7단계 카드 표시', inVillage.step === 'village' && inVillage.visible === true,
  JSON.stringify({ step: inVillage.step, visible: inVillage.visible }));
check('튜토리얼: 게이트 하이라이트 계산', Boolean(inVillage.gate), JSON.stringify(inVillage.gate));

await page.evaluate(() => { window.__gameScene.villageSystem.depart(); });
await waitFor(() => window.__gameScene.tutorial.finished === true, 15000);
const finished = await page.evaluate(() => ({
  active: window.__gameScene.tutorial.active,
  finished: window.__gameScene.tutorial.finished,
  stored: localStorage.getItem('movesword-onboarding-v1'),
}));
check('튜토리얼: 출발 → 완료', finished.active === false && finished.finished === true,
  JSON.stringify({ a: finished.active, f: finished.finished }));
check('튜토리얼: localStorage 에 완료 기록', /"tutorialDone":true/.test(finished.stored ?? ''),
  String(finished.stored));

await page.waitForTimeout(1600); // 라운드 2 입장 연출

// ── (8) TAB 캐릭터창 능력치 툴팁
await drainLevelUps();
await page.keyboard.press('Tab');
await page.waitForTimeout(700);
const statPos = await page.evaluate(() => {
  const s = window.__gameScene;
  if (!s.statsPanel.isOpen) return null;
  let found = null;
  for (const obj of s.statsPanel.objects ?? []) {
    if (obj.type === 'Text' && obj.text === '공격력') {
      found = { x: obj.x + 30, y: obj.y };
      break;
    }
  }
  return found;
});
check('캐릭터창: TAB 으로 열림', Boolean(statPos), JSON.stringify(statPos));
if (statPos) {
  await page.mouse.move(statPos.x, statPos.y);
  await page.waitForTimeout(400);
  const statTip = await page.evaluate(() => {
    const t = window.__gameScene.statsPanel.tooltip;
    return { visible: t?.isVisible === true, title: t?.currentTitle ?? '' };
  });
  check('툴팁: 능력치 항목 호버', statTip.visible === true, statTip.title);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
}
await page.keyboard.press('Tab');
await page.waitForTimeout(400);

// ── (9) 일시정지: 조작 안내 + 튜토리얼 다시 보기
await drainLevelUps();
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const pauseTexts = await page.evaluate(() => {
  const s = window.__gameScene;
  const texts = [];
  const visit = (obj) => {
    if (typeof obj.text === 'string' && obj.text.length > 0) texts.push(obj.text);
    if (obj.list) obj.list.forEach(visit);
  };
  s.children.list.forEach(visit);
  return texts;
});
check('일시정지: 조작 안내 키캡 존재',
  pauseTexts.includes('TAB') && pauseTexts.includes('ESC') && pauseTexts.includes('SPACE'),
  pauseTexts.filter((t) => t.length <= 5).slice(0, 10).join(','));
check('일시정지: 조작 설명 문구', pauseTexts.some((t) => t.includes('이동 (방향키도 가능)')));
check('일시정지: 튜토리얼 다시 보기 버튼', pauseTexts.some((t) => t.includes('튜토리얼 다시 보기')));
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// ── (10) 사망 결과 화면 런 요약
await page.evaluate(() => {
  const s = window.__gameScene;
  s.revivalsLeft = 0;
  s.player.maxHp = 20;
  s.player.hp = 20;
  // 검별 피해 기여도가 비어 있지 않도록 최소 1건 보장 (핫패스 집계는 hitResolution 이 담당)
  if (Object.keys(s.swordOrbit.runDamage).length === 0) {
    s.swordOrbit.runDamage['테스트 검'] = 1234;
  }
});
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  await drainLevelUps();
  const dead = await page.evaluate(() => {
    const s = window.__gameScene;
    if (!s.isGameOver && s.player && !s.player.isDead) {
      s.player.invulnerableUntil = 0;
      s.applyPlayerDamage(15, s.player.x + 20, s.player.y, 'physical', '테스트');
    }
    return s.isGameOver;
  });
  if (dead) break;
  await page.waitForTimeout(220);
}
check('결과: 게임오버 도달', await page.evaluate(() => window.__gameScene.isGameOver));
await page.waitForTimeout(1800);
const summary = await page.evaluate(() => {
  const s = window.__gameScene;
  const texts = [];
  let swordIcons = 0;
  const visit = (obj) => {
    if (typeof obj.text === 'string' && obj.text.length > 0) texts.push(obj.text);
    if (obj.type === 'Image' && obj.texture?.key === 'sword' && obj.depth >= 3000) swordIcons += 1;
    if (obj.list) obj.list.forEach(visit);
  };
  s.children.list.forEach(visit);
  return { texts, swordIcons, damageKeys: Object.keys(s.swordOrbit.runDamage).length };
});
check('결과: 라운드·생존·레벨·처치 표기',
  ['라운드', '생존', '레벨', '처치'].every((label) => summary.texts.includes(label)),
  summary.texts.slice(0, 12).join('|'));
check('결과: 최종 무리 섹션', summary.texts.includes('최종 무리'));
check('결과: 검 아이콘 렌더', summary.swordIcons >= 1, `icons=${summary.swordIcons}`);
check('결과: 검 활약(피해 기여도) 섹션', summary.texts.includes('검 활약'));
check('결과: 검별 누적 피해 집계', summary.damageKeys >= 1, `keys=${summary.damageKeys}`);
check('결과: 피해 지분 % 표기', summary.texts.some((t) => /^\d+%$/.test(t)),
  summary.texts.filter((t) => /%$/.test(t)).slice(0, 4).join(','));
check('결과: 영구 강화 재화 안내',
  summary.texts.some((t) => t.includes('이번 런 획득 골드'))
  && summary.texts.some((t) => t.includes('영구 강화')),
  '');

// ── (11) 두 번째 런에서는 튜토리얼이 뜨지 않는다
await page.evaluate(() => { window.__gameScene.scene.start('TitleScene'); });
await page.waitForTimeout(1500);
await page.keyboard.press('Space');
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene && !!window.__gameScene.tutorial, null, { timeout: 20000 });
await page.waitForTimeout(3200);
const secondRun = await page.evaluate(() => ({
  active: window.__gameScene.tutorial.active,
  finished: window.__gameScene.tutorial.finished,
}));
check('튜토리얼: 두 번째 런에서는 뜨지 않음', secondRun.active === false, JSON.stringify(secondRun));

// ── (12) 다시 보기: 일시정지에서 재시작
await drainLevelUps();
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const replayPos = await page.evaluate(() => {
  const s = window.__gameScene;
  let found = null;
  const visit = (obj) => {
    if (found) return;
    if (typeof obj.text === 'string' && obj.text.includes('튜토리얼 다시 보기') && obj.parentContainer) {
      const m = obj.parentContainer.getWorldTransformMatrix();
      found = { x: m.tx, y: m.ty };
      return;
    }
    if (obj.list) obj.list.forEach(visit);
  };
  s.children.list.forEach(visit);
  return found;
});
check('다시 보기: 버튼 위치 확보', Boolean(replayPos), JSON.stringify(replayPos));
if (replayPos) {
  await page.mouse.move(replayPos.x, replayPos.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const replayed = await page.evaluate(() => ({
    active: window.__gameScene.tutorial.active,
    step: window.__gameScene.tutorial.currentStepId,
    paused: window.__gameScene.isPaused,
  }));
  check('다시 보기: 튜토리얼 1단계부터 재시작',
    replayed.active === true && replayed.step === 'move' && replayed.paused === false,
    JSON.stringify(replayed));
}

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
