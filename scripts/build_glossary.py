# -*- coding: utf-8 -*-
"""
从 content/docs/glossary.md 抽取术语，生成 content/javascripts/terms-data.js

设计要点：
- **术语表是唯一数据源**——改了 glossary.md，重新构建即可，不用手改两处。
- 表格列数不统一（2 列 / 3 列），所以：第 1 列 = 术语名（可能含 `/` 分隔的别名），
  最后一列 = 说明，中间列（若有）= 原文 / 全称。
- 说明里的 markdown 标记（**加粗**、[链接](...)）要剥掉——tooltip 只显示纯文本。
"""
import os
import re
import sys
import json
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "content", "docs", "glossary.md")
DST = os.path.join(ROOT, "content", "javascripts", "terms-data.js")

# 这些词太通用，标在正文里会到处命中，反而吵——不参与自动标注。
# 注意：只排除"正文里通常已自行解释过的通用概念"，专有缩写（如 BTR）要保留。
SKIP_KEYS = {
    "声望", "好感", "手续费", "信誉值", "转场", "转生", "联赛", "竞技场",
    "中心区", "地面零点", "安全箱型号", "三种档案", "穿深", "碎甲", "人机工效",
    "以物换物", "跳蚤市场", "赛季修改器", "边界狙击手",
}
# 最少字符数（英文按 2、中文按 2——主要是排除单字母误匹配）
MIN_LEN = {"en": 2, "zh": 2}


def plain(text: str) -> str:
    """把 markdown 行内标记剥成纯文本"""
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)   # 链接 -> 文字
    text = text.replace("**", "").replace("*", "")
    text = re.sub(r"`([^`]*)`", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def tables(md: str):
    """切出所有 markdown 表格块（跳过分隔行）"""
    cur = []
    for line in md.split("\n"):
        if line.strip().startswith("|"):
            cur.append(line.strip())
        else:
            if len(cur) >= 3:
                yield cur
            cur = []
    if len(cur) >= 3:
        yield cur


def split_row(row: str):
    return [c.strip() for c in row.strip("|").split("|")]


def main():
    md = open(SRC, encoding="utf-8").read()
    terms, seen = [], {}

    for tbl in tables(md):
        header = " ".join(split_row(tbl[0]))
        # 只吃"术语表"性质的表格；社区俗称表（俗称/实际指/备注）也算，它是别名映射
        if not re.search(r"术语|俗称", header):
            continue
        for row in tbl[2:]:                                  # 跳过表头与分隔行
            cells = split_row(row)
            if len(cells) < 2:
                continue
            raw_name = plain(cells[0])
            if not raw_name or raw_name in ("术语", "俗称"):
                continue
            desc = plain(cells[-1])
            full = plain(cells[1]) if len(cells) >= 3 else ""
            if not desc:
                continue

            keys = [plain(k).strip() for k in raw_name.split("/") if plain(k).strip()]
            keys = [k for k in keys if k]
            keys = [k for k in keys
                    if k not in SKIP_KEYS
                    and len(k) >= (MIN_LEN["zh"] if re.search(r"[\u4e00-\u9fff]", k) else MIN_LEN["en"])]
            if not keys:
                continue

            key = keys[0]
            if key in seen:
                continue                                     # 同名术语只收第一条
            seen[key] = True
            terms.append({"keys": keys, "full": full, "desc": desc})

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    payload = json.dumps(terms, ensure_ascii=False, indent=1)
    with open(DST, "w", encoding="utf-8") as f:
        f.write("/* 由 scripts/build_glossary.py 从 content/docs/glossary.md 自动生成，请勿手改 */\n")
        f.write("window.TARKOV_TERMS = ")
        f.write(payload)
        f.write(";\n")

    print(f"✅ 生成 {len(terms)} 条术语 -> {os.path.relpath(DST, ROOT)}")
    for t in terms[:12]:
        print(f"   {' / '.join(t['keys']):<24} {t['desc'][:46]}")
    if len(terms) > 12:
        print(f"   ...（共 {len(terms)} 条）")


if __name__ == "__main__":
    main()
