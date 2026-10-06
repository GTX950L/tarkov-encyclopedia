/* ==========================================================================
   任务进度追踪（纯本地，无账号、无后端）
   --------------------------------------------------------------------------
   要解决的问题：站内第九篇是 515 个任务的逐条明细，读完之后**读者自己记不住
   做到哪了** ——「这个任务我交了没有」每局都要靠回忆，而回忆会出错。
   游戏内不提供任务完成度的整体视图，这大概是站内唯一一处「读者不得不自己记」
   的地方。本脚本把这件事变成「读的时候顺手勾一下」：任务明细标题左侧出现一个
   方框，点一下即标记完成；页首那张索引表同步点亮；另有总览页按商人汇总。

   三条边界（决定了这个功能**是**什么、**不是**什么）：

     1. **不登录、不联网。** 数据只写在本机浏览器的 localStorage 里。换浏览器、
        换设备、清缓存 = 进度归零 —— 这一点必须在总览页写明，不能让人以为
        存在账号上，那是另一种承诺。
     2. **不猜、不推断。** 只记录读者亲手勾的那一下。不做「前置都完成了，这个
        大概也完成了」这类推断：任务有失败条件、有分支、有跨商人的进度计数器
        （见任务图鉴总览对「进度计数」字段的说明），推断出来的进度比没有进度
        更危险 —— 读者会据此跳过准备。
     3. **不因为勾选改动正文。** 要求 / 奖励 / 前置一个字都不动，勾选只影响
        视觉状态。进度是可丢失的本地数据，正文是站点资产，两者不能混。

   存储结构（localStorage 键 `tarkov_progress_v1`）：
     {
       v: 1,
       mode: "pvp" | "pve" | "season",
       modes: { <模式>: { q: { <任务数据 id>: <商人 slug> } } }
     }

   两个刻意的选择：
     · **值存商人 slug**，于是「按商人汇总」不需要另建一张 id→商人 的表；
     · **键用数据端点的 id**（24 位十六进制）而不是页面锚点 `q01` —— `q01` 在
       11 个商人页里各出现一次，拿它当键会让「Prapor 的 q01」与「Skier 的
       q01」互相覆盖。id 由生成器写在 `data-qid` 上。

   接入方式与站内其他脚本一致：优先挂在 Material 的 `document$` 上，
   这样 `navigation.instant` 换页后也会重新执行。
   ========================================================================== */

(function () {
  "use strict";

  var STORE_KEY = "tarkov_progress_v1";
  var MODES = ["pvp", "pve", "season"];
  var MODE_LABEL = { pvp: "PVP", pve: "PVE", season: "赛季" };
  var EVT = "tarkov:progress";

  /* 是否为「任务图鉴」那一页的商人 slug。目录页 `quests/progress` 不是商人，
     必须排除 —— 否则它会被当成一个叫 progress 的商人在总览里多出一行。 */
  var NON_TRADER = { progress: 1, index: 1 };

  /* --------------------------------------------------------------------------
     存储层

     结构（v2）：
       {
         v: 2,
         mode: "pvp" | "pve" | "season",
         modes: { <模式>: { quests: {}, items: {}, hideout: {} } }
       }

     三条轨各自独立、共用同一个模式维度：
       · quests   —— 值 = 商人 slug（用于按商人汇总）
       · items    —— 值 = "1"（只需要「囤了没有」两态）
       · hideout  —— 值 = 等级数字的字符串；0/缺失都表示未建造
     键：任务用数据端点 id；物品与藏身处用**中文名**（这两份派生数据里没有 id，
     见总览页「数据与隐私」对名称变动的说明）。
     -------------------------------------------------------------------------- */

  var SCHEMA_VERSION = 2;

  function blankMode() { return { quests: {}, items: {}, hideout: {} }; }

  function blankData() {
    return {
      v: SCHEMA_VERSION,
      mode: "pvp",
      modes: { pvp: blankMode(), pve: blankMode(), season: blankMode() }
    };
  }

  /* 逐键清洗。localStorage 里的东西是「外部输入」：可能被旧版本写过、可能被
     别的脚本塞过、也可能被手工改坏。整块 JSON.parse 抛错会让整个功能静默失效，
     所以一律补齐而不是报错。 */
  function cleanMap(src) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (typeof k !== "string" || !k) continue;
      var v = src[k];
      out[k] = (v === undefined || v === null) ? "" : String(v);
    }
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return blankData(); }
    if (!raw) return blankData();

    var d = null;
    try { d = JSON.parse(raw); } catch (e) { return blankData(); }
    if (!d || typeof d !== "object") return blankData();

    var out = blankData();
    out.mode = MODES.indexOf(d.mode) >= 0 ? d.mode : "pvp";

    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      var src = (d.modes && d.modes[m]) || {};
      /* ⚠️ v1 → v2 迁移：v1 的任务进度存在 `q` 字段里（值同样是商人 slug），
         v2 改名 `quests` 并新增两条轨。不迁移的话，已经勾过的人升级当天
         进度会**凭空消失**。 */
      var quests = (src.quests && typeof src.quests === "object") ? src.quests : src.q;
      var mode = {
        quests: cleanMap(quests),
        items: cleanMap(src.items),
        hideout: cleanMap(src.hideout)
      };
      /* 藏身处等级：把明显非法的值（0、负数、非数字）在**读入时**就清掉，
         免得下游三处各自判断。 */
      var hk = Object.keys(mode.hideout);
      for (var j = 0; j < hk.length; j++) {
        var lv = parseInt(mode.hideout[hk[j]], 10);
        if (!isFinite(lv) || lv <= 0) delete mode.hideout[hk[j]];
        else mode.hideout[hk[j]] = String(lv);
      }
      out.modes[m] = mode;
    }
    return out;
  }

  function save(d) {
    /* 隐私模式下 localStorage 会抛 QuotaExceededError / SecurityError。
       勾选本身仍要工作（本次会话内有效），所以这里吞掉异常、不打断交互。 */
    try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* 忽略 */ }
  }

  function emit() {
    try { document.dispatchEvent(new Event(EVT)); } catch (e) { /* 忽略 */ }
  }

  /* 惰性迁移：load() 只把老结构**读成**新结构，不落盘（它被调用得很频繁，
     不该每次写存储）。若从不落盘，只读不点的读者会一直留着 v1 结构 ——
     功能上无害，但旧字段 `q` 会长期留在存储里，以后加轨时就容易踩到。
     所以进过「我的进度」相关页面时补一次写回，之后 v 相等就直接返回。 */
  function ensureMigrated() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var d = null;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== "object" || d.v === SCHEMA_VERSION) return;
    save(load());
  }

  /* --------------------------------------------------------------------------
     公开 API
     -------------------------------------------------------------------------- */

  var TRACKS = ["quests", "items", "hideout"];
  var TRACK_LABEL = { quests: "任务", items: "物品收集", hideout: "藏身处" };

  var api = {
    MODES: MODES,
    MODE_LABEL: MODE_LABEL,
    TRACKS: TRACKS,
    TRACK_LABEL: TRACK_LABEL,
    KEY: STORE_KEY,

    mode: function () { return load().mode; },

    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return;
      var d = load();
      if (d.mode === m) return;
      d.mode = m;
      save(d);
      emit();
    },

    /* —— 任务轨 —— */

    isDone: function (qid, m) {
      if (!qid) return false;
      var d = load();
      return !!d.modes[m || d.mode].quests[qid];
    },

    /* trader 由调用方给出（任务页从 URL 取）。留空也要记 —— 全局计数不能因为
       拿不到商人名就丢掉这一次勾选。 */
    set: function (qid, on, trader, m) {
      if (!qid) return;
      var d = load();
      var key = m || d.mode;
      if (on) d.modes[key].quests[qid] = trader || "";
      else delete d.modes[key].quests[qid];
      save(d);
      emit();
    },

    toggle: function (qid, trader) {
      var d = load();
      api.set(qid, !d.modes[d.mode].quests[qid], trader);
    },

    count: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].quests).length;
    },

    countTrader: function (slug, m) {
      var d = load();
      var q = d.modes[m || d.mode].quests;
      var n = 0;
      var keys = Object.keys(q);
      for (var i = 0; i < keys.length; i++) {
        if (q[keys[i]] === slug) n++;
      }
      return n;
    },

    /* —— 物品轨（两态） —— */

    hasItem: function (name, m) {
      if (!name) return false;
      var d = load();
      return !!d.modes[m || d.mode].items[name];
    },

    toggleItem: function (name) {
      if (!name) return;
      var d = load();
      if (d.modes[d.mode].items[name]) delete d.modes[d.mode].items[name];
      else d.modes[d.mode].items[name] = "1";
      save(d);
      emit();
    },

    countItems: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].items).length;
    },

    /* —— 藏身处轨（等级） —— */

    hideoutLevel: function (name, m) {
      if (!name) return 0;
      var d = load();
      var v = parseInt(d.modes[m || d.mode].hideout[name], 10);
      return (isFinite(v) && v > 0) ? v : 0;
    },

    setHideoutLevel: function (name, lv) {
      if (!name) return;
      var d = load();
      var n = parseInt(lv, 10);
      /* 0 与「未建造」是同一件事 —— 存 0 会让「已建造数」的统计多一次判断，
         直接从表里删掉更干净。 */
      if (!isFinite(n) || n <= 0) delete d.modes[d.mode].hideout[name];
      else d.modes[d.mode].hideout[name] = String(n);
      save(d);
      emit();
    },

    builtCount: function (m) {
      var d = load();
      var h = d.modes[m || d.mode].hideout;
      var n = 0;
      var keys = Object.keys(h);
      for (var i = 0; i < keys.length; i++) {
        if (parseInt(h[keys[i]], 10) > 0) n++;
      }
      return n;
    },

    /* —— 通用 —— */

    /* track 省略 = 清空该模式的三条轨 */
    clear: function (track, m) {
      var d = load();
      var key = m || d.mode;
      if (TRACKS.indexOf(track) >= 0) d.modes[key][track] = {};
      else d.modes[key] = blankMode();
      save(d);
      emit();
    },

    exportText: function () { return JSON.stringify(load(), null, 2); },

    /* 导入：只接受本功能自己导出的结构。合并不是覆盖 —— 读者的直觉是
       「把我这份并进去」，覆盖会静默毁掉另一台上的进度。 */
    importText: function (text) {
      var src = null;
      try { src = JSON.parse(text); } catch (e) { return { ok: false, msg: "不是合法的 JSON 文件。" }; }
      if (!src || typeof src !== "object" || !src.modes) {
        return { ok: false, msg: "文件结构不对：不是本站导出的进度文件。" };
      }
      var d = load();
      var added = 0;
      for (var i = 0; i < MODES.length; i++) {
        var m = MODES[i];
        var sm = src.modes[m] || {};
        for (var t = 0; t < TRACKS.length; t++) {
          var track = TRACKS[t];
          /* 兼容 v1 文件：旧文件的任务进度在 `q` 里 */
          var srcMap = (sm[track] && typeof sm[track] === "object") ? sm[track]
                     : (track === "quests" && sm.q && typeof sm.q === "object") ? sm.q
                     : null;
          if (!srcMap) continue;
          var keys = Object.keys(srcMap);
          for (var k = 0; k < keys.length; k++) {
            var id = keys[k];
            if (!id || d.modes[m][track][id]) continue;
            var v = srcMap[id];
            d.modes[m][track][id] = (v === undefined || v === null) ? "" : String(v);
            added++;
          }
        }
      }
      if (src.mode && MODES.indexOf(src.mode) >= 0) d.mode = src.mode;
      save(d);
      emit();
      return { ok: true, msg: "已并入 " + added + " 条进度（同一条取并集，不覆盖）。" };
    },

    subscribe: function (fn) {
      document.addEventListener(EVT, fn);
      return function () { document.removeEventListener(EVT, fn); };
    }
  };


  window.TarkovProgress = api;

  /* --------------------------------------------------------------------------
     当前页上下文
     -------------------------------------------------------------------------- */

  /* 商人 slug 从 URL 末段取（目录式 URL：/quests/prapor/）。
     只在有 h3[data-qid] 的页面上调用，所以不必担心命中别的栏目。 */
  function traderSlug() {
    var p = String(location.pathname || "").replace(/index\.html$/, "");
    var m = p.match(/\/quests\/([a-z0-9-]+)\/?$/);
    var s = m ? m[1] : "";
    return NON_TRADER[s] ? "" : s;
  }

  function qidOf(h) { return h.getAttribute("data-qid") || ""; }

  /* 取链接指向的锚点 id。
     ⚠️ 这里**必须**用 `a.hash`，不能用 `getAttribute("href")` 去掉首字符 ——
     Material 的 instant 导航会把正文里的相对链接**规范化成绝对 URL**，
     于是源码里的 `href="#q01"` 在 DOM 里变成
     `http://host/quests/prapor/#q01`。用 href 前缀匹配（`[href^="#q"]`）
     会一条都选不中，`getAttribute("href").slice(1)` 会拿到一串 URL 去
     `getElementById`，结果恒为 null。这一条是实测踩到的，不是理论风险。 */
  function hashId(a) {
    var h = a.hash || "";
    return h.charAt(0) === "#" ? h.slice(1) : "";
  }

  /* 页首索引表里的任务链接（排除标题自带的 ¶ 永久链接）。 */
  function indexLinks() {
    var all = document.querySelectorAll(".md-content__inner a[href]");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (a.classList && a.classList.contains("headerlink")) continue;
      if (!hashId(a)) continue;
      out.push(a);
    }
    return out;
  }

  function pageTotal() { return document.querySelectorAll("h3[data-qid]").length; }

  /* --------------------------------------------------------------------------
     任务标题上的勾选框
     -------------------------------------------------------------------------- */

  function syncHead(h, qid) {
    var done = api.isDone(qid);
    var box = h.querySelector(".tk-qbox");
    h.classList.toggle("tk-qdone", done);
    if (box) box.setAttribute("aria-pressed", done ? "true" : "false");
  }

  function makeBox(h, qid) {
    var box = document.createElement("button");
    box.type = "button";
    box.className = "tk-qbox";
    box.setAttribute("aria-pressed", "false");
    box.setAttribute("aria-label", "标记该任务已完成");
    box.title = "标记为已完成 / 取消";
    box.innerHTML = '<span class="tk-qbox__mark" aria-hidden="true"></span>';
    box.addEventListener("click", function () {
      api.toggle(qid, traderSlug());
    });
    /* 插在标题**文字之前**（不是标题末尾）—— 勾选框要在行首才读得像清单，
       插在末尾会和任务名、与主题补的 ¶ 挤在一起。 */
    h.insertBefore(box, h.firstChild);
  }

  function decorate() {
    var heads = document.querySelectorAll("h3[data-qid]");
    if (!heads.length) return;

    var byAnchor = {};
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var qid = qidOf(h);
      if (!qid) continue;
      if (h.id) byAnchor[h.id] = qid;
      if (!h.querySelector(".tk-qbox")) makeBox(h, qid);
      syncHead(h, qid);
    }

    /* 页首索引表同步点亮（锚点判读见 hashId 的说明）。 */
    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var qid2 = byAnchor[hashId(a)];
      if (!qid2) continue;
      var row = a.closest("tr") || a;
      row.classList.toggle("tk-qdone", api.isDone(qid2));
    }
  }

  /* --------------------------------------------------------------------------
     进度模式切换条（只出现在任务页与总览页）
     -------------------------------------------------------------------------- */

  function boardUrl() {
    /* 站点根 URL 从页头的 logo 链接反推 —— 站点可能部署在子路径下
       （本站是 /tarkov-encyclopedia/），硬编码绝对路径会 404。 */
    var a = document.querySelector("a.md-header__button[href], .md-header a[href]");
    if (!a) return "";
    var href = String(a.getAttribute("href") || "");
    if (!href || href.charAt(0) === "#") return "";
    return href.replace(/[^/]*$/, "") + "quests/progress/";
  }

  function onBoardPage() { return !!document.getElementById("tk-progress-board"); }

  function barStat() {
    var total = pageTotal();
    if (total) {
      var done = 0;
      var heads = document.querySelectorAll("h3[data-qid]");
      for (var i = 0; i < heads.length; i++) {
        if (api.isDone(qidOf(heads[i]))) done++;
      }
      return "本页 " + done + " / " + total;
    }
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    return "全部 " + api.count() + (mf && mf.total ? " / " + mf.total : "");
  }

  function syncBar(bar) {
    var modes = bar.querySelectorAll(".tk-pgbar__mode");
    for (var i = 0; i < modes.length; i++) {
      var on = modes[i].getAttribute("data-mode") === api.mode();
      modes[i].classList.toggle("is-on", on);
      modes[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var stat = bar.querySelector(".tk-pgbar__stat");
    if (stat) stat.textContent = barStat();
  }

  function buildBar() {
    var bar = document.createElement("div");
    bar.className = "tk-pgbar";

    var lbl = document.createElement("span");
    lbl.className = "tk-pgbar__lbl";
    lbl.textContent = "进度模式";
    bar.appendChild(lbl);

    var group = document.createElement("div");
    group.className = "tk-pgbar__modes";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "选择要查看与记录的进度模式");
    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tk-pgbar__mode";
      b.setAttribute("data-mode", m);
      b.setAttribute("aria-pressed", "false");
      b.textContent = MODE_LABEL[m];
      b.addEventListener("click", function (e) {
        api.setMode(e.currentTarget.getAttribute("data-mode"));
      });
      group.appendChild(b);
    }
    bar.appendChild(group);

    var stat = document.createElement("span");
    stat.className = "tk-pgbar__stat";
    bar.appendChild(stat);

    var url = boardUrl();
    if (url && !onBoardPage()) {
      var link = document.createElement("a");
      link.className = "tk-pgbar__link";
      link.href = url;
      link.textContent = "进度总览";
      bar.appendChild(link);
    }

    var hint = document.createElement("span");
    hint.className = "tk-pgbar__hint";
    hint.textContent = "进度只存在本机浏览器";
    bar.appendChild(hint);

    syncBar(bar);
    return bar;
  }

  function mountBar() {
    var inner = document.querySelector(".md-content__inner");
    if (!inner || inner.querySelector(".tk-pgbar")) return;
    var bar = buildBar();
    /* 挂在 h1 之后：页面标题必须仍是正文第一行，控制条是附属信息。
       面包屑同理（它回答「我在哪一篇」），而它在脚本顺序上可能更晚插入 ——
       它自己会插到 .md-content__inner 的最前面，不受这里影响。 */
    var ref = inner.querySelector("h1") || inner.querySelector(".tk-crumb");
    if (ref) inner.insertBefore(bar, ref.nextSibling);
    else inner.insertBefore(bar, inner.firstChild);
  }

  /* --------------------------------------------------------------------------
     进度总览看板（`<div id="tk-progress-board">` 由 Markdown 提供挂载点）
     -------------------------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function pct(done, total) {
    if (!total) return "0%";
    return (Math.round(done / total * 1000) / 10) + "%";
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 立刻 revoke 在部分浏览器上会取消下载，延后一拍更稳。 */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* --------------------------------------------------------------------------
     看板公共件
     -------------------------------------------------------------------------- */

  function sumCards(cells) {
    var box = el("div", "tk-board__sum");
    for (var i = 0; i < cells.length; i++) {
      var item = el("div", "tk-board__sumitem");
      item.appendChild(el("em", null, cells[i][0]));
      item.appendChild(el("b", null, cells[i][1]));
      box.appendChild(item);
    }
    return box;
  }

  function rowWithBar(label, done, total, pctText) {
    var tr = el("tr");
    tr.appendChild(el("td", null, label));
    tr.appendChild(el("td", "tk-board__num", String(done)));
    tr.appendChild(el("td", "tk-board__num", String(total)));
    var td = el("td", "tk-board__bar");
    var track = el("span", "tk-board__track");
    var fill = el("span", "tk-board__fill");
    fill.style.width = total ? (done / total * 100) + "%" : "0%";
    track.appendChild(fill);
    td.appendChild(track);
    td.appendChild(el("em", null, pctText || pct(done, total)));
    tr.appendChild(td);
    return tr;
  }

  /* 套进 .md-typeset__table —— 全站唯一的表格横向滚动容器。
     主题只给**构建期**就存在的表格套这一层，运行时建的表不自己套，
     窄屏就会把整页撑宽（实测 390px 下 scrollWidth 从 369 涨到 441）。 */
  function wrapTable(headers, tbody) {
    var tbl = el("table", "tk-board__tbl");
    var thead = el("thead");
    var htr = el("tr");
    for (var i = 0; i < headers.length; i++) htr.appendChild(el("th", null, headers[i]));
    thead.appendChild(htr);
    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    var wrap = el("div", "md-typeset__table");
    wrap.appendChild(tbl);
    return wrap;
  }

  /* --------------------------------------------------------------------------
     看板一：任务进度
     -------------------------------------------------------------------------- */

  function renderQuestBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var traders = (mf && mf.traders) || [];
    var totalAll = (mf && mf.total) || 0;
    var doneAll = api.count();

    host.textContent = "";

    host.appendChild(sumCards([
      ["当前模式", MODE_LABEL[api.mode()]],
      ["已完成", String(doneAll)],
      ["任务总数", totalAll ? String(totalAll) : "—"],
      ["完成度", totalAll ? pct(doneAll, totalAll) : "—"]
    ]));

    if (!traders.length) return;

    var tbody = el("tbody");
    var grand = 0, gdone = 0;
    for (var t = 0; t < traders.length; t++) {
      var row = traders[t];
      var d = api.countTrader(row.slug);
      grand += row.count;
      gdone += d;
      tbody.appendChild(rowWithBar(row.name, d, row.count));
    }
    var ftr = rowWithBar("合计", gdone, grand);
    ftr.className = "tk-board__foot";
    tbody.appendChild(ftr);

    host.appendChild(wrapTable(["商人", "已完成", "任务数", "完成度"], tbody));
  }

  /* --------------------------------------------------------------------------
     看板二：物品收集

     清单口径与[任务图鉴总览](../quests/index.md) 的「物品需求反查」表**同一份**
     （被 ≥3 个任务需要的物品，按任务名去重）—— 数据出自同一个生成器、行数由
     生成器对账，两处不会给出两个数。
     -------------------------------------------------------------------------- */

  function renderItemBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var items = (mf && mf.items) || { total: 0, list: [] };
    var list = items.list || [];

    host.textContent = "";

    /* 汇总卡要随勾选实时变，所以**留引用**而不是走 sumCards：
       物品看板有筛选框，repaint() 只能调 apply() 局部刷新，
       整块重画会把输入焦点和已输入的筛选词一起丢掉。 */
    var cardTotal = list.length;
    var cards = el("div", "tk-board__sum");
    var refDone = null, refCover = null;
    var defs = [
      ["已囤", null],
      ["清单物品", String(items.total || cardTotal)],
      ["门槛", "≥" + (items.threshold || 3) + " 个任务"],
      ["覆盖", null]
    ];
    for (var ci = 0; ci < defs.length; ci++) {
      var card = el("div", "tk-board__sumitem");
      card.appendChild(el("em", null, defs[ci][0]));
      var bEl = el("b", null, defs[ci][1] === null ? "" : defs[ci][1]);
      card.appendChild(bEl);
      if (defs[ci][0] === "已囤") refDone = bEl;
      if (defs[ci][0] === "覆盖") refCover = bEl;
      cards.appendChild(card);
    }
    host.appendChild(cards);

    if (!list.length) return;

    var bar = el("div", "tk-board__filter");
    var input = document.createElement("input");
    input.type = "search";
    input.className = "tk-board__search";
    input.placeholder = "筛选物品名 / 商人名";
    input.setAttribute("aria-label", "筛选物品");
    bar.appendChild(input);

    var onlyUndone = document.createElement("label");
    onlyUndone.className = "tk-board__check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    onlyUndone.appendChild(cb);
    onlyUndone.appendChild(document.createTextNode("只看未囤"));
    bar.appendChild(onlyUndone);

    var count = el("span", "tk-board__filtercount");
    bar.appendChild(count);
    host.appendChild(bar);

    var tbody = el("tbody");
    var rows = [];

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var tr = el("tr");
      tr.setAttribute("data-name", it.name);
      tr.setAttribute("data-traders", it.traders || "");

      var tdBox = el("td", "tk-board__pick");
      var box = el("button", "tk-qbox");
      box.type = "button";
      box.setAttribute("aria-pressed", "false");
      box.setAttribute("aria-label", "标记该物品已囤");
      box.title = "标记为已囤 / 取消";
      box.appendChild(el("span", "tk-qbox__mark"));
      (function (name, btn, row) {
        btn.addEventListener("click", function () {
          api.toggleItem(name);
        });
      })(it.name, box, tr);
      tdBox.appendChild(box);
      tr.appendChild(tdBox);

      tr.appendChild(el("td", null, it.name));
      tr.appendChild(el("td", "tk-board__num", String(it.tasks)));
      tr.appendChild(el("td", "tk-board__num", String(it.qty)));
      tr.appendChild(el("td", "tk-board__who", it.traders || "—"));

      rows.push({ tr: tr, box: box, it: it });
      tbody.appendChild(tr);
    }

    host.appendChild(wrapTable(["已囤", "物品", "任务数", "合计数量", "涉及商人"], tbody));

    function apply() {
      var q = (input.value || "").trim().toLowerCase();
      var only = cb.checked;
      var shown = 0;
      for (var r = 0; r < rows.length; r++) {
        var done = api.hasItem(rows[r].it.name);
        var hay = (rows[r].it.name + " " + (rows[r].it.traders || "")).toLowerCase();
        var hit = (!q || hay.indexOf(q) >= 0) && (!only || !done);
        rows[r].tr.hidden = !hit;
        if (hit) shown++;
        rows[r].box.setAttribute("aria-pressed", done ? "true" : "false");
      }
      count.textContent = "显示 " + shown + " / " + rows.length;
      var tally = api.countItems();
      refDone.textContent = String(tally);
      refCover.textContent = cardTotal ? pct(tally, cardTotal) : "—";
    }

    input.addEventListener("input", apply);
    cb.addEventListener("change", apply);
    host.appendChild(el("p", "tk-board__note",
      "「任务数」是**有多少个任务需要它**，「合计数量」是这些任务要求的总件数。"
      + "数量大的通常值得提前囤，但上交类任务有「必须战局内找到」的限制 —— 跳蚤市场买的不算。"));
    apply();

    /* 勾选后只更新状态，不整块重画：重画会把筛选框的输入焦点丢掉。 */
    host.__tkApplyItems = apply;
  }

  /* --------------------------------------------------------------------------
     看板三：藏身处

     模块清单逐条来自[藏身处模块](../entries/hideout-modules.md)页的表格，
     由生成器对账。**等级上限只填该页明确写过的**；没写的一律按「未收录」标注，
     UI 上仍给 1–5 的输入范围（那是交互控件，不是数据声明）。
     -------------------------------------------------------------------------- */

  function HIDEOUT_SOFT_MAX() { return 5; }

  function renderHideoutBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var hut = (mf && mf.hideout) || { total: 0, list: [], layers: [] };
    var list = hut.list || [];

    host.textContent = "";

    host.appendChild(sumCards([
      ["已建造", String(api.builtCount())],
      ["模块总数", String(hut.total || list.length)],
      ["已满级", String(countMaxed(list))],
      ["建造进度", list.length ? pct(api.builtCount(), list.length) : "—"]
    ]));

    if (!list.length) return;

    var groups = [];
    var byLayer = {};
    for (var i = 0; i < list.length; i++) {
      var key = list[i].layer || "（本页未分层）";
      if (!byLayer[key]) { byLayer[key] = []; groups.push(key); }
      byLayer[key].push(list[i]);
    }
    /* 页面的层顺序照搬 §1；未分层的排最后。 */
    var order = (hut.layers || []).concat(["（本页未分层）"]);
    groups.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    for (var gi2 = 0; gi2 < groups.length; gi2++) {
      var layer = groups[gi2];
      var items = byLayer[layer];
      var sec = el("div", "tk-hut");
      var head = el("div", "tk-hut__head");
      head.appendChild(el("b", null, layer));
      head.appendChild(el("em", null, items.length + " 个模块"));
      sec.appendChild(head);

      var grid = el("div", "tk-hut__grid");
      for (var k = 0; k < items.length; k++) {
        grid.appendChild(hideoutCell(items[k]));
      }
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    host.appendChild(el("p", "tk-board__note",
      "等级上限只填了[藏身处模块](../entries/hideout-modules.md)页**明确写过**的模块；"
      + "标着「上限未收录」的那些，该页尚未取到可核的二级来源，这里只按 1–5 记录你的进度，"
      + "不代表游戏内的实际上限。"));
  }

  function countMaxed(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var mx = list[i].max;
      if (mx && api.hideoutLevel(list[i].name) >= mx) n++;
    }
    return n;
  }

  function hideoutCell(mod) {
    var lv = api.hideoutLevel(mod.name);
    var cell = el("div", "tk-hut__cell");
    cell.classList.toggle("is-built", lv > 0);

    var name = el("div", "tk-hut__name");
    name.appendChild(document.createTextNode(mod.name));
    if (mod.max) {
      var cap = el("span", "tk-hut__cap", "上限 " + mod.max);
      cap.title = "该页明确写过的等级上限";
      name.appendChild(cap);
    } else {
      var unknown = el("span", "tk-hut__cap tk-hut__cap--unknown", "上限未收录");
      unknown.title = "藏身处模块页未收录该模块的等级上限";
      name.appendChild(unknown);
    }
    cell.appendChild(name);

    var sel = document.createElement("select");
    sel.className = "tk-hut__sel";
    sel.setAttribute("aria-label", mod.name + " 当前等级");
    var ceiling = mod.max || HIDEOUT_SOFT_MAX();
    var o0 = document.createElement("option");
    o0.value = "0";
    o0.textContent = "未建造";
    sel.appendChild(o0);
    for (var v = 1; v <= ceiling; v++) {
      var o = document.createElement("option");
      o.value = String(v);
      o.textContent = v + " 级" + (mod.max && v === mod.max ? "（满级）" : "");
      sel.appendChild(o);
    }
    sel.value = String(lv > ceiling ? ceiling : lv);
    sel.addEventListener("change", function () {
      api.setHideoutLevel(mod.name, sel.value);
    });
    cell.appendChild(sel);

    return cell;
  }

  /* --------------------------------------------------------------------------
     看板四：进度管理（导出 / 导入 / 清空）
     -------------------------------------------------------------------------- */

  function renderOps(host) {
    host.textContent = "";

    var ops = el("div", "tk-board__ops");

    var btnExport = el("button", "tk-board__btn", "导出进度（JSON）");
    btnExport.type = "button";
    btnExport.addEventListener("click", function () {
      download("tarkov-progress-" + today() + ".json", api.exportText());
    });
    ops.appendChild(btnExport);

    var file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = api.importText(String(reader.result || ""));
        toast(host, res.msg, res.ok);
      };
      reader.readAsText(f);
      file.value = "";
    });
    ops.appendChild(file);

    var btnImport = el("button", "tk-board__btn", "导入进度");
    btnImport.type = "button";
    btnImport.addEventListener("click", function () { file.click(); });
    ops.appendChild(btnImport);

    for (var i = 0; i < TRACKS.length; i++) {
      (function (track) {
        var b = el("button", "tk-board__btn tk-board__btn--warn",
                   "清空" + TRACK_LABEL[track]);
        b.type = "button";
        b.addEventListener("click", function () {
          var msg = "确定清空「" + MODE_LABEL[api.mode()] + "」模式下的"
            + TRACK_LABEL[track] + "进度吗？\n\n"
            + "这个动作不可撤销（另外两条轨、以及其他两个模式的进度不受影响）。\n"
            + "建议先点「导出进度」留一份备份。";
          if (window.confirm(msg)) {
            api.clear(track);
            toast(host, "已清空「" + MODE_LABEL[api.mode()] + "」的" + TRACK_LABEL[track] + "进度。", true);
          }
        });
        ops.appendChild(b);
      })(TRACKS[i]);
    }

    host.appendChild(ops);
    host.appendChild(el("p", "tk-board__note",
      "导出文件含**三条轨、三个模式**的全部进度，是纯文本 JSON，不含任何身份信息；"
      + "导入取并集，不会覆盖已有的勾选。"));
  }

  function toast(host, msg, ok) {
    var t = host.querySelector(".tk-board__toast");
    if (!t) {
      t = el("div", "tk-board__toast");
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      host.appendChild(t);
    }
    t.textContent = msg || "";
    t.classList.toggle("is-bad", !ok);
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  var BOARDS = [
    ["tk-progress-board", renderQuestBoard],
    ["tk-board-items", renderItemBoard],
    ["tk-board-hideout", renderHideoutBoard],
    ["tk-board-ops", renderOps]
  ];

  function mounts() {
    var found = [];
    for (var i = 0; i < BOARDS.length; i++) {
      var host = document.getElementById(BOARDS[i][0]);
      if (host) found.push({ host: host, fn: BOARDS[i][1] });
    }
    return found;
  }

  function render() {
    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;

    var list = mounts();
    var hasQuests = !!document.querySelector("h3[data-qid]");
    if (!list.length && !hasQuests) return;   // 其余 100+ 个页面完全不介入

    ensureMigrated();

    /* 每次换页都要重挂：instant 导航会把 .md-content__inner 整块换掉，
       上一页的节点已经不在文档里了。 */
    mountBar();
    if (hasQuests) decorate();
    for (var i = 0; i < list.length; i++) {
      list[i].host.__tkRender = list[i].fn;
      list[i].fn(list[i].host);
    }
  }

  /* 勾选或换模式后，只重画状态，不重挂节点。
     看板重画的粒度要区别对待：物品看板有筛选框，整块重画会丢焦点，
     所以它在 renderItemBoard 里把 apply 挂在宿主上，这里只调它。 */
  function repaint() {
    var heads = document.querySelectorAll("h3[data-qid]");
    for (var i = 0; i < heads.length; i++) syncHead(heads[i], qidOf(heads[i]));

    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var h = document.getElementById(hashId(a));
      var qid = h ? qidOf(h) : "";
      if (!qid) continue;
      (a.closest("tr") || a).classList.toggle("tk-qdone", api.isDone(qid));
    }

    var bar = document.querySelector(".tk-pgbar");
    if (bar) syncBar(bar);

    var qb = document.getElementById("tk-progress-board");
    if (qb && qb.querySelector(".tk-board__tbl")) renderQuestBoard(qb);

    var ib = document.getElementById("tk-board-items");
    if (ib && ib.__tkApplyItems) ib.__tkApplyItems();

    var hb = document.getElementById("tk-board-hideout");
    if (hb && hb.querySelector(".tk-hut")) renderHideoutBoard(hb);
  }

  api.subscribe(repaint);

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
