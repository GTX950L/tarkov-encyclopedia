#!/usr/bin/env python3
"""图标语义表一致性校验（只读，不改文件）。

背景：`content/template.md` 有一节「图标语义表」，把全站 emoji 分成三档
（结构性 / 行内功能 / 长尾冻结），并写明「新增一个语义确实对不上的图标时，
同一批必须回来更新本表」。问题是——表只是**写了**，没有任何机器在看内容里
到底用了什么，于是下一批写作又会各写各的（本站踩过：📖 / 📚 / 🔗 / 💬 四者
混用）。这个脚本把那张表从「写了」变成「机器对账」。

做两件事：

1. **对账**（第 1–2 项）：扫 `content/` 全部 md，报出
   「内容里有、表里没有」（错误）与「表里有、内容里没有」（表写错 / 内容被删）。
2. **复算**（第 3 项）：按 template.md 写死的口径重算四项数字与框线字符数，
   与 template.md 正文里写的数字比对，不符即报错。
   template.md 自己写着「凡引用这组数字，请用同一口径复算」——那就让机器来算。

   ⚠️ **这四项数字只断言 template.md 一处**。其它页面（roadmap / CHANGELOG）**不要复述
   这组数字**，只指路即可 —— 复述一次就多一处要手工维护的数字。**其它页面的
   「**N 处**」措辞大量用于无关统计（相似度对数、修复处数……），没法通用校验**，
   所以这里刻意只认 template.md 的现状句。

口径（与 template.md 的「> 口径」段落一致）：
- 统计字符块：`1F000–1FAFF` / `2600–27BF` / `2B00–2BFF` / `25A0–25FF` / `2300–23FF`；
- **围栏代码块与行内代码不计**：那里面是 ASCII 流程图和制表符（实测 `─ ├ │ └`
  与 `──►` 箭头都只在代码块里），不是语义图标；
- 变体选择符 `U+FE0F` / `U+FE0E` 不单独算一种 —— `⚠` 与 `⚠️` 是同一个图标。

用法：python scripts/check_icons.py
"""

from __future__ import annotations

import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
TEMPLATE = CONTENT / "template.md"

# 图标语义表所在的小节标题（解析依赖这几行，改 template.md 时同步改这里）
SEC_STRUCT = "### 1. 结构性图标"
SEC_INLINE = "### 2. 行内功能图标"
SEC_LONGTAIL = "### 3. 不新增"

# 统计口径：Unicode 码位块
ICON_BLOCKS = (
    (0x1F000, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x2B00, 0x2BFF),
    (0x25A0, 0x25FF),
    (0x2300, 0x23FF),
)
# 框线 / 制表符：template.md 明确说「属制表符、不算图标」
BOX_CHARS = "─├│└"

FENCE_RE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
TABLE_ICON_ROW_RE = re.compile(r"^\|\s*(\S+)\s*\|")


def is_icon(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in ICON_BLOCKS)


def strip_inline_code(line: str) -> str:
    return INLINE_CODE_RE.sub("", line)


def split_fences(text: str):
    """把文本切成 (正文行, 代码块行)。围栏标记行归代码块。"""
    prose, code = [], []
    in_fence = False
    for line in text.split("\n"):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            code.append(line)
            continue
        (code if in_fence else prose).append(line)
    return prose, code


def parse_table(path: Path):
    """解析「图标语义表」，返回 (结构性, 行内功能, 长尾) 三个字符集合。"""
    prose, _ = split_fences(path.read_text(encoding="utf-8"))
    ico = {"struct": set(), "inline": set(), "longtail": set()}
    sec = None
    for line in prose:
        if line.startswith(SEC_STRUCT):
            sec = "struct"
            continue
        if line.startswith(SEC_INLINE):
            sec = "inline"
            continue
        if line.startswith(SEC_LONGTAIL):
            sec = "longtail"
            continue
        if line.startswith("## "):
            sec = None
            continue
        if sec in ("struct", "inline"):
            m = TABLE_ICON_ROW_RE.match(line)
            if m:
                cell = m.group(1)
                if cell != "图标" and not set(cell) <= set("-: "):
                    ico[sec].update(c for c in cell if is_icon(c))
        elif sec == "longtail":
            # 长尾是一个行内代码段里的空格分隔清单
            for m in INLINE_CODE_RE.finditer(line):
                ico["longtail"].update(c for c in m.group(0) if is_icon(c))
    return ico


def scan_content():
    """扫描 content/ 全部 md。返回 (Counter, 首次出现位置, 文件数, 框线字符数, 代码块内图标数)。"""
    counter: Counter[str] = Counter()
    first_at: dict[str, str] = {}
    box_total = 0
    icons_in_code = 0
    files = 0
    for path in sorted(CONTENT.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(CONTENT).parts):
            continue
        files += 1
        rel = path.relative_to(ROOT).as_posix()
        prose, code = split_fences(path.read_text(encoding="utf-8"))
        for i, line in enumerate(prose, 1):
            for ch in strip_inline_code(line):
                if is_icon(ch):
                    counter[ch] += 1
                    first_at.setdefault(ch, f"{rel}:{i}")
        for line in code:
            box_total += sum(line.count(c) for c in BOX_CHARS)
            icons_in_code += sum(1 for ch in line if is_icon(ch))
    return counter, first_at, files, box_total, icons_in_code


def parse_documented(text: str):
    """从 template.md 正文里抠出被写死的数字。"""
    def grab(pattern: str, name: str):
        m = re.search(pattern, text)
        if not m:
            return None
        return int(m.group(1))

    return {
        "文件数": grab(r"扫描 `content/` 全部 (\d+) 个 md", "文件数"),
        "总处数": grab(r"\*\*(\d+) 处\*\*", "总处数"),
        "总种数": grab(r"\*\*(\d+) 种\*\*", "总种数"),
        "≥3次": grab(r"\*\*(\d+) 种\*\*出现 ≥3 次", "≥3次"),
        "1–2次": grab(r"\*\*(\d+) 种\*\*只出现 1–2 次", "1–2次"),
        "框线处数": grab(r"另有 (\d+) 处框线字符", "框线处数"),
        "长尾标题": grab(r"### 3\. 不新增（长尾 (\d+) 种）", "长尾标题"),
        "长尾正文": grab(r"以下 (\d+) 种各只出现 1–2 次", "长尾正文"),
    }


def name_of(ch: str) -> str:
    try:
        return unicodedata.name(ch)
    except ValueError:
        return "?"


def main() -> int:
    if not TEMPLATE.exists():
        print(f"找不到 {TEMPLATE}")
        return 1

    ico = parse_table(TEMPLATE)
    table_all = ico["struct"] | ico["inline"] | ico["longtail"]
    counter, first_at, files, box_total, icons_in_code = scan_content()
    doc = parse_documented(TEMPLATE.read_text(encoding="utf-8"))

    errors: list[str] = []

    # 1. 内容里有、表里没有
    not_in_table = {ch: n for ch, n in counter.items() if ch not in table_all}
    # 2. 表里有、内容里没有
    unused = table_all - set(counter)

    # 3. 复算数字与 template.md 写死的数字比对
    ge3 = sum(1 for v in counter.values() if v >= 3)
    le2 = sum(1 for v in counter.values() if v <= 2)
    actual = {
        "文件数": files,
        "总处数": sum(counter.values()),
        "总种数": len(counter),
        "≥3次": ge3,
        "1–2次": le2,
        "框线处数": box_total,
        "长尾标题": len(ico["longtail"]),
        "长尾正文": len(ico["longtail"]),
    }
    for key, got in actual.items():
        want = doc.get(key)
        if want is None:
            errors.append(f"template.md 里找不到「{key}」的声明，无法对账（解析式或写法被改了？）")
        elif want != got:
            errors.append(f"「{key}」对不上：template.md 写 {want}，实算 {got}")

    # ── 输出 ────────────────────────────────────────────────────────────────
    print("=" * 68)
    print("图标语义表对账（只读，未改动任何文件）")
    print("=" * 68)
    print(f"表内图标：结构性 {len(ico['struct'])} ｜ 行内功能 {len(ico['inline'])} ｜ 长尾 {len(ico['longtail'])} ｜ 合计 {len(table_all)} 种")
    print(f"内容实测：{files} 个 md ｜ {sum(counter.values())} 处 ｜ {len(counter)} 种"
          f"（≥3 次 {ge3} 种、1–2 次 {le2} 种）")
    print(f"已排除：围栏/行内代码里的图标 {icons_in_code} 处、框线字符 {box_total} 处")
    print("-" * 68)

    if not_in_table:
        print("\n【A】内容里用了、但不在图标语义表里 —— 要么改内容，要么按规则回来更新表")
        for ch, n in sorted(not_in_table.items(), key=lambda x: (-x[1], x[0])):
            print(f"  · {ch}  U+{ord(ch):04X}  {n} 处  首次 {first_at[ch]}  ({name_of(ch)})")
        errors += [
            f"图标 {ch}（U+{ord(ch):04X}，{n} 处，首次 {first_at[ch]}）不在图标语义表内"
            for ch, n in sorted(not_in_table.items(), key=lambda x: (-x[1], x[0]))
        ]
    else:
        print("\n【A】内容里的图标全部在表内 —— 0 个越界")

    if unused:
        print("\n【B】表里有、内容里一次都没出现 —— 表写错了，或内容被删了")
        for ch in sorted(unused):
            print(f"  · {ch}  U+{ord(ch):04X}  ({name_of(ch)})")
        errors += [f"图标语义表里的 {ch}（U+{ord(ch):04X}）在 content/ 里一次都没出现" for ch in sorted(unused)]
    else:
        print("【B】表里的图标都在内容中出现过 —— 0 个悬空")

    print("\n【C】数字对账（口径见 template.md 的「口径」段）")
    for key, got in actual.items():
        want = doc.get(key)
        mark = "OK " if want == got else "✗  "
        print(f"  {mark}{key:<8} 文档 {str(want):>5}  实算 {got:>5}")

    mismatched = [k for k, v in actual.items() if doc.get(k) != v]
    if mismatched:
        # 直接给出可粘贴的订正句，省得去数一遍
        print("\n  以下这句可直接替换 template.md 里的「现状」句：")
        print(
            f"  全站图标现状（{actual['文件数']} 个 md，按 Unicode 码位计，不含围栏/行内代码）："
            f"**{actual['总处数']} 处**、**{actual['总种数']} 种**，其中 **{actual['≥3次']} 种**出现 ≥3 次、"
            f"**{actual['1–2次']} 种**只出现 1–2 次；另有 {actual['框线处数']} 处框线字符"
            f"（`─ ├ │ └`）属制表符、不算图标。"
        )
        errors += [f"数字「{k}」与实际不符（文档 {doc.get(k)} / 实算 {actual[k]}）" for k in mismatched]

    print("\n" + "=" * 68)
    if errors:
        print(f"校验失败，共 {len(errors)} 个问题：")
        for e in errors:
            print(f"  [错误] {e}")
        return 1
    print(
        f"✅ 校验通过：{sum(counter.values())} 处图标、{len(counter)} 种全部在图标语义表内，"
        "表内无悬空项，四项数字与文档一致。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
