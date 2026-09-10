// 검 정보 문자열 공용 모듈 (2026-09-02)
//
// 왜 생겼나 — 검 상세를 그리는 곳이 셋(상점 통합 화면 · 각성 선택 화면 · TAB 캐릭터창)인데
// 각자 문자열을 따로 만들고 있었다. 그래서 "각성했다"는 사실이 상점에는 아예 없고,
// 캐릭터창에는 내부 id('ruin')가 그대로 노출됐다.
//
// 규칙
//  - 순수 함수만 둔다 (Phaser·씬 모름). 표현(색·레이아웃)은 호출자 몫이다.
//  - 각성 정의는 augmentCatalog.json 의 awakening.options 가 유일한 원본이다.

import augmentCatalogJson from '../data/augmentCatalog.json';
import { ELEMENT_LABELS } from '../systems/shop/shopLogic';
import { behaviorOf, behaviorSpec } from './swordBehavior';
import type { SwordDefinition } from '../types/catalogs';

export interface AwakeningInfo {
	id: string;
	name: string;
	icon?: string;
	desc: string;
}

const awakeningRaw = (augmentCatalogJson as unknown as {
	awakening?: { options?: AwakeningInfo[] };
}).awakening;

/** 각성 3종 (파괴/질풍/수호) */
export const AWAKENING_OPTIONS: AwakeningInfo[] = awakeningRaw?.options ?? [];

const AWAKENING_BY_ID = new Map(AWAKENING_OPTIONS.map((option) => [option.id, option]));

/** 각성 id → 정의 (모르는 id 면 null) */
export function awakeningById(id: string | null | undefined): AwakeningInfo | null {
	return id ? AWAKENING_BY_ID.get(id) ?? null : null;
}

/** 이 시스템이 실제로 읽는 SwordOrbitSystem 표면 (순환 import 방지용 최소 형태) */
export interface OrbitInfoLike {
	awakenings?: Record<string, string>;
	hasSetResonance?: (element: string) => boolean;
	getTraitById?: (id: string) => { name?: string; element?: string } | null | undefined;
	getSlotState?: (index: number) => { enhance: number } | null | undefined;
}

/** 이 검(정의 id)에 걸린 각성. 없으면 null */
export function awakeningOf(orbit: OrbitInfoLike | null | undefined, definitionId: string | null | undefined): AwakeningInfo | null {
	if (!orbit || !definitionId) {
		return null;
	}
	return awakeningById(orbit.awakenings?.[definitionId]);
}

/** 목록 아이콘 위에 얹는 소형 각성 배지 글리프 */
export const AWAKENING_BADGE = '★';

/** 상세/툴팁에 넣는 각성 한 줄 — "각성: 파괴 각성 — 이 검의 피해 +85%" */
export function awakeningLine(option: AwakeningInfo): string {
	return `각성: ${option.name} — ${option.desc}`;
}

export interface SwordLineOptions {
	/** 실제 장착/보관 중인 검 인스턴스 (있으면 실측 수치를 쓴다) */
	sword?: {
		damage?: number;
		scanInterval?: number;
		hitsPerLaunch?: number;
		level?: number;
		traits?: string[];
	} | null;
	orbit?: OrbitInfoLike | null;
	/** 장착 자리 (자리 강화 줄을 넣을 때만) */
	slotIndex?: number | null;
	/** 거동 아키타입 줄 포함 (기본 true — 'orbit' 은 생략) */
	includeBehavior?: boolean;
	/** 각인 줄 포함 (기본 true) */
	includeTraits?: boolean;
}

/**
 * 검 상세 본문 줄 목록 (조합식·로어는 호출자가 뒤에 붙인다).
 * 각성한 검이면 반드시 각성 줄이 들어간다 — 표기 누락이 이 모듈의 존재 이유다.
 */
export function describeSwordLines(definition: SwordDefinition, options: SwordLineOptions = {}): string[] {
	const { sword = null, orbit = null, slotIndex = null, includeBehavior = true, includeTraits = true } = options;
	const lines: string[] = [];

	const typeLabel = definition.damageType === 'magic' ? '마법' : '물리';
	const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;
	lines.push(`${typeLabel} 피해 ${sword?.damage ?? definition.damage}${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
	lines.push(`쿨다운 ${Math.round(sword?.scanInterval ?? definition.cooldownMs)}ms · 연속타 ${sword?.hitsPerLaunch ?? definition.maxHits}`);

	if (definition.element) {
		const resonance = orbit?.hasSetResonance?.(definition.element) ?? false;
		lines.push(`속성 ${ELEMENT_LABELS[definition.element] ?? definition.element}${resonance ? ' (공명 중!)' : ''}`);
	}

	if (includeBehavior) {
		const behavior = behaviorOf(definition);
		if (behavior !== 'orbit') {
			const spec = behaviorSpec(behavior);
			lines.push(`거동 ${spec.label} — ${spec.desc}`);
		}
	}

	if (definition.special) {
		lines.push(`고유: ${definition.special.label}`);
	}
	if (definition.trueDamage) {
		lines.push(`고정 피해 +${definition.trueDamage} (저항 무시)`);
	}
	if (definition.maxHpDamage) {
		lines.push(`최대 체력 ${Math.round(definition.maxHpDamage * 100)}% 추가 피해`);
	}

	if (slotIndex !== null && orbit?.getSlotState) {
		const state = orbit.getSlotState(slotIndex);
		if (state) {
			lines.push(`자리 강화 +${state.enhance} (피해 +${Math.round(state.enhance * 4)}%)`);
		}
	}

	if (includeTraits && sword?.traits && sword.traits.length > 0 && orbit?.getTraitById) {
		const names = sword.traits.map((id) => {
			const trait = orbit.getTraitById!(id);
			const synergy = trait?.element && trait.element === definition.element;
			return `${trait?.name ?? id}${synergy ? ' (속성 일치 2배)' : ''}`;
		});
		lines.push(`각인: ${names.join(', ')}`);
	}

	const awakening = awakeningOf(orbit, definition.id);
	if (awakening) {
		lines.push(awakeningLine(awakening));
	}

	return lines;
}
