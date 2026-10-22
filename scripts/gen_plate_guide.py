#!/usr/bin/env python3
"""生成《防弹插板选型》里的「材质横评 / 槽位族 / 逐款 / 预算分档」四张表。

数据链路同 scripts/gen_armor_values.py（**两级缓存**）：
  · 原始：scripts/data/items_full.json —— gen_items_catalog.py --fetch 抓的（**CI 会刷新它**）
  · 本页：scripts/data/plate_guide.json —— 本脚本从原始数据里切出的插板快照，**入仓**
  · 写入：**只替换 AUTO-GEN 标记之间的内容**，手写正文不动

⚠️ 为什么要多一层 `plate_guide.json`：CI 的 validate job 会在 ⑤c 之前跑
`gen_items_catalog.py --fetch`，**items_full.json 的价格会变**。若本脚本直接读它，
⑤c 重跑时产出的价格与仓库里的不一致 → 门禁红，而错不在产物、在数据源被上游刷新了。
切一层快照后，刷新是显式动作（`--refresh`），⑤c 看到的是稳定输入。

为什么插板要单独一页
--------------------
`armor-catalog.md` 里的「附加护甲」表把插板、面罩、护耳、护颈混在一张 117 行的
表里，只能回答「这块板多少级、多少耐久」。读者真正会踩的坑是另外两件事：

  ① **材质**：同为 6 级，陶瓷与超高分子量聚乙烯的「能用多久」差好几倍；
  ② **适配**：载体的插槽带白名单，跨族**根本装不上** —— 买到装不上的 6 级板，
     价值等于零。这一条在旧表里只有一句「适配关系以装备面板为准」。

这两件事都能从数据里机读出来，所以做成独立一页 + 生成表。

适配关系的判据
--------------
载体的 `properties.armorSlots[].allowedPlates` 是**插槽白名单**（板 id 列表），
`nameId` 区分前 / 后 / 侧（`Front_plate` / `Back_plate` / `Side_plate_*`）。
对每块板，把全部载体的白名单扫一遍，就能得到「这块板能进哪些载体、进哪个槽」。
⚠️ 口径：计数单位是**载体条目**（同型号不同配色各算一条），所以数字偏大属预期。

**不联网**：本脚本自己不抓任何端点。要从新数据重建快照，先跑
`gen_items_catalog.py --fetch`，再跑本脚本的 `--refresh`。
CI 的 ⑤c 门禁会重跑全部离线生成器，联网会把它变成不确定的步骤。

用法：
    python scripts/gen_plate_guide.py             # 用快照重生成（门禁用这条）
    python scripts/gen_plate_guide.py --refresh   # 从 items_full.json 重建快照后再生成
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _baseline import baseline_label  # noqa: E402  站点基线的唯一来源（citation.md）

RAW = ROOT / "scripts" / "data" / "items_full.json"
CACHE = ROOT / "scripts" / "data" / "plate_guide.json"
TARGET = ROOT / "content" / "entries" / "armor-plates.md"
START = "<!-- AUTO-GEN:PLATE-GUIDE:START -->"
END = "<!-- AUTO-GEN:PLATE-GUIDE:END -->"

# 商人 id → 站内称呼（与 gen_items_catalog.py 的 TRADERS 同源，改一处要改两处）
TRADERS = {
    "54cb50c76803fa8b248b4571": "Prapor",
    "54cb57776803fa99248b456e": "Therapist",
    "579dc571d53a0658a154fbec": "Therapist",
    "58330581ace78e27b8b10cee": "Skier",
    "5935c25fb3acc3127c3d8cd9": "Peacekeeper",
    "5a7c2eca46aef81a7ca2145d": "Mechanic",
    "5ac3b934156ae10c4430e83c": "Ragman",
    "5c0647fdd443bc2504c2d371": "Jaeger",
    "6617beeaa9cfa777ca915b7c": "竞技场裁判",
}

# 材质枚举 → 中文（与 gen_armor_values.py 的 MAT 同源）
MAT = {
    "Aramid": "芳纶",
    "Combined": "复合材料",
    "CombinedMaterials": "复合材料",
    "Titan": "钛",
    "Aluminium": "铝",
    "ArmorSteel": "装甲钢",
    "ArmoredSteel": "装甲钢",
    "Ceramic": "陶瓷",
    "Glass": "玻璃",
    "UHMWPE": "超高分子量聚乙烯",
    "None": "—",
}

# 材质 → (修复品质, 一句话定位)。**手写**，理由来自 armor-repair.md 的材质表与
# 本页实测的钝伤均值 —— 这两列是判断，不是数据，所以不进 json、只进模板。
MAT_NOTE = {
    "Ceramic": ("最低", "等级最容易堆高；耐久低、掉档快，**按消耗品用**"),
    "ArmoredSteel": ("高", "重、抗修、便宜；钝伤中等，**性价比路线**"),
    "UHMWPE": ("高", "同重量下最耐打的一类；钝伤偏高"),
    "Combined": ("低", "折中材质，样样不占优"),
    "Titan": ("偏低", "**钝伤穿透最低**的一档；价格与耐久都不突出"),
    "Aluminium": ("偏低", "耐久上限很低，只适合过渡"),
}

# 槽位族：由插板的 zones（防护区域标签）判定。键是排序后的 zones 元组。
FAMILY = {
    ("Armor Zone Plate_Granit_SAPI_back", "Armor Zone Plate_Granit_SAPI_chest"): ("SAPI 前后", "前 + 后"),
    ("Armor Zone Plate_Granit_SAPI_chest",): ("SAPI 前", "前"),
    ("Armor Zone Plate_Granit_SAPI_back",): ("SAPI 后", "后"),
    ("Armor Zone Plate_Korund_chest",): ("Korund 前", "前"),
    ("Armor Zone Plate_6B13_back",): ("6B13 后", "后"),
    (
        "Armor Zone Plate_Granit_SSAPI_side_left_high",
        "Armor Zone Plate_Granit_SSAPI_side_left_low",
        "Armor Zone Plate_Granit_SSAPI_side_right_high",
        "Armor Zone Plate_Granit_SSAPI_side_right_low",
    ): ("SSAPI 侧", "侧"),
    (
        "Armor Zone Plate_Korund_side_left_high",
        "Armor Zone Plate_Korund_side_left_low",
        "Armor Zone Plate_Korund_side_right_high",
        "Armor Zone Plate_Korund_side_right_low",
    ): ("Korund 侧", "侧"),
}

# 族的判读（手写）。按族名取，不按 zones 取 —— 族名是稳定标识。
FAMILY_NOTE = {
    "SAPI 前后": "白名单最宽，前后通用；**不知道买什么就买这族**",
    "SAPI 前": "只进前槽，适合给已有背板的载体补前板",
    "SAPI 后": "只进后槽，型号少但通用性尚可",
    "Korund 前": "只进俄系防弹衣的前槽，**跨族装不上**",
    "6B13 后": "只进少数俄系载体的后背槽，**最窄的一族**",
    "SSAPI 侧": "带侧槽的载体里通用性较好的一族",
    "Korund 侧": "只进俄系载体的侧槽，型号与载体都要对上",
}

SLOT_ORDER = ["前", "后", "侧"]


def clean(s: str) -> str:
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def pct(x, digits: int = 0) -> str:
    if x is None:
        return "—"
    v = x * 100
    return f"{v:.0f}%" if abs(v - round(v)) < 0.05 else f"{v:.1f}%"


def money(v: int) -> str:
    return f"{v:,}"


def rng(vals: list[int]) -> str:
    """区间写法：上下限相等时只写一个数（`4` 而不是 `4–4`）。"""
    lo, hi = min(vals), max(vals)
    return f"{lo}" if lo == hi else f"{lo}–{hi}"


def build_from_raw() -> dict:
    """从 items_full.json 切出插板快照（含适配计数与商人价）。"""
    d = json.loads(RAW.read_text(encoding="utf-8"))
    raw = d["items"]
    items = raw["items"]
    zh = d["zh"]
    fetched = d.get("fetched", "—")

    # 载体白名单：板 id → {槽位名 → {载体}}
    accepted: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for c in items.values():
        for slot in ((c.get("properties") or {}).get("armorSlots") or []):
            nid = slot.get("nameId") or ""
            if "plate" not in nid.lower():
                continue
            for pid in slot.get("allowedPlates") or []:
                accepted[pid][nid].add(c["normalizedName"])
                accepted[pid]["_all"].add(c["normalizedName"])

    plates: list[dict] = []
    for it in items.values():
        if "armorPlate" not in (it.get("types") or []):
            continue
        p = it.get("properties") or {}
        zones = tuple(sorted(p.get("zones") or []))
        fam, slot_txt = FAMILY.get(zones, ("未归档族", "—"))

        acc = accepted.get(it["id"], {})
        kind_map = {"Front": "前", "Back": "后", "Side": "侧", "Left": "侧", "Right": "侧"}
        kinds = {kind_map.get(k.split("_")[0]) for k in acc if k != "_all"}
        slot_kind = " / ".join(x for x in SLOT_ORDER if x in kinds) or slot_txt

        buys = [b for b in (it.get("buyFromTrader") or []) if b.get("priceRUB")]
        buy = None
        if buys:
            best = min(buys, key=lambda b: b["priceRUB"])
            buy = {
                "price": best["priceRUB"],
                "trader": TRADERS.get(best.get("trader"), "—"),
                "level": best.get("minTraderLevel"),
                "task": bool(best.get("taskUnlock")),
            }

        sells = [s for s in (it.get("sellToTrader") or []) if s.get("priceRUB")]
        sell = None
        if sells:
            top = max(sells, key=lambda s: s["priceRUB"])
            sell = {"price": top["priceRUB"], "trader": TRADERS.get(top.get("trader"), "—")}

        plates.append(
            {
                "id": it["id"],
                "name": clean(zh.get(it["id"] + " Name") or it.get("normalizedName") or it["id"]),
                "class": p.get("class"),
                "dur": p.get("durability"),
                "mat": MAT.get(p.get("material"), p.get("material") or "—"),
                "mat_en": p.get("material"),
                "w": it.get("weight") or 0.0,
                "blunt": p.get("bluntThroughput"),
                "speed": p.get("speedPenalty"),
                "turn": p.get("turnPenalty"),
                "ergo": p.get("ergoPenalty"),
                "family": fam,
                "slot_kind": slot_kind,
                "carriers": len(acc.get("_all", ())),
                "buy": buy,
                "sell": sell,
            }
        )
    plates.sort(key=lambda r: (-(r["class"] or 0), r["name"]))
    return {"fetched": fetched, "plates": plates}


def load_cache() -> dict:
    if not CACHE.exists():
        sys.exit(f"错误：找不到 {CACHE.relative_to(ROOT)} —— 先跑一次 --refresh。")
    return json.loads(CACHE.read_text(encoding="utf-8"))


def material_table(plates: list[dict]) -> list[str]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for p in plates:
        groups[p["mat"]].append(p)

    out = [
        "### 材质横评",
        "",
        "| 材质 | 板数 | 等级 | 平均耐久 | 平均钝伤 | 平均惩罚（移速 / 人机） | 修复品质 | 定位 |",
        "|------|------|------|----------|----------|------------------------------|----------|------|",
    ]
    for mat, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        cls = [r["class"] for r in rows if r["class"]]
        dur = [r["dur"] for r in rows if r["dur"]]
        blunt = [r["blunt"] for r in rows if r["blunt"] is not None]
        spd = [r["speed"] for r in rows if r["speed"] is not None]
        erg = [r["ergo"] for r in rows if r["ergo"] is not None]
        quality, note = MAT_NOTE.get(
            next((r["mat_en"] for r in rows if r["mat_en"]), ""), ("—", "—")
        )
        pen = "—"
        if spd or erg:
            s = f"{statistics.mean(spd) * 100:.1f}%" if spd else "—"
            e = f"{statistics.mean(erg) * 100:.1f}%" if erg else "—"
            pen = f"{s} / {e}"
        out.append(
            f"| **{mat}** | {len(rows)} | {rng(cls)} "
            f"| {round(statistics.mean(dur)) if dur else '—'} "
            f"| {pct(statistics.mean(blunt), 1) if blunt else '—'} "
            f"| {pen} | {quality} | {note} |"
        )
    out += [
        "",
        "> **怎么读**：**平均钝伤**是「未击穿时透到身体的伤害比例」，越低越吃亏少；"
        "**修复品质**来自[护甲修复与耐久](armor-repair.md)的材质表。"
        "等级范围与平均耐久是**本页 38 款躯干插板**的实测值，不是全站护甲口径。",
        "",
    ]
    return out


def family_table(plates: list[dict]) -> list[str]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for p in plates:
        groups[p["family"]].append(p)

    out = [
        "### 槽位族：板按族进槽",
        "",
        "| 槽位族 | 进哪个槽 | 板数 | 可进载体 | 代表板 | 判读 |",
        "|--------|----------|------|----------|--------|------|",
    ]
    for fam, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        carriers = [r["carriers"] for r in rows]
        priced = [r for r in rows if r["buy"]]
        rep = (
            min(priced, key=lambda r: (-(r["class"] or 0), r["buy"]["price"]))
            if priced
            else max(rows, key=lambda r: r["class"] or 0)
        )
        rep_txt = f"{rep['name']}（{rep['class']} 级）" if rep else "—"
        out.append(
            f"| **{fam}** | {rows[0]['slot_kind']} | {len(rows)} "
            f"| {rng(carriers)} | {rep_txt} | {FAMILY_NOTE.get(fam, '—')} |"
        )
    out += [
        "",
        "> **口径**：可进载体是**载体条目数**（同型号不同配色各算一条），所以数字偏大属预期；"
        "它为 0 表示数据端点里没有任何载体收这块板。"
        "**跨族装不上**——这是买插板最容易犯、也最贵的一次错误。",
        "",
    ]
    return out


def plate_table(plates: list[dict]) -> list[str]:
    def sort_key(r):
        priced = 0 if r["buy"] else 1
        return (-(r["class"] or 0), priced, r["buy"]["price"] if r["buy"] else 0, -(r["dur"] or 0))

    out = [
        f"### 逐款插板（{len(plates)} 款）",
        "",
        "| 插板 | 等级 | 材质 | 重量 | 耐久 | 槽位 | 可进载体 | 商人最低售价 | 商人最高回收 |",
        "|------|------|------|------|------|------|----------|--------------|--------------|",
    ]
    for r in sorted(plates, key=sort_key):
        if r["buy"]:
            who = f"{money(r['buy']['price'])} 卢布（{r['buy']['trader']}"
            if r["buy"]["level"]:
                who += f" {r['buy']['level']} 级"
            who += "）"
            if r["buy"]["task"]:
                who += " †"
        else:
            who = "—"
        sell = f"{money(r['sell']['price'])} 卢布（{r['sell']['trader']}）" if r["sell"] else "—"
        out.append(
            f"| {r['name']} | {r['class']} | {r['mat']} | {r['w']:.2f} 千克 | {r['dur']} "
            f"| {r['slot_kind']} | {r['carriers']} | {who} | {sell} |"
        )
    out += [
        "",
        "> **口径**：价格为**商人挂牌价/回收价**，取各商人最优，**不含跳蚤价**；"
        "同一级内按「有挂牌优先 → 价格升序」排。"
        "**†** 表示该报价在数据端点里带任务解锁条件（`taskUnlock`），站内未映射到任务名。",
        "",
    ]
    return out


def budget_table(plates: list[dict]) -> list[str]:
    tiers = [
        ("2 万以内", 0, 20_000),
        ("2–4 万", 20_000, 40_000),
        ("4 万以上", 40_000, 10**12),
    ]
    out = [
        "### 预算分档（只算商人挂牌）",
        "",
        "| 档位 | 板数 | 等级分布 | 代表板（前 / 后板优先，再按等级与价格） |",
        "|------|------|----------|------------------------------------------|",
    ]
    for label, lo, hi in tiers:
        rows = [p for p in plates if p["buy"] and lo <= p["buy"]["price"] < hi]
        if not rows:
            out.append(f"| **{label}** | 0 | — | 该档没有商人挂牌的板 |")
            continue
        cls = sorted({r["class"] for r in rows})
        rep = min(
            rows,
            key=lambda r: (
                0 if ("前" in r["slot_kind"] or "后" in r["slot_kind"]) else 1,
                -(r["class"] or 0),
                r["buy"]["price"],
            ),
        )
        rep_txt = (
            f"{rep['name']}（{rep['class']} 级 / {rep['mat']} / "
            f"{money(rep['buy']['price'])} 卢布，{rep['buy']['trader']}）"
        )
        out.append(f"| **{label}** | {len(rows)} | {'、'.join(f'{c} 级' for c in cls)} | {rep_txt} |")

    rest = [p for p in plates if not p["buy"]]
    top = max(rest, key=lambda r: (r["class"] or 0, r["dur"] or 0)) if rest else None
    rep_txt = f"{top['name']}（{top['class']} 级 / {top['mat']}）" if top else "—"
    out.append(f"| **商人无挂牌** | {len(rest)} | — | 最高一档：{rep_txt} |")
    out += [
        "",
        "> **提醒**：最后一档不是「拿不到」，而是**站内不收录固定渠道**——只能靠搜刮或跳蚤，"
        "两条路都不给稳定价格（判据见[战利品分布](loot.md)与[跳蚤定价与手续费](flea-pricing.md)）。",
        "",
    ]
    return out


def conclusions(plates: list[dict]) -> list[str]:
    out = ["### 速查结论", ""]
    for cls in (6, 5, 4, 3):
        rows = [p for p in plates if p["class"] == cls]
        priced = sorted([p for p in rows if p["buy"]], key=lambda r: r["buy"]["price"])
        if not rows:
            continue
        if not priced:
            out.append(f"- **{cls} 级**：共 {len(rows)} 款，**商人处一款都没有**，只能搜刮或走跳蚤。")
            continue
        b = priced[0]
        main = [p for p in priced if "前" in p["slot_kind"] or "后" in p["slot_kind"]]
        is_main = b in main
        out.append(
            f"- **{cls} 级**：共 {len(rows)} 款，商人有挂牌的 {len(priced)} 款。"
            f"最便宜是{b['name']}——{money(b['buy']['price'])} 卢布"
            f"（{b['buy']['trader']} {b['buy']['level']} 级）"
            + ("" if is_main else f"，但它是{b['slot_kind']}槽板") + "。"
        )
        if main and not is_main:
            m = main[0]
            out.append(
                f"  只算前 / 后板的话，最便宜是{m['name']}——{money(m['buy']['price'])} 卢布"
                f"（{m['buy']['trader']} {m['buy']['level']} 级）。"
            )

    ceramic = [p for p in plates if p["mat"] == "陶瓷"]
    steel = [p for p in plates if p["mat"] == "装甲钢"]
    if ceramic and steel:
        cd = statistics.mean([p["dur"] for p in ceramic])
        sd = statistics.mean([p["dur"] for p in steel])
        out.append(
            f"- **陶瓷 vs 装甲钢**：陶瓷 {len(ceramic)} 款、平均耐久 {round(cd)}；"
            f"装甲钢 {len(steel)} 款、平均耐久 {round(sd)}——**上限几乎一样**，"
            f"差别在修复品质：陶瓷最低、钢最高。买陶瓷买的是「这一局」，不是「这一季」。"
        )

    fam_groups: dict[str, list[dict]] = defaultdict(list)
    for p in plates:
        fam_groups[p["family"]].append(p)
    widest = max(fam_groups.items(), key=lambda kv: max(r["carriers"] for r in kv[1]))
    narrow = min(fam_groups.items(), key=lambda kv: min(r["carriers"] for r in kv[1]))
    out.append(
        f"- **族的宽度差**：{widest[0]}最多能进 {max(r['carriers'] for r in widest[1])} 个载体；"
        f"{narrow[0]}只进 {min(r['carriers'] for r in narrow[1])} 个。买错族，板就是块废铁。"
    )

    total = len(plates)
    priced_n = sum(1 for p in plates if p["buy"])
    out.append(
        f"- **供给面**：{total} 款插板里，只有 {priced_n} 款能在商人处买到，"
        f"其余 {total - priced_n} 款只有搜刮与跳蚤两条路。"
    )
    out.append("")
    return out


def render(plates: list[dict], fetched: str) -> str:
    out = [
        "## 📊 插板数值与适配表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 {baseline_label()}"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **本表收的是「躯干插板」**：图鉴[护甲插板](../catalog/gear-armor.md)分类共 39 款，"
        "扣掉 1 款头盔附加板（Ops-Core SLAAP），其余全部在此。"
        "头盔附加板、面罩、护颈护耳见[护甲与头盔选型指南](armor-catalog.md)的附加护甲表。",
        "",
    ]
    out += material_table(plates)
    out += family_table(plates)
    out += plate_table(plates)
    out += budget_table(plates)
    out += conclusions(plates)
    return "\n".join(out).rstrip() + "\n"


def write_section(block: str) -> None:
    if not TARGET.exists():
        sys.exit(f"错误：找不到 {TARGET.relative_to(ROOT)} —— 先建页面骨架再跑生成器。")
    text = TARGET.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 AUTO-GEN 标记。")
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    TARGET.write_text(f"{head}{START}\n\n{block}\n{END}{tail}", encoding="utf-8", newline="\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="从 items_full.json 重建快照（先跑 gen_items_catalog.py --fetch）")
    args = ap.parse_args()

    if args.refresh:
        data = build_from_raw()
        CACHE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                         encoding="utf-8", newline="\n")
        print(f"已刷新快照 {CACHE.relative_to(ROOT)}：{len(data['plates'])} 款插板"
              f"（数据抓取日 {data['fetched']}）")

    data = load_cache()
    plates = data["plates"]
    write_section(render(plates, data["fetched"]))
    priced = sum(1 for p in plates if p["buy"])
    print(f"已写入 {TARGET.relative_to(ROOT)}：插板 {len(plates)} 款（商人有挂牌 {priced} 款）")


if __name__ == "__main__":
    main()
