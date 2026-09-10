// Headless QA: 2번째 키퍼(BASTION=엘레오노어 에셋) — 시트 배선·hurt·death 애니→게임오버 검증.
// Run: node eleonore-test.mjs (vite preview :5199, CHROME_BIN 환경변수로 chromium 경로 지정 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] };
if (process.env.CHROME_BIN) launchOpts.executablePath = process.env.CHROME_BIN;
if (process.env.CHROME_EXTRA_ARGS) launchOpts.args.push(...process.env.CHROME_EXTRA_ARGS.split(' '));
const browser = await chromium.launch(launchOpts);
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(err.message));
// BASTION 해금(누적 골드) 선주입
await page.addInitScript(() => {
  localStorage.setItem('movesword-meta-v1', JSON.stringify({ gold: 0, ranks: {}, characters: [], clearedDanger: -1, lifetimeGold: 99999, guaranteeCoins: 0 }));
});
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2200);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space'); // Title → CharacterSelect
await page.waitForTimeout(1200);

// BASTION 카드 선택 (dev 훅 — 실제 unlock 경로 handleCardClick 사용)
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 15000 });
const selected = await page.evaluate(() => {
  const sc = window.__charSelect;
  const card = sc.cards.find((c) => c.character.id === 'berserker');
  sc.handleCardClick(card.character);
  return sc.selectedId;
});
console.log('selected after card click:', selected);
if (selected !== 'berserker') { console.log('FAIL: card select'); await browser.close(); process.exit(1); }
await page.waitForTimeout(500);
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/qa_charselect.png` : 'qa_charselect.png' });
await page.keyboard.press('Space'); // DELVE
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(1800);

// 1) 배선 검증
const wiring = await page.evaluate(() => {
  const s = window.__gameScene;
  const tex = s.player.texture.key;
  const animsOk = ['eleonore-idle', 'eleonore-hurt', 'eleonore-death'].map((k) => [k, s.anims.exists(k)]);
  const death = s.anims.get('eleonore-death');
  const idleKey = s.player.anims.currentAnim?.key;
  const frameW = s.textures.get('eleonore-death-sheet').get(0).width;
  return { id: s.playerConfig.id, tex, animsOk, deathFrames: death?.frames?.length, deathRate: death?.frameRate, idleKey, frameW, tinted: s.player.tintTopLeft !== 0xffffff,
    displayW: s.player.displayWidth, bodyW: Math.round(s.player.body.width * 10) / 10, bodyH: Math.round(s.player.body.height * 10) / 10 };
});
console.log('wiring:', JSON.stringify(wiring));
let fail = 0;
const expect = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fail += 1; } else console.log('ok:', msg); };
expect(wiring.id === 'berserker', 'characterId=berserker');
expect(wiring.tex === 'eleonore-idle-sheet', `player texture=eleonore-idle-sheet (got ${wiring.tex})`);
expect(wiring.animsOk.every(([, v]) => v), 'eleonore anims registered');
expect(wiring.deathFrames === 12, `death frames=12 (got ${wiring.deathFrames})`);
expect(wiring.deathRate === 10, `death frameRate=10 (got ${wiring.deathRate})`);
expect(wiring.idleKey === 'eleonore-idle', `idle playing (got ${wiring.idleKey})`);
expect(wiring.frameW === 64, `frame width 64 (got ${wiring.frameW})`);
expect(!wiring.tinted, 'no legacy tint applied');
// 체감 크기 사용자 확정(2026-08-31): 표시폭 100 — ASH 링 포함 실루엣과 덩어리감 일치.
// 히트박스는 몸에 꼭 맞게(32x45 tex → 월드 50x70.3), 스프라이트 밖 피격 방지 우선.
expect(Math.abs(wiring.displayW - 100) < 0.5, `displayWidth 100 (got ${wiring.displayW})`);
expect(Math.abs(wiring.bodyW - 50) < 1, `body world width ~50 (got ${wiring.bodyW})`);
expect(Math.abs(wiring.bodyH - 70.3) < 1, `body world height ~70.3 (got ${wiring.bodyH})`);

// 2) hurt 애니
await page.evaluate(() => { const s = window.__gameScene; s.player.invulnerableUntil = 0; s.applyPlayerDamage(5, s.player.x + 20, s.player.y); });
await page.waitForTimeout(150);
const hurtKey = await page.evaluate(() => window.__gameScene.player.anims.currentAnim?.key);
expect(hurtKey === 'eleonore-hurt', `hurt anim plays (got ${hurtKey})`);
await page.waitForTimeout(800);
const backKey = await page.evaluate(() => window.__gameScene.player.anims.currentAnim?.key);
expect(backKey === 'eleonore-idle', `returns to idle after hurt (got ${backKey})`);

// 3) death → 게임오버 (ANIMATION_COMPLETE 경로, 폴백 1.5s 이전 완료 확인)
await page.evaluate(() => { const s = window.__gameScene; s.revivalsLeft = 0; s.player.hp = 1; s.player.invulnerableUntil = 0; s.applyPlayerDamage(999, s.player.x + 20, s.player.y); });
await page.waitForTimeout(400);
const deathState = await page.evaluate(() => {
  const s = window.__gameScene;
  return { isDead: s.player.isDead, key: s.player.anims.currentAnim?.key, frameIdx: s.player.anims.currentFrame?.index };
});
console.log('mid-death:', JSON.stringify(deathState));
expect(deathState.isDead, 'player isDead');
expect(deathState.key === 'eleonore-death', `death anim playing (got ${deathState.key})`);
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/qa_middeath.png` : 'qa_middeath.png' });
await page.waitForTimeout(1100); // 12f@10fps=1200ms — 400+1100=1500ms 시점
const over = await page.evaluate(() => ({ over: window.__gameScene.isGameOver, done: window.__gameScene.player.anims.currentFrame?.index }));
console.log('after death anim:', JSON.stringify(over));
expect(over.over === true, 'game over shown');
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/qa_gameover.png` : 'qa_gameover.png' });

const realErrors = errors.filter((e) => !/net::|Failed to fetch|fonts|ERR_/.test(e));
expect(realErrors.length === 0, `no page errors (got ${JSON.stringify(realErrors.slice(0, 3))})`);
await browser.close();
console.log(fail === 0 ? 'ELEONORE TEST PASS' : `ELEONORE TEST FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
