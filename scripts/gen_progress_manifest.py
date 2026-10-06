"""进度清单生成器 —— 为「我的进度」提供三份只读分母/列表：任务、物品收集、藏身处。

    python scripts/gen_progress_manifest.py

为什么单独一个小脚本，而不并进 gen_quests.py：
    gen_quests.py 的产物是 12 个面向读者的任务页，带「整栏重建」语义、动辄重写
    几百 KB 正文。本清单只是前端一个只读常量，重建时机与页面完全不同。
    但清单**不自己发明数据**：商人标签从 gen_quests 导入、物品口径从
    gen_quest_items 导入、藏身处数据直接读 gen_hideout 的产物。

依赖顺序（改了任一项都要按序重跑）：
    gen_quests.py            → content/quests/*.md（data-qid）
    gen_quest_items.py       → content/quests/index.md（物品需求反查表）
    gen_hideout.py --fetch   → scripts/data/hideout.json
    gen_hideout.py           → content/entries/hideout-modules.md（§7 材料清单）
    gen_progress_manifest.py → content/javascripts/progress-manifest.js

产物：content/javascripts/progress-manifest.js
    window.TARKOV_PROGRESS_MANIFEST = { generated, source, baseline,
                                        total, traders, items, hideout }

本脚本存在的一半理由是**三道对账**（对不上就退出码 1，卡住 CI）：
    ① 任务：清单合计 == content/quests/*.md 里 data-qid 的出现次数与唯一数；
    ② 物品：清单条数 == quests/index.md 的「物品需求反查」表行数；
    ③ 藏身处：清单条数 == scripts/data/hideout.json 的站点数，
       且**每个模块名都能在 hideout-modules.md 找到**、
       该页 §7 的「模块总表」行数与清单条数相等。
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
import gen_hideout as gh        # noqa: E402  复用藏身处数据文件 / 分层 / 别名

OUT_FILE = g.ROOT / "content" / "javascripts" / "progress-manifest.js"
GRAPH_FILE = g.ROOT / "content" / "javascripts" / "quests-graph.js"
DETAIL_DIR = g.ROOT / "content" / "javascripts"
QUEST_INDEX = g.ROOT / "content" / "quests" / "index.md"
HIDEOUT_PAGE = gh.PAGE
GRAPH_SRC = g.ROOT / "scripts" / "data" / "quest-graph.json"

QID_RE = re.compile(r'data-qid="([0-9a-f]{24})"')
# 任务标题：`<h3 id="q07" data-qid="…">` —— 同时抓锚点与数据 id，
# 用来给前置树里的每个节点生成「直达该任务明细」的链接。
HEAD_RE = re.compile(r'<h3 id="(q\d+)" data-qid="([0-9a-f]{24})"')

# 与「物品需求反查」表同一口径：被 ≥3 个任务需要的物品
ITEM_THRESHOLD = 3


def norm(s: str) -> str:
    """对账用的宽松比较：去掉所有空白。"""
    return re.sub(r"\s+", "", s or "")


# ---------------------------------------------------------------------------
# ① 任务
# ---------------------------------------------------------------------------

def build_quests(tasks: list[dict]) -> dict:
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
    return {"total": sum(t["count"] for t in traders), "traders": traders}


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
        # 说明写在数据里，前端直接取用 —— 免得措辞在两处各写一遍。
        "note": f"「任务数」是有多少个任务需要它；「合计数量」是这些任务要求的**总件数**（跨任务求和，"
                f"不是单次需求）。只列被 {ITEM_THRESHOLD} 个及以上任务需要的物品。",
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
    return count_md_table_rows(sub, drop_header="物品")


def count_md_table_rows(sub: str, drop_header: str | None = None,
                        first_table_only: bool = False) -> int:
    """数一段 Markdown 里的表格数据行。

    ⚠️ 判「分隔行」必须**先切单元格再逐个判**：只对整行做 `all(ch in "-: ")`
    会因为去掉外框竖线后内部还留着 `|` 而判否，把 `|------|------|` 当成一条数据。
    """
    rows = []
    started = False
    for line in sub.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            if first_table_only and started:
                break
            continue
        body = s.strip("|")
        if not body.strip():
            continue
        cells = [c.strip() for c in body.split("|")]
        if all(c == "" or set(c) <= set("-:") for c in cells):
            started = True
            continue
        started = True
        rows.append(cells)
    if drop_header and rows and rows[0] and rows[0][0] == drop_header:
        rows = rows[1:]
    return len(rows)


# ---------------------------------------------------------------------------
# ③ 藏身处（数据来自 gen_hideout 的产物，本脚本不自己编）
# ---------------------------------------------------------------------------

def build_hideout() -> tuple[dict, dict]:
    raw = json.loads(gh.DATA_FILE.read_text(encoding="utf-8"))
    stations = raw.get("stations") or []
    out = []
    for s in stations:
        out.append({
            "en": s["en"],
            "name": s["name"],
            "layer": gh.LAYER_OF.get(s["en"], None),
            "alias": gh.ALIASES.get(s["en"], None),
            "levels": s["levels"],
        })
    # 层的展示顺序照搬页面的 §1
    out.sort(key=lambda x: (gh.LAYER_ORDER.index(x["layer"]) if x["layer"] in gh.LAYER_ORDER else 99,
                            x["en"]))
    return {
        "total": len(out),
        "levelCount": raw.get("levelCount"),
        "itemCount": raw.get("itemCount"),
        "source": raw.get("source"),
        "baseline": raw.get("fetched"),
        "note": "「材料」是该等级需要的建材与数量；「战局中」标记的必须自己带出，跳蚤市场买的不算数。",
        "list": out,
    }, raw


# ---------------------------------------------------------------------------
# ④ 任务前置树（供「按前置反推已完成」用）
#
# 为什么不塞进 progress-manifest.js：
#     那张清单在**全部 118 个页面**上都会被加载（extra_javascript 是全局的），
#     而前置树只有「我的进度」页用得到。它约 45 KB，塞进去会让每页都多背一份。
#     所以单独一个文件，由 progress.js 在需要时**动态注入 <script>**（懒加载）。
# 为什么必须用 id 连边而不是名字：
#     515 个任务里有 10 个名字重复（涉及 23 条记录），按名字连边会连错。
# ---------------------------------------------------------------------------

STATUS_FLAG = {"complete": "c", "active": "a", "failed": "f"}

# 「出发前准备」只看这些目标类型里的物品 —— 它们是**要带 / 要找**的。
# `sellItem` 是「卖任何物品给某商人」的许可白名单（不是需求），排除；
# 与 gen_quest_items.py 的口径一致。
PREP_TYPES = {"giveItem", "findItem", "findQuestItem", "giveQuestItem",
              "plantItem", "plantQuestItem", "useItem"}


def _other_req_text(r: dict) -> str:
    """把 otherReqs 的条目写成一句人能读的中文。

    这些是**无法用「前置任务完成」表达**的门槛 —— 例：跨任务的累计计数器
    （"Mechanic 的计数器 ≥ 3"）、需要与商人对话。本站算不出来，但必须让读者
    知道「这里还有别的条件」。
    """
    kind = r.get("kind") or ""
    trader = r.get("trader") or ""
    if not trader and r.get("traders"):
        trader = "、".join(r["traders"])
    cmp_ = r.get("cmp") or ">="
    val = r.get("value")
    if kind == "counter":
        return f"{trader} 计数器 {cmp_} {val}"
    if kind == "dialogue":
        return f"需与 {trader} 对话"
    if kind == "level":
        return f"{trader} 等级要求 {cmp_} {val}"
    if kind == "reputation":
        return f"{trader} 声望 {cmp_} {val}"
    if kind == "achievement":
        return "需先达成某项成就"
    return f"{kind or '其他条件'}{('（' + trader + '）') if trader else ''}"


def build_graph(tasks: list[dict]) -> int:
    if not GRAPH_SRC.exists():
        print(f"[错误] 找不到 {GRAPH_SRC}，先跑一次 gen_quest_graph.py --fetch", file=sys.stderr)
        return -1
    raw = json.loads(GRAPH_SRC.read_text(encoding="utf-8"))
    edges = raw.get("edges") or {}
    obj_ids = raw.get("objectives") or {}

    # 任务 id → "商人slug#锚点"，供前端直接链到任务明细
    anchor: dict[str, str] = {}
    dup = []
    for md in sorted(g.OUT_DIR.glob("*.md")):
        slug = md.stem
        for a, qid in HEAD_RE.findall(md.read_text(encoding="utf-8")):
            if qid in anchor:
                dup.append(qid)
                continue
            anchor[qid] = f"{slug}#{a}"

    nodes = {}
    detail: dict[str, dict] = {}
    for t in tasks:
        tid = t.get("id")
        if not tid:
            continue
        flags = ("k" if t.get("kappa") else "") + ("l" if t.get("lightkeeper") else "")
        pre = []
        for pid, sts in (edges.get(tid) or []):
            flag = "".join(STATUS_FLAG.get(s, "") for s in sts)
            pre.append([pid, flag])

        # 门槛：商人忠诚度 / 阵营 / 转生 / 其他隐藏条件
        g_traders = [[(r.get("trader") or ""), (r.get("kind") or "level"),
                      (r.get("cmp") or ">="), r.get("value") or 0]
                     for r in (t.get("traderReqs") or [])]
        oth = []
        for r in (t.get("otherReqs") or []):
            txt = _other_req_text(r)
            if txt and txt not in oth:
                oth.append(txt)
        gates = {}
        if g_traders:
            gates["t"] = g_traders
        if t.get("faction"):
            gates["f"] = t["faction"]
        if t.get("prestige"):
            gates["p"] = t["prestige"]
        if oth:
            gates["o"] = oth

        # 出发前准备：从目标里聚合「要带 / 要找」的物品（按名字合并数量）
        # 目标 id 来自边表（渲染缓存**故意没留** id）；两边靠**下标**对齐，
        # 条数相等由 gen_quest_graph.py 与本函数末尾各校验一次。
        ids_for_task = obj_ids.get(tid) or []
        prep_map: dict[str, list] = {}
        obj_detail = []
        for oi, o in enumerate(t.get("objectives") or []):
            oid = ids_for_task[oi] if oi < len(ids_for_task) else ""
            if oid:
                obj_detail.append([oid, o.get("text") or "",
                                   o.get("count") or 0, 1 if o.get("fir") else 0])
            if (o.get("type") or "") in PREP_TYPES:
                n = o.get("count") or 1
                for nm in (o.get("items") or []):
                    if not nm:
                        continue
                    cur = prep_map.get(nm)
                    if cur:
                        cur[1] += n
                        cur[2] = cur[2] or bool(o.get("fir"))
                    else:
                        prep_map[nm] = [nm, n, bool(o.get("fir"))]
            for nm in (o.get("keys") or []):
                if nm and nm not in prep_map:
                    prep_map[nm] = [nm, 1, False]
        prep = [prep_map[k] for k in prep_map]
        prep.sort(key=lambda x: (not x[2], -x[1], x[0]))

        # 紧凑数组而不是对象：515 条 × 8 个字段，对象写法会白白多背一半体积
        nodes[tid] = [
            t.get("name") or "", t.get("trader") or "", t.get("level") or 0,
            pre, flags, anchor.get(tid, ""),
            gates,
            t.get("map") or "",
        ]
        if obj_detail or prep:
            detail[tid] = {"o": obj_detail, "p": prep}

    body = json.dumps({
        "generated": date.today().isoformat(),
        "source": raw.get("source"),
        "baseline": raw.get("fetched"),
        # ⚠️ 这是**上游数据源自带的状态词频**（该任务在数据端点里被标成
        # complete/active/failed 的条数），**与本站的 flags 字段毫无关系**——
        # flags 是站内加的 Kappa(k) / Lightkeeper(l) 标记。两个字段都叫「状态」，
        # 读代码时极易误认为对应，故在此显式留名。
        "srcStatusVocab": raw.get("statusVocab"),
        "total": len(nodes),
        # 字段顺序写在这里，客户端按下标读 —— 紧凑格式的代价是这一句必须准确
        "cols": ["name", "trader", "level", "prereqs", "flags", "link", "gates", "map"],
        "tasks": nodes,
    }, ensure_ascii=False, separators=(",", ":"))

    header = (
        "/* 由 scripts/gen_progress_manifest.py 生成，请勿手工编辑。\n"
        "   任务树（核心）：id → [中文名, 商人, 等级, [[前置id,标记],…], 标记, 页内链接, 门槛, 地图]。\n"
        "   前置标记 c=complete a=active f=failed；只有 c 用于「可接」判定。\n"
        "   门槛 gates = { t:[[商人,kind,cmp,value],…], f:阵营, p:转生, o:[其他条件文本] }。\n"
        "     其中 kind=level 是商人忠诚度（1–4），kind=reputation 是商人声望。\n"
        "     **Fence 用负值声望**，与 LL 不是一把尺 —— 客户端只在 gates.fence 填了值时\n"
        "     才参与 reputation 判定，未填按「未知」处理成提示，不阻断也不放行。\n"
        "   标记 flags 是**站内**加的 Kappa(k) / Lightkeeper(l)，与 srcStatusVocab 无关。\n"
        "   srcStatusVocab 是**上游数据源自带的状态词频**，不是站内状态，别与 flags 混读。\n"
        "   等级为 0 表示数据源没给解锁等级，不是「有个 0 级任务」。\n"
        "   目标明细与出发前准备在 quests-detail.js —— 那份**只在展开任务/打开准备清单时**才载。\n"
        "   本文件**不进 extra_javascript** —— 由 progress.js 在进度页动态注入。 */\n"
    )
    GRAPH_FILE.write_text(header + "window.TARKOV_QUEST_GRAPH = " + body + ";\n",
                          encoding="utf-8", newline="\n")

    # 明细**按商人分块**：展开一个任务只需要它所属商人的那一块。
    # 不切的话，点开任何一个任务都要拉整份 180+ KB —— 而「看一眼某个任务的目标」
    # 是这一页最高频的动作，不该为它付全量体积。
    by_slug: dict[str, dict] = {}
    for tid, d in detail.items():
        link = nodes.get(tid, [None, None, None, None, None, ""])[5]
        slug = link.split("#")[0] if link else "_"
        by_slug.setdefault(slug or "_", {})[tid] = d

    for slug, chunk in sorted(by_slug.items()):
        f = DETAIL_DIR / f"quests-detail-{slug}.js"
        cbody = json.dumps({"cols": ["objectives", "prep"], "tasks": chunk},
                           ensure_ascii=False, separators=(",", ":"))
        cheader = (
            "/* 由 scripts/gen_progress_manifest.py 生成，请勿手工编辑。\n"
            f"   任务明细分块（商人 = {slug}）：id → {{ o:[目标…], p:[准备项…] }}。\n"
            "   objectives: [[目标id, 目标文本, 数量, 是否战局中], …]；"
            "prep: [[物品名, 数量, 是否必须战局中带出], …]。\n"
            "   按商人分块是为了让「展开一个任务」只付那一块的体积。 */\n"
        )
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(cheader + f"window.TARKOV_QUEST_DETAIL = window.TARKOV_QUEST_DETAIL || {{}};\n"
                              f"window.TARKOV_QUEST_DETAIL[{json.dumps(slug)}] = " + cbody + ";\n",
                     encoding="utf-8", newline="\n")

    n_obj = sum(len(v["o"]) for v in detail.values())
    n_prep = sum(len(v["p"]) for v in detail.values())
    n_gate = sum(1 for v in nodes.values() if v[6])
    print(f"已写 {GRAPH_FILE.relative_to(g.ROOT)}（{GRAPH_FILE.stat().st_size/1024:.0f} KB）："
          f"{len(nodes)} 个节点、{sum(len(v[3]) for v in nodes.values())} 条前置边、"
          f"{n_gate} 条带门槛")
    biggest = max(by_slug.items(), key=lambda kv: len(kv[1])) if by_slug else ("-", {})
    print(f"已写 {DETAIL_DIR.relative_to(g.ROOT)}/quests-detail-*.js：{len(by_slug)} 块、"
          f"{len(detail)} 个任务有明细、{n_obj} 个目标、{n_prep} 条准备项"
          f"（最大块 {biggest[0]} {len(biggest[1])} 条 / "
          f"{(DETAIL_DIR / ('quests-detail-' + biggest[0] + '.js')).stat().st_size/1024:.0f} KB）")

    # 对账：节点 id 集合、边两端、锚点唯一性、目标数、门槛与明细的来源
    problems = []
    ids = set(nodes.keys())
    if len(ids) != len(tasks):
        problems.append(f"图节点 {len(ids)} 个，任务缓存 {len(tasks)} 条（id 有重复？）")
    dangling = sorted({p for v in nodes.values() for p, _f in v[3]} - ids)
    if dangling:
        problems.append(f"{len(dangling)} 条前置边的目标不在图里：{dangling[:3]}")
    if dup:
        problems.append(f"{len(dup)} 个任务在任务页里出现了两次（锚点不唯一）")
    noanchor = [k for k, v in nodes.items() if not v[5]]
    if noanchor:
        problems.append(f"{len(noanchor)} 个任务在 content/quests/*.md 里找不到锚点：{noanchor[:3]}")
    if len(anchor) != len(nodes):
        problems.append(f"任务页里的锚点共 {len(anchor)} 个，图节点 {len(nodes)} 个")
    want_obj = {t["id"]: len(t.get("objectives") or []) for t in tasks}
    got_obj = {k: len(v["o"]) for k, v in detail.items()}
    bad_obj = [k for k in ids if got_obj.get(k, 0) != want_obj.get(k, 0)]
    if bad_obj:
        problems.append(f"{len(bad_obj)} 个任务的目标明细数与缓存不符：{bad_obj[:3]}")
    if n_obj != sum(want_obj.values()):
        problems.append(f"目标明细共 {n_obj} 个，缓存合计 {sum(want_obj.values())} 个")
    if n_gate != sum(1 for t in tasks if t.get("traderReqs") or t.get("faction")
                     or t.get("prestige") or t.get("otherReqs")):
        problems.append("带门槛的节点数与缓存不符（traderReqs/faction/prestige/otherReqs）")
    if problems:
        print("[错误] 前置树与任务页/缓存对不上：", file=sys.stderr)
        for p in problems:
            print(f"  · {p}", file=sys.stderr)
        return -1
    return len(ids)


# ---------------------------------------------------------------------------

def main() -> int:
    if not g.DATA_FILE.exists():
        print(f"[错误] 找不到 {g.DATA_FILE}，先跑一次 gen_quests.py --fetch", file=sys.stderr)
        return 1
    if not gh.DATA_FILE.exists():
        print(f"[错误] 找不到 {gh.DATA_FILE}，先跑一次 gen_hideout.py --fetch", file=sys.stderr)
        return 1

    payload = json.loads(g.DATA_FILE.read_text(encoding="utf-8"))
    tasks = payload.get("tasks") or []
    if not tasks:
        print("[错误] quests.json 里没有 tasks", file=sys.stderr)
        return 1

    quests = build_quests(tasks)
    items = build_items(tasks)
    hideout, hut_raw = build_hideout()
    graph_n = build_graph(tasks)
    if graph_n < 0:
        return 1

    body = json.dumps({
        "generated": date.today().isoformat(),
        "source": "scripts/data/quests.json（json.tarkov.dev/regular，持久 PvP）"
                  " + scripts/data/hideout.json（同源，含 hideout_zh / items_zh 译名）",
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
        "   重抓数据或改动藏身处页后，要按脚本头部写的顺序重跑。 */\n"
    )
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(header + "window.TARKOV_PROGRESS_MANIFEST = " + body + ";\n",
                        encoding="utf-8", newline="\n")
    kb = OUT_FILE.stat().st_size / 1024
    print(f"已写 {OUT_FILE.relative_to(g.ROOT)}（{kb:.0f} KB）："
          f"任务 {quests['total']} / 商人 {len(quests['traders'])}；"
          f"物品 {items['total']}（≥{ITEM_THRESHOLD} 个任务）；"
          f"藏身处 {hideout['total']} 个模块 / {hideout['levelCount']} 个等级 / "
          f"{hideout['itemCount']} 条材料")

    # —— 对账 ——
    problems: list[str] = []

    page_total, page_uniq = count_page_qids()
    if page_total != quests["total"]:
        problems.append(f"任务页 data-qid 出现 {page_total} 次，清单合计 {quests['total']}")
    if page_uniq != quests["total"]:
        problems.append(f"任务页唯一 data-qid {page_uniq} 个，清单合计 {quests['total']}")

    item_rows = count_item_rows_in_page()
    if item_rows < 0:
        problems.append("读不到 quests/index.md 的「物品需求反查」表（AUTO-GEN 标记或小节标题变了？）")
    elif item_rows != items["total"]:
        problems.append(f"「物品需求反查」表有 {item_rows} 行，清单 {items['total']} 条")

    hut_pages = -1
    if not HIDEOUT_PAGE.exists():
        problems.append("读不到 content/entries/hideout-modules.md")
    else:
        text = HIDEOUT_PAGE.read_text(encoding="utf-8")
        nhut = norm(text)
        for s in hideout["list"]:
            if norm(s["name"]) not in nhut:
                problems.append(f"藏身处模块「{s['name']}」在 hideout-modules.md 里找不到")
        if gh.START not in text or gh.END not in text:
            problems.append("hideout-modules.md 里找不到 AUTO-GEN 标记")
        else:
            blk = text.split(gh.START, 1)[1].split(gh.END, 1)[0]
            if "**模块总表**" not in blk:
                problems.append("hideout-modules.md §7 里找不到「模块总表」")
            else:
                tbl = blk.split("**模块总表**", 1)[1]
                hut_pages = count_md_table_rows(tbl, drop_header="模块", first_table_only=True)

    if hut_pages >= 0 and hut_pages != hideout["total"]:
        problems.append(f"§7「模块总表」有 {hut_pages} 行，清单 {hideout['total']} 个模块")
    if hut_raw.get("count") != hideout["total"]:
        problems.append(f"hideout.json 站点数 {hut_raw.get('count')}，清单 {hideout['total']}")

    if problems:
        print("[错误] 清单与页面/数据对不上：", file=sys.stderr)
        for p in problems:
            print(f"  · {p}", file=sys.stderr)
        print("  处理：按脚本头部写的依赖顺序重跑一遍生成器。", file=sys.stderr)
        return 1

    print(f"对账通过：任务 data-qid {page_total} 处 / 唯一 {page_uniq} 个；"
          f"物品表 {item_rows} 行；藏身处 §7 模块总表 {hut_pages} 行；"
          f"前置树 {graph_n} 个节点。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
