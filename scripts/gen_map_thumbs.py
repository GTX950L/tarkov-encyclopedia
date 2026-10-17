#!/usr/bin/env python3
"""生成「选一张图」卡片用的缩略图（系统 Edge headless 截图 → PNG）。

产物：``content/assets/maps/thumbs/<地图key>.png``（480×320，等比 contain）。

为什么不用 SVG 直接当 ``<img>``：13 张 SVG 合计约 1.5 MB，卡片页对弱网不友好；
缩略图 13 张合计几百 KB 且 ``loading="lazy"``，只加载视口里的。

实现的三个决定：
  ① **渲染交给系统 Edge 的 headless 模式**（``--headless --screenshot``）——
     不引入 cairosvg / Pillow / playwright 等额外依赖（本机 pip 装不上 cairo；
     站内脚本一向只有 zensical 一个依赖）。一张图约 1~2 秒。
  ② 包装 HTML 用 ``<img>`` 引用**站内换肤后的 SVG**（file:// + 放行本地文件访问）：
     矢量（10 张）与瓦片拼合（破冰船/实验室/迷宫，SVG 里包着 webp）走同一条路。
  ③ ⚠️ 本脚本**不进 build_all / check_gen_drift**：它依赖本机有 Edge，不是
     纯离线确定性的，而且跑一遍要十几秒。**底图重新生成后（gen_maps.py）
     手动重跑一次**，重跑后 ``git diff`` 能看出哪些缩略图变了。

用法：
    python scripts/gen_map_thumbs.py             # 全部 13 张
    python scripts/gen_map_thumbs.py customs     # 只重做指定的图（加法重跑）
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS_DATA = ROOT / "scripts" / "data" / "maps_site.json"
ASSETS = ROOT / "content" / "assets" / "maps"
THUMBS = ASSETS / "thumbs"

# 画布尺寸（与卡片 CSS 的 aspect-ratio 对齐；图片 contain 居中、底色 = --tk-paper）
W, H = 480, 320
PAPER = "#FAF9F6"  # 与 extra.css 的 --tk-paper 一致（缩略图是位图，不响应主题变量）

EDGE_CANDIDATES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]

HTML_TMPL = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html, body {{ margin:0; padding:0; width:{w}px; height:{h}px; background:{paper}; overflow:hidden; }}
.w {{ width:{w}px; height:{h}px; box-sizing:border-box; padding:12px;
      display:flex; align-items:center; justify-content:center; }}
img {{ max-width:100%; max-height:100%; }}
</style></head><body><div class="w"><img src="{src}"></div></body></html>
"""


def find_edge() -> Path:
    for p in EDGE_CANDIDATES:
        if p.exists():
            return p
    sys.exit("[错误] 找不到系统 Edge（msedge.exe）—— 本脚本用它做无头截图。")


def load_maps() -> dict:
    s = MAPS_DATA.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"):].rstrip().rstrip(";\n"))


def shoot(edge: Path, src_path: Path, out_png: Path, tmpdir: Path) -> None:
    src = src_path.resolve().as_uri()
    html = tmpdir / (out_png.stem + ".html")
    html.write_text(HTML_TMPL.format(w=W, h=H, paper=PAPER, src=src), encoding="utf-8")
    cmd = [
        str(edge), "--headless", "--disable-gpu",
        f"--screenshot={out_png}",
        f"--window-size={W},{H}", "--hide-scrollbars",
        "--allow-file-access-from-files",
        html.resolve().as_uri(),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if not out_png.exists():
        sys.exit(f"[错误] 截图失败：{src_path.name}\n{r.stdout}\n{r.stderr}")


def source_for(m: dict, svg_name: str) -> Path:
    """挑用于截图的源文件。

    ⚠️ 瓦片拼合的图（kind=tile：破冰船 / 实验室 / 迷宫）**不能用包装 SVG**：
       `<img>` 加载 SVG 时浏览器**不加载其内部引用的外部资源**（安全限制），
       截出来只有一张空底色（实测：1 KB 的空白）。它们的真实底图就是同名 .webp ——
       直接引用它。（Labs 的二层 Labs_2nd.webp 缩略图不用 —— 主层就够认图。）
    """
    if m.get("kind") == "tile":
        webp = ASSETS / (Path(svg_name).stem + ".webp")
        if webp.exists():
            return webp
    return ASSETS / svg_name


def main() -> int:
    only = set(sys.argv[1:])
    edge = find_edge()
    maps = load_maps()
    THUMBS.mkdir(parents=True, exist_ok=True)

    n = 0
    with tempfile.TemporaryDirectory(prefix="tkthumbs_") as td:
        tmpdir = Path(td)
        for key in sorted(maps):
            if only and key not in only:
                continue
            m = maps[key]
            svg_name = m.get("svg")
            if not svg_name or not (ASSETS / svg_name).exists():
                print(f"  ⚠ {key}: 缺底图 {svg_name}，跳过")
                continue
            out = THUMBS / f"{key}.png"
            src = source_for(m, svg_name)
            shoot(edge, src, out, tmpdir)
            kb = out.stat().st_size / 1024
            print(f"  ✓ {key:<18} {src.name:<20} → thumbs/{key}.png（{kb:.0f} KB）")
            n += 1

    total = sum(p.stat().st_size for p in THUMBS.glob("*.png")) / 1024
    print(f"\n完成：{n} 张 ｜ thumbs/ 合计 {total:.0f} KB")
    print("提醒：底图（gen_maps.py）重跑后，本脚本要跟着手动重跑一次。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
