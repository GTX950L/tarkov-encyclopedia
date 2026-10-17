#!/usr/bin/env python3
"""生成站点首页顶部的「速览」卡组（数字 + 入口）。

为什么要这个脚本：首页顶部此前是「双轨卡 → 一大段正文」，读者第一屏看不到**规模**。
对照站（eftarkov）的首屏是密集的数据卡，而且**每张卡都是一个入口**。本脚本把同样的
结构做出来，但**只用静态计数** —— 站内不收实时数值、正文以文字与表格呈现，所以学的是
**信息结构**，不是它的数据。

⚠️ **数字绝不能手写**。首页是与其它页面并列的**第 N 处计数落点**，手写必然漂。
所以这里把数字**算出来**，并且 `check_entries.py` 直接调用本模块的 `render()` 复算比对
（一份实现、两处消费）—— 数据一变，CI 立刻报「首页速览过期」，而不是等读者发现。

用法：
    python scripts/gen_home_stats.py            # 重新生成
    python scripts/gen_home_stats.py --check    # 只核对是否过期（CI 用，返回 1 表示过期）
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
README = CONTENT / "README.md"
START = "<!-- AUTO-GEN:HOME-STATS:START -->"
END = "<!-- AUTO-GEN:HOME-STATS:END -->"

# 与 gen_quest_items.py 同口径：只有这几类目标是**真正的需求物品**，
# `sellItem` 是「卖任何物品」的许可白名单，不是需求。
DEMAND = {"giveItem", "findItem", "findQuestItem", "giveQuestItem", "plantItem", "plantQuestItem"}

# nav 里的「第X篇」分组标题（与 check_entries.py 同一条正则）
NAV_GROUP_RE = re.compile(r"^(\s*)-\s*(第[零一二三四五六七八九十]{1,3}篇)\s*·\s*(.+?):\s*$")


def nav_group_stats(nav_text: str) -> tuple[int, int, int]:
    """返回 (分组总数, 内容篇数, 查阅栏目数)。

    分类口径与 check_entries 一致：**页面全在 entries/ 下的才算内容篇**。
    首页卡片曾把「分组总数」直接写成「N 篇主线」，于是 v1.130 之后出现
    「12 篇主线」——而站内明说后四篇是查阅栏目、不在阅读顺序里。
    """
    lines = nav_text.splitlines()
    try:
        start = next(i for i, ln in enumerate(lines) if ln.startswith("nav:")) + 1
    except StopIteration:
        return 0, 0, 0
    pages: dict[str, set[str]] = {}
    order: list[str] = []
    cur: str | None = None
    cur_indent = -1
    for ln in lines[start:]:
        m = re.match(r"^(\s*)-\s*(.*)$", ln)
        if not m:
            continue
        g = NAV_GROUP_RE.match(ln)
        if g:
            cur = g.group(2)
            cur_indent = len(g.group(1))
            if cur not in pages:
                order.append(cur)
                pages[cur] = set()
            continue
        if cur is not None and len(m.group(1)) <= cur_indent:
            cur = None
            continue
        if cur is not None:
            _, _, value = m.group(2).partition(":")
            pages[cur].update(re.findall(r"([\w/\-\.]+\.md)", value))
    n_content = sum(1 for k in order if pages[k] and all(p.startswith("entries/") for p in pages[k]))
    return len(order), n_content, len(order) - n_content


def _quests() -> list[dict]:
    import json
    return json.loads((ROOT / "scripts/data/quests.json").read_text(encoding="utf-8"))["tasks"]


def counts() -> dict[str, int]:
    """所有要在首页展示的数字 —— **这是唯一的一份实现**。"""
    import json
    import re as _re

    entries = [p for p in (CONTENT / "entries").glob("*.md") if p.name != "index.md"]
    # 篇数：nav 里「第 X 篇」的分组数（与 check_entries 的篇数口径同源）；
    # 其中「内容篇 / 查阅栏目」按页面是否全在 entries/ 下派生 —— 首页卡片两个数都要。
    nav = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    n_groups, n_content, n_cols = nav_group_stats(nav)

    tasks = _quests()
    obj_n = sum(len(t.get("objectives") or []) for t in tasks)

    q_demand: dict[str, set] = {}
    for t in tasks:
        for o in t.get("objectives") or []:
            if o.get("type") not in DEMAND:
                continue
            for it in o.get("items") or []:
                q_demand.setdefault(it, set()).add(t["name"])
    items_3plus = sum(1 for v in q_demand.values() if len(v) >= 3)

    keys = {k for t in tasks for k in (t.get("keys") or [])}

    ammo = json.loads((ROOT / "scripts/data/ammo_values.json").read_text(encoding="utf-8"))
    hideout = json.loads((ROOT / "scripts/data/hideout.json").read_text(encoding="utf-8"))

    # 交互地图：张数 = maps-data.js 的顶层 key 数；任务区域 = 各图 questZones 合计。
    # 读**产物**而不是数页面文件 —— 数字与地图页「这张图的数据」表同源。
    maps_js = (CONTENT / "javascripts" / "maps-data.js").read_text(encoding="utf-8")
    m = _re.search(r"window\.TARKOV_MAPS\s*=\s*(\{.*\});", maps_js, _re.S)
    maps_data = json.loads(m.group(1)) if m else {}
    n_maps = len(maps_data)
    n_zones = sum(len(mp.get("questZones") or []) for mp in maps_data.values())

    # 成就：数**已生成页面**的分组表行 —— 读的是产物，所以两处必然一致（不会各算一套）
    ach_txt = (CONTENT / "entries" / "achievements.md").read_text(encoding="utf-8")
    ach_start, ach_end = "<!-- AUTO-GEN:ACHIEVEMENTS:START -->", "<!-- AUTO-GEN:ACHIEVEMENTS:END -->"
    if ach_start not in ach_txt or ach_end not in ach_txt:
        sys.exit("错误：achievements.md 里找不到成就表的 AUTO-GEN 标记。")
    ach_block = ach_txt.split(ach_start, 1)[1].split(ach_end, 1)[0]
    # 只数「四列、阵营列是 PMC/Scav/不限」的行 —— 分布表是 5 列，天然排除
    ach_n = len(re.findall(r"(?m)^\| (?!成就 \|)[^|]+ \| .+ \| (?:PMC|Scav|不限) \| "
                           r"(?:\*\*隐藏\*\*|可见) \|$", ach_block))
    ach_hidden = ach_block.count("| **隐藏** |")

    return {
        "entries": len(entries),
        "groups": n_groups,
        "content_groups": n_content,
        "column_groups": n_cols,
        "tasks": len(tasks),
        "objectives": obj_n,
        "maps": n_maps,
        "mapzones": n_zones,
        "achievements": ach_n,
        "ach_hidden": ach_hidden,
        "ammo": ammo.get("count") or len(ammo.get("rows") or []),
        "hideout": hideout.get("count") or len(hideout.get("stations") or []),
        "hideout_levels": hideout.get("levelCount") or 0,
        "items3": items_3plus,
        "keys": len(keys),
    }


CARDS = [
    # (数字键, 单位, 标签, 说明, 链接)
    ("entries", "篇", "百科条目", "{content_groups} 篇主线 · {column_groups} 篇查阅栏目", "entries/index.md"),
    # 交互地图放在第二位：它是本站的旗舰工具，此前只在条目里间接出现，
    # 读者反馈「藏的有点深」—— 首页速览给它一个直接入口（2026-10-14）。
    ("maps", "张", "交互地图", "{mapzones} 个任务区域 · 可筛进度", "maps/index.md"),
    ("tasks", "个", "任务逐条", "要求 / 奖励 / 门槛 / 前置", "quests/index.md"),
    ("objectives", "条", "任务目标", "可勾选，进度按前置反推", "quests/progress.md"),
    ("achievements", "个", "成就", "含 {ach_hidden} 个隐藏成就", "entries/achievements.md"),
    ("ammo", "条", "弹药数值", "含对 1–6 级护甲判定", "entries/ammo-table.md"),
    ("hideout", "模块", "藏身处", "{hideout_levels} 级 · 前置可判定", "entries/hideout-modules.md"),
    ("items3", "种", "物品需求", "被 3 个及以上任务需要", "quests/index.md"),
    ("keys", "把", "任务钥匙", "按地图归拢", "quests/index.md"),
]


def render(n: dict[str, int] | None = None) -> str:
    n = n or counts()
    out = [
        '<div class="tk-stat">',
        '<div class="tk-stat__head">本站速览<i>数字由数据文件生成，随内容自动更新</i></div>',
        '<div class="tk-stat__grid">',
    ]
    for key, unit, label, desc, href in CARDS:
        out += [
            f'<a class="tk-stat__card" href="{href}">',
            f'<b class="tk-stat__n">{n[key]}<em>{unit}</em></b>',
            f'<span class="tk-stat__l">{label}</span>',
            f'<span class="tk-stat__d">{desc.format(**n)}</span>',
            "</a>",
        ]
    out += ["</div>", "</div>"]
    return "\n".join(out)


def write(block: str) -> None:
    text = README.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{README.relative_to(ROOT)} 里找不到 {START} / {END} 标记。")
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    README.write_text(f"{head}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")


def current() -> str:
    text = README.read_text(encoding="utf-8")
    if START not in text or END not in text:
        return ""
    return text.split(START, 1)[1].split(END, 1)[0].strip()


def main_check() -> int:
    """只核对是否过期，**成功时不打印**（供 check_entries 调用，别污染它的输出）。"""
    want, got = render(), current()
    if want.strip() == got:
        return 0
    print("[错误] 首页速览已过期（数字与实际不符）——"
          "跑 `python scripts/gen_home_stats.py` 重新生成", file=sys.stderr)
    for a, b in zip(want.splitlines(), got.splitlines()):
        if a != b:
            print(f"   期望: {a.strip()[:70]}\n   实际: {b.strip()[:70]}", file=sys.stderr)
            break
    return 1


def main() -> int:
    if "--check" in sys.argv:
        rc = main_check()
        if rc == 0:
            print("✅ 首页速览与数据一致")
        return rc
    n = counts()
    write(render(n))
    print("已写入 " + str(README.relative_to(ROOT)) + "："
          + " ｜ ".join(f"{lab}{n[key]}{unit}" for key, unit, lab, _, _ in CARDS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
