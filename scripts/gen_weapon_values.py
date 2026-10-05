#!/usr/bin/env python3
"""生成《枪械图鉴》里的「逐型号武器数值表」。

数据源与写入方式同 scripts/gen_ammo_values.py / gen_armor_values.py：
  · 数据：json.tarkov.dev/regular/ 的 items ＋ items_zh
  · 写入：只替换 AUTO-GEN 标记之间的内容

用法：
    python scripts/gen_weapon_values.py --fetch
    python scripts/gen_weapon_values.py
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "weapon_values.json"
TARGET = ROOT / "content" / "entries" / "weapons.md"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
START = "<!-- AUTO-GEN:WEAPON-VALUES:START -->"
END = "<!-- AUTO-GEN:WEAPON-VALUES:END -->"
FETCH_DATE = "2026-10-06"

CAL_LABEL = {
    "Caliber545x39": "5.45x39", "Caliber556x45NATO": "5.56x45", "Caliber762x39": "7.62x39",
    "Caliber762x51": "7.62x51", "Caliber762x54R": "7.62x54R", "Caliber86x70": ".338 LM",
    "Caliber68x51": "6.8x51", "Caliber58x42": "5.8x42", "Caliber93x64": "9.3x64",
    "Caliber784x49": "7.84x49", "Caliber9x19PARA": "9x19", "Caliber9x39": "9x39",
    "Caliber46x30": "4.6x30", "Caliber57x28": "5.7x28", "Caliber1143x23ACP": ".45 ACP",
    "Caliber9x18PM": "9x18 PM", "Caliber762x25TT": "7.62x25 TT", "Caliber9x21": "9x21",
    "Caliber9x33R": ".357 Magnum", "Caliber762x35": ".300 BLK", "Caliber366TKM": ".366 TKM",
    "Caliber127x55": "12.7x55", "Caliber127x99": ".50 BMG", "Caliber127x33": ".50 AE",
    "Caliber12g": "12/70", "Caliber20g": "20/70", "Caliber23x75": "23x75", "Caliber26x75": "26x75",
    "Caliber40x46": "40x46", "Caliber40mmRU": "40mm", "Caliber20x1mm": "20x1mm",
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
MODE = {
    "single": "单发",
    "semiauto": "半自动",
    "fullauto": "全自动",
    "burst": "点射",
    "doublet": "双发",
    "doubleaction": "双动",
}


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def clean(s: str) -> str:
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def modes(v) -> str:
    return " / ".join(MODE.get(m, m) for m in (v or [])) or "—"


def fetch() -> list[dict]:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    rows = []
    for v in items.values():
        p = v.get("properties") or {}
        if p.get("propertiesType") != "ItemPropertiesWeapon":
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        rows.append({
            "name": clean(name),
            "cal": p.get("caliber"),
            "modes": modes(p.get("fireModes")),
            "rate": p.get("fireRate"),
            "ergo": p.get("ergonomics"),
            "rv": p.get("recoilVertical"),
            "rh": p.get("recoilHorizontal"),
            "dist": p.get("effectiveDistance"),
            "dur": p.get("maxDurability"),
        })
    rows.sort(key=lambda r: (
        CAL_ORDER.index(r["cal"]) if r["cal"] in CAL_ORDER else 999,
        -(r["rate"] or 0),
    ))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(
        json.dumps({"fetched": FETCH_DATE, "count": len(rows), "rows": rows},
                   ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"已抓取并缓存 {len(rows)} 把武器")
    return rows


def render(rows: list[dict], fetched: str) -> str:
    out = [
        "## 📊 逐型号武器数值表",
        "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">",
        "> **怎么读**：**人机**越高越好（开镜与换弹更快）；**后坐**两值是**裸枪**基准，改装配件后都会变（见[枪械改装](gunsmith.md)）；"
        "**有效距离**是伤害与穿深开始衰减的距离。同一口径内按**射速降序**。",
        ">",
        "> ⚠️ **本表是裸枪基准值**——同一把枪装不同配件，后坐、人机、精度都会明显变化；武器预设另计。**随版本调整，以游戏内为准。**",
        "",
        "| 武器 | 口径 | 射击模式 | 射速 | 人机 | 后坐（垂直 / 水平） | 有效距离 | 耐久 |",
        "|------|------|----------|------|------|---------------------|----------|------|",
    ]
    prev = None
    for r in rows:
        cal = CAL_LABEL.get(r["cal"], r["cal"] or "—")
        cell = f"**{cal}**" if cal != prev else ""
        prev = cal
        out.append(
            f"| {cell} | {r['name']} | {r['modes']} | {r['rate']} | {r['ergo']} "
            f"| {r['rv']} / {r['rh']} | {r['dist']} | {r['dur']} |"
        )
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
    print(f"已写入 {TARGET.relative_to(ROOT)}：{len(rows)} 把武器")


if __name__ == "__main__":
    main()
