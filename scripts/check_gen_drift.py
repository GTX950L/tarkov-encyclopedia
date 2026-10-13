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
还有 2 处共 18 行人工内容（「献祭机制」等）会被整段抹掉。
**在那个时点，这几件事全是静默的。**

它怎么判
--------
**只看「这一跑把什么改动了」** —— 跑前给全部文本产物拍一张快照，跑完再拍一张，
两张不一致的就是漂移。这样定义有三个好处：

  · 不受**上游步骤**影响：CI 的 validate job 在本步之前跑过
    `gen_items_catalog.py --fetch`（会按实时价格改写图鉴页），
    那种改动与本门禁无关，天然不会落进「跑前跑后」的差集里；
    （第一版拿 `git diff` 对比 HEAD，正是栽在这里 —— 把 fetch 造成的改动
     当成了生成器漂移，CI 直接红。）
  · 不受**工作区脏不脏**影响：本地已经重跑过、只是没提交，不会被误报；
  · 只需比对两次，不依赖任何版本控制状态。

⚠️ **只比入仓文件。** `.gitignore` 覆盖的产物（`terms-data.js` / `catalog-data.js` 等）
   不参与判定 —— 它们由构建流程负责、本来就不在仓库里，报「漂移」没有意义。
   实测（2026-10-11）：CI 的 validate job 不跑 `build_glossary`，`terms-data.js`
   在本步之前不存在，被本步生成器「新产出」后误报成漂移。

⚠️ **行尾符与日期都要归一化**（`_norm_bytes`）。生成器一律写 LF，而 Windows 上
   `git checkout` 若开了 `core.autocrlf`，工作区里是 CRLF —— 不归一化会在本机
   把干净树报出几十个假漂移。日期同理：产物里有 `generated: today()`。
   **假警报比不报更糟**（站内判据）：一旦开始忽略它，真漂移也会被一起忽略。

⚠️ **为什么要跑两遍**：起因是 `content/quests/index.md`（3 个生成器协作写入）
   存在**边界空行振荡** —— 「从任意状态跑一遍」与「再跑一遍」会差一处边界空行，
   **跑一遍不足以收敛**。那个根因 2026-10-12 已修（`carry_over_extras` 把块首块尾
   归一化到一个空行，与另两个写块的生成器对齐；见下方 IGNORE 注释）。
   两遍仍然保留，理由换了：它顺带验证**生成器自身幂等**，而幂等是「产物入库」的
   前提 —— 只跑一遍看不出「第二遍又改一处」这类缺陷。
   判定取第二遍之后（跑完第一遍的中间态不参与比较）。

⚠️ **「重跑会改」不等于「有人忘了重跑」。** 人工内容写在 AUTO-GEN 标记区里、
   而生成器模板没跟上，表现出来是同一件事。两种都要人看一眼：前者该重跑，
   后者该**把内容固化进生成器模板**（`gen_hideout.py` 的 `STATION_NOTES` 就是这个来由）。
   本脚本只报告，**不自动提交、也不自动 checkout**。

副作用
------
会重跑生成器（改写产物）—— 这本来就是它的工作方式。**不会**把任何文件改回去：
门禁不该改工作区（早先有一版会 `git checkout` 恢复日期文件，结果造成
「通过 → 恢复成旧版本 → 下次跑又不一致」的自激振荡）。

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

# 归一化 ①：日期一律视作同一个值（产物里的 `generated: today()` 每天都会变）
DATE_RE = re.compile(rb"\d{4}-\d{2}-\d{2}")

# 快照范围：生成物的落点只在这两棵树下。**认后缀 + 限量大小**，
# 免得把 19 MB 的抓取缓存（items_full.json）整份读进内存。
SNAP_ROOTS = ("content", "scripts/data")
SNAP_SUFFIXES = {".md", ".js", ".json", ".txt", ".css", ".yml", ".yaml"}
SNAP_MAX_BYTES = 3 * 1024 * 1024


def _norm_bytes(b: bytes) -> bytes:
    """比对用的归一化：**先拉平行尾符，再抹掉日期**。

    行尾符是**版本控制的职责**（`.gitattributes` / `core.autocrlf`）——
    它不属于「内容漂移」，混进来只会产生假警报。
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
    ["scripts/gen_quests.py"],            # ① 任务页 + 任务详情分片（**分片入仓**，见 .gitignore 注释）
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
    ["scripts/gen_maps.py"],              # ⑪ 交互地图：底图换肤 + 点位投影（独立，不依赖其他生成器）
    ["scripts/gen_map_pages.py"],        # ⑫ 13 个地图页（读 gen_maps 的产物，故在后）
]

# 豁免清单：这些文件**不用「重跑比对」来判定**。
#
# 目前是**空集**。曾经唯一的一条是 `content/quests/index.md`：它由 **3 个生成器**
# 协作写入（`gen_quests` 整页重建，`gen_quest_items` / `gen_quest_insights`
# 各写一块标记区），而 `gen_quests.carry_over_extras()` 搬移旧标记区时对**边界空行**
# 做了「透传」—— `splitlines()` + `"\n".join()` 会把块首 n 个空行变成 n+1 个，
# 于是每跑一次就多加一行空行，一直加到另一个生成器重写该块才回退。结果在
# (3,3) 与 (2,2) 之间振荡（数字是紧跟 START 标记的**换行数**），
# **仓库里存哪个状态都会报漂移** —— 这是「非不动点」，不是「判不了」。
#
# 2026-10-12 已修：`carry_over_extras.grab()` 把块首块尾各归一化到**恰好一个空行**，
# 与另两个写块的生成器格式对齐；三者对齐后**任跑哪一个都保持不动点**
# （实测连跑 4 次 `gen_quests` 稳定在 (2,2)）。豁免因此撤掉。
#
# ⚠️ 将来再加豁免，必须写清「为什么判不了」并给出可复核的判据 —— 但先想清楚
#    它是「**真判不了**」还是「**产物不是不动点**」：后者的正解是修生成器，
#    不是加豁免（本次就是这一类，当初误判成了前者）。
IGNORE: set[str] = set()


def ignored_paths(paths: list[str]) -> set[str]:
    """这批路径里，哪些被 `.gitignore` 覆盖 —— 快照要跳过它们。

    ⚠️ 为什么必须跳过：**未入仓的产物不构成「漂移」**。它们的正确性由构建流程负责
    （CI 的 deploy job 会重新生成），而本门禁问的是「**仓库里的那份**有没有跟上源」。
    不跳过就会误报 —— 实测（2026-10-11）：CI 的 validate job 不跑 `build_glossary`，
    于是 `terms-data.js` 在本步之前根本不存在、被本步的生成器「新产出」，
    门禁当场把它报成漂移，CI 红。

    ⚠️ 用 `git check-ignore --stdin` 逐条问，而不是 `ls-files -ci`：
    后者只列**已跟踪**的忽略文件，漏掉 `terms-data.js` 这种「未跟踪 + 被忽略」的
    —— 而 CI 里正是这一类不存在。一次调用、结果精确。
    """
    if not paths:
        return set()
    payload = "\0".join(paths).encode("utf-8")
    r = subprocess.run(["git", "check-ignore", "--stdin", "-z"],
                       cwd=ROOT, input=payload, capture_output=True)
    # 退出码 0 = 有命中；1 = 一个都没命中（不是错误）；其它 = git 不可用，退回不过滤
    if r.returncode not in (0, 1):
        return set()
    return {x.decode("utf-8").replace("\\", "/") for x in r.stdout.split(b"\0") if x}


def snapshot() -> dict[str, bytes]:
    """给全部**入仓的**文本产物拍快照（归一化后），用于跑前跑后比对。"""
    cands: list[tuple[str, Path]] = []
    for base in SNAP_ROOTS:
        root = ROOT / base
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix not in SNAP_SUFFIXES:
                continue
            try:
                if p.stat().st_size > SNAP_MAX_BYTES:
                    continue
            except OSError:
                continue
            cands.append((str(p.relative_to(ROOT)).replace("\\", "/"), p))

    skip = ignored_paths([rel for rel, _ in cands])
    out: dict[str, bytes] = {}
    for rel, p in cands:
        if rel in skip:
            continue
        try:
            out[rel] = _norm_bytes(p.read_bytes())
        except OSError:
            continue
    return out


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
              "离线生成器 ×2 遍，比对跑前跑后快照，报出被改动过的产物。）")
        return 0

    print(f"拍跑前快照 → 重跑 {len(GENERATORS)} 支离线生成器 ×2 遍 → 拍跑后快照…")
    before = snapshot()

    for rnd in (1, 2):
        quiet = rnd == 2
        for i, cmd in enumerate(GENERATORS, 1):
            r = run(cmd)
            if r.returncode != 0:
                print(f"\n[错误] 生成器退出码 {r.returncode}：{' '.join(cmd)}",
                      file=sys.stderr)
                tail = (r.stdout or "")[-1500:] + (r.stderr or "")[-1500:]
                print(tail, file=sys.stderr)
                print("\n生成器本身跑不通，无法判断漂移 —— 先修它。", file=sys.stderr)
                return 1
            if not quiet:
                print(f"  [{i:2}/{len(GENERATORS)}] {' '.join(cmd)}")
        print(f"  （第 {rnd} 遍完成）")

    after = snapshot()

    changed: list[str] = []
    for rel in sorted(set(before) | set(after)):
        if rel in IGNORE:
            continue
        if before.get(rel) != after.get(rel):
            changed.append(rel)

    if changed:
        print()
        print("=" * 72)
        print(f"✗ 发现 {len(changed)} 个产物与生成器输出不一致 —— 产物已与源脱节")
        print("=" * 72)
        for rel in changed:
            if rel not in before:
                print(f"  · {rel}（本次生成器新产出）")
            elif rel not in after:
                print(f"  · {rel}（生成器已删除它）")
            else:
                print(f"  · {rel}")
        # 「变了哪个文件」不够 —— 人要看到「差在哪一行」才好判断属于哪种情形。
        for rel in [r for r in changed if r in before and r in after][:5]:
            old = before[rel].decode("utf-8", "replace")
            new = after[rel].decode("utf-8", "replace")
            d = list(difflib.unified_diff(old.splitlines(), new.splitlines(),
                                          fromfile="跑前（= 仓库里的）",
                                          tofile="重跑后", lineterm="", n=1))
            if not d:
                continue
            print()
            print(f"  ── {rel} 差异（最多 14 行） ──")
            for line in d[2:16]:
                print("    " + line)
        print()
        print("这两种情形都会落到这里，**判断权在人**：")
        print("  ① 有人改了源数据 / 生成器，忘了重跑 → 把重跑结果提交"
              "（本脚本刚已重跑，工作区里就是正确产物，`git add` 后提交即可）；")
        print("  ② 页面里有**人工内容写在 AUTO-GEN 标记区里**，而生成器模板没有它 →")
        print("     **不要提交**（那会抹掉内容），要把它固化进生成器模板")
        print("     （样例见 scripts/gen_hideout.py 的 STATION_NOTES）。")
        print()
        print("⚠️ 别把「重跑后文件变了」直接当成「提交就好」—— 先看清是哪一种。")
        return 1

    ignored = len([r for r in set(before) | set(after) if r in IGNORE])
    if ignored:
        print(f"（豁免 {ignored} 个文件、原因见脚本里的 IGNORE：{'、'.join(sorted(IGNORE))}）")

    print()
    print("=" * 72)
    print(f"✓ 一致：{len(GENERATORS)} 支生成器重跑两遍后，产物与跑前相同"
          f"（快照 {len(after)} 个文本产物；日期与行尾符已归一化）")
    if not IGNORE:
        print("  无豁免文件 —— 所有产物的判定都是「真判定」。")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
