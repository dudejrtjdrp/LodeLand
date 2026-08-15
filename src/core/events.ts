// Central registry of cross-system game events.
// Systems communicate through the scene's EventEmitter using these constants
// instead of scattering string literals — adding a listener site is grep-able
// and payload types are documented in one place.

export const GameEvents = {
	/** The player's XP level increased. Payload: none (read progression.level). */
	LEVEL_UP: 'levelup',
	/** An enemy finished dying. Payload: { enemy, x, y, amount, player }. */
	ENEMY_DIED: 'enemy-died',
	/** A level-up upgrade card was chosen. Payload: (upgradeId: string). */
	UPGRADE_CHOSEN: 'upgrade-chosen',
	/** Two swords fused into an evolution. Payload: (resultId: string). */
	SWORD_FUSED: 'sword-fused',
} as const;

export type GameEventName = (typeof GameEvents)[keyof typeof GameEvents];
