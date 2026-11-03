#!/usr/bin/env python3
"""生成页写盘：**保留 front matter 里不属于本生成器的键**。

为什么需要
----------
站内页面级元信息（``description`` / ``title``）由 ``gen_page_meta.py`` 按页面内容
自动生成、写进 front matter。而页面正文由多支生成器重写 —— 它们各自写一份
``---\\ntags:…\\n---``，**整块替换** front matter。

后果：2026-11-03 修好「191 页同一句 description」之后，只要有人重跑一次图鉴、
地图或任务生成器，那些 description 就全部消失，页面悄悄退回旧状态 ——
而四道门禁都不会报（它们不查 front matter）。

规矩：**谁生成的键谁负责，别人的键原样带过去。**

用法
----
    from _front import write_md
    write_md(path, text)
"""

from __future__ import annotations

import re
from pathlib import Path

# 本模块负责保留的键。加新键时想清楚：它必须是「由别的生成器/人工维护」的。
KEEP_RE = re.compile(r"^(description|title):")


def write_md(path: Path, text: str) -> None:
    """写 md 文件，把旧文件 front matter 里 ``KEEP_RE`` 命中的行搬过去。

    ⚠️ 用 ``write_bytes`` 而不是 ``write_text``：Windows 上文本模式会把已经
       存在的换行再转一次（见 gen_items_catalog.py 文件头的说明）。
    """
    keep: list[str] = []
    if path.exists():
        old = path.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n", old, re.S)
        if m:
            keep = [ln for ln in m.group(1).split("\n") if KEEP_RE.match(ln)]

    if keep and text.startswith("---\n"):
        text = "---\n" + "\n".join(keep) + "\n" + text[4:]

    path.write_bytes(text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
