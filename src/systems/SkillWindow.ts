// 스킬 창 (K) — 금장 장식 스킬 책 (2026-09-04 전면 재작업)
//
// 레이아웃(레퍼런스와 1:1): 상단 리본 명판 "스킬 / SKILL" · 우상단 원형 닫기 ·
//   가로 12갈래 탭 · 좌 페이지(스킬 목록: 아이콘/이름/Lv/마스터리 바/상태 아이콘 + 스크롤,
//   하단 [스킬 포인트 n] [스킬 초기화]) · 우 페이지(양피지 상세: 갈래 칩 · 큰 아이콘 · 이름 ·
//   액티브/패시브 배지 · Lv n/m (MAX) · 설명 · 현재 효과 ▶ 다음 레벨 효과 · 최대 레벨 ·
//   레벨 올리기 버튼 · 스킬 이야기).
//
// 좌표는 **디자인 단위 1412×880** 로 적고 k 배율로 화면에 옮긴다 — 어떤 뷰포트에서도 비율 동일.
// 에셋: public/ui/skillbook/ (scripts/generate-skillbook-ui.py). depth 1700.
// 오브젝트는 전부 scrollFactor 0 (히트 판정 규약 — theme.ts fixScreenSpaceInput 주석 참조).

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import {
	FONT, TEXT_RESOLUTION, iconImage, SKILLBOOK_ICON_KEY, SKILLBOOK_TEXTURES, expandHit,
} from '../ui/theme';
import {
	SKILL_BRANCHES, SKILL_NODES, nodesOfBranch, skillNode, maxLevelOf, costPerLevel,
	prerequisitesMet, type SkillNode,
} from '../logic/skillTree';
import { effectRows, nextRows, type EffectRow } from '../logic/skillEffects';
import {
	MAX_REGISTERED_SKILLS, canRegister, clearSkillKey, isBuiltinSkill, registeredCount, setSkillKey, skillKey,
	type HotkeyResult,
} from '../core/skillHotbar';
import { keyLabel, keyNameOf } from '../core/keybinds';
import { SKILLS } from './ActiveSkillSystem';

const DEPTH = 1700;

/** 디자인 좌표계 — 레퍼런스 이미지 기준 */
const D = { w: 1412, h: 880 };

/** 잉크 (어두운 페이지 / 양피지 페이지) */
const C = {
	gold: '#c9a247',
	goldBright: '#f0d68e',
	goldDim: '#9a8143',
	title: '#f2e4c0',
	text: '#e2e6ec',
	dim: '#9aa3ae',
	faint: '#6b7480',
	blue: '#7cc0f0',
	green: '#7fd47f',
	red: '#e0654d',
	// 양피지
	pInk: '#2f2718',
	pBody: '#584a33',
	pDim: '#7a6a4c',
	pGold: '#8a6b22',
};

const NODE_INDEX = new Map<string, number>(SKILL_NODES.map((n, i) => [n.id, i]));

export default class SkillWindow {
	scene: GameScene;
	isOpen = false;
	branch = SKILL_BRANCHES[0]?.id ?? 'hunt';
	/** 상세 페이지에 띄운 노드 */
	selected: string | null = null;
	/** 키 배정 대기 중인 스킬 id (null 이면 대기 아님) */
	capturing: string | null = null;
	/** 목록 스크롤 (줄 단위 offset) */
	scroll = 0;

	private objects: Phaser.GameObjects.GameObject[] = [];
	private pausedByMe = false;
	private destroyed = false;
	private wheelHandler: ((p: Phaser.Input.Pointer, o: unknown, dx: number, dy: number) => void) | null = null;
	private noticeText: Phaser.GameObjects.Text | null = null;
	private shiftDown = false;

	private onKeyDown = (event: KeyboardEvent) => {
		if (!this.isOpen) {
			return;
		}
		this.shiftDown = event.shiftKey;
		if (!this.capturing) {
			return;
		}
		event.preventDefault?.();
		event.stopImmediatePropagation?.();
		if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ESC) {
			this.capturing = null;
			this.rebuild();
			return;
		}
		const name = keyNameOf(event.keyCode);
		if (!name) {
			return;
		}
		const result = setSkillKey(this.capturing, name);
		if (result.ok) {
			this.scene.soundSystem?.play('click', { volume: 0.5 });
			this.capturing = null;
			this.rebuild();
		} else {
			const reason = result.reason === 'reserved'
				? `[${keyLabel(name)}] 는 예약된 키 (${result.reservedFor ?? ''})`
				: result.reason === 'conflict'
					? `[${keyLabel(name)}] 는 이미 ${this.skillLabel(result.conflictWith ?? '')} 가 쓴다`
					: result.reason === 'full'
						? `등록 슬롯이 가득 찼다 (${registeredCount()}/${MAX_REGISTERED_SKILLS}) — 다른 스킬을 해제하세요`
						: '알 수 없는 키';
			this.noticeText?.setText(`${reason} — 다른 키를 누르세요 (ESC 취소)`).setColor(C.red);
			this.scene.soundSystem?.play('hurt', { volume: 0.25 });
		}
	};

	private onKeyUp = (event: KeyboardEvent) => {
		this.shiftDown = event.shiftKey;
	};

	constructor(scene: GameScene) {
		this.scene = scene;
		// 키 배정 대기는 다른 리스너보다 먼저 받아야 한다 (DOM 캡처 단계)
		window.addEventListener('keydown', this.onKeyDown, true);
		window.addEventListener('keyup', this.onKeyUp, true);
	}

	/**
	 * 테스트용 — 등록/해제를 UI 클릭 없이 같은 경로로 태운다.
	 * (skill-cap-test.mjs 가 상한·해제·재등록을 검증한다)
	 */
	trySetKeyForTest(skillId: string, keyName: string): HotkeyResult {
		return setSkillKey(skillId, keyName);
	}

	unregisterForTest(skillId: string): void {
		clearSkillKey(skillId);
	}

	get isCapturingKey(): boolean {
		return this.capturing !== null;
	}

	toggle(): void {
		if (this.isOpen) {
			this.close();
			return;
		}
		const scene = this.scene;
		if (scene.levelUpSystem?.isOpen || scene.shopSystem?.isOpen || scene.augmentSystem?.isOpen || scene.isGameOver || scene.isPaused) {
			return;
		}
		this.open();
	}

	open(): void {
		if (this.isOpen || this.destroyed) {
			return;
		}
		this.isOpen = true;
		this.scene.statsPanel?.close();
		if (!this.scene.physics.world.isPaused) {
			this.scene.physics.pause();
			this.pausedByMe = true;
		}
		this.scene.player?.setVelocity?.(0, 0);
		this.scene.soundSystem?.play('click', { volume: 0.5 });
		this.ensureSelection();
		this.build();
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this.isOpen = false;
		this.capturing = null;
		this.teardown();
		if (this.pausedByMe && !this.scene.shopSystem?.isOpen && !this.scene.levelUpSystem?.isOpen && !this.scene.isPaused) {
			this.scene.physics.resume();
		}
		this.pausedByMe = false;
	}

	selectBranch(id: string): void {
		if (this.branch === id) {
			return;
		}
		this.branch = id;
		this.scroll = 0;
		this.selected = nodesOfBranch(id)[0]?.id ?? null;
		this.scene.soundSystem?.play('click', { volume: 0.35 });
		this.rebuild();
	}

	private ensureSelection(): void {
		const nodes = nodesOfBranch(this.branch);
		if (!this.selected || !nodes.some((n) => n.id === this.selected)) {
			this.selected = nodes[0]?.id ?? null;
		}
	}

	private rebuild(): void {
		if (!this.isOpen) {
			return;
		}
		this.teardown();
		this.build();
	}

	private teardown(): void {
		if (this.wheelHandler) {
			this.scene.input.off('wheel', this.wheelHandler);
			this.wheelHandler = null;
		}
		for (const object of this.objects) {
			object.destroy();
		}
		this.objects = [];
		this.noticeText = null;
	}

	private skillLabel(id: string): string {
		if (isBuiltinSkill(id)) {
			return SKILLS[id].name;
		}
		const node = skillNode(id);
		if (node) {
			return node.name;
		}
		const names: Record<string, string> = {
			moveUp: '위로 이동', moveLeft: '왼쪽 이동', moveDown: '아래로 이동', moveRight: '오른쪽 이동',
			interact: '상호작용', stats: '캐릭터창', skills: '스킬 창',
		};
		return names[id] ?? id;
	}

	// ------------------------------------------------------------------
	// 그리기
	// ------------------------------------------------------------------

	private build(): void {
		const scene = this.scene;
		const tree = scene.skillTree;
		const { width, height } = scene.scale;
		const k = Math.min((width - 26) / D.w, (height - 20) / D.h);
		const PW = D.w * k;
		const PH = D.h * k;
		const ox = Math.round((width - PW) / 2);
		const oy = Math.round((height - PH) / 2);
		const X = (v: number) => ox + v * k;
		const Y = (v: number) => oy + v * k;
		const S = (v: number) => v * k;

		const track = <T extends Phaser.GameObjects.GameObject>(object: T, depth = DEPTH + 1): T => {
			(object as unknown as Phaser.GameObjects.Image).setScrollFactor?.(0);
			(object as unknown as Phaser.GameObjects.Image).setDepth?.(depth);
			this.objects.push(object);
			return object;
		};

		/** 스킬북 나인슬라이스 (디자인 단위 w/h) */
		const nine = (key: string, dx: number, dy: number, dw: number, dh: number, depth = DEPTH + 1) => {
			const entry = SKILLBOOK_TEXTURES.find((t) => t[0] === key);
			const s = entry?.[2] ?? [8, 8, 8, 8];
			const ns = scene.add.nineslice(X(dx), Y(dy), key, 0,
				Math.max(s[0] + s[1] + 2, dw), Math.max(s[2] + s[3] + 2, dh), s[0], s[1], s[2], s[3])
				.setOrigin(0).setScale(k);
			return track(ns, depth);
		};

		const text = (dx: number, dy: number, value: string, size: number, color: string, opts: {
			display?: boolean; origin?: [number, number]; wrap?: number; lh?: number; align?: string;
		} = {}) => {
			const t = scene.add.text(X(dx), Y(dy), value, {
				fontFamily: opts.display === false ? FONT.body : FONT.display,
				fontSize: `${Math.max(7, S(size))}px`,
				fontStyle: opts.display === false ? 'normal' : '900',
				color,
				resolution: TEXT_RESOLUTION,
				align: opts.align ?? 'left',
				...(opts.wrap ? { wordWrap: { width: S(opts.wrap), useAdvancedWrap: true } } : {}),
			});
			if (opts.lh) {
				t.setLineSpacing(S(opts.lh));
			}
			t.setOrigin(opts.origin?.[0] ?? 0, opts.origin?.[1] ?? 0);
			return track(t, DEPTH + 6);
		};

		const glyph = (key: string, dx: number, dy: number, size: number, color: string) => {
			const g = iconImage(scene, key, X(dx), Y(dy), S(size), color);
			return track(g as Phaser.GameObjects.GameObject, DEPTH + 6);
		};

		/** 투명 클릭 판정 (디자인 단위 사각형) */
		const hit = (dx: number, dy: number, dw: number, dh: number, onClick: () => void, cursor = true) => {
			const r = scene.add.rectangle(X(dx + dw / 2), Y(dy + dh / 2), S(dw), S(dh), 0x000000, 0.001)
				.setInteractive({ useHandCursor: cursor });
			r.on('pointerdown', onClick);
			return track(r, DEPTH + 9);
		};

		// ── 배경 딤
		track(scene.add.rectangle(width / 2, height / 2, width, height, 0x05070a, 0.74).setInteractive(), DEPTH - 1)
			.on('pointerdown', () => { /* 뒤 클릭 흡수 */ });

		// ── 책 프레임 + 귀퉁이 장식
		nine('sb-frame', 0, 0, D.w, D.h, DEPTH);
		for (const [cx, cy, rot] of [[6, 6, 0], [D.w - 6, 6, 90], [D.w - 6, D.h - 6, 180], [6, D.h - 6, 270]] as const) {
			track(scene.add.image(X(cx), Y(cy), 'sb-corner')
				.setOrigin(0, 0).setDisplaySize(S(46), S(46)).setAngle(rot).setAlpha(0.95), DEPTH + 1);
		}

		// ── 제목 명판
		nine('sb-plaque', 512, 6, 350, 70, DEPTH + 2);
		glyph('g-scroll', 612, 40, 22, C.goldBright);
		text(636, 18, '스킬', 27, C.title);
		text(687, 52, 'S K I L L', 11, C.goldDim, { origin: [0.5, 0] });

		// ── 닫기
		const close = track(scene.add.image(X(1377), Y(46), 'sb-close')
			.setOrigin(0.5).setDisplaySize(S(54), S(54)).setInteractive({ useHandCursor: true }), DEPTH + 7);
		close.on('pointerdown', () => this.close());
		close.on('pointerover', () => close.setScale(close.scaleX * 1.06));
		close.on('pointerout', () => close.setDisplaySize(S(54), S(54)));
		expandHit(close, { scale: 1 });

		// ── 갈래 탭 (12)
		const tabW = (1285 - 11 * 6) / 12;
		SKILL_BRANCHES.forEach((b, i) => {
			const tx = 57 + i * (tabW + 6);
			const on = b.id === this.branch;
			nine(on ? 'sb-tab-on' : 'sb-tab-off', tx, on ? 100 : 103, tabW, on ? 40 : 37, DEPTH + 2);
			glyph(b.icon, tx + 17, 121, 15, on ? '#dbeaff' : '#8a7647');
			text(tx + 30, 121, b.name, 13.5, on ? '#f2f7ff' : '#a2accb', { origin: [0, 0.5] });
			hit(tx, 100, tabW, 40, () => this.selectBranch(b.id));
		});

		// ── 좌 페이지 (스킬 목록)
		const nodes = nodesOfBranch(this.branch);
		const learnedAll = tree ? SKILL_NODES.filter((n) => tree.levelOf(n.id) > 0).length : 0;
		text(38, 168, '스킬 목록', 15, '#c4b68e');
		text(511, 170, `배운 스킬  ${learnedAll} / ${SKILL_NODES.length}`, 13.5, C.dim, { origin: [1, 0] });
		// 등록 슬롯 — 배우는 건 무제한이지만 키에 올리는 건 상한이 있다 (2026-09-06)
		const reg = registeredCount();
		text(511, 186, `등록  ${reg} / ${MAX_REGISTERED_SKILLS}`, 13.5,
			reg >= MAX_REGISTERED_SKILLS ? C.red : C.dim, { origin: [1, 0] });
		track(scene.add.rectangle(X(32), Y(188), S(485), Math.max(1, S(1.5)), 0x6a5c3a, 0.5).setOrigin(0), DEPTH + 2);

		const ROW_H = 92;
		const ROW_GAP = 4;
		const LIST_Y = 196;
		const VISIBLE = 6;
		const LIST_W = 467;
		const maxScroll = Math.max(0, nodes.length - VISIBLE);
		this.scroll = Phaser.Math.Clamp(this.scroll, 0, maxScroll);

		for (let i = 0; i < VISIBLE; i += 1) {
			const node = nodes[i + this.scroll];
			if (!node) {
				break;
			}
			const ry = LIST_Y + i * (ROW_H + ROW_GAP);
			this.buildRow(node, ry, ROW_H, LIST_W, { nine, text, glyph, hit, track, X, Y, S, k });
		}

		// 스크롤바
		if (maxScroll > 0) {
			const trackH = VISIBLE * (ROW_H + ROW_GAP) - ROW_GAP;
			nine('sb-scroll-track', 505, LIST_Y, 12, trackH, DEPTH + 2);
			const thumbH = Math.max(40, (trackH * VISIBLE) / nodes.length);
			const thumbY = LIST_Y + ((trackH - thumbH) * this.scroll) / maxScroll;
			nine('sb-scroll-thumb', 505, thumbY, 12, thumbH, DEPTH + 3);
			hit(499, LIST_Y - 6, 24, 20, () => { this.scroll -= 1; this.rebuild(); });
			hit(499, LIST_Y + trackH - 14, 24, 20, () => { this.scroll += 1; this.rebuild(); });
		}

		// 하단 버튼
		const points = tree?.points() ?? 0;
		nine('sb-btn', 32, 786, 240, 52, DEPTH + 2);
		glyph('g-scroll', 60, 812, 20, C.gold);
		text(84, 812, '스킬 포인트', 15, '#d8dee6', { origin: [0, 0.5] });
		text(248, 812, `${points}`, 22, points > 0 ? C.goldBright : C.faint, { origin: [1, 0.5] });

		nine('sb-btn', 292, 786, 225, 52, DEPTH + 2);
		glyph('g-rekindle', 322, 812, 18, C.goldDim);
		text(348, 812, '스킬 초기화', 15, '#c8b68c', { origin: [0, 0.5] });
		hit(292, 786, 225, 52, () => {
			if (!tree || Object.keys(tree.levels).length === 0) {
				this.scene.soundSystem?.play('hurt', { volume: 0.2 });
				return;
			}
			tree.resetAll();
			this.scene.soundSystem?.play('click', { volume: 0.5 });
			this.rebuild();
		});

		// ── 우 페이지 (양피지 상세)
		this.buildDetail({ nine, text, glyph, hit, track, X, Y, S, k });

		// ── 휠 스크롤
		this.wheelHandler = (_p, _o, _dx, dy) => {
			if (!this.isOpen || maxScroll <= 0) {
				return;
			}
			const next = Phaser.Math.Clamp(this.scroll + (dy > 0 ? 1 : -1), 0, maxScroll);
			if (next !== this.scroll) {
				this.scroll = next;
				this.rebuild();
			}
		};
		scene.input.on('wheel', this.wheelHandler);
	}

	// ------------------------------------------------------------------

	private buildRow(node: SkillNode, ry: number, ROW_H: number, LIST_W: number, u: Ui): void {
		const tree = this.scene.skillTree;
		const level = tree?.levelOf(node.id) ?? 0;
		const max = maxLevelOf(node);
		const selected = this.selected === node.id;
		const unlocked = tree ? prerequisitesMet(node.id, tree.levels) : false;
		const cy = ry + ROW_H / 2;

		u.nine(selected ? 'sb-row-on' : 'sb-row', 32, ry, LIST_W, ROW_H, DEPTH + 2);

		// 아이콘
		const frame = NODE_INDEX.get(node.id) ?? 0;
		const icon = this.scene.add.sprite(u.X(32 + 46), u.Y(cy), SKILLBOOK_ICON_KEY, frame)
			.setDisplaySize(u.S(64), u.S(64));
		if (level === 0) {
			icon.setAlpha(unlocked ? 0.72 : 0.4);
		}
		u.track(icon, DEPTH + 3);
		u.nine('sb-iconframe', 32 + 14, cy - 32, 64, 64, DEPTH + 4);

		// 이름 · 레벨
		const nameColor = level >= max ? C.goldBright : level > 0 ? '#e9edf3' : unlocked ? '#b9c1cc' : '#79828e';
		u.text(32 + 96, cy - 20, node.name, 18.5, nameColor, { origin: [0, 0.5] });
		u.text(32 + 96, cy + 16, `Lv. ${level}`, 15.5, level > 0 ? '#cdd5de' : '#79828e', { origin: [0, 0.5] });

		// 마스터리 바
		const barX = 32 + 226;
		const barW = 148;
		u.text(barX, cy + 3, `마스터리 ${level}/${max}`, 10.5, '#8e97a3', { origin: [0, 1] });
		u.nine('sb-bar-bg', barX, cy + 10, barW, 12, DEPTH + 3);
		if (level > 0) {
			u.nine('sb-bar-fill', barX + 1.5, cy + 11.5, Math.max(4, (barW - 3) * (level / max)), 9, DEPTH + 4);
		}

		// 상태 아이콘 (능동=쌍검 / 잠김=자물쇠 / 배움=체크)
		if (!unlocked) {
			u.glyph('g-lock', 32 + 420, cy, 20, '#6d7683');
		} else if (node.kind === 'active') {
			const tint = level > 0 ? C.goldBright : '#8a929d';
			for (const angle of [-32, 32]) {
				const blade = u.glyph('g-blade', 32 + 420, cy, 22, tint) as Phaser.GameObjects.Image;
				blade.setAngle?.(angle);
			}
		}

		u.hit(32, ry, LIST_W, ROW_H, () => {
			this.selected = node.id;
			this.scene.soundSystem?.play('click', { volume: 0.3 });
			this.rebuild();
		});
	}

	// ------------------------------------------------------------------

	private buildDetail(u: Ui): void {
		const scene = this.scene;
		const tree = scene.skillTree;
		const PX = 532;
		const PY = 160;
		const PWD = 820;
		const PHD = 700;

		// 양피지 바탕 + 워터마크
		u.track(scene.add.image(u.X(PX), u.Y(PY), 'sb-parch')
			.setOrigin(0).setDisplaySize(u.S(PWD), u.S(PHD)), DEPTH + 1);
		u.track(scene.add.image(u.X(PX + 648), u.Y(PY + 36), 'sb-sword')
			.setOrigin(0).setDisplaySize(u.S(140), u.S(334)).setAlpha(0.17), DEPTH + 2);
		u.track(scene.add.image(u.X(PX + 690), u.Y(PY + 560), 'sb-compass')
			.setOrigin(0).setDisplaySize(u.S(110), u.S(110)).setAlpha(0.16), DEPTH + 2);

		const node = this.selected ? skillNode(this.selected) : null;
		if (!node) {
			u.text(PX + PWD / 2, PY + PHD / 2, '스킬을 고르세요', 20, C.pDim, { origin: [0.5, 0.5] });
			return;
		}
		const branch = SKILL_BRANCHES.find((b) => b.id === node.branch);
		const level = tree?.levelOf(node.id) ?? 0;
		const max = maxLevelOf(node);
		const maxed = level >= max;
		const cost = costPerLevel(node);
		const check = tree?.canLearn(node.id) ?? { ok: false, reason: 'unknown' as const };

		// 갈래 칩
		const chipW = Math.max(96, node.branch.length * 8 + 84);
		u.nine('sb-chip', PX + 62, PY + 26, chipW, 28, DEPTH + 3)
			.setTint(Phaser.Display.Color.HexStringToColor(branch?.color ?? '#4a90d9').color).setAlpha(0.92);
		u.text(PX + 62 + chipW / 2, PY + 40, branch?.name ?? '', 14, '#0f1620', { origin: [0.5, 0.5] });

		// 큰 아이콘
		const frame = NODE_INDEX.get(node.id) ?? 0;
		u.track(scene.add.sprite(u.X(PX + 130), u.Y(PY + 134), SKILLBOOK_ICON_KEY, frame)
			.setDisplaySize(u.S(112), u.S(112)).setAlpha(level > 0 ? 1 : 0.55), DEPTH + 3);
		u.nine('sb-iconframe', PX + 74, PY + 78, 112, 112, DEPTH + 4);

		// 이름 + 종류 배지
		const nameObj = u.text(PX + 222, PY + 82, node.name, 33, C.pInk, { origin: [0, 0.5] });
		const badgeX = PX + 222 + nameObj.displayWidth / u.k + 22;
		const kindLabel = node.kind === 'active' ? '액티브' : '패시브';
		const badgeW = 76;
		u.nine('sb-chip', badgeX, PY + 68, badgeW, 30, DEPTH + 3)
			.setTint(node.kind === 'active' ? 0xe6dcc0 : 0xd9d2bc);
		u.text(badgeX + badgeW / 2, PY + 83, kindLabel, 13.5, '#3a2f1c', { origin: [0.5, 0.5] });

		// 능동 스킬이면 핫키 칩 (+ 등록 해제 칩)
		if (node.kind === 'active' && level > 0) {
			const key = skillKey(node.id);
			const capturing = this.capturing === node.id;
			const keyW = 96;
			const keyX = badgeX + badgeW + 12;
			// 등록 자리가 꽉 찼고 이 스킬이 아직 미등록이면 칩을 흐리게 하고 잠근다
			const locked = !key && !canRegister(node.id);
			u.nine('sb-chip', keyX, PY + 68, keyW, 30, DEPTH + 3)
				.setTint(capturing ? 0xffcf7a : locked ? 0xb0a894 : 0xcfc6ac);
			u.text(keyX + keyW / 2, PY + 83, capturing ? '키 입력…' : `키  ${key ? keyLabel(key) : '없음'}`,
				13, locked ? '#6d6350' : '#3a2f1c', { origin: [0.5, 0.5] });
			u.hit(keyX, PY + 68, keyW, 30, () => {
				if (locked) {
					this.noticeText?.setText(
						`등록 슬롯이 가득 찼다 (${registeredCount()}/${MAX_REGISTERED_SKILLS}) — 다른 능동 스킬을 먼저 해제하세요`,
					).setColor(C.red);
					this.scene.soundSystem?.play('hurt', { volume: 0.25 });
					return;
				}
				this.capturing = capturing ? null : node.id;
				this.rebuild();
			});

			// 등록된 스킬에만 해제 칩 — 상한이 있으니 내리는 수단이 반드시 있어야 한다
			if (key) {
				const offW = 62;
				const offX = keyX + keyW + 10;
				u.nine('sb-chip', offX, PY + 68, offW, 30, DEPTH + 3).setTint(0xc9b6a4);
				u.text(offX + offW / 2, PY + 83, '해제', 13, '#3a2f1c', { origin: [0.5, 0.5] });
				u.hit(offX, PY + 68, offW, 30, () => {
					clearSkillKey(node.id);
					this.capturing = null;
					this.scene.soundSystem?.play('click', { volume: 0.5 });
					this.rebuild();
				});
			}
		}

		// 레벨 줄 + MAX
		const lvObj = u.text(PX + 222, PY + 128, `Lv. ${level}`, 21, C.pInk, { origin: [0, 0.5] });
		u.text(PX + 222 + lvObj.displayWidth / u.k + 6, PY + 130, `/ ${max}`, 17, C.pDim, { origin: [0, 0.5] });
		if (maxed) {
			u.nine('sb-chip', PX + 340, PY + 117, 56, 26, DEPTH + 3).setTint(0xc9a247);
			u.text(PX + 368, PY + 130, 'MAX', 13, '#2b2210', { origin: [0.5, 0.5] });
		}

		// 설명
		u.text(PX + 222, PY + 152, node.desc, 15, C.pBody, { display: false, wrap: 400, lh: 5 });

		// ── 현재 효과 / 다음 레벨 효과
		const shown = Math.max(1, level);
		const cur = effectRows(node, shown);
		const nxt = nextRows(node, shown);
		this.buildEffectPanel(u, PX + 45, PY + 255, 365, 172, level > 0 ? '현재 효과' : `Lv. 1 효과`, C.blue, cur, null);
		this.buildEffectPanel(u, PX + 420, PY + 255, 365, 172, maxed ? '최대 레벨' : '다음 레벨 효과', maxed ? C.pDim : C.green,
			nxt ?? cur.map((r) => ({ ...r, value: '—' })), cur);
		u.track(scene.add.image(u.X(PX + 412), u.Y(PY + 341), 'sb-arrow')
			.setOrigin(0.5).setDisplaySize(u.S(34), u.S(34)).setTint(0xc0a469), DEPTH + 5);

		// ── 최대 레벨 상자
		u.nine('sb-panel', PX + 45, PY + 440, 360, 96, DEPTH + 3);
		u.text(PX + 68, PY + 462, '최대 레벨', 15, '#c9b98d');
		u.text(PX + 68, PY + 492, `Lv. ${max}`, 25, '#eef3f8');

		// ── 행동 버튼
		const btnX = PX + 470;
		const btnY = PY + 462;
		const canUp = check.ok;
		u.nine(canUp ? 'sb-btn-gold' : 'sb-btn', btnX, btnY, 270, 54, DEPTH + 3);
		const label = maxed ? '최대 레벨 달성'
			: canUp ? `레벨 올리기 · ${cost}P`
				: check.reason === 'prereq' ? '선행 스킬 필요'
					: check.reason === 'points' ? `포인트 부족 (${cost}P)` : '올릴 수 없음';
		u.text(btnX + 118, btnY + 27, label, 16.5, canUp ? '#f7e6bb' : '#9aa3ae', { origin: [0.5, 0.5] });
		u.glyph(maxed ? 'g-crown' : canUp ? 'g-spark' : 'g-lock', btnX + 232, btnY + 27, 20,
			canUp ? C.goldBright : '#7c848f');
		u.hit(btnX, btnY, 270, 54, () => {
			if (!tree) {
				return;
			}
			const gained = this.shiftDown ? tree.learnMax(node.id) : (tree.learn(node.id) ? 1 : 0);
			if (gained > 0) {
				this.rebuild();
			} else {
				scene.soundSystem?.play('hurt', { volume: 0.2 });
			}
		});
		this.noticeText = u.text(btnX + 118, btnY + 66,
			this.capturing ? '배정할 키를 누르세요 (ESC 취소)' : maxed ? '' : '⇧ 누르고 클릭 = 한 번에 최대',
			11.5, this.capturing ? '#c98a2a' : C.pDim, { origin: [0.5, 0.5] });

		// ── 구분선 + 스킬 이야기
		u.track(scene.add.rectangle(u.X(PX + 45), u.Y(PY + 566), u.S(740), Math.max(1, u.S(1.5)), 0x9a8968, 0.55)
			.setOrigin(0, 0), DEPTH + 3);
		// 양피지 위의 키퍼 — 삽화처럼 (레퍼런스의 작은 캐릭터)
		this.keeperCameo(u, PX + 92, PY + 622, 130);
		u.text(PX + 152, PY + 588, '스킬 이야기', 16, C.pGold);
		u.text(PX + 152, PY + 614, node.lore ?? node.desc, 14.5, C.pBody, { display: false, wrap: 560, lh: 6 });

		// 잠김 안내
		if (level === 0 && check.reason === 'prereq') {
			const req = (node.requires ?? []).map((id) => skillNode(id)?.name ?? id).join(', ');
			u.text(PX + 222, PY + 214, `선행 스킬: ${req}`, 13.5, '#8a5a2a', { display: false });
		}
	}

	/** 양피지 삽화용 키퍼 스프라이트 (텍스처가 없으면 조용히 건너뛴다) */
	private keeperCameo(u: Ui, dx: number, dy: number, size: number): void {
		const scene = this.scene;
		const key = scene.player?.texture?.key;
		if (!key || !scene.textures.exists(key)) {
			return;
		}
		const s = scene.add.image(u.X(dx), u.Y(dy), key, 0)
			.setOrigin(0.5).setDisplaySize(u.S(size), u.S(size));
		u.track(s, DEPTH + 4);
	}

	private buildEffectPanel(
		u: Ui, dx: number, dy: number, dw: number, dh: number, title: string, titleColor: string,
		rows: EffectRow[], compare: EffectRow[] | null,
	): void {
		u.nine('sb-panel', dx, dy, dw, dh, DEPTH + 3);
		u.text(dx + 16, dy + 14, '◆', 12, titleColor);
		u.text(dx + 34, dy + 13, title, 14.5, titleColor);
		if (rows.length === 0) {
			u.text(dx + 34, dy + 60, '—', 15, C.faint);
			return;
		}
		rows.slice(0, 3).forEach((row, i) => {
			const ry = dy + 52 + i * 38;
			u.glyph(row.icon, dx + 24, ry + 12, 15, '#8e97a3');
			u.text(dx + 40, ry + 3, row.label, 14, '#b7bfc9', { display: false });
			const prev = compare?.find((c) => c.key === row.key);
			const better = prev && row.raw !== prev.raw
				? ((row.raw > prev.raw) === (row.better === 'up'))
				: null;
			const color = compare ? (better === true ? C.green : better === false ? C.red : '#e6ebf1') : '#e9eef4';
			u.text(dx + dw - (better === null ? 20 : 40), ry + 2, row.value, 16, color, { origin: [1, 0] });
			if (better !== null) {
				// 화살표는 수치의 방향, 색은 좋아졌는지 (재사용 대기시간은 내려가면 초록 ▼)
				const up = row.raw > (prev?.raw ?? row.raw);
				u.text(dx + dw - 18, ry + 3, up ? '▲' : '▼', 12, better ? C.green : C.red, { origin: [1, 0] });
			}
		});
	}

	destroy(): void {
		this.destroyed = true;
		window.removeEventListener('keydown', this.onKeyDown, true);
		window.removeEventListener('keyup', this.onKeyUp, true);
		this.close();
		this.teardown();
	}
}

/** build() 안에서 만든 그리기 헬퍼 묶음 */
interface Ui {
	nine: (key: string, dx: number, dy: number, dw: number, dh: number, depth?: number) => Phaser.GameObjects.NineSlice;
	text: (dx: number, dy: number, value: string, size: number, color: string, opts?: {
		display?: boolean; origin?: [number, number]; wrap?: number; lh?: number; align?: string;
	}) => Phaser.GameObjects.Text;
	glyph: (key: string, dx: number, dy: number, size: number, color: string) => Phaser.GameObjects.GameObject;
	hit: (dx: number, dy: number, dw: number, dh: number, onClick: () => void, cursor?: boolean) => Phaser.GameObjects.Rectangle;
	track: <T extends Phaser.GameObjects.GameObject>(object: T, depth?: number) => T;
	X: (v: number) => number;
	Y: (v: number) => number;
	S: (v: number) => number;
	k: number;
}
