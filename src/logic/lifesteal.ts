// 흡혈·타격 회복 예산 — 2026-09-04
//
// 문제: 흡혈은 "피해 × %"라서 후반 DPS(초당 수십만)에 곱하면 매 프레임 최대 체력을
// 채웠다 — 15라부터 서 있기만 해도 됐던 진짜 원인. 수치를 낮추는 것만으로는
// 피해가 계속 커지는 이상 언젠가 다시 무적이 된다.
//
// 해결: 타격/처치에서 오는 모든 회복(흡혈 %, 흡수 검 특수, 흡혈 각인, 갈증, 처치 회복)이
// **초당 최대체력의 N%** 예산 안에서만 들어온다. 예산은 시간에 비례해 차오르고
// 1초치까지만 쌓인다(순간 회복 상한 = 예산 1초치). 물약·재생·레벨업 회복은 예산 밖.
//
// Phaser import 금지 — balance-sim 이 같은 상수를 쓴다.

/** 타격 회복 예산: 최대체력 대비 초당 비율. 완전 회복에 ≈17초. */
export const HEAL_BUDGET_PER_SEC = 0.06;

export interface HealBudgetCarrier {
	hp: number;
	maxHp: number;
	isDead?: boolean;
	/** 남은 예산(HP 단위) */
	healBudget?: number;
	/** 마지막 예산 갱신 시각(ms) */
	healBudgetAt?: number;
	/** 초당 예산 추가 비율 (스킬 트리) */
	healBudgetBonus?: number;
}

/** 예산을 현재 시각까지 충전한다 (1초치 상한). */
export function refillHealBudget(target: HealBudgetCarrier, nowMs: number): number {
	const perSec = Math.max(1, (target.maxHp ?? 100) * (HEAL_BUDGET_PER_SEC + (target.healBudgetBonus ?? 0)));
	const last = target.healBudgetAt ?? nowMs;
	const elapsed = Math.max(0, Math.min(1000, nowMs - last)) / 1000;
	const budget = Math.min(perSec, (target.healBudget ?? perSec) + perSec * elapsed);
	target.healBudget = budget;
	target.healBudgetAt = nowMs;
	return budget;
}

/**
 * 예산 안에서 회복한다. 실제로 오른 체력을 돌려준다 (0 이면 예산 소진/만피/사망).
 * amount 는 HP 단위 — 호출부가 damage × lifesteal 을 계산해 넘긴다.
 */
export function healWithinBudget(target: HealBudgetCarrier, amount: number, nowMs: number): number {
	if (!target || target.isDead || !(amount > 0)) {
		return 0;
	}
	const budget = refillHealBudget(target, nowMs);
	const room = Math.max(0, (target.maxHp ?? 0) - (target.hp ?? 0));
	const applied = Math.min(amount, budget, room);
	if (applied <= 0) {
		return 0;
	}
	target.hp += applied;
	target.healBudget = budget - applied;
	return applied;
}

/** 시뮬레이터용: 초당 회복이 예산으로 얼마나 잘리는지. */
export function cappedHealPerSec(rawHealPerSec: number, maxHp: number): number {
	return Math.min(rawHealPerSec, maxHp * HEAL_BUDGET_PER_SEC);
}
