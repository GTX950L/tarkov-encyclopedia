# 逃离塔科夫百科全书

<a id="top"></a>

> “这是一个没有 HUD、没有教学、没有第二次机会的世界。”
> —— 塔科夫，诺文斯克地区的封锁区

《逃离塔科夫》（Escape from Tarkov）是 Battlestate Games 开发的硬核战术撤离射击游戏。这个百科的目标是：**把“死得莫名其妙”变成“死得明白”**——每一篇条目都解释一个系统“是什么、为什么、怎么用”。

> 💡 本站**全文不使用配图**，弱网环境可流畅阅读。所有数值描述以“机制原理”为主，具体数值随版本变动，请以游戏内为准。

---

## 🧭 推荐学习路径

```mermaid
flowchart LR
    A[第一篇<br/>入门机制<br/>6 篇] --> B[第二篇<br/>地图<br/>13 篇]
    B --> C[第三篇<br/>装备与枪械<br/>10 篇]
    C --> D[第四篇<br/>经济与成长<br/>17 篇]
    D --> E[第五篇<br/>进阶战斗机制<br/>11 篇]
    E --> F[第六篇<br/>赛季与衍生<br/>5 篇]
    F --> G[第七篇<br/>场景与转场<br/>2 篇]
    G --> H[第八篇<br/>世界规则<br/>3 篇]

    A -. 先懂撤离与保险<br/>才敢进图 .-> B
    B -. 知道死在哪<br/>才懂该练什么 .-> C
    C -. 看懂穿深与护甲<br/>才明白为什么死 .-> D
    D -. 有装备有任务<br/>才谈得上进阶 .-> E
    E -. 想换规则重来<br/>才用得上赛季 .-> F
    F -. 想一局连打多张图<br/>才用得上转场 .-> G
    G -. 最后补上天气与光照<br/>才算看懂战场 .-> H

    style A fill:#e3f2fd,stroke:#1565c0
    style B fill:#e8f5e9,stroke:#2e7d32
    style C fill:#fff3e0,stroke:#ef6c00
    style D fill:#fce4ec,stroke:#c62828
    style E fill:#ede7f6,stroke:#4527a0
    style F fill:#e0f7fa,stroke:#00838f
    style G fill:#f3e5f5,stroke:#6a1b9a
    style H fill:#e0f2f1,stroke:#00695c
```

路径图只是建议。已经在玩的玩家可以直接跳到对应条目查漏补缺——**兴趣驱动的跳跃式阅读也是常见的打开方式**。

---

## 📚 推荐阅读顺序

### 第一篇：入门机制（先搞懂规则，再谈枪法）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 1 | [撤离机制](entries/extraction.md) | 塔科夫唯一的胜利条件——搜刮再多，没撤离就等于零 |
| 2 | [生命与身体部位系统](entries/health.md) | 理解“为什么突然黑屏”——七部位血量与状态异常是生存的底层逻辑 |
| 3 | [保险机制](entries/insurance.md) | 新手最容易被忽略的“后悔药”，决定了你敢带什么进图（赛季中可能被禁用） |
| 4 | [背包与容器系统](entries/inventory.md) | 安全箱与背包管理，是收益差距的第一来源 |
| 5 | [安全箱与容器](entries/containers.md) | 五个安全箱型号的尺寸与获取路径，以及专用容器怎么扩仓库 |
| 6 | [PMC 与 Scav](entries/pmc-scav.md) | 弄清两条命、两套规则，Scav 是新手的免费练习券 |

### 第二篇：地图（按体量从小到大）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 7 | [工厂](entries/factory.md) | 最小最乱的 CQB 图，练近战的课堂 |
| 8 | [海关](entries/customs.md) | 经典中的经典，任务最密集的中型图 |
| 9 | [森林](entries/woods.md) | 大型开阔图，狙击与听声辨位的考场 |
| 10 | [海岸线](entries/shoreline.md) | 疗养院垂直攻防与远距离交火并存 |
| 11 | [立交桥](entries/interchange.md) | 全室内商城，光线昏暗、背身刺杀频发 |
| 12 | [储备站](entries/reserve.md) | 军事基地与地下掩体，高价值任务枢纽 |
| 13 | [实验室](entries/labs.md) | 无 Scav、全 PMC 的顶级风险区 |
| 14 | [地面零点](entries/ground-zero.md) | 面向低等级玩家的市区图，任务起点 |
| 15 | [灯塔](entries/lighthouse.md) | 重做后的海岸军事图，Lightkeeper 线起点 |
| 16 | [街区](entries/streets.md) | 全游戏最大的城市图，双 Boss 与地雷区 |
| 17 | [终点站](entries/terminal.md) | 1.0 主线压轴，剧情向的终局场景 |
| 18 | [破冰船](entries/icebreaker.md) | 全 PvE 终局场景，辐射与黑师 |
| 19 | [迷宫](entries/labyrinth.md) | 不在选图列表里的解谜型场景，保险不生效 |

### 第三篇：装备与枪械（看懂数值，才知道为什么死）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 20 | [弹药与穿深等级](entries/ammo.md) | **塔科夫第一真理：子弹比枪重要** |
| 21 | [弹药选型速查表](entries/ammo-table.md) | 按对手的护甲等级反推今天带哪盒弹 |
| 22 | [弹道与穿透机制](entries/ballistics.md) | 穿深、护甲伤害、有效性衰减的底层规则 |
| 23 | [护甲与头盔](entries/armor.md) | 护甲等级、材质与耐久，护住哪里才划算 |
| 24 | [护甲与头盔图鉴](entries/armor-catalog.md) | 载体 + 软质层 + 插板的三层结构与代表型号 |
| 25 | [护甲修复与耐久](entries/armor-repair.md) | 上限只降不升：什么时候该修、什么时候该换 |
| 26 | [医疗物资](entries/medical.md) | 止血、复位、手术包的取舍与携带逻辑 |
| 27 | [枪械改装](entries/gunsmith.md) | 人机工效、后坐力、精度的改装三角 |
| 28 | [枪械图鉴](entries/weapons.md) | 按口径与枪型选主武器，先弹后枪 |
| 29 | [钥匙与钥匙房](entries/keys.md) | 消耗品属性与房间价值的换算 |

### 第四篇：经济与成长（把每一条命变成资产）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 30 | [商人系统](entries/traders.md) | 八位商人各有分工，声望就是购买力（1.1 起售价整体上调） |
| 31 | [以物换物](entries/barter.md) | 物品换物品：怎么把配方材料折算成钱再决定值不值 |
| 32 | [跳蚤市场](entries/flea-market.md) | 玩家经济的中枢，变现与捡漏的主战场 |
| 33 | [跳蚤定价与手续费](entries/flea-pricing.md) | 费率公式、底价反推与定价算法 |
| 34 | [邮件与领取](entries/mail.md) | 保险返还、货款与奖励的取件柜——会过期 |
| 35 | [藏身处](entries/hideout.md) | 离线收益与被动技能，穷人的复利 |
| 36 | [藏身处模块详解](entries/hideout-modules.md) | 二十余个模块的功能与建造优先级 |
| 37 | [任务系统](entries/quests.md) | 1.1 后改为忠诚度解锁，Kappa 门槛同步降低 |
| 38 | [商人任务线图鉴](entries/trader-questlines.md) | 八条任务线的特征、代表任务与回报 |
| 39 | [剧情章节与主线任务](entries/story-chapters.md) | Tour / Falling Skies / The Ticket：主线分叉与四个结局 |
| 40 | [经济周期](entries/economic-cycle.md) | 一个赛季内价格的四阶段规律与应对 |
| 41 | [战利品分布与热点](entries/loot.md) | 按区域类型判断收益，用“每格价值”做取舍 |
| 42 | [声望与 Karma](entries/karma.md) | 逐项加减分与声望影响的全部面向 |
| 43 | [技能系统](entries/skills.md) | 用行为练出来的被动加成，隐形战力差 |
| 44 | [武器掌握](entries/weapon-mastery.md) | 命中换来的换弹动作升级，L3 可瞄具内换弹 |
| 45 | [成就系统](entries/achievements.md) | 任务之外的长期目标，以及“绝版”的含义 |
| 46 | [Prestige 转生](entries/prestige.md) | 自愿把角色打回 1 级，换永久奖励——不可逆 |

### 第五篇：进阶战斗机制（同一套装备，不同的结局）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 47 | [耐力与移速](entries/stamina.md) | 负重与机动性的定价，决定你能不能跑掉 |
| 48 | [姿态、移动与射击](entries/movement.md) | 站蹲卧的取舍、慢走如何关掉地形噪音、侧身怎么用 |
| 49 | [手雷与投掷物](entries/grenades.md) | 逼位与封路，最便宜的重武器 |
| 50 | [夜视与热成像](entries/night-vision.md) | 夜间视野的军备竞赛与反制 |
| 51 | [听声辨位与音频机制](entries/audio.md) | 耳机决定的信息差，先听见的人先开枪 |
| 52 | [组队与协作](entries/squads.md) | 没有 HUD 标识的小队规则与友伤代价 |
| 53 | [敌我识别与身份判断](entries/iff.md) | 没有名字标签、也没有队友点位时，怎么判断对面是谁 |
| 54 | [AI 行为逻辑](entries/ai-behavior.md) | 感知三环节、0.16.1.3 侦测重做与声响诱导 |
| 55 | [Scav 互动与叛徒判定](entries/scav-relations.md) | 一枪作废的中立协议与声望后果 |
| 56 | [Boss 图鉴](entries/bosses.md) | 首领对照、护卫编队与刷新概率的两层结构 |
| 57 | [战斗复盘与常见死因](entries/death-review.md) | 用结算界面上的五个数字，找出自己重复犯的那个错误 |

### 第六篇：赛季与衍生内容（1.1 之后的新规则）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 58 | [赛季与修改器](entries/seasons.md) | 三种档案（持久 / 赛季 / PvE）与赛季规则 |
| 59 | [赛季修改器逐项](entries/season-modifiers.md) | 全局 6 项 + 33 张个人卡的点数市场 |
| 60 | [联赛系统](entries/leagues.md) | 每周 50 人的经验值天梯 |
| 61 | [竞技场](entries/arena.md) | 独立进度的纯对抗模式 |
| 62 | [PvE 模式](entries/pve.md) | 没有真人对手、永不 wipe 的持久档案 |

### 第七篇：场景与转场（把一局打成一条线）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 63 | [转场与 BTR](entries/transit.md) | 不结束战局也能换图，经验倍率与物流通道 |
| 64 | [撤离点详解](entries/extraction-points.md) | 条件型撤离点速查：钥匙、信号弹、合作、付费 |

### 第八篇：世界规则（最后补上环境这一层）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 65 | [天气与时间系统](entries/weather.md) | 七倍速时钟、进图两个档位与天气的双向作用 |
| 66 | [光照与夜战](entries/lighting.md) | 光源是双刃剑：照亮与被照亮只差一秒 |
| 67 | [彩蛋与制作组的恶意](entries/easter-eggs.md) | 制作组藏在图里的玩笑，以及那些“设计好的死亡”——雷区、阔剑、不生效的保险 |

---

## 📖 使用须知

1. **数值随版本变动**：塔科夫更新频繁，本站侧重机制原理与决策思路，具体数值以游戏内与官方公告为准。
2. **版本基线**：全站内容以 **2026 年 9 月 / 1.1.5.1 第一赛季（KORD BREACH）** 的公开信息为基准；赛季修改器会改写部分规则，涉及赛季的机制请先看[重大版本更新史](docs/version-history.md)。
3. **条目内互链**：每篇末尾有“相关条目”，可按主题串联阅读。
4. **搜索优先**：站点支持全文搜索（右上角放大镜），术语中英对照都已覆盖。

## 📁 其他资源

- [机制速查表](docs/mechanics.md) — 一页看懂所有核心规则
- [地图对照速查](docs/map-guide.md) — 逐图对照：打什么、产什么、有什么坑、什么时候来
- [术语与黑话速查](docs/glossary.md) — 新手第一站：把攻略里的黑话翻译成人话
- [购买指南（地区与版本）](docs/buying-guide.md) — 还没入手？先看清版本、渠道与地区定价
- [配置与性能](docs/performance.md) — 官方配置要求、真实的性能瓶颈与值得动的设置
- [新手成长路线](docs/progression.md) — 1 级到满级该干什么
- [重大版本更新史](docs/version-history.md) — 2016 至今的版本变迁、作用与玩家反馈
- [待收录清单](docs/roadmap.md) — 下一批条目的规划
- [标签分类](tags.md) — 29 个标签的词表与覆盖范围
- [条目模板](template.md) — 想贡献新条目从这里开始

---

📖 [查看全部 67 个条目](entries/index.md)

⬆️ **[回到顶部](#top)**

**最后更新**: 2026年9月
**贡献者**: GTX950L
**License**: MIT
