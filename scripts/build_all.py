#!/usr/bin/env python3
"""一键跑完「本地验收」的完整链路 —— 生成数据 → 五道校验 → 真实构建。

为什么需要它
------------
站点的验收流程散在五条命令里，且**有先后依赖**：

    python scripts/build_glossary.py     # ① 生成术语数据（extra_javascript 依赖它）
    python scripts/check_entries.py      # ② 硬错误：断链 / 计数 / 骨架 / 引号 / 表格吞块
    python scripts/check_icons.py        # ③ 图标语义表对账
    python scripts/check_promises.py     # ④ 《引用说明》第三节的承诺是否落实
    python scripts/skills_consistency.py # ⑤ 手册里的路径与门禁声明是否属实
    zensical build                       # ⑥ 真实构建

手动敲的问题不是麻烦，而是**漏跑**：只跑 ② 就提交，③④⑤ 的漂移会一路
带到线上；或者跑完 ②③④⑤ 忘了 ⑥，nav 缩进写坏、锚点被删这类「只有构建
才会报」的错就会漏过去（`check_*` 一律查不出）。

判据（站规）：**「检查器失效时，世界是静默的」** —— 所以这里把链路固化，
并要求 ①②③④⑤ 全部退出码 0 之后才允许 ⑥。

用法
----
    python scripts/build_all.py            # 全流程
    python scripts/build_all.py --no-build # 只跑校验，不构建（快速迭代时用）
    python scripts/build_all.py --serve    # 构建后起本地预览（127.0.0.1:8000）

退出码：任一步失败 → 1（并打印是哪一步、原始输出原文）。
只读内容，只写 site/ 与 content/javascripts/terms-data.js（都在 .gitignore 里）。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (显示名, 命令, 是否允许跳过)
PY = sys.executable


def run(label: str, cmd: list[str], cwd: Path = ROOT) -> tuple[bool, str, float]:
    """跑一条命令，返回 (是否成功, 输出, 耗时秒)。"""
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        return False, f"命令不存在：{exc}", time.time() - t0

    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, out, time.time() - t0


def tail(text: str, n: int = 14) -> str:
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    if len(lines) <= n:
        return "\n".join(lines)
    return "\n".join(["  …（略）"] + lines[-n:])


STEPS: list[tuple[str, list[str], str]] = [
    ("① 生成术语数据", [PY, "scripts/build_glossary.py"], "terms-data.js 未生成时，正文术语提示会静默消失"),
    ("② 内容一致性", [PY, "scripts/check_entries.py"], "断链 / 计数漂移 / 骨架缺失 / 直引号 / 表格吞块"),
    ("③ 图标语义表", [PY, "scripts/check_icons.py"], "表外 emoji 与 template.md 的统计数字"),
    ("④ 引用承诺", [PY, "scripts/check_promises.py"], "《引用说明》第三节的每条承诺"),
    ("⑤ 手册一致性", [PY, "scripts/skills_consistency.py"], ".agent/skills/ 的路径与门禁声明"),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="一键本地验收：校验 + 构建")
    ap.add_argument("--no-build", action="store_true", help="只跑校验，不构建")
    ap.add_argument("--serve", action="store_true", help="构建后起本地预览服务")
    ap.add_argument("-q", "--quiet", action="store_true", help="只打印摘要，不打印各步输出")
    args = ap.parse_args()

    print("=" * 66)
    print("逃离塔科夫百科全书 · 本地验收")
    print(f"仓库：{ROOT}")
    print("=" * 66)

    total = time.time()
    for label, cmd, why in STEPS:
        print(f"\n▶ {label}  （{why}）")
        ok, out, dt = run(label, cmd)
        if ok:
            print(f"  ✓ 通过  {dt:.1f}s")
            if not args.quiet:
                print("  " + tail(out).replace("\n", "\n  "))
        else:
            print(f"  ✗ 失败  {dt:.1f}s  ← 停在这里")
            print("\n  ── 原始输出（末尾） ──")
            print("  " + tail(out, 30).replace("\n", "\n  "))
            print(
                "\n  下一步：按上面的报错修完再跑一次。"
                "\n  ⚠️ 不要用管道调用校验脚本（`| tail`）—— 管道的退出码是最后一个命令的，"
                "\n     校验失败也会被当成成功（站规 §5z）。"
            )
            return 1

    if args.no_build:
        print(f"\n全部校验通过（--no-build，跳过构建）。总耗时 {time.time() - total:.1f}s")
        return 0

    print("\n▶ ⑥ 真实构建（zensical build）")
    ok, out, dt = run("build", ["zensical", "build"])
    if not ok:
        print(f"  ✗ 构建失败  {dt:.1f}s")
        print("\n  ── 原始输出（末尾） ──")
        print("  " + tail(out, 30).replace("\n", "\n  "))
        print(
            "\n  这一类错误 `check_*` 脚本查不出来（nav 缩进、锚点缺失、"
            "frontmatter 坏）—— 只有构建会报。"
        )
        return 1

    print(f"  ✓ 构建完成  {dt:.1f}s")
    if "No issues found" in out:
        print("  ✓ 构建输出：No issues found")
    else:
        print("  ⚠️ 构建未报 No issues found，请检查上面输出：")
        print("  " + tail(out).replace("\n", "\n  "))

    print(f"\n{'=' * 66}")
    print(f"全部通过。总耗时 {time.time() - total:.1f}s ｜ 产物：site/")

    if args.serve:
        print("\n起本地预览：http://127.0.0.1:8000/   （Ctrl+C 停止）")
        subprocess.run(
            [PY, "-m", "http.server", "8000", "--bind", "127.0.0.1", "--directory", "site"],
            cwd=str(ROOT),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
