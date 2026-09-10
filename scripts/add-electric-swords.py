#!/usr/bin/env python3
"""번개 검 3종 추가 (2026-09-01 밸런스 패스).

배경 — 번개 검이 5종뿐이라 순수 번개 6·7세트가 물리적으로 불가능했다
(그중 3종은 조합 전용이라 상점에서 살 수 있는 건 2종뿐).
비조합 3종을 더해 8종으로 만들어 7세트를 실제로 짤 수 있게 한다.

왜 generate-sword-catalog.py 를 다시 돌리지 않는가
--------------------------------------------------
그 생성기는 카탈로그를 **공식으로 다시 써서** 밸런스 튜닝(2026-09-01 TUNING.md,
원소별 피해·쿨다운 배율)을 통째로 덮어쓴다. 그래서 여기서는 같은 생성기의
`build_entry` 공식만 import 해서 신규 3종만 만들어 **덧붙인다**.
(생성기 쪽 AUTHORING 테이블 `T` 에도 같은 3줄을 넣어 두었으니, 언젠가 전체를
다시 생성하더라도 이 3종은 같은 스탯으로 재현된다.)

스프라이트 — swords.png 는 192×960(32px, 6열 × 30행 = 180프레임)이고
180프레임이 전부 쓰이고 있어 빈칸이 없다. 시트 아래에 한 행(6칸)을 덧붙이고
기존 무원소 검 3프레임을 **번개 팔레트로 스왑**해 180·181·182 에 넣는다.
(Phaser 는 frameWidth/Height 로만 자르므로 행이 늘어도 로더 변경이 필요 없다.)

실행: python3 scripts/add-electric-swords.py   (repo 루트에서, 재실행 안전)
"""
import importlib.util
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'public/assets/swords.png')
CATALOG = os.path.join(ROOT, 'src/data/swordCatalog.json')
GENERATOR = os.path.join(ROOT, 'scripts/generate-sword-catalog.py')

COLS = 6
CELL = 32

# (신규 프레임, 원본 프레임, id, name, rarity, archetype, 팔레트 램프, lore)
#   원본은 전부 무원소(회색·강청색) 검이라 파란 램프로 갈아입히면 번개 계열로 읽힌다.
NEW_SWORDS = [
    (180, 69, 'sparkfinch', 'Sparkfinch', 'uncommon', 'swift', 'sky',
     '깃털 끝마다 잔불꽃 대신 잔전류가 튄다.'),
    (181, 70, 'arcshrike', 'Arcshrike', 'rare', 'assassin', 'cyan',
     '한 번 그은 자리에 파란 금이 오래 남는다.'),
    (182, 82, 'thunderowl', 'Thunderowl', 'epic', 'heavy', 'indigo',
     '날개를 접고 나서야 천둥이 뒤늦게 따라온다.'),
]

# 명도(0~1) → 색. 원본의 명암 구조를 그대로 두고 색만 갈아끼운다.
RAMPS = {
    'sky': [(0.00, (0x16, 0x28, 0x3a)), (0.35, (0x2f, 0x6a, 0x92)),
            (0.62, (0x63, 0xb3, 0xd9)), (0.85, (0xa8, 0xdc, 0xf0)),
            (1.00, (0xe8, 0xf7, 0xff))],
    'cyan': [(0.00, (0x10, 0x1f, 0x34)), (0.35, (0x24, 0x56, 0x7f)),
             (0.62, (0x4f, 0xa3, 0xd4)), (0.85, (0x93, 0xd4, 0xee)),
             (1.00, (0xdf, 0xf3, 0xff))],
    'indigo': [(0.00, (0x14, 0x1a, 0x35)), (0.35, (0x2f, 0x4a, 0x94)),
               (0.62, (0x5b, 0x8f, 0xd9)), (0.85, (0x9f, 0xd0, 0xf4)),
               (1.00, (0xf0, 0xfb, 0xff))],
}


def ramp_color(ramp, t):
    for i in range(len(ramp) - 1):
        t0, c0 = ramp[i]
        t1, c1 = ramp[i + 1]
        if t <= t1:
            k = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return tuple(round(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return ramp[-1][1]


def recolor(tile, ramp_name):
    ramp = RAMPS[ramp_name]
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    src = tile.load()
    dst = out.load()
    for y in range(CELL):
        for x in range(CELL):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            nr, ng, nb = ramp_color(ramp, lum)
            dst[x, y] = (nr, ng, nb, a)
    return out


def load_generator():
    spec = importlib.util.spec_from_file_location('sword_generator', GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    sheet = Image.open(SHEET).convert('RGBA')
    rows = sheet.height // CELL
    needed_rows = max(rows, (max(f for f, *_ in NEW_SWORDS) // COLS) + 1)
    if needed_rows > rows:
        grown = Image.new('RGBA', (sheet.width, needed_rows * CELL), (0, 0, 0, 0))
        grown.paste(sheet, (0, 0))
        sheet = grown

    for frame, source, _id, _name, _rarity, _arch, ramp, _lore in NEW_SWORDS:
        sx, sy = (source % COLS) * CELL, (source // COLS) * CELL
        tile = recolor(sheet.crop((sx, sy, sx + CELL, sy + CELL)), ramp)
        dx, dy = (frame % COLS) * CELL, (frame // COLS) * CELL
        sheet.paste(tile, (dx, dy))
    sheet.save(SHEET)

    generator = load_generator()
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    by_id = {e['id']: i for i, e in enumerate(catalog)}
    used_frames = {e['sheetOrder'] for e in catalog}

    for frame, _source, id_, name, rarity, arch, _ramp, lore in NEW_SWORDS:
        assert frame not in used_frames or catalog[by_id.get(id_, -1)]['sheetOrder'] == frame, frame
        if id_ in by_id:
            # 재실행 안전: 이미 있으면 **건드리지 않는다**. 이 3종에도 원소 단위
            # 밸런스 배율(TUNING.md §5-1 electric ×0.91)이 이미 얹혀 있어서,
            # 공식값으로 덮어쓰면 튜닝이 조용히 사라진다.
            print(f'  skip {id_} (이미 카탈로그에 있음 — 스탯 보존)')
            continue
        catalog.append(generator.build_entry(frame, id_, name, 'electric', rarity, arch, 0, lore, sheet))
    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    frames = [e['sheetOrder'] for e in catalog]
    assert len(frames) == len(set(frames)), 'duplicate frame'
    print(f'sheet: {sheet.width}x{sheet.height} ({sheet.width // CELL * (sheet.height // CELL)} frames)')
    print(f'swords: {len(catalog)}')
    for _f, _s, id_, *_ in NEW_SWORDS:
        entry = catalog[[e["id"] for e in catalog].index(id_)]
        print('  ', json.dumps(entry, ensure_ascii=False))


if __name__ == '__main__':
    main()
