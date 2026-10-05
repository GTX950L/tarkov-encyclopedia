#!/usr/bin/env python3
"""生成《弹药选型速查表》里的「逐发弹药数值表」。

数据源：https://json.tarkov.dev/regular/
  · items     —— 结构化数值（**文本字段是占位符**，只取数值）
  · items_zh  —— 中文译名字典（键形如 `<id> Name` / `<id> ShortName`）

与 scripts/gen_quests.py 同源、同纪律：**译名一律不自己编**，查不到就退回英文名。

用法：
    python scripts/gen_ammo_values.py --fetch   # 重抓数据源，刷新 scripts/data/ammo_values.json
    python scripts/gen_ammo_values.py           # 用缓存重生成，写回 ammo-table.md 的标记区

写入范围：**只替换 AUTO-GEN 标记之间的内容**，标记外的手写正文一律不动。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "ammo_values.json"
TARGET = ROOT / "content" / "entries" / "ammo-table.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:AMMO-VALUES:START -->"
END = "<!-- AUTO-GEN:AMMO-VALUES:END -->"
FETCH_DATE = "2026-10-06"

# 口径的显示名与排序 —— 排序沿用正文「按口径选型」的次序：主力步枪在前，霰弹与发射器在后
CAL_LABEL = {
    "Caliber545x39": "5.45x39",
    "Caliber556x45NATO": "5.56x45",
    "Caliber762x39": "7.62x39",
    "Caliber762x51": "7.62x51",
    "Caliber762x54R": "7.62x54R",
    "Caliber86x70": ".338 LM",
    "Caliber68x51": "6.8x51",
    "Caliber58x42": "5.8x42",
    "Caliber93x64": "9.3x64",
    "Caliber784x49": "7.84x49",
    "Caliber9x19PARA": "9x19",
    "Caliber9x39": "9x39",
    "Caliber46x30": "4.6x30",
    "Caliber57x28": "5.7x28",
    "Caliber1143x23ACP": ".45 ACP",
    "Caliber9x18PM": "9x18 PM",
    "Caliber762x25TT": "7.62x25 TT",
    "Caliber9x21": "9x21",
    "Caliber9x33R": ".357 Magnum",
    "Caliber762x35": ".300 BLK",
    "Caliber366TKM": ".366 TKM",
    "Caliber127x55": "12.7x55",
    "Caliber127x99": ".50 BMG",
    "Caliber127x33": ".50 AE",
    "Caliber12g": "12/70",
    "Caliber20g": "20/70",
    "Caliber23x75": "23x75",
    "Caliber26x75": "26x75",
    "Caliber40x46": "40x46",
    "Caliber40mmRU": "40mm",
    "Caliber20x1mm": "20x1mm",
}
CAL_ORDER = [
    "Caliber545x39", "Caliber556x45NATO", "Caliber762x39", "Caliber762x51", "Caliber762x54R",
    "Caliber86x70", "Caliber68x51", "Caliber58x42", "Caliber93x64", "Caliber784x49",
    "Caliber9x19PARA", "Caliber9x39", "Caliber46x30", "Caliber57x28", "Caliber1143x23ACP",
    "Caliber9x18PM", "Caliber762x25TT", "Caliber9x21", "Caliber9x33R",
    "Caliber762x35", "Caliber366TKM", "Caliber127x55", "Caliber127x99", "Caliber127x33",
    "Caliber12g", "Caliber20g", "Caliber23x75", "Caliber26x75",
    "Caliber40x46", "Caliber40mmRU", "Caliber20x1mm",
]


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def clean(s: str) -> str:
    """站内硬规矩：中文正文不留直引号。"""
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def fetch() -> list[dict]:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    rows = []
    for v in items.values():
        p = v.get("properties") or {}
        if p.get("propertiesType") != "ItemPropertiesAmmo":
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        rows.append({
            "name": clean(name),
            "cal": p.get("caliber"),
            "damage": p.get("damage"),
            "pen": p.get("penetrationPower"),
            "armor": p.get("armorDamage"),
            "frag": p.get("fragmentationChance"),
            "rico": p.get("ricochetChance"),
            "speed": p.get("initialSpeed"),
            "pellets": p.get("projectileCount"),
        })
    rows.sort(key=lambda r: (
        CAL_ORDER.index(r["cal"]) if r["cal"] in CAL_ORDER else 999,
        -(r["pen"] or 0),
    ))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(
        json.dumps({"fetched": FETCH_DATE, "count": len(rows), "rows": rows},
                   ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"已抓取并缓存 {len(rows)} 条弹药 → {CACHE.relative_to(ROOT)}")
    return rows


def pct01(x) -> str:
    """0–1 的小数 → 百分比。"""
    if x is None:
        return "—"
    v = x * 100
    return f"{v:.0f}%" if abs(v - round(v)) < 0.05 else f"{v:.1f}%"


def pct100(x) -> str:
    """已经是百分数的值（甲伤）。"""
    if x is None:
        return "—"
    return f"{x:.0f}%" if abs(x - round(x)) < 0.05 else f"{x:.1f}%"


def render(rows: list[dict], fetched: str) -> str:
    out = [
        "## 📊 逐发弹药数值表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **怎么读**：**甲伤** ＝ 命中护甲时扣掉的耐久百分比；**碎弹 / 跳弹** 是触发概率"
        "（机制原理见[弹道与穿透机制](ballistics.md) 第 5、6 节）；**初速** 单位 m/s，"
        "直接决定下坠与提前量。同一口径内**按穿深降序**排列。",
        ">",
        "> ⚠️ **霰弹类（12/70、20/70、23x75）的「伤害」是「每颗弹丸」**，单发总伤害要乘弹丸数；"
        "发射器类（40x46、40mm）的数值口径也不同。**本表随版本调整，以游戏内为准。**",
        "",
        "| 口径 | 弹药 | 伤害 | 穿深 | 甲伤 | 碎弹 | 跳弹 | 初速 |",
        "|------|------|------|------|------|------|------|------|",
    ]
    prev = None
    for r in rows:
        cal = CAL_LABEL.get(r["cal"], r["cal"] or "—")
        cell = f"**{cal}**" if cal != prev else ""
        prev = cal
        out.append(
            f"| {cell} | {r['name']} | {r['damage']} | {r['pen']} "
            f"| {pct100(r['armor'])} | {pct01(r['frag'])} | {pct01(r['rico'])} | {r['speed']} |"
        )
    return "\n".join(out)


def write_section(block: str) -> None:
    text = TARGET.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"错误：{TARGET.relative_to(ROOT)} 里找不到 AUTO-GEN 标记，请先手工放好标记再跑。")
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    TARGET.write_text(f"{head}{START}\n\n{block}\n\n{END}{tail}", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="重抓数据源并刷新缓存")
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
    print(f"已写入 {TARGET.relative_to(ROOT)}：{len(rows)} 条弹药")


if __name__ == "__main__":
    main()
