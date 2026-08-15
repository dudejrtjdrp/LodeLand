import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';
import TitleScene from './scenes/TitleScene.js';
import PowerUpScene from './scenes/PowerUpScene.js';
import CharacterSelectScene from './scenes/CharacterSelectScene.js';
import SoundSystem from './systems/SoundSystem.js';
import playerCatalog from './data/playerCatalog.json';
import enemyCatalog from './data/enemyCatalog.json';

const defaultPlayer = playerCatalog[0];

class BootScene extends Phaser.Scene {
	constructor() {
		super('BootScene');
	}

	preload() {
		this.load.spritesheet('sword', 'assets/sword01.png', {
			frameWidth: 32,
			frameHeight: 32,
		});

		const queuedPlayerKeys = new Set();
		for (const player of playerCatalog) {
			for (const sheet of Object.values(player.spritesheets)) {
				if (queuedPlayerKeys.has(sheet.textureKey)) {
					continue;
				}
				queuedPlayerKeys.add(sheet.textureKey);
				this.load.spritesheet(sheet.textureKey, sheet.filePath, {
					frameWidth: sheet.frameWidth,
					frameHeight: sheet.frameHeight,
				});
			}
		}

		// Load enemy spritesheets (variants may share one sheet - load each key once)
		const queuedSheetKeys = new Set();
		for (const enemy of enemyCatalog) {
			if (enemy.spriteType === 'aseprite') {
				if (queuedSheetKeys.has(enemy.spritesheet.textureKey)) {
					continue;
				}
				queuedSheetKeys.add(enemy.spritesheet.textureKey);
				this.load.spritesheet(enemy.spritesheet.textureKey, enemy.spritesheet.filePath, {
					frameWidth: enemy.spritesheet.frameWidth,
					frameHeight: enemy.spritesheet.frameHeight,
				});
			} else if (enemy.spriteType === 'separate') {
				for (const sheet of Object.values(enemy.spritesheets)) {
					this.load.spritesheet(sheet.textureKey, sheet.filePath, {
						frameWidth: sheet.frameWidth,
						frameHeight: sheet.frameHeight,
					});
				}
			}
		}

		this.load.image('mapTileset', 'map/mapTileset.png');

		for (const key of SoundSystem.keys()) {
			this.load.audio(key, `sfx/${key}.wav`);
		}

		this.createPlaceholderTextures();
	}

	createPlaceholderTextures() {
		if (!this.textures.exists('enemy')) {
			this.createCircleTexture('enemy', 28, 28, 14, 0xef4444);
		}
		if (!this.textures.exists('bg')) {
			this.createBackgroundTexture('bg', 32, 32);
		}
		if (!this.textures.exists('xp_orb')) {
			this.createCircleTexture('xp_orb', 14, 14, 7, 0xfbbf24);
		}
		if (!this.textures.exists('enemy_bullet')) {
			this.createCircleTexture('enemy_bullet', 12, 12, 5, 0xff5555);
		}
	}

	createPlayerAnimations() {
		for (const player of playerCatalog) {
			for (const [animationName, sheet] of Object.entries(player.spritesheets)) {
				const animationKey = player.animations?.[animationName] ?? `${player.id}-${animationName}`;

				if (this.anims.exists(animationKey)) {
					continue;
				}

				this.anims.create({
					key: animationKey,
					frames: this.anims.generateFrameNumbers(sheet.textureKey, {
						start: sheet.frameStart,
						end: sheet.frameEnd,
					}),
					frameRate: sheet.frameRate,
					repeat: sheet.repeat,
				});
			}
		}

		if (!this.anims.exists('player-idle')) {
			this.anims.create({
				key: 'player-idle',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.idle.textureKey, {
					start: defaultPlayer.spritesheets.idle.frameStart,
					end: defaultPlayer.spritesheets.idle.frameEnd,
				}),
				frameRate: 8,
				repeat: -1,
			});
		}

		if (!this.anims.exists('player-hurt')) {
			this.anims.create({
				key: 'player-hurt',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.hurt.textureKey, {
					start: defaultPlayer.spritesheets.hurt.frameStart,
					end: defaultPlayer.spritesheets.hurt.frameEnd,
				}),
				frameRate: 10,
				repeat: 0,
			});
		}

		if (!this.anims.exists('player-death')) {
			this.anims.create({
				key: 'player-death',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.death.textureKey, {
					start: defaultPlayer.spritesheets.death.frameStart,
					end: defaultPlayer.spritesheets.death.frameEnd,
				}),
				frameRate: 10,
				repeat: 0,
			});
		}
	}

	createEnemyAnimations() {
		for (const enemy of enemyCatalog) {
			if (enemy.spriteType === 'aseprite') {
				// Aseprite type: row-based animations from single spritesheet
				const { frameWidth, frameHeight, animations: animDefs } = enemy.spritesheet;
				const textureKey = enemy.spritesheet.textureKey;
				
				// Get texture to calculate frames per row
				const texture = this.textures.get(textureKey);
				if (!texture) {
					console.warn(`Texture not found: ${textureKey}`);
					continue;
				}

				const framesPerRow = Math.floor(texture.width / frameWidth);
				console.log(`Aseprite ${enemy.id}: texture ${texture.width}×${texture.height}, frameWidth=${frameWidth}, framesPerRow=${framesPerRow}`);

				for (const animDef of animDefs) {
					const animationKey = `${enemy.id}-${animDef.name}`;
					if (this.anims.exists(animationKey)) {
						continue;
					}

					// Calculate frame indices based on row
					const rowStartFrame = animDef.row * framesPerRow;
					const frameStart = rowStartFrame + animDef.frameStart;
					const frameEnd = frameStart + animDef.frameCount - 1;

					console.log(`Creating animation: ${animationKey} (row ${animDef.row}, frames ${frameStart}-${frameEnd}, count ${animDef.frameCount})`);

					try {
						this.anims.create({
							key: animationKey,
							frames: this.anims.generateFrameNumbers(textureKey, {
								start: frameStart,
								end: frameEnd,
							}),
							frameRate: animDef.frameRate,
							repeat: animDef.repeat,
						});
						console.log(`✓ Animation created: ${animationKey}`);
					} catch (err) {
						console.warn(`✗ Failed to create animation ${animationKey}:`, err.message);
					}
				}
			} else if (enemy.spriteType === 'separate') {
				// Separate type: different file per animation
				for (const [animationName, sheet] of Object.entries(enemy.spritesheets)) {
					const animationKey = `${enemy.id}-${animationName}`;
					if (this.anims.exists(animationKey)) continue;

					const frameEnd = sheet.frameEnd !== undefined ? sheet.frameEnd : sheet.frameStart + sheet.frameCount - 1;

					this.anims.create({
						key: animationKey,
						frames: this.anims.generateFrameNumbers(sheet.textureKey, {
							start: sheet.frameStart,
							end: frameEnd,
						}),
						frameRate: sheet.frameRate,
						repeat: sheet.repeat,
					});
				}
			}
		}
	}

	createCircleTexture(key, width, height, radius, color) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false });
		graphics.fillStyle(color, 1);
		graphics.fillCircle(width / 2, height / 2, radius);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	createRectangleTexture(key, width, height, color) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false });
		graphics.fillStyle(color, 1);
		graphics.fillRect(0, 0, width, height);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	createBackgroundTexture(key, width, height) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false });
		graphics.fillStyle(0x1f1f1f, 1);
		graphics.fillRect(0, 0, width, height);

		graphics.lineStyle(1, 0x2f2f2f, 0.8);
		graphics.lineBetween(0, 0, width, 0);
		graphics.lineBetween(0, 0, 0, height);
		graphics.lineBetween(width - 1, 0, width - 1, height);
		graphics.lineBetween(0, height - 1, width, height - 1);
		graphics.lineBetween(0, height / 2, width, height / 2);
		graphics.lineBetween(width / 2, 0, width / 2, height);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	create() {
		this.createPlaceholderTextures();
		this.createPlayerAnimations();
		this.createEnemyAnimations();
		this.scene.start('TitleScene');
	}
}

const gameConfig = {
	type: Phaser.AUTO,
	parent: 'game',
	width: window.innerWidth,
	height: window.innerHeight,
	physics: {
		default: 'arcade',
		arcade: {
			gravity: { y: 0 },
			debug: false,
		},
	},
	scene: [BootScene, TitleScene, CharacterSelectScene, GameScene, PowerUpScene],
	scale: {
		mode: Phaser.Scale.RESIZE,
		autoCenter: Phaser.Scale.CENTER_BOTH,
	},
};

new Phaser.Game(gameConfig);
