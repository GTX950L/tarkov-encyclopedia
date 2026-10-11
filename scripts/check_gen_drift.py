#!/usr/bin/env python3
"""生成物防漂移门禁：重跑全部**离线可复现**的生成器，看有没有产物与源脱节。

为什么需要它
------------
站内大量页面与数据文件是**生成物**（`scripts/gen_*.py` 的产物），它们入库。
于是有一类失败是**静默**的：

    有人改了源数据（或生成器本身）、**忘了重跑** → 仓库里留着的还是旧产物，
    而构建、四道门禁、部署全部照常通过，没有任何提示。

2026-10-11 实测（干净工作区跑一遍全部离线生成器）：**12 个文件与仓库不一致** ——
其中 9 个是页面「本站基线」被 7 个生成器硬编码成旧值（`1.1.5.1` vs 站点 `1.2.0.0`），
还有 1 处是页面里整整 17 行人工内容（「献祭机制」）会被整段抹掉。
**在那个时点，这几件事全是静默的。**

它怎么判
--------
**不清点产物清单**（那种清单自己会漂）：

  1. 按依赖顺序把 17 支离线生成器**跑两遍**（第一遍收敛、第二遍才是稳定态，见下）；
  2. 交给 `git diff --name-only` 判断「哪些文件变了」；
  3. 再按归一化过滤：**只差日期或行尾符**的不算漂移；
  4. 仍有剩下的 → 逐个打印差异 → 退出码 1。

⚠️ **行尾符交给 git 判，不自己算。** 第一版自己算字节哈希，在 Windows 上因为
   「`git checkout` 出 CRLF、生成器写 LF」把干净树报出 **46 个漂移**，而同一时刻
   `git diff` 显示「无变化」。行尾符是**版本控制的职责**（`.gitattributes` /
   `core.autocrlf`）—— 工具自己算只会算错。日期则相反：git 管不了，由本脚本归一化。

⚠️ **为什么要跑两遍**：`content/quests/index.md` 由 **3 个生成器**协作写入
   （`gen_quests` 整页重建 ＋ 两个各写一块标记区），而 `gen_quests` 的
   `carry_over_extras()` 会把**旧文件里的标记区整体搬过来** —— 于是「从任意状态
   跑一遍」可能还差一处边界空行：**跑一遍不足以收敛**。仓库里该存的是**收敛态**。

⚠️ **归一化日期**：产物里有 `generated: today()` 这类天天变的字段，不归一化会天天
   假警报 —— 而**假警报比不报更糟**（站内判据）。若哪天要连日期变化也管，那是
   「让生成器输出稳定值」的事，不要塞进这个脚本。

⚠️ **「重跑会改」不等于「有人忘了重跑」。** 人工内容写在 AUTO-GEN 标记区里、
   而生成器模板没跟上，表现出来是同一件事。两种都要人看一眼：前者该重跑，
   后者该**把内容固化进生成器模板**（`gen_hideout.py` 的 `STATION_NOTES` 就是这个来由）。
   本脚本只报告，**不自动提交、也不自动 checkout**。

副作用
------
会重跑生成器（改写产物）—— 这本来就是它的工作方式。
**不会**把任何文件自动改回去：门禁不该改工作区。

退出码：0 = 产物与生成器一致；1 = 有差异（可作 CI 门禁）。
"""

from __future__ import annotations

import argparse
import difflib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 归一化：日期一律视作同一个值（产物里的 `generated: today()` 每天都会变）
DATE_RE = re.compile(rb"\d{4}-\d{2}-\d{2}")


def _norm_bytes(b: bytes) -> bytes:
    """比对用的归一化：**先拉平行尾符，再抹掉日期**。

    ⚠️ 为什么要管行尾符：生成器一律用 `newline="\\n"` 写（LF），而 Windows 上
    `git checkout` 若开了 `core.autocrlf`，**检出来的文件是 CRLF** —— 于是本地
    干净树里「跑前 CRLF、跑后 LF」，46 个文件全部误报（2026-10-11 实测）。
    CI 跑在 Linux 上不会遇到，但门禁在本地必须也有意义。
    行尾符是**版本控制的职责**（.gitattributes / autocrlf），不该混进「内容漂移」。
    """
    return DATE_RE.sub(b"<DATE>", b.replace(b"\r\n", b"\n"))

# 离线可复现的生成器，**按依赖顺序**（改了上游要跟着重跑下游）。
#
# ⚠️ 为什么排除这几支：
#   · gen_quest_graph.py —— 只有 `--fetch`，产物是抓来的边表，**不可离线复现**；
#   · gen_items_catalog.py / gen_quest_carrier.py —— 已在 deploy-pages.yml 的
#     validate job 里跑，并且对入仓产物做了 `git diff --exit-code`，有覆盖；
#   · release.py / build_all.py —— 不是生成器（发版 / 验收编排）。
GENERATORS: list[list[str]] = [
    ["scripts/build_glossary.py"],        # 术语数据（产物在 .gitignore，不入判定）
    ["scripts/gen_quests.py"],            # ① 任务页（data-qid 锚点）
    ["scripts/gen_quest_items.py"],       # ② 任务图鉴：物品反查 / 速查（与 ③ 同页，顺序敏感）
    ["scripts/gen_quest_insights.py"],    # ③ 任务图鉴：优先级速查 + 交互数据
    ["scripts/gen_hideout.py"],           # ④ 藏身处材料清单
    ["scripts/gen_recipes.py"],           # ⑤ 配方数据
    ["scripts/gen_season_planner.py"],    # ⑥ 赛季特质模拟器数据
    ["scripts/gen_progress_manifest.py"], # ⑦ 「我的进度」清单 + 任务图 + 分块明细
    ["scripts/gen_home_stats.py"],        # ⑧ 首页速览（读上面几支的产物，故在后）
    ["scripts/gen_ammo_values.py"],       # ⑨ 数值表 ×7
    ["scripts/gen_armor_values.py"],
    ["scripts/gen_weapon_values.py"],
    ["scripts/gen_gear_values.py"],
    ["scripts/gen_food_values.py"],
    ["scripts/gen_medical_values.py"],
    ["scripts/gen_boss_values.py"],
    ["scripts/gen_achievements.py"],      # ⑩ 成就全表
]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *cmd], cwd=ROOT,
                          capture_output=True, text=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="生成物防漂移门禁")
    ap.add_argument("--no-run", action="store_true",
                    help="不重跑生成器，只说明本脚本做什么")
    args = ap.parse_args()

    if args.no_run:
        print(f"（--no-run：跳过重跑。本脚本会按依赖顺序重跑 {len(GENERATORS)} 支"
              "离线生成器 ×2 遍，再让 git 判断产物有没有跟上源。）")
        return 0

    print(f"重跑 {len(GENERATORS)} 支离线生成器 ×2 遍…")
    # ⚠️ **为什么要跑两遍**：`content/quests/index.md` 由 **3 个生成器**协作写入 ——
    #    `gen_quests` 整页重建、另两个各写一块标记区；而 `gen_quests` 的
    #    `carry_over_extras()` 会把**旧文件里的标记区整体搬过来**，于是
    #    「从任意状态跑一遍」与「再跑一遍」之间可能差一处边界空行 ——
    #    也就是**跑一遍不足以收敛**。仓库里该存的是**收敛态**，所以判定取第二遍之后。
    for rnd in (1, 2):
        quiet = rnd == 2
        for i, cmd in enumerate(GENERATORS, 1):
            r = run(cmd)
            if r.returncode != 0:
                print(f"\n[错误] 生成器退出码 {r.returncode}：{' '.join(cmd)}", file=sys.stderr)
                tail = (r.stdout or "")[-1500:] + (r.stderr or "")[-1500:]
                print(tail, file=sys.stderr)
                print("\n生成器本身跑不通，无法判断漂移 —— 先修它。", file=sys.stderr)
                return 1
            if not quiet:
                print(f"  [{i:2}/{len(GENERATORS)}] {' '.join(cmd)}")
        print(f"  （第 {rnd} 遍完成）")

    # 判定：**先让 git 判断「哪些文件变了」，再按归一化过滤**。
    # ⚠️ 不要去自己算「跑前跑后」的字节哈希 —— 本脚本第一版就是这么写的，
    #    在 Windows 上因为 `core.autocrlf`（检出 CRLF、生成器写 LF）把干净树报出
    #    46 个「漂移」，而 `git diff` 同时显示「无变化」。行尾符是**版本控制的职责**
    #    （.gitattributes / autocrlf），自己算只会算错。
    proc = subprocess.run(["git", "diff", "--name-only"], cwd=ROOT,
                          capture_output=True, text=True)
    names = [x for x in proc.stdout.splitlines() if x.strip()]

    changed: list[str] = []
    only_date: list[str] = []
    for rel in names:
        p = ROOT / rel
        if not p.exists():
            changed.append(rel + "（生成器未产出）")
            continue
        head = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=ROOT,
                              capture_output=True).stdout
        if not head:                      # 新增文件（HEAD 里没有）
            changed.append(rel + "（新增）")
            continue
        cur = p.read_bytes()
        if _norm_bytes(head) == _norm_bytes(cur):
            only_date.append(rel)         # 只差日期 / 行尾符
        else:
            changed.append(rel)

    if changed:
        print()
        print("=" * 72)
        print(f"✗ 发现 {len(changed)} 个文件与生成器输出不一致 —— 产物已与源脱节")
        print("=" * 72)
        for rel in changed:
            print(f"  · {rel}")
        # 「变了哪个文件」不够 —— 人要看到「差在哪一行」才好判断属于哪种情形。
        for rel in changed[:5]:
            p = ROOT / rel
            if not p.exists():
                continue
            head = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=ROOT,
                                  capture_output=True).stdout
            old = _norm_bytes(head).decode("utf-8", "replace")
            new = _norm_bytes(p.read_bytes()).decode("utf-8", "replace")
            d = list(difflib.unified_diff(old.splitlines(), new.splitlines(),
                                          fromfile="仓库里的", tofile="生成器输出",
                                          lineterm="", n=1))
            if not d:
                continue
            print()
            print(f"  ── {rel} 差异（最多 14 行） ──")
            for line in d[2:16]:
                print("    " + line)
        print()
        print("这两种情形都会落到这里，**判断权在人**：")
        print("  ① 有人改了源数据 / 生成器，忘了重跑 → 把重跑结果提交（本脚本刚已重跑，")
        print("     所以工作区里就是正确产物，`git add` 后提交即可）；")
        print("  ② 页面里有**人工内容写在 AUTO-GEN 标记区里**，而生成器模板没有它 →")
        print("     **不要提交**（那会抹掉内容），要把它固化进生成器模板")
        print("     （样例见 scripts/gen_hideout.py 的 STATION_NOTES）。")
        print()
        print("⚠️ 别把「重跑后文件变了」直接当成「提交就好」—— 先看清是哪一种。")
        print("⚠️ 本地若有**未提交的改动**，也会落进这里 —— 先 commit 或 stash 再跑。")
        return 1

    if only_date:
        print(f"（另有 {len(only_date)} 个文件只差**生成日期 / 行尾符**、内容一致："
              + "、".join(Path(r).name for r in sorted(only_date))
              + " —— 要清掉工作区里的改动就 `git checkout --` 它们）")

    print()
    print("=" * 72)
    print(f"✓ 一致：{len(GENERATORS)} 支生成器重跑两遍后，产物与仓库内容相同"
          f"（{len(only_date)} 个文件只差日期/行尾符）")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
