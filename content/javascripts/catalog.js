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
      if (state.kind && r[7] !== state.kind) return false;
      return true;
    });
    out.sort(function (a, b) {
      if (state.sort === "name") return a[1].localeCompare(b[1], "zh");
      if (state.sort === "price") {
        var pb = parseNum(b[6]), pa = parseNum(a[6]);
        return (pb == null ? -1 : pb) - (pa == null ? -1 : pa);
      }
      /* 默认按重量升序：同样占一格，越轻越划算 */
      var wa = typeof a[3] === "number" ? a[3] : 9e9;
      var wb = typeof b[3] === "number" ? b[3] : 9e9;
      return wa - wb;
    });
    return out;
  }

  /* ---------------------------------------------------------------- 渲染 */

  var TYPES = [
    ["", "全部类型"],
    ["gun", "枪械"], ["mods", "武器配件"], ["ammo", "弹药"], ["ammoBox", "弹药箱"],
    ["armor", "护甲"], ["helmet", "头盔"], ["rig", "胸挂"], ["backpack", "背包"],
    ["headphones", "耳机"], ["meds", "医疗"], ["provisions", "食物饮料"],
    ["keys", "钥匙"], ["container", "容器"], ["barter", "交换物"],
    ["wearable", "穿戴"], ["noFlea", "不可交易"], ["poster", "海报装饰"]
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
     ["price", "按回收价降序"]].forEach(function (s) {
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

      /* ⚠️ 建表不加 class —— 站内 extra.css 第 3 节的规则是
         `.md-typeset table:not([class])`，给了 class 会整套丢失样式
         （表头承色块 / 斑马行 / 边框 / 横向滚动）。 */
      var tb = document.createElement("table");
      tb.className = "tk-cat__table";
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["名称", "英文名", "重量", "关键属性", "商人最低售价", "最高回收"].forEach(function (h) {
        hr.appendChild(el("th", null, h));
      });
      thead.appendChild(hr);
      tb.appendChild(thead);

      var tbody = document.createElement("tbody");
      rows.slice(0, shown).forEach(function (r) {
        var tr = document.createElement("tr");
        var td0 = document.createElement("td");
        var b = el("button", "tk-cat__name", r[1]);
        b.type = "button";
        b.title = "查看完整属性";
        td0.appendChild(b);
        tr.appendChild(td0);
        tr.appendChild(el("td", null, ""));
        tr.children[1].appendChild(el("code", null, r[2]));
        tr.appendChild(el("td", null,
          typeof r[3] === "number" ? r[3] + " 千克" : "—"));
        tr.appendChild(el("td", null, r[4] || "—"));
        tr.appendChild(el("td", null, r[5] || "—"));
        tr.appendChild(el("td", null, r[6] || "—"));
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
    return wrap;
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
    [["英文名", r[2]], ["物品 ID", r[0]], ["重量", typeof r[3] === "number" ? r[3] + " 千克" : "—"],
     ["商人最低售价", r[5] || "—"], ["商人最高回收", r[6] || "—"]].forEach(function (p) {
      dl.appendChild(el("dt", null, p[0]));
      dl.appendChild(el("dd", null, p[1]));
    });
    box.appendChild(dl);

    var props = el("div", "tk-cat-detail__props");
    props.appendChild(el("h4", null, "属性摘要"));
    props.appendChild(el("p", null, r[4] || "该物品没有数值属性。"));
    box.appendChild(props);

    box.appendChild(el("p", "tk-cat-detail__note",
      "本页数值随版本调整，以游戏内为准。数据源 tarkov.dev（二级），抓取于 " + (d.fetched || "—") + "。"));

    document.body.appendChild(box);
    x.addEventListener("click", function () { box.remove(); });
    box.addEventListener("click", function (e) { if (e.target === box) box.remove(); });
  }

  /* ---------------------------------------------------------------- 挂载 */

  function mount() {
    var host = document.getElementById("tk-catalog") || document.getElementById("tk-catalog-all");
    if (!host || host.dataset.tkReady) return;
    var d = data();
    if (!d || !d.chunks) {
      /* 数据没到。⚠️ **不能就这么放弃** —— 两个 <script> 是并行注入的，
         没有「先数据后本体」的顺序保证（本批实测：本体先执行，直接 return 后
         页面永远停在降级文案，且**控制台一个错都不报**）。
         所以改成有上限的轮询；数据真的缺失时（生成物没构建）轮询几次就放弃，
         保留生成器写好的降级文案。 */
      if (!mount._tries) mount._tries = 0;
      if (mount._tries++ > 40) return;   /* 约 6 秒，够脚本下载完 */
      window.setTimeout(mount, 150);
      return;
    }
    host.dataset.tkReady = "1";
    var ui = panel(d);
    host.textContent = "";
    host.appendChild(ui);
  }

  /* 两条入口都要：toolbox.js 注入的脚本可能晚于 document$ 首次发出。
     ⚠️ **instant 换页会重放脚本**，所以挂载标记与轮询计数要按「每次新页面」重置 ——
     否则第一次的 mount._tries 会让第二个页面直接放弃。 */
  function boot() {
    mount._tries = 0;
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
