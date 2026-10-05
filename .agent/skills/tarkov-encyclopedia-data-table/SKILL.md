---
name: tarkov-encyclopedia-data-table
description: 从 tarkov.dev 结构化端点生成或刷新《逃离塔科夫百科全书》里的行式数值表（已落地：弹药、护甲；可扩展：武器 / 医疗 / 食物），写入条目的 AUTO-GEN 标记区，手写正文一律不碰。触发词：数值表 / 补数据 / 刷新数据 / 弹药数据 / 护甲数据 / 逐型号 / tarkov.dev。
---

# 数值表生成与刷新

**这份手册管的是「把外部结构化数据变成站内的一张表」，不改机制、不写判断。**
判据来自 `content/docs/roadmap.md`：**先问这一页在分工里负责什么**——「以判断为主」的页不塞数字。

## Step 1 — 数据源（只有一处，且**路径必须带 `/regular/`**）

```
https://json.tarkov.dev/regular/items       # 全部物品的结构化数值（约 17 MB）
https://json.tarkov.dev/regular/items_zh    # 中文译名字典（约 1.6 MB）
https://json.tarkov.dev/regular/tasks       # 任务（任务图鉴用，见 gen_quests.py）
```

> ⚠️ **两条硬规矩**（都是踩过的坑）：
> 1. **少写 `/regular/` 会 404**——`https://json.tarkov.dev/` 是不存在的路径；
> 2. **`items` 的文本字段全是占位符**（形如 `"5447a9cd4bdc2dbd208b4567 Name"`），**只能取数值**；中文名一律走 `items_zh`，键形如 `<id> Name` / `<id> ShortName`。**查不到译名就退回英文 `normalizedName`，绝不自己编。**

已落地两个脚本，**新表照抄它们的骨架**：

| 脚本 | 产出 | 落在哪 |
|------|------|--------|
| `scripts/gen_ammo_values.py` | 200 条弹药 × 8 列 | `content/entries/ammo-table.md` |
| `scripts/gen_armor_values.py` | 49 防弹衣 ＋ 112 头盔 ＋ 117 附加护甲 | `content/entries/armor-catalog.md` |
| `scripts/gen_weapon_values.py` | 172 把武器 | `content/entries/weapons.md` |
| `scripts/gen_food_values.py` | 46 种食物与饮料 | `content/entries/food-catalog.md` |
| `scripts/gen_medical_values.py` | 43 件医疗物资（急救包 / 物品 / 兴奋剂） | `content/entries/medical-catalog.md` |
| `scripts/gen_quest_items.py` | 79 种物品的**任务需求反查** ＋ **奖励反查** ＋ 任务速查 | `content/quests/index.md` |
| `scripts/gen_gear_values.py` | 耳机 28 / 夜视 6 / 手雷 13 / 近战 25 | 四个条目页各一处 |
| `scripts/gen_boss_values.py` | Boss 各部位血量（17 个）＋ 各图刷新率 | `content/entries/bosses.md` |

## Step 2 — 怎么挑条目：按 `propertiesType` 分桶

`items` 是 `{id: item}` 的字典，用 `properties.propertiesType` 精确分桶（**别用 `types` 数组**——手雷也带 `ammo` 标签，会把 RGD-5 混进弹药表）：

| propertiesType | 条数 | 是什么 |
|---|---|---|
| `ItemPropertiesAmmo` | 200 | 真弹药（子弹） |
| `ItemPropertiesArmor` | 49 | 防弹衣 |
| `ItemPropertiesHelmet` | 112 | 头盔 |
| `ItemPropertiesArmorAttachment` | 117 | 插板 / 附加护甲 |
| `ItemPropertiesChestRig` | 105 | 胸挂 |
| `ItemPropertiesWeapon` | 172 | 武器 |
| `ItemPropertiesKey` | 257 | 钥匙 |

> ⚠️ **一个只看字段名发现不了的坑（聚合任务数据时尤其致命）**：任务 `objectives` 里的 `items`
> **不是「需求物品」的同义词**——`sellItem`（「卖任何物品给某商人」）的 `items` 是一张**几百条的许可白名单**。
> 把它算进"需求"，「已密封的武器箱」会以 **200 次**虚假登顶，整张榜失真。
> **只统计 `giveItem` / `findItem` / `findQuestItem` / `giveQuestItem` / `plantItem` / `plantQuestItem` 六类。**

## Step 3 — 写入方式：AUTO-GEN 标记

**绝不整页重建**（那是 `gen_quests.py` 的特权，因为任务页整页都是生成的）。数值表是**手写正文 + 生成表**混编，所以：

1. 先在手写页里放一对标记：

   ```markdown
   <!-- AUTO-GEN:AMMO-VALUES:START -->

   <!-- AUTO-GEN:AMMO-VALUES:END -->
   ```

2. 脚本**只替换标记之间的内容**，标记外一律不动；
3. 找不到标记就**报错退出**，不要静默新建。

**表注必须写清三件事**：口径日期 ＋ 基线版本 ＋ 来源层级（二级）；列义（尤其"甲伤""钝伤穿透"这类）；**边界**（哪些没收录、哪些数值口径不同，如霰弹伤害是"每颗弹丸"）。

## Step 4 — 交付前回归（四道门禁 + 三个易漏项）

```bash
python scripts/check_entries.py      # 含「中文正文不留直引号」「表格吞块」
python scripts/check_icons.py        # 图标计数 —— 见下方坑 1
python scripts/check_promises.py
python scripts/skills_consistency.py
```

| 坑 | 表现 | 正确做法 |
|---|---|---|
| **1. 图标计数是连锁的** | 表里加一个 `📊`、表注加一个 `⚠️` → `check_icons` 立刻报「template.md 写 1483、实算 1485」 | **所有文件改完再跑一次**，把 `template.md` 的计数一次改到位；**别边改边跑** |
| **2. CHANGELOG 的回归读数必须最后填** | 先写读数再补内容 → 读数永远是错的（已连踩三批） | 先写 CHANGELOG 主体 → 跑 `check_entries` → **再**补读数行 |
| **3. 中文正文不用直引号** | 在 CHANGELOG 里写 `"……"` → `check_entries` 报错 | 一律用 `「」` 或 `“”`（全角） |
| **4. 站内有「禁词」断言** | 耳机表注初稿写「官方未公布听音**曲线**」→ `check_promises` 报 **B4**（站内明令不再引用任何放大曲线数值） | **下笔前先跑一遍 `check_promises`**，或换措辞（改成「听感相关的参数」） |
| **5. 端点的容器类型会变** | `maps["maps"]` 在 list 与 dict 之间变过；只写 `for x in maps["maps"]` 会遍历到字符串键 → `TypeError: string indices must be integers` | 遍历前判类型：`if isinstance(x, dict): x = list(x.values())` |
| **6. 合并 / 归一化要放在渲染前** | 把「同图同 Boss 合并」写进 `fetch()` → **用缓存重生成时不生效**，重复行照旧 | 后处理放 `main()` 里、渲染之前；这样两条路径都吃到 |

## Step 5 — 什么该做、什么不该做

- **该做**：逐型号数值、可排序的对照表、能改变"要不要投入"判断的字段（耐久 / 惩罚 / 穿深）；
- **不该做**：把「以判断为主」的页（`loot` / `lighting` / `contact-drill` / `starter-checklist`）塞满数字；照抄含义不明的字段（例：头盔的 `ricochetX/Y/Z` **官方未公开含义，留白不猜**）。

> **一句话**：**能核实的写足，核不到的留白。** 详实 ≠ 编数据。
