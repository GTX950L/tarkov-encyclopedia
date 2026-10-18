"""穿深判定规则（`scripts/gen_ammo_values.py` 的 `cell_for` / `sure_max`）。

这三段（稳 / 效 / —）是全站唯一一处「拿官方判据算出来的结论」，被 200 行 ×6 列
直接印在页面上。边界差 1 就会让整列表格在「刚好卡线」的弹上给出相反答案，
而那种错误肉眼极难发现 —— 所以用**独立复算**钉住：

    cell = 稳  ⇔ P ≥ C×10 + 15
    cell = 效  ⇔ C×10 ≤ P < C×10 + 15
    cell = —   ⇔ P < C×10
"""

from __future__ import annotations

import pytest

from gen_ammo_values import cell_for, sure_max


def expected_cell(pen: int, cls: int) -> str:
    """独立实现（不 import 被测函数），防止「实现和测试一起错」。"""
    if pen is None:
        return "—"
    if pen >= cls * 10 + 15:
        return "稳"
    if pen >= cls * 10:
        return "效"
    return "—"


@pytest.mark.parametrize("pen", list(range(0, 121)))
@pytest.mark.parametrize("cls", [1, 2, 3, 4, 5, 6])
def test_cell_for_matches_rule_everywhere(pen: int, cls: int):
    assert cell_for(pen, cls) == expected_cell(pen, cls)


@pytest.mark.parametrize("cls", [1, 2, 3, 4, 5, 6])
def test_cell_for_none(cls: int):
    assert cell_for(None, cls) == "—"


def test_cell_for_boundaries():
    # 1 级甲：10 起「效」、25 起「稳」
    assert (cell_for(9, 1), cell_for(10, 1), cell_for(24, 1), cell_for(25, 1)) == (
        "—", "效", "效", "稳",
    )
    # 6 级甲：60 起「效」、75 起「稳」
    assert (cell_for(59, 6), cell_for(60, 6), cell_for(74, 6), cell_for(75, 6)) == (
        "—", "效", "效", "稳",
    )


def test_sure_max_is_highest_class_with_margin():
    assert sure_max(115) == "6 级"   # M903：官方判据下 6 级也保证
    assert sure_max(75) == "6 级"    # 6 级甲的门槛 = 60 + 15
    assert sure_max(74) == "5 级"    # 差 1 点就掉一档 —— 边界要钉住
    assert sure_max(65) == "5 级"    # 5 级甲门槛 = 50 + 15，够不到 6 级的 75
    assert sure_max(64) == "4 级"    # 55 ≤ 64 < 65
    assert sure_max(55) == "4 级"
    assert sure_max(54) == "3 级"    # 45 ≤ 54 < 55
    assert sure_max(24) == "—"       # 连 1 级甲的 +15 都够不到
    assert sure_max(25) == "1 级"
    assert sure_max(None) == "—"


@pytest.mark.parametrize("pen", list(range(0, 121)))
def test_sure_max_agrees_with_cell_for(pen: int):
    """sure_max 必须等于「cell_for 为稳的最高甲级」—— 两个函数不能各算各的。"""
    sure = [c for c in range(1, 7) if cell_for(pen, c) == "稳"]
    expected = f"{max(sure)} 级" if sure else "—"
    assert sure_max(pen) == expected
