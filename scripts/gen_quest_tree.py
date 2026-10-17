#!/usr/bin/env python3
"""生成「任务全景图」的数据（content/quests/tree.md 的图形层）。

布局与排序（v1，2026-10-17）
----------------------------
11 位商人各一列（列序 = 任务图鉴的商人页顺序）；列内任务按
「链簇 → 簇内拓扑序 → 等级 → 名称」自顶向下排：

  ① **链簇**：列内用边做连通分组（两端同在列内才算连通）。簇间按
     「簇内最小接取等级」排 —— 早期的链在上。孤立任务各自成簇、
     按等级随簇落位（与同期链相邻，跨列连线因此短）。
  ② **簇内**：按「相对深度」（簇内最长前置链，前缀在前）排，同深度按
     等级、再按名称 —— 一条链顺着往下读。
  ③ 坐标：y = PAD_Y + 列内序号 × ROW_H（固定行距，不做碰撞避让 ——
     卡片定高，不需要 eftarkov 式的推挤）。

为什么不按「全站拓扑深度」排：515 个任务里 296 个没有前置（多是各商人的
开局任务），全部挤在深度 0 分不出上下 —— 「链簇 + 孤立点」才是这批数据的
真实形态（46 个链簇 + 243 个孤立点，见 CHANGELOG v1.83.0 与本次实施记录）。

产物（入库；check_gen_drift 会重跑对账）
    content/javascripts/quest-tree-data.js

用法：python scripts/gen_quest_tree.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
TASKS_FILE = DATA / "quests.json"
GRAPH_FILE = DATA / "quest-graph.json"
OUT_FILE = ROOT / "content" / "javascripts" / "quest-tree-data.js"

# 列序 = 任务图鉴的商人页顺序（mkdocs.yml 第十篇的商人子项）。
TRADER_ORDER = [
    "mechanic", "prapor", "skier", "jaeger", "ragman", "therapist",
    "peacekeeper", "fence", "ref", "btr-driver", "lightkeeper",
]
# 列标题（与 nav 的商人页名一致；Ref 在 nav 里带括号注明）。
TRADER_LABEL = {
    "mechanic": "Mechanic", "prapor": "Prapor", "skier": "Skier",
    "jaeger": "Jaeger", "ragman": "Ragman", "therapist": "Therapist",
    "peacekeeper": "Peacekeeper", "fence": "Fence", "ref": "Ref",
    "btr-driver": "BTR 司机", "lightkeeper": "Lightkeeper",
}

# 布局常量（JS 侧渲染直接用这些数，前端不另写一套）。
ROW_H = 70     # 行距 = 卡片高 56 + 间隙 14
CARD_W = 220
COL_W = 244    # 列宽 = 卡片 220 + 列间距 24
PAD_X = 40     # 左起留边
PAD_Y = 118    # 顶部留边（列标题占位）


def load_tasks() -> list[dict]:
    q = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    tasks = q if isinstance(q, list) else q.get("tasks", q)
    if isinstance(tasks, dict):
        tasks = list(tasks.values())
    return tasks


def load_edges() -> dict[str, list[str]]:
    """任务 id → 前置 id 列表（只取边，丢状态词——树不区分前置状态类型）。"""
    g = json.loads(GRAPH_FILE.read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    for tid, es in (g.get("edges") or {}).items():
        pres = [e[0] for e in es if e]
        if pres:
            out[tid] = pres
    return out


def inner_clusters(tids: list[str], pre: dict[str, list[str]]) -> list[list[str]]:
    """列内连通分组：并查集，两端同在列内才算连通。

    返回按「簇内最小等级 → 簇大小降序 → 首名」排序后的簇列表；
    簇内按「相对深度 → 等级 → 名称」排。
    """
    tset = set(tids)
    parent = {t: t for t in tids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in tids:
        for p in pre.get(t, []):
            if p in tset:
                parent[find(t)] = find(p)

    groups: dict[str, list[str]] = defaultdict(list)
    for t in tids:
        groups[find(t)].append(t)

    out = []
    for members in groups.values():
        ms = set(members)
        # 相对深度：簇内最长前置链（防环用 visiting 集合）
        depth: dict[str, int] = {}

        def d(t: str, visiting: set) -> int:
            if t in depth:
                return depth[t]
            if t in visiting:      # 数据里理论无环；防一手，遇到就按 0 处理
                return 0
            visiting.add(t)
            pres = [p for p in pre.get(t, []) if p in ms]
            v = 0 if not pres else 1 + max(d(p, visiting) for p in pres)
            visiting.discard(t)
            depth[t] = v
            return v

        for t in members:
            d(t, set())
        members.sort(key=lambda t: (depth[t], MINFO[t]["lv"], MINFO[t]["name"], t))
        out.append(members)

    out.sort(key=lambda g: (min(MINFO[t]["lv"] for t in g), -len(g),
                            MINFO[g[0]]["name"]))
    return out


def main() -> int:
    tasks = load_tasks()
    pre = load_edges()

    global MINFO
    MINFO = {}
    for t in tasks:
        MINFO[t["id"]] = {
            "name": t.get("name") or "",
            "trader": t.get("trader") or "",
            "lv": int(t.get("level") or 0),
            "k": bool(t.get("kappa")),
            "l": bool(t.get("lightkeeper")),
        }

    by_trader: dict[str, list[str]] = defaultdict(list)
    for t in tasks:
        by_trader[MINFO[t["id"]]["trader"]].append(t["id"])

    # 未知商人：有任务落在 TRADER_ORDER 之外时直接报错（数据换了没跟上是工程缺失）。
    unknown = set(by_trader) - set(TRADER_ORDER)
    if unknown:
        sys.exit(f"[错误] 出现 TRADER_ORDER 之外的商人：{sorted(unknown)} —— 补进列序再跑。")

    cols = []
    nodes = []
    for ci, tr in enumerate(TRADER_ORDER):
        x = PAD_X + ci * COL_W
        tids = by_trader.get(tr, [])
        cols.append([tr, TRADER_LABEL[tr], x, len(tids)])
        seq = 0
        for grp in inner_clusters(tids, pre):
            for tid in grp:
                info = MINFO[tid]
                flags = ("k" if info["k"] else "") + ("l" if info["l"] else "")
                nodes.append([tid, info["name"], ci, PAD_Y + seq * ROW_H,
                              info["lv"], flags])
                seq += 1

    # 边：前置 → 后续（渲染层按这个方向画）。按 (to 的列, to 的 y) 排序输出，
    # 保证确定性（check_gen_drift 连跑两遍要比对字节）。
    y_of = {n[0]: (n[2], n[3]) for n in nodes}
    edges = []
    for tid, pres in pre.items():
        for p in pres:
            if p in y_of and tid in y_of:
                edges.append((p, tid))
    edges.sort(key=lambda e: (y_of[e[1]][0], y_of[e[1]][1], y_of[e[0]][0], y_of[e[0]][1]))

    max_rows = max((len(by_trader.get(tr, [])) for tr in TRADER_ORDER), default=0)
    W = PAD_X + len(TRADER_ORDER) * COL_W + PAD_X - (COL_W - CARD_W)
    H = PAD_Y + max_rows * ROW_H + 60

    # 对账
    if len(nodes) != len(tasks):
        sys.exit(f"[错误] 节点数 {len(nodes)} ≠ 任务数 {len(tasks)}")
    total_edges = sum(len(v) for v in pre.values())
    if len(edges) != total_edges:
        sys.exit(f"[错误] 边数 {len(edges)} ≠ 图数据边数 {total_edges}")

    payload = {
        "generated": "gen_quest_tree.py",
        "baseline": tasks[0].get("baseline") or "",
        "source": "scripts/data/quests.json + scripts/data/quest-graph.json"
                  "（json.tarkov.dev/regular，持久 PvP）",
        "W": W, "H": H,
        "ROW_H": ROW_H, "CARD_W": CARD_W, "COL_W": COL_W,
        "PAD_X": PAD_X, "PAD_Y": PAD_Y,
        # cols: [商人slug, 列标题, x, 该列任务数]
        "cols": cols,
        # nodes: [id, 中文名, 列序号, y, 接取等级, 标记(k=Kappa / l=Lightkeeper)]
        "nodes": nodes,
        # edges: [前置id, 后续id]
        "edges": [list(e) for e in edges],
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
    }

    header = (
        "/* 由 scripts/gen_quest_tree.py 生成，请勿手工编辑。\n"
        "   用途：「任务全景图」（content/quests/tree.md）的节点/边/布局数据。\n"
        "   字段：cols=[slug,标题,x,任务数]；nodes=[id,名,列序号,y,等级,标记]；\n"
        "        edges=[前置id,后续id]；W/H=画布尺寸；ROW_H/CARD_W/COL_W/PAD_*=布局常量。\n"
        "   数据源：scripts/data/quests.json + quest-graph.json（二级，json.tarkov.dev）。\n"
        "   重抓任务数据后按 gen_progress_manifest.py 头部写的顺序重跑，本脚本排在其后。 */\n"
    )
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_bytes(
        (header + "window.TARKOV_QUEST_TREE = "
         + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
        .encode("utf-8"))

    kb = OUT_FILE.stat().st_size / 1024
    print(f"已写 {OUT_FILE.relative_to(ROOT)}（{kb:.0f} KB）："
          f"{len(nodes)} 个节点 / {len(edges)} 条边 / 画布 {W}×{H}")
    for tr, label, x, n in cols:
        print(f"  {label:<12} {n:>3} 任务  列 x={x}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
