// 키 리맵 (localStorage 영속) — 2026-09-01 마감 품질 패스
//
// 규칙
//  1. 2026-09-04 조작 개편: **이동은 화살표(← ↑ → ↓)** 가 기본이다. W/A/S/D 등 나머지 문자 키는
//     스킬 트리에서 배운 능동 스킬에 배정하는 핫키 풀이 된다 (core/skillHotbar.ts).
//     구세이브의 이동 키가 W/A/S/D 로 저장돼 있으면 그대로 존중한다 (마이그레이션은 하지 않는다).
//  2. 방향키는 리맵할 수 있지만, 저장값이 없으면 항상 화살표로 돌아온다.
//  3. 시스템 키(ESC 일시정지 · M 음소거 · R/T 일시정지 메뉴 · 1~4 카드)는 예약되어 있어
//     리바인딩 대상으로 고를 수 없다 — 충돌 검사에서 거부한다.
//  4. 값은 Phaser 의 KeyCodes 이름('W' · 'SPACE' · 'SHIFT' · 'NUMPAD_ZERO' …)으로 저장한다.
//     화면 표기는 keyLabel() 이 짧은 한국어/기호로 바꾼다.
//
// 소비처
//   GameScene        — 이동 4방향 · 캐릭터창
//   ActiveSkillSystem— 활공 · 귀소 · 대시 · 필살기(R, 2026-09-04)
//   VillageSystem    — 상호작용
//   ui/controlsPanel — 안내 표기 (리맵을 반영해 동적으로 그린다)
//   ui/keybindPanel  — 설정 창 '조작' 갈래
//   systems/GamepadSystem — 패드 버튼 → 이 바인딩의 키 이벤트로 합성

import Phaser from 'phaser';

const KEY = 'movesword-keybinds-v1';

export type ActionId =
	| 'moveUp' | 'moveLeft' | 'moveDown' | 'moveRight'
	| 'dive' | 'recall' | 'dash' | 'ult'
	| 'interact' | 'stats' | 'skills';

export interface ActionSpec {
	id: ActionId;
	/** 설정 창·안내에 쓰는 한국어 이름 */
	label: string;
	/** 한 줄 설명 */
	desc: string;
	/** 기본 키 (현행 배선과 동일) */
	fallback: string;
	/** 리맵과 무관하게 항상 함께 먹히는 고정 보조키 (표기용) */
	fixedAlt?: string[];
}

export const ACTION_SPECS: ActionSpec[] = [
	{ id: 'moveUp', label: '위로 이동', desc: '무리를 위쪽으로 몬다', fallback: 'UP' },
	{ id: 'moveLeft', label: '왼쪽 이동', desc: '무리를 왼쪽으로 몬다', fallback: 'LEFT' },
	{ id: 'moveDown', label: '아래로 이동', desc: '무리를 아래쪽으로 몬다', fallback: 'DOWN' },
	{ id: 'moveRight', label: '오른쪽 이동', desc: '무리를 오른쪽으로 몬다', fallback: 'RIGHT' },
	{ id: 'dive', label: '활공 사냥', desc: '무리를 바라보는 쪽으로 즉시 출격', fallback: 'Q' },
	{ id: 'recall', label: '귀소', desc: '무리 회수 · 밀어내기 · 0.5초 무적', fallback: 'SPACE' },
	{ id: 'dash', label: '대시', desc: '이동 방향으로 짧게 (무적 없음)', fallback: 'SHIFT' },
	{ id: 'ult', label: '필살기', desc: '게이지가 차면 주 원소 필살기 (보스 시전 끊기)', fallback: 'R' },
	{ id: 'interact', label: '상호작용', desc: '대기마을 시설·게이트', fallback: 'E' },
	{ id: 'stats', label: '캐릭터창', desc: '능력치 · 검 · 세트', fallback: 'TAB' },
	{ id: 'skills', label: '스킬 창', desc: '스킬 트리 · 핫키 배정', fallback: 'K' },
];

export const ACTION_IDS: ActionId[] = ACTION_SPECS.map((spec) => spec.id);

const SPEC_BY_ID = new Map<ActionId, ActionSpec>(ACTION_SPECS.map((spec) => [spec.id, spec]));

/**
 * 리바인딩으로 고를 수 없는 키.
 * 게임 전역에서 고정 의미를 갖거나(ESC·M), 방향키 보조 이동을 지키기 위해서다.
 */
export const RESERVED_KEYS: Record<string, string> = {
	ESC: '일시정지 · 창 닫기',
	M: '음소거',
	T: '타이틀로',
	O: '설정',
	U: '영구 강화',
	D_CODEX: '', // (자리표시 — 실제 예약은 아래 목록에서 처리)
	ONE: '레벨업 카드 1',
	TWO: '레벨업 카드 2',
	THREE: '레벨업 카드 3',
	FOUR: '레벨업 카드 4',
	ENTER: '확정 (게임패드 A)',
};
delete RESERVED_KEYS.D_CODEX;

export type Keybinds = Record<ActionId, string>;

function defaults(): Keybinds {
	const out = {} as Keybinds;
	for (const spec of ACTION_SPECS) {
		out[spec.id] = spec.fallback;
	}
	return out;
}

export const DEFAULT_KEYBINDS: Keybinds = defaults();

let cached: Keybinds | null = null;
const listeners = new Set<() => void>();

/** 저장된 리맵을 읽는다 (없으면 현행 기본값과 완전히 동일). */
export function loadKeybinds(): Keybinds {
	if (cached) {
		return cached;
	}
	const base = defaults();
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<Keybinds>) : {};
		for (const id of ACTION_IDS) {
			const value = parsed[id];
			// 저장값이 더 이상 유효한 키 이름이 아니면 기본값으로 되돌린다
			if (typeof value === 'string' && keyCodeOf(value) !== null) {
				base[id] = value;
			}
		}
	} catch {
		// 저장 불가/파손 — 기본값 유지
	}
	cached = base;
	return cached;
}

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(cached ?? defaults()));
	} catch {
		// 시크릿 모드 등 — 세션 메모리만 유지
	}
	for (const listener of listeners) {
		listener();
	}
}

/** 이 동작에 배정된 키 이름 */
export function getBinding(id: ActionId): string {
	return loadKeybinds()[id] ?? SPEC_BY_ID.get(id)?.fallback ?? '';
}

/** 이 동작의 키 코드 (Phaser KeyCodes 숫자) */
export function getBindingCode(id: ActionId): number {
	return keyCodeOf(getBinding(id)) ?? -1;
}

export interface RebindResult {
	ok: boolean;
	/** 실패 사유 — 'reserved' 시스템 예약키 · 'conflict' 다른 동작이 이미 씀 · 'unknown' 알 수 없는 키 */
	reason?: 'reserved' | 'conflict' | 'unknown';
	/** conflict 일 때 이미 그 키를 쓰는 동작 */
	conflictWith?: ActionId;
	/** reserved 일 때 그 키의 용도 */
	reservedFor?: string;
}

/**
 * 리바인딩 시도. 충돌·예약이면 거부하고 이유를 돌려준다 (덮어쓰기 하지 않는다 —
 * 조용히 다른 동작의 키를 빼앗으면 사용자가 무엇이 바뀌었는지 알 수 없다).
 */
export function setBinding(id: ActionId, keyName: string): RebindResult {
	if (keyCodeOf(keyName) === null) {
		return { ok: false, reason: 'unknown' };
	}
	if (RESERVED_KEYS[keyName]) {
		return { ok: false, reason: 'reserved', reservedFor: RESERVED_KEYS[keyName] };
	}
	const binds = loadKeybinds();
	if (binds[id] === keyName) {
		return { ok: true };
	}
	for (const other of ACTION_IDS) {
		if (other !== id && binds[other] === keyName) {
			return { ok: false, reason: 'conflict', conflictWith: other };
		}
	}
	binds[id] = keyName;
	cached = binds;
	persist();
	return { ok: true };
}

/** 전체를 기본값으로 되돌린다 */
export function resetKeybinds(): void {
	cached = defaults();
	persist();
}

/** 리맵이 바뀔 때 다시 그려야 하는 화면용 구독 */
export function onKeybindsChanged(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** 테스트/디버그용 — 캐시를 버리고 localStorage 에서 다시 읽는다 */
export function reloadKeybinds(): Keybinds {
	cached = null;
	return loadKeybinds();
}

// ---------------------------------------------------------------------------
// 키 이름 ↔ 코드 ↔ 표기
// ---------------------------------------------------------------------------

const KEY_CODES = Phaser.Input.Keyboard.KeyCodes as unknown as Record<string, number>;

/** 이름 → Phaser 키 코드 (알 수 없으면 null) */
export function keyCodeOf(name: string): number | null {
	const code = KEY_CODES[name];
	return typeof code === 'number' ? code : null;
}

let codeToName: Map<number, string> | null = null;

/** Phaser 키 코드 → 이름 (KeyboardEvent.keyCode 로 리바인딩 대기 중일 때 쓴다) */
export function keyNameOf(code: number): string | null {
	if (!codeToName) {
		codeToName = new Map();
		for (const [name, value] of Object.entries(KEY_CODES)) {
			if (typeof value === 'number' && !codeToName.has(value)) {
				codeToName.set(value, name);
			}
		}
	}
	return codeToName.get(code) ?? null;
}

const LABEL_OVERRIDES: Record<string, string> = {
	UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
	ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5',
	SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', ZERO: '0',
	SPACE: 'SPACE', SHIFT: 'SHIFT', CTRL: 'CTRL', ALT: 'ALT',
	TAB: 'TAB', ESC: 'ESC', ENTER: 'ENTER', BACKSPACE: '⌫',
	OPEN_BRACKET: '[', CLOSED_BRACKET: ']', SEMICOLON: ';', QUOTES: "'",
	COMMA: ',', PERIOD: '.', FORWARD_SLASH: '/', BACK_SLASH: '\\',
	MINUS: '-', PLUS: '+',
};

/** 화면 표기용 짧은 라벨 */
export function keyLabel(name: string): string {
	if (LABEL_OVERRIDES[name]) {
		return LABEL_OVERRIDES[name];
	}
	if (name.startsWith('NUMPAD_')) {
		return `넘${name.slice(7).replace('ZERO', '0').replace('ONE', '1')}`;
	}
	return name.replace(/_/g, ' ');
}

/** 이 동작의 표기 라벨 (예: 'SPACE') */
export function actionKeyLabel(id: ActionId): string {
	return keyLabel(getBinding(id));
}

/** 이 동작의 표기 라벨 + 고정 보조키 (예: ['W', '↑']) */
export function actionKeyLabels(id: ActionId): string[] {
	const spec = SPEC_BY_ID.get(id);
	const out = [keyLabel(getBinding(id))];
	for (const alt of spec?.fixedAlt ?? []) {
		const label = keyLabel(alt);
		if (!out.includes(label)) {
			out.push(label);
		}
	}
	return out;
}

export function actionSpec(id: ActionId): ActionSpec | null {
	return SPEC_BY_ID.get(id) ?? null;
}

/** 이 KeyboardEvent 가 해당 동작의 키인가 (Phaser 'keydown' 통합 핸들러용) */
export function matchesAction(event: KeyboardEvent, id: ActionId): boolean {
	return event.keyCode === getBindingCode(id);
}
