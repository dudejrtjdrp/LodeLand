// 융합/진화: 숨겨진 진화 레시피(서로 다른 두 검 → 고유 검) 판정과 연출.
// 중복 검은 융합하지 않고 상점에서 레벨업한다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것 —
// 'sword-fused' 이벤트(GameEvents.SWORD_FUSED)의 페이로드/순서를 바꾸지 않는다.

import { GameEvents } from '../../core/events';
import { screenShakeEnabled } from '../../core/settings';
import MetaProgression from '../MetaProgression';
import type { OrbitSword, OrbitSwordDefinition } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

// ---------------------------------------------------------------------------
// 명시적 REFORGE (2026-08-25): 자동 융합을 없애고 상점의 REFORGE 모달에서만
// 조합한다. 재료는 장착(PERCH)+창고(ROOST) 통합 보유분에서 찾는다.
// ---------------------------------------------------------------------------

/** REFORGE 모달용 레시피 상태. 미보유 재료는 UI에서 ???로 가린다. */
export interface ReforgeRecipeState {
	recipeIndex: number;
	ingredients: { id: string; owned: boolean; level: number }[];
	/** 두 재료를 모두 보유해 조합 가능한가 */
	ready: boolean;
	/** 과거에 한 번이라도 조합했거나 결과 검을 보유 중 — 레시피를 ??? 없이 공개 */
	discovered: boolean;
	resultDefinition: OrbitSwordDefinition | null;
	announcement: string;
}

/** id 보유 검 찾기 — 장착 우선, 없으면 ROOST. exclude로 같은 검 중복 매칭 방지. */
function findOwned(
	system: SwordOrbitSystem,
	id: string,
	exclude: { sword?: OrbitSword | null; reserveIndex?: number },
): { sword: OrbitSword | null; reserveIndex: number; level: number } | null {
	const sword = system.swords.find((s) => s.definition?.id === id && s !== exclude.sword) ?? null;
	if (sword) {
		return { sword, reserveIndex: -1, level: sword.level ?? 1 };
	}
	const reserveIndex = system.reserve.findIndex(
		(entry, index) => entry.definition?.id === id && index !== exclude.reserveIndex,
	);
	if (reserveIndex >= 0) {
		return { sword: null, reserveIndex, level: system.reserve[reserveIndex].level ?? 1 };
	}
	return null;
}

export function getReforgeStates(system: SwordOrbitSystem): ReforgeRecipeState[] {
	const discoveredSet = new Set(MetaProgression.getDiscoveredRecipes());
	return system.evolutionRecipes.map((recipe, recipeIndex) => {
		const first = findOwned(system, recipe.ingredients[0], {});
		const second = findOwned(system, recipe.ingredients[1], {
			sword: first?.sword, reserveIndex: first?.reserveIndex,
		});
		const ingredients = [
			{ id: recipe.ingredients[0], owned: Boolean(first), level: first?.level ?? 0 },
			{ id: recipe.ingredients[1], owned: Boolean(second), level: second?.level ?? 0 },
		];
		// 결과 검을 이미 들고 있으면 (이 기능 이전에 조합했던 세이브 포함) 발견 처리
		let discovered = discoveredSet.has(recipe.result);
		if (!discovered && findOwned(system, recipe.result, {})) {
			discovered = true;
			MetaProgression.recordRecipeDiscovered(recipe.result);
		}
		return {
			recipeIndex,
			ingredients,
			ready: Boolean(first && second),
			discovered,
			resultDefinition: system.getDefinitionById(recipe.result) ?? null,
			announcement: recipe.announcement ?? '',
		};
	});
}

/**
 * 레시피 하나를 명시적으로 조합. 재료 2자루(장착/ROOST 불문)를 소모하고
 * 결과 검을 빈 PERCH가 있으면 장착, 없으면 ROOST로 지급. 레벨은 재료 중 최대 계승.
 */
export function reforge(system: SwordOrbitSystem, recipeIndex: number): boolean {
	const recipe = system.evolutionRecipes[recipeIndex];
	const resultDefinition = recipe ? system.getDefinitionById(recipe.result) : null;
	if (!recipe || !resultDefinition) {
		return false;
	}

	const first = findOwned(system, recipe.ingredients[0], {});
	const second = findOwned(system, recipe.ingredients[1], {
		sword: first?.sword, reserveIndex: first?.reserveIndex,
	});
	if (!first || !second) {
		return false;
	}

	const inheritedLevel = Math.max(first.level, second.level);

	// 각인 부분 계승 (2026-08-28): 두 재료의 각인을 합쳐 무작위로 절반(올림)만
	// 살아남는다. 최대 소켓 수(기본 3)를 넘지 않는다.
	const firstTraits = first.sword ? (first.sword.traits ?? []) : (system.reserve[first.reserveIndex]?.traits ?? []);
	const secondTraits = second.sword ? (second.sword.traits ?? []) : (system.reserve[second.reserveIndex]?.traits ?? []);
	const pooledTraits = [...firstTraits, ...secondTraits];
	for (let i = pooledTraits.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[pooledTraits[i], pooledTraits[j]] = [pooledTraits[j], pooledTraits[i]];
	}
	const socketCap = system.slotConfig.traitSockets ?? 3;
	const inheritedTraits = pooledTraits.slice(0, Math.min(socketCap, Math.ceil(pooledTraits.length / 2)));

	const player = system.scene?.player ?? null;
	const effectX = first.sword?.x ?? player?.x ?? 0;
	const effectY = first.sword?.y ?? player?.y ?? 0;

	// 소모: reserve는 뒤 인덱스부터 지워야 앞 인덱스가 안 밀린다
	const reserveRemovals = [first.reserveIndex, second.reserveIndex]
		.filter((index) => index >= 0)
		.sort((a, b) => b - a);
	for (const index of reserveRemovals) {
		system.reserve.splice(index, 1);
	}
	if (first.sword) {
		system.removeSword(first.sword);
	}
	if (second.sword) {
		system.removeSword(second.sword);
	}

	// 지급: 빈 PERCH 우선, 만석이면 ROOST
	let resultSword: OrbitSword | false = false;
	if (system.swords.length < system.getEffectiveMaxSwords()) {
		resultSword = system.addSword(system.scene, resultDefinition);
	}
	if (resultSword) {
		resultSword.level = Math.min(system.maxSwordLevel ?? 5, inheritedLevel);
		resultSword.traits = [...inheritedTraits];
		system.recalculateSwordStats(resultSword);
		system.refreshAura(resultSword);
		system.refreshSwordHud();
	} else {
		system.addToReserve(resultDefinition, Math.min(system.maxSwordLevel ?? 5, inheritedLevel), inheritedTraits);
	}

	MetaProgression.recordRecipeDiscovered(recipe.result);

	if (system.scene) {
		// 도전과제: 조합 성공 누적 (재료 소모·지급이 끝난 뒤 한 번만)
		system.scene.achievements?.onReforge();
		system.scene.soundSystem?.play('evolve');
		system.playFusionEffect(effectX, effectY, true);
		system.scene.waveSystem?.announce?.(recipe.announcement ?? `조합 — ${resultDefinition.name}`, '#d9a83c');
		// 조합은 상점 모달 위에서 일어난다 — 전체 화면 금색 플래시는 그 위에 덧씌워져
		// 결과 검 연출(ShopUi.playReforgeResultFX)을 통째로 지워 버린다. 상점이 열려
		// 있으면 화면 플래시를 생략하고 모달 연출에 맡긴다. (2026-09-01)
		if (screenShakeEnabled() && !system.scene.shopSystem?.isOpen) {
			system.scene.cameras.main.flash(500, 217, 168, 60);
		}
		system.scene.events.emit(GameEvents.SWORD_FUSED, {
			result: resultDefinition,
			isEvolution: true,
			sword: resultSword,
		});
	}

	system.checkSetAnnouncements();
	return true;
}

export function findPair(system: SwordOrbitSystem, idA: string, idB: string): [OrbitSword, OrbitSword] | null {
	if (idA === idB) {
		const matches = system.swords.filter((sword) => sword.definition?.id === idA);
		return matches.length >= 2 ? [matches[0], matches[1]] : null;
	}

	const first = system.swords.find((sword) => sword.definition?.id === idA);
	const second = system.swords.find((sword) => sword.definition?.id === idB);
	return first && second ? [first, second] : null;
}

export function checkFusions(system: SwordOrbitSystem): boolean {
	let fusedAny = false;
	let safety = 8;

	let fused = true;
	while (fused && safety > 0) {
		fused = false;
		safety -= 1;

		// Hidden evolution recipes (different swords combine into a unique one).
		// Duplicates level up in the shop instead of fusing.
		for (const recipe of system.evolutionRecipes) {
			const pair = system.findPair(recipe.ingredients[0], recipe.ingredients[1]);
			const resultDefinition = system.getDefinitionById(recipe.result);

			if (pair && resultDefinition) {
				MetaProgression.recordRecipeDiscovered(recipe.result);
				const inheritedLevel = Math.max(pair[0].level ?? 1, pair[1].level ?? 1);
				const newSword = system.fuseSwords(pair, resultDefinition, recipe.announcement ?? `조합 — ${resultDefinition.name}`, true);
				if (newSword) {
					newSword.level = inheritedLevel;
					system.recalculateSwordStats(newSword);
					system.refreshSwordHud();
				}
				fused = true;
				fusedAny = true;
				break;
			}
		}
	}

	return fusedAny;
}

export function fuseSwords(
	system: SwordOrbitSystem,
	pair: [OrbitSword, OrbitSword],
	resultDefinition: OrbitSwordDefinition,
	announcement: string,
	isEvolution: boolean,
): OrbitSword | false {
	const [first, second] = pair;
	const effectX = first.x;
	const effectY = first.y;

	system.removeSword(first);
	system.removeSword(second);

	const newSword = system.addSword(system.scene, resultDefinition);

	if (system.scene) {
		system.scene.soundSystem?.play('evolve');
		system.playFusionEffect(effectX, effectY, isEvolution);
		system.scene.waveSystem?.announce?.(announcement, isEvolution ? '#d9a83c' : '#9bc25b');

		if (isEvolution) {
			if (screenShakeEnabled()) {
				system.scene.cameras.main.flash(500, 217, 168, 60);
			}
			system.scene.visualEffects?.hitStop?.(120, { force: true });
		}

		system.scene.events.emit(GameEvents.SWORD_FUSED, {
			result: resultDefinition,
			isEvolution,
			sword: newSword,
		});
	}

	return newSword;
}

export function playFusionEffect(system: SwordOrbitSystem, x: number, y: number, isEvolution: boolean): void {
	if (!system.scene) {
		return;
	}

	const color = isEvolution ? 0xd9a83c : 0x9bc25b;
	const ring = system.scene.add.circle(x, y, 14, color, 0.85).setDepth(60);

	system.scene.tweens.add({
		targets: ring,
		scale: isEvolution ? 5 : 3,
		alpha: 0,
		duration: isEvolution ? 480 : 300,
		ease: 'Cubic.easeOut',
		onComplete: () => ring.destroy(),
	});
}
