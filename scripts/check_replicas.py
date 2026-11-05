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
  C2. ``description`` 去掉「主题：」前缀后也**不能一字不差**（同构检测）
      —— 2026-11-05 复查：27 个图鉴页只差冒号前那个分类名，B 全部放行
  D. 每页恰好一个 ``h1`` —— 2026-11-05 复查：``story/labyrinth.md`` 有 3 个，
      原因分别是行首 ``#1156``（井号后无空格）与列表项里的 ``1. #标题``，
      Python-Markdown 两种都照解析，线上因此有两段正文被撑成一级标题

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


def unwrap_yaml(v: str) -> str:
    """取引号内的值，丢掉行尾注释（``"…"  # 自动生成``）。

    不这么做的话 description 的值会带着 ``"  # 自动生成`` 一起参与比对与报错，
    报错信息里全是噪声，而且「人工写的那行没标记」反而能躲过撞车检测。
    """
    v = (v or "").strip()
    m = re.match(r'^"(.*)"\s*(?:#.*)?$', v, re.S) or re.match(r"^'(.*)'\s*(?:#.*)?$", v, re.S)
    if m:
        return m.group(1)
    return re.sub(r"\s+#.*$", "", v)


def check_meta() -> list[str]:
    """B/C/C2：description 必须存在、唯一且不同构；title 撞车要报。"""
    errs: list[str] = []
    descs: dict[str, list[str]] = defaultdict(list)
    titles: dict[str, list[str]] = defaultdict(list)
    missing: list[str] = []

    for p in sorted(CONTENT.rglob("*.md")):
        if p.name in SKIP:
            continue
        rel = p.relative_to(CONTENT).as_posix()
        fm = front_matter(p)
        d = unwrap_yaml(fm.get("description", ""))
        if not d:
            missing.append(rel)
        else:
            descs[d].append(rel)
        t = unwrap_yaml(fm.get("title", ""))
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

    # C2：**同构**摘要 —— 去掉「主题：」前缀后一字不差的，也算撞车。
    # 为什么单列这一条：2026-11-03 修过「191 页同一句话」，2026-11-05 复查发现
    # 它换了个形态又回来了 —— 27 个图鉴页的摘要只差冒号前那个分类名，
    # 逐字比对（上面那条）全部通过。判据必须比到「去掉前缀之后」。
    # ⚠️ 不做数字归一化：图鉴页的摘要靠「收录 446 件」区分，归一化会把
    #    合理的信息量抹掉、误报成撞车。只认「连数字都一样」。
    bodies: dict[str, list[str]] = defaultdict(list)
    for d, pages in descs.items():
        bodies[d.split("：", 1)[1] if "：" in d else d].extend(pages)
    for b, pages in bodies.items():
        if len(pages) > 1 and len({p for p in pages}) > 1:
            errs.append(f"description 同构 ×{len(pages)}（只是前缀不同）："
                        f"{' / '.join(pages)} ｜ 共同正文「{b[:40]}」")
    return errs


H1_STD = re.compile(r"^#[^#]")                  # 行首 # 后不是 #（含「#1156」这类无空格写法）
H1_IN_LIST = re.compile(r"^\s*\d+\.\s+#[^#]")   # 有序列表项里写「1. #标题」


def check_headings() -> list[str]:
    """D：每页恰好一个 h1。

    为什么查 md 而不是构建产物：h1 数量在源文件里就确定了，能在构建之前报；
    产物级的检查要等构建完，而这类错误一旦上线就是「读者先看见」。

    为什么判据不能只看行首 ``# ``：Python-Markdown **不要求**井号后有空格，
    ``#1156 的原型…`` 照样解析成 h1；列表项里写 ``1. #标题`` 会渲染成
    ``<li><h1>…</h1></li>``。两种都不是作者本意，但产物里都是真 h1。

    2026-11-05 实测：全站 191 份 md 只有 ``story/labyrinth.md`` 命中（3 个 h1），
    线上该页为此出现两段被撑成一级标题的正文，而当时九道门禁一道都没红。
    """
    errs: list[str] = []
    for p in sorted(CONTENT.rglob("*.md")):
        if p.name in SKIP:
            continue
        text = p.read_text(encoding="utf-8")
        if text.startswith("---\n"):
            end = text.find("\n---\n", 4)
            if end != -1:
                text = text[end + 5:]
        t = re.sub(r"```.*?```", "", text, flags=re.S)
        t = re.sub(r"`[^`\n]*`", "", t)
        hits = [(i, ln[:48]) for i, ln in enumerate(t.splitlines(), 1)
                if H1_STD.match(ln) or H1_IN_LIST.match(ln)]
        if len(hits) != 1:
            rel = p.relative_to(CONTENT).as_posix()
            detail = "；".join(f":{i} {ln}" for i, ln in hits[:4])
            errs.append(f"h1 数量 {len(hits)}（应为 1）：{rel} ｜ {detail}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix-hint", action="store_true")
    args = ap.parse_args()

    errs = check_map_cards() + check_meta() + check_headings()
    if not errs:
        n = sum(1 for p in CONTENT.rglob("*.md") if p.name not in SKIP)
        print(f"✓ 副本类信息一致：13 张地图卡片 ｜ {n} 页 description 唯一且不同构 "
              f"｜ title 无撞车 ｜ 每页 h1 恒为 1")
        return 0

    print(f"✗ 副本类信息有 {len(errs)} 处问题：", file=sys.stderr)
    for e in errs:
        print("  " + e, file=sys.stderr)
    if args.fix_hint:
        print("\n修法：\n"
              "  · 地图卡片 → python scripts/gen_map_cards.py\n"
              "  · description → python scripts/gen_page_meta.py\n"
              "  · description 同构 → 这几页的摘要只差前缀，说明首段是模板句；\n"
              "    让生成器把「收录件数 / 任务数」这类可区分数字写进摘要\n"
              "  · title 撞车 → 该页在 nav 里叫通用名（如「总览」），"
              "gen_page_meta 会用其 h1 覆盖\n"
              "  · h1 数量不对 → 大概率是行首写了 `#1156` 这类（井号后没空格，\n"
              "    Python-Markdown 照样当标题）或列表项里写 `1. #标题`；\n"
              "    改成 `「#1156」` 或转义成 `\\#1156`", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
