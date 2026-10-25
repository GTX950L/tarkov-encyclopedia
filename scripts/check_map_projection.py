#!/usr/bin/env python3
"""投影自检 —— gen_maps.py / build_tile_maps.py / maps-data.js 三处注释里
引用的那个「锚点自检」脚本（承诺了一直没落盘，2026-10-15 复查时补上）。

四件事，全部离线：

  ① 重算比对：用 `gen_maps.project()` 对上游世界坐标**重算**，与入库的
     maps-data.js 逐点比对 —— 验证「入库坐标 = 当前公式」的一致性。
     改了 project() 或换上游数据后跑它，公式与数据谁漂了立刻知道。
  ② viewBox 对账：maps-data.js 里记录的 viewBox 与底图 SVG 文件的实际
     viewBox 一致 —— 投影帧与显示帧不能脱节（脱节 = 所有叠加点整体偏移）。
  ③ 定位 ↔ 测距自洽：`project()` 的「1 米 = N 像素」与 `mpp` 的「1 像素 = M 米」
     相乘必须等于 1。两者口径分叉时，点位位置与测距读数会互相矛盾。
  ④ 矢量底图比例：底图宽高比与 bounds 投影宽高比必须相等（真实地图等比例）。
     不等 = 方向性拉伸，点位会随位置漂移。

⚠️ **①② 是自证**：都拿同一个 `project()` 重算再比对，公式本身错了照样全绿。
   能抓「公式没漂」，抓不到「公式错了」。2026-10-25 的瓦片图错位（实验室 27.7%、
   破冰船 26%）就是被这两条放过的 —— 当时 ①② 全绿。③④ 是对外判据，不依赖真值。
   其中 ④ 只对矢量图生效（瓦片图的 viewBox 是裁剪框，与 bounds 声明范围无约束）。

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

from _console import setup as _setup_console

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gen_maps import project  # noqa: E402  全站唯一坐标换算，被检对象本身
from _map_links import MAP_ID_TO_KEY, map_key_of_cn  # noqa: E402

TOL = 0.11  # 入库 round(...,1) 的容差
SCALE_TOL = 0.03   # 定位 ↔ 测距自洽容差
RATIO_TOL = 0.03   # 底图宽高比 ↔ bounds 投影宽高比容差


def load_meta() -> dict[str, dict]:
    src = ROOT / "scripts" / "data" / "maps_source.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    # 瓦片图要带上 zoom —— project() / mpp_of() 靠它分辨「直连网格」与「矢量归一化」。
    # 不带就会被当成矢量图归一化，本脚本反而会「验证」那个错误公式（自证陷阱）。
    tiles: dict[str, dict] = {}
    tp = ROOT / "scripts" / "data" / "tile_maps.json"
    if tp.exists():
        tiles = json.loads(tp.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for group in data:
        for m in group.get("maps", []):
            rec = dict(m)
            if m["key"] in tiles:
                rec["zoom"] = tiles[m["key"]]["zoom"]
            out[m["key"]] = rec
    return out


MODE = "pvp"


def _layer_span(meta: dict) -> tuple[float, float]:
    """bounds 四角在 layer 空间的包围盒跨度。

    **刻意绕开 project()**：这条判据要独立于被检函数，否则又是自证
    （project 的矢量分支就是把 bounds 塞进 viewBox，比出来的比例恒等）。
    """
    b = meta["bounds"]
    tf = meta["transform"]
    rot = math.radians(meta.get("coordinateRotation") or 0)
    a, bb, c, d = tf[0], tf[1], -(tf[2]), tf[3]

    def pt(wx: float, wz: float) -> tuple[float, float]:
        rx = wx * math.cos(rot) - wz * math.sin(rot)
        ry = wx * math.sin(rot) + wz * math.cos(rot)
        return (a * rx + bb, c * ry + d)

    corners = [pt(wx, wz) for wx in (b[1][0], b[0][0]) for wz in (b[0][1], b[1][1])]
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    return (max(xs) - min(xs), max(ys) - min(ys))


def _mp(rel: str) -> Path:
    """按模式取文件。pvp 保持**无后缀** —— 现有页面与默认门禁都按它找。"""
    f = ROOT / rel
    return f if MODE == "pvp" else f.with_name(f.stem + f"_{MODE}" + f.suffix)


def load_site_data() -> dict:
    """读**合并后**的 maps_site.json（两种模式一份，zone.m 标模式）。"""
    return json.loads((ROOT / "scripts" / "data" / "maps_site.json")
                      .read_text(encoding="utf-8"))


def main() -> int:
    global MODE
    if "--mode" in sys.argv:
        MODE = sys.argv[sys.argv.index("--mode") + 1]
    if MODE != "pvp":
        print(f"[模式] {MODE}")
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

    # ── ③ 定位 ↔ 测距自洽（2026-10-25 新增）─────────────────────────
    # project() 说「1 米 = N 像素」，mpp 说「1 像素 = M 米」，N·M 必须 = 1。
    # 两者同源时恒等；一旦某一方换了口径（瓦片图的 mpp 曾用整幅网格做分母），
    # 测距读数就会跟点位位置打架 —— 这正是 2026-10-25 查出的那批偏差。
    scale_checked = 0
    for key, d in data.items():
        meta = metas.get(key)
        mp = d.get("mpp") or []
        if not meta or not meta.get("bounds") or len(mp) != 2:
            continue
        pmeta = {**meta, "viewBox": d["viewBox"]}
        b = meta["bounds"]
        x0 = (b[0][0] + b[1][0]) / 2
        z0 = (b[0][1] + b[1][1]) / 2
        o = project(x0, z0, pmeta)
        ex = project(x0 + 1, z0, pmeta)
        ez = project(x0, z0 + 1, pmeta)
        lx = math.hypot(ex[0] - o[0], ex[1] - o[1])
        lz = math.hypot(ez[0] - o[0], ez[1] - o[1])
        if lx < 1e-9 or lz < 1e-9:
            problems.append(f"{key}: 投影退化为零位移，比例尺无法核对")
            continue
        # 旋转 90/270 会让 x/z 与像素轴互换，排序后逐分量比
        implied = sorted([1.0 / lx, 1.0 / lz])
        rec = sorted(float(v) for v in mp)
        if not rec[0]:
            problems.append(f"{key}: mpp 含 0，测距会除零")
            continue
        dev = max(abs(implied[i] / rec[i] - 1) for i in range(2))
        scale_checked += 1
        if dev > SCALE_TOL:
            problems.append(
                f"{key}: 定位与测距不自洽 {dev * 100:.1f}%"
                f"（定位 {implied[0]:.5f}/{implied[1]:.5f} m/px vs mpp {rec[0]}/{rec[1]}）"
                " —— project() 与 mpp_of() 口径分叉"
            )

    # ── ④ 矢量底图宽高比 ↔ bounds 投影宽高比（2026-10-25 新增）──────
    # 真实地图等比例绘制；上游导出的 SVG 就是按 bounds 范围画的，两者宽高比必须相等。
    # 不等 = 方向性拉伸，点位会随位置漂移。瓦片图跳过 —— 它的 viewBox 是裁剪框，
    # 与 bounds 声明范围本来就没约束关系（直连投影不依赖它）。
    ratio_checked = 0
    for key, d in data.items():
        meta = metas.get(key)
        if not meta or not meta.get("bounds") or meta.get("zoom") is not None:
            continue
        span_u, span_v = _layer_span(meta)
        if span_u <= 0 or span_v <= 0:
            continue
        vb = d["viewBox"]
        if min(vb[2], vb[3]) <= 0:
            continue
        # 用长宽比（不分方向），避开 90/270 的轴互换
        r_svg = max(vb[2], vb[3]) / min(vb[2], vb[3])
        r_world = max(span_u, span_v) / min(span_u, span_v)
        dev = abs(r_svg / r_world - 1)
        ratio_checked += 1
        if dev > RATIO_TOL:
            problems.append(
                f"{key}: 底图宽高比与 bounds 投影差 {dev * 100:.2f}%"
                f"（SVG {r_svg:.4f} vs 投影 {r_world:.4f}）"
                " —— 底图与坐标数据不同源，点位会按位置漂移"
            )

    # ── ⑤ 任务 ↔ 地图接线（2026-10-17 新增）─────────────────────────────
    # 这一节盯的是「有坐标区 ≠ 有入口 / 有入口 ≠ 画得出」的四类漂移：
    #   ① 有区域但图上没有（且不在投影丢弃名单里）；
    #   ② 有区域但任务的 ms 数组漏了那张图（筛选与入口仍缺）；
    #   ③ 区域的 oid 不在该任务的目标 id 表里（目标级定位会落空）；
    #   ④ 目标 maps 出现未登记的地图别名（「提到本图」清单会漏）。
    try:
        qj = json.loads(_mp("scripts/data/quests.json").read_text(encoding="utf-8"))
        tasks = {t["id"]: t for t in qj.get("tasks") or []}
        zj = json.loads(_mp("scripts/data/quest_zones.json").read_text(encoding="utf-8"))
        # 目标 id 表从**本模式**的 quests 文件取，不共用 quest-graph.json ——
        # 实测（2026-10-18）：两个模式下**同一个任务的目标 id 也不同**
        # （任务 id 相同、objective id 各自独立），拿 PvP 的目标表校 PvE 会全报落空。
        graph_objs = {tid: [o.get("id") for o in (t.get("objectives") or []) if o.get("id")]
                      for tid, t in tasks.items()}
    except Exception as e:  # noqa: BLE001
        problems.append(f"接线校验读不到任务 / 区域 / 图数据：{e}")
        tasks, zj, graph_objs = {}, {"zones": []}, {}

    # 模式过滤：合并数据里每条带 m（缺省=两模式共有）。
    # ⚠️ **PvP 视图的 zone 数是硬回归线**：13 个地图页与 site 都依赖它，
    #    过滤逻辑一旦坏掉，页面会多画出 PvE 专属点位（2026-10-18 加的断言）。
    EXPECT_ZONES = {"pvp": 508, "pve": 510}
    def _zones(d):
        return [z for z in (d.get("questZones") or [])
                if not z.get("m") or z.get("m") == MODE]
    n_zones = sum(len(_zones(d)) for d in data.values())
    exp_zones = EXPECT_ZONES.get(MODE)
    if exp_zones and n_zones != exp_zones:
        problems.append(
            f"{MODE} 视图的任务点位是 {n_zones} 条，应为 {exp_zones} 条"
            " —— 模式过滤（zone.m）或合并产物坏了")

    site_tasks: set[str] = set()
    for key, d in data.items():
        for z in _zones(d):
            site_tasks.add(z["q"])
    dropped: set[str] = set()
    for key, d in data.items():
        dropped.update(d.get("dropped") or [])

    zone_keys: dict[str, set[str]] = {}
    for z in zj.get("zones") or []:
        zone_keys.setdefault(z["task"], set()).add(MAP_ID_TO_KEY.get(z.get("map"), ""))

    miss = [q for q in zone_keys if q not in site_tasks and q not in dropped]
    for q in miss:
        problems.append(f"{q}: 有坐标区但图上没有，也不在 map_dropped 名单 —— 生成器漂了")

    for q, keys in zone_keys.items():
        t = tasks.get(q)
        if not t:
            problems.append(f"{q}: quests.json 里没有这个任务（区域缓存过期？）")
            continue
        lack = {k for k in keys if k} - set(t.get("ms") or [])
        if lack:
            problems.append(f"{q}（{t.get('name')}）: ms 漏了 {sorted(lack)}，地图入口/筛选仍会缺")

    for key, d in data.items():
        for z in _zones(d):
            oid = z.get("oid")
            if not oid:
                continue
            if oid not in (graph_objs.get(z["q"]) or []):
                problems.append(
                    f"{key}: {z['q']} 的 oid {oid} 不在任务目标表里 —— 目标级定位会落空")

    alias: set[str] = set()
    for t in (qj.get("tasks") or []):
        for o in t.get("objectives") or []:
            for cn in (o.get("maps") or []):
                if not map_key_of_cn(cn):
                    alias.add(cn)
    for cn in sorted(alias):
        problems.append(f"未登记的地图别名「{cn}」—— 归到 _map_links.MAP_KEY_BY_CN，否则漏算")

    print(f"接线校验：{len(zone_keys)} 个有坐标区任务 / {len(site_tasks)} 个上图任务 / "
          f"{len(dropped)} 个投影丢弃")

    print(f"投影自检：重算比对 {checked} 个锚点（容差 {TOL}px）"
          f" + viewBox 对账 {len(data)} 图"
          f" + 比例尺自洽 {scale_checked} 图"
          f" + 底图比例 {ratio_checked} 图")
    if problems:
        print(f"✗ {len(problems)} 个问题：")
        for p in problems:
            print("  · " + p)
        return 1
    print("✅ 全部一致 —— 入库坐标与投影公式、显示帧均无脱节")
    return 0


if __name__ == "__main__":
    _setup_console()
    sys.exit(main())
