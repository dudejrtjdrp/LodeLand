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

/** Cost of the next enhancement attempt for a slot at the given enhance level. */
export function slotEnhanceCost(config: Partial<SlotConfigSpec>, enhanceLevel: number): number {
	return Math.round((config.enhanceBaseCost ?? 30) * (enhanceLevel + 1));
}

/** Success rate of the next enhancement attempt (table lookup, 0.2 fallback). */
export function slotEnhanceSuccessRate(config: Partial<SlotConfigSpec>, enhanceLevel: number): number {
	const rates = config.enhanceSuccessRates ?? [];
	return rates[enhanceLevel] ?? 0.2;
}
