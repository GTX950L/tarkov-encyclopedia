#!/usr/bin/env python3
"""作战台任务索引生成器 —— 从 quests_{mode}.json 出**一份精简索引**。

为什么不用现成的 quests-graph.js（75 KB）
------------------------------------------
那份是给「任务树 + 可接判定」用的：前置边、门槛 gates、页内链接锚点。
作战台的右栏只要「这张图上有哪些活、每条做什么、目标到第几个、缺什么」，
前置与门槛原来用不上 —— 但 2026-10-21 的改版把它用上了（v1.145.0）：
「这一票为什么还接不了」是选任务时最常问的一句，所以索引补了 **pr（前置）** 一列。
只补 id、不补状态说明：状态是四种（完成 / 进行中 / 失败 / 二者皆可），
前端只按「必须完成」判，其余三种不进 pr（口径写在 build() 里）。

体积：PvE 500 条约 60 KB（vs quests-graph 的 75 KB），加 pr 后约 65 KB。

⚠️ **flags（Kappa / Lightkeeper）改从任务自身取**（2026-10-21）：
   旧实现读 quest-graph.json 的 `nodes`，而那份文件**根本没有 nodes 键**
   （只有 edges / objectives）—— 于是 flags 一直是空串，前端也从没显示过。
   现在直接读 quests_{mode}.json 的 `kappa` / `lightkeeper` 布尔字段
   （PvP 13 条 Kappa、PvE 13 条，Lightkeeper 当前 0 条）。

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
# pr 放最后：新增列只追加、不插队，旧前端读到 undefined 时当作「无前置」，
# 不会因为下标前移而把钥匙数当成前置列表。
COLS = ["name", "en", "trader", "level", "ms", "oids", "otxt", "nObj", "keys", "flags", "pr"]


def load_prereqs(tasks: list[dict]) -> dict[str, list[str]]:
    """任务前置 → {qid: [前置 id, …]}，**只收「必须完成」那一档**。

    口径（2026-10-21 实测 222 条边）：
      · status 为空 —— 195 条，必须完成 → 收；
      · 「只要处于进行中」12 条 / 「只要求失败过」2 条 / 「完成或失败皆可」3 条 /
        「完成或进行中」10 条 —— 不是「完成才算」，一律不收。
    不把这些混进 pr，是为了让前端的「缺前置 N 个」只反映**真的没做完**，
    而不是把「先接取即可」也报成缺。

    ⚠️ prereqs 里只给 `name` + `trader`，**没有 id**；而且 trader 是首字母大写
       （`Mechanic`），任务表里是小写（`mechanic`）—— 拿 (name, trader) 当键会**全 miss**
       （2026-10-21 实测 0/222 命中）。这里只按 name 建索引：503 条任务里没有重名，
       命中率 195/195。
    """
    by_name: dict[str, str] = {}
    for t in tasks:
        nm = (t.get("name") or "").strip()
        if nm:
            by_name.setdefault(nm, t["id"])

    out: dict[str, list[str]] = {}
    for t in tasks:
        pres: list[str] = []
        for p in (t.get("prereqs") or []):
            if (p.get("status") or "").strip():
                continue
            pid = by_name.get((p.get("name") or "").strip())
            if pid:
                pres.append(pid)
        if pres:
            out[t["id"]] = pres
    return out


def flag_of(t: dict) -> str:
    """Kappa=k / Lightkeeper=l（两者都有的极端情况取 k，前端只画一个角标）。"""
    if t.get("kappa"):
        return "k"
    if t.get("lightkeeper"):
        return "l"
    return ""


def build(mode: str) -> int:
    src = ROOT / "scripts" / "data" / f"quests_{mode}.json"
    if not src.exists():
        src = ROOT / "scripts" / "data" / "quests.json"
        if mode != "pvp":
            print(f"[错误] 找不到 {src}", file=sys.stderr)
            return 1
    payload = json.loads(src.read_text(encoding="utf-8"))
    tasks = payload.get("tasks") or []
    pres = load_prereqs(tasks)

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
            flag_of(t),
            pres.get(t["id"], []),
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
        "   flags 列（Kappa=k / Lightkeeper=l）取自任务自身的 kappa / lightkeeper 字段；\n"
        "   pr 列是「必须完成」类前置的任务 id —— 上游 prereqs 里 status 为空的那一批，\n"
        "   另有 27 条「进行中 / 失败」类特殊条件**不进这一列**（口径见脚本 docstring）。 */\n"
    )
    out = OUT_DIR / f"ops-index-{mode}.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ 全局名**必须带模式后缀**：两模式的索引可能同时存在于同一页（切模式时
    #    会再 load 一次），同名会互相覆盖；而 ops-board.js 是按
    #    TARKOV_OPS_INDEX_<MODE> 取的。2026-10-18 实测：写成无后缀 → 前端读不到，
    #    右栏永远空、还看不出报错（脚本加载成功、只是名字对不上）。
    gname = f"TARKOV_OPS_INDEX_{mode.upper()}"
    # LF，不是平台默认：`.gitattributes` 对 content/javascripts/*.js 声明了 eol=lf。
    out.write_text(header + f"window.{gname} = {body};\n", encoding="utf-8", newline="\n")
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
        encoding="utf-8", newline="\n")
    lite_size = lite_out.stat().st_size / 1024
    print(f"已写 {out.relative_to(ROOT)}（{size:.0f} KB，{len(nodes)} 个任务）")
    print(f"  其中带前置的 {len(pres)} 条（前置 id 共 {sum(len(v) for v in pres.values())} 个）"
          f"、带 Kappa/Lightkeeper 标记的 "
          f"{sum(1 for n in nodes.values() if n[9])} 条")
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
