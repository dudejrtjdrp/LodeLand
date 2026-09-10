// SwordOrbitSystem 패키지 내부 전용 타입.
// 공유 타입(src/types)과 런타임 코드가 어긋나는 부분을 여기서 로컬로 보정한다.
// (공유 파일은 다른 에이전트와 공동 사용 중이므로 수정하지 않는다.)

import type Phaser from 'phaser';
import type {
	DamageType,
	Element,
	EvolutionRecipe,
	SwordDefinition,
	SwordEffectSpec,
	SwordSpecialSpec,
} from '../../types/catalogs';
import type { EnemySprite, ReserveSword } from '../../types/actors';
import type { SwordBehavior } from '../../logic/swordBehavior';

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
export type OrbitSwordState = 'orbiting' | 'launched' | 'returning' | 'planted';

/** 원소 필살기가 존재하는 세트. */
export type UltimateElement = 'fire' | 'electric' | 'void' | 'ice' | 'poison' | 'gold' | 'blood' | 'wind';

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
	/** 때린 검의 원소 — 적 특성(약점/저항) 상성 판정에 쓰인다. */
	element?: Element;
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
	/** 검에 새겨진 각인 id 목록 — 각인은 검 귀속(2026-08-28). */
	traits: string[];
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
	/** 비행 잔상 속도 제한 타임스탬프. */
	_lastTrailAt?: number;
	/** 보스 스킬 '검 봉인' 만료 시각 — 그때까지 이 검은 피해를 주지 않는다 (귀소로 즉시 해제). */
	_sealedUntil?: number;
	/** 활공 사냥(능동 스킬)로 강제 출격한 검의 보너스 만료 시각. */
	_diveBonusUntil?: number;
	/** 활공 사냥 보너스 배율 (1.3 = +30%). */
	_diveBonusMult?: number;
	// --- 거동 아키타입 (src/logic/swordBehavior.ts) ---
	/** 이 검의 STRIKE 패턴 — addSword 가 카탈로그에서 캐시한다 (없으면 정의에서 재조회). */
	behavior?: SwordBehavior;
	/** 선회검: 호의 시작 각도 (플레이어 기준). */
	_arcAngle?: number;
	/** 선회검: 호가 도는 쪽 (+1/-1). */
	_arcSide?: number;
	/** 선회검: 호의 최대 반경(px). */
	_arcReach?: number;
	/** 선회검: 호 진행도 (0~1). */
	_arcT?: number;
	/** 참격검: 이미 관통한 거리(px). */
	_lanceTravel?: number;
	/** 말뚝검: 뽑히는 시각 (scene.time.now 기준). */
	_stakeUntil?: number;
	/** 말뚝검: 다음 오라 틱 시각. */
	_stakeTickAt?: number;
	/** 말뚝 상시 연출(오라 원반·회전 호) 다음 갱신 시각 */
	_stakeFxAt?: number;
	/** 꽂힌 순간 각도 (진동 연출 기준) */
	_stakeBaseRotation?: number;
	/** bindSwordOverlap이 등록한 콜라이더 — removeSword에서 해제해야 누수되지 않는다. */
	_overlapCollider?: Phaser.Physics.Arcade.Collider | null;
	// --- 링 배치 캐시 (SwordOrbitSystem.recomputeRingLayout이 채운다) ---
	/** 내부 링 소속 여부. */
	_ringInner?: boolean;
	/** 소속 링 안에서의 순번. */
	_ringIndex?: number;
	/** 소속 링의 총 검 수 (각도 간격 계산용). */
	_ringCount?: number;
}

/** getOrbitPosition 결과. */
export interface OrbitPosition {
	x: number;
	y: number;
	angle: number;
}

/** 이중 궤도: 검이 속한 링의 배치 정보 (getRingLayout 결과). */
export interface RingLayout {
	/** 이 링의 실제 반지름 (system.radius × 링 배율). */
	radius: number;
	/** 회전 방향 — 내부 +1, 외부는 system.outerRingDirection (기본 -1, 역회전). */
	direction: 1 | -1;
	/** 링 내 균등 분배 각도 간격. */
	step: number;
	/** 링 내 순번. */
	index: number;
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
	/** 이중 궤도: 내부 원에 배치되는 슬롯 수 (기본 3 — 슬롯 0~2). */
	innerRingSlots?: number;
	/** 내부 원 반지름 배율 (기본 0.8). */
	innerRingRadiusMult?: number;
	/** 외부 원 반지름 배율 (기본 1.4). */
	outerRingRadiusMult?: number;
	/** 외부 원 회전 방향 (기본 -1 = 역회전). */
	outerRingDirection?: 1 | -1;
}

/** applyDamage 폴백 덕 타이핑용 (EnemyManager 부재 시의 원본 폴백 체인). */
export interface DamageableEnemy {
	takeDamage?: (amount: number) => void;
	damage?: ((amount: number) => void) | number;
	health?: number;
	hp?: number;
	destroy?: () => void;
}
