// 스탯 상한 — 무한 스택 방지 규칙의 단일 출처.
// "base"는 캐릭터 스탯 × 영구 강화(메타) × 특성이 적용된 직후 값(런 시작 시점)을 뜻한다.
// 레벨업(LevelUpSystem)과 상점(ShopSystem) 양쪽에서 같은 함수를 사용한다.
//
// 치명타 확률(2026-09-04 변경): 레벨업 경로는 100%에서 멈춘다 — 100% 도달 시
// 치명타 카드가 선택지에서 빠지고, 대신 처형·관통 해금 스탯이 등장한다.
// 검·세트·상점·증강에서 오는 초과분은 종전대로 판정 시 치명타 피해 배율로
// 전환된다 (hitResolution.registerSwordHit 의 critOverflow). UI 는 이를 표기만 한다.

export const STAT_CAPS = {
	/** 치명타 확률(플레이어 스탯 절대값): 100% — 레벨업 카드가 이 이상 올리지 않는다 */
	critChance: 1.0,
	/** 이동 속도: base × 1.6 */
	moveSpeedMult: 1.6,
	/** 획득(자석) 반경: base × 3 */
	magnetMult: 3.0,
	/** 궤도 반경: base × 1.8 */
	orbitRadiusMult: 1.8,
	/** 궤도 회전 속도: base × 2.5 */
	orbitSpeedMult: 2.5,
	/** 출격 속도 배율(절대값): ×2.5 */
	launchSpeedMultiplier: 2.5,
	/** 쿨다운 배율 하한(절대값): ×0.35 (= 최대 -65%) */
	cooldownFloor: 0.35,
	/**
	 * 치명타 **피해 배율** 소프트캡 (2026-09-06).
	 *
	 * 치명타 피해에는 지금까지 어떤 상한도 없었다 — 레벨업 카드(`critDamage`,
	 * legendary +1.0)·상점·검·세트·특성·초과 확률(`critOverflow`)이 전부 가산으로 쌓인다.
	 * 레벨업 굴림을 그대로 재현한 실측(60런): 플레이어 치명 배율이 Lv71 에 4.55,
	 * Lv120 에 7.38, 리롤까지 쓰면 10.47 까지 간다. 치명타 확률은 100%에서 멈추므로
	 * 이 값은 후반에 **총 피해에 그대로 곱해지는 배수**가 된다.
	 *
	 * 하드캡을 두면 "치명타 피해 카드가 갑자기 쓰레기가 되는" 지점이 생기므로,
	 * 이 값을 넘는 초과분만 slope 만큼만 반영하는 소프트캡으로 한다.
	 * 판정에 실제로 쓰이는 값은 (검 + 플레이어) / 2 + 특성 + 초과확률 이므로
	 * 캡은 **그 합계**에 걸린다 (hitResolution.registerSwordHit 한 곳).
	 */
	critDamageSoftCap: 3.0,
	/** 소프트캡 초과분의 반영 비율 */
	critDamageSoftSlope: 0.30,
} as const;

/**
 * 치명타 피해 배율 소프트캡 적용 — 판정에 쓰이는 **최종 합계**에 건다.
 * 게임(hitResolution)과 balance-sim 이 같은 함수를 써야 한다.
 */
export function softCapCritMultiplier(multiplier: number): number {
	const cap = STAT_CAPS.critDamageSoftCap;
	if (multiplier <= cap) {
		return multiplier;
	}
	return cap + (multiplier - cap) * STAT_CAPS.critDamageSoftSlope;
}

// 해금 스탯 상한 — 대응 기본 스탯이 MAX에 도달하면 레벨업 선택지에 등장하는
// 2차 스탯들의 절대 상한. (대응 관계는 LevelUpSystem.isUpgradeAvailable 참조)
//   STRIDE MAX      → EVASION(회피)        FAST ORBIT MAX → MIDAS(INGOT 획득)
//   MAGNET MAX      → INSIGHT(경험치)      VELOCITY MAX   → REKINDLE(재생)
//   WIDE ORBIT MAX  → BULWARK(피해 감소)   QUICKEN MAX    → BLOODTHIRST(흡혈)
//   CRIT 100%       → EXECUTE(처형) + PIERCE(관통)   ← 유일한 2갈래 분기
export const UNLOCK_CAPS = {
	/** 회피율: 최대 30% (레벨업 경로 — 상점 회피는 별도 40% 상한 유지) */
	dodgeChance: 0.30,
	/** 받는 피해 감소: 최대 25% */
	damageReduction: 0.25,
	/**
	 * 흡혈(검 피해의 %): 최대 3% (2026-09-04, 8%→3%).
	 * 세트(피 2/5)·증강(진홍 검신)까지 합쳐도 6% 를 넘지 않고, 실제 회복은
	 * logic/lifesteal.ts 의 초당 예산(최대체력 6%/s)이 다시 자른다.
	 */
	lifesteal: 0.03,
	/** 경험치 배율(절대값): ×1.5 (= +50%) */
	xpMultiplier: 1.5,
	/** INGOT 획득 보너스: 최대 +50% */
	goldBonus: 0.5,
	/** 체력 재생: 최대 3/s */
	hpRegen: 3,
	/**
	 * 처형(체력 30% 이하 적에게 주는 피해 증가): 최대 +15%.
	 * 즉사가 아니라 피해 배율이다 — 보스에게도 적용되므로 상한을 짜게 잡는다.
	 * 픽당 0.n% 씩만 오른다(upgradeCatalog 의 execute) — 전설만 뽑아도 17픽.
	 * 적용 지점: EnemyManager.takeDamage 의 EXECUTE_HP_THRESHOLD 블록.
	 */
	executeDamage: 0.15,
	/**
	 * 관통(적 저항에서 빼는 고정 수치): 최대 0.20 = 저항 20%p.
	 * 검 자체 관통(physicalPen/magicPen)·세트 관통과 합산되며, 저항이 0 밑으로
	 * 내려가도 이득은 없다(mitigateEnemyDamage 가 0에서 자름).
	 */
	pen: 0.20,
} as const;

/** 처형 스탯이 적용되는 적 체력 비율 — 이 값 이하일 때 피해 증폭. */
export const EXECUTE_HP_THRESHOLD = 0.30;

/** base 기준 배율 상한 클램프. base 미상(0/undefined)이면 클램프 없이 통과. */
export function clampToBaseCap(next: number, base: number | undefined, capMult: number): number {
	if (!base || base <= 0) {
		return next;
	}
	return Math.min(next, base * capMult);
}

/**
 * 이동 속도 상한(정수). base × 1.6 은 378×1.6 = 604.8000000000001 처럼 부동소수
 * 찌꺼기를 남기고, 그 값이 그대로 저장·표기되면 HUD 에 소수점 15자리가 뜬다.
 * 상한 판정·클램프·표기가 모두 이 하나의 정수를 봐야 한다.
 */
export function moveSpeedCap(base?: number): number {
	if (!base || base <= 0) {
		return Infinity;
	}
	return Math.round(base * STAT_CAPS.moveSpeedMult);
}

export function clampMoveSpeed(next: number, base?: number): number {
	return Math.min(Math.round(next), moveSpeedCap(base));
}

export function clampMagnetRadius(next: number, base?: number): number {
	return clampToBaseCap(next, base, STAT_CAPS.magnetMult);
}

export function clampOrbitRadius(next: number, base?: number): number {
	return clampToBaseCap(next, base, STAT_CAPS.orbitRadiusMult);
}

export function clampOrbitSpeed(next: number, base?: number): number {
	return clampToBaseCap(next, base, STAT_CAPS.orbitSpeedMult);
}

export function clampLaunchSpeedMultiplier(next: number): number {
	return Math.min(next, STAT_CAPS.launchSpeedMultiplier);
}

export function clampCooldownMultiplier(next: number): number {
	return Math.max(next, STAT_CAPS.cooldownFloor);
}

/** 상한 도달 여부 (부동소수 오차 허용). */
export function atCap(current: number, cap: number): boolean {
	return current >= cap - 1e-9;
}
