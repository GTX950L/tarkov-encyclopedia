"""从 eftarkov.com 抓任务的**台词文本**（商人介绍台词 / 完成对话 / 失败对话）。

为什么需要它
------------
本站其余数据都来自 ``json.tarkov.dev``（二级来源），但那个数据源**不含台词** ——
查过它的 ``tasks`` 端点（504 条）与 ``tasks_zh`` 翻译字典（3689 条键），
字段里只有目标、奖励、门槛、失败条件，**没有任何对话文本**。
而「商人开口说了什么」正是任务最有阅读价值的部分之一。

所以台词单独走 eftarkov.com（**三级来源**：玩家维基，非官方、非直读游戏文件）。
口径差异必须在页面上写明 —— 见 ``gen_quests.py`` 里详情页的「数据口径」表。

为什么能 1:1 对上
-----------------
两站都用**游戏原始任务 id**（实测 3 个任务逐一核对：``6752f6d8…`` 双方都是
「一臂之力」）。所以不需要按名字模糊匹配 —— 那正是站内重复踩过的坑
（10 个重名任务）。

抓取要点
--------
* ``robots.txt`` 允许 ``/task/``（仅禁 ``/admin/ /api/ /me /install.php /uploads/``）；
* **每个任务 0.6 秒**，不并发 —— 对方是个人站，值得客气；
* 支持**断点续跑**：每 25 个任务落一次盘，中断后重跑会跳过已抓到的；
* 页面结构变了要能看出来：``--verify`` 只抓 5 个并打印原文，供人工核对。

用法
----
    python scripts/fetch_quest_dialogue.py            # 抓取（可重复跑，自动续）
    python scripts/fetch_quest_dialogue.py --verify   # 只抓 5 个，打印原文供核对
    python scripts/fetch_quest_dialogue.py --missing  # 只补还没抓到的
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUESTS = ROOT / "scripts" / "data" / "quests.json"
OUT = ROOT / "scripts" / "data" / "quest_dialogue.json"
BASE = "https://www.eftarkov.com/task/"

# 0.6 秒/请求 —— 对方是个人维基站，且这是 500+ 次的连续访问，不宜再快。
DELAY = 0.6
# 每抓这么多个就落一次盘：中断了不用从头再来
FLUSH_EVERY = 25

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}


def clean(s: str) -> str:
    """把一小段 HTML 变成纯文本：换行标签保留、其余标签剥掉、实体解码。

    ⚠️ **必须统一换行** —— 源站 HTML 用 CRLF，段落分隔会带出 ``\\r``，
       变成 ``\\n\\r\\n\\n\\r\\n`` 这种脏东西（第一版就漏了这一步）。
    """
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t\u00a0]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def parse(h: str) -> dict | None:
    """任务页 → {intro, done, fail}。三项都可能缺失，缺就是空串。

    ⚠️ **该站对「没有详情页的任务 id」会回退到任务列表页，HTTP 仍是 200。**
       必须显式识别，否则会把「该站查不到」误报成「本来就没有台词」——
       实测 515 个任务里有 **36 个**是这种情况（第一版就是这么漏的，
       那 36 条被存成了「有页面但三个字段全空」，看起来像数据缺失）。
       判据用 `task-detail-main`：真任务页必有，列表页没有。

    ⚠️ 页面结构（2026-10 实测，Class 是 Tailwind 工具类，**选中要按语义类名**）：
        <h1>任务名</h1>
        <p class="text-stone-300 leading-relaxed mb-3">介绍台词</p>   ← 紧跟 h1
        …
        <div class="… task-detail-dialogue-block">
          <h2><i class="fas fa-check-circle">…</i> 任务完成对话</h2>
          <div class="… prose …">正文</div>
        </div>
        （失败对话同构，h2 图标是 fa-times-circle）

    按 ``task-detail-dialogue-block`` 切段、再在段内取**第一个** h2 与第一个
    ``prose``。这样不必匹配嵌套 div 的闭合，对版面微调也不敏感。
    """
    if "task-detail-main" not in h:
        return None

    out = {"intro": "", "done": "", "fail": ""}

    m = re.search(r"<h1[^>]*>.*?</h1>\s*<p[^>]*>(.*?)</p>", h, re.S)
    if m:
        out["intro"] = clean(m.group(1))

    for seg in h.split("task-detail-dialogue-block")[1:]:
        mh = re.search(r"<h2[^>]*>(.*?)</h2>", seg, re.S)
        head = clean(mh.group(1)) if mh else ""
        mp = re.search(r'<div class="[^"]*prose[^"]*"[^>]*>(.*?)</div>', seg, re.S)
        body = clean(mp.group(1)) if mp else ""
        if not body:
            continue
        if "完成对话" in head:
            out["done"] = body
        elif "失败对话" in head:
            out["fail"] = body
    return out


def fetch(tid: str) -> dict | None:
    """抓一个任务页。404 → None（该站没有这个任务，不是错误）。"""
    req = urllib.request.Request(BASE + tid, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return parse(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return None
        raise


def load_tasks() -> list[dict]:
    d = json.loads(QUESTS.read_text(encoding="utf-8"))
    return d["tasks"]


def main() -> int:
    ap = argparse.ArgumentParser(description="抓 eftarkov.com 的任务台词")
    ap.add_argument("--verify", action="store_true", help="只抓 5 个并打印原文，供人工核对结构")
    ap.add_argument("--missing", action="store_true", help="只补还没抓到的（默认全量但跳过已抓）")
    ap.add_argument("--recheck-empty", action="store_true",
                    help="重抓「三个字段全空」的条目 —— 修第一版把列表页误当任务页留下的脏数据")
    ap.add_argument("--limit", type=int, default=0, help="最多抓多少个（0 = 不限）")
    args = ap.parse_args()

    if not QUESTS.exists():
        sys.exit(f"找不到 {QUESTS}")

    payload = {}
    if OUT.exists():
        payload = json.loads(OUT.read_text(encoding="utf-8"))
    items: dict = payload.get("items") or {}
    missing_ids: list = payload.get("missing") or []

    tasks = load_tasks()
    if args.recheck_empty:
        # 「三个字段全空」＝ 可疑：要么真没有台词，要么第一版把列表页当成了任务页。
        # 重抓一遍，抓到的替换、抓不到的移进 missing。
        todo = [t for t in tasks
                if t["id"] in items
                and not items[t["id"]].get("intro")
                and not items[t["id"]].get("done")]
        print(f"【复核模式】重抓「三字段全空」的 {len(todo)} 个")
    else:
        todo = [t for t in tasks if t["id"] not in items and t["id"] not in missing_ids]
    if args.verify:
        todo = tasks[:5]
        print("【核对模式】只抓 5 个，打印原文：")
    elif not args.recheck_empty:
        print(f"任务共 {len(tasks)} 个 ｜ 已有台词 {len(items)} ｜ 已记「该站没有」{len(missing_ids)} "
              f"｜ 本次待抓 {len(todo)}")
    if args.limit:
        todo = todo[: args.limit]

    got = errs = 0
    for i, t in enumerate(todo, 1):
        tid = t["id"]
        try:
            r = fetch(tid)
        except Exception as e:                      # 网络抖动不该毁掉整轮
            errs += 1
            print(f"  [警告] {t['name']}（{tid}）抓取失败：{e}")
            time.sleep(DELAY)
            continue
        if r is None:
            # 该站没有这一页（回退到了列表页）。复核模式下要把旧的脏数据**移出去**，
            # 否则它会一直待在 items 里、被当成「有页面但没台词」。
            items.pop(tid, None)
            if tid not in missing_ids:
                missing_ids.append(tid)
            print(f"  [跳过] {t['name']} —— 该站没有这一页")
        else:
            items[tid] = {"name": t["name"], **r}
            got += 1
            if args.verify:
                print(f"\n【{t['name']}】")
                print(f"  介绍台词（{len(r['intro'])} 字）：{r['intro'][:200]}")
                print(f"  完成对话（{len(r['done'])} 字）：{r['done'][:200]}")
                print(f"  失败对话（{len(r['fail'])} 字）：{r['fail'][:200] or '（无）'}")
        if not args.verify and i % FLUSH_EVERY == 0:
            save(items, missing_ids)
            print(f"  … {i}/{len(todo)}（已落盘）")
        time.sleep(DELAY)

    if not args.verify:
        save(items, missing_ids)

    print(f"\n本轮新增 {got} 个，失败 {errs} 个")
    show_stats(items, missing_ids, len(tasks))
    return 0


def save(items: dict, missing_ids: list) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fetched": time.strftime("%Y-%m-%d"),
        "source": "eftarkov.com/task/（**三级来源**：玩家维基，非官方、非直读游戏文件）",
        "note": "台词为游戏内文本，随游戏语言版本变动；引用时以游戏内为准。",
        "items": dict(sorted(items.items())),
        "missing": sorted(set(missing_ids)),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def show_stats(items: dict, missing_ids: list, total: int) -> None:
    n = len(items)
    d = sum(1 for v in items.values() if v.get("done"))
    f = sum(1 for v in items.values() if v.get("fail"))
    i = sum(1 for v in items.values() if v.get("intro"))
    lens = sorted(len(v.get("intro") or "") for v in items.values() if v.get("intro"))
    print(f"  已抓台词 {n} / {total} 个任务（该站没有 {len(missing_ids)}）")
    print(f"  有介绍 {i} ｜ 有完成对话 {d} ｜ 有失败对话 {f}")
    if lens:
        print(f"  介绍台词字数：中位 {lens[len(lens)//2]} ｜ 最短 {lens[0]} ｜ 最长 {lens[-1]}")
    # --verify 不落盘，这里要兜住「文件还不存在」
    if OUT.exists():
        print(f"  写入 {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）")
    else:
        print("  （核对模式未写盘）")


if __name__ == "__main__":
    sys.exit(main())
