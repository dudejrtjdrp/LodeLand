// Pure slot-economy math (칸 해금/강화) — no Phaser imports, fully unit-testable.
// These functions replicate the original inline calculations exactly;
// do not "improve" the formulas without a deliberate balance change.

import type { SlotConfigSpec } from '../types/catalogs';

/**
 * Cost of unlocking the NEXT slot: base 80 doubling per purchased slot
 * (80 × growth^n, n = slots bought beyond the free starting slots).
 */
export function slotUnlockCost(config: Partial<SlotConfigSpec>, unlockedSlots: number): number {
	const bought = unlockedSlots - (config.startUnlocked ?? 2);
	return Math.round((config.unlockBaseCost ?? 80) * Math.pow(config.unlockGrowth ?? 2, Math.max(0, bought)));
}

/**
 * 다음 칸(= unlockedSlots+1 번째)을 열 수 있는 최소 라운드 (2026-09-04).
 * 골드만으로는 15라에 7칸이 다 열려 중반이 밋밋해졌다 → 라운드 게이트.
 * config.unlockRounds[i] = (startUnlocked + i + 1) 번째 칸의 해방 라운드.
 */
export function slotUnlockRound(config: Partial<SlotConfigSpec>, unlockedSlots: number): number {
	const rounds = config.unlockRounds ?? [];
	const bought = Math.max(0, unlockedSlots - (config.startUnlocked ?? 2));
	return rounds[bought] ?? 1;
}

/** 현재 라운드(마지막으로 **완료한** 라운드 기준)에 다음 칸을 열 수 있는가. */
export function canUnlockSlotAtRound(config: Partial<SlotConfigSpec>, unlockedSlots: number, round: number): boolean {
	return round >= slotUnlockRound(config, unlockedSlots);
}

/** Cost of the next enhancement attempt for a slot at the given enhance level. */
export function slotEnhanceCost(config: Partial<SlotConfigSpec>, enhanceLevel: number): number {
	return Math.round((config.enhanceBaseCost ?? 30) * (enhanceLevel + 1));
}

/** Success rate of the next enhancement attempt (table lookup, 0.2 fallback). */
export function slotEnhanceSuccessRate(config: Partial<SlotConfigSpec>, enhanceLevel: number): number {
	const rates = config.enhanceSuccessRates ?? [];
	return rates[enhanceLevel] ?? 0.2;
}
