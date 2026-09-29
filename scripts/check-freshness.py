#!/usr/bin/env python3
"""内容新鲜度巡检（只读，不改文件）。

回答一个问题：**这批内容里，哪些该回头核了？**

三项检查：
1. `roadmap.md`「📈 版本敏感内容（收录前需复核）」登记的条目，其页脚日期是否早于全站基线；
2. 全站条目与参考页的页脚日期距今是否超过 6 个月；
3. 哪些页面缺「最后更新」页脚 —— 无法纳入巡检，而**检查器看不见的地方就是漂移的温床**。

基线不从代码里硬编码，而是从 `citation.md` 的「基准快照时间」行解析 —— 单一事实源；
解析不到就报错退出（声明缺失必须响，不能静默通过）。

用法：python scripts/check-freshness.py

退出码恒为 0：巡检是**信息性**的，不作为 CI 门禁 —— 「内容有点旧」不该阻止部署，
真正该阻断部署的是 scripts/check_entries.py 报出的硬错误。
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

FOOTER_DATE_RE = re.compile(r"\*\*最后更新\*\*:\s*(\d{4})\s*年\s*(\d{1,2})\s*月")
BASELINE_RE = re.compile(r"\*\*基线快照时间\*\*\s*\|\s*\*\*(\d{4})\s*年\s*(\d{1,2})\s*月\*\*")
SENSITIVE_LINK_RE = re.compile(r"\]\((?:\.\./entries|entries)/([a-z0-9-]+)\.md\)")

STALE_MONTHS = 6

# 参考区欢迎页按站内先例不设页脚（与 philosopher-encyclopedia 原型一致，它同时也没有
# frontmatter）。豁免它，避免每次巡检都报一条已知噪音。
FOOTER_EXEMPT = {"docs/index.md"}


def month_index(year: int, month: int) -> int:
    """把年月折算成可相减的月序号。"""
    return year * 12 + (month - 1)


def read_baseline() -> tuple[int, int]:
    page = CONTENT / "docs" / "citation.md"
    if not page.exists():
        raise SystemExit("[错误] 找不到 content/docs/citation.md，无法确定基线")
    found = BASELINE_RE.search(page.read_text(encoding="utf-8"))
    if not found:
        raise SystemExit(
            "[错误] citation.md 里找不到「基线快照时间」行 —— 声明缺失，巡检无法进行"
        )
    return int(found.group(1)), int(found.group(2))


def read_sensitive_slugs() -> set[str]:
    """从 roadmap 的版本敏感一节取出被登记的条目 slug。"""
    page = CONTENT / "docs" / "roadmap.md"
    if not page.exists():
        raise SystemExit("[错误] 找不到 content/docs/roadmap.md")
    text = page.read_text(encoding="utf-8")
    section = re.search(r"^## 📈.*?(?=^## |\Z)", text, re.M | re.S)
    if not section:
        raise SystemExit(
            "[错误] roadmap.md 里找不到「📈 版本敏感内容」一节 —— 声明缺失，巡检无法进行"
        )
    return set(SENSITIVE_LINK_RE.findall(section.group(0)))


def footer_date(md: Path) -> tuple[int, int] | None:
    """取文件**末尾**的页脚日期 —— 正文中间出现的同名文本不算。"""
    hits = list(FOOTER_DATE_RE.finditer(md.read_text(encoding="utf-8")[-800:]))
    if not hits:
        return None
    return int(hits[-1].group(1)), int(hits[-1].group(2))


def collect_pages() -> list[tuple[str, Path]]:
    pages: list[tuple[str, Path]] = []
    for sub in ("entries", "docs"):
        for path in sorted((CONTENT / sub).glob("*.md")):
            if path.name == "index.md":  # 总览页与参考区欢迎页都不带页脚
                continue
            pages.append((f"{sub}/{path.name}", path))
    return pages


def main() -> int:
    today = date.today()
    base_year, base_month = read_baseline()
    base_idx = month_index(base_year, base_month)
    now_idx = month_index(today.year, today.month)
    sensitive = read_sensitive_slugs()

    pages = collect_pages()
    late_sensitive: list[tuple[str, tuple[int, int], int]] = []
    stale: list[tuple[str, tuple[int, int], int]] = []
    no_footer: list[str] = []
    fresh = 0

    for rel, path in pages:
        d = footer_date(path)
        if d is None:
            if rel not in FOOTER_EXEMPT:
                no_footer.append(rel)
            continue
        idx = month_index(*d)
        age = now_idx - idx
        if path.stem in sensitive and idx < base_idx:
            late_sensitive.append((rel, d, base_idx - idx))
        elif age >= STALE_MONTHS:
            stale.append((rel, d, age))
        else:
            fresh += 1

    bar = "=" * 72
    print(bar)
    print("内容新鲜度巡检（只读，未改动任何文件）")
    print(
        f"全站基线：{base_year} 年 {base_month} 月 ｜ 巡检日期：{today.isoformat()} ｜ "
        f"久未更新阈值：{STALE_MONTHS} 个月"
    )
    print(f"版本敏感登记：{len(sensitive)} 个条目 ｜ 扫描页面：{len(pages)} 个")
    print(bar)

    print()
    print("【A】版本敏感条目：roadmap 已登记，但页脚日期早于当前基线 —— 优先级最高")
    print("     （这些条目里有会随版本失效的结论，读者正照着它做决定）")
    if late_sensitive:
        for rel, d, gap in sorted(late_sensitive, key=lambda x: (-x[2], x[0])):
            print(f"  · {rel:<34} 最后更新 {d[0]}年{d[1]}月（落后基线 {gap} 个月）")
    else:
        print("  （无）")

    print()
    print(f"【B】久未更新：页脚日期距今 ≥ {STALE_MONTHS} 个月")
    if stale:
        for rel, d, age in sorted(stale, key=lambda x: (-x[2], x[0])):
            print(f"  · {rel:<34} 最后更新 {d[0]}年{d[1]}月（{age} 个月前）")
    else:
        print("  （无）")

    print()
    print("【C】页脚缺失或格式不符 —— 无法纳入巡检")
    if no_footer:
        for rel in no_footer:
            print(f"  · {rel:<34} 找不到「**最后更新**: YYYY年M月」")
    else:
        print("  （无）")

    print()
    print("-" * 72)
    print(
        f"汇总：{len(pages)} 个页面 —— 新鲜 {fresh} ｜ 版本敏感待核 {len(late_sensitive)} ｜ "
        f"久未更新 {len(stale)} ｜ 无法巡检 {len(no_footer)}"
    )
    if late_sensitive:
        print()
        print("建议下一步：先核【A】—— 每条给出「哪一句可能失效 / 去哪个权威源核 / 改完要 grep 哪几处」。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
