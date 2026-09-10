// 검 소실/조합 회귀 테스트 (2026-08-25 개편 후)
// 1) 무손실 불변식: 레시피 재료를 보유한 상태를 포함해, 장착/교환/해제 어떤 조작도
//    자동 융합 없이 총 검 수(장착+ROOST)를 보존해야 한다.
// 2) 명시적 REFORGE: getReforgeStates가 ???(미보유) 게이팅 정보를 주고,
//    reforge(index)만이 재료 2자루를 소모해 결과 검을 지급한다 (총 -1).
// 3) REFORGE 배너는 상점 UI 위(depth 2500)에 떠야 한다.
// 실행: vite dev(5173) 띄운 뒤 `node sword-loss-test.mjs`
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
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

const r = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const total = () => so.swords.length + so.reserve.length;
	const def = (id) => so.getDefinitionById(id);
	const reset = (equippedIds, reserveIds) => {
		for (const sw of [...so.swords]) so.removeSword(sw);
		so.minSwords = 0;
		so.reserve.length = 0;
		for (const id of equippedIds) so.addSword(s, def(id));
		for (const id of reserveIds) so.addToReserve(def(id));
	};

	so.unlockedSlots = 4;
	s.shopSystem.open?.(1);
	await wait(200);

	// --- 1) 무손실 불변식 — ruby+gold(레시피 재료)를 들고도 이동/교환/해제는 절대 융합·소실 없음
	reset(['ruby', 'emerald', 'obsidian', 'steel'], ['gold']);
	const startTotal = total(); // 5
	let invariantOk = true;
	so.equipFromReserve(0, 3); // gold를 steel 자리에 → ruby+gold 동시 장착 (과거엔 여기서 자동 융합)
	if (total() !== startTotal) invariantOk = false;
	const noAutoFusion = !so.swords.some((sw) => sw.definition?.id === 'inferno');
	for (let i = 0; i < 300 && invariantOk; i++) {
		const op = Math.floor(Math.random() * 3);
		if (op === 0 && so.reserve.length) so.equipFromReserve(Math.floor(Math.random() * so.reserve.length), Math.floor(Math.random() * 4));
		else if (op === 1) so.swapSlots(Math.floor(Math.random() * 4), Math.floor(Math.random() * 4));
		else so.unequipToReserve(Math.floor(Math.random() * 4));
		if (total() !== startTotal) invariantOk = false;
	}

	// --- 2) ??? 게이팅 + 명시적 reforge
	reset(['ruby', 'emerald'], ['gold']); // 레시피1(ruby+gold)만 ready, 2·3은 재료 부족
	const states = so.getReforgeStates();
	const gatingOk = states[0].ready === true
		&& states[1].ready === false && states[2].ready === false
		&& states[1].ingredients.some((ing) => !ing.owned);
	const beforeReforge = total(); // 3
	const reforged = so.reforge(0);
	await wait(200);
	const afterReforge = total(); // 2 (재료 2 소모, 결과 1)
	const gotResult = so.swords.some((sw) => sw.definition?.id === 'inferno')
		|| so.reserve.some((entry) => entry.definition?.id === 'inferno');
	const failClosed = so.reforge(1) === false; // 재료 부족 레시피는 거부

	// --- 3) 배너 가시성 (상점 dim 2300 위)
	const bannerAboveShop = s.children.list.some((o) => o.type === 'Container' && o.depth === 2500
		&& o.list?.some((child) => typeof child.text === 'string' && child.text.includes('조합')));

	return { startTotal, invariantOk, noAutoFusion, gatingOk, beforeReforge, reforged, afterReforge, gotResult, failClosed, bannerAboveShop };
});
await browser.close();
console.log(JSON.stringify(r), 'errors:', errors);
const pass = r.invariantOk && r.noAutoFusion && r.gatingOk && r.reforged && r.beforeReforge === 3 && r.afterReforge === 2
	&& r.gotResult && r.failClosed && r.bannerAboveShop && errors.length === 0;
console.log(pass ? 'SWORD LOSS TEST: PASS' : 'SWORD LOSS TEST: FAIL');
