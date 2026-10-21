/* ==========================================================================
   首页作战台（content/README.md 的 #tk-home-ops）
   --------------------------------------------------------------------------
   为什么要在首页做这一块
   ----------------------
   全站最有用的东西是「按地图看还剩哪些任务」，但它藏在 /ops/ 三栏里：
   读者得先点到「查阅 › 作战台」才看得见。首页这一块做的是**同一件事的最小版**：
   选图 → 这张图上的任务（未完成的在前）→ 就地勾完成 → 想细看再去完整作战台。

   数据
   ----
   ops-lite-<mode>.js（由 scripts/gen_ops_index.py 生成，28 KB / gzip 8 KB），
   只含四列：名称、商人、等级、所在地图。**首次交互时才加载** —— 首页不该为
   一个可能不点的功能付 28 KB。

   进度
   ----
   读写 window.TarkovProgress（progress.js，全站都加载）。没装进度扩展/存储被禁时，
   这一块退化成「只读清单」：任务照列，勾选框不出现。

   ⚠️ 与 ops-board.js 的分工：这里**不做**目标级勾选、地图联动、筛选面板。
      那些留在完整作战台；首页这一块只回答「还有哪些活」。
   ========================================================================== */

(function () {
  "use strict";

  var HOST = "tk-home-ops";
  var LITE = { pve: "ops-lite-pve.js", pvp: "ops-lite-pvp.js", season: "ops-lite-pvp.js" };
  /* 文件名与导出名是两件事：赛季共用 pvp 的 lite 数据，导出名也只有 _PVP。
     直接拼 mode.toUpperCase() 会拿 TARKOV_OPS_LITE_SEASON（不存在）→ 清单永远空。 */
  var LITE_KEY = { pve: "TARKOV_OPS_LITE_PVE", pvp: "TARKOV_OPS_LITE_PVP", season: "TARKOV_OPS_LITE_PVP" };
  var LIMIT = 24;
  var cached = {};      /* 缓存键 = 文件名去掉 .js（pve / pvp），season 与 pvp 共用 */
  var loading = null;   /* 正在加载的模式 */

  function liteCacheKey(mode) { return mode === "season" ? "pvp" : mode; }

  /* 商人 slug → 站内一贯的写法（与左栏 nav 一致：Mechanic / BTR 司机）。
     lite 索引里存的是 slug（小写），直接显示会出现一节 "prapor"，与站内其它
     页面写法不一致。显示名放在前端是为了让索引继续只存一个短字段。 */
  var TRADER = {
    prapor: "Prapor", therapist: "Therapist", fence: "Fence",
    skier: "Skier", peacekeeper: "Peacekeeper", mechanic: "Mechanic",
    ragman: "Ragman", jaeger: "Jaeger", lightkeeper: "Lightkeeper",
    "btr-driver": "BTR 司机", ref: "Ref"
  };

  function traderName(slug) { return TRADER[slug] || slug || "—"; }

  var S = { map: "", mode: "" };

  /* ------------------------------------------------------------- 工具 */

  function root() {
    /* 首页恒在站点根：/index.html 或 /。用 document.baseURI 而不是 script.src ——
       instant 换页后 <script> 的 src 会按换页前的地址解析（详见 toolbox.js）。 */
    var b = document.baseURI || location.href;
    return b.replace(/[^/]*$/, "");
  }

  function prog() { return window.TarkovProgress || null; }

  function currentMode() {
    var p = prog();
    var m = p ? p.mode() : "pve";
    return LITE[m] ? m : "pvp";     /* season 共用 pvp 的任务库 */
  }

  function stateOf(qid) {
    var p = prog();
    return p ? p.taskState(qid) : "";
  }

  function setState(qid, done, trader) {
    var p = prog();
    if (!p) return;
    p.setTaskState(qid, done ? "done" : "", trader || "");
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* --------------------------------------------------------- 数据加载 */

  function loadLite(mode, cb) {
    var key = liteCacheKey(mode);
    if (cached[key]) { cb(cached[key]); return; }
    if (loading && loading.mode === mode) { loading.cbs.push(cb); return; }
    loading = { mode: mode, cbs: [cb] };
    var s = document.createElement("script");
    s.src = root() + "javascripts/" + LITE[mode];
    s.async = true;
    s.onload = function () {
      var g = window[LITE_KEY[mode]];
      var pend = loading ? loading.cbs : [];
      loading = null;
      if (g) cached[key] = g;
      for (var i = 0; i < pend.length; i++) pend[i](g || null);
    };
    s.onerror = function () {
      var pend = loading ? loading.cbs : [];
      loading = null;
      for (var i = 0; i < pend.length; i++) pend[i](null);
    };
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------- 渲染 */

  function hostEl() { return document.getElementById(HOST); }

  function paintMaps() {
    var host = hostEl();
    if (!host) return;
    var chips = host.querySelectorAll("[data-map]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("is-on", chips[i].getAttribute("data-map") === S.map);
      chips[i].setAttribute("aria-pressed",
        chips[i].getAttribute("data-map") === S.map ? "true" : "false");
    }
  }

  function paintModes() {
    var host = hostEl();
    if (!host) return;
    var tabs = host.querySelectorAll("[data-mode]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-mode") === S.mode);
    }
  }

  function summary(data, mapKey) {
    var n = 0, done = 0;
    for (var qid in data.tasks) {
      if (data.tasks[qid][3].indexOf(mapKey) < 0) continue;
      n++;
      if (stateOf(qid) === "done") done++;
    }
    return { n: n, done: done, left: n - done };
  }

  function renderList() {
    var host = hostEl();
    if (!host) return;
    var body = host.querySelector(".tk-home-ops__body");
    if (!body) return;
    if (!S.map) {
      body.textContent = "";
      body.appendChild(el("p", "tk-home-ops__hint",
        "上面选一张图 —— 这张图上还有哪些任务、各要几级，一屏看完。"));
      return;
    }

    var data = cached[liteCacheKey(S.mode)];
    if (!data) {
      body.textContent = "";
      body.appendChild(el("p", "tk-home-ops__hint", "正在载入任务清单…"));
      return;
    }

    var rows = [];
    for (var qid in data.tasks) {
      var t = data.tasks[qid];
      if (t[3].indexOf(S.map) < 0) continue;
      rows.push({ qid: qid, name: t[0], trader: t[1], level: t[2], st: stateOf(qid) });
    }
    /* 未完成在前、等级低的在前：读者打开首页时想知道的是「接下来干什么」，
       不是「我干完了什么」。已完成的不删，折叠在下面 —— 它们也是这张图的进度。 */
    rows.sort(function (a, b) {
      var ad = a.st === "done" ? 1 : 0, bd = b.st === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      if (a.level !== b.level) return (a.level || 0) - (b.level || 0);
      return a.name.localeCompare(b.name, "zh");
    });

    var st = summary(data, S.map);
    body.textContent = "";

    var head = el("div", "tk-home-ops__sum");
    var strong = el("strong", null, "本图 " + st.n + " 个任务");
    head.appendChild(strong);
    head.appendChild(document.createTextNode(
      st.done ? "　·　已完成 " + st.done + "　·　还剩 " + st.left
              : "　·　还没有勾选记录，全部按未完成算"));
    var all = el("a", "tk-home-ops__all", "完整清单（目标 · 前置 · 点位）→");
    all.href = root() + "ops/?map=" + encodeURIComponent(S.map);
    head.appendChild(all);
    body.appendChild(head);

    var ul = el("ul", "tk-home-ops__list");
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (shown >= LIMIT) break;
      shown++;
      ul.appendChild(row(r));
    }
    body.appendChild(ul);

    if (rows.length > LIMIT) {
      body.appendChild(el("p", "tk-home-ops__hint",
        "还有 " + (rows.length - LIMIT) + " 个没列出来 —— 带筛选、目标逐条和地图点位的完整清单在作战台。"));
    }
  }

  function row(r) {
    var li = el("li", "tk-home-ops__row" + (r.st === "done" ? " is-done" : ""));
    li.setAttribute("data-qid", r.qid);

    var lab = el("label", "tk-home-ops__check");
    var p = prog();
    if (p) {
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = r.st === "done";
      cb.setAttribute("aria-label", "标记「" + r.name + "」为已完成");
      cb.addEventListener("change", function () {
        setState(r.qid, cb.checked, r.trader);
        li.classList.toggle("is-done", cb.checked);
        repaintCounts();
      });
      lab.appendChild(cb);
    } else {
      lab.classList.add("is-off");
      lab.textContent = r.st === "done" ? "✓" : "";
    }

    var name = el("span", "tk-home-ops__name", r.name);
    var meta = el("span", "tk-home-ops__meta",
      traderName(r.trader) + (r.level ? " · " + r.level + " 级" : ""));
    var a = el("a", "tk-home-ops__go", "↗");
    a.href = root() + "ops/?map=" + encodeURIComponent(S.map) + "&sel=" + encodeURIComponent(r.qid);
    a.title = "在完整作战台打开：地图、目标、前置";
    a.setAttribute("aria-label", "在完整作战台打开「" + r.name + "」");

    li.appendChild(lab);
    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(a);
    return li;
  }

  function repaintCounts() {
    var host = hostEl();
    var key = liteCacheKey(S.mode);
    if (!host || !cached[key] || !S.map) return;
    var st = summary(cached[key], S.map);
    var head = host.querySelector(".tk-home-ops__sum strong");
    if (head) head.textContent = "本图 " + st.n + " 个任务";
    var tail = host.querySelector(".tk-home-ops__sum");
    if (tail && tail.lastChild && tail.lastChild.nodeType === 3) {
      tail.lastChild.textContent = st.done
        ? "　·　已完成 " + st.done + "　·　还剩 " + st.left
        : "　·　还没有勾选记录，全部按未完成算";
    }
  }

  function select(mapKey, scroll) {
    S.map = mapKey;
    paintMaps();
    var host = hostEl();
    var body = host && host.querySelector(".tk-home-ops__body");
    if (body) body.setAttribute("data-loading", "1");
    if (cached[liteCacheKey(S.mode)]) { renderList(); }
    else {
      renderList();
      loadLite(S.mode, function (data) {
        if (!data) {
          var b = host && host.querySelector(".tk-home-ops__body");
          if (b) {
            b.textContent = "";
            b.appendChild(el("p", "tk-home-ops__hint",
              "任务清单没加载成功（网络或脚本被拦截）—— 完整作战台在 /ops/。"));
          }
          return;
        }
        renderList();
      });
    }
    if (body) body.removeAttribute("data-loading");
    if (scroll && body && body.scrollIntoView) {
      body.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function setMode(mode) {
    if (!LITE[mode] || mode === S.mode) return;
    S.mode = mode;
    var p = prog();
    if (p && p.mode() !== mode && p.setMode) p.setMode(mode);
    paintModes();
    if (S.map) select(S.map, false);
  }

  /* ------------------------------------------------------------- 挂载 */

  function boot() {
    var host = hostEl();
    if (!host || host.dataset.tkMounted === "1") return;
    host.dataset.tkMounted = "1";
    S.mode = currentMode();

    host.addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest("[data-map]") : null;
      if (chip) {
        /* ⚠️ **必须 stopPropagation**（2026-10-21 实测）：
           胶囊本身是 <a href="ops/?map=…">（无脚本时的兜底），而站点开了
           navigation.instant —— 主题在 document.body 上另有一个 click 订阅，
           直接 history.replaceState + pushState，**不看 defaultPrevented**。
           只 preventDefault 的话两个 handler 都会跑、主题赢：这一块从上线起
           就退化成「13 个跳转链接」，原地清单一次都没渲染出来过。 */
        e.preventDefault();
        e.stopPropagation();
        var k = chip.getAttribute("data-map");
        select(k === S.map ? "" : k, true);
        return;
      }
      var tab = e.target.closest ? e.target.closest("[data-mode]") : null;
      if (tab) {
        e.preventDefault();
        e.stopPropagation();
        setMode(tab.getAttribute("data-mode"));
      }
    });

    paintMaps();
    paintModes();

    /* ?map=customs 直接进这张图 —— 与地图胶囊的 href 同构，链接可分享。
       先选图再订阅：订阅回调里的 renderList 需要 S.map 已经有值。 */
    var fromUrl = mapFromUrl();
    if (fromUrl) {
      select(fromUrl, false);
      if (window.history && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.hash);
      }
    }

    /* 进度变了（别的标签页、或首页自己的勾选）→ 重画一次。
       注意 setTaskState 会同步 emit，这里只做「重画」不做「写」。 */
    if (prog()) prog().subscribe(function () { renderList(); });
  }

  function mapFromUrl() {
    var m = /[?&]map=([^&#]+)/.exec(location.search || "");
    if (!m) return "";
    var k = decodeURIComponent(m[1]);
    var chips = document.querySelectorAll("#" + HOST + " [data-map]");
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute("data-map") === k) return k;
    }
    return "";
  }

  /* 与站内其它按需脚本同一套入口：document$ 覆盖 instant 换页，
     DOMContentLoaded 覆盖首屏（两者顺序不定，靠 dataset.tkMounted 去重）。 */
  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(boot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
