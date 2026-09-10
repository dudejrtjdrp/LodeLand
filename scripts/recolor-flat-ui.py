# Flat UI 팩 → LODELAND 강철 톤 재염색 (2026-08-31)
# 원본: ~/Downloads/Complete_UI_Essential_Pack_Free/01_Flat_Theme/Sprites
# 출력: public/ui/flat/ (기존 파일명 유지 — 코드의 uf-* 키는 그대로)
#
# 규칙:
#  - 잉크 외곽선(#000)은 유지, 크림 본체는 식은 쇠, 주황 보더는 담금 청,
#    파랑 계열은 담금 청, 주황/적 슬롯은 잉걸/녹.
#  - 런타임 setTint 로 임의 색을 입히는 스프라이트(select_*, fill_f, icon_point)는
#    무채색 밝은 램프로 중립화해 틴트 색이 순수하게 나오게 한다.
# 실행: python3 scripts/recolor-flat-ui.py <원본Sprites경로> <출력경로>

import sys, os
from PIL import Image

SRC = sys.argv[1]
DST = sys.argv[2]

def hx(s):
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

# ── 전역 팔레트 맵 (팩 37색 전수)
GLOBAL = {
    '000000': '000000',  # 잉크 외곽선
    'ffffff': 'dfe6ea',
    # 크림(버튼/배너/인풋 본체) → 식은 쇠
    'fffdf5': '1d2329',
    'e5e0cc': '171c22',
    'cac3a4': '14181d',
    # 웜 옐로/오렌지 보더 → 담금 청 포인트
    'ffd156': '4a7d94',
    'ffc579': '3f6b7d',
    'ffa756': '52869e',
    # 주황 본체(마커/슬롯/프레임) → 잉걸
    'ffa61f': 'ad5420',
    'e36f1f': '6e3012',
    'ff6e1f': '9c4030',
    'e33e1f': '6b2517',
    'e7a342': 'd9702e',  # fill_e → HP 잉걸
    # 회색 프레임 → 강판
    'adb7c4': '1b2026',
    'dfe5e9': '2c343c',
    '808ba1': '10141a',
    '8f98ae': '39424b',
    'b9c3cf': '53616d',
    '6a718f': '232a31',
    # 파랑 → 담금 청
    '267ae9': '3f6b7d',
    '4fb8ff': '6fa7bd',
    '1b4ab9': '29485a',
    '1b71b9': '35586b',
    '4f86ed': '527f95',
    '335ccf': '33556b',
    '263a65': '1d3341',
    '26abe9': '5f9bb0',
    '4fe4ff': '8fc3d8',
    # 상태 아이콘/fill
    '14ee14': '84b04a',
    '58d162': '9bc25b',
    '289445': '5c8a2e',
    'ee0004': 'd95f4d',
    'f04040': 'e0654d',
    'bb1120': '8a2c22',
    'a40003': '6e3012',
    '07453d': '2f4f48',
    '262626': '0e1114',
}

# ── 파일별 오버라이드
# 틴트 베이스(무채색화): 코드가 setTint 로 등급/속성/강조색을 곱한다
NEUTRAL = {
    'fffdf5': 'e8edf0',
    'ffc579': 'aab4bb',
    'ffd156': 'c8d2d8',
    'ffa756': 'b7c1c9',
    'e5e0cc': 'dfe3e6',
    'ffa61f': '9aa8b2',
    'e36f1f': '6b7680',
    '000000': '000000',
}
OVERRIDES = {
    # 셀렉트 코너 4프레임 — 등급/속성/선택색 틴트 베이스
    'UI_Flat_Select01a_1.png': NEUTRAL,
    'UI_Flat_Select01a_2.png': NEUTRAL,
    'UI_Flat_Select01a_3.png': NEUTRAL,
    'UI_Flat_Select01a_4.png': NEUTRAL,
    'UI_Flat_Select02a_1.png': NEUTRAL,
    'UI_Flat_Select02a_2.png': NEUTRAL,
    'UI_Flat_Select02a_3.png': NEUTRAL,
    'UI_Flat_Select02a_4.png': NEUTRAL,
    # 범용 fill 스트립(divider/밴드/바 틴트 베이스) + XP 은백 fill
    'UI_Flat_BarFill01f.png': {'e5e0cc': 'dfe6ea'},
    # 작은 점 아이콘 — 악센트 틴트 베이스
    'UI_Flat_IconPoint01a.png': NEUTRAL,
    'UI_Flat_IconLine01a.png': NEUTRAL,
    # 고스트 슬롯(반투명) — 어두운 월드 위 윤곽이 살아야 한다: 밝은 냉회/청/잉걸 유지
    'UI_Flat_FrameSlot01c.png': {'adb7c4': '93a5b1', 'dfe5e9': 'c4d2da', '808ba1': '6f8593'},
    'UI_Flat_FrameSlot02c.png': {'267ae9': '6fa7bd', '4fb8ff': '8fc3d8', '1b4ab9': '527f95'},
    'UI_Flat_FrameSlot03c.png': {'ffa61f': 'c67a3a', 'e36f1f': '9a5526'},
}

# 출력 파일명 매핑 (반입 시 쓴 이름 규약과 동일해야 한다)
NAMES = {}
NAMES['UI_Flat_Frame01a.png'] = 'frame_gray.png'
NAMES['UI_Flat_Frame02a.png'] = 'frame_blue.png'
NAMES['UI_Flat_Frame03a.png'] = 'frame_orange.png'
NAMES['UI_Flat_FrameSlot01a.png'] = 'slot_gray.png'
NAMES['UI_Flat_FrameSlot01b.png'] = 'slot_slate.png'
NAMES['UI_Flat_FrameSlot01c.png'] = 'slot_dark.png'
NAMES['UI_Flat_FrameSlot02a.png'] = 'slot_blue.png'
NAMES['UI_Flat_FrameSlot02b.png'] = 'slot_cyan.png'
NAMES['UI_Flat_FrameSlot02c.png'] = 'slot_navy.png'
NAMES['UI_Flat_FrameSlot03a.png'] = 'slot_orange.png'
NAMES['UI_Flat_FrameSlot03b.png'] = 'slot_red.png'
NAMES['UI_Flat_FrameSlot03c.png'] = 'slot_brown.png'
for i in (1, 2, 3, 4):
    NAMES[f'UI_Flat_Button01a_{i}.png'] = f'btn_{i}.png'
    NAMES[f'UI_Flat_Button02a_{i}.png'] = f'btn2_{i}.png'
NAMES['UI_Flat_ButtonCross01a.png'] = 'btn_cross.png'
NAMES['UI_Flat_ButtonCheck01a.png'] = 'btn_check.png'
NAMES['UI_Flat_ButtonPlay01a.png'] = 'btn_play.png'
NAMES['UI_Flat_ButtonArrow01a.png'] = 'btn_arrow.png'
NAMES['UI_Flat_ButtonMinus01a.png'] = 'btn_minus.png'
NAMES['UI_Flat_ButtonPlus01a.png'] = 'btn_plus.png'
NAMES['UI_Flat_Bar01a.png'] = 'bar_cream.png'
NAMES['UI_Flat_Bar02a.png'] = 'bar_ticks.png'
NAMES['UI_Flat_Bar05a.png'] = 'bar_track.png'
for c in 'abcdefg':
    NAMES[f'UI_Flat_BarFill01{c}.png'] = f'fill_{c}.png'
for i in (1, 2, 3, 4):
    NAMES[f'UI_Flat_Banner0{i}a.png'] = f'banner_{i}.png'
    NAMES[f'UI_Flat_Select01a_{i}.png'] = f'select_{i}.png'
NAMES['UI_Flat_FrameMarker01a.png'] = 'marker_gray.png'
NAMES['UI_Flat_FrameMarker02a.png'] = 'marker_blue.png'
NAMES['UI_Flat_FrameMarker03a.png'] = 'marker_orange.png'
NAMES['UI_Flat_IconArrow01a.png'] = 'icon_arrow.png'
NAMES['UI_Flat_IconCheck01a.png'] = 'icon_check.png'
NAMES['UI_Flat_IconCross01a.png'] = 'icon_cross.png'
NAMES['UI_Flat_IconPoint01a.png'] = 'icon_point.png'
NAMES['UI_Flat_IconDropdown01a.png'] = 'icon_dropdown.png'
NAMES['UI_Flat_IconLine01a.png'] = 'icon_line.png'
NAMES['UI_Flat_InputField01a.png'] = 'input.png'

os.makedirs(DST, exist_ok=True)
missed = set()
for src_name, out_name in sorted(NAMES.items()):
    path = os.path.join(SRC, src_name)
    im = Image.open(path).convert('RGBA')
    table = dict(GLOBAL)
    table.update(OVERRIDES.get(src_name, {}))
    mapping = {hx(k): hx(v) for k, v in table.items()}
    px = im.load()
    for yy in range(im.height):
        for xx in range(im.width):
            r, g, b, a = px[xx, yy]
            if a == 0:
                continue
            to = mapping.get((r, g, b))
            if to is None:
                missed.add('#%02x%02x%02x' % (r, g, b))
                continue
            px[xx, yy] = (to[0], to[1], to[2], a)
    im.save(os.path.join(DST, out_name))

print('recolored', len(NAMES), 'files ->', DST)
print('unmapped colors:', sorted(missed) if missed else 'none')
