// 난이도·웨이브 구조 개편 회귀 테스트 (2026-09-02).
//
// 검증 축 4개 — 사용자 피드백에 1:1 대응한다:
//   (A) 스폰 창 40초 고정     — 목표를 일찍 깨도 40초까지 스폰이 이어지고,
//                              창이 닫힌 뒤에는 남은 적을 전부 잡아야 라운드가 끝난다 (2026-09-06)
//   (B) 계단식 파워 스파이크  — 10/20/30/40/50 경계에서 체력·피해·저항·어픽스 예산이 계단으로 뛴다
//   (C) 근접적 도달성         — 라운드 25에서 근접적이 이동하는 키퍼의 압박 라인까지 온다
//   (D) 물량                  — 동시 생존 상한·스폰 간격이 라운드에 따라 올라간다
//
// 수치 밸런스 자체는 헤드리스 시뮬이 본다 (npm run balance-gate). 여기는 런타임 정합성이다.
//
// Run: node difficulty-test.mjs   (vite preview :5199 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5199;
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
page.on('console', (msg) => {
	// 샌드박스에는 인터넷이 없다 — 외부 리소스 로드 실패는 게임 결함이 아니다
	const text = msg.text();
	if (msg.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(text)) {
		errors.push(`CONSOLE: ${text}`);
	}
});

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
await page.waitForTimeout(2600); // 라운드 1 입장 연출이 걷히길 기다린다

// 키퍼가 시험 도중 죽지 않게 (라운드 40+ 스케일을 직접 맞으면 즉사한다)
await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.maxHp = 999999;
	s.player.hp = 999999;
});

// ─────────────────────────────────────────────────────────────────────────────
// (A) 스폰 창 40초 고정 (라운드는 그 뒤 잔당을 다 잡아야 끝난다)
// ─────────────────────────────────────────────────────────────────────────────

const timing = await page.evaluate(() => {
	const s = window.__gameScene;
	const w = s.waveSystem;
	const out = { min: w.constructor.SPAWN_WINDOW_MS, surviveDurations: [], objectives: [] };
	// 생존(RUST TIDE) 라운드는 라운드마다 길이가 달랐다 → 전부 40초여야 한다
	for (const round of [7, 11, 23, 39, 55, 91]) {
		const objective = w.buildObjective(round);
		if (objective.type === 'survive') {
			out.surviveDurations.push([round, objective.durationMs]);
		}
		out.objectives.push([round, objective.type]);
	}
	return out;
});

check('스폰 창 길이 상수 = 40초', timing.min === 40000, `${timing.min}ms`);
check(
	'생존 라운드 지속시간도 40초 고정 (버티는 시간 증가 없음)',
	timing.surviveDurations.length > 0 && timing.surviveDurations.every(([, ms]) => ms === 40000),
	timing.surviveDurations.map(([r, ms]) => `r${r}:${ms}`).join(' '),
);

// 목표 달성 시점과 라운드 종료 시점의 분리 (순수 로직 — 실시간 40초를 기다리지 않는다)
// 2026-09-06: 종료 조건 = 목표 달성 + 스폰 창(40초) 종료 + 그때까지 나온 적 전멸.
const gate = await page.evaluate(() => {
	const s = window.__gameScene;
	const w = s.waveSystem;
	w.startRound(4); // kill-count 라운드
	// 필드를 통제한다 — 잔당 수가 종료 조건이므로 스폰을 끊고 비운 상태에서 관측한다
	s.enemyManager.spawningEnabled = false;
	s.enemyManager.clearField();
	w.objective = { type: 'kill-count', required: 3, label: '토벌' };
	w.killsThisRound = 99;
	w.roundElapsedMs = 5000;
	const early = { goal: w.isGoalMet(), complete: w.isObjectiveComplete(), open: w.spawnWindowOpen() };
	w.cachedRemainingAt = -1;
	const earlyParts = w.getObjectiveParts();
	w.roundElapsedMs = 39999;
	const almost = { complete: w.isObjectiveComplete(), open: w.spawnWindowOpen() };
	w.roundElapsedMs = 40000;
	const cleared = { complete: w.isObjectiveComplete(), open: w.spawnWindowOpen(), left: w.remainingEnemyCount() };
	// 적이 한 마리라도 남아 있으면 40초가 지나도 끝나지 않는다
	s.enemyManager.spawnEnemy(s, s.player);
	const leftover = { complete: w.isObjectiveComplete(), left: w.remainingEnemyCount() };
	w.spawnWindowClosedAtMs = 40000;
	w.cachedRemainingAt = -1;
	const mopParts = w.getObjectiveParts();
	// 상태 복원 — 이대로 두면 다음 프레임에 completeRound() 가 돌아 마을이 열리고
	// GameScene.update 가 멈춘다 (그러면 이후 스폰 관측이 전부 0이 된다).
	s.enemyManager.clearField();
	s.enemyManager.spawningEnabled = true;
	w.spawnWindowClosedAtMs = null;
	w.mopUpExpired = false;
	w.goalMetAtMs = null;
	w.roundElapsedMs = 0;
	w.killsThisRound = 0;
	w.objective = w.buildObjective(4);
	return {
		early, almost, cleared, leftover,
		earlyLabel: earlyParts.label, earlyCount: earlyParts.count,
		mopLabel: mopParts.label, mopCount: mopParts.count,
	};
});

check('목표를 5초에 깨도 라운드는 끝나지 않는다', gate.early.goal === true && gate.early.complete === false,
	`goal=${gate.early.goal} complete=${gate.early.complete}`);
check('40초까지는 스폰 창이 열려 있다', gate.early.open === true && gate.almost.open === true,
	`5s=${gate.early.open} 39.999s=${gate.almost.open}`);
check('39.999초 미완료 / 40초+필드 비었으면 완료',
	gate.almost.complete === false && gate.cleared.complete === true && gate.cleared.left === 0,
	JSON.stringify(gate.cleared));
check('40초가 지나도 적이 남아 있으면 라운드가 안 끝난다',
	gate.leftover.left >= 1 && gate.leftover.complete === false, JSON.stringify(gate.leftover));
check('HUD: 스폰 중에는 남은 웨이브 시간', gate.earlyLabel === '남은 웨이브' && /초/.test(gate.earlyCount),
	`${gate.earlyLabel} ${gate.earlyCount}`);
check('HUD: 소탕 단계에는 남은 적 수', gate.mopLabel === '잔당 소탕' && /남은 적 \d+/.test(gate.mopCount),
	`${gate.mopLabel} ${gate.mopCount}`);

// 소탕 단계의 안전장치 — 스폰 차단·리시(leash)·하드캡
const mop = await page.evaluate(() => {
	const s = window.__gameScene;
	const w = s.waveSystem;
	const WINDOW = w.constructor.SPAWN_WINDOW_MS;
	const CAP = w.constructor.MOP_UP_HARD_CAP_MS;

	// 스폰 창이 닫히면 EnemyManager 의 스폰이 꺼진다 (update 한 프레임).
	// 잔당을 한 마리 남겨 둔다 — 필드가 비면 그 자리에서 completeRound() 가 돌아
	// 마을이 열리고 이후 관측이 무의미해진다.
	const enemy = s.enemyManager.spawnEnemy(s, s.player);
	w.objective = { type: 'kill-count', required: 1, label: 't' };
	w.killsThisRound = 99;
	w.roundElapsedMs = WINDOW;
	s.enemyManager.spawningEnabled = true;
	w.update(16);
	const closed = { at: w.spawnWindowClosedAtMs, spawning: s.enemyManager.spawningEnabled };

	// 리시: 멀리 달아난 잔당을 플레이어 주변으로 끌어온다
	enemy.setPosition(s.player.x + 6000, s.player.y + 6000);
	w.mopUpAssistTimer = 0;
	w.update(2100);
	const dx = enemy.x - s.player.x;
	const dy = enemy.y - s.player.y;
	const leashed = Math.sqrt(dx * dx + dy * dy);

	// 하드캡: 소탕이 너무 길어지면 잔당을 정리하고 끝낸다.
	// (update() 를 태우면 그대로 라운드가 끝나 버리므로 소탕 단계만 직접 돌린다)
	w.roundElapsedMs = w.spawnWindowClosedAtMs + CAP;
	w.updateMopUp(16);
	const capped = { expired: w.mopUpExpired, left: w.remainingEnemyCount(), complete: w.isObjectiveComplete() };

	// 상태 복원
	s.enemyManager.clearField();
	s.enemyManager.spawningEnabled = true;
	w.spawnWindowClosedAtMs = null;
	w.mopUpExpired = false;
	w.goalMetAtMs = null;
	w.roundElapsedMs = 0;
	w.killsThisRound = 0;
	w.objective = w.buildObjective(4);
	return { WINDOW, CAP, closed, leashed, capped };
});

check('스폰 창 = 40초', mop.WINDOW === 40000, String(mop.WINDOW));
check('창이 닫히면 스폰이 멈춘다', mop.closed.at >= 40000 && mop.closed.spawning === false,
	JSON.stringify(mop.closed));
check('소탕 중 멀리 새는 잔당을 끌어온다 (6000px → 리시 안)', mop.leashed < 1100,
	`${Math.round(mop.leashed)}px`);
check('소탕 하드캡(45초) → 잔당 정리 후 종료',
	mop.CAP === 45000 && mop.capped.expired === true && mop.capped.complete === true,
	JSON.stringify(mop.capped));

// 조기 전멸 후에도 스폰이 계속되는가 — 필드를 비우고 6초 관찰
await page.evaluate(() => {
	const s = window.__gameScene;
	// 혹시 마을이 열려 있으면 출발시킨다 (GameScene.update 가 멈춰 있으면 관측이 무의미)
	if (s.villageSystem?.isActive) {
		s.villageSystem.depart();
	}
	s.waveSystem.pendingIntermission = false;
	s.waveSystem.startRound(12);
});
await page.waitForTimeout(3400); // 입장 연출 + 첫 스폰 지연(2.6초)

const refill = await page.evaluate(() => {
	const s = window.__gameScene;
	// 목표를 이미 달성한 상태로 만든다 (조기 전멸 시뮬레이션)
	s.waveSystem.killsThisRound = 9999;
	for (const target of s.waveSystem.objective?.targets ?? []) {
		target.kills = target.required;
	}
	// 필드를 통째로 비운다
	for (const enemy of s.enemyManager.enemies.getChildren()) {
		if (enemy.active) {
			enemy.hp = 0;
			s.enemyManager.recycleEnemy(enemy);
		}
	}
	const alive = s.enemyManager.enemies.getChildren().filter((e) => e.active).length;
	return { clearedTo: alive, spawningEnabled: s.enemyManager.spawningEnabled, roundActive: s.waveSystem.roundActive };
});

await page.waitForTimeout(5000);

const afterRefill = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		alive: s.enemyManager.enemies.getChildren().filter((e) => e.active).length,
		roundActive: s.waveSystem.roundActive,
		elapsed: Math.round(s.waveSystem.roundElapsedMs),
	};
});

check('조기 전멸 뒤에도 라운드가 유지된다', afterRefill.roundActive === true && afterRefill.elapsed < 40000,
	`경과 ${afterRefill.elapsed}ms`);
check('조기 전멸 뒤 남은 시간 동안 스폰이 이어진다', afterRefill.alive >= 5,
	`비운 직후 ${refill.clearedTo}기 → 5초 뒤 ${afterRefill.alive}기`);

// ─────────────────────────────────────────────────────────────────────────────
// (B) 계단식 파워 스파이크
// ─────────────────────────────────────────────────────────────────────────────

const spikeSamples = {};
for (const round of [9, 10, 19, 20, 22, 29, 30, 39, 40, 45, 49, 50, 59, 60]) {
	// eslint-disable-next-line no-await-in-loop
	spikeSamples[round] = await page.evaluate((r) => {
		const s = window.__gameScene;
		s.waveSystem.startRound(r);
		const em = s.enemyManager;
		return {
			hpMult: em.hpMult,
			damageMult: em.damageMult,
			resistBonus: em.resistBonus,
			affixGuaranteed: em.affixBudget.guaranteed,
			affixMax: em.affixBudget.max,
			minAlive: em.minAlive,
			spawnIntervalMs: Math.round(em.nextSpawnInterval),
			dangerNote: s.waveSystem.dangerNoteFor(r),
		};
	}, round);
	// eslint-disable-next-line no-await-in-loop
	await page.waitForTimeout(120);
}

// 스파이크 사다리는 10단계(라운드 10~100)까지 이어진다 — 50 이후에도 계단이
// 있는지(후반이 평평해지지 않는지) 60라까지 표본으로 확인한다.
for (const boundary of [10, 20, 30, 40, 50, 60]) {
	const before = spikeSamples[boundary - 1];
	const after = spikeSamples[boundary];
	const hpJump = after.hpMult / before.hpMult - 1;
	// 유효 체력 = HP × 저항 경감의 역수
	const ehpJump = (after.hpMult / (1 - after.resistBonus)) / (before.hpMult / (1 - before.resistBonus)) - 1;
	check(`라운드 ${boundary} 스파이크: 적 유효 체력 +20% 이상`, ehpJump >= 0.2,
		`HP +${(hpJump * 100).toFixed(1)}% / 유효 +${(ehpJump * 100).toFixed(1)}%`);
	check(`라운드 ${boundary} 스파이크: 저항이 함께 오른다`, after.resistBonus > before.resistBonus,
		`${before.resistBonus.toFixed(3)} → ${after.resistBonus.toFixed(3)}`);
	check(`라운드 ${boundary} 스파이크: 위험도 상승 시그널 문구`,
		typeof after.dangerNote === 'string' && after.dangerNote.includes('위험도')
		&& before.dangerNote === null,
		String(after.dangerNote));
}

const affixSteps = [10, 20, 30, 40, 50, 60].map((r) => spikeSamples[r].affixGuaranteed + spikeSamples[r].affixMax);
check('어픽스(패시브) 예산이 단계마다 단조 증가', affixSteps.every((v, i) => i === 0 || v >= affixSteps[i - 1])
	&& affixSteps[affixSteps.length - 1] > affixSteps[0], affixSteps.join(' → '));

check('피해 배율도 계단으로 오른다',
	spikeSamples[20].damageMult / spikeSamples[19].damageMult - 1 >= 0.08,
	`r19 ${spikeSamples[19].damageMult.toFixed(2)} → r20 ${spikeSamples[20].damageMult.toFixed(2)}`);

// 대표 라운드 수치 (보고용)
const scaleTable = [10, 22, 30, 45].map((r) => `r${r}: hp×${(spikeSamples[r]?.hpMult ?? 0).toFixed(1)}`);

// ─────────────────────────────────────────────────────────────────────────────
// (D) 물량 — 동시 생존 상한 / 스폰 간격
// ─────────────────────────────────────────────────────────────────────────────

check('동시 생존 상한이 라운드에 따라 오른다',
	spikeSamples[50].minAlive > spikeSamples[10].minAlive && spikeSamples[50].minAlive <= 96,
	`r10 ${spikeSamples[10].minAlive} → r30 ${spikeSamples[30].minAlive} → r50 ${spikeSamples[50].minAlive}`);
check('스폰 간격이 라운드에 따라 짧아진다 (하한 260ms)',
	spikeSamples[50].spawnIntervalMs < spikeSamples[10].spawnIntervalMs && spikeSamples[50].spawnIntervalMs >= 260,
	`r10 ${spikeSamples[10].spawnIntervalMs}ms → r50 ${spikeSamples[50].spawnIntervalMs}ms`);

// ─────────────────────────────────────────────────────────────────────────────
// (C) 근접적 도달성 — 라운드 25, 움직이는 키퍼를 근접적이 따라붙는가
// ─────────────────────────────────────────────────────────────────────────────

const MELEE_IDS = ['skullwolf', 'skullwolf-brute', 'charger', 'hound', 'shieldbearer', 'cindermaul'];
/** 압박 라인 — 이 반경 안이면 "플레이어를 물고 있다"로 본다 */
const PRESSURE_PX = 300;
/** 프로브 스폰 반경 */
const SPAWN_PX = 620;

/**
 * 근접적 도달성 측정.
 * baseSpeed=true 면 개편 전(카탈로그 원본 속도)을 재현해 A/B 비교한다.
 * 키퍼는 "0.7초 이동 / 0.7초 정지"의 카이팅 듀티 사이클로 움직인다 —
 * 한 방향으로 무한정 달리는 것은 실제 플레이가 아니고, 그러면 어떤 근접적도 못 따라온다.
 */
async function measureReach(round, baseSpeed) {
	await page.evaluate(({ ids, useBase, r, spawnPx }) => {
		const s = window.__gameScene;
		if (s.villageSystem?.isActive) {
			s.villageSystem.depart();
		}
		s.waveSystem.pendingIntermission = false;
		s.waveSystem.startRound(r);
		// 어픽스는 속도를 ±45% 흔든다(신속 ×1.45 · 거인 ×0.85). 개편 전/후를 견주는
		// 자리에서는 그 난수가 결론을 뒤집으므로, 프로브에는 어픽스를 붙이지 않는다.
		// (어픽스 예산 자체는 (B) 스파이크 검사에서 따로 본다)
		s.enemyManager.affixBudget = { guaranteed: 0, bonusChance: 0, max: 0 };
		s.player.maxHp = 999999;
		s.player.hp = 999999;
		// 기존 프로브 정리 + 필드 비우기 (측정 대상만 남긴다)
		for (const enemy of s.enemyManager.enemies.getChildren()) {
			if (enemy.active) {
				enemy.hp = 0;
				s.enemyManager.recycleEnemy(enemy);
			}
		}
		window.__probe = [];
		const total = ids.length * 4;
		let i = 0;
		for (const id of ids) {
			for (let k = 0; k < 4; k += 1) {
				const angle = (i / total) * Math.PI * 2;
				const e = s.enemyManager.spawnEnemy(s, s.player, id, {
					x: s.player.x + Math.cos(angle) * spawnPx,
					y: s.player.y + Math.sin(angle) * spawnPx,
				});
				if (e) {
					// 검이 다 썰어버리면 도달성 측정이 안 된다 → 프로브만 사실상 무적
					e.maxHp = 1e9;
					e.hp = 1e9;
					if (useBase) {
						e.speed = e.catalog?.speed ?? e.speed;
					}
					window.__probe.push(e);
				}
				i += 1;
			}
		}
		return window.__probe.length;
	}, { ids: MELEE_IDS, useBase: baseSpeed, r: round, spawnPx: SPAWN_PX });

	// 속도를 낮추는 어픽스(거인 ×0.85 · 거상 ×0.75)는 "체력을 크게 주고 느려진다"는
	// 의도된 교환이다 — 속도 하한 검증에서는 그 개체를 빼고 본다. 그렇지 않으면
	// 어픽스가 랜덤으로 붙느냐에 따라 통과/실패가 갈리는 불안정한 검사가 된다.
	const SLOWING_AFFIXES = ['giant', 'colossal'];
	const speeds = await page.evaluate((slowing) => {
		const s = window.__gameScene;
		const byType = {};
		for (const e of window.__probe) {
			if ((e.affixIds ?? []).some((id) => slowing.includes(id))) {
				continue;
			}
			// 같은 종류가 여럿이면 가장 빠른 개체 = 어픽스 감속이 없는 순수 스케일 값
			byType[e.enemyType] = Math.max(byType[e.enemyType] ?? 0, Math.round(e.speed));
		}
		return { byType, playerSpeed: Math.round(s.player.moveSpeed) };
	}, SLOWING_AFFIXES);

	// 카이팅 패턴: 쉬지 않고 방향을 돌리되 한 방향으로 치우친 5스텝 루프(D D S A W).
	// 순수 원운동(제자리 카이팅)은 45px/s 짜리 몹도 결국 붙어서 변별력이 없고,
	// 한 방향 직주는 어떤 근접적도 못 따라와 변별력이 없다. 이 패턴은 초당 약 70px 씩
	// 도망치는 "몰면서 빠지는" 실제 플레이에 가깝다.
	for (let lap = 0; lap < 4; lap += 1) {
		for (const key of ['KeyD', 'KeyD', 'KeyS', 'KeyA', 'KeyW']) {
			// eslint-disable-next-line no-await-in-loop
			await page.keyboard.down(key);
			// eslint-disable-next-line no-await-in-loop
			await page.waitForTimeout(600);
			// eslint-disable-next-line no-await-in-loop
			await page.keyboard.up(key);
		}
	}

	const reach = await page.evaluate((limit) => {
		const s = window.__gameScene;
		const alive = window.__probe.filter((e) => e.active);
		let within = 0;
		const dists = [];
		for (const e of alive) {
			const d = Math.hypot(e.x - s.player.x, e.y - s.player.y);
			dists.push(Math.round(d));
			if (d <= limit) {
				within += 1;
			}
		}
		dists.sort((a, b) => a - b);
		return { total: alive.length, within, median: dists[Math.floor(dists.length / 2)] ?? -1 };
	}, PRESSURE_PX);

	return { ...reach, speeds, rate: reach.total > 0 ? reach.within / reach.total : 0 };
}

// 개편 전(카탈로그 원본 속도) → 개편 후(라운드 스케일 적용) A/B
const reachBefore = await measureReach(25, true);
const reachAfter = await measureReach(25, false);

check('라운드 25 근접적 이동속도가 하한을 받는다 (원본 45~90 → 76+)',
	Object.values(reachAfter.speeds.byType).every((v) => v >= 76),
	`개편전 ${JSON.stringify(reachBefore.speeds.byType)} → 개편후 ${JSON.stringify(reachAfter.speeds.byType)}`
	+ ` (키퍼 ${reachAfter.speeds.playerSpeed})`);

check(`라운드 25: 카이팅하는 키퍼의 압박 라인(${PRESSURE_PX}px)에 근접적 절반 이상 도달`,
	reachAfter.rate >= 0.5,
	`${reachAfter.within}/${reachAfter.total} (${(reachAfter.rate * 100).toFixed(0)}%) · 중앙 거리 ${reachAfter.median}px`);

// 도달률은 상한(100%)에 붙기 쉬워 단독으로는 변별력이 약하다 — 도달률은 "떨어지지
// 않았는가"로 보고, 실제 개선은 **중앙 거리**(작을수록 밀착)로 판정한다.
// 2026-09-06: 양쪽 다 100%로 붙으면 중앙 거리는 스폰 각도 난수라 실행마다 ±수십 px
// 흔들린다(8px↔32px 관측) — 엄격 비교는 위양성이 나서 관측 잡음폭을 허용한다.
const REACH_NOISE_PX = 40;
check('도달률이 개편 전 이상 · 중앙 거리가 가까워졌다 (A/B)',
	reachAfter.rate >= reachBefore.rate && reachAfter.median < reachBefore.median + REACH_NOISE_PX,
	`개편전 ${(reachBefore.rate * 100).toFixed(0)}% (중앙 ${reachBefore.median}px)`
	+ ` → 개편후 ${(reachAfter.rate * 100).toFixed(0)}% (중앙 ${reachAfter.median}px)`);

// ─────────────────────────────────────────────────────────────────────────────

check('콘솔/페이지 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n스케일 대표값: ${scaleTable.join(' · ')}`);
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);

await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
