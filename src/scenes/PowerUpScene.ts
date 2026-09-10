import GamepadSystem from '../systems/GamepadSystem';
import Phaser from 'phaser';
import BgmSystem from '../systems/BgmSystem';
import MetaProgression from '../systems/MetaProgression';
import type { MetaUpgradeDefinition } from '../types/catalogs';
import {
	FONT, UI, style, panel, insetPanel, slot, banner, selectFrame, button, diamond,
	createUiRoot, iconImage, type UiRoot, TEXT_RESOLUTION,
} from '../ui/theme';

interface PowerUpRow {
	entry: MetaUpgradeDefinition;
	levelText: Phaser.GameObjects.Text;
	descText: Phaser.GameObjects.Text;
	pipsG: Phaser.GameObjects.Graphics;
	costButton: ReturnType<typeof button>;
	costLabel: Phaser.GameObjects.Text;
	rowBg: Phaser.GameObjects.NineSlice;
	x: number;
	y: number;
	w: number;
	h: number;
}

// Permanent upgrade shop (VS PowerUp menu style). Full refund supported.
export default class PowerUpScene extends Phaser.Scene {
	goldText!: Phaser.GameObjects.Text;
	rows!: PowerUpRow[];
	ui!: UiRoot;

	constructor() {
		super('PowerUpScene');
	}

	create() {
		// 타이틀과 같은 곡을 이어서 (이미 재생 중이면 아무 일도 하지 않는다)
		BgmSystem.for(this).play('title');
		// 배경 (실제 화면 크기)
		const sw = this.scale.width;
		const sh = this.scale.height;
		this.add.rectangle(sw / 2, sh / 2, sw, sh, UI.bg, 1);

		// 좌우 화로 잉걸 무드 (양쪽에 은은한 노 불빛)
		const mood = this.add.graphics();
		for (const side of [70, sw - 70]) {
			for (let i = 0; i < 5; i += 1) {
				mood.fillStyle(0xd9702e, 0.045 + i * 0.012);
				mood.fillCircle(side, sh * 0.55 - i * 22, 66 - i * 10);
			}
		}

		const backdropCount = this.children.list.length;
		this.ui = createUiRoot(this, 10);
		const width = this.ui.width;
		const height = this.ui.height;
		const cx = width / 2;

		// 외곽 프레임 (팩 셀렉트 코너)
		selectFrame(this, cx, height / 2, width - 20, height - 20, { tint: UI.steel });

		// 타이틀 (리본 배너 + 잉크 텍스트)
		const title = this.add.text(cx, 42, '영구 강화', {
			fontFamily: FONT.serifKr, fontSize: '34px', fontStyle: 'bold', color: UI.text,
			resolution: TEXT_RESOLUTION,
			letterSpacing: 6,
		}).setOrigin(0.5).setDepth(1);
		banner(this, cx, 42, title.width + 220, { variant: 1, h: 60 });
		this.add.text(cx, 84, '잉걸불을 지핀다', style(15, UI.emberText, { display: true })).setOrigin(0.5);
		this.add.text(cx, 110, '광맥에서 모은 골드로 몸을 벼립니다 — 죽어도 남는 힘.', style(13, UI.textDim)).setOrigin(0.5);

		// 좌상단 골드 패널
		panel(this, 24, 24, 190, 44);
		iconImage(this, 'g-chip', 52, 46, 18, 0xd9a83c).setDepth(1);
		this.goldText = this.add.text(68, 46, '', style(19, UI.goldText, { display: true })).setOrigin(0, 0.5).setDepth(1);

		// 리스트 외곽 패널
		const listW = Math.min(1240, width - 100);
		const rowH = 56;
		const rowGap = 10;
		const catalog = MetaProgression.catalog();
		const listH = catalog.length * (rowH + rowGap) - rowGap + 32;
		const listX = cx - listW / 2;
		const listY = 134;
		panel(this, listX, listY, listW, listH);

		this.rows = [];
		this.buildRows(listX + 16, listY + 16, listW - 32, rowH, rowGap);

		// 하단 버튼
		const by = Math.min(height - 56, listY + listH + 52);
		const refund = button(this, cx - 360, by, 330, 62, '전체 환급', {
			variant: 'red', fontSize: 17, display: true, sub: '쓴 골드를 모두 돌려받는다',
			onClick: () => {
				MetaProgression.refundAll();
				this.sound.play('gold', { volume: 0.4 });
				this.refresh();
			},
		});
		refund.container.setDepth(10);
		// 정산→강화→재출격 루프의 마지막 조각: 여기서 바로 광맥으로 내려간다
		const delve = button(this, cx, by, 330, 62, '출격', {
			variant: 'gold', fontSize: 19, display: true, key: 'SPACE', ornate: true, sub: '광맥으로 들어간다',
			onClick: () => this.scene.start('CharacterSelectScene'),
		});
		delve.container.setDepth(10);
		const back = button(this, cx + 360, by, 330, 62, '뒤로', {
			variant: 'dark', fontSize: 17, display: true, key: 'ESC',
			onClick: () => this.scene.start('TitleScene'),
		});
		back.container.setDepth(10);

		this.input.keyboard!.on('keydown-ESC', () => this.scene.start('TitleScene'));
		// 게임패드 — 메뉴에서도 십자키/A/B 가 먹어야 한다 (미연결이면 비용 0)
		GamepadSystem.attach(this);
		this.input.keyboard!.on('keydown-SPACE', () => this.scene.start('CharacterSelectScene'));
		this.input.keyboard!.on('keydown-ENTER', () => this.scene.start('CharacterSelectScene'));

		for (const child of this.children.list.slice(backdropCount)) {
			if (child !== this.ui.root) {
				this.ui.root.add(child);
			}
		}
		this.ui.sort();

		this.refresh();
	}

	buildRows(x: number, y: number, w: number, rowH: number, rowGap: number) {
		const catalog = MetaProgression.catalog();

		catalog.forEach((entry: MetaUpgradeDefinition, index: number) => {
			const rowY = y + index * (rowH + rowGap);

			const rowBg = insetPanel(this, x, rowY, w, rowH);

			// 번호
			this.add.text(x + 26, rowY + rowH / 2, `${index + 1}`, style(20, UI.textDim, { display: true })).setOrigin(0.5);

			// 아이콘 타일
			slot(this, x + 48 + (rowH - 12) / 2, rowY + rowH / 2, rowH - 12, 'slate');
			iconImage(this, entry.icon, x + 48 + (rowH - 12) / 2, rowY + rowH / 2, 22, UI.quenchText).setDepth(1);

			// 이름 / 레벨
			this.add.text(x + 112, rowY + rowH / 2, entry.name, style(17, UI.text)).setOrigin(0, 0.5);
			const levelText = this.add.text(x + 236, rowY + rowH / 2, '', style(14, UI.goldText, { display: true })).setOrigin(0, 0.5);

			// 설명
			const descText = this.add.text(x + 340, rowY + rowH / 2, '', style(13, UI.textDim, { bold: false })).setOrigin(0, 0.5);

			// 다이아 pip 진행도
			const pipsG = this.add.graphics();

			// 비용 버튼
			const costButton = button(this, x + w - 90, rowY + rowH / 2, 150, 38, '', {
				variant: 'gold', fontSize: 15,
				onClick: () => this.buy(entry),
			});
			// 행 전체 호버 존(아래 hit)이 비용 버튼을 덮으면 버튼이 호버/눌림 반응을
			// 못 한다 (Phaser topOnly). 버튼을 위로 올려 자기 중앙은 자기가 먹게 한다.
			costButton.container.setDepth(2);
			const costLabel = costButton.label;
			costLabel.setX(10);
			iconImage(this, 'g-chip', x + w - 90 - 48, rowY + rowH / 2, 16, 0xd9a83c)
				.setDepth(costButton.container.depth + 1);

			// 행 호버 (크림 인셋을 살짝 데운다)
			const hit = this.add.rectangle(x + w / 2, rowY + rowH / 2, w, rowH, 0x000000, 0.001)
				.setInteractive({ useHandCursor: true });
			hit.on('pointerover', () => rowBg.setTint(0x9fcfe8));
			hit.on('pointerout', () => rowBg.clearTint());
			hit.on('pointerdown', () => this.buy(entry));

			this.rows.push({ entry, levelText, descText, pipsG, costButton, costLabel, rowBg, x, y: rowY, w, h: rowH });
		});
	}

	buy(entry: MetaUpgradeDefinition) {
		const result = MetaProgression.buy(entry.id);
		if (result.ok) {
			this.sound.play('gold', { volume: 0.5 });
			this.cameras.main.flash(150, 232, 135, 74);
		} else {
			this.sound.play('hurt', { volume: 0.25 });
		}
		this.refresh();
	}

	describe(entry: MetaUpgradeDefinition, rank: number) {
		const value = entry.perRank;
		const pct = `${Math.round(value * 100 * Math.max(1, rank))}%`;
		return entry.descTemplate.replace('{pct}', pct).replace('{value}', `${value * Math.max(1, rank)}`);
	}

	refresh() {
		const state = MetaProgression.load();
		this.goldText.setText(state.gold.toLocaleString());

		for (const row of this.rows) {
			const rank = MetaProgression.getRank(row.entry.id, state);
			const isMax = rank >= row.entry.maxRank;
			const cost = isMax ? null : MetaProgression.costOf(row.entry, rank);

			row.levelText.setText(`Lv. ${rank} / ${row.entry.maxRank}`);
			row.descText.setText(this.describe(row.entry, rank));

			// pips
			row.pipsG.clear();
			const pipCount = Math.min(10, row.entry.maxRank);
			const filled = Math.round((rank / row.entry.maxRank) * pipCount);
			const pipStartX = row.x + row.w - 200 - pipCount * 16;
			for (let i = 0; i < pipCount; i += 1) {
				const px = pipStartX + i * 16;
				diamond(row.pipsG, px, row.y + row.h / 2, 5.5,
					i < filled ? UI.ember : 0x2c343c, i < filled ? 1 : 0.9);
				if (i < filled) {
					diamond(row.pipsG, px, row.y + row.h / 2, 2.2, 0xf5c9a6, 0.9);
				}
			}

			if (isMax) {
				row.costButton.setLabel('MAX');
				row.costLabel.setColor(UI.green);
				row.costButton.redraw('dark');
				row.costButton.setEnabled(false);
			} else {
				row.costButton.setLabel(cost!.toLocaleString());
				row.costButton.setEnabled(true);
				if (state.gold >= cost!) {
					row.costButton.redraw('gold');
					row.costLabel.setColor(UI.goldText);
				} else {
					row.costButton.redraw('ghost');
					row.costLabel.setColor(UI.textFaint);
				}
			}
		}
	}
}
