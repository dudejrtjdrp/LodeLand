import Phaser from 'phaser';

export default class ProgressionSystem {
	constructor(scene, swordOrbit, options = {}) {
		this.scene = scene;
		this.swordOrbit = swordOrbit ?? null;
		this.player = null;
		this.level = 1;
		this.xp = 0;
		this.xpToNext = 100;
		this.orbXp = options.orbXp ?? 25;
		this.collectRadius = options.collectRadius ?? 60;
		this.orbs = scene.physics.add.group({ maxSize: options.maxOrbs ?? 256 });
		this.hudBackground = scene.add.graphics().setScrollFactor(0).setDepth(1000);
		this.hudFill = scene.add.graphics().setScrollFactor(0).setDepth(1001);
		this.hudText = scene.add.text(18, 16, 'Lv. 1', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '18px',
			color: '#ffffff',
		}).setScrollFactor(0).setDepth(1002);

		this.hudText.setShadow(0, 2, '#000000', 2, false, true);
		this.scene.events.on('enemy-died', this.handleEnemyDeath, this);
		this.refreshPlayerStats();
		this.drawHud();
	}

	attachPlayer(player) {
		this.player = player;
		this.refreshPlayerStats();
		this.drawHud();
	}

	handleEnemyDeath(payload) {
		const x = payload?.x ?? payload?.enemy?.x;
		const y = payload?.y ?? payload?.enemy?.y;
		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		this.spawnXPOrb(x, y, payload?.amount ?? this.orbXp);
	}

	spawnXPOrb(x, y, amount = this.orbXp) {
		let orb = this.orbs.getFirstDead(false);

		if (!orb) {
			orb = this.orbs.create(x, y, 'xp_orb');
		}

		if (!orb) {
			return false;
		}

		orb.enableBody?.(true, x, y, true, true);
		orb.setDepth(2);
		orb.amount = amount;
		orb.setCircle(Math.max(6, orb.width * 0.35));

		if (orb.body) {
			orb.body.setAllowGravity(false);
			orb.body.setImmovable(true);
		}

		return orb;
	}

	update(player = this.player, delta) {
		if (player) {
			this.player = player;
		}

		if (!this.player) {
			return;
		}

		for (const orb of this.orbs.getChildren()) {
			if (!this.isAliveOrb(orb)) {
				continue;
			}

			const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, orb.x, orb.y);
			if (distance <= this.collectRadius) {
				this.collectOrb(orb);
			}
		}

		this.drawHud();
	}

	collectOrb(orb) {
		if (!this.isAliveOrb(orb)) {
			return;
		}

		this.addXP(orb.amount ?? this.orbXp);
		this.recycleOrb(orb);
	}

	addXP(amount) {
		this.xp += amount;

		while (this.xp >= this.xpToNext) {
			this.xp -= this.xpToNext;
			this.levelUp();
		}

		this.refreshPlayerStats();
		this.drawHud();
	}

	levelUp() {
		this.level += 1;
		this.xpToNext = Math.ceil(this.xpToNext * 1.4);

		if ([2, 4, 6, 8, 10].includes(this.level) && this.swordOrbit && typeof this.swordOrbit.addSword === 'function') {
			this.swordOrbit.addSword(this.scene);
		}

		this.refreshPlayerStats();
		this.scene.events.emit('levelup', this.level);
	}

	refreshPlayerStats() {
		if (!this.player) {
			return;
		}

		this.player.xp = this.xp;
		this.player.level = this.level;
		this.player.xpToNext = this.xpToNext;
	}

	drawHud() {
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

		this.hudText.setText(`Lv. ${this.level}   ${Math.floor(this.xp)} / ${this.xpToNext}`);
	}

	isAliveOrb(orb) {
		return Boolean(orb && orb.active !== false && orb.visible !== false && !orb.destroyed);
	}

	recycleOrb(orb) {
		if (!orb) {
			return;
		}

		orb.setVelocity(0, 0);
		orb.disableBody?.(true, true);
		orb.setActive(false);
		orb.setVisible(false);
	}
}
