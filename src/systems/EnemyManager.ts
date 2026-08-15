import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { DamageType, EnemyBehaviorSpec, EnemyDefinition } from '../types/catalogs';
import type { EnemyProjectile, EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';
import { enemyKnockbackForce, mitigateEnemyDamage, resistFor } from '../logic/combat';

/** Pool entries handed to setSpawnProfile (weight defaults to 1 when omitted). */
interface SpawnPoolEntry {
	id: string;
	weight?: number;
}

interface SpawnProfileOptions {
	spawnIntervalMs?: number;
	pool?: SpawnPoolEntry[];
	minAlive?: number;
}

interface EnemyManagerOptions {
	maxEnemies?: number;
	hp?: number;
	speed?: number;
	damage?: number;
	xpOrbValue?: number;
	spawnDistance?: number;
	spawnInterval?: number;
	minimumSpawnInterval?: number;
	spawnIntervalStep?: number;
	maxBurstPerFrame?: number;
	hpMult?: number;
	damageMult?: number;
	enemyCatalog?: EnemyDefinition[];
}

interface TakeDamageOptions {
	silent?: boolean;
	ignoreResist?: boolean;
	damageType?: DamageType;
	pen?: number;
}

/**
 * Enemies managed by this system always have their behavior timers initialized
 * in spawnEnemy, so they are non-optional here.
 */
type ManagedEnemy = EnemySprite & {
	fireTimer: number;
	healTimer: number;
	fuseStartedAt: number;
	dotUntil: number;
	dotDps: number;
	dotTick: number;
	slowUntil: number;
	slowFactor: number;
};

/** `expiresAt` is missing from the shared EnemyProjectile type; extended locally. */
type ManagedProjectile = EnemyProjectile & { expiresAt?: number };

export default class EnemyManager {
	scene: GameScene;
	enemies: Phaser.Physics.Arcade.Group;
	enemyHp: number;
	enemySpeed: number;
	enemyDamage: number;
	xpOrbValue: number;
	spawnDistance: number;
	spawnInterval: number;
	minimumSpawnInterval: number;
	spawnIntervalStep: number;
	spawnTimer: number;
	nextSpawnInterval: number;
	totalSpawned: number;
	enemyCatalog: EnemyDefinition[];
	spawnPool: SpawnPoolEntry[] | null;
	minAlive: number;
	maxBurstPerFrame: number;
	hpMult: number;
	damageMult: number;
	projectiles: Phaser.Physics.Arcade.Group;

	constructor(scene: GameScene, options: EnemyManagerOptions = {}) {
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
		this.enemyCatalog = Array.isArray(options.enemyCatalog) ? options.enemyCatalog : [];
		this.spawnPool = null;
		this.minAlive = 0;
		this.maxBurstPerFrame = options.maxBurstPerFrame ?? 3;
		this.hpMult = options.hpMult ?? 1;
		this.damageMult = options.damageMult ?? 1;
		this.projectiles = scene.physics.add.group({ maxSize: 96 });
	}

	setSpawnProfile({ spawnIntervalMs, pool, minAlive }: SpawnProfileOptions = {}): void {
		if (typeof spawnIntervalMs === 'number') {
			this.nextSpawnInterval = spawnIntervalMs;
			this.spawnIntervalStep = 0;
		}

		if (Array.isArray(pool)) {
			this.spawnPool = pool;
		}

		if (typeof minAlive === 'number') {
			this.minAlive = minAlive;
		}
	}

	getEnemyTypeById(id: string): EnemyDefinition | null {
		return this.enemyCatalog.find((entry) => entry.id === id) ?? null;
	}

	pickFromSpawnPool(): EnemyDefinition | null {
		if (!Array.isArray(this.spawnPool) || this.spawnPool.length === 0) {
			return this.getRandomEnemyType();
		}

		const totalWeight = this.spawnPool.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
		let roll = Math.random() * totalWeight;

		for (const entry of this.spawnPool) {
			roll -= entry.weight ?? 1;
			if (roll <= 0) {
				return this.getEnemyTypeById(entry.id) ?? this.getRandomEnemyType();
			}
		}

		return this.getRandomEnemyType();
	}

	getRandomEnemyType(): EnemyDefinition | null {
		if (!this.enemyCatalog.length) {
			return null;
		}
		return this.enemyCatalog[Math.floor(Math.random() * this.enemyCatalog.length)];
	}

	spawnEnemy(
		scene: GameScene = this.scene,
		player?: PlayerSprite,
		typeId: string | null = null,
		positionOverride: { x: number; y: number } | null = null,
	): ManagedEnemy | false {
		if (!scene || !player) {
			return false;
		}

		const position = positionOverride ?? this.getSpawnPosition(scene, player);
		let enemy = this.enemies.getFirstDead(false) as ManagedEnemy | null;

		// Get enemy type: explicit id > weighted wave pool > random catalog entry
		const enemyType = (typeId ? this.getEnemyTypeById(typeId) : this.pickFromSpawnPool()) ?? ({} as Partial<EnemyDefinition>);
		const config = enemyType ?? {};

		// Determine texture key based on spriteType
		let textureKey = 'enemy'; // fallback
		if (config.spriteType === 'aseprite') {
			textureKey = config.spritesheet?.textureKey ?? 'enemy';
			// Verify texture exists before using it
			if (!this.scene?.textures?.exists(textureKey)) {
				textureKey = 'enemy';
			}
		} else if (config.spriteType === 'separate') {
			textureKey = config.spritesheets?.idle?.textureKey ?? 'enemy';
			// Verify texture exists before using it
			if (!this.scene?.textures?.exists(textureKey)) {
				textureKey = 'enemy';
			}
		}

		if (!enemy) {
			enemy = this.enemies.create(position.x, position.y, textureKey) as ManagedEnemy | null;
		} else {
			enemy.setTexture(textureKey);
			enemy.setFrame?.(0);
			// Guard: stop() emits an event that reads currentFrame - crash if none.
			if (enemy.anims?.currentFrame) {
				enemy.anims.stop();
			}
		}

		if (!enemy) {
			return false;
		}

		enemy.enableBody?.(true, position.x, position.y, true, true);
		enemy.setDepth(1);
		enemy.setCollideWorldBounds(false);
		enemy.setActive(true);
		enemy.setVisible(true);
		enemy.hp = Math.round((config.hp ?? this.enemyHp) * this.hpMult);
		enemy.maxHp = enemy.hp;
		enemy.speed = config.speed ?? this.enemySpeed;
		enemy.damage = Math.round((config.damage ?? this.enemyDamage) * this.damageMult);
		enemy.enemyType = config.id ?? 'default';
		enemy.enemyName = config.name ?? 'Enemy';
		enemy.xpValue = config.xpValue ?? this.xpOrbValue;
		enemy.critChance = config.critChance ?? 0;
		enemy.critDamageMultiplier = config.critDamageMultiplier ?? 1.0;
		enemy.spriteType = config.spriteType ?? 'placeholder';
		enemy.catalog = config as EnemyDefinition; // Store full config for later animation access
		enemy.knockbackUntil = 0;
		enemy.knockbackResist = config.knockbackResist ?? 0;
		enemy.healthBarWidth = config.healthBarWidth ?? 40;
		enemy.isDying = false;
		enemy.spawnGeneration = (enemy.spawnGeneration ?? 0) + 1;
		enemy.behavior = (config.behavior ?? null) as EnemyBehaviorSpec | undefined;
		enemy.physicalResist = config.physicalResist ?? 0;
		enemy.magicResist = config.magicResist ?? 0;
		enemy.splitInto = (config.splitInto ?? null) as EnemySprite['splitInto'];
		enemy.fireTimer = Phaser.Math.Between(0, 800);
		enemy.healTimer = 0;
		enemy.fuseStartedAt = 0;
		enemy.dotUntil = 0;
		enemy.dotDps = 0;
		enemy.dotTick = 0;
		enemy.dotColor = null as unknown as number;
		enemy.slowUntil = 0;
		enemy.slowFactor = 1;

		// Reset pooled state, then apply variant tint (works for spritesheets too)
		enemy.clearTint();
		enemy.setAlpha(1);
		if (config.tint) {
			enemy.setTint(Phaser.Display.Color.HexStringToColor(config.tint).color);
		} else if (config.color && config.spriteType !== 'aseprite' && config.spriteType !== 'separate') {
			enemy.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
		}

		// Set display size if specified
		if (config.size) {
			enemy.setDisplaySize(config.size.width, config.size.height);
		}

		// Play idle animation if spritesheet exists
		if ((config.spriteType === 'aseprite' || config.spriteType === 'separate') && enemy.play) {
			const idleAnimKey = `${config.id}-idle`;
			const animExists = this.scene?.anims?.exists(idleAnimKey);
			console.log(`Spawning ${config.id}: idleAnimKey=${idleAnimKey}, exists=${animExists}`);
			if (animExists) {
				try {
					enemy.play(idleAnimKey, true);
					console.log(`✓ Playing animation: ${idleAnimKey}`);
				} catch (err) {
					console.warn(`Failed to play animation ${idleAnimKey}:`, (err as Error).message);
				}
			} else {
				console.warn(`Animation not found: ${idleAnimKey}`);
			}
		}

		if (enemy.body) {
			(enemy.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
			(enemy.body as Phaser.Physics.Arcade.Body).setImmovable(false);
		}

		this.totalSpawned += 1;
		return enemy;
	}

	update(player: PlayerSprite, delta: number): void {
		if (!this.scene || !player) {
			return;
		}

		this.spawnTimer += delta;

		while (this.spawnTimer >= this.nextSpawnInterval) {
			this.spawnTimer -= this.nextSpawnInterval;
			this.spawnEnemy(this.scene, player);
			this.increaseSpawnRate();
		}

		// Keep the pressure on: top up to the wave's minimum alive count.
		if (this.minAlive > 0) {
			const aliveCount = this.enemies.getChildren().filter((enemy) => this.isAliveEnemy(enemy as EnemySprite)).length;
			const deficit = Math.min(this.minAlive - aliveCount, this.maxBurstPerFrame);
			for (let i = 0; i < deficit; i += 1) {
				this.spawnEnemy(this.scene, player);
			}
		}

		const now = this.scene.time?.now ?? 0;
		for (const enemy of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}

			this.updateDot(enemy, now, delta);

			if (!this.isAliveEnemy(enemy) || enemy.isDying) {
				continue;
			}

			// Let knockback impulses play out before resuming the chase.
			if (now < (enemy.knockbackUntil ?? 0)) {
				continue;
			}

			this.updateEnemyBehavior(enemy, player, now, delta);

			// Face towards player (flip logic reversed)
			if (enemy.x < player.x) {
				enemy.setFlipX(true); // Face right
			} else {
				enemy.setFlipX(false); // Face left
			}
		}

		this.updateProjectiles(now);
	}

	// ---------------------------------------------------------------
	// Behaviors: ranged / bomber / healer / default chase
	// ---------------------------------------------------------------

	updateEnemyBehavior(enemy: ManagedEnemy, player: PlayerSprite, now: number, delta: number): void {
		const behavior = enemy.behavior;
		const slowed = now < (enemy.slowUntil ?? 0);
		const speed = (enemy.speed ?? this.enemySpeed) * (slowed ? (enemy.slowFactor ?? 1) : 1);
		const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);

		if (behavior?.type === 'ranged') {
			const range = behavior.range ?? 380;

			if (distance > range) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < range * 0.6) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed * 0.8, Math.sin(angle) * speed * 0.8);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.fireTimer += delta;
			if (enemy.fireTimer >= (behavior.fireIntervalMs ?? 2200) && distance <= range * 1.2) {
				enemy.fireTimer = 0;
				this.fireProjectiles(enemy, player, behavior);
			}
			return;
		}

		if (behavior?.type === 'bomber') {
			if (enemy.fuseStartedAt > 0) {
				enemy.setVelocity(0, 0);
				if (now - enemy.fuseStartedAt >= (behavior.fuseMs ?? 900)) {
					this.explodeBomber(enemy, player, behavior);
				}
				return;
			}

			if (distance <= 130) {
				enemy.fuseStartedAt = now;
				enemy.setVelocity(0, 0);
				this.scene.tweens.add({
					targets: enemy,
					scaleX: enemy.scaleX * 1.35,
					scaleY: enemy.scaleY * 1.35,
					yoyo: true,
					repeat: 3,
					duration: (behavior.fuseMs ?? 900) / 8,
				});
				enemy.setTintFill(0xff6b6b);
				return;
			}

			this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			return;
		}

		if (behavior?.type === 'healer') {
			const keepDistance = behavior.keepDistance ?? 320;

			if (distance > keepDistance + 60) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < keepDistance - 60) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.healTimer += delta;
			if (enemy.healTimer >= (behavior.healIntervalMs ?? 2500)) {
				enemy.healTimer = 0;
				this.healPulse(enemy, behavior);
			}
			return;
		}

		this.scene.physics.moveTo(enemy, player.x, player.y, speed);
	}

	fireProjectiles(enemy: ManagedEnemy, player: PlayerSprite, behavior: EnemyBehaviorSpec): void {
		const count = behavior.projectileCount ?? 1;
		const spread = Phaser.Math.DegToRad(behavior.spreadDeg ?? 0);
		const baseAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);

		for (let i = 0; i < count; i += 1) {
			const offset = count > 1 ? spread * (i / (count - 1) - 0.5) : 0;
			const angle = baseAngle + offset;

			let bullet = this.projectiles.getFirstDead(false) as ManagedProjectile | null;
			if (!bullet) {
				bullet = this.projectiles.create(enemy.x, enemy.y, 'enemy_bullet') as ManagedProjectile | null;
			}
			if (!bullet) {
				return;
			}

			bullet.enableBody?.(true, enemy.x, enemy.y, true, true);
			bullet.setActive(true).setVisible(true);
			bullet.setPosition(enemy.x, enemy.y);
			bullet.setDepth(40);
			bullet.setDisplaySize(12, 12);
			bullet.damage = behavior.projectileDamage ?? 12;
			bullet.expiresAt = (this.scene.time?.now ?? 0) + 3000;
			if (bullet.body) {
				(bullet.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
			}
			const speed = behavior.projectileSpeed ?? 260;
			bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
		}
	}

	updateProjectiles(now: number): void {
		for (const bullet of this.projectiles.getChildren() as ManagedProjectile[]) {
			if (bullet.active && now >= (bullet.expiresAt ?? 0)) {
				this.recycleProjectile(bullet);
			}
		}
	}

	recycleProjectile(bullet: EnemyProjectile | null | undefined): void {
		if (!bullet) {
			return;
		}
		bullet.setVelocity(0, 0);
		bullet.disableBody?.(true, true);
		bullet.setActive(false);
		bullet.setVisible(false);
	}

	explodeBomber(enemy: ManagedEnemy, player: PlayerSprite, behavior: EnemyBehaviorSpec): void {
		const radius = behavior.explodeRadius ?? 170;
		const blast = this.scene.add.circle(enemy.x, enemy.y, radius, 0xf97316, 0.4).setDepth(58);
		this.scene.tweens.add({
			targets: blast,
			alpha: 0,
			scale: 1.15,
			duration: 260,
			onComplete: () => blast.destroy(),
		});
		this.scene.cameras.main.shake(200, 0.006);
		this.scene.soundSystem?.play('bigkill', { volume: 0.6 });

		if (player && !player.isDead
			&& Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y) <= radius) {
			this.scene.applyPlayerDamage?.(behavior.explodeDamage ?? 40, enemy.x, enemy.y, 'magic');
		}

		// The bomber consumes itself (no split, no XP boost - xpValue still granted via die)
		this.die(enemy, player);
	}

	healPulse(healer: ManagedEnemy, behavior: EnemyBehaviorSpec): void {
		const radius = behavior.healRadius ?? 260;
		const radiusSquared = radius * radius;
		let healedAny = false;

		for (const ally of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(ally) || ally === healer || ally.isDying) {
				continue;
			}

			const dx = ally.x - healer.x;
			const dy = ally.y - healer.y;
			if (dx * dx + dy * dy > radiusSquared) {
				continue;
			}

			if (ally.hp < ally.maxHp) {
				ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(ally.maxHp * (behavior.healPercent ?? 0.12)));
				healedAny = true;
			}
		}

		if (healedAny) {
			const ring = this.scene.add.circle(healer.x, healer.y, radius, 0x4ade80, 0.15)
				.setStrokeStyle(2, 0x4ade80, 0.7)
				.setDepth(38);
			this.scene.tweens.add({
				targets: ring,
				alpha: 0,
				duration: 420,
				onComplete: () => ring.destroy(),
			});
		}
	}

	// Damage-over-time (sword burn/poison specials)
	applyDot(enemy: EnemySprite, dps: number, durationMs: number, color: number = 0xf97316): void {
		if (!this.isAliveEnemy(enemy)) {
			return;
		}

		const now = this.scene.time?.now ?? 0;
		enemy.dotUntil = now + durationMs;
		enemy.dotDps = Math.max(enemy.dotDps ?? 0, dps);
		enemy.dotColor = color;
	}

	updateDot(enemy: ManagedEnemy, now: number, delta: number): void {
		if (!enemy.dotUntil || now >= enemy.dotUntil) {
			enemy.dotDps = 0;
			return;
		}

		enemy.dotTick = (enemy.dotTick ?? 0) + delta;
		if (enemy.dotTick >= 500) {
			enemy.dotTick = 0;
			const tickDamage = Math.max(1, Math.round(enemy.dotDps * 0.5));
			enemy.lastDamageWasCrit = false;
			this.takeDamage(enemy, tickDamage, this.scene?.player, { silent: true });
			if (enemy.active) {
				enemy.setTint(enemy.dotColor ?? 0xf97316);
			}
		}
	}

	// Round transition: wipe the field (bosses and the reaper survive)
	clearField(): void {
		for (const enemy of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}
			if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			this.recycleEnemy(enemy);
		}

		for (const bullet of this.projectiles.getChildren() as ManagedProjectile[]) {
			this.recycleProjectile(bullet);
		}
	}

	takeDamage(
		enemy: EnemySprite,
		amount: number,
		player: PlayerSprite | undefined = this.scene?.player,
		options: TakeDamageOptions = {},
	): void {
		if (!this.isAliveEnemy(enemy) || enemy.isDying) {
			return;
		}

		// Typed mitigation: physical/magic resist, reduced by the attacker's penetration.
		// ignoreResist (true damage, %HP damage) bypasses everything.
		if (!options.ignoreResist) {
			const resist = resistFor(options.damageType, enemy.physicalResist ?? 0, enemy.magicResist ?? 0);
			amount = mitigateEnemyDamage(amount, resist, options.pen ?? 0);
		}

		enemy.hp -= amount;

		// Show damage text and health bar (magic = blue, true = gold)
		const isCrit = enemy.lastDamageWasCrit ?? false;
		if (this.scene?.visualEffects) {
			const textColor = options.ignoreResist ? '#fde047' : options.damageType === 'magic' ? '#93c5fd' : null;
			this.scene.visualEffects.showDamageText(enemy.x, enemy.y - 20, Math.round(amount), isCrit, textColor);
			this.scene.visualEffects.updateHealthBar(enemy, enemy.maxHp, Math.max(0, enemy.hp), enemy.healthBarWidth ?? 40);
			if (!options.silent) {
				this.scene.visualEffects.flashSprite(enemy);
			}
		}

		// Knockback away from the player (resisted by elites/bosses)
		const resist = enemy.knockbackResist ?? 0;
		if (!options.silent && resist < 1 && player && enemy.body) {
			const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
			const force = enemyKnockbackForce(resist);
			enemy.setVelocity(Math.cos(angle) * force, Math.sin(angle) * force);
			enemy.knockbackUntil = (this.scene?.time?.now ?? 0) + 140;
		}

		if (isCrit && !options.silent) {
			this.scene?.visualEffects?.hitStop(40);
		}

		// Play hit animation if spritesheet exists
		if (enemy.catalog && (enemy.catalog.spriteType === 'aseprite' || enemy.catalog.spriteType === 'separate') && enemy.play) {
			const hitAnimKey = `${enemy.catalog.id}-hit`;
			if (this.scene?.anims?.exists(hitAnimKey)) {
				try {
					enemy.play(hitAnimKey, true);
				} catch (err) {
					console.warn(`Failed to play animation ${hitAnimKey}:`, (err as Error).message);
				}
			}
		}

		if (enemy.hp <= 0) {
			this.die(enemy, player);
		}
	}

	die(enemy: EnemySprite, player: PlayerSprite | undefined = this.scene?.player): void {
		if (!enemy || enemy.destroyed || enemy.isDying) {
			return;
		}

		enemy.isDying = true;

		// Play death animation if spritesheet exists
		if (enemy.catalog && (enemy.catalog.spriteType === 'aseprite' || enemy.catalog.spriteType === 'separate') && enemy.play) {
			const deathAnimKey = `${enemy.catalog.id}-death`;
			if (this.scene?.anims?.exists(deathAnimKey)) {
				try {
					enemy.play(deathAnimKey, true);
				} catch (err) {
					console.warn(`Failed to play animation ${deathAnimKey}:`, (err as Error).message);
				}
			}
		}

		// Splitters spawn children where they fell
		if (enemy.splitInto && this.scene?.player) {
			for (let i = 0; i < (enemy.splitInto.count ?? 2); i += 1) {
				const offsetX = Phaser.Math.Between(-30, 30);
				const offsetY = Phaser.Math.Between(-30, 30);
				this.spawnEnemy(this.scene, this.scene.player, enemy.splitInto.id, {
					x: enemy.x + offsetX,
					y: enemy.y + offsetY,
				});
			}
		}

		const isBig = Boolean(enemy.catalog?.isElite || enemy.catalog?.isBoss || enemy.catalog?.isMiniboss);
		this.playDeathEffect(enemy.x, enemy.y, isBig ? 3 : 1);

		if (isBig) {
			this.scene?.cameras?.main?.shake(300, 0.008);
			this.scene?.visualEffects?.hitStop(140);
			this.scene?.soundSystem?.play('bigkill');
		} else {
			this.scene?.cameras?.main?.shake(60, 0.0015);
			this.scene?.soundSystem?.play('kill');
		}

		this.scene?.events?.emit(GameEvents.ENEMY_DIED, {
			enemy,
			x: enemy.x,
			y: enemy.y,
			amount: enemy.xpValue ?? this.xpOrbValue,
			player,
		});

		// Delay recycling slightly to allow death animation to play.
		// Guard with the spawn generation so a stale callback can't disable
		// an enemy that has already been recycled AND respawned as something else.
		const generation = enemy.spawnGeneration;
		this.scene?.time?.delayedCall(300, () => {
			if (enemy.spawnGeneration === generation) {
				this.recycleEnemy(enemy);
			}
		});
	}

	playDeathEffect(x: number, y: number, sizeMultiplier = 1): void {
		if (!this.scene) {
			return;
		}

		const flash = this.scene.add.circle(x, y, 10 * sizeMultiplier, 0xffd166, 0.9);

		this.scene.tweens.add({
			targets: flash,
			scale: 2.5,
			alpha: 0,
			duration: 180 + 80 * (sizeMultiplier - 1),
			onComplete: () => {
				flash.destroy();
			},
		});
	}

	recycleEnemy(enemy: EnemySprite | null | undefined): void {
		if (!enemy) {
			return;
		}

		enemy.setVelocity(0, 0);
		enemy.disableBody?.(true, true);
		enemy.setActive(false);
		enemy.setVisible(false);
		enemy.hp = 0;
		this.scene?.visualEffects?.removeHealthBar(enemy);
	}

	increaseSpawnRate(): void {
		this.nextSpawnInterval = Math.max(this.minimumSpawnInterval, this.nextSpawnInterval - this.spawnIntervalStep);
	}

	getSpawnPosition(scene: GameScene, player: PlayerSprite): { x: number; y: number } {
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

	isAliveEnemy(enemy: EnemySprite | null | undefined): boolean {
		return Boolean(enemy && enemy.active !== false && enemy.visible !== false && !enemy.destroyed);
	}
}
