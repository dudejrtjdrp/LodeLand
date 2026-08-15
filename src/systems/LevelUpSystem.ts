import Phaser from 'phaser';
import rawUpgradeCatalog from '../data/upgradeCatalog.json';
import type GameScene from '../scenes/GameScene';
import type { RarityId, RaritySpec, SwordDefinition, UpgradeCatalog, UpgradeDefinition } from '../types/catalogs';
import type ProgressionSystem from './ProgressionSystem';
import type { ProgressionPlayer } from './ProgressionSystem';
import { GameEvents } from '../core/events';

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
	damageMultiplier?: number;
	radius: number;
	orbitSpeed: number;
	applyCooldownMultiplier?: (multiplier: number) => void;
	applyLaunchSpeedMultiplier?: (multiplier: number) => void;
	addSword?: (scene: GameScene, definition?: SwordDefinition | null) => unknown;
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
	keyHandler: ((event: KeyboardEvent) => void) | null;

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

		this.scene.soundSystem?.play('levelup');
		this.scene.physics.pause();
		this.scene.player?.setVelocity?.(0, 0);

		const choices = this.rollChoices();
		this.buildUi(choices);
	}

	close(): void {
		this.destroyUi();
		this.isOpen = false;

		if (this.pendingChoices > 0) {
			// Chained level-ups: open the next selection immediately.
			this.open();
			return;
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
			return this.swordOrbit
				&& this.swordOrbit.swords.length < this.swordOrbit.maxSwords
				&& this.swordCatalog.length > 0;
		}

		return true;
	}

	makeChoice(upgrade: UpgradeDefinition, rarity: RaritySpec): UpgradeChoice {
		const value = (upgrade.values as UpgradeValues)[rarity.id] as number;
		const choice: UpgradeChoice = { upgrade, rarity, value, swordDefinition: null };

		if (upgrade.type === 'addSword') {
			const tierIndices = this.swordTierByRarity[rarity.id] ?? [0];
			const index = Phaser.Math.Clamp(Phaser.Math.RND.pick(tierIndices), 0, this.swordCatalog.length - 1);
			choice.swordDefinition = this.swordCatalog[index];
		}

		return choice;
	}

	describeChoice(choice: UpgradeChoice): string {
		const { upgrade, value, swordDefinition } = choice;
		const pct = `${Math.round(value * 100)}%`;

		return upgrade.descTemplate
			.replace('{pct}', pct)
			.replace('{value}', `${value}`)
			.replace('{swordName}', swordDefinition?.name ?? '검');
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
				this.swordOrbit?.applyCooldownMultiplier?.(1 - value);
				break;
			case 'maxHpFlat':
				if (player) {
					player.maxHp = (player.maxHp ?? 100) + value;
					player.hp = Math.min(player.maxHp, (player.hp ?? 0) + value);
				}
				break;
			case 'healPercent':
				if (player) {
					player.hp = Math.min(player.maxHp ?? 100, (player.hp ?? 0) + Math.round((player.maxHp ?? 100) * value));
				}
				break;
			case 'moveSpeedMultiplier':
				if (player) {
					player.moveSpeed = Math.round((player.moveSpeed ?? 150) * (1 + value));
				}
				break;
			case 'critChanceAdd':
				if (player) {
					player.critChance = (player.critChance ?? 0) + value;
				}
				break;
			case 'critDamageAdd':
				if (player) {
					player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + value;
				}
				break;
			case 'magnetMultiplier':
				if (this.progression) {
					this.progression.magnetRadius *= (1 + value);
				}
				break;
			case 'orbitRadiusMultiplier':
				if (this.swordOrbit) {
					this.swordOrbit.radius *= (1 + value);
				}
				break;
			case 'orbitSpeedMultiplier':
				if (this.swordOrbit) {
					this.swordOrbit.orbitSpeed *= (1 + value);
				}
				break;
			case 'launchSpeedMultiplier':
				this.swordOrbit?.applyLaunchSpeedMultiplier?.(1 + value);
				break;
			case 'luckAdd':
				if (player) {
					player.luck = (player.luck ?? 0) + value;
				}
				break;
			case 'addSword':
				this.swordOrbit?.addSword?.(this.scene, choice.swordDefinition);
				// Same-sword pairs auto-combine into the next tier;
				// hidden recipes evolve into unique swords.
				this.scene.time.delayedCall(120, () => {
					this.swordOrbit?.checkFusions?.();
				});
				break;
			case 'bonusHits':
				this.swordOrbit?.addBonusHits?.(value);
				break;
			case 'cleaveAdd':
				this.swordOrbit?.addCleave?.(value);
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
		const { width, height } = this.scene.scale;
		const centerX = width / 2;
		const centerY = height / 2;

		const dim = this.scene.add.rectangle(centerX, centerY, width, height, 0x000000, 0.62)
			.setScrollFactor(0)
			.setDepth(2000);
		this.uiObjects.push(dim);

		const title = this.scene.add.text(centerX, centerY - 230, `LEVEL UP!  (Lv. ${this.getPlayerLevel()})`, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '44px',
			color: '#fbbf24',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		title.setShadow(0, 4, '#000000', 6, false, true);
		this.uiObjects.push(title);

		// TFT-style odds readout for the current level bracket (+luck)
		const odds = this.scene.add.text(centerX, centerY - 185, this.getOddsLabel(), {
			fontFamily: 'Arial, sans-serif',
			fontSize: '15px',
			color: '#9ca3af',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		odds.setShadow(0, 2, '#000000', 2, false, true);
		this.uiObjects.push(odds);

		const hint = this.scene.add.text(centerX, centerY + 210, '카드를 클릭하거나 1~4 키로 선택', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '16px',
			color: '#d1d5db',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
		this.uiObjects.push(hint);

		const cardWidth = 220;
		const cardHeight = 300;
		const gap = 24;
		const totalWidth = choices.length * cardWidth + (choices.length - 1) * gap;
		const startX = centerX - totalWidth / 2 + cardWidth / 2;

		this.cards = [];

		const hasLegendary = choices.some((choice) => choice.rarity.id === 'legendary');
		if (hasLegendary) {
			this.scene.cameras.main.flash(600, 251, 191, 36);
		}

		choices.forEach((choice, index) => {
			const card = this.buildCard(choice, index, startX + index * (cardWidth + gap), centerY, cardWidth, cardHeight);
			this.cards.push(card);
		});

		this.keyHandler = (event: KeyboardEvent) => {
			const slot = Number.parseInt(event.key, 10) - 1;
			if (Number.isInteger(slot) && slot >= 0 && slot < choices.length) {
				this.selectChoice(choices[slot]);
			}
		};
		this.scene.input.keyboard!.on('keydown', this.keyHandler);
	}

	buildCard(choice: UpgradeChoice, index: number, x: number, y: number, cardWidth: number, cardHeight: number): LevelUpCard {
		const { rarity, upgrade } = choice;
		const rarityColor = Phaser.Display.Color.HexStringToColor(rarity.color).color;
		const isLegendary = rarity.id === 'legendary';
		const isEpicPlus = isLegendary || rarity.id === 'epic';

		const container = this.scene.add.container(x, y + 40).setScrollFactor(0).setDepth(2002).setAlpha(0);
		this.uiObjects.push(container);

		const background = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, 0x111827, 0.96)
			.setStrokeStyle(isEpicPlus ? 4 : 2, rarityColor);
		container.add(background);

		const rarityBanner = this.scene.add.rectangle(0, -cardHeight / 2 + 22, cardWidth, 44, rarityColor, isEpicPlus ? 0.95 : 0.8);
		container.add(rarityBanner);

		const rarityLabel = this.scene.add.text(0, -cardHeight / 2 + 22, isLegendary ? `★ ${rarity.name} ★` : rarity.name, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '18px',
			color: isLegendary ? '#7c2d12' : '#ffffff',
		}).setOrigin(0.5);
		container.add(rarityLabel);

		const icon = this.scene.add.text(0, -50, upgrade.icon ?? '✨', { fontSize: '52px' }).setOrigin(0.5);
		container.add(icon);

		const name = this.scene.add.text(0, 20, upgrade.name, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '22px',
			color: rarity.color,
			align: 'center',
		}).setOrigin(0.5);
		container.add(name);

		const description = this.scene.add.text(0, 78, this.describeChoice(choice), {
			fontFamily: 'Arial, sans-serif',
			fontSize: '16px',
			color: '#e5e7eb',
			align: 'center',
			wordWrap: { width: cardWidth - 30 },
		}).setOrigin(0.5);
		container.add(description);

		const keyLabel = this.scene.add.text(0, cardHeight / 2 - 22, `[${index + 1}]`, {
			fontFamily: 'Arial, sans-serif',
			fontSize: '14px',
			color: '#9ca3af',
		}).setOrigin(0.5);
		container.add(keyLabel);

		background.setInteractive({ useHandCursor: true });
		background.on('pointerover', () => {
			this.scene.tweens.add({ targets: container, scale: 1.06, duration: 120 });
		});
		background.on('pointerout', () => {
			this.scene.tweens.add({ targets: container, scale: 1, duration: 120 });
		});
		background.on('pointerdown', () => this.selectChoice(choice));

		// Entrance animation (staggered).
		this.scene.tweens.add({
			targets: container,
			y,
			alpha: 1,
			duration: 240,
			delay: index * 70,
			ease: 'Back.easeOut',
		});

		// Legendary cards pulse to scream "jackpot".
		if (isLegendary) {
			this.scene.tweens.add({
				targets: background,
				scaleX: 1.03,
				scaleY: 1.03,
				yoyo: true,
				repeat: -1,
				duration: 420,
				ease: 'Sine.easeInOut',
			});
		}

		return { container, choice };
	}

	selectChoice(choice: UpgradeChoice): void {
		if (!this.isOpen) {
			return;
		}

		this.scene.soundSystem?.play('click');
		this.applyChoice(choice);
		this.close();
	}

	destroyUi(): void {
		if (this.keyHandler) {
			this.scene.input.keyboard!.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}

		for (const object of this.uiObjects) {
			object.destroy();
		}

		this.uiObjects = [];
		this.cards = [];
	}
}
