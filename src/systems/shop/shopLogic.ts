// Pure shop pricing/offer math — no Phaser imports, fully unit-testable.
// These functions replicate the original ShopSystem calculations exactly;
// do not "improve" the formulas without a deliberate balance change.

import shopCatalogJson from '../../data/shopCatalog.json';
import type { Element, ShopCatalog, ShopStatSpec, SwordDefinition } from '../../types/catalogs';

/** The typed shop catalog instance shared by the shop modules. */
export const shopCatalog = shopCatalogJson as ShopCatalog;

export const ELEMENT_LABELS: Partial<Record<Element, string>> = {
	fire: '불',
	electric: '번개',
	poison: '독',
	void: '공허',
	gold: '황금',
	ice: '얼음',
	blood: '피',
	wind: '바람',
};

/** 등급별 기본가 — 카탈로그에 없으면 구식 tierIndex 공식으로 폴백. */
function swordBasePrice(
	definition: SwordDefinition,
	tiers: SwordDefinition[],
	catalog: ShopCatalog = shopCatalog,
): number {
	const byRarity = catalog.swordPriceByRarity;
	if (byRarity && definition.rarity && byRarity[definition.rarity] != null) {
		return byRarity[definition.rarity]!;
	}
	const tierIndex = definition.evolved
		? tiers.length
		: Math.max(0, tiers.findIndex((tier) => tier.id === definition.id));
	return (catalog.swordPriceBase ?? 25) + tierIndex * (catalog.swordPricePerTier ?? 15);
}

/** 스탯 카드 가격: 기본가 × 성장률^구매횟수 (올림). */
export function statPrice(entry: ShopStatSpec, purchaseCount: number, catalog: ShopCatalog = shopCatalog): number {
	return Math.ceil(entry.baseCost * Math.pow(catalog.priceGrowth ?? 1.35, purchaseCount));
}

/** 검 가격: 등급 기반 기본가, 이미 보유 시 레벨업 할증. */
export function swordPrice(
	definition: SwordDefinition,
	tiers: SwordDefinition[],
	existingSword: { level?: number } | null | undefined,
	catalog: ShopCatalog = shopCatalog,
): number {
	const base = swordBasePrice(definition, tiers, catalog);

	if (existingSword) {
		return Math.ceil(base * (1 + 0.6 * (existingSword.level ?? 1)));
	}

	return base;
}

/** 판매가: 구매가(티어 기본가 × 레벨 할증)의 50% (내림, 최소 1). */
export function swordSellPrice(
	definition: SwordDefinition,
	tiers: SwordDefinition[],
	level = 1,
	catalog: ShopCatalog = shopCatalog,
): number {
	const base = swordBasePrice(definition, tiers, catalog);
	return Math.max(1, Math.floor(base * (1 + 0.6 * Math.max(0, (level ?? 1) - 1)) * 0.5));
}

/**
 * 등급 가중 상점 오퍼 굴림 — mythic·evolved 제외, 라운드별 등급 개방,
 * 등급 가중치로 count 자루를 중복 없이 뽑는다. rng 주입으로 테스트 가능.
 */
export function rollSwordOffersByRarity(
	candidates: SwordDefinition[],
	round: number,
	count: number,
	catalog: ShopCatalog = shopCatalog,
	rng: () => number = Math.random,
): SwordDefinition[] {
	const unlock = catalog.swordRarityUnlockRound ?? {};
	const weightOf = catalog.swordRarityWeight ?? {};
	const pool = candidates.filter((sword) => {
		const rarity = sword.rarity ?? 'common';
		if (rarity === 'mythic' || sword.evolved) {
			return false;
		}
		return round >= (unlock[rarity] ?? 1);
	});

	const offers: SwordDefinition[] = [];
	const remaining = [...pool];
	while (offers.length < count && remaining.length > 0) {
		const total = remaining.reduce((sum, s) => sum + (weightOf[s.rarity ?? 'common'] ?? 1), 0);
		let roll = rng() * total;
		let picked = remaining.length - 1;
		for (let i = 0; i < remaining.length; i += 1) {
			roll -= weightOf[remaining[i].rarity ?? 'common'] ?? 1;
			if (roll <= 0) {
				picked = i;
				break;
			}
		}
		offers.push(remaining[picked]);
		remaining.splice(picked, 1);
	}
	return offers;
}

/** 리롤 가격: 기본가 + 라운드 보정 + 이번 상점에서의 리롤 횟수 × 5. */
export function rerollPrice(round: number, rerollCount: number, catalog: ShopCatalog = shopCatalog): number {
	return (catalog.rerollBase ?? 5) + round * (catalog.rerollPerRound ?? 2) + rerollCount * 5;
}
