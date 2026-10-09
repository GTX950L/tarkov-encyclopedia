#!/usr/bin/env python3
"""任务图鉴：数据层（抓取 + 精简）与页面生成器。

两条命令：

    python scripts/gen_quests.py --fetch     # 从 json.tarkov.dev 抓取并精简，写 scripts/data/quests.json
    python scripts/gen_quests.py             # 读 scripts/data/quests.json，生成 content/quests/*.md

**为什么分成「抓取」与「生成」两步**：生成这一步必须能**离线复现** ——
页面内容一旦依赖网络，任何一次接口漂移（本站已经遇到过一次：
旧 GraphQL 端点对任何查询都返回 422）都会把「重新生成」变成不可完成的任务。
抓取结果精简后入库，生成只读它。`--fetch` 只在数据该更新时手动跑。

**坐标在抓取这一步就被丢掉**（见 `slim_objective`）：站内不收「只在某个具体
点位成立」的信息（引用说明第六节），把这条规矩做进数据管道，比事后靠人记得删可靠。
被同一条规矩剔掉的字段有三类：目标上的 `zones`（坐标盒与轮廓）、
`findQuestItem` 的 `possibleLocations`（点位坐标组）、以及 `shoot` 的
`playerHealthEffect` 里的坐标。**判定依据是「字段里有没有真实 x/y/z」**，
不是「字段叫什么」。

数据源（均为二级来源）：json.tarkov.dev 的 regular（持久 PvP）档案。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "scripts" / "data" / "quests.json"
CARRIER_FILE = ROOT / "scripts" / "data" / "quests_carrier.json"
OUT_DIR = ROOT / "content" / "quests"

# 任务 id → 携带清单。由 gen_quest_carrier.py 生成，**缺失时整块功能降级**：
# 没有这个文件就当「所有任务都不需要自备物品」，页面照常生成，
# 只是不出现「出发前必带」那一栏 —— **绝不能因为辅助数据缺失就让整页生成失败**。
CARRIER_IDX: dict[str, dict] = {}
if CARRIER_FILE.exists():
    _cp = json.loads(CARRIER_FILE.read_text(encoding="utf-8"))
    CARRIER_IDX = {c["id"]: c for c in _cp.get("carriers", [])}
else:
    print("[提示] 找不到 quests_carrier.json —— 「出发前必带」一栏将不生成"
          "（先跑 python scripts/gen_quest_carrier.py）")

API = "https://json.tarkov.dev/regular/"
FETCH_DATE = "2026-09-30"
BASELINE = ("2026 年 9 月", "1.1.5.1（第一赛季 KORD BREACH）")

# index.md 里由 **另一个脚本**（gen_quest_items.py）生成的速查区。本栏「整栏重建」时必须搬过来。
EXTRAS_START = "<!-- AUTO-GEN:QUEST-EXTRAS:START -->"
EXTRAS_END = "<!-- AUTO-GEN:QUEST-EXTRAS:END -->"
# 第二个由**别的脚本**生成的区块（scripts/gen_quest_insights.py 的优先级速查）。
# 加进 carry_over 名单里 —— 漏一个，那一块会在整栏重建时**静默消失**。
INSIGHTS_START = "<!-- AUTO-GEN:QUEST-INSIGHTS:START -->"
INSIGHTS_END = "<!-- AUTO-GEN:QUEST-INSIGHTS:END -->"

# 栏目内的页面顺序 —— 与 entries/trader-questlines.md §2.1 的商人排列一致
TRADER_ORDER = [
    "mechanic", "prapor", "skier", "jaeger", "ragman", "therapist",
    "peacekeeper", "fence", "ref", "btr-driver", "lightkeeper",
]
# 站内既有叫法（trader-questlines.md 同款）
TRADER_LABEL = {
    "mechanic": "Mechanic", "prapor": "Prapor", "skier": "Skier",
    "jaeger": "Jaeger", "ragman": "Ragman", "therapist": "Therapist",
    "peacekeeper": "Peacekeeper", "fence": "Fence",
    "ref": "Ref（竞技场裁判）", "btr-driver": "BTR 司机",
    "lightkeeper": "Lightkeeper",
}

# 命中部位 —— 数据端点给的是英文枚举（`QuestCondition/.../BodyPart/Head`），
# 扁平翻译字典里**没有**这几个键，只能自己给中文；这与「译名一律不自己编」
# 的原则不冲突：这里的英文本身就是**枚举值**而不是可译文本。
BODY_PART = {
    "Head": "头部", "Chest": "胸部", "Stomach": "腹部",
    "LeftArm": "左臂", "RightArm": "右臂", "LeftLeg": "左腿", "RightLeg": "右腿",
}
# 任务状态枚举 —— 扁平翻译字典里**没有** `complete`／`failed`／`active` 这几个键，
# 只能自己给中文。这三个词与 `status_text()` 用的是同一套措辞，两处必须一致。
TASK_STATUS = {"complete": "完成", "failed": "失败", "active": "进行中"}


def uniq(vals: list[str]) -> list[str]:
    """去重但保序。

    同一个目标可以同时命中 `Savage` 与 `assaultGroup`，而本地化把两者都译成
    「Scav」—— 不去重就会出现「目标：Scav／Scav／狙击手」这种看起来像渲染 bug 的行。
    """
    seen, out = set(), []
    for v in vals:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
    ),
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
    "Accept": "application/json",
}


# ─────────────────────────────────────────────────────────────────────────────
# 抓取与精简
# ─────────────────────────────────────────────────────────────────────────────

def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def one_line(s: str) -> str:
    """压成单行、去首尾空白。任务描述里偶有换行，进正文会破坏列表结构。"""
    return re.sub(r"\s+", " ", (s or "").strip())


def en_name(slug: str) -> str:
    """任务英文名：`first-in-line` → `First in Line`。

    **必须去连字符**——站内搜索按词切分，留 slug 形式会让「First in Line」搜不到。
    短词（of / in / the / a / and / to / for …）保持小写，除非它是首词。
    """
    s = (slug or "").replace("-", " ").strip()
    if not s:
        return ""
    small = {"of", "in", "the", "a", "an", "and", "to", "for", "on", "at", "by", "with"}
    words = s.split()
    return " ".join(w if (i and w.lower() in small) else w.capitalize()
                    for i, w in enumerate(words))


def quote_cn(s: str) -> str:
    """把直引号成对换成「」，满足站内「中文正文不留直引号」的硬检查。

    奇数个引号时最后一个落单 —— 直接丢掉，绝不留下会被 check_entries 拦下的字符。
    """
    out, open_ = [], True
    for ch in s:
        if ch == '"':
            out.append("「" if open_ else "」")
            open_ = not open_
        else:
            out.append(ch)
    if not open_:  # 落单的收尾引号
        while out and out[-1] != "」":
            out.pop()
        if out:
            out.pop()
    return "".join(out)


def cell(s: str) -> str:
    """表格安全：竖线会把单元格切碎。"""
    return quote_cn(one_line(s)).replace("|", "／")


def num(v):
    """端点里数值字段**有时是字符串**（如 `maxDurability: "100"`），统一成数字。

    不转换就会在 `a < b` 上抛 TypeError —— 抓取是整站重建的一次性动作，
    宁可在这一层妥协，也不要为了类型洁癖让整条管道崩掉。
    """
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


def status_text(status) -> str:
    """前置条件的状态语义 —— 「失败也能解锁」这类边是树表达不了的，必须写出来。"""
    st = set(status or [])
    if st == {"complete"}:
        return ""
    if st == {"failed"}:
        return "（**只要求该任务失败过**）"
    if st == {"active"}:
        return "（**只要该任务处于进行中**，不必完成）"
    if st == {"complete", "failed"}:
        return "（**完成或失败皆可**）"
    if st == {"complete", "active"}:
        return "（**完成，或只要处于进行中**）"
    return f"（状态：{'／'.join(sorted(st))}）" if st else ""


def id_groups(rk, nameof, kind="item") -> list[str]:
    """`requiredKeys` / `usingWeaponMods` / `wearing` 的元素是**候选组**：一组里任一件都算。

    群组之间是「或」的关系 —— 写成顿号会让人以为要凑齐。
    元素还可能是对象（`{id, name}` 形态），统一取 `id` 交给 `nameof` 查译名。
    """
    out = []
    for g in rk or []:
        if isinstance(g, (list, tuple)):
            out.append("／".join(nameof(kind, x) for x in g))
        else:
            out.append(nameof(kind, g))
    return out


def slim_objective(o: dict, nameof) -> dict:
    """把一个 objective 压成展示用的记录 —— **坐标在这里就被丢弃**。

    被丢弃的是三类含真实 x/y/z 的字段：本目标自己的 `zones`（坐标盒与轮廓）、
    `findQuestItem` 的 `possibleLocations`（点位坐标组）、`shoot` 的
    `playerHealthEffect`。它们属站内明确不收的「只在某个具体点位成立」的一类
    （引用说明第六节）。**不进 JSON，后面也就无从渲染出来** ——
    比「渲染时记得跳过」可靠，因为渲染代码以后还会改，数据管道只走一次。

    保留下来的只有「在哪张图」这一层：`maps` 是地图归属，不是坐标。
    """
    ty = o.get("type")
    d: dict = {"type": ty,
               "text": quote_cn(one_line(nameof("obj", o.get("id"))))}
    if o.get("optional"):
        d["optional"] = True
    cnt = num(o.get("count"))
    if cnt:
        d["count"] = cnt

    def parts(vals) -> list[str]:
        """命中部位：英文枚举 → 中文；词典里查得到的（如 Scav 类）优先用词典。"""
        out = []
        for x in vals or []:
            seg = str(x).split("/")[-1]
            out.append(BODY_PART.get(seg, nameof("text", seg)))
        return out

    def state(src) -> dict:
        """击杀／撤离时对方或自身要处于的状态（脱水、震撼、疲劳…）。"""
        he = src.get("healthEffect") or {}
        ef = [nameof("text", x) for x in (he.get("effects") or src.get("effects") or [])]
        bp = parts(he.get("bodyParts") or src.get("bodyParts"))
        tm = (he.get("time") or {})
        out = {}
        if ef:
            out["effects"] = [x for x in ef if x]
        if bp:
            out["parts"] = [x for x in bp if x]
        if tm.get("value"):
            out["time"] = [tm.get("compareMethod", ">="), num(tm["value"])]
        return out

    # 物品类目标共用的「道具清单」：items / useAny / questItem 三种来源
    items = [nameof("item", i) for i in (o.get("items") or [])]
    items += [nameof("item", i) for i in (o.get("useAny") or [])]
    if o.get("questItem"):
        items.insert(0, nameof("quest", o["questItem"]))

    if ty in ("giveItem", "findItem", "sellItem", "useItem", "plantItem",
              "giveQuestItem", "findQuestItem", "plantQuestItem"):
        if items:
            d["items"] = items
        if o.get("foundInRaid"):
            d["fir"] = True
        mud, mad = num(o.get("minDurability")), num(o.get("maxDurability"))
        if mud:
            d["minDur"] = mud
        if mad and mad < 100:
            d["maxDur"] = mad
        dtl = num(o.get("dogTagLevel"))
        if dtl:
            d["dogTag"] = dtl
    elif ty == "mark":
        d["items"] = ([nameof("item", o["markerItem"])] if o.get("markerItem") else []) + items
    elif ty == "buildWeapon":
        d["single"] = nameof("item", o.get("item"))
        ba = {k: v for k, v in (o.get("buildAttributes") or {}).items()
              if isinstance(v, dict) and v.get("value")}
        if ba:
            d["attrs"] = {k: [v.get("compareMethod", ">="), v["value"]] for k, v in ba.items()}
        ca = [nameof("item", i) for i in (o.get("containsAll") or [])]
        if ca:
            d["containsAll"] = ca
    elif ty == "shoot":
        if o.get("shotType"):
            d["single"] = SHOT_TYPE.get(o["shotType"], o["shotType"])
        tg = uniq([nameof("text", t) for t in (o.get("targetNames") or [])])
        if tg:
            d["targets"] = tg
        bp = uniq(parts(o.get("bodyParts")))
        if bp:
            d["bodyParts"] = bp
        dist = o.get("distance") or {}
        dv = num(dist.get("value"))
        if dv:
            d["dist"] = [dist.get("compareMethod", ">="), dv]
        tf, tu = num(o.get("timeFromHour")) or 0, num(o.get("timeUntilHour")) or 0
        if tu:
            d["window"] = [tf, tu]
        v = [nameof("item", i) for i in (o.get("usingWeapon") or [])]
        if v:
            d["weapons"] = v
        for src, key in (("wearing", "wearing"), ("notWearing", "notWearing")):
            # 这两个字段的元素**可能是对象**（`{id, name}`），也可能是候选组（list）
            v = [x for x in id_groups(o.get(src), nameof) if x]
            if v:
                d[key] = v
        if o.get("usingWeaponMods"):
            d["mods"] = id_groups(o["usingWeaponMods"], nameof)
        st = state({"healthEffect": o.get("enemyHealthEffect")})
        if st:
            d["state"] = st
    elif ty == "experience":
        # 端点把「击杀处于某状态的目标」也编成 experience 型，字段挂在顶层
        st = state(o)
        if st:
            d["state"] = st
        tg = uniq([nameof("text", t) for t in (o.get("targetNames") or [])])
        if tg:
            d["targets"] = tg
    elif ty == "extract":
        if o.get("exitName"):
            d["single"] = nameof("text", o["exitName"])
        es = [x for x in (nameof("text", e) for e in (o.get("exitStatus") or [])) if x]
        if es:
            d["exitStatus"] = es
        st = state(o)
        if st:
            d["state"] = st
    elif ty == "skill":
        d["single"] = nameof("skill", o.get("skill"))
        d["level"] = num(o.get("level"))
    elif ty == "traderLevel":
        d["single"] = nameof("trader", o.get("trader"))
        d["level"] = num(o.get("level"))
    elif ty == "traderStanding":
        d["single"] = nameof("trader", o.get("trader"))
        d["value"] = num(o.get("value"))
        d["cmp"] = o.get("compareMethod", ">=")
    elif ty == "taskStatus":
        d["single"] = nameof("task", o.get("task"))
        d["status"] = [TASK_STATUS.get(str(x), nameof("text", x))
                       for x in (o.get("status") or [])]
    elif ty == "dialogue":
        d["traders"] = [nameof("trader", t) for t in (o.get("traders") or [])]
    elif ty == "globalVariable":
        gv = o.get("globalVariable") or {}
        d["value"] = gv.get("value")
        d["cmp"] = gv.get("compareMethod", "==")

    if o.get("requiredKeys"):
        d["keys"] = id_groups(o["requiredKeys"], nameof)
    maps = [nameof("map", m) for m in (o.get("maps") or [])]
    if maps:
        d["maps"] = maps
    return d


def merge_by_name(pairs: list) -> list:
    """同名合并计数（保序）。

    端点会把同一件东西拆成多条 —— `VPX闪存模块 ×1` 连着出现三次，读起来像三样东西。
    合并只做**同名累加**，总量不变，也不改任何一条的归属。
    """
    order, total = [], {}
    for nm, c in pairs:
        if nm not in total:
            order.append(nm)
            total[nm] = 0
        total[nm] += c
    return [[nm, total[nm]] for nm in order]


def slim_reward(r: dict, nameof, ach=None, cust=None) -> dict:
    """完成奖励 / 接取奖励 / 失败扣除共用同一套字段结构。

    `offerUnlock`（解锁购买）、`craftUnlock`（解锁制作）、`customization`（外观）
    的元素是**对象**而不是 id，各自要取不同的键 —— 直接当 id 用会崩。
    `achievement` 的元素是**字符串 id**，名字要从 achievements 表里二次查。
    """
    ach = ach or (lambda x: str(x))
    cust = cust or (lambda x: str(x))
    out: dict = {}
    items = merge_by_name([[nameof("item", x["item"]), num(x.get("count")) or 1]
                           for x in (r.get("items") or []) if nameof("item", x["item"])])
    if items:
        out["items"] = items
    st = merge_by_name([[nameof("trader", x["trader"]), num(x.get("standing")) or 0]
                        for x in (r.get("traderStanding") or [])])
    if st:
        out["standing"] = st

    unlock = []
    for x in r.get("offerUnlock") or []:
        s = nameof("item", x.get("item"))
        if not s:
            continue
        c = num(x.get("count")) or 1
        if c > 1:
            s += f" ×{c}"
        tail = []
        if x.get("trader"):
            tail.append(nameof("trader", x["trader"]))
        lv = num(x.get("level"))
        if lv:
            tail.append(f"LL{lv}")
        if tail:
            s += f"（{' '.join(tail)}）"
        unlock.append(s)
    if unlock:
        out["offerUnlock"] = uniq(unlock)

    craft = []
    for x in r.get("craftUnlock") or []:
        s = nameof("item", x.get("item"))
        if not s:
            continue
        c = num(x.get("count")) or 1
        if c > 1:
            s += f" ×{c}"
        lv = num(x.get("level"))
        if lv:
            s += f"（工作站 Lv{lv}）"
        craft.append(s)
    if craft:
        out["craftUnlock"] = uniq(craft)

    for key, tag in (("traderUnlock", "traderUnlock"),
                     ("traderDialogueUnlock", "dialogueUnlock"),
                     ("locationUnlock", "locationUnlock")):
        vals = [nameof("trader" if key != "locationUnlock" else "map", x)
                for x in (r.get(key) or [])]
        vals = [v for v in vals if v]
        if vals:
            out[tag] = vals

    vals = uniq([v for v in (ach(x) for x in (r.get("achievement") or [])) if v])
    if vals:
        out["achievement"] = vals

    vals = uniq([v for v in (cust(x) for x in (r.get("customization") or [])) if v])
    if vals:
        out["customization"] = vals

    sk = [[nameof("skill", x.get("skill")), num(x.get("level"))]
          for x in (r.get("skillLevelReward") or [])]
    sk = [x for x in sk if x[0]]
    if sk:
        out["skills"] = sk
    return out


def fetch() -> dict:
    print("抓取 json.tarkov.dev ...")
    tasks_payload = get("tasks")["data"]
    tasks = tasks_payload["tasks"]
    quest_items = tasks_payload.get("questItems") or {}
    achievements = tasks_payload.get("achievements") or {}
    prestige = {p["id"]: p.get("prestigeLevel") for p in (tasks_payload.get("prestige") or [])}
    tasks_zh = get("tasks_zh")["data"]
    traders = get("traders")["data"]
    items_zh = get("items_zh")["data"]
    maps = get("maps")["data"]["maps"]
    maps_zh = get("maps_zh")["data"]
    print(f"  任务 {len(tasks)} ／ 任务物品 {len(quest_items)} ／ 成就 {len(achievements)} "
          f"／ 商人 {len(traders)} ／ 物品译名 {len(items_zh)} ／ 地图 {len(maps)}")

    def trader_norm(tid):
        v = traders.get(tid) or {}
        return v.get("normalizedName") or tid

    def trader_label(tid):
        return TRADER_LABEL.get(trader_norm(tid), trader_norm(tid))

    def zh_text(key):
        """扁平翻译字典直查。

        字典的键分四类：任务占位名（`<id> Name`）、目标描述（裸 `<id>`）、
        枚举半句（如 `Any` → 「任意目标：」，**带收尾冒号**）、技能／状态名。
        查不到就返回空串 —— 宁可少一句，也不把十六进制 id 当正文印出来。
        """
        v = tasks_zh.get(str(key))
        return quote_cn(one_line(v)).rstrip("：: 　") if v else ""

    def zh_keep(key):
        """同上，但查不到时保留原文（用于撤离点名、目标类型这类自带信息的枚举）。"""
        return zh_text(key) or quote_cn(str(key))

    miss: Counter = Counter()

    def nameof(kind, key):
        # 有些列表字段的元素是对象（`{id, name}`）而不是 id —— 统一取 id 再查译名
        if isinstance(key, dict):
            key = key.get("id")
        if not key:
            return ""
        if kind == "task":
            t = tasks.get(key)
            return quote_cn(tasks_zh.get(t["name"], t["name"])) if t else zh_keep(key)
        if kind == "obj":
            return zh_text(key)
        if kind == "text":
            return zh_keep(key)
        if kind == "trader":
            return trader_label(key)
        if kind == "item":
            v = items_zh.get(key + " Name") or items_zh.get(key + " ShortName")
            if not v:
                # 查不到就**空着**：宁可少一件，也不把十六进制 id 或英文名印进中文正文
                miss["item"] += 1
                return ""
            return quote_cn(v)
        if kind == "quest":
            qi = quest_items.get(key) or {}
            return quote_cn(tasks_zh.get(qi.get("name", ""), qi.get("name") or key))
        if kind == "map":
            v = maps.get(key) or {}
            return quote_cn(maps_zh.get(v.get("name", ""), v.get("normalizedName", key)))
        if kind == "skill":
            return zh_keep(key)
        return quote_cn(items_zh.get(key + " Name") or tasks_zh.get(key, key))

    def ach_name(x):
        a = achievements.get(x) or {}
        return quote_cn(tasks_zh.get(a.get("name", ""), a.get("normalizedName", "")))

    def cust_name(x):
        if isinstance(x, dict):
            return quote_cn(tasks_zh.get(x.get("name", ""), ""))
        return quote_cn(str(x))

    def other_reqs(t):
        """`otherRequirements` 两类：对话、进度计数。

        进度计数的 `variableId` 在端点与翻译字典里**都没有名字**（已核对
        27 个计数器、每个只归属一位商人、无跨商人）。所以站内只**按唯一归属**
        还原出商人名，不代它编一个含义 —— 见总览页「怎么读这些字段」。
        """
        out = []
        for o in t.get("otherRequirements") or []:
            ty = o.get("type")
            if ty == "dialogue":
                tr = [nameof("trader", x) for x in (o.get("traders") or [])]
                if tr:
                    out.append({"kind": "dialogue", "traders": tr})
            elif ty == "globalVariable":
                out.append({
                    "kind": "counter",
                    "trader": trader_label(t["trader"]),
                    "cmp": o.get("compareMethod", ">="),
                    "value": num(o.get("value")),
                })
        return out

    records = []
    for tid, t in tasks.items():
        reqs = []
        for r in t.get("taskRequirements") or []:
            p = r.get("task")
            if p in tasks:
                reqs.append({
                    "name": nameof("task", p),
                    "trader": trader_label(tasks[p]["trader"]),
                    "status": status_text(r.get("status")),
                })
        treqs = []
        for r in t.get("traderRequirements") or []:
            treqs.append({
                "kind": r.get("requirementType") or "level",
                "trader": trader_label(r.get("trader")),
                "cmp": r.get("compareMethod", ">="),
                "value": num(r.get("value")),
            })
        records.append({
            "id": tid,
            "name": nameof("task", tid),
            # 英文名：数据端点给的是 slug（first-in-line）。**要转成空格分隔的自然写法**，
            # 因为站内搜索按词切分、不做连字符展开——留 slug 等于搜不到。
            "en": en_name(t.get("normalizedName")),
            "trader": trader_norm(t["trader"]),
            "level": num(t.get("minPlayerLevel")) or 0,
            "exp": num(t.get("experience")) or 0,
            "map": nameof("map", t["map"]) if t.get("map") else "",
            "faction": "" if t.get("factionName") in (None, "Any") else t["factionName"],
            "prestige": num(prestige.get(t.get("requiredPrestige") or "")) or 0,
            "kappa": bool(t.get("kappaRequired")),
            "lightkeeper": bool(t.get("lightkeeperRequired")),
            "restartable": bool(t.get("restartable")),
            "prereqs": reqs,
            "traderReqs": treqs,
            "otherReqs": other_reqs(t),
            "objectives": [slim_objective(o, nameof) for o in (t.get("objectives") or [])],
            "failConditions": [slim_objective(o, nameof) for o in (t.get("failConditions") or [])],
            "rewards": slim_reward(t.get("finishRewards") or {}, nameof, ach_name, cust_name),
            "startRewards": slim_reward(t.get("startRewards") or {}, nameof, ach_name, cust_name),
            "fail": slim_reward(t.get("failureOutcome") or {}, nameof, ach_name, cust_name),
            "keys": sorted({
                nameof("item", k)
                for entry in (t.get("neededKeys") or [])
                for k in (entry.get("keys") or [])
            }),
            "delay": max(num(t.get("availableDelaySecondsMin")) or 0,
                         num(t.get("availableDelaySecondsMax")) or 0),
        })

    records.sort(key=lambda r: (TRADER_ORDER.index(r["trader"]) if r["trader"] in TRADER_ORDER else 99,
                                r["level"], r["name"]))
    if miss:
        print("  ⚠ 译名缺失（已留空，不印 id／英文）：" + "／".join(f"{k} {v}" for k, v in sorted(miss.items())))
    payload = {
        "fetched": FETCH_DATE,
        "source": "json.tarkov.dev/regular（持久 PvP）",
        "count": len(records),
        "tasks": records,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=False),
                         encoding="utf-8")
    print(f"已写 {DATA_FILE.relative_to(ROOT)}（{DATA_FILE.stat().st_size / 1024:.0f} KB，{len(records)} 条）")
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# 页面生成
# ─────────────────────────────────────────────────────────────────────────────

TYPE_LABEL = {
    "giveItem": "交物品", "findItem": "找物品", "sellItem": "出售物品",
    "giveQuestItem": "交任务物品", "findQuestItem": "找任务物品",
    "plantItem": "放置物品", "plantQuestItem": "放置任务物品",
    "visit": "到访", "mark": "标记", "useItem": "使用物品",
    "buildWeapon": "按规格改装", "shoot": "击杀／射击", "extract": "撤离",
    "experience": "击杀（限定状态）",
    "skill": "技能等级", "traderLevel": "商人等级", "traderStanding": "商人声望",
    "taskStatus": "任务状态", "dialogue": "对话", "globalVariable": "进度计数",
}
ATTR_LABEL = {
    "ergonomics": "人机工效", "recoil": "后坐力", "accuracy": "精度",
    "effectiveDistance": "有效射程", "durability": "耐久", "weight": "重量",
    "height": "高度", "width": "宽度", "magazineCapacity": "弹匣容量",
    "muzzleVelocity": "初速",
}
REWARD_LABEL = {
    "items": "物品", "standing": "商人声望", "offerUnlock": "解锁购买",
    "traderUnlock": "解锁商人等级", "craftUnlock": "解锁制作",
    "achievement": "成就", "customization": "外观解锁",
    "dialogueUnlock": "解锁对话", "locationUnlock": "解锁地点", "skills": "技能等级奖励",
}
SHOT_TYPE = {"kill": "击杀", "hit": "命中"}
CMP = {"<=": "≤", ">=": "≥", "<": "<", ">": ">", "==": "=", "!=": "≠"}


def cmp_txt(pair) -> str:
    op, val = pair
    return CMP.get(op, op) + f" {val}"


def render_objective(o: dict, bullet: str = "-") -> str:
    ty = o["type"]
    head = TYPE_LABEL.get(ty, ty)
    bits: list[str] = []

    if o.get("single"):
        bits.append(f"**{o['single']}**")
    if o.get("items"):
        nm = "／".join(f"**{x}**" for x in o["items"][:8])
        if len(o["items"]) > 8:
            nm += f" 等 **{len(o['items'])}** 种"
        bits.insert(0, nm)
    if o.get("targets"):
        bits.append("目标：" + "／".join(o["targets"]))
    if o.get("count") and o["count"] > 1:
        bits.append(f"**×{o['count']}**")
    if o.get("fir"):
        bits.append("**必须战局内找到**")
    if o.get("minDur") or o.get("maxDur"):
        lo, hi = o.get("minDur", 0), o.get("maxDur", 100)
        bits.append(f"耐久 {lo}–{hi}")
    if o.get("dogTag"):
        bits.append(f"狗牌等级 ≥ **{o['dogTag']}**")
    if o.get("bodyParts"):
        bits.append("部位：" + "／".join(o["bodyParts"]))
    if o.get("state"):
        st = o["state"]
        seg = []
        if st.get("effects"):
            seg.append("／".join(st["effects"]) + " 状态")
        if st.get("parts"):
            seg.append("命中 " + "／".join(st["parts"]))
        if st.get("time"):
            seg.append("持续 " + cmp_txt(st["time"]) + " 秒")
        bits.append("**" + "，".join(seg) + "**")
    if o.get("dist"):
        bits.append("距离 " + cmp_txt(o["dist"]) + " m")
    if o.get("window"):
        bits.append(f"**时间窗 {o['window'][0]}–{o['window'][1]} 时**")
    if o.get("attrs"):
        bits.append("；".join(f"{ATTR_LABEL.get(k, k)} " + cmp_txt(v) for k, v in o["attrs"].items()))
    if o.get("containsAll"):
        bits.append("须含：" + "／".join(o["containsAll"]))
    if o.get("weapons"):
        bits.append("限定武器：" + "／".join(o["weapons"][:4]))
    if o.get("mods"):
        bits.append("限定配件：" + "／".join(o["mods"][:4]))
    if o.get("wearing"):
        bits.append("须穿戴：" + "／".join(o["wearing"][:4]))
    if o.get("notWearing"):
        bits.append("**不得穿戴**：" + "／".join(o["notWearing"][:4]))
    if o.get("status"):
        bits.append("状态：" + "／".join(o["status"]))
    if o.get("traders"):
        bits.append("对象：" + "／".join(o["traders"]))
    if o.get("exitStatus"):
        bits.append("撤离点状态：" + "／".join(o["exitStatus"]))
    if o.get("value") is not None:
        bits.append(f"**{cmp_txt([o.get('cmp', '>='), o['value']])}**")
    if o.get("level") is not None:
        bits.append(f"**Lv{o['level']}**")

    line = f"{bullet} **{head}** " + " ｜ ".join(bits) if bits else f"{bullet} **{head}**"
    if o.get("text"):
        line += f" —— {o['text']}"
    if o.get("keys"):
        line += "　需钥匙：" + "／".join(f"**{k}**" for k in o["keys"])
    if o.get("optional"):
        line += "　（**可选**）"
    return line


REWARD_KEYS = ("standing", "skills", "offerUnlock", "traderUnlock", "craftUnlock",
               "achievement", "customization", "dialogueUnlock", "locationUnlock")


def render_rewards(rec: dict) -> list[str]:
    r = rec["rewards"]
    if not rec["exp"] and not r.get("items") and not any(r.get(k) for k in REWARD_KEYS):
        # 端点真的什么都没登记（不是本站漏了）。直说比印一行「经验 0」清楚。
        return ["- **完成奖励**：无（数据端点未登记）"]
    base = [f"经验 **{rec['exp']:,}**"] if rec["exp"] else []
    got = [f"**{nm}** ×{cnt:,}" for nm, cnt in r.get("items", [])[:10]]
    if len(r.get("items", [])) > 10:
        got.append(f"等 **{len(r['items'])}** 种")
    head = " ｜ ".join(base + got) if (base or got) else "—（无物品或经验奖励）"
    out = [f"- **完成奖励**：{head}"]
    for nm, val in r.get("standing", []):
        out.append(f"  - 声望：**{nm}** {val:+}")
    for nm, lv in r.get("skills", []):
        out.append(f"  - 技能：**{nm}** +{lv} 级")
    for tag, label in REWARD_LABEL.items():
        if tag in ("items", "standing", "skills") or not r.get(tag):
            continue
        out.append(f"  - {label}：" + "／".join(f"**{x}**" for x in r[tag]))
    return out


def render_req_line(reqs: list[dict]) -> str:
    """「接取门槛」一整行：商人忠诚度 / 声望、对话、进度计数三类合一。"""
    segs = []
    for r in reqs:
        label = "忠诚 **LL%s**" % r["value"] if r["kind"] == "level" else \
            "声望 " + cmp_txt([r["cmp"], r["value"]])
        segs.append(f"**{r['trader']}** {label}")
    if segs:
        return "- **接取门槛**：" + " ｜ ".join(segs)
    return ""


def render_task(rec: dict, i: int) -> list[str]:
    """单个任务的明细块。

    `i` 是它在**本页**的序号（从 1 开始），用来生成锚点 `q01`，并让页首索引表
    的编号与这里的标题一一对应 —— 编号错位比没有编号更糟。标题本身由
    `task_heading` 输出成原生 HTML，原因见该函数的说明。
    """
    L: list[str] = [task_heading(i, rec["name"], rec.get("id", "")), ""]
    meta = [f"**{TRADER_LABEL.get(rec['trader'], rec['trader'])}**", f"需 **Lv{rec['level']}**"]
    meta.append(f"前置 **{len(rec['prereqs'])}** 个" if rec["prereqs"] else "**无前置**")
    if rec["en"]:
        meta.append(f"英文名 **{rec['en']}**")
    flags = []
    if rec["kappa"]:
        flags.append("**Kappa 必需**")
    if rec["lightkeeper"]:
        flags.append("**Lightkeeper 必需**")
    if rec["map"]:
        flags.append(f"地图：{rec['map']}")
    if rec["faction"]:
        flags.append(f"仅限 **{rec['faction']}**")
    if rec["prestige"]:
        flags.append(f"需**威望 P{rec['prestige']}**")
    if rec["restartable"]:
        flags.append("失败可重接")
    if rec["delay"]:
        flags.append(f"接取延迟 {rec['delay'] // 60} 分钟")
    L.append(" ｜ ".join(meta))
    # 指向「单个任务详情」视图页。
    #
    # ⚠️ 用**原生 HTML** 而不是 markdown 链接，为两条硬约束：
    #   ① markdown 链接 `[x](quest.md?id=…)` 会被 check_entries 判成断链 ——
    #      它 resolve 的是字面路径 `quest.md?id=…`，不剥 query；
    #   ② HTML 的 href **不会被 MkDocs 重写**，所以这里必须直接写**构建后**
    #      的相对路径 `../quest/`（页面在 /quests/<trader>/，目标是 /quests/quest/）。
    #      写成 `quest.md` 反而会 404 —— 这两件事别搞反。
    if rec.get("id"):
        L.append("")
        L.append(f'<a href="../quest/?id={rec["id"]}">打开完整页面 →</a>')
    if flags:
        L += ["", "`" + "` ｜ `".join(flags) + "`"]
    L.append("")

    # ── 「出发前必带」：把「要自己带东西进图」这件事从「要求」里提出来 ────────
    # 为什么必须提前、单独成块（2026-10-07 读者反馈）：
    #   「不知道这个任务是不是需要额外带钥匙或其他物品进图放置，总是到了
    #   任务地点才发现东西没带」——
    #   根因是「放置／标记／使用」这四类目标**混在**找物品、击杀、撤离之间，
    #   而且**没有任何标记说它要求你从图外带东西进来**。
    #   读者必须逐条读、并在脑子里做一次「类型 → 要不要自带」的映射；
    #   等映射做完，人已经在图里了。
    # 所以这里把 CARRIER_IDX 里的结论**原样提到任务最上方**，
    # 让「带什么」成为读这条任务时看到的第一个答案，而不是第五段。
    car = CARRIER_IDX.get(rec.get("id", ""))
    if car:
        pack, keys = car.get("pack", []), car.get("keys", [])
        if pack or keys:
            L += ["**出发前必带**", ""]
            if pack:
                names = "／".join(f"**{b['item']}**" for b in pack)
                mp = sorted({m for b in pack for m in b["maps"]})
                where = f"（地图：{'、'.join(mp)}）" if mp else ""
                L.append(f"- **物品**：{names}{where}")
            if keys:
                L.append("- **钥匙**：" + "／".join(f"**{k}**" for k in keys))
            # 局内获取的那些要显式说清：它们**也要带着**，只是不用从仓库备。
            raid = [b for b in car.get("bring", []) if b["givenInRaid"]]
            if raid:
                seen, nm = set(), []
                for b in raid:
                    if b["item"] not in seen:
                        seen.add(b["item"])
                        nm.append(f"**{b['item']}**")
                L.append("- **局内获取**（本任务里先找到、再用同一个）：" + "／".join(nm))
            L.append("")
            L.append(f"> 📐 **这一栏是「带什么」，[下面的「要求」是「做什么」** ——"
                     "两栏分开是因为它们回答的是不同的问题。"
                     f"判定口径：目标类型为 `放置 / 标记 / 使用` 的才进这一栏，"
                     f"来源 `scripts/data/quests_carrier.json`"
                     f"（由 `scripts/gen_quest_carrier.py` 生成）。")
            L.append("")

    # ── 「接取条件」与「要求」分开 ──────────────────────────────────────────
    # 前者回答「**接不接得到**」，后者回答「**要做什么**」。混在一起时，
    # 「前置任务」这类条件会掉到完成奖励后面 —— 那是读的人在盘条件时最先要找的东西。
    cond: list[str] = []
    line = render_req_line(rec["traderReqs"])
    if line:
        cond.append(line)
    for o in rec["otherReqs"]:
        if o["kind"] == "dialogue":
            cond.append("- **需先对话**：" + "／".join(f"**{x}**" for x in o["traders"]))
        else:
            cond.append(f"- **进度计数**：**{o['trader']}** {cmp_txt([o['cmp'], o['value']])}"
                        "（含义见[总览](index.md)）")
    if rec["prereqs"]:
        segs = []
        for p in rec["prereqs"]:
            s = f"**{one_line(p['name'])}**（{p['trader']}）"
            if p["status"]:
                s += p["status"]
            segs.append(s)
        cond.append("- **前置任务**：" + " ｜ ".join(segs))
    if rec["keys"]:
        cond.append("- **需要钥匙**：" + "／".join(f"**{k}**" for k in rec["keys"]))
    if cond:
        L += ["**接取条件**", "", *cond, ""]

    L += ["**要求**", ""]
    L.extend(render_objective(o) for o in rec["objectives"])
    L.append("")
    L.extend(render_rewards(rec))
    if rec["startRewards"]:
        sr = rec["startRewards"]
        bits = [f"**{nm}** ×{c:,}" for nm, c in sr.get("items", [])]
        bits += [f"解锁 **{x}**" for k in ("offerUnlock", "craftUnlock", "customization")
                 for x in sr.get(k, [])]
        if bits:
            L.append("- **接取即得**：" + " ｜ ".join(bits))

    fails: list[str] = []
    if rec["failConditions"]:
        fails.append("- **失败条件**：")
        # 端点里有把同一条失败条件列两遍的情况，渲染时会变成两行一模一样的字。
        # 去重放在渲染这一层，数据仍按原样保留。
        fails.extend("  " + x for x in uniq([render_objective(o, "-") for o in rec["failConditions"]]))
    if rec["fail"]:
        bits = [f"**{nm}** ×{c:,}" for nm, c in rec["fail"].get("items", [])]
        bits += [f"**{nm}** 声望 {v:+}" for nm, v in rec["fail"].get("standing", [])]
        if bits:
            fails.append("- **失败扣除**：" + " ｜ ".join(bits))
    if fails:
        L += ["", "**失败**", "", *fails]
    L.append("")
    return L


HEADER = [
    f"> 版本基线：{BASELINE[0]} ｜ {BASELINE[1]}｜ 数据来源：tarkov.dev（二级）",
    "> 本页数值随版本调整，引用时请附加「以当前版本为准」。",
    "",
    '<a id="top"></a>',
    "",
]
# 页脚与全站一致（`entries/index.md` 同款）。**本栏目所有页面都由本脚本生成**，
# 页眉页脚是生成器常量而不是人工维护 —— 所以不需要把 `quests/` 加进
# check-freshness 的扫描范围：那边防的是「人忘了更新」，这边没有这个入口。
FOOTER = [
    "",
    "---",
    "",
    "**最后更新**: 2026年9月<br>",
    "**贡献者**: GTX950L<br>",
    "**License**: CC BY-NC-SA 4.0",
]


# ── 等级分档：全栏目唯一口径 ────────────────────────────────────────────────
#
# 总览页的「按等级门槛」表与各商人页的分档**必须同一套档位**。两处各写一份
# `// 10` 是漂移的温床 —— 改一处漏一处，读者拿着总览页的档位来商人页找会对不上，
# 而这属于「口径不一致」类缺陷，页面本身不会有任何报错。
BAND = 10          # 每档跨度。= 总览页「Lv0–9 / Lv10–19 …」的既有口径


def band_of(lv: int) -> int:
    """等级 → 所属档位的下界。"""
    return (lv // BAND) * BAND


def band_label(lo: int) -> str:
    """档位下界 → 显示标签。**由 BAND 派生**，不写死 `+9`。"""
    return f"Lv{lo}–{lo + BAND - 1}"


def carry_over_extras() -> list[str]:
    """把旧 index.md 里 AUTO-GEN 区的内容**原样搬过来**。

    本栏目是「**整栏重建**」（`write_index` 直接覆盖 index.md），但页面里有几块是
    **别的脚本**生成的（`gen_quest_items.py` 的速查区、`gen_quest_insights.py` 的
    优先级速查）。重建时不搬它们，那些内容会**静默消失**——重跑一次就没了，
    而且没有任何报错。

    ⚠️ **凡新增一个由别的脚本写入本页的 AUTO-GEN 区块，都要加进这个名单。**
    """
    p = OUT_DIR / "index.md"
    text = p.read_text(encoding="utf-8") if p.exists() else ""

    def grab(start: str, end: str) -> list[str]:
        if start in text and end in text:
            body = text.split(start, 1)[1].split(end, 1)[0]
            return [start, *body.splitlines(), end]
        return [start, "", end]

    blocks: list[str] = []
    blocks += grab(EXTRAS_START, EXTRAS_END)
    blocks += ["", "---", ""]
    blocks += grab(INSIGHTS_START, INSIGHTS_END)
    return blocks


def write_index(tasks: list[dict]) -> None:
    n = len(tasks)
    levels = [t["level"] for t in tasks]
    band = Counter(band_of(lv) for lv in levels)
    obj_n = sum(len(t["objectives"]) for t in tasks)
    fir = sum(1 for t in tasks for o in t["objectives"] if o.get("fir"))
    kappa = sum(1 for t in tasks if t["kappa"])
    lk = sum(1 for t in tasks if t["lightkeeper"])
    keys_n = sum(1 for t in tasks if t["keys"] or any(o.get("keys") for o in t["objectives"]))
    fail_n = sum(1 for t in tasks if t["failConditions"])
    gate_n = sum(1 for t in tasks if t["traderReqs"])
    cnt_n = sum(1 for t in tasks if any(o["kind"] == "counter" for o in t["otherReqs"]))
    fac_n = sum(1 for t in tasks if t["faction"])
    pre_n = sum(1 for t in tasks if t["prestige"])
    maps_n = sum(1 for t in tasks if t["map"])
    fir_o = sum(1 for t in tasks for o in t["objectives"] if o.get("maps"))

    L: list[str] = [
        "---", "tags:", "  - 索引", "---", "",
        "# 任务图鉴 (Quest Catalog)", "",
        *HEADER,
        "## 📸 数据口径", "",
        "| 项目 | 说明 |", "|------|------|",
        f"| **覆盖范围** | 持久 PvP 档案下的**全部 {n} 个任务**，逐一列出要求、完成奖励、接取门槛、"
        f"前置任务、钥匙与失败条件；共 **{obj_n}** 条任务目标 |",
        f"| **数据来源** | `json.tarkov.dev/regular`（**二级来源**），抓取时间 **{FETCH_DATE}** |",
        "| **模式口径** | 全站默认 **持久 PvP**；赛季与 PvE 的差异**未**在本栏目逐条标注 |",
        # ⚠️ 这一行与下面「怎么用」的 ⑤⑥ 都是**生成器里的常量**，不是手工维护的。
        # 2026-10-07 教训：上一批把它们直接写进 content/quests/index.md，
        # 而**整页由本脚本生成** —— 一跑生成器就整行消失（check_promises 的
        # B12 断言当场报警，是它先发现的）。**凡是生成器负责的页面，
        # 手改正文等于给自己埋一颗定时炸弹。**
        "| **不在本栏目内** | ① **限时与活动任务**——随版本挂载、版本结束即消失的那类"
        "（如 1.1.5.0 灯塔重做附带的 10 条活动任务链）。`regular` 端点**按定义不收录它们**，"
        f"所以它们不在这 {n} 条里，**这是口径不是漏抓**，见[补遗页](event-quests.md)；"
        "② **物品侧的「要不要留」**——本栏目是任务视角，"
        "手上拿着一个物品想反查它被哪些任务要，走[物品反查](item-lookup.md) |",
        "| **不收录什么** | ① **坐标与点位数值**——数据里含真实 x/y/z 的字段（目标的 `zones`、"
        "找任务物品的 `possibleLocations`）**已在抓取阶段整体剔除**；"
        "② 本站自己编写的**走位路线与执行顺序**。本栏目只把官方任务定义里的**结构化字段**译成中文表格"
        "（含其自带的方位描述），不写攻略 |",
        f"| **怎么用** | ① **按条件筛** → 见下方「按条件筛任务」，"
        f"可按商人 / 地图 / 等级 / 条件筛，也能按**解锁收益**排序；"
        f"② **知道任务名** → 右上角搜索，**中文名与英文名都能搜**"
        f"（英文名随每个任务列出，排在商人／等级之后）；③ **看某个商人给什么** → 从下方按商人进页；"
        f"④ **按地图或标记找** → 见下方「速查」一节；"
        f"⑤ **找限时／活动任务** → 走[补遗页](event-quests.md)；"
        f"⑥ **手上有个物品想知道要不要留** → 走[物品反查](item-lookup.md)；"
        f"另有 **{maps_n}** 个任务在定义里带地图归属，"
        f"可用「地图」二字在站内检索 |",
        "",
        "---", "",
        "## 🧰 按条件筛任务",
        "",
        "515 个任务按**商人 / 地图 / 等级门槛 / 条件**（需钥匙、有失败条件、Kappa 线……）筛，"
        "并按**解锁收益**排序 —— 「做完它一次放开多少后续任务」是本栏目自己算的，"
        f"口径见下方「优先级速查」。**「解锁」不等于「可接」**：本表回答「有哪些任务」，"
        "「我能不能接」见[我的进度](progress.md)。",
        "",
        '<div id="tk-quest-filter">任务筛选器需要 JavaScript —— 本页其余内容'
        "（分段统计、速查、优先级速查）与各商人页不受影响，纯文本也能读完。</div>",
        "",
        "---", "",
        "## 💡 怎么读这些字段", "",
        "本栏目把数据端点里的**结构化字段**直译成中文。不看字段名会漏掉一半信息，"
        "十条最要紧的判读如下：", "",
        "| 字段 | 含义 | 为什么要看 |",
        "|------|------|-----------|",
        "| **必须战局内找到** | 该物品要求 `foundInRaid` | **最容易踩的坑**——跳蚤市场买的不算数，"
        "只能自己带出来 |",
        "| **需要钥匙** | 逐目标或整任务列出 | 没带钥匙等于白跑一趟；"
        "有的只在**可选**目标上要求，别为它专门占一个槽位 |",
        "| **时间窗** | 如 22–6 时 | 击杀类目标常限定游戏内时段；**出发前先看钟** |",
        "| **距离 ≥ / ≤** | 击杀距离阈值 | 阈值是**下限**时，打近了不算 |",
        "| **部位** | 头部／胸部等 | 与「击杀」「命中」类目标绑定，只算指定部位 |",
        "| **耐久区间** | 交物品的 `minDurability`／`maxDurability` | "
        "**修过的装备可能反而不合格**——区间上限低于 100 时，耐久太满也会被拒 |",
        "| **狗牌等级** | `dogTagLevel` | 上交狗牌的任务按击杀者等级筛选，**低等级狗牌不收** |",
        "| **前置的状态** | `complete`／`active`／`failed` | 前置**不都是「完成」**——"
        "数据里有只要求「进行中」的，也有**完成或失败皆可**的，本栏目逐条标出 |",
        "| **接取门槛** | 商人的**忠诚等级**与**声望** | 与前置任务是两回事："
        "前置做完了，忠诚度不够照样接不到。声望门槛可以是**负数** |",
        "| **进度计数** | 形如「**Mechanic** ≥ 3」 | 任务定义里的**商人内部计数器**——"
        f"全站 **{cnt_n}** 个任务带这一条。端点是每个商人一个计数器、"
        "**互不跨商人**（已核对），站内按唯一归属还原成商人名；"
        "它记录**在该商人处推进到第几环**，游戏界面不显示这个数字，"
        "所以这里**只给端点原值，不代为解释** |",
        "",
        f"> 📐 **两条边界（与[引用说明第六节](../docs/citation.md) 同口径）**",
        ">",
        "> 1. **不写坐标**。带真实 x/y/z 的字段在抓取阶段整体剔除；"
        f"保留下来的只有「在哪张图」这一层（**{fir_o}** 条目标带地图归属）。"
        "「在哪张图、哪个区域」照写（那是任务定义的一部分），**坐标数值一个不给**。",
        "> 2. **不写攻略**。「先去哪、按什么顺序做、怎么走位」属作业不属知识，本栏目一概不写——"
        "[任务系统](../entries/quests.md) 讲机制与优先级，逐步流程查英文 EFT Wiki 或"
        "[中文 Wiki](https://www.eftarkov.com/)。",
        "",
        "---", "",
        "## 📊 全局统计", "",
        f"**{n} 个任务**的分布如下（口径：`{FETCH_DATE}` 抓取，持久 PvP）。", "",
        "### 按商人", "",
        "| 商人 | 任务数 | 等级跨度 | 进入 |",
        "|------|--------|----------|------|",
    ]
    for key in TRADER_ORDER:
        rows = [t for t in tasks if t["trader"] == key]
        if not rows:
            continue
        lv = [t["level"] for t in rows]
        # 「BTR 司机 19 条全部 Lv0」写成 Lv0–0 会被读成区间，直接写「全部 Lv0」
        span = f"Lv{min(lv)}" if min(lv) == max(lv) else f"Lv{min(lv)}–{max(lv)}"
        L.append(
            f"| **{TRADER_LABEL.get(key, key)}** | {len(rows)} | {span} "
            f"| [{len(rows)} 条明细]({key}.md) |"
        )
    L += [
        f"| **合计** | **{n}** | Lv{min(levels)}–{max(levels)} | — |",
        "",
        "### 按等级门槛", "",
        "| 等级段 | 任务数 |", "|--------|--------|",
    ]
    for lo in sorted(band):
        L.append(f"| {band_label(lo)} | {band[lo]} |")
    L += [
        "",
        "### 关键标记与条件", "",
        "| 项 | 任务数 |", "|----|--------|",
        f"| **Kappa 必需** | {kappa} |",
        f"| **Lightkeeper 必需** | {lk} |",
        f"| 带**接取门槛**（忠诚度／声望） | {gate_n} |",
        f"| 带**进度计数** | {cnt_n} |",
        f"| **仅限单一阵营**（BEAR 或 USEC） | {fac_n} |",
        f"| 需**威望等级** | {pre_n} |",
        f"| 定义里带**地图归属** | {maps_n} |",
        f"| 含**必须战局内找到**（FiR）的目标 | {fir} 条目标 |",
        f"| 需要钥匙（整任务或任一目标） | {keys_n} |",
        f"| 有失败条件 | {fail_n} |",
        "",
        "---", "",
        *carry_over_extras(),
        "",
        "---", "",
        "## 🧭 相关页面", "",
        "- [商人任务线图鉴](../entries/trader-questlines.md) —— **按商人看分布、等级跨度、"
        "长链与忠诚度门槛**，并给出 Kappa 的完整前置树；本栏目是它的**逐任务明细层**",
        "- [物品反查](item-lookup.md) —— **反向**的一条路：手上有个物品，想知道"
        "**要不要留**、被哪些任务要、能不能从商人换到",
        "- [限时与活动任务补遗](event-quests.md) —— **515 条之外的**那类：随版本挂载、"
        "到点即消失（如 1.1.5.0 灯塔重做附带的 10 条活动链）",
        "- [任务系统](../entries/quests.md) —— 任务的**机制**（奖励怎么发、FiR 怎么算、"
        "失败与放弃的区别）",
        "- [剧情章节与主线任务](../entries/story-chapters.md) —— 主线章节与四个结局",
        "- [地图对照速查](../docs/map-guide.md) —— 各图与任务密度的对照",
        "",
        "> 📖 **想了解每个任务的执行顺序？** 本栏目只给**定义**。逐步流程见英文 EFT Wiki —— "
        "每个任务在数据里都有对应链接，本栏目未逐条列出，以免与官方更新不同步。",
        "",
        "---", "",
        "⬆️ **[回到顶部](#top)**",
        *FOOTER,
    ]
    (OUT_DIR / "index.md").write_text("\n".join(L) + "\n", encoding="utf-8")


# ── 页首索引表 + 等级区间分组 ────────────────────────────────────────────────
#
# 为什么要有（第四十七批交互层审查实测）：
# 单个商人页最多 **89 个任务 / 27,524 字 / 移动端约 60 屏**，而右侧目录本身
# 有 **91 项、2,779 px（3.6 屏）**。读者来这里的问题是「我卡在这个任务了，
# 它要什么」，却只能靠浏览器 Ctrl+F —— 移动端连这个都没有。
#
# 索引表把 89 行压成**一屏可扫**，任务名直接跳到下方明细；等级区间分组给页面
# 一个中间层，让「先按等级缩小范围」这件事有个落点。

def anchor_of(i: int) -> str:
    """任务锚点。**用序号而不是标题自动生成的 id** —— 中文标题走主题的 slug
    规则会退化成 `_2`/`_3`（实测就是如此：既不可读、也无法在正文里引用），
    `q01` 这种由生成器自己掌握的锚点不会随 Markdown 扩展变化而漂移。"""
    return f"q{i:02d}"


def html_escape(s: str) -> str:
    """原生 HTML 里的转义必须自己做。任务名实测只有 `天降大礼 [PVP ZONE]`
    一处带方括号（在 HTML 里是安全字符），所以这三个替换是**防将来**、
    不是补现在 —— 但少了它，一个带 `<` 的任务名会直接把整页结构打破。"""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def task_heading(i: int, name: str, qid: str = "") -> str:
    """任务标题用**原生 HTML** 而不是 markdown `###` —— 这是一处必须写下来的取舍：

    1. **右侧目录从 91 项降到十来个。** `toc` 扩展只收集 Markdown 解析出来的
       标题元素；本项目**没有启用 `md_in_html`**（见 mkdocs.yml 的
       markdown_extensions），原生 HTML 块会被 stash 成占位符文本，不进
       `page.toc`。标题层级（h2 分档 → h3 任务）与视觉呈现都不变。
       ⚠️ **若将来启用 `md_in_html`，这条立即失效**，目录会涨回 91 项。
    2. **锚点由生成器自己给**（`q01`），而不是主题按中文标题生成的 `_2`/`_3`。
    3. 手动补回主题的 `¶` 永久链接 —— 否则读者会失去「复制某任务的直达链接」
       这个原有能力，属于纯粹的功能退化。

    另有一个 `data-qid`：任务的**数据端点稳定 id**（tarkov.dev 的 24 位十六进制）。
    它存在的唯一目的是给「任务进度追踪」（`javascripts/progress.js`）当存储键 ——
    页面上的 `q01` 是**本页序号**，同一个锚点在 11 个商人页里各出现一次，
    拿它当键会让「Prapor 的 q01」和「Skier 的 q01」互相覆盖。
    数据 id 不随排序、增删、改版漂移，是唯一安全的选择。
    """
    safe = html_escape(quote_cn(one_line(name)))
    a = anchor_of(i)
    qid_attr = f' data-qid="{html_escape(qid)}"' if qid else ""
    return (f'<h3 id="{a}"{qid_attr}>{safe}'
            f'<a class="headerlink" href="#{a}" title="Permanent link">&para;</a></h3>')


def link_cell(i: int, name: str) -> str:
    """索引表里的任务名。同样用**原生 HTML 锚点**而不是 markdown 链接：
    `天降大礼 [PVP ZONE]` 的方括号嵌在 markdown 链接文字里，解析结果取决于
    实现，不值得赌。HTML 形式对全部名字一视同仁。"""
    return f'<a href="#{anchor_of(i)}">{html_escape(cell(name))}</a>'


def render_index(rows: list[dict]) -> list[str]:
    """一屏扫完的任务索引。

    标记列只放**影响出发前准备**的项 —— 「必须战局内找到」漏一个是白跑一趟，
    「需自备物品」漏一个同样是白跑一趟（前者要在图里捡，后者要从仓库带），
    「Kappa / Lightkeeper」漏一个是不算两条主线。能从下方明细一眼看出来的
    （地图、门槛）另设列，不挤进标记。
    """
    L = ["| # | 任务 | 门槛 | 地图 | 标记 |",
         "|---|------|------|------|------|"]
    # 「端点重复条目」：数据源里有不同 id、但**内容完全相同**的条目。
    # 签名必须**把失败条件与奖励也算进去** —— 只比「等级/经验/目标数/前置数/钥匙」会把
    # 「几乎相同、但多一条失败条件」的条目误判成重复（实测：破镜重圆、电池换新就栽在这）。
    # 签名还必须**带上阵营** —— 否则 BEAR / USEC 的两条平行任务会被误判成重复，
    # 于是同一行上同时写着「仅 BEAR」和「端点重复条目」，**页面自相矛盾**。
    # （实测：人靠衣装 - 1 / -2、纺织业 - 1 / -2 四组八条就是这么被误标的。）
    # **不删**——数据源既然分了两条 id，游戏内可能真有两个实例；只做**标注**。
    def _sig(r: dict) -> tuple:
        return (r["name"], r["level"], r["exp"], len(r["objectives"]), len(r["prereqs"]),
                tuple(r["keys"]), len(r["failConditions"]),
                len((r.get("rewards") or {}).get("items") or []),
                len((r.get("rewards") or {}).get("standing") or []),
                r.get("faction") or "")

    sig = Counter(_sig(r) for r in rows)
    for i, rec in enumerate(rows, 1):
        flags = []
        if sig[_sig(rec)] > 1:
            flags.append("**端点重复条目**")
        if any(o.get("fir") for o in rec["objectives"]):
            flags.append("**必须战局内找到**")
        # 「需自备物品」：与 `fir` 是**两件不同的事**，不能互相替代——
        #   fir = 东西得在图里捡（跳蚤买的无效）；自备 = 东西得**从仓库带进去**。
        # 一条任务可以只有其一（「破镜重圆 - 隔离」要自备摄像头，
        # 而「半导体危机」是 fir 找显卡），也可以两者都有。
        # 漏掉这个标记的代价与漏掉 `fir` 一样：**到了地点才发现东西没带**。
        # ⚠️ `keys` 只在这一处判—— 下面不再重复判，
        # 否则同一行会出现两个「需钥匙」（第一版真这么写出来了）。
        _car = CARRIER_IDX.get(rec.get("id", ""))
        if _car and _car.get("pack"):
            flags.append("**需自备物品**")
        if rec["keys"]:
            flags.append("需钥匙")
        if rec["kappa"]:
            flags.append("**Kappa**")
        if rec["lightkeeper"]:
            flags.append("**Lightkeeper**")
        if rec["faction"]:
            flags.append(f"仅 {rec['faction']}")
        if rec["prestige"]:
            flags.append(f"威望 P{rec['prestige']}")
        if len(rec["prereqs"]) >= 3:
            flags.append(f"前置 ×{len(rec['prereqs'])}")
        if rec["restartable"]:
            flags.append("可重接")
        if rec["delay"]:
            flags.append(f"**接取延迟** {rec['delay'] // 60} 分")
        if rec["failConditions"]:
            flags.append("有失败条件")
        L.append(
            f"| {i} | {link_cell(i, rec['name'])} | Lv{rec['level']} | "
            f"{cell(rec['map']) if rec['map'] else '—'} | "
            f"{' · '.join(flags) if flags else '—'} |"
        )
    return L


def write_trader_page(key: str, rows: list[dict]) -> None:
    label = TRADER_LABEL.get(key, key)
    lv = [t["level"] for t in rows]
    los = sorted({band_of(t["level"]) for t in rows})
    L: list[str] = [
        "---", "tags:", "  - 任务", "  - 商人", "---", "",
        f"# {label} 的任务 (Quest Catalog)", "",
        *HEADER,
        "## 📸 本页概览", "",
        "| 项目 | 信息 |", "|------|------|",
        f"| **任务数** | {len(rows)} |",
        f"| **等级跨度** | Lv{min(lv)}–Lv{max(lv)} |",
        "| **排序** | 按**等级门槛升序**，同级按任务名 |",
        f"| **分档** | 每 {BAND} 级一档（{band_label(los[0])} …），"
        "与[总览](index.md)「按等级门槛」同口径 |",
        "| **收录字段** | 要求 · 完成奖励 · 接取门槛 · 前置任务 · 需要钥匙 · 失败条件 |",
        f"| **数据口径** | 官方任务数据（二级），**持久 PvP**，{FETCH_DATE} 抓取；"
        "**不含坐标**，字段判读见[任务图鉴总览](index.md) |",
        "",
        "---", "",
        f"## 🔎 任务索引 ｜ {len(rows)} 项",
        "",
        "点任务名跳到下方明细。**标记列只列影响出发前准备的项**——"
        "`必须战局内找到`（跳蚤市场买的不算数）、**`需自备物品`**（要**从仓库带进图**再放置／标记／使用，漏带＝白跑一趟）、`需钥匙`、"
        "`Kappa`／`Lightkeeper`（算不算那两条主线）、`仅 BEAR/USEC`、"
        "`威望`（需先转生）、`前置 ×N`（N ≥ 3 时才标）、`可重接`、"
        "`接取延迟`（先接上再去做别的，别白等）、`有失败条件`（动手前先读失败条件）、"
        "`端点重复条目`（数据源里有另一条同 id 不同、**内容完全相同**的记录，**不是你看错**）。",
        "",
        *render_index(rows),
        "",
        f"> 📖 本页共 {len(rows)} 个任务，按等级分 **{len(los)} 档**，"
        "档位分隔在索引表下方。要**按地图或商人横向找**，回[总览](index.md)。",
        "",
        "---", "",
    ]
    for lo in los:
        seg = [(i, r) for i, r in enumerate(rows, 1) if band_of(r["level"]) == lo]
        L += [f"## {band_label(lo)} ｜ {len(seg)} 个任务", ""]
        for i, rec in seg:
            L.extend(render_task(rec, i))
    L += [
        "---", "",
        "📖 [返回任务图鉴总览](index.md) ｜ [商人任务线图鉴](../entries/trader-questlines.md)",
        *FOOTER,
    ]
    (OUT_DIR / f"{key}.md").write_text("\n".join(L) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# 单个任务的详情页（javascripts/quest-detail.js）
#
# 与物品详情页（catalog-item-*）是同一套路：数据自包含、按 id 哈希分片，
# 前端拿到 id 就能算出该拉哪一片，**不需要索引文件**。
# ---------------------------------------------------------------------------

QUEST_DETAIL_SHARDS = 32
QUEST_JS_DIR = ROOT / "content" / "javascripts"


def quest_shard_key(qid: str) -> int:
    """任务 id → 分片号（0 ~ QUEST_DETAIL_SHARDS-1）。

    ⚠️ 与物品详情用**同一套算法**（十六进制数字之和取模）。不用 id 首字符 ——
       塔科夫 id 由同一套规则生成，物品侧实测首字符**只有 5 与 6 两种**
       （2148 / 2831 件），按它切只得到 2 片、等于没切。
    ⚠️ 前端 ``content/javascripts/quest-detail.js`` 里有一份**等价实现**，
       算法与片数必须一致，否则详情页会拉错片、静默显示「找不到这个任务」。
    """
    return sum(int(c, 16) for c in qid) % QUEST_DETAIL_SHARDS


def quest_page_markdown(total: int) -> str:
    """生成「单个任务详情」视图页的静态骨架（``content/quests/quest.md``）。"""
    out: list[str] = []
    out.append("---")
    out.append("tags:")
    out.append("  - 任务")
    out.append("  - 索引")
    out.append("---")
    out.append("")
    out.append("# 任务详情（Quest Detail）")
    out.append("")
    out.append("> 版本基线：2026 年 9 月 ｜ 1.1.5.1（第一赛季 KORD BREACH）"
               "｜ 数据来源：tarkov.dev（二级）")
    out.append("> 单个任务的完整页面。数值随版本调整，引用时请附「以当前版本为准」。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append("## 📸 本页是什么")
    out.append("")
    out.append("[任务图鉴](index.md) 的商人页是**一排任务顺着看**；这一页是"
               "**单个任务摊开看** —— 接取门槛、前置与后续、目标清单、完成奖励、"
               "出发前必带，一屏读完。")
    out.append("")
    out.append("> **这是一个视图页，不是 515 个页面。** 全站没有给每个任务各生成一个 HTML —— "
               "实测站点每页平均 146 KB，绝大部分是站点框架开销，515 页不划算且难维护。"
               "本页按地址里的任务 ID 渲染，**链接可分享、可收藏、可刷新恢复**。")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 🔎 单个任务详情")
    out.append("")
    out.append('<div id="tk-quest-page">任务详情需要 JavaScript —— 不开脚本时，请到'
               "[任务图鉴总览](index.md)或各商人页里查（那里有全量静态明细，零脚本可读）。</div>")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📐 数据口径")
    out.append("")
    out.append("| 项目 | 说明 |")
    out.append("|------|------|")
    out.append(f"| **覆盖范围** | 持久 PvP 下全部 **{total} 个任务**，"
               "与[任务图鉴](index.md)同一份数据 |")
    out.append("| **前置 / 后续** | 前置读官方任务定义；**后续是站内反向算的**"
               "（谁把本任务列为前置）。**同名任务不给链接** —— 站内有 10 个重名，"
               "硬指会指到另一个任务上而读者看不出来 |")
    out.append("| **不含什么** | ① **坐标与点位**（带真实 x/y/z 的字段在抓取阶段整体剔除）；"
               "② **走位路线与执行顺序** —— 属作业不属知识，口径同[任务图鉴总览](index.md) |")
    out.append("| **出发前必带** | 来自[物品反查](item-lookup.md)同一份携带清单；"
               "数据缺失时这一栏整体不显示，**不影响本页其余内容** |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 相关页面")
    out.append("")
    out.append("- [任务图鉴总览](index.md) — 515 个任务的分类检索入口")
    out.append("- [我的进度](progress.md) — 记录做到哪了")
    out.append("- [物品反查（要不要留）](item-lookup.md) — 某物品被哪些任务要求")
    out.append("")
    out.append("📖 [返回任务图鉴总览](index.md)")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append("**最后更新**: 2026 年 9 月 ｜ "
               "**贡献者** [GTX950L](https://github.com/GTX950L) ｜ "
               "**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def write_quest_detail(tasks: list[dict]) -> None:
    """写「单个任务详情」的分片数据，外加承载它的那一个视图页。

    **为什么要分片**：515 个任务的详情（目标 + 奖励 + 门槛 + 前置后续）合计
    约 0.4 MB。合成一个文件的话，读者点开任意一个任务都得先下整包 ——
    与全站「弱网可读」的定位相冲突。

    ⚠️ 目标与奖励文本**直接复用 ``render_objective()`` / ``render_rewards()``**，
       不在这里另写一套 —— 两处各写一遍必然漂（页面上是「交物品」，详情页里
       变成「上交物品」这种）。
    """
    # 名字 → id：前置 / 后续要能点进去。
    # ⚠️ **重名不给链接** —— 站内有 10 个重名任务（23 条记录），硬取第一个会指到
    #    另一个任务上，而读者根本看不出来（与物品侧 item_pages.json 的 dups 同一套处理）。
    id_of_name: dict[str, str] = {}
    dup: set[str] = set()
    for t in tasks:
        n = t["name"]
        if n in id_of_name:
            dup.add(n)
        id_of_name[n] = t["id"]

    # 后续任务 = 反向索引（谁把「我」列为前置）
    nxt: dict[str, set] = defaultdict(set)
    for t in tasks:
        for p in (t.get("prereqs") or []):
            if p.get("name"):
                nxt[p["name"]].add(t["name"])

    def link(name: str) -> list:
        """名字 → [名字, 可跳转的 id 或空串]。空串＝同名不给链接。"""
        if not name:
            return ["", ""]
        return [name, "" if name in dup else id_of_name.get(name, "")]

    rows: dict[int, dict] = defaultdict(dict)
    for t in tasks:
        qid = t["id"]
        car = CARRIER_IDX.get(qid) or {}
        rwobj = t.get("rewards") or {}
        # render_rewards 的第一行自带「完成奖励：」前缀，而详情页的小节标题已经是
        # 「🎁 完成奖励」—— 原样搬过去会重复一遍。**只削这一行的前缀**，
        # 其余行（声望 / 技能 / 解锁）原样保留，它们的缩进前端用来分子项。
        rwlines = [re.sub(r"^\s*-\s*\*\*完成奖励\*\*：", "- ", x).strip()
                   for x in render_rewards(t)] if (t.get("exp") or rwobj) else []
        rows[quest_shard_key(qid)][qid] = {
            "n": t["name"], "e": t.get("en") or "",
            "t": TRADER_LABEL.get(t["trader"], t["trader"]),
            "lv": t.get("level") or 0, "xp": t.get("exp") or 0,
            "m": t.get("map") or "", "f": t.get("faction") or "",
            "pr": t.get("prestige") or 0,
            "k": bool(t.get("kappa")), "lk": bool(t.get("lightkeeper")),
            "rs": bool(t.get("restartable")), "d": t.get("delay") or 0,
            "pre": [link(p.get("name", "")) for p in (t.get("prereqs") or [])],
            "nxt": [link(n) for n in sorted(nxt.get(t["name"], set()))],
            "gates": [[g.get("trader", ""), g.get("kind", ""),
                       g.get("cmp", ""), g.get("value")]
                      for g in (t.get("traderReqs") or [])],
            "oth": list(t.get("otherReqs") or []),
            # bullet=""：详情页自己排版，不要生成器再带一个列表符号
            "o": [render_objective(o, "").strip() for o in (t.get("objectives") or [])],
            "fail": list(t.get("failConditions") or []),
            "rw": rwlines,
            "keys": list(car.get("keys") or []),
            "bring": list(car.get("bring") or []),
            "pack": list(car.get("pack") or []),
        }

    QUEST_JS_DIR.mkdir(parents=True, exist_ok=True)
    # 先清旧分片：片数改过之后旧文件名不会与新的一致，不清就会残留一堆没人引用的文件
    for old in QUEST_JS_DIR.glob("quest-detail-*.js"):
        old.unlink()
    total_bytes = 0
    for k in sorted(rows):
        body = json.dumps(rows[k], ensure_ascii=False, separators=(",", ":"))
        total_bytes += len(body.encode("utf-8"))
        (QUEST_JS_DIR / f"quest-detail-{k:02d}.js").write_bytes(
            ("/* 由 scripts/gen_quests.py 生成 —— 勿手改。\n"
             f"   任务详情分片 #{k}（id 十六进制数字之和 % {QUEST_DETAIL_SHARDS} = {k}）。"
             f"数据抓取于 {payload_fetched()}。 */\n"
             "window.TARKOV_QUEST_DETAIL_ONE=" + body + ";\n").encode("utf-8"))

    md = quest_page_markdown(len(tasks))
    (OUT_DIR / "quest.md").write_bytes(
        md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    print(f"任务详情：{len(rows)} 个分片 ｜ {len(tasks)} 个任务 ｜ "
          f"合计 {total_bytes / 1024:.0f} KB（单次只下 1 片，"
          f"约 {total_bytes / max(len(rows), 1) / 1024:.0f} KB）")


def payload_fetched() -> str:
    """数据抓取日期（写进分片文件头，方便肉眼核对线上是新是旧）。"""
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8")).get("fetched") or "—"
    except Exception:
        return "—"


def generate() -> None:
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    tasks = payload["tasks"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_index(tasks)
    written = [OUT_DIR / "index.md"]
    for key in TRADER_ORDER:
        rows = [t for t in tasks if t["trader"] == key]
        if not rows:
            continue
        write_trader_page(key, rows)
        written.append(OUT_DIR / f"{key}.md")
    # 单个任务的详情页（视图页 + 分片数据）
    write_quest_detail(tasks)
    written.append(OUT_DIR / "quest.md")
    total = sum(p.stat().st_size for p in written)
    print(f"已生成 {len(written)} 个页面，共 {len(tasks)} 个任务，合计 {total / 1024:.0f} KB：")
    for p in written:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024:.0f} KB")


def main() -> int:
    ap = argparse.ArgumentParser(description="任务图鉴数据层与页面生成器")
    ap.add_argument("--fetch", action="store_true", help="先从 json.tarkov.dev 抓取并精简数据")
    args = ap.parse_args()
    if args.fetch:
        fetch()
    if not DATA_FILE.exists():
        print(f"[错误] 找不到 {DATA_FILE}，先跑一次 --fetch", file=sys.stderr)
        return 1
    generate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
