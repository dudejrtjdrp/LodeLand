// 해금 스탯(EVASION/INSIGHT/BULWARK/BLOODTHIRST/MIDAS/REKINDLE) + MAGNET 하향 + ARMORY 버그 테스트
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const CHROME = process.env.CHROME_BIN;
const errors = [];
const browser = await chromium.launch({
	executablePath: CHROME,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad',
		'--crash-dumps-dir=/tmp/chromehomeU/dumps', '--disk-cache-dir=/tmp/chromecacheU'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

async function startRun() {
	await page.waitForSelector('canvas', { timeout: 15000 });
	await page.waitForTimeout(2500);
	// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
	// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
	await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
	await page.keyboard.press('Space');
	await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
	await page.keyboard.press('Space');
	await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
	await page.waitForTimeout(1200);
}

await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
// 메타 초기화 (깨끗한 기준)
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await startRun();

const phaseA = await page.evaluate(async () => {
	const s = window.__gameScene;
	const lu = s.levelUpSystem;
	const p = s.player;
	const so = s.swordOrbit;
	const pr = s.progression;
	const out = { checks: {} };
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const byId = (id) => lu.upgrades.find((u) => u.id === id);
	const avail = (id) => lu.isUpgradeAvailable(byId(id));
	const applyLegendary = (id) => lu.applyChoice(lu.makeChoice(byId(id), lu.rarities.find((r) => r.id === 'legendary')));

	// --- MAGNET 하향 확인
	const magnet = byId('magnet');
	out.checks.magnetNerfCommon = magnet.values.common === 0.08;
	out.checks.magnetNerfLegendary = magnet.values.legendary === 0.4;

	// --- 신규 6종 존재
	const ids = ['evasion', 'insight', 'bulwark', 'bloodthirst', 'midas', 'rekindle'];
	out.checks.allPresent = ids.every((id) => !!byId(id));

	// --- 해금 전: 전부 잠김
	out.checks.lockedBefore = ids.every((id) => !avail(id));
	// rollChoices에도 안 나옴 (30회 롤)
	let leaked = false;
	for (let i = 0; i < 30; i += 1) {
		if (lu.rollChoices().some((c) => ids.includes(c.upgrade.id))) { leaked = true; break; }
	}
	out.checks.neverRolledWhileLocked = !leaked;

	// --- 부모 스탯 MAX 세팅
	p.moveSpeed = Math.round(p.baseMoveSpeed * 1.6);
	pr.magnetRadius = pr.baseMagnetRadius * 3;
	so.radius = so.baseRadius * 1.8;
	so.orbitSpeed = so.baseOrbitSpeed * 2.5;
	so.launchSpeedMultiplier = 2.5;
	so.cooldownMultiplier = 0.35;

	out.checks.unlockedAfterMax = ids.every((id) => avail(id));

	// --- 상한까지 적용 (레전더리 반복) 후 값·재잠김 확인
	for (let i = 0; i < 10; i += 1) { applyLegendary('evasion'); }
	out.checks.dodgeCap = Math.abs(p.dodgeChance - 0.3) < 1e-9 && !avail('evasion');
	for (let i = 0; i < 10; i += 1) { applyLegendary('insight'); }
	out.checks.xpCap = Math.abs(pr.xpMultiplier - 1.5) < 1e-9 && !avail('insight');
	for (let i = 0; i < 10; i += 1) { applyLegendary('bulwark'); }
	out.checks.drCap = Math.abs(p.damageReduction - 0.25) < 1e-9 && !avail('bulwark');
	for (let i = 0; i < 10; i += 1) { applyLegendary('bloodthirst'); }
	// 2026-09-04: 흡혈 상한 8% → 3% (UNLOCK_CAPS.lifesteal)
	out.checks.lifestealCap = Math.abs(p.lifesteal - 0.03) < 1e-9 && !avail('bloodthirst');
	for (let i = 0; i < 10; i += 1) { applyLegendary('midas'); }
	out.checks.goldCap = Math.abs(p.goldBonus - 0.5) < 1e-9 && !avail('midas');
	for (let i = 0; i < 10; i += 1) { applyLegendary('rekindle'); }
	out.checks.regenCap = Math.abs(p.hpRegen - 3) < 1e-9 && !avail('rekindle');

	// --- BULWARK 실효: 방어/저항 0, 회피 0에서 100 피해 → 75
	const dodgeSave = p.dodgeChance;
	p.dodgeChance = 0; p.defense = 0; p.physicalResist = 0; p.magicResist = 0;
	p.invulnerableUntil = 0;
	const dtm = s.augmentSystem?.damageTakenMult ?? 1;
	p.hp = p.maxHp;
	s.applyPlayerDamage(100, null, null, 'physical');
	const expected = Math.max(1, Math.round(100 * dtm * 0.75));
	out.checks.bulwarkReduces = Math.abs((p.maxHp - p.hp) - expected) < 1e-6;

	// --- EVASION 실효: 회피 100%면 피해 무효
	p.invulnerableUntil = 0;
	p.dodgeChance = 1;
	const hpBefore = p.hp;
	const applied = s.applyPlayerDamage(100, null, null, 'physical');
	out.checks.dodgeWorks = applied === false && p.hp === hpBefore;
	p.dodgeChance = dodgeSave;

	// --- BLOODTHIRST 실효: onSwordHit에서 3% 회복 (초당 최대체력 6% 예산 안 — 100 피해 × 3% = 3 은 예산 안)
	p.hp = 1;
	p.healBudget = undefined; p.healBudgetAt = undefined;
	s.augmentSystem.onSwordHit(null, {}, 100, false);
	out.checks.lifestealHeals = Math.abs(p.hp - (1 + 100 * 0.03)) < 1e-6;

	// --- MIDAS 실효: addGold 배율
	const g0 = s.pickupSystem.runGold;
	s.pickupSystem.addGold(100);
	const expectedGold = Math.max(1, Math.round(100 * s.pickupSystem.goldMult * 1.5));
	out.checks.midasGold = s.pickupSystem.runGold - g0 === expectedGold;

	// --- REKINDLE 실효: 재생 틱
	p.hp = 10;
	await wait(1200);
	out.checks.regenTicks = p.hp > 10;

	return out;
});

// --- Phase B: ARMORY(시작 검 +1) 버그 수정 확인
await page.evaluate(() => {
	localStorage.setItem('movesword-meta-v1', JSON.stringify({
		gold: 0, ranks: { armory: 1 }, characters: [], clearedDanger: -1, lifetimeGold: 0, guaranteeCoins: 0,
	}));
	localStorage.removeItem('movesword-run-v1');
});
await page.reload({ waitUntil: 'networkidle' });
await startRun();
const phaseB = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		swords: s.swordOrbit.swords.length,
		unlockedSlots: s.swordOrbit.unlockedSlots,
		checks: {
			armorySwordApplied: s.swordOrbit.swords.length === 3,
			armorySlotUnlocked: s.swordOrbit.unlockedSlots === 3,
		},
	};
});

const allChecks = { ...phaseA.checks, ...phaseB.checks };
const failed = Object.entries(allChecks).filter(([, v]) => !v);
console.log(JSON.stringify({ allChecks, phaseB: { swords: phaseB.swords, slots: phaseB.unlockedSlots }, errors: errors.slice(0, 5) }, null, 1));
console.log(failed.length === 0 && errors.length === 0 ? `PASS (${Object.keys(allChecks).length} checks)` : `FAIL: ${failed.map(([k]) => k).join(', ')} ERR:${errors.length}`);
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
