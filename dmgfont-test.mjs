// 데미지 숫자 비트맵 폰트 QA: 숫자·치명타·색상·한글 폴백이 모두 제대로 그려지는지 확인.
// Run: node dmgfont-test.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });

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

const out = await page.evaluate(() => {
  const s = window.__gameScene;
  const ve = s.visualEffects;
  const p = s.player;
  // 적/스폰을 멈춰 화면을 깨끗하게
  s.enemyManager.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
  for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);

  // 모든 표기 종류를 한 화면에 뿌린다
  const cases = [
    [120, -140, 1234, false, null],        // 일반 물리
    [-120, -140, 999, true, null],         // 치명타 (짚쇠 + 큼)
    [120, -60, 42, false, '#93c5fd'],      // 마법
    [-120, -60, 77, false, '#fde047'],     // 저항 무시
    [120, 20, '+15', false, null],         // 회복 표기
    [-120, 20, '회피', false, '#94a3b8'],   // 한글 → Text 폴백
    [120, 100, '방어', false, '#38bdf8'],   // 한글 → Text 폴백
    [-120, 100, '처형!', true, null],       // 한글+기호 → Text 폴백
  ];
  for (const [dx, dy, dmg, crit, color] of cases) {
    ve.showDamageText(p.x + dx, p.y + dy, dmg, crit, color);
  }

  // 내부 상태 확인: 숫자는 BitmapText 경로로, 한글은 Text 경로로 갔는가
  return {
    bitmapCount: ve.floatingBitmaps?.length ?? -1,
    textCount: ve.floatingTexts?.length ?? -1,
    fontRegistered: s.cache.bitmapFont.exists('damage-font-0'),
    fontTexture: s.textures.exists('damage-font-tex'),
  };
});

await page.waitForTimeout(250);
await page.screenshot({ path: `${outDir}/dmgfont.png` });
await browser.close();
console.log(JSON.stringify(out, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
const pass = out.fontRegistered && out.fontTexture
  && out.bitmapCount === 5 && out.textCount === 3 && errors.length === 0;
console.log(pass ? 'DAMAGE FONT TEST: PASS' : 'DAMAGE FONT TEST: FAIL');
