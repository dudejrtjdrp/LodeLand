// 검 원소색 틴트 (2026-09-01) — 명암을 죽이지 않는 틴트 계산.
//
// 문제
// ----
// 검 186종은 전부 `effect.tint` 한 색을 `setTint()` 로 그대로 걸고 있었다.
// Phaser 의 setTint 는 **곱셈**이라 결과 픽셀 = 원본 × 틴트다. 그래서
// #84b04a(독) 같은 중간 채도 색을 걸면 도트가 공들여 그린 하이라이트(#ffffff)마저
// 그 색 자체(#84b04a)로 눌리고, 그늘(#3a4466)은 거의 검정이 된다 —
// 5단계 램프로 그린 날이 사실상 2단계로 납작해진다.
//
// 해법 — (b) 틴트 약화, 스프라이트 0장 추가
// -----------------------------------------
// 두 단계로 나눈다.
//
// 1. **휘도 복원**: 틴트를 최대 채널이 255가 되도록 정규화한다.
//    #84b04a → ×(255/176) → #bfff6b. 색상(hue)은 그대로인데 곱셈으로 잃었던
//    밝기를 되돌려 준다 — 원본의 흰 하이라이트가 다시 "밝은" 색으로 남는다.
// 2. **모서리 그라디언트**: 정규화한 색을 네 꼭짓점마다 다른 비율로 흰색과 섞어
//    setTint(TL, TR, BL, BR) 로 건다. 시트의 광원 규약이 **좌상단**이므로
//    (docs/art-guideline.md) 좌상단을 가장 옅게, 우하단을 가장 진하게 둔다.
//    틴트 꼭짓점은 텍스처 공간이라 검이 회전해도 광원 방향이 날과 함께 돈다.
//
// 왜 글로우 스프라이트(옵션 a)나 파티클(옵션 c)이 아닌가
// -----------------------------------------------------
//  · 원소색 정체성은 이미 출격 링·비행 잔상·명중 스파크가 강하게 전달한다
//    (VisualEffectsSystem.swordLaunchFX / swordTrailFX / hitSparkFX).
//    본체 틴트는 "가만히 도는 동안"의 표식일 뿐이라 약해져도 읽힌다.
//  · 검은 최대 7자루가 상시 존재한다. 글로우를 붙이면 상시 스프라이트가 2배가 되고
//    매 프레임 위치 동기화가 붙는다 — 성능 예산에서 가장 비싼 선택지다.
//  · 이 방식은 스프라이트 0장, 핫패스 할당 0, 계산은 검을 만들 때 한 번뿐이다.
//
// ※ 데미지 텍스트 풀의 "tint 금지" 규약과는 무관하다 (그건 BitmapText 풀 재사용
//   문제이고 여기는 검 스프라이트다).

/** 정규화·혼합 결과 — Phaser setTint(TL, TR, BL, BR) 인자 순서 그대로 */
export interface SwordTintCorners {
	topLeft: number;
	topRight: number;
	bottomLeft: number;
	bottomRight: number;
}

/** 꼭짓점별 흰색 혼합 비율 (0 = 원색, 1 = 흰색). 좌상단이 광원 쪽 */
export const TINT_MIX = { topLeft: 0.46, topRight: 0.30, bottomLeft: 0.30, bottomRight: 0.14 };

function clamp255(value: number): number {
	return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/**
 * 최대 채널이 255가 되도록 스케일 — 곱셈 틴트로 잃는 휘도를 미리 되돌린다.
 * 검정(0,0,0)은 스케일할 수 없으므로 그대로 둔다.
 */
export function normalizeTint(color: number): number {
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	const peak = Math.max(r, g, b);
	if (peak <= 0) {
		return color;
	}
	const k = 255 / peak;
	return (clamp255(r * k) << 16) | (clamp255(g * k) << 8) | clamp255(b * k);
}

/** color 를 흰색 쪽으로 amount(0~1) 만큼 섞는다 */
export function mixWhite(color: number, amount: number): number {
	const t = amount < 0 ? 0 : amount > 1 ? 1 : amount;
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	return (clamp255(r + (255 - r) * t) << 16)
		| (clamp255(g + (255 - g) * t) << 8)
		| clamp255(b + (255 - b) * t);
}

/**
 * 검 본체에 걸 4꼭짓점 틴트.
 * 검 생성/재장착 때 한 번만 계산한다 (전투 핫패스 아님).
 */
export function softSwordTint(color: number): SwordTintCorners {
	const base = normalizeTint(color);
	return {
		topLeft: mixWhite(base, TINT_MIX.topLeft),
		topRight: mixWhite(base, TINT_MIX.topRight),
		bottomLeft: mixWhite(base, TINT_MIX.bottomLeft),
		bottomRight: mixWhite(base, TINT_MIX.bottomRight),
	};
}

/** 단색이 필요한 자리(작은 UI 아이콘 등)용 — 그라디언트 없이 평균 밝기 하나 */
export function softSwordTintFlat(color: number): number {
	return mixWhite(normalizeTint(color), 0.28);
}

/** '#rrggbb' 문자열을 숫자로 (Phaser 없이 쓰는 경로용) */
export function parseTintHex(hex: string): number {
	return parseInt(hex.replace('#', ''), 16) || 0xffffff;
}
