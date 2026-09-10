// 로컬 사망 텔레메트리 (2026-09-01) — 런이 끝날 때마다 한 줄씩 쌓는 순환 버퍼.
//
// 무엇을 위한 것인가
// ------------------
// 밸런스 시뮬(scripts/balance-sim)은 **근사 모델**이다. "라운드 37에서 벽"이라는
// 예측이 실제 플레이와 맞는지 확인할 실측이 없었다. 이 모듈이 그 실측을 만든다:
// 런이 끝날 때 {사망 라운드 · 키퍼 · 검 구성 · 어픽스 수 · 소요 시간}을 남기고,
// 도감의 "기록" 탭이 그걸 읽어 평균 사망 라운드·키퍼별 최고 라운드를 보여준다.
//
// 개인정보 없음 · 전송 없음
// -------------------------
// 전부 이 브라우저의 localStorage 안에서만 산다. 서버로 나가는 코드는 없고,
// 저장되는 값도 게임 안에서 만들어진 숫자와 카탈로그 id 뿐이다.
// (원본 구조 문서: scripts/balance-sim/TUNING.md 의 "부록 A — 로컬 런 기록")
//
// 세이브 호환
// -----------
// 별도 키(movesword-runlog-v1)라서 기존 세이브·메타·도감과 겹치지 않는다.
// 이 키가 없거나 깨져 있어도 게임은 그대로 시작된다 (빈 배열로 읽는다).

const KEY = 'movesword-runlog-v1';

/** 순환 버퍼 상한 — 최근 50런 (초과분은 앞에서 버린다) */
export const RUN_LOG_MAX = 50;

export interface RunSwordSummary {
	/** 종료 시점의 장착 + 보관 검 수 */
	count: number;
	/** 원소별 자루 수 (무원소는 'none') */
	elements: Record<string, number>;
	/** 거동 아키타입별 자루 수 (orbit/boomerang/stake/lance) */
	archetypes: Record<string, number>;
}

export interface RunRecord {
	/** 런이 끝난 시각 (epoch ms) */
	at: number;
	/** 사망(또는 클리어)한 라운드 */
	round: number;
	/** 키퍼 id (playerCatalog) */
	keeper: string;
	/** true = 최종 라운드까지 클리어, false = 사망 */
	won: boolean;
	/** 런 소요 시간(ms) */
	durationMs: number;
	/** 누적 처치 수 */
	kills: number;
	/** 키퍼 레벨 */
	level: number;
	/** 그 라운드에서 등장 가능했던 적 어픽스 종류 수 */
	affixes: number;
	swords: RunSwordSummary;
}

interface RunLogState {
	version: 1;
	runs: RunRecord[];
}

let cached: RunLogState | null = null;

function sanitizeCounts(raw: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!raw || typeof raw !== 'object') {
		return out;
	}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			out[key] = value;
		}
	}
	return out;
}

function sanitize(raw: unknown): RunRecord | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const row = raw as Partial<RunRecord> & { swords?: Partial<RunSwordSummary> };
	if (typeof row.round !== 'number' || typeof row.keeper !== 'string') {
		return null;
	}
	return {
		at: typeof row.at === 'number' ? row.at : 0,
		round: Math.max(0, Math.round(row.round)),
		keeper: row.keeper,
		won: row.won === true,
		durationMs: typeof row.durationMs === 'number' ? Math.max(0, row.durationMs) : 0,
		kills: typeof row.kills === 'number' ? Math.max(0, row.kills) : 0,
		level: typeof row.level === 'number' ? Math.max(1, row.level) : 1,
		affixes: typeof row.affixes === 'number' ? Math.max(0, row.affixes) : 0,
		swords: {
			count: typeof row.swords?.count === 'number' ? row.swords.count : 0,
			elements: sanitizeCounts(row.swords?.elements),
			archetypes: sanitizeCounts(row.swords?.archetypes),
		},
	};
}

function load(): RunLogState {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<RunLogState>) : {};
		const runs = Array.isArray(parsed.runs)
			? parsed.runs.map(sanitize).filter((row): row is RunRecord => row !== null)
			: [];
		cached = { version: 1, runs: runs.slice(-RUN_LOG_MAX) };
	} catch {
		cached = { version: 1, runs: [] };
	}
	return cached;
}

function persist(): void {
	if (!cached) {
		return;
	}
	try {
		localStorage.setItem(KEY, JSON.stringify(cached));
	} catch {
		// 저장 불가 환경(시크릿 모드 등)에서는 세션 메모리만 유지
	}
}

/**
 * 런 하나를 기록한다. 런 종료 경로(GameScene.showGameOver)에서 **한 번만** 불린다 —
 * 전투 핫패스가 아니다.
 */
export function recordRun(entry: Omit<RunRecord, 'at'> & { at?: number }): RunRecord {
	const state = load();
	const row = sanitize({ ...entry, at: entry.at ?? Date.now() })!;
	state.runs.push(row);
	while (state.runs.length > RUN_LOG_MAX) {
		state.runs.shift();
	}
	persist();
	return row;
}

/** 최근 런부터(최신이 앞) — 도감 기록 탭이 그대로 그린다 */
export function recentRuns(): RunRecord[] {
	return [...load().runs].reverse();
}

export function runCount(): number {
	return load().runs.length;
}

export interface RunStats {
	total: number;
	deaths: number;
	clears: number;
	/** 사망한 런의 평균 라운드 (사망이 없으면 null) */
	avgDeathRound: number | null;
	/** 도달한 최고 라운드 */
	bestRound: number;
	/** 키퍼 id → 최고 라운드 */
	bestByKeeper: Array<{ keeper: string; round: number; runs: number }>;
	/** 원소 id → 누적 자루 수 (많은 순) */
	topElements: Array<{ element: string; count: number }>;
	/** 아키타입 id → 누적 자루 수 (많은 순) */
	topArchetypes: Array<{ archetype: string; count: number }>;
	/** 평균 런 길이(ms) */
	avgDurationMs: number;
}

export function runStats(): RunStats {
	const runs = load().runs;
	const deaths = runs.filter((row) => !row.won);
	const byKeeper = new Map<string, { round: number; runs: number }>();
	const elements = new Map<string, number>();
	const archetypes = new Map<string, number>();
	let bestRound = 0;
	let totalDuration = 0;

	for (const row of runs) {
		bestRound = Math.max(bestRound, row.round);
		totalDuration += row.durationMs;
		const seat = byKeeper.get(row.keeper) ?? { round: 0, runs: 0 };
		seat.round = Math.max(seat.round, row.round);
		seat.runs += 1;
		byKeeper.set(row.keeper, seat);
		for (const [id, n] of Object.entries(row.swords.elements)) {
			elements.set(id, (elements.get(id) ?? 0) + n);
		}
		for (const [id, n] of Object.entries(row.swords.archetypes)) {
			archetypes.set(id, (archetypes.get(id) ?? 0) + n);
		}
	}

	return {
		total: runs.length,
		deaths: deaths.length,
		clears: runs.length - deaths.length,
		avgDeathRound: deaths.length > 0
			? deaths.reduce((sum, row) => sum + row.round, 0) / deaths.length
			: null,
		bestRound,
		bestByKeeper: [...byKeeper.entries()]
			.map(([keeper, seat]) => ({ keeper, round: seat.round, runs: seat.runs }))
			.sort((a, b) => b.round - a.round),
		topElements: [...elements.entries()]
			.map(([element, count]) => ({ element, count }))
			.sort((a, b) => b.count - a.count),
		topArchetypes: [...archetypes.entries()]
			.map(([archetype, count]) => ({ archetype, count }))
			.sort((a, b) => b.count - a.count),
		avgDurationMs: runs.length > 0 ? totalDuration / runs.length : 0,
	};
}

/** 테스트·디버그용 초기화 */
export function resetRunLog(): void {
	cached = { version: 1, runs: [] };
	try {
		localStorage.removeItem(KEY);
	} catch {
		// 무시
	}
}

/** 테스트용: 저장된 원본을 다시 읽는다 (외부에서 localStorage 를 건드린 경우) */
export function reloadRunLog(): void {
	cached = null;
	load();
}
