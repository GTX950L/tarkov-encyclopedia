#!/usr/bin/env python3
"""把上游的**瓦片地图**拼成单张底图（供交互地图使用）。

背景
----
上游 13 张图里有 3 张不是矢量 SVG，而是瓦片金字塔（`assets.tarkov.dev/maps/<图>/<层>/{z}/{x}/{y}.png`）：
破冰船、实验室（1st / 2nd 两层）、迷宫。本站正文沿用了矢量底图的做法，
所以这里把瓦片拼成一张图，让三者用同一套渲染管线。

坐标映射（**本文件最要紧的一段**）
----------------------------------
上游用 Leaflet + 自定义 CRS，旋转是**绕原点**做的：

    rotatedX = x·cosθ − z·sinθ
    rotatedY = x·sinθ + z·cosθ
    layerX   = a·rotatedX + b        a = transform[0], b = transform[1]
    layerY   = c'·rotatedY + d       c' = −transform[2], d = transform[3]

瓦片 (x,y) 在缩放 z 下占据 layer 点 [x·256, (x+1)·256) —— 所以把四角换算出来取包围盒，
就得到「瓦片网格 → 世界坐标」的线性映射。**这个映射对 θ=180 与
`gen_maps.py:project()` 的旧公式等价（已核对），但 θ=90/270 时轴会互换** ——
这正是工厂图（θ=90）标注一直偏、以及实验室/迷宫无法接入的原因。

⚠️ 改动这里的任何一步，都要跑 `scripts/check_map_projection.py` 复核。

色彩
----
实验室与迷宫是**深色底图**（中位亮度 30–60），与本站的浅色档案纸主题冲突；
破冰船是中灰（峰值在 128–160），偏暗。统一走两步：

  · `invert`  —— 亮度反转（保色相）：深色底 → 浅色底；再把饱和度乘 0.55
                （深色科技图的底带着蓝紫色调，抬亮后不压会显得脏）
  · `lift`    —— 原样进入下一步（背景已是中灰，无需反转）
  · 然后**都做百分位对比度拉伸**（p2–p98 → 0–255）

**v2 为什么要加拉伸**：深色游戏底图的「底 vs 线」亮度差往往只有三四十个灰阶
—— 实测实验室反转后底 ≈ 220、线 ≈ 195，差 10%，直接反转的产物是一片洗白
的浅灰、线稿根本立不起来（v1 上线后实验室页就是这种「白茫茫」效果）。
拉伸把暗端（线）压向 0、亮端（底）推到纸白，线稿才重新可读。

**为什么反转亮度而不是三通道**：这三张图 70–91% 的像素是低饱和的，
但仍有彩色要素（红/黄标记）。直接反转 RGB 会把红色变青，语义就错了。
只反转 HSV 里的 V，色相与饱和度原样保留。

**为什么统计要带 alpha 掩膜**：瓦片没覆盖的区域是透明的，转 RGB 后是纯黑，
不掩膜的话直方图在 0 处全是透明像素，p2 被钉死在 0、拉伸失效。

用法
----
    python scripts/build_tile_maps.py --fetch   # 抓瓦片 → 拼合 → 输出 WebP + 元数据
    python scripts/build_tile_maps.py           # 用缓存重跑（不联网）
"""
from __future__ import annotations

from _console import setup as _setup_console

import argparse
import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

OUT_DIR = ROOT / "content" / "assets" / "maps"
CACHE = ROOT / "scripts" / "data" / "tile_maps.json"

HEADERS = {"User-Agent": "tarkov-encyclopedia-mapgen/1.0"}

# 换行符。**不在 f-string 里写转义** —— 嵌套转义在这个工具链上会丢（踩过）。
NL = chr(10)


# ── 每张瓦片图的取法与色彩处理 ──
# `zoom`：拼接倍率。选的是「够清楚 + 单图不超 ~1.5 MB」的折中；
#   z 每加一档，字节数约涨 3–4 倍（实测）。
# `tone`：见模块头部的色彩说明。
TILE_MAPS: dict[str, dict] = {
    "icebreaker": {
        "out": "Icebreaker.webp",
        "tone": "lift",
        "zoom": 4,
        "layers": {"06_infirmary": "01_infirmary"},
        "src": "https://assets.tarkov.dev/maps/icebreaker/06_infirmary/{z}/{x}/{y}.png",
    },
    "the-lab": {
        "out": "Labs.webp",
        "tone": "invert",
        "zoom": 4,
        "layers": {"1st": None, "2nd": "_2nd"},   # 两层共用坐标系
        "src": "https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png",
        "src2": "https://assets.tarkov.dev/maps/labs_v4/2nd/{z}/{x}/{y}.png",
    },
    "the-labyrinth": {
        "out": "Labyrinth.webp",
        "tone": "invert",
        "zoom": 3,
        "layers": {"main": "main"},
        "src": "https://assets.tarkov.dev/maps/labyrinth/main/{z}/{x}/{y}.png",
    },
}


def log(msg: str) -> None:
    print(msg, flush=True)


def http_get(url: str, timeout: int = 30) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.read()
    except Exception:  # noqa: BLE001 —— 单块瓦片失败不该中断整张图
        return None


def load_meta() -> dict[str, dict]:
    """从 maps_source.json 取三张图的 transform / bounds / rotation。"""
    src = ROOT / "scripts" / "data" / "maps_source.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for group in data:
        for m in group.get("maps", []):
            if m.get("key") in TILE_MAPS:
                out[m["key"]] = m
    return out


def proj_uv(meta: dict):
    """世界 (x, z) → 网格归一化 (u, v) ∈ [0,1]²。数学见模块头部。"""
    b = meta["bounds"]
    tf = meta["transform"]
    rot = math.radians(meta.get("coordinateRotation") or 0)
    a, bb, c, dd = tf[0], tf[1], -(tf[2]), tf[3]
    xmax, zmin = b[0][0], b[0][1]
    xmin, zmax = b[1][0], b[1][1]

    def pt(x, z):
        rx = x * math.cos(rot) - z * math.sin(rot)
        ry = x * math.sin(rot) + z * math.cos(rot)
        return (a * rx + bb, c * ry + dd)

    cs = [pt(x, z) for x in (xmin, xmax) for z in (zmin, zmax)]
    mnx, mxx = min(p[0] for p in cs), max(p[0] for p in cs)
    mny, mxy = min(p[1] for p in cs), max(p[1] for p in cs)

    def f(x, z):
        px, py = pt(x, z)
        return ((px - mnx) / (mxx - mnx), (py - mny) / (mxy - mny))

    # 每像素代表多少世界单位（测距用）：步长 ÷ 变换比例，两个方向**不相等**
    return f, (1.0 / abs(a), 1.0 / abs(c))


def tone_adjust(img, mode: str):
    """色彩处理（见模块头部「色彩」一节）。

    `img` 是 RGBA（调用方不再先 convert("RGB")—— 直方图统计需要 alpha 掩膜），
    返回 RGBA。只动 HSV 的 V（与 invert 模式下的 S），色相保留。"""
    from PIL import Image

    if mode == "keep":
        return img
    alpha = img.getchannel("A")
    # 瓦片边缘的**半透明抗锯齿像素**（alpha 1–15）转 RGB 后是脏色，
    # 反转+拉伸后会变成边缘噪声条纹（v2 上线当天实测）。低于阈值的直接清成透明：
    # 底图本来就是「有墙/没墙」的二元世界，抖不掉这半档。
    alpha = alpha.point(lambda a: 0 if a < 16 else a)
    # 透明区不参与统计（见模块头部「为什么统计要带 alpha 掩膜」）
    mask = alpha.point(lambda a: 255 if a > 8 else 0)
    hsv = img.convert("RGB").convert("HSV")
    h, s, v = hsv.split()
    if mode == "invert":
        v = Image.eval(v, lambda x: 255 - x)
        s = s.point(lambda x: int(x * 0.55))
    elif mode != "lift":
        return img
    # ── 百分位对比度拉伸：[p2, p98] → [0, 255] ──
    # 端点取自**不透明像素**的直方图累计；离群像素（纯黑/纯白的零星点）
    # 不许顶住端点，否则拉伸幅度被吃掉。
    hist = v.histogram(mask)
    total = sum(hist) or 1
    acc = 0
    lo = 0
    for i in range(256):
        acc += hist[i]
        if acc >= total * 0.02:
            lo = i
            break
    acc = 0
    hi = 255
    for i in range(255, -1, -1):
        acc += hist[i]
        if acc >= total * 0.02:
            hi = i
            break
    if hi > lo:
        scale = 255.0 / (hi - lo)
        lut = [max(0, min(255, int((i - lo) * scale + 0.5))) for i in range(256)]
        v = v.point(lut)
    out = Image.merge("HSV", (h, s, v)).convert("RGB")
    out.putalpha(alpha)
    return out


def build_one(key: str, meta: dict, fetch: bool) -> dict | None:
    from PIL import Image

    cfg = TILE_MAPS[key]
    z = cfg["zoom"]
    n = 2**z
    tile_px = 256
    grid = n * tile_px

    layers: dict[str, Image.Image] = {}
    for lname, tmpl_key in cfg["layers"].items():
        src = cfg["src"] if tmpl_key is None else cfg.get("src2") or cfg["src"]
        if tmpl_key is not None and "src2" not in cfg:
            src = cfg["src"]
        urls = [
            src.format(z=z, x=x, y=y) for x in range(n) for y in range(n)
        ]
        with ThreadPoolExecutor(16) as ex:
            blobs = list(ex.map(lambda u: http_get(u), urls))
        canvas = Image.new("RGBA", (grid, grid), (0, 0, 0, 0))
        got = 0
        for (x, y), blob in zip([(x, y) for x in range(n) for y in range(n)], blobs):
            if not blob or len(blob) < 500:
                continue
            try:
                canvas.paste(Image.open(BytesIO(blob)).convert("RGBA"), (x * tile_px, y * tile_px))
                got += 1
            except Exception:  # noqa: BLE001
                pass
        if got == 0:
            log(f"   ✗ {key}/{lname}: 一个瓦片都没取到")
            return None
        layers[lname] = canvas
        log(f"   {key}/{lname}: {got} 块瓦片")

    # 两层的公共裁剪框（保证切层时坐标不动）
    boxes = [im.getbbox() for im in layers.values() if im.getbbox()]
    box = (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )

    out_paths = []
    for lname, im in layers.items():
        # 深色底图反转后，透明区仍是透明（tone_adjust 全程带着 alpha）
        adj = tone_adjust(im, cfg["tone"])
        crop = adj.crop(box)
        name = cfg["out"] if lname in ("1st", "main", "06_infirmary") else cfg["out"].replace(".webp", f"{cfg['layers'][lname]}.webp")
        dst = OUT_DIR / name
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        crop.save(dst, "WEBP", quality=86, method=6)
        out_paths.append((name, crop.size, dst.stat().st_size))
        log(f"   → {name}  {crop.size[0]}×{crop.size[1]}px  {dst.stat().st_size / 1024:.0f} KB")

    f, (mu, mv) = proj_uv(meta)
    box_w = box[2] - box[0]
    box_h = box[3] - box[1]

    # ── SVG 包装文件 ──
    # 页面侧的 map.js 是「取 SVG → 内联 → 按 <g id> 切层」这一套；
    # 给拼合图套一层只含 <image> 的 SVG，它就能**原样复用**，不必为瓦片写第二条渲染路径。
    # ⚠️ href 写**文件名**，不写路径 —— 内联进页面后相对地址会按页面 URL 解析，
    #    所以由 map.js 在挂载时补上站点根（见 map.js 的 fixImageHrefs）。
    # ⚠️ 每层的 <image> 尺寸都按**同一裁剪框**（box），切层时坐标不动。
    gs = []
    floor_names = []
    for i, (lname, im) in enumerate(layers.items()):
        fname = out_paths[i][0]
        cls = "" if i == 0 else ' style="display:none"'
        # ⚠️ image 的 x/y 用**裁剪框在整幅网格中的偏移**，viewBox 也用同一个坐标系。
        # 视觉结果与「x=0 + viewBox 从 0 开始」完全一样，但**坐标空间变成了整幅网格** ——
        # 页面侧的投影（世界 → 网格像素）才落得进来。
        # 不这么写会怎样：裁剪把坐标系挪了，而投影仍按整幅网格算，
        # **所有叠加点整体偏移**（实测破冰船偏得最厉害，因为它的裁剪框偏离中心 40%）。
        gs.append(
            f'<g id="{lname}"{cls}><image href="{fname}" x="{box[0]}" y="{box[1]}" '
            f'width="{box_w}" height="{box_h}" preserveAspectRatio="none"/></g>'
        )
        floor_names.append(lname)
    wrapper = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="{box[0]} {box[1]} {box_w} {box_h}" width="{box_w}" height="{box_h}">' + NL
        + "  <!-- 由 scripts/build_tile_maps.py 生成：瓦片拼合图的 SVG 包装。不要手改。 -->" + NL + "  "
        + (NL + "  ").join(gs)
        + NL + "</svg>" + NL
    )
    svg_name = cfg["out"].replace(".webp", ".svg")
    (OUT_DIR / svg_name).write_text(wrapper, encoding="utf-8")
    log(f"   → {svg_name}（包装，层：{'、'.join(floor_names)}）")
    # 裁剪框 → 世界坐标四至（用于页面上的「地图范围」说明）
    return {
        "out": cfg["out"],
        "svg": svg_name,
        "floors": floor_names,
        "files": [p[0] for p in out_paths],
        "grid": grid,
        "zoom": z,
        "crop": list(box),
        "size": [box_w, box_h],
        "bounds": meta["bounds"],
        "transform": meta["transform"],
        "rotation": meta.get("coordinateRotation") or 0,
        # 每像素多少世界单位（水平 / 垂直两个方向）—— 测距用
        "mpp": [round(mu / (2**z), 6), round(mv / (2**z), 6)],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="把瓦片地图拼成单张底图")
    ap.add_argument("--fetch", action="store_true", help="重新抓瓦片（联网）")
    args = ap.parse_args()

    if CACHE.exists() and not args.fetch:
        log(f"已有缓存 {CACHE.relative_to(ROOT)}（要重抓加 --fetch）")
        return 0

    metas = load_meta()
    missing = [k for k in TILE_MAPS if k not in metas]
    if missing:
        raise SystemExit(f"[错误] maps_source.json 里找不到：{missing}")

    result: dict[str, dict] = {}
    for key in TILE_MAPS:
        log(f"══ {key} ══")
        rec = build_one(key, metas[key], args.fetch)
        if rec:
            result[key] = rec
    CACHE.write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    log(f"\n✅ 写出 {CACHE.relative_to(ROOT)}（{len(result)} 张）")
    return 0


if __name__ == "__main__":
    _setup_console()
    sys.exit(main())
