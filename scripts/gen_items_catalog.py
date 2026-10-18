#!/usr/bin/env python3
"""生成「物品图鉴」栏目：86 个叶子分类按大类归并成页 + 静态全量表格 + 站内检索。

数据源
------
``json.tarkov.dev/regular/items`` ＋ ``items_zh``（二级来源，直读游戏文件）。
物品的 ``categories`` 是**完整路径**（叶 → 中 → 根），所以每件物品能唯一定位叶子分类。

为什么分类轴用 ``itemCategories`` 而不是 ``handbookCategories``
---------------------------------------------------------------
``handbookCategories`` 有 88 个分类，但**中文名一个都没有**（实测 0/88）——
数据端点没给译文。``itemCategories`` 有 112 个、**112/112 全部有中文译名**，
且带完整父子层级。所以本站以 ``itemCategories`` 为准。
其中 34 个分类客户端本身就没汉化（译名就是英文原文），由 ``ZH_FIX`` 补站内译名。

产出
----
1. ``content/catalog/*.md``    —— 每个大类一页，**静态 Markdown 表格**（构建期生成，
   零 JS 也能读全，符合「弱网可读」定位）；JS 只做检索与筛选增强。
2. ``content/javascripts/catalog-data.js`` —— 精简字段 + 分块（按大类切），
   仅在 ``/catalog/`` 下的页面由 ``catalog.js`` 按需注入。
3. ``content/javascripts/catalog.js`` —— 站内检索 + 多维筛选 + 详情面板。

对账（失败即退出码 1，不写盘）
------------------------------
* 叶子分类集合 ＝ 接口的叶子集合（多一个少一个都报错）；
* 各页件数之和 ＝ 去 preset 后的物品总数；
* 页面清单 ＝ nav 实际存在的 md 文件；
* 每页表格行数 ＝ 该页声明的件数。

列规格（`COL_SPECS`）—— 静态表与 JS 表共用一份
------------------------------------------------
列**不再写死在两处**（`page_markdown()` 的 Markdown 表头 + `catalog.js` 的 JS 表头），
而是由本文件产出、随 `catalog-data.js` 的 `index[slug].cols` 下发给前端。理由与
唯一一个「逐页不同列」的用例（钥匙页）见 `COL_SPECS` 的注释。

**加列时的动作清单**：① 改 `COL_SPECS` 的 `cols` 与 `header`/`sep`；② 若用的是表外字段，
写进 `EXTRA_ALWAYS`（每页都有、下标固定）或 `EXTRA_OPTIONAL`（只为用到的页面追加），
并在 `collect()` 或 `annotate_acquisition()` 里给它赋值；③ 在 `cell_md()` 与
`content/javascripts/catalog.js` 的 `FMT` 里各写一个格式器（两处是一对）。
`assert_md_header()` 会拦住「只改了表头没改规格」这类静默错误。

⚠️ **生成页写盘一律用 ``write_bytes``，不要用 ``write_text``。**

Windows 上 ``write_text`` 开文本模式，会把已经存在的换行再转一次。先手动
把 ``\n`` 转成 ``\r\n`` 再写，落到磁盘上就是 ``\r\r\n`` —— 而 Python-Markdown
认不出这种行尾里的表格分隔行，于是**整张表以裸竖线段落输出**，同时
``zensical build`` 照样报 ``No issues found``。

本批实测症状：16 个页面 ``<table>`` **0 张**、``<p>|`` **201 处**，而构建
「干净」。查了行尾、缩进、生成顺序、CRLF 对照实验全都无罪，最后读**字节**
才看见 ``\r\r\n``。

> **判据：产物侧的三类扫描（裸竖线 / 表格吞块 / 列数）不能省，它们抓的正是
> 构建器放过的错。** 而行尾问题**读字节才看得见** —— ``read_text`` 会把
> ``\r\r\n`` 规整掉，看起来一切正常。

用法
----
    python scripts/gen_items_catalog.py --fetch     # 抓接口并写缓存
    python scripts/gen_items_catalog.py             # 用缓存重生成
    python scripts/gen_items_catalog.py --check     # 只跑对账，不写盘
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "catalog"
JS = ROOT / "content" / "javascripts"
API = "https://json.tarkov.dev/regular/"

# 中文地图名 → 地图页 key：**全站唯一一份在 _map_links.py**（它服务任务侧
# 「在地图上看」的判定）。「刷新地图速查」的地名链接复用它，不另建映射 ——
# 词表正好同源（通行证文件描述里写的就是「塔科夫街区」）。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _map_links import MAP_KEY_BY_CN  # noqa: E402
HEADERS = {
    "User-Agent": "tarkov-encyclopedia/1.0 (+https://github.com/GTX950L/tarkov-encyclopedia)",
    "Origin": "https://tarkov.dev",
    "Referer": "https://tarkov.dev/",
}
FETCH_DATE = "2026-10-08"
# 页眉的「基线快照时间」与「全站基线版本」必须与 citation.md 第二节一致。
# ⚠️ 第一版这里写的是「1.1.5.1 / 2026-10-08」，被 check_catalog_consistency.py 查出：
#    citation.md 的全站基线是 **1.2.0.0（2026-10-06 发布）**，而任务页写 1.1.5.1 是
#    **对的** —— 它的数据是 2026-09-30 抓的，那时基线确实是 1.1.5.1。
#    换句话说：**基线跟着抓取日走，不跟着「站点当前最新版」走**。本栏目抓取日是
#    2026-10-08，晚于 1.2.0.0 的发布日，所以写 1.2.0.0。
BASE_MONTH = "2026 年 10 月"
BASE_VER = "1.2.0.0"
ROOT_CAT = "54009119af1c881c07000029"  # item —— itemCategories 的根

# 页面切分：显式声明「slug → 叶子分类路径的三段前缀」。
# 为什么显式写死而不是自动分桶：
#   ① 分类树有 4 层，跨层的语义归并不适合自动推断；
#   ② 显式清单是**可枚举的判断集** —— 新增叶子分类时对账会报「未归类」，
#      而不是静默出现在某一页（判据：判断集必须来自代码里的常量清单，不能手挑）。
# 每项是 (slug, 页面标题, [路径前缀…])；前缀按「物品 › 组合物品 › 武器配件」这样从第 2 段起匹配。
PAGES = [
    ("weapons", "枪械", [
        "武器/突击步枪", "武器/突击卡宾枪", "武器/精确射手步枪", "武器/狙击步枪",
        "武器/机枪", "武器/冲锋枪", "武器/霰弹枪", "武器/手枪", "武器/左轮手枪",
        "武器/榴弹发射器", "武器/火箭发射器",
    ]),
    ("mods-sight", "武器配件·瞄具与夜视", [
        "瞄具/瞄准镜", "瞄具/突击瞄准镜", "瞄具/反射式瞄具", "瞄具/紧凑型反射式瞄具",
        "瞄具/机械瞄具", "特种观瞄/夜视仪", "特种观瞄/热成像",
    ]),
    ("mods-barrel", "武器配件·枪管与膛口", [
        "基础配件/枪管", "膛口装置/消焰器", "膛口装置/消音器",
        "膛口装置/组合膛口制退器", "功能性模块/导气箍", "功能性模块/脚架",
        "装备配件/下挂式榴弹发射器",
    ]),
    ("mods-body", "武器配件·枪身与握持", [
        "装备配件/枪托", "基础配件/护木", "基础配件/机匣",
        "基础配件/手枪式握把", "功能性模块/前握把", "装备配件/拉机柄",
        "弹匣/弹巢/弹簧驱动弹巢", "功能性模块/组合式战术设备",
        "功能性模块/辅助配件", "功能性模块/手电筒", "装备配件/导轨基座",
    ]),
    ("gear-armor", "防护装备", [
        "护甲装备/护甲", "护甲装备/护甲插板", "护甲装备/观测装置",
    ]),
    ("gear-wear", "穿戴与面罩", [
        "护甲装备/头部穿戴", "护甲装备/面罩", "装备/臂章", "装备/耳机",
    ]),
    ("carriers", "背包与胸挂", ["可搜索物品/背包", "可搜索物品/胸挂"]),
    ("containers", "储藏容器", [
        "可搜索物品/随机战利品容器", "可搜索物品/便携式储藏箱",
        "组合物品/普通储藏箱", "组合物品/上锁容器",
    ]),
    ("ammo", "弹药与弹药箱", [
        "可堆叠物品/弹药/火箭弹", "可堆叠物品/弹药箱", "投掷武器/模拟投掷武器",
    ]),
    ("barter", "以物换物原料", [
        "交换用物品/其他", "交换用物品/珠宝", "交换用物品/电子产品",
        "交换用物品/工具", "交换用物品/日常用品", "交换用物品/润滑剂/燃料",
        "交换用物品/建筑材料", "交换用物品/医疗用品", "交换用物品/电池",
    ]),
    ("keys", "钥匙与门禁", ["钥匙/机械钥匙", "钥匙/门禁卡"]),
    ("consumables", "食物与药品", [
        "食物和饮料/食物", "食物和饮料/饮品", "药品/兴奋剂", "药品/医疗用品",
        "药品/药物", "药品/急救包",
    ]),
    ("intel", "情报与笔记", [
        "信息/对话物品", "可完成类/笔记", "可完成类/磁带", "海报传单",
        "可堆叠物品/赛季通行证文件", "地图",
    ]),
    ("special", "特殊物品", [
        "特殊物品/维修套件", "特殊物品/邪教徒护符", "特殊物品/录音机",
        "特殊物品/多功能工具", "特殊物品/指南针", "特殊物品/便携测距仪",
        "特殊物品/无线电发报器", "特殊物品/「听而不闻者」标记", "特殊物品/种植工具包",
    ]),
    ("misc", "零散物品", ["刀", "可堆叠物品/钱"]),
]

# 跨多叶分类的显式分派。
#
# ⚠️ 为什么不能只用 propertiesType 一刀切：实测 109 件跨多叶的物品里，
# ``ItemPropertiesArmorAttachment`` 同时装着「护目罩」与「盔罩/伪装罩」两类，
# ``special-item`` 那 11 件（信号干扰器、WIFI 摄像头…）**根本没有 propertiesType**。
# 所以规则是「先看名称关键词，再退回 propertiesType」，且**按顺序首次命中即返回**。
# 关键词按「越长越具体」排列，避免「瞄具」抢走「夜视瞄具」。
CROSS_RULES = {
    "armored-equipment": [
        (("盔罩", "伪装罩", "面罩"), "面罩"),          # ArmorAttachment 里这两类混放
        (("护目", "护颚", "护口"), "面罩"),
        (("观测装置", "测距", "热成像"), "观测装置"),
        (("插板", "防弹板"), "护甲插板"),
        (("耳机", "耳麦"), "耳机"),
        (("臂章", "肩章"), "臂章"),
        (("背包",), "背包"),
        (("胸挂", "胸甲", "胸袋"), "胸挂"),
        (("头盔", "盔"), "头部穿戴"),
        (("护甲", "背心", "软甲"), "护甲"),
    ],
    "special-item": [
        (("炸药", "炸药包"), "维修套件"),   # SZ-1 炸药是任务用爆炸物，走「特殊物品」而非弹药
        (("维修", "修理", "修复", "工具包"), "维修套件"),
        (("多功",), "多功能工具"),
        (("指南针",), "指南针"),
        (("测距",), "便携测距仪"),
        (("发报", "无线电", "中继", "信号干扰", "WIFI", "摄像头", "指示器"),
         "无线电发报器"),
        (("硬盘", "手提电脑", "电脑"), "无线电发报器"),
        (("袭告警", "黑客入侵"), "无线电发报器"),
        (("护符", "吊坠"), "邪教徒护符"),
        (("录音",), "录音机"),
        (("标记", "听而不闻"), "「听而不闻者」标记"),
        (("种植",), "种植工具包"),
    ],
    "special-scope": [
        (("热成像", "热像"), "热成像"),
        (("夜视",), "夜视仪"),
    ],
}

# propertiesType 兜底（仅在名称关键词都不命中时用）
CROSS_FALLBACK = {
    ("armored-equipment", "ItemPropertiesArmorAttachment"): "面罩",
    ("special-scope", "ItemPropertiesScope"): "瞄准镜",
}


def cross_route(mid_nn, props_type, item_name):
    """按 CROSS_RULES 决定跨多叶物品的归属；返回叶子中文名或 None。"""
    for keys, leaf in CROSS_RULES.get(mid_nn) or []:
        if any(k.lower() in item_name.lower() for k in keys):
            return leaf
    return CROSS_FALLBACK.get((mid_nn, props_type))

# 客户端未汉化的分类 → 站内译名（34 个）
ZH_FIX = {
    "item": "物品",
    "mechanical-key": "机械钥匙",
    "keycard": "门禁卡",
    "multitools": "多功能工具",
    "auxiliary-mod": "辅助配件",
    "headwear": "头部穿戴",
    "night-vision": "夜视仪",
    "face-cover": "面罩",
    "thermal-vision": "热成像",
    "other": "其他",
    "repair-kits": "维修套件",
    "arm-band": "臂章",
    "armor-plate": "护甲插板",
    "compass": "指南针",
    "portable-range-finder": "便携测距仪",
    "radio-transmitter": "无线电发报器",
    "cultist-amulet": "邪教徒护符",
    "recorder": "录音机",
    "mark-of-the-unheard": "「听而不闻者」标记",
    "planting-kits": "种植工具包",
    "fuel": "燃料",
    "revolver": "左轮手枪",
    "cylinder-magazine": "弹巢",
    "spring-driven-cylinder": "弹簧驱动弹巢",
    "random-loot-container": "随机战利品容器",
    "tapes": "磁带",
    "notes": "笔记",
    "flyer": "海报传单",
    "completable": "可完成类",
    "dialog-item": "对话物品",
    "battle-pass-document": "赛季通行证文件",
    "rocket": "火箭弹",
    "rocket-launcher": "火箭发射器",
    "volumetric-throw-weapon": "模拟投掷武器",
    "searchable-item": "可搜索物品",
    "money": "货币",
    "map": "地图",
}

# 属性中文化。三元组：(中文标签, 单位/后缀, 精度)
#
# ⚠️ `pct=True` 的字段在数据源里是**小数比例**（0.297 = 29.7%），要 ×100；
# ⚠️ `abs=True` 的字段带**负号**（speedPenalty = -0.09 表示移速 -9%），
#    惩罚类一律显示绝对值并在标签里写明「惩罚」—— 显示「-0.01%」读者会看不懂。
PROP_LABEL = {
    "class": ("防护等级", " 级", None, False, False),
    "armorType": ("材质", "", None, False, False),
    "durability": ("耐久", "", None, False, False),
    "zones": ("防护区域", "", None, False, False),
    "bluntThroughput": ("钝伤防护", "%", 0, True, False),
    "speedPenalty": ("移速惩罚", "%", 0, True, True),
    "turnPenalty": ("转身惩罚", "%", 0, True, True),
    "ergoPenalty": ("人机工效惩罚", "%", 0, True, True),
    "ergoPenaltyModifier": ("人机工效惩罚", "%", 0, True, True),
    "repairCost": ("维修费", " 卢布", None, False, False),
    "capacity": ("容量", " 格", None, False, False),
    "drawSize": ("占地", "", None, False, False),
    "weight": ("重量", " 千克", 3, False, False),
    "caliber": ("口径", "", None, False, False),
    "ergonomics": ("人机工效", "", None, False, False),
    "recoilVertical": ("垂直后坐", "", None, False, False),
    "recoilHorizontal": ("水平后坐", "", None, False, False),
    "moa": ("散布", " MOA", 2, False, False),
    "fireRate": ("射速", " 发/分", None, False, False),
    "rateOfFire": ("射速", " 发/分", None, False, False),
    "effectiveDistance": ("有效射程", " 米", None, False, False),
    "sightingRange": ("瞄准距离", " 米", None, False, False),
    "maxDurability": ("最大耐久", "", None, False, False),
    "centerOfImpact": ("弹着点", " 厘米", 2, False, False),
    "deviationCurve": ("散布曲线", "", 2, False, False),
    "accuracyModifier": ("精度修正", "%", 0, True, True),
    "recoilModifier": ("后坐修正", "%", 0, True, True),
    "loadModifier": ("装填修正", "%", 0, True, True),
    "ammoCheckModifier": ("验枪修正", "%", 0, True, True),
    "malfunctionChance": ("故障率", "%", 1, True, False),
    "weightModifier": ("重量修正", "%", 0, True, True),
    "heatFactor": ("热量系数", "", 2, False, False),
    "durabilityBurnFactor": ("耐久损耗系数", "", 2, False, False),
    "deviationMax": ("最大散布", " 厘米", None, False, False),
    "type": ("类型", "", None, False, False),
    "fuse": ("引信", " 秒", 1, False, False),
    "minExplosionDistance": ("最小爆炸距离", " 米", None, False, False),
    "maxExplosionDistance": ("最大爆炸距离", " 米", None, False, False),
    "fragments": ("破片数", "", None, False, False),
    "contusionRadius": ("震荡半径", " 米", None, False, False),
    "intensity": ("放大倍率", " 倍", None, False, False),
    "noiseIntensity": ("噪声强度", "", 2, False, False),
    "diffuseIntensity": ("漫射强度", "", 2, False, False),
    "zeroingDistances": ("归零距离", " 米", None, False, False),
    "zoomLevels": ("放大档位", "", None, False, False),
    "sightModes": ("瞄具模式", "", None, False, False),
    "ballisticCoeficient": ("弹道系数", "", 2, False, False),
    "bulletDiameterMilimeters": ("弹径", " 毫米", None, False, False),
    "bulletMassGrams": ("弹重", " 克", None, False, False),
    "ammoType": ("弹种", "", None, False, False),
    "projectileCount": ("弹丸数", "", None, False, False),
    "tracer": ("曳光", "", None, False, False),
    "tracerColor": ("曳光颜色", "", None, False, False),
    "stackMaxSize": ("堆叠上限", "", None, False, False),
    "energy": ("能量", "", None, False, False),
    "hydration": ("水分", "", None, False, False),
    "units": ("数量", "", None, False, False),
    "useTime": ("使用时间", " 秒", None, False, False),
    "cures": ("可治", "", None, False, False),
    "hitpoints": ("总治疗量", "", None, False, False),
    "maxHealPerUse": ("单次治疗上限", "", None, False, False),
    "hpCostLightBleeding": ("轻出血耗血", "", None, False, False),
    "hpCostHeavyBleeding": ("重出血耗血", "", None, False, False),
    "hpCostBrokenLimb": ("肢体损毁耗血", "", None, False, False),
    "hpCostSoftTissue": ("软组织伤耗血", "", None, False, False),
    "hpCostBlackArea": ("黑区伤耗血", "", None, False, False),
    "painkillerDuration": ("止痛持续", " 秒", None, False, False),
    "energyImpact": ("能量影响", "", None, False, False),
    "hydrationImpact": ("水分影响", "", None, False, False),
    "sideEffects": ("副作用", "", None, False, False),
    "stimEffects": ("效果", "", None, False, False),
    "ambientVolume": ("环境音量", " dB", 0, False, True),
    "compressorThreshold": ("压缩阈值", " dB", 0, False, True),
    "compressorAttack": ("压缩启动", "", None, False, False),  # 单位毫秒，不加后缀
    "compressorRelease": ("压缩释放", "", None, False, False),
    "compressorGain": ("压缩增益", "%", 0, True, True),
    "distanceModifier": ("距离衰减", "", None, False, False),
    "distortion": ("失真", "", None, False, False),
    "dryVolume": ("干声", "%", 0, True, True),
    "hpm": ("每秒治疗", "", 1, False, False),
    "slashDamage": ("劈砍伤害", "", None, False, False),
    "stabDamage": ("穿刺伤害", "", None, False, False),
    "hitRadius": ("命中半径", " 厘米", None, False, False),
    "grids": ("格子布局", "", None, False, False),
    "gridWidth": ("布局宽", "", None, False, False),
    "gridHeight": ("布局高", "", None, False, False),
    "basePrice": ("基础价", " 卢布", None, False, False),
}

# 属性在「关键属性」栏里的展示优先级 —— 读者拿它做判断的排前面。
# 判据：**同类物品之间的可比字段**。护甲先看等级再看耐久；枪械先看口径再看后坐。
PROP_ORDER = [
    "class", "armorType", "caliber", "ammoType", "diameter",
    "capacity", "hitpoints", "maxHealPerUse", "hpCostLightBleeding",
    "maxDurability", "durability", "zones", "bluntThroughput",
    "speedPenalty", "turnPenalty", "ergoPenalty",
    "ergonomics", "recoilVertical", "recoilHorizontal", "fireRate",
    "effectiveDistance", "sightingRange", "moa", "accuracyModifier",
    "recoilModifier", "loadModifier", "malfunctionChance",
    "ballisticCoeficient", "bulletMassGrams", "bulletDiameterMilimeters",
    "projectileCount", "tracer", "penetrationClass",
    "fuse", "fragments", "minExplosionDistance", "maxExplosionDistance",
    "contusionRadius",
    "ambientVolume", "compressorThreshold", "compressorGain",
    "intensity", "zeroingDistances",
    "energy", "hydration", "useTime", "cures", "painkillerDuration",
    "energyImpact", "hydrationImpact", "units",
    "slashDamage", "stabDamage", "hitRadius",
    "repairCost", "stackMaxSize", "weight", "tracerColor",
]

# ---------------------------------------------------------------------------
# 表格列规格 —— **静态 Markdown 表**与**JS 检索表**共用一份
# ---------------------------------------------------------------------------
# 为什么要建这套规格：列原本是**写死在两处**的 —— `page_markdown()` 里一份
# Markdown 表头、`content/javascripts/catalog.js` 里一份 JS 表头。两处各自为政
# 必然漂移，而**同一页「开 JS」与「不开 JS」两种读法必须看到同一批列**。
# 现在列规格由生成器统一产出（写进 `catalog-data.js` 的 `index[slug].cols`，
# 含字段名与数据下标），JS 侧只按规格渲染，不再自己写死列名。
#
# 数据下标不在规格里手写：`ROW_BASE` 定位置、`EXTRA_ALWAYS` / `EXTRA_OPTIONAL` 追加。
# **加字段一律走这三个常量，别在下标上打补丁。**
ROW_BASE = ["id", "name", "en", "weight", "props", "buy", "sell", "type", "size"]
# 表外字段，分两档：
#   · `EXTRA_ALWAYS`   —— **每一页都要**，下标在全站固定。
#     `acq`（获取方式）是唯一一个：它短（最多 15 字），而且 15 个图鉴页全都有这一列。
#     固定下标还有一个用处：总览页（#tk-catalog-all）把各分块拼在一起用一份列规格，
#     只有「每页都有、且下标相同」的字段才能出现在那里（见 catalog.js 的 COLS_FALLBACK）。
#   · `EXTRA_OPTIONAL` —— **只为用到它的页面追加**。
#     `desc`（官方简介）全站 4979 件合计 145 KB，不该给 14 个不需要它的页面一起背。
#     `lmaps`（所在图）只有钥匙页用，全站 208 件 —— 同理。
EXTRA_ALWAYS = ["acq"]
EXTRA_OPTIONAL = ["uses", "desc", "lmaps"]

# 「获取方式」短标签。**只收站内收录的固定渠道**，口径与 load_routes() 的注释一致：
#   ① 商人出售 —— 数据源的 `buyFromTrader`；
#   ② 以物换物 / ③ 藏身处制作 —— 来自 recipes.json。
# **刻意不含「哪张图能刷到」**（散落刷新数据只覆盖 6.2% 的物品，给了多半会误导）。
# 所以 `—` 的含义是「**站内没有收录它的固定渠道**」，**不是「拿不到」** ——
# 这句话必须落在页面上（见 page_markdown 的「本页概览」那一行），否则 `—` 会被读成「无解」。
ACQ_LABEL = {"buy": "商人出售", "barter": "以物换物", "craft": "制作"}
# 多渠道时的排列顺序固定，避免同一件物品在不同页面/不同版本里顺序漂。
ACQ_ORDER = ["buy", "barter", "craft"]

# 单个规格 = 表头行 / 分隔行 / 列三元组 (字段名, JS 表头, 语义类)。
#
# ⚠️ **表头行与分隔行写成常量，不靠列名推导**：分隔行的宽度是手写的、推不出来。
#    防漂移由 `assert_md_header()` 兜底 —— 表头单元格数对不上列规格就报错。
COL_SPECS = {
    "default": {
        "header": "| # | 名称 | 英文名 | 重量 | 关键属性 | 获取方式 | 商人最低售价 | 商人最高回收 |",
        "sep": "|---|------|--------|------|----------|----------|--------------|--------------|",
        "cols": [
            ("name", "名称", "tk-col-name"),
            ("en", "英文名", "tk-col-nowrap"),
            ("weight", "重量", "tk-col-num"),
            ("props", "关键属性", "tk-col-desc"),
            # 插在「属性」与「价格」之间：读者的问题是「这东西怎么弄到」，
            # 接着才是「值多少钱」—— 顺序本身是内容。
            ("acq", "获取方式", "tk-col-nowrap"),
            ("buy", "商人最低售价", "tk-col-nowrap"),
            ("sell", "最高回收", "tk-col-nowrap"),
        ],
    },
    # 钥匙与门禁专页：**加两列、去一列**。
    #
    # 实测（2026-10-11，抓取日 2026-10-08 的快照）为什么必须单独给一列：
    #   · 钥匙的 `properties` **只有** `{propertiesType: ItemPropertiesKey, uses: N}`，
    #     而 `uses` 不在 `PROP_LABEL` 里 → 「关键属性」栏 **258/258 全空**，
    #     而同类页面（食物 / 护甲）是 0% 空。这不是设计，是漏字段。
    #   · 「使用次数」恰恰是买钥匙**唯一要看的数** —— 同价不同次是两笔不同的交易，
    #     站内条目自己就写着「钥匙的成本从来不在重量上，在次数上」。
    #     259 件里 250 件有值（档位：40 次 ×177、1 次 ×24、10 次 ×23、20 次 ×12、
    #     5 次 ×11、2 次 ×3；另有 9 件为 0，见页面表注）。
    #   · 「官方简介」= 游戏内物品描述的中文本地化原文，**259 件 100% 有**
    #     （平均 29 字、最长 121 字），原本只在 JS 详情面板里能看到，
    #     静态表与 JS 表都读不到 —— 读者扫表时看到的就是「名字 + 价格」。
    #   · 去掉「关键属性」：钥匙在该字段上没有任何别的属性可放，留着就是一整列 `—`。
    #
    # ⚠️ 列名用「使用次数」而不是「耐久」：数据源字段就叫 `uses`，
    #    实测与四个「直读游戏文件」的来源一致（20 / 10 次等，见 CHANGELOG v1.103.0）；
    #    社区里流传的「耐久度」是一套没有数值依据的说法，不采用。
    #
    # 「所在图」列（v1.130.0）：键→图 的映射由 gen_maps.py 产出
    # （scripts/data/key_locations.json），**直接是锁点数据**——
    # 「这把钥匙开哪张图的哪扇门」的直接证据，不是推断。数据与口径见下方注释与
    # 页面「口径四条」③。
    "keys": {
        "header": "| # | 名称 | 英文名 | 重量 | 使用次数 | 所在图 | 官方简介 | 获取方式 | 商人最低售价 | 商人最高回收 |",
        "sep": "|---|------|--------|------|----------|--------|----------|----------|--------------|--------------|",
        "cols": [
            ("name", "名称", "tk-col-name"),
            ("en", "英文名", "tk-col-nowrap"),
            ("weight", "重量", "tk-col-num"),
            ("uses", "使用次数", "tk-col-num"),
            ("lmaps", "所在图", "tk-col-nowrap"),
            ("desc", "官方简介", "tk-col-desc"),
            ("acq", "获取方式", "tk-col-nowrap"),
            ("buy", "商人最低售价", "tk-col-nowrap"),
            ("sell", "最高回收", "tk-col-nowrap"),
        ],
    },
}


def col_spec(slug):
    return COL_SPECS.get(slug, COL_SPECS["default"])


def assert_md_header(slug):
    """表头行的单元格数必须 = 列规格 + 1（那个 1 是 `#` 序号列）。

    判据同 `check_anchors()`：**能在写盘前发现的错，就别留给渲染**。
    这两处（表头常量 / 列规格）是手工维护的一对，加列时只改一处就会渲染出
    列数不齐的表 —— 而 Markdown 不报错，只会静默串列或整表退化。
    """
    spec = col_spec(slug)
    n = len([c for c in spec["header"].strip().strip("|").split("|")])
    want = len(spec["cols"]) + 1
    if n != want:
        return [f"[错误] {slug}: Markdown 表头 {n} 列 ≠ 列规格 {want} 列（含序号列）"]
    # 缩略图并进「名称」格（page_markdown 里按下标 1 拼）—— 列规格换了首列就会
    # 把图塞进别的单元格，而 Markdown 不会报错，只会静默错位。写盘前拦住。
    if spec["cols"][0][0] != "name":
        return [f"[错误] {slug}: 列规格首列必须是 name（缩略图并进名称格）"]
    return []


# 枚举值归一化：数据源给的是内部代号（Caliber556x45NATO），读者看不懂。
# 只收「读者会拿它做判断」的枚举；未列出的值原样输出（不猜、不编）。
ENUM_ZH = {
    "light": "轻型",
    "heavy": "重型",
    "bearheavycaliber": "BEAR 大口径",
}

# 口径：内部代号 → 游戏内通用写法。顺序敏感（先长后短，避免 762 抢 762NATO）
CALIBER = [
    ("Caliber1143x23ACP", ".45 ACP"),
    ("Caliber12x70", "12×70mm 霰弹"),
    ("Caliber9x19PARA", "9×19mm Parabellum"),
    ("Caliber9x18PM", "9×18mm PM"),
    ("Caliber57x28", "5.7×28mm"),
    ("Caliber46x30", "4.6×30mm"),
    ("Caliber556x45NATO", "5.56×45mm NATO"),
    ("Caliber545x39", "5.45×39mm"),
    ("Caliber762x51", "7.62×51mm NATO"),
    ("Caliber762x39", "7.62×39mm"),
    ("Caliber762x54", "7.62×54mmR"),
    ("Caliber338lm", ".338 Lapua Magnum"),
    ("Caliber408x50", ".408 caliber"),
    ("Caliber20x1mm", "20×1mm 空爆"),
    ("Caliber127x55", "12.7×55mm"),
    ("Caliber127x99", "12.7×99mm"),
    ("Caliber141x228", "14.1×228mm"),
    ("Caliber107x45", ".410 卡壳"),
    ("Caliber586x45", "5.56×45mm 短管（气枪）"),
]


def enum_zh(v):
    """把内部枚举代号转成读者看得懂的中文；转不了就原样返回。"""
    s = str(v)
    for raw, nice in CALIBER:
        if raw.lower() == s.lower():
            return nice
    return ENUM_ZH.get(s.lower(), s)

TRADERS = {
    "54cb50c76803fa8b248b4571": "Prapor",
    "54cb57776803fa99248b456e": "Therapist",
    "579dc571d53a0658a154fbec": "Therapist",
    "58330581ace78e27b8b10cee": "Skier",
    "5935c25fb3acc3127c3d8cd9": "Peacekeeper",
    "5a7c2eca46aef81a7ca2145d": "Mechanic",
    "5ac3b934156ae10c4430e83c": "Ragman",
    "5c0647fdd443bc2504c2d371": "Jaeger",
    "6617beeaa9cfa777ca915b7c": "竞技场裁判",
}
# 商人买价里的非卢布计价（站内只显示卢布，避免读者按汇率自己折算）
CURRENCY_NOTE = {"USD": "美元", "EUR": "欧元", "CNY": "人民币"}

# 医疗类枚举（cures 字段是内部代号，读者看不懂）
CURES_ZH = {
    "LightBleeding": "轻出血",
    "HeavyBleeding": "重出血",
    "Contusion": "震荡伤",
    "Fracture": "骨折",
    "LostLimb": "肢体损毁",
    "Pain": "疼痛",
    "Intoxication": "中毒",
    "FractureHead": "头部骨折",
}


def get(endpoint: str) -> dict:
    req = urllib.request.Request(API + endpoint, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.load(r)


def clean(s) -> str:
    """单元格文本：去掉会破坏表格的字符，中文引号规范化。"""
    if s is None:
        return ""
    s = str(s).replace("|", "｜").replace("\n", " ").replace("\r", " ")
    s = s.replace('"', "”").strip()
    return s


def fmt_num(x, suffix="", digits=None):
    if x is None or x == "":
        return "—"
    if isinstance(x, bool):
        return "是" if x else "否"
    if isinstance(x, (int, float)):
        if digits is not None:
            s = f"{x:.{digits}f}"
            s = s.rstrip("0").rstrip(".") if digits else s
        else:
            s = f"{x:g}"
        return clean(s + suffix)
    return clean(str(x))


def icon_tag(it) -> str:
    """行首缩略图（官方图，64×64 透明底 WebP，由 gen_item_icons.py 下载）。

    ⚠️ 路径是**相对当前页**的 ``../../assets/…``：图鉴页构建后落在
       ``/catalog/<slug>/index.html``，往上两级才是站点根。
       写成绝对路径会在 ``site_url`` 带子目录（/tarkov-encyclopedia/）时 404。
    ⚠️ 用裸 ``<img>`` 而不是 Markdown 图片语法：Markdown 图片在表格单元格里
       会变成块级元素、与相邻文字错位；且这里要的是固定 28 px 小图标，
       不该被正文图片样式（圆角、居中、图注）接走。
    """
    iid = it.get("id")
    if not iid:
        return ""
    return (f'<img class="tk-ic" src="../../assets/items/icons/{iid}.webp" '
            f'alt="" width="28" height="28" loading="lazy" decoding="async"> ')


def cell_md(it, field) -> str:
    """按列规格取一个 Markdown 单元格的值。

    ⚠️ 这里的口径与 `content/javascripts/catalog.js` 的格式器是**一对**：
       同一个字段在两处的呈现必须一致（JS 侧从原始值再格式化一遍，因为
       Markdown 的 `` `反引号` `` 包裹不能直接搬进 DOM）。改这里要想一下那边。
    """
    if field == "name":
        return it["name"]
    if field == "en":
        return f"`{it['en']}`"
    if field == "weight":
        return (fmt_num(it["weight"], " 千克", 3)
                if isinstance(it["weight"], (int, float)) else "—")
    if field == "props":
        return it["props"]
    if field == "buy":
        return it["buy"]
    if field == "sell":
        return it["sell"]
    if field == "uses":
        # 与 prop_cells 同一口径：0 / 缺失一律留白（含义数据源未说明，见表注）
        u = it.get("uses")
        return f"{u} 次" if isinstance(u, int) and u > 0 else "—"
    if field == "lmaps":
        # 「所在图」列：图名即链接 —— 点进对应地图页并高亮这把钥匙的锁点（?key=）。
        # 数据由 annotate_key_locations() 注入（锁点图层的直接证据，不是推断）；
        # 没有锁点数据的钥匙留白 —— 「留白 ≠ 不在这张图用」写在页面「口径四条」③。
        # ⚠️ 相对路径里的 `.md?query` 会被构建器改写成 `/maps/<key>/?query`（实测
        #    quests 页的 `quest.md?id=` 先例），**不要手写成 /maps/ 绝对路径** ——
        #    那会绕过相对链接体系，本地预览与线上行为分叉。
        pairs = it.get("lmaps")
        if not pairs:
            return "—"
        return "、".join(
            f'<a href="../maps/{k}.md?key={it["id"]}" title="在地图上看这把钥匙的锁点">{zh}</a>'
            for k, zh in pairs)
    if field == "desc":
        return it["desc"] or "—"
    if field == "acq":
        # 由 annotate_acquisition() 预先算好写进每一行 —— 静态表与 JS 表**共用同一个串**，
        # 免得两处各算一遍（那正是「同一件事两种叫法」的来源）。
        return it.get("acq") or "—"
    return "—"


def build_tree(cats: dict, zh: dict) -> dict:
    """返回 {leaf_id: (中文路径, 叶子名)}，并记录全部叶子 id。"""
    def name(cid):
        raw = zh.get(cid + " Name") or cats[cid]["normalizedName"]
        # 客户端未汉化 → 用站内译名表；译名表也没有 → 保留原文（不编译名）
        if all(ord(ch) < 128 for ch in raw):
            return ZH_FIX.get(cats[cid]["normalizedName"], raw)
        return raw

    leaves: dict[str, list[str]] = {}

    def walk(cid, path):
        ch = cats[cid].get("children") or []
        if not ch:
            leaves[cid] = path + [name(cid)]
            return
        for c in ch:
            walk(c, path + [name(cid)])

    walk(ROOT_CAT, [])
    return leaves


def item_name(it, zh):
    iid = it["id"]
    return clean(zh.get(iid + " Name") or it.get("normalizedName") or iid)


def prop_cells(props: dict) -> tuple[str, float]:
    """返回 (关键属性摘要, 排序用的关键数值)。

    排序与取舍按 ``PROP_ORDER``（读者判断价值优先），不按字典序 ——
    否则护甲的「防护等级 6 级」会被「移速惩罚 -9%」挤掉，而前者才是关键。
    """
    if not props:
        return "—", 0.0
    rank = {k: i for i, k in enumerate(PROP_ORDER)}
    bits = []
    numeric = []
    for k in sorted(props, key=lambda x: (rank.get(x, 999), x)):
        if k == "propertiesType":
            continue
        # 使用次数：**只对钥匙渲染**。
        #
        # 别的物品栏里也有 `uses`（实测 16 件：药品 8 / 止痛药 6 / 手术包 2，
        # 另有 provisions / injectors / specialSlot 若干），若一并渲染就会改到
        # **另外 14 个图鉴页**的「关键属性」栏 —— 本批刻意不碰它们，所以按
        # `propertiesType` 卡死。判据：`ItemPropertiesKey` 是钥匙的专属属性类型
        # （实测 259 / 259 件钥匙全是它）。
        #
        # 值为 0 时**不写**：写成「使用次数 0 次」会被读成「已经用完了」。
        # 实测 9 件为 0（多为剧情 / 任务类钥匙卡），含义数据源未说明 ——
        # 钥匙页的表注里单独交代，不在这里替它下结论。
        if k == "uses":
            if props.get("propertiesType") != "ItemPropertiesKey":
                continue
            u = props.get("uses")
            if not isinstance(u, int) or u <= 0:
                continue
            bits.append(f"使用次数 {u} 次")
            continue
        if k not in PROP_LABEL:
            continue
        v = props[k]
        txt, suf, dg, pct, absolute = PROP_LABEL[k]
        if isinstance(v, list):
            # cures 可读价值高 → 逐项译名；zones / zoomLevels 是纯结构 → 只报数量
            if k == "cures":
                bits.append(f"{txt} " + "、".join(CURES_ZH.get(str(x), str(x)) for x in v))
            elif k in ("zoomLevels", "zeroingDistances"):
                bits.append(f"{txt} {len(v)} 档")
            elif k == "zones":
                bits.append(f"{txt} {len(v)} 处")
            continue
        if isinstance(v, dict):
            continue
        if v is None:
            # 「治疗耗血 = null」在游戏里意为**不耗血**，不是缺数据
            bits.append(f"{txt} 不耗血")
            continue
        if isinstance(v, bool):
            bits.append(f"{txt} {'是' if v else '否'}")
            continue
        if isinstance(v, (int, float)):
            x = float(v)
            if pct:
                x *= 100
            if absolute:
                x = abs(x)
            bits.append(f"{txt} {fmt_num(x, suf, dg)}")
            if not numeric:
                numeric.append(x)
        else:
            s = str(v)
            # 枚举值（口径/材质/弹种…）走归一化，内部代号读者看不懂
            if s in ("None", "none"):
                s = "不适用"
            elif s and (s[0].isupper() or s in ("light", "heavy")) and " " not in s:
                s = enum_zh(s)
            bits.append(f"{txt} {clean(s)}")
    # 一行最多 5 项，多的丢掉（读者要的是头几项，完整值在 JS 详情面板）
    head = "；".join(bits[:5]) if bits else "—"
    if len(bits) > 5:
        head += f"（共 {len(bits)} 项）"
    return head, (numeric[0] if numeric else 0.0)


def price_cell(rows, field):
    """商人买卖价 → 单元格。取「最低买入」或「最高卖出」，并列出商人。"""
    if not rows:
        return "—"
    if field == "buy":
        priced = [(r.get("priceRUB"), r) for r in rows if r.get("priceRUB")]
        if not priced:
            return "—"
        price, r = min(priced, key=lambda x: x[0])
        who = TRADERS.get(r.get("trader"), "—")
        lv = r.get("minTraderLevel")
        extra = f"，需 {who} {lv} 级" if lv else f"，{who}"
        return clean(f"{int(price):,} 卢布{extra}")
    priced = [(r.get("priceRUB"), r) for r in rows if r.get("priceRUB")]
    if not priced:
        return "—"
    price, r = max(priced, key=lambda x: x[0])
    n = len(priced)
    return clean(f"{int(price):,} 卢布（{n} 家最高）")


def resolve_leaf(cid, cats, leaf_ids, props_type, zh=None, leaves=None, it_raw=None):
    """把物品的 categories[0] 解析成唯一叶子分类。

    为什么需要这一步：数据源里 601 件物品的 ``categories[0]`` 指向**中间节点**
    （``magazine`` / ``ammo`` / ``armored-equipment`` 等），不是叶子 —— 直接按
    ``categories[0]`` 分桶会静默丢掉这 601 件。判定顺序：

    1. 自身就是叶子 → 用它；
    2. 叶后代唯一 → 用它（``magazine``→弹簧驱动弹巢、``ammo``→火箭弹 共 492 件属这类）；
    3. 叶后代多个 → 按 ``MULTI_LEAF_BY_NAME`` 显式映射（109 件）；
    4. 仍不唯一 → 返回 None，交给对账报错（**不静默丢弃**）。
    """
    if cid in leaf_ids:
        return cid
    acc = []

    def walk(c):
        ch = cats[c].get("children") or []
        if not ch:
            acc.append(c)
            return
        for x in ch:
            walk(x)

    walk(cid)
    if len(acc) == 1:
        return acc[0]
    if len(acc) > 1 and zh is not None and leaves is not None:
        leaf = cross_route(cats[cid]["normalizedName"], props_type,
                           item_name(it_raw, zh) if it_raw is not None else "")
        if leaf:
            for l in acc:
                p = leaves[l]
                if p[-1] == leaf or cats[l]["normalizedName"] == leaf:
                    return l
    return None


def collect(items, zh, leaves, cats, leaf_ids):
    """按叶子分类收集物品（去 preset）。"""
    buckets = collections.defaultdict(list)
    unresolved = collections.defaultdict(list)
    for it in items.values():
        if "preset" in (it.get("types") or []):
            continue
        props = it.get("properties") or {}
        c0 = (it.get("categories") or [None])[0]
        leaf = resolve_leaf(c0, cats, leaf_ids, props.get("propertiesType"), zh, leaves, it)
        if leaf is None or leaf not in leaves:
            unresolved[cats.get(c0, {}).get("normalizedName", "?")].append(
                item_name(it, zh))
            continue
        summary, numeric = prop_cells(props)
        # 占地格数 = 宽 × 高（游戏内的格子数，不是体积）。单格价值榜要靠它：
        # 拿重量估「占几格」是不准的 —— 0.4 kg 的东西可能占 1 格，也可能占 4 格。
        # 数据源顶层就有 width/height，4979 件实测零缺失。
        w, h = it.get("width"), it.get("height")
        size = (w * h) if isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0 else None
        buckets[leaf].append({
            "id": it["id"],
            "name": item_name(it, zh),
            "en": it.get("normalizedName") or "",
            "weight": it.get("weight"),
            "size": size,
            "types": it.get("types") or [],
            "props": summary,
            # 使用次数：**只有钥匙类有**（实测 259 件钥匙，propertiesType 全是
            # ItemPropertiesKey）。其余物品的 properties 里没有这个键 → 为 None。
            # 键的规格 `keys` 会把它渲染成一列（见 COL_SPECS 的说明）。
            "uses": props.get("uses"),
            "buy": price_cell(it.get("buyFromTrader"), "buy"),
            "sell": price_cell(it.get("sellToTrader"), "sell"),
            # 官方介绍（游戏内物品描述的中文本地化原文）与官方 Wiki 外链 —— 详情页与
            # 钥匙页的「官方简介」栏都用它。
            # `zh` 字典的键是 "<物品id> Description"；实测 4964 / 4979 件有中文，
            # 其余 15 件官方未提供中文本地化，取值会是 None → 统一落成空串。
            #
            # ⚠️ **必须过 `clean()`**：原文里含半角直引号（如「"Aspect"有限责任公司…」），
            #    直接落盘会被 `check_entries.py` 第 6 项判为「中文行残留直引号」。
            #    实测踩到：机械钥匙表里 2 行（aspect-company-office-key 与
            #    supply-department-directors-office-key）。
            #    口径与物品名一致（`clean()` 把 `"` 统一成 `”`）—— 于是同一行里
            #    名字列与简介列的引号样式相同。**两边用同一把尺子，比各自更漂亮重要。**
            "desc": clean(zh.get(it.get("description") or "") or ""),
            "wiki": it.get("wikiLink") or "",
            "_num": numeric,
        })
    for v in buckets.values():
        v.sort(key=lambda x: (x["weight"] if isinstance(x["weight"], (int, float)) else 9e9, x["name"]))
    return buckets, unresolved


def plan_pages(leaves, buckets, cats) -> tuple[list, list, list]:
    """按 PAGES 的显式前缀清单把叶子分类归并成页。

    分类树深达 6 层（``物品 › 组合物品 › 武器配件 › 功能性模块 › 瞄具 › 瞄准镜``），
    所以清单里的前缀是**从右往左对齐的尾部匹配**：``"瞄具/瞄准镜"`` 能命中它，
    也让页面的划分不受中间层级改名影响。

    清单里写不到的叶子分类**不会**被静默分配 —— 它们留在 ``unassigned`` 里，
    由 ``reconcile`` 报出来（判据：判断集必须来自代码里的常量清单，不能手挑）。
    """
    plan = []
    assigned = set()
    bad_prefix = []
    for slug, title, prefixes in PAGES:
        hit = []
        for pre in prefixes:
            # 尾部匹配：路径以 pre 结尾
            m = [lid for lid, p in leaves.items() if "/".join(p[1:]).endswith(pre)]
            if not m:
                bad_prefix.append(f"{slug} → {pre}")
            hit.extend(m)
        hit = sorted(set(hit))
        n = sum(len(buckets.get(l, [])) for l in hit)
        plan.append({"slug": slug, "title": title, "leaves": hit, "count": n})
        assigned |= set(hit)
    unassigned = sorted(set(leaves) - assigned)
    return plan, unassigned, bad_prefix


unresolved_pre: list[str] = []


# ---------------------------------------------------------------------------
# 长页拆分
# ---------------------------------------------------------------------------
# 实测（2026-10-10，1440×900 视口）：物品表加了列宽下限后每行约 **62px**，
# 一屏（900px）放不下 15 行 —— 于是 **1000 件 ≈ 77 屏**。mods-body 1529 件
# = **118 屏**，读者要滚很久，页内锚点跳转也形同虚设。
#
# 拆成子页而不是折叠：内容仍是**静态可读、可搜、可单页分享**的（站内定位），
# 且每页真正变短。判据用**件数**而不是「屏数」—— 件数在数据层就有，
# 不必先渲染再量；62px/行 这个换算也随字号/窄屏变动，用它当判据不稳。
SPLIT_TRIGGER = 400     # 整页超过这么多件才拆
SPLIT_CHUNK = 400       # 每个子页最多这么多件（≈ 30 屏）


def expand_splits(plan: list, leaves: dict, buckets: dict) -> list:
    """把过长的分类页按叶子分类**顺序切成若干子页**。

    切法是**按序贪心装填**：照 ``PAGES`` 里声明的叶子顺序累加，装到
    ``SPLIT_CHUNK`` 就新起一页。这样：
      · 结果是**确定性**的 —— 同样的数据每次跑都一样，diff 不会乱跳；
      · 同一大类里的叶子**不重排**，读者从导航顺序就能推断内容顺序；
      · 数据变多时自动多切一片，不需要人工维护一张分区表。

    ⚠️ ``SPLIT_TRIGGER`` 判的是**整页**件数，不是单片 —— 否则 containers
       （387 件 / 27 屏）这种也会被切成两页，那是徒增导航层级。

    子页的 slug 加 ``-1/-2/…`` 后缀、标题带上叶子范围（``… · 护木–枪托``），
    并在页内写明它是第几部分、给出兄弟页链接 —— 拆完还要能一眼看明白
    「这里是不是全部、其余在哪」。
    """
    out = []
    for p in plan:
        if p["count"] <= SPLIT_TRIGGER or len(p["leaves"]) < 2:
            out.append(p)
            continue

        # 各册**尽量均分**。切分必须**保序**（读者要能从导航顺序推断内容顺序），
        # 所以这是个「把有序序列切成 k 段、使最大段之和最小」的问题 ——
        # 贪心装填在叶子大小悬殊时会切出一头沉的分法（实测第一版：
        # gear-wear 的「耳机29+头部穿戴171+面罩197」被切成 397 / 40 两册）。
        # 叶子最多几十个，直接 DP，规模上完全无所谓。
        n_parts = max(2, -(-p["count"] // SPLIT_CHUNK))          # 向上取整，不用 math
        sizes = [len(buckets.get(l, [])) for l in p["leaves"]]
        cuts = best_split(sizes, n_parts)
        groups = [p["leaves"][cuts[i]:cuts[i + 1]] for i in range(len(cuts) - 1)]
        if len(groups) < 2:                 # 叶子太少、切不动，保持原样
            out.append(p)
            continue

        total = len(groups)
        slugs = [f"{p['slug']}-{i + 1}" for i in range(total)]
        titles = []
        for g in groups:
            first, last = leaves[g[0]][-1], leaves[g[-1]][-1]
            titles.append(f"{p['title']} · {first}" if first == last
                          else f"{p['title']} · {first}–{last}")

        # ① 保留原 slug 作**总览页**（只列分册，不含大表）—— 见 hub_markdown 的说明
        out.append({
            "slug": p["slug"], "title": p["title"], "leaves": [], "count": p["count"],
            "hub": True,
            # ⚠️ hub 的 leaves 是空表（它不含任何叶子表），所以**叶子数量要单独带上** ——
            # 直接写 {page['leaves']} 会渲染成「[] 个官方分类」（第一版就踩了）。
            "leaf_n": len(p["leaves"]),
            "parts_list": [{"title": titles[j], "slug": slugs[j],
                            "count": sum(len(buckets.get(l, [])) for l in groups[j])}
                           for j in range(total)],
        })
        # ② 再写各分册
        for i, g in enumerate(groups):
            out.append({
                "slug": slugs[i],
                "title": titles[i],
                "leaves": g,
                "count": sum(len(buckets.get(l, [])) for l in g),
                # 供 page_markdown 写「第 i / n 部分」与兄弟页链接
                "part": i + 1,
                "parts": total,
                "siblings": [(titles[j], slugs[j]) for j in range(total)],
                "whole": {"title": p["title"], "slug": p["slug"],
                          "count": p["count"], "leaves": len(p["leaves"])},
            })
    return out


def best_split(sizes: list, k: int) -> list:
    """把 ``sizes`` **顺序**切成 ``k`` 段，使**最大段之和最小**；返回切点下标。

    返回 ``[0, i1, i2, …, len(sizes)]``，共 ``k+1`` 个下标。
    ``k`` 大于元素个数时退化为每个元素一段。

    为什么要 DP 而不是贪心：切分必须保序，而叶子分类的大小可以相差几十倍
    （mods-body 的「手电筒」5 件 vs「枪托」293 件）。贪心装填在遇到一个
    「刚好跨过目标」的大叶子时，会把整段都算进当前册 —— 实测切出过
    397 / 40 这种一头沉的分法。DP 直接求最优，叶子最多几十个，代价可忽略。
    """
    n = len(sizes)
    k = max(1, min(k, n))
    pre = [0]
    for s in sizes:
        pre.append(pre[-1] + s)
    INF = float("inf")
    # dp[t][i] = 把前 i 个叶子切成 t 段时的「最大段之和」最小值
    dp = [[INF] * (n + 1) for _ in range(k + 1)]
    cut = [[0] * (n + 1) for _ in range(k + 1)]
    dp[0][0] = 0
    for t in range(1, k + 1):
        for i in range(1, n + 1):
            for j in range(t - 1, i):
                if dp[t - 1][j] == INF:
                    continue
                v = max(dp[t - 1][j], pre[i] - pre[j])
                if v < dp[t][i]:
                    dp[t][i] = v
                    cut[t][i] = j
    pts, i = [n], n
    for t in range(k, 0, -1):
        i = cut[t][i]
        pts.append(i)
    pts.reverse()
    return pts


def hub_markdown(page, leaves, total_items) -> str:
    """被拆开的整页 → **总览页**（只列各分册，不含大表）。

    ⚠️ 必须保留这一页，不能把原 slug 让给第一个分册 —— 否则：
      · 子页里「[整类共 N 件](原 slug.md)」会**断链**；
      · 站内外指向 ``catalog/mods-body/`` 的旧链接会 404。
    总览页本身很短（一屏上下），正好当分册的入口。
    """
    parts = page["parts_list"]
    out = []
    out.append("---")
    out.append("tags:")
    out.append("  - 物品")
    out.append("  - 索引")
    out.append("---")
    out.append("")
    out.append(f"# {page['title']}（Item Catalog）")
    out.append("")
    # ⚠️ 这一对页眉行是 check_entries 认「图鉴页」的判据（规范见 citation.md）。
    #    总览页少写了它，第一次跑就被判「页眉缺失」—— 别省。
    out.append(f"> 版本基线：{BASE_MONTH} ｜ {BASE_VER}（第一赛季 KORD BREACH）｜ 数据来源：tarkov.dev（二级）")
    out.append("> 本页为**生成页**，数值随版本调整，引用时请附「以游戏内为准」。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append("## 📸 本页概览")
    out.append("")
    out.append("| 项目 | 说明 |")
    out.append("|------|------|")
    out.append(f"| **收录件数** | **{page['count']:,} 件**（全站物品图鉴共 {total_items:,} 件） |")
    out.append(f"| **叶子分类** | {page['leaf_n']} 个官方分类，分 **{len(parts)}** 册列出 |")
    out.append("| **为什么分册** | 整类一次列完是 **100+ 屏**，读者要滚很久、页内锚点也失去意义。"
               "按叶子分类切成若干册后，每册约 **40** 屏以内，且**每册可单独分享** |")
    out.append("| **数据来源** | `json.tarkov.dev` 的 `itemCategories` 树与 `items` 接口，二级来源 |")
    out.append(f"| **抓取日期** | {FETCH_DATE} |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 分册")
    out.append("")
    out.append("| # | 范围 | 件数 |")
    out.append("|---|------|------|")
    for i, pt in enumerate(parts, 1):
        out.append(f"| {i} | [{pt['title']}]({pt['slug']}.md) | {pt['count']} |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 相关页面")
    out.append("")
    out.append("- [物品图鉴总览](index.md) — 全站检索与筛选入口")
    out.append("- [任务需求物品反查](../quests/item-lookup.md) — 某物品被哪些任务要求")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append("**最后更新**: " + BASE_MONTH + " ｜ "
               "**贡献者** [GTX950L](https://github.com/GTX950L) ｜ "
               "**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def annotate_acquisition(plan, buckets, routes):
    """给每一行写一个「获取方式」短标签；返回全站统计（供打印核对）。

    回答读者的问题：**「这些东西我去哪弄？」** —— 图鉴的表格原本只有价格，
    而价格是「值多少」、不是「怎么来」。实测（2026-10-11）：删掉价格列后，
    不开 JS 的读者从图鉴页**完全看不出**一件物品怎么弄到 —— 2433 件商人出售
    与 767 件配方（以物换物 / 制作）一个都没写出来。

    ⚠️ **口径只有三条**（见 `ACQ_LABEL` 与 `load_routes()` 的注释）：
       商人出售 / 以物换物 / 藏身处制作。**不含「哪张图能刷到」。**
       `—` = 站内没收录它的固定渠道，**不等于拿不到**。

    ⚠️ 判「有商人出售」用的是 **buy 单元格非空**（`price_cell` 取不到 priceRUB 时会返回 `—`），
       与 `content/javascripts/catalog.js` 的 `bought` 判定**同一把尺子**。
       别另拿 `buyFromTrader` 判 —— 两处口径一分叉，就会出现「表里有列、详情里说没有」。
    """
    stat = {"items": 0, "buy": 0, "barter": 0, "craft": 0, "any": 0, "none": 0}
    for p in plan:
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                ks = set()
                if it["buy"] != "—":
                    ks.add("buy")
                for r in routes.get(it["id"]) or []:
                    ks.add(r["k"])
                it["acq"] = " / ".join(ACQ_LABEL[k] for k in ACQ_ORDER if k in ks) or "—"
                stat["items"] += 1
                if "buy" in ks:
                    stat["buy"] += 1
                if "barter" in ks:
                    stat["barter"] += 1
                if "craft" in ks:
                    stat["craft"] += 1
                if ks:
                    stat["any"] += 1
                else:
                    stat["none"] += 1
    return stat


# 「钥匙 → 所在图」数据（gen_maps.py 的产物）。键是物品 id（tarkov.dev item id，
# 与本站物品图鉴同一套键），值 = 出现锁点的地图 key 列表。
KEY_LOC_FILE = ROOT / "scripts" / "data" / "key_locations.json"


def annotate_key_locations(buckets) -> dict:
    """给钥匙物品注入「所在图」字段（`it["lmaps"]`）；返回统计（供打印核对）。

    ⚠️ **数据来源是地图图层的锁点**（gen_maps.py 写出的 scripts/data/key_locations.json），
       不是任务侧推断 —— 这正是 keys.md 口径四条第③条当年「不做」的反面：
       当时只有「任务所在地图」的间接数据（23%），写上去会指错；锁点数据是
       「这把钥匙开哪张图的哪扇门」的**直接证据**（208/259 件 = 80%）。

    ⚠️ 文件缺失 = **工程缺失**（不是数据缺失）：直接退出并提示先跑 gen_maps.py，
       不静默输出一列空白 —— 静默的话，check_gen_drift 重跑两遍也会「稳定地漂」
       一个没有该列的版本，没人会发现。

    ⚠️ 没在锁点数据里的钥匙**不给该字段**（表格留白，口径见页面「口径四条」③）——
       「留白 ≠ 不在这张图用」，那句话必须落在页面上。
    """
    if not KEY_LOC_FILE.exists():
        raise SystemExit(
            f"[错误] 缺 {KEY_LOC_FILE.relative_to(ROOT)} —— 「所在图」列的数据源。\n"
            "  先运行：python scripts/gen_maps.py（离线，用缓存）")
    kl = json.loads(KEY_LOC_FILE.read_text(encoding="utf-8"))
    maps_zh: dict = kl.get("maps") or {}
    loc: dict = kl.get("keys") or {}

    stat = {"with": 0, "pairs": 0, "dangling": []}
    seen: set = set()
    for lid, items in buckets.items():
        for it in items:
            kids = loc.get(it["id"])
            if not kids:
                continue
            # 结构 [[地图key, 中文名], …]：静态表与 JS 表都从这份数据各自拼链接
            # （相对路径的拼法与 URL 基准不同，两处各拼是对的；**文字取自同一份数据**）。
            it["lmaps"] = [[k, maps_zh.get(k, k)] for k in kids]
            seen.add(it["id"])
            stat["with"] += 1
            stat["pairs"] += len(kids)
    # 锁点引用了、但图鉴里找不到对应物品的 id：数据对不上的迹象，报出来（不静默丢）。
    stat["dangling"] = sorted(set(loc) - seen)
    return stat


# ── 「赛季通行证文件」：刷新地图速查 ─────────────────────────────────────────
#
# 9 类文件里 8 类的刷新地图写在**游戏内物品描述原文**里（「可在以下地点找到此类文件：
# - X - Y - Z」），逐件解析 `desc` —— **不手工维护映射表**（官方改描述，重跑即可跟上；
# 解析不出来的自然落「不走地图刷新」，如秘密文件——它是购买品）。
#
# 机制条（上限 / 5 换 1 / 独立刷新）来自页面之外的信息，来源与冲突处理写进表注：
# 每日上限主口径 30/20/15（官方 Wiki + 两家中文站一致）；部分英文社区站记
# 25/15/10 —— 口径不一，按站内惯例写上「以游戏内为准」。
BP_MAP_RE = re.compile(r"可在以下地点找到此类文件[:：]\s*(.+)")
BP_MAP_ITEM_RE = re.compile(r"[-–—]\s*([^\s\-–—]+)")


def bpdoc_section(items) -> list:
    """渲染「刷新地图速查」小节（地图表 + 收集机制注）；返回 Markdown 行列表。

    由 page_markdown 在「赛季通行证文件」分类尾部追加。
    """
    parsed: list = []
    no_map: list = []
    for it in items:
        m = BP_MAP_RE.search(it.get("desc") or "")
        maps = BP_MAP_ITEM_RE.findall(m.group(1)) if m else []
        if maps:
            parsed.append((it["name"], maps))
        else:
            no_map.append(it["name"])

    out: list = []
    out.append("#### 刷新地图速查")
    out.append("")
    out.append("> **8 类文件各在固定的 3 张图上刷新** —— 地图列表逐件取自"
               "**游戏内物品描述原文**（「可在以下地点找到此类文件」一句），"
               "不是社区整理表；版本更新后重跑生成器即跟上。")
    out.append("")
    out.append("| 文件 | 刷新地图 |")
    out.append("|------|----------|")
    for name, maps in parsed:
        cells = []
        for zh in maps:
            k = MAP_KEY_BY_CN.get(zh)
            cells.append(f"[{zh}](../maps/{k}.md)" if k else zh)
        out.append(f"| {name} | {'、'.join(cells)} |")
    out.append("")
    if no_map:
        out.append(f"> **{'、'.join(no_map)}** 不在地图刷新 —— 它是**购买品**："
                   "在游戏内的 **Expansions Hub** 购入，可替代任意类型上交，"
                   "且对后续赛季同样有效。")
        out.append("")
    out.append("> **收集机制四条**（来源：官方 Wiki 与两家中文站交叉核对，2026-10-16）：")
    out.append(">")
    out.append("> ① **每人独立刷新** —— 你捡到的那一份别人拿不走（PMC 与 Scav、三种模式"
               "都能捡）；击杀**黑色分部干员**也会掉文件（这一类是全队共享的战利品）。")
    out.append(">")
    out.append("> ② **每日拾取上限**：赛季模式 **30** / PvP **20** / PvE **15**，"
               "三个模式**共享**同一个额度（先在 PvE 捡了 15 份，当天在赛季模式就只剩 15 份），"
               "每日重置、剩余数量在游戏内通行证界面的文件区可见。"
               "⚠ 部分英文社区站记为 25 / 15 / 10 —— 口径不一，**以游戏内显示为准**。")
    out.append(">")
    out.append("> ③ **5 换 1**：在通行证界面的交换区，任意 5 份可换成 1 份自选类型。")
    out.append(">")
    out.append("> ④ **领完全部奖励共需上交 501 份**（各玩家所需类型组合不同）；"
               "已解锁的奖励在所有模式间通用且永久保留，赛季结束仍未解锁的则永久不可获得。")
    out.append("")
    return out


def page_markdown(page, leaves, buckets, total_items, kl_stat=None) -> str:
    rows = []
    for lid in page["leaves"]:
        path = leaves[lid]
        rows.append((lid, path, buckets.get(lid, [])))
    spec = col_spec(page["slug"])

    out = []
    out.append("---")
    out.append("tags:")
    out.append("  - 物品")
    out.append("  - 速查")
    out.append("---")
    out.append("")
    out.append(f"# {page['title']}（Item Catalog）")
    out.append("")
    out.append(f"> 版本基线：{BASE_MONTH} ｜ {BASE_VER}（第一赛季 KORD BREACH）｜ 数据来源：tarkov.dev（二级）")
    out.append("> 本页为**生成页**，数值随版本调整，引用时请附「以游戏内为准」。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append("## 📸 本页概览")
    out.append("")
    out.append("| 项目 | 说明 |")
    out.append("|------|------|")
    out.append(f"| **收录件数** | **{page['count']:,} 件**（全站物品图鉴共 {total_items:,} 件） |")
    # 拆出来的子页：**必须说清「这不是全部」以及其余在哪** ——
    # 否则读者会以为这个大类只有这一页的内容。
    if page.get("parts"):
        w = page["whole"]
        out.append(f"| **本页范围** | 第 **{page['part']}** / {page['parts']} 部分"
                   f"（[{w['title']}]({w['slug']}.md) 整类共 {w['count']} 件、"
                   f"{w['leaves']} 个官方分类） |")
    out.append(f"| **叶子分类** | {len(page['leaves'])} 个官方分类："
               + "、".join(
                   f"[{leaves[l][-1]}](#{leaf_anchor(leaves[l][-1])})"
                   for l in page["leaves"]) + " |")
    # 「获取方式」的覆盖数**必须从本页自己的行里数出来**（不另取常量表）——
    # 与 check_catalog_consistency 的纪律同源：判断集要来自被检查的对象。
    acq = {"all": 0, "buy": 0, "barter": 0, "craft": 0, "any": 0}
    for _lid, _path, items in rows:
        for it in items:
            s = it.get("acq") or "—"
            acq["all"] += 1
            if s == "—":
                continue
            acq["any"] += 1
            for k in ("buy", "barter", "craft"):
                if ACQ_LABEL[k] in s:
                    acq[k] += 1
    out.append(
        "| **获取方式** | 站内收录的**固定**渠道：`商人出售` / `以物换物` / `制作`。"
        f"本页 **{acq['any']} / {acq['all']} 件**有至少一条"
        f"（商人出售 {acq['buy']} ｜ 以物换物 {acq['barter']} ｜ 制作 {acq['craft']}）；"
        "`—` **不是「拿不到」**，只表示站内没收录它的固定渠道 —— "
        "那类得靠搜刮或跳蚤市场，而这两样站内不给点位（判据见[战利品分布](../entries/loot.md)）|")
    # 只在用得到这一列时写：**逐页声明列口径，别让读者自己去猜哪一列是什么来源**。
    if page["slug"] == "keys":
        out.append("| **使用次数** | 取数据源的 `uses` 字段 —— 同价不同次是两笔不同的交易，"
                   "买之前先看这一列。9 件的该字段为 0，本站留白，见下方「口径四条」 |")
        out.append("| **官方简介** | 游戏内物品描述的中文本地化原文，**本页 259 件全覆盖**"
                   "（平均 29 字）。它是判断「这把钥匙开什么门」最直接的一句 |")
    out.append("| **数据来源** | `json.tarkov.dev` 的 `itemCategories` 树与 `items` 接口，二级来源 |")
    out.append(f"| **抓取日期** | {FETCH_DATE} |")
    out.append("| **配套页面** | [物品图鉴总览](index.md) ｜ "
               "[任务需求物品反查](../quests/item-lookup.md) ｜ [配方速查表](../docs/recipes.md) |")
    if page["slug"] == "keys":
        out.append("| **按图带钥匙** | 全站 57 个任务需要 59 把钥匙，"
                   "**按地图归拢**的任务视角表在[任务图鉴 §4](../quests/index.md)；"
                   "本页钥匙的**「所在图」列**来自地图锁点图层（口径见下方「口径四条」③） |")
    out.append("")
    if page["slug"] == "keys":
        # 口径说明放在**概览表正下方**，不放检索面板后面 ——
        # 实测（2026-10-11 截图核对）放在面板后时，读者看到的顺序变成
        # 「概览 → 检索面板（里面就有使用次数列）→ 口径」，而口径恰恰是解释那一列的。
        # 顺序本身是内容的一部分：**先给口径，再让读者看到数字。**
        # 页内有两个分类表，所以口径只写一次（逐表重复等于让读者读两遍）。
        out.append("> **口径四条，引用前先读**：")
        out.append(">")
        out.append("> ① **使用次数**取自数据源的 `uses` 字段（二级来源，直读游戏文件）。"
                   "同价不同次是两笔不同的交易，**买之前先看这一列**。")
        out.append(">")
        out.append("> ② **留白的 9 件**（门禁卡 8 件、机械钥匙 1 件）该字段为 0，"
                   "**本站不把它写成「0 次」**——那会被读成「已经用完了」。"
                   "数据源未说明 0 的含义，请以游戏内的物品描述为准。")
        out.append(">")
        _n_keys = sum(len(buckets.get(l, [])) for l in page["leaves"])
        _n_loc = (kl_stat or {}).get("with", 0)
        out.append("> ③ **「所在图」列取交互地图的锁点图层 —— 直接证据，不是推断**："
                   "标出这把钥匙出现在**哪几张图的哪几扇门上**；**点图名**跳到该图"
                   "并高亮它的全部锁点。覆盖 "
                   f"**{_n_loc} / {_n_keys} 件**；没被锁点数据收录的钥匙留白 —— "
                   "**留白不代表「不在这张图用」**，只表示上游锁点数据里没有它的门。"
                   "**本列也不等于任务需求**：「哪个任务在哪张图要它」是另一条线，"
                   "见[任务图鉴 §4「任务与钥匙」](../quests/index.md)。"
                   "（2026-10-08 版页面写「不标地图」：当时只拿得到「任务所在地图」的"
                   "间接数据（59 件 / 23%），写上去会指错 —— 交互地图补上锁点图层后，"
                   "这个理由已不成立。）")
        out.append(">")
        out.append("> ④ **官方简介是游戏内的原文**，不是本站的攻略解读 —— "
                   "它常直接点名地点（如「化工厂紧急出口的钥匙」），"
                   "这是判断「它开什么门」最可靠的一句。")
        out.append("")
    out.append("---")
    out.append("")
    out.append("## 🔎 检索与筛选")
    out.append("")
    out.append(f'<div id="tk-catalog" data-slug="{page["slug"]}">'
               '本页的检索、筛选与详情面板需要 JavaScript —— '
               "**下方表格是静态生成的，不开 JS 也能读完**。</div>")
    out.append("")

    # 逐叶子分类出一个表
    for lid, path, items in rows:
        if not items:
            continue
        out.append(f"### {path[-1]}")
        out.append("")
        out.append(f"<a id=\"{leaf_anchor(path[-1])}\"></a>")
        out.append("")
        if len(path) > 2:
            out.append(f"分类路径：{' › '.join(path[:-1])}")
            out.append("")

        # ── 大表排除出全文搜索索引 ────────────────────────────────────
        #
        # 每个分类的表格把**该分类全部物品的属性与价格**平铺在一节里，
        # 一节动辄 40 K 字符（mods-body 的「护木」一节 287 件 → 45 K）。
        # 16 个图鉴页合计占了 search.json 正文字符的 **39%**，是搜索变慢的主因
        # （实测 3.6 MB / gzip 983 KB，而在加图鉴之前是 2.5 MB / 821 KB）。
        #
        # 排除它**不损失可发现性**，因为下面补了一个只含名称的 <details>：
        #   · 按物品名搜 → 命中那个名称一览（<details> 的内容**会被索引**，实测确认）
        #   · 按分类名搜 → 命中 ### 小标题（不受影响）
        #   · 在页内找具体物品 → 用页面自己的检索框（本来就有，且比全局搜索精确）
        # 换掉的只是「口径 9×19mm Parabellum；人机工效 93；垂直后坐 302…」这类
        # **没人会拿去搜的数字串**。
        #
        # ⚠️ 两个前提，缺一不可：
        #   ① `markdown` 属性 —— 否则原始 HTML 块里的 Markdown 不解析，
        #      表格会退化成纯文本（前提由 mkdocs.yml 的 md_in_html 扩展提供）；
        #   ② `data-search-exclude` —— 索引器认这个属性（已实测，两种写法都生效）。
        out.append('<div data-search-exclude markdown>')
        out.append("")
        out.append(spec["header"])
        out.append(spec["sep"])
        for n, it in enumerate(items, 1):
            cells = [str(n)] + [cell_md(it, c[0]) for c in spec["cols"]]
            # 缩略图并进「名称」列的第一格，而不是新加一列：
            # 加列要同步改 16 份表头/分隔行常量（assert_md_header 只校验数量，
            # 校验不了「新列插在哪」），而读者扫表时本来就把图和名字当一件事。
            cells[1] = icon_tag(it) + cells[1]

            out.append("| " + " | ".join(cells) + " |")
        out.append("")
        out.append("</div>")
        out.append("")
        out.append(f"> 本分类 **{len(items)} 件**。价格取各商人中的最优价；"
                   "「商人最低售价」栏附商人与等级要求，「最高回收」栏标注参与回收的商人数。")
        out.append("")
        # 「赛季通行证文件」：追加「刷新地图速查」（数据从游戏内描述原文解析，
        # 见 bpdoc_section 的注释）。其它分类没有这一节。
        if path[-1] == "赛季通行证文件":
            out.extend(bpdoc_section(items))
        # 名称一览：**折叠着**，所以不占版面；内容会被索引用上，
        # 让读者在站内搜索里仍能按物品名找到这一页。
        out.append(f"<details><summary>本分类 {len(items)} 件的名称一览"
                   "（点开可浏览；站内搜索靠它命中物品名）</summary>")
        out.append("")
        out.append("　".join(it["name"] for it in items))
        out.append("")
        out.append("</details>")
        out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 相关页面")
    out.append("")
    out.append("- [物品图鉴总览](index.md) — 全站物品的分类入口与检索")
    out.append("- [任务需求物品反查](../quests/item-lookup.md) — 某物品被哪些任务要求、要不要留")
    out.append("- [配方速查表](../docs/recipes.md) — 制作与以物换物的完整配方")
    out.append("- [跳蚤定价与手续费](../entries/flea-pricing.md) — 市场侧的定价规则")
    out.append("- [商人系统](../entries/traders.md) — 商人等级与补货机制")
    out.append("")
    out.append("📖 [返回物品图鉴总览](index.md)")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append(f"**最后更新**: {FETCH_DATE[:7].replace('-', ' 年 ')} 月 ｜ "
               "**贡献者** [GTX950L](https://github.com/GTX950L) ｜ "
               "**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def leaf_anchor(s):
    a = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", s).strip("-").lower()
    return a


def index_markdown(plan, total_items, leaves_zh) -> str:
    out = []
    out.append("---")
    out.append("tags:")
    out.append("  - 物品")
    out.append("  - 索引")
    out.append("---")
    out.append("")
    out.append("# 物品图鉴（Item Catalog）")
    out.append("")
    out.append(f"> 版本基线：{BASE_MONTH} ｜ {BASE_VER}（第一赛季 KORD BREACH）｜ 数据来源：tarkov.dev（二级）")
    out.append("> 全站物品的分类检索入口。数值随版本调整，引用时请附「以游戏内为准」。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append("## 📸 本页概览")
    out.append("")
    out.append("| 项目 | 说明 |")
    out.append("|------|------|")
    out.append(f"| **收录件数** | **{total_items:,} 件**（不含枪械预配方案） |")
    out.append(f"| **分类页** | {len(plan)} 页，按官方 `itemCategories` 树的顶层组归并 |")
    out.append("| **收录依据** | 全量收录 —— 只收录任务物品或热门物品会让读者「查不到就是没有」，"
               "而图鉴的价值恰恰在于查得到 |")
    out.append("| **数据来源** | `json.tarkov.dev`（二级来源，直读游戏文件）；分类名取自游戏内译名 |")
    out.append(f"| **抓取日期** | {FETCH_DATE} |")
    out.append("| **不收录** | ① **枪械预配方案**（497 条，是同一底枪的改装组合，不是独立物品）"
               "② **配图** —— 本图鉴以文字与表格呈现（图标只出现在任务详情与进度页） |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 🔎 全站物品检索")
    out.append("")
    out.append('<div id="tk-catalog-all">全站检索需要 JavaScript —— '
               "下方分类清单是静态的，不开 JS 也能用。</div>")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 💎 单格价值榜")
    out.append("")
    out.append('<a id="value-rank"></a>')
    out.append("")
    out.append("**「背包里的一格，装什么最值钱」**—— 用站内现成的重量与商人回收价算出来的排序，"
               "不联网、不需要跳蚤价。")
    out.append("")
    out.append("> **口径三条，引用前先读**：")
    out.append(">")
    out.append("> ① 价值取 **商人最高回收**，**不是跳蚤价** —— 站内不收录实时价格"
               "（理由见[配方速查表](../docs/recipes.md)的口径节）。"
               "所以本榜回答的是「卖给商人时哪种东西最值钱」，跳蚤价通常更高、排序也可能不同；")
    out.append("> ② 分母是 **占地格数**（宽 × 高），不是体积、不是重量 —— "
               "拿重量估「占几格」会错，0.4 千克的东西可能占 1 格也可能占 4 格；")
    out.append("> ③ **缺回收价或缺格数的物品不入榜** —— 算不出就算不出，不拿默认值凑数。")
    out.append("")
    out.append("本榜只列前 30 名。要看**全部**可算物品的完整排序，用上方检索区的 "
               "**「排序方式 → 按单格价值降序」**（可同时按类型、关键词把范围缩小）。")
    out.append("")
    out.append('<div id="tk-catalog-value">单格价值榜需要 JavaScript —— '
               "上方检索区的静态内容与下方分类清单不受影响，不开 JS 也能用。</div>")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📂 分类页清单")
    out.append("")
    out.append("| 分类 | 件数 | 覆盖范围 |")
    out.append("|------|------|----------|")
    for p in plan:
        names = "、".join(leaves_zh[p["slug"]])
        out.append(f"| [{p['title']}]({p['slug']}.md) | **{p['count']}** | {names} |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 💡 怎么用这本图鉴")
    out.append("")
    out.append("**① 先查分类，再筛数值。** 每页默认按重量升序排列 —— "
               "同样占一格，越轻越划算，这是最省事的取舍判据。"
               "想知道**一格装什么最值钱**，把排序换成「按单格价值降序」，"
               "或直接看上方[单格价值榜](#value-rank)。")
    out.append("")
    out.append("**② 价格栏读法不同。** 「商人最低售价」是**你要付的钱**（附商人与等级要求），"
               "「商人最高回收」是**你能拿回的钱**。两者差距大，说明这件物品值得自己带去卖。")
    out.append("")
    out.append("**③ 和任务需求对照。** 图鉴回答「这件东西有什么」，"
               "[任务需求物品反查](../quests/item-lookup.md)回答「这件东西有没有人要」—— "
               "两个方向都查过，才决定要不要留。")
    out.append("")
    out.append("**④ 不确定能不能装下。** [背包与容器系统](../entries/inventory.md)讲格子与体积规则，"
               "本页的「重量」与占地在那个体系里才有意义。")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 相关页面")
    out.append("")
    out.append("- [任务需求物品反查](../quests/item-lookup.md) — 某物品被哪些任务要求")
    out.append("- [配方速查表](../docs/recipes.md) — 制作与以物换物")
    out.append("- [商人系统](../entries/traders.md) — 商人等级与补货")
    out.append("- [跳蚤定价与手续费](../entries/flea-pricing.md) — 市场侧定价规则")
    out.append("")
    out.append("📖 [返回物品图鉴总览](index.md)")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append(f"**最后更新**: {FETCH_DATE[:7].replace('-', ' 年 ')} 月 ｜ "
               "**贡献者** [GTX950L](https://github.com/GTX950L) ｜ "
               "**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


def load_routes():
    """读 ``scripts/data/recipes.json`` → 「物品 id → 获取途径列表」。

    要回答读者的第二个问题：**「这个东西我去哪弄？」**

    ⚠️ **只收「确定的途径」：商人以物换物、藏身处制作。**

    刻意**不收「哪张图能刷到」**，理由是实测出来的量级问题：
    静态端点的 ``maps.lootLoose`` 只覆盖 **341 / 5476 = 6.2%** 的物品，而它只含
    **散落刷新**（战利品大头在容器里，而容器的掉落表只在 GraphQL 端点里有、
    静态端点不给）。拿 6.2% 去回答「去哪找」，读者会以为「只有这几张图有」——
    **不全是误导，是多半会误导**。站内既有的 [战利品分布](../entries/loot.md) 本来
    也只给判断框架、不给点位表，这里的边界与它一致。

    所以本栏的措辞是「**这三条是确定的获取途径**」，而不是「全部获取途径」。

    ``recipes.json`` 的产物数是 932 种、途径 1069 条。
    """
    f = ROOT / "scripts" / "data" / "recipes.json"
    if not f.exists():
        return {}, {}, {}
    r = json.loads(f.read_text(encoding="utf-8"))
    names = r.get("names") or {}
    routes = collections.defaultdict(list)
    for c in r.get("crafts") or []:
        routes[c["product"]].append({
            "k": "craft", "s": c["station"], "lv": c["level"],
            # [材料名, 数量, 是否只当工具用（不消耗）]
            "m": [[names.get(m["item"], m["item"]), m["count"],
                   1 if m.get("tool") else 0] for m in (c.get("materials") or [])],
        })
    for b in r.get("barters") or []:
        routes[b["product"]].append({
            "k": "barter", "s": b["trader"], "lv": b["level"],
            "m": [[names.get(m["item"], m["item"]), m["count"]]
                  for m in (b.get("materials") or [])],
        })
    return routes, names, {"fetched": r.get("fetched"), "baseline": r.get("baseline")}


def load_quest_needs(leaf_ids):
    """读 ``scripts/data/items_index.json`` → 「物品名 → 任务需求」。

    要回答第三个问题：**「这东西有任务要吗、要不要留？」**（站内已有
    [物品反查](../quests/item-lookup.md) 覆盖面，这里做的是**从图鉴侧反向接过去**，
    让读者查到一件物品时不必再手动去那一页搜。）

    ⚠️ **这份数据按「中文名」索引，而图鉴按 id 索引**，所以要按名字桥接。
    桥不上的**必须报出来、不静默丢** —— 实测 833 种任务物品里只有 **722 种（86.7%）**
    能在图鉴里找到，剩下 111 种是**任务专属道具**（「Prapor 的包裹」「水泵运行数据」），
    它们不在 tarkov.dev 的 items 端点里 —— 那类东西本来也不该问「去哪取得」，
    是任务给你的。这个数字由 main 输出，让人一眼看到覆盖率。
    """
    f = ROOT / "scripts" / "data" / "items_index.json"
    if not f.exists():
        return {}, 0
    d = json.loads(f.read_text(encoding="utf-8"))
    return d.get("items") or {}, len(d.get("items") or {})


def write_js(plan, buckets, leaves, total_items, routes, quests, item_of_name):
    """按大类切块写 catalog-data.js —— 每页只加载自己那一块。

    除物品本体外还带三份索引，都是「详情面板点开后才用」的：

      · ``routes``  物品 id → 获取途径（商人换 / 藏身处做）
      · ``quests``  物品 id → 哪些任务要它
      · ``pages``   物品 id → 图鉴页 slug（供站内其它页面链接过来定位）
    """
    chunks = {}
    pages = {}
    # 每行按**位置**索引读出，前端 catalog.js 也是按位置读的。
    # 基点顺序由 `ROW_BASE` 定（[0]id [1]中文名 [2]英文归一名 [3]重量kg
    # [4]属性摘要 [5]商人最低售价 [6]商人最高回收 [7]types[0] [8]占地格数），
    # 表外字段按 `EXTRA_FIELDS` 依次追加。
    #
    # ⚠️ **前端不再硬编码下标** —— 它按下面 `index[slug].cols` 里给的
    #    `[字段名, 表头, 语义类, 下标]` 逐列渲染。所以这里改了基点顺序、
    #    或者某页多带了字段，前端会自动跟着走；**唯一要同步的是两侧的格式器
    #    （这里的 `cell_md` / 那边的 FMT）**。
    base = {f: i for i, f in enumerate(ROW_BASE)}
    idx = {}
    for p in plan:
        slug = p["slug"]
        spec = col_spec(slug)
        fields = [c[0] for c in spec["cols"]]
        # 两档表外字段（见 EXTRA_ALWAYS / EXTRA_OPTIONAL 的注释）：
        #   always   —— 每页都有、下标全站固定；总览页把各分块拼起来共用一份列规格，
        #               只有这一档能出现在那里。
        #   optional —— 只为用到它的页面追加（`desc` 全站 145 KB，不该人人背）。
        extras = list(EXTRA_ALWAYS) + [f for f in EXTRA_OPTIONAL if f in fields]
        fmap = dict(base)
        for k, f in enumerate(extras):
            fmap[f] = len(ROW_BASE) + k
        arr = []
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                row = [it["id"], it["name"], it["en"], it["weight"], it["props"],
                       it["buy"], it["sell"], it["types"][0] if it["types"] else "",
                       it["size"]]
                row.extend(it.get(f) for f in extras)
                arr.append(row)
                pages[it["id"]] = slug
        chunks[slug] = arr
        idx[slug] = {"title": p["title"], "count": p["count"],
                     "cols": [[c[0], c[1], c[2], fmap[c[0]]] for c in spec["cols"]],
                     "leaves": [{"path": leaves[l], "n": len(buckets.get(l, []))}
                                for l in p["leaves"] if buckets.get(l)]}

    # 「任务需求」按中文名索引，这里翻成按 id 索引，前端才查得到。
    quests_by_id = {}
    unmatched_quest_items = []
    for name, v in (quests or {}).items():
        iid = item_of_name.get(name)
        if iid:
            quests_by_id[iid] = v
        else:
            unmatched_quest_items.append(name)

    # 只保留**确实收进图鉴的**物品的途径，避免前端拿到悬空 id 画不出东西。
    live = set(pages)
    routes = {k: v for k, v in (routes or {}).items() if k in live}
    route_stats = {
        "items": len(routes),
        "total": sum(len(v) for v in routes.values()),
        "barter": sum(1 for v in routes.values() for x in v if x["k"] == "barter"),
        "craft": sum(1 for v in routes.values() for x in v if x["k"] == "craft"),
    }

    body = json.dumps({"fetched": FETCH_DATE, "total": total_items,
                       "index": idx, "chunks": chunks,
                       "routes": routes, "quests": quests_by_id},
                      ensure_ascii=False, separators=(",", ":"))
    JS.mkdir(parents=True, exist_ok=True)
    (JS / "catalog-data.js").write_bytes(
        ("/* 由 scripts/gen_items_catalog.py 生成 —— 勿手改。\n"
         f"   数据源 json.tarkov.dev（二级），抓取日期 {FETCH_DATE}。 */\n"
         "window.TARKOV_CATALOG=" + body + ";\n").encode("utf-8"))
    return len(body), pages, unmatched_quest_items, route_stats


def item_page_markdown(total_items, with_desc) -> str:
    """生成「单件物品详情」视图页的静态骨架（``content/catalog/item.md``）。

    ⚠️ 这一页**不是**每件物品一个页面，是**一个**按地址里的物品 ID 渲染的视图页。
       为什么不做成每件一个 HTML：实测每页平均 146 KB，其中绝大部分是站点框架
       （侧栏 nav + 主题）；近 5,000 页合计约 700 MB —— 既逼近 GitHub Pages 的 1 GB 上限，
       也是「一页框架装 1 KB 内容」的浪费，还让构建时间翻数十倍。
    """
    out = []
    out.append("---")
    out.append("tags:")
    out.append("  - 物品")
    out.append("  - 索引")
    out.append("---")
    out.append("")
    out.append("# 物品详情（Item Detail）")
    out.append("")
    out.append(f"> 版本基线：{BASE_MONTH} ｜ {BASE_VER}（第一赛季 KORD BREACH）"
               "｜ 数据来源：tarkov.dev（二级）")
    out.append("> 单件物品的完整页面。数值随版本调整，引用时请附「以游戏内为准」。")
    out.append("")
    out.append('<a id="top"></a>')
    out.append("")
    out.append("## 📸 本页是什么")
    out.append("")
    out.append("[物品图鉴](index.md) 的分类页是**一排同类物品横着比**；这一页是"
               "**单件物品竖着看** —— 官方介绍、重量与占地、商人买卖价、怎么拿到它、"
               "有没有任务要它，一屏读完。")
    out.append("")
    out.append(f"> **这是一个视图页，不是 {total_items} 个页面。** "
               "全站没有给每件物品各生成一个 HTML —— "
               "实测那样做站点会从 23 MB 涨到约 700 MB，而每页 146 KB 里绝大部分是站点框架开销。"
               "本页按地址里的物品 ID 渲染对应物品，**链接可分享、可收藏、可刷新恢复**。")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 🔎 单件物品详情")
    out.append("")
    out.append('<div id="tk-item-page">物品详情需要 JavaScript —— 不开脚本时，请到'
               "[物品图鉴总览](index.md)的分类页里查（那里有全量静态表格，零脚本可读）。</div>")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📐 数据口径")
    out.append("")
    out.append("| 项目 | 说明 |")
    out.append("|------|------|")
    out.append(f"| **收录范围** | 全部 **{total_items} 件**物品（不含枪械预配方案），"
               "与[物品图鉴](index.md)同一份数据 |")
    out.append(f"| **官方介绍** | 游戏内物品描述的中文本地化原文 —— **{with_desc} 件有**，"
               "其余官方未提供中文，显示为空 |")
    out.append("| **价格** | **商人最低售价 / 最高回收**，静态快照；**不含跳蚤价**"
               "（站内不联网、不收实时价，与[配方速查表](../docs/recipes.md)同口径） |")
    out.append("| **占地** | 宽 × 高，即游戏内的格子数（不是体积、不是重量） |")
    out.append(f"| **配图** | 官方 `assets.tarkov.dev` 的 64×64 透明底原图，"
               "全量 5,480 件，文件名即物品 ID（`assets/items/icons/<id>.webp`）；"
               "图鉴表、本页、任务页共用同一份文件 |")
    out.append("| **外部链接** | 指向官方 Wiki 的对应条目 |")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## 📚 相关页面")
    out.append("")
    out.append("- [物品图鉴总览](index.md) — 全站物品的分类检索入口")
    out.append("- [物品反查（要不要留）](../quests/item-lookup.md) — 某物品被哪些任务要求")
    out.append("- [配方速查表](../docs/recipes.md) — 制作与以物换物")
    out.append("")
    out.append("📖 [返回物品图鉴总览](index.md)")
    out.append("")
    out.append('⬆️ **[回到顶部](#top)**')
    out.append("")
    out.append(f"**最后更新**: {FETCH_DATE[:7].replace('-', ' 年 ')} 月 ｜ "
               "**贡献者** [GTX950L](https://github.com/GTX950L) ｜ "
               "**License**: CC BY-NC-SA 4.0")
    out.append("")
    return "\n".join(out)


# 详情分片的片数。32 是实测选的：片内最多 175 / 最少 137 件（极差比 1.28），
# 单次只下约 78 KB 未压缩。改这个数**必须同步改** 前端 catalog-item.js。
SHARD_COUNT = 32


def shard_key(iid) -> int:
    """物品 id → 分片号（0 ~ SHARD_COUNT-1）。

    ⚠️ **不能用 id 的首字符**：实测塔科夫物品 id 的首字符**只有 5 与 6 两种**
       （2148 / 2831 件），按它切只得到 2 片、单片 1.2 MB —— 等于没切。
       改用「十六进制数字之和取模」：实测 32 片下分布均匀（最多 175 / 最少 137）。

    ⚠️ 前端 ``content/javascripts/catalog-item.js`` 里有一份**等价实现**，
       算法与片数必须一致，否则详情页会拉错片、静默显示「找不到这件物品」。
    """
    return sum(int(c, 16) for c in iid) % SHARD_COUNT


def write_item_detail(plan, buckets, routes, quests, name_to_id, total_items):
    """写「单件物品详情」的分片数据，外加承载它的那一个视图页。

    **为什么要分片**：一件物品的完整详情（含官方介绍、获取途径、任务需求）
    平均约 500 字节，4979 件合计约 2.5 MB。合成一个文件的话，读者点开任意一件
    都得先下 2.5 MB —— 与全站「弱网可读」的定位直接冲突。

    分片规则见 ``shard_key()``：前端拿到 id 就能直接算出该拉哪一片，
    **不需要额外的索引文件**。
    """
    # 「这件物品属于哪个分类页」—— 详情页的「返回同类」链接要用
    slug_of = {}
    title_of = {}
    for p in plan:
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                slug_of[it["id"]] = p["slug"]
                title_of[it["id"]] = p["title"]

    # 任务需求按**中文名**索引，这里翻成按 id（与 write_js 里是同一套翻法）
    quests_by_id = {}
    for name, v in (quests or {}).items():
        iid = name_to_id.get(name)
        if iid:
            quests_by_id[iid] = v

    rows = collections.defaultdict(dict)
    with_desc = 0
    for p in plan:
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                iid = it["id"]
                if it["desc"]:
                    with_desc += 1
                rows[shard_key(iid)][iid] = {
                    "n": it["name"], "e": it["en"], "w": it["weight"],
                    "z": it["size"], "t": it["types"][0] if it["types"] else "",
                    "b": it["buy"], "s": it["sell"], "p": it["props"],
                    "d": it["desc"], "k": it["wiki"], "g": slug_of[iid],
                    "gt": title_of[iid],
                    "r": (routes or {}).get(iid) or [],
                    "q": quests_by_id.get(iid),
                    # 「所在图」（仅钥匙有值；没值的**不带这个键** —— 全量带 null
                    # 会给 4700+ 件非钥匙物品白加字段，约 40 KB）。渲染见 catalog-item.js。
                    **({"lm": it["lmaps"]} if it.get("lmaps") else {}),
                }

    JS.mkdir(parents=True, exist_ok=True)
    # 先清掉旧分片：片数改过之后，旧文件名不会与新的一致，
    # 不清就会**残留一堆没人引用的分片**（站点白白变重）。
    for old in JS.glob("catalog-item-*.js"):
        old.unlink()
    total_bytes = 0
    for c in sorted(rows):
        body = json.dumps(rows[c], ensure_ascii=False, separators=(",", ":"))
        total_bytes += len(body.encode("utf-8"))
        (JS / f"catalog-item-{c:02d}.js").write_bytes(
            ("/* 由 scripts/gen_items_catalog.py 生成 —— 勿手改。\n"
             f"   物品详情分片 #{c}（十六进制数字之和 % {SHARD_COUNT} = {c}）。"
             f"抓取日期 {FETCH_DATE}。 */\n"
             "window.TARKOV_ITEM=" + body + ";\n").encode("utf-8"))

    md = item_page_markdown(total_items, with_desc)
    (OUT / "item.md").write_bytes(
        md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    return md, len(rows), sum(len(v) for v in rows.values()), total_bytes, with_desc


def check_anchors(md, slug):
    """页面内所有 ``(#anchor)`` 都要有对应的 ``<a id="anchor">``。

    ⚠️ 这条检查在生成器里、而不只靠 ``zensical build``：分类名带「」这类符号时
    ``leaf_anchor`` 会把它转成别的样子，于是「概览表里的链接」与「下面的锚点」
    对不上。站内踩过同类事故（中文标题 slugify 丢字），而 build 只报一次、
    定位要靠人读。这里在写盘前就把两处一起报出来。
    """
    errs = []
    ids = set(re.findall(r'<a id="([^"]+)">', md))
    for anchor in re.findall(r"\]\(#([^)]+)\)", md):
        if anchor not in ids:
            errs.append(f"[错误] {slug}: 锚点 #{anchor} 在本页没有对应的 <a id>")
    return errs


def reconcile(leaves, buckets, plan, items_total, unassigned, unresolved, bad_prefix):
    """七道对账 —— 任一不过就退出码 1，不写盘。"""
    errs = []
    # ① 叶子集合必须闭合：PAGES 里没写到的叶子必须为 0
    if unassigned:
        errs.append(f"[错误] {len(unassigned)} 个叶子分类没被任何页面收录："
                    f"{[leaves[m][-1] for m in unassigned[:6]]}")
    # ② PAGES 里写了但分类树里没有的前缀（改名/层级调整后会触发）
    if bad_prefix:
        errs.append(f"[错误] PAGES 里 {len(bad_prefix)} 个路径前缀在分类树中不存在：{bad_prefix[:6]}")
    # ③ 引用了不存在的叶子
    used = set()
    for p in plan:
        used |= set(p["leaves"])
    extra = used - set(leaves)
    if extra:
        errs.append(f"[错误] 页面引用了 {len(extra)} 个不存在的叶子分类：{list(extra)[:5]}")
    # ④ 件数之和 ＝ 去 preset 后物品总数
    total = sum(p["count"] for p in plan)
    if total != items_total:
        errs.append(f"[错误] 各页件数之和 {total} ≠ 去 preset 后物品总数 {items_total}")
    # ⑤ 未能归类的物品（cross_route 没命中）
    if unresolved:
        tot = sum(len(v) for v in unresolved.values())
        detail = "；".join(f"{k}: {v[:4]}" for k, v in list(unresolved.items())[:5])
        errs.append(f"[错误] {tot} 件物品无法归入叶子分类 —— 需要在 CROSS_RULES 里补规则。"
                    f"涉及 {detail}")
    # ⑥ 每页件数 ＝ 其叶子桶之和
    for p in plan:
        m = sum(len(buckets.get(l, [])) for l in p["leaves"])
        if m != p["count"]:
            errs.append(f"[错误] {p['slug']} 声明 {p['count']} 件，实际桶里 {m} 件")
    # ⑦ slug 唯一、无空页
    seen = set()
    for p in plan:
        if p["slug"] in seen:
            errs.append(f"[错误] slug 重复：{p['slug']}")
        seen.add(p["slug"])
        if p["count"] == 0:
            errs.append(f"[错误] 页面 {p['slug']} 件数为 0，不该生成")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="抓接口并写缓存")
    ap.add_argument("--check", action="store_true", help="只跑对账，不写盘")
    args = ap.parse_args()

    cache = ROOT / "scripts" / "data" / "items_full.json"
    if args.fetch or not cache.exists():
        print("抓取 json.tarkov.dev …")
        payload = {
            "fetched": FETCH_DATE,
            "items": get("items")["data"],
            "zh": get("items_zh")["data"],
        }
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"  已写 {cache}（{cache.stat().st_size / 1048576:.1f} MB）")

    payload = json.loads(cache.read_text(encoding="utf-8"))
    items = payload["items"]["items"]
    cats = payload["items"]["itemCategories"]
    zh = payload["zh"]

    leaves = build_tree(cats, zh)
    leaf_ids = set(leaves)

    buckets, unresolved = collect(items, zh, leaves, cats, leaf_ids)
    items_total = sum(len(v) for v in buckets.values())

    global unresolved_pre
    unresolved_pre = []
    plan, unassigned, bad_prefix = plan_pages(leaves, buckets, cats)
    leaves_zh = {p["slug"]: sorted({leaves[l][-1] for l in p["leaves"]}) for p in plan}

    print(f"叶子分类 {len(leaves)} 个 ｜ 收录物品 {items_total} 件 ｜ 计划页面 {len(plan)} 页")
    for p in plan:
        print(f"  {p['slug']:16s} {p['count']:5d} 件  {len(p['leaves']):3d} 个叶子分类  {p['title']}")

    errs = reconcile(leaves, buckets, plan, items_total, unassigned, unresolved, bad_prefix)
    if errs:
        print("\n对账未通过，未写任何文件：", file=sys.stderr)
        for e in errs:
            print("  " + e, file=sys.stderr)
        return 1
    print("\n对账通过（七道）：叶子集合闭合 / 前缀全部命中 / 引用有效 / 件数之和相等 / "
          "无未归类物品 / 每页件数一致 / slug 唯一")

    # 「获取方式」标签：**必须在写页面之前算好** —— 静态表与 JS 表都从 `it["acq"]` 读，
    # 而 `acq` 要同时看 `buyFromTrader`（已在 collect 落成 buy 单元格）与 recipes.json。
    # 原先 load_routes() 排在写盘**之后**（那时只有 JS 侧用得到它），本批静态表也要用，
    # 所以整体前移到这里。**别再把它挪回去** —— 挪回去的后果是静态表整列 `—` 而不报错。
    routes, recipe_names, recipe_meta = load_routes()
    acq_stat = annotate_acquisition(plan, buckets, routes)
    # 「所在图」列：与「获取方式」同理，**必须在写页面与写分片之前**注入
    # （静态表从 it["lmaps"] 渲染、JS 行数据从同一份 it 带出去）。
    kl_stat = annotate_key_locations(buckets)
    print(f"所在图（钥匙）：注入 {kl_stat['with']} 件 / {kl_stat['pairs']} 个图-钥匙对"
          + (f"　⚠ 锁点引用了但图鉴里没有的 id：{len(kl_stat['dangling'])} 个"
             f"（{kl_stat['dangling'][:3]}）" if kl_stat["dangling"] else ""))
    if kl_stat["dangling"]:
        print("  （上游锁点数据的 key 引用了站内不存在的物品 id —— 逐条核过再动手）",
              file=sys.stderr)

    if args.check:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    anchor_errs = []
    # 列规格与表头常量是手工维护的一对 —— 加列时只改一处会渲染出列数不齐的表，
    # 而 Markdown 不报错（要么静默串列、要么整表退化成裸竖线段落）。所以先自检。
    spec_errs = []
    for p in expand_splits(plan, leaves, buckets):
        if not p.get("hub"):
            spec_errs += assert_md_header(p["slug"])
    if spec_errs:
        print("\n列规格自检未通过：", file=sys.stderr)
        for e in spec_errs:
            print("  " + e, file=sys.stderr)
        return 1
    for p in expand_splits(plan, leaves, buckets):
        # 被拆开的整页 → 总览页（只列分册，不含大表）
        md = (hub_markdown(p, leaves, items_total) if p.get("hub")
              else page_markdown(p, leaves, buckets, items_total, kl_stat))
        anchor_errs += check_anchors(md, p["slug"])
        f = OUT / f"{p['slug']}.md"
        f.write_bytes(md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
        written.append(f)
    idx = OUT / "index.md"
    idx_md = index_markdown(plan, items_total, leaves_zh)
    anchor_errs += check_anchors(idx_md, "index")
    idx.write_bytes(idx_md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    written.append(idx)

    # ── 清掉**上一轮留下、这一轮不再产出**的页面 ────────────────────────────
    # 必须做，否则拆分后会残留旧的整页（mods-body.md 与 mods-body-1..5 并存）：
    # 那些文件既进不了 nav、又会被 check_entries 当成「有 md 但不在 nav 里」，
    # 而且**它们的内容是过期的**，谁点进去都会看到旧数。
    # 判据用「这一轮的产出表」而不是通配符删除 —— 只删自己疆域内的东西。
    keep = {f.name for f in written} | {"item.md"}   # item.md 由另一段逻辑写，别误删
    for old in sorted(OUT.glob("*.md")):
        if old.name not in keep:
            old.unlink()
            print(f"  清理过期页面：{old.relative_to(ROOT)}")
    if anchor_errs:
        print("\n锚点自检未通过：", file=sys.stderr)
        for e in anchor_errs:
            print("  " + e, file=sys.stderr)
        return 1
    # 注：`routes` 已在写页面前加载（见上方「获取方式」那一段），这里不重复读。
    quests, quest_n = load_quest_needs(leaf_ids)

    # 中文名 → 图鉴位置。任务侧的数据是**按名字**索引的，所以这份映射也得按名字出。
    #
    # ⚠️ **重名必须单独处理，不能「同名取第一个」**：实测图鉴里有 **381 个重名**
    # （占 7.7%，例如不同配色的「Daniel Defence RIS II 9.5 英寸 AR-15 规格护木」）。
    # 硬取第一个会让任务侧链接**指到另一件物品**上 —— 而读者根本看不出错了。
    # 所以：唯一名 → 给 [slug, id] 让链接精确落到那一行；
    #       重名   → 给 null，链接改走**搜索**（`catalog/#q=名字`），由读者自己挑。
    item_of_name, dup_names = {}, set()
    for p in plan:
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                n = it["name"]
                if n in item_of_name:
                    dup_names.add(n)
                item_of_name[n] = (p["slug"], it["id"])

    size, pages, unmatched_q, rstat = write_js(
        plan, buckets, leaves, items_total, routes, quests,
        {k: v[1] for k, v in item_of_name.items()})
    # 站内其它页面（任务侧）靠这份映射把物品名链到图鉴对应位置
    ip = ROOT / "scripts" / "data" / "item_pages.json"
    ip.write_bytes(json.dumps(
        {"fetched": FETCH_DATE,
         "pages": {n: list(v) for n, v in item_of_name.items() if n not in dup_names},
         "dups": sorted(dup_names)},
        ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    item_md, n_shards, n_items, item_bytes, n_desc = write_item_detail(
        plan, buckets, routes, quests,
        {k: v[1] for k, v in item_of_name.items()}, items_total)
    item_anchor_errs = check_anchors(item_md, "item")
    if item_anchor_errs:
        print("\n物品详情页锚点自检未通过：", file=sys.stderr)
        for e in item_anchor_errs:
            print("  " + e, file=sys.stderr)
        return 1
    written.append(OUT / "item.md")

    print(f"\n写出 {len(written)} 个页面 + catalog-data.js（{size / 1048576:.2f} MB 未压缩）")
    print(f"物品详情：{n_shards} 个分片 ｜ {n_items} 件 ｜ 合计 {item_bytes / 1048576:.2f} MB 未压缩"
          f"（单次只下 1 片，约 {item_bytes / max(n_shards, 1) / 1024:.0f} KB）"
          f"　有官方介绍 {n_desc} 件")
    print("锚点自检通过")
    print(f"获取途径：{rstat['items']} 种物品 ｜ {rstat['total']} 条"
          f"（换 {rstat['barter']} ／ 做 {rstat['craft']}）"
          f"　来源 recipes.json 抓取于 {recipe_meta.get('fetched')}")
    print(f"  ⚠️ 口径：recipes 里共 {len(routes)} 种产物，这里只报"
          f"**收进图鉴的 {rstat['items']} 种**（差额是任务专属道具等不在图鉴里的物品）"
          f" —— 打印值必须等于产物里的值，否则文档引用的数字会与页面不符")
    # 页面「本页概览」的获取方式那一行，数字是本页自己数的；这里打全站合计用于核对。
    print(f"获取方式：全站 {acq_stat['items']} 件中 **{acq_stat['any']} 件**有至少一条固定渠道"
          f"（{acq_stat['any'] * 100 // max(acq_stat['items'], 1)}%）"
          f"　商人出售 {acq_stat['buy']} ｜ 以物换物 {acq_stat['barter']} ｜ 制作 {acq_stat['craft']}"
          f"　｜ **{acq_stat['none']} 件为 `—`**（站内没收录固定渠道，不等于拿不到）")
    print(f"任务需求：任务侧 {quest_n} 种 → 桥上 {quest_n - len(unmatched_q)} 种，"
          f"未桥上 {len(unmatched_q)} 种（任务专属道具，不在 items 端点里）")
    if unmatched_q:
        print("  未桥上样例：" + "、".join(unmatched_q[:6]))
    print(f"物品定位映射：{len(item_of_name) - len(dup_names)} 个唯一名精确链接 ｜ "
          f"{len(dup_names)} 个重名走搜索（未桥上任务物品 {len(unmatched_q)} 种不链接）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
