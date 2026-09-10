"""스프라이트시트 프레임을 아틀라스 한 장에 담고 Phaser JSON Hash 를 뽑는다.

build-atlas.mjs 가 넘겨준 spec 을 받아 동작한다. 단독 실행할 일은 없다.

원칙: 프레임을 트리밍하지 않는다. 원본 격자 프레임을 그대로 복사해야
스프라이트 원점·표시 크기·히트박스가 한 픽셀도 바뀌지 않는다.
"""
import json
import sys
from PIL import Image

MAX_W = 2048
PAD = 2  # 이웃 프레임 색이 새어드는 것(bleeding) 방지 여백


def slice_frames(path, fw, fh):
    """격자 시트를 프레임 목록으로 자른다. fw/fh 가 0이면 단일 이미지."""
    img = Image.open(path).convert("RGBA")
    if not fw or not fh:
        return [img]
    cols = max(1, img.width // fw)
    rows = max(1, img.height // fh)
    out = []
    for r in range(rows):
        for c in range(cols):
            out.append(img.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)))
    return out


def pack(entries):
    """선반(shelf) 패킹 — 프레임을 높이 내림차순으로 정렬해 낭비를 줄인다."""
    entries.sort(key=lambda e: (-e["img"].height, -e["img"].width))
    x = y = shelf_h = 0
    placed = []
    for e in entries:
        w, h = e["img"].width + PAD, e["img"].height + PAD
        if x + w > MAX_W:
            x = 0
            y += shelf_h
            shelf_h = 0
        e["x"], e["y"] = x, y
        placed.append(e)
        x += w
        shelf_h = max(shelf_h, h)
    total_h = y + shelf_h
    # 높이를 2의 거듭제곱으로 올린다 (일부 GPU에서 밉맵/래핑에 유리)
    pow2 = 1
    while pow2 < total_h:
        pow2 *= 2
    return placed, MAX_W, pow2


def main():
    cfg = json.load(open(sys.argv[1]))
    name, out_dir, spec = cfg["name"], cfg["outDir"], cfg["spec"]

    entries = []
    for s in spec:
        frames = slice_frames(s["file"], s["fw"], s["fh"])
        for i, img in enumerate(frames):
            entries.append({"name": f'{s["key"]}/{i}', "img": img})

    placed, W, H = pack(entries)
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frames_json = {}
    for e in placed:
        atlas.paste(e["img"], (e["x"], e["y"]))
        w, h = e["img"].width, e["img"].height
        frames_json[e["name"]] = {
            "frame": {"x": e["x"], "y": e["y"], "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }

    png_path = f"{out_dir}/{name}.png"
    atlas.save(png_path, optimize=True)
    json.dump(
        {"frames": frames_json, "meta": {"image": f"{name}.png", "size": {"w": W, "h": H}, "scale": "1"}},
        open(f"{out_dir}/{name}.json", "w"),
    )
    used = sum(e["img"].width * e["img"].height for e in placed)
    print(f"  {name}: 시트 {len(spec)}장 → 프레임 {len(placed)}개, {W}x{H} "
          f"(채움률 {used / (W * H) * 100:.0f}%)")


if __name__ == "__main__":
    main()
