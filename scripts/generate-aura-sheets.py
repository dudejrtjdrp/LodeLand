# -*- coding: utf-8 -*-
"""원소 세트 오라 시트 파이프라인.

사용자 제공 마법진 4장(fire/electric/void/poison)과 같은 문법으로 나머지 4원소
(ice/gold/blood/wind) 시트를 절차 생성하고, 8장 전부를 게임용 그리드 아틀라스로
재패킹한다.

원본 문법 (분석 결과):
  - 프레임 512×512 (fire 만 816), 논리 픽셀 8px → 논리 해상도 64×64
  - 알파는 0/255 이진, 팔레트는 채도 높은 주색 1 + 밝은 강조색 1(~2)
  - 애니메이션은 은은한 idle — 프레임 간 픽셀 변화 1~4% (점선 링 회전,
    반짝임 명멸, 중앙 룬 맥동)

산출물:
  - public/assets/auras/<element>.png  … 그리드 아틀라스 (프레임 256, fire 272)
  - src/logic/auraSheets.ts            … 프레임 규격 매니페스트 (자동 생성)
  - scripts/aura-src/generated/*.png   … 생성 4장의 원본 규격(512, 1행) 시트

실행: python3 scripts/generate-aura-sheets.py
"""

import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'aura-src')
OUT = os.path.join(ROOT, 'public', 'assets', 'auras')
GEN = os.path.join(SRC, 'generated')

L = 64          # 논리 해상도
FRAMES = 40     # 생성 시트 프레임 수
CX = 31.5       # 중심 (짝수 그리드 대칭)

# 팔레트: 0=투명, 1=주색, 2=강조, 3=심색
PALETTES = {
    'ice':   {1: (0x7f, 0xd4, 0xec), 2: (0xff, 0xff, 0xff), 3: (0x3d, 0x8f, 0xb8)},
    'gold':  {1: (0xe8, 0xa0, 0x2e), 2: (0xff, 0xe9, 0x8a), 3: (0xa0, 0x5a, 0x14)},
    'blood': {1: (0xd1, 0x30, 0x48), 2: (0xff, 0x9e, 0x8f), 3: (0x70, 0x13, 0x26)},
    'wind':  {1: (0x4f, 0xd8, 0xb0), 2: (0xe8, 0xff, 0xf4), 3: (0x1e, 0x8f, 0x70)},
}

# 원본 시트 → 원소 매핑 (색·모티프 근거)
ORIGINALS = {
    'fire': ('fire_fear-Sheet.png', 816),
    'electric': ('blue_doom_idle-Sheet.png', 512),
    'void': ('espantalho_antigo-Sheet.png', 512),
    'poison': ('tree_of_glory_idle-Sheet.png', 512),
}


# ───────────────────────── 저수준 드로잉 ─────────────────────────

def blank():
    return np.zeros((L, L), dtype=np.uint8)


def px(g, x, y, c):
    xi, yi = int(round(x)), int(round(y))
    if 0 <= xi < L and 0 <= yi < L:
        g[yi, xi] = c


def ring(g, r, c, a0=0.0, a1=math.tau, dash=None, phase=0.0):
    """점 밀도 샘플링 링. dash=(길이°, 간격°), phase=회전 오프셋(°)."""
    steps = max(60, int(r * 14))
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        if dash is not None:
            dlen, dgap = dash
            deg = (math.degrees(a) - phase) % (dlen + dgap)
            if deg >= dlen:
                continue
        px(g, CX + math.cos(a) * r, CX + math.sin(a) * r, c)


def line(g, x0, y0, x1, y1, c):
    n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(n + 1):
        t = i / n
        px(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)


def stamp(g, x, y, art, cmap):
    """다중행 문자열 스탬프. x,y = 좌상단. cmap: 문자→색."""
    for dy, row in enumerate(art):
        for dx, ch in enumerate(row):
            if ch in cmap:
                px(g, x + dx, y + dy, cmap[ch])


def rot(pt, deg):
    a = math.radians(deg)
    x, y = pt
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))


def plus(g, x, y, c, big=False):
    px(g, x, y, c)
    for d in (1, 2) if big else (1,):
        px(g, x + d, y, c)
        px(g, x - d, y, c)
        px(g, x, y + d, c)
        px(g, x, y - d, c)


# ───────────────────────── 원소별 프레임 ─────────────────────────

def frame_ice(f):
    """서리 결정진 — 육각 결정 구조와 눈송이 룬. 결정들이 차례로 반짝인다."""
    g = blank()
    t = f / FRAMES
    # 외곽 이중 링 + 회전 점선
    ring(g, 31, 1)
    ring(g, 28, 3, dash=(14, 16), phase=t * 30)          # 한 주기 = 루프
    ring(g, 26, 1, dash=(4, 11), phase=-t * 15)
    # 육각 결정 프레임 (뾰족 위)
    verts = [(CX + 22 * math.cos(math.radians(90 + k * 60)),
              CX + 22 * math.sin(math.radians(90 + k * 60))) for k in range(6)]
    for k in range(6):
        x0, y0 = verts[k]
        x1, y1 = verts[(k + 1) % 6]
        line(g, x0, y0, x1, y1, 1)
    # 꼭짓점 결정: 순서대로 하나씩 밝게 (나머지는 주색)
    lit = int(t * 6) % 6
    for k, (vx, vy) in enumerate(verts):
        c = 2 if k == lit else 1
        px(g, vx, vy, c)
        px(g, vx + 1, vy, c)
        px(g, vx - 1, vy, c)
        px(g, vx, vy + 1, c)
        px(g, vx, vy - 1, c)
        if k == lit:
            px(g, vx, vy - 2, 2)
            px(g, vx, vy + 2, 2)
    # 내부 링
    ring(g, 15, 3)
    # 중앙 눈송이: 6팔 + 가지
    shimmer = (f // 10) % 2 == 0
    for k in range(6):
        a = math.radians(90 + k * 60)
        ex, ey = math.cos(a), math.sin(a)
        line(g, CX + ex * 3, CX + ey * 3, CX + ex * 11, CX + ey * 11, 1)
        # 가지 (2/3 지점에서 ±60°)
        bx, by = CX + ex * 8, CX + ey * 8
        for s in (-1, 1):
            ba = a + s * math.radians(55)
            line(g, bx, by, bx + math.cos(ba) * 3, by + math.sin(ba) * 3, 1)
        tipc = 2 if shimmer else 1
        px(g, CX + ex * 11, CX + ey * 11, tipc)
    # 코어 다이아
    core = 2 if shimmer else 1
    stamp(g, 30, 30, ['.##.', '####', '####', '.##.'], {'#': core})
    # 잔반짝임: 링과 육각 사이
    for i in range(6):
        a = math.radians(30 + i * 60 + 8)
        if ((f // 8) + i) % 3 == 0:
            plus(g, int(CX + math.cos(a) * 24.5), int(CX + math.sin(a) * 24.5), 2)
    return g


def frame_gold(f):
    """황금 문장진 — 주화의 고리와 중앙 대금화. 광택이 주화를 타고 돈다."""
    g = blank()
    t = f / FRAMES
    # 시계판 이중 링 + 눈금 12
    ring(g, 31, 1)
    ring(g, 29, 1)
    for k in range(12):
        a = math.radians(k * 30)
        line(g, CX + math.cos(a) * 29, CX + math.sin(a) * 29,
             CX + math.cos(a) * 31, CX + math.sin(a) * 31, 3)
    # 회전 점선
    ring(g, 25, 1, dash=(8, 14.5), phase=-t * 22.5)
    # 주화 8닢: 광택이 한 닢씩 이동
    glint = int(t * 8) % 8
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        mx, my = CX + math.cos(a) * 19, CX + math.sin(a) * 19
        ring_at(g, mx, my, 3, 1)
        if k == glint:
            # 만월 광택
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    px(g, mx + dx, my + dy, 2)
        else:
            px(g, mx, my, 2)
    # 중앙 대금화: 원 + 네모 구멍 + 사선 광선
    ring(g, 9, 1)
    ring(g, 8, 1)
    stamp(g, 29, 29, ['#####', '#...#', '#...#', '#...#', '#####'], {'#': 2})
    ray = (f // 5) % 2
    for k in range(4):
        a = math.radians(45 + k * 90)
        r0, r1 = 11, 14 + ray
        line(g, CX + math.cos(a) * r0, CX + math.sin(a) * r0,
             CX + math.cos(a) * r1, CX + math.sin(a) * r1, 2)
    # 반짝임
    for i in range(4):
        a = math.radians(i * 90 + 12)
        if ((f // 5) + i) % 4 == 0:
            plus(g, int(CX + math.cos(a) * 26), int(CX + math.sin(a) * 26), 2, big=True)
    return g


def ring_at(g, cx, cy, r, c):
    steps = max(24, int(r * 14))
    for i in range(steps):
        a = math.tau * i / steps
        px(g, cx + math.cos(a) * r, cy + math.sin(a) * r, c)


def frame_blood(f):
    """핏빛 인장진 — 가시 돋친 봉인, 뛰는 심장 고리, 떨어지는 핏방울."""
    g = blank()
    t = f / FRAMES
    # 가시 링: 바깥 8가시
    ring(g, 29, 1)
    for k in range(8):
        a = math.radians(k * 45)
        bx, by = CX + math.cos(a) * 29, CX + math.sin(a) * 29
        line(g, bx, by, CX + math.cos(a) * 32, CX + math.sin(a) * 32, 1)
        px(g, CX + math.cos(a) * 32, CX + math.sin(a) * 32, 3)
    # 역회전 점선 두 겹 (주기가 360을 나눠 떨어져야 루프가 이어진다)
    ring(g, 26, 3, dash=(11, 13), phase=-t * 24)
    ring(g, 24, 1, dash=(5, 13), phase=t * 18)
    # 혈구 4닢: 링 노드 (espantalho 문법)
    for k in range(4):
        a = math.radians(k * 90)
        mx, my = CX + math.cos(a) * 26.5, CX + math.sin(a) * 26.5
        ring_at(g, mx, my, 2.4, 1)
        px(g, mx, my, 2)
    # 발톱 자국 4개: 평행 삼선 스탬프 (대각)
    claw = ['#..#..#', '.#..#..', '.#..#..', '..#..#.', '..#..#.']
    for k in range(4):
        a = math.radians(45 + k * 90)
        mx = int(CX + math.cos(a) * 18) - 3
        my = int(CX + math.sin(a) * 18) - 2
        stamp(g, mx, my, claw, {'#': 1})
    # 중앙 역삼각 봉인 + 심색 해칭 (fire 삼각형 문법)
    v = [(CX - 11, 24.0), (CX + 11, 24.0), (CX, 42.0)]
    for yy in range(25, 42):
        half = 10.5 * (1 - (yy - 24) / 18)
        for xx in range(int(CX - half) + 1, int(CX + half) + 1):
            if (xx + yy) % 2 == 0:
                px(g, xx, yy, 3)
    line(g, *v[0], *v[1], 1)
    line(g, *v[1], *v[2], 1)
    line(g, *v[2], *v[0], 1)
    # 심장 고리: 두 번 뛰고 쉬는 박동
    beat = f % 20
    r_beat = 14 if beat in (0, 1, 4, 5) else 13
    ring(g, r_beat, 1, dash=(20, 10), phase=t * 30)
    # 핏방울: 굵은 물방울 + 흘러내리는 점 (20f 주기 ×2)
    cyc = (f % 20) / 20
    stamp(g, 30, 27, ['.##.', '####', '####', '.##.'], {'#': 2})
    px(g, CX + 0.5, 26, 2)
    if cyc > 0.35:
        dy = int((cyc - 0.35) * 14)
        px(g, CX, 33 + dy, 2)
        px(g, CX + 1, 33 + dy, 2)
        if cyc > 0.6:
            px(g, CX, 35 + dy, 1)
    # 핏자국 점
    for i in range(4):
        a = math.radians(i * 90 + 70)
        if ((f // 5) + i) % 4 == 0:
            px(g, CX + math.cos(a) * 21, CX + math.sin(a) * 21, 2)
    return g


def frame_wind(f):
    """질풍 선회진 — 태풍 소용돌이와 원을 쫓는 돌풍 줄기."""
    g = blank()
    t = f / FRAMES
    # 외곽: 긴 점선이 빠르게 돈다 (질주감)
    ring(g, 31, 1, dash=(30, 15), phase=t * 45)
    ring(g, 28, 3, dash=(10, 12.5), phase=-t * 22.5)
    # 얇은 안정 링 + 눈금 8
    ring(g, 22, 1)
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        px(g, CX + math.cos(a) * 23, CX + math.sin(a) * 23, 3)
    # 돌풍 줄기 3개: 원을 따라 질주 (꼬리 잔상)
    for k in range(3):
        a0 = math.tau * ((t + k / 3) % 1.0)
        for tail in range(8):
            a = a0 - tail * 0.05
            c = 2 if tail < 3 else 1
            px(g, CX + math.cos(a) * 25, CX + math.sin(a) * 25, c)
        px(g, CX + math.cos(a0) * 25, CX + math.sin(a0) * 25 - 1, 2)
    # 중앙 태풍 소용돌이: 3팔 나선. 45° 스텝 8변형 → 픽셀이 뭉개지지 않는다.
    spin = (f // 5) * 45
    for k in range(3):
        base = spin + k * 120
        prev = None
        for i in range(9):
            u = i / 8
            ang = math.radians(base + u * 170)
            rad = 2.2 + u * 9.5
            p = (CX + math.cos(ang) * rad, CX + math.sin(ang) * rad)
            if prev is not None:
                line(g, prev[0], prev[1], p[0], p[1], 1)
            prev = p
        # 나선 끝 강조
        ang = math.radians(base + 170)
        px(g, CX + math.cos(ang) * 11.7, CX + math.sin(ang) * 11.7, 2)
    # 태풍의 눈
    stamp(g, 30, 30, ['.##.', '#..#', '#..#', '.##.'], {'#': 2})
    # 깃털 글리프 4개 (대각, 명멸)
    feather = ['...#', '..##', '.#.#', '.##.', '#.#.', '##..', '#...']
    for i in range(4):
        a = math.radians(45 + i * 90)
        if ((f // 10) + i) % 2 == 0:
            cxp = int(CX + math.cos(a) * 17) - 2
            cyp = int(CX + math.sin(a) * 17) - 3
            stamp(g, cxp, cyp, feather, {'#': 1})
    # 바람 반짝임
    for i in range(4):
        a = math.radians(i * 90 + 10)
        if ((f // 5) + i) % 4 == 0:
            plus(g, int(CX + math.cos(a) * 19), int(CX + math.sin(a) * 19), 2)
    return g


GENERATORS = {'ice': frame_ice, 'gold': frame_gold, 'blood': frame_blood, 'wind': frame_wind}


# ───────────────────────── 패킹 ─────────────────────────

def to_rgba(g, pal):
    out = np.zeros((L, L, 4), dtype=np.uint8)
    for idx, rgb in pal.items():
        m = g == idx
        out[m, 0], out[m, 1], out[m, 2], out[m, 3] = rgb[0], rgb[1], rgb[2], 255
    return out


def upscale(a, s):
    return np.kron(a, np.ones((s, s, 1), dtype=np.uint8)) if a.ndim == 3 else np.kron(a, np.ones((s, s), dtype=np.uint8))


def pack_grid(frames, fw, cols):
    rows = math.ceil(len(frames) / cols)
    sheet = Image.new('RGBA', (cols * fw, rows * fw), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, ((i % cols) * fw, (i // cols) * fw))
    return sheet


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(GEN, exist_ok=True)
    manifest = {}

    # 1) 생성 4원소 — 512 원본 규격 시트 + 게임용 256 그리드
    for el, gen in GENERATORS.items():
        pal = PALETTES[el]
        logical = [gen(f) for f in range(FRAMES)]
        rgba512 = [Image.fromarray(upscale(to_rgba(g, pal), 8)) for g in logical]
        row = Image.new('RGBA', (512 * FRAMES, 512), (0, 0, 0, 0))
        for i, fr in enumerate(rgba512):
            row.paste(fr, (i * 512, 0))
        row.save(os.path.join(GEN, f'{el}_idle-Sheet.png'))
        game = [Image.fromarray(upscale(to_rgba(g, pal), 4)) for g in logical]
        pack_grid(game, 256, 8).save(os.path.join(OUT, f'{el}.png'))
        manifest[el] = {'frameSize': 256, 'frames': FRAMES, 'cols': 8}

    # 2) 원본 4원소 — 다운스케일 재패킹 (512→256 ÷2, 816→272 ÷3)
    for el, (fname, fs) in ORIGINALS.items():
        im = Image.open(os.path.join(SRC, fname))
        n = im.width // fs
        target = fs // 2 if fs == 512 else fs // 3
        frames = []
        for i in range(n):
            fr = im.crop((i * fs, 0, (i + 1) * fs, fs))
            frames.append(fr.resize((target, target), Image.NEAREST))
        cols = 8 if n >= 8 else n
        pack_grid(frames, target, cols).save(os.path.join(OUT, f'{el}.png'))
        manifest[el] = {'frameSize': target, 'frames': n, 'cols': cols}

    # 3) 매니페스트 TS
    lines = [
        '// 자동 생성 — scripts/generate-aura-sheets.py 가 만든 파일. 직접 수정 금지.',
        '// 원소 세트 오라 스프라이트시트 규격.',
        'export interface AuraSheetSpec {',
        '\tframeSize: number;',
        '\tframes: number;',
        '\tcols: number;',
        '}',
        '',
        'export const AURA_SHEETS: Record<string, AuraSheetSpec> = {',
    ]
    for el in ('fire', 'electric', 'ice', 'poison', 'gold', 'blood', 'wind', 'void'):
        m = manifest[el]
        lines.append(f"\t{el}: {{ frameSize: {m['frameSize']}, frames: {m['frames']}, cols: {m['cols']} }},")
    lines.append('};')
    lines.append('')
    with open(os.path.join(ROOT, 'src', 'logic', 'auraSheets.ts'), 'w') as fp:
        fp.write('\n'.join(lines))

    for el, m in manifest.items():
        path = os.path.join(OUT, f'{el}.png')
        print(f"{el:9s} frame={m['frameSize']} n={m['frames']} cols={m['cols']} size={os.path.getsize(path)//1024}KB")


if __name__ == '__main__':
    main()
