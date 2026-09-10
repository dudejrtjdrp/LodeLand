// 대기마을 전용 창 3종 — 대장간(검 구매) · 에다(능력치 강화) · 증강 제단.
// (2026-08-31 사용자 요구: "이어붙이기" 금지 — 메이플스토리/그랜드체이스급 전용 창)
//
// 공통 문법 (그 게임들의 상점 창 분석에서 가져온 것):
//   · 리본 타이틀 + NPC 초상/대사 말풍선  — 창마다 주인이 있다
//   · 카드형 상품(아이콘 슬롯+등급색+가격 리본) + 명확한 구매 CTA
//   · 우상단 골드 잔액 상시 표시, 부족하면 가격이 붉게
//   · E/ESC/바깥 클릭 닫기 — 마을 조작과 일관
// 구매 로직은 전부 기존 ShopSystem/AugmentSystem 을 호출한다 (표현 계층만 신설).

import Phaser from 'phaser';
import type GameScene from '../../scenes/GameScene';
import type VillageSystem from '../VillageSystem';
import type { ShopStatSpec } from '../../types/catalogs';
import { shopCatalog } from '../shop/shopLogic';
import {
	FONT, UI, style, panel, insetPanel, slot, banner, button, divider, iconImage, coin,
	createUiRoot, TEXT_RESOLUTION, expandHit, uiScaleFor,
	type UiRoot,
} from '../../ui/theme';

const DEPTH_DIM = 2599;
const DEPTH_WIN = 2600;

export type StallKind = 'smith' | 'edda' | 'altar';

export interface StallWindow {
	kind: StallKind;
	destroy(): void;
}

/** 창 공통 프레임: 딤 + 패널 + 리본 타이틀 + 골드 배지 + 닫기 (E/ESC/바깥) */
abstract class WindowBase implements StallWindow {
	abstract kind: StallKind;
	scene: GameScene;
	village: VillageSystem;
	root: UiRoot;
	objects: Phaser.GameObjects.GameObject[] = [];
	dim: Phaser.GameObjects.Rectangle;
	goldText: Phaser.GameObjects.Text | null = null;
	content: { x: number; y: number; w: number; h: number };
	private keyHandler: ((event: KeyboardEvent) => void) | null = null;
	private keyDelay: Phaser.Time.TimerEvent | null = null;
	destroyed = false;

	constructor(village: VillageSystem, title: string, subtitle: string, panelW: number, panelH: number) {
		this.village = village;
		this.scene = village.scene;
		const scene = this.scene;

		this.dim = scene.add.rectangle(
			scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, 0x06080a, 0.72,
		).setDepth(DEPTH_DIM).setInteractive();
		this.dim.setScrollFactor(0);
		this.dim.on('pointerdown', () => this.close());

		this.root = createUiRoot(scene, DEPTH_WIN);
		const width = this.root.width;
		const height = this.root.height;
		const px = (width - panelW) / 2;
		const py = (height - panelH) / 2;
		this.content = { x: px, y: py + 88, w: panelW, h: panelH - 118 };

		const frame = panel(scene, px, py, panelW, panelH);
		const swallow = scene.add.rectangle(px + panelW / 2, py + panelH / 2, panelW, panelH, 0x000000, 0.001)
			.setInteractive();
		this.track(frame, swallow);

		// 리본 타이틀
		const ribbon = banner(scene, px + panelW / 2, py + 20, Math.min(430, panelW - 220));
		const titleText = scene.add.text(px + panelW / 2, py + 16, title, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '20px', fontStyle: '900', color: '#ffc579',
		}).setOrigin(0.5);
		titleText.setShadow(0, 2, '#000000', 4, false, true);
		const subText = scene.add.text(px + panelW / 2, py + 46, subtitle, style(11.5, '#9aa8b5'))
			.setOrigin(0.5);
		this.track(ribbon, titleText, subText);

		// 골드 배지 (좌상단)
		const goldG = scene.add.graphics();
		coin(goldG, px + 34, py + 26, 9);
		this.goldText = scene.add.text(px + 50, py + 26, '0', style(16, UI.goldText, { display: true }))
			.setOrigin(0, 0.5);
		this.track(goldG, this.goldText);
		this.refreshGold();

		// 닫기
		// ✕ 는 글자 크기 그대로면 못 누른다 — UiRoot 축소 배율까지 감안해 44px 확보
		const closeText = expandHit(scene.add.text(px + panelW - 22, py + 20, '✕', style(16, '#9aa8b5', { display: true }))
			.setOrigin(0.5).setInteractive({ useHandCursor: true }), { scale: uiScaleFor(scene) });
		closeText.on('pointerdown', () => this.close());
		closeText.on('pointerover', () => closeText.setColor('#ff8a63'));
		closeText.on('pointerout', () => closeText.setColor('#9aa8b5'));
		const hint = scene.add.text(px + panelW / 2, py + panelH - 13, 'E · ESC · 바깥 클릭 — 닫기', style(10, UI.textFaint))
			.setOrigin(0.5);
		this.track(closeText, hint);

		this.track(divider(scene, px + panelW / 2, py + 62, panelW - 70));

		// 창을 "연" 키가 곧바로 닫지 않도록 다음 틱에 등록
		this.keyHandler = (event: KeyboardEvent) => {
			if (event.code === 'Escape' || event.code === 'KeyE') {
				event.stopImmediatePropagation?.();
				this.close();
			}
		};
		this.keyDelay = scene.time.delayedCall(0, () => {
			if (!this.destroyed && this.keyHandler) {
				scene.input.keyboard!.on('keydown', this.keyHandler);
			}
		});
	}

	track(...objects: Phaser.GameObjects.GameObject[]): void {
		for (const object of objects) {
			// 입력 판정 정합: 스케일 루트(컨테이너)의 scrollFactor(0)와 자식의 scrollFactor 가
			// 다르면 렌더 위치와 히트테스트 위치가 카메라 스크롤만큼 어긋난다 —
			// 마을은 카메라가 플레이어를 따라다니므로 반드시 자식에도 0을 준다.
			(object as Phaser.GameObjects.Container).setScrollFactor?.(0, 0, true);
		}
		this.root.add(...objects);
		this.objects.push(...objects);
	}

	/** 창 전용 단축키 등록 (창이 닫힐 때 자동 해제) */
	bindKey(code: string, handler: () => void): void {
		const wrapped = (event: KeyboardEvent) => {
			if (event.code === code && !this.destroyed) {
				handler();
			}
		};
		this.scene.input.keyboard!.on('keydown', wrapped);
		this.objects.push({
			destroy: () => this.scene.input.keyboard?.off('keydown', wrapped),
		} as unknown as Phaser.GameObjects.GameObject);
	}

	refreshGold(): void {
		const gold = this.scene.pickupSystem?.runGold ?? 0;
		this.goldText?.setText(gold.toLocaleString());
	}

	/** NPC 초상 + 이름 + 말풍선 (좌측 컬럼) — 반환: 콘텐츠 시작 x */
	buildNpcColumn(opts: {
		name: string; line: string;
		spriteKey?: string; spriteFrame?: number; animKey?: string; iconKey?: string; display?: number;
	}): number {
		const scene = this.scene;
		const { x, y } = this.content;
		const colW = 190;
		const cx = x + 26 + colW / 2 - 13;

		this.track(slot(scene, cx, y + 74, 112, 'blue'));
		if (opts.spriteKey && scene.textures.exists(opts.spriteKey)) {
			const npc = scene.add.sprite(cx, y + 78, opts.spriteKey, opts.spriteFrame ?? 0);
			const display = opts.display ?? 96;
			npc.setDisplaySize(display, display);
			if (opts.animKey && scene.anims.exists(opts.animKey)) {
				npc.play(opts.animKey);
			}
			this.track(npc);
		} else if (opts.iconKey) {
			const icon = iconImage(scene, opts.iconKey, cx, y + 74, 58, UI.goldText);
			this.track(icon);
		}
		const nameText = scene.add.text(cx, y + 142, opts.name, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '15px', fontStyle: '900', color: UI.white,
		}).setOrigin(0.5);
		this.track(nameText);

		// 말풍선
		const bubbleY = y + 164;
		const bubble = insetPanel(scene, x + 22, bubbleY, colW - 8, 118, { alpha: 0.9 });
		const line = scene.add.text(x + 34, bubbleY + 12, `“${opts.line}”`,
			{ ...style(11.5, '#c3ccd3'), wordWrap: { width: colW - 34 } });
		this.track(bubble, line);

		return x + 26 + colW;
	}

	close(): void {
		this.village.onWindowClosed(this);
		this.destroy();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.keyDelay?.remove(false);
		if (this.keyHandler) {
			this.scene.input.keyboard?.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}
		for (const object of this.objects) {
			object.destroy();
		}
		this.objects = [];
		this.dim.destroy();
		this.root.destroy();
	}
}

// ---------------------------------------------------------------------------
// 1) 대장간 — 통합 검 화면 (2026-09-02)
//
// 예전에는 여기에 '오퍼 5카드 창'이 있었고, 거기서 다시 [장비 전체 화면] 버튼을
// 눌러야 구매·장비·보관함·조합을 함께 볼 수 있었다. 두 화면이 각자 리롤 버튼을
// 갖고 있어 "어느 목록이 바뀌는지" 혼란스러웠다 (사용자 제보).
//
// 지금은 대장간 E = 곧바로 통합 화면(ShopSystem/ShopUi) 하나다.
// 이 클래스는 마을의 '시설 창' 규약(activeWindow.kind / destroy)에 통합 화면을
// 끼워 넣는 얇은 어댑터일 뿐, 자체 UI 를 그리지 않는다.
// ---------------------------------------------------------------------------

export class ShopScreenWindow implements StallWindow {
	kind: StallKind = 'smith';
	private village: VillageSystem;
	private destroyed = false;

	constructor(village: VillageSystem) {
		this.village = village;
		const shop = village.scene.shopSystem;
		if (!shop) {
			return;
		}
		// 화면이 스스로 닫히면(SPACE·ESC) 마을에도 알린다
		shop.onClosed = () => {
			if (!this.destroyed) {
				this.destroyed = true;
				village.onWindowClosed(this);
			}
		};
		shop.open(Math.max(0, village.nextRound - 1));
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		const shop = this.village.scene.shopSystem;
		if (shop?.isOpen) {
			shop.onClosed = null; // 재진입 방지 — 이미 정리 중이다
			shop.close();
		}
	}
}

// ---------------------------------------------------------------------------
// 2) 에다 — 능력치 강화 (스탯 카드 그리드)
// ---------------------------------------------------------------------------

export class EddaWindow extends WindowBase implements StallWindow {
	kind: StallKind = 'edda';

	constructor(village: VillageSystem) {
		super(village, '에다 — 능력치 강화', '몸이 버텨야 검도 난다', 1010, 618);
		this.build();
	}

	private build(): void {
		const scene = this.scene;
		const shop = scene.shopSystem;
		if (!shop) {
			return;
		}

		const startX = this.buildNpcColumn({
			name: '에다',
			line: shop.ui.keeperLine(this.village.nextRound - 1),
			spriteKey: 'vlg-edda',
			animKey: 'vlg-edda-idle',
			display: 100,
		});

		const { y, w, x } = this.content;
		const areaW = x + w - startX - 26;
		const stats: ShopStatSpec[] = shopCatalog.stats ?? [];
		const cols = 4;
		const gap = 10;
		const cardW = (areaW - gap * (cols - 1)) / cols;
		const cardH = 108;

		stats.forEach((entry, index) => {
			const cx = startX + (index % cols) * (cardW + gap);
			const cy = y + 4 + Math.floor(index / cols) * (cardH + gap);
			this.buildStatCard(cx, cy, cardW, cardH, entry);
		});
	}

	private rebuild(): void {
		const village = this.village;
		this.destroy();
		village.replaceWindow(new EddaWindow(village));
	}

	private buildStatCard(cx: number, cy: number, cw: number, ch: number, entry: ShopStatSpec): void {
		const scene = this.scene;
		const shop = scene.shopSystem!;
		const price = shop.statPrice(entry);
		const bought = shop.purchaseCounts[entry.id] ?? 0;
		const maxed = shop.isStatMaxed(entry);
		const affordable = !maxed && shop.getGold() >= price;

		const card = insetPanel(scene, cx, cy, cw, ch, { alpha: maxed ? 0.7 : 0.94 });
		this.track(card);

		this.track(slot(scene, cx + 22, cy + 22, 30, affordable ? 'gray' : 'ghost'));
		this.track(iconImage(scene, entry.icon, cx + 22, cy + 22, 16, maxed ? '#7fc46a' : affordable ? UI.goldText : '#5c6a75'));
		const name = scene.add.text(cx + 42, cy + 22, entry.name, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '13.5px', fontStyle: '900', color: UI.white,
		}).setOrigin(0, 0.5);
		this.track(name);
		if (bought > 0) {
			this.track(scene.add.text(cx + cw - 10, cy + 22, `×${bought}`, style(11, '#7fc46a', { display: true }))
				.setOrigin(1, 0.5));
		}

		const desc = scene.add.text(cx + 12, cy + 40, entry.desc,
			{ ...style(10.5, '#9aa8b5'), wordWrap: { width: cw - 24 } });
		this.track(desc);

		// 가격 + 구매 (카드 전체 클릭) — 상한(MAX)이면 가격 대신 MAX 표기, 클릭 불가 (2026-09-04)
		if (maxed) {
			const maxLabel = scene.add.text(cx + cw - 10, cy + ch - 18, 'MAX — 더 올릴 수 없음',
				style(11.5, '#7fc46a', { display: true })).setOrigin(1, 0.5);
			this.track(maxLabel);
			return;
		}
		const priceG = scene.add.graphics();
		coin(priceG, cx + 18, cy + ch - 18, 7);
		const priceText = scene.add.text(cx + 32, cy + ch - 18, price.toLocaleString(),
			style(13, affordable ? UI.goldText : '#ff8a63', { display: true })).setOrigin(0, 0.5);
		this.track(priceG, priceText);
		const buyLabel = scene.add.text(cx + cw - 10, cy + ch - 18, affordable ? '강화 ▸' : '골드 부족',
			style(11.5, affordable ? '#7fc46a' : '#5c6a75', { display: true })).setOrigin(1, 0.5);
		this.track(buyLabel);

		const hit = scene.add.rectangle(cx + cw / 2, cy + ch / 2, cw, ch, 0x000000, 0.001)
			.setInteractive({ useHandCursor: true });
		hit.on('pointerover', () => card.setAlpha(1));
		hit.on('pointerout', () => card.setAlpha(0.94));
		hit.on('pointerdown', () => {
			const before = shop.getGold();
			shop.buyStat(entry);
			if (shop.getGold() !== before) {
				this.rebuild();
			}
		});
		this.track(hit);
	}
}

// ---------------------------------------------------------------------------
// 3) 증강 제단 — 드래프트 구매 + 보유 증강 열람
// ---------------------------------------------------------------------------

export class AltarWindow extends WindowBase implements StallWindow {
	kind: StallKind = 'altar';

	constructor(village: VillageSystem) {
		super(village, '증강 제단', '심장에 새기는 것은 되돌릴 수 없다', 780, 560);
		this.build();
	}

	private build(): void {
		const scene = this.scene;
		const shop = scene.shopSystem;
		const augment = scene.augmentSystem;
		const { x, y, w } = this.content;

		// 제단 무드
		const altar = scene.add.image(x + 96, y + 96, 'vlg-altar').setDisplaySize(104, 136);
		const torchL = scene.add.image(x + 40, y + 132, 'vlg-torch').setDisplaySize(30, 28);
		const torchR = scene.add.image(x + 152, y + 132, 'vlg-torch').setDisplaySize(30, 28);
		const chalice = scene.add.image(x + 96, y + 178, 'vlg-chalice').setDisplaySize(26, 36);
		this.track(altar, torchL, torchR, chalice);

		// 보유 증강 목록
		const listX = x + 206;
		const listW = w - (listX - x) - 26;
		const taken = augment?.takenAugments?.() ?? [];
		this.track(scene.add.text(listX, y + 6, `새겨진 증강 ${taken.length}`, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '14px', fontStyle: '900', color: UI.white,
		}).setOrigin(0, 0.5));

		if (taken.length === 0) {
			this.track(scene.add.text(listX, y + 34, '아직 아무것도 새기지 않았다.', style(11.5, UI.textFaint)));
		}
		const rowH = 40;
		taken.slice(0, 7).forEach((entry, index) => {
			const ry = y + 26 + index * (rowH + 6);
			this.track(insetPanel(scene, listX, ry, listW, rowH, { alpha: 0.9 }));
			this.track(scene.add.text(listX + 12, ry + 12, entry.name, style(12.5, UI.goldText, { display: true }))
				.setOrigin(0, 0.5));
			const desc = scene.add.text(listX + 12, ry + 28, entry.desc, style(10, '#9aa8b5')).setOrigin(0, 0.5);
			if (desc.width > listW - 24) {
				desc.setScale(Math.max(0.8, (listW - 24) / desc.width));
			}
			this.track(desc);
		});
		if (taken.length > 7) {
			this.track(scene.add.text(listX, y + 26 + 7 * (rowH + 6), `…외 ${taken.length - 7}개`,
				style(10.5, UI.textFaint)));
		}

		// 드래프트 구매 CTA
		const price = shop?.augmentDraftPrice?.() ?? 0;
		const affordable = (shop?.getGold() ?? 0) >= price;
		const buyDraft = () => {
			if (!affordable) {
				scene.soundSystem?.play('hurt', { volume: 0.25 });
				return;
			}
			this.close();
			shop?.buyAugmentDraft();
		};
		const draftBtn = button(scene, x + w / 2, y + this.content.h - 34, 420, 52, `증강 드래프트 — ${price} 골드`, {
			variant: affordable ? 'gold' : 'ghost', fontSize: 15, display: true, key: 'A',
			sub: '셋 중 하나를 골라 심장에 새긴다',
			onClick: buyDraft,
		});
		this.track(draftBtn.container);
		this.bindKey('KeyA', buyDraft);
	}
}

export function openStallWindow(village: VillageSystem, kind: StallKind): StallWindow {
	switch (kind) {
		case 'smith':
			return new ShopScreenWindow(village);
		case 'edda':
			return new EddaWindow(village);
		default:
			return new AltarWindow(village);
	}
}
