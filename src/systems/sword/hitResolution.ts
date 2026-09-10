// 타격 판정 & 피해 적용: 크리티컬 계산, 초희귀 검 추가 피해(applyRareExtras),
// 특성 발동, 검 고유 스페셜(burn/poison/midas/chain/execute), 검기 파동(cleave).
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것 — 수식 변경 금지.

import { maxHpBonusDamage } from '../../logic/combat';
import { healWithinBudget } from '../../logic/lifesteal';
import { hpScaleOf } from '../../logic/growth';
import { softCapCritMultiplier } from '../../logic/statCaps';
import { behaviorSpec } from '../../logic/swordBehavior';
import type { EnemySprite } from '../../types/actors';
import type { DamageableEnemy, DamageInfo, OrbitSword, OrbitSwordDefinition, SlotModifiers } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';
import * as movement from './movement';
import { behaviorFor } from './movement';

// ---------------------------------------------------------------------------
// 반경 질의 버퍼 (호출부별 전용 — 피해 처리 중 중첩 호출돼도 서로 덮어쓰지 않는다).
// 명중마다 도는 경로라 여기서 배열을 새로 만들면 초당 수백 개의 단명 객체가 된다.
// ---------------------------------------------------------------------------
const CHAIN_QUERY: EnemySprite[] = [];
const CHAIN_PICKED: EnemySprite[] = [];
const CHAIN_PICKED_DIST: number[] = [];
const BLAST_QUERY: EnemySprite[] = [];
const BLAST_HITS: EnemySprite[] = [];
const CLEAVE_QUERY: EnemySprite[] = [];
const STAKE_QUERY: EnemySprite[] = [];
const CLEAVE_PICKED: EnemySprite[] = [];
const CLEAVE_PICKED_DIST: number[] = [];

/**
 * 반경 안에 있을 법한 적 후보를 `out`에 담아 반환한다.
 * EnemyManager의 공간 그리드를 쓰고, 없으면 그룹 전체로 폴백한다.
 * 셀 경계 때문에 반경 밖이 섞이므로 호출자가 거리 제곱을 다시 확인해야 한다.
 */
function nearbyEnemies(
	system: SwordOrbitSystem,
	x: number,
	y: number,
	radius: number,
	out: EnemySprite[],
): EnemySprite[] {
	const manager = system.scene?.enemyManager;
	if (manager?.queryRadius) {
		return manager.queryRadius(x, y, radius, out);
	}
	return system.getEnemyChildren(system.enemyGroup);
}

// 초희귀 검 전용: %체력 피해 / 고정(트루) 피해 - 저항 무시
export function applyRareExtras(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite): void {
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};

	if ((definition.maxHpDamage ?? 0) > 0 && system.isValidEnemy(enemy)) {
		// 원본 수식과 동일: Math.min(300, Math.max(1, Math.round(maxHp * maxHpDamage)))
		const bonus = maxHpBonusDamage(enemy.maxHp, definition.maxHpDamage!, system.flatDamageScale?.() ?? 1);
		system.applyDamage(enemy, bonus, false, { ignoreResist: true });
		system.recordDamage(sword, bonus);
	}

	if ((definition.trueDamage ?? 0) > 0 && system.isValidEnemy(enemy)) {
		system.applyDamage(enemy, definition.trueDamage!, false, { ignoreResist: true });
		system.recordDamage(sword, definition.trueDamage!);
	}
}

// Trait-driven on-hit procs (slot sockets)
export function applyTraitProcs(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite): void {
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};
	const player = system.scene?.player;

	const goldOnHit = (traitMods.goldOnHitChance ?? 0) + (system.scene?.skillTree?.mods.goldOnHitChance ?? 0);
	if (goldOnHit > 0 && Math.random() < goldOnHit) {
		system.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', 1);
	}

	if ((traitMods.slowOnHit ?? 0) > 0 && system.isValidEnemy(enemy)) {
		system.scene?.statusEffects?.slow(enemy, Math.min(0.7, traitMods.slowOnHit!), 1200);
	}

	if ((traitMods.healOnHitChance ?? 0) > 0 && player && !player.isDead && Math.random() < traitMods.healOnHitChance!) {
		// 고정 +1 은 체력 규모(hpScaleOf)에 맞춰 환산하고, 초당 회복 예산 안에서만 들어온다
		healWithinBudget(player, Math.round(1 * hpScaleOf(player.maxHp)), system.scene?.time?.now ?? 0);
	}
}

export function applySpecial(system: SwordOrbitSystem, sword: OrbitSword, enemy: EnemySprite, damage: number): void {
	const special = sword.special;
	if (!special || !system.isValidEnemy(enemy)) {
		return;
	}

	const enemyManager = system.scene?.enemyManager;
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};
	// 세트 공명(같은 원소 2자루) 시 원소 효과 1.5배 — 증강 '원소 교감'이 resonanceScale을 올릴 수 있다
	const setScale = system.hasSetResonance(sword.definition?.element) ? system.resonanceScale : 1;
	const levelScale = (1 + 0.25 * ((sword.level ?? 1) - 1)) * setScale; // specials grow with sword level
	// 원소 세트 단계 보정 (불/독 2·5세트의 지속 피해, 얼음 2세트의 감속, 번개 2·5세트의 연쇄)
	const setMods = system.scene?.elementSets?.mods;
	// 지속 피해(고정 dps)도 검 피해와 같은 성장(레벨 성장 × 가산 배율)을 탄다 — 2026-09-04
	const dotScale = (setMods?.dotMult ?? 1) * (system.flatDamageScale?.() ?? 1);
	const dotDurScale = setMods?.dotDurationMult ?? 1;

	switch (special.type) {
		case 'burn':
			enemyManager?.applyDot?.(enemy, ((special.dps ?? 6) * levelScale + (traitMods.dotDpsBonus ?? 0)) * dotScale, ((special.durationMs ?? 2000) + (traitMods.dotDurationBonus ?? 0)) * dotDurScale, 0xf97316);
			system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'burn');
			break;
		case 'poison':
			enemyManager?.applyDot?.(enemy, ((special.dps ?? 8) * levelScale + (traitMods.dotDpsBonus ?? 0)) * dotScale, ((special.durationMs ?? 2500) + (traitMods.dotDurationBonus ?? 0)) * dotDurScale, 0x4ade80);
			system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'poison');
			break;
		case 'midas':
			if (Math.random() < (special.chance ?? 0.15)) {
				system.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', Math.max(1, Math.round(levelScale)));
				system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'midas');
			}
			break;
		case 'chain': {
			const targets = (special.targets ?? 1) + (traitMods.chainBonus ?? 0) + (setMods?.chainTargets ?? 0);
			const chainDamage = Math.max(1, Math.round(damage * (special.damagePct ?? 0.6) * (setMods?.chainDamageMult ?? 1)));
			// 그리드 후보 + 상위 k개 삽입 정렬 (래퍼 객체·전체 정렬·slice 배열 제거)
			const nearby = nearbyEnemies(system, enemy.x, enemy.y, 200, CHAIN_QUERY);
			const picked = CHAIN_PICKED;
			const pickedDist = CHAIN_PICKED_DIST;
			let count = 0;

			for (const other of nearby) {
				if (!system.isValidEnemy(other) || other === enemy) {
					continue;
				}
				const dx = other.x - enemy.x;
				const dy = other.y - enemy.y;
				const distanceSquared = dx * dx + dy * dy;
				if (distanceSquared > 200 * 200) {
					continue;
				}
				if (count === targets && distanceSquared >= pickedDist[count - 1]) {
					continue;
				}
				let slot = count < targets ? count : targets - 1;
				while (slot > 0 && pickedDist[slot - 1] > distanceSquared) {
					picked[slot] = picked[slot - 1];
					pickedDist[slot] = pickedDist[slot - 1];
					slot -= 1;
				}
				picked[slot] = other;
				pickedDist[slot] = distanceSquared;
				if (count < targets) {
					count += 1;
				}
			}

			const chainInfo = system.getDamageInfo(sword);
			for (let i = 0; i < count; i += 1) {
				const other = picked[i];
				system.applyDamage(other, chainDamage, false, chainInfo);
				system.recordDamage(sword, chainDamage);
				system.playChainEffect(enemy, other);
			}
			break;
		}
		case 'slow': {
			// 감속: 보스/리퍼/감속 면역 가드는 StatusEffectSystem.slow 안에 있다.
			// 레벨·세트 공명으로 강해진다 (상한 85%).
			const slowAmount = Math.min(0.85, (special.slowPct ?? 0.4) * (1 + 0.08 * ((sword.level ?? 1) - 1)) * setScale
				* (1 + (setMods?.slowBonus ?? 0)));
			system.scene?.statusEffects?.slow(enemy, slowAmount, special.durationMs ?? 1500);
			break;
		}
		case 'blast': {
			// 폭발: 명중 지점 주변 광역 피해 (연출은 전역 속도 제한)
			const radius = special.radius ?? 120;
			const radiusSquared = radius * radius;
			const blastDamage = Math.max(1, Math.round(damage * (special.damagePct ?? 0.5) * levelScale));
			const damageInfo = system.getDamageInfo(sword);
			// 밀집 구간에서 명중 1회가 적 60마리에게 takeDamage(넉백·틴트·사망 판정)를 연쇄시켜
			// 프레임 스파이크를 만들었다 → 대상 수 상한 + 피해 집계 1회로 정리.
			const BLAST_TARGET_CAP = 14;
			const blastTargets = nearbyEnemies(system, enemy.x, enemy.y, radius, BLAST_QUERY);
			const hitList = BLAST_HITS;
			let hitCount = 0;
			for (const other of blastTargets) {
				if (hitCount >= BLAST_TARGET_CAP) {
					break;
				}
				if (!system.isValidEnemy(other) || other === enemy) {
					continue;
				}
				const dx = other.x - enemy.x;
				const dy = other.y - enemy.y;
				if (dx * dx + dy * dy <= radiusSquared) {
					hitList[hitCount] = other;
					hitCount += 1;
				}
			}
			for (let i = 0; i < hitCount; i += 1) {
				system.applyDamage(hitList[i], blastDamage, false, damageInfo);
			}
			if (hitCount > 0) {
				system.recordDamage(sword, blastDamage * hitCount);
			}
			const nowMs = system.scene?.time?.now ?? 0;
			if (nowMs - (system.lastBlastFxAt ?? 0) >= 140) {
				system.lastBlastFxAt = nowMs;
				system.scene?.enemyManager?.playExplosionSprite?.(enemy.x, enemy.y, radius * 0.8);
				system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'blast');
			}
			break;
		}
		case 'leech': {
			// 흡혈(피 원소): 확률적으로 가한 피해 일부를 키퍼의 체력으로.
			// 과회복 방지: 발동당 회복량 상한 6 × 체력 규모 (레벨·공명은 확률이 아닌 회복량에 반영),
			// 그리고 초당 회복 예산(logic/lifesteal.ts) 안에서만 들어온다.
			const player = system.scene?.player;
			if (player && !player.isDead && Math.random() < (special.chance ?? 0.35)) {
				const hpScale = hpScaleOf(player.maxHp);
				const heal = Math.max(1, Math.min(6 * hpScale, Math.round(damage * (special.damagePct ?? 0.25) * 0.25 * levelScale)));
				if (healWithinBudget(player, heal, system.scene?.time?.now ?? 0) > 0) {
					system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'leech');
				}
			}
			break;
		}
		case 'execute': {
			const threshold = (special.threshold ?? 0.12) + (traitMods.executeBonus ?? 0);
			if (enemy.hp > 0 && enemy.hp / enemy.maxHp <= threshold
				&& !enemy.catalog?.isBoss && !enemy.catalog?.isReaper && !enemy.catalog?.isMiniboss) {
				system.recordDamage(sword, enemy.hp + 1);
				system.applyDamage(enemy, enemy.hp + 1, true, { ignoreResist: true });
				system.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 40, '처형!', true);
				system.scene?.visualEffects?.specialProcFX?.(enemy.x, enemy.y, 'execute');
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

	// (성능) 전역 속도 제한 — 후반 다중 연쇄 시 그래픽 폭증 방지 (피해는 그대로)
	const now = system.scene.time?.now ?? 0;
	if (now - (system.lastChainFxAt ?? 0) < 70) {
		return;
	}
	system.lastChainFxAt = now;

	// 지그재그 번개: 굵은 흐린 층 + 가는 밝은 층 2겹 (공유 FX 레이어)
	const ve = system.scene.visualEffects;
	if (!ve) {
		return;
	}
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
	const nx = -dy / distance; // 수직 방향
	const ny = dx / distance;
	const segments = Math.max(3, Math.min(7, Math.round(distance / 40)));

	const pts: number[] = [from.x, from.y];
	for (let i = 1; i < segments; i += 1) {
		const t = i / segments;
		const jitter = (Math.random() - 0.5) * 22;
		pts.push(from.x + dx * t + nx * jitter, from.y + dy * t + ny * jitter);
	}
	pts.push(to.x, to.y);

	ve.fxPoly(pts, {
		layers: [[5, 0x2f5f7a, 0.5], [2.5, 0x8fc3d8, 0.95], [1, 0xffffff, 0.9]],
		dur: 190,
	});

	// 도착점 플래시
	ve.fxDot(to.x, to.y, { r: 7, color: 0xbfe3f5, alpha: 0.9, scale1: 0.2, dur: 160 });
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

	// 이 함수는 **모든 명중마다** 돈다(초당 30~60회). 예전엔 적 176슬롯을 전수 순회하고
	// {enemy, distSq} 래퍼 배열을 만들어 전체 정렬 후 slice 했다. 이제는
	// (1) 공간 그리드로 후보를 반경 셀만큼만 모으고
	// (2) 상위 k개(보통 1~3)만 삽입 정렬로 고른다 — 할당 0, 정렬 O(n·k).
	const radiusSquared = system.cleaveRadius * system.cleaveRadius;
	const candidates = nearbyEnemies(system, struckEnemy.x, struckEnemy.y, system.cleaveRadius, CLEAVE_QUERY);

	const picked = CLEAVE_PICKED;
	const pickedDist = CLEAVE_PICKED_DIST;
	let count = 0;

	for (const enemy of candidates) {
		if (!system.isValidEnemy(enemy) || enemy === struckEnemy) {
			continue;
		}
		const dx = enemy.x - struckEnemy.x;
		const dy = enemy.y - struckEnemy.y;
		const distanceSquared = dx * dx + dy * dy;
		if (distanceSquared > radiusSquared) {
			continue;
		}
		// 이미 k개가 찼고 그 중 가장 먼 것보다도 멀면 버린다
		if (count === totalCleave && distanceSquared >= pickedDist[count - 1]) {
			continue;
		}
		let slot = count < totalCleave ? count : totalCleave - 1;
		while (slot > 0 && pickedDist[slot - 1] > distanceSquared) {
			picked[slot] = picked[slot - 1];
			pickedDist[slot] = pickedDist[slot - 1];
			slot -= 1;
		}
		picked[slot] = enemy;
		pickedDist[slot] = distanceSquared;
		if (count < totalCleave) {
			count += 1;
		}
	}

	const damageInfo = sword ? system.getDamageInfo(sword) : null;
	for (let i = 0; i < count; i += 1) {
		const enemy = picked[i];
		system.applyDamage(enemy, damage, isCrit, damageInfo);
		system.recordDamage(sword ?? '무리', damage);
		system.playCleaveEffect(struckEnemy, enemy);
	}
}

export function playCleaveEffect(system: SwordOrbitSystem, from: EnemySprite, to: EnemySprite): void {
	if (!system.scene) {
		return;
	}

	// (성능) 전역 속도 제한 — 검기 파동 다중 대상 시 그래픽 폭증 방지 (피해는 그대로)
	const now = system.scene.time?.now ?? 0;
	if (now - (system.lastCleaveFxAt ?? 0) < 70) {
		return;
	}
	system.lastCleaveFxAt = now;

	// 검기 파동: 본선 + 대상 지점 참격 아크 (공유 FX 레이어)
	const ve = system.scene.visualEffects;
	if (!ve) {
		return;
	}
	ve.fxPoly([from.x, from.y, to.x, to.y], {
		layers: [[3, 0xbae6fd, 0.55], [1.5, 0xffffff, 0.8]],
		dur: 200,
	});
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	ve.fxArc(to.x, to.y, { r: 16, a0: angle - 1.1, a1: angle + 1.1, color: 0xbae6fd, w: 3, alpha: 0.9, dur: 200 });
}

/**
 * 한 대의 피해를 계산해 적용한다 — 크리티컬 · 초희귀 추가 피해 · 각인 · 검 스페셜 ·
 * 검기 파동 · 증강/원소 세트 온-히트 훅까지 한 묶음.
 *
 * 기본 거동(registerSwordHit)과 관통 거동(registerPierceHit)이 이 함수를 공유한다.
 * 원본 registerSwordHit 의 계산 순서를 그대로 옮긴 것 — 수식 변경 금지.
 *
 * @param behaviorMult 거동 아키타입 피해 배율 (선회 0.52 / 참격 0.86 …)
 * @returns 실제로 적용된 피해
 */
export function resolveHit(
	system: SwordOrbitSystem,
	sword: OrbitSword,
	enemy: EnemySprite,
	behaviorMult = 1,
): number {
	const now = system.scene?.time?.now ?? 0;

	// Calculate critical hit: combine sword + player crit chance
	const player = system.scene?.player;
	const swordCritChance = sword.definition?.critChance ?? 0;
	const playerCritChance = player?.critChance ?? 0;
	const totalCritChance = swordCritChance + playerCritChance;
	const traitMods: Partial<SlotModifiers> = sword.traitMods ?? {};

	// 원소 세트의 실시간 배율 (탐욕·혈계·질풍·갈증) — 장착 시 붙는 고정 배율과 별개로
	// 매 타격 시점의 상태(보유 골드, 잃은 체력, 무피격 시간)에 따라 달라진다.
	const sets = system.scene?.elementSets;
	const setDamageMult = (sets?.dynamicDamageMult?.() ?? 1) * (system.scene?.skillTree?.dynamicDamageMult?.() ?? 1);
	// 키퍼 고유 메커닉: ASH [승계] 중첩 배율 (다른 키퍼는 항상 1)
	const keeperMult = system.scene?.keeper?.damageMult?.() ?? 1;

	let isCrit = false;
	let finalDamage = Math.round(
		(sword.damage ?? 20) * (system.damageMultiplier ?? 1) * setDamageMult * keeperMult * behaviorMult,
	);

	// 활공 사냥(능동 스킬): 키퍼가 직접 푼 이 출격만 피해가 오른다 (창은 짧다)
	if (now < (sword._diveBonusUntil ?? 0)) {
		finalDamage = Math.round(finalDamage * (sword._diveBonusMult ?? 1));
	}

	// 거인 사냥꾼: bonus vs elites / minibosses / bosses
	if ((traitMods.bigGameDamage ?? 0) > 0
		&& (enemy.catalog?.isElite || enemy.catalog?.isMiniboss || enemy.catalog?.isBoss)) {
		finalDamage = Math.round(finalDamage * (1 + traitMods.bigGameDamage!));
	}

	// Roll for critical hit — 황금 6세트 [금빛 축복]은 다음 한 방을 확정 치명타로 만든다
	const blessed = sets?.consumeBlessing?.() ?? false;
	if (totalCritChance > 0 || blessed) {
		const rollChance = Math.random();
		if (blessed || rollChance < totalCritChance) {
			isCrit = true;
			// Calculate critical damage multiplier
			let swordCritMult = sword.definition?.critDamageMultiplier ?? 1.0;
			let playerCritMult = player?.critDamageMultiplier ?? 1.0;

			// If crit chance exceeds 100%, overflow adds to damage multiplier
			const critOverflow = Math.max(0, totalCritChance - 1);
			const baseCritMult = (swordCritMult + playerCritMult) / 2 + (traitMods.critDamageAdd ?? 0);
			// 소프트캡(logic/statCaps) — 합계에 한 번만 건다. 카드/상점/세트/초과확률이
			// 전부 가산이라 상한이 없으면 후반에 총 피해가 그대로 배가된다.
			finalDamage = Math.round(finalDamage * softCapCritMultiplier(baseCritMult + critOverflow));
		}
	}

	const damageInfo = system.getDamageInfo(sword);
	// 공허 5세트: 치명타는 저항을 완전히 무시한다
	if (isCrit && sets?.has('void.critPierce')) {
		damageInfo.ignoreResist = true;
	}
	system.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
	system.applyDamage(enemy, finalDamage, isCrit, damageInfo);
	system.recordDamage(sword, finalDamage);
	// 명중 불꽃 (혈통색) — 크리티컬은 더 크게 터진다
	const sparkTint = sword.effect?.tint
		? parseInt(sword.effect.tint.replace('#', ''), 16)
		: 0xe8c07a;
	system.scene?.visualEffects?.hitSparkFX?.(enemy.x, enemy.y, sparkTint, isCrit);
	system.applyRareExtras(sword, enemy);
	system.applyTraitProcs(sword, enemy);
	system.applySpecial(sword, enemy, finalDamage);
	system.applyCleave(enemy, finalDamage, isCrit, sword);
	// 증강 전역 온-히트 훅 (화상/연쇄/처형/흡혈/칼자국)
	system.scene?.augmentSystem?.onSwordHit?.(sword, enemy, finalDamage, isCrit);
	// 원소 세트 온-히트 훅 (감전/출혈/빙결/중독 중첩/균열/처형/미다스)
	sets?.onSwordHit?.(enemy, finalDamage, isCrit);
	// 키퍼 고유 메커닉 훅 (ASH 승계 중첩 등)
	system.scene?.keeper?.onSwordHit?.(sword, enemy, finalDamage, isCrit);
	return finalDamage;
}

export function registerSwordHit(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword || !system.isValidEnemy(enemy) || system.isSealed(sword)) {
		return;
	}

	const now = system.scene?.time?.now ?? 0;
	if (now < (sword.hitCooldownUntil ?? 0)) {
		return;
	}

	const behavior = behaviorFor(sword);
	resolveHit(system, sword, enemy, behaviorSpec(behavior).damageMult);

	sword.hitTargets ??= new Set();
	sword.hitTargets.add(enemy);
	sword.remainingHits = Math.max(0, (sword.remainingHits ?? 1) - 1);

	sword.hitCooldownUntil = now + (sword.hitCooldownMs ?? 110);

	// 말뚝검: 명중한 자리에 그대로 꽂힌다 (연속타·재타겟 없이 오라로 전환)
	if (behavior === 'stake') {
		movement.startPlantedSword(system, sword);
		return;
	}

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

// ---------------------------------------------------------------------------
// 관통 거동 (선회검 · 참격검) — 경로가 스치는 적을 출격당 한 번씩 벤다
// ---------------------------------------------------------------------------

/**
 * 관통 타격. 기본 거동과 다른 점:
 *  - 적마다 **출격당 1회만** 맞는다 (hitTargets 로 차단) — 전역 타격 쿨다운을 쓰지 않으므로
 *    같은 프레임에 여러 적을 동시에 벨 수 있다.
 *  - remainingHits 를 깎지 않는다. 귀환 시점은 경로(호/사거리)가 정한다.
 */
export function registerPierceHit(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword || !system.isValidEnemy(enemy) || system.isSealed(sword)) {
		return;
	}
	sword.hitTargets ??= new Set();
	if (sword.hitTargets.has(enemy)) {
		return;
	}
	sword.hitTargets.add(enemy);
	resolveHit(system, sword, enemy, behaviorSpec(behaviorFor(sword)).damageMult);
}

// ---------------------------------------------------------------------------
// 말뚝검 오라 — 꽂힌 자리 주변을 주기적으로 지진다
// ---------------------------------------------------------------------------

/**
 * 오라 1틱. 반경 안의 적에게 (검 피해 × auraTickPct) 를 준다.
 * 밀집 구간에서 한 틱이 60마리에게 takeDamage 를 연쇄시키지 않도록 대상 수에 상한을 둔다.
 * 검 고유 속성 효과(화상·중독·감속…)는 가장 가까운 소수에게만 실린다 — 오라가
 * 스페셜 발동기가 되어버리는 것을 막는 장치다.
 */
export function applyStakeAura(system: SwordOrbitSystem, sword: OrbitSword | null): void {
	if (!sword || system.isSealed(sword)) {
		return;
	}
	const spec = behaviorSpec('stake');
	const radius = spec.auraRadius ?? 96;
	const radiusSquared = radius * radius;
	const cap = spec.auraTargetCap ?? 8;
	const sets = system.scene?.elementSets;

	const tickDamage = Math.max(1, Math.round(
		(sword.damage ?? 20) * (system.damageMultiplier ?? 1)
		* (sets?.dynamicDamageMult?.() ?? 1) * (spec.auraTickPct ?? 0.3),
	));
	const damageInfo = system.getDamageInfo(sword);
	const candidates = nearbyEnemies(system, sword.x, sword.y, radius, STAKE_QUERY);

	let count = 0;
	for (const enemy of candidates) {
		if (count >= cap) {
			break;
		}
		if (!system.isValidEnemy(enemy)) {
			continue;
		}
		const dx = enemy.x - sword.x;
		const dy = enemy.y - sword.y;
		if (dx * dx + dy * dy > radiusSquared) {
			continue;
		}
		system.applyDamage(enemy, tickDamage, false, damageInfo);
		if (count < 3) {
			system.applySpecial(sword, enemy, tickDamage);
		}
		count += 1;
	}

	if (count > 0) {
		system.recordDamage(sword, tickDamage * count);
	}

	// 틱 연출 (2026-09-04 강화): 굵은 파동 링 + 안쪽 흰 링 + 맞은 적 수만큼 파편 — "지지고 있다"가 보이게
	const tint = sword.effect?.tint ? parseInt(sword.effect.tint.replace('#', ''), 16) : 0xe8c07a;
	const fx = system.scene?.visualEffects;
	fx?.fxRing(sword.x, sword.y, { r0: radius * 0.3, r1: radius * 1.05, w: 4, color: tint, alpha: 0.9, dur: 360 });
	fx?.fxRing(sword.x, sword.y, { r0: radius * 0.2, r1: radius * 0.8, w: 2, color: 0xffffff, alpha: 0.55, dur: 260 });
	if (count > 0) {
		fx?.fxBurst(sword.x, sword.y, { count: Math.min(10, 4 + count), reach: radius * 0.9, color: tint, w: 2, alpha: 0.8, dur: 280 });
	}
}

export function registerOrbitHit(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword || !system.isValidEnemy(enemy) || system.isSealed(sword)) {
		return;
	}

	const now = system.scene?.time?.now ?? 0;
	if (now < (sword.hitCooldownUntil ?? 0)) {
		return;
	}

	const player = system.scene?.player;
	const orbitSets = system.scene?.elementSets;
	const totalCritChance = (sword.definition?.critChance ?? 0) + (player?.critChance ?? 0);
	let finalDamage = Math.round(
		(sword.damage ?? 20) * (system.damageMultiplier ?? 1) * system.orbitDamageMult
		* (orbitSets?.dynamicDamageMult?.() ?? 1),
	);
	let isCrit = false;

	if (totalCritChance > 0 && Math.random() < totalCritChance) {
		isCrit = true;
		const baseCritMult = ((sword.definition?.critDamageMultiplier ?? 1) + (player?.critDamageMultiplier ?? 1)) / 2;
		finalDamage = Math.round(finalDamage * (baseCritMult + Math.max(0, totalCritChance - 1)));
	}

	const damageInfo = system.getDamageInfo(sword);
	system.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
	system.applyDamage(enemy, finalDamage, isCrit, damageInfo);
	system.recordDamage(sword, finalDamage);
	system.applyRareExtras(sword, enemy);
	system.applyTraitProcs(sword, enemy);
	system.applySpecial(sword, enemy, finalDamage);
	system.applyCleave(enemy, finalDamage, isCrit, sword);
	// 증강 전역 온-히트 훅 (궤도 접촉 타격에도 적용)
	system.scene?.augmentSystem?.onSwordHit?.(sword, enemy, finalDamage, isCrit);
	orbitSets?.onSwordHit?.(enemy, finalDamage, isCrit);
	sword.hitCooldownUntil = now + Math.max(180, sword.hitCooldownMs ?? 180);
}

export function handleSwordEnemyOverlap(system: SwordOrbitSystem, sword: OrbitSword | null, enemy: EnemySprite): void {
	if (!sword) {
		return;
	}

	// Orbit contact damage (Berserker trait) — 스킬 트리 [회전베기] 중에는 누구나 (orbitContactUntil)
	if ((system.noLaunch || (system.scene?.time?.now ?? 0) < system.orbitContactUntil) && sword.state === 'orbiting') {
		system.registerOrbitHit(sword, enemy);
		return;
	}

	if (sword.state !== 'launched') {
		return;
	}

	// 관통 거동(선회·참격)은 매 프레임 경로 스윕이 따로 판정한다.
	// 여기서 registerSwordHit 을 태우면 연속타 카운터가 깎여 조기 귀환한다.
	const behavior = behaviorFor(sword);
	if (behavior === 'boomerang' || behavior === 'lance') {
		system.registerPierceHit(sword, enemy);
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
