#!/usr/bin/env python3
"""为每张图生成一个交互地图页（`content/maps/<key>.md`）。

为什么用生成器
--------------
13 张图的页面骨架、数据统计、**静态任务清单**全都来自 `scripts/data/maps_site.json`（页面侧按图分片）。
手写 13 份会立刻漂移（改一次数据要改 13 处），而站内既有的做法就是
「生成器出产物、产物不许手改」—— 这里沿用。

**静态任务清单是刻意的**：交互地图需要脚本，但本站的底线是「无脚本可读」。
每页把那 张图上的任务逐条写在正文里，于是不开脚本、脚本失效、弱网加载不出底图时，
读者仍能读到「这张图有哪些任务、要去做什么」。地图是增强，不是前提。

用法
----
    python scripts/gen_map_pages.py     # 读 maps_site.json → 写 content/maps/*.md
"""
from __future__ import annotations

from _console import setup as _setup_console

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _baseline import baseline_label  # noqa: E402  站点基线的唯一来源（citation.md）
from _map_links import MAP_KEY_BY_CN, map_key_of_cn  # noqa: E402
import gen_quests as gq  # noqa: E402  复用商人 slug → 显示名（唯一一份）

DATA_JS = ROOT / "scripts" / "data" / "maps_site.json"
QUESTS_JSON = ROOT / "scripts" / "data" / "quests.json"
MAPS_DIR = ROOT / "content" / "maps"


def _entry_count() -> int:
    """条目数**现数**，不写死。

    2026-10-20 踩过：页脚那句原本写死 `88`。加第 89 个条目时改了全部条目页脚，
    唯独地图页被本生成器重写回 `88` —— 门禁红在「maps/*.md 写的是 88，实际 89」。
    教训：**写死的数字，改一处就会漏一处**；能现数的就别抄。
    """
    entries = ROOT / "content" / "entries"
    return len([p for p in entries.glob("*.md") if p.name != "index.md"])

# 图 → (中文名, 站内条目, 一句话定性)
# 「一句话」写的是**这张图用来干什么**，不是地形描述 —— 地形在条目里讲。
META: dict[str, tuple[str, str, str]] = {
    "customs": ("海关", "customs", "任务最密集的一张图，前中期的必经之地"),
    "factory": ("工厂", "factory", "体量最小、节奏最快的一张图，20 分钟一局"),
    "ground-zero": ("中心区", "ground-zero", "新手图，但终盘有高等级刷怪区"),
    "woods": ("森林", "woods", "开阔地形，远距离交火与狙击的主场"),
    "interchange": ("立交桥", "interchange", "商场内部近战 + 外围开阔，产出与风险都集中"),
    "reserve": ("储备站", "reserve", "军事设施，Boss 与 Raider 密度高，门槛也高"),
    "shoreline": ("海岸线", "shoreline", "跨度最大的一张图，东侧疗养院是核心收益点"),
    "lighthouse": ("灯塔", "lighthouse", "水资源与军用设施并存，Boss 机制特殊"),
    "streets-of-tarkov": ("街区", "streets", "城市巷战，室内外交替最频繁的一张"),
    "terminal": ("终点站", "terminal", "线性结构，节奏被通道推着走"),
    "icebreaker": ("破冰船", "icebreaker", "船体多层结构，垂直交火与狭窄通道"),
    "the-lab": ("实验室", "labs", "高投入高回报，入场要钥匙卡，Boss 密度全站最高"),
    "the-labyrinth": ("迷宫", "labyrinth", "限时事件图，路线固定、结构最特殊"),
}

TAG_LINE = "  - 地图\n  - 速查"

# 商人显示名 → 任务图鉴里的商人页文件名（静态表里把商人名链过去，
# 任务本身不挂链接 —— 详情页是按 id 渲染的，断链校验认不出那种形式）
TRADER_SLUG = {
    "Prapor": "prapor", "Therapist": "therapist", "Fence": "fence",
    "Skier": "skier", "Peacekeeper": "peacekeeper", "Mechanic": "mechanic",
    "Ragman": "ragman", "Jaeger": "jaeger", "Lightkeeper": "lightkeeper",
    "Ref": "ref", "BTR 司机": "btr-driver",
}

# 商人显示名 → 任务图鉴里的商人页文件名（静态表里把商人名链过去，
# 任务本身不挂链接 —— 详情页是按 id 渲染的，断链校验认不出那种形式）
TRADER_SLUG = {
    "Prapor": "prapor", "Therapist": "therapist", "Fence": "fence",
    "Skier": "skier", "Peacekeeper": "peacekeeper", "Mechanic": "mechanic",
    "Ragman": "ragman", "Jaeger": "jaeger", "Lightkeeper": "lightkeeper",
    "Ref": "ref", "BTR 司机": "btr-driver",
}


def load_maps() -> dict:
    """读合并 JSON（2026-10-17 起页面数据按图分片，构建期读这一份）。"""
    return json.loads(DATA_JS.read_text(encoding="utf-8"))


def load_quests() -> list[dict]:
    d = json.loads(QUESTS_JSON.read_text(encoding="utf-8"))
    return d.get("tasks") or []


def page(key: str, data: dict, quests: list[dict]) -> str:
    cn, entry, blurb = META.get(key, (data.get("nameEn") or key, "", ""))
    qz = data.get("questZones") or []
    labels = data.get("labels") or []
    exs = data.get("extracts") or []
    locks = data.get("locks") or []
    haz = data.get("hazards") or []
    trs = data.get("transits") or []
    floors = data.get("floors") or []

    # 任务去重（按 id），并统计每人处数
    seen: dict[str, dict] = {}
    for z in qz:
        it = seen.setdefault(z["q"], {"n": z["n"], "tr": z.get("tr") or "", "t": z.get("t") or "", "nz": 0, "d": ""})
        it["nz"] += 1
        if z.get("d") and not it["d"]:
            it["d"] = z["d"]
    tasks = sorted(seen.items(), key=lambda kv: ((kv[1]["tr"] or ""), kv[1]["n"]))

    # 提到本图、但上游没给坐标的任务（2026-10-17 新增）。
    # 地图页原先只列「有区域」的任务，海关因此只显示 31 个，而实际有 81 个任务
    # 的任务级 map 或目标 maps 提到海关。没有区域不等于没在这张图做任务 ——
    # 把「提到但画不出」单独列出来，比让读者以为漏了强。
    zoned = set(seen)
    mentions: list[dict] = []
    for t in quests:
        keys = set(t.get("ms") or [])
        if key not in keys or t["id"] in zoned:
            continue
        reason = ""
        for o in t.get("objectives") or []:
            om = {map_key_of_cn(m) for m in (o.get("maps") or []) if m}
            if key in om:
                reason = o.get("text") or ""
                break
        mentions.append({
            "id": t["id"], "n": t["name"], "tr": t.get("trader") or "",
            "reason": reason or "任务级地图归属",
        })
    mentions.sort(key=lambda x: ((TRADER_SLUG.get(x["tr"]) or x["tr"], x["n"])))

    out: list[str] = []
    out.append("---")
    out.append("tags:")
    out.append(TAG_LINE)
    out.append("---")
    out.append(f"# {cn} · 交互地图")
    out.append("")
    out.append(
        f"> 版本基线：2026 年 10 月 ｜ {baseline_label()} ｜ "
        "底图来源：社区开源项目 the-hideout/tarkov-dev-svg-maps（作者 Shebuka，"
        "[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)，与本站正文同许可）"
    )
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    if blurb:
        out.append(f"> {blurb}。定性分析与打法见[{cn}](../entries/{entry}.md)。")
        out.append("")

    # 地图挂载点（静态降级文案在 <noscript> 里）
    out.append(
        f'<div id="tk-map" data-map="{key}">交互地图加载中…（首次打开需要下载底图）'
        "<noscript>当前浏览器未启用 JavaScript，交互地图无法显示 —— 但下面那张"
        "「这张图上的任务」表是完整的，不开脚本也能读。</noscript></div>"
    )
    out.append("")

    # 数据统计
    out.append("## 📊 这张图的数据")
    out.append("")
    out.append("| 项 | 数量 |")
    out.append("|----|------|")
    row = []
    if labels:
        row.append(("地名锚点", len(labels)))
    row.append(("任务目标区域", len(qz)))
    if qz:
        row.append(("涉及任务", len(tasks)))
    if mentions:
        row.append(("提及任务（无坐标）", len(mentions)))
    if exs:
        row.append(("撤离点", len(exs)))
    if trs:
        row.append(("转场点", len(trs)))
    if locks:
        row.append(("上锁位置", len(locks)))
    if haz:
        row.append(("危险区", len(haz)))
    if floors:
        row.append(("楼层", len(floors)))
    for k, v in row:
        out.append(f"| {k} | {v} |")
    out.append("")

    # 静态任务清单
    if tasks:
        out.append(f"## 🎯 这张图上的任务（{len(tasks)} 个）")
        out.append("")
        out.append(
            "> **打开地图时若你有进行中的任务，图上默认只画它们**—— 进度读的是你[我的进度](../quests/progress.md)里的记录"
            "（本机存储，两页实时同步）；也能「只看未完成」、按任务名或地名搜索，地图下方还有一张带进度三态的清单，"
            "勾几个任务还能同时上图。搜索框在控件条里（中文或英文都能搜）。"
            "下面这张表是给不开脚本、或地图没加载出来时用的。"
        )
        out.append("")
        out.append("| 商人 | 任务 | 目标类型 | 区域数 | 目标 |")
        out.append("|------|------|----------|--------|------|")
        for qid, it in tasks:
            # **任务名不挂链接**：详情页是「一个页面按 id 渲染」的形式（`/quests/quest/?id=…`），
            # 而站内的断链校验只认能落到文件上的路径。可行的替代是链到**商人页**
            # （那才是静态可查的入口），任务详情交给地图上的区域点击。
            desc = (it["d"] or "—").replace("|", "／")
            tr = it["tr"] or "—"
            if it["tr"]:
                slug = TRADER_SLUG.get(it["tr"])
                if slug:
                    tr = f"[{it['tr']}](../quests/{slug}.md)"
            out.append(f"| {tr} | {it['n']} | {it['t'] or '—'} | {it['nz']} | {desc} |")
        out.append("")
    else:
        out.append("## 🎯 任务")
        out.append("")
        if mentions:
            out.append(
                f"这张图上**没有可画的任务目标区域** —— 不是本站漏抓：上游的任务数据里，"
                f"这张图的任务目标没有给出坐标。但**有 {len(mentions)} 个任务提到本图**，"
                "下面单列，避免读者以为「这张图没有任务」。"
            )
        else:
            out.append(
                "这张图上**没有**任务目标区域 —— **不是本站漏抓**：上游的任务数据里，"
                "这张图的任务目标没有给出坐标。站内有该图的任务与打法说明，"
                "只是地图上暂时画不出位置。**数据没有就是没有，不编位置。**"
            )
        out.append("")

    # ── 提到本图、但画不出位置 ─────────────────────────────────────────
    # 与上面的「有区域」表**分开**：两个数回答两个问题（能不能在地图上画 /
    # 这张图有没有它的事），混在一起会让人以为「提及数 = 可定位数」。
    if mentions:
        out.append(f"## 🧭 提到本图、但画不出位置（{len(mentions)} 个）")
        out.append("")
        out.append(
            "> 这些任务的任务级地图或目标文字提到本图，但上游**没有给出可画的坐标区**。"
            "所以它们不在上面的地图上，也不该被当成「漏抓」—— **位置没有就是没有，不编。**"
            "点商人名进对应页看完整任务明细。"
        )
        out.append("")
        out.append("| 商人 | 任务 | 目标里怎么提到 |")
        out.append("|------|------|----------------|")
        for m in mentions:
            disp = gq.TRADER_LABEL.get(m["tr"], m["tr"]) or "—"
            slug = TRADER_SLUG.get(disp) or m["tr"]
            tr = f"[{disp}](../quests/{slug}.md)" if slug else disp
            reason = (m["reason"] or "—").replace("|", "／")
            out.append(f"| {tr} | {m['n']} | {reason} |")
        out.append("")

    # 用法
    out.append("## 🧭 怎么用这张图")
    out.append("")
    out.append(
        "| 操作 | 结果 |\n"
        "|------|------|\n"
        "| 滚轮 / 放大缩小按钮 | 缩放（以指针位置为中心）；按住拖动平移。**标注在任何缩放级别都是同一大小**（屏幕锚定），左下角有随缩放换档的比例尺 |\n"
        "| 单击任务区域 | 只显示这一个任务，下方弹出信息卡 |\n"
        "| 单击**重叠处** | 该点压着多个任务时，弹一个列表让你挑（单一命中则直接选中，不多一步） |\n"
        "| 双击任务区域 | 打开任务详情 |\n"
        "| **任务搜索框** | 控件条里输入任务名或**地名**（**中文或英文**都能搜，商人名也参与匹配）→ 回车或点结果：地图只剩该任务、下方弹出信息卡，**视图自动移到它所在的位置**，地名标签也会保显一次 |\n"
        "| **任务点位筛选** | 全部任务 / 只看未完成 / 只看进行中 —— 按「我的进度」过滤图上画出的区域；**有进行中的任务时打开本页，默认就是「只看进行中」**（没有就显示全部） |\n"
        "| **地图下方清单** | 这张图的任务按商人分组，带**进度三态**（未标记／进行中／已完成，与「我的进度」同步）、组内完成度条与**行前提示**（钥匙／自备）；可按进度筛；点一行，上面地图就只剩它并自动定位 |\n"
        "| **出击清单** | 清单行左侧的「+」把任务加进出击清单（可多选）—— 汇总条给出区域数与钥匙数，「只看这些」让地图**同时**显示这几个任务的区域，一次 raid 推进几票用 |\n"
        "| **点击地名 / 撤离点** | 弹小卡：这是什么 + 去哪读（地名 → 本图条目；撤离点 → 撤离点详解）—— 不直接翻页，防误点丢地图状态 |\n"
        "| 图层按钮 | **任务区域** / 撤离点 / 转场点 / 上锁 / 危险区，各自可开关 —— 想纯看地形时把「任务区域」整个关掉 |\n"
        "| 悬停撤离点 | 看阵营，以及**要不要缴钱／缴物**；多版本图的出口会标注「仅某版有」，车辆撤离若两模式价格不同还会写出 PvE 的价 |\n"
        "| 测距 | 点两个点量**直线**距离（米）；画布左下角的比例尺与它同源 |\n"
        "| 全屏 | 铺满屏幕看细节 |"
    )
    out.append("")
    out.append(
        "> **地名标签会自动避让**：缩放级别低时，挤在一起的地名只显示一部分"
        "（撤离点、转场点优先），其余先只留红点 —— **放大后自然浮现**，"
        "搜索或点击定位到的那个标签保证显示。点永远都在，被避让的只是字。"
    )
    out.append("")
    out.append(
        "> **框有的是「点」，有的是「一整片区域」，这是数据本来的样子。**"
        "「在XX击杀 N 个」这类任务，上游给的就是一整片范围；"
        "本站按占图面积分了三档显示 —— **区域级目标会压到很淡**（悬停或选中时恢复），"
        "免得它盖住整张图、把几十个点级目标一起埋掉。悬停时会直接告诉你它占本图多少面积。"
    )
    out.append("")
    out.append(
        "> 完整说明（图例、数据来源、许可与边界）见[交互地图总览](index.md)。"
    )
    out.append("")

    # 相关条目
    out.append("## 🔗 相关条目")
    out.append("")
    out.append(f"- [{cn}](../entries/{entry}.md) — 本页底图对应的定性条目")
    out.append("- [撤离点详解](../entries/extraction-points.md) — 各图撤离条件")
    out.append("- [地图对照速查](../docs/map-guide.md) — 13 张图的横向对照")
    out.append("- [交互地图总览](index.md) — 回到总览与图例")
    out.append("")
    out.append("## 📚 所有条目")
    out.append("")
    out.append(f"📖 [查看全部 {_entry_count()} 个条目](../entries/index.md)")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append("**最后更新**: 2026年10月<br>")
    out.append("**贡献者**: GTX950L<br>")
    out.append("**底图署名**: Shebuka / the-hideout/tarkov-dev-svg-maps（CC BY-NC-SA 4.0）<br>")
    out.append("**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def main() -> int:
    maps = load_maps()
    quests = load_quests()
    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for key in sorted(maps):
        if key not in META:
            print(f"  ⚠ {key} 不在 META 表里，跳过（新增地图时要补中文名与条目）")
            continue
        dst = MAPS_DIR / f"{key}.md"
        dst.write_text(page(key, maps[key], quests), encoding="utf-8")
        written.append(dst.name)
    print(f"✅ 写出 {len(written)} 个地图页：{'、'.join(written)}")
    return 0


if __name__ == "__main__":
    _setup_console()
    sys.exit(main())
