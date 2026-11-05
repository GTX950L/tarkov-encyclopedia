#!/usr/bin/env python3
"""逐页 front matter：``description``（必需）+ ``title``（仅当导航标题撞车）。

为什么要有这一支
----------------
2026-11-03 全站审查实测：``site/**/index.html`` 里 **191 个页面的
``<meta name="description">`` 完全是同一句** —— ``site_description`` 的全局回落。
搜索引擎拿不到任何区分度，等于把最贵的一块 SEO 资源浪费掉。

同时 6 个页面的 ``<title>`` 都叫「总览」（侧栏里它们确实都叫这个名字），
搜索结果里六条长得一模一样，读者分不出点哪个。

两件事的根因相同：**这些元信息没人写，全靠框架默认值**。
所以修法也不能是「人工补 191 行」—— 下一版新增页面照样会漏。
这里按「**标题 + 首段**」自动产出，并留一个可人工覆盖的出口。

自动 / 人工怎么区分
-------------------
写进去的行带行尾注释 ``# 自动生成``：

    description: "弹药与弹药箱：全站 446 件弹药与弹药箱…"  # 自动生成

脚本只覆盖**带这个标记**的行。人工改写时把注释删掉，本脚本从此不再动它
（``--force`` 才会连人工行一起重算）。判据：**标记即所有权**。

为什么不写成「每个页面一个独立的 description 文件」
------------------------------------------------
那份映射本身又是一份需要人维护的副本 —— 正是本站反复踩的坑
（地图卡片数字、条目数 97/98 都是这么漂的）。写进 md 的 front matter，
描述与内容就在同一个文件里，改内容时顺手能看见。

用法
----
    python scripts/gen_page_meta.py            # 补/更新自动生成的元信息
    python scripts/gen_page_meta.py --check    # 只报告缺哪些、撞车哪些
    python scripts/gen_page_meta.py --force    # 连人工行也重算（慎用）
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

MARK = "# 自动生成"

# 不作为读者页面处理的文件：编纂附件（不进 nav、不进 sitemap）。
SKIP = {"template.md", "tags.md"}

# 摘要长度上限（中文字符）。Google 中文摘要约 78 字符，
# 留出「主题：」前缀与结尾标点的余量，正文取 60。
BODY_MAX = 60

# 跳过「不是正文」的行
SKIP_LINE = re.compile(
    r"^\s*(#|\||```|<|---$|\*\s*$|\*\*\*$|!\[)"  # 标题/表格/代码/HTML/分隔线/图片
)
LIST_LINE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")

# 顶部引用块里这些是**口径声明**，不是页面定位，不能当摘要
BAD_QUOTE = re.compile(
    r"版本基线|数据来源|引用时请|生成页|底图来源|License|CC BY"
)
# 页脚固定块（「最后更新 / 贡献者 / License」）与目录式残句，任何类型都不收
BAD_PARA = re.compile(r"^最后更新|贡献者|CC BY-NC-SA|回到顶部|^📖?\s*返回")
# 图鉴分册里的结构性说明：「本分类 26 件」「分类路径：物品 › …」
# 它们是**单个子分类**的注脚（手枪 26 件），不是整页（枪械 172 件）的定位，拿来当摘要会张冠李戴。
BAD_GENERATED = re.compile(r"^本分类\s*\d+\s*件|^分类路径")
LEAD_EMOJI = re.compile(r"^[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\s]+")

INLINE_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
INLINE_CODE = re.compile(r"`([^`]*)`")
INLINE_BOLD = re.compile(r"\*{1,3}([^*]+)\*{1,3}")
INLINE_HTML = re.compile(r"<[^>]+>")
MULTI_SPACE = re.compile(r"[ \t\u3000]+")

# 没有任何可读段落时的回退（按栏目）。**必须分栏写**：
# 图鉴分册、任务页、地图页的正文主体是表格，很多页压根没有散文段落。
# 回退句只求「说清这一页是什么」，不求独特 —— 独特性由 topic 前缀保证。
SECTION_HINT = {
    "catalog": "物品图鉴分册，列名称、重量、占格与商人价格",
    "quests": "任务图鉴，含前置条件、目标、奖励与商人门槛",
    "maps": "交互地图与点位数据，含撤离点、任务区域与地名锚点",
    "entries": "机制条目，含版本基线与游戏内实测口径",
    "docs": "参考资料与速查表",
    "lore": "战区纪事，按区域讲这片地方以前发生过什么",
    "story": "剧情线逐章讲解",
    "ops": "一站式作战台",
}


def split_front(text: str) -> tuple[dict[str, str], str, str]:
    """拆出 front matter 的**原始行**、正文、front matter 原文。

    不用 yaml 解析再 dump：那会把注释丢掉、把 ``tags`` 列表重新排版，
    每跑一次都是一次全文件重写。这里只按行处理，未触及的行**一个字节都不动**。
    """
    if not text.startswith("---\n"):
        return {}, text, ""
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text, ""
    head = text[4:end]
    body = text[end + 5 :]
    lines = {}
    for line in head.split("\n"):
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            lines[m.group(1)] = m.group(2)
    return lines, body, head


def h1_of(body: str) -> str:
    m = re.search(r"^#\s+(.+)$", body, re.M)
    return m.group(1).strip() if m else ""


def strip_bracket_en(s: str) -> str:
    """``弹药与弹药箱（Item Catalog）`` → ``弹药与弹药箱``。

    只删**末尾**那个括号组，且组内必须是 ASCII —— 中文本名里也可能有括号
    （「载具选型指南：背包与胸挂」没有，但「Prestige 转生」这类不能乱切）。
    """
    return re.sub(r"\s*[（(]\s*[A-Za-z][A-Za-z0-9 .,'&+-]*\s*[）)]\s*$", "", s).strip()


def clean_inline(s: str) -> str:
    s = INLINE_LINK.sub(r"\1", s)
    s = INLINE_CODE.sub(r"\1", s)
    s = INLINE_HTML.sub("", s)
    s = INLINE_BOLD.sub(r"\1", s)
    s = s.replace("\\", "")
    return MULTI_SPACE.sub(" ", s).strip()


def candidates(body: str, until_h2: bool = True):
    """按出现顺序产出（类型, 原文段落）—— 类型是 ``quote`` 或 ``para``。

    引用块也收：站内很多页面在标题下方用一句 ``> …`` 给出「这页讲什么」，
    那是最合适的摘要（如海关页的「任务最密集的一张图，前中期的必经之地」）。
    但版本基线也是引用块，所以调用方还要按 ``BAD_QUOTE`` 过滤。
    **列表行一律跳过** —— 它们多是导航清单，压平后是「A — 说明B — 说明」的残句。

    ``until_h2=True`` 只扫「页面前言」（h1 到第一个二级标题）。
    站内条目页的前言通常只有版本基线，所以还要有第二轮（``False``）：
    放行正文，靠「表格/列表/页脚」三条过滤兜住噪声。
    """
    buf: list[str] = []
    kind = ""
    for raw in body.split("\n"):
        line = raw.rstrip()
        if until_h2 and re.match(r"^##\s", line):
            if buf:
                yield kind, "\n".join(buf)
            return
        s = line.strip()
        if not s or line.startswith(("```", "---", "<")) or SKIP_LINE.match(line) or LIST_LINE.match(s):
            if buf:
                yield kind, "\n".join(buf)
                buf, kind = [], ""
            continue
        if s.startswith(">"):
            if buf and kind != "quote":
                yield kind, "\n".join(buf)
                buf = []
            kind = "quote"
            buf.append(s.lstrip("> ").strip())
            continue
        if buf and kind != "para":
            yield kind, "\n".join(buf)
            buf = []
        kind = "para"
        buf.append(s)
    if buf:
        yield kind, "\n".join(buf)


def cut(text: str) -> str:
    """压平换行并截到一句完整的话（≤ BODY_MAX 字）。"""
    text = MULTI_SPACE.sub(" ", text.replace("\n", " ")).strip()
    if len(text) <= BODY_MAX:
        return text
    m = max(text.rfind(c) for c in "。！？；")
    if 0 < m + 1 <= BODY_MAX:
        return text[: m + 1]
    return text[:BODY_MAX].rstrip("，、,;；：") + "…"


def _pick(body: str, until_h2: bool) -> str:
    fallback = ""
    for kind, raw in candidates(body, until_h2):
        text = clean_inline(raw)
        text = LEAD_EMOJI.sub("", text).strip()
        if len(text) < 10:
            continue
        if kind == "quote" and BAD_QUOTE.search(raw):
            continue
        if BAD_PARA.search(text) or BAD_GENERATED.search(text):
            continue
        # 链接清单压平后的典型形态：「A — 说明B — 说明」（单个破折号连接的短句串联）。
        # ⚠️ 必须先剔掉「——」再数：中文破折号在正文里到处都是（「搜刮、路线、撤离——只留下交火」），
        #    按单字统计会把正常句子误杀成「链接清单」。
        if text.replace("——", "").count("—") >= 2 or "›" in text:
            continue
        if re.search(r"[。！？；]", text):
            return cut(text)
        if not fallback and 10 <= len(text) <= 120:
            fallback = text
    return cut(fallback) if fallback else ""


def digest(body: str, allow_full: bool = True) -> str:
    """取最像「这页讲什么」的一段。找不到就返回空串，由调用方回退。

    两轮：先只看页面前言（最贴题），空了再放行全文 —— 站内条目页与生成页的
    前言往往只有版本基线，正文却在第一个二级标题之后。

    ``allow_full=False`` 用于图鉴分册：那些页面正文主体是几千行物品表，
    放行全文只会捞到「RShG-2 72.5 毫米火箭发射器」这种**物品名**当摘要。
    它们用栏目回退句（「物品图鉴分册，列名称、重量、占格与商人价格」）更准确。
    """
    t = _pick(body, True)
    if t or not allow_full:
        return t
    return _pick(body, False)


def topic_of(path: Path, body: str, nav_titles: dict[str, str]) -> str:
    h1 = strip_bracket_en(h1_of(body))
    if h1:
        return h1
    rel = path.relative_to(CONTENT).as_posix()
    return nav_titles.get(rel) or path.stem


def table_cell(body: str, label: str) -> str:
    """从「本页概览」表里取某一格的文本（去加粗、去内联 HTML）。"""
    m = re.search(rf"^\|\s*\*\*{re.escape(label)}\*\*\s*\|(.+?)\|\s*$", body, re.M)
    if not m:
        return ""
    cell = INLINE_HTML.sub("", m.group(1))
    cell = INLINE_BOLD.sub(r"\1", cell)
    return MULTI_SPACE.sub(" ", cell).strip()


def struct_facts(body: str) -> str:
    """用页面概览表里的**可区分数字**造摘要。

    为什么不能只靠栏目回退句
    ------------------------
    2026-11-05 复查实测：27 个图鉴页的 description 骨架完全相同
    （``{分类名}：物品图鉴分册，列名称、重量、占格与商人价格。``），
    11 个商人任务页同样共用一句。原注释说「独特性由 topic 前缀保证」——
    这句话是错的：前缀换一个分类名，搜索引擎看到的仍是同一句废话。

    这 27 + 11 页的正文主体是表格，没有可摘的散文段落，但它们**都有一个
    「收录件数 / 任务数」的格子**。把那个数字写进摘要，页面之间自然就分得开，
    而且这个数字来自生成器的产物、不用人维护 —— 与本站「同一件事只留一个来源」
    的规矩一致。
    """
    n = table_cell(body, "收录件数")
    if n:
        m = re.search(r"\d[\d,]*", n)
        if m:
            leaf = table_cell(body, "叶子分类")
            lm = re.search(r"(\d+)\s*个官方分类", leaf) if leaf else None
            mid = f"，{lm.group(1)} 个官方分类" if lm else ""
            return f"收录 {m.group(0)} 件{mid}，含名称、重量、占格与商人价格"
    n = table_cell(body, "任务数")
    if n:
        m = re.search(r"\d[\d,]*", n)
        if m:
            span = table_cell(body, "等级跨度")
            head = f"{m.group(0)} 个任务" + (f"、{span}" if span else "")
            return f"{head}，按等级门槛排序，含要求、奖励、前置与钥匙"
    return ""


def build_desc(topic: str, body: str, rel: str) -> str:
    facts = struct_facts(body)
    if facts:
        return f"{topic}：{facts}"
    # 图鉴**分册页**的正文是几千行物品表，放行全文只会捞到「RShG-2 72.5 毫米火箭发射器」
    # 这种物品名当摘要 —— 它们靠上面那条 struct_facts。
    # ⚠️ 2026-11-05 修：原来按 ``rel.startswith("catalog/")`` 一刀切，
    #    把 ``catalog/item.md``（单件详情视图页，正文是散文、没有物品表）也一起禁了，
    #    结果它回落到模板句。判据改成「页面里到底有没有物品表」。
    has_item_table = body.count('class="tk-ic"') > 50
    d = digest(body, allow_full=not has_item_table)
    if d:
        return f"{topic}：{d}"
    section = rel.split("/")[0] if "/" in rel else ""
    hint = SECTION_HINT.get(section, "《逃离塔科夫》中文百科")
    return f"{topic}：{hint}。"


def nav_titles() -> tuple[dict[str, str], Counter]:
    """从 mkdocs.yml 粗扫 nav 的「标题 → 文件」与标题重名统计。

    不用 yaml.safe_load：mkdocs.yml 里有 ``!!python/name:`` 标签，标准解析器直接报错。
    这里只需要两边都出现的 ``- 标题: 路径.md`` 行，正则足够，且不引入依赖。
    """
    text = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    pair = re.compile(r"^\s*-\s*(?P<title>[^:\n]+?)\s*:\s*(?P<path>[\w\-/]+\.md)\s*$", re.M)
    mapping: dict[str, str] = {}
    for m in pair.finditer(text):
        mapping.setdefault(m.group("path"), m.group("title").strip())
    # 裸路径项（`- README.md`）没有标题，Material 用文件名
    for m in re.finditer(r"^\s*-\s*(?P<path>[\w\-/]+\.md)\s*$", text, re.M):
        mapping.setdefault(m.group("path"), "")
    return mapping, Counter(t for t in mapping.values() if t)


def yaml_quote(s: str) -> str:
    """安全地放进 YAML 双引号标量。"""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def rewrite(path: Path, desc: str, title: str | None, force: bool) -> tuple[bool, str]:
    """写回一个文件。返回（是否改动, 说明）。"""
    text = path.read_text(encoding="utf-8")
    lines, body, head = split_front(text)

    has_auto = MARK in (lines.get("description") or "")
    has_manual_desc = "description" in lines and not has_auto
    if has_manual_desc and not force:
        return False, "人工 description，跳过"

    want_desc = f"{yaml_quote(desc)}  {MARK}"
    cur_desc = lines.get("description")
    new_head = head

    def set_key(head_text: str, key: str, value: str) -> str:
        pat = re.compile(rf"^{key}:.*$", re.M)
        if pat.search(head_text):
            return pat.sub(lambda _: f"{key}: {value}", head_text, count=1)
        return (f"{key}: {value}\n" + head_text) if head_text else f"{key}: {value}"

    changed = False
    if cur_desc != want_desc:
        new_head = set_key(new_head, "description", want_desc)
        changed = True

    if title:
        want_title = f"{yaml_quote(title)}  {MARK}"
        if lines.get("title") != want_title:
            if "title" not in lines or MARK in (lines.get("title") or "") or force:
                new_head = set_key(new_head, "title", want_title)
                changed = True

    if not changed:
        return False, "已是最新"

    out = f"---\n{new_head}\n---\n{body}" if new_head else body
    path.write_bytes(out.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    return True, "已写入"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报告，不写盘")
    ap.add_argument("--force", action="store_true", help="连人工写的 description 也重算")
    args = ap.parse_args()

    navs, nav_count = nav_titles()
    files = sorted(
        p for p in CONTENT.rglob("*.md") if p.name not in SKIP
    )

    # ① 先算全部描述，再查唯一性 —— 重复的两个都得改（只改一个仍会撞）。
    plan: list[tuple[Path, str, str, str]] = []  # (path, rel, desc, topic)
    for p in files:
        text = p.read_text(encoding="utf-8")
        _, body, _ = split_front(text)
        topic = topic_of(p, body, navs)
        plan.append((p, p.relative_to(CONTENT).as_posix(),
                     build_desc(topic, body, p.relative_to(CONTENT).as_posix()), topic))

    seen: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for _, rel, desc, topic in plan:
        seen[desc].append((rel, topic))
    dup = {d: v for d, v in seen.items() if len(v) > 1}

    # ② 撞车的描述用「目录名 + 主题」补足区分度
    fixed: dict[str, str] = {}
    for d, rows in dup.items():
        for rel, topic in rows:
            section = rel.split("/")[0] if "/" in rel else "首页"
            fixed[rel] = f"{d.rstrip('。')}（{section}栏目 · {topic}）"

    # ③ title：nav 标题在导航里重复出现（如 6 个「总览」）时，用 h1 覆盖
    title_changes: dict[str, str] = {}
    for p, rel, _, topic in plan:
        nav = navs.get(rel, "")
        if nav and nav_count.get(nav, 0) > 1 and topic and topic != nav:
            title_changes[rel] = topic

    if args.check:
        problems = 0
        print(f"扫描 {len(files)} 个页面 ｜ nav 标题撞车 "
              f"{sum(1 for t, n in nav_count.items() if n > 1)} 组 ｜ 将补 title {len(title_changes)} 页")
        for p, rel, desc, topic in plan:
            lines, _, _ = split_front(p.read_text(encoding="utf-8"))
            if "description" not in lines:
                problems += 1
                if problems <= 8:
                    print(f"  缺 description：{rel}")
        print(f"缺 description 的页面：{problems}")
        if dup:
            print(f"描述撞车 {len(dup)} 组（已按栏目名消歧）：")
            for d, rows in list(dup.items())[:3]:
                print("   " + d[:50] + f"  ×{len(rows)}")
        return 0 if problems == 0 and not dup else 1

    changed = skipped = 0
    fallback = 0
    for p, rel, desc, _ in plan:
        desc = fixed.get(rel, desc)
        if "：" in desc and desc.split("：", 1)[1].rstrip("。") in SECTION_HINT.values():
            fallback += 1
        did, why = rewrite(p, desc, title_changes.get(rel), args.force)
        if did:
            changed += 1
        elif why.startswith("人工"):
            skipped += 1

    print(f"✓ 写入 {changed} 页 ｜ 人工描述跳过 {skipped} 页 ｜ "
          f"title 覆盖 {len(title_changes)} 页 ｜ 描述撞车消歧 {len(fixed)} 页 ｜ "
          f"用栏目回退句 {fallback} 页")
    if dup:
        for d, rows in dup.items():
            print("  消歧：" + " / ".join(r[0] for r in rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
