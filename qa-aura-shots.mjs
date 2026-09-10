// 오라 QA 스크린샷 — 같은 원소 2~7자루 단계별 마법진 + 다세트 중첩 장면.
// 실행: vite preview(5199) 띄운 뒤 `node qa-aura-shots.mjs [출력디렉토리]`
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? '.';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);
await page.keyboard.press('Space');
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	so.unlockedSlots = 7;
	so.noLaunch = true;
	so.minSwords = 0;
	// 스크린샷 방해 요소 차단: 무적 + 레벨업 모달 + 세트 배너 + FX 스로틀
	s.player.invulnUntil = s.time.now + 10 * 60 * 1000;
	if (s.levelUpSystem) s.levelUpSystem.enqueue = () => {};
	if (s.elementSets) s.elementSets.announceNewTiers = () => {};
	if (s.visualEffects) s.visualEffects.fxThrottle = () => 1;
	window.__equipElements = (list) => {
		const byElement = {};
		for (const def of so.swordCatalog) {
			if (def.element && !byElement[def.element]) byElement[def.element] = def;
		}
		for (const sw of [...so.swords]) so.removeSword(sw);
		so.rebuildLoadout(list.map((el) => ({ definition: byElement[el], level: 1 })));
	};
});

const clipAroundPlayer = async () => {
	const p = await page.evaluate(() => {
		const s = window.__gameScene;
		const cam = s.cameras.main;
		return {
			x: (s.player.x - cam.worldView.x) * cam.zoom,
			y: (s.player.y - cam.worldView.y) * cam.zoom,
		};
	});
	const size = 560;
	return {
		x: Math.max(0, Math.min(1280 - size, p.x - size / 2)),
		y: Math.max(0, Math.min(720 - size, p.y - size / 2)),
		width: size,
		height: size,
	};
};

// 불 원소 2~7단계
for (let n = 2; n <= 7; n += 1) {
	await page.evaluate((count) => {
		window.__equipElements(new Array(count).fill('fire'));
	}, n);
	await page.waitForTimeout(650);
	await page.screenshot({ path: `${outDir}/aura-fire-${n}.png`, clip: await clipAroundPlayer() });
	console.log(`saved aura-fire-${n}.png`);
}

// 생성 4원소 스모크: 각 4자루 (글로우 단계)
for (const el of ['ice', 'gold', 'blood', 'wind']) {
	await page.evaluate((element) => {
		window.__equipElements([element, element, element, element]);
	}, el);
	await page.waitForTimeout(650);
	await page.screenshot({ path: `${outDir}/aura-${el}-4.png`, clip: await clipAroundPlayer() });
	console.log(`saved aura-${el}-4.png`);
}

// 다세트 중첩: 공허 3 + 번개 2 + 독 2
await page.evaluate(() => {
	window.__equipElements(['void', 'void', 'void', 'electric', 'electric', 'poison', 'poison']);
});
await page.waitForTimeout(650);
await page.screenshot({ path: `${outDir}/aura-stacked.png`, clip: await clipAroundPlayer() });
console.log('saved aura-stacked.png');

await browser.close();
console.log('done');
