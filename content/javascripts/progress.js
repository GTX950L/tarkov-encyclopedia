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

  var SCHEMA_VERSION = 4;

  function blankMode() {
    return { quests: {}, inhand: {}, items: {}, hideout: {}, level: 0 };
  }

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
        inhand: cleanMap(src.inhand),
        items: cleanMap(src.items),
        hideout: cleanMap(src.hideout),
        level: 0
      };
      /* 我的等级：只接受 1–99 的整数，其余当没填（0）。
         它不是「进度」而是「筛选条件」，所以单独存、不放进任何一条轨。 */
      var lv = parseInt(src.level, 10);
      mode.level = (isFinite(lv) && lv > 0 && lv < 100) ? lv : 0;
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

  var TRACKS = ["quests", "inhand", "items", "hideout"];
  var TRACK_LABEL = { quests: "已完成任务", inhand: "在手任务", items: "物品收集", hideout: "藏身处" };

  /* —— 藏身处清单的两把小工具（供看板与 API 共用） ——
     清单结构（来自 progress-manifest.js）：
       { name, en, layer, alias, levels: [ { level, time, stations:[{name,level}],
                                            skills:[{name,level}],
                                            items:[{name,count,fir}] } ] } */

  function topLevel(mod) {
    var lv = (mod && mod.levels) || [];
    var top = 0;
    for (var i = 0; i < lv.length; i++) {
      var n = parseInt(lv[i].level, 10);
      if (isFinite(n) && n > top) top = n;
    }
    return top;
  }

  /* 当前等级 s 的「下一级」需求；已到顶返回 null。 */
  function nextLevelReq(mod, cur) {
    var want = (parseInt(cur, 10) || 0) + 1;
    var lv = (mod && mod.levels) || [];
    for (var i = 0; i < lv.length; i++) {
      if (parseInt(lv[i].level, 10) === want) {
        return { level: want, time: lv[i].time, stations: lv[i].stations || [],
                 skills: lv[i].skills || [], items: lv[i].items || [] };
      }
    }
    return null;
  }

  var api = {
    MODES: MODES,
    MODE_LABEL: MODE_LABEL,
    TRACKS: TRACKS,
    TRACK_LABEL: TRACK_LABEL,
    KEY: STORE_KEY,

    mode: function () { return load().mode; },

    /* 整块读一次（归一化后的副本）。给看板用 —— 逐个字段调 API 会对
       localStorage 做几百次读取，那是纯浪费。返回值是副本，改它不影响存储。 */
    data: function () { return load(); },

    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return;
      var d = load();
      if (d.mode === m) return;
      d.mode = m;
      save(d);
      emit();
    },

    /* —— 任务轨 —— */

    count: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].quests).length;
    },

    /* —— 在手轨（我当前接在身上的任务） ——
       这条轨是「按前置树反推」的**输入**：玩家记得现在手上有哪些任务，
       但不会记得过去完成了哪些（515 个任务，靠回忆不成立）。
       值同样记商人 slug，便于按商人汇总。 */
    inHand: function (qid, m) {
      if (!qid) return false;
      var d = load();
      return !!d.modes[m || d.mode].inhand[qid];
    },

    setInHand: function (qid, on, trader, m) {
      if (!qid) return;
      var d = load();
      var key = m || d.mode;
      if (on) d.modes[key].inhand[qid] = trader || "";
      else delete d.modes[key].inhand[qid];
      save(d);
      emit();
    },

    countInHand: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].inhand).length;
    },

    /* 任务的三态：""（未标记）/ "inhand"（在手）/ "done"（已完成）。
       三态是**互斥**的 —— 写一处必清另一处，否则同一个任务会同时出现在
       「在手」和「已完成」两个列表里。 */
    taskState: function (qid, m) {
      if (!qid) return "";
      var d = load();
      var md = d.modes[m || d.mode];
      if (md.quests[qid]) return "done";
      if (md.inhand[qid]) return "inhand";
      return "";
    },

    setTaskState: function (qid, state, trader, m) {
      if (!qid) return;
      var d = load();
      var key = m || d.mode;
      delete d.modes[key].quests[qid];
      delete d.modes[key].inhand[qid];
      if (state === "done") d.modes[key].quests[qid] = trader || "";
      else if (state === "inhand") d.modes[key].inhand[qid] = trader || "";
      save(d);
      emit();
    },

    /* —— 我的等级（筛选条件，不属任何一条轨） —— */
    myLevel: function (m) {
      var d = load();
      return d.modes[m || d.mode].level || 0;
    },

    setMyLevel: function (n) {
      var d = load();
      var v = parseInt(n, 10);
      d.modes[d.mode].level = (isFinite(v) && v > 0 && v < 100) ? v : 0;
      save(d);
      emit();
    },

    /* —— 物品轨（数量） ——
       v3 起「已囤」是件数而不是两态：清单里 79 项有 75 项合计数量 ≥10，
       两态表达不了「还差多少」。值存数字字符串，0/缺失都表示没囤。 */

    itemCount: function (name, m) {
      if (!name) return 0;
      var d = load();
      var v = parseInt(d.modes[m || d.mode].items[name], 10);
      return (isFinite(v) && v > 0) ? v : 0;
    },

    setItemCount: function (name, n) {
      if (!name) return;
      var d = load();
      var v = parseInt(n, 10);
      if (!isFinite(v) || v <= 0) delete d.modes[d.mode].items[name];
      else d.modes[d.mode].items[name] = String(v);
      save(d);
      emit();
    },

    addItem: function (name, delta) {
      api.setItemCount(name, api.itemCount(name) + (parseInt(delta, 10) || 0));
    },

    /* 「已囤」的物品条数（有值的键数）—— 用于「已囤 N 件」这类绝对数。 */
    countItems: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].items).length;
    },

    /* 达标数：已囤件数 ≥ 该物品的需求。需求由调用方传入（来自清单）。 */
    countItemsMet: function (reqs, m) {
      var d = load();
      var src = d.modes[m || d.mode].items;
      var n = 0;
      for (var i = 0; i < reqs.length; i++) {
        var got = parseInt(src[reqs[i].name], 10);
        if (isFinite(got) && got >= reqs[i].need) n++;
      }
      return n;
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

    /* 已建满：模块等级 == 该模块在清单里的最高等级。
       26 个模块**全部**有确定的上限（来自数据端点），所以这个数不会有
       「上限未知的模块永远计不进」的问题 —— 分母 26 是确定的。 */
    maxedCount: function (list, m) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var top = topLevel(list[i]);
        if (top && api.hideoutLevel(list[i].name, m) >= top) n++;
      }
      return n;
    },

    /* 可升下一级：还有下一级，且该级的材料已囤齐（件数全部达标）。
       前置设施与技能不在这个判据里 —— 那两样本站只做提示，不做判定：
       技能等级与设施等级都是「游戏内状态」，本站没有数据可依据。 */
    readyCount: function (list, m) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var nxt = nextLevelReq(list[i], api.hideoutLevel(list[i].name, m));
        if (!nxt) continue;
        if (nxt.items.length === 0) continue;
        if (api.countItemsMet(nxt.items, m) === nxt.items.length) n++;
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
       「把我这份并进去」，覆盖会静默毁掉另一台上的进度。
       三条轨的合并规则**不一样**（见内层注释）：任务取并集，件数与等级取较大值。 */
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
            if (!id) continue;
            var v = srcMap[id];
            var sv = (v === undefined || v === null) ? "" : String(v);

            if (track === "quests" || track === "inhand") {
              /* 任务类：取并集、保留已有 —— 值只是「哪个商人」，没有大小之分 */
              if (d.modes[m][track][id]) continue;
              d.modes[m][track][id] = sv;
              added++;
              continue;
            }

            /* 物品件数与藏身处等级：**取较大值**。
               这两条轨的键值都是「进度」，而导入的用途是「换设备同步」——
               保留较旧的小值会让读者以为导入失败（实测踩到：本地 2 级 +
               导入 3 级，结果仍是 2 级）。 */
            var inc = parseInt(sv, 10);
            if (!isFinite(inc) || inc <= 0) continue;
            var cur = parseInt(d.modes[m][track][id], 10);
            if (isFinite(cur) && cur >= inc) continue;
            d.modes[m][track][id] = String(inc);
            added++;
          }
        }
      }
      if (src.mode && MODES.indexOf(src.mode) >= 0) d.mode = src.mode;
      save(d);
      emit();
      return {
        ok: true,
        msg: "已并入 " + added + " 条进度（任务取并集、件数与等级取较大值，都不会覆盖已有）。"
      };
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

  /* --------------------------------------------------------------------------
     任务标题上的状态控件

     用**三态下拉**而不是勾选框：「在手」是按前置树反推已完成的**输入**，
     只有两态时读者没法表达「我正拿着它」。三态也顺带解决了
     「我不记得之前完成了什么」—— 那本来就不该由读者回答。
     -------------------------------------------------------------------------- */

  var STATE_OPTS = [["", "未标记"], ["inhand", "在手"], ["done", "已完成"]];

  function makeStateSelect(qid, trader, cls) {
    var sel = document.createElement("select");
    sel.className = cls || "tk-qstate";
    sel.setAttribute("data-focus-key", "q:" + qid);
    sel.setAttribute("aria-label", "该任务在「我的进度」里的状态");
    for (var i = 0; i < STATE_OPTS.length; i++) {
      var o = document.createElement("option");
      o.value = STATE_OPTS[i][0];
      o.textContent = STATE_OPTS[i][1];
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () {
      api.setTaskState(qid, sel.value, trader);
    });
    return sel;
  }

  function syncHead(h, qid) {
    var st = api.taskState(qid);
    h.classList.toggle("tk-qdone", st === "done");
    h.classList.toggle("tk-qinhand", st === "inhand");
    var sel = h.querySelector(".tk-qstate");
    if (sel && sel.value !== st) sel.value = st;
  }

  function decorate() {
    var heads = document.querySelectorAll("h3[data-qid]");
    if (!heads.length) return;

    var trader = traderSlug();
    var byAnchor = {};
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var qid = qidOf(h);
      if (!qid) continue;
      if (h.id) byAnchor[h.id] = qid;
      if (!h.querySelector(".tk-qstate")) {
        /* 插在标题**文字之前**（不是末尾）—— 状态控件要在行首才读得像清单 */
        h.insertBefore(makeStateSelect(qid, trader), h.firstChild);
      }
      syncHead(h, qid);
    }

    /* 页首索引表同步点亮（锚点判读见 hashId 的说明）。 */
    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var qid2 = byAnchor[hashId(a)];
      if (!qid2) continue;
      var row = a.closest("tr") || a;
      var st2 = api.taskState(qid2);
      row.classList.toggle("tk-qdone", st2 === "done");
      row.classList.toggle("tk-qinhand", st2 === "inhand");
    }
  }

  /* --------------------------------------------------------------------------
     进度模式切换条（只出现在任务页与总览页）
     -------------------------------------------------------------------------- */

  /* 站点根 URL：从**本脚本自己的 src** 反推。
     比从页头 logo 反推更直接，也不受页面层级影响 —— 站点部署在子路径下
     （本站是 /tarkov-encyclopedia/），硬编码绝对路径会 404。 */
  function siteRoot() {
    var s = document.querySelector('script[src*="progress.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function boardUrl() { return siteRoot() + "quests/progress/"; }

  /* 某个任务的明细直达链接。`link` 形如 "prapor#q07"，由生成器写入前置树。 */
  function questUrl(link) {
    if (!link) return "";
    var parts = String(link).split("#");
    if (parts.length !== 2) return "";
    return siteRoot() + "quests/" + parts[0] + "/#" + parts[1];
  }

  function onBoardPage() { return !!document.getElementById("tk-progress-board"); }

  function barStat() {
    var total = pageTotal();
    if (total) {
      var done = 0;
      var heads = document.querySelectorAll("h3[data-qid]");
      for (var i = 0; i < heads.length; i++) {
        if (api.taskState(qidOf(heads[i])) === "done") done++;
      }
      return "本页已标记 " + done + " / " + total;
    }
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    /* 措辞必须与看板区分开：这里只数**手动标记**的完成数，
       而看板的「已完成」还含前置树推断出来的那些。写「全部 / 已完成」
       会让两处数字对不上，读者会以为有一个是错的。 */
    return "已标记 " + api.count() + (mf && mf.total ? " / " + mf.total : "");
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

  function fmtNum(n) {
    var v = parseInt(n, 10);
    if (!isFinite(v)) return "0";
    return v.toLocaleString("en-US");
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

  /* 「已囤 N 件」的数量控件：− / 输入框 / ＋。
     返回 { el, set }，set 只在**输入框没有焦点时**写值 —— 否则用户正在敲
     「12」会被同步回写成「1」，这是局部刷新最容易踩的一个坑。 */
  function countCtl(name, need) {
    var box = el("span", "tk-cnt");
    var minus = el("button", "tk-cnt__btn", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "减少「" + name + "」的已囤数量");
    var inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.className = "tk-cnt__in";
    inp.setAttribute("inputmode", "numeric");
    inp.setAttribute("aria-label", "「" + name + "」的已囤数量");
    var plus = el("button", "tk-cnt__btn", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "增加「" + name + "」的已囤数量");

    minus.addEventListener("click", function () {
      api.setItemCount(name, api.itemCount(name) - 1);
    });
    plus.addEventListener("click", function () {
      api.setItemCount(name, api.itemCount(name) + 1);
    });
    /* 用 change 而不是 input：数字框逐键触发会把「12」先写成 1、再写成 12，
       中间那次写入还会把「已达标」闪一下。change 在失焦 / 回车时提交。 */
    inp.addEventListener("change", function () { api.setItemCount(name, inp.value); });
    inp.addEventListener("blur", function () {
      var v = api.itemCount(name);
      inp.value = v > 0 ? String(v) : "";
    });

    box.appendChild(minus);
    box.appendChild(inp);
    box.appendChild(plus);
    if (need !== undefined) {
      var nd = el("em", "tk-cnt__need", "需 " + fmtNum(need));
      box.appendChild(nd);
    }
    return {
      el: box,
      set: function (v) { if (document.activeElement !== inp) inp.value = v > 0 ? String(v) : ""; }
    };
  }

  /* 某个物品的「已囤件数」输入控件，各看板共享同一份存储 —— 所以两处都能改。 */
  function rowMet(cls, on) { return on ? cls + " tk-met" : cls; }

  /* --------------------------------------------------------------------------
     任务前置树：懒加载

     这张树约 48 KB，只有本页用得到；放进 extra_javascript 会让全部 118 个
     页面都多背一份。所以在需要时动态注入 <script>，加载完再渲染。
     -------------------------------------------------------------------------- */

  var graphState = 0;   // 0 未开始 / 1 加载中 / 2 就绪 / -1 失败
  var graphCbs = [];

  function graphUrl() { return siteRoot() + "javascripts/quests-graph.js"; }

  function flushGraph() {
    var cbs = graphCbs;
    graphCbs = [];
    for (var i = 0; i < cbs.length; i++) cbs[i](window.TARKOV_QUEST_GRAPH || null);
  }

  function loadGraph(cb) {
    if (window.TARKOV_QUEST_GRAPH) { cb(window.TARKOV_QUEST_GRAPH); return; }
    if (graphState === -1) { cb(null); return; }
    graphCbs.push(cb);
    if (graphState === 1) return;
    graphState = 1;
    var url = graphUrl();
    if (!url) { graphState = -1; flushGraph(); return; }
    var sc = document.createElement("script");
    sc.src = url;
    sc.onload = function () {
      graphState = window.TARKOV_QUEST_GRAPH ? 2 : -1;
      flushGraph();
    };
    sc.onerror = function () { graphState = -1; flushGraph(); };
    document.head.appendChild(sc);
  }

  /* --------------------------------------------------------------------------
     按前置树反推

     输入：显式已完成 + 在手 + 我的等级 → 输出 { done, inferred, avail, locked }

     规则与理由：
       · **在手任务的前置一律视为已完成** —— 这是本功能的核心。能被接到的任务，
         其前置必然已经满足；读者不需要回忆过去做过什么。
       · **显式标记的「已完成」同样向上传播**：既然 X 做完了，X 的前置自然也做完了。
       · 只沿标记为 c（complete）的边传播；a（active）/ f（failed）不参与判定 ——
         本站没有「失败」这条状态，无法评估，只在提示里展示。
       · **可接 = 未完成 + 未在手 + 等级够 + 所有 complete 前置都已完成。**
         等级是必需的输入：515 个任务里有 296 个没有前置，不按等级筛就没法用。
     -------------------------------------------------------------------------- */

  function computeTree(graph, explicit, inhand, myLevel) {
    var tasks = (graph && graph.tasks) || {};
    var done = {}, inferred = {}, id, seen = {}, stack = [];

    for (id in explicit) if (explicit[id] !== undefined) { done[id] = true; stack.push(id); }
    for (id in inhand) if (inhand[id] !== undefined) stack.push(id);

    /* 传递闭包：栈 + seen 防环。数据里理论上无环，但重抓过的数据不可信 ——
       没有这个 seen，一条环就会把页面卡死。 */
    while (stack.length) {
      var cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = true;
      var node = tasks[cur];
      if (!node) continue;
      var pre = node[3] || [];
      for (var i = 0; i < pre.length; i++) {
        var pid = pre[i][0];
        if ((pre[i][1] || "").indexOf("c") < 0) continue;
        if (done[pid] || !tasks[pid]) continue;
        done[pid] = true;
        inferred[pid] = true;
        stack.push(pid);
      }
    }

    var avail = [], locked = [], stat = {};
    for (id in tasks) {
      if (done[id] || inhand[id] !== undefined) continue;
      var n = tasks[id];
      var pre2 = n[3] || [], need = 0, have = 0, ok = true;
      for (var j = 0; j < pre2.length; j++) {
        if ((pre2[j][1] || "").indexOf("c") < 0) continue;
        need++;
        if (done[pre2[j][0]]) have++;
        else ok = false;
      }
      stat[id] = [have, need];
      if (ok && (myLevel <= 0 || (n[2] || 0) <= myLevel)) avail.push(id);
      else locked.push(id);
    }
    return { done: done, inferred: inferred, avail: avail, locked: locked, stat: stat };
  }

  /* 重画一段 DOM 前后保住键盘焦点。
     —— 关键：重画会用新节点替换掉正在聚焦的 <select>/<input>，焦点会掉到
     BODY（实测）。给每个可聚焦元素打 data-focus-key，重画后按同一个 key 还回去。 */
  function keepFocus(scope, fn) {
    var a = document.activeElement;
    var key = (a && a.getAttribute) ? a.getAttribute("data-focus-key") : null;
    var pos = null;
    if (key && a.selectionStart !== undefined) {
      try { pos = [a.selectionStart, a.selectionEnd]; } catch (e) { pos = null; }
    }
    fn();
    if (!key) return;
    var nxt = scope.querySelector('[data-focus-key="' + key + '"]');
    if (!nxt) return;
    nxt.focus();
    if (pos && nxt.setSelectionRange) {
      try { nxt.setSelectionRange(pos[0], pos[1]); } catch (e) { /* 数字框不支持，忽略 */ }
    }
  }

  /* --------------------------------------------------------------------------
     看板一：任务进度

     交互模型（本版的核心改动）：
       旧：让读者逐个回忆「我完成过哪些」—— 515 个任务，靠回忆不成立。
       新：读者只填**两件当下就知道的事** —— 我的等级、我手上现在有哪些任务；
           其余由前置树推出来。找不到的任务用搜索框，而不是在长列表里翻。
     -------------------------------------------------------------------------- */

  var QROW_CAP = 80;   // 单个分区最多画多少行，超出用搜索找

  function traderNameMap() {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var out = {};
    var list = (mf && mf.traders) || [];
    for (var i = 0; i < list.length; i++) out[list[i].slug] = list[i].name;
    return out;
  }

  function renderQuestBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var totalAll = (mf && mf.total) || 0;

    host.textContent = "";

    var refs = {};
    var cards = el("div", "tk-board__sum");
    var defs = [["在手", "inhand"], ["已完成", "done"],
                ["其中由前置推断", "inferred"], ["可接（够等级）", "avail"]];
    for (var ci = 0; ci < defs.length; ci++) {
      var card = el("div", "tk-board__sumitem");
      card.appendChild(el("em", null, defs[ci][0]));
      var b = el("b", null, "—");
      card.appendChild(b);
      refs[defs[ci][0]] = b;
      cards.appendChild(card);
    }
    host.appendChild(cards);

    var bar = el("div", "tk-board__filter");
    var lvWrap = el("label", "tk-board__lv");
    lvWrap.appendChild(el("span", null, "我的等级"));
    var lvIn = document.createElement("input");
    lvIn.type = "number";
    lvIn.min = "1";
    lvIn.max = "99";
    lvIn.className = "tk-cnt__in";
    lvIn.setAttribute("data-focus-key", "level");
    lvIn.setAttribute("aria-label", "我的当前等级");
    var lv0 = api.myLevel();
    lvIn.value = lv0 > 0 ? String(lv0) : "";
    lvIn.addEventListener("change", function () { api.setMyLevel(lvIn.value); });
    lvWrap.appendChild(lvIn);
    bar.appendChild(lvWrap);

    var search = document.createElement("input");
    search.type = "search";
    search.className = "tk-board__search";
    search.placeholder = "搜任务名 / 商人 · 515 个任务都在这里";
    search.setAttribute("data-focus-key", "qsearch");
    search.setAttribute("aria-label", "搜索任务");
    bar.appendChild(search);

    var cnt = el("span", "tk-board__filtercount");
    bar.appendChild(cnt);
    host.appendChild(bar);

    host.appendChild(el("p", "tk-board__hint",
      "只填你**现在就知道**的两件事：等级、以及任务列表里手上正拿着的那些。"
      + "它们的**前置会被自动算作已完成**，你不用回忆过去做过什么。"));

    var body = el("div", "tk-board__qbody");
    host.appendChild(body);

    var summary = el("div", "tk-board__chips");
    host.appendChild(summary);

    function questRow(qid, node, extra, names) {
      var row = el("div", "tk-qrow");
      row.appendChild(makeStateSelect(qid, node[1], "tk-qstate tk-qstate--row"));
      var url = questUrl(node[5]);
      var nm;
      if (url) {
        nm = el("a", "tk-qrow__name", node[0]);
        nm.href = url;
      } else {
        nm = el("span", "tk-qrow__name", node[0]);
      }
      row.appendChild(nm);
      var meta = names[node[1]] || node[1] || "—";
      if (node[4].indexOf("k") >= 0) meta += " · Kappa";
      row.appendChild(el("em", "tk-qrow__meta", meta));
      row.appendChild(el("em", "tk-qrow__lv", "Lv" + node[2]));
      if (extra) row.appendChild(el("em", "tk-qrow__extra", extra));
      var st = api.taskState(qid);
      if (st === "inhand") row.className += " st-inhand";
      if (st === "done") row.className += " st-done";
      return row;
    }

    function section(title, sub, cls) {
      var sec = el("div", "tk-qsec " + (cls || ""));
      var head = el("div", "tk-qsec__head");
      head.appendChild(el("b", null, title));
      head.appendChild(el("em", null, sub));
      sec.appendChild(head);
      var box = el("div", "tk-qsec__body");
      sec.appendChild(box);
      return { sec: sec, head: head, box: box, sub: head.querySelector("em") };
    }

    function sync() {
      var graph = window.TARKOV_QUEST_GRAPH || null;

      if (!graph) {
        body.textContent = "";
        body.appendChild(graphState === 1 ? el("p", "tk-board__loading", "正在载入任务前置树…")
                                         : notReady("任务前置树"));
        cnt.textContent = "";
        for (var k in refs) refs[k].textContent = "—";
        summary.textContent = "";
        return;
      }

      var names = traderNameMap();
      /* 一次读整块数据（而不是逐条调 API 触发 515 次 localStorage 读取） */
      var md = api.data();
      var explicit = md.modes[md.mode].quests || {};
      var inhand = md.modes[md.mode].inhand || {};
      var tree = computeTree(graph, explicit, inhand, api.myLevel());

      var inIds = Object.keys(inhand), doneIds = Object.keys(tree.done);
      var q = (search.value || "").trim().toLowerCase();

      refs["在手"].textContent = String(inIds.length);
      refs["已完成"].textContent = String(doneIds.length);
      refs["其中由前置推断"].textContent = String(Object.keys(tree.inferred).length);
      refs["可接（够等级）"].textContent = String(tree.avail.length);

      keepFocus(body, function () {
        body.textContent = "";

        if (q) {
          /* 搜索态：把 515 个任务平铺成一张结果表 —— 这才是「数量太多」的解法 */
          var hits = [];
          for (var id in graph.tasks) {
            var n = graph.tasks[id];
            var hay = (n[0] + " " + (names[n[1]] || n[1] || "") + " " + n[2]).toLowerCase();
            if (hay.indexOf(q) >= 0) hits.push(id);
          }
          hits.sort(function (a, b) {
            return (graph.tasks[a][2] - graph.tasks[b][2]) ||
                   (graph.tasks[a][0] < graph.tasks[b][0] ? -1 : 1);
          });
          var sec0 = section("搜索结果", hits.length + " 个任务匹配「" + search.value.trim() + "」", "");
          var shown = 0;
          for (var i = 0; i < hits.length && shown < 100; i++, shown++) {
            sec0.box.appendChild(questRow(hits[i], graph.tasks[hits[i]], null, names));
          }
          if (hits.length > shown) {
            sec0.box.appendChild(el("p", "tk-board__note",
              "只显示了前 " + shown + " 个，继续输入以缩小范围。"));
          }
          body.appendChild(sec0.sec);
          cnt.textContent = "匹配 " + hits.length + " / " + graph.total;
          return;
        }

        /* 在手 */
        var s1 = section("在手", inIds.length + " 个", "tk-qsec--inhand");
        if (!inIds.length) {
          s1.box.appendChild(el("p", "tk-board__empty",
            "还没标记任何任务。在下面「可接」里点任务的「状态」列选「在手」，"
            + "或者用搜索框找任务。"));
        } else {
          inIds.sort();
          for (var a1 = 0; a1 < inIds.length && a1 < QROW_CAP; a1++) {
            var nd = graph.tasks[inIds[a1]];
            if (nd) s1.box.appendChild(questRow(inIds[a1], nd, null, names));
          }
        }
        body.appendChild(s1.sec);

        /* 可接 */
        tree.avail.sort(function (a, b) {
          return (graph.tasks[a][2] - graph.tasks[b][2]) ||
                 (graph.tasks[a][0] < graph.tasks[b][0] ? -1 : 1);
        });
        var s2 = section("可接（前置已满足、等级够）", tree.avail.length + " 个", "tk-qsec--avail");
        if (!tree.avail.length) {
          s2.box.appendChild(el("p", "tk-board__empty",
            api.myLevel() > 0 ? "没有可接的任务了 —— 检查等级或前置。"
                              : "先在上面填「我的等级」，否则无法筛出可接的任务。"));
        } else {
          for (var a2 = 0; a2 < tree.avail.length && a2 < QROW_CAP; a2++) {
            var q2 = tree.avail[a2];
            var st2 = tree.stat[q2] || [0, 0];
            s2.box.appendChild(questRow(q2, graph.tasks[q2],
              st2[1] ? "前置 " + st2[0] + "/" + st2[1] : "无前置", names));
          }
          if (tree.avail.length > QROW_CAP) {
            s2.box.appendChild(el("p", "tk-board__note",
              "只显示了前 " + QROW_CAP + " 个（按等级升序），其余用搜索框找。"));
          }
        }
        body.appendChild(s2.sec);

        /* 已完成 */
        var s3 = section("已完成", doneIds.length + " 个（含 " +
          Object.keys(tree.inferred).length + " 个由前置推断）", "tk-qsec--done");
        if (!doneIds.length) {
          s3.box.appendChild(el("p", "tk-board__empty", "还没有已完成的任务。"));
        } else {
          doneIds.sort(function (a, b) {
            return (graph.tasks[a][2] - graph.tasks[b][2]) ||
                   (graph.tasks[a][0] < graph.tasks[b][0] ? -1 : 1);
          });
          for (var a3 = 0; a3 < doneIds.length && a3 < QROW_CAP; a3++) {
            var q3 = doneIds[a3];
            s3.box.appendChild(questRow(q3, graph.tasks[q3],
              tree.inferred[q3] ? "推断" : "手动", names));
          }
          if (doneIds.length > QROW_CAP) {
            s3.box.appendChild(el("p", "tk-board__note",
              "只显示了前 " + QROW_CAP + " 个，其余用搜索框找。"));
          }
        }
        body.appendChild(s3.sec);

        /* 计数放在这个回调**里面**：放在外面会被后面的「按商人汇总」
           那段覆盖掉（`return` 只退出回调、不退出外层的 sync）——
           实测过：搜索时计数一直显示「共 515 个任务」。 */
        cnt.textContent = "共 " + totalAll + " 个任务";
      });

      /* 按商人汇总：一目了然「哪个商人还没做完」 */
      var chips = el("div", "tk-board__chiprow");
      var mf2 = window.TARKOV_PROGRESS_MANIFEST;
      var tlist = (mf2 && mf2.traders) || [];
      var byTrader = {};
      for (var t2 = 0; t2 < tlist.length; t2++) byTrader[tlist[t2].slug] = 0;
      for (var d2 = 0; d2 < doneIds.length; d2++) {
        var nd2 = graph.tasks[doneIds[d2]];
        if (!nd2) continue;
        if (byTrader[nd2[1]] !== undefined) byTrader[nd2[1]]++;
      }
      for (var t3 = 0; t3 < tlist.length; t3++) {
        var chip = el("span", "tk-chip");
        chip.appendChild(el("i", null, tlist[t3].name));
        chip.appendChild(el("b", null, byTrader[tlist[t3].slug] + "/" + tlist[t3].count));
        chips.appendChild(chip);
      }
      summary.textContent = "";
      summary.appendChild(chips);
    }

    search.addEventListener("input", function () { sync(); });
    host.__tkSync = sync;

    if (window.TARKOV_QUEST_GRAPH) sync();
    else {
      body.appendChild(el("p", "tk-board__loading", "正在载入任务前置树…"));
      loadGraph(function () { sync(); });
    }
  }

  /* --------------------------------------------------------------------------
     看板二：物品收集（数量式）

     清单口径与[任务图鉴总览](../quests/index.md) 的「物品需求反查」表**同一份**
     （被 ≥3 个任务需要的物品，按任务名去重）—— 数据出自同一个生成器、行数由
     生成器对账，两处不会给出两个数。
     「需 N」是**跨任务合计**，不是单次需求 —— 这一句来自清单里的 note 字段，
     不在前端另写一份，免得两处措辞漂移。
     -------------------------------------------------------------------------- */

  function renderItemBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var items = (mf && mf.items) || { total: 0, list: [] };
    var list = items.list || [];

    host.textContent = "";

    if (!list.length) {
      host.appendChild(notReady("物品清单"));
      return;
    }

    var refs = {};
    var cards = el("div", "tk-board__sum");
    var defs = [
      ["已达标", "met"], ["已囤种类", "kinds"], ["已囤件数", "held"],
      ["清单物品", String(items.total || list.length)]
    ];
    for (var ci = 0; ci < defs.length; ci++) {
      var card = el("div", "tk-board__sumitem");
      card.appendChild(el("em", null, defs[ci][0]));
      var bEl = el("b", null, defs[ci][1]);
      card.appendChild(bEl);
      refs[defs[ci][0]] = bEl;
      cards.appendChild(card);
    }
    host.appendChild(cards);

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
    onlyUndone.appendChild(document.createTextNode("只看未达标"));
    bar.appendChild(onlyUndone);

    var count = el("span", "tk-board__filtercount");
    bar.appendChild(count);
    host.appendChild(bar);

    var tbody = el("tbody");
    var rows = [];

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var tr = el("tr");
      var tdCtl = el("td", "tk-board__pick");
      var ctl = countCtl(it.name, it.qty);
      tdCtl.appendChild(ctl.el);
      tr.appendChild(tdCtl);
      tr.appendChild(el("td", null, it.name));
      tr.appendChild(el("td", "tk-board__num", String(it.tasks)));
      tr.appendChild(el("td", "tk-board__num", fmtNum(it.qty)));
      tr.appendChild(el("td", "tk-board__who", it.traders || "—"));
      rows.push({ tr: tr, ctl: ctl, it: it });
      tbody.appendChild(tr);
    }

    host.appendChild(wrapTable(["已囤 / 需", "物品", "任务数", "合计数量", "涉及商人"], tbody));
    host.appendChild(el("p", "tk-board__note", (items.note || "")
      + " 达标 = 已囤件数 ≥ 合计数量。"));

    function apply() {
      var q = (input.value || "").trim().toLowerCase();
      var only = cb.checked;
      var shown = 0, met = 0, kinds = 0, held = 0;
      for (var r = 0; r < rows.length; r++) {
        var v = api.itemCount(rows[r].it.name);
        var ok2 = v >= rows[r].it.qty;
        if (ok2) met++;
        if (v > 0) { kinds++; held += v; }
        rows[r].ctl.set(v);
        rows[r].tr.className = ok2 ? "tk-met" : "";
        var hay = (rows[r].it.name + " " + (rows[r].it.traders || "")).toLowerCase();
        var hit = (!q || hay.indexOf(q) >= 0) && (!only || !ok2);
        rows[r].tr.hidden = !hit;
        if (hit) shown++;
      }
      count.textContent = "显示 " + shown + " / " + rows.length;
      refs["已达标"].textContent = met + " / " + rows.length;
      refs["已囤种类"].textContent = String(kinds);
      refs["已囤件数"].textContent = fmtNum(held);
    }

    input.addEventListener("input", apply);
    cb.addEventListener("change", apply);
    host.__tkSync = apply;
    apply();
  }

  /* --------------------------------------------------------------------------
     看板三：藏身处（模块等级 + 下一级材料）

     模块清单与逐级材料来自 progress-manifest.js 的 hideout 段，而该段直接读
     scripts/data/hideout.json（由 gen_hideout.py 从官方数据端点抓取）。
     前端不自己算任何材料 —— 这里只做「显示需求 + 记已囤 + 判是否齐」。
     -------------------------------------------------------------------------- */

  function renderHideoutBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var hut = (mf && mf.hideout) || { total: 0, list: [] };
    var list = hut.list || [];

    host.textContent = "";

    if (!list.length) {
      host.appendChild(notReady("藏身处清单"));
      return;
    }

    var refs = {};
    var cards = el("div", "tk-board__sum");
    var defs = [["已建造", "built"], ["已建满", "maxed"], ["可升下一级", "ready"],
                ["模块总数", String(hut.total || list.length)]];
    for (var ci = 0; ci < defs.length; ci++) {
      var card = el("div", "tk-board__sumitem");
      card.appendChild(el("em", null, defs[ci][0]));
      var bEl = el("b", null, defs[ci][1]);
      card.appendChild(bEl);
      refs[defs[ci][0]] = bEl;
      cards.appendChild(card);
    }
    host.appendChild(cards);

    var bar = el("div", "tk-board__filter");
    var only = document.createElement("label");
    only.className = "tk-board__check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    only.appendChild(cb);
    only.appendChild(document.createTextNode("只看材料未齐的模块"));
    bar.appendChild(only);
    var count = el("span", "tk-board__filtercount");
    bar.appendChild(count);
    host.appendChild(bar);

    var cells = [];

    var groups = [];
    var byLayer = {};
    for (var i = 0; i < list.length; i++) {
      var key = list[i].layer || "（不按产出分层）";
      if (!byLayer[key]) { byLayer[key] = []; groups.push(key); }
      byLayer[key].push(list[i]);
    }

    for (var gi = 0; gi < groups.length; gi++) {
      var sec = el("div", "tk-hut");
      var head = el("div", "tk-hut__head");
      head.appendChild(el("b", null, groups[gi]));
      head.appendChild(el("em", null, byLayer[groups[gi]].length + " 个模块"));
      sec.appendChild(head);
      var grid = el("div", "tk-hut__grid");
      for (var k = 0; k < byLayer[groups[gi]].length; k++) {
        var built = hideoutCard(byLayer[groups[gi]][k]);
        cells.push(built);
        grid.appendChild(built.el);
      }
      sec.appendChild(grid);
      host.appendChild(sec);
    }

    var note = el("p", "tk-board__note",
      (hut.note || "")
      + " 「可升下一级」只看**材料**够不够 —— 前置设施与技能属游戏内状态，本站没有数据可判定，只做提示。");
    host.appendChild(note);

    function apply() {
      var onlyOn = cb.checked;
      var builtN = 0, maxedN = 0, readyN = 0, shown = 0;
      for (var r = 0; r < cells.length; r++) {
        var st = cells[r].sync();
        if (st.built) builtN++;
        if (st.maxed) maxedN++;
        if (st.ready) readyN++;
        var show = !onlyOn || !st.ready;
        cells[r].el.hidden = !show;
        if (show) shown++;
      }
      count.textContent = "显示 " + shown + " / " + cells.length;
      refs["已建造"].textContent = builtN + " / " + cells.length;
      refs["已建满"].textContent = String(maxedN);
      refs["可升下一级"].textContent = String(readyN);
    }

    cb.addEventListener("change", apply);
    host.__tkSync = apply;
    apply();
  }

  /* 单个模块卡：等级选择 + 下一级需求（材料 / 前置 / 技能 / 施工时长）。
     返回 { el, sync } —— sync 重读存储并刷新自身，**不重建 DOM**。
     重建会替换掉 <select> 与输入框，键盘焦点就丢了（实测：改完等级后
     activeElement 变成 BODY）。 */
  function hideoutCard(mod) {
    var cell = el("div", "tk-hut__cell");

    var name = el("div", "tk-hut__name");
    name.appendChild(document.createTextNode(mod.name));
    name.appendChild(el("code", "tk-hut__en", mod.en));
    if (mod.alias) {
      var al = el("span", "tk-hut__alias", "曾称 " + mod.alias);
      al.title = "本页旧写法，搜索旧名也能命中";
      name.appendChild(al);
    }
    cell.appendChild(name);

    var lvl = el("div", "tk-hut__lvl");
    var sel = document.createElement("select");
    sel.className = "tk-hut__sel";
    sel.setAttribute("aria-label", mod.name + " 当前等级");
    var top = topLevel(mod);
    var o0 = document.createElement("option");
    o0.value = "0";
    o0.textContent = "未建造";
    sel.appendChild(o0);
    for (var v = 1; v <= top; v++) {
      var o = document.createElement("option");
      o.value = String(v);
      o.textContent = v + " 级" + (v === top ? "（满）" : "");
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () { api.setHideoutLevel(mod.name, sel.value); });
    lvl.appendChild(sel);
    lvl.appendChild(el("em", "tk-hut__cap", "上限 " + top + " 级"));
    cell.appendChild(lvl);

    var next = el("div", "tk-hut__next");
    cell.appendChild(next);

    /* 材料行：每行独立保存引用，sync 时只改值，不重建 */
    var matRows = [];
    var nextHead = el("div", "tk-hut__nexthead");
    var deps = el("div", "tk-hut__deps");
    var matWrap = el("div", "tk-hut__mat");
    next.appendChild(nextHead);
    next.appendChild(deps);
    next.appendChild(matWrap);

    var doneBadge = el("div", "tk-hut__done", "已建满");
    cell.appendChild(doneBadge);

    function buildNext(req) {
      nextHead.textContent = "下一级：" + req.level + " 级 ｜ 施工 " + fmtTime(req.time);
      var d = [];
      for (var i = 0; i < req.stations.length; i++) {
        if (req.stations[i].name) d.push("前置 " + req.stations[i].name + " " + req.stations[i].level + " 级");
      }
      for (var j = 0; j < req.skills.length; j++) {
        if (req.skills[j].name) d.push("技能 " + req.skills[j].name + " " + req.skills[j].level + " 级");
      }
      deps.textContent = d.length ? d.join(" · ") : "";
      deps.hidden = !d.length;

      matWrap.textContent = "";
      matRows = [];
      if (!req.items.length) {
        matWrap.appendChild(el("p", "tk-hut__nomat", "该等级无材料要求。"));
        return;
      }
      for (var k = 0; k < req.items.length; k++) {
        var it = req.items[k];
        var row = el("div", "tk-hut__mrow");
        var nm = el("span", "tk-hut__mname", it.name);
        if (it.fir) {
          var fir = el("span", "tk-hut__fir", "战局中");
          fir.title = "必须自己带出，跳蚤市场买的不算数";
          nm.appendChild(fir);
        }
        row.appendChild(nm);
        var ctl = countCtl(it.name, it.count);
        row.appendChild(ctl.el);
        matWrap.appendChild(row);
        matRows.push({ row: row, ctl: ctl, need: it.count, name: it.name });
      }
    }

    function sync() {
      var level = api.hideoutLevel(mod.name);
      if (sel.value !== String(level)) sel.value = String(level);
      var maxed = level >= top && top > 0;
      var req = nextLevelReq(mod, level);

      /* 只在「需要的目标级」变化时重建需求块 */
      var stamp = maxed ? "max" : (req ? String(req.level) : "none");
      if (cell.getAttribute("data-stamp") !== stamp) {
        cell.setAttribute("data-stamp", stamp);
        if (maxed) {
          next.hidden = true;
          doneBadge.hidden = false;
        } else if (!req) {
          next.hidden = true;
          doneBadge.hidden = true;
        } else {
          next.hidden = false;
          doneBadge.hidden = true;
          buildNext(req);
        }
      }

      var allMet = true;
      for (var i = 0; i < matRows.length; i++) {
        var got = api.itemCount(matRows[i].name);
        matRows[i].ctl.set(got);
        var ok2 = got >= matRows[i].need;
        if (!ok2) allMet = false;
        matRows[i].row.className = ok2 ? "tk-hut__mrow tk-met" : "tk-hut__mrow";
      }
      if (!matRows.length) allMet = false;

      cell.className = "tk-hut__cell"
        + (level > 0 ? " is-built" : "")
        + (maxed ? " is-maxed" : "")
        + (!maxed && matRows.length && allMet ? " is-ready" : "");

      return { built: level > 0, maxed: maxed, ready: !maxed && matRows.length > 0 && allMet };
    }

    return { el: cell, sync: sync };
  }

  function fmtTime(sec) {
    var s = parseInt(sec, 10) || 0;
    if (!s) return "即时";
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    var out = [];
    if (d) out.push(d + " 天");
    if (h) out.push(h + " 小时");
    if (m && !d) out.push(m + " 分钟");
    return out.join(" ");
  }

  /* 清单没加载出来时给一句提示，而不是留一片空白。
     站点在搜索索引上已有同样的做法（见 search-ready.js），话术保持一致。 */
  function notReady(what) {
    return el("p", "tk-board__notready",
      what + "没有载入成功（可能是网络中断或脚本被拦截）。"
      + "本页其余说明不受影响；刷新一次通常即可恢复。");
  }

  /* --------------------------------------------------------------------------
     看板四：进度管理（导出 / 导入 / 分轨清空）
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
      + "导入时**任务取并集、件数与等级取较大值**，都不会覆盖已有进度。"));
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
      list[i].fn(list[i].host);
    }
  }

  /* 勾选或换模式后，只重画状态，不重挂节点。
     三个看板里**都有输入控件**（数量框 / 等级下拉 / 搜索框），所以一律走各自的
     __tkSync 局部刷新 —— 整块重画会替换掉正在聚焦的元素（实测：改完藏身处
     等级后焦点掉到 BODY；任务看板重画还会把搜索词与光标位置一起丢掉）。 */
  function repaint() {
    var heads = document.querySelectorAll("h3[data-qid]");
    for (var i = 0; i < heads.length; i++) syncHead(heads[i], qidOf(heads[i]));

    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var h = document.getElementById(hashId(a));
      var qid = h ? qidOf(h) : "";
      if (!qid) continue;
      var row = a.closest("tr") || a;
      var st = api.taskState(qid);
      row.classList.toggle("tk-qdone", st === "done");
      row.classList.toggle("tk-qinhand", st === "inhand");
    }

    var bar = document.querySelector(".tk-pgbar");
    if (bar) syncBar(bar);

    var qb = document.getElementById("tk-progress-board");
    if (qb && qb.__tkSync) qb.__tkSync();

    var ib = document.getElementById("tk-board-items");
    if (ib && ib.__tkSync) ib.__tkSync();

    var hb = document.getElementById("tk-board-hideout");
    if (hb && hb.__tkSync) hb.__tkSync();
  }

  api.subscribe(repaint);

  /* 多标签页同步：别的标签页写了同一个键时，本页的显示会陈旧。
     只重画显示，不重新读入（数据本身没丢）。 */
  window.addEventListener("storage", function (e) {
    if (e && e.key && e.key !== STORE_KEY) return;
    repaint();
  });

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
