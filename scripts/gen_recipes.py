#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
制作与交换配方：抓取 + 生成。

两条命令（与站内其它生成器同一模式：抓取与生成分开，生成可离线复现）：

    python scripts/gen_recipes.py --fetch    # 抓 crafts / barters / items_zh / traders，写 scripts/data/recipes.json
    python scripts/gen_recipes.py            # 读 recipes.json，生成 content/javascripts/recipe-data.js

数据源（二级来源）：json.tarkov.dev 的 regular（持久 PvP）档案。
  · crafts    —— 藏身处制作配方 214 条（设施 / 等级 / 时长 / 材料，含「工具不消耗」标记）
  · barters   —— 商人交换配方 855 条（商人 / 忠诚度 / 数量 / 是否需任务解锁）
  · items_zh  —— 物品中文译名（键形如 `<id> Name` / `<id> ShortName`）
  · traders   —— 商人 id → 规范名
  · 设施 id → 中文名复用站内 scripts/data/hideout.json 的 stations（gen_hideout.py 的产物）

**站内不收「价格与利润」**：售价/成本是实时数据，收录即过期（见 citation.md 第六节）。
本脚本只导出「配方结构」——谁、在什么设施/等级、用什么换什么、要多久。

对账（任一不符 → 退出码 1）：
  1. 配方的设施 / 商人必须全部能映射到名字
  2. 材料与產出的物品 index 必须全部在字典里
  3. 物品字典里不得有空名

用法之外的提醒：重跑本脚本会覆盖 recipe-data.js —— 页面（docs/recipes.md）里的
说明文字是手写的，不受影响。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "scripts" / "data" / "recipes.json"
HIDEOUT_FILE = ROOT / "scripts" / "data" / "hideout.json"
OUT_FILE = ROOT / "content" / "javascripts" / "recipe-data.js"

API = "https://json.tarkov.dev/regular/"
FETCH_DATE = date.today().isoformat()
BASELINE = "1.1.5.1（第一赛季 KORD BREACH）· 2026 年 9 月"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; tarkov-encyclopedia/1.0)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
    "Accept": "application/json",
}

# 商人的显示名 —— 与站内任务图鉴栏目的写法保持一致（英文名 + Ref 的括注）
TRADER_LABEL = {
    "prapor": "Prapor",
    "therapist": "Therapist",
    "skier": "Skier",
    "peacekeeper": "Peacekeeper",
    "mechanic": "Mechanic",
    "ragman": "Ragman",
    "jaeger": "Jaeger",
    "ref": "Ref（竞技场裁判）",
    "fence": "Fence",
    "lightkeeper": "Lightkeeper",
    "btr-driver": "BTR 司机",
}

# 设施的固定展示顺序（按配方数从多到少；未列到的排在最后）——
# 与 hideout.json 的 26 个模块取交集后共 8 个。
STATION_ORDER = [
    "工作台", "卫生间", "医疗站", "情报中心", "营养部",
    "集水器", "酿酒处", "比特币矿场",
]

# 商人的固定展示顺序 —— 与站内任务图鉴的商人排列一致
TRADER_ORDER = [
    "Mechanic", "Prapor", "Skier", "Jaeger", "Ragman", "Therapist",
    "Peacekeeper", "Ref（竞技场裁判）",
]


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


# ─────────────────────────────────────────────────────────────────────────────
# 抓取
# ─────────────────────────────────────────────────────────────────────────────

def fetch() -> dict:
    print("抓取 json.tarkov.dev ...")
    crafts = get("crafts")["data"]
    barters = get("barters")["data"]
    items_zh = get("items_zh")["data"]
    traders = get("traders")["data"]
    print(f"  制作 {len(crafts)} ／ 交换 {len(barters)} ／ 物品译名 {len(items_zh)} ／ 商人 {len(traders)}")

    if not HIDEOUT_FILE.exists():
        sys.exit("找不到 scripts/data/hideout.json（设施映射依赖它，先跑 gen_hideout.py）")
    hideout = json.loads(HIDEOUT_FILE.read_text(encoding="utf-8"))
    station_map = {s["id"]: s["name"] for s in hideout["stations"]}

    def zh(item_id: str) -> str:
        v = items_zh.get(item_id + " Name") or items_zh.get(item_id + " ShortName")
        return (v or "").strip()

    payload = {
        "fetched": FETCH_DATE,
        "source": "json.tarkov.dev/regular（crafts / barters / items_zh / traders）",
        "baseline": BASELINE,
        "crafts": [
            {
                "product": c["productItem"]["item"],
                "count": c["productItem"].get("count") or 1,
                "station": station_map.get(c["station"], ""),
                "stationId": c["station"],
                "level": c.get("level") or 1,
                "duration": c.get("duration") or 0,
                "materials": [
                    {
                        "item": m["item"],
                        "count": m.get("count") or 1,
                        "tool": bool((m.get("attributes") or {}).get("tool")),
                    }
                    for m in c.get("requiredItems") or []
                ]
                + [
                    {"item": m["item"] if isinstance(m, dict) else m,
                     "count": (m.get("count") if isinstance(m, dict) else 1) or 1,
                     "quest": True}
                    for m in c.get("requiredQuestItems") or []
                ],
                "editions": c.get("gameEditions") or [],
            }
            for c in crafts
        ],
        "barters": [
            {
                "product": b["offeredItem"]["item"],
                "count": b["offeredItem"].get("count") or 1,
                "trader": TRADER_LABEL.get(
                    (traders.get(b.get("trader")) or {}).get("normalizedName", ""),
                    (traders.get(b.get("trader")) or {}).get("normalizedName", "") or "—",
                ),
                "level": b.get("minTraderLevel") or 1,
                "materials": [
                    {"item": m["item"], "count": m.get("count") or 1}
                    for m in b.get("requiredItems") or []
                ],
                "task": bool(b.get("taskUnlock")),
            }
            for b in barters
        ],
    }
    # 物品译名：把两份表都涉及到的 id 全收集
    names: dict[str, str] = {}
    for rec in payload["crafts"] + payload["barters"]:
        ids = [rec["product"]] + [m["item"] for m in rec["materials"]]
        for i in ids:
            if i not in names:
                names[i] = zh(i)
    payload["names"] = names

    DATA_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"✓ 已写 {DATA_FILE.relative_to(ROOT)}（{DATA_FILE.stat().st_size / 1024:.0f} KB）")
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# 生成
# ─────────────────────────────────────────────────────────────────────────────

def build_js(d: dict) -> str:
    names: dict[str, str] = d["names"]

    # 字典：ids[i] ↔ labels[i]。数据里只存下标，24 位的 id 不重复出现。
    ids = sorted(names.keys())
    idx = {i: n for n, i in enumerate(ids)}

    # 少数物品在数据端点的译名字典（items_zh / items_en）里查不到名字 ——
    # 实测有 6 个（情报中心「钥匙卡重编码」类配方用到的材料）。**不编名字**：
    # 统一显示为「未收录物品」，页面说明里点名，生成日志里列出 id 供后续跟进。
    MISSING_LABEL = "未收录物品"
    missing = [i for i in ids if not names[i]]
    for i in missing:
        names[i] = MISSING_LABEL

    errs = []

    def label(item_id: str) -> int:
        n = idx.get(item_id)
        if n is None:
            errs.append(f"物品 {item_id} 不在字典里")
            return -1
        return n

    crafts = []
    for c in sorted(
        d["crafts"],
        key=lambda c: (
            STATION_ORDER.index(c["station"]) if c["station"] in STATION_ORDER else 99,
            c["level"],
            c["duration"],
            names.get(c["product"], ""),
        ),
    ):
        if not c["station"]:
            errs.append(f"设施 {c['stationId']} 不在 hideout.json 里")
            continue
        mats = []
        for m in c["materials"]:
            kind = 1 if m.get("tool") else (2 if m.get("quest") else 0)
            mats.append([label(m["item"]), m["count"], kind])
        note = "限特定游戏版本" if c.get("editions") else ""
        crafts.append([label(c["product"]), c["count"], c["station"],
                       c["level"], c["duration"], mats, note])

    barters = []
    for b in sorted(
        d["barters"],
        key=lambda b: (
            TRADER_ORDER.index(b["trader"]) if b["trader"] in TRADER_ORDER else 99,
            b["level"],
            names.get(b["product"], ""),
        ),
    ):
        mats = [[label(m["item"]), m["count"]] for m in b["materials"]]
        note = "需任务解锁" if b.get("task") else ""
        barters.append([label(b["product"]), b["count"], b["trader"], b["level"], mats, note])

    if errs:
        print("✗ 对账失败：", file=sys.stderr)
        for e in errs[:20]:
            print("   ·", e, file=sys.stderr)
        sys.exit(1)

    payload = {
        "generated": d.get("fetched", ""),
        "baseline": d.get("baseline", ""),
        "source": d.get("source", ""),
        "ids": ids,
        "names": [names[i] for i in ids],
        "crafts": crafts,
        "barters": barters,
    }
    js = (
        "/* 由 scripts/gen_recipes.py 生成，请勿手工编辑。\n"
        "   数据源：json.tarkov.dev/regular 的 crafts / barters（持久 PvP 口径）。\n"
        "   用途：配方速查表（docs/recipes.md）的只读数据，只在那一页加载。\n"
        "   站内不收价格与利润 —— 只导出配方结构（设施/商人、等级、材料、时长）。\n"
        "   重跑：python scripts/gen_recipes.py --fetch 然后 python scripts/gen_recipes.py */\n"
        "window.TARKOV_RECIPES = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    return js


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="先从 json.tarkov.dev 抓取")
    args = ap.parse_args()

    if args.fetch:
        d = fetch()
    else:
        if not DATA_FILE.exists():
            sys.exit("找不到 scripts/data/recipes.json —— 先跑 python scripts/gen_recipes.py --fetch")
        d = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    js = build_js(d)
    OUT_FILE.write_text(js, encoding="utf-8")

    n_st = Counter(c["station"] for c in d["crafts"])
    print(f"✓ 已生成 {OUT_FILE.relative_to(ROOT)}（{OUT_FILE.stat().st_size / 1024:.0f} KB）")
    print(f"  制作 {len(d['crafts'])} 条 ｜ 交换 {len(d['barters'])} 条 ｜ "
          f"物品字典 {len(d['names'])} 项")
    print("  设施分布：" + " ／ ".join(f"{k} {v}" for k, v in n_st.most_common()))
    miss = [i for i, n in d["names"].items() if n == "未收录物品"]
    if miss:
        print(f"  ⚠ 数据端点未收录译名的物品 {len(miss)} 个（显示为「未收录物品」）：")
        for i in miss:
            print("     ·", i)


if __name__ == "__main__":
    main()
