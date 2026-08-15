// 검 궤도 시스템 오케스트레이터.
// 공개 API(필드/메서드 시그니처)는 원본 src/systems/SwordOrbitSystem.js 와 동일하며,
// 무거운 로직은 같은 폴더의 모듈로 분리되어 있다:
//   movement.ts        — 궤도/발사/귀환 이동 + 타겟 스캔
//   hitResolution.ts   — 타격 판정, 크리티컬, 초희귀 추가 피해, 스페셜, 검기 파동
//   loadout.ts         — 장착/창고 관리 (rebuildLoadout 중심)
//   fusion.ts          — 진화 레시피 판정 & 'sword-fused' 이벤트
//   slotEconomy.ts     — 칸 강화/특성 소켓/시너지 오라
//   resonanceSystem.ts — 원소 세트 공명 & 필살기
//   hud.ts             — 좌하단 HUD 아이콘/툴팁/설명 텍스트
// 순수 수식은 src/logic/slots.ts, src/logic/resonance.ts, src/logic/combat.ts 참고.

import type Phaser from 'phaser';
import evolutionCatalogRaw from '../../data/evolutionCatalog.json';
import shopCatalogRaw from '../../data/shopCatalog.json';
import { slotEnhanceCost, slotEnhanceSuccessRate, slotUnlockCost } from '../../logic/slots';
import { countElements, hasResonance, ultimateUnlocked } from '../../logic/resonance';
import type { EvolutionRecipe, ShopCatalog, SlotConfigSpec, TraitDefinition } from '../../types/catalogs';
import type { EnemySprite, PlayerSprite, ReserveSword, SlotState } from '../../types/actors';
import type GameScene from '../../scenes/GameScene';
import type {
	DamageInfo,
	EnemyGroupLike,
	LoadoutEntry,
	OrbitPosition,
	OrbitSword,
	OrbitSwordDefinition,
	SlotModifiers,
	SwordOrbitOptions,
	UltimateElement,
} from './types';
import * as movement from './movement';
import * as hits from './hitResolution';
import * as loadout from './loadout';
import * as fusion from './fusion';
import * as slotEconomy from './slotEconomy';
import * as resonance from './resonanceSystem';
import * as hud from './hud';

const evolutionCatalog = evolutionCatalogRaw as unknown as EvolutionRecipe[];
const shopCatalog = shopCatalogRaw as unknown as ShopCatalog;

export default class SwordOrbitSystem {
	scene: GameScene | null;

	radius: number;
	orbitSpeed: number;
	launchDuration: number;
	returnSpeed: number;
	scanRadius: number;
	closeScanRadius: number;
	minSwords: number;
	maxSwords: number;
	rotationOffset: number;
	returnLerp: number;
	swordCatalog: OrbitSwordDefinition[];
	damageMultiplier: number;
	cooldownMultiplier: number;
	launchSpeedMultiplier: number;
	bonusHits: number;
	evolutionRecipes: EvolutionRecipe[];
	noLaunch: boolean;
	orbitDamageMult: number;
	cleaveTargets: number;
	cleaveRadius: number;
	maxSwordLevel: number;
	levelDamageBonus: number;
	levelCooldownBonus: number;

	// Slot economy: unlock -> enhance (+10 max, chance-based) -> trait sockets
	slotConfig: Partial<SlotConfigSpec>;
	unlockedSlots: number;
	slotStates: SlotState[];

	// 원소 세트: 2자루 = 공명(효과 1.5배), 둘 다 Lv3+ = 필살기
	setAnnounced: Set<string>;
	ultimateTimers: Record<UltimateElement, number>;
	ultimateIntervals: Record<UltimateElement, number>;

	baseAngle: number;
	swords: OrbitSword[];
	reserve: ReserveSword[]; // 창고: 장착하지 않은 보유 검 [{definition, level}]
	enemyGroup: EnemyGroupLike | null;
	hudIcons: Array<Phaser.GameObjects.Image | Phaser.GameObjects.Text>;
	hudTooltip?: Phaser.GameObjects.Text | null;

	constructor(scene: GameScene | null = null, options: SwordOrbitOptions = {}) {
		this.scene = scene;

		this.radius = options.radius ?? 140;
		this.orbitSpeed = options.orbitSpeed ?? 2;
		this.launchDuration = options.launchDuration ?? 420;
		this.returnSpeed = options.returnSpeed ?? 350;
		this.scanRadius = options.scanRadius ?? 300;
		this.closeScanRadius = options.closeScanRadius ?? 120;
		this.minSwords = options.minSwords ?? 1;
		this.maxSwords = options.maxSwords ?? 8;
		this.rotationOffset = options.rotationOffset ?? -5 * Math.PI / 4;
		this.returnLerp = options.returnLerp ?? 0.16;
		this.swordCatalog = Array.isArray(options.swordCatalog) ? options.swordCatalog : [];
		this.damageMultiplier = options.damageMultiplier ?? 1;
		this.cooldownMultiplier = options.cooldownMultiplier ?? 1;
		this.launchSpeedMultiplier = options.launchSpeedMultiplier ?? 1;
		this.bonusHits = options.bonusHits ?? 0;
		this.evolutionRecipes = Array.isArray(options.evolutionRecipes) ? options.evolutionRecipes : evolutionCatalog;
		this.noLaunch = options.noLaunch ?? false;
		this.orbitDamageMult = options.orbitDamageMult ?? 1;
		this.cleaveTargets = options.cleaveTargets ?? 0;
		this.cleaveRadius = options.cleaveRadius ?? 140;
		this.maxSwordLevel = options.maxSwordLevel ?? 5;
		this.levelDamageBonus = 0.15;   // +15% damage per sword level
		this.levelCooldownBonus = 0.06; // -6% cooldown per sword level

		// Slot economy: unlock -> enhance (+10 max, chance-based) -> trait sockets
		const slotConfig: Partial<SlotConfigSpec> = shopCatalog.slots ?? {};
		this.slotConfig = slotConfig;
		this.unlockedSlots = Math.min(options.startUnlockedSlots ?? slotConfig.startUnlocked ?? 2, this.maxSwords);
		this.slotStates = Array.from({ length: 8 }, (_, index) => ({
			index,
			enhance: 0,
			traits: [],
		}));

		// 원소 세트: 2자루 = 공명(효과 1.5배), 둘 다 Lv3+ = 필살기
		this.setAnnounced = new Set();
		this.ultimateTimers = { fire: 0, electric: 0, void: 0 };
		this.ultimateIntervals = { fire: 8000, electric: 4000, void: 15000 };
		this.baseAngle = 0;
		this.swords = [];
		this.reserve = []; // 창고: 장착하지 않은 보유 검 [{definition, level}]
		this.enemyGroup = null;
		this.hudIcons = [];

		if (this.scene) {
			this.ensureMinimumSwords(this.scene);
		}
	}

	setEnemyGroup(enemyGroup: EnemyGroupLike | null): void {
		if (!enemyGroup || this.enemyGroup === enemyGroup) {
			this.enemyGroup = enemyGroup ?? this.enemyGroup;
			return;
		}

		this.enemyGroup = enemyGroup;

		for (const sword of this.swords) {
			this.bindSwordOverlap(sword);
		}
	}

	ensureMinimumSwords(scene: GameScene | null = this.scene): void {
		if (!scene) {
			return;
		}

		while (this.swords.length < this.minSwords) {
			this.addSword(scene);
		}
	}

	getEffectiveMaxSwords(): number {
		return Math.min(this.maxSwords, this.unlockedSlots);
	}

	addSword(scene: GameScene | null = this.scene, definitionOverride: OrbitSwordDefinition | null = null): OrbitSword | false {
		return loadout.addSword(this, scene, definitionOverride);
	}

	// ---------------------------------------------------------------
	// Sword levels (단계): duplicate shop purchases level the sword up
	// ---------------------------------------------------------------

	getSwordById(id: string): OrbitSword | null {
		return this.swords.find((sword) => sword.definition?.id === id) ?? null;
	}

	levelUpSword(sword: OrbitSword | null): boolean {
		return loadout.levelUpSword(this, sword);
	}

	recalculateSwordStats(sword: OrbitSword): void {
		loadout.recalculateSwordStats(this, sword);
	}

	// ---------------------------------------------------------------
	// Slot economy: unlock / enhance / trait sockets / synergy
	// ---------------------------------------------------------------

	getSlotState(index: number): SlotState | null {
		return this.slotStates[index] ?? null;
	}

	nextSlotUnlockCost(): number {
		return slotUnlockCost(this.slotConfig, this.unlockedSlots);
	}

	unlockSlot(): boolean {
		if (this.unlockedSlots >= this.maxSwords) {
			return false;
		}
		this.unlockedSlots += 1;
		return true;
	}

	enhanceCost(slotIndex: number): number {
		const state = this.getSlotState(slotIndex);
		return slotEnhanceCost(this.slotConfig, state!.enhance);
	}

	enhanceSuccessRate(slotIndex: number): number {
		const state = this.getSlotState(slotIndex);
		return slotEnhanceSuccessRate(this.slotConfig, state!.enhance);
	}

	// Chance-based +1 (guaranteed with a 💎). Returns 'success' | 'fail' | 'max'.
	tryEnhanceSlot(slotIndex: number, guaranteed = false): 'success' | 'fail' | 'max' {
		return slotEconomy.tryEnhanceSlot(this, slotIndex, guaranteed);
	}

	canAddTrait(slotIndex: number): boolean {
		const state = this.getSlotState(slotIndex);
		return Boolean(state
			&& state.enhance >= (this.slotConfig.enhanceMaxLevel ?? 10)
			&& state.traits.length < (this.slotConfig.traitSockets ?? 3));
	}

	// Legendary trait gacha: random trait into the slot's next socket
	pullTrait(slotIndex: number): TraitDefinition | null {
		return slotEconomy.pullTrait(this, slotIndex);
	}

	getTraitById(id: string): TraitDefinition | null {
		return slotEconomy.getTraitById(id);
	}

	// Aggregate a sword's slot bonuses. Element-matching traits are DOUBLED (synergy).
	computeSlotModifiers(sword: OrbitSword): SlotModifiers {
		return slotEconomy.computeSlotModifiers(this, sword);
	}

	refreshAura(sword: OrbitSword | null): void {
		slotEconomy.refreshAura(this, sword);
	}

	// ---------------------------------------------------------------
	// Sword specials: burn / poison / midas / chain / execute
	// ---------------------------------------------------------------

	// 초희귀 검 전용: %체력 피해 / 고정(트루) 피해 - 저항 무시
	applyRareExtras(sword: OrbitSword, enemy: EnemySprite): void {
		hits.applyRareExtras(this, sword, enemy);
	}

	// Trait-driven on-hit procs (slot sockets)
	applyTraitProcs(sword: OrbitSword, enemy: EnemySprite): void {
		hits.applyTraitProcs(this, sword, enemy);
	}

	applySpecial(sword: OrbitSword, enemy: EnemySprite, damage: number): void {
		hits.applySpecial(this, sword, enemy, damage);
	}

	playChainEffect(from: EnemySprite, to: EnemySprite): void {
		hits.playChainEffect(this, from, to);
	}

	// ---------------------------------------------------------------
	// Fusion: hidden evolution recipes (different swords combine)
	// ---------------------------------------------------------------

	getBaseTierList(): OrbitSwordDefinition[] {
		return this.swordCatalog.filter((entry) => !entry.evolved);
	}

	getDefinitionById(id: string): OrbitSwordDefinition | null {
		return this.swordCatalog.find((entry) => entry.id === id) ?? null;
	}

	getNextTierDefinition(id: string): OrbitSwordDefinition | null {
		const tiers = this.getBaseTierList();
		const index = tiers.findIndex((entry) => entry.id === id);

		if (index < 0 || index >= tiers.length - 1) {
			return null;
		}

		return tiers[index + 1];
	}

	findPair(idA: string, idB: string): [OrbitSword, OrbitSword] | null {
		return fusion.findPair(this, idA, idB);
	}

	checkFusions(): boolean {
		return fusion.checkFusions(this);
	}

	fuseSwords(pair: [OrbitSword, OrbitSword], resultDefinition: OrbitSwordDefinition, announcement: string, isEvolution: boolean): OrbitSword | false {
		return fusion.fuseSwords(this, pair, resultDefinition, announcement, isEvolution);
	}

	playFusionEffect(x: number, y: number, isEvolution: boolean): void {
		fusion.playFusionEffect(this, x, y, isEvolution);
	}

	removeSword(sword: OrbitSword): void {
		loadout.removeSword(this, sword);
	}

	reindexSlots(): void {
		this.swords.forEach((sword, index) => {
			sword.slot = index;
		});
	}

	// ---------------------------------------------------------------
	// 창고(Reserve): 장착 목록과 분리된 보유 검. 드래그로 장착/해제.
	// ---------------------------------------------------------------

	getLoadout(): LoadoutEntry[] {
		return this.swords.map((sword) => ({ definition: sword.definition, level: sword.level }));
	}

	// Rebuild all equipped sword sprites from a data list (safe way to reorder)
	rebuildLoadout(loadoutList: LoadoutEntry[]): void {
		loadout.rebuildLoadout(this, loadoutList);
	}

	addToReserve(definition: OrbitSwordDefinition, level = 1): void {
		this.reserve.push({ definition, level });
	}

	findReserveIndexById(id: string): number {
		return this.reserve.findIndex((entry) => entry.definition?.id === id);
	}

	// 창고 → 칸 장착. 대상 칸에 검이 있으면 맞교환(그 검은 창고로).
	equipFromReserve(reserveIndex: number, targetSlot: number): boolean {
		return loadout.equipFromReserve(this, reserveIndex, targetSlot);
	}

	// 칸 → 창고 (장착 해제)
	unequipToReserve(slotIndex: number): boolean {
		return loadout.unequipToReserve(this, slotIndex);
	}

	// Move/swap swords between slots (slot bonuses are positional, so this matters)
	swapSlots(a: number, b: number): boolean {
		return loadout.swapSlots(this, a, b);
	}

	// Compact one-line-per-stat description (HUD tooltip & shop share this)
	describeSword(sword: OrbitSword): string {
		return hud.describeSword(this, sword);
	}

	// In-game tooltip for the bottom-left sword HUD
	showHudTooltip(sword: OrbitSword, x: number, y: number): void {
		hud.showHudTooltip(this, sword, x, y);
	}

	hideHudTooltip(): void {
		this.hudTooltip?.destroy();
		this.hudTooltip = null;
	}

	// Small icon strip (bottom-left) showing the current loadout
	refreshSwordHud(): void {
		hud.refreshSwordHud(this);
	}

	applyCooldownMultiplier(multiplier: number): void {
		this.cooldownMultiplier *= multiplier;

		for (const sword of this.swords) {
			sword.scanInterval = (sword.scanInterval ?? 1500) * multiplier;
		}
	}

	applyLaunchSpeedMultiplier(multiplier: number): void {
		this.launchSpeedMultiplier *= multiplier;

		for (const sword of this.swords) {
			sword.launchSpeed = (sword.launchSpeed ?? 400) * multiplier;
		}
	}

	addCleave(amount = 1): void {
		this.cleaveTargets += amount;
	}

	// 검기 파동: a landed hit also strikes up to N other enemies near the target
	applyCleave(struckEnemy: EnemySprite, damage: number, isCrit: boolean, sword: OrbitSword | null = null): void {
		hits.applyCleave(this, struckEnemy, damage, isCrit, sword);
	}

	playCleaveEffect(from: EnemySprite, to: EnemySprite): void {
		hits.playCleaveEffect(this, from, to);
	}

	addBonusHits(amount = 1): void {
		this.bonusHits += amount;

		for (const sword of this.swords) {
			sword.hitsPerLaunch = (sword.hitsPerLaunch ?? 1) + amount;
			sword.remainingHits = (sword.remainingHits ?? 0) + amount;
		}
	}

	bindSwordOverlap(sword: OrbitSword | null): void {
		if (!this.scene || !this.enemyGroup || !sword?.body || sword._orbitEnemyGroup === this.enemyGroup) {
			return;
		}

		this.scene.physics.add.overlap(
			sword,
			this.enemyGroup,
			this.handleSwordEnemyOverlap as unknown as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
			undefined, // 원본은 null — Phaser 내부에서 falsy 로 동일하게 처리된다
			this,
		);
		sword._orbitEnemyGroup = this.enemyGroup;
	}

	update(player: PlayerSprite | null, delta: number, enemiesGroup: EnemyGroupLike | null = this.enemyGroup): void {
		movement.updateSystem(this, player, delta, enemiesGroup);
	}

	// ---------------------------------------------------------------
	// 원소 세트: 공명(1.5배) + 필살기
	// ---------------------------------------------------------------

	getElementCounts(): Record<string, number> {
		return countElements(this.swords.map((sword) => sword.definition?.element));
	}

	hasSetResonance(element: string | null | undefined): boolean {
		return hasResonance(this.getElementCounts(), element);
	}

	isUltimateUnlocked(element: string): boolean {
		const members = this.swords.filter((sword) => sword.definition?.element === element);
		return ultimateUnlocked(members.map((sword) => sword.level ?? 1));
	}

	checkSetAnnouncements(): void {
		resonance.checkSetAnnouncements(this);
	}

	updateUltimates(player: PlayerSprite | null, delta: number): void {
		resonance.updateUltimates(this, player, delta);
	}

	castUltimate(element: UltimateElement, player: PlayerSprite): void {
		resonance.castUltimate(this, element, player);
	}

	updateSwordPositions(player: PlayerSprite | null): void {
		movement.updateSwordPositions(this, player);
	}

	updateSword(player: PlayerSprite, sword: OrbitSword, delta: number, enemiesGroup: EnemyGroupLike | null, claimedTargets: Set<EnemySprite>): void {
		movement.updateSword(this, player, sword, delta, enemiesGroup, claimedTargets);
	}

	updateOrbitingSword(player: PlayerSprite, sword: OrbitSword, delta: number, enemiesGroup: EnemyGroupLike | null, claimedTargets: Set<EnemySprite>): void {
		movement.updateOrbitingSword(this, player, sword, delta, enemiesGroup, claimedTargets);
	}

	updateLaunchedSword(player: PlayerSprite, sword: OrbitSword, delta: number, enemiesGroup: EnemyGroupLike | null): void {
		movement.updateLaunchedSword(this, player, sword, delta, enemiesGroup);
	}

	updateReturningSword(player: PlayerSprite, sword: OrbitSword, delta: number, enemiesGroup: EnemyGroupLike | null, claimedTargets: Set<EnemySprite>): void {
		movement.updateReturningSword(this, player, sword, delta, enemiesGroup, claimedTargets);
	}

	startLaunchedSword(sword: OrbitSword | null, target: EnemySprite | null, claimedTargets: Set<EnemySprite> | null = null): void {
		movement.startLaunchedSword(this, sword, target, claimedTargets);
	}

	findNearestEnemy(sourceX: number, sourceY: number, enemiesGroup: EnemyGroupLike | null, radius: number = this.scanRadius, excludeTargets: Set<EnemySprite> | null = null): EnemySprite | null {
		return movement.findNearestEnemy(this, sourceX, sourceY, enemiesGroup, radius, excludeTargets);
	}

	registerSwordHit(sword: OrbitSword | null, enemy: EnemySprite): void {
		hits.registerSwordHit(this, sword, enemy);
	}

	handleSwordEnemyOverlap(sword: OrbitSword | null, enemy: EnemySprite): void {
		hits.handleSwordEnemyOverlap(this, sword, enemy);
	}

	registerOrbitHit(sword: OrbitSword | null, enemy: EnemySprite): void {
		hits.registerOrbitHit(this, sword, enemy);
	}

	startReturningSword(sword: OrbitSword | null): void {
		movement.startReturningSword(this, sword);
	}

	finishReturningSword(player: PlayerSprite | null, sword: OrbitSword | null): void {
		movement.finishReturningSword(this, player, sword);
	}

	setSwordTarget(sword: OrbitSword | null, target: EnemySprite | null): void {
		movement.setSwordTarget(this, sword, target);
	}

	// Build a sword's typed-damage payload (physical/magic + penetration)
	getDamageInfo(sword: OrbitSword | null): DamageInfo {
		const definition: Partial<OrbitSwordDefinition> = sword?.definition ?? {};
		return {
			damageType: definition.damageType ?? 'physical',
			pen: definition.damageType === 'magic' ? (definition.magicPen ?? 0) : (definition.physicalPen ?? 0),
		};
	}

	applyDamage(enemy: EnemySprite, amount: number, isCrit = false, damageInfo: DamageInfo | null = null): void {
		hits.applyDamage(this, enemy, amount, isCrit, damageInfo);
	}

	snapSwordToOrbit(player: PlayerSprite, sword: OrbitSword): void {
		movement.snapSwordToOrbit(this, player, sword);
	}

	getSwordDefinition(slot: number): OrbitSwordDefinition {
		if (!this.swordCatalog.length) {
			return {} as OrbitSwordDefinition;
		}

		return this.swordCatalog[Math.min(slot, this.swordCatalog.length - 1)] ?? ({} as OrbitSwordDefinition);
	}

	getOrbitPosition(player: PlayerSprite, sword: OrbitSword): OrbitPosition {
		return movement.getOrbitPosition(this, player, sword);
	}

	getEnemyChildren(enemiesGroup: EnemyGroupLike | null): EnemySprite[] {
		if (!enemiesGroup) {
			return [];
		}

		if (typeof enemiesGroup.getChildren === 'function') {
			return enemiesGroup.getChildren() as EnemySprite[];
		}

		if (Array.isArray(enemiesGroup.children?.entries)) {
			return enemiesGroup.children.entries as EnemySprite[];
		}

		return [];
	}

	isValidEnemy(enemy: EnemySprite | null | undefined): enemy is EnemySprite {
		return Boolean(enemy && enemy.active !== false && enemy.visible !== false && !enemy.destroyed);
	}
}
