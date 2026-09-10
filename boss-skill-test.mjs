// 보스 스킬 패턴 회귀 테스트 (2026-08-31 신설 → 2026-09-02 보스 전면 개편으로 확장).
//
// 검증:
//   (0) 데이터 규약 — 12종 카탈로그, 보스별 스킬 풀 상이, 회피 하한(감속 중첩 대비)
//   (1) 라운드별 해금 칸 수 (30라 = 능동 5종 + 격노)
//   (2~4) 기존 3종: 대지 강타 / 전방위 조임 / 처형 광선(즉살기)
//   (5) 신규 8종: 텔레그래프 생성 · 파훼(회피) · 명중 피해 · 연쇄 재조준 · 봉인 파훼
//
// Run: node boss-skill-test.mjs (vite preview :5197, CHROME_BIN 주입 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
	results.push([name, ok]);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
// 타이틀 → 캐릭터 선택 → 게임. 부하가 걸린 머신에서는 첫 Space 가 씹히므로
// 목표 씬이 뜰 때까지 눌러 본다 (고정 대기 금지 — 회귀 테스트가 플레이키해진다).
async function advanceUntil(globalName) {
	for (let i = 0; i < 40; i += 1) {
		if (await page.evaluate((n) => !!window[n], globalName)) return true;
		await page.keyboard.press('Space');
		await page.waitForTimeout(500);
	}
	throw new Error(`부팅 실패: window.${globalName} 이 뜨지 않았다`);
}
await advanceUntil('__charSelect');
await advanceUntil('__gameScene');
await page.waitForTimeout(2400);

// 보스 처치 드랍 XP로 레벨업 카드가 열리면 전투 업데이트가 멈춰 광선 시나리오가
// 교착된다 (게임상 정상 동작) — 테스트 동안은 레벨업을 봉인한다.
await page.evaluate(() => {
	const s = window.__gameScene;
	s.progression.xpToNext = 999999999;
	if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
});

// ── (0) 데이터 규약 ────────────────────────────────────────────────────
const data = await page.evaluate(() => {
	const m = window.__gameScene.enemyManager;
	const kits = m.bossKits;
	return {
		skillCount: Object.keys(m.bossSkills).length,
		ids: Object.keys(m.bossSkills),
		dodge: m.bossDodgeFloor(),
		kitOf: Object.fromEntries(Object.entries(kits).map(([k, v]) => [k, v.join(',')])),
		// 즉살(최대 체력 초과) 피해는 처형 광선만
		lethal: Object.values(m.bossSkills).filter((s) => s.damagePctMaxHp >= 1).map((s) => s.id),
	};
});
check('데이터: 스킬 13종 (능동 12 + 격노)', data.skillCount === 13, `${data.skillCount}종 ${data.ids.join(',')}`);
check('데이터: 회피 하한 준수 (요구 이동속도 ≤ 297px/s)',
	data.dodge.ok, JSON.stringify(data.dodge.worst));
check('데이터: 즉살기는 처형 광선뿐', data.lethal.length === 1 && data.lethal[0] === 'beam',
	data.lethal.join(','));
const kitValues = Object.values(data.kitOf);
check('데이터: 보스마다 스킬 풀이 다르다 (8종 전부 고유)',
	new Set(kitValues).size === kitValues.length && kitValues.length >= 8,
	`${kitValues.length}개 중 고유 ${new Set(kitValues).size}`);

// ── (1) 라운드별 스킬 해금 수
const unlockProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const spawnAt = (id, round) => {
		m.setRound(round);
		const e = m.spawnEnemy(s, s.player, id, { x: s.player.x + 600, y: s.player.y + 600 });
		const out = { skills: e.skillIds ?? [], enrage: e.hasEnrage === true };
		m.recycleEnemy(e);
		return out;
	};
	const r10 = spawnAt('skullwolf-boss', 10);
	const r20 = spawnAt('boss-siegehulk', 20);
	const r30 = spawnAt('boss-needlequeen', 30);
	const r40 = spawnAt('death-lord', 40);
	m.setRound(1);
	return { r10, r20, r30, r40 };
});
check('해금: 10라 = 2칸 (능동 2종)', unlockProbe.r10.skills.length === 2 && !unlockProbe.r10.enrage,
	JSON.stringify(unlockProbe.r10));
check('해금: 20라 = 4칸 (능동 3종 + 격노)',
	unlockProbe.r20.skills.length === 3 && unlockProbe.r20.enrage, JSON.stringify(unlockProbe.r20));
check('해금: 30라 = 능동 5종 + 격노 (사용자 요구 4~6종)',
	unlockProbe.r30.skills.length === 5 && unlockProbe.r30.enrage, JSON.stringify(unlockProbe.r30));
check('해금: 30라 보스는 즉살기를 쥔다', unlockProbe.r30.skills.includes('beam'),
	unlockProbe.r30.skills.join(','));
check('해금: 40라 = 능동 7종 + 격노',
	unlockProbe.r40.skills.length === 7 && unlockProbe.r40.enrage, JSON.stringify(unlockProbe.r40));

// ── 공용 헬퍼 ─────────────────────────────────────────────────────────
/** 필드를 비우고 지정 스킬만 쓰는 보스를 세운다 (플레이어 hp 1000 고정). */
async function stage(skillIds, opts = {}) {
	await page.evaluate(({ skillIds, dist }) => {
		const s = window.__gameScene;
		const m = s.enemyManager;
		m.spawningEnabled = false;
		if (window.__minAlive === undefined) window.__minAlive = m.minAlive;
		m.minAlive = 0;
		for (const e of m.enemies.getChildren()) {
			if (e.active) m.recycleEnemy(e);
		}
		m.bossTelegraphs.length = 0;
		m.projectiles.getChildren().forEach((b) => b.active && m.recycleProjectile(b));
		s.player.maxHp = 1000;
		s.player.hp = 1000;
		s.player.invulnerableUntil = 0;
		s.revivalsLeft = 0;
		const boss = m.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + dist, y: s.player.y });
		boss.hp = 9999999; boss.maxHp = 9999999;
		boss.skillIds = skillIds;
		boss.skillRotation = 0;
		boss.hasEnrage = false;
		boss.castingUntil = 0;
		boss.nextSkillAt = 0;
		window.__boss = boss;
	}, { skillIds, dist: opts.dist ?? 420 });
}
const waitTele = (kind, timeout = 9000) => page.waitForFunction(
	(k) => (window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === k),
	kind, { timeout });
const waitFired = (kind, timeout = 12000) => page.waitForFunction(
	(k) => !(window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === k && !t.fired),
	kind, { timeout });
const hp = () => page.evaluate(() => window.__gameScene.player.hp);
const lastHit = () => page.evaluate(() => window.__gameScene.lastHitBy ?? '');

// ── (2) 대지 강타: 텔레그래프 → 파훼(밖) → 명중(안)
await stage(['slam'], { dist: 300 });
await waitTele('circle');
const teleProbe = await page.evaluate(() => {
	const t = window.__gameScene.enemyManager.bossTelegraphs[0];
	return { kind: t.kind, radius: t.radius };
});
check('강타: 원형 텔레그래프 생성', teleProbe.kind === 'circle' && teleProbe.radius > 200, JSON.stringify(teleProbe));
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs[0];
	s.player.setPosition(t.x + t.radius + 320, t.y);
	s.player.body?.reset(t.x + t.radius + 320, t.y);
});
await waitFired('circle');
check('강타: 원 밖 = 무피해', (await hp()) === 1000, `hp=${await hp()}`);
await page.evaluate(() => {
	window.__boss.nextSkillAt = 0;
	window.__boss.castingUntil = 0;
});
await waitTele('circle');
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs[0];
	s.player.invulnerableUntil = 0;
	s.player.setPosition(t.x + t.radius - 35, t.y);
	s.player.body?.reset(t.x + t.radius - 35, t.y);
});
await page.waitForFunction(() => window.__gameScene.player.hp < 1000, null, { timeout: 6000 });
const slamHit = { hp: await hp(), by: await lastHit() };
check('강타: 원 안 = 최대 체력 비례 피해', slamHit.hp < 800 && slamHit.hp > 300, JSON.stringify(slamHit));
check('강타: 사인 기록', slamHit.by.includes('대지 강타'), slamHit.by);

// ── (3) 전방위 조임: 틈 통과 = 무피해 / 코어 잔류 = 피해
await stage(['cinch']);
await waitTele('ring');
const ringTele = await page.evaluate(() => {
	const t = window.__gameScene.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	return { radius: t.radius, inner: t.innerRadius, gapHalf: t.gapHalf, hasGap: Number.isFinite(t.gapAngle) };
});
check('조임: 고리 텔레그래프 (바깥 > 안쪽 · 틈 존재)',
	ringTele.radius > ringTele.inner && ringTele.hasGap && ringTele.gapHalf > 0, JSON.stringify(ringTele));
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	const r = t.innerRadius + 90;
	const px = t.x + Math.cos(t.gapAngle) * r;
	const py = t.y + Math.sin(t.gapAngle) * r;
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
});
await waitFired('ring');
check('조임: 틈으로 빠져나가면 무피해', (await hp()) === 1000, `hp=${await hp()}`);
await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.hp = 1000;
	s.player.invulnerableUntil = 0;
	s.enemyManager.bossTelegraphs.length = 0;
	window.__boss.setPosition(s.player.x + 320, s.player.y);
	window.__boss.body?.reset(s.player.x + 320, s.player.y);
	window.__boss.castingUntil = 0;
	window.__boss.nextSkillAt = 0;
});
await waitTele('ring');
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'ring');
	const a = t.gapAngle + Math.PI;
	const px = t.x + Math.cos(a) * (t.innerRadius * 0.5);
	const py = t.y + Math.sin(a) * (t.innerRadius * 0.5);
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	s.player.invulnerableUntil = 0;
});
await waitFired('ring');
const ringHit = { hp: await hp(), by: await lastHit() };
check('조임: 틈 밖 코어 = 최대 체력 비례 피해', ringHit.hp < 1000 && ringHit.hp <= 600, JSON.stringify(ringHit));
check('조임: 사인 기록', ringHit.by.includes('전방위 조임'), ringHit.by);

// ── (5-a) 균열 지뢰: 2단 연쇄 — 1단이 터질 때 2단이 새로 조준된다
await stage(['mines']);
await waitTele('circle');
const mineFirst = await page.evaluate(() => {
	const s = window.__gameScene;
	// 1단은 전부 피한다 (멀리 이동)
	s.player.setPosition(s.player.x + 900, s.player.y + 900);
	s.player.body?.reset(s.player.x, s.player.y);
	return s.enemyManager.bossTelegraphs.filter((t) => t.kind === 'circle').length;
});
check('지뢰: 1단이 여러 지점에 깔린다', mineFirst >= 3, `${mineFirst}개`);
await waitFired('circle');
// 1단이 다 터진 직후, 2단이 새 위치를 다시 조준해야 한다.
// (개수와 최근접 거리를 같은 순간에 읽는다 — 따로 읽으면 그 사이에 터져 없어진다)
const mineStage2 = await page.waitForFunction(() => {
	const s = window.__gameScene;
	const list = (s.enemyManager.bossTelegraphs ?? []).filter((t) => t.kind === 'circle' && !t.fired);
	if (list.length < 3) return null;
	return {
		count: list.length,
		near: Math.min(...list.map((t) => Math.hypot(t.x - s.player.x, t.y - s.player.y))),
	};
}, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => ({ count: 0, near: Infinity }));
check('지뢰: 2단이 이어서 재조준된다 (연쇄)', mineStage2.count >= 3, `${mineStage2.count}개`);
check('지뢰: 2단은 회피한 현재 위치를 노린다', mineStage2.near <= 260,
	`최근접 ${Math.round(mineStage2.near)}px`);

// ── (5-b) 낙하 연타: 매 발 현재 위치 재조준 + 실피해(즉살 아님)
await stage(['meteor']);
await waitTele('circle');
const meteorNear = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'circle');
	return Math.hypot(t.x - s.player.x, t.y - s.player.y);
});
check('낙하 연타: 키퍼 위치를 조준', meteorNear < 40, `${Math.round(meteorNear)}px`);
await page.evaluate(() => { window.__gameScene.player.invulnerableUntil = 0; });
await page.waitForFunction(() => window.__gameScene.player.hp < 1000, null, { timeout: 8000 });
const meteorHit = { hp: await hp(), by: await lastHit() };
check('낙하 연타: 제자리면 맞는다 (실피해·즉살 아님)',
	meteorHit.hp >= 500 && meteorHit.hp < 1000, JSON.stringify(meteorHit));
check('낙하 연타: 사인 기록', meteorHit.by.includes('낙하 연타'), meteorHit.by);

// ── (5-c) 삼연 돌진: 직선 텔레그래프 + 시전자가 실제로 돌진한다
await stage(['rush'], { dist: 500 });
await waitTele('line');
const rushBefore = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'line');
	// 축선과 직각으로 비켜선다 (파훼)
	const angle = Math.atan2(t.y2 - t.y, t.x2 - t.x) + Math.PI / 2;
	const px = s.player.x + Math.cos(angle) * 420;
	const py = s.player.y + Math.sin(angle) * 420;
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	return { hasDash: t.dashMs > 0 && t.dashSpeed > 0, x: window.__boss.x, y: window.__boss.y };
});
check('돌진: 축선 텔레그래프에 돌진 정보가 실린다', rushBefore.hasDash, JSON.stringify(rushBefore));
await waitFired('line');
const rushAfter = await page.evaluate(() => ({
	x: window.__boss.x, y: window.__boss.y, hp: window.__gameScene.player.hp,
	dashUntil: window.__boss.skillDashUntil, now: window.__gameScene.time.now,
}));
check('돌진: 축선을 비키면 무피해', rushAfter.hp === 1000, `hp=${rushAfter.hp}`);
check('돌진: 시전자가 실제로 이동한다',
	Math.hypot(rushAfter.x - rushBefore.x, rushAfter.y - rushBefore.y) > 30
	|| rushAfter.dashUntil > rushAfter.now,
	JSON.stringify(rushAfter));

// ── (5-d) 회전 빔 스윕: 부채꼴 여러 장 + 축(피벗) 근처는 안전
await stage(['sweep'], { dist: 520 });
await waitTele('sector');
const sectorProbe = await page.evaluate(() => {
	const list = window.__gameScene.enemyManager.bossTelegraphs.filter((t) => t.kind === 'sector');
	const angles = list.map((t) => t.angle);
	const s = window.__gameScene;
	// 파훼: 시전자 발밑(축)으로 파고든다
	s.player.setPosition(window.__boss.x + 12, window.__boss.y + 8);
	s.player.body?.reset(s.player.x, s.player.y);
	s.player.invulnerableUntil = s.time.now + 20000; // 접촉 피해 배제
	return { count: list.length, spread: Math.max(...angles) - Math.min(...angles), radius: list[0].radius };
});
check('스윕: 부채꼴이 여러 장 순차로 깔린다', sectorProbe.count >= 4, JSON.stringify(sectorProbe));
check('스윕: 각도가 회전한다', sectorProbe.spread > 0.5, `${sectorProbe.spread.toFixed(2)}rad`);
await waitFired('sector');
check('스윕: 축(피벗) 안쪽 = 무피해', (await hp()) === 1000, `hp=${await hp()}`);
// 명중: 부채꼴 한복판
await stage(['sweep'], { dist: 520 });
await waitTele('sector');
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'sector');
	const px = t.x + Math.cos(t.angle) * (t.radius * 0.5);
	const py = t.y + Math.sin(t.angle) * (t.radius * 0.5);
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	s.player.invulnerableUntil = 0;
});
await page.waitForFunction(() => window.__gameScene.player.hp < 1000, null, { timeout: 8000 });
const sweepHit = { hp: await hp(), by: await lastHit() };
check('스윕: 부채꼴 안 = 실피해', sweepHit.hp < 1000 && sweepHit.hp >= 500, JSON.stringify(sweepHit));
check('스윕: 사인 기록', sweepHit.by.includes('회전 빔'), sweepHit.by);

// ── (5-e) 반쪽 붕괴: 안전한 절반으로 넘어가면 무피해 → 2단은 반대편
await stage(['halffield'], { dist: 460 });
await waitTele('half');
const halfProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'half');
	// 안전한 절반(법선 반대쪽)으로 넘어간다
	const px = t.x - Math.cos(t.angle) * 320;
	const py = t.y - Math.sin(t.angle) * 320;
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
	s.player.invulnerableUntil = 0;
	return { angle: t.angle, x: t.x, y: t.y, margin: t.margin };
});
// 1단이 터진 직후(2단이 아직 안 터진 시점)의 체력을 본다 — 2단은 반대편이라 뒤이어 맞는다
await page.waitForFunction(
	() => (window.__gameScene.enemyManager.bossTelegraphs ?? []).some((t) => t.kind === 'half' && t.fired),
	null, { timeout: 8000 });
check('반쪽 붕괴: 안전한 절반 = 1단 무피해', (await hp()) === 1000, `hp=${await hp()}`);
const halfSecond = await page.waitForFunction(
	() => (window.__gameScene.enemyManager.bossTelegraphs ?? []).find((t) => t.kind === 'half' && !t.fired)?.angle,
	null, { timeout: 6000 }).then((h) => h.jsonValue()).catch(() => null);
const flipped = halfSecond !== null
	&& Math.abs(((halfSecond - halfProbe.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < 0.01;
check('반쪽 붕괴: 2단은 정확히 반대쪽 절반', flipped, `1단 ${halfProbe.angle?.toFixed(2)} → 2단 ${halfSecond?.toFixed?.(2)}`);
await waitFired('half');
const halfHit = { hp: await hp(), by: await lastHit() };
check('반쪽 붕괴: 넘어간 자리에 그대로 있으면 2단에 맞는다',
	halfHit.hp < 1000 && halfHit.by.includes('반쪽 붕괴'), JSON.stringify(halfHit));

// ── (5-f) 나선 탄막 / 부채꼴 일제사: 풀링된 투사체가 실제로 나간다
for (const [id, label, minBullets] of [['spiral', '나선 탄막', 3], ['fan', '부채꼴 일제사', 8]]) {
	await stage([id], { dist: 420 });
	await page.evaluate(() => { window.__gameScene.player.invulnerableUntil = window.__gameScene.time.now + 30000; });
	await waitTele('burst');
	const before = await page.evaluate(() => window.__gameScene.enemyManager.projectiles
		.getChildren().filter((b) => b.active).length);
	await page.waitForFunction((n) => window.__gameScene.enemyManager.projectiles
		.getChildren().filter((b) => b.active).length > n, before, { timeout: 8000 }).catch(() => {});
	const after = await page.evaluate(() => {
		const m = window.__gameScene.enemyManager;
		const live = m.projectiles.getChildren().filter((b) => b.active);
		return { count: live.length, damage: live[0]?.damage ?? 0, pooled: m.projectiles.getLength() };
	});
	check(`${label}: 탄이 실제로 나간다`, after.count >= minBullets, JSON.stringify(after));
	check(`${label}: 풀에서만 꺼낸다 (최대 128)`, after.pooled <= 128, `pool=${after.pooled}`);
}

// ── (5-g) 검 봉인: 봉인된 검은 피해가 0 → 귀소(SPACE)로 즉시 해제
await stage(['seal'], { dist: 420 });
await page.evaluate(() => { window.__gameScene.player.invulnerableUntil = window.__gameScene.time.now + 30000; });
await waitTele('seal');
await waitFired('seal');
const sealed = await page.evaluate(() => {
	const orbit = window.__gameScene.swordOrbit;
	return {
		count: orbit.sealedCount,
		anySealed: orbit.swords.some((sw) => orbit.isSealed(sw)),
		swords: orbit.swords.length,
	};
});
check('봉인: 궤도 검이 잠긴다', sealed.count >= 1 && sealed.anySealed, JSON.stringify(sealed));
const sealedNoDamage = await page.evaluate(() => {
	const s = window.__gameScene;
	const orbit = s.swordOrbit;
	const sword = orbit.swords.find((sw) => orbit.isSealed(sw));
	const target = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', { x: s.player.x + 60, y: s.player.y });
	target.hp = 100000; target.maxHp = 100000;
	const before = target.hp;
	for (let i = 0; i < 12; i += 1) {
		orbit.registerSwordHit(sword, target);
		orbit.registerOrbitHit(sword, target);
	}
	const after = target.hp;
	s.enemyManager.recycleEnemy(target);
	return { before, after };
});
check('봉인: 봉인된 검은 피해를 주지 않는다', sealedNoDamage.after === sealedNoDamage.before,
	JSON.stringify(sealedNoDamage));
const unsealed = await page.evaluate(() => {
	const s = window.__gameScene;
	s.activeSkills.readyAt.recall = 0;
	const ok = s.activeSkills.useRecall();
	return { ok, count: s.swordOrbit.sealedCount };
});
check('봉인: 귀소(SPACE)로 즉시 해제 — 파훼 경로', unsealed.ok && unsealed.count === 0, JSON.stringify(unsealed));

// ── (4) 처형 광선: 축선 밖 = 무피해 → 축선 위 = 즉살급
await stage(['beam'], { dist: 500 });
await page.evaluate(() => { window.__gameScene.player.invulnerableUntil = 0; });
await waitTele('line');
await page.evaluate(() => {
	const s = window.__gameScene;
	const t = s.enemyManager.bossTelegraphs.find((x) => x.kind === 'line');
	const angle = Math.atan2(t.y2 - t.y, t.x2 - t.x) + Math.PI / 2;
	const px = s.player.x + Math.cos(angle) * 400;
	const py = s.player.y + Math.sin(angle) * 400;
	s.player.setPosition(px, py);
	s.player.body?.reset(px, py);
});
await waitFired('line');
check('광선: 축선 밖 = 무피해', (await hp()) === 1000, `hp=${await hp()}`);
await page.evaluate(() => {
	const s = window.__gameScene;
	s.enemyManager.recycleEnemy(window.__boss);
	s.enemyManager.bossTelegraphs.length = 0;
	s.player.hp = 1000;
	s.player.invulnerableUntil = 0;
	const boss2 = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 500, y: s.player.y });
	boss2.hp = 999999;
	boss2.maxHp = 999999;
	boss2.skillIds = ['beam'];
	boss2.hasEnrage = false;
	boss2.nextSkillAt = 0;
});
try {
	await page.waitForFunction(() => {
		const s = window.__gameScene;
		return s.player.hp < 600 || s.isGameOver || s.player.isDead;
	}, null, { timeout: 12000 });
} catch {
	const dump = await page.evaluate(() => {
		const s = window.__gameScene;
		const b = (s.enemyManager.enemies.getChildren()).find((e) => e.active && e.catalog?.isBoss);
		return {
			tele: s.enemyManager.bossTelegraphs.length, hp: s.player.hp, over: s.isGameOver,
			round: s.enemyManager.currentRound, village: s.villageSystem.isActive,
			levelUp: s.levelUpSystem.isOpen, paused: s.isPaused, shop: s.shopSystem.isOpen,
			boss: b ? { ids: b.skillIds, next: b.nextSkillAt, cast: b.castingUntil, rot: b.skillRotation } : null,
			now: s.time.now,
		};
	});
	console.log('TIMEOUT DUMP', JSON.stringify(dump));
	console.log('errors so far', JSON.stringify(errors.slice(0, 6)));
}
const beamHit = await page.evaluate(() => ({
	hp: window.__gameScene.player.hp,
	dead: window.__gameScene.player.isDead || window.__gameScene.isGameOver,
	lastHitBy: window.__gameScene.lastHitBy,
}));
check('광선: 축선 위 = 즉살급 피해', beamHit.dead || beamHit.hp <= 100, JSON.stringify(beamHit));
check('사인: 처형 광선 기록', (beamHit.lastHitBy ?? '').includes('처형 광선'), beamHit.lastHitBy ?? '');

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
