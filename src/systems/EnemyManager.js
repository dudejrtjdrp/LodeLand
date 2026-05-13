import Phaser from 'phaser';

export default class EnemyManager {
	constructor(scene, options = {}) {
		this.scene = scene;
		this.enemies = scene.physics.add.group({ maxSize: options.maxEnemies ?? 128 });
		this.enemyHp = options.hp ?? 30;
		this.enemySpeed = options.speed ?? 80;
		this.enemyDamage = options.damage ?? 10;
		this.xpOrbValue = options.xpOrbValue ?? 25;
		this.spawnDistance = options.spawnDistance ?? 600;
		this.spawnInterval = options.spawnInterval ?? 2000;
		this.minimumSpawnInterval = options.minimumSpawnInterval ?? 600;
		this.spawnIntervalStep = options.spawnIntervalStep ?? 100;
		this.spawnTimer = 0;
		this.nextSpawnInterval = this.spawnInterval;
		this.totalSpawned = 0;
	}

	spawnEnemy(scene = this.scene, player) {
		if (!scene || !player) {
			return false;
		}

		const position = this.getSpawnPosition(scene, player);
		let enemy = this.enemies.getFirstDead(false);

		if (!enemy) {
			enemy = this.enemies.create(position.x, position.y, 'enemy');
		}

		if (!enemy) {
			return false;
		}

		enemy.enableBody?.(true, position.x, position.y, true, true);
		enemy.setDepth(1);
		enemy.setCollideWorldBounds(false);
		enemy.setActive(true);
		enemy.setVisible(true);
		enemy.hp = this.enemyHp;
		enemy.speed = this.enemySpeed;
		enemy.damage = this.enemyDamage;

		if (enemy.body) {
			enemy.body.setAllowGravity(false);
			enemy.body.setImmovable(false);
		}

		this.totalSpawned += 1;
		return enemy;
	}

	update(player, delta) {
		if (!this.scene || !player) {
			return;
		}

		this.spawnTimer += delta;

		while (this.spawnTimer >= this.nextSpawnInterval) {
			this.spawnTimer -= this.nextSpawnInterval;
			this.spawnEnemy(this.scene, player);
			this.increaseSpawnRate();
		}

		for (const enemy of this.enemies.getChildren()) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}

			this.scene.physics.moveTo(enemy, player.x, player.y, enemy.speed ?? this.enemySpeed);
		}
	}

	takeDamage(enemy, amount, player = this.scene?.player) {
		if (!this.isAliveEnemy(enemy)) {
			return;
		}

		enemy.hp -= amount;

		if (enemy.hp <= 0) {
			this.die(enemy, player);
		}
	}

	die(enemy, player = this.scene?.player) {
		if (!enemy || enemy.destroyed) {
			return;
		}

		this.playDeathEffect(enemy.x, enemy.y);
		this.scene?.events?.emit('enemy-died', {
			enemy,
			x: enemy.x,
			y: enemy.y,
			amount: this.xpOrbValue,
			player,
		});
		this.recycleEnemy(enemy);
	}

	playDeathEffect(x, y) {
		if (!this.scene) {
			return;
		}

		const flash = this.scene.add.circle(x, y, 10, 0xffd166, 0.9);

		this.scene.tweens.add({
			targets: flash,
			scale: 2.5,
			alpha: 0,
			duration: 180,
			onComplete: () => {
				flash.destroy();
			},
		});
	}

	recycleEnemy(enemy) {
		if (!enemy) {
			return;
		}

		enemy.setVelocity(0, 0);
		enemy.disableBody?.(true, true);
		enemy.setActive(false);
		enemy.setVisible(false);
	}

	increaseSpawnRate() {
		this.nextSpawnInterval = Math.max(this.minimumSpawnInterval, this.nextSpawnInterval - this.spawnIntervalStep);
	}

	getSpawnPosition(scene, player) {
		const { width, height } = scene.scale;
		const camera = scene.cameras.main;
		const worldCenterX = player.x;
		const worldCenterY = player.y;
		const screenLeft = camera.scrollX;
		const screenTop = camera.scrollY;
		const screenRight = screenLeft + width;
		const screenBottom = screenTop + height;

		for (let attempt = 0; attempt < 12; attempt += 1) {
			const angle = Phaser.Math.FloatBetween(0, Phaser.Math.PI2);
			const x = worldCenterX + Math.cos(angle) * this.spawnDistance;
			const y = worldCenterY + Math.sin(angle) * this.spawnDistance;

			if (x < screenLeft || x > screenRight || y < screenTop || y > screenBottom) {
				return { x, y };
			}
		}

		return {
			x: worldCenterX + this.spawnDistance,
			y: worldCenterY,
		};
	}

	isAliveEnemy(enemy) {
		return Boolean(enemy && enemy.active !== false && enemy.visible !== false && !enemy.destroyed);
	}
}
