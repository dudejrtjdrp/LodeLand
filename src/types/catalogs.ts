// Type definitions for the data-driven catalogs in src/data/*.json.
// These types describe the shape the game code relies on; optional fields
// appear only on some entries (e.g. resist/pierce only on rare swords).

export type DamageType = 'physical' | 'magic';

/** 검 등급 — mythic 은 조합(REFORGE) 전용, 상점·상자·레벨업 풀에 등장하지 않는다. */
export type SwordRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

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
	/** slow 스페셜: 감속 비율 (0.45 = 45% 감속) */
	slowPct?: number;
	/** blast 스페셜: 폭발 반경(px) */
	radius?: number;
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
	/** 등급 (가격·상점 개방·상자 보상·레벨업 카드 풀의 기준). */
	rarity?: SwordRarity;
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
	/**
	 * 거동 아키타입 (2026-09-01). 없으면 'orbit' = 기존 거동.
	 * 계수는 src/logic/swordBehavior.ts 의 SWORD_BEHAVIORS 에 있다.
	 */
	behavior?: 'orbit' | 'boomerang' | 'stake' | 'lance';
	/** 세계관 로어 한 줄 (툴팁·상점에 표시). */
	lore?: string;
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
	/**
	 * 원본 시트의 열 개수. 'aseprite'(행 기반) 타입에서만 쓴다.
	 * 텍스처를 아틀라스로 합친 뒤에는 원본 시트 폭을 런타임에 읽을 수 없어
	 * 카탈로그에 명시해야 한다. (현재 aseprite 타입 적은 없다.)
	 */
	framesPerRow?: number;
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
	// charger: 조준 후 돌진
	windupMs?: number;
	dashSpeed?: number;
	dashDurationMs?: number;
	dashCooldownMs?: number;
	/** 돌진을 시작하는 거리 (기본 320) */
	dashRange?: number;
	// summoner: 주기적으로 하수인 소환
	summonId?: string;
	summonCount?: number;
	summonIntervalMs?: number;
	// aura: 주변 아군 강화
	auraRadius?: number;
	auraDamageMult?: number;
	auraSpeedMult?: number;
	// blinker: 주기적으로 플레이어 쪽으로 점멸
	blinkIntervalMs?: number;
	blinkRange?: number;
	// volley(결집 사수): 궤도 밖에서 느린 유도탄을 살포한다 (2026-09-01)
	/** 유도탄의 초당 최대 선회량(라디안) — 낮을수록 대시로 확실히 떨어진다 */
	homingTurnRate?: number;
	/** 유도탄 수명(ms) — 이 시간이 지나면 스스로 사라진다 */
	projectileLifeMs?: number;
	// veil(장막 소환수): 정지 장막을 깔아 그 안의 아군 피해를 줄인다
	veilIntervalMs?: number;
	veilRadius?: number;
	veilDurationMs?: number;
	/** 장막 안의 적이 받는 피해 배율 (0.45 = 55% 감소) */
	veilDamageMult?: number;
}

// ---------------------------------------------------------------------------
// affixCatalog.json — 스폰 시 적에게 붙는 변형 패턴 (조합 가능)
// ---------------------------------------------------------------------------

export interface AffixDefinition {
	id: string;
	name: string;
	tint?: string;
	weight: number;
	/** 이 라운드 이전에는 등장하지 않음 */
	minRound: number;
	hpMult?: number;
	damageMult?: number;
	speedMult?: number;
	sizeMult?: number;
	xpMult?: number;
	goldMult?: number;
	goldChanceOverride?: number;
	knockbackResistAdd?: number;
	physicalResistAdd?: number;
	magicResistAdd?: number;
	/** ranged/healer 행동의 발동 주기 배수 (hasty) */
	fireIntervalMult?: number;
	special?: 'regen' | 'deathExplode' | 'mitosis' | 'deathPool' | 'shield' | 'blink'
		| 'summon' | 'aura' | 'frenzy' | 'thorns' | 'accelerate' | 'vampiric' | 'purge' | 'dodge';
	regenPercentPerSec?: number;
	explodeRadius?: number;
	explodeDamageMult?: number;
	poolRadius?: number;
	poolDurationMs?: number;
	poolDps?: number;
	shieldHits?: number;
	blinkIntervalMs?: number;
	blinkRange?: number;
	summonId?: string;
	summonCount?: number;
	summonIntervalMs?: number;
	auraRadius?: number;
	auraDamageMult?: number;
	auraSpeedMult?: number;
	frenzyThreshold?: number;
	frenzySpeedMult?: number;
	frenzyDamageMult?: number;
	thornChance?: number;
	thornDamageMult?: number;
	accelPerSec?: number;
	accelMax?: number;
	vampiricHealMult?: number;
	dodgeChance?: number;
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
	/** 원본 스프라이트가 기본으로 바라보는 방향 (기본값 'left' — 기존 시트 호환). */
	facing?: 'left' | 'right';
	spritesheet?: EnemySpritesheetSpec;
	spritesheets?: Record<string, EnemySpritesheetSpec>;
	goldValue?: number;
	goldChance?: number;
	healthBarWidth?: number;
	tint?: string;
	/**
	 * 머리 위 식별 마커 (2026-09-01 아트 통일 패스).
	 * 원본 유닛 시트를 재활용한 적은 틴트만으로는 원본과 구분되지 않는다 —
	 * 작은 글리프 하나가 "이건 다른 놈"을 즉시 읽히게 한다.
	 */
	marker?: { icon: string; color?: string };
	/**
	 * 물리 바디 규격 (원본 프레임 좌표). 없으면 프레임 전체가 바디다.
	 * 보스는 프레임 여백이 커서(공격 프레임의 무기 궤적) 바디가 그림보다 훨씬 넓어진다 —
	 * 몸통 알파 bbox 를 박아 "보이지도 않는데 맞는" 구간을 없앤다 (2026-09-02).
	 */
	hitbox?: { width: number; height: number; offsetX: number; offsetY: number };
	/** 보스 스킬 풀 (src/logic/bossSkills.ts BOSS_SKILLS 의 id 목록, 순서 = 해금 순서) */
	skillKit?: string[];
	behavior?: EnemyBehaviorSpec;
	physicalResist?: number;
	magicResist?: number;
	knockbackResist?: number;
	splitInto?: { id: string; count: number };
	isElite?: boolean;
	isMiniboss?: boolean;
	isBoss?: boolean;
	isReaper?: boolean;
	/** 태생 어픽스: 스폰 시 항상 이 어픽스들이 적용된다 (보스 개성용). */
	affixes?: string[];
	/** 특성(몸체·기질) id 목록 — 원소 약점/저항·CC 면역 (src/logic/enemyTraits.ts). */
	traits?: string[];
	/**
	 * 페이즈 보스(탈각하는 것): 체력 비율 임계마다 형태가 바뀐다.
	 * anim 은 spritesheets 키, traits/skills 는 그 형태 동안의 오버라이드.
	 */
	phases?: BossPhaseSpec[];
	/** 세계관 로어 한 줄 (도감·연출용, 선택). */
	lore?: string;
}

/** 페이즈 보스의 형태 하나 (EnemyManager.applyBossPhase 가 소비) */
export interface BossPhaseSpec {
	/** 이 형태로 전환되는 체력 비율 상한 (1.01 = 시작 형태) */
	hpPct: number;
	/** spritesheets 애니 키 (idle/mud/ice/flying …) */
	anim: string;
	/** 형태 이름 (보스바·정찰·전환 배너) */
	name: string;
	/** 이 형태의 특성 오버라이드 */
	traits: string[];
	/** 이 형태의 보스 스킬 오버라이드 */
	skills: string[];
	/** 이동 속도 배율 (기본 1) */
	speedMult?: number;
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

/**
 * 키퍼 고유 메커닉 (2026-09-01).
 * 능력치 차이(traits) 위에 얹히는 "그 키퍼만의 규칙" — 런타임은 KeeperSystem 이 맡는다.
 * 수치는 전부 여기(데이터)에 있고 코드에 상수를 박지 않는다.
 */
export interface KeeperMechanicSpec {
	/** succession | counterstrike | galewalk | wager */
	id: string;
	/** 화면 표기 이름 (한국어) */
	name: string;
	/** 캐릭터 카드용 한 줄 요약 */
	short: string;
	/** 키워드 사전·툴팁용 2~3줄 설명 */
	desc: string;
	// --- succession (ASH) ---
	windowMs?: number;
	maxStacks?: number;
	damagePerStack?: number;
	// --- counterstrike (BASTION) ---
	cooldownMs?: number;
	damageMult?: number;
	searchRadius?: number;
	// --- galewalk (TALON) ---
	dashCooldownMult?: number;
	trailDamagePct?: number;
	trailRadius?: number;
	// --- wager (GILDER) ---
	freeFirstReroll?: boolean;
	upChance?: number;
	downChance?: number;
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
	/** 키퍼 고유 메커닉 (없으면 능력치 차이만 있는 키퍼). */
	mechanic?: KeeperMechanicSpec;
	tint?: string;
	/** 프레임 내 몸 비율 차이 보정용 포트레이트 배율 (기본 1 — 기준은 ASH의 47%) */
	portraitScale?: number;
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
	/** i번째 구매 칸(시작 칸 이후)의 해방 라운드 게이트 (logic/slots.ts slotUnlockRound) */
	unlockRounds?: number[];
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
	/** 등급별 검 기본가 (없으면 구식 tierIndex 공식으로 폴백). */
	swordPriceByRarity?: Partial<Record<SwordRarity, number>>;
	/** 등급별 상점 개방 라운드. */
	swordRarityUnlockRound?: Partial<Record<SwordRarity, number>>;
	/** 등급별 상점 등장 가중치. */
	swordRarityWeight?: Partial<Record<SwordRarity, number>>;
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
	/** type 'skillLevel' 전용: 어느 능동 스킬의 숙련도를 올리는가 */
	skill?: 'dive' | 'recall' | 'dash';
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

// ---------------------------------------------------------------------------
// skillCatalog.json — 능동 스킬 · 대시 · 히트스톱 튜닝값 (2026-09-01)
// ---------------------------------------------------------------------------

/** 모든 능동 스킬이 공유하는 표시/쿨다운 정보. */
export interface ActiveSkillCommon {
	id: string;
	/** 화면 표기 이름 (한국어) */
	name: string;
	/** HUD 아이콘 옆 축약 표기 */
	short: string;
	/** 조작 안내·HUD 에 쓰는 키 목록 */
	keys: string[];
	/** theme.ts 글리프 키 */
	icon: string;
	cooldownMs: number;
	desc: string;
	/**
	 * 스킬 숙련 (2026-09-04): 레벨업 카드 '○○ 숙련'으로 2·3레벨. 키는 레벨 문자열("2"/"3").
	 * 값은 ActiveSkillSystem.levelMods 가 증강 시너지(SkillAugmentMods)와 같은 축으로 합친다.
	 */
	levels?: Record<string, SkillLevelSpec>;
}

export interface SkillLevelSpec {
	name: string;
	desc: string;
	cooldownMult?: number;
	// dive
	damageBonusAdd?: number;
	bonusWindowMult?: number;
	impactPct?: number;
	// recall
	invulnAddMs?: number;
	knockbackRadiusAdd?: number;
	sweepDamagePct?: number;
	healPct?: number;
	// dash
	distanceAdd?: number;
	ghostDamagePct?: number;
	strikeBonus?: { mult: number; windowMs: number };
}

export interface DiveSkillSpec extends ActiveSkillCommon {
	/** 이 출격에 얹히는 추가 피해 비율 (0.3 = +30%) */
	damageBonus: number;
	/** 보너스가 유지되는 시간 (ms) */
	bonusWindowMs: number;
	/** 커서 주변에서 사냥감을 찾는 반경 */
	searchRadius: number;
	/** 대상 후보 상한 (검마다 다른 적을 노리게 한다) */
	maxCandidates: number;
}

export interface RecallSkillSpec extends ActiveSkillCommon {
	/** 시전 직후 피해 무효 시간 (ms) */
	invulnerableMs: number;
	/** 귀환 궤적이 적을 밀어내는 힘 */
	knockbackForce: number;
	/** 귀환 궤적 넉백 판정 반경 */
	sweepRadius: number;
	/** 넉백 판정이 도는 시간 (ms) */
	sweepMs: number;
}

export interface DashSkillSpec extends ActiveSkillCommon {
	/** 이동 거리 (px) */
	distance: number;
	/** 이동 시간 (ms) — 속도 = distance / durationMs */
	durationMs: number;
	/** 잔상 생성 간격 (ms) */
	ghostIntervalMs: number;
}

export interface HitStopSpec {
	/** 일반 처치 (1~2프레임) */
	killMs: number;
	/** 치명타 명중 */
	critMs: number;
	/** 대형(정예·중간보스·보스) 처치 (3프레임) */
	bigKillMs: number;
	/** 보스 피격 (3프레임) */
	bossHitMs: number;
	/** 보스 피격 히트스톱 전용 간격 — 검 7자루가 계속 때리므로 별도로 더 길게 잡는다 */
	bossHitGapMs: number;
	/** 연속 발동 최소 간격 — 처치가 몰려도 화면이 계속 멈추지 않게 */
	minGapMs: number;
	/** 한 번에 허용하는 최대 정지 시간 */
	maxMs: number;
	/** 정지 중 물리 시간 배율 (클수록 느리게 — 24 = 거의 정지) */
	slowFactor: number;
}

/** 필살기 게이지 (2026-09-04) — 쿨다운이 아니라 처치/피격으로 차는 게이지 */
export interface UltSkillSpec {
	id: 'ult';
	name: string;
	short: string;
	keys: string[];
	icon: string;
	chargePerKill: number;
	chargePerElite: number;
	chargePerMiniboss: number;
	chargePerBoss: number;
	chargePerHurt: number;
	/** 피해 = 평균 검 1타 × 이 배율 */
	damageMult: number;
	radiusMult: number;
	/** 보스에게 추가로 깎는 최대체력 비율 */
	bossBonusPctMaxHp: number;
	/** 이 반경 안 보스의 시전을 끊는다 */
	interruptRadius: number;
	desc: string;
}

export interface SkillCatalog {
	dive: DiveSkillSpec;
	recall: RecallSkillSpec;
	dash: DashSkillSpec;
	ult: UltSkillSpec;
	hitStop: HitStopSpec;
}
