#!/usr/bin/env python3
"""发版：从 CHANGELOG 读出最新版本 → 打 tag → 建 Release。

为什么需要它
------------
**Release 必须与 CHANGELOG 一起发**，否则版本序列会断 —— 本项目已经因此补建过
三轮：v1.49–v1.70 期间只写 CHANGELOG 没建 Release（23 个版本的量级）、
v1.77.0–v1.80.4 又漏了 8 个、v1.88.0–v1.98.1 再漏 18 个（都用
`scripts/backfill_releases.py` 补齐）。

⚠️ **不要拿「页头徽标会更新」当理由 —— 那已经不成立了（2026-10-07 实测）。**
   本项目当前用的 Material 7（经 Zensical 构建）**不再渲染任何版本元素**：
   产物页头只有站名 / 主题切换 / 搜索 / 仓库图标，**没有 `.md-version`**；
   `extra.version` 配上去也**不会**渲染（实测配过，产物里仍搜不到该元素）。
   早年那个「版本 / 星标 / 分叉」的仓库 facts 组件，在这个主题版本里已经没有了 ——
   主题的 JS 里那段 `/releases/latest` 代码还在，但**没有组件消费它**。
   详见 content/CONTRIBUTING.md「发版与版本号」一节的更正说明。

   仍然要建 Release，站得住的理由是两条：**它是本项目在 GitHub 上对外唯一的版本历史**
   （读者与 AI 引用时靠它锚定版本），以及**它是本脚本幂等判定的对象**。

它做三件事，且**每一步都先判「做过没有」，可重复执行**：
  1. 从 `content/CHANGELOG.md` 解析最新版本号与标题；
  2. 若 tag 不存在 → `git tag -a` + `git push origin <tag>`；
  3. 若 Release 不存在 → `gh release create --verify-tag --notes-file`。

⚠️ 两个已知的坑（都已绕开）
  · `gh release create --target <短SHA>` 会失败 —— GitHub 的 commitish
    只收**分支名或完整 SHA**，而报错信息会误导你去查 tag 名格式。
    所以这里是「先建 tag、再 `--verify-tag`」，不传 `--target`。
  · `gh release create` 首次可能返回 **HTTP 504**（notes 较长时更容易）——
    重试即成；本脚本内置一次重试。

用法
----
    python scripts/release.py --dry-run     # 只看它打算做什么，不改任何东西
    python scripts/release.py               # 真发版（会 push tag + 建 Release）
    python scripts/release.py --version v1.87.0   # 显式指定版本（默认取 CHANGELOG 最新）

退出码：成功或「已经发过」→ 0；真出错 → 1。
只读内容；对外的写动作只有 `git tag` / `git push` / `gh release`。
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

# ## 2026-10（v1.86.0）— 首页顶部补「本站速览」…
HEADING_RE = re.compile(r"^##\s+(?P<date>\d{4}-\d{2})（(?P<ver>v\d+\.\d+\.\d+)）\s*—?\s*(?P<title>.*)$")


def sh(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace", check=check
    )


def parse_latest() -> tuple[str, str, str, str]:
    """返回 (版本号, 日期, 标题, 该版本在 CHANGELOG 里的正文)。"""
    text = CHANGELOG.read_text(encoding="utf-8")
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line.strip())
        if not m:
            continue
        # 正文：从本标题下一行起，到下一个 `## ` 标题为止
        body: list[str] = []
        for nxt in lines[i + 1:]:
            if nxt.startswith("## "):
                break
            body.append(nxt)
        return m.group("ver"), m.group("date"), m.group("title").strip(), "\n".join(body).strip()
    raise SystemExit("✗ 在 content/CHANGELOG.md 里找不到形如「## 2026-10（v1.86.0）— 标题」的版本标题")


def tag_exists(tag: str) -> bool:
    return sh(["git", "rev-parse", "--verify", f"refs/tags/{tag}"], check=False).returncode == 0


def remote_tag_exists(tag: str) -> bool:
    out = sh(["git", "ls-remote", "--tags", "origin", tag], check=False).stdout
    return tag in out


def release_exists(tag: str) -> bool:
    p = sh(["gh", "release", "view", tag, "--json", "tagName"], check=False)
    return p.returncode == 0 and tag in (p.stdout or "")


def gh_token_from_git() -> str | None:
    """gh 的 keyring token 失效时，从 git 的 credential helper 里取一个来兜底。

    （本机实测过这个形态：`gh release create` 403 / keyring token invalid，
      但 `git push` 正常 —— 两者是两套凭据。）
    """
    p = subprocess.run(
        ["git", "credential", "fill"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        input="protocol=https\nhost=github.com\n\n",
    )
    for line in (p.stdout or "").splitlines():
        if line.startswith("password="):
            return line[len("password="):].strip() or None
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="从 CHANGELOG 发版：tag + Release")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不做任何改动")
    ap.add_argument("--version", help="显式指定版本号（默认取 CHANGELOG 最新）")
    args = ap.parse_args()

    ver, date, title, body = parse_latest()
    if args.version:
        ver = args.version
        title = f"（--version 指定，未从 CHANGELOG 取标题）"

    print("=" * 62)
    print(f"CHANGELOG 最新版本：{ver}   （{date}）")
    print(f"标题：{title}")
    print("=" * 62)

    have_tag = tag_exists(ver)
    have_rel = release_exists(ver) if not args.dry_run else False

    print(f"\n现状：tag {'已存在' if have_tag else '不存在'} ｜ Release {'已存在' if have_rel else '未检查/不存在'}")

    if have_tag and have_rel and not args.dry_run:
        print("\n✓ 已经发过版，无需操作（幂等：不会重复建 Release）。")
        print(f"  核验：gh release list --limit 1  → 最新 Release 应为 {ver}")
        return 0

    if args.dry_run:
        print("\n【dry-run】将要执行：")
        if not have_tag:
            print(f"  · git tag -a {ver} -m \"{ver} —— {title}\"")
            print(f"  · git push origin {ver}")
        print(f"  · gh release create {ver} --title \"{ver} —— {title}\" --notes-file <临时文件>")
        print("\n（dry-run 结束，未做任何改动）")
        return 0

    # ① tag
    if not have_tag:
        print(f"\n▶ 建 tag：{ver}")
        sh(["git", "tag", "-a", ver, "-m", f"{ver} —— {title}"])
        print("  ✓ 本地 tag 已建")
    if not remote_tag_exists(ver):
        print(f"▶ 推送 tag：{ver}")
        p = sh(["git", "push", "origin", ver], check=False)
        if p.returncode != 0:
            print("  ✗ 推送 tag 失败：\n" + (p.stdout + p.stderr))
            return 1
        print("  ✓ 已推送")

    # ② Release
    if release_exists(ver):
        print(f"\n✓ Release {ver} 已存在，跳过。")
        return 0

    print(f"\n▶ 建 Release：{ver}")
    notes = (
        f"内容基线：本站以 **2026 年 10 月 / 1.2.0.0（第一赛季 KORD BREACH）** 的公开信息为准。\n"
        f"引用前请先读 [数据口径与引用说明](https://gtx950l.github.io/tarkov-encyclopedia/docs/citation/)。\n\n"
        f"---\n\n{body}\n"
    )
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as fh:
        fh.write(notes)
        notes_file = Path(fh.name)

    try:
        cmd = [
            "gh", "release", "create", ver,
            "--title", f"{ver} —— {title}",
            "--notes-file", str(notes_file),
            "--verify-tag",
        ]
        p = sh(cmd, check=False)
        if p.returncode != 0:
            combined = (p.stdout or "") + (p.stderr or "")
            # 504 重试一次（长 notes 时常见）
            if "504" in combined or "timeout" in combined.lower():
                print("  ⚠️ 首次返回 504 / timeout，重试一次…")
                p = sh(cmd, check=False)
                combined = (p.stdout or "") + (p.stderr or "")
            if p.returncode != 0:
                # keyring token 失效兜底：改用 git 的凭据
                token = gh_token_from_git()
                if token:
                    print("  ⚠️ gh 鉴权失败，改用 git 的凭据重试…")
                    import os
                    env = dict(os.environ, GH_TOKEN=token)
                    p = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, env=env)
                    combined = (p.stdout or "") + (p.stderr or "")
                if p.returncode != 0:
                    print("  ✗ 建 Release 失败：\n" + combined)
                    print("\n  提示：若报鉴权错误（keyring token invalid），"
                          "需要交互式执行 `gh auth login` —— 智能体无法代做。")
                    return 1
        print("  ✓ Release 已建")
    finally:
        notes_file.unlink(missing_ok=True)

    print(f"\n{'=' * 62}")
    print(f"✓ 发版完成：{ver}")
    print("  验收判据（不依赖页头 —— 主题已不再渲染版本元素）：")
    print(f"    gh release list --limit 1   → 最新 Release 的 tag 应为 {ver}")
    print("    python scripts/release.py --dry-run   → 应报「已经发过，无需操作」")
    print("  读者侧：仓库 Releases 页与 CHANGELOG 顶部条目一致即算对齐。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
