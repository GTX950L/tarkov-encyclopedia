#!/usr/bin/env python3
"""生成四张「小件装备」数值表：耳机 / 夜视 / 手雷投掷物 / 近战武器。

数据源与写入方式同 scripts/gen_ammo_values.py（json.tarkov.dev/regular/ 的 items ＋ items_zh）。
一个脚本管四类，因为它们的字段都很少、且共用同一套骨架。

用法：
    python scripts/gen_gear_values.py --fetch
    python scripts/gen_gear_values.py
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "data" / "gear_values.json"
API = "https://json.tarkov.dev/regular/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
FETCH_DATE = "2026-10-06"

# kind → (propertiesType, 目标文件, 标记前缀)
KINDS = {
    "headset": ("ItemPropertiesHeadphone", "content/entries/headsets.md", "HEADSET"),
    "nvg": ("ItemPropertiesNightVision", "content/entries/night-vision.md", "NVG"),
    "grenade": ("ItemPropertiesGrenade", "content/entries/grenades.md", "GRENADE"),
    "melee": ("ItemPropertiesMelee", "content/entries/weapons.md", "MELEE"),
}
CLOSE = {
    "Combat": "战斗",
}


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def clean(s: str) -> str:
    return (s or "").replace('"', "”").replace("|", "｜").strip()


def num(x, suffix="", digits=None):
    if x is None:
        return "—"
    if digits is not None:
        return f"{x:.{digits}f}{suffix}"
    return f"{x}{suffix}"


def fetch() -> dict:
    items = get("items")["data"]["items"]
    zh = get("items_zh")["data"]
    out: dict[str, list] = {k: [] for k in KINDS}
    for v in items.values():
        p = v.get("properties") or {}
        pt = p.get("propertiesType")
        kind = next((k for k, (t, _, _) in KINDS.items() if t == pt), None)
        if not kind:
            continue
        iid = v["id"]
        name = zh.get(iid + " ShortName") or zh.get(iid + " Name") or v.get("normalizedName") or iid
        r = {"name": clean(name)}
        if kind == "headset":
            r.update({
                "thr": p.get("compressorThreshold"),
                "dist": p.get("distanceModifier"),
                "dis": p.get("distortion"),
            })
        elif kind == "nvg":
            r.update({"inten": p.get("intensity"), "noise": p.get("noiseIntensity")})
        elif kind == "grenade":
            r.update({
                "fuse": p.get("fuse"),
                "rmin": p.get("minExplosionDistance"),
                "rmax": p.get("maxExplosionDistance"),
                "frag": p.get("fragments"),
                "cont": p.get("contusionRadius"),
                "type": p.get("type"),
            })
        else:  # melee
            r.update({
                "slash": p.get("slashDamage"),
                "stab": p.get("stabDamage"),
                "hit": p.get("hitRadius"),
            })
        out[kind].append(r)
    out["headset"].sort(key=lambda x: (x["dist"] if x["dist"] is not None else -9))
    out["nvg"].sort(key=lambda x: -(x["inten"] or 0))
    out["grenade"].sort(key=lambda x: (x["fuse"] or 0, -(x["rmax"] or 0)))
    out["melee"].sort(key=lambda x: (-(x["stab"] or 0), -(x["slash"] or 0)))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"fetched": FETCH_DATE, **out}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    for k, rows in out.items():
        print(f"  {k}: {len(rows)}")
    return out


def header(title: str, fetched: str, read: str, warn: str) -> list[str]:
    return [
        f"## 📊 {title}", "",
        f"> **口径**：{fetched} 抓取 ｜ 本站基线 1.1.5.1（第一赛季 KORD BREACH）"
        "｜ **来源**：二级（tarkov.dev 结构化数据端点 ＋ 中文译名字典）",
        ">", f"> **怎么读**：{read}", ">", f"> ⚠️ {warn}", "",
    ]


def render(data: dict, fetched: str) -> dict[str, str]:
    b = {}

    o = header("逐型号数值表", fetched,
               "**降噪阈值**越接近 0，耳机越不压「远处的枪声」；**距离加成**是它对声源距离的放大倍率；"
               "**失真**越低，音色越干净。按距离加成升序。",
               "官方**从未公布听感相关的参数**（0.16.5.0 起已把各款音量差拉平），"
               "本表列的是**端点里的客观参数**，与「哪款更好听」是两回事。**随版本调整，以游戏内为准。**")
    o += ["| 耳机 | 降噪阈值 | 距离加成 | 失真 |", "|------|----------|----------|------|"]
    for r in data["headset"]:
        o.append(f"| {r['name']} | {num(r['thr'])} | {num(r['dist'], '', 3)} | {num(r['dis'], '', 2)} |")
    b["headset"] = "\n".join(o)

    o = header("逐型号数值表", fetched,
               "**亮度**是夜视增益，越高越亮；**噪点**越低画面越干净。按亮度降序。",
               "数据端点只给这三个渲染参数，**不给视野角与代际**——后者见本页正文的代际表。**随版本调整，以游戏内为准。**")
    o += ["| 夜视仪 | 亮度 | 噪点 |", "|--------|------|------|"]
    for r in data["nvg"]:
        o.append(f"| {r['name']} | {num(r['inten'], '', 2)} | {num(r['noise'], '', 3)} |")
    b["nvg"] = "\n".join(o)

    o = header("逐型号数值表", fetched,
               "**引信**是投出后的引爆秒数（越短越难躲、也越难做假动作）；**伤害半径**是致命区，"
               "**眩晕半径**比它更大——**站在伤害半径外不等于安全**。",
               "本表不含坐标与投掷角度；**反弹机制**见本页正文。**随版本调整，以游戏内为准。**")
    o += ["| 投掷物 | 引信（秒） | 伤害半径 | 碎片数 | 眩晕半径 |",
          "|--------|------------|----------|--------|----------|"]
    for r in data["grenade"]:
        rng = "—" if not r["rmax"] else f"{num(r['rmin'])}–{num(r['rmax'])} m"
        o.append(f"| {r['name']} | {num(r['fuse'])} | {rng} | {num(r['frag'])} | {num(r['cont'])} m |")
    b["grenade"] = "\n".join(o)

    o = header("近战武器数值表", fetched,
               "**刺击**伤害普遍高于劈砍，但命中判定更窄；**命中半径**决定你得多贴多近。按刺击降序。",
               "近战只在弹尽、静默清场与特定任务里有意义，**不是主战手段**。**随版本调整，以游戏内为准。**")
    o += ["| 近战武器 | 劈砍 | 刺击 | 命中半径 |", "|----------|------|------|----------|"]
    for r in data["melee"]:
        o.append(f"| {r['name']} | {num(r['slash'])} | {num(r['stab'])} | {num(r['hit'], '', 2)} |")
    b["melee"] = "\n".join(o)
    return b


def write_section(target: Path, start: str, end: str, block: str) -> None:
    text = target.read_text(encoding="utf-8")
    if start not in text or end not in text:
        sys.exit(f"错误：{target.relative_to(ROOT)} 里找不到 {start}")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    target.write_text(f"{head}{start}\n\n{block}\n\n{end}{tail}", encoding="utf-8")


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
        data = {k: d[k] for k in KINDS}
    blocks = render(data, fetched)
    for kind, (_, rel, tag) in KINDS.items():
        start, end = f"<!-- AUTO-GEN:{tag}-VALUES:START -->", f"<!-- AUTO-GEN:{tag}-VALUES:END -->"
        write_section(ROOT / rel, start, end, blocks[kind])
        print(f"已写入 {rel}：{len(data[kind])} 条")


if __name__ == "__main__":
    main()
