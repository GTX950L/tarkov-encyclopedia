/* ==========================================================================
   任务筛选器（任务图鉴总览页 · 纯前端，无外部依赖）
   --------------------------------------------------------------------------
   要解决的问题：任务图鉴把 515 个任务拆成 11 个商人页 + 一张总览，**读者想找
   的是「符合我当下条件的任务」**（今晚去哪张图、要不要带钥匙、有没有失败条件、
   是不是 Kappa 线），而纯文本表格只能靠 Ctrl+F 一个个碰。

   三条边界：

     · **数据只有一份来源**：全部读自 quests-index-data.js（由
       scripts/gen_quest_insights.py 从 quests.json + quest-graph.json 生成），
       本文件不含任何任务的手写副本。

     · **不判「能不能接」**。本表展示的是**任务定义本身**（等级门槛、条件、解锁
       关系）。「我现在能不能接」要看商人的忠诚度与声望 —— 那在「我的进度」页判，
       两者分工不同：**这里回答「有哪些」，那里回答「我能不能做」。**

     · **解锁数是本站算出来的**，不在官方数据里。口径见页面「优先级速查」一节：
       只算状态为「完成」的前置边，沿链传递求闭包。

   加载方式：全站脚本 toolbox.js 检测到本页有 #tk-quest-filter 挂载点时才注入
   本文件；数据文件再由本文件注入 —— 其余 100+ 页面不背这 51 KB。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-quest-filter";
  var DATA_FILE = "quests-index-data.js";
  var DATA_KEY = "TARKOV_QUEST_INDEX";

  /* 数据列顺序（与生成器里的 cols 严格一致） */
  var C_NAME = 0, C_EN = 1, C_TRADER = 2, C_LEVEL = 3, C_MAP = 4, C_KEYS = 5,
      C_FACTION = 6, C_FLAGS = 7, C_FAIL = 8, C_DELAY = 9, C_RESTART = 10,
      C_EXP = 11, C_DUNLOCK = 12, C_CUNLOCK = 13, C_LINK = 14;

  var NO_MAP = "__none__";

  function siteRoot() {
    var s = document.querySelector('script[src*="quests-filter.js"]');
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
     条件开关：每一项 = 一个判据函数 + 一个说明
     -------------------------------------------------------------------------- */

  var CONDS = [
    ["keys", "需要钥匙", function (r) { return r[C_KEYS].length > 0; },
      "整任务或任一目标要求钥匙"],
    ["fail", "有失败条件", function (r) { return r[C_FAIL] === 1; },
      "失败后可能无法重来"],
    ["delay", "有接取延迟", function (r) { return r[C_DELAY] === 1; },
      "接取后要等一段时间才能推进"],
    ["restart", "可重接", function (r) { return r[C_RESTART] === 1; },
      "失败或放弃后还能再接"],
    ["kappa", "Kappa 线", function (r) { return r[C_FLAGS].indexOf("k") >= 0; },
      "「收藏家」的前置"],
    ["lk", "Lightkeeper 线", function (r) { return r[C_FLAGS].indexOf("l") >= 0; },
      "Lightkeeper 解锁链"],
    ["faction", "限定单一阵营", function (r) { return !!r[C_FACTION]; },
      "只能在 BEAR 或 USEC 其一完成"]
  ];

  var SORTS = [
    ["trader", "商人（默认顺序）"],
    ["unlock", "解锁收益：高 → 低"],
    ["exp", "经验奖励：高 → 低"],
    ["level", "等级门槛：低 → 高"],
    ["name", "任务名（字典序）"]
  ];

  function build(host, data) {
    var all = data.tasks;
    var root = el("div", "tk-qs");

    /* 中文名会撞（全站 10 个名字对应 23 条记录）——**只在这些行显示英文名**。
       给每一行都挂一行英文名会把行高翻倍、把表格推得更宽，而英文名的唯一用途
       就是消歧（分辨率见页面「一条读表前提」一节）。 */
    var nameCount = {};
    for (var i = 0; i < all.length; i++) {
      nameCount[all[i][C_NAME]] = (nameCount[all[i][C_NAME]] || 0) + 1;
    }

    var intro = el("p", "tk-qs__intro",
      "从 " + data.total + " 个任务里按条件筛。「解锁」一列是本站算出来的 —— "
      + "它表示做完这个任务之后，沿前置链一共能放开多少后续任务；"
      + "想「先做哪个最划算」就把排序切成「解锁收益」。");
    root.appendChild(intro);

    /* —— 工具栏第 1 行：搜索 / 商人 / 地图 / 等级 / 排序 —— */
    var bar = el("div", "tk-qs__bar");

    var q = el("input", "tk-qs__q");
    q.type = "search";
    q.placeholder = "搜任务名（中文或英文）…";
    q.setAttribute("aria-label", "按任务名搜索");
    bar.appendChild(q);

    function makeSel(cls, label) {
      var s = el("select", cls);
      s.setAttribute("aria-label", label);
      return s;
    }

    var selTrader = makeSel("tk-qs__sel", "按商人筛选");
    selTrader.appendChild(new Option("全部商人", ""));
    var traders = [];
    for (var i = 0; i < all.length; i++) {
      if (traders.indexOf(all[i][C_TRADER]) < 0) traders.push(all[i][C_TRADER]);
    }
    for (i = 0; i < traders.length; i++) selTrader.appendChild(new Option(traders[i], traders[i]));
    bar.appendChild(selTrader);

    var selMap = makeSel("tk-qs__sel", "按地图筛选");
    selMap.appendChild(new Option("全部地图", ""));
    var maps = [];
    for (i = 0; i < all.length; i++) {
      var m = all[i][C_MAP];
      if (m && maps.indexOf(m) < 0) maps.push(m);
    }
    maps.sort();
    for (i = 0; i < maps.length; i++) selMap.appendChild(new Option(maps[i], maps[i]));
    selMap.appendChild(new Option("未标注地图", NO_MAP));
    bar.appendChild(selMap);

    var selLevel = makeSel("tk-qs__sel", "按等级门槛筛选");
    var BANDS = [["", "全部等级"], ["__none__", "等级未标注（数据源没给）"],
      ["1-9", "Lv1–9"], ["10-19", "Lv10–19"], ["20-29", "Lv20–29"],
      ["30-39", "Lv30–39"], ["40-49", "Lv40–49"], ["50+", "Lv50 以上"]];
    for (i = 0; i < BANDS.length; i++) selLevel.appendChild(new Option(BANDS[i][1], BANDS[i][0]));
    bar.appendChild(selLevel);

    var selSort = makeSel("tk-qs__sel", "排序方式");
    for (i = 0; i < SORTS.length; i++) selSort.appendChild(new Option(SORTS[i][1], SORTS[i][0]));
    bar.appendChild(selSort);

    var reset = el("button", "tk-qs__reset", "重置");
    reset.type = "button";
    bar.appendChild(reset);
    root.appendChild(bar);

    /* —— 工具栏第 2 行：条件开关 —— */
    var chips = el("div", "tk-qs__chips");
    var on = {};
    var chipEls = [];
    for (i = 0; i < CONDS.length; i++) {
      (function (c) {
        var b = el("button", "tk-qs__chip", c[1]);
        b.type = "button";
        b.title = c[2];
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          on[c[0]] = !on[c[0]];
          b.setAttribute("aria-pressed", on[c[0]] ? "true" : "false");
          b.classList.toggle("is-on", !!on[c[0]]);
          repaint();
        });
        chips.appendChild(b);
        chipEls.push(b);
      })(CONDS[i]);
    }
    root.appendChild(chips);

    /* —— 汇总 —— */
    var stat = el("p", "tk-qs__stat");
    root.appendChild(stat);

    /* —— 表格（自己套滚动容器：站内约定 .md-typeset__table 是唯一滚动容器；
       表格**不加 class**，这样才能命中站内的 `table:not([class])` 样式） —— */
    var wrapOuter = el("div", "md-typeset__table tk-qs__wrap");
    var table = document.createElement("table");
    table.id = "tk-qs-table";            /* 只给 id、不给 class */
    var thead = document.createElement("thead");
    var tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    wrapOuter.appendChild(table);
    root.appendChild(wrapOuter);

    var empty = el("p", "tk-qs__empty",
      "没有匹配的任务 —— 换个筛选条件，或点「重置」。");
    empty.hidden = true;
    root.appendChild(empty);

    var note = el("p", "tk-qs__note",
      "「解锁」是本站按前置边算出的（只算状态为「完成」的边，沿链传递求闭包），"
      + "不是官方数据；「解锁 ≠ 可接」—— 能不能接还要过商人的忠诚等级与声望。"
      + "地图一列来自任务定义，全站只有 263 个任务带该字段，其余归入「未标注地图」。"
      + "点任务名可跳到对应商人页的明细。");
    root.appendChild(note);

    host.appendChild(root);

    /* --------------------------------------------------------------------------
       筛选 / 排序
       -------------------------------------------------------------------------- */

    function inBand(lv, band) {
      if (!band) return true;
      if (band === "__none__") return lv === 0;
      if (band === "50+") return lv >= 50;
      var parts = band.split("-");
      return lv >= +parts[0] && lv <= +parts[1];
    }

    function matched() {
      var kw = q.value.trim().toLowerCase();
      var tr = selTrader.value, mp = selMap.value, band = selLevel.value;
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var r = all[i];
        if (tr && r[C_TRADER] !== tr) continue;
        if (mp === NO_MAP) {
          if (r[C_MAP]) continue;                 /* 「未标注地图」= 只要没有地图字段的 */
        } else if (mp && r[C_MAP] !== mp) {
          continue;
        }
        if (!inBand(r[C_LEVEL], band)) continue;
        if (kw) {
          var hay = (r[C_NAME] + " " + r[C_EN]).toLowerCase();
          if (hay.indexOf(kw) < 0) continue;
        }
        var ok = true;
        for (var j = 0; j < CONDS.length; j++) {
          if (on[CONDS[j][0]] && !CONDS[j][2](r)) { ok = false; break; }
        }
        if (!ok) continue;
        out.push(i);
      }
      var mode = selSort.value;
      var byName = function (a, b) {
        return String(all[a][C_NAME]).localeCompare(String(all[b][C_NAME]), "zh");
      };
      out.sort(function (a, b) {
        var ra = all[a], rb = all[b];
        if (mode === "unlock") {
          return (rb[C_CUNLOCK] - ra[C_CUNLOCK]) || (rb[C_DUNLOCK] - ra[C_DUNLOCK]) || byName(a, b);
        }
        if (mode === "exp") return (rb[C_EXP] - ra[C_EXP]) || byName(a, b);
        if (mode === "level") {
          var la = ra[C_LEVEL] || 1e9, lb = rb[C_LEVEL] || 1e9;
          return (la - lb) || byName(a, b);
        }
        if (mode === "name") return byName(a, b);
        return a - b;   /* trader：保持数据里的原始顺序 */
      });
      return out;
    }

    function chip(text, cls, title) {
      return '<i class="tk-qs__tag' + (cls ? " " + cls : "") + '"'
        + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(text) + "</i>";
    }

    function rowHtml(r) {
      var marks = "";
      if (r[C_KEYS].length) {
        marks += chip("需 " + r[C_KEYS].length + " 把钥匙", "tk-qs__tag--key", "钥匙：" + r[C_KEYS].join("、"));
      }
      if (r[C_FACTION]) marks += chip("仅 " + r[C_FACTION], "tk-qs__tag--fac", "该任务只能在 " + r[C_FACTION] + " 阵营完成");
      if (r[C_FLAGS].indexOf("k") >= 0) marks += chip("Kappa", "tk-qs__tag--k", "「收藏家」的前置任务");
      if (r[C_FLAGS].indexOf("l") >= 0) marks += chip("Lightkeeper", "tk-qs__tag--l", "Lightkeeper 解锁链");
      if (r[C_FAIL]) marks += chip("有失败条件");
      if (r[C_DELAY]) marks += chip("有接取延迟");
      if (r[C_RESTART]) marks += chip("可重接");

      var lv = r[C_LEVEL] ? '<span class="tk-qs__lv">Lv' + r[C_LEVEL] + "</span>" : "";
      var unlock = r[C_CUNLOCK]
        ? '<b title="直接解锁 ' + r[C_DUNLOCK] + " 个；沿前置链共 " + r[C_CUNLOCK] + ' 个">' + r[C_CUNLOCK] + "</b>"
        : '<span class="tk-qs__zero" title="不阻塞任何任务">—</span>';

      /* 明细链接：数据里的形式是 `mechanic#q01`（与 quests-graph.js 同格式，
         那里由 progress-boards 拼站点根）。本页在 /quests/ 下，直接当 href 用
         会依赖服务器把 `mechanic` 重定向到 `mechanic/`，所以这里自己补斜杠，
         让它变成 `/quests/mechanic/#q01` 这种确定的地址。 */
      var href = String(r[C_LINK]).replace("#", "/#");

      /* 等级并进任务格：全站 62% 的任务等级为 0（数据源没给），单开一列会有
         六成是「—」，白占约 70px —— 而这几列在窄正文里本来就挤不下。
         英文名同理：只在中文名重复的那几行显示，它的唯一用途就是消歧。 */
      var en = (nameCount[r[C_NAME]] > 1 && r[C_EN])
        ? '<span class="tk-qs__en">' + esc(r[C_EN]) + "</span>" : "";

      /* 列顺序：**解锁紧跟在任务名之后** —— 它是本表唯一的「本站算出来的」
         数据，也是读者来这里的理由；放在最后一列时，窄屏默认视口里根本看不见。 */
      return "<tr>"
        + '<td><a href="' + esc(href) + '">' + esc(r[C_NAME]) + "</a>" + lv + en + "</td>"
        + "<td>" + unlock + "</td>"
        + "<td>" + esc(r[C_TRADER]) + "</td>"
        + "<td>" + (r[C_MAP] ? esc(r[C_MAP]) : "—") + "</td>"
        + '<td class="tk-qs__marks">' + (marks || '<span class="tk-qs__zero">—</span>') + "</td>"
        + "</tr>";
    }

    function repaint() {
      var rows = matched();
      var html = [];
      for (var i = 0; i < rows.length; i++) html.push(rowHtml(all[rows[i]]));
      tbody.innerHTML = html.join("");
      var hidden = all.length - rows.length;
      stat.textContent = "显示 " + rows.length + " / " + all.length + " 个任务"
        + (hidden ? "（已筛掉 " + hidden + " 个）" : "");
      empty.hidden = rows.length > 0;
      wrapOuter.hidden = rows.length === 0;
    }

    thead.innerHTML = '<tr><th title="点任务名跳到对应商人页的明细">任务</th>'
      + '<th title="做完它之后沿前置链一共放开多少任务（鼠标悬停看直接数）">解锁</th>'
      + "<th>商人</th>"
      + '<th title="任务定义里的地图归属，全站只有 263 个任务带该字段">地图</th>'
      + "<th>条件</th></tr>";

    q.addEventListener("input", repaint);
    selTrader.addEventListener("change", repaint);
    selMap.addEventListener("change", repaint);
    selLevel.addEventListener("change", repaint);
    selSort.addEventListener("change", repaint);
    reset.addEventListener("click", function () {
      q.value = "";
      selTrader.value = ""; selMap.value = ""; selLevel.value = ""; selSort.value = "trader";
      for (var k in on) on[k] = false;
      for (var i = 0; i < chipEls.length; i++) {
        chipEls[i].setAttribute("aria-pressed", "false");
        chipEls[i].classList.remove("is-on");
      }
      repaint();
    });

    repaint();
  }

  function mount() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (host.getAttribute("data-ready")) return;
    host.setAttribute("data-ready", "1");
    host.textContent = "";
    host.appendChild(el("p", "tk-qs__loading", "正在载入任务数据…"));
    loadData(function (data) {
      if (!data || !data.tasks || !data.tasks.length) {
        host.textContent = "";
        host.appendChild(el("p", "tk-qs__notready",
          "任务数据没有载入成功（可能是网络中断或脚本被拦截）。"
          + "本页的分段统计、速查与各商人页都不受影响；刷新一次通常即可恢复。"));
        return;
      }
      build(host, data);
    });
  }

  /* 两条入口都要：订阅负责 instant 换页；立即尝试负责「本脚本晚于 document$
     首次发出才被注入」的情形（toolbox.js 是动态注入本文件的）。 */
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
