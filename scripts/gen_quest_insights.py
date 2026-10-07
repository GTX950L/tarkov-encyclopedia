#!/usr/bin/env python3
"""生成《任务图鉴》的**优先级速查**一节，以及交互筛选器用的数据文件。

为什么单开一个脚本（而不是并进 gen_quest_items.py）：

    `gen_quest_items.py` 产的是「**反查**」——按物品 / 按条件把任务聚合一遍，
    回答的是「**有什么**」。本脚本产的是「**优先级**」——沿前置树算出
    「做完它能放开多少」，回答的是「**先做哪个**」。两者数据源相同、问题不同，
    混在一个文件里会让那一节越滚越像第二份速查表。

两个产物（**同一份计算、两个消费者**，所以必须同一个脚本产出，否则口径必然漂）：

    1. `content/quests/index.md` 里 `AUTO-GEN:QUEST-INSIGHTS` 之间的章节 —— 给人读；
    2. `content/javascripts/quests-index-data.js` —— 给筛选器用（`quests-filter.js`）。

数据源与口径：

    · `scripts/data/quests.json`       —— 页面渲染缓存（名字 / 商人 / 钥匙 / 经验 / 地图 / 标记）
    · `scripts/data/quest-graph.json`  —— **只含 id 的边表**

    ⚠️ **必须用 id 边表连边，不能用名字。**`quests.json` 的 `prereqs` 只留了前置的
    「中文名 / 商人 / 状态」，而全站有 **10 个重名任务**（涉及 23 条记录）——
    按名字连边会静默连错，而且连错了看不出来。这是 `gen_quest_graph.py` 当初
    单开一份边表的理由，本脚本沿用。

    ⚠️ **只算「完成」边。**全图 238 条边里 224 条带 `complete`（其中 10 条同时标
    `active`、4 条同时标 `failed`）。后两类**不参与**解锁判定 —— 与「我的进度」
    页的前置反推同一口径。

用法：
    python scripts/gen_quest_insights.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QSRC = ROOT / "scripts" / "data" / "quests.json"
GSRC = ROOT / "scripts" / "data" / "quest-graph.json"
TARGET = ROOT / "content" / "quests" / "index.md"
JS_OUT = ROOT / "content" / "javascripts" / "quests-index-data.js"

START = "<!-- AUTO-GEN:QUEST-INSIGHTS:START -->"
END = "<!-- AUTO-GEN:QUEST-INSIGHTS:END -->"

TRADER = {
    "mechanic": "Mechanic", "prapor": "Prapor", "skier": "Skier", "jaeger": "Jaeger",
    "ragman": "Ragman", "therapist": "Therapist", "peacekeeper": "Peacekeeper",
    "fence": "Fence", "ref": "Ref", "btr-driver": "BTR 司机", "lightkeeper": "Lightkeeper",
}

TOP_UNLOCK = 15      # 「间接解锁」榜首表列几行
TOP_DEPTH = 6        # 最长前置链列几行
MERGE_MIN = 2        # 几个「完成」前置才算汇合点


def cell(s: str) -> str:
    """表格单元格：竖线转义，避免把表格切坏。"""
    return (s or "").replace("|", "\\|").replace("\n", " ").strip()


def main() -> int:
    for p in (QSRC, GSRC):
        if not p.exists():
            sys.exit(f"找不到 {p.relative_to(ROOT)}")

    cache = json.loads(QSRC.read_text(encoding="utf-8"))
    tasks = cache["tasks"]
    fetched = cache.get("fetched", "")
    graph = json.loads(GSRC.read_text(encoding="utf-8"))
    edges = graph["edges"]

    by_id = {t["id"]: t for t in tasks}
    cache_ids = set(by_id)
    edge_ids = set(edges)

    # —— 对账①：边表里的 id 必须都在渲染缓存里 ——
    orphan = sorted((edge_ids | {p for rs in edges.values() for p, _ in rs}) - cache_ids)
    if orphan:
        sys.exit(f"[错误] 边表里有 {len(orphan)} 个 id 在 quests.json 里找不到：{orphan[:3]}\n"
                 "  处理：跑 gen_quests.py --fetch 与 gen_quest_graph.py --fetch 重建两份数据。")

    # —— 只用 complete 边建图：pred[前置] = {需要它的任务} ——
    pred: dict[str, set] = defaultdict(set)
    complete_edges = 0
    for tid, reqs in edges.items():
        for pid, st in reqs:
            if "complete" in st:
                pred[pid].add(tid)
                complete_edges += 1
    all_edges = sum(len(v) for v in edges.values())

    def closure(root_id: str) -> set:
        """下游闭包：做完 root_id 之后，间接被放开的全部任务。"""
        seen: set[str] = set()
        stack = [root_id]
        while stack:
            x = stack.pop()
            for y in pred.get(x, ()):
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        return seen

    unlock = {t["id"]: closure(t["id"]) for t in tasks}
    depth_cache: dict[str, int] = {}

    def depth(tid: str) -> int:
        """最长前置链：从最上游走到它要几步（1 = 无前置）。"""
        if tid in depth_cache:
            return depth_cache[tid]
        ps = [p for p, st in edges.get(tid, []) if "complete" in st]
        depth_cache[tid] = 1 + max((depth(p) for p in ps), default=0)
        return depth_cache[tid]

    def label(t: dict) -> str:
        return f"{t['name']}（{TRADER.get(t.get('trader'), t.get('trader') or '—')}）"

    # —— 中文名会撞：全站 10 个名字重复（涉及 23 条记录）。表里同名并列时必须消歧，
    #    否则读者会把两行当成同一行的重复输出。**消歧用具名英文名**——它是数据源里
    #    唯一的无歧义标识（站内既有判据：「认英文名最稳」）。
    name_count = Counter(t["name"] for t in tasks)

    def nm(t: dict) -> str:
        """任务名；若中文名不唯一，附英文名消歧。"""
        return f"{t['name']}（{t.get('en')}）" if name_count[t["name"]] > 1 else t["name"]

    # —— 一、解锁收益 ——
    rank = sorted(
        ((len(unlock[t["id"]]), len(pred.get(t["id"], ())), t) for t in tasks),
        key=lambda r: (-r[0], -r[1], r[2]["name"]),
    )
    top_unlock = [r for r in rank if r[0] > 0][:TOP_UNLOCK]
    blocked = sum(1 for r in rank if r[0] > 0)
    leaves = len(tasks) - blocked

    # —— 二、汇合点 ——
    merges = []
    for tid, reqs in edges.items():
        ps = [p for p, st in reqs if "complete" in st]
        if len(ps) >= MERGE_MIN:
            merges.append((len(ps), by_id[tid], [by_id[p] for p in ps]))
    merges.sort(key=lambda m: (-m[0], m[1]["name"]))

    # —— 三、最长前置链 ——
    deepest = sorted(((depth(t["id"]), t) for t in tasks), key=lambda r: (-r[0], r[1]["name"]))

    # —— 四、任务与钥匙 ——
    key_tasks: dict[str, list] = {}
    for t in tasks:
        for k in t.get("keys") or []:
            key_tasks.setdefault(k, []).append(t)
    keys_by_map: dict[str, set] = defaultdict(set)
    keys_nomap: list[str] = []
    for k, ts in key_tasks.items():
        maps = {t.get("map") for t in ts if t.get("map")}
        if not maps:
            keys_nomap.append(k)
        for m in maps:
            keys_by_map[m].add(k)
    n_key_tasks = sum(1 for t in tasks if t.get("keys"))

    # ======================= 写 markdown =======================
    out: list[str] = [
        "## 🎯 优先级速查：做完它，一次放开多少 ｜ 汇合点 ｜ 钥匙反查",
        "",
        "> **口径**：解锁关系取自任务定义的 `taskRequirements`，**只算状态为「完成」的边**"
        f"（全图 **{all_edges}** 条边里 **{complete_edges}** 条带 `complete`，"
        "其中 10 条同时标「进行中」、4 条同时标「失败」，后两类**不参与**解锁判定）"
        "——与[我的进度](progress.md) 的前置反推**同一口径**。",
        "> ",
        "> ⚠️ **「解锁」不等于「可接」。**下面算的只是**前置这一层**；真正能不能接，还要过"
        "商人的**忠诚等级**与**声望**门槛（含 Fence 的负值声望）——那一层在[我的进度](progress.md)"
        "的「门槛」里判。**两个数都要满足，任务才会出现在列表里。**",
        "",
        "### 一、直接解锁 vs 间接解锁：两个数差得很远",
        "",
        "一条任务链是**串起来**的：做完 A 放开 B，做完 B 才放开 C。所以只看「直接放开几个」会严重低估 ——"
        "下面第四列才是**做完它之后、沿链一路算下去总共放开多少**。",
        "",
        "| 任务 | 直接 | **间接（合计）** | 商人 | 地图 |",
        "|------|------|------------------|------|------|",
    ]
    for n, direct, t in top_unlock:
        out.append(f"| {cell(nm(t))} | {direct} | **{n}** | "
                   f"{TRADER.get(t.get('trader'), t.get('trader') or '—')} | {cell(t.get('map') or '—')} |")

    head = top_unlock[0]
    out += [
        "",
        f"> **榜首「{cell(nm(head[2]))}」的形态最能说明问题**：它只**直接**放开 "
        f"{head[1]} 个，看起来平平无奇；但沿链算下去是 **{head[0]} 个** —— "
        "因为整条 Mechanic 线挂在它后面。**看「间接」那一列，别看「直接」。**",
        "",
        f"**另一半也同样重要：{len(tasks)} 个任务里 {leaves} 个（{leaves * 100 // len(tasks)}%）不阻塞任何任务。**"
        "这些是**链尾与支线**——做完就结束，不存在「先做它还是先做别的」的取舍。"
        "**只有上表里那些有下游的任务，才值得排优先级。**",
        "",
        "### 二、汇合点：必须同时推进几条线才到得了",
        "",
        f"需要 **{MERGE_MIN} 个及以上「完成」前置**的任务共 **{len(merges)}** 个。"
        "它和普通任务的区别是：**只推一条线永远到不了**，必须几个商人的线一起走。",
        "",
        "| 任务 | 前置数 | 前置（都要完成） |",
        "|------|--------|------------------|",
    ]
    for n, t, pts in merges:
        shown = "、".join(cell(nm(x)) for x in pts[:6])
        if len(pts) > 6:
            shown += f" 等 {len(pts)} 个"
        out.append(f"| {cell(nm(t))} | **{n}** | {shown} |")
    if merges:
        m0 = merges[0]
        out += [
            "",
            f"> **「{cell(nm(m0[1]))}」有 {m0[0]} 个前置**，是全场最典型的汇合点"
            "——它不会因为你把某一个商人刷到底而解锁。",
        ]

    out += [
        "",
        "### 三、最深的前置链",
        "",
        "前置链的长度决定了**一条线要做多久才见底**。下面按「从最上游走到它要几步」排序（1 = 无前置，可直接接）。",
        "",
        "| 深度 | 任务 | 商人 |",
        "|------|------|------|",
    ]
    for d, t in deepest[:TOP_DEPTH]:
        out.append(f"| **{d}** | {cell(nm(t))} | "
                   f"{TRADER.get(t.get('trader'), t.get('trader') or '—')} |")
    out += [
        "",
        f"> **最深的一条是 {deepest[0][0]} 层。**这意味着从零开始做，"
        f"到「{cell(nm(deepest[0][1]))}」之前要先穿过 {deepest[0][0] - 1} 个前置任务 ——"
        "**深链条不适合临时起意，适合早早起头、每天推一格。**",
        "",
        "### 四、任务与钥匙：去这张图要带哪几把",
        "",
        f"全站 **{n_key_tasks}** 个任务需要钥匙，涉及 **{len(key_tasks)}** 把。"
        "下表**按地图归拢** —— 出发前看一眼今晚去哪张图就够了；"
        "逐条任务的钥匙列在各商人页的明细里。",
        "",
        "| 地图 | 钥匙数 | 钥匙 |",
        "|------|--------|------|",
    ]
    for m, ks in sorted(keys_by_map.items(), key=lambda x: (-len(x[1]), x[0])):
        out.append(f"| {cell(m)} | **{len(ks)}** | {'、'.join(cell(k) for k in sorted(ks))} |")
    if keys_nomap:
        out += [
            f"| （数据未给地图） | {len(keys_nomap)} | {'、'.join(cell(k) for k in sorted(keys_nomap))} |",
        ]
    out += [
        "",
        f"> **一个反直觉的结论：钥匙基本是「一把配一个任务」的**（{len(key_tasks)} 把 / {n_key_tasks} 个任务）。"
        "所以**不存在「挑覆盖率最高的那把」这种算法** —— "
        "「该买哪把」不看通用性，只看**你要做的那条链有没有让你进那扇门**。",
        "> ",
        "> 地图一列是**任务自己的地图归属**，而该字段只有 263 个任务带"
        "（见上方「关键标记与条件」）——所以有 4 把钥匙归不到地图，不是漏了，是**数据源没给**。",
    ]

    # —— 五、读表前提：中文名会撞 ——
    by_name: dict[str, list] = defaultdict(list)
    for t in tasks:
        by_name[t["name"]].append(t)
    dup_names = sorted(n for n, g in by_name.items() if len(g) > 1)
    dup_records = sum(len(by_name[n]) for n in dup_names)
    faction_split = sorted(
        n for n in dup_names
        if len({t.get("faction") or "" for t in by_name[n]}) > 1
        and all(t.get("faction") for t in by_name[n])
    )
    numbered = sorted(n for n in dup_names if n not in faction_split)

    # 「端点重复条目」用的是商人页上的签名（见 gen_quests.py 的 _sig）——这里复算一遍，
    # 让本节的举例与页面上真实出现的标记**严格一致**，而不是手写两个名字。
    def _sig(t: dict) -> tuple:
        return (t["name"], t["level"], t["exp"], len(t["objectives"]), len(t["prereqs"]),
                tuple(t["keys"]), len(t["failConditions"]),
                len((t.get("rewards") or {}).get("items") or []),
                len((t.get("rewards") or {}).get("standing") or []),
                t.get("faction") or "")

    sig_count = Counter(_sig(t) for t in tasks)
    exact_dup = sorted({t["name"] for t in tasks if sig_count[_sig(t)] > 1})
    # 三行必须**互斥**，否则同一个名字会出现在两行里，读者分不清它属于哪一类。
    numbered = [n for n in numbered if n not in set(exact_dup)]

    out += [
        "",
        "### 五、一条读表前提：中文名会撞，认英文名",
        "",
        f"数据源里 **{len(dup_names)} 个中文名对应了不止一个任务**（合计 **{dup_records}** 条记录）。"
        "它们**不是本地录入错误**，而是三类成因 —— 分不清会拿错钥匙、跑错图：",
        "",
        "| 成因 | 例子 | 怎么认 |",
        "|------|------|--------|",
        f"| **阵营分支**：同一件事在 BEAR / USEC 两条平行线上各一份 | "
        f"{'、'.join(cell(x) for x in faction_split)} | 看**「仅 BEAR / 仅 USEC」标记** —— "
        "你自己的阵营只能做其中一条 |",
        f"| **同一条链的连续几节，中文名没跟着编号** | "
        f"{'、'.join(cell(x) for x in numbered[:3])} 等 | 看**英文名末尾的数字** |",
        f"| **数据源端确实存在内容相同的两条记录** | "
        f"{'、'.join(cell(x) for x in exact_dup) or '（本版数据无）'} | "
        "商人页把**其中内容相同的那几条**标成**「端点重复条目」** |",
        "",
        "> **判据：中文名会撞，英文名不会。** 每个任务的明细里都列了英文名，"
        "遇到同名时**认英文名最稳**（与[引用说明](../docs/citation.md) 同一条原则）。"
        "**本节所有表格中，凡中文名不唯一的都自动附了英文名。**",
    ]

    block = "\n".join(out)

    text = TARGET.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 {START} / {END} 标记。")
    head_txt, rest = text.split(START, 1)
    _, tail = text.split(END, 1)
    TARGET.write_text(f"{head_txt}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")

    # ======================= 写筛选器数据 =======================
    # 明细页锚点：与 gen_quests.py 的 anchor_of 同一规则 —— 按**该商人页内的顺序**
    # 编号（q01…），顺序取自 quests.json 的原始顺序。改了这里必须同步改那边。
    seq: Counter = Counter()
    link_of: dict[str, str] = {}
    for t in tasks:
        key = t.get("trader") or ""
        seq[key] += 1
        link_of[t["id"]] = f"{key}#q{seq[key]:02d}"

    rows = []
    for t in tasks:
        rows.append([
            t["name"],
            t.get("en") or "",
            TRADER.get(t.get("trader"), t.get("trader") or "—"),
            t.get("level") or 0,
            t.get("map") or "",
            list(t.get("keys") or []),
            t.get("faction") or "",
            "".join([("k" if t.get("kappa") else ""), ("l" if t.get("lightkeeper") else "")]),
            1 if t.get("failConditions") else 0,
            1 if t.get("delay") else 0,
            1 if t.get("restartable") else 0,
            t.get("exp") or 0,
            len(pred.get(t["id"], ())),
            len(unlock[t["id"]]),
            link_of[t["id"]],
        ])
    rows.sort(key=lambda r: (r[2], -r[13], r[0]))

    payload = {
        "generated": date.today().isoformat(),
        "baseline": cache.get("generated") or fetched,
        "source": cache.get("source") or "",
        "total": len(rows),
        "edgeCount": all_edges,
        "completeEdgeCount": complete_edges,
        "cols": ["name", "en", "trader", "level", "map", "keys", "faction", "flags",
                 "fail", "delay", "restart", "exp", "dUnlock", "cUnlock", "link"],
        "tasks": rows,
    }
    JS_OUT.write_text(
        "/* 由 scripts/gen_quest_insights.py 生成，请勿手工编辑。\n"
        "   供 quests/filter 的筛选器使用；字段顺序见 cols。\n"
        "   本文件**不进 extra_javascript** —— 由 quests-filter.js 按需注入。 */\n"
        "window.TARKOV_QUEST_INDEX = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",   # newline 留空 = Windows 上写成 CRLF，与站内其余文件一致
    )

    # —— 对账②：写出去的行数 / 解锁口径自洽 ——
    asserts = [
        (len(rows) == len(tasks), f"数据行 {len(rows)} ≠ 任务数 {len(tasks)}"),
        (complete_edges <= all_edges, "complete 边数大于总边数"),
        (blocked + leaves == len(tasks), "有下游 + 叶子 ≠ 任务总数"),
    ]
    for ok, msg in asserts:
        if not ok:
            sys.exit(f"[错误] 对账失败：{msg}")

    # —— 对账③：筛选器里的明细锚点必须真的落在商人页上 ——
    # 锚点规则与 gen_quests.py 的 anchor_of 是**两处实现**，一旦一边改了顺序，
    # 筛选器点进去会静默跳到页顶。逐条对着产物核对，比读代码可靠。
    bad_links: list[str] = []
    page_cache: dict[str, str] = {}
    for r in rows:
        slug, anchor = r[14].split("#", 1)
        if slug not in page_cache:
            p = ROOT / "content" / "quests" / f"{slug}.md"
            page_cache[slug] = p.read_text(encoding="utf-8") if p.exists() else ""
        if f'id="{anchor}"' not in page_cache[slug]:
            bad_links.append(r[14])
    if bad_links:
        sys.exit(f"[错误] {len(bad_links)} 个明细锚点在商人页上不存在：{bad_links[:3]}\n"
                 "  处理：先跑 `python scripts/gen_quests.py` 重建商人页。")
    print(f"对账通过：{len(rows)} 个明细锚点全部存在于对应商人页。")

    print(f"已写 {TARGET.relative_to(ROOT)}：解锁榜 {len(top_unlock)} 行 / 汇合点 {len(merges)} 行 / "
          f"深链 {TOP_DEPTH} 行 / 钥匙 {len(key_tasks)} 把")
    print(f"已写 {JS_OUT.relative_to(ROOT)}：{len(rows)} 行（{JS_OUT.stat().st_size // 1024} KB）")
    print(f"对账通过：边 {all_edges}（complete {complete_edges}）｜有下游 {blocked} + 叶子 {leaves} = {len(tasks)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
