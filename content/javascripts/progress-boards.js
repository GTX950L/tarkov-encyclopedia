/* ==========================================================================
   进度看板（「我的进度」页的任务 / 依赖树 / 物品 / 藏身处 / 剧情章节 / 管理各块）
   —— **惰性模块**

   为什么单独一个文件：
     这些块只在「我的进度」一页出现，却要背 1000 行渲染代码。放进 progress.js
     会让全部 118 个页面都多背一份 —— 由 progress.js 在检测到看板挂载点时才注入。

   三份数据的加载时机（越靠后越重，也越少用）：
     progress-manifest.js   全站加载  —— 物品 79 / 藏身处 26 / 剧情章节 10 / 任务总数
     quests-graph.js        看板渲染时 —— 515 个节点 + 前置边 + 门槛 + 地图（63 KB）
     quests-detail-*.js     展开任务时 —— 该任务的**目标明细与准备项**，按商人分块
                                         （最大一块 41 KB，而不是整份 183 KB）
   ========================================================================== */

(function () {
  "use strict";

  var TP = window.TarkovProgress;
  if (!TP) return;

  var UI = TP._ui || {};
  var el = UI.el, notReady = UI.notReady, loadScript = UI.loadScript,
      makeStateSelect = UI.makeStateSelect, makeChapterSelect = UI.makeChapterSelect,
      syncStateSeg = UI.syncStateSeg,
      questUrl = UI.questUrl, siteRoot = UI.siteRoot;
  var MODE_LABEL = TP.MODE_LABEL, TRACKS = TP.TRACKS, TRACK_LABEL = TP.TRACK_LABEL;

  /* 图节点字段下标 —— 与生成器里的 cols 一致，改一处要改两处。 */
  var N_NAME = 0, N_TRADER = 1, N_LEVEL = 2, N_PRE = 3, N_FLAGS = 4,
      N_LINK = 5, N_GATES = 6, N_MAP = 7;

  var QROW_CAP = 80;

  /* --------------------------------------------------------------------------
     小工具
     -------------------------------------------------------------------------- */

  function fmtNum(n) {
    var v = parseInt(n, 10);
    return isFinite(v) ? v.toLocaleString("en-US") : "0";
  }

  function today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
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
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* 重画一段 DOM 前后保住键盘焦点 —— 重画会替换掉正在聚焦的元素。 */
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
      try { nxt.setSelectionRange(pos[0], pos[1]); } catch (e) { /* 数字框不支持 */ }
    }
  }

  function toast(host, msg, ok, undoFn) {
    var t = host.querySelector(".tk-board__toast");
    if (!t) {
      t = el("div", "tk-board__toast");
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      host.appendChild(t);
    }
    t.textContent = "";
    t.classList.toggle("is-bad", !ok);
    t.appendChild(document.createTextNode(msg || ""));
    if (typeof undoFn === "function") {
      var b = el("button", "tk-board__undo", "撤销");
      b.type = "button";
      b.addEventListener("click", function () {
        undoFn();
        t.textContent = "已撤销。";
        t.classList.remove("is-bad");
      });
      t.appendChild(b);
      /* 6 秒后撤掉按钮：留一个永远能点的「撤销」比不给还危险 ——
         读者会在完全不同的上下文里点到它。 */
      setTimeout(function () {
        var bb = t.querySelector(".tk-board__undo");
        if (bb) bb.remove();
      }, 6000);
    }
    var old = t.__hideTimer;
    if (old) clearTimeout(old);
    t.__hideTimer = setTimeout(function () { t.textContent = ""; }, 9000);
  }

  /* 数量步进控件：− / 输入框 / ＋。set 只在输入框没有焦点时写值 ——
     否则用户正在敲「12」会被同步回写成「1」。 */
  function countCtl(name, need) {
    var box = el("span", "tk-cnt");
    var minus = el("button", "tk-cnt__btn", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "减少「" + name + "」的数量");
    var inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.className = "tk-cnt__in";
    inp.setAttribute("inputmode", "numeric");
    inp.setAttribute("aria-label", "「" + name + "」的数量");
    var plus = el("button", "tk-cnt__btn", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "增加「" + name + "」的数量");

    function set(n) {
      var before = TP.itemCount(name);
      TP.setItemCount(name, n);
      return before;
    }
    minus.addEventListener("click", function () { set(TP.itemCount(name) - 1); });
    plus.addEventListener("click", function () { set(TP.itemCount(name) + 1); });
    inp.addEventListener("change", function () { set(inp.value); });
    inp.addEventListener("blur", function () {
      var v = TP.itemCount(name);
      inp.value = v > 0 ? String(v) : "";
    });

    box.appendChild(minus);
    box.appendChild(inp);
    box.appendChild(plus);
    if (need !== undefined) box.appendChild(el("em", "tk-cnt__need", "需 " + fmtNum(need)));
    return {
      el: box,
      set: function (v) { if (document.activeElement !== inp) inp.value = v > 0 ? String(v) : ""; }
    };
  }

  function wrapTable(headers, tbody) {
    var tbl = el("table", "tk-board__tbl");
    var thead = el("thead");
    var htr = el("tr");
    for (var i = 0; i < headers.length; i++) htr.appendChild(el("th", null, headers[i]));
    thead.appendChild(htr);
    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    /* 套进 .md-typeset__table —— 全站唯一的表格横向滚动容器。
       主题只给**构建期**就存在的表格套这一层，运行时建的表不自己套，
       窄屏就会把整页撑宽（实测 390px 下 scrollWidth 从 369 涨到 441）。 */
    var wrap = el("div", "md-typeset__table");
    wrap.appendChild(tbl);
    return wrap;
  }

  function sumCards(defs) {
    var refs = {};
    var box = el("div", "tk-board__sum");
    for (var i = 0; i < defs.length; i++) {
      var card = el("div", "tk-board__sumitem");
      card.appendChild(el("em", null, defs[i][0]));
      var b = el("b", null, defs[i][1] === undefined ? "—" : defs[i][1]);
      card.appendChild(b);
      refs[defs[i][0]] = b;
      box.appendChild(card);
    }
    return { el: box, refs: refs };
  }

  /* 三个模式的各轨条目数合计 —— 只给「清空全部进度」的确认框用。
     **在点击时才调用**：渲染那一刻的数字会在同步 / 手勾之后过期，而
     确认框里写错数量比不写更糟（读者会按错误信息判断要不要清）。 */
  function allTrackCounts() {
    var d = TP.data();
    var keys = ["quests", "inhand", "objectives", "items", "hideout", "storyline"];
    var out = {};
    var i;
    for (i = 0; i < keys.length; i++) out[keys[i]] = 0;
    for (i = 0; i < TP.MODES.length; i++) {
      var md = d.modes[TP.MODES[i]];
      if (!md) continue;
      for (var k = 0; k < keys.length; k++) {
        out[keys[k]] += Object.keys(md[keys[k]] || {}).length;
      }
    }
    return out;
  }

  /* --------------------------------------------------------------------------
     数据加载
     -------------------------------------------------------------------------- */

  var graphState = 0;   // 0 未开始 / 1 加载中 / 2 就绪 / -1 失败
  var graphCbs = [];    // 加载中时的等待队列

  /* ⚠️ 必须支持**多个等待者**。
     本函数原来的写法是「加载中就直接 return」—— 当时只有一个看板用图，没暴露；
     加入「总览」之后，总览先请求、任务看板紧随其后，第二个回调会被静默丢弃，
     表现就是**任务看板永远停在「—」不渲染**。
     凡「共享的异步资源 + 单一在途请求」都适用这条：请求合并可以，回调不能丢。 */
  function ensureGraph(cb) {
    if (window.TARKOV_QUEST_GRAPH) { cb(window.TARKOV_QUEST_GRAPH); return; }
    if (graphState === -1) { cb(null); return; }
    graphCbs.push(cb);
    if (graphState === 1) return;
    graphState = 1;
    loadScript("quests-graph.js", ["TARKOV_QUEST_GRAPH"], function (ok) {
      graphState = (ok && window.TARKOV_QUEST_GRAPH) ? 2 : -1;
      var cbs = graphCbs;
      graphCbs = [];
      for (var i = 0; i < cbs.length; i++) {
        cbs[i](window.TARKOV_QUEST_GRAPH || null);
      }
    });
  }

  /* 按商人分块的明细：只在**展开某个任务**时才拉它所属的那一块。 */
  var detailLoading = {};

  /* 明细块的加载**不能复用 loadScript 的「全局已存在」短路**：
     11 个分块写的是同一个全局（TARKOV_QUEST_DETAIL），第一块载完之后，
     其余的会被当成「已经载过」而永远不请求 —— 实测踩到：
     进行中任务属于 mechanic，但只有 ragman 的块在，准备清单因此空着。
     所以这里按**分块名**记状态，自己注入 script。 */
  function ensureDetail(slug, cb) {
    if (!slug) { cb(false); return; }
    var store = window.TARKOV_QUEST_DETAIL;
    if (store && store[slug]) { cb(true); return; }
    if (detailLoading[slug] === "bad") { cb(false); return; }
    if (detailLoading[slug] === "loading") return;
    detailLoading[slug] = "loading";
    var url = (UI.siteRoot ? UI.siteRoot() : "") + "javascripts/quests-detail-" + slug + ".js";
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      var s2 = window.TARKOV_QUEST_DETAIL;
      var hit = !!(ok && s2 && s2[slug]);
      detailLoading[slug] = hit ? "ok" : "bad";
      cb(hit);
    }
    sc.onload = function () { finish(true); };
    sc.onerror = function () { finish(false); };
    document.head.appendChild(sc);
  }

  function detailOf(qid) {
    var store = window.TARKOV_QUEST_DETAIL;
    if (!store) return null;
    for (var k in store) {
      if (store[k] && store[k].tasks && store[k].tasks[qid]) return store[k].tasks[qid];
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     按前置树反推 + 门槛判定

     规则：
       · **进行中任务的前置一律视为已完成**（能被接到，前置必然满足），沿链传递
       · 只沿 c（complete）边传播；a/f 两类本站没有对应状态，只作提示
       · 可接 = 未完成 + 未进行中 + 前置满足 + 等级够 + **门槛满足**
     门槛四类能吃到的都吃：商人忠诚度（level）、**商人声望（reputation）**、阵营、转生，
     外加**商人内部计数器（c）**——它是「在该商人处推进到第几环」，与「该商人
     完成了几个任务」同一把尺，**算得出来**（2026-10-11 起参与判定）。
     真算不出来的只剩**对话**一类，**不参与判定但标出来** ——
     算不出来的东西宁可让读者多看一眼，也不给一个靠猜的答案。

     ⚠️ 声望为什么单独处理（2026-10-07 修，见 docs/roadmap 的审查批次）：
     此前 `kind !== "level"` 一律降级成一句没有数值、没有方向的「声望条件」，
     **12 个任务的声望门槛完全不参与判定**——其中包括 Kappa 线终点「收藏家」
     （Fence ≥ 3）。后果是总览的「下一步」把它算进「现在可接」。
     现在 reputation 会真判定，但**只对站内有刻度的 Fence 生效**：
     Fence 用**负值**刻度（亡羊补牢要求 ≤ −3 / ≤ −1），与 LL 的 1–4 不是一把尺，
     所以单独读 `gates.fence`；**未填时按未知处理成 soft**，不给靠猜的答案。
     -------------------------------------------------------------------------- */

  /* ⚠️ 门槛里的商人名是**显示名**（"Ragman"），而玩家填的忠诚度存在 `gates.ll`
     里、键是**小写 slug**（"ragman"）。两个来源不是一个大小写，取值前必须归一，
     否则恒取不到值、恒走「未填」分支。

     2026-10-11 修的就是这个：此前直接拿显示名去 `gates.ll` 里取，结果**读者把
     11 个商人的忠诚度都填了，判定依然当没填** —— 「可接」一个数都筛不掉
     （实测：把存储里的键改成大写后，可接立刻从 307 掉到 227，一次 −80）。 */
  function traderSlug(name) { return String(name || "").toLowerCase(); }

  function gateCheck(node, gates, traderDone) {
    var g = node[N_GATES] || {};
    var out = { ok: true, why: [], soft: [] };
    var i;
    if (g.f) {
      if (gates.faction && gates.faction !== g.f) { out.ok = false; out.why.push("限 " + g.f); }
      else if (!gates.faction) out.soft.push("限 " + g.f);
    }
    if (g.p) {
      if ((gates.prestige || 0) >= g.p) { /* 满足 */ }
      else { out.ok = false; out.why.push("需转生 " + g.p); }
    }
    var tr = g.t || [];
    for (i = 0; i < tr.length; i++) {
      var trader = tr[i][0], kind = tr[i][1], cmp = tr[i][2], val = tr[i][3];
      var tslug = traderSlug(trader);
      if (kind === "reputation") {
        /* 声望门槛：参与判定，但只对**站内采集了刻度**的商人生效。
           Fence 用负值刻度（亡羊补牢要求 ≤ −3），与 LL 的 1–4 不是一把尺，
           所以单独读 gates.fence；未填时（null）按未知处理成 soft —— 宁可让
           读者多看一眼，也不给一个靠猜的「可接」。 */
        var label = tslug === "fence" ? "Fence 声望" : trader + " 声望";
        var cond = label + (cmp === ">=" ? " ≥ " : cmp === "<=" ? " ≤ " : " < ") + val;
        var haveRep = tslug === "fence" ? gates.fence : null;
        if (haveRep === null || haveRep === undefined) { out.soft.push("需 " + cond); continue; }
        var passRep = cmp === ">=" ? haveRep >= val : cmp === "<=" ? haveRep <= val : haveRep < val;
        if (!passRep) { out.ok = false; out.why.push("需 " + cond); }
        continue;
      }
      if (kind !== "level") { out.soft.push("声望条件"); continue; }
      var have = parseInt((gates.ll || {})[tslug], 10) || 0;
      var pass = cmp === "<=" ? have <= val : have >= val;
      if (!have) out.soft.push("需 " + trader + " LL" + val);
      else if (!pass) { out.ok = false; out.why.push("需 " + trader + " LL" + val); }
    }

    /* —— 商人内部计数器（gates.c）——
       语义是「**在该商人处推进到第几环**」（端点原字段，见任务页字段说明），
       与「该商人已完成几个任务」同一把尺，**算得出来**，所以参与判定而不是只提示。

       此前它只进 `o` 当一句提示，后果是「可接」把一批**被柜台顺序挡着**的任务
       也算进去 —— 读者报「网页说能接几百个，游戏里远没有这么多」，主因就在这里
       （全站 164 个任务带这一条，占「可接」的一大半）。

       why 里带上「已完成 N」：被挡住时读者能直接看出还差几个，而不是以为任务不存在。 */
    var cs = g.c || [];
    var cBlocked = [];
    for (i = 0; i < cs.length; i++) {
      var cslug = cs[i][0], ccmp = cs[i][1], cval = cs[i][2];
      var doneN = (traderDone && traderDone[cslug]) || 0;
      var passC = ccmp === "<=" ? doneN <= cval : ccmp === ">" ? doneN > cval : doneN >= cval;
      if (!passC) {
        out.ok = false;
        cBlocked.push(cslug.charAt(0).toUpperCase() + cslug.slice(1));
        out.why.push("需 " + cBlocked[cBlocked.length - 1]
          + " 环数 " + (ccmp === ">=" ? "≥" : ccmp) + " " + cval + "（已完成 " + doneN + "）");
      }
    }
    var oth = g.o || [];
    for (i = 0; i < oth.length; i++) {
      /* 被挡住的计数器已经由上面那句「还差几个」说清了，o 里那句同义文本**（如
         "Mechanic 计数器 >= 1"）不再重复** —— 两句话并排会让读者以为是两件事。
         没被挡住的（已满足 / 无 c 字段）照旧显示，信息不丢。 */
      var dupe = false;
      if (oth[i].indexOf("计数器") >= 0) {
        for (var b = 0; b < cBlocked.length; b++) {
          if (oth[i].indexOf(cBlocked[b]) >= 0) { dupe = true; break; }
        }
      }
      if (!dupe) out.soft.push(oth[i]);
    }
    return out;
  }

  function computeTree(graph, explicit, inhand, gates) {
    var tasks = (graph && graph.tasks) || {};
    var done = {}, inferred = {}, id, seen = {}, stack = [];

    for (id in explicit) if (explicit[id] !== undefined) { done[id] = true; stack.push(id); }
    for (id in inhand) if (inhand[id] !== undefined) stack.push(id);

    /* 传递闭包：栈 + seen 防环。没有 seen，一条环就能把页面卡死。 */
    while (stack.length) {
      var cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = true;
      var node = tasks[cur];
      if (!node) continue;
      var pre = node[N_PRE] || [];
      for (var i = 0; i < pre.length; i++) {
        var pid = pre[i][0];
        if ((pre[i][1] || "").indexOf("c") < 0) continue;
        if (done[pid] || !tasks[pid]) continue;
        done[pid] = true;
        inferred[pid] = true;
        stack.push(pid);
      }
    }

    /* 每商人「推进到第几环」—— 供商人内部计数器（gates.c）判定。
       口径：已完成（含前置推断）**加**进行中。进行中的任务既然接到了，就说明
       该商人的计数器已经推进到那一环；只算已完成会偏小、把能接的判成不能接。
       漏报比多报更糟 —— 多报只是要多看一眼，漏报会让人以为任务不存在。 */
    var traderDone = {};
    function bumpTrader(qid) {
      var nd = tasks[qid];
      if (!nd) return;
      var s = nd[N_TRADER] || "";
      if (s) traderDone[s] = (traderDone[s] || 0) + 1;
    }
    for (id in done) bumpTrader(id);
    for (id in inhand) if (!done[id]) bumpTrader(id);

    var avail = [], locked = [], stat = {}, gate = {};
    for (id in tasks) {
      var n = tasks[id];
      var pre2 = n[N_PRE] || [], need = 0, have = 0, ok = true;
      for (var j = 0; j < pre2.length; j++) {
        if ((pre2[j][1] || "").indexOf("c") < 0) continue;
        need++;
        if (done[pre2[j][0]]) have++;
        else ok = false;
      }
      stat[id] = [have, need];
      gate[id] = gateCheck(n, gates, traderDone);
      if (done[id] || inhand[id] !== undefined) continue;
      if (ok && (gates.level <= 0 || (n[N_LEVEL] || 0) <= gates.level) && gate[id].ok) avail.push(id);
      else locked.push(id);
    }
    return { done: done, inferred: inferred, avail: avail, locked: locked, stat: stat, gate: gate };
  }

  /* --------------------------------------------------------------------------
     看板零：总览（「我的进度」页的第一个分页）
     --------------------------------------------------------------------------
     解决的问题：这一页原来直接落到「任务进度」——那是一张**操作台**（筛选、
     勾选、展开目标），适合「要干活的时候」。但「看一眼我打到哪了」是另一种
     需求，它需要的是**总览**：五条线各自的完成度（任务 / 长线目标 / 剧情章节 /
     藏身处 / 物品收集）、按商人拆开的分部进度、以及「接下来该干什么」。
     本块补的就是这个视角。

     与同类站点的分工（不照搬的地方）：
       · 它们给**统计数字**；这里在同样位置多给一块「下一步」——
         本站有完整的任务前置树，算得出「现在能接什么、差在哪」，
         这是只有「有数据的站」才给得出的东西；
       · 每一条数字都标**口径**：任务的「已完成」分「手动 / 推断」两个数
         （推断 = 由进行中任务沿前置树反推），不揉成一个数；
       · 纯 CSS 横条、无配图、弱网可读、离线可用（读本机记录，不登录）。

     ⚠️ 口径必须与其它看板一致（否则同一页两个数读者会以为有一个是错的）：
       · 任务：与「任务进度」看板同源 —— TP.data() + computeTree()；
       · 藏身处：hideoutLevel() + topLevel()（同 hideoutCard 的判定）；
       · 物品：itemCount() ≥ it.qty（同 renderItemBoard 的「达标」定义）。
     -------------------------------------------------------------------------- */

  function renderOverview(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;

    host.textContent = "";

    /* ⚠️ 本块**必须**注册 __tkSync，否则数据一变就被 sync() 跳过（2026-10-07 修）。
       读者报「任务的前置自动推断一直是零」——实测确认：
         · 推断算法本身**完全正常**（标一个进行中任务，手工跑 computeTree 得 6 个）；
         · 数据链路也正常（状态条能实时显示「进行中 1」）；
         · 但总览是五块看板里**唯一没注册 __tkSync** 的，所以 progress.js 的
           repaint() → Boards.sync() 遍历时**跳过了它**，画一次就定格在初始值 0。
       「状态条实时、总览不动」这个反差就是判据：同一份数据，两条渲染路径不同步。

       本块与其它看板不同：**全是只读展示，没有任何输入控件**
       （已核查：无 input / select / button 事件），所以整块重绘不会打断交互 ——
       既不会丢焦点，也不会丢滚动位置之外的任何状态。 */
    host.__tkSync = function () { renderOverview(host); };

    /* 清单没载入（网络中断 / 脚本被拦）时给提示，而不是画一个「0 / 0 个任务」——
       后者看起来像「你的进度清空了」，比空白更吓人。 */
    if (!mf || !mf.total) {
      host.appendChild(notReady("进度清单"));
      return;
    }

    var traders = mf.traders || [];
    var totalAll = mf.total || 0;
    var itemList = (mf.items && mf.items.list) || [];
    var hutList = (mf.hideout && mf.hideout.list) || [];

    host.appendChild(el("p", "tk-ov__loading", "正在汇总进度…"));

    /* 图数据到齐再画：没有图就算不出「推断完成」与「可接」。
       图加载失败时降级为「只报手动数」——不装作有数据。 */
    ensureGraph(function (graph) {
      if (!host.isConnected) return;   // instant 换页后节点已被替换
      host.textContent = "";

      var md = TP.data();
      var modeData = md.modes[md.mode] || {};
      var explicit = modeData.quests || {};
      var inhand = modeData.inhand || {};
      var gates = TP.gates();
      /* 图加载失败时的降级（2026-10-07 修）：
         原先降级成 `{done:{}, inferred:{}, avail:[]}` —— 把**用户已有的手动进度
         一起丢掉了**。于是大数字显示「0 / 515」，而下面的按商人矩阵、长线目标、
         「下一步」全部按 0 算：**五个块同时失真，且看起来不像故障、像「进度被清空」**。
         现在改为：done 保留显式记录（拿得到就算数），inferred 置 0，
         并用 hasGraph 把「依赖任务图的三块」标成不可用 —— 不拿残缺的数据冒充全量口径。 */
      var hasGraph = !!graph;
      var tree = hasGraph
        ? computeTree(graph, explicit, inhand, gates)
        : { done: Object.keys(explicit).reduce(function (a, k) { a[k] = true; return a; }, {}),
            inferred: {}, inferredBlocked: true, avail: [], locked: [] };

      var doneAll = Object.keys(tree.done).length;
      var inferredN = Object.keys(tree.inferred).length;
      var manualN = doneAll - inferredN;
      var inhandN = Object.keys(inhand).length;
      var pct = totalAll ? Math.round(doneAll / totalAll * 1000) / 10 : 0;

      /* —— 一、总条：一条横条里同时显示四段进度 —— */

      var head = el("div", "tk-ov");
      var top = el("div", "tk-ov__top");

      var bigNum = el("div", "tk-ov__big");
      bigNum.appendChild(el("b", null, String(doneAll)));
      bigNum.appendChild(el("span", null, " / " + totalAll + " 个任务"));
      top.appendChild(bigNum);

      var pctEl = el("div", "tk-ov__pct");
      pctEl.appendChild(el("b", null, pct + "%"));
      /* 降级时不能说「含推断」——推断数被强制为 0，说含推断就是骗读者 */
      pctEl.appendChild(el("span", null, hasGraph ? "完成度（含推断）" : "完成度（仅手动）"));
      top.appendChild(pctEl);

      var legend = el("div", "tk-ov__legend");
      [
        ["done", "手动完成 " + manualN],
        ["infer", "前置推断 " + inferredN],
        ["inhand", "进行中 " + inhandN],
        ["rest", "未标记 " + (totalAll - doneAll - inhandN)]
      ].forEach(function (pair) {
        var sp = el("span", "tk-ov__lg");
        sp.appendChild(el("i", "tk-ov__dot tk-ov__dot--" + pair[0]));
        sp.appendChild(document.createTextNode(pair[1]));
        legend.appendChild(sp);
      });
      top.appendChild(legend);
      head.appendChild(top);

      /* 分段条：四段宽度按占比。0 宽的段也要保留（颜色图例对得上颜色）。 */
      var bar = el("div", "tk-ov__bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", "任务进度：" + (totalAll ? (manualN / totalAll * 100).toFixed(1) : 0) + "% 手动完成、" +
        (totalAll ? (inferredN / totalAll * 100).toFixed(1) : 0) + "% 由前置推断");
      [
        ["done", manualN], ["infer", inferredN], ["inhand", inhandN],
        ["rest", Math.max(0, totalAll - doneAll - inhandN)]
      ].forEach(function (pair) {
        var seg = el("i", "tk-ov__seg tk-ov__seg--" + pair[0]);
        seg.style.width = (totalAll ? (pair[1] / totalAll * 100) : 0) + "%";
        if (!pair[1]) seg.style.display = "none";
        bar.appendChild(seg);
      });
      head.appendChild(bar);

      /* 降级时的大数字说明：把「为什么按商人矩阵是 0」当场讲清，
         否则读者会以为自己的记录又丢了。 */
      if (!hasGraph) {
        head.appendChild(el("p", "tk-board__note",
          "任务图没能载入，所以**「前置推断」与「按商人 / 长线 / 可接」这三块暂不可用**——"
          + "下面显示的完成数只包含你**手动标记过**的那些。刷新一次通常即可恢复。"));
      }

      host.appendChild(head);

      /* —— 二、按商人：11 格矩阵 ——
         展示的是「该商人任务里，已完成（含推断）占比」。分母用站内
         manifest 的 count（与任务图鉴的商人页总数同源）。 */

      var doneByTrader = {};
      for (var dId in tree.done) {
        var nEx = graph && graph.tasks ? graph.tasks[dId] : null;
        if (nEx) doneByTrader[nEx[N_TRADER]] = (doneByTrader[nEx[N_TRADER]] || 0) + 1;
      }

      var tSec = el("div", "tk-ov__sec");
      var tHead = el("div", "tk-ov__sechead");
      tHead.appendChild(el("b", null, "按商人"));
      tHead.appendChild(el("em", null, hasGraph
        ? "已完成 / 该商人任务总数（含前置推断）"
        : "任务图未载入，暂不可用（刷新一次通常即可恢复）"));
      tSec.appendChild(tHead);

      var tGrid = el("div", "tk-ov__traders");
      for (var t = 0; t < traders.length; t++) {
        var tr = traders[t];
        var got = hasGraph ? (doneByTrader[tr.slug] || 0) : 0;
        var tot = tr.count || 0;
        var p = tot ? Math.round(got / tot * 100) : 0;

        var cell = el("a", "tk-ov__tr");
        cell.href = siteRoot() + "quests/" + tr.slug + "/";
        cell.title = tr.name + "：" + got + " / " + tot + "（" + p + "%）—— 点进该商人的任务页";

        var line = el("div", "tk-ov__trhead");
        line.appendChild(el("span", "tk-ov__trname", tr.name));
        /* 降级时不写「0/89」——那会被读成「一个都没做」。写「—」表示「算不出来」。 */
        line.appendChild(el("span", "tk-ov__trnum", hasGraph ? (got + "/" + tot) : "—"));
        cell.appendChild(line);

        var tb = el("div", "tk-ov__trbar");
        if (!hasGraph) tb.className += " is-unknown";
        var tf = el("i", "tk-ov__trfill");
        tf.style.width = p + "%";
        tb.appendChild(tf);
        cell.appendChild(tb);

        tGrid.appendChild(cell);
      }
      tSec.appendChild(tGrid);
      host.appendChild(tSec);

      /* —— 三、长线目标：Kappa 线 / Lightkeeper 链 ——
         ⚠️ 这里**不是**「剧情章节进度」：章节（Tour / Falling Skies / The Ticket）
         在官方任务数据里**没有对应字段**，站内也没有「章节 → 任务」的映射，
         硬凑出来的百分比是编数据。剧情章节改走**手动记录**（看板四 / 剧情页），
         本块只放**有标记支撑的两条长线**（任务节点上的 kappa / lightkeeper 标记）。 */

      /* 分母**从任务图实算**，不写死数字（2026-10-07 改）。
         原先 hint 里硬编码「13 条 / 7 条」——那是当前数据恰好对上的结果，
         数据一变（任务增删）文案就会撒谎，而且没有任何东西会报错。
         这里的 ids 长度就是真数：k = 13、l = 7，与旧文案一致。 */
      var lines = [
        { flag: "k", name: "Kappa 线", hint: "收藏家前置的必需任务共" },
        { flag: "l", name: "Lightkeeper 链", hint: "解锁灯塔主人所需的共" }
      ];
      var lSec = el("div", "tk-ov__sec");
      var lHead = el("div", "tk-ov__sechead");
      lHead.appendChild(el("b", null, "长线目标"));
      lHead.appendChild(el("em", null, hasGraph
        ? "带标记的终局线 · 剧情章节另见「其它三条轨」"
        : "任务图未载入，暂不可用（刷新一次通常即可恢复）"));
      lSec.appendChild(lHead);

      var lGrid = el("div", "tk-ov__lines");
      for (var li = 0; li < lines.length; li++) {
        var L = lines[li];
        var ids = [], gotL = 0;
        for (var qid in (graph && graph.tasks ? graph.tasks : {})) {
          if ((graph.tasks[qid][N_FLAGS] || "").indexOf(L.flag) >= 0) {
            ids.push(qid);
            if (tree.done[qid]) gotL++;
          }
        }
        var lCell = el("div", "tk-ov__line");
        var lTop = el("div", "tk-ov__trhead");
        lTop.appendChild(el("span", "tk-ov__trname", L.name));
        /* 同上：算不出来时写「—」，不写「0/0」——后者会被读成「一条都没做」 */
        lTop.appendChild(el("span", "tk-ov__trnum", hasGraph ? (gotL + "/" + ids.length) : "—"));
        lCell.appendChild(lTop);
        var lb = el("div", "tk-ov__trbar");
        if (!hasGraph) lb.className += " is-unknown";
        var lf = el("i", "tk-ov__trfill");
        lf.style.width = (hasGraph && ids.length ? Math.round(gotL / ids.length * 100) : 0) + "%";
        lb.appendChild(lf);
        lCell.appendChild(lb);
        /* hint 里的条数用实算值补上，别再写死 */
        lCell.appendChild(el("em", "tk-ov__linehint",
          hasGraph ? (L.hint + " " + ids.length + " 条") : L.hint));
        lGrid.appendChild(lCell);
      }
      lSec.appendChild(lGrid);
      host.appendChild(lSec);

      /* —— 四、其它三条轨：剧情章节 + 藏身处 + 物品 ——
         剧情章节是**手动记录**（无推断）：数字就是读者亲手标的那几下，
         口径与「剧情章节」分页一致（同一个 storyCounts）。 */

      var hutBuilt = 0, hutMaxed = 0, hutLevels = 0, hutLevelMax = 0;
      for (var hi = 0; hi < hutList.length; hi++) {
        var mod = hutList[hi];
        var lv = TP.hideoutLevel(mod.name) || 0;
        var top = topLevel(mod);
        if (lv > 0) hutBuilt++;
        if (lv >= top && top > 0) hutMaxed++;
        hutLevels += lv;
        hutLevelMax += top;
      }
      var itemMet = 0, itemKinds = 0;
      for (var ii = 0; ii < itemList.length; ii++) {
        var v = TP.itemCount(itemList[ii].name) || 0;
        if (v >= itemList[ii].qty) itemMet++;
        if (v > 0) itemKinds++;
      }

      var slList = (mf.storyline && mf.storyline.list) || [];
      var stc = slList.length ? TP.storyCounts(slList) : null;

      var oSec = el("div", "tk-ov__sec");
      var oHead = el("div", "tk-ov__sechead");
      oHead.appendChild(el("b", null, "其它三条轨"));
      oHead.appendChild(el("em", null, "点「剧情章节」「藏身处」「物品收集」分页可继续记录"));
      oSec.appendChild(oHead);

      var oGrid = el("div", "tk-ov__others");
      var oCells = [];
      if (stc) {
        oCells.push({ name: "剧情章节", got: stc.done, tot: stc.total,
          extra: "进行中 " + stc.inhand + " 章 · 纯手动记录，不做推断",
          unit: "章完成" });
      }
      oCells.push(
        { name: "藏身处", got: hutBuilt, tot: hutList.length, extra: "已建满 " + hutMaxed + " 个 · 总等级 " + hutLevels + "/" + hutLevelMax, unit: "个模块" },
        /* 「达标」与「已囤」是两个数，读者容易问「囤了 10 种怎么只显示达标 3 种」——
           这里把定义写进副标题，不让读者自己猜（定义与「物品收集」分页一致）。 */
        { name: "物品收集", got: itemMet, tot: itemList.length,
          extra: "已囤 " + itemKinds + " 种 · 达标 = 已囤件数 ≥ 该物品被任务要求的总件数",
          unit: "种达标" }
      );
      oCells.forEach(function (o) {
        var oCell = el("div", "tk-ov__other");
        var oTop = el("div", "tk-ov__trhead");
        oTop.appendChild(el("span", "tk-ov__trname", o.name));
        oTop.appendChild(el("span", "tk-ov__trnum", o.got + "/" + o.tot + " " + o.unit));
        oCell.appendChild(oTop);
        var ob = el("div", "tk-ov__trbar");
        var of = el("i", "tk-ov__trfill");
        of.style.width = (o.tot ? Math.round(o.got / o.tot * 100) : 0) + "%";
        ob.appendChild(of);
        oCell.appendChild(ob);
        oCell.appendChild(el("em", "tk-ov__linehint", o.extra));
        oGrid.appendChild(oCell);
      });
      oSec.appendChild(oGrid);
      host.appendChild(oSec);

      /* —— 五、下一步：本站独有的行动块 ——
         同类站点止于「统计」；这一块回答的是「我现在该做什么」，
         全部结论来自上面的同一份计算，不引入新口径。 */

      var nSec = el("div", "tk-ov__sec tk-ov__next");
      var nHead = el("div", "tk-ov__sechead");
      nHead.appendChild(el("b", null, "下一步"));
      nHead.appendChild(el("em", null, "按当前记录算出来的建议"));
      nSec.appendChild(nHead);

      var nList = el("ul", "tk-ov__steps");
      var steps = [];

      if (inhandN > 0) {
        steps.push(["先清手上的 " + inhandN + " 个进行中任务",
          "它们在「任务进度」分页的顶部，标成已完成就从列表里移走"]);
      }
      if (tree.avail && tree.avail.length) {
        /* 「最低门槛」只在**真有等级门槛**时才有意义（2026-10-07 修）。
           实测：296 个可接任务里 **199 个（67%）的 level 是 0**——0 不是「门槛低」，
           是「数据源没给解锁等级」。原先直接取最小值，于是这一栏长期显示
           「最低门槛 0 级：一臂之力」，把「未知」说成了「门槛很低」。
           现在只统计 level > 0 的任务；一个都没有就不提这茬。 */
        var lowest = null;
        for (var ai = 0; ai < tree.avail.length; ai++) {
          var an = graph && graph.tasks[tree.avail[ai]];
          if (!an) continue;
          if (!an[N_LEVEL]) continue;          /* 0 = 未给等级，不参与「最低门槛」评选 */
          if (!lowest || an[N_LEVEL] < lowest[N_LEVEL]) lowest = an;
        }
        steps.push([tree.avail.length + " 个任务可接" + (lowest ? "（最低门槛 " + lowest[N_LEVEL] + " 级：" + lowest[N_NAME] + "）" : ""),
          gates.level > 0 ? "前置、等级与门槛都已满足"
                          : "填上「我的等级」能把可接判得更准"]);
      } else if (gates.level <= 0) {
        steps.push(["先填「我的等级」", "填了才算得出「哪些任务可接」——在「任务进度」分页的工具栏里"]);
      }
      if (lines.length && hasGraph) {
        var gaps = [];
        for (var gi2 = 0; gi2 < lines.length; gi2++) {
          var gl = lines[gi2], glIds = [], glGot = 0;
          for (var q2 in (graph && graph.tasks ? graph.tasks : {})) {
            if ((graph.tasks[q2][N_FLAGS] || "").indexOf(gl.flag) >= 0) {
              glIds.push(q2);
              if (tree.done[q2]) glGot++;
            }
          }
          if (glGot < glIds.length) gaps.push(gl.name + " 还差 " + (glIds.length - glGot) + " 条");
        }
        if (gaps.length) steps.push(["长线：" + gaps.join("、"), "在「任务进度」分页用 Kappa / Lightkeeper 预设可以直接筛出来"]);
      }
      if (hutList.length && hutBuilt < hutList.length) {
        steps.push(["藏身处还有 " + (hutList.length - hutBuilt) + " 个模块未建造", "在「藏身处」分页选定当前等级后，会列出下一级要的材料"]);
      }
      /* 剧情章节只在**已经开始记录**时给建议：没记过就不假设他卡在哪一章——
         这条轨不做推断，建议也要守住同一条线。 */
      if (stc && (stc.done + stc.inhand) > 0 && stc.done < stc.total) {
        steps.push(["剧情章节已记 " + stc.done + " / " + stc.total + " 章",
          "还差 " + (stc.total - stc.done) + " 章 —— 在「剧情章节」分页继续记录（章节顺序见剧情页）"]);
      }

      if (!steps.length) {
        steps.push(["暂时没有可执行的下一步", "先把「我的等级」与进行中任务填上，这里会给出建议"]);
      }
      for (var si = 0; si < steps.length; si++) {
        var li2 = el("li");
        li2.appendChild(el("b", null, steps[si][0]));
        li2.appendChild(el("span", null, steps[si][1]));
        nList.appendChild(li2);
      }
      nSec.appendChild(nList);

      nSec.appendChild(el("p", "tk-board__note",
        (hasGraph ? "任务数字含**由前置推断**的完成（推断 = 进行中任务的上游必然已完成）。"
                  : "⚠️ **任务图未载入**，所以「可接」与「长线还差几条」算不出来，上面只给了不依赖任务图的建议。")
        + "**剧情章节是纯手动记录**：官方任务数据里没有「章节」字段、也没有章节→任务的映射，"
        + "所以这条轨只记你亲手标的状态、**不做任何推断** —— 在「剧情章节」分页记录；"
        + "章节顺序与前置见 [剧情章节与主线任务](../entries/story-chapters.md)。"));

      host.appendChild(nSec);
    });
  }

  /* --------------------------------------------------------------------------
     看板一：任务进度
     -------------------------------------------------------------------------- */

  var MAP_LABEL = {};

  function renderQuestBoard(host, state) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var totalAll = (mf && mf.total) || 0;
    var traders = (mf && mf.traders) || [];
    var tname = {};
    for (var ti = 0; ti < traders.length; ti++) tname[traders[ti].slug] = traders[ti].name;

    host.textContent = "";

    var cards = sumCards([["进行中"], ["已完成"], ["其中由前置推断"], ["可接（条件满足）"]]);
    host.appendChild(cards.el);

    /* 工具条 */
    var bar = el("div", "tk-board__filter");
    var lvWrap = el("label", "tk-board__lv");
    lvWrap.appendChild(el("span", null, "我的等级"));
    var lvIn = document.createElement("input");
    lvIn.type = "number"; lvIn.min = "1"; lvIn.max = "99";
    lvIn.className = "tk-cnt__in";
    lvIn.setAttribute("data-focus-key", "level");
    lvIn.setAttribute("aria-label", "我的当前等级");
    var lv0 = TP.myLevel();
    lvIn.value = lv0 > 0 ? String(lv0) : "";
    lvIn.addEventListener("change", function () { TP.setMyLevel(lvIn.value); });
    lvWrap.appendChild(lvIn);
    bar.appendChild(lvWrap);

    /* 阵营 / 转生 / 门槛面板开关 */
    var facWrap = el("span", "tk-board__seg");
    ["BEAR", "USEC"].forEach(function (f) {
      var b = el("button", "tk-board__segbtn", f);
      b.type = "button";
      b.setAttribute("data-focus-key", "faction-" + f);
      b.addEventListener("click", function () {
        TP.setFaction(TP.gates().faction === f ? "" : f);
      });
      facWrap.appendChild(b);
    });
    bar.appendChild(facWrap);

    var gateBtn = el("button", "tk-board__segbtn", "门槛 ▾");
    gateBtn.type = "button";
    gateBtn.setAttribute("data-focus-key", "gatetoggle");
    bar.appendChild(gateBtn);

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

    /* 门槛面板：默认收起 —— 11 个商人各一个档位，展开会挤满屏幕 */
    var gatePanel = el("div", "tk-board__gatepanel");
    gatePanel.hidden = true;
    var llRow = el("div", "tk-board__llrow");
    for (var gt = 0; gt < traders.length; gt++) {
      (function (slug, label) {
        var w = el("label", "tk-board__ll");
        w.appendChild(el("span", null, label));
        var s = document.createElement("select");
        s.className = "tk-qstate tk-qstate--ll";
        s.setAttribute("data-focus-key", "ll-" + slug);
        s.setAttribute("aria-label", label + " 忠诚度");
        var o0 = document.createElement("option");
        o0.value = ""; o0.textContent = "?";
        s.appendChild(o0);
        for (var v = 1; v <= 4; v++) {
          var o = document.createElement("option");
          o.value = String(v); o.textContent = "LL" + v;
          s.appendChild(o);
        }
        s.addEventListener("change", function () { TP.setLL(slug, s.value); });
        w.appendChild(s);
        llRow.appendChild(w);
      })(traders[gt].slug, traders[gt].name);
    }
    gatePanel.appendChild(llRow);
    /* 这两项放进同一个 flex 行容器：原先它们是 inline-flex，**不会换行** ——
       窄屏下两项合计约 12.72rem 而面板可用约 12.60rem，内容把右边框顶出可视区
       （读者报「边框右边看不见」）。容器允许换行就不会溢出。 */
    var lvRow = el("div", "tk-board__lvrow");
    var prWrap = el("label", "tk-board__lv");
    prWrap.appendChild(el("span", null, "转生次数"));
    var prIn = document.createElement("input");
    prIn.type = "number"; prIn.min = "0"; prIn.max = "19";
    prIn.className = "tk-cnt__in";
    prIn.setAttribute("data-focus-key", "prestige");
    prIn.setAttribute("aria-label", "转生次数");
    prIn.addEventListener("change", function () { TP.setPrestige(prIn.value); });
    prWrap.appendChild(prIn);
    lvRow.appendChild(prWrap);
    /* Fence 声望：单独一个数字输入，**允许负数**。它和上面 11 个 LL 不是一把尺
       ——Fence 的任务要求「声望为负」（亡羊补牢 ≤ −3），而 LL 只有 1–4 的正值。
       塞进 LL 那个下拉框会同时算错两批任务，所以这里独立输入。
       留空 = 未填，判定时按未知处理（只提示、不放行）。 */
    var feWrap = el("label", "tk-board__lv");
    feWrap.appendChild(el("span", null, "Fence 声望"));
    var feIn = document.createElement("input");
    feIn.type = "number"; feIn.min = "-10"; feIn.max = "10"; feIn.step = "1";
    feIn.placeholder = "可负";
    feIn.className = "tk-cnt__in";
    feIn.setAttribute("data-focus-key", "fence");
    feIn.setAttribute("aria-label", "Fence 声望（可填负数）");
    feIn.addEventListener("change", function () { TP.setFence(feIn.value); });
    feWrap.appendChild(feIn);
    lvRow.appendChild(feWrap);
    gatePanel.appendChild(lvRow);
    gatePanel.appendChild(el("p", "tk-board__note",
      "填了才能判准「可接」。**填「?」的商人不会被用作筛选**，"
      + "只在任务行上提示「需 XX LL2」—— 宁可不筛，也不猜。"
      + "**Fence 声望可填负数**（如亡羊补牢要求 ≤ −3）；留空则相关任务只提示、不计入可接。"));
    host.appendChild(gatePanel);

    /* 地图 + 预设 */
    var chipbar = el("div", "tk-board__filter");
    var mapSel = document.createElement("select");
    mapSel.className = "tk-board__mapsel";
    mapSel.setAttribute("data-focus-key", "map");
    mapSel.setAttribute("aria-label", "按地图筛选");
    var mo = document.createElement("option");
    mo.value = ""; mo.textContent = "全部地图";
    mapSel.appendChild(mo);
    chipbar.appendChild(mapSel);

    var presetWrap = el("span", "tk-board__seg");
    [["kappa", "Kappa 线"], ["lk", "Lightkeeper 线"], ["prep", "出发前准备"]].forEach(function (pf) {
      var b = el("button", "tk-board__segbtn", pf[1]);
      b.type = "button";
      b.setAttribute("data-focus-key", "preset-" + pf[0]);
      b.setAttribute("data-preset", pf[0]);
      chipbar.appendChild(b);
    });
    var cnt2 = el("span", "tk-board__filtercount");
    chipbar.appendChild(cnt2);
    host.appendChild(chipbar);

    host.appendChild(el("p", "tk-board__hint",
      "只填你**现在就知道**的：等级、门槛、以及任务列表里手上正拿着的那些。"
      + "它们的**前置会被自动算作已完成**，你不用回忆过去做过什么。"));

    var body = el("div", "tk-board__qbody");
    host.appendChild(body);

    var prepBox = el("div", "tk-board__prep");
    host.appendChild(prepBox);

    var summary = el("div", "tk-board__chips");
    host.appendChild(summary);

    var openTasks = {};   // 哪些任务被展开了（跨重画保留）
    /* 预设按钮要在 sync() 内外都用：里面读状态、外面挂监听。
       声明在 sync() 里会让外面的循环拿到 undefined —— 实测抛
       ReferenceError，把后面的任务树加载一起带崩。 */
    var pbtns = chipbar.querySelectorAll(".tk-board__segbtn");

    /* —— 单行 —— */
    function questRow(qid, node, extra, tree) {
      var wrap = el("div", "tk-qrow");
      var main = el("div", "tk-qrow__main");
      wrap.appendChild(main);

      var sel0 = makeStateSelect(qid, node[N_TRADER], "tk-qstate tk-qstate--row");
      /* 状态改动时把该任务的目标按新状态对齐（全勾=已完成、部分勾=进行中）。
         分段控件没有原生 change 事件，改成监听容器上的自定义事件
         `tk:state`（由 makeStateSelect 在调用 setTaskState 前派发）。 */
      sel0.addEventListener("tk:state", function (ev) {
        var d0 = detailOf(qid);
        if (d0 && d0.o && d0.o.length) {
          TP.alignObjectives(qid, d0.o.map(function (x) { return x[0]; }), ev.detail);
        }
      });
      main.appendChild(sel0);

      var url = questUrl(node[N_LINK]);
      var nm = url ? el("a", "tk-qrow__name", node[N_NAME]) : el("span", "tk-qrow__name", node[N_NAME]);
      if (url) nm.href = url;
      main.appendChild(nm);

      var meta = tname[node[N_TRADER]] || node[N_TRADER] || "—";
      main.appendChild(el("em", "tk-qrow__meta", meta));
      /* 等级为 0 ＝ 数据源没给解锁等级，不是「有个 0 级任务」。
         所以不写 "Lv0"（那会被读成真实等级），留空不加标。 */
      if (node[N_LEVEL]) main.appendChild(el("em", "tk-qrow__lv", "Lv" + node[N_LEVEL]));
      if (extra) main.appendChild(el("em", "tk-qrow__extra", extra));
      if (node[N_FLAGS].indexOf("k") >= 0) main.appendChild(el("em", "tk-qrow__flag", "Kappa"));
      if (node[N_FLAGS].indexOf("l") >= 0) main.appendChild(el("em", "tk-qrow__flag", "LK"));

      var g = tree.gate[qid];
      if (g && (g.why.length || g.soft.length)) {
        var tag = el("em", "tk-qrow__gate", g.why.concat(g.soft).join(" · "));
        tag.title = "这些条件本站无法完全判定，只作提示：算得出来的已用于筛选，算不出来的不影响列表";
        main.appendChild(tag);
      }

      /* 展开按钮：拉该商人那一块明细，显示目标清单 */
      var ex = el("button", "tk-qrow__exp", openTasks[qid] ? "收起" : "目标");
      ex.type = "button";
      ex.setAttribute("data-focus-key", "exp-" + qid);
      ex.addEventListener("click", function () {
        openTasks[qid] = !openTasks[qid];
        sync();
      });
      main.appendChild(ex);

      var st = TP.taskState(qid);
      if (st === "inhand") wrap.className += " st-inhand";
      if (st === "done") wrap.className += " st-done";

      if (openTasks[qid]) {
        var d = el("div", "tk-qrow__detail");
        wrap.appendChild(d);
        renderObjectives(d, qid, node);
      }
      return wrap;
    }

    /* —— 目标清单（按需加载该商人的明细块） —— */
    function renderObjectives(box, qid, node) {
      var det = detailOf(qid);
      if (det) { fillObjectives(box, qid, det); return; }
      box.appendChild(el("p", "tk-board__loading", "正在载入目标…"));
      var slug = (node[N_LINK] || "").split("#")[0];
      ensureDetail(slug, function (ok) {
        box.textContent = "";
        if (!ok) { box.appendChild(notReady("任务明细")); return; }
        var d = detailOf(qid);
        if (d) fillObjectives(box, qid, d);
      });
    }

    function fillObjectives(box, qid, det) {
      var objs = det.o || [];
      var met = 0;
      /* 自愈：任务记为「已完成」但目标一个没勾（可能在任务页上直接改的状态，
         那里拿不到目标清单）→ 补勾，避免出现「已完成但 0/N」的矛盾。 */
      if (TP.taskState(qid) === "done" && objs.length) {
        var allDone = true;
        for (var z = 0; z < objs.length; z++) if (!TP.objDone(qid, objs[z][0])) { allDone = false; break; }
        if (!allDone) TP.alignObjectives(qid, objs.map(function (x) { return x[0]; }), "done");
      }
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        var row = el("label", "tk-obj");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = TP.objDone(qid, o[0]);
        if (cb.checked) met++;
        cb.setAttribute("data-focus-key", "obj-" + o[0]);
        (function (oid) {
          cb.addEventListener("change", function () {
            var was = TP.objDone(qid, oid);
            TP.setObjective(qid, oid, cb.checked);
            syncObjectives(qid);
            var host0 = box.closest(".tk-board__qbody") || box;
            toast(host0, cb.checked ? "已勾选该目标。" : "已取消该目标。", true,
              function () { TP.setObjective(qid, oid, was); syncObjectives(qid); sync(); });
          });
        })(o[0]);
        row.appendChild(cb);
        var txt = el("span", "tk-obj__text", o[1] || "（无描述）");
        row.appendChild(txt);
        if (o[2]) row.appendChild(el("em", "tk-obj__n", "×" + fmtNum(o[2])));
        if (o[3]) row.appendChild(el("em", "tk-obj__fir", "战局中"));
        box.appendChild(row);
      }
      if (!objs.length) box.appendChild(el("p", "tk-board__empty", "该任务在数据里没有目标条目。"));
      else box.appendChild(el("p", "tk-board__note",
        "目标进度 " + met + " / " + objs.length + " —— 全部勾完，任务会自动记为「已完成」。"));
      if (det.p && det.p.length) {
        var h = el("div", "tk-qrow__preph");
        h.textContent = "这一条要带 / 要找（" + det.p.length + " 项）：";
        box.appendChild(h);
        var wrap2 = el("div", "tk-qrow__prep");
        for (var k = 0; k < det.p.length; k++) {
          var it = det.p[k];
          var pr = el("span", "tk-prepitem");
          pr.appendChild(el("span", "tk-prepitem__n", it[0]));
          if (it[2]) pr.appendChild(el("em", "tk-prepitem__fir", "战局中"));
          pr.appendChild(el("em", "tk-prepitem__c", "×" + fmtNum(it[1])));
          pr.appendChild(el("em", "tk-prepitem__have", "已 " + fmtNum(TP.itemCount(it[0]))));
          wrap2.appendChild(pr);
        }
        box.appendChild(wrap2);
      }
    }

    /* 目标变化后回写任务状态：全勾=已完成；部分勾=进行中；由已完成退回时降为进行中 */
    function syncObjectives(qid) {
      var det = detailOf(qid);
      if (!det || !det.o || !det.o.length) return;
      var oids = det.o.map(function (x) { return x[0]; });
      var n = TP.countObjectives(qid, oids);
      var st = TP.taskState(qid);
      if (n === oids.length && st !== "done") {
        TP.setTaskState(qid, "done", "", undefined);
      } else if (n > 0 && st === "done") {
        TP.setTaskState(qid, "inhand", "", undefined);
      } else if (n > 0 && st === "") {
        TP.setTaskState(qid, "inhand", "", undefined);
      }
    }

    /* —— 出发前准备（从进行中任务聚合） —— */
    function renderPrep(graph, inIds) {
      /* ⚠️ 这里**不能**先清空：下面的 draw() 有缓存戳，戳命中时会直接返回，
         于是「先清空、再被戳挡住」= 面板永远空着。清空必须挪到缓存判断之后。
         实测踩到：准备清单一直显示 0 项。 */
      if (!prepBox.__on) {
        prepBox.textContent = "";
        prepBox.__stamp = "";
        return;
      }
      if (!inIds.length) {
        prepBox.appendChild(el("p", "tk-board__note", "「出发前准备」来自**进行中任务**。先标记几个进行中任务。"));
        return;
      }
      var slugs = {};
      for (var i = 0; i < inIds.length; i++) {
        var lk = (graph.tasks[inIds[i]] || [])[N_LINK] || "";
        var sl = lk.split("#")[0];
        if (sl) slugs[sl] = 1;
      }
      var keys = Object.keys(slugs), pending = keys.length, failed = 0;
      keys.forEach(function (sl) {
        ensureDetail(sl, function (ok) { if (!ok) failed++; pending--; draw(); });
      });
      draw();

      function draw() {
        /* ⚠️ 还有分块没到位时**必须直接返回、不能写缓存戳** ——
           否则第一次画出来的是不完整的清单，而戳已经记下，
           等缺的那块载完再进来就被戳挡住、永远不重画。 */
        if (pending > 0) return;
        if (prepBox.__stamp === inIds.join(",") + "|" + failed) return;
        prepBox.__stamp = inIds.join(",") + "|" + failed;
        prepBox.textContent = "";   // ← 清空在缓存判断之后
        /* 先算一遍「有没有任何准备项」，用于空态提示；
           真正的渲染在下面按地图分组时再做一次（同源，不引入第二套口径）。 */
        var any = 0;
        for (var j = 0; j < inIds.length; j++) {
          var det = detailOf(inIds[j]);
          if (det && det.p && det.p.length) any += det.p.length;
        }
        var head = el("div", "tk-qsec__head");
        head.appendChild(el("b", null, "出发前准备"));
        head.appendChild(el("em", null, inIds.length + " 个进行中任务 · " + any + " 项"));
        prepBox.appendChild(head);
        if (failed) {
          prepBox.appendChild(el("p", "tk-board__note",
            "有 " + failed + " 个商人的任务明细没载入，下面的清单不完整。"));
        }
        if (!any) {
          prepBox.appendChild(el("p", "tk-board__empty", "这几个任务的数据里没有「要带 / 要找」的条目。"));
          return;
        }

        /* 2026-10-07 重做（读者反馈「根据地图和任务推荐带的物品的提示也做得不好」）。
           原先是一张四列表格，把「必须战局中带出」和「可采购」混在一起平铺，
           读者的问题答不上来：**这一趟去哪个图、还缺什么**。
           改成三块，原因与做法都对着这个问题：
             ① **先按地图分**——准备清单的用途是「出门前照着看」，而出门前
                心里已有的是「今晚去哪张图」。分不清地图的清单等于没有顺序。
                地图取自任务图的 map 字段（缺失的归「多图 / 未标注」）。
             ② **缺口置顶**——已够的沉到底部。现在表格按数量排序，
                「还差 12 个螺丝」和「已齐」混在一起，缺口不醒目。
             ③ **FIR / 可采购分区**——「必须战局中带出」是买不到的，
                混排时读者会以为都能跳蚤市场买。 */
        var byMap = {}, mapOrder = [];
        for (var q2 = 0; q2 < inIds.length; q2++) {
          var node2 = graph.tasks[inIds[q2]] || [];
          var mp = node2[N_MAP] || "";
          if (!byMap[mp]) { byMap[mp] = []; mapOrder.push(mp); }
          var det2 = detailOf(inIds[q2]);
          if (!det2 || !det2.p) continue;
          for (var p2 = 0; p2 < det2.p.length; p2++) {
            var it3 = det2.p[p2];
            byMap[mp].push([it3[0], it3[1], !!it3[2]]);
          }
        }

        var wrapAll = el("div", "tk-prep");
        mapOrder.forEach(function (mp) {
          var items0 = byMap[mp];
          if (!items0.length) return;
          /* 同一张图内合并同名项，再按「是否达标」排 */
          var merged = {};
          for (var z = 0; z < items0.length; z++) {
            var cur0 = merged[items0[z][0]];
            if (cur0) { cur0[1] += items0[z][1]; cur0[2] = cur0[2] || items0[z][2]; }
            else merged[items0[z][0]] = [items0[z][0], items0[z][1], items0[z][2]];
          }
          var rows = Object.keys(merged).map(function (k3) { return merged[k3]; });
          var lack = [];
          for (var r1 = 0; r1 < rows.length; r1++) {
            if ((TP.itemCount(rows[r1][0]) || 0) < rows[r1][1]) lack.push(rows[r1]);
          }
          rows.sort(function (a, b) {
            var am = (TP.itemCount(a[0]) || 0) >= a[1] ? 1 : 0;
            var bm = (TP.itemCount(b[0]) || 0) >= b[1] ? 1 : 0;
            if (am !== bm) return am - bm;            /* 缺的在前 */
            return (a[2] === b[2]) ? a[1] - b[1] : (a[2] ? -1 : 1);
          });

          var g3 = el("section", "tk-prep__map");
          var h3 = el("div", "tk-prep__head");
          h3.appendChild(el("b", null, mp || "多图 / 未标注"));
          h3.appendChild(el("em", null, lack.length
            ? ("还缺 " + lack.length + " 项")
            : ("已齐 " + rows.length + " 项")));
          g3.appendChild(h3);

          var fir = [], buy = [];
          for (var r2 = 0; r2 < rows.length; r2++) (rows[r2][2] ? fir : buy).push(rows[r2]);
          [
            ["必须战局中带出 · 跳蚤市场买不到", fir, "fir"],
            ["可采购 · 跳蚤市场或藏身处", buy, "buy"]
          ].forEach(function (grp) {
            if (!grp[1].length) return;
            var sec = el("div", "tk-prep__grp");
            sec.appendChild(el("h4", "tk-prep__grph", grp[0] + "（" + grp[1].length + "）"));
            var ul = el("ul", "tk-prep__ul");
            grp[1].forEach(function (it4) {
              var have0 = TP.itemCount(it4[0]) || 0;
              var ok0 = have0 >= it4[1];
              var li0 = el("li", "tk-prep__li" + (ok0 ? " is-met" : ""));
              var ctl0 = countCtl(it4[0], it4[1]);
              li0.appendChild(ctl0.el);
              var nm2 = el("span", "tk-prep__nm", it4[0]);
              li0.appendChild(nm2);
              li0.appendChild(el("span", "tk-prep__qty",
                fmtNum(have0) + " / " + fmtNum(it4[1])));
              if (!ok0) {
                li0.appendChild(el("em", "tk-prep__lack", "缺 " + fmtNum(it4[1] - have0)));
              }
              ul.appendChild(li0);
            });
            sec.appendChild(ul);
            g3.appendChild(sec);
          });
          wrapAll.appendChild(g3);
        });
        prepBox.appendChild(wrapAll);
      }
    }

    /* —— 主同步 —— */
    var gateOpen = false;
    gateBtn.addEventListener("click", function () {
      gateOpen = !gateOpen;
      gatePanel.hidden = !gateOpen;
      gateBtn.textContent = gateOpen ? "门槛 ▴" : "门槛 ▾";
    });

    function sync() {
      var graph = window.TARKOV_QUEST_GRAPH || null;
      var gates = TP.gates();

      /* 工具条状态回填（只在没有焦点时写，免得打断输入） */
      if (document.activeElement !== lvIn) lvIn.value = gates.level > 0 ? String(gates.level) : "";
      if (document.activeElement !== prIn) prIn.value = gates.prestige > 0 ? String(gates.prestige) : "";
      /* Fence 声望回填：0 是真实值，必须与「未填」区分开 —— 所以判的是
         null/undefined，不是真值。否则填了 0 的人会被清空。 */
      if (document.activeElement !== feIn) {
        feIn.value = (gates.fence === null || gates.fence === undefined) ? "" : String(gates.fence);
      }
      var segs = facWrap.querySelectorAll(".tk-board__segbtn");
      for (var s = 0; s < segs.length; s++) {
        segs[s].classList.toggle("is-on", segs[s].textContent === gates.faction);
      }
      var lls = llRow.querySelectorAll("select");
      for (var q = 0; q < lls.length; q++) {
        var slug0 = (lls[q].getAttribute("data-focus-key") || "").replace("ll-", "");
        if (document.activeElement !== lls[q]) lls[q].value = gates.ll[slug0] || "";
      }

      if (!graph) {
        body.textContent = "";
        body.appendChild(graphState === 1 ? el("p", "tk-board__loading", "正在载入任务树…")
                                         : notReady("任务树"));
        cnt.textContent = "";
        cnt2.textContent = "";
        summary.textContent = "";
        prepBox.textContent = "";
        return;
      }

      /* 地图选项只要建一次 */
      if (!mapSel.__filled) {
        var ms = {};
        for (var id0 in graph.tasks) {
          var mv = graph.tasks[id0][N_MAP];
          if (mv) ms[mv] = (ms[mv] || 0) + 1;
        }
        Object.keys(ms).sort(function (a, b) { return ms[b] - ms[a]; }).forEach(function (mv) {
          var o = document.createElement("option");
          o.value = mv; o.textContent = mv + "（" + ms[mv] + "）";
          mapSel.appendChild(o);
        });
        mapSel.__filled = true;
      }

      var md = TP.data();
      var explicit = md.modes[md.mode].quests || {};
      var inhand = md.modes[md.mode].inhand || {};
      var tree = computeTree(graph, explicit, inhand, gates);

      var inIds = Object.keys(inhand), doneIds = Object.keys(tree.done);
      var qtext = (search.value || "").trim().toLowerCase();
      var mapPick = mapSel.value;

      /* 预设筛选 */
      var presets = {};
      for (var pb = 0; pb < pbtns.length; pb++) {
        presets[pbtns[pb].getAttribute("data-preset")] = pbtns[pb].classList.contains("is-on");
      }
      prepBox.__on = presets.prep;

      function passPreset(qid) {
        var n = graph.tasks[qid];
        if (presets.kappa && n[N_FLAGS].indexOf("k") < 0) return false;
        if (presets.lk && n[N_FLAGS].indexOf("l") < 0) return false;
        return true;
      }

      cards.refs["进行中"].textContent = String(inIds.length);
      cards.refs["已完成"].textContent = String(doneIds.length);
      cards.refs["其中由前置推断"].textContent = String(Object.keys(tree.inferred).length);
      cards.refs["可接（条件满足）"].textContent = String(tree.avail.length);

      function byLevel(a, b) {
        return (graph.tasks[a][N_LEVEL] - graph.tasks[b][N_LEVEL]) ||
               (graph.tasks[a][N_NAME] < graph.tasks[b][N_NAME] ? -1 : 1);
      }

      keepFocus(body, function () {
        body.textContent = "";

        if (qtext) {
          var hits = [];
          for (var id in graph.tasks) {
            var n = graph.tasks[id];
            var hay = (n[N_NAME] + " " + (tname[n[N_TRADER]] || n[N_TRADER] || "") + " " + n[N_LEVEL]).toLowerCase();
            if (hay.indexOf(qtext) >= 0 && passPreset(id)) hits.push(id);
          }
          hits.sort(byLevel);
          var s0 = section("搜索结果", hits.length + " 个任务匹配「" + search.value.trim() + "」");
          for (var i0 = 0; i0 < hits.length && i0 < 100; i0++) {
            s0.box.appendChild(questRow(hits[i0], graph.tasks[hits[i0]], null, tree));
          }
          if (hits.length > 100) s0.box.appendChild(el("p", "tk-board__note", "只显示了前 100 个，继续输入以缩小范围。"));
          body.appendChild(s0.sec);
          cnt.textContent = "匹配 " + hits.length + " / " + graph.total;
          cnt2.textContent = "";
          return;
        }

        function filtered(ids) {
          var out = [];
          for (var z = 0; z < ids.length; z++) {
            var nn = graph.tasks[ids[z]];
            if (!nn) continue;
            if (mapPick && nn[N_MAP] !== mapPick) continue;
            if (!passPreset(ids[z])) continue;
            out.push(ids[z]);
          }
          return out;
        }

        var fIn = filtered(inIds).sort(byLevel);
        var fAv = filtered(tree.avail).sort(byLevel);
        var fDn = filtered(doneIds).sort(byLevel);

        var s1 = section("进行中", fIn.length + " 个" + (mapPick || Object.keys(presets).some(function (k) { return presets[k]; }) ? "（已筛）" : ""), "tk-qsec--inhand");
        if (!fIn.length) {
          s1.box.appendChild(el("p", "tk-board__empty",
            inIds.length ? "当前筛选下没有进行中任务。" : "还没标记任何任务。在下面「可接」里把状态改成「进行中」，或用搜索框找任务。"));
        } else {
          for (var a1 = 0; a1 < fIn.length && a1 < QROW_CAP; a1++) {
            s1.box.appendChild(questRow(fIn[a1], graph.tasks[fIn[a1]], null, tree));
          }
        }
        body.appendChild(s1.sec);

        var s2 = section("可接（前置 + 等级 + 门槛都满足）", fAv.length + " 个", "tk-qsec--avail");
        if (!fAv.length) {
          s2.box.appendChild(el("p", "tk-board__empty", tree.avail.length
            ? "可接的任务都在筛选之外。"
            : (gates.level > 0 ? "没有满足条件的任务 —— 检查等级、门槛或前置。" : "先填「我的等级」，否则无法筛出可接的任务。")));
        } else {
          for (var a2 = 0; a2 < fAv.length && a2 < QROW_CAP; a2++) {
            var q2 = fAv[a2];
            var st2 = tree.stat[q2] || [0, 0];
            s2.box.appendChild(questRow(q2, graph.tasks[q2], st2[1] ? "前置 " + st2[0] + "/" + st2[1] : "无前置", tree));
          }
          if (fAv.length > QROW_CAP) s2.box.appendChild(el("p", "tk-board__note", "只显示了前 " + QROW_CAP + " 个（按等级升序），其余用搜索框找。"));
        }
        body.appendChild(s2.sec);

        var s3 = section("已完成", fDn.length + " 个（含 " + Object.keys(tree.inferred).length + " 个由前置推断）", "tk-qsec--done");
        if (!fDn.length) {
          s3.box.appendChild(el("p", "tk-board__empty", "还没有已完成的任务。"));
        } else {
          for (var a3 = 0; a3 < fDn.length && a3 < QROW_CAP; a3++) {
            var q3 = fDn[a3];
            s3.box.appendChild(questRow(q3, graph.tasks[q3], tree.inferred[q3] ? "推断" : "手动", tree));
          }
          if (fDn.length > QROW_CAP) s3.box.appendChild(el("p", "tk-board__note", "只显示了前 " + QROW_CAP + " 个，其余用搜索框找。"));
        }
        body.appendChild(s3.sec);

        cnt.textContent = "共 " + totalAll + " 个任务";
        cnt2.textContent = (mapPick ? "地图 " + mapPick + " · " : "") + "进行中 " + fIn.length + " / 可接 " + fAv.length;
      });

      renderPrep(graph, inIds);

      var chips = el("div", "tk-board__chiprow");
      var byTrader = {};
      for (var t2 = 0; t2 < traders.length; t2++) byTrader[traders[t2].slug] = 0;
      for (var d2 = 0; d2 < doneIds.length; d2++) {
        var nd2 = graph.tasks[doneIds[d2]];
        if (nd2 && byTrader[nd2[N_TRADER]] !== undefined) byTrader[nd2[N_TRADER]]++;
      }
      for (var t3 = 0; t3 < traders.length; t3++) {
        var chip = el("span", "tk-chip");
        chip.appendChild(el("i", null, traders[t3].name));
        chip.appendChild(el("b", null, byTrader[traders[t3].slug] + "/" + traders[t3].count));
        chips.appendChild(chip);
      }
      summary.textContent = "";
      summary.appendChild(chips);
    }

    function section(title, sub, cls) {
      var sec = el("div", "tk-qsec " + (cls || ""));
      var head = el("div", "tk-qsec__head");
      head.appendChild(el("b", null, title));
      head.appendChild(el("em", null, sub));
      sec.appendChild(head);
      var box = el("div", "tk-qsec__body");
      sec.appendChild(box);
      return { sec: sec, head: head, box: box };
    }

    search.addEventListener("input", sync);
    mapSel.addEventListener("change", sync);
    for (var pb2 = 0; pb2 < pbtns.length; pb2++) {
      pbtns[pb2].addEventListener("click", function (e) {
        e.currentTarget.classList.toggle("is-on");
        sync();
      });
    }
    host.__tkSync = sync;

    if (window.TARKOV_QUEST_GRAPH) sync();
    else {
      body.appendChild(el("p", "tk-board__loading", "正在载入任务树…"));
      ensureGraph(function () { sync(); });
    }
  }

  /* --------------------------------------------------------------------------
     看板二：物品收集（数量式）
     -------------------------------------------------------------------------- */

  function renderItemBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var items = (mf && mf.items) || { total: 0, list: [] };
    var list = items.list || [];
    host.textContent = "";
    if (!list.length) { host.appendChild(notReady("物品清单")); return; }

    var cards = sumCards([["已达标"], ["已囤种类"], ["已囤件数"], ["清单物品", String(items.total || list.length)]]);
    var refs = cards.refs;
    host.appendChild(cards.el);

    var bar = el("div", "tk-board__filter");
    var input = document.createElement("input");
    input.type = "search";
    input.className = "tk-board__search";
    input.placeholder = "筛选物品名 / 商人名";
    input.setAttribute("data-focus-key", "isearch");
    input.setAttribute("aria-label", "筛选物品");
    bar.appendChild(input);
    var only = document.createElement("label");
    only.className = "tk-board__check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    only.appendChild(cb);
    only.appendChild(document.createTextNode("只看未达标"));
    bar.appendChild(only);
    var count = el("span", "tk-board__filtercount");
    bar.appendChild(count);
    host.appendChild(bar);

    var tbody = el("tbody");
    var rows = [];
    var cardTotal = list.length;

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
    host.appendChild(el("p", "tk-board__note", (items.note || "") + " 达标 = 已囤件数 ≥ 合计数量。"));

    function apply() {
      var q = (input.value || "").trim().toLowerCase();
      var onlyOn = cb.checked;
      var shown = 0, met = 0, kinds = 0, held = 0;
      for (var r = 0; r < rows.length; r++) {
        var v = TP.itemCount(rows[r].it.name);
        var ok2 = v >= rows[r].it.qty;
        if (ok2) met++;
        if (v > 0) { kinds++; held += v; }
        rows[r].ctl.set(v);
        rows[r].tr.className = ok2 ? "tk-met" : "";
        var hay = (rows[r].it.name + " " + (rows[r].it.traders || "")).toLowerCase();
        var hit = (!q || hay.indexOf(q) >= 0) && (!onlyOn || !ok2);
        rows[r].tr.hidden = !hit;
        if (hit) shown++;
      }
      count.textContent = "显示 " + shown + " / " + rows.length;
      refs["已达标"].textContent = met + " / " + cardTotal;
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
     -------------------------------------------------------------------------- */

  function topLevel(mod) {
    var lv = (mod && mod.levels) || [], top = 0;
    for (var i = 0; i < lv.length; i++) {
      var n = parseInt(lv[i].level, 10);
      if (isFinite(n) && n > top) top = n;
    }
    return top;
  }

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

  function renderHideoutBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var hut = (mf && mf.hideout) || { total: 0, list: [] };
    var list = hut.list || [];
    host.textContent = "";
    if (!list.length) { host.appendChild(notReady("藏身处清单")); return; }

    var cards = sumCards([["已建造"], ["已建满"], ["现在可升"], ["前置未通"]]);
    var refs = cards.refs;
    host.appendChild(cards.el);

    /* 模块中文名索引：前置判定要按名字反查另一个模块的当前等级 */
    var byName = {};
    for (var bi = 0; bi < list.length; bi++) if (list[bi].name) byName[list[bi].name] = list[bi];

    /* 计数式筛选：每一档都带实时数字（学的是小喵的「可建造 9 / 条件不足 17」）——
       先告诉你分布，再让你筛，比只给一个复选框更快看懂全局。 */
    var FILTERS = [
      ["all", "全部"],
      ["can", "现在可升"],
      ["lock", "前置未通"],
      ["mat", "材料未齐"],
      ["max", "已建满"]
    ];
    var mode = "all";
    var bar = el("div", "tk-hut__chips");
    var chipEls = {};
    for (var fi = 0; fi < FILTERS.length; fi++) {
      (function (f) {
        var b = el("button", "tk-hut__chip");
        b.type = "button";
        var lab = el("span", null, f[1]);
        var num = el("b", null, "0");
        b.appendChild(lab);
        b.appendChild(num);
        b.addEventListener("click", function () { mode = f[0]; apply(); });
        bar.appendChild(b);
        chipEls[f[0]] = { el: b, num: num };
      })(FILTERS[fi]);
    }
    host.appendChild(bar);
    var count = el("span", "tk-board__filtercount");
    host.appendChild(count);

    var cells = [];
    var groups = [], byLayer = {};
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
        var built = hideoutCard(byLayer[groups[gi]][k], byName);
        cells.push(built);
        grid.appendChild(built.el);
      }
      sec.appendChild(grid);
      host.appendChild(sec);
    }
    host.appendChild(el("p", "tk-board__note",
      (hut.note || "") + " **「现在可升」＝ 前置设施已通 ＋ 材料已齐**；"
      + "「前置未通」的卡片会写明还缺哪个模块的几级。"
      + "**技能要求只提示不判定** —— 技能等级是游戏内状态，本站不记录。"));

    function apply() {
      var builtN = 0, maxedN = 0, canN = 0, lockN = 0, matN = 0, shown = 0;
      for (var r = 0; r < cells.length; r++) {
        var st = cells[r].sync();
        /* 四档必须**互斥**，否则「材料未齐」会把前置未通的也吞进来（26/26 全中，
           数字就没有信息量）。分区口径：已建满 ｜ 前置未通 ｜ 现在可升 ｜ 前置已通但材料未齐。 */
        var matShort = !st.maxed && !st.locked && !st.ready;
        if (st.built) builtN++;
        if (st.maxed) maxedN++;
        if (st.canBuild) canN++;
        if (st.locked) lockN++;
        if (matShort) matN++;
        var show = mode === "all"
          || (mode === "can" && st.canBuild)
          || (mode === "lock" && st.locked)
          || (mode === "mat" && matShort)
          || (mode === "max" && st.maxed);
        cells[r].el.hidden = !show;
        if (show) shown++;
      }
      /* 整组都空时把分组标题也收起来 —— 否则筛「现在可升」会看到一堆空标题 */
      var secs = host.querySelectorAll(".tk-hut");
      for (var si = 0; si < secs.length; si++) {
        var vis = secs[si].querySelectorAll(".tk-hut__cell:not([hidden])").length;
        secs[si].hidden = vis === 0;
      }
      for (var ci = 0; ci < FILTERS.length; ci++) {
        var f = FILTERS[ci], n = 0;
        if (f[0] === "all") n = cells.length;
        else if (f[0] === "can") n = canN;
        else if (f[0] === "lock") n = lockN;
        else if (f[0] === "mat") n = matN;
        else n = maxedN;
        chipEls[f[0]].num.textContent = String(n);
        chipEls[f[0]].el.setAttribute("aria-pressed", mode === f[0] ? "true" : "false");
      }
      count.textContent = "显示 " + shown + " / " + cells.length + " 个模块";
      refs["已建造"].textContent = builtN + " / " + cells.length;
      refs["已建满"].textContent = String(maxedN);
      refs["现在可升"].textContent = String(canN);
      refs["前置未通"].textContent = String(lockN);
    }
    host.__tkSync = apply;
    apply();
  }

  /* 前置设施判定：把「前置 安保 1 级」从**一行文字**变成**真的判定**。

     数据一直都在 —— progress-manifest.js 里每个模块的 `levels[].stations[]` 就是前置
     （实测 26 个模块 / 68 个等级 / **126 条前置边**），此前却没参与判定，
     看板还写着「前置设施与技能属游戏内状态，本站没有数据可判定」—— **「前置」那半句是错的**。

     ⚠️ **技能要求（`levels[].skills[]`）确实没有数据源**（本站不记录技能等级），
     所以它只提示、不判定。两条要**分开表述**，不能混成一句「本站没有数据」。

     `byName` 是「模块中文名 → 模块对象」的索引，由 renderHideoutBoard 建好后传进来；
     前置里出现站内没有的模块名时按「未知」处理（不谎报为 0 级，也不放行）。 */
  function missingPrereqs(req, byName) {
    var out = [];
    for (var i = 0; i < req.stations.length; i++) {
      var s = req.stations[i];
      if (!s || !s.name) continue;
      var m = byName[s.name];
      var want = parseInt(s.level, 10) || 0;
      var have = m ? (parseInt(TP.hideoutLevel(m.name), 10) || 0) : 0;
      if (have < want) out.push({ name: s.name, want: want, have: have, known: !!m });
    }
    return out;
  }

  function hideoutCard(mod, byName) {
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
    sel.setAttribute("data-focus-key", "hut-" + mod.en);
    sel.setAttribute("aria-label", mod.name + " 当前等级");
    var top = topLevel(mod);
    var o0 = document.createElement("option");
    o0.value = "0"; o0.textContent = "未建造";
    sel.appendChild(o0);
    for (var v = 1; v <= top; v++) {
      var o = document.createElement("option");
      o.value = String(v);
      o.textContent = v + " 级" + (v === top ? "（满）" : "");
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () { TP.setHideoutLevel(mod.name, sel.value); });
    lvl.appendChild(sel);
    lvl.appendChild(el("em", "tk-hut__cap", "上限 " + top + " 级"));
    cell.appendChild(lvl);

    var next = el("div", "tk-hut__next");
    cell.appendChild(next);
    var nextHead = el("div", "tk-hut__nexthead");
    var deps = el("div", "tk-hut__deps");
    var matWrap = el("div", "tk-hut__mat");
    next.appendChild(nextHead);
    next.appendChild(deps);
    next.appendChild(matWrap);
    var doneBadge = el("div", "tk-hut__done", "已建满");
    cell.appendChild(doneBadge);
    /* 前置未通的徽标 —— 与「已建满」互斥，同一位置只显示一个 */
    var lockBadge = el("div", "tk-hut__lock");
    lockBadge.hidden = true;
    cell.appendChild(lockBadge);

    var matRows = [];
    function buildNext(req) {
      nextHead.textContent = "下一级：" + req.level + " 级 ｜ 施工 " + fmtTime(req.time);
      /* 前置逐条渲染成可判定的行：满足打勾、不足写「现有 N 级」。
         技能单独一组（无数据源，只提示）—— 不与前置混在一起。 */
      deps.textContent = "";
      var miss = missingPrereqs(req, byName);
      var i;
      for (i = 0; i < req.stations.length; i++) {
        var s = req.stations[i];
        if (!s || !s.name) continue;
        deps.appendChild(depPill("前置 " + s.name + " " + s.level + " 级", s, byName, miss));
      }
      for (i = 0; i < req.skills.length; i++) {
        var sk = req.skills[i];
        if (!sk || !sk.name) continue;
        var pill = el("span", "tk-hut__dep tk-hut__dep--unknown",
          "技能 " + sk.name + " " + sk.level + " 级");
        pill.title = "技能等级是游戏内状态，本站不记录，故只提示不判定";
        deps.appendChild(pill);
      }
      deps.hidden = !deps.firstChild;
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

    /* 一条前置的呈现：满足 → 勾 + 次要色；不足 → 叉 + 警示色 + 「现有 N 级」 */
    function depPill(text, s, map, miss) {
      var bad = null;
      for (var i = 0; i < miss.length; i++) {
        if (miss[i].name === s.name && miss[i].want === (parseInt(s.level, 10) || 0)) bad = miss[i];
      }
      var pill = el("span", "tk-hut__dep" + (bad ? " tk-hut__dep--no" : " tk-hut__dep--ok"),
        (bad ? "✕ " : "✓ ") + text + (bad ? "（现有 " + bad.have + " 级）" : ""));
      if (bad && !bad.known) pill.title = "站内没有这个模块的记录，无法判定 —— 按未满足处理";
      else if (bad) pill.title = "先把 " + bad.name + " 升到 " + bad.want + " 级";
      return pill;
    }

    function sync() {
      var level = TP.hideoutLevel(mod.name);
      if (sel.value !== String(level)) sel.value = String(level);
      var maxed = level >= top && top > 0;
      var req = nextLevelReq(mod, level);
      var miss = req ? missingPrereqs(req, byName) : [];
      var locked = !maxed && !!req && miss.length > 0;
      /* ⚠️ 指纹必须**把前置的当前等级也算进去**：只按 `req.level` 做指纹时，
         你升级「安保」之后，那些以「安保」为前置的卡片指纹不变 → deps 不重建 →
         勾/叉停在旧状态。这正是「同一份数据两条渲染路径，其中一条不刷新」的老坑。 */
      var preSig = req ? req.stations.map(function (s) { return TP.hideoutLevel(s && s.name) || 0; }).join(",") : "";
      var stamp = maxed ? "max" : (req ? req.level + "|" + preSig : "none");
      if (cell.getAttribute("data-stamp") !== stamp) {
        cell.setAttribute("data-stamp", stamp);
        if (maxed) { next.hidden = true; doneBadge.hidden = false; lockBadge.hidden = true; }
        else if (!req) { next.hidden = true; doneBadge.hidden = true; lockBadge.hidden = true; }
        else {
          next.hidden = false; doneBadge.hidden = true;
          lockBadge.hidden = !locked;
          if (locked) {
            lockBadge.textContent = "前置未通：还缺 " + miss.map(function (m) {
              return m.name + " " + m.want + " 级";
            }).join("、");
          }
          buildNext(req);
        }
      }
      var allMet = true;
      for (var i = 0; i < matRows.length; i++) {
        var got = TP.itemCount(matRows[i].name);
        matRows[i].ctl.set(got);
        var ok2 = got >= matRows[i].need;
        if (!ok2) allMet = false;
        matRows[i].row.className = ok2 ? "tk-hut__mrow tk-met" : "tk-hut__mrow";
      }
      if (!matRows.length) allMet = false;
      var matsOK = !maxed && matRows.length > 0 && allMet;
      cell.className = "tk-hut__cell"
        + (level > 0 ? " is-built" : "")
        + (maxed ? " is-maxed" : "")
        + (locked ? " is-locked" : "")
        + (matsOK ? " is-ready" : "");
      return {
        built: level > 0, maxed: maxed,
        ready: matsOK,                       /* 兼容旧语义：只看材料 */
        locked: locked,
        canBuild: matsOK && !locked          /* 「现在就能升」：前置与材料都齐 */
      };
    }
    return { el: cell, sync: sync };
  }

  /* --------------------------------------------------------------------------
     看板四：剧情章节（10 章的三态记录）

     **这条轨不做任何推断**：完成数就是读者亲手标的那些，没有百分比之外的
     算法，也不要与任务轨的「前置反推」混读 —— 官方数据里没有章节这层结构。
     交互与其它看板一致：三态控件每行可改，__tkSync 增量回填（不重建行，
     保住焦点 —— 与依赖树同款做法）。
     -------------------------------------------------------------------------- */

  function chLabel(ch) {
    /* 章节名的显示口径：同时有英文与中文时用「英文（中文）」——
       与剧情页一致（认英文名最稳，中文名只作辅助）。 */
    if (ch.en && ch.zh) return ch.en + "（" + ch.zh + "）";
    return ch.en || ch.zh || ch.id;
  }

  function renderStoryBoard(host) {
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var sl = (mf && mf.storyline) || { total: 0, list: [] };
    var list = sl.list || [];
    host.textContent = "";
    if (!list.length) { host.appendChild(notReady("剧情章节清单")); return; }
    if (!makeChapterSelect || !syncStateSeg) { host.appendChild(notReady("剧情章节看板")); return; }

    var cards = sumCards([
      ["已完成"], ["进行中"], ["未标记"], ["章节总数", String(sl.total || list.length)]
    ]);
    var refs = cards.refs;
    host.appendChild(cards.el);

    var tbody = el("tbody");
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var ch = list[i];
      var tr = el("tr");
      var tdCtl = el("td", "tk-board__pick");
      var ctl = makeChapterSelect(ch.id);
      tdCtl.appendChild(ctl);
      tr.appendChild(tdCtl);
      tr.appendChild(el("td", null, chLabel(ch)));
      tr.appendChild(el("td", "tk-board__num", String(ch.objectives)));
      tr.appendChild(el("td", "tk-board__who", ch.note || "—"));
      rows.push({ tr: tr, ctl: ctl, ch: ch });
      tbody.appendChild(tr);
    }
    host.appendChild(wrapTable(["状态", "章节", "目标数", "在主线里的位置"], tbody));
    host.appendChild(el("p", "tk-board__note",
      (sl.note || "") + " 章节清单与前置见 [剧情章节与主线任务](../entries/story-chapters.md)，"
      + "记录同时在剧情页那张「已收录的十章」表里可见（同一份数据）。"));

    /* 增量回填：只改行状态与控件高亮，不重建行 —— 重建会把点击后的焦点
       丢掉，也会让「同一个控件两个调用点显示不一致」。 */
    host.__tkSync = function () {
      var c = TP.storyCounts(list);
      for (var r = 0; r < rows.length; r++) {
        var st = TP.chapterState(rows[r].ch.id);
        rows[r].tr.className = st === "done" ? "tk-met" : "";
        syncStateSeg(rows[r].ctl, st);
      }
      refs["已完成"].textContent = c.done + " / " + c.total;
      refs["进行中"].textContent = String(c.inhand);
      refs["未标记"].textContent = String(Math.max(0, c.total - c.done - c.inhand));
    };
    host.__tkSync();
  }

  /* --------------------------------------------------------------------------
     看板五：进度管理（导出 / 导入 / 分享 / 分轨清空）
     -------------------------------------------------------------------------- */

  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function unb64url(str) {
    var s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 把进度编成一段紧凑二进制，再 base64 进 URL 片段。
     做法刻意保守：**只编码「有值」的条目**（勾过的任务、非零数量），
     所以典型进度只有一两百字节，链接不至于长到被聊天软件截断。
     字典（商人数、物品数）取自清单，顺序稳定；编码里带一个数据指纹，
     版本对不上时导入侧会提示「可能有个别条目对不上」。 */
  function encodeProgress() {
    var mf = window.TARKOV_PROGRESS_MANIFEST || {};
    var md = TP.data();
    var mode = md.mode;
    var md0 = md.modes[mode];
    var qOrder = [], qIndex = {};
    var graph = window.TARKOV_QUEST_GRAPH;
    if (graph) {
      for (var id in graph.tasks) { qIndex[id] = qOrder.length; qOrder.push(id); }
    }
    var items = ((mf.items || {}).list || []).map(function (x) { return x.name; });
    var stations = ((mf.hideout || {}).list || []).map(function (x) { return x.name; });
    var traders = (mf.traders || []).map(function (x) { return x.slug; });

    var b = [];
    function u8(v) { b.push(v & 0xff); }
    function u16(v) { b.push(v & 0xff, (v >> 8) & 0xff); }
    function u32(v) { v = v >>> 0; b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
    function str(s) {
      var enc = unescape(encodeURIComponent(String(s == null ? "" : s)));
      u8(enc.length);
      for (var i = 0; i < enc.length; i++) u8(enc.charCodeAt(i));
    }
    /* ⚠️ 格式版本。v1 → v2 只做了一件事：末尾追加剧情章节段。
       新增段落**只能追加在末尾、且必须升版本号** —— 旧链接（v1）解码时按
       版本号跳过这一段，不会把后面的字节读成剧情数据。 */
    u8(2);                                   // 版本
    u8(["pvp", "pve", "season"].indexOf(mode));
    u8(md0.level || 0);
    u8((md0.faction === "BEAR" ? 1 : md0.faction === "USEC" ? 2 : 0) | ((md0.prestige || 0) << 2));
    str((mf.baseline || "").slice(0, 10));   // 数据指纹（基线日期）

    u8(traders.length);
    traders.forEach(function (t) { u8(parseInt(md0.ll[t], 10) || 0); });

    if (graph) {
      [["q", md0.quests], ["i", md0.inhand]].forEach(function (pair) {
        var keys = Object.keys(pair[1]);
        u16(keys.length);
        keys.forEach(function (k) {
          if (qIndex[k] === undefined) return;
          u8(qIndex[k] & 0xff);
          u8((qIndex[k] >> 8) & 0xff);
        });
      });
      var objs = Object.keys(md0.objectives);
      u16(objs.length);
      objs.forEach(function (k) {
        var parts = k.split("|");
        if (qIndex[parts[0]] === undefined) return;
        u8(qIndex[parts[0]] & 0xff);
        u8((qIndex[parts[0]] >> 8) & 0xff);
        str(parts[1] || "");
      });
    } else {
      u16(0); u16(0); u16(0);
    }

    var iKeys = Object.keys(md0.items);
    u16(iKeys.length);
    // ⚠️ 件数必须是 4 字节：卢布这类需求上百万，用 u16 会被截断
    iKeys.forEach(function (k) { u8(items.indexOf(k) & 0xff); u32(TP.itemCount(k)); });
    var hKeys = Object.keys(md0.hideout);
    u16(hKeys.length);
    hKeys.forEach(function (k) { u8(stations.indexOf(k) & 0xff); u8(TP.hideoutLevel(k)); });
    /* 剧情章节（v2 追加）：按清单顺序每章 1 字节 —— 0 未标记 / 1 进行中 / 2 已完成。
       顺序即字典，所以解码端只需要同一份清单；清单条数变化由解码端比对并提示。 */
    var slList = ((mf.storyline || {}).list) || [];
    u8(Math.min(255, slList.length));
    slList.forEach(function (c) {
      var st = TP.chapterState(c.id);
      u8(st === "done" ? 2 : st === "inhand" ? 1 : 0);
    });
    return b64url(b);
  }

  function decodeProgress(code) {
    try {
      /* ⚠️ 参数**不能**叫 str：下面有个读字符串的内部函数也叫 str，
         函数声明会提升并覆盖同名参数 —— 于是 unb64url 收到的是一个函数，
         atob 直接抛「not correctly encoded」。实测踩到。 */
      var b = unb64url(code), i = 0;
      function u8() { return b[i++]; }
      function u16() { var v = b[i] | (b[i + 1] << 8); i += 2; return v; }
      function u32() { var v = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; i += 4; return v; }
      function rdStr() { var n = u8(), acc = ""; for (var k = 0; k < n; k++) acc += String.fromCharCode(u8()); return decodeURIComponent(escape(acc)); }
      var ver = u8();
      /* v1 = 无剧情章节段；v2 = 末尾追加剧情章节段。**两个版本都要能解** ——
         读者昨天发的链接，今天打开时跑的已经是新代码。 */
      if (ver !== 1 && ver !== 2) return null;
      var mode = ["pvp", "pve", "season"][u8()] || "pvp";
      var level = u8();
      var fp = u8();
      var fingerprint = rdStr();
      var mf = window.TARKOV_PROGRESS_MANIFEST || {};
      var out = {
        v: 6, mode: mode,
        modes: { pvp: { quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {}, storyline: {}, ll: {} },
                 pve: { quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {}, storyline: {}, ll: {} },
                 season: { quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {}, storyline: {}, ll: {} } }
      };
      var m = out.modes[mode];
      m.level = level;
      m.faction = (fp & 3) === 1 ? "BEAR" : (fp & 3) === 2 ? "USEC" : "";
      m.prestige = fp >> 2;
      var traders = (mf.traders || []).map(function (x) { return x.slug; });
      var tn = u8();
      for (var t = 0; t < tn && t < traders.length; t++) {
        var v = u8();
        if (v >= 1 && v <= 4) m.ll[traders[t]] = String(v);
      }
      var graph = window.TARKOV_QUEST_GRAPH;
      var order = [];
      if (graph) for (var id in graph.tasks) order.push(id);
      var nQ = u16(), k;
      for (k = 0; k < nQ; k++) { var qi = u16(); if (order[qi]) m.quests[order[qi]] = ""; }
      var nI = u16();
      for (k = 0; k < nI; k++) { var ii = u16(); if (order[ii]) m.inhand[order[ii]] = ""; }
      var nO = u16();
      for (k = 0; k < nO; k++) { var oi = u16(); var oid = rdStr(); if (order[oi] && oid) m.objectives[order[oi] + "|" + oid] = "1"; }
      var items = ((mf.items || {}).list || []).map(function (x) { return x.name; });
      var nIt = u16();
      for (k = 0; k < nIt; k++) { var iidx = u8(); var cnt = u32(); if (items[iidx] && cnt) m.items[items[iidx]] = String(cnt); }
      var stations = ((mf.hideout || {}).list || []).map(function (x) { return x.name; });
      var nH = u16();
      for (k = 0; k < nH; k++) { var sidx = u8(); var lvv = u8(); if (stations[sidx] && lvv) m.hideout[stations[sidx]] = String(lvv); }
      /* 剧情章节段（仅 v2）：0/1/2 三个状态，按清单顺序对位。
         条数与本站清单不一致时标 stale —— 序号对位在这时候可能已经错位，
         让读者看到「可能有个别条目对不上」的提示，比静默错位强。 */
      var slStale = false;
      if (ver >= 2) {
        var slList = ((mf.storyline || {}).list) || [];
        var nS = u8();
        if (nS !== slList.length) slStale = true;
        for (k = 0; k < nS; k++) {
          var sv = u8();
          var ch = slList[k];
          if (ch && (sv === 1 || sv === 2)) m.storyline[ch.id] = sv === 2 ? "done" : "inhand";
        }
      }
      var now = (mf.baseline || "").slice(0, 10);
      return { data: out, stale: (!!fingerprint && fingerprint !== now) || slStale };
    } catch (e) {
      return { __err: String(e && e.message || e), __at: i };
    }
  }

  /* 把一个节点所在的分页切到前台。
     为什么需要：看着板的读者可能是**从别人分享的链接**进来的，而分享提示
     在「进度管理」分页里 —— 不切过去，他根本不知道有这条提示。 */
  function activateTabOf(node) {
    try {
      var block = node.closest ? node.closest(".tabbed-block") : null;
      if (!block || !block.parentNode) return;
      var blocks = Array.prototype.slice.call(block.parentNode.children);
      var idx = blocks.indexOf(block);
      var set = block.closest(".tabbed-set");
      if (!set || idx < 0) return;
      var labels = set.querySelectorAll(".tabbed-labels label");
      if (labels[idx]) labels[idx].click();
    } catch (e) { /* 主题结构变了就静默放弃，不影响功能 */ }
  }

  function renderOps(host) {
    host.textContent = "";
    var ops = el("div", "tk-board__ops");

    var btnExport = el("button", "tk-board__btn", "导出进度（JSON）");
    btnExport.type = "button";
    btnExport.addEventListener("click", function () {
      download("tarkov-progress-" + today() + ".json", TP.exportText());
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
        var res = TP.importText(String(reader.result || ""));
        toast(host, res.msg, res.ok);
      };
      reader.readAsText(f);
      file.value = "";
    });
    ops.appendChild(file);

    var btnImport = el("button", "tk-board__btn", "导入进度（JSON 文件）");
    btnImport.type = "button";
    btnImport.addEventListener("click", function () { file.click(); });
    ops.appendChild(btnImport);

    var btnShare = el("button", "tk-board__btn", "复制分享链接");
    btnShare.type = "button";
    btnShare.addEventListener("click", function () {
      if (!window.TARKOV_QUEST_GRAPH) {
        toast(host, "任务树还没载入，先回到「任务进度」分页等它载完再试。", false);
        return;
      }
      var code = encodeProgress();
      var url = location.origin + location.pathname + "#p=" + code;
      var done = function (ok2) {
        toast(host, ok2 ? "分享链接已复制（" + url.length + " 字符）。对方打开后可以选择导入。"
                        : "复制失败，请手动复制地址栏里的链接。", ok2);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      } else {
        location.hash = "p=" + code;
        done(false);
      }
      try { history.replaceState(null, "", "#p=" + code); } catch (e) { /* 忽略 */ }
    });
    ops.appendChild(btnShare);

    for (var i = 0; i < TRACKS.length; i++) {
      (function (track) {
        var b = el("button", "tk-board__btn tk-board__btn--warn", "清空" + TRACK_LABEL[track]);
        b.type = "button";
        b.addEventListener("click", function () {
          var msg = "确定清空「" + MODE_LABEL[TP.mode()] + "」模式下的" + TRACK_LABEL[track]
            + "进度吗？\n\n这个动作不可撤销（其他轨、其他模式的进度不受影响）。\n"
            + "建议先点「导出进度」留一份备份。";
          if (window.confirm(msg)) {
            TP.clear(track);
            toast(host, "已清空「" + MODE_LABEL[TP.mode()] + "」的" + TRACK_LABEL[track] + "进度。", true);
          }
        });
        ops.appendChild(b);
      })(TRACKS[i]);
    }

    /* 全清（v1.101.0）—— 上面六个按钮各清**一条轨、且只清当前模式**；
       这一个把三个模式一起清空（连等级与门槛）。放在组末、用 margin-left:auto
       推到右边与其他按钮分开：它不属于同一量级。

       确认框**逐项列出将丢失的数量**（点击时才算）—— 比一句「不可撤销」
       更能让人停下来看一下自己到底要丢掉什么。 */
    var btnAll = el("button", "tk-board__btn tk-board__btn--warn tk-board__btn--all", "清空全部进度");
    btnAll.type = "button";
    btnAll.addEventListener("click", function () {
      var c = allTrackCounts();
      var total = c.quests + c.inhand + c.objectives + c.items + c.hideout + c.storyline;
      if (!total) {
        toast(host, "当前没有任何进度可以清空。", true);
        return;
      }
      var msg = "确定清空全部进度吗？\n\n"
        + "范围：PVP / PVE / 赛季 三个模式的全部记录 ——\n"
        + "任务 " + (c.quests + c.inhand) + " 条（已完成 " + c.quests + " / 进行中 " + c.inhand + "）\n"
        + "任务目标 " + c.objectives + " 条 · 物品 " + c.items + " 种 · "
        + "藏身处 " + c.hideout + " 个 · 剧情章节 " + c.storyline + " 章\n"
        + "以及等级、阵营与门槛（含 Fence 声望）\n\n"
        + "这个动作不可撤销，也没有回收站。建议先点「导出进度」留一份备份。";
      if (!window.confirm(msg)) return;
      TP.clearAll();
      /* 日志同步面板里那条「已并入 +N」在清空之后就是假消息 —— 一并抹掉，
         免得读者以为进度还在。 */
      logOut.textContent = "";
      logCount.textContent = "";
      toast(host, "已清空全部进度（PVP / PVE / 赛季 三个模式）。", true);
    });
    ops.appendChild(btnAll);

    host.appendChild(ops);
    host.appendChild(el("p", "tk-board__note",
      "导出 / 分享都是**纯本地**的：导出是一个 JSON 文件，分享是一条带进度数据的链接 —— "
      + "两者都不经过服务器。导入时**任务取并集、件数与等级取较大值、剧情章节取较强状态**，"
      + "不会覆盖已有的进度。"));

    /* --------------------------------------------------------------------
       从游戏日志同步（v1.100.0）—— 与本板块其余功能的分工：
       导出 / 导入是「把一份进度搬来搬去」，日志同步是**换一个数据来源**
       （游戏自己写的事实）—— 所以它有独立成块的标题与说明，不做成导入的变体。

       两个入口共用一个处理函数：目录（webkitdirectory）与多选文件。
       目录入口是主用法（一次把 Logs 捞全）；文件入口给「只想读某几个会话」
       与不支持目录选择的浏览器兜底。解析代码不在这里 —— 它在惰性模块
       log-sync.js 里，第一次真正选文件时才注入（这一页其余读者不必背它）。 */
    var logBox = el("div", "tk-board__logs");
    logBox.appendChild(el("h4", null, "从游戏日志同步（可选）"));
    logBox.appendChild(el("p", "tk-board__lognote",
      "读你本机的塔科夫日志，把已经发生的「接取 / 完成」一次性补进账本 —— "
      + "在**本页内存**里解析：不上传、不保存、不联网。藏身处、等级、目标级勾选与物品数量"
      + "日志里没有，仍需手勾。日志位置：Steam 版 `…\\Escape from Tarkov\\build\\Logs`，独立版 `…\\EFT\\Logs`。"));

    var logBar = el("div", "tk-board__logbar");
    var logDirBtn = el("button", "tk-board__btn", "选择 Logs 文件夹");
    logDirBtn.type = "button";
    var logFileBtn = el("button", "tk-board__btn", "或选日志文件");
    logFileBtn.type = "button";
    var logCount = el("span", "tk-board__filtercount");
    logBar.appendChild(logDirBtn);
    logBar.appendChild(logFileBtn);
    logBar.appendChild(logCount);
    logBox.appendChild(logBar);

    var dirInput = document.createElement("input");
    dirInput.type = "file";
    dirInput.multiple = true;
    dirInput.setAttribute("webkitdirectory", "");
    dirInput.setAttribute("data-logdir", "");      /* 与「导入进度」的 input 区分（端到端测试也用这个选择器） */
    dirInput.hidden = true;
    var pickInput = document.createElement("input");
    pickInput.type = "file";
    pickInput.multiple = true;
    pickInput.setAttribute("data-logpick", "");
    pickInput.hidden = true;
    logBox.appendChild(dirInput);
    logBox.appendChild(pickInput);

    var logOut = el("div", "tk-board__logout");
    logBox.appendChild(logOut);

    function onLogFiles(list) {
      var files = Array.prototype.slice.call(list || []);
      if (!files.length) return;
      logCount.textContent = "已选 " + files.length + " 个文件";
      UI.loadScript("log-sync.js", ["TarkovLogSync"], function (ok) {
        if (!ok || !window.TarkovLogSync) {
          toast(host, "解析模块没有载入成功（可能是网络中断）—— 刷新一次再试。", false);
          return;
        }
        window.TarkovLogSync.run(files, logOut);
      });
    }
    dirInput.addEventListener("change", function () { onLogFiles(dirInput.files); dirInput.value = ""; });
    pickInput.addEventListener("change", function () { onLogFiles(pickInput.files); pickInput.value = ""; });
    logDirBtn.addEventListener("click", function () { dirInput.click(); });
    logFileBtn.addEventListener("click", function () { pickInput.click(); });

    host.appendChild(logBox);

    /* 别人分享的链接：问一句再导入，绝不自动改读者的数据 */
    var m = (location.hash || "").match(/#p=([A-Za-z0-9_-]+)/);
    if (m) {
      var dec = decodeProgress(m[1]);
      if (!dec || dec.__err) {
        host.appendChild(el("p", "tk-board__note", "链接里的进度数据读不出来（可能被截断了）。"));
      } else {
        var box = el("div", "tk-board__share");
        box.appendChild(el("b", null, "检测到一条分享的进度"));
        box.appendChild(el("p", null,
          (dec.stale ? "⚠️ 这条链接的数据版本与本站当前不同，可能有个别条目对不上。\n" : "")
          + "导入会把两个进度合并（任务取并集、件数与等级取较大值、剧情章节取较强状态），不会覆盖你自己的记录。"));
        var ok3 = el("button", "tk-board__btn", "合并进来");
        ok3.type = "button";
        ok3.addEventListener("click", function () {
          var res = TP.importText(JSON.stringify(dec.data));
          box.textContent = res.msg;
          box.className = "tk-board__toast";
        });
        box.appendChild(ok3);
        host.appendChild(box);
        /* 把读者带到这条提示面前 —— 否则它藏在隐藏的分页里，等于没有提示 */
        activateTabOf(box);
      }
    }
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  /* --------------------------------------------------------------------------
     看板：任务依赖树（上游链 / 下游收益）

     为什么不做成「一张静态的树」：站内已有两样别人没有的东西 —— **本机的进度状态**
     与**算好的解锁收益**。所以这棵树不是用来「看全貌」的，是**从你当前进度出发的两个方向**：

       · 上游链 —— 「做它之前，我必须先完成什么」→ 直接回答「卡在哪个前置」
       · 下游收益 —— 「做完它，放开哪些」→ 按直接解锁数降序

     三条边界：

       · **纯 DOM 折叠树，不引任何库**（站内约定无配图、不引重型库）；
       · **前置只算「完成」边**，与「优先级速查」和任务看板的「可接」判定同口径
         （全图 238 条边里 224 条带 `complete`）；
       · **搜索只按中文名** —— 图数据（quests-graph.js）里没有英文名，
         英文名搜在任务图鉴页的筛选器里有。**这一点写在界面上，不让读者以为搜不到就是没有。**
     -------------------------------------------------------------------------- */

  var TREE_MAX = 300;   /* 单棵树最多渲染多少节点 —— 汇合点的上游可以很长，别把页面拉爆 */

  function renderQuestTree(host) {
    host.textContent = "";
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var td = (mf && mf.traders) || [];
    var tname = {};
    for (var i = 0; i < td.length; i++) tname[td[i].slug] = td[i].name;

    host.appendChild(el("p", "tk-board__loading", "正在载入任务树…"));
    ensureGraph(function (graph) {
      host.textContent = "";
      if (!graph) { host.appendChild(notReady("任务树")); return; }
      buildQuestTree(host, graph, tname);
    });
  }

  function buildQuestTree(host, graph, tname) {
    var tasks = graph.tasks;
    var qidByName = {};
    for (var q in tasks) if (tasks[q][N_NAME]) qidByName[tasks[q][N_NAME]] = q;

    /* 反查表：前置 → 需要它的任务。**只算「完成」边**（与可接判定、解锁收益同口径）。 */
    var succ = {};
    for (var a in tasks) {
      var pre = tasks[a][N_PRE] || [];
      for (var p = 0; p < pre.length; p++) {
        var pid = pre[p][0], mark = String(pre[p][1] || "");
        if (mark.indexOf("c") < 0) continue;
        if (!succ[pid]) succ[pid] = [];
        succ[pid].push(a);
      }
    }

    function label(qid) {
      var n = tasks[qid];
      return n ? n[N_NAME] : qid;
    }
    function who(qid) {
      var n = tasks[qid];
      return n ? (tname[n[N_TRADER]] || n[N_TRADER]) : "—";
    }

    /* 上游：按深度 DFS。同一节点只保留**最短**的那条路径（否则汇合点会重复出现到爆）。 */
    function ancestors(root) {
      var best = {}, stack = [[root, 0]], guard = 0;
      while (stack.length && guard++ < 20000) {
        var cur = stack.pop(), id = cur[0], d = cur[1];
        var ps = tasks[id] ? (tasks[id][N_PRE] || []) : [];
        for (var i = 0; i < ps.length; i++) {
          if (String(ps[i][1] || "").indexOf("c") < 0) continue;
          var pid = ps[i][0];
          if (best[pid] === undefined || best[pid] > d + 1) {
            best[pid] = d + 1;
            stack.push([pid, d + 1]);
          }
        }
      }
      var out = [];
      for (var k in best) out.push({ qid: k, depth: best[k], direct: !!~indexOfPre(root, k) });
      out.sort(function (x, y) { return (y.depth - x.depth) || label(x.qid).localeCompare(label(y.qid), "zh"); });
      return out;
    }
    function indexOfPre(root, pid) {
      var ps = (tasks[root] && tasks[root][N_PRE]) || [];
      for (var i = 0; i < ps.length; i++) if (ps[i][0] === pid) return 1;
      return 0;
    }

    /* 下游：BFS，带深度；按「直接解锁数 → 深度 → 名称」排 */
    function descendants(root) {
      var best = {}, queue = [[root, 0]], guard = 0;
      while (queue.length && guard++ < 20000) {
        var cur = queue.shift(), id = cur[0], d = cur[1];
        var nx = succ[id] || [];
        for (var i = 0; i < nx.length; i++) {
          if (best[nx[i]] === undefined || best[nx[i]] > d + 1) {
            best[nx[i]] = d + 1;
            queue.push([nx[i], d + 1]);
          }
        }
      }
      var out = [];
      for (var k in best) out.push({ qid: k, depth: best[k], fanout: (succ[k] || []).length });
      out.sort(function (x, y) {
        if (y.depth !== x.depth) return x.depth - y.depth;      /* 先近的 */
        if (y.fanout !== x.fanout) return y.fanout - x.fanout;  /* 再看它自己放开几个 */
        return label(x.qid).localeCompare(label(y.qid), "zh");
      });
      return out;
    }

    /* —— 界面骨架 —— */
    var root = el("div", "tk-tree");
    host.appendChild(root);

    var bar = el("div", "tk-tree__bar");
    var qi = document.createElement("input");
    qi.type = "search";
    qi.className = "tk-tree__q";
    qi.placeholder = "搜任务名（中文）…";
    qi.setAttribute("aria-label", "在依赖树里搜任务");
    bar.appendChild(qi);
    var hint = el("span", "tk-tree__hint", "只按中文名搜（图数据里没有英文名）");
    bar.appendChild(hint);
    root.appendChild(bar);

    var picks = el("div", "tk-tree__picks");
    root.appendChild(picks);

    var head = el("div", "tk-tree__head");
    root.appendChild(head);
    var cols = el("div", "tk-tree__cols");
    root.appendChild(cols);

    var sel = null;         /* 当前选中的任务 id */
    var liveNodes = [];     /* 树里已渲染的节点（qid + 状态点 + 状态芯片），供增量刷新 */

    function chip(text, onClick, cls) {
      var b = el("button", "tk-tree__chip" + (cls ? " " + cls : ""), text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    }

    function renderPicks() {
      picks.textContent = "";
      var inIds = [];
      for (var q in tasks) if (TP.taskState(q) === "inhand") inIds.push(q);
      inIds.sort(function (x, y) { return label(x).localeCompare(label(y), "zh"); });
      if (inIds.length) {
        picks.appendChild(el("span", "tk-tree__pickhead", "从我在做的任务出发："));
        for (var i = 0; i < inIds.length && i < 12; i++) {
          (function (id) {
            picks.appendChild(chip(label(id), function () { pick(id); }, "tk-tree__chip--in"));
          })(inIds[i]);
        }
        if (inIds.length > 12) picks.appendChild(el("span", "tk-tree__hint", "等 " + inIds.length + " 个"));
      }
      /* 两条长线的终点 —— 这两个任务最值得「倒着看」 */
      [["收藏家", "Kappa 线终点"], ["守望者箴言", "前置最多的汇合点"]].forEach(function (p) {
        var id = qidByName[p[0]];
        if (id) picks.appendChild(chip(p[1] + "：" + p[0], function () { pick(id); }, "tk-tree__chip--goal"));
      });
    }

    function search() {
      var kw = qi.value.trim();
      if (!kw) { renderPicks(); return; }
      picks.textContent = "";
      var hits = [];
      for (var q in tasks) if (label(q).indexOf(kw) >= 0) hits.push(q);
      hits.sort(function (x, y) {
        return label(x).length - label(y).length || label(x).localeCompare(label(y), "zh");
      });
      if (!hits.length) { picks.appendChild(el("span", "tk-tree__hint", "没有匹配的任务名。")); return; }
      picks.appendChild(el("span", "tk-tree__pickhead", "匹配 " + hits.length + " 个："));
      for (var i = 0; i < hits.length && i < 12; i++) {
        (function (id) { picks.appendChild(chip(label(id), function () { pick(id); })); })(hits[i]);
      }
    }

    function nodeRow(rec, kind) {
      var row = el("div", "tk-tree__node tk-tree__node--d" + Math.min(rec.depth, 6));
      var st0 = TP.taskState(rec.qid);
      var dot = el("span", "tk-tree__dot tk-tree__dot--" + (st0 || "none"));
      row.appendChild(dot);
      var link = questUrl(tasks[rec.qid] ? tasks[rec.qid][N_LINK] : "");
      var nm = el(link ? "a" : "span", "tk-tree__name", label(rec.qid));
      if (link) nm.href = link;
      row.appendChild(nm);
      var meta = who(rec.qid) + " · Lv" + ((tasks[rec.qid] && tasks[rec.qid][N_LEVEL]) || 0);
      meta = kind === "up" ? ("第 " + rec.depth + " 层前置 · " + meta)
                           : ("第 " + rec.depth + " 步 · 它自己放开 " + rec.fanout + " 个 · " + meta);
      row.appendChild(el("span", "tk-tree__meta", meta));
      var sb = miniState(rec.qid, tasks[rec.qid] ? tasks[rec.qid][N_TRADER] : "");
      row.appendChild(sb.el);
      liveNodes.push({ qid: rec.qid, dot: dot, btn: sb });
      return row;
    }

    /* 节点上的状态芯片：**点一下循环切换**，不用展开下拉（高频控件不藏）。 */
    function miniState(qid, trader) {
      var b = el("button", "tk-tree__state");
      b.type = "button";
      b.setAttribute("data-focus-key", "tree-state:" + qid);
      function paint() {
        var s = TP.taskState(qid);
        b.textContent = s === "done" ? "已完成" : s === "inhand" ? "进行中" : "未标记";
        b.className = "tk-tree__state tk-tree__state--" + (s || "none");
      }
      b.title = "点一下切换：未标记 → 进行中 → 已完成";
      b.addEventListener("click", function () {
        var s = TP.taskState(qid);
        TP.setTaskState(qid, s === "" ? "inhand" : s === "inhand" ? "done" : "", trader);
      });
      paint();
      return { el: b, paint: paint };
    }

    function pick(id) {
      sel = id;
      liveNodes = [];
      head.textContent = "";
      cols.textContent = "";

      var up = ancestors(id);
      var dn = descendants(id);
      var upMiss = 0;
      for (var i = 0; i < up.length; i++) if (TP.taskState(up[i].qid) !== "done") upMiss++;

      var h = el("div", "tk-tree__title");
      h.appendChild(el("b", null, label(id)));
      h.appendChild(el("em", null, who(id) + " · Lv" + (tasks[id][N_LEVEL] || 0)
        + " ｜ 上游 " + up.length + " 个前置（未完成 " + upMiss + "）｜ 下游放开 " + dn.length + " 个"));
      head.appendChild(h);
      if (!up.length && !dn.length) {
        cols.appendChild(el("p", "tk-board__note", "这个任务既没有前置，也不阻塞任何任务。"));
      }

      /* 上游：按深度倒序 = 从最远的前置读到眼前，最后一行才是它自己 */
      if (up.length) {
        var c1 = el("div", "tk-tree__col");
        c1.appendChild(el("div", "tk-tree__colhead", "上游链 · 做它之前必须完成什么"));
        var shown = up.length > TREE_MAX ? up.slice(0, TREE_MAX) : up;
        for (var u = 0; u < shown.length; u++) c1.appendChild(nodeRow(shown[u], "up"));
        if (up.length > TREE_MAX) c1.appendChild(el("p", "tk-board__note", "只显示了 " + TREE_MAX + " 个，其余见该任务的商人页。"));
        cols.appendChild(c1);
      }

      /* 下游：从它自己开始，逐层展开 */
      if (dn.length) {
        var c2 = el("div", "tk-tree__col");
        c2.appendChild(el("div", "tk-tree__colhead", "下游收益 · 做完它放开哪些（近的在前）"));
        var shown2 = dn.length > TREE_MAX ? dn.slice(0, TREE_MAX) : dn;
        for (var d2 = 0; d2 < shown2.length; d2++) c2.appendChild(nodeRow(shown2[d2], "down"));
        if (dn.length > TREE_MAX) c2.appendChild(el("p", "tk-board__note", "只显示了前 " + TREE_MAX + " 个。"));
        cols.appendChild(c2);
      }
    }

    qi.addEventListener("input", search);
    renderPicks();

    /* 增量刷新：**只重画状态点与状态芯片**，不重建整棵树 ——
       重建会让读者正在看的节点跳走（而每次改状态都会触发 sync）。
       代价是这句必须把「所有会影响显示的东西」都覆盖到：现在只有状态。 */
    host.__tkSync = function () {
      for (var i = 0; i < liveNodes.length; i++) {
        var n = liveNodes[i];
        n.dot.className = "tk-tree__dot tk-tree__dot--" + (TP.taskState(n.qid) || "none");
        n.btn.paint();
      }
      if (sel) {
        var bit = head.querySelector(".tk-tree__title em");
        if (bit) {
          var up = ancestors(sel), dn = descendants(sel), miss = 0;
          for (var j = 0; j < up.length; j++) if (TP.taskState(up[j].qid) !== "done") miss++;
          bit.textContent = who(sel) + " · Lv" + (tasks[sel][N_LEVEL] || 0)
            + " ｜ 上游 " + up.length + " 个前置（未完成 " + miss + "）｜ 下游放开 " + dn.length + " 个";
        }
      }
    };
  }

  function render(mounts) {
    for (var i = 0; i < mounts.length; i++) {
      var h = mounts[i];
      var id = h.id;
      h.textContent = "";
      if (id === "tk-board-overview") renderOverview(h);
      else if (id === "tk-progress-board") renderQuestBoard(h);
      else if (id === "tk-board-items") renderItemBoard(h);
      else if (id === "tk-board-tree") renderQuestTree(h);
      else if (id === "tk-board-hideout") renderHideoutBoard(h);
      else if (id === "tk-board-story") renderStoryBoard(h);
      else if (id === "tk-board-ops") renderOps(h);
    }
  }

  function sync() {
    var ids = ["tk-board-overview", "tk-progress-board", "tk-board-tree", "tk-board-items", "tk-board-hideout", "tk-board-story", "tk-board-ops"];
    for (var i = 0; i < ids.length; i++) {
      var h = document.getElementById(ids[i]);
      if (h && h.__tkSync) h.__tkSync();
    }
  }

  /* 编解码同时挂出来，供端到端测试直接做往返验证 ——
     否则测试只能靠「点按钮 + 刷新 + 看界面」间接推断，定位不到出错的那一步。
     ensureGraph 一并导出：log-sync.js 也要用它（判定 515 口径、取商人），
     而它自带「多个等待者」的合并逻辑 —— 各写一份必然在加载时序上踩坑。 */
  window.TarkovProgressBoards = {
    render: render, sync: sync, ensureGraph: ensureGraph,
    _encode: encodeProgress, _decode: decodeProgress
  };
})();
