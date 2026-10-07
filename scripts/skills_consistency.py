#!/usr/bin/env python3
"""一致性校验：`.agent/skills/` 里写的东西必须与仓库实际一致。

为什么需要它
------------
仓库的站规里有一条：**「检查器失效时，世界是静默的」**。
`.agent/skills/` 是给 AI 智能体看的操作手册，它最大的风险不是写错，
而是**写对了、后来代码改了、手册没改** —— 智能体照着手册去读一个
已经不存在的文件，会安静地跳过、然后凭印象编内容。

这份脚本把手册里的「声明」变成可执行的断言，两类：

  【A】路径断言 —— 手册里反引号引用的每个文件/脚本必须真实存在。
  【B】门禁断言 —— 手册里说「是 CI 门禁」的脚本必须真的被 workflow 调用；
                   说「不是门禁（信息性）」的必须真的没被调用；
                   说「巡检」（第三类，2026-10 加入）的必须真的出现在一个
                   **带 schedule 触发器**的 workflow 里。
                   为什么要有第三类：巡检脚本（需要联网 / 只报告不阻断）既不能
                   放进部署前置（GitHub 抖动会变成失败的部署），也不能「完全
                   不进 CI」（那样它永远不会跑）。原来的二分法里，这两种脚本
                   无论怎么标都对不上，于是迟早会被静默地改成谎话。

退出码：有任何一条不成立 → 1（可作为 CI 门禁）。全部通过 → 0。
只读，不修改任何文件。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / ".agent" / "skills"
WORKFLOW_DIR = ROOT / ".github" / "workflows"

# 参与路径断言的文件后缀。不含 .html/.json 之类 —— 手册里几乎不引用它们，
# 放宽只会引入误报。
PATH_SUFFIXES = {".md", ".txt", ".yml", ".yaml", ".py", ".css", ".js"}

# 反引号跨度
BACKTICK_RE = re.compile(r"`([^`\n]+)`")

# 目录清单：做 basename 兜底查找时跳过
SKIP_DIRS = {".git", "site", ".cache", "__pycache__", "node_modules", ".venv"}


def build_basename_index() -> dict[str, list[Path]]:
    """建立 {文件名: [相对路径, ...]}，用于解析 `roadmap.md` 这类裸文件名。"""
    index: dict[str, list[Path]] = {}
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        index.setdefault(path.name, []).append(path.relative_to(ROOT))
    return index


def looks_like_path(token: str) -> bool:
    """判断一个反引号跨度是不是路径引用。"""
    t = token.strip()
    if not t or " " in t or "\n" in t:
        return False
    if t.startswith(("http://", "https://", "www.")):
        return False
    # 含占位符或尖括号、花括号模板 → 不是具体路径
    if any(ch in t for ch in "<>{}[]()"):
        return False
    if t.startswith("-") or t.startswith("python "):
        return False
    # 尾随 glob：content/entries/*.md
    if t.endswith("/*.md"):
        return True
    if "*" in t or "?" in t:
        return False
    # 去掉行号写法 file.py:12
    t = re.sub(r":\d+(-\d+)?$", "", t)
    if "/" in t:
        return Path(t).suffix in PATH_SUFFIXES
    return Path(t).suffix in PATH_SUFFIXES


def resolve(token: str, basename_index: dict[str, list[Path]]) -> tuple[str, str]:
    """把路径 token 解析到仓库内的真实位置。

    返回 (状态, 说明)：状态 ∈ {ok, missing, ambiguous}
    """
    t = token.strip().lstrip("./")
    if t.endswith("/*.md"):
        parent = t[: -len("/*.md")].lstrip("./")
        candidate_dirs = [ROOT / parent, ROOT / "content" / parent]
        for d in candidate_dirs:
            if d.is_dir() and any(d.glob("*.md")):
                return "ok", str(d.relative_to(ROOT)).replace("\\", "/")
        return "missing", f"目录不存在或其中无 .md：{parent}"

    t = re.sub(r":\d+(-\d+)?$", "", t)

    # ① 相对仓库根
    if (ROOT / t).exists():
        return "ok", t
    # ② 相对 content/（手册常省略 content/ 前缀，如 docs/mechanics.md）
    if (ROOT / "content" / t).exists():
        return "ok", "content/" + t

    # ③ basename 兜底（roadmap.md / citation.md）
    hits = basename_index.get(Path(t).name, [])
    if len(hits) == 1:
        return "ok", str(hits[0]).replace("\\", "/")
    if len(hits) > 1:
        shown = "、".join(str(h).replace("\\", "/") for h in sorted(hits))
        return "ambiguous", f"同名文件 {len(hits)} 个：{shown}"
    return "missing", t


def workflow_text() -> str:
    """把所有 workflow 拼成一份文本，用于门禁断言。"""
    chunks = []
    for wf in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        chunks.append(f"# === {wf.name} ===\n{wf.read_text(encoding='utf-8')}")
    return "\n".join(chunks)


def scheduled_workflow_text() -> str:
    """只拼「带 schedule 触发器」的 workflow —— 巡检类脚本的判据。"""
    chunks = []
    for wf in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        text = wf.read_text(encoding="utf-8")
        # 认 `schedule:` 出现在触发器区（缩进 0–2 格的键）
        if re.search(r"^\s{0,2}schedule:", text, re.M):
            chunks.append(f"# === {wf.name} ===\n{text}")
    return "\n".join(chunks)


def parse_gate_claims(text: str) -> list[tuple[str, str, str]]:
    """从 skill 的表格里解析「是否阻断部署」声明。

    解析到的行形如：
        | `scripts/check-freshness.py` | ... | 否（信息性，恒返回 0） |
        | `scripts/check_entries.py`   | ... | 是（CI 部署前置） |
        | `scripts/check_drift.py`     | ... | 巡检（定时 job 调用，不阻断部署） |

    返回 [(脚本路径, 类型, 原始声明文本)]，类型 ∈ {gate, info, patrol}
    """
    claims: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        script_cell = cells[0]
        m = re.search(r"`(scripts/[\w./-]+\.py)`", script_cell)
        if not m:
            continue
        verdict = cells[-1]
        if verdict.startswith("是"):
            claims.append((m.group(1), "gate", verdict))
        elif verdict.startswith("否"):
            claims.append((m.group(1), "info", verdict))
        elif verdict.startswith(("巡", "定时")):
            claims.append((m.group(1), "patrol", verdict))
    return claims


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"找不到 {SKILLS_DIR} —— 无可校验内容")
        return 0

    skill_files = sorted(SKILLS_DIR.glob("*/SKILL.md"))
    if not skill_files:
        print(f"{SKILLS_DIR} 下没有任何 SKILL.md")
        return 1

    basename_index = build_basename_index()
    wf_text = workflow_text()
    sched_text = scheduled_workflow_text()

    errors: list[str] = []
    checked_paths = 0
    ok_paths = 0

    print("一致性校验：.agent/skills/ 声明 vs 仓库实际")
    print("=" * 62)

    for skill in skill_files:
        rel = str(skill.relative_to(ROOT)).replace("\\", "/")
        text = skill.read_text(encoding="utf-8")
        print(f"\n【{rel}】")

        # ---- A 类：路径断言 ----
        tokens: list[str] = []
        for m in BACKTICK_RE.finditer(text):
            tok = m.group(1)
            if looks_like_path(tok) and tok not in tokens:
                tokens.append(tok)

        if not tokens:
            print("  · 未发现路径引用")
        for tok in tokens:
            checked_paths += 1
            status, detail = resolve(tok, basename_index)
            if status == "ok":
                ok_paths += 1
                note = f" → {detail}" if detail != tok.strip().lstrip("./") else ""
                print(f"  ✓ {tok}{note}")
            elif status == "ambiguous":
                errors.append(f"{rel}：`{tok}` 解析不唯一 —— {detail}")
                print(f"  ！ {tok}  歧义：{detail}")
            else:
                errors.append(f"{rel}：`{tok}` 不存在（{detail}）")
                print(f"  ✗ {tok}  找不到")

        # ---- B 类：门禁断言 ----
        claims = parse_gate_claims(text)
        if claims:
            print("  · 门禁声明核对：")
        for script, kind, raw in claims:
            in_ci = script in wf_text
            in_sched = script in sched_text
            if kind == "gate":
                if not in_ci:
                    errors.append(
                        f"{rel}：声明 `{script}` 是 CI 门禁（「{raw}」），"
                        f"但没有任何 workflow 调用它 —— 声明已失效"
                    )
                    print(f"    ✗ {script}  声明「{raw}」但 CI 未调用")
                else:
                    print(f"    ✓ {script}  「{raw}」 —— 与 workflow 一致（已在 CI 调用）")
            elif kind == "info":
                if in_ci:
                    errors.append(
                        f"{rel}：声明 `{script}` 非门禁（「{raw}」），"
                        f"但它出现在 workflow 里 —— 声明已失效"
                    )
                    print(f"    ✗ {script}  声明「{raw}」但 CI 已在调用")
                else:
                    print(f"    ✓ {script}  「{raw}」 —— 与 workflow 一致（未接入 CI）")
            else:  # patrol —— 巡检类：必须出现在带 schedule 的 workflow 里
                if not in_sched:
                    errors.append(
                        f"{rel}：声明 `{script}` 是定时巡检（「{raw}」），"
                        f"但没有任何带 schedule 触发器的 workflow 调用它 —— "
                        f"巡检脚本不进定时任务，等于永远不会跑"
                    )
                    print(f"    ✗ {script}  声明「{raw}」但没有定时 workflow 调用它")
                else:
                    print(f"    ✓ {script}  「{raw}」 —— 与 workflow 一致（已在定时巡检中调用）")

    print("\n" + "=" * 62)
    print(f"扫描 skill：{len(skill_files)} 个 ｜ 路径断言：{ok_paths}/{checked_paths} 通过")
    if errors:
        print(f"\n发现 {len(errors)} 处不一致：\n")
        for i, e in enumerate(errors, 1):
            print(f"  {i}. {e}")
        print(
            "\n说明：手册与实现不一致时，智能体会照着旧手册去读不存在的文件，"
            "\n      然后安静地跳过 —— 这正是「检查器失效时，世界是静默的」那一类故障。"
        )
        return 1
    print("全部通过：手册里引用的路径与门禁声明都与仓库实际一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
