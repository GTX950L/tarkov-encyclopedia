"""弹药数值表（`content/entries/ammo-table.md`）的**内容级**不变量。

这张表是生成物（`gen_ammo_values.py` 写 AUTO-GEN 区段），但它同时也是**唯一**
把 200 发弹 ×7 个数值印给人看的地方。`check_gen_drift.py` 只保证「产物和生成器
一致」，不保证「产物和判据一致」—— 生成器本身算错，漂移检查照样绿。

所以这里不联网、不看生成器，直接读**页面成品**验三条：

1. 行数 = 200（口径写死在上游抓取日；行数变了要有人知道）；
2. 每一格的 稳/效/— 都符合 `P ≥ C×10+15 / C×10≤P<C×10+15 / P<C×10`；
3. 「保证穿透」列 = `sure_max(P)`；同一口径内按穿深降序。

（数值本身与上游 API 的一致性由审查期的逐条对账覆盖，不在单测里重复下载 17 MB。）
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from gen_ammo_values import cell_for, sure_max

TABLE = Path(__file__).resolve().parent.parent / "content" / "entries" / "ammo-table.md"
HEADER = "| 口径 | 弹药 | 伤害 | 穿深 |"
EXPECTED_ROWS = 200
N_COLS = 15


def rows() -> list[list[str]]:
    lines = TABLE.read_text(encoding="utf-8").split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith(HEADER))
    out: list[list[str]] = []
    for line in lines[start + 2:]:
        if not line.startswith("|"):
            break
        out.append([c.strip() for c in line.strip("|").split("|")])
    return out


def pen_of(row: list[str]) -> int | None:
    raw = row[3]
    return None if raw in ("—", "") else int(raw)


def test_table_row_count():
    assert len(rows()) == EXPECTED_ROWS


def test_every_row_has_expected_columns():
    bad = [(r[1], len(r)) for r in rows() if len(r) != N_COLS]
    assert not bad, f"列数不是 {N_COLS}: {bad[:5]}"


def test_armor_cells_follow_penetration_rule():
    wrong = []
    for row in rows():
        pen = pen_of(row)
        for idx, cls in enumerate(range(1, 7)):
            got, want = row[4 + idx], cell_for(pen, cls)
            if got != want:
                wrong.append(f"{row[1]} @{cls} 级：表里写 {got}，判据算 {want}（穿深 {pen}）")
    assert not wrong, "\n".join(wrong[:10])


def test_sure_penetration_column():
    wrong = [
        f"{row[1]}：写 {row[10]}，sure_max({pen_of(row)}) = {sure_max(pen_of(row))}"
        for row in rows()
        if row[10] != sure_max(pen_of(row))
    ]
    assert not wrong, "\n".join(wrong[:10])


def test_sorted_by_penetration_within_caliber():
    """同一口径内按穿深降序；口径之间不比较（表是分组排的）。"""
    violations = []
    prev_caliber, prev_pen = None, 10**9
    for row in rows():
        caliber, pen = row[0], pen_of(row)
        if caliber != prev_caliber:
            prev_caliber, prev_pen = caliber, 10**9
        effective = pen if pen is not None else -1
        if effective > prev_pen:
            violations.append(f"{caliber}/{row[1]}：穿深 {effective} 排在 {prev_pen} 之后")
            break
        prev_pen = effective
    assert not violations, violations


def test_auto_gen_markers_present():
    text = TABLE.read_text(encoding="utf-8")
    assert text.count("<!-- AUTO-GEN:AMMO-VALUES:START -->") == 1
    assert text.count("<!-- AUTO-GEN:AMMO-VALUES:END -->") == 1
    start = text.index("<!-- AUTO-GEN:AMMO-VALUES:START -->")
    end = text.index("<!-- AUTO-GEN:AMMO-VALUES:END -->")
    assert start < end
