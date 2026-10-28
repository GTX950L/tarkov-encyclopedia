#!/usr/bin/env python3
"""楼层归属与开关点位对账 —— 「哪些顶层分组是楼层」「哪些开关要画」这两件事，
必须机器可查。

为什么需要它
------------
换层靠 `<g id>` 名 + `gen_maps.FLOOR_ZH` 白名单：命中就生成按钮、切换时互相隐藏。
白名单漏一个名字，那一层**既不会被隐藏、也不会有按钮** —— 它会永远停在默认可见
状态，表现为「几层叠在一起」。2026-10-28 的工厂就是这么坏的：`Factory.svg` 顶层有
`Basement` / `Ground_Floor` / `Second_Floor` / `Third_Floor`，词表只认识后两个，
首屏是地下 + 1 层 + 2 层叠加，界面却写着「2 层」。而且它看着**比单层更「完整」**，
是那种「不报错、不空白、反而更满」的坏法，最难被发现。

`gen_maps.py` 现在生成时就会对未归类的顶层分组报错（同一判据）。本脚本是它的
**独立复核**，并多查三件生成器管不到的事：

  ① **产物是否落后于源**：`maps_site.json` 里 floors 的 id 必须与 SVG 现有顶层
     分组中的楼层部分**集合相等** —— 换了底图却忘了重跑生成器，产物还指着已经
     不存在的层（按钮点了没反应，或凭空多一个空按钮）；
  ② **按钮会不会重名**：词表里 `Ground_Floor` 与 `First_Floor` 都叫「1 层」，
     哪张图同时出现这两个分组，读者就会看到两个「1 层」；
  ③ **默认层是否唯一且是「地面类」**：按钮顺序是「地下在最前」，默认层若退化成
     `floors[0]`，一进页面就落在漆黑的地下室。

只读，不改任何文件。退出码：有问题 → 1，全通过 → 0。

用法：
    python scripts/check_map_floors.py
"""
from __future__ import annotations

from _console import setup as _setup_console

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

# 判据只认生成器那一份 —— 两处各写一套词表，迟早会漂成两套口径。
# 用模块引用（`gm.X`）而不是 `from ... import X`：单测里能替换词表来验证
# 「本脚本真的会红」，否则它可能是个永远绿的摆设。
import gen_maps as gm  # noqa: E402  （必须在 sys.path 之后）

SVG_DIR = ROOT / "content" / "assets" / "maps"
SITE = ROOT / "scripts" / "data" / "maps_site.json"


def main() -> int:
    _setup_console()
    if not SITE.exists():
        print(f"[错误] 缺产物：{SITE.relative_to(ROOT)} —— 先跑 python scripts/gen_maps.py")
        return 1

    site = json.loads(SITE.read_text(encoding="utf-8"))
    by_svg = {v.get("svg"): (k, v) for k, v in site.items() if v.get("svg")}

    problems: list[str] = []
    n_svg = n_top = n_floor = 0

    for svg in sorted(SVG_DIR.glob("*.svg")):
        n_svg += 1
        tops = gm.top_groups(svg.read_text(encoding="utf-8", errors="replace"))
        ids = [g["id"] for g in tops]
        n_top += len(ids)

        # ① 源：顶层分组必须有归属（是楼层，或明确声明不是楼层）
        stray = [i for i in ids if i not in gm.FLOOR_ZH and i not in gm.FLOOR_STATIC]
        if stray:
            problems.append(
                f"{svg.name}：{len(stray)} 个顶层分组没有归属 → {stray}\n"
                f"      · 是楼层：加进 gen_maps.FLOOR_ZH（想清楚按钮上叫什么、排第几）\n"
                f"      · 不是楼层：加进 gen_maps.FLOOR_STATIC 并写明原因"
            )

        # ② 产物对账
        hit = by_svg.get(svg.name)
        if not hit:
            problems.append(f"{svg.name}：maps_site.json 里没有对应条目（产物落后于源？）")
            continue
        key, meta = hit
        floors = meta.get("floors") or []
        got = [f["id"] for f in floors]
        want = [i for i in ids if i in gm.FLOOR_ZH]
        n_floor += len(want)

        if set(got) != set(want):
            extra, miss = sorted(set(got) - set(want)), sorted(set(want) - set(got))
            problems.append(
                f"{key}：floors 与 SVG 顶层分组不一致"
                + (f"｜产物多出 {extra}" if extra else "")
                + (f"｜产物缺少 {miss}" if miss else "")
                + "\n      → 重跑 python scripts/gen_maps.py（含 --mode pve 与 --merge）"
            )

        # ②b 同名按钮
        names = [f.get("cn") for f in floors]
        dup = sorted({n for n in names if names.count(n) > 1})
        if dup:
            problems.append(
                f"{key}：按钮重名 {dup} —— 同一张图里有两个同名分组成楼层了"
            )

        # ③ 默认层
        defs = [f["id"] for f in floors if f.get("default")]
        if floors and len(defs) != 1:
            problems.append(f"{key}：default 层应恰好 1 个，实得 {len(defs)} → {defs}")
        elif defs and defs[0] not in gm.FLOOR_DEFAULT:
            problems.append(
                f"{key}：默认层 {defs[0]} 不在「地面类」{list(gm.FLOOR_DEFAULT)} 里 —— "
                f"按钮顺序是地下在最前，默认层选错会让读者一进页面就落在暗处"
            )

        # ④ 常显层对账
        st_got, st_want = set(meta.get("floorStatic") or []), {
            i for i in ids if i in gm.FLOOR_STATIC
        }
        if st_got != st_want:
            problems.append(
                f"{key}：floorStatic 不一致｜产物={sorted(st_got)}｜SVG={sorted(st_want)}"
            )

    # 反向：产物里有条目但 SVG 不存在
    svg_names = {p.name for p in SVG_DIR.glob("*.svg")}
    for name, (key, _) in by_svg.items():
        if name not in svg_names:
            problems.append(f"{key}：产物指向的 {name} 不存在")

    # ⑤ 开关 / 拉闸点（2026-10-28）
    #    判据四条：数量对得上、每个都有中文名、坐标落在画布内、联动目标在同图里。
    #    另加一条反向：SWITCH_ZH 里定义了但产物没用上的 —— 那就是上游改名了，
    #    比「少画一个点」更值得提前发现（读者会以为那个闸不存在）。
    sw_all = [(k, s) for k, m in site.items() for s in (m.get("switches") or [])]
    expect_drawn = gm.SWITCH_EXPECT - len(gm.SWITCH_OUT_OF_CANVAS)
    if len(sw_all) != expect_drawn:
        problems.append(
            f"开关点位应有 {expect_drawn} 个（上游 {gm.SWITCH_EXPECT} 个，"
            f"其中 {len(gm.SWITCH_OUT_OF_CANVAS)} 个已知画不出），实得 {len(sw_all)} —— "
            f"上游变了，还是 gen_maps.SWITCH_WANT 的筛选规则要跟着改？"
        )
    for key, s in sw_all:
        if not s.get("n"):
            problems.append(f"{key}：开关 {s.get('en')} 没有中文名")
            continue
        vb = site[key]["viewBox"]
        px, py = s["p"]
        if not (vb[0] - 1 <= px <= vb[0] + vb[2] + 1
                and vb[1] - 1 <= py <= vb[1] + vb[3] + 1):
            problems.append(
                f"{key}：开关「{s['n']}」坐标 ({px}, {py}) 落在画布外 —— "
                f"投影公式或底图换了？"
            )
        same = {x.get("n") for x in site[key]["switches"]}
        for tgt in (s.get("acts") or []):
            if tgt and tgt not in same:
                problems.append(f"{key}：开关「{s['n']}」的联动目标「{tgt}」不在这张图的开关里")
        if s.get("dep") and s["dep"] not in same:
            problems.append(f"{key}：开关「{s['n']}」的依赖「{s['dep']}」不在这张图的开关里")
    used = {s.get("en") for _, s in sw_all}
    # 「已知画不出来」的那条不算冗余 —— 它是记在案的事实，不是漏画
    unused = [k for k in gm.SWITCH_ZH
              if k not in used and k not in gm.SWITCH_OUT_OF_CANVAS]
    if unused:
        problems.append(
            f"SWITCH_ZH 里有 {len(unused)} 条没被任何产物用上（上游改名了？）：{unused}\n"
            f"      → 若是改名：把新名字补进 SWITCH_ZH、删掉旧的；若是筛选规则改了："
            f"同步改 SWITCH_EXPECT"
        )

    if problems:
        print(f"[失败] 楼层归属 / 开关点位对账发现 {len(problems)} 处问题：\n")
        for i, p in enumerate(problems, 1):
            print(f"  {i}. {p}")
        print(
            "\n这组判据防的是两件事：①「楼层漏收 → 没有按钮能关 → 几层永久叠在一起」"
            "\n（2026-10-28 工厂就是这么坏的）；②「开关没画 / 画错位置 / 上游改名后静默消失」。"
        )
        return 1

    print(
        f"[通过] {n_svg} 张底图 ｜ 顶层分组 {n_top} 个 ｜ 楼层容器 {n_floor} 个 ｜ "
        f"开关 {len(sw_all)} 个（另有 {len(gm.SWITCH_OUT_OF_CANVAS)} 个已知画不出）"
        f" —— 全部有归属，产物与源一致"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
