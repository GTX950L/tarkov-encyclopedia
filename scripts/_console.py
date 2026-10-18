#!/usr/bin/env python3
"""控制台编码兜底：让 `✅` / `—` / 中文在任何终端上都不炸。

## 为什么需要（2026-10-18 实测）

Windows 本地跑 `python scripts/check_entries.py` 时，**七道门禁里第一道直接崩**：

    UnicodeEncodeError: 'gbk' codec can't encode character '\\u2705'
    ... scripts/check_entries.py:913

`\\u2705` 就是最后那句「✅ 校验通过」里的对勾。CI（Ubuntu + UTF-8）永远看不到这个
错误，所以它能一直躺在仓库里 —— 而 Windows 是**这个项目的主要开发环境**
（`.gitattributes` 里专门为 `core.autocrlf=true` 写了行尾约定）。结果是：新人按
文档在 Windows 上跑第一道门禁，看到的是一个和「内容写错了」毫无关系的崩溃。

## 做法

1. `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` —— 当前进程；
2. `os.environ.setdefault("PYTHONIOENCODING", "utf-8")` —— **子进程**
   （`check_gen_drift.py` 会重跑 25 支生成器，它们各自打印自己的对勾）。

不改变任何输出字节（UTF-8 与原来一致），只是不让解释器在写盘前编码失败。

用法：在每个入口脚本的 `if __name__ == "__main__":` 里第一行调用 `setup()`。
"""

from __future__ import annotations

import os
import sys


def setup() -> None:
    """把本进程与后续子进程的输出编码统一到 UTF-8（幂等，可重复调用）。"""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:  # 被替换成 StringIO / 管道包装时没有这个方法
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # 已经关闭或不允许重配置（罕见）：宁可保持原样，也不要让门禁因此崩掉
            pass
