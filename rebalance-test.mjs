// 2026-09-04 대개편 회귀 테스트 — 흡혈 예산·레벨 성장·슬롯 게이트·스탯 MAX·재도전 골드·
// 필살기 게이지·스킬 숙련·위험 이벤트·데미지 폰트.
// Run: (vite preview --port 5199) && node rebalance-test.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(1500);

const checks = [];
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info }); };

// ── 1) 순수 로직 + 성장 + 흡혈 예산
const r1 = await page.evaluate(() => {
	const s = window.__gameScene;
	const p = s.player;
	const so = s.swordOrbit;
	s.enemyManager.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	// 이 테스트의 처치는 경험치를 주지 않는다 — 레벨업 창이 열리면 update 루프가 멈춘다
	s.progression.xpMultiplier = 0;

	const out = {};
	// 성장: 레벨 40 → 검 피해가 커지고 HP 가 커진다
	const dmg1 = so.swords[0].damage;
	const hp1 = p.maxHp;
	p.hp = Math.round(p.maxHp * 0.3);
	for (let l = 2; l <= 40; l += 1) s.applyLevelGrowth(l);
	out.growthDamage = so.swords[0].damage / dmg1;
	out.growthHp = p.maxHp / hp1;
	out.hpAfterHeal = p.hp / p.maxHp; // 10% × 39 회복 → 사실상 만피
	out.growthMult = so.growthDamageMult;

	// 흡혈 예산: 대량 흡혈이 초당 6% 로 잘린다
	p.hp = Math.round(p.maxHp * 0.2);
	p.lifesteal = 0.03;
	s.augmentSystem.lifestealPct = 0.05;
	const hpBefore = p.hp;
	const now = s.time.now;
	// 같은 프레임에 20번 타격 (각 타격 피해 = maxHp — 예산 없으면 즉시 만피)
	for (let i = 0; i < 20; i += 1) s.augmentSystem.onSwordHit(so.swords[0], { x: p.x + 40, y: p.y, hp: 1e9, maxHp: 1e9, catalog: {} }, p.maxHp, false);
	out.healedRatio = (p.hp - hpBefore) / p.maxHp;
	out.healBudget = p.healBudget;
	out.lifestealCap = window.__lifestealCap ?? null;
	// 예산 회복: 1초 뒤면 다시 6% 만큼
	p.healBudgetAt = now - 2000;
	for (let i = 0; i < 3; i += 1) s.augmentSystem.onSwordHit(so.swords[0], { x: p.x + 40, y: p.y, hp: 1e9, maxHp: 1e9, catalog: {} }, p.maxHp, false);
	out.healedRatio2 = (p.hp - hpBefore) / p.maxHp;
	p.lifesteal = 0;
	s.augmentSystem.lifestealPct = 0;

	// 슬롯 게이트
	out.slotUnlockRound = so.nextSlotUnlockRound();
	out.canUnlockR0 = so.canUnlockSlotAt(0);
	out.canUnlockR3 = so.canUnlockSlotAt(3);
	out.slotCost = so.nextSlotUnlockCost();

	// 스탯 MAX
	const shop = s.shopSystem;
	const defenseEntry = (shop.ui?.constructor && null) || null;
	const stats = (window.__shopCatalog ?? null);
	p.defense = 60;
	out.defenseMaxed = shop.isStatMaxed({ id: 'defense', type: 'defenseAdd', value: 4, baseCost: 25 });
	p.defense = 2;
	out.defenseNotMaxed = shop.isStatMaxed({ id: 'defense', type: 'defenseAdd', value: 4, baseCost: 25 });
	// 골드 있어도 MAX 면 안 팔린다
	p.defense = 60;
	s.pickupSystem.runGold = 1000;
	shop.buyStat({ id: 'defense', type: 'defenseAdd', value: 4, baseCost: 25 });
	out.goldAfterMaxBuy = s.pickupSystem.runGold;
	p.defense = 2;

	// 적 스케일: 50라 잡몹 HP 가 1라의 1000배 이상
	s.enemyManager.setRound?.(1);
	return out;
});
check('growth: Lv40 damage ×', r1.growthDamage > 4 && r1.growthDamage < 8, `${r1.growthDamage.toFixed(2)} (growthMult ${r1.growthMult.toFixed(2)})`);
check('growth: Lv40 hp ×', r1.growthHp > 6 && r1.growthHp < 14, `${r1.growthHp.toFixed(2)}`);
check('levelup 10% heal', r1.hpAfterHeal > 0.95, `${r1.hpAfterHeal.toFixed(2)}`);
check('lifesteal budget caps burst heal ≤ 6%', r1.healedRatio <= 0.061 && r1.healedRatio > 0.02, `${(r1.healedRatio * 100).toFixed(1)}%`);
check('lifesteal budget refills over time', r1.healedRatio2 > r1.healedRatio + 0.03, `${(r1.healedRatio2 * 100).toFixed(1)}%`);
check('slot gate: 3rd slot needs round 3', r1.slotUnlockRound === 3 && r1.canUnlockR0 === false && r1.canUnlockR3 === true, `round ${r1.slotUnlockRound}`);
check('slot cost 150', r1.slotCost === 150, `${r1.slotCost}`);
check('stat MAX detect', r1.defenseMaxed === true && r1.defenseNotMaxed === false);
check('stat MAX purchase blocked', r1.goldAfterMaxBuy === 1000, `${r1.goldAfterMaxBuy}`);

// ── 2) 적 스케일링 수치 (순수 함수, 씬 훅 통해 접근 불가 → EnemyManager 스폰으로 실측)
const r2 = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const p = s.player;
	const hpAt = (round) => {
		s.waveSystem.startRound(round);
		s.waveSystem.roundActive = false;
		const e = m.spawnEnemy(s, p, 'skullwolf', { x: p.x + 500, y: p.y });
		const hp = e ? e.maxHp : -1;
		const dmg = e ? e.damage : -1;
		if (e) m.recycleEnemy(e);
		return { hp, dmg };
	};
	const a = hpAt(1);
	// 50 은 보스 라운드 — 컷인이 update 루프를 막으므로 49 로 측정한다
	const b = hpAt(49);
	// 원상복구
	s.waveSystem.startRound(1);
	s.waveSystem.roundActive = false;
	s.bossCutIn?.hide?.();
	m.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
	for (const e of m.enemies.getChildren()) m.recycleEnemy(e);
	return { r1: a, r50: b };
});
check('enemy hp r49/r1 ≥ 1000×', r2.r50.hp / r2.r1.hp >= 1000, `${r2.r1.hp} → ${r2.r50.hp} (${(r2.r50.hp / r2.r1.hp).toFixed(0)}×)`);
check('enemy dmg r49/r1 in 100~600×', r2.r50.dmg / r2.r1.dmg >= 100 && r2.r50.dmg / r2.r1.dmg <= 600, `${r2.r1.dmg} → ${r2.r50.dmg}`);

// ── 3) 필살기 게이지 + 스킬 숙련
const r3 = await page.evaluate(() => {
	const s = window.__gameScene;
	const p = s.player;
	const sk = s.activeSkills;
	const out = {};
	out.chargeStart = sk.ultCharge;
	sk.addUltCharge(0.5);
	out.notReadyCast = sk.useUltimate();
	out.chargeHalf = sk.ultCharge;
	sk.addUltCharge(0.6);
	out.ready = sk.isUltReady;
	// 적 하나 옆에 두고 발동 → 피해가 들어가야 한다
	const e = s.enemyManager.spawnEnemy(s, p, 'skullwolf-brute', { x: p.x + 80, y: p.y });
	const hpBefore = e.hp;
	out.cast = sk.useUltimate();
	out.element = sk.lastUltElement;
	out.enemyHpAfter = e.hp;
	out.enemyHpBefore = hpBefore;
	out.chargeAfter = sk.ultCharge;
	s.enemyManager.recycleEnemy(e);
	// 처치 경험치로 레벨업 창이 열렸으면 닫는다 (뒤 검사들은 update 루프가 돌아야 한다)
	if (s.levelUpSystem.isOpen) {
		s.levelUpSystem.pendingChoices = 0;
		s.levelUpSystem.close();
	}

	// 스킬 숙련
	out.levelBefore = sk.levels.dash;
	out.cdBefore = sk.cooldownMs('dash');
	out.canLevel = sk.canLevelUp('dash');
	sk.levelUpSkill('dash');
	out.levelAfter = sk.levels.dash;
	out.cdAfter = sk.cooldownMs('dash');
	out.distanceAdd = sk.mods.dashDistanceAdd;
	sk.levelUpSkill('dash');
	out.level3 = sk.levels.dash;
	out.ghostPct = sk.mods.dashGhostDamagePct;
	out.cannotLevelMore = !sk.canLevelUp('dash');
	// 숙련 카드는 스킬 트리로 흡수됐다 (2026-09-04) — 카드 풀에 없어야 한다
	const lu = s.levelUpSystem;
	out.skillCards = lu.upgrades.filter((u) => u.type === 'skillLevel').length;
	return out;
});
check('ult: not castable at 50%', r3.notReadyCast === false && Math.abs(r3.chargeHalf - 0.5) < 1e-6);
// 발동 직후 처치 충전(0.012)이 들어올 수 있으므로 0.1 미만이면 소진으로 본다
check('ult: ready at 100% and casts', r3.ready === true && r3.cast === true && r3.chargeAfter < 0.1, `element=${r3.element} charge=${r3.chargeAfter}`);
check('ult: damages nearby enemy', r3.enemyHpAfter < r3.enemyHpBefore, `${r3.enemyHpBefore} → ${r3.enemyHpAfter}`);
check('skill level: dash Ⅱ shortens cooldown', r3.levelAfter === 2 && r3.cdAfter < r3.cdBefore && r3.distanceAdd >= 0.25, `${r3.cdBefore}→${r3.cdAfter}`);
check('skill level: dash Ⅲ ghost damage', r3.level3 === 3 && r3.ghostPct >= 0.45 && r3.cannotLevelMore);
check('skill level cards removed from level-up pool (tree owns them)', r3.skillCards === 0, `${r3.skillCards}`);

// ── 4) 위험 이벤트 — 골렘 (성공) / 습격 (실패 → 격노) / 저주 (정화)
await page.waitForTimeout(1200);
await page.evaluate(() => {
	const s = window.__gameScene;
	if (s.levelUpSystem.isOpen) {
		s.levelUpSystem.pendingChoices = 0;
		s.levelUpSystem.close();
	}
});
const r4 = await page.evaluate(async () => {
	const s = window.__gameScene;
	const p = s.player;
	const de = s.dangerEvents;
	const out = {};
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	// 처치 경험치로 레벨업 창이 열리면 update 루프가 멈춘다 — 이 구간은 경험치를 끊는다
	s.progression.xpMultiplier = 0;
	s.waveSystem.roundActive = true;
	s.waveSystem.round = 20;
	// 라운드 전환 감지를 먼저 태운다 (실제 게임에서는 startRound 가 이벤트보다 먼저다)
	de.update(16);

	// 골렘
	out.golemStarted = de.trigger('golem');
	const golem = de.current?.enemies[0]?.enemy;
	out.golemSpeed = golem?.speed;
	const goldBefore = s.pickupSystem.runGold;
	const ultBefore = s.activeSkills.ultCharge;
	if (golem) s.enemyManager.takeDamage(golem, golem.hp + 1, p, { ignoreResist: true });
	await wait(1600); // 사망 애니메이션 → ENEMY_DIED → 이벤트 판정
	out.golemResolved = de.current === null;
	out.golemHistory = de.history[de.history.length - 1];
	out.ultAfterGolem = s.activeSkills.ultCharge - ultBefore;
	s.pickupSystem.collectAllItems?.();
	await wait(200);
	out.goldGain = s.pickupSystem.runGold - goldBefore;

	// 습격 실패 → 격노
	out.raidStarted = de.trigger('raid');
	const raidEnemies = de.current?.enemies.map((e) => e.enemy) ?? [];
	out.raidCount = raidEnemies.length;
	const dmgBefore = raidEnemies[0]?.damage;
	if (de.current) de.current.until = s.time.now - 1;
	await wait(300);
	out.raidResolved = de.current === null;
	out.raidFrenzy = raidEnemies[0] ? raidEnemies[0].damage > dmgBefore : false;
	for (const e of raidEnemies) s.enemyManager.recycleEnemy(e);

	// 저주 정화: 제단 위로 이동
	out.curseStarted = de.trigger('curse');
	const cur = de.current;
	if (cur) { p.x = cur.x; p.y = cur.y; }
	const ultBefore2 = s.activeSkills.ultCharge;
	await wait(4600);
	out.curseResolved = de.current === null;
	out.curseHistory = de.history[de.history.length - 1];
	out.ultAfterCurse = s.activeSkills.ultCharge - ultBefore2;
	s.waveSystem.roundActive = false;
	return out;
});
check('golem event: stationary + success reward', r4.golemStarted && r4.golemSpeed === 0 && r4.golemResolved && r4.golemHistory?.success === true && r4.ultAfterGolem > 0.29, JSON.stringify(r4.golemHistory));
check('golem event: gold dropped', r4.goldGain > 0, `${r4.goldGain}`);
check('raid event: 3 elites, timeout → frenzy', r4.raidStarted && r4.raidCount === 3 && r4.raidResolved && r4.raidFrenzy);
check('curse event: purify on altar → ult +50%', r4.curseStarted && r4.curseResolved && r4.curseHistory?.success === true && r4.ultAfterCurse > 0.49, JSON.stringify(r4.curseHistory));

// ── 5) 데미지 폰트 (큰 숫자·치명 캐스케이드) 스크린샷
const r5 = await page.evaluate(() => {
	const s = window.__gameScene;
	const ve = s.visualEffects;
	const p = s.player;
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	// 샌드박스(소프트웨어 렌더링)는 fps 가 낮아 FX 스로틀이 켜진다 — 캐스케이드 판정을 위해 고정
	ve.fxThrottle = () => 1;
	const cases = [
		[-200, -150, 48213, false, null],
		[140, -150, 152880, true, null],
		[-200, -50, 3200, false, '#93c5fd'],
		[140, -50, 1234567, true, null],
		[-200, 50, 980, false, '#ff7a7a'],
		[140, 50, '+2400', false, '#84b04a'],
	];
	for (const [dx, dy, dmg, crit, color] of cases) ve.showDamageText(p.x + dx, p.y + dy, dmg, crit, color);
	return {
		bitmapEntries: ve.floatingBitmaps?.length ?? -1,
		parts: ve.floatingBitmaps?.map((e) => e.parts.length) ?? [],
		fonts: [0, 7, 8, 9].map((i) => s.cache.bitmapFont.exists(`damage-font-${i}`)),
	};
});
check('damage font: all rows registered', r5.fonts.every(Boolean), JSON.stringify(r5.fonts));
check('damage font: crit cascade splits digits', r5.parts.some((n) => n > 1) && r5.bitmapEntries === 6, JSON.stringify(r5.parts));
await page.waitForTimeout(220);
await page.screenshot({ path: `${outDir}/rebalance-dmgfont.png` });

// HUD 확인 (필살기 아이콘)
await page.evaluate(() => { window.__gameScene.activeSkills.addUltCharge(0.65); });
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/rebalance-hud.png` });

const gameErrors = errors.filter((m) => !m.includes('Proxy Authentication') && !m.includes('Failed to load resource'));
const passed = checks.filter((c) => c.ok).length;
console.log(JSON.stringify({ passed, total: checks.length, checks, errors: gameErrors }, null, 2));
await browser.close();
process.exit(passed === checks.length && gameErrors.length === 0 ? 0 : 1);
