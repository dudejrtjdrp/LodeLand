# 쇳깃 — 에셋 요청 명세

> 2026-08-25. 코드 드로잉으로 품질을 보장할 수 없는 에셋 목록.
> 준비 전까지는 기존 시트+혈통색 틴트를 그대로 사용한다(품질 낮은 임시 AI 이미지는 넣지 않음).
> 공통 스타일 기준: 기존 `public/player/*.png`·`public/enemy/Skullwolf/Massacre.png`와 같은
> 픽셀 밀도(64~128px 셀, 2~3px 클러스터 아웃라인 없는 소프트 셰이딩)와 같은 팔레트 계열.

---

## 1. 적 전용 시트 — 침뱉이 (원거리 녹)

- **사용 화면/위치**: 인게임 적 스프라이트 (`enemyCatalog.json`의 `shooter`, `shielded-shooter` 공유)
- **필요한 이유**: 현재 모든 적이 늑대(Massacre) 시트 1장을 틴트만 바꿔 공유 → 원거리 적이 늑대로 보여 행동 예측이 안 됨
- **권장 해상도**: 프레임 64×64, Aseprite 가로 시트 (행별 애니메이션)
- **화면 비율**: 정사각 프레임 (게임 내 44×44 표시)
- **파일 형식**: PNG (RGBA)
- **투명 배경**: 필요
- **권장 색상**: 몸통 녹 갈적(#8a4a2b 계열) + 삭은 청록 하이라이트(#4a6b5c), 침(발사체)은 밝은 주황
- **아트 스타일**: 기존 Skullwolf 시트와 동일한 픽셀 스타일. 고철+부식 질감
- **반드시 포함**: 목/대롱이 긴 실루엣(원거리임이 실루엣으로 읽힐 것), idle 6f / attack(침 뱉기 예열→발사) 5f / hit 4f / death 7f — 행 순서는 기존 시트와 동일
- **제외**: 해골 모티프, 보라색 발광, 사람형 실루엣
- **애니메이션**: 4행 (idle/attack/hit/death), attack 3프레임째가 발사 타이밍
- **생성 프롬프트 예시**: "64x64 pixel art sprite sheet, rust-plague beast with a long corroded funnel neck that spits needles, made of scrap metal and living rust, muted dark orange-brown palette with teal oxide highlights, 4 rows: idle 6 frames, spit attack 5 frames, hurt 4 frames, death crumble 7 frames, transparent background, side view, no outline glow"

## 2. 적 전용 시트 — 녹곤죽 (분열형)

- **사용 화면/위치**: `slime`, `slime-small`, `venom-slime`, `mb-slimeking` 공유
- **필요한 이유**: 곤죽(슬라임)류가 늑대 실루엣이라 분열 메커니즘이 시각적으로 전달되지 않음
- **권장 해상도**: 프레임 64×64, 같은 Aseprite 행 구조 (idle 6 / attack 5 / hit 4 / death 7)
- **파일 형식**: PNG (RGBA), 투명 배경 필요
- **권장 색상**: 삭은 녹청(#84b04a→#4a6b3c 그라데이션) + 고철 파편이 박힌 질감
- **반드시 포함**: 덩어리 실루엣(수평으로 퍼진 무게감), death는 두 덩이로 갈라지는 연출
- **제외**: 귀여운 눈망울, 광택 젤리 질감 (부식이어야 함)
- **생성 프롬프트 예시**: "64x64 pixel art sprite sheet, mound of living rust sludge with scrap shards embedded, splits apart when dying, murky green-brown oxide palette, 4 rows: idle wobble 6 frames, lunge 5 frames, hurt 4 frames, death splitting into two blobs 7 frames, transparent background"

## 3. 보스 시트 — 녹어미 (최종 보스)

- **사용 화면/위치**: 60맥 최종 보스 (`death-lord`)
- **필요한 이유**: 스토리의 정점(스승의 화로심장을 품은 어미)이 일반 늑대 틴트로 표시됨
- **권장 해상도**: 프레임 128×128 (게임 내 170×170 표시), 행 구조 동일
- **파일 형식**: PNG (RGBA), 투명 배경 필요
- **권장 색상**: 몸통 짙은 녹 갈적, **가슴 중앙에 잉걸빛(#d9702e) 화로심장이 크게 발광** — 이 발광점이 디자인의 핵심
- **반드시 포함**: 가슴의 화로심장(스승의 유산임이 보여야 함), 고철 뼈대 위 부식 덩어리, 사족 혹은 다족의 어미 실루엣
- **제외**: 인간형, 해골 얼굴, 보라 네온
- **애니메이션**: idle 6f(심장 박동과 몸 들썩임 동기화) / attack 5f / hit 4f / death 7f(심장이 멎으며 부서짐)
- **생성 프롬프트 예시**: "128x128 pixel art boss sprite sheet, colossal mother-beast made of rust and scrap bones, a glowing ember furnace-heart embedded in its chest pulsing orange, dark oxide browns, 4 rows: idle heartbeat 6 frames, sweeping attack 5 frames, flinch 4 frames, death where the heart dims and body crumbles 7 frames, transparent background"

## 4. 주인공 시트 교체 — 풀무 (떼지기)

- **사용 화면/위치**: 플레이어 스프라이트 3종 (`playerIdle/ Hurt/ Death.png` 대체)
- **필요한 이유**: 현재 기사풍 캐릭터에는 콘셉트의 핵심인 **가슴의 화로심장 창(窓)** 과 매장갑이 없음
- **권장 해상도**: 프레임 128×128, 기존과 동일 프레임 수 (idle 6 / hurt 4 / death 8)
- **파일 형식**: PNG (RGBA) 3파일, 투명 배경 필요
- **권장 색상**: 무채색 가죽옷 + 왼가슴 잉걸빛 발광창(#d9702e) + 담금 청 스카프 포인트(#6fa7bd)
- **반드시 포함**: 왼가슴 화로심장 창, 두꺼운 홰장갑(한 팔), 작달막한 실루엣, 무기를 들지 않은 손
- **제외**: 검을 쥔 손, 갑옷, 망토 휘날림
- **생성 프롬프트 예시**: "128x128 pixel art character sprite sheets, a small shepherd in worn leather with a glowing ember furnace-window on the left chest, thick falconry glove, no weapon in hands, muted cold palette with one orange glow accent and a steel-blue scarf, idle 6 frames / hurt 4 frames / death kneel 8 frames, transparent background"

## 5. 타이틀 키아트 (선택)

- **사용 화면/위치**: 타이틀 화면 배경 (현재는 코드 드로잉 입자+엠블럼)
- **필요한 이유**: 첫 화면의 정서 전달력 강화 (필수는 아님 — 현행 코드 드로잉도 성립)
- **권장 해상도**: 1920×1080 이상, 중앙 하단 여백(로고·버튼 자리) 확보
- **파일 형식**: PNG 또는 JPG (불투명)
- **권장 색상**: 식은 쇠 남회색 바탕, 지평선의 잉걸빛, 담금 청 하이라이트
- **반드시 포함**: 선회하는 칼날 실루엣 고리(작게), 가슴이 빛나는 떼지기 뒷모습, 멀리 녹 안개
- **제외**: 문자, 로고(코드로 얹음), 과도한 디테일(다크 바탕 유지)
- **생성 프롬프트 예시**: "moody pixel art key visual, a lone shepherd seen from behind with a glowing chest ember, ring of small blade-birds orbiting overhead, vast cold iron wasteland with rust fog on the horizon, dark blue-grey palette with single orange light source, empty lower third for UI"
