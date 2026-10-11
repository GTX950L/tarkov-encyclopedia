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
**不清点产物清单**（那种清单自己会漂），而是比对跑前跑后：

  1. 记录全部 git 跟踪文件（＋几个 gitignore 的已知产物）的「归一化哈希」；
  2. 按依赖顺序跑一遍离线生成器
     （`python 本脚本` 即可；也可用 `--no-run` 只对现状做一次体检）；
  3. 重新算哈希，列出**归一化后**仍不同的文件 → 有则退出码 1。

⚠️ **归一化**：把 `YYYY-MM-DD` 一律换成占位符再比。产物里有 `generated: today()`
   这类**天天变**的字段，不归一化会天天误报 —— 而**假警报比不报更糟**
   （项目判据，见 roadmap 第七十一批）。若哪天要连日期变化也管，
   那是「让生成器输出稳定值」的事，不要塞进这个脚本。

⚠️ **「重跑会改」不等于「有人忘了重跑」。** 人工内容写在 AUTO-GEN 标记区里、
   而生成器模板没跟上，表现出来是同一件事。两种都要人看一眼：
   前者该重跑，后者该**把内容固化进生成器模板**（`gen_hideout.py` 的
   `STATION_NOTES` 就是这个来由）。本脚本只报告，**不自动提交**。

副作用
------
会重跑生成器（改写产物）—— 这本来就是它的工作方式。
**不会**把任何文件自动改回去：早先那版会在「结论一致」时 `git checkout` 恢复
仅日期变化的文件，结果造成「通过 → 恢复成旧版本 → 下次跑又不一致」的自激振荡
（2026-10-11 实测踩到）。门禁不该改工作区。

退出码：0 = 产物与生成器一致；1 = 有差异（可作 CI 门禁）。
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 归一化：日期一律视作同一个值（产物里的 `generated: today()` 每天都会变）
DATE_RE = re.compile(rb"\d{4}-\d{2}-\d{2}")

# 离线可复现的生成器，**按依赖顺序**（改了上游要跟着重跑下游）。
#
# ⚠️ 为什么排除这几支：
#   · gen_quest_graph.py —— 只有 `--fetch`，产物是抓来的边表，**不可离线复现**；
#   · gen_items_catalog.py / gen_quest_carrier.py —— 已在 deploy-pages.yml 的
#     validate job 里跑，并且对入仓产物做了 `git diff --exit-code`，有覆盖；
#   · release.py / build_all.py —— 不是生成器（发版 / 验收编排）。
GENERATORS: list[list[str]] = [
    ["scripts/build_glossary.py"],        # 术语数据（产物在 .gitignore，见下 EXTRA_OUTPUTS）
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

# 产物落在 .gitignore 里、`git ls-files` 看不到、但仍要一并比对的几份。
# （它们不入仓，但**本地与 CI 都会重新生成**，所以「跑前跑后一致」照样成立。）
EXTRA_OUTPUTS: list[str] = [
    "content/javascripts/terms-data.js",
]


def norm_hash(p: Path) -> str | None:
    try:
        b = p.read_bytes()
    except OSError:
        return None
    return hashlib.sha256(DATE_RE.sub(b"<DATE>", b)).hexdigest()


def norm_text(p: Path) -> str | None:
    """归一化后的正文 —— 只给「报差异时打印 diff」用，不参与判定。"""
    try:
        b = p.read_bytes()
    except OSError:
        return None
    return DATE_RE.sub(b"<DATE>", b).decode("utf-8", "replace")


def raw_hash(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return None


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT,
                         capture_output=True, check=True).stdout
    return [ROOT / x.decode("utf-8") for x in out.split(b"\0") if x]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *cmd], cwd=ROOT,
                          capture_output=True, text=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="生成物防漂移门禁")
    ap.add_argument("--no-run", action="store_true",
                    help="不重跑生成器，只对当前工作区做一次一致性说明")
    args = ap.parse_args()

    files = tracked_files() + [ROOT / e for e in EXTRA_OUTPUTS]
    files = [p for p in files if p.exists()]
    before = {str(p): (norm_hash(p), raw_hash(p), norm_text(p)) for p in files}

    if args.no_run:
        print(f"（--no-run：跳过重跑，仅说明。跟踪文件 {len(files)} 个）")
        print("  要真正检测漂移，去掉 --no-run。")
        return 0

    print(f"重跑 {len(GENERATORS)} 支离线生成器（跟踪文件 {len(files)} 个做跑前跑后比对）…")
    for i, cmd in enumerate(GENERATORS, 1):
        r = run(cmd)
        if r.returncode != 0:
            print(f"\n[错误] 生成器退出码 {r.returncode}：{' '.join(cmd)}", file=sys.stderr)
            tail = (r.stdout or "")[-1500:] + (r.stderr or "")[-1500:]
            print(tail, file=sys.stderr)
            print("\n生成器本身跑不通，无法判断漂移 —— 先修它。", file=sys.stderr)
            return 1
        print(f"  [{i:2}/{len(GENERATORS)}] {' '.join(cmd)}")

    changed: list[Path] = []
    only_date: list[Path] = []
    for p in files:
        key = str(p)
        n_before, r_before, _ = before.get(key, (None, None, None))
        n_after, r_after = norm_hash(p), raw_hash(p)
        if n_before == n_after:
            # 归一化后一致：若原始内容变了，说明只动了日期字段
            if r_before != r_after:
                only_date.append(p)
            continue
        changed.append(p)

    if changed:
        print()
        print("=" * 72)
        print(f"✗ 发现 {len(changed)} 个文件与生成器输出不一致 —— 产物已与源脱节")
        print("=" * 72)
        for p in changed:
            print(f"  · {p.relative_to(ROOT)}")
        # 「变了哪个文件」不够 —— 人要看到「差在哪一行」才好判断属于哪种情形。
        # 最多打印前 5 个文件、每个 14 行（归一化后的差异，日期已替换成 <DATE>）。
        for p in changed[:5]:
            old = before.get(str(p), (None, None, None))[2]
            new = norm_text(p)
            if old is None or new is None:
                continue
            d = list(difflib.unified_diff(old.splitlines(), new.splitlines(),
                                          fromfile="跑前", tofile="重跑后",
                                          lineterm="", n=1))
            if not d:
                continue
            print()
            print(f"  ── {p.relative_to(ROOT)} 差异（最多 14 行） ──")
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
        return 1

    # ⚠️ 这里**刻意不做** `git checkout` 恢复。
    #    早先有一版会在「结论一致」时把仅日期变化的文件恢复回 HEAD —— 结果是
    #    「通过 → 恢复成旧版本 → 下次跑又不一致 → 恢复 → …」的**自激振荡**：
    #    门禁自己改工作区，反而把稳定判定变成了不稳定的（2026-10-11 实测踩到）。
    #    仅日期变化的文件留在工作区即可，人一眼就能清掉。
    if only_date:
        print(f"（另有 {len(only_date)} 个文件**仅生成日期**变化、内容一致："
              + "、".join(Path(str(p)).name for p in only_date)
              + " —— 想清掉工作区里的改动就 `git checkout --` 它们）")

    print()
    print("=" * 72)
    print(f"✓ 一致：{len(GENERATORS)} 支生成器重跑后，产物与仓库内容相同"
          f"（日期字段已归一化，{len(only_date)} 处）")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
