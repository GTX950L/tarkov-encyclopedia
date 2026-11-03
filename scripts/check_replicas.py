#!/usr/bin/env python3
"""副本类信息门禁：同一件事写在两处的，必须对得上。

为什么单独一支
--------------
站内七道门禁守的是**内容正确性**（断链、计数、图标表、承诺、投影…），
但 2026-11-03 全站审查查出的 P1 有一半不是「内容错」，而是**副本错**：

  · 地图总览卡片的 13 组数字是手写的，漂了 9 组（区域合计 589 vs 真值 522）
  · 191 个页面的 meta description 全部回落到同一句话
  · 6 个页面的 <title> 都叫「总览」

三者有共同的形态：**一处自动、一处手写（或干脆没人写）**。
门禁只管前者，后者就一直静默。本脚本补的正是这一类：

  A. 地图卡片三数字 = ``maps_site.json``（由 ``gen_map_cards.py`` 维护）
  B. 每个页面都有 front matter ``description``，且 191 页互不相同
  C. 每个页面的 front matter ``title`` 互不相同（撞车会让搜索结果分不清）

**为什么 B/C 查 md 而不查构建产物**：产物要跑完 ⑥ 才有，而这类错误在源文件里
就已经确定；提前到 ⑤f 能让人在构建之前就看见。产物级的链接有效性由 CI 的
check-internal-links 负责，不在这里重复。

用法
----
    python scripts/check_replicas.py          # 门禁模式，有问题退出码 1
    python scripts/check_replicas.py --fix-hint   # 额外打印修法
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

CONTENT = ROOT / "content"
SKIP = {"template.md", "tags.md"}   # 编纂附件：不进 nav、不进 sitemap


def front_matter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}
    out = {}
    for line in text[4:end].split("\n"):
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def check_map_cards() -> list[str]:
    """A：卡片数字与 maps_site.json 一致（复用生成器的 --check 逻辑）。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("gmc", ROOT / "scripts" / "gen_map_cards.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    try:
        import json
        maps = json.loads(m.SITE.read_text(encoding="utf-8"))
        _, changes = m.build(maps)
    except (KeyError, ValueError) as e:
        return [f"地图卡片：{e}"]
    return [f"地图卡片数字与 maps_site.json 不一致：{c}" for c in changes]


def check_meta() -> list[str]:
    """B/C：description 必须存在且唯一；title 撞车要报。"""
    errs: list[str] = []
    descs: dict[str, list[str]] = defaultdict(list)
    titles: dict[str, list[str]] = defaultdict(list)
    missing: list[str] = []

    for p in sorted(CONTENT.rglob("*.md")):
        if p.name in SKIP:
            continue
        rel = p.relative_to(CONTENT).as_posix()
        fm = front_matter(p)
        d = (fm.get("description") or "").strip().strip('"')
        if not d:
            missing.append(rel)
        else:
            descs[d].append(rel)
        t = (fm.get("title") or "").strip().strip('"')
        if t:
            titles[t].append(rel)

    if missing:
        errs.append(f"{len(missing)} 页缺 front matter description（跑 gen_page_meta.py），"
                    f"如：{', '.join(missing[:5])}")
    for d, pages in descs.items():
        if len(pages) > 1:
            errs.append(f"description 撞车 ×{len(pages)}：{' / '.join(pages)}")
    for t, pages in titles.items():
        if len(pages) > 1:
            errs.append(f"title 撞车 ×{len(pages)}：「{t}」（{' / '.join(pages)}）")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix-hint", action="store_true")
    args = ap.parse_args()

    errs = check_map_cards() + check_meta()
    if not errs:
        n = sum(1 for p in CONTENT.rglob("*.md") if p.name not in SKIP)
        print(f"✓ 副本类信息一致：13 张地图卡片 ｜ {n} 页 description 唯一 ｜ title 无撞车")
        return 0

    print(f"✗ 副本类信息有 {len(errs)} 处问题：", file=sys.stderr)
    for e in errs:
        print("  " + e, file=sys.stderr)
    if args.fix_hint:
        print("\n修法：\n"
              "  · 地图卡片 → python scripts/gen_map_cards.py\n"
              "  · description → python scripts/gen_page_meta.py\n"
              "  · title 撞车 → 该页在 nav 里叫通用名（如「总览」），"
              "gen_page_meta 会用其 h1 覆盖", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
