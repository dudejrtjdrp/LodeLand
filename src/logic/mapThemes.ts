// 맵 테마 카탈로그 — 라운드마다 바닥·장식·무드가 통째로 바뀐다.
//
// 규칙:
//   - 맵 하나 = 바닥 타일 정확히 1종 (2종 이상 섞으면 색 경계가 뚝뚝 끊긴다 — 사용자 결정).
//     타일은 public/map/themes64.png 스트립(64px, scripts/generate-theme-assets.py가 굽는다)
//     의 `tile` 인덱스 하나를 가리킨다.
//   - 분위기 = (타일 × layerTint) + 전용 장식(decos, public/deco2/*) + 배경색.
//   - 테마 선택은 그 라운드 적/보스 특성(몸체 원소)을 따른다 — WaveSystem.getRoundIntel.
//   - 테마 추가 절차: generate-theme-assets.py 의 TILES/DECOS 에 항목 추가 → 재실행 →
//     여기 MAP_THEMES 에 엔트리 추가. (끝. 엔진 코드는 손대지 않는다)
//   - decos 가 없는 테마(잿불·서리)는 기존 Tiny Swords DECO_ATLAS 장식(흔들림 애니 포함)을 쓴다.

import type { Element } from '../types/catalogs';

/** 테마 전용 장식 한 종 — key 는 로드된 텍스처 키, size 는 표시 높이(px) */
export interface ThemeDeco {
	key: string;
	size: number;
	/** 큰 장식(나무·기둥)=false 기본, 잔풀·돌 같은 소형은 true — 배치 개수가 다르다 */
	small?: boolean;
}

export interface MapTheme {
	id: string;
	/** 짧은 한국어 지명 (라운드 입장 타이틀·정찰 보고에 표시) */
	name: string;
	/** 한 줄 무드 설명 */
	desc: string;
	/** themes64.png 스트립에서의 타일 인덱스 */
	tile: number;
	/** 바닥 레이어 틴트 (곱연산) */
	layerTint: number;
	/** 장식 틴트 */
	decoTint: number;
	/** 카메라 배경색 */
	bgColor: number;
	/** 입장 타이틀·정찰 강조색 (css) */
	accent: string;
	/** 이 테마와 어울리는 몸체 원소 — 라운드 적 특성과 매칭 */
	element: Element;
	/** 전용 장식 (없으면 Tiny Swords DECO_ATLAS 폴백) */
	decos?: ThemeDeco[];
	/** 장식 밀도 배율 (바닥이 밋밋한 테마는 높게) */
	density?: number;
}

export const MAP_THEMES: MapTheme[] = [
	{
		id: 'ember-waste', name: '잿불 황무지', desc: '식지 않은 잉걸이 바닥에 깔려 있다',
		tile: 0, layerTint: 0xe0a682, decoTint: 0xd89c78, bgColor: 0x1a100b,
		accent: '#e8874a', element: 'fire',
	},
	{
		id: 'frost-field', name: '서리 벌판', desc: '숨이 하얗게 얼어붙는 냉맥 지대',
		tile: 1, layerTint: 0xaccee0, decoTint: 0x9cbccd, bgColor: 0x0c1418,
		accent: '#8fc3d8', element: 'ice',
	},
	{
		id: 'storm-ruin', name: '뇌운 폐성', desc: '마른천둥이 무너진 회랑을 두드린다',
		tile: 2, layerTint: 0xc6cee8, decoTint: 0xd8dcee, bgColor: 0x0d1018,
		accent: '#63b3d9', element: 'electric', density: 1.1,
		decos: [
			{ key: 'deco2-electric-0', size: 84 },
			{ key: 'deco2-electric-1', size: 40, small: true },
			{ key: 'deco2-electric-2', size: 44, small: true },
			{ key: 'deco2-electric-3', size: 30, small: true },
			{ key: 'deco2-electric-4', size: 40, small: true },
		],
	},
	{
		id: 'venom-wood', name: '독버섯 숲', desc: '초록 안개가 발목까지 고여 있다',
		tile: 3, layerTint: 0xffffff, decoTint: 0xffffff, bgColor: 0x10160c,
		accent: '#84b04a', element: 'poison', density: 1.5,
		decos: [
			{ key: 'deco2-poison-0', size: 100 },
			{ key: 'deco2-poison-1', size: 80 },
			{ key: 'deco2-poison-2', size: 46, small: true },
			{ key: 'deco2-poison-3', size: 26, small: true },
			{ key: 'deco2-poison-4', size: 24, small: true },
			{ key: 'deco2-poison-5', size: 30, small: true },
			{ key: 'deco2-poison-6', size: 34, small: true },
		],
	},
	{
		id: 'gold-ruin', name: '금빛 유적', desc: '풀뿌리 밑에서 금이 빛을 새어 보낸다',
		tile: 4, layerTint: 0xfff4d6, decoTint: 0xfff4d6, bgColor: 0x181209,
		accent: '#d9a83c', element: 'gold',
		decos: [
			{ key: 'deco2-gold-0', size: 108 },
			{ key: 'deco2-gold-1', size: 100 },
			{ key: 'deco2-gold-2', size: 62 },
			{ key: 'deco2-gold-3', size: 34, small: true },
			{ key: 'deco2-gold-4', size: 30, small: true },
			{ key: 'deco2-gold-5', size: 40, small: true },
		],
	},
	{
		id: 'void-ash', name: '공허 잿땅', desc: '빛이 스며서 사라지는 보랏빛 재',
		tile: 5, layerTint: 0xd6c4ee, decoTint: 0xd6c4ee, bgColor: 0x120e18,
		accent: '#a794d1', element: 'void',
		decos: [
			{ key: 'deco2-void-0', size: 96 },
			{ key: 'deco2-void-1', size: 90 },
			{ key: 'deco2-void-2', size: 84 },
			{ key: 'deco2-void-3', size: 40, small: true },
			{ key: 'deco2-void-4', size: 32, small: true },
			{ key: 'deco2-void-5', size: 30, small: true },
		],
	},
	{
		id: 'blood-fen', name: '핏빛 들녘', desc: '녹물이 스민 흙이 붉게 배었다',
		tile: 6, layerTint: 0xeea898, decoTint: 0xeeb0a0, bgColor: 0x180d0d,
		accent: '#e0798a', element: 'blood',
		decos: [
			{ key: 'deco2-blood-0', size: 96 },
			{ key: 'deco2-blood-1', size: 90 },
			{ key: 'deco2-blood-2', size: 86 },
			{ key: 'deco2-blood-3', size: 38, small: true },
			{ key: 'deco2-blood-4', size: 30, small: true },
			{ key: 'deco2-blood-5', size: 30, small: true },
		],
	},
	{
		id: 'gale-meadow', name: '바람 초원', desc: '풀이 한 방향으로 계속 눕는다',
		tile: 7, layerTint: 0xffffff, decoTint: 0xffffff, bgColor: 0x0e1510,
		accent: '#9fd8c0', element: 'wind', density: 1.25,
		decos: [
			{ key: 'deco2-wind-0', size: 104 },
			{ key: 'deco2-wind-1', size: 40, small: true },
			{ key: 'deco2-wind-2', size: 40, small: true },
			{ key: 'deco2-wind-3', size: 26, small: true },
			{ key: 'deco2-wind-4', size: 20, small: true },
			{ key: 'deco2-wind-5', size: 32, small: true },
		],
	},
];

const THEME_BY_ELEMENT = new Map(MAP_THEMES.map((theme) => [theme.element, theme]));

export function themeForElement(element: Element | null | undefined): MapTheme | null {
	return element ? THEME_BY_ELEMENT.get(element) ?? null : null;
}

/** 결정론 해시 — 같은 라운드는 언제나 같은 테마 (정찰 보고와 실제 입장이 일치해야 한다) */
export function themeByRoundHash(round: number): MapTheme {
	let seed = (round * 0x9e3779b1) >>> 0;
	seed ^= seed >>> 16;
	seed = Math.imul(seed, 0x85ebca6b) >>> 0;
	seed ^= seed >>> 13;
	return MAP_THEMES[seed % MAP_THEMES.length];
}
