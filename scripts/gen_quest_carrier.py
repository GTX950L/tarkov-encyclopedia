#!/usr/bin/env python3
"""任务携带清单：把「出发前必须带进图的东西」从目标类型里显式提出来。

要解决的两个读者痛点（2026-10-07 读者原话）：

  ① 「查找我正在做的任务时，我不知道这个任务是不是需要我额外带钥匙或者
      其他物品进图放置，总是到了任务地点才发现东西没带」
  ② 「一个后期要交的物品，我在前期就找到了，不知道是不是应该保留」

**为什么痛点① 会出现**：任务明细里「要求」那一节是**按目标类型的顺序**平铺的，
`放置物品` / `放置任务物品` / `标记` / `使用物品` 这四种目标**混在** `找物品`
`击杀` `撤离` 之间，而且**没有任何标记说它要求你从图外带东西进来**。
读者必须逐条读、并在脑子里做一次「类型 → 要不要自带」的映射。
页首索引表的标记列也只标了 `必须战局内找到`（`fir`）与 `需钥匙`，
**「要自带工具」这一类完全没标**——而它恰恰是最容易白跑一趟的那类。

**为什么痛点② 会出现**：站内已有一节「物品需求反查」（gen_quest_items.py 写的），
但它是**任务 → 物品**的方向（这张物品被几个任务要），
读者手上拿着一个物品想知道「哪个任务要它」时，**站里没有「物品 → 任务」这一跳**。
而且那一节只列「被 3 个及以上任务需要」的物品——**只被 1 个任务需要的 600 多种
反而查不到**，而那恰恰是最常见的「我这捡到的是不是有用」的场景。

本脚本产出两份数据，各自解决一个方向：

  quests_carrier.json  任务 → 「必须带进图的物品 + 需要的钥匙」   ← 治痛点①
  items_index.json     物品 → 「哪些任务要它 / 该不该留」        ← 治痛点②

**口径（两条，都是刻意收窄的）**：

  · 「必须带进图」只认**四种目标类型**：plantItem / plantQuestItem / mark / useItem。
    这四种的定义就是「你得把东西带进图里放下去/用掉」。
    `findItem`（在图里找到）与 `giveItem`（交给商人）**不算**——前者不需要带，
    后者只需要最后交的时候人在就行。
  · 「该不该留」只认**上交类与任务物品类**：giveItem / giveQuestItem /
    findQuestItem / plantQuestItem。也就是「这东西在某个任务里是要交的」。
    仅被 findItem 需要的（纯战局内收集）不标——那种东西捡了不占任务位。

**不做什么**（与站内既有边界一致）：
  · 不写「物品哪里刷」——那是 loot 条目与攻略的职责，且多数点位属坐标，站内不收。
  · 不写商人购买途径的**价格**——价格随版本与声望变动，站内 recipes 页已另有口径。
    本脚本只回答「能不能从商人换到／买到」这一**是非题**，价格去配方页看。

用法：
    python scripts/gen_quest_carrier.py         # 读现有数据生成
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUESTS = ROOT / "scripts" / "data" / "quests.json"
RECIPES = ROOT / "scripts" / "data" / "recipes.json"
OUT_CARRIER = ROOT / "scripts" / "data" / "quests_carrier.json"
OUT_ITEMS = ROOT / "scripts" / "data" / "items_index.json"

TRADER = {
    "mechanic": "Mechanic", "prapor": "Prapor", "skier": "Skier", "jaeger": "Jaeger",
    "ragman": "Ragman", "therapist": "Therapist", "peacekeeper": "Peacekeeper",
    "fence": "Fence", "ref": "Ref", "btr-driver": "BTR 司机",
    "lightkeeper": "Lightkeeper",
}

# 「必须带进图」的四类目标 —— 定义就是要把东西带进去放/用
BRING = {"plantItem": "放置", "plantQuestItem": "放置任务物品",
         "mark": "放置（标记）", "useItem": "使用"}

# 「值得留」的五类—— 这些物品在某个任务里**要被带进去交 / 放 / 找**。
# ⚠️ plantItem / plantQuestItem 必须在列（2026-10-07 实测修正）：
#   第一版只列上交四类，结果「WIFI摄像头」这类**只出现在放置目标里**的物品
#   显示成「0 个任务要用」—— **恰好把最该留的那一类标成了不用留**，
#   而它正是痛点②（「前期捡到不知道该不该留」）最典型的那一格。
#   判据是「这东西要靠你主动带/找/交进任务流程」，
#   而不是「它是上交还是放置」。反过来说，只有 findItem 那种
#   **纯战局内收集**的才不必特意留。
KEEP = {"giveItem", "giveQuestItem", "findQuestItem", "plantItem", "plantQuestItem"}

# 目标文本里这些词用来判断「这条目标本身是不是在局内获取该物品」的**兜底**。
# ⚠️ 主判据不是它（见 `found_in_raid`），它只用于该物品在**本任务里没有
# 任何「找到」类目标**的边缘情形。
GIVEN_HINT = ("找到并获取", "取得", "在战局中找到")


def main() -> None:
    if not QUESTS.exists():
        sys.exit("找不到 scripts/data/quests.json")
    d = json.loads(QUESTS.read_text(encoding="utf-8"))
    tasks = d["tasks"]
    fetched = d.get("fetched", "")

    # ── 方向一：任务 → 必须带进图的东西 ────────────────────────────────
    carriers = []
    for q in tasks:
        # **先算出「本任务里哪些物品是局内获取的」**—— 这是判「要不要自备」的唯一
        # 正确口径，而且**必须是跨目标判断**。
        #
        # 反面教材（第一版就是这么写的，实测栽在「化工厂的秘密」上）：
        #   那条任务有两个目标 ——「在海关实验楼找到并获取精密工具」
        #   ＋「在工厂的实验室储藏间藏匿精密工具」，
        #   而**放置那条的目标文本里根本没有「找到」二字**，
        #   于是逐目标判断会得出「精密工具盒要自备」——**错的**，
        #   因为它其实是同一局里先捡到再放下，根本不用从仓库带。
        # 反过来若只看「有没有 findQuestItem」也不够：
        #   有些任务的物品是**纯自备**的（钥匙扣、专用工具），压根没有找它的目标。
        # 所以两条判据合起来才完整：
        #   ① 本任务存在该物品的「找到」类目标 → 局内顺路带，不用自备
        #   ② 否则才要出发前从仓库带
        found_types = {"findItem", "findQuestItem"}
        raid_obtained = set()
        for o in q["objectives"]:
            if o.get("type") in found_types:
                for nm in (o.get("items") or []):
                    if nm:
                        raid_obtained.add(nm)

        bring = []
        for o in q["objectives"]:
            act = BRING.get(o.get("type", ""))
            if not act:
                continue
            for name in (o.get("items") or []):
                if not name:
                    continue
                bring.append({
                    "item": name,
                    "act": act,
                    "givenInRaid": name in raid_obtained,
                    "maps": o.get("maps") or [],
                })
        if not bring and not q.get("keys"):
            continue
        # **同一物品在同一任务里去重**（实测「破镜重圆 - 安保」的 pack 里 WIFI摄像头
        # 出现 4 次——那是 4 个标记点，但**准备清单只需要列一次**，
        # 带够数量出门即可）。maps 取并集，让读者知道要去哪几张图。
        merged: dict[str, dict] = {}
        for b in bring:
            k = b["item"]
            if k not in merged:
                merged[k] = {"item": k, "act": b["act"],
                             "givenInRaid": b["givenInRaid"], "maps": []}
            for m in b["maps"]:
                if m not in merged[k]["maps"]:
                    merged[k]["maps"].append(m)
        bring = list(merged.values())
        carriers.append({
            "id": q["id"],
            "name": q["name"],
            "trader": TRADER.get(q.get("trader"), q.get("trader") or ""),
            "keys": q.get("keys") or [],
            "bring": bring,
            # 「出发前从仓库带」＝ 自己带 且 本任务里没有「找到它」的那一步
            "pack": [b for b in bring if not b["givenInRaid"]],
        })

    # ── 方向二：物品 → 哪些任务要它 ──────────────────────────────────
    # item -> {keep: [任务摘要], questOnly: [..], maps: {..}}
    idx: dict[str, dict] = {}

    def slot(name: str) -> dict:
        return idx.setdefault(name, {"keep": [], "questOnly": [], "maps": set()})

    for q in tasks:
        tr = TRADER.get(q.get("trader"), q.get("trader") or "")
        for o in q["objectives"]:
            ty = o.get("type", "")
            for name in (o.get("items") or []):
                if not name:
                    continue
                rec = {
                    "task": q["name"], "trader": tr, "level": q["level"],
                    "qid": q["id"], "type": ty,
                }
                if ty in KEEP:
                    slot(name)["keep"].append(rec)
                if o.get("type") == "findQuestItem" or o.get("type") == "giveQuestItem":
                    slot(name)["questOnly"].append(rec)
                for m in (o.get("maps") or []):
                    slot(name)["maps"].add(m)

    # ── 商人兑换途径（能对上的部分）──────────────────────────────────
    # ⚠️ **覆盖率有限，这是事实不是缺陷**：recipes.json 的 names 只收录
    # 「出现在制作 / 以物换物配方里」的物品（1167 条），而任务涉及的物品有 3744 种。
    # 反查只能命中两者交集（约 800 种）。**命不中的不等于买不到**，
    # 只表示「它不在本站收录的配方里」—— 页面上照实标注覆盖率，不假装全都有。
    trades: dict[str, list] = defaultdict(list)
    coverage = {"names": 0, "matched": 0}
    if RECIPES.exists():
        r = json.loads(RECIPES.read_text(encoding="utf-8"))
        name2id: dict[str, list[str]] = defaultdict(list)
        for iid, nm in (r.get("names") or {}).items():
            if nm:
                name2id[nm].append(iid)
        coverage["names"] = len(name2id)
        for b in r.get("barters") or []:
            pid = b.get("product")
            for nm, ids in name2id.items():
                if pid in ids:
                    trades[nm].append({
                        "trader": b.get("trader") or "",
                        "level": b.get("level"),
                        "task": bool(b.get("task")),
                    })
    coverage["matched"] = sum(1 for k in idx if k in trades)

    # ── 落盘 ─────────────────────────────────────────────────────────
    payload = {
        "fetched": fetched,
        "baseline": "持久 PvP",
        "bringTypes": BRING,
        "stats": {
            "tasksTotal": len(tasks),
            "tasksWithCarrier": len(carriers),
            "withPack": sum(1 for c in carriers if c["pack"]),
            "withKeys": sum(1 for c in carriers if c["keys"]),
        },
        "carriers": carriers,
    }
    OUT_CARRIER.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已写 {OUT_CARRIER.relative_to(ROOT)}"
          f"（{len(carriers)} 个任务有携带项，{payload['stats']['withPack']} 个需自备物品，"
          f"{payload['stats']['withKeys']} 个需钥匙）")

    items = {}
    for name, v in idx.items():
        # keep：`[[任务名, 任务id 或 None], …]` —— 名字给读者看、id 给「跳任务详情页」用。
        # ⚠️ **重名任务（站内 10 个，如「新起点」一名对 4 个 id）给 None** ——
        #    硬取第一个会指到另一个任务上，而读者根本看不出来。判据与图鉴侧
        #    item_pages.json 的 dups、gen_quests 的 questLink() 完全一致。
        by_name: dict[str, set] = {}
        for r in v["keep"]:
            by_name.setdefault(r["task"], set()).add(r["qid"])
        keep_tasks = sorted(
            ([n, sorted(ids)[0] if len(ids) == 1 else None]
             for n, ids in by_name.items()),
            key=lambda x: x[0])
        items[name] = {
            "keep": keep_tasks,
            "n": len(keep_tasks),
            # 只有 1 个任务要 → 「只被一个任务要」，也照样要能查到（痛点② 的主场景）
            "traders": sorted({r["trader"] for r in v["keep"]}),
            "questOnly": sorted({r["task"] for r in v["questOnly"]}),
            "maps": sorted(v["maps"]),
            "barter": trades.get(name) or [],
        }
    # ── 物品 → 图鉴位置（供前端把物品名变成链接）─────────────────────
    #
    # 读者手上拿着一件物品时，下一跳通常是「这东西长什么样、还有什么属性」——
    # 那一跳由第九篇·物品图鉴承接。要跳得准，就得知道这个名字在图鉴的哪一页。
    #
    # ⚠️ **只对「本页收录的物品」出映射**，不把图鉴的全量映射（4548 个唯一名、
    # 327 KB）搬过来 —— 前端只用得上这 833 个名字里的子集，全搬是纯浪费。
    # ⚠️ **重名必须走搜索**：图鉴里有 50 个名字对应多件物品（不同配色/版本），
    # 硬指某一件会**指到另一件物品上，而读者看不出来**。这类给 null，
    # 前端改链到 `catalog/#q=<名字>` 让读者自己挑。
    pages_map: dict[str, list | None] = {}
    ip = ROOT / "scripts" / "data" / "item_pages.json"
    if ip.exists():
        pd = json.loads(ip.read_text(encoding="utf-8"))
        exact = pd.get("pages") or {}
        dups = set(pd.get("dups") or [])
        for _name in items:
            if _name in exact:
                pages_map[_name] = list(exact[_name])     # [slug, id] → 精确链接
            elif _name in dups:
                pages_map[_name] = None                   # 重名 → 走搜索
        n_exact = sum(1 for v in pages_map.values() if v)
        n_dup = sum(1 for v in pages_map.values() if v is None)
        print(f"物品→图鉴映射：精确 {n_exact} ｜ 重名走搜索 {n_dup} ｜ "
              f"不在图鉴 {len(items) - n_exact - n_dup}（任务专属道具）")
    else:
        print(f"⚠️ 找不到 {ip.relative_to(ROOT)} —— 物品名将不带图鉴链接。"
              f"先跑 scripts/gen_items_catalog.py 生成它。")

    payload2 = {
        "fetched": fetched,
        "coverage": coverage,
        "note": ("barter 字段只对「出现在 recipes.json 的 names 里」的物品有值；"
                 "未命中不等于买不到，只表示不在本站收录的配方里"),
        "items": items,
        "pages": pages_map,
    }
    OUT_ITEMS.write_text(
        json.dumps(payload2, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已写 {OUT_ITEMS.relative_to(ROOT)}"
          f"（{len(items)} 种物品，其中 {coverage['matched']} 种能查到商人兑换途径"
          f"／names 共 {coverage['names']} 种）")

    # ── 前端数据（JS 包装）─────────────────────────────────────────────
    # 为什么再落一份 .js 而不是让浏览器去 fetch .json：
    #   站内其它交互部件（progress / recipes / season-planner）**全部走 JS 文件**，
    #   一致性优先；而且 .json 在 file:// 下会被 CORS 挡掉，
    #   读者把站点目录直接双击打开时那一份就废了。
    out_js = ROOT / "content" / "javascripts" / "items_index.js"
    out_js.write_text(
        "/* 自动生成，请勿手改 —— 由 scripts/gen_quest_carrier.py 生成。\n"
        "   数据源：scripts/data/items_index.json（抓取日 " + fetched + "）。*/\n"
        "window." + "TARKOV_ITEM_INDEX = "
        + json.dumps(payload2, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8")
    print(f"已写 {out_js.relative_to(ROOT)}"
          f"（{out_js.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()