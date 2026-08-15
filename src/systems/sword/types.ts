// SwordOrbitSystem 패키지 내부 전용 타입.
// 공유 타입(src/types)과 런타임 코드가 어긋나는 부분을 여기서 로컬로 보정한다.
// (공유 파일은 다른 에이전트와 공동 사용 중이므로 수정하지 않는다.)

import type Phaser from 'phaser';
import type {
	DamageType,
	EvolutionRecipe,
	SwordDefinition,
	SwordEffectSpec,
	SwordSpecialSpec,
} from '../../types/catalogs';
import type { EnemySprite, ReserveSword } from '../../types/actors';

/**
 * NOTE: 공유 SwordDefinition 에 hitCooldownMs 가 없어 로컬 확장 (보고 대상).
 * 원본 코드는 `definition.hitCooldownMs ?? 110` 을 사용한다.
 */
export type OrbitSwordDefinition = SwordDefinition & { hitCooldownMs?: number };

/**
 * 런타임에서 실제로 쓰는 상태 문자열.
 * NOTE: 공유 SwordState는 'orbit'이지만 실제 코드는 'orbiting'을 사용한다 —
 * 동작 보존을 위해 로컬 타입으로 유지 (보고 대상).
 */
export type OrbitSwordState = 'orbiting' | 'launched' | 'returning';

/** 원소 필살기가 존재하는 세트. */
export type UltimateElement = 'fire' | 'electric' | 'void';

/** 적 그룹 — getChildren()/children.entries 를 덕 타이핑으로 읽는다. */
export type EnemyGroupLike = Phaser.Physics.Arcade.Group;

/**
 * 칸(슬롯) 보너스 집계 결과.
 * NOTE: 공유 SwordTraitMods 는 숫자 전용 인덱스 시그니처라서 hasSynergy(불리언)/
 * synergyElement(문자열)를 담을 수 없어 로컬 타입으로 정의 (보고 대상).
 */
export interface SlotModifiers {
	damageMult: number;
	cooldownMult: number;
	launchSpeedMult: number;
	chainBonus: number;
	dotDpsBonus: number;
	dotDurationBonus: number;
	executeBonus: number;
	goldOnHitChance: number;
	slowOnHit: number;
	healOnHitChance: number;
	bigGameDamage: number;
	critDamageAdd: number;
	cleaveBonus: number;
	hasSynergy: boolean;
	synergyElement: string | null;
}

/** EnemyManager.takeDamage 로 전달되는 피해 부가 정보. */
export interface DamageInfo {
	damageType?: DamageType;
	pen?: number;
	ignoreResist?: boolean;
}

/** rebuildLoadout 이 소비하는 장착 목록 항목 (= 창고 항목과 동일 형태). */
export type LoadoutEntry = ReserveSword;

/**
 * 이 시스템이 다루는 검 스프라이트.
 * 공유 SwordSprite 와 같은 역할이지만 런타임 코드와 어긋나는 필드가 있어
 * 로컬로 정의한다 (보고 대상):
 * - state: 'orbiting' (공유 SwordState 는 'orbit')
 * - launchAngle / returnStart*: 귀환 시작/종료 시 undefined 로 초기화됨
 * - special / effect: 정의에 없으면 null 로 채워짐
 * - traitMods: 공유 SwordTraitMods(숫자 전용)와 달리 불리언 포함 SlotModifiers
 * - aura: Arc (setPosition/destroy 를 호출하므로 GameObject 로는 부족)
 * - definition: hitCooldownMs 로컬 확장
 * - _orbitEnemyGroup / _lastReturnDistance: 내부 캐시 필드
 */
export interface OrbitSword extends Phaser.Physics.Arcade.Sprite {
	definition: OrbitSwordDefinition;
	level: number;
	slot: number;
	state: OrbitSwordState;
	angle: number;
	damage: number;
	launchSpeed: number;
	launchAngle: number | undefined;
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
	returnStartX: number | undefined;
	returnStartY: number | undefined;
	returnStartRotation: number | undefined;
	returnCurveSide: number;
	returnTurnProgress: number;
	special: SwordSpecialSpec | null;
	effect: SwordEffectSpec | null;
	traitMods?: SlotModifiers;
	/** 원소 시너지 오라 그래픽. */
	aura?: Phaser.GameObjects.Arc | null;
	_orbitEnemyGroup?: EnemyGroupLike | null;
	_lastReturnDistance?: number;
}

/** getOrbitPosition 결과. */
export interface OrbitPosition {
	x: number;
	y: number;
	angle: number;
}

/** SwordOrbitSystem 생성자 옵션 (모두 선택적 — 기본값은 생성자에서 ?? 로 적용). */
export interface SwordOrbitOptions {
	radius?: number;
	orbitSpeed?: number;
	launchDuration?: number;
	returnSpeed?: number;
	scanRadius?: number;
	closeScanRadius?: number;
	minSwords?: number;
	maxSwords?: number;
	rotationOffset?: number;
	returnLerp?: number;
	swordCatalog?: SwordDefinition[];
	damageMultiplier?: number;
	cooldownMultiplier?: number;
	launchSpeedMultiplier?: number;
	bonusHits?: number;
	evolutionRecipes?: EvolutionRecipe[];
	noLaunch?: boolean;
	orbitDamageMult?: number;
	cleaveTargets?: number;
	cleaveRadius?: number;
	maxSwordLevel?: number;
	startUnlockedSlots?: number;
}

/** applyDamage 폴백 덕 타이핑용 (EnemyManager 부재 시의 원본 폴백 체인). */
export interface DamageableEnemy {
	takeDamage?: (amount: number) => void;
	damage?: ((amount: number) => void) | number;
	health?: number;
	hp?: number;
	destroy?: () => void;
}
