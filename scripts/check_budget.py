"""体积预算：把「弱网可读」从口号变成会红的数字。

**为什么不查「构建成功」**：页面能打开 ≠ 读者等得起。本站自述「弱网环境可流畅阅读」，
而 2026-10-18 审查实测：线上 `/search.json` gzip 后 681 KB、`/CHANGELOG/` 单页 370 KB、
17 页 × 每页 67 KB 的 JS —— 这些都不是 bug，但一旦再涨一倍，那句话就成了假话。

**判据只写上限，不写目标**：超了有两种合法处理 —— ①优化；②**同时**改这里的数字并写明
为什么这次值得涨。第二种不是漏洞：改动会出现在 diff 里，评审时看得见；静默增长才是问题。

**跑在 deploy job（构建之后、上传之前）**：它需要 site/ 才能量。validate job 不跑它。

用法：
    python scripts/check_budget.py            # 超预算 → 退出码 1
    python scripts/check_budget.py --json     # 给 CI 读
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

from _console import setup as _setup_console

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
CONTENT = ROOT / "content"

# (名字, 上限 KB, 为什么是这个数)
BUDGETS: list[tuple[str, float, str]] = [
    ("search.json", 700, "681 KB（2026-10-18）；搜索是唯一「每次打开都付费」的全局资源"),
    ("首页 HTML", 30, "22 KB；首屏决定「这站快不快」的第一印象"),
    ("最大单页 HTML", 400, "370 KB（CHANGELOG）；再大就该分页或折叠"),
    ("每页 JS 合计", 74,
     "72 KB；12 个手写脚本 + 主题 bundle，剔除 /ops/ 的按需加载。"
     "2026-10-18 从 70 提到 74：新增 table-sticky.js 3.2 KB gz，"
     "换 39 个长表页的表头常驻（其余页只多一次 querySelectorAll）。"
     "再涨就该学 map-loader / mount-loader 改成按需注入了"),
    ("整站体积", 50 * 1024,
     "48 MB；2026-10-19 从 45 提到 50 —— 物品配图从「只给 803 件任务物品」"
     "扩到「全量 5,480 件透明底原图 + 90 个任务专属道具」，图片库 +4.4 MB。"
     "这是有意的功能增量，不是漂移：一件物品约 1.2 KB，已经是 64×64 透明 WebP 的"
     "压缩下限（q80 / method 6）。真要再省只能降分辨率，代价是详情页 96 px 糊"),
    ("llms.txt", 40, "正文 17 KB / gzip 7 KB；给 AI 爬虫的入口，超了说明该拆"),
]

# 按需加载页：HTML 里没有 <script src>，脚本由页内加载器注入，所以静态扫不到。
# 这里**显式登记**（而不是在 HTML 里嗅字符串 —— CHANGELOG 正文提了脚本名就会误判，
# 2026-10-18 实测踩过）。新增按需加载时在这里加一行，预算自然覆盖。
LAZY_PAGES: dict[str, tuple[str, float]] = {
    "ops/index.html": ("ops-board.js", 100),   # 83 KB；比其它页多一个 ops-board.js
}

CACHE: dict[Path, int] = {}


def gz_size(path: Path) -> int:
    """GBK 无关、确定性：同一份字节永远得到同一个数（gzip mtime 默认 0）。"""
    if path not in CACHE:
        CACHE[path] = len(gzip.compress(path.read_bytes(), 6, mtime=0))
    return CACHE[path]


def html_pages() -> list[Path]:
    return sorted(p for p in SITE.rglob("*.html"))


SCRIPT_RE = re.compile(r'<script[^>]+src="([^"]+)"')


def page_js_bytes(page: Path) -> int:
    """页面加载的**站内手写脚本** gzip 合计（主题 bundle 单算，见 check_theme）。"""
    seen: set[Path] = set()
    total = 0
    for src in SCRIPT_RE.findall(page.read_text(encoding="utf-8", errors="replace")):
        if "assets/" in src or src.startswith(("http://", "https://", "//")):
            continue
        name = src.rsplit("/", 1)[-1]
        target = CONTENT / "javascripts" / name
        if target.exists() and target not in seen:
            seen.add(target)
            total += gz_size(target)
    return total


def measure() -> list[dict]:
    pages = html_pages()
    rows: list[dict] = []

    search = SITE / "search.json"
    if search.exists():
        rows.append({"name": "search.json", "kb": gz_size(search) / 1024, "path": str(search.relative_to(SITE))})

    index = SITE / "index.html"
    if index.exists():
        rows.append({"name": "首页 HTML", "kb": gz_size(index) / 1024, "path": "index.html"})

    if pages:
        biggest = max(pages, key=gz_size)
        rows.append({"name": "最大单页 HTML", "kb": gz_size(biggest) / 1024,
                     "path": str(biggest.relative_to(SITE))})

    js = {str(p.relative_to(SITE)).replace("\\", "/"): page_js_bytes(p) for p in pages}
    if js:
        # 普通页：只算静态 <script src>
        plain = {k: v for k, v in js.items() if k not in LAZY_PAGES}
        if plain:
            worst = max(plain, key=lambda k: plain[k])
            rows.append({"name": "每页 JS 合计", "kb": plain[worst] / 1024, "path": worst})
        # 按需加载页：静态引用 + 登记的那份脚本
        for page_rel, (script_name, limit) in LAZY_PAGES.items():
            if page_rel not in js:
                continue
            extra = CONTENT / "javascripts" / script_name
            add = gz_size(extra) if extra.exists() else 0
            rows.append({"name": f"{page_rel} JS 合计", "kb": (js[page_rel] + add) / 1024,
                         "path": page_rel})

    total = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
    rows.append({"name": "整站体积", "kb": total / 1024, "path": "site/"})

    llms = CONTENT / "llms.txt"
    if llms.exists():
        rows.append({"name": "llms.txt", "kb": gz_size(llms) / 1024, "path": "content/llms.txt"})
    return rows


def main() -> int:
    _setup_console()
    ap = argparse.ArgumentParser(description="体积预算")
    ap.add_argument("--json", action="store_true", help="输出 JSON（CI 用）")
    args = ap.parse_args()

    if not SITE.is_dir():
        print("[跳过] 没有 site/ —— 先 zensical build（本检查跑在构建之后）")
        return 0

    limits = {name: (limit, why) for name, limit, why in BUDGETS}
    for page_rel, (script_name, limit) in LAZY_PAGES.items():
        limits[f"{page_rel} JS 合计"] = (limit, f"比其它页多一个按需注入的 {script_name}")

    rows = measure()
    fails: list[str] = []
    for r in rows:
        limit, why = limits.get(r["name"], (None, ""))
        r["limit_kb"] = limit
        r["over"] = bool(limit is not None and r["kb"] > limit)
        r["why"] = why
        if r["over"]:
            fails.append(f"{r['name']} {r['kb']:.0f} KB > 预算 {limit:.0f} KB（{r['path']}）")

    if args.json:
        print(json.dumps({"rows": rows, "fails": fails}, ensure_ascii=False, indent=2))
        return 1 if fails else 0

    print("体积预算（gzip，确定性：同一份字节永远同一个数）")
    print("=" * 78)
    for r in rows:
        limit, why = limits.get(r["name"], (None, ""))
        flag = "✗" if r["over"] else "✓"
        head = f"余量 {limit - r['kb']:5.0f} KB" if limit else "无预算"
        print(f"{flag} {r['name']:14} {r['kb']:7.1f} KB  {head}  {r['path']}")
        if why:
            print(f"    └ 上限 {limit:.0f} KB：{why}")

    if fails:
        print(f"\n✗ {len(fails)} 项超预算：")
        for f in fails:
            print(f"  · {f}")
        print("\n处理方式只有两种：优化，或**同时**改上面的数字并写明理由。")
        print("预算表是给人看的 diff —— 静默增长才是问题。")
        return 1
    print("\n✅ 全部在预算内。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
