"""漂移检测的纯函数（`scripts/check_drift.py`）。

`dig()` / `count_of()` / `baseline_for()` 决定「站内那份数 vs 上游那份数」怎么比。
它们错一位，整道漂移门禁就会在**错误的键**上得出结论 —— 要么永远绿（漏报），
要么永远红（狼来了）。这两类都只需要一个下标就能造成，所以在这里钉住。
"""

from __future__ import annotations

import json

import check_drift


def test_dig_nested_path():
    payload = {"data": {"a": {"b": [1, 2, 3]}}}
    assert check_drift.dig(payload, "a.b") == [1, 2, 3]


def test_dig_empty_path_returns_data_node():
    payload = {"data": {"a": 1}}
    assert check_drift.dig(payload, "") == {"a": 1}


def test_dig_accepts_bare_payload_without_data_key():
    assert check_drift.dig({"a": 1}, "a") == 1


def test_dig_missing_key_and_wrong_shape_are_none():
    payload = {"data": {"a": {"b": 1}}}
    assert check_drift.dig(payload, "a.c") is None
    # 中途撞上非 dict（列表/标量）也必须返回 None，而不是抛 TypeError
    assert check_drift.dig(payload, "a.b.c") is None
    assert check_drift.dig({}, "a") is None


def test_count_of():
    assert check_drift.count_of([1, 2]) == 2
    assert check_drift.count_of({"x": 1}) == 1
    assert check_drift.count_of(None) is None
    assert check_drift.count_of(7) is None


def test_baseline_for_uses_local_cache_dict(tmp_path, monkeypatch):
    cache = tmp_path / "items_full.json"
    cache.write_text(
        json.dumps({"fetched": "2026-10-17", "items": {"a": {}, "b": {}, "c": {}}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_drift, "DATA", tmp_path)
    ep = {"file": "items_full.json", "field": None, "label": "items"}
    count, source = check_drift.baseline_for(ep)
    assert count == 3
    assert "items_full.json" in source and "2026-10-17" in source


def test_baseline_for_uses_local_cache_scalar(tmp_path, monkeypatch):
    cache = tmp_path / "trader_cache.json"
    cache.write_text(json.dumps({"fetched": "2026-10-17", "traders": 16}), encoding="utf-8")
    monkeypatch.setattr(check_drift, "DATA", tmp_path)
    ep = {"file": "trader_cache.json", "field": "traders", "label": "traders"}
    assert check_drift.baseline_for(ep)[0] == 16


def test_baseline_for_falls_back_to_known_baseline(tmp_path, monkeypatch):
    monkeypatch.setattr(check_drift, "DATA", tmp_path)  # 空目录：没有本地缓存
    monkeypatch.setattr(check_drift, "KNOWN_BASELINE", {"tasks": (504, "声明 504 个")})
    ep = {"file": None, "field": None, "label": "tasks"}
    count, source = check_drift.baseline_for(ep)
    assert (count, source) == (504, "声明 504 个")


def test_baseline_for_unknown_label(tmp_path, monkeypatch):
    monkeypatch.setattr(check_drift, "DATA", tmp_path)
    ep = {"file": None, "field": None, "label": "nothing"}
    assert check_drift.baseline_for(ep) == (None, "未记录基线")


def test_broken_cache_is_ignored(tmp_path, monkeypatch):
    (tmp_path / "broken.json").write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(check_drift, "DATA", tmp_path)
    monkeypatch.setattr(check_drift, "KNOWN_BASELINE", {})
    ep = {"file": "broken.json", "field": None, "label": "x"}
    assert check_drift.baseline_for(ep) == (None, "未记录基线")
