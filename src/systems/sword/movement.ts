// 궤도/발사/귀환 이동 상태 머신 + 타겟 스캔.
// 원본 SwordOrbitSystem.js 의 update/updateSword*/start*/finish*/getOrbitPosition
// 구간을 기계적으로 옮긴 것 — 수식·타이밍·이벤트 순서를 바꾸지 않는다.

import Phaser from 'phaser';
import type { EnemySprite, PlayerSprite } from '../../types/actors';
import type { EnemyGroupLike, OrbitPosition, OrbitSword, RingLayout } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';
import { updateStateRings } from './hud';
import { type SwordBehavior, behaviorOf, behaviorSpec, boomerangPoint, stakeTickMs } from '../../logic/swordBehavior';
import { reduceMotion } from '../../core/settings';

/** findNearestEnemy 전용 질의 버퍼 (중첩 호출 없음 — 결과를 즉시 소비한다). */
const SCAN_BUFFER: EnemySprite[] = [];

// ---------------------------------------------------------------------------
// 거동 아키타입 전용 버퍼 — 프레임마다 도는 경로라 여기서 배열/객체를 만들지 않는다.
// ---------------------------------------------------------------------------
/** 선회검 극좌표 결과 [dx, dy, angle] */
const ARC_POINT: number[] = [0, 0, 0];
/** 관통(선회·참격) 경로 위 적 질의 */
const PIERCE_QUERY: EnemySprite[] = [];

/** 이 검의 거동 (캐시가 비어 있으면 정의에서 재조회 — 세이브 마이그레이션 불필요). */
export function behaviorFor(sword: OrbitSword): SwordBehavior {
	return sword.behavior ?? behaviorOf(sword.definition);
}

/** updateSystem이 프레임마다 재사용하는 "이미 다른 검이 노리는 적" 집합. */
const CLAIMED_TARGETS = new Set<EnemySprite>();

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
	// 피 6세트 [피의 갈증]: 처치 직후 잠깐 궤도가 빨라진다 (중첩 3)
	const thirstSpin = 1 + (system.scene?.elementSets?.thirstStacks ?? 0) * 0.12;
	system.baseAngle = Phaser.Math.Wrap(system.baseAngle + system.orbitSpeed * thirstSpin * deltaSeconds, 0, Phaser.Math.PI2);

	// 매 프레임 new Set()을 만들지 않고 재사용한다 (초당 60개 Set → 0).
	const claimedTargets = CLAIMED_TARGETS;
	claimedTargets.clear();
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

	// 홰 스트립 상태 링 (상태가 바뀐 프레임에만 다시 그림)
	updateStateRings(system);

	system.updateUltimates(player, delta);
}

/**
 * 이중 궤도: 슬롯 0~(innerRingSlots-1)은 내부 원, 그 이후 슬롯은 외부 원(역회전).
 * 각 링은 자기 링 소속 검끼리 균등 분배된다.
 */
export function getRingLayout(system: SwordOrbitSystem, sword: OrbitSword): RingLayout {
	// 링 소속/순번/크기는 reindexSlots에서 미리 계산된다. 캐시가 비어 있으면(과거 세이브,
	// 직접 slot을 만진 경우) 여기서 한 번 복구한다.
	if (sword._ringCount === undefined || sword._ringInner === undefined) {
		system.recomputeRingLayout();
	}
	const inner = sword._ringInner ?? sword.slot < system.innerRingSlots;

	return {
		radius: system.radius * (inner ? system.innerRingRadiusMult : system.outerRingRadiusMult),
		direction: inner ? 1 : system.outerRingDirection,
		step: Phaser.Math.PI2 / Math.max(1, sword._ringCount ?? 1),
		index: sword._ringIndex ?? 0,
	};
}

export function updateSwordPositions(system: SwordOrbitSystem, player: PlayerSprite | null): void {
	if (!player || system.swords.length === 0) {
		return;
	}

	for (const sword of system.swords) {
		if (sword.state !== 'orbiting') {
			continue;
		}

		const ring = getRingLayout(system, sword);
		const angle = Phaser.Math.Wrap(
			system.baseAngle * (sword.orbitSpeedMultiplier ?? 1) * ring.direction + ring.step * ring.index,
			0,
			Phaser.Math.PI2,
		);
		const x = player.x + Math.cos(angle) * ring.radius;
		const y = player.y + Math.sin(angle) * ring.radius;

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
		case 'planted':
			// 말뚝검: 꽂혀 있는 동안은 궤도로 돌아가지 않는다 (그 자리는 비어 있다)
			updatePlantedSword(system, sword, delta);
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

	// 피의 갈증 중첩만큼 재출격이 빨라진다 (쿨다운은 loadout 시점에 굳어 있으므로
	// 타이머 누산 쪽에서 가속한다).
	sword.scanTimer = (sword.scanTimer ?? 0)
		+ delta / (system.scene?.elementSets?.dynamicCooldownMult?.() ?? 1);

	if (sword.scanTimer < (sword.scanInterval ?? system.scanRadius)) {
		return;
	}

	sword.scanTimer = 0;

	// 참격검은 더 멀리 있는 사냥감을 노린다 (원거리 저격 아키타입)
	const scanRadius = system.scanRadius * behaviorSpec(behaviorFor(sword)).scanRadiusMult;
	const target = system.findNearestEnemy(sword.x, sword.y, enemiesGroup, scanRadius, claimedTargets);

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
	// 거동 아키타입: STRIKE 자체가 다른 검들은 여기서 갈라진다.
	// (기본 'orbit' 은 아래 원본 경로를 그대로 탄다 — 회귀 0)
	const behavior = behaviorFor(sword);
	if (behavior === 'boomerang') {
		updateBoomerangSword(system, player, sword, delta, enemiesGroup);
		return;
	}
	if (behavior === 'lance') {
		updateLanceSword(system, sword, delta, enemiesGroup);
		return;
	}

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

	// 비행 잔상 — 출격 속도가 빠를수록 잔상 간격이 짧아져 속도가 눈에 보인다
	const now = system.scene?.time?.now ?? 0;
	const speedScale = (sword.launchSpeed ?? 400) / 400;
	const trailInterval = Math.max(22, 55 / Math.max(0.25, speedScale));
	if (now - (sword._lastTrailAt ?? 0) >= trailInterval) {
		sword._lastTrailAt = now;
		system.scene?.visualEffects?.swordTrailFX?.(sword);
	}

	if (enemiesGroup) {
		system.setEnemyGroup(enemiesGroup);
	}
}

// ---------------------------------------------------------------------------
// 선회검 — 목표를 지나쳐 넓은 호를 그리며 키퍼에게 되돌아온다 (경로 전체 관통)
// ---------------------------------------------------------------------------

export function updateBoomerangSword(
	system: SwordOrbitSystem,
	player: PlayerSprite,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
): void {
	const spec = behaviorSpec('boomerang');
	const arcMs = spec.arcMs ?? 900;

	sword.launchElapsed = (sword.launchElapsed ?? 0) + delta;
	const t = Math.min(1, sword.launchElapsed / arcMs);
	sword._arcT = t;

	// 호는 **키퍼 기준** 극좌표라 키퍼가 움직여도 반드시 손으로 돌아온다.
	boomerangPoint(
		t, sword._arcAngle ?? 0, sword._arcSide ?? 1,
		spec.sweepRad ?? 3.5, sword._arcReach ?? 220, ARC_POINT,
	);
	const nextX = player.x + ARC_POINT[0];
	const nextY = player.y + ARC_POINT[1];
	const dx = nextX - sword.x;
	const dy = nextY - sword.y;

	sword.setPosition(nextX, nextY);
	sword.setVelocity(0, 0);
	if (dx * dx + dy * dy > 1) {
		sword.rotation = Math.atan2(dy, dx) + system.rotationOffset;
	}

	sweepPierceTargets(system, sword, enemiesGroup, 30);
	emitFlightTrail(system, sword, 34);

	if (t >= 1) {
		// 호가 끝나면 이미 키퍼 위 — 짧은 귀환 보간만 남는다
		system.startReturningSword(sword);
	}
}

// ---------------------------------------------------------------------------
// 참격검 — 목표 방향으로 길게 직선 관통 (폭 좁고 사거리 김)
// ---------------------------------------------------------------------------

export function updateLanceSword(
	system: SwordOrbitSystem,
	sword: OrbitSword,
	delta: number,
	enemiesGroup: EnemyGroupLike | null,
): void {
	const spec = behaviorSpec('lance');
	const angle = sword.launchAngle ?? 0;
	const step = (sword.launchSpeed ?? 400) * (spec.speedMult ?? 1.45) * (delta / 1000);

	sword.setPosition(sword.x + Math.cos(angle) * step, sword.y + Math.sin(angle) * step);
	sword.setVelocity(0, 0);
	sword.rotation = angle + system.rotationOffset;
	sword._lanceTravel = (sword._lanceTravel ?? 0) + step;
	sword.launchElapsed = (sword.launchElapsed ?? 0) + delta;

	sweepPierceTargets(system, sword, enemiesGroup, spec.lanePx ?? 26);
	emitFlightTrail(system, sword, 26);

	if ((sword._lanceTravel ?? 0) >= (spec.rangePx ?? 470)) {
		system.startReturningSword(sword);
	}
}

/**
 * 관통 거동(선회·참격) 공통: 지금 위치 반경 안의 **아직 안 벤** 적을 전부 벤다.
 * 적마다 한 출격에 한 번만 맞는다 (hitTargets 로 중복 차단).
 */
function sweepPierceTargets(
	system: SwordOrbitSystem,
	sword: OrbitSword,
	enemiesGroup: EnemyGroupLike | null,
	radius: number,
): void {
	const manager = system.scene?.enemyManager;
	const candidates = manager?.queryRadius
		? manager.queryRadius(sword.x, sword.y, radius, PIERCE_QUERY)
		: system.getEnemyChildren(enemiesGroup ?? system.enemyGroup);
	const radiusSquared = radius * radius;

	for (const enemy of candidates) {
		if (!system.isValidEnemy(enemy) || sword.hitTargets?.has(enemy)) {
			continue;
		}
		const dx = enemy.x - sword.x;
		const dy = enemy.y - sword.y;
		if (dx * dx + dy * dy > radiusSquared) {
			continue;
		}
		system.registerPierceHit(sword, enemy);
	}
}

/** 비행 잔상 (출격 속도에 비례한 간격 — 원본 updateLaunchedSword 와 같은 규칙) */
function emitFlightTrail(system: SwordOrbitSystem, sword: OrbitSword, intervalMs: number): void {
	const now = system.scene?.time?.now ?? 0;
	if (now - (sword._lastTrailAt ?? 0) >= intervalMs) {
		sword._lastTrailAt = now;
		system.scene?.visualEffects?.swordTrailFX?.(sword);
	}
}

// ---------------------------------------------------------------------------
// 말뚝검 — 목표 자리에 꽂혀 지속 피해 오라가 된다 (그동안 궤도 자리는 공백)
// ---------------------------------------------------------------------------

export function startPlantedSword(system: SwordOrbitSystem, sword: OrbitSword | null): void {
	if (!sword) {
		return;
	}
	const spec = behaviorSpec('stake');
	const now = system.scene?.time?.now ?? 0;

	sword.state = 'planted';
	sword.target = null;
	sword.launchAngle = undefined;
	sword.launchElapsed = 0;
	sword.setVelocity(0, 0);
	// 꽂힌 검은 날 끝이 아래를 향한다 (궤도 회전 오프셋을 쓰지 않는다)
	sword.rotation = Math.PI / 2 + system.rotationOffset;
	sword._stakeUntil = now + (spec.plantMs ?? 3000);
	sword._stakeTickAt = now + stakeTickMs(sword.scanInterval ?? 1500);
	sword._stakeFxAt = 0;
	sword._stakeBaseRotation = sword.rotation;
	sword.hitTargets = new Set();

	// 꽂히는 연출 — 공유 FX 레이어만 쓴다 (add.circle + 트윈 금지)
	// 2026-09-04: "꽂혀서 그냥 멈춰 있는 것 같다" → 착지 충격(링 2겹 + 파편 + 십자 섬광)을 확실하게
	const radius = spec.auraRadius ?? 96;
	const tint = sword.effect?.tint ? parseInt(sword.effect.tint.replace('#', ''), 16) : 0xe8c07a;
	const fx = system.scene?.visualEffects;
	fx?.fxRing(sword.x, sword.y, { r0: 8, r1: radius, w: 4, color: tint, alpha: 0.95, dur: 320 });
	fx?.fxRing(sword.x, sword.y, { r0: 4, r1: radius * 0.6, w: 8, color: 0xffffff, alpha: 0.5, dur: 220 });
	fx?.fxBurst(sword.x, sword.y, { count: 8, reach: radius * 0.7, color: tint, w: 2.5, alpha: 0.9, dur: 300 });
	fx?.fxCross(sword.x, sword.y, { r: 22, color: 0xffffff, w: 3, alpha: 0.9, dur: 180, scale1: 0.3 });
	system.scene?.soundSystem?.play('hit', { volume: 0.6 });
	if (!reduceMotion()) {
		fx?.hitStop?.(30);
	}
}

/**
 * 말뚝 상시 연출 — 꽂혀 있는 동안 90ms 마다: 반투명 오라 원반(겹쳐서 상시 보이게) + 회전하는 호 2개,
 * 검 자체는 잔진동. 전부 공유 FX 레이어(객체 생성 없음).
 */
function updatePlantedFx(system: SwordOrbitSystem, sword: OrbitSword, now: number, radius: number): void {
	const fx = system.scene?.visualEffects;
	if (!fx) {
		return;
	}
	// 검 진동: 좌우 미세 흔들림 + 남은 시간이 짧을수록 빨라진다 (곧 돌아온다는 신호)
	const left = Math.max(0, (sword._stakeUntil ?? now) - now);
	const freq = left < 700 ? 0.05 : 0.018;
	sword.rotation = (sword._stakeBaseRotation ?? sword.rotation) + Math.sin(now * freq) * 0.08;

	if (now < (sword._stakeFxAt ?? 0)) {
		return;
	}
	sword._stakeFxAt = now + 90;
	if (reduceMotion()) {
		return;
	}
	const tint = sword.effect?.tint ? parseInt(sword.effect.tint.replace('#', ''), 16) : 0xe8c07a;
	// 오라 원반 — 200ms 짜리를 90ms 마다 겹쳐 항상 보이는 지대로
	fx.fxDot(sword.x, sword.y, { r: radius, color: tint, alpha: 0.10, dur: 200, scale1: 1.0, ease: 'lin' });
	// 경계 회전 호 2개 (서로 반대 위치)
	const a0 = (now / 700) % (Math.PI * 2);
	fx.fxArc(sword.x, sword.y, { r: radius - 2, a0, a1: a0 + Math.PI * 0.55, color: tint, w: 3, alpha: 0.85, dur: 140, ease: 'lin' });
	fx.fxArc(sword.x, sword.y, { r: radius - 2, a0: a0 + Math.PI, a1: a0 + Math.PI * 1.55, color: 0xffffff, w: 2, alpha: 0.5, dur: 140, ease: 'lin' });
	// 발밑 문양: 마름모가 숨 쉬듯
	fx.fxDiamond(sword.x, sword.y + 10, { r: 14 + 3 * Math.sin(now / 160), color: tint, alpha: 0.6, dur: 140 });
}

export function updatePlantedSword(system: SwordOrbitSystem, sword: OrbitSword, _delta: number): void {
	const spec = behaviorSpec('stake');
	const now = system.scene?.time?.now ?? 0;

	sword.setVelocity(0, 0);
	updatePlantedFx(system, sword, now, spec.auraRadius ?? 96);

	if (now >= (sword._stakeTickAt ?? 0)) {
		// 틱 간격은 그 검의 재출격 대기시간에 비례한다 — 쿨다운 투자가 말뚝에도 돌아온다
		sword._stakeTickAt = now + stakeTickMs(sword.scanInterval ?? 1500);
		system.applyStakeAura(sword);
	}

	if (now >= (sword._stakeUntil ?? 0)) {
		system.startReturningSword(sword);
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

	// 회귀 칼날 (증강): 귀환 중에도 접촉한 적에게 피해의 일부를 입힌다
	if (system.returnDamagePct > 0) {
		const now = system.scene?.time?.now ?? 0;
		if (now >= (sword.hitCooldownUntil ?? 0)) {
			const victim = system.findNearestEnemy(sword.x, sword.y, enemiesGroup, 26);
			if (victim) {
				const damage = Math.max(1, Math.round(
					(sword.damage ?? 20) * (system.damageMultiplier ?? 1) * system.returnDamagePct,
				));
				system.applyDamage(victim, damage, false, system.getDamageInfo(sword));
				system.recordDamage(sword, damage);
				sword.hitCooldownUntil = now + Math.max(220, sword.hitCooldownMs ?? 220);
			}
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

	// 귀환 잔상 (출격보다 성긴 간격)
	const nowMs = system.scene?.time?.now ?? 0;
	if (nowMs - (sword._lastTrailAt ?? 0) >= 80) {
		sword._lastTrailAt = nowMs;
		system.scene?.visualEffects?.swordTrailFX?.(sword, 0.3);
	}

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

	// 거동 아키타입별 출격 준비 (기본 'orbit' 은 아무것도 하지 않는다)
	setupBehaviorLaunch(system, sword, target);

	// 출격 연출: 깃털 잔상
	system.scene?.visualEffects?.swordLaunchFX?.(sword);

	if (claimedTargets) {
		claimedTargets.add(target);
	}

	// 동반 출격 (증강): 확률적으로 궤도의 다른 검 1자루가 함께 출격 (연쇄 발동 방지 락)
	if (system.twinLaunchChance > 0 && !system.twinLaunchLock && Math.random() < system.twinLaunchChance) {
		const wingman = system.swords.find((entry) => entry !== sword && entry.state === 'orbiting');
		if (wingman) {
			const twinTarget = system.findNearestEnemy(wingman.x, wingman.y, system.enemyGroup, system.scanRadius, claimedTargets)
				?? target;
			system.twinLaunchLock = true;
			system.startLaunchedSword(wingman, twinTarget, claimedTargets);
			system.twinLaunchLock = false;
		}
	}
}

/**
 * 출격 직전에 아키타입별 상태를 잡아 둔다.
 * 선회검은 호의 시작 각도/반경/도는 쪽을, 참격검은 관통 거리를 초기화한다.
 * (여기서 만드는 것은 숫자뿐 — 객체·배열 할당 없음)
 */
function setupBehaviorLaunch(system: SwordOrbitSystem, sword: OrbitSword, target: EnemySprite): void {
	const behavior = behaviorFor(sword);
	if (behavior === 'orbit' || behavior === 'stake') {
		// 말뚝검은 목표까지는 평범하게 날아간다 — 꽂히는 것은 명중 순간이다
		sword.hitTargets = new Set();
		return;
	}

	sword.hitTargets = new Set();

	if (behavior === 'lance') {
		sword._lanceTravel = 0;
		return;
	}

	// 선회검: 키퍼 기준 극좌표로 호를 그린다
	const spec = behaviorSpec('boomerang');
	const player = system.scene?.player;
	const originX = player?.x ?? sword.x;
	const originY = player?.y ?? sword.y;
	const distance = Math.sqrt((target.x - originX) ** 2 + (target.y - originY) ** 2);
	sword._arcAngle = Math.atan2(target.y - originY, target.x - originX);
	sword._arcSide = sword.slot % 2 === 0 ? 1 : -1;
	sword._arcReach = Phaser.Math.Clamp(
		distance + (spec.overshootPx ?? 74),
		spec.minReachPx ?? 150,
		spec.maxReachPx ?? 330,
	);
	sword._arcT = 0;
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

	// 공간 그리드가 있으면 반경이 덮는 셀만 훑는다. 이 함수는 프레임당 검 1자루당 여러 번
	// 호출되므로(궤도 스캔·출격·귀환·타격 후 재타겟) 전수 순회일 때 가장 비싼 경로였다.
	const enemies = system.scene?.enemyManager?.queryRadius
		? system.scene.enemyManager.queryRadius(sourceX, sourceY, radius, SCAN_BUFFER)
		: system.getEnemyChildren(enemiesGroup);
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
	// 거동 아키타입 상태 초기화 (다음 출격이 깨끗한 값에서 시작하도록)
	sword._arcT = 0;
	sword._lanceTravel = 0;
	sword._stakeUntil = 0;
	sword._stakeTickAt = 0;
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
	// 활공 사냥 보너스는 그 출격에서 끝난다 (홰로 돌아오면 소멸)
	sword._diveBonusUntil = 0;
	sword.setVelocity(0, 0);
	sword.setPosition(orbitPosition.x, orbitPosition.y);
	sword.rotation = orbitPosition.angle + system.rotationOffset;
	// clear return distance tracking
	delete sword._lastReturnDistance;

	// 귀소 완료 연출: 홰 글린트
	system.scene?.visualEffects?.swordPerchFX?.(sword);

	// 잔향 발사 (증강): 귀환을 마치는 즉시 확률적으로 다시 출격
	if (system.echoLaunchChance > 0 && !system.noLaunch && Math.random() < system.echoLaunchChance) {
		const echoTarget = system.findNearestEnemy(sword.x, sword.y, system.enemyGroup, system.scanRadius);
		if (echoTarget) {
			system.startLaunchedSword(sword, echoTarget);
			return;
		}
	}

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

	const ring = getRingLayout(system, sword);
	const angle = Phaser.Math.Wrap(system.baseAngle * ring.direction + ring.step * ring.index, 0, Phaser.Math.PI2);
	return {
		x: player.x + Math.cos(angle) * ring.radius,
		y: player.y + Math.sin(angle) * ring.radius,
		angle,
	};
}
