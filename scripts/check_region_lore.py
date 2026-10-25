#!/usr/bin/env python3
"""战区纪事：证据台账的门禁（只读，不改文件）。

为什么要有这一层
----------------
「这片区域以前是干什么的」这类内容，最容易滑向「像真的」——
模型（或人）写出一句通顺、合理、但没有出处的断言，读者无从分辨。
本脚本把这件事故变成构建失败：

1. **结构**：字段齐全、slug 唯一、counts 与实际条数一致；
2. **锚点**：区域声明的地形锚点必须存在于 `map_labels_zh.LABELS_ZH[map]`；
   没有锚点的区域允许留空数组，但不许写一个不存在的地名；
3. **A1 回源**：`quote` 去掉空白后，必须是该任务台词（intro/done）的子串；
   任务必须真的属于本图（`ms` 含本图 slug）；
4. **A2 回源**：`quote` 去掉空白后，必须是该物品描述的原文子串；
5. **底线**：每个区域至少 1 条 A1；**确实没有台词的区域**允许 0 条 A1，
   但必须有 ≥2 条 A2（物件证据），并在正文里写明「仅有物件证据」。
   空引文、过短引文（< 8 字）一律报错。

用法
----
    python scripts/check_region_lore.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "data"))

from map_labels_zh import LABELS_ZH  # noqa: E402

DATA = ROOT / "scripts" / "data"
REGION = DATA / "region_lore.json"
QUESTS = DATA / "quests.json"
DIALOGUE = DATA / "quest_dialogue.json"
ITEMS = DATA / "item_desc_zh.json"

REQUIRED = ["slug", "name", "anchors", "oneliner", "timeline", "people", "links", "visible", "evidence", "counts"]
MIN_QUOTE = 8
A2_ONLY_FLOOR = 2


def norm(text: str) -> str:
    """去掉所有空白（含全角空格与换行）后比较 —— 排版差异不该造成假红。"""
    return re.sub(r"\s+", "", text or "")


def main() -> int:
    errors: list[str] = []
    warns: list[str] = []

    if not REGION.exists():
        print("[缺] scripts/data/region_lore.json")
        return 1
    doc = json.loads(REGION.read_text(encoding="utf-8"))
    maps = doc.get("maps") or {}
    if not maps:
        print("[空] region_lore.json 里没有任何地图")
        return 1

    quests = json.loads(QUESTS.read_text(encoding="utf-8"))["tasks"]
    dialogue = json.loads(DIALOGUE.read_text(encoding="utf-8"))["items"]
    items = json.loads(ITEMS.read_text(encoding="utf-8"))["items"]

    dialogue_by_name: dict[str, list[str]] = {}
    for rec in dialogue.values():
        blob = (rec.get("intro") or "") + "\n" + (rec.get("done") or "")
        dialogue_by_name.setdefault(rec.get("name", ""), []).append(blob)
    tasks_by_name: dict[str, list[dict]] = {}
    for t in quests:
        tasks_by_name.setdefault(t["name"], []).append(t)
    item_by_name = {v["name"]: v["desc"] for v in items.values()}

    total_regions = total_a1 = total_a2 = 0

    for map_slug, regions in maps.items():
        if map_slug not in LABELS_ZH:
            errors.append(f"[{map_slug}] 不在 map_labels_zh 的图列表里")
            continue
        seen_slugs: set[str] = set()
        labels = LABELS_ZH.get(map_slug, {})

        for r in regions:
            slug = r.get("slug", "?")
            tag = f"[{map_slug}/{slug}]"
            total_regions += 1
            for key in REQUIRED:
                if key not in r:
                    errors.append(f"{tag} 缺字段 {key}")
            if slug in seen_slugs:
                errors.append(f"{tag} slug 重复")
            seen_slugs.add(slug)

            # 2. 锚点
            for a in r.get("anchors") or []:
                if a not in labels:
                    errors.append(f"{tag} 锚点不存在于 {map_slug} 的译名表：{a}")
            if not r.get("anchors"):
                warns.append(f"{tag} 没有地形锚点（允许，页面上会写「以文字描述为准」）")

            # 3/4/5. 证据
            ev = r.get("evidence") or []
            a1 = sum(1 for e in ev if e.get("grade") == "A1")
            a2 = sum(1 for e in ev if e.get("grade") == "A2")
            total_a1 += a1
            total_a2 += a2
            if a1 == 0:
                if a2 < A2_ONLY_FLOOR:
                    errors.append(f"{tag} 没有 A1，且 A2 只有 {a2} 条（物件证据下限 {A2_ONLY_FLOOR}）")
                elif not any("物件证据" in s for s in (r.get("links") or [])):
                    errors.append(f"{tag} 只有物件证据，但 links 里没写明「仅有物件证据」")
                else:
                    warns.append(f"{tag} 仅有物件证据（A2×{a2}），已按规则放行")
            if r.get("counts") != {"A1": a1, "A2": a2}:
                errors.append(f"{tag} counts 与实际不符：写的是 {r.get('counts')}，实际 A1={a1} A2={a2}")

            for e in ev:
                quote = (e.get("quote") or "").strip()
                if len(norm(quote)) < MIN_QUOTE:
                    errors.append(f"{tag} 引文过短或为空：{quote!r}")
                    continue
                if e.get("grade") == "A1":
                    quest = e.get("quest", "")
                    cands = tasks_by_name.get(quest) or []
                    if not cands:
                        errors.append(f"{tag} 任务不存在：{quest}")
                        continue
                    if not any(map_slug in (t.get("ms") or []) for t in cands):
                        errors.append(f"{tag} 任务不属于 {map_slug}：{quest}")
                    if not any(norm(quote) in norm(b) for b in dialogue_by_name.get(quest, [])):
                        errors.append(f"{tag} A1 引文未在台词中逐字命中：{quest} / {quote[:24]}…")
                    trader = e.get("trader")
                    if trader and not any(t.get("trader") == trader for t in cands):
                        errors.append(f"{tag} 商人归属不符：{quest} 不是 {trader} 的任务")
                elif e.get("grade") == "A2":
                    name = e.get("item", "")
                    desc = item_by_name.get(name)
                    if desc is None:
                        errors.append(f"{tag} 物品不存在或无描述：{name}")
                    elif norm(quote) not in norm(desc):
                        errors.append(f"{tag} A2 引文未在物品描述中逐字命中：{name} / {quote[:24]}…")
                else:
                    errors.append(f"{tag} 未知证据级别：{e.get('grade')}")

            # 人物表不许留空（空值说明没查清就填表）
            for p in r.get("people") or []:
                for k in ("name", "role", "fate", "left"):
                    if not (p.get(k) or "").strip():
                        errors.append(f"{tag} 人物表有空字段：{p.get('name', '?')} / {k}")

            phases = [seg.get("phase") for seg in r.get("timeline") or []]
            if len(phases) < 3:
                errors.append(f"{tag} 时间线少于三段：{phases}")

    # 空白图要在 map_intros 里有交代，不能静默缺失
    for slug in LABELS_ZH:
        if slug not in maps:
            warns.append(f"[{slug}] 尚未收录（页面上会显示「待补」）")

    print("=" * 60)
    print(f"地图：{len(maps)}　区域：{total_regions}　A1：{total_a1}　A2：{total_a2}")
    print("=" * 60)
    for w in warns:
        print(f"  [提示] {w}")
    if errors:
        for e in errors:
            print(f"  [错误] {e}")
        print(f"\n共 {len(errors)} 处错误。")
        return 1
    print("战区纪事台账：结构、锚点、引文回源全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
