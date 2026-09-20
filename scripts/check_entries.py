#!/usr/bin/env python3
"""条目一致性校验（只读，不改文件）。

检查内容：
1. mkdocs.yml nav 中引用的所有 markdown 文件是否存在；
2. content/ 下所有 markdown 内的相对链接（.md）是否可解析；
3. entries/ 条目骨架完整性（固定章节是否存在）；
4. 统计条目数，输出汇总报告。

用法：python scripts/check_entries.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

REQUIRED_SECTIONS = [
    "## 📸 基本信息",
    "## 🔗 相关条目",
    "[回到顶部](#top)",
]

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#]+?)(?:#[^)]*)?\)")


def load_nav_targets() -> list[str]:
    """从 mkdocs.yml 的 nav 段提取所有 .md 引用（简易解析，不引入依赖）。"""
    text = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    return re.findall(r":\s*([\w/\-\.]+\.md)", text)


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

    # 4. 汇总
    print("=" * 60)
    print(f"内容文件总数: {len(md_files)}")
    print(f"百科条目数:   {len(entries)}")
    print(f"nav 目标数:   {len(nav_targets)}")
    print(f"内部链接数:   {link_count}")
    print("=" * 60)

    if warnings:
        for w in warnings:
            print(f"  [警告] {w}")
    if errors:
        print(f"校验失败，共 {len(errors)} 个问题:")
        for e in errors:
            print(f"  [错误] {e}")
        return 1
    print("✅ 校验通过：nav 完整、无断链、条目骨架齐整。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
