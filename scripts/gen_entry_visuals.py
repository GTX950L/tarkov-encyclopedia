#!/usr/bin/env python3
"""条目页阅读层改造：版本基线 → 注释条、基本信息表 → 芯片流、emoji 引用 → 语义提示块。

⚠️ 这是**一次性迁移**，不是常驻生成器：`content/entries/*.md` 是手写内容，
   每次构建重跑会覆盖人工编辑。跑完这一版就归档，新增页面照 `content/template.md`
   的写法手写。

改造三件事（每一件都独立幂等，已改造的页会自动跳过）：

1. **页首版本基线**：h1 与 `<a id="top">` 之间那段 blockquote（93 页各 2–5 行，
   其中 19 页含链接）包进 `<div class="tk-ver" data-search-exclude markdown>`。
   原文一字不改，只去掉 `>` 前缀 —— 视觉上从「引言」降为「脚注」。
   为什么加 data-search-exclude：这 93 段是**逐字重复的元信息**，进搜索索引只会
   稀释结果（同一句话命中 93 次）。

2. **基本信息表**：`## 📸 基本信息` 下的表格外包 `<div class="tk-kv-wrap" markdown>`，
   由 CSS 重排成流式芯片。**表格内容一个字都不动** —— 单元格里有 `**加粗**` 和
   `[链接]()`，改写成 HTML span 就不再解析了（md_in_html 只对块级容器生效）。

3. **emoji 引用块**：首行以 📐 / ⚠️ / 📈 / 🎯 开头的引用块，外包
   `<div class="tk-note tk-note--x" markdown>`。**只有这 4 种 emoji 才处理** ——
   实测 414 个引用块里只有约 70 个带类型标记，其余 223 个是「核心机制」下的
   正文推演，硬套语义颜色只会误判（详见 CHANGELOG v1.151.0）。

4. **地图条目页缩略图**：13 个地图页插一条 `<figure class="tk-entry-map">`，
   复用 `assets/maps/thumbs/`（零新增素材）。其余 80 页不做装饰性配图。

用法：
    python scripts/gen_entry_visuals.py --dry content/entries/customs.md
    python scripts/gen_entry_visuals.py            # 全量
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from _console import setup as _setup_console

ROOT = Path(__file__).resolve().parent.parent
ENTRIES = ROOT / "content" / "entries"

# 13 个地图条目页 → 缩略图文件名。**三个不同名**：labs/the-lab、labyrinth/the-labyrinth、
# streets/streets-of-tarkov，其余 10 个同名。
MAP_THUMBS: dict[str, str] = {
    "customs": "customs.png",
    "factory": "factory.png",
    "ground-zero": "ground-zero.png",
    "woods": "woods.png",
    "interchange": "interchange.png",
    "reserve": "reserve.png",
    "shoreline": "shoreline.png",
    "lighthouse": "lighthouse.png",
    "streets": "streets-of-tarkov.png",
    "labs": "the-lab.png",
    "terminal": "terminal.png",
    "icebreaker": "icebreaker.png",
    "labyrinth": "the-labyrinth.png",
}

# emoji → (class 后缀, 中文标签)。只认这四种，其余一律不动 —— 见文件头第 3 条。
NOTE_TYPES: list[tuple[str, str, str]] = [
    ("⚠️", "warn", "警示"),
    ("📐", "data", "口径"),
    ("📈", "time", "时效"),
    ("🎯", "key", "重点"),
]

TOP_ANCHOR = '<a id="top"></a>'
BASIC_H2 = "## 📸 基本信息"


def _split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    end = text.find("\n", end + 4)
    return text[: end + 1], text[end + 1 :]


def _strip_quote(line: str) -> str:
    """去掉行首的 `>` 与一个空格；`>` 后无内容时返回空串。"""
    if not line.startswith(">"):
        return line
    rest = line[1:]
    return rest[1:] if rest.startswith(" ") else rest


def migrate_text(text: str, page: str) -> tuple[str, list[str]]:
    """返回 (新文本, 改动清单)。每个子步骤独立判断，天然幂等。"""
    changes: list[str] = []
    lines = text.split("\n")

    # ── 1. 页首 blockquote → .tk-ver ───────────────────────────────────────
    if 'class="tk-ver"' not in text:
        try:
            h1 = next(i for i, l in enumerate(lines) if l.startswith("# "))
            top = next(i for i, l in enumerate(lines) if TOP_ANCHOR in l)
        except StopIteration:
            h1 = top = -1
        if h1 >= 0 and top > h1:
            seg_idx = [i for i in range(h1 + 1, top) if lines[i].strip()]
            if seg_idx and all(lines[i].startswith(">") for i in seg_idx):
                # ⚠️ **`>` 前缀必须原样保留**，不能去掉。
                #    check_entries.py 的 HEADER_LINE1_RE 是 `^> 版本基线：`，
                #    HEADER_LINE2_RE 是 `^> 本页数值随版本调整`，两行都是行首锚定的
                #    正则 —— 去掉 `>` 会让 93 页全部判「条目页眉缺失」，第三行的
                #    未决项编号（A/B）也随之解析不到（实测：93/93 篇报缺失 + 15 篇
                #    编号不一致）。
                #    所以这里只**在外面加一层容器**，结构一个字不改。
                body = [lines[i].rstrip() for i in seg_idx]
                new = (
                    ['<div class="tk-ver" data-search-exclude markdown>', ""]
                    + body
                    + ["", "</div>"]
                )
                start, end = seg_idx[0], seg_idx[-1]
                lines = lines[:start] + new + lines[end + 1 :]
                changes.append(f"版本基线 → .tk-ver（{len(seg_idx)} 行，`>` 前缀保留）")
                text = "\n".join(lines)

    # ── 2. 基本信息表 → .tk-kv-wrap ────────────────────────────────────────
    if 'class="tk-kv-wrap"' not in text:
        lines = text.split("\n")
        try:
            h2 = next(i for i, l in enumerate(lines) if l.strip() == BASIC_H2)
        except StopIteration:
            h2 = -1
        if h2 >= 0:
            nxt = next(
                (i for i in range(h2 + 1, len(lines)) if lines[i].startswith("## ")),
                len(lines),
            )
            rows = [i for i in range(h2 + 1, nxt) if lines[i].lstrip().startswith("|")]
            if rows:
                first, last = rows[0], rows[-1]
                new = (
                    ['<div class="tk-kv-wrap" markdown>', ""]
                    + lines[first : last + 1]
                    + ["", "</div>"]
                )
                lines = lines[:first] + new + lines[last + 1 :]
                changes.append(f"基本信息表 → .tk-kv-wrap（{len(rows)} 行）")
                text = "\n".join(lines)

    # ── 3. 地图条目页缩略图 ───────────────────────────────────────────────
    stem = Path(page).stem
    if 'class="tk-entry-map"' not in text and stem in MAP_THUMBS:
        lines = text.split("\n")
        try:
            h2 = next(i for i, l in enumerate(lines) if l.strip() == BASIC_H2)
        except StopIteration:
            h2 = -1
        if h2 >= 0:
            thumb = MAP_THUMBS[stem]
            # 交互地图页的文件名 = 缩略图去掉 .png（streets-of-tarkov / the-lab / the-labyrinth）
            map_page = thumb[:-4]
            block = [
                # ⚠️ 外层必须是块级 <div>：单独写 <a> 会被 markdown 包进 <p>
                #    （实测产物是 `<p><a class="tk-entry-map">…</a></p>`），
                #    而 .tk-entry-map 是 display:block —— 块级元素嵌在 <p> 里
                #    是非法结构，浏览器会自行拆包，边距与边框都会乱。
                '<div class="tk-entry-map" data-search-exclude>',
                f'<a href="../maps/{map_page}.md">',
                f'<img src="../assets/maps/thumbs/{thumb}" '
                f'alt="{stem} 地图缩略图" loading="lazy" decoding="async">',
                '<span class="tk-entry-map__cap">交互地图 · 点击查看完整点位</span>',
                "</a>",
                "</div>",
            ]
            # 插在「## 📸 基本信息」上方最近的 `---` 之后；没有就插在 h2 之前
            ins = h2
            for j in range(h2 - 1, max(h2 - 6, -1), -1):
                if lines[j].strip() == "---":
                    ins = j + 1
                    break
            # 吃掉插入点后原有的空行，避免插出两个连续空行
            k = ins
            while k < len(lines) and not lines[k].strip():
                k += 1
            lines = lines[:ins] + [""] + block + [""] + lines[k:]
            changes.append(f"地图缩略图 → {thumb}（链到 maps/{map_page}）")
            text = "\n".join(lines)

    # ── 4. emoji 引用块 → .tk-note ─────────────────────────────────────────
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    wrapped = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("> "):
            # 收集整块
            j = i
            block = []
            while j < len(lines) and lines[j].startswith(">"):
                block.append(lines[j])
                j += 1
            first_txt = _strip_quote(block[0]).strip()
            # 已经在 tk-note 里（上一行是 <div class="tk-note...>）就原样输出
            prev = "".join(out[-3:])
            already = 'class="tk-note' in prev
            kind = None
            if not already:
                # 允许 `**⚠️ …**` 或 `⚠️ …` 两种写法
                probe = first_txt.lstrip("*").strip()
                for emo, cls, label in NOTE_TYPES:
                    if probe.startswith(emo):
                        kind = (cls, label)
                        break
            if kind:
                cls, label = kind
                out.append(f'<div class="tk-note tk-note--{cls}" markdown>')
                out.append("")
                out.extend(block)
                out.append("")
                out.append("</div>")
                wrapped += 1
            else:
                out.extend(block)
            i = j
        else:
            out.append(line)
            i += 1
    if wrapped:
        changes.append(f"emoji 引用块 → .tk-note（{wrapped} 块）")
        text = "\n".join(out)

    return text, changes


def main() -> int:
    _setup_console()
    ap = argparse.ArgumentParser(description="条目页阅读层改造（一次性迁移）")
    ap.add_argument("--dry", metavar="FILE", help="只打印某一页的改造结果，不写盘")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.dry:
        p = Path(args.dry)
        text = p.read_text(encoding="utf-8")
        new, changes = migrate_text(text, p.name)
        print(f"=== {p.name} ===")
        print("改动：" + ("；".join(changes) if changes else "无"))
        print("-" * 70)
        print(new[:2600])
        return 0

    files = sorted(ENTRIES.glob("*.md"))
    touched = skipped = 0
    total = {"tk-ver": 0, "tk-kv-wrap": 0, "tk-entry-map": 0, "tk-note": 0}
    for p in files:
        text = p.read_text(encoding="utf-8")
        new, changes = migrate_text(text, p.name)
        if new != text:
            p.write_bytes(new.encode("utf-8"))
            touched += 1
            for c in changes:
                if "版本基线" in c:
                    total["tk-ver"] += 1
                if "基本信息表" in c:
                    total["tk-kv-wrap"] += 1
                if "地图缩略图" in c:
                    total["tk-entry-map"] += 1
                if "emoji 引用块" in c:
                    total["tk-note"] += 1
            if not args.quiet:
                print(f"  ✓ {p.name:34} {'；'.join(changes)}")
        else:
            skipped += 1
    print(f"\n改造 {touched} 页，跳过 {skipped} 页")
    print(f"  版本基线 → .tk-ver        {total['tk-ver']} 页")
    print(f"  基本信息 → .tk-kv-wrap    {total['tk-kv-wrap']} 页")
    print(f"  地图缩略图 → .tk-entry-map {total['tk-entry-map']} 页")
    print(f"  emoji 块 → .tk-note       {total['tk-note']} 页")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
