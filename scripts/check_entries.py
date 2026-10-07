#!/usr/bin/env python3
"""条目一致性 + 覆盖率校验（只读，不改文件）。

一致性类（第 1–8 项）：
1. mkdocs.yml nav 中引用的所有 markdown 文件是否存在；
2. content/ 下所有 markdown 内的相对链接（.md）是否可解析；
3. entries/ 条目骨架完整性（frontmatter + 固定章节）；
4. 条目计数一致性：全站「查看全部 N 个条目」、总览页、两处 README、路径图篇数之和；
4b. 篇数口径：声明的「分N篇」必须与 nav 的「第X篇」分组数一致；
5. tags.md 的篇数与覆盖条目是否与 frontmatter 实际统计一致（防手工维护漂移）；
6. 中文正文中是否残留直引号（行内代码与 HTML 属性里的语法引号不计）；
6b. 表格行之后是否留了空行 —— 不留的话下一个块会被吞进表格（标题变单元格）；
7. 总览页「按标签浏览」：slug 真实存在、条数一致、分隔符统一；
8. 主条目必须链接到它的细分条目（「主 → 细分」是深入，「细分 → 主」只是回望）。

覆盖率类（第 9–11 项）：
9. 条目页眉覆盖率（citation.md「条目页眉模板」的两行）+ 页眉未决项编号与 citation.md
   第三节是否逐字一致；
10. 参考区「总结型页面」是否覆盖全部图鉴层条目（速查表 / 成长路线不会自动更新）；
11. llms.txt（面向 AI 的入口）的条目数、篇数、页面 slug 与参考区清单是否与实际一致。

第 9–11 项为什么必须单独存在：前八项问的是「**一致性**」，它们全绿时覆盖率照样可以是 0。
规范写了要做、而没有检查器在看的地方，就是缺口长期积聚的地方。

用法：python scripts/check_entries.py
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

# 同目录脚本互引（4c 节要调用首页速览的生成器做比对）。
# 不靠工作目录 —— CI 里 `python scripts/check_entries.py` 的 cwd 是仓库根，
# 而直接执行时 cwd 可能是别处；按 `__file__` 定位才稳。
sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

REQUIRED_SECTIONS = [
    "## 📸 基本信息",
    "## 🔗 相关条目",
    "[回到顶部](#top)",
]

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#]+?)(?:#[^)]*)?\)")
COUNT_RE = re.compile(r"查看全部 (\d+) 个条目")
CN_CHAR = re.compile(r"[\u4e00-\u9fff]")
TAG_LINE = re.compile(r"^\s*-\s*(.+?)\s*$")
# nav 里的「第X篇」分组标题：`- 第一篇 · 入门机制:` / `- 第九篇 · 任务图鉴:`
NAV_GROUP_RE = re.compile(r"^(\s*)-\s*(第[一二三四五六七八九十]篇)\s*·\s*(.+?):\s*$")
# 正文里的篇数声明：「分为十篇」/「分十篇组织」/「分十篇：…」
GROUP_DECL_RE = re.compile(r"分(?:为)?([一二三四五六七八九十])篇")
CN_NUM = {c: i for i, c in enumerate("一二三四五六七八九十", 1)}
# 首页路径图的单张卡片：`<b>第X篇</b><em>篇名</em><i>N 篇</i>`
# （v1.21.0 起由 mermaid 改为零依赖纯 CSS 路径条，标记形态随之固定）
PATH_CARD_RE = re.compile(r"<b>(第[一二三四五六七八九十]篇)</b><em>([^<]*)</em><i>(\d+) 篇</i>")
# tags.md 的表格行：| 标签 | 篇数 | 覆盖条目 |
TAGS_ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*$", re.M)
# 「覆盖条目」列允许写成 markdown 链接（`[slug](path)`）——解析时只取显示文字。
# 这一列在页面上是**可点击的**（读者拿到 slug 才知道是哪一篇），所以链接是常态而非例外；
# 不剥掉的话，「把 slug 变成链接」这个纯可读性改进会被判成 tags.md 漂移。
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")

# ─────────────────────────────────────────────────────────────────────────────
# 覆盖率类检查的清单
#
# 第 1–8 项问的都是「**一致性**」：数字对不对、链接通不通、标签齐不齐。
# 下面三项问的是「**覆盖率**」：规范要求的东西，到底做了多少。
# 两者会各自出问题 —— 数字全对、链接全通时，覆盖率照样可以是 0，而前者
# 有检查器、后者没有，所以缺口总是长在后者身上（第三十四批的判据）。
# ─────────────────────────────────────────────────────────────────────────────

# 条目页眉（规范见 citation.md「条目页眉模板」，两行都必须有）
HEADER_LINE1_RE = re.compile(
    r"^> 版本基线：\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*｜\s*([^｜]+?)\s*｜\s*数据来源：", re.M
)
HEADER_LINE2_RE = re.compile(r"^> 本页数值随版本调整", re.M)
# 未决项提示行（页眉第三行）——A/B 编号必须与 citation.md 第三节逐字一致
PENDING_LINE_RE = re.compile(r"^> ⚠️ 本页含未决项：(.+)$", re.M)
PENDING_ID_RE = re.compile(r"\b([AB]\d+)\b")

# citation.md 第二节的基线声明 —— 单一事实源，页眉必须与它对齐
BASELINE_MONTH_RE = re.compile(r"\*\*基线快照时间\*\*\s*\|\s*\*\*(\d{4})\s*年\s*(\d{1,2})\s*月\*\*")
BASELINE_VER_RE = re.compile(r"\*\*全站基线版本\*\*\s*\|\s*\*\*([^*（(]+?)\s*[（(]")

# 参考区「总结型页面」——新条目落地后它们不会自动更新（站内已知盲区）
SUMMARY_PAGES = ["docs/mechanics.md", "docs/progression.md"]

# 图鉴层条目：机制篇之外另有「型号 / 清单」层的那一篇。
# 判据见 roadmap「装备线：机制层完整、图鉴层缺失」一节 ——
# 站内已为某子系统确立「机制篇 + 图鉴篇」两篇体例时，图鉴篇必须能从总结型参考页到达。
# ⚠️ 规则取「**合计覆盖**」：每个图鉴条目至少被 SUMMARY_PAGES 中一页引用。
#    判据是不对称性 —— 同类里「部分被引用、部分 0 引用」= 漂移；
#    若同类**全都** 0 引用，那才是「参考区不列图鉴」的设计，不该报错。
CATALOG_SLUGS = [
    "armor-catalog", "ammo-table", "food-catalog", "medical-catalog",
    "hideout-modules", "trader-questlines", "weapons", "night-vision",
    "headsets", "special-equipment", "loadout-carriers",
]


def read_baseline() -> tuple[str, str]:
    """从 citation.md 第二节读「基线快照时间」与「全站基线版本」。

    基线不从代码里硬编码 —— 季节一换，页眉就该全部跟着动，
    而这里读不到就报错退出（声明缺失必须响，不能静默通过）。
    """
    page = CONTENT / "docs" / "citation.md"
    if not page.exists():
        raise SystemExit("[错误] 找不到 content/docs/citation.md，无法确定基线")
    text = page.read_text(encoding="utf-8")
    m1 = BASELINE_MONTH_RE.search(text)
    m2 = BASELINE_VER_RE.search(text)
    if not m1 or not m2:
        raise SystemExit(
            "[错误] citation.md 第二节里找不到基线声明"
            "（应为「**基线快照时间** | **YYYY 年 M 月**」与「**全站基线版本** | **X.Y.Z（…）」）"
        )
    return f"{int(m1.group(1))} 年 {int(m1.group(2))} 月", m2.group(1).strip()


def read_pending_map() -> dict[str, list[str]]:
    """从 citation.md 第三节的 A / B 两类表格建立 {条目 slug: [编号…]}。

    这两张表是「哪一篇里哪一处存疑」的唯一登记处。条目页眉的第三行由它派生，
    所以两边一旦不一致就必须报错 —— 否则读者在条目上看到的编号会指向不存在的事项。
    """
    text = (CONTENT / "docs" / "citation.md").read_text(encoding="utf-8")
    section = re.search(r"^## 三、.*?(?=^## |\Z)", text, re.M | re.S)
    if not section:
        raise SystemExit("[错误] citation.md 里找不到「三、已知未决项」一节")
    out: dict[str, list[str]] = defaultdict(list)
    for line in section.group(0).splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        m = re.match(r"\*\*([AB]\d+)\*\*", cells[0])
        if not m:
            continue
        for slug in re.findall(r"\.\./entries/([a-z0-9-]+)\.md", cells[1]):
            out[slug].append(m.group(1))
    return {k: sorted(set(v)) for k, v in out.items()}


def load_nav_targets() -> list[str]:
    """从 mkdocs.yml 的 nav 段提取所有 .md 引用（简易解析，不引入依赖）。"""
    text = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    return re.findall(r":\s*([\w/\-\.]+\.md)", text)


def load_nav_groups() -> dict[str, tuple[str, int, bool]]:
    """nav 里每个「第X篇」→ (篇名, 该篇的页面数, 是否全部由 entries/ 页面组成)。

    这是「篇数」与「路径图篇数」两件事的**唯一事实来源**。

    为什么不再用「各篇篇数之和 = 条目总数」：第九 / 第十篇（任务图鉴 / 参考栏目）
    的页面在 quests/ 与 docs/ 下，**不进 `entries/*.md`**，那条等式天然不成立。
    取而代之的是两条更本质、也更难绕过的判据：

      ① **逐卡对账**：每张路径图卡的页数 = 该篇在 nav 里实际的页面数
         （旧判据只看总和 —— 把一张卡改对、另一张改错，总和不变就照样全绿）；
      ② **内容篇之和 = 条目总数**：页面全在 `entries/` 下的那几篇加起来
         必须正好等于 `entries/*.md`（除 index.md）—— 这条保住「86 个条目」的口径；
      ③ 卡片**数量**也必须等于 nav 的「第X篇」分组数（旧判据完全没看卡片数）。
    """
    lines = (ROOT / "mkdocs.yml").read_text(encoding="utf-8").splitlines()
    try:
        start = next(i for i, ln in enumerate(lines) if ln.startswith("nav:")) + 1
    except StopIteration:
        return {}
    pages: dict[str, set[str]] = defaultdict(set)
    names: dict[str, str] = {}
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
            if cur not in names:
                order.append(cur)
            names[cur] = g.group(3).strip().strip("\"'")
            cur_indent = len(g.group(1))
            continue
        if cur is not None and len(m.group(1)) <= cur_indent:
            cur = None          # 离开该分组（顶层栏目 / 首页等）
            continue
        if cur is not None:
            _, _, value = m.group(2).partition(":")
            for t in re.findall(r"([\w/\-\.]+\.md)", value):
                pages[cur].add(t)
    return {
        k: (
            names[k],
            len(pages.get(k, ())),
            bool(pages.get(k)) and all(p.startswith("entries/") for p in pages[k]),
        )
        for k in order
    }


def read_frontmatter_tags(md: Path) -> list[str]:
    """只读文件开头 YAML frontmatter 的 tags 列表，不引入 PyYAML。"""
    tags: list[str] = []
    lines = md.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return tags
    in_tags = False
    for raw in lines[1:]:
        s = raw.strip()
        if s == "---":
            break
        if s.startswith("tags:"):
            inline = s[len("tags:"):].strip()
            if inline.startswith("[") and inline.endswith("]"):
                for part in inline[1:-1].split(","):
                    part = part.strip().strip("\"'")
                    if part:
                        tags.append(part)
            else:
                in_tags = True
            continue
        if in_tags:
            m = TAG_LINE.match(raw)
            if m:
                tags.append(m.group(1).strip().strip("\"'"))
            elif s and not s.startswith("#"):
                in_tags = False
    return tags


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    # 1. nav 目标存在性
    nav_targets = load_nav_targets()
    if not nav_targets:
        errors.append("mkdocs.yml 未解析到任何 nav 条目")
    for target in nav_targets:
        if not (CONTENT / target).exists():
            errors.append(f"nav 引用的文件不存在: {target}")

    # 1b. nav 的「第X篇」分组 —— 篇数、每篇页数、以及「哪些篇是内容篇」都从这里读。
    #     先算好一次，后面「篇数声明」「路径图逐卡对账」「内容篇之和」三处共用，
    #     免得同一件事各算各的（那正是口径漂移的温床）。
    nav_groups = load_nav_groups()
    n_groups = len(nav_groups)
    if n_groups == 0:
        errors.append("mkdocs.yml 未解析到任何「第X篇」分组")

    # 2. content 内相对链接解析（排除代码块，模板占位符不受影响）
    md_files = sorted(CONTENT.rglob("*.md"))
    link_count = 0
    for md in md_files:
        text = md.read_text(encoding="utf-8")
        text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
        rel_dir = md.parent
        for match in LINK_RE.finditer(text):
            target = match.group(1).strip()
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            link_count += 1
            resolved = (rel_dir / target).resolve()
            if not resolved.exists():
                errors.append(f"断链: {md.relative_to(ROOT)} -> {target}")

    # 3. entries/ 条目骨架
    entry_files = sorted((CONTENT / "entries").glob("*.md"))
    entries = [p for p in entry_files if p.name != "index.md"]
    for entry in entries:
        text = entry.read_text(encoding="utf-8")
        if not text.startswith("---"):
            errors.append(f"条目缺少 frontmatter: {entry.name}")
        for section in REQUIRED_SECTIONS:
            if section not in text:
                errors.append(f"条目缺少固定章节 '{section}': {entry.name}")

    # 4. 条目计数一致性
    n_entries = len(entries)
    for md in md_files:
        # CHANGELOG 里出现的是历史记录（“当时全站尾行更新为 N 个条目”），
        # 描述的是那一次的现状而不是当前口径——历史记录不改写，也不参与计数校验。
        if md.name == "CHANGELOG.md":
            continue
        text = md.read_text(encoding="utf-8")
        for m in COUNT_RE.finditer(text):
            if int(m.group(1)) != n_entries:
                errors.append(
                    f"计数不一致: {md.relative_to(ROOT)} 写的是「{m.group(1)} 个条目」，"
                    f"实际 {n_entries} 个"
                )
        # 路径图：**逐卡对账 nav**。旧判据是「各篇篇数之和 = 条目总数」，
        # 只能证明总和没变 —— 一张卡改对、另一张改错，总和不变照样全绿。
        # 第九 / 第十篇引入后那条等式也不再成立（它们的页面不在 entries/ 下），
        # 于是改为三条更本质的断言：卡片数 = nav 分组数；每张卡的**篇名**与**页数**
        # 都与该篇在 nav 里的实际值一致；且 nav 里不存在「没画进路径图」的篇。
        cards = PATH_CARD_RE.findall(text)
        if cards:
            if len(cards) != n_groups:
                errors.append(
                    f"路径图卡片数为 {len(cards)}，与 nav 的「第X篇」分组数 {n_groups} 不符: "
                    f"{md.relative_to(ROOT)}"
                )
            drawn: set[str] = set()
            for num, name, cnt in cards:
                drawn.add(num)
                actual = nav_groups.get(num)
                if actual is None:
                    errors.append(f"路径图有「{num}」，但 nav 里没有这个分组: {md.relative_to(ROOT)}")
                    continue
                if name != actual[0]:
                    errors.append(
                        f"路径图篇名与 nav 不一致: 「{num}」画的是「{name}」，"
                        f"nav 写的是「{actual[0]}」: {md.relative_to(ROOT)}"
                    )
                if int(cnt) != actual[1]:
                    errors.append(
                        f"路径图篇数漂移: 「{num} · {name}」画的是 {cnt}，"
                        f"nav 实际 {actual[1]} 个页面: {md.relative_to(ROOT)}"
                    )
            for num, (name, _size, _is_content) in nav_groups.items():
                if num not in drawn:
                    errors.append(
                        f"nav 的「{num} · {name}」没有画进路径图: {md.relative_to(ROOT)}"
                    )
    for path, pattern, label in [
        (CONTENT / "entries" / "index.md", r"已收录 \*\*(\d+) 个\*\*条目", "总览页首句"),
        (CONTENT / "README.md", r"已收录 \*\*(\d+) 个\*\*条目", "站点首页首句"),
        (ROOT / "README.md", r"已收录 \*\*(\d+) 个\*\*条目", "仓库首页首句"),
        (ROOT / "README.md", r"共 (\d+) 篇", "仓库首页结构表"),
    ]:
        if not path.exists():
            continue
        found = re.search(pattern, path.read_text(encoding="utf-8"))
        if not found:
            # 声明了要检查、却在文件里找不到那句话，说明要么句子被改写了、要么该处漏了计数。
            # 这比"数字写错"更隐蔽：数字写错会报错，而找不到就静默通过（本条即因此长期空转）。
            errors.append(
                f"计数声明缺失（{label}）: {path.relative_to(ROOT)} 里找不到声明句，"
                f"预期模式 {pattern}"
            )
            continue
        if int(found.group(1)) != n_entries:
            errors.append(
                f"计数不一致（{label}）: {path.relative_to(ROOT)} 写的是 {found.group(1)}，"
                f"实际 {n_entries}"
            )

    # 4a. 内容篇之和 = 条目总数
    #     「篇」现在有两类：前八篇是**内容篇**（页面全在 entries/ 下，就是那 86 个条目），
    #     第九 / 第十篇是**栏目**（任务图鉴 / 参考，页面在 quests/ 与 docs/ 下）。
    #     分类是**从 nav 派生的**（该篇的页面是否全在 entries/ 下），不是写死的篇号区间 ——
    #     所以将来再加/再并一篇，这条断言自动跟着走。
    content_sum = sum(size for _name, size, is_content in nav_groups.values() if is_content)
    if content_sum != n_entries:
        errors.append(
            f"内容篇（页面全在 entries/ 下的那几篇）的篇数之和为 {content_sum}，"
            f"与条目总数 {n_entries} 不符 —— 要么某篇的页面挂错了目录，要么条目没进 nav"
        )

    # 4b. 篇数口径：声明的篇数必须与 nav 的「第X篇」分组数一致
    #     条目数对了不代表篇数对——取消/合并一篇时总数不变，只有篇数会变，
    #     而三处声明散在 index / content README / 根 README，靠肉眼一定会漏。
    for path, label in [
        (CONTENT / "entries" / "index.md", "总览页首句"),
        (CONTENT / "README.md", "站点首页首段"),
        (ROOT / "README.md", "仓库首页首段"),
    ]:
        if not path.exists():
            continue
        found = GROUP_DECL_RE.search(path.read_text(encoding="utf-8"))
        if not found:
            # 与计数那条同理：找不到声明句比数字写错更隐蔽——数字错会报错，
            # 找不到就静默通过。声明句被改写时这里必须响。
            errors.append(
                f"篇数声明缺失（{label}）: {path.relative_to(ROOT)} 里找不到「分N篇」的声明"
            )
            continue
        declared = CN_NUM[found.group(1)]
        if declared != n_groups:
            errors.append(
                f"篇数不一致（{label}）: {path.relative_to(ROOT)} 写的是 {found.group(1)}篇，"
                f"nav 实际 {n_groups} 篇"
            )

    # 4c. 首页「本站速览」的数字必须与数据一致
    #     **刻意复用生成器的实现**（`render()`），而不是在这里另写一遍算术：
    #     两套实现必然漂，而首页是第 N 处计数落点，肉眼绝对看不过来。
    #     生成器自己会比对磁盘内容，过期就返回 1 —— 这就是「数据变了但没重生成」的门禁。
    try:
        import gen_home_stats  # noqa: PLC0415  同目录，脚本模式下已加进 sys.path
        if gen_home_stats.main_check() != 0:
            errors.append("首页「本站速览」已过期 —— 跑 `python scripts/gen_home_stats.py` 重新生成")
    except Exception as exc:  # pragma: no cover
        errors.append(f"首页速览核对未能执行：{type(exc).__name__}: {exc}")

    # 5. tags.md 与 frontmatter 实际统计是否一致
    tagmap: dict[str, set[str]] = defaultdict(set)
    for md in md_files:
        for t in read_frontmatter_tags(md):
            tagmap[t].add(md.stem)
    tags_md = CONTENT / "tags.md"
    if tags_md.exists():
        declared: dict[str, tuple[int, set[str]]] = {}
        for tag, num, items in TAGS_ROW_RE.findall(tags_md.read_text(encoding="utf-8")):
            tag = tag.strip()
            if set(tag) <= set("-: "):
                continue
            entry_list = {MD_LINK_RE.sub(lambda m: m.group(1), x).strip()
                          for x in items.split("·") if x.strip()}
            declared[tag] = (int(num), entry_list)
        for tag, (num, items) in declared.items():
            actual = tagmap.get(tag, set())
            if not actual:
                errors.append(f"tags.md 登记了不存在的标签: {tag}")
                continue
            if num != len(actual):
                errors.append(f"tags.md 篇数漂移: 「{tag}」写的是 {num}，实际 {len(actual)}")
            if items and items != actual:
                missing = sorted(actual - items)
                extra = sorted(items - actual)
                detail = []
                if missing:
                    detail.append("漏 " + " · ".join(missing))
                if extra:
                    detail.append("多 " + " · ".join(extra))
                errors.append(f"tags.md 覆盖条目不符: 「{tag}」— " + "；".join(detail))
        for tag in tagmap:
            if tag not in declared:
                warnings.append(f"标签未登记在 tags.md: {tag}")

    # 6. 中文正文直引号残留
    #    判据是「**正文**里不许有直引号」，所以三类**语法引号**必须先剥掉：
    #    ① 行内代码 `` `"x"` `` —— 那是引号本身的写法，不是正文的标点；
    #    ② 原生 HTML 标签的属性引号 —— `<a href="#q01">` 里的引号属于标记语法。
    #    第 ② 类原先靠「行首是 `<` 就整行跳过」躲过去，但任务图鉴的索引表把
    #    `<a>` 写在**表格单元格里**（行首是 `|`），于是 515 行索引全被误报。
    #    按标签剥离（只去掉标签、保留标签内外的文字）既消掉误报，又不放过
    #    「段落里真的打了直引号」那种真问题 —— 例如 `<b>"引号"</b>` 仍会被抓到。
    #    ③ pymdownx.tabbed 的分页标记 `=== "标题"` —— 这里的引号是**语法**：
    #       扩展只认双引号（2026-10-06 实测：写成单引号整块不生效，分页标签
    #       直接不渲染），所以不能靠「改用单引号」绕开，只能在这里豁免。
    #       豁免的粒度是**整行**，与 ① ② 的剥离口径一致：只吃掉标记本身。
    for md in md_files:
        in_code = False
        for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            if line.strip().startswith("```"):
                in_code = not in_code
                continue
            if in_code or line.strip() == "---":
                continue
            if re.match(r"\s*<[a-zA-Z/]", line):
                continue
            if re.match(r"\s*=== ", line):
                continue
            prose = re.sub(r"`[^`]*`", "", line)
            prose = re.sub(r"<[^>]*>", "", prose)
            if '"' in prose and CN_CHAR.search(prose):
                errors.append(f"中文行残留直引号: {md.relative_to(ROOT)}:{lineno}")

    # 6b. 块级边界：表格行之后必须有空行 —— 否则下一个块会被「吞」进表格。
    #     Python-Markdown 的表格解析**遇到空行才结束**：表格行后面紧跟的非空行
    #     （标题 / 引用块 / 段落都算）会被当成表格行处理 —— 标题渲染成
    #     `<td>### …</td>`、引用块渲染成 `<td>&gt; …</td>`（连 `>` 都以字符
    #     形式留在正文里），而 `zensical build` 照常报 No issues found。
    #     与 skill 手册第五步「build 通过 ≠ 渲染正确」是同一类静默缺陷：
    #     读者看得见，机器看不见。
    #     2026-09-30 全站扫出 7 处长期在线缺陷（首页「第六篇」标题渲染丢失 +
    #     tags.md 5 个二级标题与 1 个引用块被吞），此后由本条断言兜底。
    #     注：代码围栏内的表格示例是演示文本，不做断言（与第 6 项同一套 in_code）。
    for md in md_files:
        in_code = False
        prev_is_table = False
        for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code = not in_code
                prev_is_table = False
                continue
            if in_code:
                continue
            if prev_is_table and stripped and not stripped.startswith("|"):
                errors.append(
                    f"表格后缺空行（该行会被吞进表格渲染）: "
                    f"{md.relative_to(ROOT)}:{lineno}「{stripped[:24]}」"
                )
            prev_is_table = stripped.startswith("|")

    # 7. 总览页「按标签浏览」：slug 必须真实存在、条数必须与声明一致、分隔符必须统一
    index_md = CONTENT / "entries" / "index.md"
    if index_md.exists():
        text = index_md.read_text(encoding="utf-8")
        for m in re.finditer(r"^- \*\*([^*]+?)\*\*（(\d+) 篇）：(.+)$", text, re.M):
            tag, num, items = m.group(1), int(m.group(2)), m.group(3)
            if re.search(r"[a-z0-9-] [a-z0-9-]", items):
                warnings.append(
                    f"总览页「按标签浏览」分隔符不统一（应为「 · 」）: 「{tag}」"
                )
            slugs = [x for x in re.split(r"[·\s]+", items) if x.strip()]
            if num != len(slugs):
                errors.append(
                    f"总览页「按标签浏览」条数不符: 「{tag}」写 {num} 篇，实际列出 {len(slugs)} 个"
                )
            for s in slugs:
                if not (
                    (CONTENT / "entries" / f"{s}.md").exists()
                    or (CONTENT / "docs" / f"{s}.md").exists()
                ):
                    errors.append(
                        f"总览页「按标签浏览」列了不存在的条目: {s}（标签「{tag}」）"
                    )

    # 8. 主条目必须链接到它的细分条目
    #    「细分 → 主」是回望（"基础规则见…"），「主 → 细分」才是深入。
    #    缺后者时，读者读完整篇也不知道还有更细的一篇。
    SUBPAGE_PAIRS = [
        ("armor", "armor-catalog"),
        ("armor", "armor-repair"),
        ("ammo", "ammo-table"),
        ("hideout", "hideout-modules"),
        ("extraction", "extraction-points"),
        ("seasons", "season-modifiers"),
        ("flea-market", "flea-pricing"),
        ("scav-relations", "scav-command"),
        ("quests", "trader-questlines"),
        ("lighting", "night-vision"),
        ("gunsmith", "weapons"),
        ("traders", "trader-questlines"),
        # 机制 → 图鉴：与 armor/ammo 同理，「机制篇」必须指向它的「型号篇」
        ("audio", "headsets"),
        ("inventory", "loadout-carriers"),
    ]
    for main_slug, sub_slug in SUBPAGE_PAIRS:
        main_md = CONTENT / "entries" / f"{main_slug}.md"
        sub_md = CONTENT / "entries" / f"{sub_slug}.md"
        if not main_md.exists() or not sub_md.exists():
            warnings.append(f"主-细分对涉及的文件缺失: {main_slug} / {sub_slug}")
            continue
        if f"]({sub_slug}.md)" not in main_md.read_text(encoding="utf-8"):
            errors.append(f"主条目未链接到细分条目: {main_slug}.md 缺 -> {sub_slug}.md")

    # 9. 条目页眉覆盖率 + 未决项编号一致性
    #    规范见 citation.md「条目页眉模板」、骨架见 template.md；2026-09-28 之前
    #    收录的条目从未回填。这一行是「整站引用口径」落在单篇上的唯一载体 ——
    #    读者拿到某一篇时，只有它告诉读者这篇属于哪一档口径。
    base_month, base_ver = read_baseline()
    pending_map = read_pending_map()
    missing_header: list[str] = []
    stale_header: list[str] = []
    bad_pending: list[str] = []
    for entry in entries:
        text = entry.read_text(encoding="utf-8")
        m1 = HEADER_LINE1_RE.search(text)
        if not m1 or not HEADER_LINE2_RE.search(text):
            missing_header.append(entry.name)
        elif f"{int(m1.group(1))} 年 {int(m1.group(2))} 月" != base_month or base_ver not in m1.group(3):
            stale_header.append(
                f"{entry.name}（写的是 {int(m1.group(1))} 年 {int(m1.group(2))} 月）"
            )
        expected = pending_map.get(entry.stem, [])
        m2 = PENDING_LINE_RE.search(text)
        actual = sorted(set(PENDING_ID_RE.findall(m2.group(1)))) if m2 else []
        if sorted(set(expected)) != actual:
            bad_pending.append(
                f"{entry.name} 页眉标注「{'、'.join(actual) or '无'}」"
                f"，citation 登记「{'、'.join(expected) or '无'}」"
            )
    if missing_header:
        show = "、".join(missing_header[:5]) + ("…" if len(missing_header) > 5 else "")
        errors.append(
            f"条目页眉缺失 {len(missing_header)}/{len(entries)} 篇"
            f"（规范：citation.md「条目页眉模板」，两行都要）: {show}"
        )
    if stale_header:
        errors.append(
            f"条目页眉与基线不一致（应写「{base_month} ｜ {base_ver}」）: "
            + "、".join(stale_header[:5])
        )
    if bad_pending:
        errors.append("页眉未决项编号与 citation.md 第三节不一致: " + "；".join(bad_pending))

    # 10. 参考区「总结型页面」必须能到达图鉴层
    #     速查表与成长路线是总结型页面，新条目落地后它们不会自动更新 ——
    #     这是站内已知盲区，此前靠人工记得去补，现在改成机器记得。
    reachable: set[str] = set()
    for rel in SUMMARY_PAGES:
        p = CONTENT / rel
        if not p.exists():
            warnings.append(f"参考区页面缺失: {rel}")
            continue
        reachable |= set(re.findall(r"\.\./entries/([a-z0-9-]+)\.md", p.read_text(encoding="utf-8")))
    unreachable = [s for s in CATALOG_SLUGS if s not in reachable]
    if unreachable:
        errors.append(
            "参考区到不了这些图鉴条目（总结型页面不会自动更新，需手工补链）: "
            + "、".join(f"{s}.md" for s in unreachable)
        )

    # 11. llms.txt —— AI 的第一入口，此前没有任何检查器覆盖
    #     它手写着条目数、篇数、篇目录与参考区清单。漂移时页面读者未必发现，
    #     但 AI 会照着错的清单去引用 —— 所以它的护栏优先级不低于正文。
    llms = CONTENT / "llms.txt"
    if not llms.exists():
        errors.append("缺少 content/llms.txt（面向 AI 的入口索引）")
    else:
        text = llms.read_text(encoding="utf-8")
        counts = re.findall(r"(\d+) 个条目", text)
        if not counts:
            errors.append("llms.txt 里找不到条目计数声明（声明缺失必须响，不能静默通过）")
        for c in set(counts):
            if int(c) != n_entries:
                errors.append(f"llms.txt 计数不一致: 写的是「{c} 个条目」，实际 {n_entries} 个")
        g = GROUP_DECL_RE.search(text)
        if not g:
            errors.append("llms.txt 里找不到「分N篇」的篇数声明")
        elif CN_NUM[g.group(1)] != n_groups:
            errors.append(f"llms.txt 篇数不一致: 写的是 {g.group(1)}篇，nav 实际 {n_groups} 篇")
        for slug in sorted(set(re.findall(r"/(?:entries|docs)/([a-z0-9-]+)/", text))):
            if not (
                (CONTENT / "entries" / f"{slug}.md").exists()
                or (CONTENT / "docs" / f"{slug}.md").exists()
            ):
                errors.append(f"llms.txt 列了不存在的页面: {slug}")
        missing_docs = [
            p.stem
            for p in sorted((CONTENT / "docs").glob("*.md"))
            if p.stem != "index" and f"/docs/{p.stem}/" not in text
        ]
        if missing_docs:
            errors.append(
                "llms.txt 参考区未列出这些参考页: " + "、".join(missing_docs)
            )

    # 12. 汇总
    print("=" * 60)
    print(f"内容文件总数: {len(md_files)}")
    print(f"百科条目数:   {n_entries}")
    n_content = sum(1 for _n, _s, c in nav_groups.values() if c)
    print(f"分区数:       {n_groups}（内容篇 {n_content} + 栏目 {n_groups - n_content}）")
    print(f"nav 目标数:   {len(nav_targets)}")
    print(f"内部链接数:   {link_count}")
    print(f"标签总数:     {len(tagmap)}")
    print("=" * 60)

    if warnings:
        for w in warnings:
            print(f"  [警告] {w}")
    if errors:
        print(f"校验失败，共 {len(errors)} 个问题:")
        for e in errors:
            print(f"  [错误] {e}")
        return 1
    print(
        "✅ 校验通过：nav 完整、无断链、骨架齐整、计数与标签一致、无直引号残留、表格边界规范；"
        "页眉覆盖齐全、参考区可达全部图鉴、llms.txt 与实际一致。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
