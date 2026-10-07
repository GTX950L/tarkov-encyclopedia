/* ==========================================================================
   工具箱入口（界面与结构升级 · 第一批）
   --------------------------------------------------------------------------
   要解决的问题：站点的互动能力（「我的进度」：515 任务 / 79 物品 / 26 藏身处
   模块）已经很完整，但这些工具此前**只在自己那一页出现** —— 首页完全没有
   提及，其余一百多页也没有入口，读者要靠侧栏展开「查阅栏目 → 第九篇」才
   找得到。工具是有的，但事实上被埋住了。本脚本补上两处入口：

     1. **全站页头入口** —— 每一页右上角一个「🧰 我的进度」，一次点击直达；
        （首页的双轨入口区是手写 HTML，本脚本只负责把进度数字填进去）
     2. **任务图鉴工具条** —— quests/index.md 首屏的 #tk-toolstrip 挂载点。

   三条边界：

     · **数字口径只有一处来源**：直接调 progress.js 暴露的
       window.TarkovProgress.count()（＝当前模式下**手动标过**的已完成数，
       不含推断 —— 与进度页顶栏「已标记 N / 515」同一口径），
       不自己解析 localStorage：两处各读一遍必然漂。API 缺失（脚本被拦截 /
       隐私模式禁用 localStorage）时保留静态文案，不报错、不空白。

     · **不介入其余页面**：只有检测到挂载点或首页元素时才渲染内容；
       页头入口是唯一全站元素（与面包屑、搜索提示同类）。

     · **本脚本不做交互**：入口只负责跳转，记录行为仍然发生在「我的进度」页
       与任务页上 —— 那两处的 UI 归 progress.js / progress-boards.js 管。

   接入方式与站内其他脚本一致：挂 Material 的 document$，instant 换页后
   重新执行；页头节点会被整块替换，所以每次都重挂、并先查重。
   ========================================================================== */

(function () {
  "use strict";

  var HDR = "tk-headtool";
  var FALLBACK_TOTAL = 515;

  function siteRoot() {
    var s = document.querySelector('script[src*="toolbox.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function boardUrl() { return siteRoot() + "quests/progress/"; }

  /* 进度摘要；API 或数据缺失时返回空串（调用方保留静态文案）。 */
  function statText() {
    var api = window.TarkovProgress;
    if (!api || typeof api.count !== "function") return "";
    var done;
    try { done = api.count(); } catch (e) { return ""; }
    if (!done) return "";
    var total = FALLBACK_TOTAL;
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    if (mf && mf.total) total = mf.total;
    return "已记录 " + done + " / " + total + " 个任务";
  }

  /* --------------------------------------------------------------------------
     1. 全站页头入口
     -------------------------------------------------------------------------- */

  function mountHeader() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner || inner.querySelector("." + HDR)) return;

    var a = document.createElement("a");
    a.className = HDR;
    a.href = boardUrl();
    a.setAttribute("aria-label", "我的进度：任务、物品与藏身处记录（本地保存，无需登录）");
    a.title = "我的进度：任务 / 物品 / 藏身处（本地保存，无需登录）";

    var ic = document.createElement("span");
    ic.className = HDR + "__ic";
    ic.textContent = "🧰";
    a.appendChild(ic);

    var tx = document.createElement("span");
    tx.className = HDR + "__tx";
    tx.textContent = "我的进度";
    a.appendChild(tx);

    /* 插在搜索之前：页头右侧从右往左是 主题切换 / 搜索 / 徽标，
       入口贴在搜索左边 = 视觉上「行动入口都在这一簇」。 */
    var search = inner.querySelector(".md-search");
    if (search) inner.insertBefore(a, search);
    else inner.appendChild(a);
  }

  /* --------------------------------------------------------------------------
     2. 首页双轨卡：把进度数字填进 [data-tk-toolstat]
        （无数据时保留 HTML 里的静态文案，不替换成「已记录 0」——
          对第一次来的人，「任务 · 物品 · 藏身处」说明这卡是干什么的，
          「已记录 0」什么都不说明。）
     -------------------------------------------------------------------------- */

  function fillHome() {
    var hosts = document.querySelectorAll("[data-tk-toolstat]");
    if (!hosts.length) return;
    var s = statText();
    if (!s) return;
    for (var i = 0; i < hosts.length; i++) hosts[i].textContent = s;
  }

  /* --------------------------------------------------------------------------
     3. 任务图鉴工具条（总览页）
     -------------------------------------------------------------------------- */

  function mountToolstrip() {
    var host = document.getElementById("tk-toolstrip");
    if (!host || host.firstElementChild) return;

    var strip = document.createElement("div");
    strip.className = "tk-toolstrip";

    var ic = document.createElement("span");
    ic.className = "tk-toolstrip__ic";
    ic.textContent = "🧰";

    var tx = document.createElement("span");
    tx.className = "tk-toolstrip__tx";
    var b = document.createElement("b");
    b.textContent = "看任务时顺手记进度：";
    tx.appendChild(b);
    tx.appendChild(document.createTextNode(
      "515 个任务、79 种物品、26 个藏身处模块 —— 勾选后按前置自动反推，进度只存在本机浏览器。"));

    strip.appendChild(ic);
    strip.appendChild(tx);

    var s = statText();
    if (s) {
      var stat = document.createElement("span");
      stat.className = "tk-toolstrip__stat";
      stat.textContent = s;
      strip.appendChild(stat);
    }

    var cta = document.createElement("a");
    cta.className = "tk-toolstrip__cta";
    cta.href = boardUrl();
    cta.textContent = "打开我的进度";
    strip.appendChild(cta);

    host.appendChild(strip);
  }

  /* --------------------------------------------------------------------------
     4. 按需注入的页面工具（本体都只在各自那一页加载）
        本文件是全站加载的入口脚本，所以这里只做「发现挂载点 → 注入本体」：
          · 赛季特质模拟器（season-modifiers 页）
          · 配方速查表（docs/recipes 页）
          · 任务筛选器（quests/index 页）
        instant 换页回到这些页面时，本体脚本已在内，它们自己的 document$
        订阅会负责重新挂载。

         ⚠️ **每个工具一个独立的注入标记**。用同一个标记管两个工具，第二个
         就永远不会被注入（一个全局变量只能表示「已注入过一次」）。
     -------------------------------------------------------------------------- */

  function injectScript(file) {
    var url = siteRoot() + "javascripts/" + file;
    if (!url || url.indexOf("javascripts/") === 0) return;
    var sc = document.createElement("script");
    sc.src = url;
    document.head.appendChild(sc);
  }

  var plannerInjected = false;
  var recipesInjected = false;
  var filterInjected = false;

  function loadPageTools() {
    if (!plannerInjected && document.getElementById("tk-season-planner")) {
      plannerInjected = true;
      injectScript("season-planner.js");
    }
    if (!recipesInjected && document.getElementById("tk-recipe-browser")) {
      recipesInjected = true;
      injectScript("recipe-browser.js");
    }
    if (!filterInjected && document.getElementById("tk-quest-filter")) {
      filterInjected = true;
      injectScript("quests-filter.js");
    }
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  function render() {
    mountHeader();
    fillHome();
    mountToolstrip();
    loadPageTools();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else {
    document.addEventListener("DOMContentLoaded", render);
  }
})();
