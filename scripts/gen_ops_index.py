#!/usr/bin/env python3
"""作战台任务索引生成器 —— 从 quests_{mode}.json 出**一份精简索引**。

为什么不用现成的 quests-graph.js（75 KB）
------------------------------------------
那份是给「任务树 + 可接判定」用的：前置边、门槛 gates、页内链接锚点。
作战台的右栏只要「这张图上有哪些活、每条做什么、目标到第几个、缺什么」，
前置与门槛用不上。为了它再抓一份 quest-graph（PvE 的 edges/objectives）
是多余的活，所以这里直接读已经有的精简任务文件，**只取右栏真正要用的列**。

体积：PvE 500 条约 60 KB（vs quests-graph 的 75 KB），且不引入新依赖。

⚠️ **flags（Kappa / Lightkeeper）从 PvP 的 quest-graph.json 继承**：那两条线
   是**同一套任务**（477 条共有任务里绝大多数 Kappa 任务都在两边），上游没给
   PvE 专属的标记。查不到的（PvE 专属的 23 条）就没有 flags，不编。

产物：content/javascripts/ops-index-<mode>.js
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _baseline import baseline_label  # noqa: E402
from _map_links import task_map_keys  # noqa: E402

OUT_DIR = ROOT / "content" / "javascripts"
# 列顺序写在这里，客户端按下标读 —— 紧凑格式的代价就是这一句必须准确。
COLS = ["name", "en", "trader", "level", "ms", "oids", "nObj", "keys", "flags"]


def load_flags() -> dict[str, str]:
    """从 PvP 的 quest-graph.json 借 flags（Kappa=k / Lightkeeper=l）。"""
    src = ROOT / "scripts" / "data" / "quest-graph.json"
    out: dict[str, str] = {}
    if not src.exists():
        return out
    raw = json.loads(src.read_text(encoding="utf-8"))
    for qid, node in (raw.get("nodes") or {}).items():
        if isinstance(node, list) and len(node) > 4 and node[4]:
            out[qid] = node[4]
    return out


def build(mode: str) -> int:
    src = ROOT / "scripts" / "data" / f"quests_{mode}.json"
    if not src.exists():
        src = ROOT / "scripts" / "data" / "quests.json"
        if mode != "pvp":
            print(f"[错误] 找不到 {src}", file=sys.stderr)
            return 1
    payload = json.loads(src.read_text(encoding="utf-8"))
    tasks = payload.get("tasks") or []
    flags = load_flags()

    nodes: dict[str, list] = {}
    for t in tasks:
        objs = t.get("objectives") or []
        oids = [o.get("id") for o in objs if o.get("id")]
        nodes[t["id"]] = [
            t.get("name") or "",
            t.get("en") or "",
            t.get("trader") or "",
            t.get("level") or 0,
            task_map_keys(t),
            oids,
            len(objs),
            len(t.get("keys") or []),
            flags.get(t["id"], ""),
        ]

    body = json.dumps({
        "mode": mode,
        "baseline": baseline_label(),
        "fetched": payload.get("fetched") or "",
        "total": len(nodes),
        "cols": COLS,
        "tasks": nodes,
    }, ensure_ascii=False, separators=(",", ":"))

    header = (
        "/* 由 scripts/gen_ops_index.py 生成，请勿手工编辑。\n"
        f"   作战台任务索引 · {mode} ｜ 列：{' / '.join(COLS)}\n"
        f"   站点基线：{baseline_label()} ｜ 数据来源：json.tarkov.dev/{mode}/tasks\n"
        "   flags 列（Kappa=k / Lightkeeper=l）继承自 PvP 的 quest-graph.json ——\n"
        "   上游未给 PvE 专属标记，PvE 独占的 23 条没有 flags，留空不编。 */\n"
    )
    out = OUT_DIR / f"ops-index-{mode}.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ 全局名**必须带模式后缀**：两模式的索引可能同时存在于同一页（切模式时
    #    会再 load 一次），同名会互相覆盖；而 ops-board.js 是按
    #    TARKOV_OPS_INDEX_<MODE> 取的。2026-10-18 实测：写成无后缀 → 前端读不到，
    #    右栏永远空、还看不出报错（脚本加载成功、只是名字对不上）。
    gname = f"TARKOV_OPS_INDEX_{mode.upper()}"
    out.write_text(header + f"window.{gname} = {body};\n", encoding="utf-8")
    size = out.stat().st_size / 1024
    print(f"已写 {out.relative_to(ROOT)}（{size:.0f} KB，{len(nodes)} 个任务）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="作战台任务索引生成器")
    ap.add_argument("--mode", choices=["pvp", "pve"], default="pvp")
    args = ap.parse_args()
    return build(args.mode)


if __name__ == "__main__":
    sys.exit(main())
