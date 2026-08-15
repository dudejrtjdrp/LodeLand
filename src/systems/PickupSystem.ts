import Phaser from 'phaser';
import MetaProgression from './MetaProgression';
import type GameScene from '../scenes/GameScene';
import type { EnemyDefinition } from '../types/catalogs';
import type { EnemySprite } from '../types/actors';
import type ProgressionSystem from './ProgressionSystem';
import type { EnemyDiedPayload, XPOrbSprite } from './ProgressionSystem';
import type LevelUpSystem from './LevelUpSystem';
import { GameEvents } from '../core/events';

const PICKUP_DROP_CHANCE = 0.015; // chicken / magnet / bomb from normal enemies
const COLLECT_RADIUS = 55;

/** Minimal structural view of EnemyManager (converted by another agent). */
interface EnemyManagerLike {
	enemies: Phaser.Physics.Arcade.Group;
	isAliveEnemy(enemy: EnemySprite): boolean;
	takeDamage(enemy: EnemySprite, amount: number, player?: unknown, options?: unknown): unknown;
}

export interface PickupItem {
	obj: Phaser.GameObjects.Text & { destroyed?: boolean };
	kind: string;
	amount: number;
	x: number;
	y: number;
}

export interface PickupSystemOptions {
	progression?: ProgressionSystem | null;
	levelUpSystem?: LevelUpSystem | null;
	enemyManager?: EnemyManagerLike | null;
	goldMult?: number;
}

// Gold coins, treasure chests (elite/boss) and field pickups.
export default class PickupSystem {
	scene: GameScene;
	progression: ProgressionSystem | null;
	levelUpSystem: LevelUpSystem | null;
	enemyManager: EnemyManagerLike | null;
	items: PickupItem[];
	runGold: number;
	goldMult: number;
	goldText: Phaser.GameObjects.Text;
	onEnemyDied: (payload: EnemyDiedPayload) => void;

	constructor(scene: GameScene, options: PickupSystemOptions = {}) {
		this.scene = scene;
		this.progression = options.progression ?? null;
		this.levelUpSystem = options.levelUpSystem ?? null;
		this.enemyManager = options.enemyManager ?? null;

		this.items = [];
		this.runGold = 0;
		// meta greed x character trait x danger bonus
		this.goldMult = (1 + (MetaProgression.getBonuses().goldMult ?? 0)) * (options.goldMult ?? 1);

		this.goldText = scene.add.text(18, 68, '🪙 0', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '17px',
			color: '#fbbf24',
		}).setScrollFactor(0).setDepth(1002);
		this.goldText.setShadow(0, 2, '#000000', 2, false, true);

		this.onEnemyDied = (payload: EnemyDiedPayload) => this.handleEnemyDeath(payload);
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	handleEnemyDeath(payload: EnemyDiedPayload): void {
		const enemy = payload?.enemy;
		const catalog: Partial<EnemyDefinition> = enemy?.catalog ?? {};
		const x = payload?.x;
		const y = payload?.y;

		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		// Bosses/minibosses: 0.5% chance to drop a 💎 (guaranteed-enhancement coin)
		if ((catalog.isBoss || catalog.isMiniboss) && Math.random() < 0.005) {
			this.spawnItem(x, y - 20, 'gcoin', 1);
		}

		// Elites, minibosses and bosses drop treasure chests
		if (catalog.isElite || catalog.isBoss || catalog.isMiniboss) {
			this.spawnItem(x, y, 'chest', catalog.goldValue ?? 50);
			return;
		}

		// Gold coins
		if ((catalog.goldValue ?? 0) > 0 && Math.random() < (catalog.goldChance ?? 0)) {
			this.spawnItem(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-10, 10), 'gold', catalog.goldValue);
		}

		// Rare field pickups
		if (!catalog.isReaper && Math.random() < PICKUP_DROP_CHANCE) {
			const kind = Phaser.Math.RND.pick(['chicken', 'magnet', 'bomb']);
			this.spawnItem(x, y, kind, 0);
		}
	}

	spawnItem(x: number, y: number, kind: string, amount = 0): void {
		const emoji = ({ gold: '🪙', chest: '📦', chicken: '🍗', magnet: '🧲', bomb: '💣', gcoin: '💎' } as Record<string, string>)[kind] ?? '✨';
		const size = kind === 'chest' ? '34px' : kind === 'gold' ? '18px' : kind === 'gcoin' ? '30px' : '26px';

		const obj = this.scene.add.text(x, y, emoji, { fontSize: size })
			.setOrigin(0.5)
			.setDepth(45);

		// Gentle bob so pickups read as interactable
		this.scene.tweens.add({
			targets: obj,
			y: y - 6,
			yoyo: true,
			repeat: -1,
			duration: 700,
			ease: 'Sine.easeInOut',
		});

		this.items.push({ obj, kind, amount, x, y });
	}

	update(): void {
		const player = this.scene.player;
		if (!player || player.isDead) {
			return;
		}

		const magnetRadius = this.progression?.magnetRadius ?? 200;

		for (let i = this.items.length - 1; i >= 0; i -= 1) {
			const item = this.items[i];

			if (!item.obj || item.obj.destroyed) {
				this.items.splice(i, 1);
				continue;
			}

			const distance = Phaser.Math.Distance.Between(player.x, player.y, item.obj.x, item.obj.y);

			// Gold is pulled in by the magnet like XP orbs
			if (item.kind === 'gold' && distance <= magnetRadius) {
				const pull = Phaser.Math.Clamp(distance * 1.6, 120, 420) * (this.scene.game.loop.delta / 1000);
				const angle = Phaser.Math.Angle.Between(item.obj.x, item.obj.y, player.x, player.y);
				item.obj.x += Math.cos(angle) * pull;
				item.obj.y += Math.sin(angle) * pull;
			}

			if (distance <= COLLECT_RADIUS) {
				this.collect(item);
				this.items.splice(i, 1);
			}
		}
	}

	collect(item: PickupItem): void {
		const player = this.scene.player;

		switch (item.kind) {
			case 'gold':
				this.scene.soundSystem?.play('gold');
				this.addGold(item.amount);
				break;
			case 'chest':
				this.openChest(item);
				break;
			case 'gcoin': {
				const total = MetaProgression.addGuaranteeCoin(1);
				this.scene.soundSystem?.play('chest');
				this.scene.cameras.main.flash(500, 147, 197, 253);
				this.scene.waveSystem?.announce?.(`💎 특별 강화 코인 획득! (보유 ${total})`, '#93c5fd');
				break;
			}
			case 'chicken': {
				this.scene.soundSystem?.play('revive', { volume: 0.5 });
				const heal = Math.round((player.maxHp ?? 100) * 0.3);
				player.hp = Math.min(player.maxHp, player.hp + heal);
				this.scene.visualEffects?.showDamageText?.(player.x, player.y - 60, `+${heal}`, false);
				break;
			}
			case 'magnet': {
				// Vacuum: collect every live XP orb instantly
				if (this.progression) {
					for (const orb of this.progression.orbs.getChildren() as XPOrbSprite[]) {
						if (this.progression.isAliveOrb(orb)) {
							this.progression.collectOrb(orb);
						}
					}
				}
				this.scene.cameras.main.flash(250, 96, 165, 250);
				break;
			}
			case 'bomb': {
				// Damage every enemy near the screen
				this.scene.soundSystem?.play('bigkill');
				const camera = this.scene.cameras.main;
				this.scene.cameras.main.shake(350, 0.012);
				this.scene.cameras.main.flash(300, 255, 255, 255);

				if (this.enemyManager) {
					for (const enemy of this.enemyManager.enemies.getChildren() as EnemySprite[]) {
						if (!this.enemyManager.isAliveEnemy(enemy)) {
							continue;
						}

						const inView = enemy.x > camera.scrollX - 100 && enemy.x < camera.scrollX + camera.width + 100
							&& enemy.y > camera.scrollY - 100 && enemy.y < camera.scrollY + camera.height + 100;

						if (inView) {
							this.enemyManager.takeDamage(enemy, 200, player);
						}
					}
				}
				break;
			}
			default:
				break;
		}

		item.obj.destroy();
	}

	addGold(amount: number): void {
		const gained = Math.max(1, Math.round(amount * this.goldMult));
		this.runGold += gained;
		// Lifetime gold counts at EARN time (character unlocks) - spending in the shop doesn't reduce it
		MetaProgression.addLifetime(gained);
		this.goldText.setText(`🪙 ${this.runGold}`);
	}

	spendGold(amount: number): boolean {
		if (this.runGold < amount) {
			return false;
		}

		this.runGold -= amount;
		this.goldText.setText(`🪙 ${this.runGold}`);
		return true;
	}

	openChest(item: PickupItem): void {
		const player = this.scene.player;
		const luck = player?.luck ?? 0;

		// Gold jackpot: 1x / 3x / 5x rolls, luck shifts the odds (VS-style)
		const jackpotRoll = Math.random() * (1 + luck * 0.5);
		const rolls = jackpotRoll > 0.95 ? 5 : jackpotRoll > 0.8 ? 3 : 1;
		const gold = Math.round((item.amount ?? 50) * rolls * Phaser.Math.FloatBetween(0.8, 1.3));
		this.addGold(gold);

		// Bonus: one random upgrade, auto-applied (rarity rolled with luck)
		let rewardLabel = '';
		if (this.levelUpSystem) {
			const choice = this.levelUpSystem.rollSingleChoice();
			if (choice) {
				this.levelUpSystem.applyChoice(choice);
				rewardLabel = ` + ${choice.upgrade.icon} ${choice.upgrade.name} (${choice.rarity.name})`;
			}
		}

		this.scene.soundSystem?.play('chest');
		this.scene.cameras.main.flash(400, 251, 191, 36);
		this.scene.visualEffects?.hitStop?.(100);
		this.scene.waveSystem?.announce?.(`📦 +${gold} 골드${rewardLabel}`, rolls >= 5 ? '#fbbf24' : '#e5e7eb');
	}

	destroy(): void {
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		for (const item of this.items) {
			item.obj?.destroy();
		}
		this.items = [];
		this.goldText?.destroy();
	}
}
