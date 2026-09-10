// 스킬 트리 런타임 (2026-09-04)
//
// 데이터/순수 규칙은 src/logic/skillTree.ts, 핫키 저장은 src/core/skillHotbar.ts.
// 이 시스템은
//   1) 배운 노드 집합 · 포인트(레벨에서 유도) · 배우기
//   2) 패시브 합산(TreeMods)을 플레이어/궤도/진행도에 **되돌릴 수 있게** 적용 (ElementSetSystem 방식)
//   3) 트리 능동 스킬 11종의 발동·쿨다운·지속 효과 (핫키 → castNode)
//   4) 다른 시스템이 부르는 훅: onPlayerHurt / onRoundStart / onUltCast / onDash / consumeUnyielding
// 을 맡는다. 기본 능동 4종(활공·귀소·대시·필살기)은 ActiveSkillSystem 이 그대로 담당하고,
// 트리는 그쪽 숙련 단계(levels)·쿨다운 배율·시너지 값을 mods 로 넘겨준다.
//
// 규칙: 연출은 공유 FX 레이어(fx*)만. 핫패스(update)에서 배열/객체 생성 금지 (버퍼 재사용).

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import { GameEvents } from '../core/events';
import { screenShakeEnabled } from '../core/settings';
import type { UltimateElement } from './sword/types';
import {
	activeAt, aggregateTreeModsLeveled, availablePointsLeveled, canLevelUp, costPerLevel, emptyTreeMods,
	maxLevelOf, sanitizeLearned, sanitizeLevels, skillNode, SKILL_BRANCHES, SKILL_NODES,
	type LearnBlock, type SkillActiveSpec, type SkillLevels, type SkillNode, type TreeMods,
} from '../logic/skillTree';
import { autoAssignKey, onHotbarChanged, skillKeyCode } from '../core/skillHotbar';
import { reduceMotion } from '../core/settings';

const QUERY: EnemySprite[] = [];

interface Zone {
	x: number; y: number; radius: number; until: number; tickAt: number; dps: number; fxAt: number;
	/** 장판 루프 스프라이트 (있으면 90ms 재스탬프 대신 이걸 켜 둔다 — CPU가 오히려 준다).
	 *  루프는 스스로 끝나지 않으므로 지속 종료 시 반드시 fxSpriteStop 으로 꺼야 한다. */
	sprite?: Phaser.GameObjects.Sprite | null;
}
interface Bomb { x: number; y: number; at: number; radius: number; damage: number; fxAt: number }

export default class SkillTreeSystem {
	scene: GameScene;
	/** 노드 레벨 (0 이면 안 배운 것) — 진실의 원천 */
	levels: SkillLevels = {};
	/** 레벨 1 이상인 노드 id (levels 와 항상 동기) */
	learned = new Set<string>();
	/** 이벤트/보상으로 얻은 추가 포인트 */
	bonusPoints = 0;
	/** 합산 패시브 */
	mods: TreeMods = emptyTreeMods();
	private applied: TreeMods | null = null;
	private appliedBonusHits = 0;
	private appliedCleave = 0;
	private appliedDiscount = 0;

	/** 트리 능동 스킬 쿨다운 (nodeId → 사용 가능 시각) */
	readyAt: Record<string, number> = {};
	useCount: Record<string, number> = {};

	// ── 지속 효과
	private spinUntil = 0;
	private spinOrbitSpeedMult = 1;
	private spinDamageMult = 1;
	private stormUntil = 0;
	private stormPrevTwin = 0;
	private regenUntil = 0;
	private regenPctPerSec = 0;
	private zones: Zone[] = [];
	private bombs: Bomb[] = [];
	private lureUntil = 0;
	private lureX = 0;
	private lureY = 0;
	private lureFxAt = 0;
	goldRushUntil = 0;
	/** 잔향: 이 시각까지 출격 피해 +mult */
	private counterReadyAt = 0;
	private phoenixUsedRound = -1;
	private unyieldingUsed = false;
	/** 바람의 길: 마지막 피격 시각 (무피격 n초 → 대시 초기화) */
	private lastHurtAt = 0;
	private dashResetAt = 0;
	// ── 2026-09-04 추가 갈래 상태
	private stormCallUntil = 0;
	private stormCallAt = 0;
	private stormSpec: { radius: number; damage: number } | null = null;
	private clones: Array<{ sprite: Phaser.GameObjects.Image; x: number; y: number; until: number; explodeRadius: number; damage: number; fxAt: number }> = [];
	private stealthUntil = 0;
	private stealthRadius = 0;
	private berserkUntil = 0;
	private berserkDamageAdd = 0;
	private berserkTakenMult = 1;
	private hasteStacks = 0;
	private hasteAt = 0;
	private frostAuraAt = 0;

	private destroyed = false;
	private unbindHotbar: (() => void) | null = null;

	private onKeyDown = (event: KeyboardEvent) => {
		if (event.repeat || this.destroyed) {
			return;
		}
		// 트리 능동 스킬만 (기본 4종은 ActiveSkillSystem 이 받는다)
		for (const node of this.activeNodes()) {
			if (skillKeyCode(node.id) === event.keyCode) {
				this.castNode(node.id);
				return;
			}
		}
	};

	constructor(scene: GameScene) {
		this.scene = scene;
		scene.input.keyboard?.on('keydown', this.onKeyDown);
		this.unbindHotbar = onHotbarChanged(() => { scene.activeSkills?.rebuildHud?.(); });
		// 처치 훅 (산산조각 · 처치 가속). GameScene 이 SHUTDOWN 에서 ENEMY_DIED 리스너를 통째로 뗀다.
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	private onEnemyDied = (payload: { enemy?: EnemySprite; x?: number; y?: number }) => {
		if (this.destroyed) {
			return;
		}
		const m = this.mods;
		const now = this.scene.time.now;
		const enemy = payload?.enemy;
		// 처치 가속
		if (m.killHaste) {
			if (now - this.hasteAt > m.killHaste.durationMs) {
				this.hasteStacks = 0;
			}
			this.hasteStacks = Math.min(m.killHaste.stacks, this.hasteStacks + 1);
			this.hasteAt = now;
			this.scene.activeSkills?.applySpeedBoost?.(m.killHaste.mult * this.hasteStacks, m.killHaste.durationMs);
		}
		// 산산조각: 빙결(강감속) 상태로 죽은 적이 터진다
		if (m.shatter > 0 && enemy && (enemy.slowFactor ?? 1) <= 0.3 && (enemy.slowUntil ?? 0) > now
			&& typeof payload.x === 'number' && typeof payload.y === 'number') {
			this.shatterAt(payload.x, payload.y, Math.max(1, Math.round(this.avgHit() * m.shatter)));
		}
	};

	// ------------------------------------------------------------------
	// 포인트 · 배우기
	// ------------------------------------------------------------------

	get level(): number {
		return this.scene.progression?.level ?? 1;
	}

	points(): number {
		return availablePointsLeveled(this.level, this.levels, this.bonusPoints);
	}

	/** 노드 현재 레벨 */
	levelOf(id: string): number {
		return this.levels[id] ?? 0;
	}

	canLearn(id: string): { ok: boolean; reason?: LearnBlock } {
		return canLevelUp(id, this.level, this.levels, this.bonusPoints);
	}

	/** 한 칸 올린다 (처음이면 습득). 옛 이름 유지 — 호출부가 많다. */
	learn(id: string): boolean {
		const check = this.canLearn(id);
		if (!check.ok) {
			return false;
		}
		const node = skillNode(id)!;
		const before = this.levelOf(id);
		this.levels[id] = before + 1;
		this.recompute();
		if (before === 0 && node.kind === 'active') {
			const key = autoAssignKey(id);
			// 스킬 창이 열려 있으면 창의 핫바가 키를 보여주므로 배너는 생략 (창 위로 배너가 쌓이는 것 방지)
			if (!this.scene.skillWindow?.isOpen) {
				this.scene.waveSystem?.announce?.(key ? `${node.name} 습득 — 키 [${key}]` : `${node.name} 습득 — 스킬 창에서 키를 배정하세요`, '#9bd66a');
			}
		}
		this.scene.soundSystem?.play('levelup', { volume: 0.35 });
		this.scene.activeSkills?.rebuildHud?.();
		return true;
	}

	/** 만렙까지 한꺼번에 올린다 (포인트가 닿는 데까지). 올린 칸 수를 돌려준다. */
	learnMax(id: string): number {
		let count = 0;
		while (this.learn(id)) {
			count += 1;
		}
		return count;
	}

	/** 전체 초기화 — 포인트를 모두 돌려받는다 */
	resetAll(): number {
		const refunded = this.level > 0 ? Object.keys(this.levels).length : 0;
		this.levels = {};
		this.recompute();
		this.scene.activeSkills?.rebuildHud?.();
		return refunded;
	}

	/** 트리의 모든 노드 (데이터 그대로 — 테스트·디버그용 읽기 접근) */
	allNodes(): readonly SkillNode[] {
		return SKILL_NODES;
	}

	/** 배운 능동 노드 (핫바) */
	activeNodes(): SkillNode[] {
		const out: SkillNode[] = [];
		for (const id of Object.keys(this.levels)) {
			const node = skillNode(id);
			if (node?.kind === 'active' && node.active && (this.levels[id] ?? 0) > 0) {
				out.push(node);
			}
		}
		return out;
	}

	/** 현재 레벨이 반영된 능동 스펙 */
	activeSpec(node: SkillNode): SkillActiveSpec {
		return activeAt(node, Math.max(1, this.levelOf(node.id))) ?? node.active!;
	}

	/** 세이브 복원 — 신형(레벨 맵) 우선, 없으면 구형(배운 목록 = 만렙) */
	restore(learned: string[] | undefined, bonusPoints = 0, levels?: SkillLevels): void {
		if (levels && Object.keys(levels).length > 0) {
			this.levels = sanitizeLevels(levels);
		} else {
			this.levels = {};
			for (const id of sanitizeLearned(learned ?? [])) {
				const node = skillNode(id);
				if (node) {
					this.levels[id] = maxLevelOf(node);
				}
			}
		}
		this.bonusPoints = bonusPoints;
		this.recompute();
		for (const node of this.activeNodes()) {
			autoAssignKey(node.id);
		}
		this.scene.activeSkills?.rebuildHud?.();
	}

	// ------------------------------------------------------------------
	// 패시브 적용 (되돌리기 가능)
	// ------------------------------------------------------------------

	recompute(): void {
		this.revert();
		this.learned = new Set(Object.keys(this.levels).filter((id) => (this.levels[id] ?? 0) > 0));
		this.mods = aggregateTreeModsLeveled(this.levels);
		this.apply();
	}

	private apply(): void {
		const m = this.mods;
		const player = this.scene.player;
		const orbit = this.scene.swordOrbit;
		const progression = this.scene.progression;
		if (player) {
			player.defense = (player.defense ?? 0) + m.defenseAdd;
			player.critChance = (player.critChance ?? 0) + m.critChanceAdd;
			player.hpRegen = (player.hpRegen ?? 0) + m.hpRegenAdd;
			player.goldBonus = (player.goldBonus ?? 0) + m.goldBonusAdd;
			player.luck = (player.luck ?? 0) + m.luckAdd;
			player.healBudgetBonus = (player.healBudgetBonus ?? 0) + m.healBudgetAdd;
			player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) + m.critDamageAdd;
			if (m.maxHpMult !== 1) {
				const ratio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
				player.maxHp = Math.max(1, Math.round(player.maxHp * m.maxHpMult));
				player.hp = Math.min(player.maxHp, Math.max(1, Math.round(player.maxHp * ratio)));
			}
			if (m.moveSpeedMult !== 1) {
				player.moveSpeed = Math.round(player.moveSpeed * m.moveSpeedMult);
				if (player.baseMoveSpeed) {
					player.baseMoveSpeed = Math.round(player.baseMoveSpeed * m.moveSpeedMult);
				}
			}
		}
		if (orbit) {
			orbit.damageMultiplier += m.damageMultAdd;
			if (m.bonusHits > 0) {
				orbit.addBonusHits(m.bonusHits);
			}
			if (m.cleave > 0) {
				orbit.addCleave(m.cleave);
			}
			for (const sword of orbit.swords) {
				orbit.recalculateSwordStats(sword);
			}
		}
		if (progression && m.xpMultAdd) {
			progression.xpMultiplier = (progression.xpMultiplier ?? 1) + m.xpMultAdd;
		}
		if (this.scene.augmentSystem && m.swordDiscount) {
			this.scene.augmentSystem.swordDiscount = Math.min(0.5, this.scene.augmentSystem.swordDiscount + m.swordDiscount);
		}
		this.appliedBonusHits = m.bonusHits;
		this.appliedCleave = m.cleave;
		this.appliedDiscount = m.swordDiscount;
		// 기존 능동 스킬 숙련 단계
		this.scene.activeSkills?.setLevels({
			dive: m.skillLevel.dive ?? 1, recall: m.skillLevel.recall ?? 1, dash: m.skillLevel.dash ?? 1,
		});
		this.scene.activeSkills?.invalidateMods?.();
		this.applied = { ...m, skillLevel: { ...m.skillLevel } };
	}

	private revert(): void {
		const m = this.applied;
		if (!m) {
			return;
		}
		const player = this.scene.player;
		const orbit = this.scene.swordOrbit;
		const progression = this.scene.progression;
		if (player) {
			player.defense = (player.defense ?? 0) - m.defenseAdd;
			player.critChance = (player.critChance ?? 0) - m.critChanceAdd;
			player.hpRegen = (player.hpRegen ?? 0) - m.hpRegenAdd;
			player.goldBonus = (player.goldBonus ?? 0) - m.goldBonusAdd;
			player.luck = (player.luck ?? 0) - m.luckAdd;
			player.healBudgetBonus = (player.healBudgetBonus ?? 0) - m.healBudgetAdd;
			player.critDamageMultiplier = (player.critDamageMultiplier ?? 1) - m.critDamageAdd;
			if (m.maxHpMult !== 1) {
				const ratio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
				player.maxHp = Math.max(1, Math.round(player.maxHp / m.maxHpMult));
				player.hp = Math.min(player.maxHp, Math.max(1, Math.round(player.maxHp * ratio)));
			}
			if (m.moveSpeedMult !== 1) {
				player.moveSpeed = Math.round(player.moveSpeed / m.moveSpeedMult);
				if (player.baseMoveSpeed) {
					player.baseMoveSpeed = Math.round(player.baseMoveSpeed / m.moveSpeedMult);
				}
			}
		}
		if (orbit) {
			orbit.damageMultiplier -= m.damageMultAdd;
			if (this.appliedBonusHits > 0) {
				orbit.addBonusHits(-this.appliedBonusHits);
			}
			if (this.appliedCleave > 0) {
				orbit.addCleave(-this.appliedCleave);
			}
		}
		if (progression && m.xpMultAdd) {
			progression.xpMultiplier = (progression.xpMultiplier ?? 1) - m.xpMultAdd;
		}
		if (this.scene.augmentSystem && this.appliedDiscount) {
			this.scene.augmentSystem.swordDiscount = Math.max(0, this.scene.augmentSystem.swordDiscount - this.appliedDiscount);
		}
		this.applied = null;
		this.appliedBonusHits = 0;
		this.appliedCleave = 0;
		this.appliedDiscount = 0;
	}

	/** RunSave.capture: 순수 스탯을 저장하기 위해 잠시 벗긴다 (짝: reapplyAfterCapture) */
	revertForCapture(): void {
		this.revert();
	}

	reapplyAfterCapture(): void {
		this.apply();
	}

	/** RunSave.apply 뒤: 스탯이 통째로 덮어써졌으므로 되돌리지 않고 기록만 지우고 새로 얹는다 */
	restoreAfterLoad(learned: string[] | undefined, bonusPoints = 0, levels?: SkillLevels): void {
		this.applied = null;
		this.appliedBonusHits = 0;
		this.appliedCleave = 0;
		this.appliedDiscount = 0;
		this.restore(learned, bonusPoints, levels);
	}

	// ------------------------------------------------------------------
	// 능동 스킬
	// ------------------------------------------------------------------

	/** 상황 배율: 위기 재사용 절반 (체력 30% 이하) */
	dynamicCooldownMult(): number {
		const player = this.scene.player;
		if (this.mods.lastStand > 0 && player && player.hp / Math.max(1, player.maxHp) <= 0.3) {
			return this.mods.lastStand;
		}
		return 1;
	}

	/** 상황 피해 배율: 저체력 공격 · 광폭화 (hitResolution 이 곱한다) */
	dynamicDamageMult(): number {
		const player = this.scene.player;
		const now = this.scene.time?.now ?? 0;
		let mult = 1;
		if (this.mods.lowHpRage > 0 && player && player.hp / Math.max(1, player.maxHp) <= 0.5) {
			mult += this.mods.lowHpRage;
		}
		if (now < this.berserkUntil) {
			mult += this.berserkDamageAdd;
		}
		return mult;
	}

	/** 상황 방어 가산: 피의 갑옷 (잃은 체력 1%당) */
	dynamicDefense(): number {
		const armor = this.mods.bloodArmor;
		const player = this.scene.player;
		if (!armor || !player) {
			return 0;
		}
		const lostPct = Math.max(0, 1 - player.hp / Math.max(1, player.maxHp)) * 100;
		return Math.min(armor.cap, lostPct * armor.perPct);
	}

	/** 받는 피해 배율: 광폭화 */
	damageTakenMult(): number {
		return (this.scene.time?.now ?? 0) < this.berserkUntil ? this.berserkTakenMult : 1;
	}

	/** 은신 중인가 (GameScene 이 적 조준 제외 등에 쓸 수 있다) */
	get isStealthed(): boolean {
		return (this.scene.time?.now ?? 0) < this.stealthUntil;
	}

	cooldownMs(id: string): number {
		const node = skillNode(id);
		const base = node?.active ? this.activeSpec(node).cooldownMs : 10000;
		const skillMult = this.scene.activeSkills?.cooldownMult ?? 1;
		return Math.max(400, Math.round(base * skillMult * this.mods.skillCooldownMult * this.dynamicCooldownMult()));
	}

	remainingMs(id: string): number {
		return Math.max(0, Math.round((this.readyAt[id] ?? 0) - (this.scene.time?.now ?? 0)));
	}

	isReady(id: string): boolean {
		return this.remainingMs(id) <= 0;
	}

	canAct(): boolean {
		return this.scene.activeSkills?.canAct() ?? false;
	}

	/**
	 * 조준점 — **커서를 쓰지 않는다** (사용자 규칙). 이동 입력이 있으면 그 방향, 없으면 바라보는 쪽.
	 */
	aimPoint(maxDist: number): { x: number; y: number; angle: number } {
		const scene = this.scene;
		const player = scene.player;
		let dx = scene.getHorizontalInput?.() ?? 0;
		let dy = scene.getVerticalInput?.() ?? 0;
		if (dx === 0 && dy === 0) {
			dx = player.flipX ? -1 : 1;
		}
		const angle = Math.atan2(dy, dx);
		return { x: player.x + Math.cos(angle) * maxDist, y: player.y + Math.sin(angle) * maxDist, angle };
	}

	private avgHit(): number {
		return this.scene.augmentSystem?.avgSwordDamage?.() ?? 30;
	}

	castNode(id: string): boolean {
		const node = skillNode(id);
		if (!node?.active || !this.learned.has(id) || !this.canAct() || !this.isReady(id)) {
			if (node && this.canAct() && !this.isReady(id) && this.scene.player) {
				this.scene.visualEffects?.fxRing(this.scene.player.x, this.scene.player.y, { r0: 10, r1: 34, w: 2, color: 0x6b7680, alpha: 0.45, dur: 180 });
			}
			return false;
		}
		const ok = this.perform(node);
		if (ok) {
			this.readyAt[id] = this.scene.time.now + this.cooldownMs(id);
			this.useCount[id] = (this.useCount[id] ?? 0) + 1;
			this.scene.activeSkills?.markHudDirty?.(id);
		}
		return ok;
	}

	/** 갈래 색 (연출 공용) */
	private branchColor(node: SkillNode): string {
		return SKILL_BRANCHES.find((b) => b.id === node.branch)?.color ?? '#dfe6ea';
	}

	private perform(node: SkillNode): boolean {
		const a = this.activeSpec(node);
		const scene = this.scene;
		const player = scene.player;
		const fx = scene.visualEffects;
		const now = scene.time.now;
		const n = (key: string, fallback: number) => (typeof a[key] === 'number' ? (a[key] as number) : fallback);
		const color = this.branchColor(node);
		const tint = parseInt(color.replace('#', ''), 16);
		const callout = (shake = 0.004, big = false) => fx?.skillCastFX(player.x, player.y, node.name, color, { shake, big });

		switch (a.type) {
			case 'swoop': {
				const aim = this.aimPoint(n('distance', 220));
				const dur = 180;
				const speed = Math.hypot(aim.x - player.x, aim.y - player.y) / dur * 1000;
				player.setVelocity(Math.cos(aim.angle) * speed, Math.sin(aim.angle) * speed);
				player.setFlipX(Math.cos(aim.angle) < 0);
				player.knockbackUntil = Math.max(player.knockbackUntil ?? 0, now + dur);
				player.invulnerableUntil = Math.max(player.invulnerableUntil ?? 0, now + n('invulnMs', 400));
				scene.time.delayedCall(dur, () => {
					if (!scene.player?.isDead) {
						scene.activeSkills?.useDive(true);
						fx?.fxRing(scene.player.x, scene.player.y, { r0: 10, r1: 110, w: 4, color: tint, alpha: 0.9, dur: 320 });
						fx?.fxBurst(scene.player.x, scene.player.y, { count: 12, reach: 90, color: tint, w: 2.5, alpha: 0.9, dur: 320 });
					}
				});
				callout(0.005);
				fx?.dashGhostFX?.(player);
				// 덮치는 궤적: 앞쪽으로 뻗는 쐐기 3줄
				for (let i = -1; i <= 1; i += 1) {
					const ang = aim.angle + i * 0.18;
					fx?.fxPoly([player.x, player.y, player.x + Math.cos(ang) * 200, player.y + Math.sin(ang) * 200],
						{ layers: [[6, tint, 0.35], [2, 0xffffff, 0.8]], dur: 220 });
				}
				scene.soundSystem?.play('crit', { volume: 0.6 });
				return true;
			}
			case 'bulwark': {
				const radius = n('pushRadius', 180);
				player.invulnerableUntil = Math.max(player.invulnerableUntil ?? 0, now + n('invulnMs', 1200));
				this.pushAround(player.x, player.y, radius, n('pushForce', 420));
				scene.enemyManager?.clearProjectilesNear?.(player.x, player.y, radius);
				callout(0.004);
				fx?.fxRing(player.x, player.y, { r0: 30, r1: radius, w: 6, color: tint, alpha: 0.95, dur: 380 });
				fx?.fxRing(player.x, player.y, { r0: radius, r1: radius * 1.15, w: 2, color: 0xffffff, alpha: 0.7, dash: 10, dur: 500 });
				// 검 방패: 무적 동안 유지되는 육각 보호막.
				// 시트가 있으면 **플레이어를 따라다니는** 루프로 — 예전 링은 시전 위치에 고정이라
				// 움직이면 보호막만 뒤에 남았다.
				const shieldMs = n('invulnMs', 1200);
				if (!fx?.fxSpriteFollow('fx-dome', player, player.x, player.y, now + shieldMs, {
					size: 150, tint: 0xbfe6f2, additive: true, alpha: 0.9, depth: 10,
				})) {
					fx?.fxRing(player.x, player.y, { r0: 58, r1: 62, w: 5, color: 0xbfe6f2, alpha: 0.9, dur: shieldMs, hold: 0.85, ease: 'lin' });
					fx?.fxRing(player.x, player.y, { r0: 70, r1: 74, w: 2, color: tint, alpha: 0.7, dash: 8, dur: shieldMs, hold: 0.85, ease: 'lin' });
				}
				scene.soundSystem?.play('revive', { volume: 0.4 });
				return true;
			}
			case 'blink': {
				const aim = this.aimPoint(n('distance', 240));
				callout(0.003);
				fx?.fxRing(player.x, player.y, { r0: 40, r1: 6, w: 3, color: tint, alpha: 0.9, dur: 220 });
				fx?.fxBurst(player.x, player.y, { count: 8, reach: 40, color: tint, w: 2, alpha: 0.8, dur: 200 });
				fx?.dashGhostFX?.(player);
				// 잔상 띠: 출발→도착
				fx?.fxPoly([player.x, player.y, aim.x, aim.y], { layers: [[10, tint, 0.25], [3, 0xffffff, 0.7]], dur: 240 });
				player.setPosition(aim.x, aim.y);
				player.setVelocity(0, 0);
				player.invulnerableUntil = Math.max(player.invulnerableUntil ?? 0, now + n('invulnMs', 300));
				fx?.fxRing(aim.x, aim.y, { r0: 8, r1: 60, w: 4, color: tint, alpha: 0.95, dur: 300 });
				fx?.fxDot(aim.x, aim.y, { r: 20, color: 0xffffff, alpha: 0.8, scale1: 0.2, dur: 180 });
				scene.soundSystem?.play('click', { volume: 0.6 });
				return true;
			}
			case 'swordWave': {
				const length = n('length', 360);
				const halfW = n('halfWidth', 70);
				const aim = this.aimPoint(length);
				const damage = Math.max(1, Math.round(this.avgHit() * n('damageMult', 1.5)));
				const hit = this.damageInLane(player.x, player.y, aim.angle, length, halfW, damage, 'physical');
				const orbit = scene.swordOrbit;
				if (orbit) {
					const target = orbit.findNearestEnemy(aim.x, aim.y, orbit.enemyGroup, 200);
					if (target) {
						for (const sword of orbit.swords) {
							if (sword.state === 'orbiting') {
								orbit.startLaunchedSword(sword, target);
							}
						}
					}
				}
				const ex = player.x + Math.cos(aim.angle) * length;
				const ey = player.y + Math.sin(aim.angle) * length;
				callout(0.005);
				// 검기: 시트가 있으면 초승달 궤적 스프라이트(시전자 기준 왼쪽 중앙 앵커, +X 로 그려져 있다).
				// 없으면 기존 광선 3층 + 가장자리 선 문법으로 떨어진다.
				const wave = fx?.fxSprite('fx-slash', player.x, player.y, {
					size: length, height: halfW * 2.1, rotation: aim.angle,
					anchorLeft: true, tint, additive: true,
				});
				if (!wave) {
					fx?.fxPoly([player.x, player.y, ex, ey], { layers: [[halfW * 2, tint, 0.22], [halfW, tint, 0.5], [10, 0xffffff, 0.95]], dur: 420 });
					const nx = -Math.sin(aim.angle) * halfW;
					const ny = Math.cos(aim.angle) * halfW;
					fx?.fxPoly([player.x + nx, player.y + ny, ex + nx, ey + ny], { layers: [[2, 0xffffff, 0.7]], dur: 220 });
					fx?.fxPoly([player.x - nx, player.y - ny, ex - nx, ey - ny], { layers: [[2, 0xffffff, 0.7]], dur: 220 });
				}
				fx?.fxRing(ex, ey, { r0: 10, r1: halfW * 1.3, w: 4, color: tint, alpha: 0.95, dur: 300 });
				fx?.fxBurst(ex, ey, { count: 10, reach: halfW, color: tint, w: 2, alpha: 0.9, dur: 300 });
				scene.soundSystem?.play(hit > 0 ? 'crit' : 'hit', { volume: 0.7 });
				scene.swordOrbit?.recordDamage?.(node.name, damage * hit);
				return true;
			}
			case 'spinBurst': {
				const orbit = scene.swordOrbit;
				if (!orbit) return false;
				this.endSpin();
				this.spinOrbitSpeedMult = n('orbitSpeedMult', 3);
				this.spinDamageMult = n('orbitDamageMult', 2.5);
				orbit.orbitSpeed *= this.spinOrbitSpeedMult;
				orbit.orbitDamageMult *= this.spinDamageMult;
				orbit.orbitContactUntil = now + n('durationMs', 3000);
				this.spinUntil = orbit.orbitContactUntil;
				callout(0.005);
				fx?.fxRing(player.x, player.y, { r0: orbit.radius * 0.5, r1: orbit.radius * 1.6, w: 5, color: tint, alpha: 0.9, dur: 400 });
				for (let i = 0; i < 3; i += 1) {
					fx?.fxArc(player.x, player.y, { r: orbit.radius * (0.8 + i * 0.3), a0: i * 2.1, a1: i * 2.1 + 2.4, color: i === 1 ? 0xffffff : tint, w: 4, alpha: 0.85, dur: 500 + i * 120, spin: 9 });
				}
				scene.soundSystem?.play('bigkill', { volume: 0.5 });
				return true;
			}
			case 'swordStorm': {
				const orbit = scene.swordOrbit;
				if (!orbit) return false;
				if (now >= this.stormUntil) {
					this.stormPrevTwin = orbit.twinLaunchChance;
				}
				orbit.twinLaunchChance = 1;
				this.stormUntil = now + n('durationMs', 5000);
				callout(0.006, true);
				fx?.fxRing(player.x, player.y, { r0: 20, r1: 180, w: 5, color: tint, alpha: 0.9, dur: 420 });
				fx?.fxBurst(player.x, player.y, { count: 14, reach: 140, color: 0xffffff, w: 2, alpha: 0.9, dur: 340 });
				for (const sword of orbit.swords) {
					fx?.fxRing(sword.x, sword.y, { r0: 6, r1: 30, w: 3, color: tint, alpha: 0.9, dur: 300 });
				}
				scene.soundSystem?.play('evolve', { volume: 0.5 });
				return true;
			}
			case 'emberHeal': {
				const heal = Math.max(1, Math.round(player.maxHp * n('healPct', 0.2)));
				player.hp = Math.min(player.maxHp, player.hp + heal);
				this.regenPctPerSec = n('regenPct', 0.03);
				this.regenUntil = now + n('regenMs', 4000);
				callout(0);
				fx?.showDamageText?.(player.x, player.y - 56, `+${heal}`, false, '#84b04a');
				fx?.fxRing(player.x, player.y, { r0: 20, r1: 90, w: 4, color: 0x84b04a, alpha: 0.9, dur: 420 });
				// 솟는 불씨 입자
				for (let i = 0; i < 10; i += 1) {
					fx?.fxDot(player.x + (Math.random() - 0.5) * 40, player.y + 10, { r: 3 + Math.random() * 3, color: i % 2 ? 0xffb066 : 0xf97316, alpha: 0.95, scale1: 0.3, dy: -60 - Math.random() * 40, dx: (Math.random() - 0.5) * 30, dur: 500 + Math.random() * 300 });
				}
				scene.soundSystem?.play('revive', { volume: 0.5 });
				return true;
			}
			case 'fireZone': {
				const radius = n('radius', 150);
				this.zones.push({
					x: player.x, y: player.y, radius, until: now + n('durationMs', 5000), tickAt: now,
					dps: Math.max(1, this.avgHit() * n('dpsMult', 0.45)), fxAt: 0,
					// 루프 시트 1장으로 장판을 유지한다 (없으면 update 쪽 90ms 재스탬프 폴백)
					sprite: fx?.fxSprite('fx-field', player.x, player.y, {
						size: radius * 2, tint: 0xf97316, additive: true, alpha: 0.85, depth: 5,
					}) ?? null,
				});
				callout(0.004);
				fx?.fxRing(player.x, player.y, { r0: 10, r1: radius, w: 5, color: 0xf97316, alpha: 0.9, dur: 360 });
				fx?.fxBurst(player.x, player.y, { count: 12, reach: radius, color: 0xffb066, w: 2, alpha: 0.9, dur: 320 });
				scene.soundSystem?.play('bigkill', { volume: 0.4 });
				return true;
			}
			case 'timeWarp': {
				const radius = n('radius', 320);
				const slow = n('slow', 0.55);
				const duration = n('durationMs', 4000);
				this.slowAround(player.x, player.y, radius, slow, duration, true);
				callout(0.005, slow >= 0.9);
				fx?.fxRing(player.x, player.y, { r0: 20, r1: radius, w: 5, color: tint, alpha: 0.9, dur: 520 });
				// 감속 장판은 시전 자리에 고정 (판정도 그 자리에 걸린다 — 따라다니면 거짓말이 된다)
				if (!fx?.fxSpriteFollow('fx-field', null, player.x, player.y, now + duration, {
					size: radius * 2, tint: 0xd8c8ff, additive: true, alpha: 0.55, depth: 5,
				})) {
					fx?.fxRing(player.x, player.y, { r0: radius, r1: radius * 0.92, w: 2, color: 0xe0d0ff, alpha: 0.6, dash: 14, dur: duration, hold: 0.85, ease: 'lin' });
				}
				// 시계 바늘처럼 도는 호
				fx?.fxArc(player.x, player.y, { r: radius * 0.6, a0: 0, a1: 1.2, color: 0xffffff, w: 3, alpha: 0.7, dur: 900, spin: 8 });
				fx?.hitStop?.(slow >= 0.9 ? 120 : 60, { force: true });
				scene.soundSystem?.play('warning', { volume: 0.5 });
				return true;
			}
			case 'bomb': {
				const aim = this.aimPoint(n('range', 320));
				const delay = n('delayMs', 500);
				this.bombs.push({
					x: aim.x, y: aim.y, at: now + delay, radius: n('radius', 150),
					damage: Math.max(1, Math.round(this.avgHit() * n('damageMult', 3))), fxAt: 0,
				});
				callout(0.002);
				// 포물선 느낌: 불꽃 점이 위로 솟았다 떨어지게 (dy 음수 → 목적지)
				fx?.fxDot(player.x, player.y, { r: 9, color: 0xf97316, alpha: 0.95, scale1: 1, dx: aim.x - player.x, dy: aim.y - player.y, dur: delay, ease: 'lin' });
				fx?.fxDot(player.x, player.y, { r: 16, color: 0xffb066, alpha: 0.4, scale1: 1, dx: aim.x - player.x, dy: aim.y - player.y, dur: delay, ease: 'lin' });
				fx?.fxRing(aim.x, aim.y, { r0: n('radius', 150) * 0.2, r1: n('radius', 150), w: 2, color: 0xf97316, alpha: 0.6, dash: 8, dur: delay, ease: 'lin' });
				scene.soundSystem?.play('click', { volume: 0.6 });
				return true;
			}
			case 'lure': {
				const aim = this.aimPoint(n('range', 300));
				this.lureX = aim.x;
				this.lureY = aim.y;
				this.lureUntil = now + n('durationMs', 3500);
				scene.enemyManager?.setLure?.(aim.x, aim.y, n('radius', 420), n('durationMs', 3500));
				callout(0.002);
				fx?.fxRing(aim.x, aim.y, { r0: 10, r1: n('radius', 420), w: 3, color: 0xe8874a, alpha: 0.7, dur: 700 });
				// 횃불은 그 자리에서 지속 시간 내내 타야 한다 (예전엔 update 에서 링을 다시 찍었다)
				if (!fx?.fxSpriteFollow('fx-field', null, aim.x, aim.y, this.lureUntil, {
					size: 130, tint: 0xffb066, additive: true, alpha: 0.85, depth: 5,
				})) {
					fx?.fxRing(aim.x, aim.y, { r0: n('radius', 420), r1: 40, w: 2, color: 0xffb066, alpha: 0.5, dash: 12, dur: 900 });
				}
				scene.soundSystem?.play('warning', { volume: 0.35 });
				return true;
			}
			case 'goldRush': {
				this.goldRushUntil = now + n('durationMs', 6000);
				callout(0.003);
				fx?.fxRing(player.x, player.y, { r0: 20, r1: 130, w: 5, color: 0xf2d488, alpha: 0.95, dur: 420 });
				for (let i = 0; i < 12; i += 1) {
					const ang = (i / 12) * Math.PI * 2;
					fx?.fxDiamond(player.x + Math.cos(ang) * 40, player.y + Math.sin(ang) * 40, { r: 7, color: 0xffd27a, alpha: 0.95, dur: 500, dy: -30 });
				}
				scene.soundSystem?.play('chest', { volume: 0.6 });
				return true;
			}
			// ── 천둥
			case 'lightning': {
				const bolts = n('bolts', 3) + this.mods.extraBolts;
				const damage = Math.max(1, Math.round(this.avgHit() * n('damageMult', 2)));
				const struck = this.strikeLightning(player.x, player.y, n('radius', 420), bolts, damage, n('chain', 1));
				callout(0.005);
				scene.soundSystem?.play('crit', { volume: 0.7 });
				return struck >= 0;
			}
			case 'stormCall': {
				this.stormCallUntil = now + n('durationMs', 6000);
				this.stormCallAt = now;
				this.stormSpec = { radius: n('radius', 380), damage: Math.max(1, Math.round(this.avgHit() * n('damageMult', 1.2))) };
				callout(0.006, true);
				fx?.fxRing(player.x, player.y, { r0: 30, r1: n('radius', 380), w: 4, color: tint, alpha: 0.8, dur: 600 });
				scene.soundSystem?.play('warning', { volume: 0.5 });
				return true;
			}
			// ── 그림자
			case 'shadowClone': {
				const aim = this.aimPoint(n('distance', 160));
				const sprite = scene.add.image(aim.x, aim.y, player.texture.key, player.frame.name)
					.setDisplaySize(player.displayWidth, player.displayHeight)
					.setTint(0x2a1f3d).setAlpha(0.75).setDepth(9).setFlipX(player.flipX);
				this.clones.push({
					sprite, x: aim.x, y: aim.y, until: now + n('durationMs', 5000),
					explodeRadius: n('explodeRadius', 170), damage: Math.max(1, Math.round(this.avgHit() * n('damageMult', 3))), fxAt: 0,
				});
				scene.enemyManager?.setLure?.(aim.x, aim.y, n('radius', 400), n('durationMs', 5000));
				callout(0.003);
				fx?.fxGhost?.(player.texture.key, player.frame.name, player.x, player.y, { displayW: player.displayWidth, displayH: player.displayHeight, tint: 0x8d7bb5, alpha: 0.8, depth: 9, dur: 400, scale1: 1, dx: aim.x - player.x, dy: aim.y - player.y });
				fx?.fxRing(aim.x, aim.y, { r0: 8, r1: 70, w: 3, color: tint, alpha: 0.9, dur: 320 });
				scene.soundSystem?.play('click', { volume: 0.5 });
				return true;
			}
			case 'stealth': {
				this.stealthUntil = now + n('durationMs', 2500);
				this.stealthRadius = n('radius', 220);
				player.invulnerableUntil = Math.max(player.invulnerableUntil ?? 0, this.stealthUntil);
				player.setAlpha(0.35);
				scene.activeSkills?.applySpeedBoost?.(n('speedMult', 0.4), n('durationMs', 2500));
				callout(0.002);
				fx?.fxRing(player.x, player.y, { r0: 60, r1: 6, w: 3, color: tint, alpha: 0.9, dur: 300 });
				fx?.fxDot(player.x, player.y, { r: 40, color: 0x241a33, alpha: 0.6, scale1: 0.1, dur: 400, ease: 'in' });
				scene.soundSystem?.play('click', { volume: 0.4 });
				return true;
			}
			// ── 서리
			case 'frostNova': {
				const radius = n('radius', 220);
				const damage = Math.max(1, Math.round(this.avgHit() * n('damageMult', 1.5)));
				this.damageAround(player.x, player.y, radius, damage, 'magic', 'ice');
				this.slowAround(player.x, player.y, radius, 0.98, n('freezeMs', 1500), false);
				callout(0.005);
				// 노바 시트는 회색조라 원소 색을 틴트로 입힌다 (화염/보이드 노바와 같은 시트를 공유)
				if (!fx?.fxSprite('fx-nova', player.x, player.y, {
					size: radius * 2.1, tint: 0xbfe6f2, additive: true,
				})) {
					fx?.fxDot(player.x, player.y, { r: 60, color: 0x8fc3d8, alpha: 0.25, scale1: radius / 60, dur: 520 });
					fx?.fxRing(player.x, player.y, { r0: 30, r1: radius, w: 5, color: 0xbfe6f2, alpha: 0.95, dur: 500 });
				}
				// 얼음 파편은 시트 유무와 무관하게 유지 (노바 시트에는 파편이 없다)
				for (let i = 0; i < 12; i += 1) {
					const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
					const dist = radius * (0.4 + Math.random() * 0.6);
					fx?.fxDiamond(player.x + Math.cos(ang) * dist, player.y + Math.sin(ang) * dist, { r: 5 + Math.random() * 5, color: 0xbfe6f2, alpha: 0.95, dur: 500 + Math.random() * 300 });
				}
				fx?.hitStop?.(50);
				scene.soundSystem?.play('crit', { volume: 0.5 });
				return true;
			}
			case 'iceCage': {
				const manager = scene.enemyManager;
				const orbit = scene.swordOrbit;
				if (!manager?.queryRadius || !orbit) return false;
				let best: EnemySprite | null = null;
				let bestD = Infinity;
				for (const enemy of manager.queryRadius(player.x, player.y, n('radius', 480), QUERY)) {
					if (!orbit.isValidEnemy(enemy) || !(enemy.catalog?.isBoss || enemy.catalog?.isMiniboss || enemy.catalog?.isElite)) continue;
					const d = Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y);
					if (d < bestD) { best = enemy; bestD = d; }
				}
				if (!best) {
					// 대상이 없으면 쿨다운을 쓰지 않는다
					fx?.fxRing(player.x, player.y, { r0: 10, r1: 40, w: 2, color: 0x6b7680, alpha: 0.5, dur: 200 });
					return false;
				}
				const duration = n('durationMs', 3000);
				best.castingUntil = now + duration;
				best.nextSkillAt = Math.max(best.nextSkillAt ?? 0, now + duration + 800);
				best.slowFactor = 0.02;
				best.slowUntil = now + duration;
				best.setVelocity(0, 0);
				manager.interruptBossCasts?.(best.x, best.y, 10);
				callout(0.004);
				const r = Math.max(best.displayWidth, best.displayHeight) * 0.6;
				fx?.fxRing(best.x, best.y, { r0: r * 2, r1: r, w: 5, color: 0xbfe6f2, alpha: 0.95, dur: 400 });
				// 얼음 감옥은 **적을 따라다녀야** 한다 (넉백·밀림으로 위치가 바뀐다)
				if (!fx?.fxSpriteFollow('fx-dome', best, best.x, best.y, now + duration, {
					size: r * 2.4, tint: 0x8fc3d8, additive: true, alpha: 0.9, depth: 10,
				})) {
					fx?.fxRing(best.x, best.y, { r0: r, r1: r * 1.05, w: 4, color: 0x8fc3d8, alpha: 0.85, dash: 6, dur: duration, hold: 0.9, ease: 'lin' });
				}
				for (let i = 0; i < 8; i += 1) {
					const ang = (i / 8) * Math.PI * 2;
					fx?.fxDiamond(best.x + Math.cos(ang) * r, best.y + Math.sin(ang) * r, { r: 8, color: 0xbfe6f2, alpha: 0.95, dur: duration, dy: 0 });
				}
				fx?.showDamageText?.(best.x, best.y - r - 20, '빙결', false, '#38bdf8');
				scene.soundSystem?.play('warning', { volume: 0.4 });
				return true;
			}
			// ── 광기
			case 'berserk': {
				this.berserkUntil = now + n('durationMs', 8000);
				this.berserkDamageAdd = n('damageAdd', 0.4);
				this.berserkTakenMult = n('takenMult', 1.25);
				scene.activeSkills?.applySpeedBoost?.(n('speedMult', 0.15), n('durationMs', 8000));
				callout(0.006, true);
				fx?.fxRing(player.x, player.y, { r0: 20, r1: 120, w: 6, color: 0xc9455a, alpha: 0.95, dur: 420 });
				fx?.fxBurst(player.x, player.y, { count: 14, reach: 100, color: 0xff6b6b, w: 3, alpha: 0.9, dur: 340 });
				scene.soundSystem?.play('bigkill', { volume: 0.6 });
				return true;
			}
			case 'bloodStrike': {
				const cost = Math.round(player.maxHp * n('costPct', 0.15));
				if (player.hp <= cost + 1) {
					fx?.showDamageText?.(player.x, player.y - 50, '체력 부족', false, '#94a3b8');
					return false;
				}
				player.hp -= cost;
				const lostPct = Math.max(0, 1 - player.hp / Math.max(1, player.maxHp)) * 100;
				const damage = Math.max(1, Math.round(this.avgHit() * n('damageMult', 4) * (1 + lostPct * 0.02)));
				const length = n('length', 300);
				const half = n('halfAngle', 0.6);
				const aim = this.aimPoint(length);
				const hit = this.damageInCone(player.x, player.y, aim.angle, length, half, damage, 'physical');
				callout(0.006, true);
				fx?.showDamageText?.(player.x, player.y - 50, `-${cost}`, false, '#ff7a7a');
				// 부채꼴: 가장자리 선 2개 + 안쪽 붉은 쐐기 5줄
				// 부채꼴 채움(두꺼운 호 2겹) + 붉은 쐐기 5줄 + 가장자리 흰 선 + 끝 호
				fx?.fxArc(player.x, player.y, { r: length * 0.45, a0: aim.angle - half, a1: aim.angle + half, color: 0xc9455a, w: length * 0.5, alpha: 0.28, dur: 460 });
				fx?.fxArc(player.x, player.y, { r: length * 0.75, a0: aim.angle - half * 0.9, a1: aim.angle + half * 0.9, color: 0xff6b6b, w: length * 0.3, alpha: 0.22, dur: 520 });
				for (let i = -2; i <= 2; i += 1) {
					const ang = aim.angle + (i / 2) * half;
					fx?.fxPoly([player.x, player.y, player.x + Math.cos(ang) * length, player.y + Math.sin(ang) * length],
						{ layers: [[Math.abs(i) === 2 ? 2.5 : 16, Math.abs(i) === 2 ? 0xffffff : 0xe0654d, Math.abs(i) === 2 ? 0.95 : 0.55]], dur: 440 });
				}
				fx?.fxArc(player.x, player.y, { r: length, a0: aim.angle - half, a1: aim.angle + half, color: 0xff6b6b, w: 7, alpha: 0.95, dur: 480 });
				fx?.fxBurst(player.x + Math.cos(aim.angle) * length * 0.6, player.y + Math.sin(aim.angle) * length * 0.6, { count: 10, reach: 80, color: 0xff8a8a, w: 3, alpha: 0.9, dur: 420 });
				fx?.hitStop?.(70, { force: true });
				scene.soundSystem?.play('crit', { volume: 0.8 });
				scene.swordOrbit?.recordDamage?.(node.name, damage * hit);
				return true;
			}
			default:
				return false;
		}
	}

	// ------------------------------------------------------------------
	// 범위 판정 유틸 (버퍼 재사용)
	// ------------------------------------------------------------------

	private damageAround(x: number, y: number, radius: number, damage: number, damageType: 'physical' | 'magic', element?: 'fire' | 'ice' | 'electric'): number {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) return 0;
		let hit = 0;
		for (const enemy of manager.queryRadius(x, y, radius, QUERY)) {
			if (!orbit.isValidEnemy(enemy)) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > radius * radius) continue;
			manager.takeDamage(enemy, damage, this.scene.player, { damageType, element });
			hit += 1;
		}
		return hit;
	}

	private damageInLane(x: number, y: number, angle: number, length: number, halfW: number, damage: number, damageType: 'physical' | 'magic'): number {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) return 0;
		const cx = x + Math.cos(angle) * length / 2;
		const cy = y + Math.sin(angle) * length / 2;
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		let hit = 0;
		for (const enemy of manager.queryRadius(cx, cy, length / 2 + halfW, QUERY)) {
			if (!orbit.isValidEnemy(enemy)) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			const along = dx * ux + dy * uy;
			const across = Math.abs(-dx * uy + dy * ux);
			if (along < 0 || along > length || across > halfW) continue;
			manager.takeDamage(enemy, damage, this.scene.player, { damageType, pen: 0.2 });
			hit += 1;
		}
		return hit;
	}

	private damageInCone(x: number, y: number, angle: number, length: number, halfAngle: number, damage: number, damageType: 'physical' | 'magic'): number {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) return 0;
		let hit = 0;
		for (const enemy of manager.queryRadius(x, y, length, QUERY)) {
			if (!orbit.isValidEnemy(enemy)) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > length * length) continue;
			if (Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - angle)) > halfAngle) continue;
			manager.takeDamage(enemy, damage, this.scene.player, { damageType, pen: 0.25 });
			hit += 1;
		}
		return hit;
	}

	private slowAround(x: number, y: number, radius: number, slow: number, durationMs: number, bossHalf: boolean): void {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) return;
		const status = this.scene.statusEffects;
		for (const enemy of manager.queryRadius(x, y, radius, QUERY)) {
			if (!orbit.isValidEnemy(enemy)) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > radius * radius) continue;
			// 보스는 절반만 (bossHalf 노드). 리퍼·감속 면역은 헬퍼가 막는다.
			const amount = enemy.catalog?.isBoss && bossHalf ? slow * 0.5 : slow;
			// 광역이라 개체별 발동 연출은 생략 — 시전 링이 이미 범위를 보여 준다
			status?.slow(enemy, amount, durationMs, { fx: false, allowBoss: bossHalf });
		}
	}

	/** 반경 안 적 `count` 기에게 낙뢰. 맞은 수를 돌려준다. */
	private strikeLightning(x: number, y: number, radius: number, count: number, damage: number, chain: number): number {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		const fx = this.scene.visualEffects;
		if (!manager?.queryRadius || !orbit) return 0;
		const found = manager.queryRadius(x, y, radius, QUERY);
		// 가까운 순 상위 count (배열 정렬 대신 부분 선택)
		const picked: EnemySprite[] = [];
		for (const enemy of found) {
			if (!orbit.isValidEnemy(enemy)) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > radius * radius) continue;
			picked.push(enemy);
		}
		picked.sort((a, b) => Phaser.Math.Distance.Between(x, y, a.x, a.y) - Phaser.Math.Distance.Between(x, y, b.x, b.y));
		const targets = picked.slice(0, count);
		targets.forEach((enemy, i) => {
			this.scene.time.delayedCall(i * 70, () => {
				if (!orbit.isValidEnemy(enemy)) return;
				fx?.lightningFX(enemy.x, enemy.y);
				manager.takeDamage(enemy, damage, this.scene.player, { damageType: 'magic', element: 'electric', pen: 0.3 });
				this.scene.statusEffects?.shock(enemy, 1500);
				for (let c = 0; c < chain; c += 1) {
					const next = orbit.findNearestEnemy(enemy.x, enemy.y, orbit.enemyGroup, 180, new Set([enemy]));
					if (!next) break;
					manager.takeDamage(next, Math.round(damage * 0.6), this.scene.player, { damageType: 'magic', element: 'electric', pen: 0.3 });
					orbit.playChainEffect?.(enemy, next);
				}
			});
		});
		if (targets.length > 0) {
			this.scene.swordOrbit?.recordDamage?.('낙뢰', damage * targets.length);
		}
		return targets.length;
	}

	private shatterAt(x: number, y: number, damage: number): void {
		const fx = this.scene.visualEffects;
		this.damageAround(x, y, 130, damage, 'magic', 'ice');
		this.slowAround(x, y, 130, 0.5, 1500, true);
		if (!reduceMotion()) {
			fx?.fxRing(x, y, { r0: 10, r1: 130, w: 4, color: 0xbfe6f2, alpha: 0.9, dur: 320 });
			for (let i = 0; i < 6; i += 1) {
				const ang = (i / 6) * Math.PI * 2;
				fx?.fxDiamond(x, y, { r: 6, color: 0xbfe6f2, alpha: 0.95, dur: 400, dy: -20 });
				fx?.fxDot(x, y, { r: 3, color: 0xffffff, alpha: 0.9, scale1: 0.3, dx: Math.cos(ang) * 90, dy: Math.sin(ang) * 90, dur: 360 });
			}
		}
	}

	private endSpin(): void {
		const orbit = this.scene.swordOrbit;
		if (!orbit || this.spinUntil === 0) {
			return;
		}
		orbit.orbitSpeed /= this.spinOrbitSpeedMult;
		orbit.orbitDamageMult /= this.spinDamageMult;
		this.spinUntil = 0;
		this.spinOrbitSpeedMult = 1;
		this.spinDamageMult = 1;
	}

	private pushAround(x: number, y: number, radius: number, force: number): void {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) {
			return;
		}
		const now = this.scene.time.now;
		for (const enemy of manager.queryRadius(x, y, radius, QUERY)) {
			if (!orbit.isValidEnemy(enemy) || !enemy.body) continue;
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > radius * radius) continue;
			const resist = enemy.knockbackResist ?? 0;
			if (resist >= 1) continue;
			const angle = Math.atan2(dy, dx);
			enemy.setVelocity(Math.cos(angle) * force * (1 - resist), Math.sin(angle) * force * (1 - resist));
			enemy.knockbackUntil = now + 220;
		}
	}

	// ------------------------------------------------------------------
	// 훅
	// ------------------------------------------------------------------

	/** GameScene.applyPlayerDamage 가 실제 피해 직후 부른다 */
	onPlayerHurt(): void {
		const scene = this.scene;
		const player = scene.player;
		const now = scene.time.now;
		this.lastHurtAt = now;
		// 반격 폭풍
		if (this.mods.counterStorm > 0 && now >= this.counterReadyAt) {
			this.counterReadyAt = now + this.mods.counterStorm;
			scene.activeSkills?.useDive(true, true);
		}
		// 불사조
		const phoenix = this.mods.phoenix;
		const round = scene.waveSystem?.round ?? 0;
		if (phoenix && this.phoenixUsedRound !== round && player.hp > 0 && player.hp / player.maxHp < 0.25) {
			this.phoenixUsedRound = round;
			player.invulnerableUntil = Math.max(player.invulnerableUntil ?? 0, now + phoenix.invulnMs);
			const heal = Math.max(1, Math.round(player.maxHp * phoenix.healPct));
			player.hp = Math.min(player.maxHp, player.hp + heal);
			scene.visualEffects?.skillCastFX(player.x, player.y, '위기 무적', '#f97316', { shake: 0.006, big: true });
			scene.visualEffects?.showDamageText?.(player.x, player.y - 60, `+${heal}`, false, '#84b04a');
			scene.soundSystem?.play('revive', { volume: 0.6 });
		}
	}

	/** [1회 소생] 사망 시 1회. 소비했으면 true */
	consumeUnyielding(): boolean {
		if (this.mods.unyielding <= 0 || this.unyieldingUsed) {
			return false;
		}
		this.unyieldingUsed = true;
		return true;
	}

	/** WaveSystem.startRound */
	onRoundStart(): void {
		if (this.mods.roundStartCharge > 0 && this.scene.activeSkills) {
			const sk = this.scene.activeSkills;
			if (sk.ultCharge < this.mods.roundStartCharge) {
				sk.setUltCharge(this.mods.roundStartCharge);
			}
		}
	}

	/** ActiveSkillSystem.useUltimate 직후 */
	onUltCast(element: string): void {
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const player = scene.player;
		const now = scene.time.now;
		if (this.mods.afterglow && orbit) {
			const until = now + this.mods.afterglow.durationMs;
			const mult = 1 + this.mods.afterglow.mult;
			for (const sword of orbit.swords) {
				sword._diveBonusUntil = Math.max(sword._diveBonusUntil ?? 0, until);
				sword._diveBonusMult = Math.max(sword._diveBonusMult ?? 1, mult);
			}
		}
		if (this.mods.dualResonance > 0 && orbit && player) {
			const second = this.secondElement(element);
			if (second) {
				const spec = scene.activeSkills?.catalog.ult;
				const avgHit = scene.augmentSystem?.avgSwordDamage?.() ?? 30;
				orbit.castUltimate(second, player, {
					damageBase: Math.max(1, Math.round(avgHit * ((spec?.damageMult ?? 4) + this.mods.ultDamageAdd) * this.mods.dualResonance)),
					radiusMult: (spec?.radiusMult ?? 1.3) * (1 + this.mods.ultRadiusAdd),
				});
			}
		}
		// 천벌
		if (this.mods.ultLightning > 0 && player) {
			this.strikeLightning(player.x, player.y, 420, this.mods.ultLightning + this.mods.extraBolts, Math.max(1, Math.round(this.avgHit() * 2)), 1);
		}
	}

	private secondElement(primary: string): UltimateElement | null {
		const orbit = this.scene.swordOrbit;
		if (!orbit) return null;
		const counts = orbit.getElementCounts();
		let best: string | null = null;
		let bestCount = 0;
		for (const [element, count] of Object.entries(counts)) {
			if (element !== primary && count > bestCount) {
				best = element;
				bestCount = count;
			}
		}
		return best as UltimateElement | null;
	}

	/** ActiveSkillSystem.useDash 직후 — 대시 후 가속 */
	onDash(): void {
		const wind = this.mods.dashWind;
		if (!wind) return;
		this.scene.activeSkills?.applySpeedBoost?.(wind.mult, wind.durationMs);
	}

	/** 활공이 지목한 사냥감에 표식 */
	markTarget(enemy: EnemySprite): void {
		if (this.mods.huntMark > 0) {
			enemy.huntMarkUntil = this.scene.time.now + 3000;
			enemy.huntMarkMult = 1 + this.mods.huntMark;
		}
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
		const now = scene.time.now;
		const fx = scene.visualEffects;
		const manager = scene.enemyManager;
		const orbit = scene.swordOrbit;

		if (this.spinUntil > 0 && now >= this.spinUntil) {
			this.endSpin();
		}
		if (this.stormUntil > 0 && now >= this.stormUntil && orbit) {
			orbit.twinLaunchChance = this.stormPrevTwin;
			this.stormUntil = 0;
		}
		if (now < this.regenUntil && player && !player.isDead) {
			player.hp = Math.min(player.maxHp, player.hp + player.maxHp * this.regenPctPerSec * (delta / 1000));
		}
		// 대시 후 가속 갈래: 무피격 n초 → 대시 초기화 (한 번, 다시 맞을 때까지)
		const wind = this.mods.dashWind;
		if (wind && scene.activeSkills && now - this.lastHurtAt >= wind.resetAfterMs && this.dashResetAt <= this.lastHurtAt) {
			this.dashResetAt = now;
			scene.activeSkills.readyAt.dash = Math.min(scene.activeSkills.readyAt.dash, now);
		}
		// 무피격 이동 (그림자)
		const step = this.mods.shadowStep;
		if (step && now - this.lastHurtAt >= step.afterMs) {
			scene.activeSkills?.applySpeedBoost?.(step.mult, 250);
		}
		// 은신 종료
		if (this.stealthUntil > 0 && now >= this.stealthUntil) {
			this.stealthUntil = 0;
			player?.setAlpha(1);
			if (player) {
				this.slowAround(player.x, player.y, this.stealthRadius, 0.4, 2000, true);
				fx?.fxRing(player.x, player.y, { r0: 10, r1: this.stealthRadius, w: 3, color: 0x8d7bb5, alpha: 0.8, dur: 400 });
			}
		}
		// 냉기 오라: 0.25초마다 궤도 반경 안 감속
		if (this.mods.frostAura > 0 && player && orbit && now >= this.frostAuraAt) {
			this.frostAuraAt = now + 250;
			const radius = orbit.radius * 1.4 * this.mods.frostAuraRadiusMult;
			this.slowAround(player.x, player.y, radius, this.mods.frostAura, 450, true);
			if (!reduceMotion() && now % 1000 < 260) {
				fx?.fxRing(player.x, player.y, { r0: radius * 0.9, r1: radius, w: 1.5, color: 0x8fc3d8, alpha: 0.35, dur: 600 });
			}
		}
		// 광폭화 연출: 붉은 맥동
		if (now < this.berserkUntil && player && !reduceMotion() && now % 400 < 20) {
			fx?.fxRing(player.x, player.y, { r0: 24, r1: 46, w: 3, color: 0xc9455a, alpha: 0.7, dur: 300 });
		}
		// 폭풍우
		if (now < this.stormCallUntil && player && this.stormSpec && now >= this.stormCallAt) {
			this.stormCallAt = now + 600;
			this.strikeLightning(player.x, player.y, this.stormSpec.radius, 1 + this.mods.extraBolts, this.stormSpec.damage, 0);
		}
		// 그림자 분신
		for (let i = this.clones.length - 1; i >= 0; i -= 1) {
			const clone = this.clones[i];
			if (now >= clone.until) {
				this.clones.splice(i, 1);
				clone.sprite.destroy();
				this.damageAround(clone.x, clone.y, clone.explodeRadius, clone.damage, 'magic');
				manager?.playExplosionSprite?.(clone.x, clone.y, clone.explodeRadius);
				fx?.fxRing(clone.x, clone.y, { r0: 20, r1: clone.explodeRadius, w: 5, color: 0x8d7bb5, alpha: 0.95, dur: 380 });
				fx?.fxBurst(clone.x, clone.y, { count: 12, reach: clone.explodeRadius * 0.8, color: 0xa78bda, w: 2.5, alpha: 0.9, dur: 340 });
				fx?.hitStop?.(50);
				scene.soundSystem?.play('bigkill', { volume: 0.5 });
				continue;
			}
			// 흔들리는 그림자 + 발밑 어둠
			clone.sprite.setAlpha(0.6 + 0.15 * Math.sin(now / 90));
			if (now >= clone.fxAt && !reduceMotion()) {
				clone.fxAt = now + 120;
				fx?.fxDot(clone.x, clone.y + 12, { r: 24, color: 0x241a33, alpha: 0.35, dur: 260, scale1: 1.1, ease: 'lin' });
			}
		}

		// 불바다
		for (let i = this.zones.length - 1; i >= 0; i -= 1) {
			const zone = this.zones[i];
			if (now >= zone.until) {
				fx?.fxSpriteStop(zone.sprite ?? null);   // 루프는 스스로 안 끝난다
				zone.sprite = null;
				this.zones.splice(i, 1);
				continue;
			}
			if (zone.sprite) {
				// 루프 스프라이트가 살아 있으면 재스탬프를 통째로 건너뛴다
			} else if (now >= zone.fxAt && !reduceMotion()) {
				zone.fxAt = now + 90;
				fx?.fxDot(zone.x, zone.y, { r: zone.radius, color: 0xf97316, alpha: 0.12, dur: 200, scale1: 1, ease: 'lin' });
				const a0 = (now / 500) % (Math.PI * 2);
				fx?.fxArc(zone.x, zone.y, { r: zone.radius - 3, a0, a1: a0 + 1.2, color: 0xffb066, w: 3, alpha: 0.8, dur: 140, ease: 'lin' });
				// 불꽃 혀
				const fa = Math.random() * Math.PI * 2;
				const fd = Math.random() * zone.radius * 0.9;
				fx?.fxDot(zone.x + Math.cos(fa) * fd, zone.y + Math.sin(fa) * fd, { r: 4 + Math.random() * 4, color: Math.random() < 0.5 ? 0xf97316 : 0xffd27a, alpha: 0.9, scale1: 0.2, dy: -30 - Math.random() * 30, dur: 400 });
			}
			if (now >= zone.tickAt && manager && orbit) {
				zone.tickAt = now + 500;
				const tick = Math.max(1, Math.round(zone.dps * 0.5));
				this.damageAround(zone.x, zone.y, zone.radius, tick, 'magic', 'fire');
			}
		}

		// 화염탄
		for (let i = this.bombs.length - 1; i >= 0; i -= 1) {
			const bomb = this.bombs[i];
			if (now < bomb.at) {
				continue;
			}
			this.bombs.splice(i, 1);
			if (manager?.queryRadius && orbit) {
				for (const enemy of manager.queryRadius(bomb.x, bomb.y, bomb.radius, QUERY)) {
					if (!orbit.isValidEnemy(enemy)) continue;
					const dx = enemy.x - bomb.x;
					const dy = enemy.y - bomb.y;
					if (dx * dx + dy * dy > bomb.radius * bomb.radius) continue;
					manager.takeDamage(enemy, bomb.damage, player, { damageType: 'magic', element: 'fire' });
					manager.applyDot?.(enemy, bomb.damage * 0.1, 2000, 0xf97316);
				}
			}
			manager?.playExplosionSprite?.(bomb.x, bomb.y, bomb.radius);
			fx?.fxRing(bomb.x, bomb.y, { r0: 20, r1: bomb.radius, w: 6, color: 0xf97316, alpha: 0.95, dur: 380 });
			fx?.fxRing(bomb.x, bomb.y, { r0: 10, r1: bomb.radius * 0.6, w: 8, color: 0xffffff, alpha: 0.6, dur: 240 });
			fx?.fxBurst(bomb.x, bomb.y, { count: 14, reach: bomb.radius * 1.1, color: 0xffb066, w: 2.5, alpha: 0.9, dur: 360 });
			fx?.hitStop?.(50);
			if (screenShakeEnabled()) {
				scene.cameras.main.shake(140, 0.005);
			}
			scene.soundSystem?.play('bigkill', { volume: 0.6 });
		}

		// 미끼 횃불 연출
		if (now < this.lureUntil && now >= this.lureFxAt && !reduceMotion()) {
			this.lureFxAt = now + 100;
			fx?.fxDot(this.lureX, this.lureY - 8, { r: 10 + 3 * Math.sin(now / 90), color: 0xffb066, alpha: 0.9, dur: 160, scale1: 1.4, dy: -14 });
			fx?.fxRing(this.lureX, this.lureY, { r0: 14, r1: 30, w: 2, color: 0xe8874a, alpha: 0.5, dur: 300 });
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.scene.input?.keyboard?.off('keydown', this.onKeyDown);
		this.scene.events?.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		this.unbindHotbar?.();
		this.unbindHotbar = null;
		this.endSpin();
		for (const clone of this.clones) {
			clone.sprite.destroy();
		}
		this.clones = [];
		// 장판 루프 스프라이트는 스스로 끝나지 않는다 — 초기화 때 반드시 꺼야 화면에 남지 않는다
		for (const zone of this.zones) {
			this.scene.visualEffects?.fxSpriteStop(zone.sprite ?? null);
		}
		this.zones = [];
		this.bombs = [];
	}
}
