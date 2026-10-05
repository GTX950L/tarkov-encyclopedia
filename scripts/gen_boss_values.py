#!/usr/bin/env python3
"""生成《Boss 图鉴》里的「血量」与「刷新率」两张表。

数据源：https://json.tarkov.dev/regular/maps
  · data.mobs       —— 42 个 mob 定义，含**各部位血量**（health 数组）
  · data.maps[].bosses —— 每图的 boss 条目，含 **spawnChance / escorts / mob 引用**
  · maps_zh         —— mob 与地图的中文名

用法：
    python scripts/gen_boss_values.py --fetch
    python scripts/gen_boss_values.py
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "boss_values.json"
TARGET = ROOT / "content" / "entries" / "bosses.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:BOSS-VALUES:START -->"
END = "<!-- AUTO-GEN:BOSS-VALUES:END -->"
FETCH_DATE = "2026-10-06"

# 部位顺序与中文：端点给的是 7 个部位
PARTS = [
    ("Head", "头"), ("Chest", "胸"), ("Stomach", "腹"),
    ("LeftArm", "左臂"), ("RightArm", "右臂"),
    ("LeftLeg", "左腿"), ("RightLeg", "右腿"),
]


def get(endpoint: str):
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def fetch() -> dict:
    maps = get("maps")["data"]
    zh = get("maps_zh")["data"]
    mobs = maps["mobs"]

    # ① 血量：只列真 boss（mob 键以 boss 开头），护卫另见刷新率表
    hp = []
    for key, m in mobs.items():
        if not key.lower().startswith("boss"):
            continue
        parts = {}
        total = 0
        for h in m.get("health") or []:
            parts[h.get("id")] = h.get("max")
            total += h.get("max") or 0
        hp.append({
            "name": zh.get(key, m.get("name") or key),
            "parts": parts,
            "total": total,
        })
    hp.sort(key=lambda r: -r["total"])

    # ② 刷新率：按图列出每个 boss 的 spawnChance 与护卫
    def mobname(ref):
        return zh.get(ref, mobs.get(ref, {}).get("name") or ref)

    spawns = []
    maps_list = maps["maps"]
    if isinstance(maps_list, dict):          # 端点在 list / dict 两种形态间变过，两种都吃
        maps_list = list(maps_list.values())
    for mp in maps_list:
        mname = zh.get(mp["id"] + " Name") or mp.get("normalizedName") or mp["id"]
        for b in mp.get("bosses") or []:
            ref = b.get("mob")
            if not ref:
                continue
            esc = [mobname(e.get("mob") if isinstance(e, dict) else e) for e in (b.get("escorts") or [])]
            spawns.append({
                "map": mname,
                "boss": mobname(ref),
                "chance": b.get("spawnChance"),
                "escorts": len(esc),
            })
    # 同一张图上的同一个 Boss 可能有多个刷新点，合并成一行（概率取最高、护卫取最多）
    spawns = merge_spawns(spawns)

    data = {"hp": hp, "spawns": spawns}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"fetched": FETCH_DATE, **data}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    print(f"已抓取：Boss {len(hp)} 个 / 刷新点 {len(spawns)} 条")
    return data


def merge_spawns(spawns: list[dict]) -> list[dict]:
    """同一张图上的同一个 Boss 可能有多个刷新点，合并成一行（概率取最高、护卫取最多）。"""
    merged: dict[tuple, dict] = {}
    for s in spawns:
        k = (s["map"], s["boss"])
        if k not in merged:
            merged[k] = dict(s)
        else:
            merged[k]["chance"] = max(merged[k]["chance"] or 0, s["chance"] or 0)
            merged[k]["escorts"] = max(merged[k]["escorts"], s["escorts"])
    out = list(merged.values())
    out.sort(key=lambda r: (r["map"], -(r["chance"] or 0)))
    return out


def pct(x) -> str:
    if x is None:
        return "—"
    v = x * 100
    return f"{v:.0f}%" if abs(v - round(v)) < 0.05 else f"{v:.1f}%"


def render(data: dict, fetched: str) -> str:
    out = [
        "## 📊 Boss 血量与刷新率",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点）",
        ">",
        "> **怎么读血量**：塔科夫按**部位**结算，**头是唯一能一枪定胜负的部位**——"
        "哪怕总血量四位数，头部通常只有一百出头。**打不动甲就先碎甲、再补枪**（见[弹道与穿透机制](ballistics.md)）。",
        ">",
        "> **怎么读刷新率**：这是**官方数据里的基础概率**，会随赛季、时间与特定触发条件浮动，"
        "**不等于你在局里遇到他的概率**。",
        ">",
        "> ⚠️ 本表**只给血量与刷新率**，不含刷新点位坐标。**随版本调整，以游戏内为准。**",
        "",
        "### 各部位血量",
        "",
        "| Boss | " + " | ".join(lbl for _, lbl in PARTS) + " | 合计 |",
        "|------|" + "------|" * len(PARTS) + "------|",
    ]
    for r in data["hp"]:
        cells = [str(r["parts"].get(k, "—")) for k, _ in PARTS]
        out.append(f"| **{r['name']}** | " + " | ".join(cells) + f" | **{r['total']}** |")

    out += [
        "",
        "### 各图刷新率",
        "",
        "| 地图 | Boss | 基础刷新率 | 护卫数 |",
        "|------|------|------------|--------|",
    ]
    for s in data["spawns"]:
        esc = str(s["escorts"]) if s["escorts"] else "—"
        out.append(f"| {s['map']} | {s['boss']} | **{pct(s['chance'])}** | {esc} |")
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
        data = {"hp": d["hp"], "spawns": d["spawns"]}
    data["spawns"] = merge_spawns(data["spawns"])
    write_section(render(data, fetched))
    print(f"已写入 {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
