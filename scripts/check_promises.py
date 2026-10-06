#!/usr/bin/env python3
"""未决项承诺对账：`citation.md` 第三节的承诺 vs 正文实际（只读，不改文件）。

为什么需要它
------------
`content/docs/citation.md` 第三节把站内自己没对齐的事项逐条登记，并写明
**「站内现行处理」**（并列两说 / 不写数字 / 标注社区口径 / 标记尚未实装…）。
它是**写给引用者看的**——玩家、UP 主、AI 拿到单篇时，靠这一页判断
「哪一句能直接引、哪一句要加限定语」。

问题是：**这份规范此前没有任何检查器**。正文一改，声明就悄悄过期，
而照着它引用的人会被误导。第三十七批的文本层审查实测出 5 处「声明与正文不符」，
其中 2 处是**断言根本不在登记所指向的那一页**（A1、A6）——
按登记去找，一处也找不到。

本脚本做四件事，任何一件不成立即返回 1：

1. **覆盖对账**：第三节里的每个编号，都必须在下面的 `ASSERTIONS` 里有断言登记。
   —— 新增未决项时**必须同一批**在这里写清「去哪一页、找什么」，否则 CI 直接拦下。
2. **反向对账**：`ASSERTIONS` 里的编号必须在第三节仍然存在（防删了未决项却留着断言）。
3. **逐条对账**：每条断言按「文件 + 正则 + 必须命中/必须不命中」实跑。
4. **计数对账**：正文里写死的那句「A / B 两类共 N 项」必须与实算一致。
   —— 第四十九批发现该句长期停在 **17**，而当时实算已是 **19**：**没有断言在看它**。
   「声明了却没人检查」正是这类数字漂移的成因，故一并纳入（与 §5x 的判据同源）。

用法：python scripts/check_promises.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
CITATION = CONTENT / "docs" / "citation.md"

# 第三节的表格行：| **A1** | 事项 | 分歧点 | 现行处理 |   （B 类只有三列）
ROW_RE = re.compile(r"^\|\s*\*\*([AB]\d+)\*\*\s*\|")

# 正文里写死的计数声明（防「声明了却没人检查」——第四十九批实测它已漂移 17 vs 19）
COUNT_RE = re.compile(r"A / B 两类共\s*(\d+)\s*项")

# ─────────────────────────────────────────────────────────────────────────────
# 断言登记表
#
# 每条 = (相对 content/ 的文件, 正则, 必须命中?, 说明)
# 「必须不命中」用于**阴性断言**——那类断言的价值最高：它把「不该出现的数字」
# 钉住，防止旧值被无意写回（A9 就是这么防住的）。
# ─────────────────────────────────────────────────────────────────────────────
ASSERTIONS: dict[str, list[tuple[str, str, bool, str]]] = {
    # ── A 类：两处来源口径不一致 ────────────────────────────────────────────
    "A1": [
        # 2026-09-30（第四十五批）：口径从「未对齐」升级为「已查明 = 公告 vs 上线」，
        #   断言随之从「钉住 4 个」改为「两个口径都必须同时在场」——只留任一个都算漏改。
        ("entries/quests.md", r"公告[^\n]{0,6}4 条", True,
         "公告口径：官方 1.1.0.0 公告列 4 条关键任务（基本信息表 1 处）"),
        ("entries/quests.md", r"实测为 5 组", True,
         "上线口径：直接前置为 5 组（核心机制 1 处；与上一条必须同时出现）"),
        ("docs/version-history.md", r"前置任务减至", True,
         "版本更新史里同一断言（第 3 处，公告口径 + 括注上线差异）"),
        ("entries/trader-questlines.md", r"上线后实测", True,
         "商人任务线图鉴的 Kappa 专节：公告 vs 上线逐条对照表（第 4 处）"),
    ],
    "A2": [
        ("entries/pve.md", r"以游戏内", True, "并列两说后要求以游戏内为准"),
    ],
    "A3": [
        ("entries/traders.md", r"以游戏内", True, "以游戏内商人面板写明的条件为准"),
    ],
    "A4": [
        ("entries/mail.md", r"没有公布", True,
         "必须明写「官方没有公布统一期限表」，再把流传说法当成分歧的证据"),
    ],
    "A5": [
        ("entries/scav-command.md", r"只能带 1 个", True, "并列第一说"),
        ("entries/scav-command.md", r"1–4 个", True, "并列第二说"),
    ],
    "A6": [
        ("entries/engagement-rules.md", r"社区口径", True,
         "持续局数是社区口径——断言在交战规则页，**不在灯塔页**"),
        ("entries/lighthouse.md", r"community|社区口径认为", False,
         "灯塔页不应把该细节当成自己的结论复述（应只留指路）"),
    ],
    "A7": [
        ("entries/night-vision.md", r"代际不是型号", True, "逐型号说明、不按系列批量归类"),
    ],
    "A8": [
        ("entries/bosses.md", r"尚未实装", True, "Povodyr 标记尚未实装"),
    ],
    "A10": [
        ("entries/combat-medical.md", r"16 / 20 秒", True,
         "并列第一说：中文 Wiki 物品表的 CMS 16 秒 / Surv12 20 秒"),
        ("entries/combat-medical.md", r"5–7 秒", True,
         "并列第二说：社区实测常报的 5–7 秒"),
    ],
    "A11": [
        ("entries/combat-medical.md", r"1\.36", True,
         "现行口径：轻度出血 1.36 HP / 6 秒（每未损毁部位）"),
        ("entries/combat-medical.md", r"0\.8", True,
         "旧口径：轻度出血 0.8（中文资料仍在沿用，须并列保留）"),
    ],
    # 2026-09-30（第四十九批）新增：读者问「救星结局到底怎么逃离的塔科夫」时，
    #   顺带查出四个结局的叙述在「是否真的离开」上存在来源分歧。**断言在实体页**
    #   （story-chapters.md），与 A1 / A6「断言不在实体页」的情况正好相反。
    "A12": [
        ("entries/story-chapters.md", r"Escaped from Tarkov", True,
         "官方成就名含 Escape —— 站内按官方口径处理（旧债沉疴 / 陨落之人都算离开了）"),
        ("entries/story-chapters.md", r"没能离开塔科夫", True,
         "社区另说必须并列保留，不得只留官方一说"),
        ("entries/story-chapters.md", r"把子任务名当成了结局", True,
         "必须点明分歧的来源：`\"Stay in Tarkov\"` 是债务的比喻，不是结局事实"),
    ],
    # A9（实验室暗版门槛）已于 2026-09-29 核实并**移出**第三节：按英文 EFT Wiki 的
    #   Events 页，入场靠 TerraGroup Labs 访问钥匙卡、与等级无关；正文已直接写出
    #   并标注来源层级。原来那条「不许回写 100 级」的断言移到了下面的 LEGACY_WRONG
    #   —— **未决项一旦核实移出，断言就不能留在本表里**（否则反向对账会报「脚本里有、本表已无」）。
    # ── B 类：口径不稳（只有社区口径 / 官方明说会变）────────────────────────
    "B1": [
        ("entries/scav-command.md", r"社区", True, "指令成功率百分比标为社区口径"),
    ],
    "B2": [
        ("entries/engagement-rules.md", r"knowledge/519", True,
         "业力规则要留可查的一级来源指针"),
        ("entries/engagement-rules.md", r"官方", True, "正文按官方口径写（本类情形②）"),
    ],
    "B3": [
        ("entries/engagement-rules.md", r"持续实装与平衡", True,
         "必须写出「官方会持续调整」，否则读者会把当前档位当定论"),
    ],
    "B4": [
        ("entries/headsets.md", r"拉平", True, "0.16.5.0 起音量差已被官方拉平"),
        ("entries/headsets.md", r"曲线", False, "站内不再引用任何放大曲线数值"),
    ],
    "B5": [
        ("entries/prestige.md", r"尚未公布", True, "PvE 专属门槛官方尚未公布"),
    ],
    "B6": [
        ("entries/prestige.md", r"旧数据", True, "「55 级 / 200 万」须标为过时数据"),
    ],
    "B7": [
        ("entries/spawn-and-opening.md", r"社区", True,
         "社区观察须标出；「不写数字」指不写点位级精确值"),
    ],
    "B8": [
        ("entries/armor-catalog.md", r"以游戏内为准", True, "面部装备的附加效果以游戏内为准"),
    ],
    "B9": [
        ("entries/labs.md", r"社区", True,
         "钥匙卡表的性质与产出来自社区来源，表注必须写明"),
    ],
    # 2026-09-30（第四十九批）新增：四个结局的**叙事演出**只有社区口径。
    #   官方公布了结局名与成就文本，但**没有以文本形式公布结局演出**——
    #   「船长被击毙」「城市遭核打击」这类情节全部来自社区通关录像与媒体报道。
    "B10": [
        ("entries/story-chapters.md", r"并未以文本形式公布", True,
         "必须明写「结局演出没有官方文本」——这是本项存在的理由"),
        ("entries/story-chapters.md", r"社区实录与媒体报道", True,
         "来源须标为社区实录与媒体报道，不得写成官方设定"),
    ],
    "B11": [
        # 进度页必须写明「Fence 声望可填负数」与「留空只提示不计入」——
        # 这两条是本项存在的理由：Fence 用负值刻度，且「未填」不能被当成「满足」。
        ("quests/progress.md", r"Fence 声望", True,
         "进度页须出现 Fence 声望输入项"),
        ("quests/progress.md", r"负数", True,
         "须写明 Fence 声望可填负数——它与商人忠诚度不是一把尺"),
        ("quests/progress.md", r"留空", True,
         "须写明留空时只提示、不计入可接（不得让「未填」被读成「满足」）"),
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# 历史错值黑名单（**不属于第三节**，条目不随未决项的增删而变）
#
# 为什么单独立一个：未决项核实完就从第三节移出，**断言也必须一起撤掉**（否则反向
# 对账会报「脚本里有、本表已无」）。但「订正过的错值不许回写」这条护栏不该跟着消失
# —— 一个错数字被订正掉之后，最容易发生的事就是下一批又从旧资料里抄回来。
# 所以把这类值集中记在这里：**它们是「已经证否的数字」，不是「待核的项」。**
#
# 每条 = (相对 content/ 的文件, 正则, 说明)　—— 命中即报错。
# ─────────────────────────────────────────────────────────────────────────────
LEGACY_WRONG: list[tuple[str, str, str]] = [
    ("entries/labs.md", r"100\s*级",
     "「暗版实验室 = 100 级」是 2026-09-29 已证否的旧值（等级上限只有 79，且入场靠钥匙卡、与等级无关）"),
]


def declared_ids() -> list[str]:
    """第三节里登记的全部编号（按出现顺序）。"""
    ids: list[str] = []
    for line in CITATION.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if m:
            ids.append(m.group(1))
    return ids


def main() -> int:
    if not CITATION.exists():
        print(f"找不到 {CITATION}")
        return 1

    ids = declared_ids()
    errors: list[str] = []
    rows: list[tuple[str, str, str, str]] = []  # (id, 文件, 结果, 说明)

    # 1. 覆盖：第三节的每个编号都要有断言
    for i in ids:
        if i not in ASSERTIONS:
            errors.append(
                f"{i} 在 citation.md 第三节里，但本脚本没有它的断言 —— "
                f"请在 ASSERTIONS 里补一条「(文件, 正则, 必须命中?, 说明)」"
            )

    # 2. 反向：断言表里的编号要在第三节里
    for i in ASSERTIONS:
        if i not in ids:
            errors.append(f"{i} 在本脚本的断言表里，但 citation.md 第三节已无此编号（是否已核实移出？）")

    # 3. 逐条实跑
    for i in sorted(ASSERTIONS, key=lambda s: (s[0], int(s[1:]))):
        for rel, pattern, must, note in ASSERTIONS[i]:
            path = CONTENT / rel
            if not path.exists():
                rows.append((i, rel, "✗ 文件不存在", note))
                errors.append(f"{i}：断言文件不存在 {rel}")
                continue
            text = path.read_text(encoding="utf-8")
            hit = re.search(pattern, text) is not None
            ok = hit if must else not hit
            verdict = "✓" if ok else ("✗ 应命中而未命中" if must else "✗ 不应出现却出现了")
            rows.append((i, rel, verdict, note))
            if not ok:
                errors.append(
                    f"{i}：{rel} 里「{pattern}」"
                    + ("应命中而未命中" if must else "**不应出现却出现了**")
                    + f"（{note}）"
                )

    # 4. 计数对账：正文写死的「A / B 两类共 N 项」必须与实算一致
    #    「匹配不到就报错」是刻意的 —— 声明句消失属于规范被破坏，不能静默通过。
    cited = COUNT_RE.search(CITATION.read_text(encoding="utf-8"))
    if not cited:
        errors.append(
            "计数声明缺失（citation.md 第三节）：找不到「A / B 两类共 N 项」这句，"
            r"预期模式「A / B 两类共 (\d+) 项」"
        )
    elif int(cited.group(1)) != len(ids):
        errors.append(
            f"未决项计数不一致：citation.md 写「共 {cited.group(1)} 项」，实算 {len(ids)} 项 "
            f"—— 请把该句改为「A / B 两类共 {len(ids)} 项」"
        )

    # 5. 历史错值黑名单：已证否的旧值不许回写
    legacy_rows: list[tuple[str, str, str]] = []
    for rel, pattern, note in LEGACY_WRONG:
        path = CONTENT / rel
        if not path.exists():
            errors.append(f"历史错值黑名单：文件不存在 {rel}")
            continue
        hit = re.search(pattern, path.read_text(encoding="utf-8")) is not None
        legacy_rows.append((rel, "✗ 旧值被写回来了" if hit else "✓ 未出现", note))
        if hit:
            errors.append(f"历史错值黑名单：{rel} 里出现了「{pattern}」—— {note}")

    # ── 输出 ────────────────────────────────────────────────────────────────
    print("=" * 78)
    print("未决项承诺对账（只读，未改动任何文件）")
    print("=" * 78)
    print(f"citation.md 第三节登记编号：{len(ids)} 个 —— {'、'.join(ids)}")
    print(f"断言登记：{len(ASSERTIONS)} 个编号 / {sum(len(v) for v in ASSERTIONS.values())} 条断言")
    print(f"计数对账：正文声明「共 {cited.group(1) if cited else '?'} 项」 / 实算 {len(ids)} 项")
    print(f"历史错值黑名单：{len(LEGACY_WRONG)} 条")
    print("-" * 78)
    cur = None
    for i, rel, verdict, note in rows:
        if i != cur:
            print(f"\n【{i}】")
            cur = i
        print(f"  {verdict:<14} {rel:<34} {note}")
    if legacy_rows:
        print("\n【历史错值（不属于第三节，防回写）】")
        for rel, verdict, note in legacy_rows:
            print(f"  {verdict:<18} {rel:<34} {note}")
    print("\n" + "=" * 78)
    if errors:
        print(f"校验失败，共 {len(errors)} 个问题：")
        for e in errors:
            print(f"  [错误] {e}")
        return 1
    print(
        f"✅ 校验通过：第三节 {len(ids)} 项承诺逐条对账通过，"
        f"计数声明与实算一致（{len(ids)} 项），正文无遗漏登记；"
        f"{len(LEGACY_WRONG)} 条历史错值未回写。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
