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
# otxt 紧跟 oids：两者**同序等长**，前端按下标配对。
COLS = ["name", "en", "trader", "level", "ms", "oids", "otxt", "nObj", "keys", "flags"]


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
        # oids 与 otxt 必须由**同一份过滤结果**生成，否则目标一多就会错位
        # （上游偶有目标缺 id）。
        pairs = [o for o in objs if o.get("id")]
        oids = [o.get("id") for o in pairs]
        # 目标文本用 | 连接而不是数组：500 个任务各来一个数组，光引号方括号就多 8 KB。
        # 实测 1418 条目标文本里没有一条含 |（2026-10-18），但仍把竖线换成全角作防御 ——
        # 万一上游哪天塞了 |，前端 split 会整行错位，而且**不会报错**，最难查。
        otxt = "|".join((o.get("text") or "").strip().replace("|", "｜")
                        for o in pairs)
        nodes[t["id"]] = [
            t.get("name") or "",
            t.get("en") or "",
            t.get("trader") or "",
            t.get("level") or 0,
            task_map_keys(t),
            oids,
            otxt,
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

    # ── 首页精简版：只留「哪张图上有哪些任务」需要的四列 ────────────────
    # 首页的作战台只做三件事：按图列任务、看还有几个没做、一键勾完成。
    # 目标的 id 与文本（otxt/oids，全份 110 KB）在那里一点用都没有 ——
    # 打包进去等于让每个首页访客为「不看的字」付流量。
    # 实测：完整索引 150 KB → 精简版 40 KB（gzip 11 KB）。
    lite = {qid: [n[0], n[2], n[3], n[4]] for qid, n in nodes.items() if n[4]}
    lite_body = json.dumps({
        "mode": mode,
        "baseline": baseline_label(),
        "total": len(nodes),
        "cols": ["name", "trader", "level", "ms"],
        "tasks": lite,
    }, ensure_ascii=False, separators=(",", ":"))
    lite_out = OUT_DIR / f"ops-lite-{mode}.js"
    lite_out.write_text(
        header.replace("作战台任务索引", "首页作战台精简索引")
        + f"window.TARKOV_OPS_LITE_{mode.upper()} = {lite_body};\n",
        encoding="utf-8")
    lite_size = lite_out.stat().st_size / 1024
    print(f"已写 {out.relative_to(ROOT)}（{size:.0f} KB，{len(nodes)} 个任务）")
    print(f"已写 {lite_out.relative_to(ROOT)}（{lite_size:.0f} KB，{len(lite)} 条" 
          f"带地图的任务）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="作战台任务索引生成器")
    ap.add_argument("--mode", choices=["pvp", "pve"], default="pvp")
    args = ap.parse_args()
    return build(args.mode)


if __name__ == "__main__":
    sys.exit(main())
