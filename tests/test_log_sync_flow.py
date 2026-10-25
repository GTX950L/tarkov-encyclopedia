"""log-sync.js（从游戏日志同步）的两道断言：静态引用闭合 + 端到端落账本。

**为什么新增这个文件**（2026-10-25）：v1.135.0 的「清死函数」批次把
`loadRaids()` 连定义一起删了，但 `run()` 里两处调用还在。结果是**每次同步
都在读文件之前抛 ReferenceError** —— 页面停在「正在整理文件清单…」，
一条也不写。从 2026-10-18 到 10-25，整整七版没人发现，因为：

* `check_js_lint.py` 只查「定义了没人调用」（死代码），不查反向；
* 现有单测只喂纯函数（`_scanText` / `_collectRaids`），它们本身是好的；
* 构建、链接检查、体积预算全绿 —— 崩在浏览器运行时。

所以补两条：① 静态断言「被调用的私有函数都有定义」；② 真的跑一次 `run()`，
喂内存里的 File 对象，看事件落进哪个账本。第 ② 条顺带钉住第二个坑：
PVE 会话判不出模式时**不能静默写进 PVP**（原来那条路径让 PVE 读者
同步完在 PVE 账本里一条看不到）。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LOG_SYNC = ROOT / "content" / "javascripts" / "log-sync.js"
PROBE = ROOT / "tests" / "log_sync_probe.js"

# 浏览器 / 语言内建：允许出现在调用位置而没有本地定义
BUILTINS = {
    "Date", "FileReader", "Promise", "String", "Number", "Boolean", "Object",
    "Array", "JSON", "Math", "RegExp", "Error", "Map", "Set", "URL", "Blob",
    "File", "Uint8Array", "CustomEvent", "Event", "MutationObserver",
    "parseInt", "parseFloat", "isNaN", "isFinite",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "atob", "btoa", "escape", "unescape",
    "encodeURIComponent", "decodeURIComponent",
}

KEYWORDS = {
    "if", "for", "while", "switch", "catch", "function", "return", "typeof",
    "new", "do", "else", "try", "delete", "void", "in", "of", "instanceof",
    "throw", "case",
}

FUNC_RE = re.compile(r"function\s+([A-Za-z_$][\w$]*)\s*\(")
VAR_RE = re.compile(r"(?:var|let|const)\s+([A-Za-z_$][\w$]*)")
ASSIGN_RE = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?!=)")
CALL_RE = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(")
PARAMS_RE = re.compile(r"function\s*(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)")


def _undefined_calls(text: str) -> list[str]:
    """被调用、但本文件既没声明也没赋值也没当参数接过的名字。纯函数。"""
    declared = set(FUNC_RE.findall(text))
    bound = set(VAR_RE.findall(text)) | set(ASSIGN_RE.findall(text))
    params: set[str] = set()
    for m in PARAMS_RE.finditer(text):
        for p in m.group(1).split(","):
            p = p.strip().split("=")[0].strip()
            if p:
                params.add(p)
    calls = set(CALL_RE.findall(text))
    return sorted(calls - declared - bound - params - BUILTINS - KEYWORDS)


def test_log_sync_has_no_undefined_calls() -> None:
    """抓到 2026-10-18 那类事故：调用了，但定义被删了。"""
    text = LOG_SYNC.read_text(encoding="utf-8")
    missing = _undefined_calls(text)
    assert not missing, (
        "log-sync.js 里这些函数被调用但没有定义 —— 同步会在运行时抛 "
        f"ReferenceError：{missing}"
    )


def test_detector_would_catch_the_original_bug() -> None:
    """反向自检：把 `loadRaids` 的定义拿掉，检测器必须报它。

    没有这条，`_undefined_calls` 哪天退化成永远返回 [] 也没人知道。
    """
    text = LOG_SYNC.read_text(encoding="utf-8")
    broken = re.sub(
        r"function loadRaids\(\)\s*\{.*?\n  \}\n", "", text, count=1, flags=re.S
    )
    assert broken != text, "没匹配到 loadRaids 的定义，正则需要更新"
    assert "loadRaids" in _undefined_calls(broken)


def test_load_raids_defined() -> None:
    """直白的回归守卫 —— 失败信息比上面那条更好读。"""
    assert "function loadRaids(" in LOG_SYNC.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def probe_result() -> dict[str, str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("本机没有 node —— 跳过端到端探针（CI 里有）")
    proc = subprocess.run(
        [node, str(PROBE)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    assert proc.returncode == 0, (
        "log_sync_probe.js 崩了（这正是 loadRaids 事故的形态）：\n"
        + (proc.stderr or "")[-2000:]
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_full_session_lands_in_pve(probe_result: dict[str, str]) -> None:
    assert probe_result["full"] == "pve"


def test_notif_only_falls_back_to_page_mode(probe_result: dict[str, str]) -> None:
    """只选通知文件时没有 Session mode 行 —— 落点该是当前页面模式，不是 PVP。"""
    assert probe_result["notifOnly"] == "pve"


def test_rotated_application_falls_back_to_page_mode(probe_result: dict[str, str]) -> None:
    """application 轮转到 _001、开头没有 Session mode 行 —— 同上。"""
    assert probe_result["rotated"] == "pve"
