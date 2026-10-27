#!/usr/bin/env python3
"""把 10 个全局手写脚本合并成单包 `content/javascripts/bundle.js`。

为什么合并
----------
`mkdocs.yml` 的 extra_javascript 原来是逐个加载 13 个脚本，每个 `<script src>`
各带一份 gzip 字典。**它们讲的是同一批词汇**（`siteRoot` / `document$` / `tk-`
前缀 / `querySelector` 那一串），分开发等于把这本字典抄 13 遍。

实测（2026-10-27，gzip level 6、mtime=0，与 check_budget 同一算法）：

    13 个分开                  74.46 KB
    11 个合并成单包            65.53 KB
    bundle + 2 个 loader       68.25 KB   ← 净省 6.21 KB

这块成本是**每页、每次打开都付**的（170 页 × 每次访问），所以值得改 ——
多 1 KB ≈ 4G 下 20 ms、弱 3G 下 80 ms，反过来说省 6.21 KB 就是每页省 0.5 秒（弱 3G）。

为什么是 10 个，不是 13 个
-------------------------
① `terms-data.js` —— **未入仓**（.gitignore 第 11 行），由 build_glossary.py 在
   构建期生成。并进来，bundle 就依赖一个只在 CI deploy job 里才存在的文件，
   而 validate job 不跑那支生成器。
② `map-loader.js` / `mount-loader.js` —— 两者都靠 `document.currentScript.src`
   反推同目录地址（`src.replace(/map-loader\\.js/, "map.js")`）。**并进 bundle 后
   currentScript 指向 bundle.js，正则匹配不到 → 注入地址仍是 bundle.js 自己 →
   无限自注入。** 这与 2026-10-19「左右栏全空」是同一类故障（那次是内联 script
   先于 extra_javascript 执行、DOM 里没有 javascripts/*.js 可反推），所以两个
   loader 永远留在 bundle 外面，各付 1.3 KB。

开头的 `__tkRoot` 广播（**必需，不是优化**）
------------------------------------------
全站 12 个脚本都有同一段 `siteRoot()`：先读 `window.__tkRoot`，读不到就
`document.querySelector('script[src*="toolbox.js"]')` 现算。而 `__tkRoot` 的
**唯一赋值处**是 `toolbox.js:98` —— 它自己就走这条 fallback。

合并后页面里没有 `toolbox.js` 这个 `<script>` 了，fallback 返回 ""，于是
`window.__tkRoot = ""`，全站所有站内绝对链接（任务详情注入、进度板跳转、图鉴
条目链接）一起拼成相对路径。**这是静默故障：控制台一个错都不报。**

所以 bundle 最前面先跑一段广播：用 `document.currentScript`（此刻就是 bundle.js
本身，首次整页加载、地址一定解析正确）算出站点根，正则与 `toolbox.js:91` 逐字
一致（`/javascripts\\/[^/]*$/` → 去掉文件名、保留尾斜杠）。之后 `toolbox.js` 的
`window.__tkRoot = siteRoot()` 读到已公布的值、赋给自己，幂等。

用法：
    python scripts/gen_bundle.py            # 生成 / 更新 bundle.js
    python scripts/gen_bundle.py --check    # 只比对不写盘（手工核查用）
"""
from __future__ import annotations

import argparse
import gzip
import sys
from pathlib import Path

from _console import setup as _setup_console

ROOT = Path(__file__).resolve().parent.parent
JS_DIR = ROOT / "content" / "javascripts"
DEST = JS_DIR / "bundle.js"

# 顺序 = 原 extra_javascript 里去掉 terms-data / map-loader / mount-loader 后的相对次序。
# ⚠️ 不要按字母序重排：`toolbox.js` 必须最后（它负责公布 __tkRoot，
#    虽然 bundle 开头已广播过一次，但顺序与原状一致最不容易出错）。
ORDER: list[str] = [
    "scroll-fix.js",
    "glossary-tooltip.js",
    "search-ready.js",
    "breadcrumb.js",
    "nav-top.js",
    "progress-manifest.js",
    "progress.js",
    "quest-needs.js",
    "table-sticky.js",
    "toolbox.js",
]

# 明确排除，并在文件里留痕 —— 将来有人想「顺手都合了吧」时先看到这段。
EXCLUDED: dict[str, str] = {
    "terms-data.js": "未入仓，构建期由 build_glossary.py 生成（.gitignore 第 11 行）",
    "map-loader.js": "靠 document.currentScript 反推 map.js 地址，合并后正则失效",
    "mount-loader.js": "靠 document.currentScript 反推 ops-board.js 地址，合并后正则失效",
}

HEADER = """/* ============================================================================
   ⚠️ 本文件由 scripts/gen_bundle.py 合并生成，**请勿手动编辑**。
      要改逻辑请改对应的源文件，然后重跑：python scripts/gen_bundle.py
      源文件顺序见脚本里的 ORDER；改完记得一并提交 bundle.js。
   ============================================================================ */

/* ── 站点根广播（必需）───────────────────────────────────────────────────────
   全站 12 个脚本的 siteRoot() 都先读 window.__tkRoot，而唯一赋值处是
   toolbox.js:98 —— 它自己也要靠 `script[src*="toolbox.js"]` 现算。
   合并后页面里没有 toolbox.js 这个 <script>，那条 fallback 会返回 ""，
   于是所有站内绝对链接静默变成相对路径。这里在 bundle 执行时刻先广播一次：
   此刻 document.currentScript 就是 bundle.js 本身，地址一定解析正确。
   正则与 toolbox.js:91 逐字一致（去文件名、保留尾斜杠）。 */
(function () {
  if (window.__tkRoot) return;
  var me = document.currentScript ||
    document.querySelector('script[src*="javascripts/bundle.js"]');
  if (!me || !me.src) return;
  window.__tkRoot = me.src.replace(/javascripts\\/[^/]*$/, "");
})();

"""


def _read(path: Path) -> str:
    """按 UTF-8 读、行尾统一成 LF。

    `.gitattributes` 里 `content/javascripts/*.js text eol=lf` 已经声明了 LF，
    但本机 core.autocrlf=true 检出的旧副本可能是 CRLF —— 归一化一次，
    免得「内容一样、字节不同」造成假漂移。
    """
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def build() -> tuple[str, list[tuple[str, int]]]:
    missing = [n for n in ORDER if not (JS_DIR / n).exists()]
    if missing:
        raise SystemExit(f"[失败] 缺少源文件：{', '.join(missing)}")

    parts: list[str] = [HEADER]
    stats: list[tuple[str, int]] = []
    for name in ORDER:
        body = _read(JS_DIR / name)
        if not body.endswith("\n"):
            body += "\n"
        parts.append(f"/* ==== 源文件：{name} ==== */\n{body}\n")
        stats.append((name, len(body.encode("utf-8"))))
    return "".join(parts), stats


def gz(text: str) -> int:
    return len(gzip.compress(text.encode("utf-8"), 6, mtime=0))


def main() -> int:
    _setup_console()
    ap = argparse.ArgumentParser(description="合并全局脚本为 bundle.js")
    ap.add_argument("--check", action="store_true", help="只比对，不写盘")
    args = ap.parse_args()

    text, stats = build()
    old = DEST.read_text(encoding="utf-8") if DEST.exists() else None

    if args.check:
        if old == text:
            print(f"✓ bundle.js 与源一致（{gz(text) / 1024:.2f} KB gzip）")
            return 0
        print("✗ bundle.js 与源不一致 —— 跑 python scripts/gen_bundle.py 重新生成")
        return 1

    DEST.write_bytes(text.encode("utf-8"))

    sep = sum(gz(_read(JS_DIR / n)) for n in ORDER)
    merged = gz(text)
    print(f"合并 {len(ORDER)} 个脚本 → content/javascripts/bundle.js")
    for name, size in stats:
        print(f"    {size / 1024:8.1f} KB raw   {name}")
    print(f"\n分开（gzip 合计） {sep / 1024:7.2f} KB")
    print(f"合并（gzip 单包） {merged / 1024:7.2f} KB")
    print(f"省下              {(sep - merged) / 1024:7.2f} KB")
    if merged >= sep:
        print("[警告] 合并后反而更大 —— 检查源文件是否已被截断", file=sys.stderr)
        return 1
    print("\n排除在外的（理由见本脚本顶部）：")
    for name, why in EXCLUDED.items():
        print(f"    · {name:18} {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
