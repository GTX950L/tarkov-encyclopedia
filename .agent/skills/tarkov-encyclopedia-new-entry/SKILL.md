---
name: tarkov-encyclopedia-new-entry
description: 给《逃离塔科夫百科全书》新增一篇条目，并完成它牵动的全部同步动作（nav / 总览页编号 / 两处 README 计数 / tags / CHANGELOG / roadmap / 全站尾行）。触发词：给百科加一篇 / 写新条目 / 补一篇 XX / 新增条目 / 把 roadmap 里的 XX 收录 / new entry。
---

# 新增条目

目标：写出一篇**能通过 `scripts/check_entries.py`、`scripts/check_icons.py` 与 `zensical build`** 的条目，并让它出现在所有该出现的地方。

## 第一步：先读规范，再动手（不要跳过）

按顺序读这四份 —— 它们是这次任务的**硬约束**，不是参考资料：

| 读什么 | 为了拿到什么 |
|--------|-------------|
| `content/template.md` | 条目骨架、固定章节、**页脚三行的写法**（`<br>` 断行） |
| `content/CONTRIBUTING.md` | **体例仲裁规则**：地图条目老图 / 新图两套体例、Boss 节的三种命名判据、口径与标签要求 |
| `content/docs/citation.md` | 三档口径（静态 / 动态 / 社区）与已知未决项 —— 决定这条内容该写成哪一种 |
| `mkdocs.yml` 的 `nav:` | 它进第几篇、插在哪个 slug 后面（**权威顺序源**） |

> **跳读的代价**：体例规则写在贡献指南里、不在模板里。只看模板会写出不合规的章节名，而**校验脚本不检查章节名**，错误会一路到线上。

## 第二步：动笔前先查重（roadmap 的候选名会过时）

```bash
grep -rn "<关键词>" content/ | wc -l          # 零命中或 1–2 命中 = 真空缺
wc -l content/entries/*.md | tail -5          # 100 行以上基本等于已被覆盖
```

候选的归宿有三种，**不要默认新开一篇**：**新开**（独立机制面）／**并入既有条目**（roadmap 自己写了“可在 XX 基础上细化”）／**收敛范围后收录**（坐标与精确数值类，只写判断方法）。

## 第三步：写正文

- 骨架：基本信息表 → 核心机制 → 实战要点 → 常见错误 → 老兵经验 → 相关条目 → 回顶部；
- **页脚三行之间用 `<br>`**（Markdown 普通换行会被渲染成一行）；
- 中文正文用**全角标点**（，：（）），直引号会被校验拦下；
- 数值随版本变动的，写判断方法而不是具体数字；确实要写数字的，标基线并登记进 `roadmap.md` 的版本敏感清单；
- 查不实的内容**不许含糊过去**：登记进 `citation.md` 第三节的未决项表（A 类=两处来源不一致，B 类=只有社区口径）。

## 第四步：同步七处（改一处，一处不落）

| # | 位置 | 动作 |
|---|------|------|
| 1 | `mkdocs.yml` 的 `nav` | 插入到所属篇的**逻辑位置**（不是追加到篇末 —— 按篇内的时间线 / 因果链排序） |
| 2 | `content/entries/index.md` | 插入编号行，**其后所有序号整体 +1** |
| 3 | `content/README.md` | 学习路径图的篇数、阅读顺序表插行并顺延编号 |
| 4 | `README.md`（根） | 简介与结构表里的条目计数 |
| 5 | `content/tags.md` | 用 `python scripts/tag_stats.py` 重算，**不手改**；标签只从既有词表挑 |
| 6 | `content/CHANGELOG.md` | 起一个新版本段，写清本批收录了什么 |
| 7 | 全站尾行 | 每个 `entries/*.md` 末尾的「📖 查看全部 N 个条目」，用一次性脚本批量替换后**删脚本** |

## 第五步：回归（顺序不能反）

```bash
python scripts/build_glossary.py      # ① 术语数据（改了术语表才有变化）
python scripts/check_entries.py       # ② 内容一致性，必须全绿
python scripts/check_icons.py         # ③ 图标语义表对账（新内容里用了表外 emoji 会在这里挂掉）
python scripts/check_promises.py      # ④ 未决项承诺对账（动了 citation.md 第三节或它所指的页面时必跑）
python -m zensical build              # ⑤ 构建，最后一行必须是 No issues found
python scripts/skills_consistency.py  # ⑥ 只在改了 .agent/skills/ 时补跑
```

**六个都过才算完成**。校验查不到 nav 缩进错误、查不到表格列数串列、也查不到整张表不渲染 —— 那些只有真实构建与产物检查能发现。

> ③ 的常见触发：正文里随手打了个 `✓`、`🎨` 之类不在 `content/template.md`「图标语义表」里的符号。**要么换成表内图标，要么同一批回来更新那张表**（表里第 3 档是「不新增」的冻结清单，只收已存在的长尾图标）。

> ④ 的常见触发：**改了 `content/docs/citation.md` 第三节**（新增 / 删除某条未决项），或改了它所指的页面里的限定语。**新增未决项时必须同一批在 `scripts/check_promises.py` 的 `ASSERTIONS` 里补一条断言**（去哪一页、找什么），否则这项检查会直接报「没有断言登记」——**这是故意的**，没有断言就等于没有护栏。

> 改了本手册（或动了它引用的脚本、文件）时补跑 ⑥：它断言手册里提到的每个路径真实存在、每条「CI 门禁」声明与 workflow 实际一致。
