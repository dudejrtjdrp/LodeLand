// Pure element-set (원소 세트) counting rules — no Phaser imports.
// IMPORTANT: only EQUIPPED swords count for resonance/ultimates; callers must
// pass data derived from the equipped list only (reserve/창고 excluded).

/** Count occurrences per element; null/undefined (element-less swords) are skipped. */
export function countElements(elements: Array<string | null | undefined>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const element of elements) {
		if (element) {
			counts[element] = (counts[element] ?? 0) + 1;
		}
	}
	return counts;
}

/** 세트 공명: 같은 원소 2자루 이상 → 원소 효과 1.5배. */
export function hasResonance(counts: Record<string, number>, element: string | null | undefined): boolean {
	return element ? (counts[element] ?? 0) >= 2 : false;
}

/**
 * 필살기 해금: 해당 원소의 장착 검이 2자루 이상이고 전부 Lv3+.
 * `memberLevels` = levels of the EQUIPPED swords of that element.
 */
export function ultimateUnlocked(memberLevels: number[]): boolean {
	return memberLevels.length >= 2 && memberLevels.every((level) => level >= 3);
}
