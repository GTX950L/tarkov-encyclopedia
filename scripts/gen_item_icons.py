#!/usr/bin/env python3
"""下载任务相关物品的官方图标，并生成前端「物品名 → 图标」映射。

为什么单独一支、**不进 build_all / check_gen_drift**（与 gen_map_thumbs.py 同一条理由）
--------------------------------------------------------------------------
  ① 它要联网抓 ``assets.tarkov.dev``，不是离线确定性的；
  ② 全量抓一遍要一两分钟。
  **任务数据（quests.json / items_index.json）重跑后，要跟着手动重跑一次** ——
  那时新增的任务物品才会有图标。漏跑的后果仅是「新物品没有图标」
  （前端 onerror 兜底成不显示），不会破版，也不该让门禁变红。

数据源（前两份离线；第三份实时，抓失败就退化成「只下前两份能解析的」）
--------------------------------------------------------------------------
  scripts/data/items_index.json    833 种任务物品名 + pages（名 → [图鉴页, 物品id]）
  scripts/data/items_full.json     官方全量物品（id → iconLink）
  json.tarkov.dev/regular/tasks    任务专属道具表 questItems（id → iconLink + 译名键），
  + tasks_zh                      补 pages 对不上的那批（「水泵运行数据」这类，
                                  译名在 tasks_zh 里，不在物品译文表里）

产物
----
  content/assets/items/icons/<24位物品id>.webp   官方图标（64×64 WebP 无损，1~3KB）
  content/javascripts/item-icons.js             物品中文名 → id（前端按名查图标文件）

三条硬规矩
--------
  ① **占位图不算图标**：官方给无图标物品返回 ``unknown-item-icon.jpg``（JPEG）。
     按内容魔数识别，命中即跳过、不入映射 —— 否则读者看到的是同一张问号图。
  ② **拿不准的名字宁可没有**：译名撞车（多个 id 同名）或查不到 id 的名字
     **不进映射**，与站内「重名走搜索、任务专属不给链接」是同一条规矩。
  ③ **幂等**：图标已存在就跳过下载，只补缺的；重跑不会把已抓的再抓一遍。

用法
----
    python scripts/gen_item_icons.py            # 全量（补缺 + 重建映射）
    python scripts/gen_item_icons.py --dry-run  # 只解析与统计，不下载、不写盘
    python scripts/gen_item_icons.py --limit 5  # 只处理前 5 个名字（冒烟测试）
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"
ITEMS_INDEX = DATA / "items_index.json"
ITEMS_FULL = DATA / "items_full.json"
ICONS_DIR = ROOT / "content" / "assets" / "items" / "icons"
OUT_JS = ROOT / "content" / "javascripts" / "item-icons.js"

API = "https://json.tarkov.dev/regular/"
# ⚠️ UA 用浏览器串：官方 CDN（assets.tarkov.dev）对脚本默认 UA 会 403，
#    本会话实测浏览器 UA 9/9 全部 200。json.tarkov.dev 两个端点不带这些头也能抓。
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/131.0.0.0 Safari/537.36"),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}
WORKERS = 8
TIMEOUT = 20
RETRIES = 2

# WebP：``RIFF....WEBP``；官方占位图是 JPEG（``FF D8 FF``）
WEBP_MAGIC = b"RIFF"
JPEG_MAGIC = b"\xff\xd8\xff"


def load_json(path: Path):
    if not path.exists():
        sys.exit(f"[错误] 找不到 {path.relative_to(ROOT)} —— 先跑上游生成器。")
    return json.loads(path.read_text(encoding="utf-8"))


def http_get(url: str, headers: dict | None = None) -> bytes:
    """带重试的 GET；失败抛异常（调用方决定降级路径）。"""
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers or HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, OSError) as exc:  # noqa: PERF203
            last = exc
    raise RuntimeError(f"GET 失败（重试 {RETRIES} 次）：{url}｜{last}")


# ---------------------------------------------------------------- 名字 → id 解析

def resolve_names() -> tuple[dict[str, str], dict[str, str], list[str]]:
    """返回 (名字→id,  id→图标URL,  跳过的名字及原因)。

    两个来源，pages 优先（图鉴里的「真物品」），questItems 只补缺口：
      · pages        —— item_pages.json 的精确匹配（711 个）
      · questItems   —— 任务专属道具表（92 个），译名来自 tasks_zh
    """
    idx = load_json(ITEMS_INDEX)
    full = load_json(ITEMS_FULL)
    full_items = full["items"]["items"]
    pages = idx.get("pages") or {}
    names = list((idx.get("items") or {}).keys())

    name2id: dict[str, str] = {}
    icon_of: dict[str, str] = {}
    skipped: list[str] = []

    # ① pages 精确匹配
    for name, p in pages.items():
        if not p or len(p) < 2:
            continue  # None = 图鉴重名，按站内规矩不给链接，也不给图标
        iid = p[1]
        it = full_items.get(iid)
        if not it or not it.get("iconLink"):
            skipped.append(f"{name}（pages 有 id 但物品库里没有图标链接）")
            continue
        name2id[name] = iid
        icon_of[iid] = it["iconLink"]

    # ② 任务专属道具：pages 里完全没有的名字（833 − 711 − 11 重名 = 111）
    dup_names = {n for n, v in pages.items() if v is None}
    gap = [n for n in names if n not in name2id and n not in dup_names]
    quest_items = fetch_quest_items()
    if quest_items is None:
        for n in gap:
            skipped.append(f"{n}（任务数据抓取失败，未解析）")
    else:
        cn2ids: dict[str, set[str]] = {}
        for qid, v in quest_items.items():
            nm = v.get("_cn")
            if nm:
                cn2ids.setdefault(nm, set()).add(qid)
        for n in gap:
            ids = cn2ids.get(n) or set()
            if len(ids) == 1:
                qid = next(iter(ids))
                name2id[n] = qid
                icon_of[qid] = quest_items[qid]["iconLink"]
            elif len(ids) > 1:
                skipped.append(f"{n}（{len(ids)} 个任务道具同名，不猜）")
            else:
                skipped.append(f"{n}（任务道具表里查不到）")

    # 占位图链接直接剔除（有的物品 iconLink 本身就是 unknown-item-icon.jpg）
    for name, iid in list(name2id.items()):
        if "unknown-item-icon" in icon_of.get(iid, ""):
            del name2id[name]
            skipped.append(f"{name}（官方无图标，iconLink 是占位图）")

    return name2id, icon_of, skipped


def fetch_quest_items() -> dict | None:
    """抓 tasks + tasks_zh，返回 questItem id → {iconLink, _cn}；失败返回 None。"""
    try:
        tasks = json.loads(http_get(API + "tasks").decode("utf-8"))["data"]
        tz = json.loads(http_get(API + "tasks_zh").decode("utf-8"))["data"]
    except (RuntimeError, ValueError, KeyError) as exc:
        print(f"  ⚠️ 任务数据抓取失败（{exc}）—— 只解析 pages 能对上的部分。")
        return None
    out = {}
    for qid, v in (tasks.get("questItems") or {}).items():
        cn = tz.get(v.get("name") or "")
        if v.get("iconLink") and cn:
            out[qid] = {"iconLink": v["iconLink"], "_cn": cn}
    print(f"  任务道具表：{len(out)} 条（带图标链接且有中文译名）")
    return out


# ------------------------------------------------------------------------ 下载

def fetch_icon(iid: str, url: str) -> tuple[str, bytes | None, str]:
    """下载一个图标。返回 (id, 内容或 None, 状态)。"""
    dest = ICONS_DIR / f"{iid}.webp"
    if dest.exists() and dest.stat().st_size > 0:
        return iid, None, "exists"
    try:
        body = http_get(url)
    except RuntimeError as exc:
        return iid, None, f"fail:{exc}"
    if body[:3] == JPEG_MAGIC:
        return iid, None, "placeholder"   # 官方占位图，不当图标
    if body[:4] != WEBP_MAGIC or body[8:12] != b"WEBP":
        return iid, None, "fail:内容不是 WebP"
    return iid, body, "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description="下载任务物品官方图标并生成名字→id 映射")
    ap.add_argument("--dry-run", action="store_true",
                    help="只解析与统计，不下载、不写盘")
    ap.add_argument("--limit", type=int, default=0,
                    help="只处理前 N 个名字（冒烟测试用；0 = 全部）")
    args = ap.parse_args()

    print("解析物品名 → id …")
    name2id, icon_of, skipped = resolve_names()
    items = sorted(name2id.items())
    if args.limit:
        items = items[: args.limit]
    print(f"  可解析 {len(name2id)} 个名字，本次处理 {len(items)} 个；"
          f"跳过 {len(skipped)} 个（原因见 --dry-run 输出）")

    if args.dry_run:
        for s in skipped:
            print(f"    · 跳过：{s}")
        print(f"\n（dry-run）将下载 {len(items)} 个图标到 "
              f"{ICONS_DIR.relative_to(ROOT)}/")
        return 0

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    stats = {"ok": 0, "exists": 0, "placeholder": 0}
    failures: list[str] = []
    # 同名 id 只抓一次（两个中文名指向同一件物品时会出现）
    todo = sorted({iid: icon_of[iid] for _, iid in items}.items())
    processed: set[str] = set()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for iid, body, st in pool.map(lambda a: fetch_icon(*a), todo):
            processed.add(iid)
            if st == "ok":
                (ICONS_DIR / f"{iid}.webp").write_bytes(body)
                stats["ok"] += 1
            elif st == "exists":
                stats["exists"] += 1
            elif st == "placeholder":
                stats["placeholder"] += 1
                # 映射里剔除：没有真图标的名字不写进 item-icons.js
                name2id = {n: i for n, i in name2id.items() if i != iid}
            else:
                failures.append(f"{iid}｜{st}")
                name2id = {n: i for n, i in name2id.items() if i != iid}

    # ── 前端映射：只含**这次磁盘上确定有图标**的名字 ──────────────
    # 排序后落盘，重跑内容稳定（git diff 干净）；日期取数据自己的抓取日，
    # 不用 today() —— 否则每天重跑都产生无意义 diff。
    # ⚠️ --limit 冒烟测试时也要按「本次处理过的 id」过滤，否则映射会包含
    #    根本没下载的名字。
    name2id = {n: i for n, i in name2id.items() if i in processed}
    idx = load_json(ITEMS_INDEX)
    fetched = idx.get("fetched") or "—"
    payload = json.dumps(name2id, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"))
    OUT_JS.write_text(
        "/* 自动生成，请勿手改 —— 由 scripts/gen_item_icons.py 生成。\n"
        "   物品中文名 → 官方图标 id；图标文件在同级 ../assets/items/icons/<id>.webp。\n"
        "   任务数据（quests.json / items_index.json）重跑后要重跑该脚本，\n"
        "   新物品才会有图标（漏跑只是没有图标，不会破版）。\n"
        "   数据抓取日 " + fetched + " */\n"
        "window.TARKOV_ITEM_ICONS = " + payload + ";\n",
        encoding="utf-8")

    total_kb = sum(p.stat().st_size for p in ICONS_DIR.glob("*.webp")) / 1024
    print(f"\n完成：新增 {stats['ok']} ｜ 已有 {stats['exists']} ｜ "
          f"占位图跳过 {stats['placeholder']} ｜ 失败 {len(failures)}")
    print(f"图标目录 {ICONS_DIR.relative_to(ROOT)}/：共 "
          f"{len(list(ICONS_DIR.glob('*.webp')))} 个，{total_kb:.0f} KB")
    print(f"映射 {OUT_JS.relative_to(ROOT)}：{len(name2id)} 个名字"
          f"（{OUT_JS.stat().st_size / 1024:.0f} KB）")
    for f in failures[:10]:
        print(f"  ⚠️ {f}")
    if len(failures) > 10:
        print(f"  …另有 {len(failures) - 10} 个失败")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
