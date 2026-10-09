# 逃离塔科夫百科全书 (Escape from Tarkov Encyclopedia)

## 📖 项目简介

系统性介绍《逃离塔科夫》（Escape from Tarkov）地图、机制、装备与经济系统的中文开源项目。目前已收录 **87 个**条目，分十一篇：**前八篇**是主线——入门机制、地图、装备与枪械、经济与成长、进阶战斗机制、战局内行为手册、赛季与衍生内容、世界与背景；**后三篇**是查阅型栏目（第九篇 · 物品图鉴、第十篇 · 任务图鉴、第十一篇 · 参考）。内容覆盖全部常用地图、弹药护甲枪械、商人任务与藏身处、Boss 图鉴与护卫编队、AI 行为逻辑、赛季修改器、敌我识别、阵营交战规则，以及一个战局从进图到撤离、再到交火中每一个动作的全流程。

另有**第十篇 · [任务图鉴](content/quests/index.md)**（查阅型栏目）：持久 PvP 档案下**全部 515 个任务**的逐条要求、完成奖励、接取门槛、前置任务、需要钥匙与失败条件（共 1441 条目标，不含坐标与攻略）。按商人分 11 页，另有总览、我的进度、物品反查与**单件任务详情视图页**。

## 🚀 快速访问

项目使用 **Zensical** 构建（兼容 MkDocs Material 配置），在线站点：

👉 **https://GTX950L.github.io/tarkov-encyclopedia/**

> 本项目**不使用任何配图**——全部信息以文字与表格呈现，弱网环境也可流畅阅读。

> 🗓️ **版本基线**：2026 年 10 月 / 1.2.0.0（第一赛季 KORD BREACH）。版本变迁、作用与玩家反馈见[重大版本更新史](content/docs/version-history.md)。

## 📂 仓库结构

| 目录/文件 | 说明 |
|------|------|
| `content/` | 站点内容目录（MkDocs docs_dir） |
| `content/entries/` | 百科条目页（共 87 篇，构成前八篇） |
| `content/catalog/` | 物品图鉴页（4,979 件物品，分 17 页，第九篇）＋ 单件物品详情视图页 |
| `content/quests/` | **第十篇 · 任务图鉴**（查阅型栏目：总览 + 11 位商人分页 + 我的进度 + 物品反查 + **单件任务详情视图页**，515 个任务） |
| `content/docs/` | **第十一篇**的主要载体：补充资料（机制速查、成长路线、**重大版本更新史**、待收录清单） |
| `content/README.md` | 项目首页（站点首页源文件） |
| `content/{tags,template,CHANGELOG,CONTRIBUTING}.md` | 标签分类、条目模板、更新日志、贡献指南 |
| `mkdocs.yml` | 站点配置（Material 主题 + 自定义样式） |
| `stylesheets/extra.css` | 自定义样式（窄屏表格滚动、打印友好） |
| `scripts/check_entries.py` | 一致性校验（只读，不改文件） |
| `.github/workflows/` | CI/CD 工作流（自动部署到 Pages + 条目校验） |

## 🧭 推荐学习路径

项目按**最适合上手塔科夫**的顺序排列：先建立机制认知（撤离 / 生命 / 保险），再学地图，然后深入装备数值与经济成长循环，接着吃透战斗机制、把它变成战局里的动作，最后补上赛季分支与世界观设定。**第十 · 第十一篇（任务图鉴 / 参考）是随查随用的栏目，不在这条顺序里**。详见[在线站点](https://GTX950L.github.io/tarkov-encyclopedia/)首页的推荐阅读顺序。

## 📎 参考区（第十一篇）

- [任务图鉴](content/quests/index.md) — 515 个任务的逐条要求、奖励、接取门槛与前置（**第十篇** · 查阅型栏目）
- [数据口径与引用说明](content/docs/citation.md) — **引用本站前先读**：三档口径、已知未决项、来源分级
- [机制速查表](content/docs/mechanics.md) — 一页看懂所有核心规则
- [术语与黑话速查](content/docs/glossary.md) — 全称、缩写与社区俗称双向可查
- [新手成长路线](content/docs/progression.md) — 分阶段的成长目标
- [地图对照速查](content/docs/map-guide.md) — 逐图的交战风格、资源类型、风险与适合阶段
- [重大版本更新史](content/docs/version-history.md) — 2016 至今的重大更新、作用与玩家反馈
- [待收录清单](content/docs/roadmap.md) — 下一批条目规划

## 🤖 给 AI 智能体

- **入口索引**：[llms.txt](content/llms.txt) — 面向 AI 的全站结构、版本基线与引用口径摘要
- **引用口径**：[数据口径与引用说明](content/docs/citation.md) — 哪一部分可直接引、哪一部分必须挂限定语
- **维护工作流**：[.agent/skills/](.agent/skills/) — 写新条目与内容巡检的可执行规范

> 只给 `llms.txt` 不给口径页，AI 会把动态数值当成静态事实引用——**两份一起给**。

## 🤝 如何贡献

欢迎提交 Issue 和 Pull Request。详见 [CONTRIBUTING.md](content/CONTRIBUTING.md)。

## 📜 许可证

本项目**文字内容**采用 **[CC BY-NC-SA 4.0](https://github.com/GTX950L/tarkov-encyclopedia/blob/main/LICENSE)**（署名—非商业性使用—相同方式共享 4.0 国际）发布：

- **署名** —— 转载、翻译、改编须注明作者与出处，并保留协议声明；
- **非商业性使用** —— 不得用于商业目的（含搬运到带广告的站点、付费内容）；
- **相同方式共享** —— 基于本作品创作的新作品，须以相同协议分发。

游戏《逃离塔科夫》的名称、商标、游戏内文本与数据归 Battlestate Games 所有，不在本协议授权范围内。

---

**维护者**: [GTX950L](https://github.com/GTX950L)<br>
**最后更新**: 2026年9月
