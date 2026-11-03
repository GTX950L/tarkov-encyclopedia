#!/usr/bin/env python3
"""地图总览卡片的三个数字，由 ``maps_site.json`` 复算，**不再手写**。

为什么必须有这一支
------------------
2026-11-03 全站审查实测：``content/maps/index.md`` 的 13 张卡片里 **9 张**
的「任务区域」数与数据源对不上（海关 116 vs 104、工厂 71 vs 44、海岸线 89 vs 67…），
合计 589 vs 真值 522。根因不是谁粗心 —— 是**这处数字既没有生成器写、
也没有任何校验器查**，是全站唯一一处「手工维护的规模数字」。

地图单页（``maps/customs.md`` 那种）早就由 ``gen_map_pages.py`` 从同一份
``maps_site.json`` 生成，所以每张图的**页内**数字一直是对的，**只有总览卡片**在漂。
这正是「副本」类缺陷的典型形态：两处讲同一件事，一处自动一处手写。

它做什么
--------
只改写每张卡片里的这一行：

    <span class="tk-mcard__nums">地名 24 ｜ 任务区域 104 ｜ 撤离点 28</span>

其余字节（缩略图、标题、时长人数、卡片描述）**一律不动** —— 那些是人工文案，
不归这支管。口径与页面下方「地名是上游给的地名锚点数量」那段说明一致。

三个约定
--------
① **0 显示为「—」，不显示 0**。上游没给数据与「确实是 0」在读者侧是同一件事：
   这张图没有这项点位。写成 0 会让人以为「抓了但抓到 0 个」。
   真值 0 的地图（终点站 / 破冰船）当前就是「—」，与正文「数据没有就是没有」自洽。
② **卡片缺一行就补，键对不上就报错**。``maps_site.json`` 有 13 个键、
   ``index.md`` 有 13 张卡片，两个集合必须相等 —— 任一侧多出来都说明有人加了图
   却没加卡片（或反之），那是需要人看一眼的，不该静默跳过。
③ **幂等**。产物入库，``check_gen_drift.py`` 会重跑它并比对前后，
   所以同一份输入跑两遍必须字节一致。

用法
----
    python scripts/gen_map_cards.py            # 写回 content/maps/index.md
    python scripts/gen_map_cards.py --check    # 只校验，不写盘（不一致时退出码 1）
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "content" / "maps" / "index.md"
SITE = ROOT / "scripts" / "data" / "maps_site.json"

# 卡片整体：从 <a> 开标签到配对闭标签。用非贪婪 + 明确的 </a> 收口，
# 避免把下一张卡片吞进来（审查时正是跨卡片贪婪匹配，把实验室的数字读成了终点站的）。
CARD_RE = re.compile(
    r'(<a class="tk-mcard" href="(?P<key>[\w\-]+)\.md">)(?P<body>.*?)(</a>)',
    re.S,
)
NUMS_RE = re.compile(r'(<span class="tk-mcard__nums">)(?P<txt>.*?)(</span>)')

DASH = "—"


def fmt(n: int) -> str:
    """0 → 「—」，其余原样。见模块头约定 ①。"""
    return DASH if n == 0 else str(n)


def nums_line(labels: int, zones: int, extracts: int) -> str:
    return f"地名 {fmt(labels)} ｜ 任务区域 {fmt(zones)} ｜ 撤离点 {fmt(extracts)}"


def build(maps: dict) -> tuple[str, list[str]]:
    """返回（改写后的全文，变更说明列表）。不改盘。"""
    src = INDEX.read_text(encoding="utf-8")
    changes: list[str] = []
    seen: set[str] = set()

    def repl(m: re.Match) -> str:
        key = m.group("key")
        seen.add(key)
        if key not in maps:
            raise KeyError(f"卡片指向的地图 {key!r} 不在 maps_site.json 里")
        d = maps[key]
        want = nums_line(
            len(d.get("labels") or []),
            len(d.get("questZones") or []),
            len(d.get("extracts") or []),
        )
        body = m.group("body")
        nm = NUMS_RE.search(body)
        if not nm:
            raise ValueError(f"卡片 {key!r} 没有 tk-mcard__nums 行")
        old = nm.group("txt")
        if old != want:
            changes.append(f"{key:18s} {old}  →  {want}")
            body = body[: nm.start("txt")] + want + body[nm.end("txt") :]
        return m.group(1) + body + m.group(4)

    out = CARD_RE.sub(repl, src)

    # 约定 ②：两侧集合必须相等。
    only_data = sorted(set(maps) - seen)
    if only_data:
        raise KeyError(f"maps_site.json 里有、index.md 卡片里没有：{only_data}")
    return out, changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写盘")
    args = ap.parse_args()

    maps = json.loads(SITE.read_text(encoding="utf-8"))
    try:
        out, changes = build(maps)
    except (KeyError, ValueError) as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1

    if args.check:
        if changes:
            print(f"✗ 地图总览卡片有 {len(changes)} 处与 maps_site.json 不一致：")
            for c in changes:
                print("   " + c)
            return 1
        print(f"✓ 13 张地图卡片数字与 maps_site.json 一致（区域合计 "
              f"{sum(len(v.get('questZones') or []) for v in maps.values())}）")
        return 0

    if not changes:
        print("✓ 已是最新，无需改写")
        return 0
    INDEX.write_bytes(out.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    print(f"✓ 改写 {len(changes)} 张卡片：")
    for c in changes:
        print("   " + c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
