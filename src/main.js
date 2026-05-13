import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

class BootScene extends Phaser.Scene {
	constructor() {
		super('BootScene');
	}

	preload() {
		this.load.spritesheet('sword', 'assets/sword01.png', {
			frameWidth: 32,
			frameHeight: 32,
		});

		this.createPlaceholderTextures();
	}

	createPlaceholderTextures() {
		this.createCircleTexture('player', 32, 32, 16, 0x3b82f6);
		this.createCircleTexture('enemy', 28, 28, 14, 0xef4444);
		this.createBackgroundTexture('bg', 32, 32);
		this.createCircleTexture('xp_orb', 12, 12, 6, 0x22d3ee);
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
		this.scene.start('GameScene');
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
	scene: [BootScene, GameScene],
	scale: {
		mode: Phaser.Scale.RESIZE,
		autoCenter: Phaser.Scale.CENTER_BOTH,
	},
};

new Phaser.Game(gameConfig);
