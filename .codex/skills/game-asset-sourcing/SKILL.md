---
name: game-asset-sourcing
description: 게임에 쓸 무료/CC0 에셋(이펙트·캐릭터·타일·UI·사운드)을 어디서 어떻게 구하고, 라이선스를 어떻게 기록·관리할지. 에셋 팩을 받아 프로젝트에 통합할 때, 또는 "이 스킬에 맞는 이펙트 구해줘" 같은 요청에 발동. 출처 링크와 라이선스 기록을 강제한다.
---

# 게임 에셋 조달 & 라이선스 관리

## 0. 원칙

1. **라이선스를 먼저 확인하고 다운로드한다.** 나중에 확인하면 이미 코드에 박혀 있어서 빼기가 어렵다.
2. **받은 즉시 출처를 기록한다.** URL·작성자·라이선스·받은 날짜. 기억은 못 믿는다.
3. **원본을 지우지 않는다.** 가공본만 `public/` 에 넣고 원본은 `assets-src/` 에 보존한다. 톤 조정·리패킹을 다시 해야 할 일이 반드시 생긴다.
4. 상업 배포 가능성이 조금이라도 있으면 **CC0 / CC-BY / OFL** 만 쓴다. "free for non-commercial", "credit required + no redistribution" 은 피한다.

## 1. 라이선스 빠른 판별

| 라이선스 | 상업 이용 | 수정 | 크레딧 | 비고 |
|---|---|---|---|---|
| CC0 / Public Domain | O | O | 불필요 | **최우선 선택** |
| CC-BY 4.0 | O | O | **필수** | 크레딧 문구를 게임 내 표기 |
| CC-BY-SA | O | O | 필수 + 동일조건 | 파생물도 SA로 풀어야 함 — 주의 |
| CC-BY-NC | X | O | 필수 | 상업 불가 — 쓰지 말 것 |
| itch.io 개별 약관 | 팩마다 다름 | — | — | 페이지 본문의 License 절을 직접 읽는다 |
| OGA-BY 3.0 | O | O | 필수 | OpenGameArt 전용 |

itch.io 는 팩마다 저자가 직접 문구를 쓴다. 태그만 믿지 말고 **페이지의 라이선스 문단과 동봉된 LICENSE.txt 를 둘 다** 확인한다.

## 2. 주요 조달처

### 이펙트/VFX (픽셀아트)
- **Foozle — Pixel Magic Effects** (CC0): https://foozlecc.itch.io/pixel-magic-sprite-effects — 화염/대지/바람/물 각 2종 + 포탈 + 폭발, 아이콘 포함
- **CodeManu — Free Pixel Effects Pack**: https://codemanu.itch.io/pixelart-effect-pack — Pixel FX Designer 로 만든 100×100 이펙트 20종
- **itch.io CC0 × 픽셀아트 목록**: https://itch.io/game-assets/free/tag-cc0/tag-pixel-art
- **itch.io 이펙트 × 픽셀아트**: https://itch.io/game-assets/free/tag-effects/tag-pixel-art
- **itch.io 2D × 이펙트**: https://itch.io/game-assets/free/tag-2d/tag-effects

### 파티클/범용 스프라이트
- **Kenney — Particle Pack** (CC0, 80+ 스프라이트, 불/연기/마법/스파크/전기): https://kenney.nl/assets/particle-pack
- **OpenGameArt — Particle Pack**: https://opengameart.org/content/particle-pack-80-sprites
- **OpenGameArt — Explosion Spritesheet** (CC0): https://opengameart.org/content/explosion-spritesheet
- **OpenGameArt — cc0 special effects**: https://opengameart.org/content/cc0-special-effects
- **OpenGameArt — Explosion particles sprite atlas**: https://opengameart.org/content/explosion-particles-sprite-atlas
- **OpenGameArt — Smoke particle assets**: https://opengameart.org/content/smoke-particle-assets
- **OpenGameArt — Kenney 업로드 전체 (CC0)**: https://opengameart.org/content/all-cc0-uploader-kenney
- **OpenGameArt — CC0 리소스 모음**: https://opengameart.org/content/cc0-resources

### 직접 생성하는 도구
- **EffectTextureMaker** (웹, 무료, 출력물 CC0): https://mebiusbox.github.io/contents/EffectTextureMaker/ — 브라우저에서 실시간으로 이펙트 스프라이트시트 생성. 라이선스 부담 없음.
- **Pixel FX Designer** (유료, Win/macOS): https://codemanu.itch.io/particle-fx-designer — 슬라이더로 픽셀 파티클을 만들고 시트/GIF 로 내보냄
- **JuiceFX** (CodeManu) — 정지 이미지에 애니메이션을 입혀 "juice" 를 추가
- **Aseprite** — 픽셀아트 애니메이션 업계 표준. 스프라이트시트 export 지원.

### 사운드
- **freesound.org** — 라이선스가 파일마다 다르니 CC0 필터 필수
- **sfxr / jsfxr / ChipTone** — 8비트 SFX 절차 생성
- **OpenGameArt 오디오 섹션** — CC0 필터

## 3. 라이선스 장부 (필수 산출물)

에셋을 하나라도 받으면 `assets-src/LICENSES.md` 에 아래 형식으로 **반드시** 추가한다.

```markdown
## fx/foozle-pixel-magic
- 출처: https://foozlecc.itch.io/pixel-magic-sprite-effects
- 작성자: Foozle (foozlecc)
- 라이선스: CC0 1.0 Universal (크레딧 불필요)
- 받은 날짜: 2026-09-05
- 원본 위치: assets-src/fx/foozle-pixel-magic/
- 사용처: fx-nova-fire, fx-tornado  (public/fx/)
- 가공: 256px 재샘플 + 팔레트를 LODELAND 램프로 리컬러 (scripts/recolor-fx.py)
```

크레딧이 필요한 라이선스(CC-BY 등)를 하나라도 쓰면 게임 내 **크레딧 화면에도 같은 정보를 노출**한다. 장부만 쓰고 게임에 안 넣으면 위반이다.

## 4. 통합 절차

1. 원본 압축 해제 → `assets-src/<카테고리>/<팩이름>/` (원본 그대로, 리네임 금지)
2. `LICENSES.md` 항목 추가
3. 가공 스크립트 작성 → `scripts/` (리사이즈·리컬러·리패킹·매니페스트 생성). **손으로 편집하지 않는다** — 재현 가능해야 톤을 다시 맞출 수 있다.
4. 산출물만 `public/` 으로
5. 매니페스트 자동 생성 → 코드에서 프레임 수를 손으로 적지 않는다
6. 인게임 스크린샷으로 톤·크기 확인

## 5. 톤 통일

받은 팩은 대부분 프로젝트 팔레트와 안 맞는다. 그대로 넣으면 "붙여넣은 티"가 난다.

- 팩의 지배색을 프로젝트 램프로 매핑하는 리컬러 스크립트를 쓴다 (기존 `recolor-*.py` 관례를 따를 것)
- 채도와 명도 대비를 게임의 기존 에셋과 맞춘다. 특히 **외곽선 유무**가 통일되어야 한다.
- 크기 규격(논리 픽셀 단위)을 맞춘다. 팩이 2px 픽셀인데 게임이 4px면 절반으로 리샘플하거나 안 쓴다.
- 확대(upscale)는 하지 않는다. 흐려진다. 필요한 크기보다 큰 소스를 골라 축소한다.

## 6. 하지 말 것

- 라이선스 불명 에셋을 "일단 넣고 나중에 확인"
- 게임 스크린샷·유튜브에서 스프라이트를 추출해 사용
- AI 생성 이미지를 픽셀아트 시트로 그대로 사용 (프레임 간 일관성이 안 맞아 애니메이션이 떨린다 — 참고용 러프로만)
- 원본을 지우고 가공본만 남기기
