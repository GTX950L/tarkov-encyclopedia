---
title: 作战台
---

# 🗺️ 作战台

<div id="tk-ops">

<div class="tk-ops__grid">

<!-- ── 左栏 ──────────────────────────────────────────────── -->
<aside class="tk-ops__col tk-ops__col--left" id="tk-ops-left">

</aside>

<!-- ── 中栏：地图 ────────────────────────────────────────── -->
<section class="tk-ops__col tk-ops__col--mid">
  <div class="tk-ops__briefbar" id="tk-ops-briefbar"></div>
  <div id="tk-map" data-map="customs" data-mode="pve" data-tk-hover-tip="1">
    <p>地图加载中…（这一段不会一直留着）</p>
  </div>
  <div class="tk-ops__tasklist" id="tk-ops-tasks"></div>
</section>

<!-- ── 右栏 ──────────────────────────────────────────────── -->
<aside class="tk-ops__col tk-ops__col--right" id="tk-ops-right">

</aside>

</div>

<p class="tk-ops__keys">
  <b>键盘</b>：<code>/</code> 聚焦搜索 · <code>↑</code><code>↓</code> 选行 ·
  <code>Enter</code> 定位 · <code>1</code><code>2</code><code>3</code> 切模式 ·
  <code>Esc</code> 清选中 / 清搜索 · 鼠标悬停区域即出小提示，点开才是完整卡
  <button class="tk-ops__helpbtn" type="button" data-tk-help>这一页在做什么</button>
</p>

<details class="tk-ops__note" id="tk-ops-help" hidden>
  <summary>这一页在做什么 / 不做什么</summary>
  <p><b>做</b>：选一张图 → 右栏自动变成这张图上的活 → 勾目标 → 在图上定位 → 攒进出击清单。
  进度与<a href="../quests/progress/">我的进度</a>是同一份本机账本，勾完立刻同步。</p>
  <p><b>三个手势</b>：<b>单击</b>任务 = 在图上定位；<b>双击</b> = 加入 / 移出出击清单（详情卡里也有按钮）；
  <b>搜索框一有词</b>就自动跨图（清空即回本图）—— 所以没有「仅本图 / 全站」那两个开关。</p>
  <p><b>低频的都不在主界面</b>：筛选的「进行中 / 钉住 / 已忽略」在「更多」里；
  地图的缩放 / 测距 / 全屏在「视图」里；出击清单的复制 / 清空在「⋯」里；
  日志同步挪到了页面最底下。</p>
  <p><b>「可接」怎么算</b>：只看两件事 —— <b>你的等级</b>（右栏填，只存本机、不上传）
  和<b>「必须完成」类前置</b>是否都做完了。商人声望、藏身处等级这些上游也有字段，
  但口径碎、随版本变，这一页<b>不算</b>，也不假装算了。</p>
  <p><b>前置链</b>：详情卡里的前置与后续可以直接点 —— 跨图会自动换图，不用回左栏找。</p>
  <p><b>不做</b>：BOSS 刷新率、Scav 计时、撤离点实时开放状态 —— 游戏内随机的数据，
  我们没有可靠来源，不编。</p>
  <p><b>模式</b>：PvE 剧情 / 赛季 PvP / 持久 PvP。赛季与 PvP 共用任务库
  （上游没有独立的赛季端点），只在进度上分轨。</p>
  <p><b>电脑端优先</b>：悬停即读、键盘流、可拖拽分栏。窄屏会折叠成单栏，
  但功能不缺，只是没铺得开。</p>
</details>

</div>

---

<div class="tk-ops__noscript">
  <p><b>作战台需要 JavaScript</b> —— 它要在同一屏里同时放下地图、任务与进度，
  没有脚本就没法做到「零跳转」。</p>
  <p>不跑脚本也有替代路径：</p>
  <ul>
    <li><a href="../maps/">交互地图</a> —— 每张图的点位、撤离点、图层与静态任务表</li>
    <li><a href="../quests/">任务图鉴</a> —— 503 个任务的逐条要求、奖励与<strong>精确坐标</strong></li>
    <li><a href="../quests/progress/">我的进度</a> —— 进度账本与出发前准备清单</li>
    <li><a href="../quests/item-lookup/">物品反查</a> —— 手上这个要不要留</li>
  </ul>
</div>

<!-- 作战台脚本不在本页内联注入：由 extra_javascript 里的 mount-loader.js
     检测到 #tk-ops 后按需注入（理由与踩过的坑写在 mkdocs.yml 与 mount-loader.js 头部）。 -->
