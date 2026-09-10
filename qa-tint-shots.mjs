// 검 원소색 틴트 전/후 비교 스크린샷 (2026-09-01).
//
// 같은 세션·같은 프레임에서 두 장을 찍는다 — 배경도 검 위치도 완전히 같고
// 다른 것은 틴트 계산뿐이다:
//   tint-after.png   현재 방식 (src/logic/swordTint.ts — 휘도 복원 + 광원 그라디언트)
//   tint-before.png  예전 방식 (effect.tint 를 단색 곱셈으로 그대로)
//
// scene.pause() 로 update 만 멈추고 렌더는 계속시키는 게 요령이다
// (physics.pause 만으로는 궤도 갱신이 계속 돌아 검이 움직인다).
//
// 실행: OUT=<디렉터리> PORT=5199 node qa-tint-shots.mjs
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const OUT = process.env.OUT || '/tmp';

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
await page.keyboard.press('Space');
await page.waitForTimeout(900);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2600);

const box = await page.evaluate(() => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	// 원소가 서로 다른 7자루 — 색이 강한 epic 등급으로 골라 차이가 잘 보이게
	const want = ['fire', 'poison', 'void', 'gold', 'ice', 'blood', 'wind'];
	const picks = want
		.map((el) => so.swordCatalog.find((d) => d.element === el && d.rarity === 'epic'))
		.filter(Boolean)
		.slice(0, 7);
	so.unlockedSlots = 7;
	so.rebuildLoadout(picks.map((d) => ({ definition: d, level: 1, traits: [] })));
	s.enemyManager.clearField?.();
	s.physics.pause();
	s.scene.pause(); // update 정지 → 두 장의 검 위치가 완전히 같다 (렌더는 계속)
	const v = s.cameras.main.worldView;
	const z = s.cameras.main.zoom;
	return {
		ids: picks.map((d) => d.id),
		tints: picks.map((d) => d.effect?.tint),
		cx: (s.player.x - v.x) * z,
		cy: (s.player.y - v.y) * z,
	};
});
console.log(JSON.stringify(box));

const clip = {
	x: Math.max(0, Math.round(box.cx - 190)),
	y: Math.max(0, Math.round(box.cy - 190)),
	width: 380,
	height: 380,
};
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/tint-after.png`, clip });

// 예전 방식(단색 곱셈)으로 되돌린 뒤 같은 자리에서 한 장 더
await page.evaluate(() => {
	for (const sword of window.__gameScene.swordOrbit.swords) {
		if (sword.effect?.tint) {
			sword.setTint(parseInt(sword.effect.tint.replace('#', ''), 16));
		}
	}
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/tint-before.png`, clip });

await browser.close();
console.log(`shots → ${OUT}/tint-before.png, ${OUT}/tint-after.png`);
