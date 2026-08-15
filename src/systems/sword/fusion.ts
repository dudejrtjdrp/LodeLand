// 융합/진화: 숨겨진 진화 레시피(서로 다른 두 검 → 고유 검) 판정과 연출.
// 중복 검은 융합하지 않고 상점에서 레벨업한다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것 —
// 'sword-fused' 이벤트(GameEvents.SWORD_FUSED)의 페이로드/순서를 바꾸지 않는다.

import { GameEvents } from '../../core/events';
import type { OrbitSword, OrbitSwordDefinition } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

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
				const inheritedLevel = Math.max(pair[0].level ?? 1, pair[1].level ?? 1);
				const newSword = system.fuseSwords(pair, resultDefinition, recipe.announcement ?? `⚔ 진화! ${resultDefinition.name}`, true);
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
		system.scene.waveSystem?.announce?.(announcement, isEvolution ? '#fbbf24' : '#a7f3d0');

		if (isEvolution) {
			system.scene.cameras.main.flash(500, 251, 191, 36);
			system.scene.visualEffects?.hitStop?.(120);
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

	const color = isEvolution ? 0xfbbf24 : 0xa7f3d0;
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
