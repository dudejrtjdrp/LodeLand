// 적 특성(몸체·기질) 카탈로그 — "이 라운드엔 어떤 검을 들고 갈까"의 근거.
//
// 특성 하나가 말하는 것:
//   weakTo   : 이 원소 검의 피해가 증폭된다  (0.45 = +45%)
//   resistTo : 이 원소 검의 피해가 감쇄된다  (0.5  = -50%)
//   immune   : CC 면역 (slow=감속·빙결, knockback=넉백, dot=지속 피해)
//
// 설계 규칙 (콘텐츠 추가 시 유지할 것):
//   - 8원소 전부가 "약점으로 등장 ≥1회, 저항으로 등장 ≥1회" 하도록 유지한다.
//     그래야 어떤 검이든 활약하는 라운드가 돌아온다.
//   - 몸체(원소) 특성은 자기 원소를 저항하고 상극 원소에 약하다.
//   - 유틸 특성은 수치 대신 CC 면역만 가진다.
// 적별 부여는 enemyCatalog.json 의 `traits: []` 필드.

import type { Element, EnemyDefinition } from '../types/catalogs';
import { ELEMENT_THEME } from '../ui/theme';

export type CcKind = 'slow' | 'knockback' | 'dot';

export interface EnemyTrait {
	id: string;
	/** 짧은 한국어 이름 (칩·카드에 표시) */
	name: string;
	/** 글리프 텍스처 키 (ui/theme ensureGlyphs) */
	icon: string;
	/** 대표 색 (칩 테두리·아이콘 틴트) */
	color: string;
	/** 한 줄 설명 (정찰 보고·툴팁) */
	desc: string;
	/** 받는 피해 증가 — 원소: 증가율 (0.45 = +45%) */
	weakTo?: Partial<Record<Element, number>>;
	/** 받는 피해 감소 — 원소: 감소율 (0.5 = -50%) */
	resistTo?: Partial<Record<Element, number>>;
	/** CC 면역 */
	immune?: CcKind[];
}

export const CC_LABELS: Record<CcKind, string> = {
	slow: '감속·빙결',
	knockback: '넉백',
	dot: '지속 피해',
};

const el = (key: Element) => ELEMENT_THEME[key];

// ---------------------------------------------------------------------------
// 카탈로그 — 몸체 8종 (원소 상성 바퀴) + 유틸 3종 (CC 면역)
// ---------------------------------------------------------------------------

export const ENEMY_TRAITS: EnemyTrait[] = [
	{
		id: 'frostborn',
		name: '서리 몸체',
		icon: 'g-el-ice',
		color: el('ice').css,
		desc: '얼어붙은 녹. 불에 잘 녹지만 얼음은 통하지 않고, 느려지지도 않는다.',
		weakTo: { fire: 0.45 },
		resistTo: { ice: 0.5 },
		immune: ['slow'],
	},
	{
		id: 'emberflesh',
		name: '잉걸 몸체',
		icon: 'g-el-fire',
		color: el('fire').css,
		desc: '속이 아직 벌겋게 달아 있다. 얼음에 급랭당하면 쩍 갈라진다.',
		weakTo: { ice: 0.45 },
		resistTo: { fire: 0.5 },
	},
	{
		id: 'soaked',
		name: '젖은 몸체',
		icon: 'g-drop',
		color: el('electric').css,
		desc: '수분을 머금은 오물. 번개가 잘 통하고 불은 잘 붙지 않는다.',
		weakTo: { electric: 0.45 },
		resistTo: { fire: 0.35 },
	},
	{
		id: 'corroded',
		name: '삭은 거죽',
		icon: 'g-rust',
		color: el('poison').css,
		desc: '푸석하게 삭은 녹 껍질. 독이 스며들기 좋고 번개는 겉만 튄다.',
		weakTo: { poison: 0.45 },
		resistTo: { electric: 0.35 },
	},
	{
		id: 'venomous',
		name: '옻독 몸체',
		icon: 'g-el-poison',
		color: el('poison').css,
		desc: '독으로 이루어진 몸. 독은 무의미하고, 불로 태우는 게 제맛이다.',
		weakTo: { fire: 0.4 },
		resistTo: { poison: 0.5 },
	},
	{
		id: 'gilded',
		name: '도금 껍질',
		icon: 'g-el-gold',
		color: el('gold').css,
		desc: '금박을 두른 갑각. 같은 금붙이는 미끄러지고, 공허가 도금을 벗긴다.',
		weakTo: { void: 0.45 },
		resistTo: { gold: 0.5 },
	},
	{
		id: 'hollow',
		name: '텅 빈 심',
		icon: 'g-el-void',
		color: el('void').css,
		desc: '심(心)이 비어 있다. 공허는 스며들 곳이 없고, 황금이 빈속을 채워 태운다.',
		weakTo: { gold: 0.45 },
		resistTo: { void: 0.5 },
	},
	{
		id: 'bloodswollen',
		name: '피주머니',
		icon: 'g-el-blood',
		color: el('blood').css,
		desc: '훔친 심혈로 부풀었다. 바람 칼날에 잘 터지고, 피는 피를 못 뺏는다.',
		weakTo: { wind: 0.45 },
		resistTo: { blood: 0.5 },
	},
	{
		id: 'featherlight',
		name: '깃털 몸체',
		icon: 'g-feather',
		color: el('wind').css,
		desc: '가볍고 바람에 익숙하다. 피의 낫이 스치면 크게 베인다.',
		weakTo: { blood: 0.45 },
		resistTo: { wind: 0.35 },
	},
	// ── 유틸 (CC 면역)
	{
		id: 'unstoppable-core',
		name: '굳은 심지',
		icon: 'g-anvil',
		color: '#c9d2d8',
		desc: '무게 중심이 낮고 단단하다. 밀려나지 않는다.',
		immune: ['knockback'],
	},
	{
		id: 'sealed-veins',
		name: '막힌 핏줄',
		icon: 'g-shield',
		color: '#9aa8b2',
		desc: '화상도 중독도 스미지 않는 폐맥. 지속 피해가 통하지 않는다.',
		immune: ['dot'],
	},
	{
		id: 'nimble',
		name: '미끄러운 몸',
		icon: 'g-boot',
		color: '#9fd8c0',
		desc: '붙잡을 틈이 없다. 감속과 빙결이 통하지 않는다.',
		immune: ['slow'],
	},
];

const TRAIT_BY_ID = new Map(ENEMY_TRAITS.map((trait) => [trait.id, trait]));

export function getTraitById(id: string): EnemyTrait | null {
	return TRAIT_BY_ID.get(id) ?? null;
}

/** 카탈로그 정의(또는 id 목록)의 특성 객체 배열 */
export function traitsOf(definition: Pick<EnemyDefinition, 'traits'> | null | undefined): EnemyTrait[] {
	const ids = definition?.traits ?? [];
	const out: EnemyTrait[] = [];
	for (const id of ids) {
		const trait = TRAIT_BY_ID.get(id);
		if (trait) {
			out.push(trait);
		}
	}
	return out;
}

/**
 * 특성 상성 배율 — 원소 검이 이 적을 때릴 때 곱해지는 값.
 * 약점·저항이 겹치면 곱연산 (예: +45% 약점 × -35% 저항 = ×0.9425).
 * 반환 1 = 상성 없음.
 */
export function traitDamageMult(traits: EnemyTrait[], element: Element | null | undefined): number {
	if (!element || traits.length === 0) {
		return 1;
	}
	let mult = 1;
	for (const trait of traits) {
		const weak = trait.weakTo?.[element];
		if (weak) {
			mult *= 1 + weak;
		}
		const resist = trait.resistTo?.[element];
		if (resist) {
			mult *= Math.max(0.1, 1 - resist);
		}
	}
	return mult;
}

/** 특성 묶음의 CC 면역 여부 */
export function traitsImmuneTo(traits: EnemyTrait[], kind: CcKind): boolean {
	return traits.some((trait) => trait.immune?.includes(kind));
}

/** 약점 원소 목록 (중복 제거, 증가율 큰 순) — 정찰 보고·추천 검 계산용 */
export function weakElements(traits: EnemyTrait[]): Array<{ element: Element; bonus: number }> {
	const acc = new Map<Element, number>();
	for (const trait of traits) {
		for (const [element, bonus] of Object.entries(trait.weakTo ?? {})) {
			acc.set(element as Element, Math.max(acc.get(element as Element) ?? 0, bonus ?? 0));
		}
	}
	return [...acc.entries()]
		.map(([element, bonus]) => ({ element, bonus }))
		.sort((a, b) => b.bonus - a.bonus);
}

/** 저항 원소 목록 (감쇄율 큰 순) */
export function resistElements(traits: EnemyTrait[]): Array<{ element: Element; reduce: number }> {
	const acc = new Map<Element, number>();
	for (const trait of traits) {
		for (const [element, reduce] of Object.entries(trait.resistTo ?? {})) {
			acc.set(element as Element, Math.max(acc.get(element as Element) ?? 0, reduce ?? 0));
		}
	}
	return [...acc.entries()]
		.map(([element, reduce]) => ({ element, reduce }))
		.sort((a, b) => b.reduce - a.reduce);
}

/** 면역 목록 (중복 제거) */
export function immunities(traits: EnemyTrait[]): CcKind[] {
	const out: CcKind[] = [];
	for (const trait of traits) {
		for (const kind of trait.immune ?? []) {
			if (!out.includes(kind)) {
				out.push(kind);
			}
		}
	}
	return out;
}

/**
 * 특성의 "자기 원소" — 맵 테마 매칭용.
 * 몸체 특성은 자신이 저항하는 원소가 곧 자기 혈통이다 (서리 몸체 → ice).
 */
export function traitSelfElement(trait: EnemyTrait): Element | null {
	const keys = Object.keys(trait.resistTo ?? {}) as Element[];
	return keys[0] ?? null;
}
