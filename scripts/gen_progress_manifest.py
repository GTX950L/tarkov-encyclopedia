"""进度清单生成器 —— 为「我的进度」提供三份只读分母/列表：任务、物品收集、藏身处。

    python scripts/gen_progress_manifest.py

为什么单独一个小脚本，而不并进 gen_quests.py：
    gen_quests.py 的产物是 12 个面向读者的任务页，带「整栏重建」语义、动辄重写
    几百 KB 正文。本清单只是前端一个只读常量，重建时机与页面完全不同 ——
    改版式不必重算清单，而重抓数据后两个产物都要重建。
    但清单**不自己发明数据**：商人标签从 gen_quests 导入、物品口径从
    gen_quest_items 导入、藏身处模块名逐条对应 hideout-modules.md 的原文。

产物：content/javascripts/progress-manifest.js
    window.TARKOV_PROGRESS_MANIFEST = { generated, source, baseline,
                                        total, traders, items, hideout }

本脚本存在的一半理由是**三道对账**（对不上就退出码 1，卡住 CI）：
    ① 任务：清单合计 == content/quests/*.md 里 data-qid 的出现次数与唯一数；
    ② 物品：清单条数 == quests/index.md 的「物品需求反查」表行数；
    ③ 藏身处：清单里的每个模块名都能在 hideout-modules.md 找到，
       且 §1 分层表的模块数与清单里带层归属的条数相等。
    这三处一旦漂移，读者看到的完成度分母就是错的 —— 而分母错比没有进度更糟。
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g          # noqa: E402  复用 DATA_FILE / TRADER_ORDER / TRADER_LABEL
import gen_quest_items as gi    # noqa: E402  复用 DEMAND / TRADER（物品口径的唯一出处）

OUT_FILE = g.ROOT / "content" / "javascripts" / "progress-manifest.js"
QUEST_INDEX = g.ROOT / "content" / "quests" / "index.md"
HIDEOUT_PAGE = g.ROOT / "content" / "entries" / "hideout-modules.md"

QID_RE = re.compile(r'data-qid="([0-9a-f]{24})"')

# 与「物品需求反查」表同一口径：被 ≥3 个任务需要的物品
ITEM_THRESHOLD = 3

# ---------------------------------------------------------------------------
# 藏身处模块清单
#
# 逐条对应 entries/hideout-modules.md 的原文，**不自己发明**：
#   · 前 17 条来自该页 §1「模块按产出类型分四层」——因此带 `layer`，
#     且第 4 个字段是 §1 里的**原文写法**（用于精确对账；§1 把
#     `Scav 包裹（Scav Case）`、`十字路口（供奉）` 写成一个词，
#     而清单里用更适合列表展示的写法，两者靠这一列绑定）。
#   · 后 4 条来自 §3「模块等级与关键数值」——该页 §2 的功能表没有它们，
#     但 §3 给了等级，属于本页确实记录过的模块，故一并纳入（layer = None）。
#
# `max` 只填该页**明确写过**的等级上限；写不出的填 None（页面对未取到
# 二级来源的模块一律留白，清单也留白 —— 详实 ≠ 编数据）。
# ---------------------------------------------------------------------------

HIDEOUT_MODULES = [
    # (清单显示名,      层,      等级上限, §1 原文写法)
    ("生成器",          "地基层", 3,    "生成器"),
    ("太阳能",          "地基层", None, "太阳能"),
    ("水收集器",        "生存层", None, "水收集器"),
    ("营养单元",        "生存层", None, "营养单元"),
    ("医疗站",          "生存层", None, "医疗站"),
    ("卫生间",          "生存层", None, "卫生间"),
    ("工作台",          "生产层", None, "工作台"),
    ("情报中心",        "生产层", 3,    "情报中心"),
    ("空气过滤单元",     "生产层", 1,   "空气过滤单元"),
    ("比特币矿场",       "收益层", 3,   "比特币矿场"),
    ("私酒厂",          "收益层", 1,    "私酒厂"),
    ("Scav 包裹",       "收益层", None, "Scav 包裹（Scav Case）"),
    ("十字路口 / 供奉",  "收益层", None, "十字路口（供奉）"),
    ("健身房",          "成长层", None, "健身房"),
    ("射击场",          "成长层", None, "射击场"),
    ("图书馆",          "成长层", None, "图书馆"),
    ("名人堂",          "成长层", None, "名人堂"),
    # —— §3 补充（该页 §3 有等级、§2 功能表未列） ——
    ("加热器",          None,     3,    None),
    ("照明",            None,     3,    None),
    ("易碎墙",          None,     5,    None),
    ("仓库",            None,     4,    None),
]

LAYER_ORDER = ["地基层", "生存层", "生产层", "收益层", "成长层"]


def norm(s: str) -> str:
    """对账用的宽松比较：去掉所有空白。页面里 `十字路口 / 供奉` 带空格，
    清单里也可能不带 —— 空格差异不该判成漂移。"""
    return re.sub(r"\s+", "", s)


# ---------------------------------------------------------------------------
# ① 任务
# ---------------------------------------------------------------------------

def build_quests(tasks: list[dict]) -> tuple[dict, int]:
    counts: dict[str, int] = {}
    for t in tasks:
        key = t.get("trader") or ""
        counts[key] = counts.get(key, 0) + 1

    traders = []
    for slug in g.TRADER_ORDER:
        if slug in counts:
            traders.append({"slug": slug, "name": g.TRADER_LABEL.get(slug, slug),
                            "count": counts[slug]})
    # 不在 TRADER_ORDER 里的商人：**不丢**。丢了合计就对不上任务总数，
    # 而合计是读者唯一能用来核对「我到底做完了多少比例」的数。
    for slug in sorted(k for k in counts if k not in g.TRADER_ORDER):
        traders.append({"slug": slug, "name": g.TRADER_LABEL.get(slug, slug),
                        "count": counts[slug]})
    return {"total": sum(t["count"] for t in traders), "traders": traders}, \
        sum(t["count"] for t in traders)


def count_page_qids() -> tuple[int, int]:
    total = 0
    uniq: set[str] = set()
    for md in sorted(g.OUT_DIR.glob("*.md")):
        found = QID_RE.findall(md.read_text(encoding="utf-8"))
        total += len(found)
        uniq.update(found)
    return total, len(uniq)


# ---------------------------------------------------------------------------
# ② 物品收集（口径与 gen_quest_items.py 完全一致：按**任务名**去重）
# ---------------------------------------------------------------------------

def build_items(tasks: list[dict]) -> dict:
    item_tasks: dict[str, set] = defaultdict(set)
    item_qty: dict[str, int] = defaultdict(int)
    item_traders: dict[str, Counter] = defaultdict(Counter)

    for q in tasks:
        tr = gi.TRADER.get(q.get("trader"), q.get("trader") or "—")
        for o in q.get("objectives") or []:
            if o.get("type") not in gi.DEMAND:
                continue
            for it in o.get("items") or []:
                # ⚠️ 用 q["name"] 而不是 q["id"]：站点「物品需求反查」表就是这个口径
                #    （实测同一份数据下 name 去重得 79 条、id 去重得 116 条）。
                #    两处口径必须一致，否则总览页与任务图鉴总览会给出两个数。
                item_tasks[it].add(q["name"])
                item_qty[it] += o.get("count") or 1
                item_traders[it][tr] += 1

    rows = [(k, len(v), item_qty[k], item_traders[k])
            for k, v in item_tasks.items() if len(v) >= ITEM_THRESHOLD]
    rows.sort(key=lambda r: (-r[1], -r[2], r[0]))

    return {
        "threshold": ITEM_THRESHOLD,
        "total": len(rows),
        "list": [{
            "name": name,
            "tasks": n,
            "qty": qty,
            "traders": " / ".join(t for t, _ in traders.most_common()),
        } for name, n, qty, traders in rows],
    }


def count_item_rows_in_page() -> int:
    """数 quests/index.md 的「物品需求反查」表实际写了多少行。"""
    if not QUEST_INDEX.exists():
        return -1
    text = QUEST_INDEX.read_text(encoding="utf-8")
    if gi.START not in text or gi.END not in text:
        return -1
    block = text.split(gi.START, 1)[1].split(gi.END, 1)[0]
    if "### 物品需求反查" not in block:
        return -1
    sub = block.split("### 物品需求反查", 1)[1].split("###", 1)[0]

    rows = []
    for line in sub.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        body = s.strip("|")
        if not body.strip():
            continue
        cells = [c.strip() for c in body.split("|")]
        # ⚠️ 判「分隔行」必须**先切单元格**再逐个判：
        #    只对整行做 `all(ch in "-: ")` 会因为内部还留着 `|` 而判否，
        #    于是 `|------|------|` 被当成一条数据（实测多算 1 行）。
        if all(c == "" or set(c) <= set("-:") for c in cells):
            continue
        rows.append(cells)
    if rows and rows[0] and rows[0][0] == "物品":   # 去掉表头
        rows = rows[1:]
    return len(rows)


# ---------------------------------------------------------------------------
# ③ 藏身处
# ---------------------------------------------------------------------------

def build_hideout() -> dict:
    return {
        "total": len(HIDEOUT_MODULES),
        "layers": LAYER_ORDER,
        "list": [{"name": n, "layer": layer, "max": mx}
                 for n, layer, mx, _tok in HIDEOUT_MODULES],
    }


def read_layer_tokens() -> list[str] | None:
    """从 §1 分层表的「模块」列取出模块写法（按 、 切分）。

    返回 None 表示页面结构变了、取不到 —— 那种情况按错误处理，不静默放过。
    """
    if not HIDEOUT_PAGE.exists():
        return None
    text = HIDEOUT_PAGE.read_text(encoding="utf-8")
    if "### 1." not in text or "### 2." not in text:
        return None
    sec = text.split("### 1.", 1)[1].split("### 2.", 1)[0]
    tokens: list[str] = []
    for line in sec.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] in ("层", ""):
            continue
        if all(ch in "-: " for ch in cells[0]):
            continue
        if not cells[0].startswith("**"):
            continue
        for part in cells[1].split("、"):
            part = part.strip()
            if part:
                tokens.append(part)
    return tokens or None


# ---------------------------------------------------------------------------

def main() -> int:
    if not g.DATA_FILE.exists():
        print(f"[错误] 找不到 {g.DATA_FILE}，先跑一次 gen_quests.py --fetch", file=sys.stderr)
        return 1

    payload = json.loads(g.DATA_FILE.read_text(encoding="utf-8"))
    tasks = payload.get("tasks") or []
    if not tasks:
        print("[错误] quests.json 里没有 tasks", file=sys.stderr)
        return 1

    quests, quest_total = build_quests(tasks)
    items = build_items(tasks)
    hideout = build_hideout()

    body = json.dumps({
        "generated": date.today().isoformat(),
        "source": "scripts/data/quests.json（json.tarkov.dev/regular，持久 PvP）"
                  " + content/entries/hideout-modules.md",
        "baseline": g.FETCH_DATE,
        "total": quests["total"],
        "traders": quests["traders"],
        "items": items,
        "hideout": hideout,
    }, ensure_ascii=False, indent=2)

    header = (
        "/* 由 scripts/gen_progress_manifest.py 生成，请勿手工编辑。\n"
        "   用途：「我的进度」三条轨的只读分母与列表（任务 / 物品收集 / 藏身处）。\n"
        "   数据源与 content/quests/*.md、content/entries/hideout-modules.md 同源，\n"
        "   重抓数据或改动藏身处页后，要重跑本脚本。 */\n"
    )
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(header + "window.TARKOV_PROGRESS_MANIFEST = " + body + ";\n",
                        encoding="utf-8", newline="\n")
    print(f"已写 {OUT_FILE.relative_to(g.ROOT)}："
          f"任务 {quests['total']} / 商人 {len(quests['traders'])}；"
          f"物品 {items['total']}（≥{ITEM_THRESHOLD} 个任务）；"
          f"藏身处 {hideout['total']} 个模块")

    # —— 对账 ——
    problems: list[str] = []

    page_total, page_uniq = count_page_qids()
    if page_total != quest_total:
        problems.append(f"任务页 data-qid 出现 {page_total} 次，清单合计 {quest_total}")
    if page_uniq != quest_total:
        problems.append(f"任务页唯一 data-qid {page_uniq} 个，清单合计 {quest_total}")

    item_rows = count_item_rows_in_page()
    if item_rows < 0:
        problems.append("读不到 quests/index.md 的「物品需求反查」表（AUTO-GEN 标记或小节标题变了？）")
    elif item_rows != items["total"]:
        problems.append(f"「物品需求反查」表有 {item_rows} 行，清单 {items['total']} 条")

    hut_text = HIDEOUT_PAGE.read_text(encoding="utf-8") if HIDEOUT_PAGE.exists() else ""
    if not hut_text:
        problems.append("读不到 content/entries/hideout-modules.md")
    else:
        nhut = norm(hut_text)
        for n, _layer, _mx, _tok in HIDEOUT_MODULES:
            if norm(n) not in nhut:
                problems.append(f"藏身处模块「{n}」在 hideout-modules.md 里找不到")

        tokens = read_layer_tokens()
        if tokens is None:
            problems.append("读不到 hideout-modules.md §1 分层表的模块列")
        else:
            mine = [t for _n, _l, _m, t in HIDEOUT_MODULES if t]
            if sorted(norm(t) for t in tokens) != sorted(norm(t) for t in mine):
                extra = [t for t in tokens if norm(t) not in {norm(x) for x in mine}]
                missing = [t for t in mine if norm(t) not in {norm(x) for x in tokens}]
                problems.append(
                    "§1 分层表与清单不一致："
                    + (f"页面多 {extra} " if extra else "")
                    + (f"清单多 {missing}" if missing else ""))

    if problems:
        print("[错误] 清单与页面/数据对不上：", file=sys.stderr)
        for p in problems:
            print(f"  · {p}", file=sys.stderr)
        print("  处理：先跑 python scripts/gen_quests.py 重建任务页，"
              "再跑 python scripts/gen_quest_items.py，最后跑本脚本。", file=sys.stderr)
        return 1

    print(f"对账通过：任务 data-qid {page_total} 处 / 唯一 {page_uniq} 个；"
          f"物品表 {item_rows} 行；藏身处 §1 模块 {len(read_layer_tokens() or [])} 个。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
