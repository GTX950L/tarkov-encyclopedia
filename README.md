# 逃离塔科夫百科全书 (Escape from Tarkov Encyclopedia)

## 📖 项目简介

系统性介绍《逃离塔科夫》（Escape from Tarkov）地图、机制、装备与经济系统的中文开源项目。目前已收录 **22 个**条目，涵盖入门机制、全部常用地图、弹药护甲枪械、商人任务与藏身处。

## 🚀 快速访问

项目使用 **Zensical** 构建（兼容 MkDocs Material 配置），在线站点：

👉 **https://GTX950L.github.io/tarkov-encyclopedia/**

> 本项目**不使用任何配图**——全部信息以文字与表格呈现，弱网环境也可流畅阅读。

> 🗓️ **版本基线**：2026 年 9 月 / 1.1.5.1（第一赛季 KORD BREACH）。版本变迁、作用与玩家反馈见[重大版本更新史](content/docs/version-history.md)。

## 📂 仓库结构

| 目录/文件 | 说明 |
|------|------|
| `content/` | 站点内容目录（MkDocs docs_dir） |
| `content/entries/` | 百科条目页（共 22 篇） |
| `content/docs/` | 补充资料（机制速查、成长路线、**重大版本更新史**、待收录清单） |
| `content/README.md` | 项目首页（站点首页源文件） |
| `content/{tags,template,CHANGELOG,CONTRIBUTING}.md` | 标签分类、条目模板、更新日志、贡献指南 |
| `mkdocs.yml` | 站点配置（Material 主题 + 自定义样式） |
| `stylesheets/extra.css` | 自定义样式（窄屏表格滚动、打印友好） |
| `scripts/check_entries.py` | 一致性校验（只读，不改文件） |
| `.github/workflows/` | CI/CD 工作流（自动部署到 Pages + 条目校验） |

## 🧭 推荐学习路径

项目按**最适合上手塔科夫**的顺序排列：先建立机制认知（撤离/生命/保险），再学地图，然后深入装备数值，最后理解经济与成长循环。详见[在线站点](https://GTX950L.github.io/tarkov-encyclopedia/)首页的推荐阅读顺序。

## 📎 参考区

- [机制速查表](content/docs/mechanics.md) — 一页看懂所有核心规则
- [新手成长路线](content/docs/progression.md) — 分阶段的成长目标
- [重大版本更新史](content/docs/version-history.md) — 2016 至今的重大更新、作用与玩家反馈
- [待收录清单](content/docs/roadmap.md) — 下一批条目规划

## 🤝 如何贡献

欢迎提交 Issue 和 Pull Request。详见 [CONTRIBUTING.md](content/CONTRIBUTING.md)。

## 📜 许可证

[MIT License](https://github.com/GTX950L/tarkov-encyclopedia/blob/main/LICENSE)

---

**维护者**: [GTX950L](https://github.com/GTX950L)
**最后更新**: 2026年9月
