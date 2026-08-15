import Phaser from 'phaser';
import playerCatalogRaw from '../data/playerCatalog.json';
import MetaProgression from '../systems/MetaProgression';
import type { PlayerDefinition } from '../types/catalogs';

const playerCatalog = playerCatalogRaw as unknown as PlayerDefinition[];

const MAX_DANGER = 2;

interface CharacterCard {
	character: PlayerDefinition;
	background: Phaser.GameObjects.Rectangle;
	statusText: Phaser.GameObjects.Text;
}

export default class CharacterSelectScene extends Phaser.Scene {
	selectedId!: string;
	danger!: number;
	goldText!: Phaser.GameObjects.Text;
	dangerText!: Phaser.GameObjects.Text;
	cards!: CharacterCard[];

	constructor() {
		super('CharacterSelectScene');
	}

	create() {
		const { width, height } = this.scale;

		this.selectedId = playerCatalog[0].id;
		this.danger = 0;

		this.add.rectangle(width / 2, height / 2, width, height, 0x0b0f1a, 1);

		this.add.text(width / 2, 44, '캐릭터 선택', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '36px',
			color: '#fbbf24',
		}).setOrigin(0.5).setShadow(0, 4, '#000000', 6, false, true);

		this.goldText = this.add.text(width / 2, 88, '', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '20px',
			color: '#fbbf24',
		}).setOrigin(0.5);

		this.cards = [];
		this.buildCards();

		// Danger selector
		this.dangerText = this.add.text(width / 2, height - 130, '', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '22px',
			color: '#f87171',
		}).setOrigin(0.5).setInteractive({ useHandCursor: true });
		this.dangerText.on('pointerdown', () => this.cycleDanger());

		this.add.text(width / 2, height - 100, '(클릭 또는 ←/→ 키로 난이도 변경 · 이전 난이도 클리어 시 해금)', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '14px',
			color: '#6b7280',
		}).setOrigin(0.5);

		const startText = this.add.text(width / 2, height - 52, 'SPACE — 출격', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '26px',
			color: '#ffffff',
		}).setOrigin(0.5);
		this.tweens.add({ targets: startText, alpha: 0.45, yoyo: true, repeat: -1, duration: 650 });

		this.input.keyboard!.on('keydown-SPACE', () => this.startRun());
		this.input.keyboard!.on('keydown-LEFT', () => this.cycleDanger(-1));
		this.input.keyboard!.on('keydown-RIGHT', () => this.cycleDanger(1));
		this.input.keyboard!.on('keydown-ESC', () => this.scene.start('TitleScene'));

		this.refresh();
	}

	maxSelectableDanger() {
		return Math.min(MetaProgression.getClearedDanger() + 1, MAX_DANGER);
	}

	cycleDanger(direction = 1) {
		const max = this.maxSelectableDanger();
		this.danger = Phaser.Math.Wrap(this.danger + direction, 0, max + 1);
		this.refresh();
	}

	buildCards() {
		const { width, height } = this.scale;
		const cardWidth = 250;
		const cardHeight = 300;
		const gap = 20;
		const totalWidth = playerCatalog.length * cardWidth + (playerCatalog.length - 1) * gap;
		const startX = width / 2 - totalWidth / 2 + cardWidth / 2;
		const y = height / 2 - 20;

		playerCatalog.forEach((character, index) => {
			const x = startX + index * (cardWidth + gap);
			const container = this.add.container(x, y);

			const background = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x111827, 0.96)
				.setStrokeStyle(2, 0x374151)
				.setInteractive({ useHandCursor: true });
			container.add(background);

			const tintColor = character.tint ? Phaser.Display.Color.HexStringToColor(character.tint).color : 0xffffff;
			const portrait = this.add.image(0, -70, character.spritesheets.idle.textureKey, 0)
				.setDisplaySize(110, 110);
			if (character.tint) {
				portrait.setTint(tintColor);
			}
			container.add(portrait);

			const name = this.add.text(0, 12, character.name, {
				fontFamily: 'Arial Black, Arial, sans-serif',
				fontSize: '22px',
				color: character.tint ?? '#e5e7eb',
			}).setOrigin(0.5);
			container.add(name);

			const description = this.add.text(0, 70, character.description ?? '', {
				fontFamily: 'Arial, sans-serif',
				fontSize: '13px',
				color: '#d1d5db',
				align: 'center',
				wordWrap: { width: cardWidth - 26 },
			}).setOrigin(0.5);
			container.add(description);

			const statusText = this.add.text(0, cardHeight / 2 - 24, '', {
				fontFamily: 'Arial Black, Arial, sans-serif',
				fontSize: '16px',
				color: '#fbbf24',
			}).setOrigin(0.5);
			container.add(statusText);

			background.on('pointerdown', () => this.handleCardClick(character));

			this.cards.push({ character, background, statusText });
		});
	}

	handleCardClick(character: PlayerDefinition) {
		const unlocked = MetaProgression.isCharacterUnlocked(character.id, character.unlockGold ?? 0);

		if (unlocked) {
			this.sound.play('click', { volume: 0.4 });
			this.selectedId = character.id;
		} else {
			this.sound.play('hurt', { volume: 0.3 });
			this.cameras.main.shake(150, 0.005);
		}
		this.refresh();
	}

	refresh() {
		const state = MetaProgression.load();
		this.goldText.setText(`🪙 ${state.gold}   (누적 ${state.lifetimeGold})`);

		for (const card of this.cards) {
			const { character, background, statusText } = card;
			const unlocked = MetaProgression.isCharacterUnlocked(character.id, character.unlockGold ?? 0);
			const isSelected = this.selectedId === character.id;

			if (isSelected) {
				background.setStrokeStyle(4, 0xfbbf24);
			} else {
				background.setStrokeStyle(2, unlocked ? 0x4b5563 : 0x374151);
			}

			if (unlocked) {
				statusText.setText(isSelected ? '✔ 선택됨' : '보유').setColor(isSelected ? '#4ade80' : '#9ca3af');
			} else {
				statusText.setText(`🔒 누적 🪙 ${state.lifetimeGold}/${character.unlockGold}`).setColor('#6b7280');
			}
		}

		const lockedInfo = this.maxSelectableDanger() < MAX_DANGER ? `  (최대 해금: ${this.maxSelectableDanger()})` : '';
		this.dangerText.setText(`💀 난이도 ${this.danger}${lockedInfo}`);
	}

	startRun() {
		this.sound.play('click', { volume: 0.4 });
		this.scene.start('GameScene', { characterId: this.selectedId, danger: this.danger });
	}
}
