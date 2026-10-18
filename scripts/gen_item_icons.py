#!/usr/bin/env python3
"""下载全量物品配图，并生成前端「物品名 → 图标」映射。

做两件事
--------
  ① **全量配图**：把 5480 件物品的官方图（``baseImageLink``，64×64 带透明通道）
     统一重采样成 64×64 WebP，落到 ``content/assets/items/icons/<24位物品id>.webp``。
     图鉴表、单件详情页、任务页共用这一份文件（同 id 同图，不重复下载）。
  ② **名字映射**：给任务页生成 ``content/javascripts/item-icons.js``
     （``window.TARKOV_ITEM_ICONS`` 中文名 → id），任务文本里只有物品名、没有 id。

为什么单独一支、**不进 build_all / check_gen_drift**（与 gen_map_thumbs.py 同一条理由）
------------------------------------------------------------------------------
  ① 它要联网抓 ``assets.tarkov.dev``，不是离线确定性的；
  ② 全量抓一遍要十几分钟。
  **上游数据（items_full.json / items_index.json）重跑后，要跟着手动重跑一次** ——
  那时新增的物品才会有配图。漏跑的后果仅是「新物品没有图」（``<img>`` 用 onerror
  兜底成不显示），不会破版，也不该让门禁变红。

为什么用 baseImageLink 而不是 iconLink
--------------------------------------
  ``-icon.webp`` 是 **RGB 无 alpha** 的（PIL 读出来 mode=RGB，背景是黑的）：
  放进浅色纸面的图鉴表格里就是一片黑方块。``-base-image.webp`` 是 RGBA，
  透明底，贴合站内配色。两者都是 64×64（没有更大的尺寸，``-image512px`` 等一律 404），
  所以不需要尺寸参数，直接 64 出图。

数据源
------
  scripts/data/items_full.json     离线，全量物品（id → baseImageLink / zh 译名）
  scripts/data/items_index.json    离线，833 种任务物品名 + pages（名 → [图鉴页, 物品id]）
  json.tarkov.dev/regular/tasks    实时，任务专属道具表 questItems，
  + tasks_zh                       补 pages 对不上的那批（「水泵运行数据」这类，
                                   译名在 tasks_zh 里，不在物品译文表里）

三条硬规矩
--------
  ① **占位图不算图**：官方给无图物品返回 ``unknown-item-icon.jpg``（JPEG）。
     按内容魔数（``FF D8 FF``）识别，命中即跳过、不入映射 —— 否则读者看到的是
     同一张问号图。
  ② **拿不准的名字宁可没有**：译名撞车（多个 id 同名）或查不到 id 的名字
     **不进映射**，与站内「重名走搜索、任务专属不给链接」是同一条规矩。
  ③ **幂等**：图标已存在就跳过下载，只补缺的；``--reencode`` 才会重压已有文件。
     重跑不会把已抓的再抓一遍。

用法
----
    python scripts/gen_item_icons.py              # 全量（补缺 + 重建映射）
    python scripts/gen_item_icons.py --reencode    # 已有文件也重压（换质量参数时用）
    python scripts/gen_item_icons.py --dry-run     # 只解析与统计，不下载、不写盘
    python scripts/gen_item_icons.py --limit 20    # 只处理前 20 件（冒烟测试）
    python scripts/gen_item_icons.py --map-only    # 只重建名字映射（不联网下图）
"""
from __future__ import annotations

import argparse
import io
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
WORKERS = 16
TIMEOUT = 25
RETRIES = 2

# 产物尺寸与质量：64×64 q80 实测均值 1.1 KB，全量约 5.8 MB；
# q85 只多 0.5 MB 但目视无差（2026-10-19 抽样 120 件对比），取 q80。
SIZE = 64
QUALITY = 80

# 官方占位图是 JPEG（``FF D8 FF``）；正常图是 WebP（``RIFF....WEBP``）
JPEG_MAGIC = b"\xff\xd8\xff"
WEBP_MAGIC = b"RIFF"


def load_json(path: Path):
    if not path.exists():
        sys.exit(f"[错误] 找不到 {path.relative_to(ROOT)} —— 先跑上游生成器。")
    return json.loads(path.read_text(encoding="utf-8"))


def http_get(url: str, headers: dict | None = None) -> bytes:
    """带重试的 GET；失败抛异常（调用方决定降级路径）。"""
    last: Exception | None = None
    for _ in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers or HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, OSError) as exc:  # noqa: PERF203
            last = exc
    raise RuntimeError(f"GET 失败（重试 {RETRIES} 次）：{url}｜{last}")


# ---------------------------------------------------------------- 名字 → id 解析

def resolve_names(full_items: dict) -> tuple[dict[str, str], list[str], dict[str, str]]:
    """返回 (中文名→id, 跳过的名字及原因, 任务专属道具 id→图片链接)。

    第三项只装**不在 items 端点里**的任务道具（「水泵运行数据」这类）：
    它们的图只能从 tasks 端点拿，而图鉴表用不到它们、任务页用得到。
    """
    idx = load_json(ITEMS_INDEX)
    pages = idx.get("pages") or {}
    names = list((idx.get("items") or {}).keys())

    name2id: dict[str, str] = {}
    skipped: list[str] = []
    extra_icons: dict[str, str] = {}

    # ① pages 精确匹配
    for name, p in pages.items():
        if not p or len(p) < 2:
            continue  # None = 图鉴重名，按站内规矩不给链接，也不给图标
        iid = p[1]
        it = full_items.get(iid)
        if not it:
            skipped.append(f"{name}（pages 有 id 但物品库里没有）")
            continue
        name2id[name] = iid

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
                extra_icons[qid] = quest_items[qid]["iconLink"]
            elif len(ids) > 1:
                skipped.append(f"{n}（{len(ids)} 个任务道具同名，不猜）")
            else:
                skipped.append(f"{n}（任务道具表里查不到）")

    # 占位图链接直接剔除（有的物品 iconLink/baseImageLink 本身就是问号图）
    for name, iid in list(name2id.items()):
        link = (full_items.get(iid) or {}).get("baseImageLink") \
            or extra_icons.get(iid) or ""
        if "unknown-item-icon" in link:
            del name2id[name]
            skipped.append(f"{name}（官方无图，链接是占位图）")

    return name2id, skipped, extra_icons


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
    print(f"  任务道具表：{len(out)} 条（带图片链接且有中文译名）")
    return out


# ------------------------------------------------------------------------ 下载

def norm_image(body: bytes):
    """把官方图统一成 64×64 透明底 WebP 字节；不合规返回 (None, 原因)。"""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - 环境问题，直接拦住
        sys.exit("[错误] 需要 Pillow：pip install pillow")
    if body[:3] == JPEG_MAGIC:
        return None, "placeholder"      # 官方占位图，不当配图
    if body[:4] != WEBP_MAGIC or body[8:12] != b"WEBP":
        return None, "fail:内容不是 WebP"
    try:
        im = Image.open(io.BytesIO(body)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001 - 上游偶有坏图
        return None, f"fail:解码失败 {exc}"
    # 非正方形的按最长边补透明边成正方形，再缩 —— 直接 resize 会把人像/枪压扁。
    side = max(im.size)
    if im.size != (side, side):
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
        im = canvas
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=6, exact=True)
    return buf.getvalue(), "ok"


def fetch_one(args: tuple[str, str, bool]) -> tuple[str, bytes | None, str]:
    """下载并重压一件物品的图。返回 (id, 内容或 None, 状态)。"""
    iid, url, force = args
    dest = ICONS_DIR / f"{iid}.webp"
    if not force and dest.exists() and dest.stat().st_size > 0:
        return iid, None, "exists"
    try:
        body = http_get(url)
    except RuntimeError as exc:
        return iid, None, f"fail:{exc}"
    data, status = norm_image(body)
    return iid, data, status


# ------------------------------------------------------------------------ 主流程

def write_mapping(name2id: dict[str, str], fetched: str) -> None:
    payload = json.dumps(name2id, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"))
    OUT_JS.write_text(
        "/* 自动生成，请勿手改 —— 由 scripts/gen_item_icons.py 生成。\n"
        "   物品中文名 → 物品 id；配图在同级 ../assets/items/icons/<id>.webp。\n"
        "   任务数据（quests.json / items_index.json）重跑后要重跑该脚本，\n"
        "   新物品才会有配图（漏跑只是没有图，不会破版）。\n"
        "   数据抓取日 " + fetched + " */\n"
        "window.TARKOV_ITEM_ICONS = " + payload + ";\n",
        encoding="utf-8")
    print(f"映射 {OUT_JS.relative_to(ROOT)}：{len(name2id)} 个名字"
          f"（{OUT_JS.stat().st_size / 1024:.0f} KB）")


def main() -> int:
    ap = argparse.ArgumentParser(description="下载全量物品配图并生成名字 → id 映射")
    ap.add_argument("--dry-run", action="store_true", help="只解析与统计，不下载、不写盘")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 件（冒烟测试用；0 = 全部）")
    ap.add_argument("--reencode", action="store_true", help="已有图标也重压（换质量参数时用）")
    ap.add_argument("--map-only", action="store_true", help="只重建名字映射，不下图")
    ap.add_argument("--workers", type=int, default=WORKERS, help=f"并发数（默认 {WORKERS}）")
    args = ap.parse_args()

    full = load_json(ITEMS_FULL)
    full_items = full["items"]["items"]
    fetched = full.get("fetched") or "—"

    print("解析物品名 → id …")
    name2id, skipped, extra_icons = resolve_names(full_items)
    print(f"  可解析 {len(name2id)} 个名字，跳过 {len(skipped)} 个"
          f"（原因见 --dry-run 输出）")

    todo = [(iid, it["baseImageLink"]) for iid, it in sorted(full_items.items())
            if it.get("baseImageLink") and "unknown-item-icon" not in it["baseImageLink"]]
    # 任务专属道具（「水泵运行数据」这类）不在 items 端点里，但任务页要显示图：
    # 只补「映射引用到、却还没有文件」的那些，避免把 3000 个纯道具图一起拖下来。
    mapped_ids = set(name2id.values())
    have = {p.stem for p in ICONS_DIR.glob("*.webp")} if ICONS_DIR.exists() else set()
    extra = [(iid, url) for iid, url in extra_icons.items()
             if iid in mapped_ids and iid not in have]
    if extra:
        print(f"  任务专属道具补图：{len(extra)} 张")
    todo += extra
    if args.limit:
        todo = todo[: args.limit]

    print(f"  全量配图：{len(todo)} 件（物品库共 {len(full_items)} 件）")

    if args.dry_run:
        for s in skipped:
            print(f"    · 跳过：{s}")
        print(f"\n（dry-run）将下载 {len(todo)} 张图到 {ICONS_DIR.relative_to(ROOT)}/")
        return 0

    if not args.map_only:
        ICONS_DIR.mkdir(parents=True, exist_ok=True)
        stats = {"ok": 0, "exists": 0, "placeholder": 0}
        failures: list[str] = []
        missing: set[str] = set()
        jobs = [(iid, url, args.reencode) for iid, url in todo]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for n, (iid, body, st) in enumerate(pool.map(fetch_one, jobs), 1):
                if st == "ok" and body:
                    (ICONS_DIR / f"{iid}.webp").write_bytes(body)
                    stats["ok"] += 1
                elif st == "exists":
                    stats["exists"] += 1
                elif st == "placeholder":
                    stats["placeholder"] += 1
                    missing.add(iid)
                else:
                    failures.append(f"{iid}｜{st}")
                    missing.add(iid)
                if n % 500 == 0:
                    print(f"  … {n}/{len(jobs)}（新增 {stats['ok']}）", flush=True)
        print(f"\n下载完成：新增 {stats['ok']} ｜ 已有 {stats['exists']} ｜ "
              f"占位图跳过 {stats['placeholder']} ｜ 失败 {len(failures)}")
        # 没有真图的名字不进映射（前端按名查不到就退化成无图，而不是黑问号）
        name2id = {n: i for n, i in name2id.items() if i not in missing}

    write_mapping(name2id, fetched)

    # 清孤儿：既不是物品库里的 id、也没被映射引用（旧版 803 张里改名/下架的残留）。
    # 只在任务道具表抓成功时才清 —— 否则网络抖动会让 90 张任务道具图被误删。
    if extra_icons:
        keep = set(full_items) | mapped_ids
        stray = [p for p in ICONS_DIR.glob("*.webp") if p.stem not in keep]
        for p in stray:
            p.unlink()
        if stray:
            print(f"  清理孤儿图标：{len(stray)} 张")

    files = list(ICONS_DIR.glob("*.webp"))
    total_kb = sum(p.stat().st_size for p in files) / 1024
    print(f"图标目录 {ICONS_DIR.relative_to(ROOT)}/：共 {len(files)} 个，{total_kb:.0f} KB")
    for f in failures[:10]:
        print(f"  ⚠️ {f}")
    if len(failures) > 10:
        print(f"  …另有 {len(failures) - 10} 个失败")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
