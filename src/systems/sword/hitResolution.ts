// 타격 판정 & 피해 적용: 크리티컬 계산, 초희귀 검 추가 피해(applyRareExtras),
// 특성 발동, 검 고유 스페셜(burn/poison/midas/chain/execute), 검기 파동(cleave).
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것 — 수식 변경 금지.

import { maxHpBonusDamage } from '../../logic/combat';
import type { EnemySprite } from '../../types/actors';
import type { DamageableEnemy, DamageInfo, OrbitSword, OrbitSwordDefinition, SlotModifiers } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

// 초희귀 검 전용: %체력 피해 / 고정(트루) 피해 - 저항 무시
export function applyRareExtras(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite): void {
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};

	if ((definition.maxHpDamage ?? 0) > 0 && system.isValidEnemy(enemy)) {
		// 원본 수식과 동일: Math.min(300, Math.max(1, Math.round(maxHp * maxHpDamage)))
		const bonus = maxHpBonusDamage(enemy.maxHp, definition.maxHpDamage!);
		system.applyDamage(enemy, bonus, false, { ignoreResist: true });
	}

	if ((definition.trueDamage ?? 0) > 0 && system.isValidEnemy(enemy)) {
		system.applyDamage(enemy, definition.trueDamage!, false, { ignoreResist: true });
	}
}

// Trait-driven on-hit procs (slot sockets)
export function applyTraitProcs(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite): void {
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};
	const player = system.scene?.player;

	if ((traitMods.goldOnHitChance ?? 0) > 0 && Math.random() < traitMods.goldOnHitChance!) {
		system.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', 1);
	}

	if ((traitMods.slowOnHit ?? 0) > 0 && system.isValidEnemy(enemy) && !enemy.catalog?.isBoss && !enemy.catalog?.isReaper) {
		enemy.slowFactor = 1 - Math.min(0.7, traitMods.slowOnHit!);
		enemy.slowUntil = (system.scene?.time?.now ?? 0) + 1200;
	}

	if ((traitMods.healOnHitChance ?? 0) > 0 && player && !player.isDead && Math.random() < traitMods.healOnHitChance!) {
		player.hp = Math.min(player.maxHp, player.hp + 1);
	}
}

export function applySpecial(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite, damage: number): void {
	const special = sword.special;
	if (!special || !system.isValidEnemy(enemy)) {
		return;
	}

	const enemyManager = system.scene?.enemyManager;
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};
	// 세트 공명(같은 원소 2자루) 시 원소 효과 1.5배
	const setScale = system.hasSetResonance(sword.definition?.element) ? 1.5 : 1;
	const levelScale = (1 + 0.25 * ((sword.level ?? 1) - 1)) * setScale; // specials grow with sword level

	switch (special.type) {
		case 'burn':
			enemyManager?.applyDot?.(enemy, (special.dps ?? 6) * levelScale + (traitMods.dotDpsBonus ?? 0), (special.durationMs ?? 2000) + (traitMods.dotDurationBonus ?? 0), 0xf97316);
			break;
		case 'poison':
			enemyManager?.applyDot?.(enemy, (special.dps ?? 8) * levelScale + (traitMods.dotDpsBonus ?? 0), (special.durationMs ?? 2500) + (traitMods.dotDurationBonus ?? 0), 0x4ade80);
			break;
		case 'midas':
			if (Math.random() < (special.chance ?? 0.15)) {
				system.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', Math.max(1, Math.round(levelScale)));
			}
			break;
		case 'chain': {
			const targets = (special.targets ?? 1) + (traitMods.chainBonus ?? 0);
			const chainDamage = Math.max(1, Math.round(damage * (special.damagePct ?? 0.6)));
			const nearby: Array<{ other: EnemySprite; distanceSquared: number }> = [];

			for (const other of system.getEnemyChildren(system.enemyGroup)) {
				if (!system.isValidEnemy(other) || other === enemy) {
					continue;
				}
				const dx = other.x - enemy.x;
				const dy = other.y - enemy.y;
				const distanceSquared = dx * dx + dy * dy;
				if (distanceSquared <= 200 * 200) {
					nearby.push({ other, distanceSquared });
				}
			}

			nearby.sort((a, b) => a.distanceSquared - b.distanceSquared);
			for (const { other } of nearby.slice(0, targets)) {
				system.applyDamage(other, chainDamage, false, system.getDamageInfo(sword));
				system.playChainEffect(enemy, other);
			}
			break;
		}
		case 'execute': {
			const threshold = (special.threshold ?? 0.12) + (traitMods.executeBonus ?? 0);
			if (enemy.hp > 0 && enemy.hp / enemy.maxHp <= threshold
				&& !enemy.catalog?.isBoss && !enemy.catalog?.isReaper && !enemy.catalog?.isMiniboss) {
				system.applyDamage(enemy, enemy.hp + 1, true, { ignoreResist: true });
				system.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 40, '처형!', true);
			}
			break;
		}
		default:
			break;
	}
}

export function playChainEffect(system: SwordOrbitSystem, from: EnemySprite, to: EnemySprite): void {
	if (!system.scene) {
		return;
	}

	const line = system.scene.add.line(0, 0, from.x, from.y, to.x, to.y, 0xc084fc, 0.9)
		.setOrigin(0)
		.setLineWidth(2)
		.setDepth(56);

	system.scene.tweens.add({
		targets: line,
		alpha: 0,
		duration: 140,
		onComplete: () => line.destroy(),
	});
}

// 검기 파동: a landed hit also strikes up to N other enemies near the target
export function applyCleave(
	system: SwordOrbitSystem,
	struckEnemy: EnemySprite,
	damage: number,
	isCrit: boolean,
	sword: OrbitSword | null = null,
): void {
	const totalCleave = system.cleaveTargets + (sword?.traitMods?.cleaveBonus ?? 0);
	if (totalCleave <= 0 || !system.enemyGroup) {
		return;
	}

	const radiusSquared = system.cleaveRadius * system.cleaveRadius;
	const candidates: Array<{ enemy: EnemySprite; distanceSquared: number }> = [];

	for (const enemy of system.getEnemyChildren(system.enemyGroup)) {
		if (!system.isValidEnemy(enemy) || enemy === struckEnemy) {
			continue;
		}

		const dx = enemy.x - struckEnemy.x;
		const dy = enemy.y - struckEnemy.y;
		const distanceSquared = dx * dx + dy * dy;

		if (distanceSquared <= radiusSquared) {
			candidates.push({ enemy, distanceSquared });
		}
	}

	candidates.sort((a, b) => a.distanceSquared - b.distanceSquared);

	const damageInfo = sword ? system.getDamageInfo(sword) : null;
	for (const { enemy } of candidates.slice(0, totalCleave)) {
		system.applyDamage(enemy, damage, isCrit, damageInfo);
		system.playCleaveEffect(struckEnemy, enemy);
	}
}

export function playCleaveEffect(system: SwordOrbitSystem, from: EnemySprite, to: EnemySprite): void {
	if (!system.scene) {
		return;
	}

	const line = system.scene.add.line(0, 0, from.x, from.y, to.x, to.y, 0xbae6fd, 0.75)
		.setOrigin(0)
		.setLineWidth(2)
		.setDepth(55);

	system.scene.tweens.add({
		targets: line,
		alpha: 0,
		duration: 160,
		onComplete: () => line.destroy(),
	});
}

export function registerSwordHit(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword || !system.isValidEnemy(enemy)) {
		return;
	}

	const now = system.scene?.time?.now ?? 0;
	if (now < (sword.hitCooldownUntil ?? 0)) {
		return;
	}

	// Calculate critical hit: combine sword + player crit chance
	const player = system.scene?.player;
	const swordCritChance = sword.definition?.critChance ?? 0;
	const playerCritChance = player?.critChance ?? 0;
	const totalCritChance = swordCritChance + playerCritChance;
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};

	let isCrit = false;
	let finalDamage = Math.round((sword.damage ?? 20) * (system.damageMultiplier ?? 1));

	// 거인 사냥꾼: bonus vs elites / minibosses / bosses
	if ((traitMods.bigGameDamage ?? 0) > 0
		&& (enemy.catalog?.isElite || enemy.catalog?.isMiniboss || enemy.catalog?.isBoss)) {
		finalDamage = Math.round(finalDamage * (1 + traitMods.bigGameDamage!));
	}

	// Roll for critical hit
	if (totalCritChance > 0) {
		const rollChance = Math.random();
		if (rollChance < totalCritChance) {
			isCrit = true;
			// Calculate critical damage multiplier
			let swordCritMult = sword.definition?.critDamageMultiplier ?? 1.0;
			let playerCritMult = player?.critDamageMultiplier ?? 1.0;

			// If crit chance exceeds 100%, overflow adds to damage multiplier
			const critOverflow = Math.max(0, totalCritChance - 1);
			const baseCritMult = (swordCritMult + playerCritMult) / 2 + (traitMods.critDamageAdd ?? 0);
			finalDamage = Math.round(finalDamage * (baseCritMult + critOverflow));
		}
	}

	const damageInfo = system.getDamageInfo(sword);
	system.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
	system.applyDamage(enemy, finalDamage, isCrit, damageInfo);
	system.applyRareExtras(sword, enemy);
	system.applyTraitProcs(sword, enemy);
	system.applySpecial(sword, enemy, finalDamage);
	system.applyCleave(enemy, finalDamage, isCrit, sword);
	sword.hitTargets ??= new Set();
	sword.hitTargets.add(enemy);
	sword.remainingHits = Math.max(0, (sword.remainingHits ?? 1) - 1);

	sword.hitCooldownUntil = now + (sword.hitCooldownMs ?? 110);

	if ((sword.remainingHits ?? 0) <= 0) {
		system.startReturningSword(sword);
		return;
	}

	const nextTarget = system.findNearestEnemy(
		sword.x,
		sword.y,
		system.enemyGroup,
		system.closeScanRadius,
		sword.hitTargets,
	);

	if (nextTarget) {
		system.setSwordTarget(sword, nextTarget);
		return;
	}

	// If no new target found, try to find any nearest enemy (even if already hit)
	const retargetEnemy = system.findNearestEnemy(
		sword.x,
		sword.y,
		system.enemyGroup,
		system.closeScanRadius,
		null, // don't exclude hitTargets
	);

	if (retargetEnemy) {
		system.setSwordTarget(sword, retargetEnemy);
		return;
	}

	sword.target = null;
	sword.scanTimer = 0;
	system.startReturningSword(sword);
}

export function registerOrbitHit(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword || !system.isValidEnemy(enemy)) {
		return;
	}

	const now = system.scene?.time?.now ?? 0;
	if (now < (sword.hitCooldownUntil ?? 0)) {
		return;
	}

	const player = system.scene?.player;
	const totalCritChance = (sword.definition?.critChance ?? 0) + (player?.critChance ?? 0);
	let finalDamage = Math.round((sword.damage ?? 20) * (system.damageMultiplier ?? 1) * system.orbitDamageMult);
	let isCrit = false;

	if (totalCritChance > 0 && Math.random() < totalCritChance) {
		isCrit = true;
		const baseCritMult = ((sword.definition?.critDamageMultiplier ?? 1) + (player?.critDamageMultiplier ?? 1)) / 2;
		finalDamage = Math.round(finalDamage * (baseCritMult + Math.max(0, totalCritChance - 1)));
	}

	const damageInfo = system.getDamageInfo(sword);
	system.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
	system.applyDamage(enemy, finalDamage, isCrit, damageInfo);
	system.applyRareExtras(sword, enemy);
	system.applyTraitProcs(sword, enemy);
	system.applySpecial(sword, enemy, finalDamage);
	system.applyCleave(enemy, finalDamage, isCrit, sword);
	sword.hitCooldownUntil = now + Math.max(180, sword.hitCooldownMs ?? 180);
}

export function handleSwordEnemyOverlap(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword) {
		return;
	}

	// Orbit contact damage (Berserker trait)
	if (system.noLaunch && sword.state === 'orbiting') {
		system.registerOrbitHit(sword, enemy);
		return;
	}

	if (sword.state !== 'launched') {
		return;
	}

	system.registerSwordHit(sword, enemy);
}

export function applyDamage(
	system: SwordOrbitSystem,
	enemy: EnemySprite,
	amount: number,
	isCrit = false,
	damageInfo: DamageInfo | null = null,
): void {
	if (!system.isValidEnemy(enemy)) {
		return;
	}

	// Store crit flag on enemy for damage text visualization
	enemy.lastDamageWasCrit = isCrit;

	const enemyManager = system.scene?.enemyManager;
	if (enemyManager && typeof enemyManager.takeDamage === 'function') {
		enemyManager.takeDamage(enemy, amount, system.scene?.player, damageInfo ?? {});
		return;
	}

	// 폴백 덕 타이핑 (EnemyManager 부재 시) — 원본 체인 그대로
	const fallback = enemy as unknown as DamageableEnemy;

	if (typeof fallback.takeDamage === 'function') {
		fallback.takeDamage(amount);
		return;
	}

	if (typeof fallback.damage === 'function') {
		fallback.damage(amount);
		return;
	}

	if (typeof fallback.health === 'number') {
		fallback.health -= amount;
		if (fallback.health <= 0) {
			fallback.destroy?.();
		}
		return;
	}

	if (typeof fallback.hp === 'number') {
		fallback.hp -= amount;
		if (fallback.hp <= 0) {
			fallback.destroy?.();
		}
	}
}
