// 치명타 확률 100% 상한 + 처형/관통 해금 테스트 (2026-09-04)
//  - 치명타 증가폭 하향 (3/5/8/12/20% → 2/3/5/8/12%)
//  - 치명타 100% 도달 시 카드 풀에서 제외 (레벨업·상점 양쪽)
//  - CRIT MAX → 처형(executeDamageAdd) / 관통(penAdd) 해금
//  - 처형 = 체력 30% 이하 적 피해 증폭 / 관통 = 적 저항 차감
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const CHROME = process.env.CHROME_BIN;
const errors = [];
const browser = await chromium.launch({
	executablePath: CHROME,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad',
		'--crash-dumps-dir=/tmp/chromehomeC/dumps', '--disk-cache-dir=/tmp/chromecacheC'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

async function startRun() {
	await page.waitForSelector('canvas', { timeout: 15000 });
	await page.waitForTimeout(2500);
	await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
	await page.keyboard.press('Space');
	await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
	await page.keyboard.press('Space');
	await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
	await page.waitForTimeout(1200);
}

await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await startRun();

const result = await page.evaluate(() => {
	const s = window.__gameScene;
	const lu = s.levelUpSystem;
	const p = s.player;
	const em = s.enemyManager;
	const out = { checks: {}, notes: {} };
	const byId = (id) => lu.upgrades.find((u) => u.id === id);
	const avail = (id) => lu.isUpgradeAvailable(byId(id));
	const apply = (id, rarity = 'legendary') =>
		lu.applyChoice(lu.makeChoice(byId(id), lu.rarities.find((r) => r.id === rarity)));
	const EPS = 1e-9;

	// ── 1) 치명타 증가폭 하향
	const crit = byId('critChance');
	out.checks.critNerfCommon = crit.values.common === 0.02;
	out.checks.critNerfUncommon = crit.values.uncommon === 0.03;
	out.checks.critNerfRare = crit.values.rare === 0.05;
	out.checks.critNerfEpic = crit.values.epic === 0.08;
	out.checks.critNerfLegendary = crit.values.legendary === 0.12;
	// 하향 전(0.03~0.20) 대비 실제로 더 많은 픽이 필요한가 — 0 → 100% 최소 픽 수
	const picksNeeded = Math.ceil(1 / crit.values.legendary);
	out.notes.legendaryPicksTo100 = picksNeeded;
	out.checks.critHarderThanBefore = picksNeeded > Math.ceil(1 / 0.2);

	// ── 2) 신규 카드 2종 존재. 처형은 픽당 0.n% 씩만 오른다 (전 등급 1% 미만)
	const ex = byId('execute');
	out.checks.executeCardExists = !!ex && ex.type === 'executeDamageAdd';
	out.checks.pierceCardExists = !!byId('pierce') && byId('pierce').type === 'penAdd';
	out.checks.executeSubPercentSteps = Object.values(ex.values).every((v) => v > 0 && v < 0.01);
	out.notes.executeLegendaryPicksToCap = Math.ceil(0.15 / ex.values.legendary);
	// 표기 반올림 함정: 0.n% 가 "+0%"로 뭉개지지 않아야 한다
	const desc = lu.describeChoice(lu.makeChoice(ex, lu.rarities.find((r) => r.id === 'common')));
	out.notes.executeCardDesc = desc;
	out.checks.executeDescShowsDecimal = desc.includes('0.2%') && !desc.includes('+0%');

	// ── 3) 해금 전: 치명타는 열려 있고 처형/관통은 잠김
	p.critChance = 0.5;
	p.executeDamage = 0;
	p.pen = 0;
	out.checks.critAvailableBelow100 = avail('critChance');
	out.checks.lockedBeforeCritMax = !avail('execute') && !avail('pierce');
	// 롤에도 새지 않는가 (40회)
	let leaked = false;
	for (let i = 0; i < 40; i += 1) {
		if (lu.rollChoices().some((c) => c.upgrade.id === 'execute' || c.upgrade.id === 'pierce')) {
			leaked = true;
			break;
		}
	}
	out.checks.neverRolledWhileLocked = !leaked;

	// ── 4) 100% 도달: 치명타 카드가 빠지고 처형/관통이 열린다
	// 마지막 한 장이 상한을 넘겨도 100%에서 잘려야 한다 (0.95 + 0.12 → 1.00)
	p.critChance = 0.95;
	apply('critChance');
	out.checks.critClampedAt100 = Math.abs(p.critChance - 1) < EPS;
	out.checks.critRemovedAtMax = !avail('critChance');
	out.checks.executeUnlockedAtCritMax = avail('execute');
	out.checks.pierceUnlockedAtCritMax = avail('pierce');
	// 치명타 카드가 더는 롤되지 않는가
	let critLeaked = false;
	for (let i = 0; i < 40; i += 1) {
		if (lu.rollChoices().some((c) => c.upgrade.id === 'critChance')) { critLeaked = true; break; }
	}
	out.checks.critNeverRolledAtMax = !critLeaked;

	// ── 5) 상점도 100%에서 막힌다 (골드가 새지 않아야)
	const shopCrit = { id: 'crit', type: 'critChanceAdd', value: 0.03, baseCost: 40 };
	out.checks.shopCritBlockedAtMax = s.shopSystem.isStatMaxed(shopCrit) === true;
	p.critChance = 0.5;
	out.checks.shopCritOpenBelowMax = s.shopSystem.isStatMaxed(shopCrit) === false;
	p.critChance = 1;
	s.pickupSystem.runGold = 1000;
	s.shopSystem.buyStat(shopCrit);
	out.checks.shopCritGoldNotSpent = s.pickupSystem.runGold === 1000 && Math.abs(p.critChance - 1) < EPS;

	// ── 6) 상한까지 적용 후 재잠김 (처형 상한 15%, 전설 0.9%/픽 → 17픽 이상)
	let executePicks = 0;
	while (avail('execute') && executePicks < 200) { apply('execute'); executePicks += 1; }
	out.notes.executePicksUsed = executePicks;
	out.checks.executeNeedsManyPicks = executePicks >= 17;
	out.checks.executeCap = Math.abs(p.executeDamage - 0.15) < 1e-6 && !avail('execute');
	for (let i = 0; i < 12; i += 1) { apply('pierce'); }
	out.checks.pierceCap = Math.abs(p.pen - 0.2) < EPS && !avail('pierce');

	// ── 7) 관통 실효: 저항 40%인 적에게 100 피해
	//   관통 0   → round(100 × 0.60) = 60
	//   관통 0.2 → round(100 × 0.80) = 80
	for (const old of em.enemies.getChildren()) { em.recycleEnemy(old); }
	const e = em.spawnEnemy(s, p, 'skullwolf', { x: p.x + 500, y: p.y });
	if (e) {
		e.physicalResist = 0.4;
		e.magicResist = 0.4;
		e.dodgeChance = 0;
		e.shieldHits = 0;
		e.traitIds = [];
		e.maxHp = 100000;
		e.hp = 100000; // 처형 구간(30%) 밖

		p.pen = 0;
		let hp0 = e.hp;
		em.takeDamage(e, 100, p, { damageType: 'physical', silent: true });
		const noPen = hp0 - e.hp;

		p.pen = 0.2;
		hp0 = e.hp;
		em.takeDamage(e, 100, p, { damageType: 'physical', silent: true });
		const withPen = hp0 - e.hp;

		out.notes.penDamage = { noPen, withPen };
		out.checks.penReducesResist = noPen === 60 && withPen === 80;

		// ── 8) 처형 실효: 체력 30% 이하에서 피해 증폭
		e.physicalResist = 0;
		e.magicResist = 0;
		p.pen = 0;
		p.executeDamage = 0.15; // 상한

		e.hp = Math.round(e.maxHp * 0.5); // 임계 밖
		hp0 = e.hp;
		em.takeDamage(e, 100, p, { damageType: 'physical', silent: true });
		const aboveThreshold = hp0 - e.hp;

		e.hp = Math.round(e.maxHp * 0.25); // 임계 안
		hp0 = e.hp;
		em.takeDamage(e, 100, p, { damageType: 'physical', silent: true });
		const belowThreshold = hp0 - e.hp;

		out.notes.executeDamage = { aboveThreshold, belowThreshold };
		out.checks.executeIgnoresHealthyEnemy = aboveThreshold === 100;
		out.checks.executeAmplifiesLowHp = belowThreshold === 115;

		// 처형 0이면 증폭 없음
		p.executeDamage = 0;
		e.hp = Math.round(e.maxHp * 0.25);
		hp0 = e.hp;
		em.takeDamage(e, 100, p, { damageType: 'physical', silent: true });
		out.checks.executeOffIsNeutral = (hp0 - e.hp) === 100;
	} else {
		out.notes.noEnemyToTest = true;
		out.checks.penReducesResist = false;
		out.checks.executeIgnoresHealthyEnemy = false;
		out.checks.executeAmplifiesLowHp = false;
		out.checks.executeOffIsNeutral = false;
	}

	// ── 8.5) 카드 readout 에 부동소수 찌꺼기가 새지 않는가
	//   이동 속도 상한은 base×1.6 이라 378×1.6 = 604.8000000000001 이 그대로 찍히던 버그.
	//   모든 수치 표기는 소수 둘째 자리까지만 나와야 한다.
	const tooManyDecimals = (str) => /\d+\.\d{3,}/.test(str);
	const dirty = [];
	for (const u of lu.upgrades) {
		for (const r of lu.rarities) {
			if (u.values?.[r.id] === undefined) { continue; }
			const c = lu.makeChoice(u, r);
			const ro = lu.readoutForChoice(c);
			const text = `${lu.describeChoice(c)} ${ro?.before ?? ''} ${ro?.after ?? ''}`;
			if (tooManyDecimals(text)) { dirty.push(`${u.id}/${r.id}: ${text}`); }
		}
	}
	// 이동 속도는 상한 근처에서 특히 잘 터진다 — 일부러 상한 직전으로 밀어 재확인
	if (p.baseMoveSpeed) {
		p.moveSpeed = Math.round(p.baseMoveSpeed * 1.55);
		const ms = lu.makeChoice(byId('moveSpeed'), lu.rarities.find((r) => r.id === 'legendary'));
		const msRo = lu.readoutForChoice(ms);
		out.notes.moveSpeedAtCap = `${msRo.before} → ${msRo.after} (capped ${msRo.capped})`;
		if (tooManyDecimals(`${msRo.before} ${msRo.after}`)) { dirty.push(`moveSpeed@cap: ${msRo.after}`); }
		// 상한을 넘겨 적용해도 저장값 자체가 정수여야 한다
		lu.applyChoice(ms);
		out.checks.moveSpeedStoredInteger = Number.isInteger(p.moveSpeed);
		out.checks.moveSpeedCappedAndLocked = !avail('moveSpeed');
		out.notes.moveSpeedFinal = p.moveSpeed;
	}
	out.notes.dirtyReadouts = dirty.slice(0, 5);
	out.checks.noFloatArtifacts = dirty.length === 0;

	// ── 9) 카드 readout 이 MAX 를 표기하는가
	p.executeDamage = 0.15;
	p.pen = 0.2;
	const exRead = lu.readoutForChoice(lu.makeChoice(byId('execute'), lu.rarities[0]));
	const piRead = lu.readoutForChoice(lu.makeChoice(byId('pierce'), lu.rarities[0]));
	p.critChance = 1;
	const crRead = lu.readoutForChoice(lu.makeChoice(byId('critChance'), lu.rarities[0]));
	out.checks.readoutCapped = exRead?.capped === true && piRead?.capped === true && crRead?.capped === true;

	return out;
});

const failed = Object.entries(result.checks).filter(([, v]) => !v);
console.log(JSON.stringify({ ...result, errors: errors.slice(0, 5) }, null, 1));
console.log(failed.length === 0 && errors.length === 0
	? `PASS (${Object.keys(result.checks).length} checks)`
	: `FAIL: ${failed.map(([k]) => k).join(', ')} ERR:${errors.length}`);
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
