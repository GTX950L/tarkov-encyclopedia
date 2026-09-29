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

# ── 【D】【E】两节用的口径（写死，便于复算）──────────────────────────────────
CJK = re.compile(r"[\u4e00-\u9fff]")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADER_FOOTER_RE = re.compile(r"^(\*\*最后更新\*\*|\*\*贡献者\*\*|\*\*License\*\*|> 版本基线：|> 本页数值随版本调整|> ⚠️ 本页含未决项)")
DATA_UNITS = r"米|秒|分钟|小时|天|格|级|发|次|发/分|%|卢布|₽|万|kg|mm|m"
# ⚠️ 2026-09-29 口径加宽：只算「计量单位」会**系统性少算**——「23 个模块」「4 位码」
#    「5 环任务线」「LL2 档」这些都是实打实的数据，却一个都不计入。加进**计数单位**。
DATA_UNITS += r"|个|位|环|档|条|套|种|张|把|件|名|人|轮|页"
NUM_UNIT = re.compile(r"([\u4e00-\u9fff]{2,8})[^\n。；]{0,12}?(\d+(?:\.\d+)?)\s*(" + DATA_UNITS + r")")
DATA_POINT = re.compile(r"\d+(?:\.\d+)?\s*(?:" + DATA_UNITS + r")")
# 来源标记：出现这些词就算「这一页声明了来源层级」
SOURCE_MARK = re.compile(r"一级|二级|社区口径|社区来源|官方 Wiki|官方 wiki|tarkov\.dev|knowledge/\d+|知识库")


def strip_code_and_meta(text: str) -> str:
    """去掉围栏代码块与页眉/页脚元信息行，剩下的才算「正文」。"""
    keep, in_fence = [], False
    for ln in text.split("\n"):
        if FENCE_RE.match(ln):
            in_fence = not in_fence
            continue
        if in_fence or HEADER_FOOTER_RE.match(ln):
            continue
        keep.append(ln)
    return "\n".join(keep)


def count_data_points(body: str) -> int:
    """数据点 = 「数字 + 计量单位」的出现次数。"""
    return len(DATA_POINT.findall(body))


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

    # ── 【D】数据密度（2026-09-29 新增）─────────────────────────────────────
    # 背景：站规的写作方向已从「数值克制」改为「**数据详实**」（见 CONTRIBUTING
    # 「数据详实」）。这条规则**不是硬错误**（页面数据少不等于错），所以放进这份
    # 信息性巡检，产出**补数据的工单**而不是卡发布。
    #
    # 口径（写死，便于复算）：
    #   数据点 = 该页出现的「数字 + 计量单位」次数（单位表见 DATA_UNITS），
    #            不含围栏代码块、不含页眉三行与页脚三行。
    #   密度   = 数据点 / 正文汉字数 × 1000（‰）。
    print()
    print("【D】数据密度 —— 站规要求「数据详实」，这些页面给的数据偏少（信息性，不阻断）")
    print("     （口径：数字+单位 的出现次数 ÷ 正文汉字数 × 1000‰，不含代码块与页眉页脚；")
    print("       单位含计量与计数两类：米/秒/小时/格/级/%/卢布… 与 个/位/环/档/条/名…）")
    print("     ⚠️ **这是「候审」，不是「工单」**：密度低有两种原因，必须人工分——")
    print("        ① 该给数而没给（要补）；② **这一页本来就以判断为主**（行为层/设定层，不必补）。")
    print("        例：engagement-rules 是最厚的一页，密度也低，但那是对的。")
    density: list[tuple[float, int, int, str]] = []
    for rel, path in pages:
        if not rel.startswith("entries/"):
            continue
        text = path.read_text(encoding="utf-8")
        body = strip_code_and_meta(text)
        cjk = len(CJK.findall(body))
        if cjk < 300:
            continue
        n = count_data_points(body)
        density.append((n / cjk * 1000, n, cjk, rel))
    density.sort()
    if density:
        zeros = [d for d in density if d[1] <= 1]
        print(f"  · 全站条目 {len(density)} 篇：密度中位 {density[len(density) // 2][0]:.1f}‰")
        print(f"  · 【A 档｜最该看】数据点 ≤ 1 的 {len(zeros)} 篇 —— 这一档基本可以断定「该给数而没给」：")
        for d, n, cjk, rel in zeros[:12]:
            print(f"      {d:5.1f}‰  数据点 {n:2} ／ 正文 {cjk:5} 字   {rel}")
        print(f"  · 【B 档｜参考】密度最低的其余 8 篇（**先判是不是「以判断为主」的页面**）：")
        rest = [d for d in density if d[1] > 1]
        for d, n, cjk, rel in rest[:8]:
            print(f"      {d:5.1f}‰  数据点 {n:3} ／ 正文 {cjk:5} 字   {rel}")
        # 有数据、但整页没声明来源层级 —— 「数据详实」规矩的另一半：数要能说清从哪来
        nosrc = [(n, rel) for _, n, _, rel in density
                 if n > 0 and not SOURCE_MARK.search((CONTENT / rel).read_text(encoding="utf-8"))]
        print(f"\n  · 有数据但**整页未声明来源层级**的：{len(nosrc)} 篇"
              "（源层级 / 官方 Wiki / 社区口径 等一个都没有）")
        for n, rel in sorted(nosrc, reverse=True)[:8]:
            print(f"      数据点 {n:3}   {rel}")

    # ── 【E】跨页数值候审（2026-09-29 新增）─────────────────────────────────
    # 同一「名词 + 单位」在不同页出现不同取值。**信噪比低**（多数是不同实体共用
    # 名词，如不同 Prestige 档、不同止血带），所以只列候选、交人工判；但**真冲突
    # 的代价很高**（读者会照着错数做决定），故必须有人定期看一眼。
    print()
    print("【E】跨页数值候审 —— 同一「名词+单位」在不同页取不同值（需人工判，不是错误清单）")
    groups: dict[tuple[str, str], list[tuple[str, str, int]]] = {}
    for rel, path in pages:
        for i, ln in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for m in NUM_UNIT.finditer(ln):
                groups.setdefault((m.group(1), m.group(3)), []).append((m.group(2), rel, i))
    suspects = [(k, sorted({v[0] for v in vs}), vs) for k, vs in groups.items()
                if len({v[0] for v in vs}) > 1 and len(vs) >= 2]
    suspects.sort(key=lambda x: (-len(x[1]), x[0][0]))
    if suspects:
        print(f"  · 候选 {len(suspects)} 组，列出前 8 组（其余自行 grep）：")
        for (noun, unit), vals, vs in suspects[:8]:
            where = "、".join(f"{r}:{i}" for _, r, i in vs[:3])
            print(f"      「{noun}·{unit}」取值 {vals}   → {where}")
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
