---
name: movesword-fx-pipeline
description: moveSword(LODELAND) 프로젝트의 스킬 이펙트 파이프라인 — 현재 어떤 연출이 절차적(fx*)이고 어떤 것이 스프라이트인지, 새 FX 시트를 추가하는 정확한 절차, 뎁스 표, 성능 게이트. moveSword 저장소에서 이펙트/스킬 연출을 건드릴 때 발동.
---

# moveSword FX 파이프라인

## 0. 현황 (2026-09-05 조사 기준)

전체 약 80종 전투 연출 중 **에셋을 쓰는 것은 단 2개**:
- `aura-<element>` — 8원소 마법진 (스프라이트시트, `public/assets/auras/*.png`, 매니페스트 `src/logic/auraSheets.ts`)
- `fx-explosion` — 8프레임 폭발 (`public/fx/explosion.png`) — 보스 `circle` 텔레그래프 착탄 + 폭탄병 자폭에서만 사용

나머지 **전부가 절차적**이다: 기본 능동 4종, 필살기 8종, 스킬트리 능동 21종, 보스 패턴 12종, 원소 세트 스킬 24종, 상태이상 6종. 공유 `Graphics` 한 장(depth 56)에 `fx*` 헬퍼로 매 프레임 다시 그린다.

`public/fx/` 에는 `explosion.png`, `arrow.png` 두 개뿐이다.

**2026-09-05 이후 추가된 것** — 아래는 이미 배선되어 있다:
- `VisualEffectsSystem.fxSprite(key, x, y, opts)` / `fxSpriteStop(sprite)` — 풀링(24개) 스프라이트 FX 헬퍼. **에셋이 없으면 null 을 반환**하므로 호출부는 항상 기존 도형 연출로 폴백한다.
- `src/logic/fxSheets.ts` (`FX_SHEETS`) — 자동 생성 매니페스트. `main.ts` 가 이것만 보고 로드·애니메이션(`<키>-play`)·NEAREST 필터를 처리한다.
- `VisualEffectsSystem.fxSpriteFollow(key, target, x, y, until, opts)` — 대상을 따라다니는(또는 좌표 고정) 지속 루프. **만료·대상 소멸 시 스스로 꺼진다** — 소유자가 종료를 잊어도 화면에 남지 않는다. `target: null` 이면 그 자리 고정.
- `scripts/generate-fx-sheets.py` — 회색조 시트 6종 (`fx-cast-circle`, `fx-nova`, `fx-bolt`, `fx-slash`, `fx-field`, `fx-dome`). 원소 색은 런타임 `setTint`.
- 교체된 호출부 9곳: `skillCastFX`(마법진), `lightningFX`(낙뢰 기둥), `frostNova`(노바), `swordWave`(검기), `fireZone`·`timeWarp`·`lure`(장판 루프), `bulwark`·`iceCage`(돔 루프, 대상 추적).

**시트를 늘릴 때의 판단 기준**: 텍스처 유닛이 진짜 예산이다. 새 시트를 만들기 전에 **기존 시트를 틴트·크기로 재사용할 수 없는지** 먼저 본다 — 검 방패와 얼음 감옥이 `fx-dome` 하나를, 불바다·미끼 횃불·시간 감속이 `fx-field` 하나를 공유하는 이유가 그것이다.

## 1. 핵심 구조

- **`src/systems/VisualEffectsSystem.ts`** — `fx*` 전부. 원시 도형: `fxRing / fxDot / fxBurst / fxPoly / fxDiamond / fxCross / fxArc / fxGhost`. 합성 연출: `skillCastFX`, `ultimateCalloutFX`, `hitSparkFX`, `specialProcFX`, `enemyDeathFX`, `lightningFX`, `edgeVignettePulse`, `hitStop`, `flashSprite`.
- 모든 `fx*` 는 GameObject 를 만들지 않는다 — 데이터 엔트리를 풀(`FX_POOL_MAX=160`)에 넣고 `POST_UPDATE` 에서 한 장의 `Graphics` 에 렌더한다. **`add.circle` + 트윈은 금지.**
- **`fxGhost`** 만 실제 이미지를 만진다 (풀링된 `Image` 36개, 기존 스프라이트 프레임을 잔상으로 재블릿). 새 스프라이트 헬퍼는 이 패턴을 따른다.
- **`EnemyManager.playExplosionSprite`** 가 유일한 스프라이트 애니메이션 재생 선례 (6개 풀 + 커서).
- **`skillCastFX`** 가 필살기 8종 + 트리 능동 21종의 **공유 시전 문법**이다. 여기 하나만 스프라이트로 바꾸면 29개 스킬이 동시에 좋아진다. 최우선 교체 대상.

## 2. 새 FX 시트 추가 절차 (정확한 순서)

1. `assets-src/fx/<팩이름>/` 에 원본 보존 + `assets-src/LICENSES.md` 에 출처·라이선스·URL 기록
2. `scripts/generate-fx-sheets.py` 로 가공 → `public/fx/<key>.png` **+ `src/logic/fxSheets.ts` 매니페스트 자동 생성** (`scripts/generate-aura-sheets.py` 가 선례)
3. `src/main.ts` BootScene `preload` 의 fx 로드 구역에 매니페스트 루프 추가 (auras 로딩 바로 아래)
4. `createFxAnimations()` 에 애니메이션 등록 루프 추가 (`textures.exists` + `anims.exists` 가드 필수)
5. 픽셀 필터: `main.ts` 하단 `pixelKeys` 에 FX 키를 넣어 NEAREST 적용 (스킬북 UI 는 제외 대상이니 혼동 금지)
6. `VisualEffectsSystem.fxSprite(...)` 로 호출, **기존 절차적 연출은 `if (!fxSprite(...))` 폴백으로 남긴다**
7. 테스트 + 스크린샷 QA

## 3. 뎁스 표 (이걸 어기면 이펙트가 사라지거나 UI를 덮는다)

| depth | 레이어 |
|---|---|
| 1 | 적, 기본 `fxGhost`(검 잔상) |
| 2 | 보스 텔레그래프 `Graphics` |
| 5~6.2 | 원소 오라 마법진 |
| 9 | 플레이어 대시 잔상, 그림자 분신 |
| 39~40 | 적 투사체 + 글로우 |
| 54 | 검 출격 깃털 잔상 |
| **55** | 상태이상 지속 오버레이 |
| **56** | 공유 FX 레이어 (모든 `fx*`) ← **새 FX 스프라이트 기본값** |
| 59 | 폭발 스프라이트 풀, 적 체력바 |
| 92 | 화면 가장자리 비네트 (scrollFactor 0) |
| 100 / 101 | 데미지 텍스트 / 시전 라벨 |
| 1000+ | HUD·모달 |

의도된 스택: 적(1) < 상태 오버레이(55) < 단발 FX(56) < 체력바(59).

## 4. 성능 게이트 — 새 헬퍼도 반드시 지킨다

- `fxThrottle()` (1/2/3, `game.loop.actualFps` 기반). **3단계에서는 새 스프라이트를 만들지 않는다.**
- `reduceMotion()` — 애니메이션은 끄되 정지 프레임 1장은 남기는 것을 검토 (현재는 대부분 연출이 통째로 사라져 스킬 발동 여부를 알 수 없다)
- 풀 상한을 두고 커서로 재사용. 매 호출 `add.sprite` 금지
- 오프스크린 스폰 금지 (14라운드 렉의 진범이 화면 밖 오브젝트 누적이었다)
- 개별 타격 연출은 레이트 리밋 유지 (`hitSparkFX` 40ms, `specialProcFX` 90ms)

## 5. 교체 우선순위 (효과 대비 비용)

1. **`skillCastFX` 시전 마법진** — 29개 스킬이 한 번에 개선
2. **지속 장판 루프** — `fireZone`(90ms 재스탬프), 말뚝검 오라(90ms), `iceCage`, `bulwark`, `timeWarp`, 미끼 횃불. 루프 스프라이트로 바꾸면 **CPU가 오히려 줄어든다**
3. **`lightningFX`** — 필살기 낙뢰 + 트리 낙뢰 + 폭풍우 + 감전 연쇄가 전부 공유
4. **원소 노바 3종** (화염/서리/보이드) — 필살기와 세트 스킬이 공유
5. **방향기** — 검기 발사(`swordWave`), 피의 일격 원뿔, 보스 처형 광선
6. **상태이상 오버레이 6종** — 특히 `drawShock` 은 매 프레임 난수로 지그재그를 다시 그린다 (연산 낭비)

## 6. 원소 램프 (LODELAND)

`fire / electric / ice / poison / gold / blood / wind / void` 8종. 회색조 베이스 시트 + `setTint` 로 원소를 입히면 시트 수를 1/8 로 줄일 수 있다 — **틴트는 곱연산이므로 베이스를 밝게** 뽑을 것.

## 7. 테스트

이 저장소는 기능마다 `*-test.mjs` 헤드리스 체크가 있다. FX 작업 후:
- `node skilltree-test.mjs`, `node status-fx-test.mjs`, `node perf-test.mjs`, `node smoke-test.mjs`
- 스크린샷: `qa-*-shots.mjs`, `screenshot-test.mjs`
- 테스트는 강제 종료 규약을 따른다 (무한 대기 금지)
- 샌드박스 빌드 우회는 `movesword-sandbox-build` 메모 참조 (libXdamage 스텁 등), `TMPDIR=/tmp` 함정 주의
