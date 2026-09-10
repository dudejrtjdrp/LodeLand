import Phaser from 'phaser';
import rawAffixCatalog from '../data/affixCatalog.json';
import type GameScene from '../scenes/GameScene';
import type { AffixDefinition, DamageType, Element, EnemyBehaviorSpec, EnemyDefinition } from '../types/catalogs';
import type { EnemyProjectile, EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';
import { enemyKnockbackForce, mitigateEnemyDamage, resistFor } from '../logic/combat';
import { EXECUTE_HP_THRESHOLD } from '../logic/statCaps';
import { traitsOf, traitsImmuneTo, traitDamageMult, getTraitById, type EnemyTrait } from '../logic/enemyTraits';
import {
	BOSS_KITS, BOSS_SKILLS, activeSkillsFor, dodgeFloorOk, skillCooldownMultForRound,
	type BossSkillDef, type BossSkillId,
} from '../logic/bossSkills';
import { screenShakeEnabled } from '../core/settings';
import { reduceMotion } from '../core/settings';
import { ENEMY_ATLAS } from '../core/textures';
import {
	enemySpeedForRound, fireIntervalMultForRound, projectileRangeMultForRound,
	projectileSpeedMultForRound, spikeTierForRound, XP_PER_KILL_MULT,
} from '../logic/roundScaling';
import { RARITY_THEME } from '../ui/theme';
import skillCatalogJson from '../data/skillCatalog.json';
import type { SkillCatalog } from '../types/catalogs';

/** 히트스톱 튜닝값 (data/skillCatalog.json) — 프레임 수는 여기서만 바꾼다. */
const HIT_STOP = (skillCatalogJson as unknown as SkillCatalog).hitStop;

const affixCatalog = rawAffixCatalog as AffixDefinition[];
/** id → 정의 조회 맵. 매 프레임 선형 find()를 피한다 (적 150+ × 어픽스 2~4개). */
const AFFIX_BY_ID = new Map<string, AffixDefinition>(affixCatalog.map((a) => [a.id, a]));

/** 보스 스킬 텔레그래프 (예고 표시 → 발동 판정 → 잔광) */
interface BossTelegraph {
	/**
	 * circle 원형 폭발 · line 직선 광선/돌진 · ring 조여드는 고리
	 * sector 부채꼴(회전 스윕) · half 반쪽 장판 · burst 탄막 발사 시점 · seal 검 봉인
	 */
	kind: 'circle' | 'line' | 'ring' | 'sector' | 'half' | 'burst' | 'seal';
	x: number;
	y: number;
	/** circle: 반경 / line: 광선 폭의 절반 / ring: 시작(바깥) 반경 / sector·half: 사거리 */
	radius: number;
	x2?: number;
	y2?: number;
	/** ring(전방위 조임): 다 조여든 뒤의 반경 — 이 안에 남으면 맞는다 */
	innerRadius?: number;
	/** ring: 안전한 틈의 중심 각도(라디안) */
	gapAngle?: number;
	/** ring: 안전한 틈의 반각(라디안) / sector: 부채꼴 반각 */
	gapHalf?: number;
	/** sector: 부채꼴 중심각 / half: 위험한 절반의 법선 방향 / burst: 발사 기준각 */
	angle?: number;
	/** half: 경계선에서 이만큼 넘어가야 안전 (제자리 = 피격) */
	margin?: number;
	/** burst: 이번 발사에서 나가는 탄 수 */
	bullets?: number;
	/** burst: 탄 사이 각도 간격(라디안) */
	bulletSpread?: number;
	/** burst: 탄속(px/s) */
	bulletSpeed?: number;
	/** seal: 봉인 지속(ms) / seal: 봉인할 검 수 */
	sealMs?: number;
	sealCount?: number;
	/** line(rush): 발동 시 시전자가 이 속도로 이 시간만큼 돌진한다 */
	dashSpeed?: number;
	dashMs?: number;
	/** 발동 시 이어서 시전할 스킬 (연속 패턴: 균열 지뢰 2단·삼연 돌진·낙하 연타) */
	chain?: BossSkillId;
	/** 이어서 시전할 때의 단계 번호 */
	chainStep?: number;
	bornAt: number;
	fireAt: number;
	damagePctMaxHp: number;
	skillName: string;
	caster: EnemySprite;
	casterGen: number;
	fired: boolean;
}

/** 독 장판 등 바닥 위험 지대 */
interface GroundHazard {
	x: number;
	y: number;
	radius: number;
	until: number;
	dps: number;
	tickAcc: number;
	zone: Phaser.GameObjects.Arc;
}

/**
 * 장막 지대 (결집 사수의 동료 — 장막 소환수가 깐다).
 * 안에 있는 **적**이 받는 피해를 줄인다. 플레이어에게는 피해가 없다 —
 * 압박은 "화력이 안 통한다"는 형태로 온다. 끊는 법: 시전자를 지목해 처치.
 */
interface DamageVeil {
	x: number;
	y: number;
	radius: number;
	until: number;
	/** 안의 적이 받는 피해 배율 (0.45 = 55% 감소) */
	damageMult: number;
	owner: EnemySprite;
	ownerGen: number;
	/** 다음 fx 맥동 시각 — 공유 FX 레이어만 쓴다 (add.circle + 트윈 금지) */
	nextPulseAt: number;
}

/** Pool entries handed to setSpawnProfile (weight defaults to 1 when omitted). */
interface SpawnPoolEntry {
	id: string;
	weight?: number;
}

interface SpawnProfileOptions {
	spawnIntervalMs?: number;
	pool?: SpawnPoolEntry[];
	minAlive?: number;
}

interface EnemyManagerOptions {
	maxEnemies?: number;
	hp?: number;
	speed?: number;
	damage?: number;
	xpOrbValue?: number;
	spawnDistance?: number;
	spawnInterval?: number;
	minimumSpawnInterval?: number;
	spawnIntervalStep?: number;
	maxBurstPerFrame?: number;
	hpMult?: number;
	damageMult?: number;
	enemyCatalog?: EnemyDefinition[];
}

interface TakeDamageOptions {
	silent?: boolean;
	ignoreResist?: boolean;
	damageType?: DamageType;
	pen?: number;
	/** 때린 검의 원소 — 적 특성(몸체) 약점/저항 상성 배율에 쓰인다. */
	element?: Element;
}

/**
 * Enemies managed by this system always have their behavior timers initialized
 * in spawnEnemy, so they are non-optional here.
 */
type ManagedEnemy = EnemySprite & {
	fireTimer: number;
	healTimer: number;
	fuseStartedAt: number;
	dotUntil: number;
	dotDps: number;
	dotTick: number;
	slowUntil: number;
	slowFactor: number;
};

/** `expiresAt`/`glow` are missing from the shared EnemyProjectile type; extended locally. */
type ManagedProjectile = EnemyProjectile & {
	expiresAt?: number;
	/** 가시성용 가산 블렌드 글로우 (투사체와 함께 풀링) */
	glow?: Phaser.GameObjects.Image;
};

export default class EnemyManager {
	scene: GameScene;
	enemies: Phaser.Physics.Arcade.Group;
	enemyHp: number;
	enemySpeed: number;
	enemyDamage: number;
	xpOrbValue: number;
	spawnDistance: number;
	spawnInterval: number;
	minimumSpawnInterval: number;
	spawnIntervalStep: number;
	spawnTimer: number;
	nextSpawnInterval: number;
	totalSpawned: number;
	enemyCatalog: EnemyDefinition[];
	spawnPool: SpawnPoolEntry[] | null;
	minAlive: number;
	maxBurstPerFrame: number;
	hpMult: number;
	damageMult: number;
	/** 숫자 인플레이션 성장 배율 (logic/growth.ts) — WaveSystem.startRound 가 라운드마다 갱신 */
	growthHpMult = 1;
	growthDamageMult = 1;
	projectiles: Phaser.Physics.Arcade.Group;
	// 아래 둘은 생성자의 setRound(1) 이 실제 값을 채운다. TS 는 메서드 호출을 통한 할당을
	// 확정 할당으로 보지 않으므로 선언부에 기본값을 준다.
	/** 현재 라운드 (WaveSystem이 설정) — 어픽스 개수/종류 결정 */
	currentRound = 1;
	/** 일반 몹 어픽스 예산: [보장 개수, 추가 확률로 얻는 최대 개수] */
	affixBudget: { guaranteed: number; bonusChance: number; max: number } = { guaranteed: 0, bonusChance: 0, max: 0 };
	hazards: GroundHazard[];
	/** 장막 지대 (장막 소환수) — 최대 VEIL_MAX 개, 시전자가 죽으면 즉시 걷힌다 */
	veils: DamageVeil[] = [];
	private static readonly VEIL_MAX = 6;
	/** 보스 피격 히트스톱 전용 간격 — 검 7자루가 쉬지 않고 때리므로 따로 제한한다 */
	private lastBossHitStopAt = -Infinity;
	/** 보스/중간보스는 잡몹보다 HP 스케일을 완만하게 (hpMult^지수) */
	bossHpExponent: number;
	minibossHpExponent: number;
	/** 라운드 후반 내구성: 스폰 시 물리/마법 저항에 더해지는 보너스 (WaveSystem 설정) */
	resistBonus = 0;
	/** 현재 라운드에서 뽑을 수 있는 어픽스 (setRound에서만 재계산 — 스폰마다 filter 방지) */
	private eligibleAffixes: AffixDefinition[] = [];
	/** rollAffixes 재사용 버퍼 (스폰 버스트마다 배열 할당 방지) */
	private readonly affixPickBuffer: AffixDefinition[] = [];
	/** 사망 후 지연 회수 대기열 — delayedCall 남발 대신 FIFO로 처리 */
	private readonly deathQueue: Array<{ enemy: EnemySprite; generation: number; at: number }> = [];
	/** 폭발 스프라이트 풀 (폭발마다 add.sprite/destroy 하던 것을 순환 재사용) */
	private explosionPool: Phaser.GameObjects.Sprite[] = [];
	private explosionCursor = 0;

	// --- 공간 분할 그리드 -------------------------------------------------
	// 반경 질의(검 타겟 스캔, 관통/연쇄/폭발, 오라, 힐)가 전부 적 176슬롯을 전수 순회하고
	// 있었다. 프레임당 1회만 그리드를 재구축하고, 질의는 반경이 덮는 셀만 훑는다.
	/** 셀 한 변의 길이(px). 대부분의 질의 반경(90~260)이 2~5개 셀로 덮인다. */
	private static readonly GRID_CELL = 128;
	/** 셀 키(정수) → cellBuckets 인덱스 */
	private readonly gridIndex = new Map<number, number>();
	/** 셀별 적 목록. 배열 자체는 재사용하고 length=0으로만 비운다 (할당 0). */
	private readonly cellBuckets: EnemySprite[][] = [];
	private gridBucketCount = 0;
	/** 그리드가 유효한 프레임 시각. 스폰/사망 직후 질의도 같은 프레임 스냅샷을 쓴다. */
	private gridBuiltAt = -1;
	/** 호출부별 전용 질의 버퍼 (중첩 질의 안전 + 프레임당 할당 0) */
	private readonly auraQueryBuffer: EnemySprite[] = [];
	private readonly healQueryBuffer: EnemySprite[] = [];

	constructor(scene: GameScene, options: EnemyManagerOptions = {}) {
		this.scene = scene;
		this.enemies = scene.physics.add.group({ maxSize: options.maxEnemies ?? 176 });
		// setRound 를 거치지 않아도 어픽스 후보 캐시가 비어 있지 않도록 여기서 초기화한다
		// (캐시가 비면 rollAffixes 가 조용히 빈 배열을 돌려줘 어픽스가 통째로 사라진다).
		this.setRound(1);
		this.hazards = [];
		// 폴백값 — 실제로는 WaveSystem.startRound 가 waveTable.scaling 에서 덮어쓴다.
		// 0.95/0.9 (2026-09-02): 0.7/0.8 시절에는 라운드가 오를수록 보스 체력이 키퍼 화력에
		// 뒤처져 15라 이후 보스가 3초 만에 녹았다 (balance-sim bossTtkSec 21s → 2.4s).
		// 패턴을 4~6종 쓰게 하려면 보스가 그만큼 살아 있어야 한다.
		this.bossHpExponent = 0.95;
		this.minibossHpExponent = 0.9;
		this.enemyHp = options.hp ?? 30;
		this.enemySpeed = options.speed ?? 80;
		this.enemyDamage = options.damage ?? 10;
		this.xpOrbValue = options.xpOrbValue ?? 25;
		this.spawnDistance = options.spawnDistance ?? 600;
		this.spawnInterval = options.spawnInterval ?? 2000;
		this.minimumSpawnInterval = options.minimumSpawnInterval ?? 600;
		this.spawnIntervalStep = options.spawnIntervalStep ?? 100;
		this.spawnTimer = 0;
		this.nextSpawnInterval = this.spawnInterval;
		this.totalSpawned = 0;
		this.enemyCatalog = Array.isArray(options.enemyCatalog) ? options.enemyCatalog : [];
		this.spawnPool = null;
		this.minAlive = 0;
		this.maxBurstPerFrame = options.maxBurstPerFrame ?? 4;
		this.hpMult = options.hpMult ?? 1;
		this.damageMult = options.damageMult ?? 1;
		this.growthHpMult = 1;
		this.growthDamageMult = 1;
		this.projectiles = scene.physics.add.group({ maxSize: 128 });
	}

	// ---------------------------------------------------------------
	// Affixes — 스폰 시 조합되는 변형 패턴 (affixCatalog.json)
	// ---------------------------------------------------------------

	/** 지금 라운드에서 등장 가능한 어픽스 종류 수 (런 기록 텔레메트리가 읽는다) */
	get affixPoolSize(): number {
		return this.eligibleAffixes.length;
	}

	/**
	 * 거리를 좁혀 때리는 계열인가 (= 라운드 속도 하한을 받는 대상).
	 * 원거리/투척/힐러/소환사/장막은 원래 접근하지 않는 것이 설계라 제외한다.
	 */
	private static readonly RANGED_BEHAVIORS = new Set(['ranged', 'volley', 'veil', 'summoner', 'aura', 'healer']);

	static isMeleeBehavior(behavior?: EnemyBehaviorSpec | null): boolean {
		const type = behavior?.type;
		return !type || !EnemyManager.RANGED_BEHAVIORS.has(type);
	}

	/**
	 * WaveSystem이 라운드 시작마다 호출: 어픽스 예산 갱신.
	 * 예산 구간을 계단식 파워 스파이크 경계(10/20/30/40/50)에 맞췄다 (2026-09-02) —
	 * 스탯만 뛰는 것이 아니라 **새 패시브 조합**이 같이 등장해야 "확 세졌다"가 읽힌다.
	 */
	setRound(round: number): void {
		this.currentRound = round;
		// 라운드가 바뀔 때만 후보를 추린다 (스폰마다 23종 filter 하던 것을 제거)
		this.eligibleAffixes = affixCatalog.filter((a) => a.minRound <= round);
		if (round < 6) {
			this.affixBudget = { guaranteed: 0, bonusChance: 0, max: 0 };
			return;
		}
		// 스파이크 단계 0(6~9라) → 10(100라+). 계단마다 "보장 어픽스"나 "추가 확률"
		// 중 하나만 올린다 — 둘을 같이 올리면 한 계단에서 체감이 두 배로 튄다.
		const budgets: Array<{ guaranteed: number; bonusChance: number; max: number }> = [
			{ guaranteed: 0, bonusChance: 0.35, max: 1 },  // 6~9라
			{ guaranteed: 1, bonusChance: 0.35, max: 2 },  // 10~19라 (1단계)
			{ guaranteed: 1, bonusChance: 0.60, max: 3 },  // 20~29라 (2단계)
			{ guaranteed: 2, bonusChance: 0.45, max: 3 },  // 30~39라 (3단계)
			{ guaranteed: 2, bonusChance: 0.65, max: 4 },  // 40~49라 (4단계)
			{ guaranteed: 3, bonusChance: 0.60, max: 4 },  // 50~59라 (5단계)
			{ guaranteed: 3, bonusChance: 0.75, max: 5 },  // 60~69라 (6단계)
			{ guaranteed: 4, bonusChance: 0.55, max: 5 },  // 70~79라 (7단계)
			{ guaranteed: 4, bonusChance: 0.70, max: 5 },  // 80~89라 (8단계)
			{ guaranteed: 4, bonusChance: 0.85, max: 6 },  // 90~99라 (9단계)
			{ guaranteed: 5, bonusChance: 0.70, max: 6 },  // 100라+  (10단계)
		];
		this.affixBudget = budgets[spikeTierForRound(round)] ?? budgets[budgets.length - 1];
	}

	getAffixById(id: string): AffixDefinition | null {
		return AFFIX_BY_ID.get(id) ?? null;
	}

	// ---------------------------------------------------------------
	// 특성(몸체·기질) — 원소 약점/저항·CC 면역 (src/logic/enemyTraits.ts)
	// ---------------------------------------------------------------

	/** 적 타입별 특성 객체 캐시 — 스폰/피해 핫패스에서 id 조회를 반복하지 않는다 */
	private traitCache = new Map<string, EnemyTrait[]>();

	traitsForConfig(config: Partial<EnemyDefinition>): EnemyTrait[] {
		const id = config.id ?? '';
		let traits = this.traitCache.get(id);
		if (!traits) {
			traits = traitsOf(config as EnemyDefinition);
			this.traitCache.set(id, traits);
		}
		return traits;
	}

	/** 페이즈 보스의 형태별 특성 오버라이드 (탈각하는 것 — applyBossPhase 가 세팅) */
	private overrideTraits = new WeakMap<EnemySprite, EnemyTrait[]>();

	/** 이 개체에 지금 적용 중인 특성 목록 (페이즈 오버라이드 우선) — 보스바/정찰도 사용 */
	currentTraitsOf(enemy: EnemySprite): EnemyTrait[] {
		const override = this.overrideTraits.get(enemy);
		if (override) {
			return override;
		}
		return enemy.catalog ? this.traitsForConfig(enemy.catalog) : [];
	}

	/** 원소 검이 이 적을 때릴 때의 특성 상성 배율 (1 = 상성 없음) */
	traitMultFor(enemy: EnemySprite, element: Element): number {
		if (!enemy.traitIds?.length) {
			return 1;
		}
		return traitDamageMult(this.currentTraitsOf(enemy), element);
	}

	/** 라운드 예산에 따라 무작위 어픽스 id 목록을 굴린다 (중복 없음) */
	rollAffixes(config: Partial<EnemyDefinition>): AffixDefinition[] {
		// 리퍼/최약체 잡몹(swarmling 등 xp 15 미만)은 어픽스 없음
		if (config.isReaper || (config.xpValue ?? 0) < 15) {
			return [];
		}

		const { guaranteed, bonusChance, max } = this.affixBudget;
		let count = guaranteed;
		while (count < max && Math.random() < bonusChance) {
			count += 1;
		}
		// 엘리트/중간보스/보스는 후반부에 어픽스 1개 추가로 개성 강화
		if ((config.isElite || config.isMiniboss) && this.currentRound >= 15) {
			count += 1;
		}
		if (config.isBoss && this.currentRound >= 25) {
			count += 1;
		}
		if (count <= 0) {
			return [];
		}

		// 후보는 setRound에서 캐시된 배열을 그대로 쓰고, 뽑을 때마다 pool을 새로 만드는 대신
		// 이미 뽑힌 항목의 weight만 총합에서 차감한다 (스폰 버스트당 배열 할당 0).
		const eligible = this.eligibleAffixes;
		if (eligible.length === 0) {
			return [];
		}
		const picked = this.affixPickBuffer;
		picked.length = 0;
		let remainingWeight = 0;
		for (const affix of eligible) {
			remainingWeight += affix.weight;
		}
		for (let i = 0; i < count && picked.length < eligible.length; i += 1) {
			if (remainingWeight <= 0) {
				break;
			}
			let roll = Math.random() * remainingWeight;
			for (const affix of eligible) {
				if (picked.includes(affix)) {
					continue;
				}
				roll -= affix.weight;
				if (roll <= 0) {
					picked.push(affix);
					remainingWeight -= affix.weight;
					break;
				}
			}
		}
		return picked.slice();
	}

	// ---------------------------------------------------------------
	// Spatial grid — 반경 질의를 전수 순회에서 인접 셀 순회로 바꾼다
	// ---------------------------------------------------------------

	private static cellKey(cx: number, cy: number): number {
		// 좌표는 음수가 될 수 있으므로 오프셋을 더해 양수 정수 키로 만든다.
		return ((cy + 4096) << 13) | ((cx + 4096) & 0x1fff);
	}

	/** 적 하나를 현재 좌표의 셀에 넣는다. */
	private insertIntoGrid(enemy: EnemySprite): void {
		const cell = EnemyManager.GRID_CELL;
		const key = EnemyManager.cellKey(Math.floor(enemy.x / cell), Math.floor(enemy.y / cell));
		let index = this.gridIndex.get(key);
		if (index === undefined) {
			index = this.gridBucketCount;
			this.gridBucketCount += 1;
			if (!this.cellBuckets[index]) {
				this.cellBuckets[index] = [];
			}
			this.gridIndex.set(key, index);
		}
		this.cellBuckets[index].push(enemy);
	}

	/**
	 * 프레임당 1회 그리드 재구축. update()가 적 루프에 들어가기 전에 호출한다.
	 * 프레임 도중에 스폰된 적은 spawnEnemy가 곧바로 grid에 넣으므로, 같은 프레임에
	 * 발생하는 연쇄/폭발/파동 질의에서도 빠지지 않는다.
	 */
	rebuildSpatialGrid(now: number): void {
		this.gridIndex.clear();
		for (let i = 0; i < this.gridBucketCount; i += 1) {
			this.cellBuckets[i].length = 0;
		}
		this.gridBucketCount = 0;

		for (const enemy of this.enemies.getChildren() as EnemySprite[]) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}
			this.insertIntoGrid(enemy);
		}
		this.gridBuiltAt = now;
	}

	/**
	 * (x, y) 반경 안에 있을 수 있는 적을 `out`에 채워 반환한다.
	 * 셀 경계 때문에 반경 밖 적이 섞일 수 있으니 호출자가 거리 제곱을 다시 확인해야 한다.
	 * 버퍼를 호출자가 소유하므로 피해 처리 중 발생하는 중첩 질의(연쇄 폭발 등)에도 안전하다.
	 * 그리드가 아직 만들어지지 않은 프레임(스폰 전 등)에는 전체 목록으로 폴백한다.
	 */
	queryRadius(x: number, y: number, radius: number, out: EnemySprite[]): EnemySprite[] {
		out.length = 0;
		if (this.gridBuiltAt < 0) {
			for (const enemy of this.enemies.getChildren() as EnemySprite[]) {
				if (this.isAliveEnemy(enemy)) {
					out.push(enemy);
				}
			}
			return out;
		}

		// 그리드는 프레임 시작 시점의 스냅샷이라 적이 그 뒤로 조금 움직였을 수 있고,
		// 점멸(blink) 어픽스는 한 번에 170px까지 순간이동한다. 셀 한 칸만큼 여유를 둬서
		// 살짝 낡은 좌표 때문에 대상을 놓치지 않게 한다.
		const cell = EnemyManager.GRID_CELL;
		const margin = radius + cell;
		const minCx = Math.floor((x - margin) / cell);
		const maxCx = Math.floor((x + margin) / cell);
		const minCy = Math.floor((y - margin) / cell);
		const maxCy = Math.floor((y + margin) / cell);

		for (let cy = minCy; cy <= maxCy; cy += 1) {
			for (let cx = minCx; cx <= maxCx; cx += 1) {
				const index = this.gridIndex.get(EnemyManager.cellKey(cx, cy));
				if (index === undefined) {
					continue;
				}
				const bucket = this.cellBuckets[index];
				for (let i = 0; i < bucket.length; i += 1) {
					out.push(bucket[i]);
				}
			}
		}
		return out;
	}

	/** 어픽스 스탯/특수효과를 스폰 직후의 적에게 적용 */
	applyAffixes(enemy: ManagedEnemy, affixes: AffixDefinition[]): void {
		if (affixes.length === 0) {
			return;
		}

		let sizeMult = 1;
		const prefixes: string[] = [];

		for (const affix of affixes) {
			prefixes.push(affix.name);
			enemy.hp = Math.round(enemy.hp * (affix.hpMult ?? 1));
			enemy.damage = Math.round(enemy.damage * (affix.damageMult ?? 1));
			enemy.speed = (enemy.speed ?? this.enemySpeed) * (affix.speedMult ?? 1);
			enemy.xpValue = Math.round((enemy.xpValue ?? 0) * (affix.xpMult ?? 1));
			sizeMult *= affix.sizeMult ?? 1;
			enemy.knockbackResist = Math.min(1, (enemy.knockbackResist ?? 0) + (affix.knockbackResistAdd ?? 0));
			enemy.physicalResist = Math.min(0.85, (enemy.physicalResist ?? 0) + (affix.physicalResistAdd ?? 0));
			enemy.magicResist = Math.min(0.85, (enemy.magicResist ?? 0) + (affix.magicResistAdd ?? 0));

			switch (affix.special) {
				case 'regen':
					enemy.regenPerSec = Math.max(enemy.regenPerSec ?? 0, affix.regenPercentPerSec ?? 0.03);
					break;
				case 'deathExplode':
					enemy.deathExplodeRadius = affix.explodeRadius ?? 130;
					enemy.deathExplodeDamage = Math.round(enemy.damage * (affix.explodeDamageMult ?? 1.2));
					break;
				case 'mitosis':
					enemy.mitosis = true;
					break;
				case 'deathPool':
					enemy.deathPool = {
						radius: affix.poolRadius ?? 95,
						durationMs: affix.poolDurationMs ?? 3200,
						dps: affix.poolDps ?? 14,
					};
					break;
				case 'shield':
					enemy.shieldHits = (enemy.shieldHits ?? 0) + (affix.shieldHits ?? 5);
					break;
				case 'blink':
					enemy.blinkIntervalMs = affix.blinkIntervalMs ?? 2400;
					enemy.blinkRange = affix.blinkRange ?? 170;
					break;
				case 'summon':
					enemy.summonId = affix.summonId ?? 'swarmling';
					enemy.summonCount = affix.summonCount ?? 2;
					enemy.summonIntervalMs = affix.summonIntervalMs ?? 4500;
					break;
				case 'aura':
					enemy.auraRadius = Math.max(enemy.auraRadius ?? 0, affix.auraRadius ?? 240);
					enemy.auraDamageMult = Math.max(enemy.auraDamageMult ?? 1, affix.auraDamageMult ?? 1.3);
					enemy.auraSpeedMult = Math.max(enemy.auraSpeedMult ?? 1, affix.auraSpeedMult ?? 1.15);
					break;
				case 'frenzy':
					enemy.frenzyThreshold = affix.frenzyThreshold ?? 0.4;
					enemy.frenzySpeedMult = affix.frenzySpeedMult ?? 1.6;
					enemy.frenzyDamageMult = affix.frenzyDamageMult ?? 1.4;
					break;
				case 'thorns':
					enemy.thornChance = affix.thornChance ?? 0.22;
					enemy.thornDamageMult = affix.thornDamageMult ?? 0.5;
					break;
				case 'accelerate':
					enemy.accelPerSec = affix.accelPerSec ?? 0.04;
					enemy.accelMax = affix.accelMax ?? 1.8;
					break;
				case 'vampiric':
					enemy.vampiricHealMult = affix.vampiricHealMult ?? 3;
					break;
				case 'purge':
					enemy.slowImmune = true;
					enemy.dotImmune = true; // juggernaut: 감속·지속 피해 모두 정화
					enemy.affixPurge = true; // 페이즈 전환으로 특성이 갈려도 유지
					break;
				case 'dodge':
					enemy.dodgeChance = Math.max(enemy.dodgeChance ?? 0, affix.dodgeChance ?? 0.3);
					break;
				default:
					break;
			}
		}

		enemy.maxHp = enemy.hp;
		enemy.affixIds = affixes.map((a) => a.id);
		// hasty 계열 배수는 스폰 후 변하지 않는다 — 매 프레임 재계산 대신 여기서 1회 고정.
		// 라운드 스케일은 스폰 리셋에서 이미 들어가 있으므로 **곱한다** (덮어쓰지 말 것 —
		// applyAffixes 는 어픽스가 0개면 위에서 early return 하므로 여기서 대입하면
		// 어픽스 없는 개체만 라운드 스케일을 못 받는다).
		let fireMult = enemy.fireIntervalMult ?? 1;
		for (const affix of affixes) {
			if (affix.fireIntervalMult) {
				fireMult *= affix.fireIntervalMult;
			}
		}
		enemy.fireIntervalMult = fireMult;
		enemy.enemyName = `${prefixes.join(' ')} ${enemy.enemyName ?? 'Enemy'}`;

		if (sizeMult !== 1) {
			enemy.setDisplaySize(enemy.displayWidth * sizeMult, enemy.displayHeight * sizeMult);
		}

		// 어픽스 틴트: 태생 틴트가 없거나 일반 몹이면 첫 어픽스 색으로 표시
		const tinted = affixes.find((a) => a.tint);
		if (tinted?.tint && !enemy.catalog?.isBoss && !enemy.catalog?.isMiniboss && !enemy.catalog?.isElite) {
			const color = Phaser.Display.Color.HexStringToColor(tinted.tint).color;
			enemy.setTint(color);
			// 처치 파편도 같은 색으로 튄다 — 어떤 어픽스였는지가 죽는 순간에도 읽힌다
			enemy.affixTintColor = color;
		}
	}

	setSpawnProfile({ spawnIntervalMs, pool, minAlive }: SpawnProfileOptions = {}): void {
		if (typeof spawnIntervalMs === 'number') {
			this.nextSpawnInterval = spawnIntervalMs;
			this.spawnIntervalStep = 0;
		}

		if (Array.isArray(pool)) {
			this.spawnPool = pool;
		}

		if (typeof minAlive === 'number') {
			this.minAlive = minAlive;
		}
	}

	getEnemyTypeById(id: string): EnemyDefinition | null {
		return this.enemyCatalog.find((entry) => entry.id === id) ?? null;
	}

	pickFromSpawnPool(): EnemyDefinition | null {
		if (!Array.isArray(this.spawnPool) || this.spawnPool.length === 0) {
			return this.getRandomEnemyType();
		}

		const totalWeight = this.spawnPool.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
		let roll = Math.random() * totalWeight;

		for (const entry of this.spawnPool) {
			roll -= entry.weight ?? 1;
			if (roll <= 0) {
				return this.getEnemyTypeById(entry.id) ?? this.getRandomEnemyType();
			}
		}

		return this.getRandomEnemyType();
	}

	getRandomEnemyType(): EnemyDefinition | null {
		if (!this.enemyCatalog.length) {
			return null;
		}
		return this.enemyCatalog[Math.floor(Math.random() * this.enemyCatalog.length)];
	}

	spawnEnemy(
		scene: GameScene = this.scene,
		player?: PlayerSprite,
		typeId: string | null = null,
		positionOverride: { x: number; y: number } | null = null,
	): ManagedEnemy | false {
		if (!scene || !player) {
			return false;
		}

		const position = positionOverride ?? this.getSpawnPosition(scene, player);
		let enemy = this.enemies.getFirstDead(false) as ManagedEnemy | null;

		// Get enemy type: explicit id > weighted wave pool > random catalog entry
		const enemyType = (typeId ? this.getEnemyTypeById(typeId) : this.pickFromSpawnPool()) ?? ({} as Partial<EnemyDefinition>);
		const config = enemyType ?? {};

		// 적 스프라이트는 전부 통합 아틀라스(ENEMY_ATLAS) 한 장을 쓴다 — 텍스처가 하나라
		// 화면에 여러 종류가 섞여도 WebGL 배치가 끊기지 않는다. 카탈로그의 textureKey 는
		// 이제 아틀라스 안의 **프레임 접두사**다 (`ts-red-warrior/0`).
		const sheetKey = config.spriteType === 'aseprite'
			? config.spritesheet?.textureKey
			: config.spritesheets?.idle?.textureKey;
		let textureKey = ENEMY_ATLAS;
		let frameName: string | number = `${sheetKey}/0`;
		// 아틀라스에 없는 적(플레이스홀더)은 기존 폴백 텍스처로
		if (!sheetKey || !this.scene?.textures?.getFrame(ENEMY_ATLAS, frameName)) {
			textureKey = 'enemy';
			frameName = 0;
		}

		if (!enemy) {
			enemy = this.enemies.create(position.x, position.y, textureKey, frameName) as ManagedEnemy | null;
		} else {
			enemy.setTexture(textureKey, frameName);
			// Guard: stop() emits an event that reads currentFrame - crash if none.
			if (enemy.anims?.currentFrame) {
				enemy.anims.stop();
			}
		}

		if (!enemy) {
			return false;
		}

		enemy.enableBody?.(true, position.x, position.y, true, true);
		enemy.setDepth(1);
		enemy.setCollideWorldBounds(false);
		enemy.setActive(true);
		enemy.setVisible(true);
		// 보스/중간보스는 기본 HP가 크므로 라운드 스케일을 완만하게 적용
		let hpScale = this.hpMult;
		if (config.isBoss) {
			hpScale = Math.pow(Math.max(1, this.hpMult), this.bossHpExponent);
		} else if (config.isMiniboss || config.isElite) {
			hpScale = Math.pow(Math.max(1, this.hpMult), this.minibossHpExponent);
		}
		// 숫자 인플레이션 성장(logic/growth.ts) — 종류 지수 바깥에 곱한다 (roundScaling.enemyHpScaleForRound 와 동일)
		hpScale *= this.growthHpMult;
		enemy.hp = Math.round((config.hp ?? this.enemyHp) * hpScale);
		enemy.maxHp = enemy.hp;
		// 라운드 이동속도 스케일 — 키퍼 이동속도(350)에 견줘 근접적(45~175)이 너무 느려
		// 22라 이후 "적이 다가오지도 못한다"가 되던 문제. 보스는 패턴 타이밍이 얽혀 있어 제외.
		enemy.speed = config.isBoss
			? (config.speed ?? this.enemySpeed)
			: enemySpeedForRound(
				config.speed ?? this.enemySpeed,
				this.currentRound,
				EnemyManager.isMeleeBehavior(config.behavior as EnemyBehaviorSpec | undefined),
			);
		// 원거리 압박 스케일 (2026-09-06) — 사거리·탄속·발사 주기도 라운드를 탄다.
		// 전부 상한이 있다 (logic/roundScaling): 탄속이 키퍼 이동속도를 크게 넘으면 회피가
		// 불가능해지고, 발사 주기가 너무 짧아지면 탄막이 화면을 덮는다.
		// 핫패스 규약 — 매 프레임이 아니라 스폰 시 1회만 계산해 캐시한다.
		enemy.rangeMult = config.isBoss ? 1 : projectileRangeMultForRound(this.currentRound);
		enemy.projectileSpeedMult = config.isBoss ? 1 : projectileSpeedMultForRound(this.currentRound);
		enemy.damage = Math.round((config.damage ?? this.enemyDamage) * this.totalDamageMult());
		enemy.enemyType = config.id ?? 'default';
		enemy.enemyName = config.name ?? 'Enemy';
		// 적 수를 줄인 만큼 처치당 경험치 보정 (logic/roundScaling.XP_PER_KILL_MULT)
		enemy.xpValue = Math.round((config.xpValue ?? this.xpOrbValue) * XP_PER_KILL_MULT);
		enemy.critChance = config.critChance ?? 0;
		enemy.critDamageMultiplier = config.critDamageMultiplier ?? 1.0;
		enemy.spriteType = config.spriteType ?? 'placeholder';
		enemy.catalog = config as EnemyDefinition; // Store full config for later animation access
		enemy.knockbackUntil = 0;
		enemy.knockbackResist = config.knockbackResist ?? 0;
		enemy.healthBarWidth = config.healthBarWidth ?? 40;
		enemy.isDying = false;
		enemy.spawnGeneration = (enemy.spawnGeneration ?? 0) + 1;
		enemy.behavior = (config.behavior ?? null) as EnemyBehaviorSpec | undefined;
		// 라운드 후반 내구성 보너스 저항 합산 (상한 0.85 — 완전 면역 방지)
		enemy.physicalResist = Math.min(0.85, (config.physicalResist ?? 0) + this.resistBonus);
		enemy.magicResist = Math.min(0.85, (config.magicResist ?? 0) + this.resistBonus);
		enemy.splitInto = (config.splitInto ?? null) as EnemySprite['splitInto'];
		enemy.fireTimer = Phaser.Math.Between(0, 800);
		enemy.healTimer = 0;
		enemy.fuseStartedAt = 0;
		enemy.dotUntil = 0;
		enemy.dotDps = 0;
		enemy.dotTick = 0;
		enemy.dotColor = null as unknown as number;
		enemy.slowUntil = 0;
		enemy.slowFactor = 1;

		// 원소 세트 상태이상 리셋 (풀 재사용 시 이전 개체의 감전/출혈/빙결이 새어나가지 않도록)
		enemy.setShockUntil = 0;
		enemy.setBleedUntil = 0;
		enemy.setBleedDps = 0;
		enemy.setBleedTick = 0;
		enemy.setFrozenUntil = 0;
		enemy.setSlowStacks = 0;
		enemy.setSlowStackAt = 0;
		enemy.setPoisonStacks = 0;
		enemy.setPoisonStackAt = 0;
		enemy.setWindHitAt = 0;
		// 상태이상 표시 캐시 (이전 개체의 색·오버레이 위상이 새어나가지 않게)
		this.scene?.statusEffects?.resetEnemy(enemy);

		// 어픽스/신규 행동 런타임 상태 리셋 (풀 재사용 대비 전부 초기화)
		enemy.affixIds = [];
		enemy.regenPerSec = 0;
		enemy.regenAcc = 0;
		enemy.shieldHits = 0;
		enemy.dodgeChance = 0;
		enemy.slowImmune = false;
		enemy.dotImmune = false;
		enemy.weakTextAt = 0;
		enemy.phaseIndex = undefined;
		enemy.affixPurge = false;
		this.overrideTraits.delete(enemy);
		enemy.vampiricHealMult = 0;
		enemy.thornChance = 0;
		enemy.thornDamageMult = 0;
		enemy.frenzyThreshold = 0;
		enemy.frenzied = false;
		enemy.accelPerSec = 0;
		enemy.accelMax = 1;
		enemy.accelFactor = 1;
		enemy.deathExplodeRadius = 0;
		enemy.deathExplodeDamage = 0;
		enemy.deathPool = null;
		enemy.affixTintColor = undefined;
		enemy.mitosis = false;
		enemy.blinkTimer = 0;
		enemy.blinkIntervalMs = 0;
		enemy.blinkRange = 0;
		enemy.summonTimer = 0;
		enemy.summonId = undefined;
		enemy.summonCount = 0;
		enemy.summonIntervalMs = 0;
		enemy.auraTimer = 0;
		enemy.auraRadius = 0;
		enemy.auraDamageMult = 1;
		enemy.auraSpeedMult = 1;
		enemy.auraBuffUntil = 0;
		enemy.chargePhase = 'approach';
		enemy.chargePhaseUntil = 0;
		enemy.chargeAngle = 0;
		enemy.flashUntil = 0;
		// 라운드가 오를수록 더 자주 쏜다 (하한 있음 — logic/roundScaling.fireIntervalFloor).
		// applyAffixes 가 이 값에 어픽스 배수를 곱한다.
		enemy.fireIntervalMult = fireIntervalMultForRound(this.currentRound);
		enemy.veilTextAt = 0;
		// 살포/장막 첫 발동을 스폰 시각으로 분산 (여러 마리가 한 프레임에 몰리지 않게).
		// 등장 직후 즉시 발사되지 않도록 주기의 절반 이하에서 시작한다.
		enemy.volleyTimer = Phaser.Math.Between(0, 900);
		enemy.veilTimer = Phaser.Math.Between(0, 1200);
		// 오라/힐 틱을 스폰 시각으로 분산 — 여러 시전자의 전체 순회가 한 프레임에 몰리지 않게
		enemy.auraTimer = Phaser.Math.Between(0, 880);
		enemy.healTimer = Phaser.Math.Between(0, 900);

		// behavior 스펙에서 blink/summon/aura 파라미터 흡수 (신규 행동 타입)
		const behaviorSpec = config.behavior as EnemyBehaviorSpec | undefined;
		if (behaviorSpec?.type === 'blinker') {
			enemy.blinkIntervalMs = behaviorSpec.blinkIntervalMs ?? 2600;
			enemy.blinkRange = behaviorSpec.blinkRange ?? 190;
		}
		if (behaviorSpec?.type === 'summoner') {
			enemy.summonId = behaviorSpec.summonId ?? 'swarmling';
			enemy.summonCount = behaviorSpec.summonCount ?? 2;
			enemy.summonIntervalMs = behaviorSpec.summonIntervalMs ?? 4200;
		}
		if (behaviorSpec?.type === 'aura') {
			enemy.auraRadius = behaviorSpec.auraRadius ?? 260;
			enemy.auraDamageMult = behaviorSpec.auraDamageMult ?? 1.35;
			enemy.auraSpeedMult = behaviorSpec.auraSpeedMult ?? 1.2;
		}

		// Reset pooled state, then apply variant tint (works for spritesheets too)
		enemy.clearTint();
		enemy.setAlpha(1);
		if (config.tint) {
			enemy.setTint(Phaser.Display.Color.HexStringToColor(config.tint).color);
		} else if (config.color && config.spriteType !== 'aseprite' && config.spriteType !== 'separate') {
			enemy.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
		}

		// 머리 위 식별 마커 (원본 유닛 시트를 재활용한 적의 식별성 — 아트 가이드 §틴트 규칙)
		this.applyMarker(enemy, config);

		// Set display size if specified
		if (config.size) {
			enemy.setDisplaySize(config.size.width, config.size.height);
		}

		// 물리 바디 규격 (2026-09-02 보스 확대 패스).
		// Arcade Body 는 sourceWidth × 스케일이므로, 표시 크기를 키우면 바디도 같이 커진다.
		// 보스 프레임에는 공격 궤적용 여백이 많아 그대로 두면 "그림 밖인데 맞는" 구간이 생긴다.
		// hitbox 가 있는 개체만 손대고, 풀 재사용 시에는 반드시 프레임 기준으로 되돌린다.
		const hitbox = config.hitbox;
		const body = enemy.body as Phaser.Physics.Arcade.Body | undefined;
		if (body) {
			if (hitbox) {
				body.setSize(hitbox.width, hitbox.height, false);
				body.setOffset(hitbox.offsetX, hitbox.offsetY);
				enemy.customHitbox = true;
			} else if (enemy.customHitbox) {
				// 이전 점유자가 커스텀 바디였다 — 프레임 전체로 원복 (기존 적 감각 보존)
				body.setSize(enemy.width, enemy.height, true);
				enemy.customHitbox = false;
			}
			// setSize 는 **직전 프레임의** 스케일 캐시(_sx/_sy)로 width 를 계산한다.
			// 풀에서 꺼낸 개체는 이전 점유자의 배율이 남아 있어 첫 프레임 동안 바디가 어긋난다
			// (다음 preUpdate 에 자동 보정되지만, 그 한 프레임에 접촉 판정이 돈다).
			body.updateBounds();
		}

		// Play idle animation if spritesheet exists
		if ((config.spriteType === 'aseprite' || config.spriteType === 'separate') && enemy.play) {
			const idleAnimKey = `${config.id}-idle`;
			if (this.scene?.anims?.exists(idleAnimKey)) {
				try {
					enemy.play(idleAnimKey, true);
				} catch {
					// 애니메이션 재생 실패는 치명적이지 않음 (정적 프레임 유지)
				}
			}
		}

		if (enemy.body) {
			(enemy.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
			(enemy.body as Phaser.Physics.Arcade.Body).setImmovable(false);
		}

		// 보스 스킬 킷 — 라운드가 오를수록 해금 (bossSkills.ts). 풀 재사용 대비 항상 리셋.
		enemy.skillIds = undefined;
		enemy.skillRotation = 0;
		enemy.nextSkillAt = 0;
		enemy.castingUntil = 0;
		enemy.skillDashUntil = 0;
		enemy.stateAnimKey = undefined;
		enemy.halfFieldAngle = undefined;
		enemy.enraged = false;
		enemy.hasEnrage = false;
		if (config.isBoss && config.id) {
			const skills = activeSkillsFor(config.id, this.currentRound);
			const actives = skills.filter((skill) => skill.id !== 'enrage').map((skill) => skill.id);
			if (actives.length > 0) {
				enemy.skillIds = actives;
			}
			enemy.hasEnrage = skills.some((skill) => skill.id === 'enrage');
			// 첫 시전 유예 — 등장 직후 억울사 방지. 컷인(약 1.5초)이 끝나고 곧바로 첫 패턴이
			// 나가도록 3800 → 2600 (2026-09-02). 보스전이 짧아 패턴을 못 보고 끝나던 문제.
			enemy.nextSkillAt = (this.scene.time?.now ?? 0) + 2600;
		}

		// 특성(몸체·기질): CC 면역 플래그는 스폰 시 1회 적용, 원소 상성은 takeDamage 가 판정
		enemy.traitIds = config.traits ?? [];
		if (enemy.traitIds.length > 0) {
			const traits = this.traitsForConfig(config);
			if (traitsImmuneTo(traits, 'slow')) {
				enemy.slowImmune = true;
			}
			if (traitsImmuneTo(traits, 'knockback')) {
				enemy.knockbackResist = 1;
			}
			if (traitsImmuneTo(traits, 'dot')) {
				enemy.dotImmune = true;
			}
		}

		// 태생 어픽스(보스 개성) + 라운드 예산 어픽스 적용
		const innate = (config.affixes ?? [])
			.map((id) => this.getAffixById(id))
			.filter((a): a is AffixDefinition => Boolean(a));
		const combined = [...innate];
		for (const affix of this.rollAffixes(config)) {
			if (!combined.some((a) => a.id === affix.id)) {
				combined.push(affix);
			}
		}
		this.applyAffixes(enemy, combined);

		// 페이즈 보스(탈각하는 것): 시작 형태 적용 — 어픽스 이후에 와야 purge 면역이 합산된다
		if (config.phases?.length && config.id) {
			this.applyBossPhase(enemy, 0, true);
		}

		// 이번 프레임의 공간 그리드에 즉시 등록 — 스폰 직후 같은 프레임에 일어나는
		// 반경 질의(연쇄/폭발/파동/타겟 스캔)에서 빠지지 않게 한다.
		if (this.gridBuiltAt >= 0) {
			this.insertIntoGrid(enemy);
		}

		// 보스 등장 컷인 — 보스바(다음 틱 ≤120ms)·보스 BGM 전환과 같은 순간에 뜬다.
		// 무피격 판정도 여기서 시작한다.
		if (config.isBoss) {
			this.scene.bossCutIn?.show(enemy.enemyName ?? config.name ?? '보스');
			this.scene.achievements?.onBossSpawned();
		}

		this.totalSpawned += 1;
		return enemy;
	}

	/**
	 * 라운드 사이(클리어 여운·대기마을)에는 스폰을 멈춘다 — 예전엔 여운 3초 동안
	 * 스폰이 계속돼 마을까지 적이 따라 들어왔다. WaveSystem 이 라운드 시작/종료에 토글.
	 */
	spawningEnabled = true;

	update(player: PlayerSprite, delta: number): void {
		if (!this.scene || !player) {
			return;
		}

		this.spawnTimer += delta;

		if (this.spawningEnabled) {
			while (this.spawnTimer >= this.nextSpawnInterval) {
				this.spawnTimer -= this.nextSpawnInterval;
				this.spawnEnemy(this.scene, player);
				this.increaseSpawnRate();
			}
		} else if (this.spawnTimer > this.nextSpawnInterval) {
			this.spawnTimer = this.nextSpawnInterval; // 재개 시 밀린 스폰이 한꺼번에 터지지 않게
		}

		// Keep the pressure on: top up to the wave's minimum alive count.
		// (매 프레임 filter() 배열 할당 대신 수동 카운트 — GC 압력 감소)
		if (this.spawningEnabled && this.minAlive > 0) {
			let aliveCount = 0;
			for (const enemy of this.enemies.getChildren() as EnemySprite[]) {
				if (this.isAliveEnemy(enemy)) {
					aliveCount += 1;
				}
			}
			const deficit = Math.min(this.minAlive - aliveCount, this.maxBurstPerFrame);
			for (let i = 0; i < deficit; i += 1) {
				this.spawnEnemy(this.scene, player);
			}
		}

		const now = this.scene.time?.now ?? 0;
		this.drainDeathQueue(now);
		// 이번 프레임의 반경 질의(오라/힐/검 타겟 스캔/연쇄·폭발)가 모두 이 스냅샷을 쓴다.
		this.rebuildSpatialGrid(now);

		// 화면 밖 적 렌더 컬링용 경계 (여유 80px — 큰 보스 스프라이트가 튀지 않게)
		const camera = this.scene.cameras.main;
		const cullLeft = camera.scrollX - 80;
		const cullRight = camera.scrollX + camera.width + 80;
		const cullTop = camera.scrollY - 80;
		const cullBottom = camera.scrollY + camera.height + 80;

		// 상태이상 지속 표시: 이 순회 안에서 함께 처리한다 (별도 전체 순회 없음)
		const status = this.scene.statusEffects;
		status?.beginFrame();

		for (const enemy of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}

			this.updateDot(enemy, now, delta);

			if (!this.isAliveEnemy(enemy) || enemy.isDying) {
				continue;
			}

			this.updateAffixTicks(enemy, player, now, delta);

			// 화면 밖 적은 렌더하지 않는다. Phaser는 스프라이트를 프러스텀 컬링하지 않아
			// 스폰 지점(플레이어에서 600px 밖)의 적들이 접근하는 내내 배치에 올라갔다.
			// AI·물리는 그대로 돌고 표시만 끈다 — 생존 판정은 active만 보므로 안전하다.
			// 여유는 스프라이트 절반 크기만큼 더 준다: 고정 80px이면 대형 보스(190px)가
			// 반쯤 걸친 채 통째로 꺼졌다 켜져 순간이동처럼 보인다.
			//
			// 표시 갱신(컬링·상태이상 색·마커)은 **넉백 중에도** 돌아야 한다. 아래의
			// `continue` 뒤에 두었더니, 밀집 구간에서 계속 얻어맞는 적은 넉백이 끊이지 않아
			// 화상·빙결 색이 아예 칠해지지 않았다 (status-fx-test 40마리 절이 잡아냈다).
			const cullPad = Math.max(enemy.displayWidth, enemy.displayHeight) * 0.5;
			const onScreen = enemy.x >= cullLeft - cullPad && enemy.x <= cullRight + cullPad
				&& enemy.y >= cullTop - cullPad && enemy.y <= cullBottom + cullPad;
			if (enemy.visible !== onScreen) {
				enemy.setVisible(onScreen);
			}

			// 화상/빙결/감전… 이 걸려 있는 동안의 색·오버레이 (화면 밖은 틴트만)
			status?.tickEnemy(enemy, now, onScreen);

			// 머리 위 마커는 본체와 같은 컬링을 따른다
			if (enemy.markerOn && enemy.markerIcon) {
				const icon = enemy.markerIcon;
				if (icon.visible !== onScreen) {
					icon.setVisible(onScreen);
				}
				if (onScreen) {
					icon.setPosition(enemy.x, enemy.y - enemy.displayHeight * 0.62);
				}
			}

			// Let knockback impulses play out before resuming the chase.
			if (now < (enemy.knockbackUntil ?? 0)) {
				continue;
			}

			// 스킬 돌진(삼연 돌진) 중에는 이미 설정된 속도를 그대로 유지한다.
			// 보스 스킬 시전 중에는 제자리에 선다 (텔레그래프를 읽을 시간).
			if (now < (enemy.skillDashUntil ?? 0)) {
				// 돌진 지속 — 속도 유지 (fireTelegraph 가 설정)
			} else if (now < (enemy.castingUntil ?? 0)) {
				enemy.setVelocity(0, 0);
			} else if (this.lure && now < this.lure.until && this.lureApplies(enemy)) {
				// 유인 횃불 (스킬 트리 '유인 횃불'): 잡몹은 플레이어 대신 횃불로 몰린다
				const lureAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.lure.x, this.lure.y);
				const lureDist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.lure.x, this.lure.y);
				const lureSpeed = lureDist < 24 ? 0 : (enemy.speed ?? 60) * (enemy.slowFactor ?? 1);
				enemy.setVelocity(Math.cos(lureAngle) * lureSpeed, Math.sin(lureAngle) * lureSpeed);
			} else {
				this.updateEnemyBehavior(enemy, player, now, delta);
			}

			// 보스/중간보스 상태 애니 (대기 ↔ 걷기). 공격 애니는 시전 시점에 1회 재생된다.
			if (enemy.catalog?.isBoss || enemy.catalog?.isMiniboss) {
				this.updateStateAnim(enemy);
			}

			// Face towards player. 카탈로그 facing 이 원본 시트의 기본 방향을 알려준다
			// (Tiny Swords 유닛은 오른쪽, 구형 시트는 왼쪽이 기본).
			const facesRight = enemy.catalog?.facing === 'right';
			if (enemy.x < player.x) {
				enemy.setFlipX(!facesRight); // 오른쪽으로 이동
			} else {
				enemy.setFlipX(facesRight); // 왼쪽으로 이동
			}
		}

		this.updateProjectiles(now, delta);
		this.updateHazards(player, now, delta);
		this.updateVeils(now);
		this.updateBossSkills(player, now);
		this.renderTelegraphs(now);
	}

	// ---------------------------------------------------------------
	// 보스 스킬 — 텔레그래프 예고 → 발동 판정 → 잔광 (src/logic/bossSkills.ts)
	// 파훼 가능성이 핵심: 예고 표시 안에서만 맞는다. 즉살기(beam)도 축선만 벗어나면 무피해.
	// ---------------------------------------------------------------

	/** 보스 스킬 카탈로그·킷 (정찰 보고·도감·회귀 테스트가 읽는 단일 출처) */
	readonly bossSkills = BOSS_SKILLS;
	readonly bossKits = BOSS_KITS;

	/** 회피 하한 규약 점검 — "이론상 회피 불가" 패턴이 없는지 (bossSkills.dodgeFloorOk) */
	bossDodgeFloor(): { ok: boolean; worst: { id: BossSkillId; required: number } | null } {
		return dodgeFloorOk();
	}

	private bossTelegraphs: BossTelegraph[] = [];
	private telegraphG: Phaser.GameObjects.Graphics | null = null;
	private telegraphDrawn = false;
	/** 처형 광선 배너 스팸 방지 */
	private lastBeamAnnounceAt = 0;
	/** 전방위 조임 배너 스팸 방지 */
	private lastCinchAnnounceAt = 0;
	/** 신규 패턴 배너 공용 스팸 방지 (여러 종류가 겹쳐도 화면이 배너로 덮이지 않게) */
	private lastSkillAnnounceAt = 0;

	/**
	 * 페이즈 보스 형태 적용 — 애니/특성/스킬/속도를 통째로 갈아끼운다.
	 * silent=true 는 스폰 시 초기 형태 (연출 없음).
	 */
	applyBossPhase(enemy: ManagedEnemy, index: number, silent = false): void {
		const config = enemy.catalog;
		const phase = config?.phases?.[index];
		if (!config || !phase) {
			return;
		}
		enemy.phaseIndex = index;

		// 스킬 킷 교체
		const actives = phase.skills.filter((id) => id !== 'enrage');
		enemy.skillIds = actives.length > 0 ? actives : undefined;
		enemy.hasEnrage = phase.skills.includes('enrage');
		enemy.skillRotation = 0;

		// 특성 오버라이드 + CC 면역 재계산 (purge 어픽스 면역은 유지)
		enemy.traitIds = [...phase.traits];
		const traits = phase.traits
			.map((id) => getTraitById(id))
			.filter((trait): trait is EnemyTrait => Boolean(trait));
		this.overrideTraits.set(enemy, traits);
		enemy.slowImmune = traitsImmuneTo(traits, 'slow') || enemy.affixPurge === true;
		enemy.dotImmune = traitsImmuneTo(traits, 'dot') || enemy.affixPurge === true;
		enemy.knockbackResist = Math.max(config.knockbackResist ?? 0, traitsImmuneTo(traits, 'knockback') ? 1 : 0);

		// 속도 (격노 배율은 이미 격노 시점에 곱해졌으므로 기본값에서 다시 계산)
		enemy.speed = (config.speed ?? this.enemySpeed) * (phase.speedMult ?? 1) * (enemy.enraged ? 1.3 : 1);

		// 형태 애니메이션
		const animKey = `${config.id}-${phase.anim}`;
		if (this.scene?.anims?.exists(animKey) && enemy.play) {
			try {
				enemy.play(animKey, true);
			} catch {
				// 형태 애니 실패는 치명적이지 않다
			}
		}
		enemy.enemyName = `${config.name} — ${phase.name}`;

		if (!silent) {
			// 탈각 연출: 이 개체의 미발동 예고 취소 + 잠깐 정지 + 링 버스트 + 배너
			for (let i = this.bossTelegraphs.length - 1; i >= 0; i -= 1) {
				if (this.bossTelegraphs[i].caster === enemy && !this.bossTelegraphs[i].fired) {
					this.bossTelegraphs.splice(i, 1);
				}
			}
			const now = this.scene.time?.now ?? 0;
			enemy.castingUntil = now + 1000;
			enemy.nextSkillAt = now + 1800;
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 18, r1: 84, w: 5, color: 0x9bd66a, alpha: 0.95, dur: 520 });
				this.scene.visualEffects?.hitStop(90, { force: true });
			}
			if (screenShakeEnabled()) {
				this.scene.cameras?.main?.shake(240, 0.007);
			}
			this.scene.waveSystem?.announce?.(`탈각 — ${phase.name}`, '#9bd66a');
			this.scene.soundSystem?.play('warning');
		}
	}

	/**
	 * 보스 상태 애니 전환 (2026-09-02).
	 * 정지 = `<id>-idle`, 이동 = `<id>-walk`. 공격/피격/사망 애니가 도는 동안은 건드리지 않는다.
	 * 애니 키가 없는 개체는 아무 일도 하지 않는다 (구형 시트 호환).
	 */
	private updateStateAnim(enemy: ManagedEnemy): void {
		const id = enemy.catalog?.id;
		if (!id || !enemy.play || enemy.isDying) {
			return;
		}
		const current = enemy.anims?.currentAnim?.key;
		// 1회 재생 애니(공격·피격·사망)가 아직 도는 중이면 양보한다
		if (enemy.anims?.isPlaying && (current === `${id}-attack` || current === `${id}-hit` || current === `${id}-death`)) {
			return;
		}
		const body = enemy.body as Phaser.Physics.Arcade.Body | undefined;
		const moving = !!body && Math.abs(body.velocity.x) + Math.abs(body.velocity.y) > 18;
		let key = moving ? `${id}-walk` : `${id}-idle`;
		if (!this.scene?.anims?.exists(key)) {
			key = `${id}-idle`;
		}
		if (enemy.stateAnimKey === key && current === key) {
			return;
		}
		if (!this.scene?.anims?.exists(key)) {
			return;
		}
		enemy.stateAnimKey = key;
		try {
			enemy.play(key, true);
		} catch {
			// 애니 전환 실패는 치명적이지 않다 (정지 프레임 유지)
		}
	}

	/** 시전 순간 1회 재생되는 공격 애니 (없으면 조용히 넘어간다) */
	private playAttackAnim(enemy: ManagedEnemy): void {
		const key = `${enemy.catalog?.id}-attack`;
		if (!enemy.play || !this.scene?.anims?.exists(key)) {
			return;
		}
		enemy.stateAnimKey = key;
		try {
			enemy.play(key, true);
		} catch {
			// 무시
		}
	}

	private updateBossSkills(player: PlayerSprite, now: number): void {
		// 1) 시전 예약
		for (const enemy of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(enemy) || enemy.isDying) {
				continue;
			}

			// 페이즈 보스: 체력 임계 도달 시 다음 형태로 탈각
			const phases = enemy.catalog?.phases;
			if (phases && enemy.hp > 0) {
				const nextIndex = (enemy.phaseIndex ?? 0) + 1;
				const nextPhase = phases[nextIndex];
				if (nextPhase && enemy.hp <= enemy.maxHp * nextPhase.hpPct) {
					this.applyBossPhase(enemy, nextIndex);
					continue; // 이번 틱은 전환 연출에 양보
				}
			}

			// 격노 (스킬 슬롯에 있으면 체력 50% 이하에서 1회)
			if (enemy.hasEnrage && !enemy.enraged && enemy.hp <= enemy.maxHp * 0.5) {
				enemy.enraged = true;
				enemy.speed = (enemy.speed ?? this.enemySpeed) * 1.3;
				enemy.damage = Math.round(enemy.damage * 1.2);
				enemy.setTint(0xff8a6a);
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 20, r1: 64, w: 4, color: 0xef4444, alpha: 0.95, dur: 420 });
				}
				this.scene.waveSystem?.announce?.(`${enemy.catalog?.name ?? '보스'} 격노 — 거리를 벌려라`, '#ff8a63');
				this.scene.soundSystem?.play('warning');
			}

			if (!enemy.skillIds?.length) {
				continue;
			}
			if (now < (enemy.nextSkillAt ?? 0) || now < (enemy.castingUntil ?? 0)) {
				continue;
			}
			// 화면 근처에서만 시전 (900px 밖 허공 폭격 방지)
			if (Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y) > 900) {
				enemy.nextSkillAt = now + 900;
				continue;
			}

			const skillId = enemy.skillIds[(enemy.skillRotation ?? 0) % enemy.skillIds.length] as BossSkillId;
			enemy.skillRotation = (enemy.skillRotation ?? 0) + 1;
			const skill = BOSS_SKILLS[skillId];
			if (!skill) {
				continue;
			}
			const totalMs = this.castBossSkill(enemy, skill, player, now);
			this.playAttackAnim(enemy);
			enemy.castingUntil = now + totalMs;
			// 격노 상태면 쿨다운도 짧아진다 (패턴 압박 상승). 라운드가 오를수록도 조금씩.
			const cdMult = (enemy.enraged ? 0.75 : 1) * skillCooldownMultForRound(this.currentRound);
			enemy.nextSkillAt = now + totalMs + skill.cooldownMs * cdMult * Phaser.Math.FloatBetween(0.9, 1.15);
		}

		// 2) 발동/잔광/취소 처리
		for (let i = this.bossTelegraphs.length - 1; i >= 0; i -= 1) {
			const tele = this.bossTelegraphs[i];
			const casterAlive = this.isAliveEnemy(tele.caster) && tele.caster.spawnGeneration === tele.casterGen;
			if (!tele.fired && !casterAlive) {
				this.bossTelegraphs.splice(i, 1); // 시전자가 죽으면 예고 취소 — 파훼 보상
				continue;
			}
			if (!tele.fired && now >= tele.fireAt) {
				tele.fired = true;
				this.fireTelegraph(tele, player, now);
			}
			if (tele.fired && now >= tele.fireAt + 200) {
				this.bossTelegraphs.splice(i, 1);
			}
		}
	}

	/**
	 * 스킬 1회 시전. 텔레그래프를 예약하고 **전체 시전 시간(ms)** 을 돌려준다
	 * (연속 패턴은 마지막 단계가 끝나는 시각까지 — 호출부가 castingUntil/nextSkillAt 에 쓴다).
	 *
	 * step > 0 은 연속 패턴의 이어진 단계 (chain 이 fireTelegraph 에서 재호출).
	 * 이어진 단계는 예고를 더 짧게 잡아 "첫 회피 위치가 다음 위험지대"가 되게 한다.
	 */
	private castBossSkill(enemy: ManagedEnemy, skill: BossSkillDef, player: PlayerSprite, now: number, step = 0): number {
		const push = (tele: Omit<BossTelegraph, 'caster' | 'casterGen' | 'bornAt' | 'fired' | 'skillName' | 'damagePctMaxHp'>
			& { damagePctMaxHp?: number }) => {
			this.bossTelegraphs.push({
				...tele,
				damagePctMaxHp: tele.damagePctMaxHp ?? skill.damagePctMaxHp,
				bornAt: now,
				fired: false,
				skillName: `${enemy.catalog?.name ?? '보스'}의 ${skill.name}`,
				caster: enemy,
				casterGen: enemy.spawnGeneration,
			});
		};
		const warn = (text: string, color: string) => {
			if (now - this.lastSkillAnnounceAt > 3200) {
				this.lastSkillAnnounceAt = now;
				this.scene.waveSystem?.announce?.(text, color);
			}
		};

		switch (skill.id) {
			case 'slam':
				push({ kind: 'circle', x: enemy.x, y: enemy.y, radius: skill.radius ?? 190, fireAt: now + skill.castMs });
				this.scene.soundSystem?.play('warning', { volume: 0.5 });
				return skill.castMs;
			case 'barrage': {
				const count = skill.count ?? 5;
				const gap = skill.stepDelayMs ?? 130;
				for (let i = 0; i < count; i += 1) {
					// 첫 발은 플레이어 정위치 — 나머지는 주변 랜덤 (서 있으면 맞는다)
					const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
					const dist = i === 0 ? 0 : Phaser.Math.Between(70, 260);
					push({
						kind: 'circle',
						x: player.x + Math.cos(angle) * dist,
						y: player.y + Math.sin(angle) * dist,
						radius: skill.radius ?? 110,
						fireAt: now + skill.castMs + i * gap,
					});
				}
				this.scene.soundSystem?.play('warning', { volume: 0.5 });
				return skill.castMs + (count - 1) * gap;
			}
			case 'beam': {
				// 시전 시점의 축선에 고정 — 옆으로 비키면 파훼
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				const reach = 1250;
				push({
					kind: 'line',
					x: enemy.x,
					y: enemy.y,
					x2: enemy.x + Math.cos(angle) * reach,
					y2: enemy.y + Math.sin(angle) * reach,
					radius: (skill.radius ?? 92) / 2,
					fireAt: now + skill.castMs,
				});
				if (now - this.lastBeamAnnounceAt > 4000) {
					this.lastBeamAnnounceAt = now;
					this.scene.waveSystem?.announce?.('처형 광선 — 축선을 벗어나라!', '#ff8a63');
				}
				// 즉살기 전조음: 충전 상승음 + 조준 확정 클릭 (텔레그래프와 동시에 시작해
				// 화면을 안 보고 있어도 "지금 비켜야 한다"를 귀로 알 수 있다)
				this.scene.soundSystem?.play('telegraph');
				this.scene.soundSystem?.play('warning', { volume: 0.4 });
				return skill.castMs;
			}
			case 'cinch': {
				// 키퍼를 중심으로 고리가 좁혀 들어온다. 틈은 한 곳 — 매 시전마다 방향이 바뀐다.
				// 파훼 2경로: (1) 초록 틈 각도로 대시해 빠져나가기 (2) 귀소 무적으로 흘리기
				push({
					kind: 'ring',
					x: player.x,
					y: player.y,
					radius: skill.radius ?? 470,
					innerRadius: skill.innerRadius ?? 300,
					gapAngle: Phaser.Math.FloatBetween(0, Math.PI * 2),
					gapHalf: skill.gapHalfWidth ?? 0.44,
					fireAt: now + skill.castMs,
				});
				if (now - this.lastCinchAnnounceAt > 4000) {
					this.lastCinchAnnounceAt = now;
					this.scene.waveSystem?.announce?.('전방위 조임 — 초록 틈으로 대시!', '#9bd66a');
				}
				this.scene.soundSystem?.play('telegraph');
				this.scene.soundSystem?.play('warning', { volume: 0.45 });
				return skill.castMs;
			}

			// ── 신규: 균열 지뢰 (2단 순차 기폭) ────────────────────────────
			// 1단은 키퍼 주변에 흩뿌리고, 1단이 터질 때 **그 순간의 키퍼 위치**를 다시 조준한다.
			// = 1단을 피해 도망친 자리가 2단의 위험지대가 된다.
			case 'mines': {
				const steps = skill.steps ?? 2;
				const count = skill.count ?? 4;
				const castLen = step === 0 ? skill.castMs : (skill.stepDelayMs ?? 700);
				const last = step >= steps - 1;
				for (let i = 0; i < count; i += 1) {
					const angle = (Math.PI * 2 * i) / count + Phaser.Math.FloatBetween(0, 1.2);
					const dist = step === 0 ? Phaser.Math.Between(0, 170) : Phaser.Math.Between(40, 200);
					push({
						kind: 'circle',
						x: player.x + Math.cos(angle) * dist,
						y: player.y + Math.sin(angle) * dist,
						radius: skill.radius ?? 150,
						fireAt: now + castLen,
						// 마지막 조각 하나에만 연쇄를 건다 (2단이 count 배로 늘어나지 않게)
						chain: last || i > 0 ? undefined : skill.id,
						chainStep: last || i > 0 ? undefined : step + 1,
					});
				}
				if (step === 0) {
					warn('균열 지뢰 — 터진 자리에서 또 터진다', '#ffb457');
					this.scene.soundSystem?.play('warning', { volume: 0.5 });
				}
				return castLen + (last ? 0 : (skill.stepDelayMs ?? 700));
			}

			// ── 신규: 삼연 돌진 (매 단계 재조준) ──────────────────────────
			case 'rush': {
				const steps = skill.steps ?? 3;
				const dashMs = skill.dashMs ?? 280;
				const dashSpeed = skill.dashSpeed ?? 900;
				const castLen = step === 0 ? skill.castMs : (skill.stepDelayMs ?? 380);
				const last = step >= steps - 1;
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				const reach = dashSpeed * (dashMs / 1000) + 120;
				push({
					kind: 'line',
					x: enemy.x,
					y: enemy.y,
					x2: enemy.x + Math.cos(angle) * reach,
					y2: enemy.y + Math.sin(angle) * reach,
					radius: (skill.radius ?? 118) / 2,
					fireAt: now + castLen,
					dashSpeed,
					dashMs,
					chain: last ? undefined : skill.id,
					chainStep: last ? undefined : step + 1,
				});
				if (step === 0) {
					warn('삼연 돌진 — 축선과 직각으로 빠져라', '#ff8a63');
					this.scene.soundSystem?.play('warning', { volume: 0.5 });
				}
				return castLen + dashMs + (last ? 0 : (skill.stepDelayMs ?? 380));
			}

			// ── 신규: 회전 빔 스윕 (부채꼴이 차례로 지나간다) ─────────────
			case 'sweep': {
				const steps = skill.steps ?? 5;
				const gap = skill.stepDelayMs ?? 220;
				const half = skill.gapHalfWidth ?? 0.4;
				const dir = Math.random() < 0.5 ? 1 : -1;
				const base = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y)
					- dir * half * (steps - 1) * 0.5;
				for (let i = 0; i < steps; i += 1) {
					push({
						kind: 'sector',
						x: enemy.x,
						y: enemy.y,
						radius: skill.radius ?? 560,
						angle: base + dir * half * i,
						gapHalf: half,
						fireAt: now + skill.castMs + i * gap,
					});
				}
				warn('회전 빔 — 쓸어오는 반대쪽으로 돌아라', '#7fd4e8');
				this.scene.soundSystem?.play('telegraph');
				return skill.castMs + (steps - 1) * gap;
			}

			// ── 신규: 나선 탄막 (풀링된 적 투사체) ────────────────────────
			case 'spiral': {
				const steps = skill.steps ?? 8;
				const gap = skill.stepDelayMs ?? 130;
				const bullets = skill.bullets ?? 3;
				const dir = Math.random() < 0.5 ? 1 : -1;
				const base = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				for (let i = 0; i < steps; i += 1) {
					push({
						kind: 'burst',
						x: enemy.x,
						y: enemy.y,
						radius: 34,
						angle: base + dir * i * 0.42,
						bullets,
						bulletSpread: (Math.PI * 2) / bullets,
						bulletSpeed: skill.bulletSpeed ?? 210,
						fireAt: now + skill.castMs + i * gap,
					});
				}
				warn('나선 탄막 — 결을 따라 돌아라', '#c084fc');
				this.scene.soundSystem?.play('warning', { volume: 0.4 });
				return skill.castMs + (steps - 1) * gap;
			}

			// ── 신규: 부채꼴 일제사 ───────────────────────────────────────
			case 'fan': {
				const bullets = skill.count ?? 9;
				push({
					kind: 'burst',
					x: enemy.x,
					y: enemy.y,
					radius: 40,
					angle: Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y),
					bullets,
					bulletSpread: Phaser.Math.DegToRad(104) / Math.max(1, bullets - 1),
					bulletSpeed: skill.bulletSpeed ?? 250,
					fireAt: now + skill.castMs,
				});
				warn('부채꼴 일제사 — 옆으로 돌아 들어가라', '#c084fc');
				this.scene.soundSystem?.play('warning', { volume: 0.45 });
				return skill.castMs;
			}

			// ── 신규: 반쪽 붕괴 (안전지대 강제 이동) ──────────────────────
			// 1단: 키퍼가 선 자리를 지나는 선을 긋고 한쪽 절반이 무너진다.
			// 2단: 같은 선에서 **반대쪽** 절반이 무너진다 → 넘어갔다가 되돌아와야 산다.
			case 'halffield': {
				const steps = skill.steps ?? 2;
				const castLen = step === 0 ? skill.castMs : (skill.stepDelayMs ?? 1100);
				const last = step >= steps - 1;
				// 1단에서 정한 축을 2단이 그대로 뒤집어 쓴다 (개체에 보관)
				if (step === 0) {
					enemy.halfFieldAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
					enemy.halfFieldX = player.x;
					enemy.halfFieldY = player.y;
				}
				const angle = (enemy.halfFieldAngle ?? 0) + (step % 2 === 0 ? 0 : Math.PI);
				push({
					kind: 'half',
					x: enemy.halfFieldX ?? player.x,
					y: enemy.halfFieldY ?? player.y,
					radius: skill.radius ?? 900,
					angle,
					margin: 64,
					fireAt: now + castLen,
					chain: last ? undefined : skill.id,
					chainStep: last ? undefined : step + 1,
				});
				if (step === 0) {
					warn('반쪽 붕괴 — 안전한 절반으로!', '#ffb457');
					this.scene.soundSystem?.play('telegraph');
				}
				return castLen + (last ? 0 : (skill.stepDelayMs ?? 1100));
			}

			// ── 신규: 검 봉인 (귀소로 즉시 해제) ─────────────────────────
			case 'seal': {
				push({
					kind: 'seal',
					x: player.x,
					y: player.y,
					radius: skill.radius ?? 240,
					sealMs: skill.sealMs ?? 5000,
					sealCount: skill.sealCount ?? 1,
					fireAt: now + skill.castMs,
				});
				warn('검 봉인 — 귀소(SPACE)로 끊어라', '#9bd66a');
				this.scene.soundSystem?.play('telegraph');
				return skill.castMs;
			}

			// ── 신규: 낙하 연타 (매번 현재 위치 재조준) ───────────────────
			case 'meteor': {
				const steps = skill.steps ?? 5;
				const castLen = step === 0 ? skill.castMs : (skill.stepDelayMs ?? 420);
				const last = step >= steps - 1;
				push({
					kind: 'circle',
					x: player.x,
					y: player.y,
					radius: skill.radius ?? 115,
					fireAt: now + castLen,
					chain: last ? undefined : skill.id,
					chainStep: last ? undefined : step + 1,
				});
				if (step === 0) {
					warn('낙하 연타 — 멈추지 마라', '#ffb457');
					this.scene.soundSystem?.play('warning', { volume: 0.45 });
				}
				return castLen + (last ? 0 : (skill.stepDelayMs ?? 420));
			}

			default:
				return skill.castMs;
		}
	}

	private fireTelegraph(tele: BossTelegraph, player: PlayerSprite, now: number): void {
		const damage = Math.max(1, Math.round((player.maxHp ?? 100) * tele.damagePctMaxHp));

		// 연속 패턴: 이 조각이 터지는 순간 다음 단계를 **지금 위치 기준**으로 다시 조준한다
		if (tele.chain) {
			const caster = tele.caster as ManagedEnemy;
			const next = BOSS_SKILLS[tele.chain];
			if (next && this.isAliveEnemy(caster) && caster.spawnGeneration === tele.casterGen && !caster.isDying) {
				const more = this.castBossSkill(caster, next, player, now, tele.chainStep ?? 1);
				caster.castingUntil = Math.max(caster.castingUntil ?? 0, now + more);
			}
		}

		// 부채꼴 (회전 빔 스윕): 반경 안 + 각도 안이면 맞는다. 축(피벗) 근처는 좁아 안전하다.
		if (tele.kind === 'sector') {
			const dx = player.x - tele.x;
			const dy = player.y - tele.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const half = tele.gapHalf ?? 0.4;
			const inArc = dist <= tele.radius && dist > 46
				&& Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - (tele.angle ?? 0))) <= half;
			if (player && !player.isDead && inArc) {
				this.scene.applyPlayerDamage?.(damage, tele.x, tele.y, 'magic', tele.skillName);
			}
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxArc(tele.x, tele.y, {
					r: tele.radius * 0.62, a0: (tele.angle ?? 0) - half, a1: (tele.angle ?? 0) + half,
					color: 0x7fd4e8, w: 10, alpha: 0.8, dur: 220,
				});
			}
			return;
		}

		// 반쪽 붕괴: 경계선 기준으로 위험한 절반에 있으면 맞는다 (margin 만큼은 유예)
		if (tele.kind === 'half') {
			const angle = tele.angle ?? 0;
			const side = (player.x - tele.x) * Math.cos(angle) + (player.y - tele.y) * Math.sin(angle);
			if (player && !player.isDead && side > -(tele.margin ?? 60)) {
				this.scene.applyPlayerDamage?.(damage, player.x, player.y, 'magic', tele.skillName);
			}
			if (screenShakeEnabled()) {
				this.scene.cameras?.main?.shake(180, 0.005);
			}
			this.scene.soundSystem?.play('bigkill', { volume: 0.4 });
			return;
		}

		// 탄막 발사 시점: 풀링된 적 투사체를 뿌린다 (직접 피해 없음 — 탄이 맞아야 아프다)
		if (tele.kind === 'burst') {
			const caster = tele.caster;
			const originX = this.isAliveEnemy(caster) ? caster.x : tele.x;
			const originY = this.isAliveEnemy(caster) ? caster.y : tele.y;
			const bullets = tele.bullets ?? 3;
			const spread = tele.bulletSpread ?? 0.5;
			const base = (tele.angle ?? 0) - spread * (bullets - 1) * 0.5;
			for (let i = 0; i < bullets; i += 1) {
				this.spawnEnemyBullet(originX, originY, base + spread * i, {
					speed: tele.bulletSpeed ?? 230,
					damage,
					shooterName: tele.skillName,
					lifeMs: 4200,
				});
			}
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxRing(originX, originY,
					{ r0: 12, r1: 52, w: 3, color: 0xc084fc, alpha: 0.8, dur: 240 });
			}
			return;
		}

		// 검 봉인: 궤도 검 한 자루를 잠근다. 귀소(SPACE)가 즉시 끊는다 (파훼 경로).
		if (tele.kind === 'seal') {
			const sealed = this.scene.swordOrbit?.sealSwords?.(tele.sealCount ?? 1, tele.sealMs ?? 5000) ?? 0;
			if (sealed > 0) {
				this.scene.waveSystem?.announce?.('검이 봉인됐다 — 귀소(SPACE)로 끊어라', '#9bd66a');
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(player.x, player.y,
						{ r0: tele.radius, r1: 30, w: 4, color: 0x9bd66a, alpha: 0.9, dur: 320 });
				}
			}
			this.scene.soundSystem?.play('warning', { volume: 0.5 });
			return;
		}

		if (tele.kind === 'circle') {
			if (!reduceMotion()) {
				this.playExplosionSprite(tele.x, tele.y, tele.radius);
			}
			if (player && !player.isDead
				&& Phaser.Math.Distance.Between(tele.x, tele.y, player.x, player.y) <= tele.radius + 20) {
				this.scene.applyPlayerDamage?.(damage, tele.x, tele.y, 'magic', tele.skillName);
			}
			if (screenShakeEnabled()) {
				this.scene.cameras?.main?.shake(140, 0.004);
			}
			return;
		}

		// ring(전방위 조임): 다 조여든 원 안에 남아 있으면 맞는다. 초록 틈 각도만 안전.
		if (tele.kind === 'ring') {
			const inner = tele.innerRadius ?? tele.radius * 0.6;
			const dx = player.x - tele.x;
			const dy = player.y - tele.y;
			const distSq = dx * dx + dy * dy;
			const inCore = distSq <= (inner + 20) * (inner + 20);
			const angleDiff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - (tele.gapAngle ?? 0)));
			const inGap = angleDiff <= (tele.gapHalf ?? 0.44);
			if (player && !player.isDead && inCore && !inGap) {
				this.scene.applyPlayerDamage?.(damage, tele.x, tele.y, 'magic', tele.skillName);
			}
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxRing(tele.x, tele.y,
					{ r0: tele.radius, r1: inner, w: 6, color: 0xff8a63, alpha: 0.95, dur: 220 });
			}
			if (screenShakeEnabled()) {
				this.scene.cameras?.main?.shake(180, 0.005);
			}
			this.scene.soundSystem?.play('bigkill', { volume: 0.45 });
			return;
		}

		// line(beam·rush): 점-선분 거리로 명중 판정
		const x2 = tele.x2 ?? tele.x;
		const y2 = tele.y2 ?? tele.y;
		const lineDist = this.pointToSegmentDistance(player.x, player.y, tele.x, tele.y, x2, y2);
		if (player && !player.isDead && lineDist <= tele.radius + 18) {
			this.scene.applyPlayerDamage?.(damage, tele.x, tele.y, 'magic', tele.skillName);
		}

		// 돌진(rush): 시전자가 실제로 축선을 따라 달려 나간다.
		// updateBossSkills 의 "시전 중 정지" 보다 skillDashUntil 이 우선한다.
		if (tele.dashMs && tele.dashSpeed) {
			const caster = tele.caster as ManagedEnemy;
			if (this.isAliveEnemy(caster) && caster.spawnGeneration === tele.casterGen && !caster.isDying) {
				const angle = Math.atan2(y2 - tele.y, x2 - tele.x);
				caster.skillDashUntil = now + tele.dashMs;
				caster.setVelocity(Math.cos(angle) * tele.dashSpeed, Math.sin(angle) * tele.dashSpeed);
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(caster.x, caster.y,
						{ r0: 16, r1: 70, w: 4, color: 0xff8a63, alpha: 0.85, dur: 260 });
				}
			}
		}

		if (screenShakeEnabled()) {
			this.scene.cameras?.main?.shake(200, 0.006);
		}
		this.scene.soundSystem?.play('bigkill', { volume: 0.5 });
	}

	/**
	 * 적 투사체 1발 (풀 재사용). 보스 탄막 스킬과 원거리 행동이 같은 풀을 쓴다.
	 * 핫패스가 아니라 시전 시점에만 돌지만, 그래도 풀에서만 꺼낸다.
	 */
	private spawnEnemyBullet(
		x: number, y: number, angle: number,
		spec: { speed: number; damage: number; shooterName?: string; lifeMs?: number; homingTurnRate?: number },
	): void {
		this.ensureProjectileGlowTexture();
		const useArrow = this.scene.textures?.exists('enemy_arrow');
		let bullet = this.projectiles.getFirstDead(false) as ManagedProjectile | null;
		if (!bullet) {
			bullet = this.projectiles.create(x, y, useArrow ? 'enemy_arrow' : 'enemy_bullet') as ManagedProjectile | null;
		}
		if (!bullet) {
			return;
		}
		bullet.enableBody?.(true, x, y, true, true);
		bullet.setActive(true).setVisible(true);
		bullet.setPosition(x, y);
		bullet.setDepth(40);
		if (useArrow) {
			bullet.setDisplaySize(38, 38);
			(bullet.body as Phaser.Physics.Arcade.Body | undefined)?.setSize(24, 24, true);
			bullet.setRotation(angle);
		} else {
			bullet.setDisplaySize(14, 14);
		}
		if (!bullet.glow) {
			bullet.glow = this.scene.add.image(x, y, 'enemy_bullet_glow')
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(39);
		}
		bullet.glow.setDisplaySize(46, 46);
		bullet.glow.setPosition(x, y);
		bullet.glow.setVisible(true).setActive(true);

		bullet.damage = spec.damage;
		bullet.shooterName = spec.shooterName;
		bullet.expiresAt = (this.scene.time?.now ?? 0) + (spec.lifeMs ?? 4500);
		if (bullet.body) {
			(bullet.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
		}
		bullet.homingTurnRate = spec.homingTurnRate ?? 0;
		bullet.homingSpeed = spec.speed;
		bullet.setVelocity(Math.cos(angle) * spec.speed, Math.sin(angle) * spec.speed);
	}

	private pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lengthSquared = dx * dx + dy * dy;
		if (lengthSquared === 0) {
			return Phaser.Math.Distance.Between(px, py, x1, y1);
		}
		const t = Phaser.Math.Clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
		return Phaser.Math.Distance.Between(px, py, x1 + t * dx, y1 + t * dy);
	}

	/** 텔레그래프 렌더 — 월드 좌표 단일 Graphics 한 패스 */
	private renderTelegraphs(now: number): void {
		if (this.bossTelegraphs.length === 0) {
			if (this.telegraphDrawn && this.telegraphG) {
				this.telegraphG.clear();
				this.telegraphDrawn = false;
			}
			return;
		}
		if (!this.telegraphG) {
			this.telegraphG = this.scene.add.graphics().setDepth(2);
		}
		const g = this.telegraphG;
		g.clear();
		this.telegraphDrawn = true;
		const pulse = 0.5 + 0.5 * Math.sin(now / 90);

		for (const tele of this.bossTelegraphs) {
			const progress = Phaser.Math.Clamp((now - tele.bornAt) / Math.max(1, tele.fireAt - tele.bornAt), 0, 1);

			if (tele.kind === 'circle') {
				if (!tele.fired) {
					g.fillStyle(0xd9702e, 0.10 + 0.06 * pulse);
					g.fillCircle(tele.x, tele.y, tele.radius);
					g.fillStyle(0xe0654d, 0.22);
					g.fillCircle(tele.x, tele.y, tele.radius * progress);
					g.lineStyle(2.5, 0xe0654d, 0.9);
					g.strokeCircle(tele.x, tele.y, tele.radius);
				} else {
					g.fillStyle(0xffc07a, 0.4);
					g.fillCircle(tele.x, tele.y, tele.radius);
				}
				continue;
			}

			// sector: 부채꼴 (회전 빔 스윕) — 발동이 가까울수록 채도가 오른다
			if (tele.kind === 'sector') {
				const a0 = (tele.angle ?? 0) - (tele.gapHalf ?? 0.4);
				const a1 = (tele.angle ?? 0) + (tele.gapHalf ?? 0.4);
				g.fillStyle(tele.fired ? 0xbfe9f5 : 0x7fd4e8, tele.fired ? 0.42 : 0.10 + 0.14 * progress + 0.05 * pulse);
				g.beginPath();
				g.moveTo(tele.x, tele.y);
				g.arc(tele.x, tele.y, tele.radius, a0, a1, false);
				g.closePath();
				g.fillPath();
				if (!tele.fired) {
					g.lineStyle(2, 0x7fd4e8, 0.55 + 0.4 * progress);
					g.beginPath();
					g.moveTo(tele.x, tele.y);
					g.arc(tele.x, tele.y, tele.radius, a0, a1, false);
					g.closePath();
					g.strokePath();
				}
				continue;
			}

			// half: 반쪽 붕괴 — 경계선 + 위험한 절반
			if (tele.kind === 'half') {
				const angle = tele.angle ?? 0;
				const nx = Math.cos(angle);
				const ny = Math.sin(angle);
				const px = -ny;
				const py = nx;
				const reach = tele.radius;
				const margin = tele.margin ?? 60;
				// 경계선에서 margin 만큼 안쪽부터 위험 (제자리에 서 있으면 맞는다)
				const bx = tele.x - nx * margin;
				const by = tele.y - ny * margin;
				const points = [
					{ x: bx + px * reach, y: by + py * reach },
					{ x: bx - px * reach, y: by - py * reach },
					{ x: bx - px * reach + nx * reach, y: by - py * reach + ny * reach },
					{ x: bx + px * reach + nx * reach, y: by + py * reach + ny * reach },
				];
				g.fillStyle(tele.fired ? 0xffc07a : 0xd9702e, tele.fired ? 0.38 : 0.09 + 0.13 * progress + 0.04 * pulse);
				g.fillPoints(points, true);
				if (!tele.fired) {
					g.lineStyle(3, 0x9bd66a, 0.7 + 0.3 * pulse); // 안전한 쪽 경계 = 초록
					g.beginPath();
					g.moveTo(bx + px * reach, by + py * reach);
					g.lineTo(bx - px * reach, by - py * reach);
					g.strokePath();
				}
				continue;
			}

			// burst: 탄막 발사 예고 (작은 조임 고리 — 어디서 나올지만 알린다)
			if (tele.kind === 'burst') {
				if (!tele.fired) {
					g.lineStyle(2.5, 0xc084fc, 0.55 + 0.4 * pulse);
					g.strokeCircle(tele.x, tele.y, tele.radius * (1.25 - 0.5 * progress));
				}
				continue;
			}

			// seal: 검 봉인 — 키퍼를 감싸는 사슬 고리 (파훼는 귀소)
			if (tele.kind === 'seal') {
				if (!tele.fired) {
					g.lineStyle(3, 0x9bd66a, 0.5 + 0.4 * pulse);
					g.strokeCircle(tele.x, tele.y, tele.radius * (1 - 0.55 * progress));
					g.lineStyle(1.5, 0x9bd66a, 0.35);
					g.strokeCircle(tele.x, tele.y, tele.radius);
				}
				continue;
			}

			// ring: 좁혀오는 고리 + 초록 안전 틈 (틈은 처음부터 끝까지 열려 있다)
			if (tele.kind === 'ring') {
				const inner = tele.innerRadius ?? tele.radius * 0.6;
				const gapAngle = tele.gapAngle ?? 0;
				const gapHalf = tele.gapHalf ?? 0.44;
				const current = Phaser.Math.Linear(tele.radius, inner, progress);
				if (!tele.fired) {
					// 조여드는 벽 (틈을 제외한 호)
					g.lineStyle(7, 0xe0654d, 0.55 + 0.35 * pulse);
					g.beginPath();
					g.arc(tele.x, tele.y, current, gapAngle + gapHalf, gapAngle - gapHalf + Math.PI * 2, false);
					g.strokePath();
					// 최종 위험 반경 (여기 남으면 맞는다)
					g.lineStyle(2, 0xff8a63, 0.35 + 0.25 * progress);
					g.strokeCircle(tele.x, tele.y, inner);
					g.fillStyle(0xd9702e, 0.06 + 0.10 * progress);
					g.fillCircle(tele.x, tele.y, inner);
					// 초록 안전 통로 — 여기로 대시하면 산다
					g.lineStyle(4, 0x9bd66a, 0.75 + 0.25 * pulse);
					g.beginPath();
					g.moveTo(tele.x + Math.cos(gapAngle - gapHalf) * inner * 0.2, tele.y + Math.sin(gapAngle - gapHalf) * inner * 0.2);
					g.lineTo(tele.x + Math.cos(gapAngle - gapHalf) * tele.radius, tele.y + Math.sin(gapAngle - gapHalf) * tele.radius);
					g.moveTo(tele.x + Math.cos(gapAngle + gapHalf) * inner * 0.2, tele.y + Math.sin(gapAngle + gapHalf) * inner * 0.2);
					g.lineTo(tele.x + Math.cos(gapAngle + gapHalf) * tele.radius, tele.y + Math.sin(gapAngle + gapHalf) * tele.radius);
					g.strokePath();
				} else {
					g.fillStyle(0xffc07a, 0.4);
					g.beginPath();
					g.arc(tele.x, tele.y, inner, gapAngle + gapHalf, gapAngle - gapHalf + Math.PI * 2, false);
					g.lineTo(tele.x, tele.y);
					g.closePath();
					g.fillPath();
				}
				continue;
			}

			// beam: 폭이 있는 직사각형 폴리곤
			const x2 = tele.x2 ?? tele.x;
			const y2 = tele.y2 ?? tele.y;
			const angle = Math.atan2(y2 - tele.y, x2 - tele.x);
			const nx = Math.cos(angle + Math.PI / 2);
			const ny = Math.sin(angle + Math.PI / 2);
			const w = tele.radius;
			const points = [
				{ x: tele.x + nx * w, y: tele.y + ny * w },
				{ x: x2 + nx * w, y: y2 + ny * w },
				{ x: x2 - nx * w, y: y2 - ny * w },
				{ x: tele.x - nx * w, y: tele.y - ny * w },
			];
			if (!tele.fired) {
				// 발동이 가까울수록 진해진다 — "지금 비켜야 한다"가 읽히게
				g.fillStyle(0xff5a3c, 0.08 + 0.10 * progress + 0.05 * pulse);
				g.fillPoints(points, true);
				g.lineStyle(2, 0xff8a63, 0.55 + 0.4 * progress);
				g.strokePoints(points, true);
				// 중심 조준선
				g.lineStyle(1.5, 0xffc07a, 0.5 + 0.4 * pulse);
				g.beginPath();
				g.moveTo(tele.x, tele.y);
				g.lineTo(x2, y2);
				g.strokePath();
			} else {
				g.fillStyle(0xffe0b0, 0.55);
				g.fillPoints(points, true);
			}
		}
	}

	// ---------------------------------------------------------------
	// Affix per-frame effects: regen / accelerate / frenzy / blink / summon / aura
	// ---------------------------------------------------------------

	updateAffixTicks(enemy: ManagedEnemy, player: PlayerSprite, now: number, delta: number): void {
		// 재생: 초당 % 회복 (1초 단위 적용)
		if ((enemy.regenPerSec ?? 0) > 0 && enemy.hp < enemy.maxHp) {
			enemy.regenAcc = (enemy.regenAcc ?? 0) + delta;
			if (enemy.regenAcc >= 1000) {
				enemy.regenAcc -= 1000;
				enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.max(1, Math.round(enemy.maxHp * enemy.regenPerSec!)));
			}
		}

		// 가속: 시간이 갈수록 빨라진다
		if ((enemy.accelPerSec ?? 0) > 0) {
			enemy.accelFactor = Math.min(enemy.accelMax ?? 1.8, (enemy.accelFactor ?? 1) + enemy.accelPerSec! * (delta / 1000));
		}

		// 격노: 체력이 임계 아래로 떨어지면 1회 발동
		if (!enemy.frenzied && (enemy.frenzyThreshold ?? 0) > 0 && enemy.hp / enemy.maxHp <= enemy.frenzyThreshold!) {
			enemy.frenzied = true;
			enemy.damage = Math.round(enemy.damage * (enemy.frenzyDamageMult ?? 1.4));
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 14, r1: 36, w: 3, color: 0xef4444, alpha: 0.9, dur: 320 });
			}
		}

		// 점멸: 주기적으로 플레이어 쪽으로 순간이동 (검벽 안쪽 침투)
		if ((enemy.blinkIntervalMs ?? 0) > 0) {
			enemy.blinkTimer = (enemy.blinkTimer ?? 0) + delta;
			const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
			if (enemy.blinkTimer >= enemy.blinkIntervalMs! && distance > 130) {
				enemy.blinkTimer = 0;
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				const jump = Math.min(enemy.blinkRange ?? 170, distance - 70);
				// 왜 순간이동했는지 읽히도록 출발·도착 양쪽에 보라 고리 + '점멸' 표기.
				// 예전 점 2개는 너무 작아 어픽스인 줄 모르고 버그로 보였다.
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 8, r1: 44, w: 3, color: 0xc084fc, alpha: 0.85, dur: 300 });
					this.scene.visualEffects?.fxDot(enemy.x, enemy.y, { r: 12, color: 0xc084fc, alpha: 0.5, scale1: 0.3, dur: 260 });
				}
				enemy.setPosition(enemy.x + Math.cos(angle) * jump, enemy.y + Math.sin(angle) * jump);
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 40, r1: 12, w: 3, color: 0xc084fc, alpha: 0.9, dur: 240 });
					this.scene.visualEffects?.showDamageText?.(enemy.x, enemy.y - 44, '점멸', false, '#c084fc');
				}
			}
		}

		// 소환: 주기적으로 하수인 스폰 (전장 과밀 시 건너뜀)
		if ((enemy.summonIntervalMs ?? 0) > 0 && enemy.summonId) {
			enemy.summonTimer = (enemy.summonTimer ?? 0) + delta;
			if (enemy.summonTimer >= enemy.summonIntervalMs!) {
				enemy.summonTimer = 0;
				const aliveCount = this.enemies.countActive(true);
				if (aliveCount < 150) {
					for (let i = 0; i < (enemy.summonCount ?? 2); i += 1) {
						this.spawnEnemy(this.scene, player, enemy.summonId, {
							x: enemy.x + Phaser.Math.Between(-40, 40),
							y: enemy.y + Phaser.Math.Between(-40, 40),
						});
					}
					if (!reduceMotion()) {
						this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 20, r1: 40, w: 2, color: 0xfacc15, alpha: 0.8, dur: 300 });
					}
				}
			}
		}

		// 오라: 주기적으로 주변 아군에게 버프 부여
		if ((enemy.auraRadius ?? 0) > 0) {
			enemy.auraTimer = (enemy.auraTimer ?? 0) + delta;
			if (enemy.auraTimer >= 900) {
				enemy.auraTimer = 0;
				const radiusSquared = enemy.auraRadius! * enemy.auraRadius!;
				const nearbyAllies = this.queryRadius(enemy.x, enemy.y, enemy.auraRadius!, this.auraQueryBuffer) as ManagedEnemy[];
				for (const ally of nearbyAllies) {
					if (ally === enemy || ally.isDying) {
						continue;
					}
					const dx = ally.x - enemy.x;
					const dy = ally.y - enemy.y;
					if (dx * dx + dy * dy > radiusSquared) {
						continue;
					}
					ally.auraBuffUntil = now + 1200;
					ally.auraBuffDamageMult = enemy.auraDamageMult ?? 1.3;
					ally.auraBuffSpeedMult = enemy.auraSpeedMult ?? 1.15;
				}
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: enemy.auraRadius!, r1: enemy.auraRadius!, w: 1.5, color: 0xd9a83c, alpha: 0.4, dur: 520, ease: 'lin' });
				}
			}
		}
	}

	/** 독 장판 갱신: 플레이어가 밟고 있으면 틱 피해 */
	updateHazards(player: PlayerSprite, now: number, delta: number): void {
		if (this.hazards.length === 0) {
			return;
		}
		for (let i = this.hazards.length - 1; i >= 0; i -= 1) {
			const hazard = this.hazards[i];
			if (now >= hazard.until) {
				hazard.zone.destroy();
				this.hazards.splice(i, 1);
				continue;
			}
			if (player.isDead) {
				continue;
			}
			const dx = player.x - hazard.x;
			const dy = player.y - hazard.y;
			if (dx * dx + dy * dy <= hazard.radius * hazard.radius) {
				hazard.tickAcc += delta;
				if (hazard.tickAcc >= 500) {
					hazard.tickAcc = 0;
					this.scene.applyPlayerDamage?.(Math.max(1, Math.round(hazard.dps * 0.5 * this.totalDamageMult())), hazard.x, hazard.y, 'magic', '부식 웅덩이');
				}
			}
		}
	}

	spawnHazard(x: number, y: number, spec: { radius: number; durationMs: number; dps: number }): void {
		// 장판 과밀 방지 (성능/가독성)
		if (this.hazards.length >= 14) {
			const oldest = this.hazards.shift();
			oldest?.zone.destroy();
		}
		const zone = this.scene.add.circle(x, y, spec.radius, 0x4ade80, 0.14)
			.setStrokeStyle(2, 0x4ade80, 0.45)
			.setDepth(3);
		this.hazards.push({
			x,
			y,
			radius: spec.radius,
			until: (this.scene.time?.now ?? 0) + spec.durationMs,
			dps: spec.dps,
			tickAcc: 0,
			zone,
		});
	}

	/** 접촉 피해 계산: 오라 버프 반영 (GameScene 접촉 핸들러가 사용) */
	/**
	 * 필살기 파훼 (2026-09-04): 반경 안 보스/중간보스의 미발동 예고를 취소하고 시전을 끊는다.
	 * @returns 끊긴 개체 수
	 */
	interruptBossCasts(x: number, y: number, radius: number): number {
		const now = this.scene?.time?.now ?? 0;
		const r2 = radius * radius;
		let count = 0;
		for (const enemy of this.enemies.getChildren() as EnemySprite[]) {
			if (!this.isAliveEnemy(enemy) || !(enemy.catalog?.isBoss || enemy.catalog?.isMiniboss)) {
				continue;
			}
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > r2) {
				continue;
			}
			let cancelled = false;
			for (let i = this.bossTelegraphs.length - 1; i >= 0; i -= 1) {
				if (this.bossTelegraphs[i].caster === enemy && !this.bossTelegraphs[i].fired) {
					this.bossTelegraphs.splice(i, 1);
					cancelled = true;
				}
			}
			if (cancelled || (enemy.castingUntil ?? 0) > now) {
				enemy.castingUntil = now + 600;
				enemy.nextSkillAt = Math.max(enemy.nextSkillAt ?? 0, now + 2500);
				count += 1;
				this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 60, '시전 중단', false, '#e879f9');
			}
		}
		return count;
	}

	/** 유인 횃불 (스킬 트리): 반경 안 잡몹이 이 지점으로 몰린다. null 이면 없음. */
	lure: { x: number; y: number; radius: number; until: number } | null = null;

	setLure(x: number, y: number, radius: number, durationMs: number): void {
		this.lure = { x, y, radius, until: (this.scene?.time?.now ?? 0) + durationMs };
	}

	private lureApplies(enemy: EnemySprite): boolean {
		const lure = this.lure;
		if (!lure || enemy.catalog?.isBoss || enemy.catalog?.isMiniboss || enemy.catalog?.isReaper) {
			return false;
		}
		const dx = enemy.x - lure.x;
		const dy = enemy.y - lure.y;
		return dx * dx + dy * dy <= lure.radius * lure.radius;
	}

	/** 라운드 피해 배율 × 성장 배율 — 접촉·투사체·자폭·웅덩이 전부 이 값을 쓴다. */
	totalDamageMult(): number {
		return this.damageMult * this.growthDamageMult;
	}

	effectiveContactDamage(enemy: EnemySprite): number {
		const now = this.scene?.time?.now ?? 0;
		const auraMult = now < (enemy.auraBuffUntil ?? 0) ? (enemy.auraBuffDamageMult ?? 1) : 1;
		return Math.round((enemy.damage ?? this.enemyDamage) * auraMult);
	}

	// ---------------------------------------------------------------
	// Behaviors: ranged / bomber / healer / default chase
	// ---------------------------------------------------------------

	updateEnemyBehavior(enemy: ManagedEnemy, player: PlayerSprite, now: number, delta: number): void {
		const behavior = enemy.behavior;
		const slowed = now < (enemy.slowUntil ?? 0) && !enemy.slowImmune;
		let speed = (enemy.speed ?? this.enemySpeed) * (slowed ? (enemy.slowFactor ?? 1) : 1);
		// 어픽스/오라 속도 보정
		speed *= enemy.accelFactor ?? 1;
		if (enemy.frenzied) {
			speed *= enemy.frenzySpeedMult ?? 1.6;
		}
		if (now < (enemy.auraBuffUntil ?? 0)) {
			speed *= enemy.auraBuffSpeedMult ?? 1;
		}
		const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
		// hasty 어픽스 배수 × 라운드 스케일 — 스폰 시 계산해 둔 값을 읽는다 (매 프레임 카탈로그 조회 제거)
		const fireIntervalMult = enemy.fireIntervalMult ?? 1;
		// 사거리·유지거리 라운드 배율 (2026-09-06) — 후반에는 더 멀리서 쏜다
		const rangeMult = enemy.rangeMult ?? 1;

		if (behavior?.type === 'charger') {
			this.updateCharger(enemy, player, behavior, now, speed, distance);
			return;
		}

		if (behavior?.type === 'ranged') {
			const range = (behavior.range ?? 380) * rangeMult;

			if (distance > range) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < range * 0.6) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed * 0.8, Math.sin(angle) * speed * 0.8);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.fireTimer += delta;
			if (enemy.fireTimer >= (behavior.fireIntervalMs ?? 2200) * fireIntervalMult && distance <= range * 1.2) {
				enemy.fireTimer = 0;
				this.fireProjectiles(enemy, player, behavior);
			}
			return;
		}

		// ── 결집 사수 (volley): 검 스캔 반경(300) 밖을 지키며 느린 유도탄을 흩뿌린다.
		// 검이 자동으로 못 잡는 자리라, 활공 사냥(Q)으로 직접 지목해 끊어야 한다.
		if (behavior?.type === 'volley') {
			const keepDistance = (behavior.keepDistance ?? 470) * rangeMult;
			if (distance > keepDistance + 70) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < keepDistance - 70) {
				// 너무 가까워지면 물러선다 (검 궤도 안으로 들어오지 않는다)
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.volleyTimer = (enemy.volleyTimer ?? 0) + delta;
			if (enemy.volleyTimer >= (behavior.fireIntervalMs ?? 3400) * fireIntervalMult
				&& distance <= keepDistance + 240) {
				enemy.volleyTimer = 0;
				this.fireProjectiles(enemy, player, behavior);
				if (!reduceMotion()) {
					this.scene.visualEffects?.fxRing(enemy.x, enemy.y,
						{ r0: 10, r1: 46, w: 2, color: 0x7fd4e8, alpha: 0.7, dur: 300 });
				}
			}
			return;
		}

		// ── 장막 소환수 (veil): 중거리를 지키며 주기적으로 정지 장막을 깐다.
		// 장막 안의 적은 받는 피해가 줄어든다 — 장막을 없애려면 시전자를 지목해 끊어야 한다.
		if (behavior?.type === 'veil') {
			const keepDistance = (behavior.keepDistance ?? 380) * rangeMult;
			if (distance > keepDistance + 60) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < keepDistance - 60) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.veilTimer = (enemy.veilTimer ?? 0) + delta;
			if (enemy.veilTimer >= (behavior.veilIntervalMs ?? 7000) * fireIntervalMult) {
				enemy.veilTimer = 0;
				this.plantVeil(enemy, behavior, now);
			}
			return;
		}

		if (behavior?.type === 'summoner' || behavior?.type === 'aura') {
			// 소환수/오라 시전자는 중거리를 유지하며 따라온다 (틱은 updateAffixTicks에서)
			const keepDistance = (behavior.keepDistance ?? 340) * rangeMult;
			if (distance > keepDistance + 60) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (behavior.type === 'summoner' && distance < keepDistance - 60) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
			} else if (behavior.type === 'aura') {
				// 깃발수는 물러서지 않고 계속 전진한다
				this.scene.physics.moveTo(enemy, player.x, player.y, speed * 0.7);
			} else {
				enemy.setVelocity(0, 0);
			}
			return;
		}

		// blinker: 평소엔 추적 (점멸은 updateAffixTicks에서)

		if (behavior?.type === 'bomber') {
			if (enemy.fuseStartedAt > 0) {
				enemy.setVelocity(0, 0);
				if (now - enemy.fuseStartedAt >= (behavior.fuseMs ?? 900)) {
					this.explodeBomber(enemy, player, behavior);
				}
				return;
			}

			if (distance <= 130) {
				enemy.fuseStartedAt = now;
				enemy.setVelocity(0, 0);
				this.scene.tweens.add({
					targets: enemy,
					scaleX: enemy.scaleX * 1.35,
					scaleY: enemy.scaleY * 1.35,
					yoyo: true,
					repeat: 3,
					duration: (behavior.fuseMs ?? 900) / 8,
				});
				enemy.setTintFill(0xff6b6b);
				return;
			}

			this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			return;
		}

		if (behavior?.type === 'healer') {
			const keepDistance = (behavior.keepDistance ?? 320) * rangeMult;

			if (distance > keepDistance + 60) {
				this.scene.physics.moveTo(enemy, player.x, player.y, speed);
			} else if (distance < keepDistance - 60) {
				const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
				enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
			} else {
				enemy.setVelocity(0, 0);
			}

			enemy.healTimer += delta;
			if (enemy.healTimer >= (behavior.healIntervalMs ?? 2500) * fireIntervalMult) {
				enemy.healTimer = 0;
				this.healPulse(enemy, behavior);
			}
			return;
		}

		this.scene.physics.moveTo(enemy, player.x, player.y, speed);
	}

	/** hasty 어픽스의 발동 주기 배수 (없으면 1). 값은 applyAffixes에서 캐시된다. */
	fireIntervalMultFor(enemy: ManagedEnemy): number {
		return enemy.fireIntervalMult ?? 1;
	}

	// ---------------------------------------------------------------
	// 장막 지대 — 장막 소환수(veil-caller)가 까는 피해 감소 구역
	// ---------------------------------------------------------------

	/** 시전자 발밑에 장막을 깐다. 오래된 장막부터 밀어내 개수를 제한한다. */
	plantVeil(enemy: ManagedEnemy, behavior: EnemyBehaviorSpec, now: number): void {
		if (this.veils.length >= EnemyManager.VEIL_MAX) {
			this.veils.shift();
		}
		const radius = behavior.veilRadius ?? 190;
		this.veils.push({
			x: enemy.x,
			y: enemy.y,
			radius,
			until: now + (behavior.veilDurationMs ?? 6500),
			damageMult: behavior.veilDamageMult ?? 0.45,
			owner: enemy,
			ownerGen: enemy.spawnGeneration ?? 0,
			nextPulseAt: 0,
		});
		if (!reduceMotion()) {
			this.scene.visualEffects?.fxRing(enemy.x, enemy.y,
				{ r0: 16, r1: radius, w: 3, color: 0xa78bfa, alpha: 0.85, dur: 420 });
		}
		this.scene.soundSystem?.play('warning', { volume: 0.28 });
	}

	/**
	 * 장막 만료·시전자 사망 정리 + 맥동 연출.
	 * 연출은 공유 FX 레이어(fxRing)만 쓴다 — 지속 오브젝트를 만들지 않는다.
	 */
	updateVeils(now: number): void {
		if (this.veils.length === 0) {
			return;
		}
		const motion = !reduceMotion();
		for (let i = this.veils.length - 1; i >= 0; i -= 1) {
			const veil = this.veils[i];
			const ownerAlive = this.isAliveEnemy(veil.owner)
				&& !veil.owner.isDying
				&& veil.owner.spawnGeneration === veil.ownerGen;
			// 시전자를 끊으면 장막이 즉시 걷힌다 — 지목 타격의 보상
			if (!ownerAlive || now >= veil.until) {
				if (motion) {
					this.scene.visualEffects?.fxRing(veil.x, veil.y,
						{ r0: veil.radius, r1: 12, w: 2.5, color: 0xd8c8ff, alpha: 0.75, dur: 320 });
				}
				this.veils.splice(i, 1);
				continue;
			}
			if (motion && now >= veil.nextPulseAt) {
				veil.nextPulseAt = now + 620;
				this.scene.visualEffects?.fxRing(veil.x, veil.y,
					{ r0: veil.radius, r1: veil.radius, w: 2, color: 0xa78bfa, alpha: 0.42, dur: 600, ease: 'lin' });
				this.scene.visualEffects?.fxRing(veil.x, veil.y,
					{ r0: veil.radius * 0.35, r1: veil.radius * 0.92, w: 1.5, color: 0xd8c8ff, alpha: 0.3, dur: 600 });
			}
		}
	}

	/** (x, y) 에 걸린 장막의 피해 배율 (겹치면 가장 강한 감소 1개만 — 무한 중첩 금지). */
	veilDamageMultAt(x: number, y: number): number {
		if (this.veils.length === 0) {
			return 1;
		}
		let mult = 1;
		for (const veil of this.veils) {
			const dx = x - veil.x;
			const dy = y - veil.y;
			if (dx * dx + dy * dy <= veil.radius * veil.radius && veil.damageMult < mult) {
				mult = veil.damageMult;
			}
		}
		return mult;
	}

	/** 돌진형: 접근 → 조준(정지·텔레그래프) → 돌진 → 재정비 */
	updateCharger(
		enemy: ManagedEnemy,
		player: PlayerSprite,
		behavior: EnemyBehaviorSpec,
		now: number,
		speed: number,
		distance: number,
	): void {
		const phase = enemy.chargePhase ?? 'approach';

		if (phase === 'windup') {
			enemy.setVelocity(0, 0);
			if (now >= (enemy.chargePhaseUntil ?? 0)) {
				// 조준 종료 시점의 플레이어 위치로 각도 고정 → 돌진
				enemy.chargeAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				enemy.chargePhase = 'dash';
				enemy.chargePhaseUntil = now + (behavior.dashDurationMs ?? 480);
				const dashSpeed = behavior.dashSpeed ?? 430;
				enemy.setVelocity(Math.cos(enemy.chargeAngle) * dashSpeed, Math.sin(enemy.chargeAngle) * dashSpeed);
			}
			return;
		}

		if (phase === 'dash') {
			if (now >= (enemy.chargePhaseUntil ?? 0)) {
				enemy.chargePhase = 'cooldown';
				enemy.chargePhaseUntil = now + (behavior.dashCooldownMs ?? 2100);
				enemy.setVelocity(0, 0);
			}
			return;
		}

		if (phase === 'cooldown') {
			this.scene.physics.moveTo(enemy, player.x, player.y, speed * 0.6);
			if (now >= (enemy.chargePhaseUntil ?? 0)) {
				enemy.chargePhase = 'approach';
			}
			return;
		}

		// approach
		const dashRange = behavior.dashRange ?? 320;
		if (distance <= dashRange) {
			enemy.chargePhase = 'windup';
			enemy.chargePhaseUntil = now + (behavior.windupMs ?? 650);
			enemy.setVelocity(0, 0);
			// 텔레그래프: 플레이어 방향 조준선 (짧게 표시 후 소멸)
			if (!reduceMotion()) {
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
				this.scene.visualEffects?.fxPoly(
					[enemy.x, enemy.y, enemy.x + Math.cos(angle) * (dashRange + 40), enemy.y + Math.sin(angle) * (dashRange + 40)],
					{ layers: [[3, 0xef4444, 0.55]], dur: behavior.windupMs ?? 650 },
				);
			}
			return;
		}
		this.scene.physics.moveTo(enemy, player.x, player.y, speed);
	}

	/** 투사체 글로우 텍스처 (부드러운 방사형 원 — 가산 블렌드용) 지연 생성 */
	ensureProjectileGlowTexture(): void {
		if (this.scene.textures?.exists('enemy_bullet_glow')) {
			return;
		}
		const g = this.scene.add.graphics();
		const layers: Array<[number, number]> = [[24, 0.10], [18, 0.16], [13, 0.26], [8, 0.5], [4, 0.9]];
		for (const [radius, alpha] of layers) {
			g.fillStyle(0xff6b5e, alpha);
			g.fillCircle(24, 24, radius);
		}
		g.generateTexture('enemy_bullet_glow', 48, 48);
		g.destroy();
	}

	fireProjectiles(enemy: ManagedEnemy, player: PlayerSprite, behavior: EnemyBehaviorSpec): void {
		const count = behavior.projectileCount ?? 1;
		const spread = Phaser.Math.DegToRad(behavior.spreadDeg ?? 0);
		const baseAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
		this.ensureProjectileGlowTexture();

		for (let i = 0; i < count; i += 1) {
			const offset = count > 1 ? spread * (i / (count - 1) - 0.5) : 0;
			// 유도탄(결집 사수): 선회량을 제한해 반드시 회피 가능하게 둔다.
			// 탄속은 플레이어 이동속도(350)보다 훨씬 느리므로 대시는 물론 걸어서도 떨어진다.
			this.spawnEnemyBullet(enemy.x, enemy.y, baseAngle + offset, {
				// 라운드 스케일 (2026-09-06) — 상한 있음(roundScaling.projectileSpeedCap).
				// 고정 탄속은 후반에 "걸어서도 피해지는 느린 점"이 된다.
				speed: (behavior.projectileSpeed ?? 260) * (enemy.projectileSpeedMult ?? 1),
				// 투사체 고정 피해는 라운드 배율을 전혀 타지 않아 10라 뒤엔 무의미했다 → 접촉 피해와 같은 배율 (2026-09-04)
				damage: Math.max(1, Math.round((behavior.projectileDamage ?? 12) * this.totalDamageMult())),
				shooterName: enemy.catalog?.name ?? enemy.enemyType ?? undefined,
				lifeMs: behavior.projectileLifeMs ?? 4500,
				homingTurnRate: behavior.homingTurnRate ?? 0,
			});
		}
	}

	updateProjectiles(now: number, delta = 16): void {
		const player = this.scene?.player;
		const seconds = delta / 1000;
		for (const bullet of this.projectiles.getChildren() as ManagedProjectile[]) {
			if (!bullet.active) {
				continue;
			}
			if (now >= (bullet.expiresAt ?? 0)) {
				this.recycleProjectile(bullet);
				continue;
			}

			// 유도탄: 초당 선회량 상한 안에서만 플레이어 쪽으로 각도를 튼다.
			// (상한이 있으므로 대시 한 번이면 축이 어긋나 그대로 스쳐 지나간다)
			const turnRate = bullet.homingTurnRate ?? 0;
			if (turnRate > 0 && player && !player.isDead && bullet.body) {
				const body = bullet.body as Phaser.Physics.Arcade.Body;
				const current = Math.atan2(body.velocity.y, body.velocity.x);
				const desired = Math.atan2(player.y - bullet.y, player.x - bullet.x);
				const diff = Phaser.Math.Angle.Wrap(desired - current);
				const maxTurn = turnRate * seconds;
				const next = current + Phaser.Math.Clamp(diff, -maxTurn, maxTurn);
				const speed = bullet.homingSpeed ?? 130;
				bullet.setVelocity(Math.cos(next) * speed, Math.sin(next) * speed);
				bullet.setRotation(next);
			}

			// 글로우가 투사체를 따라간다
			bullet.glow?.setPosition(bullet.x, bullet.y);
		}
	}

	/**
	 * (x, y) 반경 안의 적 투사체를 지운다 — 귀소(SPACE)가 날아드는 유도탄을 쳐내는 경로.
	 * @returns 실제로 지운 개수 (테스트/연출 판정용)
	 */
	clearProjectilesNear(x: number, y: number, radius: number): number {
		const radiusSquared = radius * radius;
		let cleared = 0;
		for (const bullet of this.projectiles.getChildren() as ManagedProjectile[]) {
			if (!bullet.active) {
				continue;
			}
			const dx = bullet.x - x;
			const dy = bullet.y - y;
			if (dx * dx + dy * dy > radiusSquared) {
				continue;
			}
			this.recycleProjectile(bullet);
			cleared += 1;
		}
		return cleared;
	}

	recycleProjectile(bullet: EnemyProjectile | null | undefined): void {
		if (!bullet) {
			return;
		}
		bullet.setVelocity(0, 0);
		bullet.disableBody?.(true, true);
		bullet.setActive(false);
		bullet.setVisible(false);
		// 풀 재사용 대비: 유도 파라미터가 다음 직선탄으로 새지 않게 지운다
		bullet.homingTurnRate = 0;
		(bullet as ManagedProjectile).glow?.setVisible(false).setActive(false);
	}

	/**
	 * Tiny Swords 폭발 스프라이트 재생 (로드 실패 시 무시 — 원형 이펙트가 폴백).
	 * 6개 풀을 순환한다. 폭발마다 add.sprite + destroy 하면 DisplayList가 매번 depth 재정렬을
	 * 예약하고 GC 압력도 커진다 (후반 라운드 초당 수십 회 호출).
	 */
	playExplosionSprite(x: number, y: number, radius: number): void {
		if (!this.scene.anims?.exists('fx-explosion')) {
			return;
		}
		const EXPLOSION_POOL_MAX = 6;
		let boom = this.explosionPool[this.explosionCursor];
		if (!boom || !boom.scene) {
			boom = this.scene.add.sprite(x, y, 'fx-explosion-sheet').setDepth(59);
			boom.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom!.setVisible(false).setActive(false));
			this.explosionPool[this.explosionCursor] = boom;
		}
		this.explosionCursor = (this.explosionCursor + 1) % EXPLOSION_POOL_MAX;
		boom.setPosition(x, y).setVisible(true).setActive(true);
		boom.setDisplaySize(radius * 2.2, radius * 2.2);
		boom.play('fx-explosion');
	}

	explodeBomber(enemy: ManagedEnemy, player: PlayerSprite, behavior: EnemyBehaviorSpec): void {
		const radius = behavior.explodeRadius ?? 170;
		this.scene.visualEffects?.fxDot(enemy.x, enemy.y, { r: radius, color: 0xf97316, alpha: 0.25, scale1: 1.15, dur: 260 });
		this.playExplosionSprite(enemy.x, enemy.y, radius);
		this.scene.cameras.main.shake(200, 0.006);
		this.scene.soundSystem?.play('bigkill', { volume: 0.6 });

		if (player && !player.isDead
			&& Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y) <= radius) {
			this.scene.applyPlayerDamage?.(Math.round((behavior.explodeDamage ?? 40) * this.totalDamageMult()), enemy.x, enemy.y, 'magic', enemy.catalog?.name ?? enemy.enemyType ?? null);
		}

		// The bomber consumes itself (no split, no XP boost - xpValue still granted via die)
		this.die(enemy, player);
	}

	healPulse(healer: ManagedEnemy, behavior: EnemyBehaviorSpec): void {
		const radius = behavior.healRadius ?? 260;
		const radiusSquared = radius * radius;
		let healedAny = false;

		for (const ally of this.queryRadius(healer.x, healer.y, radius, this.healQueryBuffer) as ManagedEnemy[]) {
			if (ally === healer || ally.isDying) {
				continue;
			}

			const dx = ally.x - healer.x;
			const dy = ally.y - healer.y;
			if (dx * dx + dy * dy > radiusSquared) {
				continue;
			}

			if (ally.hp < ally.maxHp) {
				ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(ally.maxHp * (behavior.healPercent ?? 0.12)));
				healedAny = true;
			}
		}

		if (healedAny) {
			this.scene.visualEffects?.fxRing(healer.x, healer.y, { r0: radius, r1: radius, w: 2, color: 0x4ade80, alpha: 0.7, dur: 420, ease: 'lin' });
		}
	}

	// Damage-over-time (sword burn/poison specials)
	applyDot(enemy: EnemySprite, dps: number, durationMs: number, color: number = 0xf97316): void {
		if (!this.isAliveEnemy(enemy)) {
			return;
		}

		// 지속 피해 면역: juggernaut(purge) 어픽스 · 막힌 핏줄 특성
		if (enemy.dotImmune) {
			return;
		}

		const now = this.scene.time?.now ?? 0;
		enemy.dotUntil = now + durationMs;
		enemy.dotDps = Math.max(enemy.dotDps ?? 0, dps);
		enemy.dotColor = color;
	}

	updateDot(enemy: ManagedEnemy, now: number, delta: number): void {
		if (!enemy.dotUntil || now >= enemy.dotUntil) {
			enemy.dotDps = 0;
			return;
		}

		enemy.dotTick = (enemy.dotTick ?? 0) + delta;
		if (enemy.dotTick >= 500) {
			enemy.dotTick = 0;
			const tickDamage = Math.max(1, Math.round(enemy.dotDps * 0.5));
			enemy.lastDamageWasCrit = false;
			this.takeDamage(enemy, tickDamage, this.scene?.player, { silent: true });
			// 색은 StatusEffectSystem 이 매 프레임 잡는다 (여기서 setTint 하면 복구할 곳이 없다).
			// 숫자만 상태이상 색으로 작게 띄운다.
			if (enemy.active && !enemy.isDying) {
				const poison = enemy.dotColor === 0x4ade80 || enemy.dotColor === 0x84b04a;
				this.scene?.visualEffects?.showStatusDamageText?.(
					enemy.x, enemy.y - 16, tickDamage, poison ? 'poison' : 'burn',
				);
			}
		}
	}

	// Round transition: wipe the field (bosses and the reaper survive)
	clearField(): void {
		// 라운드 전환 시 남은 텔레그래프 정리 (마을·다음 라운드로 새지 않게)
		this.bossTelegraphs.length = 0;
		if (this.telegraphG) {
			this.telegraphG.clear();
			this.telegraphDrawn = false;
		}
		for (const enemy of this.enemies.getChildren() as ManagedEnemy[]) {
			if (!this.isAliveEnemy(enemy)) {
				continue;
			}
			if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			this.recycleEnemy(enemy);
		}

		for (const bullet of this.projectiles.getChildren() as ManagedProjectile[]) {
			this.recycleProjectile(bullet);
		}

		for (const hazard of this.hazards) {
			hazard.zone.destroy();
		}
		this.hazards = [];
		// 장막은 라운드 경계에서 통째로 걷는다 (마을·다음 라운드로 새지 않게)
		this.veils.length = 0;
	}

	takeDamage(
		enemy: EnemySprite,
		amount: number,
		player: PlayerSprite | undefined = this.scene?.player,
		options: TakeDamageOptions = {},
	): void {
		if (!this.isAliveEnemy(enemy) || enemy.isDying) {
			return;
		}

		// veiled 어픽스: 검격 회피 (DoT 등 silent 피해는 회피 불가)
		if (!options.silent && (enemy.dodgeChance ?? 0) > 0 && Math.random() < enemy.dodgeChance!) {
			this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 20, '회피', false, '#94a3b8');
			return;
		}

		// shielded 어픽스: 앞의 N회 타격을 무효화
		if (!options.silent && (enemy.shieldHits ?? 0) > 0) {
			enemy.shieldHits! -= 1;
			this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 20, '방어', false, '#38bdf8');
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 16, r1: 26, w: 2, color: 0x38bdf8, alpha: 0.85, dur: 200 });
			}
			return;
		}

		// Typed mitigation: physical/magic resist, reduced by the attacker's penetration.
		// ignoreResist (true damage, %HP damage) bypasses everything.
		if (!options.ignoreResist) {
			let resist = resistFor(options.damageType, enemy.physicalResist ?? 0, enemy.magicResist ?? 0);
			// 독 6세트 [부식]: 중독된 적의 방어가 녹는다
			if ((enemy.dotUntil ?? 0) > (this.scene?.time?.now ?? 0)
				&& this.scene?.elementSets?.has('poison.corrode')) {
				resist *= 0.75;
			}
			// 관통 스탯(치명타 100% 해금)은 검·세트 관통 위에 더해진다. 여기서 합치는
			// 이유는 스킬·세트 발동이 getDamageInfo 를 거치지 않고 pen 을 직접 넘기기 때문.
			const pen = (options.pen ?? 0) + (player?.pen ?? 0);
			amount = mitigateEnemyDamage(amount, resist, pen);
		}

		// 처형(치명타 100% 해금): 체력이 바닥난 적에게 주는 피해가 오른다.
		// 저항 뒤에 곱해 트루 피해에도 걸리고, 마무리 구간만 빨라진다.
		const executeBonus = player?.executeDamage ?? 0;
		if (executeBonus > 0 && enemy.maxHp > 0 && enemy.hp / enemy.maxHp <= EXECUTE_HP_THRESHOLD) {
			amount = Math.max(1, amount * (1 + executeBonus));
		}

		// 특성(몸체) 상성: 원소 검 ↔ 적 특성의 약점/저항 배율.
		// 저항 무시(트루 피해)와는 별개 축이라 항상 적용된다.
		let traitMult = 1;
		if (options.element && enemy.traitIds?.length) {
			traitMult = this.traitMultFor(enemy, options.element);
			if (traitMult !== 1) {
				amount = Math.max(1, amount * traitMult);
			}
			// "약점!" 피드백 — 연타 도배를 막기 위해 개체당 0.9초 스로틀
			if (traitMult > 1.01 && !options.silent) {
				const traitNow = this.scene?.time?.now ?? 0;
				if (traitNow >= (enemy.weakTextAt ?? 0)) {
					enemy.weakTextAt = traitNow + 900;
					this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 38, '약점!', false, '#ffab5e');
				}
			}
		}

		// 장막 지대: 안에 선 적은 받는 피해가 줄어든다 (장막 소환수를 끊으면 즉시 풀린다).
		// 저항과 달리 관통·트루 피해로도 못 뚫는다 — "지대를 걷어내라"가 유일한 답.
		if (this.veils.length > 0) {
			const veilMult = this.veilDamageMultAt(enemy.x, enemy.y);
			if (veilMult < 1) {
				amount *= veilMult;
				if (!options.silent) {
					const veilNow = this.scene?.time?.now ?? 0;
					if (veilNow >= (enemy.veilTextAt ?? 0)) {
						enemy.veilTextAt = veilNow + 900;
						this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 38, '장막', false, '#c4b5fd');
					}
				}
			}
		}

		// 원소 세트 취약: 감전 / 빙결 / 부식이 겹치면 받는 피해가 함께 커진다
		const sets = this.scene?.elementSets;
		if (sets && sets.vulnerabilityActive) {
			const vuln = sets.vulnerabilityFor(enemy, this.scene?.time?.now ?? 0);
			if (vuln !== 1) {
				amount *= vuln;
			}
		}

		// 스킬 트리 [표식]: 활공이 지목한 사냥감은 받는 피해가 늘어난다
		if ((enemy.huntMarkUntil ?? 0) > (this.scene?.time?.now ?? 0) && (enemy.huntMarkMult ?? 1) > 1) {
			amount *= enemy.huntMarkMult!;
		}
		// 스킬 트리 [감속 적 피해 +] / [빙결 적 피해 +]
		const treeMods = this.scene?.skillTree?.mods;
		if (treeMods && (treeMods.slowedDamageAdd > 0 || treeMods.frozenDamageAdd > 0)) {
			const tnow = this.scene?.time?.now ?? 0;
			const slowed = ((enemy.slowFactor ?? 1) < 1 && (enemy.slowUntil ?? 0) > tnow)
				|| (enemy.setShockUntil ?? 0) > tnow || (enemy.setFrozenUntil ?? 0) > tnow;
			if (slowed) {
				amount *= 1 + treeMods.slowedDamageAdd;
				if ((enemy.slowFactor ?? 1) <= 0.3 || (enemy.setFrozenUntil ?? 0) > tnow) {
					amount *= 1 + treeMods.frozenDamageAdd;
				}
			}
		}

		enemy.hp -= amount;

		// thorny 어픽스: 피격 시 일정 확률로 플레이어에게 가시침 발사
		if (!options.silent && (enemy.thornChance ?? 0) > 0 && player && !player.isDead
			&& Math.random() < enemy.thornChance!) {
			this.fireProjectiles(enemy as ManagedEnemy, player, {
				type: 'ranged',
				projectileCount: 1,
				projectileSpeed: 300,
				projectileDamage: Math.max(4, Math.round((enemy.damage ?? 10) * (enemy.thornDamageMult ?? 0.5))),
				damageType: 'magic',
			});
		}

		// Show damage text and health bar (magic = blue, true = gold)
		const isCrit = enemy.lastDamageWasCrit ?? false;
		// 지속피해(DoT) 틱은 silent — 수치 텍스트를 띄우지 않는다.
		// 화상/독이 깔린 적 150마리 × 초당 2틱 = 초당 300개 텍스트 요청이 되어 예산제를 포화시켰다.
		if (this.scene?.visualEffects && !options.silent) {
			// 상성 색: 약점 = 호박색, 저항 = 강회색 (트루 피해·마법 피해 색보다 우선)
			const textColor = traitMult > 1.01 ? '#ffab5e'
				: traitMult < 0.99 ? '#7f8c99'
					: options.ignoreResist ? '#fde047' : options.damageType === 'magic' ? '#93c5fd' : null;
			this.scene.visualEffects.showDamageText(enemy.x, enemy.y - 20, Math.round(amount), isCrit, textColor);
			// 체력바는 GameScene이 매 프레임 drawEnemyHealthBars로 일괄 렌더
			this.scene.visualEffects.flashSprite(enemy);
		}

		// Knockback away from the player (resisted by elites/bosses)
		const resist = enemy.knockbackResist ?? 0;
		if (!options.silent && resist < 1 && player && enemy.body) {
			const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
			const force = enemyKnockbackForce(resist);
			enemy.setVelocity(Math.cos(angle) * force, Math.sin(angle) * force);
			enemy.knockbackUntil = (this.scene?.time?.now ?? 0) + 140;
		}

		if (isCrit && !options.silent) {
			this.scene?.visualEffects?.hitStop(HIT_STOP.critMs);
		}

		// 보스 피격: 큰 몸에 검이 박히는 무게 (3프레임). 전용 간격으로 제한하지 않으면
		// 검 7자루가 초당 수십 번 때려 화면이 계속 끊긴다.
		if (!options.silent && enemy.catalog?.isBoss && enemy.hp > 0) {
			const nowMs = this.scene?.time?.now ?? 0;
			if (nowMs - this.lastBossHitStopAt >= HIT_STOP.bossHitGapMs) {
				this.lastBossHitStopAt = nowMs;
				this.scene?.visualEffects?.hitStop(HIT_STOP.bossHitMs, { force: true });
			}
		}

		// Play hit animation if spritesheet exists
		if (enemy.catalog && (enemy.catalog.spriteType === 'aseprite' || enemy.catalog.spriteType === 'separate') && enemy.play) {
			const hitAnimKey = `${enemy.catalog.id}-hit`;
			if (this.scene?.anims?.exists(hitAnimKey)) {
				try {
					enemy.play(hitAnimKey, true);
				} catch (err) {
					console.warn(`Failed to play animation ${hitAnimKey}:`, (err as Error).message);
				}
			}
		}

		if (enemy.hp <= 0) {
			this.die(enemy, player);
		}
	}

	/**
	 * 처치 넉백: 죽는 순간 시체가 플레이어 반대쪽으로 튄다.
	 *
	 * 몸집으로 차별화한다 — 잔챙이는 멀리 날아가고 정예·보스는 제자리에서 무너진다.
	 * (같은 힘으로 밀면 모든 처치가 똑같이 물렁하게 느껴진다)
	 * 죽은 개체는 300ms 뒤 회수되므로 이 속도는 사망 연출 동안만 보인다.
	 */
	private applyDeathKnockback(enemy: EnemySprite, player: PlayerSprite | undefined, isBig: boolean): void {
		const body = enemy.body as Phaser.Physics.Arcade.Body | null;
		if (!body || !player) {
			return;
		}
		const resist = enemy.knockbackResist ?? 0;
		if (resist >= 1) {
			return;
		}
		// 표시 높이 64px 을 기준으로 가벼울수록 더 밀린다 (0.5~1.7배)
		const size = enemy.displayHeight || 64;
		const lightness = Phaser.Math.Clamp(64 / size, 0.5, 1.7);
		const force = (isBig ? 90 : 210) * lightness * (1 - resist);
		const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
		enemy.setVelocity(Math.cos(angle) * force, Math.sin(angle) * force);
	}

	die(enemy: EnemySprite, player: PlayerSprite | undefined = this.scene?.player): void {
		if (!enemy || enemy.destroyed || enemy.isDying) {
			return;
		}

		enemy.isDying = true;

		// 원소 세트 온-처치 훅 (작열/전염/폭풍 전파/냉기 폭발/피의 갈증)
		// 시체가 아직 제자리에 있는 지금 호출해야 전파 위치가 맞다.
		this.scene?.elementSets?.onEnemyKilled?.(enemy);

		// Play death animation if spritesheet exists
		if (enemy.catalog && (enemy.catalog.spriteType === 'aseprite' || enemy.catalog.spriteType === 'separate') && enemy.play) {
			const deathAnimKey = `${enemy.catalog.id}-death`;
			if (this.scene?.anims?.exists(deathAnimKey)) {
				try {
					enemy.play(deathAnimKey, true);
				} catch (err) {
					console.warn(`Failed to play animation ${deathAnimKey}:`, (err as Error).message);
				}
			}
		}

		// Splitters spawn children where they fell
		if (enemy.splitInto && this.scene?.player) {
			for (let i = 0; i < (enemy.splitInto.count ?? 2); i += 1) {
				const offsetX = Phaser.Math.Between(-30, 30);
				const offsetY = Phaser.Math.Between(-30, 30);
				this.spawnEnemy(this.scene, this.scene.player, enemy.splitInto.id, {
					x: enemy.x + offsetX,
					y: enemy.y + offsetY,
				});
			}
		}

		// splitting 어픽스: splitInto가 없는 몹도 죽으면 부스러기 2기로 갈라진다
		if (enemy.mitosis && !enemy.splitInto && this.scene?.player) {
			for (let i = 0; i < 2; i += 1) {
				this.spawnEnemy(this.scene, this.scene.player, 'swarmling', {
					x: enemy.x + Phaser.Math.Between(-26, 26),
					y: enemy.y + Phaser.Math.Between(-26, 26),
				});
			}
		}

		// explosive 어픽스: 죽으면서 폭발 — 플레이어가 범위 안이면 피해
		if ((enemy.deathExplodeRadius ?? 0) > 0) {
			const radius = enemy.deathExplodeRadius!;
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxDot(enemy.x, enemy.y, { r: radius, color: 0xfb923c, alpha: 0.25, scale1: 1.15, dur: 240 });
				this.playExplosionSprite(enemy.x, enemy.y, radius);
			}
			if (player && !player.isDead
				&& Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y) <= radius) {
				this.scene.applyPlayerDamage?.(enemy.deathExplodeDamage ?? 20, enemy.x, enemy.y, 'magic', enemy.catalog?.name ?? enemy.enemyType ?? null);
			}
		}

		// toxic 어픽스: 죽은 자리에 독 장판
		if (enemy.deathPool) {
			this.spawnHazard(enemy.x, enemy.y, enemy.deathPool);
		}

		const isBig = Boolean(enemy.catalog?.isElite || enemy.catalog?.isBoss || enemy.catalog?.isMiniboss);
		// 처치 연출 등급 (2026-09-01): 0 일반 · 1 정예 · 2 보스.
		// 보스는 히트스톱 3프레임(bigKillMs 50ms)에 맞춘 단계적 붕괴가 나간다.
		this.scene?.visualEffects?.enemyDeathFX(
			enemy.x, enemy.y, this.deathTierOf(enemy), this.deathColorOf(enemy),
		);
		this.applyDeathKnockback(enemy, player, isBig);

		if (isBig) {
			this.scene?.cameras?.main?.shake(300, 0.008);
			// 대형 처치는 드문 사건이라 간격 제한을 건너뛴다 (3프레임)
			this.scene?.visualEffects?.hitStop(HIT_STOP.bigKillMs, { force: true });
			this.scene?.soundSystem?.play('bigkill');
		} else {
			this.scene?.cameras?.main?.shake(60, 0.0015);
			// 일반 처치는 1~2프레임 — 연속 발동은 VisualEffectsSystem 의 간격 제한이 막는다
			this.scene?.visualEffects?.hitStop(HIT_STOP.killMs);
			this.scene?.soundSystem?.play('kill');
		}

		this.scene?.events?.emit(GameEvents.ENEMY_DIED, {
			enemy,
			x: enemy.x,
			y: enemy.y,
			amount: enemy.xpValue ?? this.xpOrbValue,
			player,
		});

		// Delay recycling slightly to allow death animation to play.
		// 처치 20~50/s에서 TimerEvent+클로저를 매번 만들면 Phaser time 큐가 부풀어 오른다 →
		// FIFO 큐에 넣고 update()에서 앞쪽만 검사한다 (할당 1개, 정렬 불필요).
		this.deathQueue.push({
			enemy,
			generation: enemy.spawnGeneration ?? 0,
			at: (this.scene?.time?.now ?? 0) + 300,
		});
	}

	/** die()가 예약한 회수 작업을 처리한다. 큐는 시간순이므로 앞에서부터 검사하다 멈춘다. */
	private drainDeathQueue(now: number): void {
		let processed = 0;
		while (processed < this.deathQueue.length) {
			const entry = this.deathQueue[processed];
			if (now < entry.at) {
				break;
			}
			// 이미 회수·재스폰된 적이면 건너뛴다 (세대 가드)
			if (entry.enemy.spawnGeneration === entry.generation) {
				this.recycleEnemy(entry.enemy);
			}
			processed += 1;
		}
		if (processed > 0) {
			this.deathQueue.splice(0, processed);
		}
	}

	/**
	 * 처치 연출 등급.
	 *   2 보스 · 1 정예(정예·중간보스·어픽스 보유) · 0 일반
	 * 핫패스에서 불리므로 객체·배열을 만들지 않는다 (숫자 비교만).
	 */
	private deathTierOf(enemy: EnemySprite): 0 | 1 | 2 {
		const config = enemy.catalog;
		if (config?.isBoss) {
			return 2;
		}
		if (config?.isElite || config?.isMiniboss || (enemy.affixIds?.length ?? 0) > 0) {
			return 1;
		}
		return 0;
	}

	/** 파편 색 = 등급색 (어픽스만 있는 잡몹은 그 어픽스의 색을 쓴다) */
	private deathColorOf(enemy: EnemySprite): number {
		const config = enemy.catalog;
		if (config?.isBoss) {
			return RARITY_THEME.legendary.num;
		}
		if (config?.isMiniboss) {
			return RARITY_THEME.epic.num;
		}
		if (config?.isElite) {
			return RARITY_THEME.rare.num;
		}
		return enemy.affixTintColor ?? RARITY_THEME.uncommon.num;
	}

	/**
	 * 머리 위 마커 준비/해제.
	 * 마커 이미지는 적 스프라이트에 붙여 풀과 함께 재사용한다 (스폰마다 새로 만들지 않는다).
	 */
	private applyMarker(enemy: EnemySprite, config: Partial<EnemyDefinition>): void {
		const spec = config.marker;
		if (!spec) {
			enemy.markerOn = false;
			enemy.markerIcon?.setVisible(false);
			return;
		}
		if (!this.scene?.textures?.exists(spec.icon)) {
			enemy.markerOn = false;
			return;
		}
		let icon = enemy.markerIcon ?? null;
		if (!icon || !icon.scene) {
			icon = this.scene.add.image(enemy.x, enemy.y, spec.icon);
			enemy.markerIcon = icon;
		} else {
			icon.setTexture(spec.icon);
		}
		icon.setDepth(2).setDisplaySize(16, 16).setAlpha(0.95).setVisible(true);
		icon.setTint(Phaser.Display.Color.HexStringToColor(spec.color ?? '#ffffff').color);
		enemy.markerOn = true;
	}

	/** @deprecated enemyDeathFX 로 대체 — 구 호출부 호환용으로만 남긴다 */
	playDeathEffect(x: number, y: number, sizeMultiplier = 1): void {
		if (!this.scene) {
			return;
		}

		this.scene.visualEffects?.fxDot(x, y, {
			r: 10 * sizeMultiplier, color: 0xffd166, alpha: 0.9, scale1: 2.5,
			dur: 180 + 80 * (sizeMultiplier - 1),
		});
	}

	recycleEnemy(enemy: EnemySprite | null | undefined): void {
		if (!enemy) {
			return;
		}

		// Phaser의 destroy/disableBody는 트윈을 정리하지 않는다. 봄버 도화선 트윈(yoyo·repeat)이
		// 살아남으면 풀에서 재사용된 다른 적을 계속 스케일링한다 (성능 + 시각 버그).
		this.scene?.tweens?.killTweensOf(enemy);
		enemy.markerIcon?.setVisible(false);
		enemy.markerOn = false;
		enemy.setVelocity(0, 0);
		enemy.disableBody?.(true, true);
		enemy.setActive(false);
		enemy.setVisible(false);
		enemy.hp = 0;
	}

	increaseSpawnRate(): void {
		this.nextSpawnInterval = Math.max(this.minimumSpawnInterval, this.nextSpawnInterval - this.spawnIntervalStep);
	}

	getSpawnPosition(scene: GameScene, player: PlayerSprite): { x: number; y: number } {
		const { width, height } = scene.scale;
		const camera = scene.cameras.main;
		const worldCenterX = player.x;
		const worldCenterY = player.y;
		const screenLeft = camera.scrollX;
		const screenTop = camera.scrollY;
		const screenRight = screenLeft + width;
		const screenBottom = screenTop + height;

		for (let attempt = 0; attempt < 12; attempt += 1) {
			const angle = Phaser.Math.FloatBetween(0, Phaser.Math.PI2);
			const x = worldCenterX + Math.cos(angle) * this.spawnDistance;
			const y = worldCenterY + Math.sin(angle) * this.spawnDistance;

			if (x < screenLeft || x > screenRight || y < screenTop || y > screenBottom) {
				return { x, y };
			}
		}

		return {
			x: worldCenterX + this.spawnDistance,
			y: worldCenterY,
		};
	}

	isAliveEnemy(enemy: EnemySprite | null | undefined): boolean {
		// `visible`은 화면 밖 렌더 컬링용이라 생존 신호로 쓰지 않는다 —
		// 회수 경로(recycleEnemy)가 항상 setActive(false)를 부르므로 active로 충분하다.
		return Boolean(enemy && enemy.active !== false && !enemy.destroyed);
	}
}
