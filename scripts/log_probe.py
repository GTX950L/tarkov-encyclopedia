#!/usr/bin/env python3
"""日志能力探针 —— 只读扫描塔科夫 Logs 目录，报告「除任务与地图外还有什么可自动填」。

为什么先探针再实现
------------------
进度页想少让读者手填（等级、商人忠诚度、声望、仓库件数、藏身处等级），
但在写解析器之前必须先知道**日志里到底有没有这些事实**。本脚本只做两件事：

  ① 统计 `Got notification | ChatMessageReceived` 事件的 `message.type` 分布；
  ② 在 `application_*.log` 里 grep 一组关键字（level / loyalty / reputation /
     standing / stash / hideout / skill），报告命中文件数与样例行。

**不写文件、不联网、不复制日志原文**：只在内存里统计，输出一张表。

用法
----
    python scripts/log_probe.py <Logs 目录>          # 目录
    python scripts/log_probe.py <某个 .log 文件>      # 单文件
    python scripts/log_probe.py <目录> --sample 3     # 每类关键字多给几行样例
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

NAME_RE = re.compile(r"^(.+?) (application|push-notifications|output)_\d+\.log$", re.I)
NOTIF_RE = re.compile(r"Got notification \| ChatMessageReceived")
LINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

KEYWORDS = [
    "level", "loyalty", "reputation", "standing", "stash", "hideout",
    "skill", "experience", "profile",
]


def scan_log(path: Path, types: Counter, hits: dict[str, list[str]],
             max_samples: int) -> int:
    n = 0
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                n += 1
                if NOTIF_RE.search(line):
                    m = re.search(r'"type"\s*:\s*(\d+)', line)
                    if m:
                        types[m.group(1)] += 1
                low = line.lower()
                for kw in KEYWORDS:
                    if kw in low and len(hits[kw]) < max_samples:
                        hits[kw].append(line.strip()[:200])
    except OSError as e:
        print(f"  ⚠ 读不动 {path.name}: {e}", file=sys.stderr)
    return n


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sample = 3
    for a in sys.argv[1:]:
        if a.startswith("--sample"):
            try:
                sample = int(a.split("=", 1)[1])
            except Exception:
                sample = 3
    if not args:
        print(__doc__)
        return 2
    root = Path(args[0])
    files: list[Path] = []
    if root.is_file():
        files = [root]
    elif root.is_dir():
        for p in sorted(root.rglob("*.log")):
            if NAME_RE.match(p.name):
                files.append(p)
    else:
        print(f"找不到：{root}", file=sys.stderr)
        return 2

    types: Counter = Counter()
    hits: dict[str, list[str]] = {k: [] for k in KEYWORDS}
    lines = 0
    for p in files:
        lines += scan_log(p, types, hits, sample)

    print(f"扫描 {len(files)} 个日志文件 / {lines:,} 行")
    print("\n① 通知事件 type 分布（type=10 接取 / 11 失败 / 12 完成，其余为跳蚤、保险等）")
    if not types:
        print("  （没有读到通知事件）")
    for t, c in sorted(types.items(), key=lambda kv: -kv[1]):
        label = {"10": "接取任务", "11": "任务失败", "12": "任务完成"}.get(t, "")
        print(f"  type {t:>3}  {c:>6}  {label}")

    print("\n② application 日志里的关键字命中（每类最多给 3 行样例）")
    for kw in KEYWORDS:
        rows = hits[kw]
        print(f"  {kw:<12} {'命中' if rows else '未命中'}"
              + (f"（样例 {len(rows)} 行）" if rows else ""))
        for r in rows:
            print("      " + r)
    print("\n判读：type 只有 10/11/12 与跳蚤类 → 日志能补的仍只有任务状态与地图场次；")
    print("      level / loyalty / reputation / stash 命中为 0 → 那些字段得靠手填，别写解析器。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
