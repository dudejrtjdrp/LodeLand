import Phaser from 'phaser';

export default class SwordOrbitSystem {
	constructor(scene = null, options = {}) {
		this.scene = scene;
		this.radius = options.radius ?? 80;
		this.orbitSpeed = options.orbitSpeed ?? 2;
		this.launchSpeed = options.launchSpeed ?? 400;
		this.launchDuration = options.launchDuration ?? 420;
		this.returnSpeed = options.returnSpeed ?? 350;
		this.scanInterval = options.scanInterval ?? 1500;
		this.scanRadius = options.scanRadius ?? 300;
		this.closeScanRadius = options.closeScanRadius ?? 120;
		this.damage = options.damage ?? 20;
		this.minSwords = options.minSwords ?? 1;
		this.maxSwords = options.maxSwords ?? 8;
		this.rotationOffset = options.rotationOffset ?? -5 * Math.PI / 4;
		this.returnLerp = options.returnLerp ?? 0.16;
		this.baseAngle = 0;
		this.swords = [];
		this.enemyGroup = null;

		if (this.scene) {
			this.ensureMinimumSwords(this.scene);
		}
	}

	setEnemyGroup(enemyGroup) {
		if (!enemyGroup || this.enemyGroup === enemyGroup) {
			this.enemyGroup = enemyGroup ?? this.enemyGroup;
			return;
		}

		this.enemyGroup = enemyGroup;

		for (const sword of this.swords) {
			this.bindSwordOverlap(sword);
		}
	}

	ensureMinimumSwords(scene = this.scene) {
		if (!scene) {
			return;
		}

		while (this.swords.length < this.minSwords) {
			this.addSword(scene);
		}
	}

	addSword(scene = this.scene) {
		if (!scene || this.swords.length >= this.maxSwords) {
			return false;
		}

		const frame = this.swords.length % 30;
		const sword = scene.physics.add.sprite(0, 0, 'sword', frame);

		sword.setOrigin(0.5, 0.5);
		sword.setDepth(2);
		sword.setActive(true);
		sword.setVisible(true);
		sword.setDisplaySize(32, 32);

		if (sword.body) {
			sword.body.setAllowGravity(false);
			sword.body.setImmovable(true);
			sword.body.setSize(24, 24, true);
		}

		const slot = this.swords.length;
		sword.slot = slot;
		sword.state = 'orbiting';
		sword.target = null;
		sword.scanTimer = 0;
		Object.defineProperty(sword, 'angle', {
			value: 0,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		this.swords.push(sword);
		this.bindSwordOverlap(sword);
		this.updateSwordPositions(this.scene?.player ?? null);

		return sword;
	}

	bindSwordOverlap(sword) {
		if (!this.scene || !this.enemyGroup || !sword?.body || sword._orbitEnemyGroup === this.enemyGroup) {
			return;
		}

		this.scene.physics.add.overlap(sword, this.enemyGroup, this.handleSwordEnemyOverlap, null, this);
		sword._orbitEnemyGroup = this.enemyGroup;
	}

	update(player, delta, enemiesGroup = this.enemyGroup) {
		if (!player) {
			return;
		}

		if (enemiesGroup) {
			this.setEnemyGroup(enemiesGroup);
		}

		this.ensureMinimumSwords();

		const deltaSeconds = delta / 1000;
		this.baseAngle = Phaser.Math.Wrap(this.baseAngle + this.orbitSpeed * deltaSeconds, 0, Phaser.Math.PI2);

		const claimedTargets = new Set();
		for (const sword of this.swords) {
			if (sword.state === 'launched' && this.isValidEnemy(sword.target)) {
				claimedTargets.add(sword.target);
			}
		}

		for (const sword of this.swords) {
			this.updateSword(player, sword, delta, this.enemyGroup, claimedTargets);
		}

		this.updateSwordPositions(player);
	}

	updateSwordPositions(player) {
		if (!player || this.swords.length === 0) {
			return;
		}

		const count = this.swords.length;
		const step = Phaser.Math.PI2 / count;

		for (const sword of this.swords) {
			if (sword.state !== 'orbiting') {
				continue;
			}

			const angle = Phaser.Math.Wrap(this.baseAngle + step * sword.slot, 0, Phaser.Math.PI2);
			const x = player.x + Math.cos(angle) * this.radius;
			const y = player.y + Math.sin(angle) * this.radius;

			sword.angle = angle;
			sword.setPosition(x, y);
			sword.rotation = angle + this.rotationOffset;
			sword.setVelocity(0, 0);
		}
	}

	updateSword(player, sword, delta, enemiesGroup, claimedTargets) {
		switch (sword.state) {
			case 'orbiting':
				this.updateOrbitingSword(player, sword, delta, enemiesGroup, claimedTargets);
				break;
			case 'launched':
				this.updateLaunchedSword(player, sword, delta, enemiesGroup);
				break;
			case 'returning':
				this.updateReturningSword(player, sword, delta, enemiesGroup, claimedTargets);
				break;
			default:
				sword.state = 'orbiting';
				sword.scanTimer = 0;
				break;
		}
	}

	updateOrbitingSword(player, sword, delta, enemiesGroup, claimedTargets) {
		const closeTarget = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.closeScanRadius, claimedTargets);
		if (closeTarget) {
			sword.scanTimer = 0;
			this.startLaunchedSword(sword, closeTarget, claimedTargets);
			return;
		}

		sword.scanTimer = (sword.scanTimer ?? 0) + delta;

		if (sword.scanTimer < this.scanInterval) {
			return;
		}

		sword.scanTimer = 0;

		const target = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.scanRadius, claimedTargets);

		if (target) {
			this.startLaunchedSword(sword, target, claimedTargets);
		}
	}

	updateLaunchedSword(player, sword, delta, enemiesGroup) {
		if (!this.isValidEnemy(sword.target)) {
			this.startReturningSword(sword);
			return;
		}

		sword.launchElapsed = (sword.launchElapsed ?? 0) + delta;
		if (sword.launchElapsed >= this.launchDuration) {
			this.startReturningSword(sword);
			return;
		}

		const target = sword.target;
		const hitDistance = 22;
		if (Phaser.Math.Distance.Between(sword.x, sword.y, target.x, target.y) <= hitDistance) {
			this.applyDamage(target, this.damage);
			this.startReturningSword(sword);
			return;
		}

		const velocityX = Math.cos(sword.launchAngle) * this.launchSpeed;
		const velocityY = Math.sin(sword.launchAngle) * this.launchSpeed;

		sword.setVelocity(velocityX, velocityY);
		sword.rotation = sword.launchAngle + this.rotationOffset;

		if (enemiesGroup) {
			this.setEnemyGroup(enemiesGroup);
		}
	}

	updateReturningSword(player, sword, delta, enemiesGroup, claimedTargets) {
		const closeTarget = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.closeScanRadius, claimedTargets);
		if (closeTarget) {
			this.startLaunchedSword(sword, closeTarget, claimedTargets);
			return;
		}

		const orbitPosition = this.getOrbitPosition(player, sword);
		const returnFactor = Phaser.Math.Clamp((delta / 16.6667) * this.returnLerp, 0, 1);
		const nextX = Phaser.Math.Linear(sword.x, orbitPosition.x, returnFactor);
		const nextY = Phaser.Math.Linear(sword.y, orbitPosition.y, returnFactor);
		const dx = orbitPosition.x - nextX;
		const dy = orbitPosition.y - nextY;
		const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

		if (distanceToTarget < 2) {
			sword.state = 'orbiting';
			sword.target = null;
				sword.scanTimer = this.scanInterval;
			sword.returnCurveSide = 0;
			sword.returnTurnProgress = 0;
			sword.returnStartRotation = undefined;
			sword.returnStartX = undefined;
			sword.returnStartY = undefined;
			sword.setVelocity(0, 0);
			sword.setPosition(orbitPosition.x, orbitPosition.y);
			sword.rotation = orbitPosition.angle + this.rotationOffset;
			return;
		}

		sword.setPosition(nextX, nextY);
		sword.setVelocity(0, 0);

		const startRotation = sword.returnStartRotation ?? sword.rotation;
		const targetRotation = orbitPosition.angle + this.rotationOffset;
		const turnProgress = Math.min(1, (sword.returnTurnProgress ?? 0) + returnFactor * 0.8);
		sword.returnTurnProgress = turnProgress;
		sword.rotation = Phaser.Math.Linear(startRotation, targetRotation, turnProgress);
	}

	startLaunchedSword(sword, target, claimedTargets = null) {
		if (!sword || !this.isValidEnemy(target)) {
			return;
		}

		sword.state = 'launched';
		sword.target = target;
		sword.returnTurnProgress = 0;
		sword.returnStartRotation = sword.rotation;
		sword.launchElapsed = 0;
		const launchAngle = Math.atan2(target.y - sword.y, target.x - sword.x);
		sword.launchAngle = launchAngle;
		sword.rotation = launchAngle + this.rotationOffset;

		if (claimedTargets) {
			claimedTargets.add(target);
		}
	}

	findNearestEnemy(sourceX, sourceY, enemiesGroup, radius = this.scanRadius, excludeTargets = null) {
		if (!enemiesGroup) {
			return null;
		}

		const enemies = this.getEnemyChildren(enemiesGroup);
		const maxDistanceSquared = radius * radius;
		let nearestEnemy = null;
		let nearestDistanceSquared = maxDistanceSquared;

		for (const enemy of enemies) {
			if (!this.isValidEnemy(enemy)) {
				continue;
			}

			if (excludeTargets?.has(enemy)) {
				continue;
			}

			const dx = enemy.x - sourceX;
			const dy = enemy.y - sourceY;
			const distanceSquared = dx * dx + dy * dy;

			if (distanceSquared <= nearestDistanceSquared) {
				nearestDistanceSquared = distanceSquared;
				nearestEnemy = enemy;
			}
		}

		return nearestEnemy;
	}

	handleSwordEnemyOverlap(sword, enemy) {
		if (!sword || sword.state !== 'launched') {
			return;
		}

		this.applyDamage(enemy, this.damage);
		this.startReturningSword(sword);
	}

	startReturningSword(sword) {
		if (!sword) {
			return;
		}

		sword.state = 'returning';
		sword.target = null;
		sword.returnCurveSide = sword.slot % 2 === 0 ? 1 : -1;
		sword.returnTurnProgress = 0;
		sword.returnStartRotation = sword.rotation;
		sword.returnStartX = sword.x;
		sword.returnStartY = sword.y;
		sword.launchElapsed = 0;
		sword.launchAngle = undefined;
		sword.setVelocity(0, 0);
	}

	applyDamage(enemy, amount) {
		if (!this.isValidEnemy(enemy)) {
			return;
		}

		if (typeof enemy.takeDamage === 'function') {
			enemy.takeDamage(amount);
			return;
		}

		if (typeof enemy.damage === 'function') {
			enemy.damage(amount);
			return;
		}

		if (typeof enemy.health === 'number') {
			enemy.health -= amount;
			if (enemy.health <= 0) {
				enemy.destroy?.();
			}
			return;
		}

		if (typeof enemy.hp === 'number') {
			enemy.hp -= amount;
			if (enemy.hp <= 0) {
				enemy.destroy?.();
			}
		}
	}

	snapSwordToOrbit(player, sword) {
		const orbitPosition = this.getOrbitPosition(player, sword);
		sword.angle = orbitPosition.angle;
		sword.setPosition(orbitPosition.x, orbitPosition.y);
		sword.rotation = orbitPosition.angle + this.rotationOffset;
	}

	getOrbitPosition(player, sword) {
		const count = this.swords.length;
		if (!count) {
			return { x: player.x, y: player.y, angle: 0 };
		}

		const angle = Phaser.Math.Wrap(this.baseAngle + (Phaser.Math.PI2 / count) * sword.slot, 0, Phaser.Math.PI2);
		return {
			x: player.x + Math.cos(angle) * this.radius,
			y: player.y + Math.sin(angle) * this.radius,
			angle,
		};
	}

	getEnemyChildren(enemiesGroup) {
		if (!enemiesGroup) {
			return [];
		}

		if (typeof enemiesGroup.getChildren === 'function') {
			return enemiesGroup.getChildren();
		}

		if (Array.isArray(enemiesGroup.children?.entries)) {
			return enemiesGroup.children.entries;
		}

		return [];
	}

	isValidEnemy(enemy) {
		return Boolean(enemy && enemy.active !== false && enemy.visible !== false && !enemy.destroyed);
	}
}
