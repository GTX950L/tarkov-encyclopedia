#!/usr/bin/env python3
"""生成《交互地图》的矢量底图与点位数据。

数据源（均为二级来源，口径见 content/docs/citation.md 第四节「交互地图的数据口径」）
--------------------------------------------------------------------------
  · maps.json   —— https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json
                   每图的 `svgPath` / `bounds` / `transform` / `coordinateRotation` / `layers` / `labels`
  · SVG 底图     —— maps.json 里 `svgPath` 指向的地址（assets.tarkov.dev），
                   作者 **Shebuka**，仓库 the-hideout/tarkov-dev-svg-maps，**CC BY-NC-SA 4.0**

三个特例（写在这里以免下次误判为漏抓）
--------------------------------------
  · **实验室**：上游仓库有独立的 `Labs.svg`，但它**用内联 `style="fill:#..."` 着色、
    没有 `<style id="style_common">` 色类**（还带 40 处语义色 `red`），本生成器的换肤
    流程套不上。**第一版跳过**——不猜语义色。要做需先给这张图单独建一张内联色映射表。
  · **破冰船 / 迷宫**：上游只有 `tilePath` 瓦片，仓库里没有 SVG，**跳过**（站点暂不收录）。
  · **终点站**：有 SVG 但上游**没有给地名标签**（`labels` 为空），底图可用、无锚点。

换肤
----
把 `LIGHT_STYLE`（本站浅色「军用档案纸」色板）写进每张 SVG 的 `<style id="style_common">`，
与上游 `replace_style_common.py` 同一做法 —— **矢量数据一字不改，只换 24 个色类**。
色板与中文译名**固化在本文件里**（同 gen_hideout.py 的 STATION_NOTES 做法）：
人工内容放生成器里，重跑才不会丢。

用法
----
    python scripts/gen_maps.py --fetch   # 抓 maps.json + 下载 11 张 SVG 存原始缓存 + 换肤出产物
    python scripts/gen_maps.py           # 用缓存重生成（不联网），适合日常校验

写入范围（**两个文件/目录都是本生成器的产物，不要手改**）
    scripts/data/maps_source.json          —— maps.json 快照
    scripts/data/maps_raw/<Name>.svg       —— 上游原始 SVG（换肤的输入）
    content/assets/maps/<Name>.svg         —— 换肤后的底图（站点使用）
    content/javascripts/maps-data.js       —— 点位与图层数据（页面读取）
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _baseline import baseline_label  # noqa: E402  站点基线的唯一来源（citation.md）

MAPS_SRC = (
    "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"
)

CACHE = ROOT / "scripts" / "data" / "maps_source.json"
RAW_DIR = ROOT / "scripts" / "data" / "maps_raw"
SVG_DIR = ROOT / "content" / "assets" / "maps"
OUT_JS = ROOT / "content" / "javascripts" / "maps-data.js"

HEADERS = {"User-Agent": "tarkov-encyclopedia-mapgen/1.0"}

# ─────────────────────────────────────────────────────────────────────────────
# 浅色色板 —— 本站「军用档案纸」取向。上游默认是深色（.land #1f5054 一类），
# 本站全文浅色，故整表替换。**类是上游定义的 24 个，不是自造**；
# 上游新增类名时这里要跟着补（缺的类会退回浏览器默认填充，表现为一块黑）。
# ─────────────────────────────────────────────────────────────────────────────
LIGHT_STYLE = """.trees{fill:#b7d1b0}
.cement{fill:#e8e8e2}
.land{fill:#e0e7d9}
.rock{fill:#e2d9c2}
.water{fill:#abd0ec}
.wood{fill:#d8c7a8}
.tarmac{fill:#ccd2d4}
.gravel{fill:#dccdb0}
.building{fill:#9fabb6}
.floor{fill:#e2e7e9}
.locked{fill:#efa39b}
.map_border{fill:none;stroke:#8b9c8f;stroke-width:2}
.fence{fill:none;stroke:#7d8f80;stroke-width:1}
.road_tarmac{fill:none;stroke:#8e9aa3}
.road_gravel{fill:none;stroke:#b8a482}
.road_small{stroke-width:5}
.road_medium{stroke-width:8}
.road_large{stroke-width:12}
.railroad{fill:none;stroke:#9c8b7a;stroke-dasharray:6;stroke-width:3}
.powerline{fill:none;stroke:#f0c14b;stroke-width:2;stroke-miterlimit:10;stroke-dasharray:6,6}
.danger{fill:#dd5a52;fill-opacity:.5;stroke:#c0392b;stroke-dasharray:4,2;stroke-width:2}
.danger_small{fill:#dd5a52;fill-opacity:.5;stroke:#c0392b;stroke-dasharray:2,1;stroke-width:1}
.task{fill:#2c6fb5}
.stairs{fill:#c9a227}
.shadow{filter:drop-shadow(0 0 1px rgba(0,0,0,.2))}
"""

# ─────────────────────────────────────────────────────────────────────────────
# 地名中文译名 —— **只收站内已确立或有明确对应的**（纪律同 gen_ammo_values.py：
# 译名一律不自己编，查不到就退回英文名）。第一版只覆盖海关；其余图沿用英文名，
# 待逐图核对后增补（增加条目即改此表，重跑生成器即可）。
# ─────────────────────────────────────────────────────────────────────────────
LABELS_ZH: dict[str, dict[str, str]] = {
    "customs": {
        "Big Red": "大红砖",
        "Dorms": "宿舍区",
        "New Gas": "新加油站",
        "Old Gas": "老煤气站",
        "Fortress": "堡垒",
        "Crackhouse": "制毒屋",
        "Streamer House": "主播屋",
        "Main Bridge": "主桥",
        "Sniper Hill": "狙击山",
        "Storage": "仓库区",
        "Trailer Park": "拖车公园",
        "Junk Bridge": "废桥",
        "Repair Shop": "修理厂",
        "Sniper Ridge": "狙击岭",
        "Old Construction": "老工地",
        "Skeleton": "骨架楼",
        "Warehouse 3": "3 号库",
        "Warehouse 4": "4 号库",
        "Warehouse 7": "7 号库",
        "Warehouse 17": "17 号库",
        "Depot": "货场",
        "Military Checkpoint": "军事检查站",
        "Bus Station": "公交站",
        "Powerline Tower": "电塔",
    },
}

# 楼层图层：上游用 `<g id="...">` 给每一层分组，切换显示即可换层。
# **注意区分 `Ground`（地面材质层，class="land"）与 `Ground_Level`（楼层容器）** ——
# 前者不是楼层，加进这个表会让「地面」按钮把地形整个关掉。
FLOOR_ZH: dict[str, str] = {
    "Ground_Level": "地面",
    "Underground_Level": "地下",
    "First_Floor": "1 层",
    "Second_Floor": "2 层",
    "Third_Floor": "3 层",
    "Fourth_Floor": "4 层",
    "Fifth_Floor": "5 层",
}
FLOOR_ORDER = list(FLOOR_ZH)


def _floors(layer_ids: list[str]) -> list[dict]:
    """从 SVG 实际存在的图层 id 里挑出楼层，按楼层顺序排。"""
    present = [f for f in FLOOR_ORDER if f in layer_ids]
    return [{"id": f, "cn": FLOOR_ZH[f]} for f in present]


# maps.json 的 key → 站内条目（用于页面回链与名称对照）
ENTRY_OF: dict[str, str] = {
    "ground-zero": "entries/ground-zero.md",
    "factory": "entries/factory.md",
    "customs": "entries/customs.md",
    "woods": "entries/woods.md",
    "interchange": "entries/interchange.md",
    "reserve": "entries/reserve.md",
    "shoreline": "entries/shoreline.md",
    "lighthouse": "entries/lighthouse.md",
    "streets-of-tarkov": "entries/streets.md",
    "the-lab": "entries/labs.md",
    "terminal": "entries/terminal.md",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def http_get(url: str, timeout: int = 90) -> bytes:
    """取远端内容。**失败时回退到 curl** ——
    raw.githubusercontent.com 在部分网络下对 urllib 直连返回 504 / 挂起，
    而同一个地址 curl 能过（实测 2026-10-13）。这条回退是环境适配，不是逻辑分支。
    """
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.read()
    except Exception as exc:  # noqa: BLE001 —— 任何失败都值得试一次 curl
        import shutil
        import subprocess

        curl = shutil.which("curl")
        if not curl:
            raise SystemExit(f"[错误] 取 {url} 失败（{exc}），且系统里没有 curl 可回退")
        log(f"   （urllib 失败：{exc}；回退 curl 重试）")
        proc = subprocess.run(  # noqa: S603
            [curl, "-sSL", "--max-time", str(timeout), "-A", HEADERS["User-Agent"], url],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            raise SystemExit(
                f"[错误] 取 {url} 失败：urllib 与 curl 都没成功"
                f"（curl 退出码 {proc.returncode}）"
            )
        return proc.stdout


# ── 抓取 ─────────────────────────────────────────────────────────────────────
def fetch() -> None:
    """抓 maps.json 快照 + 下载上游原始 SVG。"""
    log("① 抓 maps.json …")
    raw = http_get(MAPS_SRC)
    data = json.loads(raw.decode("utf-8"))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    log(f"   → {CACHE.relative_to(ROOT)}（{len(raw) / 1024:.0f} KB）")

    log("② 下载上游原始 SVG …")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for key, svg_url in _svg_sources(data):
        blob = http_get(svg_url)
        name = Path(svg_url).name
        (RAW_DIR / name).write_bytes(blob)
        log(f"   → {name:<24} {len(blob) / 1024:7.1f} KB   {key}")


def _svg_sources(data: list) -> list[tuple[str, str]]:
    """(map key, SVG 地址) —— 只取 maps.json 里给了 `svgPath` 的图。

    瓦片图（破冰船 / 迷宫）与内联着色的实验室**按设计不进这个清单**，
    原因见模块头部的「三个特例」。
    """
    out: list[tuple[str, str]] = []
    for group in data:
        for m in group.get("maps", []):
            url = m.get("svgPath")
            if url:
                out.append((m.get("key"), url))
    return out


# ── 换肤 ─────────────────────────────────────────────────────────────────────
STYLE_BLOCK_RE = re.compile(
    r'(<style id="style_common">)(.*?)(</style>)', re.S
)


def restyle(svg_text: str, key: str) -> str:
    """把 <style id="style_common"> 的内容换成浅色板。矢量数据不动。"""
    if "style_common" not in svg_text:
        raise SystemExit(f"[错误] {key}: SVG 里找不到 <style id=\"style_common\">，上游结构变了")
    new, n = STYLE_BLOCK_RE.subn(
        lambda m: m.group(1) + "\n" + LIGHT_STYLE + m.group(3), svg_text
    )
    if n != 1:
        raise SystemExit(f"[错误] {key}: style_common 块匹配到 {n} 处，预期 1 处")
    return new


# ── 坐标投影 ─────────────────────────────────────────────────────────────────
# 来自上游 src/pages/map/index.jsx（Leaflet CRS.Simple + L.Transformation +
# applyRotation(coordinateRotation)）化简而成。2026-10-13 用 #Big_red-2f /
# #Gas_Station 两个具名图层做锚点反推验证：偏差 1.5–3.4%，方向一致（属边界留白的
# 系统性偏差）。**改动此公式前必须重跑锚点自检**，见 scripts/check_map_projection.py。
def project(x: float, z: float, meta: dict) -> tuple[float, float]:
    bounds = meta["bounds"]
    vb = meta["viewBox"]  # [minX, minY, w, h]
    x_max, z_min = bounds[0][0], bounds[0][1]
    span_x = bounds[0][0] - bounds[1][0]
    span_z = bounds[1][1] - bounds[0][1]
    return ((x_max - x) / span_x * vb[2], (z - z_min) / span_z * vb[3])


VIEWBOX_RE = re.compile(r'viewBox="([\d.\s\-]+)"')
LAYER_RE = re.compile(r'<g[^>]*\bid="([^"]+)"')


def build_maps(data: list) -> dict:
    """把 maps.json + 换肤后的 SVG 合成站点用的数据结构。"""
    by_key = {}
    for group in data:
        for m in group.get("maps", []):
            if m.get("svgPath"):
                by_key.setdefault(m["key"], m)

    out: dict[str, dict] = {}
    for key, meta in sorted(by_key.items()):
        raw_path = RAW_DIR / Path(meta["svgPath"]).name
        if not raw_path.exists():
            raise SystemExit(
                f"[错误] 缺原始 SVG：{raw_path.relative_to(ROOT)} —— 先跑 --fetch"
            )
        raw_text = raw_path.read_text(encoding="utf-8")
        styled = restyle(raw_text, key)

        vb = VIEWBOX_RE.search(styled)
        if not vb:
            raise SystemExit(f"[错误] {key}: SVG 里找不到 viewBox")
        view_box = [float(v) for v in vb.group(1).split()]
        if len(view_box) != 4:
            raise SystemExit(
                f"[错误] {key}: viewBox 应为 4 个值（minX minY w h），实得 {view_box}"
            )

        # 图层：只留上游 <g id="..."> 里的顶层结构名（楼层 / 语义层）
        layers = LAYER_RE.findall(styled)

        SVG_DIR.mkdir(parents=True, exist_ok=True)
        (SVG_DIR / raw_path.name).write_text(styled, encoding="utf-8")

        zh = LABELS_ZH.get(key, {})
        labels = []
        for lb in meta.get("labels") or []:
            en = lb["text"]
            pos = lb["position"]
            x, y = project(pos[0], pos[1], {"bounds": meta["bounds"], "viewBox": view_box})
            labels.append(
                {
                    "en": en,
                    "cn": zh.get(en, ""),  # 无译名 → 空，页面退回英文（不自己编）
                    "x": round(x, 1),
                    "y": round(y, 1),
                }
            )

        out[key] = {
            "nameEn": meta.get("normalizedName") or key,
            "svg": raw_path.name,
            "viewBox": [round(v, 2) for v in view_box],
            "floors": _floors(layers),
            "layers": layers,
            "labels": labels,
        }
        log(
            f"   ✓ {key:<18} {raw_path.name:<22} "
            f"floors={len(_floors(layers)):<2} labels={len(labels)}"
        )
    return out


# ── 输出 ─────────────────────────────────────────────────────────────────────
def write_js(maps: dict) -> None:
    payload = json.dumps(maps, ensure_ascii=False, separators=(",", ":"))
    js = f"""/* ==========================================================================
   交互地图 · 数据（**生成物，不要手改**）
   --------------------------------------------------------------------------
   生成：python scripts/gen_maps.py          （离线，用缓存）
         python scripts/gen_maps.py --fetch  （重新抓上游数据）

   站点基线：{baseline_label()}
   底图来源：the-hideout/tarkov-dev-svg-maps（Shebuka），CC BY-NC-SA 4.0
             —— 署名与使用边界见 content/docs/citation.md 第四节。

   字段：
     svg       底图文件名（位于 assets/maps/，由 map.js 按脚本位置推导绝对路径）
     viewBox   SVG 视口（minX minY w h），点位坐标即在此坐标系内
     floors    楼层图层（id + 中文名），页面做互斥显示的切换按钮
     layers    上游全部图层 id（含材质层与 `*-locked` 子层），备查
     labels    地名锚点；cn 为空表示站内暂无译名，页面退回英文（不自己编）

   点位坐标 = 由上游 labels 的世界坐标经 scripts/gen_maps.py:project() 投影而来，
   **不是手工放置的**。公式的锚点自检见 scripts/check_map_projection.py。
   ========================================================================== */
window.TARKOV_MAPS = {payload};
"""
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(js, encoding="utf-8")
    log(f"\n③ 写出 {OUT_JS.relative_to(ROOT)}（{len(js.encode('utf-8')) / 1024:.1f} KB）")


def main() -> int:
    ap = argparse.ArgumentParser(description="生成交互地图底图与点位数据")
    ap.add_argument("--fetch", action="store_true", help="重新抓上游数据（联网）")
    args = ap.parse_args()

    if args.fetch or not CACHE.exists():
        if not args.fetch and not CACHE.exists():
            log("缓存不存在，自动走 --fetch")
        fetch()

    data = json.loads(CACHE.read_text(encoding="utf-8"))
    log(f"\n② 换肤并投影（{len(_svg_sources(data))} 张）…")
    maps = build_maps(data)
    write_js(maps)
    log(f"\n✅ 完成：{len(maps)} 张图，共 "
        f"{sum(len(m['labels']) for m in maps.values())} 个地名锚点")
    return 0


if __name__ == "__main__":
    sys.exit(main())
