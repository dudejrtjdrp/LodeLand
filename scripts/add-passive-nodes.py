#!/usr/bin/env python3
"""스킬 트리에 패시브 노드 24개(갈래당 2) 추가 — 2026-09-06

배경: 능동 스킬 등록이 10개로 제한되면서(core/skillHotbar.MAX_REGISTERED_SKILLS)
남는 스킬 포인트가 갈 곳이 필요해졌다. 갈래마다 티어 3·4 에 패시브 두 개를 더해
"11번째 능동을 배우는 대신 이 갈래를 더 파는" 선택지를 만든다.

규칙
 - **기존에 배선된 패시브 키만** 쓴다 (logic/skillTree.ts 의 SkillPassiveSpec 48종).
   새 키를 만들면 aggregateTreeModsLeveled·적용부·표시부를 전부 건드려야 한다.
 - 누적 방식이 `+=` 이거나 곱셈인 키만 고른다. Math.max/Math.min 으로 합쳐지는 키
   (huntMark·frostAura·shatter·executeThreshold·counterStorm·lastStand 등)는
   노드를 더 놔도 값이 안 올라가서 함정 선택지가 된다.
 - cost 2 → maxLevel 20 (logic/skillTree.maxLevelOf = cost × 10).
 - requires 는 같은 갈래의 기존 노드 — 갈래를 건너뛰는 지름길을 만들지 않는다.

실행: python3 scripts/add-passive-nodes.py   (멱등 — 이미 있으면 건너뛴다)
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'src', 'data', 'skillTree.json')

# (branch, id, 이름, 아이콘, tier, cost, requires, desc, passive, lore)
NEW = [
    # ── 사냥
    ('hunt', 'hunt-8', '매의 눈', 'g-eye', 3, 2, ['hunt-5'],
     '치명타 확률 +6%', {'critChanceAdd': 0.06},
     '눈이 먼저 닿은 곳에 날이 늦게 닿을 뿐이다.'),
    ('hunt', 'hunt-9', '잔혹한 마무리', 'g-fang', 4, 2, ['hunt-8'],
     '치명타 피해 +20%', {'critDamageAdd': 0.20},
     '사냥은 무는 순간이 아니라 놓지 않는 순간에 끝난다.'),

    # ── 수호
    ('guard', 'guard-8', '무쇠 살갗', 'g-shield', 3, 2, ['guard-4'],
     '방어 +6', {'defenseAdd': 6},
     '맞아도 되는 자리를 아는 것도 기술이다.'),
    ('guard', 'guard-9', '버티는 몸', 'g-rekindle', 4, 2, ['guard-8'],
     '최대 체력 +12%', {'maxHpMult': 1.12},
     '무너지지 않는 것은 단단해서가 아니라 두꺼워서다.'),

    # ── 기동
    ('swift', 'swift-8', '가벼운 걸음', 'g-boot', 3, 2, ['swift-3'],
     '이동 속도 +6%', {'moveSpeedMult': 1.06},
     '먼저 도착한 자가 먼저 고른다.'),
    ('swift', 'swift-9', '숨 고르기', 'g-hourglass', 4, 2, ['swift-8'],
     '대시 재사용 -15%', {'dashCooldownMult': 0.85},
     '들이쉰 만큼만 다시 뛸 수 있다.'),

    # ── 공명
    ('resonance', 'res-7', '빠른 공명', 'g-spark', 3, 2, ['res-1'],
     '필살기 게이지 충전 +20%', {'ultChargeMult': 1.20},
     '울림은 쌓이는 것이지 기다리는 것이 아니다.'),
    ('resonance', 'res-8', '깊은 울림', 'g-spark', 4, 2, ['res-7'],
     '필살기 피해 +25%', {'ultDamageAdd': 0.25},
     '한 번의 울림이 길수록 벽은 늦게 돌아온다.'),

    # ── 검술
    ('blade', 'blade-7', '벼린 날', 'g-blade', 3, 2, ['blade-3'],
     '공격력 +7%', {'damageMultAdd': 0.07},
     '숫돌에 준 시간은 전장에서 돌려받는다.'),
    ('blade', 'blade-8', '급소 베기', 'g-fang', 4, 2, ['blade-7'],
     '치명타 피해 +22%', {'critDamageAdd': 0.22},
     '같은 자리를 두 번 베면 그것은 다른 상처다.'),

    # ── 화로
    ('ember', 'ember-7', '잔불', 'g-rekindle', 3, 2, ['ember-3'],
     '초당 체력 재생 +0.8%', {'hpRegenAdd': 0.008},
     '꺼진 줄 알았던 자리에서 다시 붙는다.'),
    ('ember', 'ember-8', '따뜻한 강철', 'g-rekindle', 4, 2, ['ember-7'],
     '타격 회복 예산 +2.5%', {'healBudgetAdd': 0.025},
     '베어낸 만큼 데워진다.'),

    # ── 전술
    ('tactics', 'tac-7', '군더더기 없음', 'g-hourglass', 3, 2, ['tac-4'],
     '모든 스킬 재사용 -7%', {'skillCooldownMult': 0.93},
     '군더더기를 버린 손이 가장 빠르다.'),
    ('tactics', 'tac-8', '전장 학습', 'g-spark', 4, 2, ['tac-7'],
     '경험치 획득 +12%', {'xpMultAdd': 0.12},
     '살아 돌아온 자만이 배운다.'),

    # ── 재화
    ('fortune', 'for-7', '노획', 'g-el-gold', 3, 2, ['for-1'],
     '골드 획득 +12%', {'goldBonusAdd': 0.12},
     '전장에 떨어진 것은 이미 주인이 없다.'),
    ('fortune', 'for-8', '길한 조짐', 'g-el-gold', 4, 2, ['for-7'],
     '행운 +2', {'luckAdd': 2},
     '운은 자주 오는 자에게 자주 온다.'),

    # ── 천둥
    ('storm', 'storm-7', '먹구름', 'g-el-electric', 3, 2, ['storm-2'],
     '낙뢰 +1발', {'extraBolts': 1},
     '구름이 두꺼울수록 셈이 늦어질 뿐이다.'),
    ('storm', 'storm-8', '젖은 땅', 'g-el-ice', 4, 2, ['storm-7'],
     '감속된 적에게 주는 피해 +10%', {'slowedDamageAdd': 0.10},
     '발이 묶인 것은 이미 절반이 끝난 것이다.'),

    # ── 그림자
    ('shadow', 'shadow-7', '등 뒤', 'g-fang', 3, 2, ['shadow-2'],
     '치명타 피해 +25%', {'critDamageAdd': 0.25},
     '보이지 않는 쪽에 급소가 있다.'),
    ('shadow', 'shadow-8', '소리 없는 날', 'g-blade', 4, 2, ['shadow-7'],
     '공격력 +6%', {'damageMultAdd': 0.06},
     '소리를 줄인 만큼 날이 남는다.'),

    # ── 서리
    ('frost', 'frost-7', '살얼음', 'g-el-ice', 3, 2, ['frost-2'],
     '빙결된 적에게 주는 피해 +15%', {'frozenDamageAdd': 0.15},
     '굳은 것은 부서지기 위해 굳는다.'),
    ('frost', 'frost-8', '넓은 냉기', 'g-ring', 4, 2, ['frost-7'],
     '냉기 오라 반경 +20%', {'frostAuraRadiusMult': 1.20},
     '추위는 닿는 것이 아니라 번지는 것이다.'),

    # ── 광기
    ('rage', 'rage-7', '피 맛', 'g-el-blood', 3, 2, ['rage-2'],
     '체력이 낮을수록 공격력 +15%', {'lowHpRage': 0.15},
     '바닥을 본 자가 가장 세게 밀어 올린다.'),
    ('rage', 'rage-8', '광란', 'g-blade', 4, 2, ['rage-7'],
     '공격력 +6%', {'damageMultAdd': 0.06},
     '멈추는 법을 잊은 팔은 무겁지 않다.'),
]


def main():
    with open(PATH, encoding='utf-8') as f:
        data = json.load(f)
    existing = {n['id'] for n in data['nodes']}
    added = 0
    for branch, nid, name, icon, tier, cost, requires, desc, passive, lore in NEW:
        if nid in existing:
            continue
        missing = [r for r in requires if r not in existing]
        if missing:
            raise SystemExit(f'{nid}: 선행 노드 없음 {missing}')
        data['nodes'].append({
            'id': nid, 'branch': branch, 'tier': tier, 'name': name, 'icon': icon,
            'cost': cost, 'requires': requires, 'kind': 'passive',
            'desc': desc, 'passive': passive, 'lore': lore,
        })
        # 같은 실행 안에서 뒤 노드가 앞 노드를 선행으로 걸 수 있게 즉시 등록한다
        existing.add(nid)
        added += 1

    # 갈래 → 티어 → id 순으로 정렬해 두면 스킬 창 목록이 자연스러운 순서로 나온다
    order = {b['id']: i for i, b in enumerate(data['branches'])}
    data['nodes'].sort(key=lambda n: (order.get(n['branch'], 99), n['tier'], n['id']))

    with open(PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent='\t')
        f.write('\n')

    actives = sum(1 for n in data['nodes'] if n['kind'] == 'active')
    print(f'추가 {added}개 · 총 {len(data["nodes"])}노드 '
          f'(능동 {actives} / 패시브 {len(data["nodes"]) - actives})')


if __name__ == '__main__':
    main()
