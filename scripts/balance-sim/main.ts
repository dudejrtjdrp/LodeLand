// 헤드리스 밸런스 시뮬레이터 진입점.
//   node scripts/balance-sim/run.mjs              → 요약 표 + CSV
//   node scripts/balance-sim/run.mjs --gate       → 임계 위반 시 exit 1 (CI 게이트)
//   node scripts/balance-sim/run.mjs --rounds=80  → 라운드 범위 조정
//   node scripts/balance-sim/run.mjs --json       → 기계 판독용 출력
//
// ※ 근사 모델이다 (model.ts 상단 주석 참조). 절대 수치가 아니라
//   "빌드 간 상대 격차 / 벽이 서는 라운드"를 읽기 위한 도구다.

import {
	CAL, contextFor, evaluateRound, profileFor, roundWave, swordDpsVs,
	ROUND_MIN_SEC, SKILL_AUGMENT_COEFF, skillAugmentTotals,
	type Build, type RoundResult,
} from './model';
import {
	BEHAVIOR_AUDIT_ROUNDS, auditBehaviors, auditDominated, auditRecipes, elementBuilds, evolutionBuilds, randomBuilds, rarityBuilds,
} from './builds';
import { ROUND_SCALING, hpMultForRound, resistBonusForRound } from '../../src/logic/roundScaling';

interface Options { rounds: number; gate: boolean; json: boolean; csvPath: string | null; debug: string | null }

export interface BuildSummary {
	id: string;
	label: string;
	group: string;
	/** 라운드 10~rounds 구간의 기하평균 여유율 (스탯만) */
	meanMarginStats: number;
	meanMarginFull: number;
	/** 여유율이 1 아래로 처음 떨어지는 라운드 (없으면 null) */
	wallRound: number | null;
	/** 생존 시간이 목표(30초) 아래로 처음 떨어지는 라운드 */
	survivalWallRound: number | null;
	rows: RoundResult[];
}

/** 빌드 평균 여유율을 재는 라운드 구간 (지표 안정성을 위해 고정). */
export const SCORE_WINDOW: [number, number] = [10, 60];

/**
 * 후반 난이도 하한 — "무전략 랜덤 픽"은 이 라운드 안에서 반드시 벽을 만나야 한다.
 *
 * 게이트의 두 축은 서로 반대 방향을 막는다:
 *   commonWallRounds  = 어떤 빌드로도 못 넘는 구간 → 후반이 **불가능**해지는 것을 막고,
 *   BASELINE_WALL_LIMIT = 아무렇게나 집어도 안 죽는 상태 → 후반이 **공짜**가 되는 것을 막는다.
 * lateHpExpBase 를 낮춰 100라운드 벽을 푸는 조정이 지나치면 두 번째가 먼저 터진다.
 */
export const BASELINE_WALL_LIMIT = 75;

/**
 * 무전략 랜덤 픽이 벽을 만나야 하는 **하한** — 설계 의도는 "35~50라에서 벽"이다.
 * 2026-09-02 난이도 개편에서 적을 세게 하다가 이 값이 25까지 내려간 적이 있다
 * (그러면 아무 검이나 집는 첫 런이 중반도 못 가고 끊긴다). 위쪽 임계만 있으면
 * "세게 하는 방향"의 과잉은 아무도 안 잡아 주므로 아래쪽도 게이트로 박아 둔다.
 */
// 2026-09-04: 칸 해방 라운드 게이트([3,8,15,30,50]) + 흡혈 상한 + 적 체력 압박으로
// 랜덤 픽 벽이 25 근처로 내려왔다. 이번엔 의도된 하향이다 — "15~20라부터 서 있기만 해도
// 된다"는 피드백에 대한 답이고, 실제 플레이어에겐 시뮬이 모델링하지 않는 도구(궁극기
// 게이지·스킬 레벨·위험 이벤트·스킬 증강 +22% DPS)가 더 있다. 하한을 24 로 내린다.
// 2026-09-04 (2차): "잡몹이 전부 한 방" 피드백 → 적 체력 중반 ×2~2.5 + 수 감소(스폰 ×1.5 간격).
// 무전략 랜덤 픽은 이제 13라 근처에서 벽을 만난다 — 의도된 결과다. 대신 '잡몹 처치 타수'
// (TRASH_HITS_RANGE) 게이트가 "한 방/두 방"과 "스펀지" 양쪽을 막는다. 하한 12.
export const BASELINE_WALL_FLOOR = 12;
/** 원소 빌드 평균 검 1타 기준 잡몹 처치 타수 허용 범위 (라운드 8·15·25·40 에서 검사) */
export const TRASH_HITS_RANGE: [number, number] = [2.3, 7.5];
export const TRASH_HITS_ROUNDS = [8, 15, 25, 40];

/**
 * 계단식 파워 스파이크의 최소 크기 — 경계 라운드(10/20/30/40/50)에서 적의 유효 체력
 * (HP 배율 × 저항)이 직전 라운드 대비 최소 이만큼 뛰어야 "확 세졌다"가 읽힌다
 * (사용자 요청, 2026-09-02).
 *
 * 왜 여유율이 아니라 적 유효 체력인가: 경계 라운드에는 플레이어 성장도 같이 얹힌다
 * (10라 = 5번째 검 칸, 5의 배수 = 칸 강화 1단계). 한 라운드짜리 여유율만 보면 그
 * 성장에 계단이 묻혀 "스파이크가 없다"고 잘못 판정한다. 체감 쪽은 bandDrop
 * (단계 구간 10라운드 평균 여유율이 단조 감소하는가)으로 따로 본다.
 */
export const SPIKE_MIN_ENEMY_STEP = 0.20;
/** 스파이크 구간 여유율 단조성 판정의 허용 잡음 (+2%) */
export const SPIKE_BAND_NOISE = 0.02;

const geoMean = (values: number[]): number => {
	const filtered = values.filter((v) => v > 0);
	if (filtered.length === 0) {
		return 0;
	}
	return Math.exp(filtered.reduce((sum, v) => sum + Math.log(v), 0) / filtered.length);
};

export function runBuild(build: Build, rounds: number): BuildSummary {
	const rows: RoundResult[] = [];
	for (let round = 1; round <= rounds; round += 1) {
		rows.push(evaluateRound(build, round));
	}
	// 평균 여유율의 채점 구간은 10~60라운드로 고정한다 (--rounds 를 늘려도 지표가 흔들리지 않게).
	const scored = rows.filter((r) => r.round >= SCORE_WINDOW[0] && r.round <= SCORE_WINDOW[1]);
	// "벽" = **연속 두 라운드** 여유율 < 1 (2026-09-06).
	// 한 라운드만 보면 의도된 고비(칸 해방 직전·스파이크 경계 직후)가 전부 벽으로 잡힌다.
	// 실제로 라운드 7 근처는 검 3자루로 스파이크 1단계를 맞는 자리라 한 라운드 푹 꺼졌다가
	// 다음 라운드에 회복한다 — 그건 벽이 아니라 설계된 압박이다. 못 넘어가는 것만 벽으로 센다.
	const wall = rows.find((r, i) => r.round >= 5
		&& r.marginFull < 1
		&& (rows[i + 1]?.marginFull ?? Number.POSITIVE_INFINITY) < 1)?.round ?? null;
	// 라운드가 40초 고정이므로 "한 라운드를 못 버틴다" = 생존벽
	const survivalWall = rows.find((r) => r.round >= 5 && r.surviveSec < CAL.targetSurviveSec)?.round ?? null;
	return {
		id: build.id,
		label: build.label,
		group: build.group,
		meanMarginStats: geoMean(scored.map((r) => r.marginStats)),
		meanMarginFull: geoMean(scored.map((r) => r.marginFull)),
		wallRound: wall,
		survivalWallRound: survivalWall,
		rows,
	};
}

function parseArgs(argv: string[]): Options {
	const options: Options = { rounds: 60, gate: false, json: false, csvPath: null, debug: null };
	for (const arg of argv) {
		if (arg === '--gate') {
			options.gate = true;
		} else if (arg === '--json') {
			options.json = true;
		} else if (arg.startsWith('--rounds=')) {
			options.rounds = Number(arg.split('=')[1]) || 60;
		} else if (arg.startsWith('--csv=')) {
			options.csvPath = arg.split('=')[1];
		} else if (arg.startsWith('--debug=')) {
			// --debug=<buildId>:<round> — 검 1자루 단위 내역을 찍는다 (모델 점검용)
			options.debug = arg.split('=')[1];
		}
	}
	return options;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const fx = (value: number, digits = 2): string => value.toFixed(digits);

export interface SimReport {
	summaries: BuildSummary[];
	elementDeviation: { element: string; margin: number; deviation: number }[];
	maxElementDeviation: number;
	deadRecipes: ReturnType<typeof auditRecipes>;
	dominated: ReturnType<typeof auditDominated>;
	/** 거동 아키타입이 같은 등급의 기본 거동 검과 견줘 몇 배인가 */
	behaviors: ReturnType<typeof auditBehaviors>;
	baselineMargin: number;
	/** 랜덤 픽 베이스라인이 벽을 만나는 라운드의 중앙값 (끝까지 안 만나면 null). */
	baselineWallRound: number | null;
	commonWallRounds: number[];
	diveContribution: number;
	/** 계단식 파워 스파이크의 경계 라운드 (10/20/30/40/50) */
	spikeRounds: number[];
	/**
	 * 경계마다의 계단 크기.
	 *  - enemyStep: 적 유효 체력(HP × 저항)이 직전 라운드 대비 몇 % 뛰는가 → "적이 세졌다"
	 *  - bandDrop : 그 단계 10라운드 구간의 평균 여유율이 직전 구간 대비 몇 % 변하는가
	 *               → 플레이어 성장(검 칸·강화)까지 상쇄한 **체감 난이도**
	 * 경계 라운드 하나만 보면 그 라운드에 겹친 플레이어 성장(10라 5번째 검 칸,
	 * 5의 배수마다 칸 강화)에 묻히므로 구간 평균으로 본다.
	 */
	spikeDrops: Array<{ round: number; enemyStep: number; bandDrop: number }>;
	csv: string;
}

export function simulate(options: Options): SimReport {
	const elements = elementBuilds();
	const builds: Build[] = [
		...elements,
		...rarityBuilds(),
		...evolutionBuilds(),
		...randomBuilds(),
	];
	const summaries = builds.map((build) => runBuild(build, options.rounds));
	const byId = new Map(summaries.map((s) => [s.id, s]));

	// --- 원소 편차 (스탯 기준 — 스킬 계수의 불확실성을 배제) ---
	const elementSummaries = elements.map((b) => byId.get(b.id)!);
	// 편차는 "세트 스킬까지 포함한" 실전 여유율 기준 — 스킬도 그 원소의 힘이다.
	const elementMargins = elementSummaries.map((s) => s.meanMarginFull);
	const mean = elementMargins.reduce((a, b) => a + b, 0) / elementMargins.length;
	const elementDeviation = elementSummaries.map((s, i) => ({
		element: s.id.replace('element-', ''),
		margin: s.meanMarginStats,
		deviation: elementMargins[i] / mean - 1,
	})).sort((a, b) => a.deviation - b.deviation);
	const maxElementDeviation = Math.max(...elementDeviation.map((e) => Math.abs(e.deviation)));

	// --- 베이스라인 (랜덤 픽 평균) ---
	const baseline = summaries.filter((s) => s.group === 'baseline');
	const baselineMargin = geoMean(baseline.map((s) => s.meanMarginFull));
	// 벽을 못 만난 베이스라인은 "끝까지 여유로웠다"는 뜻이라 상한값으로 넣어 중앙값을 오염시킨다.
	const baselineWalls = baseline
		.map((s) => s.wallRound ?? Number.POSITIVE_INFINITY)
		.sort((a, b) => a - b);
	const median = baselineWalls[Math.floor(baselineWalls.length / 2)] ?? Number.POSITIVE_INFINITY;
	const baselineWallRound = Number.isFinite(median) ? median : null;

	// --- 전 빌드가 동시에 벽을 만나는 라운드 ---
	// "어떤 빌드로도 스폰을 따라잡지 못하는" 라운드만 벽으로 본다.
	// (약한 빌드가 못 버티는 것은 설계 의도 — 벽이 아니라 성장 압력이다)
	const commonWallRounds: number[] = [];
	for (let round = 5; round <= options.rounds; round += 1) {
		const best = Math.max(...summaries.map((s) => s.rows[round - 1]?.marginFull ?? 0));
		if (best < 1) {
			commonWallRounds.push(round);
		}
	}

	// --- 활공 사냥 기여도 (라운드 20 기준) ---
	const diveContribution = byId.get('element-fire')!.rows[19]?.diveContribution ?? 0;

	// --- 계단식 파워 스파이크 ---
	const spikeRounds: number[] = [];
	for (let tier = 1; tier <= ROUND_SCALING.spikeMaxTiers; tier += 1) {
		spikeRounds.push(tier * ROUND_SCALING.spikeEvery);
	}
	const elementRowsForSpike = summaries.filter((s) => s.group === 'element');
	/** 적 유효 체력 = HP 배율 × 저항 경감의 역수 (저항이 오르면 실질 체력이 오른다) */
	const enemyEhp = (round: number) => hpMultForRound(round) / Math.max(0.15, 1 - resistBonusForRound(round));
	/** 단계 구간 [from, to] 의 원소 빌드 평균 여유율 */
	const bandMargin = (from: number, to: number) => {
		const values: number[] = [];
		for (let r = from; r <= Math.min(to, options.rounds); r += 1) {
			for (const summary of elementRowsForSpike) {
				const margin = summary.rows[r - 1]?.marginFull ?? 0;
				if (margin > 0) {
					values.push(margin);
				}
			}
		}
		return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
	};
	const spikeDrops = spikeRounds
		.filter((r) => r >= 2 && r <= options.rounds)
		.map((round) => ({
			round,
			enemyStep: enemyEhp(round) / Math.max(1e-6, enemyEhp(round - 1)) - 1,
			bandDrop: bandMargin(round, round + ROUND_SCALING.spikeEvery - 1)
				/ Math.max(1e-6, bandMargin(round - ROUND_SCALING.spikeEvery, round - 1)) - 1,
		}));

	// --- CSV ---
	const lines = ['build,group,round,marginStats,marginFull,partyDps,avgTtkSec,spawnIntervalSec,surviveSec,bossTtkSec'];
	for (const summary of summaries) {
		if (summary.group === 'baseline' && summary.id !== 'random-0') {
			continue; // CSV 폭주 방지: 베이스라인은 대표 1개만
		}
		for (const row of summary.rows) {
			lines.push([
				summary.id, summary.group, row.round,
				fx(row.marginStats, 3), fx(row.marginFull, 3), Math.round(row.partyDps),
				fx(row.avgTtkSec, 3), fx(row.spawnIntervalSec, 3),
				fx(row.surviveSec, 1), fx(row.bossTtkSec, 1),
			].join(','));
		}
	}

	return {
		summaries,
		elementDeviation,
		maxElementDeviation,
		deadRecipes: auditRecipes().filter((r) => r.dead),
		dominated: auditDominated(),
		behaviors: auditBehaviors(),
		baselineMargin,
		baselineWallRound,
		commonWallRounds,
		diveContribution,
		spikeRounds,
		spikeDrops,
		csv: lines.join('\n'),
	};
}

export function printReport(report: SimReport, options: Options): void {
	const line = (text = '') => console.log(text);

	line('='.repeat(78));
	line('LODELAND 밸런스 시뮬 (근사 모델) — 여유율 = 스폰 간격 / 평균 처치 시간');
	line(`라운드 1~${options.rounds} · 여유율 1.0 = 스폰과 처치가 균형 · <1 = 적이 쌓인다`);
    line('='.repeat(78));

	line('\n[원소별 여유율 — 순수 원소 빌드]');
	line('원소       스탯만   세트스킬포함    편차     벽라운드  생존벽');
	for (const entry of report.elementDeviation) {
		const summary = report.summaries.find((s) => s.id === `element-${entry.element}`)!;
		line(`${entry.element.padEnd(10)} ${fx(entry.margin).padStart(6)} ${fx(summary.meanMarginFull).padStart(12)}`
			+ `${pct(entry.deviation).padStart(11)}${String(summary.wallRound ?? '-').padStart(9)}`
			+ `${String(summary.survivalWallRound ?? '-').padStart(8)}`);
	}
	line(`최대 편차(세트스킬 포함 기준): ${pct(report.maxElementDeviation)} (임계 ±25%)`);

	line('\n[등급 티어 / 진화 / 베이스라인]');
	for (const summary of report.summaries) {
		if (summary.group !== 'rarity' && summary.id !== 'evo-top7') {
			continue;
		}
		line(`${summary.label.padEnd(24)} 여유율 ${fx(summary.meanMarginFull).padStart(7)}  벽 ${String(summary.wallRound ?? '-')}`);
	}
	line(`${'무전략 랜덤 픽(평균)'.padEnd(22)} 여유율 ${fx(report.baselineMargin).padStart(7)}`
		+ `  벽(중앙값) ${report.baselineWallRound ?? '없음'} (임계 ${BASELINE_WALL_FLOOR}~${BASELINE_WALL_LIMIT})`);

	line('\n[진화 단일 빌드 — 베이스라인 대비]');
	for (const summary of report.summaries.filter((s) => s.group === 'evolution-single')) {
		const ratio = summary.meanMarginFull / report.baselineMargin;
		line(`${summary.label.padEnd(24)} ${fx(summary.meanMarginFull).padStart(7)}  (베이스 대비 ${fx(ratio)}배)`);
	}

	line('\n[죽은 레시피 — 결과가 최고 재료의 1.15배 미만]');
	if (report.deadRecipes.length === 0) {
		line('  없음');
	}
	for (const recipe of report.deadRecipes) {
		line(`  ${recipe.ingredients.join(' + ')} → ${recipe.result}: 이득 ${pct(recipe.gain)}`);
	}

	line('\n[완전 열등 검 (같은 등급 내 전 스탯 열세)]');
	line(`  ${report.dominated.length}종` + (report.dominated.length > 0
		? `: ${report.dominated.map((d) => `${d.id}<${d.dominatedBy}`).join(', ')}` : ''));

	line('\n[거동 아키타입 — 같은 검을 기본 거동으로 뒀을 때 대비 DPS (평균 목표 0.85~1.20)]');
	line(`  ${'아키타입'.padEnd(8)} 종수   평균   라운드 ${BEHAVIOR_AUDIT_ROUNDS.join('/')}`);
	if (report.behaviors.length === 0) {
		line('  없음');
	}
	for (const entry of report.behaviors) {
		line(`  ${entry.label.padEnd(9)} ${String(entry.count).padStart(2)}종 ${fx(entry.relDps).padStart(6)}   `
			+ entry.byRound.map((v) => fx(v)).join(' '));
	}

	// 계단식 파워 스파이크 — 경계 라운드 직전/직후의 여유율이 실제로 "뚝" 떨어지는지
	line(`\n[계단식 파워 스파이크 — 라운드 ${ROUND_MIN_SEC}초 고정 · 원소 빌드 평균 여유율]`);
	line('  경계  단계  적 유효체력 점프   구간 여유율 변화   스폰간격  40초당 스폰');
	const elementRows = report.summaries.filter((s) => s.group === 'element');
	for (const entry of report.spikeDrops) {
		const row = elementRows[0]?.rows[entry.round - 1];
		line(`  ${String(entry.round).padStart(4)}${String(entry.round / ROUND_SCALING.spikeEvery).padStart(5)}단계`
			+ `${pct(entry.enemyStep).padStart(14)}`
			+ `${pct(entry.bandDrop).padStart(19)}`
			+ `${fx(row?.spawnIntervalSec ?? 0).padStart(11)}s`
			+ `${fx(row?.spawnsPerRound ?? 0, 1).padStart(12)}`);
	}
	line(`  (적 유효체력 점프 임계 ≥${pct(SPIKE_MIN_ENEMY_STEP)} · 구간 여유율은 단조 감소여야 한다)`);

	line('\n[전 빌드 동시 벽]');
	line(report.commonWallRounds.length === 0 ? '  없음'
		: `  라운드 ${report.commonWallRounds.join(', ')}`);

	line(`\n[활공 사냥 DPS 기여] ${pct(report.diveContribution)} (목표 5~12%)`);

	// 스킬 시너지 증강 — 근사 계수만 기록한다 (여유율·게이트에는 넣지 않는다).
	// 이유: 전 빌드가 항상 드는 값이 아니라 최대 4장만 고르는 선택지라서.
	const skillTotals = skillAugmentTotals();
	line('\n[스킬 시너지 증강 — 근사 계수 (여유율 미반영)]');
	for (const [id, coeff] of Object.entries(SKILL_AUGMENT_COEFF)) {
		const parts: string[] = [];
		if (coeff.dps) {
			parts.push(`DPS ${pct(coeff.dps)}`);
		}
		if (coeff.survive) {
			parts.push(`생존 ${pct(coeff.survive)}`);
		}
		line(`  ${id.padEnd(18)} ${parts.join(' · ')}`);
	}
	line(`  합계(전부 가정) DPS ${pct(skillTotals.dps)} · 생존 ${pct(skillTotals.survive)}`
		+ ' — 실제로는 런당 최대 4장');

	// 잡몹 "몇 방에 죽나" — 원소 빌드 평균 (2026-09-04 사용자 피드백: 잡몹이 전부 한 방)
	line('\n[잡몹 처치 타수 — 원소 빌드 평균 검 1타 기준 · 라운드 3/8/15/25/40/60]');
	const hitRounds = [3, 8, 15, 25, 40, 60];
	const hitCols = hitRounds.map((round) => {
		const elementRows = report.summaries.filter((b) => b.group === 'element');
		const avg = elementRows.reduce((sum, b) => sum + (b.rows.find((r) => r.round === round)?.trashHits ?? 0), 0) / Math.max(1, elementRows.length);
		return `${round}라 ${avg.toFixed(1)}타`;
	});
	line(`  ${hitCols.join(' · ')}   (목표 3~6타)`);

	const profile = profileFor(30);
	line(`\n[참고] 라운드 30 프로파일: 검 ${profile.swordCount}자루 Lv${profile.swordLevel}`
		+ ` · 강화 +${profile.enhance} · 키퍼 Lv${profile.playerLevel} · 피해 배율 ${fx(profile.damageMultiplier)}`);
}

export function gateCheck(report: SimReport): string[] {
	const failures: string[] = [];
	// 잡몹 처치 타수 — 한 방(<2.3)도, 스펀지(>7.5)도 막는다
	const elementRows = report.summaries.filter((b) => b.group === 'element');
	for (const round of TRASH_HITS_ROUNDS) {
		const avg = elementRows.reduce((sum, b) => sum + (b.rows.find((r) => r.round === round)?.trashHits ?? 0), 0) / Math.max(1, elementRows.length);
		if (avg < TRASH_HITS_RANGE[0] || avg > TRASH_HITS_RANGE[1]) {
			failures.push(`잡몹 처치 타수 이탈: 라운드 ${round} 에서 ${avg.toFixed(1)}타 (허용 ${TRASH_HITS_RANGE[0]}~${TRASH_HITS_RANGE[1]})`);
		}
	}
	if (report.maxElementDeviation > 0.25) {
		const worst = report.elementDeviation[0];
		const best = report.elementDeviation[report.elementDeviation.length - 1];
		failures.push(`원소 편차 ${pct(report.maxElementDeviation)} > 25%`
			+ ` (최약 ${worst.element} ${pct(worst.deviation)}, 최강 ${best.element} ${pct(best.deviation)})`);
	}
	if (report.deadRecipes.length > 0) {
		failures.push(`죽은 레시피 ${report.deadRecipes.length}종: ${report.deadRecipes.map((r) => r.result).join(', ')}`);
	}
	if (report.dominated.length > 0) {
		failures.push(`완전 열등 검 ${report.dominated.length}종: ${report.dominated.map((d) => d.id).join(', ')}`);
	}
	for (const entry of report.behaviors) {
		if (entry.relDps < 0.85 || entry.relDps > 1.2) {
			failures.push(`거동 아키타입 ${entry.label} DPS ${fx(entry.relDps)}배 (목표 0.85~1.20)`);
		}
	}
	if (report.commonWallRounds.length > 0) {
		failures.push(`전 빌드 동시 벽: 라운드 ${report.commonWallRounds.slice(0, 6).join(', ')}`);
	}
	// 계단식 스파이크가 실제로 "느껴지는" 크기인가 — 경계에서 여유율이 최소 이만큼 떨어져야 한다.
	// (연속 곡선에 묻히면 사용자가 요청한 "확 세지는 지점"이 사라진다)
	for (const entry of report.spikeDrops) {
		if (entry.enemyStep < SPIKE_MIN_ENEMY_STEP) {
			failures.push(`파워 스파이크 미달: 라운드 ${entry.round} 적 유효체력 점프 ${pct(entry.enemyStep)}`
				+ ` (최소 ${pct(SPIKE_MIN_ENEMY_STEP)})`);
		}
		// 첫 경계(10라)는 비교 대상이 1~9라 — 검 2~4자루로 시작하는 도입부라
		// 원래 가장 빡빡하다. 여기서 여유율이 오르는 것은 정상(성장 보상)이므로 제외한다.
		// 구간 평균은 검 레벨/강화 계단(정수)에 따라 ±2% 흔들린다 — 그 잡음은 계단 무효로 보지 않는다 (2026-09-04)
		if (entry.round > ROUND_SCALING.spikeEvery && entry.bandDrop > SPIKE_BAND_NOISE) {
			failures.push(`파워 스파이크 무효: 라운드 ${entry.round} 이후 구간 여유율이 ${pct(entry.bandDrop)} 올랐다`
				+ ' (계단이 플레이어 성장에 묻힌다)');
		}
	}
	if (report.baselineWallRound === null || report.baselineWallRound > BASELINE_WALL_LIMIT) {
		failures.push(`후반 난이도 소실: 무전략 랜덤 픽이 라운드 ${report.baselineWallRound ?? '끝'}`
			+ ` 까지 벽을 만나지 않는다 (임계 ≤${BASELINE_WALL_LIMIT})`);
	}
	if (report.baselineWallRound !== null && report.baselineWallRound < BASELINE_WALL_FLOOR) {
		failures.push(`중반 난이도 과잉: 무전략 랜덤 픽이 라운드 ${report.baselineWallRound} 에서 벽을 만난다`
			+ ` (임계 ≥${BASELINE_WALL_FLOOR} — 아무 검이나 집어도 중반까지는 굴러가야 한다)`);
	}
	return failures;
}

/** --debug=<buildId>:<round> — 모델이 이상해 보일 때 검 1자루 단위 내역을 본다. */
function printDebug(builds: Build[], spec: string): void {
	const [buildId, roundText] = spec.split(':');
	const build = builds.find((b) => b.id === buildId);
	if (!build) {
		console.error(`빌드 없음: ${buildId} (예: element-fire, rarity-mythic)`);
		return;
	}
	const round = Number(roundText) || 30;
	const profile = profileFor(round);
	const equipped = build.pick(round, profile.swordCount);
	const ctx = contextFor(equipped, profile);
	const { pool, spawnIntervalSec, alive } = roundWave(round);
	console.log(`\n[debug] ${build.label} @ 라운드 ${round}`);
	console.log(`  프로파일: 검 ${profile.swordCount}자루 Lv${profile.swordLevel} · 강화 +${profile.enhance}`
		+ ` · 피해배율 ${fx(profile.damageMultiplier)} · 쿨다운배율 ${fx(profile.cooldownMultiplier)}`
		+ ` · 치명 ${pct(profile.critChance)}`);
	console.log(`  세트: ${JSON.stringify(ctx.elementCounts)} · 스킬 ${[...ctx.setSkills].join(',') || '없음'}`
		+ ` · dmgMult ${fx(ctx.setMods.dmgMult)} · pen ${fx(ctx.setMods.pen)}`);
	const sample = pool[0];
	console.log(`  표본 적: ${sample.def.name} hp ${Math.round(sample.hp)}`
		+ ` · 물저 ${pct(sample.physicalResist)} · 마저 ${pct(sample.magicResist)}`
		+ ` · 특성 ${sample.traits.map((t) => t.id).join(',') || '없음'} · 동시 생존 ${alive}`);
	let total = 0;
	for (const sword of equipped) {
		const result = swordDpsVs(sword, ctx, sample, alive);
		total += result.dps;
		console.log(`   - ${sword.id.padEnd(14)} 1타 ${Math.round(result.perHit).toString().padStart(6)}`
			+ ` · 사이클 ${fx(result.cycleSec)}s · ${fx(result.hitsPerSec)}타/s · DPS ${Math.round(result.dps)}`);
	}
	console.log(`  파티 DPS ${Math.round(total)} · 처치시간 ${fx(sample.hp / total)}s`
		+ ` · 스폰간격 ${fx(spawnIntervalSec)}s · 여유율 ${fx(spawnIntervalSec / (sample.hp / total))}`);
}

export function main(argv: string[], writeCsv: (path: string, text: string) => void): number {
	const options = parseArgs(argv);
	const report = simulate(options);

	if (options.debug) {
		printDebug([...elementBuilds(), ...rarityBuilds(), ...evolutionBuilds(), ...randomBuilds()], options.debug);
	}

	if (options.json) {
		console.log(JSON.stringify({
			elementDeviation: report.elementDeviation,
			maxElementDeviation: report.maxElementDeviation,
			deadRecipes: report.deadRecipes,
			dominated: report.dominated,
			baselineMargin: report.baselineMargin,
			baselineWallRound: report.baselineWallRound,
			commonWallRounds: report.commonWallRounds,
			diveContribution: report.diveContribution,
			spikeRounds: report.spikeRounds,
			spikeDrops: report.spikeDrops,
			builds: report.summaries.map((s) => ({
				id: s.id, group: s.group, meanMarginStats: s.meanMarginStats,
				meanMarginFull: s.meanMarginFull, wallRound: s.wallRound,
			})),
		}, null, 2));
	} else {
		printReport(report, options);
	}

	const csvPath = options.csvPath ?? 'scripts/balance-sim/out/margins.csv';
	writeCsv(csvPath, report.csv);
	if (!options.json) {
		console.log(`\nCSV: ${csvPath}`);
	}

	if (options.gate) {
		const failures = gateCheck(report);
		if (failures.length > 0) {
			console.error('\nBALANCE GATE 실패:');
			for (const failure of failures) {
				console.error(`  - ${failure}`);
			}
			return 1;
		}
		console.log('\nBALANCE GATE 통과');
	}
	return 0;
}
