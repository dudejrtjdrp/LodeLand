// 원소 세트 런타임 — src/logic/elementSets.ts 의 데이터를 실제 전투에 연결한다.
//
// 책임
//  1) 장착 구성이 바뀌면 세트 단계를 다시 계산하고, 스탯 보정을 되돌린 뒤 새로 적용한다
//     (되돌리기/적용 diff 방식 — 곱은 나눗셈으로, 가산은 뺄셈으로 정확히 원복된다).
//  2) 4/6/7단계 스킬의 온-히트 / 온-처치 / 매 프레임 훅을 처리한다.
//  3) 적 상태이상(감전·출혈·빙결·중독 중첩)은 EnemySprite 의 set* 필드에 얹는다.
//
// 성능 규약 (docs 및 기존 코드 관례)
//  - 연출은 반드시 공유 FX 레이어(fx*)로. add.circle + 트윈 금지.
//  - 주기 스킬은 프레임당 1회 타이머 누산, 대상 질의는 enemyManager.queryRadius 사용.
//  - 프레임당 배열 할당 0을 목표로 모듈 상수 버퍼를 재사용한다.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite, PlayerSprite } from '../types/actors';
import {
	ELEMENT_SETS,
	SET_ELEMENTS,
	aggregateSets,
	computeSetTiers,
	emptyMods,
	type AggregatedSets,
	type SetElement,
	type SetStatMods,
} from '../logic/elementSets';
import { reduceMotion } from '../core/settings';
import { healWithinBudget } from '../logic/lifesteal';
import { hpScaleOf } from '../logic/growth';

/** 반경 질의 재사용 버퍼 (프레임당 할당 0). */
const QUERY: EnemySprite[] = [];
const TARGETS: EnemySprite[] = [];

/** 예약된 균열 (공허 4/6/7). */
interface Rift {
	x: number;
	y: number;
	at: number;
	radius: number;
	damage: number;
	big: boolean;
}

/**
 * 피 5단계 — 흡혈로 회복한 양의 몇 배가 폭발 피해가 되는가.
 * 세트 흡혈(2+5단계 = 5%) 기준으로 총 피해의 약 8% 가 광역으로 되돌아온다.
 */
const BLOOD_BURST_RATIO = 1.6;
/** 피 5단계 — 끓은 피가 터지는 주기(ms)와 반경. */
const BLOOD_BURST_MS = 600;
const BLOOD_BURST_RADIUS = 130;
/**
 * 황금 5단계 — 금화 1개가 부르는 벼락의 세기 (평균 1타 피해 대비).
 * 재화가 곧 화력이라는 황금 세트의 축을 "피해 0" 인 미다스 대신 떠받친다.
 */
const COIN_STRIKE_RATIO = 0.5;
/** 황금 5단계 — 한 번에 몰아 떨어지는 금화 수 상한 / 주기(ms) / 반경. */
const COIN_STRIKE_MAX = 8;
const COIN_STRIKE_MS = 500;
const COIN_STRIKE_RADIUS = 120;

/** 바람 4단계 — 이동 궤적에 남는 칼바람 자국. */
interface WindTrail {
	x: number;
	y: number;
	until: number;
}

export default class ElementSetSystem {
	scene: GameScene;

	/** 원소별 활성 단계 (2~7). */
	tiers: Partial<Record<SetElement, number>> = {};
	/** 합산된 수치 보정. */
	mods: SetStatMods = emptyMods();
	/** 활성 스킬/플래그 id 집합. */
	skills: Set<string> = new Set();

	/** 이미 반영해 둔 보정 — 재계산 시 이 값으로 원복한다. */
	private applied: SetStatMods | null = null;
	/** 단계 상승 안내를 이미 띄운 키. */
	private announced = new Set<string>();

	// ── 주기 스킬 타이머
	private tFireRing = 0;
	private tConflagration = 0;
	private tStaticField = 0;
	private tPermafrost = 0;
	private tGoldBlessing = 0;
	private tEyeOfStorm = 0;
	private tSingularity = 0;
	private tPlague = 0;
	private tWindTrail = 0;
	private tBloodBurst = 0;
	private tCoinStrike = 0;

	// ── 스킬 상태
	/** 황금 4단계: 런 중 획득 골드 누적 → 피해 보너스. */
	goldEarned = 0;
	/**
	 * 최근 검 1타 피해의 지수이동평균. 유틸 원소(피·황금)의 DPS 항이
	 * "지금 이 빌드의 한 방" 에 비례하도록 스케일을 잡는 데 쓴다.
	 * 갱신은 곱셈 2회 — 핫패스에 객체를 만들지 않는다.
	 */
	avgHitDamage = 0;
	/** 피 5단계: 흡혈로 회복한 양이 끓어오른 상태 (터질 때 소모). */
	private bloodCharge = 0;
	/** 황금 5단계: 아직 벼락으로 떨어지지 않은 금화 값어치. */
	private coinCharge = 0;
	/** 감속 취약(얼음 3세트)이 켜져 있는가 — EnemyManager 의 조회 게이트. */
	vulnerabilityActive = false;
	/** 황금 6단계: 다음 타격 확정 치명타. */
	blessingReady = false;
	/** 피 6단계: 갈증 중첩 (0~3) 과 만료. */
	thirstStacks = 0;
	private thirstUntil = 0;
	/** 바람 6단계: 마지막 피격 시각. */
	private lastHurtAt = -99999;
	galeActive = false;
	/** 공허: 예약된 균열들. */
	private rifts: Rift[] = [];
	/** 바람 4단계 자국. */
	private trails: WindTrail[] = [];

	destroyed = false;

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	// ------------------------------------------------------------------
	// 세트 재계산 / 스탯 적용
	// ------------------------------------------------------------------

	/** 장착 구성이 바뀔 때마다 호출 (SwordOrbitSystem.invalidateElementCache 에서 연결). */
	recompute(): void {
		if (this.destroyed) {
			return;
		}
		const orbit = this.scene.swordOrbit;
		if (!orbit) {
			return;
		}
		const counts = orbit.getElementCounts();
		const next: AggregatedSets = aggregateSets(computeSetTiers(counts));

		this.revertStats();
		this.tiers = next.tiers;
		this.mods = next.mods;
		this.skills = next.skills;
		this.vulnerabilityActive = next.skills.size > 0 || next.mods.slowedDamageMult !== 1;
		this.applyStats();
		this.announceNewTiers();
	}

	/**
	 * 반영해 둔 보정을 되돌린다. RunSave.capture 가 "세트 없는 순수 스탯"을
	 * 저장하기 위해 직접 호출한다 (저장값에 세트 보정이 섞이면 복원 때 이중 적용된다).
	 */
	revertStats(): void {
		const applied = this.applied;
		if (!applied) {
			return;
		}
		this.applyMods(applied, -1);
		this.applied = null;
	}

	/** 되돌려 둔 보정을 다시 얹는다 (revertStats 와 짝). */
	applyStats(): void {
		this.applyMods(this.mods, 1);
		this.applied = { ...this.mods };
	}

	/**
	 * 되돌리지 않고 "반영 기록"만 지운다.
	 * RunSave.apply 처럼 스탯 값 자체를 통째로 덮어쓰는 경우에 쓴다 —
	 * 이때 revertStats 를 부르면 이미 사라진 값을 빼게 되어 스탯이 망가진다.
	 */
	resetApplied(): void {
		this.applied = null;
	}

	/**
	 * dir=1 이면 적용, dir=-1 이면 원복.
	 * 곱연산은 dir=-1 일 때 나눗셈으로, 가산은 뺄셈으로 되돌린다.
	 */
	private applyMods(mods: SetStatMods, dir: 1 | -1): void {
		const orbit = this.scene.swordOrbit;
		const player = this.scene.player;
		const progression = this.scene.progression;
		const mul = (value: number, factor: number) => (dir === 1 ? value * factor : value / factor);
		const add = (value: number, amount: number) => value + amount * dir;

		if (orbit) {
			orbit.damageMultiplier = mul(orbit.damageMultiplier, mods.dmgMult);
			orbit.cooldownMultiplier = mul(orbit.cooldownMultiplier, mods.cdMult);
			orbit.launchSpeedMultiplier = mul(orbit.launchSpeedMultiplier, mods.launchMult);
			orbit.orbitSpeed = mul(orbit.orbitSpeed, mods.orbitSpeedMult);
			// 상한도 함께 움직여야 세트 보너스가 상한에 잡아먹히지 않는다
			orbit.baseOrbitSpeed = mul(orbit.baseOrbitSpeed, mods.orbitSpeedMult);
		}

		if (player) {
			player.critChance = add(player.critChance, mods.critChance);
			player.critDamageMultiplier = add(player.critDamageMultiplier, mods.critDamage);
			player.defense = add(player.defense, mods.defense);
			player.dodgeChance = add(player.dodgeChance, mods.dodge);
			player.damageReduction = add(player.damageReduction, mods.damageReduction);
			player.lifesteal = add(player.lifesteal, mods.lifesteal);
			player.goldBonus = add(player.goldBonus, mods.goldBonus);
			player.luck = add(player.luck, mods.luck);

			const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
			player.maxHp = Math.max(1, Math.round(mul(player.maxHp, mods.maxHpMult)));
			player.hp = Math.min(player.maxHp, Math.max(1, Math.round(player.maxHp * hpRatio)));

			player.moveSpeed = Math.round(mul(player.moveSpeed, mods.moveSpeedMult));
			if (player.baseMoveSpeed) {
				player.baseMoveSpeed = Math.round(mul(player.baseMoveSpeed, mods.moveSpeedMult));
			}
		}

		if (progression) {
			progression.magnetRadius = mul(progression.magnetRadius, mods.magnetMult);
			if (progression.baseMagnetRadius) {
				progression.baseMagnetRadius = mul(progression.baseMagnetRadius, mods.magnetMult);
			}
		}
	}

	/**
	 * 새로 열린 단계를 알린다.
	 *
	 * 상점에서 한 번에 여러 자루를 바꾸면 한 원소에서 2·3·4단계가 동시에 열린다.
	 * 그때마다 배너를 띄우면 화면이 배너로 뒤덮이므로 **원소당 가장 높은 새 단계
	 * 하나만** 알리고 나머지는 조용히 기록만 한다.
	 */
	private announceNewTiers(): void {
		for (const element of SET_ELEMENTS) {
			const tier = this.tiers[element] ?? 0;
			if (tier < 2) {
				continue;
			}
			const spec = ELEMENT_SETS[element];
			let top: (typeof spec.tiers)[number] | null = null;
			for (const step of spec.tiers) {
				if (step.count > tier) {
					break;
				}
				const key = `${element}:${step.count}`;
				if (this.announced.has(key)) {
					continue;
				}
				this.announced.add(key);
				top = step;
			}
			if (!top) {
				continue;
			}
			const title = top.skill
				? `${spec.label} ${top.count}세트 — [${top.skill.name}] ${top.skill.desc}`
				: `${spec.label} ${top.count}세트 — ${top.desc}`;
			this.scene.waveSystem?.announce?.(title, spec.css);
			this.scene.soundSystem?.play(top.skill ? 'chest' : 'evolve');
			if (top.skill) {
				this.setUnlockFX(element);
			}
			// 도전과제: 같은 원소 7자루 완성 (단계 발표 시점 = 상태 변화 시점)
			this.scene.achievements?.onElementSetComplete(top.count);
		}
	}

	/** 세트 스킬 해금 순간 연출 — 원소색 이중 링 + 룬 파편. */
	private setUnlockFX(element: SetElement): void {
		const player = this.scene.player;
		const fx = this.scene.visualEffects;
		if (!player || !fx || reduceMotion()) {
			return;
		}
		const color = ELEMENT_SETS[element].color;
		fx.fxRing(player.x, player.y, { r0: 20, r1: 190, w: 5, color, alpha: 0.95, dur: 620 });
		fx.fxRing(player.x, player.y, { r0: 190, r1: 40, w: 2.5, color: 0xffffff, alpha: 0.7, dur: 520 });
		for (let i = 0; i < 12; i += 1) {
			const a = (i / 12) * Math.PI * 2;
			fx.fxDiamond(player.x + Math.cos(a) * 120, player.y + Math.sin(a) * 120, {
				r: 8, color, alpha: 0.95, dur: 560,
			});
		}
	}

	has(skill: string): boolean {
		return this.skills.has(skill);
	}

	tierOf(element: SetElement): number {
		return this.tiers[element] ?? 0;
	}

	// ------------------------------------------------------------------
	// 상태이상 조회 (EnemyManager / hitResolution 이 소비)
	// ------------------------------------------------------------------

	/** 적이 현재 받는 피해 배율 (감전 취약 · 부식 · 빙결 취약 · 감속 취약의 합). */
	vulnerabilityFor(enemy: EnemySprite, now: number): number {
		let mult = 1;
		if ((enemy.setShockUntil ?? 0) > now) {
			mult += this.has('electric.tempest') ? 0.30 : 0.15;
		}
		if ((enemy.setFrozenUntil ?? 0) > now) {
			mult += 0.25;
		}
		// 얼음 3세트 — 감속(빙결 포함)된 적은 더 크게 베인다.
		// 얼음 검의 slow 스페셜 자체가 피해로 환산되는 지점이다.
		if (this.mods.slowedDamageMult !== 1 && (enemy.slowUntil ?? 0) > now) {
			mult += this.mods.slowedDamageMult - 1;
		}
		if (this.has('poison.corrode') && (enemy.dotUntil ?? 0) > now) {
			mult += 0.10;
		}
		return mult;
	}

	// ------------------------------------------------------------------
	// 온-히트 (hitResolution 이 매 명중마다 호출)
	// ------------------------------------------------------------------

	onSwordHit(enemy: EnemySprite, damage: number, _isCrit: boolean): void {
		if (this.destroyed || this.skills.size === 0) {
			return;
		}
		const scene = this.scene;
		const now = scene.time?.now ?? 0;
		const manager = scene.enemyManager;
		if (!manager?.isAliveEnemy(enemy)) {
			return;
		}

		// ── 유틸 원소의 DPS 항이 기대는 "한 방" 평균 (지수이동평균, 할당 없음)
		this.avgHitDamage = this.avgHitDamage > 0
			? this.avgHitDamage * 0.9 + damage * 0.1
			: damage;

		// ── 피 5: 흡혈한 만큼 피가 끓어오른다 (tickBlood 에서 터진다)
		if (this.has('blood.sanguineBurst')) {
			const lifesteal = (scene.player?.lifesteal ?? 0)
				+ (scene.augmentSystem?.lifestealPct ?? 0);
			if (lifesteal > 0) {
				this.bloodCharge += damage * lifesteal * BLOOD_BURST_RATIO;
			}
		}

		const status = scene.statusEffects;

		// ── 번개 4: 감전
		if (this.has('electric.shock') && Math.random() < 0.20) {
			status?.shock(enemy, 2200, 400);
		}

		// ── 피 4: 출혈 (움직이는 동안 지속 피해)
		if (this.has('blood.bleed')) {
			status?.bleed(enemy, Math.max(4, Math.round(damage * 0.18)), 3000);
		}

		// ── 얼음 4: 감속 중첩 → 빙결
		if (this.has('ice.freeze') && (enemy.slowUntil ?? 0) > now) {
			if ((enemy.setSlowStackAt ?? 0) < now - 120) {
				enemy.setSlowStackAt = now;
				enemy.setSlowStacks = (enemy.setSlowStacks ?? 0) + 1;
				if (enemy.setSlowStacks >= 3 && status?.freeze(enemy, 1200)) {
					enemy.setSlowStacks = 0;
				}
			}
		}

		// ── 얼음 5: 빙결된 적 타격 시 파편 폭발
		if (this.has('ice.shatter') && (enemy.setFrozenUntil ?? 0) > now) {
			this.shatterFX(enemy);
			for (const other of this.inRadius(enemy.x, enemy.y, 110)) {
				if (other === enemy) {
					continue;
				}
				manager.takeDamage(other, Math.max(6, Math.round(damage * 0.45)), scene.player, { damageType: 'magic', pen: 0.2 });
			}
		}

		// ── 독 5: 중독 중첩
		if (this.has('poison.stack5') && (enemy.dotUntil ?? 0) > now && (enemy.setPoisonStackAt ?? 0) < now - 250) {
			enemy.setPoisonStackAt = now;
			status?.poisonStack(enemy, 5);
			enemy.dotDps = (enemy.dotDps ?? 0) + this.flat(2.5);
		}

		// ── 공허 4: 균열
		if (this.has('void.rift') && Math.random() < 0.12) {
			this.spawnRift(enemy.x, enemy.y, false);
		}

		// ── 공허 6: 소멸 (처형)
		if (this.has('void.annihilate') && !enemy.catalog?.isBoss && !enemy.catalog?.isReaper) {
			const threshold = this.has('void.singularity') ? 0.20 : 0.12;
			if (enemy.maxHp > 0 && enemy.hp / enemy.maxHp <= threshold) {
				this.annihilateFX(enemy);
				this.spawnRift(enemy.x, enemy.y, false);
				manager.takeDamage(enemy, enemy.hp + 1, scene.player, { ignoreResist: true, silent: true });
				return;
			}
		}

		// ── 황금 7: 미다스의 손
		if (this.has('gold.midas') && !enemy.catalog?.isBoss && !enemy.catalog?.isReaper && Math.random() < 0.03) {
			this.midasFX(enemy);
			const drops = 4 + Math.floor(Math.random() * 4);
			for (let i = 0; i < drops; i += 1) {
				scene.pickupSystem?.spawnItem?.(
					enemy.x + (Math.random() - 0.5) * 44,
					enemy.y + (Math.random() - 0.5) * 44,
					'gold', 1,
				);
			}
			manager.takeDamage(enemy, enemy.hp + 1, scene.player, { ignoreResist: true, silent: true });
		}
	}

	/** 황금 6: 다음 타격을 확정 치명타로 만들지 여부 (hitResolution 이 소비하고 소모한다). */
	consumeBlessing(): boolean {
		if (!this.blessingReady) {
			return false;
		}
		this.blessingReady = false;
		const player = this.scene.player;
		const fx = this.scene.visualEffects;
		if (player && fx && !reduceMotion()) {
			for (let i = 0; i < 5; i += 1) {
				fx.fxDiamond(player.x + (Math.random() - 0.5) * 60, player.y - 10, {
					r: 7, color: 0xd9a83c, alpha: 0.95, dy: -30, dur: 460,
				});
			}
			this.scene.pickupSystem?.spawnItem?.(player.x, player.y, 'gold', 5);
		}
		return true;
	}

	// ------------------------------------------------------------------
	// 온-처치 (EnemyManager.die 가 호출)
	// ------------------------------------------------------------------

	onEnemyKilled(enemy: EnemySprite): void {
		if (this.destroyed || this.skills.size === 0) {
			return;
		}
		const scene = this.scene;
		const manager = scene.enemyManager;
		const now = scene.time?.now ?? 0;
		if (!manager) {
			return;
		}
		const burning = (enemy.dotUntil ?? 0) > now;

		// ── 불 4: 작열
		if (this.has('fire.scorch') && burning) {
			this.scorchFX(enemy.x, enemy.y);
			for (const other of this.inRadius(enemy.x, enemy.y, 90)) {
				manager.takeDamage(other, this.flat(18 + Math.round(12 * (this.tierOf('fire') - 3))), scene.player,
					{ damageType: 'magic', pen: 0.2 });
				manager.applyDot(other, 8 * this.mods.dotMult, 1800, 0xf97316);
			}
		}

		// ── 독 4: 전염
		if (this.has('poison.contagion') && burning) {
			this.contagionFX(enemy.x, enemy.y);
			for (const other of this.inRadius(enemy.x, enemy.y, 130)) {
				manager.applyDot(other, (enemy.dotDps ?? 8) * 0.8, 2600, 0x84b04a);
				other.setPoisonStacks = Math.max(other.setPoisonStacks ?? 0, Math.floor((enemy.setPoisonStacks ?? 0) / 2));
			}
		}

		// ── 번개 7: 폭풍 (감전 전파)
		if (this.has('electric.tempest') && (enemy.setShockUntil ?? 0) > now) {
			let spread = 0;
			for (const other of this.inRadius(enemy.x, enemy.y, 170)) {
				if (spread >= 3) {
					break;
				}
				spread += 1;
				scene.statusEffects?.shock(other, 2200);
				this.boltFX(enemy.x, enemy.y, other.x, other.y, 0x93c5fd);
			}
		}

		// ── 얼음 7: 빙결 적 처치 시 냉기 폭발
		if (this.has('ice.permafrost') && (enemy.setFrozenUntil ?? 0) > now) {
			this.shatterFX(enemy);
			for (const other of this.inRadius(enemy.x, enemy.y, 150)) {
				manager.takeDamage(other, this.flat(26), scene.player, { damageType: 'magic', pen: 0.25 });
				scene.statusEffects?.slow(other, 0.55, 1800);
			}
		}

		// ── 피 6: 피의 갈증
		if (this.has('blood.thirst')) {
			this.thirstStacks = Math.min(3, this.thirstStacks + 1);
			this.thirstUntil = now + 2000;
			const player = scene.player;
			if (player && !player.isDead) {
				healWithinBudget(player, Math.round(2 * hpScaleOf(player.maxHp)), now);
			}
		}

		// ── 황금 5: 금화 추가 드랍
		if (this.mods.goldDropChance > 0 && Math.random() < this.mods.goldDropChance) {
			scene.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', 1);
		}
	}

	/** 세트 스킬의 고정 피해 수치를 현재 피해 규모로 환산 (logic/growth.ts · SwordOrbitSystem.flatDamageScale). */
	private flat(base: number): number {
		return Math.max(1, Math.round(base * (this.scene.swordOrbit?.flatDamageScale?.() ?? 1)));
	}

	/** 플레이어가 피격됐을 때 (GameScene 의 피해 처리에서 호출). */
	onPlayerHurt(): void {
		if (this.destroyed) {
			return;
		}
		const now = this.scene.time?.now ?? 0;
		this.lastHurtAt = now;

		// ── 얼음 6: 서리 갑옷
		if (this.has('ice.frostArmor')) {
			const player = this.scene.player;
			const manager = this.scene.enemyManager;
			if (player && manager) {
				this.frostArmorFX();
				for (const other of this.inRadius(player.x, player.y, 180)) {
					manager.takeDamage(other, this.flat(22), player, { damageType: 'magic', pen: 0.2 });
					this.scene.statusEffects?.slow(other, 0.5, 1600);
				}
			}
		}
	}

	/** 골드 획득 시 (PickupSystem.addGold 가 호출) — 황금 4단계 누적 + 5단계 벼락 장전. */
	onGoldEarned(amount: number): void {
		if (this.has('gold.greed')) {
			this.goldEarned += amount;
		}
		if (this.has('gold.coinstrike')) {
			this.coinCharge += amount;
		}
	}

	// ------------------------------------------------------------------
	// 동적 피해 보정 (hitResolution / applyDamage 가 곱한다)
	// ------------------------------------------------------------------

	/** 세트에서 오는 실시간 검 피해 배율 (탐욕·혈계·질풍·저체력 광폭). */
	dynamicDamageMult(): number {
		if (this.skills.size === 0) {
			return 1;
		}
		let mult = 1;
		const player = this.scene.player;

		if (this.has('gold.greed')) {
			mult *= 1 + Math.min(0.30, Math.floor(this.goldEarned / 100) * 0.01);
		}
		if (player && player.maxHp > 0) {
			const missing = 1 - player.hp / player.maxHp;
			if (this.has('blood.bloodline')) {
				mult *= 1 + missing * 0.8;
			}
			if (this.has('blood.lowHpRage') && player.hp / player.maxHp <= 0.5) {
				mult *= 1.20;
			}
		}
		if (this.galeActive) {
			mult *= 1.20;
		}
		if (this.thirstStacks > 0) {
			mult *= 1 + this.thirstStacks * 0.04;
		}
		return mult;
	}

	/** 세트에서 오는 실시간 쿨다운 배율 (피의 갈증 가속). */
	dynamicCooldownMult(): number {
		return this.thirstStacks > 0 ? 1 - this.thirstStacks * 0.08 : 1;
	}

	/** 혈계: 회복량 감소. */
	healMultiplier(): number {
		return this.has('blood.bloodline') ? 0.7 : 1;
	}

	/** 폭풍의 눈: 투사체 무효 확률. */
	projectileNegateChance(): number {
		return this.has('wind.eyeOfStorm') ? 0.25 : 0;
	}

	// ------------------------------------------------------------------
	// 매 프레임
	// ------------------------------------------------------------------

	update(delta: number): void {
		if (this.destroyed) {
			return;
		}
		const scene = this.scene;
		const player = scene.player;
		const now = scene.time?.now ?? 0;

		// 만료 상태 정리
		if (this.thirstStacks > 0 && now > this.thirstUntil) {
			this.thirstStacks = 0;
		}
		this.galeActive = this.has('wind.gale') && now - this.lastHurtAt > 3000;

		this.updateRifts(now);

		if (!player || player.isDead || this.skills.size === 0) {
			return;
		}

		// ── 혈계: 초당 체력이 마르지는 않지만 회복이 줄어든다 (healMultiplier 에서 처리)
		// ── 바람 6: 질풍 이속 (직접 곱하지 않고 이동 처리에서 소비)

		this.tickFire(delta, now, player);
		this.tickElectric(delta, now, player);
		this.tickIce(delta, now, player);
		this.tickPoison(delta, now, player);
		this.tickGold(delta, now);
		this.tickWind(delta, now, player);
		this.tickVoid(delta, now, player);
		this.tickBleed(now);
		this.tickBlood(delta);
	}

	// ── 불
	private tickFire(delta: number, now: number, player: PlayerSprite): void {
		const manager = this.scene.enemyManager;
		if (!manager) {
			return;
		}

		if (this.has('fire.ring')) {
			this.tFireRing += delta;
			if (this.tFireRing >= 500) {
				this.tFireRing = 0;
				const targets = this.inRadius(player.x, player.y, 100);
				for (const enemy of targets) {
					manager.applyDot(enemy, this.flat(10) * this.mods.dotMult, 1400, 0xf97316);
				}
				this.fireRingFX(player, targets.length);
			}
		}

		if (this.has('fire.conflagration')) {
			this.tConflagration += delta;
			if (this.tConflagration >= 3000) {
				this.tConflagration = 0;
				let burning = 0;
				for (const enemy of this.inRadius(player.x, player.y, 420)) {
					if ((enemy.dotUntil ?? 0) > now) {
						burning += 1;
					}
				}
				if (burning >= 5) {
					this.conflagrationFX(player);
					for (const enemy of this.inRadius(player.x, player.y, 300)) {
						manager.takeDamage(enemy, this.flat(55), player, { damageType: 'magic', pen: 0.3 });
						manager.applyDot(enemy, this.flat(16) * this.mods.dotMult, 2400, 0xf97316);
					}
				}
			}
		}
	}

	// ── 번개
	private tickElectric(delta: number, _now: number, player: PlayerSprite): void {
		if (!this.has('electric.staticField')) {
			return;
		}
		const manager = this.scene.enemyManager;
		if (!manager) {
			return;
		}
		this.tStaticField += delta;
		if (this.tStaticField < 3000) {
			return;
		}
		this.tStaticField = 0;

		const targets = this.inRadius(player.x, player.y, 260);
		if (targets.length === 0) {
			return;
		}
		this.staticFieldFX(player);
		let prevX = player.x;
		let prevY = player.y;
		let bolts = 0;
		for (const enemy of targets) {
			manager.takeDamage(enemy, this.flat(34), player, { damageType: 'magic', pen: 0.3 });
			this.scene.statusEffects?.shock(enemy, 1600);
			if (bolts < 10) {
				bolts += 1;
				this.boltFX(prevX, prevY, enemy.x, enemy.y, 0x93c5fd);
				prevX = enemy.x;
				prevY = enemy.y;
			}
		}
	}

	// ── 얼음
	private tickIce(delta: number, now: number, player: PlayerSprite): void {
		if (!this.has('ice.permafrost')) {
			return;
		}
		this.tPermafrost += delta;
		if (this.tPermafrost < 700) {
			return;
		}
		this.tPermafrost = 0;
		for (const enemy of this.inRadius(player.x, player.y, 700)) {
			if ((enemy.slowUntil ?? 0) > now) {
				continue;
			}
			// 상시 유지되는 약한 장판이라 개체별 발동 연출은 끈다 (플레이어 중심 링만)
			this.scene.statusEffects?.slow(enemy, 0.2, 900, { fx: false });
		}
		this.permafrostFX(player);
	}

	// ── 독
	private tickPoison(delta: number, now: number, player: PlayerSprite): void {
		if (!this.has('poison.plague')) {
			return;
		}
		const manager = this.scene.enemyManager;
		if (!manager) {
			return;
		}
		this.tPlague += delta;
		if (this.tPlague < 1000) {
			return;
		}
		this.tPlague = 0;
		for (const enemy of this.inRadius(player.x, player.y, 620)) {
			if ((enemy.setPoisonStacks ?? 0) < 5 || (enemy.dotUntil ?? 0) <= now) {
				continue;
			}
			const tick = Math.max(2, Math.round(enemy.maxHp * 0.015));
			manager.takeDamage(enemy, tick, player, { ignoreResist: true, silent: true });
			this.scene.visualEffects?.showStatusDamageText(enemy.x, enemy.y - 16, tick, 'poison');
			if (!reduceMotion()) {
				this.scene.visualEffects?.fxDot(enemy.x, enemy.y - 12, {
					r: 6, color: 0x84b04a, alpha: 0.6, scale1: 1.8, dur: 420,
				});
			}
		}
	}

	// ── 황금
	private tickGold(delta: number, _now: number): void {
		// ── 황금 5: 금화 벼락 (주운 재화가 그대로 화력이 된다)
		if (this.coinCharge > 0) {
			this.tCoinStrike += delta;
			if (this.tCoinStrike >= COIN_STRIKE_MS) {
				this.tCoinStrike = 0;
				this.coinStrike();
			}
		}

		if (!this.has('gold.blessing')) {
			return;
		}
		this.tGoldBlessing += delta;
		if (this.tGoldBlessing >= 15000 && !this.blessingReady) {
			this.tGoldBlessing = 0;
			this.blessingReady = true;
			const player = this.scene.player;
			if (player && !reduceMotion()) {
				this.scene.visualEffects?.fxRing(player.x, player.y, {
					r0: 30, r1: 70, w: 3, color: 0xd9a83c, alpha: 0.9, dur: 520,
				});
			}
		}
	}

	/**
	 * 장전된 금화를 벼락으로 떨어뜨린다 (황금 5세트).
	 * 피해는 "지금 이 빌드의 한 방"(avgHitDamage)에 비례하므로 후반에도 뒤처지지 않는다.
	 */
	private coinStrike(): void {
		const manager = this.scene.enemyManager;
		const player = this.scene.player;
		const coins = Math.min(COIN_STRIKE_MAX, this.coinCharge);
		this.coinCharge = 0;
		if (!manager || !player || this.avgHitDamage <= 0) {
			return;
		}
		// 가장 가까운 적 위로 떨어진다 — 대상 질의는 프레임당 1회, 버퍼 재사용.
		const nearby = this.inRadius(player.x, player.y, 420);
		if (nearby.length === 0) {
			return;
		}
		let target = nearby[0];
		let bestDistance = Infinity;
		for (const enemy of nearby) {
			const dx = enemy.x - player.x;
			const dy = enemy.y - player.y;
			const distance = dx * dx + dy * dy;
			if (distance < bestDistance) {
				bestDistance = distance;
				target = enemy;
			}
		}
		const damage = Math.max(4, Math.round(this.avgHitDamage * COIN_STRIKE_RATIO * coins));
		const x = target.x;
		const y = target.y;
		// nearby(=TARGETS 공유 버퍼)는 다음 질의에서 덮어써진다 — 좌표를 먼저 떠 둔다.
		for (const enemy of this.inRadius(x, y, COIN_STRIKE_RADIUS)) {
			manager.takeDamage(enemy, damage, player, { damageType: 'physical', pen: 0.15 });
		}
		this.coinStrikeFX(x, y);
	}

	/** 끓어오른 피를 터뜨린다 (피 5세트). */
	private tickBlood(delta: number): void {
		if (this.bloodCharge <= 0) {
			return;
		}
		this.tBloodBurst += delta;
		if (this.tBloodBurst < BLOOD_BURST_MS) {
			return;
		}
		this.tBloodBurst = 0;
		const damage = Math.round(this.bloodCharge);
		this.bloodCharge = 0;
		const manager = this.scene.enemyManager;
		const player = this.scene.player;
		if (!manager || !player || damage < 2) {
			return;
		}
		for (const enemy of this.inRadius(player.x, player.y, BLOOD_BURST_RADIUS)) {
			manager.takeDamage(enemy, damage, player, { damageType: 'physical', pen: 0.1 });
		}
		this.bloodBurstFX(player.x, player.y);
	}

	// ── 바람
	private tickWind(delta: number, now: number, player: PlayerSprite): void {
		const manager = this.scene.enemyManager;
		if (!manager) {
			return;
		}

		if (this.has('wind.slipstream')) {
			this.tWindTrail += delta;
			if (this.tWindTrail >= 140) {
				this.tWindTrail = 0;
				const body = player.body as Phaser.Physics.Arcade.Body | null;
				const moving = body ? Math.abs(body.velocity.x) + Math.abs(body.velocity.y) > 20 : false;
				if (moving) {
					if (this.trails.length >= 14) {
						this.trails.shift();
					}
					this.trails.push({ x: player.x, y: player.y, until: now + 2200 });
					if (!reduceMotion()) {
						this.scene.visualEffects?.fxArc(player.x, player.y, {
							r: 18, a0: 0, a1: Math.PI * 1.6, color: 0x9fd8c0, w: 2, alpha: 0.55, dur: 480, spin: 3,
						});
					}
				}
			}
			// 자국 판정
			for (let i = this.trails.length - 1; i >= 0; i -= 1) {
				const trail = this.trails[i];
				if (now > trail.until) {
					this.trails.splice(i, 1);
					continue;
				}
				for (const enemy of this.inRadius(trail.x, trail.y, 34)) {
					if ((enemy.setWindHitAt ?? 0) > now - 500) {
						continue;
					}
					enemy.setWindHitAt = now;
					manager.takeDamage(enemy, this.flat(16), player, { damageType: 'physical', pen: 0.1 });
					const angle = Phaser.Math.Angle.Between(trail.x, trail.y, enemy.x, enemy.y);
					if (!enemy.catalog?.isBoss) {
						enemy.setVelocity(Math.cos(angle) * 260, Math.sin(angle) * 260);
						enemy.knockbackUntil = now + 180;
					}
				}
			}
		}

		if (this.has('wind.eyeOfStorm')) {
			this.tEyeOfStorm += delta;
			if (this.tEyeOfStorm >= 600) {
				this.tEyeOfStorm = 0;
				this.eyeOfStormFX(player);
				for (const enemy of this.inRadius(player.x, player.y, 150)) {
					manager.takeDamage(enemy, this.flat(20), player, { damageType: 'physical', pen: 0.15 });
					if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
						continue;
					}
					const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
					enemy.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300);
					enemy.knockbackUntil = now + 160;
				}
			}
		}
	}

	// ── 공허
	private tickVoid(delta: number, _now: number, player: PlayerSprite): void {
		if (!this.has('void.singularity')) {
			return;
		}
		this.tSingularity += delta;
		if (this.tSingularity < 15000) {
			return;
		}
		this.tSingularity = 0;
		const anchor = this.scene.swordOrbit?.findNearestEnemy?.(player.x, player.y, this.scene.swordOrbit.enemyGroup, 450);
		this.spawnRift(anchor?.x ?? player.x + 160, anchor?.y ?? player.y, true);
	}

	// ── 출혈 틱 (피 4단계) — 움직이는 적만
	private tickBleed(now: number): void {
		if (!this.has('blood.bleed')) {
			return;
		}
		const manager = this.scene.enemyManager;
		const player = this.scene.player;
		if (!manager || !player) {
			return;
		}
		for (const enemy of this.inRadius(player.x, player.y, 700)) {
			if ((enemy.setBleedUntil ?? 0) <= now) {
				continue;
			}
			if ((enemy.setBleedTick ?? 0) > now - 500) {
				continue;
			}
			const body = enemy.body as Phaser.Physics.Arcade.Body | null;
			const moving = body ? Math.abs(body.velocity.x) + Math.abs(body.velocity.y) > 24 : true;
			if (!moving) {
				continue;
			}
			enemy.setBleedTick = now;
			const tick = Math.max(2, Math.round((enemy.setBleedDps ?? 6) * 0.5));
			manager.takeDamage(enemy, tick, player, { damageType: 'physical', silent: true });
			this.scene.visualEffects?.showStatusDamageText(enemy.x, enemy.y - 16, tick, 'bleed');
			if (!reduceMotion() && Math.random() < 0.5) {
				this.scene.visualEffects?.fxDot(enemy.x, enemy.y, {
					r: 2.5, color: 0xc9455a, alpha: 0.9, scale1: 0.6,
					dx: (Math.random() - 0.5) * 26, dy: 18, dur: 380,
				});
			}
		}
	}

	// ------------------------------------------------------------------
	// 균열 (공허)
	// ------------------------------------------------------------------

	private spawnRift(x: number, y: number, big: boolean): void {
		if (this.rifts.length >= 8) {
			this.rifts.shift();
		}
		const now = this.scene.time?.now ?? 0;
		this.rifts.push({
			x, y,
			at: now + (big ? 900 : 800),
			radius: big ? 300 : 150,
			damage: big ? 90 : 40,
			big,
		});
		this.riftChargeFX(x, y, big);
	}

	private updateRifts(now: number): void {
		if (this.rifts.length === 0) {
			return;
		}
		const manager = this.scene.enemyManager;
		const player = this.scene.player;
		for (let i = this.rifts.length - 1; i >= 0; i -= 1) {
			const rift = this.rifts[i];
			if (now < rift.at) {
				continue;
			}
			this.rifts.splice(i, 1);
			if (!manager) {
				continue;
			}
			this.riftBurstFX(rift.x, rift.y, rift.big);
			for (const enemy of this.inRadius(rift.x, rift.y, rift.radius)) {
				manager.takeDamage(enemy, rift.damage, player, { damageType: 'magic', pen: 0.45 });
				if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
					continue;
				}
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, rift.x, rift.y);
				enemy.setVelocity(Math.cos(angle) * (rift.big ? 460 : 320), Math.sin(angle) * (rift.big ? 460 : 320));
				enemy.knockbackUntil = now + 240;
			}
		}
	}

	// ------------------------------------------------------------------
	// 유틸
	// ------------------------------------------------------------------

	/** 반경 안의 살아 있는 적 목록 (호출 간 재사용되는 버퍼 — 즉시 소비할 것). */
	private inRadius(x: number, y: number, radius: number): EnemySprite[] {
		TARGETS.length = 0;
		const manager = this.scene.enemyManager;
		if (!manager) {
			return TARGETS;
		}
		const radiusSquared = radius * radius;
		const candidates = manager.queryRadius
			? manager.queryRadius(x, y, radius, QUERY)
			: (manager.enemies.getChildren() as EnemySprite[]);
		for (const enemy of candidates) {
			if (!manager.isAliveEnemy(enemy)) {
				continue;
			}
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy <= radiusSquared) {
				TARGETS.push(enemy);
			}
		}
		return TARGETS;
	}

	// ------------------------------------------------------------------
	// 연출 — 전부 공유 FX 레이어. GameObject 생성 / 트윈 없음.
	// ------------------------------------------------------------------

	// 감전·빙결의 발동 연출은 StatusEffectSystem 으로 옮겼다 (부여와 연출을 한곳에 묶기 위해).

	private boltFX(x0: number, y0: number, x1: number, y1: number, color: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		const points: number[] = [];
		const steps = 5;
		for (let i = 0; i <= steps; i += 1) {
			const t = i / steps;
			const jitter = i === 0 || i === steps ? 0 : 18;
			points.push(x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter,
				y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitter);
		}
		fx.fxPoly(points, { layers: [[6, 0x1e3a5f, 0.35], [2.6, color, 0.9], [1, 0xffffff, 0.95]], dur: 220 });
	}

	private shatterFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(enemy.x, enemy.y, { r0: 14, r1: 110, w: 3, color: 0xbfe6f2, alpha: 0.9, dur: 340 });
		for (let i = 0; i < 9; i += 1) {
			const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
			fx.fxDiamond(enemy.x, enemy.y, {
				r: 5 + Math.random() * 3, color: 0xdff3fa, alpha: 0.95, dur: 380,
			});
			fx.fxDot(enemy.x, enemy.y, {
				r: 3, color: 0xbfe6f2, alpha: 0.9, scale1: 0.3,
				dx: Math.cos(a) * 90, dy: Math.sin(a) * 90, dur: 360,
			});
		}
	}

	private scorchFX(x: number, y: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxDot(x, y, { r: 20, color: 0xf97316, alpha: 0.4, scale1: 2.6, dur: 340 });
		fx.fxRing(x, y, { r0: 12, r1: 92, w: 3, color: 0xffb066, alpha: 0.9, dur: 340 });
		for (let i = 0; i < 6; i += 1) {
			const a = (i / 6) * Math.PI * 2 + Math.random();
			fx.fxDot(x, y, {
				r: 3.5, color: i % 2 ? 0xf97316 : 0xffd27a, alpha: 0.95, scale1: 0.3,
				dx: Math.cos(a) * 70, dy: Math.sin(a) * 70, dur: 400,
			});
		}
	}

	private contagionFX(x: number, y: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(x, y, { r0: 10, r1: 130, w: 2.5, color: 0x84b04a, alpha: 0.8, dash: 10, dur: 480 });
		for (let i = 0; i < 5; i += 1) {
			fx.fxDot(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90, {
				r: 12 + Math.random() * 10, color: 0x84b04a, alpha: 0.3, scale1: 1.7, dur: 700,
			});
		}
	}

	private fireRingFX(player: PlayerSprite, hits: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		// 일렁이는 불 고리 — 반경을 흔들어 살아 있는 느낌을 준다
		fx.fxRing(player.x, player.y, { r0: 92, r1: 104, w: 4, color: 0xf97316, alpha: 0.55, dur: 480 });
		const flames = hits > 0 ? 5 : 3;
		for (let i = 0; i < flames; i += 1) {
			const a = Math.random() * Math.PI * 2;
			fx.fxDot(player.x + Math.cos(a) * 96, player.y + Math.sin(a) * 96, {
				r: 5, color: 0xffb066, alpha: 0.85, scale1: 0.2, dy: -22, dur: 420,
			});
		}
	}

	private conflagrationFX(player: PlayerSprite): void {
		const fx = this.scene.visualEffects;
		if (!fx) {
			return;
		}
		this.scene.soundSystem?.play('bigkill', { volume: 0.55 });
		if (reduceMotion()) {
			return;
		}
		// 3중 확장 링 + 하늘로 솟는 불기둥 파편
		for (let i = 0; i < 3; i += 1) {
			fx.fxRing(player.x, player.y, {
				r0: 40 + i * 30, r1: 300, w: 5 - i, color: i === 1 ? 0xffd27a : 0xf97316,
				alpha: 0.85 - i * 0.15, dur: 520 + i * 120,
			});
		}
		for (let i = 0; i < 14; i += 1) {
			const a = (i / 14) * Math.PI * 2;
			const dist = 120 + Math.random() * 160;
			fx.fxDot(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist, {
				r: 7, color: 0xf97316, alpha: 0.9, scale1: 0.2, dy: -50, dur: 560,
			});
		}
	}

	private staticFieldFX(player: PlayerSprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(player.x, player.y, { r0: 30, r1: 260, w: 3, color: 0x93c5fd, alpha: 0.8, dur: 380 });
		// 각진 방전 아크 4개
		for (let i = 0; i < 4; i += 1) {
			const a = Math.random() * Math.PI * 2;
			fx.fxArc(player.x, player.y, {
				r: 60 + Math.random() * 60, a0: a, a1: a + 0.9, color: 0xdbeafe, w: 2.5, alpha: 0.85, dur: 300, spin: 4,
			});
		}
		this.scene.soundSystem?.play('crit', { volume: 0.35 });
	}

	private permafrostFX(player: PlayerSprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(player.x, player.y, { r0: 120, r1: 340, w: 1.5, color: 0x8fc3d8, alpha: 0.28, dash: 16, dur: 900 });
	}

	private frostArmorFX(): void {
		const player = this.scene.player;
		const fx = this.scene.visualEffects;
		if (!player || !fx || reduceMotion()) {
			return;
		}
		fx.fxRing(player.x, player.y, { r0: 16, r1: 180, w: 4, color: 0xbfe6f2, alpha: 0.9, dur: 400 });
		for (let i = 0; i < 8; i += 1) {
			const a = (i / 8) * Math.PI * 2;
			fx.fxDiamond(player.x + Math.cos(a) * 60, player.y + Math.sin(a) * 60, {
				r: 8, color: 0xdff3fa, alpha: 0.9, dur: 420, fill: true,
			});
		}
	}

	/** 황금 5: 금화 벼락 — 금빛 낙하선 + 착탄 고리. */
	private coinStrikeFX(x: number, y: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(x, y, { r0: 6, r1: COIN_STRIKE_RADIUS, w: 3, color: 0xd9a83c, alpha: 0.85, dur: 340 });
		fx.fxDiamond(x, y - 40, { r: 7, color: 0xffe9b3, alpha: 0.95, dy: 40, dur: 240 });
	}

	/** 피 5: 끓은 피 폭발 — 붉은 고리 + 튀는 방울. */
	private bloodBurstFX(x: number, y: number): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		fx.fxRing(x, y, { r0: 10, r1: BLOOD_BURST_RADIUS, w: 3, color: 0xc9455a, alpha: 0.8, dur: 320 });
		for (let i = 0; i < 4; i += 1) {
			const a = (i / 4) * Math.PI * 2;
			fx.fxDot(x + Math.cos(a) * 22, y + Math.sin(a) * 22, {
				r: 3.5, color: 0xe06a7c, alpha: 0.9, scale1: 0.4,
				dx: Math.cos(a) * 50, dy: Math.sin(a) * 50, dur: 340,
			});
		}
	}

	private midasFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx) {
			return;
		}
		this.scene.soundSystem?.play('chest', { volume: 0.6 });
		if (reduceMotion()) {
			return;
		}
		// 금빛이 위에서 아래로 덮는 연출 + 사방 금화
		fx.fxDot(enemy.x, enemy.y, { r: 26, color: 0xd9a83c, alpha: 0.75, scale1: 0.2, dur: 420 });
		fx.fxRing(enemy.x, enemy.y, { r0: 8, r1: 70, w: 3.5, color: 0xf2d488, alpha: 0.95, dur: 420 });
		for (let i = 0; i < 8; i += 1) {
			const a = (i / 8) * Math.PI * 2;
			fx.fxDiamond(enemy.x + Math.cos(a) * 26, enemy.y + Math.sin(a) * 26, {
				r: 6, color: 0xffe9b3, alpha: 0.95, dy: -24, dur: 520,
			});
		}
	}

	private annihilateFX(enemy: EnemySprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		// 안쪽으로 빨려들어 사라지는 연출
		fx.fxRing(enemy.x, enemy.y, { r0: 60, r1: 4, w: 3, color: 0xa78bda, alpha: 0.95, dur: 260 });
		fx.fxDot(enemy.x, enemy.y, { r: 18, color: 0x241a33, alpha: 0.9, scale1: 0.1, dur: 260, ease: 'in' });
	}

	private riftChargeFX(x: number, y: number, big: boolean): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		const r = big ? 300 : 150;
		// 예고: 수축하는 점선 링 + 중심 코어
		fx.fxRing(x, y, { r0: r, r1: r * 0.35, w: 2, color: 0xa78bda, alpha: 0.7, dash: 14, dur: big ? 900 : 800 });
		fx.fxDot(x, y, { r: 6, color: 0x8d7bb5, alpha: 0.8, scale1: big ? 3.2 : 2.2, dur: big ? 900 : 800 });
	}

	private riftBurstFX(x: number, y: number, big: boolean): void {
		const fx = this.scene.visualEffects;
		if (!fx) {
			return;
		}
		this.scene.soundSystem?.play(big ? 'bigkill' : 'warning', { volume: big ? 0.6 : 0.35 });
		if (reduceMotion()) {
			return;
		}
		const r = big ? 300 : 150;
		fx.fxDot(x, y, { r: big ? 30 : 16, color: 0x241a33, alpha: 0.95, scale1: 2.4, dur: 520, ease: 'in' });
		fx.fxRing(x, y, { r0: 10, r1: r, w: 4, color: 0xa78bda, alpha: 0.95, dur: 460 });
		fx.fxRing(x, y, { r0: r, r1: 20, w: 2, color: 0xd8c8f5, alpha: 0.7, dur: 420 });
		const spokes = big ? 14 : 8;
		for (let i = 0; i < spokes; i += 1) {
			const a = (i / spokes) * Math.PI * 2;
			fx.fxPoly(
				[x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r * 0.55), y + Math.sin(a) * (r * 0.55)],
				{ layers: [[2.5, 0xa78bda, 0.85]], dur: 320 },
			);
		}
	}

	private eyeOfStormFX(player: PlayerSprite): void {
		const fx = this.scene.visualEffects;
		if (!fx || reduceMotion()) {
			return;
		}
		for (let i = 0; i < 2; i += 1) {
			fx.fxArc(player.x, player.y, {
				r: 100 + i * 30, a0: i * 2, a1: i * 2 + 2.4, color: 0x9fd8c0, w: 3, alpha: 0.7, dur: 620, spin: 5,
			});
		}
	}

	// ------------------------------------------------------------------

	/** 세이브/로드용 스냅샷. */
	snapshot(): { goldEarned: number; announced: string[] } {
		return { goldEarned: this.goldEarned, announced: [...this.announced] };
	}

	restore(data: { goldEarned?: number; announced?: string[] } | undefined): void {
		if (!data) {
			return;
		}
		this.goldEarned = data.goldEarned ?? 0;
		this.announced = new Set(data.announced ?? []);
	}

	destroy(): void {
		this.destroyed = true;
		this.rifts.length = 0;
		this.trails.length = 0;
	}
}
