#!/usr/bin/env python3
"""보스 전용 스프라이트 생성 (2026-09-02 보스 전면 개편).

왜: 보스 8종 중 4종(녹의 왕·공성 거구·바늘 여왕·사망군주)이 잡몹과 같은
Tiny Swords 유닛 달리기 시트를 그대로 쓰고 있었다 — idle 도 walk 도 attack 도 없다.
나머지 4종(pack2)은 전용 시트가 있지만 원본 팩의 idle/attack 프레임을 안 꺼내 쓰고 있었다.

방침 (assets-src 라이브러리 규약 · docs/art-guideline.md 계승):
  1. **원본을 업스케일하지 않는다.** NEAREST 업스케일은 표시 단계에서 하는 것과
     결과가 같은데 아틀라스만 4~9배로 부푼다. 시트는 원본 해상도 그대로 굽는다.
  2. 적별로 전 애니메이션 프레임의 알파 합집합 bbox 로 같은 크롭 박스를 쓴다
     (프레임 간 정렬 보존 — 애니가 바뀌어도 발밑이 흔들리지 않는다).
  3. 긴 애니는 균등 간격으로 솎아 낸다(stride) — 아틀라스 예산(2048×4096) 방어.
  4. 신규 보스는 라이브러리 원본을 **팔레트 재염색 + 실루엣 보강**으로 만든다.
     완전 신규 도트는 최후 수단 (규약 §시안 우선).

출력: public/enemy/pack2/<id>_<anim>.png (가로 스트립) + /tmp/thumbs/boss_contact.png
이후: scripts/update-boss-catalog.py → node scripts/build-atlas.mjs
"""
from PIL import Image
import colorsys
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'enemypacks')
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'enemy', 'pack2')
os.makedirs(OUT, exist_ok=True)
os.makedirs('/tmp/thumbs', exist_ok=True)

DS = os.path.join(SRC, 'DemonSlime', 'boss_demon_slime_FREE_v1.0', 'individual sprites')
MINO = os.path.join(SRC, 'Minotaur', 'mino_v1.1_free', 'animations')
FG = os.path.join(SRC, 'FrostGuardian', 'Frost_Guardian_FREE_v1.0', 'PNG files')
GOL = os.path.join(SRC, 'Golems', 'Golems_Free_Version', 'Golem_1')
BAT = os.path.join(SRC, 'Bat', 'DarkFantasyEnemies_FREE', 'Bat', 'Bat without VFX')
WOLF = os.path.join(PUB, 'enemy', 'Skullwolf', 'Massacre.png')


# ── 원본 로딩 ────────────────────────────────────────────────────────────

def from_files(folder, prefix, count):
    return [Image.open(os.path.join(folder, f'{prefix}{i}.png')).convert('RGBA')
            for i in range(1, count + 1)]


def from_strip(path, fw, count, fh=None):
    im = Image.open(path).convert('RGBA')
    fh = fh or im.height
    return [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(count)]


def from_grid(path, fw, fh, row, count):
    im = Image.open(path).convert('RGBA')
    return [im.crop((i * fw, row * fh, (i + 1) * fw, (row + 1) * fh)) for i in range(count)]


def thin(frames, keep):
    """균등 간격으로 keep 장만 남긴다 (첫 프레임은 항상 유지)."""
    if keep >= len(frames):
        return frames
    idx = [round(i * (len(frames) - 1) / (keep - 1)) for i in range(keep)]
    return [frames[i] for i in idx]


# ── 재염색 ───────────────────────────────────────────────────────────────

def recolor(frames, hue=0.0, sat=1.0, val=1.0, tint=None, tint_amt=0.0):
    """HSV 회전 + 채도/명도 배율 + 선택적 색 혼합. 알파·명암 구조는 보존한다."""
    out = []
    for fr in frames:
        a = np.asarray(fr).astype(np.float32) / 255.0
        rgb, alpha = a[..., :3], a[..., 3]
        mask = alpha > 0.02
        if mask.any():
            flat = rgb[mask]
            hsv = np.array([colorsys.rgb_to_hsv(*px) for px in flat], dtype=np.float32)
            hsv[:, 0] = (hsv[:, 0] + hue) % 1.0
            hsv[:, 1] = np.clip(hsv[:, 1] * sat, 0, 1)
            hsv[:, 2] = np.clip(hsv[:, 2] * val, 0, 1)
            back = np.array([colorsys.hsv_to_rgb(*px) for px in hsv], dtype=np.float32)
            if tint is not None and tint_amt > 0:
                t = np.array(tint, dtype=np.float32) / 255.0
                back = back * (1 - tint_amt) + t * tint_amt
            rgb = rgb.copy()
            rgb[mask] = np.clip(back, 0, 1)
        merged = np.concatenate([rgb, alpha[..., None]], axis=-1)
        out.append(Image.fromarray((merged * 255).astype(np.uint8), 'RGBA'))
    return out


def rim(frames, color, alpha=0.85):
    """실루엣 바깥 1px 테두리 — 재염색만으로 부족한 '다른 개체' 신호를 준다."""
    out = []
    col = np.array(list(color) + [int(255 * alpha)], dtype=np.uint8)
    for fr in frames:
        a = np.asarray(fr).copy()
        m = a[..., 3] > 24
        grow = np.zeros_like(m)
        grow[1:, :] |= m[:-1, :]
        grow[:-1, :] |= m[1:, :]
        grow[:, 1:] |= m[:, :-1]
        grow[:, :-1] |= m[:, 1:]
        edge = grow & ~m
        a[edge] = col
        out.append(Image.fromarray(a, 'RGBA'))
    return out


def bob(frames, amp=2):
    """걷기 시트가 없는 원본용 — idle 프레임을 상하로 흔들어 walk 를 만든다.
    (원본 픽셀만 옮긴다: 새 색을 만들지 않는다 = 팔레트 불변)"""
    out = []
    n = len(frames)
    for i, fr in enumerate(frames):
        dy = int(round(-amp * abs(((i / max(1, n - 1)) * 2 - 1))))
        canvas = Image.new('RGBA', fr.size)
        canvas.paste(fr, (0, dy), fr)
        out.append(canvas)
    return out


# ── 출력 ─────────────────────────────────────────────────────────────────

def union_bbox(frame_lists, pad=4):
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for frames in frame_lists:
        for fr in frames:
            arr = np.asarray(fr)
            ys, xs = np.where(arr[..., 3] > 16)
            if len(xs) == 0:
                continue
            x0 = min(x0, xs.min()); y0 = min(y0, ys.min())
            x1 = max(x1, xs.max()); y1 = max(y1, ys.max())
    w, h = frame_lists[0][0].size
    return (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + 1 + pad), min(h, y1 + 1 + pad))


def body_box(frames):
    """idle 프레임만의 알파 bbox — '몸통 크기'. 표시 크기를 여기에 맞춘다."""
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for fr in frames:
        arr = np.asarray(fr)
        ys, xs = np.where(arr[..., 3] > 16)
        if len(xs) == 0:
            continue
        x0 = min(x0, xs.min()); y0 = min(y0, ys.min())
        x1 = max(x1, xs.max()); y1 = max(y1, ys.max())
    return (int(x1 - x0 + 1), int(y1 - y0 + 1))


SPECS = {}


def emit(eid, anims):
    """anims: dict name -> frame list (전부 같은 캔버스 크기)"""
    box = union_bbox(list(anims.values()))
    cw, ch = int(box[2] - box[0]), int(box[3] - box[1])
    info = {'frame': (cw, ch), 'anims': {}}
    for name, frames in anims.items():
        strip = Image.new('RGBA', (cw * len(frames), ch))
        for i, fr in enumerate(frames):
            strip.paste(fr.crop(box), (i * cw, 0))
        strip.save(os.path.join(OUT, f'{eid}_{name}.png'), optimize=True)
        info['anims'][name] = len(frames)
    info['body'] = body_box(anims.get('idle') or list(anims.values())[0])
    SPECS[eid] = info
    print(f'{eid}: frame {cw}x{ch} body {info["body"][0]}x{info["body"][1]} '
          + ' '.join(f'{k}={v}f' for k, v in info['anims'].items()))
    return info


# ─────────────────────────────────────────────────────────────────────────
# 1) pack2 기존 보스 — 원본 팩에 있는데 안 꺼내 쓰던 idle/attack 을 추가
# ─────────────────────────────────────────────────────────────────────────

emit('boss-abyss-demon', {
    'idle': from_files(os.path.join(DS, '01_demon_idle'), 'demon_idle_', 6),
    'walk': from_files(os.path.join(DS, '02_demon_walk'), 'demon_walk_', 12),
    'attack': thin(from_files(os.path.join(DS, '03_demon_cleave'), 'demon_cleave_', 15), 10),
    'hit': from_files(os.path.join(DS, '04_demon_take_hit'), 'demon_take_hit_', 5),
    'death': thin(from_files(os.path.join(DS, '05_demon_death'), 'demon_death_', 22), 14),
})

emit('boss-minos', {
    'idle': thin(from_files(os.path.join(MINO, 'idle'), 'idle_', 16), 8),
    'walk': from_files(os.path.join(MINO, 'walk'), 'walk_', 12),
    'attack': thin(from_files(os.path.join(MINO, 'atk_1'), 'atk_1_', 16), 10),
})

emit('boss-frost-guardian', {
    'idle': from_files(os.path.join(FG, 'idle'), 'idle_', 6),
    'walk': from_files(os.path.join(FG, 'walk'), 'walk_', 10),
    'attack': thin(from_files(os.path.join(FG, '1_atk'), '1_atk_', 14), 9),
    'hit': from_files(os.path.join(FG, 'take_hit'), 'take_hit_', 7),
    'death': thin(from_files(os.path.join(FG, 'death'), 'death_', 16), 12),
})

for eid, color in (('mb-frost-golem', 'Blue'), ('mb-magma-golem', 'Orange')):
    base = os.path.join(GOL, color, 'No_Swoosh_VFX')
    emit(eid, {
        'idle': thin(from_strip(os.path.join(base, 'Golem_1_idle.png'), 90, 8), 6),
        'walk': from_strip(os.path.join(base, 'Golem_1_walk.png'), 90, 10),
        'attack': thin(from_strip(os.path.join(base, 'Golem_1_attack.png'), 90, 11), 8),
        'hit': from_strip(os.path.join(base, 'Golem_1_hurt.png'), 90, 4),
        'death': thin(from_strip(os.path.join(base, 'Golem_1_die.png'), 90, 13), 10),
    })

# ─────────────────────────────────────────────────────────────────────────
# 2) 전용 시트가 없던 보스 4종 — 라이브러리 원본 재염색 + 실루엣 보강
# ─────────────────────────────────────────────────────────────────────────

# 녹의 왕 (skullwolf-boss): 잠들어 있던 원본 Skullwolf(Massacre) 시트를 깨운다.
# 이미 idle/attack/hit/death 4행이 들어 있는데 카탈로그가 참조하지 않고 있었다.
wolf_idle = from_grid(WOLF, 64, 64, 0, 6)
emit('skullwolf-boss', {
    'idle': wolf_idle,
    'walk': bob(wolf_idle, amp=2),
    'attack': from_grid(WOLF, 64, 64, 1, 5),
    'hit': from_grid(WOLF, 64, 64, 2, 4),
    'death': from_grid(WOLF, 64, 64, 3, 7),
})

# 공성 거구 (boss-siegehulk): Golem_1 을 무쇠·녹빛으로 재염색.
# 서리/마그마 골렘(미니보스)과 색·크기가 확연히 갈리게 한다.
gb = os.path.join(GOL, 'Blue', 'No_Swoosh_VFX')
siege = {
    'idle': thin(from_strip(os.path.join(gb, 'Golem_1_idle.png'), 90, 8), 6),
    'walk': from_strip(os.path.join(gb, 'Golem_1_walk.png'), 90, 10),
    'attack': thin(from_strip(os.path.join(gb, 'Golem_1_attack.png'), 90, 11), 8),
    'hit': from_strip(os.path.join(gb, 'Golem_1_hurt.png'), 90, 4),
    'death': thin(from_strip(os.path.join(gb, 'Golem_1_die.png'), 90, 13), 10),
}
siege = {k: rim(recolor(v, hue=0.50, sat=0.42, val=0.86, tint=(168, 96, 52), tint_amt=0.38),
                (255, 176, 87), 0.7) for k, v in siege.items()}
emit('boss-siegehulk', siege)

# 바늘 여왕 (boss-needlequeen): Bat 원본을 자수정빛 여왕으로.
# 일반 duskbat 과 같은 실루엣이지만 색·금빛 테두리·크기가 다르다.
queen = {
    'idle': from_strip(os.path.join(BAT, 'Bat-IdleFly.png'), 64, 9),
    'walk': from_strip(os.path.join(BAT, 'Bat-Run.png'), 64, 8),
    'attack': from_strip(os.path.join(BAT, 'Bat-Attack1.png'), 64, 8),
    'hit': from_strip(os.path.join(BAT, 'Bat-Hurt.png'), 64, 5),
    'death': thin(from_strip(os.path.join(BAT, 'Bat-Die.png'), 64, 12), 10),
}
queen = {k: rim(recolor(v, hue=0.10, sat=1.35, val=1.05, tint=(146, 92, 214), tint_amt=0.22),
                (240, 196, 96), 0.8) for k, v in queen.items()}
emit('boss-needlequeen', queen)

# 사망군주 (death-lord): 미노타우로스 골격을 뼈·공허 보라로 탈색.
# 미노스(갈적색 원본)와는 팔레트가 정반대 — 실루엣이 같아도 다른 개체로 읽힌다.
lord = {
    'idle': thin(from_files(os.path.join(MINO, 'idle'), 'idle_', 16), 6),
    'walk': thin(from_files(os.path.join(MINO, 'walk'), 'walk_', 12), 8),
    'attack': thin(from_files(os.path.join(MINO, 'atk_1'), 'atk_1_', 16), 8),
}
lord = {k: rim(recolor(v, hue=0.62, sat=0.30, val=1.18, tint=(214, 206, 226), tint_amt=0.34),
               (168, 108, 236), 0.85) for k, v in lord.items()}
emit('death-lord', lord)


# ── 콘택트 시트 (눈검수: facing·크롭·색 구분) ─────────────────────────────
cell = 168
names = list(SPECS.keys())
sheet = Image.new('RGB', (cell * len(names), cell + 26), (24, 25, 30))
from PIL import ImageDraw  # noqa: E402
d = ImageDraw.Draw(sheet)
for i, eid in enumerate(names):
    im = Image.open(os.path.join(OUT, f'{eid}_idle.png')).convert('RGBA')
    cw, ch = SPECS[eid]['frame']
    fr = im.crop((0, 0, cw, ch))
    s = min((cell - 12) / cw, (cell - 12) / ch)
    fr = fr.resize((max(1, int(cw * s)), max(1, int(ch * s))), Image.NEAREST)
    sheet.paste(fr, (i * cell + (cell - fr.width) // 2, cell - fr.height), fr)
    d.text((i * cell + 4, cell + 6), eid[:22], fill=(220, 225, 230))
sheet.save('/tmp/thumbs/boss_contact.png')
print('contact sheet: /tmp/thumbs/boss_contact.png')

# 카탈로그 갱신 스크립트가 읽어 갈 사양
import json  # noqa: E402
with open('/tmp/boss_specs.json', 'w') as fh:
    json.dump(SPECS, fh, indent=1)
print('specs: /tmp/boss_specs.json')
