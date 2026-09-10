#!/usr/bin/env python3
"""FX 스프라이트시트 생성기 (2026-09-05)

도형(fx*)으로 흉내내던 스킬 연출을 실제 이펙트 시트로 바꾸기 위한 자작 파이프라인.
scripts/generate-aura-sheets.py 의 규약을 따른다.

설계 규칙
 1. 회색조로 뽑는다. 원소 색은 런타임 setTint(곱연산)로 입힌다 →
    시트 1장이 8원소를 커버하고 텍스처 유닛을 아낀다. 그래서 베이스가 밝아야 한다.
 2. 부드럽게 그린 뒤 논리 격자(PX)로 축소 → 팔레트 양자화 → 알파 이진화 →
    NEAREST 확대. 이 순서를 지켜야 픽셀아트 톤이 나온다.
 3. 방향성 이펙트(검기)는 +X 를 향해 그린다. 런타임은 setRotation 만 한다.
 4. 모든 프레임은 같은 캔버스 크기. 프레임별 크롭 금지(애니메이션이 떤다).
 5. 프레임 수/크기/fps 는 src/logic/fxSheets.ts 매니페스트로 자동 출력한다.
    코드에 손으로 적지 않는다.

사용: python3 scripts/generate-fx-sheets.py
출력: public/fx/*.png, src/logic/fxSheets.ts
"""

import math
import os
import random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'public', 'fx')
MANIFEST = os.path.join(ROOT, 'src', 'logic', 'fxSheets.ts')

# 회색조 램프 (밝은 쪽부터) — 틴트가 곱연산이라 어두우면 색이 죽는다
RAMP = [(255, 255, 255), (228, 228, 228), (190, 190, 190), (148, 148, 148)]
ALPHA_CUT = 96


# ─────────────────────────────────────────────────────────── 공통 처리

def pixelize(img, px):
    """부드러운 그림 → 논리 격자 축소 → 팔레트 양자화 + 알파 이진화 → NEAREST 확대."""
    w, h = img.size
    small = img.resize((max(1, w // px), max(1, h // px)), Image.LANCZOS)
    src = small.load()
    for y in range(small.height):
        for x in range(small.width):
            r, g, b, a = src[x, y]
            if a < ALPHA_CUT:
                src[x, y] = (0, 0, 0, 0)
                continue
            lum = (r * 299 + g * 587 + b * 114) // 1000
            # 밝기를 4단계 램프로 스냅
            idx = 0 if lum > 220 else 1 if lum > 175 else 2 if lum > 120 else 3
            cr, cg, cb = RAMP[idx]
            src[x, y] = (cr, cg, cb, 255)
    return small.resize((w, h), Image.NEAREST)


def ease_out(t):
    return 1 - (1 - t) ** 2


def fade(t, hold):
    """hold 비율까지 알파 유지, 이후 선형 페이드."""
    if t <= hold:
        return 1.0
    return max(0.0, 1 - (t - hold) / (1 - hold))


def apply_alpha(img, mul):
    """픽셀화가 끝난 뒤 알파를 통째로 낮춘다.

    페이드를 그리기 단계에서 주면 LANCZOS 축소 + 알파 이진화가 맞물려
    꼬리 프레임이 흩뿌린 점으로 부서진다. 반드시 픽셀화 뒤에 적용할 것.
    """
    if mul >= 0.999:
        return img
    if mul <= 0.004:
        return Image.new('RGBA', img.size, (0, 0, 0, 0))
    a = img.split()[3].point(lambda v: int(v * mul))
    img.putalpha(a)
    return img


def pack(frames, cols, path):
    """프레임 리스트 → 격자 시트. 남는 칸은 완전 투명."""
    fw, fh = frames[0].size
    rows = math.ceil(len(frames) / cols)
    sheet = Image.new('RGBA', (fw * cols, fh * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % cols) * fw, (i // cols) * fh), f)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return fw, fh, len(frames), cols


# ─────────────────────────────────────────────────────────── 1. 시전 마법진
# skillCastFX 가 필살기 8종 + 트리 능동 21종의 공유 시전 문법이다.
# 이거 한 장이면 29개 스킬이 동시에 좋아진다 — 최우선 교체 대상.

def cast_circle(size=256, frames=12, px=4):
    out = []
    for i in range(frames):
        t = i / (frames - 1)
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        c = size / 2
        grow = ease_out(min(1.0, t / 0.35))          # 0~0.35 구간에 팽창
        a = 255
        mul = fade(t, 0.45)
        r_out = c * 0.94 * grow
        r_in = r_out * 0.62
        # 바깥 링(굵게) + 안쪽 링(가늘게)
        d.ellipse([c - r_out, c - r_out, c + r_out, c + r_out],
                  outline=(255, 255, 255, a), width=px * 2)
        d.ellipse([c - r_in, c - r_in, c + r_in, c + r_in],
                  outline=(205, 205, 205, a), width=px)
        # 룬 눈금 12개 — 시간에 따라 회전한다
        spin = t * 0.9
        for k in range(12):
            ang = spin + k * math.pi / 6
            x0, y0 = c + math.cos(ang) * r_in, c + math.sin(ang) * r_in
            x1, y1 = c + math.cos(ang) * r_out, c + math.sin(ang) * r_out
            d.line([x0, y0, x1, y1], fill=(240, 240, 240, a), width=px)
        # 중앙 코어 — 팽창 직후 가장 밝고 빠르게 사그라든다
        core = c * 0.20 * (1 - t) ** 1.5
        if core > 1:
            d.ellipse([c - core, c - core, c + core, c + core], fill=(255, 255, 255, a))
        out.append(apply_alpha(pixelize(img, px), mul))
    return out


# ─────────────────────────────────────────────────────────── 2. 노바
# 화염/서리/보이드 필살기 + 세트 스킬이 공유한다. 원소는 틴트로.

def nova(size=256, frames=10, px=4):
    rng = random.Random(20260905)
    # 가장자리 요철 — 프레임 간 유지해야 형태가 떨지 않는다
    jag = [0.86 + rng.random() * 0.14 for _ in range(28)]
    out = []
    for i in range(frames):
        t = i / (frames - 1)
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        c = size / 2
        # 첫 프레임부터 최소 반경을 준다 — 0에서 시작하면 흰 원판만 보인다
        grow = 0.18 + 0.82 * ease_out(min(1.0, t / 0.5))
        a = 255
        mul = fade(t, 0.30)
        r = c * 0.95 * grow
        pts = []
        for k, j in enumerate(jag):
            ang = k / len(jag) * math.pi * 2
            rr = r * j
            pts.append((c + math.cos(ang) * rr, c + math.sin(ang) * rr))
        # 두꺼운 충격파 링
        d.polygon(pts, outline=(255, 255, 255, a))
        d.line(pts + [pts[0]], fill=(255, 255, 255, a), width=px * 3)
        inner = [(c + (x - c) * 0.74, c + (y - c) * 0.74) for x, y in pts]
        d.line(inner + [inner[0]], fill=(198, 198, 198, a), width=px)
        # 방사 스파이크 8개
        for k in range(8):
            ang = k * math.pi / 4 + 0.2
            d.line([c + math.cos(ang) * r * 0.7, c + math.sin(ang) * r * 0.7,
                    c + math.cos(ang) * r * 1.02, c + math.sin(ang) * r * 1.02],
                   fill=(255, 255, 255, a), width=px * 2)
        # 초반 코어 섬광
        if t < 0.3:
            cr = r * 0.42 * (1 - t / 0.3)
            if cr > 1:
                d.ellipse([c - cr, c - cr, c + cr, c + cr], fill=(255, 255, 255, a))
        out.append(apply_alpha(pixelize(img, px), mul))
    return out


# ─────────────────────────────────────────────────────────── 3. 낙뢰 기둥
# lightningFX(필살기 낙뢰 · 트리 낙뢰 · 폭풍우 · 감전 연쇄)가 전부 공유한다.

def bolt(w=128, h=320, frames=6, px=4):
    rng = random.Random(4242)
    # 지그재그 경로는 프레임 간 고정 (프레임마다 새로 뽑으면 번쩍이며 떤다)
    path = [(w / 2, 0)]
    steps = 7
    for k in range(1, steps + 1):
        path.append((w / 2 + (rng.random() - 0.5) * w * 0.62, h * k / steps))
    path[-1] = (w / 2, h)
    branch = [path[3], (path[3][0] - w * 0.3, path[3][1] + h * 0.16),
              (path[3][0] - w * 0.42, path[3][1] + h * 0.30)]
    out = []
    for i in range(frames):
        t = i / (frames - 1)
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        a = 255
        if i == 0:
            mul, core, glow = 0.55, px, px * 2       # 예비 섬광 (가늘게)
        else:
            mul = fade((i - 1) / (frames - 2), 0.25)
            core, glow = px * 2, px * 5
        d.line([p for pt in path for p in pt], fill=(170, 170, 170, a), width=glow)
        d.line([p for pt in path for p in pt], fill=(255, 255, 255, a), width=core)
        if i >= 1:
            d.line([p for pt in branch for p in pt], fill=(230, 230, 230, a), width=px)
        # 착탄 섬광
        fr = w * 0.34 * (1 - t) if i >= 1 else 0
        if fr > 1:
            d.ellipse([w / 2 - fr, h - fr * 0.55, w / 2 + fr, h + fr * 0.55],
                      fill=(255, 255, 255, a))
        out.append(apply_alpha(pixelize(img, px), mul))
    return out


# ─────────────────────────────────────────────────────────── 4. 검기 (방향성)
# +X 를 향해 그린다. 런타임은 setRotation(angle) + anchorLeft 로 붙인다.

def slash(w=384, h=192, frames=7, px=4):
    out = []
    for i in range(frames):
        t = i / (frames - 1)
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        cy = h / 2
        a = 255
        if i == 0:
            reach, spread, mul = w * 0.22, h * 0.16, 0.55   # 앤티시페이션
        else:
            p = (i - 1) / (frames - 2)
            reach = w * (0.55 + 0.45 * ease_out(min(1.0, p / 0.4)))
            spread = h * (0.42 - 0.16 * p)
            mul = fade(p, 0.30)
        # 초승달 궤적 — 바깥 호와 안쪽 호 사이를 채운다
        outer, inner = [], []
        segs = 22
        for k in range(segs + 1):
            u = k / segs
            ang = (u - 0.5) * math.pi * 0.86
            outer.append((math.cos(ang) * reach, cy + math.sin(ang) * spread * 1.45))
            inner.append((math.cos(ang) * reach * 0.70, cy + math.sin(ang) * spread * 0.95))
        # 안쪽은 밝게, 선단은 흰 날 — 얇고 날카로워야 "베었다"고 읽힌다
        d.polygon(outer + inner[::-1], fill=(232, 232, 232, a))
        d.line([p for pt in outer for p in pt], fill=(255, 255, 255, a), width=px * 3)
        # 선단 광점
        d.ellipse([reach - px * 4, cy - px * 4, reach + px * 4, cy + px * 4],
                  fill=(255, 255, 255, a))
        out.append(apply_alpha(pixelize(img, px), mul))
    return out


# ─────────────────────────────────────────────────────────── 5. 지속 장판 (루프)
# fireZone(90ms 재스탬프) · 말뚝검 오라 · 미끼 횃불이 대상.
# 루프 스프라이트로 바꾸면 매 프레임 Graphics 재작도가 사라져 CPU 가 오히려 준다.

def field(size=256, frames=8, px=4):
    out = []
    for i in range(frames):
        t = i / frames                     # 루프이므로 마지막 프레임이 처음으로 이어져야 한다
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        c = size / 2
        breathe = 1 + 0.05 * math.sin(t * math.pi * 2)
        r = c * 0.90 * breathe
        d.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, 215), width=px * 2)
        r2 = r * 0.68
        d.ellipse([c - r2, c - r2, c + r2, c + r2], outline=(190, 190, 190, 175), width=px)
        # 회전하는 룬 눈금 (한 바퀴가 정확히 루프 길이)
        for k in range(8):
            ang = t * math.pi * 2 / 8 + k * math.pi / 4
            d.line([c + math.cos(ang) * r2, c + math.sin(ang) * r2,
                    c + math.cos(ang) * r, c + math.sin(ang) * r],
                   fill=(235, 235, 235, 200), width=px)
        # 솟아오르는 불꽃 혀 6개 — 위상만 다르게
        for k in range(6):
            ph = (t + k / 6) % 1.0
            ang = k * math.pi / 3 + 0.4
            bx, by = c + math.cos(ang) * r2 * 0.8, c + math.sin(ang) * r2 * 0.8
            hgt = size * 0.16 * (0.4 + 0.6 * math.sin(ph * math.pi))
            aa = int(210 * math.sin(ph * math.pi))
            if hgt > 2 and aa > 0:
                d.polygon([(bx - px * 2, by), (bx + px * 2, by), (bx, by - hgt)],
                          fill=(255, 255, 255, aa))
        out.append(pixelize(img, px))
    return out


# ─────────────────────────────────────────────────────────── 빌드

# ─────────────────────────────────────────────────────────── 6. 보호막 돔 (루프)
# 검 방패(bulwark) · 얼음 감옥(iceCage) 이 공유한다. 둘 다 "가두는 벽" 이라 문법이 같고,
# 색만 틴트로 갈린다 — 시트를 나누면 텍스처 유닛만 먹는다.

def dome(size=192, frames=8, px=4):
    out = []
    for i in range(frames):
        t = i / frames                     # 루프
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        c = size / 2
        pulse = 1 + 0.04 * math.sin(t * math.pi * 2)
        r = c * 0.92 * pulse
        # 육각 격자 벽 — 원이 아니라 각진 셀이라 "막" 으로 읽힌다
        for k in range(6):
            a0 = k * math.pi / 3 + t * math.pi / 12
            a1 = a0 + math.pi / 3
            d.line([c + math.cos(a0) * r, c + math.sin(a0) * r,
                    c + math.cos(a1) * r, c + math.sin(a1) * r],
                   fill=(255, 255, 255, 230), width=px * 2)
        # 안쪽 보조 육각 (숨쉬듯 반대로 움직인다)
        r2 = r * (0.66 - 0.03 * math.sin(t * math.pi * 2))
        for k in range(6):
            a0 = k * math.pi / 3 - t * math.pi / 8 + 0.5
            a1 = a0 + math.pi / 3
            d.line([c + math.cos(a0) * r2, c + math.sin(a0) * r2,
                    c + math.cos(a1) * r2, c + math.sin(a1) * r2],
                   fill=(196, 196, 196, 180), width=px)
        # 꼭짓점 광점 — 회전 위치를 읽게 해준다
        for k in range(6):
            a = k * math.pi / 3 + t * math.pi / 12
            x, y = c + math.cos(a) * r, c + math.sin(a) * r
            d.ellipse([x - px * 1.5, y - px * 1.5, x + px * 1.5, y + px * 1.5],
                      fill=(255, 255, 255, 255))
        out.append(pixelize(img, px))
    return out


SPECS = [
    # (키, 생성 함수, 열 수, fps, 루프 여부, 설명)
    ('fx-cast-circle', cast_circle, 6, 24, False, '시전 마법진 (skillCastFX 공유)'),
    ('fx-nova',        nova,        5, 22, False, '원소 노바 (필살기·세트 스킬 공유)'),
    ('fx-bolt',        bolt,        6, 30, False, '낙뢰 기둥 (lightningFX 공유)'),
    ('fx-slash',       slash,       7, 24, False, '검기 (방향성, +X 기준)'),
    ('fx-field',       field,       4, 11, True,  '지속 장판 루프 (불바다·미끼 횃불·시간 감속)'),
    ('fx-dome',        dome,        4, 10, True,  '보호막 돔 루프 (검 방패·얼음 감옥)'),
]


def main():
    entries = []
    for key, fn, cols, fps, loop, note in SPECS:
        frames = fn()
        path = os.path.join(OUT_DIR, f'{key}.png')
        fw, fh, n, cols = pack(frames, cols, path)
        entries.append((key, fw, fh, n, cols, fps, loop, note))
        print(f'  {key:16s} {fw}x{fh} x{n}  cols={cols} fps={fps} loop={loop}')

    lines = [
        '// AUTO-GENERATED by scripts/generate-fx-sheets.py — 손으로 고치지 말 것.',
        '// 이펙트 시트 매니페스트. main.ts 가 이 표만 보고 로드·애니메이션 등록을 한다.',
        '// 프레임 수를 코드에 손으로 적으면 반드시 어긋난다.',
        '',
        'export interface FxSheetSpec {',
        '\t/** 프레임 가로(px) */',
        '\tframeWidth: number;',
        '\t/** 프레임 세로(px) */',
        '\tframeHeight: number;',
        '\t/** 총 프레임 수 */',
        '\tframes: number;',
        '\tfps: number;',
        '\t/** true 면 무한 반복 — 소유자가 fxSpriteStop 으로 직접 꺼야 한다 */',
        '\tloop: boolean;',
        '}',
        '',
        'export const FX_SHEETS: Record<string, FxSheetSpec> = {',
    ]
    for key, fw, fh, n, _cols, fps, loop, note in entries:
        lines.append(f'\t// {note}')
        lines.append(
            f"\t'{key}': {{ frameWidth: {fw}, frameHeight: {fh}, "
            f'frames: {n}, fps: {fps}, loop: {str(loop).lower()} }},'
        )
    lines += ['};', '']
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'\n매니페스트: {MANIFEST}')


if __name__ == '__main__':
    main()
