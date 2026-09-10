#!/usr/bin/env python3
"""거동 아키타입 검 + 번개 3종 전용 스프라이트 (2026-09-01).

무엇을 하는가
-------------
1) **번개 3종 재작화** — sparkfinch/arcshrike/thunderowl(프레임 180~182)은
   무원소 검을 파란 램프로 갈아입힌 팔레트 스왑이라 "도감에서 색만 다른 검"이었다.
   여기서 세 자루를 각각 다른 실루엣으로 새로 그린다.
2) **거동 아키타입 대표 검 6종 신규** — 선회검(날개 곡선) · 말뚝검(끌/말뚝) ·
   참격검(창날) 실루엣을 아키타입당 2자루씩.
3) **기존 15자루 behavior 재지정** — 서사가 맞는 검에 아키타입을 얹는다
   (스탯은 건드리지 않는다. 거동 계수는 src/logic/swordBehavior.ts 가 갖는다).

프레임 자리
-----------
swords.png 는 192×992 (32px · 6열 × 31행 = 186프레임) 이고 카탈로그가 177개를 쓴다.
남은 9칸은 **시트 크기를 바꾸지 않고** 채울 수 있다:
  - 183·184·185 : 마지막 행의 빈칸
  - 44·87·101   : 원본 팩에 섞여 있던 "검이 아닌 장난 프레임"(도장/모자/블롭).
                  생성기 generate-sword-catalog.py 의 EXCLUDED 에서 제외돼 있던 자리다.
                  이 스크립트가 실제 검 그림으로 덮어쓰므로 EXCLUDED 에서도 뺐다.
(시트 크기가 그대로라 Phaser 로더도, 프레임 수 회귀 테스트(186)도 손댈 필요가 없다.)

왜 generate-sword-catalog.py 를 다시 돌리지 않는가
--------------------------------------------------
그 생성기는 카탈로그를 **공식으로 다시 써서** 밸런스 튜닝(TUNING.md)을 덮어쓴다.
add-electric-swords.py 와 같은 방식으로 `build_entry` 공식만 빌려 신규분만 덧붙인다.
(생성기의 AUTHORING 테이블 T 에도 같은 6줄을 넣어 두었다.)

그림 규약 — 기존 시트를 먼저 분석해서 맞춘 것
---------------------------------------------
  · 날은 전부 45° 대각선. 손잡이가 좌하단, 칼끝이 우상단.
  · 2톤 아웃라인: 빛 받는 위/왼쪽은 #3a4466, 그늘진 아래/오른쪽은 #181425.
  · 광원은 좌상단 — 날의 위쪽 모서리가 가장 밝고 아래쪽이 어둡다.
  · 색은 전부 시트에 이미 쓰이고 있는 팔레트에서만 고른다 (새 색을 만들지 않는다).

실행: python3 scripts/add-behavior-swords.py   (repo 루트에서, 재실행 안전)
"""
import importlib.util
import json
import math
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'public/assets/swords.png')
CATALOG = os.path.join(ROOT, 'src/data/swordCatalog.json')
GENERATOR = os.path.join(ROOT, 'scripts/generate-sword-catalog.py')

COLS = 6
CELL = 32

# ---------------------------------------------------------------------------
# 팔레트 — 전부 현재 swords.png 안에 이미 존재하는 색 (샘플링해서 고른 것)
# ---------------------------------------------------------------------------
OUT_D = (0x18, 0x14, 0x25)   # 그늘 쪽 아웃라인 (가장 어두움)
OUT_L = (0x3a, 0x44, 0x66)   # 빛 쪽 아웃라인

STL = [(0x3a, 0x44, 0x66), (0x5a, 0x69, 0x88), (0x8b, 0x9b, 0xb4), (0xc0, 0xcb, 0xdc), (0xff, 0xff, 0xff)]
BLU = [(0x12, 0x4e, 0x89), (0x00, 0x95, 0xe9), (0x8b, 0x9b, 0xb4), (0x2c, 0xe8, 0xf5), (0xff, 0xff, 0xff)]
ICE = [(0x12, 0x4e, 0x89), (0x5a, 0x69, 0x88), (0x8b, 0x9b, 0xb4), (0xc0, 0xcb, 0xdc), (0x2c, 0xe8, 0xf5)]
GLD = [(0x7a, 0x36, 0x1b), (0xf7, 0x76, 0x22), (0xfe, 0xae, 0x34), (0xfe, 0xe7, 0x61), (0xff, 0xff, 0xff)]
RED = [(0x3f, 0x28, 0x32), (0x9e, 0x28, 0x35), (0xe4, 0x3b, 0x44), (0xc0, 0xcb, 0xdc), (0xff, 0xff, 0xff)]
VOI = [(0x26, 0x2b, 0x44), (0x50, 0x15, 0x36), (0x68, 0x38, 0x6c), (0x8b, 0x9b, 0xb4), (0xc0, 0xcb, 0xdc)]
GRN = [(0x26, 0x5c, 0x42), (0x3e, 0x89, 0x48), (0x63, 0xc7, 0x4d), (0xc0, 0xcb, 0xdc), (0xff, 0xff, 0xff)]

WOOD = [(0x3f, 0x28, 0x32), (0x74, 0x3f, 0x39), (0x8f, 0x56, 0x3b), (0xb8, 0x6f, 0x50), (0xe4, 0xa6, 0x72)]
BRASS = [(0x7a, 0x36, 0x1b), (0xbe, 0x4a, 0x2f), (0xf7, 0x76, 0x22), (0xfe, 0xae, 0x34), (0xfe, 0xe7, 0x61)]
IRON = [(0x18, 0x14, 0x25), (0x26, 0x2b, 0x44), (0x3a, 0x44, 0x66), (0x5a, 0x69, 0x88), (0x8b, 0x9b, 0xb4)]


# ---------------------------------------------------------------------------
# 드로잉 헬퍼 — "대각선 띠(band)" 하나가 기본 단위다.
#
# 픽셀 (x, y) 를 날밑(ORIGIN) 기준의 대각선 좌표로 바꾼다:
#   u = ((dx) - (dy)) / 2   칼자루 → 칼끝 방향 (오른쪽 위)
#   v = ((dx) + (dy)) / 2   날의 폭 방향       (오른쪽 아래)
# 그리고 0 ≤ u ≤ L, |v| ≤ half(u) 인 픽셀을 채운다.
#
# ※ 왜 이렇게 하는가 — (+1,−1) 로 한 칸씩 찍으면 픽셀이 대각선으로만 맞닿아
#   빗금(체크무늬)처럼 보인다. 영역 판정으로 채우면 반대각선이 겹겹이 쌓여
#   4-이웃으로 이어진 **꽉 찬** 45° 날이 된다 (기존 시트의 날과 같은 모양).
# ---------------------------------------------------------------------------

ORIGIN = (9, 23)  # u=0, v=0 지점 (날밑 위치)


def blank():
    return Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))


def put(px, x, y, color):
    if 0 <= x < CELL and 0 <= y < CELL:
        px[x, y] = (color[0], color[1], color[2], 255)


def uv(x, y):
    dx = x - ORIGIN[0]
    dy = y - ORIGIN[1]
    return (dx - dy) / 2.0, (dx + dy) / 2.0


def to_xy(u, v):
    return int(round(ORIGIN[0] + u + v)), int(round(ORIGIN[1] - u + v))


def band(px, length, half, shade, u0=0.0, curve=None, origin_shift=0.0):
    """대각선 띠 하나.

    half(u)  : u 지점의 반폭 (0.5 ≈ 2px, 1.0 ≈ 3px, 1.5 ≈ 4px)
    shade(n) : 폭 방향 정규화 위치 n(-1=빛 쪽 모서리 … +1=그늘 쪽)에 대한 색
    curve(u) : 폭 방향으로 밀어내는 양 — 선회검의 날개 곡선을 만든다
    """
    for y in range(CELL):
        for x in range(CELL):
            u, v = uv(x, y)
            u -= origin_shift
            if u < u0 - 0.01 or u > length + 0.01:
                continue
            if curve:
                v -= curve(u)
            h = half(u)
            if h < 0 or abs(v) > h + 0.01:
                continue
            n = 0.0 if h <= 0.01 else v / h
            put(px, x, y, shade(n))


def ramp_shade(ramp, edge=None):
    """기본 명암: 위(빛) 모서리가 가장 밝고 아래(그늘) 모서리가 가장 어둡다."""
    def shade(n):
        if n <= -0.55:
            return edge or ramp[4]
        if n >= 0.55:
            return ramp[1]
        if n <= 0.0:
            return ramp[3]
        return ramp[2]
    return shade


def flat_shade(ramp):
    def shade(n):
        if n <= -0.4:
            return ramp[3]
        if n >= 0.4:
            return ramp[1]
        return ramp[2]
    return shade


def cross_band(px, ramp, u_center, reach, thick=0.5):
    """날을 가로지르는 막대 (날밑·목테). u 와 v 의 역할이 뒤바뀐 띠다."""
    for y in range(CELL):
        for x in range(CELL):
            u, v = uv(x, y)
            if abs(u - u_center) > thick + 0.01 or abs(v) > reach + 0.01:
                continue
            n = 0.0 if reach <= 0.01 else v / reach
            put(px, x, y, ramp[3] if n < -0.3 else (ramp[2] if n < 0.4 else ramp[1]))


def grip(px, u_from, u_to, cap_ramp, half=0.5):
    """자루(가죽) + 자루끝 쇠붙이. u_from > u_to (날밑에서 아래로)."""
    band(px, u_from, lambda u: half, flat_shade(WOOD), u0=u_to)
    cross_band(px, cap_ramp, u_to - 0.6, half + 0.5, thick=0.5)


def dot(px, u, v, color):
    x, y = to_xy(u, v)
    put(px, x, y, color)


def outline(px):
    """2톤 아웃라인. 빛 쪽(위/왼쪽)은 옅게, 그늘 쪽(아래/오른쪽)은 가장 어둡게."""
    filled = [(x, y) for y in range(CELL) for x in range(CELL) if px[x, y][3] > 0]
    light, dark = [], []
    for (x, y) in filled:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < CELL and 0 <= ny < CELL and px[nx, ny][3] == 0:
                (light if dx + dy < 0 else dark).append((nx, ny))
    for (x, y) in light:
        put(px, x, y, OUT_L)
    for (x, y) in dark:
        put(px, x, y, OUT_D)


# ---------------------------------------------------------------------------
# 실루엣 — 아키타입마다 한눈에 구분되는 형태를 준다
# ---------------------------------------------------------------------------

def draw_boomerang(ramp, guard_ramp, length=14, bend=2.6, accent=None):
    """선회검 — 날개처럼 휜 초승달 날. 날밑에 되돌아옴을 뜻하는 고리."""
    img = blank()
    px = img.load()

    def curve(u):
        return -bend * math.sin(math.pi * min(1.0, max(0.0, u / length)))

    def half(u):
        if u > length - 1.2:            # 칼끝으로 갈수록 얇아진다
            return max(0.0, (length - u) * 0.5)
        if u < 1.0:
            return 0.5
        return 0.62

    band(px, length, half, ramp_shade(ramp), u0=0.6, curve=curve)
    cross_band(px, guard_ramp, 0.0, 2.2, thick=0.5)
    # 회전 고리 — 되돌아오는 검이라는 표식
    dot(px, -0.5, -2.5, guard_ramp[3])
    dot(px, -0.5, 2.5, guard_ramp[1])
    grip(px, -1.0, -4.5, guard_ramp)
    if accent:
        for u in (length - 2.0, length - 5.0, 2.5):
            dot(px, u, curve(u) - 1.8, accent)
    outline(px)
    return img


def draw_stake(ramp, collar_ramp, length=9, accent=None):
    """말뚝검 — 짧고 두꺼운 끌. 끝은 베는 날이 아니라 사선 베벨이고,
    자루 끝에는 때려박는 넓은 머리가 달려 있다."""
    img = blank()
    px = img.load()

    def half(u):
        # 뾰족해지지 않는다 — 끝까지 같은 폭으로 가다가 뭉툭하게 끊긴다 (끌·말뚝)
        return 1.5

    band(px, length, half, ramp_shade(ramp), u0=0.8)
    # 끌 면의 세로 골 (말뚝임을 알리는 홈)
    for step in range(2, int(length) - 1):
        dot(px, step + 0.5, 0.0, ramp[2])
    # 박히는 끝 — 두들겨 뭉개진 어두운 마구리
    for v in (-1.5, -0.5, 0.5, 1.5):
        dot(px, length, v, ramp[1])
        dot(px, length - 0.5, v, ramp[2] if v <= 0 else ramp[1])
    cross_band(px, collar_ramp, 0.3, 2.6, thick=0.9)   # 넓은 목테
    grip(px, -0.8, -3.4, collar_ramp, half=0.6)
    # 때려박는 머리 (망치가 치는 자리 — 자루 끝의 넓은 캡)
    cross_band(px, collar_ramp, -4.4, 2.4, thick=0.9)
    if accent:
        dot(px, length - 2.0, -0.8, accent)
        dot(px, length - 4.5, 0.8, accent)
    outline(px)
    return img


def draw_lance(ramp, guard_ramp, length=19, accent=None):
    """참격검 — 아주 긴 자루 끝에 얹힌 좁은 창날. 사거리가 실루엣으로 보인다."""
    img = blank()
    px = img.load()
    head0 = length - 6.5

    def half(u):
        if u < head0:
            return 0.45                                  # 긴 자루
        if u > length - 1.6:
            return max(0.0, (length - u) * 0.55)         # 뾰족한 끝
        local = (u - head0) / 2.2
        return min(1.05, 0.45 + local * 0.6)             # 잎사귀꼴 창날

    band(px, length, half, ramp_shade(ramp), u0=0.4)
    # 창날 밑 미늘 두 개
    dot(px, head0 - 0.5, -1.6, guard_ramp[3])
    dot(px, head0 - 0.5, 1.6, guard_ramp[1])
    cross_band(px, guard_ramp, 0.0, 1.3, thick=0.5)
    grip(px, -0.5, -3.6, guard_ramp, half=0.55)
    if accent:
        dot(px, length - 2.0, 0.0, accent)
        dot(px, head0 + 1.5, -0.8, accent)
    outline(px)
    return img


def draw_bolt(ramp, guard_ramp, kind, accent):
    """번개 검 3종 — 같은 원소지만 실루엣이 서로 다르다 (팔레트 스왑 아님)."""
    img = blank()
    px = img.load()

    if kind == 'finch':
        # 짧고 가는 날 + 갈래진 날밑. 작고 빠른 검.
        length = 10.5
        band(px, length, lambda u: max(0.0, min(0.6, (length - u) * 0.5)),
             ramp_shade(ramp), u0=0.6)
        cross_band(px, guard_ramp, 0.0, 1.6, thick=0.5)
        dot(px, 0.8, -2.4, guard_ramp[3])
        dot(px, 0.8, 2.4, guard_ramp[1])
        grip(px, -0.6, -3.6, guard_ramp, half=0.55)
        for u, v in ((length + 0.8, 0.0), (7.0, -1.8), (4.0, 1.8)):
            dot(px, u, v, accent)

    elif kind == 'shrike':
        # 중간 길이 + 날 안을 지그재그로 가르는 번개 홈.
        length = 15.0
        band(px, length, lambda u: 0.55 if u < length - 1.4 else max(0.0, (length - u) * 0.5),
             ramp_shade(ramp), u0=0.7)
        for step in range(0, 12):
            dot(px, 2.0 + step, -0.5 if step % 2 == 0 else 0.5, accent)
        cross_band(px, guard_ramp, 0.0, 1.9, thick=0.5)
        grip(px, -0.6, -3.6, guard_ramp, half=0.55)
        dot(px, length + 0.8, 0.0, accent)

    else:  # 'owl' — 넓고 무거운 날 + 번개 꺾쇠 날밑
        length = 12.0
        band(px, length, lambda u: 1.3 if u < length - 2.0 else max(0.0, (length - u) * 0.62),
             ramp_shade(ramp), u0=0.9)
        for step in range(2, 9):
            dot(px, step + 0.5, 0.0, ramp[2])
        cross_band(px, guard_ramp, 0.4, 2.6, thick=0.9)
        # 번개 꺾쇠
        for u, v in ((1.6, -3.4), (0.6, -2.6), (1.6, -2.6), (-0.6, 3.4), (0.4, 2.6), (-0.6, 2.6)):
            dot(px, u, v, accent)
        grip(px, -1.0, -4.4, guard_ramp, half=0.6)
        for u, v in ((length + 0.9, 0.0), (8.0, -1.9)):
            dot(px, u, v, accent)

    outline(px)
    return img


# ---------------------------------------------------------------------------
# 무엇을 어디에 그리는가
# ---------------------------------------------------------------------------
# (프레임, id, 이름, 원소, 등급, 생성기 계열, behavior, 로어, 그림 함수)
NEW_SWORDS = [
    (183, 'curlewing', 'Curlewing', 'wind', 'uncommon', 'swift', 'boomerang',
     '던져 놓고 손을 펴고 기다리면, 반드시 제 손으로 돌아온다.',
     lambda: draw_boomerang(STL, BRASS, length=14.0, bend=2.6)),
    (44, 'ringtalon', 'Ringtalon', 'electric', 'epic', 'swift', 'boomerang',
     '지나간 자리마다 파란 고리가 하나씩 남는다.',
     lambda: draw_boomerang(BLU, BRASS, length=15.0, bend=3.0, accent=BLU[4])),

    (184, 'stakebeak', 'Stakebeak', 'blood', 'uncommon', 'heavy', 'stake',
     '한 번 박히면 뽑을 때까지 피가 멈추지 않는다.',
     lambda: draw_stake(RED, IRON, length=9.0)),
    (87, 'cairnowl', 'Cairnowl', 'void', 'epic', 'heavy', 'stake',
     '돌무지처럼 꽂혀 제 둘레의 빛을 천천히 삼킨다.',
     lambda: draw_stake(VOI, IRON, length=10.0, accent=VOI[4])),

    (185, 'lancequill', 'Lancequill', 'electric', 'uncommon', 'assassin', 'lance',
     '한 줄로 늘어선 것들을 한 번에 꿴다.',
     lambda: draw_lance(BLU, BRASS, length=18.0, accent=BLU[4])),
    (101, 'pikehawk', 'Pikehawk', 'ice', 'epic', 'assassin', 'lance',
     '찌른 자리에서부터 서리가 곧게 뻗어 나간다.',
     lambda: draw_lance(ICE, IRON, length=19.5, accent=ICE[4])),
]

# 번개 3종 재작화 — 카탈로그는 그대로 두고 **그림만** 갈아 끼운다
BOLT_REDRAWS = [
    (180, 'sparkfinch', lambda: draw_bolt(BLU, BRASS, 'finch', BLU[4])),
    (181, 'arcshrike', lambda: draw_bolt(BLU, IRON, 'shrike', BLU[4])),
    (182, 'thunderowl', lambda: draw_bolt(BLU, IRON, 'owl', BLU[3])),
]

# 기존 검의 behavior 재지정 — 로어가 이미 그 거동을 말하고 있는 검들로 골랐다.
# 스탯은 손대지 않는다 (거동 계수는 swordBehavior.ts 가 갖는다).
REASSIGN = {
    # 선회검 — 돌아오거나 휘어지는 서사
    'petalfinch': 'boomerang',    # 흰 꽃잎이 지기 전에 돌아온다
    'anchorbeak': 'boomerang',    # 닻처럼 가라앉고 파도처럼 돌아온다
    'harvestkite': 'boomerang',   # 밀이삭을 베는 낫의 호
    'carrionowl': 'boomerang',    # 썩은 것 위를 도는 붉은 낫
    'swanroc': 'boomerang',       # 백조의 목이 휘어지는 곳
    # 말뚝검 — 내리치고 박히는 서사
    'malletbeak': 'stake',        # 베지 못하면 부수면 된다
    'frosthawk': 'stake',         # 얼음 덩이가 그대로 철퇴다
    'bulwarkbeak': 'stake',       # 성벽 한 조각을 떼어 벼린 검
    'groveowl': 'stake',          # 숲 하나의 무게로 내리친다
    'haloroc': 'stake',           # 타오르는 고리가 하늘을 연다
    # 참격검 — 곧고 멀리 꿰는 서사
    'spirefinch': 'lance',        # 첨탑 끝처럼 곧은 창날
    'triggerbeak': 'lance',       # 방아쇠 감각으로 급소를 겨눈다
    'garnetswift': 'lance',       # 석류석 조각이 동맥을 찾는다
    'railshrike': 'lance',        # 곧게 벼린 궤도
    'lanternroc': 'lance',        # 어둠 속 사냥감을 비춰 노린다
}


def paste(sheet, frame, tile):
    x, y = (frame % COLS) * CELL, (frame // COLS) * CELL
    sheet.paste(Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)), (x, y))
    sheet.paste(tile, (x, y), tile)


def load_generator():
    spec = importlib.util.spec_from_file_location('sword_generator', GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    sheet = Image.open(SHEET).convert('RGBA')
    assert sheet.size == (192, 992), f'예상 밖 시트 크기 {sheet.size} — 프레임 자리 계산이 어긋난다'

    for frame, _id, _name, _el, _r, _a, _b, _lore, draw in NEW_SWORDS:
        paste(sheet, frame, draw())
    for frame, _id, draw in BOLT_REDRAWS:
        paste(sheet, frame, draw())
    sheet.save(SHEET)

    generator = load_generator()
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    by_id = {e['id']: e for e in catalog}
    used = {e['sheetOrder']: e['id'] for e in catalog}

    added = 0
    for frame, id_, name, element, rarity, arch, behavior, lore, _draw in NEW_SWORDS:
        if id_ in by_id:
            # 재실행 안전: 이미 있으면 스탯을 보존하고 behavior 만 확인한다
            by_id[id_]['behavior'] = behavior
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
        b = e.get('behavior', 'orbit')
        counts[b] = counts.get(b, 0) + 1
    print(f'sheet: {sheet.width}x{sheet.height} ({sheet.width // CELL * (sheet.height // CELL)} frames)')
    print(f'swords: {len(catalog)} (신규 {added})')
    print('거동 분포:', counts)
    for b in ('boomerang', 'stake', 'lance'):
        picks = [e for e in catalog if e.get('behavior') == b]
        rar = {}
        for e in picks:
            rar[e['rarity']] = rar.get(e['rarity'], 0) + 1
        print(f'  {b:9s} {len(picks)}종  등급 {rar}  '
              f'원소 {sorted({e.get("element", "-") for e in picks})}')


if __name__ == '__main__':
    main()
