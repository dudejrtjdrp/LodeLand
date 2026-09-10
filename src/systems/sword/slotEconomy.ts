// 칸(슬롯) 경제: 강화(확률 기반 +1, 💎면 확정) / 전설 특성 가챠 / 칸 보너스 집계 /
// 원소 시너지 오라. 순수 수식(해금 비용·강화 비용·성공률)은 src/logic/slots.ts 에 있다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것.

import Phaser from 'phaser';
import traitCatalogRaw from '../../data/traitCatalog.json';
import type { TraitCatalog, TraitDefinition } from '../../types/catalogs';
import type { OrbitSword, SlotModifiers } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

const traitCatalog = traitCatalogRaw as unknown as TraitCatalog;

export const ELEMENT_COLORS: Record<string, number> = {
	fire: 0xf97316,
	electric: 0x60a5fa,
	poison: 0x4ade80,
	void: 0x7c3aed,
	gold: 0xfde047,
	ice: 0x93c5fd,
	blood: 0xef4444,
	wind: 0xa7f3d0,
};

export function getTraitById(id: string): TraitDefinition | null {
	return traitCatalog.traits.find((trait) => trait.id === id) ?? null;
}

// Chance-based +1 (guaranteed with a 💎). Returns 'success' | 'fail' | 'max'.
export function tryEnhanceSlot(system: SwordOrbitSystem, slotIndex: number, guaranteed = false): 'success' | 'fail' | 'max' {
	const state = system.getSlotState(slotIndex);
	if (!state || state.enhance >= (system.slotConfig.enhanceMaxLevel ?? 10)) {
		return 'max';
	}

	const success = guaranteed || Math.random() < system.enhanceSuccessRate(slotIndex);
	if (!success) {
		return 'fail';
	}

	state.enhance += 1;
	const sword = system.swords[slotIndex];
	if (sword) {
		system.recalculateSwordStats(sword);
	}
	system.refreshSwordHud();
	return 'success';
}

// 각인 가챠: 무작위 각인을 그 자리에 앉은 "검"에 새긴다 (각인은 검 귀속 — 2026-08-28)
export function pullTrait(system: SwordOrbitSystem, slotIndex: number): TraitDefinition | null {
	if (!system.canAddTrait(slotIndex)) {
		return null;
	}

	const sword = system.swords[slotIndex]!;
	const trait = Phaser.Math.RND.pick(traitCatalog.traits);
	(sword.traits ??= []).push(trait.id);

	system.recalculateSwordStats(sword);
	system.refreshAura(sword);
	system.refreshSwordHud();
	return trait;
}

// Aggregate a sword's slot bonuses. Element-matching traits are DOUBLED (synergy).
export function computeSlotModifiers(system: SwordOrbitSystem, sword: OrbitSword): SlotModifiers {
	const mods: SlotModifiers = {
		damageMult: 0,
		cooldownMult: 0,
		launchSpeedMult: 0,
		chainBonus: 0,
		dotDpsBonus: 0,
		dotDurationBonus: 0,
		executeBonus: 0,
		goldOnHitChance: 0,
		slowOnHit: 0,
		healOnHitChance: 0,
		bigGameDamage: 0,
		critDamageAdd: 0,
		cleaveBonus: 0,
		hasSynergy: false,
		synergyElement: null,
	};

	// 자리 강화(+4% dmg / -1.5% cd per level)는 위치 기반으로 유지
	const slotIndex = system.swords.indexOf(sword);
	const state = system.getSlotState(slotIndex);
	if (state) {
		mods.damageMult += (system.slotConfig.enhanceDamagePerLevel ?? 0.04) * state.enhance;
		mods.cooldownMult -= (system.slotConfig.enhanceCooldownPerLevel ?? 0.015) * state.enhance;
	}

	const swordElement = sword.definition?.element ?? null;

	// 숫자 누적용 인덱스 뷰 (런타임 객체는 동일)
	const bag = mods as unknown as Record<string, number>;

	// 각인은 검 귀속 — 검이 자리를 옮겨도 따라간다 (2026-08-28)
	for (const traitId of sword.traits ?? []) {
		const trait = system.getTraitById(traitId);
		if (!trait) {
			continue;
		}

		// 원소 시너지: 검과 특성의 원소가 일치하면 효과 2배 + 오라
		const synergy = Boolean(swordElement && trait.element && trait.element === swordElement);
		const factor = synergy ? 2 : 1;

		if (synergy) {
			mods.hasSynergy = true;
			mods.synergyElement = swordElement;
		}

		for (const [key, value] of Object.entries(trait.effects ?? {})) {
			if (bag[key] !== undefined) {
				bag[key] += value * factor;
			}
		}
	}

	return mods;
}

export function refreshAura(system: SwordOrbitSystem, sword: OrbitSword | null): void {
	if (!sword) {
		return;
	}

	const mods = sword.traitMods ?? system.computeSlotModifiers(sword);

	if (mods.hasSynergy && !sword.aura) {
		const color = ELEMENT_COLORS[mods.synergyElement!] ?? 0xffffff;
		// 원본도 가드 없이 this.scene 에 접근한다 (검이 있으면 scene 존재)
		const scene = system.scene!;
		sword.aura = scene.add.circle(sword.x, sword.y, 34, color, 0.22)
			.setStrokeStyle(2, color, 0.7)
			.setDepth(1);
		scene.tweens.add({
			targets: sword.aura,
			scale: 1.2,
			alpha: 0.6,
			yoyo: true,
			repeat: -1,
			duration: 600,
		});
	} else if (!mods.hasSynergy && sword.aura) {
		// repeat:-1 트윈은 대상이 destroy돼도 TweenManager에 남아 매 프레임 계속 돈다.
		system.scene?.tweens?.killTweensOf(sword.aura);
		sword.aura.destroy();
		sword.aura = null;
	}
}
