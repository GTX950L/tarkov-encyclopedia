#!/usr/bin/env python3
"""为《枪械评测》页准备两个静态数据文件：枪型分类 + 供给渠道。

数据源（**全部本地，不联网**）：
  · scripts/data/items_full.json  —— tarkov.dev 全量快照，2026-10-08 抓取（5498 件）
  · scripts/data/recipes.json     —— 交换 / 制作配方，2026-10-06 抓取（855 + 214 条）
  · scripts/data/weapon_values.json —— 现有 172 行数值表，只用来**交叉校验**，不写入

产出：
  · scripts/data/weapon_class.json  —— 枪 → 官方枪型 / 口径 / 裸枪属性 / 可用弹
  · scripts/data/weapon_supply.json —— 枪与弹 → 商人出售 / 以物换物 / 制作

用法：
    python scripts/gen_weapon_eval_data.py            # 生成并打印覆盖率
    python scripts/gen_weapon_eval_data.py --check    # 只校验，不写文件

设计约束（与站点口径一致）：
  1. **不引入跳蚤价**。本站立场是不收录跳蚤价，`buyFromTrader` 只取商人固定售价。
  2. **供给三档不等于「能不能拿到」**。都没有记录的写 `scav`（仅搜刮/跳蚤），
     这是游戏事实，不是数据缺失 —— 页面必须照这个措辞写。
  3. **同名跨口径不合并**。`MDR` 有 5.56 与 7.62×51 两把，按 id 组织，
     名称只在展示时拼接口径后缀。
  4. 抓取日期取快照自带的 `fetched`，**不写当天** —— 否则每次重跑都会漂。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"

ITEMS_FULL = DATA / "items_full.json"
RECIPES = DATA / "recipes.json"
WEAPON_VALUES = DATA / "weapon_values.json"
OUT_CLASS = DATA / "weapon_class.json"
OUT_AMMO = DATA / "weapon_ammo.json"
OUT_SUPPLY = DATA / "weapon_supply.json"

# 武器的 11 个官方子类（itemCategories 里 parent = 武器根节点）。
# revolver / rocket-launcher 在译名表里没有中文名，这里补上与图鉴页一致的叫法。
WEAPON_ROOT = "5422acb9af1c889c16000029"
CLASS_ZH_FALLBACK = {
    "revolver": "左轮手枪",
    "rocket-launcher": "火箭发射器",
}
# 不参与评测的分类：没有「操控」可言，或只有 1 件
CLASS_EXCLUDE = {"rocket-launcher"}

# 商人 id → 名称。与 scripts/gen_items_catalog.py 的 TRADERS 保持同源，改一处要改两处。
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

# 口径内部代号 → 站内既有叫法（与 gen_weapon_values.py 的 CAL_LABEL 一致）
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
MODE_ZH = {"single": "单发", "semiauto": "半自动", "fullauto": "全自动",
           "burst": "点射", "doublet": "双发", "doubleaction": "双动"}

# 名称归一化：现有数值表由 gen_weapon_values.py 的 clean() 生成，会把直引号换成
# 全角右引号；两边的引号形态不同，直接 join 会漏。这里统一成直引号再比。
QUOTE_MAP = {"”": '"', "“": '"', "’": "'", "‘": "'", "＂": '"'}

# 译名跨版本漂移的个别条目（左：数值表旧写法，右：快照 ShortName）。
# 只登记**确认是同一把枪**的；同名跨口径的绝不写进这张表。
NAME_ALIAS = {
    "P90 Scourge": "P90 灾厄",
}


def norm(s: str) -> str:
    s = s or ""
    for a, b in QUOTE_MAP.items():
        s = s.replace(a, b)
    return " ".join(s.split()).strip()


def canon(s: str) -> str:
    s = norm(s)
    return NAME_ALIAS.get(s, s)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build() -> tuple[dict, dict, dict]:
    full = load(ITEMS_FULL)
    recipes = load(RECIPES)
    zh = full["zh"]
    items = full["items"]["items"]
    cats = full["items"]["itemCategories"]

    # ── 分类树：id → {zh, en}；只保留武器的 11 个子类
    class_of: dict[str, str] = {}
    classes: dict[str, dict] = {}
    for cid, c in cats.items():
        if c.get("parent") != WEAPON_ROOT:
            continue
        en = c.get("normalizedName") or ""
        nm = zh.get(cid + " Name") or CLASS_ZH_FALLBACK.get(en, en)
        class_of[cid] = nm
        classes[nm] = {"en": en, "id": cid}

    # ── 供给：以物换物 / 制作，按 product id 归并
    barter: dict[str, list] = defaultdict(list)
    for b in recipes.get("barters") or []:
        barter[b["product"]].append({"t": b.get("trader") or "—",
                                     "lv": b.get("level") or 1,
                                     "task": bool(b.get("task"))})
    craft: dict[str, list] = defaultdict(list)
    for c in recipes.get("crafts") or []:
        craft[c["product"]].append({"st": c.get("station") or "—",
                                    "lv": c.get("level") or 1})

    def supply(item_id: str, item: dict) -> dict:
        buys = []
        for r in item.get("buyFromTrader") or []:
            who = TRADERS.get(r.get("trader") or "")
            if not who:
                continue          # 未知商人（活动 / 已下架）不收录，避免瞎标
            buys.append({"t": who,
                         "lv": r.get("minTraderLevel") or 1,
                         "p": r.get("priceRUB"),
                         "task": bool(r.get("taskUnlock"))})
        buys.sort(key=lambda x: (x["p"] is None, x["p"] or 0))
        return {"buy": buys, "barter": barter.get(item_id, []),
                "craft": craft.get(item_id, [])}

    def tier(s: dict) -> str:
        if s["buy"]:
            return "buy"
        if s["barter"]:
            return "barter"
        if s["craft"]:
            return "craft"
        return "scav"

    # ── 弹药：按 id 建索引，供枪的 allowedAmmo 反查
    ammo_items = {k: v for k, v in items.items()
                  if (v.get("properties") or {}).get("propertiesType") == "ItemPropertiesAmmo"}

    def ammo_row(k: str) -> dict:
        v = ammo_items[k]
        p = v["properties"]
        cal = p.get("caliber") or ""
        return {
            "id": k,
            "name": (zh.get(k + " ShortName") or zh.get(k + " Name") or "").strip(),
            "full": (zh.get(k + " Name") or "").strip(),
            "cal": cal,
            "calZh": CAL_LABEL.get(cal, cal.replace("Caliber", "")),
            "dmg": p.get("damage"),
            "pen": p.get("penetrationPower"),
            "armor": p.get("armorDamage"),
            "speed": p.get("initialSpeed"),
            "frag": p.get("fragmentationChance"),
            "misfire": p.get("misfireChance"),
            "ftf": p.get("failureToFeedChance"),
            "recoilMod": p.get("recoilModifier"),
            "accMod": p.get("accuracyModifier"),
            "tier": tier(supply(k, v)),
        }

    ammo_out: dict[str, dict] = {}
    for k in ammo_items:
        row = ammo_row(k)
        row["supply"] = supply(k, ammo_items[k])
        ammo_out[k] = row

    # ── 枪
    weapons = []
    for k, v in items.items():
        if "gun" not in (v.get("types") or []):
            continue
        p = v.get("properties") or {}
        cls = next((class_of[c] for c in (v.get("categories") or []) if c in class_of), "")
        if not cls or classes.get(cls, {}).get("en") in CLASS_EXCLUDE:
            continue
        cal = p.get("caliber") or ""
        allowed = [a for a in (p.get("allowedAmmo") or []) if a in ammo_out]
        s = supply(k, v)
        weapons.append({
            "id": k,
            "name": norm(zh.get(k + " ShortName") or zh.get(k + " Name") or ""),
            "full": norm(zh.get(k + " Name") or ""),
            "slug": v.get("normalizedName") or "",
            "cls": cls,
            "clsEn": classes.get(cls, {}).get("en", ""),
            "cal": cal,
            "calZh": CAL_LABEL.get(cal, cal.replace("Caliber", "")),
            "weight": v.get("weight"),
            "ergo": p.get("ergonomics"),
            "rv": p.get("recoilVertical"),
            "rh": p.get("recoilHorizontal"),
            "rate": p.get("fireRate"),
            "modes": [MODE_ZH.get(m, m) for m in (p.get("fireModes") or [])],
            "dist": p.get("effectiveDistance"),
            "dur": p.get("maxDurability"),
            "sight": p.get("sightingRange"),
            "coi": p.get("centerOfImpact"),
            "ammo": allowed,
            "supply": s,
            "tier": tier(s),
        })
    weapons.sort(key=lambda w: (w["cls"], w["calZh"], -(w["rate"] or 0), w["name"]))

    klass = {
        "fetched": full.get("fetched"),
        "source": "items_full.json（tarkov.dev 快照）",
        "baseline": "1.2.0.0",
        "note": "裸枪属性；人机/后坐不含任何配件。同名跨口径按 id 区分，不合并。",
        "classes": classes,
        "weapons": weapons,
    }
    sup = {
        "fetched": full.get("fetched"),
        "recipesFetched": recipes.get("fetched"),
        "source": "items_full.json 的 buyFromTrader ＋ recipes.json 的 barters / crafts",
        "note": "scav = 站内未收录任何固定渠道（商人出售 / 以物换物 / 制作），"
                "通常是任务解锁后商人才有报价、或只能靠跳蚤与搜刮；不是「拿不到」。不含跳蚤价。",
        "weapons": {w["id"]: w["supply"] for w in weapons},
    }
    # 弹的数值与渠道放同一个文件：两者一一对应，拆开就会漂
    ammo_payload = {
        "fetched": full.get("fetched"),
        "source": "items_full.json（ItemPropertiesAmmo）＋ recipes.json",
        "note": "pen 为穿深；档位 N ⇒ 穿深 ≥ (N−1)×10（与 entries/ammo.md 同口径）。",
        "ammo": ammo_out,
    }
    return klass, ammo_payload, sup


def report(klass: dict, ammo_payload: dict, sup: dict) -> None:
    ws = klass["weapons"]
    ammo = ammo_payload["ammo"]
    print("=" * 72)
    print(f"枪 {len(ws)} 把 ｜ 弹 {len(ammo)} 条 ｜ 快照 {klass['fetched']} ｜ 配方 {sup['recipesFetched']}")
    print("-" * 72)
    print("按官方枪型：")
    for cls, n in Counter(w["cls"] for w in ws).most_common():
        en = klass["classes"].get(cls, {}).get("en", "")
        print(f"  {cls:<10} n={n:<4} ({en})")

    print("-" * 72)
    print("枪的供给渠道：")
    ct = Counter(w["tier"] for w in ws)
    lab = {"buy": "商人出售", "barter": "以物换物", "craft": "制作", "scav": "仅搜刮/未收录"}
    for t in ("buy", "barter", "craft", "scav"):
        print(f"  {lab[t]:<10} {ct.get(t, 0):>4} 把  {ct.get(t,0)/len(ws)*100:5.1f}%")

    print("-" * 72)
    print("弹的供给渠道：")
    at = Counter(v["tier"] for v in ammo.values())
    for t in ("buy", "barter", "craft", "scav"):
        print(f"  {lab[t]:<10} {at.get(t, 0):>4} 条  {at.get(t,0)/len(ammo)*100:5.1f}%")

    print("-" * 72)
    print("枪型 × 射击模式 分组规模（组内 >=5 才能分三档）：")
    groups: dict[tuple, list] = defaultdict(list)
    for w in ws:
        modes = w["modes"]
        mk = "全自动" if "全自动" in modes else ("栓动" if (w["rate"] or 0) <= 60 else "半自动")
        groups[(w["cls"], mk)].append(w)
    small = 0
    for (cls, mk), g in sorted(groups.items(), key=lambda x: -len(x[1])):
        flag = "" if len(g) >= 5 else "   ← 不足 5，不分档"
        if len(g) < 5:
            small += len(g)
        print(f"  {cls:<10}{mk:<5} n={len(g):<3}{flag}")
    print(f"  ── 落在 n<5 小组的枪：{small}/{len(ws)} = {small/len(ws)*100:.0f}%")

    # 交叉校验：与现有 172 行数值表比
    if WEAPON_VALUES.exists():
        rows = load(WEAPON_VALUES)["rows"]
        key = {(canon(w["name"]), w["cal"]): w for w in ws}
        ok = miss = 0
        bad = []
        missed = []
        for r in rows:
            w = key.get((canon(r["name"]), r["cal"]))
            if not w:
                miss += 1
                missed.append(f'{r["name"]}({r["cal"].replace("Caliber","")})')
                continue
            if (w["ergo"], w["rv"], w["rh"], w["rate"]) == (r["ergo"], r["rv"], r["rh"], r["rate"]):
                ok += 1
            else:
                bad.append(r["name"])
        print("-" * 72)
        print(f"与现有数值表交叉校验：一致 {ok} ｜ 有差异 {len(bad)} {bad[:5]} ｜ 未匹配 {miss} {missed[:5]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    for f in (ITEMS_FULL, RECIPES):
        if not f.exists():
            sys.exit(f"缺少数据文件：{f.relative_to(ROOT)}")

    klass, ammo_payload, sup = build()
    report(klass, ammo_payload, sup)

    if args.check:
        print("\n--check：未写文件")
        return 0

    for path, payload in ((OUT_CLASS, klass), (OUT_AMMO, ammo_payload), (OUT_SUPPLY, sup)):
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"写入 {path.relative_to(ROOT)}  {path.stat().st_size/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
