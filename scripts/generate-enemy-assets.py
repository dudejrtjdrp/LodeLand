#!/usr/bin/env python3
"""신규 적 팩(assets-src/enemypacks) → public/enemy/pack2 정규화 스트립.

방침 (movesword-tinysword-assets 규약 계승):
  - 적별로 전 애니메이션 프레임의 알파 합집합 bbox 를 구해 같은 크롭 박스로 자른다
    (프레임 간 정렬 보존, 히트박스=displaySize 감각 유지). 여백 4px.
  - 출력: 가로 스트립 `public/enemy/pack2/<id>_<anim>.png`, 프레임 크기는 크롭 결과.
  - 카탈로그가 참조하면 scripts/build-atlas.mjs 가 자동으로 아틀라스에 담는다.
  - 재실행 안전. 콘택트 시트(/tmp/thumbs/pack2_contact.png)로 눈검수.

frame counts:
  demon slime walk12/hit5/death22 (288x160) · mino walk12 (288x160)
  frost walk10/hit7/death16 (192x128) · golem idle8/walk10/hurt4/die13 (90x64)
  demonA walk8/hurt4/death4 (100x100) · blood walk8/hurt4/death4 (100x100)
  bat fly9/hurt5/die12 (64x64) · rat run6/hurt1/death6 (32x32)
  finalboss normal/mud/flying 6f 128x150 · ice 6f 128x128(패드) · hurt 2f
"""
from PIL import Image, ImageDraw
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'enemypacks')
OUT = os.path.join(ROOT, 'public', 'enemy', 'pack2')
os.makedirs(OUT, exist_ok=True)

DS = os.path.join(SRC, 'DemonSlime', 'boss_demon_slime_FREE_v1.0', 'individual sprites')
MINO = os.path.join(SRC, 'Minotaur', 'mino_v1.1_free', 'animations')
FG = os.path.join(SRC, 'FrostGuardian', 'Frost_Guardian_FREE_v1.0', 'PNG files')
GOL = os.path.join(SRC, 'Golems', 'Golems_Free_Version', 'Golem_1')
BAT = os.path.join(SRC, 'Bat', 'DarkFantasyEnemies_FREE', 'Bat', 'Bat without VFX')
RAT = os.path.join(SRC, 'Rat', 'NoneOutlinedRat')
TINY = os.path.join(SRC, 'TinyRPG02', 'Tiny RPG Character Asset Pack 02 -Free Demon_A&Blood Monster_A',
                    'Characters(100x100 split)')


def frames_from_files(folder, prefix, count):
    return [Image.open(os.path.join(folder, f'{prefix}{i}.png')).convert('RGBA') for i in range(1, count + 1)]


def frames_from_strip(path, fw, count, fh=None):
    im = Image.open(path).convert('RGBA')
    fh = fh or im.height
    return [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(count)]


def union_bbox(frame_lists, pad=4):
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for frames in frame_lists:
        for fr in frames:
            a = np.asarray(fr)
            ys, xs = np.where(a[..., 3] > 16)
            if len(xs) == 0:
                continue
            x0 = min(x0, xs.min()); y0 = min(y0, ys.min())
            x1 = max(x1, xs.max()); y1 = max(y1, ys.max())
    w, h = frame_lists[0][0].size
    return (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + 1 + pad), min(h, y1 + 1 + pad))


def emit(eid, anims):
    """anims: dict name -> frame list (전부 같은 원본 캔버스 크기여야 함)"""
    box = union_bbox(list(anims.values()))
    out = {}
    for name, frames in anims.items():
        cw, ch = box[2] - box[0], box[3] - box[1]
        strip = Image.new('RGBA', (cw * len(frames), ch))
        for i, fr in enumerate(frames):
            strip.paste(fr.crop(box), (i * cw, 0))
        path = os.path.join(OUT, f'{eid}_{name}.png')
        strip.save(path, optimize=True)
        out[name] = (len(frames), cw, ch)
        print(f'{eid}_{name}: {len(frames)}f {cw}x{ch}')
    return out


def pad_to(frames, w, h):
    """작은 프레임을 같은 캔버스로 (하단 중앙 정렬) — finalboss ice 128x128 → 128x150"""
    out = []
    for fr in frames:
        c = Image.new('RGBA', (w, h))
        c.paste(fr, ((w - fr.width) // 2, h - fr.height))
        out.append(c)
    return out


specs = {}

specs['boss-abyss-demon'] = emit('boss-abyss-demon', {
    'idle': frames_from_files(os.path.join(DS, '02_demon_walk'), 'demon_walk_', 12),
    'hit': frames_from_files(os.path.join(DS, '04_demon_take_hit'), 'demon_take_hit_', 5),
    'death': frames_from_files(os.path.join(DS, '05_demon_death'), 'demon_death_', 22),
})

specs['boss-minos'] = emit('boss-minos', {
    'idle': frames_from_files(os.path.join(MINO, 'walk'), 'walk_', 12),
})

specs['boss-frost-guardian'] = emit('boss-frost-guardian', {
    'idle': frames_from_files(os.path.join(FG, 'walk'), 'walk_', 10),
    'hit': frames_from_files(os.path.join(FG, 'take_hit'), 'take_hit_', 7),
    'death': frames_from_files(os.path.join(FG, 'death'), 'death_', 16),
})

for eid, color in (('mb-frost-golem', 'Blue'), ('mb-magma-golem', 'Orange')):
    base = os.path.join(GOL, color, 'No_Swoosh_VFX')
    specs[eid] = emit(eid, {
        'idle': frames_from_strip(os.path.join(base, 'Golem_1_walk.png'), 90, 10),
        'hit': frames_from_strip(os.path.join(base, 'Golem_1_hurt.png'), 90, 4),
        'death': frames_from_strip(os.path.join(base, 'Golem_1_die.png'), 90, 13),
    })

specs['demonling'] = emit('demonling', {
    'idle': frames_from_strip(os.path.join(TINY, 'Demon_A', 'Demon_A', 'Demon_A_Walk.png'), 100, 8),
    'hit': frames_from_strip(os.path.join(TINY, 'Demon_A', 'Demon_A', 'Demon_A_Hurt.png'), 100, 4),
    'death': frames_from_strip(os.path.join(TINY, 'Demon_A', 'Demon_A', 'Demon_A_Death.png'), 100, 4),
})

specs['blood-horror'] = emit('blood-horror', {
    'idle': frames_from_strip(os.path.join(TINY, 'Blood Monster_A', 'Blood Monster_A', 'Blood Monster_A_Walk.png'), 100, 8),
    'hit': frames_from_strip(os.path.join(TINY, 'Blood Monster_A', 'Blood Monster_A', 'Blood Monster_A_Hurt.png'), 100, 4),
    'death': frames_from_strip(os.path.join(TINY, 'Blood Monster_A', 'Blood Monster_A', 'Blood Monster_A_Death.png'), 100, 4),
})

specs['duskbat'] = emit('duskbat', {
    'idle': frames_from_strip(os.path.join(BAT, 'Bat-IdleFly.png'), 64, 9),
    'hit': frames_from_strip(os.path.join(BAT, 'Bat-Hurt.png'), 64, 5),
    'death': frames_from_strip(os.path.join(BAT, 'Bat-Die.png'), 64, 12),
})

specs['verdrat'] = emit('verdrat', {
    'idle': frames_from_strip(os.path.join(RAT, 'rat-run.png'), 32, 6),
    'death': frames_from_strip(os.path.join(RAT, 'rat-death.png'), 32, 6),
})

# 탈각하는 것 — 4형태 (normal/mud/ice/flying) + hurt. 전부 128x150 캔버스로 통일.
fb = {
    'idle': frames_from_strip(os.path.join(SRC, 'spr_enemy_finalboss_normal_strip6.png'), 128, 6),
    'mud': frames_from_strip(os.path.join(SRC, 'spr_enemy_finalboss_mud_strip6.png'), 128, 6),
    'ice': pad_to(frames_from_strip(os.path.join(SRC, 'spr_enemy_finalboss_ice_strip6.png'), 128, 6), 128, 150),
    'flying': frames_from_strip(os.path.join(SRC, 'spr_enemy_finalboss_flying_strip6.png'), 128, 6),
    'hit': frames_from_strip(os.path.join(SRC, 'spr_enemy_finalboss_hurt_strip2.png'), 128, 2),
}
specs['boss-molt'] = emit('boss-molt', fb)

# ── 콘택트 시트 (눈검수: facing·크롭 확인)
cell = 150
names = list(specs.keys())
sheet = Image.new('RGB', (cell * len(names), cell + 24), (24, 25, 30))
d = ImageDraw.Draw(sheet)
for i, eid in enumerate(names):
    p = os.path.join(OUT, f'{eid}_idle.png')
    im = Image.open(p).convert('RGBA')
    n, cw, ch = specs[eid]['idle']
    fr = im.crop((0, 0, cw, ch))
    s = min((cell - 12) / cw, (cell - 12) / ch)
    fr = fr.resize((max(1, int(cw * s)), max(1, int(ch * s))), Image.NEAREST)
    sheet.paste(fr, (i * cell + (cell - fr.width) // 2, cell - fr.height), fr)
    d.text((i * cell + 4, cell + 4), eid[:20], fill=(220, 225, 230))
sheet.save('/tmp/thumbs/pack2_contact.png')
print('contact sheet: /tmp/thumbs/pack2_contact.png')
