"""`check_js_lint.py` 的判定逻辑（喂字符串，不碰真文件）。

新门禁最怕的不是漏报，而是**第一次上线就红一片假阳性** —— 那种门禁会在第二天
被注释掉。本文件的三个用例正是开发时踩到的三种情形：

* `progress-boards.js` 里不同闭包各有一个 `sync()`：**不算**重复；
* `ops-board.js` 里同一个 IIFE 顶层复制了两份 `bindMapToRight()`：**算**重复；
* `buildRight()` 39 行没有调用点：**算**死代码。
"""

from __future__ import annotations

from check_js_lint import lint_source, top_level_decls

EMPTY_ALLOW: dict[str, str] = {}

GOOD = """(function () {
  "use strict";

  function used() { return 1; }
  function helper() { return used() + 1; }

  helper();
})();
"""

DUP_TOP_LEVEL = """(function () {
  function sync() { return 1; }
  function sync() { return 2; }
  sync();
})();
"""

NESTED_SAME_NAME = """(function () {
  function card() {
    function sync() { return 1; }
    return sync;
  }
  function card2() {
    function sync() { return 2; }
    return sync;
  }
  card(); card2();
})();
"""

DEAD_CODE = """(function () {
  function buildRight() { return "unused"; }
  function used() { return 1; }
  used();
})();
"""

NO_IIFE = """function leaked() { return 1; }
leaked();
"""


def test_good_file_has_no_findings():
    errors, warnings, n = lint_source("good.js", GOOD, EMPTY_ALLOW)
    assert (errors, warnings) == ([], [])
    assert n == 2


def test_top_level_duplicate_is_error():
    errors, _warnings, _n = lint_source("dup.js", DUP_TOP_LEVEL, EMPTY_ALLOW)
    assert len(errors) == 1
    assert "重复定义 function sync()" in errors[0]


def test_nested_same_name_is_allowed():
    """闭包里各有一个同名函数是正常写法（第一版门禁在这里误报 9 个错）。"""
    errors, _warnings, n = lint_source("nested.js", NESTED_SAME_NAME, EMPTY_ALLOW)
    assert errors == []
    assert n == 2  # 只数顶层 card / card2
    decls, nested = top_level_decls(NESTED_SAME_NAME)
    assert set(decls) == {"card", "card2"}
    assert nested == 2


def test_dead_code_is_error_and_allowlist_silences_it():
    errors, _w, _n = lint_source("dead.js", DEAD_CODE, EMPTY_ALLOW)
    assert len(errors) == 1
    assert "buildRight() 没有任何调用点" in errors[0]

    allow = {"dead.js:buildRight": "由 window[name] 动态调用"}
    errors2, warnings2, _n = lint_source("dead.js", DEAD_CODE, allow)
    assert errors2 == []
    assert any("白名单" in w for w in warnings2)


def test_global_leak_detected():
    errors, _w, _n = lint_source("bare.js", NO_IIFE, EMPTY_ALLOW)
    assert any("暴露在全局作用域" in e for e in errors)
