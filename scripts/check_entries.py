#!/usr/bin/env python3
"""条目一致性校验（只读，不改文件）。

检查内容：
1. mkdocs.yml nav 中引用的所有 markdown 文件是否存在；
2. content/ 下所有 markdown 内的相对链接（.md）是否可解析；
3. entries/ 条目骨架完整性（固定章节是否存在）；
4. 条目计数一致性：全站「查看全部 N 个条目」、总览页、两处 README、路径图篇数之和；
5. tags.md 的篇数与覆盖条目是否与 frontmatter 实际统计一致（防手工维护漂移）；
6. 中文正文中是否残留直引号（英文/代码行不计）；
7. 统计条目数，输出汇总报告。

用法：python scripts/check_entries.py
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

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
# tags.md 的表格行：| 标签 | 篇数 | 覆盖条目 |
TAGS_ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*$", re.M)


def load_nav_targets() -> list[str]:
    """从 mkdocs.yml 的 nav 段提取所有 .md 引用（简易解析，不引入依赖）。"""
    text = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    return re.findall(r":\s*([\w/\-\.]+\.md)", text)


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
        text = md.read_text(encoding="utf-8")
        for m in COUNT_RE.finditer(text):
            if int(m.group(1)) != n_entries:
                errors.append(
                    f"计数不一致: {md.relative_to(ROOT)} 写的是「{m.group(1)} 个条目」，"
                    f"实际 {n_entries} 个"
                )
        # 路径图：各篇篇数之和应等于条目总数
        parts = re.findall(r"第[一二三四五六七八九十]篇<br/>[^<]*<br/>(\d+) 篇", text)
        if parts and sum(int(x) for x in parts) != n_entries:
            errors.append(
                f"路径图篇数之和为 {sum(int(x) for x in parts)}，与条目总数 {n_entries} 不符: "
                f"{md.relative_to(ROOT)}"
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
        if found and int(found.group(1)) != n_entries:
            errors.append(
                f"计数不一致（{label}）: {path.relative_to(ROOT)} 写的是 {found.group(1)}，"
                f"实际 {n_entries}"
            )

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
            entry_list = {x.strip() for x in items.split("·") if x.strip()}
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
            if '"' in line and CN_CHAR.search(line):
                errors.append(f"中文行残留直引号: {md.relative_to(ROOT)}:{lineno}")

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

    # 8. 汇总
    print("=" * 60)
    print(f"内容文件总数: {len(md_files)}")
    print(f"百科条目数:   {n_entries}")
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
    print("✅ 校验通过：nav 完整、无断链、骨架齐整、计数与标签一致、无直引号残留。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
