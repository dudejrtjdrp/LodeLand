// 게임패드 (2026-09-01 마감 품질 패스)
//
// 설계: **패드는 키보드를 흉내 낸다.**
//   버튼 입력을 전용 콜백으로 뿌리는 대신, 해당 동작에 배정된 키의 KeyboardEvent 를
//   window 에 합성해 던진다(Phaser 키보드 매니저가 window 를 듣는다).
//   이 한 가지 결정이 다음을 공짜로 준다:
//     · 리맵이 자동 반영된다 (키 이름을 core/keybinds 에서 읽으므로)
//     · 이미 배선된 모든 창(레벨업·증강·상점·마을·결과·도감)이 그대로 반응한다
//     · 패드 미연결이면 이 클래스가 아무 이벤트도 만들지 않는다 → 영향 0
//
// 예외는 이동뿐이다. 좌스틱은 아날로그라 키 합성으로는 표현이 죽는다 →
// GameScene 이 axis() 를 직접 읽어 이동 벡터에 섞는다.
//
// 버튼 배치 (표준 게임패드 매핑)
//   A(0)  전투: 귀소            창: 확정(ENTER)
//   B(1)  전투: 대시            창: 취소(ESC)
//   X(2)  상호작용
//   Y(3)  캐릭터창
//   LB(4) 창: ← / 전투: 활공
//   RB(5) 창: → / 전투: 활공
//   LT(6) 필살기
//   RT(7) 활공
//   Start(9) 일시정지(ESC)
//   십자키(12~15) ↑ ↓ ← → (창 포커스 이동 · 갈래 전환)

import Phaser from 'phaser';
import { getBinding, keyCodeOf, type ActionId } from '../core/keybinds';

/** 지금 입력을 받아야 하는 맥락 — 창이 열려 있으면 'ui' */
export type PadContext = 'game' | 'ui';

/** 조작 안내·HUD 에 띄우는 패드 글리프 (동작별) */
export const PAD_GLYPHS: Partial<Record<ActionId, string>> = {
	moveUp: '좌스틱', moveLeft: '좌스틱', moveDown: '좌스틱', moveRight: '좌스틱',
	dive: 'RT', recall: 'A', dash: 'B', ult: 'LT', interact: 'X', stats: 'Y',
};

/** 아날로그 스틱 데드존 — 이보다 작은 기울기는 0으로 본다 */
const DEADZONE = 0.25;
/** 같은 버튼이 연속 입력으로 번지지 않게 하는 최소 간격 */
const REPEAT_MS = 180;

interface ButtonPlan {
	/** 이 버튼이 흉내 낼 동작 (맥락 'game') */
	gameAction?: ActionId;
	/** 맥락 'game' 에서 직접 던질 키 이름 (동작 대신) */
	gameKey?: string;
	/** 맥락 'ui' 에서 던질 키 이름 */
	uiKey?: string;
	/** 맥락 무관 — 항상 이 동작 */
	anyAction?: ActionId;
	/** 맥락 무관 — 항상 이 키 */
	anyKey?: string;
}

const BUTTON_PLAN: Record<number, ButtonPlan> = {
	0: { gameAction: 'recall', uiKey: 'ENTER' },
	1: { gameAction: 'dash', uiKey: 'ESC' },
	2: { anyAction: 'interact' },
	3: { anyAction: 'stats' },
	4: { gameAction: 'dive', uiKey: 'LEFT' },
	5: { gameAction: 'dive', uiKey: 'RIGHT' },
	6: { gameAction: 'ult' },
	7: { anyAction: 'dive' },
	9: { anyKey: 'ESC' },
	12: { anyKey: 'UP' },
	13: { anyKey: 'DOWN' },
	14: { anyKey: 'LEFT' },
	15: { anyKey: 'RIGHT' },
};

const BUTTON_INDICES = Object.keys(BUTTON_PLAN).map(Number);

/** Phaser 키 이름 → DOM KeyboardEvent 의 code/key */
function domKeyOf(name: string): { code: string; key: string } {
	if (/^[A-Z]$/.test(name)) {
		return { code: `Key${name}`, key: name.toLowerCase() };
	}
	switch (name) {
		case 'SPACE': return { code: 'Space', key: ' ' };
		case 'SHIFT': return { code: 'ShiftLeft', key: 'Shift' };
		case 'CTRL': return { code: 'ControlLeft', key: 'Control' };
		case 'ALT': return { code: 'AltLeft', key: 'Alt' };
		case 'TAB': return { code: 'Tab', key: 'Tab' };
		case 'ESC': return { code: 'Escape', key: 'Escape' };
		case 'ENTER': return { code: 'Enter', key: 'Enter' };
		case 'UP': return { code: 'ArrowUp', key: 'ArrowUp' };
		case 'DOWN': return { code: 'ArrowDown', key: 'ArrowDown' };
		case 'LEFT': return { code: 'ArrowLeft', key: 'ArrowLeft' };
		case 'RIGHT': return { code: 'ArrowRight', key: 'ArrowRight' };
		case 'ONE': return { code: 'Digit1', key: '1' };
		case 'TWO': return { code: 'Digit2', key: '2' };
		case 'THREE': return { code: 'Digit3', key: '3' };
		case 'FOUR': return { code: 'Digit4', key: '4' };
		default: return { code: name, key: name };
	}
}

/**
 * 키보드 이벤트 합성.
 * keyCode 는 표준 init 딕셔너리에 없어 브라우저마다 무시될 수 있다 —
 * Phaser 가 보는 것이 정확히 이 값이므로 defineProperty 로 직접 심는다.
 */
export function synthesizeKey(type: 'keydown' | 'keyup', keyName: string): boolean {
	const code = keyCodeOf(keyName);
	if (code === null || typeof window === 'undefined') {
		return false;
	}
	const dom = domKeyOf(keyName);
	const event = new KeyboardEvent(type, {
		key: dom.key, code: dom.code, bubbles: true, cancelable: true,
	});
	Object.defineProperty(event, 'keyCode', { get: () => code });
	Object.defineProperty(event, 'which', { get: () => code });
	// 합성 이벤트임을 표시 — 테스트·디버그에서 구분할 수 있게
	Object.defineProperty(event, 'fromGamepad', { get: () => true });
	window.dispatchEvent(event);
	return true;
}

export default class GamepadSystem {
	private scene: Phaser.Scene;
	private contextOf: () => PadContext;
	/** 버튼 인덱스 → 마지막으로 눌림 처리한 시각 */
	private lastFire = new Map<number, number>();
	/** 버튼 인덱스 → 지금 눌려 있는가 (에지 검출) */
	private held = new Set<number>();
	/** 마지막으로 합성한 keydown 의 키 이름 (keyup 을 짝지어 보내려고) */
	private pendingUp: Array<{ key: string; at: number }> = [];
	private destroyed = false;

	/** 패드가 한 번이라도 연결된 적이 있는가 (HUD 표기 전환 판단) */
	static everConnected = false;

	constructor(scene: Phaser.Scene, opts: { context?: () => PadContext } = {}) {
		this.scene = scene;
		this.contextOf = opts.context ?? (() => 'ui');
	}

	/**
	 * 씬 UPDATE 에 스스로 붙는 간편 생성 (메뉴 씬용).
	 * GameScene 처럼 update() 안에서 순서를 직접 잡아야 하는 곳은 이걸 쓰지 않는다.
	 */
	static attach(scene: Phaser.Scene, opts: { context?: () => PadContext } = {}): GamepadSystem {
		const system = new GamepadSystem(scene, opts);
		const tick = (time: number) => system.update(time);
		scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
			system.destroy();
		});
		return system;
	}

	/** 지금 패드가 붙어 있는가 */
	get connected(): boolean {
		const plugin = this.scene.input?.gamepad;
		if (!plugin) {
			return false;
		}
		if (plugin.total > 0) {
			GamepadSystem.everConnected = true;
		}
		return plugin.total > 0;
	}

	private pad(): Phaser.Input.Gamepad.Gamepad | null {
		const plugin = this.scene.input?.gamepad;
		if (!plugin || plugin.total === 0) {
			return null;
		}
		return plugin.getPad(0) ?? null;
	}

	/**
	 * 좌스틱 이동 벡터 (-1~1). 패드 없으면 0,0.
	 * 십자키는 여기 섞지 않는다 — 십자키는 창 포커스 이동 전용이다.
	 */
	axis(): { x: number; y: number } {
		const pad = this.pad();
		if (!pad) {
			return { x: 0, y: 0 };
		}
		const raw = { x: pad.axes[0]?.getValue() ?? 0, y: pad.axes[1]?.getValue() ?? 0 };
		const len = Math.hypot(raw.x, raw.y);
		if (len < DEADZONE) {
			return { x: 0, y: 0 };
		}
		// 데드존 바깥을 0~1 로 다시 편다 (경계에서 툭 튀지 않게)
		const scale = Math.min(1, (len - DEADZONE) / (1 - DEADZONE)) / len;
		return { x: raw.x * scale, y: raw.y * scale };
	}

	/** 매 프레임 호출 — 버튼 에지를 키 이벤트로 바꾼다 */
	update(now: number): void {
		if (this.destroyed) {
			return;
		}
		// 예약된 keyup 소진 (짧게 눌렀다 뗀 것처럼 보이게)
		for (let i = this.pendingUp.length - 1; i >= 0; i -= 1) {
			if (now >= this.pendingUp[i].at) {
				synthesizeKey('keyup', this.pendingUp[i].key);
				this.pendingUp.splice(i, 1);
			}
		}

		const pad = this.pad();
		if (!pad) {
			this.held.clear();
			return;
		}
		GamepadSystem.everConnected = true;

		const context = this.contextOf();
		for (const index of BUTTON_INDICES) {
			const pressed = pad.buttons[index]?.pressed ?? false;
			if (!pressed) {
				this.held.delete(index);
				continue;
			}
			if (this.held.has(index)) {
				continue; // 누른 채로 유지 — 에지가 아니다
			}
			this.held.add(index);
			if (now - (this.lastFire.get(index) ?? -Infinity) < REPEAT_MS) {
				continue;
			}
			this.lastFire.set(index, now);
			const keyName = this.resolveKey(BUTTON_PLAN[index], context);
			if (keyName) {
				synthesizeKey('keydown', keyName);
				this.pendingUp.push({ key: keyName, at: now + 90 });
			}
		}
	}

	private resolveKey(plan: ButtonPlan, context: PadContext): string | null {
		if (plan.anyKey) {
			return plan.anyKey;
		}
		if (plan.anyAction) {
			return getBinding(plan.anyAction);
		}
		if (context === 'game') {
			if (plan.gameAction) return getBinding(plan.gameAction);
			return plan.gameKey ?? null;
		}
		return plan.uiKey ?? null;
	}

	destroy(): void {
		this.destroyed = true;
		// 눌린 채로 남은 키가 있으면 반드시 떼 준다 (씬 전환 후 유령 입력 방지)
		for (const entry of this.pendingUp) {
			synthesizeKey('keyup', entry.key);
		}
		this.pendingUp = [];
		this.held.clear();
		this.lastFire.clear();
	}
}
