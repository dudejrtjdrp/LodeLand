// Type definitions for the data-driven catalogs in src/data/*.json.
// These types describe the shape the game code relies on; optional fields
// appear only on some entries (e.g. resist/pierce only on rare swords).

export type DamageType = 'physical' | 'magic';

export type Element =
	| 'fire'
	| 'electric'
	| 'poison'
	| 'void'
	| 'gold'
	| 'ice'
	| 'blood'
	| 'wind';

export interface SizeSpec {
	width: number;
	height: number;
}

export interface HitboxSpec {
	shape?: 'circle' | 'box';
	width?: number;
	height?: number;
	radius?: number;
	offsetX?: number;
	offsetY?: number;
}

// ---------------------------------------------------------------------------
// swordCatalog.json
// ---------------------------------------------------------------------------

export interface SwordEffectSpec {
	type: string;
	tint: string;
	[key: string]: unknown;
}

export interface SwordSpecialSpec {
	type: string;
	label?: string;
	chance?: number;
	damagePct?: number;
	dps?: number;
	durationMs?: number;
	targets?: number;
	threshold?: number;
}

export interface SwordDefinition {
	id: string;
	name: string;
	assetName: string;
	sheetOrder: number;
	orbitSpeedMultiplier: number;
	launchSpeed: number;
	damage: number;
	cooldownMs: number;
	maxHits: number;
	critChance: number;
	critDamageMultiplier: number;
	effect: SwordEffectSpec;
	hitbox: HitboxSpec;
	damageType: DamageType;
	/** Element set membership (fire/electric/void ... resonance + ultimates). */
	element?: Element;
	/** Rare swords only: penetration subtracted from the enemy's typed resist. */
	physicalPen?: number;
	magicPen?: number;
	/** Ultra-rare extras: flat true damage / % max-HP damage (resist-ignoring). */
	trueDamage?: number;
	maxHpDamage?: number;
	special?: SwordSpecialSpec;
	/** Per-hit cooldown override (default 110ms at the use site). */
	hitCooldownMs?: number;
	/** Set on catalog entries produced by evolution recipes. */
	evolved?: boolean;
}

// ---------------------------------------------------------------------------
// enemyCatalog.json
// ---------------------------------------------------------------------------

export interface SpriteAnimationSpec {
	name: string;
	row?: number;
	frameStart: number;
	frameCount?: number;
	frameEnd?: number;
	frameRate: number;
	repeat: number;
}

export interface EnemySpritesheetSpec {
	filePath: string;
	textureKey: string;
	frameWidth: number;
	frameHeight: number;
	animations?: SpriteAnimationSpec[];
}

export interface EnemyBehaviorSpec {
	type: string;
	damageType?: DamageType;
	range?: number;
	keepDistance?: number;
	fireIntervalMs?: number;
	projectileCount?: number;
	projectileDamage?: number;
	projectileSpeed?: number;
	spreadDeg?: number;
	explodeDamage?: number;
	explodeRadius?: number;
	fuseMs?: number;
	healIntervalMs?: number;
	healPercent?: number;
	healRadius?: number;
}

export interface EnemyDefinition {
	id: string;
	name: string;
	hp: number;
	speed: number;
	damage: number;
	size: SizeSpec;
	color: string;
	critChance: number;
	critDamageMultiplier: number;
	xpValue: number;
	spriteType?: 'aseprite' | 'separate' | 'single' | string;
	spritesheet?: EnemySpritesheetSpec;
	spritesheets?: Record<string, EnemySpritesheetSpec>;
	goldValue?: number;
	goldChance?: number;
	healthBarWidth?: number;
	tint?: string;
	behavior?: EnemyBehaviorSpec;
	physicalResist?: number;
	magicResist?: number;
	knockbackResist?: number;
	splitInto?: { id: string; count: number };
	isElite?: boolean;
	isMiniboss?: boolean;
	isBoss?: boolean;
	isReaper?: boolean;
}

// ---------------------------------------------------------------------------
// playerCatalog.json
// ---------------------------------------------------------------------------

export interface PlayerSpritesheetSpec {
	assetName: string;
	filePath: string;
	textureKey: string;
	frameWidth: number;
	frameHeight: number;
	frameStart: number;
	frameEnd: number;
	frameRate: number;
	repeat: number;
}

export interface PlayerStats {
	moveSpeed: number;
	damage: number;
	defense: number;
	maxHp: number;
	critChance?: number;
	critDamageMultiplier?: number;
	luck?: number;
}

/** Per-character quirks; every field is optional and defaulted at the use site. */
export interface PlayerTraits {
	hpMult?: number;
	damageMult?: number;
	cooldownMult?: number;
	goldMult?: number;
	luckBonus?: number;
	maxSwords?: number;
	noLaunch?: boolean;
	orbitDamageMult?: number;
	orbitRadiusMult?: number;
	[key: string]: number | boolean | undefined;
}

export interface PlayerDefinition {
	id: string;
	name: string;
	displaySize: SizeSpec;
	hitbox: HitboxSpec;
	stats: PlayerStats;
	spritesheets: Record<'idle' | 'hurt' | 'death', PlayerSpritesheetSpec>;
	animations: Record<'idle' | 'hurt' | 'death', string>;
	description: string;
	unlockGold: number;
	traits?: PlayerTraits;
	tint?: string;
}

// ---------------------------------------------------------------------------
// shopCatalog.json
// ---------------------------------------------------------------------------

export interface ShopStatSpec {
	id: string;
	name: string;
	icon: string;
	type: string;
	value: number;
	baseCost: number;
	desc: string;
}

export interface SlotConfigSpec {
	startUnlocked: number;
	unlockBaseCost: number;
	unlockGrowth: number;
	enhanceBaseCost: number;
	enhanceMaxLevel: number;
	enhanceSuccessRates: number[];
	enhanceDamagePerLevel: number;
	enhanceCooldownPerLevel: number;
	traitSockets: number;
}

export interface ShopCatalog {
	rerollBase: number;
	rerollPerRound: number;
	swordPriceBase: number;
	swordPricePerTier: number;
	priceGrowth: number;
	stats: ShopStatSpec[];
	slots: SlotConfigSpec;
}

// ---------------------------------------------------------------------------
// traitCatalog.json
// ---------------------------------------------------------------------------

export interface TraitDefinition {
	id: string;
	name: string;
	icon: string;
	element?: Element;
	effects: Record<string, number>;
	desc: string;
}

export interface TraitCatalog {
	pullCost: number;
	traits: TraitDefinition[];
}

// ---------------------------------------------------------------------------
// upgradeCatalog.json
// ---------------------------------------------------------------------------

export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface RaritySpec {
	id: RarityId;
	name: string;
	color: string;
	glow: string;
	luckScale: number;
}

export interface UpgradeDefinition {
	id: string;
	name: string;
	icon: string;
	type: string;
	descTemplate: string;
	values: Record<RarityId, number>;
}

export interface UpgradeCatalog {
	rarities: RaritySpec[];
	swordTierByRarity: Record<RarityId, number[]>;
	upgrades: UpgradeDefinition[];
	oddsByLevel: Array<{ minLevel: number; weights: Record<RarityId, number> }>;
}

// ---------------------------------------------------------------------------
// metaCatalog.json
// ---------------------------------------------------------------------------

export interface MetaUpgradeDefinition {
	id: string;
	name: string;
	icon: string;
	type: string;
	perRank: number;
	maxRank: number;
	baseCost: number;
	descTemplate: string;
}

// ---------------------------------------------------------------------------
// evolutionCatalog.json
// ---------------------------------------------------------------------------

export interface EvolutionRecipe {
	ingredients: string[];
	result: string;
	announcement: string;
}

// ---------------------------------------------------------------------------
// waveTable.json
// ---------------------------------------------------------------------------

export interface WavePoolEntry {
	id: string;
	weight: number;
}

export interface WaveSpec {
	minute: number;
	spawnIntervalMs: number;
	minAlive: number;
	pool: WavePoolEntry[];
}

export interface WaveEventSpec {
	timeMs: number;
	enemyId: string;
	count: number;
	announcement?: string;
}

export interface WaveTable {
	runDurationMs: number;
	reaper: {
		enemyId: string;
		repeatEveryMs: number;
		announcement: string;
	};
	waves: WaveSpec[];
	events: WaveEventSpec[];
}
