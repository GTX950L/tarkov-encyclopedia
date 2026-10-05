#!/usr/bin/env python3
"""生成《食物与饮料图鉴》里的「逐型号数值表」。

数据源与写入方式同 scripts/gen_ammo_values.py：json.tarkov.dev/regular/ 的 items ＋ items_zh。
用法：
    python scripts/gen_food_values.py --fetch
    python scripts/gen_food_values.py
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "food_values.json"
TARGET = ROOT / "content" / "entries" / "food-catalog.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:FOOD-VALUES:START -->"
END = "<!-- AUTO-GEN:FOOD-VALUES:END -->"
FETCH_DATE = "2026-10-06"

# 食物附带的增益效果（stimEffects.type → 中文）
BUFF = {
    "HealthRate": "回血",
    "EnergyRate": "能量恢复",
    "HydrationRate": "水分恢复",
    "MaxStamina": "耐力上限",
    "StaminaRate": "耐力恢复",
    "Skill": "技能成长",
    "HandsTremor": "抗手抖",
    "WeightLimit": "负重上限",
    "DamageModifier": "减伤",
    "Antidote": "解毒",
    "BodyTemperature": "体温",
    "Pain": "止痛",
    "QuantumTunnelling": "特殊",
    "Removeallbloodlosses": "止全出血",
}


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def clean(s: str) -> str:
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def buffs(v) -> str:
    seen = []
    for s in v or []:
        t = BUFF.get(s.get("type"), s.get("type"))
        if t and t not in seen:
            seen.append(t)
    return " / ".join(seen) if seen else "—"


def fetch() -> list[dict]:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    rows = []
    for v in items.values():
        p = v.get("properties") or {}
        if p.get("propertiesType") != "ItemPropertiesFoodDrink":
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        rows.append({
            "name": clean(name),
            "energy": p.get("energy"),
            "hydra": p.get("hydration"),
            "buff": buffs(p.get("stimEffects")),
        })
    rows.sort(key=lambda r: (-(r["energy"] or 0), -(r["hydra"] or 0)))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"fetched": FETCH_DATE, "count": len(rows), "rows": rows},
                                ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已抓取并缓存 {len(rows)} 种食物与饮料")
    return rows


def render(rows: list[dict], fetched: str) -> str:
    out = [
        "## 📊 逐型号数值表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **怎么读**：**能量与水分可为负数**——负水分的食物会把你「喝干」，这正是本页第 2 节说的陷阱；"
        "**附带效果**是食用后获得的临时增益（少数食物兼作便宜的药）。按能量降序。",
        ">",
        "> ⚠️ **部分食物同时是任务物品**（见第 8 节），交任务前别乱吃。**本表随版本调整，以游戏内为准。**",
        "",
        "| 物品 | 能量 | 水分 | 附带效果 |",
        "|------|------|------|----------|",
    ]
    for r in rows:
        out.append(f"| {r['name']} | {r['energy']} | {r['hydra']} | {r['buff']} |")
    return "\n".join(out)


def write_section(block: str) -> None:
    text = TARGET.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 AUTO-GEN 标记。")
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    TARGET.write_text(f"{head}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    args = ap.parse_args()
    if args.fetch:
        rows = fetch()
        fetched = FETCH_DATE
    else:
        if not CACHE.exists():
            sys.exit("缓存不存在，先跑一次 --fetch。")
        d = json.loads(CACHE.read_text(encoding="utf-8"))
        rows, fetched = d["rows"], d["fetched"]
    write_section(render(rows, fetched))
    print(f"已写入 {TARGET.relative_to(ROOT)}：{len(rows)} 种")


if __name__ == "__main__":
    main()
