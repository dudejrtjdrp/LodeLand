// 증강(Augment) 시스템 — 라운드 10/25/40/55 진입 전 3택1 드래프트.
// 상점(골드 경제)과 축을 분리한 무료 선택지: 규칙 변경·빌드 정의·리스크 계약 담당.
// 등급(강철/황금/초월) 시퀀스는 런 시작 시 확률표로 결정되고,
// 초월은 "수치 2배"가 아니라 규칙을 바꾸는 효과만 담는다 (설계: docs/augment-ideas-movesword.md).

import Phaser from 'phaser';
import rawAugmentCatalog from '../data/augmentCatalog.json';
import MetaProgression from './MetaProgression';
import { GameEvents } from '../core/events';
import type GameScene from '../scenes/GameScene';
import type SwordOrbitSystem from './sword/SwordOrbitSystem';
import type ProgressionSystem from './ProgressionSystem';
import type { XPOrbSprite } from './ProgressionSystem';
import type PickupSystem from './PickupSystem';
import type { EnemySprite } from '../types/actors';
import type { OrbitSword, UltimateElement } from './sword/types';
import { UI, FONT, style, panel, insetPanel, selectFrame, ELEMENT_THEME, fixScreenSpaceInput } from '../ui/theme';
import { Tooltip, withKeywordFooter } from '../ui/tooltip';
import { awakeningById, describeSwordLines } from '../logic/swordInfo';
import { healWithinBudget } from '../logic/lifesteal';
import { playerHpGrowth } from '../logic/growth';
import { UNLOCK_CAPS } from '../logic/statCaps';

// 재사용 버퍼 — explodeAt은 처치마다, castStarfall은 주기마다 불린다.
// 매 호출 새 배열을 만들면 후반 라운드에서 초당 수십 개의 단명 배열이 된다.
const AUG_QUERY: EnemySprite[] = [];
const AUG_TARGETS: EnemySprite[] = [];
const AUG_STARFALL: EnemySprite[] = [];

// ---------------------------------------------------------------
// Catalog types
// ---------------------------------------------------------------

export type AugmentTierId = 'steel' | 'gold' | 'transcend';

export interface AugmentTierSpec {
	id: AugmentTierId;
	name: string;
	color: string;
	glow: string;
}

/** 효과 명세 — 모든 키는 선택적이며 AugmentSystem.applyAugment 가 해석한다. */
export interface AugmentEffects {
	damageMultAdd?: number;
	orbitSpeedMult?: number;
	orbitRadiusMult?: number;
	cooldownMult?: number;
	launchSpeedMult?: number;
	bonusHits?: number;
	cleaveAdd?: number;
	maxHpFlat?: number;
	regenAdd?: number;
	defenseAdd?: number;
	dodgeAdd?: number;
	thornsAdd?: number;
	critChanceAdd?: number;
	critDamageAdd?: number;
	luckAdd?: number;
	magnetMult?: number;
	xpGainAdd?: number;
	goldFlat?: number;
	goldPerRound?: number;
	interestPct?: number;
	interestCap?: number;
	swordDiscount?: number;
	freeFirstReroll?: boolean;
	levelsNow?: number;
	nextTierBoost?: boolean;
	damageTakenMult?: number;
	unlockSlots?: number;
	swordScaleMult?: number;
	perRoundDamageAdd?: number;
	reviveAdd?: number;
	echoLaunchChance?: number;
	resonanceScale?: number;
	ultimateCdMult?: number;
	lifestealPct?: number;
	executeThreshold?: number;
	executeElites?: boolean;
	executeExplodePct?: number;
	burnOnHit?: { dps: number; durationMs: number };
	chainOnHit?: { chance: number; pct: number };
	killExplode?: { chance: number; pct: number; radius: number };
	vault?: { rounds: number; gold: number; gems: number };
	starfall?: { intervalMs: number; pct: number; radius: number };
	returnDamagePct?: number;
	twinLaunchChance?: number;
	dualOrbit?: boolean;
	returnMagnetRadius?: number;
	riftOnHit?: { pct: number; radius: number; cooldownMs: number };
	trailRift?: { pct: number; radius: number; intervalMs: number };
	// ── 능동 스킬 시너지 (2026-09-01) — 값은 ActiveSkillSystem 이 읽는다 ──
	/** 활공 사냥의 피해 보너스에 더한다 (0.3 = +30%p) */
	diveDamageBonusAdd?: number;
	/** 활공 직후 짧은 치명타 창 */
	diveCritWindow?: { critChanceAdd: number; durationMs: number };
	/** 귀소 넉백/궤적 반경 배수 가산 (0.6 = 반경 +60%) */
	recallKnockbackRadiusAdd?: number;
	/** 귀환 궤적이 남기는 피해 (검 피해 대비 비율) */
	recallSweepDamagePct?: number;
	/** 귀소 무적 연장(ms) */
	recallInvulnAddMs?: number;
	/** 귀소 후 이동속도 상승 */
	recallSpeedBoost?: { mult: number; durationMs: number };
	/** 대시 쿨다운 배율 (0.7 = -30%) */
	dashCooldownMult?: number;
	/** 대시 잔상이 스치는 적에게 주는 피해 (검 피해 대비 비율) */
	dashGhostDamagePct?: number;
	/** 대시 거리 배수 가산 (0.5 = +50%) */
	dashDistanceAdd?: number;
	/** 대시 후 검 출격 피해 강화 창 */
	dashStrikeBonus?: { mult: number; windowMs: number };
	/** 수집 세트 조각: 같은 키의 조각을 전부 모으면 세트 보너스 발동. */
	setPiece?: string;
}

export type AugmentCondition = 'canLaunch' | 'hasElementPair' | 'slotsAvailable2' | 'notLastOffer' | 'hasSwordTrio';

export interface AugmentDefinition {
	id: string;
	name: string;
	icon: string;
	tier: AugmentTierId;
	category: string;
	desc: string;
	effects: AugmentEffects;
	conditions?: AugmentCondition[];
}

/**
 * 능동 스킬(활공/귀소/대시) 시너지 누적값.
 * ActiveSkillSystem 이 매 발동마다 이 객체를 읽는다 — 스킬 쪽에 상수를 박지 않는다.
 */
export interface SkillAugmentMods {
	diveDamageBonusAdd: number;
	diveCritWindow: { critChanceAdd: number; durationMs: number } | null;
	recallKnockbackRadiusAdd: number;
	recallSweepDamagePct: number;
	recallInvulnAddMs: number;
	recallSpeedBoost: { mult: number; durationMs: number } | null;
	dashCooldownMult: number;
	dashGhostDamagePct: number;
	dashDistanceAdd: number;
	dashStrikeBonus: { mult: number; windowMs: number } | null;
}

export function emptySkillMods(): SkillAugmentMods {
	return {
		diveDamageBonusAdd: 0,
		diveCritWindow: null,
		recallKnockbackRadiusAdd: 0,
		recallSweepDamagePct: 0,
		recallInvulnAddMs: 0,
		recallSpeedBoost: null,
		dashCooldownMult: 1,
		dashGhostDamagePct: 0,
		dashDistanceAdd: 0,
		dashStrikeBonus: null,
	};
}

export type AwakeningId = 'ruin' | 'gale' | 'aegis';

export interface AwakeningOption {
	id: AwakeningId;
	name: string;
	icon: string;
	desc: string;
}

export interface AugmentSetSpec {
	id: string;
	name: string;
	icon: string;
	announce: string;
	effects: AugmentEffects;
}

interface AugmentCatalog {
	offerRounds: number[];
	choicesPerOffer: number;
	rerollsPerRun: number;
	tiers: AugmentTierSpec[];
	tierWeightsBySlot: Array<Record<AugmentTierId, number>>;
	augments: AugmentDefinition[];
	/** 라운드 40: 일반 증강 대신 장착 검 1자루를 골라 각성시킨다. */
	awakening?: { round: number; title: string; options: AwakeningOption[] };
	sets?: AugmentSetSpec[];
}

const augmentCatalog = rawAugmentCatalog as unknown as AugmentCatalog;

const TIER_ORDER: AugmentTierId[] = ['steel', 'gold', 'transcend'];

/** RunSave 에 담기는 증강 스냅샷 (라운드 사이 시점). */
export interface AugmentSaveState {
	taken: string[];
	tierPlan: AugmentTierId[];
	slotIndex: number;
	rerollsLeft: number;
	nextTierBoost: boolean;
	/** 상점 드래프트권 구매 횟수 (v2 옵션 — 구세이브는 0으로 복원). */
	draftsBought?: number;

	damageTakenMult: number;
	freeFirstReroll: boolean;
	swordDiscount: number;
	goldPerRound: number;
	interestPct: number;
	interestCap: number;
	perRoundDamageAdd: number;
	swordScaleMult: number;
	lifestealPct: number;
	executeThreshold: number;
	executeElites: boolean;
	executeExplodePct: number;
	burnOnHit: { dps: number; durationMs: number } | null;
	chainOnHit: { chance: number; pct: number } | null;
	killExplode: { chance: number; pct: number; radius: number } | null;
	vault: { roundsLeft: number; gold: number; gems: number } | null;
	starfall: { intervalMs: number; pct: number; radius: number } | null;
	returnMagnetRadius: number;
	riftOnHit: { pct: number; radius: number; cooldownMs: number } | null;
	trailRift: { pct: number; radius: number; intervalMs: number } | null;
	ultimateCdMultTotal: number;

	/** 능동 스킬 시너지 (2026-09-01). 구세이브는 기본값으로 복원된다. */
	skillMods?: SkillAugmentMods;

	/** SwordOrbitSystem 쪽에 기록되는 확장 필드 스냅샷. */
	orbit: {
		echoLaunchChance: number;
		resonanceScale: number;
		returnDamagePct: number;
		twinLaunchChance: number;
		dualOrbit: boolean;
		awakenings: Record<string, string>;
	};
}

export interface AugmentSystemOptions {
	swordOrbit?: SwordOrbitSystem | null;
	progression?: ProgressionSystem | null;
	pickupSystem?: PickupSystem | null;
}

interface EnemyDiedPayload {
	enemy?: EnemySprite;
	x?: number;
	y?: number;
}

export default class AugmentSystem {
	scene: GameScene;
	swordOrbit: SwordOrbitSystem | null;
	progression: ProgressionSystem | null;
	pickupSystem: PickupSystem | null;

	isOpen: boolean;
	taken: Set<string>;
	tierPlan: AugmentTierId[];
	slotIndex: number;
	rerollsLeft: number;
	nextTierBoost: boolean;
	round: number;
	onCloseCallback: (() => void) | null;
	/** 유료 드래프트(상점 구매) 모드 — 무료 시퀀스(slotIndex/tierPlan)를 소모하지 않는다. */
	purchasedMode: boolean;
	/** 이번 런에서 구매한 드래프트권 수 (가격 상승 지수). */
	draftsBought: number;
	/** 현재 열린 드래프트의 등급 (리롤이 같은 등급을 유지하기 위함). */
	activeTier: AugmentTierId | null;

	// ---- 런타임 효과 상태 (다른 시스템이 읽는 값 포함) ----
	/** GameScene.applyPlayerDamage 가 곱한다. */
	damageTakenMult: number;
	/** ShopSystem 이 읽는다. */
	freeFirstReroll: boolean;
	swordDiscount: number;

	goldPerRound: number;
	interestPct: number;
	interestCap: number;
	perRoundDamageAdd: number;
	swordScaleMult: number;
	lifestealPct: number;
	executeThreshold: number;
	executeElites: boolean;
	executeExplodePct: number;
	burnOnHit: { dps: number; durationMs: number } | null;
	chainOnHit: { chance: number; pct: number } | null;
	killExplode: { chance: number; pct: number; radius: number } | null;
	vault: { roundsLeft: number; gold: number; gems: number } | null;
	starfall: { intervalMs: number; pct: number; radius: number } | null;
	starfallTimer: number;
	returnMagnetRadius: number;
	riftOnHit: { pct: number; radius: number; cooldownMs: number } | null;
	riftCooldownUntil: number;
	trailRift: { pct: number; radius: number; intervalMs: number } | null;
	/** 누적 필살기 쿨다운 배율 (세이브 복원용 — 적용 자체는 ultimateIntervals에 즉시 반영됨). */
	ultimateCdMultTotal: number;
	/** 능동 스킬 시너지 누적 (ActiveSkillSystem 이 읽는다). */
	skillMods: SkillAugmentMods;

	uiObjects: Phaser.GameObjects.GameObject[];
	/** 증강 카드 호버 툴팁 (공용 ui/tooltip.ts) */
	tooltip: Tooltip | null = null;
	keyHandler: ((event: KeyboardEvent) => void) | null;
	onEnemyDied: (payload: EnemyDiedPayload) => void;

	constructor(scene: GameScene, options: AugmentSystemOptions = {}) {
		this.scene = scene;
		this.swordOrbit = options.swordOrbit ?? null;
		this.progression = options.progression ?? null;
		this.pickupSystem = options.pickupSystem ?? null;

		this.isOpen = false;
		this.taken = new Set();
		this.tierPlan = this.rollTierPlan();
		this.slotIndex = 0;
		this.rerollsLeft = augmentCatalog.rerollsPerRun;
		this.nextTierBoost = false;
		this.round = 0;
		this.onCloseCallback = null;
		this.purchasedMode = false;
		this.draftsBought = 0;
		this.activeTier = null;

		this.damageTakenMult = 1;
		this.freeFirstReroll = false;
		this.swordDiscount = 0;
		this.goldPerRound = 0;
		this.interestPct = 0;
		this.interestCap = 0;
		this.perRoundDamageAdd = 0;
		this.swordScaleMult = 1;
		this.lifestealPct = 0;
		this.executeThreshold = 0;
		this.executeElites = false;
		this.executeExplodePct = 0;
		this.burnOnHit = null;
		this.chainOnHit = null;
		this.killExplode = null;
		this.vault = null;
		this.starfall = null;
		this.starfallTimer = 0;
		this.returnMagnetRadius = 0;
		this.riftOnHit = null;
		this.riftCooldownUntil = 0;
		this.trailRift = null;
		this.ultimateCdMultTotal = 1;
		this.skillMods = emptySkillMods();

		this.uiObjects = [];
		this.keyHandler = null;

		this.onEnemyDied = (payload) => this.handleEnemyDied(payload);
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	// ---------------------------------------------------------------
	// 등급 시퀀스: 런 시작 시 슬롯별 확률표로 결정 (후반일수록 하한 상승)
	// ---------------------------------------------------------------

	rollTierFromWeights(weights: Record<AugmentTierId, number>): AugmentTierId {
		const total = TIER_ORDER.reduce((sum, tier) => sum + (weights[tier] ?? 0), 0);
		let roll = Math.random() * total;
		for (const tier of TIER_ORDER) {
			roll -= weights[tier] ?? 0;
			if (roll <= 0) {
				return tier;
			}
		}
		return 'gold';
	}

	rollTierPlan(): AugmentTierId[] {
		return augmentCatalog.tierWeightsBySlot.map((weights) => this.rollTierFromWeights(weights));
	}

	/** 유료 드래프트 등급: 라운드가 깊을수록 무료 시퀀스의 후반 슬롯 확률표를 쓴다. */
	rollPurchasedTier(round: number): AugmentTierId {
		const offerRounds = augmentCatalog.offerRounds;
		let index = 0;
		while (index < offerRounds.length - 1 && round >= offerRounds[index + 1]) {
			index += 1;
		}
		const weights = augmentCatalog.tierWeightsBySlot[Math.min(index, augmentCatalog.tierWeightsBySlot.length - 1)];
		return this.rollTierFromWeights(weights);
	}

	/** 상점 드래프트권 가격 — 라운드에 비례, 구매할수록 1.5배씩 상승. */
	draftPrice(round: number): number {
		return Math.ceil((60 + round * 3) * Math.pow(1.5, this.draftsBought));
	}

	getTierSpec(id: AugmentTierId): AugmentTierSpec {
		return augmentCatalog.tiers.find((tier) => tier.id === id) ?? augmentCatalog.tiers[0];
	}

	boostTier(tier: AugmentTierId): AugmentTierId {
		const index = TIER_ORDER.indexOf(tier);
		return TIER_ORDER[Math.min(TIER_ORDER.length - 1, index + 1)];
	}

	// ---------------------------------------------------------------
	// 제공 판단 & 후보 롤
	// ---------------------------------------------------------------

	/** `round` 진입 직전(= round-1 완료 시점)에 증강을 제공해야 하는가. */
	shouldOffer(round: number): boolean {
		return this.slotIndex < augmentCatalog.offerRounds.length
			&& augmentCatalog.offerRounds[this.slotIndex] === round
			&& !this.scene.player?.isDead;
	}

	currentTier(): AugmentTierId {
		let tier = this.tierPlan[this.slotIndex] ?? 'gold';
		if (this.nextTierBoost) {
			tier = this.boostTier(tier);
		}
		return tier;
	}

	checkCondition(condition: AugmentCondition): boolean {
		switch (condition) {
			case 'canLaunch':
				return !(this.swordOrbit?.noLaunch ?? false);
			case 'hasElementPair': {
				const counts = this.swordOrbit?.getElementCounts() ?? {};
				return Object.values(counts).some((count) => count >= 2);
			}
			case 'slotsAvailable2':
				return ((this.swordOrbit?.maxSwords ?? 0) - (this.swordOrbit?.unlockedSlots ?? 0)) >= 2;
			case 'notLastOffer':
				return this.slotIndex < augmentCatalog.offerRounds.length - 1;
			case 'hasSwordTrio':
				return (this.swordOrbit?.swords.length ?? 0) >= 3;
			default:
				return true;
		}
	}

	isAvailable(augment: AugmentDefinition): boolean {
		if (this.taken.has(augment.id)) {
			return false;
		}
		return (augment.conditions ?? []).every((condition) => this.checkCondition(condition));
	}

	poolForTier(tier: AugmentTierId): AugmentDefinition[] {
		return augmentCatalog.augments.filter((augment) => augment.tier === tier && this.isAvailable(augment));
	}

	// 3장 롤: 같은 카테고리 3장 방지(가능하면), 풀 부족 시 한 단계 아래 등급에서 보충.
	rollChoices(tier: AugmentTierId): AugmentDefinition[] {
		const pool = [...this.poolForTier(tier)];
		Phaser.Utils.Array.Shuffle(pool);

		const picked: AugmentDefinition[] = [];
		for (const candidate of pool) {
			if (picked.length >= augmentCatalog.choicesPerOffer) {
				break;
			}
			const sameCategory = picked.filter((entry) => entry.category === candidate.category).length;
			if (sameCategory >= 2) {
				continue;
			}
			picked.push(candidate);
		}

		// 카테고리 제약 때문에 못 채웠으면 제약 없이 보충
		for (const candidate of pool) {
			if (picked.length >= augmentCatalog.choicesPerOffer) {
				break;
			}
			if (!picked.includes(candidate)) {
				picked.push(candidate);
			}
		}

		// 그래도 부족하면 아래 등급에서 보충 (초월 풀 고갈 대비)
		let fallbackIndex = TIER_ORDER.indexOf(tier) - 1;
		while (picked.length < augmentCatalog.choicesPerOffer && fallbackIndex >= 0) {
			const fallbackPool = this.poolForTier(TIER_ORDER[fallbackIndex]);
			Phaser.Utils.Array.Shuffle(fallbackPool);
			for (const candidate of fallbackPool) {
				if (picked.length >= augmentCatalog.choicesPerOffer) {
					break;
				}
				if (!picked.includes(candidate)) {
					picked.push(candidate);
				}
			}
			fallbackIndex -= 1;
		}

		return picked;
	}

	// ---------------------------------------------------------------
	// 열기 / 닫기
	// ---------------------------------------------------------------

	open(round: number, onClose: (() => void) | null = null): void {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.round = round;
		this.onCloseCallback = onClose;

		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.soundSystem?.play('levelup');

		// 라운드 40: 일반 증강 대신 '검 각성' (장착 검 1자루 선택 → 각성 3택1)
		const awakening = augmentCatalog.awakening;
		if (awakening && round === awakening.round && (this.swordOrbit?.swords.length ?? 0) > 0) {
			this.buildAwakeningSwordUi();
			return;
		}

		const tier = this.currentTier();
		this.nextTierBoost = false;
		this.activeTier = tier;
		this.buildUi(this.rollChoices(tier), tier);
	}

	/** 상점에서 골드로 구매한 드래프트 — 무료 시퀀스(slotIndex)와 별개로 열린다. */
	openPurchased(round: number, onClose: (() => void) | null = null): void {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.purchasedMode = true;
		this.round = round;
		this.onCloseCallback = onClose;

		// 상점이 이미 물리를 멈춰둔 상태지만, 단독 호출에도 안전하도록 명시적으로 pause
		this.scene.physics.pause();
		this.scene.soundSystem?.play('levelup');

		const tier = this.rollPurchasedTier(round);
		this.activeTier = tier;
		this.buildUi(this.rollChoices(tier), tier);
	}

	close(): void {
		this.destroyUi();
		this.isOpen = false;
		this.purchasedMode = false;
		this.activeTier = null;

		const callback = this.onCloseCallback;
		this.onCloseCallback = null;

		if (callback) {
			// 보통 상점으로 이어진다 — physics 재개는 상점이 닫힐 때 처리된다.
			callback();
			return;
		}

		// 미뤄둔 레벨업 선택(조기 수련 등)이 있으면 이어서 연다.
		if (!this.scene.levelUpSystem?.isOpen && (this.scene.levelUpSystem?.pendingChoices ?? 0) > 0) {
			this.scene.levelUpSystem!.open();
			return;
		}

		if (!this.scene.shopSystem?.isOpen && !this.scene.levelUpSystem?.isOpen
			&& !this.scene.isPaused && !this.scene.player?.isDead) {
			this.scene.physics.resume();
		}
	}

	selectAugment(augment: AugmentDefinition): void {
		if (!this.isOpen) {
			return;
		}

		this.scene.soundSystem?.play('click');
		this.taken.add(augment.id);
		this.applyAugment(augment);
		if (!this.purchasedMode) {
			this.slotIndex += 1; // 무료 시퀀스만 진행 — 구매 드래프트는 슬롯을 소모하지 않는다
		}
		this.scene.waveSystem?.announce?.(`${augment.icon} ${augment.name} 획득!`, this.getTierSpec(augment.tier).color);
		this.close();
	}

	reroll(): void {
		if (!this.isOpen || this.rerollsLeft <= 0) {
			return;
		}

		this.rerollsLeft -= 1;
		this.scene.soundSystem?.play('click', { volume: 0.5 });

		const tier = this.activeTier ?? this.tierPlan[this.slotIndex] ?? 'gold';
		this.destroyUi();
		this.buildUi(this.rollChoices(tier), tier);
	}

	// ---------------------------------------------------------------
	// 효과 적용
	// ---------------------------------------------------------------

	applyAugment(augment: AugmentDefinition): void {
		const effects = augment.effects ?? {};
		const player = this.scene.player;
		const so = this.swordOrbit;

		if (effects.damageMultAdd && so) {
			so.damageMultiplier += effects.damageMultAdd;
			this.recalcAllSwords();
		}
		if (effects.orbitSpeedMult && so) {
			so.orbitSpeed *= 1 + effects.orbitSpeedMult;
		}
		if (effects.orbitRadiusMult && so) {
			so.radius *= 1 + effects.orbitRadiusMult;
		}
		if (effects.cooldownMult) {
			so?.applyCooldownMultiplier?.(effects.cooldownMult);
		}
		if (effects.launchSpeedMult) {
			so?.applyLaunchSpeedMultiplier?.(1 + effects.launchSpeedMult);
		}
		if (effects.bonusHits) {
			so?.addBonusHits?.(effects.bonusHits);
		}
		if (effects.cleaveAdd) {
			so?.addCleave?.(effects.cleaveAdd);
		}

		if (effects.maxHpFlat && player) {
			// 고정 +N 은 현재 레벨의 체력 성장 배율로 환산 (logic/growth.ts)
			const scaledHp = Math.round(effects.maxHpFlat * playerHpGrowth(this.progression?.level ?? 1));
			player.maxHp += scaledHp;
			player.hp = Math.min(player.maxHp, player.hp + scaledHp);
		}
		if (effects.regenAdd && player) {
			player.hpRegen = (player.hpRegen ?? 0) + effects.regenAdd;
		}
		if (effects.defenseAdd && player) {
			player.defense = Math.min(60, (player.defense ?? 0) + effects.defenseAdd);
		}
		if (effects.dodgeAdd && player) {
			player.dodgeChance = Math.min(0.4, (player.dodgeChance ?? 0) + effects.dodgeAdd);
		}
		if (effects.thornsAdd && player) {
			player.thorns = (player.thorns ?? 0) + effects.thornsAdd;
		}
		if (effects.critChanceAdd && player) {
			player.critChance = (player.critChance ?? 0) + effects.critChanceAdd;
		}
		if (effects.critDamageAdd && player) {
			player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + effects.critDamageAdd;
		}
		if (effects.luckAdd && player) {
			player.luck = (player.luck ?? 0) + effects.luckAdd;
		}
		if (effects.magnetMult && this.progression) {
			this.progression.magnetRadius *= 1 + effects.magnetMult;
		}
		if (effects.xpGainAdd && this.progression) {
			this.progression.xpMultiplier = (this.progression.xpMultiplier ?? 1) + effects.xpGainAdd;
		}

		if (effects.goldFlat) {
			this.pickupSystem?.addGold?.(effects.goldFlat);
		}
		if (effects.goldPerRound) {
			this.goldPerRound += effects.goldPerRound;
		}
		if (effects.interestPct) {
			this.interestPct += effects.interestPct;
			this.interestCap += effects.interestCap ?? 0;
		}
		if (effects.swordDiscount) {
			this.swordDiscount = Math.min(0.5, this.swordDiscount + effects.swordDiscount);
		}
		if (effects.freeFirstReroll) {
			this.freeFirstReroll = true;
		}

		if (effects.levelsNow && this.progression) {
			for (let i = 0; i < effects.levelsNow; i += 1) {
				this.progression.levelUp();
			}
		}
		if (effects.nextTierBoost) {
			this.nextTierBoost = true;
		}
		if (effects.damageTakenMult) {
			this.damageTakenMult *= effects.damageTakenMult;
		}
		if (effects.unlockSlots && so) {
			for (let i = 0; i < effects.unlockSlots; i += 1) {
				so.unlockSlot();
			}
		}
		if (effects.swordScaleMult) {
			this.swordScaleMult *= effects.swordScaleMult;
		}
		if (effects.perRoundDamageAdd) {
			this.perRoundDamageAdd += effects.perRoundDamageAdd;
		}
		if (effects.reviveAdd) {
			this.scene.revivalsLeft += effects.reviveAdd;
		}
		if (effects.echoLaunchChance && so) {
			so.echoLaunchChance = Math.min(0.6, (so.echoLaunchChance ?? 0) + effects.echoLaunchChance);
		}
		if (effects.resonanceScale && so) {
			so.resonanceScale = Math.max(so.resonanceScale, effects.resonanceScale);
		}
		if (effects.ultimateCdMult && so) {
			this.ultimateCdMultTotal *= effects.ultimateCdMult;
			for (const element of Object.keys(so.ultimateIntervals) as UltimateElement[]) {
				so.ultimateIntervals[element] *= effects.ultimateCdMult;
			}
		}

		if (effects.lifestealPct) {
			this.lifestealPct += effects.lifestealPct;
		}
		if (effects.executeThreshold) {
			this.executeThreshold = Math.max(this.executeThreshold, effects.executeThreshold);
		}
		if (effects.executeElites) {
			this.executeElites = true;
		}
		if (effects.executeExplodePct) {
			this.executeExplodePct = Math.max(this.executeExplodePct, effects.executeExplodePct);
		}
		if (effects.burnOnHit) {
			this.burnOnHit = this.burnOnHit
				? { dps: this.burnOnHit.dps + effects.burnOnHit.dps, durationMs: Math.max(this.burnOnHit.durationMs, effects.burnOnHit.durationMs) }
				: { ...effects.burnOnHit };
		}
		if (effects.chainOnHit) {
			this.chainOnHit = { ...effects.chainOnHit };
		}
		if (effects.killExplode) {
			this.killExplode = { ...effects.killExplode };
		}
		if (effects.vault) {
			this.vault = { roundsLeft: effects.vault.rounds, gold: effects.vault.gold, gems: effects.vault.gems };
		}
		if (effects.starfall) {
			this.starfall = { ...effects.starfall };
			this.starfallTimer = 0;
		}
		if (effects.returnDamagePct && so) {
			so.returnDamagePct = Math.max(so.returnDamagePct, effects.returnDamagePct);
		}
		if (effects.twinLaunchChance && so) {
			so.twinLaunchChance = Math.min(0.5, so.twinLaunchChance + effects.twinLaunchChance);
		}
		if (effects.dualOrbit && so) {
			so.dualOrbit = true;
		}
		if (effects.returnMagnetRadius) {
			this.returnMagnetRadius = Math.max(this.returnMagnetRadius, effects.returnMagnetRadius);
		}
		if (effects.riftOnHit) {
			this.riftOnHit = { ...effects.riftOnHit };
		}
		if (effects.trailRift) {
			this.trailRift = { ...effects.trailRift };
		}

		// ── 능동 스킬 시너지 (활공/귀소/대시) ──
		// 수치는 카탈로그에만 있고, 여기서는 누적만 한다. 소비는 ActiveSkillSystem.
		const mods = this.skillMods;
		if (effects.diveDamageBonusAdd) {
			mods.diveDamageBonusAdd += effects.diveDamageBonusAdd;
		}
		if (effects.diveCritWindow) {
			mods.diveCritWindow = mods.diveCritWindow
				? {
					critChanceAdd: mods.diveCritWindow.critChanceAdd + effects.diveCritWindow.critChanceAdd,
					durationMs: Math.max(mods.diveCritWindow.durationMs, effects.diveCritWindow.durationMs),
				}
				: { ...effects.diveCritWindow };
		}
		if (effects.recallKnockbackRadiusAdd) {
			mods.recallKnockbackRadiusAdd += effects.recallKnockbackRadiusAdd;
		}
		if (effects.recallSweepDamagePct) {
			mods.recallSweepDamagePct += effects.recallSweepDamagePct;
		}
		if (effects.recallInvulnAddMs) {
			mods.recallInvulnAddMs += effects.recallInvulnAddMs;
		}
		if (effects.recallSpeedBoost) {
			mods.recallSpeedBoost = { ...effects.recallSpeedBoost };
		}
		if (effects.dashCooldownMult) {
			mods.dashCooldownMult *= effects.dashCooldownMult;
		}
		if (effects.dashGhostDamagePct) {
			mods.dashGhostDamagePct += effects.dashGhostDamagePct;
		}
		if (effects.dashDistanceAdd) {
			mods.dashDistanceAdd += effects.dashDistanceAdd;
		}
		if (effects.dashStrikeBonus) {
			mods.dashStrikeBonus = { ...effects.dashStrikeBonus };
		}

		// 수집 세트: 이 조각으로 세트가 완성되면 보너스 발동 (빵 샌드위치 문법)
		if (effects.setPiece) {
			this.checkSetCompletion(effects.setPiece);
		}
	}

	checkSetCompletion(setId: string): void {
		const setSpec = augmentCatalog.sets?.find((entry) => entry.id === setId);
		if (!setSpec || this.taken.has(`set:${setId}`)) {
			return;
		}

		const pieces = augmentCatalog.augments.filter((augment) => augment.effects.setPiece === setId);
		if (pieces.length === 0 || !pieces.every((piece) => this.taken.has(piece.id))) {
			return;
		}

		this.taken.add(`set:${setId}`);
		this.applyAugment({
			id: `set:${setId}`,
			name: setSpec.name,
			icon: setSpec.icon,
			tier: 'transcend',
			category: 'set',
			desc: '',
			effects: setSpec.effects,
		});
		this.scene.cameras.main.flash(600, 251, 191, 36);
		this.scene.soundSystem?.play('evolve');
		this.scene.waveSystem?.announce?.(setSpec.announce, '#fbbf24');
	}

	/** 세트 조각 수집 진행도 (완성 보너스 제외한 taken 조각 수, 전체 조각 수). */
	/** 이번 런에서 획득한 증강 정의 목록 (스탯 패널 노출용). */
	takenAugments(): AugmentDefinition[] {
		return augmentCatalog.augments.filter((augment) => this.taken.has(augment.id));
	}

	getSetProgress(setId: string): { taken: number; total: number } {
		const pieces = augmentCatalog.augments.filter((augment) => augment.effects.setPiece === setId);
		return {
			taken: pieces.filter((piece) => this.taken.has(piece.id)).length,
			total: pieces.length,
		};
	}

	recalcAllSwords(): void {
		const so = this.swordOrbit;
		if (!so) {
			return;
		}
		for (const sword of so.swords) {
			so.recalculateSwordStats(sword);
		}
	}

	// ---------------------------------------------------------------
	// 세이브 (RunSave 가 라운드 사이 시점에 호출)
	// ---------------------------------------------------------------

	captureState(): AugmentSaveState {
		const so = this.swordOrbit;
		return {
			taken: [...this.taken],
			tierPlan: [...this.tierPlan],
			slotIndex: this.slotIndex,
			rerollsLeft: this.rerollsLeft,
			nextTierBoost: this.nextTierBoost,
			draftsBought: this.draftsBought,

			damageTakenMult: this.damageTakenMult,
			freeFirstReroll: this.freeFirstReroll,
			swordDiscount: this.swordDiscount,
			goldPerRound: this.goldPerRound,
			interestPct: this.interestPct,
			interestCap: this.interestCap,
			perRoundDamageAdd: this.perRoundDamageAdd,
			swordScaleMult: this.swordScaleMult,
			lifestealPct: this.lifestealPct,
			executeThreshold: this.executeThreshold,
			executeElites: this.executeElites,
			executeExplodePct: this.executeExplodePct,
			burnOnHit: this.burnOnHit ? { ...this.burnOnHit } : null,
			chainOnHit: this.chainOnHit ? { ...this.chainOnHit } : null,
			killExplode: this.killExplode ? { ...this.killExplode } : null,
			vault: this.vault ? { ...this.vault } : null,
			starfall: this.starfall ? { ...this.starfall } : null,
			returnMagnetRadius: this.returnMagnetRadius,
			riftOnHit: this.riftOnHit ? { ...this.riftOnHit } : null,
			trailRift: this.trailRift ? { ...this.trailRift } : null,
			ultimateCdMultTotal: this.ultimateCdMultTotal,
			skillMods: {
				...this.skillMods,
				diveCritWindow: this.skillMods.diveCritWindow ? { ...this.skillMods.diveCritWindow } : null,
				recallSpeedBoost: this.skillMods.recallSpeedBoost ? { ...this.skillMods.recallSpeedBoost } : null,
				dashStrikeBonus: this.skillMods.dashStrikeBonus ? { ...this.skillMods.dashStrikeBonus } : null,
			},

			orbit: {
				echoLaunchChance: so?.echoLaunchChance ?? 0,
				resonanceScale: so?.resonanceScale ?? 1.5,
				returnDamagePct: so?.returnDamagePct ?? 0,
				twinLaunchChance: so?.twinLaunchChance ?? 0,
				dualOrbit: so?.dualOrbit ?? false,
				awakenings: { ...(so?.awakenings ?? {}) },
			},
		};
	}

	/** 이어하기 복원 — orbit.rebuildLoadout 전에 호출해야 각성이 스탯 재계산에 반영된다. */
	restoreState(state: AugmentSaveState): void {
		this.taken = new Set(state.taken ?? []);
		this.tierPlan = state.tierPlan?.length ? [...state.tierPlan] : this.tierPlan;
		this.slotIndex = state.slotIndex ?? 0;
		this.rerollsLeft = state.rerollsLeft ?? this.rerollsLeft;
		this.nextTierBoost = state.nextTierBoost ?? false;
		this.draftsBought = state.draftsBought ?? 0;

		this.damageTakenMult = state.damageTakenMult ?? 1;
		this.freeFirstReroll = state.freeFirstReroll ?? false;
		this.swordDiscount = state.swordDiscount ?? 0;
		this.goldPerRound = state.goldPerRound ?? 0;
		this.interestPct = state.interestPct ?? 0;
		this.interestCap = state.interestCap ?? 0;
		this.perRoundDamageAdd = state.perRoundDamageAdd ?? 0;
		this.swordScaleMult = state.swordScaleMult ?? 1;
		this.lifestealPct = state.lifestealPct ?? 0;
		this.executeThreshold = state.executeThreshold ?? 0;
		this.executeElites = state.executeElites ?? false;
		this.executeExplodePct = state.executeExplodePct ?? 0;
		this.burnOnHit = state.burnOnHit ? { ...state.burnOnHit } : null;
		this.chainOnHit = state.chainOnHit ? { ...state.chainOnHit } : null;
		this.killExplode = state.killExplode ? { ...state.killExplode } : null;
		this.vault = state.vault ? { ...state.vault } : null;
		this.starfall = state.starfall ? { ...state.starfall } : null;
		this.starfallTimer = 0;
		this.returnMagnetRadius = state.returnMagnetRadius ?? 0;
		this.riftOnHit = state.riftOnHit ? { ...state.riftOnHit } : null;
		this.riftCooldownUntil = 0;
		this.trailRift = state.trailRift ? { ...state.trailRift } : null;
		this.ultimateCdMultTotal = state.ultimateCdMultTotal ?? 1;
		// 구세이브(스킬 시너지 이전)는 기본값으로 복원한다
		this.skillMods = { ...emptySkillMods(), ...(state.skillMods ?? {}) };

		const so = this.swordOrbit;
		if (so) {
			so.echoLaunchChance = state.orbit?.echoLaunchChance ?? 0;
			so.resonanceScale = state.orbit?.resonanceScale ?? 1.5;
			so.returnDamagePct = state.orbit?.returnDamagePct ?? 0;
			so.twinLaunchChance = state.orbit?.twinLaunchChance ?? 0;
			so.dualOrbit = state.orbit?.dualOrbit ?? false;
			so.awakenings = { ...(state.orbit?.awakenings ?? {}) };

			// 필살기 쿨다운 배율 재적용 (ultimateIntervals는 씬 생성 시 기본값으로 초기화됨)
			if (this.ultimateCdMultTotal !== 1) {
				for (const element of Object.keys(so.ultimateIntervals) as UltimateElement[]) {
					so.ultimateIntervals[element] *= this.ultimateCdMultTotal;
				}
			}
		}
	}

	// ---------------------------------------------------------------
	// 런타임 훅
	// ---------------------------------------------------------------

	/** 라운드 완료 시(상점/증강 열리기 전) 호출 — 라운드 단위 수입·누적 효과. */
	onRoundComplete(_round: number): void {
		if (this.goldPerRound > 0) {
			this.pickupSystem?.addGold?.(this.goldPerRound);
		}

		if (this.interestPct > 0 && this.pickupSystem) {
			const interest = Math.min(this.interestCap || Number.POSITIVE_INFINITY, Math.floor(this.pickupSystem.runGold * this.interestPct));
			if (interest > 0) {
				this.pickupSystem.addGold(interest);
				this.scene.waveSystem?.announce?.(`📈 이자 +${interest} 골드`, '#fbbf24');
			}
		}

		if (this.perRoundDamageAdd > 0 && this.swordOrbit) {
			this.swordOrbit.damageMultiplier += this.perRoundDamageAdd;
			this.recalcAllSwords();
		}

		if (this.vault) {
			this.vault.roundsLeft -= 1;
			if (this.vault.roundsLeft <= 0) {
				const { gold, gems } = this.vault;
				this.vault = null;
				this.pickupSystem?.addGold?.(gold);
				if (gems > 0) {
					MetaProgression.addGuaranteeCoin(gems);
				}
				this.scene.cameras.main.flash(500, 251, 191, 36);
				this.scene.soundSystem?.play('chest');
				this.scene.waveSystem?.announce?.(`🗝️ 여명의 금고 개방! 골드 +${gold}${gems > 0 ? ` · 💎 +${gems}` : ''}`, '#fbbf24');
			} else {
				this.scene.waveSystem?.announce?.(`🗝️ 금고 개방까지 ${this.vault.roundsLeft}라운드`, '#9ca3af');
			}
		}
	}

	/** hitResolution 에서 검 명중마다 호출되는 전역 온-히트 훅. */
	onSwordHit(sword: OrbitSword | null, enemy: EnemySprite, damage: number, _isCrit: boolean): void {
		const so = this.swordOrbit;
		const player = this.scene.player;

		if (this.burnOnHit) {
			this.scene.enemyManager?.applyDot?.(enemy, this.burnOnHit.dps, this.burnOnHit.durationMs, 0xf97316);
		}

		// 스킬 트리 [명중 시 연쇄] — 증강 연쇄와 별개로 굴린다
		const treeChain = this.scene.skillTree?.mods.chainOnHit;
		if (treeChain && so && Math.random() < treeChain.chance) {
			const target = so.findNearestEnemy(enemy.x, enemy.y, so.enemyGroup, 200, new Set([enemy]));
			if (target) {
				so.applyDamage(target, Math.max(1, Math.round(damage * treeChain.pct)), false, sword ? so.getDamageInfo(sword) : null);
				so.playChainEffect(enemy, target);
			}
		}

		if (this.chainOnHit && so && Math.random() < this.chainOnHit.chance) {
			const target = so.findNearestEnemy(enemy.x, enemy.y, so.enemyGroup, 200, new Set([enemy]));
			if (target) {
				so.applyDamage(target, Math.max(1, Math.round(damage * this.chainOnHit.pct)), false, sword ? so.getDamageInfo(sword) : null);
				so.playChainEffect(enemy, target);
			}
		}

		// 칼자국: 명중 지점에 균열을 새기고 잠시 후 폭발 (전역 쿨다운)
		if (this.riftOnHit) {
			const now = this.scene.time.now;
			if (now >= this.riftCooldownUntil) {
				this.riftCooldownUntil = now + this.riftOnHit.cooldownMs;
				this.carveRift(enemy.x, enemy.y, this.avgSwordDamage() * this.riftOnHit.pct, this.riftOnHit.radius, 0xf59e0b);
			}
		}

		// 증강 흡혈 + BLOODTHIRST 해금 스탯(레벨업 경로) + 피 세트 합산.
		// 합산 상한 = UNLOCK_CAPS.lifesteal × 2, 실제 회복은 초당 예산(logic/lifesteal.ts)이 자른다
		// — 후반 DPS 에 % 를 곱해 매 프레임 만피가 되던 것을 막는다 (2026-09-04).
		const lifesteal = Math.min(UNLOCK_CAPS.lifesteal * 2, this.lifestealPct + (player?.lifesteal ?? 0));
		if (lifesteal > 0 && player && !player.isDead) {
			healWithinBudget(player, damage * lifesteal, this.scene.time.now);
		}

		const treeMods = this.scene.skillTree?.mods;
		const executeThreshold = Math.max(this.executeThreshold, treeMods?.executeThreshold ?? 0);
		if (executeThreshold > 0 && so && so.isValidEnemy(enemy) && enemy.hp > 0
			&& enemy.hp / enemy.maxHp <= executeThreshold
			&& !enemy.catalog?.isBoss && !enemy.catalog?.isMiniboss && !enemy.catalog?.isReaper
			&& (this.executeElites || !enemy.catalog?.isElite)) {
			const x = enemy.x;
			const y = enemy.y;
			so.applyDamage(enemy, enemy.hp + 1, true, { ignoreResist: true });
			this.scene.visualEffects?.showDamageText?.(x, y - 40, '처형!', true);
			const explodePct = Math.max(this.executeExplodePct, treeMods?.executeExplode ?? 0);
			if (explodePct > 0) {
				this.explodeAt(x, y, this.avgSwordDamage() * explodePct, 140, 0xe879f9);
			}
		}
	}

	handleEnemyDied(payload: EnemyDiedPayload): void {
		if (this.scene.isGameOver || !this.killExplode) {
			return;
		}

		const x = payload?.x ?? payload?.enemy?.x;
		const y = payload?.y ?? payload?.enemy?.y;
		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		if (Math.random() < this.killExplode.chance) {
			this.explodeAt(x, y, this.avgSwordDamage() * this.killExplode.pct, this.killExplode.radius, 0xf97316);
		}
	}

	avgSwordDamage(): number {
		const so = this.swordOrbit;
		if (!so || so.swords.length === 0) {
			return 30;
		}
		const total = so.swords.reduce((sum, sword) => sum + (sword.damage ?? 20), 0);
		return (total / so.swords.length) * (so.damageMultiplier ?? 1);
	}

	explodeAt(x: number, y: number, damage: number, radius: number, color: number): void {
		const so = this.swordOrbit;
		if (!so) {
			return;
		}

		const amount = Math.max(1, Math.round(damage));
		// 적 전수 순회 대신 공간 그리드로 반경 후보만 훑는다. explodeAt은 처치마다
		// (killExplode) 그리고 검로의 잔화·별똥별로 초당 수십 회 호출된다.
		const radiusSquared = radius * radius;
		const manager = this.scene.enemyManager;
		const candidates = manager?.queryRadius
			? manager.queryRadius(x, y, radius, AUG_QUERY)
			: so.getEnemyChildren(so.enemyGroup);
		// 피해 적용이 연쇄 사망을 부를 수 있으므로 대상을 먼저 확정한다.
		AUG_TARGETS.length = 0;
		for (const enemy of candidates) {
			if (!so.isValidEnemy(enemy)) {
				continue;
			}
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy <= radiusSquared) {
				AUG_TARGETS.push(enemy);
			}
		}
		for (const enemy of AUG_TARGETS) {
			so.applyDamage(enemy, amount, false, { damageType: 'magic', pen: 0 });
		}

		// 일회용 circle + 트윈 → 공유 FX 레이어 (movesword-fx-layer 규약)
		this.scene.visualEffects?.fxDot(x, y, {
			r: radius * 0.35, color, alpha: 0.35, scale1: 1 / 0.35, dur: 260,
		});
	}

	/** 균열: 경고 링을 그리고 잠시 후 폭발 (칼자국/검로의 잔화 공용). */
	carveRift(x: number, y: number, damage: number, radius: number, color: number): void {
		// 경고 링도 FX 레이어로 — 예전엔 검이 비행하는 내내 intervalMs마다
		// circle 1개 + delayedCall 1개가 새로 생겼다. hold로 700ms 동안 유지시킨다.
		this.scene.visualEffects?.fxRing(x, y, {
			r0: radius, r1: radius, w: 2, color, alpha: 0.7, dur: 700, ease: 'lin', hold: 0.8,
		});

		this.scene.time.delayedCall(700, () => {
			if (this.scene.isGameOver) {
				return;
			}
			this.explodeAt(x, y, damage, radius, color);
		});
	}

	/** GameScene.update 에서 매 프레임 호출 (상점/증강/레벨업이 닫혀 있을 때만 도달). */
	update(delta: number): void {
		// 거신의 검: 리빌드로 새로 생긴 스프라이트에 스케일 재적용
		if (this.swordScaleMult !== 1 && this.swordOrbit) {
			for (const sword of this.swordOrbit.swords) {
				const tagged = sword as OrbitSword & { _augScaled?: boolean };
				if (!tagged._augScaled) {
					tagged._augScaled = true;
					sword.setScale(sword.scaleX * this.swordScaleMult, sword.scaleY * this.swordScaleMult);
				}
			}
		}

		if (this.starfall && this.scene.waveSystem?.roundActive) {
			this.starfallTimer += delta;
			if (this.starfallTimer >= this.starfall.intervalMs) {
				this.starfallTimer = 0;
				this.castStarfall();
			}
		}

		// 길잡이 검: 귀환 중인 검이 경로의 경험치 구슬을 끌어당김
		if (this.returnMagnetRadius > 0 && this.swordOrbit && this.progression && this.scene.player) {
			const radiusSquared = this.returnMagnetRadius * this.returnMagnetRadius;
			for (const sword of this.swordOrbit.swords) {
				if (sword.state !== 'returning') {
					continue;
				}
				for (const orbObj of this.progression.orbs.getChildren()) {
					const orb = orbObj as XPOrbSprite;
					if (!this.progression.isAliveOrb(orb) || orb._isAttracting) {
						continue;
					}
					const dx = orb.x - sword.x;
					const dy = orb.y - sword.y;
					if (dx * dx + dy * dy <= radiusSquared) {
						orb._isAttracting = true;
						if (orb.body) {
							orb.body.enable = true;
						}
						this.scene.physics.moveToObject(orb, this.scene.player, 420);
					}
				}
			}
		}

		// 검로의 잔화: 비행 중인 검이 주기적으로 균열을 떨어뜨림
		if (this.trailRift && this.swordOrbit) {
			for (const sword of this.swordOrbit.swords) {
				const tagged = sword as OrbitSword & { _trailTimer?: number };
				if (sword.state !== 'launched') {
					tagged._trailTimer = 0;
					continue;
				}
				tagged._trailTimer = (tagged._trailTimer ?? 0) + delta;
				if (tagged._trailTimer >= this.trailRift.intervalMs) {
					tagged._trailTimer = 0;
					this.carveRift(sword.x, sword.y, this.avgSwordDamage() * this.trailRift.pct, this.trailRift.radius, 0xfb923c);
				}
			}
		}
	}

	castStarfall(): void {
		const so = this.swordOrbit;
		if (!so || !this.starfall) {
			return;
		}

		// filter()로 매번 새 배열을 만들지 않고 재사용 버퍼에 담는다
		AUG_STARFALL.length = 0;
		for (const enemy of so.getEnemyChildren(so.enemyGroup)) {
			if (so.isValidEnemy(enemy)) {
				AUG_STARFALL.push(enemy);
			}
		}
		if (AUG_STARFALL.length === 0) {
			return;
		}

		const target = Phaser.Math.RND.pick(AUG_STARFALL);
		const { pct, radius } = this.starfall;
		const x = target.x;
		const y = target.y;

		// 경고 서클 → 잠시 후 낙하 (FX 레이어, hold로 450ms 유지)
		this.scene.visualEffects?.fxRing(x, y, {
			r0: radius, r1: radius, w: 2, color: 0xe879f9, alpha: 0.8, dur: 450, ease: 'lin', hold: 0.8,
		});

		this.scene.time.delayedCall(450, () => {
			if (this.scene.isGameOver) {
				return;
			}
			this.scene.cameras.main.shake(120, 0.004);
			this.scene.soundSystem?.play('crit', { volume: 0.7 });
			this.explodeAt(x, y, this.avgSwordDamage() * pct, radius, 0xe879f9);
		});
	}

	// ---------------------------------------------------------------
	// 검 각성 (라운드 40): 1단계 검 선택 → 2단계 각성 선택
	// ---------------------------------------------------------------

	buildAwakeningSwordUi(): void {
		const { width, height } = this.scene.scale;
		const centerX = width / 2;
		const centerY = height / 2;
		const swords = this.swordOrbit?.swords ?? [];

		// 검 호버 상세용 공용 툴팁 (증강 카드와 같은 구현)
		this.tooltip?.destroy();
		this.tooltip = new Tooltip(this.scene, { depth: 2900, wrapWidth: 280 });

		this.scene.cameras.main.flash(500, 251, 191, 36);

		const dim = this.scene.add.rectangle(centerX, centerY, width, height, 0x000000, 0.7)
			.setScrollFactor(0)
			.setDepth(2800);
		this.uiObjects.push(dim);

		const title = this.scene.add.text(centerX, centerY - 250, `★ 검 각성 — ROUND ${this.round}`, {
			fontFamily: FONT.display,
			fontSize: '42px',
			color: '#fcd34d',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		title.setShadow(0, 4, '#000000', 6, false, true);
		this.uiObjects.push(title);

		const subtitle = this.scene.add.text(centerX, centerY - 202, '각성시킬 검을 선택하세요 (런당 1회, 영구 적용)', {
			fontFamily: FONT.body,
			fontSize: '17px',
			color: '#e5e7eb',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		this.uiObjects.push(subtitle);

		const cardWidth = swords.length > 4 ? 150 : 200;
		const cardHeight = 240;
		const gap = 18;
		const totalWidth = swords.length * cardWidth + (swords.length - 1) * gap;
		const startX = centerX - totalWidth / 2 + cardWidth / 2;

		swords.forEach((sword, index) => {
			const x = startX + index * (cardWidth + gap);
			const container = this.scene.add.container(x, centerY + 30).setScrollFactor(0).setDepth(2802).setAlpha(0);
			this.uiObjects.push(container);

			const background = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0.001);
			container.add(background);
			container.add(panel(this.scene, 0, 0, cardWidth, cardHeight, { origin: 0.5 }));
			container.add(selectFrame(this.scene, 0, 0, cardWidth + 12, cardHeight + 12, { tint: UI.straw }));

			container.add(insetPanel(this.scene, 0, -62, 92, 92, { origin: 0.5 }));
			const image = this.scene.add.image(0, -62, 'sword', sword.definition?.sheetOrder ?? 0)
				.setDisplaySize(72, 72);
			container.add(image);

			const name = this.scene.add.text(0, 6, sword.definition?.name ?? '검', {
				...style(16, UI.goldText, { display: true }),
				align: 'center',
				wordWrap: { width: cardWidth - 20 },
			}).setOrigin(0.5);
			container.add(name);

			const elementLabel = sword.definition?.element
				? (ELEMENT_THEME[sword.definition.element]?.label ?? sword.definition.element)
				: null;
			const already = awakeningById(this.swordOrbit?.awakenings?.[sword.definition?.id ?? '']);
			const info = this.scene.add.text(0, 58,
				`Lv.${sword.level}  ·  피해 ${sword.damage}${elementLabel ? `\n${elementLabel} 속성` : ''}`
				+ `${already ? `\n★ 이미 ${already.name}` : ''}`, {
				...style(13, already ? UI.goldText : UI.textDim, { bold: false }),
				align: 'center',
			}).setOrigin(0.5);
			container.add(info);
			const hoverHint = this.scene.add.text(0, cardHeight / 2 - 34, '마우스를 올리면 상세',
				style(11, UI.textFaint, { bold: false })).setOrigin(0.5);
			container.add(hoverHint);

			const keyLabel = this.scene.add.text(0, cardHeight / 2 - 18, `[${index + 1}]`, style(13, UI.textFaint)).setOrigin(0.5);
			container.add(keyLabel);

			background.setInteractive({ useHandCursor: true });
			// 호버 = 이 검의 상세 (스탯·속성·거동·자리 강화·각인·이미 걸린 각성)
			// — 무엇을 각성시킬지 고르는 화면인데 정보가 없다는 제보(2026-09-02)의 수정.
			background.on('pointerover', () => {
				this.scene.tweens.add({ targets: container, scale: 1.06, duration: 120 });
				const definition = sword.definition;
				if (!definition) {
					return;
				}
				const body = describeSwordLines(definition, {
					sword,
					orbit: this.swordOrbit,
					slotIndex: this.swordOrbit?.swords.indexOf(sword) ?? null,
				}).join('\n');
				this.tooltip?.show(x, centerY - cardHeight / 2 - 6,
					withKeywordFooter(`${definition.name} Lv.${sword.level}`, body, UI.goldText));
			});
			background.on('pointerout', () => {
				this.scene.tweens.add({ targets: container, scale: 1, duration: 120 });
				this.tooltip?.hide();
			});
			background.on('pointerdown', () => this.pickAwakeningSword(sword));
			// 컨테이너는 scrollFactor 0 인데 자식(히트 영역)이 1이면 판정만 카메라 스크롤만큼
			// 밀린다 — 라운드 40 각성 화면은 전투 중(카메라가 움직이는 상태)에 뜬다.
			fixScreenSpaceInput(container);

			this.scene.tweens.add({
				targets: container,
				y: centerY - 10,
				alpha: 1,
				duration: 240,
				delay: index * 60,
				ease: 'Back.easeOut',
			});
		});

		this.keyHandler = (event: KeyboardEvent) => {
			const slot = Number.parseInt(event.key, 10) - 1;
			if (Number.isInteger(slot) && slot >= 0 && slot < swords.length) {
				this.pickAwakeningSword(swords[slot]);
			}
		};
		this.scene.input.keyboard!.on('keydown', this.keyHandler);
	}

	pickAwakeningSword(sword: OrbitSword): void {
		if (!this.isOpen) {
			return;
		}

		this.scene.soundSystem?.play('click');
		this.destroyUi();
		this.buildAwakeningOptionUi(sword);
	}

	buildAwakeningOptionUi(sword: OrbitSword): void {
		const { width, height } = this.scene.scale;
		const centerX = width / 2;
		const centerY = height / 2;

		// 발사 없는 캐릭터(광전사)에게 질풍 각성은 무의미 → 제외
		const noLaunch = this.swordOrbit?.noLaunch ?? false;
		const options = (augmentCatalog.awakening?.options ?? []).filter((option) => !(noLaunch && option.id === 'gale'));

		const dim = this.scene.add.rectangle(centerX, centerY, width, height, 0x000000, 0.7)
			.setScrollFactor(0)
			.setDepth(2800);
		this.uiObjects.push(dim);

		const title = this.scene.add.text(centerX, centerY - 250, `★ ${sword.definition?.name ?? '검'} — 각성의 길`, {
			fontFamily: FONT.display,
			fontSize: '38px',
			color: '#fcd34d',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		title.setShadow(0, 4, '#000000', 6, false, true);
		this.uiObjects.push(title);

		const cardWidth = 252;
		const cardHeight = 300;
		const gap = 28;
		const totalWidth = options.length * cardWidth + (options.length - 1) * gap;
		const startX = centerX - totalWidth / 2 + cardWidth / 2;

		options.forEach((option, index) => {
			const x = startX + index * (cardWidth + gap);
			const container = this.scene.add.container(x, centerY + 44).setScrollFactor(0).setDepth(2802).setAlpha(0);
			this.uiObjects.push(container);

			const background = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0.001);
			container.add(background);
			container.add(panel(this.scene, 0, 0, cardWidth, cardHeight, { origin: 0.5 }));
			container.add(selectFrame(this.scene, 0, 0, cardWidth + 12, cardHeight + 12, { tint: UI.straw }));

			const icon = this.scene.add.text(0, -70, option.icon, { fontSize: '56px' }).setOrigin(0.5);
			container.add(icon);

			const name = this.scene.add.text(0, 0, option.name, style(23, UI.goldText, { display: true })).setOrigin(0.5);
			container.add(name);

			const description = this.scene.add.text(0, 66, option.desc, {
				...style(15, UI.text, { bold: false }),
				align: 'center',
				wordWrap: { width: cardWidth - 32 },
			}).setOrigin(0.5);
			container.add(description);

			const keyLabel = this.scene.add.text(0, cardHeight / 2 - 20, `[${index + 1}]`, style(14, UI.textFaint)).setOrigin(0.5);
			container.add(keyLabel);

			background.setInteractive({ useHandCursor: true });
			background.on('pointerover', () => this.scene.tweens.add({ targets: container, scale: 1.06, duration: 120 }));
			background.on('pointerout', () => this.scene.tweens.add({ targets: container, scale: 1, duration: 120 }));
			background.on('pointerdown', () => this.applyAwakening(sword, option));
			fixScreenSpaceInput(container);

			this.scene.tweens.add({
				targets: container,
				y: centerY,
				alpha: 1,
				duration: 240,
				delay: index * 80,
				ease: 'Back.easeOut',
			});
		});

		this.keyHandler = (event: KeyboardEvent) => {
			const slot = Number.parseInt(event.key, 10) - 1;
			if (Number.isInteger(slot) && slot >= 0 && slot < options.length) {
				this.applyAwakening(sword, options[slot]);
			}
		};
		this.scene.input.keyboard!.on('keydown', this.keyHandler);
	}

	applyAwakening(sword: OrbitSword, option: AwakeningOption): void {
		if (!this.isOpen || !this.swordOrbit) {
			return;
		}

		const so = this.swordOrbit;
		const swordId = sword.definition?.id ?? '';
		so.awakenings[swordId] = option.id;

		if (option.id === 'aegis') {
			// 수호: 전역 보너스 (검이 교체되어도 수호령은 남는다는 설정)
			so.damageMultiplier += 0.12;
			this.damageTakenMult *= 0.92;
			this.recalcAllSwords();
		} else {
			if (option.id === 'gale') {
				// 질풍: 연속 타격 +1 (재생성 경로는 loadout.addSword 가 awakenings 를 보고 재적용)
				sword.hitsPerLaunch = (sword.hitsPerLaunch ?? 1) + 1;
				sword.remainingHits = sword.hitsPerLaunch;
			}
			so.recalculateSwordStats(sword);
		}
		so.refreshSwordHud();

		this.scene.soundSystem?.play('evolve');
		this.scene.cameras.main.flash(500, 252, 211, 77);
		this.scene.waveSystem?.announce?.(`★ ${sword.definition?.name ?? '검'} ${option.name}!`, '#fcd34d');
		this.taken.add(`awakening:${option.id}`);
		this.slotIndex += 1;
		this.close();
	}

	// ---------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------

	buildUi(choices: AugmentDefinition[], tier: AugmentTierId): void {
		const { width, height } = this.scene.scale;
		const centerX = width / 2;
		const centerY = height / 2;
		const tierSpec = this.getTierSpec(tier);
		const isTranscend = tier === 'transcend';

		if (isTranscend) {
			this.scene.cameras.main.flash(600, 232, 121, 249);
		}

		const dim = this.scene.add.rectangle(centerX, centerY, width, height, 0x000000, 0.68)
			.setScrollFactor(0)
			.setDepth(2800)
			.setInteractive(); // 아래에 상점 UI가 있어도 클릭이 새지 않도록 차단
		this.uiObjects.push(dim);
		this.tooltip = new Tooltip(this.scene, { depth: 2900, wrapWidth: 280 });

		const title = this.scene.add.text(centerX, centerY - 250, `${this.purchasedMode ? '증강 구매' : '증강 선택'} — ROUND ${this.round}`, {
			fontFamily: FONT.display,
			fontSize: '42px',
			color: '#ffffff',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		title.setShadow(0, 4, '#000000', 6, false, true);
		this.uiObjects.push(title);

		const tierLabel = this.scene.add.text(centerX, centerY - 202, `— ${tierSpec.name} 등급 —`, {
			fontFamily: FONT.display,
			fontSize: '22px',
			color: tierSpec.color,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		tierLabel.setShadow(0, 2, '#000000', 3, false, true);
		this.uiObjects.push(tierLabel);

		const hint = this.scene.add.text(centerX, centerY + 228, '카드를 클릭하거나 1~3 키로 선택', {
			fontFamily: FONT.body,
			fontSize: '16px',
			color: '#d1d5db',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
		this.uiObjects.push(hint);

		const cardWidth = 252;
		const cardHeight = 330;
		const gap = 28;
		const totalWidth = choices.length * cardWidth + (choices.length - 1) * gap;
		const startX = centerX - totalWidth / 2 + cardWidth / 2;

		choices.forEach((augment, index) => {
			this.buildCard(augment, index, startX + index * (cardWidth + gap), centerY, cardWidth, cardHeight, tierSpec, isTranscend);
		});

		// 리롤 버튼 (런당 공유 횟수)
		if (this.rerollsLeft > 0) {
			const rerollButton = this.scene.add.text(centerX, centerY + 262, `🔄 다시 뽑기 (${this.rerollsLeft}회 남음)`, {
				fontFamily: FONT.body,
				fontSize: '18px',
				color: '#93c5fd',
				backgroundColor: '#1f2937',
				padding: { x: 14, y: 8 },
			}).setOrigin(0.5).setScrollFactor(0).setDepth(2801);
			rerollButton.setInteractive({ useHandCursor: true });
			rerollButton.on('pointerover', () => rerollButton.setColor('#bfdbfe'));
			rerollButton.on('pointerout', () => rerollButton.setColor('#93c5fd'));
			rerollButton.on('pointerdown', () => this.reroll());
			this.uiObjects.push(rerollButton);
		}

		this.keyHandler = (event: KeyboardEvent) => {
			const slot = Number.parseInt(event.key, 10) - 1;
			if (Number.isInteger(slot) && slot >= 0 && slot < choices.length) {
				this.selectAugment(choices[slot]);
			}
		};
		this.scene.input.keyboard!.on('keydown', this.keyHandler);
	}

	buildCard(
		augment: AugmentDefinition,
		index: number,
		x: number,
		y: number,
		cardWidth: number,
		cardHeight: number,
		tierSpec: AugmentTierSpec,
		isTranscend: boolean,
	): void {
		const tierColor = Phaser.Display.Color.HexStringToColor(tierSpec.color).color;

		const container = this.scene.add.container(x, y + 44).setScrollFactor(0).setDepth(2802).setAlpha(0);
		this.uiObjects.push(container);

		const background = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0.001);
		container.add(background);
		container.add(panel(this.scene, 0, 0, cardWidth, cardHeight, { origin: 0.5 }));
		container.add(selectFrame(this.scene, 0, 0, cardWidth + 12, cardHeight + 12, { tint: tierColor }));

		// 등급 밴드 (크림 fill 틴트 — 원색 유지)
		const bannerBand = this.scene.add.image(0, -cardHeight / 2 + 24, 'uf-fill-cream')
			.setDisplaySize(cardWidth - 14, 40).setTint(tierColor).setAlpha(isTranscend ? 1 : 0.92);
		container.add(bannerBand);

		const bannerLabel = this.scene.add.text(0, -cardHeight / 2 + 24, isTranscend ? `✦ ${tierSpec.name} ✦` : tierSpec.name, {
			...style(17, '#fffdf5', { display: true }),
		}).setOrigin(0.5);
		bannerLabel.setShadow(0, 1, '#000000', 3, false, true);
		container.add(bannerLabel);

		const icon = this.scene.add.text(0, -62, augment.icon, { fontSize: '56px' }).setOrigin(0.5);
		container.add(icon);

		const name = this.scene.add.text(0, 14, augment.name, {
			...style(22, UI.text, { display: true }),
			align: 'center',
		}).setOrigin(0.5);
		container.add(name);

		const description = this.scene.add.text(0, 84, augment.desc, {
			...style(15, UI.textDim, { bold: false }),
			align: 'center',
			wordWrap: { width: cardWidth - 32 },
		}).setOrigin(0.5);
		container.add(description);

		// 수집 세트 조각: 진행도 표시
		if (augment.effects.setPiece) {
			const progress = this.getSetProgress(augment.effects.setPiece);
			const setLabel = this.scene.add.text(0, cardHeight / 2 - 48, `세트 ${progress.taken}/${progress.total}`,
				style(14, UI.goldText)).setOrigin(0.5);
			container.add(setLabel);
		}

		const keyLabel = this.scene.add.text(0, cardHeight / 2 - 22, `[${index + 1}]`, style(14, UI.textFaint)).setOrigin(0.5);
		container.add(keyLabel);

		background.setInteractive({ useHandCursor: true });
		background.on('pointerover', () => {
			this.scene.tweens.add({ targets: container, scale: 1.06, duration: 120 });
			this.tooltip?.show(x, y - cardHeight / 2 + 8,
				withKeywordFooter(`${augment.name} · ${tierSpec.name}`, this.tooltipBodyFor(augment, tierSpec), tierSpec.color));
		});
		background.on('pointerout', () => {
			this.scene.tweens.add({ targets: container, scale: 1, duration: 120 });
			this.tooltip?.hide();
		});
		background.on('pointerdown', () => this.selectAugment(augment));
		// 히트 영역 정합: 자식 scrollFactor 를 0 으로 못박는다 (전투 중 카메라 스크롤 대응)
		fixScreenSpaceInput(container);

		this.scene.tweens.add({
			targets: container,
			y,
			alpha: 1,
			duration: 260,
			delay: index * 80,
			ease: 'Back.easeOut',
		});

		if (isTranscend) {
			this.scene.tweens.add({
				targets: background,
				scaleX: 1.03,
				scaleY: 1.03,
				yoyo: true,
				repeat: -1,
				duration: 460,
				ease: 'Sine.easeInOut',
			});
		}
	}

	/** 증강 카드 툴팁 본문 — 효과 · 등급 의미 · 수집 세트 진행도 */
	tooltipBodyFor(augment: AugmentDefinition, tierSpec: AugmentTierSpec): string {
		const lines: string[] = [augment.desc];
		const tierNote: Record<string, string> = {
			steel: '강철 — 수치를 안정적으로 올립니다.',
			gold: '황금 — 빌드의 축이 되는 큰 효과입니다.',
			transcend: '초월 — 수치가 아니라 규칙 자체를 바꿉니다.',
		};
		lines.push(tierNote[tierSpec.id] ?? `${tierSpec.name} 등급`);
		if (augment.effects.setPiece) {
			const progress = this.getSetProgress(augment.effects.setPiece);
			lines.push(`수집 세트 ${progress.taken}/${progress.total} — 전부 모으면 세트 보너스가 열립니다.`);
		}
		lines.push('증강은 골드와 무관한 무료 선택이며, 런당 2회까지 다시 뽑을 수 있습니다.');
		return lines.join('\n');
	}

	destroyUi(): void {
		if (this.keyHandler) {
			this.scene.input.keyboard!.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}

		this.tooltip?.destroy();
		this.tooltip = null;

		// 초월 카드의 repeat:-1 맥동 트윈은 대상이 파괴돼도 TweenManager에 남는다 —
		// 파괴 전에 반드시 끊는다 (증강 화면을 여닫을수록 누적되던 누수).
		for (const object of this.uiObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.uiObjects = [];
	}

	destroy(): void {
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.destroyUi();
	}
}
