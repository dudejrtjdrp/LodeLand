// 통합 검 화면 = 대장간 (2026-08-28 개편 → 2026-09-02 통합/필터 개편):
//  대기마을 대장간에서 E 한 번이면 이 화면 하나가 열린다 (구매 목록 + 보유 검).
//  이전의 '검 구매 창 → 장비 전체 화면' 2단계 동선과 창마다 따로 있던 리롤은 없앴다.
//  증강 진입점도 여기서 빼고 대기마을 '증강 제단'으로 일원화했다.
//  중앙 = 플레이어 캐릭터 + 검 자리 7개(안쪽 궤도 3 · 바깥 궤도 4, 방사형 배치)
//  좌측 = 검 구매 목록(리롤한 순서 그대로의 단순 목록) + 교체(리롤) + [능력치]/[조합] 모달 버튼
//  우측 = 원소 필터 칩 + 보관함 그리드(등급 섹션으로 줄 나눔) + 장착/판매 버튼 + 검 정보 패널
//  ※ 원소 필터·등급 그룹은 보관함 전용 (2026-09-03 사용자 피드백) — 구매 목록에는 걸지 않는다.
//  하단 = 드래그 앤 드랍 가이드.
// 용어는 전부 쉬운 한국어(자리/보관함/강화/각인/조합) — 세계관 용어는 로어에만.
// 순수 표현 계층 — 구매/배치/판매는 모두 ShopSystem 으로 라우팅된다.

import Phaser from 'phaser';
import MetaProgression from '../MetaProgression';
import { reduceMotion } from '../../core/settings';
import type { ShopStatSpec, SwordDefinition } from '../../types/catalogs';
import type { ReserveSword, SwordSprite } from '../../types/actors';
import type ShopSystem from './ShopSystem';
import type { OrbitSword } from '../sword/types';
import { ELEMENT_LABELS, shopCatalog } from './shopLogic';
import {
	FONT, UI, style, panel, insetPanel, slot, banner, selectFrame, divider, diamond, keycap,
	RARITY_THEME, ELEMENT_THEME, createUiRoot, iconImage, type RarityTheme, type UiRoot, TEXT_RESOLUTION,
} from '../../ui/theme';
import { Tooltip, withKeywordFooter } from '../../ui/tooltip';
import { AWAKENING_BADGE, awakeningOf, describeSwordLines } from '../../logic/swordInfo';

/** 등급 정렬 순서 (신화 → 일반). 검 목록의 기본 그룹 순서다. */
export const RARITY_SECTION_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'] as const;

/** 원소 필터 칩 (전체 · 무속성 · 원소 8종) — 도감(CodexScene)과 같은 문법 */
export const ELEMENT_FILTERS: Array<{ id: string; label: string }> = [
	{ id: 'all', label: '전체' },
	{ id: 'none', label: '무속성' },
	...Object.keys(ELEMENT_THEME).map((id) => ({ id, label: ELEMENT_THEME[id].label })),
];

const DEPTH = {
	dim: 2300,
	panel: 2301,
	content: 2302,
	badge: 2303,
	// 모달 밴드 — 메인 화면(2300~2303) 위에 뜬다. 바깥 클릭/ESC로 닫힘.
	modalDim: 2600,
	modalPanel: 2601,
	modalContent: 2602,
	modalBadge: 2603,
	// 툴팁은 모달 위에서도 보여야 하므로 최상단
	float: 2700,
};

/** 메인→모달로 옮길 때 기존 빌더가 쓰는 depth(2301~2303)에 더하는 오프셋 */
const MODAL_DEPTH_OFFSET = DEPTH.modalPanel - DEPTH.panel;

export type ShopModalKind = 'upgrades' | 'reforge';

export interface StatCardUi {
	entry: ShopStatSpec;
	bg: Phaser.GameObjects.NineSlice;
	name: Phaser.GameObjects.Text;
	priceText: Phaser.GameObjects.Text;
	valueText: Phaser.GameObjects.Text;
	countText: Phaser.GameObjects.Text;
	coinIcon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
	x: number;
	y: number;
	w: number;
	h: number;
	index: number;
}

/** 좌측 상점의 검 오퍼 행 */
export interface SwordOfferCardUi {
	bg: Phaser.GameObjects.NineSlice;
	rarityStrip: Phaser.GameObjects.Image;
	iconBack: Phaser.GameObjects.NineSlice;
	specialDot: Phaser.GameObjects.Image;
	sprite: Phaser.GameObjects.Image;
	nameText: Phaser.GameObjects.Text;
	levelText: Phaser.GameObjects.Text;
	elementText: Phaser.GameObjects.Text;
	statText: Phaser.GameObjects.Text;
	priceText: Phaser.GameObjects.Text;
	coinIcon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
	hit: Phaser.GameObjects.Rectangle;
	offer: SwordDefinition | null;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SlotButtonUi {
	x: number;
	y: number;
	/** Flat 팩 슬롯 프레임 (상태별 텍스처/틴트는 drawSlot이 관리) */
	img: Phaser.GameObjects.Image;
	/** 선택/속성 코너 프레임 (셀렉트 스프라이트, 평소 숨김) */
	sel: Phaser.GameObjects.NineSlice;
	hit: Phaser.GameObjects.Rectangle;
	icon: Phaser.GameObjects.Image;
	numberText: Phaser.GameObjects.Text;
	levelText: Phaser.GameObjects.Text;
	enhText: Phaser.GameObjects.Text;
	actionText: Phaser.GameObjects.Text;
	lockText: Phaser.GameObjects.Text;
	/** 각성 배지 (★) — 각성한 검이 장착된 자리에만 보인다 */
	awakenBadge: Phaser.GameObjects.Text;
	/** 드래그 앤 드랍 히트테스트에 쓰는 슬롯 한 변 길이 */
	size: number;
}

export interface InvStripRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface ActionButtonUi {
	bg: Phaser.GameObjects.NineSlice;
	title: Phaser.GameObjects.Text;
	sub: Phaser.GameObjects.Text;
	costText: Phaser.GameObjects.Text;
	hit: Phaser.GameObjects.Rectangle;
	x: number;
	y: number;
	w: number;
	h: number;
}

export default class ShopUi {
	shop: ShopSystem;

	uiObjects: Phaser.GameObjects.GameObject[] = [];
	statButtons: StatCardUi[] = [];
	swordButtons: SwordOfferCardUi[] = [];
	slotButtons: SlotButtonUi[] = [];
	reserveIcons: Phaser.GameObjects.GameObject[] = [];
	actionButtons: ActionButtonUi[] = [];
	reserveButtons: ActionButtonUi[] = [];
	detailObjects: Phaser.GameObjects.GameObject[] = [];
	chipObjects: Phaser.GameObjects.GameObject[] = [];

	// ── 원소 필터 / 등급 그룹 (2026-09-02 → 09-03 보관함 전용으로 이동)
	/** 'all' | 'none' | 원소 id — **보관함에만** 걸린다 (구매 목록은 필터 없음) */
	elementFilter = 'all';
	/** 보관함 표시 순서: 'rarity'(등급 그룹, 기본) | 'manual'(직접 정렬한 순서) */
	invSort: 'rarity' | 'manual' = 'rarity';
	filterRect: { x: number; y: number; w: number; h: number } | null = null;
	filterObjects: Phaser.GameObjects.GameObject[] = [];
	/** 검 상점(구매 목록) 영역 — 행을 매 갱신마다 다시 그린다 */
	offerRect: { x: number; y: number; w: number; h: number } | null = null;
	offerRowObjects: Phaser.GameObjects.GameObject[] = [];
	/** (구) 구매 목록 등급 섹션 — 09-03부터 항상 [] (섹션은 보관함으로 이동) */
	offerSections: string[] = [];
	/** 보관함 표시 순서 → 실제 reserve 인덱스 매핑 (필터·등급 정렬 반영) */
	invView: number[] = [];
	/** invView와 1:1 — 각 셀의 배치 (x는 절대, y는 그리드 상단 기준 오프셋) */
	invCellPos: { x: number; y: number }[] = [];
	/** 보관함 등급 섹션 헤더 (라벨·색·그리드 상단 기준 y 오프셋) — 회귀 테스트 계측용 */
	invHeaders: { label: string; css: string; y: number }[] = [];
	invSections: string[] = [];
	/** 보관함 콘텐츠 전체 높이(px) — 스크롤 클램프 기준 */
	invTotalH = 0;

	/** 공용 툴팁 (ui/tooltip.ts) — 화면 전체가 같은 구현을 쓴다 */
	tooltipUi: Tooltip | null = null;
	goldText: Phaser.GameObjects.Text | null = null;
	rerollText: Phaser.GameObjects.Text | null = null;
	rerollG: Phaser.GameObjects.NineSlice | null = null;
	rerollCoin: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null = null;
	selectHint: Phaser.GameObjects.Text | null = null;
	invCountText: Phaser.GameObjects.Text | null = null;

	/** 인벤토리(보관함) 그리드 지오메트리 */
	invGrid: { x: number; y: number; cols: number; rows: number; cell: number; gap: number } | null = null;
	invStripRect: InvStripRect | null = null;
	invScroll = 0;
	invMaskShape: Phaser.GameObjects.Graphics | null = null;
	invMask: Phaser.Display.Masks.GeometryMask | null = null;
	invPageText: Phaser.GameObjects.Text | null = null;
	invSortText: Phaser.GameObjects.Text | null = null;

	/** 판매 드롭 영역 (드래그로 놓으면 판매) */
	sellRect: InvStripRect | null = null;

	detailRect: InvStripRect | null = null;
	detailBg: Phaser.GameObjects.NineSlice | null = null;

	onWheel: ((pointer: Phaser.Input.Pointer, gameObjects: unknown[], deltaX: number, deltaY: number) => void) | null = null;
	keyHandler: ((event: KeyboardEvent) => void) | null = null;

	/** 고정 디자인 좌표계 컨테이너 (화면 크기에 맞춰 통째로 스케일) */
	ui: UiRoot | null = null;
	backdrop: Phaser.GameObjects.GameObject[] = [];

	// ── 모달 상태
	modalKind: ShopModalKind | null = null;
	modalObjects: Phaser.GameObjects.GameObject[] = [];
	/** 모달별 동적 갱신 훅 — refresh() 마지막에 호출된다 */
	modalRefresh: (() => void) | null = null;
	navButtons: { kind: ShopModalKind; bg: Phaser.GameObjects.NineSlice; x: number; y: number; w: number; h: number; sub: Phaser.GameObjects.Text }[] = [];

	constructor(shop: ShopSystem) {
		this.shop = shop;
	}

	// ---------------------------------------------------------------
	// 공용 헬퍼
	// ---------------------------------------------------------------

	get scene() {
		return this.shop.scene;
	}

	/** 스크린 포인터 좌표 → 로컬(디자인) 좌표 */
	toLocalX(screenX: number) {
		return this.ui ? this.ui.toLocalX(screenX) : screenX;
	}

	toLocalY(screenY: number) {
		return this.ui ? this.ui.toLocalY(screenY) : screenY;
	}

	/** 생성한 오브젝트를 루트 컨테이너에 붙이면서 정리 목록에 등록 */
	track(...objects: Phaser.GameObjects.GameObject[]) {
		this.ui?.add(...objects);
		this.uiObjects.push(...objects);
	}

	/** 검 정의의 rarity 필드 → 희귀도 테마 (필드 없으면 진화=전설, 그 외 일반) */
	rarityOfSword(definition: SwordDefinition | null | undefined): RarityTheme {
		if (!definition) {
			return RARITY_THEME.common;
		}
		if (definition.rarity && RARITY_THEME[definition.rarity]) {
			return RARITY_THEME[definition.rarity];
		}
		return definition.evolved ? RARITY_THEME.legendary : RARITY_THEME.common;
	}

	/** 섹션 타이틀: Flat 리본 배너 + 잉크 텍스트 */
	sectionTitle(cx: number, y: number, label: string, halfWidth: number) {
		const scene = this.scene;
		const text = scene.add.text(cx, y, label, style(15, UI.text, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const ribbon = banner(scene, cx, y, Math.max(text.width + 76, Math.min(halfWidth * 2, text.width + 120)), { variant: 3, h: 34 })
			.setScrollFactor(0).setDepth(DEPTH.panel);
		this.uiObjects.push(ribbon, text);
		return text;
	}


	// ---------------------------------------------------------------
	// Floating tooltip
	// ---------------------------------------------------------------

	/**
	 * 공용 Tooltip 컴포넌트(ui/tooltip.ts)로 위임한다.
	 * 상점 UI 는 스케일 루트(this.ui) 안에서 그려지므로 루트를 넘겨 좌표·클램프를 맞춘다.
	 * 제목이 사전 용어면 설명이 자동으로 붙고, 본문에서 발견된 용어는 각주가 된다.
	 */
	showTooltip(anchorX: number, anchorY: number, title: string, body: string) {
		if (!this.tooltipUi) {
			this.tooltipUi = new Tooltip(this.scene, { depth: DEPTH.float, root: this.ui });
		} else {
			this.tooltipUi.setRoot(this.ui);
		}
		this.tooltipUi.show(anchorX, anchorY, withKeywordFooter(title, body, UI.goldText));
	}

	hideTooltip() {
		this.tooltipUi?.hide();
	}

	showSlotResult(slotIndex: number, message: string, color: string) {
		const slot = this.slotButtons?.[slotIndex];
		if (!slot) {
			return;
		}

		const scene = this.scene;
		const text = scene.add.text(slot.x, slot.y - 48, message, style(15, color, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.float + 6);
		text.setShadow(0, 2, '#000000', 4, false, true);
		this.ui?.add(text);
		this.ui?.sort();

		scene.tweens.add({
			targets: text,
			y: text.y - 26,
			alpha: 0,
			duration: 1100,
			onComplete: () => text.destroy(),
		});
	}

	// ---------------------------------------------------------------
	// Build
	// ---------------------------------------------------------------

	build() {
		const shop = this.shop;
		const scene = this.scene;

		// 배경은 실제 화면 크기로(스케일 무관), 나머지 UI 는 디자인 좌표계 안에서 그린다.
		const dim = scene.add.rectangle(
			scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, 0x0b0e11, 1,
		).setScrollFactor(0).setDepth(DEPTH.dim - 1);
		const bgG = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.dim - 1);
		bgG.fillGradientStyle(0x151a20, 0x151a20, 0x0b0e11, 0x0b0e11, 1);
		bgG.fillRect(0, 0, scene.scale.width, scene.scale.height * 0.45);
		// 화로 잉걸 무드 (하단 좌우)
		for (const side of [scene.scale.width * 0.12, scene.scale.width * 0.88]) {
			for (let i = 0; i < 4; i += 1) {
				bgG.fillStyle(0xd9702e, 0.03 + i * 0.008);
				bgG.fillCircle(side, scene.scale.height * 0.92 - i * 18, 60 - i * 11);
			}
		}
		for (let i = 0; i < 34; i += 1) {
			bgG.fillStyle(0xaeb9c2, Phaser.Math.FloatBetween(0.03, 0.12));
			bgG.fillCircle(
				Phaser.Math.Between(0, scene.scale.width),
				Phaser.Math.Between(0, scene.scale.height),
				Phaser.Math.FloatBetween(0.7, 1.6),
			);
		}
		this.backdrop = [dim, bgG];

		this.ui = createUiRoot(scene, DEPTH.dim);
		const width = this.ui.width;
		const height = this.ui.height;

		const outerFrame = selectFrame(scene, width / 2, height / 2, width - 16, height - 16, { tint: UI.steel })
			.setScrollFactor(0).setDepth(DEPTH.panel);
		this.uiObjects.push(outerFrame);

		// ── 레이아웃 기준값: 좌(상점) / 중앙(장비) / 우(보관함+정보)
		// 좌측은 원소 필터 칩 + 등급 섹션이 들어가면서 넓어졌다 (280 → 344).
		const margin = 22;
		const leftW = 344;
		const rightW = 308;
		const leftX = margin;
		const rightX = width - margin - rightW;
		const centerX0 = leftX + leftW + 18;
		const centerX1 = rightX - 18;
		const centerCx = (centerX0 + centerX1) / 2;

		this.buildHeader(width, margin);

		const top = 118;
		const bottomBarY = height - 34;
		const contentBottom = bottomBarY - 26;

		// ── 좌측: 검 상점 (필터·등급 섹션 없는 단순 목록 — 필터는 보관함 쪽에 있다)
		this.sectionTitle(leftX + leftW / 2 - 54, top - 20, '검 구매', leftW / 2 - 52);
		this.buildRerollButton(leftX + leftW, top - 20);
		const navH = 56;
		const offersBottom = contentBottom - navH - 16;
		this.buildOfferArea(leftX, top, leftW, offersBottom - top);
		this.buildNavRow(leftX, contentBottom - navH, leftW, navH);

		// ── 중앙: 캐릭터 + 검 자리 (방사형)
		this.sectionTitle(centerCx, top - 20, '내 검 (장비)', (centerX1 - centerX0) / 2 - 66);
		this.buildElementChips(centerX0, top + 2, centerX1 - centerX0);
		const ringCy = top + 56 + (contentBottom - 130 - top) / 2 - 10;
		this.buildEquipArea(centerCx, ringCy, centerX1 - centerX0);
		this.buildActionRow(centerCx, contentBottom - 62, Math.min(430, centerX1 - centerX0));

		// ── 우측: 보관함 그리드 + 장착/판매 + 검 정보
		this.buildInventoryColumn(rightX, top, rightW, contentBottom - top);

		// ── 하단 가이드 바
		this.buildBottomBar(margin, bottomBarY, width);

		// 생성된 UI 를 전부 스케일 루트에 편입 (배경 제외)
		this.ui.add(...this.uiObjects);
		this.ui.sort();

		// 드래그 앤 드랍 핸들러 (씬 전역)
		shop.drag.install();

		this.keyHandler = (event: KeyboardEvent) => {
			// 증강 오버레이(구매 드래프트)가 열려 있으면 상점 단축키를 전부 무시
			if (this.shop.scene.augmentSystem?.isOpen) {
				return;
			}
			if (event.code === 'Escape') {
				// 모달이 열려 있으면 모달만, 아니면 화면을 닫는다 (마을 시설 창과 같은 규칙)
				if (this.modalKind) {
					this.closeModal();
				} else {
					shop.close();
				}
				return;
			}
			if (event.code === 'Space') {
				// 모달이 열려 있으면 모달만 닫는다 (실수로 라운드 출발 방지)
				if (this.modalKind) {
					this.closeModal();
				} else {
					shop.close();
				}
				return;
			}
			if (event.code === 'KeyU') {
				this.toggleModal('upgrades');
			} else if (event.code === 'KeyR') {
				this.toggleModal('reforge');
			}
		};
		scene.input.keyboard!.on('keydown', this.keyHandler);

		shop.refresh();
	}

	// ---------------------------------------------------------------
	// 헤더
	// ---------------------------------------------------------------

	buildHeader(width: number, margin: number) {
		const scene = this.scene;
		const cx = width / 2;

		// 좌상단 골드
		const goldBg = panel(scene, margin, 18, 196, 46).setScrollFactor(0).setDepth(DEPTH.panel);
		const goldChip = iconImage(scene, 'g-chip', margin + 28, 41, 18, 0xd9a83c);
		(goldChip as Phaser.GameObjects.Image).setScrollFactor?.(0);
		goldChip.setDepth(DEPTH.content);
		this.goldText = scene.add.text(margin + 46, 41, '0', style(20, UI.goldText, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.uiObjects.push(goldBg, goldChip, this.goldText);

		const title = scene.add.text(cx, 34, `대장간 — 검 구매 · 장비 · 보관함 (라운드 ${this.shop.round} 클리어)`, {
			fontFamily: FONT.display, fontSize: '26px', fontStyle: '900', color: UI.text,
			resolution: TEXT_RESOLUTION,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const titleRibbon = banner(scene, cx, 34, title.width + 200, { variant: 1, h: 54 })
			.setScrollFactor(0).setDepth(DEPTH.panel);
		this.uiObjects.push(titleRibbon);

		const sub = scene.add.text(cx - 52, 68, '정비를 마치면 마을로:', style(12, '#c3ccd3'))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const spaceCap = keycap(scene, cx + 52, 68, 'SPACE', 11).setScrollFactor(0).setDepth(DEPTH.content);
		if (!reduceMotion()) {
			scene.tweens.add({ targets: spaceCap, alpha: 0.65, yoyo: true, repeat: -1, duration: 1100 });
		}

		// 우상단: 야장 에다의 한 줄 (라운드 이정표 대사)
		const note = scene.add.text(width - margin, 30, `에다 — “${this.keeperLine(this.shop.round)}”`, {
			...style(12.5, '#9fb0bd', { bold: false }), align: 'right', wordWrap: { width: 380 },
		}).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH.content);

		this.uiObjects.push(title, sub, spaceCap, note);
	}

	/** 야장 에다의 라운드 이정표 대사 — 짧은 플레이 안에서 서사를 전달한다 */
	keeperLine(round: number): string {
		const milestones: Record<number, string> = {
			1: '왔군, 루키. 골드만 받는다 — 심 없는 쇠는 취급 안 해.',
			5: '큰 놈들은 등딱지부터 봐라. 딱지엔 관통이지.',
			10: 'Packlord 뱃속에서 이게 나왔다. 네 스승의 부싯돌이야… 심맥으로 갔군.',
			15: '검이 굶으면 눈빛이 변해. 경험치 아끼지 마라.',
			20: '녹은 바깥에서 온 게 아냐. 우리가 버린 쇠들이 굶은 거지.',
			25: '같은 속성 둘을 나란히 앉혀 봐. 공명이 붙는다.',
			30: '키퍼 조합이 왜 해산됐는지 아나. 만든 걸 책임 못 져서야.',
			35: '강화는 급하면 어긋난다. 보장석이 있다면 모를까.',
			40: '심맥이 가깝다. 코어 단속 잘해라.',
			45: '조합된 놈은 두 속성의 기억을 다 가진다. 아까워 말고.',
			50: '네 스승도 여기까진 왔었다. 그 다음은… 아무도 몰라.',
			55: 'Rust Mother 가슴에서 뛰는 게 뭔지, 보면 알게 된다.',
		};
		if (milestones[round]) {
			return milestones[round];
		}
		const flavor = [
			'강화는 급할수록 어긋나.',
			'지친 검은 보관함에서 쉬게 해.',
			'자리가 늘면 무리도 는다.',
			'Rustbeak 녀석, 무는 맛은 아직 살아 있지.',
		];
		return flavor[round % flavor.length];
	}

	// ---------------------------------------------------------------
	// 좌측 하단 — 모달 여는 버튼 2종 (능력치 / 조합)
	// ---------------------------------------------------------------

	buildNavRow(x: number, y: number, w: number, h: number) {
		const scene = this.scene;
		this.navButtons = [];

		// 증강은 이 화면에서 뺐다 (2026-09-02) — 진입점은 대기마을 '증강 제단' 하나로 모았다.
		const specs: Array<{ kind: ShopModalKind; title: string; icon: string; key: string }> = [
			{ kind: 'upgrades', title: '능력치', icon: 'g-scroll', key: 'U' },
			{ kind: 'reforge', title: '검 조합', icon: 'g-furnace', key: 'R' },
		];

		const gap = 12;
		const buttonW = (w - gap * (specs.length - 1)) / specs.length;
		// 좁은 뷰포트(3버튼)에서는 아이콘을 생략하고 글자를 줄여 겹침을 막는다
		const compact = buttonW < 120;
		const textX = compact ? 10 : 44;

		specs.forEach((spec, index) => {
			const bx = x + index * (buttonW + gap);
			const bg = scene.add.nineslice(bx, y, 'uf-btn-3', 0, buttonW / 2, h / 2, 5, 5, 6, 7)
				.setScale(2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.panel);

			let icon: Phaser.GameObjects.GameObject | null = null;
			if (!compact) {
				icon = iconImage(scene, spec.icon, bx + 24, y + h / 2, 24, UI.goldText);
				(icon as Phaser.GameObjects.Image).setScrollFactor?.(0);
				(icon as Phaser.GameObjects.Image).setDepth(DEPTH.content);
			}

			const title = scene.add.text(bx + textX, y + h / 2 - 11, spec.title, style(compact ? 12.5 : 14.5, UI.text, { display: true }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const sub = scene.add.text(bx + textX, y + h / 2 + 11, '', style(compact ? 9 : 10, UI.textDim, { bold: false }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const cap = keycap(scene, bx + buttonW - (compact ? 18 : 24), y + h / 2 - (compact ? 11 : 0), spec.key, compact ? 8 : 10)
				.setScrollFactor(0).setDepth(DEPTH.content);

			const hit = scene.add.rectangle(bx + buttonW / 2, y + h / 2, buttonW, h, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.badge)
				.setInteractive({ useHandCursor: true });

			const button = { kind: spec.kind, bg, x: bx, y, w: buttonW, h, sub };
			hit.on('pointerdown', () => {
				scene.soundSystem?.play('click', { volume: 0.4 });
				this.toggleModal(spec.kind);
			});
			hit.on('pointerover', () => this.drawNavButton(button, true));
			hit.on('pointerout', () => this.drawNavButton(button, false));

			this.drawNavButton(button, false);
			this.uiObjects.push(bg, title, sub, cap, hit);
			if (icon) {
				this.uiObjects.push(icon);
			}
			this.navButtons.push(button);
		});
	}

	drawNavButton(button: { bg: Phaser.GameObjects.NineSlice }, hover: boolean) {
		button.bg.setTexture(hover ? 'uf-btn-4' : 'uf-btn-3');
	}

	refreshNavButtons() {
		for (const button of this.navButtons) {
			if (button.kind === 'upgrades') {
				button.sub.setText('스탯 성장');
			} else {
				const ready = this.shop.swordOrbit?.getReforgeStates().filter((state) => state.ready).length ?? 0;
				button.sub.setText(ready > 0 ? `조합 가능 ${ready}건!` : '두 검 → 새 검')
					.setColor(ready > 0 ? UI.goldText : UI.textDim);
			}
		}
	}

	// ---------------------------------------------------------------
	// 모달 공통
	// ---------------------------------------------------------------

	toggleModal(kind: ShopModalKind) {
		if (this.modalKind === kind) {
			this.closeModal();
		} else {
			this.openModal(kind);
		}
	}

	openModal(kind: ShopModalKind) {
		this.closeModal();
		if (!this.ui) {
			return;
		}
		this.modalKind = kind;
		this.hideTooltip();

		if (kind === 'upgrades') {
			this.buildUpgradesModal();
		} else {
			this.buildReforgeModal();
		}

		this.ui.add(...this.modalObjects);
		this.ui.sort();
		this.shop.refresh();
	}

	closeModal() {
		if (!this.modalKind) {
			return;
		}
		if (this.reforgeWheelHandler) {
			this.scene.input.off('wheel', this.reforgeWheelHandler);
			this.reforgeWheelHandler = null;
		}
		for (const object of this.reforgeRowObjects) {
			object.destroy();
		}
		this.reforgeRowObjects = [];
		this.reforgeMask?.destroy();
		this.reforgeMask = null;
		this.reforgeMaskShape?.destroy();
		this.reforgeMaskShape = null;
		for (const object of this.modalObjects) {
			object.destroy();
		}
		this.modalObjects = [];

		if (this.modalKind === 'upgrades') {
			this.statButtons = [];
		}
		this.modalKind = null;
		this.modalRefresh = null;
		this.hideTooltip();
	}

	/**
	 * 모달 프레임(딤+패널+타이틀+닫기)을 만들고 콘텐츠 원점을 돌려준다.
	 * 딤 클릭 = 닫기, 패널 위 클릭은 스왈로우.
	 */
	buildModalFrame(title: string, panelW: number, panelH: number): { x: number; y: number; w: number; h: number } {
		const scene = this.scene;
		const width = this.ui!.width;
		const height = this.ui!.height;
		const px = (width - panelW) / 2;
		const py = (height - panelH) / 2;

		const dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x06080a, 0.74)
			.setScrollFactor(0).setDepth(DEPTH.modalDim)
			.setInteractive({ useHandCursor: false });
		dim.on('pointerdown', () => this.closeModal());

		const g = panel(scene, px, py, panelW, panelH).setScrollFactor(0).setDepth(DEPTH.modalPanel);

		// 패널 위 클릭 스왈로우 (딤의 닫기와 분리)
		const swallow = scene.add.rectangle(px + panelW / 2, py + panelH / 2, panelW, panelH, 0x000000, 0.001)
			.setScrollFactor(0).setDepth(DEPTH.modalPanel)
			.setInteractive({ useHandCursor: false });

		const titleText = scene.add.text(px + panelW / 2, py + 30, title, {
			fontFamily: FONT.display, fontSize: '21px', fontStyle: '800', color: UI.text,
			resolution: TEXT_RESOLUTION,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
		const titleUnderline = divider(scene, px + panelW / 2, py + 48, Math.min(panelW - 48, titleText.width + 120))
			.setScrollFactor(0).setDepth(DEPTH.modalContent);

		const closeText = scene.add.text(px + panelW - 22, py + 22, '✕', style(16, UI.textDim, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalBadge)
			.setInteractive({ useHandCursor: true });
		closeText.on('pointerdown', () => this.closeModal());
		closeText.on('pointerover', () => closeText.setColor(UI.goldText));
		closeText.on('pointerout', () => closeText.setColor(UI.textDim));

		const escHint = scene.add.text(px + panelW / 2, py + panelH - 16, 'ESC · 바깥 클릭으로 닫기', style(10, UI.textFaint, { bold: false }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);

		this.modalObjects.push(dim, g, swallow, titleText, titleUnderline, closeText, escHint);
		return { x: px, y: py + 52, w: panelW, h: panelH - 76 };
	}

	/** 레거시 빌더(uiObjects에 push하는)를 모달로 수집 — depth를 모달 밴드로 올린다 */
	collectIntoModal(builder: () => void) {
		const start = this.uiObjects.length;
		builder();
		const collected = this.uiObjects.splice(start);
		for (const object of collected) {
			const withDepth = object as unknown as { depth?: number; setDepth?: (depth: number) => void };
			if (typeof withDepth.setDepth === 'function' && typeof withDepth.depth === 'number') {
				withDepth.setDepth(withDepth.depth + MODAL_DEPTH_OFFSET);
			}
		}
		this.modalObjects.push(...collected);
	}

	// ---------------------------------------------------------------
	// 능력치 모달 — 스탯 강화 그리드
	// ---------------------------------------------------------------

	buildUpgradesModal() {
		const panelW = 920;
		const panelH = 596;
		const content = this.buildModalFrame('능력치 — 골드로 성장', panelW, panelH);

		const cols = 4;
		const gap = 9;
		const gridX = content.x + 28;
		const gridW = content.w - 56;
		const cardW = (gridW - gap * (cols - 1)) / cols;
		const statRows = Math.ceil(shopCatalog.stats.length / cols);
		const cardH = Math.min(104, (content.h - 46) / statRows - gap);

		this.collectIntoModal(() => {
			this.buildStatGrid(gridX, content.y + 8, cardW, cardH, gap, cols);
			this.buildRarityLegend(content.x + panelW / 2, content.y + 8 + statRows * (cardH + gap) + 10);
		});
	}

	// ---------------------------------------------------------------
	// 조합 모달 — 명시적 검 조합 (미보유 재료는 ???)
	// ---------------------------------------------------------------

	reforgeRowObjects: Phaser.GameObjects.GameObject[] = [];
	reforgeContentRect: { x: number; y: number; w: number; h: number } | null = null;
	/** 조합 목록 스크롤 오프셋(px) — 레시피가 패널보다 많아질 때 휠/버튼으로 이동 */
	reforgeScroll = 0;
	private reforgeWheelHandler: ((pointer: unknown, over: unknown, dx: number, dy: number) => void) | null = null;
	/** 조합 목록 클리핑 마스크 — 부분 노출 행이 패널 밖으로 튀어나오지 않게 자른다 */
	private reforgeMaskShape: Phaser.GameObjects.Graphics | null = null;
	private reforgeMask: Phaser.Display.Masks.GeometryMask | null = null;

	buildReforgeModal() {
		const panelW = 780;
		const panelH = 520;
		const content = this.buildModalFrame('검 조합 — 두 자루를 하나로', panelW, panelH);

		const scene = this.scene;
		const note = scene.add.text(content.x + panelW / 2, content.y + 2,
			'재료 두 자루(장착/보관함 어디든)를 모으면 조합할 수 있습니다. 레벨은 높은 쪽을 잇고, 각인은 절반만 이어집니다. (휠로 스크롤)',
			{ ...style(11.5, UI.textDim, { bold: false }), align: 'center', wordWrap: { width: panelW - 80 } })
			.setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.modalContent);
		this.modalObjects.push(note);

		this.reforgeContentRect = { x: content.x + 34, y: content.y + 40, w: panelW - 68, h: content.h - 40 };
		this.reforgeScroll = 0;
		this.reforgeMaskShape = scene.make.graphics();
		this.reforgeMask = this.reforgeMaskShape.createGeometryMask();
		this.updateReforgeMask();
		this.reforgeWheelHandler = (_pointer, _over, _dx, dy) => {
			if (this.modalKind !== 'reforge') {
				return;
			}
			this.scrollReforge(dy > 0 ? 124 : -124);
		};
		scene.input.on('wheel', this.reforgeWheelHandler);
		this.modalRefresh = () => this.rebuildReforgeRows();
		this.rebuildReforgeRows();
	}

	scrollReforge(deltaPx: number) {
		const rect = this.reforgeContentRect;
		const so = this.shop.swordOrbit;
		if (!rect || !so) {
			return;
		}
		const rowStride = 124; // rowH 108 + gap 16
		const totalH = so.getReforgeStates().length * rowStride;
		const maxScroll = Math.max(0, totalH - rect.h);
		const next = Phaser.Math.Clamp(this.reforgeScroll + deltaPx, 0, maxScroll);
		if (next !== this.reforgeScroll) {
			this.reforgeScroll = next;
			this.hideTooltip();
			this.rebuildReforgeRows();
		}
	}

	/** GeometryMask 는 월드 좌표로 렌더되므로 카메라 스크롤 + UI 스케일 보정 (invMask 와 동일 패턴) */
	updateReforgeMask() {
		const rect = this.reforgeContentRect;
		const shape = this.reforgeMaskShape;
		if (!rect || !shape) {
			return;
		}
		const camera = this.scene.cameras.main;
		const s = this.ui?.scale ?? 1;
		shape.clear();
		shape.fillStyle(0xffffff, 1);
		shape.fillRect(
			camera.scrollX + rect.x * s,
			camera.scrollY + (rect.y - 2) * s,
			rect.w * s,
			(rect.h + 4) * s,
		);
	}

	/** 포인터가 조합 목록 영역 안에 있는가 — 마스크로 가려진 부분의 유령 클릭/호버 방지 */
	private reforgePointerInside(pointer: Phaser.Input.Pointer): boolean {
		const rect = this.reforgeContentRect;
		if (!rect) {
			return false;
		}
		const py = this.toLocalY(pointer.y);
		return py >= rect.y && py <= rect.y + rect.h;
	}

	rebuildReforgeRows() {
		const rect = this.reforgeContentRect;
		const so = this.shop.swordOrbit;
		if (!rect || !so || this.modalKind !== 'reforge') {
			return;
		}
		for (const object of this.reforgeRowObjects) {
			object.destroy();
		}
		this.reforgeRowObjects = [];

		const scene = this.scene;
		this.updateReforgeMask();
		// 조합 가능 → 발견(레시피 공개) → 미발견 순으로 정렬. 같은 그룹 안에서는 원래 순서 유지.
		const states = [...so.getReforgeStates()].sort((a, b) =>
			(Number(b.ready) - Number(a.ready))
			|| (Number(b.discovered) - Number(a.discovered))
			|| (a.recipeIndex - b.recipeIndex));
		const rowH = 108;
		const rowGap = 16;
		const maxScroll = Math.max(0, states.length * (rowH + rowGap) - rect.h);
		this.reforgeScroll = Phaser.Math.Clamp(this.reforgeScroll, 0, maxScroll);

		// 스크롤 안내 화살표 (위/아래 더 있음 표시)
		if (this.reforgeScroll > 0) {
			const up = scene.add.text(rect.x + rect.w / 2, rect.y - 4, '▲', style(12, UI.goldText, { display: true }))
				.setOrigin(0.5, 1).setScrollFactor(0).setDepth(DEPTH.modalBadge);
			this.reforgeRowObjects.push(up);
		}
		if (this.reforgeScroll < maxScroll) {
			const down = scene.add.text(rect.x + rect.w / 2, rect.y + rect.h + 6, '▼', style(12, UI.goldText, { display: true }))
				.setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.modalBadge);
			this.reforgeRowObjects.push(down);
		}

		states.forEach((state, index) => {
			const y = rect.y + index * (rowH + rowGap) - this.reforgeScroll;
			// 화면 밖 행은 만들지 않는다 — 부분 노출 행은 만들되 마스크로 잘린다
			if (y + rowH <= rect.y - 2 || y >= rect.y + rect.h + 2) {
				return;
			}
			/** 행 오브젝트 등록 + 클리핑 마스크 적용 */
			const push = (...objects: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Mask)[]) => {
				for (const object of objects) {
					if (this.reforgeMask) {
						object.setMask(this.reforgeMask);
					}
					this.reforgeRowObjects.push(object);
				}
			};
			const rowBg = insetPanel(scene, rect.x, y, rect.w, rowH)
				.setScrollFactor(0).setDepth(DEPTH.modalPanel + 1);
			if (!state.ready) {
				rowBg.setTint(0x767e88);
			}
			push(rowBg);

			const cy = y + rowH / 2;
			const slotW = 150;

			/** 검 아이콘 호버 툴팁 — 마스크로 가려진 영역에서는 무시 */
			const addSwordTooltip = (cx: number, w: number, definition: SwordDefinition | null, revealed: boolean, suffix = '') => {
				const hit = scene.add.rectangle(cx, cy + 2, w, rowH - 12, 0x000000, 0.001)
					.setScrollFactor(0).setDepth(DEPTH.modalBadge)
					.setInteractive({ useHandCursor: false });
				hit.on('pointerover', (pointer: Phaser.Input.Pointer) => {
					if (!this.reforgePointerInside(pointer)) {
						return;
					}
					if (revealed && definition) {
						this.showTooltip(cx, y, `${definition.name}${suffix}`, this.describeSwordDefinition(definition));
					} else {
						this.showTooltip(cx, y, '???', '아직 발견하지 못한 검입니다.\n조합에 성공하면 도감에 기록됩니다.');
					}
				});
				hit.on('pointerout', () => this.hideTooltip());
				push(hit);
			};

			const drawIngredient = (cx: number, id: string, owned: boolean, level: number) => {
				const definition = so.getDefinitionById(id);
				// 발견한 레시피는 미보유 재료도 실루엣 대신 흐리게 공개
				const revealed = owned || state.discovered;
				const icon = scene.add.image(cx, cy - 12, 'sword', definition?.sheetOrder ?? 0)
					.setDisplaySize(44, 44).setScrollFactor(0).setDepth(DEPTH.modalContent);
				if (!owned) {
					if (revealed) {
						icon.setAlpha(0.45);
					} else {
						icon.setTintFill(0x151a20);
					}
				}
				const name = scene.add.text(cx, cy + 24, revealed ? (definition?.name ?? id) : '???',
					style(11.5, owned ? UI.text : UI.textFaint))
					.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
				const lv = scene.add.text(cx, cy + 40, owned ? `Lv.${level}` : (revealed ? '미보유' : ''),
					style(10, owned ? UI.textDim : UI.textFaint))
					.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
				push(icon, name, lv);
				addSwordTooltip(cx, slotW - 20, definition ?? null, revealed, owned ? '' : ' (미보유)');
			};

			drawIngredient(rect.x + slotW / 2 + 10, state.ingredients[0].id, state.ingredients[0].owned, state.ingredients[0].level);
			const plus = scene.add.text(rect.x + slotW + 30, cy, '+', style(20, UI.textDim, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
			drawIngredient(rect.x + slotW + 50 + slotW / 2, state.ingredients[1].id, state.ingredients[1].owned, state.ingredients[1].level);
			const eq = scene.add.text(rect.x + slotW * 2 + 80, cy, '➜', style(18, UI.goldText, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
			push(plus, eq);

			// 결과 — 조합 가능하거나 이미 발견한 레시피면 공개
			const resultX = rect.x + slotW * 2 + 110 + slotW / 2;
			const resultRevealed = (state.ready || state.discovered) && Boolean(state.resultDefinition);
			if (resultRevealed) {
				const definition = state.resultDefinition!;
				const icon = scene.add.image(resultX, cy - 12, 'sword', definition.sheetOrder ?? 0)
					.setDisplaySize(50, 50).setScrollFactor(0).setDepth(DEPTH.modalContent);
				if (definition.effect?.tint) {
					icon.setTint(Phaser.Display.Color.HexStringToColor(definition.effect.tint).color);
				}
				if (!state.ready) {
					icon.setAlpha(0.5);
				}
				const name = scene.add.text(resultX, cy + 26, definition.name,
					style(12, state.ready ? UI.goldText : UI.textDim))
					.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
				push(icon, name);
			} else {
				const icon = scene.add.image(resultX, cy - 12, 'sword', 0)
					.setDisplaySize(50, 50).setScrollFactor(0).setDepth(DEPTH.modalContent).setTintFill(0x151a20);
				const q = scene.add.text(resultX, cy - 12, '?', style(18, UI.textFaint, { display: true }))
					.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalBadge);
				const name = scene.add.text(resultX, cy + 26, '???', style(12, UI.textFaint))
					.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
				push(icon, q, name);
			}
			addSwordTooltip(resultX, slotW - 20, state.resultDefinition, resultRevealed,
				state.ready ? '' : ' (조합 결과)');

			// 조합 버튼
			const buttonW = 118;
			const buttonH2 = 40;
			const bx = rect.x + rect.w - buttonW / 2 - 18;
			const buttonG = scene.add.nineslice(bx, cy, state.ready ? 'uf-btn-3' : 'uf-btn-2', 0, buttonW / 2, buttonH2 / 2, 5, 5, 6, 7)
				.setScale(2).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalContent);
			if (!state.ready) {
				buttonG.setTint(0x8d97a2).setAlpha(0.85);
			}
			const drawButton = (hover: boolean) => {
				if (state.ready) {
					buttonG.setTexture(hover ? 'uf-btn-4' : 'uf-btn-3');
				}
			};
			const buttonText = scene.add.text(bx, cy, state.ready ? '조합하기' : '재료 부족', style(12.5, state.ready ? UI.goldText : UI.textFaint, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.modalBadge);
			const hit = scene.add.rectangle(bx, cy, buttonW, buttonH2, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.modalBadge)
				.setInteractive({ useHandCursor: state.ready });
			hit.on('pointerover', (pointer: Phaser.Input.Pointer) => {
				if (this.reforgePointerInside(pointer)) {
					drawButton(true);
				}
			});
			hit.on('pointerout', () => drawButton(false));
			hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
				if (state.ready && this.reforgePointerInside(pointer)) {
					this.shop.reforgeRecipe(state.recipeIndex);
				}
			});
			push(buttonG, buttonText, hit);
		});

		this.ui?.add(...this.reforgeRowObjects);
		this.ui?.sort();
	}

	// ---------------------------------------------------------------
	// 스탯 그리드 (능력치 모달 내부)
	// ---------------------------------------------------------------

	buildStatGrid(gridX: number, gridY: number, cardW: number, cardH: number, gap: number, cols: number) {
		const scene = this.scene;
		const shop = this.shop;
		this.statButtons = [];

		shopCatalog.stats.forEach((entry, index) => {
			const col = index % cols;
			const row = Math.floor(index / cols);
			const x = gridX + col * (cardW + gap);
			const y = gridY + row * (cardH + gap);

			const bg = insetPanel(scene, x, y, cardW, cardH).setScrollFactor(0).setDepth(DEPTH.panel);

			// 번호 뱃지
			const numberBadge = scene.add.text(x + 15, y + 14, `${index + 1}`, style(11, UI.textDim, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.badge);

			const name = scene.add.text(x + cardW / 2, y + 17, entry.name, style(13.5, UI.text))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);

			const icon = iconImage(scene, entry.icon, x + cardW / 2, y + cardH * 0.44, 22, UI.textDim);
			(icon as Phaser.GameObjects.Image).setScrollFactor?.(0);
			icon.setDepth(DEPTH.content);

			const valueText = scene.add.text(x + cardW / 2, y + cardH - 30, '', style(10.5, UI.green, { bold: false }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);

			const coinIcon = iconImage(scene, 'g-chip', x + cardW / 2 - 4, y + cardH - 13, 13, 0xd9a83c);
			(coinIcon as Phaser.GameObjects.Image).setScrollFactor?.(0);
			coinIcon.setDepth(DEPTH.content);
			const priceText = scene.add.text(x + cardW / 2 + 8, y + cardH - 13, '', style(12.5, UI.goldText, { display: true }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);

			const hit = scene.add.rectangle(x + cardW / 2, y + cardH / 2, cardW, cardH, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.badge)
				.setInteractive({ useHandCursor: true });

			const card: StatCardUi = {
				entry, bg, name, priceText, valueText, countText: numberBadge, coinIcon,
				x, y, w: cardW, h: cardH, index,
			};

			hit.on('pointerover', () => {
				this.drawStatCard(card, true);
				const count = shop.purchaseCounts[entry.id] ?? 0;
				this.showTooltip(x + cardW / 2, y, `${entry.name}${count > 0 ? `  (구매 ${count}회)` : ''}`, entry.desc);
			});
			hit.on('pointerout', () => {
				this.drawStatCard(card, false);
				this.hideTooltip();
			});
			hit.on('pointerdown', () => shop.buyStat(entry));

			this.uiObjects.push(bg, numberBadge, name, icon, valueText, coinIcon, priceText, hit);
			this.statButtons.push(card);
		});
	}

	drawStatCard(card: StatCardUi, hover: boolean) {
		const affordable = this.shop.getGold() >= this.shop.statPrice(card.entry);
		// 크림 인셋 카드: 호버=따뜻하게, 구매 불가=식은 회색
		if (hover) {
			card.bg.setTint(0x9fcfe8);
		} else if (!affordable) {
			card.bg.setTint(0x767e88);
		} else {
			card.bg.clearTint();
		}
		card.coinIcon.setX(card.x + card.w / 2 - 4 - card.priceText.width / 2);
		card.priceText.setX(card.x + card.w / 2 + 8 - card.priceText.width / 2);
	}

	buildRarityLegend(cx: number, y: number) {
		const scene = this.scene;
		const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
		const g = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.panel);
		const texts: Phaser.GameObjects.Text[] = [];
		let total = 0;
		for (const id of order) {
			const theme = RARITY_THEME[id];
			const text = scene.add.text(0, y, theme.name, style(11.5, theme.css))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			texts.push(text);
			total += text.width + 38;
		}
		let cursor = cx - (total - 38) / 2;
		order.forEach((id, index) => {
			const theme = RARITY_THEME[id];
			diamond(g, cursor - 2, y, 5, theme.num);
			texts[index].setX(cursor + 8);
			cursor += texts[index].width + 38;
		});
		this.uiObjects.push(g, ...texts);
	}

	// ---------------------------------------------------------------
	// 좌측 — 검 구매 목록 (교체 버튼)
	// ---------------------------------------------------------------

	buildRerollButton(rightEdge: number, y: number) {
		const scene = this.scene;
		const w = 96;
		const h = 30;
		const x = rightEdge - w;

		this.rerollG = scene.add.nineslice(x, y - h / 2, 'uf-btn-3', 0, w / 2, h / 2, 5, 5, 6, 7)
			.setScale(2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.panel);
		this.rerollCoin = iconImage(scene, 'g-chip', x + w - 12, y, 13, 0xd9a83c);
		(this.rerollCoin as Phaser.GameObjects.Image).setScrollFactor?.(0);
		this.rerollCoin.setDepth(DEPTH.content);
		const label = scene.add.text(x + 12, y, '교체', style(12, UI.text, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.rerollText = scene.add.text(x + w - 12, y, '', style(12.5, UI.goldText, { display: true }))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);

		const hit = scene.add.rectangle(x + w / 2, y, w, h, 0x000000, 0.001)
			.setScrollFactor(0).setDepth(DEPTH.badge)
			.setInteractive({ useHandCursor: true });
		hit.on('pointerdown', () => this.shop.reroll());
		hit.on('pointerover', () => {
			this.drawReroll(x, y, w, h, true);
			this.showTooltip(x + w / 2, y - 16, '상품 교체', '골드를 내고 검 상점의 목록을 새로 뽑습니다.');
		});
		hit.on('pointerout', () => {
			this.drawReroll(x, y, w, h, false);
			this.hideTooltip();
		});

		this.rerollRect = { x, y, w, h };
		this.drawReroll(x, y, w, h, false);
		this.uiObjects.push(this.rerollG, this.rerollCoin, this.rerollText, label, hit);
	}

	rerollRect: { x: number; y: number; w: number; h: number } | null = null;

	drawReroll(_x: number, _y: number, _w: number, _h: number, hover: boolean) {
		this.rerollG?.setTexture(hover ? 'uf-btn-4' : 'uf-btn-3');
		const priceW = this.rerollText?.width ?? 16;
		if (this.rerollCoin && this.rerollRect) {
			(this.rerollCoin as Phaser.GameObjects.Image).setX?.(this.rerollRect.x + this.rerollRect.w - 20 - priceW);
		}
	}

	// ---------------------------------------------------------------
	// 원소 필터 칩 (2026-09-02 → 09-03 보관함 전용) — 보관함 그리드 위에 놓인다
	// ---------------------------------------------------------------

	buildFilterChips(x: number, y: number, w: number, h: number) {
		this.filterRect = { x, y, w, h };
	}

	/** 필터 칩은 선택 상태가 바뀔 때마다 통째로 다시 그린다 (칩 10개 — 비용 무시 가능) */
	refreshFilterChips() {
		for (const object of this.filterObjects) {
			object.destroy();
		}
		this.filterObjects = [];

		const rect = this.filterRect;
		if (!rect) {
			return;
		}
		const scene = this.scene;
		const perRow = 5;
		const gap = 5;
		const chipW = (rect.w - gap * (perRow - 1)) / perRow;
		const chipH = 26;
		const rowGap = 6;

		// 별도 '원소 필터' 라벨은 두지 않는다 — 우측 폭이 좁아 제목 리본과 겹친다.
		// 대신 칩마다 호버 툴팁이 있고, 하단 가이드 바가 한 줄로 설명한다.
		ELEMENT_FILTERS.forEach((chip, index) => {
			const col = index % perRow;
			const row = Math.floor(index / perRow);
			const cx = rect.x + col * (chipW + gap);
			const cy = rect.y + row * (chipH + rowGap);
			const selected = this.elementFilter === chip.id;
			const theme = ELEMENT_THEME[chip.id];

			const bg = scene.add.image(cx + chipW / 2, cy + chipH / 2,
				selected ? 'uf-marker-orange' : 'uf-marker-gray')
				.setDisplaySize(chipW, chipH)
				.setScrollFactor(0).setDepth(DEPTH.panel);
			const text = scene.add.text(cx + chipW / 2, cy + chipH / 2, chip.label,
				style(10.5, selected ? UI.text : (theme?.css ?? UI.textDim), { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const hit = scene.add.rectangle(cx + chipW / 2, cy + chipH / 2, chipW, chipH, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.badge)
				.setInteractive({ useHandCursor: true });
			hit.on('pointerdown', () => this.setElementFilter(chip.id));
			hit.on('pointerover', () => {
				bg.setTexture(selected ? 'uf-marker-orange' : 'uf-marker-blue');
				this.showTooltip(cx + chipW / 2, cy, `${chip.label} 필터`,
					chip.id === 'all'
						? '보관함의 검을 전부 보여 줍니다.\n기본 표시는 등급별(신화→일반) 그룹입니다.'
						: `보관함에서 ${chip.label} 검만 골라 봅니다. (구매 목록에는 걸리지 않음)`);
			});
			hit.on('pointerout', () => {
				bg.setTexture(selected ? 'uf-marker-orange' : 'uf-marker-gray');
				this.hideTooltip();
			});

			this.ui?.add(bg, text, hit);
			this.filterObjects.push(bg, text, hit);
		});
		this.ui?.sort();
	}

	setElementFilter(id: string) {
		if (this.elementFilter === id) {
			return;
		}
		this.elementFilter = id;
		this.invScroll = 0;
		this.hideTooltip();
		this.scene.soundSystem?.play('click', { volume: 0.35 });
		this.shop.refresh();
	}

	/** 현재 원소 필터를 통과하는가 (보관함 전용 — 구매 목록에는 쓰지 않는다) */
	matchesFilter(definition: SwordDefinition | null | undefined): boolean {
		if (!definition) {
			return false;
		}
		if (this.elementFilter === 'all') {
			return true;
		}
		if (this.elementFilter === 'none') {
			return !definition.element;
		}
		return definition.element === this.elementFilter;
	}

	/** 등급 정렬 순위 (0 = 신화). 등급이 없으면 진화=전설, 그 외 일반 */
	rarityRank(definition: SwordDefinition | null | undefined): number {
		const rarity = definition?.rarity ?? (definition?.evolved ? 'legendary' : 'common');
		const index = RARITY_SECTION_ORDER.indexOf(rarity as typeof RARITY_SECTION_ORDER[number]);
		return index < 0 ? RARITY_SECTION_ORDER.length : index;
	}

	// ---------------------------------------------------------------
	// 좌측 — 검 구매 목록 (리롤한 순서 그대로 — 필터·등급 섹션은 보관함 전용)
	// ---------------------------------------------------------------

	buildOfferArea(x: number, y: number, w: number, h: number) {
		this.offerRect = { x, y, w, h };
		this.swordButtons = [];
	}

	/** 구매 목록을 다시 그린다. 리롤로 뽑힌 순서 그대로의 단순 목록이다. */
	rebuildOfferRows() {
		for (const object of this.offerRowObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.offerRowObjects = [];
		this.swordButtons = [];
		this.offerSections = [];

		const rect = this.offerRect;
		if (!rect) {
			return;
		}
		const scene = this.scene;
		const shop = this.shop;
		const gold = shop.getGold();

		const offers = shop.swordOffers;

		const add = (...objects: Phaser.GameObjects.GameObject[]) => {
			this.ui?.add(...objects);
			this.offerRowObjects.push(...objects);
		};

		if (offers.length === 0) {
			const empty = scene.add.text(rect.x + rect.w / 2, rect.y + 40,
				'오늘 물량은 매진입니다\n[교체]로 새 물건을 받아보세요',
				{ ...style(12, UI.textDim, { bold: false }), align: 'center', lineSpacing: 5 })
				.setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.content);
			add(empty);
			this.ui?.sort();
			return;
		}

		const gap = 7;
		const available = rect.h - (offers.length - 1) * gap;
		const rowH = Phaser.Math.Clamp(available / offers.length, 58, 104);

		let cursorY = rect.y;
		for (const offer of offers) {
			this.buildOfferRow(rect.x, cursorY, rect.w, rowH, offer, gold, add);
			cursorY += rowH + gap;
		}

		this.ui?.sort();
	}

	/** 구매 목록 한 행 — 아이콘 · 이름/등급 · 스탯 · 가격 (+ 각성 배지) */
	private buildOfferRow(
		x: number, y: number, w: number, rowH: number, offer: SwordDefinition, gold: number,
		add: (...objects: Phaser.GameObjects.GameObject[]) => void,
	) {
		const scene = this.scene;
		const shop = this.shop;
		const theme = this.rarityOfSword(offer);
		const owned = shop.getOwnedInfo(offer.id);
		const price = shop.swordPrice(offer, owned);
		const cy = y + rowH / 2;

		const bg = insetPanel(scene, x, y, w, rowH).setScrollFactor(0).setDepth(DEPTH.panel);
		const rarityStrip = scene.add.image(x + 4, y + 4, 'uf-fill-cream')
			.setOrigin(0, 0).setDisplaySize(4, rowH - 9).setTint(theme.num)
			.setScrollFactor(0).setDepth(DEPTH.panel);
		const iconBack = slot(scene, x + 34, cy, Math.min(52, rowH - 14), 'slate')
			.setScrollFactor(0).setDepth(DEPTH.panel);
		const specialDot = scene.add.image(x + w - 14, y + 12, 'uf-icon-point')
			.setDisplaySize(9, 7).setTint(UI.straw)
			.setScrollFactor(0).setDepth(DEPTH.badge).setVisible(Boolean(offer.special));

		const sprite = scene.add.image(x + 34, cy, 'sword', offer.sheetOrder ?? 0)
			.setDisplaySize(44, 44).setScrollFactor(0).setDepth(DEPTH.content);
		if (offer.effect?.tint) {
			sprite.setTint(Phaser.Display.Color.HexStringToColor(offer.effect.tint).color);
		}

		const nameText = scene.add.text(x + 64, y + 16, offer.name, style(13.5, theme.css))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const maxNameWidth = w - 130;
		if (nameText.width > maxNameWidth) {
			nameText.setScale(maxNameWidth / nameText.width);
		}
		const levelText = scene.add.text(x + w - 14, y + 16, owned ? `Lv.${owned.level} → ${owned.level + 1}` : '새 검',
			style(11, owned ? UI.green : UI.textDim))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);

		const elementTheme = offer.element ? ELEMENT_THEME[offer.element] : null;
		const elementText = scene.add.text(x + 64, y + 36,
			`${theme.name}${elementTheme ? ` · ${elementTheme.label}` : ' · 무속성'}`,
			style(11, elementTheme?.css ?? UI.textDim))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const statText = scene.add.text(x + 64, y + rowH - 18, `공격 ${offer.damage} · 쿨다운 ${offer.cooldownMs}ms`,
			style(11, UI.textDim, { bold: false }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);

		const priceText = scene.add.text(x + w - 14, y + rowH - 18, price.toLocaleString(),
			style(13.5, gold >= price ? UI.goldText : UI.textFaint, { display: true }))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const coinIcon = iconImage(scene, 'g-chip', x + w - 22 - priceText.width, y + rowH - 18, 13, 0xd9a83c);
		(coinIcon as Phaser.GameObjects.Image).setScrollFactor?.(0);
		coinIcon.setDepth(DEPTH.content);

		const hit = scene.add.rectangle(x + w / 2, cy, w, rowH, 0x000000, 0.001)
			.setScrollFactor(0).setDepth(DEPTH.badge)
			.setInteractive({ useHandCursor: true });

		const card: SwordOfferCardUi = {
			bg, rarityStrip, iconBack, specialDot, sprite, nameText, levelText, elementText, statText, priceText, coinIcon, hit,
			offer, x, y, w, h: rowH,
		};

		hit.on('pointerdown', () => shop.buySword(offer));
		hit.on('pointerover', () => {
			bg.setTint(0x9fcfe8);
			this.showTooltip(x + w / 2, y, offer.name, this.describeSwordDefinition(offer));
		});
		hit.on('pointerout', () => {
			bg.clearTint();
			this.hideTooltip();
		});

		add(bg, rarityStrip, iconBack, specialDot, sprite, nameText, levelText, elementText, statText, coinIcon, priceText, hit);

		// 각성 배지 — 이미 각성한 검이면 목록에서도 한눈에 보인다
		const awakening = awakeningOf(this.shop.swordOrbit, offer.id);
		if (awakening) {
			const badge = scene.add.text(x + 16, cy - 18, AWAKENING_BADGE, style(11, UI.goldTextBright, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.badge);
			add(badge);
		}

		this.swordButtons.push(card);
	}

	// ---------------------------------------------------------------
	// 중앙 — 원소 공명 칩 + 캐릭터/자리 방사형 배치
	// ---------------------------------------------------------------

	elementChipsRect: { x: number; y: number; w: number } | null = null;

	buildElementChips(x: number, y: number, w: number) {
		this.elementChipsRect = { x, y, w };
	}

	refreshElementChips() {
		for (const object of this.chipObjects) {
			object.destroy();
		}
		this.chipObjects = [];

		const rect = this.elementChipsRect;
		if (!rect) {
			return;
		}
		const scene = this.scene;
		const counts = this.shop.swordOrbit?.getElementCounts() ?? {};
		const elements = Object.keys(ELEMENT_LABELS);
		// 칩 폭 적응: 속성 수가 늘어 좁은 뷰포트에서 중앙 영역을 넘치지 않게 (1100폭 QA)
		const gap = elements.length > 6 ? 5 : 8;
		const chipW = Math.min(64, Math.floor((rect.w - (elements.length - 1) * gap) / elements.length));
		const chipFont = chipW < 56 ? 9.5 : 11;
		const chipPad = chipW < 56 ? 5 : 8;
		const chipH = 26;
		const total = elements.length * chipW + (elements.length - 1) * gap;
		const startX = rect.x + rect.w / 2 - total / 2;


		elements.forEach((element, index) => {
			const cx = startX + index * (chipW + gap);
			const count = counts[element] ?? 0;
			const resonating = count >= 2;
			const theme = ELEMENT_THEME[element];

			// 공명 중이면 주황 마커, 아니면 회색 마커 (Flat 팩)
			const chipBg = scene.add.image(cx + chipW / 2, rect.y + chipH / 2,
				resonating ? 'uf-marker-orange' : 'uf-marker-gray')
				.setDisplaySize(chipW, chipH)
				.setScrollFactor(0).setDepth(DEPTH.panel);
			this.ui?.add(chipBg);
			this.chipObjects.push(chipBg);

			const label = scene.add.text(cx + chipPad, rect.y + chipH / 2, `${theme?.label ?? element}`,
				style(chipFont, count > 0 ? (theme?.css ?? UI.text) : UI.textFaint))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const countText = scene.add.text(cx + chipW - chipPad, rect.y + chipH / 2, resonating ? `${count}★` : `${count}`,
				style(chipFont, count > 0 ? UI.text : UI.textFaint, { display: true }))
				.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			this.ui?.add(label, countText);
			this.chipObjects.push(label, countText);
		});

		// 공명 안내 (활성 시 강조)
		const anyResonance = elements.some((element) => (counts[element] ?? 0) >= 2);
		const note = scene.add.text(rect.x + rect.w / 2, rect.y + chipH + 13,
			anyResonance ? '공명 발동 중 — 같은 속성 효과 1.5배!' : '같은 속성 검 2자루를 장착하면 공명 (효과 1.5배)',
			style(10.5, anyResonance ? UI.goldText : UI.textFaint, { bold: false }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.ui?.add(note);
		this.chipObjects.push(note);
		this.ui?.sort();
	}

	slotsGeom: { cx: number; cy: number; size: number } | null = null;

	/** 자리 배치 좌표 — 안쪽 궤도 3개 + 바깥 궤도 4개 (게임 내 이중 궤도와 동일 콘셉트) */
	slotPositions(cx: number, cy: number): Array<{ x: number; y: number }> {
		const so = this.shop.swordOrbit;
		const maxSwords = so?.maxSwords ?? 7;
		const innerCount = Math.min(so?.innerRingSlots ?? 3, maxSwords);
		const outerCount = Math.max(0, maxSwords - innerCount);
		const innerR = 100;
		const outerR = 178;

		const positions: Array<{ x: number; y: number }> = [];
		for (let i = 0; i < innerCount; i += 1) {
			const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, innerCount);
			positions.push({ x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR });
		}
		for (let i = 0; i < outerCount; i += 1) {
			const angle = -Math.PI / 2 + Math.PI / Math.max(1, outerCount) + (i * Math.PI * 2) / Math.max(1, outerCount);
			positions.push({ x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR });
		}
		return positions;
	}

	buildEquipArea(cx: number, cy: number, areaW: number) {
		const scene = this.scene;
		const shop = this.shop;
		const so = shop.swordOrbit;
		const size = 62;

		// 궤도 가이드 원 (안쪽/바깥 — 바깥은 반대로 돈다)
		const ringG = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.panel);
		for (const [radius, alpha] of [[100, 0.5], [178, 0.35]] as Array<[number, number]>) {
			ringG.lineStyle(1.2, UI.steel, alpha);
			// 점선 원 근사
			const steps = 60;
			for (let i = 0; i < steps; i += 2) {
				const a0 = (i / steps) * Math.PI * 2;
				const a1 = ((i + 1) / steps) * Math.PI * 2;
				ringG.beginPath();
				ringG.arc(cx, cy, radius, a0, a1);
				ringG.strokePath();
			}
		}
		const ringNote = scene.add.text(cx, cy + 178 + 42, '안쪽 궤도 3자리 · 바깥 궤도 4자리 (반대 방향 회전)',
			style(10.5, UI.textFaint, { bold: false }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.uiObjects.push(ringG, ringNote);

		// 중앙 캐릭터
		const config = (this.scene as unknown as { playerConfig?: { spritesheets?: { idle?: { textureKey?: string; frameStart?: number } }; tint?: string; portraitScale?: number } }).playerConfig;
		const textureKey = config?.spritesheets?.idle?.textureKey;
		if (textureKey && scene.textures.exists(textureKey)) {
			const portraitSize = 132 * (config?.portraitScale ?? 1);
			const charImage = scene.add.image(cx, cy, textureKey, config?.spritesheets?.idle?.frameStart ?? 0)
				.setDisplaySize(portraitSize, portraitSize).setScrollFactor(0).setDepth(DEPTH.content);
			if (config?.tint) {
				charImage.setTint(Phaser.Display.Color.HexStringToColor(config.tint).color);
			}
			this.uiObjects.push(charImage);
		} else {
			const fallback = scene.add.circle(cx, cy, 34, 0x1b2026).setStrokeStyle(2, UI.goldDim)
				.setScrollFactor(0).setDepth(DEPTH.content);
			this.uiObjects.push(fallback);
		}

		// 자리 버튼들
		this.slotButtons = [];
		const positions = this.slotPositions(cx, cy);
		const count = so?.maxSwords ?? 7;

		for (let i = 0; i < count; i += 1) {
			const pos = positions[i] ?? { x: cx, y: cy };
			const sx = pos.x - size / 2;
			const sy = pos.y - size / 2;

			// Flat 팩 슬롯 프레임 (상태는 텍스처 스왑, 선택/속성은 셀렉트 코너)
			const img = scene.add.image(pos.x, pos.y, 'uf-slot-gray')
				.setDisplaySize(size, size).setScrollFactor(0).setDepth(DEPTH.panel);
			const sel = selectFrame(scene, pos.x, pos.y, size + 10, size + 10)
				.setScrollFactor(0).setDepth(DEPTH.panel + 0.5).setVisible(false);

			const numberText = scene.add.text(sx + 12, sy + 11, `${i + 1}`, style(10, UI.text, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.badge);

			// 빈 칸 클릭/툴팁용 히트 영역 — 반드시 검 아이콘보다 **아래**에 깔린다.
			// (아이콘 위를 덮으면 topOnly 입력이 히트 영역에 먹혀 드래그가 시작되지 않는다)
			const hit = scene.add.rectangle(pos.x, pos.y, size, size, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.panel + 0.8)
				.setInteractive({ useHandCursor: true });
			hit.on('pointerdown', () => shop.handleSlotClick(i));
			hit.on('pointerover', () => {
				const info = this.getSlotInfoContent(i);
				this.showTooltip(pos.x, sy, info.title, info.body);
			});
			hit.on('pointerout', () => this.hideTooltip());

			const icon = scene.add.image(pos.x, pos.y - 4, 'sword', 0)
				.setDisplaySize(size * 0.52, size * 0.52).setScrollFactor(0).setDepth(DEPTH.content).setVisible(false);
			icon.setInteractive({ useHandCursor: true });
			scene.input.setDraggable(icon);
			icon.setData('shopDragType', 'slot');
			icon.setData('shopDragIndex', i);
			// 주의: pointerdown 선택은 금물 — handleSlotClick→refresh()가 이 아이콘을
			// 파괴해 드래그가 시작도 못 한다 (보관함 아이콘과 같은 규칙).
			// 드래그가 아니었을 때만 pointerup에서 선택한다.
			icon.on('pointerup', () => {
				if (!icon.getData('wasDragged')) {
					shop.handleSlotClick(i);
				}
			});
			icon.on('pointerover', () => {
				const info = this.getSlotInfoContent(i);
				this.showTooltip(pos.x, sy, info.title, info.body);
			});
			icon.on('pointerout', () => this.hideTooltip());

			const levelText = scene.add.text(pos.x, sy + size - 19, '', style(10.5, UI.text, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const enhText = scene.add.text(pos.x, sy + size - 8, '', style(9.5, UI.goldText))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const actionText = scene.add.text(pos.x, pos.y + 8, '', {
				...style(9.5, UI.goldText), align: 'center',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const lockText = scene.add.text(pos.x, pos.y - 4, '잠김', style(11, UI.textFaint))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content).setVisible(false);
			// 각성 배지 — 각성한 검이 꽂힌 자리에만 보인다 (refreshSlotPanel 이 켠다)
			const awakenBadge = scene.add.text(sx + size - 10, sy + 10, AWAKENING_BADGE,
				style(11, UI.goldTextBright, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.badge).setVisible(false);

			this.uiObjects.push(img, sel, numberText, icon, levelText, enhText, actionText, lockText, awakenBadge, hit);
			this.slotButtons.push({
				x: pos.x, y: pos.y, img, sel, hit, icon, numberText, levelText, enhText, actionText, lockText, awakenBadge, size,
			});
		}

		this.slotsGeom = { cx, cy, size };
	}

	drawSlot(index: number, state: 'equipped' | 'empty' | 'unlockable' | 'locked', selected: boolean, elementColor: number | null) {
		const slot = this.slotButtons[index];
		if (!slot) return;

		// Flat 팩 슬롯 상태 = 텍스처 스왑 (잠김=고스트 / 해금 가능=슬레이트 / 그 외=회색)
		if (state === 'locked') {
			slot.img.setTexture('uf-slot-ghost').setAlpha(0.95);
		} else if (state === 'unlockable') {
			slot.img.setTexture('uf-slot-slate').setAlpha(1);
		} else {
			slot.img.setTexture('uf-slot-gray').setAlpha(state === 'empty' ? 0.92 : 1);
		}

		// 선택 = 파랑 셀렉트 코너, 장착(속성) = 속성색 코너
		if (selected) {
			slot.sel.setVisible(true).setTint(UI.quenchBright);
		} else if (state === 'equipped' && elementColor !== null) {
			slot.sel.setVisible(true).setTint(elementColor);
		} else {
			slot.sel.setVisible(false);
		}
	}

	// ---------------------------------------------------------------
	// 중앙 하단 — 선택한 자리 액션 (강화 / 각인 / 보장석)
	// ---------------------------------------------------------------

	buildActionRow(cx: number, y: number, w: number) {
		const scene = this.scene;
		const shop = this.shop;

		const specs: Array<{ title: string; onClick: () => void }> = [
			{
				title: '강화',
				onClick: () => {
					if (shop.selectedSlot === null) {
						scene.soundSystem?.play('hurt', { volume: 0.2 });
						return;
					}
					shop.enhanceSlot(shop.selectedSlot, shop.useGuarantee);
				},
			},
			{
				title: '각인',
				onClick: () => {
					if (shop.selectedSlot === null) {
						scene.soundSystem?.play('hurt', { volume: 0.2 });
						return;
					}
					shop.pullTraitFor(shop.selectedSlot);
				},
			},
			{
				title: '보장석',
				onClick: () => {
					shop.useGuarantee = !shop.useGuarantee;
					scene.soundSystem?.play('click', { volume: 0.4 });
					shop.refresh();
				},
			},
		];

		const gap = 10;
		const buttonW = (w - gap * (specs.length - 1)) / specs.length;
		const buttonH = 58;
		const x0 = cx - w / 2;

		this.actionButtons = [];
		specs.forEach((spec, index) => {
			const bx = x0 + index * (buttonW + gap);
			const bg = scene.add.nineslice(bx, y, 'uf-btn-3', 0, buttonW / 2, buttonH / 2, 5, 5, 6, 7)
				.setScale(2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.panel);
			const title = scene.add.text(bx + 14, y + 15, spec.title, style(13.5, UI.text, { display: true }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const sub = scene.add.text(bx + 14, y + buttonH - 16, '', style(9.5, UI.textDim, { bold: false }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const costText = scene.add.text(bx + buttonW - 12, y + 15, '', style(12.5, UI.goldText, { display: true }))
				.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const hit = scene.add.rectangle(bx + buttonW / 2, y + buttonH / 2, buttonW, buttonH, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.badge)
				.setInteractive({ useHandCursor: true });

			const card: ActionButtonUi = { bg, title, sub, costText, hit, x: bx, y, w: buttonW, h: buttonH };
			hit.on('pointerdown', spec.onClick);
			hit.on('pointerover', () => this.drawActionButton(card, true, index));
			hit.on('pointerout', () => this.drawActionButton(card, false, index));

			this.uiObjects.push(bg, title, sub, costText, hit);
			this.actionButtons.push(card);
		});

		this.selectHint = scene.add.text(cx, y + buttonH + 14, '', style(10.5, UI.textFaint, { bold: false }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.uiObjects.push(this.selectHint);
	}

	drawActionButton(card: ActionButtonUi, hover: boolean, index: number) {
		const enabled = index === 2 || this.shop.selectedSlot !== null;
		card.bg.setTexture(!enabled ? 'uf-btn-2' : hover ? 'uf-btn-4' : 'uf-btn-3');
		if (enabled) {
			card.bg.clearTint();
			card.bg.setAlpha(1);
		} else {
			card.bg.setTint(0xb9c1cc);
			card.bg.setAlpha(0.85);
		}
		card.title.setAlpha(enabled ? 1 : 0.55);
	}

	// ---------------------------------------------------------------
	// 우측 — 보관함 그리드 + 장착/판매 버튼 + 검 정보
	// ---------------------------------------------------------------

	buildInventoryColumn(x: number, y: number, w: number, h: number) {
		const scene = this.scene;

		// 타이틀
		this.sectionTitle(x + w / 2, y - 20, '보관함', w / 2 - 50);
		this.invCountText = scene.add.text(x + w, y - 20, '', style(11, UI.textDim))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		this.uiObjects.push(this.invCountText);

		// 원소 필터 칩 — 보관함 전용이므로 그리드 바로 위에 놓는다 (2행 × 5칩)
		const chipsH = 58;
		this.buildFilterChips(x, y, w, chipsH);
		const gridY = y + chipsH + 8;

		// 그리드 (메이플식 인벤토리) — 등급순 모드에서는 섹션 헤더가 줄을 나누므로
		// 셀 프레임은 refreshInventory가 실제 배치에 맞춰 그때그때 그린다.
		// 필터 칩이 위에 들어오면서 보이는 행은 4→3 (스크롤은 그대로) — 검 정보 패널 높이 보전.
		const cols = 5;
		const rows = 3;
		const gap = 4;
		const cell = Math.floor((w - gap * (cols - 1)) / cols);
		const gridH = rows * cell + (rows - 1) * gap;
		this.invGrid = { x, y: gridY, cols, rows, cell, gap };
		this.invStripRect = { x, y: gridY, w: cols * cell + (cols - 1) * gap, h: gridH };

		const gridBg = panel(scene, x - 6, gridY - 6, this.invStripRect.w + 12, gridH + 12)
			.setScrollFactor(0).setDepth(DEPTH.panel);
		this.uiObjects.push(gridBg);

		this.invPageText = scene.add.text(x + this.invStripRect.w, gridY + gridH + 10, '', style(10, UI.textFaint))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.badge);
		this.uiObjects.push(this.invPageText);

		// 정렬 토글 — 기본은 등급순(등급별 그룹), 직접 맞춘 배치를 쓰고 싶으면 '내 순서'
		this.invSortText = scene.add.text(x + 4, gridY + gridH + 10, '', style(10, UI.goldText, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.badge);
		const sortHit = scene.add.rectangle(x + 52, gridY + gridH + 10, 104, 20, 0x000000, 0.001)
			.setScrollFactor(0).setDepth(DEPTH.badge)
			.setInteractive({ useHandCursor: true });
		sortHit.on('pointerdown', () => {
			this.invSort = this.invSort === 'rarity' ? 'manual' : 'rarity';
			this.invScroll = 0;
			scene.soundSystem?.play('click', { volume: 0.35 });
			this.shop.refresh();
		});
		sortHit.on('pointerover', () => this.showTooltip(x + 52, gridY + gridH - 4, '보관함 정렬',
			'등급순 — 신화→일반 섹션으로 줄을 나눠 보여 줍니다 (기본)\n내 순서 — 드래그로 직접 맞춘 순서를 그대로 씁니다'));
		sortHit.on('pointerout', () => this.hideTooltip());
		this.uiObjects.push(this.invSortText, sortHit);

		// 마스크 (GeometryMask 는 월드 좌표로 렌더되므로 카메라 스크롤 + UI 스케일 보정이 필요하다)
		this.invMaskShape = scene.make.graphics();
		this.invMask = this.invMaskShape!.createGeometryMask();
		this.updateInvMask();

		this.reserveIcons = [];
		this.invScroll = 0;

		this.onWheel = (pointer, _gameObjects, _deltaX, deltaY) => {
			const rect = this.invStripRect!;
			const px = this.toLocalX(pointer.x);
			const py = this.toLocalY(pointer.y);
			if (py >= rect.y - 12 && py <= rect.y + rect.h + 12
				&& px >= rect.x - 12 && px <= rect.x + rect.w + 12) {
				const grid = this.invGrid!;
				this.scrollInventory(deltaY > 0 ? grid.cell + grid.gap : -(grid.cell + grid.gap));
			}
		};
		scene.input.on('wheel', this.onWheel);

		// 장착 / 판매 버튼 (판매 버튼은 드래그 드롭 영역 겸용)
		const buttonY = gridY + gridH + 24;
		const buttonH = 40;
		const buttonGap = 10;
		const buttonW = (w - buttonGap) / 2;
		this.reserveButtons = [];

		const makeButton = (bx: number, label: string, onClick: () => void) => {
			const bg = scene.add.nineslice(bx, buttonY, 'uf-btn-3', 0, buttonW / 2, buttonH / 2, 5, 5, 6, 7)
				.setScale(2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.panel);
			const title = scene.add.text(bx + 14, buttonY + buttonH / 2, label, style(13, UI.text, { display: true }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const sub = scene.add.text(bx + buttonW - 12, buttonY + buttonH / 2 + 12, '', style(9, UI.textFaint, { bold: false }))
				.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content).setVisible(false);
			const costText = scene.add.text(bx + buttonW - 12, buttonY + buttonH / 2, '', style(12, UI.goldText, { display: true }))
				.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const hit = scene.add.rectangle(bx + buttonW / 2, buttonY + buttonH / 2, buttonW, buttonH, 0x000000, 0.001)
				.setScrollFactor(0).setDepth(DEPTH.badge)
				.setInteractive({ useHandCursor: true });
			const card: ActionButtonUi = { bg, title, sub, costText, hit, x: bx, y: buttonY, w: buttonW, h: buttonH };
			hit.on('pointerdown', onClick);
			hit.on('pointerover', () => this.drawReserveButton(card, true));
			hit.on('pointerout', () => this.drawReserveButton(card, false));
			this.uiObjects.push(bg, title, sub, costText, hit);
			this.reserveButtons.push(card);
			return card;
		};

		makeButton(x, '장착하기', () => this.shop.equipSelectedReserve());
		const sellButton = makeButton(x + buttonW + buttonGap, '판매', () => {
			if (this.shop.selectedReserve !== null) {
				this.shop.sellReserve(this.shop.selectedReserve);
				this.shop.selectedReserve = null;
			} else if (this.shop.selectedSlot !== null) {
				this.shop.sellEquipped(this.shop.selectedSlot);
			} else {
				this.scene.soundSystem?.play('hurt', { volume: 0.2 });
			}
		});
		this.sellRect = { x: sellButton.x, y: sellButton.y, w: sellButton.w, h: sellButton.h };

		// 검 정보 패널
		const detailY = buttonY + buttonH + 20;
		const detailH = y + h - detailY;
		this.detailRect = { x, y: detailY, w, h: detailH };
		this.detailBg = panel(scene, x - 6, detailY, w + 12, detailH)
			.setScrollFactor(0).setDepth(DEPTH.panel);
		this.uiObjects.push(this.detailBg);
	}

	drawReserveButton(card: ActionButtonUi, hover: boolean) {
		card.bg.setTexture(hover ? 'uf-btn-4' : 'uf-btn-3');
	}

	// ---------------------------------------------------------------
	// 하단 가이드 바
	// ---------------------------------------------------------------

	buildBottomBar(margin: number, y: number, width: number) {
		const scene = this.scene;
		const g = divider(scene, width / 2, y - 24, width - margin * 2, UI.panelDark)
			.setScrollFactor(0).setDepth(DEPTH.panel);

		const guideLabel = scene.add.text(margin + 6, y, '드래그로 이동', style(11.5, UI.goldTextBright, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);

		let cursor = margin + guideLabel.width + 24;
		const items: Array<string> = [
			'보관함 → 자리: 장착',
			'검끼리 겹치기: 위치 교환',
			'자리 → 보관함: 해제',
			'판매 버튼에 놓기: 판매',
			'원소 칩: 보관함 필터',
			'보관함: 등급별 그룹 표시',
		];
		const objects: Phaser.GameObjects.GameObject[] = [g, guideLabel];
		for (const text of items) {
			const dot = scene.add.image(cursor + 4, y, 'uf-icon-point').setDisplaySize(7, 5).setTint(0x8f98ae)
				.setScrollFactor(0).setDepth(DEPTH.content);
			objects.push(dot);
			const labelText = scene.add.text(cursor + 14, y, text, style(11, '#c3ccd3', { bold: false }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			cursor += 14 + labelText.width + 24;
			objects.push(labelText);
		}

		// 우측: SPACE 출발
		const spaceText = scene.add.text(width - margin - 6, y, '마을로 돌아가기', style(11, UI.textDim))
			.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		const spaceCap2 = keycap(scene, spaceText.x - spaceText.width - 32, y, 'SPACE', 10)
			.setScrollFactor(0).setDepth(DEPTH.content);
		objects.push(spaceText, spaceCap2);

		this.uiObjects.push(...objects);
	}

	// ---------------------------------------------------------------
	// Info helpers
	// ---------------------------------------------------------------

	/**
	 * definition 이 조합으로 만드는 검이면 조합식 문자열('재료A + 재료B').
	 * 아직 발견하지 못한 레시피는 '???' — 조합에 성공하면 영구 공개된다.
	 */
	recipeTextFor(definition: SwordDefinition | null | undefined): string | null {
		const so = this.shop.swordOrbit;
		if (!definition || !so) {
			return null;
		}
		const recipe = so.evolutionRecipes.find((entry) => entry.result === definition.id);
		if (!recipe) {
			return null;
		}
		if (!MetaProgression.isRecipeDiscovered(definition.id)) {
			return '??? (조합으로 획득)';
		}
		return recipe.ingredients
			.map((id) => so.getDefinitionById(id)?.name ?? id)
			.join(' + ');
	}

	describeSwordDefinition(
		definition: SwordDefinition,
		sword: Pick<SwordSprite, 'damage' | 'scanInterval' | 'hitsPerLaunch'> | null = null,
	): string {
		// 공용 문자열 모듈이 스탯·속성·거동·각성 줄을 만든다 (각성 표기 누락 방지)
		const lines = describeSwordLines(definition, {
			sword,
			orbit: this.shop.swordOrbit,
			includeTraits: false,
		});

		const recipeText = this.recipeTextFor(definition);
		if (recipeText) {
			lines.push(`조합식: ${recipeText}`);
		}
		if (definition.lore) {
			lines.push(`— ${definition.lore}`);
		}

		return lines.join('\n');
	}

	getSlotInfoContent(slotIndex: number): { title: string; body: string } {
		const so = this.shop.swordOrbit!;
		const sword = so.swords[slotIndex] ?? null;
		const state = so.getSlotState(slotIndex)!;
		const ringLabel = slotIndex < (so.innerRingSlots ?? 3) ? '안쪽 궤도' : '바깥 궤도';

		if (slotIndex >= so.unlockedSlots) {
			const isNext = slotIndex === so.unlockedSlots;
			if (isNext && !so.canUnlockSlotAt(this.shop.round)) {
				return {
					title: `자리 ${slotIndex + 1} (잠김)`,
					body: `라운드 ${so.nextSlotUnlockRound()}을 완료하면 ${so.nextSlotUnlockCost().toLocaleString()} 골드로 열 수 있습니다`,
				};
			}
			return { title: `자리 ${slotIndex + 1} (잠김)`, body: '클릭해서 열면 검을 하나 더 장착할 수 있습니다' };
		}

		if (!sword) {
			return {
				title: `자리 ${slotIndex + 1} (비어 있음) — ${ringLabel}`,
				body: `자리 강화 +${state.enhance}\n상점에서 새 검을 사면 이 자리에 장착됩니다\n보관함에서 드래그해 장착할 수도 있습니다`,
			};
		}

		const lines = [this.describeSwordDefinition(sword.definition, sword)];
		lines.push(`자리 강화 +${state.enhance} (피해 +${Math.round(state.enhance * 4)}%)`);

		const traits = (sword as OrbitSword).traits ?? [];
		if (traits.length > 0) {
			const traitLines = traits.map((id: string) => {
				const trait = so.getTraitById(id);
				const synergy = trait?.element && trait.element === sword.definition?.element;
				return `${trait?.name}${synergy ? ' (속성 일치 2배)' : ''}`;
			});
			lines.push(`각인: ${traitLines.join(', ')}`);
		}

		lines.push('클릭: 선택 (강화/각인/판매)  ·  드래그: 이동/교환');

		const awakening = awakeningOf(so, sword.definition?.id);
		return {
			title: `${awakening ? `${AWAKENING_BADGE} ` : ''}${sword.definition.name}  Lv${sword.level} — ${ringLabel}`,
			body: lines.join('\n'),
		};
	}

	// ---------------------------------------------------------------
	// Refresh
	// ---------------------------------------------------------------

	refresh() {
		const shop = this.shop;
		const gold = shop.getGold();
		this.goldText!.setText(gold.toLocaleString());

		// 스탯 카드 (능력치 모달)
		for (const card of this.statButtons) {
			const count = shop.purchaseCounts[card.entry.id] ?? 0;
			const price = shop.statPrice(card.entry);
			card.name.setText(`${card.entry.name}${count > 0 ? ` ×${count}` : ''}`);
			card.valueText.setText(card.entry.desc.split('(')[0].trim());
			card.priceText.setText(price.toLocaleString()).setColor(gold >= price ? UI.goldText : UI.textFaint);
			this.drawStatCard(card, false);
		}

		// 검 구매 목록 — 구매/리롤에 따라 통째로 다시 그린다 (필터 없음)
		// 원소 필터 칩은 보관함 위에 있다 (보관함 전용)
		this.refreshFilterChips();
		this.rebuildOfferRows();

		// 리롤
		if (this.rerollText && this.rerollRect) {
			const price = shop.rerollPrice();
			this.rerollText.setText(`${price}`).setColor(gold >= price ? UI.goldText : UI.textFaint);
			this.drawReroll(this.rerollRect.x, this.rerollRect.y, this.rerollRect.w, this.rerollRect.h, false);
		}

		this.refreshElementChips();
		this.refreshSlotPanel(gold);
		this.refreshInventory();
		this.refreshReserveButtons(gold);
		this.refreshDetail();
		this.refreshNavButtons();
		this.modalRefresh?.();
	}

	// 보관함 스크롤 (세로, 픽셀 단위, 클램프)
	scrollInventory(delta: number) {
		const grid = this.invGrid;
		const so = this.shop.swordOrbit;
		if (!grid || !so) {
			return;
		}
		// invTotalH 는 섹션 헤더 높이를 포함한다 (refreshInventory/computeInventoryLayout이 갱신)
		if (this.invView.length !== this.invCellPos.length || (this.invTotalH === 0 && so.reserve.length > 0)) {
			this.computeInventoryLayout();
		}
		const maxScroll = Math.max(0, this.invTotalH - (this.invStripRect?.h ?? 0));
		const next = Phaser.Math.Clamp(this.invScroll + delta, 0, maxScroll);

		if (next !== this.invScroll) {
			this.invScroll = next;
			this.shop.scene.soundSystem?.play('click', { volume: 0.2 });
			this.refreshInventory();
		}
	}

	/**
	 * 보관함 클리핑 마스크 갱신.
	 * scrollFactor(0) UI 라도 마스크 그래픽은 월드 좌표에 그려야 하므로
	 * 카메라 스크롤을 더하고, 루트 컨테이너 스케일도 함께 반영한다.
	 */
	updateInvMask() {
		const rect = this.invStripRect;
		const shape = this.invMaskShape;
		if (!rect || !shape) {
			return;
		}
		const camera = this.scene.cameras.main;
		const s = this.ui?.scale ?? 1;
		shape.clear();
		shape.fillStyle(0xffffff, 1);
		shape.fillRect(
			camera.scrollX + rect.x * s,
			camera.scrollY + rect.y * s,
			rect.w * s,
			rect.h * s,
		);
	}

	refreshInventory() {
		this.updateInvMask();

		for (const object of this.reserveIcons ?? []) {
			object.destroy();
		}
		this.reserveIcons = [];

		const scene = this.scene;
		const so = this.shop.swordOrbit;
		const grid = this.invGrid;
		if (!so || !grid) {
			return;
		}

		// 표시 순서 = 원소 필터 통과분을 등급 섹션(신화→일반)으로 묶은 것 (기본).
		// '내 순서' 모드에서는 직접 정렬한 배열 순서를 그대로 쓴다.
		this.computeInventoryLayout();
		const shown = this.invView.length;
		const filtered = this.elementFilter !== 'all';
		this.invCountText?.setText(filtered ? `${shown} / ${so.reserve.length}자루` : `${so.reserve.length}자루`);
		this.invSortText?.setText(this.invSort === 'rarity' ? '정렬: 등급순 ▸' : '정렬: 내 순서 ▸');

		const rect = this.invStripRect!;
		const stride = grid.cell + grid.gap;
		const maxScroll = Math.max(0, this.invTotalH - rect.h);
		this.invScroll = Phaser.Math.Clamp(this.invScroll, 0, maxScroll);

		/** 실제 배치에 맞춘 셀 프레임 (등급 섹션이 줄을 나누므로 고정 그리드는 못 쓴다) */
		const drawCellFrame = (cellX: number, cellY: number, alpha: number) => {
			if (cellY + grid.cell < grid.y - 6 || cellY > grid.y + rect.h + 6) {
				return;
			}
			const frame = slot(scene, cellX + grid.cell / 2, cellY + grid.cell / 2, grid.cell, 'slate')
				.setScrollFactor(0).setDepth(DEPTH.panel).setAlpha(alpha).setMask(this.invMask!);
			this.ui?.add(frame);
			this.reserveIcons.push(frame);
		};
		/** 콘텐츠 끝 이후 보이는 영역을 빈 칸 프레임으로 채운다 (드롭 안내용) */
		const fillEmptyFrames = () => {
			let col = 0;
			let yOff = 0;
			if (this.invCellPos.length > 0) {
				const last = this.invCellPos[this.invCellPos.length - 1];
				col = Math.round((last.x - grid.x) / stride) + 1;
				yOff = last.y;
			}
			let safety = 60;
			while (yOff < this.invScroll + rect.h && safety > 0) {
				safety -= 1;
				if (col >= grid.cols) {
					col = 0;
					yOff += stride;
					continue;
				}
				drawCellFrame(grid.x + col * stride, grid.y + yOff - this.invScroll, 0.5);
				col += 1;
			}
		};

		if (shown === 0) {
			fillEmptyFrames();
			this.invPageText?.setText('');
			const empty = scene.add.text(grid.x + rect.w / 2, grid.y + rect.h / 2,
				so.reserve.length === 0
					? '비어 있습니다\n상점에서 산 검이 자리가 없으면\n여기에 보관됩니다'
					: '이 원소의 검이 보관함에 없습니다\n[전체] 필터로 돌아가 보세요', {
					...style(11, UI.text, { bold: false }), align: 'center', lineSpacing: 4,
				})
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			empty.setShadow(0, 1, '#000000', 3, false, true);
			this.ui?.add(empty);
			this.reserveIcons.push(empty);
			this.ui?.sort();
			return;
		}

		this.invPageText?.setText(maxScroll > 0 ? '휠로 스크롤' : '');

		// 등급 섹션 헤더 — 줄 나누기 (등급순 모드에서만 존재)
		for (const header of this.invHeaders) {
			const hy = grid.y + header.y - this.invScroll;
			if (hy + 16 < grid.y - 6 || hy > grid.y + rect.h + 6) {
				continue;
			}
			const label = scene.add.text(grid.x + 2, hy + 8, `◆ ${header.label}`,
				style(9.5, header.css, { display: true }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content).setMask(this.invMask!);
			const rule = divider(scene, grid.x + rect.w / 2 + label.width / 2 + 6, hy + 8,
				Math.max(10, rect.w - label.width - 14), UI.panelDark)
				.setScrollFactor(0).setDepth(DEPTH.panel).setMask(this.invMask!);
			this.ui?.add(label, rule);
			this.reserveIcons.push(label, rule);
		}
		fillEmptyFrames();

		this.invView.forEach((index: number, viewIndex: number) => {
			const entry = so.reserve[index] as ReserveSword;
			const pos = this.invCellPos[viewIndex];
			const cellX = pos.x;
			const cellY = grid.y + pos.y - this.invScroll;

			// 그리드 밖 컬링
			if (cellY + grid.cell < grid.y - 6 || cellY > grid.y + rect.h + 6) {
				return;
			}
			drawCellFrame(cellX, cellY, 0.95);

			const cx = cellX + grid.cell / 2;
			const cy = cellY + grid.cell / 2;
			const selected = this.shop.selectedReserve === index;

			// 선택/각인 프레임 (팩 셀렉트 스프라이트)
			const frameG = selectFrame(scene, cx, cy, grid.cell + 4, grid.cell + 4)
				.setScrollFactor(0).setDepth(DEPTH.content - 1);
			if (selected) {
				frameG.setTint(UI.quenchBright);
			} else if ((entry.traits?.length ?? 0) > 0) {
				// 각인 있는 검은 짚쇠 코너
				frameG.setTint(UI.straw).setAlpha(0.8);
			} else {
				frameG.setVisible(false);
			}
			frameG.setMask(this.invMask!);

			const icon = scene.add.image(cx, cy - 4, 'sword', entry.definition?.sheetOrder ?? 0)
				.setDisplaySize(34, 34).setScrollFactor(0).setDepth(DEPTH.content)
				.setMask(this.invMask!);

			if (entry.definition?.effect?.tint) {
				icon.setTint(Phaser.Display.Color.HexStringToColor(entry.definition.effect.tint).color);
			}

			icon.setInteractive({ useHandCursor: true });
			scene.input.setDraggable(icon);
			icon.setData('shopDragType', 'reserve');
			icon.setData('shopDragIndex', index);
			// 주의: pointerdown 선택은 금물 — refresh()가 이 아이콘을 파괴해 드래그가 끊긴다.
			// 드래그가 아니었을 때만 pointerup에서 선택한다 (wasDragged는 DragController가 세팅).
			icon.on('pointerup', () => {
				if (!icon.getData('wasDragged')) {
					this.shop.handleReserveClick(index);
				}
			});
			icon.on('pointerover', () => this.showTooltip(cx, cellY,
				`${entry.definition?.name} Lv${entry.level}`,
				`${this.describeSwordDefinition(entry.definition!)}${this.describeEntryTraits(entry)}\n클릭: 선택 · 드래그: 장착/정렬`));
			icon.on('pointerout', () => this.hideTooltip());

			const badge = scene.add.text(cx, cellY + grid.cell - 9, `Lv.${entry.level}`, style(8.5, UI.textDim))
				.setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.badge).setMask(this.invMask!);

			this.ui?.add(frameG, icon, badge);
			this.reserveIcons.push(frameG, icon, badge);

			// 각성 배지 (좌상단 별) — 세이브를 불러온 뒤에도 그대로 남는다
			if (awakeningOf(so, entry.definition?.id)) {
				const star = scene.add.text(cellX + 5, cellY + 3, AWAKENING_BADGE,
					style(9.5, UI.goldTextBright, { display: true }))
					.setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.badge).setMask(this.invMask!);
				this.ui?.add(star);
				this.reserveIcons.push(star);
			}

			// 각인 개수 점
			const traitCount = entry.traits?.length ?? 0;
			if (traitCount > 0) {
				const dots = scene.add.text(cellX + grid.cell - 5, cellY + 3, '◆'.repeat(Math.min(3, traitCount)),
					{ fontSize: '7px', color: UI.goldText })
					.setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH.badge).setMask(this.invMask!);
				this.ui?.add(dots);
				this.reserveIcons.push(dots);
			}
		});
		this.ui?.sort();
	}

	/**
	 * 보관함 배치 계산 — invView / invCellPos / invHeaders / invTotalH 를 채운다.
	 * 기본(등급순): 원소 필터를 통과한 검을 신화→일반으로 묶고, 등급마다 헤더 줄을
	 * 끼워 **새 행에서 시작**한다 (등급별 줄 나누기). 같은 등급 안에서는 레벨 높은 순.
	 * '내 순서': 헤더 없이 드래그로 정렬한 배열 순서 그대로 (필터만 적용).
	 */
	computeInventoryLayout() {
		this.invView = [];
		this.invCellPos = [];
		this.invHeaders = [];
		this.invSections = [];
		this.invTotalH = 0;

		const so = this.shop.swordOrbit;
		const grid = this.invGrid;
		if (!so || !grid) {
			return;
		}
		const entries = so.reserve
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry }) => this.matchesFilter(entry.definition));
		const stride = grid.cell + grid.gap;

		if (this.invSort === 'manual') {
			entries.forEach(({ index }, viewIndex) => {
				this.invView.push(index);
				this.invCellPos.push({
					x: grid.x + (viewIndex % grid.cols) * stride,
					y: Math.floor(viewIndex / grid.cols) * stride,
				});
			});
			this.invTotalH = Math.ceil(entries.length / grid.cols) * stride;
			return;
		}

		entries.sort((a, b) =>
			(this.rarityRank(a.entry.definition) - this.rarityRank(b.entry.definition))
			|| ((b.entry.level ?? 1) - (a.entry.level ?? 1))
			|| (a.index - b.index));

		const headerH = 18;
		let cursorY = 0;
		let currentRank = -1;
		let col = 0;
		for (const { entry, index } of entries) {
			const rank = this.rarityRank(entry.definition);
			if (rank !== currentRank) {
				if (currentRank !== -1) {
					cursorY += stride; // 이전 등급의 마지막 행 마감
				}
				currentRank = rank;
				const theme = this.rarityOfSword(entry.definition);
				this.invHeaders.push({ label: theme.name, css: theme.css, y: cursorY });
				this.invSections.push(theme.name);
				cursorY += headerH;
				col = 0;
			} else if (col >= grid.cols) {
				col = 0;
				cursorY += stride;
			}
			this.invView.push(index);
			this.invCellPos.push({ x: grid.x + col * stride, y: cursorY });
			col += 1;
		}
		this.invTotalH = entries.length > 0 ? cursorY + stride : 0;
	}

	/**
	 * 보관함 그리드에서 포인터가 가리키는 **reserve 인덱스** (스크롤·필터·정렬·섹션 반영).
	 * 빈 칸이면 reserve.length (= 맨 뒤로 이동), 그리드 밖이면 -1.
	 */
	findReserveCellAt(screenX: number, screenY: number): number {
		const grid = this.invGrid;
		const rect = this.invStripRect;
		const so = this.shop.swordOrbit;
		if (!grid || !rect || !so) {
			return -1;
		}
		const x = this.toLocalX(screenX);
		const y = this.toLocalY(screenY);
		if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) {
			return -1;
		}
		if (this.invView.length !== this.invCellPos.length || this.invView.length === 0) {
			this.computeInventoryLayout();
		}
		// 섹션 헤더가 줄을 나누므로 실제 셀 배치에 히트테스트한다 (gap 절반까지 허용)
		const yOff = y - grid.y + this.invScroll;
		const tol = grid.gap / 2 + 1;
		for (let viewIndex = 0; viewIndex < this.invCellPos.length; viewIndex += 1) {
			const pos = this.invCellPos[viewIndex];
			if (x >= pos.x - tol && x <= pos.x + grid.cell + tol
				&& yOff >= pos.y - tol && yOff <= pos.y + grid.cell + tol) {
				return this.invView[viewIndex];
			}
		}
		return so.reserve.length;
	}

	describeEntryTraits(entry: ReserveSword): string {
		const so = this.shop.swordOrbit;
		const traits = entry.traits ?? [];
		if (!so || traits.length === 0) {
			return '';
		}
		const names = traits.map((id) => so.getTraitById(id)?.name ?? '?').join(', ');
		return `\n각인: ${names}`;
	}

	refreshSlotPanel(gold: number) {
		const shop = this.shop;
		const so = shop.swordOrbit;
		if (!so || !this.slotButtons) {
			return;
		}

		const maxEnhance = shopCatalog.slots?.enhanceMaxLevel ?? 10;

		this.slotButtons.forEach((slot, i) => {
			const unlocked = i < so.unlockedSlots;
			const state = so.getSlotState(i)!;
			const sword = so.swords[i] ?? null;
			const selected = shop.selectedSlot === i;

			if (!unlocked) {
				const isNext = i === so.unlockedSlots && so.unlockedSlots < so.maxSwords;
				slot.icon.setVisible(false);
				slot.awakenBadge.setVisible(false);
				slot.lockText.setVisible(true);
				slot.levelText.setText('');
				slot.enhText.setText('');
				if (isNext && so.canUnlockSlotAt(shop.round)) {
					const cost = so.nextSlotUnlockCost();
					slot.lockText.setY(slot.y - 14);
					slot.actionText.setText(`열기\n${cost.toLocaleString()}`)
						.setColor(gold >= cost ? UI.goldText : UI.textFaint)
						.setY(slot.y + slot.size / 2 - 18);
					this.drawSlot(i, 'unlockable', selected, null);
				} else if (isNext) {
					// 라운드 게이트: 해방 라운드를 표시 (골드로는 못 연다)
					slot.lockText.setY(slot.y - 14);
					slot.actionText.setText(`R${so.nextSlotUnlockRound()}\n해방`)
						.setColor(UI.textFaint)
						.setY(slot.y + slot.size / 2 - 18);
					this.drawSlot(i, 'locked', false, null);
				} else {
					slot.lockText.setY(slot.y - 4);
					slot.actionText.setText('');
					this.drawSlot(i, 'locked', false, null);
				}
				return;
			}

			slot.lockText.setVisible(false);
			slot.actionText.setText('');
			slot.icon.setPosition(slot.x, slot.y - 4).setDepth(DEPTH.content);

			const element = sword?.definition?.element;
			const elementTheme = element ? ELEMENT_THEME[element] : null;

			if (sword) {
				slot.icon.setVisible(true).setFrame(sword.definition?.sheetOrder ?? 0);
				if (sword.effect?.tint) {
					slot.icon.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
				} else {
					slot.icon.clearTint();
				}
				slot.levelText.setText(`Lv.${sword.level}`).setColor(sword.level >= 5 ? UI.goldText : UI.text);
				slot.awakenBadge.setVisible(Boolean(awakeningOf(so, sword.definition?.id)));
			} else {
				slot.icon.setVisible(false);
				slot.awakenBadge.setVisible(false);
				slot.levelText.setText('');
			}

			const traitCount = (sword as OrbitSword | null)?.traits?.length ?? 0;
			if (sword) {
				slot.enhText
					.setText(`+${state.enhance}${traitCount > 0 ? ` · 각인${traitCount}` : ''}`)
					.setColor(state.enhance >= maxEnhance ? UI.green : (elementTheme?.css ?? UI.goldText));
			} else {
				slot.enhText.setText(state.enhance > 0 ? `강화 +${state.enhance}` : '비어 있음').setColor(UI.textFaint);
			}

			this.drawSlot(i, sword ? 'equipped' : 'empty', selected, elementTheme?.num ?? null);
		});

		// 액션 버튼 내용 (강화/각인/보장석)
		const coins = MetaProgression.getGuaranteeCoins();
		const selected = shop.selectedSlot;
		const [enhanceButton, traitButton, guaranteeButton] = this.actionButtons;

		if (enhanceButton) {
			if (selected !== null && selected < so.unlockedSlots) {
				const state = so.getSlotState(selected)!;
				if (state.enhance < maxEnhance) {
					const cost = so.enhanceCost(selected);
					const rate = Math.round(so.enhanceSuccessRate(selected) * 100);
					enhanceButton.sub.setText(`성공 ${rate}% · 피해 +4%씩`);
					enhanceButton.costText.setText(cost.toLocaleString()).setColor(gold >= cost ? UI.goldText : UI.textFaint);
				} else {
					enhanceButton.sub.setText('최대 강화 완료');
					enhanceButton.costText.setText('MAX').setColor(UI.green);
				}
			} else {
				enhanceButton.sub.setText('자리를 선택하세요');
				enhanceButton.costText.setText('—').setColor(UI.textFaint);
			}
			this.drawActionButton(enhanceButton, false, 0);
		}

		if (traitButton) {
			const sockets = shopCatalog.slots?.traitSockets ?? 3;
			if (selected !== null && so.canAddTrait(selected)) {
				const sword = so.swords[selected]!;
				traitButton.sub.setText(`각인 ${sword.traits?.length ?? 0}/${sockets} · 무작위`);
				traitButton.costText.setText('150').setColor(gold >= 150 ? UI.goldText : UI.textFaint);
			} else if (selected !== null && so.swords[selected]) {
				const sword = so.swords[selected]!;
				const full = (sword.traits?.length ?? 0) >= sockets;
				traitButton.sub.setText(full ? '각인 칸이 가득 참' : `검 레벨 3부터 (지금 Lv.${sword.level})`);
				traitButton.costText.setText('—').setColor(UI.textFaint);
			} else if (selected !== null) {
				traitButton.sub.setText('검이 없는 자리입니다');
				traitButton.costText.setText('—').setColor(UI.textFaint);
			} else {
				traitButton.sub.setText('자리를 선택하세요');
				traitButton.costText.setText('—').setColor(UI.textFaint);
			}
			this.drawActionButton(traitButton, false, 1);
		}

		if (guaranteeButton) {
			guaranteeButton.sub.setText(shop.useGuarantee ? '다음 강화 100% 성공 (켜짐)' : '다음 강화 100% 성공');
			guaranteeButton.costText.setText(`보유 ${coins}`).setColor(coins > 0 ? UI.quenchText : UI.textFaint);
			guaranteeButton.title.setColor(shop.useGuarantee ? UI.goldText : UI.text);
			this.drawActionButton(guaranteeButton, false, 2);
		}

		this.selectHint?.setText(selected !== null
			? `자리 ${selected + 1} 선택됨 — 다시 클릭하면 해제`
			: '자리를 클릭해 선택하면 강화·각인·판매를 할 수 있습니다');
	}

	refreshReserveButtons(gold: number) {
		void gold;
		const shop = this.shop;
		const so = shop.swordOrbit;
		const [equipButton, sellButton] = this.reserveButtons;
		if (!so || !equipButton || !sellButton) {
			return;
		}

		const reserveEntry = shop.selectedReserve !== null ? so.reserve[shop.selectedReserve] : null;
		const slotSword = shop.selectedSlot !== null ? so.swords[shop.selectedSlot] ?? null : null;

		equipButton.title.setAlpha(reserveEntry ? 1 : 0.5);
		equipButton.costText.setText(reserveEntry ? '' : '');
		equipButton.sub.setText('');
		this.drawReserveButton(equipButton, false);

		const sellTarget = reserveEntry ?? slotSword;
		if (sellTarget) {
			const definition = reserveEntry ? reserveEntry.definition : slotSword!.definition;
			const level = reserveEntry ? reserveEntry.level : slotSword!.level;
			const price = shop.sellPrice(definition, level);
			sellButton.title.setAlpha(1);
			sellButton.costText.setText(`+${price.toLocaleString()}`).setColor(UI.goldText);
		} else {
			sellButton.title.setAlpha(0.5);
			sellButton.costText.setText('').setColor(UI.textFaint);
		}
		this.drawReserveButton(sellButton, false);
	}

	// ---------------------------------------------------------------
	// 검 정보 패널 (우측 하단)
	// ---------------------------------------------------------------

	refreshDetail() {
		for (const object of this.detailObjects) {
			object.destroy();
		}
		this.detailObjects = [];

		const rect = this.detailRect;
		const so = this.shop.swordOrbit;
		if (!rect || !this.detailBg || !so) {
			return;
		}

		const scene = this.scene;
		const add = (object: Phaser.GameObjects.GameObject) => {
			this.ui?.add(object);
			this.detailObjects.push(object);
		};

		// 선택 대상 (자리 우선, 없으면 보관함)
		const slotIndex = this.shop.selectedSlot;
		const reserveIndex = this.shop.selectedReserve;
		const sword = slotIndex !== null ? (so.swords[slotIndex] ?? null) : null;
		const entry = reserveIndex !== null ? (so.reserve[reserveIndex] ?? null) : null;

		const headerY = rect.y + 24;

		if (!sword && !entry) {
			const help = scene.add.text(rect.x + rect.w / 2, rect.y + rect.h / 2,
				'검을 클릭하면\n여기에 자세한 정보가 나옵니다\n\n· 능력치와 효과\n· 새겨진 각인과 수치\n· 자리 강화 보너스', {
					...style(11.5, UI.textFaint, { bold: false }), align: 'center', lineSpacing: 6,
				}).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.content);
			add(help);
			this.ui?.sort();
			return;
		}

		const definition = sword ? sword.definition : entry!.definition;
		const level = sword ? sword.level : entry!.level;
		const traits = sword ? ((sword as OrbitSword).traits ?? []) : (entry!.traits ?? []);
		const theme = this.rarityOfSword(definition);

		// 헤더: 아이콘 + 이름 + 레벨/등급
		const icon = scene.add.image(rect.x + 26, headerY + 6, 'sword', definition.sheetOrder ?? 0)
			.setDisplaySize(40, 40).setScrollFactor(0).setDepth(DEPTH.content);
		if (definition.effect?.tint) {
			icon.setTint(Phaser.Display.Color.HexStringToColor(definition.effect.tint).color);
		}
		add(icon);

		const awakened = awakeningOf(so, definition.id);
		const nameText = scene.add.text(rect.x + 54, headerY - 2,
			`${awakened ? `${AWAKENING_BADGE} ` : ''}${definition.name}`, style(15, theme.css, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		add(nameText);
		const elementTheme = definition.element ? ELEMENT_THEME[definition.element] : null;
		const subText = scene.add.text(rect.x + 54, headerY + 16,
			`Lv.${level} · ${theme.name}${elementTheme ? ` · ${elementTheme.label} 속성` : ''}${sword ? ` · 자리 ${slotIndex! + 1}` : ' · 보관함'}`,
			style(10.5, UI.textDim))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		add(subText);

		add(divider(scene, rect.x + rect.w / 2, headerY + 32, rect.w - 12)
			.setScrollFactor(0).setDepth(DEPTH.content));

		// 능력치 줄
		let cursorY = headerY + 46;
		const line = (label: string, value: string, color: string = UI.text) => {
			const labelText = scene.add.text(rect.x + 10, cursorY, label, style(11, UI.textDim))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			const valueText = scene.add.text(rect.x + rect.w - 10, cursorY, value, style(11, color))
				.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			add(labelText);
			add(valueText);
			cursorY += 20;
		};

		const typeLabel = definition.damageType === 'magic' ? '마법' : '물리';
		const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;
		line('피해', `${sword ? sword.damage : definition.damage} (${typeLabel})${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
		line('쿨다운', `${Math.round(sword ? sword.scanInterval : definition.cooldownMs)}ms`);
		line('연속타', `${sword ? sword.hitsPerLaunch : definition.maxHits}회`);
		if (definition.special) {
			line('고유 효과', definition.special.label ?? '', UI.quenchText);
		}
		if (sword && slotIndex !== null) {
			const state = so.getSlotState(slotIndex);
			if (state) {
				line('자리 강화', `+${state.enhance} (피해 +${Math.round(state.enhance * 4)}% · 쿨다운 -${(state.enhance * 1.5).toFixed(1)}%)`, state.enhance > 0 ? UI.goldText : UI.textDim);
			}
		}
		if (definition.element && so.hasSetResonance(definition.element)) {
			line('공명', `${elementTheme?.label ?? definition.element} 효과 1.5배`, UI.green);
		}
		// 각성 표기 (2026-09-02) — 각성한 검은 상세에서 반드시 금색 줄로 드러난다
		const awakening = awakened;
		if (awakening) {
			line('각성', awakening.name, UI.goldTextBright);
			const effectText = scene.add.text(rect.x + 10, cursorY, awakening.desc, {
				...style(9.5, UI.goldText, { bold: false }), wordWrap: { width: rect.w - 20 },
			}).setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			add(effectText);
			cursorY += Math.max(18, effectText.height + 4);
		}
		const recipeText = this.recipeTextFor(definition);
		if (recipeText) {
			line('조합식', recipeText, UI.goldText);
		}

		// 각인 목록
		cursorY += 4;
		add(divider(scene, rect.x + rect.w / 2, cursorY - 8, rect.w - 12)
			.setScrollFactor(0).setDepth(DEPTH.content));

		const sockets = shopCatalog.slots?.traitSockets ?? 3;
		const traitHeader = scene.add.text(rect.x + 10, cursorY + 4, `각인 (${traits.length}/${sockets})`, style(11.5, UI.goldText))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
		add(traitHeader);
		cursorY += 22;

		if (traits.length === 0) {
			const none = scene.add.text(rect.x + 10, cursorY, '아직 각인이 없습니다 (검 레벨 3부터 새길 수 있음)', style(10, UI.textFaint, { bold: false }))
				.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
			add(none);
			cursorY += 18;
		} else {
			for (const traitId of traits) {
				const trait = so.getTraitById(traitId);
				if (!trait) continue;
				const synergy = Boolean(trait.element && trait.element === definition.element);
				const traitTheme = trait.element ? ELEMENT_THEME[trait.element] : null;
				add(scene.add.image(rect.x + 15, cursorY, 'uf-icon-point')
					.setDisplaySize(8, 6).setTint(traitTheme?.num ?? UI.straw)
					.setScrollFactor(0).setDepth(DEPTH.content));
				const nameT = scene.add.text(rect.x + 26, cursorY, trait.name, style(11, traitTheme?.css ?? UI.text))
					.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
				add(nameT);
				const descT = scene.add.text(rect.x + rect.w - 10, cursorY, `${trait.desc}${synergy ? ' ×2!' : ''}`,
					style(9.5, synergy ? UI.goldText : UI.textDim, { bold: false }))
					.setOrigin(1, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
				add(descT);
				cursorY += 19;
			}
			if (traits.some((id) => {
				const trait = so.getTraitById(id);
				return Boolean(trait?.element && trait.element === definition.element);
			})) {
				const synergyNote = scene.add.text(rect.x + 10, cursorY, '검과 같은 속성 각인은 효과 2배!', style(9.5, UI.goldText, { bold: false }))
					.setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH.content);
				add(synergyNote);
				cursorY += 18;
			}
		}

		// 로어 (남는 공간에만)
		if (definition.lore && cursorY < rect.y + rect.h - 40) {
			const lore = scene.add.text(rect.x + rect.w / 2, rect.y + rect.h - 8, `— ${definition.lore}`, {
				...style(9.5, UI.textFaint, { bold: false }), align: 'center', wordWrap: { width: rect.w - 20 },
			}).setOrigin(0.5, 1).setScrollFactor(0).setDepth(DEPTH.content);
			add(lore);
		}

		this.ui?.sort();
	}

	// ---------------------------------------------------------------
	// 조합 성공 연출 (2026-09-01)
	// ---------------------------------------------------------------
	//
	// 조합은 상점 오버레이(depth 2300~2603) 위에서 일어나므로 월드 FX 레이어
	// (depth 56)는 화면에 보이지 않는다. 그래서 결과 검을 모달 위에 크게 띄우고
	// 등급색 링·플래시로 강조한다. 오브젝트는 연출당 6개 안쪽이고, 끝나면
	// killTweensOf 후 전부 파괴한다.

	private reforgeFxObjects: Phaser.GameObjects.GameObject[] = [];

	/** 연출 오브젝트 일괄 정리 (연출 종료·상점 파괴 공용) */
	clearReforgeFx() {
		for (const object of this.reforgeFxObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.reforgeFxObjects = [];
	}

	playReforgeResultFX(definition: SwordDefinition | null) {
		if (!definition) {
			return;
		}
		const scene = this.scene;
		this.clearReforgeFx();

		const cx = scene.scale.width / 2;
		const cy = scene.scale.height / 2;
		const rarity = RARITY_THEME[definition.rarity ?? 'common'] ?? RARITY_THEME.common;
		const depth = DEPTH.float + 40;
		const track = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
			this.reforgeFxObjects.push(object);
			return object;
		};

		// 1) 화면 플래시 (모션 줄이기에서도 짧게 — "무언가 일어났다"는 신호는 남긴다)
		const flash = track(scene.add.rectangle(cx, cy, scene.scale.width, scene.scale.height, rarity.num, 0.22)
			.setScrollFactor(0).setDepth(depth));
		// 2) 결과가 묻히지 않도록 뒤에 어두운 판을 깐다 (모달 행 위에서 읽혀야 한다)
		track(scene.add.rectangle(cx, cy + 20, 340, 260, 0x0a0d10, 0.82)
			.setScrollFactor(0).setDepth(depth + 1));
		// 3) 등급색 링 2겹 — Graphics 는 (0,0) 기준으로 그리고 컨테이너처럼 위치를 준다
		//    (절대 좌표로 그리면 setScale 이 원을 화면 밖으로 밀어낸다)
		const ring = track(scene.add.graphics().setScrollFactor(0).setDepth(depth + 1));
		ring.setPosition(cx, cy);
		ring.lineStyle(6, rarity.num, 0.95);
		ring.strokeCircle(0, 0, 60);
		ring.lineStyle(2, 0xffffff, 0.7);
		ring.strokeCircle(0, 0, 78);

		const icon = track(scene.add.image(cx, cy, 'sword', definition.sheetOrder ?? 0)
			.setDisplaySize(96, 96).setScrollFactor(0).setDepth(depth + 2));
		if (definition.effect?.tint) {
			icon.setTint(Phaser.Display.Color.HexStringToColor(definition.effect.tint).color);
		}
		const name = track(scene.add.text(cx, cy + 86, definition.name,
			style(24, rarity.css, { display: true })).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2));
		name.setShadow(0, 3, '#000000', 6, false, true);
		const tag = track(scene.add.text(cx, cy + 116, `조합 완성 · ${rarity.name}`,
			style(13, UI.textDim, { display: true })).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2));

		if (reduceMotion()) {
			// 모션 줄이기: 트윈 없이 0.6초 정적 표시
			flash.setAlpha(0.12);
			scene.time.delayedCall(600, () => this.clearReforgeFx());
			return;
		}

		flash.setAlpha(0);
		scene.tweens.add({ targets: flash, alpha: { from: 0.3, to: 0 }, duration: 420, ease: 'Quad.easeOut' });
		ring.setScale(0.5).setAlpha(1);
		scene.tweens.add({
			targets: ring, scale: 2.1, alpha: 0, duration: 520, ease: 'Cubic.easeOut',
		});
		icon.setScale(icon.scaleX * 0.4).setAlpha(0);
		scene.tweens.add({
			targets: icon,
			scaleX: icon.scaleX / 0.4, scaleY: icon.scaleY / 0.4, alpha: 1,
			duration: 260, ease: 'Back.easeOut',
		});
		for (const text of [name, tag]) {
			text.setAlpha(0);
			scene.tweens.add({ targets: text, alpha: 1, y: text.y - 8, duration: 240, delay: 120, ease: 'Quad.easeOut' });
		}
		scene.tweens.add({
			targets: [icon, name, tag],
			alpha: 0,
			delay: 820,
			duration: 300,
			onComplete: () => this.clearReforgeFx(),
		});
	}

	// ---------------------------------------------------------------
	// Teardown
	// ---------------------------------------------------------------

	teardownInput() {
		const scene = this.scene;

		if (this.keyHandler) {
			scene.input.keyboard!.off('keydown', this.keyHandler);
			this.keyHandler = null;
		}

		this.hideTooltip();

		if (this.onWheel) {
			scene.input.off('wheel', this.onWheel);
			this.onWheel = null;
		}
		this.invMask?.destroy();
		this.invMaskShape?.destroy();
		this.invMask = null;
		this.invMaskShape = null;
		this.invPageText = null;
	}

	destroyObjects() {
		this.closeModal();
		this.clearReforgeFx();
		this.navButtons = [];
		this.reforgeContentRect = null;

		for (const object of this.reserveIcons ?? []) {
			object.destroy();
		}
		this.reserveIcons = [];

		for (const object of this.chipObjects) {
			object.destroy();
		}
		this.chipObjects = [];

		for (const object of this.filterObjects) {
			object.destroy();
		}
		this.filterObjects = [];

		for (const object of this.offerRowObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.offerRowObjects = [];

		for (const object of this.detailObjects) {
			object.destroy();
		}
		this.detailObjects = [];

		for (const object of this.backdrop) {
			object.destroy();
		}
		this.backdrop = [];

		// SPACE 키캡의 repeat:-1 명멸 트윈은 파괴 후에도 TweenManager에 남는다 —
		// 상점을 여닫을 때마다 좀비 트윈이 1개씩 쌓이던 누수를 여기서 끊는다.
		for (const object of this.uiObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.uiObjects = [];

		// 툴팁 컨테이너는 this.ui 안에 살아 있으므로 루트보다 먼저 정리한다
		this.tooltipUi?.destroy();
		this.tooltipUi = null;

		if (this.ui) {
			this.scene.tweens.killTweensOf(this.ui);
		}
		this.ui?.destroy();
		this.ui = null;

		this.statButtons = [];
		this.swordButtons = [];
		this.slotButtons = [];
		this.actionButtons = [];
		this.reserveButtons = [];
		this.selectHint = null;
		this.rerollText = null;
		this.rerollG = null;
		this.rerollCoin = null;
		this.detailBg = null;
		this.detailRect = null;
		this.invGrid = null;
		this.invStripRect = null;
		this.sellRect = null;
		this.invCountText = null;
		this.invSortText = null;
		this.elementChipsRect = null;
		this.slotsGeom = null;
		this.filterRect = null;
		this.offerRect = null;
		this.offerSections = [];
		this.invView = [];
		this.invCellPos = [];
		this.invHeaders = [];
		this.invSections = [];
		this.invTotalH = 0;
	}

	// ---------------------------------------------------------------
	// 회귀 테스트용 계측 (sword-ui-test.mjs) — 필터·등급 그룹·각성 표기
	// ---------------------------------------------------------------

	layoutMetrics() {
		const so = this.shop.swordOrbit;
		const awakened = (id: string | undefined) => Boolean(awakeningOf(so, id));
		return {
			elementFilter: this.elementFilter,
			invSort: this.invSort,
			/** (구) 좌측 구매 목록 등급 섹션 — 09-03부터 항상 [] */
			offerSections: [...this.offerSections],
			/** 보관함에 그려진 등급 섹션 헤더 (신화→일반 순) */
			invSections: [...this.invSections],
			/** 보관함 섹션 헤더 y 오프셋 — 줄 나누기 검증용 */
			invHeaderYs: this.invHeaders.map((header) => header.y),
			invCellYs: this.invCellPos.map((pos) => pos.y),
			offerNames: this.swordButtons.map((card) => card.offer?.name ?? ''),
			offerRarities: this.swordButtons.map((card) => card.offer?.rarity ?? 'common'),
			offerElements: this.swordButtons.map((card) => card.offer?.element ?? 'none'),
			offerRows: this.swordButtons.length,
			totalOffers: this.shop.swordOffers.length,
			/** 보관함 표시 순서(= reserve 인덱스)와 그 등급·원소 */
			invView: [...this.invView],
			invRarities: this.invView.map((index) => so?.reserve[index]?.definition?.rarity ?? 'common'),
			invElements: this.invView.map((index) => so?.reserve[index]?.definition?.element ?? 'none'),
			reserveCount: so?.reserve.length ?? 0,
			/** 각성 표기 — 자리 배지 / 보관함 배지 */
			slotAwakenBadges: this.slotButtons.map((slot) => slot.awakenBadge.visible),
			awakenedEquipped: (so?.swords ?? []).map((sword) => awakened(sword.definition?.id)),
			navKinds: this.navButtons.map((button) => button.kind),
			modalKind: this.modalKind,
			rerollRect: this.rerollRect ? { ...this.rerollRect } : null,
			offerRect: this.offerRect ? { ...this.offerRect } : null,
			filterRect: this.filterRect ? { ...this.filterRect } : null,
			invRect: this.invStripRect ? { ...this.invStripRect } : null,
			uiWidth: this.ui?.width ?? 0,
			uiHeight: this.ui?.height ?? 0,
			uiScale: this.ui?.scale ?? 1,
		};
	}

	/** 현재 화면에 그려진 텍스트 전부 (테스트에서 각성/필터 표기 확인용) */
	visibleTexts(): string[] {
		const out: string[] = [];
		const walk = (node: unknown) => {
			const object = node as { text?: unknown; list?: unknown[] };
			if (typeof object?.text === 'string') {
				out.push(object.text);
			}
			if (Array.isArray(object?.list)) {
				object.list.forEach(walk);
			}
		};
		if (this.ui) {
			walk(this.ui.root);
		}
		return out;
	}
}
