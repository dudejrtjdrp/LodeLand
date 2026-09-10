#!/usr/bin/env python3
"""맵 테마·대기마을 에셋 베이크 (assets-src → public).

산출물:
  public/map/themes64.png      : 테마별 바닥 타일 1종씩 가로 스트립 (64px, MAP_THEMES 순서)
  public/deco2/<theme>-<n>.png : 테마별 장식 스프라이트 (원본 해상도, 투명 배경)
  public/village/*.png         : 대기마을 프롭(분수·기둥·표지판·모닥불·제단 등)·게이트·NPC 시트

원본은 assets-src/tilepacks (사용자 라이브러리 — assets-src/README.md 참조).
재실행 안전: 항상 소스에서 새로 굽는다. 테마 추가 시 TILES/DECOS 에 항목만 추가.
"""
from PIL import Image
import colorsys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'tilepacks')
PUB = os.path.join(ROOT, 'public')

RUINS = os.path.join(SRC, 'AncientRuins', 'EPIC RPG World Pack - [FREE Demo]Ancient Ruins - Copia')
GRASS = os.path.join(SRC, 'GrassLand2.0', 'EPIC RPG World Pack - [FREE Demo]Grass Land 2.0-REWORK')

SHEETS = {
    'tiny1': os.path.join(PUB, 'map', 'tinysword_tiles1.png'),
    'tiny5': os.path.join(PUB, 'map', 'tinysword_tiles5.png'),
    'dungeon': os.path.join(SRC, 'PP_RPG', 'P_P_FREE_RPG_TILESET', 'Dungeon_24x24.png'),
    'forest_t': os.path.join(SRC, 'TopDownForest', 'TopDownFantasy-Forest', 'Tiles', 'Tileset.png'),
    'forest_d': os.path.join(SRC, 'TopDownForest', 'TopDownFantasy-Forest', 'Decorations', 'Decorations.png'),
    'ruins_t': os.path.join(RUINS, 'Tilesets', 'Tileset-Terrain2.png'),
    'ruins_p': os.path.join(RUINS, 'Props', 'Atlas-Props.png'),
    'merchant_idle': os.path.join(RUINS, 'Characters', 'NPC Merchant-idle.png'),
    'forgot_t': os.path.join(SRC, 'ForgottenMemories', 'TileSet.png'),
    'forgot_tr': os.path.join(SRC, 'ForgottenMemories', 'Trees_seperated.png'),
    'forgot_p': os.path.join(SRC, 'ForgottenMemories', 'Props.png'),
    'grass_t': os.path.join(GRASS, 'Tilesets and props', 'Tilesets and props Demo.png'),
    'dungeon_d': os.path.join(SRC, 'PP_RPG', 'P_P_FREE_RPG_TILESET', 'decor.png'),
}
IMG = {}


def sheet(key):
    if key not in IMG:
        IMG[key] = Image.open(SHEETS[key]).convert('RGBA')
    return IMG[key]


def crop(key, x, y, w, h):
    return sheet(key).crop((x, y, x + w, y + h))


def save(im, *path):
    out = os.path.join(PUB, *path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, optimize=True)
    print('wrote', os.path.relpath(out, PUB), im.size)


def hue_shift(im, deg, sat=1.0, val=1.0):
    """색상환 회전 복제 — '단색 배경 금지, 에셋 복사+색변경 허용' 규칙의 도구."""
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            h = (h + deg / 360) % 1
            s = min(1, s * sat)
            v = min(1, v * val)
            r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return im


def colorize_ramp(im, dark, mid, light):
    """휘도 → 3단 색 램프 매핑 (원본 명암 유지, 완전 재채색)."""
    im = im.convert('RGBA')
    px = im.load()
    def lerp(c0, c1, t):
        return tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            c = lerp(dark, mid, lum * 2) if lum < 0.5 else lerp(mid, light, (lum - 0.5) * 2)
            px[x, y] = (c[0], c[1], c[2], a)
    return im


# ---------------------------------------------------------------------------
# 1) 바닥 타일 스트립 — MAP_THEMES(src/logic/mapThemes.ts) 순서와 반드시 일치.
#    규칙(사용자): 단색에 가까운 타일 금지 — 텍스처 있는 타일을 쓰거나,
#    다른 팩의 텍스처 타일을 복사해 색을 바꿔 쓴다 (hue_shift / colorize_ramp).
# ---------------------------------------------------------------------------
TILES = [
    ('fire', 'tiny1', 64, 64, 64, None),        # Tiny Swords 1 중앙 (질감 有, 틴트는 런타임)
    ('ice', 'tiny5', 64, 64, 64, None),         # Tiny Swords 5 중앙
    ('electric', 'dungeon', 96, 48, 24, None),  # 석조 포장 벽돌 (질감 有)
    # 독버섯 숲: GrassLand 질감 잔디를 황록으로 색상 회전 (원본 forest 타일은 단색이라 탈락)
    ('poison', 'grass_t', 704, 96, 32, lambda t: hue_shift(t, -28, sat=0.92, val=0.97)),
    ('gold', 'ruins_t', 640, 160, 32, None),    # 풀숲+잔해 (질감 有)
    # 공허 잿땅: 밝은 잔해 무더기를 자두빛 램프로 완전 재채색
    ('void', 'forgot_t', 576, 480, 32, lambda t: colorize_ramp(t, (40, 30, 52), (99, 78, 118), (172, 150, 194))),
    ('blood', 'forgot_t', 1536, 576, 32, None),  # 잔돌 박힌 흙 (질감 有, 핏빛은 런타임 틴트)
    ('wind', 'grass_t', 704, 96, 32, None),     # 질감 잔디
]
strip = Image.new('RGBA', (64 * len(TILES), 64))
for i, (name, key, x, y, ts, fx) in enumerate(TILES):
    t = crop(key, x, y, ts, ts)
    if fx is not None:
        t = fx(t)
    if ts != 64:
        t = t.resize((64, 64), Image.NEAREST)
    strip.paste(t, (i * 64, 0))
save(strip, 'map', 'themes64.png')

# ---------------------------------------------------------------------------
# 2) 테마 장식 (fire/ice 는 기존 Tiny Swords deco 를 그대로 쓰므로 여기 없음)
#    이름 규칙: <theme>-<n>.png → 텍스처 키 deco2-<theme>-<n>
# ---------------------------------------------------------------------------
DECOS = {
    'electric': [
        ('dungeon_d', 148, 0, 16, 48),   # 돌기둥
        ('dungeon_d', 3, 89, 19, 18),    # 횃불
        ('dungeon_d', 97, 0, 22, 24),    # 배럴
        ('dungeon_d', 102, 30, 12, 13),  # 크리스탈
        ('dungeon_d', 149, 52, 14, 17),  # 깃발
    ],
    'poison': [
        ('forest_d', 11, 143, 70, 98),   # 큰 나무
        ('forest_d', 163, 163, 38, 74),  # 나무
        ('forest_d', 75, 0, 40, 32),     # 이끼 통나무
        ('forest_d', 204, 8, 12, 14),    # 독버섯
        ('forest_d', 204, 71, 12, 14),   # 독버섯 2
        ('forest_d', 163, 133, 26, 22),  # 돌무더기
        ('forest_d', 68, 67, 24, 27),    # 수풀
    ],
    'gold': [
        ('ruins_p', 10, 2, 101, 182),    # 노란 큰 나무
        ('ruins_p', 138, 2, 101, 182),   # 노란 큰 나무 2
        ('ruins_p', 263, 114, 53, 76),   # 돌기둥
        ('ruins_p', 265, 65, 50, 30),    # 사암 블록
        ('ruins_p', 135, 227, 47, 27),   # 석판
        ('ruins_p', 16, 306, 29, 40),    # 금잔 (영혼)
    ],
    'void': [
        ('forgot_tr', 102, 310, 94, 106),  # 청록 나무
        ('forgot_tr', 99, 42, 94, 92),     # 청록 나무 2
        ('forgot_tr', 268, 321, 47, 92),   # 솔나무
        ('forgot_p', 647, 307, 54, 45),    # 청록 덤불
        ('forgot_p', 18, 226, 41, 30),     # 바위
        ('forgot_p', 609, 316, 30, 35),    # 작은 덤불
    ],
    'blood': [
        ('forgot_tr', 18, 307, 74, 109),   # 주황 나무
        ('forgot_tr', 15, 39, 74, 98),     # 주황 나무 2
        ('forgot_tr', 199, 316, 56, 100),  # 자작나무
        ('forgot_p', 647, 179, 54, 45),    # 주황 덤불
        ('forgot_p', 18, 290, 41, 30),     # 바위
        ('forgot_p', 609, 252, 30, 35),    # 작은 덤불
    ],
    'wind': [
        ('grass_t', 268, 343, 98, 175),  # 초록 큰 나무
        ('grass_t', 212, 562, 63, 35),   # 덤불
        ('grass_t', 611, 496, 61, 40),   # 바위+풀
        ('grass_t', 387, 266, 27, 19),   # 잔풀
        ('grass_t', 449, 336, 30, 12),   # 잔풀 2
        ('grass_t', 201, 497, 43, 28),   # 반딧불 덤불
    ],
}
for theme, entries in DECOS.items():
    for i, (key, x, y, w, h) in enumerate(entries):
        save(crop(key, x, y, w, h), 'deco2', f'{theme}-{i}.png')

# ---------------------------------------------------------------------------
# 3) 대기마을 — 프롭·게이트·NPC
# ---------------------------------------------------------------------------
save(crop('ruins_p', 83, 294, 123, 119), 'village', 'fountain.png')
save(crop('ruins_p', 263, 114, 53, 76), 'village', 'pillar.png')
save(crop('ruins_p', 259, 235, 90, 48), 'village', 'block.png')
save(crop('ruins_p', 389, 148, 53, 42), 'village', 'slab.png')
save(crop('ruins_p', 359, 194, 144, 189), 'village', 'altar.png')
save(crop('ruins_p', 16, 306, 29, 40), 'village', 'chalice.png')
save(crop('grass_t', 651, 567, 70, 50), 'village', 'campfire.png')
save(crop('dungeon_d', 75, 30, 16, 18), 'village', 'sign.png')
save(crop('dungeon_d', 75, 54, 16, 18), 'village', 'sign2.png')
save(crop('dungeon_d', 3, 89, 19, 18), 'village', 'torch.png')

# 에다 NPC (업그레이드·증강 담당) — 8프레임 110×110 대기 시트 그대로
save(sheet('merchant_idle'), 'village', 'npc-edda-idle.png')

# 게이트: 기둥 2 + 사암 인방 합성 (208×176) — 다음 라운드 입구
pillar = crop('ruins_p', 263, 114, 53, 76)
block = crop('ruins_p', 265, 65, 50, 30)
gw, gh = 208, 176
gate = Image.new('RGBA', (gw, gh))
p2 = pillar.resize((80, 114), Image.NEAREST)
gate.paste(p2, (4, gh - 114), p2)
gate.paste(p2, (gw - 84, gh - 114), p2)
lintel = block.resize((gw, 54), Image.NEAREST)
gate.paste(lintel, (0, gh - 158), lintel)
save(gate, 'village', 'gate.png')

print('done')
