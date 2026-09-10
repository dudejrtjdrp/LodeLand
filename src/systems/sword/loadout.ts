// 장착(칸)/창고(Reserve) 관리 + 검 생성·스탯 재계산.
// 핵심은 rebuildLoadout: 모든 장착/해제/교환은 이 함수를 거치며,
// 칸 보너스가 위치 기반이므로 배치가 바뀔 때마다 전체 재계산한다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것.

import Phaser from 'phaser';
import { recordSwordSeen } from '../../core/codex';
import { behaviorOf, behaviorSpec } from '../../logic/swordBehavior';
import { softSwordTint } from '../../logic/swordTint';
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
	// 도감 기록: 검을 실제로 손에 넣는 유일한 두 경로가 addSword / addToReserve 다.
	// 이미 기록된 id 면 Set 조회 한 번으로 끝나고, 신규일 때만 localStorage 에 쓴다.
	if (recordSwordSeen(definition?.id)) {
		scene.achievements?.onCodexRecorded?.();
	}
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
	// 거동 아키타입은 항상 카탈로그에서 다시 읽는다 (세이브에 저장하지 않는다)
	sword.behavior = behaviorOf(definition);
	sword.orbitSpeedMultiplier = definition.orbitSpeedMultiplier ?? 1;
	sword.level = 1;
	sword.traits = []; // 각인은 검 귀속 — rebuildLoadout 이 엔트리에서 복사한다

	sword.launchSpeed = (definition.launchSpeed ?? 400) * system.launchSpeedMultiplier;
	sword.damage = definition.damage ?? 20;
	sword.scanInterval = (definition.cooldownMs ?? 1500) * system.cooldownMultiplier
		* behaviorSpec(sword.behavior).cooldownMult;
	// 질풍 각성(gale): 각성된 검은 재생성돼도 연속 타격 +1 유지
	sword.hitsPerLaunch = (definition.maxHits ?? 1) + system.bonusHits
		+ (system.awakenings?.[definition.id ?? ''] === 'gale' ? 1 : 0);
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

	// 원소색 틴트 — 단색 곱셈이 아니라 휘도 복원 + 광원(좌상단) 방향 그라디언트다.
	// 도트의 5단계 명암을 살려 둔 채 색만 얹는다 (src/logic/swordTint.ts).
	if (sword.effect?.tint && typeof sword.setTint === 'function') {
		const corners = softSwordTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
		sword.setTint(corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight);
	}

	// Evolved swords render larger to feel special
	if (definition.evolved) {
		sword.setDisplaySize(70, 70);
	}

	system.swords.push(sword);
	// 칸 강화·각성·레벨 성장 배율까지 반영한 실제 스탯으로 (raw 카탈로그 값으로 남아 있던 버그, 2026-09-04)
	system.recalculateSwordStats(sword);
	// 링 배치 캐시(_ringIndex/_ringCount)를 새 구성으로 갱신한 뒤 위치를 잡는다.
	system.recomputeRingLayout();
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

	// 도전과제: 검을 최고 단계까지 올린 순간 (전이 시점에 한 번만 — 이미 만렙이면
	// 위 가드에서 false 로 빠지므로 중복 호출되지 않는다)
	if (sword.level >= system.maxSwordLevel) {
		system.scene?.achievements?.onSwordMaxLevel?.();
	}

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
	// 검 각성 (라운드 40, 증강 시스템): 파괴=피해 +85%, 질풍=대기시간 -35%
	const awakening = system.awakenings?.[definition.id ?? ''];

	sword.damage = Math.round(
		(definition.damage ?? 20)
		* (1 + system.levelDamageBonus * levelBonus)
		* (1 + slotMods.damageMult)
		* (awakening === 'ruin' ? 1.85 : 1)
		// 키퍼 레벨 성장 (logic/growth.ts) — 숫자 인플레이션의 플레이어 쪽 축
		* (system.growthDamageMult ?? 1),
	);
	sword.scanInterval = (definition.cooldownMs ?? 1500)
		* system.cooldownMultiplier
		// 거동 아키타입 대가: 관통·설치는 재출격이 느리다 (swordBehavior.ts)
		* behaviorSpec(sword.behavior ?? behaviorOf(definition)).cooldownMult
		* Math.max(0.5, 1 - system.levelCooldownBonus * levelBonus)
		* Math.max(0.4, 1 + slotMods.cooldownMult)
		* (awakening === 'gale' ? 0.65 : 1);
	sword.launchSpeed = (definition.launchSpeed ?? 400)
		* system.launchSpeedMultiplier
		* (1 + slotMods.launchSpeedMult);
	sword.traitMods = slotMods;
}

/**
 * 검을 파괴하기 직전에 붙어 있던 물리 콜라이더·트윈·아우라를 정리한다.
 * Phaser의 GameObject.destroy()는 physics.add.overlap이 만든 Collider도,
 * repeat:-1 트윈도 회수하지 않으므로 런이 길어질수록 좀비 객체가 누적됐다.
 */
function releaseSwordResources(system: SwordOrbitSystem, sword: OrbitSword): void {
	const scene = system.scene;
	if (sword._overlapCollider) {
		scene?.physics?.world?.removeCollider(sword._overlapCollider);
		sword._overlapCollider = null;
	}
	sword._orbitEnemyGroup = null;
	if (sword.aura) {
		scene?.tweens?.killTweensOf(sword.aura);
		sword.aura.destroy();
		sword.aura = undefined;
	}
	scene?.tweens?.killTweensOf(sword);
}

export function removeSword(system: SwordOrbitSystem, sword: OrbitSword): void {
	const index = system.swords.indexOf(sword);
	if (index < 0) {
		return;
	}

	system.swords.splice(index, 1);
	// 검을 파괴해도 Phaser는 콜라이더/트윈을 회수하지 않는다 — 융합·재장착마다 죽은
	// 콜라이더와 무한 트윈(시너지 아우라)이 월드에 쌓이던 누수를 여기서 끊는다.
	releaseSwordResources(system, sword);
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
		releaseSwordResources(system, sword);
		sword.destroy();
	}
	system.swords = [];

	for (const entry of loadout) {
		const sword = system.addSword(system.scene, entry.definition);
		if (sword) {
			sword.level = entry.level;
			sword.traits = [...(entry.traits ?? [])];
			system.recalculateSwordStats(sword);
			system.refreshAura(sword);
		} else {
			// 안전망: 칸 부족 등으로 재생성에 실패한 검은 소멸시키지 말고 보관함으로 회수
			system.reserve.push({ definition: entry.definition, level: entry.level, traits: [...(entry.traits ?? [])] });
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
	// 자동 융합 없음 — 조합은 상점 REFORGE 모달에서만 (2026-08-25)
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
