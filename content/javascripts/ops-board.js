/* ============================================================================
   作战台 · /ops/
   --------------------------------------------------------------------------
   「以一局为单位」：选一张图 → 右栏自动变成这张图上的活 → 勾目标 → 定位 → 出击，
   全程零页面跳转。PC 优先（悬停即读 / 键盘流 / 可拖拽分栏）。

   为什么**不复用也不重写** map.js：
     · 中栏直接放一个 `<div id="tk-map" data-tk-hover-tip="1">`，由 map.js 挂载 ——
       矢量底图、图层、缩放拖拽、区域绘制、楼层面板全部现成，且 13 个地图页
       已经验证过；重写一遍只会得到一个更差的副本。
     · map.js 那边只加了两处**纯新增**的钩子（选中事件外抛 + 悬停浮条），
       都由 data-tk-hover-tip / 事件监听开关，**没有钩子时行为与之前完全一致**。

   数据：
     · 地图   —— maps-data-<key>.js（两种模式合并在一份，zone.m 标模式）
     · 任务   —— ops-index-<mode>.js（gen_ops_index.py 出，含 ms 多图数组）
     · 进度   —— TarkovProgress（与「我的进度」同一份账本，三轨）

   生成物：勿手改。
   ========================================================================== */
(function () {
  "use strict";

  var HOST = "tk-ops";
  var MAPS = [
    ["customs", "海关"], ["factory", "工厂"], ["ground-zero", "中心区"],
    ["reserve", "储备站"], ["shoreline", "海岸线"], ["woods", "森林"],
    ["lighthouse", "灯塔"], ["interchange", "立交桥"],
    ["streets-of-tarkov", "街区"], ["terminal", "终点站"],
    ["icebreaker", "破冰船"], ["the-lab", "实验室"], ["the-labyrinth", "迷宫"],
  ];
  /* PvE / 赛季 / PvP。赛季**没有独立数据源**（上游 /season/tasks 实测 404），
     共用 PvP 任务库、只把进度分轨 —— 如实标注。
     ⚠️ 提示里不写死条数（2026-10-21）：原写 500 / 504，实测 499 / 503，已过期。 */
  var MODES = [
    ["pve", "PvE", "PvE 剧情：独立任务库（含 PvE 独占票）"],
    ["season", "赛季 PvP", "赛季模式：任务库与 PvP 相同，进度独立分轨"],
    ["pvp", "PvP", "持久 PvP：标准任务库（与赛季共用）"],
  ];
  var COLS = ["name", "en", "trader", "level", "ms", "oids", "otxt", "nObj", "keys", "flags", "pr"];

  /* 「无地图」伪图（2026-10-21）：上游有 156 票没有 ms（枪匠系列、纯上交类），
     命中不了任何一张图 → 在作战台里根本列不出来（PvE 占 31%）。给它一个入口。 */
  var NOMAP = "__nomap";
  var MAP_KEYS = MAPS.map(function (m) { return m[0]; });
  var MODE_KEYS = MODES.map(function (m) { return m[0]; });
  var FILTERS = ["open", "ready", "done", "all", "inhand", "pinned", "ignored"];

  /* 文件名与导出名是两件事（2026-10-21 修）：赛季共用 ops-index-pvp.js、导出名也只有
     _PVP；原来直接拼 mode.toUpperCase() 取到全仓不存在的 _SEASON → 赛季三栏全空。 */
  function idxKey(mode) {
    return "TARKOV_OPS_INDEX_" + (mode === "season" ? "PVP" : mode.toUpperCase());
  }
  function idxFile(mode) {
    return "ops-index-" + (mode === "season" ? "pvp" : mode) + ".js";
  }

  var S = {
    mode: "pve",
    map: "customs",
    q: "",
    /* 2026-10-21 精简：filter 从 7 档收到 4 档（open/ready/done/all），
       inhand/pinned/ignored 收进「更多」——它们加起来只占实测量的 3%。
       scope 两档（仅本图/全站）直接删掉：规则改成「有搜索词就跨图」。 */
    filter: "open",      // open | ready | done | all | inhand | pinned | ignored
    selQ: null,
    selO: null,
    /* 键盘当前行用**任务 id** 而不是数组下标（2026-10-25）：
       下标在列表重建后指向别人 —— 标完一票它从「未完成」里消失、列表重算，
       下标 N 就落到原来第 N+1 票上。写「连续结算会跳票」的根因。 */
    rowQid: "",
    idx: null,           // 当前模式的 ops index
    /* 出击清单：按模式分账本存 localStorage（2026-10-25）。此前是会话级，
       刷新 / 换标签页 / 浏览器崩一次就没了 —— 而它本来就是「这两晚要打哪几票」，
       跨局跨小时。与进度账本仍是**两个键**，互不污染。 */
    plan: {},
    planUndo: null,      // 刚移出的清单项 {qid, name} —— 6 秒内可撤销
    nextAllFor: "",      // 详情卡「后续」展开到全部的票（换票自动收起）
    mapq: "",            // 左栏地图名过滤
    mapsAll: false,      // 地图清单是否全展开
    planAll: false,      // 出击清单是否全展开
    tasksOpen: true,     // 中栏任务清单是否展开
    tasksAll: false,     // 任务清单是否展开到全部（默认 20 行）
    lv: 0,               // 「我的等级」：0 = 不限，用于可接判定（存 localStorage）
    planOnly: false,     // 中栏只显示出击清单里的票
    notice: "",          // 一次性提示（非法 URL 参数 / 索引载入失败）
    idxError: false,     // 索引脚本没载入成功（≠「这张图真没任务」）
  };

  /* 当前已初始化的挂载点。**按节点身份判重**，不按「本脚本是否跑过」判重：
     navigation.instant 换页时 #tk-ops 是一份新节点、旧 DOM 已销毁，脚本却不会重跑。
     所以这里不能 return 后收工 —— 没有挂载点时静默退出，等 document$ 换页后再进来。 */
  var host = null;
  var globalBound = false;   // 文档级监听（键盘/进度订阅）只绑一次

  /* ---------------------------------------------------------------- 工具 */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function loadScript(src, key, cb) {
    if (key && window[key]) return cb(true);
    /* map.js 只注入一次：instant 换页回到 /ops/ 时重复执行 93 KB 既慢，又会把它
       自己的全局状态重置一遍。挂载由 remountMap() 负责，不靠重跑脚本。
       ⚠️ 必须 `setTimeout` 出栈再回调：map.js 的 siteRoot() 优先读 document.currentScript，
          同步回调时它读到的是**正在执行的 ops-board.js**，拼出来的地址是
          `.../javascripts/ops-board.jsjavascripts/maps-data-<图>.js`（实测 404）。 */
    if (src === "map.js" && window.TarkovMap) {
      return setTimeout(function () { cb(true); }, 0);
    }
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/" + src;
    s.onload = function () { cb(!!(key && window[key])); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }
  /* 站根路径：与 map.js 同一套推导（按**本脚本的 src** 反推）。
     ⚠️ 不能按 location.pathname 推 —— 那在 /ops/ 下会得到 "/ops/"，
        拼出来的 javascripts/xxx.js 变成 /ops/javascripts/xxx.js
        （实测 404，作战台整个空掉）。脚本 src 无论页面在多深的目录，
        都指向站内 javascripts/ 的绝对位置。 */
  function siteRoot() {
    var s = document.querySelector('script[src*="javascripts/ops-board.js"]');
    if (!s) return "./";
    try {
      return new URL(s.src, location.href).href.replace(/javascripts\/ops-board\.js.*$/, "");
    } catch (e) {
      return "./";
    }
  }

  function taskOf(qid) {
    var t = S.idx && S.idx.tasks ? S.idx.tasks[qid] : null;
    if (!t) return null;
    var o = {};
    for (var i = 0; i < COLS.length; i++) o[COLS[i]] = t[i];
    return o;
  }

  /* 这一票算不算在本图上。唯一口径（2026-10-21）：原来 4 处各写一遍，加「无地图」档漏一处就对不上。 */
  function inMap(t) {
    var ms = (t && t.ms) || [];
    return S.map === NOMAP ? !ms.length : ms.indexOf(S.map) >= 0;
  }

  /* ---- 地名别名索引（2026-10-18）----
     ⚠️ 必须按图分建并按图判「建过没有」（2026-10-21 修）：maps-data 懒加载，原来
        一次性缓存 → 只有首图进索引，切到别的图搜地名永远没有跳转条。 */
  var CALL_IDX = null;   // mapKey → [{names, x, y, cn}]
  var CALL_DONE = null;  // mapKey → true（这张图的 labels 已扫过）
  function calloutIndex(mapKey) {
    CALL_IDX = CALL_IDX || {};
    CALL_DONE = CALL_DONE || {};
    if (CALL_DONE[mapKey]) return CALL_IDX;
    var d = (window.TARKOV_MAPS || {})[mapKey];
    if (!d) return CALL_IDX;   /* 数据还没到，不标记「建过」，下次再试 */
    var labels = d.labels || [];
    var rec = [];
    for (var i = 0; i < labels.length; i++) {
      var lb = labels[i];
      var names = [];
      if (lb.en) names.push(lb.en);
      if (lb.cn) names.push(lb.cn);
      (lb.al || []).forEach(function (a) { names.push(a); });
      if (!names.length) continue;
      rec.push({ names: names, x: lb.x, y: lb.y, cn: lb.cn || lb.en });
    }
    CALL_IDX[mapKey] = rec;
    CALL_DONE[mapKey] = true;
    return CALL_IDX;
  }
  /* 搜地名：命中就返回该地标（含坐标，用来在图上飞过去） */
  function findCallout(q, mapKey) {
    var ql = (q || "").toLowerCase();
    if (!ql) return null;
    var rows = calloutIndex(mapKey)[mapKey] || [];
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < rows[i].names.length; j++) {
        if (String(rows[i].names[j]).toLowerCase().indexOf(ql) >= 0) return rows[i];
      }
    }
    return null;
  }

  /* ⚠️ **所有进度 API 都要显式传 S.mode**（2026-10-18 修）：
     不传时读的是「账本的当前模式」，而作战台左栏可以切到 PvE / 赛季 / PvP ——
     两者不一定一致。症状：日志同步把 73 条写进 **PvE 轨**，而作战台默认读
     **PvP 轨** → 右栏「已完成 0、进行中 0」，看着像同步没生效。
     手工勾选时两处恰好一致，所以这个 bug 一直没暴露。 */
  /* 五态（2026-10-18）：done / inhand / ignored / pinned / none。
     done / inhand 是互斥的主状态；ignored 与 done 互斥；pinned 与谁都并存。
     返回「主状态」，另用 isPinned() 单独问 —— 两者不是一个维度。 */
  function stateOf(qid) {
    var P = window.TarkovProgress;
    if (!P) return "none";
    try {
      if (P.isIgnored && P.isIgnored(qid, S.mode)) return "ignored";
      return P.taskState(qid, S.mode) || "none";
    } catch (e) { return "none"; }
  }
  function isPinned(qid) {
    var P = window.TarkovProgress;
    try { return !!(P && P.isPinned && P.isPinned(qid, S.mode)); } catch (e) { return false; }
  }
  /* 本地写入的「静默窗」（2026-10-25）。
     TarkovProgress 每次写入都会 emit，作战台订阅了它 → 触发 200 ms 节流的 paint()。
     不拦的话，setState 里做的局部刷新会立刻被整块重绘覆盖（左栏滚动、详情卡位置
     照样丢），等于白做。所以本地写入时开一个 420 ms 的窗（> 200 ms 节流窗口），
     窗内忽略**自己**这次 emit；跨标签页 / 进度页的外部变更仍照常整块重绘。 */
  var selfEditUntil = 0;
  function markSelfEdit() { selfEditUntil = Date.now() + 420; }

  /* 一票的状态变了之后只刷**受影响**的地方，不整块重建。 */
  function refreshAfterState(qid) {
    refreshRow(qid);
    var brief = document.getElementById("tk-ops-briefbar");
    if (brief) buildBriefBar(brief);
    var detail = document.getElementById("tk-ops-detail");
    if (detail && S.selQ === qid) renderDetail(detail, true);
    /* 当前筛选把它排除掉了 → 它本该从列表里消失。这时才重建列表。 */
    if (!rowStillVisible(qid)) relistTasks();
  }

  function setState(qid, v) {
    var P = window.TarkovProgress;
    if (!P) return;
    markSelfEdit();
    try {
      P.setTaskState(qid, v, undefined, S.mode);
      /* 状态与目标勾选必须一致（2026-10-18 修）：把任务标为「已完成」时一并
         勾满它的目标，否则行头会出现「已完成 · 0/8 目标」——两行字自相矛盾，
         读者没法判断到底做完了没有。标为未完成则清空目标，与进度看板
         alignObjectives 的口径一致（那里是展开时才自愈，这里当场对齐）。 */
      var t = taskOf(qid);
      if (t && P.alignObjectives) P.alignObjectives(qid, t.oids || [], v, S.mode);
    } catch (e) { /* 无进度模块时不阻断 */ }
    /* 局部刷新（2026-10-25）：原来一律 paint()，标一票就把左栏滚动、详情卡位置、
       键盘行全冲掉。换图 / 切模式才需要整块重建。 */
    refreshAfterState(qid);
  }
  function objDone(qid, oid) {
    var P = window.TarkovProgress;
    if (!P || !oid) return false;
    try { return !!P.objDone(qid, oid, S.mode); } catch (e) { return false; }
  }
  /* 已完成目标数（行头显示「3/8 目标」）。setObj 与渲染共用同一口径。 */
  function metCount(t, qid) {
    var ids = (t && t.oids) || [];
    return ids.filter(function (x) { return objDone(qid, x); }).length;
  }
  function setObj(qid, oid, v) {
    var P = window.TarkovProgress;
    if (!P) return;
    markSelfEdit();
    try { P.setObjective(qid, oid, v, S.mode); } catch (e) { return; }
    var t = taskOf(qid);
    var ids = (t && t.oids) || [];
    var met = metCount(t, qid);
    if (ids.length && met === ids.length) P.setTaskState(qid, "done", undefined, S.mode);
    else if (met > 0) P.setTaskState(qid, "inhand", undefined, S.mode);
    /* 勾一个目标就整页重绘，是「勾到第 5 个突然跳回卡片顶部」的原因（2026-10-25） */
    refreshAfterState(qid);
  }

  /* ---------------------------------------------------------- 可接判定 */
  /* 一个任务「现在能不能接」只由两件事决定：等级够不够、必须完成的前置做完没有。
     其余条件（商人声望、藏身处等级、otherReqs 的特殊状态）上游虽然有字段，
     但口径太碎且随版本变，作战台**不算** —— 判据写在这里，免得下次有人以为算了。
     S.lv 为 0 表示「不限」：没填等级时，等级一项一律算通过。 */
  var NEXT = null;              // qid → [把它当前置的任务]，惰性建、切模式清
  function gate(qid) {
    var t = taskOf(qid);
    if (!t) return { ok: false, miss: [], unknown: [], lvShort: false };
    var miss = [], unknown = [];
    (t.pr || []).forEach(function (p) {
      if (!S.idx || !S.idx.tasks || !S.idx.tasks[p]) { unknown.push(p); return; }
      if (stateOf(p) !== "done") miss.push(p);
    });
    var lvShort = !!(S.lv && t.level && S.lv < t.level);
    return { ok: !lvShort && !miss.length, miss: miss, unknown: unknown, lvShort: lvShort };
  }
  function nextOf(qid) {
    if (!NEXT) {
      NEXT = {};
      if (S.idx && S.idx.tasks) {
        for (var k in S.idx.tasks) {
          var t = taskOf(k);
          (t.pr || []).forEach(function (p) { (NEXT[p] = NEXT[p] || []).push(k); });
        }
      }
    }
    return NEXT[qid] || [];
  }

  /* 「我的等级」：只存在本机，用来把「等级不够」从「前置没做」里分出来。
     不填 = 不限（0），避免默认值把一堆任务误标成锁住。 */
  var LV_KEY = "tk.ops.lv";
  function loadLv() {
    try {
      var v = parseInt(window.localStorage.getItem(LV_KEY) || "0", 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveLv(v) {
    try {
      if (v > 0) window.localStorage.setItem(LV_KEY, String(v));
      else window.localStorage.removeItem(LV_KEY);
    } catch (e) { /* 隐私模式下 localStorage 会抛 —— 不阻断作战 */ }
  }

  /* 跳到另一张图上的任务：前置链跨图是常态（海关的票常挂在森林/街区上），
     不能只在本图里找，否则「缺前置」点进去是一片空白。 */
  function gotoTask(qid) {
    var t = taskOf(qid);
    if (!t) return;
    var ms = t.ms || [];
    S.selQ = qid; S.selO = null;
    if (ms.length && ms.indexOf(S.map) < 0) { S.map = ms[0]; remountMap(); }
    paint();
    locateTask(qid, null);
    syncUrl();
  }

  /* ------------------------------------------------------------ 左栏：模式 */
  function buildModeSeg() {
    var box = el("div", "tk-ops__modes");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "数据模式");
    MODES.forEach(function (m) {
      var b = el("button", "tk-ops__mode", m[1]);
      b.type = "button";
      b.title = m[2];
      b.setAttribute("aria-pressed", m[0] === S.mode ? "true" : "false");
      b.dataset.mode = m[0];
      b.addEventListener("click", function () { switchMode(m[0]); });
      box.appendChild(b);
    });
    return box;
  }
  function switchMode(mode) {
    if (mode === S.mode) return;
    savePlan();               // 旧模式的清单先落盘（按模式分账本，不能串）
    S.mode = mode;
    S.selQ = null; S.selO = null;
    S.rowQid = ""; S.tasksAll = false; S.planOnly = false;
    S.plan = loadPlan(mode);
    S.planUndo = null;        // 撤销条属于上一本清单，不能带到新账本里
    NEXT = null;              // 任务库换了，后续索引必须重建
    /* 赛季与 PvP 共用任务库 —— 上游没有赛季端点（实测 404），如实说明。 */
    loadScript(idxFile(mode), idxKey(mode), function (ok) {
      S.idx = ok ? window[idxKey(mode)] : null;
      /* 载入失败 ≠ 这张图没有任务：必须能分开（2026-10-21） */
      S.idxError = !ok;
      paint();
    });
    /* 地图挂载点换模式：map.js 会重读 zone.m */
    var m = document.getElementById("tk-map");
    if (m) m.setAttribute("data-mode", mode === "season" ? "pvp" : mode);
    remountMap();
    syncUrl();
  }

  /* ---------------------------------------------------------- 左栏：地图条 */
  /* 13 张图 + 无地图的分档计数，**一次遍历算完**（2026-10-21 合并：原来
     mapRows 循环 13 遍、无地图再单跑一遍）。 */
  function mapCounts() {
    var out = {};
    MAP_KEYS.concat([NOMAP]).forEach(function (k) { out[k] = { n: 0, inhand: 0, done: 0 }; });
    if (!S.idx || !S.idx.tasks) return out;
    for (var qid in S.idx.tasks) {
      var t = taskOf(qid);
      if (!t) continue;
      var st = stateOf(qid);
      var keys = (t.ms || []).length ? t.ms : [NOMAP];
      for (var i = 0; i < keys.length; i++) {
        var c = out[keys[i]];
        if (!c) continue;
        if (st === "done") c.done++;
        else { c.n++; if (st === "inhand") c.inhand++; }
      }
    }
    return out;
  }
  function mapRows() {
    var cnt = mapCounts();
    return MAPS.map(function (m) {
      var c = cnt[m[0]];
      return { key: m[0], name: m[1], n: c.n, inhand: c.inhand, done: c.done };
    }).sort(function (a, b) {
      var d = (b.n + b.inhand) - (a.n + a.inhand);
      return d !== 0 ? d : (MAP_KEYS.indexOf(a.key) - MAP_KEYS.indexOf(b.key));
    });
  }
  function mapMatch(r) {
    if (!S.mapq) return true;
    return (r.name + " " + r.key).toLowerCase().indexOf(S.mapq.toLowerCase()) >= 0;
  }
  /* 一行地图按钮。「无地图」复用同一套结构 —— 它只是没有 ms，不该长得像另一类东西。 */
  function mapBtn(key, name, n, inhand, done, onPick) {
    var b = el("button", "tk-ops__map" + (key === S.map ? " is-on" : ""));
    b.type = "button";
    b.dataset.map = key;
    var line = el("span", "tk-ops__mapline");
    line.appendChild(el("b", null, name));
    line.appendChild(el("span", "tk-ops__mapn", n ? String(n) : (done ? "✓" : "—")));
    b.appendChild(line);
    var meta = el("span", "tk-ops__mapmeta");
    meta.textContent = n
      ? ("未完成 " + n + (inhand ? " · 进行中 " + inhand : ""))
      : (done ? ("已完成 " + done) : "没有记录");
    b.appendChild(meta);
    b.addEventListener("click", onPick);
    return b;
  }
  /* 只重绘地图清单本身：搜索框跟着重建就会「输一个字丢一次焦点」。 */
  function renderMapRows() {
    var box = document.getElementById("tk-ops-maplist");
    if (!box) return;
    box.textContent = "";
    var rows = mapRows().filter(mapMatch);
    var LIMIT = 6;
    var all = S.mapsAll || !!S.mapq || rows.length <= LIMIT;
    rows.slice(0, all ? rows.length : LIMIT).forEach(function (r) {
      box.appendChild(mapBtn(r.key, r.name, r.n, r.inhand, r.done, function () { switchMap(r.key); }));
    });
    if (!rows.length) box.appendChild(el("p", "tk-ops__muted", "没有匹配的地图"));
    if (!S.mapq && rows.length > LIMIT) {
      var more = el("button", "tk-ops__more",
        S.mapsAll ? "收起地图" : "更多地图（" + (rows.length - LIMIT) + "）");
      more.type = "button";
      more.addEventListener("click", function () { S.mapsAll = !S.mapsAll; renderMapRows(); });
      box.appendChild(more);
    }
    /* 「无地图」排在最后且不受「只列 6 张」折叠影响 —— 它是那 156 票唯一的入口。 */
    var nm = mapCounts()[NOMAP];
    if ((nm.n + nm.done) && (!S.mapq || "无地图".indexOf(S.mapq) >= 0)) {
      box.appendChild(el("p", "tk-ops__cap", "没有地图的票"));
      box.appendChild(mapBtn(NOMAP, "无地图", nm.n, nm.inhand, nm.done, function () { switchMap(NOMAP); }));
    }
  }
  function buildMapList() {
    var box = el("div", "tk-ops__maps");
    var head = el("div", "tk-ops__mapshead");
    head.appendChild(buildModeSeg());
    box.appendChild(head);
    var sq = el("input", "tk-ops__mapsq");
    sq.type = "search";
    sq.placeholder = "搜地图";
    sq.value = S.mapq || "";
    sq.addEventListener("input", function () {
      S.mapq = sq.value.trim();
      renderMapRows();
    });
    box.appendChild(sq);
    var list = el("div", "tk-ops__maplist");
    list.id = "tk-ops-maplist";
    box.appendChild(list);
    /* ⚠️ 这里**不**调 renderMapRows()（2026-10-21 清）：此刻 list 还没入 document，
       getElementById 找不到它，白跑一遍 13 图 × 500 票的统计。真正那一遍在
       paint() 里，入 DOM 之后补——留在外面那一处就够了。 */
    return box;
  }
  function switchMap(key) {
    S.map = key; S.selQ = null; S.selO = null;
    S.rowQid = ""; S.tasksAll = false; S.planOnly = false;
    remountMap();
    paint();
    syncUrl();
  }


  /* ------------------------------------------------------------ 出击清单 */
  /* 清单存哪：`tk.ops.plan` = { pve: {qid:1}, pvp: {}, season: {} }。
     ⚠️ 与进度账本（`tarkov_progress_v1`）**分开两个键**是刻意的：
        清空进度不该把「今晚打哪几票」一起清掉，反之亦然。
     隐私模式下 localStorage 会抛，一律静默降级 —— 那时清单退回会话级，
     与旧行为一致，不弹错（站内一贯口径）。 */
  var PLAN_KEY = "tk.ops.plan";

  function loadPlan(mode) {
    try {
      var raw = window.localStorage.getItem(PLAN_KEY);
      var o = raw ? JSON.parse(raw) : null;
      var v = o && o[mode];
      return (v && typeof v === "object") ? v : {};
    } catch (e) { return {}; }
  }
  function savePlan() {
    try {
      var raw = window.localStorage.getItem(PLAN_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") o = {};
      o[S.mode] = S.plan;
      window.localStorage.setItem(PLAN_KEY, JSON.stringify(o));
    } catch (e) { /* 隐私模式 / 配额满：清单退回会话级 */ }
  }

  function planIds() { return Object.keys(S.plan); }

  /* 加入 / 移出清单的唯一入口 —— 双击、详情卡按钮、撤销三处都走这里。
     分三条路径各写一遍「谁 savePlan」迟早分叉（本项目在日志同步上吃过这个亏）。 */
  function togglePlan(qid) {
    if (!qid) return;
    if (S.plan[qid]) { dropFromPlan(qid); return; }
    S.plan[qid] = true;
    S.planUndo = null;
    savePlan();
    /* 局部刷新，不 paint()：双击加票时整块重绘会把左栏滚回顶部，
       读者刚翻到第 15 行挑票，一加就回到顶上（2026-10-25）。 */
    refreshPlanViews(qid);
    syncUrl();
  }
  function dropFromPlan(qid) {
    if (!S.plan[qid]) return;
    var t = taskOf(qid);
    S.planUndo = { qid: qid, name: t ? (t.name || qid) : qid };
    delete S.plan[qid];
    savePlan();
    refreshPlanViews(qid);
    /* 6 秒后撤掉「撤销」条：只摘节点、不重绘 —— 重绘会把读者正在看的位置再冲一次 */
    setTimeout(function () {
      if (!S.planUndo || S.planUndo.qid !== qid) return;
      S.planUndo = null;
      var u = document.getElementById("tk-ops-planundo");
      if (u && u.parentNode) u.parentNode.removeChild(u);
    }, 6000);
  }
  function mapStats() {
    var out = { total: 0, open: 0, ready: 0, inhand: 0, done: 0, ignored: 0, keys: 0 };
    if (!S.idx || !S.idx.tasks) return out;
    for (var qid in S.idx.tasks) {
      var t = taskOf(qid);
      if (!t || !inMap(t)) continue;
      out.total++;
      var st = stateOf(qid);
      /* 钥匙数只算没做完的（2026-10-21 修：原来在状态分支外累加，做完的也在数） */
      if (st === "done") { out.done++; continue; }
      if (st === "ignored") { out.ignored++; continue; }
      out.keys += (t.keys || 0);
      out.open++;
      if (st === "inhand") out.inhand++;
      else if (gate(qid).ok) out.ready++;
    }
    return out;
  }
  /* 汇总带：未完成 = 可接 + 手上 + 缺前置，同口径（2026-10-21 修；原来两处差 1）。 */
  function buildBriefBar(box) {
    box.textContent = "";
    var s = mapStats();
    var name = S.map === NOMAP ? "无地图任务"
      : ((MAPS.find(function (m) { return m[0] === S.map; }) || [])[1] || S.map);
    box.appendChild(el("b", "tk-ops__bname", name));
    var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    box.appendChild(el("span", "tk-ops__bmeta",
      "未完成 " + s.open + " · 可接 " + s.ready + " · 手上 " + s.inhand
      + " · 已完成 " + pct + "%" + " · 钥匙 " + s.keys + " 把"));
    /* 「进入这一局」删掉（2026-10-21）：它等于「点列表第一行」，纯仪式按钮。 */
  }

  function buildPlan() {
    var box = el("div", "tk-ops__plan");
    var ids = planIds();
    var head = el("div", "tk-ops__planhead");
    head.appendChild(el("span", "tk-ops__cap", "出击清单 · " + ids.length));
    if (ids.length > 3) {
      var tgl = el("button", "tk-ops__more", S.planAll ? "收起" : "全部 " + ids.length);
      tgl.type = "button";
      tgl.addEventListener("click", function () { S.planAll = !S.planAll; paint(); });
      head.appendChild(tgl);
    }
    box.appendChild(head);
    if (!ids.length) {
      /* 清单空了就不能还停在「只看这些」—— 那样永远出不去。
         关掉时要**同时写 URL**（2026-10-25）：否则分享/刷新出去的链接
         还带着「只看清单」，但页面上根本没有清单，读者会看到空列表。 */
      if (S.planOnly) { S.planOnly = false; syncUrl(); }
      box.appendChild(el("p", "tk-ops__muted",
        "双击中栏的任务，把这一局要做的票攒起来（详情卡里也有「加入出击」）"));
      return box;
    }
    var show = S.planAll ? ids : ids.slice(0, 3);
    show.forEach(function (q) {
      var t = taskOf(q);
      var r = el("button", "tk-ops__planrow");
      r.type = "button";
      r.textContent = (t ? t.name : q) + "　×";
      r.title = "点击移出清单（6 秒内可撤销）";
      r.addEventListener("click", function () { dropFromPlan(q); });
      box.appendChild(r);
    });
    /* 撤销条（2026-10-25）：清单是手挑出来的，误点一下不该直接丢 ——
       而这条又是最容易被误点的（整行都是删除按钮）。 */
    if (S.planUndo) {
      var undo = el("div", "tk-ops__planundo");
      undo.id = "tk-ops-planundo";
      undo.appendChild(el("span", null, "已移出：" + S.planUndo.name));
      var ub = el("button", "tk-ops__chip", "撤销");
      ub.type = "button";
      ub.addEventListener("click", function () {
        if (!S.planUndo) return;
        S.plan[S.planUndo.qid] = true;
        S.planUndo = null;
        savePlan(); paint();
      });
      undo.appendChild(ub);
      box.appendChild(undo);
    }
    if (!S.planAll && ids.length > 3) {
      box.appendChild(el("p", "tk-ops__muted", "还有 " + (ids.length - 3) + " 票（点「全部」展开）"));
    }
    var keys = ids.reduce(function (n, q) {
      var t = taskOf(q);
      return n + ((t && t.keys) || 0);
    }, 0);
    var bar = el("div", "tk-ops__planbar");
    /* 「带这 N 票进图」→「只看这 N 票」（2026-10-21）：原名承诺了它没做的事
       （只选中第一条），换成它真能做到的：把中栏收成清单里的票。 */
    /* 文案固定成等长（「取消只看」/「只看清单」都是 4 字）：原来两种长度差 1 字，
       点一下按钮宽度就跳，鼠标停在原位会误点到旁边的 ⋯（2026-10-25）。 */
    var go = el("button", "tk-ops__plango",
      (S.planOnly ? "取消只看" : "只看清单")
      + " · " + ids.length + " 票 · 钥匙 " + keys + " 把");
    go.type = "button";
    go.title = S.planOnly
      ? "恢复显示这张图的全部任务"
      : "中栏只列出清单里的票，方便开局前对着看";
    go.addEventListener("click", function () {
      S.planOnly = !S.planOnly;
      if (S.planOnly) {
        S.selQ = ids[0]; S.selO = null;
        selectOnMap(ids[0]);
      }
      paint();
      syncUrl();
    });
    bar.appendChild(go);
    /* 「复制 / 清空」收进 ⋯（2026-10-21）：两个低频动作原来各占一个按钮位置。 */
    var menu = el("details", "tk-ops__planmenu");
    menu.appendChild(el("summary", "tk-ops__chip", "⋯"));
    var mbody = el("div", "tk-ops__planmbody");
    var cp = el("button", "tk-ops__chip", "复制清单");
    cp.type = "button";
    cp.title = "复制任务名与钥匙数";
    cp.addEventListener("click", function () {
      var txt = ids.map(function (q) {
        var t = taskOf(q);
        return (t ? t.name : q) + "（钥匙 " + (t ? t.keys : 0) + "）";
      }).join("\n");
      /* 如实回报（2026-10-25）：原来无条件把按钮改成「已复制」——
         隐私模式 / 权限拒绝 / 非安全上下文时，剪贴板根本没写进去。 */
      var back = function (label) {
        cp.textContent = label;
        setTimeout(function () { cp.textContent = "复制清单"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { back("已复制"); },
          function () { cp.title = "浏览器拒绝了剪贴板权限 —— 可手动选中清单文字复制"; back("复制失败"); }
        );
      } else {
        cp.title = "这个浏览器不支持剪贴板 API —— 请手动选中清单文字复制";
        back("复制失败");
      }
    });
    var cl = el("button", "tk-ops__chip", "清空");
    cl.type = "button";
    cl.addEventListener("click", function () { S.plan = {}; S.planUndo = null; savePlan(); paint(); });
    mbody.appendChild(cp);
    mbody.appendChild(cl);
    menu.appendChild(mbody);
    bar.appendChild(menu);
    box.appendChild(bar);
    return box;
  }

  /* ------------------------------------------------------------ 右栏：任务 */
  function visibleTasks() {
    var out = [];
    if (!S.idx || !S.idx.tasks) return out;
    for (var qid in S.idx.tasks) {
      var t = taskOf(qid);
      if (!t) continue;
      /* 「只看这些」优先于一切：读者按下它就是要「别给我看别的」。 */
      if (S.planOnly && !S.plan[qid]) continue;
      /* 图过滤（2026-10-21 合并了原来的「仅本图 / 全站」两档）：
         没有搜索词 = 只看本图；一旦开始搜，就自动跨图 —— 读者真正需要跨图的
         场合只有「我记得有这一票，它在哪张图上」。 */
      if (!inMap(t) && !S.q) continue;
      if (S.q) {
        /* 匹配 **目标文本**（`otxt`），不是 `oids`（2026-10-25 修）。
           `oids` 是 24 位目标 id，拿它做 hay 等于搜一串十六进制 ——
           搜索框写着「搜任务 / 地名 / 物品」，而「电线」「螺丝」这类
           物品名一条都搜不到（实测 PVE 499 票里 otxt 含「电线」2 票）。 */
        var hay = (t.name + " " + (t.en || "") + " " + (t.otxt || "")).toLowerCase();
        if (hay.indexOf(S.q.toLowerCase()) < 0) continue;
      }
      var st = stateOf(qid);
      /* 「未完成」= 没做完且没标忽略。「可接」= 未完成 + 等级够 + 前置齐，
         **不含「手上」**（2026-10-21 统一口径：已接的再算可接就是同一票算两次）。 */
      if (S.filter === "open" && (st === "done" || st === "ignored")) continue;
      if (S.filter === "inhand" && st !== "inhand") continue;
      if (S.filter === "done" && st !== "done") continue;
      if (S.filter === "ignored" && st !== "ignored") continue;
      if (S.filter === "pinned" && !isPinned(qid)) continue;
      var g = gate(qid);
      if (S.filter === "ready" && (st === "done" || st === "ignored" || st === "inhand" || !g.ok)) continue;
      out.push({ qid: qid, t: t, st: st, pinned: isPinned(qid), g: g });
    }
    out.sort(function (a, b) {
      /* **本图优先**（2026-10-25）：搜索会自动跨图，但读者多数时候要找的
         就在脚下这张图上 —— 原来只按状态与目标数排，本图与外图的票混着出，
         前 20 行里一半是别图的。 */
      var am = inMap(a.t) ? 0 : 1, bm = inMap(b.t) ? 0 : 1;
      if (am !== bm) return am - bm;
      /* 进行中最前，其次钉住，再其次「现在就能接」，其余按目标数；
         同名按中文序，保证稳定 */
      var rank = function (x) {
        if (x.st === "inhand") return 0;
        if (x.pinned) return 1;
        if (x.g && x.g.ok) return 2;
        return 3;
      };
      var d = rank(a) - rank(b);
      if (d) return d;
      d = (b.t.nObj || 0) - (a.t.nObj || 0);
      return d !== 0 ? d : (a.t.name || "").localeCompare(b.t.name || "", "zh");
    });
    return out;
  }

  /* 状态文案：清单行、详情卡、局部刷新三处共用一份。 */
  var ST_TXT = { done: "已完成", inhand: "进行中", ignored: "已忽略" };

  /* 一行任务的 meta 文本。整行渲染与局部刷新**共用这一个函数** ——
     两处各写一份，改一处就会漂（本项目的老毛病：口径不一致）。 */
  function rowBits(t, qid) {
    var bits = [];
    var nobj = (t.oids || []).length;
    if (nobj) bits.push("目标 " + metCount(t, qid) + "/" + nobj);
    if (t.keys) bits.push("钥匙 " + t.keys + " 把");
    if (t.trader) bits.push(t.trader);
    if (t.level) bits.push("Lv " + t.level);
    /* 搜索会跨图：不标一下，读者会以为这张图上真有这票。
       「无地图」视图下反过来说 —— 那里出现的带图票才是例外。 */
    if (!inMap(t)) bits.push(S.map === NOMAP ? "有地图" : "不在本图");
    /* 命中的是**目标文本**而不是任务名时，说明一下为什么这票上榜
       （否则读者搜「电线」看到一票叫「电工」的任务，会以为搜错了）。 */
    if (S.q) {
      var qq = S.q.toLowerCase();
      var inName = (t.name || "").toLowerCase().indexOf(qq) >= 0
        || (t.en || "").toLowerCase().indexOf(qq) >= 0;
      if (!inName) {
        var segs = String(t.otxt || "").split("|");
        for (var si = 0; si < segs.length; si++) {
          if (segs[si].toLowerCase().indexOf(qq) >= 0) {
            var s = segs[si].trim();
            bits.push("目标里有：" + (s.length > 16 ? s.slice(0, 16) + "…" : s));
            break;
          }
        }
      }
    }
    return bits.join(" · ");
  }

  /* 局部刷新一行（状态色条 + 徽章 + meta），不重建列表。
     点徽章换状态、勾目标后目标数变 —— 这两种高频动作原来都走 paint()。 */
  function refreshRow(qid) {
    var row = document.querySelector('.tk-ops__row[data-qid="' + qid + '"]');
    if (!row) return;
    var t = taskOf(qid);
    if (!t) return;
    var st = stateOf(qid);
    row.className = "tk-ops__row tk-ops__row--flat"
      + (qid === S.selQ ? " is-sel" : "")
      + (st === "done" ? " is-done" : "")
      + (st === "ignored" ? " is-ignored" : "");
    var badge = row.querySelector(".tk-ops__badge");
    if (badge) {
      badge.className = "tk-ops__badge tk-ops__badge--" + st;
      badge.textContent = ST_TXT[st] || "未标记";
      badge.title = st === "ignored"
        ? "点一下取消忽略"
        : "点一下切换：未标记 → 进行中 → 已完成";
    }
    var meta = row.querySelector(".tk-ops__rowmeta");
    if (meta) meta.textContent = rowBits(t, qid);
  }

  /* 只更新一行上的「出击」角标（清单增删时用） */
  function refreshRowPlan(qid) {
    var row = document.querySelector('.tk-ops__row[data-qid="' + qid + '"]');
    if (!row) return;
    var head = row.querySelector(".tk-ops__rowhead");
    if (!head) return;
    var cur = head.querySelector(".tk-ops__planned");
    var inPlan = !!S.plan[qid];
    if (inPlan && !cur) head.appendChild(el("span", "tk-ops__planned", "出击"));
    else if (!inPlan && cur && cur.parentNode) cur.parentNode.removeChild(cur);
  }

  /* 清单变了之后只重画「清单 + 那一行的角标 + 详情卡按钮」：
     不动中栏列表、不动左栏与详情的滚动位置。 */
  function refreshPlanViews(qid) {
    var left = document.getElementById("tk-ops-left");
    if (left) {
      var old = left.querySelector(".tk-ops__plan");
      var fresh = buildPlan();
      if (old) left.replaceChild(fresh, old); else left.appendChild(fresh);
    }
    var brief = document.getElementById("tk-ops-briefbar");
    if (brief) buildBriefBar(brief);
    refreshRowPlan(qid);
    var detail = document.getElementById("tk-ops-detail");
    if (detail && S.selQ === qid) renderDetail(detail, true);
  }

  function relistTasks() {
    var box = document.getElementById("tk-ops-tasks");
    if (box) renderTaskList(box);
  }

  /* 当前筛选还容得下这票吗 —— 容不下才重建列表（一票标成完成后它就该校消失） */
  function rowStillVisible(qid) {
    var rows = visibleTasks();
    for (var i = 0; i < rows.length; i++) if (rows[i].qid === qid) return true;
    return false;
  }

  /* 中栏任务清单：一行一票，只留「是什么 / 什么状态 / 两件事能立刻做」。
     目标明细搬进右栏 —— 一行任务挂 8 个复选框会把清单撑成墙（实测 80 行 / 405 个框）。 */
  function renderTaskList(box) {
    box.textContent = "";
    /* 标题随上下文走（2026-10-21）：跨图搜索时列表里混着别的图的票 */
    var title = S.planOnly ? "出击清单里的票"
      : (S.q ? "搜索结果（跨图）"
        : (S.map === NOMAP ? "上游没给地图的任务" : "这张图上的任务"));
    var rows = visibleTasks();
    var head = el("div", "tk-ops__thead");
    head.appendChild(el("b", "tk-ops__tcap", title));
    head.appendChild(el("span", "tk-ops__tcount", rows.length + " 票"));
    var doneN = rows.filter(function (r) { return r.st === "done"; }).length;
    if (rows.length) {
      var bar = el("span", "tk-ops__tbar");
      var fill = el("i");
      fill.style.width = Math.round(doneN / rows.length * 100) + "%";
      bar.appendChild(fill);
      head.appendChild(bar);
      head.appendChild(el("span", "tk-ops__tn", doneN + " / " + rows.length + " 已完成"));
    }
    var tgl = el("button", "tk-ops__tgl", S.tasksOpen === false ? "展开" : "收起");
    tgl.type = "button";
    tgl.addEventListener("click", function () {
      S.tasksOpen = S.tasksOpen === false;
      renderTaskList(box);
    });
    head.appendChild(tgl);
    box.appendChild(head);

    /* 一次性提示（非法 URL 参数等）：说一次就够，下次重绘自动消失。 */
    if (S.notice) box.appendChild(el("p", "tk-ops__warn", S.notice));

    /* 载入中 / 载入失败 / 真没任务必须分开（2026-10-21）：原来三者同一句话，
       于是「赛季取错全局量」这种整块失效被伪装成「这张图恰好没活」。 */
    if (!S.idx) {
      box.appendChild(el("p", "tk-ops__warn", S.idxError
        ? "任务索引没载入成功（网络或脚本被拦截）—— 刷新一次再试。地图与进度账本不受影响。"
        : "正在载入任务索引…"));
      return;
    }

    if (S.tasksOpen === false) return;
    if (!rows.length) {
      var empty;
      if (S.planOnly) empty = "出击清单里的票都被当前筛选挡掉了 —— 点左栏「取消只看」回去。";
      else if (S.q) empty = "没搜到。换个词试试 —— 搜索会自动跨图。";
      else if (S.map === NOMAP) empty = "没有符合条件的不带地图任务。";
      else empty = "这张图上没有符合条件的活。";
      box.appendChild(el("p", "tk-ops__muted", empty));
      return;
    }
    var LIMIT = 20;
    var shown = S.tasksAll ? rows : rows.slice(0, LIMIT);
    /* 键盘行按**任务 id** 回找（2026-10-25）：列表重建后下标会指到别人 ——
       「标完一票它从『未完成』里消失、按 ↓ 落到别票上」就是这么来的。
       找不到（这票被筛掉了）就退到第 0 行。 */
    var curRow = 0;
    for (var ri = 0; ri < shown.length; ri++) {
      if (shown[ri].qid === S.rowQid) { curRow = ri; break; }
    }
    shown.forEach(function (r, i) {
      var t = r.t;
      var row = el("div", "tk-ops__row tk-ops__row--flat" + (r.qid === S.selQ ? " is-sel" : "")
        + (r.st === "done" ? " is-done" : "")
        + (r.st === "ignored" ? " is-ignored" : ""));
      row.dataset.qid = r.qid;
      row.tabIndex = i === curRow ? 0 : -1;

      var body = el("div", "tk-ops__rowbody");
      var head2 = el("div", "tk-ops__rowhead");
      /* 行内状态徽章**可点**（2026-10-25）：结算一票不必再进详情卡。
         三态循环（未标记 → 进行中 → 已完成 → 未标记），一次点击一步；
         「已忽略」的行点一下回到未标记（等于取消忽略）。
         ⚠️ 徽章本来就在，改成按钮**不增加任何视觉噪声** —— 这是 v1.145.2
            删掉行内「定位 / ＋出击」之后空出来的地方。 */
      var badge = el("button", "tk-ops__badge tk-ops__badge--" + r.st,
        ST_TXT[r.st] || "未标记");
      badge.type = "button";
      badge.title = r.st === "ignored"
        ? "点一下取消忽略"
        : "点一下切换：未标记 → 进行中 → 已完成";
      badge.setAttribute("aria-label", (t.name || "该任务") + "：当前"
        + (ST_TXT[r.st] || "未标记") + "，点击切换");
      badge.addEventListener("click", function (e) {
        /* 不要连带触发整行的「定位」—— 徽章在行内，事件会冒泡到 row */
        e.stopPropagation();
        /* ⚠️ `r.st` 对未标记返回的是 `"none"` 不是 `""` —— 不归一的话
           「未标记」那一步会切到 `""`（还是未标记），读起来像点了没反应。 */
        var cur = r.st === "none" ? "" : r.st;
        setState(r.qid, cur === "" ? "inhand" : (cur === "inhand" ? "done" : ""));
      });
      head2.appendChild(badge);
      if (r.pinned) head2.appendChild(el("span", "tk-ops__pin", "★"));
      head2.appendChild(el("b", "tk-ops__rowname", t.name || "（无中文名）"));
      /* Kappa / Lightkeeper 角标：数据列一直有，但前端从没画过（2026-10-21 补上）。
         它不是「状态」，是这条任务属于哪条终局线 —— 与 done/inhand 不是同一维度。 */
      if (t.flags === "k") head2.appendChild(el("span", "tk-ops__kflag", "Kappa"));
      else if (t.flags === "l") head2.appendChild(el("span", "tk-ops__kflag", "LK"));
      /* 只标「锁住」的，不标「可接」—— 80 票里 58 票都可接，全标等于没标（2026-10-21）。
         想知道「哪些能接」用筛选里的「可接」，那是主动查询，不是常驻噪音。 */
      if (r.st !== "done" && r.st !== "ignored" && r.g) {
        if (r.g.lvShort) head2.appendChild(el("span", "tk-ops__locked", "需 Lv " + t.level));
        else if (r.g.miss.length) head2.appendChild(el("span", "tk-ops__locked", "缺前置 " + r.g.miss.length));
      }
      if (r.qid in S.plan) head2.appendChild(el("span", "tk-ops__planned", "出击"));
      body.appendChild(head2);

      var meta = el("div", "tk-ops__rowmeta", rowBits(t, r.qid));
      body.appendChild(meta);
      row.appendChild(body);

      /* 行内不再放「定位 / ＋出击」两个按钮（2026-10-21）：
         定位 = 点整行，出击 = 双击（详情卡里也有一份）。20 行 × 2 个按钮是首屏
         噪声的最大来源，实测占全部按钮的 28%。 */
      row.title = "单击：定位到图上 · 双击：加入 / 移出出击清单 · 点状态徽章：换状态";

      row.addEventListener("click", function () {
        S.rowQid = r.qid;
        locateTask(r.qid, null);
      });
      row.addEventListener("dblclick", function (e) {
        e.preventDefault();
        togglePlan(r.qid);
      });
      box.appendChild(row);
    });
    if (!S.tasksAll && rows.length > LIMIT) {
      var more = el("button", "tk-ops__more",
        "还有 " + (rows.length - LIMIT) + " 票 —— 展开全部");
      more.type = "button";
      more.addEventListener("click", function () { S.tasksAll = true; renderTaskList(box); });
      box.appendChild(more);
    }
  }

  function focusTask(qid, oid) {
    S.selQ = qid; S.selO = oid || null;
    var m = document.getElementById("tk-map");
    if (m && window.TarkovMap && typeof window.TarkovMap.focus === "function") {
      window.TarkovMap.focus(qid, oid);
    } else {
      /* map.js 还没暴露 API：先派发事件，由 map.js 内的钩子接（见下） */
      try {
        window.dispatchEvent(new CustomEvent("tk:map:focus",
          { detail: { qid: qid, oid: oid } }));
      } catch (e) {}
    }
    highlight();
    syncUrl();
  }

  /* 单击/回车 = 在图上定位：选中与飞过去要一起做（2026-10-21）—— 只选中不飞，
     区域可能缩在角落，读者会以为「右栏换了、图上没动」。窄屏顺带把详情滚进视野。 */
  function locateTask(qid, oid) {
    S.selQ = qid; S.selO = oid || null;
    selectOnMap(qid);
    focusTask(qid, oid || null);
    renderRightBody();
    if (window.matchMedia && window.matchMedia("(max-width: 1080px)").matches) {
      var d = document.getElementById("tk-ops-detail");
      if (d && d.scrollIntoView) d.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function selectOnMap(qid) {
    try {
      window.dispatchEvent(new CustomEvent("tk:map:select",
        { detail: { qid: qid, oid: null, map: S.map } }));
    } catch (e) {}
  }

  /* 把当前选中的票推到地图上。⚠️ 地图异步挂好：区域没建出来时 applyQzFilter 直接
     return，于是「右栏有卡、图上没高亮」—— 等 .tk-zq 出现再发，最多 3 秒。 */
  function applySelToMap(tries) {
    if (!S.selQ || S.map === NOMAP) return;
    var n = typeof tries === "number" ? tries : 15;
    if (!document.querySelectorAll("#tk-map .tk-zq").length && n > 0) {
      setTimeout(function () { applySelToMap(n - 1); }, 200);
      return;
    }
    selectOnMap(S.selQ);
    try {
      window.dispatchEvent(new CustomEvent("tk:map:focus",
        { detail: { qid: S.selQ, oid: S.selO || null } }));
    } catch (e) {}
  }

  function highlight() {
    var list = document.getElementById("tk-ops-tasks");
    if (!list) return;
    Array.prototype.forEach.call(list.querySelectorAll(".tk-ops__row"), function (n) {
      n.classList.toggle("is-sel", n.dataset.qid === S.selQ);
    });
    var cur = list.querySelector(".tk-ops__row.is-sel");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }

  /* 换筛选后把清单带进视野 —— 但**只在它不在视野里时**才滚（2026-10-25）。
     原来无条件 smooth 滚动：连切两档就被甩下去两次，正在看地图时尤其打断。
     键盘选行不走这里：highlight() 已经用 block:"nearest" 做了最小滚动。 */
  function revealTasks() {
    var tb = document.getElementById("tk-ops-tasks");
    if (!tb || !tb.scrollIntoView) return;
    var r = tb.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (r.top >= 0 && r.top < vh - 120) return;   // 已经在视野里，别动
    tb.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ------------------------------------------------------------ 地图挂载 */
  function remountMap() {
    var m = document.getElementById("tk-map");
    if (!m) return;
    /* 「无地图」不是一张图：不挂 map.js，只说明原因（硬挂会去请求不存在的 maps-data） */
    if (S.map === NOMAP) {
      m.dataset.tkMounted = "0";
      m.dataset.tkMapBusy = "0";
      m.textContent = "";
      m.appendChild(el("p", "tk-ops__nomap",
        "这批任务上游没给地图（多为「交给商人 / 交某个物品」型），没有可定位的点。"
        + "中栏照样能勾目标、记进度；在左栏随便选一张图就回到地图。"));
      return;
    }
    /* map.js 用 data-mounted 防重入；换图必须清掉再让它重新挂一次 */
    m.dataset.tkMounted = "0";
    m.dataset.tkMapBusy = "0";
    m.setAttribute("data-map", S.map);
    m.textContent = "";
    ensureTip();
    if (window.TarkovMap && typeof window.TarkovMap.mount === "function") {
      window.TarkovMap.mount();
      compactMapBar();
      foldLegend();
    } else {
      loadScript("map.js", null, function () {
        if (window.TarkovMap && window.TarkovMap.mount) window.TarkovMap.mount();
        compactMapBar();
        foldLegend();
        applySelToMap();
      });
    }
    /* 深链：把当前选中的票补到图上。⚠️ 必须在 if/else **之外**调 —— boot 里 map.js
       是先前装好再进 remountMap 的，走同步那一支，只写在 else 里实测无效。 */
    applySelToMap();
  }

  /* ------------------------------------------------------------ URL 状态 */
  function syncUrl() {
    var p = [];
    p.push("map=" + encodeURIComponent(S.map));
    p.push("mode=" + encodeURIComponent(S.mode));
    if (S.filter !== "open") p.push("f=" + S.filter);
    /* 搜索词用 sq，不能叫 q（2026-10-21 实测）：map.js 把 ?q= 当任务 id 深链，
       搜「宿舍」再切图会冒出「该任务在图上没有画出目标区域…看任务详情 →」。
       「只看这些」**不进 URL** —— 出击清单是会话级的，分享出去对面是空清单。 */
    if (S.q) p.push("sq=" + encodeURIComponent(S.q));
    if (S.selQ) p.push("sel=" + S.selQ);
    if (S.selO) p.push("o=" + S.selO);
    try { history.replaceState(null, "", "?" + p.join("&")); } catch (e) {}
  }
  function readUrl() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var bad = [];
    /* 参数先校验再采纳（2026-10-21）：静默回退会让页面变空白，读者分不清是链接
       坏了还是站点坏了（实测 ?map=atlantis 会把「atlantis」当图名显示）。 */
    var vMap = q.get("map");
    if (vMap) {
      if (vMap === NOMAP || MAP_KEYS.indexOf(vMap) >= 0) S.map = vMap;
      else bad.push("地图「" + vMap + "」");
    }
    var vMode = q.get("mode");
    if (vMode) {
      if (MODE_KEYS.indexOf(vMode) >= 0) S.mode = vMode;
      else bad.push("模式「" + vMode + "」");
    }
    var vF = q.get("f");
    if (vF && FILTERS.indexOf(vF) >= 0) S.filter = vF;
    /* 兼容旧链接：v1.145 及更早用 q= 存搜索词（当时还没发现和地图撞名） */
    var vQ = q.get("sq");
    if (vQ == null) {
      var leg = q.get("q");
      if (leg && !/^[0-9a-f]{24}$/i.test(leg)) vQ = leg;
    }
    if (vQ) S.q = vQ;
    if (q.get("sel")) S.selQ = q.get("sel");
    if (q.get("o")) S.selO = q.get("o");
    if (bad.length) {
      S.notice = "链接里的" + bad.join("、") + "不认识，已回到默认视图。";
    }
  }

  /* -------------------------------------------------- 地图 → 右栏（反向联动）
     地图上点了某个区域，右栏要跟着选中那一行（并滚到可见位置）——
     否则读者在地图上点了一下，右栏毫无反应，会以为没点中。
     ⚠️ 只在**任务变了**时才重绘右栏：selectTask 每次都会 emit（含清空选中），
        无条件 paint 会和右栏的点击互相触发，滚动手感也会被打断。 */
  function bindMapToRight() {
    if (window.__tkOpsMapSync) return;
    window.__tkOpsMapSync = function (ev) {
      var d = (ev && ev.detail) || {};
      if (d.map && d.map !== S.map) return;          /* 别的图发来的事件，忽略 */
      var qid = d.qid || null;
      if (qid === S.selQ) return;
      S.selQ = qid;
      S.selO = d.oid || null;
      /* 点空白 = 取消选中：只取消高亮，不动筛选，别把列表刷没了 */
      var list = document.getElementById("tk-ops-tasks");
      if (list) {
        Array.prototype.forEach.call(list.querySelectorAll(".tk-ops__row"), function (n) {
          n.classList.toggle("is-sel", n.dataset.qid === qid);
        });
        var cur = list.querySelector(".tk-ops__row.is-sel");
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
      }
      /* 右栏跟着换：否则从地图上点了一票，右栏还停在上一票的详情（或空态） */
      renderRightBody();
      syncUrl();
    };
    window.addEventListener("tk:map:select", window.__tkOpsMapSync);
  }


  /* ------------------------------------------------------------ 键盘流 */
  function bindKeys() {
    document.addEventListener("keydown", function (e) {
      /* ⚠️ 本页守卫必须在第一行（2026-10-21 实测）：监听挂在 document 上、只在第一次
         boot 时绑一次，instant 换页不重建 JS 上下文 → 一直活到整页刷新。没有这一行，
         离开 /ops/ 后 `/` 被吞（全站搜索快捷键失效）、按 1/2/3 还会改写当前页 URL。 */
      if (!document.getElementById(HOST)) return;
      var tag = (e.target && e.target.tagName) || "";
      var typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        var s = document.querySelector(".tk-ops__search");
        if (s) s.focus();
        return;
      }
      if (e.key === "Escape") {
        /* 先 blur 再局部重绘：直接 paint() 会「恢复焦点」，把这次的 blur 抵消掉 */
        if (typing) { e.target.value = ""; S.q = ""; e.target.blur(); renderRightBody(); syncUrl(); }
        else {
          S.selQ = null; S.selO = null;
          /* 只清选中 —— 不必整块重绘，那会把左栏与详情卡的滚动位置一起冲掉 */
          highlight();
          renderRightBody();
          syncUrl();
        }
        return;
      }
      if (typing) return;
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        switchMode(MODES[+e.key - 1][0]); e.preventDefault(); return;
      }
      if (e.key === "?") { showHelp(); e.preventDefault(); return; }
      var list = document.getElementById("tk-ops-tasks");
      if (!list) return;
      var rows = Array.prototype.slice.call(list.querySelectorAll(".tk-ops__row"));
      if (!rows.length) return;
      /* 回车定位（2026-10-21 补）：文案从 v1.134.0 起就写「回车定位」，却一直没有
         Enter 分支 —— ↑↓ 只换右栏、不动地图。判定用「别抢有默认动作的控件」。 */
      if (e.key === "Enter") {
        var tEl = e.target || document.activeElement;
        var tg = (tEl && tEl.tagName) || "";
        if (tg === "BUTTON" || tg === "A" || tg === "SUMMARY" ||
          tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT") return;
        var cur0 = list.querySelector(".tk-ops__row.is-sel") || rows[0];
        if (!cur0 || !cur0.dataset.qid) return;
        e.preventDefault();
        locateTask(cur0.dataset.qid, null);
        return;
      }
      /* 上下移动按**任务 id**定位（2026-10-25）：下标在列表重建后会指到别人，
         表现为「标完一票按 ↓ 落到别票上」。 */
      var curIdx = 0;
      for (var qj = 0; qj < rows.length; qj++) {
        if (rows[qj].dataset.qid === S.rowQid) { curIdx = qj; break; }
      }
      if (e.key === "ArrowDown") { curIdx = Math.min(rows.length - 1, curIdx + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { curIdx = Math.max(0, curIdx - 1); e.preventDefault(); }
      else return;
      var r = rows[curIdx];
      if (!r) return;
      S.rowQid = r.dataset.qid;
      S.selQ = r.dataset.qid;
      highlight();
      renderRightBody();
      /* 焦点跟到行上：回车才有落点（行是 div，focus 不会触发任何默认动作） */
      try { r.focus({ preventScroll: true }); } catch (err) { /* 老浏览器忽略参数 */ }
    });
  }
  function showHelp() {
    var w = document.getElementById("tk-ops-help");
    if (w) w.hidden = !w.hidden;
  }


  /* ---------------------------------------------------------- 悬停即读
     抄 HUD Manager 的做法：鼠标停在任务区域上就浮一条小提示，省掉「先点」。
     **在作战台自己这一层实现，不进 map.js** —— map.js 的 zonesAt() 返回的是
     qid 字符串（点击逻辑要的是它），拿不到元素；而把它改成返回元素会动到
     13 个地图页共用的点击链路。这里的 zonesAt 是只读探测，两边互不干扰。 */
  /* ⚠️ 浮条挂在 **body** 上、用 fixed 定位（2026-10-18 实测）：挂在 #tk-map 里
     会被 map.js 的重绘（host.innerHTML = ""）清掉 —— 换图 / 重挂之后浮条就没了，
     表现是「第一次能用、切完图不出现」。挂 body 不受任何重绘影响。 */
  function ensureTip() {
    var tip = document.getElementById("tk-ops-tip");
    if (!tip) {
      tip = el("div", "tk-map__hovertip");
      tip.id = "tk-ops-tip";
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }
  function zoneElAt(x, y) {
    if (!document.elementsFromPoint) return null;
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.classList && e.classList.contains("tk-zq")) return e;
    }
    return null;
  }
  function bindHover() {
    var m = document.getElementById("tk-map");
    if (!m || m.dataset.tkOpsHover === "1") return;
    m.dataset.tkOpsHover = "1";
    /* 事件委托挂在**挂载点**上而不是 svg：换图时 map.js 会重建 svg，
       挂在 svg 上的监听会跟着一起丢（这正是第一版没反应的原因）。 */
    m.addEventListener("mousemove", function (ev) {
      var tip = ensureTip();
      if (!tip) return;
      var z = zoneElAt(ev.clientX, ev.clientY);
      if (!z) { tip.hidden = true; return; }
      var label = z.getAttribute("data-label") || "";
      var wp = z.getAttribute("data-wp") || "";
      var nl = z.getAttribute("data-nl") || "";
      var txt = label
        + (wp ? "　x/y/z " + wp : "")
        + (nl ? "　靠近 " + nl : "")
        + "　—　单击 = 只看这个任务";
      if (tip.textContent !== txt) tip.textContent = txt;
      tip.hidden = false;
      /* fixed 定位 = 视口坐标，直接用 clientX/Y；贴右/下边缘时向内收，别出屏 */
      var vw = window.innerWidth, vh = window.innerHeight;
      var w = tip.offsetWidth || 240, h = tip.offsetHeight || 60;
      tip.style.left = Math.max(4, Math.min(ev.clientX + 14, vw - w - 8)) + "px";
      tip.style.top = Math.max(4, Math.min(ev.clientY + 18, vh - h - 8)) + "px";
    });
    m.addEventListener("mouseleave", function () {
      var tip = ensureTip();
      if (tip) tip.hidden = true;
    });
    /* 点下去就收起来 —— 提示的使命在「点」的那一刻结束，别和完整卡重叠 */
    m.addEventListener("mousedown", function () {
      var tip = ensureTip();
      if (tip) tip.hidden = true;
    });
  }


  /* ---------------------------------------------------------- 可拖拽分栏
     PC 优先的意思之一：栏宽该由读者定，不该被固定像素锁死。
     用 CSS 变量 --tk-ops-left / --tk-ops-right 驱动 grid-template-columns，
     拖拽只改变量（不重排 DOM），宽度存本机。 */
  var LIM = { left: [180, 420], right: [280, 620] };
  function applyWidths() {
    var L = 0, R = 0;
    try {
      L = parseInt(localStorage.getItem("tk_ops_w_left") || "0", 10);
      R = parseInt(localStorage.getItem("tk_ops_w_right") || "0", 10);
    } catch (e) { /* 隐私模式：用默认值 */ }
    if (L) document.documentElement.style.setProperty("--tk-ops-left", L + "px");
    if (R) document.documentElement.style.setProperty("--tk-ops-right", R + "px");
  }
  function bindGrips() {
    var grid = document.querySelector(".tk-ops__grid");
    if (!grid || grid.dataset.tkGrip === "1") return;
    grid.dataset.tkGrip = "1";
    [["l", "left", "tk_ops_w_left"], ["r", "right", "tk_ops_w_right"]].forEach(function (g) {
      var side = g[0], key = g[1], store = g[2];
      var h = el("div", "tk-ops__grip tk-ops__grip--" + side);
      h.title = "拖动调整栏宽（双击恢复默认）";
      grid.appendChild(h);
      var dragging = false, startX = 0, startW = 0;
      h.addEventListener("pointerdown", function (ev) {
        var col = side === "l" ? document.getElementById("tk-ops-left")
          : document.getElementById("tk-ops-right");
        if (!col) return;
        dragging = true;
        startX = ev.clientX;
        startW = col.getBoundingClientRect().width;
        h.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      h.addEventListener("pointermove", function (ev) {
        if (!dragging) return;
        /* 左栏往右拖 = 变宽；右栏往左拖 = 变宽，所以符号相反 */
        var d = side === "l" ? (ev.clientX - startX) : (startX - ev.clientX);
        var lim = LIM[key];
        var w = Math.max(lim[0], Math.min(lim[1], Math.round(startW + d)));
        document.documentElement.style.setProperty("--tk-ops-" + key, w + "px");
        try { localStorage.setItem(store, String(w)); } catch (e) {}
      });
      var stop = function (ev) {
        if (!dragging) return;
        dragging = false;
        try { h.releasePointerCapture(ev.pointerId); } catch (e) {}
      };
      h.addEventListener("pointerup", stop);
      h.addEventListener("pointercancel", stop);
      h.addEventListener("dblclick", function () {
        document.documentElement.style.removeProperty("--tk-ops-" + key);
        try { localStorage.removeItem(store); } catch (e) {}
      });
    });
  }

  /* -------------------------------------------------- 从游戏日志同步（左栏底部）
     **必须复用同一个节点**（2026-10-18）：paint() 每次都 `left.textContent = ""`，
     若每次重建，模块内部的句柄/自动同步状态就白丢一遍，而且每次搜索输入都会
     重新 init 一次、重复触发自动同步。所以建一次、存起来，paint 时只重新
     appendChild（节点对象仍在内存里，状态不丢）。
     视觉上做成 <details> 折叠：作战台的主角是作战，同步属于设置项，
     平时收起，需要时点开。 */
  var logBoxEl = null;
  function opsLogBox() {
    if (!logBoxEl) {
      logBoxEl = el("details", "tk-ops__logs");
      var sum = el("summary", null, "从游戏日志同步");
      sum.title = "读本机日志把「接取 / 完成」补进账本（只读、不上传）";
      /* 左栏是可滚动的（max-height 78vh），这一块在最底下 —— 展开后
         按钮往往还在视野外，读者会以为「点了没反应」。展开时滚到可见。 */
      logBoxEl.addEventListener("toggle", function () {
        if (!logBoxEl.open) return;
        setTimeout(function () {
          if (logBoxEl.scrollIntoView) logBoxEl.scrollIntoView({ block: "nearest" });
        }, 0);
      });
      logBoxEl.appendChild(sum);
      var inner = el("div", "tk-ops__logsbody");
      logBoxEl.appendChild(inner);
      loadScript("log-source.js", "TarkovLogSource", function (ok) {
        if (!ok || !window.TarkovLogSource) {
          inner.appendChild(el("p", "tk-logsrc__note",
            "同步模块没有载入成功（可能是网络中断）—— 刷新一次再试。"));
          return;
        }
        window.TarkovLogSource.mount(inner, {
          compact: true,
          /* 日志判不出模式时的落点 = 左栏这个分段选的那个（2026-10-25）。
             ⚠️ 必须传 S.mode：作战台切模式只改 S.mode，不写账本的 d.mode，
                所以 log-source 里退回 `TarkovProgress.mode()` 会拿到一个
                读者几个月前在进度页选的模式。 */
          currentMode: function () { return S.mode; },
          onStatus: function (st) {
            /* 摘要行直接显示「已同步到几点」——不用展开就知道进度新不新。 */
            sum.textContent = st.connected
              ? (st.lastSync ? "日志已同步（" + st.lastSync + "）" : "日志已连接")
              : "从游戏日志同步";
          },
          toast: function (msg, ok) {
            var t = el("p", "tk-logsrc__toast" + (ok === false ? " is-bad" : ""), msg);
            inner.appendChild(t);
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
          },
        });
        /* 首次展开口径说明（收起时不占视觉重量）。 */
        var tip = el("p", "tk-logsrc__note");
        tip.innerHTML = "日志里只有「接取 / 完成」；藏身处、等级、目标级勾选与物品数量仍需手勾。"
          + "授权时选 <b>「每次访问都允许」</b> → 以后打开这一页会自动补上新增。";
        inner.appendChild(tip);
      });
    }
    return logBoxEl;
  }

  /* 日志同步的落点：`#tk-ops` 末尾、帮助折叠块之前（2026-10-21）。
     logBoxEl 是单例，appendChild 只是把它从旧位置搬到新位置，节点状态不丢。 */
  function mountFooterLog() {
    var host = document.getElementById(HOST);
    if (!host) return;
    var foot = document.getElementById("tk-ops-foot");
    if (!foot) {
      foot = el("div", "tk-ops__foot");
      foot.id = "tk-ops-foot";
      var help = document.getElementById("tk-ops-help");
      if (help && help.parentNode === host) host.insertBefore(foot, help);
      else host.appendChild(foot);
    }
    foot.appendChild(opsLogBox());
  }

  /* ------------------------------------------------------------ 组装 */
  /* 组装：左（地图/清单）、中（汇总带 + 地图 + 任务清单）、右（搜索/筛选 + 当前任务）。 */
  /* 地图工具条去重（只在本页）：任务筛选/任务搜索与右栏重复 → 删；
     图层开关收进「图层」折叠，工具条从 5 行降到 2 行（实测 218 → 90px）。
     ⚠️ 只动 DOM、不改 map.js 逻辑：换图时 map.js 会重建工具条，
        所以每次 mount 之后都调用一次（dataset 判重防重复包）。 */
  function compactMapBar() {
    /* ① 地图自带的任务清单面板在本页隐藏（2026-10-21）。
       中栏已经有一份任务清单（80 票），面板里还有一份「这张图上的任务 · 31 个」
       —— 两套清单口径不同（任务 vs 任务区域），并列只会让人不知道该信哪个。
       地图页不受影响：这个函数只由 ops-board.js 调用。 */
    var panel = document.querySelector("#tk-map .tk-map__panel");
    if (panel) panel.hidden = true;
    var bar = document.querySelector("#tk-map .tk-map__bar");
    if (!bar || bar.dataset.tkCompact === "1") return;
    bar.dataset.tkCompact = "1";
    var segs = Array.prototype.slice.call(bar.children);
    segs.forEach(function (seg) {
      if (!seg.classList || !seg.classList.contains("tk-map__seg")) return;
      if (seg.querySelector("[data-tk-layer]")) {
        seg.dataset.tkLayersMoved = "1";
        var box = el("details", "tk-ops__drop tk-ops__layerbox");
        box.appendChild(el("summary", "tk-map__btn", "图层"));
        var row = el("span", "tk-ops__layerrow");
        row.appendChild(seg);
        box.appendChild(row);
        bar.appendChild(box);
        return;
      }
      var t = seg.textContent || "";
      /* ② 缩放 / 重置 / 测距 / 全屏 收进「视图」（2026-10-21）：
         滚轮与拖拽已经覆盖缩放平移，测距与全屏一个月用不到一次，
         但它们常驻占着工具条一整段。楼层与图层不在此列 —— 那是选图必看的东西。 */
      if (t.indexOf("放大") >= 0 && t.indexOf("缩小") >= 0) {
        var vbox = el("details", "tk-ops__drop tk-ops__viewbox");
        vbox.appendChild(el("summary", "tk-map__btn", "视图"));
        var vrow = el("span", "tk-ops__viewrow");
        vrow.appendChild(seg);
        vbox.appendChild(vrow);
        bar.appendChild(vbox);
        return;
      }
      if (t.indexOf("全部任务") >= 0 || seg.classList.contains("tk-map__seg--search")) {
        seg.remove();
      }
    });
  }

  /* 图例与说明（128 + 48px 的常驻文字）收进一个折叠块：新读者要的时候点开，
     老读者不用每次滚过它才能看到任务清单。 */
  function foldLegend() {
    var host = document.getElementById("tk-map");
    if (!host) return;
    var lg = host.querySelector(".tk-map__legend");
    if (!lg || lg.closest(".tk-ops__legendbox")) return;
    var nt = host.querySelector(".tk-map__note");
    var box = el("details", "tk-ops__legendbox");
    box.appendChild(el("summary", "tk-ops__sum", "图例与说明"));
    var body = el("div", "tk-ops__legendbody");
    body.appendChild(lg);
    if (nt) body.appendChild(nt);
    box.appendChild(body);
    var bar = host.querySelector(".tk-map__bar");
    if (bar && bar.parentNode === host) host.insertBefore(box, bar.nextSibling);
    else host.appendChild(box);
  }

  function paint() {
    var left = document.getElementById("tk-ops-left");
    var right = document.getElementById("tk-ops-right");
    if (!left || !right) return;

    /* 左栏是独立滚动容器（`tk-ops.css` 的 max-height:78vh + overflow-y:auto）。
       整块重建会把 scrollTop 归零 —— 「滚下去挑票，一点就跳回顶上」的根因。
       与搜索框焦点同一处理方式：先存后还（2026-10-25）。 */
    var leftTop = left.scrollTop;

    /* 全量重建会销毁搜索框 —— 正在打字时记下焦点与光标，建完还回去。 */
    var prevSearch = document.querySelector(".tk-ops__search");
    var hadFocus = !!prevSearch && document.activeElement === prevSearch;
    var caret = null;
    if (hadFocus) {
      try { caret = [prevSearch.selectionStart, prevSearch.selectionEnd]; } catch (e) { caret = null; }
    }

    left.textContent = "";
    left.appendChild(buildMapList());
    /* buildMapList 建的是**还没入 DOM** 的节点，它内部那次 renderMapRows 拿不到
       #tk-ops-maplist，等于空转 —— 真正这一遍在这里（2026-10-21 去掉了内部那次）。 */
    renderMapRows();
    left.appendChild(buildPlan());
    /* 日志同步从「左栏底部」挪到「页面底部」（2026-10-21）：它是一次性设置，
       原来占着左栏最黄金的位置，每次选图都要滚过它。 */
    mountFooterLog();
    /* 还回去（内容变短时浏览器会自己 clamp，不会抛） */
    left.scrollTop = leftTop;

    var brief = document.getElementById("tk-ops-briefbar");
    if (brief) buildBriefBar(brief);
    var tasks = document.getElementById("tk-ops-tasks");
    if (tasks) renderTaskList(tasks);
    /* 提示只说一次：已经画进 DOM 了，下一次重绘就不该再出现 */
    S.notice = "";

    var search = el("input", "tk-ops__search");
    search.type = "search";
    search.placeholder = "搜任务 / 地名 / 物品（/ 聚焦）";
    search.value = S.q;
    /* ⚠️ 输入时**绝不能调 paint()**（会销毁搜索框本身 → 「只能输入一个字符」）。
       这里只重绘「中栏清单 + 右栏内容」，搜索框留在原地，焦点与光标都不动。 */
    var urlTimer = null;
    search.addEventListener("input", function () {
      S.q = search.value.trim();
      var t = document.getElementById("tk-ops-tasks");
      if (t) renderTaskList(t);
      renderRightBody();
      if (urlTimer) clearTimeout(urlTimer);
      urlTimer = setTimeout(function () { urlTimer = null; syncUrl(); }, 400);
    });
    right.textContent = "";
    right.appendChild(search);
    var seg = el("div", "tk-ops__seg");
    /* 常驻 4 档（2026-10-21）：未完成 / 可接 / 已完成 / 全部。
       原来 7 档平铺，其中「进行中」是「未完成」的子集、「钉住」「已忽略」是
       读者自己标的极少数票 —— 三档合计不到 3%，却各占一个按钮的位置。 */
    [["open", "未完成"], ["ready", "可接"], ["done", "已完成"], ["all", "全部"]]
      .forEach(function (p) {
        var b = el("button", "tk-ops__segb", p[1]);
        b.type = "button";
        b.setAttribute("aria-pressed", p[0] === S.filter ? "true" : "false");
        b.addEventListener("click", function () {
          S.filter = p[0];
          paint();
          syncUrl();
          revealTasks();
        });
        seg.appendChild(b);
      });
    /* 「更多」：进行中 / 钉住 / 已忽略。当前若正处在这三档之一，summary 直接显示
       那一档的名字 —— 否则读者会以为自己在「未完成」，实际在看「已忽略」。 */
    var LOW = [["inhand", "进行中"], ["pinned", "钉住"], ["ignored", "已忽略"]];
    var curLow = LOW.filter(function (p) { return p[0] === S.filter; })[0];
    var more = el("details", "tk-ops__moreseg");
    more.appendChild(el("summary", "tk-ops__segb" + (curLow ? " is-on" : ""),
      curLow ? curLow[1] : "更多"));
    var mbody = el("div", "tk-ops__morebody");
    LOW.forEach(function (p) {
      var b = el("button", "tk-ops__segb" + (p[0] === S.filter ? " is-on" : ""), p[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        S.filter = p[0];
        paint();
        syncUrl();
        revealTasks();
      });
      mbody.appendChild(b);
    });
    more.appendChild(mbody);
    seg.appendChild(more);
    right.appendChild(seg);
    /* 「仅本图 / 全站」两档删掉（2026-10-21）：规则改成「有搜索词就跨图」，
       见 visibleTasks()。少两个常驻按钮，而跨图这件事只在该搜的时候才发生。 */

    /* 「我的等级」（2026-10-21）：填了才判「等级够不够」，不填一律算够。
       只存在本机（localStorage），不上传、不进 URL —— 它是个人状态，不是分享态。
       ⚠️ input 事件里**不能 paint()**：那会把这个输入框本身重建掉，
          症状和搜索框一模一样（输一个数字就丢焦点）。 */
    var lvRow = el("label", "tk-ops__lv");
    lvRow.appendChild(el("span", "tk-ops__lvlabel", "我的等级"));
    var lvIn = el("input", "tk-ops__lvin");
    lvIn.type = "number";
    lvIn.min = "1";
    lvIn.max = "79";
    lvIn.placeholder = "不限";
    lvIn.value = S.lv ? String(S.lv) : "";
    lvIn.title = "填了才判断「等级够不够」（只存在本机）";
    lvIn.addEventListener("input", function () {
      var v = parseInt(lvIn.value, 10);
      /* clamp 到 1–79：input 的 max 只是浏览器提示，手输 200 一样能进来，
         那会让「可接」判定把所有等级门槛都放过去（2026-10-25）。 */
      S.lv = isFinite(v) && v > 0 ? Math.min(79, v) : 0;
      saveLv(S.lv);
      var tb = document.getElementById("tk-ops-tasks");
      if (tb) renderTaskList(tb);
      renderRightBody();
      var brief2 = document.getElementById("tk-ops-briefbar");
      if (brief2) buildBriefBar(brief2);
    });
    lvRow.appendChild(lvIn);
    right.appendChild(lvRow);

    var jumpBox = el("div", "tk-ops__jumpbox");
    jumpBox.id = "tk-ops-jumpbox";
    right.appendChild(jumpBox);
    var detail = el("div", "tk-ops__detail");
    detail.id = "tk-ops-detail";
    right.appendChild(detail);

    renderRightBody();
    compactMapBar();
    document.querySelectorAll(".tk-ops__mode").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.mode === S.mode ? "true" : "false");
    });

    if (hadFocus) {
      var now = document.querySelector(".tk-ops__search");
      if (now) {
        now.focus();
        if (caret) { try { now.setSelectionRange(caret[0], caret[1]); } catch (e) { /* 类型不支持：光靠 focus 也够用 */ } }
      }
    }
  }

  /* ---------------------------------------------------------- 右栏：内容 */
  /* 右栏空态 = 「本图下一步」（2026-10-21）：未选中时不再只留一句引导，而给
     本图未完成且可接的票，按目标数从多到少 —— 目标多 = 一局能推进的进度多。 */
  function buildNextUp(box) {
    var cands = [];
    if (S.idx && S.idx.tasks) {
      for (var qid in S.idx.tasks) {
        var t = taskOf(qid);
        if (!t || !inMap(t)) continue;
        var st = stateOf(qid);
        /* 与「可接」同一口径（2026-10-21）：手上已有的票不算「能接」，
           否则这一栏的票数与简报条 / 筛选档三处永远对不上。 */
        if (st === "done" || st === "ignored" || st === "inhand") continue;
        if (!gate(qid).ok) continue;
        cands.push({ qid: qid, t: t, st: st, n: (t.oids || []).length });
      }
    }
    cands.sort(function (a, b) { return b.n - a.n; });
    var head = el("div", "tk-ops__nuhead");
    head.appendChild(el("b", null, "这张图现在能接的"));
    head.appendChild(el("span", "tk-ops__chainn", cands.length ? cands.length + " 票" : "0"));
    box.appendChild(head);
    if (!cands.length) {
      /* 「0 票可接」有两种原因，不能共用一句话（2026-10-21）：等级/前置卡住，
         或这张图的活已经全接在手上了。 */
      var st0 = mapStats();
      var msg;
      if (st0.inhand) {
        msg = "这张图能接的都接了 —— 手上还有 " + st0.inhand + " 票在做，看「更多 › 进行中」。";
      } else if (st0.open) {
        msg = S.lv
          ? "按你填的等级，这张图上没有可接的活 —— 降低等级，或看「未完成」里缺前置的票。"
          : "这张图上没有可接的活 —— 填一下「我的等级」，或看「未完成」里缺前置的票。";
      } else {
        msg = "这张图上没有未完成的活了。";
      }
      box.appendChild(el("p", "tk-ops__dempty", msg));
      box.appendChild(el("p", "tk-ops__muted", "↑↓ 选行 · 回车定位 · / 搜索 · 1 2 3 切模式"));
      return;
    }
    var list = el("div", "tk-ops__nulist");
    /* 卡片左侧不再画 ①②③（2026-10-25）：那个编号看着像「按 1 选第一张」，
       而数字键 1/2/3 实际是**切模式** —— 视觉暗示与键位行为正好错开。
       改成纯装饰点，排序含义靠「目标 N/M」自己表达。 */
    cands.slice(0, 3).forEach(function (c) {
      var card = el("button", "tk-ops__nucard");
      card.type = "button";
      var top = el("span", "tk-ops__nutop");
      top.appendChild(el("span", "tk-ops__nun tk-ops__nun--dot"));
      top.appendChild(el("b", "tk-ops__nuname", c.t.name || "（无中文名）"));
      card.appendChild(top);
      var meta = [];
      if (c.t.trader) meta.push(c.t.trader);
      if (c.n) meta.push("目标 " + metCount(c.t, c.qid) + "/" + c.n);
      if (c.t.level) meta.push("Lv " + c.t.level);
      if (c.t.keys) meta.push("钥匙 " + c.t.keys);
      card.appendChild(el("span", "tk-ops__numeta", meta.join(" · ")));
      card.addEventListener("click", function () { gotoTask(c.qid); });
      list.appendChild(card);
    });
    box.appendChild(list);
    if (cands.length > 3) {
      box.appendChild(el("p", "tk-ops__muted",
        "另有 " + (cands.length - 3) + " 票可接 —— 在右栏「可接」里看全部。"));
    }
    box.appendChild(el("p", "tk-ops__muted", "点一张就定位到图上 · ↑↓ 选行 · 回车定位 · / 搜索"));
  }

  /* 同名任务在前置链上会读成「要完成 X 才能接 X」（2026-10-21 实测）：
     上游确实有 9 组重名（人靠衣装 - 1 / 纺织业 - 2 / 平衡之力 - 2（PVE）…），
     它们是**两条不同的票**，不是渲染错。加一句说明，读者才看得懂。 */
  function chainName(name, selfName) {
    if (!name) return "（无中文名）";
    return name === (selfName || "") ? name + "（同名另一条）" : name;
  }

  function renderDetail(box, keepScroll) {
    /* 清空会把 scrollTop 归零，所以先存下来（keepScroll = 同票原地刷新） */
    var keepTop = keepScroll ? box.scrollTop : 0;
    box.textContent = "";
    var qid = S.selQ;
    var t = qid ? taskOf(qid) : null;
    if (!t) {
      buildNextUp(box);
      return;
    }
    var st = stateOf(qid);
    /* 「未标记」有两种写法：`stateOf()` 返回 `"none"`，而三态控件用 `""`
       （账本里没这个键）。不归一的话 `st === ""` 永不成立 —— 三态按钮一个都不高亮，
       点徽章也会在「未标记 → 未标记」之间空转（2026-10-25 headless 实测抓到）。 */
    var stKey = st === "none" ? "" : st;

    var head = el("div", "tk-ops__dhead");
    head.appendChild(el("span", "tk-ops__badge tk-ops__badge--" + st, ST_TXT[st] || "未标记"));
    head.appendChild(el("b", "tk-ops__dname", t.name || "（无中文名）"));
    if (t.flags === "k") head.appendChild(el("span", "tk-ops__kflag", "Kappa"));
    else if (t.flags === "l") head.appendChild(el("span", "tk-ops__kflag", "LK"));
    var close = el("button", "tk-ops__dclose", "×");
    close.type = "button";
    close.title = "取消选中";
    close.addEventListener("click", function () {
      S.selQ = null; S.selO = null; paint(); syncUrl();
    });
    head.appendChild(close);
    box.appendChild(head);

    var nobj = (t.oids || []).length;
    var met = metCount(t, qid);
    if (nobj) {
      var pw = el("div", "tk-ops__dprog");
      var pb = el("span", "tk-ops__dpbar");
      var fill = el("i");
      fill.style.width = Math.round(met / nobj * 100) + "%";
      pb.appendChild(fill);
      pw.appendChild(pb);
      pw.appendChild(el("span", "tk-ops__dpn", met + "/" + nobj + " 目标"));
      box.appendChild(pw);
    }
    var bits = [];
    if (t.trader) bits.push("商人 " + t.trader);
    if (t.level) bits.push("Lv " + t.level);
    if (t.keys) bits.push("钥匙 " + t.keys + " 把");
    if ((t.ms || []).length) bits.push("出现于 " + t.ms.length + " 张图");
    box.appendChild(el("div", "tk-ops__dmeta", bits.join(" · ")));

    /* 这一票现在能不能接：一行说清（行里已经有角标，但详情卡要能独立读懂）。
       已完成的票不再标「可接」—— 那是噪音。 */
    if (st !== "done" && st !== "ignored") {
      var g1 = gate(qid);
      var gline = el("div", "tk-ops__dgate");
      if (g1.ok) gline.appendChild(el("span", "tk-ops__ready", "现在可接"));
      else if (g1.lvShort) gline.appendChild(el("span", "tk-ops__locked", "等级不够 · 需 Lv " + t.level));
      else gline.appendChild(el("span", "tk-ops__locked", "缺 " + g1.miss.length + " 个前置"));
      if (g1.unknown.length) {
        gline.appendChild(el("span", "tk-ops__muted",
          "另有 " + g1.unknown.length + " 个前置不在本模式任务库"));
      }
      box.appendChild(gline);
    }

    /* ---- 前置 / 后续（2026-10-21）----------------------------------------
       这一块回答的是「这一票为什么还接不了」—— 选任务时最常问的一句。
       数据来源：ops-index 的 pr 列（只含「必须完成」类前置）。
       ⚠️ 不用 ✓ / ○ 做状态点：U+2713 与 U+25CB 都落在图标统计块里，
          `check_icons.py` 会把它们算成「表外图标」并卡住 CI。改用 CSS 圆点。 */
    var pres = t.pr || [];
    var chain = el("div", "tk-ops__chain");
    var cHead = el("div", "tk-ops__chainhead");
    cHead.appendChild(el("b", null, "前置"));
    var preDone = pres.filter(function (p) { return stateOf(p) === "done"; }).length;
    cHead.appendChild(el("span", "tk-ops__chainn",
      pres.length ? (preDone + " / " + pres.length + " 已完成") : "无"));
    chain.appendChild(cHead);
    if (!pres.length) {
      chain.appendChild(el("p", "tk-ops__muted",
        "上游没给这条任务的「必须完成」类前置 —— 可能是起始票，也可能只在特殊条件下才锁。"));
    } else {
      var ul = el("ul", "tk-ops__chainlist");
      pres.forEach(function (p) {
        var pt = taskOf(p);
        var done = stateOf(p) === "done";
        var li = el("li", done ? "is-done" : "");
        var b = el("button", "tk-ops__chainbtn");
        b.type = "button";
        b.appendChild(el("i", "tk-ops__dot" + (done ? " is-done" : "")));
        b.appendChild(el("span", "tk-ops__chainname",
          pt ? chainName(pt.name, t.name) : "（不在本模式任务库）"));
        if (pt && pt.trader) b.appendChild(el("span", "tk-ops__chaintrader", pt.trader));
        if (pt) b.addEventListener("click", function () { gotoTask(p); });
        else b.disabled = true;
        li.appendChild(b);
        ul.appendChild(li);
      });
      chain.appendChild(ul);
      var leftN = pres.filter(function (p) { return stateOf(p) !== "done"; }).length;
      if (leftN) {
        chain.appendChild(el("p", "tk-ops__chainhint",
          "还差 " + leftN + " 个前置 —— 点名字跳过去，跨图会自动换图。"));
      }
    }
    box.appendChild(chain);

    /* 后续不单开一节：它只在「做完了这一票能开什么」时有用，取前 5 个就够，
       多了会把详情卡撑过一屏。 */
    var nx = nextOf(qid);
    if (nx.length) {
      var nbox = el("div", "tk-ops__chain tk-ops__chain--next");
      var nHead = el("div", "tk-ops__chainhead");
      nHead.appendChild(el("b", null, "后续"));
      nHead.appendChild(el("span", "tk-ops__chainn", "解锁 " + nx.length + " 个"));
      nbox.appendChild(nHead);
      var ul2 = el("ul", "tk-ops__chainlist");
      /* 默认只列前 5 个（多了会把详情卡撑过一屏），但给一条「展开」——
         原来是一句死文案「另有 N 个」，想看也看不到（2026-10-25）。 */
      var nxShow = (S.nextAllFor === qid) ? nx : nx.slice(0, 5);
      nxShow.forEach(function (nq) {
        var nt = taskOf(nq);
        var li = el("li");
        var b = el("button", "tk-ops__chainbtn");
        b.type = "button";
        b.appendChild(el("i", "tk-ops__dot is-next"));
        b.appendChild(el("span", "tk-ops__chainname",
          nt ? chainName(nt.name, t.name) : nq));
        if (nt && nt.trader) b.appendChild(el("span", "tk-ops__chaintrader", nt.trader));
        b.addEventListener("click", function () { gotoTask(nq); });
        li.appendChild(b);
        ul2.appendChild(li);
      });
      nbox.appendChild(ul2);
      if (nx.length > 5 && S.nextAllFor !== qid) {
        var nxMore = el("button", "tk-ops__more",
          "另有 " + (nx.length - 5) + " 个 —— 展开");
        nxMore.type = "button";
        nxMore.addEventListener("click", function () {
          S.nextAllFor = qid;
          renderRightBody();
        });
        nbox.appendChild(nxMore);
      }
      box.appendChild(nbox);
    }

    var objs = el("ul", "tk-ops__dobjs");
    var otexts = (t.otxt || "").split("|");
    (t.oids || []).forEach(function (oid, oi) {
      var li = el("li");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = objDone(qid, oid);
      cb.addEventListener("change", function () { setObj(qid, oid, cb.checked); });
      li.appendChild(cb);
      var otxt = (otexts[oi] || "").trim();
      var sp = el("span", "tk-ops__objtxt", otxt || ("目标 " + (oi + 1)));
      sp.title = otxt || ("目标 " + (oi + 1));
      li.appendChild(sp);
      if (cb.checked) li.classList.add("is-done");
      if (oid === S.selO) li.classList.add("is-cur");
      li.addEventListener("click", function (e) {
        if (e.target === cb) return;
        focusTask(qid, oid);
      });
      objs.appendChild(li);
    });
    if (!nobj) objs.appendChild(el("li", "tk-ops__muted", "这条任务上游没给目标明细"));
    box.appendChild(objs);

    var acts = el("div", "tk-ops__dacts");
    /* 主状态：三态分段（2026-10-25）。此前只有一个「标为已完成 / 未完成」的
       二态按钮 —— 而「接了这一票」（进行中）比「做完了」更高频，站内却没有入口，
       只能跳去「我的进度」页。与进度页的三态控件同口径。 */
    var stSeg = el("div", "tk-ops__stseg");
    [["", "未标记"], ["inhand", "进行中"], ["done", "已完成"]]
      .forEach(function (p) {
        var b = el("button", "tk-ops__stb" + (stKey === p[0] ? " is-on" : ""), p[1]);
        b.type = "button";
        b.setAttribute("aria-pressed", stKey === p[0] ? "true" : "false");
        b.addEventListener("click", function () { setState(qid, p[0]); });
        stSeg.appendChild(b);
      });
    acts.appendChild(stSeg);

    /* 次动作：加入出击 / 钉住 / 不做这票。
       ⚠️ 钉住与忽略此前**全站没有写入入口**（`progress.js` 的 togglePin /
          toggleIgnore 零调用点），于是筛选里那两档永远返回空
          （2026-10-25 修）。 */
    var chips = el("div", "tk-ops__dchips");
    var add = el("button", "tk-ops__chip", qid in S.plan ? "移出出击" : "加入出击");
    add.type = "button";
    add.addEventListener("click", function () { togglePlan(qid); });
    chips.appendChild(add);

    var pinned = isPinned(qid);
    var pin = el("button", "tk-ops__chip" + (pinned ? " is-on" : ""),
      pinned ? "已钉住" : "钉住");
    pin.type = "button";
    pin.title = "钉住的任务排在清单前面（可与进行中 / 已完成并存）";
    pin.addEventListener("click", function () {
      var P = window.TarkovProgress;
      if (!P || !P.togglePin) return;
      markSelfEdit();
      try { P.togglePin(qid, S.mode); } catch (e) { /* 无进度模块 */ }
      refreshAfterState(qid);
    });
    chips.appendChild(pin);

    var ign = el("button", "tk-ops__chip" + (st === "ignored" ? " is-on" : ""),
      st === "ignored" ? "恢复这票" : "不做这票");
    ign.type = "button";
    ign.title = "标为「这赛季不做」：只影响统计口径，不改任务本身";
    ign.addEventListener("click", function () {
      var P = window.TarkovProgress;
      if (!P || !P.toggleIgnore) return;
      markSelfEdit();
      try { P.toggleIgnore(qid, S.mode); } catch (e) { /* 无进度模块 */ }
      refreshAfterState(qid);
    });
    chips.appendChild(ign);

    acts.appendChild(chips);
    box.appendChild(acts);
    /* 原地刷新时把滚动位置还回去（见函数开头 keepTop） */
    if (keepScroll) box.scrollTop = keepTop;
  }

  function renderRightBody() {
    var jumpBox = document.getElementById("tk-ops-jumpbox");
    var detail = document.getElementById("tk-ops-detail");
    if (jumpBox) {
      jumpBox.textContent = "";
      if (S.q) {
        var hit = findCallout(S.q, S.map);
        if (hit) {
          var jump = el("button", "tk-ops__jump");
          jump.type = "button";
          jump.textContent = "📍 地图上有「" + hit.cn + "」—— 飞过去";
          jump.addEventListener("click", function () {
            try {
              window.dispatchEvent(new CustomEvent("tk:map:focusPoint",
                { detail: { x: hit.x, y: hit.y } }));
            } catch (e) {}
          });
          jumpBox.appendChild(jump);
        }
      }
    }
    if (detail) renderDetail(detail);
  }

  function boot() {
    readUrl();
    S.lv = loadLv();          // 「我的等级」只在本机，不进 URL
    /* 出击清单按**模式**分账本（2026-10-25）：必须放在 readUrl 之后 ——
       URL 可能已经把 S.mode 改成 pvp / season，先读就会拿到错的那本。 */
    S.plan = loadPlan(S.mode);
    var bootMode = S.mode;
    var m = document.getElementById("tk-map");
    if (m) {
      /* 「无地图」不设 data-map：设了 map.js 会去取 maps-data-__nomap.js（404） */
      if (S.map !== NOMAP) m.setAttribute("data-map", S.map);
      m.setAttribute("data-mode", bootMode === "season" ? "pvp" : bootMode);
      m.setAttribute("data-tk-hover-tip", "1");
    }
    loadScript(idxFile(bootMode), idxKey(bootMode), function (ok) {
      if (S.mode !== bootMode) return;      // 载入期间读者已切模式：让那次的结果说了算
      S.idx = ok ? window[idxKey(bootMode)] : null;
      S.idxError = !ok;
      paint();
    });
    if (S.map === NOMAP) {
      /* 伪图：没有地图可挂，remountMap 只渲染一句说明；不必为它下 93 KB 的 map.js */
      remountMap();
    } else {
      loadScript("map.js", null, function () {
        remountMap();
        compactMapBar();
      });
    }
    /* 操作说明的可见入口（2026-10-21）：帮助块原来只有 `?` 键能开，
       鼠标读者永远看不到「三个手势」与「可接怎么算」—— 那恰好是最该被看见的两段。 */
    var hb = document.querySelector("[data-tk-help]");
    if (hb && hb.dataset.tkHelpBound !== "1") {
      hb.dataset.tkHelpBound = "1";
      hb.addEventListener("click", showHelp);
    }
    applyWidths();
    bindGrips();
    /* map.js 的数据是异步到的：工具条会被重建（新节点 = 没有 tkCompact 标记）。
       挂一个只看子树的观察者，重建一次就压一次；compactMapBar 自身幂等。 */
    if (!window.__tkOpsBarWatch) {
      window.__tkOpsBarWatch = true;
      var root = document.getElementById(HOST);
      if (root && window.MutationObserver) {
        var queued = false;
        new MutationObserver(function () {
          if (queued) return;
          queued = true;
          setTimeout(function () { queued = false; compactMapBar(); foldLegend(); }, 80);
        }).observe(root, { childList: true, subtree: true });
      }
    }
    bindMapToRight();
    bindHover();
    syncUrl();
    /* 进度一变就重绘（勾选、日志同步、别的标签页…）。
       ⚠️ **必须合并密集更新**（2026-10-18）：日志同步一次并入 100+ 条任务，
         每条都 emit 一次 → 直接 paint 会连续重绘上百次，主线程卡住、进度条不动。
         策略：平时立即重绘（勾选要手感），200ms 内的后续变更合并成一次。 */
    var lastPaintAt = 0, paintPending = false;
    function repaintSoon() {
      /* 自己刚写的那一下：显示已在 setState / setObj 里局部刷过，
         这里再整块重绘只会把滚动位置与键盘行冲掉（见 markSelfEdit）。 */
      if (Date.now() < selfEditUntil) return;
      var now = Date.now();
      if (now - lastPaintAt > 200) {
        lastPaintAt = now;
        paint();
        return;
      }
      if (paintPending) return;
      paintPending = true;
      setTimeout(function () {
        paintPending = false;
        lastPaintAt = Date.now();
        paint();
      }, 200);
    }
    /* ⚠️ 对外 API 叫 **subscribe**，不是 onChange（2026-10-18 用真实日志才发现）：
       之前写的是 `if (P && typeof P.onChange === "function")`，而 onChange 根本
       不存在 → 条件永远 false → **这一段从来没执行过**，作战台对外部进度变更
       完全不响应。手工勾选看不出问题，因为 setState() 里直接调了 paint()；
       日志同步、进度页改状态、别的标签页改动全都不会反映。
       这里同时兼容两种写法，两个都试一遍。 */
    /* ⚠️ 文档级监听只绑一次：instant 换页会重新 boot 一次，重复绑会让
       一次按键走两遍、一次进度变更触发两次重绘。 */
    if (!globalBound) {
      globalBound = true;
      bindKeys();
      var P = window.TarkovProgress;
      if (P && typeof P.subscribe === "function") {
        P.subscribe(repaintSoon);
      } else if (P && typeof P.onChange === "function") {
        P.onChange(repaintSoon);
      } else {
        document.addEventListener("tarkov:progress", repaintSoon);
      }
    }
  }

  /* 进入/离开 /ops/ 的三个时机都要覆盖：
       · 直接打开（或刷新）—— 脚本由 mount-loader.js 注入，readyState 可能已是 complete；
       · 首次加载 —— DOMContentLoaded；
       · instant 换页 —— 不重跑脚本、不触发 DOMContentLoaded，靠 document$。 */
  function bootIfNeeded() {
    var h = document.getElementById(HOST);
    if (!h || h === host) return;
    host = h;
    boot();
  }

  /* 给单测用（与 log-sync.js 的 `_scanText` 同一条约定）：这一层是纯逻辑，
     不依赖真实 DOM —— 喂一份假索引就能验证「搜目标文本能不能命中」这类判据。
     ⚠️ 命名带 `Test` 且只在 tests/ 里被引用，不是公开 API。 */
  window.TarkovOpsTest = { _S: S, _visible: visibleTasks, _rowBits: rowBits };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootIfNeeded);
  } else {
    bootIfNeeded();
  }
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(bootIfNeeded);
  }
})();
