#!/usr/bin/env python3
"""生成《成就》页的「成就全表」一节。

为什么这个脚本能成立（本批实测的一条关键事实）：

    `json.tarkov.dev/regular/tasks` 返回的 **name / description 一律是占位形式**
    （`<24 位 id> name`）—— 这不是「数据没落定」，而是**端点本来就长这样**：
    真正的文字在 **`tasks_zh`** 这张扁平翻译字典里（3689 条），
    任务、成就、物品都从它取。所以判断「有没有数据」要看 **字典命中率**，
    不能看 `tasks` 里的 name 字段 —— 后者对 504 条任务**全部**是占位形式。

    本批实测：**127 条成就的名字与描述 127/127 全部命中**，稀有度与阵营也在。

产物：`content/entries/achievements.md` 里 `AUTO-GEN:ACHIEVEMENTS` 之间的内容。

**刻意不收录完成率**（`playersCompletedPercent`）：那是随玩家行为实时变动的数，
静态站收录即过期 —— 与站内「不收录实时数值」的边界一致。

用法：
    python scripts/gen_achievements.py            # 用端点现取（不写缓存，成就量小）
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g  # noqa: E402  复用抓取通道与引号处理

ROOT = g.ROOT
TARGET = ROOT / "content" / "entries" / "achievements.md"
START = "<!-- AUTO-GEN:ACHIEVEMENTS:START -->"
END = "<!-- AUTO-GEN:ACHIEVEMENTS:END -->"

RARITY = [("common", "普通"), ("rare", "稀有"), ("legendary", "传说"), ("seasonal", "活动")]
# ⚠️ 端点的值是 `scavs` 不是 `savage`（本批实测：写错会静默变成 0 —— 统计表里
# 出现「Scav 0 个」而数据里明明有一条）。**未知值一律原样显示**，别用 .get(k, "") 吞掉。
SIDE = {"pmc": "PMC", "scavs": "Scav", "all": "不限"}


def side_label(key: str) -> str:
    return SIDE.get(key, key or "—")


def cell(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ").strip()


def main() -> int:
    print("抓取 json.tarkov.dev ...")
    data = g.get("tasks")["data"]
    zh = g.get("tasks_zh")["data"]
    ach = list((data.get("achievements") or {}).values())

    def text(key):
        """查翻译字典；查不到返回空串（不把十六进制 id 印进正文）。"""
        v = zh.get(str(key))
        return g.quote_cn(g.one_line(v)) if v else ""

    rows = []
    for a in ach:
        rows.append({
            "name": text(a.get("name")),
            "desc": text(a.get("description")),
            "rarity": a.get("normalizedRarity") or "",
            "side": a.get("normalizedSide") or "",
            "hidden": bool(a.get("hidden")),
        })

    missing = [r for r in rows if not r["name"] or not r["desc"]]
    if missing:
        print(f"[错误] {len(missing)} 条成就查不到译名 —— 字典可能变了，先核再写", file=sys.stderr)
        return 1

    by_rar = Counter(r["rarity"] for r in rows)
    by_side = Counter(r["side"] for r in rows)
    hidden_n = sum(1 for r in rows if r["hidden"])

    out = [
        # ⚠️ **必须显式给锚点**：中文标题走主题的 slug 规则会退化成 `_13` 这类不可引用的 id，
        # 正文里写 `[成就全表](#成就全表)` 会被构建器判为「anchor does not exist」。
        # 站内既有判据：`q01` / 显式 `<a id>` 这种由生成器自己掌握的锚点才不会漂。
        '<a id="ach-table"></a>',
        "",
        "## 📊 成就全表",
        "",
        f"> **口径**：共 **{len(rows)}** 个成就 ｜ 来源：`json.tarkov.dev`（**二级**）"
        "的成就清单 ＋ 中文译名字典 ｜ 与站内基线同步",
        ">",
        f"> **不收录完成率**：那是随玩家行为实时变动的数，收录即过期。"
        f"**也不给奖励**：奖励按版本调整，且以游戏内为准。",
        "",
        "### 分布",
        "",
        "| 稀有度 | 个数 | ｜ | 阵营 | 个数 |",
        "|--------|------|----|------|------|",
    ]
    lr = [(lab, by_rar.get(key, 0)) for key, lab in RARITY]
    # 阵营一侧**从数据里派生**并计数降序 —— 端点将来加一档，这里会自己出现，
    # 而不是漏掉（漏掉的表现就是「有 127 条却只统计出 126」）。
    ls = [(side_label(k), n) for k, n in by_side.most_common()]
    assert sum(n for _, n in lr) == len(rows), "稀有度分布之和 ≠ 总数"
    assert sum(n for _, n in ls) == len(rows), "阵营分布之和 ≠ 总数"
    for i in range(max(len(lr), len(ls))):
        a = lr[i] if i < len(lr) else ("—", "—")
        b = ls[i] if i < len(ls) else ("—", "—")
        out.append(f"| {a[0]} | {a[1]} | ｜ | {b[0]} | {b[1]} |")
    out += [
        "",
        f"> **可见性**：其中 **{hidden_n}** 个是**隐藏成就** —— 在游戏里解锁前列表不可见。"
        "下表把它们一并列出（这正是社区清单的价值所在），并在末列标注。",
        "",
    ]

    for key, lab in RARITY:
        sub = [r for r in rows if r["rarity"] == key]
        if not sub:
            continue
        sub.sort(key=lambda r: r["name"])
        out += [
            f"### {lab}（{len(sub)} 个）",
            "",
            "| 成就 | 如何获取 | 阵营 | 可见性 |",
            "|------|----------|------|--------|",
        ]
        for r in sub:
            out.append(f"| {cell(r['name'])} | {cell(r['desc'])} | "
                       f"{side_label(r['side'])} | "
                       f"{'**隐藏**' if r['hidden'] else '可见'} |")
        out.append("")

    block = "\n".join(out).rstrip()
    txt = TARGET.read_text(encoding="utf-8")
    if START not in txt or END not in txt:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 AUTO-GEN 标记。")
    head, rest = txt.split(START, 1)
    _, tail = rest.split(END, 1)
    TARGET.write_text(f"{head}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")

    print(f"已写入 {TARGET.relative_to(ROOT)}：{len(rows)} 个成就"
          f"（普通 {by_rar.get('common', 0)} / 稀有 {by_rar.get('rare', 0)}"
          f" / 传说 {by_rar.get('legendary', 0)} / 活动 {by_rar.get('seasonal', 0)}；"
          f"隐藏 {hidden_n}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
