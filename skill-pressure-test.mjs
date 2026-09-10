// 스킬 압박 회귀 테스트 (2026-09-01 신설).
//
// "스킬은 생겼는데 스킬을 요구하는 적이 없다"는 지적에 대한 답을 검증한다.
//   (1) 편성 — 신규 적 2종이 라운드 15 이하에는 안 나오고 16부터 나온다
//   (2) 결집 사수 — 느린 유도탄(플레이어 이동속도보다 느림) · 귀소로 소거 · 대시로 이탈
//   (3) 장막 소환수 — 장막 안 적의 피해 감소 · 시전자 처치로 즉시 해제
//   (4) 보스 [전방위 조임] — 파훼 2경로(초록 틈 / 귀소 무적)
//   (5) 스킬 시너지 증강 6종 — 수치가 실제로 스킬에 배선되어 있다
//
// Run: node skill-pressure-test.mjs  (vite preview :5197 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
	results.push([name, ok, detail]);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 무시 */ } });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2600);

// 전투 상태로 고정 (대기마을 출발 · 레벨업 오버레이 봉인 · 사망 방지)
await page.evaluate(() => {
	const s = window.__gameScene;
	if (s.villageSystem?.isActive) s.villageSystem.depart();
	s.progression.xpToNext = 999999999;
	if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
	s.tutorial?.finish?.();
	s.player.maxHp = 100000;
	s.player.hp = 100000;
	// 검 4자루 확보 — "무리 전체" 판정과 궤적 피해를 보려면 1자루로는 부족하다
	const orbit = s.swordOrbit;
	const defs = orbit.swordCatalog ?? [];
	while (orbit.swords.length < 4 && defs.length > 0) {
		if (orbit.swords.length >= orbit.getEffectiveMaxSwords()) orbit.unlockSlot();
		orbit.addSword(s, defs[orbit.swords.length % defs.length]);
	}
});
await page.waitForTimeout(700);

// ─────────────────────────────────────────────────────────────
// (1) 편성 — 라운드 15 이하 미등장 / 16부터 등장
// ─────────────────────────────────────────────────────────────
const roster = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const volley = m.getEnemyTypeById('volley-marksman');
	const veil = m.getEnemyTypeById('veil-caller');
	const poolIds = (round) => (s.waveSystem.getWaveForRound(round).pool ?? []).map((p) => p.id);
	const NEW = ['volley-marksman', 'veil-caller'];
	const earliest = [];
	for (let r = 1; r <= 60; r += 1) {
		if (poolIds(r).some((id) => NEW.includes(id))) { earliest.push(r); break; }
	}
	return {
		volley: volley ? { name: volley.name, type: volley.behavior?.type, speed: volley.behavior?.projectileSpeed, keep: volley.behavior?.keepDistance, turn: volley.behavior?.homingTurnRate, dmg: volley.behavior?.projectileDamage } : null,
		veil: veil ? { name: veil.name, type: veil.behavior?.type, radius: veil.behavior?.veilRadius, mult: veil.behavior?.veilDamageMult, keep: veil.behavior?.keepDistance } : null,
		earliestRound: earliest[0] ?? null,
		r16: poolIds(16),
		r30: poolIds(30),
		playerSpeed: s.player.moveSpeed,
		swordScan: s.swordOrbit.scanRadius,
	};
});
check('카탈로그: 결집 사수 = volley 거동',
	roster.volley?.type === 'volley' && roster.volley?.name === '결집 사수', JSON.stringify(roster.volley));
check('카탈로그: 장막 소환수 = veil 거동',
	roster.veil?.type === 'veil' && roster.veil?.name === '장막 소환수', JSON.stringify(roster.veil));
check('설계: 유도탄 속도 < 플레이어 이동속도 (회피 보장)',
	roster.volley.speed < roster.playerSpeed * 0.5,
	`탄 ${roster.volley.speed} vs 이동 ${roster.playerSpeed}`);
check('설계: 사수 유지거리 > 검 스캔 반경 (자동 타격 불가)',
	roster.volley.keep > roster.swordScan, `keep ${roster.volley.keep} > scan ${roster.swordScan}`);
check('설계: 장막 소환수 유지거리 > 검 스캔 반경',
	roster.veil.keep > roster.swordScan, `keep ${roster.veil.keep} > scan ${roster.swordScan}`);
check('편성: 라운드 15 이하 미등장 · 16부터 등장',
	roster.earliestRound === 16, `첫 등장 라운드 ${roster.earliestRound}`);
check('편성: 라운드 16/30 풀에 신규 2종 포함',
	roster.r16.includes('volley-marksman') && roster.r30.includes('volley-marksman')
	&& roster.r30.includes('veil-caller'), JSON.stringify({ r16: roster.r16.length, r30: roster.r30.length }));

// ─────────────────────────────────────────────────────────────
// (2) 결집 사수 — 유도탄 생성 / 유도 / 귀소 소거 / 대시 이탈
// ─────────────────────────────────────────────────────────────
const volleyFire = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	// 남아 있는 탄을 비우고 시작
	for (const b of m.projectiles.getChildren()) m.recycleProjectile(b);
	const shooter = m.spawnEnemy(s, s.player, 'volley-marksman', { x: s.player.x + 470, y: s.player.y });
	shooter.hp = 999999; shooter.maxHp = 999999;
	m.fireProjectiles(shooter, s.player, shooter.behavior);
	const live = m.projectiles.getChildren().filter((b) => b.active);
	window.__shooter = shooter;
	return {
		count: live.length,
		homing: live.every((b) => (b.homingTurnRate ?? 0) > 0),
		speeds: live.map((b) => Math.round(Math.hypot(b.body.velocity.x, b.body.velocity.y))),
		damage: live[0]?.damage ?? 0,
		maxHp: s.player.maxHp,
	};
});
check('사수: 유도탄 다발 살포 (4발)', volleyFire.count === 4, `${volleyFire.count}발`);
check('사수: 전부 유도탄 (선회량 > 0)', volleyFire.homing === true);
check('사수: 탄속 일정 · 130px/s 근처',
	volleyFire.speeds.every((v) => v >= 120 && v <= 140), JSON.stringify(volleyFire.speeds));
check('사수: 즉살 금지 — 1발 피해가 최대 체력의 5% 미만',
	volleyFire.damage > 0 && volleyFire.damage < volleyFire.maxHp * 0.05,
	`${volleyFire.damage} / ${volleyFire.maxHp}`);

// 유도 확인: 플레이어를 옆으로 옮기고 탄 각도가 그쪽으로 도는지 본다
const homingProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const bullet = m.projectiles.getChildren().find((b) => b.active);
	if (!bullet) return null;
	const angleTo = () => Math.atan2(s.player.y - bullet.y, s.player.x - bullet.x);
	const heading = () => Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
	const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
	window.__probeBullet = bullet;
	return { before: Math.abs(wrap(angleTo() - heading())) };
});
await page.waitForTimeout(600);
const homingAfter = await page.evaluate(() => {
	const s = window.__gameScene;
	const bullet = window.__probeBullet;
	if (!bullet?.active) return null;
	const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
	const angleTo = Math.atan2(s.player.y - bullet.y, s.player.x - bullet.x);
	const heading = Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
	return { after: Math.abs(wrap(angleTo - heading)) };
});
check('사수: 유도 — 시간이 지나면 조준 오차가 줄어든다',
	homingProbe && homingAfter && homingAfter.after <= homingProbe.before + 0.02,
	JSON.stringify({ ...homingProbe, ...homingAfter }));

// 귀소(SPACE): 날아드는 탄을 쳐낸다
const recallClear = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	for (const b of m.projectiles.getChildren()) m.recycleProjectile(b);
	// 플레이어 코앞에 유도탄 6발을 배치한다
	const shooter = window.__shooter;
	for (let i = 0; i < 6; i += 1) {
		const a = (Math.PI * 2 * i) / 6;
		shooter.setPosition(s.player.x + Math.cos(a) * 90, s.player.y + Math.sin(a) * 90);
		m.fireProjectiles(shooter, s.player, { ...shooter.behavior, projectileCount: 1 });
	}
	const before = m.projectiles.getChildren().filter((b) => b.active).length;
	s.activeSkills.readyAt.recall = 0;
	const used = s.activeSkills.useRecall();
	const after = m.projectiles.getChildren().filter((b) => b.active).length;
	return { before, after, used };
});
check('귀소: 주변 유도탄 소거', recallClear.used === true && recallClear.before >= 5 && recallClear.after === 0,
	JSON.stringify(recallClear));

// 대시(SHIFT): 탄이 느려서 확실히 떨어진다 (탄속 130 vs 대시 800px/s)
const dashEscape = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	for (const b of m.projectiles.getChildren()) m.recycleProjectile(b);
	const shooter = window.__shooter;
	shooter.setPosition(s.player.x - 200, s.player.y);
	m.fireProjectiles(shooter, s.player, { ...shooter.behavior, projectileCount: 1 });
	const bullet = m.projectiles.getChildren().find((b) => b.active);
	window.__dashBullet = bullet;
	return { dist: Math.round(Math.hypot(bullet.x - s.player.x, bullet.y - s.player.y)) };
});
await page.evaluate(() => {
	const s = window.__gameScene;
	s.activeSkills.readyAt.dash = 0;
	// 탄이 오는 반대쪽(오른쪽)으로 대시. useDash 는 입력을 한 번만 읽으므로
	// 호출 직후 곧바로 후크를 걷어낸다 (계속 걸어두면 이후 측정이 오염된다).
	s.getHorizontalInput = () => 1;
	s.getVerticalInput = () => 0;
	s.activeSkills.useDash();
	delete s.getHorizontalInput;
	delete s.getVerticalInput;
});
await page.waitForTimeout(650);
const dashAfter = await page.evaluate(() => {
	const s = window.__gameScene;
	const bullet = window.__dashBullet;
	return {
		dist: bullet?.active
			? Math.round(Math.hypot(bullet.x - s.player.x, bullet.y - s.player.y))
			: -1,
	};
});
check('대시: 유도탄에서 확실히 벌어진다',
	dashAfter.dist === -1 || dashAfter.dist > dashEscape.dist,
	JSON.stringify({ before: dashEscape.dist, after: dashAfter.dist }));

// ─────────────────────────────────────────────────────────────
// (3) 장막 소환수 — 피해 감소 / 시전자 처치로 해제
// ─────────────────────────────────────────────────────────────
const veilProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	m.veils.length = 0;
	for (const b of m.projectiles.getChildren()) m.recycleProjectile(b);

	const caller = m.spawnEnemy(s, s.player, 'veil-caller', { x: s.player.x + 380, y: s.player.y });
	caller.hp = 999999; caller.maxHp = 999999;
	m.plantVeil(caller, caller.behavior, s.time.now);
	const veils = m.veils.length;

	// 장막 안 / 밖에 같은 잡몹을 하나씩 두고 같은 피해를 넣는다
	const inside = m.spawnEnemy(s, s.player, 'skullwolf', { x: caller.x + 40, y: caller.y + 20 });
	const outside = m.spawnEnemy(s, s.player, 'skullwolf', { x: caller.x + 900, y: caller.y });
	inside.hp = 10000; inside.maxHp = 10000;
	outside.hp = 10000; outside.maxHp = 10000;
	inside.physicalResist = 0; outside.physicalResist = 0;
	m.takeDamage(inside, 1000, s.player, { silent: true, ignoreResist: true });
	m.takeDamage(outside, 1000, s.player, { silent: true, ignoreResist: true });

	const multAtInside = m.veilDamageMultAt(inside.x, inside.y);
	const multAtOutside = m.veilDamageMultAt(outside.x, outside.y);
	window.__veilCaller = caller;
	window.__veilInside = inside;
	return {
		veils,
		insideLost: 10000 - inside.hp,
		outsideLost: 10000 - outside.hp,
		multAtInside,
		multAtOutside,
	};
});
check('장막: 시전자가 장막을 깐다', veilProbe.veils === 1, `${veilProbe.veils}개`);
check('장막: 안쪽 적의 피해가 줄어든다 (0.45배)',
	Math.abs(veilProbe.multAtInside - 0.45) < 0.001 && veilProbe.insideLost < veilProbe.outsideLost * 0.6,
	JSON.stringify({ inside: veilProbe.insideLost, outside: veilProbe.outsideLost }));
check('장막: 바깥은 감소 없음',
	veilProbe.multAtOutside === 1 && veilProbe.outsideLost === 1000, JSON.stringify(veilProbe.outsideLost));
check('장막: 트루 피해(저항 무시)도 장막은 못 뚫는다',
	veilProbe.insideLost === 450, `${veilProbe.insideLost}`);

const veilRelease = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const caller = window.__veilCaller;
	caller.hp = 1;
	m.takeDamage(caller, 9999, s.player, { silent: true, ignoreResist: true });
	m.updateVeils(s.time.now);
	const inside = window.__veilInside;
	inside.hp = 10000; inside.maxHp = 10000;
	m.takeDamage(inside, 1000, s.player, { silent: true, ignoreResist: true });
	return { veils: m.veils.length, lost: 10000 - inside.hp, mult: m.veilDamageMultAt(inside.x, inside.y) };
});
check('장막: 시전자를 끊으면 즉시 걷힌다',
	veilRelease.veils === 0 && veilRelease.mult === 1, JSON.stringify(veilRelease));
check('장막: 해제 후 피해가 원래대로', veilRelease.lost === 1000, `${veilRelease.lost}`);

// ─────────────────────────────────────────────────────────────
// (4) 보스 [전방위 조임] — 파훼 2경로
// ─────────────────────────────────────────────────────────────
await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	// 전장을 비우고(접촉 피해 배제) 조임만 남긴다 — 스폰도 잠근다
	m.spawningEnabled = false;
	window.__minAlive = m.minAlive;
	m.minAlive = 0;
	for (const e of m.enemies.getChildren()) if (e.active) m.recycleEnemy(e);
	for (const b of m.projectiles.getChildren()) m.recycleProjectile(b);
	m.veils.length = 0;
	m.bossTelegraphs.length = 0;
	s.player.maxHp = 1000;
	s.player.hp = 1000;
	s.player.invulnerableUntil = 0;
	s.revivalsLeft = 0;
	const boss = m.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 700, y: s.player.y });
	boss.hp = 9999999; boss.maxHp = 9999999;
	boss.skillIds = ['cinch'];
	boss.hasEnrage = false;
	boss.nextSkillAt = 0;
	window.__cinchBoss = boss;
});
await page.waitForFunction(
	() => (window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring'),
	null, { timeout: 8000 });
const cinchTele = await page.evaluate(() => {
	const t = window.__gameScene.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	return { kind: t.kind, radius: t.radius, inner: t.innerRadius, gapHalf: t.gapHalf, hasGap: Number.isFinite(t.gapAngle) };
});
check('조임: 고리 텔레그래프 생성 (바깥 > 안쪽 · 틈 존재)',
	cinchTele.kind === 'ring' && cinchTele.radius > cinchTele.inner && cinchTele.hasGap && cinchTele.gapHalf > 0,
	JSON.stringify(cinchTele));

// 파훼 1 — 초록 틈 각도로 빠져나간다
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	const r = t.innerRadius + 90;
	const px = t.x + Math.cos(t.gapAngle) * r;
	const py = t.y + Math.sin(t.gapAngle) * r;
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
});
await page.waitForFunction(
	() => !(window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring' && !t.fired),
	null, { timeout: 8000 });
const gapHp = await page.evaluate(() => window.__gameScene.player.hp);
check('조임 파훼①: 초록 틈으로 빠져나가면 무피해', gapHp === 1000, `hp=${gapHp}`);

// 명중 — 틈 밖 코어에 서 있으면 최대 체력 비례 피해
await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.hp = 1000;
	s.player.invulnerableUntil = 0;
	s.enemyManager.bossTelegraphs.length = 0;
	// 시전 사거리(900px) 안으로 보스를 되돌린다 — 접촉 피해와는 충분히 멀리
	const boss = window.__cinchBoss;
	boss.setPosition(s.player.x + 320, s.player.y);
	boss.body?.reset(s.player.x + 320, s.player.y);
	boss.castingUntil = 0;
	boss.nextSkillAt = 0;
});
await page.waitForFunction(
	() => (window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring'),
	null, { timeout: 8000 });
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	// 틈의 정반대 각도 · 코어 안쪽
	const a = t.gapAngle + Math.PI;
	const px = t.x + Math.cos(a) * (t.innerRadius * 0.5);
	const py = t.y + Math.sin(a) * (t.innerRadius * 0.5);
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	s.player.invulnerableUntil = 0;
});
await page.waitForFunction(
	() => !(window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring' && !t.fired),
	null, { timeout: 8000 });
const cinchHit = await page.evaluate(() => ({
	hp: window.__gameScene.player.hp, by: window.__gameScene.lastHitBy,
}));
// 2026-09-02 보스 개편: 즉살기가 아닌 패턴의 피해를 낮추고(0.9 → 0.6 최대체력) 대신
// 예고 시간을 줄여 "자주 스치되 즉사하지 않게" 바꿨다 — 임계도 함께 완화.
check('조임: 틈 밖 코어 = 최대 체력 비례 피해',
	cinchHit.hp < 1000 && cinchHit.hp <= 600, JSON.stringify(cinchHit));
check('조임: 사인 기록', (cinchHit.by ?? '').includes('전방위 조임'), cinchHit.by ?? '');

// 파훼 2 — 귀소 무적으로 흘린다 (같은 자리에 서 있어도 무피해)
await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.hp = 1000;
	s.player.invulnerableUntil = 0;
	s.enemyManager.bossTelegraphs.length = 0;
	const boss = window.__cinchBoss;
	boss.setPosition(s.player.x + 320, s.player.y);
	boss.body?.reset(s.player.x + 320, s.player.y);
	boss.castingUntil = 0;
	boss.nextSkillAt = 0;
});
await page.waitForFunction(
	() => (window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring'),
	null, { timeout: 8000 });
const recallTiming = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	const a = t.gapAngle + Math.PI;
	const px = t.x + Math.cos(a) * (t.innerRadius * 0.5);
	const py = t.y + Math.sin(a) * (t.innerRadius * 0.5);
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	s.player.invulnerableUntil = 0;
	return { waitMs: Math.max(0, t.fireAt - s.time.now) };
});
// 발동 직전에 귀소를 눌러 무적으로 덮는다
await page.waitForTimeout(Math.max(0, recallTiming.waitMs - 260));
await page.evaluate(() => {
	const s = window.__gameScene;
	s.activeSkills.readyAt.recall = 0;
	window.__recallUsed = s.activeSkills.useRecall();
});
await page.waitForFunction(
	() => !(window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'ring' && !t.fired),
	null, { timeout: 8000 });
const recallDodge = await page.evaluate(() => ({
	hp: window.__gameScene.player.hp, used: window.__recallUsed,
}));
check('조임 파훼②: 귀소 무적으로 상쇄',
	recallDodge.used === true && recallDodge.hp === 1000, JSON.stringify(recallDodge));

// 정리: 보스 제거 · 스폰 재개
await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	m.recycleEnemy(window.__cinchBoss);
	m.bossTelegraphs.length = 0;
	m.spawningEnabled = true;
	m.minAlive = window.__minAlive ?? 0;
	s.player.maxHp = 100000;
	s.player.hp = 100000;
	s.revivalsLeft = 3;
});

// ─────────────────────────────────────────────────────────────
// (5) 스킬 시너지 증강 6종
// ─────────────────────────────────────────────────────────────
const catalogProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.augmentSystem;
	const all = ['steel', 'gold', 'transcend'].flatMap((t) => a.poolForTier(t));
	const ids = ['dive-fang', 'dive-focus', 'recall-bulwark', 'recall-gale', 'dash-afterimage', 'dash-lunge'];
	window.__augById = Object.fromEntries(ids.map((id) => [id, all.find((x) => x.id === id) ?? null]));
	return {
		found: ids.filter((id) => window.__augById[id]),
		tiers: Object.fromEntries(ids.map((id) => [id, window.__augById[id]?.tier ?? null])),
		korean: ids.every((id) => /[가-힣]/.test(window.__augById[id]?.name ?? '')
			&& /[가-힣]/.test(window.__augById[id]?.desc ?? '')),
	};
});
check('증강: 6종 전부 카탈로그에 있다', catalogProbe.found.length === 6, JSON.stringify(catalogProbe.found));
check('증강: 이름·설명이 전부 한국어', catalogProbe.korean === true);
check('증강: 등급 분포 강철2/황금3/초월1',
	JSON.stringify(catalogProbe.tiers) === JSON.stringify({
		'dive-fang': 'steel', 'dive-focus': 'gold', 'recall-bulwark': 'steel',
		'recall-gale': 'gold', 'dash-afterimage': 'gold', 'dash-lunge': 'transcend',
	}), JSON.stringify(catalogProbe.tiers));

// ① 활공의 이빨 — 활공 보너스 0.3 → 0.6
const diveFang = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	const m = s.enemyManager;
	s.augmentSystem.applyAugment(window.__augById['dive-fang']);
	for (let i = 0; i < 6; i += 1) {
		const ang = (Math.PI * 2 * i) / 6;
		const e = m.spawnEnemy(s, s.player, 'skullwolf', {
			x: s.player.x + Math.cos(ang) * 150, y: s.player.y + Math.sin(ang) * 150,
		});
		if (e) { e.hp = 999999; e.maxHp = 999999; }
	}
	for (const sw of s.swordOrbit.swords) { sw.state = 'orbiting'; sw.target = null; sw._diveBonusUntil = 0; sw._diveBonusMult = 1; }
	a.readyAt.dive = 0;
	const ok = a.useDive();
	return {
		ok,
		add: s.augmentSystem.skillMods.diveDamageBonusAdd,
		mult: s.swordOrbit.swords[0]?._diveBonusMult ?? 0,
	};
});
check('증강 [활공의 이빨]: 활공 보너스 +30%p → ×1.6',
	diveFang.ok === true && Math.abs(diveFang.add - 0.3) < 1e-6 && Math.abs(diveFang.mult - 1.6) < 1e-6,
	JSON.stringify(diveFang));

// ② 매서운 조준 — 활공 직후 0.8초 치명타 창
const diveFocus = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	const before = s.player.critChance;
	s.augmentSystem.applyAugment(window.__augById['dive-focus']);
	a.readyAt.dive = 0;
	for (const sw of s.swordOrbit.swords) { sw.state = 'orbiting'; sw.target = null; }
	const ok = a.useDive();
	return { ok, before, during: s.player.critChance, open: a.isCritWindowOpen };
});
check('증강 [매서운 조준]: 활공 직후 치명타 +15%p 창이 열린다',
	diveFocus.ok === true && diveFocus.open === true
	&& Math.abs(diveFocus.during - diveFocus.before - 0.15) < 1e-6, JSON.stringify(diveFocus));
await page.waitForTimeout(1100);
const critClosed = await page.evaluate(() => {
	const s = window.__gameScene;
	return { crit: s.player.critChance, open: s.activeSkills.isCritWindowOpen };
});
check('증강 [매서운 조준]: 0.8초 뒤 치명타율이 정확히 되돌아온다',
	critClosed.open === false && Math.abs(critClosed.crit - diveFocus.before) < 1e-6,
	JSON.stringify({ ...critClosed, base: diveFocus.before }));

// ③ 귀소의 방벽 — 무적 연장 + 이동속도
const recallBulwark = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	s.augmentSystem.applyAugment(window.__augById['recall-bulwark']);
	s.player.invulnerableUntil = 0;
	a.readyAt.recall = 0;
	const now = s.time.now;
	const ok = a.useRecall();
	return {
		ok,
		invulnMs: Math.round(s.player.invulnerableUntil - now),
		speedMult: a.moveSpeedMult(s.time.now),
		addMs: s.augmentSystem.skillMods.recallInvulnAddMs,
	};
});
check('증강 [귀소의 방벽]: 무적 0.5 → 0.9초',
	recallBulwark.ok === true && recallBulwark.addMs === 400
	&& recallBulwark.invulnMs >= 860 && recallBulwark.invulnMs <= 940, JSON.stringify(recallBulwark));
check('증강 [귀소의 방벽]: 귀소 후 이동속도 ×1.35',
	Math.abs(recallBulwark.speedMult - 1.35) < 1e-6, `${recallBulwark.speedMult}`);

// ④ 귀소의 소용돌이 — 넉백 반경 확대 + 궤적 피해
const recallGale = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	const m = s.enemyManager;
	s.augmentSystem.applyAugment(window.__augById['recall-gale']);
	// 귀환 궤적 위(플레이어 근처)에 사냥감을 둔다
	const victim = m.spawnEnemy(s, s.player, 'skullwolf', { x: s.player.x + 30, y: s.player.y + 20 });
	victim.hp = 200000; victim.maxHp = 200000;
	victim.physicalResist = 0; victim.magicResist = 0;
	victim.knockbackResist = 1; // 궤적 피해만 보기 위해 자리에 고정
	window.__galeVictim = victim;
	// 검을 전부 귀환 상태로 만들고 넉백 창을 연다
	for (const sw of s.swordOrbit.swords) s.swordOrbit.startLaunchedSword(sw, victim);
	s.player.invulnerableUntil = 0;
	a.readyAt.recall = 0;
	const ok = a.useRecall();
	return {
		ok,
		hp: victim.hp,
		radiusAdd: s.augmentSystem.skillMods.recallKnockbackRadiusAdd,
		dmgPct: s.augmentSystem.skillMods.recallSweepDamagePct,
	};
});
await page.waitForTimeout(700);
const galeAfter = await page.evaluate(() => ({
	hp: window.__galeVictim.hp,
	sweepAt: window.__galeVictim.recallSweepAt ?? 0,
}));
check('증강 [귀소의 소용돌이]: 반경 +60% · 궤적 피해 60% 배선',
	recallGale.radiusAdd === 0.6 && recallGale.dmgPct === 0.6, JSON.stringify(recallGale));
check('증강 [귀소의 소용돌이]: 귀환 궤적이 실제로 피해를 남긴다',
	galeAfter.hp < recallGale.hp && galeAfter.sweepAt > 0,
	JSON.stringify({ before: recallGale.hp, after: galeAfter.hp, sweepAt: Math.round(galeAfter.sweepAt) }));

// ⑤ 잔상 보법 — 대시 쿨다운 -30% + 잔상 피해
const dashAfterimage = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	const cdBefore = a.cooldownMs('dash');
	s.augmentSystem.applyAugment(window.__augById['dash-afterimage']);
	const cdAfter = a.cooldownMs('dash');
	// 대시 경로 바로 옆에 사냥감을 붙인다
	const victim = window.__galeVictim;
	victim.hp = 200000; victim.maxHp = 200000;
	victim.setPosition(s.player.x + 60, s.player.y);
	victim.body?.reset(s.player.x + 60, s.player.y);
	victim.dashGhostAt = -1;
	a.readyAt.dash = 0;
	s.getHorizontalInput = () => 1;
	s.getVerticalInput = () => 0;
	const ok = a.useDash();
	delete s.getHorizontalInput;
	delete s.getVerticalInput;
	return { ok, cdBefore, cdAfter, hp: victim.hp, pct: s.augmentSystem.skillMods.dashGhostDamagePct };
});
await page.waitForTimeout(400);
const ghostAfter = await page.evaluate(() => ({ hp: window.__galeVictim.hp }));
check('증강 [잔상 보법]: 대시 쿨다운 -30%',
	Math.abs(dashAfterimage.cdAfter - Math.round(dashAfterimage.cdBefore * 0.7)) <= 1,
	JSON.stringify({ before: dashAfterimage.cdBefore, after: dashAfterimage.cdAfter }));
check('증강 [잔상 보법]: 잔상이 스치는 적에게 피해',
	dashAfterimage.pct === 0.45 && ghostAfter.hp < dashAfterimage.hp,
	JSON.stringify({ before: dashAfterimage.hp, after: ghostAfter.hp }));

// ⑥ 도약 일격 — 대시 거리 +50% + 대시 후 출격 강화
const dashLunge = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	s.augmentSystem.applyAugment(window.__augById['dash-lunge']);
	for (const sw of s.swordOrbit.swords) { sw._diveBonusUntil = 0; sw._diveBonusMult = 1; }
	a.readyAt.dash = 0;
	s.getHorizontalInput = () => 1;
	s.getVerticalInput = () => 0;
	const startX = s.player.x;
	const now = s.time.now;
	const ok = a.useDash();
	delete s.getHorizontalInput;
	delete s.getVerticalInput;
	const sword = s.swordOrbit.swords[0];
	return {
		ok,
		startX,
		add: s.augmentSystem.skillMods.dashDistanceAdd,
		mult: sword?._diveBonusMult ?? 0,
		windowMs: Math.round((sword?._diveBonusUntil ?? 0) - now),
	};
});
await page.waitForTimeout(400);
const lungeAfter = await page.evaluate(() => ({ x: window.__gameScene.player.x }));
check('증강 [도약 일격]: 대시 거리 +50% (≈180px)',
	dashLunge.add === 0.5 && Math.abs((lungeAfter.x - dashLunge.startX) - 180) < 55,
	JSON.stringify({ moved: Math.round(lungeAfter.x - dashLunge.startX) }));
check('증강 [도약 일격]: 대시 후 2.5초 출격 피해 +60%',
	Math.abs(dashLunge.mult - 1.6) < 1e-6 && dashLunge.windowMs >= 2300 && dashLunge.windowMs <= 2600,
	JSON.stringify(dashLunge));

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log('FAILED:', failed.map(([n]) => n).join(' | '));
	process.exit(1);
}
