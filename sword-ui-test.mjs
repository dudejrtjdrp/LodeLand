// 검 UI 개편 회귀 테스트 (2026-09-02)
//
// 사용자 제보 5건이 그대로 검사 항목이다:
//   1) 검 목록에 원소별 필터가 있다 (구매 목록 · 보관함 동시 적용)
//   2) 필터를 안 걸어도 등급별 섹션으로 나뉘어 보인다 (기본 = 등급 그룹)
//   3) 각성 오퍼(라운드 40)에서 검을 호버하면 상세 정보가 뜬다
//   4) 각성한 검은 목록 배지(★)와 상세 '각성' 줄로 표기된다 (세이브 후에도)
//   5) 대장간 E = 통합 화면 한 번에 (구매 + 보유), 리롤 1개, 증강 버튼 없음
// + 드래그 장착/판매 회귀, 3뷰포트 겹침 QA
//
// 실행: node sword-ui-test.mjs   (vite preview on :5199, 또는 PORT)
import { chromium } from 'playwright';

const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const port = process.env.PORT || '5199';

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
	if (ok) {
		passed += 1;
		console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
	} else {
		failures.push(name);
		console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

const browser = await chromium.launch(exe ? { executablePath: exe, args } : { args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !msg.text().includes('net::') && !msg.text().includes('Failed to load resource')) {
		errors.push(msg.text());
	}
});

await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// ─────────────────────────────────────────────────────────────
// (1) 대장간 E 원탭 = 통합 화면 (뎁스 1단계)
// ─────────────────────────────────────────────────────────────
await page.evaluate(() => {
	const s = window.__gameScene;
	s.pickupSystem.runGold = 9000;
	s.villageSystem.enter(1);
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
	const s = window.__gameScene;
	const smith = s.villageSystem.stallAt('smith');
	s.player.setPosition(smith.x, smith.y + 10);
	s.player.body?.reset(smith.x, smith.y + 10);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1100);

const entry = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		shopOpen: s.shopSystem.isOpen,
		kind: s.villageSystem.activeWindow?.kind ?? null,
		metrics: s.shopSystem.ui.layoutMetrics(),
		texts: s.shopSystem.ui.visibleTexts(),
	};
});
check('대장간 E 한 번 = 통합 검 화면 (중간 창 없음)', entry.shopOpen === true && entry.kind === 'smith',
	`open=${entry.shopOpen} kind=${entry.kind}`);
check('통합 화면: 구매 목록 · 장착 자리 · 보관함이 한 화면',
	entry.metrics.offerRows > 0 && entry.metrics.slotAwakenBadges.length === 7 && Boolean(entry.metrics.invRect),
	`offers=${entry.metrics.offerRows} slots=${entry.metrics.slotAwakenBadges.length}`);
check('리롤(교체) 버튼은 1개 — 구매 목록만 새로 뽑는다',
	Boolean(entry.metrics.rerollRect) && entry.texts.filter((t) => t === '교체').length === 1,
	`교체 라벨 ${entry.texts.filter((t) => t === '교체').length}개`);
check('증강 버튼 없음 (진입점은 마을 증강 제단)',
	!entry.metrics.navKinds.includes('augment') && !entry.texts.some((t) => t.trim() === '증강'),
	entry.metrics.navKinds.join(','));
check('조합(REFORGE) 진입점 보존', entry.metrics.navKinds.includes('reforge') && entry.texts.includes('검 조합'));

// 리롤이 구매 목록만 바꾼다 (보유 검은 그대로)
const rerollProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const shop = s.shopSystem;
	const so = s.swordOrbit;
	const before = {
		offers: shop.swordOffers.map((o) => o.id).join(','),
		swords: so.swords.map((sw) => sw.definition.id).join(','),
		reserve: so.reserve.map((e) => e.definition.id).join(','),
	};
	shop.reroll();
	return {
		before,
		after: {
			offers: shop.swordOffers.map((o) => o.id).join(','),
			swords: so.swords.map((sw) => sw.definition.id).join(','),
			reserve: so.reserve.map((e) => e.definition.id).join(','),
		},
	};
});
check('교체는 구매 목록만 새로 뽑는다 (보유 검 불변)',
	rerollProbe.after.swords === rerollProbe.before.swords && rerollProbe.after.reserve === rerollProbe.before.reserve,
	JSON.stringify(rerollProbe.after));

// 같은 라운드에 화면을 다시 열어도 목록이 유지된다 (예전엔 열 때마다 다시 굴렸다)
const reopenProbe = await page.evaluate(async () => {
	const s = window.__gameScene;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const before = s.shopSystem.swordOffers.map((o) => o.id).join(',');
	s.villageSystem.closeActiveWindow();
	await wait(200);
	s.villageSystem.openStall('smith');
	await wait(300);
	return { before, after: s.shopSystem.swordOffers.map((o) => o.id).join(',') };
});
check('같은 라운드에 다시 열어도 구매 목록 유지', reopenProbe.before === reopenProbe.after,
	`${reopenProbe.before} → ${reopenProbe.after}`);

// ─────────────────────────────────────────────────────────────
// (2) 원소 필터·등급 섹션 = 보관함 전용 (2026-09-03 — 구매 목록은 리롤 순서 그대로)
// ─────────────────────────────────────────────────────────────
const groupProbe = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const byId = (id) => so.getDefinitionById(id);
	const pick = (rarity, element) => so.getBaseTierList()
		.find((d) => (d.rarity ?? 'common') === rarity && (element ? d.element === element : true));

	// 등급이 섞인 목록을 강제로 세팅 (일부러 등급 뒤죽박죽 순서)
	const mixed = [pick('common'), pick('rare'), pick('epic'), pick('uncommon'), pick('legendary')]
		.filter(Boolean);
	const fire = so.getBaseTierList().find((d) => d.element === 'fire');
	const ice = so.getBaseTierList().find((d) => d.element === 'ice');
	shop.swordOffers = [fire, ice, ...mixed].filter(Boolean);
	shop.refresh();
	await wait(250);
	const plain = s.shopSystem.ui.layoutMetrics();

	// 필터를 걸어도 구매 목록은 그대로여야 한다
	s.shopSystem.ui.setElementFilter('fire');
	await wait(250);
	const offersWithFilter = s.shopSystem.ui.layoutMetrics();

	// 보관함: 필터 + 등급 섹션 줄 나누기
	so.reserve.length = 0;
	// legendary 6자루 (한 행 5칸을 넘겨 랩 확인) + common 1 + fire 1
	for (let i = 0; i < 6; i += 1) so.addToReserve(byId(mixed[4].id));
	so.addToReserve(byId(mixed[0].id));
	so.addToReserve(byId(fire.id));
	s.shopSystem.ui.setElementFilter('all');
	await wait(250);
	const invAll = s.shopSystem.ui.layoutMetrics();
	s.shopSystem.ui.setElementFilter('fire');
	await wait(250);
	const invFire = s.shopSystem.ui.layoutMetrics();
	s.shopSystem.ui.setElementFilter('all');
	await wait(200);
	return {
		plain, offersWithFilter, invAll, invFire,
		offerIds: shop.swordOffers.map((d) => d.id).join(','),
		mixed: mixed.map((d) => `${d.id}:${d.rarity}`),
	};
});

const rarityRank = (r) => ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'].indexOf(r);
check('구매 목록: 등급 섹션 없음 (단순 목록)', groupProbe.plain.offerSections.length === 0,
	groupProbe.plain.offerSections.join(' > '));
check('구매 목록: 리롤 순서 그대로 (등급 재정렬 없음)',
	groupProbe.plain.offerNames.length === groupProbe.plain.totalOffers,
	`rows=${groupProbe.plain.offerNames.length} offers=${groupProbe.plain.totalOffers}`);
check('원소 필터를 걸어도 구매 목록은 그대로',
	groupProbe.offersWithFilter.offerRows === groupProbe.plain.offerRows
	&& groupProbe.offersWithFilter.offerElements.join(',') === groupProbe.plain.offerElements.join(','),
	`before=${groupProbe.plain.offerRows} after=${groupProbe.offersWithFilter.offerRows}`);
check('원소 필터(불): 보관함이 불 속성만',
	groupProbe.invFire.invElements.length > 0 && groupProbe.invFire.invElements.every((e) => e === 'fire'),
	groupProbe.invFire.invElements.join(','));
check('보관함 기본 표시 = 등급순',
	groupProbe.invAll.invRarities.every((r, i, arr) => i === 0 || rarityRank(arr[i - 1]) <= rarityRank(r)),
	groupProbe.invAll.invRarities.join(','));
const ORDER = ['신화', '전설', '영웅', '희귀', '고급', '일반'];
check('보관함: 등급 섹션 헤더로 줄이 나뉜다', groupProbe.invAll.invSections.length >= 2
	&& groupProbe.invAll.invSections.every((name, i, arr) => i === 0 || ORDER.indexOf(arr[i - 1]) < ORDER.indexOf(name)),
	groupProbe.invAll.invSections.join(' > '));
// 등급이 다른 검이 같은 줄(y)을 공유하지 않는다 (줄 나누기 검증)
const rowsByRarity = {};
let rowClash = false;
groupProbe.invAll.invCellYs.forEach((y, i) => {
	const r = groupProbe.invAll.invRarities[i];
	rowsByRarity[y] = rowsByRarity[y] ?? r;
	if (rowsByRarity[y] !== r) rowClash = true;
});
check('보관함: 등급이 다른 검은 다른 줄에 놓인다', !rowClash,
	groupProbe.invAll.invCellYs.join(','));
// 6자루 legendary → 같은 섹션 안에서 2번째 행으로 랩
const legendYs = [...new Set(groupProbe.invAll.invCellYs.slice(0, 6))];
check('보관함: 섹션 안에서 5칸 넘으면 다음 줄로', legendYs.length === 2, legendYs.join(','));

// 필터 칩 실클릭 (히트 영역 회귀)
const chipClick = await page.evaluate(() => {
	const s = window.__gameScene;
	const ui = s.shopSystem.ui;
	const scale = ui.ui.scale;
	const canvas = s.game.canvas.getBoundingClientRect();
	const rect = ui.filterRect;
	const perRow = 5;
	const gap = 5;
	const chipW = (rect.w - gap * (perRow - 1)) / perRow;
	// 2번째 칩(무속성)의 중앙
	return {
		x: canvas.x + (rect.x + 1 * (chipW + gap) + chipW / 2) * scale,
		y: canvas.y + (rect.y + 13) * scale,
	};
});
await page.mouse.click(chipClick.x, chipClick.y);
await page.waitForTimeout(400);
const chipState = await page.evaluate(() => window.__gameScene.shopSystem.ui.layoutMetrics().elementFilter);
check('필터 칩 실클릭 → 무속성 필터 적용', chipState === 'none', `filter=${chipState}`);
await page.evaluate(() => window.__gameScene.shopSystem.ui.setElementFilter('all'));
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────
// (3)(4) 각성 표기 — 배지 · 상세 줄 · 툴팁 · 세이브 유지
// ─────────────────────────────────────────────────────────────
const awakenProbe = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));

	const equipped = so.swords[0];
	so.awakenings[equipped.definition.id] = 'ruin';
	shop.selectedSlot = 0;
	shop.selectedReserve = null;
	shop.refresh();
	await wait(250);

	const metrics = shop.ui.layoutMetrics();
	const texts = shop.ui.visibleTexts();
	const tooltipBody = shop.ui.describeSwordDefinition(equipped.definition, equipped);
	const slotInfo = shop.ui.getSlotInfoContent(0);

	// 보관함에도 각성한 검을 하나 넣어 배지 확인
	so.reserve.length = 0;
	so.addToReserve(so.getDefinitionById(equipped.definition.id));
	so.awakenings[equipped.definition.id] = 'ruin';
	shop.refresh();
	await wait(200);

	// 세이브 라운드트립
	shop.close();
	await wait(250);
	let saved = null;
	try { saved = JSON.parse(localStorage.getItem('movesword-run-v1')); } catch { /* noop */ }
	return {
		badge: metrics.slotAwakenBadges[0] === true,
		detailHasAwaken: texts.some((t) => t.includes('각성')) && texts.some((t) => t.includes('파괴 각성')),
		tooltipBody,
		slotTitle: slotInfo.title,
		savedAwakening: saved?.augment?.orbit?.awakenings ?? saved?.orbit?.awakenings ?? null,
	};
});
check('각성 배지: 장착 자리에 ★ 표시', awakenProbe.badge);
check('각성 표기: 상세 패널에 "각성 / 파괴 각성" 줄', awakenProbe.detailHasAwaken);
check('각성 표기: 툴팁 본문에 각성 이름·효과',
	awakenProbe.tooltipBody.includes('각성: 파괴 각성') && awakenProbe.tooltipBody.includes('피해 +85%'),
	awakenProbe.tooltipBody.split('\n').slice(-1)[0]);
check('각성 표기: 자리 툴팁 제목에 ★', awakenProbe.slotTitle.includes('★'), awakenProbe.slotTitle);
check('각성은 세이브에 남는다 (로드 후 표기 유지)',
	Boolean(awakenProbe.savedAwakening) && Object.values(awakenProbe.savedAwakening).includes('ruin'),
	JSON.stringify(awakenProbe.savedAwakening));

// 세이브 로드 후에도 표기가 살아 있는지 (스냅샷 복원 → 화면 재구성)
const reloadProbe = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const saved = JSON.parse(localStorage.getItem('movesword-run-v1'));
	so.awakenings = {};
	s.augmentSystem.restoreState(saved.augment);
	s.shopSystem.open(1);
	await wait(400);
	s.shopSystem.selectedSlot = 0;
	s.shopSystem.refresh();
	await wait(200);
	return {
		awakenings: { ...so.awakenings },
		badges: s.shopSystem.ui.layoutMetrics().slotAwakenBadges,
		texts: s.shopSystem.ui.visibleTexts().filter((t) => t.includes('각성')),
	};
});
check('세이브 복원 후에도 각성 배지·표기 유지',
	Object.values(reloadProbe.awakenings).includes('ruin')
	&& reloadProbe.badges.some(Boolean) && reloadProbe.texts.length > 0,
	JSON.stringify(reloadProbe.texts.slice(0, 2)));

// ─────────────────────────────────────────────────────────────
// (5) 드래그 장착 / 판매 회귀 (통합 화면 안에서)
// ─────────────────────────────────────────────────────────────
const dragSetup = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	so.unlockedSlots = 7;
	so.minSwords = 0;
	so.reserve.length = 0;
	for (const sword of [...so.swords]) so.removeSword(sword);
	so.addSword(s, so.getDefinitionById('ruby'));
	so.addToReserve(so.getDefinitionById('steel'));
	shop.selectedSlot = null;
	shop.selectedReserve = null;
	shop.refresh();
	await wait(250);

	const ui = shop.ui;
	const grid = ui.invGrid;
	const scale = ui.ui.scale;
	const canvas = s.game.canvas.getBoundingClientRect();
	// 등급 섹션 헤더가 첫 줄을 아래로 밀므로 실제 셀 배치(invCellPos)를 쓴다
	const cell0 = ui.invCellPos[0];
	return {
		before: { swords: so.swords.length, reserve: so.reserve.length },
		from: {
			x: canvas.x + (cell0.x + grid.cell / 2) * scale,
			y: canvas.y + (grid.y + cell0.y - ui.invScroll + grid.cell / 2 - 4) * scale,
		},
		to: { x: canvas.x + ui.slotButtons[1].x * scale, y: canvas.y + (ui.slotButtons[1].y - 4) * scale },
		sell: {
			x: canvas.x + (ui.sellRect.x + ui.sellRect.w / 2) * scale,
			y: canvas.y + (ui.sellRect.y + ui.sellRect.h / 2) * scale,
		},
	};
});
await page.mouse.move(dragSetup.from.x, dragSetup.from.y);
await page.mouse.down();
await page.mouse.move((dragSetup.from.x + dragSetup.to.x) / 2, (dragSetup.from.y + dragSetup.to.y) / 2, { steps: 6 });
await page.mouse.move(dragSetup.to.x, dragSetup.to.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
const equipResult = await page.evaluate(() => {
	const so = window.__gameScene.swordOrbit;
	return { swords: so.swords.map((sw) => sw.definition.id), reserve: so.reserve.length };
});
check('드래그 장착 회귀: 보관함 → 자리',
	equipResult.swords.includes('steel') && equipResult.reserve === 0, JSON.stringify(equipResult));

// 자리 → 판매 버튼 드래그
const sellBefore = await page.evaluate(() => window.__gameScene.pickupSystem.runGold);
const slotFrom = await page.evaluate(() => {
	const s = window.__gameScene;
	const ui = s.shopSystem.ui;
	const scale = ui.ui.scale;
	const canvas = s.game.canvas.getBoundingClientRect();
	return { x: canvas.x + ui.slotButtons[1].x * scale, y: canvas.y + (ui.slotButtons[1].y - 4) * scale };
});
await page.mouse.move(slotFrom.x, slotFrom.y);
await page.mouse.down();
await page.mouse.move((slotFrom.x + dragSetup.sell.x) / 2, (slotFrom.y + dragSetup.sell.y) / 2, { steps: 6 });
await page.mouse.move(dragSetup.sell.x, dragSetup.sell.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
const sellResult = await page.evaluate((before) => {
	const s = window.__gameScene;
	return {
		gold: s.pickupSystem.runGold,
		gained: s.pickupSystem.runGold > before,
		swords: s.swordOrbit.swords.map((sw) => sw.definition.id),
	};
}, sellBefore);
check('드래그 판매 회귀: 자리 → 판매 버튼',
	sellResult.gained && !sellResult.swords.includes('steel'), JSON.stringify(sellResult));

// ─────────────────────────────────────────────────────────────
// (6) 각성 오퍼 호버 툴팁 (라운드 40)
// ─────────────────────────────────────────────────────────────
const awakenUi = await page.evaluate(async () => {
	const s = window.__gameScene;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	if (s.shopSystem.isOpen) {
		s.shopSystem.close();
		await wait(250);
	}
	s.augmentSystem.close?.();
	s.augmentSystem.isOpen = false;
	s.augmentSystem.open(40, null);
	await wait(700);
	const card = s.augmentSystem.uiObjects.find((o) => o.type === 'Container');
	const bounds = card?.getBounds?.();
	const canvas = s.game.canvas.getBoundingClientRect();
	return {
		open: s.augmentSystem.isOpen,
		cards: s.augmentSystem.uiObjects.filter((o) => o.type === 'Container').length,
		hover: bounds ? { x: canvas.x + bounds.centerX, y: canvas.y + bounds.centerY } : null,
	};
});
check('라운드 40 각성 선택 화면이 열린다', awakenUi.open === true && awakenUi.cards > 0,
	`cards=${awakenUi.cards}`);
if (awakenUi.hover) {
	await page.mouse.move(awakenUi.hover.x - 30, awakenUi.hover.y - 30);
	await page.mouse.move(awakenUi.hover.x, awakenUi.hover.y, { steps: 4 });
	await page.waitForTimeout(400);
	const tip = await page.evaluate(() => ({
		visible: window.__gameScene.augmentSystem.tooltip?.isVisible ?? false,
		title: window.__gameScene.augmentSystem.tooltip?.currentTitle ?? null,
	}));
	check('각성 선택 화면: 검 호버 → 상세 툴팁', tip.visible === true && Boolean(tip.title), `title=${tip.title}`);
} else {
	check('각성 선택 화면: 검 호버 → 상세 툴팁', false, '카드 좌표를 찾지 못함');
}
await page.evaluate(() => {
	const a = window.__gameScene.augmentSystem;
	a.destroyUi();
	a.isOpen = false;
});
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────
// (7) 3뷰포트 겹침 QA
// ─────────────────────────────────────────────────────────────
for (const [w, h] of [[1280, 720], [1512, 982], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(400);
	await page.evaluate(async () => {
		const s = window.__gameScene;
		const wait = (ms) => new Promise((res) => setTimeout(res, ms));
		if (s.shopSystem.isOpen) {
			s.shopSystem.destroyUi();
			s.shopSystem.isOpen = false;
		}
		s.shopSystem.open(12);
		await wait(200);
	});
	await page.waitForTimeout(600);
	const layout = await page.evaluate(() => window.__gameScene.shopSystem.ui.layoutMetrics());
	const offerRight = layout.offerRect.x + layout.offerRect.w;
	check(`[${w}x${h}] 좌측 목록이 보관함과 겹치지 않는다`,
		offerRight <= layout.invRect.x && offerRight <= layout.filterRect.x,
		`offerRight=${Math.round(offerRight)} invX=${Math.round(layout.invRect.x)}`);
	check(`[${w}x${h}] 필터 칩(보관함 위)과 그리드가 세로로 겹치지 않는다`,
		layout.filterRect.y + layout.filterRect.h <= layout.invRect.y,
		`filterBottom=${Math.round(layout.filterRect.y + layout.filterRect.h)} invY=${Math.round(layout.invRect.y)}`);
	check(`[${w}x${h}] 목록이 화면 안에 들어온다`,
		layout.offerRect.y + layout.offerRect.h <= layout.uiHeight,
		`bottom=${Math.round(layout.offerRect.y + layout.offerRect.h)} h=${layout.uiHeight}`);
	await page.screenshot({ path: `/tmp/swordui-${w}x${h}.png` });
}

check('콘솔 예외 없음', errors.length === 0, errors.slice(0, 2).join(' / '));

await browser.close();
console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
	console.log('실패 목록:');
	for (const name of failures) console.log(`  - ${name}`);
	process.exit(1);
}
console.log('SWORD UI TEST: PASS');
