#!/usr/bin/env python3
"""站点基线的**唯一来源**：`content/docs/citation.md` 第二节的两行声明。

    | **全站基线版本** | **1.2.0.0（第一赛季 KORD BREACH）** |
    | **基线快照时间** | **2026 年 10 月** |

为什么要有这个模块
------------------
站内多处要写「本站基线 X.Y.Z（赛季名）」：条目页眉、各图鉴页的口径行、
检查器的断言。而基线**每次抬升都要全站跟着动** —— `check_entries.py` 的注释写得很直白：
「基线不从代码里硬编码 —— 季节一换，页眉就该全部跟着动」。

2026-10-11 的「生成物漂移」排查暴露了反面案例：**7 个数值表生成器各自硬编码
`1.1.5.1`**（弹药 / 护甲 / Boss / 食物 / 小件装备 / 医疗 / 武器），而 citation.md
与全部页面早已抬到 `1.2.0.0`。后果不是「构建失败」，而是：

  **任何人重跑一次生成器，就会静默地把 8 个页面的基线改回旧版本，四道门禁全绿。**

这正是本项目反复强调的那类问题 ——「检查器失效时，世界是静默的」。
所以基线在这里只留**一个来源**，生成器与检查器都从它读。

用法
----
    from _baseline import baseline_ver, baseline_label
    baseline_ver()     # "1.2.0.0"                        —— 用于断言比对
    baseline_label()   # "1.2.0.0（第一赛季 KORD BREACH）"  —— 用于页面口径行
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITATION = ROOT / "content" / "docs" / "citation.md"

# 「全站基线版本」那一格的**完整内容**（含括号里的赛季名）
BASELINE_LABEL_RE = re.compile(
    r"\*\*全站基线版本\*\*\s*\|\s*\*\*(?P<label>[^*]+?)\*\*"
)
# 「基线快照时间」那一格
BASELINE_MONTH_RE = re.compile(
    r"\*\*基线快照时间\*\*\s*\|\s*\*\*(\d{4})\s*年\s*(\d{1,2})\s*月\*\*"
)


def _citation_text() -> str:
    if not CITATION.exists():
        raise SystemExit(f"[错误] 找不到 {CITATION.relative_to(ROOT)}，无法确定站点基线")
    return CITATION.read_text(encoding="utf-8")


def baseline_label() -> str:
    """完整基线串，如 `1.2.0.0（第一赛季 KORD BREACH）` —— 用于页面口径行。"""
    m = BASELINE_LABEL_RE.search(_citation_text())
    if not m:
        raise SystemExit(
            "[错误] citation.md 第二节里找不到「**全站基线版本** | **X.Y.Z（…）**」声明"
        )
    return m.group("label").strip()


def baseline_ver() -> str:
    """只取版本号，如 `1.2.0.0` —— 用于断言比对。"""
    label = baseline_label()
    return re.split(r"[（(]", label, maxsplit=1)[0].strip()


def read_baseline() -> tuple[str, str]:
    """`(基线快照月份, 版本号)` —— 与 check_entries.py 原有的返回值一致。"""
    m = BASELINE_MONTH_RE.search(_citation_text())
    if not m:
        raise SystemExit(
            "[错误] citation.md 第二节里找不到基线快照时间声明"
            "（应为「**基线快照时间** | **YYYY 年 M 月**」）"
        )
    return f"{int(m.group(1))} 年 {int(m.group(2))} 月", baseline_ver()


if __name__ == "__main__":
    # 自检：能读到就打印，读不到就抛（不作为 CI 门禁，只是方便手工核对）
    print(f"基线快照：{read_baseline()[0]}")
    print(f"版本号  ：{baseline_ver()}")
    print(f"口径行  ：本站基线 {baseline_label()}")
    sys.exit(0)
