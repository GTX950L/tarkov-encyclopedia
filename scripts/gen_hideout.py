"""藏身处数据层与材料清单生成器。

    python scripts/gen_hideout.py --fetch   # 抓 json.tarkov.dev 并精简，写 scripts/data/hideout.json
    python scripts/gen_hideout.py           # 读 scripts/data/hideout.json，生成 hideout-modules.md 的材料区块

为什么要单独一个脚本（而不是并进 gen_quests.py）：
    数据源不同（这里多要 hideout / hideout_zh 两个端点）、产物不同（这里是**一个页面的一个区块**，
    不是 12 个整页）、重建时机也不同。但**译名与清洗规则一律复用 gen_quests**：
    物品名走同一套 `items_zh[<id> Name] → ShortName`，查不到就空着、绝不把十六进制 id 印进正文。

译名口径（本页最重要的一条决定）：
    模块名**以官方数据端点附带的 zh 译名为准**，与站内物品名同源同权威 ——
    这样页面、清单、进度数据里是**同一个字符串**，不存在「显示名 vs 数据名」的映射表，
    也就没有新的漂移源。旧写法（生成器 / 水收集器 / 私酒厂 …）作为**别名**并列在模块总表里，
    搜索仍能命中。见 ALIASES。

产物：
    scripts/data/hideout.json                              （精简数据，供 manifest 复用）
    content/entries/hideout-modules.md 里 AUTO-GEN 标记之间   （面向读者的材料清单）
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g  # noqa: E402  复用 API / HEADERS / quote_cn / one_line

ROOT = g.ROOT
DATA_FILE = ROOT / "scripts" / "data" / "hideout.json"
PAGE = ROOT / "content" / "entries" / "hideout-modules.md"

START = "<!-- AUTO-GEN:HIDEOUT-MATERIALS:START -->"
END = "<!-- AUTO-GEN:HIDEOUT-MATERIALS:END -->"

# 旧写法 → 官方 zh 名。只用于「别名」一列，让读者搜旧名也能找到；
# 数据与正文一律用官方名（见模块顶部说明）。
ALIASES = {
    "generator": "生成器", "water-collector": "水收集器", "nutrition-unit": "营养单元",
    "booze-generator": "私酒厂", "scav-case": "Scav 包裹", "cultist-circle": "十字路口 / 供奉",
    "gym": "健身房", "shooting-range": "射击场", "hall-of-fame": "名人堂", "heating": "加热器",
}

# 页面 §1 的承色层归属（页面自己的分类，不是数据端点的字段）。
# 这里显式登记，是为了让生成的材料清单能按「层」分组 —— 与页面 §1 同源。
LAYER_OF = {
    "generator": "地基层", "solar-power": "地基层",
    "water-collector": "生存层", "nutrition-unit": "生存层", "medstation": "生存层",
    "lavatory": "生存层", "rest-space": "生存层",
    "workbench": "生产层", "intelligence-center": "生产层", "air-filtering-unit": "生产层",
    "vents": "生产层",
    "bitcoin-farm": "收益层", "booze-generator": "收益层", "scav-case": "收益层",
    "cultist-circle": "收益层", "security": "收益层",
    "gym": "成长层", "shooting-range": "成长层", "library": "成长层", "hall-of-fame": "成长层",
}
LAYER_ORDER = ["地基层", "生存层", "生产层", "收益层", "成长层"]


def get(endpoint: str) -> dict:
    req = urllib.request.Request(g.API + endpoint, headers=g.HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def hours(sec: int) -> str:
    """施工时长：0 → 即时；否则压到「N 天 N 小时 / N 小时 / N 分钟」。"""
    if not sec:
        return "即时"
    d, rem = divmod(int(sec), 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    parts = []
    if d:
        parts.append(f"{d} 天")
    if h:
        parts.append(f"{h} 小时")
    if m and not d:
        parts.append(f"{m} 分钟")
    return " ".join(parts) or "即时"


# ─────────────────────────────────────────────────────────────────────────────
# 抓取
# ─────────────────────────────────────────────────────────────────────────────

def fetch() -> int:
    print("抓取中（hideout / hideout_zh / items_zh / tasks_zh）…")
    raw = get("hideout")["data"]
    hz = get("hideout_zh")["data"]
    items_zh = get("items_zh")["data"]

    def item_name(iid: str) -> str:
        v = items_zh.get(iid + " Name") or items_zh.get(iid + " ShortName")
        if not v:
            # 同 gen_quests 的规矩：查不到就空着，不把 id 印进中文正文
            miss["item"] += 1
            return ""
        return g.quote_cn(g.one_line(v))

    def zh(key: str) -> str:
        return g.quote_cn(g.one_line(hz.get(key, "") or ""))

    miss: dict[str, int] = {"item": 0, "station": 0}
    stations = []
    for sid, s in raw.items():
        nm = s.get("name") or ""
        name = zh(nm) or s.get("normalizedName", sid)
        if not zh(nm):
            miss["station"] += 1
        levels = []
        for lv in sorted(s.get("levels") or [], key=lambda x: x.get("level") or 0):
            items = []
            for it in lv.get("itemRequirements") or []:
                n = item_name(it.get("item") or "")
                if not n:
                    continue
                items.append({
                    "name": n,
                    "count": it.get("count") or 1,
                    "fir": bool((it.get("attributes") or {}).get("foundInRaid")),
                })
            items.sort(key=lambda x: (not x["fir"], -x["count"], x["name"]))
            levels.append({
                "level": lv.get("level"),
                "time": lv.get("constructionTime") or 0,
                "stations": [{"id": r.get("station"), "level": r.get("level")}
                             for r in (lv.get("stationLevelRequirements") or [])],
                "skills": [{"name": g.quote_cn(g.one_line(str(r.get("skill") or ""))),
                            "level": r.get("level")}
                           for r in (lv.get("skillRequirements") or [])],
                "items": items,
            })
        stations.append({
            "id": sid,
            "en": s.get("normalizedName") or sid,
            "name": name,
            "areaType": s.get("areaType"),
            "levels": levels,
        })

    # 站点名与依赖里的 station id 需要二次解析（依赖给的是 id，不是名字）
    byid = {s["id"]: s for s in stations}
    for s in stations:
        for lv in s["levels"]:
            for r in lv["stations"]:
                dep = byid.get(r.get("id"))
                r["name"] = dep["name"] if dep else ""
                r["en"] = dep["en"] if dep else ""
                r.pop("id", None)

    stations.sort(key=lambda s: s["en"])
    payload = {
        "fetched": date.today().isoformat(),
        "source": "json.tarkov.dev/regular（官方数据端点，二级）+ hideout_zh / items_zh（同一套译名）",
        "gameMode": "regular（持久 PvP）",
        "count": len(stations),
        "levelCount": sum(len(s["levels"]) for s in stations),
        "itemCount": sum(len(lv["items"]) for s in stations for lv in s["levels"]),
        "stations": stations,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=False),
                         encoding="utf-8", newline="\n")
    print(f"已写 {DATA_FILE.relative_to(ROOT)}：{payload['count']} 个站点 / "
          f"{payload['levelCount']} 个等级 / {payload['itemCount']} 条材料")
    if miss["item"] or miss["station"]:
        print(f"  [注意] 译名缺失：物品 {miss['item']} 条（已跳过，不印 id）、站点 {miss['station']} 个")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# 生成页面区块
# ─────────────────────────────────────────────────────────────────────────────

def render_module_table(stations: list[dict]) -> list[str]:
    L = ["| 模块 | 英文名 | 级数 | 层 | 曾用写法 |", "|------|--------|------|----|----------|"]
    for s in stations:
        alias = ALIASES.get(s["en"], "—")
        L.append(f"| **{s['name']}** | `{s['en']}` | {len(s['levels'])} 级 | "
                 f"{LAYER_OF.get(s['en'], '—')} | {alias} |")
    return L


def render_station(s: dict) -> list[str]:
    L = [f"**{s['name']}**（`{s['en']}`）", ""]
    for lv in s["levels"]:
        head = [f"{lv['level']} 级", f"施工 **{hours(lv['time'])}**"]
        if lv["stations"]:
            head.append("前置 " + "、".join(
                f"{r['name']} {r['level']} 级" for r in lv["stations"] if r.get("name")))
        if lv["skills"]:
            head.append("技能 " + "、".join(
                f"{r['name']} {r['level']} 级" for r in lv["skills"] if r.get("name")))
        L.append("**" + " ｜ ".join(head) + "**")
        L.append("")
        if lv["items"]:
            L.append("| 材料 | 数量 | 来源 |")
            L.append("|------|------|------|")
            for it in lv["items"]:
                L.append(f"| {it['name']} | ×{it['count']:,} | {'**战局中**' if it['fir'] else '可采购'} |")
        else:
            L.append("_该等级无材料要求。_")
        L.append("")
    return L


def generate() -> int:
    if not DATA_FILE.exists():
        print(f"[错误] 找不到 {DATA_FILE}，先跑一次 --fetch", file=sys.stderr)
        return 1
    d = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    stations = d.get("stations") or []
    if not stations:
        print("[错误] hideout.json 里没有 stations", file=sys.stderr)
        return 1

    out = [
        f"### 7. 逐级材料清单（{d['count']} 个模块 ｜ {d['levelCount']} 个等级）",
        "",
        f"> **口径**：{d['fetched']} 抓取 ｜ {d['gameMode']} ｜ 来源：{d['source']}",
        "> 「**战局中**」= 该材料必须由自己带出（跳蚤市场买的**不算数**）；「可采购」= 跳蚤市场买即可。",
        "> **模块名以数据端点附带的译名为准**，与站内物品名同一套译名体系；旧写法并列在总表里，搜索仍可命中。",
        "",
        "**模块总表**",
        "",
        *render_module_table(stations),
        "",
        "---",
        "",
    ]

    groups: list[str] = []
    by_layer: dict[str, list[dict]] = {}
    for s in stations:
        key = LAYER_OF.get(s["en"], "（页面未分层）")
        if key not in by_layer:
            by_layer[key] = []
            groups.append(key)
    for s in stations:
        by_layer[LAYER_OF.get(s["en"], "（页面未分层）")].append(s)
    order = LAYER_ORDER + ["（页面未分层）"]
    groups.sort(key=lambda x: order.index(x) if x in order else 99)

    for layer in groups:
        out += [f"**{layer}**", ""]
        for s in by_layer[layer]:
            out += render_station(s)
        out += ["---", ""]

    out += [
        "> **关于本节的来源等级**：材料与施工时长取自**官方数据端点**（二级），逐级随版本调整；"
        "而上一节 §3 的「标志性数值」取自英文 EFT Wiki（同为二级），两者可能**不同步更新**，"
        "引用时请分别注明。",
        "",
    ]

    block = "\n".join(out).rstrip() + "\n"
    text = PAGE.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print(f"[错误] {PAGE.relative_to(ROOT)} 里找不到 AUTO-GEN 标记，"
              f"请先手动加上：\n{START}\n…\n{END}", file=sys.stderr)
        return 1
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    PAGE.write_text(f"{head}{START}\n\n{block}\n{END}{tail}", encoding="utf-8")
    print(f"已写入 {PAGE.relative_to(ROOT)}：{len(stations)} 个模块的材料清单"
          f"（{d['levelCount']} 个等级 / {d['itemCount']} 条材料）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="藏身处数据层与材料清单生成器")
    ap.add_argument("--fetch", action="store_true", help="先从 json.tarkov.dev 抓取并精简数据")
    a = ap.parse_args()
    return fetch() if a.fetch else generate()


if __name__ == "__main__":
    raise SystemExit(main())
