# 逃离塔科夫百科全书

<a id="top"></a>

> “这是一个没有 HUD、没有教学、没有第二次机会的世界。”
> —— 塔科夫，诺文斯克地区的封锁区

《逃离塔科夫》（Escape from Tarkov）是 Battlestate Games 开发的硬核战术撤离射击游戏。这个百科的目标是：**把“死得莫名其妙”变成“死得明白”**——每一篇条目都解释一个系统“是什么、为什么、怎么用”。目前已收录 **86 个**条目，分十篇组织：**前八篇**是“从零上手”的主线，**第九篇 · [任务图鉴](quests/index.md)** 把 **515 个任务**的要求、奖励与接取门槛逐条列全，**第十篇 · [参考](docs/index.md)** 收齐速查表与站务工具页。

> 💡 本站**全文不使用配图**，弱网环境可流畅阅读。所有数值描述以“机制原理”为主，具体数值随版本变动，请以游戏内为准。

> ⓘ **本站是非官方粉丝资料站**：由爱好者独立维护，**与 Battlestate Games 没有隶属、合作或背书关系**；「Escape from Tarkov」「逃离塔科夫」及相关名称、标志与游戏内容的**商标权与著作权归 Battlestate Games 及其关联方所有**。本站**不使用任何游戏美术资源**，文字内容以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 授权。详见[数据口径与引用说明](docs/citation.md)。

---

## 🧭 推荐学习路径

<div class="tk-path">
<a class="tk-step tk-s1" href="entries/spawn-and-opening.md"><b>第一篇</b><em>入门机制</em><i>12 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s2" href="entries/ground-zero.md"><b>第二篇</b><em>地图</em><i>14 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s3" href="entries/ammo.md"><b>第三篇</b><em>装备与枪械</em><i>14 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s4" href="entries/traders.md"><b>第四篇</b><em>经济与成长</em><i>18 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s5" href="entries/stamina.md"><b>第五篇</b><em>进阶战斗机制</em><i>13 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s6" href="entries/raid-flow.md"><b>第六篇</b><em>战局内行为手册</em><i>6 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s7" href="entries/seasons.md"><b>第七篇</b><em>赛季与衍生内容</em><i>5 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s8" href="entries/weather.md"><b>第八篇</b><em>世界与背景</em><i>4 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s9" href="quests/index.md"><b>第九篇</b><em>任务图鉴</em><i>12 篇</i></a>
<span class="tk-arrow">→</span>
<a class="tk-step tk-s10" href="docs/index.md"><b>第十篇</b><em>参考</em><i>16 篇</i></a>
</div>

<div class="tk-reason">
<b>为什么这样排</b>
<p>先懂撤离与保险，才敢进图 → 知道死在哪，才懂该练什么 → 看懂穿深与护甲，才明白为什么死 → 把每一条命变成资产，才有本钱练 → 同一套装备为什么打出不同结局，想通这个才谈得上进阶 → 机制吃透了，再把知识变成动作 → 会玩了、想换规则重来，才用得上赛季 → 最后补上设定与环境，才算看懂战场。</p>
<p>前八篇是这条顺序；<b>第九 · 第十篇不在其中</b>——它们是随查随用的栏目（卡任务翻第九篇，查速查表与站务页翻第十篇），所以那两张卡用中性色，不参与“从入门到终局”的难度梯度。</p>
</div>

路径图只是建议。已经在玩的玩家可以直接跳到对应条目查漏补缺——**兴趣驱动的跳跃式阅读也是常见的打开方式**。

---

## 📋 任务图鉴（第九篇：随查随用）

[**任务图鉴**](quests/index.md) 排在“从零上手”的主线之后，不属于前八篇那条学习顺序：它把持久 PvP 档案下的 **515 个任务**（共 **1441** 条目标）逐条列出**要求、完成奖励、接取门槛、前置任务、需要钥匙与失败条件**——数据取自官方任务定义的**结构化字段**（要求、奖励、门槛等），**不含坐标，也不写逐步攻略**。卡在某个任务上时从那里查。

按商人分页（每页按等级门槛升序）：[Mechanic](quests/mechanic.md) · [Prapor](quests/prapor.md) · [Skier](quests/skier.md) · [Jaeger](quests/jaeger.md) · [Ragman](quests/ragman.md) · [Therapist](quests/therapist.md) · [Peacekeeper](quests/peacekeeper.md) · [Fence](quests/fence.md) · [Ref（竞技场裁判）](quests/ref.md) · [BTR 司机](quests/btr-driver.md) · [Lightkeeper](quests/lightkeeper.md)

> 想按等级或关键标记筛任务，从[任务图鉴总览](quests/index.md)进——那里有按等级门槛、按地图归属、按 Kappa／Lightkeeper 的分布统计。

---

## 📚 推荐阅读顺序

### 第一篇：入门机制（先搞懂规则，再谈枪法）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 1 | [开局与出生点](entries/spawn-and-opening.md) | 从出生点开始就把两条撤离线连起来 |
| 2 | [撤离机制](entries/extraction.md) | 塔科夫唯一的胜利条件——搜刮再多，没撤离就等于零 |
| 3 | [撤离点详解](entries/extraction-points.md) | 条件型撤离点速查：钥匙、信号弹、合作、付费 |
| 4 | [生命与身体部位系统](entries/health.md) | 理解“为什么突然黑屏”——七部位血量与状态异常是生存的底层逻辑 |
| 5 | [食物与水分](entries/food-and-water.md) | 两条隐形资源里，先见底的一定是水 |
| 6 | [食物与饮料图鉴](entries/food-catalog.md) | 先认清“能量高但扣水”的那几样，再谈带什么 |
| 7 | [医疗物资](entries/medical.md) | 先认功能再挑型号——伤情处置的取舍逻辑 |
| 8 | [医疗物资图鉴](entries/medical-catalog.md) | 单次治疗量比总容量重要：胸腔治不满就是一枪死 |
| 9 | [保险机制](entries/insurance.md) | 新手最容易被忽略的“后悔药”，决定了你敢带什么进图（赛季中可能被禁用） |
| 10 | [背包与容器系统](entries/inventory.md) | 安全箱与背包管理，是收益差距的第一来源 |
| 11 | [安全箱与容器](entries/containers.md) | 六个安全箱型号的尺寸与获取路径，以及专用容器怎么扩仓库 |
| 12 | [PMC 与 Scav](entries/pmc-scav.md) | 弄清两条命、两套规则，Scav 是新手的免费练习券 |

### 第二篇：地图（按推荐阶段分四组：新手 → 常规 → 进阶 → 终局）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 13 | [地面零点](entries/ground-zero.md) | 面向低等级玩家的市区图，任务起点 |
| 14 | [工厂](entries/factory.md) | 最小最乱的 CQB 图，练近战的课堂 |
| 15 | [海关](entries/customs.md) | 经典中的经典，开局任务最集中的中型图 |
| 16 | [森林](entries/woods.md) | 大型开阔图，狙击与听声辨位的考场 |
| 17 | [立交桥](entries/interchange.md) | 全室内商城，光线昏暗、背身刺杀频发 |
| 18 | [储备站](entries/reserve.md) | 军事基地与地下掩体，高价值任务枢纽 |
| 19 | [海岸线](entries/shoreline.md) | 疗养院垂直攻防与远距离交火并存 |
| 20 | [灯塔](entries/lighthouse.md) | 重做后的海岸军事图，Lightkeeper 线起点 |
| 21 | [街区](entries/streets.md) | 全游戏最大的城市图，双 Boss 与地雷区 |
| 22 | [实验室](entries/labs.md) | 无 Scav、全 PMC 的顶级风险区 |
| 23 | [终点站](entries/terminal.md) | 1.0 主线压轴，剧情向的终局场景 |
| 24 | [破冰船](entries/icebreaker.md) | 全 PvE 终局场景，辐射与黑师 |
| 25 | [迷宫](entries/labyrinth.md) | 不在选图列表里的解谜型场景，保险不生效 |
| 26 | [转场与 BTR](entries/transit.md) | 不结束战局也能换图，经验倍率与物流通道 |

### 第三篇：装备与枪械（看懂数值，才知道为什么死）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 27 | [弹药与穿深等级](entries/ammo.md) | **塔科夫第一真理：子弹比枪重要** |
| 28 | [弹药选型速查表](entries/ammo-table.md) | 按对手的护甲等级反推今天带哪盒弹 |
| 29 | [弹道与穿透机制](entries/ballistics.md) | 穿深、护甲伤害、有效性衰减的底层规则 |
| 30 | [护甲与头盔](entries/armor.md) | 护甲等级、材质与耐久，护住哪里才划算 |
| 31 | [护甲与头盔图鉴](entries/armor-catalog.md) | 载体 + 软质层 + 插板的三层结构与代表型号 |
| 32 | [护甲修复与耐久](entries/armor-repair.md) | 上限只降不升：什么时候该修、什么时候该换 |
| 33 | [载具图鉴：背包与胸挂](entries/loadout-carriers.md) | 先定这一局带什么，再挑装得下它的最小载具——格数、布局、重量、叠加 |
| 34 | [耳机与听力装备](entries/headsets.md) | 每局都用的装备决策：0.16.5.0 起各款只剩音色差异，选完就别频繁换 |
| 35 | [武器故障与耐久维护](entries/weapon-maintenance.md) | 卡壳不是运气，是耐久与过热的账 |
| 36 | [枪械改装](entries/gunsmith.md) | 人机工效、后坐力、精度的改装三角 |
| 37 | [枪械图鉴](entries/weapons.md) | 按口径与枪型选主武器，先弹后枪 |
| 38 | [特殊槽装备与工具](entries/special-equipment.md) | 三个格子的真正价值：放进去就不掉，一次投入永久可用 |
| 39 | [服装与外观](entries/clothing.md) | 不挡子弹，但影响别人的第一次判断 |
| 40 | [钥匙与钥匙房](entries/keys.md) | 消耗品属性与房间价值的换算 |

### 第四篇：经济与成长（把每一条命变成资产）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 41 | [商人系统](entries/traders.md) | 八位商人各有分工，声望就是购买力（1.1 起售价整体上调） |
| 42 | [以物换物](entries/barter.md) | 物品换物品：怎么把配方材料折算成钱再决定值不值 |
| 43 | [跳蚤市场](entries/flea-market.md) | 玩家经济的中枢，变现与捡漏的主战场 |
| 44 | [跳蚤定价与手续费](entries/flea-pricing.md) | 费率公式、底价反推与定价算法 |
| 45 | [邮件与领取](entries/mail.md) | 保险返还、货款与奖励的取件柜——会过期 |
| 46 | [藏身处](entries/hideout.md) | 离线收益与被动技能，穷人的复利 |
| 47 | [藏身处模块详解](entries/hideout-modules.md) | 二十余个模块的功能与建造优先级 |
| 48 | [任务系统](entries/quests.md) | 1.1 后改为忠诚度解锁，Kappa 门槛同步降低 |
| 49 | [商人任务线图鉴](entries/trader-questlines.md) | 八条任务线的特征、代表任务与回报 |
| 50 | [剧情章节与主线任务](entries/story-chapters.md) | Tour / Falling Skies / The Ticket：主线分叉与四个结局 |
| 51 | [经济周期](entries/economic-cycle.md) | 一个赛季内价格的四阶段规律与应对 |
| 52 | [战利品分布与热点](entries/loot.md) | 按区域类型判断收益，用“每格价值”做取舍 |
| 53 | [声望与 Karma](entries/karma.md) | 逐项加减分与声望影响的全部面向 |
| 54 | [等级与经验体系](entries/levels.md) | 等级是钥匙不是属性——先搞懂“升级到底解锁了什么” |
| 55 | [技能系统](entries/skills.md) | 用行为练出来的被动加成，隐形战力差 |
| 56 | [武器掌握](entries/weapon-mastery.md) | 命中换来的换弹动作升级，L3 可瞄具内换弹 |
| 57 | [成就系统](entries/achievements.md) | 任务之外的长期目标，以及“绝版”的含义 |
| 58 | [Prestige 转生](entries/prestige.md) | 自愿把角色打回 1 级，换永久奖励——不可逆 |

### 第五篇：进阶战斗机制（同一套装备，不同的结局）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 59 | [耐力与移速](entries/stamina.md) | 负重与机动性的定价，决定你能不能跑掉 |
| 60 | [姿态、移动与射击](entries/movement.md) | 站蹲卧的取舍、慢走如何关掉地形噪音、侧身怎么用 |
| 61 | [手雷与投掷物](entries/grenades.md) | 逼位与封路，最便宜的重武器 |
| 62 | [夜视与热成像](entries/night-vision.md) | 夜间视野的军备竞赛与反制 |
| 63 | [听声辨位与音频机制](entries/audio.md) | 耳机决定的信息差，先听见的人先开枪 |
| 64 | [组队与协作](entries/squads.md) | 没有 HUD 标识的小队规则与友伤代价 |
| 65 | [敌我识别与身份判断](entries/iff.md) | 没有名字标签、也没有队友点位时，怎么判断对面是谁 |
| 66 | [阵营关系与交战规则](entries/engagement-rules.md) | 每一枪分别记在哪本账上 |
| 67 | [AI 行为逻辑](entries/ai-behavior.md) | 感知三环节、0.16.1.3 侦测重做与声响诱导 |
| 68 | [Scav 互动与叛徒判定](entries/scav-relations.md) | 一枪作废的中立协议与声望后果 |
| 69 | [Scav 指挥与随从系统](entries/scav-command.md) | 声望换来的指挥权：六个指令与随从 |
| 70 | [Boss 图鉴](entries/bosses.md) | 首领对照、护卫编队与刷新概率的两层结构 |
| 71 | [战斗复盘与常见死因](entries/death-review.md) | 用结算界面上的五个数字，找出自己重复犯的那个错误 |
### 第六篇：战局内行为手册（把机制变成动作）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 72 | [战局流程与节奏](entries/raid-flow.md) | 先拿到全局：四段结构、搜刮动线、什么时候必须撤 |
| 73 | [搜刮效率与战利品取舍](entries/looting.md) | 到了地方之后，怎么在最短的暴露时间里拿完 |
| 74 | [遇敌处置与接战决策](entries/contact-drill.md) | 遇到人的前 3 秒：打、躲，还是走 |
| 75 | [交火中的技术动作](entries/firefight.md) | 打起来之后手上怎么做：探头、掩体、换弹、切副武器、进房 |
| 76 | [投掷物来袭处置](entries/grenade-response.md) | 拔销声能骗人、也能被趁虚而入；引信决定你躲不躲得掉 |
| 77 | [战中伤情处置](entries/combat-medical.md) | 受伤之后先做什么——顺序错了，等于没治 |

### 第七篇：赛季与衍生内容（1.1 之后的新规则）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 78 | [赛季与修改器](entries/seasons.md) | 三种档案（持久 / 赛季 / PvE）与赛季规则 |
| 79 | [赛季修改器逐项](entries/season-modifiers.md) | 全局 6 项 + 33 张个人卡的点数市场 |
| 80 | [联赛系统](entries/leagues.md) | 每周 50 人的经验值天梯 |
| 81 | [竞技场](entries/arena.md) | 独立进度的纯对抗模式 |
| 82 | [PvE 模式](entries/pve.md) | 没有真人对手、永不 wipe 的持久档案 |

### 第八篇：世界与背景（环境、元内容与设定三条线索）

| 顺序 | 条目 | 为什么这样排 |
|------|------|-------------|
| 83 | [天气与时间系统](entries/weather.md) | 七倍速时钟、进图两个档位与天气的双向作用 |
| 84 | [光照与夜战](entries/lighting.md) | 光源是双刃剑：照亮与被照亮只差一秒 |
| 85 | [彩蛋与制作组的恶意](entries/easter-eggs.md) | 制作组藏在图里的玩笑，以及那些“设计好的死亡”——雷区、阔剑、不生效的保险 |
| 86 | [世界观与阵营背景](entries/worldview.md) | 诺文斯克为什么被封锁、USEC 与 BEAR 从哪来——解释“你为什么出不去” |

> 第九 · 第十篇没有“先后”——任务图鉴与参考是查阅型栏目：卡任务翻[任务图鉴](quests/index.md)，查数值口径、速查表与站务页翻下方「📁 其他资源」。

---

## 📖 使用须知

1. **数值随版本变动**：塔科夫更新频繁，本站侧重机制原理与决策思路，具体数值以游戏内与官方公告为准。
2. **版本基线**：全站内容以 **2026 年 9 月 / 1.1.5.1 第一赛季（KORD BREACH）** 的公开信息为基准；赛季修改器会改写部分规则，涉及赛季的机制请先看[重大版本更新史](docs/version-history.md)。
3. **条目内互链**：每篇末尾有“相关条目”，可按主题串联阅读。
4. **搜索优先**：站点支持全文搜索（右上角放大镜）。全文索引体积较大，**首次打开后需要几秒建立索引**——未就绪时点按钮会提示“正在建立索引”，稍等再点即可；术语中英对照都已覆盖。
5. **浏览器建议**：全文搜索依赖浏览器的中文分词能力，建议使用较新的 Chrome / Edge / Safari，Firefox 需 125 及以上；更旧的浏览器上中文搜索会退化为整句匹配。

## 📁 其他资源

- [任务图鉴](quests/index.md) — **515 个任务**逐条列出要求、奖励、接取门槛与前置（不含坐标与攻略），卡任务时从这里查
- [新手成长路线](docs/progression.md) — 1 级到满级该干什么，每阶段都有可验证的毕业标准
- [机制速查表](docs/mechanics.md) — 一页看懂所有核心规则
- [地图对照速查](docs/map-guide.md) — 逐图对照：打什么、产什么、有什么坑、什么时候来
- [术语与黑话速查](docs/glossary.md) — 新手第一站：把攻略里的黑话翻译成人话
- [购买指南（地区与版本）](docs/buying-guide.md) — 还没入手？先看清版本、渠道与地区定价
- [配置与性能](docs/performance.md) — 官方配置要求、真实的性能瓶颈与值得动的设置
- [操作与设置](docs/game-settings.md) — 灵敏度、键位、音频与画质里哪些真的影响战斗
- [重大版本更新史](docs/version-history.md) — 2016 至今的版本变迁、作用与玩家反馈
- [待收录清单](docs/roadmap.md) — 下一批条目的规划
- [数据口径与引用说明](docs/citation.md) — **引用或转载本站前先读**：三档口径、已知未决项、来源分级
- [标签分类](tags.md) — 29 个标签的词表与覆盖范围
- [条目模板](template.md) — 想贡献新条目从这里开始

## 🤖 引用本站与交给 AI

本站的「引用协议」由两份文件承担，**缺一份都不完整**：

- [**数据口径与引用说明**](docs/citation.md) —— 说明哪一部分可以直接引用、哪一部分必须附加限定语、哪些事项属于未决项；
- [**llms.txt**](llms.txt) —— 面向 AI 智能体的入口索引，给出全站结构与版本基线。

> 引**机制与原理** → 可直接引；引**具体数值** → 必须写「截至 1.1.5.1（2026 年 9 月），以当前版本为准」；引**社区口径** → 写成「社区口径认为…」。
>
> **交给 AI 之前，把这两份一起给它**：只给链接不给口径，AI 会把动态数值当成静态事实引用。

转载、翻译与改编请遵守 [CC BY-NC-SA 4.0](https://github.com/GTX950L/tarkov-encyclopedia/blob/main/LICENSE)：须注明作者与出处、不得用于商业目的、新作品须以相同协议分发。

---

📖 [查看全部 86 个条目](entries/index.md)

📋 [进入任务图鉴：515 个任务的逐条要求与奖励](quests/index.md)

⬆️ **[回到顶部](#top)**

**最后更新**: 2026年9月<br>
**贡献者**: GTX950L<br>
**License**: CC BY-NC-SA 4.0
