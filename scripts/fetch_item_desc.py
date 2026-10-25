"""抓物品的中文名与描述，落成一份**只含文本**的快照（A2 证据的回源数据）。

为什么单独一个文件
------------------
`items_full.json` 是 19 MB 的数值缓存、且被 .gitignore 忽略（CI 每次重抓）；
战区纪事的 A2 级证据（物品描述）要能**在离线与 CI 里逐字回源校验**，
所以需要一份入库的、体积可控的文本快照。

口径
----
* 上游：`json.tarkov.dev/regular/items_zh`（**二级**），只抽 `<id> Name` / `<id> Description`；
* 不含 UI 文案（原文件 16,933 个键里大半是界面字符串，与证据无关）；
* `fetched` 日期参与 llms.txt「最后更新」的一致性校验，见 check_entries.py 第 12 项。

用法
----
    python scripts/fetch_item_desc.py            # 抓取并写入
    python scripts/fetch_item_desc.py --check    # 只报告远端是否比本地新（不写盘）
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "item_desc_zh.json"
URL = "https://json.tarkov.dev/regular/items_zh"
# json.tarkov.dev 会 403 掉浏览器 UA（实测见 check_drift.py 的同一条注释）
UA = "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)"


def fetch() -> dict:
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    data = payload.get("data") if isinstance(payload, dict) else payload
    names, descs = {}, {}
    for k, v in data.items():
        if k.endswith(" Name"):
            names[k[:-5]] = v
        elif k.endswith(" Description"):
            descs[k[:-12]] = v
    items = {
        i: {"name": names.get(i, ""), "desc": d}
        for i, d in descs.items()
        if d and names.get(i)
    }
    return {
        "fetched": date.today().isoformat(),
        "source": "json.tarkov.dev/regular/items_zh（二级）",
        "note": "只保留有描述的物品；key 为游戏内物品 id。",
        "count": len(items),
        "items": items,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    doc = fetch()
    print(f"远端可抓: {doc['count']} 件（{doc['fetched']}）")
    if args.check:
        old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        if not old:
            print("[缺] 本地没有快照")
            return 1
        diff = set(old.get("items", {})) ^ set(doc["items"])
        print(f"本地: {old.get('count')} 件 / 抓取日 {old.get('fetched')}；id 差异 {len(diff)}")
        return 0 if not diff else 1
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"写入 {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
