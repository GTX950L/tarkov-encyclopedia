#!/usr/bin/env python3
"""任务 ↔ 交互地图 的接线判定：中文地图名 → 地图页 key，以及「图上有没有可画的坐标」。

**为什么单开一个模块**：这份判定被三处共用 ——

  · `gen_maps.py`           —— `MAP_ID_TO_KEY`（上游地图 id → 站内 key）搬到这里，
                               判定坐标归属要用它
  · `gen_quests.py`         —— 任务详情分片的 `mz` 字段（任务详情页据此决定
                               给不给「在地图上看 →」，还是给一行「无坐标」说明）
  · `gen_quest_insights.py` —— 任务图鉴索引数据的 `mz` 列（进度页「最划算的可接」
                               推荐卡据此选链：地图深链 or 退回任务详情）

不能把 `MAP_ID_TO_KEY` 留在 gen_maps：gen_maps 已经 import gen_quests（取目标类型
中文表），再让 gen_quests 反过来 import gen_maps 会成环。放这里两边都能取，**且只有这一份**。

口径：一个任务「可在地图上看」= 它的地图归属（quests.json 的 `map` 字段）对应的
站内地图上，至少有一条**可画的任务区域**（quest_zones.json 里同 task 同 map 的记录）。
quest_zones.json 是 gen_maps.py --fetch 的抓取缓存（已入库），本模块只读不抓 ——
所以它是**离线**的，与其它生成器同一条纪律。

⚠️ 中文名用的是 **quests.json 的词表**（「塔科夫街区」，不是 gen_maps `MAP_ZH` 的
   「街区」）—— 两套词表服务不同对象（任务侧对读者显示，地图侧对「前往 XX」转场
   显示），不要互相「对齐」，对齐反而会把任务侧改错。

⚠️ 站内 JS 侧还有两份同样的 CN→key 映射（`quest-detail.js` 与 `progress-boards.js`
   的 MAP_KEY），那是前端拼链接用的，**与本模块必须同改** —— 前端两处注释里
   已经写了这条纪律。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZONES_CACHE = ROOT / "scripts" / "data" / "quest_zones.json"

# 中文地图名 → 地图页 key（值域 = content/maps/<key>.md）。
# ⚠️ 键取自 quests.json 的 map 字段实际取值（2026-10-17 核）。
MAP_KEY_BY_CN: dict[str, str] = {
    "海关": "customs",
    "工厂": "factory",
    "夜间工厂": "factory",
    "中心区": "ground-zero",
    "森林": "woods",
    "立交桥": "interchange",
    "储备站": "reserve",
    "海岸线": "shoreline",
    "灯塔": "lighthouse",
    "塔科夫街区": "streets-of-tarkov",
    "终点站": "terminal",
    "破冰船": "icebreaker",
    "实验室": "the-lab",
    "迷宫": "the-labyrinth",
}

# 上游地图 id → 本站 maps.json 的 key。
# 多版本图（工厂日/夜、中心区三个版本）**归到同一把 key** ——
# 点位落在同一个底图坐标系里，分开反而会让读者找不到。
# （2026-10-17 从 gen_maps.py 搬来，行为不变；原处的注释随字典一并迁移。）
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
    "69af492a4819ea4ba10a69c5": "icebreaker",
    "6733700029c367a3d40b02af": "the-labyrinth",
}


def _zone_keys_by_quest() -> dict[str, set[str]] | None:
    """{任务 id: 该任务有坐标区的地图 key 集合}；缓存缺失返回 None。"""
    if not ZONES_CACHE.exists():
        return None
    zc = json.loads(ZONES_CACHE.read_text(encoding="utf-8"))
    out: dict[str, set[str]] = {}
    for z in zc.get("zones") or []:
        k = MAP_ID_TO_KEY.get(z.get("map"))
        if k:
            out.setdefault(z["task"], set()).add(k)
    return out


def linkable_ids(tasks: list[dict]) -> set[str]:
    """这批任务里**「在地图上可定位」**的 id 集合。

    判据：任务的地图归属（`map` 字段）对应的站内图上，至少有一条可画区域。

    ⚠️ 缓存缺失时的兜底是**「全部按可定位处理」而不是「全部不可定位」**——
       前者退回旧的链接行为（可能给到落空提示页，但提示页本身有解释与出路），
       后者会给 263 个任务全盖上「无坐标」的错误说明。两害相权，取前者。
    """
    have = _zone_keys_by_quest()
    if have is None:
        return {t["id"] for t in tasks}
    out: set[str] = set()
    for t in tasks:
        k = MAP_KEY_BY_CN.get(t.get("map") or "")
        if k and k in have.get(t["id"], set()):
            out.add(t["id"])
    return out
