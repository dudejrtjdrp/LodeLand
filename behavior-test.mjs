// 거동 아키타입 3종 + 키퍼 고유 메커닉 4종 회귀 테스트 (2026-09-01 신설).
//
// 검증 범위
//  (1) 카탈로그 — 아키타입 배정 개수(각 11자루)·등급/원소 분포·기본 거동 회귀 0
//  (2) 선회검 — 호 경로를 그리며 되돌아오고, 경로 위 여러 적을 관통 타격한다
//  (3) 말뚝검 — 명중 자리에 꽂히고(planted), 오라가 주변을 지지며, 그동안 궤도 자리가 빈다
//  (4) 참격검 — 목표 방향 직선으로 길게 관통하고, 사거리를 다 쓰면 귀환한다
//  (5) 키퍼 메커닉 — ASH 승계 / BASTION 반격 사출 / TALON 질풍 보법 / GILDER 감정사의 내기
//  (6) UI — 캐릭터 카드에 메커닉 표기 · 키워드 사전 등재 · 3뷰포트 카드 겹침 없음
//
// 실행: node behavior-test.mjs   (vite preview :5199 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
const results = [];
const check = (name, ok, detail = '') => {
	results.push([name, ok, detail]);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu', '--disable-crashpad'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));

// ─────────────────────────────────────────────────────────────
// (6-a) 캐릭터 선택 화면 — 게임에 들어가기 전에 먼저 본다
// ─────────────────────────────────────────────────────────────
await page.addInitScript(() => {
	try {
		localStorage.clear();
		// 4명 전부 해금해 카드 4장을 모두 볼 수 있게 한다
		localStorage.setItem('movesword-meta-v1', JSON.stringify({
			gold: 0, ranks: {}, characters: ['berserker', 'swordmaster', 'gambler'],
			clearedDanger: -1, lifetimeGold: 999999, guaranteeCoins: 0,
		}));
	} catch { /* 무시 */ }
});
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 20000 });
await page.waitForTimeout(700);

const cardProbe = await page.evaluate(() => {
	const sc = window.__charSelect;
	const texts = [];
	const rects = [];
	for (const card of sc.cards) {
		const found = card.container.list
			.filter((o) => typeof o.text === 'string' && o.text.length > 0)
			.map((o) => o.text);
		texts.push({ id: card.character.id, mech: card.character.mechanic?.name ?? null, found });
		rects.push({
			x: card.container.x - card.w / 2, y: card.container.y - card.h / 2, w: card.w, h: card.h,
		});
	}
	return { texts, rects };
});
check('키퍼 카드: 4명 모두 고유 메커닉 데이터 보유',
	cardProbe.texts.length === 4 && cardProbe.texts.every((t) => t.mech),
	cardProbe.texts.map((t) => t.mech).join(', '));
check('키퍼 카드: 메커닉 이름이 카드에 표기됨',
	cardProbe.texts.every((t) => t.found.some((line) => line.includes('고유') && line.includes(t.mech))),
	JSON.stringify(cardProbe.texts.map((t) => t.found.find((l) => l.includes('고유')) ?? '없음')));

// 3뷰포트 카드 겹침 QA
for (const [w, h] of [[1280, 720], [1440, 860], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(600);
	const layout = await page.evaluate(() => {
		const sc = window.__charSelect;
		return sc.cards.map((c) => ({
			x: c.container.x - c.w / 2, y: c.container.y - c.h / 2, w: c.w, h: c.h,
			// 카드 안 텍스트가 카드 밖으로 나가지 않는지
			overflow: c.container.list.some((o) => typeof o.text === 'string' && o.text
				&& (Math.abs(o.y) + (o.height ?? 0) * (1 - (o.originY ?? 0.5)) > c.h / 2 + 26)),
		}));
	});
	const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
	const noOverlap = layout.every((r, i) => layout.every((o, j) => i === j || !overlaps(r, o)));
	const noOverflow = layout.every((r) => !r.overflow);
	check(`캐릭터 카드 ${w}×${h}: 서로 겹침 없음 · 텍스트 카드 이탈 없음`,
		noOverlap && noOverflow, JSON.stringify({ noOverlap, noOverflow }));
}
await page.setViewportSize({ width: 1440, height: 860 });
await page.waitForTimeout(400);

// ─────────────────────────────────────────────────────────────
// 전투 진입 (ASH — 기본 키퍼)
// ─────────────────────────────────────────────────────────────
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2600);

const settle = async () => page.evaluate(() => {
	const s = window.__gameScene;
	if (s.villageSystem?.isActive) s.villageSystem.depart();
	s.progression.xpToNext = 999999999;
	if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
	s.tutorial?.finish?.();
	s.player.maxHp = 100000;
	s.player.hp = 100000;
});
await settle();
await page.waitForTimeout(700);

// ─────────────────────────────────────────────────────────────
// (1) 카탈로그 — 배정 개수 / 분포 / 기본 거동 회귀
// ─────────────────────────────────────────────────────────────
const cat = await page.evaluate(() => {
	const catalog = window.__gameScene.swordOrbit.swordCatalog;
	const by = {};
	const rar = {};
	const el = {};
	for (const s of catalog) {
		const b = s.behavior ?? 'orbit';
		by[b] = (by[b] ?? 0) + 1;
		if (b !== 'orbit') {
			(rar[b] ??= {})[s.rarity] = ((rar[b] ?? {})[s.rarity] ?? 0) + 1;
			(el[b] ??= new Set()).add(s.element ?? '-');
		}
	}
	for (const k of Object.keys(el)) el[k] = [...el[k]];
	const known = ['orbit', 'boomerang', 'stake', 'lance'];
	return {
		total: catalog.length, by, rar, el,
		unknown: catalog.filter((s) => s.behavior && !known.includes(s.behavior)).map((s) => s.id),
	};
});
check('카탈로그: 아키타입 3종이 각 11자루 (2026-09-01 확대 +12)',
	cat.by.boomerang === 11 && cat.by.stake === 11 && cat.by.lance === 11, JSON.stringify(cat.by));
check('카탈로그: 나머지는 전부 기본 거동 (회귀 0)',
	cat.by.orbit === cat.total - 33 && cat.unknown.length === 0,
	`orbit=${cat.by.orbit}/${cat.total}, unknown=${JSON.stringify(cat.unknown)}`);
check('카탈로그: 아키타입마다 등급이 4단계 이상으로 퍼져 있다',
	['boomerang', 'stake', 'lance'].every((b) => Object.keys(cat.rar[b]).length >= 4),
	JSON.stringify(cat.rar));
check('카탈로그: 아키타입마다 원소가 5종 이상으로 퍼져 있다',
	['boomerang', 'stake', 'lance'].every((b) => cat.el[b].length >= 5), JSON.stringify(cat.el));

// 전용 스프라이트 — 아키타입 대표 9종 + 번개 3종이 서로 다른 프레임을 쓴다
// (2026-09-01 2차: gyrefinch/pylonbeak/aurumshrike 가 시트의 마지막 빈칸 3개를 채웠다)
const frames = await page.evaluate(() => {
	const catalog = window.__gameScene.swordOrbit.swordCatalog;
	const ids = ['curlewing', 'ringtalon', 'stakebeak', 'cairnowl', 'lancequill', 'pikehawk',
		'sparkfinch', 'arcshrike', 'thunderowl',
		'gyrefinch', 'pylonbeak', 'aurumshrike'];
	const found = ids.map((id) => catalog.find((s) => s.id === id)).filter(Boolean);
	return {
		count: found.length,
		frames: found.map((s) => s.sheetOrder),
		unique: new Set(found.map((s) => s.sheetOrder)).size,
		texTotal: window.__gameScene.textures.get('sword').frameTotal,
	};
});
check('스프라이트: 전용 프레임 12종이 모두 존재하고 서로 다르다',
	frames.count === 12 && frames.unique === 12, JSON.stringify(frames.frames));
check('스프라이트: 시트 프레임 수는 그대로 (186 + __BASE)',
	frames.texTotal === 187, `${frames.texTotal}`);

// ─────────────────────────────────────────────────────────────
// 아키타입 거동 검증용 헬퍼
// ─────────────────────────────────────────────────────────────

/** 지정 거동의 검 1자루만 남기고, 플레이어 주변에 사냥감을 한 줄/원으로 깐다. */
const setupBehavior = async (behavior, layout, count) => page.evaluate(({ behavior, layout, count }) => {
	const s = window.__gameScene;
	const orbit = s.swordOrbit;
	// 기존 적 정리
	for (const e of s.enemyManager.enemies?.getChildren?.() ?? []) e.destroy?.();
	const def = orbit.swordCatalog.find((d) => d.behavior === behavior);
	orbit.rebuildLoadout([{ definition: def, level: 1, traits: [] }]);
	const sword = orbit.swords[0];
	sword.state = 'orbiting';
	sword.target = null;
	sword.scanTimer = 0;

	const spawned = [];
	for (let i = 0; i < count; i += 1) {
		let x;
		let y;
		if (layout === 'line') {
			// 오른쪽으로 뻗은 한 줄 (참격검의 직선 관통을 본다)
			x = s.player.x + 120 + i * 70;
			y = s.player.y;
		} else if (layout === 'arc') {
			// 호가 지나갈 만한 부채꼴 (선회검)
			const a = -0.15 + i * 0.42;
			x = s.player.x + Math.cos(a) * 190;
			y = s.player.y + Math.sin(a) * 190;
		} else {
			// 한 점 주변 뭉치 (말뚝검 오라)
			const a = (Math.PI * 2 * i) / count;
			x = s.player.x + 170 + Math.cos(a) * 42;
			y = s.player.y + Math.sin(a) * 42;
		}
		const e = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', { x, y });
		if (e) {
			e.hp = 9999999;
			e.maxHp = 9999999;
			e.moveSpeed = 0;
			e.speed = 0;
			e.setVelocity?.(0, 0);
			spawned.push(true);
		}
	}
	return { sword: def.id, behavior: def.behavior, enemies: spawned.length, swords: orbit.swords.length };
}, { behavior, layout, count });

/** 검 1자루의 상태·위치를 매 프레임 표본으로 모은다. */
const traceSword = async (ms) => page.evaluate((duration) => new Promise((resolve) => {
	const s = window.__gameScene;
	const sword = s.swordOrbit.swords[0];
	const samples = [];
	const startedAt = performance.now();
	const tick = () => {
		samples.push({
			t: Math.round(performance.now() - startedAt),
			state: sword.state,
			x: Math.round(sword.x), y: Math.round(sword.y),
			px: Math.round(s.player.x), py: Math.round(s.player.y),
			hits: sword.hitTargets ? sword.hitTargets.size : 0,
			arcT: sword._arcT ?? 0,
			travel: Math.round(sword._lanceTravel ?? 0),
		});
		if (performance.now() - startedAt < duration) requestAnimationFrame(tick);
		else resolve(samples);
	};
	requestAnimationFrame(tick);
}), ms);

// ─────────────────────────────────────────────────────────────
// (2) 선회검 — 호를 그리며 되돌아오고 경로 위 여러 적을 관통
// ─────────────────────────────────────────────────────────────
const boomSetup = await setupBehavior('boomerang', 'arc', 6);
check('선회검: 준비 (검 1자루 · 사냥감 6마리)',
	boomSetup.behavior === 'boomerang' && boomSetup.swords === 1 && boomSetup.enemies >= 5,
	JSON.stringify(boomSetup));

const boomTrace = await traceSword(2600);
// 2.6초 동안 여러 번 출격하므로 **첫 출격 한 구간만** 잘라서 호를 본다
const boomStart = boomTrace.findIndex((s) => s.state === 'launched');
const boomLaunched = [];
for (let i = boomStart; i >= 0 && i < boomTrace.length && boomTrace[i].state === 'launched'; i += 1) {
	boomLaunched.push(boomTrace[i]);
}
const boomMaxHits = Math.max(0, ...boomTrace.map((s) => s.hits));
// 호를 그렸는가: 출격 구간에서 "키퍼로부터의 거리"가 0 → 최대 → 0 으로 돌아오고,
// 진행 각도가 한쪽으로 크게 쓸려 간다.
const boomDist = boomLaunched.map((s) => Math.hypot(s.x - s.px, s.y - s.py));
const boomAngles = boomLaunched.map((s) => Math.atan2(s.y - s.py, s.x - s.px));
let boomSweep = 0;
for (let i = 1; i < boomAngles.length; i += 1) {
	let d = boomAngles[i] - boomAngles[i - 1];
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	boomSweep += d;
}
const boomPeak = boomDist.length ? Math.max(...boomDist) : 0;
const boomEnd = boomDist.length ? boomDist[boomDist.length - 1] : 999;
check('선회검: 목표를 지나쳐 멀리 나갔다가 키퍼에게 되돌아온다',
	boomPeak >= 150 && boomEnd < boomPeak * 0.75,
	`peak=${Math.round(boomPeak)} end=${Math.round(boomEnd)}`);
check('선회검: 호를 그린다 (진행 각도가 1.5rad 이상 쓸림)',
	Math.abs(boomSweep) >= 1.5, `sweep=${boomSweep.toFixed(2)}rad`);
check('선회검: 한 번 출격에 여러 적을 관통 타격',
	boomMaxHits >= 2, `maxHits=${boomMaxHits}`);

// ─────────────────────────────────────────────────────────────
// (3) 말뚝검 — 꽂히고, 오라가 지지고, 그동안 궤도 자리가 빈다
// ─────────────────────────────────────────────────────────────
const stakeSetup = await setupBehavior('stake', 'cluster', 5);
check('말뚝검: 준비 (검 1자루 · 사냥감 5마리)',
	stakeSetup.behavior === 'stake' && stakeSetup.enemies >= 4, JSON.stringify(stakeSetup));

const stakeTrace = await traceSword(2600);
const planted = stakeTrace.filter((s) => s.state === 'planted');
check('말뚝검: 명중 자리에 꽂힌다 (planted 상태 진입)',
	planted.length > 0, `${planted.length} 프레임`);
if (planted.length > 0) {
	const first = planted[0];
	const last = planted[planted.length - 1];
	const moved = Math.hypot(last.x - first.x, last.y - first.y);
	const offOrbit = Math.hypot(first.x - first.px, first.y - first.py);
	check('말뚝검: 꽂힌 동안 제자리를 지킨다 (궤도로 끌려가지 않는다)',
		moved <= 6, `이동 ${Math.round(moved)}px`);
	check('말뚝검: 꽂힌 자리는 궤도 밖 (그 자리의 홰가 빈다)',
		offOrbit > 60, `키퍼로부터 ${Math.round(offOrbit)}px`);
}

const stakeAura = await page.evaluate(() => new Promise((resolve) => {
	const s = window.__gameScene;
	const orbit = s.swordOrbit;
	const sword = orbit.swords[0];
	const list = () => (s.enemyManager.enemies?.getChildren?.() ?? []).filter((e) => e.active);
	const before = list().map((e) => e.hp);
	const label = sword.definition.name;
	const dmgBefore = orbit.runDamage[label] ?? 0;
	// 강제로 꽂아 두고 오라만 관찰한다 (명중 타이밍에 의존하지 않게)
	const victims = list();
	const target = victims[0];
	if (!target) { resolve({ noTarget: true }); return; }
	sword.setPosition(target.x, target.y);
	orbit.startPlantedSword(sword);
	const plantedSlot = sword.slot;
	setTimeout(() => {
		const after = list().map((e) => e.hp);
		const hurt = after.filter((hp, i) => hp < before[i]).length;
		resolve({
			hurt,
			state: sword.state,
			plantedSlots: orbit.plantedSlots(),
			plantedSlot,
			dmgDelta: Math.round((orbit.runDamage[label] ?? 0) - dmgBefore),
		});
	}, 1400);
}));
check('말뚝검: 오라가 주변 여러 적을 지속적으로 지진다',
	stakeAura.hurt >= 2 && stakeAura.dmgDelta > 0,
	JSON.stringify({ hurt: stakeAura.hurt, dmg: stakeAura.dmgDelta }));
check('말뚝검: 꽂힌 자리가 "빈 궤도"로 보고된다 (plantedSlots)',
	Array.isArray(stakeAura.plantedSlots) && stakeAura.plantedSlots.includes(stakeAura.plantedSlot),
	JSON.stringify(stakeAura.plantedSlots));

// 꽂힘이 영원하지 않은지 (제한 시간 뒤 귀환)
const stakeReturn = await page.evaluate(() => new Promise((resolve) => {
	const s = window.__gameScene;
	const sword = s.swordOrbit.swords[0];
	const startedAt = performance.now();
	const tick = () => {
		if (sword.state !== 'planted') { resolve({ state: sword.state, ms: Math.round(performance.now() - startedAt) }); return; }
		if (performance.now() - startedAt > 6000) { resolve({ state: 'planted', ms: 6000 }); return; }
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}));
check('말뚝검: 제한 시간이 지나면 뽑혀 돌아온다',
	stakeReturn.state !== 'planted', JSON.stringify(stakeReturn));

// 귀소(SPACE)로 즉시 뽑히는지
const stakeRecall = await page.evaluate(() => {
	const s = window.__gameScene;
	const orbit = s.swordOrbit;
	const sword = orbit.swords[0];
	const victims = (s.enemyManager.enemies?.getChildren?.() ?? []).filter((e) => e.active);
	if (!victims[0]) return { noTarget: true };
	sword.setPosition(victims[0].x, victims[0].y);
	orbit.startPlantedSword(sword);
	const before = sword.state;
	s.activeSkills.readyAt.recall = 0;
	const used = s.activeSkills.useRecall();
	return { before, used, after: sword.state };
});
check('말뚝검: 귀소(SPACE)로 즉시 뽑아 되부를 수 있다',
	stakeRecall.before === 'planted' && stakeRecall.used === true && stakeRecall.after !== 'planted',
	JSON.stringify(stakeRecall));

// ─────────────────────────────────────────────────────────────
// (4) 참격검 — 직선으로 길게 관통
// ─────────────────────────────────────────────────────────────
const lanceSetup = await setupBehavior('lance', 'line', 5);
check('참격검: 준비 (검 1자루 · 일렬 사냥감 5마리)',
	lanceSetup.behavior === 'lance' && lanceSetup.enemies >= 4, JSON.stringify(lanceSetup));

const lanceTrace = await traceSword(2600);
const lanceMaxHits = Math.max(0, ...lanceTrace.map((s) => s.hits));
const lanceTravel = Math.max(0, ...lanceTrace.map((s) => s.travel));
// 2.6초 동안 여러 번 출격하므로 **첫 출격 한 구간만** 잘라 직선성을 잰다
// (여러 출격을 이어 붙이면 당연히 꺾인 경로가 된다).
const lanceStart = lanceTrace.findIndex((s) => s.state === 'launched');
const lanceLaunched = [];
for (let i = lanceStart; i >= 0 && i < lanceTrace.length && lanceTrace[i].state === 'launched'; i += 1) {
	lanceLaunched.push(lanceTrace[i]);
}
// 직선성: 출격 구간의 시작→끝 직선 거리 대비 실제 이동 경로 길이
let pathLen = 0;
for (let i = 1; i < lanceLaunched.length; i += 1) {
	pathLen += Math.hypot(lanceLaunched[i].x - lanceLaunched[i - 1].x, lanceLaunched[i].y - lanceLaunched[i - 1].y);
}
const chord = lanceLaunched.length > 1
	? Math.hypot(lanceLaunched[lanceLaunched.length - 1].x - lanceLaunched[0].x,
		lanceLaunched[lanceLaunched.length - 1].y - lanceLaunched[0].y)
	: 0;
check('참격검: 곧게 나아간다 (경로 길이 ≈ 직선 거리)',
	chord > 100 && pathLen / Math.max(1, chord) < 1.12,
	`path=${Math.round(pathLen)} chord=${Math.round(chord)} ratio=${(pathLen / Math.max(1, chord)).toFixed(2)}`);
check('참격검: 사거리를 길게 쓴다 (300px 이상 관통)',
	lanceTravel >= 300, `travel=${lanceTravel}px`);
check('참격검: 한 줄에 선 적을 여러 마리 꿴다',
	lanceMaxHits >= 2, `maxHits=${lanceMaxHits}`);
check('참격검: 사거리를 다 쓰면 귀환한다 (출격 상태에 갇히지 않는다)',
	lanceTrace.some((s) => s.state === 'returning' || s.state === 'orbiting'),
	[...new Set(lanceTrace.map((s) => s.state))].join(','));

// ─────────────────────────────────────────────────────────────
// (5-a) ASH [승계] — 서로 다른 검이 이어 때리면 중첩, 끊기면 초기화
// ─────────────────────────────────────────────────────────────
const succession = await page.evaluate(() => {
	const s = window.__gameScene;
	const k = s.keeper;
	const orbit = s.swordOrbit;
	// 기본 거동 검 3자루로 갈아 끼운다 (아키타입 잔재 제거)
	const defs = orbit.swordCatalog.filter((d) => !d.behavior).slice(0, 3);
	orbit.rebuildLoadout(defs.map((d) => ({ definition: d, level: 1, traits: [] })));
	const enemy = (s.enemyManager.enemies?.getChildren?.() ?? []).find((e) => e.active);
	if (!enemy) return { noEnemy: true };

	k.successionStacks = 0;
	const seen = [];
	// 서로 다른 검으로 연속 타격
	for (const sword of orbit.swords) {
		k.onSwordHit(sword, enemy, 10, false);
		seen.push(k.successionStacks);
	}
	const afterDistinct = k.successionStacks;
	const multDistinct = k.damageMult();
	// 같은 검으로 또 때려도 오르지 않는다
	k.onSwordHit(orbit.swords[orbit.swords.length - 1], enemy, 10, false);
	const afterSame = k.successionStacks;
	return {
		id: k.id, seen, afterDistinct, afterSame, multDistinct,
		spec: { window: k.spec.windowMs, max: k.spec.maxStacks, per: k.spec.damagePerStack },
	};
});
check('ASH: 키퍼 메커닉 = 승계', succession.id === 'succession', succession.id);
check('ASH 승계: 서로 다른 검이 이어 때리면 중첩이 쌓인다',
	succession.afterDistinct >= 2, JSON.stringify(succession.seen));
check('ASH 승계: 같은 검이 연타해도 중첩이 오르지 않는다',
	succession.afterSame === succession.afterDistinct,
	`${succession.afterDistinct} → ${succession.afterSame}`);
check('ASH 승계: 중첩만큼 무리 전체 피해 배율이 오른다',
	Math.abs(succession.multDistinct - (1 + succession.afterDistinct * succession.spec.per)) < 1e-6,
	`mult=${succession.multDistinct.toFixed(3)}`);

const successionDecay = await page.evaluate(() => new Promise((resolve) => {
	const s = window.__gameScene;
	const k = s.keeper;
	const orbit = s.swordOrbit;
	// "이어지지 않는" 상황을 만든다 — 사냥감을 치우고, 파도가 다시 채워도 검이 나가지
	// 않도록 사슬 궤도로 묶어 둔다 (궤도 접촉 타격은 승계를 쌓지 않는다).
	for (const e of s.enemyManager.enemies?.getChildren?.() ?? []) e.destroy?.();
	orbit.noLaunch = true;
	for (const sw of orbit.swords) { sw.state = 'orbiting'; sw.target = null; }
	setTimeout(() => {
		// damageMult() 가 만료를 확인하며 중첩을 정리한다 — 반드시 먼저 부른다
		const mult = k.damageMult();
		const out = { stacks: k.successionStacks, mult };
		orbit.noLaunch = false;
		resolve(out);
	}, k.spec.windowMs + 700);
}));
check('ASH 승계: 이어지지 않으면 풀린다',
	successionDecay.stacks === 0 && successionDecay.mult === 1, JSON.stringify(successionDecay));

// 다른 키퍼에게는 승계가 붙지 않는다 (메커닉 격리)
const isolation = await page.evaluate(() => {
	const k = window.__gameScene.keeper;
	return { freeReroll: k.freeFirstReroll, dashMult: k.skillCooldownMult('dash'), counter: k.onPlayerHurt() };
});
check('메커닉 격리: ASH 는 다른 키퍼의 메커닉을 갖지 않는다',
	isolation.freeReroll === false && isolation.dashMult === 1 && isolation.counter === false,
	JSON.stringify(isolation));

// ─────────────────────────────────────────────────────────────
// (5-b~d) 나머지 세 키퍼 — 캐릭터를 바꿔 다시 진입한다
// ─────────────────────────────────────────────────────────────
const enterAs = async (characterId) => {
	await page.evaluate((id) => {
		const s = window.__gameScene;
		s.scene.start('GameScene', { characterId: id, danger: 0 });
	}, characterId);
	await page.waitForTimeout(3000);
	await page.waitForFunction(() => !!window.__gameScene?.keeper, null, { timeout: 20000 });
	await settle();
	await page.waitForTimeout(600);
};

// BASTION [반격 사출]
await enterAs('berserker');
const counter = await page.evaluate(() => {
	const s = window.__gameScene;
	const k = s.keeper;
	const orbit = s.swordOrbit;
	for (const e of s.enemyManager.enemies?.getChildren?.() ?? []) e.destroy?.();
	const enemy = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', {
		x: s.player.x + 150, y: s.player.y,
	});
	if (enemy) { enemy.hp = 999999; enemy.maxHp = 999999; }
	for (const sw of orbit.swords) { sw.state = 'orbiting'; sw.target = null; }
	const before = orbit.swords.map((sw) => sw.state);
	const fired = k.onPlayerHurt();
	const after = orbit.swords.map((sw) => sw.state);
	const boosted = orbit.swords.filter((sw) => (sw._diveBonusMult ?? 0) > 1).length;
	// 쿨다운 중에는 다시 나가지 않는다
	for (const sw of orbit.swords) { sw.state = 'orbiting'; sw.target = null; }
	const again = k.onPlayerHurt();
	return {
		id: k.id, noLaunch: orbit.noLaunch, fired, again, before, after, boosted,
		mult: k.spec.damageMult, count: k.counterCount,
	};
});
check('BASTION: 키퍼 메커닉 = 반격 사출', counter.id === 'counterstrike', counter.id);
check('BASTION 반격: 사슬 궤도(출격 없음)인데도 피격 시 검 1자루가 풀린다',
	counter.noLaunch === true && counter.fired === true
	&& counter.after.filter((s) => s === 'launched').length === 1,
	JSON.stringify({ before: counter.before, after: counter.after }));
check('BASTION 반격: 그 출격의 피해가 2배로 실린다',
	counter.boosted === 1 && counter.mult === 2, `boosted=${counter.boosted} mult=${counter.mult}`);
check('BASTION 반격: 재사용 대기 중에는 나가지 않는다',
	counter.again === false && counter.count === 1, JSON.stringify({ again: counter.again, n: counter.count }));

// TALON [질풍 보법]
await enterAs('swordmaster');
const gale = await page.evaluate(() => new Promise((resolve) => {
	const s = window.__gameScene;
	const k = s.keeper;
	// TALON 은 검 쿨다운 특성 때문에 모든 스킬이 이미 짧다 —
	// "대시만 추가로 절반인가"를 보려면 다른 스킬(귀소)의 감소율과 견줘야 한다.
	const base = s.activeSkills.catalog.dash.cooldownMs;
	const actual = s.activeSkills.cooldownMs('dash');
	const refBase = s.activeSkills.catalog.recall.cooldownMs;
	const refActual = s.activeSkills.cooldownMs('recall');
	for (const e of s.enemyManager.enemies?.getChildren?.() ?? []) e.destroy?.();
	// 대시 경로(오른쪽) 위에 사냥감을 깐다
	const victims = [];
	for (let i = 0; i < 4; i += 1) {
		const e = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', {
			x: s.player.x + 30 + i * 34, y: s.player.y,
		});
		if (e) { e.hp = 999999; e.maxHp = 999999; e.moveSpeed = 0; e.setVelocity?.(0, 0); victims.push(e); }
	}
	const hpBefore = victims.map((e) => e.hp);
	const hitsBefore = k.galewalkHits;
	s.activeSkills.readyAt.dash = 0;
	// 오른쪽으로 대시
	s.player.flipX = false;
	const used = s.activeSkills.useDash();
	setTimeout(() => {
		const hurt = victims.filter((e, i) => e.hp < hpBefore[i]).length;
		resolve({
			id: k.id, base, actual, refBase, refActual,
			ratio: (actual / base) / (refActual / refBase), used,
			hurt, hits: k.galewalkHits - hitsBefore, pct: k.spec.trailDamagePct,
		});
	}, 500);
}));
check('TALON: 키퍼 메커닉 = 질풍 보법', gale.id === 'galewalk', gale.id);
check('TALON 질풍: 대시 재사용이 다른 스킬 대비 절반이다',
	Math.abs(gale.ratio - 0.5) < 0.02,
	`대시 ${gale.base}→${gale.actual}ms · 귀소 ${gale.refBase}→${gale.refActual}ms · 비 ${gale.ratio.toFixed(2)}`);
check('TALON 질풍: 대시 경로의 적이 검에 훑인다',
	gale.used === true && gale.hurt >= 1 && gale.hits >= 1,
	JSON.stringify({ hurt: gale.hurt, hits: gale.hits }));

// GILDER [감정사의 내기]
await enterAs('gambler');
const wager = await page.evaluate(() => {
	const s = window.__gameScene;
	const k = s.keeper;
	const orbit = s.swordOrbit;
	const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
	const base = orbit.swordCatalog.find((d) => d.rarity === 'rare' && !d.evolved && !d.behavior);
	const outcomes = { up: 0, down: 0, keep: 0 };
	let mythicLeak = 0;
	for (let i = 0; i < 400; i += 1) {
		const got = k.gambleSword(base);
		const d = rarities.indexOf(got.rarity) - rarities.indexOf(base.rarity);
		if (d > 0) outcomes.up += 1;
		else if (d < 0) outcomes.down += 1;
		else outcomes.keep += 1;
		if (got.rarity === 'mythic' || got.evolved) mythicLeak += 1;
	}
	// 조합 전용(신화·진화) 검은 내기에 걸지 않는다
	const mythic = orbit.swordCatalog.find((d) => d.evolved);
	const mythicSame = k.gambleSword(mythic).id === mythic.id;
	// 상점 첫 되굴림 무료
	const shop = s.shopSystem;
	shop.rerollCount = 0;
	const firstPrice = shop.rerollPrice();
	shop.rerollCount = 1;
	const secondPrice = shop.rerollPrice();
	return {
		id: k.id, outcomes, mythicLeak, mythicSame, firstPrice, secondPrice,
		spec: { up: k.spec.upChance, down: k.spec.downChance },
	};
});
check('GILDER: 키퍼 메커닉 = 감정사의 내기', wager.id === 'wager', wager.id);
check('GILDER 내기: 등급이 오르내린다 (양방향 모두 발생)',
	wager.outcomes.up > 100 && wager.outcomes.down > 30 && wager.outcomes.keep > 80,
	JSON.stringify(wager.outcomes));
check('GILDER 내기: 확률이 데이터(45% / 20%)와 맞는다',
	Math.abs(wager.outcomes.up / 400 - wager.spec.up) < 0.09
	&& Math.abs(wager.outcomes.down / 400 - wager.spec.down) < 0.09,
	`up=${(wager.outcomes.up / 400).toFixed(2)} down=${(wager.outcomes.down / 400).toFixed(2)}`);
check('GILDER 내기: 조합 전용(신화·진화) 검은 내기에 걸지 않는다',
	wager.mythicLeak === 0 && wager.mythicSame === true,
	JSON.stringify({ leak: wager.mythicLeak, same: wager.mythicSame }));
check('GILDER 내기: 상점 첫 되굴림이 무료',
	wager.firstPrice === 0 && wager.secondPrice > 0,
	`${wager.firstPrice} / ${wager.secondPrice}`);

// ─────────────────────────────────────────────────────────────
// (6-b) 키워드 사전 — 아키타입·메커닉 용어가 등재돼 있는가
// ─────────────────────────────────────────────────────────────
const dict = await page.evaluate(() => {
	const k = window.__keywords ?? {};
	const need = ['거동', '선회검', '말뚝검', '참격검', '키퍼 메커닉'];
	return {
		missing: need.filter((n) => !k[n]),
		bodies: need.filter((n) => k[n]).map((n) => ({ n, len: k[n].body.length, ko: !/[A-Za-z]{6,}/.test(k[n].title) })),
	};
});
check('키워드 사전: 아키타입·메커닉 용어 5종 등재',
	dict.missing.length === 0, JSON.stringify(dict.missing));
check('키워드 사전: 본문이 비어 있지 않고 제목이 한국어',
	dict.bodies.every((b) => b.len > 30 && b.ko), JSON.stringify(dict.bodies.map((b) => b.len)));

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log('FAILED:', failed.map(([n]) => n).join(' | '));
	process.exit(1);
}
