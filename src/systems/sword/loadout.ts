// 장착(칸)/창고(Reserve) 관리 + 검 생성·스탯 재계산.
// 핵심은 rebuildLoadout: 모든 장착/해제/교환은 이 함수를 거치며,
// 칸 보너스가 위치 기반이므로 배치가 바뀔 때마다 전체 재계산한다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것.

import Phaser from 'phaser';
import type { LoadoutEntry, OrbitSword, OrbitSwordDefinition } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';
import type GameScene from '../../scenes/GameScene';

export function addSword(
	system: SwordOrbitSystem,
	scene: GameScene | null,
	definitionOverride: OrbitSwordDefinition | null = null,
): OrbitSword | false {
	if (!scene || system.swords.length >= system.getEffectiveMaxSwords()) {
		return false;
	}

	const slot = system.swords.length;
	const definition = definitionOverride ?? system.getSwordDefinition(slot);
	const frame = definition.sheetOrder ?? slot % 30;
	const sword = scene.physics.add.sprite(0, 0, 'sword', frame) as OrbitSword;

	sword.setOrigin(0.5, 0.5);
	sword.setDepth(2);
	sword.setActive(true);
	sword.setVisible(true);
	sword.setDisplaySize(56, 56);

	if (sword.body) {
		const body = sword.body as Phaser.Physics.Arcade.Body;
		body.setAllowGravity(false);
		body.setImmovable(true);
		const hitbox = definition.hitbox ?? {};
		const hitboxWidth = hitbox.width ?? 24;
		const hitboxHeight = hitbox.height ?? 24;
		const hitboxOffsetX = hitbox.offsetX ?? Math.max(0, Math.floor((body.width - hitboxWidth) / 2));
		const hitboxOffsetY = hitbox.offsetY ?? Math.max(0, Math.floor((body.height - hitboxHeight) / 2));
		body.setSize(hitboxWidth, hitboxHeight, true);
		body.setOffset(hitboxOffsetX, hitboxOffsetY);
	}

	sword.slot = slot;
	sword.definition = definition;
	sword.orbitSpeedMultiplier = definition.orbitSpeedMultiplier ?? 1;
	sword.level = 1;
	sword.launchSpeed = (definition.launchSpeed ?? 400) * system.launchSpeedMultiplier;
	sword.damage = definition.damage ?? 20;
	sword.scanInterval = (definition.cooldownMs ?? 1500) * system.cooldownMultiplier;
	sword.hitsPerLaunch = (definition.maxHits ?? 1) + system.bonusHits;
	sword.special = definition.special ?? null;
	sword.remainingHits = sword.hitsPerLaunch;
	sword.hitCooldownMs = definition.hitCooldownMs ?? 110;
	sword.hitCooldownUntil = 0;
	sword.hitTargets = new Set();
	sword.effect = definition.effect ?? null;
	sword.state = 'orbiting';
	sword.target = null;
	sword.scanTimer = 0;
	Object.defineProperty(sword, 'angle', {
		value: 0,
		writable: true,
		enumerable: true,
		configurable: true,
	});

	if (sword.effect?.tint && typeof sword.setTint === 'function') {
		sword.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
	}

	// Evolved swords render larger to feel special
	if (definition.evolved) {
		sword.setDisplaySize(70, 70);
	}

	system.swords.push(sword);
	system.bindSwordOverlap(sword);
	system.updateSwordPositions(system.scene?.player ?? null);
	system.refreshSwordHud();
	system.checkSetAnnouncements();

	return sword;
}

export function levelUpSword(system: SwordOrbitSystem, sword: OrbitSword | null): boolean {
	if (!sword || sword.level >= system.maxSwordLevel) {
		return false;
	}

	sword.level += 1;
	system.recalculateSwordStats(sword);

	// Milestone: at level 3 and 5 the sword gains an extra hit per launch
	if (sword.level === 3 || sword.level === 5) {
		sword.hitsPerLaunch += 1;
		sword.remainingHits += 1;
	}

	system.scene?.soundSystem?.play('evolve', { volume: 0.6 });
	system.playFusionEffect(sword.x, sword.y, false);
	system.refreshSwordHud();
	system.checkSetAnnouncements();

	return true;
}

export function recalculateSwordStats(system: SwordOrbitSystem, sword: OrbitSword): void {
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};
	const levelBonus = sword.level - 1;
	const slotMods = system.computeSlotModifiers(sword);

	sword.damage = Math.round(
		(definition.damage ?? 20)
		* (1 + system.levelDamageBonus * levelBonus)
		* (1 + slotMods.damageMult),
	);
	sword.scanInterval = (definition.cooldownMs ?? 1500)
		* system.cooldownMultiplier
		* Math.max(0.5, 1 - system.levelCooldownBonus * levelBonus)
		* Math.max(0.4, 1 + slotMods.cooldownMult);
	sword.launchSpeed = (definition.launchSpeed ?? 400)
		* system.launchSpeedMultiplier
		* (1 + slotMods.launchSpeedMult);
	sword.traitMods = slotMods;
}

export function removeSword(system: SwordOrbitSystem, sword: OrbitSword): void {
	const index = system.swords.indexOf(sword);
	if (index < 0) {
		return;
	}

	system.swords.splice(index, 1);
	sword.aura?.destroy();
	sword.destroy();
	system.reindexSlots();

	// Slot bonuses are positional: refresh stats for shifted swords
	for (const remaining of system.swords) {
		system.recalculateSwordStats(remaining);
		system.refreshAura(remaining);
	}
	system.refreshSwordHud();
}

// Rebuild all equipped sword sprites from a data list (safe way to reorder)
export function rebuildLoadout(system: SwordOrbitSystem, loadout: LoadoutEntry[]): void {
	for (const sword of [...system.swords]) {
		sword.aura?.destroy();
		sword.destroy();
	}
	system.swords = [];

	for (const entry of loadout) {
		const sword = system.addSword(system.scene, entry.definition);
		if (sword) {
			sword.level = entry.level;
			system.recalculateSwordStats(sword);
			system.refreshAura(sword);
		}
	}

	system.reindexSlots();
	system.refreshSwordHud();
	system.updateSwordPositions(system.scene?.player ?? null);
}

// 창고 → 칸 장착. 대상 칸에 검이 있으면 맞교환(그 검은 창고로).
export function equipFromReserve(system: SwordOrbitSystem, reserveIndex: number, targetSlot: number): boolean {
	const entry = system.reserve[reserveIndex];
	if (!entry || targetSlot >= system.unlockedSlots) {
		return false;
	}

	const loadout = system.getLoadout();

	if (targetSlot < loadout.length) {
		system.reserve[reserveIndex] = loadout[targetSlot];
		loadout[targetSlot] = entry;
	} else {
		if (loadout.length >= system.getEffectiveMaxSwords()) {
			return false;
		}
		system.reserve.splice(reserveIndex, 1);
		loadout.push(entry);
	}

	system.rebuildLoadout(loadout);
	system.checkFusions();
	system.checkSetAnnouncements();
	return true;
}

// 칸 → 창고 (장착 해제)
export function unequipToReserve(system: SwordOrbitSystem, slotIndex: number): boolean {
	const sword = system.swords[slotIndex];
	if (!sword) {
		return false;
	}

	const loadout = system.getLoadout();
	const [removed] = loadout.splice(slotIndex, 1);
	system.reserve.push(removed);
	system.rebuildLoadout(loadout);
	return true;
}

// Move/swap swords between slots (slot bonuses are positional, so this matters)
export function swapSlots(system: SwordOrbitSystem, a: number, b: number): boolean {
	const max = system.getEffectiveMaxSwords();
	if (a === b || a < 0 || b < 0 || a >= max || b >= max) {
		return false;
	}

	const swordA = system.swords[a] ?? null;
	const swordB = system.swords[b] ?? null;

	if (!swordA && !swordB) {
		return false;
	}

	if (swordA && swordB) {
		[system.swords[a], system.swords[b]] = [swordB, swordA];
	} else if (swordA && !swordB) {
		// Move into an empty slot: reorder to the last position (swords stay compact)
		system.swords.splice(a, 1);
		system.swords.push(swordA);
	} else {
		system.swords.splice(b, 1);
		system.swords.push(swordB!);
	}

	system.reindexSlots();
	for (const sword of system.swords) {
		system.recalculateSwordStats(sword);
		system.refreshAura(sword);
	}
	system.refreshSwordHud();
	system.updateSwordPositions(system.scene?.player ?? null);
	return true;
}
