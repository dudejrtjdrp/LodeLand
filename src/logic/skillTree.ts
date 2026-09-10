// 스킬 트리 — 순수 로직 (2026-09-04). Phaser import 금지.
//
// 데이터는 src/data/skillTree.json. **12갈래 99노드 (능동 21 / 패시브 78)** — 대부분 레벨제.
// 능동 스킬은 배우는 데 제한이 없지만 **키에 등록하는 것은 10개까지**다
// (core/skillHotbar.MAX_REGISTERED_SKILLS) — 남는 포인트가 패시브로 흘러가게 하는 장치다.
// 패시브 노드를 더할 때는 scripts/add-passive-nodes.py 를 쓴다 (누적 방식 함정 주석 참조).
// 포인트: 키퍼 레벨업마다 10 (pointsPerLevel) → 가용 포인트 = (레벨-1)×10 + 보너스 − 배운 비용 합.
// 카운터를 따로 저장하지 않고 항상 배운 목록에서 유도한다 — 세이브가 어긋나지 않는다.

import rawTree from '../data/skillTree.json';

export type SkillNodeKind = 'passive' | 'active';

export interface SkillActiveSpec {
	type: string;
	cooldownMs: number;
	[param: string]: number | string | undefined;
}

export interface SkillPassiveSpec {
	/** 기존 능동 스킬 숙련 단계 (dive/recall/dash → 2 | 3) */
	skillLevel?: Record<string, number>;
	damageMultAdd?: number;
	maxHpMult?: number;
	defenseAdd?: number;
	critChanceAdd?: number;
	moveSpeedMult?: number;
	hpRegenAdd?: number;
	goldBonusAdd?: number;
	luckAdd?: number;
	xpMultAdd?: number;
	bonusHits?: number;
	cleave?: number;
	healBudgetAdd?: number;
	ultChargeMult?: number;
	ultDamageAdd?: number;
	ultRadiusAdd?: number;
	skillCooldownMult?: number;
	diveCooldownMult?: number;
	dashCooldownMult?: number;
	dashGhostDamagePct?: number;
	diveDamageBonusAdd?: number;
	swordDiscount?: number;
	chestGoldMult?: number;
	goldOnHitChance?: number;
	huntMark?: number;
	counterStorm?: number;
	unyielding?: number;
	roundStartCharge?: number;
	dualResonance?: number;
	afterglow?: { mult: number; durationMs: number };
	dashWind?: { mult: number; durationMs: number; resetAfterMs: number };
	phoenix?: { healPct: number; invulnMs: number };
	// ── 2026-09-04 추가 갈래 (천둥·그림자·서리·광기)
	chainOnHit?: { chance: number; pct: number };
	slowedDamageAdd?: number;
	frozenDamageAdd?: number;
	extraBolts?: number;
	ultLightning?: number;
	critDamageAdd?: number;
	executeThreshold?: number;
	executeExplode?: number;
	shadowStep?: { mult: number; afterMs: number };
	frostAura?: number;
	frostAuraRadiusMult?: number;
	shatter?: number;
	lowHpRage?: number;
	killHaste?: { mult: number; stacks: number; durationMs: number };
	lastStand?: number;
	bloodArmor?: { perPct: number; cap: number };
}

export interface SkillNode {
	id: string;
	branch: string;
	tier: number;
	name: string;
	icon: string;
	cost: number;
	requires?: string[];
	kind: SkillNodeKind;
	desc: string;
	/** 스킬 이야기 (상세 페이지 하단 로어) */
	lore?: string;
	passive?: SkillPassiveSpec;
	active?: SkillActiveSpec;
}

export interface SkillBranch {
	id: string;
	name: string;
	desc: string;
	color: string;
	icon: string;
}

interface SkillTreeData {
	pointsPerLevel: number;
	branches: SkillBranch[];
	nodes: SkillNode[];
}

export const SKILL_TREE = rawTree as unknown as SkillTreeData;
export const SKILL_BRANCHES: SkillBranch[] = SKILL_TREE.branches;
export const SKILL_NODES: SkillNode[] = SKILL_TREE.nodes;

const NODE_BY_ID = new Map<string, SkillNode>(SKILL_NODES.map((node) => [node.id, node]));

export function skillNode(id: string): SkillNode | null {
	return NODE_BY_ID.get(id) ?? null;
}

export function nodesOfBranch(branchId: string): SkillNode[] {
	return SKILL_NODES.filter((node) => node.branch === branchId);
}

// ------------------------------------------------------------------
// 스킬 레벨제 (2026-09-04)
//
// 노드는 1~maxLevel 사이의 레벨을 가진다. 레벨 1칸 = 1 포인트(스케일 노드) 이고,
// 효과는 레벨에 비례해 자란다 — JSON 의 값이 **만렙 값**이다.
//   · maxLevel = cost × 10, pointsPerLevel = 10
//     → 만렙까지 드는 캐릭터 레벨 수가 옛 단일랭크(cost)와 정확히 같다 (밸런스 중립).
//   · 스케일할 수치가 없는 노드([변형] · 숙련단계 · 객체형)는 단일 레벨(maxLevel 1)
//     이고 한 번에 cost × 10 포인트를 낸다.
// ------------------------------------------------------------------

/** 레벨로 스케일하지 않는 패시브 키 (객체형·숙련 단계) */
const NON_SCALABLE_KEYS = new Set([
	'skillLevel', 'afterglow', 'dashWind', 'phoenix', 'killHaste', 'bloodArmor', 'shadowStep',
]);
/** 1 을 기준으로 자라는 배율 키 (1 + (v-1)×L/M) */
const MULT_LIKE = new Set(['lastStand']);
/** 값이 작을수록 좋은 키 — 레벨이 낮으면 오히려 커진다 */
const INVERSE_KEYS = new Set(['counterStorm']);
/** 정수 키 — 반올림하되 레벨 1 부터 최소 1 */
const INT_KEYS = new Set(['bonusHits', 'cleave', 'extraBolts', 'bolts', 'chain']);
/** 능동 스펙에서 레벨 스케일을 하지 않는 키 */
const ACTIVE_FIXED = new Set(['type', 'intervalMs', 'delayMs', 'regenMs']);

function isMultKey(key: string): boolean {
	return key.endsWith('Mult') || MULT_LIKE.has(key);
}

/** 이 노드가 레벨을 쌓을 수 있는가 (수치가 자라는가) */
export function isLeveled(node: SkillNode): boolean {
	if (node.desc.startsWith('[변형]')) {
		return false; // 켜고 끄는 변형 노드 — 단일 레벨
	}
	if (node.active) {
		return true;
	}
	const keys = Object.keys(node.passive ?? {});
	return keys.some((key) => !NON_SCALABLE_KEYS.has(key));
}

/** 노드 최대 레벨 */
export function maxLevelOf(node: SkillNode): number {
	return isLeveled(node) ? node.cost * 10 : 1;
}

/** 레벨 1칸당 포인트 */
export function costPerLevel(node: SkillNode): number {
	return isLeveled(node) ? 1 : node.cost * 10;
}

/** 만렙까지 드는 총 포인트 */
export function totalCostOf(node: SkillNode): number {
	return maxLevelOf(node) * costPerLevel(node);
}

/** 레벨 L 에서의 수치 (M = 만렙) */
function scaleValue(key: string, value: number, level: number, max: number, active: boolean): number {
	const t = Math.max(0, Math.min(1, level / Math.max(1, max)));
	if (isMultKey(key)) {
		return 1 + (value - 1) * t;
	}
	if (INVERSE_KEYS.has(key)) {
		return value / Math.max(0.05, t);
	}
	if (key === 'cooldownMs') {
		return value * (1.35 - 0.35 * t);
	}
	// 능동 스펙 수치는 만렙 대비 45%에서 시작한다 (1레벨이 무용지물이 되지 않게)
	const raw = active ? value * (0.45 + 0.55 * t) : value * t;
	if (INT_KEYS.has(key)) {
		return value > 0 ? Math.max(1, Math.round(raw)) : Math.round(raw);
	}
	return raw;
}

/** 레벨 L 에서의 패시브 스펙 (원본은 건드리지 않는다) */
export function passiveAt(node: SkillNode, level: number): SkillPassiveSpec | undefined {
	const base = node.passive;
	if (!base || level <= 0) {
		return undefined;
	}
	const max = maxLevelOf(node);
	if (max <= 1) {
		return base;
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(base)) {
		if (typeof value === 'number' && !NON_SCALABLE_KEYS.has(key)) {
			out[key] = scaleValue(key, value, level, max, false);
		} else {
			out[key] = value;
		}
	}
	return out as SkillPassiveSpec;
}

/** 레벨 L 에서의 능동 스펙 */
export function activeAt(node: SkillNode, level: number): SkillActiveSpec | undefined {
	const base = node.active;
	if (!base || level <= 0) {
		return undefined;
	}
	const max = maxLevelOf(node);
	if (max <= 1) {
		return base;
	}
	const out: Record<string, unknown> = { type: base.type };
	for (const [key, value] of Object.entries(base)) {
		if (key === 'type') {
			continue;
		}
		out[key] = typeof value === 'number' && !ACTIVE_FIXED.has(key)
			? scaleValue(key, value, level, max, true)
			: value;
	}
	return out as SkillActiveSpec;
}

export type SkillLevels = Record<string, number>;

/** 레벨 맵을 정리 — 없는 노드/범위 밖 레벨을 걸러낸다 */
export function sanitizeLevels(levels: SkillLevels | undefined): SkillLevels {
	const out: SkillLevels = {};
	for (const [id, raw] of Object.entries(levels ?? {})) {
		const node = NODE_BY_ID.get(id);
		if (!node) {
			continue;
		}
		const level = Math.floor(Number(raw) || 0);
		if (level > 0) {
			out[id] = Math.min(maxLevelOf(node), level);
		}
	}
	return out;
}

/** 레벨 맵에서 쓴 포인트 합 */
export function spentPointsLeveled(levels: SkillLevels): number {
	let total = 0;
	for (const [id, level] of Object.entries(levels)) {
		const node = NODE_BY_ID.get(id);
		if (node) {
			total += Math.min(level, maxLevelOf(node)) * costPerLevel(node);
		}
	}
	return total;
}

/** 배운 노드 비용 합 (구 단일랭크 API — 배운 노드를 만렙으로 친다) */
export function spentPoints(learned: Iterable<string>): number {
	let total = 0;
	for (const id of learned) {
		const node = NODE_BY_ID.get(id);
		total += node ? totalCostOf(node) : 0;
	}
	return total;
}

/** 레벨 L 까지 누적 획득 포인트 */
export function earnedPoints(level: number, bonus = 0): number {
	return Math.max(0, Math.round((Math.max(1, level) - 1) * SKILL_TREE.pointsPerLevel)) + bonus;
}

export function availablePoints(level: number, learned: Iterable<string>, bonus = 0): number {
	return earnedPoints(level, bonus) - spentPoints(learned);
}

export function availablePointsLeveled(level: number, levels: SkillLevels, bonus = 0): number {
	return earnedPoints(level, bonus) - spentPointsLeveled(levels);
}

/** 선행 노드가 전부 배워졌는가 */
export function prerequisitesMet(id: string, learned: Set<string> | SkillLevels): boolean {
	const node = NODE_BY_ID.get(id);
	if (!node) {
		return false;
	}
	const has = (req: string) => (learned instanceof Set ? learned.has(req) : (learned[req] ?? 0) > 0);
	return (node.requires ?? []).every(has);
}

export type LearnBlock = 'unknown' | 'learned' | 'prereq' | 'points' | 'max';

/** 지금 한 칸 올릴 수 있는가. 못 올리면 이유. */
export function canLevelUp(id: string, level: number, levels: SkillLevels, bonus = 0): { ok: boolean; reason?: LearnBlock } {
	const node = NODE_BY_ID.get(id);
	if (!node) {
		return { ok: false, reason: 'unknown' };
	}
	const current = levels[id] ?? 0;
	if (current >= maxLevelOf(node)) {
		return { ok: false, reason: 'max' };
	}
	if (!prerequisitesMet(id, levels)) {
		return { ok: false, reason: 'prereq' };
	}
	if (availablePointsLeveled(level, levels, bonus) < costPerLevel(node)) {
		return { ok: false, reason: 'points' };
	}
	return { ok: true };
}

/** 구 API — 배운 적 없는 노드를 처음 배울 수 있는가 */
export function canLearn(id: string, level: number, learned: Set<string>, bonus = 0): { ok: boolean; reason?: LearnBlock } {
	const node = NODE_BY_ID.get(id);
	if (!node) {
		return { ok: false, reason: 'unknown' };
	}
	if (learned.has(id)) {
		return { ok: false, reason: 'learned' };
	}
	if (!prerequisitesMet(id, learned)) {
		return { ok: false, reason: 'prereq' };
	}
	if (availablePoints(level, learned, bonus) < node.cost) {
		return { ok: false, reason: 'points' };
	}
	return { ok: true };
}

/** 배운 노드들의 패시브를 한 객체로 합친다 (가산은 더하고, 배율은 곱하고, 객체형은 더 센 쪽). */
export interface TreeMods {
	skillLevel: Record<string, number>;
	damageMultAdd: number;
	maxHpMult: number;
	defenseAdd: number;
	critChanceAdd: number;
	moveSpeedMult: number;
	hpRegenAdd: number;
	goldBonusAdd: number;
	luckAdd: number;
	xpMultAdd: number;
	bonusHits: number;
	cleave: number;
	healBudgetAdd: number;
	ultChargeMult: number;
	ultDamageAdd: number;
	ultRadiusAdd: number;
	skillCooldownMult: number;
	diveCooldownMult: number;
	dashCooldownMult: number;
	dashGhostDamagePct: number;
	diveDamageBonusAdd: number;
	swordDiscount: number;
	chestGoldMult: number;
	goldOnHitChance: number;
	huntMark: number;
	counterStorm: number;
	unyielding: number;
	roundStartCharge: number;
	dualResonance: number;
	afterglow: { mult: number; durationMs: number } | null;
	dashWind: { mult: number; durationMs: number; resetAfterMs: number } | null;
	phoenix: { healPct: number; invulnMs: number } | null;
	chainOnHit: { chance: number; pct: number } | null;
	slowedDamageAdd: number;
	frozenDamageAdd: number;
	extraBolts: number;
	ultLightning: number;
	critDamageAdd: number;
	executeThreshold: number;
	executeExplode: number;
	shadowStep: { mult: number; afterMs: number } | null;
	frostAura: number;
	frostAuraRadiusMult: number;
	shatter: number;
	lowHpRage: number;
	killHaste: { mult: number; stacks: number; durationMs: number } | null;
	lastStand: number;
	bloodArmor: { perPct: number; cap: number } | null;
}

export function emptyTreeMods(): TreeMods {
	return {
		skillLevel: {}, damageMultAdd: 0, maxHpMult: 1, defenseAdd: 0, critChanceAdd: 0, moveSpeedMult: 1,
		hpRegenAdd: 0, goldBonusAdd: 0, luckAdd: 0, xpMultAdd: 0, bonusHits: 0, cleave: 0, healBudgetAdd: 0,
		ultChargeMult: 1, ultDamageAdd: 0, ultRadiusAdd: 0, skillCooldownMult: 1, diveCooldownMult: 1,
		dashCooldownMult: 1, dashGhostDamagePct: 0, diveDamageBonusAdd: 0, swordDiscount: 0, chestGoldMult: 1,
		goldOnHitChance: 0, huntMark: 0, counterStorm: 0, unyielding: 0, roundStartCharge: 0, dualResonance: 0,
		afterglow: null, dashWind: null, phoenix: null,
		chainOnHit: null, slowedDamageAdd: 0, frozenDamageAdd: 0, extraBolts: 0, ultLightning: 0, critDamageAdd: 0,
		executeThreshold: 0, executeExplode: 0, shadowStep: null, frostAura: 0, frostAuraRadiusMult: 1, shatter: 0,
		lowHpRage: 0, killHaste: null, lastStand: 0, bloodArmor: null,
	};
}

/** 배운 노드(만렙 취급)들의 패시브 합산 — 구 단일랭크 API */
export function aggregateTreeMods(learned: Iterable<string>): TreeMods {
	const levels: SkillLevels = {};
	for (const id of learned) {
		const node = NODE_BY_ID.get(id);
		if (node) {
			levels[id] = maxLevelOf(node);
		}
	}
	return aggregateTreeModsLeveled(levels);
}

/** 레벨 맵에 맞춰 패시브를 합산한다 */
export function aggregateTreeModsLeveled(levels: SkillLevels): TreeMods {
	const out = emptyTreeMods();
	for (const [id, level] of Object.entries(levels)) {
		const node = NODE_BY_ID.get(id);
		const p = node && level > 0 ? passiveAt(node, level) : undefined;
		if (!p) {
			continue;
		}
		if (p.skillLevel) {
			for (const [skill, level] of Object.entries(p.skillLevel)) {
				out.skillLevel[skill] = Math.max(out.skillLevel[skill] ?? 1, level);
			}
		}
		out.damageMultAdd += p.damageMultAdd ?? 0;
		out.maxHpMult *= p.maxHpMult ?? 1;
		out.defenseAdd += p.defenseAdd ?? 0;
		out.critChanceAdd += p.critChanceAdd ?? 0;
		out.moveSpeedMult *= p.moveSpeedMult ?? 1;
		out.hpRegenAdd += p.hpRegenAdd ?? 0;
		out.goldBonusAdd += p.goldBonusAdd ?? 0;
		out.luckAdd += p.luckAdd ?? 0;
		out.xpMultAdd += p.xpMultAdd ?? 0;
		out.bonusHits += p.bonusHits ?? 0;
		out.cleave += p.cleave ?? 0;
		out.healBudgetAdd += p.healBudgetAdd ?? 0;
		out.ultChargeMult *= p.ultChargeMult ?? 1;
		out.ultDamageAdd += p.ultDamageAdd ?? 0;
		out.ultRadiusAdd += p.ultRadiusAdd ?? 0;
		out.skillCooldownMult *= p.skillCooldownMult ?? 1;
		out.diveCooldownMult *= p.diveCooldownMult ?? 1;
		out.dashCooldownMult *= p.dashCooldownMult ?? 1;
		out.dashGhostDamagePct = Math.max(out.dashGhostDamagePct, p.dashGhostDamagePct ?? 0);
		out.diveDamageBonusAdd += p.diveDamageBonusAdd ?? 0;
		out.swordDiscount += p.swordDiscount ?? 0;
		out.chestGoldMult *= p.chestGoldMult ?? 1;
		out.goldOnHitChance += p.goldOnHitChance ?? 0;
		out.huntMark = Math.max(out.huntMark, p.huntMark ?? 0);
		out.counterStorm = p.counterStorm ? (out.counterStorm ? Math.min(out.counterStorm, p.counterStorm) : p.counterStorm) : out.counterStorm;
		out.unyielding += p.unyielding ?? 0;
		out.roundStartCharge = Math.max(out.roundStartCharge, p.roundStartCharge ?? 0);
		out.dualResonance = Math.max(out.dualResonance, p.dualResonance ?? 0);
		if (p.afterglow && (!out.afterglow || p.afterglow.mult > out.afterglow.mult)) out.afterglow = p.afterglow;
		if (p.dashWind) out.dashWind = p.dashWind;
		if (p.phoenix) out.phoenix = p.phoenix;
		if (p.chainOnHit && (!out.chainOnHit || p.chainOnHit.chance > out.chainOnHit.chance)) out.chainOnHit = p.chainOnHit;
		out.slowedDamageAdd += p.slowedDamageAdd ?? 0;
		out.frozenDamageAdd += p.frozenDamageAdd ?? 0;
		out.extraBolts += p.extraBolts ?? 0;
		out.ultLightning = Math.max(out.ultLightning, p.ultLightning ?? 0);
		out.critDamageAdd += p.critDamageAdd ?? 0;
		out.executeThreshold = Math.max(out.executeThreshold, p.executeThreshold ?? 0);
		out.executeExplode = Math.max(out.executeExplode, p.executeExplode ?? 0);
		if (p.shadowStep) out.shadowStep = p.shadowStep;
		out.frostAura = Math.max(out.frostAura, p.frostAura ?? 0);
		out.frostAuraRadiusMult *= p.frostAuraRadiusMult ?? 1;
		out.shatter = Math.max(out.shatter, p.shatter ?? 0);
		out.lowHpRage += p.lowHpRage ?? 0;
		if (p.killHaste) out.killHaste = p.killHaste;
		out.lastStand = p.lastStand ? (out.lastStand ? Math.min(out.lastStand, p.lastStand) : p.lastStand) : out.lastStand;
		if (p.bloodArmor) out.bloodArmor = p.bloodArmor;
	}
	return out;
}

/** 배운 능동 스킬 노드 (핫바 후보) */
export function learnedActives(learned: Iterable<string>): SkillNode[] {
	const out: SkillNode[] = [];
	for (const id of learned) {
		const node = NODE_BY_ID.get(id);
		if (node?.kind === 'active' && node.active) {
			out.push(node);
		}
	}
	return out;
}

/** 갈래에서 지금 볼 수 있는 노드 (선행 미달도 잠금 상태로 보여준다) */
export function branchProgress(branchId: string, levels: SkillLevels): { learned: number; total: number } {
	const nodes = nodesOfBranch(branchId);
	return { learned: nodes.filter((n) => (levels[n.id] ?? 0) > 0).length, total: nodes.length };
}

/** 저장/복원 시 유효하지 않은 id 를 걸러낸다 (카탈로그가 바뀐 구세이브 대비) */
export function sanitizeLearned(ids: Iterable<string>): string[] {
	const out: string[] = [];
	for (const id of ids) {
		if (NODE_BY_ID.has(id) && !out.includes(id)) {
			out.push(id);
		}
	}
	return out;
}
