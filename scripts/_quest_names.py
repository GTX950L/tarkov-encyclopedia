#!/usr/bin/env python3
"""同名任务的**显示名**消歧：中文重名时按英文名的尾缀补区分。

问题
----
2026-11-03 全站审查：``quests.json`` 里有 **9 组中文重名**，共 20 个任务。
英文名其实分得清清楚楚，中文翻译把它们并成一个名字：

    New Beginning / New Beginning 2 / 3 / 4      → 全部译作「新起点」
    Drip Out Part 1 Bear / … Usec                → 都译作「人靠衣装 - 1」
    Textile Part 1 Bear / … Usec                 → 都译作「纺织业 - 1」
    The Tarkov Shooter Part 5 / Part 5 2         → 都译作「塔科夫神射手 - 5」
    The Huntsman Path Administrator / … 2        → 都译作「猎人之路 - 管理者」
    The Price of Independence / … 2              → 都译作「独立的代价」
    Battery Change / … 2                         → 都译作「电池换新」

后果：商人页的任务索引里两行同名并列，读者不知道该点哪个；搜索结果同样。

为什么不直接改 ``name``
----------------------
``name`` 是**关联键**，不是纯显示字段：``prereqs`` 里存的是前置任务的
``{"name": "影子雇员", …}``，任务链、进度反推、作战台都靠它配对。
改一个名字而漏改一处引用，断的是**任务链**，而且不会有任何报错 ——
页面照常生成，只是「前置」那一栏悄悄空掉。

所以这里只产出**显示名映射** ``{任务 id: 显示名}``，由各生成器在渲染标题 /
索引时取用。数据里的 ``name`` 一个字节都不动。
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict

BEAR = re.compile(r"\bBear$", re.I)
USEC = re.compile(r"\bUsec$", re.I)
TAIL_NUM = re.compile(r"\s(\d+)$")


def display_names(tasks) -> dict[str, str]:
    """``{id: 显示名}``。只有一个同名任务时，显示名就是原名。"""
    groups: dict[str, list] = defaultdict(list)
    for t in tasks:
        groups[t.get("name") or ""].append(t)

    out: dict[str, str] = {}
    for name, items in groups.items():
        if len(items) == 1:
            out[items[0]["id"]] = name
            continue

        # 同组内按英文名长度排序：短的（本体）在前，带 2/3/4 的在后 ——
        # 这样「老玩家认得的那个」保留原名，复刻版才带后缀。
        items = sorted(items, key=lambda x: (len(x.get("en") or ""), x.get("level") or 0))
        for k, t in enumerate(items, 1):
            en = (t.get("en") or "").strip()
            suffix = ""
            if BEAR.search(en):
                suffix = "（Bear）"
            elif USEC.search(en):
                suffix = "（USEC）"
            else:
                m = TAIL_NUM.search(en)
                # 中文名里已经有那个数字时（「塔科夫神射手 - 5」）不要重复加，
                # 否则会变成「塔科夫神射手 - 5 5」。
                if m and not re.search(rf"[-–—\s]{m.group(1)}$", name):
                    suffix = f" {m.group(1)}"
            if k > 1 and not suffix:
                suffix = f"（{k}）"
            out[t["id"]] = name + suffix
    return out


def summary(tasks) -> str:
    """给日志用的一句话：几组重名、改了哪些。"""
    disp = display_names(tasks)
    cnt = Counter(t.get("name") or "" for t in tasks)
    groups = {k: v for k, v in cnt.items() if v > 1}
    if not groups:
        return "无重名任务"
    return (f"{len(groups)} 组重名 / {sum(groups.values())} 个任务已按英文尾缀区分"
            f"（如「{next(iter(groups))}」）")
