// 스킬 효과 표 — 스킬 책 상세 페이지의 "현재 효과 / 다음 레벨 효과" 줄을 만든다 (2026-09-04).
// Phaser import 금지 (순수 로직).
//
// 노드의 패시브/능동 스펙에서 사람이 읽는 줄을 뽑는다. 키마다 라벨·아이콘·표기법이 정해져 있고,
// 어느 쪽이 좋은지(up/down)를 알려 다음 레벨 화살표 색을 정한다.

import { activeAt, maxLevelOf, passiveAt, type SkillNode } from './skillTree';

export interface EffectRow {
	key: string;
	/** 글리프 키 (theme.ts GLYPH_DRAWS) */
	icon: string;
	label: string;
	value: string;
	/** 값이 클수록 좋으면 'up', 작을수록 좋으면 'down' */
	better: 'up' | 'down';
	/** 정렬·비교용 원본 수치 */
	raw: number;
}

type Fmt = (v: number) => string;

const pct: Fmt = (v) => `${Math.round(v * 100)}%`;
const pctp: Fmt = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%p`;
const px: Fmt = (v) => `${Math.round(v)}px`;
const sec: Fmt = (v) => `${(v / 1000).toFixed(1)}초`;
const num: Fmt = (v) => `${Math.round(v * 10) / 10}`;
const cnt: Fmt = (v) => `${Math.round(v)}회`;
const deg: Fmt = (v) => `${Math.round((v * 180) / Math.PI)}°`;
/** 배율(1 기준) → 증감 퍼센트 */
const multp: Fmt = (v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;

interface Spec { icon: string; label: string; fmt: Fmt; better: 'up' | 'down' }

// ── 능동 스펙 키
const ACTIVE_SPECS: Record<string, Spec> = {
	damageMult: { icon: 'g-blade', label: '피해', fmt: pct, better: 'up' },
	dpsMult: { icon: 'g-blade', label: '초당 피해', fmt: pct, better: 'up' },
	orbitDamageMult: { icon: 'g-blade', label: '궤도 피해', fmt: pct, better: 'up' },
	orbitSpeedMult: { icon: 'g-spark', label: '궤도 회전', fmt: pct, better: 'up' },
	radius: { icon: 'g-ring', label: '공격 범위', fmt: px, better: 'up' },
	pushRadius: { icon: 'g-ring', label: '밀어내기 범위', fmt: px, better: 'up' },
	explodeRadius: { icon: 'g-ring', label: '폭발 반경', fmt: px, better: 'up' },
	length: { icon: 'g-ring', label: '사거리', fmt: px, better: 'up' },
	distance: { icon: 'g-boot', label: '이동 거리', fmt: px, better: 'up' },
	range: { icon: 'g-ring', label: '시전 거리', fmt: px, better: 'up' },
	halfWidth: { icon: 'g-ring', label: '폭', fmt: px, better: 'up' },
	halfAngle: { icon: 'g-ring', label: '부채꼴', fmt: deg, better: 'up' },
	cooldownMs: { icon: 'g-hourglass', label: '재사용 대기시간', fmt: sec, better: 'down' },
	durationMs: { icon: 'g-hourglass', label: '지속 시간', fmt: sec, better: 'up' },
	invulnMs: { icon: 'g-shield', label: '무적 시간', fmt: sec, better: 'up' },
	freezeMs: { icon: 'g-el-ice', label: '빙결 시간', fmt: sec, better: 'up' },
	healPct: { icon: 'g-rekindle', label: '즉시 회복', fmt: pct, better: 'up' },
	regenPct: { icon: 'g-rekindle', label: '초당 재생', fmt: pct, better: 'up' },
	slow: { icon: 'g-hourglass', label: '감속', fmt: pct, better: 'up' },
	speedMult: { icon: 'g-boot', label: '이동 속도', fmt: multp, better: 'up' },
	damageAdd: { icon: 'g-blade', label: '공격력', fmt: pctp, better: 'up' },
	takenMult: { icon: 'g-shield', label: '받는 피해', fmt: multp, better: 'down' },
	costPct: { icon: 'g-el-blood', label: '체력 소모', fmt: pct, better: 'down' },
	bolts: { icon: 'g-el-electric', label: '낙뢰 수', fmt: cnt, better: 'up' },
	chain: { icon: 'g-el-electric', label: '연쇄', fmt: cnt, better: 'up' },
	pushForce: { icon: 'g-shield', label: '밀어내는 힘', fmt: num, better: 'up' },
};

// ── 패시브 키
const PASSIVE_SPECS: Record<string, Spec> = {
	damageMultAdd: { icon: 'g-blade', label: '공격력', fmt: pctp, better: 'up' },
	critChanceAdd: { icon: 'g-spark', label: '치명타 확률', fmt: pctp, better: 'up' },
	critDamageAdd: { icon: 'g-spark', label: '치명타 피해', fmt: pctp, better: 'up' },
	maxHpMult: { icon: 'g-rekindle', label: '최대 체력', fmt: multp, better: 'up' },
	defenseAdd: { icon: 'g-shield', label: '방어', fmt: num, better: 'up' },
	moveSpeedMult: { icon: 'g-boot', label: '이동 속도', fmt: multp, better: 'up' },
	hpRegenAdd: { icon: 'g-rekindle', label: '초당 재생', fmt: pctp, better: 'up' },
	goldBonusAdd: { icon: 'g-el-gold', label: '골드 획득', fmt: pctp, better: 'up' },
	luckAdd: { icon: 'g-el-gold', label: '행운', fmt: num, better: 'up' },
	xpMultAdd: { icon: 'g-spark', label: '경험치 획득', fmt: pctp, better: 'up' },
	bonusHits: { icon: 'g-blade', label: '연속 타격', fmt: cnt, better: 'up' },
	cleave: { icon: 'g-blade', label: '타격 전이', fmt: cnt, better: 'up' },
	healBudgetAdd: { icon: 'g-rekindle', label: '타격 회복 예산', fmt: pctp, better: 'up' },
	ultChargeMult: { icon: 'g-spark', label: '게이지 충전', fmt: multp, better: 'up' },
	ultDamageAdd: { icon: 'g-spark', label: '필살기 피해', fmt: pctp, better: 'up' },
	ultRadiusAdd: { icon: 'g-ring', label: '필살기 반경', fmt: pctp, better: 'up' },
	skillCooldownMult: { icon: 'g-hourglass', label: '모든 재사용', fmt: multp, better: 'down' },
	diveCooldownMult: { icon: 'g-hourglass', label: '활공 재사용', fmt: multp, better: 'down' },
	dashCooldownMult: { icon: 'g-hourglass', label: '대시 재사용', fmt: multp, better: 'down' },
	dashGhostDamagePct: { icon: 'g-boot', label: '잔상 피해', fmt: pct, better: 'up' },
	diveDamageBonusAdd: { icon: 'g-fang', label: '활공 피해', fmt: pctp, better: 'up' },
	swordDiscount: { icon: 'g-el-gold', label: '검 가격', fmt: pctp, better: 'down' },
	chestGoldMult: { icon: 'g-el-gold', label: '상자 골드', fmt: multp, better: 'up' },
	goldOnHitChance: { icon: 'g-el-gold', label: '명중 금화 확률', fmt: pct, better: 'up' },
	huntMark: { icon: 'g-fang', label: '표식 추가 피해', fmt: pctp, better: 'up' },
	counterStorm: { icon: 'g-shield', label: '반격 주기', fmt: sec, better: 'down' },
	unyielding: { icon: 'g-rekindle', label: '소생', fmt: cnt, better: 'up' },
	roundStartCharge: { icon: 'g-spark', label: '시작 게이지', fmt: pct, better: 'up' },
	dualResonance: { icon: 'g-spark', label: '2차 필살기 피해', fmt: pct, better: 'up' },
	slowedDamageAdd: { icon: 'g-el-ice', label: '감속 적 피해', fmt: pctp, better: 'up' },
	frozenDamageAdd: { icon: 'g-el-ice', label: '빙결 적 피해', fmt: pctp, better: 'up' },
	extraBolts: { icon: 'g-el-electric', label: '추가 낙뢰', fmt: cnt, better: 'up' },
	ultLightning: { icon: 'g-el-electric', label: '천벌 피해', fmt: pct, better: 'up' },
	executeThreshold: { icon: 'g-fang', label: '처형 문턱', fmt: pct, better: 'up' },
	executeExplode: { icon: 'g-fang', label: '처형 폭발', fmt: pct, better: 'up' },
	frostAura: { icon: 'g-el-ice', label: '오라 감속', fmt: pct, better: 'up' },
	frostAuraRadiusMult: { icon: 'g-ring', label: '오라 반경', fmt: multp, better: 'up' },
	shatter: { icon: 'g-el-ice', label: '산산조각 피해', fmt: pct, better: 'up' },
	lowHpRage: { icon: 'g-el-blood', label: '저체력 공격력', fmt: pctp, better: 'up' },
	lastStand: { icon: 'g-hourglass', label: '위기 재사용', fmt: multp, better: 'down' },
};

/** 객체·단계형 스펙은 한 줄 요약으로 */
function objectRows(node: SkillNode): EffectRow[] {
	const p = node.passive;
	const out: EffectRow[] = [];
	if (!p) {
		return out;
	}
	const push = (icon: string, label: string, value: string) => {
		out.push({ key: label, icon, label, value, better: 'up', raw: 0 });
	};
	if (p.skillLevel) {
		for (const [skill, lv] of Object.entries(p.skillLevel)) {
			const name = skill === 'dive' ? '활공' : skill === 'recall' ? '귀소' : skill === 'dash' ? '대시' : skill;
			push('g-spark', `${name} 숙련`, `${lv}단계`);
		}
	}
	if (p.afterglow) push('g-spark', '여운 피해', `+${Math.round((p.afterglow.mult - 1) * 100)}% / ${(p.afterglow.durationMs / 1000).toFixed(1)}초`);
	if (p.dashWind) push('g-boot', '대시 후 가속', `+${Math.round((p.dashWind.mult - 1) * 100)}% / ${(p.dashWind.durationMs / 1000).toFixed(1)}초`);
	if (p.phoenix) push('g-rekindle', '위기 무적', `${Math.round(p.phoenix.healPct * 100)}% 회복 · ${(p.phoenix.invulnMs / 1000).toFixed(1)}초`);
	if (p.killHaste) push('g-boot', '처치 가속', `+${Math.round((p.killHaste.mult - 1) * 100)}% · ${p.killHaste.stacks}중첩`);
	if (p.bloodArmor) push('g-shield', '피의 갑옷', `1%당 +${p.bloodArmor.perPct} (최대 ${p.bloodArmor.cap})`);
	if (p.shadowStep) push('g-boot', '무피격 이동', `+${Math.round((p.shadowStep.mult - 1) * 100)}% / ${(p.shadowStep.afterMs / 1000).toFixed(0)}초 뒤`);
	if (p.chainOnHit) push('g-el-electric', '명중 연쇄', `${Math.round(p.chainOnHit.chance * 100)}% · ${Math.round(p.chainOnHit.pct * 100)}%`);
	return out;
}

/** 레벨 L 에서의 효과 줄 (최대 4줄) */
export function effectRows(node: SkillNode, level: number): EffectRow[] {
	if (level <= 0) {
		return [];
	}
	const rows: EffectRow[] = [];
	const push = (table: Record<string, Spec>, key: string, value: number) => {
		const spec = table[key];
		if (!spec) {
			return;
		}
		rows.push({ key, icon: spec.icon, label: spec.label, value: spec.fmt(value), better: spec.better, raw: value });
	};
	const active = activeAt(node, level);
	if (active) {
		for (const [key, value] of Object.entries(active)) {
			if (typeof value === 'number') {
				push(ACTIVE_SPECS, key, value);
			}
		}
		// 피해 → 범위 → 쿨다운 순으로 (레퍼런스 배치)
		const order = ['damageMult', 'dpsMult', 'orbitDamageMult', 'damageAdd', 'healPct', 'radius', 'pushRadius', 'length', 'distance', 'range', 'slow', 'durationMs', 'cooldownMs'];
		rows.sort((a, b) => {
			const ia = order.indexOf(a.key);
			const ib = order.indexOf(b.key);
			return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib);
		});
		// 쿨다운은 항상 마지막 줄로 남긴다
		const cd = rows.find((r) => r.key === 'cooldownMs');
		const rest = rows.filter((r) => r.key !== 'cooldownMs').slice(0, 2);
		return cd ? [...rest, cd] : rest.slice(0, 3);
	}
	const passive = passiveAt(node, level);
	if (passive) {
		for (const [key, value] of Object.entries(passive)) {
			if (typeof value === 'number') {
				push(PASSIVE_SPECS, key, value);
			}
		}
	}
	rows.push(...objectRows(node));
	return rows.slice(0, 4);
}

/** 다음 레벨 줄 (만렙이면 null) */
export function nextRows(node: SkillNode, level: number): EffectRow[] | null {
	return level >= maxLevelOf(node) ? null : effectRows(node, level + 1);
}
