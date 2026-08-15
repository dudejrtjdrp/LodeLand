import Phaser from 'phaser';
import MetaProgression from '../MetaProgression';
import type GameScene from '../../scenes/GameScene';
import type SwordOrbitSystem from '../sword/SwordOrbitSystem';
import type { ShopStatSpec, SwordDefinition } from '../../types/catalogs';
import type { PlayerSprite, ReserveSword, SwordSprite } from '../../types/actors';
import * as shopLogic from './shopLogic';
import { shopCatalog } from './shopLogic';
import ShopUi from './ShopUi';
import ShopDragController from './ShopDragController';

/** ShopSystem이 실제로 사용하는 PickupSystem 표면 (gold 지갑). */
export interface PickupSystemLike {
	runGold?: number;
	spendGold?: (amount: number) => boolean;
}

/** ShopSystem이 실제로 사용하는 ProgressionSystem 표면. */
export interface ProgressionLike {
	magnetRadius: number;
	xpMultiplier?: number;
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
	useGuarantee: boolean;
	selectedSlot: number | null;

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
		this.useGuarantee = false;
		this.selectedSlot = null;

		this.ui = new ShopUi(this);
		this.drag = new ShopDragController(this, this.ui);
	}

	open(round: number) {
		if (this.isOpen) {
			return;
		}

		this.isOpen = true;
		this.round = round;
		this.rerollCount = 0;
		this.selectedSlot = null;

		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.soundSystem?.play('chest', { volume: 0.5 });

		this.rollSwordOffers();
		this.ui.build();
	}

	close() {
		this.destroyUi();
		this.isOpen = false;

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
		return shopLogic.swordPrice(definition, tiers, existingSword, shopCatalog);
	}

	rerollPrice(): number {
		return shopLogic.rerollPrice(this.round, this.rerollCount, shopCatalog);
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
		const maxTier = Math.min(tiers.length - 1, 1 + Math.floor(this.round / 2));
		const pool = tiers.slice(0, maxTier + 1).filter((tier) => {
			const owned = this.getOwnedInfo(tier.id);
			return !(owned && owned.level >= (this.swordOrbit?.maxSwordLevel ?? 5));
		});

		Phaser.Utils.Array.Shuffle(pool);
		this.swordOffers = pool.slice(0, 2);
	}

	// ---------------------------------------------------------------
	// Purchasing
	// ---------------------------------------------------------------

	buyStat(entry: ShopStatSpec) {
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
			case 'maxHpFlat':
				player.maxHp += value;
				player.hp = Math.min(player.maxHp, player.hp + value);
				break;
			case 'defenseAdd':
				player.defense = Math.min(60, (player.defense ?? 0) + value);
				break;
			case 'dodgeAdd':
				player.dodgeChance = Math.min(0.4, (player.dodgeChance ?? 0) + value);
				break;
			case 'moveSpeedMult':
				player.moveSpeed = Math.round(player.moveSpeed * (1 + value));
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
				player.critChance = (player.critChance ?? 0) + value;
				break;
			case 'critDamageAdd':
				player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + value;
				break;
			case 'cooldownReduce':
				this.swordOrbit?.applyCooldownMultiplier?.(1 - value);
				break;
			case 'magnetMult':
				if (this.progression) {
					this.progression.magnetRadius *= (1 + value);
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
			so.checkFusions();
		} else {
			// 칸이 가득 차도 구매 가능 — 창고로 입고
			so.addToReserve(definition);
			this.scene.waveSystem?.announce?.(`🎒 ${definition.name} 창고 보관`, '#93c5fd');
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
	// Slot economy actions
	// ---------------------------------------------------------------

	buySlotUnlock() {
		const so = this.swordOrbit;
		if (!so || so.unlockedSlots >= so.maxSwords) {
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
			this.scene.cameras.main.flash(200, 167, 139, 250);
			this.ui.showSlotResult(slotIndex, `+${state.enhance} 성공!`, '#4ade80');
		} else if (result === 'fail') {
			this.scene.soundSystem?.play('hurt', { volume: 0.4 });
			this.scene.cameras.main.shake(150, 0.004);
			this.ui.showSlotResult(slotIndex, '실패...', '#ef4444');
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
			this.scene.cameras.main.flash(350, 251, 191, 36);
			const sword = so.swords[slotIndex];
			const synergy = sword?.definition?.element && sword.definition.element === trait.element;
			this.ui.showSlotResult(slotIndex, `${trait.icon} ${trait.name}${synergy ? ' ⚡시너지!' : ''}`, synergy ? '#fbbf24' : '#e5e7eb');
		}

		this.refresh();
	}

	// Click = select (강화/특성 버튼 대상). 이동은 드래그 앤 드랍.
	handleSlotClick(slotIndex: number) {
		const so = this.swordOrbit!;

		if (slotIndex >= so.unlockedSlots) {
			if (slotIndex === so.unlockedSlots && so.unlockedSlots < so.maxSwords) {
				this.buySlotUnlock();
			}
			return;
		}

		this.selectedSlot = this.selectedSlot === slotIndex ? null : slotIndex;
		this.scene.soundSystem?.play('click', { volume: 0.4 });
		this.refresh();
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
	}
}
