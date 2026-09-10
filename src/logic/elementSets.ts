// 원소 세트 (元素 세트) — 같은 원소를 몇 자루 장착했는가에 따라 2~7단계 보상이 순차 개방된다.
// 순수 데이터 + 집계만 담당한다 (Phaser import 금지). 런타임 소비는 systems/ElementSetSystem.ts.
//
// 규칙
//  - 단계는 누적이다. 4단계면 2·3·4단계 효과가 전부 적용된다.
//  - 여러 원소가 동시에 단계를 가질 수 있다 (피 3 + 황금 4 → 둘 다 활성).
//  - 4/6/7 단계는 스킬을, 2/3/5 단계는 스탯(또는 5단계 플래그)을 준다.
//  - **모든 원소는 자기 스페셜을 피해로 환산하는 항을 하나씩 갖는다** (2026-09-01).
//    slow(얼음)·leech(피)·midas(황금)은 검 스페셜 자체가 피해 0이라, 세트가
//    그 유틸을 피해로 바꿔 준다 — 얼음 3세트 `slowedDamageMult`(감속 취약),
//    피 5세트 `blood.sanguineBurst`(흡혈량 폭발), 황금 5세트 `gold.coinstrike`(금화 벼락).
//    이 항들이 없으면 유틸 원소를 카탈로그 스탯 배율로 덮어야 하고, 그러면
//    "제어형 원소가 그냥 숫자가 큰 원소"가 되어 버린다.
//  - 기존 공명(2자루 = 원소 효과 1.5배)과 필살기(2자루 + 전부 Lv3↑)는 그대로 병행된다.

export type SetElement = 'fire' | 'electric' | 'ice' | 'poison' | 'gold' | 'blood' | 'wind' | 'void';

export const SET_ELEMENTS: readonly SetElement[] = [
	'fire', 'electric', 'ice', 'poison', 'gold', 'blood', 'wind', 'void',
];

/** 세트가 주는 수치 보정. 곱연산(Mult)은 1이 기본, 가산(Add)은 0이 기본. */
export interface SetStatMods {
	// ── 검 / 궤도
	dmgMult: number;
	cdMult: number;          // 낮을수록 좋다
	orbitSpeedMult: number;
	launchMult: number;
	pen: number;             // 저항 관통 가산
	chainDamageMult: number;
	chainTargets: number;
	// ── 플레이어
	critChance: number;
	critDamage: number;
	maxHpMult: number;
	moveSpeedMult: number;
	defense: number;
	dodge: number;
	damageReduction: number;
	lifesteal: number;
	goldBonus: number;
	luck: number;
	magnetMult: number;
	// ── 원소 효과 스케일 (applySpecial 이 소비)
	dotMult: number;
	dotDurationMult: number;
	slowBonus: number;       // 감속량 배수 가산 (0.5 = 감속 +50%)
	goldDropChance: number;
	/**
	 * 감속(빙결 포함) 상태인 적에게 주는 피해 배율 (1 = 기본).
	 * 얼음 3세트가 여는 항 — slow/leech/midas 처럼 "피해 0" 인 유틸 스페셜을
	 * 스탯 일괄 배율로 덮지 않고, 그 원소의 제어 자체를 피해로 바꾸기 위한 것이다.
	 * 소비: EnemyManager.applyDamage → ElementSetSystem.vulnerabilityFor.
	 */
	slowedDamageMult: number;
}

export function emptyMods(): SetStatMods {
	return {
		dmgMult: 1, cdMult: 1, orbitSpeedMult: 1, launchMult: 1, pen: 0,
		chainDamageMult: 1, chainTargets: 0,
		critChance: 0, critDamage: 0, maxHpMult: 1, moveSpeedMult: 1,
		defense: 0, dodge: 0, damageReduction: 0, lifesteal: 0, goldBonus: 0,
		luck: 0, magnetMult: 1,
		dotMult: 1, dotDurationMult: 1, slowBonus: 0, goldDropChance: 0,
		slowedDamageMult: 1,
	};
}

const MULT_KEYS = [
	'dmgMult', 'cdMult', 'orbitSpeedMult', 'launchMult', 'chainDamageMult',
	'maxHpMult', 'moveSpeedMult', 'magnetMult', 'dotMult', 'dotDurationMult',
	'slowedDamageMult',
] as const;

export interface SetTier {
	/** 필요한 장착 자루 수 (2~7) */
	count: number;
	/** 한 줄 설명 (UI 노출) */
	desc: string;
	stats?: Partial<SetStatMods>;
	/** 이 단계에서 켜지는 스킬 (4/6/7) 또는 강화 플래그 (5) */
	skill?: { id: string; name: string; desc: string };
	/** 스킬 없이 켜지는 부가 플래그 (5단계 강화 등) */
	flags?: string[];
}

export interface ElementSetSpec {
	label: string;
	color: number;
	css: string;
	/** 세트의 성격 한 줄 */
	theme: string;
	tiers: SetTier[];
}

// ---------------------------------------------------------------------------
// 8원소 × 6단계
// ---------------------------------------------------------------------------

export const ELEMENT_SETS: Record<SetElement, ElementSetSpec> = {
	fire: {
		label: '불', color: 0xd9702e, css: '#d9702e', theme: '화력과 광역 — 불은 번지고, 번진 불은 다시 번진다',
		tiers: [
			{ count: 2, desc: '화상 피해 +30%', stats: { dotMult: 1.3 } },
			{ count: 3, desc: '검 피해 +12%', stats: { dmgMult: 1.12 } },
			{
				count: 4, desc: '화상 걸린 적 처치 시 폭발하며 화상을 옮긴다',
				skill: { id: 'fire.scorch', name: '작열', desc: '화상 적 처치 시 반경 90 폭발 + 주변에 화상 전이' },
			},
			{ count: 5, desc: '화상 피해 +50%, 지속 시간 +50%', stats: { dotMult: 1.5, dotDurationMult: 1.5 } },
			{
				count: 6, desc: '몸에서 불길이 흘러 발밑을 태운다',
				skill: { id: 'fire.ring', name: '화염 고리', desc: '주변 100 범위 상시 화상 장판' },
			},
			{
				count: 7, desc: '불바다 — 화상 적 5기 이상이면 모든 화상이 두 배로 탄다',
				skill: { id: 'fire.conflagration', name: '대화재', desc: '화상 적 5기↑ 시 화상 피해 2배 + 3초마다 전역 화염 폭발' },
			},
		],
	},
	electric: {
		label: '번개', color: 0x63b3d9, css: '#63b3d9', theme: '연쇄와 속도 — 한 번 튀면 멈추지 않는다',
		tiers: [
			{ count: 2, desc: '연쇄 피해 +30%', stats: { chainDamageMult: 1.3 } },
			{ count: 3, desc: '검 쿨다운 -12%', stats: { cdMult: 0.88 } },
			{
				count: 4, desc: '타격이 적을 감전시킨다',
				skill: { id: 'electric.shock', name: '감전', desc: '20% 확률 감전 — 받는 피해 +15%, 0.4초 정지' },
			},
			{ count: 5, desc: '연쇄 대상 +1, 궤도 회전 +15%', stats: { chainTargets: 1, orbitSpeedMult: 1.15 } },
			{
				count: 6, desc: '몸이 방전되며 주기적으로 벼락을 흩뿌린다',
				skill: { id: 'electric.staticField', name: '정전기장', desc: '3초마다 주변 260 범위 적 전원에게 연쇄 낙뢰' },
			},
			{
				count: 7, desc: '폭풍 — 감전은 죽음으로도 멈추지 않는다',
				skill: { id: 'electric.tempest', name: '폭풍', desc: '감전 적 사망 시 주변 3기 전파 · 감전 피해증가 +30%' },
			},
		],
	},
	ice: {
		label: '얼음', color: 0x8fc3d8, css: '#8fc3d8', theme: '제어와 생존 — 멈춘 것은 부서진다',
		tiers: [
			{ count: 2, desc: '감속 효과 +50%', stats: { slowBonus: 0.5 } },
			{
				count: 3, desc: '방어 +10, 받는 피해 -5%, 감속된 적에게 주는 피해 +24%',
				stats: { defense: 10, damageReduction: 0.05, slowedDamageMult: 1.24 },
			},
			{
				count: 4, desc: '감속이 쌓이면 적이 얼어붙는다',
				skill: { id: 'ice.freeze', name: '빙결', desc: '감속 3중첩 시 1.2초 완전 정지 + 받는 피해 +25%' },
			},
			{ count: 5, desc: '빙결된 적을 때리면 얼음 파편이 터진다', flags: ['ice.shatter'] },
			{
				count: 6, desc: '피격 시 서리가 반격한다',
				skill: { id: 'ice.frostArmor', name: '서리 갑옷', desc: '피격 시 주변 180 감속 + 반사 피해' },
			},
			{
				count: 7, desc: '영구동토 — 이 땅의 모든 것이 느려진다',
				skill: { id: 'ice.permafrost', name: '영구동토', desc: '화면 내 모든 적 상시 20% 감속 · 빙결 적 처치 시 냉기 폭발' },
			},
		],
	},
	poison: {
		label: '독', color: 0x84b04a, css: '#84b04a', theme: '중첩과 잠식 — 시간이 곧 피해다',
		tiers: [
			{ count: 2, desc: '중독 피해 +40%', stats: { dotMult: 1.4 } },
			{ count: 3, desc: '관통 +10%', stats: { pen: 0.10 } },
			{
				count: 4, desc: '중독된 적이 죽으면 독이 퍼진다',
				skill: { id: 'poison.contagion', name: '전염', desc: '중독 적 사망 시 반경 130 중독 전파' },
			},
			{ count: 5, desc: '중독이 5중첩까지 쌓인다 (중첩당 피해 가산)', flags: ['poison.stack5'] },
			{
				count: 6, desc: '독이 갑주를 녹인다',
				skill: { id: 'poison.corrode', name: '부식', desc: '중독 적 방어 -25% · 받는 모든 피해 +10%' },
			},
			{
				count: 7, desc: '역병 — 최대 중첩은 생명을 직접 갉아먹는다',
				skill: { id: 'poison.plague', name: '역병', desc: '최대 중첩 적에게 초당 최대체력 1.5% 추가 피해' },
			},
		],
	},
	gold: {
		label: '황금', color: 0xd9a83c, css: '#d9a83c', theme: '재화와 행운 — 부유할수록 강하다',
		tiers: [
			{ count: 2, desc: '골드 획득 +25%', stats: { goldBonus: 0.25 } },
			{ count: 3, desc: '행운 +0.15, 치명타 확률 +5%', stats: { luck: 0.15, critChance: 0.05 } },
			{
				count: 4, desc: '모은 재화가 그대로 칼끝에 실린다',
				skill: { id: 'gold.greed', name: '탐욕의 대가', desc: '런 중 획득 골드 100당 검 피해 +1% (최대 +30%)' },
			},
			{
				count: 5, desc: '처치 시 금화 추가 드랍 8%, 획득 범위 +30% · 주운 금화가 벼락처럼 떨어진다',
				stats: { goldDropChance: 0.08, magnetMult: 1.3 }, flags: ['gold.coinstrike'],
			},
			{
				count: 6, desc: '주기적으로 금빛이 손끝에 맺힌다',
				skill: { id: 'gold.blessing', name: '금빛 축복', desc: '15초마다 다음 타격 확정 치명타 + 금화 5개 폭발' },
			},
			{
				count: 7, desc: '손이 닿은 것은 금이 된다',
				skill: { id: 'gold.midas', name: '미다스의 손', desc: '타격 3% 확률로 적을 금상으로 — 즉사(보스 제외) + 골드 대량' },
			},
		],
	},
	blood: {
		label: '피', color: 0xc9455a, css: '#c9455a', theme: '흡혈과 광폭 — 상처가 깊을수록 사납다',
		tiers: [
			{ count: 2, desc: '흡혈 +1%', stats: { lifesteal: 0.01 } },
			{ count: 3, desc: '최대 체력 +12%', stats: { maxHpMult: 1.12 } },
			{
				count: 4, desc: '벤 자리가 아물지 않는다',
				skill: { id: 'blood.bleed', name: '출혈', desc: '타격 시 출혈 — 적이 움직이는 동안 지속 피해' },
			},
			{
				count: 5, desc: '흡혈 +1.5%, 체력 50% 이하일 때 피해 +20% · 빨아들인 피가 끓어 터진다',
				stats: { lifesteal: 0.015 }, flags: ['blood.lowHpRage', 'blood.sanguineBurst'],
			},
			{
				count: 6, desc: '피를 마시면 손이 빨라진다',
				skill: { id: 'blood.thirst', name: '피의 갈증', desc: '처치 시 회복 + 2초간 궤도·쿨다운 가속 (3중첩)' },
			},
			{
				count: 7, desc: '혈계 — 잃은 피가 곧 힘이다. 대신 상처는 아물지 않는다',
				skill: { id: 'blood.bloodline', name: '혈계', desc: '잃은 체력 1%당 피해 +0.8% · 회복량 -30%' },
			},
		],
	},
	wind: {
		label: '바람', color: 0x9fd8c0, css: '#9fd8c0', theme: '기동과 속도 — 잡히지 않는 것은 죽지 않는다',
		tiers: [
			{ count: 2, desc: '이동 속도 +8%', stats: { moveSpeedMult: 1.08 } },
			{ count: 3, desc: '궤도 회전 +20%, 회피 +5%', stats: { orbitSpeedMult: 1.20, dodge: 0.05 } },
			{
				count: 4, desc: '지나간 자리에 칼바람이 남는다',
				skill: { id: 'wind.slipstream', name: '칼바람', desc: '이동 궤적에 바람 자국 — 밟은 적 피해 + 밀려남' },
			},
			{ count: 5, desc: '출격 속도 +25%, 귀환 시간 -30%', stats: { launchMult: 1.25 }, flags: ['wind.fastReturn'] },
			{
				count: 6, desc: '맞지 않으면 계속 빨라진다',
				skill: { id: 'wind.gale', name: '질풍', desc: '3초 무피격 시 이속 +25% · 검 피해 +20% (피격 시 해제)' },
			},
			{
				count: 7, desc: '폭풍의 눈 — 그대를 중심으로 바람이 선다',
				skill: { id: 'wind.eyeOfStorm', name: '폭풍의 눈', desc: '상시 회오리 — 적 밀어냄 + 지속 피해 · 투사체 25% 무효' },
			},
		],
	},
	void: {
		label: '공허', color: 0x8d7bb5, css: '#8d7bb5', theme: '관통과 처형 — 없는 것은 막을 수 없다',
		tiers: [
			{ count: 2, desc: '관통 +15%', stats: { pen: 0.15 } },
			{ count: 3, desc: '치명타 피해 +20%', stats: { critDamage: 0.20 } },
			{
				count: 4, desc: '공간이 찢어진다',
				skill: { id: 'void.rift', name: '균열', desc: '타격 12% 확률로 균열 — 0.8초 뒤 끌어당김 + 광역 피해' },
			},
			{ count: 5, desc: '치명타는 저항을 완전히 무시한다', flags: ['void.critPierce'] },
			{
				count: 6, desc: '빈사의 적은 존재를 지운다',
				skill: { id: 'void.annihilate', name: '소멸', desc: '체력 12% 이하 적 즉시 처형(보스 제외) · 처형 시 균열 생성' },
			},
			{
				count: 7, desc: '특이점 — 세계에 구멍이 뚫린다',
				skill: { id: 'void.singularity', name: '특이점', desc: '15초마다 대형 블랙홀 · 처형 임계 20%로 상승' },
			},
		],
	},
};

// ---------------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------------

/** 원소별 장착 자루 수 → 원소별 세트 단계 (2 미만은 제외). */
export function computeSetTiers(counts: Record<string, number>): Partial<Record<SetElement, number>> {
	const tiers: Partial<Record<SetElement, number>> = {};
	for (const element of SET_ELEMENTS) {
		const count = counts[element] ?? 0;
		if (count >= 2) {
			tiers[element] = Math.min(7, count);
		}
	}
	return tiers;
}

export interface AggregatedSets {
	mods: SetStatMods;
	/** 활성 스킬 id 집합 (4/6/7단계 스킬 + 5단계 플래그) */
	skills: Set<string>;
	/** 원소별 단계 */
	tiers: Partial<Record<SetElement, number>>;
}

/** 활성 단계들을 하나의 보정치로 합친다. 곱은 곱으로, 가산은 가산으로. */
export function aggregateSets(tiers: Partial<Record<SetElement, number>>): AggregatedSets {
	const mods = emptyMods();
	const skills = new Set<string>();

	for (const element of SET_ELEMENTS) {
		const tier = tiers[element] ?? 0;
		if (tier < 2) {
			continue;
		}
		for (const spec of ELEMENT_SETS[element].tiers) {
			if (spec.count > tier) {
				break;
			}
			if (spec.skill) {
				skills.add(spec.skill.id);
			}
			for (const flag of spec.flags ?? []) {
				skills.add(flag);
			}
			const stats = spec.stats;
			if (!stats) {
				continue;
			}
			for (const key of Object.keys(stats) as Array<keyof SetStatMods>) {
				const value = stats[key];
				if (value === undefined) {
					continue;
				}
				if ((MULT_KEYS as readonly string[]).includes(key)) {
					mods[key] *= value;
				} else {
					mods[key] += value;
				}
			}
		}
	}

	return { mods, skills, tiers };
}

/** 해당 원소의 다음 단계까지 남은 자루 수 (이미 7이면 0). */
export function nextTierGap(count: number): number {
	if (count >= 7) {
		return 0;
	}
	return Math.max(1, (count < 2 ? 2 : count + 1) - count);
}

/** UI용: 원소의 특정 단계 설명. */
export function tierDescription(element: SetElement, count: number): SetTier | undefined {
	return ELEMENT_SETS[element].tiers.find((tier) => tier.count === count);
}
