// 2026-08-28 검 시스템 전면 개편 검증 (2026-09-01 아키타입 확대 2차로 186종):
// 186종 카탈로그 무결성 / 6등급 / 8원소 / 등급 가중 상점 굴림 /
// 중복 검 자동 합성(acquireSword) / 신규 필살기 타이머 / leech 스페셜.
// 실행: vite dev (5199) + CHROME_BIN 환경에서 node sword-catalog-test.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
	const scene = window.__gameScene;
	if (!scene) return { noScene: true };
	const so = scene.swordOrbit;
	const catalog = so.swordCatalog;
	const result = {};

	// 1) 카탈로그 무결성
	result.count = catalog.length;
	result.uniqueIds = new Set(catalog.map((s) => s.id)).size === catalog.length;
	result.uniqueFrames = new Set(catalog.map((s) => s.sheetOrder)).size === catalog.length;
	result.framesInRange = catalog.every((s) => s.sheetOrder >= 0 && s.sheetOrder < 186);
	result.texFrames = scene.textures.get('sword').frameTotal; // 186 + __BASE
	const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
	result.allHaveRarity = catalog.every((s) => rarities.includes(s.rarity));
	result.rarityCount = new Set(catalog.map((s) => s.rarity)).size;
	result.elements = new Set(catalog.map((s) => s.element).filter(Boolean)).size;
	// mythic 은 전부 조합 전용(evolved)
	result.mythicAllEvolved = catalog.filter((s) => s.rarity === 'mythic').every((s) => s.evolved);
	result.allHaveLore = catalog.every((s) => typeof s.lore === 'string' && s.lore.length > 0);

	// 2) 레시피 무결성 — 재료·결과가 전부 실재
	const ids = new Set(catalog.map((s) => s.id));
	result.recipes = so.evolutionRecipes.length;
	result.recipesValid = so.evolutionRecipes.every(
		(r) => ids.has(r.result) && r.ingredients.every((i) => ids.has(i)),
	);

	// 3) 상점 등급 게이팅: 1라운드엔 legendary/epic 미등장, mythic·evolved 절대 미등장
	const shop = scene.shopSystem;
	shop.round = 1;
	let earlyOk = true;
	for (let i = 0; i < 20; i += 1) {
		shop.rollSwordOffers();
		for (const offer of shop.swordOffers) {
			if (offer.evolved || ['rare', 'epic', 'legendary', 'mythic'].includes(offer.rarity)) earlyOk = false;
		}
	}
	result.earlyShopGated = earlyOk && shop.swordOffers.length === 5;
	shop.round = 60;
	let lateHasHigh = false;
	let mythicLeak = false;
	for (let i = 0; i < 40; i += 1) {
		shop.rollSwordOffers();
		for (const offer of shop.swordOffers) {
			if (['epic', 'legendary'].includes(offer.rarity)) lateHasHigh = true;
			if (offer.rarity === 'mythic' || offer.evolved) mythicLeak = true;
		}
	}
	result.lateShopHasHigh = lateHasHigh;
	result.noMythicInShop = !mythicLeak;

	// 4) 중복 검 자동 합성: 같은 검 획득 → 개수 그대로, 레벨 +1
	const def = catalog.find((s) => !s.evolved && !so.getSwordById(s.id));
	so.addToReserve(def, 1);
	const beforeCount = so.swords.length + so.reserve.length;
	const merged = so.acquireSword(scene, def);
	const idx = so.findReserveIndexById(def.id);
	result.mergeResult = merged;
	result.mergeNoDupe = (so.swords.length + so.reserve.length) === beforeCount;
	result.mergeLeveled = so.reserve[idx]?.level === 2;

	// 5) 8원소 필살기 타이머 + 가격
	result.ultimates = Object.keys(so.ultimateIntervals).length;
	const priceOk = (() => {
		const legendary = catalog.find((s) => s.rarity === 'legendary' && !s.evolved);
		const common = catalog.find((s) => s.rarity === 'common');
		return shop.swordPrice(legendary, null) > shop.swordPrice(common, null);
	})();
	result.rarityPricing = priceOk;

	// 6) leech 스페셜 정의 존재 (피 원소 rare+)
	result.leechExists = catalog.some((s) => s.special?.type === 'leech');

	return result;
});

console.log(JSON.stringify(out, null, 1));
console.log('errors:', errors);
const pass = !out.noScene && out.count === 186 && out.uniqueIds && out.uniqueFrames
	&& out.framesInRange && out.texFrames === 187 && out.allHaveRarity && out.rarityCount === 6
	&& out.elements === 8 && out.mythicAllEvolved && out.allHaveLore
	&& out.recipes === 26 && out.recipesValid
	&& out.earlyShopGated && out.lateShopHasHigh && out.noMythicInShop
	&& out.mergeResult === 'merged' && out.mergeNoDupe && out.mergeLeveled
	&& out.ultimates === 8 && out.rarityPricing && out.leechExists
	&& errors.length === 0;
console.log(pass ? 'SWORD CATALOG TEST: PASS' : 'SWORD CATALOG TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
