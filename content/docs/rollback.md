---
description: "数据回滚流程：站内的数据是快照式覆盖：scripts/data/*.json 存的是「当前这一份」， 每次重抓直接盖掉旧的，不像数据库…"  # 自动生成
tags:
  - 索引
---

# 数据回滚流程

> 版本基线：2026 年 10 月 ｜ 1.2.0.0（第一赛季 KORD BREACH）
> 本页写给维护者：数据抓错了、生成器改坏了，怎么退回去且**确认真的退干净了**。

## 为什么需要写下来

站内的数据是**快照式覆盖**：`scripts/data/*.json` 存的是「当前这一份」，
每次重抓直接盖掉旧的，不像数据库那样有历史表。误抓一次，旧值就没了 ——
只能靠 git 把文件还原，再重跑生成器把页面/分片重新派生。

审查（2026-11-03）指出的问题正是：**这套知识只存在脑子里**。
没有文档时，出事的处理顺序靠回忆，容易漏掉「还原数据但忘了重跑生成器」——
那种状态最危险：数据是新的、页面是旧的，**而门禁全绿**。

## 一、先分清三类文件

| 类别 | 位置 | 能不能手改 |
|---|---|---|
| **抓取快照** | `scripts/data/*.json`（`quests.json` / `items_full.json` / `maps_site.json` / `recipes.json` …） | 一般**不手改**。它们是上游数据的落盘，改了就与来源不一致。回滚时用 git 还原 |
| **生成物** | `content/**/*.md`（生成页）、`content/javascripts/*.js`、`scripts/data/*.json` 里的派生表 | **绝不手改**。改了下次重跑就被覆盖，且 `check_gen_drift` 会报漂移 |
| **人工内容** | `content/entries/*.md`、`content/docs/*.md`、`content/lore/*.md`、`overrides/`、`mkdocs.yml`、`scripts/gen_*.py` | 手改，改完跑 `build_all` |

判据：**看文件头有没有「由 scripts/xxx.py 生成 —— 勿手改」。**

## 二、回滚一次抓取错误

### 1. 确认范围

先看这次改动碰了哪些文件：

```bash
git status --short
git diff --stat
```

只还原**抓取快照**，别用 `git checkout .` 一把梭 —— 那会连你手改的条目一起丢掉。

### 2. 还原数据

```bash
git checkout -- scripts/data/quests.json          # 或 HEAD~1 的那个版本
# 需要更早的版本时：
git show <commit>:scripts/data/quests.json > scripts/data/quests.json
```

⚠️ **`git checkout -- <file>` 会丢掉该文件未提交的改动。** 用之前先确认工作区里
那份改动是不是你要保留的（2026-10-14 差点因此丢掉坐标旋转公式）。

### 3. 重跑生成器

数据换了，所有从它派生的页面与分片都必须重算。**一条命令全跑**：

```bash
python scripts/build_all.py
```

它会按依赖顺序跑完 ① 生成器链、②–⑤f 门禁、⑥ 真实构建。**不要只跑其中一支** ——
`quests.json` 至少牵动 `gen_quests` / `gen_quest_items` / `gen_quest_insights` /
`gen_progress_manifest` / `gen_ops_index`（两个模式）/ `gen_quest_tree` 六支。

### 4. 验证退干净了

```bash
git status --short          # 应该只剩你**故意**改的文件
python scripts/check_gen_drift.py    # 生成物与源一致（零漂移）
```

再看一眼页面数字对不对。数据类问题至少抽三处：首页速览的任务/物品总数、
任务图鉴总览的条数、图鉴分类件的合计。

### 5. 记录

在 `content/CHANGELOG.md` 当版记一条：**哪次抓取、错在哪、怎么发现的、怎么退的**。
只写「修复数据」等于没记 —— 下次同样的问题还会发生。

## 三、回滚一次生成器改动

生成器改坏了（产物错、或对账不过），两条路：

1. **回退代码**：`git checkout -- scripts/gen_xxx.py`，再跑 `build_all`；
2. **回退产物**：`git checkout -- content/xxx.md`，再跑 `build_all`。
   ⚠️ 只回退产物不回退生成器，下次重跑又变回坏的。

**判断该退哪个**：看 `check_gen_drift` 报的方向 —— 它说「跑完了会改成 X」，
说明**生成器**认为 X 才对；如果 X 是错的，退生成器。

## 四、站点整体回退（部署出问题）

GitHub Pages 从 `main` 自动部署，回退 = 回退提交：

```bash
git revert <bad-commit>       # 生成一个反向提交，历史保留
python scripts/build_all.py   # 确认全绿
git push origin main          # 走 PR 流程（main 是保护分支）
```

**不要** `git reset --hard` 后强推：历史被改写，`check_gen_drift` 与
「谁改的」都失去依据。

## 五、三种「看起来好了」但其实没好

| 现象 | 真相 |
|---|---|
| `build_all` 全绿 | 只证明内容自洽，**不证明数据正确**。抓来的错数据一样能过所有门禁 |
| 页面数字没变 | 可能你看的是缓存的旧页；也可能是生成器压根没读到新数据（检查生成器输出的行数） |
| `git status` 干净 | 只说明与 HEAD 一致，不说明 HEAD 是对的 |

## 相关页面

- [数据口径与引用说明](citation.md) — 数值的来源分级
- [游戏数值变更台账](value-changes.md) — 数值变了要记在这里
- [更新日志](../CHANGELOG.md) — 每版改了什么
