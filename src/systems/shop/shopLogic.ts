// Pure shop pricing/offer math — no Phaser imports, fully unit-testable.
// These functions replicate the original ShopSystem calculations exactly;
// do not "improve" the formulas without a deliberate balance change.

import shopCatalogJson from '../../data/shopCatalog.json';
import type { Element, ShopCatalog, ShopStatSpec, SwordDefinition } from '../../types/catalogs';

/** The typed shop catalog instance shared by the shop modules. */
export const shopCatalog = shopCatalogJson as ShopCatalog;

export const ELEMENT_LABELS: Partial<Record<Element, string>> = {
	fire: '🔥화염',
	electric: '⚡전기',
	poison: '☠️독',
	void: '🕳️공허',
	gold: '🪙황금',
};

/** 스탯 카드 가격: 기본가 × 성장률^구매횟수 (올림). */
export function statPrice(entry: ShopStatSpec, purchaseCount: number, catalog: ShopCatalog = shopCatalog): number {
	return Math.ceil(entry.baseCost * Math.pow(catalog.priceGrowth ?? 1.35, purchaseCount));
}

/** 검 가격: 티어 기반 기본가, 이미 보유 시 레벨업 할증. */
export function swordPrice(
	definition: SwordDefinition,
	tiers: SwordDefinition[],
	existingSword: { level?: number } | null | undefined,
	catalog: ShopCatalog = shopCatalog,
): number {
	const tierIndex = Math.max(0, tiers.findIndex((tier) => tier.id === definition.id));
	const base = (catalog.swordPriceBase ?? 25) + tierIndex * (catalog.swordPricePerTier ?? 15);

	if (existingSword) {
		return Math.ceil(base * (1 + 0.6 * (existingSword.level ?? 1)));
	}

	return base;
}

/** 리롤 가격: 기본가 + 라운드 보정 + 이번 상점에서의 리롤 횟수 × 5. */
export function rerollPrice(round: number, rerollCount: number, catalog: ShopCatalog = shopCatalog): number {
	return (catalog.rerollBase ?? 5) + round * (catalog.rerollPerRound ?? 2) + rerollCount * 5;
}
