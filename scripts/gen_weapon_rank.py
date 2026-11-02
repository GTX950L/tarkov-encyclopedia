#!/usr/bin/env python3
"""生成《枪械评测》里的「逐枪位次表」（AUTO-GEN 区块）。

**本页不给综合分。** 只做两件机器能算的事：
  ① 同组位次 —— 「同枪型 + 同射击模式」组内，按 人机 0.40 / 垂直后坐 0.35 /
     水平后坐 0.25 取百分位，分强/中/弱三档。组内不足 5 把不分档（标「—」）。
  ② 弹与来源 —— 每把枪挑一条「能买到的最高穿深弹」作主力弹，标穿深档与来源；
     枪与弹的固定渠道各自标注。

为什么不做综合分：裸枪位次与实战强度会背离（实测 5.56 全自动组 AUG A3 第一、
HK 416A5 倒数第二，而 416 改装后是主流选择）。把两者混成一个数是误导，
详见 content/entries/weapon-evaluation.md 的「⚠️ 常见误读」。

数据源（本地，不联网）：
  · scripts/data/weapon_class.json    —— gen_weapon_eval_data.py 产出
  · scripts/data/weapon_supply.json   —— 同上

用法：
    python scripts/gen_weapon_rank.py           # 写入 content/entries/weapon-evaluation.md
    python scripts/gen_weapon_rank.py --dry     # 只打印，不写文件
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _baseline import baseline_label  # noqa: E402

DATA = ROOT / "scripts" / "data"
TARGET = ROOT / "content" / "entries" / "weapon-evaluation.md"

START = "<!-- AUTO-GEN:WEAPON-RANK:START -->"
END = "<!-- AUTO-GEN:WEAPON-RANK:END -->"
CAL_START = "<!-- AUTO-GEN:CALIBER-TOP:START -->"
CAL_END = "<!-- AUTO-GEN:CALIBER-TOP:END -->"

# 权重：唯一一处数字，页面正文必须引用同一组值。改这里就要改页面说明。
W_ERGO, W_RV, W_RH = 0.40, 0.35, 0.25
MIN_GROUP = 5          # 组内少于此数不分档
TIER_CUT = (2 / 3, 1 / 3)

CLASS_ORDER = [
    "突击步枪", "突击卡宾枪", "冲锋枪", "霰弹枪", "自动手枪",
    "手枪", "左轮手枪", "精确射手步枪", "狙击步枪", "机枪", "榴弹发射器",
]
MODE_ORDER = ["全自动", "点射", "半自动", "单发", "栓动", "双动", "双发"]

SRC_LABEL = {"buy": "商人出售", "barter": "以物换物", "craft": "制作", "scav": "无固定渠道"}
# 「无渠道」不用「仅搜刮」：顶级穿甲弹多数是任务解锁后才有报价，或只能跳蚤/搜刮，
# 统称「搜刮」会把「任务解锁」也算进去，不准确。
SRC_SHORT = {"buy": "商人", "barter": "物换", "craft": "制作", "scav": "无渠道"}
# 渠道优先级：合并变体时取「更好的那一个」——能买到 > 能换到 > 能做 > 只能搜刮
SRC_RANK = {"buy": 0, "barter": 1, "craft": 2, "scav": 3}


def dedupe(ws: list[dict]) -> list[dict]:
    """同名称 + 同口径 + 全数值相同 → 合并为一条（方案里的去重规则之一）。

    同名但跨口径的（MDR 5.56 / 7.62×51、沙漠之鹰 L5 两种弹药）**不合并**，
    因此签名里必须带 cal。合并后渠道取最优的那个，并记下变体数。
    """
    def sig(w):
        return (w["name"], w["cal"], w["ergo"], w["rv"], w["rh"],
                w["rate"], w["dist"], w["dur"])

    seen: dict[tuple, dict] = {}
    order: list[tuple] = []
    for w in ws:
        k = sig(w)
        if k in seen:
            cur = seen[k]
            cur["variants"] += 1
            if SRC_RANK[w["tier"]] < SRC_RANK[cur["tier"]]:
                cur["tier"] = w["tier"]
                cur["supply"] = w["supply"]
        else:
            w["variants"] = 1
            seen[k] = w
            order.append(k)
    return [seen[k] for k in order]


def load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def mode_key(w: dict) -> str:
    """把 fireModes 归成一个主模式 —— 分档组键用。"""
    m = w.get("modes") or []
    if "全自动" in m:
        return "全自动"
    if "点射" in m:
        return "点射"
    if "栓动" not in m and (w.get("rate") or 0) <= 60 and "双动" in m:
        return "双动"
    if (w.get("rate") or 0) <= 60:
        return "栓动"
    return "半自动"


def pct_rank(vals: list[float], invert: bool = False) -> list[float]:
    """百分位秩：并列取平均位次。invert=True 表示数值越小越好。"""
    n = len(vals)
    out = []
    for v in vals:
        below = sum(1 for x in vals if x < v)
        equal = sum(1 for x in vals if x == v)
        p = (below + 0.5 * equal) / n * 100
        out.append(100 - p if invert else p)
    return out


def pen_tier(pen: float) -> int:
    """穿深 → 穿深档。站内判据：档位 N ⇒ 穿深 ≥ (N−1)×10，N 封顶 6。"""
    if pen is None:
        return 0
    return max(1, min(6, int(pen // 10) + 1))


def cell(v, dash: str = "—") -> str:
    return dash if v is None or v == "" else str(v)


def clean(s: str) -> str:
    """单元格清洗：竖线换成全角（否则撑破表格），直引号换成全角右引号。
    与 gen_weapon_values.py 的 clean() 同口径 —— 站规禁止中文正文里出现直引号。"""
    return (s or "").replace("|", "｜").replace('"', "”").strip()


def build(klass: dict, ammo_payload: dict, supply: dict) -> tuple[list[str], dict]:
    ws = dedupe(list(klass["weapons"]))
    ammo_meta = ammo_payload["ammo"]

    # 分组 → 计算位次
    groups: dict[tuple, list] = defaultdict(list)
    for w in ws:
        groups[(w["cls"], mode_key(w))].append(w)

    rank: dict[str, float | None] = {}
    gstat: dict[tuple, int] = {}
    for key, g in groups.items():
        gstat[key] = len(g)
        if len(g) < MIN_GROUP:
            for w in g:
                rank[w["id"]] = None
            continue
        e = pct_rank([w["ergo"] or 0 for w in g])
        rv = pct_rank([w["rv"] or 0 for w in g], invert=True)
        rh = pct_rank([w["rh"] or 0 for w in g], invert=True)
        for i, w in enumerate(g):
            rank[w["id"]] = W_ERGO * e[i] + W_RV * rv[i] + W_RH * rh[i]

    def tier_of(w: dict) -> str:
        s = rank.get(w["id"])
        if s is None:
            return "—"
        if s >= TIER_CUT[0] * 100:
            return "⭐ 强"
        if s <= TIER_CUT[1] * 100:
            return "弱"
        return "中"

    # 每把枪挑主力弹：优先「有固定渠道」的最高穿深弹
    def main_ammo(w: dict) -> tuple[dict | None, bool]:
        cands = [ammo_meta[a] for a in w["ammo"] if a in ammo_meta]
        if not cands:
            return None, False
        buyable = [a for a in cands if a["tier"] != "scav"]
        pool = buyable or cands
        best = max(pool, key=lambda a: (a.get("pen") or 0, a.get("dmg") or 0))
        # 是否存在「无固定渠道但穿深更高」的弹
        hidden = any((a.get("pen") or 0) > (best.get("pen") or 0) for a in cands)
        return best, hidden

    # 按枪型 × 模式输出
    out: list[str] = [
        "## 📊 逐枪位次",
        "",
        "> **怎么读**：`人机` 越高越好；`后坐` 两值是裸枪基准，改装后都会降；"
        "`主力弹` 取该枪能打、且**有固定渠道**的最高穿深弹——买不到的顶级弹不算主力弹。",
        ">",
        "> `*` 表示这把枪还有穿深更高、但站内未收录固定渠道的弹（通常只能搜刮或从跳蚤买）。"
        "`×N` 表示 N 个变体的数值完全相同，已合并为一行。",
        ">",
        "> **位次是裸枪操控，不是强度。** 位次低的枪多半是改装上限高，见 [⚠️ 常见误读](#misread)。",
        "",
    ]
    byc: dict[str, list] = defaultdict(list)
    for w in ws:
        byc[w["cls"]].append(w)

    for cls in CLASS_ORDER + ["Revolver"]:
        g = byc.get(cls)
        if not g:
            continue
        n_all = len(g)
        out.append(f"### {cls}（{n_all} 把）")
        out.append("")
        # 组内分档说明
        sub: list[str] = []
        for mk in MODE_ORDER:
            gg = [w for w in g if mode_key(w) == mk]
            if gg:
                sub.append(f"{mk} {len(gg)}")
        if sub:
            out.append(f"> 组内构成：{' ｜ '.join(sub)}。位次**只在同一组内可比**，跨组不可比。")
            out.append("")
        out.append("| 型号（口径） | 模式 | 射速 | 人机 | 后坐（垂直/水平） | 主力弹 | 弹档 | 弹来源 | 枪来源 | 位次 |")
        out.append("|---|---|---|---|---|---|---|---|---|---|")
        g_sorted = sorted(g, key=lambda w: (MODE_ORDER.index(mode_key(w))
                                            if mode_key(w) in MODE_ORDER else 99,
                                            -(rank.get(w["id"]) or -1), -(w["rate"] or 0)))
        for w in g_sorted:
            a, hidden = main_ammo(w)
            ammo_cell = clean(a["name"]) if a else "—"
            if hidden:
                ammo_cell += " *"
            pen_cell = f"{pen_tier(a['pen'])} 级档" if a and a.get("pen") is not None else "—"
            ammo_src = SRC_SHORT.get(a["tier"], "—") if a else "—"
            nm = clean(w["name"])
            if w.get("variants", 1) > 1:
                nm += f" ×{w['variants']}"
            out.append(
                f"| {nm}（{w['calZh']}） | {mode_key(w)} | {cell(w['rate'])} | "
                f"{cell(w['ergo'])} | {cell(w['rv'])} / {cell(w['rh'])} | {ammo_cell} | "
                f"{pen_cell} | {ammo_src} | {SRC_SHORT.get(w['tier'], '—')} | {tier_of(w)} |"
            )
        out.append("")

    stats = {"groups": gstat, "rank": rank, "total": len(ws), "tiers": {}}
    for w in ws:
        t = tier_of(w)
        stats["tiers"][t] = stats["tiers"].get(t, 0) + 1
    return out, stats


def build_caliber(ammo_payload: dict, klass: dict) -> list[str]:
    """口径 → 顶级弹。这是「先看弹」那一步的唯一依据。"""
    ammo = ammo_payload["ammo"]
    # 口径下有几把枪（决定这个口径值不值得练）
    guns_of: dict[str, set] = defaultdict(set)
    for w in klass["weapons"]:
        guns_of[w["cal"]].add(w["name"])

    by_cal: dict[str, list] = defaultdict(list)
    for a in ammo.values():
        by_cal[a["cal"]].append(a)

    rows = []
    for cal, lst in by_cal.items():
        best = max(lst, key=lambda a: (a.get("pen") or 0, a.get("dmg") or 0))
        # 同一穿深下是否有更便宜的渠道弹（有商人渠道的最高穿深弹）
        buyable = [a for a in lst if a["tier"] != "scav"]
        best_buy = max(buyable, key=lambda a: (a.get("pen") or 0, a.get("dmg") or 0)) if buyable else None
        rows.append({
            "cal": best["calZh"], "calRaw": cal,
            "name": best["name"], "pen": best.get("pen"), "dmg": best.get("dmg"),
            "tier": best["tier"], "penTier": pen_tier(best.get("pen")),
            "buyName": best_buy["name"] if best_buy else None,
            "buyPen": (best_buy or {}).get("pen"),
            "buyTier": (best_buy or {}).get("tier"),
            "nAmmo": len(lst), "nGun": len(guns_of.get(cal, ())),
        })
    rows.sort(key=lambda r: (-(r["pen"] or 0), r["cal"]))
    # 没有枪的口径不进表 —— 本页是枪械评测，下挂榴弹这类口径对选枪没有意义
    rows = [r for r in rows if r["nGun"] > 0]

    # 顶级弹的可供性 —— 这是本页最反直觉的一条，数字现场算，不写死
    deep = [a for a in ammo.values() if (a.get("pen") or 0) >= 50]
    deep_ok = [a for a in deep if a["tier"] != "scav"]
    n_all, n_ok = len(deep), len(deep_ok)
    ok_names = "、".join(clean(a["name"]) for a in deep_ok) or "无"
    if len(deep_ok) > 5:
        ok_names = "、".join(clean(a["name"]) for a in deep_ok[:5]) + " 等"

    # 能通过固定渠道长期供上 6 级档弹（穿深 ≥50）的口径 —— 选型的硬结论
    stable6 = [r for r in rows if (r["buyPen"] or 0) >= 50]
    if stable6:
        s6 = "、".join(f'{r["cal"]}（{clean(r["buyName"])} {r["buyPen"]}·{SRC_SHORT.get(r["buyTier"], "—")}）'
                       for r in stable6)
        s6_line = (f'> 🎯 **能长期供上 6 级档弹的口径只有 {len(stable6)} 个**：{s6}。'
                   "其余口径的 6 级档弹都只能靠任务解锁、搜刮或跳蚤——"
                   "**长期打 5–6 级甲的话，口径选择基本被这一行锁死。**")
    else:
        s6_line = "> 🎯 目前没有任何口径能通过固定渠道稳定供上 6 级档弹。"

    out = ["<a id=\"caliber-top\"></a>", "", "## 📊 口径与顶级弹", "",
           "> **先看这一节，再看枪。** 每个口径列出**穿深最高的那一发弹**，以及它的获取渠道。"
           "档位按站内判据换算：穿深 ≥ (N−1)×10 记 N 级档，能有效对付 N−1 级甲。", "",
           f"> ⚠️ **顶级弹基本买不到。** 全站穿深 ≥50 的弹共 **{n_all} 发**，"
           f"站内收录了固定渠道（商人出售 / 以物换物 / 制作）的只有 **{len(deep_ok)} 发（{ok_names}）**。"
           "其余要靠任务解锁后商人才有报价、工作台自制，或直接搜刮。"
           "**所以「顶级弹」和「能长期供上的弹」是两件事** —— 右列就是后者。", "",
           s6_line, "",
           "| 口径 | 顶级弹 | 穿深 | 伤害 | 档位 | 顶级弹渠道 | 能供上的最高弹 | 该口径枪数 |",
           "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        src = SRC_SHORT.get(r["tier"], "—")
        buy = (f'{clean(r["buyName"])}（{r["buyPen"]}·{SRC_SHORT.get(r["buyTier"], "—")}）'
               if r["buyName"] else "—")
        out.append(f'| **{r["cal"]}** | {clean(r["name"])} | {cell(r["pen"])} | {cell(r["dmg"])} | '
                   f'{r["penTier"]} 级档 | {src} | {buy} | {r["nGun"]} |')
    out.append("")
    out.append("> **「能供上的最高弹」怎么算**：在该口径所有弹里，取**有固定渠道**的最高穿深那一发。"
               "它常常比「顶级弹」低一两个档位，但那是你实际能按月供上的东西 —— "
               "`商人` 直接买 ｜ `物换` 商人交换 ｜ `制作` 藏身处工作台 ｜ `无渠道` 只能任务解锁后买、搜刮或跳蚤。")
    out.append("")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只打印，不写文件")
    args = ap.parse_args()

    klass_p, ammo_p, sup_p = (DATA / "weapon_class.json", DATA / "weapon_ammo.json",
                              DATA / "weapon_supply.json")
    for p in (klass_p, ammo_p, sup_p):
        if not p.exists():
            sys.exit(f"缺少 {p.relative_to(ROOT)} —— 先跑 scripts/gen_weapon_eval_data.py")
    if not TARGET.exists():
        sys.exit(f"缺少页面 {TARGET.relative_to(ROOT)} —— 先建页面骨架")

    klass, ammo, sup = load(klass_p), load(ammo_p), load(sup_p)
    body, stats = build(klass, ammo, sup)
    cal_body = build_caliber(ammo, klass)

    print(f"枪 {stats['total']} 把 ｜ 分组 {len(stats['groups'])} 个 ｜ 分档分布 {stats['tiers']}")
    for (cls, mk), n in sorted(stats["groups"].items(), key=lambda x: -x[1]):
        print(f"  {cls:<10}{mk:<5} n={n}{'   ← 不分档' if n < MIN_GROUP else ''}")

    if args.dry:
        print("\n-- CALIBER --\n" + "\n".join(cal_body[:14]))
        print("\n-- RANK --\n" + "\n".join(body[:14]))
        return 0

    page = TARGET.read_text(encoding="utf-8")
    for s, e, b in ((CAL_START, CAL_END, cal_body), (START, END, body)):
        i, j = page.find(s), page.find(e)
        if i < 0 or j < 0:
            sys.exit(f"{TARGET.name} 里找不到 {s} / {e} 标记")
        page = page[:i] + "\n".join([s, "", *b, e]) + page[j + len(e):]
    TARGET.write_text(page, encoding="utf-8")
    print(f"写入 {TARGET.relative_to(ROOT)}  总 {len(page)/1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
