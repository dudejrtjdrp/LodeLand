// 공용 UI 테마 — Complete UI Essential Pack (Flat) 기반.
// 2026-08-31: 절차 드로잉(모따기 강판) UI를 에셋팩 비트맵으로 전면 교체.
// 에셋: public/ui/flat/ (원본 그대로, NEAREST 필터) — 크림+주황 본체,
//       회색 프레임, 파랑=상호작용, 주황/적=위험. 패널이 밝아졌으므로
//       패널 위 텍스트는 어두운 잉크가 기본이다.
// 모든 화면(HUD/상점/털갈이/메뉴)이 이 모듈의 패널·버튼·글리프 헬퍼를 공유한다.

import Phaser from 'phaser';

// ---------------------------------------------------------------
// Flat 팩 텍스처 매니페스트 — BootScene 이 이걸 순회하며 프리로드한다.
// 키는 전부 'uf-' 접두사. (파일명 = public/ui/flat/<file>)
// ---------------------------------------------------------------

export const FLAT_UI_TEXTURES: Array<[key: string, file: string]> = [
	['uf-frame-gray', 'frame_gray.png'],
	['uf-frame-blue', 'frame_blue.png'],
	['uf-frame-orange', 'frame_orange.png'],
	['uf-slot-gray', 'slot_gray.png'],
	['uf-slot-slate', 'slot_slate.png'],
	['uf-slot-ghost', 'slot_dark.png'],      // 반투명 고스트(빈/잠김)
	['uf-slot-blue', 'slot_blue.png'],
	['uf-slot-cyan', 'slot_cyan.png'],
	['uf-slot-ghostblue', 'slot_navy.png'],  // 반투명 고스트(파랑)
	['uf-slot-orange', 'slot_orange.png'],
	['uf-slot-red', 'slot_red.png'],
	['uf-slot-ghostorange', 'slot_brown.png'],
	['uf-btn-1', 'btn_1.png'],   // 눌림(가장 낮음)
	['uf-btn-2', 'btn_2.png'],
	['uf-btn-3', 'btn_3.png'],   // 기본
	['uf-btn-4', 'btn_4.png'],   // 호버(가장 높음)
	['uf-btn2-1', 'btn2_1.png'], // 라운드형 (키캡·소형)
	['uf-btn2-3', 'btn2_3.png'],
	['uf-btn-cross', 'btn_cross.png'],
	['uf-btn-check', 'btn_check.png'],
	['uf-btn-play', 'btn_play.png'],
	['uf-btn-arrow', 'btn_arrow.png'],
	['uf-btn-minus', 'btn_minus.png'],
	['uf-btn-plus', 'btn_plus.png'],
	['uf-bar-cream', 'bar_cream.png'],
	['uf-bar-ticks', 'bar_ticks.png'],
	['uf-bar-track', 'bar_track.png'],
	['uf-fill-green', 'fill_a.png'],
	['uf-fill-teal', 'fill_b.png'],
	['uf-fill-red', 'fill_c.png'],
	['uf-fill-darkred', 'fill_d.png'],
	['uf-fill-orange', 'fill_e.png'],
	['uf-fill-cream', 'fill_f.png'],
	['uf-fill-dark', 'fill_g.png'],
	['uf-banner-1', 'banner_1.png'],
	['uf-banner-2', 'banner_2.png'],
	['uf-banner-3', 'banner_3.png'],
	['uf-banner-4', 'banner_4.png'],
	['uf-marker-gray', 'marker_gray.png'],
	['uf-marker-blue', 'marker_blue.png'],
	['uf-marker-orange', 'marker_orange.png'],
	['uf-select-1', 'select_1.png'],
	['uf-select-2', 'select_2.png'],
	['uf-select-3', 'select_3.png'],
	['uf-select-4', 'select_4.png'],
	['uf-icon-arrow', 'icon_arrow.png'],
	['uf-icon-check', 'icon_check.png'],
	['uf-icon-cross', 'icon_cross.png'],
	['uf-icon-point', 'icon_point.png'],
	['uf-icon-dropdown', 'icon_dropdown.png'],
	['uf-icon-line', 'icon_line.png'],
	['uf-input', 'input.png'],
];

/**
 * 타이틀 화면 전용 에셋 — public/ui/title/ (scripts/slice-title-ui.py 가 목업에서 직접 오려 낸 것).
 *
 * Flat 팩과 섞지 않는다. 타이틀은 목업 그림 그대로를 쓰는 화면이라, 팩의 버튼·프레임을
 * 끼워 넣으면 곧바로 이질감이 난다(2026-09-04 1차 시도의 실패 원인).
 *
 * 목업 해상도가 1672×941 이고 디자인 높이가 830 이므로, **이 텍스처들은 전부
 * `TITLE_PX`(=830/941) 배율로 그린다.** 그러면 나인슬라이스 폭·높이에 목업의
 * 픽셀 좌표를 그대로 적어 넣을 수 있어 비율이 어긋나지 않는다.
 */
export const TITLE_UI_TEXTURES: Array<[key: string, file: string]> = [
	['t-btn', 'btn.png'],
	['t-btn-hi', 'btn-hi.png'],
	['t-mark-l', 'mark-l.png'],
	['t-mark-r', 'mark-r.png'],
	['t-logo', 'logo.png'],
	['t-pill', 'pill.png'],
	['t-gear', 'gear.png'],
	['t-corner', 'corner.png'],
	['t-icon-continue', 'icon-continue.png'],
	['t-icon-sortie', 'icon-sortie.png'],
	['t-icon-upgrade', 'icon-upgrade.png'],
	['t-icon-settings', 'icon-settings.png'],
	['t-icon-codex', 'icon-codex.png'],
];

/**
 * 스킬 책(K 창) 전용 에셋 — public/ui/skillbook/ (scripts/generate-skillbook-ui.py 산출물).
 * Flat 팩과 달리 **매끈한 벡터풍**이라 NEAREST 를 걸지 않는다 (LINEAR 유지).
 * 값: [키, 파일, 나인슬라이스 left,right,top,bottom] — 슬라이스가 없으면 단일 이미지.
 */
export const SKILLBOOK_TEXTURES: Array<[key: string, file: string, slice?: [number, number, number, number]]> = [
	['sb-frame', 'sb-frame.png', [56, 56, 56, 56]],
	['sb-corner', 'sb-corner.png'],
	['sb-plaque', 'sb-plaque.png', [52, 52, 22, 26]],
	['sb-panel', 'sb-panel.png', [18, 18, 18, 18]],
	['sb-panel-lit', 'sb-panel-lit.png', [18, 18, 18, 18]],
	['sb-parch', 'sb-parch.png'],
	['sb-tab-on', 'sb-tab-on.png', [18, 18, 16, 16]],
	['sb-tab-off', 'sb-tab-off.png', [18, 18, 16, 16]],
	['sb-row', 'sb-row.png', [18, 18, 18, 18]],
	['sb-row-on', 'sb-row-on.png', [18, 18, 18, 18]],
	['sb-iconframe', 'sb-iconframe.png', [9, 9, 9, 9]],
	['sb-close', 'sb-close.png'],
	['sb-btn', 'sb-btn.png', [18, 18, 16, 18]],
	['sb-btn-gold', 'sb-btn-gold.png', [18, 18, 16, 18]],
	['sb-bar-bg', 'sb-bar-bg.png', [6, 6, 6, 6]],
	['sb-bar-fill', 'sb-bar-fill.png', [6, 6, 6, 6]],
	['sb-scroll-track', 'sb-scroll-track.png', [5, 5, 8, 8]],
	['sb-scroll-thumb', 'sb-scroll-thumb.png', [5, 5, 8, 8]],
	['sb-arrow', 'sb-arrow.png'],
	['sb-chip', 'sb-chip.png', [8, 8, 8, 8]],
	['sb-sword', 'sb-sword.png'],
	['sb-compass', 'sb-compass.png'],
];

/** 스킬 아이콘 아틀라스 — 64px 칸, skillTree.json 노드 순서 */
export const SKILLBOOK_ICON_KEY = 'sb-icons';

/** 나인슬라이스 헬퍼 — SKILLBOOK_TEXTURES 슬라이스 값으로 즉석 생성 */
export function sbNine(
	scene: Phaser.Scene, key: string, x: number, y: number, w: number, h: number,
	opts: { origin?: number; alpha?: number; tint?: number } = {},
): Phaser.GameObjects.NineSlice {
	const entry = SKILLBOOK_TEXTURES.find((t) => t[0] === key);
	const s = entry?.[2] ?? [8, 8, 8, 8];
	const { origin = 0, alpha = 1, tint } = opts;
	const ns = scene.add.nineslice(x, y, key, 0, Math.max(s[0] + s[1] + 1, w), Math.max(s[2] + s[3] + 1, h),
		s[0], s[1], s[2], s[3]).setOrigin(origin).setAlpha(alpha);
	if (tint !== undefined) {
		ns.setTint(tint);
	}
	return ns;
}

/** UI 픽셀아트 기본 확대 배율 — 팩 원본 1px 이 화면 2px 로 그려진다. */
export const UI_PX = 2;

// ---------------------------------------------------------------
// 팔레트 — LODELAND 강철 톤 (2026-08-31 재염색 에셋과 한 쌍).
// 팩 스프라이트를 scripts/recolor-flat-ui.py 로 식은 쇠/담금 청/잉걸 팔레트로
// 재염색했으므로 텍스트·포인트 토큰도 원래의 다크 테마 값으로 돌아간다.
// 패널이 어두우니 텍스트는 밝은 회백이 기본이다.
// ---------------------------------------------------------------

export const UI = {
	// 배경/패널 — 식은 쇠
	bg: 0x101317,
	panel: 0x171b20,
	panelTop: 0x1b2026,
	panelDark: 0x12151a,
	panelInset: 0x14181d,
	// 구조 선 (gold* 키는 호환용 — 강철/담금 청)
	goldBright: 0x8fc3d8, // 포커스·호버 (담금 청 밝음)
	gold: 0x6fa7bd,       // 포인트 장식 (담금 청)
	goldDim: 0x53616d,    // 기본 프레임 (강철)
	goldDark: 0x39424b,   // 안쪽 헤어라인 (강철 어두움)
	bronze: 0x2a323a,
	edge: 0x232a31,
	// 상태 색 (숫자)
	redN: 0xd95f4d,
	greenN: 0x84b04a,
	blueN: 0x63b3d9,
	purpleN: 0x8d7bb5,
	hpRed: 0xd9702e,      // 화로(잉걸)
	hpRedDark: 0x6e3012,
	mpBlue: 0x5f9bb0,
	xpGold: 0xaeb9c2,     // 쇳밥(은백)
	// 의미 토큰
	quench: 0x6fa7bd,
	quenchBright: 0x8fc3d8,
	quenchDeep: 0x3f6b7d,
	ember: 0xd9702e,
	emberDeep: 0x8a3f14,
	rust: 0x8a4a2b,
	steel: 0x53616d,
	steelDark: 0x39424b,
	straw: 0xd9a83c,
	strawDeep: 0x8a6a24,
	cream: 0xdfe6ea,
	// 텍스트 (CSS) — 어두운 강판 위 밝은 회백이 기본
	text: '#dfe6ea',
	textDim: '#8d9aa5',
	textFaint: '#5c6a75',
	goldText: '#d9a83c',  // 정철·값어치 전용
	goldDeep: '#b08a33',
	white: '#eef3f6',
	red: '#e0654d',
	redBright: '#ff8a63',
	green: '#9bc25b',
	blue: '#7cc3e0',
	purple: '#a794d1',
	black: '#0d1013',
	quenchText: '#8fc3d8',
	emberText: '#e8874a',
	goldTextBright: '#d9a83c', // (호환 별칭 — goldText 와 동일 취지)
};

export interface RarityTheme {
	num: number;
	css: string;
	glow: number;
	name: string;
}

// 등급 (쉬운 한국어 라벨 — 2026-08-28. 제련 단계 명칭은 로어에만 남긴다)
// 다크 테마 원본 값 (num=밝은 표기색 / glow=어두운 배광)
export const RARITY_THEME: Record<string, RarityTheme> = {
	common: { num: 0xa9b2ba, css: '#a9b2ba', glow: 0x6e7880, name: '일반' },
	uncommon: { num: 0x8fbf52, css: '#8fbf52', glow: 0x5c8a2e, name: '고급' },
	rare: { num: 0x63a7cf, css: '#63a7cf', glow: 0x3d7396, name: '희귀' },
	epic: { num: 0x9b87c9, css: '#9b87c9', glow: 0x6b5a96, name: '영웅' },
	legendary: { num: 0xd9a83c, css: '#d9a83c', glow: 0x9c761f, name: '전설' },
	mythic: { num: 0xd96a5a, css: '#d96a5a', glow: 0xa03b2e, name: '신화' },
};

// 원소 = 속성 계열. icon 은 텍스트 폴백 글리프(폰트 안전 문자), tex 는 그린 글리프 텍스처 키.
export const ELEMENT_THEME: Record<string, { num: number; css: string; icon: string; label: string; tex: string }> = {
	fire: { num: 0xd9702e, css: '#d9702e', icon: '◆', label: '불', tex: 'g-el-fire' },
	electric: { num: 0x63b3d9, css: '#63b3d9', icon: '◆', label: '번개', tex: 'g-el-electric' },
	poison: { num: 0x84b04a, css: '#84b04a', icon: '◆', label: '독', tex: 'g-el-poison' },
	void: { num: 0x8d7bb5, css: '#8d7bb5', icon: '◆', label: '공허', tex: 'g-el-void' },
	gold: { num: 0xd9a83c, css: '#d9a83c', icon: '◆', label: '황금', tex: 'g-el-gold' },
	ice: { num: 0x8fc3d8, css: '#8fc3d8', icon: '◆', label: '얼음', tex: 'g-el-ice' },
	blood: { num: 0xc9455a, css: '#c9455a', icon: '◆', label: '피', tex: 'g-el-blood' },
	wind: { num: 0x9fd8c0, css: '#9fd8c0', icon: '◆', label: '바람', tex: 'g-el-wind' },
};

// ---------------------------------------------------------------
// 모션 상수 — "쇠는 무겁고 새는 가볍다"
// UI 는 짧고 단단하게(바운스 금지), 검·깃털 연출만 가볍게.
// ---------------------------------------------------------------

export const MOTION = {
	tap: 110,     // 버튼 반응
	panel: 200,   // 패널 전환
	state: 300,   // 중요한 상태 변화
	banner: 260,  // 배너 진입
	bannerOut: 500,
};

// ---------------------------------------------------------------
// 폰트 — 디스플레이: Jua(둥글고 통통한 제목/HUD체), 본문: Gowun Dodum(부드러운 둥근 고딕).
// 둘 다 index.html 에서 Google Fonts 로 로드. 네트워크가 없으면 시스템 고딕으로 폴백된다(레이아웃 유지).
// `serifKr` 키는 과거 명조 시절 이름이 남은 것 — 지금은 display 와 동일하다.
// ---------------------------------------------------------------

const KR_DISPLAY = '"Jua", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const KR_BODY = '"Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export const FONT = {
	display: KR_DISPLAY,
	serifKr: KR_DISPLAY,
	body: KR_BODY,
};

/**
 * 텍스트 렌더 해상도 — 캔버스 텍스처를 n배로 굽는다.
 * 축소 스케일 컨테이너(UiRoot)와 고밀도 디스플레이에서 글자가 뭉개지지 않는다.
 */
export const TEXT_RESOLUTION = Math.min(3, Math.max(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));

export function style(
	size: number,
	color: string = UI.text,
	opts: Partial<Phaser.Types.GameObjects.Text.TextStyle> & { display?: boolean; bold?: boolean } = {},
): Phaser.Types.GameObjects.Text.TextStyle {
	const { display, bold, ...rest } = opts;
	return {
		fontFamily: display ? FONT.display : FONT.body,
		fontSize: `${size}px`,
		fontStyle: bold === false ? 'normal' : 'bold',
		color,
		resolution: TEXT_RESOLUTION,
		...rest,
	};
}

// ---------------------------------------------------------------
// 반응형 좌표계 (기존 유지)
// ---------------------------------------------------------------

// 기준 해상도를 낮출수록 같은 화면에서 UI가 커진다 (992→830 ≈ 1.2x 확대).
export const DESIGN = { h: 830, minW: 1070 };

/**
 * 타이틀 목업(1672×941) → 디자인 좌표 환산 배율.
 * TITLE_UI_TEXTURES 를 그릴 때 이 배율을 쓰면 나인슬라이스 크기·좌표에 목업의
 * 픽셀값을 그대로 적어도 비율이 정확히 맞는다.
 */
export const TITLE_PX = DESIGN.h / 941;

export interface UiRoot {
	root: Phaser.GameObjects.Container;
	scale: number;
	width: number;
	height: number;
	toLocalX(screenX: number): number;
	toLocalY(screenY: number): number;
	add(...objects: Phaser.GameObjects.GameObject[]): void;
	sort(): void;
	destroy(): void;
}

export function uiScaleFor(scene: Phaser.Scene): number {
	return Math.min(scene.scale.height / DESIGN.h, scene.scale.width / DESIGN.minW);
}

export function hudScaleFor(scene: Phaser.Scene): number {
	return Phaser.Math.Clamp(uiScaleFor(scene), 0.6, 1.1);
}

/**
 * 화면 고정 정규화 — 객체와 그 자손 전부의 scrollFactor 를 0 으로 못박는다.
 *
 * Phaser 는 **렌더**할 때 컨테이너 자식의 scrollFactor 를 무시하고 부모 행렬만
 * 쓰지만, **입력 판정**할 때는 잎 객체 자신의 scrollFactor 를 읽는다
 * (InputManager.hitTest: `px = worldX + camScrollX * go.scrollFactorX - camScrollX`).
 *
 * 그래서 scrollFactor 0 인 UiRoot 안에 기본값(1) 그대로 들어간 자식은
 * **화면에는 고정돼 보이는데 클릭 판정만 카메라 스크롤만큼 통째로 밀린다.**
 * 타이틀·상점처럼 카메라가 안 움직이는 화면에서는 안 드러나고, 전투 중
 * (카메라가 플레이어를 따라다니는 동안) 레벨업 카드·HUD 가 아예 안 눌린다.
 * — 2026-09-02 "모든 버튼이 잘 안 눌린다" 제보의 두 번째 원인.
 *
 * 이 함수는 UiRoot.add / UiRoot.sort 에서만 불린다(리빌드 시점 = 핫패스 아님).
 */
export function fixScreenSpaceInput(object: Phaser.GameObjects.GameObject): void {
	const go = object as unknown as {
		scrollFactorX?: number;
		setScrollFactor?: (x: number, y?: number) => unknown;
		list?: Phaser.GameObjects.GameObject[];
	};
	if (go.setScrollFactor && (go.scrollFactorX !== 0)) {
		go.setScrollFactor(0, 0);
	}
	if (go.list) {
		for (const child of go.list) {
			fixScreenSpaceInput(child);
		}
	}
}

export function createUiRoot(scene: Phaser.Scene, depth = 0): UiRoot {
	const scale = uiScaleFor(scene);
	const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(depth).setScale(scale);

	return {
		root,
		scale,
		width: scene.scale.width / scale,
		height: scene.scale.height / scale,
		toLocalX: (screenX: number) => screenX / scale,
		toLocalY: (screenY: number) => screenY / scale,
		add: (...objects: Phaser.GameObjects.GameObject[]) => {
			for (const object of objects) {
				root.add(object);
				fixScreenSpaceInput(object);
			}
		},
		// sort() 는 화면을 다시 그린 직후 한 번씩 불린다 — 그 사이에 자식
		// 컨테이너 안쪽으로 늦게 들어온 객체까지 여기서 마저 고정한다.
		sort: () => {
			for (const child of root.list) {
				fixScreenSpaceInput(child);
			}
			root.sort('depth');
		},
		destroy: () => root.destroy(),
	};
}

// ---------------------------------------------------------------
// 그래픽 프리미티브 — 모따기 강판
// ---------------------------------------------------------------

/** 모따기 팔각 path 를 그린다 (fill/stroke 는 호출자가). */
function chamferPath(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ch: number) {
	const c = Math.min(ch, w / 2 - 1, h / 2 - 1);
	g.beginPath();
	g.moveTo(x + c, y);
	g.lineTo(x + w - c, y);
	g.lineTo(x + w, y + c);
	g.lineTo(x + w, y + h - c);
	g.lineTo(x + w - c, y + h);
	g.lineTo(x + c, y + h);
	g.lineTo(x, y + h - c);
	g.lineTo(x, y + c);
	g.closePath();
}

export function chamferFill(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ch: number, color: number, alpha = 1) {
	g.fillStyle(color, alpha);
	chamferPath(g, x, y, w, h, ch);
	g.fillPath();
}

export function chamferStroke(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ch: number, width: number, color: number, alpha = 1) {
	g.lineStyle(width, color, alpha);
	chamferPath(g, x, y, w, h, ch);
	g.strokePath();
}

export function diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, alpha = 1) {
	g.fillStyle(color, alpha);
	g.beginPath();
	g.moveTo(cx, cy - r);
	g.lineTo(cx + r, cy);
	g.lineTo(cx, cy + r);
	g.lineTo(cx - r, cy);
	g.closePath();
	g.fillPath();
}

// ---------------------------------------------------------------
// Flat 팩 프리미티브 — 나인슬라이스 절단선은 스프라이트 실측값.
// frame 96×64: 외곽 1px 잉크 + 상단 2px 광 + 하단 2px 그늘 → 슬라이스 5/5/4/4
// btn 32×32: 상태별로 본체 y 오프셋이 다르다(_4 기본 높음 → _1 눌림 낮음)
// bar_track 32×10: 속이 빈 프레임 (안쪽 3,3~-3,-4 에 fill 을 깐다)
// ---------------------------------------------------------------

export type PanelVariant = 'gray' | 'blue' | 'orange';

export interface PanelOpts {
	variant?: PanelVariant;
	alpha?: number;
	/** 픽셀 배율 (기본 UI_PX=2) — 외곽선·코너가 이 배율로 그려진다 */
	px?: number;
	tint?: number;
	/** 0 = 좌상단 기준(기본), 0.5 = 중앙 기준 */
	origin?: number;
}

/** Flat 프레임 패널 (나인슬라이스). 반환 객체를 컨테이너에 넣거나 depth 를 지정해 쓴다. */
export function panel(
	scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOpts = {},
): Phaser.GameObjects.NineSlice {
	const { variant = 'gray', alpha = 1, px = UI_PX, tint, origin = 0 } = opts;
	const ns = scene.add.nineslice(x, y, `uf-frame-${variant}`, 0,
		Math.max(12, w / px), Math.max(12, h / px), 5, 5, 4, 4)
		.setScale(px).setOrigin(origin).setAlpha(alpha);
	if (tint !== undefined) ns.setTint(tint);
	return ns;
}

export type SlotKind =
	| 'gray' | 'slate' | 'ghost'
	| 'blue' | 'cyan' | 'ghostblue'
	| 'orange' | 'red' | 'ghostorange';

/** Flat 슬롯(32×32) — size 픽셀 정사각으로. ghost* 는 반투명(빈/잠김 표현). */
export function slot(
	scene: Phaser.Scene, x: number, y: number, size: number, kind: SlotKind = 'gray', px = UI_PX,
): Phaser.GameObjects.NineSlice {
	return scene.add.nineslice(x, y, `uf-slot-${kind}`, 0, size / px, size / px, 4, 4, 4, 4)
		.setScale(px).setOrigin(0.5);
}

/** 등급 카드: 회색 프레임 + 등급색 상단 밴드 + 등급색 코너 브래킷 (중심 0,0 컨테이너) */
export function rarityCard(
	scene: Phaser.Scene, w: number, h: number, rarity: RarityTheme,
	opts: { px?: number; alpha?: number; bandH?: number } = {},
): Phaser.GameObjects.Container {
	const { px = UI_PX, alpha = 1, bandH = 8 } = opts;
	const frame = panel(scene, 0, 0, w, h, { px, alpha, origin: 0.5 });
	// 등급색 밴드 (크림 fill 을 틴트 → 원색 유지)
	const band = scene.add.image(0, -h / 2 + px * 2 + bandH / 2, 'uf-fill-cream')
		.setDisplaySize(w - px * 6, bandH).setTint(rarity.num).setAlpha(alpha);
	// 등급색 코너 브래킷 (셀렉트 프레임 정지 1프레임)
	const corners = scene.add.nineslice(0, 0, 'uf-select-1', 0, (w + px * 8) / px, (h + px * 8) / px, 12, 12, 12, 12)
		.setScale(px).setOrigin(0.5).setTint(rarity.num).setAlpha(alpha);
	return scene.add.container(0, 0, [frame, band, corners]);
}

/** 인셋(내용) 패널 — 크림 입력필드 스프라이트. 회색 프레임 안의 콘텐츠 영역용. */
export function insetPanel(
	scene: Phaser.Scene, x: number, y: number, w: number, h: number,
	opts: { px?: number; alpha?: number; tint?: number; origin?: number } = {},
): Phaser.GameObjects.NineSlice {
	const { px = UI_PX, alpha = 1, tint, origin = 0 } = opts;
	const ns = scene.add.nineslice(x, y, 'uf-input', 0, Math.max(10, w / px), Math.max(10, h / px), 4, 4, 4, 5)
		.setScale(px).setOrigin(origin).setAlpha(alpha);
	if (tint !== undefined) ns.setTint(tint);
	return ns;
}

/** 셀렉트(선택) 코너 프레임 — 대상보다 살짝 크게 씌운다. */
export function selectFrame(
	scene: Phaser.Scene, x: number, y: number, w: number, h: number,
	opts: { px?: number; tint?: number } = {},
): Phaser.GameObjects.NineSlice {
	const { px = UI_PX, tint } = opts;
	const ns = scene.add.nineslice(x, y, 'uf-select-1', 0, w / px, h / px, 12, 12, 12, 12)
		.setScale(px).setOrigin(0.5);
	if (tint !== undefined) ns.setTint(tint);
	return ns;
}

/** 헤어라인 구분선 — 크림 fill 스트립 틴트 */
export function divider(
	scene: Phaser.Scene, cx: number, y: number, w: number, color = UI.steelDark,
): Phaser.GameObjects.Image {
	return scene.add.image(cx, y, 'uf-fill-cream')
		.setDisplaySize(w, 2).setTint(color).setAlpha(0.8);
}

export type GaugeFill = 'green' | 'teal' | 'red' | 'darkred' | 'orange' | 'cream' | 'dark';
export type GaugeTrack = 'track' | 'cream' | 'ticks';

export interface UiGauge {
	root: Phaser.GameObjects.Container;
	track: Phaser.GameObjects.NineSlice;
	fill: Phaser.GameObjects.Image;
	backing: Phaser.GameObjects.Image;
	/** 0~1 — 크롭 게이지 (0 근처는 숨김: crop 0폭 전체 렌더 버그 회피) */
	setRatio(ratio: number): void;
	setFillTint(tint: number): void;
	destroy(): void;
}

/** Flat 게이지: 어두운 백킹 + 색 fill(크롭) + 속 빈 트랙 프레임(맨 위) */
export function createGauge(
	scene: Phaser.Scene, x: number, y: number, w: number, h: number,
	opts: { fill?: GaugeFill; track?: GaugeTrack; px?: number; backingAlpha?: number } = {},
): UiGauge {
	const { fill = 'orange', track = 'track', px = UI_PX, backingAlpha = 0.9 } = opts;
	const innerX = 3 * px;
	const innerY = 3 * px;
	const innerW = Math.max(2, w - 6 * px);
	const innerH = Math.max(2, h - 7 * px);
	const backing = scene.add.image(innerX, innerY, 'uf-fill-dark')
		.setOrigin(0, 0).setDisplaySize(innerW, innerH).setAlpha(backingAlpha);
	const fillImg = scene.add.image(innerX, innerY, `uf-fill-${fill}`)
		.setOrigin(0, 0).setDisplaySize(innerW, innerH);
	const trackNs = scene.add.nineslice(0, 0, `uf-bar-${track}`, 0, w / px, h / px, 4, 4, 4, 4)
		.setScale(px).setOrigin(0, 0);
	const root = scene.add.container(x, y, [backing, fillImg, trackNs]);
	const FILL_TEX_W = 32;
	const FILL_TEX_H = 3;
	return {
		root, track: trackNs, fill: fillImg, backing,
		setRatio(ratio: number) {
			const clamped = Phaser.Math.Clamp(ratio, 0, 1);
			fillImg.setCrop(0, 0, FILL_TEX_W * clamped, FILL_TEX_H);
			fillImg.setVisible(clamped > 0.005 && root.visible);
		},
		setFillTint(tint: number) {
			fillImg.setTint(tint);
		},
		destroy() {
			root.destroy();
		},
	};
}

export interface UiSlider {
	/** 중심 (x, y) 기준 컨테이너 — 부모 컨테이너에 넣어 쓴다 */
	root: Phaser.GameObjects.Container;
	getValue(): number;
	setValue(value: number, notify?: boolean): void;
	setScrollFactor(value: number): UiSlider;
	destroy(): void;
}

/**
 * Flat 게이지 + 손잡이로 만든 슬라이더 (0~1).
 *
 * 드래그 중에는 씬 입력에 pointermove 를 물려 손잡이 밖으로 나가도 따라온다.
 * 좌표 변환은 카메라 스크롤·부모 컨테이너 스케일을 모두 고려한다 —
 * HUD/일시정지처럼 scrollFactor 0 인 UI 에서는 setScrollFactor(0) 을 함께 호출할 것.
 */
export function slider(
	scene: Phaser.Scene, x: number, y: number, w: number, value: number,
	opts: { h?: number; fill?: GaugeFill; px?: number; onChange?: (value: number) => void; onCommit?: (value: number) => void } = {},
): UiSlider {
	const { h = 18, fill = 'teal', px = UI_PX, onChange, onCommit } = opts;
	let current = Phaser.Math.Clamp(value, 0, 1);

	const gauge = createGauge(scene, -w / 2, -h / 2, w, h, { fill, px });
	gauge.setRatio(current);

	// 손잡이 — 버튼 스프라이트 소형 (팩 원본, 절차 드로잉 없음)
	const knobW = 24;
	const knobH = h + 12;
	const knob = scene.add.nineslice(0, 0, 'uf-btn2-3', 0, knobW / px, knobH / px, 5, 5, 5, 6)
		.setScale(px).setOrigin(0.5);

	const zone = scene.add.zone(0, 0, w + 20, knobH + 12).setInteractive({ useHandCursor: true });

	const root = scene.add.container(x, y, [gauge.root, knob, zone]);

	const tmpMatrix = new Phaser.GameObjects.Components.TransformMatrix();
	const tmpParent = new Phaser.GameObjects.Components.TransformMatrix();
	const tmpPoint = new Phaser.Math.Vector2();

	const layout = () => {
		gauge.setRatio(current);
		knob.x = -w / 2 + current * w;
	};
	layout();

	const ratioFromPointer = (pointer: Phaser.Input.Pointer): number => {
		const camera = scene.cameras.main;
		const pxCoord = pointer.worldX + camera.scrollX * zone.scrollFactorX - camera.scrollX;
		const pyCoord = pointer.worldY + camera.scrollY * zone.scrollFactorY - camera.scrollY;
		zone.getWorldTransformMatrix(tmpMatrix, tmpParent);
		tmpMatrix.applyInverse(pxCoord, pyCoord, tmpPoint);
		return Phaser.Math.Clamp((tmpPoint.x + w / 2) / w, 0, 1);
	};

	const apply = (next: number, notify = true) => {
		const clamped = Phaser.Math.Clamp(next, 0, 1);
		if (Math.abs(clamped - current) < 0.001) {
			return;
		}
		current = clamped;
		layout();
		if (notify) {
			onChange?.(current);
		}
	};

	let dragging = false;
	const onMove = (pointer: Phaser.Input.Pointer) => {
		if (dragging) {
			apply(ratioFromPointer(pointer));
		}
	};
	const onUp = () => {
		if (!dragging) {
			return;
		}
		dragging = false;
		onCommit?.(current);
	};

	zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
		dragging = true;
		apply(ratioFromPointer(pointer));
	});
	scene.input.on('pointermove', onMove);
	scene.input.on('pointerup', onUp);
	scene.input.on('pointerupoutside', onUp);

	return {
		root,
		getValue: () => current,
		setValue: (next: number, notify = false) => apply(next, notify),
		setScrollFactor(factor: number) {
			root.setScrollFactor(factor);
			zone.setScrollFactor(factor);
			return this;
		},
		destroy() {
			scene.input.off('pointermove', onMove);
			scene.input.off('pointerup', onUp);
			scene.input.off('pointerupoutside', onUp);
			root.destroy();
		},
	};
}

// ---------------------------------------------------------------
// 키캡 / 버튼
// ---------------------------------------------------------------

/** 키캡 — 라운드 소형 버튼 스프라이트 + 잉크 라벨 */
export function keycap(scene: Phaser.Scene, x: number, y: number, label: string, size = 13): Phaser.GameObjects.Container {
	const w = Math.max(26, label.length * (size * 0.62) + 16);
	const h = size + 13;
	const px = UI_PX;
	const bg = scene.add.nineslice(0, 0, 'uf-btn2-3', 0, w / px, h / px, 5, 5, 5, 6)
		.setScale(px).setOrigin(0.5);
	const text = scene.add.text(0, -1, label, style(size, UI.textDim, { display: true })).setOrigin(0.5);
	return scene.add.container(x, y, [bg, text]);
}

// ---------------------------------------------------------------
// 히트 영역 규약 (2026-09-02)
//
// Phaser 는 hitAreaCallback 직전에 로컬 좌표에 displayOrigin 을 더한다
// (InputManager.pointWithinHitArea). 그래서 **origin 0.5 인 객체의 올바른
// 히트 사각형은 언제나 (0,0,w,h) 기준**이고, 여기서 좌상단을 음수로 미는 건
// 순수한 "바깥 패딩"으로만 쓰인다. (-w/2 로 중앙 정렬하려 들면 판정이
// 통째로 좌상단으로 밀린다 — 절대 금지.)
//
// 최소 터치 타깃: 44px. 시각 크기가 그보다 작으면 그 차이의 절반씩
// 사방으로 넓힌다. 시각 크기보다 좁아지는 일은 없다.
// ---------------------------------------------------------------

export const MIN_TOUCH = 44;

/** 시각 크기 w×h 를 최소 터치 타깃까지 키우기 위한 좌우/상하 바깥 패딩 */
export function hitPadding(w: number, h: number, min = MIN_TOUCH): { x: number; y: number } {
	return {
		x: Math.max(0, (min - w) / 2),
		y: Math.max(0, (min - h) / 2),
	};
}

interface HitExpandable {
	width?: number;
	height?: number;
	displayWidth?: number;
	displayHeight?: number;
	setInteractive(config?: unknown): unknown;
	input: Phaser.Types.Input.InteractiveObject | null;
}

/**
 * 작은 인터랙티브 객체(✕ 닫기 글자·탭 라벨·아이콘)의 히트 영역을 최소 터치
 * 타깃까지 넓힌다. 이미 setInteractive 된 뒤에 불러도 되고, 아직이면 켜 준다.
 *
 * 좌표계는 위의 규약대로 (0,0,w,h) 기준 — origin 이 0.5 든 0 이든 Phaser 가
 * displayOrigin 으로 정규화해 주므로 이 한 가지 표현이면 충분하다.
 *
 * `scale` 은 이 객체가 최종적으로 그려질 배율(UiRoot 안이면 uiScaleFor).
 * 44px 은 **화면 픽셀** 기준이라, 축소 컨테이너 안에서는 그만큼 크게 잡는다.
 */
export function expandHit<T extends Phaser.GameObjects.GameObject>(
	target: T,
	opts: { min?: number; minW?: number; minH?: number; scale?: number; useHandCursor?: boolean } = {},
): T {
	const { min = MIN_TOUCH, scale = 1, useHandCursor = true } = opts;
	const minW = opts.minW ?? min;
	const minH = opts.minH ?? min;
	const go = target as unknown as HitExpandable;
	if (!go.input) {
		go.setInteractive({ useHandCursor });
	}
	const input = go.input;
	if (!input) {
		return target;
	}
	// hitArea 는 **스케일이 적용되기 전** 로컬 단위다 (Phaser 가 displayOrigin =
	// originX * width, 즉 원본 크기로 정규화하기 때문). setDisplaySize 로 줄인
	// 스프라이트는 width(원본) ≠ displayWidth(화면) 이므로 둘을 구분해 쓴다.
	const w = Math.max(1, go.width ?? go.displayWidth ?? 0);
	const h = Math.max(1, go.height ?? go.displayHeight ?? 0);
	const selfScaleX = Math.max(0.01, (go.displayWidth ?? w) / w);
	const selfScaleY = Math.max(0.01, (go.displayHeight ?? h) / h);
	const s = Math.max(0.1, scale);
	const pad = {
		x: Math.max(0, (minW / (s * selfScaleX) - w) / 2),
		y: Math.max(0, (minH / (s * selfScaleY) - h) / 2),
	};
	if (pad.x === 0 && pad.y === 0) {
		return target;
	}
	input.hitArea = new Phaser.Geom.Rectangle(-pad.x, -pad.y, w + pad.x * 2, h + pad.y * 2);
	input.hitAreaCallback = Phaser.Geom.Rectangle.Contains;
	return target;
}

export type ButtonVariant = 'gold' | 'dark' | 'red' | 'ghost';

export interface UiButton {
	container: Phaser.GameObjects.Container;
	bg: Phaser.GameObjects.NineSlice;
	label: Phaser.GameObjects.Text;
	sub: Phaser.GameObjects.Text | null;
	setLabel: (text: string) => void;
	setEnabled: (enabled: boolean) => void;
	redraw: (variant?: ButtonVariant) => void;
}

// variant 'gold' = 주 행동(강판+담금 청 보더 원본이 가장 밝다), 'dark' = 보조(무광 틴트),
// 'red' = 위험(잉걸 워밍 틴트), 'ghost' = 희미. 틴트는 곱연산이라 어둡게만 만든다.
const BUTTON_FILL: Record<ButtonVariant, { tint: number | null; text: string }> = {
	gold: { tint: null, text: '#8fc3d8' },
	dark: { tint: 0x9aa4ad, text: '#dfe6ea' },
	red: { tint: 0xffa07a, text: '#f0a077' },
	ghost: { tint: 0x767e88, text: '#8d9aa5' },
};

// 상태별 버튼 텍스처: 기본은 _3(들림), 호버 _4(더 들림), 눌림 _1(가라앉음).
const BTN_TEX = { normal: 'uf-btn-3', hover: 'uf-btn-4', press: 'uf-btn-1', disabled: 'uf-btn-2' };

export function button(
	scene: Phaser.Scene, x: number, y: number, w: number, h: number, labelText: string,
	opts: {
		variant?: ButtonVariant; fontSize?: number; display?: boolean; key?: string;
		sub?: string; icon?: string; onClick?: () => void; depth?: number; ornate?: boolean;
	} = {},
): UiButton {
	const { variant = 'dark', fontSize = 16, display = false, key, sub, icon, onClick, depth } = opts;
	let currentVariant = variant;
	let enabled = true;
	const px = UI_PX;

	const bg = scene.add.nineslice(0, 0, BTN_TEX.normal, 0, w / px, h / px, 5, 5, 6, 7)
		.setScale(px).setOrigin(0.5);
	const apply = (v: ButtonVariant, state: keyof typeof BTN_TEX = 'normal') => {
		// 버튼이 이미 파괴된 뒤 delayedCall(90) 등에서 호출되면 setTexture가
		// undefined.sys를 읽으며 던지고, 그 예외가 RAF 루프를 죽여 게임 전체가
		// 멈춘다(대장간→장비 전환 프리즈의 원인). 파괴됐으면 조용히 무시.
		if (!bg.scene || !bg.active) return;
		const c = BUTTON_FILL[v];
		bg.setTexture(state === 'disabled' ? BTN_TEX.disabled : BTN_TEX[state]);
		bg.setSize(w / px, h / px);
		if (c.tint !== null) bg.setTint(c.tint); else bg.clearTint();
	};
	apply(currentVariant);

	const parts: Phaser.GameObjects.GameObject[] = [bg];
	let iconObj: Phaser.GameObjects.GameObject | null = null;
	if (icon) {
		iconObj = iconImage(scene, icon, -w / 2 + 18, sub ? -8 : 0, fontSize + 6, BUTTON_FILL[variant].text);
		parts.push(iconObj);
	}

	const textX = iconObj ? 8 : 0;
	const label = scene.add.text(textX, sub ? -9 : 0, labelText,
		style(fontSize, BUTTON_FILL[variant].text, { display })).setOrigin(0.5);
	parts.push(label);

	let subText: Phaser.GameObjects.Text | null = null;
	if (sub) {
		subText = scene.add.text(textX, 11, sub, style(Math.max(10, fontSize - 5), BUTTON_FILL[variant].text)).setOrigin(0.5);
		subText.setAlpha(0.75);
		parts.push(subText);
	}

	if (key) {
		// 키캡이 버튼 오른쪽 밖으로 삐져나가지 않게 실제 폭으로 안쪽 배치
		const capSize = Math.max(11, fontSize - 4);
		const capW = Math.max(26, key.length * (capSize * 0.62) + 16);
		parts.push(keycap(scene, w / 2 - capW / 2 - 8, 0, key, capSize));
	}

	const container = scene.add.container(x, y, parts);
	if (depth !== undefined) container.setDepth(depth);
	container.setSize(w, h);
	// ── 히트 영역 (2026-09-02 대형 버그 수정)
	//
	// Phaser 는 hitAreaCallback 을 부르기 직전에 로컬 좌표를 displayOrigin 으로
	// **정규화**한다 (InputManager.pointWithinHitArea: `x += gameObject.displayOriginX`).
	// 컨테이너의 displayOrigin 은 setSize(w,h) 가 정한 (w/2, h/2) 이므로,
	// 중앙 정렬 컨테이너의 올바른 히트 사각형은 (0,0,w,h) 다 — Phaser 기본값과 같다.
	//
	// 예전 코드는 "기본 (0,0,w,h) 는 좌상단 절반이 죽는다"고 오해해 (-w/2,-h/2,w,h)
	// 를 넣었는데, 그러면 정규화가 한 번 더 얹혀 판정 영역이 좌상단으로 (w/2,h/2)
	// 만큼 통째로 밀린다. 실제로 눌리는 곳은 버튼의 좌상단 1/4 뿐 —
	// "게임 안의 모든 버튼이 잘 안 눌린다" 제보의 원인이었다.
	//
	// 여기에 더해 최소 터치 타깃(44px)을 보장하려고 바깥으로 패딩을 준다.
	// 시각 크기보다 작아지는 일은 절대 없다(패딩은 음수가 되지 않는다).
	//
	// 44px 은 **화면 픽셀** 기준이다. 버튼은 UiRoot(= uiScaleFor 배율) 안에서
	// 축소되어 그려지므로, 디자인 좌표에서는 그만큼 크게 잡아야 1280×720 같은
	// 작은 뷰포트에서도 실제 44px 이 나온다.
	const pad = hitPadding(w, h, MIN_TOUCH / Math.max(0.1, uiScaleFor(scene)));
	container.setInteractive({
		hitArea: new Phaser.Geom.Rectangle(-pad.x, -pad.y, w + pad.x * 2, h + pad.y * 2),
		hitAreaCallback: Phaser.Geom.Rectangle.Contains,
		useHandCursor: true,
	});
	container.on('pointerover', () => { if (enabled) apply(currentVariant, 'hover'); });
	container.on('pointerout', () => { if (enabled) apply(currentVariant); });
	container.on('pointerdown', () => {
		if (!enabled) return;
		apply(currentVariant, 'press');
		scene.time.delayedCall(90, () => { if (enabled) apply(currentVariant); });
		onClick?.();
	});

	return {
		container, bg, label, sub: subText,
		setLabel: (t: string) => label.setText(t),
		setEnabled: (v: boolean) => {
			enabled = v;
			container.setAlpha(v ? 1 : 0.55);
			apply(currentVariant, v ? 'normal' : 'disabled');
		},
		redraw: (v?: ButtonVariant) => {
			if (v) currentVariant = v;
			apply(currentVariant, enabled ? 'normal' : 'disabled');
			label.setColor(BUTTON_FILL[currentVariant].text);
		},
	};
}

// ---------------------------------------------------------------
// 배너 / 타이틀 장식
// ---------------------------------------------------------------

/** 리본 배너 (타이틀·웨이브 알림) — 좌우 접힌 귀는 나인슬라이스 코너로 보존 */
export function banner(
	scene: Phaser.Scene, cx: number, cy: number, w: number,
	opts: { variant?: 1 | 2 | 3 | 4; px?: number; h?: number; tint?: number } = {},
): Phaser.GameObjects.NineSlice {
	const { variant = 1, px = UI_PX, h = 20 * (opts.px ?? UI_PX), tint } = opts;
	const ns = scene.add.nineslice(cx, cy, `uf-banner-${variant}`, 0, w / px, h / px, 10, 10, 6, 3)
		.setScale(px).setOrigin(0.5);
	if (tint !== undefined) ns.setTint(tint);
	return ns;
}

/** 전체 화면 딤 + 비네트 (기존 유지, 톤만 차갑게) */
export function dimVignette(scene: Phaser.Scene, depth: number, alpha = 0.82): Phaser.GameObjects.GameObject[] {
	const { width, height } = scene.scale;
	const dim = scene.add.rectangle(width / 2, height / 2, width, height, 0x0a0d10, alpha)
		.setScrollFactor(0).setDepth(depth);
	const vig = scene.add.graphics().setScrollFactor(0).setDepth(depth);
	vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0.5, 0, 0);
	vig.fillRect(0, 0, width, height * 0.2);
	vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.55, 0.55);
	vig.fillRect(0, height * 0.8, width, height * 0.2);
	return [dim, vig];
}

/** 정철 조각(통화) — 육각 합금 칩. 이름은 기존 API 호환용으로 coin 유지 */
export function coin(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r = 7) {
	const hex = (radius: number) => {
		g.beginPath();
		for (let i = 0; i < 6; i += 1) {
			const a = Math.PI / 6 + (i * Math.PI) / 3;
			const px = cx + radius * Math.cos(a);
			const py = cy + radius * Math.sin(a);
			if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
		}
		g.closePath();
	};
	g.fillStyle(0x7d6224, 1);
	hex(r); g.fillPath();
	g.fillStyle(0xd9a83c, 1);
	hex(r - 1.2); g.fillPath();
	g.fillStyle(0xf0d488, 0.85);
	g.fillCircle(cx - r * 0.26, cy - r * 0.3, r * 0.3);
	g.lineStyle(1, 0x5c471a, 1);
	hex(r - 0.8); g.strokePath();
}

// ---------------------------------------------------------------
// 글리프 시스템 — 이모지 대체용 코드 드로잉 아이콘.
// BootScene 에서 ensureGlyphs(scene) 1회 호출 → 텍스처 생성(게임 전역).
// 텍스처는 밝은 회백색으로 그려 tint 로 색을 입힌다.
// ---------------------------------------------------------------

const G = 32; // 텍스처 크기
const GLYPH_COLOR = 0xdfe6ea;

type GlyphDrawFn = (g: Phaser.GameObjects.Graphics) => void;

function strokeLines(g: Phaser.GameObjects.Graphics, pts: Array<[number, number]>, width = 2.6, close = false) {
	g.lineStyle(width, GLYPH_COLOR, 1);
	g.beginPath();
	g.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i][0], pts[i][1]);
	if (close) g.closePath();
	g.strokePath();
}

function fillPoly(g: Phaser.GameObjects.Graphics, pts: Array<[number, number]>, color = GLYPH_COLOR, alpha = 1) {
	g.fillStyle(color, alpha);
	g.beginPath();
	g.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i][0], pts[i][1]);
	g.closePath();
	g.fillPath();
}

const GLYPH_DRAWS: Record<string, GlyphDrawFn> = {
	// 칼끝(공격) — 사선 검신 + 슴베
	'g-blade': (g) => {
		fillPoly(g, [[6, 26], [22, 5], [26, 9], [10, 27]]);
		strokeLines(g, [[8, 21], [13, 26]], 3);
		strokeLines(g, [[5, 29], [9, 25]], 2.4);
	},
	// 깃(속도·발사)
	'g-feather': (g) => {
		g.lineStyle(2.6, GLYPH_COLOR, 1);
		g.beginPath(); g.moveTo(7, 27); g.lineTo(24, 6); g.strokePath();
		for (let i = 0; i < 4; i += 1) {
			const t = 8 + i * 4.6;
			strokeLines(g, [[7 + t * 0.62, 27 - t * 0.78], [4 + t * 0.62, 27 - t * 0.78 - 5.5 + i * 0.4]], 2.2);
		}
	},
	// 화로(체력·심장) — 화로 그릇 + 잉걸
	'g-furnace': (g) => {
		strokeLines(g, [[7, 12], [7, 22], [10, 27], [22, 27], [25, 22], [25, 12]], 2.6);
		strokeLines(g, [[4, 12], [28, 12]], 2.6);
		fillPoly(g, [[16, 15], [20, 20], [16, 24], [12, 20]]);
	},
	// 방패(방어)
	'g-shield': (g) => {
		strokeLines(g, [[16, 4], [26, 8], [26, 17], [16, 28], [6, 17], [6, 8]], 2.6, true);
		strokeLines(g, [[16, 9], [16, 23]], 2.2);
	},
	// 부츠 → 겹화살(이동)
	'g-boot': (g) => {
		strokeLines(g, [[8, 6], [18, 16], [8, 26]], 3);
		strokeLines(g, [[16, 6], [26, 16], [16, 26]], 3);
	},
	// 물방울(재생·독)
	'g-drop': (g) => {
		g.lineStyle(2.6, GLYPH_COLOR, 1);
		g.beginPath();
		g.moveTo(16, 4);
		g.lineTo(24, 17);
		g.arc(16, 20, 8, Phaser.Math.DegToRad(-20), Phaser.Math.DegToRad(200), false);
		g.strokePath();
	},
	// 자석(획득 범위)
	'g-magnet': (g) => {
		g.lineStyle(3.2, GLYPH_COLOR, 1);
		g.beginPath();
		g.arc(16, 14, 9, Math.PI, 0, false);
		g.strokePath();
		strokeLines(g, [[7, 14], [7, 24]], 3.2);
		strokeLines(g, [[25, 14], [25, 24]], 3.2);
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillRect(4.5, 24, 5.5, 4);
		g.fillRect(22.5, 24, 5.5, 4);
	},
	// 정철 칩(골드)
	'g-chip': (g) => {
		const pts: Array<[number, number]> = [];
		for (let i = 0; i < 6; i += 1) {
			const a = Math.PI / 6 + (i * Math.PI) / 3;
			pts.push([16 + 11 * Math.cos(a), 16 + 11 * Math.sin(a)]);
		}
		strokeLines(g, pts, 2.6, true);
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(16, 16, 3.2);
	},
	// 불꽃(치명타)
	'g-spark': (g) => {
		fillPoly(g, [[16, 3], [19, 13], [29, 16], [19, 19], [16, 29], [13, 19], [3, 16], [13, 13]]);
	},
	// 눈(명중·치명 확률)
	'g-eye': (g) => {
		g.lineStyle(2.4, GLYPH_COLOR, 1);
		g.beginPath(); g.moveTo(4, 16); g.lineTo(16, 8); g.lineTo(28, 16); g.lineTo(16, 24); g.closePath(); g.strokePath();
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(16, 16, 4);
	},
	// 길조(행운) — 나는 새 한 획
	'g-bird': (g) => {
		g.lineStyle(2.8, GLYPH_COLOR, 1);
		g.beginPath(); g.arc(10, 16, 6.5, Math.PI * 1.15, Math.PI * 1.95, false); g.strokePath();
		g.beginPath(); g.arc(22, 16, 6.5, Math.PI * 1.05, Math.PI * 1.85, false); g.strokePath();
	},
	// 자물쇠(잠금)
	'g-lock': (g) => {
		g.lineStyle(2.8, GLYPH_COLOR, 1);
		g.beginPath(); g.arc(16, 12, 6, Math.PI, 0, false); g.strokePath();
		strokeLines(g, [[10, 12], [10, 15]], 2.8);
		strokeLines(g, [[22, 12], [22, 15]], 2.8);
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillRect(7, 15, 18, 13);
	},
	// 자맥(난이도 깊이) — 겹호
	'g-vein': (g) => {
		for (let i = 0; i < 3; i += 1) {
			g.lineStyle(2.4, GLYPH_COLOR, 1 - i * 0.25);
			g.beginPath();
			g.arc(16, 24 - i * 1.5, 6 + i * 5, Math.PI * 1.12, Math.PI * 1.88, false);
			g.strokePath();
		}
	},
	// 선회 고리(궤도)
	'g-ring': (g) => {
		g.lineStyle(2.6, GLYPH_COLOR, 1);
		g.strokeCircle(16, 16, 10);
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(26, 12, 3);
	},
	// 가시(반사)
	'g-fang': (g) => {
		fillPoly(g, [[8, 26], [11, 8], [14, 26]]);
		fillPoly(g, [[16, 26], [19, 5], [22, 26]]);
		fillPoly(g, [[24, 26], [26, 12], [28, 26]]);
	},
	// 쇳밥(경험치) — 부스러기 더미
	'g-filings': (g) => {
		g.fillStyle(GLYPH_COLOR, 1);
		fillPoly(g, [[16, 10], [19, 13], [16, 16], [13, 13]]);
		fillPoly(g, [[9, 19], [12, 22], [9, 25], [6, 22]]);
		fillPoly(g, [[23, 19], [26, 22], [23, 25], [20, 22]]);
		fillPoly(g, [[16, 21], [19, 24], [16, 27], [13, 24]]);
	},
	// 모래시계(쿨다운)
	'g-hourglass': (g) => {
		strokeLines(g, [[8, 5], [24, 5]], 2.8);
		strokeLines(g, [[8, 27], [24, 27]], 2.8);
		strokeLines(g, [[10, 5], [10, 9], [16, 16], [10, 23], [10, 27]], 2.4);
		strokeLines(g, [[22, 5], [22, 9], [16, 16], [22, 23], [22, 27]], 2.4);
		fillPoly(g, [[16, 16], [20, 23], [12, 23]]);
	},
	// 십자(회복)
	'g-cross': (g) => {
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillRect(12.5, 5, 7, 22);
		g.fillRect(5, 12.5, 22, 7);
	},
	// 책→도감(경험치 획득량)
	'g-scroll': (g) => {
		strokeLines(g, [[8, 5], [24, 5], [24, 27], [8, 27]], 2.6, true);
		strokeLines(g, [[12, 11], [20, 11]], 2.2);
		strokeLines(g, [[12, 16], [20, 16]], 2.2);
		strokeLines(g, [[12, 21], [17, 21]], 2.2);
	},
	// 우두머리 표식(보스·정예)
	'g-crown': (g) => {
		fillPoly(g, [[6, 24], [6, 12], [12, 17], [16, 8], [20, 17], [26, 12], [26, 24]]);
	},
	// 해골 대체 — 녹 표식(적·위험): 삭은 원 + 결손
	'g-rust': (g) => {
		g.lineStyle(2.8, GLYPH_COLOR, 1);
		g.beginPath(); g.arc(16, 16, 10, Phaser.Math.DegToRad(30), Phaser.Math.DegToRad(330), false); g.strokePath();
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(12, 13, 2.2);
		g.fillCircle(21, 18, 1.8);
		g.fillCircle(16, 23, 1.5);
	},
	// 되지핌(부활) — 화로 불씨 위 상승 획
	'g-rekindle': (g) => {
		strokeLines(g, [[8, 27], [24, 27]], 2.8);
		fillPoly(g, [[16, 12], [20, 18], [16, 23], [12, 18]]);
		strokeLines(g, [[16, 10], [16, 4]], 2.6);
		strokeLines(g, [[12, 8], [16, 4], [20, 8]], 2.6);
	},
	// 모루(담금질)
	'g-anvil': (g) => {
		fillPoly(g, [[5, 11], [27, 11], [24, 16], [18, 18], [18, 23], [23, 26], [9, 26], [14, 23], [14, 18], [9, 16]]);
		strokeLines(g, [[3, 8], [12, 8]], 2.6);
	},
	// 궤짝(전리품)
	'g-crate': (g) => {
		strokeLines(g, [[5, 10], [27, 10], [27, 27], [5, 27]], 2.6, true);
		strokeLines(g, [[5, 10], [8, 5], [24, 5], [27, 10]], 2.4);
		strokeLines(g, [[16, 10], [16, 27]], 2.2);
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillRect(13, 15, 6, 5);
	},
	// 혈통 글리프
	'g-el-fire': (g) => {
		fillPoly(g, [[16, 4], [24, 16], [16, 28], [8, 16]]);
		g.fillStyle(0x101317, 1);
		g.fillCircle(16, 17, 3.4);
	},
	'g-el-electric': (g) => {
		fillPoly(g, [[19, 3], [9, 17], [15, 17], [12, 29], [24, 13], [17, 13]]);
	},
	'g-el-poison': (g) => {
		g.lineStyle(2.8, GLYPH_COLOR, 1);
		g.beginPath();
		g.moveTo(16, 4);
		g.lineTo(24, 17);
		g.arc(16, 20, 8, Phaser.Math.DegToRad(-20), Phaser.Math.DegToRad(200), false);
		g.strokePath();
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(16, 20, 3);
	},
	'g-el-void': (g) => {
		g.fillStyle(GLYPH_COLOR, 1);
		g.fillCircle(16, 16, 11);
		g.fillStyle(0x101317, 1);
		g.fillCircle(20, 13, 9);
	},
	'g-el-gold': (g) => {
		g.lineStyle(2.6, GLYPH_COLOR, 1);
		g.strokeCircle(16, 16, 10);
		strokeLines(g, [[10, 20], [16, 12], [21, 17]], 2.4);
	},
	// 눈송이(얼음): 세 축 교차
	'g-el-ice': (g) => {
		strokeLines(g, [[16, 4], [16, 28]], 2.6);
		strokeLines(g, [[6, 10], [26, 22]], 2.6);
		strokeLines(g, [[6, 22], [26, 10]], 2.6);
		strokeLines(g, [[12, 6], [16, 10], [20, 6]], 2.0);
		strokeLines(g, [[12, 26], [16, 22], [20, 26]], 2.0);
	},
	// 핏방울(피)
	'g-el-blood': (g) => {
		fillPoly(g, [[16, 3], [23, 15], [21, 23], [16, 27], [11, 23], [9, 15]]);
		g.fillStyle(0x101317, 1);
		g.fillCircle(13, 19, 2.2);
	},
	// 돌풍(바람): 세 겹 흐름선
	'g-el-wind': (g) => {
		g.lineStyle(2.6, GLYPH_COLOR, 1);
		g.beginPath();
		g.moveTo(5, 10);
		g.lineTo(21, 10);
		g.arc(21, 13, 3, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(180), false);
		g.strokePath();
		strokeLines(g, [[5, 17], [26, 17]], 2.6);
		g.beginPath();
		g.moveTo(5, 24);
		g.lineTo(17, 24);
		g.arc(17, 21, 3, Phaser.Math.DegToRad(90), Phaser.Math.DegToRad(-180), true);
		g.strokePath();
	},
};

/** 글리프 텍스처 생성 (여러 번 불러도 안전) */
export function ensureGlyphs(scene: Phaser.Scene): void {
	for (const [key, draw] of Object.entries(GLYPH_DRAWS)) {
		if (scene.textures.exists(key)) {
			continue;
		}
		const g = scene.make.graphics({ x: 0, y: 0 } as Phaser.Types.GameObjects.Graphics.Options, false);
		draw(g);
		g.generateTexture(key, G, G);
		g.destroy();
	}
}

export function hasGlyph(key: string | undefined | null): key is string {
	return Boolean(key && key.startsWith('g-') && GLYPH_DRAWS[key]);
}

/**
 * 아이콘 헬퍼: 글리프 키('g-*')면 텍스처 이미지, 아니면 텍스트로 렌더.
 * size = 대략적 표시 크기(px). tint 는 CSS 색 또는 숫자.
 */
export function iconImage(
	scene: Phaser.Scene, key: string, x: number, y: number, size: number,
	tint: string | number = UI.text,
): Phaser.GameObjects.Image | Phaser.GameObjects.Text {
	const tintNum = typeof tint === 'number' ? tint : Phaser.Display.Color.HexStringToColor(tint).color;
	if (hasGlyph(key) && scene.textures.exists(key)) {
		return scene.add.image(x, y, key).setDisplaySize(size, size).setTint(tintNum);
	}
	return scene.add.text(x, y, key, { fontSize: `${size}px` }).setOrigin(0.5);
}
