// 상자 등급 QA: 4등급 스폰 → idle 애니 확인 → 수집 → 열림 애니·보상 확인.
// Run: node chest-test.mjs (vite dev on :5199)
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') { const t = msg.text(); if (!t.includes('Failed to load resource')) errors.push(t); }; });

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
await page.waitForTimeout(1000);

// 1) 시트·애니메이션 등록 확인 + 4등급 스폰 (플레이어에서 멀리)
const spawned = await page.evaluate(() => {
	const s = window.__gameScene;
	const out = { texture: s.textures.exists('chests'), anims: [], items: [] };
	for (let t = 0; t < 4; t += 1) {
		out.anims.push(s.anims.exists(`chest${t}-idle`) && s.anims.exists(`chest${t}-open`));
		s.pickupSystem.spawnChest(s.player.x + 300 + t * 60, s.player.y + 300, t, 100);
	}
	for (const item of s.pickupSystem.items) {
		if (item.kind === 'chest') {
			out.items.push({
				tier: item.tier,
				texture: item.obj.texture?.key,
				anim: item.obj.anims?.currentAnim?.key ?? null,
				playing: item.obj.anims?.isPlaying ?? false,
			});
		}
	}
	return out;
});

// 2) 서리(3) 상자를 플레이어 위치로 끌어와 수집 → 열림 애니·보상 확인
const before = await page.evaluate(() => {
	const s = window.__gameScene;
	return { gold: s.pickupSystem.runGold, swords: s.swordOrbit.swords.length, reserve: s.swordOrbit.reserve.length };
});
await page.evaluate(() => {
	const s = window.__gameScene;
	const chest = s.pickupSystem.items.find((i) => i.kind === 'chest' && i.tier === 3);
	if (chest) { chest.obj.x = s.player.x; chest.obj.y = s.player.y; chest.baseY = s.player.y; }
});
await page.waitForTimeout(300);
const during = await page.evaluate(() => {
	const s = window.__gameScene;
	// 수집된 상자는 items에서 빠지고, 열림 애니 중인 스프라이트가 씬에 남는다
	const opening = s.children.list.filter((c) => c.texture?.key === 'chests' && c.anims?.currentAnim?.key?.endsWith('-open'));
	return {
		remainingChests: s.pickupSystem.items.filter((i) => i.kind === 'chest').length,
		openingAnims: opening.map((c) => c.anims.currentAnim.key),
	};
});
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		gold: s.pickupSystem.runGold,
		swords: s.swordOrbit.swords.length,
		reserve: s.swordOrbit.reserve.length,
		lingeringSprites: s.children.list.filter((c) => c.texture?.key === 'chests').length,
	};
});

const swordGained = (after.swords + after.reserve) > (before.swords + before.reserve);
const result = {
	spawned,
	before,
	during,
	after,
	checks: {
		textureLoaded: spawned.texture,
		allAnimsRegistered: spawned.anims.every(Boolean),
		fourTiersSpawned: spawned.items.length === 4,
		idlePlaying: spawned.items.every((i) => i.playing && i.anim === `chest${i.tier}-idle`),
		collectedOne: during.remainingChests === 3,
		openAnimPlayed: during.openingAnims.includes('chest3-open'),
		goldGained: after.gold > before.gold,
		frostSwordGuaranteed: swordGained,
		spritesCleanedUp: after.lingeringSprites === 3, // 남은 3개 idle 상자만
	},
	errors,
};
console.log(JSON.stringify(result, null, 2));
const pass = Object.values(result.checks).every(Boolean) && errors.length === 0;
console.log(pass ? 'CHEST TEST PASS' : 'CHEST TEST FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
