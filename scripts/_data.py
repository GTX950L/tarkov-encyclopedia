#!/usr/bin/env python3
"""产物里的日期字段该写什么 —— 一律取**数据源自己记的日期**，不取 `date.today()`。

为什么要有这个模块
------------------
2026-10-20 的全面审查实测：4 个入库产物（`quests-index-data.js` /
`season-planner-data.js` / `progress-manifest.js` / `quests-graph.js`）的
`generated` 字段写的是 `date.today()`。后果是**每跑一次生成器，工作区就脏一次**：

    git status  → 4 个 M
    git diff    → 只有一行日期，从 10-19 变成 10-20

而 `check_gen_drift.py` 的 `_norm_bytes` 会把这行日期归一化掉，所以门禁**不会**
报错 —— 也就是说，这个噪音**没有任何检查器在看**，只能靠人每次跑完
`git checkout -- .` 收拾。

更根本的问题是语义：`generated` 字段要回答的是「**这批数据是什么时候的**」，
不是「**我什么时候跑的脚本**」。后者对读者没有任何意义，而且会让「产物是否
与源同步」这件事失去判据 —— 数据没变、脚本重跑了，产物却说「今天更新」。

判据（本模块的由来）：**产物里每一个日期字段，都要能回答「它代表哪个事实」。**

用法
----
    from _data import fetched_date, source_month

    fetched_date(DATA_FILE)             # "2026-10-17" —— 数据文件自带的 fetched
    source_month(SEASON_MD)             # "2026-10-01" —— 该 md 页脚「最后更新」月份

两者都**不会**随运行时间变化：数据不动，产物就不动。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# md 页脚的「最后更新」：`**最后更新**: 2026年10月` / `**最后更新**: 2026 年 10 月`
_FOOTER = re.compile(r"\*\*最后更新\*\*\s*[:：]\s*(\d{4})\s*年\s*(\d{1,2})\s*月")


def fetched_date(path: Path) -> str:
    """数据文件自带的抓取日期（`fetched` 字段），ISO 格式。

    ⚠️ 取不到就**报错退出**，不要回落到 `date.today()` —— 回落会静默地
       把这个问题带回来，而且是「最常见的那个值」，看不出异常。
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("fetched"):
        return str(data["fetched"])
    raise SystemExit(
        f"错误：{path} 里没有 `fetched` 字段，无法确定数据快照日期。\n"
        "  不要回落到 date.today()（那会让产物随运行时间漂移）——\n"
        "  要么给数据文件补 `fetched`，要么在生成器里显式声明一个常量并写清理由。"
    )


def source_month(path: Path) -> str:
    """站内 md 的「最后更新」月份，补成该月 1 日的 ISO 日期。

    用于数据源**本身是站内条目**（没有 `fetched` 字段）的生成器：
    这类产物的日期应当反映「作者最后一次定稿这个月」，而不是脚本运行日。
    """
    text = Path(path).read_text(encoding="utf-8")
    m = _FOOTER.search(text)
    if not m:
        raise SystemExit(
            f"错误：{path} 的页脚找不到「**最后更新**: YYYY年M月」，无法确定数据日期。"
        )
    return f"{m.group(1)}-{int(m.group(2)):02d}-01"
