#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「赛季特质模拟器」的数据文件（season-planner-data.js）。

数据源：content/entries/season-modifiers.md
  · §2「个人修改器」的两张表：正面卡 19 项、负面卡 15 项
  · §4「互斥」的三行分类表：展开「平均主义者 ⇄ A / B / C」这类简写后共 17 组

输出：content/javascripts/season-planner-data.js

对账（任一不符 → 退出码 1）：
  1. 正面 19 / 负面 15 / 合计 34
  2. 点数合计：正面 74 / 负面 54（与官方英文 Wiki 逐项核对过的数字）
  3. 互斥展开后 17 组
  4. 互斥里出现的每个卡名都能在 34 项里找到（防改动卡名后互斥表漏改）

重跑时机：改动 season-modifiers.md 的卡表或互斥表之后。
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "entries" / "season-modifiers.md"
OUT = ROOT / "content" / "javascripts" / "season-planner-data.js"

EXPECT_POS = 19
EXPECT_NEG = 15
EXPECT_EXCL = 17
EXPECT_COST = 74     # 正面卡点数合计（全选消耗 74）
EXPECT_GAIN = 54     # 负面卡点数合计（全选获得 54）

HDR_POS = "**正面卡（19 项，消耗点数）**"
HDR_NEG = "**负面卡（15 项，提供点数）**"
HDR_EXCL = "| **正负对冲**"


def strip_md(s: str) -> str:
    return s.replace("**", "").strip()


def is_sep_row(cells):
    """分隔行判定：先切单元格，再逐个判 —— 整行判会被内部残留的竖线骗过。"""
    return all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c)


def parse_cards(text: str, header: str):
    start = text.find(header)
    if start < 0:
        sys.exit(f"✗ 找不到表头：{header}")
    cards = []
    seen_table = False
    for line in text[start:].split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            if seen_table:
                break          # 表格结束
            continue           # 表头与表格之间的空行
        cells = [c.strip() for c in line.strip("|").split("|")]
        if is_sep_row(cells) or "修改器" in cells[0]:
            seen_table = True
            continue
        if len(cells) < 3:
            continue
        m = re.search(r"([−+])\s*(\d+)", cells[1])
        if not m:
            continue
        cards.append({
            "n": strip_md(cells[0]),
            "p": int(m.group(2)),
            "d": strip_md(cells[2]),
        })
        seen_table = True
    return cards


def parse_exclusive(text: str):
    start = text.find(HDR_EXCL)
    if start < 0:
        sys.exit(f"✗ 找不到互斥表：{HDR_EXCL}")
    groups = []
    for line in text[start:].split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        for pair in cells[1].split("｜"):          # 单元格内用全角竖线分组
            parts = pair.split("⇄")
            if len(parts) != 2:
                continue
            left = strip_md(parts[0])
            for right in parts[1].split("/"):      # 「A ⇄ B / C / D」展开
                right = strip_md(right)
                if left and right:
                    groups.append([left, right])
    return groups


def main():
    text = SRC.read_text(encoding="utf-8")
    pos = parse_cards(text, HDR_POS)
    neg = parse_cards(text, HDR_NEG)
    excl = parse_exclusive(text)

    errs = []
    if len(pos) != EXPECT_POS:
        errs.append(f"正面卡 {len(pos)} 项（应 {EXPECT_POS}）")
    if len(neg) != EXPECT_NEG:
        errs.append(f"负面卡 {len(neg)} 项（应 {EXPECT_NEG}）")
    if sum(c["p"] for c in pos) != EXPECT_COST:
        errs.append(f"正面点数合计 {sum(c['p'] for c in pos)}（应 {EXPECT_COST}）")
    if sum(c["p"] for c in neg) != EXPECT_GAIN:
        errs.append(f"负面点数合计 {sum(c['p'] for c in neg)}（应 {EXPECT_GAIN}）")
    if len(excl) != EXPECT_EXCL:
        errs.append(f"互斥 {len(excl)} 组（应 {EXPECT_EXCL}）")

    known = {c["n"] for c in pos} | {c["n"] for c in neg}
    for a, b in excl:
        for name in (a, b):
            if name not in known:
                errs.append(f"互斥表里的卡名「{name}」不在 34 项卡表里（改名后漏同步？）")

    if errs:
        print("✗ 对账失败：", file=sys.stderr)
        for e in errs:
            print("   ·", e, file=sys.stderr)
        sys.exit(1)

    payload = {
        "generated": date.today().isoformat(),
        "source": "content/entries/season-modifiers.md",
        "positive": pos,
        "negative": neg,
        "exclusive": excl,
        "summary": {
            "positive": len(pos),
            "negative": len(neg),
            "cost": sum(c["p"] for c in pos),
            "gain": sum(c["p"] for c in neg),
            "exclusive": len(excl),
        },
    }

    js = (
        "/* 由 scripts/gen_season_planner.py 生成，请勿手工编辑。\n"
        "   数据源：content/entries/season-modifiers.md（个人修改器两张表 + 互斥表）。\n"
        "   用途：赛季特质模拟器（javascripts/season-planner.js）的只读数据。\n"
        "   重跑时机：改动 season-modifiers.md 的卡表或互斥表之后。 */\n"
        "window.TARKOV_SEASON_PLANNER = "
        + json.dumps(payload, ensure_ascii=False, indent=1)
        + ";\n"
    )
    OUT.write_text(js, encoding="utf-8")

    print(f"✓ 已生成 {OUT.relative_to(ROOT)}")
    print(f"  正面 {len(pos)} 项 / 消耗 {payload['summary']['cost']} ｜ "
          f"负面 {len(neg)} 项 / 获得 {payload['summary']['gain']} ｜ 互斥 {len(excl)} 组")


if __name__ == "__main__":
    main()
