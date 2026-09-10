// 성장 곡선(숫자 인플레이션)의 단일 출처 — 2026-09-04
//
// 목표: 1라운드에 "30" 수준으로 보이던 수치가 50라운드에서 "50000" 수준으로 보이게
// (플레이어 피해·체력, 적 체력·피해 모두). 기존 곡선(검·상점·카드)만으로는 50라에
// ×100 정도라 여기서 **추가로** 곱해지는 성장을 정의한다.
//
//  - 플레이어 쪽은 **키퍼 레벨** 기반 — 레벨업이 실제 강함으로 이어지게(사용자 결정).
//  - 적 쪽은 **라운드** 기반이지만, 곡선은 "그 라운드의 기대 레벨"을 거쳐 플레이어와
//    같은 함수로 만든다. 그래야 두 쪽이 정의상 같은 속도로 커져 상대 밸런스가 유지되고,
//    레벨 상한(120)에서 플레이어가 멈추면 적도 함께 멈춘다 (200라 천문학 수치 방지).
//
// Phaser import 금지 — balance-sim 이 그대로 import 한다.

export const GROWTH = {
	/** 키퍼 최대 레벨 (ProgressionSystem.maxLevel 과 같아야 한다) */
	maxLevel: 120,
	/** 레벨당 피해 성장(곱). Lv66(≈50라) ≈ ×16 */
	damagePerLevel: 1.044,
	/** 레벨당 최대 체력 성장(곱). Lv66 ≈ ×50 */
	hpPerLevel: 1.062,
	/**
	 * 라운드 → 기대 키퍼 레벨.
	 *
	 * 2026-09-06 이전에는 `3 + 1.26×round` 선형이었는데, 실제 경험치 수급이 이 가정을
	 * 크게 넘어서서 22라운드에 Lv96(기대 31)이 나왔다. 적 체력·피해가 전부 이 함수를
	 * 거치므로, 그 차이만큼 **적이 설계보다 약하게** 스폰되고 있었다 — "몬스터가 약하다"의
	 * 진짜 원인이 이것이다.
	 *
	 * 그래서 (a) 경험치 요구량 곡선을 아래 xpCurve* 로 다시 잡고,
	 * (b) 이 함수를 그 새 곡선이 실제로 그리는 레벨(초반 빠름 → 갈수록 완만)에 맞춰
	 * 멱함수로 바꾼다. 두 값이 어긋나면 다시 같은 버그가 난다 — **항상 같이 고칠 것.**
	 *
	 *   r5 ≈ 11 · r22 ≈ 33 · r50 ≈ 62 · r100 ≈ 104 · 만렙 120 ≈ r160
	 */
	levelCoef: 3.3,
	levelExponent: 0.75,
	/**
	 * 레벨업 요구 경험치: `xpCurveBase × L^xpCurvePower × xpCurveRate^L`.
	 *
	 * 기존은 `80 + 35L + 1.8L²` 순수 2차식이었다. 처치 수(=경험치 수급)는 라운드가 갈수록
	 * 물량·처치속도로 함께 커지는데 요구량만 2차로 늘어서 후반에 레벨이 무한정 밀려 올라갔다.
	 * 지수항을 넣어 **초반은 지금처럼 빠르게, 갈수록 확실히 무거워지게** 한다 (사용자 요청).
	 */
	xpCurveBase: 550,
	xpCurvePower: 1.3,
	xpCurveRate: 1.0123,
	/**
	 * 적 피해 성장 = 플레이어 HP 성장 ^ 이 지수.
	 * 흡혈 상한 도입(2026-09-04) 전에는 흡혈이 무한 회복이라 50라 "2대 즉사"가 가려져 있었다.
	 * 0.6 이면 잡몹 접촉 기준 "죽기까지 맞는 횟수"가 10라 ≈11, 30라 ≈9, 50라 ≈6 으로
	 * 완만히 줄어든다 (방어 25% 가정). 적의 위협은 피해보다 **체력(오래 버티며 더 자주 닿음)**으로 낸다.
	 */
	enemyDamageExponent: 0.6,
	/**
	 * 적 체력 압박 곡선 [라운드, 배율] — 구간 선형 보간.
	 * balance-sim 의 "잡몹 처치 타수"(원소 빌드 평균 검 1타 기준)를 3~6타로 맞추는 값이다.
	 * 2026-09-04 실측: 6~18라에서 잡몹이 1.6타에 죽고(검 레벨/강화/카드가 적 체력보다 빨리 큼),
	 * 40라+ 에서는 8~14타(너무 단단). 중반을 세게 밀고 후반은 살짝 눕힌다.
	 *
	 * 2026-09-06 (2차) — **곡선의 모양이 바뀌었다.**
	 * 이 표는 "적 체력 = 키퍼 레벨 성장(1.044^L) × 압박" 에서 압박 쪽이다. 즉 레벨이
	 * 아닌 플레이어 성장(검 등급·검 레벨·칸 강화·레벨업 카드·스킬 트리·증강·메타)을
	 * **전부 이 하나가 흡수**해야 하는데, 예전 표는 12라 2.65 를 정점으로 100라 1.1 까지
	 * 줄어들었다. 플레이어의 비레벨 성장은 복리로 커지는데 흡수 계수는 줄어드는 역전이다.
	 * balance-sim 이 스킬 트리·증강·메타를 모르고 있었기 때문에(scripts/balance-sim/model.ts
	 * UNMODELED_GROWTH 주석 참조) 이 역전이 게이트에 안 잡혔다.
	 *
	 * 시뮬을 정직하게 만든 뒤 다시 적합한 값이다. 정점을 9~12라로 앞당기고(초반이
	 * "깔짝거려도 깨지는" 구간이 되지 않게 — 사용자 피드백), 후반은 2.7 밑으로 내려가지 않는다.
	 * 원소 빌드 평균 잡몹 처치 타수: 3라 3.9 · 8라 2.7 · 15라 3.3 · 25라 5.3 · 40라 4.6 · 60라 5.8.
	 */
	enemyHpPressure: [
		[1, 1.0], [3, 1.8], [6, 4.6], [9, 6.2], [12, 6.0], [18, 5.2], [24, 4.4], [30, 3.9], [40, 3.5], [60, 2.8], [80, 2.6], [100, 2.5], [200, 2.5],
	] as ReadonlyArray<readonly [number, number]>,
} as const;

/** 압박 곡선 보간 */
export function enemyHpPressure(round: number): number {
	const table = GROWTH.enemyHpPressure;
	if (round <= table[0][0]) return table[0][1];
	for (let i = 1; i < table.length; i += 1) {
		const [r1, v1] = table[i];
		if (round <= r1) {
			const [r0, v0] = table[i - 1];
			const t = (round - r0) / Math.max(1, r1 - r0);
			return v0 + (v1 - v0) * t;
		}
	}
	return table[table.length - 1][1];
}

/** 라운드 r 에 도달했을 때의 기대 키퍼 레벨. xpRequiredFor 와 반드시 함께 유지한다. */
export function expectedLevelForRound(round: number): number {
	return Math.max(1, Math.min(
		GROWTH.maxLevel,
		Math.round(GROWTH.levelCoef * Math.pow(Math.max(1, round), GROWTH.levelExponent)),
	));
}

/**
 * 레벨 L → L+1 에 필요한 경험치. ProgressionSystem 이 그대로 쓴다
 * (Phaser 를 안 쓰는 이 파일에 두어야 balance-sim 도 같은 곡선을 본다).
 */
export function xpRequiredForLevel(level: number): number {
	const L = Math.max(1, level);
	return Math.ceil(GROWTH.xpCurveBase * Math.pow(L, GROWTH.xpCurvePower) * Math.pow(GROWTH.xpCurveRate, L));
}

/** 레벨 L 의 피해 성장 배율 (Lv1 = 1). */
export function playerDamageGrowth(level: number): number {
	return Math.pow(GROWTH.damagePerLevel, Math.max(0, Math.min(GROWTH.maxLevel, level) - 1));
}

/** 레벨 L 의 최대 체력 성장 배율 (Lv1 = 1). */
export function playerHpGrowth(level: number): number {
	return Math.pow(GROWTH.hpPerLevel, Math.max(0, Math.min(GROWTH.maxLevel, level) - 1));
}

/** 라운드 r 의 적 체력 성장 배율 — 기대 레벨의 플레이어 피해 성장 × 추가 압박. */
export function enemyHpGrowth(round: number): number {
	return playerDamageGrowth(expectedLevelForRound(round)) * enemyHpPressure(round);
}

/** 라운드 r 의 적 피해 성장 배율 — 기대 레벨의 플레이어 체력 성장 ^ 지수. */
export function enemyDamageGrowth(round: number): number {
	return Math.pow(playerHpGrowth(expectedLevelForRound(round)), GROWTH.enemyDamageExponent);
}

/**
 * 고정 수치(회복 +1, 가시 5 등)를 현재 체력 규모로 환산하는 배율.
 * 기준 체력 100 을 1 로 본다 — 초반에는 그대로, 50라에는 ×300 안팎.
 */
export function hpScaleOf(maxHp: number | undefined): number {
	return Math.max(1, (maxHp ?? 100) / 100);
}

/**
 * 큰 수 표기: 9,999,999 까지는 자릿수 그대로(콤마 없음 — 피해 폰트는 고정폭 숫자 글리프),
 * 그 이상은 M/B 정수 축약 ("12M", "1235M", "3B"). 소수점을 쓰지 않는 이유: 고정폭 셀에서
 * '.' 이 한 칸을 통째로 차지해 "1 . 2 M" 처럼 벌어져 보인다.
 */
export function formatBigNumber(value: number): string {
	const n = Math.round(Math.abs(value));
	const sign = value < 0 ? '-' : '';
	if (n < 10_000_000) {
		return `${sign}${n}`;
	}
	if (n < 10_000_000_000) {
		return `${sign}${Math.round(n / 1_000_000)}M`;
	}
	return `${sign}${Math.round(n / 1_000_000_000)}B`;
}

/** HUD 용 콤마 표기 (10,000,000 이상은 formatBigNumber 로 축약). */
export function formatHudNumber(value: number): string {
	const n = Math.round(value);
	if (Math.abs(n) >= 10_000_000) {
		return formatBigNumber(n);
	}
	return n.toLocaleString('en-US');
}

/**
 * 비율(0~1)을 % 문자열로. 1% 미만은 반올림하면 "0%"로 뭉개지므로 소수 첫째 자리까지
 * 보여준다 — 처형처럼 픽당 0.n% 씩 오르는 스탯의 카드·패널 표기가 여기에 걸린다.
 */
export function formatPct(ratio: number): string {
	const n = ratio * 100;
	if (n !== 0 && Math.abs(n) < 10) {
		// 0.5% / 12.5% 같은 값은 소수를 살리되, 4% 처럼 딱 떨어지면 정수로
		const rounded = Math.round(n * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
	}
	return `${Math.round(n)}%`;
}
