import Phaser from 'phaser';
import rawWaveTable from '../data/waveTable.json';
import MetaProgression from './MetaProgression';
import type GameScene from '../scenes/GameScene';
import type { WavePoolEntry, WaveSpec, WaveTable } from '../types/catalogs';
import type { EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';
import type EnemyManager from './EnemyManager';

const waveTable = rawWaveTable as unknown as WaveTable;

const TOTAL_ROUNDS = 60;
const MINIBOSS_ROTATION = ['mb-bulwark', 'mb-slimeking', 'mb-archerlord', 'mb-plaguehealer'];

interface WaveSystemOptions {
	enemyManager?: EnemyManager | null;
}

/**
 * A round objective. `type` decides which of the optional fields are present:
 * kill-count/kill-target carry `required`, kill-target carries `targetId`
 * (+ optional `poolBoost`), survive carries `durationMs` + `overridePool`.
 */
interface RoundObjective {
	type: 'kill-count' | 'kill-target' | 'survive';
	label: string;
	required?: number;
	targetId?: string;
	poolBoost?: boolean;
	durationMs?: number;
	overridePool?: WavePoolEntry[];
}

/** Payload emitted by EnemyManager.die via GameEvents.ENEMY_DIED. */
interface EnemyDiedPayload {
	enemy: EnemySprite;
	x: number;
	y: number;
	amount: number;
	player?: PlayerSprite;
}

interface WaveResults {
	survivedMs: number;
	killCount: number;
	completed: boolean;
	round: number;
}

// Objective-based rounds: each round ends when its goal is met
// (kill count / hunt / survive / elites / miniboss / boss), not on a timer.
export default class WaveSystem {
	scene: GameScene;
	enemyManager: EnemyManager | null;
	waves: WaveSpec[];
	totalRounds: number;
	round: number;
	roundActive: boolean;
	roundElapsedMs: number;
	elapsedMs: number;
	killCount: number;
	killsThisRound: number;
	targetKills: number;
	objective: RoundObjective | null;
	runCompleted: boolean;
	ensureTimer: number;
	roundOpener: { until: number } | null;
	timerText: Phaser.GameObjects.Text;
	objectiveText: Phaser.GameObjects.Text;
	killText: Phaser.GameObjects.Text;
	onEnemyDied: (payload: EnemyDiedPayload) => void;
	activeAnnouncements?: number;

	constructor(scene: GameScene, options: WaveSystemOptions = {}) {
		this.scene = scene;
		this.enemyManager = options.enemyManager ?? null;

		this.waves = [...(waveTable.waves ?? [])].sort((a, b) => a.minute - b.minute);
		this.totalRounds = TOTAL_ROUNDS;

		this.round = 0;
		this.roundActive = false;
		this.roundElapsedMs = 0;
		this.elapsedMs = 0;
		this.killCount = 0;
		this.killsThisRound = 0;
		this.targetKills = 0;
		this.objective = null;
		this.runCompleted = false;
		this.ensureTimer = 0;
		this.roundOpener = null;

		this.timerText = scene.add.text(scene.scale.width / 2, 14, '', {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '26px',
			color: '#ffffff',
		}).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);
		this.timerText.setShadow(0, 3, '#000000', 4, false, true);

		this.objectiveText = scene.add.text(scene.scale.width / 2, 46, '', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '17px',
			color: '#fbbf24',
		}).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);
		this.objectiveText.setShadow(0, 2, '#000000', 2, false, true);

		this.killText = scene.add.text(scene.scale.width / 2, 70, '☠ 0', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '14px',
			color: '#d1d5db',
		}).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);
		this.killText.setShadow(0, 2, '#000000', 2, false, true);

		this.onEnemyDied = (payload) => {
			this.killCount += 1;
			this.killsThisRound += 1;

			const type = payload?.enemy?.enemyType;
			if (this.objective?.type === 'kill-target' && type === this.objective.targetId) {
				this.targetKills += 1;
			}
		};
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	// ---------------------------------------------------------------
	// Round definitions
	// ---------------------------------------------------------------

	getWaveForRound(round: number): WaveSpec {
		const bracket = Math.min(this.waves.length - 1, Math.floor((round - 1) / 4));
		return this.waves[bracket] ?? this.waves[0];
	}

	buildObjective(round: number): RoundObjective {
		if (round === this.totalRounds) {
			return { type: 'kill-target', targetId: 'death-lord', required: 1, label: '☠ 최종 보스: 데스 로드 처치' };
		}

		if (round % 10 === 0) {
			const required = 1 + Math.floor(round / 40);
			return { type: 'kill-target', targetId: 'skullwolf-boss', required, label: `⚠ 보스 ${required}마리 처치` };
		}

		if (round % 5 === 0) {
			const minibossId = MINIBOSS_ROTATION[(Math.floor(round / 5) - 1) % MINIBOSS_ROTATION.length];
			const required = round >= 35 ? 2 : 1;
			return { type: 'kill-target', targetId: minibossId, required, label: `⚔ 중간보스 ${required}마리 처치` };
		}

		const cycle = round % 4;

		if (cycle === 1) {
			const required = 14 + round * 2;
			return { type: 'kill-count', required, label: `적 ${required}마리 처치` };
		}

		if (cycle === 2) {
			const pool = this.getWaveForRound(round).pool ?? [];
			const tough = this.getToughHalf(pool);
			const target = tough.length > 0 ? tough[0].id : 'skullwolf';
			const required = 4 + Math.floor(round / 5);
			const name = this.enemyManager?.getEnemyTypeById?.(target)?.name ?? target;
			return { type: 'kill-target', targetId: target, required, poolBoost: true, label: `사냥: ${name} ${required}마리` };
		}

		if (cycle === 3) {
			// 생존 라운드: 빠르고 넉백에 강한 추격자 위주 풀로 교체 (도망만으로는 못 버팀)
			const durationMs = (30 + round) * 1000;
			return {
				type: 'survive',
				durationMs,
				overridePool: [
					{ id: 'hound', weight: 5 },
					{ id: 'skullwolf-swift', weight: 4 },
					{ id: 'bomber', weight: 3 },
				],
				label: `${Math.round(durationMs / 1000)}초 생존`,
			};
		}

		const required = 1 + Math.floor(round / 20);
		return { type: 'kill-target', targetId: 'skullwolf-elite', required, label: `정예 ${required}마리 처치` };
	}

	getToughHalf(pool: WavePoolEntry[]): WavePoolEntry[] {
		if (!Array.isArray(pool) || pool.length <= 1) {
			return pool ?? [];
		}

		const withHp = pool.map((entry) => ({
			entry,
			hp: this.enemyManager?.getEnemyTypeById?.(entry.id)?.hp ?? 0,
		}));

		withHp.sort((a, b) => b.hp - a.hp);
		return withHp.slice(0, Math.ceil(withHp.length / 2)).map(({ entry }) => entry);
	}

	// ---------------------------------------------------------------
	// Round lifecycle
	// ---------------------------------------------------------------

	startRound(round: number): void {
		this.round = round;
		this.roundActive = true;
		this.roundElapsedMs = 0;
		this.killsThisRound = 0;
		this.targetKills = 0;
		this.ensureTimer = 0;
		this.objective = this.buildObjective(round);

		const wave = this.getWaveForRound(round);
		const danger = this.scene.dangerConfig ?? { hpMult: 1, damageMult: 1 };

		// Per-round enemy scaling on top of danger level
		if (this.enemyManager) {
			this.enemyManager.hpMult = danger.hpMult * (1 + 0.05 * (round - 1));
			this.enemyManager.damageMult = danger.damageMult * (1 + 0.035 * (round - 1));
		}

		let pool = this.objective.overridePool ?? wave.pool;
		if (this.objective.poolBoost) {
			pool = [...wave.pool, { id: this.objective.targetId!, weight: 8 }];
		}

		this.enemyManager?.setSpawnProfile?.({
			spawnIntervalMs: Math.max(280, wave.spawnIntervalMs * Math.max(0.55, 1 - round * 0.005)
				* (this.objective.type === 'survive' ? 0.75 : 1)),
			pool,
			minAlive: (wave.minAlive ?? 0) + Math.floor(round / 3),
		});

		// Power-fantasy opener: previous round's tougher enemies greet you first
		if (round > 1) {
			const previousPool = this.getWaveForRound(round - 1).pool ?? [];
			const openerPool = this.getToughHalf(previousPool);
			if (openerPool.length > 0) {
				this.roundOpener = { until: 8000 };
				this.enemyManager?.setSpawnProfile?.({ pool: openerPool });
				for (let i = 0; i < 3; i += 1) {
					this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player);
				}
			}
		}

		// Spawn kill-target objectives up front (bosses, minibosses, elites, hunt seeds)
		if (this.objective.type === 'kill-target' && !this.objective.poolBoost) {
			for (let i = 0; i < this.objective.required!; i += 1) {
				this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player, this.objective.targetId);
			}
			this.scene.cameras.main.shake(280, 0.006);
			this.scene.soundSystem?.play('warning');
		}

		this.announce(`ROUND ${round}  —  ${this.objective.label}`, round % 10 === 0 ? '#ef4444' : '#fbbf24');
	}

	isObjectiveComplete(): boolean {
		if (!this.objective) {
			return false;
		}

		switch (this.objective.type) {
			case 'kill-count':
				return this.killsThisRound >= this.objective.required!;
			case 'kill-target':
				return this.targetKills >= this.objective.required!;
			case 'survive':
				return this.roundElapsedMs >= this.objective.durationMs!;
			default:
				return false;
		}
	}

	completeRound(): void {
		this.roundActive = false;
		this.roundOpener = null;

		if (this.round >= this.totalRounds) {
			this.runCompleted = true;
			MetaProgression.recordClear(this.scene.dangerLevel ?? 0);
			this.announce('🏆 60라운드 완주! 승리!', '#4ade80');
			this.scene.time.delayedCall(2500, () => {
				if (!this.scene.isGameOver) {
					this.scene.showGameOver();
				}
			});
			return;
		}

		this.enemyManager?.clearField?.();
		this.scene.shopSystem?.open?.(this.round);
	}

	update(delta: number): void {
		this.elapsedMs += delta;

		if (this.runCompleted) {
			this.updateHud();
			return;
		}

		// The shop gates GameScene.update, so reaching here means it's closed:
		// start the next round if none is active.
		if (!this.roundActive) {
			this.startRound(this.round + 1);
			this.updateHud();
			return;
		}

		this.roundElapsedMs += delta;

		// Opener window ends -> restore the real pool
		if (this.roundOpener && this.roundElapsedMs >= this.roundOpener.until) {
			this.roundOpener = null;
			const wave = this.getWaveForRound(this.round);
			let pool = this.objective?.overridePool ?? wave.pool;
			if (this.objective?.poolBoost) {
				pool = [...wave.pool, { id: this.objective.targetId!, weight: 8 }];
			}
			this.enemyManager?.setSpawnProfile?.({ pool });
		}

		// Kill-target safety: if targets all died to something else or failed to
		// spawn (pool cap), top up so the round can always be completed.
		if (this.objective?.type === 'kill-target') {
			this.ensureTimer += delta;
			if (this.ensureTimer >= 4000) {
				this.ensureTimer = 0;
				const remaining = this.objective.required! - this.targetKills;
				const alive = (this.enemyManager?.enemies?.getChildren() as EnemySprite[] | undefined)
					?.filter((enemy) => enemy.active && enemy.enemyType === this.objective!.targetId).length ?? 0;
				if (remaining > 0 && alive < remaining) {
					this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player, this.objective.targetId);
				}
			}
		}

		if (this.isObjectiveComplete()) {
			this.completeRound();
		}

		this.updateHud();
	}

	// ---------------------------------------------------------------
	// HUD & helpers
	// ---------------------------------------------------------------

	getObjectiveProgress(): string {
		if (!this.objective) {
			return '';
		}

		switch (this.objective.type) {
			case 'kill-count':
				return `${this.objective.label}  (${Math.min(this.killsThisRound, this.objective.required!)}/${this.objective.required})`;
			case 'kill-target':
				return `${this.objective.label}  (${Math.min(this.targetKills, this.objective.required!)}/${this.objective.required})`;
			case 'survive': {
				const remaining = Math.max(0, Math.ceil((this.objective.durationMs! - this.roundElapsedMs) / 1000));
				return `${this.objective.label}  (남은 시간 ${remaining}초)`;
			}
			default:
				return this.objective.label;
		}
	}

	updateHud(): void {
		const width = this.scene.scale.width;

		this.timerText.setText(`ROUND ${Math.max(1, this.round)} / ${this.totalRounds}`);
		this.timerText.setX(width / 2);

		this.objectiveText.setText(this.runCompleted ? '🏆 승리!' : this.getObjectiveProgress());
		this.objectiveText.setX(width / 2);

		this.killText.setText(`☠ ${this.killCount}`);
		this.killText.setX(width / 2);
	}

	announce(message: string, color = '#fbbf24'): void {
		const { width, height } = this.scene.scale;
		this.activeAnnouncements = (this.activeAnnouncements ?? 0) + 1;
		const stackOffset = (this.activeAnnouncements - 1) * 44;
		const text = this.scene.add.text(width / 2, height * 0.3 + stackOffset, message, {
			fontFamily: 'Arial Black, Arial, sans-serif',
			fontSize: '32px',
			color,
			align: 'center',
		}).setOrigin(0.5).setScrollFactor(0).setDepth(2100).setAlpha(0);
		text.setShadow(0, 3, '#000000', 6, false, true);

		this.scene.tweens.add({
			targets: text,
			alpha: 1,
			scale: { from: 0.7, to: 1 },
			duration: 260,
			ease: 'Back.easeOut',
			onComplete: () => {
				this.scene.tweens.add({
					targets: text,
					alpha: 0,
					y: text.y - 30,
					delay: 1500,
					duration: 500,
					onComplete: () => {
						text.destroy();
						this.activeAnnouncements = Math.max(0, (this.activeAnnouncements ?? 1) - 1);
					},
				});
			},
		});
	}

	getResults(): WaveResults {
		return {
			survivedMs: this.elapsedMs,
			killCount: this.killCount,
			completed: this.runCompleted,
			round: Math.max(1, this.round),
		};
	}

	destroy(): void {
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.timerText?.destroy();
		this.objectiveText?.destroy();
		this.killText?.destroy();
	}
}
