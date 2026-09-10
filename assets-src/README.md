# 에셋 라이브러리 (assets-src)

사용자가 가져다준 원본 에셋 보관소. **여기 있는 건 버리지 않는다** — 새 콘텐츠 시안은
먼저 이 라이브러리에서 후보를 골라 만들고, 부족하면 사용자에게 요청한다.
게임이 실제로 로드하는 가공본은 `scripts/generate-theme-assets.py` 가 `public/` 으로 굽는다.

## 팩 인벤토리 (2026-08-31 반입)

| 폴더 | 격자 | 내용 | 사용처 (확정) | 미사용 잔여 (제안 대기) |
|---|---|---|---|---|
| GrassLand2.0 | 32px | 선명한 초원 타일+절벽+나무·덤불·잔풀·다리·모닥불·돌기둥 | 바람 초원 테마 | 절벽 타일, 다리·모닥불(랜드마크 후보) |
| AncientRuins | 32px | 사암 유적 타일·유적 벽·**애니 물 타일(가장자리 전환 포함)**·노란 나무·기둥·제단·신전 분수·금잔·**상인 NPC(대기/상호작용 애니)**·행운 요정·자연 파티클 | 금빛 유적 테마 / 에다 NPC(업그레이드·증강) / 마을 분수·기둥 | 제단·대형 구조물(랜드마크), 행운 요정(보너스몹), 물 타일, 파티클 |
| ForgottenMemories | 32px | 2048² 무디 타일(갈색 흙·자두빛 구덩이·올리브 풀)·나무 5색(주황/청록/노랑/솔)·덤불 5색·그루터기·바위·**물 6프레임** | 공허 잿땅·핏빛 들녘 테마 | 물 타일(웅덩이), 나머지 색 나무·덤불 |
| PP_RPG | 24px | 던전 석조 타일·섬 타일·장식(횃불·배럴·깃발·크리스탈·표지판·성배) | 뇌운 폐성 테마 | 섬 타일셋, 상자·책장 등 실내 소품 |
| TilesetGrass | 16px | 젤다풍 초원·절벽·**마을 집/울타리**(map1·2 참조) | (보류) | 마을 건물 지붕·울타리 — 대기마을 확장 후보 |
| TopDownForest | 16px | 올리브 숲 타일·연못(가장자리 포함)·진초록 나무·통나무·**독버섯**·갈대·돌 | 독버섯 숲 테마 | 연못 타일 |

- Tiny Swords(기존 public/): 잿불 황무지·서리 벌판 테마 + 적/장식 계속 사용.
- 대장장이 NPC: 사용자가 **추후 별도 제공 예정** (대장간 창은 임시 '떠돌이 도검상' 아이콘).

## 적 팩 (enemypacks/, 2026-08-31 반입 — 전부 게임 편입 완료)

| 폴더 | 프레임 | 내용 → 게임 id | 사용 애니 |
|---|---|---|---|
| DemonSlime | 288×160 | 보스 심연 데몬 `boss-abyss-demon` | walk→idle·hit·death |
| Minotaur | 288×160 | 보스 미노스 `boss-minos` (돌진) | walk→idle (+체력바 UI 미사용) |
| FrostGuardian | 192×128 | 보스 서리 수호자 `boss-frost-guardian` | walk→idle·hit·death |
| (루트 strips) | 128×150 | **100라 페이즈 보스 탈각하는 것 `boss-molt`** — normal/mud/ice/flying 4형태+hurt | 전 형태 |
| Golems | 90×64 | 정예 `mb-frost-golem`(Blue)·`mb-magma-golem`(Orange) | walk→idle·hurt·die |
| TinyRPG02 | 100×100 | 일반 `demonling`(Demon_A)·`blood-horror`(Blood Monster_A) | walk→idle·hurt·death |
| Bat | 64×64 | 일반 `duskbat` | fly→idle·hurt·die (attack/sleep/wake 미사용 — 수면 매복 연출 후보) |
| Rat | 32×32 | 잡몹 `verdrat` | run→idle·death (attack 미사용) |

- 가공: `scripts/generate-enemy-assets.py`(합집합 bbox 크롭→`public/enemy/pack2/`) → `scripts/add-pack2-enemies.py`(카탈로그·웨이브풀) → `node scripts/build-atlas.mjs`.
- 잔여 제안 대기: 박쥐 수면→기상 매복, 골렘 유료판 색상 추가.

## 보스 전용 시트 (2026-09-02 보스 전면 개편)

`scripts/generate-boss-assets.py` → `scripts/update-boss-catalog.py` → `node scripts/build-atlas.mjs`.

| 게임 id | 원본 | 가공 | 애니 |
|---|---|---|---|
| `boss-abyss-demon` | DemonSlime | 그대로 | idle·walk·attack(cleave)·hit·death |
| `boss-minos` | Minotaur | 그대로 | idle·walk·attack |
| `boss-frost-guardian` | FrostGuardian | 그대로 | idle·walk·attack·hit·death |
| `mb-frost-golem` / `mb-magma-golem` | Golems Blue/Orange | 그대로 | idle·walk·attack·hit·death |
| `skullwolf-boss` (녹의 왕) | **public/enemy/Skullwolf/Massacre.png** (잠들어 있던 원본 — 카탈로그가 참조하지 않고 있었다) | 4행 분해 + idle 흔들기로 walk 생성 | idle·walk·attack·hit·death |
| `boss-siegehulk` (공성 거구) | Golems Blue | 무쇠·녹빛 재염색(hue+0.50, sat 0.42) + 주황 테두리 | idle·walk·attack·hit·death |
| `boss-needlequeen` (바늘 여왕) | Bat (DarkFantasyEnemies) | 자수정 재염색(hue+0.10, sat 1.35) + 금빛 테두리 | idle·walk·attack·hit·death |
| `death-lord` (사망군주) | Minotaur | 뼈·공허 탈색(hue+0.62, sat 0.30) + 보라 테두리 | idle·walk·attack |

규약 추가:
- **원본을 업스케일해 굽지 않는다.** NEAREST 업스케일은 표시 단계에서 하는 것과 결과가 같은데
  아틀라스만 4~9배로 부푼다 (2048×4096 예산 방어). 긴 애니는 균등 간격으로 솎아 낸다.
- 표시 크기는 프레임이 아니라 **몸통 알파 bbox** 기준으로 맞춘다 (프레임 여백이 원본마다 달라
  프레임 기준으로는 균일해지지 않는다). 보스 몸통 기하평균 132px · 중간보스 88px.
- 프레임이 커지면 물리 바디도 스케일 비례로 커진다 — 카탈로그 `hitbox` 로 몸통만 남긴다.

## 규약

1. 반입: 새 zip 은 `tilepacks/` 에 원본 그대로 + 추출본을 짧은 폴더명으로.
2. 시안 우선: 뭔가 만들 때 먼저 여기서 후보를 뽑아 미리보기를 만들어 사용자 컨펌.
3. 제안 의무: 팩을 열 때 "필요한 것"만 꺼내지 말고, 기존 것을 교체/보강할 후보도 찾아 제안.
4. 물/지형 전환: 가장자리 전환 타일이 있는 소스만 물·낭떠러지에 사용 (뚝 끊김 금지).
5. **단색 배경 금지**: 배경/바닥에 단색(플랫) 채우기를 쓰지 않는다. 질감 있는 타일을 쓰거나,
   다른 에셋을 복사해 색만 바꿔서(hue_shift/colorize_ramp) 쓴다 — 2026-08-31 사용자 지시.

## 캐릭터 (2026-08-31 반입)

| 폴더 | 격자 | 출처 | 내용 | 사용처 (확정) |
|---|---|---|---|---|
| characters/eleonore | 64px | Otsoga "Eleonore – The Salamander Witch" (itch.io, 무료판 Idle만 보유) | Idle 9f + Shadow 9f (그림자는 게임 미사용) | 2번째 키퍼 BASTION (`public/player/eleonore*.png`) |

- `characters/eleonore/generator/`: Idle 픽셀 재조합으로 hurt 4f·death 12f 시트를 굽는 파이썬 스크립트
  (`gen_a3.py`=death 컨셉A 프레임 생성 → `gen_sheets.py`=3종 시트 출력). 팔레트 외 신규 색 없음(허트 플래시 제외).
- 정식 Death(30f)·Hurt(4f)·이동/시전 등은 유료팩($14.90)에 존재 — 구매 시 교체 권장.
- 라이선스: 개인·상업 프로젝트 사용/수정 허용, 재판매 금지 (Otsoga).
