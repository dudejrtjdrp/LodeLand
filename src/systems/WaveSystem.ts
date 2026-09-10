import Phaser from 'phaser';
import rawWaveTable from '../data/waveTable.json';
import { screenShakeEnabled, reduceMotion } from '../core/settings';
import MetaProgression from './MetaProgression';
import RunSave from '../core/RunSave';
import { getTraitById, traitSelfElement } from '../logic/enemyTraits';
import { themeForElement, themeByRoundHash, type MapTheme } from '../logic/mapThemes';
import {
	MOP_UP_HARD_CAP_MS, MOP_UP_LEASH_PX,
	ROUND_MIN_MS, ROUND_SCALING, damageMultForRound, hpMultForRound, isSpikeRound,
	minAliveForRound, resistBonusForRound, spawnIntervalForRound, spikeTierForRound,
	waveBracketIndex,
} from '../logic/roundScaling';
import { enemyDamageGrowth, enemyHpGrowth } from '../logic/growth';
import type GameScene from '../scenes/GameScene';
import type { Element, EnemyDefinition, WavePoolEntry, WaveSpec, WaveTable } from '../types/catalogs';
import type { EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';
import type EnemyManager from './EnemyManager';
import { FONT, UI, panel, slot, banner, style, hudScaleFor, TEXT_RESOLUTION,
} from '../ui/theme';

const waveTable = rawWaveTable as unknown as WaveTable;

const TOTAL_ROUNDS = 200;
const MINIBOSS_ROTATION = [
	'mb-bulwark', 'mb-gorehorn', 'mb-slimeking', 'mb-frost-golem',
	'mb-broodmother', 'mb-archerlord', 'mb-rustbanner', 'mb-magma-golem',
	'mb-plaguehealer', 'mb-headtaker',
];
const BOSS_ROTATION = [
	'skullwolf-boss', 'boss-siegehulk', 'boss-minos',
	'boss-needlequeen', 'boss-frost-guardian', 'boss-abyss-demon',
];

/**
 * 라운드별 적 스케일링 (waveTable.json의 scaling 블록, 없으면 기본값).
 * 수식은 src/logic/roundScaling.ts 로 분리돼 있다 — 헤드리스 밸런스 시뮬
 * (scripts/balance-sim)이 게임과 **같은 함수**를 쓰게 하려는 것이다.
 */
const SCALING = ROUND_SCALING;

interface WaveSystemOptions {
	enemyManager?: EnemyManager | null;
}

/** kill-target 목표의 개별 대상 (여러 종류 동시 목표 지원 — 보스 2+중보 2 등) */
interface ObjectiveTarget {
	id: string;
	required: number;
	kills: number;
}

/**
 * A round objective. `type` decides which of the optional fields are present:
 * kill-count carries `required`, kill-target carries `targets`
 * (+ optional `poolBoost`), survive carries `durationMs` + `overridePool`.
 */
interface RoundObjective {
	type: 'kill-count' | 'kill-target' | 'survive';
	label: string;
	required?: number;
	targets?: ObjectiveTarget[];
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

/** 라운드 정찰 정보 — 대기실(상점) 정찰 보고·맵 테마·입장 연출이 공유한다. */
export interface RoundIntel {
	round: number;
	objective: RoundObjective;
	/** 목표 대상 (보스/정예 등) — 등장 수 포함 */
	targets: Array<{ def: EnemyDefinition; count: number }>;
	/** 잡몹 스폰 풀 (중복 제거, 강한 순) */
	pool: EnemyDefinition[];
	/** 이 라운드의 맵 테마 (적 특성의 몸체 원소를 따른다) */
	theme: MapTheme;
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
	objectiveCount!: Phaser.GameObjects.Text;
	killText: Phaser.GameObjects.Text;
	hudG!: Phaser.GameObjects.Graphics;
	hudPanel?: Phaser.GameObjects.NineSlice;
	hudObjDivider?: Phaser.GameObjects.Image;
	dangerBadge?: Phaser.GameObjects.NineSlice;
	hs = 1;
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

		// 상단 중앙 라운드 패널 (시안: 오나먼트 프레임 + 목표 스트립 + KILL 카운트)
		this.hudG = scene.add.graphics().setScrollFactor(0).setDepth(1000);
		this.drawHudPanel();
		scene.scale.on('resize', this.drawHudPanel, this);

		// 강판 패널 위 — 밝은 회백 텍스트
		this.timerText = scene.add.text(scene.scale.width / 2, 20, '', {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: '27px',
			fontStyle: '700',
			color: UI.text,
		}).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);

		this.objectiveText = scene.add.text(scene.scale.width / 2, 66, '', style(15, UI.text))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(1002);

		this.objectiveCount = scene.add.text(scene.scale.width / 2, 66, '', style(15, UI.emberText))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(1002);

		// 처치 카운트는 패널 밖(월드 위) — 밝은 텍스트 유지
		this.killText = scene.add.text(scene.scale.width / 2, 96, '', {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: '14px',
			fontStyle: '700',
			color: '#f0e6cc',
		}).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002);
		this.killText.setShadow(0, 2, '#000000', 3, false, true);

		// 텍스트가 만들어진 뒤 다시 그려야 폰트 크기·위치 배율이 반영된다
		this.drawHudPanel();

		this.onEnemyDied = (payload) => {
			this.killCount += 1;
			this.killsThisRound += 1;

			const type = payload?.enemy?.enemyType;
			if (this.objective?.type === 'kill-target' && type && this.objective.targets) {
				const target = this.objective.targets.find((t) => t.id === type);
				if (target) {
					target.kills += 1;
				}
			}
		};
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	// ---------------------------------------------------------------
	// Round definitions
	// ---------------------------------------------------------------

	getWaveForRound(round: number): WaveSpec {
		const bracket = waveBracketIndex(round, this.waves.length);
		return this.waves[bracket] ?? this.waves[0];
	}

	enemyName(id: string): string {
		return this.enemyManager?.getEnemyTypeById?.(id)?.name ?? id;
	}

	/** kill-target 목표 생성 헬퍼 (labelOverride: 긴 조합의 패널 폭 초과 방지용) */
	killTargets(entries: Array<[string, number]>, prefix: string, labelOverride?: string): RoundObjective {
		const targets: ObjectiveTarget[] = entries.map(([id, required]) => ({ id, required, kills: 0 }));
		const label = labelOverride ?? `${prefix} — ${entries
			.map(([id, required]) => (required > 1 ? `${this.enemyName(id)} ×${required}` : this.enemyName(id)))
			.join(' + ')}`;
		return { type: 'kill-target', targets, label };
	}

	buildObjective(round: number): RoundObjective {
		if (round === this.totalRounds) {
			// 최종전: Rust Mother + 깃발수 호위
			return this.killTargets([['death-lord', 1], ['mb-rustbanner', 1]], '최심부');
		}

		// 100라 중간 클라이맥스: 탈각하는 것 — 체력 75/50/25%마다 형태·특성·스킬이 바뀌는 페이즈 보스
		if (round === 100) {
			return this.killTargets([['boss-molt', 1]], '탈각');
		}

		if (round % 10 === 0) {
			// 보스 라운드: 뒤로 갈수록 구성이 무거워진다 (pack2 보스 3종 편입 — 2026-08-31)
			const stage = Math.floor(round / 10);
			const escort = MINIBOSS_ROTATION[(round / 5 - 1) % MINIBOSS_ROTATION.length];
			switch (stage) {
				case 1:
					return this.killTargets([['skullwolf-boss', 1]], '보스');
				case 2:
					// 보스 1 + 중간보스 호위 1
					return this.killTargets([['boss-siegehulk', 1], [escort, 1]], '보스');
				case 3:
					// 돌진 보스 데뷔 + 구면 보스 (서로 다른 종류)
					return this.killTargets([['boss-minos', 1], ['skullwolf-boss', 1]], '쌍둥이 보스');
				case 4:
					return this.killTargets([['boss-frost-guardian', 1], ['boss-needlequeen', 1]], '쌍둥이 보스');
				case 5:
					// 50라: 심연 데몬 데뷔 + 중간보스 2
					return this.killTargets(
						[['boss-abyss-demon', 1], [escort, 2]],
						'맹공',
						'맹공 — 심연 데몬 + 정예 ×2',
					);
				default: {
					// 60라+: 보스 6종 로테이션 페어 (탈각 100라·최심부 200라는 위에서 분기)
					const pairs: Array<[string, string]> = [
						['boss-siegehulk', 'boss-minos'],
						['boss-needlequeen', 'boss-frost-guardian'],
						['boss-abyss-demon', 'skullwolf-boss'],
						['boss-frost-guardian', 'boss-minos'],
						['boss-abyss-demon', 'boss-needlequeen'],
					];
					const [first, second] = pairs[(stage - 6) % pairs.length];
					const entries: Array<[string, number]> = [[first, 1], [second, 1]];
					if (stage >= 7) {
						entries.push([escort, 2]);
					}
					return this.killTargets(entries, stage >= 7 ? '맹공' : '쌍둥이 보스');
				}
			}
		}

		if (round % 5 === 0) {
			const idx = Math.floor(round / 5) - 1;
			const minibossId = MINIBOSS_ROTATION[idx % MINIBOSS_ROTATION.length];
			if (round >= 45) {
				// 서로 다른 중간보스 2종 (2+1)
				const secondId = MINIBOSS_ROTATION[(idx + 3) % MINIBOSS_ROTATION.length];
				return this.killTargets([[minibossId, 2], [secondId, 1]], '정예');
			}
			const required = round >= 25 ? 2 : 1;
			return this.killTargets([[minibossId, required]], '정예');
		}

		const cycle = round % 4;

		if (cycle === 1) {
			// 200라 확장: 후반에도 라운드가 무한정 길어지지 않게 상한
			const required = Math.min(150, 14 + round * 2);
			return { type: 'kill-count', required, label: `토벌 — 녹 ${required}` };
		}

		if (cycle === 2) {
			const pool = this.getWaveForRound(round).pool ?? [];
			const tough = this.getToughHalf(pool);
			const target = tough.length > 0 ? tough[0].id : 'skullwolf';
			const required = Math.min(15, 4 + Math.floor(round / 5));
			const objective = this.killTargets([[target, required]], '사냥');
			objective.poolBoost = true;
			return objective;
		}

		if (cycle === 3) {
			// RUST TIDE(생존) 라운드: 빠르고 넉백에 강한 추격자 위주 풀로 교체 (도망만으로는 못 버팀)
			// 2026-09-02: "버티는 시간을 늘리지 말고 적을 세게" — 지속시간은 라운드 길이로 고정한다.
			const durationMs = ROUND_MIN_MS;
			const overridePool: WavePoolEntry[] = [
				{ id: 'hound', weight: 5 },
				{ id: 'skullwolf-swift', weight: 4 },
				{ id: 'bomber', weight: 3 },
			];
			if (round >= 11) {
				overridePool.push({ id: 'duskbat', weight: 4 });
			}
			if (round >= 15) {
				overridePool.push({ id: 'blinker', weight: 3 });
			}
			if (round >= 23) {
				overridePool.push({ id: 'charger', weight: 3 });
			}
			if (round >= 35) {
				overridePool.push({ id: 'sniper', weight: 3 }, { id: 'banneret', weight: 2 });
			}
			return {
				type: 'survive',
				durationMs,
				overridePool,
				label: `녹 해일 — ${Math.round(durationMs / 1000)}초 버티기`,
			};
		}

		const required = Math.min(6, 1 + Math.floor(round / 20));
		return this.killTargets([['skullwolf-elite', required]], '우두머리');
	}

	/**
	 * 라운드 정찰 정보 — 결정론(같은 라운드 = 같은 결과)이라 대기실의 예고와
	 * 실제 입장이 항상 일치한다. buildObjective 는 부작용이 없다.
	 */
	getRoundIntel(round: number): RoundIntel {
		const objective = this.buildObjective(round);
		const wave = this.getWaveForRound(round);
		const manager = this.enemyManager;

		const targets: Array<{ def: EnemyDefinition; count: number }> = [];
		for (const target of objective.targets ?? []) {
			const def = manager?.getEnemyTypeById?.(target.id);
			if (def) {
				targets.push({ def, count: target.required });
			}
		}

		const poolEntries = objective.overridePool ?? wave.pool ?? [];
		const seen = new Set<string>(targets.map((entry) => entry.def.id));
		const pool: EnemyDefinition[] = [];
		for (const entry of poolEntries) {
			if (seen.has(entry.id)) {
				continue;
			}
			seen.add(entry.id);
			const def = manager?.getEnemyTypeById?.(entry.id);
			if (def) {
				pool.push(def);
			}
		}
		pool.sort((a, b) => (b.hp ?? 0) - (a.hp ?? 0));

		// 맵 테마: 목표(보스/정예)의 첫 몸체 특성 → 없으면 풀의 강한 적 순으로 몸체 탐색 → 해시 폴백
		let element: Element | null = null;
		for (const def of [...targets.map((entry) => entry.def), ...pool]) {
			for (const traitId of def.traits ?? []) {
				const trait = getTraitById(traitId);
				const self = trait ? traitSelfElement(trait) : null;
				if (self) {
					element = self;
					break;
				}
			}
			if (element) {
				break;
			}
		}
		const theme = themeForElement(element) ?? themeByRoundHash(round);

		return { round, objective, targets, pool, theme };
	}

	/**
	 * 계단식 파워 스파이크 단계 이름. 단계가 오를 때마다 적의 체력·피해·내구가
	 * 한 번에 뛰고, 어픽스(패시브) 예산도 같이 올라간다 (EnemyManager.setRound).
	 */
	dangerLabelFor(round: number): string {
		// 10단계 = 라운드 10/20/…/100. 이름은 광맥이 무너져 가는 순서다.
		const names = [
			'균열', '침식', '역류', '창궐', '심연',
			'범람', '붕락', '역병', '아귀', '종언',
		];
		const tier = spikeTierForRound(round, SCALING);
		return names[Math.max(0, Math.min(names.length - 1, tier - 1))] ?? '균열';
	}

	/** 스파이크 경계 라운드의 입장 타이틀 카드에 얹을 한 줄 (아니면 null). */
	dangerNoteFor(round: number): string | null {
		if (!isSpikeRound(round, SCALING)) {
			return null;
		}
		const tier = spikeTierForRound(round, SCALING);
		return `위험도 ${tier}단계 — ${this.dangerLabelFor(round)} · 적의 체력·공격·내구가 한 단계 올라간다`;
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
		// 스킬 트리 [시작의 불꽃] 등 라운드 시작 훅
		this.scene.skillTree?.onRoundStart?.();
		// 입장 애니메이션(가림막·타이틀) 동안 + 1초는 스폰 금지 — 아래 delayedCall 이 켠다
		if (this.enemyManager) {
			this.enemyManager.spawningEnabled = false;
		}
		this.roundElapsedMs = 0;
		this.killsThisRound = 0;
		this.targetKills = 0;
		this.ensureTimer = 0;
		this.goalMetAtMs = null;
		this.spawnWindowClosedAtMs = null;
		this.mopUpAssistTimer = 0;
		this.mopUpExpired = false;
		this.cachedRemainingAt = -1;
		const intel = this.getRoundIntel(round);
		this.objective = intel.objective;

		// 새 맵 입장: 테마 교체·원점 복귀·타이틀 카드 — 스폰보다 먼저 호출해야
		// 목표 몹이 새 위치 기준으로 배치된다.
		// 계단식 파워 스파이크 경계(10/20/30/40/50)면 타이틀 카드에 위험도 상승을 얹는다.
		this.scene.stageRoundEntry?.(round, intel.theme, this.objective.label, this.dangerNoteFor(round));

		const wave = this.getWaveForRound(round);
		const danger = this.scene.dangerConfig ?? { hpMult: 1, damageMult: 1 };

		// Per-round enemy scaling on top of danger level.
		// 선형만으로는 플레이어의 곱연산 성장(상점×융합×강화)을 따라가지 못해
		// 13~14라부터 방치가 가능해진다 → 선형×지수 복합 스케일링.
		if (this.enemyManager) {
			// 지수 성장은 lateStartRound 까지 hpExpBase, 그 이후는 lateHpExpBase 로 완만화
			// (200라 확장 시 HP가 천문학적으로 튀는 것 방지 — 대신 저항이 계속 오른다)
			const hpScale = hpMultForRound(round, SCALING);
			const damageScale = damageMultForRound(round, SCALING);
			this.enemyManager.hpMult = danger.hpMult * hpScale;
			this.enemyManager.damageMult = danger.damageMult * damageScale;
			// 숫자 인플레이션 성장 (logic/growth.ts) — 플레이어 레벨 성장과 같은 곡선
			this.enemyManager.growthHpMult = enemyHpGrowth(round);
			this.enemyManager.growthDamageMult = enemyDamageGrowth(round);
			this.enemyManager.bossHpExponent = SCALING.bossHpExponent;
			this.enemyManager.minibossHpExponent = SCALING.minibossHpExponent;
			// 후반 내구성: 라운드가 갈수록 물리/마법 저항 상승 (적이 도달하기 전에 다 녹는 문제 대응)
			this.enemyManager.resistBonus = resistBonusForRound(round, SCALING);
			this.enemyManager.setRound?.(round);
		}

		let pool = this.objective.overridePool ?? wave.pool;
		if (this.objective.poolBoost && this.objective.targets?.length) {
			pool = [...wave.pool, { id: this.objective.targets[0].id, weight: 8 }];
		}

		// 스폰 간격·동시 생존 상한은 roundScaling 의 공유 함수가 정한다 (시뮬과 같은 식).
		this.enemyManager?.setSpawnProfile?.({
			spawnIntervalMs: spawnIntervalForRound(wave.spawnIntervalMs, round)
				* (this.objective.type === 'survive' ? 0.75 : 1),
			pool,
			minAlive: minAliveForRound(wave.minAlive ?? 0, round),
		});

		// 첫 스폰은 입장 연출이 걷히고 1초 뒤 (가림막 ~1.6초 + 1초). 그때:
		//   오프너(전 라운드 강한 놈들) → 목표 몹(보스/정예) → 일반 스폰 개시 순서로 서서히.
		this.scene.time.delayedCall(WaveSystem.ENTRY_SPAWN_DELAY_MS, () => {
			// 그 사이 라운드가 끝났거나(즉시 클리어 목표), 사망/마을 복귀면 스폰하지 않는다
			if (!this.roundActive || this.round !== round
				|| this.scene.isGameOver || this.scene.player?.isDead || this.scene.villageSystem?.isActive) {
				return;
			}
			if (this.enemyManager) {
				this.enemyManager.spawningEnabled = true;
			}

			// Power-fantasy opener: previous round's tougher enemies greet you first
			if (round > 1) {
				const previousPool = this.getWaveForRound(round - 1).pool ?? [];
				const openerPool = this.getToughHalf(previousPool);
				if (openerPool.length > 0) {
					this.roundOpener = { until: this.roundElapsedMs + 6000 };
					this.enemyManager?.setSpawnProfile?.({ pool: openerPool });
					for (let i = 0; i < 3; i += 1) {
						this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player);
					}
				}
			}

			// Spawn kill-target objectives up front (bosses, minibosses, elites, hunt seeds)
			if (this.objective?.type === 'kill-target' && !this.objective.poolBoost && this.objective.targets) {
				for (const target of this.objective.targets) {
					for (let i = 0; i < target.required; i += 1) {
						this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player, target.id);
					}
				}
				if (screenShakeEnabled()) {
					this.scene.cameras.main.shake(280, 0.006);
				}
				this.scene.soundSystem?.play('warning');
			}
		});

		// 라운드 예고는 입장 타이틀 카드(stageRoundEntry)가 담당한다 — 배너 중복 제거

		// 계단식 파워 스파이크 시그널: 기존 배너(announce) 재활용 — 새 시스템을 만들지 않는다.
		if (isSpikeRound(round, SCALING)) {
			this.scene.time.delayedCall(2100, () => {
				if (this.roundActive && this.round === round && !this.scene.isGameOver) {
					this.announce(`위험도 상승 — ${this.dangerLabelFor(round)}`, '#e0623c');
					this.scene.soundSystem?.play('warning');
					if (screenShakeEnabled()) {
						this.scene.cameras.main.shake(360, 0.008);
					}
				}
			});
		}

		// DEEP LODE(최종 라운드) 서사 한 줄
		if (round === this.totalRounds) {
			this.scene.time.delayedCall(2300, () => {
				if (this.roundActive && !this.scene.isGameOver) {
					this.announce('낯익은 심장이 저 가슴에서 뛰고 있다', '#8fc3d8');
				}
			});
		}
	}

	/** 목표 자체가 달성됐는가 (스폰 창·잔당 소탕은 보지 않는다 — isObjectiveComplete 참조). */
	isGoalMet(): boolean {
		if (!this.objective) {
			return false;
		}

		switch (this.objective.type) {
			case 'kill-count':
				return this.killsThisRound >= this.objective.required!;
			case 'kill-target':
				return (this.objective.targets ?? []).every((t) => t.kills >= t.required);
			case 'survive':
				return this.roundElapsedMs >= this.objective.durationMs!;
			default:
				return false;
		}
	}

	/**
	 * 목표를 달성한 시점(roundElapsedMs). null이면 아직 미달성.
	 * 스폰 창이 닫히는 기준점 중 하나다 — update()에서만 기록한다.
	 */
	goalMetAtMs: number | null = null;

	/** 스폰 창이 닫힌 시점(roundElapsedMs). null이면 아직 스폰 중. */
	spawnWindowClosedAtMs: number | null = null;

	/**
	 * 아직 새 적이 나오는 구간인가.
	 * 창은 40초에 닫히지만, 목표가 아직 안 깨졌으면(물량 부족으로 토벌 수를 못 채우는 등)
	 * 목표를 깰 수 있을 때까지 계속 열어 둔다 — 그래야 라운드가 잠기지 않는다.
	 */
	spawnWindowOpen(): boolean {
		return this.roundElapsedMs < WaveSystem.SPAWN_WINDOW_MS || !this.isGoalMet();
	}

	/** 스폰이 끝나고 남은 적을 정리하는 단계인가. */
	inMopUp(): boolean {
		return this.roundActive && this.spawnWindowClosedAtMs !== null;
	}

	/**
	 * 아직 살아 있는 "정리해야 할" 적의 수.
	 * 사신(리퍼)은 처치 대상이 아니라 계속 쫓아다니는 압박 장치라 세지 않고,
	 * 사망 연출 중(isDying)인 적도 이미 죽은 것으로 본다.
	 */
	remainingEnemyCount(): number {
		const children = (this.enemyManager?.enemies?.getChildren() as EnemySprite[] | undefined) ?? [];
		let count = 0;
		for (const enemy of children) {
			if (!this.enemyManager?.isAliveEnemy(enemy) || enemy.isDying || enemy.catalog?.isReaper) {
				continue;
			}
			count += 1;
		}
		return count;
	}

	/** HUD용 잔당 수 (매 프레임 전체 순회를 피하려고 150ms 캐시) */
	private cachedRemaining = 0;
	private cachedRemainingAt = -1;

	remainingEnemyCountCached(): number {
		const now = this.elapsedMs;
		if (now - this.cachedRemainingAt >= 150 || this.cachedRemainingAt < 0) {
			this.cachedRemainingAt = now;
			this.cachedRemaining = this.remainingEnemyCount();
		}
		return this.cachedRemaining;
	}

	/**
	 * 라운드 종료 조건 = 목표 달성 **그리고** 스폰 창이 닫힘 **그리고** 남은 적 0.
	 * - 40초까지는 적이 계속 나온다. 목표를 5초 만에 깨도 라운드는 안 끝난다 (2026-09-02).
	 * - 40초가 지나면 스폰이 멈추고, **그때까지 나온 적을 전부 처치해야** 끝난다
	 *   (사용자 요청, 2026-09-06). 시간이 아니라 필드가 비는 것이 종료 신호다.
	 * - 안전장치: 소탕이 MOP_UP_HARD_CAP_MS 를 넘기면 update()가 잔당을 정리한다.
	 */
	isObjectiveComplete(): boolean {
		if (!this.isGoalMet() || this.spawnWindowOpen()) {
			return false;
		}
		return this.mopUpExpired || this.remainingEnemyCount() === 0;
	}

	/** 소탕 안전장치가 발동해 라운드를 강제 종료하는 중인가 (update()에서만 켠다). */
	mopUpExpired = false;

	/**
	 * 스폰 창을 즉시 닫고 필드를 비워 라운드 종료 조건을 채운다.
	 * 자동 테스트가 "클리어 → 여운 → 대기마을" 흐름만 보고 싶을 때 쓰는 지름길이다
	 * (목표 자체는 호출자가 채워야 한다 — isGoalMet() 은 우회하지 않는다).
	 */
	skipToRoundEnd(): void {
		this.roundElapsedMs = Math.max(this.roundElapsedMs, WaveSystem.SPAWN_WINDOW_MS);
		if (this.enemyManager) {
			this.enemyManager.spawningEnabled = false;
		}
		this.enemyManager?.clearField?.();
		this.mopUpExpired = true;
		this.cachedRemainingAt = -1;
	}

	/** 라운드 클리어 → 대기실 사이의 여운 (즉시 전환이 급작스럽다는 피드백) */
	private static readonly INTERMISSION_DELAY_MS = 3000;
	/** 라운드 입장: 애니메이션(~1.6초)이 걷히고 1초 뒤 첫 스폰 (사용자 요청) */
	private static readonly ENTRY_SPAWN_DELAY_MS = 2600;
	/**
	 * 스폰 창 길이 — 라운드 시작 후 이 시간 동안만 적이 새로 나온다. 목표를 아무리 빨리
	 * 깨도 이 시간까지는 스폰이 이어지고, 창이 닫힌 뒤에는 남은 적을 전부 잡아야 끝난다.
	 * 값의 단일 출처는 roundScaling.ROUND_MIN_MS (밸런스 시뮬도 같은 값을 쓴다).
	 */
	static readonly SPAWN_WINDOW_MS = ROUND_MIN_MS;
	/** @deprecated SPAWN_WINDOW_MS 의 옛 이름 — 외부 테스트 호환용 별칭. */
	static readonly ROUND_MIN_MS = ROUND_MIN_MS;
	/** 잔당 소탕이 이 시간을 넘기면 남은 잡몹을 정리하고 끝낸다 (소프트락 방지). */
	static readonly MOP_UP_HARD_CAP_MS = MOP_UP_HARD_CAP_MS;
	/** 여운 동안 update()가 다음 라운드를 시작하지 못하게 막는 걸쇠 */
	pendingIntermission = false;

	completeRound(): void {
		this.roundActive = false;
		this.roundOpener = null;
		// 여운·마을 동안 스폰 정지 (startRound 가 다시 켠다)
		if (this.enemyManager) {
			this.enemyManager.spawningEnabled = false;
		}

		// 도전과제: 최고 라운드 갱신 + 누적 통계 저장 경계 (프레임 폴링 없음)
		this.scene.achievements?.onRoundCleared(this.round);

		if (this.round >= this.totalRounds) {
			this.runCompleted = true;
			MetaProgression.recordClear(this.scene.dangerLevel ?? 0);
			this.announce('Rust Mother 침묵 — 광맥이 숨을 되쉰다', '#9bc25b');
			this.scene.time.delayedCall(2500, () => {
				if (!this.scene.isGameOver) {
					this.scene.showGameOver();
				}
			});
			return;
		}

		this.enemyManager?.clearField?.();
		// 라운드 전환은 필드를 비우는 지점 — 못 먹은 경험치 구슬·금화·보스 상자까지
		// 전부 자동 수령한다 (주우러 되돌아다닐 필요 없음). 여기서 레벨업이 터지면
		// 카드가 여운 동안 뜨고, 선택을 모두 마친 뒤에야 마을로 넘어간다.
		this.scene.progression?.collectAllOrbs?.();
		this.scene.pickupSystem?.collectAllItems?.();

		// 증강: 라운드 단위 수입·누적 효과 정산 (상점/증강 열리기 전)
		this.scene.augmentSystem?.onRoundComplete?.(this.round);

		// 자동 저장: 라운드 클리어 직후 (상점 구매 반영은 ShopSystem.close에서 재저장)
		RunSave.save(RunSave.capture(this.scene));

		// 3초 여운: 클리어 배너를 보며 숨을 고른 뒤 대기마을로. pendingIntermission 은
		// 마을에 머무는 동안 계속 true — 게이트로 출발(depart)할 때 풀린다.
		this.pendingIntermission = true;
		this.announce(`라운드 ${this.round} 클리어`, '#9bc25b');
		this.scene.soundSystem?.play('evolve', { volume: 0.45 });

		this.scene.time.delayedCall(WaveSystem.INTERMISSION_DELAY_MS, () => this.settleThenEnterVillage());
	}

	/**
	 * 여운이 끝난 뒤 마을 입장 전 정산 체인. 자동 수확으로 레벨업이 터졌으면
	 * 스탯 카드를 전부 고를 때까지 기다렸다가, 증강 제공 라운드면 드래프트까지
	 * 마친 뒤 대기마을로 들어간다.
	 */
	private settleThenEnterVillage(): void {
		// 여운/선택 중 사망(잔존 리퍼 등)·게임 종료면 마을을 열지 않는다
		if (this.scene.isGameOver || this.scene.player?.isDead) {
			return;
		}

		const levelUp = this.scene.levelUpSystem;
		if (levelUp && (levelUp.isOpen || (levelUp.pendingChoices ?? 0) > 0)) {
			this.scene.time.delayedCall(300, () => this.settleThenEnterVillage());
			return;
		}

		const enterVillage = () => {
			// 레벨업 선택·자동 수확분까지 저장에 반영 (재도전 복원 시점 최신화)
			RunSave.save(RunSave.capture(this.scene));
			this.scene.villageSystem?.enter?.(this.round);
		};

		// 증강 제공 라운드(10/25/40/55) 진입 직전이면 증강 드래프트 → 닫히면 마을로 체인
		if (this.scene.augmentSystem?.shouldOffer?.(this.round + 1)) {
			this.scene.augmentSystem.open(this.round + 1, enterVillage);
			return;
		}

		enterVillage();
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
			// 클리어 여운(3초) 동안은 다음 라운드를 시작하지 않는다 — 상점이 열리면
			// GameScene.update 자체가 멈추므로 이 걸쇠는 여운 구간에만 걸린다.
			if (this.pendingIntermission) {
				this.updateHud();
				return;
			}
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
			if (this.objective?.poolBoost && this.objective.targets?.length) {
				pool = [...wave.pool, { id: this.objective.targets[0].id, weight: 8 }];
			}
			this.enemyManager?.setSpawnProfile?.({ pool });
		}

		// Kill-target safety: if targets all died to something else or failed to
		// spawn (pool cap), top up so the round can always be completed.
		if (this.objective?.type === 'kill-target' && this.objective.targets) {
			this.ensureTimer += delta;
			if (this.ensureTimer >= 4000) {
				this.ensureTimer = 0;
				const children = (this.enemyManager?.enemies?.getChildren() as EnemySprite[] | undefined) ?? [];
				for (const target of this.objective.targets) {
					const remaining = target.required - target.kills;
					if (remaining <= 0) {
						continue;
					}
					const alive = children.filter((enemy) => enemy.active && enemy.enemyType === target.id).length;
					if (alive < remaining) {
						this.enemyManager?.spawnEnemy?.(this.scene, this.scene.player, target.id);
					}
				}
			}
		}

		// 목표 달성 시점 기록.
		if (this.goalMetAtMs === null && this.isGoalMet()) {
			this.goalMetAtMs = this.roundElapsedMs;
		}

		// 스폰 창이 닫히는 순간 — 여기부터는 새 적이 나오지 않고, 남은 적을 다 잡아야 끝난다.
		// (spawningEnabled 를 다시 켜지 않는 단방향 토글이라 입장 지연 로직과 충돌하지 않는다)
		if (this.spawnWindowClosedAtMs === null && !this.spawnWindowOpen()) {
			this.spawnWindowClosedAtMs = this.roundElapsedMs;
			if (this.enemyManager) {
				this.enemyManager.spawningEnabled = false;
			}
			this.cachedRemainingAt = -1;
			const left = this.remainingEnemyCount();
			this.announce(left > 0 ? `잔당 소탕 — 남은 적 ${left}` : '전멸', '#8fc3d8');
		}

		if (this.spawnWindowClosedAtMs !== null) {
			this.updateMopUp(delta);
		}

		if (this.isObjectiveComplete()) {
			this.completeRound();
		}

		this.updateHud();
	}

	/** 소탕 단계: 멀리 새는 잔당을 끌어오고, 너무 길어지면 강제로 정리한다. */
	private mopUpAssistTimer = 0;

	private updateMopUp(delta: number): void {
		const elapsed = this.roundElapsedMs - (this.spawnWindowClosedAtMs ?? this.roundElapsedMs);

		// 안전장치: 소탕이 너무 길어지면(멀리 흩어짐·계속 소환 등) 남은 잡몹을 정리하고 끝낸다.
		if (elapsed >= WaveSystem.MOP_UP_HARD_CAP_MS) {
			this.enemyManager?.clearField?.();
			this.mopUpExpired = true; // clearField 가 남기는 보스까지 있어도 라운드는 끝낸다
			this.cachedRemainingAt = -1;
			return;
		}

		// 2초마다: 리시(leash) 밖으로 벗어난 잡몹을 플레이어 주변(화면 밖 링)으로 다시 끌어온다.
		// "마지막 한 마리를 찾아 맵을 헤매는" 상황을 없애려는 것 — 보스/사신은 건드리지 않는다.
		this.mopUpAssistTimer += delta;
		if (this.mopUpAssistTimer < 2000) {
			return;
		}
		this.mopUpAssistTimer = 0;

		const player = this.scene.player;
		const manager = this.enemyManager;
		if (!player || !manager) {
			return;
		}
		const leashSq = MOP_UP_LEASH_PX * MOP_UP_LEASH_PX;
		for (const enemy of (manager.enemies?.getChildren() as EnemySprite[] | undefined) ?? []) {
			if (!manager.isAliveEnemy(enemy) || enemy.isDying) {
				continue;
			}
			if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			const dx = enemy.x - player.x;
			const dy = enemy.y - player.y;
			if (dx * dx + dy * dy <= leashSq) {
				continue;
			}
			const pos = manager.getSpawnPosition(this.scene, player);
			enemy.setPosition(pos.x, pos.y);
			enemy.body?.reset?.(pos.x, pos.y);
		}
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
			case 'kill-target': {
				const done = (this.objective.targets ?? []).reduce((sum, t) => sum + Math.min(t.kills, t.required), 0);
				const total = (this.objective.targets ?? []).reduce((sum, t) => sum + t.required, 0);
				return `${this.objective.label}  (${done}/${total})`;
			}
			case 'survive': {
				const remaining = Math.max(0, Math.ceil((this.objective.durationMs! - this.roundElapsedMs) / 1000));
				return `${this.objective.label}  (남은 시간 ${remaining}초)`;
			}
			default:
				return this.objective.label;
		}
	}

	// 상단 중앙 고정 패널 (리사이즈 시에만 다시 그림)
	drawHudPanel(): void {
		const width = this.scene.scale.width;
		const cx = width / 2;
		const g = this.hudG;
		if (!g) {
			return;
		}
		const base = hudScaleFor(this.scene);
		// 좁은 화면에서 좌측 XP 패널(우측 끝 362*hs)·우측 미니맵과 겹치지 않게
		// 배너만 추가로 줄인다. 필요 반폭 218 = 패널 210 + 여백.
		const availHalf = Math.min(cx - 362 * base - 14, width - 160 * base - cx);
		const hs = Phaser.Math.Clamp(Math.min(base, availHalf / 218), 0.5, base);
		this.hs = hs;
		g.clear();

		// 라운드 패널 (Flat 프레임) — 리사이즈 시 파괴 후 재생성
		this.hudPanel?.destroy();
		this.hudPanel = panel(this.scene, cx - 210 * hs, 10 * hs, 420 * hs, 82 * hs, { alpha: 0.96 })
			.setScrollFactor(0).setDepth(999);
		this.hudObjDivider?.destroy();
		this.hudObjDivider = this.scene.add.image(cx, 56 * hs, 'uf-fill-dark')
			.setDisplaySize(380 * hs, 2).setAlpha(0.35).setScrollFactor(0).setDepth(1000);

		// 폰트/위치도 배율 반영
		this.timerText?.setFontSize(27 * hs).setPosition(cx, 20 * hs);
		this.killText?.setFontSize(14 * hs).setPosition(cx, 96 * hs);
		this.objectiveText?.setFontSize(15 * hs);
		this.objectiveCount?.setFontSize(15 * hs);

		// 자맥 깊이 배지 (겉맥보다 깊이 내려갔을 때만)
		this.dangerBadge?.destroy();
		this.dangerBadge = undefined;
		const danger = this.scene.dangerLevel ?? 0;
		if (danger > 0) {
			const bx = cx + 246 * hs;
			const by = 44 * hs;
			this.dangerBadge = slot(this.scene, bx, by, 52 * hs, 'red')
				.setScrollFactor(0).setDepth(999);
		}
	}

	/**
	 * 매 프레임 호출된다. setText 자체는 값 비교 가드가 있어 재렌더는 없지만,
	 * 라운드 내내 바뀌지 않는 문자열을 프레임마다 새로 만들면(템플릿 리터럴 + reduce +
	 * 객체 리터럴) 초당 300개의 단명 객체가 GC로 흘러간다 → 변경 감지 후에만 갱신.
	 */
	private lastHudRound = -1;
	private lastHudKills = -1;
	private lastHudObjective = '';
	private lastHudWidth = -1;

	updateHud(): void {
		const width = this.scene.scale.width;
		const cx = width / 2;
		const widthChanged = width !== this.lastHudWidth;
		this.lastHudWidth = width;

		if (this.round !== this.lastHudRound || widthChanged) {
			this.lastHudRound = this.round;
			this.timerText.setText(`라운드 ${Math.max(1, this.round)} / ${this.totalRounds}`);
			this.timerText.setX(cx);
		}

		// 목표 라벨 + 진행 카운트를 나란히 중앙 정렬
		const progress = this.getObjectiveParts();
		const label = this.runCompleted ? '모든 라운드 클리어' : progress.label;
		const count = this.runCompleted ? '' : progress.count;
		const signature = `${label} ${count}`;
		if (signature !== this.lastHudObjective || widthChanged) {
			this.lastHudObjective = signature;
			this.objectiveText.setText(label);
			this.objectiveCount.setText(count);
			const hs = this.hs;
			const totalWidth = this.objectiveText.width + (this.objectiveCount.text ? this.objectiveCount.width + 8 * hs : 0);
			this.objectiveText.setPosition(cx - totalWidth / 2, 70 * hs);
			this.objectiveCount.setPosition(cx - totalWidth / 2 + this.objectiveText.width + 8 * hs, 70 * hs);
		}

		if (this.killCount !== this.lastHudKills || widthChanged) {
			this.lastHudKills = this.killCount;
			this.killText.setText(`처치 ${this.killCount}`);
			this.killText.setX(cx);
		}
	}

	getObjectiveParts(): { label: string; count: string } {
		if (!this.objective) {
			return { label: '', count: '' };
		}

		// 스폰이 끝난 뒤에는 "남은 적 수"가 곧 라운드 종료 조건이다.
		// (목표 카운트가 꽉 찬 채 멈춰 있으면 "왜 안 끝나지"가 된다)
		if (this.inMopUp()) {
			return {
				label: '잔당 소탕',
				count: `( 남은 적 ${this.remainingEnemyCountCached()} )`,
			};
		}

		// 목표는 깼지만 아직 스폰 창이 열려 있다 → 스폰이 끝날 때까지 남은 시간을 보여준다.
		if (this.roundActive && this.isGoalMet() && this.roundElapsedMs < WaveSystem.SPAWN_WINDOW_MS) {
			return {
				label: '남은 웨이브',
				count: `( ${Math.ceil((WaveSystem.SPAWN_WINDOW_MS - this.roundElapsedMs) / 1000)}초 )`,
			};
		}

		switch (this.objective.type) {
			case 'kill-count':
				return {
					label: this.objective.label,
					count: `( ${Math.min(this.killsThisRound, this.objective.required!)} / ${this.objective.required} )`,
				};
			case 'kill-target': {
				const done = (this.objective.targets ?? []).reduce((sum, t) => sum + Math.min(t.kills, t.required), 0);
				const total = (this.objective.targets ?? []).reduce((sum, t) => sum + t.required, 0);
				return {
					label: this.objective.label,
					count: `( ${done} / ${total} )`,
				};
			}
			case 'survive': {
				const remaining = Math.max(0, Math.ceil((this.objective.durationMs! - this.roundElapsedMs) / 1000));
				return { label: this.objective.label, count: `( ${remaining}초 )` };
			}
			default:
				return { label: this.objective.label, count: '' };
		}
	}

	// 배너: 강판 밴드 + 깃-라인 + 담금 청 언더라인
	announce(message: string, color = '#d9a83c'): void {
		const { width, height } = this.scene.scale;
		this.activeAnnouncements = (this.activeAnnouncements ?? 0) + 1;
		const stackOffset = (this.activeAnnouncements - 1) * 78;
		const cy = height * 0.22 + stackOffset;

		const text = this.scene.add.text(0, -2, message, {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: '28px',
			fontStyle: '700',
			color,
			align: 'center',
		}).setOrigin(0.5);

		// Flat 리본 배너 (귀 달린 variant 1)
		const bannerW = Math.max(480, text.width + 160);
		const ribbon = banner(this.scene, 0, 0, bannerW, { variant: 1, h: 56 });

		// 2500: 상점 UI(dim 2300~float 2400)가 열려 있어도 REFORGE 등 배너가 가려지지 않게
		const bannerRoot = this.scene.add.container(width / 2, cy, [ribbon, text])
			.setScrollFactor(0).setDepth(2500).setAlpha(0);

		if (reduceMotion()) {
			bannerRoot.setAlpha(1);
			this.scene.time.delayedCall(1900, () => {
				bannerRoot.destroy();
				this.activeAnnouncements = Math.max(0, (this.activeAnnouncements ?? 1) - 1);
			});
			return;
		}

		this.scene.tweens.add({
			targets: bannerRoot,
			alpha: 1,
			scale: { from: 0.92, to: 1 },
			duration: 260,
			ease: 'Quad.easeOut',
			onComplete: () => {
				this.scene.tweens.add({
					targets: bannerRoot,
					alpha: 0,
					y: bannerRoot.y - 26,
					delay: 1500,
					duration: 500,
					onComplete: () => {
						bannerRoot.destroy();
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

	/** 오버레이가 열릴 때 상단 라운드 패널을 숨긴다 */
	setHudVisible(visible: boolean): void {
		this.hudG?.setVisible(visible);
		this.hudPanel?.setVisible(visible);
		this.hudObjDivider?.setVisible(visible);
		this.dangerBadge?.setVisible(visible);
		this.timerText?.setVisible(visible);
		this.objectiveText?.setVisible(visible);
		this.objectiveCount?.setVisible(visible);
		this.killText?.setVisible(visible);
	}

	destroy(): void {
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.scene.scale.off('resize', this.drawHudPanel, this);
		this.timerText?.destroy();
		this.objectiveText?.destroy();
		this.objectiveCount?.destroy();
		this.killText?.destroy();
		this.hudG?.destroy();
		this.hudPanel?.destroy();
		this.hudObjDivider?.destroy();
		this.dangerBadge?.destroy();
	}
}
