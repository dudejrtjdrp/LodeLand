// 누적 통계 (localStorage 영속) — 2026-09-01 도전과제용.
//
// 설계 원칙: **쓰기를 핫패스에서 하지 않는다.**
// bumpStat 은 메모리 카운터만 올리고 dirty 플래그를 세운다. 실제 localStorage
// 쓰기는 flushStats() 를 부르는 경계(라운드 클리어 · 마을 진입 · 결과 화면 ·
// 페이지 이탈)에서만 일어난다. 처치 20~50/s 구간에서도 비용은 덧셈 하나다.

const KEY = 'movesword-stats-v1';

export interface LifetimeStats {
	/** 누적 처치 수 */
	kills: number;
	/** 누적 보스 처치 수 */
	bossKills: number;
	/** 시작한 런 수 */
	runs: number;
	/** 최고 도달 라운드 */
	bestRound: number;
	/** 누적 조합(REFORGE) 성공 횟수 */
	reforges: number;
	/** 어픽스 3개 이상 붙은 적을 처치한 횟수 */
	affixTriple: number;
	/** 같은 원소 7자루 세트를 완성한 횟수 */
	elementSet7: number;
	/** 보스를 피격 없이 처치한 횟수 */
	bossFlawless: number;
	/** 검을 최고 단계까지 올린 횟수 */
	swordMaxLevel: number;
}

export type StatKey = keyof LifetimeStats;

const DEFAULTS: LifetimeStats = {
	kills: 0,
	bossKills: 0,
	runs: 0,
	bestRound: 0,
	reforges: 0,
	affixTriple: 0,
	elementSet7: 0,
	bossFlawless: 0,
	swordMaxLevel: 0,
};

let cached: LifetimeStats | null = null;
let dirty = false;

function load(): LifetimeStats {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<LifetimeStats>) : {};
		cached = { ...DEFAULTS };
		for (const key of Object.keys(DEFAULTS) as StatKey[]) {
			const value = parsed[key];
			if (typeof value === 'number' && Number.isFinite(value)) {
				cached[key] = value;
			}
		}
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}

/** 누적 통계 스냅샷 (읽기 전용 — 도감/도전과제 화면이 쓴다) */
export function getStats(): LifetimeStats {
	return { ...load() };
}

export function statValue(key: StatKey): number {
	return load()[key];
}

/** 카운터 증가 — 메모리만 건드린다 (flushStats 전까지 저장하지 않음) */
export function bumpStat(key: StatKey, amount = 1): number {
	const state = load();
	state[key] += amount;
	dirty = true;
	return state[key];
}

/** 최고 기록 갱신 (bestRound 등) */
export function raiseStat(key: StatKey, value: number): number {
	const state = load();
	if (value > state[key]) {
		state[key] = value;
		dirty = true;
	}
	return state[key];
}

/** 변경분을 localStorage 에 반영 (경계에서만 호출) */
export function flushStats(force = false): void {
	if (!dirty && !force) {
		return;
	}
	dirty = false;
	try {
		localStorage.setItem(KEY, JSON.stringify(load()));
	} catch {
		// 저장 불가 환경에서는 세션 메모리만 유지
	}
}

export function hasPendingStats(): boolean {
	return dirty;
}

/** 테스트·디버그용 초기화 */
export function resetStats(): void {
	cached = { ...DEFAULTS };
	dirty = false;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// 무시
	}
}

/** 테스트용: 저장된 원본 상태를 다시 읽는다 */
export function reloadStats(): void {
	cached = null;
	dirty = false;
	load();
}
