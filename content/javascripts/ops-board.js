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
  /* 模式段：PvE 第一 / 赛季第二 / PvP 第三（用户定的优先级）。
     ⚠️ 赛季**没有独立数据源**（上游 /season/tasks 实测 404），所以它共用 PvP
        的任务库、只把进度分轨独立开出来 —— 界面上如实标注，不假装有专属数据。 */
  var MODES = [
    ["pve", "PvE", "PvE 剧情：独立任务库（500 条，含 23 条 PvE 独占）"],
    ["season", "赛季 PvP", "赛季模式：任务库与 PvP 相同，进度独立分轨"],
    ["pvp", "PvP", "持久 PvP：504 条标准任务"],
  ];
  var COLS = ["name", "en", "trader", "level", "ms", "oids", "otxt", "nObj", "keys", "flags", "pr"];

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
    row: 0,              // 键盘当前行
    idx: null,           // 当前模式的 ops index
    plan: {},            // 出击清单（会话级，与进度严格分开）
    mapq: "",            // 左栏地图名过滤
    mapsAll: false,      // 地图清单是否全展开
    planAll: false,      // 出击清单是否全展开
    tasksOpen: true,     // 中栏任务清单是否展开
    tasksAll: false,     // 任务清单是否展开到全部（默认 20 行）
    lv: 0,               // 「我的等级」：0 = 不限，用于可接判定（存 localStorage）
    base: null,          // 进度账本
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

  /* ---- Callout 别名索引（2026-10-18）------------------------------------
     地名可以有好几个叫法：上游英文名、站内中文译名、玩家口语俗称。
     搜索三者都要命中 —— 「搜宿舍区」和「搜 Dorms」是同一件事。
     索引在第一次用到时建一次，来源是 maps-data 里已挂好的 labels[].al。 */
  var CALL_IDX = null;
  function calloutIndex() {
    if (CALL_IDX) return CALL_IDX;
    CALL_IDX = {};
    var maps = window.TARKOV_MAPS || {};
    for (var mk in maps) {
      var labels = (maps[mk] || {}).labels || [];
      for (var i = 0; i < labels.length; i++) {
        var lb = labels[i];
        var names = [];
        if (lb.en) names.push(lb.en);
        if (lb.cn) names.push(lb.cn);
        (lb.al || []).forEach(function (a) { names.push(a); });
        if (!names.length) continue;
        var rec = CALL_IDX[mk] || (CALL_IDX[mk] = []);
        rec.push({ names: names, x: lb.x, y: lb.y, cn: lb.cn || lb.en });
      }
    }
    return CALL_IDX;
  }
  /* 搜地名：命中就返回该地标（含坐标，用来在图上飞过去） */
  function findCallout(q, mapKey) {
    var ql = (q || "").toLowerCase();
    if (!ql) return null;
    var rows = calloutIndex()[mapKey] || [];
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
  function setState(qid, v) {
    var P = window.TarkovProgress;
    if (!P) return;
    try {
      P.setTaskState(qid, v, undefined, S.mode);
      /* 状态与目标勾选必须一致（2026-10-18 修）：把任务标为「已完成」时一并
         勾满它的目标，否则行头会出现「已完成 · 0/8 目标」——两行字自相矛盾，
         读者没法判断到底做完了没有。标为未完成则清空目标，与进度看板
         alignObjectives 的口径一致（那里是展开时才自愈，这里当场对齐）。 */
      var t = taskOf(qid);
      if (t && P.alignObjectives) P.alignObjectives(qid, t.oids || [], v, S.mode);
    } catch (e) { /* 无进度模块时不阻断 */ }
    paint();
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
    try { P.setObjective(qid, oid, v, S.mode); } catch (e) { return; }
    var t = taskOf(qid);
    var ids = (t && t.oids) || [];
    var met = metCount(t, qid);
    if (ids.length && met === ids.length) P.setTaskState(qid, "done", undefined, S.mode);
    else if (met > 0) P.setTaskState(qid, "inhand", undefined, S.mode);
    paint();
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
    if (ms.length && ms.indexOf(S.map) < 0) { S.map = ms[0]; remountMap(); }
    S.selQ = qid; S.selO = null;
    paint();
    selectOnMap(qid);
    highlight();
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
    S.mode = mode;
    S.selQ = null; S.selO = null;
    NEXT = null;              // 任务库换了，后续索引必须重建
    /* 赛季与 PvP 共用任务库 —— 上游没有赛季端点（实测 404），如实说明。 */
    loadScript("ops-index-" + (mode === "season" ? "pvp" : mode) + ".js",
      "TARKOV_OPS_INDEX_" + mode.toUpperCase(), function () {
        S.idx = window["TARKOV_OPS_INDEX_" + mode.toUpperCase()];
        paint();
      });
    /* 地图挂载点换模式：map.js 会重读 zone.m */
    var m = document.getElementById("tk-map");
    if (m) m.setAttribute("data-mode", mode === "season" ? "pvp" : mode);
    remountMap();
    syncUrl();
  }

  /* ---------------------------------------------------------- 左栏：地图条 */
  function mapRows() {
    var rows = [];
    MAPS.forEach(function (m) {
      var key = m[0];
      var n = 0, inhand = 0, done = 0;
      if (S.idx && S.idx.tasks) {
        for (var qid in S.idx.tasks) {
          var t = taskOf(qid);
          if (!t || (t.ms || []).indexOf(key) < 0) continue;
          var st = stateOf(qid);
          if (st === "done") { done++; continue; }
          if (st === "inhand") { inhand++; n++; continue; }
          n++;
        }
      }
      rows.push({ key: key, name: m[1], n: n, inhand: inhand, done: done });
    });
    rows.sort(function (a, b) {
      var d = (b.n + b.inhand) - (a.n + a.inhand);
      return d !== 0 ? d : (MAPS.findIndex(function (m) { return m[0] === a.key; })
        - MAPS.findIndex(function (m) { return m[0] === b.key; }));
    });
    return rows;
  }
  function mapMatch(r) {
    if (!S.mapq) return true;
    return (r.name + " " + r.key).toLowerCase().indexOf(S.mapq.toLowerCase()) >= 0;
  }
  /* 只重绘地图清单本身 —— 搜索框不能跟着重建，否则又是「输一个字丢一次焦点」。 */
  function renderMapRows() {
    var box = document.getElementById("tk-ops-maplist");
    if (!box) return;
    box.textContent = "";
    var rows = mapRows().filter(mapMatch);
    var LIMIT = 6;
    var all = S.mapsAll || !!S.mapq || rows.length <= LIMIT;
    rows.slice(0, all ? rows.length : LIMIT).forEach(function (r) {
      var b = el("button", "tk-ops__map" + (r.key === S.map ? " is-on" : ""));
      b.type = "button";
      b.dataset.map = r.key;
      var line = el("span", "tk-ops__mapline");
      line.appendChild(el("b", null, r.name));
      line.appendChild(el("span", "tk-ops__mapn", r.n ? String(r.n) : (r.done ? "✓" : "—")));
      b.appendChild(line);
      var meta = el("span", "tk-ops__mapmeta");
      meta.textContent = r.n
        ? ("未完成 " + r.n + (r.inhand ? " · 进行中 " + r.inhand : ""))
        : (r.done ? ("已完成 " + r.done) : "没有记录");
      b.appendChild(meta);
      b.addEventListener("click", function () { switchMap(r.key); });
      box.appendChild(b);
    });
    if (!rows.length) box.appendChild(el("p", "tk-ops__muted", "没有匹配的地图"));
    if (!S.mapq && rows.length > LIMIT) {
      var more = el("button", "tk-ops__more",
        S.mapsAll ? "收起地图" : "更多地图（" + (rows.length - LIMIT) + "）");
      more.type = "button";
      more.addEventListener("click", function () { S.mapsAll = !S.mapsAll; renderMapRows(); });
      box.appendChild(more);
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
    renderMapRows();
    return box;
  }
  function switchMap(key) {
    S.map = key; S.selQ = null; S.selO = null;
    remountMap();
    paint();
    syncUrl();
  }


  /* ------------------------------------------------------------ 图层开关 */

  /* ------------------------------------------------------------ 出击清单 */
  function planIds() { return Object.keys(S.plan); }
  function mapStats() {
    var out = { total: 0, open: 0, ready: 0, inhand: 0, done: 0, ignored: 0, keys: 0 };
    if (!S.idx || !S.idx.tasks) return out;
    for (var qid in S.idx.tasks) {
      var t = taskOf(qid);
      if (!t || (t.ms || []).indexOf(S.map) < 0) continue;
      out.total++;
      var st = stateOf(qid);
      if (st === "done") out.done++;
      else if (st === "inhand") { out.inhand++; out.open++; }
      else if (st === "ignored") out.ignored++;
      else { out.open++; if (gate(qid).ok) out.ready++; }
      out.keys += (t.keys || 0);
    }
    return out;
  }
  /* 汇总带：一眼回答「这张图还剩多少活、我现在手上有几票」，
     顺带给出唯一的显眼入口「进入这一局」（选中第一条没做完的活）。 */
  function buildBriefBar(box) {
    box.textContent = "";
    var s = mapStats();
    var name = (MAPS.find(function (m) { return m[0] === S.map; }) || [])[1] || S.map;
    box.appendChild(el("b", "tk-ops__bname", name));
    var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    box.appendChild(el("span", "tk-ops__bmeta",
      "未完成 " + s.open + " · 可接 " + s.ready + " · 手上 " + s.inhand
      + " · 已完成 " + pct + "%" + " · 钥匙 " + s.keys + " 把"));
    /* 「进入这一局」删掉（2026-10-21）：它做的就是「选中第一条未完成的票」，
       与直接点列表第一行完全等价 —— 一个纯仪式按钮，占着简报条最显眼的位置。 */
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
      r.addEventListener("click", function () { delete S.plan[q]; paint(); });
      box.appendChild(r);
    });
    if (!S.planAll && ids.length > 3) {
      box.appendChild(el("p", "tk-ops__muted", "还有 " + (ids.length - 3) + " 票（点「全部」展开）"));
    }
    var keys = ids.reduce(function (n, q) {
      var t = taskOf(q);
      return n + ((t && t.keys) || 0);
    }, 0);
    var bar = el("div", "tk-ops__planbar");
    var go = el("button", "tk-ops__plango", "带这 " + ids.length + " 票进图 · 钥匙 " + keys + " 把");
    go.type = "button";
    go.title = "选中清单里第一条（不会真的进游戏）";
    go.addEventListener("click", function () {
      var first = ids[0];
      if (first) { focusTask(first, null); renderRightBody(); }
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
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      cp.textContent = "已复制";
      setTimeout(function () { cp.textContent = "复制清单"; }, 1200);
    });
    var cl = el("button", "tk-ops__chip", "清空");
    cl.type = "button";
    cl.addEventListener("click", function () { S.plan = {}; paint(); });
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
      /* 图过滤（2026-10-21 合并了原来的「仅本图 / 全站」两档）：
         没有搜索词 = 只看本图；一旦开始搜，就自动跨图 —— 读者真正需要跨图的
         场合只有「我记得有这一票，它在哪张图上」。 */
      var inMap = (t.ms || []).indexOf(S.map) >= 0;
      if (!inMap && !S.q) continue;
      if (S.q) {
        var hay = (t.name + " " + (t.en || "") + " " + (t.oids || []).join(" ")).toLowerCase();
        if (hay.indexOf(S.q.toLowerCase()) < 0) continue;
      }
      var st = stateOf(qid);
      /* 「未完成」= 还没做完、且我没说「这赛季不做」。忽略的单独一档。
         「可接」= 未完成 + 等级够 + 必须完成的前置都做完了（gate 只判这两项）。 */
      if (S.filter === "open" && (st === "done" || st === "ignored")) continue;
      if (S.filter === "inhand" && st !== "inhand") continue;
      if (S.filter === "done" && st !== "done") continue;
      if (S.filter === "ignored" && st !== "ignored") continue;
      if (S.filter === "pinned" && !isPinned(qid)) continue;
      var g = gate(qid);
      if (S.filter === "ready" && (st === "done" || st === "ignored" || !g.ok)) continue;
      out.push({ qid: qid, t: t, st: st, pinned: isPinned(qid), g: g });
    }
    out.sort(function (a, b) {
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

  /* 中栏任务清单：一行一票，只留「是什么 / 什么状态 / 两件事能立刻做」。
     目标明细搬进右栏 —— 一行任务挂 8 个复选框会把清单撑成墙（实测 80 行 / 405 个框）。 */
  function renderTaskList(box) {
    box.textContent = "";
    var rows = visibleTasks();
    var head = el("div", "tk-ops__thead");
    head.appendChild(el("b", "tk-ops__tcap", "这张图上的任务"));
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
    if (S.tasksOpen === false) return;
    if (!rows.length) {
      box.appendChild(el("p", "tk-ops__muted",
        S.q ? "没搜到。换个词试试 —— 搜索会自动跨图。" : "这张图上没有符合条件的活。"));
      return;
    }
    var LIMIT = 20;
    var shown = S.tasksAll ? rows : rows.slice(0, LIMIT);
    var ST_TXT = { done: "已完成", inhand: "进行中", ignored: "已忽略" };
    shown.forEach(function (r, i) {
      var t = r.t;
      var row = el("div", "tk-ops__row tk-ops__row--flat" + (r.qid === S.selQ ? " is-sel" : "")
        + (r.st === "done" ? " is-done" : "")
        + (r.st === "ignored" ? " is-ignored" : ""));
      row.dataset.qid = r.qid;
      row.tabIndex = i === S.row ? 0 : -1;

      var body = el("div", "tk-ops__rowbody");
      var head2 = el("div", "tk-ops__rowhead");
      head2.appendChild(el("span", "tk-ops__badge tk-ops__badge--" + r.st,
        ST_TXT[r.st] || "未标记"));
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

      var bits = [];
      var nobj = (t.oids || []).length;
      if (nobj) bits.push("目标 " + metCount(t, r.qid) + "/" + nobj);
      if (t.keys) bits.push("钥匙 " + t.keys + " 把");
      if (t.trader) bits.push(t.trader);
      if (t.level) bits.push("Lv " + t.level);
      /* 搜索会跨图：不标一下，读者会以为这张图上真有这票。 */
      if ((t.ms || []).indexOf(S.map) < 0) bits.push("不在本图");
      var meta = el("div", "tk-ops__rowmeta", bits.join(" · "));
      body.appendChild(meta);
      row.appendChild(body);

      /* 行内不再放「定位 / ＋出击」两个按钮（2026-10-21）：
         定位 = 点整行，出击 = 双击（详情卡里也有一份）。20 行 × 2 个按钮是首屏
         噪声的最大来源，实测占全部按钮的 28%。 */
      row.title = "单击：定位到图上 · 双击：加入 / 移出出击清单";

      row.addEventListener("click", function () {
        S.row = i;
        S.selQ = r.qid;
        S.selO = null;
        selectOnMap(r.qid);
        highlight();
        renderRightBody();
      });
      row.addEventListener("dblclick", function (e) {
        e.preventDefault();
        if (S.plan[r.qid]) delete S.plan[r.qid]; else S.plan[r.qid] = true;
        paint();
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

  function selectOnMap(qid) {
    try {
      window.dispatchEvent(new CustomEvent("tk:map:select",
        { detail: { qid: qid, oid: null, map: S.map } }));
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

  /* ------------------------------------------------------------ 地图挂载 */
  function remountMap() {
    var m = document.getElementById("tk-map");
    if (!m) return;
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
      });
    }
  }

  /* ------------------------------------------------------------ URL 状态 */
  function syncUrl() {
    var p = [];
    p.push("map=" + encodeURIComponent(S.map));
    p.push("mode=" + encodeURIComponent(S.mode));
    if (S.filter !== "open") p.push("f=" + S.filter);
    if (S.q) p.push("q=" + encodeURIComponent(S.q));
    if (S.selQ) p.push("sel=" + S.selQ);
    if (S.selO) p.push("o=" + S.selO);
    try { history.replaceState(null, "", "?" + p.join("&")); } catch (e) {}
  }
  function readUrl() {
    var q = new URLSearchParams(location.search);
    if (q.get("map")) S.map = q.get("map");
    if (q.get("mode")) S.mode = q.get("mode");
    if (q.get("f")) S.filter = q.get("f");
    if (q.get("q")) S.q = q.get("q");
    if (q.get("sel")) S.selQ = q.get("sel");
    if (q.get("o")) S.selO = q.get("o");
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
      syncUrl();
    };
    window.addEventListener("tk:map:select", window.__tkOpsMapSync);
  }


  /* ------------------------------------------------------------ 键盘流 */
  function bindKeys() {
    document.addEventListener("keydown", function (e) {
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
        else { S.selQ = null; S.selO = null; paint(); }
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
      if (e.key === "ArrowDown") { S.row = Math.min(rows.length - 1, S.row + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { S.row = Math.max(0, S.row - 1); e.preventDefault(); }
      else return;
      var r = rows[S.row];
      if (!r) return;
      S.selQ = r.dataset.qid;
      highlight();
      renderRightBody();
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

    /* 全量重建会销毁搜索框 —— 正在打字时记下焦点与光标，建完还回去。 */
    var prevSearch = document.querySelector(".tk-ops__search");
    var hadFocus = !!prevSearch && document.activeElement === prevSearch;
    var caret = null;
    if (hadFocus) {
      try { caret = [prevSearch.selectionStart, prevSearch.selectionEnd]; } catch (e) { caret = null; }
    }

    left.textContent = "";
    left.appendChild(buildMapList());
    renderMapRows();   /* buildMapList 里的首绘发生在入 DOM 之前，这里补一次 */
    left.appendChild(buildPlan());
    /* 日志同步从「左栏底部」挪到「页面底部」（2026-10-21）：它是一次性设置，
       原来占着左栏最黄金的位置，每次选图都要滚过它。 */
    mountFooterLog();

    var brief = document.getElementById("tk-ops-briefbar");
    if (brief) buildBriefBar(brief);
    var tasks = document.getElementById("tk-ops-tasks");
    if (tasks) renderTaskList(tasks);

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
          /* 清单在地图下面：换了筛选却不滚下去，读者会以为「点了没反应」
             （实测 1680×1150 下清单从第二屏开始）。只滚这一下，不动布局。 */
          var tb = document.getElementById("tk-ops-tasks");
          if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: "start", behavior: "smooth" });
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
        var tb = document.getElementById("tk-ops-tasks");
        if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: "start", behavior: "smooth" });
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
      S.lv = isFinite(v) && v > 0 ? v : 0;
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

  /* 只重绘右栏**内容**（跳转条 + 任务列表），不动搜索框与筛选按钮。
     搜索框的 input 事件走这里 —— 详见 paint() 里那段注释。 */
  /* 只重绘右栏**内容**（跳转条 + 任务明细），不动搜索框与筛选按钮。 */
  /* 右栏 = 「当前这一票要做什么」：搜索/筛选在上，明细在下。
     没有选中时只留一句引导，不塞列表（列表在中栏）。 */
  /* 右栏空态 = 「本图下一步」（2026-10-21）
     未选中任何票时，右栏原来只有一句引导 —— 那是一整列 300px 的空白。
     读者真正的下一个问题不是「我该点什么」，而是「这张图我现在该做哪几票」。
     推荐口径（不猜、不玩排序玄学）：本图 + 未完成/未忽略 + 可接（等级够、前置齐），
     按目标数从多到少 —— 目标多 = 一局能推进的进度多。最多 3 条。 */
  function buildNextUp(box) {
    var cands = [];
    if (S.idx && S.idx.tasks) {
      for (var qid in S.idx.tasks) {
        var t = taskOf(qid);
        if (!t || (t.ms || []).indexOf(S.map) < 0) continue;
        var st = stateOf(qid);
        if (st === "done" || st === "ignored") continue;
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
      box.appendChild(el("p", "tk-ops__dempty",
        S.lv ? "按你填的等级，这张图上没有可接的活 —— 降低等级，或看「未完成」里缺前置的票。"
             : "这张图上没有可接的活 —— 填一下「我的等级」，或看「未完成」里缺前置的票。"));
      box.appendChild(el("p", "tk-ops__muted", "↑↓ 选行 · 回车定位 · / 搜索 · 1 2 3 切模式"));
      return;
    }
    var list = el("div", "tk-ops__nulist");
    cands.slice(0, 3).forEach(function (c, i) {
      var card = el("button", "tk-ops__nucard");
      card.type = "button";
      var top = el("span", "tk-ops__nutop");
      top.appendChild(el("span", "tk-ops__nun", String(i + 1)));
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

  function renderDetail(box) {
    box.textContent = "";
    var qid = S.selQ;
    var t = qid ? taskOf(qid) : null;
    if (!t) {
      buildNextUp(box);
      return;
    }
    box.scrollTop = 0;   /* 换一票就看新卡的开头，不保留上一票的滚动位置 */
    var st = stateOf(qid);
    var ST_TXT = { done: "已完成", inhand: "进行中", ignored: "已忽略" };
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
          pt ? (pt.name || "（无中文名）") : "（不在本模式任务库）"));
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
      nx.slice(0, 5).forEach(function (nq) {
        var nt = taskOf(nq);
        var li = el("li");
        var b = el("button", "tk-ops__chainbtn");
        b.type = "button";
        b.appendChild(el("i", "tk-ops__dot is-next"));
        b.appendChild(el("span", "tk-ops__chainname",
          nt ? (nt.name || "（无中文名）") : nq));
        if (nt && nt.trader) b.appendChild(el("span", "tk-ops__chaintrader", nt.trader));
        b.addEventListener("click", function () { gotoTask(nq); });
        li.appendChild(b);
        ul2.appendChild(li);
      });
      nbox.appendChild(ul2);
      if (nx.length > 5) nbox.appendChild(el("p", "tk-ops__muted", "另有 " + (nx.length - 5) + " 个"));
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
    /* 「地图定位」删掉（2026-10-21）：点中栏那一行就已经定位了，详情卡里再放一个
       是同一动作的第二个入口。保留两个真正有副作用的：加入出击、标完成。 */
    var add = el("button", "tk-ops__chip", qid in S.plan ? "移出出击" : "加入出击");
    add.type = "button";
    add.addEventListener("click", function () {
      if (S.plan[qid]) delete S.plan[qid]; else S.plan[qid] = true;
      paint(); syncUrl();
    });
    var tg = el("button", "tk-ops__chip", st === "done" ? "标为未完成" : "标为已完成");
    tg.type = "button";
    tg.addEventListener("click", function () { setState(qid, st === "done" ? "" : "done"); });
    acts.appendChild(add);
    acts.appendChild(tg);
    box.appendChild(acts);
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
    var m = document.getElementById("tk-map");
    if (m) {
      m.setAttribute("data-map", S.map);
      m.setAttribute("data-mode", S.mode === "season" ? "pvp" : S.mode);
      m.setAttribute("data-tk-hover-tip", "1");
    }
    loadScript("ops-index-" + (S.mode === "season" ? "pvp" : S.mode) + ".js",
      "TARKOV_OPS_INDEX_" + S.mode.toUpperCase(), function (ok) {
        S.idx = ok ? window["TARKOV_OPS_INDEX_" + S.mode.toUpperCase()] : null;
        paint();
      });
    loadScript("map.js", null, function () {
      remountMap();
      bindHover();
      compactMapBar();
    });
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootIfNeeded);
  } else {
    bootIfNeeded();
  }
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(bootIfNeeded);
  }
})();
