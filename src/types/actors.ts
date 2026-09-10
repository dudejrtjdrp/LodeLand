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
	/** 런 시작 시점(메타/특성 적용 후) 이동 속도 — 상한(base×1.6) 계산 기준. */
	baseMoveSpeed?: number;
	critChance: number;
	critDamageMultiplier: number;
	luck: number;
	dodgeChance: number;
	hpRegen: number;
	killHeal: number;
	thorns: number;
	physicalResist: number;
	magicResist: number;
	// 해금 스탯 (statCaps.UNLOCK_CAPS 참조) — 대응 스탯 MAX 시 레벨업으로 성장
	/** 받는 피해 감소 비율 (0~0.25) — applyPlayerDamage 마지막 단계에서 적용 */
	damageReduction: number;
	/** 흡혈: 검 피해의 이 비율만큼 회복 (0~0.03) — AugmentSystem.onSwordHit 에서 소비 */
	lifesteal: number;
	/** 타격 회복 예산 (logic/lifesteal.ts) — 흡혈·흡수·처치 회복이 공유 */
	healBudget?: number;
	healBudgetAt?: number;
	/** 스킬 트리 [되살아나는 불]: 초당 회복 예산 추가 비율 */
	healBudgetBonus?: number;
	/** INGOT 획득 보너스 (0~0.5) — PickupSystem.addGold 에서 소비 */
	goldBonus: number;
	/**
	 * 처형 (0~0.60) — 치명타 확률 100% 해금. 체력이 EXECUTE_HP_THRESHOLD 이하인
	 * 적에게 주는 피해가 이 비율만큼 증가한다. hitResolution.resolveHit 에서 소비.
	 */
	executeDamage: number;
	/**
	 * 관통 (0~0.20) — 치명타 확률 100% 해금. 적의 물리/마법 저항에서 이 수치를
	 * 뺀다. SwordOrbitSystem.getDamageInfo 가 검·세트 관통에 합산해 내려보낸다.
	 */
	pen: number;
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
	// --- 원소 세트 상태이상 (src/systems/ElementSetSystem.ts) ---
	/** 번개 4세트 [감전]: 만료 전까지 받는 피해 증가 */
	setShockUntil?: number;
	/** 피 4세트 [출혈]: 움직이는 동안 지속 피해 */
	setBleedUntil?: number;
	setBleedDps?: number;
	setBleedTick?: number;
	/** 얼음 4세트 [빙결]: 완전 정지 + 받는 피해 증가 */
	setFrozenUntil?: number;
	/** 얼음 4세트: 감속 중첩 (3에서 빙결) */
	setSlowStacks?: number;
	setSlowStackAt?: number;
	/** 독 5세트: 중독 중첩 (최대 5, 역병의 조건) */
	setPoisonStacks?: number;
	setPoisonStackAt?: number;
	/** 바람 4세트 [칼바람]: 같은 자국에 연타되지 않도록 */
	setWindHitAt?: number;
	// --- 상태이상 표시 (src/systems/StatusEffectSystem.ts) ---
	/**
	 * 현재 스프라이트에 걸어 둔 상태이상 틴트. null = 원래 색.
	 * 매 프레임 setTint 를 다시 부르지 않기 위한 변경 감지용이다.
	 */
	statusTintApplied?: number | null;
	/**
	 * 되돌릴 원래 색 캐시 (-1 = 틴트 없음, undefined = 아직 계산 안 함).
	 * 스폰 시점의 어픽스/카탈로그 색을 한 번만 파싱한다.
	 */
	statusBaseTint?: number;
	/** 지속 오버레이의 개체별 위상 — 여러 마리가 똑같이 일렁이지 않게 흩는다 */
	statusPhase?: number;
	// Behavior timers
	fireTimer?: number;
	fuseStartedAt?: number;
	healTimer?: number;
	// --- 보스 스킬 런타임 상태 (src/logic/bossSkills.ts, EnemyManager.updateBossSkills) ---
	/** 이 개체가 실제로 쓰는 시전형 스킬 id 목록 (라운드별 해금분, enrage 제외) */
	skillIds?: string[];
	/** 스킬 로테이션 인덱스 */
	skillRotation?: number;
	/** 다음 시전 가능 시각 */
	nextSkillAt?: number;
	/** 시전 종료 시각 — 그동안 제자리 (텔레그래프 읽을 시간) */
	castingUntil?: number;
	/** 스킬 돌진(삼연 돌진) 종료 시각 — 이 동안은 시전 정지보다 우선해 돌진 속도를 유지한다 */
	skillDashUntil?: number;
	/** 마지막으로 재생한 보스 상태 애니 키 (idle/walk/attack 전환 가드) */
	stateAnimKey?: string;
	/** 카탈로그 hitbox 로 물리 바디를 좁혀 놓았는가 (풀 재사용 시 원복 판단) */
	customHitbox?: boolean;
	/** 반쪽 붕괴: 1단에서 정한 경계선 축 — 2단이 그대로 뒤집어 쓴다 */
	halfFieldAngle?: number;
	halfFieldX?: number;
	halfFieldY?: number;
	/** 격노 발동 여부 (체력 50% 이하 1회) */
	enraged?: boolean;
	/** 킷에 격노가 포함되어 있는지 */
	hasEnrage?: boolean;
	/** 페이즈 보스: 현재 형태 인덱스 (catalog.phases 기준) */
	phaseIndex?: number;
	/** purge 어픽스로 얻은 감속·지속피해 면역 (페이즈 전환 시에도 유지) */
	affixPurge?: boolean;
	// --- 특성(몸체·기질) 런타임 상태 (src/logic/enemyTraits.ts) ---
	/** 적용된 특성 id 목록 (스폰 시 카탈로그에서 복사) */
	traitIds?: string[];
	/** 지속 피해(화상·중독) 면역 — 막힌 핏줄 특성·juggernaut 어픽스 */
	dotImmune?: boolean;
	/** 약점 텍스트 스로틀 (연타 시 "약점!" 도배 방지) */
	weakTextAt?: number;
	/** 장막 텍스트 스로틀 (장막 지대 안에서 "장막" 도배 방지) */
	veilTextAt?: number;
	// --- Affix runtime state (see affixCatalog.json) ---
	/** 적용된 어픽스 id 목록 (없으면 빈 배열) */
	affixIds?: string[];
	/** 어픽스 틴트 색 (숫자) — 처치 파편 색으로도 쓴다 (2026-09-01 등급별 사망 연출) */
	affixTintColor?: number;
	/** 머리 위 식별 마커 (풀 재사용 — 마커 없는 종류로 재활용되면 숨긴다) */
	markerIcon?: Phaser.GameObjects.Image | null;
	/** 지금 이 개체가 마커를 쓰는가 */
	markerOn?: boolean;
	/** hasty 계열 어픽스의 발동 주기 배수 × 라운드 스케일 — 스폰 시 1회 계산해 캐시 */
	fireIntervalMult?: number;
	/** 원거리 사거리·유지거리 배율 (라운드 스케일) — 스폰 시 1회 계산해 캐시 */
	rangeMult?: number;
	/** 투사체 속도 배율 (라운드 스케일) — 스폰 시 1회 계산해 캐시 */
	projectileSpeedMult?: number;
	regenPerSec?: number;
	regenAcc?: number;
	shieldHits?: number;
	dodgeChance?: number;
	slowImmune?: boolean;
	vampiricHealMult?: number;
	thornChance?: number;
	thornDamageMult?: number;
	frenzyThreshold?: number;
	frenzySpeedMult?: number;
	frenzyDamageMult?: number;
	frenzied?: boolean;
	accelPerSec?: number;
	accelMax?: number;
	accelFactor?: number;
	deathExplodeRadius?: number;
	deathExplodeDamage?: number;
	deathPool?: { radius: number; durationMs: number; dps: number } | null;
	mitosis?: boolean;
	// blink (behavior 'blinker' 또는 phasing 어픽스)
	blinkTimer?: number;
	blinkIntervalMs?: number;
	blinkRange?: number;
	// summon (behavior 'summoner' 또는 summoning 어픽스)
	summonTimer?: number;
	summonId?: string;
	summonCount?: number;
	summonIntervalMs?: number;
	// aura (behavior 'aura' 또는 warlord 어픽스) — 시전자 측
	auraTimer?: number;
	auraRadius?: number;
	auraDamageMult?: number;
	auraSpeedMult?: number;
	// aura — 수혜자 측 (시전자가 주기적으로 갱신)
	auraBuffUntil?: number;
	auraBuffDamageMult?: number;
	auraBuffSpeedMult?: number;
	// 능동 스킬 증강 판정 가드 (같은 발동에서 두 번 맞지 않게)
	/** 대시 잔상 피해를 받은 대시의 시작 시각 */
	dashGhostAt?: number;
	/** 귀환 궤적 피해를 받은 귀소의 시작 시각 */
	recallSweepAt?: number;
	// volley(결집 사수) — 유도탄 살포 타이머
	volleyTimer?: number;
	// veil(장막 소환수) — 장막 재설치 타이머
	veilTimer?: number;
	// charger 상태 기계
	chargePhase?: 'approach' | 'windup' | 'dash' | 'cooldown';
	chargePhaseUntil?: number;
	chargeAngle?: number;
	/** 피격 플래시 중복 방지 (성능) */
	flashUntil?: number;
	// --- 스킬 트리 (src/systems/SkillTreeSystem.ts) ---
	/** [표식] 만료 시각 / 받는 피해 배율 */
	huntMarkUntil?: number;
	huntMarkMult?: number;
}

export interface EnemyProjectile extends ArcadeSprite {
	damage?: number;
	/** 사인(死因) 표기용 — 쏜 적의 이름 */
	shooterName?: string;
	/** 결집 사수의 유도탄: 초당 최대 선회량(라디안). 0/undefined = 직선탄 */
	homingTurnRate?: number;
	/** 유도탄 속도(px/s) — 선회 후 속도를 다시 세울 때 쓴다 */
	homingSpeed?: number;
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

/** An unequipped owned sword sitting in the reserve (보관함). */
export interface ReserveSword {
	definition: SwordDefinition;
	level: number;
	/** 검에 새겨진 각인 id 목록 — 각인은 검 귀속(2026-08-28). */
	traits?: string[];
}

/**
 * Per-slot economy state: enhancement level (positional).
 * NOTE: traits 는 검 귀속으로 이전됨(2026-08-28) — 슬롯에는 강화만 남는다.
 * traits 필드는 구세이브 마이그레이션 호환용으로만 남아 있다.
 */
export interface SlotState {
	index: number;
	enhance: number;
	traits: string[];
}
