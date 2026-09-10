// 검 거동 아키타입 (2026-09-01)
//
// 그동안 검은 전부 "스탯만 다른 같은 검"이었다 — 목표에 직선으로 날아가
// 때리고 돌아왔다. 이 파일은 그 STRIKE 자체를 갈라놓는다.
//
//   선회검 (boomerang) — 목표를 지나쳐 넓은 호를 그리며 되돌아온다. 경로 위의 적을
//                        전부 관통 타격하지만 단일 피해는 낮다.
//   말뚝검 (stake)     — 목표 자리에 꽂혀 몇 초간 주변을 지지는 오라가 된다.
//                        꽂혀 있는 동안 그 자리의 궤도는 비어 있다 (트레이드오프).
//   참격검 (lance)     — 목표 방향으로 길게 직선 관통한다. 폭은 좁고 사거리는 길다.
//
// 설계 규칙
//  1. 순수 데이터/함수만 둔다 — Phaser 도, 씬도 모른다. 밸런스 시뮬
//     (scripts/balance-sim/model.ts)이 같은 계수를 import 해서 쓴다.
//  2. `behavior` 필드가 없는 검은 전부 'orbit' — 나머지 153종은 회귀 0.
//     (2026-09-01 2차 확대: 아키타입 3종 × 11자루 = 33자루. scripts/add-archetype-swords.py)
//  3. 세이브에는 들어가지 않는다. 검의 거동은 항상 카탈로그에서 재조회된다.

/** STRIKE 패턴 식별자. 'orbit' 이 기존(기본) 거동이다. */
export type SwordBehavior = 'orbit' | 'boomerang' | 'stake' | 'lance';

export interface BehaviorSpec {
	id: SwordBehavior;
	/** UI 표기 (한국어) */
	label: string;
	/** 한 줄 설명 (툴팁·도감) */
	desc: string;

	// ── 공통 계수 (거동이 주는 이득/손해를 스탯으로 상쇄한다) ──
	/** 타격 1회 피해 배율 */
	damageMult: number;
	/** 재출격 대기시간 배율 */
	cooldownMult: number;
	/** 궤도에서 사냥감을 찾는 반경 배율 */
	scanRadiusMult: number;
	/**
	 * 밸런스 시뮬 근사: 출격 1회가 평균적으로 때리는 대상 수.
	 * (선회·참격은 관통이므로 1보다 크고, 말뚝은 오라를 따로 계산한다)
	 */
	simTargets: number;

	// ── 선회검 ──
	/** 호가 쓸고 가는 각도(rad) */
	sweepRad?: number;
	/** 목표 너머로 더 나가는 거리(px) */
	overshootPx?: number;
	/** 호 반경 하한/상한(px) */
	minReachPx?: number;
	maxReachPx?: number;
	/** 호 한 바퀴에 걸리는 시간(ms) */
	arcMs?: number;

	// ── 말뚝검 ──
	/** 꽂혀 있는 시간(ms) */
	plantMs?: number;
	/** 오라 반경(px) */
	auraRadius?: number;
	/**
	 * 오라 피해 틱 간격(ms) 의 **상한**.
	 * 실제 간격은 그 검의 재출격 대기시간 ÷ auraTickDivisor 로, 아래 하한/상한 사이에서 정해진다.
	 * (이렇게 두지 않으면 말뚝검만 쿨다운 투자를 전혀 돌려받지 못해 후반에 함정이 된다 —
	 *  꽂혀 있는 3초는 라운드가 올라도 줄지 않는데 다른 검의 출격 주기는 계속 짧아지기 때문)
	 */
	auraTickMs?: number;
	/** 오라 틱 간격 = 검 대기시간 ÷ 이 값 */
	auraTickDivisor?: number;
	/** 오라 틱 간격 하한(ms) */
	auraTickMinMs?: number;
	/** 틱당 피해 = 검 피해 × 이 값 */
	auraTickPct?: number;
	/** 오라 1틱이 때리는 대상 수 상한 (핫패스 보호) */
	auraTargetCap?: number;

	// ── 참격검 ──
	/** 직선 관통 사거리(px) */
	rangePx?: number;
	/** 관통 폭(px) — 이 반경 안의 적만 베인다 */
	lanePx?: number;
	/** 출격 속도 배율 */
	speedMult?: number;
}

export const SWORD_BEHAVIORS: Record<SwordBehavior, BehaviorSpec> = {
	orbit: {
		id: 'orbit',
		label: '표준',
		desc: '사냥감에게 곧장 날아가 때리고 홰로 돌아옵니다.',
		damageMult: 1,
		cooldownMult: 1,
		scanRadiusMult: 1,
		simTargets: 1,
	},
	boomerang: {
		id: 'boomerang',
		label: '선회검',
		desc: '사냥감을 지나쳐 넓은 호를 그리며 되돌아옵니다.\n호가 스치는 적을 모두 관통 타격하지만, 한 대의 피해는 낮습니다.',
		damageMult: 0.74,
		cooldownMult: 1.08,
		scanRadiusMult: 1,
		simTargets: 5.0,
		sweepRad: 3.5,
		overshootPx: 74,
		minReachPx: 150,
		maxReachPx: 330,
		arcMs: 900,
	},
	stake: {
		id: 'stake',
		label: '말뚝검',
		desc: '사냥감 자리에 꽂혀 3초간 주변을 지지는 오라가 됩니다.\n꽂혀 있는 동안 그 검의 궤도 자리는 비어 있습니다.',
		// 2026-09-06: 오라 틱 비율 0.55 → 0.60.
		// 말뚝검은 꽂혀 있는 3초가 라운드와 무관하게 고정이라, 적 체력이 오를수록
		// "한 번 꽂아 두면 처리되는 몹 수"가 줄어 후반에 혼자 뒤처진다
		// (게이트 auditBehaviors 에서 0.84배 — 목표 0.85~1.20 미달).
		// damageMult 를 올리면 단타가 세져 초반 1.9배가 더 튀므로, **오라 쪽만** 올린다.
		damageMult: 0.8,
		cooldownMult: 1.1,
		scanRadiusMult: 0.95,
		simTargets: 1,
		plantMs: 3000,
		auraRadius: 104,
		auraTickMs: 420,
		auraTickDivisor: 4,
		auraTickMinMs: 90,
		auraTickPct: 0.60,
		auraTargetCap: 8,
	},
	lance: {
		id: 'lance',
		label: '참격검',
		desc: '사냥감 방향으로 길게 직선 관통합니다.\n폭은 좁고 사거리는 깁니다 — 멀리서 꿰뚫는 검입니다.',
		damageMult: 0.94,
		cooldownMult: 1.05,
		scanRadiusMult: 1.4,
		simTargets: 3.0,
		rangePx: 540,
		lanePx: 28,
		speedMult: 1.25,
	},
};

/**
 * 말뚝 오라의 실제 틱 간격(ms).
 * 검의 재출격 대기시간에 비례하되 하한/상한 사이로 묶는다 — 쿨다운을 줄이는 투자가
 * 말뚝검에게도 돌아가게 하는 장치다 (꽂혀 있는 시간은 라운드가 올라도 줄지 않으므로).
 */
export function stakeTickMs(cooldownMs: number): number {
	const spec = SWORD_BEHAVIORS.stake;
	const raw = cooldownMs / (spec.auraTickDivisor ?? 4);
	return Math.min(spec.auraTickMs ?? 420, Math.max(spec.auraTickMinMs ?? 140, raw));
}

/** 아키타입 3종 (기본 거동 제외) — UI 목록·테스트가 쓴다. */
export const ARCHETYPE_IDS: SwordBehavior[] = ['boomerang', 'stake', 'lance'];

/** 검 정의에서 거동을 읽는다. 필드가 없거나 모르는 값이면 기존 거동. */
export function behaviorOf(definition: { behavior?: string } | null | undefined): SwordBehavior {
	const id = definition?.behavior;
	return id === 'boomerang' || id === 'stake' || id === 'lance' ? id : 'orbit';
}

export function behaviorSpec(id: SwordBehavior): BehaviorSpec {
	return SWORD_BEHAVIORS[id] ?? SWORD_BEHAVIORS.orbit;
}

/** 관통(경로상 여러 적을 베는) 거동인가. */
export function isPierceBehavior(id: SwordBehavior): boolean {
	return id === 'boomerang' || id === 'lance';
}

/**
 * 선회검의 시각 t(0~1) 에서의 극좌표 (플레이어 기준).
 * ρ(t) = reach · sin(π t)  — 0에서 나가 최대까지 갔다가 0(=키퍼)으로 돌아온다.
 * θ(t) = base + side · sweep · t — 그 사이 옆으로 크게 쓸고 간다.
 * 매 프레임 호출되므로 객체를 만들지 않고 out 배열에 채워 준다.
 */
export function boomerangPoint(
	t: number, baseAngle: number, side: number, sweepRad: number, reach: number, out: number[],
): number[] {
	const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
	const angle = baseAngle + side * sweepRad * clamped;
	const rho = reach * Math.sin(Math.PI * clamped);
	out[0] = Math.cos(angle) * rho;
	out[1] = Math.sin(angle) * rho;
	out[2] = angle;
	return out;
}
