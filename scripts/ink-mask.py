#!/usr/bin/env python3
"""
把白底的水墨图转成留白皮肤用的遮罩：墨越浓越不透明，白纸完全透明。
页面上用 CSS mask-image 挂这张图、background-color 填主题色（见 ink.css 的 .shan/.zhou/.zhu/.song），
所以同一张图在浅色是墨色、在深色是米色，四季配色也跟着变。

告示（Announcements 在留白皮肤里的弹窗）另外用到三种处理，见 SETTINGS 的 kind：
  edge    黑底白纸的毛边纸，取左右两条毛边，上下镜像接成能竖着无缝平铺的窄条（notice-edge-l/-r）
  grain   宣纸纹理，只留比周围暗的颗粒（高通），再错半张叠一次做成四方连续。
          这张不当遮罩，直接当背景铺：颜色是中灰、透明度压得很低，浅色纸上显暗、深色纸上显亮
  cutout  白底的彩色器物（卷轴木轴）：从四边灌水找出白底抠掉，保留原来的颜色

首页左边的期限条幅（ink.css 的 .ddl-row / .strip）：
  ddl-rod        横杆，cutout
  ddl-paper      远的事项：米色旧宣纸，cutout；top 把原图上自带的那根三角挂绳切掉，只从纸轴开始
  ddl-paper-hot  近的事项：朱砂洒金，同上
  ddl-knot       挂绳和结，按墨做遮罩（跟主题换色）；rows 只取绳环和结、一小段绳、绳头的坠子，把中间太长的绳子剪掉

用法：python3 scripts/ink-mask.py            # 转 design-lab/ink-src/ 下的全部原图
      python3 scripts/ink-mask.py hills      # 只转一张
原图放在 design-lab/ink-src/<名字>.(png|webp|jpg)，输出到 public/ink/<名字>.webp。
需要 Pillow 和 numpy（pip install pillow numpy），cutout 还要 scipy。
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design-lab" / "ink-src"
OUT = ROOT / "public" / "ink"

# 每张图的处理参数：
# width   输出宽度（等比缩放，够高清屏用就行）
# white   亮度高于它的算白纸，完全透明（压掉纸面上的细噪点）
# gamma   <1 让淡墨更显，>1 让淡墨更淡
SETTINGS = {
    "hills": {"width": 2000, "white": 248, "gamma": 0.9},
    "bamboo": {"width": 1400, "white": 248, "gamma": 1.0},
    "notice-empty": {"width": 900, "white": 248, "gamma": 0.95},
    "notice-paper": {"kind": "edge"},
    "paper-grain": {"kind": "grain", "width": 512, "strength": 0.17},
    "scroll-rod": {"kind": "cutout", "width": 1200},
    "ddl-rod": {"kind": "cutout", "width": 1200},
    "ddl-paper": {"kind": "cutout", "width": 180, "top": 82, "dehalo": True},
    "ddl-paper-hot": {"kind": "cutout", "width": 180, "top": 162, "dehalo": True},
    "ddl-knot": {"width": 72, "white": 235, "gamma": 0.85, "rows": [(48, 640), (640, 690), (1655, 1730)], "trim": True},
}


def find_src(name: str) -> Path:
    src = next((p for p in SRC.glob(f"{name}.*") if p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}), None)
    if src is None:
        raise SystemExit(f"找不到原图：{SRC}/{name}.png|webp|jpg")
    return src


def save(img: Image.Image, name: str, src: Path, note: str = "", quality: int = 82) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{name}.webp"
    img.save(dest, "WEBP", quality=quality, method=6)
    print(f"{src.name} → {dest.relative_to(ROOT)}  {img.width}×{img.height}  {note}{dest.stat().st_size // 1024} KB")


def alpha_only(alpha: np.ndarray) -> Image.Image:
    out = Image.new("RGBA", (alpha.shape[1], alpha.shape[0]), (0, 0, 0, 0))
    out.putalpha(Image.fromarray(np.clip(alpha * 255, 0, 255).round().astype(np.uint8)))
    return out


def edge(name: str, src: Path) -> None:
    """白纸越白越不透明；左右各取一条毛边（避开四角），接上自己的上下镜像，竖着平铺没有接缝"""
    gray = np.asarray(Image.open(src).convert("L"), dtype=np.float32)
    rows = np.where(gray.mean(axis=1) > 128)[0]
    cols = np.where(gray.mean(axis=0) > 128)[0]
    top, bottom, left, right = rows[0], rows[-1], cols[0], cols[-1]
    alpha = np.clip((gray - 16) / (228 - 16), 0, 1)
    # 角上的毛边是斜的，上下各让出一成
    y0, y1 = top + (bottom - top) // 10, bottom - (bottom - top) // 10
    width = 72
    for side, x0 in (("l", max(0, left - 28)), ("r", min(gray.shape[1], right + 28) - width)):
        strip = alpha[y0:y1, x0 : x0 + width]
        save(alpha_only(np.vstack([strip, strip[::-1]])), f"notice-edge-{side}", src)


def grain(name: str, src: Path, cfg: dict) -> None:
    """纸纹：只要比周围暗的纤维和颗粒（减掉大范围的明暗），错开半张叠一次，四边就能接上"""
    img = Image.open(src).convert("L").resize((cfg["width"], cfg["width"]), Image.LANCZOS)
    gray = np.asarray(img, dtype=np.float32)
    local = np.asarray(img.filter(ImageFilter.GaussianBlur(12)), dtype=np.float32)
    # 只分八级：纸纹本来就淡，级数少压缩得小得多
    alpha = np.round(np.clip(0.3 + (local - gray) / 14, 0, 1) * 7) / 7
    n = alpha.shape[0]
    ramp = 1 - np.abs(np.linspace(-1, 1, n))
    weight = np.minimum.outer(ramp, ramp) ** 0.6
    shifted = np.roll(alpha, (n // 2, n // 2), axis=(0, 1))
    tile = alpha_only((alpha * weight + shifted * (1 - weight)) * cfg["strength"])
    tile = Image.merge("RGBA", (*Image.new("RGB", tile.size, (128, 128, 128)).split(), tile.getchannel("A")))
    save(tile, name, src, quality=50)


def cutout(name: str, src: Path, cfg: dict) -> None:
    """从四边灌水找出连着的白底，抠掉；物件里的高光不和外面连着，留下。边缘羽化一像素"""
    from scipy import ndimage

    rgb = Image.open(src).convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32)
    thing = arr.min(axis=2) < 236
    # top：这一行以上不要（原图上多画出来的东西，比如条幅自带的挂绳）
    thing[: cfg.get("top", 0)] = False
    thing = ndimage.binary_fill_holes(ndimage.binary_closing(thing, iterations=2))
    labels, count = ndimage.label(thing)
    if count > 1:
        sizes = ndimage.sum(thing, labels, range(1, count + 1))
        thing = labels == (int(np.argmax(sizes)) + 1)
    ys, xs = np.where(thing)
    pad = 4
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(arr.shape[1], xs.max() + pad + 1), min(arr.shape[0], ys.max() + pad + 1))
    mask = Image.fromarray(ndimage.binary_erosion(thing, iterations=1).astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(1.2))
    if cfg.get("dehalo"):
        # 毛边上残留的白纤维：越接近白越透明（物件本身的颜色离白远，不受影响）
        fade = np.clip((255 - arr.min(axis=2)) * 4.5, 0, 255).astype(np.uint8)
        mask = Image.fromarray(np.minimum(np.asarray(mask), fade))
    out = rgb.copy()
    out.putalpha(mask)
    out = out.crop(box)
    if out.width > cfg["width"]:
        out = out.resize((cfg["width"], round(out.height * cfg["width"] / out.width)), Image.LANCZOS)
    save(out, name, src)


def convert(name: str) -> None:
    src = find_src(name)
    cfg = SETTINGS.get(name, {"width": 1600, "white": 248, "gamma": 1.0})
    kind = cfg.get("kind", "ink")
    if kind == "edge":
        return edge(name, src)
    if kind == "grain":
        return grain(name, src, cfg)
    if kind == "cutout":
        return cutout(name, src, cfg)

    gray = Image.open(src).convert("L")
    # rows：只取这几段行、上下接起来（剪掉中间不要的一截）；trim：左右裁到有墨的地方
    if "rows" in cfg:
        arr = np.asarray(gray)
        gray = Image.fromarray(np.vstack([arr[y0:y1] for y0, y1 in cfg["rows"]]))
    if cfg.get("trim"):
        xs = np.where((np.asarray(gray) < cfg["white"]).any(axis=0))[0]
        gray = gray.crop((max(0, xs.min() - 4), 0, min(gray.width, xs.max() + 5), gray.height))
    if gray.width > cfg["width"]:
        gray = gray.resize((cfg["width"], round(gray.height * cfg["width"] / gray.width)), Image.LANCZOS)

    # 最浓的墨（取第 0.05% 暗的像素，避开个别坏点）当作完全不透明
    hist = gray.histogram()
    total = gray.width * gray.height
    seen = 0
    black = 0
    for level, count in enumerate(hist):
        seen += count
        if seen >= total * 0.0005:
            black = level
            break
    white = cfg["white"]
    span = max(1, white - black)
    gamma = cfg["gamma"]
    lut = [round(255 * min(1.0, max(0.0, (white - v) / span)) ** gamma) for v in range(256)]
    alpha = gray.point(lut)

    # 颜色通道全黑，只有透明度有用（mask-image 默认按 alpha 取）
    out = Image.new("RGBA", gray.size, (0, 0, 0, 0))
    out.putalpha(alpha)
    save(out, name, src, f"墨 {black}–{white}  ")


if __name__ == "__main__":
    for name in sys.argv[1:] or SETTINGS:
        convert(name)
