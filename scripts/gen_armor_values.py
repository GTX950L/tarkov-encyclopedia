#!/usr/bin/env python3
"""生成《护甲与头盔图鉴》里的「逐款护甲数值表」。

数据源与写入方式同 scripts/gen_ammo_values.py：
  · 数据：json.tarkov.dev/regular/ 的 items（结构化数值）＋ items_zh（中文译名）
  · 写入：**只替换 AUTO-GEN 标记之间的内容**，手写正文不动

用法：
    python scripts/gen_armor_values.py --fetch   # 重抓并刷新缓存
    python scripts/gen_armor_values.py           # 用缓存重生成
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "armor_values.json"
TARGET = ROOT / "content" / "entries" / "armor-catalog.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:ARMOR-VALUES:START -->"
END = "<!-- AUTO-GEN:ARMOR-VALUES:END -->"
FETCH_DATE = "2026-10-06"

# 材质 → 中文（官方用英文枚举，站内正文用中文）
MAT = {
    "Aramid": "芳纶",
    "Combined": "复合材料",
    "CombinedMaterials": "复合材料",
    "Titan": "钛",
    "Aluminium": "铝",
    "ArmorSteel": "装甲钢",
    "Ceramic": "陶瓷",
    "Glass": "玻璃",
    "UHMWPE": "超高分子量聚乙烯",
    "None": "—",
}
ATYPE = {"Heavy": "重型", "Light": "轻型", "None": "—"}


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def clean(s: str) -> str:
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def pct(x, digits=0) -> str:
    if x is None:
        return "—"
    v = x * 100
    return f"{v:.0f}%" if abs(v - round(v)) < 0.05 else f"{v:.1f}%"


def penalty(p: dict) -> str:
    parts = [
        pct(p.get("speedPenalty")),
        pct(p.get("turnPenalty")),
        pct(p.get("ergoPenalty")),
    ]
    return " / ".join(parts) if any(x != "—" for x in parts) else "—"


def fetch() -> dict:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    out = {"body": [], "helmet": []}
    for v in items.values():
        p = v.get("properties") or {}
        pt = p.get("propertiesType")
        if pt == "ItemPropertiesArmor":
            bucket = "body"
        elif pt == "ItemPropertiesHelmet":
            bucket = "helmet"
        else:
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        out[bucket].append({
            "name": clean(name),
            "class": p.get("class"),
            "dur": p.get("durability"),
            "mat": MAT.get(p.get("material"), p.get("material") or "—"),
            "type": ATYPE.get(p.get("armorType"), p.get("armorType") or "—"),
            "blunt": p.get("bluntThroughput"),
            "pen": penalty(p),
        })
    for k in out:
        out[k].sort(key=lambda r: (-(r["class"] or 0), -(r["dur"] or 0)))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(
        json.dumps({"fetched": FETCH_DATE, **out}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"已抓取并缓存：防弹衣 {len(out['body'])} 条 / 头盔 {len(out['helmet'])} 条")
    return out


def table(rows: list[dict]) -> list[str]:
    out = [
        "| 护甲 | 等级 | 耐久 | 材质 | 类型 | 钝伤穿透 | 惩罚（移速 / 转向 / 人机） |",
        "|------|------|------|------|------|----------|------------------------------|",
    ]
    for r in rows:
        out.append(
            f"| {r['name']} | {r['class']} | {r['dur']} | {r['mat']} | {r['type']} "
            f"| {pct(r['blunt'], 1)} | {r['pen']} |"
        )
    return out


def render(data: dict, fetched: str) -> str:
    out = [
        "## 📊 逐款护甲数值表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **怎么读**：**耐久**是上限值，**实际防护随耐久下降**（见[护甲修复与耐久](armor-repair.md)）；"
        "**钝伤穿透**越低，未击穿时透到身体的伤害越少；**惩罚**三项都是**负值**（越低越吃亏）。"
        "同一级内按耐久降序。",
        ">",
        "> ⚠️ **本表不含插板与附加护甲**（另有 117 件，属[载具图鉴](loadout-carriers.md) 与装备面板的范畴）；"
        "**头盔的跳弹参数未列入**（数据端点提供三参数，含义官方未公开）。**本表随版本调整，以游戏内为准。**",
        "",
        f"### 防弹衣（{len(data['body'])} 款）",
        "",
    ]
    out += table(data["body"])
    out += ["", f"### 头盔（{len(data['helmet'])} 款）", ""]
    out += table(data["helmet"])
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
        data = fetch()
        fetched = FETCH_DATE
    else:
        if not CACHE.exists():
            sys.exit("缓存不存在，先跑一次 --fetch。")
        d = json.loads(CACHE.read_text(encoding="utf-8"))
        fetched = d["fetched"]
        data = {"body": d["body"], "helmet": d["helmet"]}
    write_section(render(data, fetched))
    print(f"已写入 {TARGET.relative_to(ROOT)}：防弹衣 {len(data['body'])} ／ 头盔 {len(data['helmet'])}")


if __name__ == "__main__":
    main()
