# LODELAND

검을 직접 휘두르지 않는 서바이버류(뱀서류) 웹 액션 게임입니다. 길들인 검 무리가 플레이어 주위를 돌다가(ORBIT), 스스로 적에게 달려들고(STRIKE), 다시 돌아옵니다(RETURN).

2026.05 ~ 2026.09 · 1인 개발 · Phaser 3, TypeScript, Vite, Playwright(헤드리스 QA), Python(에셋·BGM 생성) · https://lodeland.pages.dev (`docs/DEPLOY.md`)

## 왜 만들었나

"여러 종류의 검을 투사체처럼 날려 적을 잡는" 규칙 하나로 시작한 프로토타입입니다. 라운드가 50, 100까지 이어지면 수치가 부풀고 화면에 오브젝트가 쌓입니다. 그래도 밸런스와 프레임이 버티는 구조를 만드는 것이 목표였습니다. 서버 없이 정적 호스팅만으로 돌아가며, 세이브·설정·도감은 `localStorage`에 저장합니다.

## 주요 기능

- 검 186종(6등급, 8원소)과 조합 레시피. 같은 원소 검을 모으면 원소 세트와 공명(RESONANCE) 효과가 붙습니다 (`src/data/swordCatalog.json`, `src/systems/sword/`)
- 라운드 구조: 40초 스폰 창에 나온 적을 모두 잡으면 클리어하고, 마을(대장간·NPC·증강 제단)로 돌아갑니다 (`WaveSystem`, `VillageSystem`)
- 성장 시스템: 레벨업 카드, 스킬 트리(K), 액티브 스킬 최대 10개 등록, 필살기 게이지(R), 증강 드래프트, 영구 강화(메타 진행)
- 적 특성 상성(약점·저항), 상태이상 6종 표시, 보스 스킬과 등장 컷인
- 도감·도전과제, BGM 4트랙 크로스페이드, 화면 흔들림·모션 줄이기·음량 설정, 게임패드·키 바인딩

## 기술적으로 고민한 것

**1. 후반 렉: 추측하지 않고 계측부터 했습니다**
- 문제: 30라운드쯤부터 프레임이 떨어졌습니다. 처음에는 연출 오브젝트(초당 수십~수백 개 생성과 트윈)를 원인으로 봤습니다. 공유 FX 레이어(Graphics 한 장에 한 번에 그리기)로 바꿨지만 해결되지 않았습니다.
- 선택: 인구조사 스크립트(`census-test.mjs`)로 표시 목록을 세어 봤습니다. 라운드 14에 약 650개 중 84%가 화면 밖에 있었습니다. 그래서 청크 반경을 줄이고, XP 구슬을 병합하고 수명을 두고, 픽업 수에 상한을 두고, 화면 밖 오브젝트를 숨기도록 바꿨습니다. 텍스처 진단(`texunit-test.mjs`)에서는 Text 객체가 저마다 캔버스 텍스처를 만든다는 것을 확인해 BitmapText로 교체했습니다.
- 결과: 텍스처 아틀라스는 A/B 측정에서 draw call이 거의 그대로여서, 로딩 요청 수를 줄이는 용도로만 남겼습니다. 효과가 있는 조치와 없는 조치를 수치로 구분했습니다.

**2. 수치 인플레이션과 밸런스를 한 곳에서 관리**
- 문제: 흡혈이 "피해 × %" 구조라 후반 DPS에 곱해지면 사실상 무적이 됐습니다. 적 체력 곡선도 "라운드별 기대 레벨"을 가정했는데, 실제 경험치 수급이 가정을 크게 넘어 22라운드에 Lv96(기대치 31)이 나왔습니다.
- 선택: 타격 회복을 "초당 최대체력 6%" 예산 안으로 묶었습니다(`src/logic/lifesteal.ts`). 플레이어와 적의 성장 곡선은 같은 함수에서 나오도록 `src/logic/growth.ts` 한 곳에 모았고, XP 곡선을 지수식으로 다시 썼습니다.
- 결과: `src/logic/*`에서 Phaser import를 금지했습니다. 그래서 헤드리스 밸런스 시뮬(`scripts/balance-sim/`)이 게임과 같은 함수를 그대로 가져다 씁니다. 시뮬로 조정한 결과, 원소 간 최대 편차는 51.1%에서 21.8%로, 완전 열등 검은 57종에서 0종으로 줄었습니다(`scripts/balance-sim/TUNING.md`).

**3. UI 입력 버그를 회귀 테스트로 막기**
- 문제: 모든 버튼의 히트 영역이 크기의 절반만큼 좌상단으로 밀려 있었고, 전투 중에는 카메라 이동만큼 판정이 더 어긋났습니다. 레벨업 카드 등장 트윈이 포커스 이동 처리에 끊겨 반투명 상태로 멈추는 문제도 있었습니다.
- 선택: 히트 영역을 공용 헬퍼로 통일하고 최소 터치 크기를 44px로 정했습니다. Playwright 스크립트로 3개 해상도에서 클릭 지점을 검사합니다(`ui-hit-test.mjs`).
- 결과: 기능마다 헤드리스 검증 스크립트를 두었습니다. 루트의 `*-test.mjs` 약 40개입니다.

**4. 외부 음원 없이 만든 BGM과 에셋 파이프라인**
- BGM은 numpy로 합성해 굽습니다(`scripts/generate-bgm.py`). Safari용 m4a 폴백도 같이 만듭니다.
- 적·장식 PNG는 `npm run atlas`로 아틀라스를 다시 만들고, 게임은 아틀라스만 읽습니다.

## 구조

```
src/
├── main.ts            # BootScene(에셋·애니메이션 로드) + 게임 설정
├── scenes/            # Title, CharacterSelect, Game, PowerUp(영구 강화), Codex
├── systems/           # Wave, EnemyManager, LevelUp, SkillTree, Village, Bgm, VisualEffects ...
│   ├── sword/         # ORBIT·STRIKE·RETURN 상태 머신, 조합, 공명, 슬롯 경제
│   └── shop/          # 상점 UI·드래그·로직
├── logic/             # Phaser 비의존 순수 로직 (growth, lifesteal, combat, statusEffects ...)
├── core/              # RunSave, settings, codex, stats, keybinds
├── data/*.json        # 검·적·스킬·웨이브·상점 카탈로그
└── ui/                # 테마 토큰, 툴팁, 데미지 폰트
scripts/               # 아틀라스·BGM·에셋 생성, balance-sim
*-test.mjs             # Playwright 헤드리스 검증
```

## 실행 방법

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run typecheck
npm run atlas        # public/enemy, public/deco PNG를 바꾼 뒤 필수
npm run balance-sim  # 헤드리스 밸런스 시뮬 (--gate 옵션: balance-gate)
```

테스트는 dev 서버를 켠 상태에서 돌립니다. 일부는 `vite preview --port 5199`가 필요합니다.

```bash
node smoke-test.mjs      # 부팅 → 선택 → 전투 → 일시정지
node perf-test.mjs       # 전투 밀도 프로파일
node census-test.mjs     # 화면 밖 오브젝트·픽업 인구조사
node rebalance-test.mjs  # 밸런스 개편 회귀 체크
```

BGM을 다시 만들려면 `python3 scripts/generate-bgm.py`를 실행합니다(ffmpeg 권장). 배포는 `npm run deploy`(Cloudflare Pages)이며, 절차는 `docs/DEPLOY.md`에 있습니다.

## 회고

잘못된 진단을 여러 번 되돌렸습니다. 렉 원인, "몬스터가 약하다"의 원인, 샌드박스 GPU 워밍업이 만든 착시가 그랬습니다. 체감 대신 계측 스크립트와 시뮬을 먼저 만들어 두면 수정이 맞았는지 바로 확인할 수 있었습니다.
