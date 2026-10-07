"""审计 ammo-table.md / ammo.md 里所有「N 级档」标注是否与换算关系自洽。

换算关系（本轮实测确立）：**档位 N ⇒ 穿深 ≥ (N−1) × 10**，即「能有效对付 N−1 级甲」。
判据来源：站内 ammo.md 的 6 组示例全部符合该式（PS 28→3、BT 37→4、BS 54→5、M993 65→6）。

只读，不改任何文件。

⚠️ **刻意不接进 CI**：弹名与口径的对应是启发式的（同一个弹名可能跨口径，
如 BT 在 5.45 与 7.62x54 下都有），会有假阳性。它是一把**审计工具**，不是门禁 ——
跑出来的每一条都要人工确认指向哪条弹。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rows = json.loads((ROOT / "scripts/data/ammo_values.json").read_text(encoding="utf-8"))["rows"]

# 弹名 → [(口径, 穿深)]；重名时取最大穿深并单独报「同名歧义」
pen: dict[str, list] = {}
CAL_OF: dict[str, list] = {}
for r in rows:
    pen.setdefault(r["name"], []).append(r["pen"])
    CAL_OF.setdefault(r["name"], []).append((r["cal"], r["pen"]))
ambiguous: list[str] = []

TARGETS = [ROOT / "content/entries/ammo-table.md", ROOT / "content/entries/ammo.md"]
PAT = re.compile(r"([^|，（(、]{1,24}?)（(\d)\s*级档[^）]*）")

print("口径：档位 N ⇒ 穿深 ≥ (N−1)×10")
print("=" * 78)
issues = 0
seen = 0
for f in TARGETS:
    txt = f.read_text(encoding="utf-8")
    for m in PAT.finditer(txt):
        names = [x.strip().strip("*`、，") for x in re.split(r"[、,／/]", m.group(1))]
        tier = int(m.group(2))
        for nm in names:
            nm = re.sub(r"[（(].*?[)）]", "", nm).strip()
            if not nm or nm in ("等", "高"):
                continue
            cands = pen.get(nm)
            if cands is None:
                continue          # 站内叫法与数据表不一致，另议
            # ⚠️ **同名歧义**：同一个弹名可能存在于多个口径（BT 有 5.45 的，也有 7.62x54 的
            # SP BT / HP BT）。本脚本不带行内口径上下文，所以取得最大穿深 —— 报出来的
            # 问题**必须先确认指向的是哪条弹**再改（实测就有一条是「表里写了个不存在的
            # 弹名」而不是档位错）。这跟任务重名是同一类坑。
            cals = {c for c, _ in CAL_OF.get(nm, [])}
            if len(cals) > 1:
                ambiguous.append(f"{f.name} 「{nm}（{tier} 级档）」—— 该名在 {len(cals)} 个口径下都有")
            seen += 1
            p = max(cands)
            need = (tier - 1) * 10
            if p < need:
                issues += 1
                print(f"✗ {f.name:20} 「{nm}（{tier} 级档）」 穿深 {p} < 门槛 {need}"
                      f"  → 按换算应降到 {p // 10 + 1} 级档")
print(f"\n可核对的标注 {seen} 条，不符合换算的 {issues} 条")
