// 상점/장비 화면 개편(2026-08-28) 회귀 테스트
// 1) 검 자리 7개(안쪽 3 + 바깥 4) UI + 각인의 검 귀속(이동/해제/재장착에도 유지)
// 2) 각인 조건: 검 레벨 3부터, 최대 3개
// 3) 판매: 보관함/장착 검 판매 시 골드 환급(구매가의 50%), 마지막 검 판매 거부
// 4) 조합 부분 계승: 레벨은 높은 쪽, 각인은 절반(올림, 최대 3)
// 5) 세이브 v2: loadout/reserve에 traits 저장
// 6) 3개 뷰포트 스크린샷 (겹침 QA용) → /tmp/shopqa-<w>x<h>.png
// 실행: vite dev(5173) 띄운 뒤 `node shop-screen-test.mjs`
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !msg.text().includes('net::') && !msg.text().includes('Failed to load resource')) {
		errors.push(msg.text());
	}
});
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

	const out = { checks: {} };

	so.unlockedSlots = 7;
	s.pickupSystem.runGold = 5000;
	shop.open?.(3);
	await wait(250);

	// 1) 자리 7개 UI
	out.checks.maxSwords7 = so.maxSwords === 7;
	out.checks.slotButtons7 = shop.ui.slotButtons.length === 7;

	// 1b) 각인은 검 귀속 — 교환/해제/재장착에도 검을 따라간다
	reset(['ruby', 'emerald']);
	so.swords[0].traits = ['flame-sigil', 'titan-sigil'];
	so.recalculateSwordStats(so.swords[0]);
	so.swapSlots(0, 1);
	const rubyAfterSwap = so.swords.find((sw) => sw.definition.id === 'ruby');
	out.checks.traitsFollowSwap = rubyAfterSwap?.traits?.length === 2;
	const rubyIndex = so.swords.indexOf(rubyAfterSwap);
	so.unequipToReserve(rubyIndex);
	const reserveEntry = so.reserve.find((entry) => entry.definition.id === 'ruby');
	out.checks.traitsFollowUnequip = reserveEntry?.traits?.length === 2;
	so.equipFromReserve(so.reserve.indexOf(reserveEntry), 1);
	const rubyBack = so.swords.find((sw) => sw.definition.id === 'ruby');
	out.checks.traitsFollowReequip = rubyBack?.traits?.length === 2;
	// 자리 옮겨도 traitMods(피해 +20% 거인 각인)가 붙는지
	out.checks.traitModsApplied = (rubyBack?.traitMods?.damageMult ?? 0) > 0;

	// 2) 각인 조건: 검 레벨 3부터
	reset(['steel']);
	const steelIndex = 0;
	out.checks.traitGateLv1 = so.canAddTrait(steelIndex) === false;
	so.swords[steelIndex].level = 3;
	out.checks.traitGateLv3 = so.canAddTrait(steelIndex) === true;
	const pulled = so.pullTrait(steelIndex);
	out.checks.pullAddsToSword = Boolean(pulled) && so.swords[steelIndex].traits.length === 1;

	// 3) 판매
	reset(['ruby', 'steel'], ['gold']);
	const goldBefore = shop.getGold();
	const reservePrice = shop.sellPrice(so.reserve[0].definition, so.reserve[0].level);
	shop.sellReserve(0);
	out.checks.sellReserve = shop.getGold() === goldBefore + reservePrice && so.reserve.length === 0;
	const equippedPrice = shop.sellPrice(so.swords[1].definition, so.swords[1].level);
	const goldBefore2 = shop.getGold();
	shop.sellEquipped(1);
	out.checks.sellEquipped = shop.getGold() === goldBefore2 + equippedPrice && so.swords.length === 1;
	so.minSwords = 1;
	out.checks.lastSwordGuard = shop.sellEquipped(0) === false && so.swords.length === 1;
	so.minSwords = 0;

	// 4) 조합 부분 계승 (ruby+gold → inferno): 각인 3개 풀 → ceil(3/2)=2개 계승
	reset(['ruby'], ['gold']);
	so.swords[0].traits = ['flame-sigil', 'titan-sigil'];
	so.swords[0].level = 4;
	so.reserve[0].traits = ['ruin-sigil'];
	so.reserve[0].level = 2;
	so.reforge(0);
	await wait(150);
	const inferno = so.swords.find((sw) => sw.definition.id === 'inferno')
		?? so.reserve.find((entry) => entry.definition.id === 'inferno');
	const infernoTraits = inferno?.traits ?? [];
	const pool = ['flame-sigil', 'titan-sigil', 'ruin-sigil'];
	out.checks.reforgeLevel = (inferno?.level ?? 0) === 4;
	out.checks.reforgeTraitsHalf = infernoTraits.length === 2 && infernoTraits.every((id) => pool.includes(id));

	// 5) 세이브 v2 라운드트립 (shop.close가 RunSave.save 호출)
	reset(['ruby'], []);
	so.swords[0].traits = ['flame-sigil'];
	shop.close();
	await wait(150);
	let saved = null;
	try { saved = JSON.parse(localStorage.getItem('movesword-run-v1')); } catch { /* noop */ }
	out.checks.saveV2 = saved?.version === 2;
	out.checks.saveTraits = Array.isArray(saved?.orbit?.loadout?.[0]?.traits) && saved.orbit.loadout[0].traits.includes('flame-sigil');

	// 6) UI 텍스트 — 쉬운 한국어 라벨 존재
	shop.open?.(3);
	await wait(250);
	const texts = [];
	const walk = (node) => {
		if (typeof node?.text === 'string') texts.push(node.text);
		if (Array.isArray(node?.list)) node.list.forEach(walk);
	};
	s.children.list.forEach(walk);
	const joined = texts.join('|');
	// 2026-09-02 통합 화면: 좌측 제목이 '검 상점' → '검 구매' 로 바뀌고 원소 필터 칩이 붙었다
	out.checks.koreanLabels = ['검 구매', '보관함', '강화', '각인', '판매', '장착하기', '내 검'].every((word) => joined.includes(word));
	out.checks.elementFilterChips = ['전체', '무속성', '불', '공허', '황금'].every((word) => joined.includes(word));
	out.checks.noAugmentButton = !texts.some((t) => t.trim() === '증강');
	out.checks.noJargon = !['PERCH', 'ROOST', 'TEMPER', 'SIGIL', 'ARSENAL', 'WORKSHOP'].some((word) => joined.includes(word));

	out.allPass = Object.values(out.checks).every(Boolean);
	return out;
});

console.log(JSON.stringify(r, null, 1));

// 7) 보관함 내 위치 교환 — API + 실제 포인터 드래그
const cellCenters = await page.evaluate(() => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const def = (id) => so.getDefinitionById(id);
	for (const sw of [...so.swords]) so.removeSword(sw);
	so.minSwords = 0;
	so.reserve.length = 0;
	so.addSword(s, def('ruby'));
	so.addToReserve(def('steel'), 2, ['gale-sigil']);
	so.addToReserve(def('bronze'), 1, []);
	so.addToReserve(def('rusty'), 1, []);
	shop.refresh();

	// API 검증: 교환 + 빈 칸 이동 + 선택 추적
	const out = {};
	shop.selectedReserve = 0;
	shop.moveReserve(0, 2); // steel ↔ rusty 교환
	out.swapOk = so.reserve[0].definition.id === 'rusty' && so.reserve[2].definition.id === 'steel';
	out.selectionFollows = shop.selectedReserve === 2;
	shop.moveReserve(0, 10); // 빈 칸 → 맨 뒤로
	out.moveToEmptyOk = so.reserve[2].definition.id === 'rusty' && so.reserve.length === 3;
	shop.selectedReserve = null;
	shop.refresh();

	// 실제 드래그용 스크린 좌표 (셀 0과 셀 1) — 등급 섹션 헤더가 줄을 밀므로 invCellPos 사용
	const ui = shop.ui;
	const grid = ui.invGrid;
	const scale = ui.ui.scale;
	const canvas = s.game.canvas.getBoundingClientRect();
	const center = (cellIndex) => {
		const pos = ui.invCellPos[cellIndex];
		return {
			x: canvas.x + (pos.x + grid.cell / 2) * scale,
			y: canvas.y + (grid.y + pos.y - ui.invScroll + grid.cell / 2 - 4) * scale,
		};
	};
	return { out, from: center(0), to: center(1), ids: so.reserve.map((e) => e.definition.id) };
});

await page.mouse.move(cellCenters.from.x, cellCenters.from.y);
await page.mouse.down();
// dragDistanceThreshold(8px)를 넘도록 여러 스텝으로 이동
await page.mouse.move((cellCenters.from.x + cellCenters.to.x) / 2, cellCenters.from.y, { steps: 6 });
await page.mouse.move(cellCenters.to.x, cellCenters.to.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);

const dragResult = await page.evaluate((before) => {
	const so = window.__gameScene.swordOrbit;
	const ids = so.reserve.map((e) => e.definition.id);
	return {
		ids,
		dragSwapOk: ids[0] === before[1] && ids[1] === before[0] && ids.length === before.length,
		traitsIntact: so.reserve.find((e) => e.definition.id === 'steel')?.traits?.length === 1,
	};
}, cellCenters.ids);

const r7 = { ...cellCenters.out, ...dragResult };
console.log('reorder:', JSON.stringify(r7));
const reorderPass = r7.swapOk && r7.selectionFollows && r7.moveToEmptyOk && r7.dragSwapOk && r7.traitsIntact;

// 7-2) 장착 자리끼리 실제 포인터 드래그로 위치 교환 (2026-08-28 회귀:
// 슬롯 히트 영역이 아이콘을 덮거나 pointerdown 선택이 refresh로 아이콘을
// 파괴하면 드래그가 시작되지 않는다)
const slotDragSetup = await page.evaluate(() => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	// 자리 0·1을 서로 다른 검으로 확보 (앞 단계에서 판매/해제로 1자루만 남았을 수 있다)
	while (so.swords.length < 2 && so.reserve.length > 0) {
		so.equipFromReserve(0, so.swords.length);
	}
	shop.refresh();
	const beforeIds = so.swords.map((sw) => sw.definition.id);
	const ui = shop.ui;
	const scale = ui.ui.scale;
	const canvas = s.game.canvas.getBoundingClientRect();
	const slotCenter = (i) => ({
		x: canvas.x + ui.slotButtons[i].x * scale,
		y: canvas.y + (ui.slotButtons[i].y - 4) * scale,
	});
	return { beforeIds, from: slotCenter(0), to: slotCenter(1) };
});
await page.mouse.move(slotDragSetup.from.x, slotDragSetup.from.y);
await page.mouse.down();
await page.mouse.move((slotDragSetup.from.x + slotDragSetup.to.x) / 2, (slotDragSetup.from.y + slotDragSetup.to.y) / 2, { steps: 6 });
await page.mouse.move(slotDragSetup.to.x, slotDragSetup.to.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);
const slotDragResult = await page.evaluate((before) => {
	const so = window.__gameScene.swordOrbit;
	const ids = so.swords.map((sw) => sw.definition.id);
	return {
		slotIds: ids,
		slotDragSwapOk: ids[0] === before[1] && ids[1] === before[0] && ids.length === before.length,
	};
}, slotDragSetup.beforeIds);
console.log('slotDrag:', JSON.stringify(slotDragResult));

// 스크린샷 3개 뷰포트 (겹침 육안 QA)
for (const [w, h] of [[1280, 720], [1512, 982], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(400);
	await page.evaluate(async () => {
		const s = window.__gameScene;
		if (s.shopSystem.isOpen) { s.shopSystem.destroyUi(); s.shopSystem.isOpen = false; }
		s.shopSystem.open(3);
	});
	await page.waitForTimeout(500);
	await page.screenshot({ path: `/tmp/shopqa-${w}x${h}.png` });
}

await browser.close();
console.log('errors:', errors);
console.log(r.allPass && reorderPass && slotDragResult.slotDragSwapOk && errors.length === 0 ? 'SHOP SCREEN TEST: PASS' : 'SHOP SCREEN TEST: FAIL');
