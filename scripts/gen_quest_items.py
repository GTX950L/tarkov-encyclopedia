#!/usr/bin/env python3
"""生成《任务图鉴》里的两节速查：**物品需求反查** 与 **任务速查**。

数据源：scripts/data/quests.json（由 scripts/gen_quests.py 抓取并翻译的官方任务数据）。
写入：只替换 quests/index.md 里 AUTO-GEN 标记之间的内容。

用法：
    python scripts/gen_quest_items.py         # 用现有 quests.json 生成
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "data" / "quests.json"
TARGET = ROOT / "content" / "quests" / "index.md"
START = "<!-- AUTO-GEN:QUEST-EXTRAS:START -->"
END = "<!-- AUTO-GEN:QUEST-EXTRAS:END -->"

# **只统计真正的「需求物品」**——sellItem 的 items 是「卖任何物品」的白名单（几百条），
# 那是一张许可清单，不是需求；把它算进来会把「已密封的武器箱」顶上榜首。
DEMAND = {"giveItem", "findItem", "findQuestItem", "giveQuestItem", "plantItem", "plantQuestItem"}
TRADER = {
    "mechanic": "Mechanic", "prapor": "Prapor", "skier": "Skier", "jaeger": "Jaeger",
    "ragman": "Ragman", "therapist": "Therapist", "peacekeeper": "Peacekeeper",
    "fence": "Fence", "ref": "Ref", "btr-driver": "BTR 司机", "lightkeeper": "Lightkeeper",
}


def main() -> None:
    if not SRC.exists():
        sys.exit("找不到 scripts/data/quests.json")
    d = json.loads(SRC.read_text(encoding="utf-8"))
    tasks = d["tasks"]
    fetched = d.get("fetched", "")

    item_tasks: dict[str, set] = defaultdict(set)
    item_qty: dict[str, int] = defaultdict(int)
    item_traders: dict[str, Counter] = defaultdict(Counter)
    for q in tasks:
        tr = TRADER.get(q.get("trader"), q.get("trader") or "—")
        for o in q["objectives"]:
            if o.get("type") not in DEMAND:
                continue
            for it in o.get("items") or []:
                item_tasks[it].add(q["name"])
                item_qty[it] += o.get("count") or 1
                item_traders[it][tr] += 1

    rows = [(k, len(v), item_qty[k], item_traders[k]) for k, v in item_tasks.items() if len(v) >= 3]
    rows.sort(key=lambda r: (-r[1], -r[2], r[0]))

    # 奖励反查：哪些任务会「给」某件物品——与上面的「需求反查」正好互补
    rew_tasks: dict[str, set] = defaultdict(set)
    rew_qty: dict[str, int] = defaultdict(int)
    for q in tasks:
        for pair in (q.get("rewards") or {}).get("items") or []:
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                continue
            rew_tasks[pair[0]].add(q["name"])
            rew_qty[pair[0]] += pair[1] or 0
    rew_rows = [(k, len(v), rew_qty[k]) for k, v in rew_tasks.items() if len(v) >= 3]
    rew_rows.sort(key=lambda r: (-r[1], -r[2], r[0]))

    # 任务速查
    keys_tasks = [q["name"] for q in tasks if q.get("keys")]
    delay_tasks = [(q["name"], q.get("delay")) for q in tasks if q.get("delay")]
    restart = [q["name"] for q in tasks if q.get("restartable")]
    fails = [q["name"] for q in tasks if q.get("failConditions")]
    kappa = sorted({q["name"] for q in tasks if q.get("kappa")})
    lk = sorted({q["name"] for q in tasks if q.get("lightkeeper")})
    top_exp = sorted(((q.get("exp") or 0, q["name"], TRADER.get(q.get("trader"), "—")) for q in tasks), reverse=True)[:10]

    out = [
        "## 📊 速查：不按商人分的任务线 ｜ 物品需求反查 ｜ 任务速查",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 持久 PvP ｜ 来源：二级（tarkov.dev 官方任务数据）",
        "",
        "### 按「线」看：几条不跟着商人走的任务线",
        "",
        "塔科夫的任务有**两套组织方式**，混起来会漏东西：",
        "",
        "- **按发布者**——本栏目分页的依据，11 位发布者各一页（8 位商人 ＋ Fence ＋ 竞技场 Ref ＋ BTR 司机 ＋ Lightkeeper）；",
        "- **按「线」**——同一条线里的任务**散落在好几个商人的页面里**，只看一个人会做一半。**下面这几条就属于这一类。**",
        "",
        "| 线 | 任务数 | 分布（按商人） |",
        "|----|--------|----------------|",
    ]
    for label, pred in [
        ("**Kappa（收藏家前置）**", lambda q: q.get("kappa")),
        ("**Lightkeeper 解锁链**", lambda q: q.get("lightkeeper")),
        ("**竞技场 Ref**", lambda q: q.get("trader") == "ref"),
        ("**BTR 司机**", lambda q: q.get("trader") == "btr-driver"),
        ("**Fence**", lambda q: q.get("trader") == "fence"),
    ]:
        sub = [q for q in tasks if pred(q)]
        c = Counter(TRADER.get(q.get("trader"), q.get("trader") or "—") for q in sub)
        dist = " / ".join(f"{t} {n}" for t, n in c.most_common())
        out.append(f"| {label} | **{len(sub)}** | {dist} |")

    out += [
        "",
        "> **Kappa 那一行最值得看一眼**：**13 个任务散在 7 个商人下**，其中 Jaeger 名下就有 4 个"
        "——**只盯着一个商人做任务，收藏家一定做到一半断掉**。",
        "",
        "**剧情章节（主线）：唯一完全不按商人发布的一类。** 章节不是「任务」，是一组任务的集合，"
        "**自己的名字在任务数据里根本不存在**，所以本栏目无法按章节分页。"
        "当前十章（游览 / 陨落之天 / 车票 ＋ 七章穿插，含「无名者」）与其前置链、四个结局，"
        "见[剧情章节与主线任务](../entries/story-chapters.md)。",
        "",
        "> ⚠️ **别把「无名者」和「无名者之声」当成一回事**：",
        "> **「无名者」是剧情章节之一**（24 个目标，穿插章）；",
        "> **「无名者之声」（Voice of the Voiceless）不是任务线，是一件特殊设备**——"
        "携带它主动击杀 Scav 会扣 Fence 声望，换来服务费减半与高处 AI 不主动开火。"
        "见[特殊槽装备与工具](../entries/special-equipment.md) 与[阵营关系与交战规则](../entries/engagement-rules.md)。",
        "",
        "### 物品需求反查",
        "",
    ]
    out.append(
        "把 515 个任务的目标里**真正要上交或放置的物品**按物品聚合，"
        f"**被 3 个及以上任务需要的物品共 {len(rows)} 种**。"
        "只统计 `上交 / 找到 / 放置` 类目标；`卖任何物品给某商人` 那类目标是**许可白名单、不是需求**，已排除。"
    )
    out += [
        "",
        "| 物品 | 需要它的任务数 | 合计数量 | 涉及商人 |",
        "|------|----------------|----------|----------|",
    ]
    for name, n, qty, trs in rows:
        tr = " / ".join(t for t, _ in trs.most_common(3))
        out.append(f"| {name} | {n} | {qty} | {tr} |")

    out += [
        "",
        "### 任务速查：几类容易被忽略的条件",
        "",
        "> **需要钥匙 / 有失败条件 / Kappa / Lightkeeper 已在上方「关键标记与条件」列出**，这里只补那一段没有的三类。",
        "",
        "| 类别 | 数量 | 说明 |",
        "|------|------|------|",
        f"| **有接取延迟** | **{len(delay_tasks)}** | 接取后要等一段时间才能推进——**先把任务接上，再去做别的**，别白等 |",
        f"| **可重接** | **{len(restart)}** | 失败或放弃后还能再接，试错代价比一次性任务低 |",
        "",
        "**经验奖励最高的十个任务**（`exp` 字段原值）：",
        "",
        "| 经验 | 任务 |",
        "|------|------|",
    ]
    for exp, name, tr in top_exp:
        out.append(f"| {exp} | {name}（{tr}） |")

    if delay_tasks:
        out += ["", "**有接取延迟的任务**（延迟值以分钟计，端点原值）：", "",
                "| 任务 | 延迟 |", "|------|------|"]
        for name, dl in sorted(delay_tasks, key=lambda x: -(x[1] or 0)):
            out.append(f"| {name} | {dl} |")

    if rew_rows:
        out += [
            "",
            "### 奖励反查：哪些任务会「给」它",
            "",
            "> 与上面的**需求反查**正好互补——那个回答「我要攒什么」，这个回答「**这东西哪来的**」；"
            "同样只列**被 3 个及以上任务作为奖励给出**的物品。",
            "",
            "| 物品 | 由几个任务给出 | 合计数量 |",
            "|------|----------------|----------|",
        ]
        for name, n, qty in rew_rows:
            out.append(f"| {name} | {n} | {qty} |")

    block = "\n".join(out)
    text = TARGET.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 AUTO-GEN 标记。")
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    TARGET.write_text(f"{head}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")
    print(f"已写入 {TARGET.relative_to(ROOT)}：反查 {len(rows)} 种物品 / 速查 6 类")


if __name__ == "__main__":
    main()
