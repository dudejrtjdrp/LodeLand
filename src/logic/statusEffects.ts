// 상태이상 단일 정의 (2026-09-04).
//
// 왜 필요한가:
//   화상/중독/감속/빙결/감전/출혈이 `enemy.slowUntil = ...` 같은 **직접 대입**으로
//   4개 파일에 흩어져 있었다. 그래서 (a) 보스·면역 가드가 호출부마다 중복되고 조건도
//   조금씩 달랐고, (b) 부여 연출을 빠뜨린 경로(출혈·광역 감속)가 생겼으며,
//   (c) "걸려 있는 동안" 무엇을 보여줄지 결정하는 곳이 아예 없었다.
//
//   이 파일은 **판정과 색만** 담는다 (Phaser 의존 없음 → node 로 그대로 테스트 가능).
//   실제 부여·연출은 src/systems/StatusEffectSystem.ts 가 이 표를 읽어서 한다.

import type { EnemySprite } from '../types/actors';

export type StatusKind = 'freeze' | 'shock' | 'burn' | 'poison' | 'bleed' | 'slow';

/** 비트 마스크 — 한 프레임에 켜진 상태를 정수 하나로 들고 다닌다 (할당 없음). */
export const S_FREEZE = 1 << 0;
export const S_SHOCK = 1 << 1;
export const S_BURN = 1 << 2;
export const S_POISON = 1 << 3;
export const S_BLEED = 1 << 4;
export const S_SLOW = 1 << 5;

export const STATUS_BIT: Record<StatusKind, number> = {
	freeze: S_FREEZE,
	shock: S_SHOCK,
	burn: S_BURN,
	poison: S_POISON,
	bleed: S_BLEED,
	slow: S_SLOW,
};

export interface StatusStyle {
	/**
	 * 스프라이트 곱셈 틴트. Phaser 의 setTint 는 곱셈이라 **밝은 색**이어야
	 * 원본 명암이 남는다 (어두운 색을 쓰면 실루엣이 통째로 죽는다).
	 */
	tint: number;
	/**
	 * 교대 틴트 (있으면 두 색을 번갈아 건다 — 감전의 지직거림).
	 * 원래 색으로 돌아갔다 오는 대신 **두 상태색 사이**를 오가야, 깜빡이는 내내
	 * "지금 감전 중"이 유지된다.
	 */
	tintAlt?: number;
	/** 오버레이 선/입자 본색 */
	fx: number;
	/** 밝은 강조색 (하이라이트) */
	bright: number;
	/** 지속 피해 숫자 색 — ui/damageFont.DAMAGE_FONT_COLORS 에 있는 값만 쓴다 */
	text: string | null;
}

export const STATUS_STYLE: Record<StatusKind, StatusStyle> = {
	// 빙결: 얼음에 갇힌 하늘색. 세트 연출(freezeFX)과 같은 계열.
	freeze: { tint: 0x8ed3f5, fx: 0xbfe6f2, bright: 0xffffff, text: null },
	// 감전: 창백한 청백색 ↔ 짙은 파랑을 번갈아 — 전류가 지나가는 것처럼 지직거린다.
	shock: { tint: 0xf2f7ff, tintAlt: 0x7fa8ff, fx: 0x93c5fd, bright: 0xffffff, text: null },
	// 화상: 달아오른 주황.
	burn: { tint: 0xff9a5e, fx: 0xf97316, bright: 0xffd27a, text: '#ffab5e' },
	// 중독: 병든 연두.
	poison: { tint: 0x9fe07a, fx: 0x4ade80, bright: 0xbef264, text: '#84b04a' },
	// 출혈: 검붉은 기가 도는 적색.
	bleed: { tint: 0xff8f8f, fx: 0xc9455a, bright: 0xff7a7a, text: '#ff7a7a' },
	// 감속: 서리 낀 옅은 청록 (빙결보다 약하게).
	slow: { tint: 0xbcdfe8, fx: 0x9fd8e8, bright: 0xdff3fa, text: null },
};

/**
 * 틴트 우선순위 — 앞이 이긴다.
 * 행동을 더 크게 바꾸는 것(정지 > 취약 > 지속피해 > 감속)이 위로 온다.
 */
export const STATUS_TINT_ORDER: readonly StatusKind[] = [
	'freeze', 'shock', 'burn', 'poison', 'bleed', 'slow',
] as const;

/** 오버레이 그리기 순서 (겹칠 때 아래→위). 틴트 순서와 반대로 약한 것부터 깐다. */
export const STATUS_DRAW_ORDER: readonly StatusKind[] = [
	'slow', 'poison', 'bleed', 'burn', 'shock', 'freeze',
] as const;

/** '#rrggbb' → 0xrrggbb. Phaser 없이 쓰기 위해 직접 파싱한다. */
export function hexToNumber(hex: string | null | undefined): number | null {
	if (!hex) {
		return null;
	}
	const body = hex[0] === '#' ? hex.slice(1) : hex;
	if (body.length !== 6 && body.length !== 3) {
		return null;
	}
	const full = body.length === 3
		? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
		: body;
	const value = Number.parseInt(full, 16);
	return Number.isNaN(value) ? null : value;
}

/**
 * 이 적의 "원래 색" — 상태이상이 풀렸을 때 되돌려야 할 틴트.
 *
 * 기존 버그: 피격 플래시 복구(VisualEffectsSystem.flashSprite)가 `catalog.tint` 만
 * 되살렸는데, 스폰은 `tint ?? color` 로 칠하고 어픽스는 또 자기 색으로 덮어쓴다.
 * 그래서 `color` 만 있는 적이나 어픽스 몹은 화상 한 번 맞으면 원래 색을 잃고
 * 무채색으로 남았다. 되돌릴 색을 정하는 곳을 여기 하나로 모은다.
 */
export function baseTintOf(enemy: EnemySprite): number | null {
	if (enemy.affixTintColor !== undefined && enemy.affixTintColor !== null) {
		return enemy.affixTintColor;
	}
	const catalog = enemy.catalog;
	if (!catalog) {
		return null;
	}
	if (catalog.tint) {
		return hexToNumber(catalog.tint);
	}
	// 스폰과 같은 조건 (EnemyManager.spawnEnemy): 시트형 스프라이트는 color 를 칠하지 않는다
	if (catalog.color && catalog.spriteType !== 'aseprite' && catalog.spriteType !== 'separate') {
		return hexToNumber(catalog.color);
	}
	return null;
}

// ------------------------------------------------------------------
// 가드 — "이 적에게 이 상태를 걸 수 있는가"
// 호출부마다 제각각이던 조건을 여기로 모은다.
// ------------------------------------------------------------------

/**
 * 감속·빙결 계열의 공통 면역 (보스/리퍼/감속면역 어픽스).
 *
 * `allowBoss` 는 스킬 트리의 광역 감속처럼 **보스에게도 절반만 걸리는** 설계를 위한
 * 예외다. 리퍼와 감속 면역 어픽스는 어떤 경우에도 뚫리지 않는다.
 */
export function canSlow(enemy: EnemySprite, allowBoss = false): boolean {
	if (enemy.slowImmune || enemy.catalog?.isReaper) {
		return false;
	}
	return allowBoss || !enemy.catalog?.isBoss;
}

/**
 * 완전 정지(빙결·감전 정지). 감속과 같은 면역을 따른다.
 * 기존 얼음 4세트 코드는 리퍼를 빼먹어 리퍼가 얼었다 — 여기서 함께 막는다.
 */
export function canFreeze(enemy: EnemySprite): boolean {
	return canSlow(enemy);
}

/** 지속 피해 면역 (juggernaut purge · 막힌 핏줄) */
export function canDot(enemy: EnemySprite): boolean {
	return !enemy.dotImmune;
}

// ------------------------------------------------------------------
// 조회
// ------------------------------------------------------------------

/** 지금 켜져 있는 상태 비트 마스크. 할당 없이 정수만 만든다. */
export function statusMask(enemy: EnemySprite, now: number): number {
	let mask = 0;
	if ((enemy.setFrozenUntil ?? 0) > now) {
		mask |= S_FREEZE;
	}
	if ((enemy.setShockUntil ?? 0) > now) {
		mask |= S_SHOCK;
	}
	if ((enemy.dotUntil ?? 0) > now && (enemy.dotDps ?? 0) > 0) {
		// 화상과 중독은 같은 DoT 슬롯을 쓰고 색으로만 갈린다
		mask |= enemy.dotColor === STATUS_STYLE.poison.fx || enemy.dotColor === 0x84b04a
			? S_POISON : S_BURN;
	}
	if ((enemy.setBleedUntil ?? 0) > now) {
		mask |= S_BLEED;
	}
	// 빙결·감전 정지는 slowFactor 0 으로 구현돼 있다 — 그 둘이 켜져 있으면 감속은 중복 표시하지 않는다
	if ((enemy.slowUntil ?? 0) > now && (enemy.slowFactor ?? 1) < 1 && (mask & (S_FREEZE | S_SHOCK)) === 0) {
		mask |= S_SLOW;
	}
	return mask;
}

/** 틴트를 가져갈 상태 (우선순위 최상위). 없으면 null. */
export function dominantStatus(mask: number): StatusKind | null {
	for (const kind of STATUS_TINT_ORDER) {
		if (mask & STATUS_BIT[kind]) {
			return kind;
		}
	}
	return null;
}
