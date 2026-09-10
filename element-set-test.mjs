// 원소 세트(2~7단계) 회귀 테스트
//  1) 같은 원소 자루 수에 따라 단계가 2~7로 열린다.
//  2) 단계 스탯이 실제 플레이어/궤도 값에 반영되고, 장착이 바뀌면 정확히 원복된다 (누수 없음).
//  3) 4/6/7단계 스킬 id 가 활성 목록에 들어온다.
//  4) 서로 다른 원소 두 벌이 동시에 활성이면 두 오라가 함께 그려진다 (중첩).
//  5) 감전/빙결/부식 취약이 적이 받는 피해를 실제로 늘린다.
//  6) 프레임당 스킬 틱이 돌아도 pageerror 가 없다.
// 실행: vite dev(5173) 띄운 뒤 `node element-set-test.mjs`
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
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
	const sets = s.elementSets;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const checks = [];
	const ok = (name, cond, extra) => checks.push({ name, pass: !!cond, ...(extra ?? {}) });

	so.unlockedSlots = 7;
	so.noLaunch = true;
	so.minSwords = 0;

	// 카탈로그에서 원소별 검 정의를 하나씩 뽑는다
	const byElement = {};
	for (const def of so.swordCatalog) {
		if (def.element && !byElement[def.element]) byElement[def.element] = def;
	}
	ok('카탈로그에 불/피/황금 검이 있다', byElement.fire && byElement.blood && byElement.gold,
		{ elements: Object.keys(byElement) });

	const equip = async (list) => {
		for (const sw of [...so.swords]) so.removeSword(sw);
		so.rebuildLoadout(list.map((el) => ({ definition: byElement[el], level: 1 })));
		await wait(120);
	};

	// ── 기준값 (검 없음)
	await equip([]);
	const base = {
		dmg: so.damageMultiplier, cd: so.cooldownMultiplier, orbit: so.orbitSpeed,
		hp: s.player.maxHp, move: s.player.moveSpeed, crit: s.player.critChance,
		lifesteal: s.player.lifesteal, luck: s.player.luck, defense: s.player.defense,
	};
	ok('검 0자루면 활성 세트 없음', Object.keys(sets.tiers).length === 0);

	// ── 1) 단계 개방: 불 2 → 4 → 7
	await equip(['fire', 'fire']);
	ok('불 2자루 → 2단계', sets.tierOf('fire') === 2, { tier: sets.tierOf('fire') });
	const dmgAt2 = so.damageMultiplier;

	await equip(['fire', 'fire', 'fire', 'fire']);
	ok('불 4자루 → 4단계', sets.tierOf('fire') === 4);
	ok('불 3단계 스탯(피해 +12%)이 붙는다', so.damageMultiplier > dmgAt2 + 1e-6,
		{ before: dmgAt2, after: so.damageMultiplier });
	ok('불 4단계 스킬 [작열] 활성', sets.has('fire.scorch'));

	await equip(['fire', 'fire', 'fire', 'fire', 'fire', 'fire', 'fire']);
	ok('불 7자루 → 7단계', sets.tierOf('fire') === 7);
	ok('불 6단계 [화염 고리] 활성', sets.has('fire.ring'));
	ok('불 7단계 [대화재] 활성', sets.has('fire.conflagration'));

	// ── 2) 원복: 전부 해제하면 기준값으로 정확히 돌아온다 (스탯 누수 없음)
	await equip([]);
	const near = (a, b) => Math.abs(a - b) < Math.max(0.5, Math.abs(b) * 0.001);
	ok('해제 후 공격력 원복', near(so.damageMultiplier, base.dmg), { now: so.damageMultiplier, base: base.dmg });
	ok('해제 후 쿨다운 원복', near(so.cooldownMultiplier, base.cd));
	ok('해제 후 궤도속도 원복', near(so.orbitSpeed, base.orbit));
	ok('해제 후 최대체력 원복', near(s.player.maxHp, base.hp), { now: s.player.maxHp, base: base.hp });
	ok('해제 후 이동속도 원복', near(s.player.moveSpeed, base.move));
	ok('해제 후 흡혈 원복', near(s.player.lifesteal, base.lifesteal));
	ok('해제 후 행운 원복', near(s.player.luck, base.luck));
	ok('해제 후 방어 원복', near(s.player.defense, base.defense));

	// ── 3) 원소별 효과가 서로 다르다 (피=흡혈/체력, 황금=행운/골드, 얼음=방어)
	await equip(['blood', 'blood', 'blood']);
	const bloodHp = s.player.maxHp;
	// 2026-09-04 흡혈 대개편(UNLOCK_CAPS.lifesteal 8%→3%)으로 피 2세트는 +1%
	ok('피 2단계 흡혈 +1%', s.player.lifesteal > base.lifesteal + 0.005);
	ok('피 3단계 최대체력 +12%', bloodHp > base.hp * 1.1, { now: bloodHp, base: base.hp });
	ok('피 3세트는 황금 스킬을 주지 않는다', !sets.has('gold.greed'));

	await equip(['gold', 'gold', 'gold', 'gold']);
	ok('황금 2단계 골드 보너스', s.player.goldBonus >= 0.25);
	ok('황금 3단계 행운/치명', s.player.luck > base.luck + 0.1 && s.player.critChance > base.crit + 0.04);
	ok('황금 4단계 [탐욕의 대가] 활성', sets.has('gold.greed'));
	ok('황금 세트로 바꾸면 피 흡혈은 사라진다', Math.abs(s.player.lifesteal - base.lifesteal) < 1e-6,
		{ lifesteal: s.player.lifesteal });

	await equip(['ice', 'ice', 'ice', 'ice']);
	ok('얼음 3단계 방어 +10', s.player.defense >= base.defense + 10);
	ok('얼음 4단계 [빙결] 활성', sets.has('ice.freeze'));

	// ── 4) 중첩: 피 3 + 황금 4 → 두 세트가 동시에 활성
	await equip(['blood', 'blood', 'blood', 'gold', 'gold', 'gold', 'gold']);
	const stacked = { blood: sets.tierOf('blood'), gold: sets.tierOf('gold') };
	ok('피 3 + 황금 4 동시 활성', stacked.blood === 3 && stacked.gold === 4, stacked);
	ok('두 세트의 스탯이 함께 적용된다',
		s.player.lifesteal > base.lifesteal + 0.005 && s.player.goldBonus >= 0.25);
	ok('활성 세트 2종 → 오라도 2겹', Object.keys(sets.tiers).length === 2);

	// 오라 렌더러: 마법진 스프라이트가 세트 수만큼 깔리고, 단계에 따라 겹이 늘어난다
	// (헤드리스 소프트웨어 렌더링은 fxThrottle 이 걸려 글로우가 꺼지므로 1로 고정)
	if (s.visualEffects) s.visualEffects.fxThrottle = () => 1;
	s.elementAura.update(16);
	const auraLayers = s.elementAura.layers;
	ok('오라 마법진 2겹 (피+황금)', auraLayers?.size === 2, { size: auraLayers?.size });
	const goldLayer = auraLayers?.get('gold');
	const bloodLayer = auraLayers?.get('blood');
	ok('오라 본체 스프라이트가 살아있고 시트 애니가 돈다',
		!!goldLayer?.main?.active && goldLayer.main.anims?.currentAnim?.key === 'aura-gold-idle');
	ok('4단계(황금)는 글로우 겹이 켜진다', goldLayer?.glow?.visible === true);
	ok('3단계(피)는 글로우가 꺼져 있다', bloodLayer?.glow?.visible === false);
	ok('6단계 미만은 외곽 링이 꺼져 있다', goldLayer?.ring?.visible === false);

	// 7단계 완전 개방: 글로우+외곽 링까지 3겹
	await equip(['fire', 'fire', 'fire', 'fire', 'fire', 'fire', 'fire']);
	s.elementAura.update(16);
	const fireLayer = s.elementAura.layers?.get('fire');
	ok('7단계 불은 글로우+외곽 링까지 전부 켜진다',
		fireLayer?.glow?.visible === true && fireLayer?.ring?.visible === true);
	const fireScale7 = fireLayer?.main?.scaleX ?? 0;
	await equip(['fire', 'fire']);
	s.elementAura.update(16);
	const fireLayer2 = s.elementAura.layers?.get('fire');
	ok('2단계 마법진은 7단계보다 작다', (fireLayer2?.main?.scaleX ?? 99) < fireScale7,
		{ t2: fireLayer2?.main?.scaleX, t7: fireScale7 });
	ok('2단계는 글로우·링이 없다', fireLayer2?.glow?.visible === false && fireLayer2?.ring?.visible === false);
	// 중첩 시나리오 복구 (아래 검증들이 이 상태를 전제하지는 않지만 원상 복귀)
	await equip(['blood', 'blood', 'blood', 'gold', 'gold', 'gold', 'gold']);

	// ── 5) 취약 판정: 감전/빙결이 받는 피해를 늘린다
	await equip(['electric', 'electric', 'electric', 'electric']);
	const now = s.time.now;
	const fake = { setShockUntil: now + 1000, setFrozenUntil: 0, dotUntil: 0 };
	const vulnShock = sets.vulnerabilityFor(fake, now);
	ok('감전 적은 받는 피해 +15%', Math.abs(vulnShock - 1.15) < 1e-6, { vulnShock });
	const clean = { setShockUntil: 0, setFrozenUntil: 0, dotUntil: 0 };
	ok('멀쩡한 적은 배율 1.0', sets.vulnerabilityFor(clean, now) === 1);
	const frozen = { setShockUntil: now + 1000, setFrozenUntil: now + 1000, dotUntil: 0 };
	ok('감전+빙결은 누적된다', Math.abs(sets.vulnerabilityFor(frozen, now) - 1.40) < 1e-6,
		{ v: sets.vulnerabilityFor(frozen, now) });

	// ── 6) 7세트 하이리스크: 혈계는 잃은 체력만큼 피해가 오른다
	await equip(['blood', 'blood', 'blood', 'blood', 'blood', 'blood', 'blood']);
	ok('피 7단계 [혈계] 활성', sets.has('blood.bloodline'));
	ok('혈계는 회복량을 깎는다', Math.abs(sets.healMultiplier() - 0.7) < 1e-6);
	const fullHp = sets.dynamicDamageMult();
	s.player.hp = s.player.maxHp * 0.5;
	const halfHp = sets.dynamicDamageMult();
	ok('체력 50%에서 피해가 오른다', halfHp > fullHp * 1.2, { fullHp, halfHp });
	s.player.hp = s.player.maxHp;

	// ── 7) 세이브 왕복: capture → apply 를 반복해도 스탯이 불어나지 않는다
	//     (저장값에 세트 보정이 섞이면 라운드마다 이중 적용된다)
	await equip(['gold', 'gold', 'gold', 'gold', 'ice', 'ice', 'ice']);
	const RunSave = s.constructor.__RunSave ?? window.__RunSave;
	if (RunSave) {
		const before = { dmg: so.damageMultiplier, hp: s.player.maxHp, luck: s.player.luck, def: s.player.defense };
		const snap = RunSave.capture(s);
		ok('저장값은 세트 보정을 뺀 순수 스탯', snap.player.defense < s.player.defense,
			{ saved: snap.player.defense, live: s.player.defense });
		RunSave.apply(s, snap);
		await wait(200);
		ok('저장→복원 후 공격력 유지', Math.abs(so.damageMultiplier - before.dmg) < 0.01,
			{ before: before.dmg, after: so.damageMultiplier });
		ok('저장→복원 후 방어 유지', Math.abs(s.player.defense - before.def) < 0.5,
			{ before: before.def, after: s.player.defense });
		ok('저장→복원 후 행운 유지', Math.abs(s.player.luck - before.luck) < 0.01);
	} else {
		ok('RunSave 훅 노출 (개발 빌드)', false, { note: 'window.__RunSave 없음' });
	}

	// ── 8) 스킬 틱 안정성: 7세트 상태로 몇 초 돌려도 에러가 없다
	await equip(['fire', 'fire', 'fire', 'fire', 'fire', 'fire', 'fire']);
	await wait(3500);
	ok('7세트 스킬 틱 중 프레임이 살아 있다', s.game.loop.actualFps > 5, { fps: Math.round(s.game.loop.actualFps) });

	return { checks, base, stacked };
});

const failed = r.checks.filter((c) => !c.pass);
for (const c of r.checks) {
	console.log(`${c.pass ? '  ok' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c)}`}`);
}
console.log(`\n${r.checks.length - failed.length}/${r.checks.length} passed`);
console.log('pageerrors:', errors.length ? errors : 'none');
const pass = failed.length === 0 && errors.length === 0;
console.log(pass ? 'ELEMENT-SET TEST: PASS' : 'ELEMENT-SET TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
