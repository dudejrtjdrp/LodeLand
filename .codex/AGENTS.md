# moveSword — 에이전트 스킬 색인

이 디렉터리는 Claude(Cowork/Claude Code)와 Codex(ChatGPT CLI)가 **공용으로 읽는** 스킬 모음이다.
각 스킬은 `.codex/skills/<name>/SKILL.md` 에 있고, YAML 프런트매터의 `description` 이 발동 조건이다.

작업이 아래 주제에 해당하면 **먼저 해당 SKILL.md 를 읽고 그 규약을 따른다.**

| 스킬 | 언제 읽는가 |
|---|---|
| `movesword-fx-pipeline` | moveSword 저장소에서 스킬/이펙트 연출을 건드릴 때 — **이 저장소 작업이면 거의 항상** |
| `pixel-vfx-spritesheet` | 이펙트를 스프라이트시트로 설계·생성·리패킹할 때 |
| `phaser-fx-runtime` | Phaser 3 에 시트를 로드·애니메이션 등록·풀링 헬퍼로 배선할 때 |
| `game-asset-sourcing` | 외부 에셋을 받아 통합할 때 (라이선스 기록 강제) |
| `sprite-atlas-packing` | 아틀라스 패킹, 텍스처 예산, 스프라이트 어긋남·가장자리 이물질 문제 |
| `game-feel-juice` | 타격감/연출 수치를 정할 때 (히트스톱·흔들림·텔레그래프) |
| `game-sfx-audio` | 효과음·BGM 조달·생성·동기화 |

## 프로젝트 불변 규칙 (스킬보다 우선)

- 연출은 공유 FX 레이어(`fx*`)만 쓴다. `add.circle` + 트윈 금지.
- 새 이펙트 스프라이트는 기존 절차적 연출을 **지우지 말고 폴백으로 남긴다**.
- 프레임 수·시트 스펙은 매니페스트(`src/logic/*Sheets.ts`)로 자동 생성한다. 손으로 적지 않는다.
- 받은 에셋은 `assets-src/` 에 원본 보존 + `assets-src/LICENSES.md` 에 URL·라이선스·날짜 기록.
- 뎁스는 `movesword-fx-pipeline` 의 표를 따른다. 매직넘버 금지.
- 작업 후 `*-test.mjs` 헤드리스 체크와 스크린샷 QA 를 돌린다.

## 전역 설치 (선택)

프로젝트 밖에서도 쓰려면 홈으로 복사한다.

```sh
mkdir -p ~/.codex/skills
cp -R .codex/skills/* ~/.codex/skills/
# Codex 가 AGENTS.md 를 읽게 하려면
cat .codex/AGENTS.md >> ~/.codex/AGENTS.md
```
