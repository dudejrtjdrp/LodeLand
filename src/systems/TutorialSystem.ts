// 첫 런 인터랙티브 튜토리얼 (2026-09-01)
//
// 설계 원칙
//  1. 전용 스크립트 라운드를 만들지 않는다 — 진짜 첫 런 위에 코치 카드를 얹는다.
//  2. 강제 정지 없음. 각 단계는 "그 행동이 실제로 일어났는지"를 보고 스스로 넘어간다.
//     (그래도 막히면 autoMs 뒤 자동 진행 — 튜토리얼이 런을 붙잡지 않는다)
//  3. 전체 화면 오버레이(레벨업/상점/증강/일시정지)가 열리면 카드는 잠깐 숨는다.
//     그 오버레이들이 이미 자기 설명을 갖고 있고, 겹치면 둘 다 읽을 수 없다.
//  4. 매 프레임 하는 일은 숫자 비교 몇 번 + 오브젝트 좌표 갱신뿐이다 (핫패스 안전).
//
// 배치: 좌하단 검 스트립 바로 위 (HUD·체력 게이지·라운드 패널과 겹치지 않는 유일한 빈 구역).
// depth 1500 — HUD(1000~1002) 위, 레벨업(1999~) 아래.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import { GameEvents } from '../core/events';
import { markTutorialDone } from '../core/onboarding';
import { reduceMotion } from '../core/settings';
import { actionKeyLabel, type ActionId } from '../core/keybinds';
import {
	FONT, UI, style, panel, insetPanel, selectFrame, iconImage,
	hudScaleFor, TEXT_RESOLUTION, expandHit,
} from '../ui/theme';

const DEPTH = 1500;

export type TutorialStepId =
	| 'move' | 'hunt' | 'level' | 'skill' | 'gold' | 'resonance' | 'village';

interface Rect { x: number; y: number; w: number; h: number }

interface StepSpec {
	id: TutorialStepId;
	title: string;
	body: string;
	/** 카드 하단 키캡 힌트 — 함수면 렌더 시점의 리맵을 반영한다 */
	keys?: string[] | (() => string[]);
	/** 이 단계를 시작할 수 있는 상황인가 (false 면 카드를 숨기고 대기) */
	ready?: (sys: TutorialSystem) => boolean;
	/** 완료 판정 */
	done: (sys: TutorialSystem) => boolean;
	/** 하이라이트할 화면 영역 */
	highlight?: (sys: TutorialSystem) => Rect | null;
	/** 최소 노출 시간 (ms) — 너무 빨리 지나가 못 읽는 것을 막는다 */
	minMs?: number;
	/** 자동 진행 시간 (ms). 0 이면 조건 충족까지 기다린다. */
	autoMs?: number;
}

/**
 * 본문의 {{동작}} 토큰을 지금 배정된 키 라벨로 바꾼다.
 * {{move}} 만 특별 취급 — 4방향을 한 덩어리로 읽어야 자연스럽다 ("WASD").
 */
function resolveKeyTokens(text: string): string {
	return text.replace(/\{\{(\w+)\}\}/g, (_, id: string) => {
		if (id === 'move') {
			const keys = [...new Set([
				actionKeyLabel('moveUp'), actionKeyLabel('moveLeft'),
				actionKeyLabel('moveDown'), actionKeyLabel('moveRight'),
			])];
			return keys.join('');
		}
		return actionKeyLabel(id as ActionId);
	});
}

const STEPS: StepSpec[] = [
	{
		id: 'move',
		title: '① 무리를 몬다',
		body: '검은 알아서 싸웁니다. 당신이 할 일은 이동뿐 —\n{{move}} 로 적을 좋은 자리로 몰아넣으세요. 나머지 키는 스킬 창(K)에서 스킬에 배정합니다.',
		keys: () => [...new Set([
			actionKeyLabel('moveUp'), actionKeyLabel('moveLeft'),
			actionKeyLabel('moveDown'), actionKeyLabel('moveRight'),
		])],
		minMs: 1500,
		autoMs: 22000,
		done: (sys) => sys.movedDistance >= 320,
		highlight: (sys) => sys.playerRect(),
	},
	{
		id: 'hunt',
		title: '② 검이 스스로 사냥한다',
		body: '검은 궤도를 돌다 적을 찾으면 날아갔다 돌아옵니다.\n좌하단 칸의 테두리 색이 지금 상태 — 회색 궤도 · 주황 출격 · 파랑 귀환.',
		minMs: 2000,
		autoMs: 32000,
		done: (sys) => sys.killsSinceStart >= 3,
		highlight: (sys) => sys.swordStripRect(),
	},
	{
		id: 'level',
		title: '③ 경험치와 레벨업',
		body: '적이 떨군 은빛 조각을 주우면 경험치가 찹니다.\n가득 차면 카드 4장이 뜹니다 — 하나를 고르면 무리 전체가 강해집니다.',
		keys: ['1', '2', '3', '4'],
		minMs: 1200,
		autoMs: 45000,
		done: (sys) => sys.upgradeChosen,
		highlight: (sys) => sys.xpBarRect(),
	},
	{
		// 능동 스킬 온보딩 (2026-09-01): "언제 무리를 푸는가" 가 이 게임의 핵심 판타지다.
		// 레벨업(③) 직후, 골드(⑤) 앞에 끼워 넣어 전투 조작을 먼저 손에 익히게 한다.
		id: 'skill',
		title: '④ 활공 사냥 — 무리를 푼다',
		body: '검은 알아서 사냥하지만, 언제 덮칠지는 당신이 정할 수 있습니다.\n{{dive}} 를 누르면 무리 전체가 바라보는 쪽(이동 중이면 이동 방향)으로 즉시 날아가고 피해가 30% 오릅니다.\n{{recall}} 는 귀소(무리 회수 + 0.5초 무적), {{dash}} 는 대시입니다.',
		keys: () => [actionKeyLabel('dive'), actionKeyLabel('recall'), actionKeyLabel('dash')],
		minMs: 2500,
		autoMs: 20000,
		done: (sys) => (sys.scene.activeSkills?.useCount.dive ?? 0) >= 1,
		highlight: (sys) => sys.skillIconRect(),
	},
	{
		id: 'gold',
		title: '⑤ 골드와 대장간',
		body: '적과 상자에서 골드가 나옵니다.\n라운드 사이 대기마을 대장간에서 {{interact}} 한 번이면\n검 구매 · 장착 자리 · 보관함 · 조합이 한 화면에 열립니다.',
		keys: () => [actionKeyLabel('interact')],
		minMs: 1500,
		autoMs: 26000,
		done: (sys) => (sys.scene.pickupSystem?.runGold ?? 0) >= 15,
		highlight: (sys) => sys.goldRect(),
	},
	{
		id: 'resonance',
		title: '⑥ 공명 — 속성을 맞춘다',
		body: '같은 속성의 검 2자루를 함께 장착하면 공명 —\n속성 효과가 1.5배가 되고, 둘 다 레벨 3이면 필살기가 터집니다.\n{{stats}} 을 눌러 지금 검의 속성을 확인해 보세요.',
		keys: () => [actionKeyLabel('stats')],
		minMs: 4500,
		autoMs: 13000,
		done: (sys) => sys.hasElementPair(),
		highlight: (sys) => sys.swordStripRect(),
	},
	{
		id: 'village',
		title: '⑦ 대기마을 · 게이트 출격',
		body: '라운드를 클리어하면 대기마을에 들릅니다 (체력 전부 회복).\n시설 앞에서 {{interact}}, 북쪽 게이트에서 {{interact}} 로 정찰 · SPACE 로 출발합니다.',
		keys: () => [actionKeyLabel('interact'), 'SPACE'],
		ready: (sys) => sys.scene.villageSystem?.isActive === true,
		minMs: 1500,
		autoMs: 0,
		done: (sys) => sys.departed,
		highlight: (sys) => sys.gateRect(),
	},
];

export default class TutorialSystem {
	scene: GameScene;
	/** 진행 중인가 (start() 이후 finish() 전) */
	active = false;
	/** 현재 단계 인덱스 */
	index = 0;
	/** 완료(또는 건너뜀) */
	finished = false;

	// ── 단계 판정용 누적값 (전부 number/boolean — 핫패스에 객체 할당 없음)
	movedDistance = 0;
	killsSinceStart = 0;
	upgradeChosen = false;
	departed = false;

	/** 현재 단계가 "읽을 수 있는 상태로" 화면에 떠 있던 누적 시간 (ms) */
	private stepElapsed = 0;
	/** 완료 연출 잔여 시간 (ms) — 0보다 크면 다음 단계로 넘어가기 전 잠깐 멈춘다 */
	private clearingLeft = 0;
	private lastPlayerX = 0;
	private lastPlayerY = 0;
	/** 마지막 단계에서 마을에 들어간 적이 있는가 (출발 감지의 전제) */
	private sawVillage = false;
	private hidden = false;

	// ── UI
	private objects: Phaser.GameObjects.GameObject[] = [];
	private titleText: Phaser.GameObjects.Text | null = null;
	private bodyText: Phaser.GameObjects.Text | null = null;
	private stepText: Phaser.GameObjects.Text | null = null;
	private cardPanel: Phaser.GameObjects.NineSlice | null = null;
	private highlightFrame: Phaser.GameObjects.NineSlice | null = null;
	private pointerIcon: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null = null;
	private hs = 1;

	private onUpgrade = () => { this.upgradeChosen = true; };
	private onEnemyDied = () => { this.killsSinceStart += 1; };

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	/** 현재 단계 id (테스트·디버그용) */
	get currentStepId(): TutorialStepId | null {
		return this.active ? STEPS[this.index]?.id ?? null : null;
	}

	get totalSteps(): number {
		return STEPS.length;
	}

	/** 단계 목록 (테스트용) */
	static stepIds(): TutorialStepId[] {
		return STEPS.map((step) => step.id);
	}

	start(): void {
		if (this.active || this.finished) {
			return;
		}
		this.active = true;
		this.index = 0;
		this.movedDistance = 0;
		this.upgradeChosen = false;
		this.departed = false;
		this.sawVillage = false;
		this.killsSinceStart = 0;
		this.lastPlayerX = this.scene.player?.x ?? 0;
		this.lastPlayerY = this.scene.player?.y ?? 0;
		this.stepElapsed = 0;

		this.scene.events.on(GameEvents.UPGRADE_CHOSEN, this.onUpgrade);
		this.scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);

		this.build();
		this.renderStep();
	}

	/** 이번 런에서 튜토리얼을 끝낸다 (건너뛰기 포함 — 다시 뜨지 않는다) */
	finish(markDone = true): void {
		if (!this.active) {
			return;
		}
		this.active = false;
		this.finished = true;
		if (markDone) {
			markTutorialDone();
		}
		this.scene.events.off(GameEvents.UPGRADE_CHOSEN, this.onUpgrade);
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.teardown();
	}

	/** 일시정지·설정에서 "튜토리얼 다시 보기" → 즉시 처음부터 */
	restart(): void {
		if (this.active) {
			this.finish(false);
		}
		this.finished = false;
		this.start();
	}

	destroy(): void {
		this.scene.events.off(GameEvents.UPGRADE_CHOSEN, this.onUpgrade);
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.active = false;
		this.teardown();
	}

	// ---------------------------------------------------------------
	// 매 프레임
	// ---------------------------------------------------------------

	update(delta = 16): void {
		if (!this.active) {
			return;
		}

		// 이동 누적 (1단계 판정) — 제곱근 1회, 무시할 비용
		const player = this.scene.player;
		if (player) {
			const dx = player.x - this.lastPlayerX;
			const dy = player.y - this.lastPlayerY;
			this.lastPlayerX = player.x;
			this.lastPlayerY = player.y;
			// 라운드 입장·마을 이동은 순간이동이라 걸러낸다 (한 프레임 200px 이상)
			const stepDist = Math.hypot(dx, dy);
			if (stepDist < 200) {
				this.movedDistance += stepDist;
			}
		}
		// 마을 출발 감지 (마지막 단계) — "마을에 들어간 적이 있는데 지금은 아니다" 여야 한다.
		// (단순히 !isActive 로 보면 마을에 들어가기도 전에 완료로 처리된다)
		if (STEPS[this.index]?.id === 'village') {
			if (this.scene.villageSystem?.isActive) {
				this.sawVillage = true;
			} else if (this.sawVillage) {
				this.departed = true;
			}
		}

		// 오버레이가 열려 있으면 잠깐 숨긴다 (겹침 방지)
		const covered = Boolean(
			this.scene.levelUpSystem?.isOpen
			|| this.scene.shopSystem?.isOpen
			|| this.scene.augmentSystem?.isOpen
			|| this.scene.isPaused
			|| this.scene.isGameOver
			|| this.scene.villageSystem?.scoutOpen
			|| this.scene.villageSystem?.windowOpen,
		);
		const step = STEPS[this.index];
		const waiting = step?.ready ? !step.ready(this) : false;
		this.setHidden(covered || waiting);
		if (covered || waiting) {
			// 카드를 읽을 수 없는 시간은 세지 않는다 (누적을 멈출 뿐, 되돌리지는 않는다 —
			// 예전엔 시작 시각을 밀어 리셋해서 레벨업이 잦으면 단계가 영영 안 넘어갔다)
			//
			// 다만 **이미 달성한 단계**는 여기서도 넘긴다. 마지막 '대기마을' 단계는
			// ready = 마을에 있을 것 / done = 마을을 떠났을 것 이라 두 조건이 상충한다 —
			// 출발하는 순간 waiting 이 되어 done 검사에 영영 닿지 못했다.
			// 라운드가 40초로 고정되기 전에는 다음 라운드가 금방 끝나 마을에 다시 들어가면서
			// 우연히 풀렸을 뿐, 원래 잠기는 구조다 (2026-09-02).
			// 카드가 숨겨져 있으면 체크 연출(clearingLeft)을 볼 사람이 없다 — 바로 넘긴다.
			if (step && this.clearingLeft <= 0
				&& this.stepElapsed >= (step.minMs ?? 1000) && step.done(this)) {
				this.advance();
			}
			return;
		}

		this.stepElapsed += delta;

		if (this.clearingLeft > 0) {
			this.clearingLeft -= delta;
			if (this.clearingLeft <= 0) {
				this.clearingLeft = 0;
				this.advance();
			}
			return;
		}

		this.updateHighlight();

		if (!step) {
			return;
		}
		if (this.stepElapsed < (step.minMs ?? 1000)) {
			return;
		}
		const autoMs = step.autoMs ?? 0;
		if (step.done(this) || (autoMs > 0 && this.stepElapsed >= autoMs)) {
			this.markStepCleared();
		}
	}

	// ---------------------------------------------------------------
	// 단계 전환
	// ---------------------------------------------------------------

	private markStepCleared(): void {
		this.clearingLeft = 700;
		if (this.titleText) {
			this.titleText.setColor(UI.green);
			this.titleText.setText(`${STEPS[this.index].title}  ✓`);
		}
		this.scene.soundSystem?.play('click', { volume: 0.35 });
		this.highlightFrame?.setVisible(false);
		this.pointerIcon?.setVisible(false);
	}

	private advance(): void {
		this.index += 1;
		if (this.index >= STEPS.length) {
			this.showCompletion();
			return;
		}
		this.stepElapsed = 0;
		this.renderStep();
	}

	private showCompletion(): void {
		this.scene.waveSystem?.announce?.('안내 완료 — 나머지는 몸이 배웁니다', '#9bc25b');
		this.finish(true);
	}

	// ---------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------

	private build(): void {
		const scene = this.scene;
		const hs = hudScaleFor(scene);
		this.hs = hs;

		const w = 366 * hs;
		const h = 172 * hs;
		const x = 20 * hs;
		const y = scene.scale.height - 112 * hs - h;

		const track = (object: Phaser.GameObjects.GameObject) => {
			const positioned = object as Phaser.GameObjects.Image;
			positioned.setScrollFactor?.(0);
			positioned.setDepth?.(DEPTH + 1);
			this.objects.push(object);
			return object;
		};

		this.cardPanel = panel(scene, x, y, w, h, { alpha: 0.97 });
		this.cardPanel.setScrollFactor(0).setDepth(DEPTH);
		this.objects.push(this.cardPanel);

		track(insetPanel(scene, x + 10 * hs, y + 8 * hs, w - 20 * hs, 26 * hs, { alpha: 0.9 }));

		this.titleText = scene.add.text(x + 20 * hs, y + 21 * hs, '', {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: `${13.5 * hs}px`, fontStyle: '900', color: UI.quenchText,
		}).setOrigin(0, 0.5);
		track(this.titleText);

		this.stepText = scene.add.text(x + w - 20 * hs, y + 21 * hs, '',
			style(11 * hs, UI.textFaint, { display: true })).setOrigin(1, 0.5);
		track(this.stepText);

		this.bodyText = scene.add.text(x + 20 * hs, y + 44 * hs, '', {
			...style(11.5 * hs, UI.text, { bold: false }),
			lineSpacing: 5 * hs,
			wordWrap: { width: w - 40 * hs },
		}).setOrigin(0, 0);
		track(this.bodyText);

		// 건너뛰기 (카드 우하단)
		const skip = scene.add.text(x + w - 18 * hs, y + h - 16 * hs, '건너뛰기',
			style(11 * hs, UI.textFaint, { display: true })).setOrigin(1, 0.5)
			.setInteractive({ useHandCursor: true });
		// 글자 폭 40×12 로는 사실상 못 누른다 — 최소 터치 타깃까지 넓힌다
		expandHit(skip);
		skip.on('pointerover', () => skip.setColor(UI.emberText));
		skip.on('pointerout', () => skip.setColor(UI.textFaint));
		skip.on('pointerdown', () => {
			this.scene.waveSystem?.announce?.('안내를 접었습니다 — 설정에서 다시 볼 수 있습니다', '#8d9aa5');
			this.finish(true);
		});
		track(skip);

		// 하이라이트 프레임 + 지시 화살표 (위치는 updateHighlight 가 매 프레임 갱신)
		this.highlightFrame = selectFrame(scene, 0, 0, 80, 80, { tint: UI.straw })
			.setScrollFactor(0).setDepth(DEPTH - 1).setVisible(false);
		this.objects.push(this.highlightFrame);

		this.pointerIcon = iconImage(scene, 'g-boot', 0, 0, 22 * hs, UI.straw);
		(this.pointerIcon as Phaser.GameObjects.Image).setScrollFactor?.(0);
		this.pointerIcon.setDepth(DEPTH + 2);
		this.pointerIcon.setVisible(false);
		this.objects.push(this.pointerIcon);

		if (!reduceMotion()) {
			scene.tweens.add({
				targets: this.highlightFrame, alpha: 0.45,
				yoyo: true, repeat: -1, duration: 720, ease: 'Sine.easeInOut',
			});
		}
	}

	private renderStep(): void {
		const step = STEPS[this.index];
		if (!step || !this.titleText || !this.bodyText || !this.stepText) {
			return;
		}
		this.titleText.setColor(UI.quenchText);
		this.titleText.setText(step.title);
		this.stepText.setText(`${this.index + 1} / ${STEPS.length}`);

		const keys = typeof step.keys === 'function' ? step.keys() : step.keys;
		const keyLine = keys?.length
			? `\n\n${keys.join(' · ')} 키`
			: '';
		this.bodyText.setText(`${resolveKeyTokens(step.body)}${keyLine}`);

		this.highlightFrame?.setVisible(false);
		this.pointerIcon?.setVisible(false);
		this.updateHighlight();
	}

	private updateHighlight(): void {
		const step = STEPS[this.index];
		const frame = this.highlightFrame;
		const pointer = this.pointerIcon as Phaser.GameObjects.Image | null;
		if (!step || !frame) {
			return;
		}
		const rect = step.highlight?.(this) ?? null;
		if (!rect) {
			frame.setVisible(false);
			pointer?.setVisible(false);
			return;
		}
		const px = 2;
		frame.setPosition(rect.x + rect.w / 2, rect.y + rect.h / 2);
		frame.setSize((rect.w + 16) / px, (rect.h + 16) / px);
		frame.setVisible(true);

		if (pointer) {
			// 화살표는 하이라이트의 왼쪽(또는 화면 밖이면 위)에서 가리킨다
			const hs = this.hs;
			const gap = 22 * hs;
			const leftRoom = rect.x - gap > 8;
			if (leftRoom) {
				pointer.setPosition(rect.x - gap, rect.y + rect.h / 2);
				pointer.setRotation(0);
			} else {
				pointer.setPosition(rect.x + rect.w / 2, rect.y - gap);
				pointer.setRotation(Math.PI / 2);
			}
			pointer.setVisible(true);
		}
	}

	private setHidden(hidden: boolean): void {
		if (this.hidden === hidden) {
			return;
		}
		this.hidden = hidden;
		for (const object of this.objects) {
			(object as Phaser.GameObjects.Image).setVisible?.(!hidden);
		}
		if (!hidden) {
			// 다시 보일 때는 하이라이트 상태를 재계산한다
			this.updateHighlight();
		}
	}

	private teardown(): void {
		for (const object of this.objects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.objects = [];
		this.titleText = null;
		this.bodyText = null;
		this.stepText = null;
		this.cardPanel = null;
		this.highlightFrame = null;
		this.pointerIcon = null;
		this.hidden = false;
	}

	// ---------------------------------------------------------------
	// 하이라이트 대상 (전부 화면 좌표)
	// ---------------------------------------------------------------

	/** 플레이어 (월드 → 화면) */
	playerRect(): Rect | null {
		const player = this.scene.player;
		if (!player) {
			return null;
		}
		const camera = this.scene.cameras.main;
		const zoom = camera.zoom || 1;
		const sx = (player.x - camera.worldView.x) * zoom;
		const sy = (player.y - camera.worldView.y) * zoom;
		const size = 76 * zoom;
		return { x: sx - size / 2, y: sy - size / 2, w: size, h: size };
	}

	/** 좌하단 검 스트립 (sword/hud.ts 가 기록한 실제 슬롯 사각형) */
	swordStripRect(): Rect | null {
		const rects = this.scene.swordOrbit?.hudSlotRects;
		if (!rects?.length) {
			return null;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const slotRect of rects) {
			minX = Math.min(minX, slotRect.x);
			minY = Math.min(minY, slotRect.y);
			maxX = Math.max(maxX, slotRect.x + slotRect.size);
			maxY = Math.max(maxY, slotRect.y + slotRect.size);
		}
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
	}

	/** 하단 능동 스킬 아이콘 (활공 사냥 칸 — ActiveSkillSystem 이 기록한 실제 위치) */
	skillIconRect(): Rect | null {
		return this.scene.activeSkills?.iconRect('dive') ?? null;
	}

	/** 좌상단 경험치 바 (HudSystem.buildStatic 과 같은 좌표계) */
	xpBarRect(): Rect | null {
		const hs = this.scene.hudSystem?.hs ?? 1;
		return { x: 104 * hs, y: 42 * hs, w: 224 * hs, h: 18 * hs };
	}

	/** 좌상단 골드 표기 */
	goldRect(): Rect | null {
		const hs = this.scene.hudSystem?.hs ?? 1;
		return { x: 100 * hs, y: 56 * hs, w: 130 * hs, h: 24 * hs };
	}

	/** 대기마을 북쪽 게이트 (월드 → 화면) */
	gateRect(): Rect | null {
		const gate = this.scene.villageSystem?.stallAt?.('gate');
		if (!gate) {
			return null;
		}
		const camera = this.scene.cameras.main;
		const zoom = camera.zoom || 1;
		const sx = (gate.x - camera.worldView.x) * zoom;
		const sy = (gate.y - camera.worldView.y) * zoom;
		const w = 190 * zoom;
		const h = 150 * zoom;
		return { x: sx - w / 2, y: sy - h / 2, w, h };
	}

	// ---------------------------------------------------------------
	// 판정 헬퍼
	// ---------------------------------------------------------------

	/** 같은 속성 검 2자루 이상 (공명 성립) */
	hasElementPair(): boolean {
		const swords = this.scene.swordOrbit?.swords ?? [];
		if (swords.length < 2) {
			return false;
		}
		const counts: Record<string, number> = {};
		for (const sword of swords) {
			const element = sword.definition?.element;
			if (!element) {
				continue;
			}
			counts[element] = (counts[element] ?? 0) + 1;
			if (counts[element] >= 2) {
				return true;
			}
		}
		return false;
	}
}
