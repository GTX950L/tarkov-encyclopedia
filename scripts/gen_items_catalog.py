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
        if k == "propertiesType" or k not in PROP_LABEL:
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
        buckets[leaf].append({
            "id": it["id"],
            "name": item_name(it, zh),
            "en": it.get("normalizedName") or "",
            "weight": it.get("weight"),
            "types": it.get("types") or [],
            "props": summary,
            "buy": price_cell(it.get("buyFromTrader"), "buy"),
            "sell": price_cell(it.get("sellToTrader"), "sell"),
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


def page_markdown(page, leaves, buckets, total_items) -> str:
    rows = []
    for lid in page["leaves"]:
        path = leaves[lid]
        rows.append((lid, path, buckets.get(lid, [])))

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
    out.append(f"| **收录件数** | **{page['count']} 件**（全站物品图鉴共 {total_items} 件） |")
    out.append(f"| **叶子分类** | {len(page['leaves'])} 个官方分类："
               + "、".join(
                   f"[{leaves[l][-1]}](#{leaf_anchor(leaves[l][-1])})"
                   for l in page["leaves"]) + " |")
    out.append("| **数据来源** | `json.tarkov.dev` 的 `itemCategories` 树与 `items` 接口，二级来源 |")
    out.append(f"| **抓取日期** | {FETCH_DATE} |")
    out.append("| **配套页面** | [物品图鉴总览](index.md) ｜ "
               "[任务需求物品反查](../quests/item-lookup.md) ｜ [配方速查表](../docs/recipes.md) |")
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
        out.append("| # | 名称 | 英文名 | 重量 | 关键属性 | 商人最低售价 | 商人最高回收 |")
        out.append("|---|------|--------|------|----------|--------------|--------------|")
        for n, it in enumerate(items, 1):
            w = fmt_num(it["weight"], " 千克", 3) if isinstance(it["weight"], (int, float)) else "—"
            out.append(
                f"| {n} | {it['name']} | `{it['en']}` | {w} | {it['props']} "
                f"| {it['buy']} | {it['sell']} |"
            )
        out.append("")
        out.append(f"> 本分类 **{len(items)} 件**。价格取各商人中的最优价；"
                   "「商人最低售价」栏附商人与等级要求，「最高回收」栏标注参与回收的商人数。")
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
    out.append(f"| **收录件数** | **{total_items} 件**（不含枪械预配方案） |")
    out.append(f"| **分类页** | {len(plan)} 页，按官方 `itemCategories` 树的顶层组归并 |")
    out.append("| **收录依据** | 全量收录 —— 只收录任务物品或热门物品会让读者「查不到就是没有」，"
               "而图鉴的价值恰恰在于查得到 |")
    out.append("| **数据来源** | `json.tarkov.dev`（二级来源，直读游戏文件）；分类名取自游戏内译名 |")
    out.append(f"| **抓取日期** | {FETCH_DATE} |")
    out.append("| **不收录** | ① **枪械预配方案**（497 条，是同一底枪的改装组合，不是独立物品）"
               "② **配图** —— 沿用全站约定，本图鉴以文字与表格呈现 |")
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
    out.append("**① 先查分类，再筛数值。** 每页按重量升序排列 —— "
               "同样占一格，越轻越划算，这是最省事的取舍判据。")
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
    for p in plan:
        arr = []
        for lid in p["leaves"]:
            for it in buckets.get(lid, []):
                arr.append([it["id"], it["name"], it["en"], it["weight"], it["props"],
                            it["buy"], it["sell"], it["types"][0] if it["types"] else ""])
                pages[it["id"]] = p["slug"]
        chunks[p["slug"]] = arr
    idx = {p["slug"]: {"title": p["title"], "count": p["count"],
                       "leaves": [{"path": leaves[l], "n": len(buckets.get(l, []))}
                                  for l in p["leaves"] if buckets.get(l)]}
           for p in plan}

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

    body = json.dumps({"fetched": FETCH_DATE, "total": total_items,
                       "index": idx, "chunks": chunks,
                       "routes": routes, "quests": quests_by_id},
                      ensure_ascii=False, separators=(",", ":"))
    JS.mkdir(parents=True, exist_ok=True)
    (JS / "catalog-data.js").write_bytes(
        ("/* 由 scripts/gen_items_catalog.py 生成 —— 勿手改。\n"
         f"   数据源 json.tarkov.dev（二级），抓取日期 {FETCH_DATE}。 */\n"
         "window.TARKOV_CATALOG=" + body + ";\n").encode("utf-8"))
    return len(body), pages, unmatched_quest_items


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

    if args.check:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    anchor_errs = []
    for p in plan:
        md = page_markdown(p, leaves, buckets, items_total)
        anchor_errs += check_anchors(md, p["slug"])
        f = OUT / f"{p['slug']}.md"
        f.write_bytes(md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
        written.append(f)
    idx = OUT / "index.md"
    idx_md = index_markdown(plan, items_total, leaves_zh)
    anchor_errs += check_anchors(idx_md, "index")
    idx.write_bytes(idx_md.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
    written.append(idx)
    if anchor_errs:
        print("\n锚点自检未通过：", file=sys.stderr)
        for e in anchor_errs:
            print("  " + e, file=sys.stderr)
        return 1
    routes, recipe_names, recipe_meta = load_routes()
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

    size, pages, unmatched_q = write_js(plan, buckets, leaves, items_total,
                                        routes, quests,
                                        {k: v[1] for k, v in item_of_name.items()})
    # 站内其它页面（任务侧）靠这份映射把物品名链到图鉴对应位置
    ip = ROOT / "scripts" / "data" / "item_pages.json"
    ip.write_bytes(json.dumps(
        {"fetched": FETCH_DATE,
         "pages": {n: list(v) for n, v in item_of_name.items() if n not in dup_names},
         "dups": sorted(dup_names)},
        ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    print(f"\n写出 {len(written)} 个页面 + catalog-data.js（{size / 1048576:.2f} MB 未压缩）")
    print("锚点自检通过")
    print(f"获取途径：{len(routes)} 种物品 ｜ "
          f"{sum(len(v) for v in routes.values())} 条（换 {len([1 for v in routes.values() for x in v if x['k'] == 'barter'])} ／ "
          f"做 {len([1 for v in routes.values() for x in v if x['k'] == 'craft'])}）"
          f"　来源 recipes.json 抓取于 {recipe_meta.get('fetched')}")
    print(f"任务需求：任务侧 {quest_n} 种 → 桥上 {quest_n - len(unmatched_q)} 种，"
          f"未桥上 {len(unmatched_q)} 种（任务专属道具，不在 items 端点里）")
    if unmatched_q:
        print("  未桥上样例：" + "、".join(unmatched_q[:6]))
    print(f"物品定位映射：{len(item_of_name) - len(dup_names)} 个唯一名精确链接 ｜ "
          f"{len(dup_names)} 个重名走搜索（未桥上任务物品 {len(unmatched_q)} 种不链接）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
