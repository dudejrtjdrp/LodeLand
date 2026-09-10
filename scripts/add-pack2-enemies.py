#!/usr/bin/env python3
"""pack2 신규 적 10종을 enemyCatalog 에 추가하고 waveTable 풀에 편입한다 (재실행 안전)."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(ROOT, 'src/data/enemyCatalog.json')
WT = os.path.join(ROOT, 'src/data/waveTable.json')


def sheet(eid, anim, frames, w, h, rate, repeat):
    return {
        'filePath': f'enemy/pack2/{eid}_{anim}.png',
        'textureKey': f'p2-{eid}-{anim}',
        'frameWidth': w, 'frameHeight': h,
        'frameStart': 0, 'frameEnd': frames - 1,
        'frameRate': rate, 'repeat': repeat,
    }


DIM = {
    'boss-abyss-demon': {'idle': (12, 139, 129), 'hit': (5, 139, 129), 'death': (22, 139, 129)},
    'boss-minos': {'idle': (12, 128, 109)},
    'boss-frost-guardian': {'idle': (10, 191, 104), 'hit': (7, 191, 104), 'death': (16, 191, 104)},
    'mb-frost-golem': {'idle': (10, 70, 48), 'hit': (4, 70, 48), 'death': (13, 70, 48)},
    'mb-magma-golem': {'idle': (10, 70, 48), 'hit': (4, 70, 48), 'death': (13, 70, 48)},
    'demonling': {'idle': (8, 46, 31), 'hit': (4, 46, 31), 'death': (4, 46, 31)},
    'blood-horror': {'idle': (8, 31, 25), 'hit': (4, 31, 25), 'death': (4, 31, 25)},
    'duskbat': {'idle': (9, 44, 54), 'hit': (5, 44, 54), 'death': (12, 44, 54)},
    'verdrat': {'idle': (6, 32, 18), 'death': (6, 32, 18)},
    'boss-molt': {'idle': (6, 128, 150), 'mud': (6, 128, 150), 'ice': (6, 128, 150),
                  'flying': (6, 128, 150), 'hit': (2, 128, 150)},
}


def sheets(eid, spec):
    return {anim: sheet(eid, anim, *DIM[eid][anim], rate, repeat) for anim, (rate, repeat) in spec.items()}


NEW = [
    {
        'id': 'boss-abyss-demon', 'name': 'Abyss Demon', 'hp': 14000, 'speed': 60, 'damage': 95,
        'size': {'width': 168, 'height': 156}, 'color': '#1f2937', 'critChance': 0.2, 'critDamageMultiplier': 2.2,
        'xpValue': 5200, 'isBoss': True, 'knockbackResist': 0.85, 'healthBarWidth': 90,
        'spriteType': 'separate', 'goldValue': 320, 'goldChance': 1, 'facing': 'right',
        'traits': ['bloodswollen', 'hollow', 'unstoppable-core'],
        'lore': '심연에서 건져 올린 녹물이 검을 쥐는 법을 배웠다.',
        'spritesheets': sheets('boss-abyss-demon', {'idle': (10, -1), 'hit': (14, 0), 'death': (16, 0)}),
    },
    {
        'id': 'boss-minos', 'name': 'Minos', 'hp': 9500, 'speed': 72, 'damage': 78,
        'size': {'width': 160, 'height': 136}, 'color': '#1f2937', 'critChance': 0.18, 'critDamageMultiplier': 2.0,
        'xpValue': 4200, 'isBoss': True, 'knockbackResist': 0.85, 'healthBarWidth': 84,
        'spriteType': 'separate', 'goldValue': 260, 'goldChance': 1, 'facing': 'left',
        'traits': ['bloodswollen', 'unstoppable-core'],
        'behavior': {'type': 'charger', 'windupMs': 900, 'dashSpeed': 520, 'dashDurationMs': 700,
                     'dashCooldownMs': 5200, 'dashRange': 420},
        'lore': '미궁이 무너진 뒤에도 뿔은 길을 기억한다.',
        'spritesheets': sheets('boss-minos', {'idle': (11, -1)}),
    },
    {
        'id': 'boss-frost-guardian', 'name': 'Frost Guardian', 'hp': 11000, 'speed': 55, 'damage': 82,
        'size': {'width': 172, 'height': 94}, 'color': '#1f2937', 'critChance': 0.15, 'critDamageMultiplier': 2.0,
        'xpValue': 4600, 'isBoss': True, 'knockbackResist': 0.9, 'healthBarWidth': 90,
        'spriteType': 'separate', 'goldValue': 280, 'goldChance': 1, 'facing': 'left',
        'traits': ['frostborn', 'sealed-veins'],
        'lore': '냉맥 최심부를 지키던 것 — 심장이 아직 얼음이다.',
        'spritesheets': sheets('boss-frost-guardian', {'idle': (10, -1), 'hit': (14, 0), 'death': (14, 0)}),
    },
    {
        'id': 'mb-frost-golem', 'name': 'Frost Golem', 'hp': 2600, 'speed': 60, 'damage': 50,
        'size': {'width': 104, 'height': 71}, 'color': '#1f2937', 'critChance': 0.15, 'critDamageMultiplier': 1.9,
        'xpValue': 1500, 'isMiniboss': True, 'knockbackResist': 0.7, 'healthBarWidth': 70,
        'spriteType': 'separate', 'goldValue': 90, 'goldChance': 1, 'facing': 'left',
        'traits': ['frostborn', 'unstoppable-core'],
        'lore': '냉기가 뭉쳐 걷기 시작한 서리 결정.',
        'spritesheets': sheets('mb-frost-golem', {'idle': (10, -1), 'hit': (14, 0), 'death': (14, 0)}),
    },
    {
        'id': 'mb-magma-golem', 'name': 'Magma Golem', 'hp': 2900, 'speed': 58, 'damage': 55,
        'size': {'width': 104, 'height': 71}, 'color': '#1f2937', 'critChance': 0.15, 'critDamageMultiplier': 1.9,
        'xpValue': 1600, 'isMiniboss': True, 'knockbackResist': 0.7, 'healthBarWidth': 70,
        'spriteType': 'separate', 'goldValue': 100, 'goldChance': 1, 'facing': 'left',
        'traits': ['emberflesh', 'sealed-veins'],
        'lore': '광재 속 잉걸이 여태 식지 않은 채 뭉쳐 다닌다.',
        'spritesheets': sheets('mb-magma-golem', {'idle': (10, -1), 'hit': (14, 0), 'death': (14, 0)}),
    },
    {
        'id': 'demonling', 'name': 'Demonling', 'hp': 150, 'speed': 88, 'damage': 26,
        'size': {'width': 66, 'height': 45}, 'color': '#1f2937', 'critChance': 0.12, 'critDamageMultiplier': 1.8,
        'xpValue': 130, 'spriteType': 'separate', 'goldValue': 4, 'goldChance': 0.4, 'facing': 'right',
        'traits': ['hollow'],
        'lore': '심이 빈 자리에 잿불만 채워 넣은 하급 데몬.',
        'spritesheets': sheets('demonling', {'idle': (12, -1), 'hit': (14, 0), 'death': (12, 0)}),
    },
    {
        'id': 'blood-horror', 'name': 'Blood Horror', 'hp': 230, 'speed': 74, 'damage': 30,
        'size': {'width': 62, 'height': 50}, 'color': '#1f2937', 'critChance': 0.14, 'critDamageMultiplier': 1.9,
        'xpValue': 180, 'spriteType': 'separate', 'goldValue': 6, 'goldChance': 0.5, 'facing': 'right',
        'traits': ['bloodswollen'], 'affixes': ['vampiric'],
        'lore': '삼킨 심혈이 겉으로 배어 나온 살덩이.',
        'spritesheets': sheets('blood-horror', {'idle': (11, -1), 'hit': (14, 0), 'death': (12, 0)}),
    },
    {
        'id': 'duskbat', 'name': 'Duskbat', 'hp': 42, 'speed': 168, 'damage': 14,
        'size': {'width': 50, 'height': 61}, 'color': '#1f2937', 'critChance': 0.1, 'critDamageMultiplier': 1.6,
        'xpValue': 55, 'spriteType': 'separate', 'goldValue': 1, 'goldChance': 0.3, 'facing': 'right',
        'traits': ['featherlight', 'nimble'],
        'lore': '어스름을 마시고 자란 날개 — 떼로 몰리면 하늘이 좁아진다.',
        'spritesheets': sheets('duskbat', {'idle': (12, -1), 'hit': (16, 0), 'death': (14, 0)}),
    },
    {
        'id': 'verdrat', 'name': 'Verdrat', 'hp': 26, 'speed': 145, 'damage': 10,
        'size': {'width': 44, 'height': 25}, 'color': '#1f2937', 'critChance': 0.08, 'critDamageMultiplier': 1.5,
        'xpValue': 24, 'spriteType': 'separate', 'goldValue': 1, 'goldChance': 0.25, 'facing': 'right',
        'traits': ['corroded'],
        'lore': '녹가루를 갉아먹고 초록으로 물든 쥐.',
        'spritesheets': sheets('verdrat', {'idle': (12, -1), 'death': (14, 0)}),
    },
    {
        'id': 'boss-molt', 'name': 'The Molting', 'hp': 40000, 'speed': 75, 'damage': 110,
        'size': {'width': 126, 'height': 148}, 'color': '#1f2937', 'critChance': 0.2, 'critDamageMultiplier': 2.2,
        'xpValue': 20000, 'isBoss': True, 'knockbackResist': 1, 'healthBarWidth': 96,
        'spriteType': 'separate', 'goldValue': 1500, 'goldChance': 1, 'facing': 'left',
        'traits': ['hollow', 'corroded'],
        'lore': '허물을 벗을 때마다 다른 것이 걸어 나온다. 가슴의 초록 심장만 그대로다.',
        'phases': [
            {'hpPct': 1.01, 'anim': 'idle', 'name': '본체', 'traits': ['hollow', 'corroded'], 'skills': ['slam']},
            {'hpPct': 0.75, 'anim': 'mud', 'name': '진흙 탈각', 'traits': ['soaked', 'sealed-veins'], 'skills': ['slam', 'barrage']},
            {'hpPct': 0.5, 'anim': 'ice', 'name': '빙결 탈각', 'traits': ['frostborn', 'unstoppable-core'], 'skills': ['barrage', 'beam']},
            {'hpPct': 0.25, 'anim': 'flying', 'name': '비상 탈각', 'traits': ['featherlight', 'nimble'],
             'skills': ['beam', 'barrage', 'slam'], 'speedMult': 1.35},
        ],
        'spritesheets': sheets('boss-molt', {'idle': (7, -1), 'mud': (7, -1), 'ice': (7, -1), 'flying': (8, -1), 'hit': (10, 0)}),
    },
]


def main():
    cat = json.load(open(CAT))
    new_ids = {e['id'] for e in NEW}
    cat = [e for e in cat if e['id'] not in new_ids]
    cat.extend(NEW)
    json.dump(cat, open(CAT, 'w'), ensure_ascii=False, indent=2)
    print('catalog:', len(cat), 'entries')

    # waveTable 풀 편입: (id, weight, 시작 bracket 인덱스)
    wt = json.load(open(WT))
    waves = wt['waves']
    ADD = [('verdrat', 4, 1), ('duskbat', 3, 3), ('demonling', 3, 7), ('blood-horror', 2, 9)]
    for wave_index, wave in enumerate(waves):
        pool = wave.setdefault('pool', [])
        have = {p['id'] for p in pool}
        for eid, weight, start in ADD:
            if wave_index >= start and eid not in have:
                pool.append({'id': eid, 'weight': weight})
    json.dump(wt, open(WT, 'w'), ensure_ascii=False, indent=2)
    print('waveTable brackets:', len(waves))
    for i, w in enumerate(waves[:12]):
        print(' ', i, [p['id'] for p in w.get('pool', [])])


if __name__ == '__main__':
    main()
