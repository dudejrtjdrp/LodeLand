// 궤도/발사/귀환 이동 상태 머신 + 타겟 스캔.
// 원본 SwordOrbitSystem.js 의 update/updateSword*/start*/finish*/getOrbitPosition
// 구간을 기계적으로 옮긴 것 — 수식·타이밍·이벤트 순서를 바꾸지 않는다.

import Phaser from 'phaser';
import type { EnemySprite, PlayerSprite } from '../../types/actors';
import type { EnemyGroupLike, OrbitPosition, OrbitSword } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

export function updateSystem(
	system: SwordOrbitSystem,
	player: PlayerSprite | null,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
): void {
	if (!player) {
		return;
	}

	if (enemiesGroup) {
		system.setEnemyGroup(enemiesGroup);
	}

	system.ensureMinimumSwords();

	const deltaSeconds = delta / 1000;
	system.baseAngle = Phaser.Math.Wrap(system.baseAngle + system.orbitSpeed * deltaSeconds, 0, Phaser.Math.PI2);

	const claimedTargets = new Set<EnemySprite>();
	for (const sword of system.swords) {
		if (sword.state === 'launched' && system.isValidEnemy(sword.target)) {
			claimedTargets.add(sword.target);
		}
	}

	for (const sword of system.swords) {
		system.updateSword(player, sword, delta, system.enemyGroup, claimedTargets);
	}

	system.updateSwordPositions(player);

	// Synergy auras follow their swords everywhere
	for (const sword of system.swords) {
		if (sword.aura) {
			sword.aura.setPosition(sword.x, sword.y);
		}
	}

	system.updateUltimates(player, delta);
}

export function updateSwordPositions(system: SwordOrbitSystem, player: PlayerSprite | null): void {
	if (!player || system.swords.length === 0) {
		return;
	}

	const count = system.swords.length;
	const step = Phaser.Math.PI2 / count;

	for (const sword of system.swords) {
		if (sword.state !== 'orbiting') {
			continue;
		}

		const angle = Phaser.Math.Wrap(system.baseAngle * (sword.orbitSpeedMultiplier ?? 1) + step * sword.slot, 0, Phaser.Math.PI2);
		const x = player.x + Math.cos(angle) * system.radius;
		const y = player.y + Math.sin(angle) * system.radius;

		sword.angle = angle;
		sword.setPosition(x, y);
		sword.rotation = angle + system.rotationOffset;
		sword.setVelocity(0, 0);
	}
}

export function updateSword(
	system: SwordOrbitSystem,
	player: PlayerSprite,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
	claimedTargets: Set<EnemySprite>,
): void {
	switch (sword.state) {
		case 'orbiting':
			system.updateOrbitingSword(player, sword, delta, enemiesGroup, claimedTargets);
			break;
		case 'launched':
			system.updateLaunchedSword(player, sword, delta, enemiesGroup);
			break;
		case 'returning':
			system.updateReturningSword(player, sword, delta, enemiesGroup, claimedTargets);
			break;
		default:
			sword.state = 'orbiting';
			sword.scanTimer = 0;
			break;
	}
}

export function updateOrbitingSword(
	system: SwordOrbitSystem,
	player: PlayerSprite,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
	claimedTargets: Set<EnemySprite>,
): void {
	// Berserker trait: swords never leave orbit (contact damage instead)
	if (system.noLaunch) {
		return;
	}

	const closeTarget = system.findNearestEnemy(sword.x, sword.y, enemiesGroup, system.closeScanRadius, claimedTargets);
	if (closeTarget) {
		sword.scanTimer = 0;
		system.startLaunchedSword(sword, closeTarget, claimedTargets);
		return;
	}

	sword.scanTimer = (sword.scanTimer ?? 0) + delta;

	if (sword.scanTimer < (sword.scanInterval ?? system.scanRadius)) {
		return;
	}

	sword.scanTimer = 0;

	const target = system.findNearestEnemy(sword.x, sword.y, enemiesGroup, system.scanRadius, claimedTargets);

	if (target) {
		system.startLaunchedSword(sword, target, claimedTargets);
	}
}

export function updateLaunchedSword(
	system: SwordOrbitSystem,
	player: PlayerSprite,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
): void {
	if (!system.isValidEnemy(sword.target)) {
		if ((sword.remainingHits ?? 0) > 0) {
			const nextTarget = system.findNearestEnemy(
				sword.x,
				sword.y,
				enemiesGroup,
				system.closeScanRadius,
				sword.hitTargets,
			);

			if (nextTarget) {
				system.setSwordTarget(sword, nextTarget);
				return;
			}
		}

		system.startReturningSword(sword);
		return;
	}

	sword.launchElapsed = (sword.launchElapsed ?? 0) + delta;
	if (sword.launchElapsed >= system.launchDuration) {
		system.startReturningSword(sword);
		return;
	}

	const target = sword.target;
	const hitDistance = 22;
	if (system.isValidEnemy(target) && Phaser.Math.Distance.Between(sword.x, sword.y, target.x, target.y) <= hitDistance) {
		system.registerSwordHit(sword, target);
		return;
	}

	const velocityX = Math.cos(sword.launchAngle!) * (sword.launchSpeed ?? 400);
	const velocityY = Math.sin(sword.launchAngle!) * (sword.launchSpeed ?? 400);

	sword.setVelocity(velocityX, velocityY);
	sword.rotation = sword.launchAngle! + system.rotationOffset;

	if (enemiesGroup) {
		system.setEnemyGroup(enemiesGroup);
	}
}

export function updateReturningSword(
	system: SwordOrbitSystem,
	player: PlayerSprite,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
	claimedTargets: Set<EnemySprite>,
): void {
	if ((sword.remainingHits ?? 0) > 0) {
		const closeTarget = system.findNearestEnemy(sword.x, sword.y, enemiesGroup, system.closeScanRadius, claimedTargets);
		if (closeTarget) {
			system.startLaunchedSword(sword, closeTarget, claimedTargets);
			return;
		}
	}

	const orbitPosition = system.getOrbitPosition(player, sword);
	const returnFactor = Phaser.Math.Clamp((delta / 16.6667) * system.returnLerp, 0, 1);
	const nextX = Phaser.Math.Linear(sword.x, orbitPosition.x, returnFactor);
	const nextY = Phaser.Math.Linear(sword.y, orbitPosition.y, returnFactor);
	const dx = orbitPosition.x - nextX;
	const dy = orbitPosition.y - nextY;
	const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

	// Finish return when close enough, or when progress stalls (distance change negligible).
	const CLOSE_THRESHOLD = 6; // pixels, allows visual return to complete but avoids tiny threshold hang
	const STALL_DELTA = 0.2; // pixels change considered stalled

	const prevDist = sword._lastReturnDistance;
	if (distanceToTarget < CLOSE_THRESHOLD || (typeof prevDist === 'number' && Math.abs(prevDist - distanceToTarget) < STALL_DELTA)) {
		system.finishReturningSword(player, sword);
		delete sword._lastReturnDistance;
		return;
	}

	// store last observed distance for stall detection
	sword._lastReturnDistance = distanceToTarget;

	sword.setPosition(nextX, nextY);
	sword.setVelocity(0, 0);

	const startRotation = sword.returnStartRotation ?? sword.rotation;
	const targetRotation = orbitPosition.angle + system.rotationOffset;
	const turnProgress = Math.min(1, (sword.returnTurnProgress ?? 0) + returnFactor * 0.8);
	sword.returnTurnProgress = turnProgress;
	sword.rotation = Phaser.Math.Linear(startRotation, targetRotation, turnProgress);
}

export function startLaunchedSword(
	system: SwordOrbitSystem,
	sword: OrbitSword | null,
	target: EnemySprite | null,
	claimedTargets: Set<EnemySprite> | null = null,
): void {
	if (!sword || !system.isValidEnemy(target)) {
		return;
	}

	sword.state = 'launched';
	sword.target = target;
	sword.returnTurnProgress = 0;
	sword.returnStartRotation = sword.rotation;
	sword.launchElapsed = 0;
	const launchAngle = Math.atan2(target.y - sword.y, target.x - sword.x);
	sword.launchAngle = launchAngle;
	sword.rotation = launchAngle + system.rotationOffset;

	if (claimedTargets) {
		claimedTargets.add(target);
	}
}

export function findNearestEnemy(
	system: SwordOrbitSystem,
	sourceX: number,
	sourceY: number,
	enemiesGroup: EnemyGroupLike | null,
	radius: number = system.scanRadius,
	excludeTargets: Set<EnemySprite> | null = null,
): EnemySprite | null {
	if (!enemiesGroup) {
		return null;
	}

	const enemies = system.getEnemyChildren(enemiesGroup);
	const maxDistanceSquared = radius * radius;
	let nearestEnemy: EnemySprite | null = null;
	let nearestDistanceSquared = maxDistanceSquared;

	for (const enemy of enemies) {
		if (!system.isValidEnemy(enemy)) {
			continue;
		}

		if (excludeTargets?.has(enemy)) {
			continue;
		}

		const dx = enemy.x - sourceX;
		const dy = enemy.y - sourceY;
		const distanceSquared = dx * dx + dy * dy;

		if (distanceSquared <= nearestDistanceSquared) {
			nearestDistanceSquared = distanceSquared;
			nearestEnemy = enemy;
		}
	}

	return nearestEnemy;
}

export function startReturningSword(system: SwordOrbitSystem, sword: OrbitSword | null): void {
	if (!sword) {
		return;
	}

	sword.state = 'returning';
	sword.target = null;
	sword.returnCurveSide = sword.slot % 2 === 0 ? 1 : -1;
	sword.returnTurnProgress = 0;
	sword.returnStartRotation = sword.rotation;
	sword.returnStartX = sword.x;
	sword.returnStartY = sword.y;
	sword.launchElapsed = 0;
	sword.launchAngle = undefined;
	sword.hitTargets = new Set();
	sword.setVelocity(0, 0);
	// clear any previous return distance tracking
	delete sword._lastReturnDistance;
}

export function finishReturningSword(system: SwordOrbitSystem, player: PlayerSprite | null, sword: OrbitSword | null): void {
	if (!player || !sword) {
		return;
	}

	const orbitPosition = system.getOrbitPosition(player, sword);

	sword.state = 'orbiting';
	sword.target = null;
	sword.scanTimer = 0;
	sword.remainingHits = sword.hitsPerLaunch ?? 1;
	sword.hitCooldownUntil = 0;
	sword.hitTargets = new Set();
	sword.returnCurveSide = 0;
	sword.returnTurnProgress = 0;
	sword.returnStartRotation = undefined;
	sword.returnStartX = undefined;
	sword.returnStartY = undefined;
	sword.setVelocity(0, 0);
	sword.setPosition(orbitPosition.x, orbitPosition.y);
	sword.rotation = orbitPosition.angle + system.rotationOffset;
	// clear return distance tracking
	delete sword._lastReturnDistance;

	// Prepare scanTimer so the normal update loop can scan immediately while
	// preserving the visual return animation (no snapping).
	sword.scanTimer = sword.scanInterval ?? system.scanRadius ?? 0;
	// Ensure position updated for visuals
	system.updateSwordPositions(player);
}

export function setSwordTarget(system: SwordOrbitSystem, sword: OrbitSword | null, target: EnemySprite | null): void {
	if (!sword || !system.isValidEnemy(target)) {
		return;
	}

	sword.target = target;
	sword.launchElapsed = 0;
	sword.launchAngle = Math.atan2(target.y - sword.y, target.x - sword.x);
	sword.rotation = sword.launchAngle + system.rotationOffset;
	sword.hitCooldownUntil = 0;
}

export function snapSwordToOrbit(system: SwordOrbitSystem, player: PlayerSprite, sword: OrbitSword): void {
	const orbitPosition = system.getOrbitPosition(player, sword);
	sword.angle = orbitPosition.angle;
	sword.setPosition(orbitPosition.x, orbitPosition.y);
	sword.rotation = orbitPosition.angle + system.rotationOffset;
	sword.remainingHits = sword.hitsPerLaunch ?? 1;
	sword.hitCooldownUntil = 0;
	sword.hitTargets = new Set();
	sword.scanTimer = 0;
}

export function getOrbitPosition(system: SwordOrbitSystem, player: PlayerSprite, sword: OrbitSword): OrbitPosition {
	const count = system.swords.length;
	if (!count) {
		return { x: player.x, y: player.y, angle: 0 };
	}

	const angle = Phaser.Math.Wrap(system.baseAngle + (Phaser.Math.PI2 / count) * sword.slot, 0, Phaser.Math.PI2);
	return {
		x: player.x + Math.cos(angle) * system.radius,
		y: player.y + Math.sin(angle) * system.radius,
		angle,
	};
}
