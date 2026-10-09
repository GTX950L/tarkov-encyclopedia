/* ========================================================================== 
   物品图鉴：站内检索 + 多维筛选 + 详情面板
   --------------------------------------------------------------------------
   定位：**增强，不是前提**。

     · 各分类页的表格由 scripts/gen_items_catalog.py 在**构建期**生成，
       零 JS 也能读全 —— 这是全站「弱网可读」定位的延续。
     · 本脚本做的事只有一件：在表格之上加一层「找得到」。
       5,476 件物品、86 个分类，靠翻页找东西不现实。

   为什么数据是「按需注入」而不是进 extra_javascript
   ----------------------------------------------------
   catalog-data.js 未压缩 0.74 MB、gzip 后约 226 KB。全站 130+ 页每页背
   这个包是纯浪费，而它只在 /catalog/ 下的 16 页用到一次。由 toolbox.js
   检测挂载点后注入。

   三条边界
   --------
     1. **不介入其余页面**：只认 #tk-catalog（分类页）与 #tk-catalog-all
        （总览页）两个挂载点，没有就不渲染任何东西。
     2. **数据缺失时保留降级文案**，不报错、不空白 —— 生成物没被构建时
        （见 content/CONTRIBUTING.md「构建顺序」）页面仍是完整静态表格。
     3. **不自己解析 DOM 拿数据**：数据只从 window.TARKOV_CATALOG 读。
        两处各读一遍必然漂。

   ⚠️ 挂载要注册两个入口（subscribe + 立即执行一次）。由 toolbox.js 注入的
   脚本可能晚于 document$ 首次发出，只写 subscribe 会永远收不到首次事件。
   ========================================================================== */

(function () {
  "use strict";

  var PAGE_LIMIT = 120;      /* 一次最多渲染多少行 —— 1,518 件的配件页不切页没法用 */
  var state = { q: "", kind: "", sort: "weight" };
  var page = 1;

  function siteRoot() {
    var s = document.querySelector('script[src*="toolbox.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  /* ---------------------------------------------------------------- 数据 */

  function data() { return window.TARKOV_CATALOG || null; }
  function slugOfPage() {
    /* 挂载点上由生成器写了 data-slug（classify 页）或 data-all（总览页） */
    var host = document.getElementById("tk-catalog");
    if (host && host.dataset && host.dataset.slug) return host.dataset.slug;
    return null;
  }

  function rowsFor(d, slug) {
    var out = [];
    if (slug && d.chunks && d.chunks[slug]) {
      out = d.chunks[slug];
    } else {
      /* 总览页：把全部分块拼起来 */
      for (var k in d.chunks) {
        if (Object.prototype.hasOwnProperty.call(d.chunks, k)) {
          out = out.concat(d.chunks[k]);
        }
      }
    }
    return out;
  }

  function parseNum(s) {
    if (s === "—" || s === "" || s == null) return null;
    var m = String(s).replace(/,/g, "").match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function fmtNum(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* 单格价值 = 商人最高回收 ÷ 占地格数（r[8]，生成器写死 = 宽 × 高）。

     ⚠️ 口径是**商人回收价**，不是跳蚤价 —— 站内不联网、不收实时价（同 recipes.md 的口径节）。
        所以本榜回答的是「卖给商人时，哪种东西单位空间最值钱」，不是「跳蚤能卖多少」。
     ⚠️ 表格列 / 排序 / 详情面板 / 榜单**都走这一个函数**，别各算一遍 —— 四处各写一遍迟早漂。
     ⚠️ 缺回收价或缺格数 → 返回 null（**算不出就不排，不用默认值去凑**：
        按 1 格硬算会把无价物品排到最前，那比不排更误导）。 */
  function slotValue(r) {
    var p = parseNum(r[6]);
    if (p == null) return null;
    var s = (typeof r[8] === "number" && r[8] > 0) ? r[8] : null;
    if (s == null) return null;
    return p / s;
  }

  function hay(r) {
    /* 一次建好检索索引，不要每次输入都重算 */
    if (r._h) return r._h;
    r._h = (r[1] + " " + r[2]).toLowerCase();
    return r._h;
  }

  /* ---------------------------------------------------------------- 过滤 */

  function apply(d) {
    var slug = slugOfPage();
    var rows = rowsFor(d, slug);
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (q && hay(r).indexOf(q) === -1) return false;
      /* 「未分类」用哨兵值挑 types[0] 为空的物品；其余按 type 精确匹配。
         两者分开写，别合并成一句 —— "__none__" 不是真实 type，合并会一起落空。 */
      if (state.kind === "__none__") { if (r[7]) return false; }
      else if (state.kind && r[7] !== state.kind) return false;
      return true;
    });
    out.sort(function (a, b) {
      if (state.sort === "name") return a[1].localeCompare(b[1], "zh");
      if (state.sort === "price") {
        var pb = parseNum(b[6]), pa = parseNum(a[6]);
        return (pb == null ? -1 : pb) - (pa == null ? -1 : pa);
      }
      if (state.sort === "slot") {
        /* 缺失值（无回收价 / 无格数）排最后：降序时用 -1 垫底 */
        var sb = slotValue(b), sa = slotValue(a);
        return (sb == null ? -1 : sb) - (sa == null ? -1 : sa);
      }
      /* 默认按重量升序：同样占一格，越轻越划算 */
      var wa = typeof a[3] === "number" ? a[3] : 9e9;
      var wb = typeof b[3] === "number" ? b[3] : 9e9;
      return wa - wb;
    });
    return out;
  }

  /* ---------------------------------------------------------------- 渲染 */

  /* 类型筛选项。**必须覆盖数据里 types[0] 的全部取值**，否则那一类会在
     「按类型筛」时整类消失 —— 读者会以为库里没有这类东西（不是报错，是静默漏掉）。

     实测 scripts/data/items_full.json 的有效物品（4979 件，已剔 preset）里
     types[0] 共 23 种，本清单逐一对齐：

       mods 2314 · noFlea 787 · barter 355 · keys 259 · ammoBox 225 · ammo 212
       gun 172 · wearable 161 · armor 72 · glasses 54 · backpack 47 · provisions 43
       rig 41 · helmet 40 · armorPlate 38 · poster 37 · container 33 · headphones 28
       injectors 22 · meds 21 · (无类型) 7 · grenade 7 · specialSlot 4

     ⚠️ 改这张表前重跑一遍上面的统计（数据源里 types 变了、本表没跟，就会再漏）。
     ⚠️ 末尾的「__none__」是**无类型物品**的哨兵值，不能用空串 ——
        空串已经是「全部类型」的 value，两者会撞。 */
  var TYPES = [
    ["", "全部类型"],
    ["gun", "枪械"], ["mods", "武器配件"], ["ammo", "弹药"], ["ammoBox", "弹药箱"],
    ["armor", "护甲"], ["armorPlate", "护甲插板"], ["helmet", "头盔"],
    ["rig", "胸挂"], ["backpack", "背包"], ["glasses", "眼镜护目"],
    ["headphones", "耳机"], ["meds", "医疗"], ["injectors", "注射器"],
    ["provisions", "食物饮料"], ["grenade", "投掷武器"],
    ["keys", "钥匙"], ["container", "容器"], ["barter", "交换物"],
    ["wearable", "穿戴"], ["noFlea", "不可交易"], ["poster", "海报装饰"],
    ["specialSlot", "特殊装备"], ["__none__", "未分类"]
  ];

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function panel(d) {
    var wrap = el("div", "tk-cat");

    /* --- 控件区 --- */
    var bar = el("div", "tk-cat__bar");

    var input = document.createElement("input");
    input.type = "search";
    input.className = "tk-cat__q";
    input.placeholder = "搜中文名、英文名或归一化 ID（如 glock-19x）";
    input.setAttribute("aria-label", "搜索物品");
    bar.appendChild(input);

    var sel = document.createElement("select");
    sel.className = "tk-cat__kind";
    sel.setAttribute("aria-label", "按类型筛选");
    TYPES.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t[0];
      o.textContent = t[1];
      sel.appendChild(o);
    });
    bar.appendChild(sel);

    var sort = document.createElement("select");
    sort.className = "tk-cat__sort";
    sort.setAttribute("aria-label", "排序方式");
    [["weight", "按重量升序"], ["name", "按名称"],
     ["price", "按回收价降序"], ["slot", "按单格价值降序"]].forEach(function (s) {
      var o = document.createElement("option");
      o.value = s[0];
      o.textContent = s[1];
      sort.appendChild(o);
    });
    bar.appendChild(sort);

    var cnt = el("span", "tk-cat__count");
    bar.appendChild(cnt);
    wrap.appendChild(bar);

    /* --- 结果表 --- */
    var holder = el("div", "tk-cat__holder");
    wrap.appendChild(holder);

    /* --- 更多按钮 --- */
    var more = el("button", "tk-cat__more", "");
    more.type = "button";
    wrap.appendChild(more);

    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

    function draw() {
      var rows = apply(d);
      var total = rows.length;
      var shown = Math.min(total, page * PAGE_LIMIT);

      if (!total) {
        holder.textContent = "";
        holder.appendChild(el("p", "tk-cat__empty",
          "没有匹配的物品。中文名、英文名、归一化 ID 都可以搜；" +
          "如果这件物品确实不存在，那是数据源的问题，不是检索的问题。"));
        cnt.textContent = "0 件";
        more.hidden = true;
        return;
      }

      /* ⚠️ **绝不能给 <table> 加 class** —— 站内表格样式（表头承色块 / 斑马行 /
         边框 / 滚动容器）全部挂在 `.md-typeset table:not([class])`（extra.css 第 3 节），
         一加 class 就整类失配。实测过的代价：表头底色 rgb(74,89,108) → 透明、
         字重 700 → 400、斑马行与边框全没，而且**不报任何错**，只有量 computed
         style 才看得见（2026-10-10 排版审查发现，16 个图鉴页全中）。

         列宽与对齐改用**挂在 th/td 上的语义类**（.tk-col-*）——
         子元素带 class 不影响 `table:not([class])` 的匹配，两套规则互不干扰。 */
      var tb = document.createElement("table");
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      [["名称", "tk-col-name"], ["英文名", "tk-col-nowrap"], ["重量", "tk-col-num"],
       ["关键属性", "tk-col-desc"], ["商人最低售价", "tk-col-nowrap"],
       ["最高回收", "tk-col-nowrap"], ["单格价值 ₽/格", "tk-col-num"]
      ].forEach(function (p) {
        hr.appendChild(el("th", p[1], p[0]));
      });
      thead.appendChild(hr);
      tb.appendChild(thead);

      var tbody = document.createElement("tbody");
      rows.slice(0, shown).forEach(function (r) {
        var tr = document.createElement("tr");
        var td0 = el("td", "tk-col-name");
        var b = el("button", "tk-cat__name", r[1]);
        b.type = "button";
        b.title = "查看完整属性";
        td0.appendChild(b);
        tr.appendChild(td0);
        var tdEn = el("td", "tk-col-nowrap");
        tdEn.appendChild(el("code", null, r[2]));
        tr.appendChild(tdEn);
        tr.appendChild(el("td", "tk-col-num",
          typeof r[3] === "number" ? r[3] + " 千克" : "—"));
        tr.appendChild(el("td", "tk-col-desc", r[4] || "—"));
        tr.appendChild(el("td", "tk-col-nowrap", r[5] || "—"));
        tr.appendChild(el("td", "tk-col-nowrap", r[6] || "—"));
        var sv = slotValue(r);
        tr.appendChild(el("td", "tk-col-num", sv == null ? "—" : fmtNum(sv)));
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      holder.textContent = "";

      /* ⚠️ 运行时建的表**必须自己套 `.md-typeset__table`**。
         站内 extra.css 第 3 节写明这一层是全站**唯一**的表格滚动容器，而主题
         只给**构建期**就存在的表格套它。JS 动态建的表不套，窄屏下整页被撑宽
         （实测 390px 视口：表格 510px → 页面级溢出 157px）。
         **别在 table 自己身上加 overflow-x** —— 两层同时溢出会画出两条滚动条，
         且外层吃不到内层的溢出内容。 */
      var wrap = document.createElement("div");
      wrap.className = "md-typeset__table";
      wrap.appendChild(tb);
      holder.appendChild(wrap);

      cnt.textContent = total + " 件"
        + (shown < total ? "（已显示 " + shown + "）" : "");

      if (shown < total) {
        more.hidden = false;
        more.textContent = "再显示 " + Math.min(PAGE_LIMIT, total - shown) + " 件"
          + "（还剩 " + (total - shown) + "）";
      } else {
        more.hidden = true;
        more.textContent = "";
      }

      function detail(id) {
        var r = rows.filter(function (x) { return x[0] === id; })[0];
        if (!r) return;
        openDetail(r, d);
      }
      tbody.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".tk-cat__name") : null;
        if (!btn) return;
        var tr = btn.closest("tr");
        var idx = Array.prototype.indexOf.call(tr.parentNode.children, tr);
        detail(rows[idx][0]);
      });
    }

    input.addEventListener("input", function () { state.q = input.value; page = 1; draw(); });
    sel.addEventListener("change", function () { state.kind = sel.value; page = 1; draw(); });
    sort.addEventListener("change", function () { state.sort = sort.value; page = 1; draw(); });
    more.addEventListener("click", function () { page += 1; draw(); });

    draw();

    /* ---------------------------------------------------------- 深链定位
       站内其它页面（任务图鉴、物品反查、以后任何条目）链到图鉴时带参数：

         · ``?item=<id>``   → 定位到那一行并直接打开详情面板。**唯一名走这条**。
         · ``?q=<名字>``    → 自动搜索。**重名物品走这条**（图鉴里有 50 个名字
                              对应多件物品，硬指某一件会指错，索性让读者自己挑）。

       ⚠️ **用 query 不用 hash —— 这是被 Material 逼的，不是风格选择。**
       第一版用的是 ``#item-<id>``。**直接打开那个 URL 完全正常**（所以本地
       和线上手输地址都测得出「能用」），但只要读者是**点站内链接**过去的，
       Material 的 instant navigation 会把跨页 hash 改写成 ``#_1`` ——
       实测点击后 URL 变成 ``/catalog/barter/#_1``，参数**整个丢掉**，
       于是落地的是一张干净的表格，详情不展开，而**控制台一个错都不报**。
       query 参数不经过那套改写，两种情况行为一致。

       hash 形式仍然兼容（老链接、手输地址），但站内生成的链接一律用 query。
    */
    function applyDeepLink() {
      var item = null, term = null;
      try {
        var sp = new URLSearchParams(location.search || "");
        item = sp.get("item");
        term = sp.get("q");
      } catch (e) { /* 老浏览器没有 URLSearchParams → 退到 hash 分支 */ }
      if (!item && !term) {
        var h = (location.hash || "").replace(/^#/, "");
        if (h.indexOf("q=") === 0) term = decodeURIComponent(h.slice(2));
        else if (h.indexOf("item-") === 0) item = h.slice(5);
      }
      if (term) {
        input.value = term; state.q = term; page = 1; draw();
        return;
      }
      if (!item) return;
      var all = apply(d);
      var i = all.findIndex(function (row) { return row[0] === item; });
      if (i < 0) {                       // 不在本页 → 退化成搜索该 id
        input.value = item; state.q = item; page = 1; draw();
        return;
      }
      page = Math.floor(i / PAGE_LIMIT) + 1;
      draw();
      openDetail(all[i], d);
    }
    applyDeepLink();
    mount._onHash = applyDeepLink;
    window.addEventListener("hashchange", mount._onHash);

    return wrap;
  }

  /* -------------------------------------------------------------- 单格价值榜
     回答「背包里的一格，装什么最值钱」—— 数据全部是站内现成的
     （重量、商人回收价、占地格数），不需要联网、不需要跳蚤价。

     ⚠️ 三条口径必须写在界面上，否则会被读成「跳蚤价排行」：
       ① 价值取**商人最高回收**，不是跳蚤价（站内不联网、不收实时价）；
       ② 分母是**占地格数**（宽 × 高），不是体积、不是重量；
       ③ 缺回收价或缺格数的物品**不入榜** —— 算不出就算不出，不用默认值凑。
  -------------------------------------------------------------------------- */
  function renderValueRank(host, d) {
    var rows = [];
    for (var k in d.chunks) {
      if (Object.prototype.hasOwnProperty.call(d.chunks, k)) rows = rows.concat(d.chunks[k]);
    }
    var ranked = rows.filter(function (r) { return slotValue(r) != null; })
      .sort(function (a, b) { return slotValue(b) - slotValue(a); });

    var TOP = 30;
    var top = ranked.slice(0, TOP);
    host.textContent = "";

    if (!top.length) {
      host.appendChild(el("p", null, "数据未就绪，稍后重试。"));
      return;
    }

    var head = el("p", null, "");
    head.appendChild(document.createTextNode("按 "));
    head.appendChild(el("strong", null, "商人最高回收 ÷ 占地格数"));
    head.appendChild(document.createTextNode(
      " 排序 —— 衡量「一格空间装什么最值钱」。口径是商人回收，不是跳蚤价"
      + "（站内不联网、不收实时价）；缺回收价或缺格数的物品算不出，不入榜。"));
    host.appendChild(head);

    /* ⚠️ 同 panel()：<table> **不加 class**（加了会丢站内表格样式），
       列宽与对齐靠挂在 th/td 上的语义类。 */
    var tb = document.createElement("table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    [["#", "tk-col-num"], ["物品", "tk-col-name"], ["单格价值 ₽/格", "tk-col-num"],
     ["占地", "tk-col-num"], ["商人最高回收", "tk-col-nowrap"]
    ].forEach(function (p) {
      hr.appendChild(el("th", p[1], p[0]));
    });
    thead.appendChild(hr);
    tb.appendChild(thead);

    var tbody = document.createElement("tbody");
    top.forEach(function (r, i) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "tk-col-num", String(i + 1)));
      var td = el("td", "tk-col-name");
      var b = el("button", "tk-cat__name", r[1]);
      b.type = "button";
      b.title = "查看完整属性";
      td.appendChild(b);
      tr.appendChild(td);
      tr.appendChild(el("td", "tk-col-num", fmtNum(slotValue(r))));
      tr.appendChild(el("td", "tk-col-num", (typeof r[8] === "number" ? r[8] : "—") + " 格"));
      tr.appendChild(el("td", "tk-col-nowrap", r[6] || "—"));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);

    /* 两层容器：外层 .tk-cat__holder 让列宽与滚动规则能选中它（与检索面板同款），
       内层 .md-typeset__table 是全站唯一的表格滚动容器（见 panel() 的同一条说明）。
       少套外层，.tk-col-* 的 min-width 就落不到这张表上。 */
    var holder = document.createElement("div");
    holder.className = "tk-cat__holder";
    var wrap = document.createElement("div");
    wrap.className = "md-typeset__table";
    wrap.appendChild(tb);
    holder.appendChild(wrap);
    host.appendChild(holder);

    tbody.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".tk-cat__name") : null;
      if (!btn) return;
      var tr = btn.closest("tr");
      var idx = Array.prototype.indexOf.call(tr.parentNode.children, tr);
      openDetail(top[idx], d);
    });

    var foot = el("p", null, "以上为前 " + TOP + " 名。全部 " + ranked.length
      + " 件可算物品的完整排序，用上方检索区的「排序方式 → 按单格价值降序」。");
    host.appendChild(foot);
  }

  /* ------------------------------------------------------------ 任务链接
     物品侧显示「哪些任务要它」时，任务名要能点进任务详情页。

     数据是 `[任务名, 任务id 或 null]` 对（由 gen_quest_carrier.py 产出）：
       · id 有值 → 链接到 /quests/quest/?id=…
       · id 为 null → **重名任务**，生成器已判定不给链接（站内 10 个重名任务，
         硬指会指到另一个任务上而读者看不出来）—— 退成纯文本。
     ⚠️ 兼容纯字符串（旧数据 / 兜底），别让它渲染成 [object Object]。 */
  function questNode(pair) {
    var name = Array.isArray(pair) ? pair[0] : pair;
    var id = Array.isArray(pair) ? pair[1] : null;
    if (!id) return document.createTextNode(name);
    var a = el("a", "tk-cat-detail__quest", name);
    a.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(id);
    return a;
  }

  /* ------------------------------------------------------------ 详情面板 */

  function openDetail(r, d) {
    var old = document.getElementById("tk-cat-detail");
    if (old) old.remove();
    var box = el("div", "tk-cat-detail");
    box.id = "tk-cat-detail";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", r[1] + " 详情");

    var head = el("div", "tk-cat-detail__head");
    head.appendChild(el("h3", null, r[1]));
    var x = el("button", "tk-cat-detail__x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "关闭");
    head.appendChild(x);
    box.appendChild(head);

    var dl = document.createElement("dl");
    dl.className = "tk-cat-detail__dl";
    var sv = slotValue(r);
    [["英文名", r[2]], ["物品 ID", r[0]], ["重量", typeof r[3] === "number" ? r[3] + " 千克" : "—"],
     ["占地", (typeof r[8] === "number" && r[8] > 0) ? r[8] + " 格" : "—"],
     ["商人最低售价", r[5] || "—"], ["商人最高回收", r[6] || "—"],
     ["单格价值", sv == null ? "—（缺回收价或格数）" : fmtNum(sv) + " 卢布／格"]].forEach(function (p) {
      dl.appendChild(el("dt", null, p[0]));
      dl.appendChild(el("dd", null, p[1]));
    });
    box.appendChild(dl);

    var props = el("div", "tk-cat-detail__props");
    props.appendChild(el("h4", null, "属性摘要"));
    props.appendChild(el("p", null, r[4] || "该物品没有数值属性。"));
    box.appendChild(props);

    box.appendChild(buildRoutes(r, d));
    box.appendChild(buildQuestNeeds(r, d));

    /* 指向单件物品详情页 —— 面板是「在表格里顺手看一眼」，详情页是
       「一个可以分享、可以收藏的地址」。两处内容同源，只是承载形式不同。 */
    var full = document.createElement("p");
    var fa = el("a", "tk-cat-detail__more", "打开完整页面（链接可分享）→");
    fa.href = siteRoot().replace(/javascripts\/$/, "")
      + "catalog/item/?id=" + encodeURIComponent(r[0]);
    full.appendChild(fa);
    box.appendChild(full);

    box.appendChild(el("p", "tk-cat-detail__note",
      "本页数值随版本调整，以游戏内为准。数据源 tarkov.dev（二级），抓取于 " + (d.fetched || "—") + "。"));

    document.body.appendChild(box);
    x.addEventListener("click", function () { box.remove(); });
    box.addEventListener("click", function (e) { if (e.target === box) box.remove(); });
  }

  /* -------------------------------------------------- 「怎么拿到它」一节
     回答读者的第二个问题：**这东西我去哪弄？**

     ⚠️ **口径必须写死在界面上**，否则读者会把它当成「全部获取途径」：
       这里只列**确定的途径**（商人换 / 藏身处做）—— 它们可复核、可执行。
       **不含「哪张图能刷到」**：静态端点的散落刷新数据只覆盖 6.2% 的物品，
       给出「只有这几张图有」比不给更容易误导。站内 loot 页同样只给判断框架。
  ------------------------------------------------------------------------ */
  function buildRoutes(r, d) {
    var sec = el("div", "tk-cat-detail__props");
    sec.appendChild(el("h4", null, "怎么拿到它"));

    var list = (d.routes || {})[r[0]] || [];
    var bought = r[5] && String(r[5]).indexOf("—") !== 0;

    if (!list.length && !bought) {
      var empty = el("p", null, "");
      empty.appendChild(document.createTextNode("这件物品"));
      empty.appendChild(el("strong", null, "不在"));
      empty.appendChild(document.createTextNode(
        "站内收录的以物换物与制作配方里。这不等于拿不到 —— "
        + "只表示它得靠搜刮或跳蚤市场，而那两样站内不给点位（判据见战利品分布页）。"));
      sec.appendChild(empty);
      return sec;
    }

    if (bought) {
      var p0 = el("p", null, "");
      p0.appendChild(el("strong", null, "商人出售　"));
      p0.appendChild(document.createTextNode(r[5]));
      sec.appendChild(p0);
    }

    list.forEach(function (route) {
      var isBarter = route.k === "barter";
      var head = el("p", "tk-cat-detail__route");
      head.appendChild(el("strong", null,
        (isBarter ? "以物换物" : "藏身处制作") + "　"));
      head.appendChild(document.createTextNode(
        route.s + (route.lv ? "　" + route.lv + " 级" : "")));
      sec.appendChild(head);

      var ul = document.createElement("ul");
      ul.className = "tk-cat-detail__mats";
      (route.m || []).forEach(function (m) {
        var li = document.createElement("li");
        li.textContent = m[0] + " × " + m[1] + (m[2] ? "（工具，不消耗）" : "");
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    });

    var caution = el("p", "tk-cat-detail__caution");
    caution.appendChild(document.createTextNode("以上是"));
    caution.appendChild(el("strong", null, "确定的获取途径"));
    caution.appendChild(document.createTextNode(
      "（配方可复核）。不含「哪张图能刷到」—— 站内的散落刷新数据只覆盖少数物品，"
      + "给出来反而会让人以为「只有这几张图有」。找刷取点请用当前版本的社区地图。"));
    sec.appendChild(caution);

    return sec;
  }

  /* -------------------------------------------------- 「哪些任务要它」一节
     ⚠️ 措辞要卡死两点，否则会读成相反的意思：
       ① 这是**任务要不要它**，不是「物品在哪」；
       ② `maps` 是**任务所在地图**，不是**物品刷新地图** —— 数据源里叫 maps，
          但它跟着任务目标走。写成「在森林刷」就是错的。
  ------------------------------------------------------------------------ */
  function buildQuestNeeds(r, d) {
    var sec = el("div", "tk-cat-detail__props");
    sec.appendChild(el("h4", null, "有任务要它吗"));
    var q = (d.quests || {})[r[0]];
    if (!q) {
      sec.appendChild(el("p", null,
        "没有任务需要这件物品（或它是任务专属道具，不在图鉴收录范围内）。"));
      return sec;
    }
    var n = q.n || 0;
    var keep = q.keep || [];
    sec.appendChild(el("p", null,
      "被 " + n + " 个任务需要" + (keep.length ? "，建议保留" : "") + "。"));
    if (keep.length) {
      var ul = document.createElement("ul");
      ul.className = "tk-cat-detail__mats";
      keep.slice(0, 8).forEach(function (t) {
        var li = document.createElement("li");
        li.appendChild(questNode(t));
        ul.appendChild(li);
      });
      if (keep.length > 8) {
        ul.appendChild(el("li", null, "…等共 " + keep.length + " 个"));
      }
      sec.appendChild(ul);
    }
    if ((q.maps || []).length) {
      var m = el("p", "tk-cat-detail__caution");
      m.appendChild(document.createTextNode("需要它的任务在：" + q.maps.join("、") + "。"));
      m.appendChild(el("strong", null, "这是任务所在地图、不是物品的刷新位置"));
      m.appendChild(document.createTextNode("。"));
      sec.appendChild(m);
    }
    var a = el("a", "tk-cat-detail__more");
    a.href = siteRoot().replace(/javascripts\/$/, "") + "quests/item-lookup/";
    a.textContent = "去物品反查页看完整任务列表 →";
    sec.appendChild(a);
    return sec;
  }

  /* ---------------------------------------------------------------- 挂载 */

  function mount() {
    /* 两个区域各自挂载：检索面板（分类页 / 总览页）与单格价值榜（总览页）。
       本章节其余说明照旧 —— 两块都不依赖对方，任一块先就绪就先画。 */
    var panelHost = document.getElementById("tk-catalog") || document.getElementById("tk-catalog-all");
    var rankHost = document.getElementById("tk-catalog-value");
    if ((!panelHost || panelHost.dataset.tkReady) && (!rankHost || rankHost.dataset.tkReady)) return;
    var d = data();
    if (!d || !d.chunks) {
      /* 数据还没到。两个 <script> 是并行注入的，**没有「先数据后本体」的顺序保证**，
         实测 catalog.js 常常先执行完。

         ⚠️ **别用「限时轮询」当唯一机制** —— 第一版是 40 次 × 150ms（6 秒），
         本地够用，**线上必挂**：catalog-data.js 未压缩 1.26 MB，实测冷启动
         要 **35 秒**才下完（GitHub Pages 在弱网下就是这个速度）。6 秒一到就
         永久放弃，数据后来到了也**没人再试**，页面永远停在降级文案 ——
         而且**控制台一个错都不报**。

         所以主机制换成**事件驱动**：数据脚本下完就挂载，不受时长限制。
         轮询只作兜底（比如脚本元素查不到、或数据已被缓存的情况）。 */
      if (!mount._wired) {
        mount._wired = true;
        var ds = document.querySelector('script[src*="catalog-data.js"]');
        if (ds) {
          ds.addEventListener("load", function () {
            mount._wired = false;
            mount();
          });
        }
        var n = 0;
        var iv = window.setInterval(function () {
          /* ⚠️ 判「都画完没有」要**同时看两个挂载点**，且不能直接读 host.dataset ——
             只有榜单的页面（无 #tk-catalog）会让 host 为 null，读它就抛。 */
          var done = (!panelHost || panelHost.dataset.tkReady)
                  && (!rankHost || rankHost.dataset.tkReady);
          if (done || ++n > 300) {   /* 300 × 200ms ≈ 60 秒兜底 */
            window.clearInterval(iv);
            return;
          }
          if (data()) {
            window.clearInterval(iv);
            mount._wired = false;
            mount();
          }
        }, 200);
      }
      return;
    }
    if (panelHost && !panelHost.dataset.tkReady) {
      panelHost.dataset.tkReady = "1";
      /* ⚠️ 每次挂载（＝每次换页）都要**重置筛选状态**。
         state 是模块级变量，instant 换页不会重新加载脚本 —— 不重置的话，
         在枪械页搜了「glock」再点到配件页，搜索词还在，读者会以为
         「这一页怎么只有 glock 相关的配件」。 */
      state.q = ""; state.kind = ""; state.sort = "weight"; page = 1;
      /* ⚠️ hashchange 监听要**先摘掉上一次的**：换页后旧监听器仍抓着已被
         Material 卸掉的旧 DOM，既泄漏又可能对不存在的节点动手。 */
      if (mount._onHash) window.removeEventListener("hashchange", mount._onHash);
      var ui = panel(d);
      panelHost.textContent = "";
      panelHost.appendChild(ui);
    }
    if (rankHost && !rankHost.dataset.tkReady) {
      rankHost.dataset.tkReady = "1";
      renderValueRank(rankHost, d);
    }
  }

  /* 两条入口都要：toolbox.js 注入的脚本可能晚于 document$ 首次发出。
     ⚠️ **instant 换页会重放脚本**，所以挂载相关的标记要按「每次新页面」重置 ——
     不清 _wired 的话，第二个页面不会再装监听器，数据晚到就永远不会挂。 */
  function boot() {
    mount._wired = false;
    mount();
  }

  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(boot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
