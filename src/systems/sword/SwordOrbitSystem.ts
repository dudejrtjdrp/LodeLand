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
import { playerDamageGrowth } from '../../logic/growth';
import { SWORD_LEVEL_COOLDOWN_BONUS, SWORD_LEVEL_DAMAGE_BONUS } from '../../logic/swordGrowth';
import { canUnlockSlotAtRound, slotEnhanceCost, slotEnhanceSuccessRate, slotUnlockCost, slotUnlockRound } from '../../logic/slots';
import { countElements, hasResonance, ultimateUnlocked } from '../../logic/resonance';
import { recordSwordSeen } from '../../core/codex';
import type { SwordBehavior } from '../../logic/swordBehavior';
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
	RingLayout,
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
	/** 런 시작 시점(특성 적용 후) 기준값 — 스탯 상한 계산용. GameScene 이 스냅샷. */
	baseRadius: number;
	baseOrbitSpeed: number;
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
	/**
	 * 키퍼 레벨 성장 배율 (logic/growth.ts playerDamageGrowth) — damageMultiplier 와 별개로
	 * **곱**해진다 (damageMultiplier 는 가산식). setGrowthLevel 이 갱신하고 검 스탯을 재계산한다.
	 */
	growthDamageMult: number;
	cooldownMultiplier: number;
	launchSpeedMultiplier: number;
	bonusHits: number;
	evolutionRecipes: EvolutionRecipe[];
	noLaunch: boolean;
	orbitDamageMult: number;
	cleaveTargets: number;
	cleaveRadius: number;
	/** 연쇄/검기 이펙트 전역 속도 제한 타임스탬프 (성능) */
	lastChainFxAt = 0;
	lastCleaveFxAt = 0;
	lastBlastFxAt = 0;
	maxSwordLevel: number;
	levelDamageBonus: number;
	levelCooldownBonus: number;

	// 이중 궤도: 슬롯 0~(innerRingSlots-1) = 내부 원, 이후 슬롯 = 외부 원(역회전)
	innerRingSlots: number;
	innerRingRadiusMult: number;
	outerRingRadiusMult: number;
	outerRingDirection: 1 | -1;

	// Slot economy: unlock -> enhance (+10 max, chance-based) -> trait sockets
	slotConfig: Partial<SlotConfigSpec>;
	unlockedSlots: number;
	slotStates: SlotState[];

	// 원소 세트: 2자루 = 공명(효과 1.5배), 둘 다 Lv3+ = 필살기
	setAnnounced: Set<string>;
	ultimateTimers: Record<UltimateElement, number>;
	ultimateIntervals: Record<UltimateElement, number>;

	baseAngle: number;
	/** 검별 누적 딜 (FLAMEOUT/RETURN 정산 화면용) — key: 검 이름 또는 'RESONANCE' 등 시스템 라벨 */
	runDamage: Record<string, number>;
	swords: OrbitSword[];
	reserve: ReserveSword[]; // 둥우리: 장착하지 않은 보유 검 [{definition, level}]
	enemyGroup: EnemyGroupLike | null;
	hudIcons: Array<Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Graphics | Phaser.GameObjects.NineSlice>;
	hudTooltip?: Phaser.GameObjects.Text | Phaser.GameObjects.Container | null;
	/** 홰 스트립 상태 링 (hud.updateStateRings 전용). */
	hudStateG?: Phaser.GameObjects.Graphics | null;
	hudSlotRects?: Array<{ x: number; y: number; size: number }>;
	hudStateSig?: string;

	// ── AugmentSystem 이 기록하는 확장 필드 (movement/hitResolution/loadout 이 소비한다)
	echoLaunchChance = 0;
	resonanceScale = 1.5;
	returnDamagePct = 0;
	twinLaunchChance = 0;
	dualOrbit = false;
	awakenings: Record<string, string> = {};
	/** 동반 출격 재귀 방지 락 (movement.startLaunchedSword 전용). */
	twinLaunchLock = false;
	/** 스킬 트리 [회전베기]: 이 시각까지는 궤도 위의 검도 접촉 피해를 준다 (noLaunch 가 아니어도). */
	orbitContactUntil = 0;

	constructor(scene: GameScene | null = null, options: SwordOrbitOptions = {}) {
		this.scene = scene;

		this.radius = options.radius ?? 140;
		this.orbitSpeed = options.orbitSpeed ?? 2;
		this.baseRadius = this.radius;
		this.baseOrbitSpeed = this.orbitSpeed;
		this.launchDuration = options.launchDuration ?? 420;
		this.returnSpeed = options.returnSpeed ?? 350;
		this.scanRadius = options.scanRadius ?? 300;
		this.closeScanRadius = options.closeScanRadius ?? 120;
		this.minSwords = options.minSwords ?? 1;
		this.maxSwords = options.maxSwords ?? 7; // 이중 궤도: 안쪽 3 + 바깥 4
		this.rotationOffset = options.rotationOffset ?? -5 * Math.PI / 4;
		this.returnLerp = options.returnLerp ?? 0.16;
		this.swordCatalog = Array.isArray(options.swordCatalog) ? options.swordCatalog : [];
		this.damageMultiplier = options.damageMultiplier ?? 1;
		this.growthDamageMult = 1;
		this.cooldownMultiplier = options.cooldownMultiplier ?? 1;
		this.launchSpeedMultiplier = options.launchSpeedMultiplier ?? 1;
		this.bonusHits = options.bonusHits ?? 0;
		this.evolutionRecipes = Array.isArray(options.evolutionRecipes) ? options.evolutionRecipes : evolutionCatalog;
		this.noLaunch = options.noLaunch ?? false;
		this.orbitDamageMult = options.orbitDamageMult ?? 1;
		this.cleaveTargets = options.cleaveTargets ?? 0;
		this.cleaveRadius = options.cleaveRadius ?? 140;
		this.maxSwordLevel = options.maxSwordLevel ?? 5;
		this.innerRingSlots = options.innerRingSlots ?? 3;
		this.innerRingRadiusMult = options.innerRingRadiusMult ?? 0.8;
		this.outerRingRadiusMult = options.outerRingRadiusMult ?? 1.4;
		this.outerRingDirection = options.outerRingDirection ?? -1;
		this.levelDamageBonus = SWORD_LEVEL_DAMAGE_BONUS;   // 검 레벨당 피해 (logic/swordGrowth.ts)
		this.levelCooldownBonus = SWORD_LEVEL_COOLDOWN_BONUS; // 검 레벨당 대기 감소

		// Slot economy: unlock -> enhance (+10 max, chance-based) -> trait sockets
		const slotConfig: Partial<SlotConfigSpec> = shopCatalog.slots ?? {};
		this.slotConfig = slotConfig;
		this.unlockedSlots = Math.min(options.startUnlockedSlots ?? slotConfig.startUnlocked ?? 2, this.maxSwords);
		this.slotStates = Array.from({ length: Math.max(this.maxSwords, 1) }, (_, index) => ({
			index,
			enhance: 0,
			traits: [],
		}));

		// 원소 세트: 2자루 = 공명(효과 1.5배), 둘 다 Lv3+ = 필살기
		this.setAnnounced = new Set();
		this.ultimateTimers = {
			fire: 0, electric: 0, void: 0, ice: 0, poison: 0, gold: 0, blood: 0, wind: 0,
		};
		this.ultimateIntervals = {
			fire: 8000, electric: 4000, void: 15000,
			ice: 9000, poison: 7000, gold: 12000, blood: 10000, wind: 6000,
		};
		this.baseAngle = 0;
		this.runDamage = {};
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

	/**
	 * 검 획득 공통 경로 (상자·레벨업 보상 등): 이미 보유한 검이면 중복 보유하지
	 * 않고 그 검을 합성해 레벨 +1. 미보유면 빈 자리에 장착, 만석이면 보관함으로.
	 * 반환값은 실제로 일어난 일 — 'merged' | 'equipped' | 'reserved' | false(만렙 중복).
	 */
	acquireSword(
		scene: GameScene | null,
		rawDefinition: OrbitSwordDefinition,
	): 'merged' | 'equipped' | 'reserved' | false {
		// 키퍼 고유 메커닉: GILDER [감정사의 내기] — 주워 든 검을 감정대에 올린다.
		// (상점에서 값을 치르고 고른 검은 이 경로를 타지 않는다)
		const definition = (this.scene ?? scene)?.keeper?.gambleSword?.(rawDefinition) ?? rawDefinition;
		const equipped = this.getSwordById(definition.id);
		if (equipped) {
			return this.levelUpSword(equipped) ? 'merged' : false;
		}
		const reserveIndex = this.findReserveIndexById(definition.id);
		if (reserveIndex >= 0) {
			const entry = this.reserve[reserveIndex];
			if ((entry.level ?? 1) >= (this.maxSwordLevel ?? 5)) {
				return false;
			}
			entry.level = Math.min(this.maxSwordLevel ?? 5, (entry.level ?? 1) + 1);
			return 'merged';
		}
		if (this.swords.length < this.getEffectiveMaxSwords()) {
			if (this.addSword(scene, definition)) {
				return 'equipped';
			}
		}
		this.addToReserve(definition);
		return 'reserved';
	}

	/** 키퍼 레벨이 바뀌었을 때: 성장 배율 갱신 + 장착 검 전부 재계산 (2026-09-04). */
	setGrowthLevel(level: number): void {
		const next = playerDamageGrowth(level);
		if (Math.abs(next - this.growthDamageMult) < 1e-9) {
			return;
		}
		this.growthDamageMult = next;
		for (const sword of this.swords) {
			this.recalculateSwordStats(sword);
		}
	}

	/**
	 * 고정 피해 수치(폭탄 200, 부활 충격파 500, 세트 스킬 26 등)를 현재 피해 규모로 환산하는 배율.
	 * 검 피해와 같은 성장(레벨 성장 × 가산 배율)을 태운다.
	 */
	flatDamageScale(): number {
		return this.growthDamageMult * Math.max(0.1, this.damageMultiplier ?? 1);
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

	/** 다음 칸의 해방 라운드 게이트 (완료 라운드 기준, logic/slots.ts). */
	nextSlotUnlockRound(): number {
		return slotUnlockRound(this.slotConfig, this.unlockedSlots);
	}

	/** 완료 라운드 `round` 에서 다음 칸을 열 수 있는가. */
	canUnlockSlotAt(round: number): boolean {
		return this.unlockedSlots < this.maxSwords && canUnlockSlotAtRound(this.slotConfig, this.unlockedSlots, round);
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

	/** 각인 새기기 최소 검 레벨 (각인은 검 귀속 — 2026-08-28). */
	static readonly TRAIT_MIN_LEVEL = 3;

	canAddTrait(slotIndex: number): boolean {
		const sword = this.swords[slotIndex] ?? null;
		return Boolean(sword
			&& (sword.level ?? 1) >= SwordOrbitSystem.TRAIT_MIN_LEVEL
			&& (sword.traits?.length ?? 0) < (this.slotConfig.traitSockets ?? 3));
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

	// REFORGE 모달용: 레시피별 보유 상태 (미보유 재료는 UI에서 ??? 처리)
	getReforgeStates(): fusion.ReforgeRecipeState[] {
		return fusion.getReforgeStates(this);
	}

	// 명시적 조합 — 장착+ROOST에서 재료 소모, 결과는 빈 PERCH 우선 지급
	reforge(recipeIndex: number): boolean {
		return fusion.reforge(this, recipeIndex);
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
		this.recomputeRingLayout();
	}

	/**
	 * 각 검의 링 소속·링 내 순번·링 크기를 미리 계산해 둔다.
	 * getRingLayout이 호출될 때마다 filter+indexOf 하던 것을 없애기 위한 것 — 링 구성은
	 * 장착/해제/융합 때만 바뀌므로 그 시점에 한 번만 계산하면 된다.
	 * (검 7자루 × 프레임당 2회 호출 = 초당 840개 배열 할당을 0으로)
	 */
	recomputeRingLayout(): void {
		// 링 구성이 바뀌었다는 건 검 목록이 바뀌었다는 뜻 — 원소 집계 캐시도 함께 버린다.
		this.invalidateElementCache();
		let innerCount = 0;
		let outerCount = 0;
		for (const sword of this.swords) {
			const inner = sword.slot < this.innerRingSlots;
			sword._ringInner = inner;
			sword._ringIndex = inner ? innerCount : outerCount;
			if (inner) {
				innerCount += 1;
			} else {
				outerCount += 1;
			}
		}
		for (const sword of this.swords) {
			sword._ringCount = sword._ringInner ? innerCount : outerCount;
		}
	}

	// ---------------------------------------------------------------
	// 창고(Reserve): 장착 목록과 분리된 보유 검. 드래그로 장착/해제.
	// ---------------------------------------------------------------

	getLoadout(): LoadoutEntry[] {
		return this.swords.map((sword) => ({
			definition: sword.definition,
			level: sword.level,
			traits: [...(sword.traits ?? [])],
		}));
	}

	// Rebuild all equipped sword sprites from a data list (safe way to reorder)
	rebuildLoadout(loadoutList: LoadoutEntry[]): void {
		loadout.rebuildLoadout(this, loadoutList);
	}

	addToReserve(definition: OrbitSwordDefinition, level = 1, traits: string[] = []): void {
		this.reserve.push({ definition, level, traits: [...traits] });
		// 도감 기록 (장착 경로는 loadout.addSword 가 담당)
		if (recordSwordSeen(definition?.id)) {
			this.scene?.achievements?.onCodexRecorded?.();
		}
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

		// 반환된 Collider를 검에 붙여 둔다 — removeSword가 이걸 제거하지 않으면
		// 융합/재장착마다 죽은 콜라이더가 world.colliders에 영구 누적된다.
		sword._overlapCollider = this.scene.physics.add.overlap(
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
		if (this.sealedCount > 0) {
			this.expireSeals();
		}
	}

	// ---------------------------------------------------------------
	// 검 봉인 (보스 스킬 'seal', 2026-09-02)
	//
	// 봉인된 검은 궤도를 돌지만 **피해를 주지 않는다**. 파훼 경로는 항상 열려 있다 —
	// 귀소(SPACE)로 무리를 불러들이면 사슬이 즉시 끊어진다 (ActiveSkillSystem.useRecall).
	// 핫패스 비용: sealedCount 가 0 이면 검사조차 하지 않는다.
	// ---------------------------------------------------------------

	/** 지금 봉인된 검 수 (0 이면 관련 검사를 전부 건너뛴다) */
	sealedCount = 0;

	/** 이 검이 지금 봉인 상태인가 (피해 판정이 읽는다) */
	isSealed(sword: OrbitSword | null | undefined): boolean {
		if (!sword || this.sealedCount === 0) {
			return false;
		}
		return (this.scene?.time?.now ?? 0) < (sword._sealedUntil ?? 0);
	}

	/**
	 * 궤도 검 최대 `count` 자루를 `durationMs` 동안 봉인한다.
	 * 이미 봉인된 검·꽂힌 검은 건너뛴다. @returns 실제로 봉인한 수
	 */
	sealSwords(count = 1, durationMs = 5000): number {
		const now = this.scene?.time?.now ?? 0;
		let sealed = 0;
		for (const sword of this.swords) {
			if (sealed >= count) {
				break;
			}
			if (!sword || now < (sword._sealedUntil ?? 0)) {
				continue;
			}
			sword._sealedUntil = now + durationMs;
			sword.setTint(0x5b6472);
			sword.setAlpha(0.55);
			sealed += 1;
			this.sealedCount += 1;
		}
		return sealed;
	}

	/** 봉인 전부 해제 (귀소). @returns 끊어낸 수 */
	clearSeals(): number {
		if (this.sealedCount === 0) {
			return 0;
		}
		let broken = 0;
		for (const sword of this.swords) {
			if ((sword?._sealedUntil ?? 0) > 0) {
				sword._sealedUntil = 0;
				sword.clearTint();
				sword.setAlpha(1);
				broken += 1;
			}
		}
		this.sealedCount = 0;
		return broken;
	}

	/** 만료된 봉인을 되돌린다 (update 에서 봉인이 있을 때만 호출) */
	private expireSeals(): void {
		const now = this.scene?.time?.now ?? 0;
		let remaining = 0;
		for (const sword of this.swords) {
			const until = sword?._sealedUntil ?? 0;
			if (until <= 0) {
				continue;
			}
			if (now >= until) {
				sword._sealedUntil = 0;
				sword.clearTint();
				sword.setAlpha(1);
			} else {
				remaining += 1;
			}
		}
		this.sealedCount = remaining;
	}

	// ---------------------------------------------------------------
	// 원소 세트: 공명(1.5배) + 필살기
	// ---------------------------------------------------------------

	/**
	 * 원소 집계 캐시. 검 구성(장착/해제/융합/레벨업)이 바뀔 때만 무효화된다.
	 * 예전에는 updateUltimates가 프레임마다 8원소 × (filter + map) = 16개 배열을,
	 * hasSetResonance는 명중마다 2개 배열을 새로 만들었다.
	 */
	private elementCountsCache: Record<string, number> | null = null;
	private unlockedUltimatesCache: Set<string> | null = null;

	/** 검 구성이나 레벨이 바뀐 뒤 호출 — 다음 조회 때 다시 계산된다. */
	invalidateElementCache(): void {
		this.elementCountsCache = null;
		this.unlockedUltimatesCache = null;
		// 원소 세트(2~7단계)도 같은 타이밍에 다시 계산한다.
		// getElementCounts() 를 다시 부르므로 캐시를 비운 뒤에 호출해야 한다.
		this.scene?.elementSets?.recompute();
	}

	getElementCounts(): Record<string, number> {
		if (!this.elementCountsCache) {
			this.elementCountsCache = countElements(this.swords.map((sword) => sword.definition?.element));
		}
		return this.elementCountsCache;
	}

	/**
	 * 장착 검의 주 원소 (가장 많은 원소, 동수면 앞 슬롯 우선). 원소 검이 없으면 null.
	 * 필살기 게이지(ActiveSkillSystem)가 어떤 필살기를 쓸지 이걸로 정한다.
	 */
	dominantElement(): UltimateElement | null {
		const counts = this.getElementCounts();
		let best: string | null = null;
		let bestCount = 0;
		for (const sword of this.swords) {
			const element = sword.definition?.element;
			if (!element) {
				continue;
			}
			const count = counts[element] ?? 0;
			if (count > bestCount) {
				best = element;
				bestCount = count;
			}
		}
		return best as UltimateElement | null;
	}

	hasSetResonance(element: string | null | undefined): boolean {
		return hasResonance(this.getElementCounts(), element);
	}

	isUltimateUnlocked(element: string): boolean {
		if (!this.unlockedUltimatesCache) {
			const unlocked = new Set<string>();
			// 원소별 레벨 목록을 한 번만 모아 8원소를 동시에 판정한다.
			const levelsByElement = new Map<string, number[]>();
			for (const sword of this.swords) {
				const key = sword.definition?.element;
				if (!key) {
					continue;
				}
				let levels = levelsByElement.get(key);
				if (!levels) {
					levels = [];
					levelsByElement.set(key, levels);
				}
				levels.push(sword.level ?? 1);
			}
			for (const [key, levels] of levelsByElement) {
				if (ultimateUnlocked(levels)) {
					unlocked.add(key);
				}
			}
			this.unlockedUltimatesCache = unlocked;
		}
		return this.unlockedUltimatesCache.has(element);
	}

	checkSetAnnouncements(): void {
		// 장착·융합·레벨업 직후에 불리는 공통 훅 — 여기서 캐시를 버리면
		// 레벨 변화(필살기 해금 조건)도 빠짐없이 반영된다.
		this.invalidateElementCache();
		resonance.checkSetAnnouncements(this);
	}

	updateUltimates(player: PlayerSprite | null, delta: number): void {
		resonance.updateUltimates(this, player, delta);
	}

	/** 자동 필살기(구 타이머 방식) 스위치 — 기본 off (2026-09-04 게이지 방식으로 전환). */
	autoUltimates = false;

	castUltimate(element: UltimateElement, player: PlayerSprite, options?: resonance.UltimateCastOptions): void {
		resonance.castUltimate(this, element, player, options);
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

	/** 관통 거동(선회검·참격검): 경로가 스치는 적을 출격당 1회씩 벤다. */
	registerPierceHit(sword: OrbitSword | null, enemy: EnemySprite): void {
		hits.registerPierceHit(this, sword, enemy);
	}

	/** 말뚝검 오라 1틱 (꽂힌 자리 주변 지속 피해). */
	applyStakeAura(sword: OrbitSword | null): void {
		hits.applyStakeAura(this, sword);
	}

	/** 말뚝검: 명중 지점에 꽂는다 (그 자리의 궤도는 비워진다). */
	startPlantedSword(sword: OrbitSword | null): void {
		movement.startPlantedSword(this, sword);
	}

	/** 이 검의 거동 아키타입. */
	behaviorOf(sword: OrbitSword): SwordBehavior {
		return movement.behaviorFor(sword);
	}

	/** 지금 꽂혀 있어 궤도가 비어 있는 자리(슬롯) 번호들. */
	plantedSlots(): number[] {
		const out: number[] = [];
		for (const sword of this.swords) {
			if (sword.state === 'planted') {
				out.push(sword.slot);
			}
		}
		return out;
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
		// 원소 세트 관통 보너스(독 3세트 +10%, 공허 2세트 +15%)를 얹는다.
		// 관통 스탯(player.pen)은 여기가 아니라 EnemyManager.takeDamage 에서 더한다 —
		// 스킬·세트 발동처럼 getDamageInfo 를 거치지 않는 경로에도 걸려야 하므로.
		const setPen = this.scene?.elementSets?.mods.pen ?? 0;
		return {
			damageType: definition.damageType ?? 'physical',
			pen: (definition.damageType === 'magic' ? (definition.magicPen ?? 0) : (definition.physicalPen ?? 0)) + setPen,
			// 적 특성(몸체) 상성 판정용 — EnemyManager.takeDamage 가 약점/저항 배율을 곱한다
			element: definition.element,
		};
	}

	applyDamage(enemy: EnemySprite, amount: number, isCrit = false, damageInfo: DamageInfo | null = null): void {
		hits.applyDamage(this, enemy, amount, isCrit, damageInfo);
	}

	/** 정산용 딜 기록 — source가 검이면 검 이름, 문자열이면 시스템 라벨로 집계 */
	recordDamage(source: OrbitSword | string | null | undefined, amount: number): void {
		if (!amount || amount <= 0) {
			return;
		}
		const key = typeof source === 'string'
			? source
			: (source?.definition?.name ?? source?.definition?.id ?? '무리');
		this.runDamage[key] = (this.runDamage[key] ?? 0) + Math.round(amount);
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

	/** 이중 궤도: 검이 속한 링(내부/외부)의 반지름·방향·배치 정보. */
	getRingLayout(sword: OrbitSword): RingLayout {
		return movement.getRingLayout(this, sword);
	}

	/** 내부 링 실제 반지름. */
	getInnerRingRadius(): number {
		return this.radius * this.innerRingRadiusMult;
	}

	/** 외부 링 실제 반지름. */
	getOuterRingRadius(): number {
		return this.radius * this.outerRingRadiusMult;
	}

	/** 외부 링에 검이 하나라도 있는가. */
	hasOuterRingSwords(): boolean {
		return this.swords.some((sword) => sword.slot >= this.innerRingSlots);
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
		// EnemyManager.isAliveEnemy와 같은 이유로 `visible`은 보지 않는다 —
		// 화면 밖 컬링으로 숨긴 적도 여전히 살아 있고 검의 타격 대상이어야 한다.
		return Boolean(enemy && enemy.active !== false && !enemy.destroyed);
	}
}
