// 검 성장 계수 — 단일 출처 (2026-09-04). Phaser import 금지 (balance-sim 공용).
//
// 사용자 피드백: "강화하면 공격력이 확확 늘어야 한다". 예전 값(레벨 +15%, 강화 +4%)은 숫자
// 인플레이션(logic/growth.ts) 뒤에 체감이 사라졌다 → 레벨 +25%(Lv5 = ×2.0), 강화 +7%(+15 = ×2.05).

/** 검 레벨당 피해 가산 (Lv1 = 1.0, Lv5 = 1 + 4×값) */
export const SWORD_LEVEL_DAMAGE_BONUS = 0.25;
/** 검 레벨당 재출격 대기 감소 (하한 ×0.5 는 loadout 에서) */
export const SWORD_LEVEL_COOLDOWN_BONUS = 0.06;
