/* ==========================================================================
   配方速查：制作与交换（纯前端，无外部依赖）
   --------------------------------------------------------------------------
   两套配方的查询工具：
     · 制作 —— 214 条（藏身处设施：工作台 / 卫生间 / 医疗站 / 情报中心 /
       营养部 / 集水器 / 酿酒处 / 比特币矿场），字段含等级、时长与材料
       （工具类材料单独标注「不计入消耗」）；
     · 交换 —— 855 条（8 位商人），字段含忠诚度、数量与「是否需任务解锁」。

   三条边界：
     · **不列价格与利润**。售价/成本是实时数据，静态站收录即过期 ——
       本站只承载「配方结构」（谁、什么设施或商人、什么等级、用什么换什么、
       要多久）。要算利润请配合实时物价站使用，见页面说明。
     · **数据只有一份来源**：全部读自 recipe-data.js（scripts/gen_recipes.py
       抓取并生成），本文件不含任何配方的手写副本。
     · **搜索覆盖材料名**：输入某件物品，能同时查出「它能做出什么」与
       「哪个配方需要它」—— 后者是进图前清仓库时最常用的方向。

   加载方式：全站脚本 toolbox.js 检测到本页有 #tk-recipe-browser 挂载点时
   才注入本文件；数据文件再由本文件注入 —— 其余 100+ 页面不背这 123 KB。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-recipe-browser";
  var DATA_FILE = "recipe-data.js";
  var DATA_KEY = "TARKOV_RECIPES";

  var STATION_ORDER = ["工作台", "卫生间", "医疗站", "情报中心", "营养部",
    "集水器", "酿酒处", "比特币矿场"];
  var TRADER_ORDER = ["Mechanic", "Prapor", "Skier", "Jaeger", "Ragman",
    "Therapist", "Peacekeeper", "Ref（竞技场裁判）"];

  function siteRoot() {
    var s = document.querySelector('script[src*="recipe-browser.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtCount(c) {
    /* GP 币这类可分割物品的数量带小数（0.42 / 155.1），原样显示 */
    if (typeof c !== "number") return String(c);
    return Number.isInteger(c) ? String(c) : String(c);
  }

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec <= 0) return "即时";
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.round((sec % 3600) / 60);
    var out = [];
    if (d) out.push(d + " 天");
    if (h) out.push(h + " 小时");
    if (m) out.push(m + " 分");
    return out.join(" ");
  }

  function loadData(cb) {
    if (window[DATA_KEY]) { cb(window[DATA_KEY]); return; }
    var url = siteRoot() + "javascripts/" + DATA_FILE;
    if (!url || url.indexOf("javascripts/") === 0) { cb(null); return; }
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    sc.onload = function () {
      if (done) return;
      done = true;
      cb(window[DATA_KEY] || null);
    };
    sc.onerror = function () {
      if (done) return;
      done = true;
      cb(null);
    };
    document.head.appendChild(sc);
  }

  /* --------------------------------------------------------------------------
     渲染
     -------------------------------------------------------------------------- */

  function build(host, data) {
    host.textContent = "";

    var names = data.names || [];
    function nm(i) { return names[i] || "？"; }

    /* 状态：两个页签各记各的筛选，切回时保留 */
    var tab = "craft";
    var filt = {
      craft: { sel: "", level: "", q: "" },
      barter: { sel: "", level: "", q: "" }
    };

    var root = el("div", "tk-rec");

    /* —— 页签 —— */
    var tabs = el("div", "tk-rec__tabs");
    tabs.setAttribute("role", "tablist");
    var tabBtns = {};
    [
      { k: "craft", label: "制作配方", n: (data.crafts || []).length },
      { k: "barter", label: "商人交换", n: (data.barters || []).length }
    ].forEach(function (t) {
      var b = el("button", "tk-rec__tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.appendChild(document.createTextNode(t.label + " "));
      b.appendChild(el("span", "tk-rec__tabn", String(t.n)));
      b.addEventListener("click", function () {
        tab = t.k;
        sync();
      });
      tabBtns[t.k] = b;
      tabs.appendChild(b);
    });
    root.appendChild(tabs);

    /* —— 筛选条 —— */
    var bar = el("div", "tk-rec__bar");

    var sel = document.createElement("select");
    sel.className = "tk-rec__sel";
    sel.setAttribute("aria-label", "按设施或商人筛选");
    sel.addEventListener("change", function () {
      filt[tab].sel = sel.value;
      renderRows();
    });

    var lv = document.createElement("select");
    lv.className = "tk-rec__lv";
    lv.setAttribute("aria-label", "按等级筛选");
    lv.addEventListener("change", function () {
      filt[tab].level = lv.value;
      renderRows();
    });

    var q = document.createElement("input");
    q.type = "search";
    q.className = "tk-rec__q";
    q.placeholder = "搜物品名或材料名，如：电线";
    q.setAttribute("aria-label", "搜索配方");
    q.addEventListener("input", function () {
      filt[tab].q = q.value.trim().toLowerCase();
      renderRows();
    });

    var stat = el("span", "tk-rec__stat");

    bar.appendChild(sel);
    bar.appendChild(lv);
    bar.appendChild(q);
    bar.appendChild(stat);
    root.appendChild(bar);

    /* —— 表格（自己套滚动容器：站内约定 .md-typeset__table 是唯一滚动容器；
       表格**不加 class**，这样才能命中站内的 `table:not([class])` 样式
       ——表头承色块、斑马行、边框都跟着全站走；内层元素按需加 class） —— */
    var wrapOuter = el("div", "md-typeset__table tk-rec__wrap");
    var table = document.createElement("table");
    /* 只给 id、不给 class —— class 会让 `table:not([class])` 落空，丢掉站内表格样式 */
    table.id = "tk-rec-table";
    var thead = document.createElement("thead");
    var tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    wrapOuter.appendChild(table);
    root.appendChild(wrapOuter);

    var empty = el("p", "tk-rec__empty", "没有匹配的配方 —— 换个筛选条件或清空搜索试试。");
    empty.hidden = true;
    root.appendChild(empty);

    var note = el("p", "tk-rec__note",
      "材料栏里的「工具」不消耗（另有标记）；带「任务」标记的材料是任务物品，不能直接购买。"
      + "本表不含价格与利润 —— 那是实时数据，请配合物价站使用。");
    root.appendChild(note);

    host.appendChild(root);

    /* —— 数据行 —— */
    function rowsFor() {
      var f = filt[tab];
      var src = tab === "craft" ? data.crafts : data.barters;
      var out = [];
      for (var i = 0; i < src.length; i++) {
        var r = src[i];
        var selName = tab === "craft" ? r[2] : r[2];      // 设施 / 商人
        var level = tab === "craft" ? r[3] : r[3];
        if (f.sel && selName !== f.sel) continue;
        if (f.level && String(level) !== f.level) continue;
        if (f.q) {
          var hay = nm(r[0]).toLowerCase();
          var mats = tab === "craft" ? r[5] : r[4];
          for (var j = 0; j < mats.length; j++) hay += " " + nm(mats[j][0]).toLowerCase();
          if (hay.indexOf(f.q) < 0) continue;
        }
        out.push(r);
      }
      return out;
    }

    function cellsHtml(r) {
      var mats = tab === "craft" ? r[5] : r[4];
      var mhtml = [];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        var tag = "";
        if (tab === "craft") {
          if (m[2] === 1) tag = '（<i class="tk-rec__tool">工具</i>）';
          else if (m[2] === 2) tag = '（<i class="tk-rec__quest">任务</i>）';
        }
        mhtml.push(esc(nm(m[0])) + " ×" + fmtCount(m[1]) + tag);
      }
      var name = esc(nm(r[0])) + " ×" + fmtCount(r[1]);
      var note = (tab === "craft" ? r[6] : r[5]) || "";
      if (note) name += ' <i class="tk-rec__tag">' + esc(note) + "</i>";
      var mid = esc(r[2]);
      if (tab === "craft") {
        return "<td>" + name + "</td><td>" + mid + "</td><td>" + r[3] +
          "</td><td>" + fmtDur(r[4]) + "</td><td class=\"tk-rec__mats\">" +
          mhtml.join(" · ") + "</td>";
      }
      return "<td>" + name + "</td><td>" + mid + "</td><td>LL" + r[3] +
        "</td><td class=\"tk-rec__mats\">" + mhtml.join(" · ") + "</td>";
    }

    function renderRows() {
      var rows = rowsFor();
      var html = [];
      for (var i = 0; i < rows.length; i++) {
        html.push("<tr>" + cellsHtml(rows[i]) + "</tr>");
      }
      tbody.innerHTML = html.join("");
      empty.hidden = rows.length > 0;
      stat.textContent = "共 " + rows.length + " 条";
    }

    /* —— 切换页签时重建筛选器与表头 —— */
    function sync() {
      tabBtns.craft.classList.toggle("is-on", tab === "craft");
      tabBtns.barter.classList.toggle("is-on", tab === "barter");
      tabBtns.craft.setAttribute("aria-selected", tab === "craft" ? "true" : "false");
      tabBtns.barter.setAttribute("aria-selected", tab === "barter" ? "true" : "false");

      var opts = tab === "craft" ? STATION_ORDER : TRADER_ORDER;
      sel.textContent = "";
      var all = el("option");
      all.value = "";
      all.textContent = tab === "craft" ? "全部设施" : "全部商人";
      sel.appendChild(all);
      opts.forEach(function (name) {
        // 只列出数据里实际存在的
        var has = (tab === "craft" ? data.crafts : data.barters).some(function (r) {
          return r[2] === name;
        });
        if (!has) return;
        var o = el("option");
        o.value = name;
        o.textContent = name;
        sel.appendChild(o);
      });

      lv.textContent = "";
      var lvAll = el("option");
      lvAll.value = "";
      lvAll.textContent = "全部等级";
      lv.appendChild(lvAll);
      (tab === "craft" ? ["1", "2", "3"] : ["1", "2", "3", "4"]).forEach(function (n) {
        var o = el("option");
        o.value = n;
        o.textContent = (tab === "craft" ? "等级 " : "LL") + n;
        lv.appendChild(o);
      });

      // 恢复该页签的筛选值
      sel.value = filt[tab].sel;
      lv.value = filt[tab].level;
      q.value = filt[tab].q;

      thead.innerHTML = tab === "craft"
        ? "<tr><th>产出</th><th>设施</th><th>等级</th><th>时长</th><th>材料</th></tr>"
        : "<tr><th>产出</th><th>商人</th><th>忠诚度</th><th>材料</th></tr>";

      renderRows();
    }

    sync();
  }

  /* --------------------------------------------------------------------------
     挂载
     -------------------------------------------------------------------------- */

  function mount() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (host.getAttribute("data-ready")) return;
    host.setAttribute("data-ready", "1");
    host.textContent = "";
    host.appendChild(el("p", "tk-rec__loading", "正在载入配方数据…"));
    loadData(function (data) {
      if (!data) {
        host.textContent = "";
        host.appendChild(el("p", "tk-rec__notready",
          "配方数据没有载入成功（可能是网络中断或脚本被拦截）。"
          + "本页其余说明不受影响；刷新一次通常即可恢复。"));
        return;
      }
      build(host, data);
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
