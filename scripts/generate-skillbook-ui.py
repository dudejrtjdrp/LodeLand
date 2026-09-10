#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스킬 책(K 창) 전용 UI 에셋 생성기 — public/ui/skillbook/*.png

Flat 팩(uf-*)은 픽셀아트 강판 톤이라 금장 장식 책 레이아웃을 표현하지 못한다.
이 스크립트는 스킬 창에서만 쓰는 매끈한(NEAREST 아닌 LINEAR) 에셋을 굽는다.

  sb-frame      나인슬라이스 — 금장 이중 테두리 + 어두운 속판 (창 전체)
  sb-corner     네 귀퉁이 장식 (회전해서 4곳)
  sb-plaque     제목 명판 (나인슬라이스, 금장 끝동)
  sb-panel      어두운 속패널 (목록/효과 상자)
  sb-panel-lit  선택된 속패널
  sb-parch      양피지 페이지 (단일 이미지, 늘려 쓴다)
  sb-tab-on/off 갈래 탭
  sb-row/on     스킬 목록 줄
  sb-iconframe  아이콘 금장 테두리
  sb-close      닫기 원형 버튼
  sb-btn/gold   버튼
  sb-bar-bg/fill 마스터리 바
  sb-scroll-*   스크롤바
  sb-arrow      현재→다음 화살표
  sb-chip       갈래 칩
  sb-sword      양피지 워터마크 검
  sb-compass    양피지 워터마크 나침반
  sb-icons      스킬 아이콘 아틀라스 (64px, skillTree.json 노드 순서)

Run: python3 scripts/generate-skillbook-ui.py
"""
import json
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'ui', 'skillbook')
os.makedirs(OUT, exist_ok=True)

SS = 4  # 슈퍼샘플링 배율

# ── 팔레트
GOLD = (201, 162, 71)
GOLD_HI = (240, 214, 150)
GOLD_DK = (120, 92, 34)
GOLD_DEEP = (74, 56, 20)
INK = (16, 18, 25)
PANEL = (22, 25, 34)
PANEL_HI = (33, 38, 51)
PANEL_LINE = (52, 60, 79)
PARCH = (233, 225, 205)
PARCH_DK = (196, 183, 154)
PARCH_EDGE = (150, 136, 106)
BLUE = (74, 144, 217)
BLUE_DK = (28, 58, 96)


def canvas(w, h):
    img = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img, 'RGBA')


def save(img, name, w, h):
    out = img.resize((w, h), Image.LANCZOS)
    out.save(os.path.join(OUT, name + '.png'))
    return out


def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle([box[0] * SS, box[1] * SS, box[2] * SS, box[3] * SS],
                        radius=r * SS, fill=fill, outline=outline, width=int(width * SS))


def blend(img, drawfn):
    """반투명 요소는 별도 레이어에 그린 뒤 합성한다.
    (RGBA 이미지에 직접 낮은 알파로 그리면 PIL 이 알파를 '덮어써서' 구멍이 뚫린다.)"""
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    drawfn(ImageDraw.Draw(layer, 'RGBA'))
    return Image.alpha_composite(img, layer)


def vgrad(size, top, bottom):
    w, h = size
    img = Image.new('RGBA', (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c + (255,)
    return img


# ---------------------------------------------------------------- frame
def make_frame():
    """나인슬라이스 192×192 (슬라이스 56). 금장 이중 테두리 + 어두운 속."""
    W = 192
    img, d = canvas(W, W)
    # 속판
    rr(d, (5, 5, W - 5, W - 5), 10, fill=(20, 23, 31, 252))
    # 바깥 금테
    rr(d, (2, 2, W - 2, W - 2), 12, outline=GOLD_DK + (255,), width=3)
    rr(d, (4, 4, W - 4, W - 4), 11, outline=GOLD + (255,), width=2)
    rr(d, (7, 7, W - 7, W - 7), 9, outline=GOLD_DEEP + (255,), width=1)
    # 안쪽 헤어라인
    rr(d, (13, 13, W - 13, W - 13), 6, outline=(88, 72, 36, 190), width=1)
    save(img, 'sb-frame', W, W)


def filigree(d, cx, cy, scale, color, flip=1):
    """모서리 덩굴 장식 — 곡선 + 점"""
    def arc(x0, y0, x1, y1, s, e, w):
        d.arc([x0 * SS, y0 * SS, x1 * SS, y1 * SS], s, e, fill=color, width=int(w * SS))
    s = scale
    arc(cx, cy, cx + 30 * s, cy + 30 * s, 180, 270, 2.2)
    arc(cx + 6 * s, cy + 6 * s, cx + 22 * s, cy + 22 * s, 180, 275, 1.4)
    arc(cx + 20 * s, cy - 4 * s, cx + 44 * s, cy + 16 * s, 150, 250, 1.6)
    arc(cx - 4 * s, cy + 20 * s, cx + 16 * s, cy + 44 * s, 240, 340, 1.6)
    d.ellipse([(cx + 30 * s) * SS, (cy + 2 * s) * SS, (cx + 36 * s) * SS, (cy + 8 * s) * SS], fill=color)
    d.ellipse([(cx + 2 * s) * SS, (cy + 30 * s) * SS, (cx + 8 * s) * SS, (cy + 36 * s) * SS], fill=color)


def make_corner():
    """좌상단 기준 장식 (48×48). 스킬창이 4곳에 회전해 붙인다."""
    S = 48
    img, d = canvas(S, S)
    filigree(d, 4, 4, 1.0, GOLD + (235,))
    filigree(d, 5, 5, 1.0, GOLD_HI + (110,))
    # 모서리 다이아
    d.polygon([(9 * SS, 2 * SS), (16 * SS, 9 * SS), (9 * SS, 16 * SS), (2 * SS, 9 * SS)], fill=GOLD + (255,))
    d.polygon([(9 * SS, 5 * SS), (13 * SS, 9 * SS), (9 * SS, 13 * SS), (5 * SS, 9 * SS)], fill=(255, 240, 200, 220))
    save(img, 'sb-corner', S, S)


def make_plaque():
    """제목 명판 — 나인슬라이스 160×72 (슬라이스 52/52/22/22)"""
    W, H = 160, 72
    img, d = canvas(W, H)
    rr(d, (10, 8, W - 10, H - 10), 8, fill=(24, 27, 37, 250))
    rr(d, (10, 8, W - 10, H - 10), 8, outline=GOLD + (255,), width=2)
    rr(d, (14, 12, W - 14, H - 14), 5, outline=(120, 96, 44, 200), width=1)
    # 좌우 끝동 (뾰족한 리본 귀)
    ear = [(2, 14), (26, 8), (26, H - 10), (2, H - 4), (9, H / 2)]
    for sx in (0, 1):
        pts = ear if sx == 0 else [(W - p[0], p[1]) for p in ear]
        d.polygon([(p[0] * SS, p[1] * SS) for p in pts], fill=(38, 31, 14, 255), outline=GOLD + (255,))
    # 상단 보석
    d.polygon([(W / 2 * SS, 1 * SS), ((W / 2 + 7) * SS, 8 * SS), (W / 2 * SS, 15 * SS), ((W / 2 - 7) * SS, 8 * SS)],
              fill=(150, 205, 235, 255), outline=GOLD + (255,))
    save(img, 'sb-plaque', W, H)


def make_panel(name, fill, line, glow=None):
    """나인슬라이스 64×64 (슬라이스 18)"""
    S = 64
    img, d = canvas(S, S)
    rr(d, (2, 2, S - 2, S - 2), 7, fill=fill)
    rr(d, (2, 2, S - 2, S - 2), 7, outline=line, width=1.4)
    # 위쪽 살짝 밝은 하이라이트 (반투명 → 별도 레이어)
    img = blend(img, lambda dd: dd.line(
        [(9 * SS, 3.5 * SS), ((S - 9) * SS, 3.5 * SS)], fill=(255, 255, 255, 26), width=int(1.2 * SS)))
    if glow:
        img = blend(img, lambda dd: rr(dd, (0.6, 0.6, S - 0.6, S - 0.6), 8, outline=glow, width=1.2))
    save(img, name, S, S)


def make_parch():
    """양피지 페이지 — 단일 이미지(늘려 쓴다). 얼룩 + 가장자리 그을림.
    RGB 로 그린 뒤 마지막에 RGBA 로 바꾼다 (반투명 얼룩이 알파를 갉아먹지 않게)."""
    W, H = 880, 740
    base = vgrad((W, H), (240, 233, 216), (219, 207, 181)).convert('RGB')
    d = ImageDraw.Draw(base, 'RGBA')
    rnd = random.Random(7)
    for _ in range(160):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r = rnd.randint(14, 90)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(168, 148, 110, rnd.randint(5, 14)))
    for _ in range(700):
        x, y = rnd.randrange(W), rnd.randrange(H)
        L = rnd.randint(8, 40)
        d.line([x, y, x + L, y + rnd.randint(-1, 1)], fill=(178, 162, 126, 18))
    base = base.filter(ImageFilter.GaussianBlur(0.6))
    d = ImageDraw.Draw(base, 'RGBA')
    # 가장자리 그을림
    for i in range(30):
        a = int(64 * (1 - i / 30) ** 1.5)
        d.rectangle([i, i, W - 1 - i, H - 1 - i], outline=(126, 106, 70, a))
    # 테두리 선
    d.rectangle([0, 0, W - 1, H - 1], outline=(120, 102, 68), width=2)
    d.rectangle([7, 7, W - 8, H - 8], outline=(166, 148, 110), width=1)
    base.convert('RGBA').save(os.path.join(OUT, 'sb-parch.png'))


def make_tab(name, on):
    """갈래 탭 — 나인슬라이스 64×48 (슬라이스 16/16/14/14)"""
    W, H = 64, 48
    img, d = canvas(W, H)
    if on:
        rr(d, (1, 1, W - 1, H - 2), 6, fill=(35, 74, 122, 255))
        rr(d, (1, 1, W - 1, H - 2), 6, outline=(150, 200, 240, 255), width=1.6)
        img = blend(img, lambda dd: dd.line(
            [(6 * SS, 3 * SS), ((W - 6) * SS, 3 * SS)], fill=(190, 224, 255, 150), width=int(1.4 * SS)))
    else:
        rr(d, (1, 2, W - 1, H - 2), 6, fill=(28, 31, 42, 240))
        rr(d, (1, 2, W - 1, H - 2), 6, outline=(84, 71, 40, 255), width=1.3)
    save(img, name, W, H)


def make_row(name, on):
    """목록 줄 — 나인슬라이스 64×64 (슬라이스 16)"""
    S = 64
    img, d = canvas(S, S)
    if on:
        rr(d, (1.5, 1.5, S - 1.5, S - 1.5), 6, fill=(30, 47, 71, 255))
        rr(d, (1.5, 1.5, S - 1.5, S - 1.5), 6, outline=(110, 178, 232, 255), width=1.8)
    else:
        rr(d, (1.5, 1.5, S - 1.5, S - 1.5), 6, fill=(27, 30, 39, 235))
        rr(d, (1.5, 1.5, S - 1.5, S - 1.5), 6, outline=(56, 62, 79, 255), width=1.2)
    save(img, name, S, S)


def make_iconframe():
    """아이콘 금장 테두리 — 나인슬라이스 32×32 (슬라이스 8)"""
    S = 32
    img, d = canvas(S, S)
    rr(d, (0.8, 0.8, S - 0.8, S - 0.8), 4, outline=(150, 120, 56, 255), width=2)
    rr(d, (2.2, 2.2, S - 2.2, S - 2.2), 3, outline=(216, 180, 96, 255), width=1.2)
    save(img, 'sb-iconframe', S, S)


def make_close():
    S = 64
    img, d = canvas(S, S)
    d.ellipse([2 * SS, 2 * SS, (S - 2) * SS, (S - 2) * SS], fill=(28, 30, 40, 250), outline=GOLD + (255,), width=int(2.4 * SS))
    d.ellipse([6 * SS, 6 * SS, (S - 6) * SS, (S - 6) * SS], outline=(120, 96, 44, 200), width=int(1 * SS))
    for a, b in (((21, 21), (43, 43)), ((43, 21), (21, 43))):
        d.line([a[0] * SS, a[1] * SS, b[0] * SS, b[1] * SS], fill=GOLD_HI + (255,), width=int(3.4 * SS))
    save(img, 'sb-close', S, S)


def make_button(name, base, line, top_hi):
    """버튼 — 나인슬라이스 64×48 (슬라이스 16/16/14/16)"""
    W, H = 64, 48
    img, d = canvas(W, H)
    rr(d, (1.5, 1.5, W - 1.5, H - 2.5), 6, fill=base)
    rr(d, (1.5, 1.5, W - 1.5, H - 2.5), 6, outline=line, width=1.6)
    img = blend(img, lambda dd: dd.line(
        [(7 * SS, 4 * SS), ((W - 7) * SS, 4 * SS)], fill=top_hi, width=int(1.6 * SS)))
    save(img, name, W, H)


def make_bar():
    # 트랙 (나인슬라이스 24×14, 슬라이스 6)
    W, H = 24, 14
    img, d = canvas(W, H)
    rr(d, (1, 1, W - 1, H - 1), 5, fill=(15, 17, 24, 255), outline=(60, 68, 88, 255), width=1.2)
    save(img, 'sb-bar-bg', W, H)
    # 채움 (나인슬라이스 24×14)
    img, d = canvas(W, H)
    rr(d, (0, 0, W, H), 5, fill=(255, 255, 255, 255))
    grad = vgrad((W * SS, H * SS), (150, 214, 255), (58, 130, 208))
    grad.putalpha(img.split()[3])
    save(grad, 'sb-bar-fill', W, H)


def make_scroll():
    img, d = canvas(12, 24)
    rr(d, (3, 1, 9, 23), 3, fill=(16, 18, 25, 220), outline=(58, 52, 34, 255), width=1)
    save(img, 'sb-scroll-track', 12, 24)
    img, d = canvas(12, 24)
    rr(d, (2, 1, 10, 23), 4, fill=(120, 98, 48, 255), outline=(206, 174, 96, 255), width=1.2)
    save(img, 'sb-scroll-thumb', 12, 24)


def make_arrow():
    S = 48
    img, d = canvas(S, S)
    pts = [(10, 14), (26, 14), (26, 7), (40, 24), (26, 41), (26, 34), (10, 34)]
    d.polygon([(p[0] * SS, p[1] * SS) for p in pts], fill=(94, 84, 58, 255), outline=(176, 150, 88, 255))
    save(img, 'sb-arrow', S, S)


def make_chip():
    S = 32
    img, d = canvas(S, S)
    rr(d, (1, 1, S - 1, S - 1), 5, fill=(255, 255, 255, 255), outline=(255, 255, 255, 255), width=1.2)
    save(img, 'sb-chip', S, S)


def make_sword():
    """양피지 워터마크용 장식 검 (세로)"""
    W, H = 260, 620
    img, d = canvas(W, H)
    c = (96, 78, 48, 255)
    cx = W / 2
    # 날
    d.polygon([(cx * SS, 8 * SS), ((cx + 26) * SS, 90 * SS), ((cx + 26) * SS, 400 * SS),
               (cx * SS, 452 * SS), ((cx - 26) * SS, 400 * SS), ((cx - 26) * SS, 90 * SS)], fill=c)
    d.line([(cx * SS, 30 * SS), (cx * SS, 430 * SS)], fill=(150, 128, 86, 255), width=int(3 * SS))
    # 가드
    d.rounded_rectangle([(cx - 90) * SS, 452 * SS, (cx + 90) * SS, 484 * SS], radius=14 * SS, fill=c)
    d.polygon([((cx - 90) * SS, 468 * SS), ((cx - 120) * SS, 440 * SS), ((cx - 104) * SS, 484 * SS)], fill=c)
    d.polygon([((cx + 90) * SS, 468 * SS), ((cx + 120) * SS, 440 * SS), ((cx + 104) * SS, 484 * SS)], fill=c)
    # 손잡이
    d.rounded_rectangle([(cx - 16) * SS, 484 * SS, (cx + 16) * SS, 578 * SS], radius=8 * SS, fill=c)
    d.ellipse([(cx - 26) * SS, 570 * SS, (cx + 26) * SS, 616 * SS], fill=c)
    # 날개 장식
    for s in (-1, 1):
        d.arc([(cx + s * 150 - 70) * SS, 120 * SS, (cx + s * 150 + 70) * SS, 400 * SS],
              300 if s > 0 else 60, 60 if s > 0 else 180, fill=(120, 100, 62, 200), width=int(3 * SS))
    save(img, 'sb-sword', W, H)


def make_compass():
    S = 200
    img, d = canvas(S, S)
    c = (120, 100, 62, 255)
    cx = cy = S / 2
    d.ellipse([(cx - 78) * SS, (cy - 78) * SS, (cx + 78) * SS, (cy + 78) * SS], outline=c, width=int(2 * SS))
    d.ellipse([(cx - 60) * SS, (cy - 60) * SS, (cx + 60) * SS, (cy + 60) * SS], outline=c, width=int(1.2 * SS))
    for i in range(8):
        a = math.radians(i * 45)
        L = 74 if i % 2 == 0 else 52
        w = 12 if i % 2 == 0 else 7
        p0 = (cx + math.cos(a) * L, cy + math.sin(a) * L)
        p1 = (cx + math.cos(a + math.pi / 2) * w, cy + math.sin(a + math.pi / 2) * w)
        p2 = (cx + math.cos(a - math.pi / 2) * w, cy + math.sin(a - math.pi / 2) * w)
        d.polygon([(p[0] * SS, p[1] * SS) for p in (p0, p1, p2)], fill=c if i % 2 == 0 else (120, 100, 62, 150))
    save(img, 'sb-compass', S, S)


# ---------------------------------------------------------------- 아이콘
def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def saturate(c, f=1.5):
    """연한 갈래색(서리·기동 등)이 아이콘에서 회색으로 죽지 않게 채도를 올린다."""
    import colorsys
    h, l, sat = colorsys.rgb_to_hls(*[v / 255 for v in c])
    r, g, b = colorsys.hls_to_rgb(h, min(0.62, max(0.42, l)), min(1.0, sat * f))
    return (int(r * 255), int(g * 255), int(b * 255))


def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def saturate(c, f=1.5):
    """연한 갈래색(서리·기동 등)이 아이콘에서 회색으로 죽지 않게 채도를 올린다."""
    import colorsys
    h, l, sat = colorsys.rgb_to_hls(*[v / 255 for v in c])
    r, g, b = colorsys.hls_to_rgb(h, min(0.62, max(0.42, l)), min(1.0, sat * f))
    return (int(r * 255), int(g * 255), int(b * 255))


# 노드별 모티프 — 같은 갈래 안에서 겹치지 않게 손으로 배정했다.
MOTIF_BY_ID = {
    'hunt-1': 'dive', 'hunt-2': 'shockwave', 'hunt-3': 'crosshair', 'hunt-4': 'pounce',
    'hunt-5': 'star', 'hunt-6': 'clock', 'hunt-7': 'flare',
    'guard-1': 'ring', 'guard-2': 'wave', 'guard-3': 'aegis', 'guard-4': 'shield',
    'guard-5': 'counter', 'guard-6': 'heart', 'guard-7': 'phoenix',
    'swift-1': 'boot', 'swift-2': 'ghost', 'swift-3': 'chevrons', 'swift-4': 'blink',
    'swift-5': 'dagger', 'swift-6': 'clock', 'swift-7': 'wind',
    'res-1': 'gauge', 'res-2': 'burst', 'res-3': 'wave', 'res-4': 'ring',
    'res-5': 'hourglass', 'res-6': 'prism',
    'blade-1': 'wave', 'blade-2': 'tornado', 'blade-3': 'blade', 'blade-4': 'hits',
    'blade-5': 'splash', 'blade-6': 'twinblade',
    'ember-1': 'flame', 'ember-2': 'firefield', 'ember-3': 'heart', 'ember-4': 'regen',
    'ember-5': 'droplet', 'ember-6': 'phoenix',
    'tac-1': 'hourglass', 'tac-2': 'bomb', 'tac-3': 'torch', 'tac-4': 'book',
    'tac-5': 'clock', 'tac-6': 'flare',
    'for-1': 'coin', 'for-2': 'clover', 'for-3': 'chest', 'for-4': 'coins',
    'for-5': 'tag', 'for-6': 'burst',
    'storm-1': 'bolt', 'storm-2': 'chain', 'storm-3': 'crosshair', 'storm-4': 'stormcloud',
    'storm-5': 'bolt3', 'storm-6': 'flare',
    'shadow-1': 'clone', 'shadow-2': 'star', 'shadow-3': 'eye', 'shadow-4': 'skull',
    'shadow-5': 'ghost', 'shadow-6': 'dagger',
    'frost-1': 'snow', 'frost-2': 'frostaura', 'frost-3': 'icecage', 'frost-4': 'crosshair',
    'frost-5': 'ring', 'frost-6': 'crack',
    'rage-1': 'rage', 'rage-2': 'droplet', 'rage-3': 'chevrons', 'rage-4': 'blade',
    'rage-5': 'clock', 'rage-6': 'armor',
}


def motif_for(node):
    return MOTIF_BY_ID.get(node['id'], 'star')


def draw_motif(d, motif, S, main, hi):
    """64 기준 좌표계로 그린다 (S 로 환산). main/hi 는 RGBA."""
    K = S / 64 * SS
    WHITE = (255, 255, 255, 255)
    DARK = (12, 13, 18, 255)

    def P(pts):
        return [(p[0] * K, p[1] * K) for p in pts]

    def line(pts, w, col):
        d.line(P(pts), fill=col, width=max(1, int(w * K)), joint='curve')

    def poly(pts, col, outline=None, w=1.6):
        d.polygon(P(pts), fill=col)
        if outline:
            d.line(P(list(pts) + [pts[0]]), fill=outline, width=max(1, int(w * K)), joint='curve')

    def circ(cx, cy, r, col, w=0):
        box = [(cx - r) * K, (cy - r) * K, (cx + r) * K, (cy + r) * K]
        if w:
            d.ellipse(box, outline=col, width=max(1, int(w * K)))
        else:
            d.ellipse(box, fill=col)

    def arc(cx, cy, r, a0, a1, w, col):
        d.arc([(cx - r) * K, (cy - r) * K, (cx + r) * K, (cy + r) * K], a0, a1,
              fill=col, width=max(1, int(w * K)))

    def ray(cx, cy, deg, r0, r1, w, col):
        a = math.radians(deg)
        line([(cx + math.cos(a) * r0, cy + math.sin(a) * r0),
              (cx + math.cos(a) * r1, cy + math.sin(a) * r1)], w, col)

    def sword(cx, cy, L=1.0, col=None, out=None):
        col = col or main
        out = out or hi
        poly([(cx, cy - 26 * L), (cx + 7 * L, cy - 12 * L), (cx + 7 * L, cy + 10 * L),
              (cx, cy + 17 * L), (cx - 7 * L, cy + 10 * L), (cx - 7 * L, cy - 12 * L)], col, out)
        line([(cx, cy - 20 * L), (cx, cy + 12 * L)], 1.6 * L, out)
        poly([(cx - 15 * L, cy + 17 * L), (cx + 15 * L, cy + 17 * L),
              (cx + 15 * L, cy + 22 * L), (cx - 15 * L, cy + 22 * L)], col, out)
        poly([(cx - 4 * L, cy + 22 * L), (cx + 4 * L, cy + 22 * L),
              (cx + 4 * L, cy + 30 * L), (cx - 4 * L, cy + 30 * L)], col, out)

    if motif == 'dive':
        poly([(32, 5), (43, 30), (32, 44), (21, 30)], main, hi)
        line([(32, 12), (32, 38)], 2.0, hi)
        line([(13, 55), (51, 55)], 2.6, hi)
        for s in (-1, 1):
            line([(32 + s * 11, 46), (32 + s * 20, 58)], 2.4, main)
    elif motif == 'shockwave':
        for r, w in ((10, 3.0), (19, 2.4), (28, 1.8)):
            arc(32, 40, r, 190, 350, w, main if r > 10 else hi)
        poly([(32, 4), (40, 24), (32, 34), (24, 24)], main, hi)
    elif motif == 'crosshair':
        circ(32, 32, 20, main, 3.4)
        circ(32, 32, 6, hi)
        for deg in (0, 90, 180, 270):
            ray(32, 32, deg, 14, 30, 2.8, hi)
    elif motif == 'pounce':
        for off in (-13, 0, 13):
            line([(19 + off, 12 + abs(off) * 0.35), (30 + off, 33), (27 + off, 52)], 4.0, main)
            line([(20 + off, 15 + abs(off) * 0.35), (29 + off, 32)], 1.6, hi)
    elif motif == 'star':
        pts = []
        for i in range(10):
            a = math.radians(-90 + i * 36)
            r = 25 if i % 2 == 0 else 10.5
            pts.append((32 + math.cos(a) * r, 32 + math.sin(a) * r))
        poly(pts, main, hi)
        circ(32, 32, 5, hi)
    elif motif == 'clock':
        circ(32, 32, 22, main, 4.0)
        line([(32, 32), (32, 17)], 3.0, hi)
        line([(32, 32), (43, 37)], 2.6, hi)
        circ(32, 32, 3.4, hi)
        arc(32, 32, 27, 200, 340, 2.2, hi)
    elif motif == 'flare':
        for i in range(12):
            ray(32, 32, i * 30, 12, 29 if i % 2 == 0 else 22, 2.6, main)
        circ(32, 32, 13, hi)
        circ(32, 32, 7, WHITE)
    elif motif == 'ring':
        circ(32, 32, 21, main, 5.0)
        arc(32, 32, 27, 30, 200, 2.4, hi)
        for i in range(3):
            a = math.radians(90 + i * 120)
            circ(32 + math.cos(a) * 21, 32 + math.sin(a) * 21, 4.5, hi)
    elif motif == 'wave':
        for i, off in enumerate((-9, 0, 9)):
            line([(10 + off, 46 - i * 2), (30, 16 + i * 3), (52 + off, 46 - i * 2)],
                 3.4 - i * 0.6, main if i else hi)
    elif motif == 'aegis':
        pts = [(32 + math.cos(math.radians(-90 + i * 60)) * 24,
                32 + math.sin(math.radians(-90 + i * 60)) * 24) for i in range(6)]
        poly(pts, main, hi, 2.2)
        pts2 = [(32 + math.cos(math.radians(-90 + i * 60)) * 14,
                 32 + math.sin(math.radians(-90 + i * 60)) * 14) for i in range(6)]
        d.line(P(pts2 + [pts2[0]]), fill=hi, width=max(1, int(2.0 * K)))
    elif motif == 'shield':
        poly([(32, 6), (52, 15), (49, 37), (32, 57), (15, 37), (12, 15)], main, hi)
        line([(32, 14), (32, 48)], 2.6, hi)
        line([(19, 25), (45, 25)], 2.2, hi)
    elif motif == 'counter':
        arc(32, 32, 21, 40, 300, 4.0, main)
        poly([(46, 8), (52, 24), (36, 20)], hi)
        for deg in (200, 250, 300):
            ray(32, 32, deg, 8, 18, 2.4, hi)
    elif motif == 'heart':
        poly([(32, 55), (11, 32), (11, 21), (21, 12), (32, 21), (43, 12), (53, 21), (53, 32)], main, hi)
        line([(21, 25), (26, 19)], 3.2, WHITE)
    elif motif == 'phoenix':
        poly([(32, 8), (44, 26), (40, 36), (48, 32), (44, 48), (32, 58), (20, 48), (16, 32), (24, 36), (20, 26)], main, hi)
        poly([(32, 26), (38, 39), (32, 50), (26, 39)], hi)
        for s in (-1, 1):
            arc(32 + s * 22, 26, 16, 200 if s > 0 else 320, 340 if s > 0 else 100, 2.2, main)
    elif motif == 'boot':
        poly([(19, 8), (33, 8), (33, 30), (48, 38), (52, 50), (16, 50), (16, 22)], main, hi)
        line([(20, 44), (46, 44)], 2.2, hi)
        for i in range(3):
            line([(8, 16 + i * 8), (15, 16 + i * 8)], 2.2, hi)
    elif motif == 'ghost':
        for i, a in enumerate((70, 120, 190)):
            poly([(14 + i * 12, 12), (24 + i * 12, 12), (20 + i * 12, 52), (10 + i * 12, 52)],
                 (main[0], main[1], main[2], a))
        line([(46, 14), (54, 20)], 2.4, hi)
    elif motif == 'chevrons':
        for i in range(3):
            line([(16, 14 + i * 14), (34, 22 + i * 14), (16, 30 + i * 14)], 3.6, main if i else hi)
            line([(32, 14 + i * 14), (50, 22 + i * 14), (32, 30 + i * 14)], 3.6, hi if i else main)
    elif motif == 'blink':
        circ(18, 40, 9, main, 3.0)
        circ(46, 22, 11, hi, 3.4)
        for i in range(4):
            t = i / 3
            circ(18 + (46 - 18) * t, 40 + (22 - 40) * t, 2.6, hi)
        for deg in (0, 60, 120, 180, 240, 300):
            ray(46, 22, deg, 13, 19, 1.8, hi)
    elif motif == 'dagger':
        poly([(32, 6), (39, 22), (39, 34), (32, 42), (25, 34), (25, 22)], main, hi)
        poly([(20, 42), (44, 42), (44, 47), (20, 47)], main, hi)
        poly([(29, 47), (35, 47), (35, 58), (29, 58)], main, hi)
        line([(32, 12), (32, 38)], 1.6, hi)
    elif motif == 'wind':
        for i, y in enumerate((18, 30, 42)):
            L = (36, 42, 30)[i]
            line([(8, y), (8 + L, y)], 3.2, main if i != 1 else hi)
            arc(8 + L, y + 6, 7, 250, 90, 2.6, hi)
    elif motif == 'gauge':
        arc(32, 34, 23, 160, 380, 5.0, (main[0], main[1], main[2], 120))
        arc(32, 34, 23, 160, 300, 5.0, hi)
        line([(32, 34), (18, 20)], 3.0, main)
        circ(32, 34, 4, hi)
    elif motif == 'burst':
        for i in range(8):
            ray(32, 32, i * 45, 11, 28, 3.4, main)
        circ(32, 32, 11, hi)
        circ(32, 32, 5, WHITE)
    elif motif == 'hourglass':
        poly([(16, 8), (48, 8), (48, 14), (36, 32), (48, 50), (48, 56), (16, 56), (16, 50), (28, 32), (16, 14)], main, hi)
        poly([(22, 14), (42, 14), (32, 29)], hi)
        circ(32, 44, 3, hi)
    elif motif == 'prism':
        poly([(32, 4), (52, 32), (32, 60), (12, 32)], main, hi)
        poly([(32, 16), (43, 32), (32, 48), (21, 32)], hi)
        circ(32, 32, 5, WHITE)
    elif motif == 'tornado':
        for i, (y, w) in enumerate(((14, 30), (24, 24), (34, 17), (44, 10), (53, 5))):
            line([(32 - w, y), (32 + w, y)], 3.4 - i * 0.4, main if i % 2 else hi)
        arc(32, 32, 26, 300, 60, 2.2, hi)
    elif motif == 'blade':
        sword(32, 30, 1.0)
    elif motif == 'twinblade':
        sword(21, 30, 0.82)
        sword(43, 30, 0.82)
    elif motif == 'hits':
        for i, off in enumerate((-14, 0, 14)):
            line([(14 + off, 52), (34 + off, 12)], 4.2 - i * 0.4, main if i != 1 else hi)
    elif motif == 'splash':
        circ(20, 34, 10, main, 3.2)
        circ(42, 26, 8, hi, 2.8)
        circ(46, 44, 6, main, 2.4)
        line([(27, 32), (36, 28)], 2.2, hi)
        line([(28, 40), (42, 42)], 2.2, hi)
    elif motif == 'flame':
        poly([(32, 4), (44, 22), (42, 34), (50, 30), (46, 48), (32, 60), (18, 48), (14, 30), (22, 34), (20, 22)], main, hi)
        poly([(32, 26), (39, 40), (32, 52), (25, 40)], hi)
    elif motif == 'firefield':
        poly([(8, 46), (56, 46), (52, 56), (12, 56)], main, hi)
        for cx, s in ((20, 0.6), (32, 0.85), (44, 0.6)):
            poly([(cx, 46 - 26 * s), (cx + 8 * s, 46 - 12 * s), (cx + 6 * s, 46),
                  (cx - 6 * s, 46), (cx - 8 * s, 46 - 12 * s)], hi if s > 0.7 else main)
    elif motif == 'regen':
        arc(32, 32, 20, 40, 330, 4.4, main)
        poly([(44, 6), (52, 22), (34, 20)], hi)
        line([(32, 22), (32, 42)], 3.4, hi)
        line([(22, 32), (42, 32)], 3.4, hi)
    elif motif == 'droplet':
        poly([(32, 5), (46, 28), (46, 40), (32, 56), (18, 40), (18, 28)], main, hi)
        circ(26, 34, 4.6, WHITE)
    elif motif == 'bomb':
        circ(30, 38, 19, main)
        circ(30, 38, 19, hi, 2.4)
        poly([(25, 18), (35, 18), (35, 24), (25, 24)], main, hi)
        arc(35, 8, 12, 60, 190, 2.6, hi)
        circ(24, 32, 4.5, WHITE)
    elif motif == 'torch':
        poly([(28, 30), (36, 30), (34, 58), (30, 58)], main, hi)
        poly([(32, 4), (42, 20), (39, 30), (25, 30), (22, 20)], main, hi)
        poly([(32, 14), (37, 26), (27, 26)], WHITE)
        line([(24, 30), (40, 30)], 3.0, hi)
    elif motif == 'book':
        poly([(10, 12), (30, 18), (30, 54), (10, 48)], main, hi)
        poly([(34, 18), (54, 12), (54, 48), (34, 54)], main, hi)
        line([(32, 17), (32, 55)], 2.6, hi)
        for i in range(3):
            line([(14, 24 + i * 8), (27, 27 + i * 8)], 1.8, hi)
    elif motif == 'coin':
        circ(32, 32, 22, main)
        circ(32, 32, 22, hi, 2.8)
        circ(32, 32, 14, hi, 2.0)
        line([(32, 20), (32, 44)], 3.2, hi)
        line([(26, 26), (38, 26)], 2.6, hi)
    elif motif == 'coins':
        for cx, cy, r in ((20, 42, 13), (44, 42, 13), (32, 22, 15)):
            circ(cx, cy, r, main)
            circ(cx, cy, r, hi, 2.2)
            line([(cx, cy - r * 0.5), (cx, cy + r * 0.5)], 2.4, hi)
    elif motif == 'clover':
        for deg in (225, 315, 45, 135):
            a = math.radians(deg)
            circ(32 + math.cos(a) * 12, 28 + math.sin(a) * 12, 11, main)
        circ(32, 28, 5, hi)
        line([(32, 34), (36, 58)], 3.0, hi)
    elif motif == 'chest':
        poly([(10, 28), (54, 28), (54, 54), (10, 54)], main, hi)
        arc(32, 28, 22, 180, 360, 4.0, main)
        line([(10, 36), (54, 36)], 3.0, hi)
        poly([(28, 32), (36, 32), (36, 44), (28, 44)], hi)
        circ(32, 38, 2.6, DARK)
    elif motif == 'tag':
        poly([(8, 32), (32, 8), (56, 32), (32, 56)], main, hi)
        circ(32, 20, 5, DARK)
        line([(22, 42), (42, 22)], 3.0, hi)
    elif motif == 'bolt':
        poly([(38, 4), (17, 34), (30, 34), (24, 60), (47, 26), (33, 26)], main, hi)
    elif motif == 'bolt3':
        for cx, s in ((14, 0.6), (32, 0.9), (50, 0.6)):
            poly([(cx + 4 * s, 32 - 28 * s), (cx - 8 * s, 32 + 2 * s), (cx + 1 * s, 32 + 2 * s),
                  (cx - 3 * s, 32 + 26 * s), (cx + 11 * s, 32 - 6 * s), (cx + 2 * s, 32 - 6 * s)],
                 hi if s > 0.7 else main)
    elif motif == 'stormcloud':
        circ(22, 24, 12, main)
        circ(38, 22, 14, main)
        poly([(10, 24), (54, 24), (54, 34), (10, 34)], main)
        poly([(34, 34), (22, 52), (30, 52), (26, 60), (42, 42), (32, 42)], hi)
    elif motif == 'chain':
        for i, (cx, cy) in enumerate(((18, 46), (32, 32), (46, 18))):
            d.ellipse([(cx - 11) * K, (cy - 8) * K, (cx + 11) * K, (cy + 8) * K],
                      outline=hi if i == 1 else main, width=max(1, int(3.2 * K)))
        line([(8, 12), (18, 22)], 2.4, hi)
    elif motif == 'clone':
        for i, (dx, a) in enumerate(((-11, 110), (0, 190), (11, 255))):
            col = (main[0], main[1], main[2], a)
            poly([(28 + dx, 10), (38 + dx, 24), (34 + dx, 52), (22 + dx, 52), (18 + dx, 24)], col)
        circ(43, 22, 3.4, hi)
    elif motif == 'eye':
        poly([(5, 32), (32, 12), (59, 32), (32, 52)], main, hi)
        circ(32, 32, 11, hi)
        circ(32, 32, 5, DARK)
    elif motif == 'skull':
        circ(32, 26, 19, main)
        poly([(21, 39), (43, 39), (41, 55), (36, 49), (32, 57), (28, 49), (23, 55)], main)
        circ(25, 26, 6, DARK)
        circ(39, 26, 6, DARK)
        poly([(29, 35), (35, 35), (32, 43)], DARK)
    elif motif == 'snow':
        for i in range(6):
            a = math.radians(i * 60)
            x, y = math.cos(a) * 25, math.sin(a) * 25
            line([(32, 32), (32 + x, 32 + y)], 3.0, main)
            bx, by = 32 + x * 0.62, 32 + y * 0.62
            for s in (-1, 1):
                a2 = a + s * math.radians(45)
                line([(bx, by), (bx + math.cos(a2) * 9, by + math.sin(a2) * 9)], 2.2, hi)
        circ(32, 32, 5, hi)
    elif motif == 'frostaura':
        circ(32, 32, 26, (main[0], main[1], main[2], 110), 3.0)
        circ(32, 32, 18, main, 2.6)
        for i in range(6):
            a = math.radians(i * 60 + 15)
            poly([(32 + math.cos(a) * 9, 32 + math.sin(a) * 9),
                  (32 + math.cos(a + 0.4) * 17, 32 + math.sin(a + 0.4) * 17),
                  (32 + math.cos(a - 0.4) * 17, 32 + math.sin(a - 0.4) * 17)], hi)
    elif motif == 'icecage':
        for x in (16, 26, 38, 48):
            line([(x, 10), (x, 54)], 3.0, main)
        line([(12, 18), (52, 18)], 2.6, hi)
        line([(12, 46), (52, 46)], 2.6, hi)
        poly([(32, 22), (40, 32), (32, 42), (24, 32)], hi)
    elif motif == 'crack':
        poly([(32, 4), (44, 26), (32, 60), (20, 26)], (main[0], main[1], main[2], 150))
        line([(32, 6), (26, 26), (36, 32), (28, 58)], 3.4, hi)
        line([(26, 26), (14, 20)], 2.4, hi)
        line([(36, 32), (50, 28)], 2.4, hi)
        line([(36, 32), (48, 46)], 2.2, main)
    elif motif == 'rage':
        for s in (-1, 1):
            poly([(32 + s * 8, 30), (32 + s * 26, 6), (32 + s * 30, 26), (32 + s * 16, 34)], main, hi)
        poly([(32, 24), (44, 40), (38, 58), (26, 58), (20, 40)], main, hi)
        line([(26, 42), (30, 46)], 2.6, hi)
        line([(38, 42), (34, 46)], 2.6, hi)
    elif motif == 'armor':
        poly([(32, 6), (52, 16), (49, 38), (32, 57), (15, 38), (12, 16)], main, hi)
        for i in range(3):
            line([(19, 22 + i * 9), (45, 22 + i * 9)], 2.6, hi)
        circ(32, 20, 4.5, WHITE)
    else:
        circ(32, 32, 20, main, 5)


def make_icons():
    tree = json.load(open(os.path.join(ROOT, 'src', 'data', 'skillTree.json'), encoding='utf-8'))
    colors = {b['id']: hexc(b['color']) for b in tree['branches']}
    nodes = tree['nodes']
    COLS, CELL = 10, 64
    rows = (len(nodes) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, node in enumerate(nodes):
        base = saturate(colors.get(node['branch'], (200, 200, 200)))
        img = Image.new('RGBA', (CELL * SS, CELL * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(img, 'RGBA')
        # 배경: 갈래색 딥 그라디언트 + 라운드
        bg = vgrad((CELL * SS, CELL * SS), mix(base, (0, 0, 0), 0.62), mix(base, (0, 0, 0), 0.88))
        mask = Image.new('L', (CELL * SS, CELL * SS), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, CELL * SS - 1, CELL * SS - 1], radius=5 * SS, fill=255)
        img.paste(bg, (0, 0), mask)
        # 상단 은은한 광 (반투명 → 별도 레이어 합성)
        img = blend(img, lambda dd: dd.ellipse(
            [-10 * SS, -30 * SS, 74 * SS, 26 * SS], fill=mix(base, (255, 255, 255), 0.20) + (54,)))
        main = mix(base, (255, 255, 255), 0.34)
        hi = mix(base, (255, 255, 255), 0.78)
        motif = Image.new('RGBA', (CELL * SS, CELL * SS), (0, 0, 0, 0))
        draw_motif(ImageDraw.Draw(motif, 'RGBA'), motif_for(node), CELL, main + (255,), hi + (255,))
        glow = motif.filter(ImageFilter.GaussianBlur(2.0 * SS))
        img = Image.alpha_composite(img, glow)
        img = Image.alpha_composite(img, motif)
        # 안쪽 테두리
        img = blend(img, lambda dd: dd.rounded_rectangle(
            [1 * SS, 1 * SS, (CELL - 1) * SS, (CELL - 1) * SS], radius=5 * SS,
            outline=mix(base, (255, 255, 255), 0.45) + (120,), width=int(1.2 * SS)))
        cell = img.resize((CELL, CELL), Image.LANCZOS)
        sheet.paste(cell, ((i % COLS) * CELL, (i // COLS) * CELL))
    sheet.save(os.path.join(OUT, 'sb-icons.png'))
    print('icons:', len(nodes), 'sheet', sheet.size)


def main():
    make_frame()
    make_corner()
    make_plaque()
    make_panel('sb-panel', (19, 22, 30, 245), (48, 55, 72, 255))
    make_panel('sb-panel-lit', (24, 29, 40, 250), (86, 106, 140, 255))
    make_parch()
    make_tab('sb-tab-on', True)
    make_tab('sb-tab-off', False)
    make_row('sb-row', False)
    make_row('sb-row-on', True)
    make_iconframe()
    make_close()
    make_button('sb-btn', (38, 42, 55, 250), (96, 106, 130, 255), (255, 255, 255, 26))
    make_button('sb-btn-gold', (60, 49, 22, 252), (196, 162, 84, 255), (255, 226, 160, 46))
    make_bar()
    make_scroll()
    make_arrow()
    make_chip()
    make_sword()
    make_compass()
    make_icons()
    print('wrote ->', OUT)


if __name__ == '__main__':
    main()
