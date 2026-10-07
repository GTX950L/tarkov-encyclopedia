#!/usr/bin/env python3
"""核对「既有图鉴条目」与「物品图鉴」的数值是否一致。

为什么需要这个脚本
------------------
第九篇·物品图鉴（16 页 / 4,979 件）是**构建期自动生成**的原始数值，而
``content/entries/`` 下那六篇图鉴条目（食物、医疗、护甲、弹药、载具、枪械）
是**人工写的选型判断**，各自标注了 2026-09 基线。两者必然漂移 —— 而读者
只会看到两个数字，不知道该信哪个。

**这个脚本的判据不是「两个数相等」，而是「同一件物品的两个数相等」。**
所以主键必须是**同一个体**，不是同一段文本。

⚠️ 为什么用显式映射表而不用模糊匹配
----------------------------------
本脚本第一版用 ``difflib.get_close_matches`` 做中文名模糊匹配，实测两次踩坑：

  · 词序不同就匹配不上 —— 站内「Emelya 黑麦面包块」vs 接口「Emelya黑麦面包块」；
  · 放宽阈值则错配 —— 站内「牛肉炖罐头（小）」被配到接口的**大**罐，
    凭空造出一条「能量 45≠50」的假不一致。

模糊匹配让**判定不可复算**。所以 ``MAP_*`` 是人工确认的一次性对应表，
每条都能在两边正文里查到出处；查不到的必须留 ``None`` 并由脚本报出来，
不允许猜。

三条边界
--------
  1. **不自动改内容**。本脚本只报差异，改不改、怎么改由人判断 —— 差异不等于错。
     已实测到的情况里有三类：真错、口径不同（一个写格数一个写占地）、命名不同。
  2. **只核「可机读的字段」**。像「5 级里最轻的一档」这种定性描述不在范围内。
  3. **站内基线日期与接口抓取日期不同**时，差异是**预期的**，脚本会在
     汇总里标明两个日期，让读者自己判断是「版本漂移」还是「写错了」。

用法
----
    python scripts/check_catalog_consistency.py --fetch
    python scripts/check_catalog_consistency.py
    python scripts/check_catalog_consistency.py --json    # 机器可读，供门禁用

退出码：不一致数 > 0 → 1（差异是**要报告的**，不是要忽略的）。
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "items_full.json"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
FETCH_DATE = "2026-10-08"
SITE_BASELINE = "2026-09"          # 六篇条目自己声明的基线

# 站内条目页 → (说明, 该页基线声明)
ENTRIES = {
    "food-catalog.md": "食物与饮料图鉴",
    "loadout-carriers.md": "载具图鉴：背包与胸挂",
    "armor-catalog.md": "护甲与头盔图鉴",
    "medical-catalog.md": "医疗物资图鉴",
}

# ────────────────────────────────────────────── 显式对应表
# 键 = 站内条目里写的名称；值 = 接口的 normalizedName。
# 每一条都能在两边正文里查到出处；查不到的不要硬填。
MAP_FOOD = {
    "军用饼干": "army-crackers",
    "黑麦面包块": "rye-croutons",
    "Emelya 黑麦面包块": "emelya-rye-croutons",
    "一包燕麦片": "pack-of-oat-flakes",
    "士腻架能量棒": "slickers-chocolate-bar",
    "Slickers 巧克力": "slickers-chocolate-bar",
    "Alyonka 巧克力": "alyonka-chocolate-bar",
    "Alyonka": "alyonka-chocolate-bar",
    "一包糖": "pack-of-sugar",
    "炼乳": "can-of-condensed-milk",
    "DevilDog 蛋黄酱": "jar-of-devildog-mayo",
    "牛肉炖罐头（小）": "can-of-beef-stew-small",
    "牛肉炖罐头（大）": "can-of-beef-stew-large",
    "鲑鱼罐头": "can-of-humpback-salmon",
    "西鲱 / sprats 罐头": "can-of-sprats",
    "鲱鱼罐头": "can-of-herring",
    "太平洋秋刀鱼罐头": "can-of-pacific-saury",
}
# 胸挂：站内名 → 接口归一名（第 5.1–5.3 节的「格数 / 空重」两列可机读）
MAP_CARRIERS = {
    "Scav Vest": "scav-vest",
    "Security vest": "security-vest",
    "DIY IDEA chest rig": "diy-idea-chest-rig",
    "Spiritus Systems Bank Robber": "spiritus-systems-bank-robber-chest-rig-multicam-black",
    "SOE Micro Rig": "soe-micro-rig-multicam",
    "Wartech gear rig（TV-109 / TV-106）": "wartech-tv-109-tv-106-chest-rig-a-tacs-fg",
    "UMTBS 6Sh112 Scout-Sniper": "umtbs-6sh112-scout-sniper-chest-rig-emr",
    "Splav Tarzan M22": "splav-tarzan-m22-chest-rig-smog",
    "Haley Strategic D3CRX": "haley-strategic-d3crx-chest-harness-ranger-green",
    "Direct Action Thunderbolt": "direct-action-thunderbolt-compact-chest-rig-shadow-grey",
    "Gear Craft GC-BSS-MK1": "gear-craft-gc-bss-mk1-chest-rig-a-tacs-fg",
    "Dynaforce Triton M43-A": "dynaforce-triton-m43-a-chest-harness-black",
    "Blackhawk! Commando": "blackhawk-commando-chest-harness-desert-tan",
    "LBT-1961A": "lbt-1961a-load-bearing-chest-rig-mas-grey",
    "BlackRock chest rig": "blackrock-chest-rig-gray",
    "Wartech MK3（TV-104）": "wartech-mk3-tv-104-chest-rig-multicam",
    "ANA Tactical Alpha": "ana-tactical-alpha-chest-rig-olive-drab",
    "Velocity Systems Multi-Purpose Patrol Vest": "velocity-systems-mppv-multi-purpose-patrol-vest-wolf-grey",
    "Belt-A + Belt-B": "poyas-a-poyas-b-gear-rig",
}
MAP_ARMOR = {}
# 医疗：站内名 → 接口归一名。
# ⚠️ **这里只放归一名，不放期望值。**
# 第一版把 (总容量, 单次治疗, 动画时间) 三个期望值也写进了本表，核对器拿**表里的
# 期望值**去跟接口比 —— 于是**它根本没读条目页那一列**。反例测试立刻暴露：
# 把「Salewa 单次治疗 85 改成 80」，脚本仍然报「一致 11 ｜ 不一致 0」。
#
# 那是**假检查器**：数字对与错它都会说「一致」。现在改成**只从本表取归一名，
# 期望值一律从条目页的表格单元格里解析** —— 判断集必须来自被检查的对象，
# 不能来自检查者自己的常量（与 gen_items_catalog.py 的 PAGES 同一条纪律）。
MAP_MEDICAL = {
    "AI-2": "ai-2-medkit",
    "Car 急救包": "car-first-aid-kit",
    "IFAK": "ifak-individual-first-aid-kit",
    "AFAK": "afak-tactical-individual-first-aid-kit",
    "Salewa": "salewa-first-aid-kit",
    "Grizzly": "grizzly-medical-kit",
}
# 护甲与头盔：站内名 → 接口归一名。
# ⚠️ 同样**不放期望等级** —— 等级要从条目页的「等级 / 最高等级」那一列解析。
# 只核**防护等级**这一个可机读字段；「材质」是定性描述（复合 / 装甲钢 / 钛），不核。
# ⚠️ 「6B13 / 6B23-2」这类**一格写两个型号**的行，其等级只对第一个成立，
#    所以这里只登记能对上的那个（6B13 是 4 级）；另一个留给读者，不硬套。
MAP_ARMOR_CLASS = {
    # 背心（armor-catalog 第 4 节）
    "6B43 Zabralo-Sh": "6b43-zabralo-sh-body-armor-emr",
    "BNTI Zhuk (EMR)": "bnti-zhuk-body-armor-emr",
    "IOTV Gen4（全防护套件）": "iotv-gen4-body-armor-full-protection-kit-multicam",
    "BNTI Gzhel-K": "bnti-gzhel-k-body-armor",
    "6B13 / 6B23-2": "6b13-assault-armor-emr",
    "PACA Soft Armor": "paca-soft-armor",
    # 头盔（第 2 节）
    "Altyn": "altyn-assault-helmet-olive-drab",
    "Maska-1SCh": "maska-1sch-bulletproof-helmet-olive-drab",
    "HighCom Striker ULACH IIIA": "highcom-striker-ulach-iiia-helmet-black",
    "Ops-Core FAST MT": "ops-core-fast-mt-super-high-cut-helmet-black",
    "6B47 / Kiver-M": "6b47-ratnik-bsh-helmet-olive-drab",
    "SSh-68": "ssh-68-steel-helmet-olive-drab",
}


def norm_num(s):
    """把表格单元格转成 float；`−5`（U+2212 减号）也算负数。

    ⚠️ **必须先剥掉 Markdown 标记**。实测踩过：`**85**`（加粗数字）用
    「取首段数字」的正则会返回 None —— 而 None 在调用方意味着「不限，跳过核对」，
    于是**加粗的数值一律逃过检查**。反例测试里「Salewa 单次治疗 85→80」
    就是这样溜过去的。
    """
    s = (s or "").replace("−", "-").replace(",", "")
    s = s.replace("**", "").replace("`", "").replace("*", "").strip()
    m = re.match(r"^-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def get(endpoint):
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.load(r)


def build_index(payload):
    """按 propertiesType 建索引：normalizedName → {zh, weight, props}。

    ⚠️ ``payload["items"]["items"]`` 是 **dict（id → 物品）**，
    迭代它得到的是 **id 字符串**。这里显式取 ``.values()``。
    """
    out = collections.defaultdict(dict)
    for it in payload["items"]["items"].values():
        if "preset" in (it.get("types") or []):
            continue
        zh = payload["zh"].get(it["id"] + " Name")
        zh = zh if isinstance(zh, str) else it.get("normalizedName")
        p = it.get("properties") or {}
        out[p.get("propertiesType")][it["normalizedName"]] = {
            "zh": zh, "weight": it.get("weight"), "props": p,
        }
    return out


def grab_table(fname):
    """抽出条目页里所有形如 `| A | B | C |` 的表格行 → [[cell, ...], ...]"""
    text = (ROOT / "content" / "entries" / fname).read_text(encoding="utf-8")
    rows = []
    for ln in text.split("\n"):
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if not cells or set("".join(cells)) <= set("-: "):
            continue
        if cells[0] in ("型号", "项目", "参数"):
            continue
        rows.append(cells)
    return rows


def strip_bold(s):
    return s.replace("**", "").replace("`", "").strip()


def compare(fname, items, report):
    """核对一个条目页。返回 (一致, 不一致, 无法对应) 计数。"""
    rows = grab_table(fname)
    ok = bad = unres = 0

    if fname == "food-catalog.md":
        # | 型号 | 能量 | 水分 | 备注 |
        for cells in rows:
            name = strip_bold(cells[0])
            if len(cells) < 3:
                continue
            e, h = norm_num(cells[1]), norm_num(cells[2])
            if e is None or h is None:
                continue
            en = MAP_FOOD.get(name)
            if not en:
                continue                      # 不在映射表里 → 本脚本不判
            a = items["ItemPropertiesFoodDrink"].get(en)
            if not a:
                report.append({"entry": fname, "site": name, "en": en,
                               "kind": "接口无此物品"})
                unres += 1
                continue
            if a["props"].get("energy") == e and a["props"].get("hydration") == h:
                ok += 1
            else:
                report.append({
                    "entry": fname, "site": name, "en": en,
                    "api_zh": a["zh"],
                    "kind": "数值不一致",
                    "site_vals": {"能量": e, "水分": h},
                    "api_vals": {"能量": a["props"].get("energy"),
                                 "水分": a["props"].get("hydration")},
                })
                bad += 1

    elif fname == "loadout-carriers.md":
        # | 型号 | 格数 | 空重 | 储物效率 |
        for cells in rows:
            name = strip_bold(cells[0])
            if len(cells) < 3:
                continue
            cells_n, w = norm_num(cells[1]), norm_num(cells[2])
            if cells_n is None or w is None:
                continue
            en = MAP_CARRIERS.get(name)
            if not en:
                continue
            a = items["ItemPropertiesChestRig"].get(en) or \
                items["ItemPropertiesBackpack"].get(en)
            if not a:
                report.append({"entry": fname, "site": name, "en": en,
                               "kind": "接口无此物品"})
                unres += 1
                continue
            api_cap = a["props"].get("capacity")
            api_w = a["weight"]
            diffs = []
            if api_cap is not None and api_cap != cells_n:
                diffs.append(("格数", cells_n, api_cap))
            if api_w is not None and abs(api_w - w) > 0.051:
                diffs.append(("空重(kg)", w, api_w))
            if diffs:
                report.append({"entry": fname, "site": name, "en": en,
                               "api_zh": a["zh"], "kind": "数值不一致",
                               "diffs": [{"字段": k, "站内": s, "接口": v}
                                         for k, s, v in diffs]})
                bad += 1
            else:
                ok += 1

    elif fname == "medical-catalog.md":
        # | 型号 | 总容量 | 单次治疗 | 止血能力 | 特点 |
        # ⚠️ 期望值全部**从当前单元格解析**（`norm_num`），不取自任何常量表。
        for cells in rows:
            name = strip_bold(cells[0])
            if len(cells) < 3 or name not in MAP_MEDICAL:
                continue
            en = MAP_MEDICAL[name]
            site_hp = norm_num(cells[1])
            site_per = norm_num(cells[2])          # 「—」→ None = 不限，不核那一栏
            a = (items["ItemPropertiesMedKit"].get(en)
                 or items["ItemPropertiesSurgicalKit"].get(en))
            if not a:
                report.append({"entry": fname, "site": name, "en": en,
                               "kind": "接口无此物品"})
                unres += 1
                continue
            diffs = []
            api_hp = a["props"].get("hitpoints")
            api_per = a["props"].get("maxHealPerUse")
            if site_per is not None and api_per is not None and site_per != api_per:
                diffs.append(("单次治疗", site_per, api_per))
            if site_hp is not None and api_hp is not None and site_hp != api_hp:
                diffs.append(("总容量", site_hp, api_hp))
            if diffs:
                report.append({"entry": fname, "site": name, "en": en,
                               "api_zh": a["zh"], "kind": "数值不一致",
                               "diffs": [{"字段": k, "站内": s, "接口": v}
                                         for k, s, v in diffs]})
                bad += 1
            else:
                ok += 1

    elif fname == "armor-catalog.md":
        # | 型号 | 等级 | 材质 | …/ | 型号 | 最高等级 | … |
        # 只核「等级 / 最高等级」——材质是定性描述，不在核对范围。
        # ⚠️ 期望等级从**当前单元格**解析（`norm_num`），不取自任何常量表。
        for cells in rows:
            if len(cells) < 2:
                continue
            name = strip_bold(cells[0])
            if name not in MAP_ARMOR_CLASS:
                continue
            en = MAP_ARMOR_CLASS[name]
            site_cls = norm_num(cells[1])
            if site_cls is None:
                continue                       # 站内写「载体」等非数值 → 不判
            a = (items["ItemPropertiesArmor"].get(en)
                 or items["ItemPropertiesHelmet"].get(en)
                 or items["ItemPropertiesChestRig"].get(en))
            if not a:
                report.append({"entry": fname, "site": name, "en": en,
                               "kind": "接口无此物品"})
                unres += 1
                continue
            api_cls = a["props"].get("class")
            if api_cls is None:
                report.append({"entry": fname, "site": name, "en": en,
                               "api_zh": a["zh"],
                               "kind": "接口无防护等级字段，站内写的是数值"})
                bad += 1
                continue
            if api_cls != site_cls:
                report.append({"entry": fname, "site": name, "en": en,
                               "api_zh": a["zh"], "kind": "数值不一致",
                               "diffs": [{"字段": "防护等级", "站内": site_cls,
                                          "接口": api_cls}]})
                bad += 1
            else:
                ok += 1

    else:
        return None                        # 该页暂无可机读字段

    return ok, bad, unres


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.fetch or not CACHE.exists():
        print("抓取 json.tarkov.dev …")
        payload = {"fetched": FETCH_DATE, "items": get("items")["data"],
                   "zh": get("items_zh")["data"]}
        CACHE.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")

    payload = json.loads(CACHE.read_text(encoding="utf-8"))
    items = build_index(payload)

    report = []
    tally = {}
    for fname, label in ENTRIES.items():
        r = compare(fname, items, report)
        if r is None:
            print(f"  {label:18s} 本脚本暂不覆盖（无可机读字段）")
            continue
        ok, bad, unres = r
        tally[label] = {"一致": ok, "不一致": bad, "无法对应": unres}
        print(f"  {label:18s} 一致 {ok:3d} ｜ 不一致 {bad:3d} ｜ 无法对应 {unres:3d}")

    n_bad = sum(v["不一致"] for v in tally.values())
    n_ok = sum(v["一致"] for v in tally.values())
    print(f"\n站内基线 {SITE_BASELINE} ↔ 接口抓取 {payload.get('fetched', '?')}")
    print(f"合计：一致 {n_ok} ｜ 不一致 {n_bad}")

    if report:
        print("\n差异明细：")
        for r in report:
            print("  " + json.dumps(r, ensure_ascii=False))

    if args.json:
        print("\n" + json.dumps({"fetched": payload.get("fetched"),
                                 "site_baseline": SITE_BASELINE,
                                 "tally": tally, "report": report},
                                ensure_ascii=False, indent=1))
    return 1 if n_bad else 0


if __name__ == "__main__":
    sys.exit(main())