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
  <div id="tk-map" data-map="customs" data-mode="pve" data-tk-hover-tip="1">
    <p>地图加载中…（这一段不会一直留着）</p>
  </div>
</section>

<!-- ── 右栏 ──────────────────────────────────────────────── -->
<aside class="tk-ops__col tk-ops__col--right" id="tk-ops-right">

</aside>

</div>

<p class="tk-ops__keys">
  <b>键盘</b>：<code>/</code> 聚焦搜索 · <code>↑</code><code>↓</code> 选行 ·
  <code>1</code><code>2</code><code>3</code> 切模式 · <code>Esc</code> 清筛选 ·
  <code>?</code> 快捷键 · 鼠标悬停区域即出小提示，点开才是完整卡
</p>

<details class="tk-ops__note" id="tk-ops-help" hidden>
  <summary>这一页在做什么 / 不做什么</summary>
  <p><b>做</b>：选一张图 → 右栏自动变成这张图上的活 → 勾目标 → 在图上定位 → 攒进出击清单。
  进度与<a href="../quests/progress/">我的进度</a>是同一份本机账本，勾完立刻同步。</p>
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
    <li><a href="../quests/">任务图鉴</a> —— 504 个任务的逐条要求、奖励与<strong>精确坐标</strong></li>
    <li><a href="../quests/progress/">我的进度</a> —— 进度账本与出击清单</li>
    <li><a href="../quests/item-lookup/">物品反查</a> —— 手上这个要不要留</li>
  </ul>
</div>

<script>
/* 作战台脚本按需注入（2026-10-18）。
   为什么不用 extra_javascript：ops-board.js ≈ 48 KB / gzip 16 KB，而全场只有本页需要它。
   为什么从别的 script 标签反推地址：本站部署在 /tarkov-encyclopedia/ 子路径下，
   写死相对路径在「多深目录 + 子路径」两种变化下都会错（ops-board.js 自己的 siteRoot()
   也是这么反推的，见该文件 :79-88）。取任意一份站内 javascripts/ 的 src 改写文件名即可；
   注意要排掉主题自带的 assets/javascripts/bundle.*.min.js（它也含 "/javascripts/"）。
   注入时若 DOM 已解析完（本脚本在页尾，通常如此），ops-board.js 会直接 boot。 */
(function () {
  var ref = null;
  var list = document.querySelectorAll("script[src]");
  for (var i = 0; i < list.length; i++) {
    var u = list[i].getAttribute("src") || "";
    if (u.indexOf("assets/") < 0 && /javascripts\/[^/]+\.js$/.test(u)) { ref = list[i]; break; }
  }
  if (!ref) return;
  var s = document.createElement("script");
  s.src = ref.src.replace(/[^/]+$/, "ops-board.js");
  s.async = false;
  document.head.appendChild(s);
})();
</script>
