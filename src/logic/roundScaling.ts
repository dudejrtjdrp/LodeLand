// 라운드별 적 스케일링 — 순수 수식 (Phaser import 금지, 완전 단위 테스트 가능).
// WaveSystem.startRound 안에 인라인으로 있던 계산을 **그대로** 옮긴 것이다.
// 수식을 바꾸지 말 것 — 밸런스 조정은 waveTable.json 의 `scaling` 블록에서 한다.
//
// 헤드리스 밸런스 시뮬레이터(scripts/balance-sim)도 이 모듈을 import 한다.
// 게임과 시뮬이 같은 함수를 쓰게 하려는 것이 분리의 목적이므로,
// 여기에 있는 것을 다시 시뮬 쪽에 복사하지 말 것.

import rawWaveTable from '../data/waveTable.json';
import { enemyDamageGrowth, enemyHpGrowth } from './growth';

export interface RoundScalingSpec {
	/** 잡몹 HP 선형 증가분 (라운드당) */
	hpLinear: number;
	/** 잡몹 HP 지수 밑 (lateStartRound 까지) */
	hpExpBase: number;
	/** 적 피해 평탄 배율 — 곡선 전체를 들어올린다 (상한 안쪽에 곱해져 후반은 cap 이 흡수) */
	damageBase?: number;
	/** 적 피해 선형 증가분 (라운드당) */
	damageLinear: number;
	/** 적 피해 지수 밑 */
	damageExpBase: number;
	/** 적 피해 배율 상한 */
	damageCap: number;
	/** 보스 HP 스케일 지수 (hpMult^exp) */
	bossHpExponent: number;
	/** 중간보스/정예 HP 스케일 지수 */
	minibossHpExponent: number;
	/** 이 라운드 이후 지수 성장을 lateHpExpBase 로 완만화 */
	lateStartRound: number;
	lateHpExpBase: number;
	/** 후반 내구성: 물리/마법 저항 상승 시작 라운드 */
	resistStartRound: number;
	resistPerRound: number;
	resistCap: number;

	// --- 계단식 파워 스파이크 (2026-09-02) --------------------------------
	// 완만한 지수 곡선만으로는 "어느 순간 확 세진다"는 체감이 없다.
	// spikeEvery 라운드마다 단계(tier)가 하나 올라가고, 단계마다 아래 계수가
	// **곱/합**으로 한 번에 붙는다. tier 는 spikeMaxTiers 에서 멈춘다
	// (그 뒤로는 연속 곡선만 자란다 — 200라에서 천문학적으로 튀는 것 방지).
	/** 스파이크 주기 (라운드) */
	spikeEvery: number;
	/** 스파이크 최대 단계 수 */
	spikeMaxTiers: number;
	/** 단계당 잡몹 HP 배율 (spikeHpSteps 가 있으면 그쪽이 우선) */
	spikeHpStep: number;
	/**
	 * 단계별 잡몹 HP 배율. i번째 값 = (i+1)단계로 올라설 때 붙는 배율.
	 * 초반 단계(라운드 10)는 플레이어가 아직 검 5자루뿐이라 가볍게,
	 * 중반 단계(20/30/40)는 무겁게 — 균일 배율로는 이 리듬이 안 나온다.
	 */
	spikeHpSteps?: number[];
	/** 단계당 적 피해 배율 */
	spikeDamageStep: number;
	/** 단계당 물리/마법 저항 가산 */
	spikeResistStep: number;

	// --- 근접적 도달성 (2026-09-02) ---------------------------------------
	// 키퍼 이동속도는 350인데 근접적은 45~175다. 22라 이후 "적이 다가오지도
	// 못한다"는 피드백의 절반은 내구가 아니라 **속도**였다.
	/** 라운드당 적 이동속도 증가분 (전 개체, 보스 제외) */
	speedPerRound: number;
	/** 이동속도 배율 상한 */
	speedCap: number;
	/** 근접적 속도 하한이 붙기 시작하는 라운드 */
	speedFloorStartRound: number;
	/** 라운드당 근접적 속도 하한 상승분(px/s) */
	speedFloorPerRound: number;
	/** 근접적 속도 하한의 절대 상한(px/s) */
	speedFloorCap: number;
	/** 하한이 원래 속도의 이 배수를 넘지 못한다 (느린 탱커의 정체성 보존) */
	speedFloorRatioCap: number;

	// --- 원거리 압박 (2026-09-06) -----------------------------------------
	// 근접적은 2026-09-02 에 속도 하한을 받아 압박 라인까지 오게 됐지만, 원거리 적은
	// 탄속·사거리가 라운드와 무관한 고정값이었다. 그래서 후반에는 "체력만 두꺼운
	// 느린 탄"이 되어 걸어 다니기만 해도 전부 피해진다.
	// 상한은 유지한다 — 탄속이 키퍼 이동속도(350)를 크게 넘으면 회피가 불가능해진다.
	/** 라운드당 적 투사체 속도 증가분 (배율) */
	projectileSpeedPerRound: number;
	/** 투사체 속도 배율 상한 */
	projectileSpeedCap: number;
	/** 라운드당 원거리 사거리·유지거리 증가분 (배율) */
	projectileRangePerRound: number;
	/** 사거리 배율 상한 */
	projectileRangeCap: number;
	/** 라운드당 발사 간격 감소분 (배율, 작을수록 빠름) */
	fireIntervalPerRound: number;
	/** 발사 간격 배율 하한 */
	fireIntervalFloor: number;
}

/** waveTable.json 에 값이 없을 때의 기본값 (WaveSystem 이 쓰던 것과 동일). */
export const DEFAULT_ROUND_SCALING: RoundScalingSpec = {
	hpLinear: 0.08,
	hpExpBase: 1.085,
	damageBase: 2.0,
	damageLinear: 0.03,
	damageExpBase: 1.045,
	damageCap: 28,
	bossHpExponent: 0.7,
	minibossHpExponent: 0.8,
	lateStartRound: 60,
	lateHpExpBase: 1.025,
	resistStartRound: 8,
	resistPerRound: 0.006,
	resistCap: 0.6,
	spikeEvery: 10,
	spikeMaxTiers: 5,
	spikeHpStep: 1,
	spikeDamageStep: 1,
	spikeResistStep: 0,
	speedPerRound: 0,
	speedCap: 1,
	speedFloorStartRound: 8,
	speedFloorPerRound: 0,
	speedFloorCap: 0,
	speedFloorRatioCap: 3,
	projectileSpeedPerRound: 0,
	projectileSpeedCap: 1,
	projectileRangePerRound: 0,
	projectileRangeCap: 1,
	fireIntervalPerRound: 0,
	fireIntervalFloor: 1,
};

/** 실제로 쓰이는 스케일링 = 기본값 + waveTable.json 의 scaling 블록. */
export const ROUND_SCALING: RoundScalingSpec = {
	...DEFAULT_ROUND_SCALING,
	...((rawWaveTable as unknown as { scaling?: Partial<RoundScalingSpec> }).scaling ?? {}),
};

/**
 * 계단식 파워 스파이크 단계. 라운드 10/20/30/40/50 을 **넘는 순간** 하나씩 오르고
 * spikeMaxTiers 에서 멈춘다. 0 = 스파이크 전(1~9라).
 */
export function spikeTierForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	if (scaling.spikeEvery <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(scaling.spikeMaxTiers, Math.floor(round / scaling.spikeEvery)));
}

/** 스파이크 단계까지의 누적 HP 배율 (spikeHpSteps 우선, 없으면 균일 spikeHpStep^tier). */
export function spikeHpMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	const tier = spikeTierForRound(round, scaling);
	const steps = scaling.spikeHpSteps;
	if (!steps || steps.length === 0) {
		return Math.pow(scaling.spikeHpStep, tier);
	}
	let mult = 1;
	for (let i = 0; i < tier; i += 1) {
		mult *= steps[Math.min(i, steps.length - 1)] ?? 1;
	}
	return mult;
}

/** 이 라운드가 스파이크 경계인가 (= 입장 시 "위험도 상승" 시그널을 띄울 라운드). */
export function isSpikeRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): boolean {
	if (scaling.spikeEvery <= 0 || round <= 0) {
		return false;
	}
	return round % scaling.spikeEvery === 0 && round / scaling.spikeEvery <= scaling.spikeMaxTiers;
}

/** 잡몹 HP 배율 (danger 배율은 호출부에서 곱한다). */
export function hpMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	const r = round - 1;
	const earlyR = Math.min(r, scaling.lateStartRound);
	const lateR = Math.max(0, r - scaling.lateStartRound);
	return (1 + scaling.hpLinear * r)
		* Math.pow(scaling.hpExpBase, earlyR)
		* Math.pow(scaling.lateHpExpBase, lateR)
		* spikeHpMultForRound(round, scaling);
}

/**
 * 적 피해 배율 (damageCap 으로 상한).
 *
 * `damageBase` 는 곡선 전체를 들어올리는 평탄 배율이다 (2026-09-06, 사용자 요청 "잡몹이 너무 약하다").
 * **상한 안쪽에 곱한다** — 그래야 중반(~40라)까지는 그대로 배가 되고, 이미 위험한 후반은
 * damageCap 이 자동으로 증폭을 흡수해 "2대 즉사"가 되지 않는다.
 */
export function damageMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	const r = round - 1;
	return Math.min(
		scaling.damageCap,
		(scaling.damageBase ?? 1) * (1 + scaling.damageLinear * r) * Math.pow(scaling.damageExpBase, r)
			* Math.pow(scaling.spikeDamageStep, spikeTierForRound(round, scaling)),
	);
}

/** 후반 내구성: 스폰 시 물리/마법 저항에 더해지는 보너스. */
export function resistBonusForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	const r = round - 1;
	return Math.min(
		scaling.resistCap,
		Math.max(0, r - scaling.resistStartRound) * scaling.resistPerRound
			+ scaling.spikeResistStep * spikeTierForRound(round, scaling),
	);
}

/** 적 이동속도 배율 (보스 제외 — 보스 패턴 타이밍을 건드리지 않는다). */
export function speedMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	return Math.min(scaling.speedCap, 1 + scaling.speedPerRound * (round - 1));
}

/**
 * 적 투사체 속도 배율 (2026-09-06).
 * 상한이 있는 이유: 키퍼 이동속도는 350(상한 560)이고 탄은 유도가 아니면 직선이다.
 * 탄속이 그보다 훨씬 빨라지면 "보고 피한다"가 불가능해지고 판정이 운이 된다.
 */
export function projectileSpeedMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	return Math.min(scaling.projectileSpeedCap, 1 + scaling.projectileSpeedPerRound * (round - 1));
}

/** 원거리 사거리·유지거리 배율 — 후반에는 더 멀리서 쏜다 (검 스캔 반경 밖으로). */
export function projectileRangeMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	return Math.min(scaling.projectileRangeCap, 1 + scaling.projectileRangePerRound * (round - 1));
}

/** 발사 간격 배율 (작을수록 빠르다) — 하한을 둬서 탄막이 화면을 덮지 않게 한다. */
export function fireIntervalMultForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	return Math.max(scaling.fireIntervalFloor, 1 - scaling.fireIntervalPerRound * (round - 1));
}

/** 근접적 속도 하한(px/s) — 라운드가 갈수록 느린 몹도 압박 라인까지는 온다. */
export function meleeSpeedFloorForRound(round: number, scaling: RoundScalingSpec = ROUND_SCALING): number {
	return Math.min(
		scaling.speedFloorCap,
		Math.max(0, round - scaling.speedFloorStartRound) * scaling.speedFloorPerRound,
	);
}

/**
 * 스폰 시 실제로 적용되는 이동속도.
 * 근접(melee=true)만 하한을 받는다 — 원거리는 원래 접근하지 않는 것이 설계다.
 * 하한은 원래 속도의 speedFloorRatioCap 배를 넘지 않는다(느린 탱커는 여전히 느리다).
 */
export function enemySpeedForRound(
	baseSpeed: number,
	round: number,
	melee: boolean,
	scaling: RoundScalingSpec = ROUND_SCALING,
): number {
	const scaled = baseSpeed * speedMultForRound(round, scaling);
	if (!melee) {
		return scaled;
	}
	const floor = Math.min(
		meleeSpeedFloorForRound(round, scaling),
		baseSpeed * scaling.speedFloorRatioCap,
	);
	return Math.max(scaled, floor);
}

/** 개체 종류별 HP 스케일 (EnemyManager.spawnEnemy 와 같은 규칙). */
export function hpScaleForKind(
	hpMult: number,
	kind: 'normal' | 'miniboss' | 'boss',
	scaling: RoundScalingSpec = ROUND_SCALING,
): number {
	if (kind === 'boss') {
		return Math.pow(Math.max(1, hpMult), scaling.bossHpExponent);
	}
	if (kind === 'miniboss') {
		return Math.pow(Math.max(1, hpMult), scaling.minibossHpExponent);
	}
	return hpMult;
}

/**
 * 스폰 시 실제 HP 배율 = 종류별 곡선(hpScaleForKind) × 숫자 인플레이션 성장(logic/growth.ts).
 * 성장 배율은 종류 지수(보스 0.95 등) 바깥에 곱한다 — 보스도 잡몹과 같은 속도로 커져야
 * "50라에 5만" 스케일이 맞는다. WaveSystem/EnemyManager/balance-sim 공용 (2026-09-04).
 */
export function enemyHpScaleForRound(
	round: number,
	kind: 'normal' | 'miniboss' | 'boss',
	dangerHpMult = 1,
	scaling: RoundScalingSpec = ROUND_SCALING,
): number {
	return hpScaleForKind(dangerHpMult * hpMultForRound(round, scaling), kind, scaling) * enemyHpGrowth(round);
}

/** 스폰 시 실제 피해 배율 = 기존 곡선(damageCap 포함) × 성장. */
export function enemyDamageScaleForRound(
	round: number,
	dangerDamageMult = 1,
	scaling: RoundScalingSpec = ROUND_SCALING,
): number {
	return dangerDamageMult * damageMultForRound(round, scaling) * enemyDamageGrowth(round);
}

/** 라운드 → waveTable.waves 인덱스 (3라운드당 1브래킷, 마지막에서 고정). */
export function waveBracketIndex(round: number, waveCount: number): number {
	return Math.max(0, Math.min(waveCount - 1, Math.floor((round - 1) / 3)));
}

// ---------------------------------------------------------------------------
// 라운드 길이 · 물량 — 게임(WaveSystem)과 시뮬(balance-sim)의 단일 출처
// ---------------------------------------------------------------------------

/**
 * **스폰 창(spawn window) 길이(ms)** — 라운드가 시작하고 이 시간 동안만 적이 새로 나온다.
 * 목표를 일찍 달성해도 창이 닫힐 때까지 스폰은 계속된다("5초 만에 끝나는 라운드" 방지,
 * 2026-09-02). 창이 닫힌 뒤에는 **그때까지 나온 적을 전부 처치해야** 라운드가 끝난다
 * (사용자 요청, 2026-09-06) — 즉 이 값은 라운드 길이가 아니라 *스폰이 이어지는 길이*다.
 * 생존(survive) 목표의 지속시간도 이 값을 그대로 쓴다.
 */
export const ROUND_MIN_MS = 40000;

/**
 * 스폰 창이 닫힌 뒤(=잔당 소탕 단계) 허용하는 최대 시간(ms). 멀리 흩어졌거나 소환으로
 * 계속 불어나는 잔당 때문에 라운드가 영영 안 끝나는 사고를 막는 안전장치다.
 * 이 시간이 지나면 남은 잡몹을 정리하고 라운드를 종료한다.
 */
export const MOP_UP_HARD_CAP_MS = 45000;

/**
 * 잔당 소탕 단계에서 이 거리(px) 밖으로 벗어난 잡몹은 플레이어 주변으로 다시 끌어온다.
 * "마지막 한 마리를 찾아 맵을 헤매는" 상황을 없애기 위한 것.
 */
export const MOP_UP_LEASH_PX = 1100;

/** 라운드당 스폰 간격 배율의 하한/기울기 (물량 증가 — 2026-09-02 상향). */
// 하한(260ms)은 그대로 둔다 — 이미 후반은 이 하한에 붙어 있어서 더 내리면
// 후반만 일방적으로 어려워진다. 물량 증가는 기울기(0.006→0.009)와 동시 생존
// 상한(round/2 → round/1.6)으로 낸다.
const SPAWN_INTERVAL_FLOOR_MS = 220;
const SPAWN_INTERVAL_PER_ROUND = 0.016;
const SPAWN_INTERVAL_MIN_RATIO = 0.24;
/** 동시 생존 상한: 브래킷 minAlive + round/MIN_ALIVE_DIVISOR, MIN_ALIVE_CAP 에서 정지. */
const MIN_ALIVE_DIVISOR = 1.6;
const MIN_ALIVE_CAP = 96;
/**
 * 2026-09-04 "잡몹이 한 방" 대응: 적 체력을 중반 ×2.4~3.0 으로 올리는 대신 **수를 줄인다**
 * (스폰 간격 ×1.5, 동시 생존 ×0.75). 적은 수의 단단한 적 — 처치 수가 줄어드는 만큼
 * 경험치는 EnemyManager 의 XP_PER_KILL_MULT 로 보정한다.
 */
export const SPAWN_INTERVAL_MULT = 1.5;
export const MIN_ALIVE_MULT = 0.75;
export const XP_PER_KILL_MULT = 1.45;

/** 라운드 r 의 스폰 간격(ms) — WaveSystem·시뮬이 공유한다. */
export function spawnIntervalForRound(baseIntervalMs: number, round: number): number {
	return Math.max(
		SPAWN_INTERVAL_FLOOR_MS * SPAWN_INTERVAL_MULT,
		baseIntervalMs * SPAWN_INTERVAL_MULT * Math.max(SPAWN_INTERVAL_MIN_RATIO, 1 - round * SPAWN_INTERVAL_PER_ROUND),
	);
}

/** 라운드 r 의 동시 생존 하한 — WaveSystem·시뮬이 공유한다. */
export function minAliveForRound(baseMinAlive: number, round: number): number {
	return Math.round(Math.min(MIN_ALIVE_CAP, (baseMinAlive ?? 0) + Math.floor(round / MIN_ALIVE_DIVISOR)) * MIN_ALIVE_MULT);
}
