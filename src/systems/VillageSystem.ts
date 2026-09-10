// 대기마을 — 라운드 사이의 걸어다니는 허브 (2026-08-31 사용자 결정: 화면 UI 대기실 폐지).
//
// 구성 (플라자 중심 좌표계):
//   중앙  분수(분위기) · 남쪽 플레이어 입장
//   서쪽  대장간   — E: 통합 검 화면 한 번에 (구매 목록 + 장착 7자리 + 보관함 + 조합)
//   동쪽  에다     — E: 능력치 강화 (상점의 능력치 모달로 진입) — NPC 애니메이션
//   남동  증강 제단 — E: 골드로 증강 드래프트 구매
//   북쪽  게이트   — 다음 라운드 입구. E: 정찰 보고(전체 상성 정보) · SPACE: 출발
//
// 라운드 종료 3초 여운 뒤 WaveSystem 이 enter()를 호출하고, 게이트에서 출발하면
// exit() → WaveSystem.pendingIntermission 해제 → 다음 라운드 startRound.
// 마을 동안 적 스폰·웨이브 갱신은 GameScene.update 가 건너뛴다.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { MapTheme } from '../logic/mapThemes';
import type { EnemyDefinition, Element } from '../types/catalogs';
import type { RoundIntel } from './WaveSystem';
import {
	FONT, UI, style, panel, insetPanel, slot, banner, button, keycap, divider, iconImage,
	createUiRoot, hudScaleFor, ELEMENT_THEME, TEXT_RESOLUTION, type UiRoot,
} from '../ui/theme';
import {
	traitsOf, weakElements, resistElements, immunities, getTraitById, CC_LABELS, type EnemyTrait,
} from '../logic/enemyTraits';
import { activeSkillsFor, BOSS_SKILLS, type BossSkillId } from '../logic/bossSkills';
import { ENEMY_ATLAS } from '../core/textures';
import RunSave from '../core/RunSave';
import { getBinding, actionKeyLabel } from '../core/keybinds';
import { openStallWindow, type StallKind, type StallWindow } from './village/StallWindows';

/** 마을 전용 맵 테마 — 금빛 유적 바닥 + 잔해 소품 (단색 금지 규칙 준수: 질감 타일) */
const VILLAGE_THEME: MapTheme = {
	id: 'village',
	name: '정비 마을',
	desc: '화로 연기가 낮게 깔린 키퍼들의 쉼터',
	tile: 4,
	layerTint: 0xffeecc,
	decoTint: 0xffeecc,
	bgColor: 0x171208,
	accent: '#d9a83c',
	element: 'gold',
	decos: [
		{ key: 'deco2-gold-3', size: 30, small: true },
		{ key: 'deco2-gold-4', size: 26, small: true },
	],
	density: 0.6,
};

interface Stall {
	id: string;
	label: string;
	promptLabel: string;
	x: number;
	y: number;
	radius: number;
	onInteract: () => void;
	objects: Phaser.GameObjects.GameObject[];
}

const DEPTH_PROP = 5;
const DEPTH_LABEL = 12;
const MODAL_DEPTH = 2600;

export default class VillageSystem {
	scene: GameScene;
	isActive = false;
	/** 마을에 대응하는 "다음 라운드" 번호 (게이트로 입장할 라운드) */
	nextRound = 1;

	private stalls: Stall[] = [];
	private objects: Phaser.GameObjects.GameObject[] = [];
	private promptText: Phaser.GameObjects.Text | null = null;
	private promptBg: Phaser.GameObjects.NineSlice | null = null;
	private activeStall: Stall | null = null;
	private keyE: Phaser.Input.Keyboard.Key | null = null;
	private keySpace: Phaser.Input.Keyboard.Key | null = null;
	/** ENTER — 게임패드 A 가 합성하는 확정 키 (출발 보조) */
	private keyEnter: Phaser.Input.Keyboard.Key | null = null;
	private center = { x: 0, y: 0 };
	/** 마을 경계 (플레이어 클램프) */
	private bounds = { hw: 430, hh: 310 };
	private leaving = false;

	// 정찰 모달
	private scoutRoot: UiRoot | null = null;
	private scoutObjects: Phaser.GameObjects.GameObject[] = [];
	scoutOpen = false;

	// 시설 전용 창 (대장간/에다/제단 — StallWindows.ts)
	activeWindow: StallWindow | null = null;

	get windowOpen(): boolean {
		return this.activeWindow !== null;
	}

	/** 시설 위치 조회 (튜토리얼 하이라이트·회귀 테스트용) */
	stallAt(id: string): { x: number; y: number } | null {
		const stall = this.stalls.find((entry) => entry.id === id);
		return stall ? { x: stall.x, y: stall.y } : null;
	}

	openStall(kind: StallKind): void {
		this.closeScout();
		this.activeWindow?.destroy();
		this.activeWindow = openStallWindow(this, kind);
		this.scene.soundSystem?.play('click', { volume: 0.4 });
	}

	/** WindowBase.close 가 호출 — 참조 해제 */
	onWindowClosed(window: StallWindow): void {
		if (this.activeWindow === window) {
			this.activeWindow = null;
		}
	}

	/** 창 내부 rebuild 용 (구매 후 같은 종류로 재구축) */
	replaceWindow(window: StallWindow): void {
		this.activeWindow = window;
	}

	/** 열린 시설 창을 닫는다 (참조 먼저 끊어 destroy → onWindowClosed 재진입을 막는다) */
	closeActiveWindow(): void {
		const window = this.activeWindow;
		if (!window) {
			return;
		}
		this.activeWindow = null;
		window.destroy();
	}

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	// ---------------------------------------------------------------
	// 입장 / 퇴장
	// ---------------------------------------------------------------

	/** 라운드 round 클리어 후 마을 입장 (다음 라운드 = round + 1) */
	enter(round: number): void {
		if (this.isActive) {
			return;
		}
		this.isActive = true;
		this.leaving = false;
		this.nextRound = round + 1;

		const scene = this.scene;
		// 상점/증강 가격 계산이 참조하는 라운드를 마을 시점으로 맞춘다
		if (scene.shopSystem) {
			scene.shopSystem.round = round;
		}
		const cx = scene.scale.width / 2;
		const cy = scene.scale.height / 2;
		this.center = { x: cx, y: cy };

		// 세계 교체 (가림막 뒤): 마을 테마 + 플레이어 남쪽 배치
		const cover = scene.add.rectangle(cx, cy, scene.scale.width, scene.scale.height, 0x06080a, 1)
			.setScrollFactor(0).setDepth(2790);
		scene.applyMapTheme(VILLAGE_THEME);
		if (scene.player) {
			scene.player.setPosition(cx, cy + 200);
			(scene.player.body as Phaser.Physics.Arcade.Body | null)?.reset(cx, cy + 200);
			// 마을은 안식처 — 입장하며 상처를 모두 치료한다 (다음 라운드는 만전으로)
			if (!scene.player.isDead && scene.player.hp < scene.player.maxHp) {
				scene.player.hp = scene.player.maxHp;
			}
		}
		for (const sword of scene.swordOrbit?.swords ?? []) {
			sword.setPosition(cx, cy + 200);
		}
		scene.cameras.main.centerOn(cx, cy + 120);
		scene.updateChunksAroundPlayer(cx, cy + 200, true);
		scene.processChunkQueue(24);

		this.buildProps();
		scene.waveSystem?.setHudVisible(false);

		// 마을 타이틀 + 가림막 걷기
		const title = scene.add.text(cx, 120, '정비 마을', {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '34px', fontStyle: '900', color: UI.white,
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2791).setAlpha(0);
		title.setShadow(0, 3, '#000000', 8, false, true);
		const sub = scene.add.text(cx, 154, `다음 — 라운드 ${this.nextRound} · 북쪽 게이트로 출발`, style(13, '#c3ccd3'))
			.setOrigin(0.5).setScrollFactor(0).setDepth(2791).setAlpha(0);
		sub.setShadow(0, 2, '#000000', 4, false, true);
		scene.tweens.add({ targets: [title, sub], alpha: 1, duration: 300, delay: 150 });
		scene.tweens.add({
			targets: [title, sub], alpha: 0, delay: 2400, duration: 400,
			onComplete: () => { title.destroy(); sub.destroy(); },
		});
		scene.tweens.add({
			targets: cover, alpha: 0, duration: 450, delay: 120,
			onComplete: () => cover.destroy(),
		});

		// 키 입력은 'down' 이벤트로 받는다 — 폴링(JustDown/에지 검출)은 down+up 이
		// 한 프레임 사이에 끝나는 빠른 입력(자동화 포함)을 놓친다.
		// 상호작용 키는 리맵 대상(기본 E). 출발은 SPACE 고정 + ENTER(게임패드 A) 보조.
		this.keyE = scene.input.keyboard!.addKey(getBinding('interact'));
		this.keyE.on('down', this.onInteractKey, this);
		this.keySpace = scene.input.keyboard!.addKey('SPACE');
		this.keySpace.on('down', this.onDepartKey, this);
		this.keyEnter = scene.input.keyboard!.addKey('ENTER');
		this.keyEnter.on('down', this.onDepartKey, this);
	}

	/** E — 가장 가까운 시설 상호작용 (열린 창이 있으면 창 자체 핸들러가 닫는다) */
	private onInteractKey(): void {
		if (!this.isActive || this.leaving) {
			return;
		}
		const scene = this.scene;
		// 통합 검 화면(대장간)이 열려 있으면 E 로 닫는다 — 다른 시설 창과 같은 토글 감각
		if (scene.shopSystem?.isOpen && this.activeWindow?.kind === 'smith') {
			this.closeActiveWindow();
			return;
		}
		if (scene.shopSystem?.isOpen || scene.augmentSystem?.isOpen || scene.isPaused || this.windowOpen) {
			return;
		}
		if (this.scoutOpen) {
			this.closeScout();
			return;
		}
		this.activeStall?.onInteract();
	}

	/** SPACE — 게이트 근처(또는 정찰 모달)에서 출발 */
	private onDepartKey(): void {
		if (!this.isActive || this.leaving) {
			return;
		}
		const scene = this.scene;
		if (scene.shopSystem?.isOpen || scene.augmentSystem?.isOpen || scene.isPaused || this.windowOpen) {
			return;
		}
		if (this.scoutOpen || this.activeStall?.id === 'gate') {
			this.depart();
		}
	}

	/** 게이트 출발 — 마을 정리 후 WaveSystem 걸쇠 해제 (다음 update 에서 startRound) */
	depart(): void {
		if (!this.isActive || this.leaving) {
			return;
		}
		this.leaving = true;
		this.closeScout();
		// 재도전이 되돌아올 지점은 "게이트를 나선 순간"이다. 마을 입장 때 찍은 스냅샷만
		// 믿으면 에다 능력치·증강 제단 구매가 스냅샷에 없어서, 죽고 재도전할 때마다
		// 쓴 골드가 되살아난다(잔액이 특정 값에 못 박히는 버그). 출발 직전에 다시 찍는다.
		if (!this.scene.isGameOver && !this.scene.player?.isDead) {
			RunSave.save(RunSave.capture(this.scene));
		}
		this.scene.soundSystem?.play('click', { volume: 0.5 });
		// 게이트 통과 연출은 stageRoundEntry(가림막+타이틀)가 이어받는다
		this.exit();
		if (this.scene.waveSystem) {
			this.scene.waveSystem.pendingIntermission = false;
		}
	}

	exit(): void {
		if (!this.isActive) {
			return;
		}
		this.isActive = false;
		this.closeScout();
		this.activeWindow?.destroy();
		this.activeWindow = null;
		for (const object of this.objects) {
			object.destroy();
		}
		this.objects = [];
		this.stalls = [];
		this.promptText = null;
		this.promptBg = null;
		this.activeStall = null;
		if (this.keyE) {
			this.scene.input.keyboard?.removeKey(this.keyE, true);
			this.keyE = null;
		}
		if (this.keySpace) {
			this.scene.input.keyboard?.removeKey(this.keySpace, true);
			this.keySpace = null;
		}
		if (this.keyEnter) {
			this.scene.input.keyboard?.removeKey(this.keyEnter, true);
			this.keyEnter = null;
		}
		this.scene.waveSystem?.setHudVisible(true);
	}

	// ---------------------------------------------------------------
	// 마을 구성
	// ---------------------------------------------------------------

	private prop(key: string, x: number, y: number, height: number, depth = DEPTH_PROP): Phaser.GameObjects.Image {
		const img = this.scene.add.image(x, y, key);
		const aspect = img.frame && img.frame.height > 0 ? img.frame.width / img.frame.height : 1;
		img.setDisplaySize(Math.round(height * aspect), height);
		img.setDepth(depth);
		this.objects.push(img);
		return img;
	}

	private worldLabel(x: number, y: number, text: string, color = UI.white, size = 14): Phaser.GameObjects.Text {
		const label = this.scene.add.text(x, y, text, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: `${size}px`, fontStyle: '800', color,
		}).setOrigin(0.5).setDepth(DEPTH_LABEL);
		label.setShadow(0, 2, '#000000', 4, false, true);
		this.objects.push(label);
		return label;
	}

	private buildProps(): void {
		const scene = this.scene;
		const { x: cx, y: cy } = this.center;
		const shop = scene.shopSystem;

		// 중앙 분수 + 모닥불 (분위기)
		this.prop('vlg-fountain', cx, cy - 10, 150);
		this.prop('vlg-campfire', cx - 190, cy + 180, 74);
		this.worldLabel(cx - 190, cy + 132, '모닥불', '#e8874a', 12);

		// ── 게이트 (북쪽): 다음 라운드 입구 + 정찰 게시판 (라벨은 아치 위에 겹치지 않게)
		const gate = this.prop('vlg-gate', cx, cy - 260, 190);
		gate.setDepth(4);
		this.prop('vlg-torch', cx - 118, cy - 234, 40);
		this.prop('vlg-torch', cx + 118, cy - 234, 40);
		const intel = scene.waveSystem?.getRoundIntel?.(this.nextRound) ?? null;
		const headline = intel
			? `라운드 ${this.nextRound} — ${intel.objective.label}`
			: `라운드 ${this.nextRound}`;
		this.worldLabel(cx, cy - 410, headline, '#ffc579', 16);
		if (intel) {
			this.worldLabel(cx, cy - 386, `${intel.theme.name} · ${intel.theme.desc}`, '#c3ccd3', 12);
			// 게시판: 목표 대상의 약점 원소 아이콘 요약 (잔디 위에서 묻히지 않게 어두운 칩 배경)
			const weak = this.collectWeak(intel).slice(0, 4);
			if (weak.length > 0) {
				const chipW = weak.length * 28 + 74;
				const chip = scene.add.rectangle(cx - 6, cy - 362, chipW, 26, 0x10131a, 0.62)
					.setDepth(DEPTH_LABEL - 1);
				this.objects.push(chip);
				this.worldLabel(cx - (weak.length) * 14 - 34, cy - 362, '약점', '#ffab5e', 12);
			}
			weak.forEach((entry, index) => {
				const theme = ELEMENT_THEME[entry.element];
				if (!theme) {
					return;
				}
				const icon = iconImage(scene, theme.tex, cx - (weak.length - 1) * 14 + index * 28, cy - 362, 20, theme.num);
				(icon as Phaser.GameObjects.Image).setDepth?.(DEPTH_LABEL);
				this.objects.push(icon);
			});
		}
		this.stalls.push({
			id: 'gate', label: '게이트',
			promptLabel: `${actionKeyLabel('interact')} 정찰 보고 · SPACE 출발`,
			x: cx, y: cy - 248, radius: 130,
			onInteract: () => this.toggleScout(),
			objects: [],
		});

		// ── 대장간 (서쪽): 통합 검 화면 (구매 + 장착 + 보관함 + 조합)
		this.prop('vlg-block', cx - 316, cy - 34, 58);
		this.prop('vlg-sign', cx - 258, cy - 52, 40);
		this.prop('vlg-slab', cx - 356, cy + 6, 34);
		this.worldLabel(cx - 310, cy - 92, '대장간', '#ffc579');
		this.worldLabel(cx - 310, cy - 72, '검 구매 · 장비 · 보관함 · 조합', '#c3ccd3', 11);
		this.stalls.push({
			id: 'smith', label: '대장간',
			// 2026-09-02: E 한 번이면 통합 검 화면(구매+보유)이 바로 열린다
			promptLabel: `${actionKeyLabel('interact')} 대장간 — 검 구매 · 장비 (한 화면)`,
			x: cx - 310, y: cy - 20, radius: 100,
			onInteract: () => {
				if (shop?.isOpen) {
					return;
				}
				this.openStall('smith');
			},
			objects: [],
		});

		// ── 에다 (동쪽): 능력치 강화 — NPC 애니메이션
		const edda = scene.add.sprite(cx + 310, cy - 40, 'vlg-edda', 0);
		edda.setDisplaySize(132, 132);
		edda.setFlipX(true);
		edda.setDepth(DEPTH_PROP);
		if (scene.anims.exists('vlg-edda-idle')) {
			edda.play('vlg-edda-idle');
		}
		this.objects.push(edda);
		this.prop('vlg-sign2', cx + 252, cy - 48, 40);
		this.worldLabel(cx + 310, cy - 116, '에다', '#ffc579');
		this.worldLabel(cx + 310, cy - 96, '능력치 강화', '#c3ccd3', 11);
		this.stalls.push({
			id: 'edda', label: '에다',
			promptLabel: `${actionKeyLabel('interact')} 능력치 강화`,
			x: cx + 310, y: cy - 30, radius: 100,
			onInteract: () => {
				if (shop?.isOpen) {
					return;
				}
				this.openStall('edda');
			},
			objects: [],
		});

		// ── 증강 제단 (남동)
		this.prop('vlg-altar', cx + 210, cy + 172, 120);
		this.prop('vlg-chalice', cx + 152, cy + 206, 42);
		this.worldLabel(cx + 210, cy + 96, '증강 제단', '#ffc579');
		this.stalls.push({
			id: 'altar', label: '증강 제단',
			promptLabel: `${actionKeyLabel('interact')} 증강 제단`,
			x: cx + 210, y: cy + 180, radius: 96,
			onInteract: () => {
				this.openStall('altar');
			},
			objects: [],
		});

		// ── 화면 하단 상호작용 프롬프트 (근처 갈 때만 표시)
		const promptY = scene.scale.height - 92;
		this.promptBg = insetPanel(scene, scene.scale.width / 2 - 180, promptY - 18, 360, 36, { alpha: 0.94 });
		this.promptBg.setScrollFactor(0).setDepth(1500).setVisible(false);
		this.promptText = scene.add.text(scene.scale.width / 2, promptY, '', style(14, UI.text, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(1501).setVisible(false);
		this.objects.push(this.promptBg, this.promptText);
	}

	/** 목표(보스/정예) 우선 + 풀 순서로 약점 원소를 모은다 (게시판·정찰 공용) */
	private collectWeak(intel: RoundIntel): Array<{ element: Element; bonus: number; fromTarget: boolean }> {
		const acc = new Map<Element, { bonus: number; fromTarget: boolean }>();
		const push = (def: EnemyDefinition, fromTarget: boolean) => {
			for (const entry of weakElements(traitsOf(def))) {
				const existing = acc.get(entry.element);
				if (!existing
					|| (fromTarget && !existing.fromTarget)
					|| (fromTarget === existing.fromTarget && entry.bonus > existing.bonus)) {
					acc.set(entry.element, { bonus: entry.bonus, fromTarget: fromTarget || (existing?.fromTarget ?? false) });
				}
			}
		};
		for (const target of intel.targets) {
			push(target.def, true); // 목표가 우선
		}
		for (const def of intel.pool) {
			push(def, false);
		}
		return [...acc.entries()]
			.map(([element, entry]) => ({ element, bonus: entry.bonus, fromTarget: entry.fromTarget }))
			.sort((a, b) => (Number(b.fromTarget) - Number(a.fromTarget)) || (b.bonus - a.bonus));
	}

	// ---------------------------------------------------------------
	// 프레임 갱신 (GameScene.update 가 마을 활성 시 호출)
	// ---------------------------------------------------------------

	update(): void {
		if (!this.isActive) {
			return;
		}
		const scene = this.scene;
		const player = scene.player;
		if (!player) {
			return;
		}

		// 마을 경계 클램프 (물리 벽 대신 위치 클램프 — 단순·확실)
		const clampedX = Phaser.Math.Clamp(player.x, this.center.x - this.bounds.hw, this.center.x + this.bounds.hw);
		const clampedY = Phaser.Math.Clamp(player.y, this.center.y - this.bounds.hh, this.center.y + this.bounds.hh + 60);
		if (clampedX !== player.x || clampedY !== player.y) {
			player.setPosition(clampedX, clampedY);
		}

		// 다른 오버레이(상점·증강·정찰·시설 창)가 열려 있으면 상호작용 잠금
		const overlayOpen = scene.shopSystem?.isOpen || scene.augmentSystem?.isOpen || this.scoutOpen || this.windowOpen;

		// 근접 상호작용 판정
		let nearest: Stall | null = null;
		let nearestDist = Infinity;
		for (const stall of this.stalls) {
			const dist = Phaser.Math.Distance.Between(player.x, player.y, stall.x, stall.y);
			if (dist < stall.radius && dist < nearestDist) {
				nearest = stall;
				nearestDist = dist;
			}
		}
		this.activeStall = nearest;

		if (this.promptText && this.promptBg) {
			if (nearest && !overlayOpen) {
				const label = nearest.promptLabel;
				if (this.promptText.text !== label) {
					this.promptText.setText(label);
					const w = Math.max(240, this.promptText.width + 56);
					this.promptBg.setPosition(this.scene.scale.width / 2 - w / 2, this.promptText.y - 18);
					this.promptBg.setSize(w / 2, 36 / 2); // insetPanel px=2 → setSize는 절반 단위
				}
				this.promptText.setVisible(true);
				this.promptBg.setVisible(true);
			} else {
				this.promptText.setVisible(false);
				this.promptBg.setVisible(false);
			}
		}

		// 키 입력은 enter()에서 등록한 'down' 이벤트 핸들러가 처리한다

		// 상점이 마을 위에서 열렸다 닫히면 wave HUD 가 다시 켜진다 — 마을 동안은 꺼 둔다
		if (scene.waveSystem?.hudG?.visible) {
			scene.waveSystem.setHudVisible(false);
		}
	}

	// ---------------------------------------------------------------
	// 정찰 보고 모달 — 다음 라운드의 모든 정보 (특성 상성 전체 표)
	// ---------------------------------------------------------------

	toggleScout(): void {
		if (this.scoutOpen) {
			this.closeScout();
		} else {
			this.openScout();
		}
	}

	closeScout(): void {
		if (!this.scoutOpen) {
			return;
		}
		this.scoutOpen = false;
		for (const object of this.scoutObjects) {
			object.destroy();
		}
		this.scoutObjects = [];
		this.scoutRoot?.destroy();
		this.scoutRoot = null;
	}

	openScout(): void {
		if (this.scoutOpen) {
			return;
		}
		const intel = this.scene.waveSystem?.getRoundIntel?.(this.nextRound);
		if (!intel) {
			return;
		}
		this.scoutOpen = true;
		const scene = this.scene;

		const dim = scene.add.rectangle(
			scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, 0x06080a, 0.7,
		).setDepth(MODAL_DEPTH - 1).setInteractive();
		dim.setScrollFactor(0);
		dim.on('pointerdown', () => this.closeScout());
		this.scoutObjects.push(dim);

		this.scoutRoot = createUiRoot(scene, MODAL_DEPTH);
		const width = this.scoutRoot.width;
		const height = this.scoutRoot.height;
		const panelW = Math.min(940, width - 90);
		// 내용 기반 높이 추정 — 목표가 적고 잡몹이 없는 초반 라운드에서 빈 공간이 생기지 않게
		const targetsH = intel.targets.slice(0, 3)
			.reduce((sum, target) => sum + 34 + this.targetCardRows(target.def, intel.round) * 21 + 12 + 8, 0);
		const poolH = intel.pool.length > 0 ? 24 + Math.ceil(Math.min(intel.pool.length, 8) / 2) * 30 + 6 : 0;
		const recoH = 54 + 16;
		const estimated = 86 + targetsH + poolH + recoH + 96;
		const panelH = Math.max(340, Math.min(Math.min(640, height - 60), estimated));
		const px = (width - panelW) / 2;
		const py = (height - panelH) / 2;
		const parts: Phaser.GameObjects.GameObject[] = [];

		const frame = panel(scene, px, py, panelW, panelH);
		const swallow = scene.add.rectangle(px + panelW / 2, py + panelH / 2, panelW, panelH, 0x000000, 0.001)
			.setInteractive();
		parts.push(frame, swallow);

		// 헤더 배너 (어두운 강판 킷 — 제목은 밝은 금색)
		const head = banner(scene, px + panelW / 2, py + 18, 360);
		const title = scene.add.text(px + panelW / 2, py + 14, `정찰 보고 — 라운드 ${intel.round}`,
			style(19, '#ffc579', { display: true })).setOrigin(0.5);
		parts.push(head, title);

		// 지형·목표 요약 줄
		const accent = intel.theme.accent;
		const summary = scene.add.text(px + 34, py + 52,
			`목표  ${intel.objective.label}`, style(15, UI.text, { display: true })).setOrigin(0, 0.5);
		const place = scene.add.text(px + panelW - 34, py + 52,
			`${intel.theme.name} — ${intel.theme.desc}`, style(13, accent, { display: true })).setOrigin(1, 0.5);
		parts.push(summary, place);
		const div1 = divider(scene, px + panelW / 2, py + 72, panelW - 60);
		parts.push(div1);

		let cursorY = py + 86;

		// ── 목표 대상 (보스/정예) — 큰 카드: 전체 특성 표
		for (const target of intel.targets.slice(0, 3)) {
			cursorY = this.buildTargetCard(scene, parts, px + 30, cursorY, panelW - 60, target.def, target.count);
		}

		// ── 잡몹 스트립
		if (intel.pool.length > 0) {
			const label = scene.add.text(px + 34, cursorY + 10, '일반 적', style(13, UI.textDim, { display: true }))
				.setOrigin(0, 0.5);
			parts.push(label);
			cursorY += 24;
			cursorY = this.buildPoolRows(scene, parts, px + 30, cursorY, panelW - 60, intel.pool);
		}

		// ── 추천 원소 + 보유 대조
		cursorY += 8;
		const recos = this.collectWeak(intel).slice(0, 3);
		if (recos.length > 0) {
			const inset = insetPanel(scene, px + 30, cursorY, panelW - 60, 54);
			parts.push(inset);
			const recoLabel = scene.add.text(px + 46, cursorY + 27, '추천 원소', style(14, '#ffc579', { display: true }))
				.setOrigin(0, 0.5);
			parts.push(recoLabel);
			let rx = px + 146;
			const orbit = this.scene.swordOrbit;
			for (const reco of recos) {
				const theme = ELEMENT_THEME[reco.element];
				if (!theme) {
					continue;
				}
				const icon = iconImage(scene, theme.tex, rx, cursorY + 27, 22, theme.num);
				parts.push(icon);
				const owned = [...(orbit?.swords ?? []), ...(orbit?.reserve ?? [])]
					.filter((entry) => ('definition' in entry ? entry.definition?.element : undefined) === reco.element).length;
				const text = scene.add.text(rx + 16, cursorY + 27,
					`${theme.label} 검이 잘 통함 · 보유 ${owned}자루${owned === 0 ? ' — 대장간에서!' : ''}`,
					style(13, owned > 0 ? '#7fc46a' : '#ff8a63', { display: true })).setOrigin(0, 0.5);
				parts.push(text);
				rx += text.width + 58;
			}
		}

		// 하단: 출발 버튼 + 닫기 안내
		const departBtn = button(scene, px + panelW / 2, py + panelH - 44, 300, 46, `라운드 ${intel.round} 출발`, {
			variant: 'gold', fontSize: 16, display: true, key: 'SPACE',
			onClick: () => this.depart(),
		});
		parts.push(departBtn.container);
		const hint = scene.add.text(px + panelW / 2, py + panelH - 12, 'E · ESC · 바깥 클릭 — 닫기', style(10, UI.textFaint))
			.setOrigin(0.5);
		parts.push(hint);

		const escHandler = (event: KeyboardEvent) => {
			if (event.code === 'Escape' || event.code === 'KeyE') {
				event.stopImmediatePropagation?.();
				this.closeScout();
			}
		};
		// 다음 틱에 등록 — 정찰창을 "연" 그 E 키 이벤트가 곧바로 닫아버리는 것을 방지
		const register = scene.time.delayedCall(0, () => {
			if (this.scoutOpen) {
				scene.input.keyboard!.on('keydown', escHandler);
			}
		});
		const cleanup = {
			destroy: () => {
				register.remove(false);
				scene.input.keyboard?.off('keydown', escHandler);
			},
		} as unknown as Phaser.GameObjects.GameObject;
		this.scoutObjects.push(cleanup);

		// 입력 정합: 스크롤 카메라 아래에서 루트(0)와 자식 scrollFactor 가 다르면
		// 클릭 히트테스트가 카메라 스크롤만큼 어긋난다 (마을 창들과 동일 이슈)
		for (const part of parts) {
			(part as Phaser.GameObjects.Container).setScrollFactor?.(0, 0, true);
		}
		this.scoutRoot.add(...parts.filter((p) => p !== dim));
		this.scoutRoot.sort();
		this.scoutObjects.push(...parts);
	}

	/**
	 * 정찰 카드에 펼쳐 보여 줄 보스 스킬 최대 개수 (2026-09-02).
	 * 패턴이 9종까지 늘어나 전부 펼치면 카드 하나가 화면을 덮는다 — 나머지는 한 줄로 요약한다.
	 */
	private static readonly SCOUT_SKILL_ROWS = 4;

	/** 이 라운드에 카드가 차지할 스킬 줄 수 (펼친 것 + 요약 한 줄) */
	private skillRowsFor(def: EnemyDefinition, round: number): number {
		if (!def.isBoss) {
			return 0;
		}
		const total = activeSkillsFor(def.id, round).length;
		const shown = Math.min(total, VillageSystem.SCOUT_SKILL_ROWS);
		return shown + (total > shown ? 1 : 0);
	}

	/** 카드 본문 줄 수 (높이 추정 공용) — 잘 통함/안 통함/면역 + 스킬 + 페이즈 */
	private targetCardRows(def: EnemyDefinition, round: number): number {
		if (def.phases?.length) {
			return def.phases.length + 1 + this.skillRowsFor(def, round);
		}
		const traits = traitsOf(def);
		let rows = 0;
		if (weakElements(traits).length > 0) rows += 1;
		if (resistElements(traits).length > 0) rows += 1;
		if (immunities(traits).length > 0) rows += 1;
		if (rows === 0) rows = 1;
		rows += this.skillRowsFor(def, round);
		return rows;
	}

	/**
	 * 보스/정예 카드 — "뭘 들면 되는지"가 한눈에:
	 *   ✔ 잘 통함 [원소칩…] 피해 큼 / ✘ 안 통함 [칩…] 피해 반감 / ⊘ 안 걸림 감속·넉백…
	 * 보스는 스킬+파훼법, 페이즈 보스(탈각)는 형태별 요약.
	 */
	private buildTargetCard(
		scene: GameScene, parts: Phaser.GameObjects.GameObject[],
		x: number, y: number, w: number, def: EnemyDefinition, count: number,
	): number {
		const traits = traitsOf(def);
		// 보스: 이 라운드에 해금된 스킬 패턴 + 파훼법까지 전부 공개
		const skills = def.isBoss ? activeSkillsFor(def.id, this.nextRound) : [];
		const rows = this.targetCardRows(def, this.nextRound);
		const cardH = 34 + rows * 21 + 12;
		const inset = insetPanel(scene, x, y, w, cardH);
		parts.push(inset);

		// 초상 슬롯 + 스프라이트
		const portrait = slot(scene, x + 34, y + cardH / 2, 48, def.isBoss ? 'orange' : 'slate');
		parts.push(portrait);
		const sheetKey = def.spritesheets?.idle?.textureKey;
		if (sheetKey && scene.textures.getFrame(ENEMY_ATLAS, `${sheetKey}/0`)) {
			const sprite = scene.add.image(x + 34, y + cardH / 2, ENEMY_ATLAS, `${sheetKey}/0`);
			sprite.setDisplaySize(44, 44);
			if (def.facing === 'right') {
				sprite.setFlipX(true);
			}
			parts.push(sprite);
		}

		const role = def.isBoss ? '보스' : def.isMiniboss ? '정예' : def.isElite ? '우두머리' : '목표';
		const name = scene.add.text(x + 66, y + 16, `${def.name}${count > 1 ? `  ×${count}` : ''}`,
			style(15, def.isBoss ? '#ff8a63' : UI.white, { display: true })).setOrigin(0, 0.5);
		const roleText = scene.add.text(x + 66 + name.width + 10, y + 17, role, style(11, '#d9a83c', { display: true }))
			.setOrigin(0, 0.5);
		parts.push(name, roleText);

		// 본문 줄
		let rowY = y + 36;
		if (def.phases?.length) {
			// 페이즈 보스(탈각하는 것): 형태별 한 줄 요약
			parts.push(scene.add.text(x + 66, rowY + 9, '허물을 벗을 때마다 잘 통하는 원소가 바뀐다!',
				style(12, '#ffc579', { display: true })).setOrigin(0, 0.5));
			rowY += 21;
			def.phases.forEach((phase, index) => {
				const phaseTraits = phase.traits
					.map((id) => getTraitById(id))
					.filter((trait): trait is EnemyTrait => Boolean(trait));
				const weak = weakElements(phaseTraits);
				const label = scene.add.text(x + 74, rowY + 9, `${index + 1}. ${phase.name}`,
					style(12, UI.white, { display: true })).setOrigin(0, 0.5);
				parts.push(label);
				let ix = x + 90 + label.width;
				const good = scene.add.text(ix, rowY + 9, '✔', style(12, '#7fc46a', { display: true })).setOrigin(0, 0.5);
				parts.push(good);
				ix += 16;
				ix = this.elementChips(scene, parts, ix, rowY + 9, weak.map((entry) => entry.element), 2);
				const skillNames = phase.skills.filter((id) => id !== 'enrage')
					.map((id) => BOSS_SKILLS[id as BossSkillId]?.name ?? id).join('·');
				if (skillNames) {
					parts.push(scene.add.text(ix + 8, rowY + 9, `조심: ${skillNames}`, style(11, '#9aa8b5'))
						.setOrigin(0, 0.5));
				}
				rowY += 21;
			});
		} else {
			rowY = this.matchupRows(scene, parts, x + 66, rowY, traits);
		}

		// 보스 스킬 줄: [스킬] 이름 — 파훼법 (최대 SCOUT_SKILL_ROWS 줄, 나머지는 요약)
		const shownSkills = skills.slice(0, VillageSystem.SCOUT_SKILL_ROWS);
		for (const skill of shownSkills) {
			const badge = scene.add.text(x + 74, rowY + 9, skill.id === 'beam' ? '즉살기' : '스킬',
				style(10.5, skill.id === 'beam' ? '#ff8a63' : '#d9a83c', { display: true })).setOrigin(0, 0.5);
			parts.push(badge);
			const nameText = scene.add.text(x + 122, rowY + 9, skill.name, style(12.5, UI.white, { display: true }))
				.setOrigin(0, 0.5);
			parts.push(nameText);
			parts.push(scene.add.text(x + 130 + nameText.width, rowY + 9, `— ${skill.counter}`, style(11.5, '#9aa8b5'))
				.setOrigin(0, 0.5));
			rowY += 21;
		}
		if (skills.length > shownSkills.length) {
			const rest = skills.slice(shownSkills.length).map((skill) => skill.name).join('·');
			parts.push(scene.add.text(x + 74, rowY + 9, `그 외 ${skills.length - shownSkills.length}종: ${rest}`,
				style(11.5, '#9aa8b5')).setOrigin(0, 0.5));
			rowY += 21;
		}

		return y + cardH + 8;
	}

	/** 원소 칩 나열: [아이콘]라벨 … — 다음 x 좌표 반환 */
	private elementChips(
		scene: GameScene, parts: Phaser.GameObjects.GameObject[],
		x: number, y: number, elements: string[], max = 3,
	): number {
		let ix = x;
		for (const element of elements.slice(0, max)) {
			const theme = ELEMENT_THEME[element];
			if (!theme) {
				continue;
			}
			parts.push(iconImage(scene, theme.tex, ix + 8, y, 15, theme.num));
			const label = scene.add.text(ix + 18, y, theme.label, style(12.5, theme.css, { display: true }))
				.setOrigin(0, 0.5);
			parts.push(label);
			ix += 22 + label.width + 10;
		}
		return ix;
	}

	/**
	 * 상성 요약 3줄 (특성 이름·수치 없이):
	 *   ✔ 잘 통함  [불] [바람]   피해 큼
	 *   ✘ 안 통함  [얼음]        피해 반감
	 *   ⊘ 안 걸림  감속·빙결
	 */
	private matchupRows(
		scene: GameScene, parts: Phaser.GameObjects.GameObject[],
		x: number, startY: number, traits: EnemyTrait[],
	): number {
		let rowY = startY;
		const weak = weakElements(traits);
		const resist = resistElements(traits);
		const immune = immunities(traits);

		if (weak.length === 0 && resist.length === 0 && immune.length === 0) {
			parts.push(scene.add.text(x, rowY + 9, '특이사항 없음 — 아무 검이나 고르게 통한다', style(12, UI.textDim))
				.setOrigin(0, 0.5));
			return rowY + 21;
		}

		if (weak.length > 0) {
			parts.push(scene.add.text(x, rowY + 9, '✔ 잘 통함', style(12.5, '#7fc46a', { display: true }))
				.setOrigin(0, 0.5));
			const endX = this.elementChips(scene, parts, x + 78, rowY + 9, weak.map((entry) => entry.element));
			parts.push(scene.add.text(endX + 6, rowY + 9, '피해 큼', style(11, '#7fc46a')).setOrigin(0, 0.5));
			rowY += 21;
		}
		if (resist.length > 0) {
			parts.push(scene.add.text(x, rowY + 9, '✘ 안 통함', style(12.5, '#ff8a63', { display: true }))
				.setOrigin(0, 0.5));
			const endX = this.elementChips(scene, parts, x + 78, rowY + 9, resist.map((entry) => entry.element));
			parts.push(scene.add.text(endX + 6, rowY + 9, '피해 반감', style(11, '#ff8a63')).setOrigin(0, 0.5));
			rowY += 21;
		}
		if (immune.length > 0) {
			parts.push(scene.add.text(x, rowY + 9, '⊘ 안 걸림', style(12.5, '#9aa8b5', { display: true }))
				.setOrigin(0, 0.5));
			parts.push(scene.add.text(x + 78, rowY + 9, immune.map((kind) => CC_LABELS[kind]).join(' · '),
				style(12, '#9aa8b5')).setOrigin(0, 0.5));
			rowY += 21;
		}
		return rowY;
	}

	/** 잡몹 2열 그리드 — 이름 + "✔ 이 원소로 치세요" 한 개만 (단순함이 목적) */
	private buildPoolRows(
		scene: GameScene, parts: Phaser.GameObjects.GameObject[],
		x: number, y: number, w: number, pool: EnemyDefinition[],
	): number {
		const cols = 2;
		const cellW = (w - 12) / cols;
		const rowH = 30;
		const shown = pool.slice(0, 8);
		shown.forEach((def, index) => {
			const cx = x + (index % cols) * (cellW + 12);
			const cy = y + Math.floor(index / cols) * rowH;
			const sheetKey = def.spritesheets?.idle?.textureKey;
			if (sheetKey && scene.textures.getFrame(ENEMY_ATLAS, `${sheetKey}/0`)) {
				const sprite = scene.add.image(cx + 14, cy + 14, ENEMY_ATLAS, `${sheetKey}/0`);
				sprite.setDisplaySize(26, 26);
				// 같은 시트를 색만 바꿔 쓰는 적(결집 사수·장막 소환수)이 목록에서 구분되게
				// 카탈로그의 틴트를 그대로 입힌다.
				if (def.tint) {
					sprite.setTint(Phaser.Display.Color.HexStringToColor(def.tint).color);
				}
				if (def.facing === 'right') {
					sprite.setFlipX(true);
				}
				parts.push(sprite);
			}
			const traits = traitsOf(def);
			const name = scene.add.text(cx + 32, cy + 14, def.name, style(12.5, UI.text)).setOrigin(0, 0.5);
			parts.push(name);
			const weak = weakElements(traits);
			if (weak[0]) {
				const theme = ELEMENT_THEME[weak[0].element];
				let ix = cx + 42 + name.width;
				parts.push(scene.add.text(ix, cy + 14, '✔', style(11.5, '#7fc46a', { display: true })).setOrigin(0, 0.5));
				ix += 14;
				parts.push(iconImage(scene, theme.tex, ix + 7, cy + 14, 14, theme.num));
				parts.push(scene.add.text(ix + 16, cy + 14, theme.label, style(11.5, theme.css)).setOrigin(0, 0.5));
			}
		});
		return y + Math.ceil(shown.length / cols) * rowH + 6;
	}

	destroy(): void {
		this.exit();
	}
}
