/* ==========================================================================
   工具箱入口（界面与结构升级）
   --------------------------------------------------------------------------
   要解决的问题：站点的互动能力已经很完整 ——
     · 「我的进度」：任务 / 物品 / 藏身处三轨，按前置反推（972 个交互控件）
     · 「任务图鉴」：515 个任务逐条 + 按条件筛选器
     · 「赛季特质模拟器」：34 张卡的点数市场与互斥校验
     · 「配方速查」：214 条制作 + 855 条交换配方
     · 「术语速查」：全称 / 缩写 / 社区俗称三向可查
   但这些工具此前**只在自己那一页出现** —— 首页只提了其中三个，其余一百多页
   更是没有任何入口。也就是说：工具是有的，但事实上被埋住了。

   本脚本负责四处「用工具」的入口：

     1. **全站工具菜单**（页头，任意页 ≤1 次点击到任一工具） ← 本次升级为下拉菜单
     2. 首页「读 / 用」双轨卡的数字回填（HTML 在 content/README.md 里手写）
     3. 首页「工具箱」区块的数字回填
     4. 任务图鉴工具条（quests/index.md 的 #tk-toolstrip 挂载点）

   三条边界：

     · **数字口径只有一处来源**：直接调 progress.js 暴露的
       window.TarkovProgress.count()（＝当前模式下**手动标过**的已完成数，
       不含推断 —— 与进度页顶栏「已标记 N / 515」同一口径），
       不自己解析 localStorage：两处各读一遍必然漂。API 缺失（脚本被拦截 /
       隐私模式禁用 localStorage）时保留静态文案，不报错、不空白。

     · **工具清单里不写「共 N 条」这类计数**。站点首页的规模数字由
       scripts/gen_home_stats.py 生成、并由 check_entries.py 复算比对，
       是**唯一一处**；在这里再写一遍就会出现第二个会漂的数字源。
       菜单里只描述「这个工具是干什么的」。

     · **不介入其余页面**：只有检测到挂载点或首页元素时才渲染内容；
       页头菜单是唯一全站元素（与面包屑、搜索提示同类）。

   ⚠️ **菜单必须每次换页自动收起。** Material 的 instant 导航在有些情况下
   会**保留页头节点**（不整块替换），于是「在本页展开菜单 → 点链接跳走 →
   新页面菜单还是展开的」。所以 render() 第一件事是 closeMenu()。

   接入方式与站内其他脚本一致：挂 Material 的 document$，instant 换页后
   重新执行；页头节点可能被整块替换，所以每次都重挂、并先查重。
   ========================================================================== */

(function () {
  "use strict";

  var MENU = "tk-toolmenu";
  var FALLBACK_TOTAL = 515;

  /* 工具清单（唯一一份，菜单与页内提示共用）。
     ⚠️ 这里**不写计数** —— 见文件头「三条边界」第二条。
     ⚠️ 这里也**不放图标**。第一版给每个工具配了一个几何符号当标记列，
     在 12px 下它们退化成一排看不出区别的小方块；而站内已经有一张
     「图标语义表」（content/template.md），新增字形要同一批回表登记 ——
     为了一个装饰性标记去走那道流程不划算。工具箱的语义由页头那个 🧰 承担，
     行内只留「粗体名称 + 灰色说明」，反而更好扫。 */
  var TOOLS = [
    { slug: "quests/progress/", name: "我的进度", desc: "任务 · 物品 · 藏身处，按前置反推" },
    { slug: "quests/", name: "任务图鉴", desc: "逐条要求与奖励，可按条件筛选" },
    { slug: "entries/season-modifiers/", name: "赛季特质模拟器", desc: "点选构筑，互斥与点数当场校验" },
    { slug: "docs/recipes/", name: "配方速查", desc: "制作与交换配方查询" },
    { slug: "docs/glossary/", name: "术语与黑话", desc: "全称 / 缩写 / 社区俗称三向查" },
    { slug: "docs/mechanics/", name: "机制速查表", desc: "一页看懂所有核心规则" }
  ];

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
     1. 全站工具菜单（页头）
     -------------------------------------------------------------------------- */

  var menuBtn = null;
  var menuPanel = null;

  function menuIsOpen() {
    return !!(menuPanel && !menuPanel.hidden);
  }

  function closeMenu() {
    if (!menuPanel || menuPanel.hidden) {
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
      return;
    }
    menuPanel.hidden = true;
    if (menuBtn) {
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.classList.remove(MENU + "__btn--open");
    }
  }

  function openMenu() {
    if (!menuPanel) return;
    menuPanel.hidden = false;
    if (menuBtn) {
      menuBtn.setAttribute("aria-expanded", "true");
      menuBtn.classList.add(MENU + "__btn--open");
    }
  }

  /* 只在第一次安装全局监听（instant 换页会重放脚本，不查重就会叠加监听器）。 */
  var listenersInstalled = false;
  function installGlobalListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    document.addEventListener("click", function (e) {
      if (!menuIsOpen()) return;
      var host = document.querySelector("." + MENU);
      if (host && e.target && host.contains(e.target)) return;
      closeMenu();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuIsOpen()) {
        closeMenu();
        if (menuBtn && typeof menuBtn.focus === "function") menuBtn.focus();
      }
    });

    /* 视口变化时收起：窄屏下面板是接近全宽的浮层，转屏后位置会错 */
    window.addEventListener("resize", closeMenu);
  }

  function mountHeader() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner || inner.querySelector("." + MENU)) return;
    if (inner.querySelector(".tk-headtool")) return;   // 旧版节点（换页缓存），不重复挂

    installGlobalListeners();

    var host = document.createElement("div");
    host.className = MENU;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = MENU + "__btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", MENU + "-panel");
    btn.setAttribute("aria-label", "工具箱：我的进度、任务图鉴、模拟器、配方与术语速查");
    btn.title = "工具箱（本地保存，无需登录）";

    var ic = document.createElement("span");
    ic.className = MENU + "__ic";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = "🧰";
    btn.appendChild(ic);

    var tx = document.createElement("span");
    tx.className = MENU + "__tx";
    tx.textContent = "工具箱";
    btn.appendChild(tx);

    var car = document.createElement("span");
    car.className = MENU + "__caret";
    car.setAttribute("aria-hidden", "true");
    car.textContent = "▾";
    btn.appendChild(car);

    host.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = MENU + "__panel";
    panel.id = MENU + "-panel";
    panel.hidden = true;

    var head = document.createElement("div");
    head.className = MENU + "__head";
    var hl = document.createElement("b");
    hl.textContent = "工具箱";
    head.appendChild(hl);
    var hb = document.createElement("span");
    hb.className = MENU + "__badge";
    var st = statText();
    hb.textContent = st || "离线可用 · 无需登录";
    head.appendChild(hb);
    panel.appendChild(head);

    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      var a = document.createElement("a");
      a.className = MENU + "__item";
      a.href = siteRoot() + t.slug;
      var at = document.createElement("span");
      at.className = MENU + "__name";
      at.textContent = t.name;
      a.appendChild(at);
      var ad = document.createElement("span");
      ad.className = MENU + "__desc";
      ad.textContent = t.desc;
      a.appendChild(ad);
      panel.appendChild(a);
    }

    host.appendChild(panel);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menuIsOpen()) closeMenu(); else openMenu();
    });

    /* 插在搜索之前：页头右侧从右往左是 主题切换 / 搜索 / 徽标，
       菜单贴在搜索左边 = 视觉上「行动入口都在这一簇」。 */
    var search = inner.querySelector(".md-search");
    if (search) inner.insertBefore(host, search);
    else inner.appendChild(host);

    menuBtn = btn;
    menuPanel = panel;
  }

  /* --------------------------------------------------------------------------
     2/3. 首页：把进度数字填进 [data-tk-toolstat]
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
     4. 任务图鉴工具条（总览页）
     -------------------------------------------------------------------------- */

  function mountToolstrip() {
    var host = document.getElementById("tk-toolstrip");
    if (!host || host.firstElementChild) return;

    var strip = document.createElement("div");
    strip.className = "tk-toolstrip";

    var ic = document.createElement("span");
    ic.className = "tk-toolstrip__ic";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = "🧰";
    strip.appendChild(ic);

    var tx = document.createElement("span");
    tx.className = "tk-toolstrip__tx";
    var b = document.createElement("b");
    b.textContent = "看任务时顺手记进度：";
    tx.appendChild(b);
    tx.appendChild(document.createTextNode(
      "任务、需求物品与藏身处模块都能勾选，按前置自动反推 —— 进度只存在本机浏览器。"));
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
     5. 按需注入的页面工具（本体都只在各自那一页加载）
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
    /* ⚠️ 先收起菜单：instant 换页有时会保留页头节点，
       不收的话新页面会带着上一页展开的菜单。 */
    closeMenu();
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
