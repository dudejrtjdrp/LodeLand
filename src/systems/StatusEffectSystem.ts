// 상태이상 부여 + 지속 표시 (2026-09-04).
//
// 두 가지를 한곳에 모은다.
//
// 1) **부여 헬퍼** — slow/freeze/shock/bleed/dot 를 거는 유일한 진입점.
//    이전에는 호출부 11곳이 `enemy.slowUntil = ...` 을 직접 대입했고, 보스·면역
//    가드가 제각각이었으며 부여 연출을 빠뜨린 경로(출혈·광역 감속)가 있었다.
//    여기를 통과하면 가드와 연출이 구조적으로 함께 붙는다.
//
// 2) **지속 표시** — "걸린 순간"만 번쩍이고 "걸려 있는 동안"은 무표시였던 문제.
//    빙결 1.2초 정지, 감전 2.2초 취약 같은 핵심 정보가 화면에서 읽히지 않았다.
//    이제 매 프레임 (a) 우선순위 틴트를 스프라이트에 걸고 (b) 공유 Graphics 한 장에
//    불꽃/결정/전류/방울을 다시 그린다.
//
// 성능 규약 (movesword-fx-layer / offscreen-culling 과 동일):
//   - GameObject 생성·트윈 0. Graphics 한 장을 매 프레임 clear 후 다시 그린다.
//   - EnemyManager 의 기존 적 순회 안에서 호출된다 — 추가 순회 없음.
//   - 화면 밖은 그리지 않고, 동시 오버레이 수에 상한(프레임 상태에 따라 축소)이 있다.
//   - setTint 는 값이 바뀔 때만 부른다 (statusTintApplied 변경 감지).

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import { reduceMotion } from '../core/settings';
import {
	S_BLEED, S_BURN, S_FREEZE, S_POISON, S_SHOCK, S_SLOW,
	STATUS_STYLE, baseTintOf, canDot, canFreeze, canSlow, dominantStatus, statusMask,
} from '../logic/statusEffects';

/** 동시 지속 오버레이 상한 (fxThrottle 로 축소된다). */
const OVERLAY_CAP = 22;
/** 감전 깜빡임 주기(ms) — 짧을수록 지직거린다 */
const SHOCK_BLINK_MS = 110;

export default class StatusEffectSystem {
	scene: GameScene;
	private g: Phaser.GameObjects.Graphics | null = null;
	/** 이번 프레임에 더 그릴 수 있는 오버레이 수 */
	private budget = 0;
	private motionOff = false;
	private destroyed = false;

	constructor(scene: GameScene) {
		this.scene = scene;
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy(), this);
	}

	destroy(): void {
		this.destroyed = true;
		this.g?.destroy();
		this.g = null;
	}

	/** 지속 오버레이 Graphics (QA·회귀 테스트용 — 아직 아무것도 안 그렸으면 null) */
	get overlayGraphics(): Phaser.GameObjects.Graphics | null {
		return this.g;
	}

	// ==================================================================
	// 부여 — 가드와 연출이 항상 함께 붙는 유일한 진입점
	// ==================================================================

	private now(): number {
		return this.scene.time?.now ?? 0;
	}

	/**
	 * 감속. `amount` 는 **감소율**(0.4 = 40% 느려짐), 상한 0.95.
	 * 이미 더 강한 감속이 걸려 있으면 배율은 유지하고 지속시간만 늘린다.
	 */
	slow(enemy: EnemySprite, amount: number, durationMs: number,
		opts?: { fx?: boolean; allowBoss?: boolean }): boolean {
		if (!enemy || !canSlow(enemy, opts?.allowBoss)) {
			return false;
		}
		const now = this.now();
		const factor = 1 - Math.min(0.95, Math.max(0, amount));
		const stillSlowed = (enemy.slowUntil ?? 0) > now;
		enemy.slowFactor = stillSlowed ? Math.min(enemy.slowFactor ?? 1, factor) : factor;
		enemy.slowUntil = Math.max(enemy.slowUntil ?? 0, now + durationMs);
		if (opts?.fx !== false && !stillSlowed) {
			// 이미 느려진 적에게 매 명중마다 연출을 겹치지 않는다 (밀집 구간 보호)
			this.scene.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'slow');
		}
		return true;
	}

	/** 완전 정지 + 받는 피해 증가 (얼음 4세트 [빙결]). */
	freeze(enemy: EnemySprite, durationMs: number): boolean {
		if (!enemy || !canFreeze(enemy)) {
			return false;
		}
		const now = this.now();
		if ((enemy.setFrozenUntil ?? 0) > now) {
			return false; // 이미 얼어 있다 — 연출을 겹치지 않는다
		}
		enemy.setFrozenUntil = now + durationMs;
		enemy.slowFactor = 0;
		enemy.slowUntil = Math.max(enemy.slowUntil ?? 0, now + durationMs);
		this.freezeFX(enemy);
		return true;
	}

	/**
	 * 감전 — 받는 피해 증가. `stopMs` 가 있으면 그 시간만큼 발도 묶는다.
	 * 감전은 보스에게도 걸린다 (취약만 주고 정지는 가드가 막는다).
	 */
	shock(enemy: EnemySprite, durationMs: number, stopMs = 0): void {
		if (!enemy) {
			return;
		}
		const now = this.now();
		const fresh = (enemy.setShockUntil ?? 0) <= now;
		enemy.setShockUntil = Math.max(enemy.setShockUntil ?? 0, now + durationMs);
		if (stopMs > 0 && canSlow(enemy)) {
			enemy.slowFactor = 0;
			enemy.slowUntil = Math.max(enemy.slowUntil ?? 0, now + stopMs);
		}
		if (fresh) {
			this.shockFX(enemy);
		}
	}

	/** 출혈 — 움직이는 동안 지속 피해 (피 4세트). 부여 연출이 없던 경로였다. */
	bleed(enemy: EnemySprite, dps: number, durationMs: number): void {
		if (!enemy || !canDot(enemy)) {
			return;
		}
		const now = this.now();
		const fresh = (enemy.setBleedUntil ?? 0) <= now;
		enemy.setBleedUntil = Math.max(enemy.setBleedUntil ?? 0, now + durationMs);
		enemy.setBleedDps = Math.max(enemy.setBleedDps ?? 0, dps);
		if (fresh) {
			this.bleedFX(enemy);
		}
	}

	/** 중독 중첩 (독 5세트) — 5중첩이 역병의 조건이라 단계가 읽혀야 한다. */
	poisonStack(enemy: EnemySprite, max = 5): number {
		if (!enemy) {
			return 0;
		}
		const before = enemy.setPoisonStacks ?? 0;
		const after = Math.min(max, before + 1);
		enemy.setPoisonStacks = after;
		if (after > before) {
			this.poisonStackFX(enemy, after, max);
		}
		return after;
	}

	// ==================================================================
	// 지속 표시 — EnemyManager 의 적 순회 안에서 호출된다
	// ==================================================================

	/** 프레임 시작: Graphics 를 비우고 이번 프레임 예산을 정한다. */
	beginFrame(): void {
		if (this.destroyed) {
			return;
		}
		this.motionOff = reduceMotion();
		const throttle = this.scene.visualEffects?.fxThrottle?.() ?? 1;
		// 프레임이 처지면 오버레이부터 줄인다 (틴트는 공짜라 항상 유지된다)
		this.budget = this.motionOff ? 0 : throttle === 1 ? OVERLAY_CAP : throttle === 2 ? 10 : 0;
		if (this.g) {
			this.g.clear();
		}
	}

	/** 적 한 마리분: 틴트 동기화 + (화면 안이고 예산이 남으면) 오버레이. */
	tickEnemy(enemy: EnemySprite, now: number, onScreen: boolean): void {
		if (this.destroyed) {
			return;
		}
		const mask = statusMask(enemy, now);
		if (enemy.statusPhase === undefined) {
			// 개체마다 위상을 흩는다 — 없으면 화면의 모든 적이 한 박자로 깜빡이고 일렁인다
			enemy.statusPhase = Math.random() * Math.PI * 2;
		}
		this.syncTint(enemy, mask, now);
		if (mask !== 0 && onScreen && this.budget > 0) {
			this.budget -= 1;
			this.drawOverlay(enemy, mask, now);
		}
	}

	/**
	 * 스프라이트 색을 지금 상태에 맞춰 되돌린다.
	 * 피격 백색 플래시가 끝난 뒤(VisualEffectsSystem.flashSprite)에도 이걸 부른다 —
	 * 예전에는 `catalog.tint` 만 되살려서 어픽스 색과 `color` 만 있는 적의 색이 날아갔다.
	 */
	refreshTint(enemy: EnemySprite): void {
		if (!enemy || enemy.destroyed || !enemy.active) {
			return;
		}
		enemy.statusTintApplied = undefined;
		this.syncTint(enemy, statusMask(enemy, this.now()), this.now(), true);
	}

	/** 풀 재사용 시: 캐시된 원래 색과 걸려 있던 틴트를 잊는다. */
	resetEnemy(enemy: EnemySprite): void {
		enemy.statusTintApplied = undefined;
		enemy.statusBaseTint = undefined;
		enemy.statusPhase = undefined;
	}

	private baseTint(enemy: EnemySprite): number {
		if (enemy.statusBaseTint === undefined) {
			const base = baseTintOf(enemy);
			enemy.statusBaseTint = base === null ? -1 : base;
		}
		return enemy.statusBaseTint;
	}

	private syncTint(enemy: EnemySprite, mask: number, now: number, force = false): void {
		// 피격 백색 플래시가 색을 쥐고 있는 동안은 건드리지 않는다.
		// 플래시가 끝나면 flashSprite 가 refreshTint 로 돌려준다.
		if (!force && now < (enemy.flashUntil ?? 0)) {
			return;
		}
		const kind = dominantStatus(mask);
		let want: number | null = null;
		if (kind) {
			const style = STATUS_STYLE[kind];
			// 교대 틴트가 있는 상태(감전)는 두 색 사이를 오간다.
			// 개체 위상만큼 어긋나게 해서 화면 전체가 한 박자로 번쩍이지 않게 한다.
			const offset = (enemy.statusPhase ?? 0) * SHOCK_BLINK_MS;
			want = style.tintAlt !== undefined && (Math.floor((now + offset) / SHOCK_BLINK_MS) & 1) === 1
				? style.tintAlt : style.tint;
		}
		if (!force && enemy.statusTintApplied === want) {
			return;
		}
		enemy.statusTintApplied = want;
		if (want === null) {
			const base = this.baseTint(enemy);
			enemy.clearTint();
			if (base >= 0) {
				enemy.setTint(base);
			}
		} else {
			enemy.setTint(want);
		}
	}

	// ------------------------------------------------------------------
	// 오버레이 드로잉 — 전부 Graphics 한 장, 도형 몇 개씩
	// ------------------------------------------------------------------

	private graphics(): Phaser.GameObjects.Graphics {
		if (!this.g) {
			// 적(depth 1) 위, 순간 FX(56)·체력바(59) 아래
			this.g = this.scene.add.graphics().setDepth(55);
		}
		return this.g;
	}

	private drawOverlay(enemy: EnemySprite, mask: number, now: number): void {
		const g = this.graphics();
		const phase = enemy.statusPhase ?? 0;
		const rx = Math.max(9, enemy.displayWidth * 0.42);
		const ry = Math.max(11, enemy.displayHeight * 0.46);
		const footY = enemy.y + ry * 0.86;
		const t = now * 0.006 + phase;

		// 약한 것부터 깔고 강한 것을 위에 얹는다
		if (mask & S_SLOW) {
			this.drawSlow(g, enemy.x, footY, rx, t);
		}
		if (mask & S_POISON) {
			this.drawPoison(g, enemy, footY, rx, ry, t);
		}
		if (mask & S_BLEED) {
			this.drawBleed(g, enemy.x, footY, rx, t);
		}
		if (mask & S_BURN) {
			this.drawBurn(g, enemy.x, footY, rx, ry, t);
		}
		if (mask & S_SHOCK) {
			this.drawShock(g, enemy.x, enemy.y, rx, ry);
		}
		if (mask & S_FREEZE) {
			this.drawFreeze(g, enemy.x, enemy.y, rx, ry, t);
		}
	}

	/**
	 * 감속: 발밑에 낀 서리 — 납작한 타원 궤도 위의 호 3조각이 천천히 돈다.
	 * 정원(正圓)으로 그리면 바닥이 아니라 몸 주위에 떠 있는 것처럼 보여서 눌러 그린다.
	 */
	private drawSlow(g: Phaser.GameObjects.Graphics, x: number, footY: number, rx: number, t: number): void {
		const style = STATUS_STYLE.slow;
		const flat = 0.42; // 바닥에 깔린 원근
		g.lineStyle(2.2, style.fx, 0.7);
		for (let i = 0; i < 3; i += 1) {
			const a0 = t * 0.4 + (i / 3) * Math.PI * 2;
			g.beginPath();
			for (let s = 0; s <= 6; s += 1) {
				const a = a0 + (s / 6) * 1.0;
				const px = x + Math.cos(a) * rx * 1.15;
				const py = footY + Math.sin(a) * rx * 1.15 * flat;
				if (s === 0) {
					g.moveTo(px, py);
				} else {
					g.lineTo(px, py);
				}
			}
			g.strokePath();
		}
		// 서리 결정 부스러기 2개
		g.fillStyle(style.bright, 0.8);
		for (let i = 0; i < 2; i += 1) {
			const a = t * 0.4 + i * Math.PI;
			g.fillCircle(x + Math.cos(a) * rx * 1.15, footY + Math.sin(a) * rx * 1.15 * flat, 1.8);
		}
	}

	/** 중독: 발밑 독 웅덩이 + 떠오르는 거품 + 머리 위 중첩 눈금 */
	private drawPoison(g: Phaser.GameObjects.Graphics, enemy: EnemySprite, footY: number,
		rx: number, ry: number, t: number): void {
		const style = STATUS_STYLE.poison;
		g.fillStyle(style.fx, 0.22);
		g.fillEllipse(enemy.x, footY, rx * 2.1, rx * 0.9);
		for (let i = 0; i < 2; i += 1) {
			// 0~1 을 반복하며 위로 떠오른다 (트윈 없이 시간에서 바로 위치를 만든다)
			const p = ((t * 0.22 + i * 0.5) % 1);
			const bx = enemy.x + Math.sin(t * 1.4 + i * 2.1) * rx * 0.6;
			g.fillStyle(i % 2 ? style.bright : style.fx, 0.75 * (1 - p));
			g.fillCircle(bx, footY - p * ry * 1.6, 2.4 - p * 1.2);
		}
		// 중첩 눈금 (독 5세트의 역병 조건 — 몇 겹인지가 읽혀야 한다)
		const stacks = enemy.setPoisonStacks ?? 0;
		if (stacks > 0) {
			const top = enemy.y - ry * 1.15;
			const w = 4;
			const startX = enemy.x - (stacks * (w + 2) - 2) / 2;
			for (let i = 0; i < stacks; i += 1) {
				g.fillStyle(stacks >= 5 ? 0xd9f99d : style.fx, 0.95);
				g.fillRect(startX + i * (w + 2), top, w, 3);
			}
		}
	}

	/** 출혈: 발밑 핏자국 + 흘러내리는 방울 */
	private drawBleed(g: Phaser.GameObjects.Graphics, x: number, footY: number, rx: number, t: number): void {
		const style = STATUS_STYLE.bleed;
		g.fillStyle(style.fx, 0.3);
		g.fillEllipse(x, footY + 2, rx * 1.7, rx * 0.7);
		for (let i = 0; i < 2; i += 1) {
			const p = ((t * 0.3 + i * 0.5) % 1);
			g.fillStyle(style.bright, 0.85 * (1 - p * 0.6));
			g.fillCircle(x + (i ? rx * 0.55 : -rx * 0.5), footY - rx * 0.9 + p * rx * 1.2, 2.2);
		}
	}

	/** 화상: 발밑 잉걸 + 위로 흔들리는 불꽃 혀 3개 */
	private drawBurn(g: Phaser.GameObjects.Graphics, x: number, footY: number,
		rx: number, ry: number, t: number): void {
		const style = STATUS_STYLE.burn;
		g.fillStyle(style.fx, 0.26);
		g.fillEllipse(x, footY, rx * 2.0, rx * 0.85);
		// 불꽃은 실루엣 **양옆**에서 피어오른다 — 몸 한가운데를 덮으면 적이 뭔지 안 보인다
		for (let i = 0; i < 3; i += 1) {
			const base = x + (i - 1) * rx * 0.95;
			const sway = Math.sin(t * 2.2 + i * 1.7) * rx * 0.3;
			const h = ry * (i === 1 ? 0.75 : 1.05) * (1 + 0.22 * Math.sin(t * 3.1 + i));
			// 아래는 넓은 주황, 위는 좁은 밝은 노랑 — 두 겹으로 불꽃 모양을 낸다
			g.lineStyle(3, style.fx, 0.55);
			g.beginPath();
			g.moveTo(base, footY);
			g.lineTo(base + sway * 0.5, footY - h * 0.55);
			g.lineTo(base + sway, footY - h);
			g.strokePath();
			g.lineStyle(1.4, style.bright, 0.85);
			g.beginPath();
			g.moveTo(base, footY - h * 0.15);
			g.lineTo(base + sway * 0.5, footY - h * 0.6);
			g.lineTo(base + sway * 0.85, footY - h * 0.92);
			g.strokePath();
		}
	}

	/** 감전: 몸을 타고 지직거리는 전류 2줄 + 튀는 불똥 (매 프레임 다시 흩어진다) */
	private drawShock(g: Phaser.GameObjects.Graphics, x: number, y: number, rx: number, ry: number): void {
		// 전류 2줄. 창백하게 칠해진 몸 위에서도 보이도록 **짙은 남색 테두리 + 흰 심지**로
		// 두 겹을 겹쳐 긋는다 (같은 경로를 굵게 한 번, 얇게 한 번).
		for (let i = 0; i < 2; i += 1) {
			const a0 = Math.random() * Math.PI * 2;
			const pts: number[] = [x + Math.cos(a0) * rx * 1.15, y + Math.sin(a0) * ry * 0.7];
			for (let s = 1; s <= 3; s += 1) {
				const a = a0 + (s / 3) * Math.PI * 1.2;
				pts.push(x + Math.cos(a) * rx * (0.6 + Math.random() * 0.75),
					y + Math.sin(a) * ry * (0.35 + Math.random() * 0.7));
			}
			for (const [w, color, alpha] of [[4.5, 0x14243f, 0.75], [2.4, 0x5b9cff, 0.95],
				[1, 0xffffff, 1]] as const) {
				g.lineStyle(w, color, alpha);
				g.beginPath();
				g.moveTo(pts[0], pts[1]);
				for (let j = 2; j < pts.length; j += 2) {
					g.lineTo(pts[j], pts[j + 1]);
				}
				g.strokePath();
			}
		}
		// 튀는 불똥
		for (let i = 0; i < 2; i += 1) {
			const sa = Math.random() * Math.PI * 2;
			g.fillStyle(0xffffff, 0.95);
			g.fillCircle(x + Math.cos(sa) * rx * 1.2, y + Math.sin(sa) * ry * 0.95, 1.8);
		}
	}

	/** 빙결: 몸을 감싼 육각 얼음막 + 결정 가시 (숨쉬듯 아주 옅게 맥동) */
	private drawFreeze(g: Phaser.GameObjects.Graphics, x: number, y: number,
		rx: number, ry: number, t: number): void {
		const style = STATUS_STYLE.freeze;
		const pulse = 1 + Math.sin(t * 1.5) * 0.04;
		const hx = rx * 1.18 * pulse;
		const hy = ry * 1.1 * pulse;
		g.fillStyle(style.fx, 0.2);
		g.lineStyle(2, style.bright, 0.85);
		g.beginPath();
		for (let i = 0; i <= 6; i += 1) {
			const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
			const px = x + Math.cos(a) * hx;
			const py = y + Math.sin(a) * hy;
			if (i === 0) {
				g.moveTo(px, py);
			} else {
				g.lineTo(px, py);
			}
		}
		g.closePath();
		g.fillPath();
		g.strokePath();
		// 바깥으로 뻗은 결정 가시 3개
		g.lineStyle(2, style.fx, 0.9);
		for (let i = 0; i < 3; i += 1) {
			const a = (i / 3) * Math.PI * 2 + t * 0.15;
			g.beginPath();
			g.moveTo(x + Math.cos(a) * hx * 0.8, y + Math.sin(a) * hy * 0.8);
			g.lineTo(x + Math.cos(a) * hx * 1.3, y + Math.sin(a) * hy * 1.3);
			g.strokePath();
		}
	}

	// ------------------------------------------------------------------
	// 부여 순간 연출 (공유 FX 레이어)
	// ------------------------------------------------------------------

	private freezeFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		const style = STATUS_STYLE.freeze;
		for (let i = 0; i < 6; i += 1) {
			const a = (i / 6) * Math.PI * 2;
			fx.fxDiamond(enemy.x + Math.cos(a) * 22, enemy.y + Math.sin(a) * 22, {
				r: 9, color: style.fx, alpha: 0.95, dur: 420, fill: true,
			});
		}
		fx.fxRing(enemy.x, enemy.y, { r0: 40, r1: 18, w: 3, color: style.fx, alpha: 0.9, dur: 320 });
		this.scene.soundSystem?.play('crit', { volume: 0.3 });
	}

	private shockFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		for (let i = 0; i < 3; i += 1) {
			const points: number[] = [];
			const baseAngle = Math.random() * Math.PI * 2;
			for (let s = 0; s <= 4; s += 1) {
				const p = s / 4;
				const a = baseAngle + p * Math.PI;
				const r = 6 + p * 20;
				points.push(enemy.x + Math.cos(a) * r + (Math.random() - 0.5) * 9,
					enemy.y + Math.sin(a) * r + (Math.random() - 0.5) * 9);
			}
			fx.fxPoly(points, { layers: [[4, 0x1e3a5f, 0.4], [1.8, 0x93c5fd, 0.95]], dur: 260 });
		}
		fx.fxRing(enemy.x, enemy.y, { r0: 8, r1: 30, w: 2, color: 0xdbeafe, alpha: 0.85, dur: 240 });
	}

	/** 출혈 부여: 베인 자리에서 핏방울이 튄다 (기존에는 연출이 아예 없었다) */
	private bleedFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		const style = STATUS_STYLE.bleed;
		fx.fxPoly([enemy.x - 16, enemy.y - 8, enemy.x + 16, enemy.y + 8],
			{ layers: [[3, style.bright, 0.9]], dur: 200 });
		for (let i = 0; i < 5; i += 1) {
			const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
			fx.fxDot(enemy.x, enemy.y, {
				r: 2.4, color: i % 2 ? style.bright : style.fx, alpha: 0.95, scale1: 0.4,
				dx: Math.cos(a) * 34, dy: Math.sin(a) * 30 + 22, dur: 380,
			});
		}
	}

	/** 중독 중첩: 한 겹 쌓일 때마다 짧은 초록 링 (5겹은 더 크게 — 역병 사정권) */
	private poisonStackFX(enemy: EnemySprite, stacks: number, max: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		const full = stacks >= max;
		fx.fxRing(enemy.x, enemy.y, {
			r0: full ? 10 : 6, r1: full ? 46 : 22, w: full ? 3 : 1.8,
			color: full ? 0xd9f99d : STATUS_STYLE.poison.fx, alpha: full ? 0.95 : 0.7,
			dur: full ? 420 : 240,
		});
	}
}
