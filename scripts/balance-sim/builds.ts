// 시뮬 대상 빌드 구성 + 검 다양성 감사 유틸.
// 빌드는 "그 컨셉을 진지하게 밀었을 때 실제로 들 법한 7자루"를 뽑는다.

import evolutionCatalogRaw from '../../src/data/evolutionCatalog.json';
import {
	SWORDS, SWORD_BY_ID, contextFor, profileFor, roundWave, swordDpsVs,
	type Build, type SwordDef,
} from './model';
import { behaviorOf, behaviorSpec } from '../../src/logic/swordBehavior';

const EVOLUTIONS = evolutionCatalogRaw as unknown as Array<{ ingredients: string[]; result: string }>;

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/**
 * 등급이 실제로 손에 들어오기 시작하는 라운드 (상점 등장 확률·행운 성장 기준 가정).
 * 빌드가 라운드에 맞춰 검을 갈아타는 근거 — 1라운드 검을 60라운드까지 드는 가정을 피한다.
 */
export const RARITY_UNLOCK_ROUND: Record<string, number> = {
	common: 1, uncommon: 3, rare: 8, epic: 16, legendary: 26, mythic: 36,
};

/** 진화 검은 재료 2자루가 모여야 하므로 조금 더 늦게 등장한다. */
export function availableAt(sword: SwordDef, round: number): boolean {
	const base = RARITY_UNLOCK_ROUND[sword.rarity] ?? 1;
	return round >= (sword.evolved ? Math.max(base, 12) : base);
}

/**
 * 라운드 r 에 뽑을 수 있는 검 중 강한 순 count 자루.
 * 같은 검 2자루는 장착할 수 없다(중복은 상점에서 레벨업으로 소모된다 — fusion.ts 주석).
 * 그래서 후보가 모자라면 **다른 원소의 최강 검**으로 채운다. 순수 원소 빌드가
 * "그 원소 검이 몇 종 존재하는가"에 묶이는 것 자체가 밸런스 정보다.
 */
function topAvailable(pool: SwordDef[], round: number, count: number, fallback: SwordDef[]): SwordDef[] {
	const primary = pool.filter((s) => availableAt(s, round)).sort(byScore);
	const picked: SwordDef[] = primary.slice(0, count);
	if (picked.length < count) {
		const seen = new Set(picked.map((s) => s.id));
		const extras = fallback
			.filter((s) => availableAt(s, round) && !seen.has(s.id))
			.sort(byScore);
		for (const sword of extras) {
			if (picked.length >= count) {
				break;
			}
			picked.push(sword);
		}
	}
	// 그래도 모자라면(초반 등급 해금 전) 카탈로그 전체에서 채운다
	const all = [...SWORDS].sort(byScore);
	for (let i = 0; picked.length < count && i < all.length; i += 1) {
		if (!picked.some((s) => s.id === all[i].id)) {
			picked.push(all[i]);
		}
	}
	return picked;
}

/** 장착 판단용 정적 점수 — 초당 기대 피해의 거친 근사 (빌드 구성에만 쓴다). */
export function swordScore(sword: SwordDef): number {
	const hits = sword.maxHits ?? 1;
	const crit = 1 + (sword.critChance ?? 0) * ((sword.critDamageMultiplier ?? 1) - 1);
	const cycle = (sword.cooldownMs ?? 1500) / 1000 * 0.45 + hits * 0.17 + 0.3;
	const special = sword.special ? 1.12 : 1;
	const extra = (sword.trueDamage ?? 0) * hits + (sword.maxHpDamage ?? 0) * 900;
	return ((sword.damage ?? 0) * hits * crit * special + extra) / cycle;
}

const byScore = (a: SwordDef, b: SwordDef) => swordScore(b) - swordScore(a);

/**
 * (a) 8원소 순수 빌드 — 그 원소 검 중 강한 순으로만 채운다 (다른 원소 섞지 않음).
 * 같은 검을 2자루 장착할 수는 없으므로(중복은 레벨업으로 소모) 종수가 모자라면
 * 칸을 비운 채로 싸운다 — "이 원소에 올인하면 어디까지 가는가"를 그대로 보여준다.
 */
export function elementBuilds(): Build[] {
	const elements = ['fire', 'electric', 'ice', 'poison', 'gold', 'blood', 'wind', 'void'];
	return elements.map((element) => {
		const pool = SWORDS.filter((s) => s.element === element).sort(byScore);
		return {
			id: `element-${element}`,
			label: `순수 ${element} (보유 ${pool.length}종)`,
			group: 'element',
			pick: (round: number, count: number) => pureElementPick(pool, round, count),
			swords: pureElementPick(pool, 60, 7),
		};
	});
}

/**
 * 순수 원소 픽: 해금된 그 원소 검을 강한 순으로 채우고, 모자라는 칸은
 * **무원소 검**(39종)으로 메운다. 같은 검 2자루는 장착 불가(중복은 레벨업으로 소모)이고,
 * 다른 원소를 섞으면 그 원소의 힘이 섞여 비교가 흐려지므로 중립 검을 쓴다.
 */
const NEUTRAL = SWORDS.filter((s) => !s.element);

function pureElementPick(pool: SwordDef[], round: number, count: number): SwordDef[] {
	const picked = pool.filter((s) => availableAt(s, round)).sort(byScore).slice(0, count);
	const filler = NEUTRAL.filter((s) => availableAt(s, round)).sort(byScore);
	for (let i = 0; picked.length < count && i < filler.length; i += 1) {
		picked.push(filler[i]);
	}
	return picked;
}

/** (b) 등급 티어별 대표 빌드 — 그 등급의 중앙값 근처 7자루. */
export function rarityBuilds(): Build[] {
	// 등급 빌드는 일부러 라운드에 따라 갈아타지 않는다 — "이 등급에 묶였을 때"의 천장을 본다.
	return RARITY_ORDER.map((rarity) => {
		const pool = SWORDS.filter((s) => s.rarity === rarity).sort(byScore);
		const start = Math.max(0, Math.floor(pool.length / 2) - 3);
		const swords = Array.from({ length: 7 }, (_, i) => pool[Math.min(start + i, pool.length - 1)] ?? SWORDS[0]);
		return {
			id: `rarity-${rarity}`,
			label: `등급 대표 ${rarity}`,
			group: 'rarity',
			pick: (_round: number, count: number) => swords.slice(0, count),
			swords,
		};
	});
}

export interface RecipeAudit {
	result: string;
	ingredients: string[];
	resultScore: number;
	bestIngredientScore: number;
	sumIngredientScore: number;
	/** 결과가 재료 최고점보다 약하면 죽은 레시피 */
	dead: boolean;
	gain: number;
}

export function auditRecipes(): RecipeAudit[] {
	const out: RecipeAudit[] = [];
	for (const recipe of EVOLUTIONS) {
		const result = SWORD_BY_ID.get(recipe.result);
		const ingredients = recipe.ingredients.map((id) => SWORD_BY_ID.get(id)).filter(Boolean) as SwordDef[];
		if (!result || ingredients.length !== recipe.ingredients.length) {
			continue;
		}
		const resultScore = swordScore(result);
		const bestIngredientScore = Math.max(...ingredients.map(swordScore));
		const sumIngredientScore = ingredients.reduce((sum, s) => sum + swordScore(s), 0);
		out.push({
			result: recipe.result,
			ingredients: recipe.ingredients,
			resultScore,
			bestIngredientScore,
			sumIngredientScore,
			// 조합은 검 2자루를 1자루로 만든다 → 최소한 "최고 재료보다 확실히 세야" 의미가 있다.
			dead: resultScore < bestIngredientScore * 1.15,
			gain: resultScore / bestIngredientScore - 1,
		});
	}
	return out.sort((a, b) => a.gain - b.gain);
}

/** (c) 레시피 진화 경로 상위 10 — 결과 검 점수 상위 10개를 모아 7자루 구성. */
export function evolutionBuilds(): Build[] {
	const results = EVOLUTIONS
		.map((r) => SWORD_BY_ID.get(r.result))
		.filter(Boolean) as SwordDef[];
	const top = [...new Set(results)].sort(byScore).slice(0, 10);
	const evolvedPool = [...new Set(results)];
	const builds: Build[] = [{
		id: 'evo-top7',
		label: '진화 상위 7자루',
		group: 'evolution',
		pick: (round: number, count: number) => topAvailable(evolvedPool, round, count, SWORDS),
		swords: top.slice(0, 7),
	}];
	// 각 레시피 결과 1자루 + 나머지는 그 시점 평균 검으로 채운 "단일 진화" 빌드
	const filler = SWORDS.filter((s) => s.rarity === 'rare').sort(byScore)[Math.floor(SWORDS.filter((s) => s.rarity === 'rare').length / 2)];
	for (const sword of top) {
		builds.push({
			id: `evo-${sword.id}`,
			label: `진화 ${sword.name}`,
			group: 'evolution-single',
			// 진화 1자루 + 나머지는 그 라운드에 흔하게 쥐고 있을 검
			pick: (round: number, count: number) => {
				const rest = topAvailable(SWORDS.filter((s) => !s.evolved), round, count - 1, SWORDS);
				return availableAt(sword, round) ? [sword, ...rest] : topAvailable(SWORDS, round, count, SWORDS);
			},
			swords: [sword, ...Array.from({ length: 6 }, () => filler)],
		});
	}
	return builds;
}

/** (d) 무전략 랜덤 픽 베이스라인 — 시드 고정 RNG. */
export function randomBuilds(count = 24, seed = 20260901): Build[] {
	let state = seed;
	const rnd = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	// 상점 등장 확률에 가깝게: common/uncommon 이 흔하고 legendary/mythic 은 드물다
	const weights: Record<string, number> = {
		common: 24, uncommon: 34, rare: 26, epic: 11, legendary: 4, mythic: 1,
	};
	const pool: SwordDef[] = [];
	for (const sword of SWORDS) {
		const w = weights[sword.rarity] ?? 10;
		for (let i = 0; i < w; i += 1) {
			pool.push(sword);
		}
	}
	return Array.from({ length: count }, (_, i) => {
		// 라운드마다 "그 시점에 굴러들어온 검"을 무전략으로 집는 상황
		const draw = (round: number, n: number): SwordDef[] => {
			const available = pool.filter((s) => availableAt(s, round));
			const source = available.length > 0 ? available : pool;
			return Array.from({ length: n }, () => source[Math.floor(rnd() * source.length)]);
		};
		return {
			id: `random-${i}`,
			label: `랜덤 픽 #${i}`,
			group: 'baseline',
			pick: draw,
			swords: draw(40, 7),
		};
	});
}

// ---------------------------------------------------------------------------
// 검 다양성 감사 — 같은 등급 안에서 모든 스탯이 다른 검 이하인 검 찾기
// ---------------------------------------------------------------------------

export interface DominatedSword {
	id: string;
	name: string;
	rarity: string;
	element: string | null;
	dominatedBy: string;
}

export interface BehaviorAudit {
	id: string;
	label: string;
	count: number;
	/** 라운드 평균 DPS 비 (1.0 = 아키타입을 얹기 전과 같은 힘) */
	relDps: number;
	/** 라운드별 DPS 비 (BEHAVIOR_AUDIT_ROUNDS 순서) */
	byRound: number[];
}

/** 아키타입 감사를 재는 라운드 (초반·중반·후반을 고루) */
export const BEHAVIOR_AUDIT_ROUNDS = [8, 15, 30, 45, 60, 80];

/**
 * 거동 아키타입이 "다르되 약하지 않은가"를 본다 (2026-09-01).
 *
 * 비교 대상은 **같은 검을 기본 거동으로 뒀을 때**다. 같은 등급의 평균과 견주면
 * 그 검이 원래 느린 계열인지 빠른 계열인지가 섞여 들어와 아키타입의 효과를 못 읽는다.
 * "이 검에 아키타입을 얹으면 세지는가 약해지는가"가 정확히 우리가 묻는 질문이다.
 */
export function auditBehaviors(): BehaviorAudit[] {
	const contexts = BEHAVIOR_AUDIT_ROUNDS.map((round) => {
		const profile = profileFor(round);
		const wave = roundWave(round);
		// 세트 보정이 섞이지 않도록 빈 장착으로 중립 컨텍스트를 만든다
		return { ctx: contextFor([], profile), enemy: wave.pool[0], alive: wave.alive };
	}).filter((entry) => Boolean(entry.enemy));

	const out: BehaviorAudit[] = [];
	for (const id of ['boomerang', 'stake', 'lance']) {
		const picks = SWORDS.filter((sword) => behaviorOf(sword) === id);
		if (picks.length === 0 || contexts.length === 0) {
			continue;
		}
		const byRound = contexts.map(({ ctx, enemy, alive }) => {
			let sum = 0;
			for (const sword of picks) {
				const withBehavior = swordDpsVs(sword, ctx, enemy, alive).dps;
				const asOrbit = swordDpsVs({ ...sword, behavior: undefined }, ctx, enemy, alive).dps;
				sum += withBehavior / Math.max(1e-6, asOrbit);
			}
			return sum / picks.length;
		});
		out.push({
			id,
			label: behaviorSpec(id as never).label,
			count: picks.length,
			relDps: byRound.reduce((a, b) => a + b, 0) / byRound.length,
			byRound,
		});
	}
	return out;
}

function statVector(sword: SwordDef): number[] {
	return [
		sword.damage ?? 0,
		-(sword.cooldownMs ?? 1500),
		sword.maxHits ?? 1,
		sword.critChance ?? 0,
		sword.critDamageMultiplier ?? 1,
		sword.launchSpeed ?? 400,
		(sword.physicalPen ?? 0) + (sword.magicPen ?? 0),
		sword.trueDamage ?? 0,
		sword.maxHpDamage ?? 0,
	];
}

/**
 * 같은 등급 **+ 같은 원소** 안에서 모든 스탯이 다른 검 이하인 검.
 * 원소가 다르면 세트/상성 축이 달라 대체재가 아니므로 비교하지 않는다.
 */
export function auditDominated(): DominatedSword[] {
	const out: DominatedSword[] = [];
	for (const rarity of RARITY_ORDER) {
		const rarityPool = SWORDS.filter((s) => s.rarity === rarity);
		for (const sword of rarityPool) {
			const pool = rarityPool.filter((s) => (s.element ?? null) === (sword.element ?? null));
			const vector = statVector(sword);
			for (const other of pool) {
				if (other.id === sword.id) {
					continue;
				}
				// 스페셜을 가진 검은 "스페셜 없는 검"에게 지배당하지 않는다 (비교 불가 축)
				if (sword.special && (!other.special || other.special.type !== sword.special.type)) {
					continue;
				}
				// 거동 아키타입이 다르면 스탯 벡터로 우열을 가릴 수 없다 (2026-09-01).
				// 선회검의 낮은 단타는 경로 관통으로, 말뚝검의 느린 쿨다운은 설치 오라로
				// 갚는다 — 스페셜과 같은 이유로 "비교 불가 축"이다.
				if (behaviorOf(sword) !== behaviorOf(other)) {
					continue;
				}
				const otherVector = statVector(other);
				let allLe = true;
				let anyLt = false;
				for (let i = 0; i < vector.length; i += 1) {
					if (vector[i] > otherVector[i]) {
						allLe = false;
						break;
					}
					if (vector[i] < otherVector[i]) {
						anyLt = true;
					}
				}
				if (allLe && anyLt) {
					out.push({
						id: sword.id, name: sword.name, rarity,
						element: sword.element ?? null, dominatedBy: other.id,
					});
					break;
				}
			}
		}
	}
	return out;
}
