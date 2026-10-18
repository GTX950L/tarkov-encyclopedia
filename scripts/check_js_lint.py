#!/usr/bin/env python3
"""前端脚本结构校验：重复定义 / 死代码 / 全局污染（只读，不改文件）。

为什么需要它（两个真实事故）：

1. **2026-10-18**：`ops-board.js` 里 `bindMapToRight()` 被**逐字复制了两份**，
   初始化时还调了两次 —— 靠 `if (window.__tkOpsMapSync) return;` 才没出事。
   同一天修的另一个 bug（v1.134.6「作战台搜索框只能输入一个字符」）正是
   「`paint()` 全量重建把正在输入的 input 换掉了」这类**重复状态 / 重复渲染**
   的典型症状。这类问题七道门禁**一道都抓不到**：构建不报错、页面能打开、
   只有真人按到那个框才会发现。

2. `ops-board.js` 里 `buildRight()` 39 行**没有任何调用点** —— 它早被
   `renderRightBody()` 取代，但代码留在那里，读代码的人会以为「右栏是它画的」，
   改错地方的风险实打实存在。

做三件事（都是机器能判的，不做风格警察）：

1. **同文件重复定义**（错误）：同一文件里 `function NAME(` 出现两次及以上。
   —— 后一份会静默覆盖前一份，是本次审查抓到的那类 bug 的温床。
2. **未被引用的函数**（错误，可用白名单放行）：文件里声明了，但名字在整份
   文件里**只出现在声明处** —— 死代码。动态调用（`window[name]()`、
   事件表里的字符串名）必须写进 `scripts/js_lint_allow.txt` 并写明理由。
3. **全局污染**（错误）：文件没有 IIFE 包裹（末尾不是 `})();` / `})()`），
   却声明了顶层 function —— 那些名字会挂到 `window` 上，和别的脚本撞车。

⚠️ 只扫**手写**脚本。`gen_*.py` 的产物（`items_index.js`、`maps-data-*.js`、
`ops-index-*.js`、`progress-manifest.js`…）是数据不是代码，跳过 —— 它们由
`check_gen_drift.py` 管，不归这里管。

⚠️ 只看 **IIFE 顶层**（缩进 ≤ 2）的函数。嵌套函数（缩进 4+）是闭包内部实现：
`progress-boards.js` 里不同卡片的构造函数各有一个 `sync()` / `u8()`，那是正常
写法，不是重复定义 —— 本脚本第一版把它们全报了 9 个「错误」，属于假阳性。

用法：python scripts/check_js_lint.py
退出码：0 = 通过，1 = 有问题。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from _console import setup as _setup_console

ROOT = Path(__file__).resolve().parent.parent
JS_DIR = ROOT / "content" / "javascripts"
ALLOW = ROOT / "scripts" / "js_lint_allow.txt"

# 生成物 / 数据文件：不是手写代码，跳过（避免把 5000 条数据当代码扫）
SKIP_PREFIXES = (
    "items_index",
    "catalog-data",
    "maps-data-",
    "ops-index-",
    "terms-data",
    "progress-manifest",
    "quest-needs-data",
    "quests-index-data",
    "glossary-term",
)

# 只看 IIFE 顶层（缩进 ≤ 2）。嵌套函数（缩进 4+）属于闭包内部实现：
# 不同卡片里各有一个 `sync()` / `u8()` 是**正常写法**，不该报重复。
TOP_LEVEL_INDENT = 2

FUNC_RE = re.compile(
    r"^(?P<indent>[ \t]{0,8})(?:async[ \t]+)?function[ \t]+(?P<name>[A-Za-z_$][\w$]*)[ \t]*\(",
    re.MULTILINE,
)

# IIFE 收尾：`})();` / `})()` / `})();` 带行尾注释
IIFE_TAIL_RE = re.compile(r"\}\s*\)\s*\(\s*\)\s*;?\s*$")

MAX_SCRIPT_BYTES = 400_000  # 数据文件漏网时的兜底


def load_allow(path: Path = ALLOW) -> dict[str, str]:
    """白名单：`文件名:函数名  # 理由`，或 `函数名  # 理由`（对所有文件生效）。"""
    allow: dict[str, str] = {}
    if not path.exists():
        return allow
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, _, reason = line.partition("#")
        key = key.strip()
        reason = reason.strip()
        if not reason:
            raise SystemExit(
                f"[错误] 白名单缺理由: {raw!r}（每一条都必须写清为什么删不掉）"
            )
        allow[key] = reason
    return allow


def allowed(allow: dict[str, str], fname: str, func: str) -> str | None:
    return allow.get(f"{fname}:{func}") or allow.get(func)


def top_level_decls(text: str) -> tuple[dict[str, list[int]], int]:
    """IIFE 顶层的 `function NAME(` → 行号列表；第二个返回值是跳过的嵌套函数个数。"""
    decls: dict[str, list[int]] = {}
    nested = 0
    for m in FUNC_RE.finditer(text):
        if len(m.group("indent").expandtabs(4)) > TOP_LEVEL_INDENT:
            nested += 1
            continue
        line_no = text[: m.start()].count("\n") + 1
        decls.setdefault(m.group("name"), []).append(line_no)
    return decls, nested


def lint_source(
    fname: str, text: str, allow: dict[str, str]
) -> tuple[list[str], list[str], int]:
    """返回 (errors, warnings, 顶层函数数)。纯函数 —— 测试直接喂字符串。"""
    errors: list[str] = []
    warnings: list[str] = []
    decls, _nested = top_level_decls(text)

    for name, lines in decls.items():
        if len(lines) > 1:
            where = "、".join(f":{n}" for n in lines)
            errors.append(
                f"{fname} 重复定义 function {name}()（行 {where}）"
                "—— 后一份会静默覆盖前一份，删掉多余的"
            )

    for name, lines in decls.items():
        hits = len(re.findall(rf"(?<![\w$]){re.escape(name)}(?![\w$])", text))
        if hits <= len(lines):
            reason = allowed(allow, fname, name)
            if reason is None:
                errors.append(
                    f"{fname}:{lines[0]} function {name}() 没有任何调用点（死代码）"
                    "—— 删掉；若是动态调用，写进 scripts/js_lint_allow.txt 并注明理由"
                )
            else:
                warnings.append(
                    f"{fname}:{lines[0]} {name}() 未引用（白名单：{reason}）"
                )

    if not IIFE_TAIL_RE.search(text.rstrip()):
        for name, lines in decls.items():
            errors.append(
                f"{fname}:{lines[0]} function {name}() 暴露在全局作用域"
                "—— 整个文件该用 (function () { ... })(); 包起来"
            )

    return errors, warnings, sum(len(v) for v in decls.values())


def main() -> int:
    allow = load_allow()
    errors: list[str] = []
    warnings: list[str] = []
    n_funcs = 0
    n_nested = 0
    n_files = 0

    if not JS_DIR.is_dir():
        print(f"[错误] 找不到 {JS_DIR.relative_to(ROOT)}")
        return 1

    for js in sorted(JS_DIR.glob("*.js")):
        if js.name.startswith(SKIP_PREFIXES):
            continue
        text = js.read_text(encoding="utf-8")
        if len(text) > MAX_SCRIPT_BYTES:
            warnings.append(
                f"{js.name} 体积 {len(text) // 1024} KB，按数据文件跳过"
            )
            continue
        n_files += 1
        e, w, nf = lint_source(js.name, text, allow)
        errors += e
        warnings += w
        n_funcs += nf
        n_nested += top_level_decls(text)[1]

    print("=" * 60)
    print(f"手写脚本: {n_files} 个")
    print(f"函数声明: {n_funcs} 处（IIFE 顶层；另有 {n_nested} 处嵌套，不参与重复判定）")
    print("=" * 60)

    if warnings:
        for w in warnings:
            print(f"  [警告] {w}")
    if errors:
        print(f"校验失败，共 {len(errors)} 个问题:")
        for e in errors:
            print(f"  [错误] {e}")
        return 1
    print("✅ 通过：无重复定义、无死代码、无全局泄漏。")
    return 0


if __name__ == "__main__":
    _setup_console()
    sys.exit(main())
