// Pure combat math — no Phaser imports, fully unit-testable.
// These functions replicate the original inline calculations exactly;
// do not "improve" the formulas without a deliberate balance change.

import type { DamageType } from '../types/catalogs';

/** Caps from the original player damage pipeline. */
export const PLAYER_DEFENSE_CAP = 60;
export const PLAYER_TYPED_RESIST_CAP = 50;

/**
 * Damage the player actually takes after % defense and typed resist.
 * Defense caps at 60%, typed resist at 50%; the result is never below 1.
 */
export function mitigatePlayerDamage(
	rawDamage: number,
	defense: number,
	physicalResist: number,
	magicResist: number,
	damageType: DamageType = 'physical',
): number {
	const cappedDefense = Math.min(PLAYER_DEFENSE_CAP, defense ?? 0);
	const typedResist = Math.min(
		PLAYER_TYPED_RESIST_CAP,
		damageType === 'magic' ? (magicResist ?? 0) : (physicalResist ?? 0),
	);
	return Math.max(1, Math.round(rawDamage * (1 - cappedDefense / 100) * (1 - typedResist / 100)));
}

/**
 * Damage an enemy actually takes after typed resist reduced by the attacker's
 * penetration. Resist here is a fraction (0.3 = 30%). Never below 1.
 * True damage / %HP damage bypasses this entirely (ignoreResist).
 */
export function mitigateEnemyDamage(
	amount: number,
	enemyResist: number,
	penetration = 0,
): number {
	const effectiveResist = Math.max(0, (enemyResist ?? 0) - (penetration ?? 0));
	if (effectiveResist <= 0) {
		return amount;
	}
	return Math.max(1, Math.round(amount * (1 - effectiveResist)));
}

/** Pick the typed resist value for a damage type. */
export function resistFor(
	damageType: DamageType | undefined,
	physicalResist: number,
	magicResist: number,
): number {
	return damageType === 'magic' ? (magicResist ?? 0) : (physicalResist ?? 0);
}

/**
 * %-max-HP bonus damage from ultra-rare swords: at least 1, capped at 300
 * so bosses don't melt.
 */
export function maxHpBonusDamage(enemyMaxHp: number, maxHpDamageFraction: number, capScale = 1): number {
	// 상한 300 은 피해 규모(레벨 성장)에 따라 같이 커진다 (2026-09-04)
	return Math.min(300 * Math.max(1, capScale), Math.max(1, Math.round(enemyMaxHp * maxHpDamageFraction)));
}

/** Knockback speed for an enemy given its resist fraction (>=1 = immune). */
export function enemyKnockbackForce(knockbackResist: number, base = 220): number {
	return base * (1 - knockbackResist);
}
