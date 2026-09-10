// 능동 스킬 (2026-09-01)
//
// LODELAND 의 핵심 판타지는 "키퍼가 검 무리를 언제 푸는가" 인데, 그때까지 입력은
// 이동뿐이었다. 이 시스템이 그 판타지를 실제 조작으로 만든다.
//
//   활공 사냥 (Q · 우클릭) — 무리 전체를 커서 방향으로 즉시 강제 출격. 이 출격만 +30%.
//   귀소       (SPACE)      — 무리 즉시 귀환 + 귀환 궤적 넉백 + 0.5초 피해 무효.
//   대시       (SHIFT)      — 이동 방향으로 120px 미끄러짐. 무적 없음 (자리 이탈용).
//   필살기     (R)          — 처치·피격으로 차는 게이지. 장착 검의 주 원소 필살기 + 보스 시전 끊기.
//                            (2026-09-04, 구 자동 타이머 필살기를 수동 게이지로 전환)
//
// 설계 규칙
//  1. 수치는 전부 src/data/skillCatalog.json — 코드에 상수를 박지 않는다.
//  2. 대기마을/오버레이/사망 중에는 발동하지 않는다. SPACE(게이트 출발)·E(상호작용)와
//     충돌하지 않는 이유가 이것이다 — 마을에서는 이 시스템이 통째로 잠긴다.
//  3. 핫패스(update)에서 객체·배열·문자열을 만들지 않는다. 질의 버퍼는 모듈 상수로 재사용.
//  4. 연출은 공유 FX 레이어(fx*) 만 쓴다. add.circle + 트윈 금지.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import type { SkillCatalog } from '../types/catalogs';
import skillCatalogJson from '../data/skillCatalog.json';
import { emptySkillMods, type SkillAugmentMods } from './AugmentSystem';
import GamepadSystem, { PAD_GLYPHS } from './GamepadSystem';
import { actionKeyLabel, getBindingCode, keyLabel, onKeybindsChanged } from '../core/keybinds';
import { skillKey } from '../core/skillHotbar';
import { skillNode } from '../logic/skillTree';
import { UI, style, slot, iconImage, hudScaleFor } from '../ui/theme';

export const SKILLS = skillCatalogJson as unknown as SkillCatalog;

export type SkillId = 'dive' | 'recall' | 'dash';
/** HUD 아이콘 — 기본 4종 뒤에 스킬 트리에서 배운 능동 스킬(노드 id)이 붙는다 */
type HudId = string;

const SKILL_IDS: SkillId[] = ['dive', 'recall', 'dash'];
const BUILTIN_HUD_IDS: HudId[] = ['dive', 'recall', 'dash', 'ult'];
/** 핫바 한 줄에 놓는 아이콘 수 — 넘치면 위 줄로 */
const HUD_PER_ROW = 7;

/** 적 질의 재사용 버퍼 (중첩 호출 없음 — 결과를 즉시 소비한다). */
const QUERY_BUFFER: EnemySprite[] = [];
const SWEEP_BUFFER: EnemySprite[] = [];
/** 활공 사냥 대상 후보 (검마다 다른 적을 노리게 한다). */
const CANDIDATES: EnemySprite[] = [];
const CANDIDATE_DIST: number[] = [];
/** 증강이 하나도 없을 때 쓰는 중립 시너지 값 (매 프레임 새로 만들지 않는다). */
const NEUTRAL_MODS = emptySkillMods();
/** 필살기 준비 안내용 원소 한국어 이름 */
const ELEMENT_KO: Record<string, string> = {
	fire: '화염 노바', electric: '낙뢰', void: '특이점', ice: '서리 노바',
	poison: '맹독 구름', gold: '황금 소나기', blood: '피의 수확', wind: '회오리',
};

interface SkillIconUi {
	frame: Phaser.GameObjects.NineSlice;
	glyph: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
	/** 쿨다운 가림막 (아래에서 위로 줄어드는 어두운 fill) */
	veil: Phaser.GameObjects.Image;
	label: Phaser.GameObjects.Text;
	timer: Phaser.GameObjects.Text;
	/** 표시 갱신 가드 */
	lastRatio: number;
	lastSeconds: number;
	x: number;
	y: number;
	size: number;
	/** 가림막 실제 폭·최대 높이 (HUD 배율이 반영된 값) */
	veilW: number;
	veilH: number;
}

export default class ActiveSkillSystem {
	scene: GameScene;
	readonly catalog = SKILLS;

	/**
	 * 쿨다운 배율 — 1 미만이면 더 빨리 돈다.
	 * 지금은 메타(잉걸)/캐릭터 특성의 쿨다운 감소를 절반만 반영해 배선해 둔다.
	 * (증강·키퍼 고유 스킬과의 시너지는 이 필드를 건드리면 그대로 붙는다)
	 */
	cooldownMult = 1;

	/** 스킬별 사용 가능 시각 (scene.time.now 기준) */
	readyAt: Record<SkillId, number> = { dive: 0, recall: 0, dash: 0 };

	/** 대시가 끝나는 시각 — 이 시각까지 이동 입력이 속도를 덮어쓰지 않는다 */
	dashUntil = 0;
	/** 귀환 궤적 넉백 판정이 도는 시각까지 */
	recallSweepUntil = 0;
	/** 누적 사용 횟수 (튜토리얼·테스트 판정용) */
	useCount: Record<SkillId, number> = { dive: 0, recall: 0, dash: 0 };

	/** 대시 시작 시각 — 잔상 피해가 같은 적을 두 번 때리지 않게 하는 세대 표식 */
	private dashStartedAt = 0;
	/** 귀소 시작 시각 — 귀환 궤적 피해의 세대 표식 */
	private recallStartedAt = 0;
	/** 활공 치명타 창 (증강 [매서운 조준]) — 만료 시 반드시 되돌린다 */
	private critWindowUntil = 0;
	private critWindowAdded = 0;
	/** 귀소 후 이동속도 상승 창 (증강 [귀소의 방벽]) */
	private speedBoostUntil = 0;
	private speedBoostMult = 0;

	private lastGhostAt = 0;
	private icons: Partial<Record<HudId, SkillIconUi>> = {};

	// ── 스킬 숙련 (1~3). 레벨업 카드 '○○ 숙련'으로 오른다 (2026-09-04).
	levels: Record<SkillId, number> = { dive: 1, recall: 1, dash: 1 };
	/** 숙련 효과를 합친 시너지 캐시 (레벨/증강이 바뀔 때만 다시 만든다) */
	private mergedMods: SkillAugmentMods | null = null;
	private mergedModsSource: SkillAugmentMods | null = null;

	// ── 필살기 게이지 (0~1). 처치/피격으로 차고, R 로 터뜨린다.
	ultCharge = 0;
	ultUseCount = 0;
	/** 마지막 필살기 원소 (테스트·HUD) */
	lastUltElement: string | null = null;
	/** 준비 완료 안내를 한 번만 */
	private ultReadyAnnounced = false;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private hudVisible = true;
	private destroyed = false;

	// 키 핸들러 (destroy 에서 해제하려면 참조를 들고 있어야 한다)
	//
	// 개별 'keydown-Q' 대신 통합 'keydown' 하나로 받는다 — 리맵(core/keybinds)이 바뀌어도
	// 핸들러를 다시 붙일 필요가 없고, 게임패드가 합성한 키 이벤트도 같은 길로 들어온다.
	private onKeyDown = (event: KeyboardEvent) => {
		// 키를 누르고 있을 때 오는 반복 이벤트는 무시한다 (개별 'keydown-Q' 시절과 같은 체감)
		if (event.repeat) {
			return;
		}
		switch (event.keyCode) {
			case getBindingCode('dive'): this.useDive(); break;
			case getBindingCode('recall'): this.useRecall(); break;
			case getBindingCode('dash'): this.useDash(); break;
			case getBindingCode('ult'): this.useUltimate(); break;
			default: break;
		}
	};

	private onKeybindsChanged = () => { this.buildHud(); };
	private unbindKeybinds: (() => void) | null = null;
	private onPointerDown = (pointer: Phaser.Input.Pointer) => {
		if (pointer.rightButtonDown()) {
			this.useDive();
		}
	};

	constructor(scene: GameScene) {
		this.scene = scene;

		// 쿨다운 감소 배선: 검 쿨다운 감소의 절반만 스킬에 얹는다 (하한 0.6)
		const swordCooldownMult = scene.swordOrbit?.cooldownMultiplier ?? 1;
		this.cooldownMult = Phaser.Math.Clamp(1 - (1 - swordCooldownMult) * 0.5, 0.6, 1);

		const keyboard = scene.input.keyboard;
		keyboard?.on('keydown', this.onKeyDown);
		this.unbindKeybinds = onKeybindsChanged(this.onKeybindsChanged);
		// 우클릭을 스킬로 쓰므로 브라우저 컨텍스트 메뉴를 막는다
		scene.input.mouse?.disableContextMenu();
		scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);

		this.buildHud();
		scene.scale.on('resize', this.buildHud, this);
	}

	// ---------------------------------------------------------------
	// 상태 조회
	// ---------------------------------------------------------------

	/**
	 * 증강으로 누적된 스킬 시너지 값.
	 * 증강을 하나도 안 골랐으면 중립값(가산 0 / 배율 1)이라 기존 동작과 완전히 같다.
	 */
	get mods(): SkillAugmentMods {
		const base = this.scene.augmentSystem?.skillMods ?? NEUTRAL_MODS;
		const tree = this.scene.skillTree?.mods;
		const treeTouches = !!tree && (tree.diveDamageBonusAdd > 0 || tree.dashGhostDamagePct > 0);
		if (this.levels.dive <= 1 && this.levels.recall <= 1 && this.levels.dash <= 1 && !treeTouches) {
			return base;
		}
		// 증강 객체가 바뀌었거나(드래프트 후 새 객체) 레벨이 바뀌면 다시 합친다
		if (!this.mergedMods || this.mergedModsSource !== base) {
			this.mergedMods = this.buildMergedMods(base);
			this.mergedModsSource = base;
		}
		return this.mergedMods;
	}

	/** 스킬 숙련 효과를 증강 시너지 위에 얹는다 (가산은 더하고, 배율은 곱하고, 객체형은 더 센 쪽). */
	/** 트리/증강이 바뀌어 합친 값을 다시 만들어야 할 때 */
	invalidateMods(): void {
		this.mergedMods = null;
	}

	private buildMergedMods(base: SkillAugmentMods): SkillAugmentMods {
		const out: SkillAugmentMods = { ...base };
		const tree = this.scene.skillTree?.mods;
		if (tree) {
			out.diveDamageBonusAdd += tree.diveDamageBonusAdd;
			out.dashGhostDamagePct = Math.max(out.dashGhostDamagePct, tree.dashGhostDamagePct);
		}
		for (const id of SKILL_IDS) {
			const spec = this.catalog[id];
			for (let level = 2; level <= this.levels[id]; level += 1) {
				const step = spec.levels?.[String(level)];
				if (!step) {
					continue;
				}
				if (step.damageBonusAdd) out.diveDamageBonusAdd += step.damageBonusAdd;
				if (step.invulnAddMs) out.recallInvulnAddMs += step.invulnAddMs;
				if (step.knockbackRadiusAdd) out.recallKnockbackRadiusAdd += step.knockbackRadiusAdd;
				if (step.sweepDamagePct) out.recallSweepDamagePct = Math.max(out.recallSweepDamagePct, step.sweepDamagePct);
				if (step.distanceAdd) out.dashDistanceAdd += step.distanceAdd;
				if (step.ghostDamagePct) out.dashGhostDamagePct = Math.max(out.dashGhostDamagePct, step.ghostDamagePct);
				if (step.strikeBonus) {
					out.dashStrikeBonus = !out.dashStrikeBonus || step.strikeBonus.mult > out.dashStrikeBonus.mult
						? step.strikeBonus : out.dashStrikeBonus;
				}
			}
		}
		return out;
	}

	/** 숙련 단계의 쿨다운 배율 (레벨 2·3 의 cooldownMult 누적) */
	private levelCooldownMult(id: SkillId): number {
		let mult = 1;
		const spec = this.catalog[id];
		for (let level = 2; level <= this.levels[id]; level += 1) {
			mult *= spec.levels?.[String(level)]?.cooldownMult ?? 1;
		}
		return mult;
	}

	/** 숙련 단계별 단일 값 조회 (bonusWindowMult / impactPct / healPct) */
	private levelValue(id: SkillId, key: 'bonusWindowMult' | 'impactPct' | 'healPct'): number {
		let value = 0;
		const spec = this.catalog[id];
		for (let level = 2; level <= this.levels[id]; level += 1) {
			const v = spec.levels?.[String(level)]?.[key];
			if (typeof v === 'number') {
				value = key === 'bonusWindowMult' ? (value || 1) * v : value + v;
			}
		}
		return key === 'bonusWindowMult' ? (value || 1) : value;
	}

	/** 숙련 최대치 */
	maxLevel(id: SkillId): number {
		const levels = this.catalog[id].levels ?? {};
		let max = 1;
		for (const key of Object.keys(levels)) {
			max = Math.max(max, Number(key) || 1);
		}
		return max;
	}

	canLevelUp(id: SkillId): boolean {
		return this.levels[id] < this.maxLevel(id);
	}

	/** 다음 숙련 단계 스펙 (없으면 null) */
	nextLevelSpec(id: SkillId): { level: number; name: string; desc: string } | null {
		const next = this.levels[id] + 1;
		const step = this.catalog[id].levels?.[String(next)];
		return step ? { level: next, name: step.name, desc: step.desc } : null;
	}

	levelUpSkill(id: SkillId): boolean {
		if (!this.canLevelUp(id)) {
			return false;
		}
		this.levels[id] += 1;
		this.mergedMods = null;
		const ui = this.icons[id];
		if (ui) {
			ui.lastRatio = -1;
			ui.lastSeconds = -1;
			ui.label.setText(this.hudLabel(id));
		}
		return true;
	}

	setLevels(levels: Record<string, number>): void {
		for (const id of SKILL_IDS) {
			this.levels[id] = Math.max(1, Math.min(this.maxLevel(id), Math.round(levels[id] ?? 1)));
		}
		this.mergedMods = null;
		for (const id of SKILL_IDS) {
			this.icons[id]?.label.setText(this.hudLabel(id));
		}
	}

	private hudLabel(id: HudId): string {
		const node = skillNode(id);
		if (node) {
			return node.name.replace(/\s+/g, '').slice(0, 4);
		}
		if (id === 'ult') {
			return this.catalog.ult.short;
		}
		const skill = id as SkillId;
		const spec = this.catalog[skill];
		const level = this.levels[skill];
		return level > 1 ? `${spec.short} ${'Ⅰ Ⅱ Ⅲ Ⅳ'.split(' ')[level - 1] ?? level}` : spec.short;
	}

	/** 이 스킬의 실제 쿨다운 (ms) */
	cooldownMs(id: SkillId): number {
		// 키퍼 고유 메커닉: TALON [질풍 보법] 은 대시 재사용이 절반이다
		const keeperMult = this.scene.keeper?.skillCooldownMult?.(id) ?? 1;
		// 증강 [잔상 보법]: 대시 재사용 -30%
		const augMult = id === 'dash' ? this.mods.dashCooldownMult : 1;
		// 스킬 트리: 전체 -n% (침착) · 활공/대시 전용 감소
		const tree = this.scene.skillTree?.mods;
		const treeMult = (tree?.skillCooldownMult ?? 1)
			* (id === 'dive' ? (tree?.diveCooldownMult ?? 1) : 1)
			* (id === 'dash' ? (tree?.dashCooldownMult ?? 1) : 1)
			* (this.scene.skillTree?.dynamicCooldownMult?.() ?? 1);
		return Math.max(400, Math.round(this.catalog[id].cooldownMs * this.cooldownMult * keeperMult * augMult * this.levelCooldownMult(id) * treeMult));
	}

	isReady(id: SkillId): boolean {
		return (this.scene.time?.now ?? 0) >= this.readyAt[id];
	}

	/**
	 * 남은 쿨다운 (ms).
	 * scene.time.now 는 소수점이 있는 float 라 (now + cd) - now 가 cd 를 아주 살짝
	 * 넘길 수 있다(부동소수점). ms 해상도로 반올림해 그 잡음을 없앤다.
	 */
	remainingMs(id: SkillId): number {
		return Math.max(0, Math.round(this.readyAt[id] - (this.scene.time?.now ?? 0)));
	}

	/** 지금 스킬을 쓸 수 있는 상황인가 (마을·오버레이·사망 중에는 전부 잠긴다) */
	canAct(): boolean {
		const scene = this.scene;
		return Boolean(
			!this.destroyed
			&& scene.player
			&& !scene.player.isDead
			&& !scene.isGameOver
			&& !scene.isPaused
			&& !scene.levelUpSystem?.isOpen
			&& !scene.shopSystem?.isOpen
			&& !scene.augmentSystem?.isOpen
			&& !scene.skillWindow?.isOpen
			&& !scene.villageSystem?.isActive,
		);
	}

	private startCooldown(id: SkillId): void {
		this.readyAt[id] = (this.scene.time?.now ?? 0) + this.cooldownMs(id);
		this.useCount[id] += 1;
		const ui = this.icons[id];
		if (ui) {
			ui.lastRatio = -1;
			ui.lastSeconds = -1;
		}
	}

	// ---------------------------------------------------------------
	// 활공 사냥 — 무리 전체 강제 STRIKE
	// ---------------------------------------------------------------

	/** @returns 실제로 발동했는가 (사냥감이 없으면 쿨다운을 쓰지 않는다) */
	/**
	 * @param force  true 면 쿨다운을 무시하고 쿨다운도 시작하지 않는다 (스킬 트리 급강하·반격 폭풍)
	 * @param nearest true 면 커서 대신 플레이어 주변 가까운 적을 노린다 (반격 폭풍)
	 */
	useDive(force = false, nearest = false): boolean {
		if (!this.canAct() || (!force && !this.isReady('dive'))) {
			return false;
		}
		const scene = this.scene;
		const player = scene.player;
		const orbit = scene.swordOrbit;
		if (!orbit || orbit.swords.length === 0) {
			return false;
		}

		const spec = this.catalog.dive;
		// 커서를 쓰지 않는다 (2026-09-04 규칙): 이동 방향 → 없으면 바라보는 쪽, 탐색 반경의 절반 앞
		const point = nearest ? { x: player.x, y: player.y } : this.facingPoint(spec.searchRadius * 0.5);
		const angle = Math.atan2(point.y - player.y, point.x - player.x);

		const count = this.collectCandidates(point.x, point.y, spec.searchRadius, spec.maxCandidates)
			|| this.collectCandidates(player.x, player.y, spec.searchRadius * 1.2, spec.maxCandidates);

		if (count === 0) {
			// 사냥감이 없으면 쿨다운을 소모하지 않는다 — 헛발질로 12초를 잃지 않게
			scene.visualEffects?.fxRing(player.x, player.y, {
				r0: 12, r1: 54, w: 2, color: 0x6b7680, alpha: 0.6, dur: 220,
			});
			return false;
		}

		const now = scene.time.now;
		// 숙련 Ⅲ: 보너스 창이 길어진다
		const bonusUntil = now + spec.bonusWindowMs * this.levelValue('dive', 'bonusWindowMult');
		const impactPct = this.levelValue('dive', 'impactPct');
		const avgHit = impactPct > 0 ? (scene.augmentSystem?.avgSwordDamage?.() ?? 30) : 0;
		// 증강 [활공의 이빨]: 이 출격의 보너스가 통째로 커진다
		const bonusMult = 1 + spec.damageBonus + this.mods.diveDamageBonusAdd;
		let dispatched = 0;

		for (let i = 0; i < orbit.swords.length; i += 1) {
			const sword = orbit.swords[i];
			const target = CANDIDATES[i % count];
			if (!orbit.isValidEnemy(target)) {
				continue;
			}
			// 이미 STRIKE 중인 검은 대상만 재지정된다 (startLaunchedSword 가 처리)
			orbit.startLaunchedSword(sword, target);
			sword._diveBonusUntil = bonusUntil;
			sword._diveBonusMult = bonusMult;
			dispatched += 1;
			// 스킬 트리 [표식]
			if (i < count) {
				scene.skillTree?.markTarget?.(target);
			}
			// 숙련 Ⅲ: 지목된 사냥감마다 착탄 충격파 (같은 적은 한 번)
			if (impactPct > 0 && i < count) {
				const amount = Math.max(1, Math.round(avgHit * impactPct));
				scene.enemyManager?.takeDamage(target, amount, player, { damageType: 'physical' });
				scene.visualEffects?.fxRing(target.x, target.y, { r0: 8, r1: 30, w: 2, color: 0xffb04a, alpha: 0.8, dur: 200 });
			}
		}

		if (dispatched === 0) {
			return false;
		}

		if (!force) {
			this.startCooldown('dive');
		}
		// 증강 [매서운 조준]: 활공 직후 짧은 치명타 창
		this.openCritWindow(now);
		scene.visualEffects?.diveHuntFX(player.x, player.y, angle);
		scene.soundSystem?.play('crit', { volume: 0.7 });
		return true;
	}

	/** 활공 치명타 창 시작 (증강이 없으면 아무 일도 하지 않는다). */
	private openCritWindow(now: number): void {
		const window = this.mods.diveCritWindow;
		const player = this.scene.player;
		if (!window || !player) {
			return;
		}
		// 이미 창이 열려 있으면 가산치는 그대로 두고 만료만 미룬다 (중복 가산 방지)
		if (this.critWindowAdded === 0) {
			this.critWindowAdded = window.critChanceAdd;
			player.critChance = (player.critChance ?? 0) + window.critChanceAdd;
		}
		this.critWindowUntil = now + window.durationMs;
	}

	/** 창이 끝나면 얹었던 치명타율을 정확히 되돌린다. */
	private closeCritWindow(): void {
		const player = this.scene.player;
		if (this.critWindowAdded > 0 && player) {
			player.critChance = Math.max(0, (player.critChance ?? 0) - this.critWindowAdded);
		}
		this.critWindowAdded = 0;
		this.critWindowUntil = 0;
	}

	/** 지금 활공 치명타 창이 열려 있는가 (테스트/HUD 판정용). */
	get isCritWindowOpen(): boolean {
		return (this.scene.time?.now ?? 0) < this.critWindowUntil;
	}

	// ---------------------------------------------------------------
	// 귀소 — 무리 즉시 귀환 + 넉백 + 짧은 무적
	// ---------------------------------------------------------------

	useRecall(): boolean {
		if (!this.canAct() || !this.isReady('recall')) {
			return false;
		}
		const scene = this.scene;
		const player = scene.player;
		const orbit = scene.swordOrbit;
		if (!orbit) {
			return false;
		}

		const spec = this.catalog.recall;
		const now = scene.time.now;

		for (const sword of orbit.swords) {
			if (sword.state !== 'orbiting') {
				orbit.startReturningSword(sword);
			}
			// 귀환 중 남은 활공 보너스는 여기서 끊는다 (귀소는 방어 행동이다)
			sword._diveBonusUntil = 0;
		}

		// 보스 스킬 '검 봉인' 파훼 — 무리를 불러들이면 사슬이 끊어진다 (2026-09-02)
		const unsealed = orbit.clearSeals();
		if (unsealed > 0) {
			scene.visualEffects?.showDamageText?.(player.x, player.y - 60, '봉인 해제', false, '#9bd66a');
		}

		const mods = this.mods;
		// 증강 [귀소의 방벽]: 무적 연장
		player.invulnerableUntil = Math.max(
			player.invulnerableUntil ?? 0,
			now + spec.invulnerableMs + mods.recallInvulnAddMs,
		);
		this.recallSweepUntil = now + spec.sweepMs;
		this.recallStartedAt = now;
		this.startCooldown('recall');

		// 숙련 Ⅲ: 시전 시 체력 회복 (예산 밖 — 12초 쿨다운 스킬의 보상)
		const healPct = this.levelValue('recall', 'healPct');
		if (healPct > 0) {
			const heal = Math.max(1, Math.round(player.maxHp * healPct));
			player.hp = Math.min(player.maxHp, player.hp + heal);
			scene.visualEffects?.showDamageText?.(player.x, player.y - 46, `+${heal}`, false, '#84b04a');
		}

		// 증강 [귀소의 방벽]: 귀환 직후 잠깐 빨라진다 (거리를 벌리는 용도)
		if (mods.recallSpeedBoost) {
			this.speedBoostUntil = now + mods.recallSpeedBoost.durationMs;
			this.speedBoostMult = mods.recallSpeedBoost.mult;
		}

		// 증강 [귀소의 소용돌이]: 넉백 반경이 넓어진다
		const radiusMult = 1 + mods.recallKnockbackRadiusAdd;
		// 시전 즉시 플레이어 주변도 한 번 밀어낸다 (붙어 있는 적을 떼어내는 것이 목적)
		this.pushEnemiesAround(player.x, player.y, orbit.radius * 0.9 * radiusMult, spec.knockbackForce);

		// 날아드는 적 투사체를 쳐낸다 — 결집 사수의 유도탄에 대한 답
		scene.enemyManager?.clearProjectilesNear?.(player.x, player.y, orbit.radius * 1.35 * radiusMult);

		scene.visualEffects?.recallFX(player.x, player.y, orbit.radius);
		scene.soundSystem?.play('revive', { volume: 0.45 });
		return true;
	}

	/** 잠시 이동속도 상승 (귀소의 방벽 · 트리 [바람의 길]) */
	applySpeedBoost(mult: number, durationMs: number): void {
		const now = this.scene.time?.now ?? 0;
		this.speedBoostUntil = Math.max(this.speedBoostUntil, now + durationMs);
		this.speedBoostMult = Math.max(this.speedBoostMult, mult);
	}

	/** 귀소 후 이동속도 배율 (증강 [귀소의 방벽]). GameScene.update 가 곱한다. */
	moveSpeedMult(now: number): number {
		return now < this.speedBoostUntil ? 1 + this.speedBoostMult : 1;
	}

	// ---------------------------------------------------------------
	// 대시 — 이동 방향으로 짧게
	// ---------------------------------------------------------------

	useDash(): boolean {
		if (!this.canAct() || !this.isReady('dash')) {
			return false;
		}
		const scene = this.scene;
		const player = scene.player;
		const spec = this.catalog.dash;

		let dirX = scene.getHorizontalInput();
		let dirY = scene.getVerticalInput();
		if (dirX === 0 && dirY === 0) {
			// 정지 중이면 바라보는 쪽으로
			dirX = player.flipX ? -1 : 1;
		}
		const length = Math.hypot(dirX, dirY) || 1;
		dirX /= length;
		dirY /= length;

		const now = scene.time.now;
		const mods = this.mods;
		// 거리 120px / 0.15초 = 800px/s. 기본 이동(350)의 2.3배 — 청크 로드 반경에
		// 여유가 없으므로 이보다 키우지 말 것 (경계 프레임에 빈 땅이 비친다).
		// 증강 [도약 일격]은 거리를 늘리되 시간도 함께 늘려 속도는 그대로 둔다.
		const distance = spec.distance * (1 + mods.dashDistanceAdd);
		const durationMs = spec.durationMs * (1 + mods.dashDistanceAdd);
		const speed = (distance / durationMs) * 1000;
		player.setVelocity(dirX * speed, dirY * speed);
		player.setFlipX(dirX < 0);
		this.dashUntil = now + durationMs;
		this.dashStartedAt = now;

		// 증강 [도약 일격]: 대시 직후 무리 전체의 출격 피해가 오른다
		const strike = mods.dashStrikeBonus;
		if (strike && scene.swordOrbit) {
			const until = now + strike.windowMs;
			const mult = 1 + strike.mult;
			for (const sword of scene.swordOrbit.swords) {
				sword._diveBonusUntil = Math.max(sword._diveBonusUntil ?? 0, until);
				sword._diveBonusMult = Math.max(sword._diveBonusMult ?? 1, mult);
			}
		}
		// GameScene.update 는 knockbackUntil 이 지나야 이동 입력으로 속도를 덮어쓴다 —
		// 같은 장치를 빌려 대시 동안 속도를 지킨다 (isKnockedBack 플래그는 건드리지 않는다).
		player.knockbackUntil = Math.max(player.knockbackUntil ?? 0, this.dashUntil);
		this.lastGhostAt = 0;
		this.startCooldown('dash');
		scene.skillTree?.onDash?.();

		scene.visualEffects?.dashGhostFX(player);
		scene.soundSystem?.play('click', { volume: 0.5 });
		return true;
	}

	/** 대시 중인가 (무적은 없다 — 표시/테스트용) */
	get isDashing(): boolean {
		return (this.scene.time?.now ?? 0) < this.dashUntil;
	}

	// ---------------------------------------------------------------
	// 필살기 — 게이지형 (2026-09-04)
	// ---------------------------------------------------------------

	get isUltReady(): boolean {
		return this.ultCharge >= 1 - 1e-6;
	}

	/** 게이지 충전. 처치(종류별)·피격에서 GameScene 이 부른다. */
	addUltCharge(amount: number): void {
		if (this.destroyed || !(amount > 0)) {
			return;
		}
		const before = this.ultCharge;
		this.ultCharge = Math.min(1, this.ultCharge + amount * (this.scene.skillTree?.mods.ultChargeMult ?? 1));
		const ui = this.icons.ult;
		if (ui) {
			ui.lastRatio = -1;
		}
		if (before < 1 && this.ultCharge >= 1 && !this.ultReadyAnnounced) {
			this.ultReadyAnnounced = true;
			const element = this.scene.swordOrbit?.dominantElement?.();
			const label = element ? (ELEMENT_KO[element] ?? element) : '검풍';
			this.scene.waveSystem?.announce?.(`필살기 준비 — ${actionKeyLabel('ult')} · ${label}`, '#e879f9');
			this.scene.soundSystem?.play('chest', { volume: 0.5 });
		}
	}

	/** 게이지를 직접 세팅 (배율 없이 — 시작의 불꽃·세이브 복원) */
	setUltCharge(value: number): void {
		this.ultCharge = Math.max(0, Math.min(1, value));
		const ui = this.icons.ult;
		if (ui) {
			ui.lastRatio = -1;
		}
	}

	/** 처치 종류에 따른 충전량 */
	chargeForKill(enemy: EnemySprite | undefined): number {
		const spec = this.catalog.ult;
		const catalog = enemy?.catalog;
		if (!catalog || catalog.isReaper) {
			return 0;
		}
		if (catalog.isBoss) return spec.chargePerBoss;
		if (catalog.isMiniboss) return spec.chargePerMiniboss;
		if (catalog.isElite) return spec.chargePerElite;
		return spec.chargePerKill;
	}

	/**
	 * 필살기 발동. 게이지가 다 차 있어야 하고, 장착 검의 주 원소 필살기를 쓴다
	 * (원소 검이 없으면 바람 — 밀쳐내기).
	 * @returns 실제로 발동했는가
	 */
	useUltimate(): boolean {
		if (!this.canAct() || !this.isUltReady) {
			if (this.canAct() && this.scene.player) {
				// 아직 안 찼다는 피드백 (짧은 회색 링)
				this.scene.visualEffects?.fxRing(this.scene.player.x, this.scene.player.y, {
					r0: 10, r1: 40, w: 2, color: 0x6b7680, alpha: 0.5, dur: 200,
				});
			}
			return false;
		}
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const player = scene.player;
		if (!orbit || !player) {
			return false;
		}
		const spec = this.catalog.ult;
		const element = orbit.dominantElement?.() ?? 'wind';
		// 기준 피해 = 평균 검 1타(성장·가산 배율 포함) × (배율 + 트리 공명 증폭)
		const tree = scene.skillTree?.mods;
		const avgHit = scene.augmentSystem?.avgSwordDamage?.() ?? 30;
		const damageBase = Math.max(1, Math.round(avgHit * (spec.damageMult + (tree?.ultDamageAdd ?? 0))));

		this.ultCharge = 0;
		this.ultReadyAnnounced = false;
		this.ultUseCount += 1;
		this.lastUltElement = element;
		const ui = this.icons.ult;
		if (ui) {
			ui.lastRatio = -1;
		}

		// 보스 파훼: 예고 취소 + 시전 정지
		const interrupted = scene.enemyManager?.interruptBossCasts?.(player.x, player.y, spec.interruptRadius) ?? 0;
		orbit.castUltimate(element, player, {
			damageBase,
			radiusMult: spec.radiusMult * (1 + (tree?.ultRadiusAdd ?? 0)),
			bossBonusPctMaxHp: spec.bossBonusPctMaxHp,
		});
		scene.skillTree?.onUltCast?.(element);
		scene.visualEffects?.hitStop?.(90, { force: true });
		if (interrupted > 0) {
			scene.waveSystem?.announce?.('필살기 — 보스의 시전을 끊었다', '#e879f9');
		}
		scene.soundSystem?.play('bigkill', { volume: 0.7 });
		return true;
	}

	// ---------------------------------------------------------------
	// 매 프레임
	// ---------------------------------------------------------------

	update(_delta = 16): void {
		if (this.destroyed) {
			return;
		}
		const scene = this.scene;
		const now = scene.time.now;

		// 활공 치명타 창 만료 — 얹었던 치명타율을 반드시 되돌린다
		if (this.critWindowAdded > 0 && now >= this.critWindowUntil) {
			this.closeCritWindow();
		}

		// 대시 잔상 (풀 재사용 고스트 — 새 오브젝트 없음)
		if (now < this.dashUntil && scene.player) {
			if (now - this.lastGhostAt >= this.catalog.dash.ghostIntervalMs) {
				this.lastGhostAt = now;
				scene.visualEffects?.dashGhostFX(scene.player);
			}
			// 증강 [잔상 보법]: 잔상이 스치는 적에게 피해 (대시 1회당 적 1회)
			if (this.mods.dashGhostDamagePct > 0) {
				this.sweepDashGhost(now);
			}
		}

		// 귀소 넉백: 귀환 중인 검 궤적이 닿는 적을 밀어낸다.
		// 창이 열려 있는 0.5초 동안만 돌고, 적마다 knockbackUntil 로 중복을 막는다.
		if (now < this.recallSweepUntil) {
			this.sweepReturningSwords(now);
		}

		this.updateHud(now);
	}

	/** 귀환 중인 검 주변의 적을 플레이어 반대 방향으로 밀어낸다. */
	private sweepReturningSwords(now: number): void {
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const player = scene.player;
		const manager = scene.enemyManager;
		if (!orbit || !player || !manager?.queryRadius) {
			return;
		}
		const spec = this.catalog.recall;
		const mods = this.mods;
		// 증강 [귀소의 소용돌이]: 궤적 반경 확대 + 궤적 피해
		const sweepRadius = spec.sweepRadius * (1 + mods.recallKnockbackRadiusAdd);
		const sweepRadiusSq = sweepRadius * sweepRadius;
		const damagePct = mods.recallSweepDamagePct;

		for (const sword of orbit.swords) {
			if (sword.state !== 'returning') {
				continue;
			}
			const found = manager.queryRadius(sword.x, sword.y, sweepRadius, SWEEP_BUFFER);
			for (const enemy of found) {
				if (!orbit.isValidEnemy(enemy)) {
					continue;
				}
				const dx = enemy.x - sword.x;
				const dy = enemy.y - sword.y;
				if (dx * dx + dy * dy > sweepRadiusSq) {
					continue;
				}
				// 궤적 피해는 이 귀소에서 적 1기당 1회 (넉백 창과 별개로 판정한다)
				if (damagePct > 0 && enemy.recallSweepAt !== this.recallStartedAt) {
					enemy.recallSweepAt = this.recallStartedAt;
					const amount = Math.max(1, Math.round(sword.damage * damagePct));
					manager.takeDamage(enemy, amount, player, {
						damageType: sword.definition?.damageType,
						element: sword.definition?.element,
					});
				}
				if (now < (enemy.knockbackUntil ?? 0)) {
					continue;
				}
				this.pushEnemy(enemy, player.x, player.y, spec.knockbackForce, now);
			}
		}
	}

	/**
	 * 대시 잔상 피해 (증강 [잔상 보법]).
	 * 대시 1회당 적 1기에 1번만 들어간다 — dashGhostAt 에 대시 시작 시각을 찍어 중복을 막는다.
	 */
	private sweepDashGhost(now: number): void {
		const scene = this.scene;
		const player = scene.player;
		const orbit = scene.swordOrbit;
		const manager = scene.enemyManager;
		if (!player || !orbit || !manager?.queryRadius) {
			return;
		}
		// 잔상 피해 기준값 = 가장 센 검의 피해 (검이 없으면 발동하지 않는다)
		let base = 0;
		for (const sword of orbit.swords) {
			if (sword.damage > base) {
				base = sword.damage;
			}
		}
		if (base <= 0) {
			return;
		}
		const amount = Math.max(1, Math.round(base * this.mods.dashGhostDamagePct));
		const radius = 46;
		const found = manager.queryRadius(player.x, player.y, radius, QUERY_BUFFER);
		for (const enemy of found) {
			if (!orbit.isValidEnemy(enemy) || enemy.dashGhostAt === this.dashStartedAt) {
				continue;
			}
			const dx = enemy.x - player.x;
			const dy = enemy.y - player.y;
			if (dx * dx + dy * dy > radius * radius) {
				continue;
			}
			enemy.dashGhostAt = this.dashStartedAt;
			manager.takeDamage(enemy, amount, player, { damageType: 'physical' });
			if (now >= (enemy.knockbackUntil ?? 0)) {
				this.pushEnemy(enemy, player.x, player.y, 180, now);
			}
		}
	}

	/** (x, y) 반경 안의 적을 그 지점 바깥으로 밀어낸다. */
	private pushEnemiesAround(x: number, y: number, radius: number, force: number): void {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!manager?.queryRadius || !orbit) {
			return;
		}
		const now = this.scene.time.now;
		const found = manager.queryRadius(x, y, radius, QUERY_BUFFER);
		for (const enemy of found) {
			if (!orbit.isValidEnemy(enemy)) {
				continue;
			}
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			if (dx * dx + dy * dy > radius * radius) {
				continue;
			}
			this.pushEnemy(enemy, x, y, force, now);
		}
	}

	private pushEnemy(enemy: EnemySprite, fromX: number, fromY: number, force: number, now: number): void {
		if (!enemy.body) {
			return;
		}
		const resist = enemy.knockbackResist ?? 0;
		if (resist >= 1) {
			return;
		}
		const angle = Math.atan2(enemy.y - fromY, enemy.x - fromX);
		const push = force * (1 - resist);
		enemy.setVelocity(Math.cos(angle) * push, Math.sin(angle) * push);
		enemy.knockbackUntil = now + 200;
	}

	/**
	 * (x, y) 주변의 살아있는 적을 가까운 순으로 CANDIDATES 에 담는다.
	 * @returns 담긴 개수 (0이면 사냥감 없음)
	 */
	private collectCandidates(x: number, y: number, radius: number, limit: number): number {
		const manager = this.scene.enemyManager;
		const orbit = this.scene.swordOrbit;
		if (!orbit) {
			return 0;
		}
		const found = manager?.queryRadius
			? manager.queryRadius(x, y, radius, QUERY_BUFFER)
			: orbit.getEnemyChildren(orbit.enemyGroup);
		const maxDistSq = radius * radius;
		let count = 0;

		// 상위 k개 삽입 정렬 (배열 새로 만들지 않는다)
		for (const enemy of found) {
			if (!orbit.isValidEnemy(enemy)) {
				continue;
			}
			const dx = enemy.x - x;
			const dy = enemy.y - y;
			const distSq = dx * dx + dy * dy;
			if (distSq > maxDistSq) {
				continue;
			}
			if (count === limit && distSq >= CANDIDATE_DIST[count - 1]) {
				continue;
			}
			let index = count < limit ? count : limit - 1;
			while (index > 0 && CANDIDATE_DIST[index - 1] > distSq) {
				CANDIDATES[index] = CANDIDATES[index - 1];
				CANDIDATE_DIST[index] = CANDIDATE_DIST[index - 1];
				index -= 1;
			}
			CANDIDATES[index] = enemy;
			CANDIDATE_DIST[index] = distSq;
			if (count < limit) {
				count += 1;
			}
		}
		return count;
	}

	/** 이동 입력 방향(없으면 바라보는 쪽)으로 dist 만큼 앞의 지점 — 스킬 조준의 단일 규칙 */
	facingPoint(dist: number): { x: number; y: number } {
		const scene = this.scene;
		const player = scene.player;
		let dx = scene.getHorizontalInput?.() ?? 0;
		let dy = scene.getVerticalInput?.() ?? 0;
		if (dx === 0 && dy === 0) {
			dx = player.flipX ? -1 : 1;
		}
		const angle = Math.atan2(dy, dx);
		return { x: player.x + Math.cos(angle) * dist, y: player.y + Math.sin(angle) * dist };
	}

	/** (구) 커서의 월드 좌표 — 스킬 조준에는 더 이상 쓰지 않는다 */
	private pointerWorldPoint(): { x: number; y: number } {
		const scene = this.scene;
		const pointer = scene.input.activePointer;
		const camera = scene.cameras.main;
		const px = pointer?.x ?? 0;
		const py = pointer?.y ?? 0;
		if (!pointer || (px === 0 && py === 0)) {
			// 마우스를 아직 쓰지 않은 상태 — 플레이어가 바라보는 쪽으로 던진다
			const player = scene.player;
			const dir = player?.flipX ? -1 : 1;
			return { x: (player?.x ?? 0) + dir * 240, y: player?.y ?? 0 };
		}
		return {
			x: camera.scrollX + px / (camera.zoom || 1),
			y: camera.scrollY + py / (camera.zoom || 1),
		};
	}

	// ---------------------------------------------------------------
	// HUD — 하단 화로 게이지 오른쪽의 쿨다운 아이콘 3개
	// ---------------------------------------------------------------

	private buildHud(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyHud();

		const scene = this.scene;
		const { width, height } = scene.scale;
		const hs = hudScaleFor(scene);

		// HudSystem.buildStatic 의 화로 게이지와 같은 좌표계 (겹치지 않게 오른쪽에 붙인다)
		const hpW = Math.min(430 * hs, width * 0.36);
		const hpH = 32 * hs;
		const hpX = width / 2 - hpW / 2;
		const hpY = height - hpH - 14 * hs;

		const size = 46 * hs;
		const gap = 10 * hs;
		const baseY = hpY + hpH / 2;
		const startX = hpX + hpW + 26 * hs + size / 2;

		// 배운 능동 스킬 전부가 아니라 **키에 등록된 것만** 띄운다 (2026-09-06 등록 상한 도입).
		// 키가 없는 스킬은 쏠 수 없으므로 HUD 에 '—' 로 남겨 두면 자리만 먹고 혼란만 준다.
		const ids: HudId[] = [
			...BUILTIN_HUD_IDS,
			...(scene.skillTree?.activeNodes?.().filter((node) => skillKey(node.id)).map((node) => node.id) ?? []),
		];
		ids.forEach((id, index) => {
			const row = Math.floor(index / HUD_PER_ROW);
			const col = index % HUD_PER_ROW;
			const x = startX + col * (size + gap);
			// 위 줄은 라벨·키 배지 높이까지 띄운다
			const cy = baseY - row * (size + 34 * hs);
			const node = skillNode(id);
			const spec = node
				? { icon: node.icon, short: node.name.replace(/\s+/g, '').slice(0, 4) }
				: this.catalog[id as SkillId | 'ult'];
			const frame = slot(scene, x, cy, size, 'gray').setScrollFactor(0).setDepth(1000);
			const glyph = iconImage(scene, spec.icon, x, cy, size * 0.5, id === 'ult' ? 0xe879f9 : node ? 0xf2d488 : 0xdfe6ea);
			(glyph as Phaser.GameObjects.Image).setScrollFactor?.(0);
			glyph.setDepth(1002);
			// 쿨다운 가림막: 아래에서 위로 줄어드는 어두운 fill (origin 하단 기준)
			const veil = scene.add.image(x, cy + size / 2 - 4 * hs, 'uf-fill-dark')
				.setOrigin(0.5, 1).setScrollFactor(0).setDepth(1003)
				.setDisplaySize(size - 8 * hs, 0).setAlpha(0.74);
			// 라벨은 동작 이름만 (아이콘 폭 46px 안에 들어간다).
			// 예전에는 `SPACE 귀소`처럼 키까지 한 줄에 붙였는데, 폭이 아이콘 간격(56px)을
			// 넘어 옆 칸 라벨과 글자가 겹쳤다 → 키는 아래 배지로 내린다.
			const label = scene.add.text(x, cy - size / 2 - 10 * hs, this.hudLabel(id),
				style(10.5 * hs, '#c3ccd3', { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
			label.setShadow(0, 1, '#000000', 2, false, true);

			// 키 배지 — 리맵을 반영하고, 패드가 붙어 있으면 패드 글리프로 바뀐다. 트리 스킬은 핫바 저장소.
			const keyName = skillKey(id);
			const keyText = node
				? (keyName ? keyLabel(keyName) : '—')
				: (GamepadSystem.everConnected
					? (PAD_GLYPHS[id as SkillId | 'ult'] ?? actionKeyLabel(id as SkillId | 'ult'))
					: actionKeyLabel(id as SkillId | 'ult'));
			const keyBadge = scene.add.text(x, cy - size / 2 - 24 * hs, keyText,
				style(9.5 * hs, '#8d9aa5', { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
			keyBadge.setShadow(0, 1, '#000000', 2, false, true);
			this.hudObjects.push(keyBadge);
			const timer = scene.add.text(x, cy, '', style(15 * hs, UI.white, { display: true }))
				.setOrigin(0.5).setScrollFactor(0).setDepth(1004);
			timer.setShadow(0, 2, '#000000', 3, false, true);

			this.icons[id] = {
				frame, glyph, veil, label, timer, lastRatio: -1, lastSeconds: -1, x, y: cy, size,
				veilW: size - 8 * hs, veilH: size - 8 * hs,
			};
			this.hudObjects.push(frame, glyph, veil, label, timer);
		});

		this.setVisible(this.hudVisible);
	}

	/** 트리 스킬 습득/키 변경 뒤 HUD 를 다시 그린다 */
	rebuildHud(): void {
		this.buildHud();
	}

	/** 쿨다운이 시작된 아이콘의 표시 가드를 리셋 */
	markHudDirty(id: HudId): void {
		const ui = this.icons[id];
		if (ui) {
			ui.lastRatio = -1;
			ui.lastSeconds = -1;
		}
	}

	/**
	 * 쿨다운 표시 갱신.
	 * 가림막 높이는 비율이 1% 넘게 바뀔 때만, 숫자는 초가 바뀔 때만 다시 그린다
	 * (매 프레임 setText 는 캔버스 재굽기 + GPU 업로드를 부른다).
	 */
	private paintCooldown(ui: SkillIconUi, ratio: number, leftMs: number): void {
		if (Math.abs(ratio - ui.lastRatio) > 0.01 || (ratio === 0 && ui.lastRatio !== 0)) {
			ui.lastRatio = ratio;
			ui.veil.setDisplaySize(ui.veilW, Math.max(0, ui.veilH * ratio));
			ui.veil.setVisible(ratio > 0.002);
			(ui.glyph as Phaser.GameObjects.Image).setAlpha?.(ratio > 0 ? 0.55 : 1);
			ui.frame.setTexture(ratio > 0 ? 'uf-slot-ghost' : 'uf-slot-gray');
		}
		const seconds = leftMs > 0 ? Math.ceil(leftMs / 1000) : 0;
		if (seconds !== ui.lastSeconds) {
			ui.lastSeconds = seconds;
			ui.timer.setText(seconds > 0 ? `${seconds}` : '');
		}
	}

	private updateHud(now: number): void {
		// 필살기: 가림막이 "남은 충전량" 을 보여준다 (다 차면 가림막 0 + 보라 테두리 명멸)
		const ult = this.icons.ult;
		if (ult && this.hudVisible) {
			const ratio = 1 - this.ultCharge;
			if (Math.abs(ratio - ult.lastRatio) > 0.01 || (ratio === 0 && ult.lastRatio !== 0)) {
				ult.lastRatio = ratio;
				ult.veil.setDisplaySize(ult.veilW, Math.max(0, ult.veilH * ratio));
				ult.veil.setVisible(ratio > 0.002);
				(ult.glyph as Phaser.GameObjects.Image).setAlpha?.(ratio > 0 ? 0.55 : 1);
				ult.frame.setTexture(ratio > 0 ? 'uf-slot-ghost' : 'uf-slot-gray');
			}
			const pct = Math.floor(this.ultCharge * 100);
			if (pct !== ult.lastSeconds) {
				ult.lastSeconds = pct;
				ult.timer.setText(pct >= 100 ? '' : `${pct}%`);
			}
			if (this.isUltReady) {
				(ult.glyph as Phaser.GameObjects.Image).setAlpha?.(0.75 + 0.25 * Math.sin(now / 120));
			}
		}
		// 트리 능동 스킬 — 쿨다운은 SkillTreeSystem 이 들고 있다
		const tree = this.scene.skillTree;
		if (tree && this.hudVisible) {
			for (const id of Object.keys(this.icons)) {
				if (id === 'ult' || (SKILL_IDS as string[]).includes(id)) {
					continue;
				}
				const ui = this.icons[id]!;
				const total = tree.cooldownMs(id);
				const left = tree.remainingMs(id);
				this.paintCooldown(ui, total > 0 ? left / total : 0, left);
			}
		}
		for (const id of SKILL_IDS) {
			const ui = this.icons[id];
			if (!ui || !this.hudVisible) {
				continue;
			}
			const total = this.cooldownMs(id);
			const left = Math.max(0, this.readyAt[id] - now);
			const ratio = total > 0 ? left / total : 0;

			if (Math.abs(ratio - ui.lastRatio) > 0.01 || (ratio === 0 && ui.lastRatio !== 0)) {
				ui.lastRatio = ratio;
				ui.veil.setDisplaySize(ui.veilW, Math.max(0, ui.veilH * ratio));
				ui.veil.setVisible(ratio > 0.002);
				(ui.glyph as Phaser.GameObjects.Image).setAlpha?.(ratio > 0 ? 0.55 : 1);
				ui.frame.setTexture(ratio > 0 ? 'uf-slot-ghost' : 'uf-slot-gray');
			}

			const seconds = left > 0 ? Math.ceil(left / 1000) : 0;
			if (seconds !== ui.lastSeconds) {
				ui.lastSeconds = seconds;
				ui.timer.setText(seconds > 0 ? `${seconds}` : '');
			}
		}
	}

	/** 스킬 아이콘의 화면 사각형 (튜토리얼 하이라이트용). 없으면 null. */
	iconRect(id: HudId): { x: number; y: number; w: number; h: number } | null {
		const ui = this.icons[id];
		if (!ui) {
			return null;
		}
		return { x: ui.x - ui.size / 2, y: ui.y - ui.size / 2, w: ui.size, h: ui.size };
	}

	setVisible(visible: boolean): void {
		this.hudVisible = visible;
		for (const object of this.hudObjects) {
			(object as Phaser.GameObjects.Image).setVisible?.(visible);
		}
		if (visible) {
			// 다시 보일 때 가림막·숫자를 즉시 재계산
			for (const ui of Object.values(this.icons)) {
				if (ui) {
					ui.lastRatio = -1;
					ui.lastSeconds = -1;
				}
			}
		}
	}

	private destroyHud(): void {
		for (const object of this.hudObjects) {
			this.scene.tweens.killTweensOf(object);
			object.destroy();
		}
		this.hudObjects = [];
		this.icons = {};
	}

	destroy(): void {
		this.destroyed = true;
		// 치명타 창이 열린 채로 파괴되면 플레이어 스탯에 가산치가 남는다
		this.closeCritWindow();
		const keyboard = this.scene.input?.keyboard;
		keyboard?.off('keydown', this.onKeyDown);
		this.unbindKeybinds?.();
		this.unbindKeybinds = null;
		this.scene.input?.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
		this.scene.scale.off('resize', this.buildHud, this);
		this.destroyHud();
	}
}
