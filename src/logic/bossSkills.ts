// 보스 스킬 카탈로그 — "패턴을 읽고 파훼한다" (2026-08-31, 2026-09-02 전면 확장).
//
// 설계 원칙 (사용자 요구):
//   - 뒤에 나올 강한 보스일수록 스킬이 하나둘씩 늘어난다 (라운드가 오르면 같은
//     보스도 더 많은 스킬을 꺼낸다) → skillCountForRound.
//   - 모든 스킬은 명확한 텔레그래프(예고 표시)와 파훼법이 있다. 즉살기(처형 광선)도
//     축선만 벗어나면 무피해 — "몰라서 죽고, 알면 피한다".
//   - 스킬 정보는 대기마을 정찰 보고에 파훼법과 함께 노출된다.
//
// 2026-09-02 개편 (실플레이 피드백):
//   1. 패턴 12종 (신규 8종) — 30라 기준 보스는 한 라운드에 5종을 섞어 쓴다.
//   2. "맞을만하게": 텔레그래프를 0.7~1.15초로 줄이고 범위·연속성을 키웠다.
//      대신 즉살기(beam)를 제외한 전 스킬의 피해는 낮췄다 — 자주 스치되 즉사하지 않는다.
//   3. 보스마다 스킬 풀이 다르다 (enemyCatalog.json 의 `skillKit`; 없으면 아래 폴백).
//
// 회피 하한 규약 (dodgeFloorOk 가 강제):
//   원형/부채꼴 계열은 "중심에서 가장자리까지의 거리 ÷ 텔레그래프 시간" 이
//   키퍼 기본 이동속도(350px/s)의 85% 를 넘으면 안 된다. 감속이 겹쳐도 대시(SHIFT)
//   한 번이면 빠져나갈 수 있는 여백을 남긴다.
//
// 실행은 EnemyManager (텔레그래프 저장/렌더/판정), 데이터는 여기.

import enemyCatalogJson from '../data/enemyCatalog.json';

export type BossSkillId =
	| 'slam' | 'barrage' | 'beam' | 'cinch' | 'enrage'
	// 2026-09-02 신규 8종
	| 'mines' | 'rush' | 'sweep' | 'spiral' | 'fan' | 'halffield' | 'seal' | 'meteor';

export interface BossSkillDef {
	id: BossSkillId;
	name: string;
	/** 정찰 보고용 한 줄 설명 */
	desc: string;
	/** 파훼법 (정찰 보고·시전 배너에 표시) */
	counter: string;
	cooldownMs: number;
	/** 텔레그래프 표시 → 발동까지 (첫 타 기준) */
	castMs: number;
	/** circle 계: 반경 / beam·rush: 폭 / cinch: 시작(바깥) 반경 / sweep·halffield: 사거리 */
	radius?: number;
	/** cinch: 조여든 뒤의 최종 반경 — 이 안에 남아 있으면 맞는다 */
	innerRadius?: number;
	/** cinch: 안전한 틈의 반각(라디안) / sweep: 부채꼴 반각 */
	gapHalfWidth?: number;
	/** barrage: 낙하 지점 수 / fan: 탄 수 */
	count?: number;
	/** 연속 패턴의 단계 수 (mines 2단, rush 3연타, sweep 5분할, meteor 5연타 …) */
	steps?: number;
	/** 단계 사이 간격(ms) */
	stepDelayMs?: number;
	/** spiral: 한 번에 나가는 탄 수 / fan: 사용 안 함 */
	bullets?: number;
	/** 탄막 속도(px/s) — 키퍼 이동속도(350)보다 느리게 둔다 */
	bulletSpeed?: number;
	/** rush: 돌진 속도(px/s) */
	dashSpeed?: number;
	/** rush: 돌진 지속(ms) */
	dashMs?: number;
	/** seal: 봉인 지속(ms) — 귀소(SPACE)로 즉시 해제된다 */
	sealMs?: number;
	/** seal: 한 번에 봉인하는 검 수 */
	sealCount?: number;
	/** 피해 = 플레이어 최대 체력 × 이 비율 (beam 3.0 = 사실상 즉살) */
	damagePctMaxHp: number;
}

/**
 * 12종 전 패턴. 수치는 전부 여기서만 만진다 (EnemyManager 는 상수를 갖지 않는다).
 */
export const BOSS_SKILLS: Record<BossSkillId, BossSkillDef> = {
	slam: {
		id: 'slam',
		name: '대지 강타',
		desc: '제자리에서 힘을 모아 주변을 내리찍는다',
		counter: '붉은 원 밖으로 걸어 나가면 된다 — 예고가 짧으니 바로 움직여라',
		cooldownMs: 3600,
		castMs: 850,
		radius: 230,
		damagePctMaxHp: 0.42,
	},
	barrage: {
		id: 'barrage',
		name: '낙석 폭격',
		desc: '키퍼 주변 여러 지점에 파편을 순차로 떨어뜨린다',
		counter: '표시된 자리만 비우면 맞지 않는다 — 원 사이 빈틈으로 파고들어라',
		cooldownMs: 4200,
		castMs: 900,
		radius: 130,
		count: 6,
		stepDelayMs: 130,
		damagePctMaxHp: 0.30,
	},
	beam: {
		id: 'beam',
		name: '처형 광선',
		desc: '조준선을 그은 뒤 일직선을 꿰뚫는 즉살기',
		counter: '광선 축선에서 옆으로 비켜서라 — 맞으면 끝장',
		cooldownMs: 8000,
		castMs: 1150,
		radius: 96, // 광선 폭
		damagePctMaxHp: 3.0,
	},
	cinch: {
		id: 'cinch',
		name: '전방위 조임',
		desc: '사방에서 고리가 좁혀 들어온다 — 한 곳만 틈이 열려 있다',
		counter: '초록 틈 쪽으로 대시(SHIFT)해 빠져나가거나, 귀소(SPACE) 무적으로 흘려라',
		cooldownMs: 6500,
		castMs: 1250,
		radius: 520,
		innerRadius: 330,
		gapHalfWidth: 0.34,
		damagePctMaxHp: 0.60,
	},
	// ── 2026-09-02 신규 ────────────────────────────────────────────────
	mines: {
		id: 'mines',
		name: '균열 지뢰',
		desc: '바닥을 갈라 지뢰를 심는다 — 1차가 터진 자리에 2차가 다시 열린다',
		counter: '1차를 피한 자리에서 한 번 더 움직여라 (제자리에 서면 2차에 맞는다)',
		cooldownMs: 4200,
		castMs: 800,
		radius: 150,
		count: 4,
		steps: 2,
		stepDelayMs: 700,
		damagePctMaxHp: 0.26,
	},
	rush: {
		id: 'rush',
		name: '삼연 돌진',
		desc: '축선을 그은 뒤 그대로 돌진한다 — 매번 다시 조준한다',
		counter: '축선과 직각으로 빠져라. 돌진이 끝난 자리는 잠깐 안전하다',
		cooldownMs: 5000,
		castMs: 750,
		radius: 118, // 돌진 폭
		steps: 3,
		stepDelayMs: 380,
		dashSpeed: 900,
		dashMs: 280,
		damagePctMaxHp: 0.45,
	},
	sweep: {
		id: 'sweep',
		name: '회전 빔 스윕',
		desc: '광선을 한 방향으로 쓸어 낸다 — 부채꼴이 차례로 지나간다',
		counter: '쓸어오는 반대 방향으로 돌거나, 시전자 발밑(축)으로 파고들어라',
		cooldownMs: 5200,
		castMs: 800,
		radius: 560,
		gapHalfWidth: 0.40, // 부채꼴 반각
		steps: 5,
		stepDelayMs: 220,
		damagePctMaxHp: 0.28,
	},
	spiral: {
		id: 'spiral',
		name: '나선 탄막',
		desc: '몸을 돌리며 탄을 흩뿌린다 — 나선이 천천히 벌어진다',
		counter: '탄속이 느리다. 나선의 결을 따라 같은 방향으로 돌면 통과한다',
		cooldownMs: 4200,
		castMs: 700,
		steps: 8,
		stepDelayMs: 130,
		bullets: 3,
		bulletSpeed: 210,
		damagePctMaxHp: 0.10,
	},
	fan: {
		id: 'fan',
		name: '부채꼴 일제사',
		desc: '넓은 부채꼴로 한꺼번에 쏜다',
		counter: '부채꼴 옆으로 돌아 들어가라 — 탄 사이 간격이 멀어지는 바깥이 안전하다',
		cooldownMs: 3600,
		castMs: 750,
		count: 9,
		bulletSpeed: 250,
		damagePctMaxHp: 0.12,
	},
	halffield: {
		id: 'halffield',
		name: '반쪽 붕괴',
		desc: '전장의 절반이 무너진다 — 잠시 뒤 반대쪽이 무너진다',
		counter: '안전한 절반으로 넘어가고, 곧바로 다시 넘어와라',
		cooldownMs: 6000,
		castMs: 900,
		radius: 900, // 렌더/판정 사거리
		steps: 2,
		stepDelayMs: 1100,
		damagePctMaxHp: 0.50,
	},
	seal: {
		id: 'seal',
		name: '검 봉인',
		desc: '사슬을 던져 궤도의 검 한 자루를 잠근다',
		counter: '귀소(SPACE)로 무리를 불러들이면 사슬이 즉시 끊어진다',
		cooldownMs: 7000,
		castMs: 700,
		radius: 240,
		sealMs: 5000,
		sealCount: 1,
		damagePctMaxHp: 0,
	},
	meteor: {
		id: 'meteor',
		name: '낙하 연타',
		desc: '키퍼가 선 자리를 계속 다시 조준해 떨어뜨린다',
		counter: '멈추지 마라 — 한 방향으로 계속 달리면 전부 뒤에 떨어진다',
		cooldownMs: 4600,
		castMs: 700,
		radius: 115,
		steps: 5,
		stepDelayMs: 420,
		damagePctMaxHp: 0.20,
	},
	enrage: {
		id: 'enrage',
		name: '격노',
		desc: '체력이 절반 아래로 떨어지면 붉게 달아오르며 빨라진다',
		counter: '격노 후엔 거리를 벌리고 약점 원소로 압박하라',
		cooldownMs: 0,
		castMs: 0,
		damagePctMaxHp: 0,
	},
};

/** 즉살기(맞으면 끝) — 파훼 규약상 여기 있는 것만 최대 체력 초과 피해를 낸다. */
export const EXECUTION_SKILLS: readonly BossSkillId[] = ['beam'];

/**
 * 보스별 스킬 킷 폴백 — 순서 = 해금 순서.
 * 실제 값은 enemyCatalog.json 의 `skillKit` 이 우선한다 (데이터로 튜닝).
 * enrage 를 4번째에 두어 30라(6칸)에서 능동 패턴 5종이 돌게 맞췄다.
 */
const FALLBACK_KITS: Record<string, BossSkillId[]> = {
	'skullwolf-boss': ['slam', 'mines', 'barrage', 'enrage', 'rush', 'meteor', 'cinch', 'halffield', 'seal'],
	'boss-siegehulk': ['slam', 'rush', 'barrage', 'enrage', 'meteor', 'mines', 'cinch', 'halffield', 'sweep'],
	'boss-needlequeen': ['fan', 'barrage', 'spiral', 'enrage', 'beam', 'meteor', 'sweep', 'cinch', 'seal'],
	'death-lord': ['slam', 'mines', 'seal', 'enrage', 'beam', 'halffield', 'barrage', 'cinch', 'sweep'],
	'boss-minos': ['rush', 'slam', 'mines', 'enrage', 'meteor', 'halffield', 'cinch', 'barrage', 'sweep'],
	'boss-frost-guardian': ['fan', 'sweep', 'halffield', 'enrage', 'beam', 'mines', 'spiral', 'cinch', 'seal'],
	'boss-abyss-demon': ['slam', 'spiral', 'mines', 'enrage', 'beam', 'seal', 'halffield', 'meteor', 'cinch'],
	// 탈각하는 것: 실제 스킬은 phases 가 형태별로 오버라이드한다 (이 킷은 폴백)
	'boss-molt': ['slam', 'barrage', 'mines', 'enrage', 'beam', 'spiral', 'halffield', 'rush', 'cinch'],
};

/** enemyCatalog 의 skillKit 을 읽어 폴백 위에 덮는다 (데이터 우선). */
function buildKits(): Record<string, BossSkillId[]> {
	const kits: Record<string, BossSkillId[]> = { ...FALLBACK_KITS };
	const catalog = enemyCatalogJson as Array<{ id?: string; skillKit?: string[] }>;
	for (const entry of catalog) {
		if (!entry?.id || !Array.isArray(entry.skillKit) || entry.skillKit.length === 0) {
			continue;
		}
		const kit = entry.skillKit.filter((id): id is BossSkillId => Boolean(BOSS_SKILLS[id as BossSkillId]));
		if (kit.length > 0) {
			kits[entry.id] = kit;
		}
	}
	return kits;
}

export const BOSS_KITS: Record<string, BossSkillId[]> = buildKits();

/**
 * 라운드별 해금 칸 수 (칸 = 스킬 슬롯, enrage 포함).
 *
 * 이전에는 10라마다 1칸이라 30라에서 3칸(능동 2~3종)뿐이었다 — 40초 라운드에서
 * 보스가 같은 패턴만 두 번 꺼내고 끝났다. 5라마다 1칸으로 바꿔 30라에 6칸
 * (= 능동 5종 + 격노) 이 되게 했다. 사용자 요구: "30라 기준 4~6종".
 */
export function skillCountForRound(round: number): number {
	if (round < 10) {
		return 1;
	}
	return Math.min(9, 2 + Math.floor((round - 10) / 5));
}

/** 이 라운드에 이 보스가 실제로 쓰는 스킬 목록 */
export function activeSkillsFor(bossId: string, round: number): BossSkillDef[] {
	const kit = BOSS_KITS[bossId] ?? [];
	return kit.slice(0, skillCountForRound(round)).map((id) => BOSS_SKILLS[id]);
}

/**
 * 라운드별 시전 간격 배율 — 후반 보스는 조금 더 몰아친다.
 * 하한 0.72 (= 최대 28% 단축). 격노 배율과 곱해진다.
 */
export function skillCooldownMultForRound(round: number): number {
	return Math.max(0.72, 1 - Math.max(0, round - 10) * 0.006);
}

/**
 * 회피 하한 검증 — "이론상 회피 불가" 패턴을 막는 규약.
 * 원형/부채꼴/고리 계열에서 (탈출 거리 ÷ 텔레그래프 시간) 이 이 값을 넘으면 안 된다.
 */
export const KEEPER_BASE_SPEED = 350;
export const DODGE_SPEED_BUDGET = 0.85;

/** 이 스킬이 요구하는 최소 이동속도(px/s). 0 이면 이동으로 회피할 필요가 없는 패턴. */
export function requiredDodgeSpeed(skill: BossSkillDef): number {
	const seconds = Math.max(0.001, skill.castMs / 1000);
	switch (skill.id) {
		case 'slam':
		case 'mines':
		case 'meteor':
		case 'barrage':
			return (skill.radius ?? 0) / seconds;
		case 'cinch':
			// 고리는 안쪽 반경 밖으로 나가야 한다 (또는 초록 틈으로)
			return (skill.innerRadius ?? 0) / seconds;
		case 'sweep':
			// 부채꼴은 축(피벗) 쪽으로 파고들거나 회전 반대로 돌면 된다 —
			// 필요한 것은 "부채꼴 폭 하나만큼" 옆으로 비키는 거리.
			return ((skill.radius ?? 0) * (skill.gapHalfWidth ?? 0.4)) / seconds;
		case 'rush':
		case 'beam':
			// 축선 폭의 절반만 비키면 된다
			return ((skill.radius ?? 0) / 2) / seconds;
		default:
			return 0;
	}
}

/** 전 스킬이 회피 하한을 지키는가 (테스트·개발 가드). */
export function dodgeFloorOk(): { ok: boolean; worst: { id: BossSkillId; required: number } | null } {
	let worst: { id: BossSkillId; required: number } | null = null;
	for (const skill of Object.values(BOSS_SKILLS)) {
		const required = requiredDodgeSpeed(skill);
		if (!worst || required > worst.required) {
			worst = { id: skill.id, required };
		}
	}
	const limit = KEEPER_BASE_SPEED * DODGE_SPEED_BUDGET;
	return { ok: (worst?.required ?? 0) <= limit, worst };
}
