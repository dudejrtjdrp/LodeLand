// Augment system headless test: forced offers, effect application, shop chaining.
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

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

const result = await page.evaluate(async () => {
	const s = window.__gameScene;
	const a = s.augmentSystem;
	const out = { checks: {} };
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	out.tierPlan = [...a.tierPlan];
	out.checks.tierPlanLen4 = a.tierPlan.length === 4;
	out.checks.shouldOffer10 = a.shouldOffer(10) === true;
	out.checks.shouldNotOffer11 = a.shouldOffer(11) === false;

	// --- 1) open with shop chaining callback
	let chained = false;
	a.open(10, () => { chained = true; });
	await wait(400);
	out.checks.openPausesPhysics = s.physics.world.isPaused === true;
	out.checks.uiBuilt = a.uiObjects.length > 0;

	// --- 2) reroll
	const before = a.rerollsLeft;
	a.reroll();
	await wait(200);
	out.checks.rerollConsumed = a.rerollsLeft === before - 1;

	// --- 3) pick a specific augment by applying directly through selectAugment
	const catalogAug = (id) => a.poolForTier('steel').concat(a.poolForTier('gold'), a.poolForTier('transcend')).find((x) => x.id === id);
	const dmgBefore = s.swordOrbit.damageMultiplier;
	const whetstone = catalogAug('whetstone');
	a.selectAugment(whetstone);
	await wait(200);
	out.checks.damageApplied = Math.abs(s.swordOrbit.damageMultiplier - (dmgBefore + 0.12)) < 1e-9;
	out.checks.takenRecorded = a.taken.has('whetstone');
	out.checks.slotAdvanced = a.slotIndex === 1;
	out.checks.chainCalled = chained === true;
	out.checks.uiTornDown = a.uiObjects.length === 0;

	// --- 4) effect variety: apply several augments directly
	const so = s.swordOrbit;
	const hpBefore = s.player.maxHp;
	a.applyAugment({ id: 't1', effects: { maxHpFlat: 45, regenAdd: 0.5 } });
	out.checks.hpApplied = s.player.maxHp === hpBefore + 45;

	const goldBefore = s.pickupSystem.runGold;
	a.applyAugment({ id: 't2', effects: { goldFlat: 12, goldPerRound: 2 } });
	out.checks.goldApplied = s.pickupSystem.runGold >= goldBefore + 12;

	const unlockedBefore = so.unlockedSlots;
	a.applyAugment({ id: 't3', effects: { unlockSlots: 2, damageTakenMult: 1.3 } });
	out.checks.slotsUnlocked = so.unlockedSlots === Math.min(so.maxSwords, unlockedBefore + 2);
	out.checks.dmgTakenMult = Math.abs(a.damageTakenMult - 1.3) < 1e-9;

	a.applyAugment({ id: 't4', effects: { echoLaunchChance: 0.25, resonanceScale: 1.8, ultimateCdMult: 0.75 } });
	out.checks.echo = so.echoLaunchChance === 0.25;
	out.checks.resonance = so.resonanceScale === 1.8;
	out.checks.ultFire = so.ultimateIntervals.fire === 6000;

	a.applyAugment({ id: 't5', effects: { burnOnHit: { dps: 8, durationMs: 2000 }, lifestealPct: 0.04, executeThreshold: 0.1 } });
	out.checks.onhitState = !!a.burnOnHit && a.lifestealPct === 0.04 && a.executeThreshold === 0.1;

	// onSwordHit smoke: run against a live enemy if any
	const enemy = s.enemyManager.enemies.getChildren().find((e) => e.active);
	if (enemy) {
		const hpB = s.player.hp;
		s.player.hp = Math.max(1, hpB - 10);
		a.onSwordHit(so.swords[0], enemy, 100, false);
		out.checks.lifestealHealed = s.player.hp > Math.max(1, hpB - 10);
	} else {
		out.checks.lifestealHealed = 'no-enemy';
	}

	// --- 5) round-complete hooks: interest + vault + temper
	a.applyAugment({ id: 't6', effects: { interestPct: 0.08, interestCap: 15, perRoundDamageAdd: 0.02, vault: { rounds: 2, gold: 220, gems: 1 } } });
	s.pickupSystem.runGold = 100;
	const dmg2 = so.damageMultiplier;
	a.onRoundComplete(1);
	out.checks.interestPaid = s.pickupSystem.runGold >= 100 + 8 + 2; // 8 interest + 2 goldPerRound
	out.checks.temperApplied = Math.abs(so.damageMultiplier - (dmg2 + 0.02)) < 1e-9;
	out.checks.vaultTick = a.vault && a.vault.roundsLeft === 1;
	const goldPreVault = s.pickupSystem.runGold;
	a.onRoundComplete(2);
	out.checks.vaultPaid = a.vault === null && s.pickupSystem.runGold >= goldPreVault + 220;

	// --- 6) second offer at round 25 with tier boost
	a.nextTierBoost = true;
	out.checks.offer25 = a.shouldOffer(25) === true;
	a.open(25, null);
	await wait(300);
	out.checks.secondUiBuilt = a.uiObjects.length > 0;
	const pool = a.rollChoices(a.tierPlan[1]);
	out.checks.rollThree = pool.length === 3 && new Set(pool.map((x) => x.id)).size === 3;
	// close by picking first visible choice
	a.selectAugment(pool[0]);
	await wait(200);
	out.checks.physicsResumed = s.physics.world.isPaused === false;

	// --- 7) 유료 드래프트: 상점에서 골드로 구매 (무료 시퀀스 비소모)
	const shop = s.shopSystem;
	shop.open(12);
	await wait(400);
	s.pickupSystem.runGold = 500;
	const p1 = shop.augmentDraftPrice();
	out.checks.draftBasePrice = p1 === Math.ceil(60 + 12 * 3);
	const slotBefore = a.slotIndex;
	shop.buyAugmentDraft();
	await wait(300);
	out.checks.draftOpened = a.isOpen === true && a.purchasedMode === true;
	out.checks.draftCharged = s.pickupSystem.runGold === 500 - p1;
	out.checks.draftPriceRose = shop.augmentDraftPrice() > p1;
	out.checks.draftUiBuilt = a.uiObjects.length > 0;
	out.checks.draftTierSet = ['steel', 'gold', 'transcend'].includes(a.activeTier);
	const draftChoices = a.rollChoices(a.activeTier);
	a.selectAugment(draftChoices[0]);
	await wait(200);
	out.checks.draftNoSlotAdvance = a.slotIndex === slotBefore;
	out.checks.draftModeCleared = a.purchasedMode === false;
	out.checks.shopStillOpen = shop.isOpen === true;
	out.checks.physicsStillPaused = s.physics.world.isPaused === true;
	// 골드 부족 시 구매 거부
	s.pickupSystem.runGold = 0;
	const boughtBefore = a.draftsBought;
	shop.buyAugmentDraft();
	await wait(200);
	out.checks.draftRefusedWhenBroke = a.isOpen === false && a.draftsBought === boughtBefore;
	shop.close();
	await wait(200);

	out.taken = [...a.taken];
	return out;
});

await browser.close();

const failedChecks = Object.entries(result.checks).filter(([, v]) => v === false);
console.log(JSON.stringify(result, null, 2));
console.log('errors:', errors.filter((e) => !e.includes('GL Driver') && !e.includes('animation')));
console.log(failedChecks.length === 0 && errors.filter((e) => e.startsWith('PAGEERROR')).length === 0 ? 'AUGMENT TEST: PASS' : `AUGMENT TEST: FAIL ${JSON.stringify(failedChecks)}`);
