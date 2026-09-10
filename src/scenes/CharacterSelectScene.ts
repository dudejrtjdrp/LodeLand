import GamepadSystem from '../systems/GamepadSystem';
import Phaser from 'phaser';
import BgmSystem from '../systems/BgmSystem';
import playerCatalogRaw from '../data/playerCatalog.json';
import MetaProgression from '../systems/MetaProgression';
import { reduceMotion } from '../core/settings';
import type { PlayerDefinition } from '../types/catalogs';
import {
	FONT, UI, style, panel, insetPanel, banner, selectFrame, button, keycap, diamond,
	createUiRoot, iconImage, type UiRoot, TEXT_RESOLUTION,
} from '../ui/theme';

const playerCatalog = playerCatalogRaw as unknown as PlayerDefinition[];

const MAX_DANGER = 2;

// 떼지기별 테마 컬러 (풀무=담금 청, 홰지기=잉걸, 외깃=그믐, 시금꾼=짚쇠)
const CHAR_THEME: Record<string, { num: number; css: string }> = {
	'hero-basic': { num: 0x8fc3d8, css: '#8fc3d8' },
	berserker: { num: 0xe8874a, css: '#e8874a' },
	swordmaster: { num: 0xa794d1, css: '#a794d1' },
	gambler: { num: 0xd9a83c, css: '#d9a83c' },
};

// DEPTH 타일 (인덱스 3은 비주얼 전용 잠금 타일)
const DANGER_TILES = [
	{ label: '위험도 Ⅰ', sub: '추천 — 첫 사냥' },
	{ label: '위험도 Ⅱ', sub: '녹 강화 +30%' },
	{ label: '위험도 Ⅲ', sub: '녹 강화 +60%' },
	{ label: '위험도 Ⅳ', sub: '누적 골드 30,000 필요', lockedVisual: true },
];

interface CharacterCard {
	character: PlayerDefinition;
	container: Phaser.GameObjects.Container;
	frame: Phaser.GameObjects.NineSlice;
	sel: Phaser.GameObjects.NineSlice;
	statusText: Phaser.GameObjects.Text;
	statusChip: Phaser.GameObjects.NineSlice;
	ribbon: Phaser.GameObjects.Container;
	lockBarBack: Phaser.GameObjects.Image;
	lockBarFill: Phaser.GameObjects.Image;
	lockTexts: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Image>;
	w: number;
	h: number;
}

interface DangerTile {
	container: Phaser.GameObjects.Container;
	tileBg: Phaser.GameObjects.NineSlice;
	tileSel: Phaser.GameObjects.NineSlice;
	index: number;
	w: number;
	h: number;
}

export default class CharacterSelectScene extends Phaser.Scene {
	selectedId!: string;
	danger!: number;
	goldText!: Phaser.GameObjects.Text;
	lifetimeText!: Phaser.GameObjects.Text;
	cards!: CharacterCard[];
	dangerTiles!: DangerTile[];
	ui!: UiRoot;

	constructor() {
		super('CharacterSelectScene');
	}

	create() {
		// 타이틀과 같은 곡을 이어서 (이미 재생 중이면 아무 일도 하지 않는다)
		BgmSystem.for(this).play('title');
		this.selectedId = playerCatalog[0].id;
		this.danger = 0;

		// 배경: 던전 홀 무드 (실제 화면 크기 기준 — 스케일 대상 아님)
		const sw = this.scale.width;
		const sh = this.scale.height;
		this.add.rectangle(sw / 2, sh / 2, sw, sh, UI.bg, 1);
		const bg = this.add.graphics();
		bg.fillGradientStyle(0x171009, 0x171009, UI.bg, UI.bg, 1);
		bg.fillRect(0, 0, sw, sh * 0.55);
		bg.fillStyle(0x000000, 0.45);
		bg.fillRect(0, sh * 0.72, sw, sh * 0.28);
		for (let i = 0; i < 30; i += 1) {
			bg.fillStyle(UI.goldBright, Phaser.Math.FloatBetween(0.04, 0.2));
			bg.fillCircle(Phaser.Math.Between(0, sw), Phaser.Math.Between(0, sh), Phaser.Math.FloatBetween(0.7, 1.6));
		}

		// 여기서부터 생성되는 UI 는 고정 디자인 좌표계 → 화면에 맞춰 통째로 스케일
		const backdropCount = this.children.list.length;
		this.ui = createUiRoot(this, 10);
		const width = this.ui.width;
		const height = this.ui.height;
		const cx = width / 2;

		// 좌상단 정철 패널 (보유/누적)
		panel(this, 22, 20, 300, 58);
		iconImage(this, 'g-chip', 48, 49, 18, 0xd9a83c).setDepth(1);
		this.add.text(66, 38, '골드', style(11, UI.textFaint)).setOrigin(0, 0.5).setDepth(1);
		this.goldText = this.add.text(66, 58, '', style(18, UI.goldText, { display: true })).setOrigin(0, 0.5).setDepth(1);
		this.add.text(190, 38, '누적', style(11, UI.textFaint)).setOrigin(0, 0.5).setDepth(1);
		this.lifetimeText = this.add.text(190, 58, '', style(18, UI.text, { display: true })).setOrigin(0, 0.5).setDepth(1);

		// 타이틀 리본 배너
		const title = this.add.text(cx, 46, '키퍼 선택', {
			fontFamily: FONT.serifKr, fontSize: '32px', fontStyle: 'bold', color: UI.text,
			resolution: TEXT_RESOLUTION,
			letterSpacing: 4,
		}).setOrigin(0.5).setDepth(1);
		banner(this, cx, 46, title.width + 220, { variant: 1, h: 58 });
		this.add.text(cx, 88, '광맥에 들어갈 키퍼와 위험도를 고르세요', style(14, UI.textDim)).setOrigin(0.5);

		this.cards = [];
		this.buildCards();

		// ── 자맥 깊이 선택 — 좁은 화면에서 DELVE 와 겹치지 않게 남는 폭에 맞춰 타일을 줄인다
		const rowY = height - 96;
		const tileH = 62;
		const tileGap = 14;
		const tileCount = DANGER_TILES.length;
		const delveW = 300;
		const leftZoneL = 24;                              // 좌측 여백 (화살표 포함)
		const leftZoneR = width - 190 - delveW / 2 - 28;   // DELVE 왼쪽 경계
		const arrowZone = 66;                              // ◀▶ 자리 (버튼 42 + 간격)
		const tilesTotal = Math.min(
			tileCount * 196 + (tileCount - 1) * tileGap,
			leftZoneR - leftZoneL - arrowZone * 2,
		);
		const tileW = (tilesTotal - (tileCount - 1) * tileGap) / tileCount;
		const blockCx = (leftZoneL + leftZoneR) / 2;       // 화살표+타일 블록 중심
		const tilesStart = blockCx - tilesTotal / 2 + tileW / 2;

		this.add.text(blockCx, rowY - 58, '위험도', style(15, '#dfe5e9', { display: true })).setOrigin(0.5);

		this.dangerTiles = [];

		DANGER_TILES.forEach((tile, index) => {
			const x = tilesStart + index * (tileW + tileGap);
			const tileBg = insetPanel(this, 0, 0, tileW, tileH, { origin: 0.5 });
			const tileSel = selectFrame(this, 0, 0, tileW + 10, tileH + 10, { tint: UI.quench });
			const parts: Phaser.GameObjects.GameObject[] = [tileBg, tileSel];

			// 타일이 좁아지면 아이콘을 붙이고 서브 텍스트를 줄여 서로 닿지 않게 한다
			const narrow = tileW < 160;
			const icon = iconImage(this, tile.lockedVisual ? 'g-lock' : 'g-vein', -tileW / 2 + (narrow ? 16 : 26), 0, narrow ? 14 : 18,
				tile.lockedVisual ? 0x8a8272 : 0xa8543a);
			icon.setAlpha(tile.lockedVisual ? 0.7 : 1);
			parts.push(icon);
			parts.push(this.add.text(narrow ? 10 : 6, -9, tile.label, style(15, tile.lockedVisual ? UI.textFaint : UI.text)).setOrigin(0.5));
			parts.push(this.add.text(narrow ? 10 : 6, 12, tile.sub, style(narrow ? 9 : 10, tile.lockedVisual ? UI.textFaint : UI.textDim, { bold: false })).setOrigin(0.5));

			const container = this.add.container(x, rowY, parts);
			container.setSize(tileW, tileH);
			if (!tile.lockedVisual) {
				container.setInteractive({ useHandCursor: true });
				container.on('pointerdown', () => this.setDanger(index));
			}
			this.dangerTiles.push({ container, tileBg, tileSel, index, w: tileW, h: tileH });
		});

		// ◀▶ 화살표 + A/D 키캡
		const leftArrow = button(this, tilesStart - tileW / 2 - 40, rowY, 42, tileH, '◀', {
			variant: 'dark', fontSize: 16, onClick: () => this.cycleDanger(-1),
		});
		keycap(this, tilesStart - tileW / 2 - 40, rowY + tileH / 2 + 18, 'A', 11);
		const rightArrow = button(this, tilesStart + tilesTotal - tileW / 2 + 40, rowY, 42, tileH, '▶', {
			variant: 'dark', fontSize: 16, onClick: () => this.cycleDanger(1),
		});
		keycap(this, tilesStart + tilesTotal - tileW / 2 + 40, rowY + tileH / 2 + 18, 'D', 11);
		leftArrow.container.setDepth(5);
		rightArrow.container.setDepth(5);

		// 출격 버튼
		const sortie = button(this, width - 190, rowY, 300, 72, '출격', {
			variant: 'gold', fontSize: 28, display: true, icon: 'g-feather', ornate: true,
			onClick: () => this.startRun(),
		});
		sortie.container.setDepth(5);
		keycap(this, width - 190, rowY + 52, 'SPACE', 12);
		if (!reduceMotion()) {
			this.tweens.add({ targets: sortie.container, alpha: 0.92, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
		}

		this.input.keyboard!.on('keydown-SPACE', () => this.startRun());
		// ENTER = 게임패드 A 가 합성하는 확정 키
		this.input.keyboard!.on('keydown-ENTER', () => this.startRun());
		this.input.keyboard!.on('keydown-LEFT', () => this.cycleDanger(-1));
		this.input.keyboard!.on('keydown-RIGHT', () => this.cycleDanger(1));
		this.input.keyboard!.on('keydown-A', () => this.cycleDanger(-1));
		this.input.keyboard!.on('keydown-D', () => this.cycleDanger(1));
		this.input.keyboard!.on('keydown-ESC', () => this.scene.start('TitleScene'));
		// 게임패드 — 메뉴에서도 십자키/A/B 가 먹어야 한다 (미연결이면 비용 0)
		GamepadSystem.attach(this);

		if (import.meta.env.DEV) {
			(window as unknown as { __charSelect?: CharacterSelectScene }).__charSelect = this; // dev-only debug hook (stripped from production builds)
		}

		// 배경을 제외한 모든 UI 를 스케일 루트로 이동
		for (const child of this.children.list.slice(backdropCount)) {
			if (child !== this.ui.root) {
				this.ui.root.add(child);
			}
		}
		this.ui.sort();

		this.refresh();
	}

	maxSelectableDanger() {
		return Math.min(MetaProgression.getClearedDanger() + 1, MAX_DANGER);
	}

	setDanger(value: number) {
		if (value > this.maxSelectableDanger()) {
			this.sound.play('hurt', { volume: 0.25 });
			this.cameras.main.shake(120, 0.004);
			return;
		}
		this.danger = value;
		this.sound.play('click', { volume: 0.35 });
		this.refresh();
	}

	cycleDanger(direction = 1) {
		const max = this.maxSelectableDanger();
		this.danger = Phaser.Math.Wrap(this.danger + direction, 0, max + 1);
		this.sound.play('click', { volume: 0.35 });
		this.refresh();
	}

	buildCards() {
		const width = this.ui.width;
		const height = this.ui.height;
		const cardWidth = Math.min(280, (width - 140) / playerCatalog.length - 18);
		const cardHeight = Math.min(470, height * 0.56);
		const gap = 24;
		const totalWidth = playerCatalog.length * cardWidth + (playerCatalog.length - 1) * gap;
		const startX = width / 2 - totalWidth / 2 + cardWidth / 2;
		const y = height / 2 - 24;

		playerCatalog.forEach((character, index) => {
			const x = startX + index * (cardWidth + gap);
			const container = this.add.container(x, y);
			const frame = panel(this, 0, 0, cardWidth, cardHeight, { origin: 0.5 });
			container.add(frame);
			const sel = selectFrame(this, 0, 0, cardWidth + 14, cardHeight + 14, { tint: UI.quench });
			container.add(sel);

			const theme = CHAR_THEME[character.id] ?? { num: UI.gold, css: UI.goldText };

			// 상단 문양 다이아 (캐릭터 톤)
			const crest = this.add.graphics();
			diamond(crest, 0, -cardHeight / 2, 10, theme.num, 0.95);
			diamond(crest, 0, -cardHeight / 2, 4.5, 0x101418);
			container.add(crest);

			// 초상 (픽셀 스프라이트, 받침대 위)
			const pedestal = this.add.graphics();
			pedestal.fillStyle(0x000000, 0.5);
			pedestal.fillEllipse(0, -cardHeight * 0.08, cardWidth * 0.55, 22);
			pedestal.fillStyle(theme.num, 0.12);
			pedestal.fillEllipse(0, -cardHeight * 0.08, cardWidth * 0.45, 16);
			container.add(pedestal);

			const portrait = this.add.image(0, -cardHeight * 0.22, character.spritesheets.idle.textureKey, 0);
			const scale = ((cardHeight * 0.34) / portrait.height) * (character.portraitScale ?? 1);
			portrait.setScale(scale);
			if (character.tint) {
				portrait.setTint(Phaser.Display.Color.HexStringToColor(character.tint).color);
			}
			container.add(portrait);

			// 이름 밴드 (크림 인셋)
			container.add(insetPanel(this, 0, cardHeight * 0.02 + 20, cardWidth - 28, 40, { origin: 0.5 }));

			const name = this.add.text(0, cardHeight * 0.02 + 20, character.name, {
				fontFamily: FONT.serifKr, fontSize: '24px', fontStyle: 'bold', color: theme.css,
				resolution: TEXT_RESOLUTION,
			}).setOrigin(0.5);
			container.add(name);

			const description = this.add.text(0, cardHeight * 0.20, character.description ?? '', {
				...style(12, UI.textDim, { bold: false }),
				align: 'center',
				wordWrap: { width: cardWidth - 40 },
				lineSpacing: 4,
			}).setOrigin(0.5, 0);
			container.add(description);

			// 키퍼 고유 메커닉 — 능력치 차이 위에 얹히는 그 키퍼만의 규칙 (2026-09-01)
			if (character.mechanic) {
				const mechY = description.y + description.height + 9;
				const mechName = this.add.text(0, mechY, `고유 ▸ ${character.mechanic.name}`, {
					...style(12, theme.css, { bold: true }),
					align: 'center',
				}).setOrigin(0.5, 0);
				container.add(mechName);

				const mechDesc = this.add.text(0, mechY + 17, character.mechanic.short, {
					...style(11, UI.textFaint, { bold: false }),
					align: 'center',
					wordWrap: { width: cardWidth - 40 },
					lineSpacing: 3,
				}).setOrigin(0.5, 0);
				container.add(mechDesc);
			}

			// 상태 칩 (크림 인셋)
			const statusChip = insetPanel(this, 0, cardHeight / 2 - 35, 92, 26, { origin: 0.5 });
			container.add(statusChip);
			const statusText = this.add.text(0, cardHeight / 2 - 36, '', style(13, UI.text)).setOrigin(0.5);
			container.add(statusText);

			// "선택됨" 리본 (팩 리본 배너)
			const ribbonBg = banner(this, 0, 0, 116, { variant: 1, h: 32 });
			const ribbonText = this.add.text(0, 0, '선택됨', style(13, UI.quenchText)).setOrigin(0.5);
			const ribbon = this.add.container(0, -cardHeight / 2 - 4, [ribbonBg, ribbonText]);
			container.add(ribbon);

			// 잠금 오버레이 (진행도 바 = 팩 fill 스트립)
			const barW = cardWidth - 60;
			const lockBarBack = this.add.image(-barW / 2, cardHeight / 2 - 26, 'uf-fill-dark')
				.setOrigin(0, 0).setDisplaySize(barW, 9).setAlpha(0.9);
			container.add(lockBarBack);
			const lockBarFill = this.add.image(-barW / 2 + 1, cardHeight / 2 - 25, 'uf-fill-cream')
				.setOrigin(0, 0).setDisplaySize(1, 7).setTint(UI.straw);
			container.add(lockBarFill);
			const lockIconTop = iconImage(this, 'g-lock', 0, -cardHeight / 2 + 34, 20, 0x5d6880);
			const lockIconMid = iconImage(this, 'g-lock', 0, -cardHeight * 0.05, 28, 0x5d6880);
			container.add(lockIconTop);
			container.add(lockIconMid);

			const hit = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0.001).setInteractive({ useHandCursor: true });
			container.add(hit);
			hit.on('pointerdown', () => this.handleCardClick(character));
			hit.on('pointerover', () => container.setScale(1.02));
			hit.on('pointerout', () => container.setScale(1));

			this.cards.push({
				character, container, frame, sel, statusText, statusChip, ribbon,
				lockBarBack, lockBarFill,
				lockTexts: [lockIconTop, lockIconMid], w: cardWidth, h: cardHeight,
			});
		});
	}

	drawCardFrame(card: CharacterCard, state: 'selected' | 'owned' | 'locked') {
		// Flat 팩: 프레임 틴트 + 셀렉트 코너 표시로 상태를 표현한다
		// (잠금 틴트를 너무 어둡게 하면 잉크 텍스트가 묻힌다 — 옅은 냉회색만)
		card.sel.setVisible(state === 'selected');
		if (state === 'locked') {
			card.frame.setTint(0x8a939c).setAlpha(0.95);
		} else {
			card.frame.clearTint();
			card.frame.setAlpha(1);
		}
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
		this.goldText.setText(state.gold.toLocaleString());
		this.lifetimeText.setText(state.lifetimeGold.toLocaleString());

		for (const card of this.cards) {
			const { character, statusText, statusChip, ribbon, lockBarBack, lockBarFill, lockTexts } = card;
			const unlocked = MetaProgression.isCharacterUnlocked(character.id, character.unlockGold ?? 0);
			const isSelected = this.selectedId === character.id;
			const theme = CHAR_THEME[character.id] ?? { num: UI.gold, css: UI.goldText };

			this.drawCardFrame(card, isSelected ? 'selected' : unlocked ? 'owned' : 'locked');
			ribbon.setVisible(isSelected);

			if (unlocked) {
				for (const t of lockTexts) t.setVisible(false);
				lockBarBack.setVisible(false);
				lockBarFill.setVisible(false);
				statusChip.setVisible(true);
				statusText.setY(card.h / 2 - 36);
				statusText.setText('보유 중').setColor(isSelected ? UI.quenchText : theme.css);
			} else {
				for (const t of lockTexts) t.setVisible(true);
				statusChip.setVisible(false);
				statusText.setY(card.h / 2 - 58);
				statusText.setText(`누적 골드 ${(character.unlockGold ?? 0).toLocaleString()} 필요\n${state.lifetimeGold.toLocaleString()} / ${(character.unlockGold ?? 0).toLocaleString()}`)
					.setColor(UI.textDim).setAlign('center');
				// 진행도 바 (팩 fill 스트립)
				const ratio = Phaser.Math.Clamp(state.lifetimeGold / Math.max(1, character.unlockGold ?? 1), 0, 1);
				const barW = card.w - 60;
				lockBarBack.setVisible(true);
				lockBarFill.setVisible(ratio > 0.004);
				lockBarFill.setDisplaySize(Math.max(1, (barW - 2) * ratio), 7);
			}
		}

		// 난이도 타일
		const maxSelectable = this.maxSelectableDanger();
		for (const tile of this.dangerTiles) {
			const isLockedVisual = Boolean(DANGER_TILES[tile.index].lockedVisual);
			const isLockedReal = !isLockedVisual && tile.index > maxSelectable;
			const isSelected = !isLockedVisual && tile.index === this.danger;

			tile.tileSel.setVisible(isSelected);
			if (isLockedVisual || isLockedReal) {
				tile.tileBg.setTint(0x767e88);
			} else {
				tile.tileBg.clearTint();
			}
			tile.container.setAlpha(isLockedReal ? 0.55 : 1);
		}
	}

	startRun() {
		this.sound.play('click', { volume: 0.4 });
		this.scene.start('GameScene', { characterId: this.selectedId, danger: this.danger });
	}
}
