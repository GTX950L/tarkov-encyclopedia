#!/usr/bin/env python3
"""投影自检 —— gen_maps.py / build_tile_maps.py / maps-data.js 三处注释里
引用的那个「锚点自检」脚本（承诺了一直没落盘，2026-10-15 复查时补上）。

两件事，全部离线：

  ① 重算比对：用 `gen_maps.project()` 对上游世界坐标**重算**，与入库的
     maps-data.js 逐点比对 —— 验证「入库坐标 = 当前公式」的一致性。
     改了 project() 或换上游数据后跑它，公式与数据谁漂了立刻知道。
  ② viewBox 对账：maps-data.js 里记录的 viewBox 与底图 SVG 文件的实际
     viewBox 一致 —— 投影帧与显示帧不能脱节（脱节 = 所有叠加点整体偏移）。

口径与容差
----------
入库坐标是 round(..., 1)，容差 0.11。
⚠️ 同名锚点多实例（上游同一 text 在一图多处）必须按「最近实例」匹配 ——
按第一个匹配会假报几百 px 的偏差（实测街区 3 个点假报 390px，全是这个坑）。

用法
----
    python scripts/check_map_projection.py     # 离线，读缓存
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gen_maps import project  # noqa: E402  全站唯一坐标换算，被检对象本身

TOL = 0.11  # 入库 round(...,1) 的容差


def load_meta() -> dict[str, dict]:
    src = ROOT / "scripts" / "data" / "maps_source.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for group in data:
        for m in group.get("maps", []):
            out[m["key"]] = m
    return out


def load_site_data() -> dict:
    js = (ROOT / "content" / "javascripts" / "maps-data.js").read_text(encoding="utf-8")
    return json.loads(js[js.index("{"):].rstrip().rstrip(";\n"))


def main() -> int:
    metas = load_meta()
    data = load_site_data()
    problems: list[str] = []

    # ── ① 重算比对 ──
    checked = 0
    for key, d in data.items():
        meta = metas.get(key)
        if not meta:
            problems.append(f"{key}: maps_source.json 里查不到，上游结构变了")
            continue
        vb = d["viewBox"]
        pmeta = {**meta, "viewBox": vb}
        # 上游同名 label 分组（多实例），入库点按「最近实例」匹配
        by_text: dict[str, list[tuple[float, float]]] = {}
        for u in meta.get("labels") or []:
            x, y = project(u["position"][0], u["position"][1], pmeta)
            by_text.setdefault(u["text"], []).append((x, y))
        for lb in d.get("labels") or []:
            cands = by_text.get(lb["en"])
            if not cands:
                problems.append(f"{key}: 锚点 {lb['en']} 在上游数据里查无")
                continue
            dev = min(max(abs(x - lb["x"]), abs(y - lb["y"])) for x, y in cands)
            checked += 1
            if dev > TOL:
                problems.append(
                    f"{key}: 锚点 {lb['en']} 重算偏差 {dev:.2f}px（> {TOL}）—— 公式或数据漂了"
                )

    # ── ② viewBox 对账 ──
    for key, d in data.items():
        svg = ROOT / "content" / "assets" / "maps" / d["svg"]
        if not svg.exists():
            problems.append(f"{key}: 底图 {d['svg']} 不存在")
            continue
        m = re.search(r'viewBox="([^"]+)"', svg.read_text(encoding="utf-8"))
        if not m:
            problems.append(f"{key}: {d['svg']} 里没有 viewBox")
            continue
        act = [round(float(v), 2) for v in m.group(1).split()]
        exp = [round(v, 2) for v in d["viewBox"]]
        if act != exp:
            problems.append(f"{key}: viewBox 脱节 data={exp} vs svg={act}")

    print(f"投影自检：重算比对 {checked} 个锚点（容差 {TOL}px）+ viewBox 对账 {len(data)} 图")
    if problems:
        print(f"✗ {len(problems)} 个问题：")
        for p in problems:
            print("  · " + p)
        return 1
    print("✅ 全部一致 —— 入库坐标与投影公式、显示帧均无脱节")
    return 0


if __name__ == "__main__":
    sys.exit(main())
