#!/usr/bin/env python3
"""数据端点漂移检测 —— 站内缓存的那份数据，跟上游比还一样吗？

为什么需要它
------------
站内所有数值表（弹药 200 条 / 护甲 161 项 / 武器 172 把 / 藏身处 26 模块 /
任务 / 配方 1069 条）都是从 `json.tarkov.dev` 抓下来、**生成脚本写进 markdown
的静态文本**。这套设计的前提是「上游只在补丁时变」—— 而事实是上游会**静默
增删**（新武器、新任务、新配方），站内不会自己知道。

本站已有一条明确的纪律（见 `content/docs/roadmap.md` 的「任务数据与端点漂移」）：

> **不许自动重抓。** 站点不列坐标、不复刻游戏内文本，数值口径要与
> `citation.md` 的基线快照对齐；自动重抓会把「未经复核的新数值」直接推上线，
> 而读者引用的正是这些数值。

所以这个脚本只做一件事：**报告差异，不改任何文件，退出码恒为 0。**

⚠️ 它是**信息性**的（和 `check-freshness.py` 同类），不是 CI 部署门禁。
   区别在于它需要联网：把联网检查放进部署前置，会让 GitHub 的抖动变成
   一次失败的部署。它只在定时巡检（`.github/workflows/health-check.yml`）里跑。

⚠️ **本脚本最大的坑是「取错了字段」。** `json.tarkov.dev` 的响应一律是
   `{"data": …, "translations": …}`，但每个端点的 `data` 形态都不同 ——
   顶层可能是 list（crafts / barters）、可能是 id→对象 的 dict（traders /
   hideout）、也可能再嵌一层（tasks 在 `data.tasks`、items 在 `data.items`）。
   第一版按「`len(data)`」统一取，结果把 504 条任务读成了 **4**（`data` 有
   四个字段），并报出「-511 条漂移」这种假警报。**假警报比不报更糟** ——
   它会让人从此不信这个脚本，于是真正的漂移也就漏了。

   所以这里是**清单驱动**：每个端点显式写清取哪一条路径（见 ENDPOINTS），
   取不到就报「口径不认识」，而不是猜一个数。

用法
----
    python scripts/check_drift.py            # 全部端点（items 约 17 MB 下载）
    python scripts/check_drift.py --light    # 跳过 items
    python scripts/check_drift.py --json     # 纯 JSON 输出（给 workflow 用）

退出码恒 0；网络不可达时打印「取不到」而不是失败。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
API = "https://json.tarkov.dev/regular/"

# 大文件会 403 —— 实测补上 Origin / Referer 与完整 UA 即 200（别把 403 当永久拒绝）
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
TIMEOUT = 180

# --json 模式下**一个字节的人类可读文本都不能出现**（见 main() 的说明）
QUIET = False

# ---------------------------------------------------------------------------
# 端点清单（唯一事实源）
#   path   —— data 内取集合的路径（空 = data 本身）
#   file   —— 站内缓存文件名（None = 无缓存文件，基线写在 KNOWN_BASELINE）
#   field  —— 缓存文件里存计数的字段（None = 按 label 对应的 list/dict 取长度）
#   heavy  —— --light 时跳过
# ---------------------------------------------------------------------------
ENDPOINTS: list[dict] = [
    {"label": "tasks", "name": "tasks", "path": "tasks", "file": "quests.json",
     "field": "count", "used": "content/quests/（每个任务逐条）"},
    {"label": "achievements", "name": "tasks", "path": "achievements", "file": "quests.json",
     "field": None, "used": "content/entries/achievements.md"},
    {"label": "crafts", "name": "crafts", "path": "", "file": "recipes.json",
     "field": None, "used": "content/docs/recipes.md（制作）"},
    {"label": "barters", "name": "barters", "path": "", "file": "recipes.json",
     "field": None, "used": "content/docs/recipes.md（交换）"},
    {"label": "traders", "name": "traders", "path": "", "file": "recipes.json",
     "field": None, "used": "content/entries/traders.md"},
    {"label": "hideout", "name": "hideout", "path": "", "file": "hideout.json",
     "field": "count", "used": "content/entries/hideout-modules.md"},
    {"label": "items", "name": "items", "path": "items", "file": None,
     "field": None, "used": "弹药 / 护甲 / 武器 / 食物 / 医疗 等图鉴", "heavy": True},
]

# 缓存文件里没有、或口径需另写一句的基线
KNOWN_BASELINE: dict[str, tuple[int, str]] = {
    "achievements": (127, "content/entries/achievements.md 声明 127 个成就"),
    "crafts": (214, "recipes.json -> len(crafts)"),
    "barters": (855, "recipes.json -> len(barters)"),
    "traders": (16, "traders 端点：16 位（含 Ref / BTR Driver / Lightkeeper）"),
    "items": (5476, "2026-10-06 抓取时 items 端点的条目数（站内只用了其中一部分）"),
}


def fetch_payload(name: str, retry: int = 2) -> dict | None:
    """取端点；403/限流时重试（实测补头 + 重试都能过）。"""
    last: Exception | None = None
    for attempt in range(retry + 1):
        req = urllib.request.Request(API + name, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                json.JSONDecodeError, OSError) as exc:
            last = exc
            if attempt < retry:
                time.sleep(3 + attempt * 4)   # 限流多为短时，退避一下
    if not QUIET:
        print(f"  ！{name}: 取不到（{type(last).__name__}: {last}）")
    return None


def dig(payload: dict, path: str):
    """按点号路径从 data 里取值；空路径返回 data 本身。取不到返回 None。"""
    node = payload.get("data", payload)
    if not path:
        return node
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def count_of(node) -> int | None:
    if isinstance(node, (list, dict)):
        return len(node)
    return None


def local_cache(fn: str | None) -> dict | None:
    if not fn:
        return None
    p = DATA / fn
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def baseline_for(ep: dict) -> tuple[int | None, str]:
    """站内那份计数 + 它的出处（说明文字）。"""
    cache = local_cache(ep["file"])
    if cache is not None:
        if ep["field"] and cache.get(ep["field"]) is not None:
            return int(cache[ep["field"]]), f"{ep['file']}.{ep['field']}（抓取日 {cache.get('fetched', '?')}）"
        holder = cache.get(ep["label"])
        if isinstance(holder, (list, dict)) and len(holder) > 0:
            return len(holder), f"{ep['file']}.{ep['label']}（抓取日 {cache.get('fetched', '?')}）"
    known = KNOWN_BASELINE.get(ep["label"])
    if known:
        return known[0], known[1]
    return None, "未记录基线"


def main() -> int:
    ap = argparse.ArgumentParser(description="数据端点漂移检测（只报告，不改文件）")
    ap.add_argument("--light", action="store_true", help="跳过 items（省约 17 MB 下载）")
    ap.add_argument("--json", action="store_true", help="只输出机器可读 JSON")
    args = ap.parse_args()

    global QUIET
    QUIET = bool(args.json)

    # ⚠️ --json 时必须**只**输出 JSON —— 前面任何一行人类可读文本都会让
    #    `json.load(open("drift.json"))` 失败，而那种失败会表现为「巡检静默不报」。
    def say(*a, **kw):
        if not args.json:
            print(*a, **kw)

    say("数据端点漂移检测")
    say("=" * 78)
    say(f"上游：{API}")
    say("口径：只比数量；差异由人判断，**不自动重抓**（站规见 content/docs/roadmap.md）。")
    say("")

    targets = [ep for ep in ENDPOINTS if not (args.light and ep.get("heavy"))]
    say(f"{'端点':<14}{'站内':>8}{'上游':>8}{'差异':>8}   站内基线出处")
    say("-" * 78)

    rows: list[dict] = []
    drift = False
    unrecognised = False
    checked = 0          # 真的拿到上游计数的端点数
    unreachable = 0      # 取不到的端点数

    for ep in targets:
        label = ep["label"]
        base, origin = baseline_for(ep)

        payload = fetch_payload(ep["name"])
        live = None
        if payload is not None:
            live = count_of(dig(payload, ep["path"]))
            if live is None:
                unrecognised = True
                say(f"  ！{label}: 端点结构不认识（data.{ep['path'] or '(自身)'} 不是集合）"
                    f" —— 上游可能改了字段名，要人工核对")
        else:
            unreachable += 1
        if live is not None:
            checked += 1

        delta: int | str = "-"
        if live is not None and base is not None:
            delta = live - base

        mark = ""
        if isinstance(delta, int) and delta != 0:
            mark = "  ← 有漂移"
            drift = True

        say(f"{label:<14}{str(base if base is not None else '—'):>8}"
            f"{str(live if live is not None else '—'):>8}{str(delta):>8}   {origin}{mark}")

        rows.append({"端点": label, "站内": base, "上游": live, "差异": delta,
                     "基线出处": origin, "用在": ep["used"]})

    say("-" * 78)

    # ⚠️ 「一个端点都没拿到」绝不能报「未检测到漂移」。
    #    那是最危险的一种假绿：脚本看起来全绿，实际上它什么都没查 ——
    #    而人会因此放心地不去看。判据：**没查 ≠ 查过没问题。**
    if checked == 0:
        say("\n⚠️ 本次**一个端点都没取到**（网络不可达 / 被限流），所以这次巡检"
            "**什么都没验证** —— 不要把它读成「没问题」。")
        say(f"   （取不到 {unreachable} 个；建议稍后手动跑一次 "
            f"`python scripts/check_drift.py --light`）")
    elif drift:
        say("\n⚠️ 检测到差异。**下一步是人来判断，不是脚本**：")
        say("   · 若是补丁新增 / 移除内容 → 走 content/docs/roadmap.md 的「版本敏感内容」复核流程；")
        say("   · 若只是端点口径调整（重命名 / 拆表 / 过滤条件变了）→ 记进 roadmap，可能不需要重抓；")
        say("   · 重抓前先读 content/docs/citation.md 的基线快照口径，并想清楚页面上那几处")
        say("     写死的计数（如「515 个任务」）要同步改多少处。")
    elif unrecognised:
        say("\n⚠️ 有端点结构不认识 —— 这不一定是漂移，但要让脚本重新对上口径。")
    else:
        say(f"\n✓ 未检测到漂移：{checked} 个端点的站内基线与上游计数一致。")

    if args.json:
        print(json.dumps({"drift": drift, "unrecognised": unrecognised,
                          "checked": checked, "unreachable": unreachable, "rows": rows},
                         ensure_ascii=False, indent=1))

    # 信息性脚本：恒返回 0（联网抖动不该让巡检变红）
    return 0


if __name__ == "__main__":
    sys.exit(main())
