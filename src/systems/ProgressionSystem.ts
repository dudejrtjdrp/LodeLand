import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';

/** XP orb pooled sprite with the runtime fields this system attaches. */
export interface XPOrbSprite extends Phaser.Physics.Arcade.Sprite {
	amount?: number;
	_isAttracting?: boolean;
	destroyed?: boolean;
}

/** Runtime HUD mirror fields written onto the player (not in PlayerSprite). */
export interface ProgressionPlayer extends PlayerSprite {
	xp?: number;
	level?: number;
	xpToNext?: number;
}

/** Payload emitted by EnemyManager on GameEvents.ENEMY_DIED. */
export interface EnemyDiedPayload {
	enemy?: EnemySprite;
	x?: number;
	y?: number;
	amount?: number;
	player?: PlayerSprite;
}

export interface ProgressionSystemOptions {
	maxLevel?: number;
	orbXp?: number;
	collectRadius?: number;
	maxOrbs?: number;
	magnetRadius?: number;
	orbAttractDurationPerPx?: number;
}

export default class ProgressionSystem {
	scene: GameScene;
	swordOrbit: unknown;
	player: ProgressionPlayer | null;
	level: number;
	xp: number;
	maxLevel: number;
	xpToNext: number;
	orbXp: number;
	collectRadius: number;
	orbs: Phaser.Physics.Arcade.Group;
	magnetRadius: number;
	orbAttractDurationPerPx: number;
	hudBackground: Phaser.GameObjects.Graphics;
	hudFill: Phaser.GameObjects.Graphics;
	hudText: Phaser.GameObjects.Text;
	/** Set externally (shop XP upgrade); read with `?? 1` fallback. */
	xpMultiplier?: number;

	constructor(scene: GameScene, swordOrbit?: unknown, options: ProgressionSystemOptions = {}) {
		this.scene = scene;
		this.swordOrbit = swordOrbit ?? null;
		this.player = null;
		this.level = 1;
		this.xp = 0;
		this.maxLevel = options.maxLevel ?? 65;
		this.xpToNext = this.xpRequiredFor(1);
		this.orbXp = options.orbXp ?? 25;
		this.collectRadius = options.collectRadius ?? 120;
		this.orbs = scene.physics.add.group({ maxSize: options.maxOrbs ?? 256 });
		this.magnetRadius = options.magnetRadius ?? 220;
		this.orbAttractDurationPerPx = options.orbAttractDurationPerPx ?? 2.5; // ms per pixel
		this.hudBackground = scene.add.graphics().setScrollFactor(0).setDepth(1000);
		this.hudFill = scene.add.graphics().setScrollFactor(0).setDepth(1001);
		this.hudText = scene.add.text(18, 16, 'Lv. 1', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '18px',
			color: '#ffffff',
		}).setScrollFactor(0).setDepth(1002);

		this.hudText.setShadow(0, 2, '#000000', 2, false, true);
		this.scene.events.on(GameEvents.ENEMY_DIED, this.handleEnemyDeath, this);
		this.refreshPlayerStats();
		this.drawHud();
	}

	attachPlayer(player: ProgressionPlayer): void {
		this.player = player;
		this.refreshPlayerStats();
		this.drawHud();
	}

	handleEnemyDeath(payload: EnemyDiedPayload): void {
		const x = payload?.x ?? payload?.enemy?.x;
		const y = payload?.y ?? payload?.enemy?.y;
		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		const amount = payload?.amount ?? this.orbXp;
		if (amount <= 0) {
			return;
		}

		this.spawnXPOrb(x, y, amount);
	}

	spawnXPOrb(x: number, y: number, amount: number = this.orbXp): XPOrbSprite | false {
		let orb = this.orbs.getFirstDead(false) as XPOrbSprite | null;

		if (!orb) {
			orb = this.orbs.create(x, y, 'xp_orb') as XPOrbSprite | null;
		}

		if (!orb) {
			return false;
		}

		orb.setDepth(50);
		orb.setPosition(x, y);
		orb.setActive(true);
		orb.setVisible(true);
		orb.amount = amount;
		orb.setTint(0xfbbf24);
		orb.setDisplaySize(12, 12);
		orb.setAlpha(0.95);
		orb._isAttracting = false;
		if (orb.body) {
			orb.body.reset(x, y);
			orb.setCircle(9);
		}

		if (orb.body) {
			(orb.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
			(orb.body as Phaser.Physics.Arcade.Body).setImmovable(true);
		}

		return orb;
	}

	update(player: ProgressionPlayer | null = this.player, delta: number): void {
		if (player) {
			this.player = player;
		}

		if (!this.player) {
			return;
		}

		for (const orb of this.orbs.getChildren() as XPOrbSprite[]) {
			if (!this.isAliveOrb(orb)) {
				continue;
			}

			const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, orb.x, orb.y);

			// Visual rotation
			orb.setRotation((orb.rotation ?? 0) + delta * 0.01);

			// If within magnet radius, use physics to move the orb toward player
			if (distance <= this.magnetRadius) {
				orb._isAttracting = true;
				if (orb.body) {
					orb.body.enable = true;
				}
				// slower attraction: gentler pull toward player
				const attractionSpeed = Phaser.Math.Clamp(distance * 1.6, 120, 420);
				this.scene.physics.moveToObject(orb, this.player, attractionSpeed);
			}

			// safety: collect if already very close
			if (distance <= this.collectRadius) {
				this.collectOrb(orb);
			}
		}

		this.drawHud();
	}

	collectOrb(orb: XPOrbSprite): void {
		if (!this.isAliveOrb(orb)) {
			return;
		}

		this.scene?.soundSystem?.play('pickup', { volume: 0.6 });
		this.addXP(orb.amount ?? this.orbXp);
		this.recycleOrb(orb);
	}

	// Gentle quadratic curve tuned for a 60-round run to level 65
	xpRequiredFor(level: number): number {
		return Math.ceil(80 + 35 * level + 1.8 * level * level);
	}

	addXP(amount: number): void {
		if (this.level >= this.maxLevel) {
			return;
		}

		this.xp += amount * (this.xpMultiplier ?? 1);

		while (this.xp >= this.xpToNext && this.level < this.maxLevel) {
			this.xp -= this.xpToNext;
			this.levelUp();
		}

		this.refreshPlayerStats();
		this.drawHud();
	}

	levelUp(): void {
		this.level += 1;
		this.xpToNext = this.xpRequiredFor(this.level);

		this.refreshPlayerStats();
		this.scene.events.emit(GameEvents.LEVEL_UP, this.level);
	}

	refreshPlayerStats(): void {
		if (!this.player) {
			return;
		}

		this.player.xp = this.xp;
		this.player.level = this.level;
		this.player.xpToNext = this.xpToNext;
	}

	drawHud(): void {
		const barX = 16;
		const barY = 44;
		const barWidth = 180;
		const barHeight = 12;
		const fillRatio = Phaser.Math.Clamp(this.xpToNext > 0 ? this.xp / this.xpToNext : 0, 0, 1);

		this.hudBackground.clear();
		this.hudBackground.fillStyle(0x111827, 0.78);
		this.hudBackground.fillRoundedRect(12, 10, 220, 54, 10);
		this.hudBackground.fillStyle(0x2b3440, 1);
		this.hudBackground.fillRoundedRect(barX, barY, barWidth, barHeight, 6);

		this.hudFill.clear();
		this.hudFill.fillStyle(0xfbbf24, 1);
		this.hudFill.fillRoundedRect(barX, barY, barWidth * fillRatio, barHeight, 6);

		if (this.level >= this.maxLevel) {
			this.hudText.setText(`Lv. ${this.level} (MAX)`);
		} else {
			this.hudText.setText(`Lv. ${this.level}   ${Math.floor(this.xp)} / ${this.xpToNext}`);
		}
	}

	isAliveOrb(orb: XPOrbSprite | null | undefined): boolean {
		return Boolean(orb && orb.active !== false && orb.visible !== false && !orb.destroyed);
	}

	recycleOrb(orb: XPOrbSprite | null): void {
		if (!orb) {
			return;
		}

		orb.setVelocity(0, 0);
		orb.disableBody?.(true, true);
		orb.setActive(false);
		orb.setVisible(false);
	}
}
