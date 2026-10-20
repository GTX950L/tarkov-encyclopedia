#!/usr/bin/env python3
"""客户端版本巡检：站内声明的那一行 build，跟上游比还对得上吗？

为什么需要它
------------
`content/docs/citation.md` 第二节有一行：

    | **线上客户端 build** | **1.2.5.0.48146**（最近一次核对：**2026-10-20**…） |

它是全站**唯一一个「上游一变就必然过期」的字段**。其余版本信息都有韧性：
条目页眉只写「2026 年 10 月」，图鉴页写的是**抓取日**对应的版本 —— 都不随
新补丁发布而失真。只有这一行是「**现在线上是什么版本**」的事实陈述。

2026-10-20 的全面审查实测它就过期了：站内写 `1.2.0.0.47965`（核对于 10-15），
而 `1.2.5.0` 已于 10-16 发布并累积 1,039 处改动。当时全仓搜 `tarkov-changes`
在 `scripts/` 与 `.github/` 里**零命中** —— 这个字段**没有任何检查器在看它**，
只能靠人记着去核，而人一定会忘。

站内既有判据：「**凡写死的数字，都要问一句谁在数它。**」这一支就是那个「谁」。

判据与纪律
----------
1. **只报告，退出码恒为 0** —— 这是「巡检」（第三类门禁），不是部署前置。
   上游抖动不该变成一次失败的部署，也不该阻断任何 push。
2. **取不到就说「本次什么都没验证」**，绝不能打印「未检测到漂移」。
   （站规：没查 ≠ 查过没问题。这是最危险的一种假绿。）
3. **不自动改 citation.md** —— 版本变了要人判断「这一版动了什么、站内哪些
   内容受影响」，与 `check_drift.py` 同一个理由：检测与处置必须分开。

用法
----
    python scripts/check_client_version.py            # 人看的报告
    python scripts/check_client_version.py --json     # CI 用（stdout 只有 JSON）

何时该跑：每周巡检（`.github/workflows/health-check.yml`），以及每次大版本
补丁之后手动跑一次。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITATION = ROOT / "content" / "docs" / "citation.md"

# 上游：tarkov-changes 直读游戏客户端文件，是站内认定的「最接近客观事实」的来源。
SOURCE = "https://tarkov-changes.com/"
SOURCE_LABEL = "tarkov-changes（直读游戏文件）"

# ⚠️ 用**带项目地址的自报 UA**，不要伪装浏览器（同 check_drift.py 的教训：
#    用浏览器 UA 反而会被拦，且不便上游识别）。
HEADERS = {
    "User-Agent": (
        "tarkov-encyclopedia-version-check/1.0 "
        "(+https://github.com/GTX950L/tarkov-encyclopedia)"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
TIMEOUT = 60

# 客户端 build 是**五段**：1.2.5.0.48146（前三段是版本，第四段是热修位，末段是 build）
# 只匹配四段会把「1.2.5.0.48146」截成「2.5.0.48146」，静默给出错误的版本号。
BUILD_RE = re.compile(r"\b(\d+\.\d+\.\d+\.\d+\.\d{4,6})\b")

# 站内声明行的解析：`| **线上客户端 build** | **1.2.5.0.48146**（最近一次核对：**2026-10-20**…） |`
DECLARED_RE = re.compile(
    r"\*\*线上客户端 build\*\*.*?\*\*(\d+\.\d+\.\d+\.\d+\.\d+)\*\*.*?"
    r"最近一次核对：\*\*(\d{4}-\d{2}-\d{2})\*\*",
    re.S,
)

QUIET = False


def say(*a, **kw) -> None:
    if not QUIET:
        print(*a, **kw)


def read_declared() -> tuple[str, str]:
    """站内声明的 (build, 核对日期)。取不到就报错退出。"""
    if not CITATION.exists():
        raise SystemExit(f"错误：找不到 {CITATION.relative_to(ROOT)}")
    text = CITATION.read_text(encoding="utf-8")
    m = DECLARED_RE.search(text)
    if not m:
        raise SystemExit(
            "错误：citation.md 第二节里找不到「线上客户端 build」声明行。\n"
            "  期望格式：| **线上客户端 build** | **1.2.5.0.48146**"
            "（最近一次核对：**2026-10-20**…） |\n"
            "  如果你是改了这一行的措辞、让正则对不上 —— 请同步改本脚本的 DECLARED_RE，"
            "而不是放宽到「随便找个版本号」（那会让它对着错误的东西比对）。"
        )
    return m.group(1), m.group(2)


def fetch_upstream() -> tuple[str, int]:
    """上游最新 build 号。返回 (build, 该页出现的次数)。取不到抛异常。"""
    req = urllib.request.Request(SOURCE, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        html = resp.read().decode("utf-8", "replace")
    found = BUILD_RE.findall(html)
    if not found:
        raise ValueError("页面里没有匹配到五段式 build 号")
    return found[0], len(found)


def main() -> int:
    global QUIET
    ap = argparse.ArgumentParser(description="客户端版本巡检（只报告，不改文件）")
    ap.add_argument("--json", action="store_true", help="stdout 只输出 JSON（CI 用）")
    args = ap.parse_args()
    QUIET = args.json

    result: dict = {
        "checked": False,
        "declared": None,
        "declared_date": None,
        "upstream": None,
        "drift": False,
        "stale_days": None,
        "reason": None,
    }

    try:
        declared, declared_date = read_declared()
    except SystemExit as e:
        result["reason"] = str(e)
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(result["reason"], file=sys.stderr)
        return 0

    result.update(declared=declared, declared_date=declared_date)

    try:
        upstream, hits = fetch_upstream()
    except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
        # ⚠️ 取不到 ≠ 没问题。必须显式说「本次什么都没验证」。
        result["reason"] = f"上游不可达：{type(e).__name__}: {e}"
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"⚠️ 本次**什么都没验证** —— {SOURCE_LABEL} 取不到（{e}）。")
            print("   这不代表版本一致，也不代表有漂移。过一会儿再跑一次。")
        return 0

    result["checked"] = True
    result["upstream"] = upstream
    drift = declared != upstream
    result["drift"] = drift

    # 「核对日期」本身也会过期 —— 即使 build 号碰巧还对得上，太久没核也值得提醒。
    try:
        y, m, d = (int(x) for x in declared_date.split("-"))
        stale = (date.today() - date(y, m, d)).days
        result["stale_days"] = stale
    except ValueError:
        stale = None

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
        return 0

    say("客户端版本巡检")
    say(f"  站内声明：{declared}（核对于 {declared_date}"
        + (f"，已 {stale} 天" if stale is not None else "") + "）")
    say(f"  上游实际：{upstream}（{SOURCE_LABEL}，页内命中 {hits} 处）")

    if drift:
        say("")
        say(f"✗ 漂移：站内声明落后 / 不符（{declared} → {upstream}）")
        say("  处置：")
        say("    1. 改 citation.md 的 build 号与核对日期；llms.txt 的「游戏版本基准」跟着核一遍")
        say("    2. 判断这一版动了什么：数值表（弹药/护甲/武器/价格）是否受影响，")
        say("       需要用 tarkov-changes 的 silent changes 逐项看 —— 不含数值改动就只改声明")
        say("    3. 若版本号抬了但数值没变，**不要**抬 citation 的「全站基线版本」")
    else:
        say("")
        say("✓ 站内声明的 build 与上游一致。")
        if stale is not None and stale > 14:
            say(f"  ⚠️ 但上次核对于 {stale} 天前，建议重核一次再把这个日期刷新。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
