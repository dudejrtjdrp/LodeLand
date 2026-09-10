// ⚠️ 레거시: 이 테스트의 뒷부분(증강 선택 → **상점** 오픈)은 2026-09-01 대기마을 개편
// 이전 흐름이라 지금은 실패한다. 현재 흐름(클리어 → 여운 → 대기마을)은 village-flow-test.mjs 가 본다.
import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1200);

// Force round 9 objective completion -> WaveSystem.completeRound should open augment, then shop on close
const r = await page.evaluate(async () => {
  const s = window.__gameScene;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  s.waveSystem.round = 9;
  s.waveSystem.roundActive = true;
  s.waveSystem.objective = { type: 'kill-count', required: 0, label: 'test' };
  // 2026-09-06: 스폰 창 종료 + 잔당 전멸이 종료 조건 — 테스트는 지름길로 채운다
  s.waveSystem.skipToRoundEnd();
  s.waveSystem.killsThisRound = 1;
  // 클리어 → 여운(3초) → 증강 드래프트. 600ms 로는 여운이 안 끝난다.
  await wait(4200);
  const augOpen = s.augmentSystem.isOpen;
  const shopClosedDuringAug = !s.shopSystem.isOpen;
  // pick first card via key handler path
  const pool = s.augmentSystem.rollChoices(s.augmentSystem.tierPlan[0]);
  s.augmentSystem.selectAugment(pool[0]);
  await wait(400);
  const shopOpenAfter = s.shopSystem.isOpen;
  // close shop -> next round starts
  s.shopSystem.ui.build ? null : null;
  s.shopSystem.close();
  await wait(800);
  return { augOpen, shopClosedDuringAug, shopOpenAfter, roundNow: s.waveSystem.round, physicsRunning: !s.physics.world.isPaused };
});
await browser.close();
console.log(JSON.stringify(r), 'errors:', errors);
console.log(r.augOpen && r.shopClosedDuringAug && r.shopOpenAfter && r.roundNow === 10 && r.physicsRunning && errors.length === 0 ? 'FLOW TEST: PASS' : 'FLOW TEST: FAIL');
