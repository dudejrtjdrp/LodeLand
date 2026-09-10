#!/usr/bin/env python3
"""타이틀 UI 목업 2장에서 실제 UI 텍스처를 잘라 낸다 → public/ui/title/

목업은 1672×941 두 장(기본 상태 / '출격' 강조 상태). 좌표는 전부 그 해상도 기준이며,
아래 상수는 목업을 픽셀 단위로 훑어 얻은 값이다 (버튼 프레임선·모서리 장식 폭 등).

만들어지는 것:

  btn.png / btn-hi.png   메뉴 버튼(기본 / 강조) — **가로 3슬라이스용으로 재조립**한다.
                         목업 버튼 한가운데에는 아이콘과 글자가 박혀 있어 그대로 자르면 못 쓴다.
                         왼쪽 마구리 + 글자 없는 깨끗한 세로 2열 + 오른쪽 마구리로 다시 붙여
                         가운데만 늘어나게 만든다 (Phaser nineslice 의 top/bottom=0).
  mark.png               강조 줄 옆 꺾쇠 지시자 (오른쪽용 — 왼쪽은 코드에서 뒤집는다)
  logo.png               LODELAND 워드마크(장식선 + 부제 포함)
  icon-*.png             메뉴 아이콘 5종 (은색 원본 — 강조 시 코드에서 주황 틴트)
  pill.png / coin.png / plus.png   재화 알약 프레임(좌우 대칭 재조립) · 금화 · 더하기 버튼
  gear.png               설정 톱니 버튼
  corner.png             화면 프레임 귀퉁이 (좌상단 기준 — 나머지 셋은 코드에서 뒤집는다)

버튼과 알약은 **불투명**하게 둔다 (배경 일러스트 위에서 글자가 읽혀야 한다).
나머지(로고·아이콘·지시자·톱니·귀퉁이)와 강조 버튼의 바깥 발광은 목업의 납작한
배경색을 걷어 내 알파로 바꾼다 — 검정 매트 해제와 같은 계산이다.

Run: python3 scripts/slice-title-ui.py <normal.png> <hover.png>
"""
import sys
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'ui', 'title')

BG = np.array([7, 12, 21], dtype=float)        # 목업 페이지 배경 (빈 곳에서 채취)
BTN_BG = np.array([16, 24, 33], dtype=float)   # 버튼 **안쪽** 바탕 — 아이콘은 여기서 오려 낸다

# ── 기본 버튼: 5줄이 x 51..477 · 윗변 269/369/470/570/670 · 높이 94
BTN_X0, BTN_X1 = 51, 477
BTN_TOPS = [269, 369, 470, 570, 670]
BTN_H = 94
BTN_CAP = 48          # 모서리 장식은 프레임선에서 안쪽 ~25px — 48이면 여유롭게 품고 아이콘(96~)은 안 건드린다
BTN_CLEAN = 400       # 글자 오른쪽의 빈 세로 열

# ── 강조 버튼: 주황 프레임이 x 43..489 · y 365..467.
#
# 여백 폭이 위아래(16)와 좌우(3)로 다른 이유: 좌우 바로 옆에는 꺾쇠 지시자가 있어
# 3px 만 넘겨도 딸려 온다. 위아래는 이웃 버튼(은색)이 걸리지만 그건 아래에서
# "주황이 아닌 화소는 지운다"로 걸러 낼 수 있다.
HI_MX, HI_MY = 3, 16
HI_X0, HI_X1 = 43 - HI_MX, 489 + HI_MX
HI_Y0, HI_Y1 = 365 - HI_MY, 467 + HI_MY
HI_CAP = BTN_CAP + HI_MX
HI_CLEAN = 430


def unmatte(img, bg=BG):
    """납작한 배경색을 걷어 알파로 바꾼다 (검정 매트 해제와 같은 계산).

    밝은 글리프(로고·아이콘·톱니)에만 쓴다. 어두운 몸통에 쓰면 알파로 나눈 값이
    터져 색이 하얗게 뜬다 — 그런 곳은 keyed() 를 쓴다.

    bg 는 **오려 낸 자리의 실제 바탕색**이어야 한다. 버튼 안에서 오린 아이콘에
    페이지 배경색을 쓰면 차이만큼 알파가 남아 아이콘 뒤에 옅은 네모가 비친다.
    """
    a = np.array(img.convert('RGB')).astype(float)
    d = np.clip(a - bg, 0, 255)
    alpha = np.clip(d.max(axis=2) / 255.0 * 1.12, 0, 1)
    safe = np.maximum(alpha, 1e-3)[:, :, None]
    rgb = np.clip(d / safe, 0, 255)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def keyed(img, gain=3.0):
    """배경만 투명하게 뚫고 색은 원본 그대로 둔다 (발광처럼 어두운 화소가 섞인 곳)."""
    a = np.array(img.convert('RGB')).astype(float)
    d = np.clip(a - BG, 0, 255)
    alpha = np.clip(d.max(axis=2) / 255.0 * gain, 0, 1)
    out = np.dstack([a, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def three_slice(src, x0, x1, y0, y1, cap, clean_x, keep_opaque=None):
    """좌우 마구리 + 깨끗한 중앙 2열로 재조립한 가로 3슬라이스 소스.

    keep_opaque 가 주어지면 (그 사각형 안쪽, 재조립 좌표계) 알파를 255 로 못박는다 —
    강조 버튼의 몸통은 불투명해야 글자가 읽히고, 바깥 발광만 알파로 남는다.
    """
    left = src.crop((x0, y0, x0 + cap, y1))
    right = src.crop((x1 - cap, y0, x1, y1))
    mid = src.crop((clean_x, y0, clean_x + 2, y1))
    out = Image.new('RGBA', (cap * 2 + 2, y1 - y0))
    out.paste(left, (0, 0))
    out.paste(mid, (cap, 0))
    out.paste(right, (cap + 2, 0))
    if keep_opaque:
        arr = np.array(out)
        ix0, iy0, ix1, iy1 = keep_opaque
        arr[iy0:iy1, ix0:ix1, 3] = 255
        out = Image.fromarray(arr, 'RGBA')
    return out


def main():
    normal = Image.open(sys.argv[1]).convert('RGBA')
    hover = Image.open(sys.argv[2]).convert('RGBA')
    os.makedirs(OUT, exist_ok=True)

    def save(img, name):
        img.save(os.path.join(OUT, name))
        print(f'  {name}  {img.size[0]}x{img.size[1]}')

    # ── 기본 버튼 (3번째 줄이 오른쪽 여백이 가장 넓다)
    top = BTN_TOPS[2]
    save(three_slice(normal, BTN_X0, BTN_X1, top, top + BTN_H, BTN_CAP, BTN_CLEAN), 'btn.png')

    # ── 강조 버튼 — 바깥 발광만 알파로 뚫고 몸통(여백 안쪽)은 불투명
    hi = three_slice(keyed(hover), HI_X0, HI_X1, HI_Y0, HI_Y1, HI_CAP, HI_CLEAN,
                     keep_opaque=(HI_MX, HI_MY, HI_CAP * 2 + 2 - HI_MX, (HI_Y1 - HI_Y0) - HI_MY))
    # 위아래 여백에 딸려 온 이웃 버튼(은색)을 지운다 — 발광은 주황이므로 R-B 로 갈린다
    arr = np.array(hi)
    band = np.zeros(arr.shape[:2], bool)
    band[:HI_MY, :] = True
    band[-HI_MY:, :] = True
    silver = (arr[:, :, 0].astype(int) - arr[:, :, 2].astype(int)) < 25
    arr[band & silver, 3] = 0
    save(Image.fromarray(arr, 'RGBA'), 'btn-hi.png')

    # ── 좌우 지시자. 목업에서 둘은 **서로 다른 모양**이다 —
    # 왼쪽은 꽉 찬 삼각형 ◀, 오른쪽은 속이 빈 꺾쇠 ❯. 뒤집어 쓰면 안 된다.
    save(keyed(hover.crop((12, 396, 44, 436)), gain=2.4), 'mark-l.png')
    save(keyed(hover.crop((492, 394, 530, 438)), gain=2.4), 'mark-r.png')

    # ── 로고
    save(unmatte(normal.crop((520, 40, 1160, 220))), 'logo.png')

    # ── 메뉴 아이콘 5종 (버튼 안쪽 프레임선이 딸려오지 않게 좁게)
    for name, t in zip(['icon-continue', 'icon-sortie', 'icon-upgrade', 'icon-settings', 'icon-codex'],
                       BTN_TOPS):
        save(unmatte(normal.crop((102, t + 14, 172, t + 82)), BTN_BG), f'{name}.png')

    # ── 재화 알약: 왼쪽 마구리(프레임 + 금화)를 그대로 쓰고, 오른쪽 끝은 프레임만 뒤집어 붙인다.
    # 목업 오른쪽 끝에는 '+' 구매 버튼이 박혀 있는데 게임에는 재화 구매가 없어 뺀다.
    # 오른쪽 마구리를 1402 에서 끊는 이유: 금화가 x 1404 부터 시작한다. 1px 만 물려도
    # 뒤집힌 마구리의 첫 열에 금색이 섞이고, 그 열이 나인슬라이스 중앙 옆에서
    # 선형 보간으로 번져 알약 한가운데에 금색 띠가 그어진다.
    cap_l = normal.crop((1385, 60, 1440, 114))   # 프레임 왼끝 + 금화
    cap_r = normal.crop((1385, 60, 1402, 114)).transpose(Image.FLIP_LEFT_RIGHT)
    mid = normal.crop((1435, 60, 1437, 114))
    pill = Image.new('RGBA', (cap_l.width + 2 + cap_r.width, 54))
    pill.paste(cap_l, (0, 0))
    pill.paste(mid, (cap_l.width, 0))
    pill.paste(cap_r, (cap_l.width + 2, 0))
    save(pill, 'pill.png')

    # ── 설정 톱니 · 화면 귀퉁이
    save(unmatte(normal.crop((1572, 54, 1650, 124))), 'gear.png')
    save(unmatte(normal.crop((4, 4, 50, 50))), 'corner.png')


if __name__ == '__main__':
    main()
