"""基线与版本号解析（`scripts/_baseline.py`）。

为什么单独测它：`baseline_ver()` 是**全站口径的唯一来源** —— 557 处「1.2.0.0」
都是拿它比对的（见 `check_promises.py`）。它读的是 `content/docs/citation.md`
的一段中文正则，改一个字就可能静默返回空串，而那时门禁只会报「版本不一致」，
把人引向完全错误的方向。
"""

from __future__ import annotations

import re

import pytest

import _baseline


def test_read_baseline_shape():
    month, ver = _baseline.read_baseline()
    assert re.fullmatch(r"\d{4} 年 \d{1,2} 月", month), month
    assert re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ver), ver


def test_label_starts_with_version():
    label = _baseline.baseline_label()
    ver = _baseline.baseline_ver()
    assert label.startswith(ver)
    # 完整串应当带上赛季名（口语里「1.2.0.0（第一赛季 KORD BREACH）」是一个整体）
    assert "（" in label and label.endswith("）"), label


def test_missing_citation_exits(tmp_path, monkeypatch):
    monkeypatch.setattr(_baseline, "CITATION", tmp_path / "nope.md")
    with pytest.raises(SystemExit):
        _baseline.read_baseline()


def test_citation_without_declaration_exits(tmp_path, monkeypatch):
    f = tmp_path / "citation.md"
    f.write_text("## 一、本站立场\n\n没有基线声明。\n", encoding="utf-8")
    monkeypatch.setattr(_baseline, "CITATION", f)
    with pytest.raises(SystemExit):
        _baseline.baseline_label()


def test_citation_parses_hand_written_values(tmp_path, monkeypatch):
    f = tmp_path / "citation.md"
    f.write_text(
        "## 二、数据口径\n\n"
        "| 项目 | 值 |\n"
        "|------|----|\n"
        "| **全站基线版本** | **9.9.9.9（测试赛季 TEST）** |\n"
        "| **基线快照时间** | **2031 年 7 月** |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(_baseline, "CITATION", f)
    assert _baseline.read_baseline() == ("2031 年 7 月", "9.9.9.9")
    assert _baseline.baseline_label() == "9.9.9.9（测试赛季 TEST）"
