// 레벨업 카드 등장 애니메이션 레이스 회귀 테스트 (2026-09-06)
//
// 버그: 카드 4장이 시차(0/70/140/210ms)를 두고 y+40 → y, alpha 0 → 1 로 등장하는 동안
// 화살표를 누르면 setFocus 가 killTweensOf(container) 로 **등장 트윈까지** 죽여서
// 카드마다 다른 y 에서 얼어붙고 alpha 0.62 가 그대로 남았다 (정렬 깨짐 + 반투명 + 멈춤).
// 히트스톱이 tweens.timeScale 을 24배 늦추는 순간에 레벨업이 열리므로 창이 꽤 넓었다.
//
// 지금은 화살표가 들어오면 등장을 **즉시 완료**시키고(finishEntrance), scale 은
// setCardScale 하나만 소유한다. 이 테스트는 그 상태를 고정한다.
//
// Run: (vite preview --port 5199) && node levelup-race-test.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
	// 샌드박스/오프라인에서는 웹폰트가 안 받아져서 리소스 오류가 뜬다 — 게임 오류가 아니다
	if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) {
		errors.push(msg.text());
	}
});

await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 60000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(700);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 30000 });
await page.waitForTimeout(1200);

const checks = [];
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info }); };

// 등장 한복판(마지막 카드가 아직 delay 중)에 화살표 연타
await page.evaluate(() => { window.__gameScene.levelUpSystem.enqueue(); });
await page.waitForFunction(() => window.__gameScene.levelUpSystem.isOpen, null, { timeout: 5000 });
await page.waitForTimeout(90);
for (let i = 0; i < 6; i += 1) {
	await page.keyboard.press('ArrowRight');
}
await page.waitForTimeout(700);

const cards = await page.evaluate(() => window.__gameScene.levelUpSystem.cards.map((c) => ({
	y: Math.round(c.container.y),
	home: Math.round(c.homeY),
	alpha: Number(c.container.alpha.toFixed(2)),
	scaleX: Number(c.container.scaleX.toFixed(3)),
	entranceAlive: !!c.entrance,
})));

check('카드 4장이 모두 제자리 y (정렬 깨짐 없음)',
	cards.length === 4 && cards.every((c) => Math.abs(c.y - c.home) <= 1),
	JSON.stringify(cards.map((c) => c.y - c.home)));
check('멈춘 등장 트윈이 남아 있지 않다', cards.every((c) => !c.entranceAlive));
check('포커스 1장만 알파 1, 나머지 0.62 (반투명 잔류 없음)',
	cards.filter((c) => c.alpha === 1).length === 1
	&& cards.filter((c) => Math.abs(c.alpha - 0.62) < 0.01).length === 3,
	JSON.stringify(cards.map((c) => c.alpha)));
check('포커스 1장만 확대 (scale 소유자 단일)',
	cards.filter((c) => c.scaleX > 1.02).length === 1,
	JSON.stringify(cards.map((c) => c.scaleX)));

await page.screenshot({ path: `${outDir}/levelup-after-arrow.png` });

await page.keyboard.press('1');
await page.waitForTimeout(500);
check('선택하면 패널이 닫힌다', !(await page.evaluate(() => window.__gameScene.levelUpSystem.isOpen)));
check('페이지/콘솔 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

for (const c of checks) {
	console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info ? `  — ${c.info}` : ''}`);
}
const passed = checks.filter((c) => c.ok).length;
console.log(`${passed}/${checks.length} 통과`);
console.log(`LEVELUP-RACE TEST: ${passed === checks.length ? 'PASS' : 'FAIL'}`);

await browser.close();
// 테스트 강제종료 규약 — 남은 핸들이 있어도 매달리지 않는다
process.exit(passed === checks.length ? 0 : 1);
