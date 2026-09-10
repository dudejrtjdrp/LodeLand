// ---------------------------------------------------------------------------
// 헤드리스 밸런스 모델 — "라운드 r 에서 이 빌드는 몇 배의 여유가 있는가"
// ---------------------------------------------------------------------------
// ※ 근사 모델이다. 다음은 계수로 흡수했다(정확한 값이 아니라 *상대 비교*가 목적):
//    - 명중률/이동 회피/타겟 전환 손실 → CAL.crowdSkip, CAL.retargetSec
//    - 적 밀집도에 따른 근접 스캔(쿨다운 무시) 비율 → CAL.crowdSkip
//    - 원소 세트 4/6/7 스킬의 DPS 기여 → SKILL_DPS (유도 근거는 각 항목 주석)
//    - 어픽스(23종) 평균 효과 → CAL.affixEhpMult
// 반면 아래는 **게임 코드의 순수 함수를 그대로 import** 한다 (로직 중복 금지):
//    저항/관통(mitigateEnemyDamage), %체력 피해(maxHpBonusDamage),
//    특성 상성(traitDamageMult), 원소 세트 집계(aggregateSets/computeSetTiers),
//    공명(hasResonance), 라운드 스케일링(roundScaling.*), 플레이어 피해 경감.
// ---------------------------------------------------------------------------

import swordCatalogRaw from '../../src/data/swordCatalog.json';
import enemyCatalogRaw from '../../src/data/enemyCatalog.json';
import waveTableRaw from '../../src/data/waveTable.json';
import skillCatalogRaw from '../../src/data/skillCatalog.json';
import shopCatalogRaw from '../../src/data/shopCatalog.json';

const SHOP_CATALOG = shopCatalogRaw as unknown as { slots?: { enhanceDamagePerLevel?: number } };

import { mitigateEnemyDamage, mitigatePlayerDamage, maxHpBonusDamage } from '../../src/logic/combat';
import { traitsOf, traitDamageMult, traitsImmuneTo } from '../../src/logic/enemyTraits';
import { aggregateSets, computeSetTiers, type SetElement, type SetStatMods } from '../../src/logic/elementSets';
import { countElements, hasResonance } from '../../src/logic/resonance';
import { behaviorOf, behaviorSpec, stakeTickMs } from '../../src/logic/swordBehavior';
import {
	ROUND_MIN_MS, ROUND_SCALING, damageMultForRound, hpMultForRound, hpScaleForKind,
	minAliveForRound, resistBonusForRound, spawnIntervalForRound, spikeTierForRound,
	waveBracketIndex,
} from '../../src/logic/roundScaling';
import {
	enemyDamageGrowth, enemyHpGrowth, expectedLevelForRound, playerDamageGrowth, playerHpGrowth,
} from '../../src/logic/growth';
import { cappedHealPerSec } from '../../src/logic/lifesteal';
import { SWORD_LEVEL_DAMAGE_BONUS } from '../../src/logic/swordGrowth';
import { UNLOCK_CAPS, softCapCritMultiplier } from '../../src/logic/statCaps';

// ---------------------------------------------------------------------------
// 타입 (카탈로그의 느슨한 JSON을 다루기 위한 최소 정의)
// ---------------------------------------------------------------------------

export interface SwordDef {
	id: string;
	name: string;
	damage: number;
	cooldownMs: number;
	maxHits: number;
	critChance: number;
	critDamageMultiplier: number;
	launchSpeed: number;
	hitCooldownMs?: number;
	damageType?: 'physical' | 'magic';
	physicalPen?: number;
	magicPen?: number;
	element?: string;
	rarity: string;
	evolved?: boolean;
	/** 거동 아키타입 (없으면 'orbit' = 기본 거동) */
	behavior?: string;
	trueDamage?: number;
	maxHpDamage?: number;
	special?: {
		type: string; dps?: number; durationMs?: number; targets?: number; damagePct?: number;
		radius?: number; threshold?: number; chance?: number; slowPct?: number;
	} | null;
}

interface EnemyDef {
	id: string; name: string; hp: number; damage: number; speed: number;
	xpValue?: number; traits?: string[];
	physicalResist?: number; magicResist?: number;
	isBoss?: boolean; isMiniboss?: boolean; isElite?: boolean; isReaper?: boolean;
}

export const SWORDS = swordCatalogRaw as unknown as SwordDef[];
export const ENEMIES = enemyCatalogRaw as unknown as EnemyDef[];
const WAVE_TABLE = waveTableRaw as unknown as {
	waves: Array<{ minute: number; spawnIntervalMs: number; minAlive: number; pool: Array<{ id: string; weight: number }> }>;
};
const SKILLS = skillCatalogRaw as unknown as {
	dive: { cooldownMs: number; damageBonus: number; bonusWindowMs: number };
};

export const SWORD_BY_ID = new Map(SWORDS.map((s) => [s.id, s]));
const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]));

// ---------------------------------------------------------------------------
// 캘리브레이션 — 모델의 "게임 밖" 계수. 값을 바꾸면 모든 빌드가 같이 움직인다
// (빌드 간 상대 비교에는 영향이 작다).
// ---------------------------------------------------------------------------

export const CAL = {
	/** 출격 시 평균 교전 거리(px) — 근접 스캔 반경 120, 원거리 스캔의 혼합 */
	engageDistPx: 110,
	/** 귀환에 걸리는 시간(초) — returnLerp 0.2 기준 실측 근사 */
	returnSec: 0.22,
	/** 연속 타격 사이 재타겟 이동 시간(초) */
	retargetSec: 0.06,
	/** 밀집 구간에서 근접 스캔이 쿨다운을 건너뛰는 비율의 상한 */
	crowdSkipMax: 0.85,
	crowdSkipMin: 0.20,
	/** 살아있는 적 수 → 쿨다운 스킵 비율 환산 계수 */
	crowdSkipPerAlive: 1 / 44,
	/** 광역(blast)/파편이 평균적으로 맞히는 추가 대상 수 */
	blastTargets: 3.2,
	/** 연쇄(chain)가 실제로 대상을 찾는 비율 */
	chainHitRate: 0.85,
	/** 검기 파동이 실제로 대상을 찾는 비율 (반경 140) */
	cleaveLandRate: 0.85,
	/** DoT(화상/중독)가 대상 1기에 실제로 얹히는 평균 지속(초) 상한 */
	dotEffectiveSec: 2.6,
	/** 처형(execute)이 "그 문턱에서 실제로 발동"할 확률 계수 */
	executeLandRate: 0.8,
	/** 어픽스 평균 EHP 배율 (라운드 6 이후 점증, 상한) */
	affixEhpMult: (round: number) => Math.min(1.5, 1 + Math.max(0, round - 6) * 0.012),
	/** 플레이어 무적 시간 850ms → 초당 최대 피격 횟수 */
	maxHitsPerSec: 1 / 0.85,
	/** 밀집도 → 실제 피격률 */
	pressureMin: 0.15,
	pressureMax: 1.0,
	pressurePerAlive: 1 / 70,
	/**
	 * 생존 설계 목표: 라운드 하나를 온전히 버텨야 한다.
	 * 라운드가 40초로 고정된 뒤(2026-09-02)로는 이 값이 곧 라운드 길이다 —
	 * 목표를 일찍 달성해도 40초까지는 스폰이 이어지므로 "빨리 깨고 도망"이 통하지 않는다.
	 */
	targetSurviveSec: 40,
	/**
	 * 관통·오라가 실제로 몇 마리에 닿는가는 **밀집도**가 정한다.
	 * 선회검의 호도, 참격검의 직선도, 말뚝검의 오라도 화면이 빌수록 헛돈다.
	 * 이 배율이 없으면 초반(적 10기)에는 과대평가, 후반(적 60기)에는 과소평가된다.
	 */
	pierceCrowd: (alive: number) => Math.min(1.6, Math.max(0.55, alive / 26)),
	/** 말뚝검 오라 1틱이 닿는 기준 대상 수 (반경 96px · 밀집도 배율이 곱해지고 상한 8) */
	stakeAuraTargets: 3.0,
	/**
	 * 말뚝검이 꽂혀 있는 동안 그 자리의 궤도가 비어 있다는 대가.
	 * 궤도 접촉 피해가 없는 기본 키퍼에게는 직접적인 DPS 손실이 아니지만,
	 * "그 검이 다른 곳을 때릴 수 없다"는 기회비용을 이 배율로 흡수한다.
	 */
	stakeVacancyPenalty: 0.94,
	/**
	 * 얼음 3세트(감속 취약)의 가동률 — "때리는 순간 적이 감속 상태일 확률".
	 * 영구동토(7세트)는 화면 전체를 상시 감속시키므로 거의 1,
	 * slow 스페셜 검만 있으면 재적용 간격·면역 적 때문에 0.7,
	 * 감속원이 전혀 없으면 다른 원소의 감속(어픽스·넉백)에 기대는 0.15.
	 */
	slowUptimePermafrost: 0.95,
	slowUptimeSlowSword: 0.70,
	slowUptimeNone: 0.15,
} as const;

/**
 * 플레이어 성장 프로파일 — 라운드 r 시점의 "평균적인" 키퍼.
 * 실측(플레이 로그)이 아니라 설계 의도에 맞춘 가정이다. 절대값보다 기울기가 중요하다.
 */
export interface Profile {
	round: number;
	swordCount: number;
	swordLevel: number;
	enhance: number;
	playerLevel: number;
	damageMultiplier: number;
	cooldownMultiplier: number;
	launchSpeedMultiplier: number;
	critChance: number;
	critDamageMultiplier: number;
	defense: number;
	maxHp: number;
	lifesteal: number;
	/** 검기 파동(cleave) 대상 수 — 명중 1회가 주변 N기를 같은 피해로 추가 타격 */
	cleaveTargets: number;
	/** 출격당 추가 타격 (레벨업 extraHit) */
	bonusHits: number;
	/** 각인 3소켓의 평균 피해 기여 (titan/ruin/hunter 등) */
	engraveDamageMult: number;
}

/**
 * 라운드 40초 고정(2026-09-02)에 따른 **라운드당 수입** 보정 계수 ≈ ×1.20.
 *
 * 이 프로파일의 진행 속도(칸 해금·검 레벨·칸 강화·키퍼 레벨)는 전부 라운드당
 * 처치 수에서 나온다. 개편으로 두 가지가 같이 바뀌었다:
 *
 *  1) **길이** — 예전에는 목표를 깨는 즉시 라운드가 끝났다. 5의 배수(정예/보스)
 *     라운드는 앞에 소환된 목표만 잡으면 10~20초에 끝났고, 반대로 생존 라운드는
 *     (30+라운드)초라 30라에서 60초였다. 지금은 전부 40초 고정이다
 *     → 짧던 라운드(전체의 약 1/3)가 2배 이상 길어지고, 길던 생존 라운드는 짧아진다.
 *     순증 ≈ +7%.
 *  2) **밀도** — 스폰 간격 기울기 0.006→0.009, 동시 생존 상한 round/2→round/1.6.
 *     라운드 30 기준 간격 533→470ms, 동시 생존 37→40기 → +13%.
 *
 * 합쳐서 라운드당 처치 ≈ ×1.20. 아래 진행 곡선은 전부 그만큼 앞당긴 값이다.
 * (이 보정을 빼먹으면 "적만 세지고 플레이어는 그대로"인 모델이 되어 여유율이
 *  실제보다 낮게 나온다 — 개편 직후 무전략 랜덤 픽 벽이 36→25 로 튄 원인이었다.)
 */
export const ROUND_INCOME_FACTOR = 1.2;

// ---------------------------------------------------------------------------
// 레벨업 카드 곡선 — **몬테카를로 실측값** (2026-09-06)
// ---------------------------------------------------------------------------
// 예전 값(피해 +4.5%/lv, 쿨다운 -1.2%/lv, 치명 배율 +0.02/lv 등)은 "레벨업 선택 20종 중
// 피해 계열을 30% 고른다"는 손어림이었다. 실제 게임의 굴림(LevelUpSystem: CHOICE_COUNT 4,
// 슬롯마다 독립 등급 굴림 + oddsByLevel + 행운 증폭)을 upgradeCatalog 그대로 재현해
// "DPS 가 가장 오르는 카드를 고르는 숙련 플레이어" 60런 × 120레벨을 돌려 회귀한 값이다.
//
// 가장 크게 어긋나 있던 축이 **치명타 피해**다 — 실측 +0.043/lv 인데 모델은 +0.02/lv 로,
// 절반 이하였다. 치명타 확률이 후반에 100% 에 붙으므로 이 항은 곧바로 총 피해 배수가 된다.
//
// 리롤(R, 레벨당 1회 무료)은 **일부러 넣지 않았다.** 리롤까지 쓰면 같은 실측에서 DPS 지수가
// 라운드 60 기준 107 → 290 (×2.7) 이 된다. 게이트가 최적 플레이를 기준선으로 삼으면
// 보통 플레이가 전부 벽에 막히므로, 기준선은 "리롤 없는 숙련자"로 두고 리롤은 여유분으로 본다.
export const CARD = {
	/** 피해 배율 가산 /레벨 (실측 0.028~0.034) */
	damagePerLevel: 0.030,
	/** 쿨다운 감소 /레벨 (하한 statCaps.cooldownFloor) */
	cooldownPerLevel: 0.0135,
	/** 치명타 확률 가산 /레벨 (실측 0.0047~0.0064) */
	critChancePerLevel: 0.0055,
	/** 치명타 피해 가산 /레벨 (실측 0.0375~0.0494) — 구 모델 0.02 의 2.2배 */
	critDamagePerLevel: 0.043,
	/** 연속 타격 /레벨 (epic·legendary 전용 카드라 늦게 붙는다) */
	bonusHitsPerLevel: 0.032,
	/** 검기 파동 대상 /레벨 */
	cleavePerLevel: 0.038,
} as const;

// ---------------------------------------------------------------------------
// 시뮬이 **모르고 있던** 성장원 (2026-09-06 감사)
// ---------------------------------------------------------------------------
// 이 파일은 swordCatalog·enemyCatalog·waveTable·shopCatalog·skillCatalog 만 읽는다.
// 그런데 2026-09-04 이후 플레이어 쪽에 다음이 들어왔고, 전부 모델 밖이었다:
//
//   skillTree.json    99노드 / 능동 21종 (등록 상한 10, skillHotbar.MAX_REGISTERED_SKILLS)
//   augmentCatalog    45종 / 런당 4장 (offerRounds [10,25,40,55])
//   metaCatalog       영구 강화 9종 (might +4%×5, haste -3%×3 …)
//
// 그래서 시뮬은 "적이 세다"(무전략 여유율 0.92)고 말하는데 실플레이는 정반대였다.
// 아래 계수는 각 시스템의 데이터에서 유도한 것이고, 유도 근거를 항목마다 남긴다.
export const UNMODELED_GROWTH = {
	/**
	 * 메타 영구 강화 — 게이트는 **만렙 메타**를 기준으로 본다(가장 센 상태에서도
	 * 성립해야 하므로). might 5랭크 × +4% = +20%, haste 3랭크 × -3% = ×0.91.
	 */
	metaDamageMult: 1.20,
	metaCooldownMult: 0.91,

	/**
	 * 증강 — augmentCatalog.offerRounds 에서 4장.
	 * 피해 계열 상위(whetstone +12% · colossus-edge +45% · twin-ring +15% ·
	 * relentless-flurry 연속타격 +1 · weighted-edge +15%)의 DPS 기여 평균 ≈ +15%/장.
	 * 보수적으로 잡았다 — colossus 만 골라도 한 장에 +45% 다.
	 */
	augmentOfferRounds: [10, 25, 40, 55] as readonly number[],
	augmentDpsPerPick: 0.15,

	/**
	 * 스킬 트리 — 포인트 = (레벨-1) × pointsPerLevel(10). 트리 전체 만렙은 2060 포인트.
	 *
	 * (a) 피해형 능동 9종(검기 발사·검 회오리·불바다·화염탄·낙뢰·폭풍우·그림자 분신·
	 *     서리 폭발·피의 일격)의 비용 합은 22 = 220 포인트면 전부 만렙이다.
	 *     피해는 전부 `avgHit() × damageMult` 라 검 피해에 **곱해서** 얹힌다.
	 *     라운드 30 프로파일 어림 — 폭풍우 4.35 · 화염탄 1.40 · 피의 일격 1.21 ·
	 *     낙뢰 0.97 · 나머지 2.80 = 약 10.7 avgHit/초. 검 파티가 8~12 avgHit/초이므로
	 *     **전부 등록하면 파티 DPS 를 약 1배 더 얹는다**(등록 상한 10 안에 9종이 들어간다).
	 *     실제로는 포인트를 패시브에도 나눠 쓰므로 220 이 아니라 그 2배(440)를 만렙 지점으로 본다.
	 * (b) 패시브 78종(frostAura·shatter·huntMark·slowedDamage·executeThreshold…)은
	 *     트리 전체 진행도에 비례해 최대 +25%.
	 */
	treeActiveFullDps: 1.00,
	treeActivePoints: 440,
	treePassiveFullDps: 0.25,
	treeTotalPoints: 2060,
} as const;

/** 스킬 트리가 파티 DPS 에 곱하는 배수 (키퍼 레벨 → 누적 포인트 → 투자 진행도). */
export function treeDpsMult(playerLevel: number): number {
	const points = Math.max(0, playerLevel - 1) * 10;
	const active = Math.min(1, points / UNMODELED_GROWTH.treeActivePoints);
	const passive = Math.min(1, points / UNMODELED_GROWTH.treeTotalPoints);
	return 1
		+ UNMODELED_GROWTH.treeActiveFullDps * active
		+ UNMODELED_GROWTH.treePassiveFullDps * passive;
}

/** 증강 4장이 파티 DPS 에 곱하는 배수 (그 라운드까지 받은 장수만큼 복리). */
export function augmentDpsMult(round: number): number {
	let picks = 0;
	for (const at of UNMODELED_GROWTH.augmentOfferRounds) {
		if (round >= at) {
			picks += 1;
		}
	}
	return Math.pow(1 + UNMODELED_GROWTH.augmentDpsPerPick, picks);
}

export function profileFor(round: number): Profile {
	// 칸 해금: 80 → 2배씩 (80/160/320/640/1280 INGOT). 상점 수입 기준 대략 이 속도.
	// 40초 고정 이후의 수입(×1.20)을 반영해 [1,1,3,6,10,16,24] 에서 앞당겼다.
	// 2026-09-04: 라운드 게이트 [3,8,15,30,50] (shopCatalog.slots.unlockRounds) + 비용 150×2.2^n.
	// 게이트 라운드 **완료** 후 상점에서 열리므로 실제 장착은 다음 라운드부터 → +1.
	const slotRounds = [1, 1, 4, 9, 16, 31, 51];
	let swordCount = 2;
	for (let i = 2; i < slotRounds.length; i += 1) {
		if (round >= slotRounds[i]) {
			swordCount = i + 1;
		}
	}
	// 검 레벨: 중복 합성/레벨업으로 6라운드당 1레벨 (최대 5) — 40초 고정 전에는 7라운드
	const swordLevel = Math.min(5, 1 + Math.floor(Math.max(0, round - 2) / 6));
	// 칸 강화: 4.2라운드당 1단계 (+10 까지, 40초 고정 전에는 5라운드). 2026-09-01
	// 확장 구간(+11~+15)은 성공률이 15%→6% 로 떨어지고 비용도 오르므로 더 느리다.
	const enhance = round < 50
		? Math.min(10, Math.floor(round / 4.2))
		: Math.min(15, 10 + Math.floor((round - 50) / 7));
	// 레벨: **logic/growth.ts 의 expectedLevelForRound 를 그대로 쓴다.**
	// 적 체력·피해가 전부 그 함수를 거치므로, 여기서 다른 근사(예전 `3 + 1.26×round`)를
	// 쓰면 플레이어와 적이 서로 다른 레벨 가정 위에서 계산된다 — 2026-09-06 에 고친
	// "22라 Lv96(기대 31)" 버그와 같은 종류의 어긋남이다. 단일 출처를 유지할 것.
	const playerLevel = expectedLevelForRound(round);
	const lv = playerLevel - 1;
	return {
		round,
		swordCount,
		swordLevel,
		enhance,
		playerLevel,
		// 레벨업 카드(실측 CARD) + 키퍼 레벨 성장(logic/growth.ts, 곱)
		//   × 스킬 트리 × 증강 × 메타 영구강화 (UNMODELED_GROWTH — 2026-09-06 추가)
		// 게임의 loadout.recalculateSwordStats 와 같은 자리에 곱해진다.
		damageMultiplier: (1 + CARD.damagePerLevel * lv)
			* playerDamageGrowth(playerLevel)
			* treeDpsMult(playerLevel)
			* augmentDpsMult(round)
			* UNMODELED_GROWTH.metaDamageMult,
		cooldownMultiplier: Math.max(
			0.35,
			(1 - CARD.cooldownPerLevel * lv) * UNMODELED_GROWTH.metaCooldownMult,
		),
		launchSpeedMultiplier: Math.min(2.5, 1 + 0.01 * lv),
		critChance: Math.min(1, 0.05 + CARD.critChancePerLevel * lv),
		critDamageMultiplier: 1.5 + CARD.critDamagePerLevel * lv,
		defense: Math.min(60, 2 + 0.35 * lv),
		// 고정 가산(카드/상점)도 성장 배율로 환산되므로 전체가 곱으로 커진다 (GameScene.applyLevelGrowth)
		maxHp: Math.round((100 + 6 * lv) * playerHpGrowth(playerLevel)),
		lifesteal: Math.min(UNLOCK_CAPS.lifesteal, 0.0005 * lv),
		// cleave/extraHit 은 epic·legendary 등급 선택지에만 있어 늦게 붙는다 (실측 회귀)
		cleaveTargets: Math.round(CARD.cleavePerLevel * lv),
		bonusHits: Math.round(CARD.bonusHitsPerLevel * lv),
		// 각인 소켓 3개 × 12종 랜덤. 피해 계열(titan/ruin/hunter)이 1/3 정도 → 소켓당 +7%
		engraveDamageMult: 1 + 0.07 * Math.min(3, Math.floor(Math.max(0, round - 10) / 8)),
	};
}

// ---------------------------------------------------------------------------
// 원소 세트 스킬의 DPS 기여 계수 (근사)
//   값 = "파티 총 피해에 곱해지는 배수 - 1". 유도 근거를 한 줄씩 남긴다.
//   ehp = 적 유효 체력 감소(처형류) — 별도 축으로 잡는다.
// ---------------------------------------------------------------------------

interface SkillEffect { dps?: number; ehp?: number; survive?: number }

/**
 * 능동 스킬 시너지 증강 6종의 **근사 계수** (2026-09-01).
 *
 * 왜 근사인가: 이 증강들은 "빌드 축"이 아니라 라운드 10/25/40/55 에 최대 4장만
 * 고르는 선택지다. 검·원소처럼 전 빌드가 항상 들고 있는 값이 아니므로 여유율
 * 계산에 넣으면 오히려 빌드 간 상대 비교를 흐린다 (게이트 임계는 그대로 둔다).
 * 대신 "골랐을 때 대략 얼마나 세지는가"를 여기에 기록해 두고 보고서에 찍는다.
 *
 * 유도 근거 (라운드 30 프로파일 · 활공 쿨 8s / 귀소 12s / 대시 3s 기준):
 *  - dive-fang       : 활공 보너스 0.30 → 0.60. 기존 활공 기여 6.0% 가 그대로 배가 → +6.0%p DPS
 *  - dive-focus      : 치명 +15%p × 0.8s/8s 가동 × 치명 배율 여유(≈0.9) → +1.4% DPS
 *  - recall-gale     : 검 피해 60% × 검 7자루 × 12초당 1회 ≈ 검 1회 출격분 → +3.5% DPS
 *  - recall-bulwark  : 무적 0.5→0.9초(12초 주기) = 피격 창 3.3% 감소 + 이동 +35%(2s) 회피 기여
 *                      → 생존 +6% (EHP 환산)
 *  - dash-afterimage : 쿨 3.0→2.1초, 잔상 45% × 접촉 평균 1.4기 → +2.8% DPS
 *  - dash-lunge      : 대시 후 2.5초 출격 +60%, 대시 주기 3초 → 사실상 상시 → +9% DPS
 *                      (초월 등급 — 다른 초월 증강과 같은 체급)
 */
export const SKILL_AUGMENT_COEFF: Record<string, { dps?: number; survive?: number }> = {
	'dive-fang': { dps: 0.060 },
	'dive-focus': { dps: 0.014 },
	'recall-gale': { dps: 0.035 },
	'recall-bulwark': { survive: 0.060 },
	'dash-afterimage': { dps: 0.028 },
	'dash-lunge': { dps: 0.090 },
};

/** 스킬 증강을 전부 골랐을 때의 상한 (실제로는 최대 4장 — 참고용 합계). */
export function skillAugmentTotals(): { dps: number; survive: number } {
	let dps = 0;
	let survive = 0;
	for (const entry of Object.values(SKILL_AUGMENT_COEFF)) {
		dps += entry.dps ?? 0;
		survive += entry.survive ?? 0;
	}
	return { dps, survive };
}

export const SKILL_DPS: Record<string, SkillEffect> = {
	// 불: 화상 처치 폭발 전이 / 발밑 장판 / 화상 5기↑ 2배
	'fire.scorch': { dps: 0.06 },
	'fire.ring': { dps: 0.08 },
	'fire.conflagration': { dps: 0.16 },
	// 번개: 감전 20% × 취약 +15% (지속 2.2초, 체감 가동률 0.7)
	'electric.shock': { dps: 0.15 * 0.7 },
	'electric.staticField': { dps: 0.10 },
	// tempest 는 취약이 +30% 로 오른다 (0.15→0.30 의 증분) + 전파
	'electric.tempest': { dps: 0.15 * 0.7 + 0.04 },
	// 얼음: 빙결(1.2초) 중 받는 피해 +25%, 가동률 ~0.3
	'ice.freeze': { dps: 0.25 * 0.3 },
	// 파편: 빙결 대상 타격 시 45% 피해가 주변 ~2.5기 (가동률 0.3)
	'ice.shatter': { dps: 0.45 * 2.5 * 0.3 * 0.5 },
	'ice.frostArmor': { survive: 0.10 },
	'ice.permafrost': { dps: 0.04, survive: 0.15 },
	// 독: 전염 / 5중첩(틱당 +2.5dps 누적) / 부식(저항 ×0.75 + 취약 10%) / 역병(초당 최대체력 1.5%)
	'poison.contagion': { dps: 0.08 },
	'poison.stack5': { dps: 0.12 },
	'poison.corrode': { dps: 0.10 },
	'poison.plague': { dps: 0.10 },
	// 황금: 탐욕(획득 골드 100당 +1%, 상한 +30% — 중반 평균 +15%) / 축복 / 미다스 3% 즉사
	'gold.greed': { dps: 0.15 },
	// 금화 벼락: 0.5초마다 평균 1타의 0.5배 × 장전된 금화(중반 평균 3개) 를 반경 120 에.
	// 검 사이클(≈1.3초, 7자루)이 내는 타격 수 대비 약 15%.
	'gold.coinstrike': { dps: 0.15 },
	'gold.blessing': { dps: 0.03 },
	'gold.midas': { ehp: 0.03 * 0.5 },
	// 피: 출혈(타격 피해의 18%를 3초간) / 저체력 광폭 / 피의 폭발 / 갈증 / 혈계
	'blood.bleed': { dps: 0.14 },
	'blood.lowHpRage': { dps: 0.06 },
	// 흡혈 5%(2+5세트) × 폭발 배율 1.6 × 반경 130 안 평균 2.3기 = 총 피해의 약 18%
	'blood.sanguineBurst': { dps: 0.05 * 1.6 * 2.3 },
	'blood.thirst': { dps: 0.08 },
	'blood.bloodline': { dps: 0.12 },
	// 바람: 칼바람 자국 / 질풍(+20% 피해, 무피격 가동률 0.5) / 폭풍의 눈
	'wind.slipstream': { dps: 0.06 },
	'wind.gale': { dps: 0.20 * 0.5 },
	'wind.eyeOfStorm': { dps: 0.08, survive: 0.15 },
	// 공허: 균열 12% / 치명타 저항 무시(별도 구현) / 소멸(12%) / 특이점(20%)
	'void.rift': { dps: 0.10 },
	'void.critPierce': {},          // 아래 dps 계산에서 정확히 구현
	'void.annihilate': { ehp: 0.12 },
	'void.singularity': { ehp: 0.08, dps: 0.06 },
};

// ---------------------------------------------------------------------------
// 빌드 (장착 7자루)
// ---------------------------------------------------------------------------

export interface Build {
	id: string;
	label: string;
	group: string;
	/**
	 * 라운드 r 에 이 컨셉이 실제로 장착하고 있을 검 count 자루.
	 * 등급 해금(RARITY_UNLOCK_ROUND)을 반영해 라운드가 오를수록 좋은 검으로 갈아탄다 —
	 * 1라운드 검을 60라운드까지 들고 있는 비현실적 가정을 피하려는 것이다.
	 */
	pick: (round: number, count: number) => SwordDef[];
	/** 표시·감사용 대표 구성 (후반 기준) */
	swords: SwordDef[];
}

export interface BuildContext {
	profile: Profile;
	setMods: SetStatMods;
	setSkills: Set<string>;
	elementCounts: Record<string, number>;
	/** 세트 스킬의 DPS/EHP 보정 합 */
	skillDps: number;
	skillEhp: number;
	skillSurvive: number;
}

export function contextFor(equipped: SwordDef[], profile: Profile): BuildContext {
	const counts = countElements(equipped.map((s) => s.element));
	const tiers = computeSetTiers(counts);
	const { mods, skills } = aggregateSets(tiers);
	let skillDps = 0;
	let skillEhp = 0;
	let skillSurvive = 0;
	for (const id of skills) {
		const effect = SKILL_DPS[id];
		if (!effect) {
			continue;
		}
		skillDps += effect.dps ?? 0;
		skillEhp += effect.ehp ?? 0;
		skillSurvive += effect.survive ?? 0;
	}
	// 얼음 3세트: 감속된 적에게 주는 피해 배율 — 스탯이지만 "조건부"라
	// marginStats 가 아니라 스킬 계수 쪽으로 넣는다 (가동률을 곱해야 하므로).
	if (mods.slowedDamageMult !== 1) {
		const uptime = skills.has('ice.permafrost')
			? CAL.slowUptimePermafrost
			: equipped.some((s) => s.special?.type === 'slow')
				? CAL.slowUptimeSlowSword
				: CAL.slowUptimeNone;
		skillDps += (mods.slowedDamageMult - 1) * uptime;
	}
	return {
		profile,
		setMods: mods,
		setSkills: skills,
		elementCounts: counts,
		skillDps,
		skillEhp: Math.min(0.35, skillEhp),
		skillSurvive,
	};
}

// ---------------------------------------------------------------------------
// 라운드별 적 상태
// ---------------------------------------------------------------------------

export interface ScaledEnemy {
	def: EnemyDef;
	weight: number;
	hp: number;
	damage: number;
	physicalResist: number;
	magicResist: number;
	traits: ReturnType<typeof traitsOf>;
	dotImmune: boolean;
	kind: 'normal' | 'miniboss' | 'boss';
}

export function scaledEnemy(def: EnemyDef, round: number, weight = 1): ScaledEnemy {
	const hpMult = hpMultForRound(round);
	const kind: ScaledEnemy['kind'] = def.isBoss ? 'boss' : (def.isMiniboss || def.isElite) ? 'miniboss' : 'normal';
	const resistBonus = resistBonusForRound(round);
	return {
		def,
		weight,
		// 숫자 인플레이션 성장은 종류 지수 바깥에 곱한다 (EnemyManager.spawnEnemy 와 동일)
		hp: Math.round(def.hp * hpScaleForKind(hpMult, kind) * enemyHpGrowth(round)) * CAL.affixEhpMult(round),
		damage: Math.round(def.damage * damageMultForRound(round) * enemyDamageGrowth(round)),
		physicalResist: Math.min(0.85, (def.physicalResist ?? 0) + resistBonus),
		magicResist: Math.min(0.85, (def.magicResist ?? 0) + resistBonus),
		traits: traitsOf(def as never),
		dotImmune: traitsImmuneTo(traitsOf(def as never), 'dot'),
		kind,
	};
}

/** 라운드 r 의 스폰 풀 (waveTable 브래킷) + 스폰 간격(초). */
export function roundWave(round: number): { pool: ScaledEnemy[]; spawnIntervalSec: number; alive: number } {
	const wave = WAVE_TABLE.waves[waveBracketIndex(round, WAVE_TABLE.waves.length)];
	const pool: ScaledEnemy[] = [];
	for (const entry of wave.pool) {
		const def = ENEMY_BY_ID.get(entry.id);
		if (def) {
			pool.push(scaledEnemy(def, round, entry.weight));
		}
	}
	// WaveSystem.startRound 의 스폰 프로파일과 **같은 함수**를 쓴다 (roundScaling)
	const intervalMs = spawnIntervalForRound(wave.spawnIntervalMs, round);
	const alive = minAliveForRound(wave.minAlive ?? 0, round);
	return { pool, spawnIntervalSec: intervalMs / 1000, alive };
}

/** 라운드 최소 길이(초) — 목표를 일찍 달성해도 이만큼은 스폰이 이어진다. */
export const ROUND_MIN_SEC = ROUND_MIN_MS / 1000;

// ---------------------------------------------------------------------------
// 검 1자루의 대(對)개체 DPS
// ---------------------------------------------------------------------------

export interface SwordDpsBreakdown {
	dps: number;
	hitsPerSec: number;
	perHit: number;
	cycleSec: number;
}

export function swordDpsVs(
	sword: SwordDef,
	ctx: BuildContext,
	enemy: ScaledEnemy,
	alive: number,
): SwordDpsBreakdown {
	const { profile, setMods } = ctx;
	const level = profile.swordLevel;
	const enhance = profile.enhance;

	// --- 거동 아키타입 (src/logic/swordBehavior.ts) ---
	// 선회/참격은 한 대가 약한 대신 경로 위 여러 마리를 벤다. 말뚝은 한 대 뒤에 오라로 이어진다.
	// 계수는 게임 코드와 **같은 파일**을 import 한다 — 여기서 다시 정의하지 않는다.
	const bh = behaviorSpec(behaviorOf(sword));

	// --- 검 스탯 (loadout.recalculateSwordStats 와 동일한 식) ---
	const slotDamageMult = (SHOP_CATALOG.slots?.enhanceDamagePerLevel ?? 0.07) * enhance;
	const swordDamage = Math.round((sword.damage ?? 20) * (1 + SWORD_LEVEL_DAMAGE_BONUS * (level - 1)) * (1 + slotDamageMult));

	// --- 1타 피해 (hitResolution.registerSwordHit) ---
	const damageMultiplier = profile.damageMultiplier * setMods.dmgMult * profile.engraveDamageMult;
	const raw = Math.round(swordDamage * damageMultiplier * bh.damageMult);

	const totalCrit = (sword.critChance ?? 0) + profile.critChance + setMods.critChance;
	const playerCritMult = profile.critDamageMultiplier + setMods.critDamage;
	const baseCritMult = ((sword.critDamageMultiplier ?? 1) + playerCritMult) / 2;
	const critOverflow = Math.max(0, totalCrit - 1);
	const pCrit = Math.min(1, totalCrit);
	// 소프트캡 — 게임(hitResolution)과 같은 함수를 쓴다
	const critDamage = Math.round(raw * softCapCritMultiplier(baseCritMult + critOverflow));

	const damageType = sword.damageType ?? 'physical';
	const resist = damageType === 'magic' ? enemy.magicResist : enemy.physicalResist;
	const pen = (damageType === 'magic' ? (sword.magicPen ?? 0) : (sword.physicalPen ?? 0)) + setMods.pen;

	const nonCritHit = mitigateEnemyDamage(raw, resist, pen);
	// 공허 5세트: 치명타는 저항을 완전히 무시한다 (hitResolution 의 ignoreResist 분기)
	const critPierce = ctx.setSkills.has('void.critPierce');
	const critHit = critPierce ? critDamage : mitigateEnemyDamage(critDamage, resist, pen);

	const traitMult = traitDamageMult(enemy.traits, (sword.element ?? null) as never);
	let perHit = ((1 - pCrit) * nonCritHit + pCrit * critHit) * traitMult;

	// 초희귀 검: %체력 피해 / 트루 피해 (저항 무시)
	if ((sword.maxHpDamage ?? 0) > 0) {
		perHit += maxHpBonusDamage(enemy.hp, sword.maxHpDamage!);
	}
	if ((sword.trueDamage ?? 0) > 0) {
		perHit += sword.trueDamage!;
	}

	// --- 사이클 (movement.updateOrbitingSword / updateLaunchedSword) ---
	const cooldownSec = (sword.cooldownMs ?? 1500)
		* profile.cooldownMultiplier * setMods.cdMult
		* bh.cooldownMult
		* Math.max(0.5, 1 - 0.06 * (level - 1))
		* Math.max(0.4, 1 - 0.015 * enhance)
		/ 1000;
	const launchSpeed = (sword.launchSpeed ?? 400) * profile.launchSpeedMultiplier * setMods.launchMult;
	const travelSec = CAL.engageDistPx / Math.max(120, launchSpeed);
	const interHitSec = Math.max(sword.hitCooldownMs ?? 110, 110) / 1000 + CAL.retargetSec;
	// 밀집할수록 근접 스캔(반경 120)이 쿨다운을 건너뛴다
	const crowdSkip = Math.min(CAL.crowdSkipMax, Math.max(CAL.crowdSkipMin, alive * CAL.crowdSkipPerAlive));
	const idleSec = cooldownSec * (1 - crowdSkip);

	// 아키타입마다 "출격 1회가 몇 대를 때리고 몇 초를 쓰는가"가 다르다.
	let hitsPerLaunch = (sword.maxHits ?? 1) + profile.bonusHits + (level >= 3 ? 1 : 0) + (level >= 5 ? 1 : 0);
	let cycleSec = travelSec + (hitsPerLaunch - 1) * interHitSec + CAL.returnSec + idleSec;
	/** 말뚝검 오라처럼 "출격 1회당 한 번" 붙는 여분 피해 */
	let behaviorLaunchExtra = 0;
	/** 궤도 공백 같은 아키타입 고유 대가 */
	let behaviorPenalty = 1;

	// 관통·오라가 실제로 닿는 대상 수는 화면의 밀집도에 비례한다
	const crowd = CAL.pierceCrowd(alive);

	if (bh.id === 'boomerang') {
		// 관통: 연속타 대신 호 경로 위의 대상 수. 호 한 바퀴가 곧 비행 시간이다.
		hitsPerLaunch = bh.simTargets * crowd;
		cycleSec = (bh.arcMs ?? 900) / 1000 + CAL.returnSec + idleSec;
	} else if (bh.id === 'lance') {
		// 관통: 좁은 직선이라 호보다 덜 맞히지만 사거리가 길어 비행이 짧다.
		hitsPerLaunch = bh.simTargets * crowd;
		const laneSpeed = launchSpeed * (bh.speedMult ?? 1);
		cycleSec = (bh.rangePx ?? 470) / Math.max(120, laneSpeed) + CAL.returnSec + idleSec;
	} else if (bh.id === 'stake') {
		// 명중 1회 + 꽂혀 있는 동안의 오라 틱. 오라는 치명타도, 거동 피해 배율도 타지 않는다
		// (hitResolution.applyStakeAura 와 같은 식).
		hitsPerLaunch = 1;
		// 틱 간격은 그 검의 실제 대기시간에 비례한다 (stakeTickMs — 런타임과 같은 식)
		const ticks = Math.floor((bh.plantMs ?? 3000) / stakeTickMs(cooldownSec * 1000));
		const auraTargets = Math.min(bh.auraTargetCap ?? 10, CAL.stakeAuraTargets * crowd);
		const auraRaw = Math.round(swordDamage * damageMultiplier * (bh.auraTickPct ?? 0.42));
		behaviorLaunchExtra = ticks * mitigateEnemyDamage(auraRaw, resist, pen)
			* traitMult * auraTargets;
		cycleSec = travelSec + (bh.plantMs ?? 3000) / 1000 + CAL.returnSec + idleSec;
		behaviorPenalty = CAL.stakeVacancyPenalty;
	}

	// --- 검 고유 스페셜 ---
	const setScale = hasResonance(ctx.elementCounts, sword.element) ? 1.5 : 1;
	const levelScale = (1 + 0.25 * (level - 1)) * setScale;
	let perHitExtra = 0;
	let perLaunchExtra = 0;
	const special = sword.special;
	if (special) {
		switch (special.type) {
			case 'burn':
			case 'poison': {
				if (!enemy.dotImmune) {
					const dps = (special.dps ?? 6) * levelScale * setMods.dotMult;
					const durSec = ((special.durationMs ?? 2000) * setMods.dotDurationMult) / 1000;
					// 대상 1기당 1회만 얹힌다 (연타는 갱신) → 출격당 1회로 계산
					perLaunchExtra += dps * Math.min(CAL.dotEffectiveSec, durSec);
				}
				break;
			}
			case 'chain': {
				const targets = (special.targets ?? 1) + setMods.chainTargets;
				perHitExtra += Math.max(1, perHit * (special.damagePct ?? 0.6) * setMods.chainDamageMult)
					* targets * CAL.chainHitRate;
				break;
			}
			case 'blast': {
				perHitExtra += Math.max(1, perHit * (special.damagePct ?? 0.5) * levelScale) * CAL.blastTargets;
				break;
			}
			default:
				break;
		}
	}

	// 검기 파동(cleave): 명중 1회가 주변 N기를 **같은 피해**로 때린다 (applyCleave).
	// 스페셜은 파동에 실리지 않으므로 기본 타격분에만 곱한다.
	const cleaveMult = 1 + profile.cleaveTargets * CAL.cleaveLandRate;
	const perHitTotal = perHit * cleaveMult + perHitExtra;
	const dps = (hitsPerLaunch * perHitTotal + perLaunchExtra + behaviorLaunchExtra)
		/ Math.max(0.05, cycleSec) * behaviorPenalty;
	return { dps, hitsPerSec: hitsPerLaunch / cycleSec, perHit: perHitTotal, cycleSec };
}

/** 처형(execute) 계열이 깎아내는 유효 체력 비율 (0.12 = EHP -12%). */
export function executeReduction(equipped: SwordDef[], ctx: BuildContext, enemy: ScaledEnemy): number {
	if (enemy.kind !== 'normal') {
		return 0; // 보스/중보는 처형 불가
	}
	let best = 0;
	for (const sword of equipped) {
		if (sword.special?.type === 'execute') {
			best = Math.max(best, (sword.special.threshold ?? 0.12) * CAL.executeLandRate);
		}
	}
	return Math.min(0.45, best + ctx.skillEhp);
}

// ---------------------------------------------------------------------------
// 라운드 평가
// ---------------------------------------------------------------------------

export interface RoundResult {
	round: number;
	/** 검 스탯 + 세트 스탯만 반영한 여유율 (스킬 계수 제외 — 튜닝 판단의 기준) */
	marginStats: number;
	/** 세트 스킬 계수까지 반영한 여유율 */
	marginFull: number;
	partyDps: number;
	avgTtkSec: number;
	spawnIntervalSec: number;
	surviveSec: number;
	bossTtkSec: number;
	diveContribution: number;
	/** 계단식 파워 스파이크 단계 (0~5) */
	spikeTier: number;
	/** 40초 라운드 하나가 쏟아내는 잡몹 수 (스폰 간격 기준) */
	spawnsPerRound: number;
	/** 잡몹(풀 가중 평균)을 죽이는 데 드는 검 1타 수 — "한 방에 죽는다" 체감의 직접 지표 (2026-09-04) */
	trashHits: number;
}

export function evaluateRound(build: Build, round: number): RoundResult {
	const profile = profileFor(round);
	const equipped = build.pick(round, profile.swordCount);
	const ctx = contextFor(equipped, profile);
	const { pool, spawnIntervalSec, alive } = roundWave(round);

	const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0) || 1;
	let weightedTtk = 0;
	let partyDpsAcc = 0;
	let cycleSum = 0;
	let trashHits = 0;
	for (const enemy of pool) {
		let dps = 0;
		let perHitSum = 0;
		for (const sword of equipped) {
			const result = swordDpsVs(sword, ctx, enemy, alive);
			dps += result.dps;
			cycleSum += result.cycleSec;
			perHitSum += result.perHit;
		}
		const ehp = enemy.hp * (1 - executeReduction(equipped, ctx, enemy));
		weightedTtk += (enemy.weight / totalWeight) * (ehp / Math.max(1, dps));
		partyDpsAcc += (enemy.weight / totalWeight) * dps;
		const avgPerHit = perHitSum / Math.max(1, equipped.length);
		trashHits += (enemy.weight / totalWeight) * (enemy.hp / Math.max(1, avgPerHit));
	}
	const avgCycleSec = cycleSum / Math.max(1, pool.length * equipped.length);

	const marginStats = spawnIntervalSec / Math.max(1e-6, weightedTtk);
	const marginFull = marginStats * (1 + ctx.skillDps);

	// --- 보스: 그 라운드에 나올 수 있는 보스의 처치 시간 ---
	const bossDef = ENEMY_BY_ID.get('skullwolf-boss')!;
	const boss = scaledEnemy(bossDef, round);
	let bossDps = 0;
	for (const sword of equipped) {
		bossDps += swordDpsVs(sword, ctx, boss, alive).dps;
	}
	const bossTtkSec = boss.hp / Math.max(1, bossDps * (1 + ctx.skillDps));

	// --- 생존 ---
	const avgEnemyDamage = pool.reduce((sum, e) => sum + (e.weight / totalWeight) * e.damage, 0);
	const pressure = Math.min(CAL.pressureMax, Math.max(CAL.pressureMin, alive * CAL.pressurePerAlive));
	const hitRate = CAL.maxHitsPerSec * pressure;
	const defense = profile.defense + ctx.setMods.defense;
	const mitigated = mitigatePlayerDamage(avgEnemyDamage, defense, 0, 0, 'physical')
		* (1 - Math.min(0.25, ctx.setMods.damageReduction))
		* (1 - Math.min(0.4, ctx.setMods.dodge))
		* (1 - Math.min(0.35, ctx.skillSurvive));
	// 얼음/바람 세트의 감속·이동속도는 피격 빈도를 줄인다 (근사)
	const evasion = 1 - Math.min(0.3, ctx.setMods.slowBonus * 0.2 + (ctx.setMods.moveSpeedMult - 1) * 0.8);
	const incoming = hitRate * mitigated * evasion;
	// 2026-09-04: 타격 회복은 초당 최대체력 6% 예산으로 잘린다 (logic/lifesteal.ts) — 무적 구조 제거
	const effHp = profile.maxHp * ctx.setMods.maxHpMult;
	const heal = cappedHealPerSec((profile.lifesteal + ctx.setMods.lifesteal) * partyDpsAcc, effHp);
	const surviveSec = Math.min(999, effHp / Math.max(0.1, incoming - heal));

	// --- 활공 사냥 기여도 ---
	// 활공은 쿨다운 8초마다 1.6초 창에서 모든 검의 피해를 +30% 올린다.
	// 창 안에서 각 검이 때리는 횟수 비율 = min(1, 창/사이클) 로 근사.
	const dive = SKILLS.dive;
	const windowSec = dive.bonusWindowMs / 1000;
	const cooldownSec = dive.cooldownMs / 1000;
	const boostedShare = Math.min(1, windowSec / Math.max(0.2, avgCycleSec)) * (Math.max(0.2, avgCycleSec) / windowSec);
	const diveContribution = dive.damageBonus * (windowSec / cooldownSec) * Math.min(1, boostedShare + 0.35);

	return {
		round, marginStats, marginFull, partyDps: partyDpsAcc,
		avgTtkSec: weightedTtk, spawnIntervalSec, surviveSec, bossTtkSec, diveContribution,
		spikeTier: spikeTierForRound(round),
		spawnsPerRound: ROUND_MIN_SEC / spawnIntervalSec,
		trashHits,
	};
}

export { ROUND_SCALING };
