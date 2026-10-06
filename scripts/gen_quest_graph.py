"""任务前置树（边表）抓取器。

    python scripts/gen_quest_graph.py --fetch

为什么要单独抓一张边表：
    `scripts/data/quests.json` 是给**页面渲染**用的精简缓存 —— 里面的 `prereqs`
    只留了「前置任务的中文名 / 商人 / 状态」，**故意丢掉了前置任务的 id**
    （页面只需要名字）。但「按前置树反推已完成」必须靠 id 连边。

    能不能靠名字连边？**不能**：实测 515 个任务里有 **10 个名字是重复的**
    （涉及 23 条记录，例如「破镜重圆 ×3」「新起点 ×4」），按名字连边会连错。
    所以单独抓一份只含 id 的边表，与渲染用的缓存解耦。

产物：scripts/data/quest-graph.json
    { fetched, source, gameMode, statusVocab, edgeCount, objCount,
      edges:    { <任务id>: [[<前置id>, ["complete"]], …] },
      objectives: { <任务id>: [<目标id>, …] } }

**对账（本脚本存在的一半理由）**：抓到的 id 集合必须与 quests.json 的 id 集合
**完全相等**，且**逐任务的目标数也要相等**。两者不等说明数据端点已更新、而站内
缓存还是旧的 —— 那种情况下边表里有 id 在页面里找不到，反推出来的「已完成」
会指向不存在的任务；而目标 id 会与页面上的目标对不上号。
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_quests as g  # noqa: E402  复用 API / HEADERS / DATA_FILE

OUT_FILE = g.ROOT / "scripts" / "data" / "quest-graph.json"


def fetch() -> int:
    print("抓取中（tasks 端点，约 2 MB）…")
    raw = g.get("tasks")["data"]["tasks"]
    tasks = list(raw.values()) if isinstance(raw, dict) else raw

    edges: dict[str, list] = {}
    objectives: dict[str, list] = {}
    vocab: Counter = Counter()
    edge_n = 0
    obj_n = 0
    for t in tasks:
        tid = t.get("id")
        if not tid:
            continue
        reqs = []
        for r in t.get("taskRequirements") or []:
            pid = r.get("task")
            if not pid:
                continue
            st = r.get("status") or []
            if isinstance(st, str):
                st = [st]
            st = sorted({s for s in st if s})
            for s in st:
                vocab[s] += 1
            reqs.append([pid, st])
            edge_n += 1
        if reqs:
            edges[tid] = reqs

        # 目标 id：顺带做目标级追踪的稳定键。
        # 顺序必须与渲染缓存里 objectives 的顺序一致 —— 下面逐任务核对条数。
        objs = [o.get("id") for o in (t.get("objectives") or []) if o.get("id")]
        if objs:
            objectives[tid] = objs
            obj_n += len(objs)

    payload = {
        "fetched": date.today().isoformat(),
        "source": "json.tarkov.dev/regular/tasks（官方数据端点，二级）",
        "gameMode": "regular（持久 PvP）",
        "statusVocab": dict(vocab.most_common()),
        "edgeCount": edge_n,
        "objCount": obj_n,
        "edges": edges,
        "objectives": objectives,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=False),
                        encoding="utf-8", newline="\n")
    print(f"已写 {OUT_FILE.relative_to(g.ROOT)}：{len(edges)} 个任务有前置、共 {edge_n} 条边；"
          f"{len(objectives)} 个任务有目标、共 {obj_n} 个目标")
    print(f"  状态词表：{dict(vocab.most_common())}")

    # —— 对账：两边 id 集合必须完全相等 ——
    cache = json.loads(g.DATA_FILE.read_text(encoding="utf-8"))
    cache_ids = {x["id"] for x in cache["tasks"]}
    new_ids = {t["id"] for t in tasks}
    only_cache = sorted(cache_ids - new_ids)
    only_new = sorted(new_ids - cache_ids)
    if only_cache or only_new:
        print("[错误] 边表与渲染缓存对不上：", file=sys.stderr)
        if only_cache:
            print(f"  · 只有缓存里有（{len(only_cache)} 个）：{only_cache[:3]}", file=sys.stderr)
        if only_new:
            print(f"  · 只有新抓的有（{len(only_new)} 个）：{only_new[:3]}", file=sys.stderr)
        print("  处理：数据端点已更新。先跑 `gen_quests.py --fetch` 重建渲染缓存"
              "（页面会跟着重建），再重跑本脚本。", file=sys.stderr)
        return 1

    # —— 对账：逐任务的目标数必须与渲染缓存相等 ——
    cache_obj = {x["id"]: len(x.get("objectives") or []) for x in cache["tasks"]}
    bad = []
    for t in tasks:
        tid = t["id"]
        if cache_obj.get(tid, 0) != len(objectives.get(tid) or []):
            bad.append(f"{tid}({cache_obj.get(tid,0)} vs {len(objectives.get(tid) or [])})")
    if bad:
        print(f"[错误] {len(bad)} 个任务的目标数与渲染缓存不一致，"
              f"目标级追踪的键会对错号：{bad[:3]}", file=sys.stderr)
        print("  处理：跑 `gen_quests.py --fetch` 重建缓存后重跑本脚本。", file=sys.stderr)
        return 1
    print(f"对账通过：id 集合完全一致（{len(new_ids)}），"
          f"逐任务目标数一致（共 {obj_n} 个），无断边。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="任务前置树（边表）抓取器")
    ap.add_argument("--fetch", action="store_true", help="从 json.tarkov.dev 抓取并写边表")
    a = ap.parse_args()
    if not a.fetch:
        print("用法：python scripts/gen_quest_graph.py --fetch", file=sys.stderr)
        return 1
    return fetch()


if __name__ == "__main__":
    raise SystemExit(main())
