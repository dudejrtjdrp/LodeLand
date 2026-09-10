// 화면 상단 대형 보스 HP바.
//
// 보스(catalog.isBoss)가 살아 있는 동안 상단 라운드 패널 아래에 큰 게이지를 띄운다.
// 이름 + 특성 요약(약점 원소 아이콘 · 면역)까지 함께 보여 "무슨 검이 먹히는지"를
// 전투 중에도 읽을 수 있게 한다. 쌍보스 라운드(30/40/50라)는 최대 3줄로 쌓인다.
// 보스의 머리 위 소형 바는 VisualEffectsSystem.drawEnemyHealthBars 가 그리지 않는다.
//
// 성능: 정적 요소(이름·아이콘·프레임)는 보스 구성이 바뀔 때만 재구축하고,
// 매 틱(120ms 스로틀)에는 게이지 fill 만 다시 그린다.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import { FONT, UI, style, hudScaleFor, iconImage, ELEMENT_THEME, TEXT_RESOLUTION } from '../ui/theme';
import { traitsOf, weakElements, resistElements, immunities, CC_LABELS } from '../logic/enemyTraits';

const DEPTH_BG = 1000;
const DEPTH_FILL = 1001;
const DEPTH_TEXT = 1002;

/** 한 보스 줄의 정적 오브젝트 묶음 */
interface BossRow {
	enemy: EnemySprite;
	nameText: Phaser.GameObjects.Text;
	hpText: Phaser.GameObjects.Text;
	infoObjects: Phaser.GameObjects.GameObject[];
	/** 게이지 사각형 (fill 그리기용) */
	barX: number;
	barY: number;
	barW: number;
	barH: number;
	lastRatioDrawn: number;
}

export default class BossBarSystem {
	scene: GameScene;
	private bgG: Phaser.GameObjects.Graphics;
	private fillG: Phaser.GameObjects.Graphics;
	private rows: BossRow[] = [];
	private signature = '';
	private lastUpdateAt = 0;
	/** 지금 살아 있는 보스가 있는지 — BgmSystem(보스 트랙 전환)이 읽는다 */
	hasBoss = false;
	private visibleFlag = true;
	private destroyed = false;

	/** 재사용 수집 버퍼 (매 틱 배열 할당 방지) */
	private readonly collectBuffer: EnemySprite[] = [];

	constructor(scene: GameScene) {
		this.scene = scene;
		this.bgG = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH_BG);
		this.fillG = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH_FILL);
		scene.scale.on('resize', this.onResize, this);
	}

	private onResize(): void {
		// 리사이즈 시 전면 재구축
		this.signature = '';
	}

	update(): void {
		if (this.destroyed) {
			return;
		}
		const now = this.scene.time.now;
		if (now - this.lastUpdateAt < 120) {
			return;
		}
		this.lastUpdateAt = now;

		// 살아 있는 보스 수집 (최대 3)
		const bosses = this.collectBuffer;
		bosses.length = 0;
		const children = (this.scene.enemyManager?.enemies?.getChildren() ?? []) as EnemySprite[];
		for (const enemy of children) {
			if (!enemy.active || enemy.isDying || !enemy.catalog?.isBoss) {
				continue;
			}
			bosses.push(enemy);
			if (bosses.length >= 3) {
				break;
			}
		}

		this.hasBoss = bosses.length > 0;

		const width = this.scene.scale.width;
		// phaseIndex 포함 — 탈각(형태 전환) 시 이름·특성 아이콘을 다시 그린다
		const nextSignature = `${width}|${bosses.map((b) => `${b.enemyType}#${b.spawnGeneration}:${b.phaseIndex ?? -1}`).join(',')}`;
		if (nextSignature !== this.signature) {
			this.signature = nextSignature;
			this.rebuild(bosses);
		}

		this.drawFills();
	}

	/** 정적 부분(프레임·이름·특성 요약) 재구축 — 보스 구성이 바뀔 때만 */
	private rebuild(bosses: EnemySprite[]): void {
		for (const row of this.rows) {
			row.nameText.destroy();
			row.hpText.destroy();
			for (const object of row.infoObjects) {
				object.destroy();
			}
		}
		this.rows = [];
		this.bgG.clear();
		this.fillG.clear();

		if (bosses.length === 0) {
			return;
		}

		const scene = this.scene;
		const hs = hudScaleFor(scene);
		const width = scene.scale.width;
		const barW = Math.min(540 * hs, width * 0.46);
		const barH = 18 * hs;
		const rowH = 56 * hs;
		const x = width / 2 - barW / 2;
		let y = 122 * hs;

		for (const enemy of bosses) {
			// 페이즈 보스는 현재 형태의 특성을 보여준다 (EnemyManager 오버라이드 우선)
			const traits = scene.enemyManager?.currentTraitsOf?.(enemy) ?? traitsOf(enemy.catalog);
			const weak = weakElements(traits);
			const resist = resistElements(traits);
			const immune = immunities(traits);
			const phase = enemy.catalog?.phases?.[enemy.phaseIndex ?? -1];
			const bossName = `${enemy.catalog?.name ?? '보스'}${phase ? ` · ${phase.name}` : ''}`;

			// ── 이름 줄
			const nameText = scene.add.text(x, y, bossName, {
				fontFamily: FONT.display,
				resolution: TEXT_RESOLUTION,
				fontSize: `${15 * hs}px`,
				fontStyle: '900',
				color: UI.emberText,
			}).setOrigin(0, 1).setScrollFactor(0).setDepth(DEPTH_TEXT).setVisible(this.visibleFlag);
			nameText.setShadow(0, 2, '#000000', 4, false, true);

			const infoObjects: Phaser.GameObjects.GameObject[] = [];
			// 특성 요약 (우측 정렬): [약점 ◆◆] [저항 ◆] [면역 …]
			let cursorX = x + barW;
			const addLabel = (label: string, color: string) => {
				const text = scene.add.text(cursorX, y - 2 * hs, label, style(10 * hs, color, { display: true }))
					.setOrigin(1, 1).setScrollFactor(0).setDepth(DEPTH_TEXT).setVisible(this.visibleFlag);
				text.setShadow(0, 2, '#000000', 3, false, true);
				infoObjects.push(text);
				cursorX -= text.width + 5 * hs;
			};
			const addElementIcons = (elements: Array<{ element: string }>, max: number) => {
				for (let i = Math.min(elements.length, max) - 1; i >= 0; i -= 1) {
					const theme = ELEMENT_THEME[elements[i].element];
					if (!theme) {
						continue;
					}
					const icon = iconImage(scene, theme.tex, cursorX - 7 * hs, y - 9 * hs, 13 * hs, theme.num);
					(icon as Phaser.GameObjects.Image).setScrollFactor?.(0);
					icon.setDepth(DEPTH_TEXT);
					(icon as Phaser.GameObjects.Image).setVisible?.(this.visibleFlag);
					infoObjects.push(icon);
					cursorX -= 15 * hs;
				}
			};

			// 오른쪽 → 왼쪽으로 쌓는다: 면역 → 저항 → 약점
			if (immune.length > 0) {
				addLabel(`면역 ${immune.map((kind) => CC_LABELS[kind]).join('·')}`, '#9aa8b2');
				cursorX -= 6 * hs;
			}
			if (resist.length > 0) {
				addElementIcons(resist, 3);
				addLabel('저항', '#7f8c99');
				cursorX -= 6 * hs;
			}
			if (weak.length > 0) {
				addElementIcons(weak, 3);
				addLabel('약점', '#ffab5e');
			}

			// ── 게이지 프레임 (정적)
			const barY = y + 4 * hs;
			this.bgG.fillStyle(0x000000, 0.55);
			this.bgG.fillRect(x - 2, barY - 2, barW + 4, barH + 4);
			this.bgG.fillStyle(0x14100c, 0.95);
			this.bgG.fillRect(x, barY, barW, barH);
			this.bgG.lineStyle(1.5, UI.rust, 1);
			this.bgG.strokeRect(x - 2, barY - 2, barW + 4, barH + 4);
			this.bgG.lineStyle(1, UI.goldDark, 0.8);
			this.bgG.strokeRect(x, barY, barW, barH);

			const hpText = scene.add.text(x + barW / 2, barY + barH / 2, '', {
				fontFamily: FONT.display,
				resolution: TEXT_RESOLUTION,
				fontSize: `${11 * hs}px`,
				fontStyle: '700',
				color: UI.white,
			}).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_TEXT).setVisible(this.visibleFlag);
			hpText.setShadow(0, 2, '#000000', 3, false, true);

			this.rows.push({
				enemy,
				nameText,
				hpText,
				infoObjects,
				barX: x,
				barY,
				barW,
				barH,
				lastRatioDrawn: -1,
			});

			y += rowH;
		}
	}

	/** 매 틱: 게이지 fill 만 다시 그린다 */
	private drawFills(): void {
		const g = this.fillG;
		let needsClear = false;
		for (const row of this.rows) {
			const ratio = Phaser.Math.Clamp((row.enemy.hp ?? 0) / Math.max(1, row.enemy.maxHp ?? 1), 0, 1);
			if (Math.abs(ratio - row.lastRatioDrawn) > 0.002) {
				needsClear = true;
				break;
			}
		}
		if (!needsClear) {
			return;
		}

		g.clear();
		if (!this.visibleFlag) {
			return;
		}
		for (const row of this.rows) {
			const enemy = row.enemy;
			if (!enemy.active) {
				continue;
			}
			const ratio = Phaser.Math.Clamp((enemy.hp ?? 0) / Math.max(1, enemy.maxHp ?? 1), 0, 1);
			row.lastRatioDrawn = ratio;
			const fillW = Math.round(row.barW * ratio);
			if (fillW > 0) {
				// 잉걸 그라디언트 fill + 상단 하이라이트
				g.fillGradientStyle(0xe0654d, 0xd9702e, 0x8a3f14, 0x6e3012, 1);
				g.fillRect(row.barX, row.barY, fillW, row.barH);
				g.fillStyle(0xffffff, 0.14);
				g.fillRect(row.barX, row.barY, fillW, Math.max(2, row.barH * 0.28));
			}
			// 10% 눈금
			g.lineStyle(1, 0x000000, 0.35);
			for (let i = 1; i < 10; i += 1) {
				const tx = row.barX + (row.barW * i) / 10;
				g.beginPath();
				g.moveTo(tx, row.barY);
				g.lineTo(tx, row.barY + row.barH);
				g.strokePath();
			}

			const pct = Math.ceil(ratio * 100);
			const label = `${Math.max(0, Math.ceil(enemy.hp ?? 0)).toLocaleString()} / ${(enemy.maxHp ?? 0).toLocaleString()}  (${pct}%)`;
			if (row.hpText.text !== label) {
				row.hpText.setText(label);
			}
		}
	}

	setVisible(visible: boolean): void {
		this.visibleFlag = visible;
		this.bgG.setVisible(visible);
		this.fillG.setVisible(visible);
		for (const row of this.rows) {
			row.nameText.setVisible(visible);
			row.hpText.setVisible(visible);
			for (const object of row.infoObjects) {
				(object as Phaser.GameObjects.Image).setVisible?.(visible);
			}
		}
		if (visible) {
			// 다시 켤 때 fill 강제 재도장
			for (const row of this.rows) {
				row.lastRatioDrawn = -1;
			}
			this.drawFills();
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.scene.scale.off('resize', this.onResize, this);
		for (const row of this.rows) {
			row.nameText.destroy();
			row.hpText.destroy();
			for (const object of row.infoObjects) {
				object.destroy();
			}
		}
		this.rows = [];
		this.bgG.destroy();
		this.fillG.destroy();
	}
}
