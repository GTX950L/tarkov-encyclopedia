#!/usr/bin/env python3
"""为缺失的版本补建 GitHub Release。

已补批次（都用本脚本按 CHANGELOG 段落补齐）：
  · v1.77.0–v1.80.4（8 个，2026-10-07）
  · v1.49.0–v1.70.0 / v1.88.0–v1.92.0 / v1.93.1–v1.98.1（40 个，2026-10-10）
范围边界：Release 实践从 v1.47.0 起；更早的 v1.0.0–v1.46.0 从无 Release 约定，不在补建范围。

为什么要单独一个脚本：站规「Release 必须与 CHANGELOG 一起发」—— 只改 CHANGELOG
不建 Release，版本序列就断了（Release 是本项目在 GitHub 上对外唯一的版本历史，
读者与 AI 引用时靠它锚定版本）。本脚本按 CHANGELOG 的条目内容一次性补齐。

三条约定：
  · **body 直接取自 CHANGELOG 的对应段落**（不另写一遍 —— 两份文案必然漂）；
  · **相对链接降级为纯文本**：CHANGELOG 里的 `[Prestige 转生](entries/prestige.md)`
    在 Release 页会解析成断链，所以只保留标签文字；绝对 http 链接原样保留；
  · tag 打在**该版本自己的 commit** 上（不是 HEAD），否则时间线会错。

用法：
    python scripts/backfill_releases.py --dry-run   # 只打印将要做的事
    python scripts/backfill_releases.py             # 实际建 Release
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "content" / "CHANGELOG.md"

# tag → (commit, title)
RELEASES = [
    ("v1.77.0", "abac0ac", "v1.77.0 · 1.2.0.0 落地：基线抬升 + 新增 EXFIL Brothers 条目"),
    ("v1.78.0", "f1fbcf7", "v1.78.0 · 修掉「可接」判定漏算声望门槛"),
    ("v1.79.0", "097506a", "v1.79.0 · 总览统计：两处「把未知说成很低」"),
    ("v1.80.0", "b01e871", "v1.80.0 · 进度系统交互重做：状态按钮 / 任务行分隔 / 常驻状态条 / 按地图分组"),
    ("v1.80.1", "83eff39", "v1.80.1 · 修状态分段控件文字被裁（v1.80.0 引入的回归）"),
    ("v1.80.2", "4d68d7a", "v1.80.2 · 修门槛面板右边框被顶出 + 三态按钮参差不齐"),
    ("v1.80.3", "964ca24", "v1.80.3 · 「边框右边看不见」第二次返工 —— 上一批修错了对象"),
    ("v1.80.4", "1681664", "v1.80.4 · 修「前置推断一直是零」：总览没注册重绘"),

    # —— 2026-10-10 批次：Release 实践（v1.47.0 起）以来的全部缺口，共 40 个 ——
    #    v1.49.0–v1.70.0（22 个）：只写 CHANGELOG 没建 Release 的历史存量；
    #    v1.88.0–v1.92.0（10 个）与 v1.93.1–v1.98.1（8 个）：v1.87.1 之后的两段断档。
    #    commit 一律取「该版本自己的提交」（主题里带版本号的那一个），不是 HEAD。
    ("v1.49.0", "949f50c", "v1.49.0 —— 四个结局的介绍补全，并顺带修掉一处长期没人检查的计数漂移"),
    ("v1.50.0", "315b0a9", "v1.50.0 —— 篇章排序修正 + 第九 / 第十篇编号"),
    ("v1.51.0", "46ed298", "v1.51.0 —— 修掉侧栏「栏目收不起来」"),
    ("v1.52.0", "c881806", "v1.52.0 —— 修掉「表格吞块」一族渲染缺陷"),
    ("v1.53.0", "8841a79", "v1.53.0 —— 修掉「侧栏导航偶发不回顶」"),
    ("v1.54.0", "8171183", "v1.54.0 —— 版本对齐核查：确认 1.2.0.0 未落地，站内基线有效"),
    ("v1.55.0", "1b62e54", "v1.55.0 —— 深化新手指引：新增「前 10 局脚本」与「新手该不该」两节，并新开可打印的《新手开局检查清单》"),
    ("v1.56.0", "35934cc", "v1.56.0 —— 废止「外部对照只取机制性事实」判据"),
    ("v1.57.0", "331cd86", "v1.57.0 —— 作废「条目层已饱和」判断，并据新对照口径查出三处零覆盖机制"),
    ("v1.58.0", "195e44f", "v1.58.0 —— 补三处零覆盖机制：跳弹 / 碎裂 / 弹道破空声"),
    ("v1.59.0", "eddb0ee", "v1.59.0 —— 《弹药选型速查表》新增「逐发弹药数值表」：200 条弹药的伤害 / 穿深 / 甲伤 / 碎弹 / 跳弹 / 初速"),
    ("v1.60.0", "db9abc9", "v1.60.0 —— 《护甲与头盔图鉴》新增「逐款护甲数值表」：49 款防弹衣 ＋ 112 款头盔"),
    ("v1.61.0", "ae80af9", "v1.61.0 —— 《枪械图鉴》新增「逐型号武器数值表」：172 把武器"),
    ("v1.62.0", "f6074a4", "v1.62.0 —— 食物、医疗、附加护甲三张数值表落地：46 ＋ 43 ＋ 117 条"),
    ("v1.63.0", "de502db", "v1.63.0 —— 任务图鉴新增「物品需求反查」与「任务速查」两节"),
    ("v1.64.0", "b612c57", "v1.64.0 —— 四张装备数值表 ＋ Boss 血量与刷新率"),
    ("v1.65.0", "12fcabe", "v1.65.0 —— 任务奖励反查：哪些任务会「给」它"),
    ("v1.66.0", "0e2fe5c", "v1.66.0 —— 任务图鉴新增「按『线』看：不跟着商人走的任务线」"),
    ("v1.67.0", "f6b0490", "v1.67.0 —— 任务索引表补两个标记"),
    ("v1.68.0", "37f340c", "v1.68.0 —— 修掉两处任务图鉴缺陷：重复条目无标注、任务名空格不统一"),
    ("v1.69.0", "ee7bfac", "v1.69.0 —— 任务页加英文名，让「搜任务」中英文都能命中"),
    ("v1.70.0", "f2a281d", "v1.70.0 —— 任务进度追踪：给 515 个任务加一张本地打勾表"),
    ("v1.88.0", "7b3f697", "v1.88.0 —— 补上「战争迷雾」那条任务链；页头不再空白、不再需要拉回顶部"),
    ("v1.88.1", "62eb8c9", "v1.88.1 —— 修掉收起态搜索框「查找」两个字：近黑压深蓝，2.43:1"),
    ("v1.88.2", "4184d69", "v1.88.2 —— 任务图鉴：89 个任务块之间加一条分隔线"),
    ("v1.89.0", "af811ec", "v1.89.0 —— 任务 ⇄ 物品双向联动：出发前必带 · 物品反查「要不要留」"),
    ("v1.89.1", "e703377", "v1.89.1 —— 搜索提示不再谎报「正在载入」：等不到就说「没能载入」"),
    ("v1.89.2", "dbeec02", "v1.89.2 —— 修掉 v1.89.1 自己引入的 404：子目录页上的相对路径"),
    ("v1.90.0", "af9b198", "v1.90.0 —— 第九篇 · 物品图鉴：全站 4,979 件物品的属性与商人价"),
    ("v1.90.1", "bdeae12", "v1.90.1 —— 物品数值核对：查出并修正 1 条错误数值"),
    ("v1.91.0", "834a786", "v1.91.0 —— 物品图鉴与任务图鉴打通：点物品名直接跳到图鉴"),
    ("v1.92.0", "85f9c04", "v1.92.0 —— 全文搜索索引瘦身 40%：图鉴大表不再进索引"),
    ("v1.93.1", "9b855c0", "v1.93.1 —— 两处「静默失效」修复：站内篇号口径错乱 ｜ 物品图鉴类型筛选漏 132 件"),
    ("v1.94.0", "b30225d", "v1.94.0 —— 新增「单格价值榜」：一格空间装什么最值钱"),
    ("v1.95.0", "8860a7d", "v1.95.0 —— 新增「物品详情」：4979 件物品各有一个可分享的完整页面"),
    ("v1.95.1", "b11d84f", "v1.95.1 —— 排版审查后的修复：交互表回到站内表格样式契约"),
    ("v1.96.0", "adb3350", "v1.96.0 —— 新增「任务详情」：515 个任务各有一个可分享的完整页面"),
    ("v1.96.4", "8ae7b83", "v1.96.4 —— 修「出发前必带」渲染 + 打通 任务 ⇄ 物品 双向链接"),
    ("v1.98.0", "1260293", "v1.98.0 —— 图鉴长页分册：mods-body 从 118 屏压到 4 册"),
    ("v1.98.1", "522c19b", "v1.98.1 —— 把「台词」真正摆到可发现的位置 + 修一个换页竞态"),
]

REL_LINK = re.compile(r"\[([^\]]+)\]\((?!(?:https?:|#))[^)]*\)")


def strip_relative_links(text: str) -> str:
    """把相对链接 [标签](路径) 降级为「标签」；绝对链接与站内锚点保留。"""
    return REL_LINK.sub(r"\1", text)


def sections() -> dict[str, str]:
    """CHANGELOG 的 `## ` 段落 → {版本号: 正文}。一个段落可能覆盖多个版本（v1.80.1 ~ v1.80.3）。"""
    text = CHANGELOG.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for chunk in re.split(r"(?m)^## ", text)[1:]:
        head, _, body = chunk.partition("\n")
        body = body.strip()
        m = re.search(r"（(v[\d.]+(?:\s*~\s*v[\d.]+)?)）", head)
        if not m:
            continue
        span = m.group(1)
        if "~" in span:
            lo, hi = [x.strip().lstrip("v") for x in span.split("~")]
            a = [int(x) for x in lo.split(".")]
            b = [int(x) for x in hi.split(".")]
            if a[:2] != b[:2]:
                print(f"[错误] 跨次版本的区间暂不支持：{span}", file=sys.stderr)
                return {}
            # 区间落在 patch 上（v1.80.1 ~ v1.80.3）——按 patch 展开，别只展开 minor
            for patch in range(a[2], b[2] + 1):
                out[f"v{a[0]}.{a[1]}.{patch}"] = body
        else:
            out[span.strip()] = body
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    sec = sections()
    # 上限给足：Release 总数已 60+，limit 太小会让「已存在」判空、重复建。
    have = subprocess.run(["gh", "release", "list", "--limit", "300"],
                          capture_output=True, text=True, cwd=ROOT).stdout
    lines = ["| tag | 版本 | commit | body 字符 | 状态 |", "|---|---|---|---|---|"]
    files: list[tuple[str, str, Path]] = []

    for tag, sha, title in RELEASES:
        body = sec.get(tag, "")
        if not body:
            print(f"[错误] CHANGELOG 里找不到 {tag} 的段落", file=sys.stderr)
            return 1
        body = strip_relative_links(body)
        # v1.80.1~80.3 共用一个段落：**把该版本自己的那一行提到最前**，
        # 否则三条 body 除了第一句完全一样，读者点开哪条都分不清本版改了什么。
        if tag in ("v1.80.1", "v1.80.2", "v1.80.3"):
            # 表里的写法是「80.2」而不是「v1.80.2」——按去前缀后的 minor.patch 匹配
            key = ".".join(tag.lstrip("v").split(".")[1:])   # v1.80.2 → 80.2
            row = next((ln for ln in body.splitlines()
                        if re.match(rf"^\|\s*{re.escape(key)}\s*\|", ln)), "")
            body = (f"## 本版（{tag}）的改动\n\n"
                    + (row + "\n\n" if row else "")
                    + "---\n\n## 这一批三版的共同根因\n\n" + body)
        done = tag in have
        # 标题两种写法都要能取到「副题」：老批次是「vX · 副题」，新批次是「vX —— 副题」。
        short = re.split(r"\s·\s|\s——\s", title, maxsplit=1)
        lines.append(f"| {tag} | {(short[1] if len(short) > 1 else title)[:28]} | `{sha}` | {len(body)} | "
                     f"{'已存在，跳过' if done else '待创建'} |")
        if not done:
            f = Path(tempfile.gettempdir()) / f"rel-{tag}.md"
            f.write_text(body, encoding="utf-8")
            files.append((tag, title, f))

    print("\n".join(lines))
    if a.dry_run:
        print(f"\n[dry-run] 将创建 {len(files)} 个 Release。")
        return 0

    for tag, title, f in files:
        sha = dict((t, s) for t, s, _ in RELEASES)[tag]
        # ⚠️ **不能直接给 `gh release create` 传 `--target <短SHA>`** ——实测返回 422
        # 「tag_name is not a valid tag / Release.target_commitish is invalid」。
        # 正确次序：先把 tag 打在**该版本自己的 commit** 上并推送，再建 Release（不带 --target）。
        for cmd in (["git", "tag", "-f", tag, sha],
                    ["git", "push", "-f", "origin", tag]):
            r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
            if r.returncode != 0:
                print(f"✗ {tag} 打 tag/推送失败：{(r.stderr or r.stdout).strip()[:200]}")
                return 1
        # gh release create 首次可能返回 HTTP 504（notes 较长时更容易）—— 重试一次即成。
        ok = False
        for attempt in (1, 2):
            r = subprocess.run(["gh", "release", "create", tag,
                                "--title", title,
                                "--notes-file", str(f)],
                               capture_output=True, text=True, cwd=ROOT)
            if r.returncode == 0:
                ok = True
                break
            print(f"  · {tag} 第 {attempt} 次失败：{r.stderr.strip()[:160]}")
        if ok:
            print("✓ " + tag + " " + r.stdout.strip())
        else:
            print(f"✗ {tag} 建 Release 失败（已重试一次）")
            return 1

    # ⚠️ 收尾：把「Latest」指回 CHANGELOG 最新版本。
    #    本脚本补建的都是**旧版本**，但 GitHub 对「**新发布**的 Release」默认置为 Latest ——
    #    40 个补完，徽标就停在了最后一个补建的旧版本上（2026-10-10 实测：指到了 v1.98.1）。
    #    更隐蔽的是：站规判据「最新 Release == CHANGELOG 最新版本」只查 `gh release list`
    #    第一行时**看不出这个错**（列表按提交日期排，第一行仍是最新版）——必须显式指回。
    newest = next(iter(sec), "")
    if newest:
        r = subprocess.run(["gh", "release", "edit", newest, "--latest"],
                           capture_output=True, text=True, cwd=ROOT)
        if r.returncode == 0:
            print(f"✓ Latest 已指回 CHANGELOG 最新版本 {newest}")
        else:
            print(f"⚠️ 未能把 Latest 指回 {newest}：{r.stderr.strip()[:160]}")
            print("   （若该版本尚未建 Release，先发版再重跑本脚本。）")
    print(f"\n完成：新建 {len(files)} 个 Release。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
