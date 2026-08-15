import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite, PlayerSprite } from '../types/actors';

/** Phaser sets no public `destroyed` flag; the game checks it defensively. */
type Rect = Phaser.GameObjects.Rectangle & { destroyed?: boolean };

type HealthBarEntity = PlayerSprite | EnemySprite;

export interface HealthBar {
	background: Rect;
	bar: Rect;
	entity: HealthBarEntity;
}

export default class VisualEffectsSystem {
	scene: GameScene;
	healthBars: Map<HealthBarEntity, HealthBar>;
	damageTexts: Phaser.GameObjects.Text[];
	hitStopActive: boolean;

	constructor(scene: GameScene) {
		this.scene = scene;
		this.healthBars = new Map(); // track health bars by owner (player/enemy)
		this.damageTexts = [];
		this.hitStopActive = false;
	}

	// Brief freeze-frame on impactful moments (crits, elite kills).
	hitStop(durationMs = 50): void {
		const scene = this.scene;

		if (this.hitStopActive || scene.levelUpSystem?.isOpen || scene.player?.isDead || scene.isPaused || scene.shopSystem?.isOpen) {
			return;
		}

		this.hitStopActive = true;
		scene.physics.pause();

		scene.time.delayedCall(durationMs, () => {
			this.hitStopActive = false;

			// Don't resume if something else (level-up UI, shop, pause menu, death) paused the world meanwhile.
			if (!scene.levelUpSystem?.isOpen && !scene.player?.isDead && !scene.isPaused && !scene.shopSystem?.isOpen) {
				scene.physics.resume();
			}
		});
	}

	// White flash on hit, restoring the sprite's variant tint afterwards.
	flashSprite(sprite: EnemySprite, durationMs = 70): void {
		if (!sprite || sprite.destroyed) {
			return;
		}

		sprite.setTintFill(0xffffff);

		this.scene.time.delayedCall(durationMs, () => {
			if (!sprite || sprite.destroyed || !sprite.active) {
				return;
			}

			sprite.clearTint();
			const tint = sprite.catalog?.tint;
			if (tint) {
				sprite.setTint(Phaser.Display.Color.HexStringToColor(tint).color);
			}
		});
	}

	// Create or update health bar above an entity
	updateHealthBar(entity: HealthBarEntity, maxHp: number, currentHp: number, width = 40, height = 6): HealthBar | null {
		if (!entity || maxHp <= 0) {
			return null;
		}

		// (original JS appended `?? Math.random()` — unreachable, the string is never nullish)
		const key = entity.constructor.name + '_' + (entity as { id?: number }).id;
		let barContainer = this.healthBars.get(entity);

		if (!barContainer) {
			// Create new health bar
			barContainer = {
				background: this.scene.add.rectangle(entity.x, entity.y - 35, width + 2, height + 2, 0x000000),
				bar: this.scene.add.rectangle(entity.x, entity.y - 35, width, height, 0x00ff00),
				entity: entity,
			};
			barContainer.background.setOrigin(0.5, 0.5);
			barContainer.bar.setOrigin(0.5, 0.5);
			barContainer.background.setDepth(entity.depth + 1);
			barContainer.bar.setDepth(entity.depth + 1);
			this.healthBars.set(entity, barContainer);
		}

		// Update position and bar
		const hpPercent = Math.max(0, Math.min(1, currentHp / maxHp));
		barContainer.background.setPosition(entity.x, entity.y - 35);
		barContainer.bar.setPosition(entity.x, entity.y - 35);
		barContainer.bar.setDisplaySize(width * hpPercent, height);

		// Change color based on HP
		if (hpPercent > 0.5) {
			barContainer.bar.setFillStyle(0x00ff00); // green
		} else if (hpPercent > 0.25) {
			barContainer.bar.setFillStyle(0xffff00); // yellow
		} else {
			barContainer.bar.setFillStyle(0xff0000); // red
		}

		return barContainer;
	}

	// Remove health bar
	removeHealthBar(entity: HealthBarEntity): void {
		if (!entity) return;
		const bar = this.healthBars.get(entity);
		if (bar) {
			if (bar.background && !bar.background.destroyed) {
				bar.background.destroy();
			}
			if (bar.bar && !bar.bar.destroyed) {
				bar.bar.destroy();
			}
			this.healthBars.delete(entity);
		}
	}

	// Show floating damage text
	showDamageText(x: number, y: number, damage: number | string, isCrit = false, colorOverride: string | null = null): void {
		const fontSize = isCrit ? 28 : 20;
		const color = colorOverride ?? (isCrit ? '#ffff00' : '#ff4444');
		const shadowColor = isCrit ? '#ff8800' : '#000000';

		const text = this.scene.add.text(x, y, damage.toString(), {
			font: `bold ${fontSize}px Arial`,
			fill: color,
			stroke: shadowColor,
			strokeThickness: 2,
			align: 'center',
		} as Phaser.Types.GameObjects.Text.TextStyle);

		text.setOrigin(0.5, 0.5);
		text.setDepth(100);
		const scale = isCrit ? 1.3 : 1.0;
		text.setScale(scale);

		// Animate floating up and fade out
		this.scene.tweens.add({
			targets: text,
			y: y - 60,
			alpha: 0,
			duration: 1000,
			ease: 'Quad.easeOut',
			onComplete: () => {
				text.destroy();
			},
		});
	}

	// Clean up all health bars
	destroy(): void {
		for (const [entity, bar] of this.healthBars) {
			bar.background.destroy();
			bar.bar.destroy();
		}
		this.healthBars.clear();
	}
}
