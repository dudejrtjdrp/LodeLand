import Phaser from 'phaser';
import EnemyManager from '../systems/EnemyManager';
import ProgressionSystem from '../systems/ProgressionSystem';
import SwordOrbitSystem from '../systems/sword/SwordOrbitSystem';
import VisualEffectsSystem from '../systems/VisualEffectsSystem';
import LevelUpSystem from '../systems/LevelUpSystem';
import WaveSystem from '../systems/WaveSystem';
import PickupSystem from '../systems/PickupSystem';
import MetaProgression from '../systems/MetaProgression';
import type { MetaBonuses } from '../systems/MetaProgression';
import SoundSystem from '../systems/SoundSystem';
import ShopSystem from '../systems/shop/ShopSystem';
import swordCatalogJson from '../data/swordCatalog.json';
import playerCatalogJson from '../data/playerCatalog.json';
import enemyCatalogJson from '../data/enemyCatalog.json';
import { GameEvents } from '../core/events';
import { mitigatePlayerDamage } from '../logic/combat';
import type {
  DamageType,
  EnemyDefinition,
  PlayerDefinition,
  PlayerTraits,
  SwordDefinition,
} from '../types/catalogs';
import type { EnemyProjectile, EnemySprite, PlayerSprite } from '../types/actors';

const swordCatalog = swordCatalogJson as unknown as SwordDefinition[];
const playerCatalog = playerCatalogJson as unknown as PlayerDefinition[];
const enemyCatalog = enemyCatalogJson as unknown as EnemyDefinition[];

const defaultPlayer = playerCatalog[0];

const DANGER_LEVELS = [
  { hpMult: 1.0, damageMult: 1.0, goldMult: 1.0 },
  { hpMult: 1.3, damageMult: 1.3, goldMult: 1.25 },
  { hpMult: 1.6, damageMult: 1.6, goldMult: 1.5 },
];

/** A pooled ground chunk: one tilemap and its painted layer. */
interface ChunkTile {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.Tilemaps.TilemapLayer;
}

/** A chunk build request queued for the per-frame budgeted builder. */
interface ChunkMeta {
  x: number;
  y: number;
  key: string;
}

/** Data passed into the scene via scene.start / scene.restart. */
interface GameSceneData {
  characterId?: string;
  danger?: number;
}

type PhysicsCallbackObject =
  | Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile;

export default class GameScene extends Phaser.Scene {
  tileSize: number;
  chunkTiles: number;
  chunkPixelSize: number;
  chunkLoadRadius: number;
  loadedChunks: Map<string, ChunkTile>;
  chunkPool: ChunkTile[];
  maxPoolSize: number;
  chunkBuildQueue: ChunkMeta[];
  pendingChunkKeys: Set<string>;
  chunkBuildBudgetMs: number;
  playerChunkX: number | null;
  playerChunkY: number | null;

  isGameOver!: boolean;
  isPaused!: boolean;
  pauseUi!: Phaser.GameObjects.GameObject[];
  pauseMenuText?: Phaser.GameObjects.Text | null;
  soundSystem!: SoundSystem;
  metaBonuses!: MetaBonuses;
  revivalsLeft!: number;
  characterId!: string;
  dangerLevel!: number;
  dangerConfig!: (typeof DANGER_LEVELS)[number];
  playerConfig!: PlayerDefinition;
  traits!: PlayerTraits;
  player!: PlayerSprite;
  swordOrbit!: SwordOrbitSystem;
  visualEffects!: VisualEffectsSystem;
  enemyManager!: EnemyManager;
  progression!: ProgressionSystem;
  levelUpSystem!: LevelUpSystem;
  waveSystem!: WaveSystem;
  pickupSystem!: PickupSystem;
  shopSystem!: ShopSystem;
  enemyHitOverlap!: Phaser.Physics.Arcade.Collider;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('GameScene');

    this.tileSize = 16;
    this.chunkTiles = 32;
    this.chunkPixelSize = this.tileSize * this.chunkTiles;
    this.chunkLoadRadius = 2;
    this.loadedChunks = new Map();
    this.chunkPool = [];
    this.maxPoolSize = 64;
    this.chunkBuildQueue = [];
    this.pendingChunkKeys = new Set();
    this.chunkBuildBudgetMs = 1.8;
    this.playerChunkX = null;
    this.playerChunkY = null;
  }

  create() {
    const { width, height } = this.scale;

    // Recover cleanly from a restart (previous run may have left physics paused).
    if (this.physics.world.isPaused) {
      this.physics.resume();
    }
    this.isGameOver = false;
    this.isPaused = false;
    this.pauseUi = [];
    this.soundSystem = new SoundSystem(this);

    this.createInitialChunks(width, height);
    this.updateChunksAroundPlayer(width / 2, height / 2, true);
    this.processChunkQueue(6);

    this.metaBonuses = MetaProgression.getBonuses();
    this.revivalsLeft = this.metaBonuses.revival ?? 0;

    const sceneData = (this.scene.settings.data ?? {}) as GameSceneData;
    this.characterId = sceneData.characterId ?? defaultPlayer.id;
    this.dangerLevel = Phaser.Math.Clamp(sceneData.danger ?? 0, 0, DANGER_LEVELS.length - 1);
    this.dangerConfig = DANGER_LEVELS[this.dangerLevel];

    this.playerConfig = playerCatalog.find((entry) => entry.id === this.characterId) ?? defaultPlayer;
    this.traits = this.playerConfig.traits ?? {};
    this.player = this.physics.add.sprite(width / 2, height / 2, this.playerConfig.spritesheets.idle.textureKey, this.playerConfig.spritesheets.idle.frameStart) as PlayerSprite;
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(10);
    this.player.setDisplaySize(this.playerConfig.displaySize.width, this.playerConfig.displaySize.height);
    this.applyPlayerHitbox(this.player, this.playerConfig);
    this.player.setDrag(900, 900);
    this.player.maxHp = Math.round((this.playerConfig.stats.maxHp + (this.metaBonuses.maxHpFlat ?? 0)) * (this.traits.hpMult ?? 1));
    this.player.hp = this.player.maxHp;
    this.player.attackDamage = this.playerConfig.stats.damage;
    this.player.defense = this.playerConfig.stats.defense;
    this.player.moveSpeed = Math.round(this.playerConfig.stats.moveSpeed * (1 + (this.metaBonuses.moveSpeedMult ?? 0)));
    this.player.critChance = this.playerConfig.stats.critChance ?? 0;
    this.player.critDamageMultiplier = this.playerConfig.stats.critDamageMultiplier ?? 1.0;
    this.player.luck = (this.playerConfig.stats.luck ?? 0) + (this.metaBonuses.luck ?? 0) + (this.traits.luckBonus ?? 0);
    this.player.dodgeChance = 0;
    this.player.hpRegen = 0;
    this.player.killHeal = 0;
    this.player.thorns = 0;
    this.player.physicalResist = 0;
    this.player.magicResist = 0;

    if (this.playerConfig.tint) {
      this.player.setTint(Phaser.Display.Color.HexStringToColor(this.playerConfig.tint).color);
    }
    this.player.isDead = false;
    this.player.isHurting = false;
    this.player.isKnockedBack = false;
    this.player.invulnerableUntil = 0;
    this.player.knockbackUntil = 0;

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.swordOrbit = new SwordOrbitSystem(this, {
      swordCatalog,
      damageMultiplier: (1 + (this.metaBonuses.damageMult ?? 0)) * (this.traits.damageMult ?? 1),
      cooldownMultiplier: (1 - (this.metaBonuses.cooldownRed ?? 0)) * (this.traits.cooldownMult ?? 1),
      maxSwords: this.traits.maxSwords ?? 8,
      noLaunch: this.traits.noLaunch ?? false,
      orbitDamageMult: this.traits.orbitDamageMult ?? 1,
    });
    this.swordOrbit.radius *= this.traits.orbitRadiusMult ?? 1;
    this.visualEffects = new VisualEffectsSystem(this);
    this.enemyManager = new EnemyManager(this, {
      enemyCatalog,
      hpMult: this.dangerConfig.hpMult,
      damageMult: this.dangerConfig.damageMult,
    });
    this.progression = new ProgressionSystem(this, this.swordOrbit);
    this.progression.attachPlayer(this.player);
    this.progression.magnetRadius *= 1 + (this.metaBonuses.magnetMult ?? 0);
    this.swordOrbit.addSword(this);

    for (let i = 0; i < (this.metaBonuses.extraSword ?? 0); i += 1) {
      this.swordOrbit.addSword(this);
    }

    this.levelUpSystem = new LevelUpSystem(this, {
      swordOrbit: this.swordOrbit,
      progression: this.progression,
      swordCatalog,
    });
    this.events.on(GameEvents.LEVEL_UP, () => {
      if (!this.player?.isDead) {
        this.levelUpSystem.enqueue();
      }
    });

    this.waveSystem = new WaveSystem(this, { enemyManager: this.enemyManager });
    this.pickupSystem = new PickupSystem(this, {
      progression: this.progression,
      levelUpSystem: this.levelUpSystem,
      enemyManager: this.enemyManager,
      goldMult: (this.traits.goldMult ?? 1) * this.dangerConfig.goldMult,
    });

    this.shopSystem = new ShopSystem(this, {
      swordOrbit: this.swordOrbit,
      pickupSystem: this.pickupSystem,
      progression: this.progression,
    });

    // Enemy projectiles hurt the player
    this.physics.add.overlap(this.player, this.enemyManager.projectiles, (playerObj, bulletObj) => {
      const bullet = bulletObj as EnemyProjectile;
      if (!bullet.active) {
        return;
      }
      this.applyPlayerDamage(bullet.damage ?? 12, bullet.x, bullet.y, 'magic');
      this.enemyManager.recycleProjectile(bullet);
    });

    // Lifesteal: heal on every kill
    this.events.on(GameEvents.ENEMY_DIED, () => {
      if (!this.player.isDead && (this.player.killHeal ?? 0) > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.killHeal);
      }
    });

    if (this.dangerLevel > 0) {
      const dangerText = this.add.text(this.scale.width / 2, 92, `💀 난이도 ${this.dangerLevel}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#f87171',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);
      dangerText.setShadow(0, 2, '#000000', 2, false, true);
    }

    // Scene restarts reuse the same event emitter: drop this run's listeners on shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(GameEvents.ENEMY_DIED);
      this.events.off(GameEvents.LEVEL_UP);
      this.events.off(GameEvents.UPGRADE_CHOSEN);
      this.events.off(GameEvents.SWORD_FUSED);
      this.waveSystem?.destroy();
      this.pickupSystem?.destroy();
    });

    if (this.visualEffects) {
      this.visualEffects.updateHealthBar(this.player, this.player.maxHp, this.player.hp, 50, 8);
    }

    this.enemyHitOverlap = this.physics.add.overlap(
      this.player,
      this.enemyManager.enemies,
      this.handlePlayerEnemyOverlap,
      undefined,
      this,
    );

    this.player.anims.play(this.playerConfig.animations.idle);
    this.player.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handlePlayerAnimationComplete, this);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    this.input.keyboard!.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard!.on('keydown-M', () => {
      this.soundSystem.toggleMute();
      this.refreshPauseUi();
    });
    this.input.keyboard!.on('keydown-R', () => {
      if (this.isPaused) {
        this.scene.restart({ characterId: this.characterId, danger: this.dangerLevel });
      }
    });
    this.input.keyboard!.on('keydown-T', () => {
      if (this.isPaused) {
        this.scene.start('TitleScene');
      }
    });

    this.scale.on('resize', this.handleResize, this);

    if (import.meta.env.DEV) {
      window.__gameScene = this; // dev-only debug hook (stripped from production builds)
    }
  }

  applyPlayerHitbox(player: PlayerSprite, playerConfig: PlayerDefinition) {
    const hitbox = playerConfig?.hitbox;

    if (!player || !hitbox) {
      return;
    }

    if (hitbox.shape === 'circle') {
      player.setCircle?.(hitbox.radius!, hitbox.offsetX, hitbox.offsetY);
      return;
    }

    if (hitbox.shape === 'box') {
      player.setSize(hitbox.width!, hitbox.height!);
      player.setOffset(hitbox.offsetX ?? 0, hitbox.offsetY ?? 0);
    }
  }

  createInitialChunks(viewportWidth: number, viewportHeight: number) {
    const visibleChunksX = Math.ceil(viewportWidth / this.chunkPixelSize);
    const visibleChunksY = Math.ceil(viewportHeight / this.chunkPixelSize);
    const minRadius = Math.ceil(Math.max(visibleChunksX, visibleChunksY) / 2) + 1;

    this.chunkLoadRadius = Math.max(2, minRadius);
  }

  handleResize(gameSize: Phaser.Structs.Size) {
    const { width, height } = gameSize;

    if (this.player) {
      this.createInitialChunks(width, height);
      this.updateChunksAroundPlayer(this.player.x, this.player.y, true);
    }
  }

  updateChunksAroundPlayer(playerX: number, playerY: number, forceUpdate = false) {
    const currentChunkX = Math.floor(playerX / this.chunkPixelSize);
    const currentChunkY = Math.floor(playerY / this.chunkPixelSize);

    if (!forceUpdate && currentChunkX === this.playerChunkX && currentChunkY === this.playerChunkY) {
      return;
    }

    this.playerChunkX = currentChunkX;
    this.playerChunkY = currentChunkY;

    const requiredKeys = new Set<string>();

    const missingChunks: ChunkMeta[] = [];

    for (let y = currentChunkY - this.chunkLoadRadius; y <= currentChunkY + this.chunkLoadRadius; y += 1) {
      for (let x = currentChunkX - this.chunkLoadRadius; x <= currentChunkX + this.chunkLoadRadius; x += 1) {
        const key = `${x},${y}`;
        requiredKeys.add(key);

        if (!this.loadedChunks.has(key) && !this.pendingChunkKeys.has(key)) {
          missingChunks.push({ x, y, key });
        }
      }
    }

    missingChunks.sort((a, b) => {
      const distA = Math.abs(a.x - currentChunkX) + Math.abs(a.y - currentChunkY);
      const distB = Math.abs(b.x - currentChunkX) + Math.abs(b.y - currentChunkY);
      return distA - distB;
    });

    for (const chunkMeta of missingChunks) {
      this.chunkBuildQueue.push(chunkMeta);
      this.pendingChunkKeys.add(chunkMeta.key);
    }

    this.unloadFarChunks(requiredKeys);
  }

  processChunkQueue(forcedBudgetMs = this.chunkBuildBudgetMs) {
    if (this.chunkBuildQueue.length === 0) {
      return;
    }

    const startedAt = performance.now();

    while (this.chunkBuildQueue.length > 0) {
      const nextChunk = this.chunkBuildQueue.shift();

      if (!nextChunk) {
        break;
      }

      this.pendingChunkKeys.delete(nextChunk.key);

      if (this.loadedChunks.has(nextChunk.key)) {
        continue;
      }

      const chunk = this.acquireChunk(nextChunk.x, nextChunk.y);
      this.paintChunk(chunk, nextChunk.x, nextChunk.y);
      this.loadedChunks.set(nextChunk.key, chunk as ChunkTile);

      if (performance.now() - startedAt >= forcedBudgetMs) {
        break;
      }
    }
  }

  acquireChunk(chunkX: number, chunkY: number): ChunkTile | null {
    const pooledChunk = this.chunkPool.pop();

    if (pooledChunk) {
      pooledChunk.layer.setPosition(chunkX * this.chunkPixelSize, chunkY * this.chunkPixelSize);
      pooledChunk.layer.setVisible(true);
      pooledChunk.layer.setActive(true);
      return pooledChunk;
    }

    const map = this.make.tilemap({
      tileWidth: this.tileSize,
      tileHeight: this.tileSize,
      width: this.chunkTiles,
      height: this.chunkTiles,
    });

    const tileset = map.addTilesetImage('dungeon', 'mapTileset', this.tileSize, this.tileSize, 0, 0);

    if (!tileset) {
      return null;
    }

    const layer = map.createBlankLayer('ground', tileset, chunkX * this.chunkPixelSize, chunkY * this.chunkPixelSize)!;
    layer.setDepth(-5);

    return { map, layer };
  }

  paintChunk(chunk: ChunkTile | null, chunkX: number, chunkY: number) {
    if (!chunk) {
      return;
    }

    const { layer } = chunk;
    layer.fill(98, 0, 0, this.chunkTiles, this.chunkTiles);

    // Floor tile variants with index based on tileset position
    const baseFloorIndex = 98; // floor_plain at (32,48)
    const floorVariants = [
      64, 65, 66, 67,   // floor_stain_1, 2, 3, goo at y=32
      160, 161, 162, 163, 164, 165  // floor_gargoyle variants at y=80
    ];

    for (let localY = 0; localY < this.chunkTiles; localY += 1) {
      for (let localX = 0; localX < this.chunkTiles; localX += 1) {
        const worldTileX = chunkX * this.chunkTiles + localX;
        const worldTileY = chunkY * this.chunkTiles + localY;
        const noise = this.tileNoise(worldTileX, worldTileY);

        let tileIndex = baseFloorIndex;

        // Mix floor variants based on noise
        if (noise > 0.85) {
          tileIndex = floorVariants[Math.floor(noise * 10) % floorVariants.length];
        } else if (noise > 0.7) {
          tileIndex = floorVariants[Math.floor(noise * 5) % floorVariants.length];
        } else if (noise < 0.15) {
          tileIndex = floorVariants[Math.floor(noise * 20) % floorVariants.length];
        }

        if (tileIndex !== baseFloorIndex) {
          layer.putTileAt(tileIndex, localX, localY);
        }
      }
    }
  }

  unloadFarChunks(requiredKeys: Set<string>) {
    for (const [key, chunk] of this.loadedChunks.entries()) {
      if (!requiredKeys.has(key)) {
        chunk.layer.setVisible(false);
        chunk.layer.setActive(false);

        if (this.chunkPool.length < this.maxPoolSize) {
          this.chunkPool.push(chunk);
        } else {
          chunk.layer.destroy();
          chunk.map.destroy();
        }

        this.loadedChunks.delete(key);
      }
    }

    if (requiredKeys.size > 0) {
      this.chunkBuildQueue = this.chunkBuildQueue.filter((queued) => requiredKeys.has(queued.key));
      this.pendingChunkKeys = new Set(this.chunkBuildQueue.map((queued) => queued.key));
    }
  }

  tileNoise(x: number, y: number): number {
    const seed = (x * 374761393 + y * 668265263) ^ 0x27d4eb2d;
    const hashed = (seed ^ (seed >>> 13)) * 1274126177;
    return ((hashed ^ (hashed >>> 16)) >>> 0) / 4294967295;
  }

  update(time: number, delta: number) {
    if (this.player?.isDead) {
      this.player.setVelocity(0, 0);
      return;
    }

    if (this.levelUpSystem?.isOpen || this.isPaused || this.shopSystem?.isOpen) {
      return;
    }

    // Passive regen
    if ((this.player.hpRegen ?? 0) > 0 && this.player.hp < this.player.maxHp) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.hpRegen * delta) / 1000);
    }

    const speed = this.player?.moveSpeed ?? this.playerConfig?.stats?.moveSpeed ?? 150;
    const velocityX = this.getHorizontalInput() * speed;
    const velocityY = this.getVerticalInput() * speed;

    if (time >= this.player.knockbackUntil) {
      this.player.isKnockedBack = false;
      this.player.setVelocity(velocityX, velocityY);
    }

    this.updatePlayerFacing(velocityX);
    this.updatePlayerAnimation(velocityX, velocityY, time);
    this.updateChunksAroundPlayer(this.player.x, this.player.y);
    this.processChunkQueue();

    this.enemyManager.update(this.player, delta);
    this.swordOrbit.update(this.player, delta, this.enemyManager.enemies);
    this.progression.update(this.player, delta);
    this.waveSystem.update(delta);
    this.pickupSystem.update();

    if (this.visualEffects && this.player && this.player.active && this.player.visible) {
      this.visualEffects.updateHealthBar(this.player, this.player.maxHp, Math.max(0, this.player.hp), 50, 8);
    }

    // Update health bars for all active enemies
    if (this.visualEffects && this.enemyManager.enemies) {
      for (const enemy of this.enemyManager.enemies.getChildren() as EnemySprite[]) {
        if (enemy && enemy.active && enemy.visible) {
          this.visualEffects.updateHealthBar(enemy, enemy.maxHp ?? 30, Math.max(0, enemy.hp ?? 30), enemy.healthBarWidth ?? 40);
        } else if (enemy) {
          this.visualEffects.removeHealthBar(enemy);
        }
      }
    }
  }

  updatePlayerFacing(velocityX: number) {
    if (!this.player || this.player.isDead) {
      return;
    }

    if (velocityX < 0) {
      this.player.setFlipX(true);
      return;
    }

    if (velocityX > 0) {
      this.player.setFlipX(false);
    }
  }

  updatePlayerAnimation(velocityX: number, velocityY: number, time: number) {
    if (!this.player || this.player.isDead) {
      return;
    }

    if (this.player.isHurting) {
      return;
    }

    if (velocityX !== 0 || velocityY !== 0) {
      if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== this.playerConfig.animations.idle) {
        this.player.anims.play(this.playerConfig.animations.idle, true);
      }
      return;
    }

    if (this.player.anims.currentAnim?.key !== this.playerConfig.animations.idle) {
      this.player.anims.play(this.playerConfig.animations.idle, true);
    }
  }

  handlePlayerEnemyOverlap(playerObj: PhysicsCallbackObject, enemyObj: PhysicsCallbackObject) {
    const player = playerObj as PlayerSprite;
    const enemy = enemyObj as EnemySprite;
    const damage = typeof enemy?.damage === 'number' ? enemy.damage : this.enemyManager.enemyDamage;
    const applied = this.applyPlayerDamage(damage, enemy.x, enemy.y);

    // Thorns: touching the player hurts (only when contact actually connected)
    if (applied && (player.thorns ?? 0) > 0) {
      this.enemyManager.takeDamage(enemy, player.thorns, player, { silent: true });
    }
  }

  // Central player damage pipeline: invulnerability -> dodge -> defense/typed resist -> knockback
  applyPlayerDamage(rawDamage: number, sourceX: number | null = null, sourceY: number | null = null, damageType: DamageType = 'physical'): boolean {
    const player = this.player;

    if (!player || player.isDead) {
      return false;
    }

    const now = this.time.now;
    if (now < player.invulnerableUntil) {
      return false;
    }

    // Dodge (회피)
    if ((player.dodgeChance ?? 0) > 0 && Math.random() < player.dodgeChance) {
      const missText = this.add.text(player.x, player.y - 60, 'MISS', {
        font: 'bold 18px Arial',
        fill: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
      } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setDepth(100);
      this.tweens.add({ targets: missText, y: missText.y - 40, alpha: 0, duration: 600, onComplete: () => missText.destroy() });
      player.invulnerableUntil = now + 300;
      return false;
    }

    // Defense (방어력, % 감소, 최대 60%) + 타입별 저항 (최대 50%)
    const damage = mitigatePlayerDamage(rawDamage, player.defense ?? 0, player.physicalResist ?? 0, player.magicResist ?? 0, damageType);

    player.hp = Math.max(0, (player.hp ?? player.maxHp ?? 100) - damage);

    if (this.visualEffects) {
      this.visualEffects.showDamageText(player.x, player.y - 50, damage, false);
      this.visualEffects.updateHealthBar(player, player.maxHp, Math.max(0, player.hp), 50, 8);
    }

    this.soundSystem?.play('hurt');
    player.invulnerableUntil = now + 850;
    player.isHurting = true;
    player.isKnockedBack = true;
    player.knockbackUntil = now + 180;

    if (sourceX !== null && sourceY !== null) {
      const knockbackAngle = Phaser.Math.Angle.Between(sourceX, sourceY, player.x, player.y);
      const knockbackSpeed = 260;
      const knockbackX = Math.cos(knockbackAngle) * knockbackSpeed;
      const knockbackY = Math.sin(knockbackAngle) * knockbackSpeed;

      player.setVelocity(knockbackX, knockbackY);
      player.setFlipX(knockbackX < 0);
    }

    player.anims.play(this.playerConfig.animations.hurt, true);

    if (player.hp <= 0) {
      this.killPlayer();
    }

    return true;
  }

  killPlayer() {
    if (!this.player || this.player.isDead) {
      return;
    }

    // Revival (permanent upgrade): come back at 50% HP with a shockwave
    if (this.revivalsLeft > 0) {
      this.revivalsLeft -= 1;
      this.player.hp = Math.round(this.player.maxHp * 0.5);
      this.player.invulnerableUntil = this.time.now + 2500;
      this.player.isHurting = false;

      this.cameras.main.flash(600, 255, 255, 255);
      this.soundSystem?.play('revive');
      this.waveSystem?.announce?.('✨ 부활!', '#4ade80');

      for (const enemy of this.enemyManager.enemies.getChildren() as EnemySprite[]) {
        if (!this.enemyManager.isAliveEnemy(enemy) || enemy.catalog?.isReaper) {
          continue;
        }
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 350) {
          this.enemyManager.takeDamage(enemy, 500, this.player);
        }
      }

      return;
    }

    this.player.isDead = true;
    this.player.isHurting = false;
    this.player.isKnockedBack = false;
    this.player.setVelocity(0, 0);
    (this.player.body as Phaser.Physics.Arcade.Body | null)?.setEnable(false);
    this.player.anims.play(this.playerConfig.animations.death, true);

    this.visualEffects?.removeHealthBar(this.player);

    this.cameras.main.shake(400, 0.01);
    this.soundSystem?.play('gameover');
    this.physics.pause();

    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, (animation: Phaser.Animations.Animation) => {
      if (animation.key !== this.playerConfig.animations.death) {
        return;
      }

      this.player.setVelocity(0, 0);
      this.showGameOver();
    });

    // Fallback in case the death animation never completes.
    this.time.delayedCall(1500, () => this.showGameOver());
  }

  togglePause() {
    if (this.levelUpSystem?.isOpen || this.isGameOver || this.player?.isDead || this.shopSystem?.isOpen) {
      return;
    }

    this.isPaused = !this.isPaused;
    this.soundSystem?.play('click');

    if (this.isPaused) {
      this.physics.pause();
      this.buildPauseUi();
    } else {
      this.destroyPauseUi();
      this.physics.resume();
    }
  }

  buildPauseUi() {
    const { width, height } = this.scale;

    const dim = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(2500);

    const title = this.add.text(width / 2, height / 2 - 90, '일시정지', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '44px',
      color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    title.setShadow(0, 4, '#000000', 6, false, true);

    this.pauseMenuText = this.add.text(width / 2, height / 2 + 30, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '22px',
      color: '#e5e7eb',
      align: 'center',
      lineSpacing: 14,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);

    this.pauseUi = [dim, title, this.pauseMenuText];
    this.refreshPauseUi();
  }

  refreshPauseUi() {
    if (!this.isPaused || !this.pauseMenuText) {
      return;
    }

    const muteLabel = this.soundSystem?.isMuted() ? '🔇 음소거 해제' : '🔊 음소거';
    this.pauseMenuText.setText([
      'ESC — 계속하기',
      'R — 다시 시작',
      'T — 타이틀로',
      `M — ${muteLabel}`,
    ].join('\n'));
  }

  destroyPauseUi() {
    for (const object of this.pauseUi) {
      object.destroy();
    }
    this.pauseUi = [];
    this.pauseMenuText = null;
  }

  showGameOver() {
    if (this.isGameOver) {
      return;
    }

    this.isGameOver = true;
    this.physics.pause();
    this.levelUpSystem?.destroyUi?.();
    if (this.shopSystem?.isOpen) {
      this.shopSystem.destroyUi();
      this.shopSystem.isOpen = false;
    }

    const { width, height } = this.scale;
    const results = (this.waveSystem?.getResults?.() ?? { survivedMs: 0, killCount: 0, completed: false }) as {
      survivedMs: number;
      killCount: number;
      completed: boolean;
      round?: number;
    };
    const totalSeconds = Math.floor(results.survivedMs / 1000);
    const timeLabel = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;

    // Bank the run's gold - failure still pays (the genre's core promise)
    const earnedGold = this.pickupSystem?.runGold ?? 0;
    const totalGold = MetaProgression.addGold(earnedGold);

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(3000);

    const title = results.completed ? '🏆 승리!' : '게임 오버';
    const titleColor = results.completed ? '#4ade80' : '#ef4444';

    const titleText = this.add.text(width / 2, height / 2 - 110, title, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '56px',
      color: titleColor,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
    titleText.setShadow(0, 4, '#000000', 8, false, true);

    this.add.text(width / 2, height / 2 - 5, [
      `도달 라운드  ROUND ${results.round ?? 1}`,
      `생존 시간   ${timeLabel}`,
      `레벨        Lv. ${this.progression?.level ?? 1}`,
      `처치        ${results.killCount}`,
      `획득 골드   🪙 ${earnedGold}  (보유 ${totalGold})`,
    ].join('\n'), {
      fontFamily: 'Arial, sans-serif',
      fontSize: '24px',
      color: '#e5e7eb',
      align: 'center',
      lineSpacing: 12,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);

    const restartText = this.add.text(width / 2, height / 2 + 135, 'R — 다시 시작    T — 타이틀 (영구 강화)', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '20px',
      color: '#fbbf24',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);

    this.tweens.add({
      targets: restartText,
      alpha: 0.4,
      yoyo: true,
      repeat: -1,
      duration: 600,
    });

    this.input.keyboard!.once('keydown-R', () => {
      this.scene.restart({ characterId: this.characterId, danger: this.dangerLevel });
    });
    this.input.keyboard!.once('keydown-T', () => {
      this.scene.start('TitleScene');
    });
  }

  handlePlayerAnimationComplete(animation: Phaser.Animations.Animation) {
    if (!this.player || this.player.isDead || !animation) {
      return;
    }

    if (animation.key === this.playerConfig.animations.hurt) {
      this.player.isHurting = false;
      this.player.anims.play(this.playerConfig.animations.idle, true);
    }
  }

  getHorizontalInput(): number {
    let direction = 0;

    if (this.cursors.left.isDown || this.keys.A.isDown) {
      direction -= 1;
    }

    if (this.cursors.right.isDown || this.keys.D.isDown) {
      direction += 1;
    }

    return direction;
  }

  getVerticalInput(): number {
    let direction = 0;

    if (this.cursors.up.isDown || this.keys.W.isDown) {
      direction -= 1;
    }

    if (this.cursors.down.isDown || this.keys.S.isDown) {
      direction += 1;
    }

    return direction;
  }
}
