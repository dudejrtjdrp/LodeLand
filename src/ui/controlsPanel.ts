// 조작 안내 패널 (2026-09-01 온보딩 · 2026-09-01 리맵/게임패드 반영)
//
// 키 목록은 실제 입력 배선에서 뽑았다:
//   GameScene.create      — ESC 일시정지 / [캐릭터창] / ← → 갈래 / M 음소거 / (일시정지 중) R·T
//   GameScene.update      — [이동 4방향] · 방향키(고정 보조)
//   ActiveSkillSystem     — [활공] · [귀소] · [대시] (전투 중에만)
//   VillageSystem.enter   — [상호작용] / SPACE 출발
//   LevelUpSystem.buildUi — 1~4 카드 선택 / R 새로고침
//   TitleScene.create     — SPACE 출격 / C 이어하기 / U 영구 강화 / O 설정
//
// [대괄호] 항목은 core/keybinds 의 리맵을 따른다 — 이 파일은 **매번 새로 계산해서**
// 그린다. 상수 배열로 굳혀 두면 리맵을 해도 안내가 옛 키를 가리킨다.
//
// Flat 팩(theme.ts)만 사용 — 절차 드로잉 금지.

import Phaser from 'phaser';
import { UI, style, insetPanel, keycap } from './theme';
import { actionKeyLabels, actionKeyLabel } from '../core/keybinds';
import GamepadSystem, { PAD_GLYPHS } from '../systems/GamepadSystem';

export interface ControlRow {
	keys: string[];
	label: string;
	/** 게임패드 표기 (연결됐을 때만 오른쪽 열에 뜬다) */
	pad?: string;
}

/** 전투 중에 실제로 쓰는 키 (일시정지 메뉴용 — 짧게) */
export function combatControlRows(): ControlRow[] {
	return [
		{
			keys: [...new Set([
				actionKeyLabel('moveUp'), actionKeyLabel('moveLeft'),
				actionKeyLabel('moveDown'), actionKeyLabel('moveRight'),
			])],
			label: '이동 (방향키도 가능)',
			pad: PAD_GLYPHS.moveUp,
		},
		// 능동 스킬 3종 (2026-09-01) — 대기마을에서는 잠긴다
		{ keys: actionKeyLabels('dive'), label: '활공 사냥 — 무리를 바라보는 쪽으로', pad: PAD_GLYPHS.dive },
		{ keys: actionKeyLabels('recall'), label: '귀소 — 무리 소환 · 밀어내기 · 0.5초 무적', pad: PAD_GLYPHS.recall },
		{ keys: actionKeyLabels('dash'), label: '대시 — 이동 방향으로 짧게 (무적 없음)', pad: PAD_GLYPHS.dash },
		{ keys: actionKeyLabels('ult'), label: '필살기 — 처치·피격으로 찬 게이지를 주 원소 필살기로 (보스 시전 끊기)', pad: PAD_GLYPHS.ult },
		{ keys: actionKeyLabels('stats'), label: '캐릭터창 — 능력치 · 검 · 세트', pad: PAD_GLYPHS.stats },
		{ keys: ['ESC'], label: '일시정지 · 열린 창 닫기', pad: 'Start' },
		{ keys: actionKeyLabels('interact'), label: '대기마을 시설 상호작용', pad: PAD_GLYPHS.interact },
		{ keys: ['SPACE'], label: '게이트 출발 · 재도전 (마을 · 결과 화면)', pad: 'A' },
		{ keys: ['1', '2', '3', '4'], label: '레벨업 카드 선택 (R 새로고침)', pad: '십자키 + A' },
		{ keys: ['M'], label: '음소거' },
	];
}

/** 타이틀 화면 포함 전체 (설정 창용) */
export function allControlRows(): ControlRow[] {
	return [
		...combatControlRows(),
		{ keys: ['O'], label: '설정 (타이틀)' },
		{ keys: ['U'], label: '영구 강화 (타이틀 · 결과)' },
	];
}

/**
 * 구버전 호환 별칭.
 * 상수처럼 보이지만 **모듈 로드 시점의 리맵**으로 굳어지므로 새 코드는 쓰지 말 것 —
 * combatControlRows() / allControlRows() 를 호출해 매번 계산한다.
 */
export const COMBAT_CONTROLS: ControlRow[] = combatControlRows();
export const ALL_CONTROLS: ControlRow[] = allControlRows();

export interface ControlsPanelResult {
	objects: Phaser.GameObjects.GameObject[];
	/** 실제로 차지한 높이 (호출자가 다음 요소를 아래에 붙일 때 쓴다) */
	height: number;
}

export interface ControlsPanelOptions {
	rows?: ControlRow[];
	/** 축소 배율 (좁은 화면에서 0.85 등) */
	scale?: number;
	scrollFactor?: number;
	depth?: number;
	title?: string | null;
	/** 패드 열을 강제로 켠다 (기본: 패드가 연결된 적 있을 때만) */
	showPad?: boolean;
}

/**
 * (x, y) 좌상단 기준으로 조작 안내 목록을 그린다.
 * 반환 objects 를 호출자가 컨테이너에 넣고 파괴까지 책임진다.
 */
export function createControlsPanel(
	scene: Phaser.Scene, x: number, y: number, width: number,
	options: ControlsPanelOptions = {},
): ControlsPanelResult {
	const {
		rows = combatControlRows(), scale = 1, scrollFactor, depth, title = '조작',
		showPad = GamepadSystem.everConnected,
	} = options;

	const objects: Phaser.GameObjects.GameObject[] = [];
	const rowH = 26 * scale;
	const padTop = title ? 24 * scale : 8 * scale;
	const height = padTop + rows.length * rowH + 8 * scale;
	// 패드 열은 오른쪽 끝에 붙는다 (열이 없으면 라벨이 그만큼 더 넓게 쓴다)
	const padColW = showPad ? 78 * scale : 0;

	const track = (object: Phaser.GameObjects.GameObject) => {
		const positioned = object as Phaser.GameObjects.Image;
		if (scrollFactor !== undefined) {
			positioned.setScrollFactor?.(scrollFactor);
		}
		if (depth !== undefined) {
			positioned.setDepth?.(depth);
		}
		objects.push(object);
		return object;
	};

	track(insetPanel(scene, x, y, width, height, { alpha: 0.9 }));

	if (title) {
		track(scene.add.text(x + 14 * scale, y + 13 * scale, title,
			style(12 * scale, UI.quenchText, { display: true })).setOrigin(0, 0.5));
		if (showPad) {
			track(scene.add.text(x + width - 14 * scale, y + 13 * scale, '패드',
				style(11 * scale, UI.textFaint, { display: true })).setOrigin(1, 0.5));
		}
	}

	rows.forEach((row, index) => {
		const rowY = y + padTop + index * rowH + rowH / 2;
		let cursorX = x + 14 * scale;
		for (const key of row.keys) {
			const capSize = Math.max(9, 11 * scale);
			const cap = keycap(scene, 0, rowY, key, capSize);
			// keycap 은 중심 기준 컨테이너 — 실제 폭을 재서 왼쪽부터 늘어놓는다
			const capW = Math.max(26, key.length * (capSize * 0.62) + 16);
			cap.setPosition(cursorX + capW / 2, rowY);
			track(cap);
			cursorX += capW + 4 * scale;
		}
		const labelX = cursorX + 6 * scale;
		track(scene.add.text(labelX, rowY, row.label,
			{
				...style(11.5 * scale, UI.textDim, { bold: false }),
				// 패드 열 침범 방지 — 라벨이 길면 잘라 준다
				wordWrap: { width: Math.max(60, width - (labelX - x) - padColW - 10 * scale) },
				maxLines: 1,
			}).setOrigin(0, 0.5));

		if (showPad && row.pad) {
			track(scene.add.text(x + width - 12 * scale, rowY, row.pad,
				style(11 * scale, UI.quenchText, { display: true })).setOrigin(1, 0.5));
		}
	});

	return { objects, height };
}
