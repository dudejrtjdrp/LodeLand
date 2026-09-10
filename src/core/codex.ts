// 검 도감 획득 이력 영속 (localStorage) — 2026-09-01
//
// "한 번이라도 손에 넣은 검"만 도감에서 컬러로 열람할 수 있다. 조합 레시피
// 발견(MetaProgression.discoveredRecipes)과 축이 다르다 — 저쪽은 "조합식을
// 알아냈다", 이쪽은 "실물을 가져 봤다".
//
// 기록 시점은 검 획득 이벤트뿐이다 (loadout.addSword / SwordOrbitSystem.addToReserve).
// 전투 핫패스에서는 절대 호출되지 않으며, 이미 기록된 id 면 Set 조회 한 번으로 끝난다.

const KEY = 'movesword-codex-v1';
/** NEW 배지 대기열 상한 — 한 런에서 수십 자루를 모아도 배열이 무한히 자라지 않게 */
const FRESH_MAX = 60;

interface CodexState {
	/** 획득한 적 있는 검 id */
	seen: string[];
	/** 아직 도감에서 확인하지 않은 신규 획득 id (NEW 배지) */
	fresh: string[];
}

const DEFAULTS: CodexState = { seen: [], fresh: [] };

let cached: CodexState | null = null;
let seenSet: Set<string> | null = null;
let freshSet: Set<string> | null = null;

function load(): CodexState {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<CodexState>) : {};
		cached = {
			seen: Array.isArray(parsed.seen) ? parsed.seen.filter((id) => typeof id === 'string') : [],
			fresh: Array.isArray(parsed.fresh) ? parsed.fresh.filter((id) => typeof id === 'string') : [],
		};
	} catch {
		cached = { seen: [...DEFAULTS.seen], fresh: [...DEFAULTS.fresh] };
	}
	seenSet = new Set(cached.seen);
	freshSet = new Set(cached.fresh);
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
 * 검 하나를 "획득한 적 있음"으로 기록한다.
 * @returns 이번 호출로 새로 기록됐으면 true (도감 신규 — 토스트/도전과제 판정용)
 */
export function recordSwordSeen(id: string | null | undefined): boolean {
	if (!id) {
		return false;
	}
	const state = load();
	if (seenSet!.has(id)) {
		return false;
	}
	seenSet!.add(id);
	state.seen.push(id);
	if (!freshSet!.has(id)) {
		freshSet!.add(id);
		state.fresh.push(id);
		while (state.fresh.length > FRESH_MAX) {
			const dropped = state.fresh.shift();
			if (dropped) {
				freshSet!.delete(dropped);
			}
		}
	}
	persist();
	return true;
}

export function isSwordSeen(id: string): boolean {
	load();
	return seenSet!.has(id);
}

/** 획득한 검 id 집합 (읽기 전용으로 쓸 것 — 도감 화면이 한 번만 조회한다) */
export function seenSwordIds(): ReadonlySet<string> {
	load();
	return seenSet!;
}

export function seenCount(): number {
	return load().seen.length;
}

/** 아직 확인하지 않은 신규 획득인가 (도감 셀의 NEW 배지) */
export function isFreshSword(id: string): boolean {
	load();
	return freshSet!.has(id);
}

export function freshCount(): number {
	return load().fresh.length;
}

/** 도감 화면을 닫을 때: NEW 배지 대기열을 비운다 */
export function clearFreshSwords(): void {
	const state = load();
	if (state.fresh.length === 0) {
		return;
	}
	state.fresh = [];
	freshSet!.clear();
	persist();
}

/** 테스트·디버그용 초기화 */
export function resetCodex(): void {
	cached = { seen: [], fresh: [] };
	seenSet = new Set();
	freshSet = new Set();
	try {
		localStorage.removeItem(KEY);
	} catch {
		// 무시
	}
}

/** 테스트용: 저장된 원본 상태를 다시 읽는다 (외부에서 localStorage 를 건드린 경우) */
export function reloadCodex(): void {
	cached = null;
	seenSet = null;
	freshSet = null;
	load();
}
