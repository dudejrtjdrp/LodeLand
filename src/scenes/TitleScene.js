import Phaser from 'phaser';
import MetaProgression from '../systems/MetaProgression.js';

export default class TitleScene extends Phaser.Scene {
	constructor() {
		super('TitleScene');
	}

	create() {
		const { width, height } = this.scale;

		this.add.rectangle(width / 2, height / 2, width, height, 0x0b0f1a, 1);

		const title = this.add.text(width / 2, height * 0.3, 'moveSword', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '72px',
			color: '#fbbf24',
		}).setOrigin(0.5);
		title.setShadow(0, 6, '#000000', 10, false, true);

		this.add.text(width / 2, height * 0.3 + 60, '검이 당신을 지킨다', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '20px',
			color: '#9ca3af',
		}).setOrigin(0.5);

		const gold = MetaProgression.load().gold;
		this.add.text(width / 2, height * 0.48, `🪙 ${gold}`, {
			fontFamily: 'Arial, sans-serif',
			fontSize: '24px',
			color: '#fbbf24',
		}).setOrigin(0.5);

		const startText = this.add.text(width / 2, height * 0.62, 'SPACE — 게임 시작', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '28px',
			color: '#ffffff',
		}).setOrigin(0.5);

		this.add.text(width / 2, height * 0.62 + 48, 'U — 영구 강화', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '20px',
			color: '#a78bfa',
		}).setOrigin(0.5);

		this.tweens.add({
			targets: startText,
			alpha: 0.45,
			yoyo: true,
			repeat: -1,
			duration: 650,
		});

		this.input.keyboard.once('keydown-SPACE', () => {
			this.sound.play('click', { volume: 0.4 });
			this.scene.start('CharacterSelectScene');
		});
		this.input.keyboard.once('keydown-U', () => {
			this.sound.play('click', { volume: 0.4 });
			this.scene.start('PowerUpScene');
		});
	}
}
