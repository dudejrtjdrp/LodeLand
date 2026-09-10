// 온보딩 상태 영속 (localStorage) — 2026-09-01
//
// 첫 런 튜토리얼은 기본적으로 딱 한 번만 뜬다. 설정(타이틀) 또는 일시정지
// 메뉴의 "튜토리얼 다시 보기"가 replay 플래그를 세우면 다음 런에서 한 번 더 뜬다.
//
// 설정(core/settings.ts)과 키를 분리한 이유: 설정은 사용자가 조정하는 값이고
// 이쪽은 진행 상태라 초기화 시점·수명이 다르다.

const KEY = 'movesword-onboarding-v1';

interface OnboardingState {
	/** 튜토리얼을 끝까지(또는 건너뛰기로) 본 적이 있다 */
	tutorialDone: boolean;
	/** 다음 런에서 튜토리얼을 한 번 더 띄운다 */
	replay: boolean;
}

const DEFAULTS: OnboardingState = { tutorialDone: false, replay: false };

let cached: OnboardingState | null = null;

function load(): OnboardingState {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<OnboardingState>) : {};
		cached = { ...DEFAULTS, ...parsed };
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}

function save(patch: Partial<OnboardingState>): OnboardingState {
	const next = { ...load(), ...patch };
	cached = next;
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// 저장 불가 환경(시크릿 모드 등)에서는 세션 메모리만 유지
	}
	return next;
}

export function isTutorialDone(): boolean {
	return load().tutorialDone;
}

export function markTutorialDone(): void {
	save({ tutorialDone: true, replay: false });
}

/** 설정/일시정지의 "튜토리얼 다시 보기" — 다음 런에서 1회 재생 */
export function requestTutorialReplay(): void {
	save({ replay: true });
}

export function isReplayRequested(): boolean {
	return load().replay;
}

/**
 * 이번 런에서 튜토리얼을 띄울지 판정하고, 재생 요청이었다면 소모한다.
 * (첫 런이면 true, 재생 요청이 있어도 true)
 */
export function consumeTutorialRequest(): boolean {
	const state = load();
	if (state.replay) {
		save({ replay: false });
		return true;
	}
	return !state.tutorialDone;
}

/** 테스트·디버그용 초기화 */
export function resetOnboarding(): void {
	cached = { ...DEFAULTS };
	try {
		localStorage.removeItem(KEY);
	} catch {
		// 무시
	}
}
