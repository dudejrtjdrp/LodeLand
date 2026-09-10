// 조합 모달 개선(2026-08-31) 회귀 테스트
// 1) 스크롤 클리핑: 행 오브젝트에 GeometryMask 적용 (모달 밖으로 안 튀어나옴)
// 2) 정렬: 조합 가능 레시피가 목록 상단
// 3) 발견(discovered) 영속화: 조합 성공 → localStorage meta에 기록, 재료 없어도 레시피 공개
// 4) 검 정보/툴팁: recipeTextFor — 발견한 결과 검은 조합식 공개, 미발견은 ???
// 5) 재료/결과 아이콘 호버 툴팁
// 실행: vite 서버 띄운 뒤 `node reforge-modal-test.mjs` (PORT/CHROME_BIN/CHROME_ARGS 환경변수 지원)
import { chromium } from 'playwright';

const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const browser = await chromium.launch(exe ? { executablePath: exe, args } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !msg.text().includes('net::') && !msg.text().includes('Failed to load resource')) {
		errors.push(msg.text());
	}
});
const port = process.env.PORT || '5173';
await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });
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

const r = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const def = (id) => so.getDefinitionById(id);
	const reset = (equippedIds, reserveIds = []) => {
		for (const sw of [...so.swords]) so.removeSword(sw);
		so.minSwords = 0;
		so.reserve.length = 0;
		for (const id of equippedIds) so.addSword(s, def(id));
		for (const id of reserveIds) so.addToReserve(def(id));
	};
	const metaKey = 'movesword-meta-v1';
	const readMeta = () => JSON.parse(localStorage.getItem(metaKey) || '{}');
	// 발견 기록 초기화 (결정적 테스트)
	{
		const meta = readMeta();
		meta.discoveredRecipes = [];
		localStorage.setItem(metaKey, JSON.stringify(meta));
	}

	const out = { checks: {} };
	so.unlockedSlots = 7;
	s.pickupSystem.runGold = 5000;

	// ruby+gold → inferno 만 조합 가능하게 세팅
	reset(['ruby', 'gold']);
	shop.open?.(3);
	await wait(250);
	shop.ui.openModal('reforge');
	await wait(150);

	const ui = shop.ui;
	const rect = ui.reforgeContentRect;
	out.checks.modalOpen = ui.modalKind === 'reforge' && Boolean(rect);
	out.checks.rowsBuilt = ui.reforgeRowObjects.length > 0;

	// 1) 마스크 적용 + 컬링: 행 배경(높이 108)이 rect 밖으로 과도하게 나가지 않고 마스크가 있다
	const rowBgs = ui.reforgeRowObjects.filter((o) => o.type === 'NineSlice' && Math.round(o.displayHeight ?? 0) === 108);
	out.checks.rowBgCount = rowBgs.length;
	out.checks.allRowsMasked = rowBgs.length > 0 && rowBgs.every((o) => Boolean(o.mask));
	out.checks.cullingBounded = rowBgs.every((o) => o.y + 108 > rect.y - 2 && o.y < rect.y + rect.h + 2);

	// 2) 정렬: '조합하기'(ready) 버튼이 '재료 부족' 버튼들보다 위
	const texts = ui.reforgeRowObjects.filter((o) => o.type === 'Text');
	const readyYs = texts.filter((t) => t.text === '조합하기').map((t) => t.y);
	const notReadyYs = texts.filter((t) => t.text === '재료 부족').map((t) => t.y);
	out.checks.readyOnTop = readyYs.length === 1
		&& (notReadyYs.length === 0 || Math.max(...readyYs) < Math.min(...notReadyYs));

	// 미발견 레시피는 ??? 로 가려짐
	out.checks.hiddenAsQuestion = texts.some((t) => t.text === '???');

	// 3) 조합 실행 → 발견 기록
	const readyState = so.getReforgeStates().find((st) => st.ready);
	out.checks.readyIsInferno = readyState?.resultDefinition?.id === 'inferno';
	shop.reforgeRecipe(readyState.recipeIndex);
	await wait(250);
	out.checks.discoveredSaved = (readMeta().discoveredRecipes || []).includes('inferno');

	// 재료도 결과도 없는 상태에서 discovered 유지 확인
	reset(['steel']);
	shop.refresh();
	await wait(150);
	const infernoState = so.getReforgeStates().find((st) => st.resultDefinition?.id === 'inferno');
	out.checks.discoveredPersists = infernoState?.discovered === true && infernoState?.ready === false;

	// 발견한 레시피 행: ??? 대신 재료 이름 + '미보유' 표기
	const texts2 = ui.reforgeRowObjects.filter((o) => o.type === 'Text');
	out.checks.revealedIngredients = texts2.some((t) => t.text === (def('ruby')?.name ?? ''))
		&& texts2.some((t) => t.text === '미보유');
	// 발견한 결과 검 이름도 공개
	out.checks.revealedResult = texts2.some((t) => t.text === (def('inferno')?.name ?? ''));

	// 4) recipeTextFor
	out.checks.recipeTextDiscovered = String(ui.recipeTextFor(def('inferno'))).includes('+');
	const undiscovered = so.evolutionRecipes.find((rc) => !(readMeta().discoveredRecipes || []).includes(rc.result));
	out.checks.recipeTextHidden = undiscovered
		? String(ui.recipeTextFor(def(undiscovered.result))).startsWith('???')
		: true;
	out.checks.recipeTextNullForBase = ui.recipeTextFor(def('ruby')) === null;
	// describeSwordDefinition에 조합식 줄 포함
	out.checks.describeHasRecipe = ui.describeSwordDefinition(def('inferno')).includes('조합식:');

	// 스크롤 동작
	ui.scrollReforge(300);
	out.checks.scrollWorks = ui.reforgeScroll > 0;
	ui.scrollReforge(-9999);

	// 5) 호버 툴팁 좌표 계산 (첫 행 첫 재료 아이콘)
	const scale = ui.ui?.scale ?? 1;
	out.tooltipTarget = {
		x: (rect.x + 150 / 2 + 10) * scale,
		y: (rect.y + 42) * scale,
	};
	return out;
});

// 호버 툴팁 확인 (실제 마우스 이동)
await page.mouse.move(r.tooltipTarget.x, r.tooltipTarget.y);
await page.waitForTimeout(300);
// 2026-09-01: 상점 툴팁이 공용 Tooltip 컴포넌트(ui/tooltip.ts)로 통합됨 —
// 컨테이너 필드(ui.tooltip) 대신 컴포넌트의 isVisible 을 본다.
r.checks.hoverTooltip = await page.evaluate(() => window.__gameScene.shopSystem.ui.tooltipUi?.isVisible === true);
await page.mouse.move(10, 10);
await page.waitForTimeout(200);
r.checks.tooltipHides = await page.evaluate(() => window.__gameScene.shopSystem.ui.tooltipUi?.isVisible !== true);

await page.screenshot({ path: process.env.SHOT_PATH || '/tmp/reforge-modal.png' });

let pass = 0;
let fail = 0;
for (const [key, value] of Object.entries(r.checks)) {
	const ok = typeof value === 'number' ? value > 0 : value === true;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${key} = ${value}`);
	if (ok) pass += 1; else fail += 1;
}
if (errors.length) {
	console.log('ERRORS:', errors.slice(0, 5));
}
console.log(`\n${pass} pass / ${fail} fail`);
await browser.close();
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
