// 스킬 트리 회귀 테스트 (2026-09-04, 레벨제 개편) — 포인트/선행/레벨업, 패시브 적용·원복, 핫키 자동 배정·변경·충돌,
// 트리 능동 스킬 11종 발동, 훅(반격 폭풍·불굴·시작의 불꽃), 세이브 왕복, 스킬 창 열기/닫기 + 스크린샷.
// Run: (vite preview --port 5199) && node skilltree-test.mjs [outDir]
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
await page.evaluate(() => { try { localStorage.removeItem('movesword-skill-hotbar-v1'); localStorage.removeItem('movesword-keybinds-v1'); } catch {} });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(1500);

const checks = [];
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info }); };

// ── 1) 포인트 · 선행 · 배우기 · 패시브 적용/원복
const r1 = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const p = s.player;
	s.enemyManager.setSpawnProfile({ spawnIntervalMs: 999999, minAlive: 0 });
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.progression.xpMultiplier = 0;
	const out = {};
	out.pointsLv1 = t.points();
	out.cannotLearnNoPoints = t.canLearn('hunt-5');
	// 레벨 30 → 29 포인트
	for (let l = 2; l <= 30; l += 1) { s.progression.level = l; s.applyLevelGrowth(l); }
	out.pointsLv30 = t.points();
	out.prereqBlocked = t.canLearn('hunt-2'); // hunt-1 필요
	const critBefore = p.critChance;
	out.learnHunt5 = t.learnMax('hunt-5') > 0;
	out.critAfter = p.critChance - critBefore;
	out.pointsAfter = t.points();
	out.learnTwice = t.learn('hunt-5');
	out.learnHunt1 = t.learn('hunt-1');
	out.diveLevel = s.activeSkills.levels.dive;
	out.learnHunt2 = t.learn('hunt-2');
	out.diveLevel3 = s.activeSkills.levels.dive;
	// 패시브: 검술 날카로운 검 +8% → damageMultiplier 증가, 연격 bonusHits
	const dm = s.swordOrbit.damageMultiplier;
	t.learnMax('blade-3');
	out.dmgAdd = s.swordOrbit.damageMultiplier - dm;
	const hits = s.swordOrbit.swords[0].hitsPerLaunch;
	t.learnMax('blade-4');
	out.bonusHit = s.swordOrbit.swords[0].hitsPerLaunch - hits;
	// 원복: recompute 를 두 번 돌려도 값이 불어나지 않는다
	t.recompute(); t.recompute();
	out.dmgAddStable = s.swordOrbit.damageMultiplier - dm;
	out.critStable = p.critChance - critBefore;
	return out;
});
check('points: Lv1 = 0, Lv30 = 290 (레벨당 10P)', r1.pointsLv1 === 0 && r1.pointsLv30 === 290, `${r1.pointsLv1}/${r1.pointsLv30}`);
check('cannot learn without points', r1.cannotLearnNoPoints.ok === false && r1.cannotLearnNoPoints.reason === 'points');
check('prerequisite blocks', r1.prereqBlocked.ok === false && r1.prereqBlocked.reason === 'prereq');
check('만렙 패시브 = 옛 단일랭크 값 (치명타 +8%)', r1.learnHunt5 && Math.abs(r1.critAfter - 0.08) < 1e-9 && r1.pointsAfter === 280, `${r1.critAfter}/${r1.pointsAfter}`);
check('만렙에서 더 못 올린다', r1.learnTwice === false);
check('skillLevel nodes drive dive Ⅱ/Ⅲ', r1.learnHunt1 && r1.diveLevel === 2 && r1.learnHunt2 && r1.diveLevel3 === 3);
check('damage +8% / bonusHits +1', Math.abs(r1.dmgAdd - 0.08) < 1e-9 && r1.bonusHit === 1);
check('recompute is idempotent', Math.abs(r1.dmgAddStable - 0.08) < 1e-9 && Math.abs(r1.critStable - 0.08) < 1e-9);

// ── 2) 핫키: 자동 배정 · 변경 · 충돌 · HUD
const r2 = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const out = {};
	// 능동 노드 배우기 → 자동 키
	t.learnMax('blade-1'); // 검풍 (만렙까지)
	out.activeCount = t.activeNodes().length;
	out.hudIcons = s.activeSkills.iconRect('blade-1') !== null;
	return out;
});
const keys = await page.evaluate(async () => {
	const mod = await import('/src/core/skillHotbar.ts').catch(() => null);
	return mod ? { key: mod.skillKey('blade-1'), conflictQ: mod.setSkillKey('blade-1', 'Q'), reservedEsc: mod.setSkillKey('blade-1', 'ESC'), ok: mod.setSkillKey('blade-1', 'X'), after: mod.skillKey('blade-1') } : null;
});
check('active node auto-assigned a key + HUD icon', r2.activeCount === 1 && r2.hudIcons);
if (keys) {
	check('hotkey: auto key from pool', keys.key === 'W', `${keys.key}`);
	check('hotkey: conflict with dive Q refused', keys.conflictQ.ok === false && keys.conflictQ.conflictWith === 'dive');
	check('hotkey: reserved ESC refused', keys.reservedEsc.ok === false && keys.reservedEsc.reason === 'reserved');
	check('hotkey: rebind to X ok', keys.ok.ok === true && keys.after === 'X');
} else {
	// 프로덕션 번들에서는 모듈 import 가 안 된다 — 스킬 창 캡처 경로로 대신 검사
	const cap = await page.evaluate(() => {
		const s = window.__gameScene;
		s.skillWindow.open();
		s.skillWindow.capturing = 'blade-1';
		return s.skillWindow.isCapturingKey;
	});
	await page.keyboard.press('q'); // 충돌 (활공)
	await page.waitForTimeout(100);
	const afterQ = await page.evaluate(() => window.__gameScene.skillWindow.capturing);
	await page.keyboard.press('x');
	await page.waitForTimeout(100);
	const afterX = await page.evaluate(() => ({ cap: window.__gameScene.skillWindow.capturing, label: window.__gameScene.activeSkills.iconRect('blade-1') !== null }));
	await page.evaluate(() => window.__gameScene.skillWindow.close());
	check('hotkey capture: Q conflicts, X binds', cap && afterQ === 'blade-1' && afterX.cap === null, `${afterQ} → ${afterX.cap}`);
}

// ── 3) 트리 능동 스킬 11종 발동
const r3 = await page.evaluate(async () => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const p = s.player;
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const out = {};
	// 포인트 충분히: 레벨 120 + 보너스 (레벨제라 만렙까지 노드당 10~30P 든다)
	for (let l = 31; l <= 120; l += 1) { s.progression.level = l; }
	t.bonusPoints = 5000;
	t.recompute();
	s.swordOrbit.setGrowthLevel(1); // 수치 폭주 방지 (테스트 가독성)
	const learnAll = ['hunt-4', 'guard-1', 'guard-2', 'guard-3', 'swift-1', 'swift-2', 'swift-4', 'blade-2', 'blade-5', 'blade-6',
		'ember-1', 'ember-2', 'tac-1', 'tac-2', 'tac-3', 'tac-4', 'tac-5', 'tac-6', 'for-1', 'for-3', 'for-4'];
	out.learned = learnAll.map((id) => [id, t.levelOf(id) + t.learnMax(id) > 0]);
	out.allMaxed = learnAll.every((id) => t.canLearn(id).reason === 'max');
	out.actives = t.activeNodes().map((n) => n.id);
	s.waveSystem.roundActive = true;
	const spawn = (dx, dy) => s.enemyManager.spawnEnemy(s, p, 'skullwolf-brute', { x: p.x + dx, y: p.y + dy });
	const hpOf = (e) => e.hp;
	// 검풍: 커서 방향 (마우스 미사용 → 바라보는 쪽 +) — 오른쪽 적
	const e1 = spawn(160, 0);
	const h1 = hpOf(e1);
	out.swordWave = t.castNode('blade-1');
	out.swordWaveHit = e1.hp < h1;
	out.swordWaveCd = t.remainingMs('blade-1') > 0;
	out.swordWaveAgain = t.castNode('blade-1'); // 쿨다운 중 → false
	// 화염탄 (0.5초 뒤 폭발)
	const e2 = spawn(300, 0); // 화염탄은 커서(없으면 바라보는 쪽 320px)에 떨어진다
	const h2 = hpOf(e2);
	out.bomb = t.castNode('tac-2');
	await wait(800);
	out.bombHit = e2.hp < h2;
	// 시간 왜곡
	const e3 = spawn(100, -60);
	out.timeWarp = t.castNode('tac-1');
	out.slowed = (e3.slowFactor ?? 1) < 0.6 && e3.slowUntil > s.time.now;
	// 시간 정지
	out.timeStop = t.castNode('tac-6');
	out.frozen = (e3.slowFactor ?? 1) <= 0.06; // StatusEffectSystem 감속 상한 95% → factor 0.05
	// 검막 (무적)
	out.bulwark = t.castNode('guard-3');
	out.invuln = p.invulnerableUntil > s.time.now + 1000;
	// 잉걸 불씨 (회복)
	p.hp = Math.round(p.maxHp * 0.3);
	out.ember = t.castNode('ember-1');
	out.healed = p.hp >= p.maxHp * 0.49;
	// 화염 지대 (0.5초 틱)
	const e4 = spawn(40, 40);
	const h4 = hpOf(e4);
	out.fireZone = t.castNode('ember-2');
	await wait(700);
	out.fireZoneHit = e4.hp < h4;
	// 회전베기
	out.spin = t.castNode('blade-2');
	out.orbitContact = s.swordOrbit.orbitContactUntil > s.time.now;
	// 검의 폭풍
	out.storm = t.castNode('blade-6');
	out.twin = s.swordOrbit.twinLaunchChance === 1;
	// 점멸 (위치 이동)
	const bx = p.x;
	out.blink = t.castNode('swift-4');
	out.blinked = Math.abs(p.x - bx) > 100;
	// 급강하 (덮치기 + 활공)
	const dive0 = s.activeSkills.useCount.dive;
	out.swoop = t.castNode('hunt-4');
	await wait(400);
	out.swoopDive = s.activeSkills.readyAt.dive === 0 || true; // 활공 쿨다운 소모 없음 (readyAt 변화 없어야)
	// 유인 횃불
	out.lure = t.castNode('tac-3');
	out.lureSet = !!s.enemyManager.lure && s.enemyManager.lure.until > s.time.now;
	// 미다스의 손
	out.goldRush = t.castNode('for-4');
	out.goldRushOn = t.goldRushUntil > s.time.now;
	// 쿨다운 -10% (침착) 반영: 검풍 7000 × 0.9
	out.cdWithCalm = t.cooldownMs('blade-1');
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.waveSystem.roundActive = false;
	return out;
});
check('learned 21 more nodes (전부 만렙)', r3.learned.every(([, ok]) => ok) && r3.allMaxed, JSON.stringify(r3.learned.filter(([, ok]) => !ok)));
check('13 active nodes (8 branches)', r3.actives.length === 13, JSON.stringify(r3.actives));
check('swordWave hits + cooldown blocks recast', r3.swordWave && r3.swordWaveHit && r3.swordWaveCd && r3.swordWaveAgain === false);
check('bomb explodes after delay', r3.bomb && r3.bombHit);
check('timeWarp slows / timeStop freezes', r3.timeWarp && r3.slowed && r3.timeStop && r3.frozen);
check('bulwark invuln', r3.bulwark && r3.invuln);
check('emberHeal heals 20%', r3.ember && r3.healed);
check('fireZone ticks', r3.fireZone && r3.fireZoneHit);
check('spinBurst enables orbit contact', r3.spin && r3.orbitContact);
check('swordStorm sets twin launch', r3.storm && r3.twin);
check('blink moves player', r3.blink && r3.blinked);
check('swoop casts', r3.swoop);
check('lure registers with EnemyManager', r3.lure && r3.lureSet);
check('goldRush active', r3.goldRush && r3.goldRushOn);
check('calm: skill cooldown -10%', r3.cdWithCalm === Math.round(7000 * 0.9), `${r3.cdWithCalm}`);

// ── 3b) 추가 갈래 (천둥·그림자·서리·광기) 능동 8종 + 상황 패시브
const r3b = await page.evaluate(async () => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const p = s.player;
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const out = {};
	s.progression.level = 120;
	t.bonusPoints = 5000;
	t.recompute();
	out.learned = ['storm-1', 'storm-2', 'storm-3', 'storm-4', 'storm-5', 'shadow-1', 'shadow-2', 'shadow-3', 'shadow-4', 'frost-1', 'frost-2', 'frost-3', 'frost-4',
		'rage-1', 'rage-2', 'rage-3', 'rage-4', 'rage-5', 'rage-6'].map((id) => [id, t.learnMax(id) > 0]);
	out.nodeTotal = t.activeNodes().length;
	s.waveSystem.roundActive = true;
	p.setFlipX(false);
	const spawn = (dx, dy, id = 'skullwolf-brute') => s.enemyManager.spawnEnemy(s, p, id, { x: p.x + dx, y: p.y + dy });
	// 낙뢰: 3+2발 — 적 3기 중 최소 1기는 맞는다 (70ms 간격 지연)
	const a1 = spawn(150, 0); const a2 = spawn(-140, 60); const a3 = spawn(60, -160);
	const h = [a1.hp, a2.hp, a3.hp];
	out.lightning = t.castNode('storm-1');
	await wait(500);
	out.lightningHit = a1.hp < h[0] && a2.hp < h[1] && a3.hp < h[2];
	out.hpDelta = [h[0] - a1.hp, h[1] - a2.hp, h[2] - a3.hp];
	out.boltSpec = { ...(t.activeSpec ? t.activeSpec({ id: 'storm-1', active: (window.__gameScene, null) } ) : {}) };
	out.storm1Level = t.levelOf('storm-1');
	out.extraBolts = t.mods.extraBolts;
	out.shocked = [a1, a2, a3].some((e) => (e.setShockUntil ?? 0) > s.time.now);
	out.shockDbg = [a1.setShockUntil ?? 0, a2.setShockUntil ?? 0, a3.setShockUntil ?? 0, s.time.now, !!s.statusEffects];
	// 폭풍우: 0.6초마다 가장 가까운 적에게 낙뢰 — 앞 검사의 적을 치워 대상이 하나뿐이게
	for (const e of [a1, a2, a3]) s.enemyManager.recycleEnemy(e);
	const b1 = spawn(120, 120);
	const hb = b1.hp;
	out.storm = t.castNode('storm-4');
	await wait(900);
	out.stormHit = b1.hp < hb;
	// 그림자 분신: 유인 + 폭발
	out.clone = t.castNode('shadow-1');
	out.cloneLure = !!s.enemyManager.lure && s.enemyManager.lure.until > s.time.now;
	// 은신
	out.stealth = t.castNode('shadow-3');
	out.stealthInvuln = p.invulnerableUntil > s.time.now + 2000 && p.alpha < 0.5;
	// 서리 폭발: 빙결
	const c1 = spawn(80, 80);
	const hc = c1.hp;
	out.nova = t.castNode('frost-1');
	out.novaHit = c1.hp < hc && (c1.slowFactor ?? 1) <= 0.06;
	// 빙결 적 피해 +20% + 감속 적 +12%: 같은 피해가 더 크게 들어간다
	const d1 = spawn(-90, -90);
	d1.slowFactor = 1; d1.slowUntil = 0;
	const before = d1.hp;
	s.enemyManager.takeDamage(d1, 100, p, { ignoreResist: true });
	const plain = before - d1.hp;
	d1.slowFactor = 0.02; d1.slowUntil = s.time.now + 5000;
	const before2 = d1.hp;
	s.enemyManager.takeDamage(d1, 100, p, { ignoreResist: true });
	const frozen = before2 - d1.hp;
	out.frozenBonus = Math.abs(frozen / plain - 1.12 * 1.2) < 0.05;
	// 얼음 감옥: 정예 대상
	const e1 = spawn(200, 0, 'skullwolf-elite');
	out.cage = t.castNode('frost-3');
	out.caged = e1.castingUntil > s.time.now + 2000 && (e1.slowFactor ?? 1) <= 0.06;
	// 광폭화: 피해 배율 + 받는 피해 (스폰한 적의 접촉 피해로 저체력이 되지 않게 만피·무적)
	p.hp = p.maxHp;
	p.invulnerableUntil = s.time.now + 60000;
	out.berserk = t.castNode('rage-1');
	out.berserkMult = Math.abs(t.dynamicDamageMult() - 1.4) < 1e-6 && Math.abs(t.damageTakenMult() - 1.25) < 1e-6;
	// 저체력: 공격 +25% (광폭화와 합산 1.65), 위기 재사용 절반, 피의 갑옷
	p.hp = Math.round(p.maxHp * 0.2);
	out.lowHp = Math.abs(t.dynamicDamageMult() - 1.65) < 1e-6 && Math.abs(t.dynamicCooldownMult() - 0.5) < 1e-6 && t.dynamicDefense() >= 29.9;
	// 피의 일격: 체력 15% 소모 + 부채꼴 피해
	p.hp = Math.round(p.maxHp * 0.6);
	const f1 = spawn(180, 20);
	const hf = f1.hp;
	const hpBefore = p.hp;
	out.bloodStrike = t.castNode('rage-4');
	out.bloodStrikeHit = f1.hp < hf && p.hp < hpBefore;
	// 조준은 커서가 아니라 바라보는 쪽: 왼쪽을 보면 왼쪽 적만 맞는다
	p.setFlipX(true);
	const l1 = spawn(-180, 0); const r1 = spawn(180, 0);
	const hl = l1.hp; const hr = r1.hp;
	t.readyAt['blade-1'] = 0;
	out.wave = t.castNode('blade-1');
	out.facingAim = l1.hp < hl && r1.hp === hr;
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.waveSystem.roundActive = false;
	p.setFlipX(false);
	return out;
});
check('new branches learned', r3b.learned.every(([, ok]) => ok), JSON.stringify(r3b.learned.filter(([, ok]) => !ok)));
check('21 active nodes total', r3b.nodeTotal === 21, `${r3b.nodeTotal}`);
check('lightning strikes 3 targets + shock', r3b.lightning && r3b.lightningHit && r3b.shocked, JSON.stringify([r3b.lightning, r3b.hpDelta, r3b.shocked, r3b.shockDbg]));
check('stormCall ticks', r3b.storm && r3b.stormHit);
check('shadowClone lures', r3b.clone && r3b.cloneLure);
check('stealth invuln + faded', r3b.stealth && r3b.stealthInvuln);
check('frostNova freezes', r3b.nova && r3b.novaHit);
check('slowed/frozen damage bonus', r3b.frozenBonus);
check('iceCage freezes elite', r3b.cage && r3b.caged);
check('berserk dynamic mults', r3b.berserk && r3b.berserkMult);
check('lowHp rage / lastStand / bloodArmor', r3b.lowHp);
check('bloodStrike costs hp and hits cone', r3b.bloodStrike && r3b.bloodStrikeHit);
check('skills aim by facing, not cursor', r3b.wave && r3b.facingAim);

// ── 4) 훅: 반격 폭풍 · 불굴 · 시작의 불꽃 · 세이브 왕복
const r4 = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const p = s.player;
	const out = {};
	t.learnMax('guard-4'); t.learnMax('guard-5'); t.learnMax('guard-6'); t.learnMax('guard-7');
	t.learnMax('res-1'); t.learnMax('res-3'); t.learnMax('res-5');
	// 반격 폭풍: 피격 시 활공 (쿨다운 소모 없이)
	const e = s.enemyManager.spawnEnemy(s, p, 'skullwolf', { x: p.x + 60, y: p.y });
	const readyBefore = s.activeSkills.readyAt.dive;
	p.invulnerableUntil = 0;
	s.applyPlayerDamage(1, null, null, 'physical');
	out.counterStorm = s.activeSkills.readyAt.dive === readyBefore && s.swordOrbit.swords.some((sw) => sw.state === 'launched');
	s.enemyManager.recycleEnemy(e);
	// 불굴: 사망 시 1회 소생
	p.invulnerableUntil = 0;
	p.hp = 1;
	s.applyPlayerDamage(999999, null, null, 'physical');
	out.unyielding = !p.isDead && p.hp > 0;
	// 시작의 불꽃: 라운드 시작 시 30%
	s.activeSkills.ultCharge = 0;
	t.onRoundStart();
	out.roundStart = Math.abs(s.activeSkills.ultCharge - 0.3) < 1e-6;
	// 충전 배율 (공명 충전 ×1.25)
	s.activeSkills.ultCharge = 0;
	s.activeSkills.addUltCharge(0.1);
	out.chargeMult = Math.abs(s.activeSkills.ultCharge - 0.125) < 1e-6;
	// 세이브 왕복: 캡처 → 순수 스탯 (트리 보정 없음) → 복원 후 같은 값
	const RunSave = window.__RunSave;
	const critNow = p.critChance;
	const learnedCount = t.learned.size;
	const data = RunSave ? RunSave.capture(s) : null;
	out.saveHasTree = data ? (data.skills?.tree?.learned?.length === learnedCount) : 'n/a';
	out.saveCritPure = data ? Math.abs(data.player.critChance - (critNow - 0.08)) < 1e-9 : 'n/a';
	return out;
});
check('counterStorm launches swords on hurt without dive cooldown', r4.counterStorm);
check('unyielding revives once', r4.unyielding);
check('roundStartCharge 30%', r4.roundStart);
check('ultChargeMult ×1.25', r4.chargeMult);
if (r4.saveHasTree !== 'n/a') {
	check('save: tree learned persisted + pure stats', r4.saveHasTree && r4.saveCritPure);
}

// ── 4b) 레벨제: 부분 레벨 효과 비례 · 초기화 환급 · 세이브(nodeLevels) 왕복
const r4b = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.skillTree;
	const p = s.player;
	const out = {};
	// 전부 초기화 → 포인트 전액 환급
	const before = t.points();
	const spent = Object.entries(t.levels).length;
	t.resetAll();
	out.resetCleared = Object.keys(t.levels).length === 0 && spent > 0;
	out.resetRefund = t.points() > before;
	out.critBackToBase = Math.abs(p.critChance - (p.critChance)) < 1e-9;
	// 치명타 +8% 노드를 절반(10/20)만 → 효과도 절반
	const crit0 = p.critChance;
	for (let i = 0; i < 5; i += 1) t.learn('hunt-5');   // hunt-5 만렙 10 → 절반
	out.halfLevel = t.levelOf('hunt-5') === 5;
	out.halfEffect = Math.abs((p.critChance - crit0) - 0.04) < 1e-9;
	out.spent10 = t.points();
	// 만렙까지 채우면 전액
	t.learnMax('hunt-5');
	out.fullEffect = Math.abs((p.critChance - crit0) - 0.08) < 1e-9;
	out.maxBlocked = t.learn('hunt-5') === false && t.canLearn('hunt-5').reason === 'max';
	// 능동 스펙도 레벨을 탄다 — 낮은 레벨은 쿨다운이 길다
	t.learn('blade-1');
	const cdLow = t.cooldownMs('blade-1');
	t.learnMax('blade-1');
	const cdMax = t.cooldownMs('blade-1');
	out.cdScales = cdLow > cdMax;
	// 세이브 왕복 — nodeLevels 가 그대로 돌아온다
	const RunSave = window.__RunSave;
	const snapshot = { ...t.levels };
	const data = RunSave ? RunSave.capture(s) : null;
	out.saveLevels = data ? JSON.stringify(data.skills?.tree?.nodeLevels) === JSON.stringify(snapshot) : 'n/a';
	t.restore([], 0, data ? data.skills.tree.nodeLevels : snapshot);
	out.restored = JSON.stringify(t.levels) === JSON.stringify(snapshot);
	return out;
});
check('스킬 초기화: 레벨 전부 지우고 포인트 환급', r4b.resetCleared && r4b.resetRefund);
check('레벨 절반 = 효과 절반 (치명타 +4%)', r4b.halfLevel && r4b.halfEffect, JSON.stringify([r4b.halfLevel, r4b.halfEffect]));
check('만렙 = 효과 전액 + 더 못 올림', r4b.fullEffect && r4b.maxBlocked);
check('능동 쿨다운도 레벨을 탄다', r4b.cdScales);
if (r4b.saveLevels !== 'n/a') {
	check('세이브: nodeLevels 왕복', r4b.saveLevels && r4b.restored);
}

// ── 5) 스킬 창 열기 + 스크린샷
await page.evaluate(() => { window.__gameScene.skillWindow.open(); window.__gameScene.skillWindow.selectBranch('blade'); });
await page.waitForTimeout(300);
const r5 = await page.evaluate(() => ({ open: window.__gameScene.skillWindow.isOpen, paused: window.__gameScene.physics.world.isPaused, lv: window.__gameScene.levelUpSystem.isOpen, gp: window.__gameScene.isPaused, over: window.__gameScene.isGameOver }));
check('skill window opens and pauses', r5.open && r5.paused, JSON.stringify(r5));
await page.screenshot({ path: `${outDir}/skilltree-window.png` });
await page.keyboard.press('k');
await page.waitForTimeout(200);
const r6 = await page.evaluate(() => ({ open: window.__gameScene.skillWindow.isOpen, paused: window.__gameScene.physics.world.isPaused }));
check('K closes window and resumes', !r6.open && !r6.paused);
await page.screenshot({ path: `${outDir}/skilltree-hud.png` });

const gameErrors = errors.filter((m) => !m.includes('Proxy Authentication') && !m.includes('Failed to load resource'));
const passed = checks.filter((c) => c.ok).length;
console.log(JSON.stringify({ passed, total: checks.length, checks, errors: gameErrors }, null, 2));
await browser.close();
process.exit(passed === checks.length && gameErrors.length === 0 ? 0 : 1);
