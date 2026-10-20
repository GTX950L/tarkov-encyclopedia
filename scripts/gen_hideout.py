"""藏身处数据层与页面生成器。

    python scripts/gen_hideout.py --fetch   # 抓 json.tarkov.dev 并精简，写 scripts/data/hideout.json
    python scripts/gen_hideout.py           # 读 hideout.json + recipes.json，重写页面四个 AUTO-GEN 区块

为什么要单独一个脚本（而不是并进 gen_quests.py）：
    数据源不同（这里多要 hideout / hideout_zh 两个端点）、产物不同（这里是**一个页面的多个区块**，
    不是 12 个整页）、重建时机也不同。但**译名与清洗规则一律复用 gen_quests**：
    物品名走同一套 `items_zh[<id> Name] → ShortName`，查不到就空着、绝不把十六进制 id 印进正文。

译名口径（本页最重要的一条决定）：
    模块名**以官方数据端点附带的 zh 译名为准**，与站内物品名同源同权威 ——
    这样页面、清单、进度数据里是**同一个字符串**，不存在「显示名 vs 数据名」的映射表，
    也就没有新的漂移源。旧写法（生成器 / 水收集器 / 私酒厂 …）作为**别名**并列在模块总表里，
    搜索仍能命中。见 ALIASES。

2026-10-21 的「深化」改了什么（为什么值得记住）
------------------------------------------------
1. **补上了 `bonuses`（逐级增益）**。此前本页只说得出材料的「要什么、要多久」，
   说不出「升上去能得到什么」，于是「要不要升」只能靠别的站的截图。数据端点一直在
   给这个字段，只是我们没取。现在 68 个等级的增益全部由端点生成。
2. **修好了 `--fetch` 本身**：原先写的是 `g.API + endpoint`，而 gen_quests 早就把常量
   换成了 `api_base()`（按 MODE 拼 regular / pve）。也就是说从那次重构起，
   `--fetch` 一跑就 `AttributeError` —— **离线生成正常、抓取早就死了**，
   而门禁只跑离线生成，所以没人发现。
3. **增益的两种累加语义写死在代码里**（见 BONUS_SPEC 的 `add` 与 `effective()`）：
   槽位类是「逐级新增」，其余是「本级覆盖、缺项沿用」。判据写在注释里，不是拍脑袋。

产物：
    scripts/data/hideout.json                              （精简数据，供 manifest 复用）
    content/entries/hideout-modules.md 里四个 AUTO-GEN 标记之间
        HIDEOUT-OVERVIEW  §3 满级增益总览
        HIDEOUT-DEPS      §5 依赖结构（枢纽榜 / 关键路径 / 时间账）
        HIDEOUT-LEDGER    §7 建材总账
        HIDEOUT-MATERIALS §8 逐级档案（增益 · 前置 · 材料）
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g  # noqa: E402  复用 API / HEADERS / quote_cn / one_line

ROOT = g.ROOT
DATA_FILE = ROOT / "scripts" / "data" / "hideout.json"
RECIPE_FILE = ROOT / "scripts" / "data" / "recipes.json"
PAGE = ROOT / "content" / "entries" / "hideout-modules.md"

MARKERS = {
    "overview": ("<!-- AUTO-GEN:HIDEOUT-OVERVIEW:START -->", "<!-- AUTO-GEN:HIDEOUT-OVERVIEW:END -->"),
    "deps": ("<!-- AUTO-GEN:HIDEOUT-DEPS:START -->", "<!-- AUTO-GEN:HIDEOUT-DEPS:END -->"),
    "ledger": ("<!-- AUTO-GEN:HIDEOUT-LEDGER:START -->", "<!-- AUTO-GEN:HIDEOUT-LEDGER:END -->"),
    "materials": ("<!-- AUTO-GEN:HIDEOUT-MATERIALS:START -->", "<!-- AUTO-GEN:HIDEOUT-MATERIALS:END -->"),
}

# 兼容别名：gen_progress_manifest 用 START / END 定位「逐级档案」区块做行数对账。
# 2026-10-21 拆成四个区块后，对外仍然保留这两个名字 —— 不然一个只读清单的生成器
# 会因为另一个生成器改了内部常量而崩（本次实测踩到）。
START, END = MARKERS["materials"]

# 旧写法 → 官方 zh 名。只用于「别名」一列，让读者搜旧名也能找到；
# 数据与正文一律用官方名（见模块顶部说明）。
ALIASES = {
    "generator": "生成器", "water-collector": "水收集器", "nutrition-unit": "营养单元",
    "booze-generator": "私酒厂", "scav-case": "Scav 包裹", "cultist-circle": "十字路口 / 供奉",
    "gym": "健身房", "shooting-range": "射击场", "hall-of-fame": "名人堂", "heating": "加热器",
}

# 页面 §1 的承色层归属（页面自己的分类，不是数据端点的字段）。
# 这里显式登记，是为了让生成的清单能按「层」分组 —— 与页面 §1 同源。
LAYER_OF = {
    "generator": "地基层", "solar-power": "地基层",
    "water-collector": "生存层", "nutrition-unit": "生存层", "medstation": "生存层",
    "lavatory": "生存层", "rest-space": "生存层",
    "workbench": "生产层", "intelligence-center": "生产层", "air-filtering-unit": "生产层",
    "vents": "生产层",
    "bitcoin-farm": "收益层", "booze-generator": "收益层", "scav-case": "收益层",
    "cultist-circle": "收益层", "security": "收益层",
    "gym": "成长层", "shooting-range": "成长层", "library": "成长层", "hall-of-fame": "成长层",
}
LAYER_ORDER = ["地基层", "生存层", "生产层", "收益层", "成长层"]

# 技能英文名 → 站内中文名。**必须与 content/entries/skills.md 同一套译名** ——
# 数据端点给的是 `Attention` 这样的英文键，直接印出来等于在中文句子里夹生词，
# 而且读者没法把它和技能页对上号。
SKILL_ZH = {
    "Attention": "专注", "Endurance": "耐力", "Strength": "力量", "Health": "健康",
    "Vitality": "活力", "Metabolism": "代谢", "HideoutManagement": "藏身处管理",
    "Immunity": "免疫", "StressResistance": "抗压", "Charisma": "魅力",
    "Intellect": "智力", "Memory": "记忆", "Perception": "感知",
}

# ─────────────────────────────────────────────────────────────────────────────
# 增益口径表（19 种类型 → 人话）
# ─────────────────────────────────────────────────────────────────────────────
# `add=True`  槽位类：**每一级都是净新增**。判据：发电机 2/2/2 级各 +2，游戏内
#             燃料槽是 2 → 4 → 6；矿场 10/15/25，游戏内是 10 → 25 → 50。只有累加能对上。
# `add=False` 其余类型：**本级覆盖**。判据：矿场槽位之外的项都逐级递增到一个上限
#             （供暖 0.04/0.08/0.12 = 2.4/4.8/7.2 EP/时），把它们相加会得出
#             游戏里不存在的 14.4；情报中心 2 级没列 Scav 冷却，若按「覆盖后归零」
#             解释，2 级会平白丢掉 1 级的冷却加成 —— 所以缺项一律「沿用上一级」。
BONUS_SPEC: dict[str, dict] = {
    "AdditionalSlots":        dict(kind="slot",  label="插槽",            add=True),
    "StashSize":              dict(kind="count", label="仓库容量",        unit="格"),
    "MaximumEnergyReserve":   dict(kind="count", label="能量上限储备",    unit="点"),
    "ScavCooldownTimer":      dict(kind="pct",   label="Scav 冷却"),
    "QuestMoneyReward":       dict(kind="pct",   label="任务金钱奖励"),
    "InsuranceReturnTime":    dict(kind="pct",   label="保险返还时间"),
    "RagfairCommission":      dict(kind="pct",   label="跳蚤市场手续费"),
    "FuelConsumption":        dict(kind="pct",   label="燃料消耗"),
    "RepairArmorBonus":       dict(kind="pct",   label="护甲修理效率"),
    "RepairWeaponBonus":      dict(kind="pct",   label="武器修理效率"),
    "SkillGroupLevelingBoost": dict(kind="pct",  label="技能组升级", skill=True),
    "ExperienceRate":         dict(kind="pct",   label="战局经验"),
    "DebuffEndDelay":         dict(kind="pct",   label="负面效果结束延迟"),
    # 速率类：端点给的是「每分钟」系数（能量 0.04 → 游戏中 2.4 EP/时，×60 逐点吻合）。
    # 生命回复**不换算**：端点系数与 Wiki 的 HP/时 之比约 457，两边都没解释这个数，
    # 照 ×3600 印出来会得到错一个数量级的「216 HP/时」。宁可只给系数。
    "EnergyRegeneration":     dict(kind="rate",  label="能量回复", per_hour=60, unit="EP"),
    "HydrationRegeneration":  dict(kind="rate",  label="水分回复", per_hour=60, unit="WP"),
    "HealthRegeneration":     dict(kind="rate",  label="生命回复", per_hour=None, unit="HP"),
    "UnlockArmorRepair":      dict(kind="unlock", label="解锁护甲修理"),
    "UnlockWeaponRepair":     dict(kind="unlock", label="解锁武器修理"),
    "UnlockWeaponModification": dict(kind="unlock", label="解锁武器改装"),
}

# 「数据端点说不出价值」的模块，人工补一句。**只写能确认的机制**，不替它们编数值。
VALUE_NOTE = {
    "gym": "训练位，不是产能位 —— 它对技能的作用靠你在里面做的动作结算，而不是背景系数，"
           "所以表里没有可列的被动加成（具体项目与收益以游戏内为准）。",
    "scav-case": "它的产出不是「加成」，而是**随机物品箱** —— 开出什么全看运气，没有办法写成一行数值。"
                 "前置只要情报中心 2 级，建成后是零成本收益。",
    "gear-rack": "陈列与收纳位：不给战斗数值、也不解锁配方，建它是为了仓库组织与展示。",
    "weapon-rack": "陈列与收纳位：不给战斗数值、也不解锁配方，建它是为了仓库组织与展示。",
}

# ─────────────────────────────────────────────────────────────────────────────
# 模块附加说明（人工维护，生成器原样带出）
# ─────────────────────────────────────────────────────────────────────────────
# 这些段落**不是数据表**，而是某个模块的**机制说明**，由人写、在这里固化。
#
# ⚠️ 为什么必须固化：它们原先是**直接写在页面的 AUTO-GEN 标记区里面**的 ——
#    任何人重跑本脚本都会把它们整段删掉。2026-10-11 做「生成物漂移」排查时实测到：
#    重跑一次，「献祭机制」整整 17 行消失，而**构建、四道门禁全绿**，没有任何提示。
#    内容是人的，但位置在自动区内 —— 那就只能由生成器带出。
#
# 改这段文字请改**这里**，不要改页面（改了也会被覆盖）。
STATION_NOTES: dict[str, str] = {
    "cultist-circle": """**献祭机制**：建成后往圈里放**最多 5 件物品**，按它们的**基础价值**（不是跳蚤价）求和，总额决定仪式时长与产出池：

| 献祭总额 | 时长 | 产出池 |
|----------|------|--------|
| 0 – 10,000 ₽ | 2 小时 | 基础物品 |
| 10,001 – 25,000 ₽ | 3 小时 | 基础物品 |
| 25,001 – 50,000 ₽ | 4 小时 | 基础物品 |
| 50,001 – 100,000 ₽ | 5 小时 | 中档物品 |
| 100,001 – 200,000 ₽ | 8 小时 | 中档物品 |
| 200,001 – 350,000 ₽ | 12 小时 | 中高档物品 |
| **≥ 350,001 ₽** | 14 小时 | **高价值池**：钥匙、钥匙卡、医疗物资与高级装备 |
| **≥ 400,000 ₽** | 6 或 14 小时 | 在高价值池基础上，**25% 概率**改为产出**你当前激活的任务 / 未完成藏身处模块所需的物品**；命中则只需 6 小时 |

三条读法：

- **400k 那一档是「定向补给线」**，不是赌博：那 25% 判定的是你**当下**还缺什么（它在读你的激活任务列表与未完成模块）。卡在某个任务物品上时，这是不依赖跳蚤市场与实验室的一条补给路径；
- **基础价值 ≠ 跳蚤价格**：它按「商人收购价 ÷ 该商人系数」折算，所以最划算的投法是**卖价高、跳蚤价低**的物品。另有特殊物品**神圣护身符**（Sacred Amulet）投入后可把总额提升 15%（消耗一次使用）；
- **固定配方**：社区维护着一批「首次使用必定产出特定物品」的组合，用过一次即失效、之后回到普通价值档 —— 把它当一次性福利，不要当稳定产出线。

> 📐 上表的阈值分档与 25% 概率为**官方 Wiki 与多个社区计算器的一致口径**（截至 1.1.5.1）；固定配方清单会随版本调整，出手前先核对最新计算器。""",
    "defective-wall": """**为什么把它单列**：它是全藏身处唯一一个**中间态会扣属性**的模块 —— 2 到 5 级每级都给 **燃料消耗 +5%、能量回复 −3 EP/小时、生命回复系数 −0.05、战局经验与生理技能 −3%**，
直到 **6 级才整体转正**（燃料 −20%、能量回复 +12 EP/小时、生命回复系数 0.2、经验与生理 +12%）。所以它只有两个合理状态：**不建**，或者**一口气到 6 级**；
停在 3、4 级是纯亏损 —— 而它偏偏是健身区、荣耀展柜、装备架三个成长层模块的硬前置（见 [§5](#deps)）。""",
    "hall-of-fame": """**关于「技能组升级 +0」**：端点在这一项上给的值是 0，而游戏内展柜确实会给战斗类技能加成 ——
两者的差别不是数据错了，而是**这份加成的源不在等级上**：它按展柜里陈列的狗牌等级结算。
所以本表照端点写 0，**不替它编一个百分比**；要看实际增益，进游戏看展柜界面。""",
}


def hours(sec: int) -> str:
    """施工时长：0 → 即时；否则压到「N 天 N 小时 / N 小时 / N 分钟」。"""
    if not sec:
        return "即时"
    d, rem = divmod(int(sec), 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    parts = []
    if d:
        parts.append(f"{d} 天")
    if h:
        parts.append(f"{h} 小时")
    if m and not d:
        parts.append(f"{m} 分钟")
    return " ".join(parts) or "即时"


def pct(v: float) -> str:
    """0.4 → `+40%`；-0.15 → `−15%`。用 U+2212 减号，与正文其它表一致（ASCII 减号在中文里偏窄）。"""
    n = round(v * 100, 2)
    sign = "+" if n >= 0 else "−"
    body = f"{abs(n):g}"
    return f"{sign}{body}%"


def num(v: float) -> str:
    n = round(v, 4)
    return f"{n:g}"


def rate(v: float) -> str:
    n = round(v, 3)
    return f"{n:g}"


# ─────────────────────────────────────────────────────────────────────────────
# 抓取
# ─────────────────────────────────────────────────────────────────────────────

def get_retry(endpoint: str, tries: int = 3) -> dict:
    """抓取 + 重试。json.tarkov.dev 偶发 `ConnectionReset`，一次失败不该让整轮抓取白跑。"""
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(g.api_base() + endpoint, headers=g.HEADERS)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 —— 网络层什么都可能抛，统一重试
            last = e
            print(f"  [重试 {i + 1}/{tries}] {endpoint}：{e}")
    raise SystemExit(f"[错误] 抓取 {endpoint} 失败：{last}")


def fetch() -> int:
    print("抓取中（hideout / hideout_zh / items_zh）…")
    raw = get_retry("hideout")["data"]
    hz = get_retry("hideout_zh")["data"]
    items_zh = get_retry("items_zh")["data"]

    def item_name(iid: str) -> str:
        v = items_zh.get(iid + " Name") or items_zh.get(iid + " ShortName")
        if not v:
            # 同 gen_quests 的规矩：查不到就空着，不把 id 印进中文正文
            miss["item"] += 1
            return ""
        return g.quote_cn(g.one_line(v))

    def zh(key: str) -> str:
        return g.quote_cn(g.one_line(hz.get(key, "") or ""))

    miss: dict[str, int] = {"item": 0, "station": 0, "skill": 0}
    stations = []
    for sid, s in raw.items():
        nm = s.get("name") or ""
        name = zh(nm) or s.get("normalizedName", sid)
        if not zh(nm):
            miss["station"] += 1
        levels = []
        for lv in sorted(s.get("levels") or [], key=lambda x: x.get("level") or 0):
            items = []
            for it in lv.get("itemRequirements") or []:
                n = item_name(it.get("item") or "")
                if not n:
                    continue
                items.append({
                    "name": n,
                    "count": it.get("count") or 1,
                    "fir": bool((it.get("attributes") or {}).get("foundInRaid")),
                })
            items.sort(key=lambda x: (not x["fir"], -x["count"], x["name"]))

            bonuses = []
            for b in lv.get("bonuses") or []:
                t = b.get("type") or ""
                if t not in BONUS_SPEC:
                    # 端点新增了类型而这里没登记：宁可印出类型名，也不要静默丢一条增益
                    miss["skill"] += 0
                    print(f"  [注意] 未登记的增益类型 {t}（{s.get('normalizedName')} {lv.get('level')} 级）")
                bonuses.append({
                    "type": t,
                    "value": b.get("value"),
                    "skill": b.get("skill") or "",
                    "passive": bool(b.get("passive")),
                    "production": bool(b.get("production")),
                    "slots": [item_name(x) for x in (b.get("slotItems") or []) if item_name(x)],
                })

            levels.append({
                "level": lv.get("level"),
                "time": lv.get("constructionTime") or 0,
                "desc": zh(lv.get("description") or ""),
                "stations": [{"id": r.get("station"), "level": r.get("level")}
                             for r in (lv.get("stationLevelRequirements") or [])],
                "skills": [{"name": g.quote_cn(g.one_line(str(r.get("skill") or ""))),
                            "level": r.get("level")}
                           for r in (lv.get("skillRequirements") or [])],
                "items": items,
                "bonuses": bonuses,
            })
        stations.append({
            "id": sid,
            "en": s.get("normalizedName") or sid,
            "name": name,
            "areaType": s.get("areaType"),
            "levels": levels,
        })

    # 站点名与依赖里的 station id 需要二次解析（依赖给的是 id，不是名字）
    byid = {s["id"]: s for s in stations}
    for s in stations:
        for lv in s["levels"]:
            for r in lv["stations"]:
                dep = byid.get(r.get("id"))
                r["name"] = dep["name"] if dep else ""
                r["en"] = dep["en"] if dep else ""
                r.pop("id", None)

    stations.sort(key=lambda s: s["en"])
    payload = {
        "fetched": date.today().isoformat(),
        "source": "json.tarkov.dev/regular（官方数据端点，二级）+ hideout_zh / items_zh（同一套译名）",
        "gameMode": "regular（持久 PvP）",
        "count": len(stations),
        "levelCount": sum(len(s["levels"]) for s in stations),
        "itemCount": sum(len(lv["items"]) for s in stations for lv in s["levels"]),
        "bonusCount": sum(len(lv["bonuses"]) for s in stations for lv in s["levels"]),
        "stations": stations,
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=False),
                         encoding="utf-8", newline="\n")
    print(f"已写 {DATA_FILE.relative_to(ROOT)}：{payload['count']} 个站点 / "
          f"{payload['levelCount']} 个等级 / {payload['itemCount']} 条材料 / "
          f"{payload['bonusCount']} 条增益")
    if miss["item"] or miss["station"]:
        print(f"  [注意] 译名缺失：物品 {miss['item']} 条（已跳过，不印 id）、站点 {miss['station']} 个")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# 增益的「本级生效」展开
# ─────────────────────────────────────────────────────────────────────────────

def effective(levels: list[dict]) -> list[dict]:
    """把逐级 bonuses 展开成「这一级真正生效的那一组加成」。

    返回与 levels 等长的列表，每项 `{type: {value, cum, slots, since, listed}}`。
      · `cum`    槽位类的累计值（其余类型 = value）
      · `since`  这个值是从哪一级开始生效的（缺项沿用上一级时用得上）
      · `listed` 本级是否**显式**列了这一项（决定要不要标「沿用」）
    """
    state: dict[str, dict] = {}
    out: list[dict] = []
    for lv in levels:
        listed: set[str] = set()
        for b in lv["bonuses"]:
            t = b["type"]
            spec = BONUS_SPEC.get(t)
            if not spec:
                continue
            listed.add(t)
            prev = state.get(t)
            if spec.get("add"):
                cum = (prev["cum"] if prev else 0) + (b["value"] or 0)
            else:
                cum = b["value"] or 0
            state[t] = {
                "value": b["value"] or 0,
                "cum": cum,
                "slots": b.get("slots") or (prev["slots"] if prev else []),
                "skill": b.get("skill") or (prev["skill"] if prev else ""),
                "since": lv["level"],
                "listed": True,
            }
        for t, info in state.items():
            info["listed"] = t in listed
        out.append({t: dict(v) for t, v in state.items()})
    return out


def bonus_text(t: str, info: dict, *, with_slots: bool = True) -> str:
    """一条增益的人话。

    `with_slots=False` 用于 §8 的逐级行：槽位物品名只在这一项**第一次出现**时写一遍，
    否则发电机的三级会连着重复三行「限野营燃料桶、金属燃料桶」。
    """
    spec = BONUS_SPEC.get(t, {})
    label = spec.get("label", t)
    kind = spec.get("kind", "pct")
    v = info["value"]
    if kind == "slot":
        head = f"{label} +{num(v)}（累计 {num(info['cum'])}）" if v else label
        if with_slots and info["slots"]:
            head += "，限 " + "、".join(info["slots"])
        return head
    if kind == "count":
        return f"{label} {int(round(v)):,} {spec.get('unit', '')}".strip()
    if kind == "rate":
        if spec.get("per_hour"):
            per = v * spec["per_hour"]
            sign = "+" if per >= 0 else "−"
            return f"{label} {sign}{abs(round(per, 3)):g} {spec['unit']}/小时"
        # 生命回复：只给系数，见 BONUS_SPEC 的注释
        sign = "" if v >= 0 else "−"
        return f"{label}系数 {sign}{abs(round(v, 3)):g}"
    if kind == "unlock":
        return f"{label}（功能解锁）"
    # pct
    if v == 0:
        return f"{label} +0%（端点为 0，见 §8）"
    if spec.get("skill") and info.get("skill"):
        grp = {"Physical": "生理", "Practical": "实用", "Combat": "战斗",
               "Mental": "精神", "Special": "特殊"}.get(info["skill"], info["skill"])
        return f"{label} {pct(v)}（{grp}类）"
    return f"{label} {pct(v)}"


def level_gain_line(state: dict, prev: dict, has_crafts: str) -> str:
    """§8 每个等级标题下面那一行：`**增益** ｜ … ｜ **解锁** …`"""
    parts = []
    for t, info in state.items():
        same_slots = prev.get(t, {}).get("slots") == info.get("slots")
        txt = bonus_text(t, info, with_slots=not same_slots)
        if not info["listed"]:
            # 功能解锁是「一次性门」：没列出来不是「沿用」，而是「早就开过了」
            if BONUS_SPEC.get(t, {}).get("kind") == "unlock":
                txt = f"{BONUS_SPEC[t]['label']}（已解锁）"
            else:
                txt += f"（沿用 {info['since']} 级）"
        parts.append(txt)
    seg = ["**增益** ｜ " + ("；".join(parts) if parts else "无被动加成")]
    if has_crafts:
        seg.append("**解锁** ｜ " + has_crafts)
    return " ｜ ".join(seg)


# ─────────────────────────────────────────────────────────────────────────────
# 配方（跨数据集 join）：每个设施每一级解锁多少条制作
# ─────────────────────────────────────────────────────────────────────────────

def load_crafts(stations: list[dict]) -> dict[tuple[str, int], int]:
    """`(设施英文名, 等级) → 该级解锁的配方条数`。

    配方数据来自 gen_recipes 的 `recipes.json`（同一批端点，抓取日可能不同步）。
    用 `stationId` 对，不用中文名 —— 两边译名虽有同一个来源，但**名字对不上时
    会静默给 0 条**，而 id 对不上会直接空表，更容易发现。
    """
    if not RECIPE_FILE.exists():
        print("  [注意] 没有 recipes.json，§3/§8 的「解锁配方」一列留空（不影响构建）")
        return {}
    d = json.loads(RECIPE_FILE.read_text(encoding="utf-8"))
    id2en = {s["id"]: s["en"] for s in stations}
    out: collections.Counter = collections.Counter()
    for c in d.get("crafts") or []:
        en = id2en.get(c.get("stationId") or "")
        if not en:
            continue
        out[(en, int(c.get("level") or 1))] += 1
    return dict(out)


# ─────────────────────────────────────────────────────────────────────────────
# 依赖关系（枢纽榜 / 关键路径 / 时间账）
# ─────────────────────────────────────────────────────────────────────────────

def dep_graph(stations: list[dict]) -> tuple[dict[tuple[str, int], list], dict[str, int], dict[str, set]]:
    """返回 `(节点表, 被依赖计数, 被谁依赖)`。

    节点 = `(模块英文名, 等级)`；边 = 该等级的 `stationLevelRequirements`。

    **自环不计**：发电机 2 级要求发电机 1 级，那是「升级链」，不是「别人需要我」。
    把它算进枢纽榜会让每个多级模块凭空多出 n−1 次被依赖，枢纽排名就失真了
    （发电机 19 → 17、易碎墙 8 → 3，后者从「枢纽」直接掉出前八）。
    """
    nodes: dict[tuple[str, int], list] = {}
    indeg: collections.Counter = collections.Counter()
    who: dict[str, set] = collections.defaultdict(set)
    for s in stations:
        for lv in s["levels"]:
            deps = [(r["en"], r["level"]) for r in lv["stations"] if r.get("en")]
            nodes[(s["en"], lv["level"])] = deps
            for en, _ in deps:
                if en == s["en"]:
                    continue
                indeg[en] += 1
                who[en].add(s["name"])
    return nodes, dict(indeg), {k: v for k, v in who.items()}


def critical_chain(nodes: dict[tuple[str, int], list], times: dict[tuple[str, int], int]) -> tuple[int, list]:
    """最长施工链（按施工时长加权的最长路）。

    递归 + 记忆化。前置图是 DAG（数据端点不会给出环），所以不需要拓扑排序的额外保护；
    真出现环会直接 RecursionError —— 那时该修数据，不是默默降级。
    """
    memo: dict[tuple[str, int], tuple[int, list]] = {}

    def walk(n):
        if n in memo:
            return memo[n]
        best = (0, [])
        for dp in nodes.get(n, []):
            if dp in nodes:
                v, path = walk(dp)
                if v > best[0]:
                    best = (v, path)
        memo[n] = (times.get(n, 0) + best[0], best[1] + [n])
        return memo[n]

    return max((walk(n) for n in nodes), key=lambda x: x[0])


# ─────────────────────────────────────────────────────────────────────────────
# 渲染
# ─────────────────────────────────────────────────────────────────────────────

def render_overview(stations: list[dict], d: dict, crafts: dict) -> list[str]:
    L = [
        f"### 3. 满级增益总览（{d['count']} 个模块 ｜ {d['levelCount']} 个等级）",
        "",
        f"> **口径**：{d['fetched']} 抓取 ｜ {d['gameMode']} ｜ 来源：`json.tarkov.dev` 的 `hideout` 端点（**二级**）。",
        "> **「满级增益」= 升到顶之后真正生效的那一组加成**，不是把各级相加 —— 累加规则见 [§4](#units)。",
        "> **「被依赖」**：有多少个「模块-等级」把它写进前置条件。数越大越绕不开，是判断「能不能跳过」的硬指标。",
        "> **「配方」**：该模块各级累计解锁的制作条数（与[配方速查](../docs/recipes.md)同一份端点）。",
        "",
        "| 模块 | 级数 | 满级增益 | 累计施工 | 建材条目（战局中） | 被依赖 | 配方 |",
        "|------|------|----------|----------|--------------------|--------|------|",
    ]
    nodes, indeg, _ = dep_graph(stations)
    for s in stations:
        eff = effective(s["levels"])
        top = eff[-1] if eff else {}
        gains = "；".join(bonus_text(t, i) for t, i in top.items()) or "—（无被动加成）"
        hrs = sum(lv["time"] for lv in s["levels"])
        rows = sum(len(lv["items"]) for lv in s["levels"])
        fir = sum(1 for lv in s["levels"] for it in lv["items"] if it["fir"])
        c = sum(v for (en, _), v in crafts.items() if en == s["en"])
        L.append(f"| **{s['name']}** | {len(s['levels'])} | {gains} | {hours(hrs)} | "
                 f"{rows}（战局 {fir}） | {indeg.get(s['en'], 0)} | {c or '—'} |")
    L.append("")
    return L


def render_deps(stations: list[dict], d: dict) -> list[str]:
    nodes, indeg, who = dep_graph(stations)
    times = {(s["en"], lv["level"]): lv["time"] for s in stations for lv in s["levels"]}
    names = {s["en"]: s["name"] for s in stations}

    n_edges = sum(1 for s in stations for lv in s["levels"] for r in lv["stations"] if r.get("en"))
    L = [f"### 5. 依赖结构：{n_edges} 条前置边，谁卡着谁", ""]
    L += [
        "> **口径**：前置关系取自数据端点的 `stationLevelRequirements`（二级）。"
        "它只写「要哪一级」，不写「为什么」—— 所以下面两榜是**算出来的**，不是经验说法。",
        "> **自环不计入「被依赖」**：发电机 2 级要求发电机 1 级，那是升级链，不是「别人需要我」。",
        "",
        "**枢纽榜：被依赖最多的 10 个模块**",
        "",
        "| 模块 | 被依赖（等级数） | 涉及模块 | 具体是谁 |",
        "|------|------------------|----------|----------|",
    ]
    for en, n in sorted(indeg.items(), key=lambda x: (-x[1], x[0]))[:10]:
        L.append(f"| **{names.get(en, en)}** | {n} | {len(who[en])} 个 | {'、'.join(sorted(who[en]))} |")
    L.append("")

    total = critical_chain(nodes, times)
    chain = total[1]
    L += [
        "**最长施工链（关键路径）**",
        "",
        "> 在 68 个等级上按「前置先生效」求最长的施工时长链。**它是满级的时间下限**："
        "并行堆料能压缩别的，但压不动这条链。",        "",
        "| # | 等级 | 本级施工 | 累计 |",
        "|---|------|----------|------|",
    ]
    acc = 0
    for i, (en, lv) in enumerate(chain, 1):
        acc += times[(en, lv)]
        L.append(f"| {i} | {names.get(en, en)} {lv} 级 | {hours(times[(en, lv)])} | {hours(acc)} |")
    L.append(f"| **合计** | {len(chain)} 段 | — | **{hours(acc)}** |")
    L.append("")

    all_time = sum(times.values())
    L += [
        "**时间账**",
        "",
        "| 项 | 数值 | 怎么读 |",
        "|----|------|--------|",
        f"| 全部 {d['levelCount']} 个等级施工合计 | **{hours(all_time)}** | 逐级相加，不考虑并行 |",
        f"| 最长单链 | **{hours(acc)}** | 时间下限，再快也快不过它 |",
        f"| 链条之外可并行 | **{hours(all_time - acc)}**（{(all_time - acc) / all_time * 100:.0f}%） | 燃料、材料、槽位跟得上就能重叠 |",
        "",
        "> 这张账的意思是：**藏身处的工期不是「总时长」，而是「关键路径」**。"
        f"读者抱怨「升了半个月还没满级」，多半是把 {hours(all_time)} 当成了串行任务；"
        "真正串行不起的只有上面那条链，其余都是排队等材料。",
        "",
    ]
    return L


def render_ledger(stations: list[dict], d: dict) -> list[str]:
    tot: collections.Counter = collections.Counter()
    fir_cnt: collections.Counter = collections.Counter()
    seen: collections.defaultdict[str, set] = collections.defaultdict(set)
    money = {"卢布", "美元", "欧元"}
    for s in stations:
        for lv in s["levels"]:
            for it in lv["items"]:
                tot[it["name"]] += it["count"]
                seen[it["name"]].add(s["name"])
                if it["fir"]:
                    fir_cnt[it["name"]] += 1

    def kind(n):
        if fir_cnt[n] and fir_cnt[n] >= sum(1 for s in stations for lv in s["levels"]
                                            for it in lv["items"] if it["name"] == n):
            return 0, "**仅战局中**"
        if fir_cnt[n]:
            return 1, "两者都有"
        return 2, "可采购"

    L = [f"### 7. 建材总账：{len(tot)} 种，按需备料", ""]
    L += [
        f"> **口径**：{d['fetched']} 抓取 ｜ 全部 {d['count']} 个模块、{d['levelCount']} 个等级的材料**去重合并**。"
        "「分布」= 这件东西被几个模块需要 —— 数大的是**常备件**，数小的是**专项件**，别为一两件开一整条采购线。",
        "> 「仅战局中」= 这门材料出现的每一处都要求自带（跳蚤买的**不算数**）；「两者都有」= 有的等级认跳蚤货、有的不认。",
        "",
    ]
    cur = [n for n in tot if n in money]
    if cur:
        L += ["**货币**", "", "| 货币 | 总需求 | 分布 |", "|------|--------|------|"]
        for n in sorted(cur, key=lambda x: -tot[x]):
            L.append(f"| {n} | {tot[n]:,} | {len(seen[n])} 个模块 |")
        L.append("")

    items = [n for n in tot if n not in money]
    L += [f"**物品（{len(items)} 种）**", "", "| 物品 | 总需求 | 分布 | 获取 |", "|------|--------|------|------|"]
    for n in sorted(items, key=lambda x: (*kind(x), -tot[x], x)):
        L.append(f"| {n} | {tot[n]:,} | {len(seen[n])} 个模块 | {kind(n)[1]} |")
    L.append("")

    only_fir = [n for n in items if kind(n)[0] == 0]
    L += [
        f"> **一句话结论**：{len(items)} 种物品里，**{len(only_fir)} 种只能在战局里拿**；"
        "剩下的是「有钱就能解决」的部分。反过来说 —— **卡进度的从来不是钱，是那几十种战局中材料**。",
        "",
    ]
    return L


def render_module_table(stations: list[dict]) -> list[str]:
    L = ["| 模块 | 英文名 | 级数 | 层 | 曾用写法 |", "|------|--------|------|----|----------|"]
    for s in stations:
        alias = ALIASES.get(s["en"], "—")
        L.append(f"| **{s['name']}** | `{s['en']}` | {len(s['levels'])} 级 | "
                 f"{LAYER_OF.get(s['en'], '—')} | {alias} |")
    return L


def render_station(s: dict, crafts: dict, indeg: dict) -> list[str]:
    eff = effective(s["levels"])
    L = [f"**{s['name']}**（`{s['en']}`）", ""]
    cum_crafts = 0
    for i, lv in enumerate(s["levels"]):
        head = [f"**{lv['level']} 级**", f"施工 **{hours(lv['time'])}**"]
        if lv["stations"]:
            head.append("前置 " + "、".join(
                f"{r['name']} {r['level']} 级" for r in lv["stations"] if r.get("name")))
        if lv["skills"]:
            head.append("技能 " + "、".join(
                f"{SKILL_ZH.get(r['name'], r['name'])} {r['level']} 级"
                for r in lv["skills"] if r.get("name")))

        n_craft = crafts.get((s["en"], lv["level"]), 0)
        cum_crafts += n_craft
        craft_txt = ""
        if n_craft:
            craft_txt = f"{n_craft} 条配方（累计 {cum_crafts}）"

        L.append(" ｜ ".join(head))
        L.append("")
        L.append(level_gain_line(eff[i], eff[i - 1] if i else {}, craft_txt))
        L.append("")
        if lv["items"]:
            L.append("| 材料 | 数量 | 来源 |")
            L.append("|------|------|------|")
            for it in lv["items"]:
                L.append(f"| {it['name']} | ×{it['count']:,} | {'**战局中**' if it['fir'] else '可采购'} |")
        else:
            L.append("_该等级无材料要求。_")
        L.append("")

    # 没有被动增益的模块，读者最想问的是「那它图什么」。
    # 回答的优先级：① 人工写好的价值说明 → ② 被依赖数（开路）→ ③ 老实说「本页不替它编价值」。
    # 为什么不给第三种情况编一句漂亮话：健身区、Scav宝箱这类模块的价值**不在数据端点的字段里**
    # （一个是主动锻炼、一个是随机产出），硬套「纯存放位」会把它们说错 —— 2026-10-21 实测踩到。
    if not any(BONUS_SPEC.get(t, {}).get("kind") != "unlock" for lv in eff for t in lv):
        note = VALUE_NOTE.get(s["en"])
        if note:
            L.append(f"> **它图什么**：{note}")
            L.append("")
        elif not any(crafts.get((s["en"], lv["level"])) for lv in s["levels"]):
            n = indeg.get(s["en"], 0)
            if n:
                L.append(f"> **它图什么**：没有被动加成，但 **{n} 个等级把它写进前置** —— 它的价值是「开路」，不是「产出」。")
            else:
                L.append("> **它图什么**：没有被动加成、也不解锁配方 —— 数据端点能说的就这些，多一个字都要靠猜。")
            L.append("")

    note = STATION_NOTES.get(s["en"])
    if note:
        L.append(note)
        L.append("")
    return L


def render_materials(stations: list[dict], d: dict, crafts: dict) -> list[str]:
    _, indeg, _ = dep_graph(stations)
    out = [
        f"### 8. 逐级档案：增益 · 前置 · 材料（{d['count']} 个模块 ｜ {d['levelCount']} 个等级）",
        "",
        f"> **口径**：{d['fetched']} 抓取 ｜ {d['gameMode']} ｜ 来源：`json.tarkov.dev`（官方数据端点，二级）+ `hideout_zh` / `items_zh`（同一套译名）",
        "> 「**战局中**」= 该材料必须由自己带出（跳蚤市场买的**不算数**）；「可采购」= 跳蚤市场买即可。",
        "> 「**增益**」是该级**真正生效**的那一组（累加规则见 [§4](#units)）；**标「沿用」的项表示本级没有新增、继承上一级的值**。",
        "",
        "**模块总表**",
        "",
        *render_module_table(stations),
        "",
        "---",
        "",
    ]

    by_layer: dict[str, list[dict]] = {}
    groups: list[str] = []
    for s in stations:
        key = LAYER_OF.get(s["en"], "（页面未分层）")
        if key not in by_layer:
            by_layer[key] = []
            groups.append(key)
        by_layer[key].append(s)
    order = LAYER_ORDER + ["（页面未分层）"]
    groups.sort(key=lambda x: order.index(x) if x in order else 99)

    for layer in groups:
        out += [f"**{layer}**", ""]
        for s in by_layer[layer]:
            out += render_station(s, crafts, indeg)
        out += ["---", ""]

    out += [
        "> **关于本节的来源等级**：材料、施工时长、增益三者**同源**（官方数据端点，二级），"
        "所以它们的版本口径一致 —— 不会再出现「材料是新的、加成是旧的」。"
        "与英文 EFT Wiki 的差异见 [§4](#units)。",
        "",
    ]
    return out


def replace_block(text: str, key: str, body: list[str]) -> str:
    start, end = MARKERS[key]
    if start not in text or end not in text:
        raise SystemExit(f"[错误] 页面里找不到 {key} 的 AUTO-GEN 标记：\n{start}\n{end}")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    block = "\n".join(body).rstrip() + "\n"
    return f"{head}{start}\n\n{block}\n{end}{tail}"


def generate() -> int:
    if not DATA_FILE.exists():
        print(f"[错误] 找不到 {DATA_FILE}，先跑一次 --fetch", file=sys.stderr)
        return 1
    d = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    stations = d.get("stations") or []
    if not stations:
        print("[错误] hideout.json 里没有 stations", file=sys.stderr)
        return 1
    if not any(lv.get("bonuses") for s in stations for lv in s["levels"]):
        print("[错误] hideout.json 是旧格式（没有 bonuses）—— 重跑一次 "
              "`python scripts/gen_hideout.py --fetch`", file=sys.stderr)
        return 1

    crafts = load_crafts(stations)
    text = PAGE.read_text(encoding="utf-8")
    text = replace_block(text, "overview", render_overview(stations, d, crafts))
    text = replace_block(text, "deps", render_deps(stations, d))
    text = replace_block(text, "ledger", render_ledger(stations, d))
    text = replace_block(text, "materials", render_materials(stations, d, crafts))
    PAGE.write_text(text, encoding="utf-8")

    print(f"已写入 {PAGE.relative_to(ROOT)}：{len(stations)} 个模块 / "
          f"{d['levelCount']} 个等级 / {d['itemCount']} 条材料 / "
          f"{d.get('bonusCount', 0)} 条增益 / {sum(crafts.values())} 条配方")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="藏身处数据层与页面生成器")
    ap.add_argument("--fetch", action="store_true", help="先从 json.tarkov.dev 抓取并精简数据")
    a = ap.parse_args()
    return fetch() if a.fetch else generate()


if __name__ == "__main__":
    raise SystemExit(main())
