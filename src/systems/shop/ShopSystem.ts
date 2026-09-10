import Phaser from 'phaser';
import MetaProgression from '../MetaProgression';
import RunSave from '../../core/RunSave';
import { screenShakeEnabled } from '../../core/settings';
import {
	STAT_CAPS, clampCooldownMultiplier, clampMagnetRadius, clampMoveSpeed, moveSpeedCap,
} from '../../logic/statCaps';
import { hpScaleOf, playerDamageGrowth, playerHpGrowth } from '../../logic/growth';
import type GameScene from '../../scenes/GameScene';
import type SwordOrbitSystem from '../sword/SwordOrbitSystem';
import type { ShopStatSpec, SwordDefinition } from '../../types/catalogs';
import type { PlayerSprite, ReserveSword, SwordSprite } from '../../types/actors';
import * as shopLogic from './shopLogic';
import { shopCatalog } from './shopLogic';
import ShopUi from './ShopUi';
import ShopDragController from './ShopDragController';

/** 상점에 한 번에 노출되는 검 오퍼 수 (디자인 시안 기준 5칸). */
const SWORD_OFFER_COUNT = 5;

/** ShopSystem이 실제로 사용하는 PickupSystem 표면 (gold 지갑). */
export interface PickupSystemLike {
	runGold?: number;
	spendGold?: (amount: number) => boolean;
}

/** ShopSystem이 실제로 사용하는 ProgressionSystem 표면. */
export interface ProgressionLike {
	magnetRadius: number;
	baseMagnetRadius?: number;
	xpMultiplier?: number;
	level?: number;
}

export interface ShopSystemOptions {
	swordOrbit?: SwordOrbitSystem | null;
	pickupSystem?: PickupSystemLike | null;
	progression?: ProgressionLike | null;
}

// Between-round shop, visual edition: stat cards, sword cards with sprites,
// owned-sword panel with hover details, element set status.
// (분리 구조: ShopUi = 화면, ShopDragController = 드래그 앤 드랍, shopLogic = 순수 가격 계산)
export default class ShopSystem {
	scene: GameScene;
	swordOrbit: SwordOrbitSystem | null;
	pickupSystem: PickupSystemLike | null;
	progression: ProgressionLike | null;

	isOpen: boolean;
	purchaseCounts: Record<string, number>;
	round: number;
	rerollCount: number;
	swordOffers: SwordDefinition[];
	/**
	 * swordOffers 를 굴린 라운드. 같은 라운드에 화면을 다시 열면 목록을 그대로 유지한다 —
	 * 예전에는 열 때마다 다시 굴려서 "대장간에서 본 물건과 장비 화면의 물건이 다르다"는
	 * 혼란이 있었다 (2026-09-02 통합 화면 개편).
	 */
	offersRound: number | null;
	/** 화면이 닫힐 때 한 번 불리는 콜백 (마을 시설 창이 자기 상태를 정리하는 데 쓴다) */
	onClosed: (() => void) | null;
	useGuarantee: boolean;
	selectedSlot: number | null;
	/** 보관함(인벤토리)에서 선택된 검 인덱스 — selectedSlot 과 배타적 */
	selectedReserve: number | null;

	ui: ShopUi;
	drag: ShopDragController;

	constructor(scene: GameScene, options: ShopSystemOptions = {}) {
		this.scene = scene;
		this.swordOrbit = options.swordOrbit ?? null;
		this.pickupSystem = options.pickupSystem ?? null;
		this.progression = options.progression ?? null;

		this.isOpen = false;
		this.purchaseCounts = {};
		this.round = 0;
		this.rerollCount = 0;
		this.swordOffers = [];
		this.offersRound = null;
		this.onClosed = null;
		this.useGuarantee = false;
		this.selectedSlot = null;
		this.selectedReserve = null;

		this.ui = new ShopUi(this);
		this.drag = new ShopDragController(this, this.ui);
	}

	open(round: number) {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.round = round;
		this.selectedSlot = null;
		this.selectedReserve = null;

		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.soundSystem?.play('chest', { volume: 0.5 });
		this.scene.setGameHudVisible?.(false);

		// 같은 라운드 안에서는 목록·리롤 횟수를 유지한다 (열 때마다 다시 굴리지 않는다).
		// 다 사서 비었더라도 다시 굴리지 않는다 — 새 물건은 [교체](골드)로만.
		if (this.offersRound !== round) {
			this.offersRound = round;
			this.rerollCount = 0;
			this.rollSwordOffers();
		}
		this.ui.build();
	}

	close() {
		this.destroyUi();
		this.isOpen = false;

		const closed = this.onClosed;
		this.onClosed = null;
		closed?.();

		// 자동 저장: 상점에서의 구매/배치 결과까지 스냅샷에 반영
		if (!this.scene.isGameOver && !this.scene.player?.isDead) {
			RunSave.save(RunSave.capture(this.scene));
		}

		if (!this.scene.levelUpSystem?.isOpen) {
			this.scene.setGameHudVisible?.(true);
		}

		if (!this.scene.levelUpSystem?.isOpen && !this.scene.isPaused && !this.scene.player?.isDead) {
			this.scene.physics.resume();
		}
	}

	getGold(): number {
		return this.pickupSystem?.runGold ?? 0;
	}

	spend(amount: number): boolean {
		return this.pickupSystem?.spendGold?.(amount) ?? false;
	}

	// ---------------------------------------------------------------
	// Offers & prices (순수 계산은 shopLogic 참조)
	// ---------------------------------------------------------------

	statPrice(entry: ShopStatSpec): number {
		return shopLogic.statPrice(entry, this.purchaseCounts[entry.id] ?? 0, shopCatalog);
	}

	swordPrice(definition: SwordDefinition, existingSword?: { level?: number } | null): number {
		const tiers = this.swordOrbit?.getBaseTierList() ?? [];
		const price = shopLogic.swordPrice(definition, tiers, existingSword, shopCatalog);
		// 증강 '장인의 우정': 검 구매가 할인 (최대 50%)
		const discount = this.scene.augmentSystem?.swordDiscount ?? 0;
		return discount > 0 ? Math.max(1, Math.round(price * (1 - discount))) : price;
	}

	rerollPrice(): number {
		// 증강 / 키퍼 고유(GILDER [감정사의 내기]): 상점마다 첫 리롤 무료
		if (this.rerollCount === 0
			&& (this.scene.augmentSystem?.freeFirstReroll || this.scene.keeper?.freeFirstReroll)) {
			return 0;
		}
		return shopLogic.rerollPrice(this.round, this.rerollCount, shopCatalog);
	}

	/** 판매가 — 구매가의 50% (레벨 할증 포함). */
	sellPrice(definition: SwordDefinition, level = 1): number {
		const tiers = this.swordOrbit?.getBaseTierList() ?? [];
		return shopLogic.swordSellPrice(definition, tiers, level, shopCatalog);
	}

	/** 골드 환급 (획득 배율 미적용 — 세이브 복원과 동일하게 직접 가산). */
	private refund(amount: number) {
		if (this.pickupSystem) {
			this.pickupSystem.runGold = (this.pickupSystem.runGold ?? 0) + amount;
			this.pickupSystem.spendGold?.(0); // 잔액 텍스트 갱신용 (0원 차감)
		}
	}

	/** 보관함의 검 판매. */
	sellReserve(reserveIndex: number): boolean {
		const so = this.swordOrbit;
		const entry = so?.reserve[reserveIndex];
		if (!so || !entry) {
			return false;
		}
		const price = this.sellPrice(entry.definition, entry.level);
		so.reserve.splice(reserveIndex, 1);
		this.refund(price);
		this.scene.soundSystem?.play('gold', { volume: 0.6 });
		this.scene.waveSystem?.announce?.(`${entry.definition.name} 판매 — +${price} 골드`, '#d9a83c');
		this.refresh();
		return true;
	}

	/** 장착 중인 검 판매 — 마지막 한 자루는 팔 수 없다. */
	sellEquipped(slotIndex: number): boolean {
		const so = this.swordOrbit;
		const sword = so?.swords[slotIndex];
		if (!so || !sword) {
			return false;
		}
		if (so.swords.length <= (so.minSwords ?? 1)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			this.scene.waveSystem?.announce?.('마지막 검은 팔 수 없습니다', '#e0654d');
			return false;
		}
		const price = this.sellPrice(sword.definition, sword.level);
		const name = sword.definition.name;
		so.removeSword(sword);
		this.refund(price);
		if (this.selectedSlot === slotIndex) {
			this.selectedSlot = null;
		}
		this.scene.soundSystem?.play('gold', { volume: 0.6 });
		this.scene.waveSystem?.announce?.(`${name} 판매 — +${price} 골드`, '#d9a83c');
		this.refresh();
		return true;
	}

	// 장착 + 창고를 합친 보유 정보 (레벨 있는 엔트리 반환)
	getOwnedInfo(id: string): SwordSprite | ReserveSword | null {
		const equipped = this.swordOrbit?.getSwordById(id);
		if (equipped) {
			return equipped;
		}
		const reserveIndex = this.swordOrbit?.findReserveIndexById(id) ?? -1;
		return reserveIndex >= 0 ? this.swordOrbit!.reserve[reserveIndex] : null;
	}

	rollSwordOffers() {
		const tiers: SwordDefinition[] = this.swordOrbit?.getBaseTierList() ?? [];
		// 등급 가중 굴림: 라운드가 오를수록 상위 등급이 개방된다
		// (common 1라 / uncommon 2라 / rare 6라 / epic 12라 / legendary 20라).
		// 만렙 보유 검은 제외 — 어차피 더 못 키운다.
		const candidates = tiers.filter((tier) => {
			const owned = this.getOwnedInfo(tier.id);
			return !(owned && owned.level >= (this.swordOrbit?.maxSwordLevel ?? 5));
		});
		this.swordOffers = shopLogic.rollSwordOffersByRarity(candidates, this.round, SWORD_OFFER_COUNT);
	}

	// ---------------------------------------------------------------
	// Purchasing
	// ---------------------------------------------------------------

	/**
	 * 이 스탯이 이미 상한(MAX)인가 — 상한이면 구매 자체가 막힌다 (2026-09-04).
	 * 예전에는 applyStat 이 조용히 클램프만 해서 골드만 날아가고 가격은 올랐다.
	 * 상한값은 applyStat / statCaps 의 것과 같아야 한다.
	 */
	isStatMaxed(entry: ShopStatSpec): boolean {
		const player = this.scene.player as PlayerSprite | undefined;
		if (!player) {
			return false;
		}
		const EPS = 1e-6;
		switch (entry.type) {
			case 'defenseAdd':
				return (player.defense ?? 0) >= 60 - EPS;
			case 'dodgeAdd':
				return (player.dodgeChance ?? 0) >= 0.4 - EPS;
			case 'moveSpeedMult':
				return !!player.baseMoveSpeed && player.moveSpeed >= moveSpeedCap(player.baseMoveSpeed) - EPS;
			case 'cooldownReduce':
				return (this.swordOrbit?.cooldownMultiplier ?? 1) <= STAT_CAPS.cooldownFloor + EPS;
			case 'magnetMult': {
				const base = this.progression?.baseMagnetRadius ?? 0;
				return base > 0 && (this.progression?.magnetRadius ?? 0) >= base * STAT_CAPS.magnetMult - 0.5;
			}
			case 'critChanceAdd':
				return (player.critChance ?? 0) >= STAT_CAPS.critChance - EPS;
			case 'physResistAdd':
				return (player.physicalResist ?? 0) >= 50 - EPS;
			case 'magicResistAdd':
				return (player.magicResist ?? 0) >= 50 - EPS;
			default:
				return false;
		}
	}

	buyStat(entry: ShopStatSpec) {
		if (this.isStatMaxed(entry)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}
		const price = this.statPrice(entry);
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		this.purchaseCounts[entry.id] = (this.purchaseCounts[entry.id] ?? 0) + 1;
		this.applyStat(entry);
		this.scene.soundSystem?.play('gold', { volume: 0.6 });
		this.refresh();
	}

	applyStat(entry: ShopStatSpec) {
		const player = this.scene.player as PlayerSprite;
		const value = entry.value;

		switch (entry.type) {
			case 'maxHpFlat': {
				// 고정 +N 은 현재 레벨의 체력 성장 배율로 환산 (logic/growth.ts) — 후반에도 의미 있게
				const scaled = Math.round(value * playerHpGrowth(this.progression?.level ?? 1));
				player.maxHp += scaled;
				player.hp = Math.min(player.maxHp, player.hp + scaled);
				break;
			}
			case 'defenseAdd':
				player.defense = Math.min(60, (player.defense ?? 0) + value);
				break;
			case 'dodgeAdd':
				player.dodgeChance = Math.min(0.4, (player.dodgeChance ?? 0) + value);
				break;
			case 'moveSpeedMult':
				player.moveSpeed = clampMoveSpeed(
					Math.round(player.moveSpeed * (1 + value)), player.baseMoveSpeed,
				);
				break;
			case 'regenAdd':
				player.hpRegen = (player.hpRegen ?? 0) + value;
				break;
			case 'killHealAdd':
				player.killHeal = (player.killHeal ?? 0) + value;
				break;
			case 'damageMultAdd':
				if (this.swordOrbit) {
					this.swordOrbit.damageMultiplier += value;
					for (const sword of this.swordOrbit.swords) {
						this.swordOrbit.recalculateSwordStats(sword);
					}
				}
				break;
			case 'critChanceAdd':
				// 상점도 100%에서 멈춘다 (2026-09-04) — 초과 구매로 골드가 새지 않도록
				player.critChance = Math.min(STAT_CAPS.critChance, (player.critChance ?? 0) + value);
				break;
			case 'critDamageAdd':
				player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + value;
				break;
			case 'cooldownReduce':
				if (this.swordOrbit) {
					const current = this.swordOrbit.cooldownMultiplier ?? 1;
					const target = clampCooldownMultiplier(current * (1 - value));
					if (target < current) {
						this.swordOrbit.applyCooldownMultiplier?.(target / current);
					}
				}
				break;
			case 'magnetMult':
				if (this.progression) {
					this.progression.magnetRadius = clampMagnetRadius(
						this.progression.magnetRadius * (1 + value), this.progression.baseMagnetRadius,
					);
				}
				break;
			case 'luckAdd':
				player.luck = (player.luck ?? 0) + value;
				break;
			case 'xpGainAdd':
				if (this.progression) {
					this.progression.xpMultiplier = (this.progression.xpMultiplier ?? 1) + value;
				}
				break;
			case 'thornsAdd':
				player.thorns = (player.thorns ?? 0) + value;
				break;
			case 'physResistAdd':
				player.physicalResist = Math.min(50, (player.physicalResist ?? 0) + value);
				break;
			case 'magicResistAdd':
				player.magicResist = Math.min(50, (player.magicResist ?? 0) + value);
				break;
			default:
				break;
		}
	}

	buySword(definition: SwordDefinition) {
		const so = this.swordOrbit!;
		const equipped = so.getSwordById(definition.id);
		const reserveIndex = so.findReserveIndexById(definition.id);
		const reserveEntry = reserveIndex >= 0 ? so.reserve[reserveIndex] : null;
		const owned = equipped ?? reserveEntry;
		const price = this.swordPrice(definition, owned);

		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		if (equipped) {
			so.levelUpSword(equipped);
		} else if (reserveEntry) {
			// 창고의 검도 중복 구매로 레벨업
			reserveEntry.level = Math.min(so.maxSwordLevel ?? 5, reserveEntry.level + 1);
		} else if (so.swords.length < so.getEffectiveMaxSwords()) {
			so.addSword(this.scene, definition);
		} else {
			// 자리가 가득 차도 구매 가능 — 보관함으로 입고
			so.addToReserve(definition);
			this.scene.waveSystem?.announce?.(`${definition.name} — 보관함에서 대기`, '#8fc3d8');
		}

		this.swordOffers = this.swordOffers.filter((offer) => offer.id !== definition.id);
		this.scene.soundSystem?.play('evolve', { volume: 0.5 });
		this.refresh();
	}

	reroll() {
		if (!this.spend(this.rerollPrice())) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		this.rerollCount += 1;
		this.rollSwordOffers();
		this.scene.soundSystem?.play('click', { volume: 0.5 });
		this.refresh();
	}

	// ---------------------------------------------------------------
	// 증강 드래프트권 (골드로 3택1 드래프트 구매 — 무료 시퀀스와 별개)
	// ---------------------------------------------------------------

	augmentDraftPrice(): number {
		return this.scene.augmentSystem?.draftPrice(this.round) ?? 0;
	}

	buyAugmentDraft() {
		const augment = this.scene.augmentSystem;
		if (!augment || augment.isOpen || this.ui.modalKind) {
			return;
		}

		if (!this.spend(this.augmentDraftPrice())) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		augment.draftsBought += 1;
		// 상점 위 오버레이로 3택1 — 닫히면 상점 가격/골드 표시만 갱신
		augment.openPurchased(this.round, () => this.refresh());
	}

	// ---------------------------------------------------------------
	// Slot economy actions
	// ---------------------------------------------------------------

	buySlotUnlock() {
		const so = this.swordOrbit;
		if (!so || so.unlockedSlots >= so.maxSwords) {
			return;
		}
		// 라운드 게이트 (2026-09-04): 완료 라운드가 모자라면 골드가 있어도 못 연다
		if (!so.canUnlockSlotAt(this.round)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			this.scene.waveSystem?.announce?.(`자리 ${so.unlockedSlots + 1}은 라운드 ${so.nextSlotUnlockRound()} 완료 후 열린다`, '#8fc3d8');
			return;
		}

		const price = so.nextSlotUnlockCost();
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		so.unlockSlot();
		this.scene.soundSystem?.play('chest', { volume: 0.5 });
		this.refresh();
	}

	enhanceSlot(slotIndex: number, useGuarantee = false) {
		const so = this.swordOrbit;
		const state = so?.getSlotState(slotIndex);
		if (!state || slotIndex >= so!.unlockedSlots) {
			return;
		}

		if (state.enhance >= (shopCatalog.slots?.enhanceMaxLevel ?? 10)) {
			return;
		}

		if (useGuarantee && MetaProgression.getGuaranteeCoins() <= 0) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		const price = so!.enhanceCost(slotIndex);
		if (!this.spend(price)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		if (useGuarantee) {
			MetaProgression.useGuaranteeCoin();
		}

		const result = so!.tryEnhanceSlot(slotIndex, useGuarantee);

		if (result === 'success') {
			this.scene.soundSystem?.play('evolve', { volume: 0.6 });
			if (screenShakeEnabled()) {
				this.scene.cameras.main.flash(200, 143, 195, 216);
			}
			this.ui.showSlotResult(slotIndex, `강화 +${state.enhance} 성공!`, '#9bc25b');
		} else if (result === 'fail') {
			this.scene.soundSystem?.play('hurt', { volume: 0.4 });
			if (screenShakeEnabled()) {
				this.scene.cameras.main.shake(150, 0.004);
			}
			this.ui.showSlotResult(slotIndex, '강화 실패…', '#e0654d');
		}

		this.refresh();
	}

	pullTraitFor(slotIndex: number) {
		const so = this.swordOrbit;
		if (!so?.canAddTrait(slotIndex)) {
			return;
		}

		if (!this.spend(150)) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
			return;
		}

		const trait = so.pullTrait(slotIndex);
		if (trait) {
			this.scene.soundSystem?.play('chest');
			if (screenShakeEnabled()) {
				this.scene.cameras.main.flash(350, 217, 168, 60);
			}
			const sword = so.swords[slotIndex];
			const synergy = sword?.definition?.element && sword.definition.element === trait.element;
			this.ui.showSlotResult(slotIndex, `${trait.name}${synergy ? ' — 속성 시너지!' : ''}`, synergy ? '#d9a83c' : '#c9d2d8');
		}

		this.refresh();
	}

	// REFORGE 모달의 명시적 조합 — 성공 시 연출은 SwordOrbitSystem.reforge가 담당
	reforgeRecipe(recipeIndex: number) {
		const so = this.swordOrbit;
		if (!so) {
			return;
		}
		// 결과 검은 조합 전에 읽어 둔다 (조합 후에는 레시피 인덱스가 그대로여도
		// 재료가 사라져 상태가 바뀐다)
		const resultDefinition = so.getDefinitionById(so.evolutionRecipes[recipeIndex]?.result ?? '');
		const ok = so.reforge(recipeIndex);
		if (!ok) {
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
		} else {
			// 조합 성공 연출 — 모달 위에 결과 검 강조 (월드 FX 는 오버레이에 가린다)
			this.ui.playReforgeResultFX(resultDefinition ?? null);
		}
		this.refresh();
	}

	// Click = select (강화/각인/판매 버튼 대상). 이동은 드래그 앤 드랍.
	handleSlotClick(slotIndex: number) {
		const so = this.swordOrbit!;

		if (slotIndex >= so.unlockedSlots) {
			if (slotIndex === so.unlockedSlots && so.unlockedSlots < so.maxSwords) {
				this.buySlotUnlock();
			}
			return;
		}

		this.selectedSlot = this.selectedSlot === slotIndex ? null : slotIndex;
		this.selectedReserve = null;
		this.scene.soundSystem?.play('click', { volume: 0.4 });
		this.refresh();
	}

	/** 보관함 칸 클릭 = 선택 (장착/판매 버튼 대상). */
	handleReserveClick(reserveIndex: number) {
		const so = this.swordOrbit;
		if (!so?.reserve[reserveIndex]) {
			return;
		}
		this.selectedReserve = this.selectedReserve === reserveIndex ? null : reserveIndex;
		this.selectedSlot = null;
		this.scene.soundSystem?.play('click', { volume: 0.4 });
		this.refresh();
	}

	/**
	 * 보관함 내 위치 이동 — 검이 있는 칸에 놓으면 서로 교환, 빈 칸에 놓으면 그 뒤로 이동.
	 * (드래그 앤 드랍 정렬용, 메이플 인벤토리 느낌)
	 */
	moveReserve(from: number, to: number): boolean {
		const so = this.swordOrbit;
		if (!so) {
			return false;
		}
		const reserve = so.reserve;
		if (from < 0 || from >= reserve.length || to < 0 || to === from) {
			return false;
		}

		if (to >= reserve.length) {
			// 빈 칸: 맨 뒤로 이동
			const [entry] = reserve.splice(from, 1);
			reserve.push(entry);
			if (this.selectedReserve === from) {
				this.selectedReserve = reserve.length - 1;
			} else if (this.selectedReserve !== null && this.selectedReserve > from) {
				this.selectedReserve -= 1;
			}
		} else {
			// 검이 있는 칸: 자리 교환
			[reserve[from], reserve[to]] = [reserve[to], reserve[from]];
			if (this.selectedReserve === from) {
				this.selectedReserve = to;
			} else if (this.selectedReserve === to) {
				this.selectedReserve = from;
			}
		}

		this.refresh();
		return true;
	}

	/** 선택된 보관함 검을 빈 자리(없으면 첫 자리와 교환)에 장착. */
	equipSelectedReserve(): boolean {
		const so = this.swordOrbit;
		const index = this.selectedReserve;
		if (!so || index === null || !so.reserve[index]) {
			return false;
		}
		// 빈 자리 우선, 없으면 자리 1(인덱스 0)과 교환
		let target = so.swords.length < so.getEffectiveMaxSwords() ? so.swords.length : 0;
		if (this.selectedSlot !== null) {
			target = this.selectedSlot;
		}
		const ok = so.equipFromReserve(index, target);
		if (ok) {
			this.selectedReserve = null;
			this.scene.soundSystem?.play('evolve', { volume: 0.4 });
		}
		this.refresh();
		return ok;
	}

	// ---------------------------------------------------------------
	// Refresh / teardown (UI 위임)
	// ---------------------------------------------------------------

	refresh() {
		if (!this.isOpen) {
			return;
		}

		this.ui.refresh();
	}

	destroyUi() {
		// 원본 해체 순서 유지: 입력 핸들러 → 드래그(임계값 복원) → 오브젝트 파괴
		this.ui.teardownInput();
		this.drag.uninstall();
		this.ui.destroyObjects();
		this.selectedSlot = null;
		this.selectedReserve = null;
	}
}
