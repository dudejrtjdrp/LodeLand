#!/usr/bin/env python3
"""보스/중간보스 카탈로그 갱신 (2026-09-02 보스 전면 개편). 재실행 안전.

하는 일
  1. generate-boss-assets.py 가 구운 시트(idle/walk/attack/hit/death)를 spritesheets 에 배선.
  2. **표시 크기 균일화** — 모든 보스의 '몸통' 기하평균(√(w·h))을 BOSS_BODY_GM 으로,
     중간보스를 MINI_BODY_GM 으로 맞춘다. 프레임 여백은 원본마다 제각각이라
     프레임 크기가 아니라 **알파 bbox(실제 몸통)** 를 기준으로 잡아야 균일해진다.
  3. **히트박스 분리** — 프레임이 커질수록 물리 바디도 같이 커져(스케일 비례)
     "보이지도 않는데 맞는" 구간이 생긴다. 몸통 bbox 를 hitbox 로 박아 준다
     (EnemyManager.spawnEnemy 가 body.setSize/setOffset 에 적용).
  4. 보스별 스킬 풀(skillKit)을 카탈로그에 심는다 — src/logic/bossSkills.ts 가 읽는다.

Run: python3 scripts/generate-boss-assets.py && python3 scripts/update-boss-catalog.py
     && node scripts/build-atlas.mjs
"""
import json
import math
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(ROOT, 'src/data/enemyCatalog.json')
PUB = os.path.join(ROOT, 'public')
SPECS = json.load(open('/tmp/boss_specs.json'))

# 균일 규격 — 일반 적의 몸통 기하평균 중앙값은 약 35px.
BOSS_BODY_GM = 132   # ≈ 일반 적의 3.8배 (개편 전 평균 91)
MINI_BODY_GM = 88    # ≈ 일반 적의 2.5배 (개편 전 평균 62)

# 새로 구운 시트를 쓰는 개체 → (facing, 프레임레이트 조정)
NEW_SHEETS = {
    'boss-abyss-demon': 'right',
    'boss-minos': 'left',
    'boss-frost-guardian': 'left',
    'mb-frost-golem': 'left',
    'mb-magma-golem': 'left',
    'skullwolf-boss': 'left',
    'boss-siegehulk': 'left',
    'boss-needlequeen': 'right',
    'death-lord': 'left',
}

RATE = {'idle': 8, 'walk': 11, 'attack': 12, 'hit': 14, 'death': 12}
REPEAT = {'idle': -1, 'walk': -1, 'attack': 0, 'hit': 0, 'death': 0}

# 보스별 스킬 풀 (bossSkills.ts 의 폴백과 같은 값 — 데이터가 우선한다).
SKILL_KITS = {
    'skullwolf-boss': ['slam', 'mines', 'barrage', 'enrage', 'rush', 'meteor', 'cinch', 'halffield', 'seal'],
    'boss-siegehulk': ['slam', 'rush', 'barrage', 'enrage', 'meteor', 'mines', 'cinch', 'halffield', 'sweep'],
    'boss-needlequeen': ['fan', 'barrage', 'spiral', 'enrage', 'beam', 'meteor', 'sweep', 'cinch', 'seal'],
    'death-lord': ['slam', 'mines', 'seal', 'enrage', 'beam', 'halffield', 'barrage', 'cinch', 'sweep'],
    'boss-minos': ['rush', 'slam', 'mines', 'enrage', 'meteor', 'halffield', 'cinch', 'barrage', 'sweep'],
    'boss-frost-guardian': ['fan', 'sweep', 'halffield', 'enrage', 'beam', 'mines', 'spiral', 'cinch', 'seal'],
    'boss-abyss-demon': ['slam', 'spiral', 'mines', 'enrage', 'beam', 'seal', 'halffield', 'meteor', 'cinch'],
    'boss-molt': ['slam', 'barrage', 'mines', 'enrage', 'beam', 'spiral', 'halffield', 'rush', 'cinch'],
}


def body_of(sheet):
    """시트의 첫 프레임 알파 bbox → (w, h, offsetX, offsetY)"""
    im = Image.open(os.path.join(PUB, sheet['filePath'])).convert('RGBA')
    fw, fh = sheet['frameWidth'], sheet['frameHeight']
    idx = sheet.get('frameStart', 0)
    best = None
    # 첫 3프레임의 합집합 — 1프레임만 보면 눈 감은 프레임 등에서 어긋난다
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for k in range(3):
        col = (idx + k) * fw
        if col + fw > im.width:
            break
        arr = np.asarray(im.crop((col, 0, col + fw, fh)))
        ys, xs = np.where(arr[..., 3] > 16)
        if len(xs) == 0:
            continue
        x0 = min(x0, int(xs.min())); y0 = min(y0, int(ys.min()))
        x1 = max(x1, int(xs.max())); y1 = max(y1, int(ys.max()))
        best = True
    if not best:
        return fw, fh, 0, 0
    return x1 - x0 + 1, y1 - y0 + 1, x0, y0


def sheet_entry(eid, anim, frames, fw, fh):
    return {
        'filePath': f'enemy/pack2/{eid}_{anim}.png',
        'textureKey': f'p2-{eid}-{anim}',
        'frameWidth': fw, 'frameHeight': fh,
        'frameStart': 0, 'frameEnd': frames - 1,
        'frameRate': RATE[anim], 'repeat': REPEAT[anim],
    }


def main():
    catalog = json.load(open(CAT))
    report = []

    for entry in catalog:
        eid = entry.get('id')
        is_boss = bool(entry.get('isBoss'))
        is_mini = bool(entry.get('isMiniboss'))
        if not (is_boss or is_mini):
            continue

        before = dict(entry.get('size') or {})

        # 1) 새 시트 배선
        if eid in NEW_SHEETS:
            spec = SPECS[eid]
            fw, fh = spec['frame']
            entry['spriteType'] = 'separate'
            entry['facing'] = NEW_SHEETS[eid]
            entry['spritesheets'] = {
                anim: sheet_entry(eid, anim, n, fw, fh)
                for anim, n in spec['anims'].items()
            }

        idle = (entry.get('spritesheets') or {}).get('idle')
        if not idle:
            continue

        # 2) 몸통 기준 균일 크기
        bw, bh, ox, oy = body_of(idle)
        gm = math.sqrt(bw * bh)
        target = BOSS_BODY_GM if is_boss else MINI_BODY_GM
        k = target / max(1.0, gm)
        fw, fh = idle['frameWidth'], idle['frameHeight']
        entry['size'] = {'width': round(fw * k), 'height': round(fh * k)}

        # 3) 히트박스 = 몸통 bbox (프레임 좌표, 스케일은 런타임이 곱한다)
        entry['hitbox'] = {'width': bw, 'height': bh, 'offsetX': ox, 'offsetY': oy}

        # 4) 스킬 풀
        if eid in SKILL_KITS:
            entry['skillKit'] = SKILL_KITS[eid]

        report.append((
            'BOSS' if is_boss else 'MINI', eid,
            f"{before.get('width')}x{before.get('height')}",
            f"{entry['size']['width']}x{entry['size']['height']}",
            f'{bw * k:.0f}x{bh * k:.0f}',
            round(math.sqrt(bw * k * bh * k)),
            ','.join(sorted((entry.get('spritesheets') or {}).keys())),
        ))

    with open(CAT, 'w') as fh:
        json.dump(catalog, fh, ensure_ascii=False, indent=2)
        fh.write('\n')

    report.sort()
    print('%-5s %-22s %-10s %-10s %-10s %-4s %s' % ('kind', 'id', 'size(전)', 'size(후)', '몸통(후)', 'gm', 'anims'))
    for row in report:
        print('%-5s %-22s %-10s %-10s %-10s %-4s %s' % row)


if __name__ == '__main__':
    main()
