// 스킬 핫키 (2026-09-04) — 이동은 화살표만, 나머지 키는 전부 스킬에 배정할 수 있다.
//
// 기본 능동 4종(활공 Q · 귀소 SPACE · 대시 SHIFT · 필살기 R)은 core/keybinds 의 ActionSpec 이
// 단일 출처다 (설정 창 '조작' 갈래와 공유). 트리에서 배운 능동 스킬은 여기(localStorage)에
// skillId → 키 이름으로 저장한다. 두 저장소를 합쳐 "키 하나 = 스킬 하나"를 보장한다.
//
// 새 스킬을 배우면 빈 키 풀에서 자동 배정 → 스킬 창에서 언제든 바꿀 수 있다.

import { ACTION_IDS, RESERVED_KEYS, getBinding, keyCodeOf, setBinding, type ActionId } from './keybinds';

const KEY = 'movesword-skill-hotbar-v1';

/** 기본 능동 스킬 id ↔ keybinds 동작 id (같다) */
export const BUILTIN_SKILL_IDS = ['dive', 'recall', 'dash', 'ult'] as const;
export type BuiltinSkillId = (typeof BUILTIN_SKILL_IDS)[number];

export function isBuiltinSkill(id: string): id is BuiltinSkillId {
	return (BUILTIN_SKILL_IDS as readonly string[]).includes(id);
}

/** 자동 배정 후보 키 (순서대로 빈 키를 고른다). 이동(화살표)·E(상호작용)·TAB·K·ESC·1~4 는 뺀다. */
export const AUTO_KEY_POOL = ['W', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B', 'H', 'Y', 'N', 'J', 'L', 'CTRL', 'ALT'];

/**
 * 동시에 **등록**할 수 있는 트리 능동 스킬 수 (2026-09-06, 사용자 요청).
 *
 * 배우는 것에는 제한이 없다 — 21종을 다 배워도 된다. 다만 키에 올려 실제로 쓰는 것은
 * 이 수까지고, 넘기려면 기존 것을 먼저 해제해야 한다. 그래야 "무엇을 들고 갈 것인가"가
 * 선택이 되고, 남는 포인트는 패시브로 흘러간다.
 * 기본 능동 4종(활공·귀소·대시·필살기)은 이 한도에 포함되지 않는다 (keybinds 소관).
 */
export const MAX_REGISTERED_SKILLS = 10;

type Hotbar = Record<string, string>;

let cached: Hotbar | null = null;
const listeners = new Set<() => void>();

/**
 * 상한을 넘겨 저장된 핫바를 잘라낸다.
 *
 * 상한 도입 이전에 저장된 localStorage 에는 11개 이상이 들어 있을 수 있고, 그대로 두면
 * 상한이 무의미해진다. 잘라내는 순서는 **스킬 id 사전순으로 고정**한다 — 그래야 불러올
 * 때마다 살아남는 스킬이 달라지지 않는다.
 */
function sanitize(bar: Hotbar): Hotbar {
	const ids = Object.keys(bar).sort();
	if (ids.length <= MAX_REGISTERED_SKILLS) {
		return bar;
	}
	const out: Hotbar = {};
	for (const id of ids.slice(0, MAX_REGISTERED_SKILLS)) {
		out[id] = bar[id];
	}
	return out;
}

function load(): Hotbar {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		cached = sanitize(raw ? (JSON.parse(raw) as Hotbar) : {});
	} catch {
		cached = {};
	}
	return cached;
}

/** 지금 키에 올라가 있는 트리 스킬 수 (기본 4종 제외) */
export function registeredCount(): number {
	return Object.keys(load()).length;
}

/** 이 스킬을 새로 등록할 여유가 있는가 (이미 등록된 스킬이면 항상 true) */
export function canRegister(skillId: string): boolean {
	if (isBuiltinSkill(skillId) || load()[skillId]) {
		return true;
	}
	return registeredCount() < MAX_REGISTERED_SKILLS;
}

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(cached ?? {}));
	} catch {
		// 저장 실패가 게임을 멈추게 하지 않는다
	}
	for (const listener of listeners) {
		listener();
	}
}

export function onHotbarChanged(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** 이 스킬에 배정된 키 이름 (없으면 null) */
export function skillKey(skillId: string): string | null {
	if (isBuiltinSkill(skillId)) {
		return getBinding(skillId as ActionId) || null;
	}
	return load()[skillId] ?? null;
}

export function skillKeyCode(skillId: string): number {
	const name = skillKey(skillId);
	return name ? (keyCodeOf(name) ?? -1) : -1;
}

/** 이 키를 지금 누가 쓰는가 — keybinds 동작 id 또는 트리 스킬 id, 없으면 null */
export function keyOwner(keyName: string): string | null {
	for (const action of ACTION_IDS) {
		if (getBinding(action) === keyName) {
			return action;
		}
	}
	for (const [skillId, key] of Object.entries(load())) {
		if (key === keyName) {
			return skillId;
		}
	}
	return null;
}

export interface HotkeyResult {
	ok: boolean;
	reason?: 'reserved' | 'conflict' | 'unknown' | 'full';
	conflictWith?: string;
	reservedFor?: string;
}

/**
 * 키 배정. 예약키/다른 동작·스킬과 충돌하면 거부한다 (조용히 빼앗지 않는다).
 * 기본 능동 4종은 keybinds.setBinding 으로 위임 — 설정 창과 값이 갈리지 않게.
 */
export function setSkillKey(skillId: string, keyName: string): HotkeyResult {
	if (keyCodeOf(keyName) === null) {
		return { ok: false, reason: 'unknown' };
	}
	if (RESERVED_KEYS[keyName]) {
		return { ok: false, reason: 'reserved', reservedFor: RESERVED_KEYS[keyName] };
	}
	const owner = keyOwner(keyName);
	if (owner && owner !== skillId) {
		return { ok: false, reason: 'conflict', conflictWith: owner };
	}
	if (isBuiltinSkill(skillId)) {
		const result = setBinding(skillId as ActionId, keyName);
		if (result.ok) {
			for (const listener of listeners) {
				listener();
			}
		}
		return result.ok ? { ok: true } : { ok: false, reason: result.reason, conflictWith: result.conflictWith, reservedFor: result.reservedFor };
	}
	const bar = load();
	// 등록 상한 — 이미 등록된 스킬의 키를 바꾸는 것은 언제나 허용한다 (수가 안 늘어난다)
	if (!bar[skillId] && Object.keys(bar).length >= MAX_REGISTERED_SKILLS) {
		return { ok: false, reason: 'full' };
	}
	bar[skillId] = keyName;
	cached = bar;
	persist();
	return { ok: true };
}

/** 트리 스킬의 키를 해제한다 (기본 4종은 해제 불가 — 항상 키가 있어야 한다) */
export function clearSkillKey(skillId: string): void {
	if (isBuiltinSkill(skillId)) {
		return;
	}
	const bar = load();
	if (bar[skillId]) {
		delete bar[skillId];
		cached = bar;
		persist();
	}
}

/**
 * 아직 키가 없는 트리 스킬에 빈 키를 자동 배정한다. 배정된 키 이름 (없으면 null).
 * 등록 상한에 걸리면 배정하지 않는다 — 배우는 것 자체는 성공하고, 플레이어가
 * 스킬 창에서 무엇을 내릴지 고른다.
 */
export function autoAssignKey(skillId: string): string | null {
	const existing = skillKey(skillId);
	if (existing) {
		return existing;
	}
	if (!canRegister(skillId)) {
		return null;
	}
	for (const candidate of AUTO_KEY_POOL) {
		if (!RESERVED_KEYS[candidate] && !keyOwner(candidate)) {
			const result = setSkillKey(skillId, candidate);
			if (result.ok) {
				return candidate;
			}
		}
	}
	return null;
}

/** 테스트용: 캐시를 비운다 */
export function reloadHotbar(): void {
	cached = null;
}
