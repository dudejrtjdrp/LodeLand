// 키 리맵 UI — 설정 창의 '조작' 갈래 (2026-09-01 마감 품질 패스)
//
// 흐름: 키 버튼 클릭 → "키를 누르세요…" 대기 → 다음 keydown 을 잡아 배정.
//   · ESC 는 항상 취소 (대기 상태에서 빠져나오는 유일한 탈출구)
//   · 예약키(ESC·M·R·T·O·U·1~4·방향키)와 다른 동작이 쓰는 키는 **거부**하고 이유를 띄운다.
//     조용히 빼앗으면 무엇이 바뀌었는지 알 수 없다.
//   · 방향키 이동은 리맵과 무관하게 항상 살아 있다 — 되돌리지 못하는 사고가 안 난다.
//
// Flat 팩(theme.ts)만 사용 — 절차 드로잉 금지.

import Phaser from 'phaser';
import {
	ACTION_SPECS, actionSpec, getBinding, keyLabel, keyNameOf, resetKeybinds, setBinding,
	type ActionId,
} from '../core/keybinds';
import GamepadSystem, { PAD_GLYPHS } from '../systems/GamepadSystem';
import { UI, style, insetPanel, button, dimVignette, panel, divider, createUiRoot, type UiButton } from './theme';

export interface KeybindPanelUi {
	objects: Phaser.GameObjects.GameObject[];
	/** 이 블록이 차지한 높이 */
	height: number;
	refresh(): void;
	destroy(): void;
}

const ROW_H = 34;
const KEY_BTN_W = 118;
const KEY_BTN_H = 28;

export interface KeybindPanelOptions {
	scrollFactor?: number;
	depth?: number;
	scale?: number;
	/** 리맵이 확정될 때마다 (안내 패널 재구축 등) */
	onChange?: () => void;
	/** 클릭음 등 */
	onClickSound?: () => void;
}

/**
 * (x, y) 좌상단 기준으로 리맵 목록을 그린다.
 * 반환 objects 를 호출자가 컨테이너에 넣고, destroy() 로 정리한다.
 */
export function createKeybindPanel(
	scene: Phaser.Scene, x: number, y: number, width: number,
	options: KeybindPanelOptions = {},
): KeybindPanelUi {
	const { scrollFactor, depth, scale = 1, onChange, onClickSound } = options;
	const objects: Phaser.GameObjects.GameObject[] = [];
	const buttons = new Map<ActionId, UiButton>();
	const rowH = ROW_H * scale;
	const padTop = 30 * scale;
	// 목록 + 상태줄 + 기본값 복원 버튼
	const height = padTop + ACTION_SPECS.length * rowH + 66 * scale;

	/** 지금 어떤 동작의 키 입력을 기다리는 중인가 */
	let waitingFor: ActionId | null = null;
	let destroyed = false;

	const track = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
		const positioned = object as unknown as {
			setScrollFactor?: (v: number) => void; setDepth?: (v: number) => void;
		};
		if (scrollFactor !== undefined) positioned.setScrollFactor?.(scrollFactor);
		if (depth !== undefined) positioned.setDepth?.(depth);
		objects.push(object);
		return object;
	};

	track(insetPanel(scene, x, y, width, height, { alpha: 0.9 }));
	track(scene.add.text(x + 14 * scale, y + 15 * scale, '조작 키',
		style(12 * scale, UI.quenchText, { display: true })).setOrigin(0, 0.5));
	track(scene.add.text(x + width - 14 * scale, y + 15 * scale, '클릭 후 새 키 입력 · ESC 취소',
		style(10.5 * scale, UI.textFaint, { bold: false })).setOrigin(1, 0.5));

	const status = track(scene.add.text(
		x + 14 * scale, y + padTop + ACTION_SPECS.length * rowH + 12 * scale, '',
		style(11 * scale, UI.textFaint, { bold: false })).setOrigin(0, 0.5));

	const setStatus = (text: string, color = UI.textFaint) => {
		if (destroyed) return;
		status.setText(text);
		status.setColor(color);
	};

	const labelFor = (id: ActionId) => {
		const bound = keyLabel(getBinding(id));
		if (GamepadSystem.everConnected && PAD_GLYPHS[id]) {
			return `${bound}  ·  ${PAD_GLYPHS[id]}`;
		}
		return bound;
	};

	const refreshLabels = () => {
		for (const [id, btn] of buttons) {
			btn.setLabel(waitingFor === id ? '키를 누르세요…' : labelFor(id));
		}
	};

	// ── 키 대기 처리
	const stopWaiting = () => {
		waitingFor = null;
		scene.input.keyboard?.off('keydown', captureHandler);
		refreshLabels();
	};

	function captureHandler(event: KeyboardEvent) {
		if (destroyed || !waitingFor) {
			return;
		}
		// 대기 중에는 이 키가 게임의 다른 배선으로 새어 나가면 안 된다.
		// Phaser 키보드 플러그인은 큐를 돌며 이벤트를 뿌리므로 DOM 의 전파 중단만으로는
		// 부족하다 — 'keydown-XXX' 와 Key 객체까지 막으려면 event.cancelled 를 세워야 한다.
		event.preventDefault?.();
		(event as KeyboardEvent & { cancelled?: number }).cancelled = 1;

		const target = waitingFor;
		const name = keyNameOf(event.keyCode);
		if (!name) {
			setStatus('알 수 없는 키입니다 — 다른 키를 눌러 보세요.', UI.red);
			return;
		}
		if (name === 'ESC') {
			stopWaiting();
			setStatus('취소했습니다.');
			return;
		}
		const result = setBinding(target, name);
		stopWaiting();
		if (result.ok) {
			setStatus(`${actionSpec(target)?.label} → ${keyLabel(name)}`, UI.green);
			onChange?.();
			return;
		}
		if (result.reason === 'reserved') {
			setStatus(`${keyLabel(name)} 은(는) 시스템 키입니다 (${result.reservedFor}).`, UI.red);
		} else if (result.reason === 'conflict') {
			setStatus(
				`${keyLabel(name)} 은(는) 이미 [${actionSpec(result.conflictWith!)?.label}] 이 씁니다.`,
				UI.red,
			);
		} else {
			setStatus('이 키는 배정할 수 없습니다.', UI.red);
		}
	}

	const startWaiting = (id: ActionId) => {
		if (waitingFor === id) {
			stopWaiting();
			return;
		}
		if (waitingFor) {
			stopWaiting();
		}
		waitingFor = id;
		setStatus(`[${actionSpec(id)?.label}] 에 배정할 키를 누르세요 (ESC 취소)`, UI.quenchText);
		refreshLabels();
		// 이번 클릭의 여파로 즉시 잡히지 않게 다음 틱부터 듣는다
		scene.time.delayedCall(0, () => {
			if (!destroyed && waitingFor === id) {
				scene.input.keyboard?.on('keydown', captureHandler);
			}
		});
	};

	ACTION_SPECS.forEach((spec, index) => {
		const rowY = y + padTop + index * rowH + rowH / 2;
		track(scene.add.text(x + 14 * scale, rowY - 6 * scale, spec.label,
			style(12.5 * scale, UI.text, { display: true })).setOrigin(0, 0.5));
		track(scene.add.text(x + 14 * scale, rowY + 8 * scale, spec.desc,
			style(10 * scale, UI.textFaint, { bold: false })).setOrigin(0, 0.5));

		const btnW = KEY_BTN_W * scale;
		const btn = button(scene, x + width - btnW / 2 - 12 * scale, rowY, btnW, KEY_BTN_H * scale,
			labelFor(spec.id), {
				variant: 'dark', fontSize: 12 * scale, display: true,
				onClick: () => { onClickSound?.(); startWaiting(spec.id); },
			});
		if (scrollFactor !== undefined) btn.container.setScrollFactor(scrollFactor);
		if (depth !== undefined) btn.container.setDepth(depth);
		objects.push(btn.container);
		buttons.set(spec.id, btn);

		// 고정 보조키 안내 (방향키) — 리맵 불가라는 사실을 알려야 한다
		if (spec.fixedAlt?.length) {
			track(scene.add.text(x + width - btnW - 20 * scale, rowY,
				`+ ${spec.fixedAlt.map(keyLabel).join(' ')}`,
				style(10 * scale, UI.textFaint, { bold: false })).setOrigin(1, 0.5));
		}
	});

	const resetBtn = button(scene, x + width / 2, y + height - 24 * scale, width - 28 * scale, 34 * scale,
		'기본값으로 되돌리기', {
			variant: 'dark', fontSize: 13 * scale, display: true,
			onClick: () => {
				onClickSound?.();
				stopWaiting();
				resetKeybinds();
				refreshLabels();
				setStatus('기본 조작으로 되돌렸습니다.', UI.green);
				onChange?.();
			},
		});
	if (scrollFactor !== undefined) resetBtn.container.setScrollFactor(scrollFactor);
	if (depth !== undefined) resetBtn.container.setDepth(depth);
	objects.push(resetBtn.container);

	return {
		objects,
		height,
		refresh: refreshLabels,
		destroy() {
			destroyed = true;
			scene.input.keyboard?.off('keydown', captureHandler);
			for (const object of objects) {
				scene.tweens.killTweensOf(object);
				object.destroy();
			}
			objects.length = 0;
			buttons.clear();
		},
	};
}

export interface KeybindWindow {
	close(): void;
}

/**
 * 독립 모달로 여는 리맵 창 (일시정지 메뉴에서 쓴다).
 * 자체 딤 + 패널 + 닫기 버튼을 갖는다.
 */
export function openKeybindWindow(
	scene: Phaser.Scene, depth: number, opts: { onChange?: () => void; onClose?: () => void } = {},
): KeybindWindow {
	const overlay = dimVignette(scene, depth, 0.86);
	const root = createUiRoot(scene, depth + 1);
	const cx = root.width / 2;
	const cy = root.height / 2;
	const panelW = Math.min(560, root.width - 60);
	const panelH = Math.min(600, root.height - 40);
	const extras: Phaser.GameObjects.GameObject[] = [
		panel(scene, cx, cy, panelW, panelH, { origin: 0.5 }),
		scene.add.text(cx, cy - panelH / 2 + 34, '조작 키 설정', style(22, UI.text, { display: true })).setOrigin(0.5),
		divider(scene, cx, cy - panelH / 2 + 56, panelW - 120),
	];

	const listW = panelW - 56;
	const bindings = createKeybindPanel(scene, cx - listW / 2, cy - panelH / 2 + 74, listW, {
		onChange: opts.onChange,
	});

	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		scene.input.keyboard?.off('keydown-ESC', close);
		bindings.destroy();
		for (const object of extras) object.destroy();
		root.destroy();
		for (const object of overlay) object.destroy();
		opts.onClose?.();
	};

	const closeBtn = button(scene, cx, cy + panelH / 2 - 32, 180, 40, '닫기', {
		variant: 'gold', fontSize: 15, display: true, key: 'ESC', onClick: close,
	});
	extras.push(closeBtn.container);

	for (const object of extras) root.root.add(object);
	for (const object of bindings.objects) root.root.add(object);
	root.sort();

	// ESC 는 대기 중이면 취소(위 captureHandler 가 먼저 먹는다), 아니면 창을 닫는다
	scene.input.keyboard?.on('keydown-ESC', close);

	return { close };
}
