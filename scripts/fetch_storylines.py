#!/usr/bin/env python3
"""抓取十章的「剧情」页，抽出写作素材：剧情简介 / 解锁条件 / 目标序列 / 分支抉择。

为什么要单独一支：**剧情任务不在任何结构化任务数据里** —— tarkov.dev 的
/regular/tasks 只有 503 条普通商人任务，`The Ticket. Kerman. "Savior"` 这类
剧情子任务一条都没有（2026-11-02 实测）。所以「章节 → 任务」的映射根本建不起来，
台词库（quest_dialogue.json）也覆盖不到这十章。唯一成体系的素材是中文 Wiki 的
「剧情」页（/storyline/<id>），每页带：第一人称剧情简介（起因）、带分支与代价的
目标序列（经过）、解锁条件（承接关系）。

本脚本只抓与解析，**不生成任何 md** —— 页面由人写，素材留档在
`scripts/data/storylines_detail.json`，页脚引用该文件与抓取日。

来源层级：中文 Wiki = 三级（玩家维基）。剧情简介与对话选项属**游戏内文本**，
但本脚本拿到的是 Wiki 转录版，故按三级归档，正文引用时须说明「经 Wiki 转录」。

用法：python scripts/fetch_storylines.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "storylines_detail.json"
BASE = "https://www.eftarkov.com/storyline/"
HEADERS = {
    "User-Agent": "tarkov-encyclopedia-refresh/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
}

# 十章在 Wiki 上的页面 id（2026-11-02 取自 /storyline 总览页的链接列表）。
# 顺序 = 站内 §2.1 表格顺序，id 是 Wiki 自己的，不是站内 key。
PAGES = [
    ("tour", "68cbd33676fe74b1e80bfd91"),                  # 塔科夫之旅 / Tour
    ("falling-skies", "68cbcdc4c964ab83cc0c928e"),         # 陨落星辰 / Falling Skies
    ("the-ticket", "68da33fe00868edcb6025ac4"),            # 门票 / The Ticket
    ("they-are-already-here", "6903d779fdfc4078740a4bd0"), # 他们已经来了
    ("batya", "68da36cf7cff54fc6109874a"),                 # Batya
    ("boreas", "69d38381cea4b428690ea1d9"),                # Boreas
    ("the-unheard", "6900927ab7d28358f80b9421"),           # 无名者
    ("accidental-witness", "69052e18e680c2d3e3034d3a"),    # 意外证人
    ("labyrinth", "68e3a35002661eb2d30ce387"),             # 探秘“迷宫”
    ("blue-fire", "68e784b7fa3f1fa3770094ba"),              # 神秘蓝焰
]

# 导航/页脚噪音：抽目标序列时要跳过
NOISE_EXACT = {
    "完成目标", "物品收集", "任务物品", "游戏物品", "在互动地图上查看位置",
    "点击地图后可缩放和拖动", "1层", "2层", "3层", "100%", "剧情状态", "未完成",
    "跳转至评论区", "目标导航", "点击目标快速跳转到对应攻略", "完成度", "解锁方式",
    "解锁条件", "前置剧情抉择", "选择", "奖励",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "ignore")


def to_lines(html: str) -> list[str]:
    txt = re.sub(r"<script[\s\S]*?</script>", "", html)
    txt = re.sub(r"<style[\s\S]*?</style>", "", txt)
    txt = re.sub(r"<[^>]+>", "\n", txt)
    txt = txt.replace("&amp;", "&").replace("&nbsp;", " ")
    return [l.strip() for l in txt.split("\n") if len(l.strip()) > 1]


def is_number(s: str) -> bool:
    return bool(re.fullmatch(r"\d{1,2}", s))


def parse(html: str) -> dict:
    title = (re.findall(r"<title>([^<]*)</title>", html) or [""])[0]
    zh = title.split(" - ")[0].strip()
    lines = to_lines(html)

    # 章节名在正文里出现两次：一次是导航面板标题，一次是正文标题。
    # 正文标题之后依次是：英文名 → 剧情简介 → 提示语 → 完成度 → 浏览数 → 解锁方式…
    hits = [i for i, l in enumerate(lines) if l == zh]
    start = hits[-1] if hits else 0
    en = lines[start + 1] if start + 1 < len(lines) else ""
    if not re.fullmatch(r"[A-Za-z0-9' .\"\-]+", en or ""):
        en = ""

    premise = ""
    for l in lines[start + 1 : start + 8]:
        # 简介有长有短（迷宫那句只有 30 字），阈值不能设太高；但要排除那句统一提示语，
        # 以及某些页面把英文名重复成一行的情况（「他们已经来了」那页就是这样）。
        if len(l) > 18 and not l.startswith("做剧情") and "录音机" not in l and l != en:
            premise = l
            break

    # 目标总数：「完成度」下一行的 "/ 20"
    targets = None
    for i, l in enumerate(lines):
        if l == "完成度":
            for cand in lines[i : i + 3]:
                m = re.fullmatch(r"/\s*(\d+)", cand)
                if m:
                    targets = int(m.group(1))
                    break
            break

    # 解锁：从「解锁条件」到「目标导航」之间
    unlock: list[str] = []
    for i, l in enumerate(lines):
        if l in ("解锁条件", "解锁方式"):
            j = i + 1
            while j < len(lines) and j < i + 40:
                s = lines[j]
                if s in ("1 种", "目标导航", "完成目标") or re.fullmatch(r"\d+ 种", s) or s.startswith("方式 "):
                    j += 1
                    continue
                if s.startswith("满足以下任一方式"):
                    j += 1
                    continue
                unlock.append(s)
                if "解锁本剧情" in s or len(unlock) >= 4:
                    break
                j += 1
            break

    # 目标序列：导航面板里「目标导航」之后、章节标题之前，按出现顺序。
    # 面板里 ≥10 的目标会多一行序号，单独剔除。
    objectives: list[str] = []
    for i, l in enumerate(lines):
        if l == "目标导航":
            for cand in lines[i + 1 : start]:
                if is_number(cand) or cand in NOISE_EXACT or cand == "/%s" % targets:
                    continue
                if len(cand) < 3:
                    continue
                objectives.append(cand)
            # 面板末尾会带上章节标题本身（Boreas / Batya），不是目标
            while objectives and objectives[-1] in (zh, en):
                objectives.pop()
            break

    # 抉择块：标题（「选择是否上交箱子」）→ 后果提示 → 各选项（选项名一行 +
    # 「对话选择：…」一行 + 经验/声望/成就若干行）。
    branches: list[dict] = []
    for i, l in enumerate(lines):
        if not l.startswith("选择") or "对话选择" in l:
            continue
        window = lines[i + 1 : i + 16]
        has_say = any(w.startswith("对话选择：") for w in window)
        has_reward = any("奖励不同" in w for w in window)
        # 两种写法：有的是「对话选择：…」，有的只写「选择…，奖励不同」+ 选项名。
        if not (has_say or has_reward):
            continue
        opt = {"choice": l, "effects_note": "", "options": []}
        cur = None
        for j, s in enumerate(window):
            if s.startswith("对话选择："):
                label = window[j - 1] if j > 0 and not window[j - 1].startswith(("选择", "对话选择")) else ""
                cur = {"label": label, "say": s.replace("对话选择：", "").strip(), "effects": []}
                opt["options"].append(cur)
            elif cur is not None and s.startswith(("经验值", "奖励", "解锁成就")) or (cur is not None and "好感" in s):
                cur["effects"].append(s)
            elif cur is None and ("影响" in s or s.startswith("请先")):
                opt["effects_note"] = s
            elif s == "目标导航":
                break
        # 另一种写法（神秘蓝焰）：没有「对话选择：」行，只有「选择…，奖励不同」+
        # 选项名 + 成就/奖励。这类块按「选项名行 + 紧随的奖励行」配对。
        if not opt["options"] and any("奖励不同" in w for w in window):
            # 选项名 = 紧跟着「奖励 / 成就」那一行的那句；单靠前缀会误收目标文本，
            # 所以用「下一行是不是代价」当判据。
            for k in range(len(window) - 1):
                nxt = window[k + 1]
                if window[k].startswith(("选择", "奖励", "解锁成就")) or "好感" in window[k]:
                    continue
                if nxt.startswith(("奖励", "解锁成就")) or "好感" in nxt:
                    opt["options"].append({"label": window[k], "say": "", "effects": [nxt]})

        sig = tuple(o["label"] for o in opt["options"])
        if opt["options"] and sig not in {tuple(o["label"] for o in b["options"]) for b in branches}:
            branches.append(opt)

    return {
        "zh": zh,
        "en": en,
        "targets": targets,
        "premise": premise,
        "unlock": unlock,
        "branches": branches,
        "objectives": objectives,
    }


def main() -> int:
    out = {"fetched": time.strftime("%Y-%m-%d"), "source": "www.eftarkov.com/storyline/（三级：玩家维基）", "chapters": {}}
    for key, pid in PAGES:
        url = BASE + pid
        try:
            html = fetch(url)
        except Exception as e:  # 网络失败要出声，不能静默产出半份数据
            print(f"[{key}] 抓取失败：{type(e).__name__}: {e}", file=sys.stderr)
            return 1
        d = parse(html)
        d["url"] = url
        out["chapters"][key] = d
        print(
            f"[{key:<22}] {d['zh']:<8} 目标={str(d['targets']):<3} "
            f"简介={len(d['premise']):<4} 目标序列={len(d['objectives']):<3} 分支块={len(d['branches'])}"
        )
        time.sleep(0.4)

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n写入 {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
