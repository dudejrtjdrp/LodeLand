// 부유 데미지 숫자 전용 비트맵 폰트.
//
// 왜 필요한가 (계측 근거, texunit-test.mjs):
//   Phaser의 `Text`는 객체마다 **자기 캔버스 텍스처**를 갖는다. 라운드 35 화면에서
//   고유 텍스처 33개 중 17개가 Text 였고, Phaser가 동시에 바인딩할 수 있는 텍스처는
//   16개뿐(`renderer.maxTextures`)이라 한도를 넘겨 배치가 끊기고 있었다.
//   게다가 값이 바뀔 때마다 캔버스를 다시 굽고 GPU로 다시 올린다.
//
//   BitmapText 는 폰트 텍스처 **한 장**에서 글리프 쿼드만 뽑는다 — 텍스처 1개,
//   재굽기 0회, 색·크기 변경 비용 0.
//
// 설계:
//   색상마다 폰트를 따로 만들되 **텍스처는 한 장을 공유**한다(RetroFont 의 offset.y 로
//   행을 나눈다). setTint 를 쓰지 않는 이유는 Phaser.AUTO 가 Canvas 로 폴백하면
//   tint 가 무시되어 색이 전부 흰색이 되기 때문이다.
//   치명타는 폰트를 따로 두지 않고 `setScale` 로 키운다 — 비트맵이라 확대가 공짜다.
//
// 2026-09-04 "메이플식" 개편 → 사용자 선택 스킨 **C 네온 글로우** (scripts/dmg-skin-mockup.html):
//   - 글리프마다 **세로 그라데이션**(위 하양 → 아래 본색) + 얇은 검 외곽선(3px) + 색 글로우(블러 14).
//     어두운 맵에서 숫자가 빛나듯 떠 보인다.
//   - 글리프 48px 로 키워 5만·50만 단위 숫자도 뭉개지지 않게.
//   - 큰 수 축약(12M)용 'KMB.' 글리프 추가.

import Phaser from 'phaser';
import { FONT } from './theme';

/** 데미지 표기에 필요한 글리프. 한글 라벨(회피/방어/처형)은 기존 Text 경로가 담당한다. */
const CHARS = '0123456789+-!.KMB';
/** 글리프를 그릴 때 쓰는 실제 글자 크기(px). 표시 크기는 setScale 로 맞춘다. */
const GLYPH_PX = 48;
/** 외곽선 두께 — 스킨 C 는 얇은 외곽선 + 글로우 */
const STROKE_W = 3;
/** 글로우 블러 반경(px) — 셀 여백에 포함돼야 잘리지 않는다 */
const GLOW_BLUR = 14;
/** 셀 여백: 외곽선 + 글로우 */
const CELL_PAD = STROKE_W + GLOW_BLUR;
/** 셀 높이: 글자 + 외곽선·글로우 여유 */
const CELL_H = Math.round(GLYPH_PX * 1.4) + GLOW_BLUR;
/**
 * 셀 폭은 폰트 로드 후 실측해서 정한다.
 * RetroFont 는 고정폭이라 셀이 넓으면 숫자 사이가 벌어져 보인다 — 가장 넓은 글리프에
 * 맞춰 최소로 잡아야 "9 9 9" 가 아니라 "999" 로 보인다.
 */
let cellWidth = Math.round(GLYPH_PX * 0.7);

export const DAMAGE_FONT_TEXTURE = 'damage-font-tex';

/**
 * 데미지 숫자 색상표. 여기 순서가 곧 폰트 텍스처의 행 순서이며,
 * 폰트 키는 `damage-font-${index}` 가 된다. 값은 **기준색**(호출부가 넘기는 색)이고,
 * 실제 글리프는 DAMAGE_FONT_GRADIENTS 의 위/아래 색으로 그라데이션 칠한다.
 */
export const DAMAGE_FONT_COLORS = [
	'#e8eef2', // 0 일반 물리
	'#d9a83c', // 1 치명타 / 고정 피해
	'#93c5fd', // 2 마법
	'#fde047', // 3 저항 무시
	'#94a3b8', // 4 회피 등 흐린 표기
	'#38bdf8', // 5 방어
	'#84b04a', // 6 회복
	'#ffab5e', // 7 약점(상성)
	'#e879f9', // 8 궁극기 / 처형
	'#ff7a7a', // 9 키퍼가 받은 피해
] as const;

/** 행별 그라데이션 [위, 아래] — 위는 거의 하양(밝은 코어), 아래로 갈수록 본색. */
const DAMAGE_FONT_GRADIENTS: Record<number, [string, string]> = {
	0: ['#ffffff', '#dfe9f5'],
	1: ['#fff6cc', '#ff8a00'],
	2: ['#ffffff', '#6fb0ff'],
	3: ['#ffffff', '#f5c400'],
	4: ['#e3e9ee', '#8a96a2'],
	5: ['#ffffff', '#1ea7e8'],
	6: ['#ffffff', '#7ad14a'],
	7: ['#ffffff', '#ff8a2a'],
	8: ['#ffffff', '#d94cf0'],
	9: ['#ffffff', '#e03c3c'],
};

/** 행별 글로우 색 (스킨 C) */
const DAMAGE_FONT_GLOWS: Record<number, string> = {
	0: '#8fb8ff', 1: '#ff9a2e', 2: '#4f9dff', 3: '#ffd21f', 4: '#6b7b8a',
	5: '#1ea7e8', 6: '#6fd14a', 7: '#ff8a2a', 8: '#d94cf0', 9: '#ff4d4d',
};

export type DamageFontColor = (typeof DAMAGE_FONT_COLORS)[number];

/** 색 문자열 → 폰트 키. 표에 없는 색은 일반 색으로 떨어뜨린다. */
export function damageFontKey(color: string | null | undefined): string {
	const index = color ? DAMAGE_FONT_COLORS.indexOf(color as DamageFontColor) : 0;
	return `damage-font-${index < 0 ? 0 : index}`;
}

/** 표에 없는 색인지 (그렇다면 호출부가 기존 Text 경로로 폴백해야 한다). */
export function hasDamageFontColor(color: string | null | undefined): boolean {
	return !color || DAMAGE_FONT_COLORS.includes(color as DamageFontColor);
}

/**
 * 색상별 글리프 행을 한 캔버스에 그리고, 행마다 RetroFont 를 등록한다.
 * BootScene.create 에서 1회 호출. 이미 만들어져 있으면 아무것도 하지 않는다.
 */
export function ensureDamageFont(scene: Phaser.Scene): void {
	if (scene.textures.exists(DAMAGE_FONT_TEXTURE)) {
		return;
	}

	const cols = CHARS.length;
	const rows = DAMAGE_FONT_COLORS.length;
	const fontSpec = `900 ${GLYPH_PX}px ${FONT.display}`;

	// 1) 가장 넓은 글리프를 실측해 셀 폭을 정한다 (고정폭 폰트라 이 값이 곧 자간이 된다)
	const probe = document.createElement('canvas').getContext('2d');
	if (probe) {
		probe.font = fontSpec;
		// 셀 폭은 **숫자**의 최대 폭으로 잡는다 — K/M/B 같은 넓은 글자를 기준으로 하면
		// "4 8 2 1 3" 처럼 숫자 사이가 벌어진다. 넓은 글자는 아래에서 가로로 눌러 넣는다.
		let widest = 0;
		for (const ch of '0123456789') {
			widest = Math.max(widest, probe.measureText(ch).width);
		}
		cellWidth = Math.ceil(widest + STROKE_W * 0.6);
	}

	const canvasTexture = scene.textures.createCanvas(DAMAGE_FONT_TEXTURE, cols * cellWidth, rows * CELL_H);
	if (!canvasTexture) {
		return;
	}
	const ctx = canvasTexture.getContext();
	ctx.clearRect(0, 0, cols * cellWidth, rows * CELL_H);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = fontSpec;
	ctx.lineJoin = 'round';
	ctx.miterLimit = 2;

	for (let row = 0; row < rows; row += 1) {
		const [top, bottom] = DAMAGE_FONT_GRADIENTS[row] ?? [DAMAGE_FONT_COLORS[row], DAMAGE_FONT_COLORS[row]];
		for (let col = 0; col < cols; col += 1) {
			const ch = CHARS[col];
			const cx = col * cellWidth + cellWidth / 2;
			const cy = row * CELL_H + CELL_H / 2;
			// 셀보다 넓은 글리프(M/B/K)는 가로로 눌러 셀 안에 넣는다 (외곽선 여유 포함)
			const glyphW = ctx.measureText(ch).width + STROKE_W;
			const squeeze = glyphW > cellWidth ? cellWidth / glyphW : 1;
			ctx.save();
			ctx.translate(cx, 0);
			ctx.scale(squeeze, 1);
			ctx.translate(-cx, 0);

			// 1) 아래쪽 그림자 (살짝 내려 찍은 검은 외곽선)
			ctx.lineWidth = STROKE_W;
			ctx.strokeStyle = 'rgba(0,0,0,0.55)';
			ctx.strokeText(ch, cx, cy + 3);
			// 2) 본 외곽선
			ctx.strokeStyle = '#0b0d12';
			ctx.strokeText(ch, cx, cy);
			// 3) 세로 그라데이션 채움
			const grad = ctx.createLinearGradient(0, cy - GLYPH_PX * 0.5, 0, cy + GLYPH_PX * 0.5);
			grad.addColorStop(0, top);
			grad.addColorStop(0.55, DAMAGE_FONT_COLORS[row]);
			grad.addColorStop(1, bottom);
			ctx.fillStyle = grad;
			ctx.fillText(ch, cx, cy);
			// 4) 위쪽 하이라이트 (얇은 반투명 흰 선) — 볼록한 느낌
			ctx.lineWidth = 1.2;
			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.strokeText(ch, cx, cy - 1);
			ctx.restore();
		}
	}
	canvasTexture.refresh();

	for (let row = 0; row < rows; row += 1) {
		const key = `damage-font-${row}`;
		if (scene.cache.bitmapFont.exists(key)) {
			continue;
		}
		// RetroFontConfig 의 오프셋 키는 점이 박힌 문자열이다 ('offset.x' / 'offset.y').
		scene.cache.bitmapFont.add(key, Phaser.GameObjects.RetroFont.Parse(scene, {
			image: DAMAGE_FONT_TEXTURE,
			width: cellWidth,
			height: CELL_H,
			chars: CHARS,
			charsPerRow: cols,
			'offset.x': 0,
			// 이 색의 행만 잘라 쓴다 — 덕분에 9개 폰트가 텍스처 1장을 공유한다
			'offset.y': row * CELL_H,
			'spacing.x': 0,
			'spacing.y': 0,
			lineSpacing: 0,
		}));
	}
}

/** 이 폰트로 그릴 수 있는 문자열인지 (숫자·기호만) */
export function isDamageFontText(text: string): boolean {
	for (const ch of text) {
		if (!CHARS.includes(ch)) {
			return false;
		}
	}
	return text.length > 0;
}

/**
 * 기준 글자 크기(px). 호출부는 `원하는 크기 / 이 값`으로 스케일을 잡는다.
 * 셀 높이가 아니라 **글자 크기**를 기준으로 삼아야 기존 Text 와 같은 크기로 보인다
 * (셀에는 외곽선 여유가 포함돼 있다).
 */
export const DAMAGE_FONT_GLYPH_PX = GLYPH_PX;

/** 셀 폭(px, 글리프 기준 크기에서) — 자리수 캐스케이드 배치용. */
export function damageFontCellWidth(): number {
	return cellWidth;
}
