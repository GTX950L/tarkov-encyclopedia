"""从 scripts/data/region_lore.json 生成「战区纪事」页面（产物不许手改）。

用法
----
    python scripts/gen_region_lore.py            # 生成 / 覆盖全部战区页
    python scripts/gen_region_lore.py --check    # 只比对，不一致退出码 1

数据口径
--------
* A1 引文：quest_dialogue.json（**三级**，玩家维基转录的游戏内台词）
* A2 引文：item_desc_zh.json（**二级**，json.tarkov.dev 的物品描述）
* 所有 quote 由 check_region_lore.py 逐字回源校验；本脚本只负责排版，不判断真伪。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "data"))

from map_labels_zh import LABELS_ZH  # noqa: E402

DATA = ROOT / "scripts" / "data" / "region_lore.json"
CONTENT = ROOT / "content"

TRADER_ZH = {
    "prapor": "Prapor", "therapist": "Therapist", "skier": "Skier", "peacekeeper": "Peacekeeper",
    "mechanic": "Mechanic", "ragman": "Ragman", "jaeger": "Jaeger", "fence": "Fence",
    "lightkeeper": "Lightkeeper", "ref": "Ref", "btr-driver": "BTR 司机",
}

BASELINE = "版本基线：2026 年 10 月 ｜ 1.2.0.0（第一赛季 KORD BREACH）｜ 数据来源：任务台词（三级·玩家维基转录）、物品描述（二级·json.tarkov.dev）"

# 四战区：页 → 图。新增一张图的叙事时，把它加进对应战区即可。
THEATRES = [
    {
        "slug": "industrial",
        "title": "工业带",
        "lead": "海关、工厂、储备站：这条带子是塔科夫的物流与军需命脉。化工厂、罚没仓库、兵营与铁路都在这里，所以每一片区域都有人占、有人守、有人做买卖。",
        "maps": [("customs", "海关"), ("factory", "工厂"), ("reserve", "储备站")],
    },
    {
        "slug": "urban",
        "title": "城区",
        "lead": "街区、中心区、立交桥：泰拉集团的总部、银行、商场与公寓都在这三张图上。战争从这里开始，也在这里留下了最密集的民用痕迹——办公桌、货架、居民楼里没吃完的晚饭。",
        "maps": [("streets-of-tarkov", "街区"), ("ground-zero", "中心区"), ("interchange", "立交桥")],
    },
    {
        "slug": "outskirts",
        "title": "郊野",
        "lead": "海岸线、森林、灯塔：封锁线外的三张图。疗养院曾是泰拉集团人员的撤离中转站，森林是自然保护区与 Scav 的老巢，灯塔是 USEC 登陆时最先踩上去的地方。",
        "maps": [("shoreline", "海岸线"), ("woods", "森林"), ("lighthouse", "灯塔")],
    },
    {
        "slug": "facilities",
        "title": "封闭设施",
        "lead": "实验室、破冰船、迷宫、终点站：这四处不是城市，是设施。它们不靠街区故事支撑，靠的是通行权限、舱室编号和一份份没人签字的报告——主线浓度最高，台词最少。",
        "maps": [("the-lab", "实验室"), ("icebreaker", "破冰船"), ("the-labyrinth", "迷宫"), ("terminal", "终点站")],
    },
]


def zh_quotes(text: str) -> str:
    """把 ASCII 双引号成对换成中文引号。

    为什么必须换：站规禁止中文正文里出现直引号（check_entries 第 6 条），
    而物品名里确实有 `"Aspect"公司办公区钥匙` 这种写法 —— 表格里照抄就会红。
    只影响显示，不影响台账里的原文（A2 校验比的是描述，不是名字）。
    """
    out: list[str] = []
    opening = True
    for ch in text or "":
        if ch == '"':
            out.append("“" if opening else "”")
            opening = not opening
        else:
            out.append(ch)
    return "".join(out)


def esc(text: str) -> str:
    """表格单元格：不出现裸管道符，不出现 ASCII 引号。"""
    return zh_quotes(text or "").replace("|", "\\|")


def region_block(map_slug: str, r: dict) -> str:
    rid = f"{map_slug}-{r['slug']}"
    labels = LABELS_ZH.get(map_slug, {})
    anchors = [labels.get(a, a) for a in r.get("anchors") or []]
    out: list[str] = []
    out.append(f'### {r["name"]} <a id="{rid}"></a>')
    out.append("")
    out.append(f'**一句话**：{r["oneliner"]}')
    out.append("")
    out.append("| 阶段 | 发生了什么 |")
    out.append("|------|------------|")
    for seg in r["timeline"]:
        out.append(f'| **{seg["phase"]}** | {esc(seg["text"])} |')
    out.append("")
    out.append("**谁在这里**")
    out.append("")
    out.append("| 人物 | 身份 | 下落 | 留下的东西 |")
    out.append("|------|------|------|------------|")
    for p in r["people"]:
        out.append(f'| **{esc(p["name"])}** | {esc(p["role"])} | {esc(p["fate"])} | {esc(p["left"])} |')
    out.append("")
    out.append("**它和主线／世界观的关系**")
    out.append("")
    for line in r["links"]:
        out.append(f"- {line}")
    out.append("")
    out.append(f'**证据（A1 台词 {r["counts"]["A1"]} 条 · A2 物品描述 {r["counts"]["A2"]} 条）**')
    out.append("")
    out.append("| 级别 | 出处 | 原文 |")
    out.append("|------|------|------|")
    for e in r["evidence"]:
        if e["grade"] == "A1":
            trader = TRADER_ZH.get(e.get("trader", ""), e.get("trader", ""))
            who = f'[{e["quest"]}](../quests/{e["trader"]}.md)' if e.get("trader") else e["quest"]
            src = f"{trader} · {who}" if trader else who
        else:
            src = f'物品 · {e["item"]}'
        out.append(f'| {e["grade"]} | {esc(src)} | 「{esc(e["quote"])}」 |')
    out.append("")
    out.append(f'**图上能看到**：{r["visible"]}')
    out.append("")
    if anchors:
        out.append(f'地形锚点：{"、".join(f"「{a}」" for a in anchors)}。')
    else:
        out.append("地形锚点：本图暂无对应锚点，位置以文字描述为准。")
    out.append("")
    out.append(f'[↑ 回到本图开头](#{map_slug})　·　[回到顶部](#top)')
    out.append("")
    return "\n".join(out)


def render_page(t: dict, doc: dict) -> str:
    maps = doc.get("maps") or {}
    intros = doc.get("map_intros") or {}
    total_regions = sum(len(maps.get(slug, [])) for slug, _ in t["maps"])
    total_a1 = sum(r["counts"]["A1"] for slug, _ in t["maps"] for r in maps.get(slug, []))
    total_a2 = sum(r["counts"]["A2"] for slug, _ in t["maps"] for r in maps.get(slug, []))

    out: list[str] = []
    out.append(f'# 战区纪事 · {t["title"]}')
    out.append("")
    out.append(f"> {BASELINE}")
    out.append("> 本页不是打法页：它只回答「这片区域以前是什么、谁在这里做过什么」。走位与配装见各图条目。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append(t["lead"])
    out.append("")
    out.append("## 📸 本页概览")
    out.append("")
    out.append("| 图 | 区域数 | A1 台词证据 | A2 物品描述证据 | 状态 |")
    out.append("|----|--------|-------------|-----------------|------|")
    for slug, name in t["maps"]:
        regs = maps.get(slug) or []
        if regs:
            a1 = sum(r["counts"]["A1"] for r in regs)
            a2 = sum(r["counts"]["A2"] for r in regs)
            out.append(f"| **{name}** | {len(regs)} | {a1} | {a2} | 已收录 |")
        else:
            out.append(f"| {name} | — | — | — | 待补 |")
    out.append(f"| **合计** | **{total_regions}** | **{total_a1}** | **{total_a2}** | — |")
    out.append("")
    out.append("> **怎么读**：一句话看结论，三段线看时序，人物表看谁留下的东西，证据表逐条回原文。")
    out.append("> 引文一律加「」，A1 是商人原话、A2 是物品描述原文；原文带「也许」「据传」的，正文保留这层不确定。")
    out.append("")
    for slug, name in t["maps"]:
        regs = maps.get(slug) or []
        out.append(f'## {name} <a id="{slug}"></a>')
        out.append("")
        if regs:
            intro = intros.get(slug, "")
            if intro:
                out.append(f"> {intro}")
                out.append("")
            for r in regs:
                out.append(region_block(slug, r))
        else:
            out.append("> 本图尚未收录。待补时按同一套字段写：一句话 → 三段线 → 人物 → 与世界的关系 → 证据 → 图上能看到。")
            out.append("")
    out.append("## 🧭 读法与边界")
    out.append("")
    out.append("- **不写路线**：这里不告诉你从哪进、走哪条线，那是[地图条目](../entries/index.md)与[交互地图](../maps/index.md)的事。")
    out.append("- **不替官方下结论**：原文写「也许」的地方，正文也写「也许」。")
    out.append("- **没有证据就不写**：物证只到物品描述能支撑的粒度，人物只写文本里出现过的名字。")
    out.append("- 证据分级与引用规则见[战区纪事总纲](index.md)。")
    out.append("")
    out.append("## 🔗 相关条目")
    out.append("")
    out.append("- [战区纪事总纲](index.md) — 证据分级与四战区索引")
    out.append("- [世界观与阵营背景](../entries/worldview.md) — 泰拉集团、USEC 与 BEAR、封锁的来龙去脉")
    out.append("- [剧情章节与主线任务](../entries/story-chapters.md) — 十章主线与四个结局")
    out.append("- [商人群像](../entries/trader-profiles.md) — 八本账与他们的关系网")
    out.append("- [条目总览](../entries/index.md) — 全部条目的分类入口")
    out.append("- [数据口径与引用说明](../docs/citation.md) — 本站三档口径")
    out.append("")
    out.append("⬆️ **[回到顶部](#top)**")
    out.append("")
    out.append("**最后更新**: 2026年10月<br>")
    out.append("**贡献者**: GTX950L<br>")
    out.append("**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def theatre_counts(doc: dict) -> dict:
    """给总纲页用的四战区统计。"""
    out = {}
    for t in THEATRES:
        regs = [r for slug, _ in t["maps"] for r in (doc.get("maps") or {}).get(slug, [])]
        out[t["slug"]] = {
            "regions": len(regs),
            "a1": sum(r["counts"]["A1"] for r in regs),
            "a2": sum(r["counts"]["A2"] for r in regs),
            "maps": [name for slug, name in t["maps"] if (doc.get("maps") or {}).get(slug)],
            "missing": [name for slug, name in t["maps"] if not (doc.get("maps") or {}).get(slug)],
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    doc = json.loads(DATA.read_text(encoding="utf-8"))
    drift = []
    for t in THEATRES:
        target = CONTENT / "lore" / f'{t["slug"]}.md'
        text = render_page(t, doc)
        if args.check:
            if not target.exists():
                drift.append(f"缺少生成物: {target.relative_to(ROOT)}")
            elif target.read_text(encoding="utf-8") != text:
                drift.append(f"生成物与脚本输出不一致: {target.relative_to(ROOT)}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
            print(f"写入 {target.relative_to(ROOT)}（{len(text)} 字符）")
    if drift:
        for d in drift:
            print("[漂移]", d)
        return 1
    if args.check:
        print("战区纪事：生成物与脚本一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
