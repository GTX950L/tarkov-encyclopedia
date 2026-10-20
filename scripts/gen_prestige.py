"""转生（Prestige）逐档门槛与奖励生成器。

    python scripts/gen_prestige.py --fetch   # 抓 regular / pve 两个端点的 prestige，写 scripts/data/prestige.json
    python scripts/gen_prestige.py           # 读 prestige.json，重写 prestige.md 的两个 AUTO-GEN 区块

为什么值得单独一支脚本
----------------------
转生页此前把门槛表**整个抄自英文 EFT Wiki**，而 Wiki 是人工维护的二级来源 ——
1.2.0.0 之后它既不完整（PvE 逐档门槛标为「官方未公布」= 引用说明的 B5 未决项），
也和游戏文件对不上（Wiki 把 Tour / Falling Skies / The Ticket 写成门槛，端点里没有这回事）。

而 `json.tarkov.dev/<mode>/tasks` 的 `data.prestige` **一直带着完整的转生定义**：
每档的 `conditions`（等级 / 任务 / 藏身处 / 技能 / 持有物品）与 `rewards`（逐档奖励物品）。
`regular` 与 `pve` **各有一套**，且**门槛不同** —— 这正是「PvE 第一档比 PvP 宽松」那句官方声明的数值版。

译名口径
--------
任务名取 `quests.json` / `quests_pve.json`（gen_quests 的产物），藏身处名取 `hideout.json`
（gen_hideout 的产物），物品名取 `items_zh`，技能名复用 `gen_hideout.SKILL_ZH` ——
**全站同一套译名**，不在这里另建一套。

产物
----
    scripts/data/prestige.json                              （两个模式的精简数据）
    content/entries/prestige.md 里两个 AUTO-GEN 标记之间
        HIDEOUT 无关：PRESTIGE-CONDITIONS（PvP / PvE 两张逐档门槛表）
                      PRESTIGE-REWARDS    （逐档奖励对照）
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g  # noqa: E402  复用 HEADERS / quote_cn / one_line
import gen_hideout as gh  # noqa: E402  复用 SKILL_ZH（全站同一套技能译名）

ROOT = g.ROOT
DATA_FILE = ROOT / "scripts" / "data" / "prestige.json"
PAGE = ROOT / "content" / "entries" / "prestige.md"

MARKERS = {
    "conditions": ("<!-- AUTO-GEN:PRESTIGE-CONDITIONS:START -->",
                   "<!-- AUTO-GEN:PRESTIGE-CONDITIONS:END -->"),
    "rewards": ("<!-- AUTO-GEN:PRESTIGE-REWARDS:START -->",
                "<!-- AUTO-GEN:PRESTIGE-REWARDS:END -->"),
}

MODE_LABEL = {"pvp": "PvP（持久档案）", "pve": "PvE（永不 wipe）"}
ENDPOINT = {"pvp": "regular", "pve": "pve"}


def get_retry(url: str, tries: int = 3) -> dict:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=g.HEADERS)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  [重试 {i + 1}/{tries}] {url}：{e}")
    raise SystemExit(f"[错误] 抓取 {url} 失败：{last}")


# ─────────────────────────────────────────────────────────────────────────────
# 抓取
# ─────────────────────────────────────────────────────────────────────────────

def fetch() -> int:
    print("抓取中（regular / pve 的 tasks → prestige）…")
    # 名字表：都取站内既有产物，保证与页面、图鉴、藏身处是同一套译名
    task_names = {}
    for mode, fn in (("pvp", "quests.json"), ("pve", "quests_pve.json")):
        p = ROOT / "scripts" / "data" / fn
        if p.exists():
            task_names[mode] = {t["id"]: t["name"] for t in json.loads(p.read_text(encoding="utf-8"))["tasks"]}
        else:
            task_names[mode] = {}
            print(f"  [注意] 缺 {fn}，{mode} 的任务名会退化成 id（先跑 gen_quests.py --fetch）")

    hide = json.loads((ROOT / "scripts" / "data" / "hideout.json").read_text(encoding="utf-8"))
    station_names = {s["id"]: s["name"] for s in hide["stations"]}

    # 物品译名取 regular 那一份即可：两个模式的物品名是同一套（游戏内同一份本地化）
    items_zh = get_retry("https://json.tarkov.dev/regular/items_zh")["data"]

    def item_name(iid: str) -> str:
        v = items_zh.get(iid + " Name") or items_zh.get(iid + " ShortName")
        return g.quote_cn(g.one_line(v)) if v else ""

    out = {
        "fetched": date.today().isoformat(),
        "source": "json.tarkov.dev/<mode>/tasks 的 data.prestige（官方数据端点，二级）",
        "modes": {},
    }
    for mode, ep in ENDPOINT.items():
        raw = get_retry(f"https://json.tarkov.dev/{ep}/tasks")["data"]
        levels = []
        for p in raw.get("prestige") or []:
            conds = []
            for c in p.get("conditions") or []:
                t = c.get("type") or ""
                row = {"type": t, "optional": bool(c.get("optional"))}
                if t == "playerLevel":
                    row["level"] = c.get("playerLevel")
                elif t == "taskStatus":
                    tid = c.get("task") or ""
                    row["task"] = task_names[mode].get(tid) or tid
                    row["status"] = c.get("status") or []
                elif t == "hideoutStation":
                    sid = c.get("station") or ""
                    row["station"] = station_names.get(sid) or sid
                    row["stationLevel"] = c.get("stationLevel")
                elif t == "skill":
                    row["skill"] = c.get("skill") or ""
                    row["skillLevel"] = c.get("level")
                elif t == "haveItem":
                    row["items"] = [item_name(x) for x in (c.get("items") or []) if item_name(x)]
                    row["count"] = c.get("count")
                conds.append(row)
            rewards = []
            for it in (p.get("rewards") or {}).get("items") or []:
                nm = item_name(it.get("item") or "")
                if nm:
                    rewards.append({"name": nm, "count": it.get("count") or 1})
            levels.append({
                "level": p.get("prestigeLevel"),
                "conditions": conds,
                "rewards": rewards,
            })
        levels.sort(key=lambda x: x["level"] or 0)
        out["modes"][mode] = {"levelCount": len(levels), "levels": levels}
        print(f"  {mode}: {len(levels)} 档 / "
              f"{sum(len(l['conditions']) for l in levels)} 条条件 / "
              f"{sum(len(l['rewards']) for l in levels)} 件奖励")

    DATA_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"已写 {DATA_FILE.relative_to(ROOT)}")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# 渲染
# ─────────────────────────────────────────────────────────────────────────────

def money(n: int | None) -> str:
    """卢布金额：能整除万就写「万」，否则原样带千分位。

    只给 ≥1,000,000 的写「万」——转生门槛的量级都在百万以上，
    统一成「万」才好横向比（500 万 / 1000 万 / 1500 万 / 2000 万）。
    """
    if not n:
        return "—"
    if n >= 1_000_000 and n % 10_000 == 0:
        return f"**{n / 10_000:g} 万** ₽"
    return f"{n:,} ₽"


def cond_cells(level: dict) -> tuple[str, str, str, str, str]:
    """把一档的条件拆成五个固定列：等级 / 任务 / 技能 / 藏身处 / 现金。

    数据端点给的是**平铺的条件列表**，但读者是按「这一档要我干什么」来查的 ——
    所以这里按类型归位，缺的列写「—」：**列固定，档位之间才好横向比**。
    """
    lv, task, skill, station, cash = "—", [], [], [], "—"
    for c in level["conditions"]:
        t = c["type"]
        if t == "playerLevel":
            lv = f"{c.get('level')} 级"
        elif t == "taskStatus":
            task.append(f"{c.get('task')}（完成）")
        elif t == "skill":
            nm = gh.SKILL_ZH.get(c.get("skill") or "", c.get("skill") or "")
            skill.append(f"{nm} {c.get('skillLevel')}")
        elif t == "hideoutStation":
            station.append(f"{c.get('station')} {c.get('stationLevel')}")
        elif t == "haveItem":
            cash = money(c.get("count"))
    return lv, "、".join(task) or "—", "、".join(skill) or "—", "、".join(station) or "—", cash


def render_conditions(d: dict) -> list[str]:
    L = [
        "### 3. 逐档门槛：两套模式各一张表",
        "",
        f"> **口径**：{d['fetched']} 抓取 ｜ 来源：`json.tarkov.dev/<mode>/tasks` 的 `data.prestige`（官方数据端点，**二级**）",
        "> 端点给的是**平铺的条件列表**，下表按「等级 / 任务 / 技能 / 藏身处 / 现金」五列归位；某列没有要求就写「—」。",
        f"> **两套模式的门槛不是同一张表照抄的** —— PvP **{len(d['modes']['pvp']['levels'])} 档 / "
        f"{sum(len(l['conditions']) for l in d['modes']['pvp']['levels'])} 条条件**，"
        f"PvE **{len(d['modes']['pve']['levels'])} 档 / "
        f"{sum(len(l['conditions']) for l in d['modes']['pve']['levels'])} 条条件**，各自一张表。",
        "",
        f"**{MODE_LABEL['pvp']}**",
        "",
        "| 档位 | 等级 | 任务 | 技能 | 藏身处 | 现金 |",
        "|------|------|------|------|--------|------|",
    ]
    for lv in d["modes"]["pvp"]["levels"]:
        cells = cond_cells(lv)
        L.append(f"| **P{lv['level']}** | " + " | ".join(cells) + " |")
    L.append("")
    L.append(f"**{MODE_LABEL['pve']}**")
    L.append("")
    L.append("| 档位 | 等级 | 任务 | 技能 | 藏身处 | 现金 |")
    L.append("|------|------|------|------|--------|------|")
    for lv in d["modes"]["pve"]["levels"]:
        cells = cond_cells(lv)
        L.append(f"| **P{lv['level']}** | " + " | ".join(cells) + " |")
    L.append("")
    L.append("> **「现金」这一列是「持有」不是「消耗」**：端点用的条件类型是 `haveItem`（持有卢布），"
             "判定的是**转生那一刻仓库里有多少钱**。它会不会被扣走，端点不表达 —— 见 [§5](#diff) 的说明。")
    L.append("")
    return L


def render_rewards(d: dict) -> list[str]:
    L = [
        "### 6. 逐档奖励：两套模式发的东西不一样",
        "",
        f"> **口径**：同上一节（{d['fetched']} 抓取，官方数据端点，二级）。端点只列**物品类**奖励；"
        "臂章、成就、称号、任务槽、魅力 +1 这类**非物品奖励不在这个字段里**，见 [§7](#layers)。",
        "",
        "| 档位 | PvP 发放 | PvE 发放 |",
        "|------|----------|----------|",
    ]
    pvp = {lv["level"]: lv for lv in d["modes"]["pvp"]["levels"]}
    pve = {lv["level"]: lv for lv in d["modes"]["pve"]["levels"]}
    for lvl in sorted(set(pvp) | set(pve)):
        a = "、".join(f"{r['name']}" + (f" ×{r['count']}" if r["count"] > 1 else "") for r in pvp.get(lvl, {}).get("rewards", [])) or "—"
        b = "、".join(f"{r['name']}" + (f" ×{r['count']}" if r["count"] > 1 else "") for r in pve.get(lvl, {}).get("rewards", [])) or "—"
        L.append(f"| **P{lvl}** | {a} | {b} |")
    L.append("")
    L.append("> **两条能直接看出来的结论**：① 两套模式**发的是同名不同款**的奖励（PvP 的「鲨鱼」vs PvE 的「杀人鲸」，"
             "PvP 的 Gamma「路易伪登」vs PvE 的「巴伦赛加」）；② 逐档奖励里**没有一件是战力件** —— "
             "全是海报、臂带、玩偶、近战刀与安全箱皮肤。")
    L.append("")
    return L


def replace_block(text: str, key: str, body: list[str]) -> str:
    start, end = MARKERS[key]
    if start not in text or end not in text:
        raise SystemExit(f"[错误] 页面里找不到 {key} 的 AUTO-GEN 标记：\n{start}\n{end}")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    return f"{head}{start}\n\n" + "\n".join(body).rstrip() + f"\n\n{end}{tail}"


def generate() -> int:
    if not DATA_FILE.exists():
        print(f"[错误] 找不到 {DATA_FILE}，先跑一次 --fetch", file=sys.stderr)
        return 1
    d = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    if not d.get("modes"):
        print("[错误] prestige.json 是空壳，重跑 --fetch", file=sys.stderr)
        return 1
    text = PAGE.read_text(encoding="utf-8")
    text = replace_block(text, "conditions", render_conditions(d))
    text = replace_block(text, "rewards", render_rewards(d))
    PAGE.write_text(text, encoding="utf-8")
    n = sum(m["levelCount"] for m in d["modes"].values())
    print(f"已写入 {PAGE.relative_to(ROOT)}：两个模式共 {n} 档门槛与奖励")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="转生逐档门槛与奖励生成器")
    ap.add_argument("--fetch", action="store_true", help="先抓 regular / pve 两个端点")
    a = ap.parse_args()
    return fetch() if a.fetch else generate()


if __name__ == "__main__":
    raise SystemExit(main())
