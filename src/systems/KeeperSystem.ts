// 키퍼 고유 메커닉 (2026-09-01)
//
// 그동안 키퍼 4명의 차이는 숫자뿐이었다 — 체력·피해·행운 배율. 같은 검을 같은 방식으로
// 굴리는 네 개의 프리셋이었다. 이 시스템이 각자에게 "그 키퍼만의 규칙" 하나씩을 준다.
//
//   ASH     승계 (succession)     — 서로 다른 검이 이어 때릴수록 무리 전체 피해가 오른다
//   BASTION 반격 사출 (counter)   — 피격 순간 사슬 궤도의 검 한 자루가 풀려 2배로 되찌른다
//   TALON   질풍 보법 (galewalk)  — 대시 재사용 절반 + 대시 경로의 적을 검이 훑는다
//   GILDER  감정사의 내기 (wager) — 상점 첫 되굴림 무료 + 주운 검의 등급 도박
//
// 설계 규칙
//  1. 수치는 전부 src/data/playerCatalog.json 의 `mechanic` — 코드에 상수를 박지 않는다.
//  2. 세이브에 새 필수 필드를 넣지 않는다. 메커닉 상태(중첩·쿨다운)는 전부 런 안의 휘발값이고
//     키퍼 id 는 이미 세이브에 있다 — 이어하기는 "기본 상태에서 다시 쌓기"로 복원된다.
//  3. 핫패스(update / onSwordHit)에서 객체·배열을 만들지 않는다. 질의 버퍼는 모듈 상수.
//  4. 연출은 공유 FX 레이어(fx*)만 쓴다.

import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import type { KeeperMechanicSpec, SwordRarity } from '../types/catalogs';
import type { OrbitSword, OrbitSwordDefinition } from './sword/types';

/** 대시 훑기 질의 버퍼 (중첩 호출 없음 — 결과를 즉시 소비한다). */
const SWEEP_QUERY: EnemySprite[] = [];
/** 감정 도박 후보 (등급 풀에서 하나를 고른다). */
const WAGER_POOL: OrbitSwordDefinition[] = [];

const RARITY_ORDER: SwordRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
/** 도박으로 올라갈 수 있는 상한 — 신화는 조합 전용이라 내기로는 닿지 않는다. */
const WAGER_MAX_INDEX = RARITY_ORDER.indexOf('legendary');

export default class KeeperSystem {
	scene: GameScene;
	readonly spec: KeeperMechanicSpec | null;
	readonly id: string;

	// ── 승계 (ASH) ──
	/** 현재 승계 단수 (0~maxStacks) */
	successionStacks = 0;
	/** 이 시각을 넘기면 승계가 풀린다 */
	private successionUntil = 0;
	/** 직전에 명중시킨 검의 id — 같은 검이 연타해도 단이 오르지 않는다 */
	private lastHitSwordId: string | null = null;

	// ── 반격 사출 (BASTION) ──
	private counterReadyAt = 0;
	/** 실제로 반격이 나간 횟수 (테스트·통계용) */
	counterCount = 0;

	// ── 질풍 보법 (TALON) ──
	/** 이번 대시에서 이미 훑은 적 (대시가 끝나면 비운다) */
	private dashHits = new Set<EnemySprite>();
	private dashSweeping = false;
	/** 대시 훑기로 벤 누적 횟수 (테스트용) */
	galewalkHits = 0;

	// ── 감정사의 내기 (GILDER) ──
	/** 내기가 실제로 굴러간 횟수 (테스트용) */
	wagerCount = 0;
	/** 마지막 내기 결과 — 'up' | 'down' | 'keep' */
	lastWager: 'up' | 'down' | 'keep' | null = null;

	constructor(scene: GameScene) {
		this.scene = scene;
		this.spec = scene.playerConfig?.mechanic ?? null;
		this.id = this.spec?.id ?? '';
	}

	private has(id: string): boolean {
		return this.id === id;
	}

	// ---------------------------------------------------------------
	// 승계 (ASH) — 서로 다른 검이 이어 때리면 무리 전체 피해가 오른다
	// ---------------------------------------------------------------

	/** 지금 무리 전체에 곱해지는 키퍼 배율 (resolveHit 가 매 타격마다 읽는다). */
	damageMult(): number {
		if (!this.has('succession') || this.successionStacks <= 0) {
			return 1;
		}
		if ((this.scene.time?.now ?? 0) >= this.successionUntil) {
			// 창이 지났으면 다음 조회 때 이미 0 — 여기서 바로 정리한다
			this.successionStacks = 0;
			this.lastHitSwordId = null;
			return 1;
		}
		return 1 + this.successionStacks * (this.spec?.damagePerStack ?? 0.06);
	}

	/** 검이 적을 때린 직후 (hitResolution.resolveHit). */
	onSwordHit(sword: OrbitSword, _enemy: EnemySprite, _damage: number, _isCrit: boolean): void {
		if (!this.has('succession')) {
			return;
		}
		const now = this.scene.time?.now ?? 0;
		const windowMs = this.spec?.windowMs ?? 1600;
		const maxStacks = this.spec?.maxStacks ?? 5;
		const id = sword.definition?.id ?? null;

		if (now >= this.successionUntil) {
			// 이어지지 않았다 — 이 타격이 새 사슬의 첫 단이다
			this.successionStacks = 0;
		} else if (id !== this.lastHitSwordId && this.successionStacks < maxStacks) {
			this.successionStacks += 1;
			if (this.successionStacks === maxStacks) {
				this.scene.visualEffects?.fxRing(this.scene.player.x, this.scene.player.y, {
					r0: 20, r1: 74, w: 2.5, color: 0xe8c07a, alpha: 0.7, dur: 300,
				});
			}
		}

		this.lastHitSwordId = id;
		this.successionUntil = now + windowMs;
	}

	// ---------------------------------------------------------------
	// 반격 사출 (BASTION) — 피격 순간 검 한 자루가 풀린다
	// ---------------------------------------------------------------

	/** 키퍼가 실제로 피해를 입은 직후 (GameScene.applyPlayerDamage). */
	onPlayerHurt(): boolean {
		if (!this.has('counterstrike')) {
			return false;
		}
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const player = scene.player;
		if (!orbit || !player || player.isDead) {
			return false;
		}

		const now = scene.time?.now ?? 0;
		if (now < this.counterReadyAt) {
			return false;
		}

		const radius = this.spec?.searchRadius ?? 420;
		const target = orbit.findNearestEnemy(player.x, player.y, orbit.enemyGroup, radius);
		if (!target) {
			return false;
		}

		// 궤도에 있는 검 중 하나 (사슬 궤도라 보통 전부 궤도에 있다)
		let chosen: OrbitSword | null = null;
		for (const sword of orbit.swords) {
			if (sword.state === 'orbiting') {
				chosen = sword;
				break;
			}
		}
		if (!chosen) {
			return false;
		}

		this.counterReadyAt = now + (this.spec?.cooldownMs ?? 1200);
		this.counterCount += 1;

		// 활공 사냥과 같은 장치를 빌린다 — 이 출격 동안만 피해가 오른다
		chosen._diveBonusUntil = now + 2000;
		chosen._diveBonusMult = this.spec?.damageMult ?? 2;
		orbit.startLaunchedSword(chosen, target);

		scene.visualEffects?.fxRing(player.x, player.y, {
			r0: 10, r1: 62, w: 3, color: 0xd95f4d, alpha: 0.85, dur: 260,
		});
		return true;
	}

	// ---------------------------------------------------------------
	// 질풍 보법 (TALON) — 대시 재사용 절반 + 경로 훑기
	// ---------------------------------------------------------------

	/** 능동 스킬 쿨다운 배율 (ActiveSkillSystem.cooldownMs). */
	skillCooldownMult(id: string): number {
		if (id === 'dash' && this.has('galewalk')) {
			return this.spec?.dashCooldownMult ?? 0.5;
		}
		return 1;
	}

	update(_delta = 16): void {
		if (!this.has('galewalk')) {
			return;
		}
		const scene = this.scene;
		const dashing = scene.activeSkills?.isDashing ?? false;

		if (!dashing) {
			if (this.dashSweeping) {
				this.dashSweeping = false;
				this.dashHits.clear();
			}
			return;
		}

		if (!this.dashSweeping) {
			this.dashSweeping = true;
			this.dashHits.clear();
		}
		this.sweepDashPath();
	}

	/** 대시 중 플레이어 주변의 적을 검 피해의 일부로 벤다 (대시 1회당 적마다 1번). */
	private sweepDashPath(): void {
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const player = scene.player;
		const manager = scene.enemyManager;
		if (!orbit || !player || orbit.swords.length === 0) {
			return;
		}

		const radius = this.spec?.trailRadius ?? 58;
		const radiusSquared = radius * radius;
		const candidates = manager?.queryRadius
			? manager.queryRadius(player.x, player.y, radius, SWEEP_QUERY)
			: orbit.getEnemyChildren(orbit.enemyGroup);

		// 대표 검 = 가장 강한 검 1자루 (TALON 은 어차피 한 자루다)
		let best: OrbitSword | null = null;
		for (const sword of orbit.swords) {
			if (!best || (sword.damage ?? 0) > (best.damage ?? 0)) {
				best = sword;
			}
		}
		if (!best) {
			return;
		}
		const damage = Math.max(1, Math.round(
			(best.damage ?? 20) * (orbit.damageMultiplier ?? 1) * (this.spec?.trailDamagePct ?? 0.9),
		));
		const damageInfo = orbit.getDamageInfo(best);

		for (const enemy of candidates) {
			if (!orbit.isValidEnemy(enemy) || this.dashHits.has(enemy)) {
				continue;
			}
			const dx = enemy.x - player.x;
			const dy = enemy.y - player.y;
			if (dx * dx + dy * dy > radiusSquared) {
				continue;
			}
			this.dashHits.add(enemy);
			this.galewalkHits += 1;
			orbit.applyDamage(enemy, damage, false, damageInfo);
			orbit.recordDamage(best, damage);
			scene.visualEffects?.fxPoly([player.x, player.y, enemy.x, enemy.y], {
				layers: [[2.5, 0xbae6fd, 0.5], [1, 0xffffff, 0.8]],
				dur: 170,
			});
		}
	}

	// ---------------------------------------------------------------
	// 감정사의 내기 (GILDER)
	// ---------------------------------------------------------------

	/** 상점 첫 되굴림이 공짜인가 (ShopSystem.rerollPrice). */
	get freeFirstReroll(): boolean {
		return this.has('wager') && (this.spec?.freeFirstReroll ?? false);
	}

	/**
	 * 주워 든 검을 감정대에 올린다 (SwordOrbitSystem.acquireSword).
	 * 상점 구매처럼 값을 치르고 고른 검은 이 경로를 타지 않는다.
	 * @returns 실제로 손에 넣게 될 검 (내기가 없으면 원본 그대로)
	 */
	gambleSword(definition: OrbitSwordDefinition): OrbitSwordDefinition {
		if (!this.has('wager') || !definition?.rarity || definition.evolved) {
			return definition;
		}
		const index = RARITY_ORDER.indexOf(definition.rarity);
		if (index < 0) {
			return definition;
		}

		const roll = Math.random();
		const up = this.spec?.upChance ?? 0.45;
		const down = this.spec?.downChance ?? 0.2;
		let targetIndex = index;
		let outcome: 'up' | 'down' | 'keep' = 'keep';
		if (roll < up) {
			targetIndex = Math.min(WAGER_MAX_INDEX, index + 1);
			outcome = targetIndex > index ? 'up' : 'keep';
		} else if (roll < up + down) {
			targetIndex = Math.max(0, index - 1);
			outcome = targetIndex < index ? 'down' : 'keep';
		}

		this.wagerCount += 1;
		this.lastWager = outcome;
		if (outcome === 'keep') {
			return definition;
		}

		const replacement = this.pickByRarity(RARITY_ORDER[targetIndex], definition.id);
		if (!replacement) {
			this.lastWager = 'keep';
			return definition;
		}

		const scene = this.scene;
		scene.visualEffects?.showDamageText?.(
			scene.player.x, scene.player.y - 70,
			outcome === 'up' ? '감정 성공!' : '감정 실패…', outcome === 'up',
		);
		return replacement;
	}

	/** 그 등급의 조합 전용이 아닌 검 하나 (없으면 null). 배열을 새로 만들지 않는다. */
	private pickByRarity(rarity: SwordRarity, excludeId: string): OrbitSwordDefinition | null {
		const catalog = this.scene.swordOrbit?.swordCatalog ?? [];
		let count = 0;
		for (const entry of catalog) {
			if (entry.rarity === rarity && !entry.evolved && entry.id !== excludeId) {
				WAGER_POOL[count] = entry;
				count += 1;
			}
		}
		if (count === 0) {
			return null;
		}
		return WAGER_POOL[Math.floor(Math.random() * count)];
	}

	destroy(): void {
		this.dashHits.clear();
	}
}
