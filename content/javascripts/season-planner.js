/* ==========================================================================
   赛季特质模拟器（纯前端，无外部依赖）
   --------------------------------------------------------------------------
   要解决的问题：赛季特质（第一赛季 KORD BREACH）是一套「一次锁定、整季不可
   反悔」的构筑系统 —— 34 项个人卡，正面消耗点数、负面提供点数，余额不得为负，
   另有 17 组互斥。正文已经把清单与互斥列全了，但「把账算清」这件事此前仍要
   读者自己拿纸笔做。本脚本把它变成可点的：点负面加点数、点正面花点数，
   超额与冲突即时提示。

   三条边界：
     · **数据只有一份来源**：全部读自 season-planner-data.js（由
       scripts/gen_season_planner.py 从 season-modifiers.md 解析生成），
       本文件不含任何点数或互斥的手写副本。
     · **不保存、不联网**：结果留在当前页面内存里，刷新即清零 —— 它是
       「下卡前把账算清」的工具，不是进度记录（记录归「我的进度」）。
     · **只做游戏内明确写着的两条校验**：点数余额、互斥。不做「哪张卡更强」
       的推荐 —— 那是评析，不是数据。

   加载方式：全站脚本 toolbox.js 检测到本页有 #tk-season-planner 挂载点时才
   注入本文件。本文件可能**晚于** Material 的 document$ 首次发出之后才加载，
   所以除订阅之外还要自己立即尝试一次（见文件末尾），用挂载点上的
   data-ready 标记防重复渲染。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-season-planner";
  var DATA_FILE = "season-planner-data.js";
  var DATA_KEY = "TARKOV_SEASON_PLANNER";

  function siteRoot() {
    var s = document.querySelector('script[src*="season-planner.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
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

    var sel = Object.create(null);          // 已选卡：名称 → true

    /* 互斥索引：名称 → [冲突名, …]。数据里是「成对的组」，
       双向都登记，查询时只看一个方向。 */
    var exclMap = Object.create(null);
    (data.exclusive || []).forEach(function (pair) {
      if (!exclMap[pair[0]]) exclMap[pair[0]] = [];
      if (!exclMap[pair[1]]) exclMap[pair[1]] = [];
      exclMap[pair[0]].push(pair[1]);
      exclMap[pair[1]].push(pair[0]);
    });

    /* 全部卡（带方向标记），负面在前 —— 与「先攒点、后花点」的操作顺序一致 */
    var cards = [];
    (data.negative || []).forEach(function (c) {
      cards.push({ n: c.n, p: c.p, d: c.d, pos: false });
    });
    (data.positive || []).forEach(function (c) {
      cards.push({ n: c.n, p: c.p, d: c.d, pos: true });
    });
    var TOTAL = cards.length;

    function balance() {
      var b = 0;
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (!sel[c.n]) continue;
        b += c.pos ? -c.p : c.p;
      }
      return b;
    }

    /* 返回空串 = 可选；否则返回锁定原因（显示在 title 与视觉态上）。
       已选中的卡永远可点（取消），不进锁。 */
    function lockReason(card) {
      if (sel[card.n]) return "";
      var conflicts = exclMap[card.n] || [];
      for (var i = 0; i < conflicts.length; i++) {
        if (sel[conflicts[i]]) return "与「" + conflicts[i] + "」互斥";
      }
      /* 正面卡：不允许「选了之后余额变负」。
         负面卡不加限制（点它只会让余额变大）。 */
      if (card.pos && balance() - card.p < 0) {
        return "点数不足：还差 " + (card.p - balance()) + " 点";
      }
      return "";
    }

    function selectedCount() {
      return Object.keys(sel).length;
    }

    /* —— 顶部状态条 —— */

    var root = el("div", "tk-planner");

    var bar = el("div", "tk-planner__bar");
    var balEl = el("span", "tk-planner__bal");
    var cntEl = el("span", "tk-planner__cnt");
    var stateEl = el("span", "tk-planner__state");
    var resetBtn = el("button", "tk-planner__reset", "重置");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", function () {
      sel = Object.create(null);
      sync();
    });
    bar.appendChild(balEl);
    bar.appendChild(cntEl);
    bar.appendChild(stateEl);
    bar.appendChild(resetBtn);
    root.appendChild(bar);

    /* —— 两个卡区 —— */

    var chipNodes = Object.create(null);
    var zones = [
      { pos: false, title: "负面卡", hint: "点选获得点数" },
      { pos: true, title: "正面卡", hint: "点选消耗点数" }
    ];

    zones.forEach(function (z) {
      var zone = el("div", "tk-planner__zone");
      var head = el("div", "tk-planner__zonehead");
      head.appendChild(document.createTextNode(z.title + " "));
      head.appendChild(el("span", null, "（" + z.hint + "）"));
      zone.appendChild(head);

      var grid = el("div", "tk-planner__grid");
      cards.forEach(function (card) {
        if (card.pos !== z.pos) return;
        var chip = el("button", "tk-chip " + (card.pos ? "tk-chip--pos" : "tk-chip--neg"));
        chip.type = "button";
        chip.appendChild(el("span", "tk-chip__n", card.n));
        chip.appendChild(el("span", "tk-chip__p",
          (card.pos ? "\u2212" : "+") + card.p));
        chip.addEventListener("click", function () {
          if (sel[card.n]) delete sel[card.n];
          else if (!lockReason(card)) sel[card.n] = true;
          else return;                       // 锁定态点击：无操作（原因在 title 里）
          sync();
        });
        chipNodes[card.n] = chip;
        grid.appendChild(chip);
      });
      zone.appendChild(grid);
      root.appendChild(zone);
    });

    /* —— 说明 —— */

    var note = el("p", "tk-planner__note",
      "点卡即选、再点取消；余额不得为负。选完照抄进游戏创建界面即可 —— "
      + "本工具不保存结果（换设备不影响，刷新只代表重新算一次）。");
    root.appendChild(note);

    /* —— 状态同步 —— */

    function sync() {
      var bal = balance();
      var cnt = selectedCount();

      cards.forEach(function (card) {
        var node = chipNodes[card.n];
        var on = !!sel[card.n];
        var reason = on ? "" : lockReason(card);
        node.classList.toggle("is-on", on);
        node.classList.toggle("is-locked", !!reason);
        node.setAttribute("aria-pressed", on ? "true" : "false");
        node.setAttribute("aria-disabled", reason ? "true" : "false");
        /* 未锁时 title 给卡面效果全文；锁定时优先说清为什么不能点 */
        node.title = reason ? reason + "（" + card.d + "）" : card.d;
      });

      balEl.classList.toggle("is-neg", bal < 0);
      balEl.textContent = bal < 0
        ? "超出 " + (-bal) + " 点"
        : "可用点数 " + bal;
      cntEl.textContent = "已选 " + cnt + " / " + TOTAL;

      if (bal < 0) {
        stateEl.textContent = "不合法 —— 超出部分要靠补回负面卡或取消正面卡";
        stateEl.classList.remove("is-ok");
      } else if (cnt === 0) {
        stateEl.textContent = "可以一张不选：六项全局强制生效";
        stateEl.classList.remove("is-ok");
      } else {
        stateEl.textContent = "组合合法";
        stateEl.classList.add("is-ok");
      }
    }

    host.appendChild(root);
    sync();
  }

  /* --------------------------------------------------------------------------
     挂载
     -------------------------------------------------------------------------- */

  function mount() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (host.getAttribute("data-ready")) return;   // 防重复渲染
    host.setAttribute("data-ready", "1");
    host.textContent = "";
    host.appendChild(el("p", "tk-planner__loading", "正在载入选卡模拟器…"));
    loadData(function (data) {
      if (!data) {
        host.textContent = "";
        host.appendChild(el("p", "tk-planner__notready",
          "选卡模拟器没有载入成功（可能是网络中断或脚本被拦截）。"
          + "本页的清单与互斥表不受影响；刷新一次通常即可恢复。"));
        return;
      }
      build(host, data);
    });
  }

  /* 两条入口都要：订阅负责 instant 换页；立即尝试负责「本脚本晚于
     document$ 首次发出才被注入」的情形（toolbox.js 是动态注入本文件的）。 */
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
