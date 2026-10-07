#!/usr/bin/env python3
"""为缺失的版本补建 GitHub Release（v1.77.0 ~ v1.80.4）。

为什么要单独一个脚本：站规里「页头徽标的版本号必须等于 CHANGELOG 最新条目括号里的版本号」，
而徽标读的是**最新 Release**。本站 v1.77.0–v1.80.4 期间只改了 CHANGELOG 没建 Release，
徽标因此长期停在 v1.76.1。本脚本按 CHANGELOG 的条目内容一次性补齐。

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
    have = subprocess.run(["gh", "release", "list", "--limit", "60"],
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
        lines.append(f"| {tag} | {title.split(' · ')[1][:28]} | `{sha}` | {len(body)} | "
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
        r = subprocess.run(["gh", "release", "create", tag,
                            "--title", title,
                            "--notes-file", str(f)],
                           capture_output=True, text=True, cwd=ROOT)
        print(("✓ " + tag + " " + r.stdout.strip()) if r.returncode == 0
              else f"✗ {tag} 失败：{r.stderr.strip()[:200]}")
        if r.returncode != 0:
            return 1
    print(f"\n完成：新建 {len(files)} 个 Release。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
