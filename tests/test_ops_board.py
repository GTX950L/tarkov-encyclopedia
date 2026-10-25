"""作战台的判据回归：搜索匹配目标文本、本图优先、状态入口不再断线。

**为什么新增**（2026-10-25）：上一轮审查查出四件「构建、lint、断链检查全绿，
只有真人点一次才会发现」的事：

* 搜索框写着「搜任务 / 地名 / 物品」，实际匹配的是 `t.oids`（24 位目标 id），
  搜「电线」一条不出（`otxt` 里实有 2 票）；
* 「钉住」「已忽略」两档筛选，`progress.js` 里 togglePin / toggleIgnore
  有实现但**全站零调用**，那两档永远返回空；
* 出击清单只在内存里，刷新即丢；
* 标一票 / 勾一个目标就 `paint()` 全量重绘，左栏滚动与详情卡位置一起冲掉。

前两条用本文件的判据钉住（字段名、调用点），后两条靠 `paint()` 的
scrollTop 存取与 `S.rowQid` 保证 —— 那两条是 DOM 行为，由探针覆盖可测的部分。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
OPS = ROOT / "content" / "javascripts" / "ops-board.js"
PROBE = ROOT / "tests" / "ops_board_probe.js"


def _body(src: str, fname: str) -> str:
    """截出某个 IIFE 顶层函数的函数体（到缩进 2 的闭合花括号）。"""
    head = f"function {fname}("
    assert head in src, f"找不到 {fname}()"
    tail = src.split(head, 1)[1]
    return tail.split("\n  }", 1)[0]


def test_search_matches_objective_text_not_ids() -> None:
    """hay 必须含 `otxt`（目标文本），不能是 `oids`（24 位 id）。"""
    src = OPS.read_text(encoding="utf-8")
    body = _body(src, "visibleTasks")
    assert "t.otxt" in body, "搜索没有匹配目标文本 —— 「搜物品」会搜不到"
    assert "t.oids" not in body, "搜索又回退到匹配目标 id（24 位十六进制）了"


def test_pin_and_ignore_have_write_entries() -> None:
    """钉住 / 忽略必须有写入入口，否则筛选里那两档永远是空的。"""
    src = OPS.read_text(encoding="utf-8")
    assert "P.togglePin" in src, "作战台里没有调用 togglePin —— 「钉住」筛选会永远为空"
    assert "P.toggleIgnore" in src, "作战台里没有调用 toggleIgnore —— 「已忽略」筛选会永远为空"


def test_plan_is_persisted() -> None:
    """出击清单要落盘（按模式），不能只活在内存里。"""
    src = OPS.read_text(encoding="utf-8")
    assert 'var PLAN_KEY = "tk.ops.plan"' in src
    assert "savePlan()" in src and "loadPlan(" in src
    # 增删清单的每条路径都必须 savePlan，不能有一条忘了存
    assert len(re.findall(r"savePlan\(\);", src)) >= 3


def test_paint_preserves_left_scroll() -> None:
    """整块重绘要保住左栏滚动位置（否则「一点就跳回顶上」）。"""
    src = OPS.read_text(encoding="utf-8")
    body = _body(src, "paint")
    assert "left.scrollTop" in body
    assert body.count("left.scrollTop") >= 2, "只存不还（或只还不存）"


def test_keyboard_row_tracks_task_id() -> None:
    """键盘行用任务 id，不用数组下标 —— 否则标完一票按 ↓ 会落到别人身上。"""
    src = OPS.read_text(encoding="utf-8")
    assert "S.row " not in src, "还在用 S.row（数组下标）"
    assert "S.rowQid" in src


@pytest.fixture(scope="module")
def probe() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("本机没有 node —— 跳过端到端探针（CI 里有）")
    proc = subprocess.run(
        [node, str(PROBE)],
        cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=120,
    )
    assert proc.returncode == 0, (proc.stderr or "")[-2000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_probe_search_hits_objective_text(probe: dict) -> None:
    assert probe["searchTargetText"] == ["电工"]


def test_probe_search_has_no_false_positive(probe: dict) -> None:
    assert probe["searchNoFalseHit"] == 0


def test_probe_map_tasks_come_first(probe: dict) -> None:
    assert probe["searchMapFirst"][0] == "本图乙"


def test_probe_no_query_stays_in_map(probe: dict) -> None:
    assert probe["noQueryStaysInMap"] == ["本图乙"]


def test_probe_row_hint_explains_hit(probe: dict) -> None:
    assert "目标里有：" in probe["rowBitsHint"]
