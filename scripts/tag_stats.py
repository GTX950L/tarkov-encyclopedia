"""统计 content/ 下各 markdown 的 frontmatter 标签，输出标签 → 篇数与覆盖条目。

用法：
    python scripts/tag_stats.py            # 打印统计
    python scripts/tag_stats.py --check    # 仅检查是否有孤立/未登记标签

约定：只读取文件开头的 YAML frontmatter 中的 tags 列表，不引入 PyYAML，
避免处理 !!python/name: 之类自定义标签时误报。
"""
import io
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "content")
ROOT = os.path.abspath(ROOT)

TAG_LINE = re.compile(r"^\s*-\s*(.+?)\s*$")


def read_tags(path):
    tags = []
    with io.open(path, encoding="utf-8") as f:
        lines = f.readlines()
    if not lines or lines[0].strip() != "---":
        return tags
    i = 1
    in_tags = False
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        if s == "---":
            break
        if s.startswith("tags:"):
            inline = s[len("tags:"):].strip()
            if inline.startswith("[") and inline.endswith("]"):
                for part in inline[1:-1].split(","):
                    part = part.strip().strip("\"'")
                    if part:
                        tags.append(part)
            else:
                in_tags = True
            i += 1
            continue
        if in_tags:
            m = TAG_LINE.match(raw)
            if m:
                tags.append(m.group(1).strip().strip("\"'"))
            elif s and not s.startswith("#"):
                in_tags = False
        i += 1
    return tags


def main():
    files = []
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        for fn in filenames:
            if fn.lower().endswith(".md"):
                files.append(os.path.join(dirpath, fn))
    files.sort()

    tagmap = defaultdict(list)
    for path in files:
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        stem = os.path.splitext(os.path.basename(rel))[0]
        for t in read_tags(path):
            tagmap[t].append(stem)

    for tag in sorted(tagmap, key=lambda t: (-len(tagmap[t]), t)):
        items = tagmap[tag]
        print(f"{tag}\t{len(items)}\t{' · '.join(items)}")

    print("\n--- 汇总 ---")
    print(f"文件总数: {len(files)}")
    print(f"标签总数: {len(tagmap)}")

    if "--check" in sys.argv:
        single = [t for t in tagmap if len(tagmap[t]) == 1]
        if single:
            print(f"\n⚠️ 仅覆盖一篇的标签（{len(single)}）: {' · '.join(sorted(single))}")


if __name__ == "__main__":
    main()
