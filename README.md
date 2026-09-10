# LODELAND

> 검은 길들인 맹금이다. 무리(FLOCK)를 몰아 녹(綠)을 사냥하라.

Phaser 3 + TypeScript 서바이버류 액션. 플레이어는 검을 휘두르지 않는다 —
길들인 검들이 궤도(PERCH)에서 스스로 사냥감을 덮치고(STRIKE) 돌아온다(RETURN).
당신은 마지막 키퍼: 무리를 몰고, XP로 키우고, TEMPER로 벼리고, 언제 풀지 결정한다.

## 세계 설정 요약

- **Lodeland**: 자기 광맥(lode)이 흐르는 옛 대정련 지대. 정련된 금속에는 심(心)이 깃들어 난다.
- **녹(적)**: 대정련이 버린 금속의 굶주림. 심을 먹으려 EMBER CORE(플레이어)에게 몰려든다.
- **검(무기)**: 속성(EMBER·VOLT·BLIGHT·NULL·GILT)을 가진 금속 맹금. 같은 속성 2자루 = RESONANCE.
- **라운드(LODE)**: 광맥을 하나씩 정화(200 LODE · 40초 스폰 창 + 잔당 전멸). 사이사이 야장 에다의 THE FORGE(상점).

## 용어 (영문 시그니지)

LODE(라운드) · DEPTH(난이도) · FLOCK(검 무리) · PERCH(장착 칸) · ROOST(보관) ·
TEMPER(강화) · SIGIL(각인) · FLUX(확정 강화석) · INGOT(재화) · XP · LEVEL UP ·
RESONANCE(속성 공명) · SURGE(속성 필살기) · REFORGE(진화) · REIGNITE(부활/영구 강화) ·
DELVE(출격) · THE FORGE/ARSENAL/WORKSHOP(상점) · CACHE(보물) · 상태: ORBIT/STRIKE/RETURN
검: 총 186종 (6등급 일반~신화 · 8원소 불/번개/독/공허/황금/얼음/피/바람, `src/data/swordCatalog.json` — 생성기 `scripts/generate-sword-catalog.py`) / 조합 레시피 26종 (신화는 조합 전용)
적: Rusthound 계열·Needler·Sludge·Crustback·Boiler·Rustmender·Fester·Gnasher / BOSS: Packlord·Rust Mother / 사신: Hunger
키퍼: ASH·BASTION·TALON·GILDER

상세 설정·아트 디렉션: `docs/redesign-proposal.md` / 작업 결과: `docs/redesign-report.md`

## 구조

- `index.html` — 진입점 (Jua/Gowun Dodum 웹폰트 + 레티나 선명도 CSS)
- `src/main.ts` — BootScene(에셋·애니메이션·글리프 텍스처·NEAREST 필터) + 게임 설정(roundPixels)
- `src/ui/theme.ts` — 디자인 토큰(팔레트·모따기 패널·버튼·글리프·TEXT_RESOLUTION·모션 상수)
- `src/core/settings.ts` — 화면 흔들림 / 모션 줄이기 / BGM·SFX 음량 / 마스터 음소거 (localStorage)
- `src/systems/BgmSystem.ts` — 배경음 4트랙 전환·크로스페이드 (게임당 싱글턴, 씬을 넘어 이어짐)
- `src/ui/audioSettings.ts` — 음량 설정 블록 (타이틀 설정 창 · 일시정지 메뉴 공용)
- `src/scenes/` — Title / CharacterSelect(SELECT KEEPER) / Game / PowerUp(REIGNITE) / Codex(도감·도전과제)
- `src/core/codex.ts` · `src/core/stats.ts` — 검 획득 이력 / 누적 통계 (localStorage, 이벤트 시점에만 기록)
- `src/systems/AchievementSystem.ts` — 도전과제 20종 판정·보상(골드)·달성 토스트 (`src/data/achievementCatalog.json`)
- `src/systems/BossCutInSystem.ts` — 보스 등장 컷인 배너 (보스바/보스 BGM 전환과 같은 순간)
- `src/systems/sword/` — FLOCK: ORBIT·STRIKE·RETURN 상태 머신, PERCH HUD, REFORGE, RESONANCE
- `src/systems/` — 적(녹) 매니저, LODE(라운드), LEVEL UP, THE FORGE(상점), 픽업, 메타 진행
- `src/data/*.json` — 검·적·키퍼·업그레이드·상점·SIGIL·웨이브 카탈로그

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run typecheck
npm run atlas      # 적/장식 텍스처 아틀라스 재생성 (public/atlas/)

python3 scripts/generate-bgm.py            # BGM 4트랙(public/bgm/*.ogg) + 정보음 2종 재생성
python3 scripts/generate-bgm.py boss       # 트랙 하나만 다시 굽기
```

> **BGM**: 외부 음원이 아니라 numpy 합성 산출물이다 (칩튠/신스, 30~60초 심리스 루프).
> 곡을 고치려면 `scripts/generate-bgm.py` 의 `make_*` 함수(코드 진행·리프·드럼)를 수정하고
> 다시 돌린다. ffmpeg 가 없으면 22050Hz wav 로 폴백한다(로더 경로는 ogg 고정이므로 주의).

> **아틀라스 주의**: `public/enemy/**` 나 `public/deco/**` 의 png 를 추가·교체했으면
> 반드시 `npm run atlas` 를 다시 돌려야 한다. 게임은 개별 png 가 아니라
> `public/atlas/enemies.png|json`, `deco.png|json` 만 읽는다.

## 테스트 (vite dev 서버 실행 상태에서)

```bash
node smoke-test.mjs        # 부팅→선택→전투→일시정지 헤드리스 검증
node screenshot-test.mjs   # 주요 화면 캡처 QA (shots/ 폴더)
node perf-test.mjs         # 30라 전투 밀도 프로파일 (VARIANT=combat 로 레벨업 UI 노이즈 제거)
node census-test.mjs       # 시간 누적형 렉 계측 — 화면 밖 오브젝트/구슬/픽업 인구조사
node texunit-test.mjs      # 텍스처 유닛 진단 (동시 사용 텍스처 수 vs Phaser 한도 16)
node dmgfont-test.mjs      # 데미지 숫자 비트맵 폰트 QA
node skilltree-test.mjs    # 스킬 트리 45체크 — 포인트/선행/패시브 원복/핫키/트리 능동 21종/상황 패시브/훅/세이브/스킬 창 (vite preview --port 5199)
node rebalance-test.mjs    # 2026-09-04 대개편 회귀 23체크 — 흡혈 예산·레벨 성장·슬롯 게이트·스탯 MAX·필살기 게이지·스킬 숙련·위험 이벤트·데미지 폰트 (vite preview --port 5199)
node bgm-test.mjs          # BGM 트랙 로드·씬/보스/마을 전환·크로스페이드·음량 영속
node meta-test.mjs         # 검 도감·도전과제(영속/보상) + 보스 컷인·SURGE 비네트·REFORGE 연출
node qa-meta-shots.mjs     # 도감/도전과제/타이틀 3뷰포트 캡처 QA
# flow/augment/phase2/phase3-test.mjs — AugmentSystem 은 GameScene 에 연결돼 있음(라운드 10/25/40/55 드래프트 + 마을 증강 제단)
```
