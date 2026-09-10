import Phaser from 'phaser';
import rawUpgradeCatalog from '../data/upgradeCatalog.json';
import type GameScene from '../scenes/GameScene';
import type { RarityId, RaritySpec, SwordDefinition, UpgradeCatalog, UpgradeDefinition } from '../types/catalogs';
import type ProgressionSystem from './ProgressionSystem';
import type { ProgressionPlayer } from './ProgressionSystem';
import { GameEvents } from '../core/events';
import { formatHudNumber, formatPct, playerHpGrowth } from '../logic/growth';
import { screenShakeEnabled, reduceMotion } from '../core/settings';
import {
	STAT_CAPS, UNLOCK_CAPS, clampCooldownMultiplier, clampLaunchSpeedMultiplier,
	clampMagnetRadius, clampMoveSpeed, clampOrbitRadius, clampOrbitSpeed, moveSpeedCap,
} from '../logic/statCaps';
import {
	FONT, UI, style, RARITY_THEME, ELEMENT_THEME, rarityCard, insetPanel, banner, diamond, keycap, dimVignette, divider,
	createUiRoot, iconImage, type UiRoot, TEXT_RESOLUTION,
} from '../ui/theme';
import { Tooltip, withKeywordFooter } from '../ui/tooltip';

const upgradeCatalog = rawUpgradeCatalog as unknown as UpgradeCatalog;

const CHOICE_COUNT = 4;

/**
 * Not every upgrade defines a value for every rarity, so the catalog's
 * Record<RarityId, number> is treated as partial at the lookup sites.
 */
type UpgradeValues = Partial<Record<RarityId, number>>;

/** Minimal structural view of SwordOrbitSystem (converted by another agent). */
interface SwordOrbitLike {
	swords: unknown[];
	maxSwords: number;
	getEffectiveMaxSwords?: () => number;
	damageMultiplier?: number;
	radius: number;
	orbitSpeed: number;
	baseRadius?: number;
	baseOrbitSpeed?: number;
	cooldownMultiplier?: number;
	launchSpeedMultiplier?: number;
	bonusHits?: number;
	cleaveTargets?: number;
	applyCooldownMultiplier?: (multiplier: number) => void;
	applyLaunchSpeedMultiplier?: (multiplier: number) => void;
	addSword?: (scene: GameScene, definition?: SwordDefinition | null) => unknown;
	acquireSword?: (scene: GameScene | null, definition: SwordDefinition) => 'merged' | 'equipped' | 'reserved' | false;
	maxSwordLevel?: number;
	reserve?: Array<{ level?: number }>;
	findReserveIndexById?: (id: string) => number;
	checkFusions?: () => void;
	addBonusHits?: (value: number) => void;
	addCleave?: (value: number) => void;
}

export interface UpgradeChoice {
	upgrade: UpgradeDefinition;
	rarity: RaritySpec;
	value: number;
	swordDefinition: SwordDefinition | null;
}

export interface LevelUpCard {
	container: Phaser.GameObjects.Container;
	choice: UpgradeChoice;
	/** 등장 애니메이션이 끝났을 때의 제자리 y — 중간에 끊겼을 때 여기로 스냅한다 */
	homeY: number;
	/** 진행 중인 등장 트윈 (끝나면 null) */
	entrance: Phaser.Tweens.Tween | null;
	/** 확대/축소 전용 트윈 — scale 의 소유자는 항상 이 하나뿐이어야 한다 */
	scaleTween: Phaser.Tweens.Tween | null;
	/** 전설 카드 테두리 깜빡임 (repeat:-1 이라 destroyUi 에서 직접 꺼야 한다) */
	flicker: Phaser.Tweens.Tween | null;
}

export interface LevelUpSystemOptions {
	swordOrbit?: SwordOrbitLike | null;
	progression?: ProgressionSystem | null;
	swordCatalog?: SwordDefinition[];
}

export default class LevelUpSystem {
	scene: GameScene;
	swordOrbit: SwordOrbitLike | null;
	progression: ProgressionSystem | null;
	swordCatalog: SwordDefinition[];
	rarities: RaritySpec[];
	upgrades: UpgradeDefinition[];
	swordTierByRarity: Record<RarityId, number[]>;
	isOpen: boolean;
	pendingChoices: number;
	uiObjects: Phaser.GameObjects.GameObject[];
	cards: LevelUpCard[];
	/** 게임패드/방향키 포커스 카드 (-1 = 포커스 없음 — 키보드 기본 상태) */
	focusIndex = -1;
	keyHandler: ((event: KeyboardEvent) => void) | null;
	rerollUsed = false;
	ui: UiRoot | null = null;
	backdrop: Phaser.GameObjects.GameObject[] = [];
	/** 카드 호버 툴팁 (공용 ui/tooltip.ts) */
	tooltip: Tooltip | null = null;

	constructor(scene: GameScene, options: LevelUpSystemOptions = {}) {
		this.scene = scene;
		this.swordOrbit = options.swordOrbit ?? null;
		this.progression = options.progression ?? null;
		this.swordCatalog = Array.isArray(options.swordCatalog) ? options.swordCatalog : [];

		this.rarities = upgradeCatalog.rarities;
		this.upgrades = upgradeCatalog.upgrades;
		this.swordTierByRarity = upgradeCatalog.swordTierByRarity;

		this.isOpen = false;
		this.pendingChoices = 0;
		this.uiObjects = [];
		this.cards = [];
		this.keyHandler = null;
	}

	enqueue(): void {
		this.pendingChoices += 1;

		if (!this.isOpen) {
			this.open();
		}
	}

	open(): void {
		if (this.isOpen || this.pendingChoices <= 0) {
			return;
		}

		this.isOpen = true;
		this.pendingChoices -= 1;
		this.rerollUsed = false;

		this.scene.soundSystem?.play('levelup');
		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.setGameHudVisible?.(false);

		const choices = this.rollChoices();
		this.buildUi(choices);
	}

	// R — 새로고침 (선택지 1회 리롤)
	reroll(): void {
		if (!this.isOpen || this.rerollUsed) {
			return;
		}
		this.rerollUsed = true;
		this.scene.soundSystem?.play('click', { volume: 0.5 });
		this.destroyUi();
		this.buildUi(this.rollChoices());
	}

	close(): void {
		this.destroyUi();
		this.isOpen = false;

		if (this.pendingChoices > 0) {
			// Chained level-ups: open the next selection immediately.
			this.open();
			return;
		}

		if (!this.scene.shopSystem?.isOpen) {
			this.scene.setGameHudVisible?.(true);
		}

		if (!this.scene.shopSystem?.isOpen && !this.scene.isPaused) {
			this.scene.physics.resume();
		}
	}

	// ---------------------------------------------------------------
	// Rolling
	// ---------------------------------------------------------------

	getLuck(): number {
		return this.scene.player?.luck ?? 0;
	}

	getPlayerLevel(): number {
		return (this.scene.player as ProgressionPlayer | null)?.level ?? this.progression?.level ?? 1;
	}

	// TFT-style: base odds come from the player's level bracket.
	// A weight of 0 stays 0 - luck amplifies unlocked tiers but never
	// unlocks a tier before its level.
	getCurrentWeights(): number[] {
		const level = this.getPlayerLevel();
		const luck = this.getLuck();
		const table = upgradeCatalog.oddsByLevel ?? [];

		let row: { minLevel?: number; weights: Partial<Record<RarityId, number>> } = table[0] ?? { weights: {} };
		for (const candidate of table) {
			if (level >= candidate.minLevel) {
				row = candidate;
			}
		}

		return this.rarities.map((rarity) =>
			(row.weights[rarity.id] ?? 0) * (1 + luck * (rarity.luckScale ?? 0)),
		);
	}

	rollRarity(): RaritySpec {
		const weights = this.getCurrentWeights();
		const total = weights.reduce((sum, weight) => sum + weight, 0);

		if (total <= 0) {
			return this.rarities[0];
		}

		let roll = Math.random() * total;

		for (let i = 0; i < this.rarities.length; i += 1) {
			roll -= weights[i];
			if (roll <= 0) {
				return this.rarities[i];
			}
		}

		return this.rarities[0];
	}

	getOddsLabel(): string {
		const weights = this.getCurrentWeights();
		const total = weights.reduce((sum, weight) => sum + weight, 0);

		if (total <= 0) {
			return '';
		}

		return this.rarities
			.map((rarity, index) => ({ rarity, pct: (weights[index] / total) * 100 }))
			.filter((entry) => entry.pct > 0)
			.map((entry) => `${entry.rarity.name} ${entry.pct < 1 ? entry.pct.toFixed(1) : Math.round(entry.pct)}%`)
			.join('  ·  ');
	}

	rollChoices(): UpgradeChoice[] {
		const choices: UpgradeChoice[] = [];
		const usedIds = new Set<string>();

		for (let slot = 0; slot < CHOICE_COUNT; slot += 1) {
			const rarity = this.rollRarity();
			const pool = this.upgrades.filter((upgrade) =>
				(upgrade.values as UpgradeValues)[rarity.id] !== undefined
				&& !usedIds.has(upgrade.id)
				&& this.isUpgradeAvailable(upgrade),
			);

			if (pool.length === 0) {
				// Fall back to any available upgrade at its lowest defined rarity.
				const fallbackPool = this.upgrades.filter((upgrade) => !usedIds.has(upgrade.id) && this.isUpgradeAvailable(upgrade));
				if (fallbackPool.length === 0) {
					continue;
				}
				const fallback = Phaser.Math.RND.pick(fallbackPool);
				const fallbackRarityId = this.rarities.find((r) => (fallback.values as UpgradeValues)[r.id] !== undefined)?.id ?? 'common';
				usedIds.add(fallback.id);
				choices.push(this.makeChoice(fallback, this.rarities.find((r) => r.id === fallbackRarityId)!));
				continue;
			}

			const upgrade = Phaser.Math.RND.pick(pool);
			usedIds.add(upgrade.id);
			choices.push(this.makeChoice(upgrade, rarity));
		}

		return choices;
	}

	// Single random reward (used by treasure chests)
	rollSingleChoice(): UpgradeChoice | null {
		const rarity = this.rollRarity();
		const pool = this.upgrades.filter((upgrade) =>
			(upgrade.values as UpgradeValues)[rarity.id] !== undefined && this.isUpgradeAvailable(upgrade),
		);

		if (pool.length === 0) {
			return null;
		}

		return this.makeChoice(Phaser.Math.RND.pick(pool), rarity);
	}

	isUpgradeAvailable(upgrade: UpgradeDefinition) {
		if (upgrade.type === 'addSword') {
			// 해방된 PERCH 수 기준으로 판정 — maxSwords 기준이면 만석일 때
			// addSword가 조용히 실패해 보상이 증발한다
			const cap = this.swordOrbit?.getEffectiveMaxSwords?.() ?? this.swordOrbit?.maxSwords ?? 0;
			return this.swordOrbit
				&& this.swordOrbit.swords.length < cap
				&& this.swordCatalog.length > 0;
		}

		// 스킬 숙련: 아직 최대가 아닌 스킬만 (2026-09-04)
		if (upgrade.type === 'skillLevel') {
			const skills = this.scene.activeSkills;
			return Boolean(upgrade.skill && skills?.canLevelUp?.(upgrade.skill));
		}

		// 상한 도달 스탯은 선택지에서 제외 (statCaps 참조)
		const orbit = this.swordOrbit;
		const player = this.scene.player;
		const EPS = 1e-9;
		switch (upgrade.type) {
			case 'moveSpeedMultiplier':
				return !player?.baseMoveSpeed
					|| (player.moveSpeed ?? 0) < moveSpeedCap(player.baseMoveSpeed) - EPS;
			case 'magnetMultiplier':
				return !this.progression?.baseMagnetRadius
					|| this.progression.magnetRadius < this.progression.baseMagnetRadius * STAT_CAPS.magnetMult - EPS;
			case 'orbitRadiusMultiplier':
				return !orbit?.baseRadius || orbit.radius < orbit.baseRadius * STAT_CAPS.orbitRadiusMult - EPS;
			case 'orbitSpeedMultiplier':
				return !orbit?.baseOrbitSpeed || orbit.orbitSpeed < orbit.baseOrbitSpeed * STAT_CAPS.orbitSpeedMult - EPS;
			case 'launchSpeedMultiplier':
				return (orbit?.launchSpeedMultiplier ?? 1) < STAT_CAPS.launchSpeedMultiplier - EPS;
			case 'cooldownReduction':
				return (orbit?.cooldownMultiplier ?? 1) > STAT_CAPS.cooldownFloor + EPS;
			// 치명타 확률: 100%에서 카드가 빠지고 처형·관통으로 갈아탄다 (2026-09-04)
			case 'critChanceAdd':
				return (player?.critChance ?? 0) < STAT_CAPS.critChance - EPS;

			// ── 해금 스탯: 대응 기본 스탯이 MAX일 때만 등장, 자체 상한(UNLOCK_CAPS)까지
			case 'dodgeAdd': // STRIDE MAX → EVASION
				return this.isStatMaxed('moveSpeedMultiplier')
					&& (player?.dodgeChance ?? 0) < UNLOCK_CAPS.dodgeChance - EPS;
			case 'xpGainAdd': // MAGNET MAX → INSIGHT
				return this.isStatMaxed('magnetMultiplier')
					&& (this.progression?.xpMultiplier ?? 1) < UNLOCK_CAPS.xpMultiplier - EPS;
			case 'damageReductionAdd': // WIDE ORBIT MAX → BULWARK
				return this.isStatMaxed('orbitRadiusMultiplier')
					&& (player?.damageReduction ?? 0) < UNLOCK_CAPS.damageReduction - EPS;
			case 'lifestealAdd': // QUICKEN MAX → BLOODTHIRST
				return this.isStatMaxed('cooldownReduction')
					&& (player?.lifesteal ?? 0) < UNLOCK_CAPS.lifesteal - EPS;
			case 'goldGainAdd': // FAST ORBIT MAX → MIDAS
				return this.isStatMaxed('orbitSpeedMultiplier')
					&& (player?.goldBonus ?? 0) < UNLOCK_CAPS.goldBonus - EPS;
			case 'hpRegenAdd': // VELOCITY MAX → REKINDLE
				return this.isStatMaxed('launchSpeedMultiplier')
					&& (player?.hpRegen ?? 0) < UNLOCK_CAPS.hpRegen - EPS;
			case 'executeDamageAdd': // CRIT 100% → EXECUTE
				return this.isStatMaxed('critChanceAdd')
					&& (player?.executeDamage ?? 0) < UNLOCK_CAPS.executeDamage - EPS;
			case 'penAdd': // CRIT 100% → PIERCE
				return this.isStatMaxed('critChanceAdd')
					&& (player?.pen ?? 0) < UNLOCK_CAPS.pen - EPS;

			default:
				return true;
		}
	}

	/** 기본 스탯이 상한(STAT_CAPS)에 도달했는지 — 해금 스탯 등장 조건. base 미상이면 false. */
	isStatMaxed(type: string): boolean {
		const orbit = this.swordOrbit;
		const player = this.scene.player;
		const EPS = 1e-9;
		switch (type) {
			case 'moveSpeedMultiplier':
				return Boolean(player?.baseMoveSpeed)
					&& (player!.moveSpeed ?? 0) >= moveSpeedCap(player!.baseMoveSpeed) - EPS;
			case 'magnetMultiplier':
				return Boolean(this.progression?.baseMagnetRadius)
					&& this.progression!.magnetRadius >= this.progression!.baseMagnetRadius! * STAT_CAPS.magnetMult - EPS;
			case 'orbitRadiusMultiplier':
				return Boolean(orbit?.baseRadius) && orbit!.radius >= orbit!.baseRadius! * STAT_CAPS.orbitRadiusMult - EPS;
			case 'orbitSpeedMultiplier':
				return Boolean(orbit?.baseOrbitSpeed) && orbit!.orbitSpeed >= orbit!.baseOrbitSpeed! * STAT_CAPS.orbitSpeedMult - EPS;
			case 'launchSpeedMultiplier':
				return (orbit?.launchSpeedMultiplier ?? 1) >= STAT_CAPS.launchSpeedMultiplier - EPS;
			case 'cooldownReduction':
				return (orbit?.cooldownMultiplier ?? 1) <= STAT_CAPS.cooldownFloor + EPS;
			case 'critChanceAdd':
				return (player?.critChance ?? 0) >= STAT_CAPS.critChance - EPS;
			default:
				return false;
		}
	}

	makeChoice(upgrade: UpgradeDefinition, rarity: RaritySpec): UpgradeChoice {
		const value = (upgrade.values as UpgradeValues)[rarity.id] as number;
		const choice: UpgradeChoice = { upgrade, rarity, value, swordDefinition: null };

		if (upgrade.type === 'addSword') {
			choice.swordDefinition = this.pickSwordForRarity(rarity.id);
		}

		return choice;
	}

	/**
	 * 카드 등급과 같은 rarity 의 검을 카탈로그에서 뽑는다 (mythic·evolved 제외).
	 * 미보유 검 우선, 없으면 보유-미만렙 검(획득 시 합성 레벨업). 해당 등급이
	 * 비면 한 단계씩 낮춰 폴백.
	 */
	pickSwordForRarity(rarityId: RarityId): SwordDefinition | null {
		const order: RarityId[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
		const startIndex = Math.max(0, order.indexOf(rarityId));
		const maxLevel = this.swordOrbit?.maxSwordLevel ?? 5;
		for (let i = startIndex; i < order.length; i += 1) {
			const bucket = this.swordCatalog.filter(
				(sword) => (sword.rarity ?? 'common') === order[i] && !sword.evolved,
			);
			if (bucket.length === 0) {
				continue;
			}
			const ownedLevel = (id: string) => {
				const equipped = this.swordOrbit?.swords?.find?.(
					(s) => (s as { definition?: SwordDefinition }).definition?.id === id,
				);
				if (equipped) {
					return (equipped as { level?: number }).level ?? 1;
				}
				const reserveIndex = this.swordOrbit?.findReserveIndexById?.(id) ?? -1;
				return reserveIndex >= 0 ? (this.swordOrbit?.reserve?.[reserveIndex]?.level ?? 1) : 0;
			};
			const fresh = bucket.filter((sword) => ownedLevel(sword.id) === 0);
			const growable = bucket.filter((sword) => {
				const level = ownedLevel(sword.id);
				return level > 0 && level < maxLevel;
			});
			const pool = fresh.length > 0 ? fresh : growable;
			if (pool.length > 0) {
				return Phaser.Math.RND.pick(pool);
			}
		}
		return null;
	}

	describeChoice(choice: UpgradeChoice): string {
		const { upgrade, value, swordDefinition } = choice;
		// 1% 미만도 살려서 찍는다 — 처형은 픽당 0.n% 라 반올림하면 "+0%"가 된다
		const pct = formatPct(value);
		// 고정 체력 가산은 레벨 성장 배율로 환산된 실제 수치를 보여준다 (logic/growth.ts)
		const shownValue = upgrade.type === 'maxHpFlat'
			? formatHudNumber(Math.round(value * playerHpGrowth(this.progression?.level ?? 1)))
			: `${value}`;

		// 스킬 숙련: 다음 단계의 이름·설명을 그대로
		const nextSkill = upgrade.type === 'skillLevel' && upgrade.skill
			? this.scene.activeSkills?.nextLevelSpec?.(upgrade.skill) : null;
		const skillDesc = nextSkill ? `${nextSkill.name} — ${nextSkill.desc}` : '';

		return upgrade.descTemplate
			.replace('{skillDesc}', skillDesc)
			.replace('{pct}', pct)
			.replace('{value}', shownValue)
			.replace('{swordName}', swordDefinition?.name ?? '검');
	}

	/**
	 * 카드 호버 툴팁 본문 — 효과 · 현재→적용 후 · 등급 안내.
	 * (용어 각주는 ui/tooltip.ts 의 withKeywordFooter 가 사전에서 붙인다)
	 */
	tooltipBodyFor(choice: UpgradeChoice): string {
		const lines: string[] = [this.describeChoice(choice)];
		const readout = this.readoutForChoice(choice);
		if (readout) {
			lines.push(`현재 ${readout.before}  →  ${readout.after}${readout.capped ? '  (최대치)' : ''}`);
		}
		if (choice.upgrade.type === 'addSword' && choice.swordDefinition) {
			const definition = choice.swordDefinition;
			lines.push(`피해 ${definition.damage} · 쿨다운 ${definition.cooldownMs}ms`);
			if (definition.element) {
				lines.push(`속성 ${ELEMENT_THEME[definition.element]?.label ?? definition.element} — 같은 속성 2자루면 공명`);
			}
			if (definition.lore) {
				lines.push(`— ${definition.lore}`);
			}
		}
		lines.push(`등급이 높을수록 같은 항목이라도 수치가 큽니다 (행운이 확률을 올립니다).`);
		return lines.join('\n');
	}

	/** 카드용 "현재 → 적용 후" 수치. addSword 등 수치화가 무의미한 타입은 null. */
	readoutForChoice(choice: UpgradeChoice): { before: string; after: string; capped: boolean } | null {
		const { upgrade, value } = choice;
		const player = this.scene.player;
		const orbit = this.swordOrbit;
		const pct = formatPct;
		const EPS = 1e-9;

		switch (upgrade.type) {
			case 'damageMultiplier': {
				const current = orbit?.damageMultiplier ?? 1;
				return { before: `×${current.toFixed(2)}`, after: `×${(current + value).toFixed(2)}`, capped: false };
			}
			case 'cooldownReduction': {
				const current = orbit?.cooldownMultiplier ?? 1;
				const target = clampCooldownMultiplier(current * (1 - value));
				return { before: `-${pct(1 - current)}`, after: `-${pct(1 - target)}`, capped: target <= STAT_CAPS.cooldownFloor + EPS };
			}
			case 'maxHpFlat': {
				const current = player?.maxHp ?? 100;
				const scaled = Math.round(value * playerHpGrowth(this.progression?.level ?? 1));
				return { before: formatHudNumber(current), after: formatHudNumber(current + scaled), capped: false };
			}
			case 'healPercent': {
				const maxHp = player?.maxHp ?? 100;
				const current = Math.max(0, Math.round(player?.hp ?? 0));
				return { before: `${current}`, after: `${Math.min(maxHp, current + Math.round(maxHp * value))}`, capped: false };
			}
			case 'moveSpeedMultiplier': {
				const current = player?.moveSpeed ?? 150;
				const target = clampMoveSpeed(current * (1 + value), player?.baseMoveSpeed);
				return {
					before: `${Math.round(current)}`,
					after: `${target}`,
					capped: target >= moveSpeedCap(player?.baseMoveSpeed) - EPS,
				};
			}
			case 'critChanceAdd': {
				// 레벨업 경로는 100%에서 멈춘다. 검·세트에서 이미 초과분이 있으면 그건 표기만.
				const current = player?.critChance ?? 0;
				const target = Math.min(STAT_CAPS.critChance, current + value);
				return {
					before: pct(Math.min(1, current)) + (current > 1 ? ` (+${pct(current - 1)}→피해)` : ''),
					after: pct(Math.min(1, target)) + (target > 1 ? ` (+${pct(target - 1)}→피해)` : ''),
					capped: target >= STAT_CAPS.critChance - EPS,
				};
			}
			case 'critDamageAdd': {
				const current = player?.critDamageMultiplier ?? 1;
				return { before: `×${current.toFixed(2)}`, after: `×${(current + value).toFixed(2)}`, capped: false };
			}
			case 'magnetMultiplier': {
				const current = this.progression?.magnetRadius ?? 220;
				const base = this.progression?.baseMagnetRadius;
				const target = clampMagnetRadius(current * (1 + value), base);
				const cap = base ? base * STAT_CAPS.magnetMult : Infinity;
				return { before: `${Math.round(current)}`, after: `${Math.round(target)}`, capped: target >= cap - EPS };
			}
			case 'orbitRadiusMultiplier': {
				const current = orbit?.radius ?? 140;
				const target = clampOrbitRadius(current * (1 + value), orbit?.baseRadius);
				const cap = orbit?.baseRadius ? orbit.baseRadius * STAT_CAPS.orbitRadiusMult : Infinity;
				return { before: `${Math.round(current)}`, after: `${Math.round(target)}`, capped: target >= cap - EPS };
			}
			case 'orbitSpeedMultiplier': {
				const current = orbit?.orbitSpeed ?? 2;
				const target = clampOrbitSpeed(current * (1 + value), orbit?.baseOrbitSpeed);
				const cap = orbit?.baseOrbitSpeed ? orbit.baseOrbitSpeed * STAT_CAPS.orbitSpeedMult : Infinity;
				return { before: current.toFixed(2), after: target.toFixed(2), capped: target >= cap - EPS };
			}
			case 'launchSpeedMultiplier': {
				const current = orbit?.launchSpeedMultiplier ?? 1;
				const target = clampLaunchSpeedMultiplier(current * (1 + value));
				return { before: `×${current.toFixed(2)}`, after: `×${target.toFixed(2)}`, capped: target >= STAT_CAPS.launchSpeedMultiplier - EPS };
			}
			case 'luckAdd': {
				const current = player?.luck ?? 0;
				return { before: current.toFixed(2), after: (current + value).toFixed(2), capped: false };
			}
			case 'bonusHits': {
				const current = orbit?.bonusHits ?? 0;
				return { before: `+${current}`, after: `+${current + value}`, capped: false };
			}
			case 'cleaveAdd': {
				const current = orbit?.cleaveTargets ?? 0;
				return { before: `${current}명`, after: `${current + value}명`, capped: false };
			}
			// ── 해금 스탯 (UNLOCK_CAPS)
			case 'dodgeAdd': {
				const current = player?.dodgeChance ?? 0;
				const target = Math.min(UNLOCK_CAPS.dodgeChance, current + value);
				return { before: pct(current), after: pct(target), capped: target >= UNLOCK_CAPS.dodgeChance - EPS };
			}
			case 'xpGainAdd': {
				const current = this.progression?.xpMultiplier ?? 1;
				const target = Math.min(UNLOCK_CAPS.xpMultiplier, current + value);
				return { before: `+${pct(current - 1)}`, after: `+${pct(target - 1)}`, capped: target >= UNLOCK_CAPS.xpMultiplier - EPS };
			}
			case 'damageReductionAdd': {
				const current = player?.damageReduction ?? 0;
				const target = Math.min(UNLOCK_CAPS.damageReduction, current + value);
				return { before: `-${pct(current)}`, after: `-${pct(target)}`, capped: target >= UNLOCK_CAPS.damageReduction - EPS };
			}
			case 'lifestealAdd': {
				const current = player?.lifesteal ?? 0;
				const target = Math.min(UNLOCK_CAPS.lifesteal, current + value);
				return { before: pct(current), after: pct(target), capped: target >= UNLOCK_CAPS.lifesteal - EPS };
			}
			case 'goldGainAdd': {
				const current = player?.goldBonus ?? 0;
				const target = Math.min(UNLOCK_CAPS.goldBonus, current + value);
				return { before: `+${pct(current)}`, after: `+${pct(target)}`, capped: target >= UNLOCK_CAPS.goldBonus - EPS };
			}
			case 'hpRegenAdd': {
				const current = player?.hpRegen ?? 0;
				const target = Math.min(UNLOCK_CAPS.hpRegen, current + value);
				return { before: `${current.toFixed(1)}/s`, after: `${target.toFixed(1)}/s`, capped: target >= UNLOCK_CAPS.hpRegen - EPS };
			}
			case 'executeDamageAdd': {
				const current = player?.executeDamage ?? 0;
				const target = Math.min(UNLOCK_CAPS.executeDamage, current + value);
				return { before: `+${pct(current)}`, after: `+${pct(target)}`, capped: target >= UNLOCK_CAPS.executeDamage - EPS };
			}
			case 'penAdd': {
				const current = player?.pen ?? 0;
				const target = Math.min(UNLOCK_CAPS.pen, current + value);
				return { before: pct(current), after: pct(target), capped: target >= UNLOCK_CAPS.pen - EPS };
			}
			default:
				return null;
		}
	}

	// ---------------------------------------------------------------
	// Applying
	// ---------------------------------------------------------------

	applyChoice(choice: UpgradeChoice): void {
		const player = this.scene.player;
		const { upgrade, value } = choice;

		switch (upgrade.type) {
			case 'damageMultiplier':
				if (this.swordOrbit) {
					this.swordOrbit.damageMultiplier = (this.swordOrbit.damageMultiplier ?? 1) + value;
				}
				break;
			case 'cooldownReduction':
				if (this.swordOrbit) {
					// 하한(×0.35)을 넘지 않는 만큼만 감소
					const current = this.swordOrbit.cooldownMultiplier ?? 1;
					const target = clampCooldownMultiplier(current * (1 - value));
					if (target < current) {
						this.swordOrbit.applyCooldownMultiplier?.(target / current);
					}
				}
				break;
			case 'maxHpFlat':
				if (player) {
					// 고정 +N 은 현재 레벨의 체력 성장 배율로 환산 (logic/growth.ts)
					const scaled = Math.round(value * playerHpGrowth(this.progression?.level ?? 1));
					player.maxHp = (player.maxHp ?? 100) + scaled;
					player.hp = Math.min(player.maxHp, (player.hp ?? 0) + scaled);
				}
				break;
			case 'healPercent':
				if (player) {
					player.hp = Math.min(player.maxHp ?? 100, (player.hp ?? 0) + Math.round((player.maxHp ?? 100) * value));
				}
				break;
			case 'moveSpeedMultiplier':
				if (player) {
					player.moveSpeed = clampMoveSpeed(
						Math.round((player.moveSpeed ?? 150) * (1 + value)), player.baseMoveSpeed,
					);
				}
				break;
			case 'critChanceAdd':
				if (player) {
					// 레벨업으로는 100%를 넘기지 않는다 — 넘길 카드는 isUpgradeAvailable 에서
					// 이미 빠지지만, 마지막 한 장이 상한을 넘어설 때를 위해 클램프한다.
					// (검·세트·상점·증강의 초과분은 hitResolution 에서 종전대로 피해로 전환)
					player.critChance = Math.min(STAT_CAPS.critChance, (player.critChance ?? 0) + value);
				}
				break;
			case 'critDamageAdd':
				if (player) {
					player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + value;
				}
				break;
			case 'magnetMultiplier':
				if (this.progression) {
					this.progression.magnetRadius = clampMagnetRadius(
						this.progression.magnetRadius * (1 + value), this.progression.baseMagnetRadius,
					);
				}
				break;
			case 'orbitRadiusMultiplier':
				if (this.swordOrbit) {
					this.swordOrbit.radius = clampOrbitRadius(
						this.swordOrbit.radius * (1 + value), this.swordOrbit.baseRadius,
					);
				}
				break;
			case 'orbitSpeedMultiplier':
				if (this.swordOrbit) {
					this.swordOrbit.orbitSpeed = clampOrbitSpeed(
						this.swordOrbit.orbitSpeed * (1 + value), this.swordOrbit.baseOrbitSpeed,
					);
				}
				break;
			case 'launchSpeedMultiplier':
				if (this.swordOrbit) {
					// 상한을 넘지 않는 만큼만 배율 적용 (per-sword launchSpeed 도 같은 배율로 움직인다)
					const current = this.swordOrbit.launchSpeedMultiplier ?? 1;
					const target = clampLaunchSpeedMultiplier(current * (1 + value));
					if (target > current) {
						this.swordOrbit.applyLaunchSpeedMultiplier?.(target / current);
					}
				}
				break;
			case 'luckAdd':
				if (player) {
					player.luck = (player.luck ?? 0) + value;
				}
				break;
			case 'addSword':
				// 자동 융합 없음 — 조합은 상점 REFORGE 모달에서만 (2026-08-25)
				// 이미 보유한 검이면 중복 대신 합성 레벨업 (acquireSword, 2026-08-28)
				if (choice.swordDefinition && this.swordOrbit?.acquireSword) {
					this.swordOrbit.acquireSword(this.scene, choice.swordDefinition);
				} else {
					this.swordOrbit?.addSword?.(this.scene, choice.swordDefinition);
				}
				break;
			case 'bonusHits':
				this.swordOrbit?.addBonusHits?.(value);
				break;
			case 'cleaveAdd':
				this.swordOrbit?.addCleave?.(value);
				break;
			// ── 해금 스탯: 자체 상한(UNLOCK_CAPS)까지만 적용
			case 'dodgeAdd':
				if (player) {
					player.dodgeChance = Math.min(UNLOCK_CAPS.dodgeChance, (player.dodgeChance ?? 0) + value);
				}
				break;
			case 'xpGainAdd':
				if (this.progression) {
					this.progression.xpMultiplier = Math.min(
						UNLOCK_CAPS.xpMultiplier, (this.progression.xpMultiplier ?? 1) + value,
					);
				}
				break;
			case 'damageReductionAdd':
				if (player) {
					player.damageReduction = Math.min(UNLOCK_CAPS.damageReduction, (player.damageReduction ?? 0) + value);
				}
				break;
			case 'lifestealAdd':
				if (player) {
					player.lifesteal = Math.min(UNLOCK_CAPS.lifesteal, (player.lifesteal ?? 0) + value);
				}
				break;
			case 'goldGainAdd':
				if (player) {
					player.goldBonus = Math.min(UNLOCK_CAPS.goldBonus, (player.goldBonus ?? 0) + value);
				}
				break;
			case 'hpRegenAdd':
				if (player) {
					player.hpRegen = Math.min(UNLOCK_CAPS.hpRegen, (player.hpRegen ?? 0) + value);
				}
				break;
			case 'executeDamageAdd':
				if (player) {
					player.executeDamage = Math.min(UNLOCK_CAPS.executeDamage, (player.executeDamage ?? 0) + value);
				}
				break;
			case 'penAdd':
				if (player) {
					player.pen = Math.min(UNLOCK_CAPS.pen, (player.pen ?? 0) + value);
				}
				break;
			case 'skillLevel':
				if (upgrade.skill) {
					this.scene.activeSkills?.levelUpSkill?.(upgrade.skill);
				}
				break;
			default:
				break;
		}

		this.scene.events.emit(GameEvents.UPGRADE_CHOSEN, choice);
	}

	// ---------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------

	buildUi(choices: UpgradeChoice[]): void {
		// 딤은 실제 화면 크기로, UI 는 고정 디자인 좌표계 안에서 그린다.
		this.backdrop = dimVignette(this.scene, 1999, 0.72);
		this.ui = createUiRoot(this.scene, 2000);
		this.tooltip = new Tooltip(this.scene, { depth: 2100, root: this.ui, wrapWidth: 280 });

		const width = this.ui.width;
		const height = this.ui.height;
		const centerX = width / 2;
		const centerY = height / 2;

		const deco = this.scene.add.graphics().setScrollFactor(0).setDepth(2001);
		this.uiObjects.push(deco);

		// 헤더: Flat 리본 배너 + 타이틀 (배너 위 잉크 텍스트)
		const headerY = Math.max(64, centerY - height * 0.36);
		const title = this.scene.add.text(centerX, headerY, '레벨 업', {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: '46px',
			fontStyle: '900',
			color: UI.text,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		const titleBanner = banner(this.scene, centerX, headerY, title.width + 260, { variant: 1, h: 68 })
			.setScrollFactor(0).setDepth(2000);
		this.uiObjects.push(titleBanner, title);

		const levelLabel = this.scene.add.text(centerX, headerY + 52, `무리가 강해진다 — Lv. ${this.getPlayerLevel()}`, style(18, UI.quenchText, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		levelLabel.setShadow(0, 3, '#000000', 6, false, true);
		this.uiObjects.push(levelLabel);

		// 등급 획득 확률 pill + 등급별 확률 나열
		const pillY = headerY + 92;
		const pillLabel = this.scene.add.text(centerX, pillY, '등급 확률', style(13, UI.text))
			.setOrigin(0.5).setScrollFactor(0).setDepth(2002);
		const pillBg = this.scene.add.nineslice(centerX, pillY, 'uf-btn2-3', 0,
			(pillLabel.width + 44) / 2, 14, 5, 5, 5, 6)
			.setScale(2).setScrollFactor(0).setDepth(2001);
		this.uiObjects.push(pillBg, pillLabel);

		// 등급별 확률 (다이아 + 이름 + %)
		const weights = this.getCurrentWeights();
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		const oddsParts = this.rarities
			.map((rarity, index) => ({ rarity, pct: total > 0 ? (weights[index] / total) * 100 : 0 }))
			.filter((entry) => entry.pct > 0);
		const oddsY = pillY + 34;
		const oddsTexts: Phaser.GameObjects.Text[] = [];
		let oddsTotalWidth = 0;
		for (const entry of oddsParts) {
			const theme = RARITY_THEME[entry.rarity.id];
			const pctLabel = entry.pct < 1 ? entry.pct.toFixed(1) : `${Math.round(entry.pct)}`;
			const text = this.scene.add.text(0, oddsY, `${entry.rarity.name} ${pctLabel}%`, style(14, theme?.css ?? UI.text))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(2001);
			text.setShadow(0, 2, '#000000', 3, false, true);
			oddsTexts.push(text);
			oddsTotalWidth += text.width + 44;
		}
		let cursor = centerX - (oddsTotalWidth - 44) / 2;
		oddsParts.forEach((entry, index) => {
			const theme = RARITY_THEME[entry.rarity.id];
			diamond(deco, cursor - 2, oddsY, 5, theme?.num ?? UI.straw);
			oddsTexts[index].setX(cursor + 8);
			cursor += oddsTexts[index].width + 44;
		});
		this.uiObjects.push(...oddsTexts);

		const luckNote = this.scene.add.text(centerX, oddsY + 28, '행운이 높을수록 상위 등급 확률이 오릅니다.', style(12, '#9aa4ad', { bold: false }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		this.uiObjects.push(luckNote);

		// 하단 안내 (키캡 + 새로고침 + 자동선택 노트)
		const hintY = Math.min(height - 30, centerY + height * 0.36);
		const hintParts: Phaser.GameObjects.GameObject[] = [];
		let hx = centerX - 190;
		for (let i = 0; i < choices.length; i += 1) {
			hintParts.push(keycap(this.scene, hx, hintY, `${i + 1}`, 11).setScrollFactor(0).setDepth(2001));
			hx += 30;
		}
		const hintText = this.scene.add.text(hx + 6, hintY, '카드 선택', style(13, '#c3ccd3'))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(2001);
		hintParts.push(hintText);
		const rKeycap = keycap(this.scene, hx + hintText.width + 46, hintY, 'R', 11).setScrollFactor(0).setDepth(2001);
		hintParts.push(rKeycap);
		const rerollText = this.scene.add.text(hx + hintText.width + 66, hintY,
			this.rerollUsed ? '새로고침 (사용함)' : '새로고침 (1회)', style(13, this.rerollUsed ? '#7f8a93' : '#c3ccd3'))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(2001);
		hintParts.push(rerollText);
		hintParts.push(divider(this.scene, centerX, hintY - 22, 380, UI.panelDark).setScrollFactor(0).setDepth(2001));
		this.uiObjects.push(...hintParts);

		const cardWidth = Math.min(258, (width - 200) / choices.length - 26);
		const cardHeight = Math.min(376, height * 0.44);
		const gap = 30;
		const totalWidth = choices.length * cardWidth + (choices.length - 1) * gap;
		const startX = centerX - totalWidth / 2 + cardWidth / 2;
		const cardsY = Math.max(centerY + 20, oddsY + 60 + cardHeight / 2);

		this.cards = [];

		const hasLegendary = choices.some((choice) => choice.rarity.id === 'legendary');
		if (hasLegendary && screenShakeEnabled()) {
			this.scene.cameras.main.flash(500, 217, 168, 60);
		}

		choices.forEach((choice, index) => {
			const card = this.buildCard(choice, index, startX + index * (cardWidth + gap), cardsY, cardWidth, cardHeight);
			this.cards.push(card);
		});

		this.ui.add(...this.uiObjects);
		this.ui.sort();

		// 게임패드/방향키 포커스 (2026-09-01): 십자키·← → 로 카드를 옮기고 ENTER(패드 A)로 확정.
		// 숫자키 1~4 직접 선택은 그대로 — 키보드 사용자의 조작은 하나도 바뀌지 않는다.
		this.focusIndex = -1;

		this.keyHandler = (event: KeyboardEvent) => {
			if (event.code === 'KeyR') {
				this.reroll();
				return;
			}
			if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
				const step = event.code === 'ArrowLeft' ? -1 : 1;
				const start = this.focusIndex < 0 ? (step > 0 ? -1 : 0) : this.focusIndex;
				this.setFocus((start + step + choices.length) % choices.length);
				return;
			}
			if (event.code === 'Enter' || event.code === 'NumpadEnter') {
				const index = this.focusIndex < 0 ? 0 : this.focusIndex;
				if (choices[index]) {
					this.selectChoice(choices[index]);
				}
				return;
			}
			const slot = Number.parseInt(event.key, 10) - 1;
			if (Number.isInteger(slot) && slot >= 0 && slot < choices.length) {
				this.selectChoice(choices[slot]);
			}
		};
		this.scene.input.keyboard!.on('keydown', this.keyHandler);
	}

	/**
	 * 포커스 카드 표시.
	 * 새 오브젝트를 만들지 않고 알파/스케일만 바꾼다 (모션 줄이기에서도 알파는 유지 —
	 * 포커스가 안 보이면 패드로 고를 수가 없다).
	 */
	setFocus(index: number): void {
		this.focusIndex = index;
		this.cards.forEach((card, i) => {
			// 등장 애니메이션 중에 화살표를 누르면 **등장을 즉시 완료**시킨다 (2026-09-06).
			//
			// 예전에는 여기서 killTweensOf(container) 로 대상 전체의 트윈을 죽였는데,
			// 그 대상에는 아직 진행 중인 등장 트윈(y·alpha)도 들어 있었다. 카드마다
			// delay 가 달라서(0/70/140/210ms) 각각 다른 y 에서 얼어붙고, 바로 위에서 준
			// alpha 0.62 가 그대로 남아 "정렬이 안 되고 어떤 건 반투명한 채로 멈춤" 이 됐다.
			// 히트스톱이 트윈 시간을 24배 늦추기 때문에 이 창은 체감상 꽤 길다.
			this.finishEntrance(card);

			const focused = i === index;
			card.container.setAlpha(index < 0 || focused ? 1 : 0.62);
			const scale = focused ? 1.04 : 1;
			this.setCardScale(card, scale);
		});
		this.scene.soundSystem?.play('click', { volume: 0.35 });
	}

	/** 등장 트윈을 끊고 최종 위치·알파로 스냅 (이미 끝났으면 아무 일도 없다) */
	private finishEntrance(card: LevelUpCard): void {
		if (!card.entrance) {
			return;
		}
		card.entrance.remove();
		card.entrance = null;
		card.container.setY(card.homeY).setAlpha(1);
	}

	/**
	 * scale 의 유일한 소유자. 포커스·마우스오버가 전부 여기를 거쳐야
	 * 서로의 트윈을 덮어쓰지 않는다 (y·alpha 는 절대 건드리지 않는다).
	 */
	private setCardScale(card: LevelUpCard, scale: number): void {
		card.scaleTween?.remove();
		card.scaleTween = null;
		if (reduceMotion()) {
			card.container.setScale(scale);
			return;
		}
		card.scaleTween = this.scene.tweens.add({
			targets: card.container, scaleX: scale, scaleY: scale, duration: 110, ease: 'Quad.easeOut',
			onComplete: () => { card.scaleTween = null; },
		});
	}

	buildCard(choice: UpgradeChoice, index: number, x: number, y: number, cardWidth: number, cardHeight: number): LevelUpCard {
		const { rarity, upgrade } = choice;
		const theme = RARITY_THEME[rarity.id] ?? RARITY_THEME.common;
		const isLegendary = rarity.id === 'legendary';

		const container = this.scene.add.container(x, y + 40).setScrollFactor(0).setDepth(2002).setAlpha(0);
		this.uiObjects.push(container);

		// 등급 카드 프레임 (Flat 회색 프레임 + 등급색 밴드/코너)
		const bandH = 34;
		const frame = rarityCard(this.scene, cardWidth, cardHeight, theme, { bandH });
		container.add(frame);

		// 등급 밴드는 밝은 파스텔 틴트라 라벨은 잉크로
		const rarityLabel = this.scene.add.text(0, -cardHeight / 2 + 6 + bandH / 2, rarity.name, {
			...style(15, '#14181d', { display: true }),
		}).setOrigin(0.5);
		container.add(rarityLabel);

		// 아이콘 영역 (크림 인셋 + 이모지/검 스프라이트)
		const iconY = -cardHeight / 2 + bandH + 78;
		container.add(insetPanel(this.scene, 0, iconY, 104, 104, { origin: 0.5 }));

		if (choice.upgrade.type === 'addSword' && choice.swordDefinition) {
			// 통합 시트의 검 도트는 원색 그대로 — 틴트를 입히면 아트가 죽는다
			const swordIcon = this.scene.add.image(0, iconY, 'sword', choice.swordDefinition.sheetOrder ?? 0)
				.setDisplaySize(72, 72);
			container.add(swordIcon);
		} else {
			const icon = iconImage(this.scene, upgrade.icon ?? 'g-spark', 0, iconY, 52, theme.css);
			container.add(icon);
		}

		// 이름 밴드 (크림 인셋)
		const nameY = iconY + 88;
		container.add(insetPanel(this.scene, 0, nameY, cardWidth - 36, 34, { origin: 0.5 }));

		const name = this.scene.add.text(0, nameY, upgrade.name, {
			fontFamily: FONT.serifKr,
			resolution: TEXT_RESOLUTION,
			fontSize: '20px',
			fontStyle: 'bold',
			color: UI.text,
			align: 'center',
		}).setOrigin(0.5);
		name.setShadow(0, 2, '#000000', 4, false, true);
		container.add(name);

		// 효과 (그린 강조)
		const description = this.scene.add.text(0, nameY + 46, this.describeChoice(choice), {
			...style(15, UI.green),
			align: 'center',
			wordWrap: { width: cardWidth - 36 },
			lineSpacing: 4,
		}).setOrigin(0.5, 0);
		container.add(description);

		// 현재 → 적용 후 수치 (스탯 체감의 근거)
		const readout = this.readoutForChoice(choice);
		if (readout) {
			const readoutY = nameY + 46 + description.height + 10;
			const arrowText = this.scene.add.text(0, readoutY,
				`${readout.before}  ➜  ${readout.after}${readout.capped ? '  · MAX' : ''}`, {
					...style(13, readout.capped ? UI.goldText : UI.quenchText),
					align: 'center',
				}).setOrigin(0.5, 0);
			arrowText.setShadow(0, 2, '#000000', 3, false, true);
			container.add(arrowText);
		}

		// 하단 번호 키캡
		const keyY = cardHeight / 2 - 30;
		container.add(keycap(this.scene, 0, keyY, `${index + 1}`, 13));

		const background = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0.001);
		container.add(background);

		const card: LevelUpCard = { container, choice, homeY: y, entrance: null, scaleTween: null, flicker: null };

		background.setInteractive({ useHandCursor: true });
		background.on('pointerover', () => {
			// 마우스도 등장을 완료시킨 뒤 scale 만 건드린다 (setFocus 와 같은 이유)
			this.finishEntrance(card);
			this.setCardScale(card, 1.06);
			// 카드 왼쪽 위에 상세 툴팁 — 등급 의미·수치·관련 용어까지 한 번에 읽힌다
			this.tooltip?.show(x, y - cardHeight / 2 + 10,
				withKeywordFooter(`${upgrade.name} · ${rarity.name}`, this.tooltipBodyFor(choice), theme.css));
		});
		background.on('pointerout', () => {
			this.setCardScale(card, this.focusIndex === index ? 1.04 : 1);
			this.tooltip?.hide();
		});
		background.on('pointerdown', () => this.selectChoice(choice));

		// 등장 애니메이션 (카드별 지연). 핸들을 보관해야 중간에 끊고 스냅할 수 있다.
		card.entrance = this.scene.tweens.add({
			targets: container,
			y,
			alpha: 1,
			duration: 240,
			delay: index * 70,
			ease: 'Back.easeOut',
			// Back.easeOut 은 목표를 넘겼다 돌아오므로 부동소수 잔여를 마지막에 정리한다
			onComplete: () => {
				container.setY(y).setAlpha(this.focusIndex < 0 || this.focusIndex === index ? 1 : 0.62);
				card.entrance = null;
			},
		});

		// 한쇠 카드는 잭팟임을 알리는 은은한 명멸 (모션 줄이기 시 생략).
		// repeat:-1 이라 killTweensOf(container) 로는 안 죽는다 (대상이 자식 frame) — destroyUi 가 직접 끈다.
		if (isLegendary && !reduceMotion()) {
			card.flicker = this.scene.tweens.add({
				targets: frame,
				alpha: 0.72,
				yoyo: true,
				repeat: -1,
				duration: 620,
				ease: 'Sine.easeInOut',
			});
		}

		return card;
	}

	selectChoice(choice: UpgradeChoice): void {
		if (!this.isOpen) {
			return;
		}

		this.scene.soundSystem?.play('click');
		this.applyChoice(choice);
		// 선택 직후 인게임 피드백: 부스트 텍스트 + 스탯별 즉석 연출
		this.scene.visualEffects?.upgradeFeedbackFX?.({
			type: choice.upgrade.type,
			name: choice.upgrade.name,
			rarityColor: choice.rarity.color,
			desc: this.describeChoice(choice),
		});
		this.close();
	}

	destroyUi(): void {
		if (this.keyHandler) {
			this.scene.input.keyboard!.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}

		// 툴팁 컨테이너는 this.ui 안에 있으므로 루트보다 먼저 정리한다
		this.tooltip?.destroy();
		this.tooltip = null;

		// Phaser의 destroy()는 트윈을 정리하지 않는다. 전설 카드의 명멸 트윈은
		// repeat:-1 이라 파괴된 그래픽을 매 프레임 계속 갱신하며 영원히 남는다
		// (레벨업을 반복하는 200라 런에서 좀비 트윈이 수십 개씩 쌓였다).
		const tweens = this.scene.tweens;
		// 카드가 직접 들고 있는 트윈부터 (명멸 트윈의 대상은 자식 frame 이라
		// 아래 killTweensOf(container) 로는 절대 잡히지 않는다)
		for (const card of this.cards) {
			card.entrance?.remove();
			card.scaleTween?.remove();
			card.flicker?.remove();
			card.entrance = null;
			card.scaleTween = null;
			card.flicker = null;
		}
		for (const object of this.backdrop) {
			tweens.killTweensOf(object);
			object.destroy();
		}
		this.backdrop = [];

		for (const object of this.uiObjects) {
			tweens.killTweensOf(object);
			object.destroy();
		}

		if (this.ui) {
			tweens.killTweensOf(this.ui);
		}
		this.ui?.destroy();
		this.ui = null;
		this.uiObjects = [];
		this.cards = [];
	}
}
