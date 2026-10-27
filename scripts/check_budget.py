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
    ("search.json", 900,
     "698 KB（2026-10-21）；搜索是唯一「每次打开都付费」的全局资源。"
     "2026-10-21 从 700 提到 760 —— 实测只余 2 KB，而这份索引的体积与正文总量几乎"
     "线性（条目正文占 47.6%、任务图鉴 25.8%、物品图鉴 10.5%，没有冗余栏目可砍；"
     "压缩比只有 3.8:1，中文文本用 gzip 就是这个水平）。按现行结构，再加 10 篇条目"
     "约 +40 KB —— 700 那道线意味着「下一篇就红」，那不是判据，是事故。"
     "760 = 约 15 篇条目的余量。这条仍是全站最该盯的数字：读者真的会等它"
     "｜2026-10-26 从 760 提到 900 —— 加完「战区纪事」五页后实测 731.7 KB，"
     "余 28 KB ≈ 9 篇条目，等于下一次扩写必红。实测每 1 KB gz ≈ 1,542 字符正文，"
     "900 = 余 168 KB ≈ 53 篇条目，够两三个版本；对读者的代价是一次性的："
     "首屏不加载它（点开搜索才拉），4G 下 +0.27 s、弱 3G 下 +1.1 s，之后走缓存。"
     "⚠️ 这一抬不是免费：**下次再顶到 900 就先做拆分**（按栏目分片或把图鉴移出索引），"
     "不要再往上加 —— 1 MB 以上的中文索引，弱网读者会直接用不回搜索"),
    ("首页 HTML", 30, "22 KB；首屏决定「这站快不快」的第一印象"),
    ("最大单页 HTML", 400,
     "260 KB（2026-10-21 实测；CHANGELOG 已拆页，原来的 370 KB 那句已过期）；"
     "再大就该分页或折叠"),
    ("每页 JS 合计", 96,
     "73.3 KB（2026-10-23 实测）；站内手写脚本 gzip 合计，剔除 /ops/ 的按需加载。"
     "2026-10-18 从 70 提到 74：新增 table-sticky.js 3.2 KB gz，"
     "换 39 个长表页的表头常驻（其余页只多一次 querySelectorAll）。"
     "2026-10-23 从 74 提到 80 —— 当时只剩 0.7 KB，那道线等于「下一次改动必红」，"
     "与 ops JS（100→120）、search.json（700→760）是同一条理由。"
     "⚠️ **这 6.7 KB 是借的，不是白给的**：同一批脚本分别 gzip 合计 73.3 KB，"
     "合并成单包实测 65.9 KB（只合并 11 个手写脚本 61.8 → 53.9），省下的正是"
     "共享字典 —— 也就是说 7 KB 一直躺在「各打包各的」里。做了 bundle 就该把这条线"
     "收回 74。在此之前，新增全局脚本仍要先答一句「为什么不能按需」。"
     "这条是全站唯一「每页、每次打开都付」的 JS 成本：多 1 KB ≈ 4G 下 20 ms、"
     "弱 3G 下 80 ms，乘 170 页 × 每次访问 —— 放宽的自由度应当小于 ops JS"
     "｜2026-10-27 **bundle 已兑现**（scripts/gen_bundle.py：10 个手写脚本合成一个，"
     "实测 74.46 → 68.67 KB，净省 5.79 KB；每页实测值见本报表「每页 JS 合计」行）。"
     "⚠️ 同一天**没有按上一条写的「收回 74」执行，而是抬到 96** —— 理由必须写在这里，"
     "否则这就是静默放宽：收回 74 只剩 5.3 KB，等于把「下一次改动必红」原样留着；"
     "这条线该看的是「还能加多少实质功能」，不是「离上次实测多远」。"
     "96 给 27.3 KB ≈ 一个完整交互模块（参照：table-sticky 3.4 / toolbox 8.1）。"
     "代价如实记账：27.3 KB ≈ 4G 下 0.55 s、弱 3G 下 2.2 s，**每页每次**。"
     "⚠️ 再往上抬就不该动这个数字了，该做按需加载 —— ops-board 的 120 KB 之所以"
     "能接受，是因为只有 /ops/ 付；全局脚本乘的是 170 页。"
     "新增 JS 前先答一句：它是「每页都要」还是「少数页才要」；后者一律进 LAZY_PAGES"),
    ("整站体积", 128 * 1024,
     "49.1 MB（2026-10-21）；2026-10-21 从 50 提到 64 —— 50 与 search.json 是同一个"
     "问题：余量只剩 0.9 MB，而物品配图一项就占 24 MB（5,570 件），加一批新物品就顶破。"
     "64 MB 给下一次图片增量留位。这一条**不直接伤读者**（没人会打开网站就下 64 MB，"
     "读者只下当前这一页）—— 它防的是「误提交大素材」；GitHub Pages 的硬限是 1 GB，"
     "还有 15 倍空间。真要再涨先检查是不是有人把视频/PSD 提交进来了"
     "｜2026-10-27 从 64 提到 128。两条理由，第二条比第一条重要："
     "① 实测 50.0 MB，物品配图 24 MB 占 48%，一次图鉴扩充（约 +2,000 件 ≈ +8 MB）"
     "就吃掉一半余量；② **这条上限一直防不住它声称要防的事** —— 总量还有余量时，"
     "一个 30 MB 的视频照样能进仓，而那时它已经落在 git 历史里（要清理得改写历史，"
     "比当场拦下贵一个数量级）。所以这次不是单纯抬数字，是**同时补了一条「单文件上限」**"
     "（见下一项）：总量管趋势，单文件管手滑，两件事。"),
    ("最大素材文件", 2048,
     "1.16 MB（2026-10-27 实测，content/assets/maps/Labs.webp）。"
     "**这条比整站总量更能防住「误提交大素材」**：总量上限是滞后的（还有余量就放行），"
     "单文件上限是当场拦下的。查的是 content/assets/ 而不是 site/ —— "
     "site/ 下的 catalog-data.js、search.json 都是生成物，体积由各自生成器与上面的"
     "总量预算管，不该被这条误伤。2 MB 的定法：现状最大 1.16 MB（地图底图），"
     "留 1.7 倍余量；物品图标是 4 KB 级、地图缩略图 60 KB 级，正常素材离这条线很远。"),
    ("llms.txt", 40, "正文 17 KB / gzip 7 KB；给 AI 爬虫的入口，超了说明该拆"),
]

# 按需加载页：HTML 里没有 <script src>，脚本由页内加载器注入，所以静态扫不到。
# 这里**显式登记**（而不是在 HTML 里嗅字符串 —— CHANGELOG 正文提了脚本名就会误判，
# 2026-10-18 实测踩过）。新增按需加载时在这里加一行，预算自然覆盖。
LAZY_PAGES: dict[str, tuple[str, float]] = {
    # 2026-10-21 从 100 提到 120：v1.145.3 修完赛季模式、深链、无地图档等 23 项后
    # 实测 99.6 KB —— 只差 0.4 KB 就红。100 那道线等于「下一次改动必红」。
    # 120 给一次模块级改动留位；再涨就该把「出击清单 / 详情卡」拆成按需注入。
    "ops/index.html": ("ops-board.js", 120),
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

    # 最大素材文件（2026-10-27）：查 content/assets/ —— **手写区域**，不查 site/。
    # site/ 下的 catalog-data.js / search.json 是生成物，体积由各自生成器与上面的
    # 总量预算管，让这条去查它们只会误伤。
    # ⚠️ 这里量的是**未压缩字节**，跟其它项不同：它比的是「提交进仓库的比特」
    #    （git 历史不可逆），不是「读者要下多少」。别改成 gz_size。
    biggest: tuple[Path, int] | None = None
    assets_dir = CONTENT / "assets"
    if assets_dir.is_dir():
        for f in assets_dir.rglob("*"):
            if f.is_file():
                size = f.stat().st_size
                if biggest is None or size > biggest[1]:
                    biggest = (f, size)
    if biggest:
        rows.append({"name": "最大素材文件", "kb": biggest[1] / 1024,
                     "path": str(biggest[0].relative_to(ROOT))})

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
