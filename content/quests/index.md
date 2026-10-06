---
tags:
  - 索引
---

# 任务图鉴 (Quest Catalog)

> 版本基线：2026 年 9 月 ｜ 1.1.5.1（第一赛季 KORD BREACH）｜ 数据来源：tarkov.dev（二级）
> 本页数值随版本调整，引用时请附加「以当前版本为准」。

<a id="top"></a>

## 📸 数据口径

| 项目 | 说明 |
|------|------|
| **覆盖范围** | 持久 PvP 档案下的**全部 515 个任务**，逐一列出要求、完成奖励、接取门槛、前置任务、钥匙与失败条件；共 **1441** 条任务目标 |
| **数据来源** | `json.tarkov.dev/regular`（**二级来源**），抓取时间 **2026-09-30** |
| **模式口径** | 全站默认 **持久 PvP**；赛季与 PvE 的差异**未**在本栏目逐条标注 |
| **不收录什么** | ① **坐标与点位数值**——数据里含真实 x/y/z 的字段（目标的 `zones`、找任务物品的 `possibleLocations`）**已在抓取阶段整体剔除**；② 本站自己编写的**走位路线与执行顺序**。本栏目只把官方任务定义里的**结构化字段**译成中文表格（含其自带的方位描述），不写攻略 |
| **怎么用** | ① **知道任务名** → 右上角搜索，**中文名与英文名都能搜**（英文名随每个任务列出，排在商人／等级之后）；② **看某个商人给什么** → 从下方按商人进页；③ **按地图或标记找** → 见下方「速查」一节；另有 **263** 个任务在定义里带地图归属，可用「地图」二字在站内检索 |

---

## 💡 怎么读这些字段

本栏目把数据端点里的**结构化字段**直译成中文。不看字段名会漏掉一半信息，十条最要紧的判读如下：

| 字段 | 含义 | 为什么要看 |
|------|------|-----------|
| **必须战局内找到** | 该物品要求 `foundInRaid` | **最容易踩的坑**——跳蚤市场买的不算数，只能自己带出来 |
| **需要钥匙** | 逐目标或整任务列出 | 没带钥匙等于白跑一趟；有的只在**可选**目标上要求，别为它专门占一个槽位 |
| **时间窗** | 如 22–6 时 | 击杀类目标常限定游戏内时段；**出发前先看钟** |
| **距离 ≥ / ≤** | 击杀距离阈值 | 阈值是**下限**时，打近了不算 |
| **部位** | 头部／胸部等 | 与「击杀」「命中」类目标绑定，只算指定部位 |
| **耐久区间** | 交物品的 `minDurability`／`maxDurability` | **修过的装备可能反而不合格**——区间上限低于 100 时，耐久太满也会被拒 |
| **狗牌等级** | `dogTagLevel` | 上交狗牌的任务按击杀者等级筛选，**低等级狗牌不收** |
| **前置的状态** | `complete`／`active`／`failed` | 前置**不都是「完成」**——数据里有只要求「进行中」的，也有**完成或失败皆可**的，本栏目逐条标出 |
| **接取门槛** | 商人的**忠诚等级**与**声望** | 与前置任务是两回事：前置做完了，忠诚度不够照样接不到。声望门槛可以是**负数** |
| **进度计数** | 形如「**Mechanic** ≥ 3」 | 任务定义里的**商人内部计数器**——全站 **164** 个任务带这一条。端点是每个商人一个计数器、**互不跨商人**（已核对），站内按唯一归属还原成商人名；它记录**在该商人处推进到第几环**，游戏界面不显示这个数字，所以这里**只给端点原值，不代为解释** |

> 📐 **两条边界（与[引用说明第六节](../docs/citation.md) 同口径）**
>
> 1. **不写坐标**。带真实 x/y/z 的字段在抓取阶段整体剔除；保留下来的只有「在哪张图」这一层（**785** 条目标带地图归属）。「在哪张图、哪个区域」照写（那是任务定义的一部分），**坐标数值一个不给**。
> 2. **不写攻略**。「先去哪、按什么顺序做、怎么走位」属作业不属知识，本栏目一概不写——[任务系统](../entries/quests.md) 讲机制与优先级，逐步流程查英文 EFT Wiki 或[中文 Wiki](https://www.eftarkov.com/)。

---

## 📊 全局统计

**515 个任务**的分布如下（口径：`2026-09-30` 抓取，持久 PvP）。

### 按商人

| 商人 | 任务数 | 等级跨度 | 进入 |
|------|--------|----------|------|
| **Mechanic** | 89 | Lv0–45 | [89 条明细](mechanic.md) |
| **Prapor** | 66 | Lv0–46 | [66 条明细](prapor.md) |
| **Skier** | 66 | Lv0–50 | [66 条明细](skier.md) |
| **Jaeger** | 64 | Lv0–55 | [64 条明细](jaeger.md) |
| **Ragman** | 58 | Lv0–42 | [58 条明细](ragman.md) |
| **Therapist** | 52 | Lv0–38 | [52 条明细](therapist.md) |
| **Peacekeeper** | 51 | Lv0–37 | [51 条明细](peacekeeper.md) |
| **Fence** | 16 | Lv0–50 | [16 条明细](fence.md) |
| **Ref（竞技场裁判）** | 20 | Lv10–35 | [20 条明细](ref.md) |
| **BTR 司机** | 19 | Lv0 | [19 条明细](btr-driver.md) |
| **Lightkeeper** | 14 | Lv0–35 | [14 条明细](lightkeeper.md) |
| **合计** | **515** | Lv0–55 | — |

### 按等级门槛

| 等级段 | 任务数 |
|--------|--------|
| Lv0–9 | 324 |
| Lv10–19 | 79 |
| Lv20–29 | 33 |
| Lv30–39 | 37 |
| Lv40–49 | 34 |
| Lv50–59 | 8 |

### 关键标记与条件

| 项 | 任务数 |
|----|--------|
| **Kappa 必需** | 13 |
| **Lightkeeper 必需** | 7 |
| 带**接取门槛**（忠诚度／声望） | 110 |
| 带**进度计数** | 164 |
| **仅限单一阵营**（BEAR 或 USEC） | 12 |
| 需**威望等级** | 3 |
| 定义里带**地图归属** | 263 |
| 含**必须战局内找到**（FiR）的目标 | 349 条目标 |
| 需要钥匙（整任务或任一目标） | 57 |
| 有失败条件 | 38 |

---

<!-- AUTO-GEN:QUEST-EXTRAS:START -->








## 📊 速查：不按商人分的任务线 ｜ 物品需求反查 ｜ 任务速查

> **口径**：2026-09-30 抓取 ｜ 持久 PvP ｜ 来源：二级（tarkov.dev 官方任务数据）

### 按「线」看：几条不跟着商人走的任务线

塔科夫的任务有**两套组织方式**，混起来会漏东西：

- **按发布者**——本栏目分页的依据，11 位发布者各一页（8 位商人 ＋ Fence ＋ 竞技场 Ref ＋ BTR 司机 ＋ Lightkeeper）；
- **按「线」**——同一条线里的任务**散落在好几个商人的页面里**，只看一个人会做一半。**下面这几条就属于这一类。**

| 线 | 任务数 | 分布（按商人） |
|----|--------|----------------|
| **Kappa（收藏家前置）** | **13** | Jaeger 4 / Skier 3 / Ragman 2 / Mechanic 1 / Prapor 1 / Therapist 1 / Fence 1 |
| **Lightkeeper 解锁链** | **7** | Mechanic 7 |
| **竞技场 Ref** | **20** | Ref 20 |
| **BTR 司机** | **19** | BTR 司机 19 |
| **Fence** | **16** | Fence 16 |

> **Kappa 那一行最值得看一眼**：**13 个任务散在 7 个商人下**，其中 Jaeger 名下就有 4 个——**只盯着一个商人做任务，收藏家一定做到一半断掉**。

**剧情章节（主线）：唯一完全不按商人发布的一类。** 章节不是「任务」，是一组任务的集合，**自己的名字在任务数据里根本不存在**，所以本栏目无法按章节分页。当前十章（游览 / 陨落之天 / 车票 ＋ 七章穿插，含「无名者」）与其前置链、四个结局，见[剧情章节与主线任务](../entries/story-chapters.md)。

> ⚠️ **别把「无名者」和「无名者之声」当成一回事**：
> **「无名者」是剧情章节之一**（24 个目标，穿插章）；
> **「无名者之声」（Voice of the Voiceless）不是任务线，是一件特殊设备**——携带它主动击杀 Scav 会扣 Fence 声望，换来服务费减半与高处 AI 不主动开火。见[特殊槽装备与工具](../entries/special-equipment.md) 与[阵营关系与交战规则](../entries/engagement-rules.md)。

### 物品需求反查

把 515 个任务的目标里**真正要上交或放置的物品**按物品聚合，**被 3 个及以上任务需要的物品共 79 种**。只统计 `上交 / 找到 / 放置` 类目标；`卖任何物品给某商人` 那类目标是**许可白名单、不是需求**，已排除。

| 物品 | 需要它的任务数 | 合计数量 | 涉及商人 |
|------|----------------|----------|----------|
| WIFI摄像头 | 9 | 47 | Fence / Mechanic / Skier |
| “凶狠跑刀崽”私酒 | 6 | 33 | BTR 司机 / Skier / Ragman |
| 卢布 | 5 | 4400000 | Mechanic / Skier / Therapist |
| 军用COFDM无线信号发射器 | 5 | 21 | Mechanic / Peacekeeper / Prapor |
| 咸狗牛肉肠 | 5 | 21 | Jaeger / BTR 司机 / Ref |
| LEDX皮肤透照仪 | 5 | 15 | Therapist |
| BEAR 狗牌 | 4 | 575 | Peacekeeper / Prapor / Fence |
| Dan Jackiel瓶装威士忌 | 4 | 46 | Ragman / Skier / Fence |
| Tarkovskaya瓶装伏特加 | 4 | 45 | Ragman / BTR 司机 / Skier |
| SJ6 TGLabs 战斗兴奋剂注射器 | 4 | 43 | Therapist / Mechanic / Skier |
| M.U.L.E. 兴奋剂注射器 | 4 | 40 | Therapist / Peacekeeper / Skier |
| 米屈肼注射器 | 4 | 40 | Therapist / Peacekeeper / Skier |
| SJ9 TGLabs 战斗兴奋剂注射器 | 4 | 39 | Therapist / Mechanic / Skier |
| OLOLO瓶装复合维生素 | 4 | 32 | Therapist |
| 邪教徒之刃 | 4 | 32 | Fence / Lightkeeper / Skier |
| 加密U盘 | 4 | 27 | Skier / Jaeger / Peacekeeper |
| 6B43 屏障-Sh 防弹衣（数码丛林迷彩） | 4 | 23 | Ragman / Jaeger |
| Salewa急救包 | 4 | 22 | Therapist / Jaeger |
| BNTI Gzhel-K（彩瓷-K）防弹衣 | 4 | 21 | Ragman / Jaeger |
| 医用输血工具 | 4 | 20 | Skier / Therapist |
| 肾上腺素注射器 | 4 | 20 | Therapist |
| 检眼镜 | 4 | 16 | Therapist |
| 3-(b-TG) 兴奋剂注射器 | 4 | 12 | Therapist / Peacekeeper |
| AHF1-M 兴奋剂注射器 | 4 | 12 | Therapist / Peacekeeper |
| 金属燃料桶 | 4 | 10 | Peacekeeper / BTR 司机 / Jaeger |
| USEC 狗牌 | 3 | 235 | Prapor / Peacekeeper / Fence |
| 一堆药 | 3 | 48 | Therapist |
| 炖牛肉罐头 | 3 | 45 | Therapist / Jaeger / Ref |
| 显示卡 | 3 | 42 | Mechanic / Prapor / Skier |
| Obdolbos 2 鸡尾酒兴奋剂注射器 | 3 | 38 | Therapist / Skier |
| Propital 再生兴奋剂注射器 | 3 | 38 | Therapist / Skier |
| SJ12 TGLabs 战斗兴奋剂注射器 | 3 | 38 | Therapist / Skier |
| eTG-change 再生兴奋剂注射器 | 3 | 38 | Therapist / Skier |
| BNTI Zhuk（甲虫）防弹衣（数码丛林迷彩） | 3 | 31 | Skier / Jaeger / Ragman |
| Vulkan-5 (火神) LShZ-5 重型防弹头盔 (黑色) | 3 | 31 | Jaeger / Skier / Ragman |
| 呼吸面罩 | 3 | 31 | Skier / Ragman |
| 电线 | 3 | 31 | Mechanic / Prapor |
| MRE个人即食口粮 | 3 | 25 | Peacekeeper / Jaeger / Ref |
| Emelya黑麦面包块 | 3 | 23 | BTR 司机 / Jaeger / Ref |
| SJ1 TGLabs 战斗兴奋剂注射器 | 3 | 23 | Therapist / Mechanic |
| 黑麦面包块 | 3 | 23 | BTR 司机 / Jaeger / Ref |
| FORT Defender-2 防弹衣 | 3 | 22 | Ragman / Jaeger |
| FORT Redut-M（堡垒-M）防弹衣 | 3 | 22 | Ragman / Jaeger |
| 一次性注射器 | 3 | 18 | Therapist |
| Iskra（“火花”）单兵口粮 | 3 | 17 | Jaeger / Ref |
| Trijicon REAP-IR热成像步枪瞄准镜 | 3 | 17 | Mechanic / Skier / Lightkeeper |
| 雷硼嬉皮太阳镜 | 3 | 17 | Ragman |
| AFAK单兵急救包 | 3 | 16 | Jaeger / Therapist |
| AI-2急救组合 | 3 | 16 | Jaeger / Therapist |
| CALOK-B止血剂 | 3 | 16 | Jaeger / Therapist |
| CAT止血带 | 3 | 16 | Jaeger / Therapist |
| CMS手术包 | 3 | 16 | Jaeger / Therapist |
| Esmarch止血带 | 3 | 16 | Jaeger / Therapist |
| Grizzly急救包 | 3 | 16 | Jaeger / Therapist |
| IFAK单兵急救包 | 3 | 16 | Jaeger / Therapist |
| Surv12野战手术包 | 3 | 16 | Jaeger / Therapist |
| Virtex可编程处理器 | 3 | 16 | Peacekeeper / Prapor / Skier |
| 军用绷带 | 3 | 16 | Jaeger / Therapist |
| 印制电路板 | 3 | 16 | Mechanic / Prapor |
| 固定夹板 | 3 | 16 | Jaeger / Therapist |
| 无菌绷带 | 3 | 16 | Jaeger / Therapist |
| 车载急救包 | 3 | 16 | Jaeger / Therapist |
| 铝固定夹板 | 3 | 16 | Jaeger / Therapist |
| 电子元件 | 3 | 15 | Mechanic / Prapor |
| Tigzresq 夹板 | 3 | 14 | Jaeger / Therapist / Fence |
| VOG-25 Khattabka 简易手榴弹 | 3 | 14 | BTR 司机 / Prapor / Peacekeeper |
| 便携式除颤器 | 3 | 14 | Therapist |
| 纯净水 | 3 | 14 | Ragman / Therapist / Ref |
| 电脑CPU | 3 | 13 | Mechanic / Prapor |
| 气体分析仪 | 3 | 11 | Therapist / Mechanic |
| 盐水溶液 | 3 | 11 | Therapist |
| 0.6升瓶装水 | 3 | 10 | Jaeger / Therapist / Ref |
| L1（去甲肾上腺素）注射器 | 3 | 10 | Therapist / Peacekeeper |
| Obdolbos 鸡尾酒兴奋剂注射器 | 3 | 10 | Therapist / Peacekeeper |
| P22 (22 号化合物) 兴奋剂注射器 | 3 | 10 | Therapist / Peacekeeper |
| 5升丙烷罐 | 3 | 9 | Skier / Peacekeeper |
| MS2000指示器 | 3 | 6 | Skier / BTR 司机 |
| 完好的硬盘驱动器 | 3 | 6 | Mechanic / Skier / Peacekeeper |
| 裁判的黑料 | 3 | 6 | Fence / Ref / Lightkeeper |

### 任务速查：几类容易被忽略的条件

> **需要钥匙 / 有失败条件 / Kappa / Lightkeeper 已在上方「关键标记与条件」列出**，这里只补那一段没有的三类。

| 类别 | 数量 | 说明 |
|------|------|------|
| **有接取延迟** | **13** | 接取后要等一段时间才能推进——**先把任务接上，再去做别的**，别白等 |
| **可重接** | **16** | 失败或放弃后还能再接，试错代价比一次性任务低 |

**经验奖励最高的十个任务**（`exp` 字段原值）：

| 经验 | 任务 |
|------|------|
| 433333 | 抉择（Fence） |
| 155000 | 护送（Prapor） |
| 92000 | 实战考验（Ragman） |
| 85500 | 特殊提议（Ragman） |
| 85400 | 独立的代价（BTR 司机） |
| 85400 | 独立的代价（BTR 司机） |
| 65000 | 透透气（Prapor） |
| 65000 | 轻重缓急（Mechanic） |
| 65000 | 识时务者为俊杰（Skier） |
| 65000 | 艺术就是爆炸（Prapor） |

**有接取延迟的任务**（延迟值以分钟计，端点原值）：

| 任务 | 延迟 |
|------|------|
| 灯塔之匙 | 86400 |
| 以牙还牙 | 36000 |
| 大显身手 | 36000 |
| 大都会之谜 | 36000 |
| 失踪的线人 | 36000 |
| 归还人情 | 36000 |
| 抢夺先机 | 36000 |
| 按图索骥 | 36000 |
| 挑衅 | 36000 |
| 观察员 | 36000 |
| 网络供应商 - 2 | 32400 |
| 感官分析 - 1 | 2100 |
| 情报之源 | 5 |

### 奖励反查：哪些任务会「给」它

> 与上面的**需求反查**正好互补——那个回答「我要攒什么」，这个回答「**这东西哪来的**」；同样只列**被 3 个及以上任务作为奖励给出**的物品。

| 物品 | 由几个任务给出 | 合计数量 |
|------|----------------|----------|
| 卢布 | 284 | 64464300 |
| 欧元 | 57 | 74250 |
| 美元 | 51 | 90850 |
| GP币 | 20 | 1059 |
| 军用闪存装置 | 5 | 11 |
| Virtex可编程处理器 | 5 | 8 |
| 弹药箱 | 5 | 6 |
| 军用电源滤波器 | 5 | 5 |
| 一堆药 | 4 | 11 |
| 7.62x51mm M80 弹药包（20发装） | 4 | 9 |
| Shustrilo发泡密封胶 | 4 | 8 |
| 波纹软管 | 4 | 8 |
| 12/70 箭形弹 弹药包（25发装） | 4 | 6 |
| Walker's XCEL 500BT 数字耳机 | 4 | 5 |
| 技术指导文件 | 4 | 4 |
| 7.62x54mm R 7N1 弹药包（20发装） | 3 | 11 |
| Tarkovskaya瓶装伏特加 | 3 | 10 |
| CPU风扇 | 3 | 9 |
| 节能灯泡 | 3 | 9 |
| Propital 再生兴奋剂注射器 | 3 | 8 |
| 实体比特币 | 3 | 8 |
| Surv12野战手术包 | 3 | 6 |
| “凶狠跑刀崽”私酒 | 3 | 6 |
| 一包螺钉 | 3 | 6 |
| 电线 | 3 | 6 |
| 相位控制继电器 | 3 | 6 |
| 金属零件 | 3 | 6 |
| 铝固定夹板 | 3 | 6 |
| .338 Lapua Magnum FMJ弹药包（20发装） | 3 | 5 |
| MSA Sordin Supreme PRO-X/L有源耳机 | 3 | 3 |
| Theta 安全箱 | 3 | 3 |
| 一套工具 | 3 | 3 |
| 传奇奖章 | 3 | 3 |
| 微控制器电路板 | 3 | 3 |
| 武器箱 | 3 | 3 |
| 电动马达 | 3 | 3 |

<!-- AUTO-GEN:QUEST-EXTRAS:END -->

---

## 🧭 相关页面

- [商人任务线图鉴](../entries/trader-questlines.md) —— **按商人看分布、等级跨度、长链与忠诚度门槛**，并给出 Kappa 的完整前置树；本栏目是它的**逐任务明细层**
- [任务系统](../entries/quests.md) —— 任务的**机制**（奖励怎么发、FiR 怎么算、失败与放弃的区别）
- [剧情章节与主线任务](../entries/story-chapters.md) —— 主线章节与四个结局
- [地图对照速查](../docs/map-guide.md) —— 各图与任务密度的对照

> 📖 **想了解每个任务的执行顺序？** 本栏目只给**定义**。逐步流程见英文 EFT Wiki —— 每个任务在数据里都有对应链接，本栏目未逐条列出，以免与官方更新不同步。

---

⬆️ **[回到顶部](#top)**

---

**最后更新**: 2026年9月<br>
**贡献者**: GTX950L<br>
**License**: CC BY-NC-SA 4.0
