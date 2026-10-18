"""构建产物的结构冒烟（`site/` 存在时才跑）。

替代「人工点一遍」的最低档：没有浏览器也能验的四件事 ——
单页只有一个 `<h1>`、每页都有 canonical、sitemap 与实际页面一一对应、
页面引用的本地 js/css 真的存在（删脚本忘改模板时，页面会静默白屏）。

⚠️ 这不是视觉回归，也不测交互。交互回归（作战台输入框、地图联动）需要
Playwright，见 `tests/browser/`（默认不跑，`make` 目标里单独触发）。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

SITE = Path(__file__).resolve().parent.parent / "site"

pytestmark = pytest.mark.skipif(
    not (SITE / "index.html").is_file(),
    reason="site/ 还没构建：先跑 `zensical build`",
)

HTML_FILES = sorted(SITE.rglob("*.html"))


@pytest.fixture(scope="module")
def pages() -> list[Path]:
    assert HTML_FILES, "site/ 里没有 html"
    return HTML_FILES


def test_sitemap_matches_built_pages(pages: list[Path]):
    sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    # 404 页不进 sitemap
    expected = [p for p in pages if p.name != "404.html"]
    assert len(locs) == len(expected), f"sitemap {len(locs)} 条 / 页面 {len(expected)} 个"


def test_single_h1_per_page(pages: list[Path]):
    bad = []
    for p in pages:
        n = len(re.findall(r"<h1\b", p.read_text(encoding="utf-8", errors="replace")))
        if n != 1:
            bad.append(f"{p.relative_to(SITE)}: {n} 个 h1")
    assert not bad, "\n".join(bad[:10])


def test_canonical_present(pages: list[Path]):
    # 404.html 是主题错误页（overrides/404.html），不是内容页：它没有 canonical 是正常的
    bad = [
        str(p.relative_to(SITE))
        for p in pages
        if p.name != "404.html"
        and 'rel="canonical"' not in p.read_text(encoding="utf-8", errors="replace")
    ]
    assert not bad, f"缺 canonical: {bad[:10]}"


def site_prefix() -> str:
    """从 mkdocs.yml 的 site_url 取部署子路径（如 `/tarkov-encyclopedia/`）。"""
    cfg = (Path(__file__).resolve().parent.parent / "mkdocs.yml").read_text(encoding="utf-8")
    m = re.search(r"^site_url:\s*(\S+)", cfg, re.MULTILINE)
    assert m, "mkdocs.yml 里没有 site_url"
    path = re.sub(r"^[a-z]+://[^/]+", "", m.group(1)).lstrip("/")
    return "/" + path if path and not path.endswith("/") else "/" + path


def strip_code(html: str) -> str:
    """去掉 <pre>/<code> 与注释 —— 那里面的 `src="..."` 是**教人怎么写**的正文。"""
    html = re.sub(r"<pre\b.*?</pre>", "", html, flags=re.S)
    html = re.sub(r"<code\b.*?</code>", "", html, flags=re.S)
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


def test_referenced_local_assets_exist(pages: list[Path]):
    prefix = site_prefix()
    missing: set[str] = set()
    for p in pages:
        html = strip_code(p.read_text(encoding="utf-8", errors="replace"))
        for attr in re.findall(r'(?:src|href)="([^"]+)"', html):
            if attr.startswith(("http://", "https://", "//", "#", "mailto:", "data:", "javascript:")):
                continue
            target = attr.split("?")[0].split("#")[0]
            # 只盯「缺了就白屏 / 没样式」的静态资源。图片由产物清单与 check_icons 管，
            # 且本站 md 里的缩略图是构建后才有的二进制（不在逐文件抓取的审查副本里）。
            if not target or not target.endswith((".js", ".css", ".json", ".woff2")):
                continue
            if target.startswith("/"):
                # 绝对路径带部署前缀（/tarkov-encyclopedia/...）→ 相对 site/ 解析
                if not target.startswith(prefix):
                    continue  # 指向站外根路径（不该出现，但不归本测试判）
                candidate = (SITE / target[len(prefix):]).resolve()
            else:
                candidate = (p.parent / target).resolve()
            if not candidate.exists():
                missing.add(f"{p.relative_to(SITE)} → {attr}")
    assert not missing, "\n".join(sorted(missing)[:10])
