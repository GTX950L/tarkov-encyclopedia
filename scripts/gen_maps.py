#!/usr/bin/env python3
"""生成《交互地图》的矢量底图与点位数据。

数据源（均为二级来源，口径见 content/docs/citation.md 第四节「交互地图的数据口径」）
--------------------------------------------------------------------------
  · maps.json   —— https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json
                   每图的 `svgPath` / `bounds` / `transform` / `coordinateRotation` / `layers` / `labels`
  · SVG 底图     —— maps.json 里 `svgPath` 指向的地址（assets.tarkov.dev），
                   作者 **Shebuka**，仓库 the-hideout/tarkov-dev-svg-maps，**CC BY-NC-SA 4.0**

三个特例（写在这里以免下次误判为漏抓）
--------------------------------------
  · **实验室**：上游仓库有独立的 `Labs.svg`，但它**用内联 `style="fill:#..."` 着色、
    没有 `<style id="style_common">` 色类**（还带 40 处语义色 `red`），本生成器的换肤
    流程套不上。**第一版跳过**——不猜语义色。要做需先给这张图单独建一张内联色映射表。
  · **破冰船 / 迷宫**：上游只有 `tilePath` 瓦片，仓库里没有 SVG，**跳过**（站点暂不收录）。
  · **终点站**：有 SVG 但上游**没有给地名标签**（`labels` 为空），底图可用、无锚点。

换肤
----
把 `LIGHT_STYLE`（本站浅色「军用档案纸」色板）写进每张 SVG 的 `<style id="style_common">`，
与上游 `replace_style_common.py` 同一做法 —— **矢量数据一字不改，只换 24 个色类**。
色板与中文译名**固化在本文件里**（同 gen_hideout.py 的 STATION_NOTES 做法）：
人工内容放生成器里，重跑才不会丢。

用法
----
    python scripts/gen_maps.py --fetch   # 抓 maps.json + 下载 11 张 SVG 存原始缓存 + 换肤出产物
    python scripts/gen_maps.py           # 用缓存重生成（不联网），适合日常校验

写入范围（**两个文件/目录都是本生成器的产物，不要手改**）
    scripts/data/maps_source.json          —— maps.json 快照
    scripts/data/maps_raw/<Name>.svg       —— 上游原始 SVG（换肤的输入）
    content/assets/maps/<Name>.svg         —— 换肤后的底图（站点使用）
    content/javascripts/maps-data.js       —— 点位与图层数据（页面读取）
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _baseline import baseline_label  # noqa: E402  站点基线的唯一来源（citation.md）
from gen_quests import TYPE_LABEL as OBJ_TYPE_ZH  # noqa: E402  目标类型中文，**不另立一套**
# 地名 / 撤离点的中文译名（人工核对过的，独立成表见该模块说明）
from data.map_labels_zh import (  # noqa: E402
    EXTRACT_BY_KEY, GLOBAL_LABELS_ZH, LABEL_EN_BY_KEY, LABELS_ZH, norm_key,
)

MAPS_SRC = (
    "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"
)

CACHE = ROOT / "scripts" / "data" / "maps_source.json"
RAW_DIR = ROOT / "scripts" / "data" / "maps_raw"
SVG_DIR = ROOT / "content" / "assets" / "maps"
OUT_JS = ROOT / "content" / "javascripts" / "maps-data.js"

# ─────────────────────────────────────────────────────────────────────────────
# 任务点位 —— 供「地图 ↔ 任务图鉴 ↔ 我的进度」联动
#
# ⚠️ **这是全站唯一一处把坐标入仓的数据**，依据是 citation.md 第六节的新口径：
#    坐标不进条目正文，**集中收在交互地图**。它因此**与正文数据分开存放** ——
#    正文侧的 `gen_quests.py:slim_objective()` 照旧丢弃坐标，一行没改；
#    坐标走自己这条管线（本文件）。两边各有各的口径，互不污染。
#
# 两个「对不上」的地方，是**如实保留**而不是修平：
#   ① 上游 tasks 端点 504 个任务，站内 515 个 —— 站内多出的是上游已下线的
#      （限时/活动类）。它们自然没有点位，**不是漏抓**。
#   ② 目标描述按**索引**从站内 `quests.json` 取。逐任务比对过：498/515 能对上、
#      其中 **494 个 objective 数量完全一致**；剩下 21 个（4%）数量不同，
#      **退回「任务名 + 目标类型」显示，不给描述** —— 宁可少给一层，不给错的那层。
# ─────────────────────────────────────────────────────────────────────────────
QUESTS_SRC = "https://json.tarkov.dev/regular/tasks"
ZONES_CACHE = ROOT / "scripts" / "data" / "quest_zones.json"
# 瓦片拼合图的产物描述（由 build_tile_maps.py 写）
TILE_CACHE = ROOT / "scripts" / "data" / "tile_maps.json"
LOCAL_QUESTS = ROOT / "scripts" / "data" / "quests.json"

# 上游地图 id → 本站 maps.json 的 key。
# 三个「同一张图的变体」（工厂夜图 / 中心区两个版本）**归到同一把 key** ——
# 点位落在同一个底图坐标系里，分开反而会让读者找不到。
MAP_ID_TO_KEY: dict[str, str] = {
    "56f40101d2720b2a4d8b45d6": "customs",
    "5704e3c2d2720bac5b8b4567": "woods",
    "5704e554d2720bac5b8b456e": "shoreline",
    "5704e4dad2720bb55b8b4567": "lighthouse",
    "5704e5fad2720bc05b8b4567": "reserve",
    "5714dbc024597771384a510d": "interchange",
    "5714dc692459777137212e12": "streets-of-tarkov",
    "55f2d3fd4bdc2d5f408b4567": "factory",
    "59fc81d786f774390775787e": "factory",
    "5b0fc42d86f7744a585f9105": "the-lab",
    "653e6760052c01c1c805532f": "ground-zero",
    "65b8d6f5cdde2479cb2a3125": "ground-zero",
    "68236e8153654e8c1200798a": "ground-zero",
    "65cc8f81a9aac3e77d0cfd3e": "terminal",
    "69af492a4819ea4ba10a69c5": "icebreaker",   # 瓦片拼合
    "6733700029c367a3d40b02af": "the-labyrinth",  # 瓦片拼合

}

# ─────────────────────────────────────────────────────────────────────────────
# 图层数据（撤离点 / 上锁 / 危险区）
#
# 起因：对标开源项目 tiltysola/tarkov-tilty-frontend-opensource 的 InteractiveMap。
# **两边同源** —— 它的 `src/data/interactive_maps.ts` 与本文件用的 maps.json 是
# 同一份数据（tarkov.dev 的 interactive maps，作者都是 Shebuka）。差别只在
# 「它把图层做全了，本站此前只做了任务点位」。
#
# **只取语义完整的三个图层，不取容器**：上游的 `lootContainers`（海关 551 条）
# **只给位置、不给容器类型**（`lootContainer` 是游戏内的 LootContainer 模板 id，
# 不在 tarkov.dev 的 items 端点里，查不到名字）。551 个彼此无区别的点画上去，
# 只会把地图糊住、换不来任何判断 —— **数据缺语义时，宁可不画**。
# 出生点同理（278 个），且站内已把「出生点密度」登记为未决项 B7。
# ─────────────────────────────────────────────────────────────────────────────
MAPS_API = "https://json.tarkov.dev/regular/maps"
LAYERS_CACHE = ROOT / "scripts" / "data" / "map_layers.json"

# 地图中文名 —— **与站内条目写法一致**（entries/index.md 的篇目名）。
# 转场点要显示「前往 XX」，而上游的 transits 不带名字（只有目标图 id），只能这样补。
MAP_ZH = {
    "customs": "海关",
    "factory": "工厂",
    "woods": "森林",
    "interchange": "立交桥",
    "reserve": "储备站",
    "shoreline": "海岸线",
    "lighthouse": "灯塔",
    "streets-of-tarkov": "街区",
    "ground-zero": "中心区",
    "the-lab": "实验室",
    "terminal": "终点站",
    "icebreaker": "破冰船",
    "the-labyrinth": "迷宫",

}

FACTION_ZH = {"pmc": "PMC", "scav": "Scav", "shared": "共用"}
HAZARD_ZH = {"minefield": "雷区", "sniper": "狙击区", "deadly": "致命区"}
LOCK_ZH = {"door": "门", "trunk": "后备箱", "container": "容器"}

# ─────────────────────────────────────────────────────────────────────────────
# 撤离点名字的可读化
#
# 上游的 `extracts[].name` 有两种格式：
#   ① 内部 id：`ex_customs_scav_gasstation`、`ex_customs_pmc_rail_milbase`（多数）
#   ② 本来就是英文名：`Old Road Gate`、`RUAF Roadblock`（少数）
# 直接显示 ① 对读者毫无意义 —— 参考的三个站（小喵塔科夫 / eftarkov / 缇尔蒂助手）
# 全都显示可读名，这是它们做得比本站好的一处。
#
# 分两层，**都不编造**：
#   · 第一层是机械的：剥掉 `ex_<图>_` 与阵营/secret 前缀、下划线转空格、首字母大写；
#   · 第二层是词表：只填**能可靠对应**的常见词，词表里没有就显示英文。
#
# **拿不准的宁可不翻** —— 一个错的撤离点名，比一个英文名更糟。
# 想扩词表时：先 grep 站内 `entries/extraction-points.md` 与各图条目怎么写的。
# ─────────────────────────────────────────────────────────────────────────────

# `ex_customs_scav_gasstation` → 剥掉 `ex_customs_`；再剥掉阵营 / secret 前缀
# 剥 `ex_<图>_` 前缀。**用惰性匹配 + 前瞻锚定阵营前缀**，而不是 `[a-z0-9]+` ——
# 后者在 `ex_ground_zero_scav_coop_exit` 上只吃到 `ground` 就停了，
# 剩下的 `zero_scav_coop_exit` 查不着任何词表项。
_EX_MAIN_RE = re.compile(r"^ex_.*?(?=(?:pmc|scav|coop|shared|secret)_|$)", re.I)
_EX_SUB_RE = re.compile(r"^(?:pmc|scav|coop|shared|secret)_", re.I)


def humanize_extract(name: str) -> str:
    """上游撤离点名 → 可读名。

    接两条来源：
      · `ex_<图>_<阵营?>_<核心>` → 剥前缀后查 `EXTRACT_ZH`
      · 上游直接给的可读英文名（`Old Road Gate`）→ 查 `LABEL_EN_ZH`

    查表用 `norm_key()` 归一化 —— 上游写法很杂（`Gate m` 带空格、`EXFIL_Train`
    大写下划线、`Shorl_V-Ex` 带连字符），按原样字符串查必然漏掉大半。
    **两处都查不到就保留原文**，不硬翻（一个错的撤离点名比英文名更糟）。
    """
    raw = (name or "").strip()
    if not raw:
        return raw
    core = raw
    if raw.lower().startswith("ex_"):
        core = _EX_SUB_RE.sub("", _EX_MAIN_RE.sub("", raw))
    for table in (LABEL_EN_BY_KEY, EXTRACT_BY_KEY):
        hit = table.get(norm_key(core)) or table.get(norm_key(raw))
        if hit:
            return hit
    if core != raw:
        # 没命中词表：剥掉前缀后的英文按「下划线转空格 + 首字母大写」呈现
        return core.replace("_", " ").title() if core else raw
    return raw

# 商人显示名 —— **沿用站内既有写法**（条目与任务图鉴里都用英文名），
# 只有 BTR 司机例外（站内就叫「BTR 司机」）。改这里前先 grep 一下站内怎么写的。
TRADER_NAME = {
    "prapor": "Prapor",
    "therapist": "Therapist",
    "fence": "Fence",
    "skier": "Skier",
    "peacekeeper": "Peacekeeper",
    "mechanic": "Mechanic",
    "ragman": "Ragman",
    "jaeger": "Jaeger",
    "lightkeeper": "Lightkeeper",
    "ref": "Ref",
    "btr-driver": "BTR 司机",
}

HEADERS = {"User-Agent": "tarkov-encyclopedia-mapgen/1.0"}

# ─────────────────────────────────────────────────────────────────────────────
# 浅色色板 —— 本站「军用档案纸」取向。上游默认是深色（.land #1f5054 一类），
# 本站全文浅色，故整表替换。**类是上游定义的 24 个，不是自造**；
# 上游新增类名时这里要跟着补（缺的类会退回浏览器默认填充，表现为一块黑）。
# ─────────────────────────────────────────────────────────────────────────────
LIGHT_STYLE = """.trees{fill:#b7d1b0}
.cement{fill:#e8e8e2}
.land{fill:#e0e7d9}
.rock{fill:#e2d9c2}
.water{fill:#abd0ec}
.wood{fill:#d8c7a8}
.tarmac{fill:#ccd2d4}
.gravel{fill:#dccdb0}
.building{fill:#9fabb6}
.floor{fill:#e2e7e9}
.locked{fill:#efa39b}
.map_border{fill:none;stroke:#8b9c8f;stroke-width:2}
.fence{fill:none;stroke:#7d8f80;stroke-width:1}
.road_tarmac{fill:none;stroke:#8e9aa3}
.road_gravel{fill:none;stroke:#b8a482}
.road_small{stroke-width:5}
.road_medium{stroke-width:8}
.road_large{stroke-width:12}
.railroad{fill:none;stroke:#9c8b7a;stroke-dasharray:6;stroke-width:3}
.powerline{fill:none;stroke:#f0c14b;stroke-width:2;stroke-miterlimit:10;stroke-dasharray:6,6}
.danger{fill:#dd5a52;fill-opacity:.5;stroke:#c0392b;stroke-dasharray:4,2;stroke-width:2}
.danger_small{fill:#dd5a52;fill-opacity:.5;stroke:#c0392b;stroke-dasharray:2,1;stroke-width:1}
.task{fill:#2c6fb5}
.stairs{fill:#c9a227}
.shadow{filter:drop-shadow(0 0 1px rgba(0,0,0,.2))}
"""

# ─────────────────────────────────────────────────────────────────────────────
# 地名中文译名 —— **只收站内已确立或有明确对应的**（纪律同 gen_ammo_values.py：

# ─────────────────────────────────────────────────────────────────────────────

# 楼层图层：上游用 `<g id="...">` 给每一层分组，切换显示即可换层。
# **注意区分 `Ground`（地面材质层，class="land"）与 `Ground_Level`（楼层容器）** ——
# 前者不是楼层，加进这个表会让「地面」按钮把地形整个关掉。
FLOOR_ZH: dict[str, str] = {
    # 瓦片拼合图的层（实验室两层）—— 由 build_tile_maps.py 写在包装 SVG 的 <g id>
    "1st": "1 层",
    "2nd": "2 层",

    "Ground_Level": "地面",
    "Underground_Level": "地下",
    "First_Floor": "1 层",
    "Second_Floor": "2 层",
    "Third_Floor": "3 层",
    "Fourth_Floor": "4 层",
    "Fifth_Floor": "5 层",
}
FLOOR_ORDER = list(FLOOR_ZH)


def _floors(layer_ids: list[str]) -> list[dict]:
    """从 SVG 实际存在的图层 id 里挑出楼层，按楼层顺序排。"""
    present = [f for f in FLOOR_ORDER if f in layer_ids]
    return [{"id": f, "cn": FLOOR_ZH[f]} for f in present]


# maps.json 的 key → 站内条目（用于页面回链与名称对照）
ENTRY_OF: dict[str, str] = {
    "ground-zero": "entries/ground-zero.md",
    "factory": "entries/factory.md",
    "customs": "entries/customs.md",
    "woods": "entries/woods.md",
    "interchange": "entries/interchange.md",
    "reserve": "entries/reserve.md",
    "shoreline": "entries/shoreline.md",
    "lighthouse": "entries/lighthouse.md",
    "streets-of-tarkov": "entries/streets.md",
    "the-lab": "entries/labs.md",
    "terminal": "entries/terminal.md",
    "icebreaker": "entries/icebreaker.md",
    "the-labyrinth": "entries/labyrinth.md",

}


def log(msg: str) -> None:
    print(msg, flush=True)


def http_get(url: str, timeout: int = 90) -> bytes:
    """取远端内容。**失败时回退到 curl** ——
    raw.githubusercontent.com 在部分网络下对 urllib 直连返回 504 / 挂起，
    而同一个地址 curl 能过（实测 2026-10-13）。这条回退是环境适配，不是逻辑分支。
    """
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.read()
    except Exception as exc:  # noqa: BLE001 —— 任何失败都值得试一次 curl
        import shutil
        import subprocess

        curl = shutil.which("curl")
        if not curl:
            raise SystemExit(f"[错误] 取 {url} 失败（{exc}），且系统里没有 curl 可回退")
        log(f"   （urllib 失败：{exc}；回退 curl 重试）")
        proc = subprocess.run(  # noqa: S603
            [curl, "-sSL", "--max-time", str(timeout), "-A", HEADERS["User-Agent"], url],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            raise SystemExit(
                f"[错误] 取 {url} 失败：urllib 与 curl 都没成功"
                f"（curl 退出码 {proc.returncode}）"
            )
        return proc.stdout


# ── 抓取 ─────────────────────────────────────────────────────────────────────
def fetch() -> None:
    """抓 maps.json 快照 + 下载上游原始 SVG。"""
    log("① 抓 maps.json …")
    raw = http_get(MAPS_SRC)
    data = json.loads(raw.decode("utf-8"))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    log(f"   → {CACHE.relative_to(ROOT)}（{len(raw) / 1024:.0f} KB）")

    log("② 下载上游原始 SVG …")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for key, svg_url in _svg_sources(data):
        blob = http_get(svg_url)
        name = Path(svg_url).name
        (RAW_DIR / name).write_bytes(blob)
        log(f"   → {name:<24} {len(blob) / 1024:7.1f} KB   {key}")

    fetch_quest_zones()


def _zone_box(z: dict) -> list[float] | None:
    """取一个 zone 的世界坐标 bbox：优先 `outline`（多边形轮廓），退回 `position`（中心点）。"""
    pts = z.get("outline") or []
    if pts:
        xs = [p["x"] for p in pts if "x" in p]
        zs = [p["z"] for p in pts if "z" in p]
        if xs and zs:
            return [min(xs), min(zs), max(xs), max(zs)]
    p = z.get("position") or {}
    if "x" in p and "z" in p:
        return [p["x"], p["z"], p["x"], p["z"]]
    return None


def fetch_quest_zones() -> None:
    """抓 tasks 端点，把坐标区压成最小结构。

    只留「哪个任务的第几个目标、在哪张图、世界坐标 bbox」——
    **任务名与目标描述不从这里取**（那是 `quests.json` 的事，两条管线分开走）。
    """
    import datetime

    log("③ 抓 tasks 端点（任务点位）…")
    raw = http_get(QUESTS_SRC, timeout=120)
    tasks = json.loads(raw.decode("utf-8"))["data"]["tasks"]

    zones: list[dict] = []
    objcount: dict[str, int] = {}      # {任务id: 上游 objective 数} —— 生成时用来判定「敢不敢按索引取描述」
    skipped_map = 0
    for tid, t in tasks.items():
        objs = t.get("objectives") or []
        objcount[tid] = len(objs)
        for i, o in enumerate(objs):
            for z in o.get("zones") or []:
                mid = z.get("map")
                if isinstance(mid, dict):
                    mid = mid.get("id")
                if mid not in MAP_ID_TO_KEY:
                    skipped_map += 1          # 破冰船 / 迷宫等在暂不收录的图上
                    continue
                box = _zone_box(z)
                if not box:
                    continue
                zones.append(
                    {"task": tid, "oi": i, "type": o.get("type"), "map": mid, "box": box}
                )

    payload = {
        "fetched": datetime.date.today().isoformat(),
        "source": "json.tarkov.dev/regular/tasks",
        "count": len(zones),
        "objcount": objcount,
        "zones": zones,
    }
    ZONES_CACHE.parent.mkdir(parents=True, exist_ok=True)
    ZONES_CACHE.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    log(
        f"   → {ZONES_CACHE.relative_to(ROOT)}：{len(zones)} 条坐标区"
        f"（另有 {skipped_map} 条落在本站暂不收录的图上，已跳过）"
    )

    fetch_map_layers()


def fetch_map_layers() -> None:
    """抓 maps 端点，只留撤离点 / 上锁 / 危险区三个图层（理由见模块头部）。

    坐标一律**只存世界坐标**，投影留给生成阶段 —— 与任务点位同一条路数，
    这样换底图或改公式时，缓存不用重抓。
    """
    import datetime

    log("④ 抓 maps 端点（撤离点 / 上锁 / 危险区）…")
    raw = http_get(MAPS_API, timeout=240)
    maps = json.loads(raw.decode("utf-8"))["data"]["maps"]
    items = list(maps.values()) if isinstance(maps, dict) else maps

    out: dict[str, dict] = {}
    tot = {"extracts": 0, "locks": 0, "hazards": 0, "transits": 0}
    for m in items:
        mid = m.get("id")
        if mid not in MAP_ID_TO_KEY:
            continue
        rec: dict[str, list] = {"extracts": [], "locks": [], "hazards": [], "transits": []}

        for e in m.get("extracts") or []:
            p = e.get("position") or {}
            if "x" not in p or "z" not in p:
                continue
            rec["extracts"].append(
                {
                    "n": e.get("name") or "",  # 译名在生成阶段算，见 build_maps
                    "f": e.get("faction") or "",
                    "x": round(p["x"], 1),
                    "z": round(p["z"], 1),
                }
            )

        for lk in m.get("locks") or []:
            p = lk.get("position") or {}
            if "x" not in p or "z" not in p:
                continue
            rec["locks"].append(
                {
                    "t": lk.get("lockType") or "",
                    "k": lk.get("key") or "",  # 钥匙的物品 id —— 页面链到站内图鉴
                    "pw": bool(lk.get("needsPower")),
                    "x": round(p["x"], 1),
                    "z": round(p["z"], 1),
                }
            )

        for h in m.get("hazards") or []:
            pts = [q for q in (h.get("outline") or []) if "x" in q and "z" in q]
            if len(pts) < 3:
                continue
            rec["hazards"].append(
                {
                    "t": h.get("hazardType") or "",
                    "pts": [[round(q["x"], 1), round(q["z"], 1)] for q in pts],
                }
            )

        for tr in m.get("transits") or []:
            p = tr.get("position") or {}
            if "x" not in p or "z" not in p:
                continue
            tgt = tr.get("map")
            if isinstance(tgt, dict):
                tgt = tgt.get("id")
            rec["transits"].append(
                {
                    "n": tr.get("name") or "",  # 译名在生成阶段算
                    "to": MAP_ID_TO_KEY.get(tgt, ""),
                    "x": round(p["x"], 1),
                    "z": round(p["z"], 1),
                }
            )

        if not any(rec.values()):
            continue
        # **按本站 key 归并**：同一张图有多个版本（工厂日/夜、中心区三个）会给重复条目 ——
        # 按内容签名去重，否则地图上会叠出两份一模一样的撤离点。
        key = MAP_ID_TO_KEY[mid]
        dst = out.setdefault(key, {"extracts": [], "locks": [], "hazards": [], "transits": []})
        for kind in ("extracts", "locks", "hazards", "transits"):
            seen = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in dst[kind]}
            for x in rec[kind]:
                sig = json.dumps(x, sort_keys=True, ensure_ascii=False)
                if sig in seen:
                    continue
                seen.add(sig)
                dst[kind].append(x)
                tot[kind] += 1

    payload = {
        "fetched": datetime.date.today().isoformat(),
        "source": "json.tarkov.dev/regular/maps",
        "count": tot,
        "maps": out,
    }
    LAYERS_CACHE.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    log(
        f"   → {LAYERS_CACHE.relative_to(ROOT)}：撤离点 {tot['extracts']} ｜ "
        f"上锁 {tot['locks']} ｜ 危险区 {tot['hazards']} ｜ 转场点 {tot['transits']}"
    )


def _svg_sources(data: list) -> list[tuple[str, str]]:
    """(map key, SVG 地址) —— 只取 maps.json 里给了 `svgPath` 的图。

    瓦片图（破冰船 / 迷宫）与内联着色的实验室**按设计不进这个清单**，
    原因见模块头部的「三个特例」。
    """
    out: list[tuple[str, str]] = []
    for group in data:
        for m in group.get("maps", []):
            url = m.get("svgPath")
            if url:
                out.append((m.get("key"), url))
    return out


# ── 换肤 ─────────────────────────────────────────────────────────────────────
STYLE_BLOCK_RE = re.compile(
    r'(<style id="style_common">)(.*?)(</style>)', re.S
)


def restyle(svg_text: str, key: str) -> str:
    """把 <style id="style_common"> 的内容换成浅色板。矢量数据不动。"""
    if "style_common" not in svg_text:
        raise SystemExit(f"[错误] {key}: SVG 里找不到 <style id=\"style_common\">，上游结构变了")
    new, n = STYLE_BLOCK_RE.subn(
        lambda m: m.group(1) + "\n" + LIGHT_STYLE + m.group(3), svg_text
    )
    if n != 1:
        raise SystemExit(f"[错误] {key}: style_common 块匹配到 {n} 处，预期 1 处")
    return new


# ── 坐标投影 ─────────────────────────────────────────────────────────────────
# 来自上游 src/pages/map/index.jsx（Leaflet CRS.Simple + L.Transformation +
# applyRotation(coordinateRotation)）化简而成。2026-10-13 用 #Big_red-2f /
# #Gas_Station 两个具名图层做锚点反推验证：偏差 1.5–3.4%，方向一致（属边界留白的
# 系统性偏差）。**改动此公式前必须重跑锚点自检**，见 scripts/check_map_projection.py。
def project(x: float, z: float, meta: dict) -> tuple[float, float]:
    """世界 (x, z) → 底图像素（SVG 或拼合后的瓦片图，同一套公式）。

    **这是全站唯一一处坐标换算，改动前必读。**

    来自上游 `src/pages/map/index.jsx` 的 Leaflet CRS：旋转是**绕原点**做的，
    之后才是 `L.Transformation` 的缩放平移：

        rotatedX = x·cosθ − z·sinθ
        rotatedY = x·sinθ + z·cosθ
        layerX   = a·rotatedX + b        a = transform[0], b = transform[1]
        layerY   = c'·rotatedY + d       c' = −transform[2], d = transform[3]

    把 bounds 四角换算成 layer 点取包围盒，再归一化到 [0,1]，最后铺到 viewBox 上。

    ⚠️ **一个曾长期存在的错误**：本站早先用的是「x 取反、z 不取反」的简化公式。
    它对 `rotation = 180` 的图恰好等价（因为 180° 正好把两轴同时翻转），
    但 **rotation = 90 时轴是互换的** —— 于是**工厂图的标注一直是错的**
    （2026-10-14 用「底图宽高比 vs 变换框宽高比」判据查出来的：
    通用公式给出 0.926，与 Factory.svg 的宽高比精确相等；旧公式给出 1.080）。
    90/270 的图（工厂、实验室、迷宫）必须走通用公式。
    """
    bounds = meta["bounds"]
    vb = meta["viewBox"]                     # [x0, y0, w, h]
    tf = meta["transform"]
    rot = math.radians(meta.get("coordinateRotation") or 0)
    a, b, c, d = tf[0], tf[1], -(tf[2]), tf[3]
    xmax, zmin = bounds[0][0], bounds[0][1]
    xmin, zmax = bounds[1][0], bounds[1][1]

    def layer_pt(wx: float, wz: float) -> tuple[float, float]:
        rx = wx * math.cos(rot) - wz * math.sin(rot)
        ry = wx * math.sin(rot) + wz * math.cos(rot)
        return (a * rx + b, c * ry + d)

    cs = [layer_pt(wx, wz) for wx in (xmin, xmax) for wz in (zmin, zmax)]
    mnx, mxx = min(p[0] for p in cs), max(p[0] for p in cs)
    mny, mxy = min(p[1] for p in cs), max(p[1] for p in cs)
    px, py = layer_pt(x, z)
    u = (px - mnx) / (mxx - mnx)
    v = (py - mny) / (mxy - mny)
    return (vb[0] + u * vb[2], vb[1] + v * vb[3])


def mpp_of(meta: dict, view_box: list[float], grid: int | None = None) -> list[float]:
    """每像素代表多少世界单位（底图的 u / v 两个方向）—— 测距用。

    像素轴就是 layer 轴（旋转是正交变换、保长），所以「一格像素跨多少 layer 单位」
    除以变换比例即得。**两个方向分开算、不取平均** —— bounds 与底图的宽高比本就
    有微差（就是锚点自检里那 1.5–3.4% 的来源），取平均会让测距在两个方向各偏一点。

    `grid`：瓦片拼合图的网格边长（像素）；SVG 图传 None（用 viewBox 宽度）。
    """
    b = meta["bounds"]
    tf = meta["transform"]
    rot = math.radians(meta.get("coordinateRotation") or 0)
    a, c = abs(tf[0]), abs(tf[2])
    xmax, zmin = b[0][0], b[0][1]
    xmin, zmax = b[1][0], b[1][1]

    def layer_pt(wx, wz):
        rx = wx * math.cos(rot) - wz * math.sin(rot)
        ry = wx * math.sin(rot) + wz * math.cos(rot)
        return (tf[0] * rx + tf[1], -(tf[2]) * ry + tf[3])

    cs = [layer_pt(wx, wz) for wx in (xmin, xmax) for wz in (zmin, zmax)]
    span_u = max(p[0] for p in cs) - min(p[0] for p in cs)
    span_v = max(p[1] for p in cs) - min(p[1] for p in cs)
    px_u = grid if grid else view_box[2]
    px_v = grid if grid else view_box[3]
    return [round(span_u / (a * px_u), 6), round(span_v / (c * px_v), 6)]


VIEWBOX_RE = re.compile(r'viewBox="([\d.\s\-]+)"')
LAYER_RE = re.compile(r'<g[^>]*\bid="([^"]+)"')


def _quest_index() -> dict[str, dict]:
    """站内任务索引：`{任务id: {name, objs}}`。

    **任务名与目标描述只从这里取** —— 上游 tasks 端点返回的是英文，
    而站内中文由 `gen_quests.py --fetch` 那条管线整理，两边各走各的、互不污染。
    """
    if not LOCAL_QUESTS.exists():
        return {}
    d = json.loads(LOCAL_QUESTS.read_text(encoding="utf-8"))
    return {
        t["id"]: {
            "name": t.get("name") or t.get("en") or t["id"],
            "trader": TRADER_NAME.get(t.get("trader") or "", ""),
            "objs": t.get("objectives") or [],
        }
        for t in d.get("tasks") or []
        if t.get("id")
    }


def build_maps(data: list) -> dict:
    """把 maps.json + 换肤后的 SVG 合成站点用的数据结构。"""
    by_key = {}
    for group in data:
        for m in group.get("maps", []):
            if m.get("svgPath"):
                by_key.setdefault(m["key"], m)

    # 任务坐标区（与正文数据分开存放的那一份；没抓过就空着跑）
    zc = (
        json.loads(ZONES_CACHE.read_text(encoding="utf-8"))
        if ZONES_CACHE.exists()
        else {"zones": [], "objcount": {}}
    )
    qidx = _quest_index()
    zstat = {"desc": 0, "bytype": 0, "lost": 0, "clipped": 0, "offscreen": 0}
    lz = (
        json.loads(LAYERS_CACHE.read_text(encoding="utf-8"))
        if LAYERS_CACHE.exists()
        else {"maps": {}}
    )

    # 瓦片拼合图（破冰船 / 实验室 / 迷宫）：底图由 build_tile_maps.py 产出，
    # **不进换肤流程** —— 色彩在拼合时已按浅色主题处理过了。
    tile_cfg = (
        json.loads(TILE_CACHE.read_text(encoding="utf-8")) if TILE_CACHE.exists() else {}
    )
    jobs: list[tuple[str, dict, str, str | None]] = []
    for key, meta in sorted(by_key.items()):
        jobs.append((key, meta, "svg", None))
    for key, tinfo in sorted(tile_cfg.items()):
        meta = by_key.get(key) or next(
            (m for g in data for m in g.get("maps", []) if m.get("key") == key), {}
        )
        if meta:
            jobs.append((key, meta, "tile", tinfo["svg"]))

    out: dict[str, dict] = {}
    for key, meta, kind, tile_svg in jobs:
        grid_px: int | None = None
        if kind == "tile":
            styled = (SVG_DIR / tile_svg).read_text(encoding="utf-8")
            raw_path = Path(tile_svg)
            grid_px = tile_cfg[key]["grid"]
        else:
            raw_path = RAW_DIR / Path(meta["svgPath"]).name
            if not raw_path.exists():
                raise SystemExit(
                    f"[错误] 缺原始 SVG：{raw_path.relative_to(ROOT)} —— 先跑 --fetch"
                )
            raw_text = raw_path.read_text(encoding="utf-8")
            styled = restyle(raw_text, key)

        vb = VIEWBOX_RE.search(styled)
        if not vb:
            raise SystemExit(f"[错误] {key}: SVG 里找不到 viewBox")
        view_box = [float(v) for v in vb.group(1).split()]
        if len(view_box) != 4:
            raise SystemExit(
                f"[错误] {key}: viewBox 应为 4 个值（minX minY w h），实得 {view_box}"
            )

        # 图层：只留上游 <g id="..."> 里的顶层结构名（楼层 / 语义层）
        layers = LAYER_RE.findall(styled)

        if kind == "svg":
            SVG_DIR.mkdir(parents=True, exist_ok=True)
            (SVG_DIR / raw_path.name).write_text(styled, encoding="utf-8")

        # 按图查；查不到再查全局品牌表（品牌跨图出现，不该逐图登记）
        zh = {**GLOBAL_LABELS_ZH, **LABELS_ZH.get(key, {})}
        labels = []
        for lb in meta.get("labels") or []:
            en = lb["text"]
            pos = lb["position"]
            x, y = project(pos[0], pos[1], {**meta, "viewBox": view_box})
            labels.append(
                {
                    "en": en,
                    "cn": zh.get(en, ""),  # 无译名 → 空，页面退回英文（不自己编）
                    "x": round(x, 1),
                    "y": round(y, 1),
                }
            )

        # ── 任务点位：把世界坐标 box 投影成像素矩形 ──
        #    坐标↔像素的翻转与 labels 同一条公式；投影后要**重取 min/max**，
        #    因为公式里 x 是反向的（x 大 → 像素 x 小），直接用原顺序会得到负宽度。
        # 投影要用到 bounds / transform / rotation 三件，**不能只传 bounds** ——
        # 旋转感知的公式需要后两者（见 project() 的说明）。
        pmeta = {**meta, "viewBox": view_box}
        quest_zones: list[dict] = []
        for z in zc["zones"]:
            if MAP_ID_TO_KEY.get(z["map"]) != key:
                continue
            q = qidx.get(z["task"])
            if not q:
                zstat["lost"] += 1
                continue
            X1, Y1 = project(z["box"][0], z["box"][1], pmeta)
            X2, Y2 = project(z["box"][2], z["box"][3], pmeta)

            # ── 裁到画布内 ──
            # 上游有 2% 的 zone 边角越出地图范围（最极端的一条面积是画布的 3.4 倍）。
            # 不裁会怎样：框画到画布外、被 viewBox 隐式剪掉，**但描边与命中区仍在**，
            # 于是「看不见的地方也能点到」，读者会莫名其妙地选中一个任务。
            bx, by = min(X1, X2), min(Y1, Y2)
            bw, bh = abs(X2 - X1), abs(Y2 - Y1)
            # 单点点位（宽高为 0）先撑成一个可见的小方块，否则裁完就没了
            if bw < 0.5 and bh < 0.5:
                bw = bh = 1.0
            cx0, cy0 = max(0.0, bx), max(0.0, by)
            cx1, cy1 = min(view_box[2], bx + bw), min(view_box[3], by + bh)
            if cx1 - cx0 < 0.5 or cy1 - cy0 < 0.5:
                zstat["offscreen"] += 1        # 整条都在画布外（上游坐标问题），不画
                continue
            if (cx0, cy0, cx1, cy1) != (bx, by, bx + bw, by + bh):
                zstat["clipped"] += 1

            # ── 按面积分档 ──
            # 语义上就该有大框：`shoot`（在图里击杀 N 个）中位面积就有画布的 9.6%，
            # 而 `plantItem`（在某处放东西）中位只有 0.001% —— 一个是区域、一个是点。
            # 分档只影响**视觉权重**（大框退到背景、小框突出），不改坐标。
            area_ratio = ((cx1 - cx0) * (cy1 - cy0)) / (view_box[2] * view_box[3])
            size = "l" if area_ratio > 0.20 else ("m" if area_ratio > 0.02 else "s")

            rec = {
                "q": z["task"],
                "n": q["name"],
                "tr": q["trader"],                           # 商人：面板按它分组
                "k": z["type"],                              # 英文类型：给 CSS 分类用
                "t": OBJ_TYPE_ZH.get(z["type"], z["type"]),  # 中文标签：给人看
                "x": round(cx0, 1),
                "y": round(cy0, 1),
                "w": round(cx1 - cx0, 1),
                "h": round(cy1 - cy0, 1),
                "sz": size,          # 面积档：s / m / l（仅影响视觉权重）
                "px": round(area_ratio * 100, 3),   # 占画布面积的百分比（页面提示用）
            }
            # 描述**只在「上游 objective 数与站内一致」时**给 —— 数量不同说明两边版本
            # 不同，按索引取会张冠李戴。宁可只给「任务名 + 目标类型」这一层。
            if zc["objcount"].get(z["task"]) == len(q["objs"]) and z["oi"] < len(q["objs"]):
                rec["d"] = q["objs"][z["oi"]].get("text", "")
                zstat["desc"] += 1
            else:
                zstat["bytype"] += 1
            quest_zones.append(rec)

        # ── 图层：撤离点 / 上锁 / 危险区 ──
        lm = lz["maps"].get(key) or {}

        def pt(x, z):
            X, Y = project(x, z, pmeta)
            return [round(X, 1), round(Y, 1)]

        extracts = [
            {
                "n": e["n"],
                # ⚠️ **译名在生成阶段现算，不用缓存里的值。**
                # 早先是抓取时算好存进 map_layers.json 的，结果「改了词表却不生效」——
                # 缓存没失效，数据自然没变。译名属于**展示口径**，与坐标缓存是两回事，
                # 必须解耦：坐标缓存一次抓、长期用；译名每次生成时按当前词表算。
                "nzh": humanize_extract(e["n"]),
                "f": e["f"],
                "fzh": FACTION_ZH.get(e["f"], e["f"] or "—"),
                "p": pt(e["x"], e["z"]),
            }
            for e in lm.get("extracts") or []
        ]
        locks = [
            {
                "tzh": LOCK_ZH.get(lk["t"], lk["t"] or "锁"),
                "k": lk["k"],  # 钥匙物品 id（页面链到站内物品图鉴）
                "pw": lk["pw"],
                "p": pt(lk["x"], lk["z"]),
            }
            for lk in lm.get("locks") or []
        ]
        hazards = [
            {
                "tzh": HAZARD_ZH.get(h["t"], h["t"] or "危险区"),
                "pts": [pt(x, z) for x, z in h["pts"]],
            }
            for h in lm.get("hazards") or []
        ]
        transits = [
            {
                # 上游的 transits 只有目标图 id、**没有名字** —— 名字由目标图推出来。
                # 推不出来的（目标图不在本站收录范围）退回「其他地图」，不编造具体图名。
                "nzh": ("前往" + MAP_ZH.get(tr.get("to"), "其他地图"))
                if tr.get("to")
                else "转场点",
                "to": tr.get("to") or "",  # 目标图的本站 key（供页面做「去看那张图」）
                "p": pt(tr["x"], tr["z"]),
            }
            for tr in lm.get("transits") or []
        ]

        out[key] = {
            "nameEn": meta.get("normalizedName") or key,
            "kind": kind,
            "svg": raw_path.name,
            "viewBox": [round(v, 2) for v in view_box],
            # 每像素代表多少世界单位（底图的 u / v 两个方向）—— 测距用。
            # 通用算法：像素轴就是 layer 轴（旋转是正交的，保长），
            # 所以「一个像素跨多少 layer 单位」÷「变换比例」即得。
            # **不取平均**：两个方向的尺度本就不等（bounds 与 viewBox 的宽高比有微差）。
            "mpp": mpp_of(meta, view_box, grid_px),
            "floors": _floors(layers),
            "layers": layers,
            "labels": labels,
            "questZones": quest_zones,
            "extracts": extracts,
            "locks": locks,
            "hazards": hazards,
            "transits": transits,
        }
        log(
            f"   ✓ {key:<18} {raw_path.name:<20} labels={len(labels):<3} "
            f"任务点位={len(quest_zones):<4} 撤离点={len(extracts):<3} "
            f"上锁={len(locks):<3} 危险区={len(hazards):<3} 转场={len(transits)}"
        )

    if zstat["lost"]:
        log(f"   （{zstat['lost']} 条点位找不到对应任务，已跳过）")
    if zstat["clipped"] or zstat["offscreen"]:
        log(
            f"   （越界处理：{zstat['clipped']} 条裁到画布内、"
            f"{zstat['offscreen']} 条整条在画布外已跳过）"
        )
    return out


# ── 输出 ─────────────────────────────────────────────────────────────────────
def write_js(maps: dict) -> None:
    payload = json.dumps(maps, ensure_ascii=False, separators=(",", ":"))
    js = f"""/* ==========================================================================
   交互地图 · 数据（**生成物，不要手改**）
   --------------------------------------------------------------------------
   生成：python scripts/gen_maps.py          （离线，用缓存）
         python scripts/gen_maps.py --fetch  （重新抓上游数据）

   站点基线：{baseline_label()}
   底图来源：the-hideout/tarkov-dev-svg-maps（Shebuka），CC BY-NC-SA 4.0
             —— 署名与使用边界见 content/docs/citation.md 第四节。

   字段：
     svg       底图文件名（位于 assets/maps/，由 map.js 按脚本位置推导绝对路径）
     viewBox   SVG 视口（minX minY w h），点位坐标即在此坐标系内
     floors    楼层图层（id + 中文名），页面做互斥显示的切换按钮
     layers    上游全部图层 id（含材质层与 `*-locked` 子层），备查
     labels    地名锚点；cn 为空表示站内暂无译名，页面退回英文（不自己编）
     questZones 任务点位：q=任务id、n=任务名、t=目标类型、d=目标描述（可能为空，
                上游与站内 objective 数量不一致时不给，避免张冠李戴）、
                x/y/w/h = 投影后的像素矩形。

   ⚠️ **questZones 的任务 id 与「我的进度」是同一套键**（localStorage
      `tarkov_progress_v1` 里的 `modes.<mode>.quests`），所以地图能直接读进度
      做「只看未完成」筛选 —— 不需要任何桥接表。

   点位坐标 = 由上游 labels 的世界坐标经 scripts/gen_maps.py:project() 投影而来，
   **不是手工放置的**。公式的锚点自检见 scripts/check_map_projection.py。
   ========================================================================== */
window.TARKOV_MAPS = {payload};
"""
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(js, encoding="utf-8")
    log(f"\n③ 写出 {OUT_JS.relative_to(ROOT)}（{len(js.encode('utf-8')) / 1024:.1f} KB）")


def main() -> int:
    ap = argparse.ArgumentParser(description="生成交互地图底图与点位数据")
    ap.add_argument("--fetch", action="store_true", help="重新抓上游数据（联网）")
    args = ap.parse_args()

    if args.fetch or not CACHE.exists():
        if not args.fetch and not CACHE.exists():
            log("缓存不存在，自动走 --fetch")
        fetch()
    else:
        if not ZONES_CACHE.exists():
            log("缺任务点位缓存，单独补抓（不重下 SVG）")
            fetch_quest_zones()
        if not LAYERS_CACHE.exists():
            log("缺图层缓存，单独补抓（不重下 SVG）")
            fetch_map_layers()

    data = json.loads(CACHE.read_text(encoding="utf-8"))
    log(f"\n② 换肤并投影（{len(_svg_sources(data))} 张）…")
    maps = build_maps(data)
    write_js(maps)
    log(f"\n✅ 完成：{len(maps)} 张图，共 "
        f"{sum(len(m['labels']) for m in maps.values())} 个地名锚点")
    return 0


if __name__ == "__main__":
    sys.exit(main())
