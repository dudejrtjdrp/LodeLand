// 도전과제 — 20종. 조건 판정은 **이벤트 훅**으로만 일어난다 (매 프레임 폴링 없음).
//
// 구조
//  - 정적(static) 절반: localStorage 영속 · 진행도 계산 · 달성 판정 · 보상 지급.
//    씬 없이도 동작하므로 타이틀/도감 화면에서도 목록을 읽을 수 있다.
//  - 인스턴스 절반: GameScene 에 붙어 달성 토스트를 띄우고, 런 중 이벤트
//    (보스 스폰/처치·피격·조합·세트 완성·검 획득)를 통계 모듈로 흘린다.
//
// 보상 이중 지급 방지: 달성 목록을 **먼저** 저장한 뒤 MetaProgression 에 지급한다.
// 이미 unlocked 에 든 id 는 두 번 다시 평가되지 않는다.

import Phaser from 'phaser';
import rawAchievementCatalog from '../data/achievementCatalog.json';
import MetaProgression from './MetaProgression';
import { seenCount } from '../core/codex';
import { bumpStat, flushStats, getStats, raiseStat, type LifetimeStats } from '../core/stats';
import { reduceMotion } from '../core/settings';
import { UI, style, panel, iconImage, hudScaleFor } from '../ui/theme';
import type GameScene from '../scenes/GameScene';

/** 진행도를 읽어올 곳: 누적 통계 키 · 도감 수집 수 · 클리어한 위험도 */
export type AchievementSource = keyof LifetimeStats | 'codex' | 'clearedDanger';

export interface AchievementDefinition {
	id: string;
	name: string;
	desc: string;
	category: string;
	icon: string;
	source: AchievementSource;
	goal: number;
	/** 달성 보상 (골드 — 영구 강화에 쓰는 잉걸) */
	reward: number;
}

export interface AchievementProgress {
	entry: AchievementDefinition;
	value: number;
	unlocked: boolean;
	/** 0~1 진행률 (달성 시 1) */
	ratio: number;
}

const catalog = rawAchievementCatalog as unknown as AchievementDefinition[];

const KEY = 'movesword-achievements-v1';

interface AchievementState {
	unlocked: string[];
}

let cached: AchievementState | null = null;
let unlockedSet: Set<string> | null = null;

function load(): AchievementState {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<AchievementState>) : {};
		cached = { unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked.filter((id) => typeof id === 'string') : [] };
	} catch {
		cached = { unlocked: [] };
	}
	unlockedSet = new Set(cached.unlocked);
	return cached;
}

function persist(): void {
	if (!cached) {
		return;
	}
	try {
		localStorage.setItem(KEY, JSON.stringify(cached));
	} catch {
		// 저장 불가 환경에서는 세션 메모리만 유지
	}
}

/** 토스트 한 장의 표시 시간 (ms) */
const TOAST_MS = 2600;

export default class AchievementSystem {
	// ---------------------------------------------------------------
	// 정적 API — 영속 · 진행도 · 판정
	// ---------------------------------------------------------------

	static catalog(): AchievementDefinition[] {
		return catalog;
	}

	static isUnlocked(id: string): boolean {
		load();
		return unlockedSet!.has(id);
	}

	static unlockedCount(): number {
		return load().unlocked.length;
	}

	/** 도전과제 하나의 현재 수치 (목표와 같은 단위) */
	static valueOf(entry: AchievementDefinition): number {
		if (entry.source === 'codex') {
			return seenCount();
		}
		if (entry.source === 'clearedDanger') {
			// clearedDanger 는 0-based (0 = 위험도 Ⅰ) — 사람이 읽는 단계로 환산
			return Math.max(0, MetaProgression.getClearedDanger() + 1);
		}
		return getStats()[entry.source] ?? 0;
	}

	/** 목록 화면용 스냅샷 (달성 → 진행률 높은 순) */
	static snapshot(): AchievementProgress[] {
		load();
		const rows = catalog.map((entry) => {
			const unlocked = unlockedSet!.has(entry.id);
			const value = unlocked ? entry.goal : AchievementSystem.valueOf(entry);
			return {
				entry,
				value,
				unlocked,
				ratio: unlocked ? 1 : Phaser.Math.Clamp(value / Math.max(1, entry.goal), 0, 1),
			};
		});
		rows.sort((a, b) => (Number(b.unlocked) - Number(a.unlocked)) || (b.ratio - a.ratio));
		return rows;
	}

	/**
	 * 미달성 도전과제를 모두 판정한다. 달성한 것은 저장 후 보상을 지급하고 반환.
	 * (호출은 이벤트 경계에서만 — 라운드 클리어 · 보스 처치 · 조합 · 검 획득 등)
	 */
	static evaluate(): AchievementDefinition[] {
		const state = load();
		const unlockedNow: AchievementDefinition[] = [];

		for (const entry of catalog) {
			if (unlockedSet!.has(entry.id)) {
				continue;
			}
			if (AchievementSystem.valueOf(entry) < entry.goal) {
				continue;
			}
			unlockedSet!.add(entry.id);
			state.unlocked.push(entry.id);
			unlockedNow.push(entry);
		}

		if (unlockedNow.length === 0) {
			return unlockedNow;
		}

		// 저장이 먼저 — 지급 도중 예외가 나도 같은 보상을 두 번 주지 않는다
		persist();
		let reward = 0;
		for (const entry of unlockedNow) {
			reward += Math.max(0, Math.round(entry.reward));
		}
		if (reward > 0) {
			MetaProgression.addGold(reward);
			MetaProgression.addLifetime(reward);
		}
		return unlockedNow;
	}

	/** 테스트·디버그용 초기화 */
	static reset(): void {
		cached = { unlocked: [] };
		unlockedSet = new Set();
		try {
			localStorage.removeItem(KEY);
		} catch {
			// 무시
		}
	}

	/** 테스트용: 외부에서 localStorage 를 건드린 뒤 다시 읽는다 */
	static reload(): void {
		cached = null;
		unlockedSet = null;
		load();
	}

	// ---------------------------------------------------------------
	// 인스턴스 — 런 중 이벤트 훅 + 토스트
	// ---------------------------------------------------------------

	scene: GameScene;
	/** 지금 추적 중인 보스 전투에서 플레이어가 맞았는가 (무피격 판정) */
	private playerHitSinceBoss = false;
	/** 보스가 한 번이라도 등장했는가 — 등장 전 피격은 무피격 판정과 무관 */
	private bossEngaged = false;
	private queue: AchievementDefinition[] = [];
	private toast: Phaser.GameObjects.Container | null = null;
	private toastIcon: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null = null;
	private toastName: Phaser.GameObjects.Text | null = null;
	private toastReward: Phaser.GameObjects.Text | null = null;
	private toastTimer: Phaser.Time.TimerEvent | null = null;
	private destroyed = false;

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	/** 런 시작 — 출격 횟수 집계 */
	onRunStart(): void {
		bumpStat('runs');
		flushStats();
		this.check();
	}

	/** 적 처치 (ENEMY_DIED 훅) — 메모리 카운터만 올린다 */
	onEnemyKilled(isBoss: boolean, affixCount: number): void {
		bumpStat('kills');
		if (affixCount >= 3) {
			bumpStat('affixTriple');
		}
		if (!isBoss) {
			return;
		}
		bumpStat('bossKills');
		if (this.bossEngaged && !this.playerHitSinceBoss) {
			bumpStat('bossFlawless');
		}
		// 다음 보스를 위해 무피격 추적을 초기화 (쌍보스 라운드 대응)
		this.playerHitSinceBoss = false;
		flushStats();
		this.check();
	}

	/** 보스 등장 — 무피격 추적 시작 */
	onBossSpawned(): void {
		this.bossEngaged = true;
		this.playerHitSinceBoss = false;
	}

	/** 플레이어 피격 — 무피격 판정 해제 */
	onPlayerHit(): void {
		this.playerHitSinceBoss = true;
	}

	/** 라운드 클리어 — 최고 라운드 갱신 + 판정 */
	onRoundCleared(round: number): void {
		raiseStat('bestRound', round);
		flushStats();
		this.check();
	}

	/** 조합(REFORGE) 성공 */
	onReforge(): void {
		bumpStat('reforges');
		flushStats();
		this.check();
	}

	/** 검을 최고 단계까지 올렸다 */
	onSwordMaxLevel(): void {
		bumpStat('swordMaxLevel');
		flushStats();
		this.check();
	}

	/** 같은 원소 7자루 세트 완성 */
	onElementSetComplete(count: number): void {
		if (count < 7) {
			return;
		}
		bumpStat('elementSet7');
		flushStats();
		this.check();
	}

	/** 도감 신규 기록 (검을 처음 손에 넣었다) */
	onCodexRecorded(): void {
		this.check();
	}

	/** 런 종료 — 통계 확정 후 마지막 판정 */
	onRunEnd(round: number): void {
		raiseStat('bestRound', round);
		flushStats();
		this.check();
	}

	/** 판정 + 달성분 토스트 예약 */
	check(): void {
		if (this.destroyed) {
			return;
		}
		const unlocked = AchievementSystem.evaluate();
		if (unlocked.length === 0) {
			return;
		}
		for (const entry of unlocked) {
			this.queue.push(entry);
		}
		this.scene.soundSystem?.play?.('chest', { volume: 0.5 });
		this.pump();
	}

	// ---------------------------------------------------------------
	// 토스트 — 컨테이너 하나를 재사용한다 (연출마다 오브젝트를 만들지 않는다)
	// ---------------------------------------------------------------

	private ensureToast(): Phaser.GameObjects.Container {
		if (this.toast) {
			return this.toast;
		}
		const scene = this.scene;
		const hs = hudScaleFor(scene);
		const w = 320 * hs;
		const h = 62 * hs;
		const bg = panel(scene, -w / 2, -h / 2, w, h, { alpha: 0.96 });
		const title = scene.add.text(-w / 2 + 52 * hs, -h / 2 + 13 * hs, '도전과제 달성', style(11 * hs, UI.goldText, { display: true }))
			.setOrigin(0, 0.5);
		this.toastIcon = iconImage(scene, 'g-crown', -w / 2 + 28 * hs, 0, 26 * hs, UI.straw);
		this.toastName = scene.add.text(-w / 2 + 52 * hs, 1 * hs, '', style(15 * hs, UI.text, { display: true }))
			.setOrigin(0, 0.5);
		this.toastReward = scene.add.text(-w / 2 + 52 * hs, h / 2 - 14 * hs, '', style(11 * hs, UI.quenchText))
			.setOrigin(0, 0.5);

		const container = scene.add.container(0, 0, [bg, title, this.toastIcon, this.toastName, this.toastReward])
			.setScrollFactor(0)
			.setDepth(1400)
			.setVisible(false);
		this.toast = container;
		return container;
	}

	/** 큐에서 한 장 꺼내 띄운다 (표시 중이면 대기) */
	private pump(): void {
		if (this.destroyed || this.toastTimer || this.queue.length === 0) {
			return;
		}
		const entry = this.queue.shift()!;
		const scene = this.scene;
		const toast = this.ensureToast();
		const hs = hudScaleFor(scene);
		// HUD 우상단 아래 — 라운드 패널(상단 중앙)·미니맵(우상단)·보스바와 겹치지 않는 자리
		const x = scene.scale.width - 180 * hs;
		const y = Math.max(scene.scale.height * 0.30, 200 * hs);

		this.toastName?.setText(entry.name);
		this.toastReward?.setText(`${entry.desc} · 보상 ${entry.reward} 골드`);
		if ((this.toastIcon as Phaser.GameObjects.Image)?.setTexture && scene.textures.exists(entry.icon)) {
			(this.toastIcon as Phaser.GameObjects.Image).setTexture(entry.icon);
		}

		toast.setPosition(x, y).setVisible(true).setAlpha(1);
		scene.tweens.killTweensOf(toast);
		if (!reduceMotion()) {
			toast.setAlpha(0);
			scene.tweens.add({ targets: toast, alpha: 1, x: { from: x + 26 * hs, to: x }, duration: 220, ease: 'Quad.easeOut' });
		}

		this.toastTimer = scene.time.delayedCall(TOAST_MS, () => {
			this.toastTimer = null;
			if (this.destroyed || !this.toast) {
				return;
			}
			if (reduceMotion()) {
				this.toast.setVisible(false);
				this.pump();
				return;
			}
			scene.tweens.add({
				targets: this.toast,
				alpha: 0,
				duration: 260,
				onComplete: () => {
					this.toast?.setVisible(false);
					this.pump();
				},
			});
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.queue.length = 0;
		this.toastTimer?.remove();
		this.toastTimer = null;
		if (this.toast) {
			this.scene.tweens.killTweensOf(this.toast);
			this.toast.destroy();
			this.toast = null;
		}
		this.toastIcon = null;
		this.toastName = null;
		this.toastReward = null;
		flushStats();
	}
}
