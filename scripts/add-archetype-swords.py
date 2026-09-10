#!/usr/bin/env python3
"""거동 아키타입 확대 +12종 (2026-09-01 2차).

무엇을 하는가
-------------
아키타입(선회검·말뚝검·참격검)이 각 7자루뿐이라 "고른 거동으로 굴리는 빌드"가
성립하지 않았다. 각 아키타입을 **11자루**로 늘린다 (7 → 11, 총 21 → 33).

  · 기존 검 9자루 재지정 (아키타입당 3) — 스탯은 손대지 않는다.
  · 신규 3자루 (아키타입당 1) — 시트의 마지막 빈칸 3개를 채운다.

왜 신규가 3자루뿐인가 — 시트 여유
---------------------------------
swords.png 는 192×992 (32px · 6열 × 31행 = 186프레임)이고 카탈로그가 183개를
쓰고 있었다. 남은 자리는 **108 · 114 · 155 세 칸뿐**이다 (원본 팩에 섞여 있던
"검이 아닌 프레임" — 리본·물방울·아이스크림 콘. generate-sword-catalog.py 의
EXCLUDED 가 비워 두고 있던 자리다).

시트를 한 행 늘리면(192×1024) 프레임 수가 186 → 192 로 바뀌고 프레임 수를 박아 둔
회귀 테스트(texFrames === 187)와 로더 규약을 함께 손대야 한다. 12자루를 위해
그 비용을 치를 이유가 없다 — 아키타입은 **거동**이 정체성이고, 재지정된 검은
자기 실루엣을 그대로 쓰는 편이 도감에서도 자연스럽다. 그래서
**신규 3 (전용 스프라이트) + 재지정 9 (기존 프레임 재사용)** 으로 간다.
결과적으로 186프레임을 한 칸도 남기지 않고 전부 쓴다.

무엇을 기준으로 골랐는가
------------------------
1. **로어** — 이미 그 거동을 말하고 있는 검 (돌아온다 / 박힌다 / 곧게 꿴다).
2. **등급·원소 분포** — 아키타입마다 원소 8종이 전부 들어가고 등급이 5단계로
   퍼지게 맞췄다 (behavior-test 가 등급 ≥4 · 원소 ≥5 를 요구한다).
3. **밸런스 안전** — 조합 레시피의 **재료로 쓰이는 검은 피했다**. 재료가 세지면
   "죽은 레시피"(결과가 최고 재료의 1.15배 미만) 판정이 뒤집힐 수 있다.
   약한 원소(ice·blood·gold)의 중상위 검을 우선 골라 원소 편차를 좁히는 쪽으로 뒀다.

실행: python3 scripts/add-archetype-swords.py   (repo 루트에서, 재실행 안전)
검증: node scripts/balance-sim/run.mjs --gate --rounds=100
"""
import importlib.util
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'public/assets/swords.png')
CATALOG = os.path.join(ROOT, 'src/data/swordCatalog.json')
GENERATOR = os.path.join(ROOT, 'scripts/generate-sword-catalog.py')
BEHAVIOR_SCRIPT = os.path.join(ROOT, 'scripts/add-behavior-swords.py')

COLS = 6
CELL = 32


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# 드로잉 헬퍼·팔레트는 1차 스크립트 것을 그대로 쓴다 (규약이 한 곳에만 있게)
B = load_module(BEHAVIOR_SCRIPT, 'add_behavior_swords')

# ---------------------------------------------------------------------------
# 신규 3종 — 시트의 마지막 빈칸
# (프레임, id, 이름, 원소, 등급, 생성기 계열, behavior, 로어, 그림)
# ---------------------------------------------------------------------------
NEW_SWORDS = [
    (114, 'gyrefinch', 'Gyrefinch', 'ice', 'uncommon', 'swift', 'boomerang',
     '서리 호가 한 바퀴를 돌아 제자리로 온다.',
     lambda: B.draw_boomerang(B.ICE, B.IRON, length=13.0, bend=2.4, accent=B.ICE[4])),
    (155, 'pylonbeak', 'Pylonbeak', 'blood', 'rare', 'heavy', 'stake',
     '박아 넣은 자리를 중심으로 붉은 웅덩이가 넓어진다.',
     lambda: B.draw_stake(B.RED, B.IRON, length=9.5, accent=B.RED[4])),
    (108, 'aurumshrike', 'Aurumshrike', 'gold', 'rare', 'assassin', 'lance',
     '금빛 궤도 하나에 늘어선 것들이 전부 꿰인다.',
     lambda: B.draw_lance(B.GLD, B.BRASS, length=19.0, accent=B.GLD[4])),
]

# ---------------------------------------------------------------------------
# 기존 검 재지정 9자루 — 스탯은 건드리지 않는다 (거동 계수는 swordBehavior.ts)
# ---------------------------------------------------------------------------
REASSIGN = {
    # 선회검 — 호를 그리고 돌아오는 서사
    'flarekite': 'boomerang',    # 불꽃 리본이 궤적을 따라 남는다
    'umbralswift': 'boomerang',  # 보랏빛 잔상이 반 박자 늦게 도착한다
    'scarbeak': 'boomerang',     # 갈고리 흉터는 평생 남는다 (휜 갈고리)
    # 말뚝검 — 박혀서 버티는 서사
    'thunderowl': 'stake',       # 날개를 접고 나서야 천둥이 뒤늦게 따라온다
    'vanewing': 'stake',         # 바람개비(풍향계)는 박혀 있어야 읽는다
    'chimekite': 'stake',        # 울릴 때마다 금속 종소리가 난다 (선 채로 울리는 종)
    # 참격검 — 곧게 멀리 꿰는 서사
    'hollykite': 'lance',        # 가시는 녹의 몫 — 곧은 가시
    'tineshrike': 'lance',       # 세 갈래 검은 이빨 (창끝 미늘)
    'cirruswing': 'lance',       # 새털구름의 높이에서 곧게 떨어진다
}


def paste(sheet, frame, tile):
    x, y = (frame % COLS) * CELL, (frame // COLS) * CELL
    sheet.paste(Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)), (x, y))
    sheet.paste(tile, (x, y), tile)


def main():
    sheet = Image.open(SHEET).convert('RGBA')
    assert sheet.size == (192, 992), f'예상 밖 시트 크기 {sheet.size} — 프레임 자리 계산이 어긋난다'

    for frame, _id, _name, _el, _r, _a, _b, _lore, draw in NEW_SWORDS:
        paste(sheet, frame, draw())
    sheet.save(SHEET)

    generator = load_module(GENERATOR, 'sword_generator')
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    by_id = {e['id']: e for e in catalog}
    used = {e['sheetOrder']: e['id'] for e in catalog}

    added = 0
    for frame, id_, name, element, rarity, arch, behavior, lore, _draw in NEW_SWORDS:
        if id_ in by_id:
            by_id[id_]['behavior'] = behavior   # 재실행 안전: 스탯 보존
            continue
        assert frame not in used, f'프레임 {frame} 은 이미 {used[frame]} 가 쓰고 있다'
        entry = generator.build_entry(frame, id_, name, element, rarity, arch, 0, lore, sheet)
        entry['behavior'] = behavior
        catalog.append(entry)
        used[frame] = id_
        added += 1

    for id_, behavior in REASSIGN.items():
        assert id_ in by_id, f'{id_} 가 카탈로그에 없다'
        by_id[id_]['behavior'] = behavior

    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    frames = [e['sheetOrder'] for e in catalog]
    assert len(frames) == len(set(frames)), '중복 프레임'
    assert max(frames) < 186, '프레임 범위 초과 — 시트를 늘려야 한다'

    counts = {}
    for e in catalog:
        counts[e.get('behavior', 'orbit')] = counts.get(e.get('behavior', 'orbit'), 0) + 1
    print(f'swords: {len(catalog)} (신규 {added})  ·  빈 프레임 {186 - len(frames)}칸')
    print('거동 분포:', counts)
    for b in ('boomerang', 'stake', 'lance'):
        picks = [e for e in catalog if e.get('behavior') == b]
        rar = {}
        for e in picks:
            rar[e['rarity']] = rar.get(e['rarity'], 0) + 1
        els = sorted({e.get('element', '-') for e in picks})
        print(f'  {b:9s} {len(picks):2d}종  등급 {len(rar)}단계 {rar}')
        print(f'            원소 {len(els)}종 {els}')


if __name__ == '__main__':
    main()
