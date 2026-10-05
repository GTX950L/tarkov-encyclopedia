#!/usr/bin/env python3
"""生成《医疗物资图鉴》里的「逐型号数值表」（急救包 / 医疗物品 / 兴奋剂 三段）。

数据源与写入方式同 scripts/gen_ammo_values.py。
用法：
    python scripts/gen_medical_values.py --fetch
    python scripts/gen_medical_values.py
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "medical_values.json"
TARGET = ROOT / "content" / "entries" / "medical-catalog.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:MEDICAL-VALUES:START -->"
END = "<!-- AUTO-GEN:MEDICAL-VALUES:END -->"
FETCH_DATE = "2026-10-06"

CURE = {
    "LightBleeding": "轻出血",
    "HeavyBleeding": "重出血",
    "Fracture": "骨折",
    "Contusion": "挫伤",
    "Pain": "疼痛",
    "LostLimb": "黑肢",
    "Intoxication": "中毒",
}
EFFECT = {
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


def cures(v) -> str:
    seen = [CURE.get(c, c) for c in (v or [])]
    return " / ".join(seen) if seen else "—"


def effects(v) -> str:
    seen = []
    for s in v or []:
        t = EFFECT.get(s.get("type"), s.get("type"))
        if t and t not in seen:
            seen.append(t)
    return " / ".join(seen) if seen else "—"


def fetch() -> dict:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    out = {"kit": [], "item": [], "stim": []}
    for v in items.values():
        p = v.get("properties") or {}
        pt = p.get("propertiesType")
        if pt == "ItemPropertiesMedKit":
            b = "kit"
        elif pt in ("ItemPropertiesMedicalItem", "ItemPropertiesSurgicalKit"):
            b = "item"
        elif pt in ("ItemPropertiesStim", "ItemPropertiesPainkiller"):
            b = "stim"
        else:
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        out[b].append({
            "name": clean(name),
            "hp": p.get("hitpoints"),
            "per": p.get("maxHealPerUse"),
            "time": p.get("useTime"),
            "uses": p.get("uses"),
            "cures": cures(p.get("cures")),
            "eff": effects(p.get("stimEffects")),
        })
    out["kit"].sort(key=lambda r: -(r["hp"] or 0))
    out["item"].sort(key=lambda r: (r["time"] or 0))
    out["stim"].sort(key=lambda r: (r["time"] or 0))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"fetched": FETCH_DATE, **out}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    print(f"已抓取并缓存：急救包 {len(out['kit'])} / 医疗物品 {len(out['item'])} / 兴奋剂与止痛 {len(out['stim'])}")
    return out


def render(data: dict, fetched: str) -> str:
    out = [
        "## 📊 逐型号数值表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **怎么读**：**总治疗量**是耐久池，**单次治疗量**是一次动作的上限——两者不是一回事"
        "（详见[医疗物资](medical.md) 与第 3 节）；**使用时间**是动作锁定时长，"
        "**交火中它直接等于你暴露的秒数**（见[战中伤情处置](combat-medical.md)）。",
        ">",
        "> ⚠️ 部分药品**同时是任务物品**，交任务前别用掉。**本表随版本调整，以游戏内为准。**",
        "",
        f"### 急救包（{len(data['kit'])} 款）",
        "",
        "| 急救包 | 总治疗量 | 单次治疗 | 使用时间 | 可治愈 |",
        "|--------|----------|----------|----------|--------|",
    ]
    for r in data["kit"]:
        out.append(f"| {r['name']} | {r['hp']} | {r['per']} | {r['time']} 秒 | {r['cures']} |")

    out += ["", f"### 医疗物品：止血、夹板与手术（{len(data['item'])} 款）", "",
            "| 物品 | 使用次数 | 使用时间 | 可治愈 |", "|------|----------|----------|--------|"]
    for r in data["item"]:
        out.append(f"| {r['name']} | {r['uses']} | {r['time']} 秒 | {r['cures']} |")

    out += ["", f"### 兴奋剂与止痛药（{len(data['stim'])} 款）", "",
            "| 药品 | 使用时间 | 主要效果 |", "|------|----------|----------|"]
    for r in data["stim"]:
        eff = r["eff"] if r["eff"] != "—" else r["cures"]
        out.append(f"| {r['name']} | {r['time']} 秒 | {eff} |")
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
        data = {k: d[k] for k in ("kit", "item", "stim")}
    write_section(render(data, fetched))
    print(f"已写入 {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
