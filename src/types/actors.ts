// Runtime actor types: Phaser sprites augmented with the game-specific fields
// the systems attach to them. If you find a field used in code that is missing
// here, ADD it to the interface instead of casting to `any`.

import type Phaser from 'phaser';
import type {
	EnemyBehaviorSpec,
	EnemyDefinition,
	SwordDefinition,
	SwordSpecialSpec,
} from './catalogs';

type ArcadeSprite = Phaser.Physics.Arcade.Sprite;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerSprite extends ArcadeSprite {
	maxHp: number;
	hp: number;
	attackDamage: number;
	defense: number;
	moveSpeed: number;
	critChance: number;
	critDamageMultiplier: number;
	luck: number;
	dodgeChance: number;
	hpRegen: number;
	killHeal: number;
	thorns: number;
	physicalResist: number;
	magicResist: number;
	isDead: boolean;
	isHurting: boolean;
	isKnockedBack: boolean;
	invulnerableUntil: number;
	knockbackUntil: number;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export interface EnemySprite extends ArcadeSprite {
	catalog?: EnemyDefinition;
	behavior?: EnemyBehaviorSpec;
	enemyType?: string;
	enemyName?: string;
	hp: number;
	maxHp: number;
	damage: number;
	speed: number;
	xpValue: number;
	critChance: number;
	critDamageMultiplier: number;
	physicalResist: number;
	magicResist: number;
	knockbackResist: number;
	knockbackUntil: number;
	healthBarWidth?: number;
	spriteType?: string;
	splitInto?: { id: string; count: number };
	/** Pooling guards: a dying enemy must never be re-targeted or re-damaged. */
	isDying: boolean;
	destroyed?: boolean;
	/** Incremented on every (re)spawn so stale callbacks can detect reuse. */
	spawnGeneration: number;
	lastDamageWasCrit?: boolean;
	// Damage-over-time state
	dotUntil?: number;
	dotDps?: number;
	dotTick?: number;
	dotColor?: number;
	// Slow debuff state
	slowFactor?: number;
	slowUntil?: number;
	// Behavior timers
	fireTimer?: number;
	fuseStartedAt?: number;
	healTimer?: number;
}

export interface EnemyProjectile extends ArcadeSprite {
	damage?: number;
}

// ---------------------------------------------------------------------------
// Swords
// ---------------------------------------------------------------------------

export type SwordState = 'orbiting' | 'launched' | 'returning';

/** Aggregated trait effects applied to a sword via socketed traits. */
export interface SwordTraitMods {
	[effect: string]: number;
}

export interface SwordSprite extends ArcadeSprite {
	definition: SwordDefinition;
	level: number;
	slot: number;
	state: SwordState;
	angle: number;
	damage: number;
	launchSpeed: number;
	launchAngle: number;
	launchElapsed: number;
	orbitSpeedMultiplier: number;
	hitCooldownMs: number;
	hitCooldownUntil: number;
	hitsPerLaunch: number;
	remainingHits: number;
	hitTargets: Set<EnemySprite> | null;
	scanTimer: number;
	scanInterval: number;
	target: EnemySprite | null;
	returnStartX: number;
	returnStartY: number;
	returnStartRotation: number;
	returnCurveSide: number;
	returnTurnProgress: number;
	special?: SwordSpecialSpec;
	effect?: SwordDefinition['effect'];
	traitMods?: SwordTraitMods;
	/** Element-resonance aura graphic attached to the sword, if any. */
	aura?: Phaser.GameObjects.GameObject | null;
}

/** An unequipped owned sword sitting in the reserve (창고). */
export interface ReserveSword {
	definition: SwordDefinition;
	level: number;
}

/** Per-slot economy state: enhancement level and socketed trait ids. */
export interface SlotState {
	index: number;
	enhance: number;
	traits: string[];
}
