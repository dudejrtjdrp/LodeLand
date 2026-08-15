import Phaser from 'phaser';
import MetaProgression from '../systems/MetaProgression.js';

// Permanent upgrade shop (VS PowerUp menu style). Full refund supported.
export default class PowerUpScene extends Phaser.Scene {
	constructor() {
		super('PowerUpScene');
	}

	create() {
		const { width, height } = this.scale;

		this.add.rectangle(width / 2, height / 2, width, height, 0x0b0f1a, 1);

		this.add.text(width / 2, 46, '영구 강화', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '40px',
			color: '#a78bfa',
		}).setOrigin(0.5).setShadow(0, 4, '#000000', 6, false, true);

		this.goldText = this.add.text(width / 2, 96, '', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '22px',
			color: '#fbbf24',
		}).setOrigin(0.5);

		this.rows = [];
		this.buildRows();
		this.refresh();

		// Refund + back buttons
		const refund = this.add.text(width / 2 - 110, height - 52, '↩ 전액 환불', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '19px',
			color: '#f87171',
			backgroundColor: '#1f2937',
			padding: { x: 14, y: 8 },
		}).setOrigin(0.5).setInteractive({ useHandCursor: true });

		refund.on('pointerdown', () => {
			MetaProgression.refundAll();
			this.refresh();
		});

		const back = this.add.text(width / 2 + 110, height - 52, 'ESC — 뒤로', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '19px',
			color: '#e5e7eb',
			backgroundColor: '#1f2937',
			padding: { x: 14, y: 8 },
		}).setOrigin(0.5).setInteractive({ useHandCursor: true });

		back.on('pointerdown', () => this.scene.start('TitleScene'));
		this.input.keyboard.on('keydown-ESC', () => this.scene.start('TitleScene'));
	}

	buildRows() {
		const { width } = this.scale;
		const catalog = MetaProgression.catalog();
		const rowWidth = Math.min(680, width - 60);
		const rowHeight = 46;
		const startY = 146;

		catalog.forEach((entry, index) => {
			const y = startY + index * (rowHeight + 8);

			const background = this.add.rectangle(width / 2, y, rowWidth, rowHeight, 0x1f2937, 0.95)
				.setStrokeStyle(1, 0x374151)
				.setInteractive({ useHandCursor: true });

			const label = this.add.text(width / 2 - rowWidth / 2 + 16, y, '', {
				fontFamily: 'Arial, sans-serif',
				fontSize: '17px',
				color: '#e5e7eb',
			}).setOrigin(0, 0.5);

			const costText = this.add.text(width / 2 + rowWidth / 2 - 16, y, '', {
				fontFamily: 'Arial Black, Arial, sans-serif',
				fontSize: '17px',
				color: '#fbbf24',
			}).setOrigin(1, 0.5);

			background.on('pointerover', () => background.setFillStyle(0x374151, 0.95));
			background.on('pointerout', () => background.setFillStyle(0x1f2937, 0.95));
			background.on('pointerdown', () => {
				const result = MetaProgression.buy(entry.id);
				if (result.ok) {
					this.sound.play('gold', { volume: 0.5 });
					this.cameras.main.flash(150, 167, 139, 250);
				} else {
					this.sound.play('hurt', { volume: 0.25 });
				}
				this.refresh();
			});

			this.rows.push({ entry, background, label, costText });
		});
	}

	describe(entry) {
		const value = entry.perRank;
		const pct = `${Math.round(value * 100)}%`;
		return entry.descTemplate.replace('{pct}', pct).replace('{value}', `${value}`);
	}

	refresh() {
		const state = MetaProgression.load();
		this.goldText.setText(`🪙 ${state.gold}`);

		for (const row of this.rows) {
			const rank = MetaProgression.getRank(row.entry.id, state);
			const isMax = rank >= row.entry.maxRank;
			const cost = isMax ? null : MetaProgression.costOf(row.entry, rank);

			row.label.setText(`${row.entry.icon} ${row.entry.name}  [${rank}/${row.entry.maxRank}]  ${this.describe(row.entry)}`);

			if (isMax) {
				row.costText.setText('MAX').setColor('#4ade80');
			} else if (state.gold < cost) {
				row.costText.setText(`🪙 ${cost}`).setColor('#6b7280');
			} else {
				row.costText.setText(`🪙 ${cost}`).setColor('#fbbf24');
			}
		}
	}
}
