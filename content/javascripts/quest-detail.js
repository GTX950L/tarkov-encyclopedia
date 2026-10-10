/* ==========================================================================
   单个任务详情视图页（content/quests/quest.md）
   --------------------------------------------------------------------------
   定位：**一个视图页承载 515 个任务的详情**，不是 515 个 HTML。

   为什么不做成每件一个页面
   ------------------------
   站点每页平均约 146 KB，其中绝大部分是站点框架（侧栏 nav + 主题）——
   515 页既拖慢构建也难维护，而每页真正的内容只有 1 KB 上下。
   所以这一页按地址里的 ``?id=<任务id>`` 渲染：链接可分享、可收藏、可刷新恢复。

   数据从哪来
   ----------
   ``quest-detail-<NN>.js`` 共 32 片（由 scripts/gen_quests.py 生成），
   按**任务 id 的十六进制数字之和 % 32** 定位。

   ⚠️ 片数 32 与分片算法在**生成器与本文件各写一遍**，改一处必须改另一处。
      不一致的表现是：拉错片 → 查不到该 id → 静默显示「找不到这个任务」。
      算法用「数字和取模」而不是 id 首字符：物品侧实测首字符只有 5/6 两种，
      按它切只得到 2 片。

   ⚠️ 本页**不加载**进度看板与任务树的数据（progress-manifest / quests-graph）——
      分片是自包含的。这是「弱网可读」的关键：单次只下约 15 KB。
   ========================================================================== */

(function () {
  "use strict";

  var SHARDS = 32;         /* ⚠️ 必须等于 scripts/gen_quests.py 的 QUEST_DETAIL_SHARDS */
  var cache = {};          /* 片名 → 数据 */
  var currentId = "";      /* 当前渲染的任务 id —— 同页跳转要靠它判「是不是自己」 */

function siteRoot() {
    /* 优先用 toolbox.js 在首次整页加载时算好并公布的站点根，不要每次现算。
       Material 的 instant navigation 换页时会重建 <script> 元素，重建后的
       .src 按【换页前】的地址解析，得出 <根>/quests/javascripts/toolbox.js
       这种错路径 —— 于是所有「换页之后才算 siteRoot()」的代码都拼出 404 地址。

       实测（2026-10-10）：从任务图鉴总览点「台词」入口进任务详情页，注入的脚本
       请求到了 /quests/javascripts/quest-detail.js（404），页面永远停在静态
       占位文案上，而控制台一个错都不报。

       fallback 保留原写法，供 toolbox.js 自己首次计算时使用。 */
    if (window.__tkRoot) return window.__tkRoot;
    var s = document.querySelector('script[src*="toolbox.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function shardKey(id) {
    var s = 0;
    for (var i = 0; i < id.length; i++) {
      var v = parseInt(id.charAt(i), 16);
      if (!isNaN(v)) s += v;
    }
    return s % SHARDS;
  }

  function shardFile(id) {
    var k = shardKey(id);
    return "quest-detail-" + (k < 10 ? "0" + k : String(k)) + ".js";
  }

  function param(name) {
    try { return new URLSearchParams(location.search || "").get(name); }
    catch (e) { return null; }
  }

  function questUrl(id) {
    return siteRoot() + "quests/quest/?id=" + encodeURIComponent(id);
  }

  /* 物品详情页（单件视图）—— 任务页里「这东西哪来的」的落点 */
  function itemUrl(id) {
    return siteRoot() + "catalog/item/?id=" + encodeURIComponent(id);
  }

  /* ---------------------------------------------------------------- DOM */

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function h(level, txt) { return el("h" + level, null, txt); }

  /* 内联记号解析 —— 只认两种，不引 markdown 库：
       · `**粗体**`    —— 生成器复用 render_objective / render_rewards 的输出；
       · `[[名字|id]]` —— **物品名 → 图鉴链接**，由生成器的 linkify_items() 写下
                          （重名与未收录的名字不带这个标记，退成普通粗体）。

     ⚠️ 一次扫描处理两种标记，不要先 split("**") 再找 [[…]] ——
        两种标记可能相邻，分两步会把中间的普通文本切碎。 */
  function rich(text) {
    var frag = document.createDocumentFragment();
    var s = String(text == null ? "" : text);
    var re = /\[\[([^\]|]+)\|([^\]]+)\]\]|\*\*([^*]+)\*\*/g;
    var last = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      }
      if (m[1] != null) {
        var a = el("a", null, m[1]);
        a.href = itemUrl(m[2]);
        frag.appendChild(a);
      } else {
        frag.appendChild(el("strong", null, m[3]));
      }
      last = re.lastIndex;
    }
    if (last < s.length) {
      frag.appendChild(document.createTextNode(s.slice(last)));
    }
    return frag;
  }

  function p(text) { var e = el("p"); e.appendChild(rich(text)); return e; }

  function ul(items, render) {
    var list = document.createElement("ul");
    items.forEach(function (x) {
      var li = document.createElement("li");
      if (render) render(li, x); else li.appendChild(rich(x));
      list.appendChild(li);
    });
    return list;
  }

  /* 一行「任务名 → 详情页」；同名任务没有 id（生成器已判重名），退成纯文本 */
  function questLink(li, pair) {
    var name = pair[0], id = pair[1];
    if (id) {
      var a = el("a", null, name);
      a.href = questUrl(id);
      li.appendChild(a);
    } else {
      li.appendChild(document.createTextNode(name));
    }
  }

  /* ⚠️ 「出发前必带」的三类划分与行文本 **在生成器的 carry_lines() 里**，
     不在前端 —— v1.96.0 就是在前端另写一遍、把 pack 的**对象**当字符串渲染，
     结果整块变成 `[object Object]`（bring 96 / pack 87 个任务受影响）。
     md 商人页与这一页现在共用同一个函数，前端只负责排版。 */

  /* --------------------------------------------------------------- 数据 */

  function loadShard(id, cb) {
    var f = shardFile(id);
    if (cache[f]) { cb(cache[f]); return; }
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/" + f;
    s.onload = function () {
      /* 分片脚本执行时挂到 window.TARKOV_QUEST_DETAIL_ONE —— 必须**在 onload 里
         立刻取走**，否则下一片加载会把它覆盖掉。 */
      cache[f] = window.TARKOV_QUEST_DETAIL_ONE || {};
      cb(cache[f]);
    };
    s.onerror = function () { cb(null); };
    document.head.appendChild(s);
  }

  /* 台词段落：原文里用空行分段，渲染成多个 <p>（一整块挤成一段会读不动）。 */
  function sayBlock(host, text) {
    if (!text) return;
    String(text).split(/\n\s*\n/).forEach(function (seg) {
      var t = seg.trim();
      if (t) host.appendChild(p(t));
    });
  }

  /* --------------------------------------------------------------- 渲染 */

  function renderMissing(host, id) {
    host.textContent = "";
    var a = el("p");
    a.appendChild(document.createTextNode("找不到 ID 为 "));
    a.appendChild(el("code", null, id || "（空）"));
    a.appendChild(document.createTextNode(
      " 的任务。可能是 ID 抄错了，也可能这个任务在当前版本已被移除。"));
    host.appendChild(a);
    var b = el("p");
    b.appendChild(document.createTextNode("去"));
    var lk = el("a", null, "任务图鉴总览");
    lk.href = siteRoot() + "quests/";
    b.appendChild(lk);
    b.appendChild(document.createTextNode("按商人或等级找，或用"));
    var lk2 = el("a", null, "我的进度");
    lk2.href = siteRoot() + "quests/progress/";
    b.appendChild(lk2);
    b.appendChild(document.createTextNode("看手上正在做的。"));
    host.appendChild(b);
  }

  function renderEmpty(host) {
    host.textContent = "";
    host.appendChild(p("这一页要用任务 ID 打开。两条路："));
    var ul = document.createElement("ul");

    /* ⚠️ 别再写「从任务图鉴里点任意一个任务即可直达」—— 那是**假话**：
       任务图鉴里的任务名只跳页内锚点，真正指向本页的是下面这两处小入口。
       文案必须指到真实存在的东西上，否则读者照做一次失败就再也不试了。 */
    var li1 = document.createElement("li");
    li1.appendChild(document.createTextNode("在"));
    var lk1 = el("a", null, "任务图鉴总览");
    lk1.href = siteRoot() + "quests/";
    li1.appendChild(lk1);
    li1.appendChild(document.createTextNode("的筛选表里，点任务名后面的 "));
    li1.appendChild(el("strong", null, "💬"));
    ul.appendChild(li1);

    var li2 = document.createElement("li");
    li2.appendChild(document.createTextNode("在任意商人页的任务明细块里，点 "));
    li2.appendChild(el("strong", null, "「💬 台词与完整明细 →」"));
    ul.appendChild(li2);
    host.appendChild(ul);

    var b = el("p");
    b.appendChild(document.createTextNode("地址形如 "));
    b.appendChild(el("code", null, "quests/quest/?id=<任务ID>"));
    b.appendChild(document.createTextNode("，复制给别人也能直接打开。"));
    host.appendChild(b);
  }

  function renderDetail(host, id, it) {
    host.textContent = "";
    currentId = id;

    /* ---- 标题与标识 ---- */
    host.appendChild(h(3, it.n));
    var ident = el("p");
    if (it.e) {
      ident.appendChild(document.createTextNode("英文名 "));
      ident.appendChild(el("code", null, it.e));
      ident.appendChild(document.createTextNode("　｜　"));
    }
    ident.appendChild(document.createTextNode("任务 ID "));
    ident.appendChild(el("code", null, id));
    host.appendChild(ident);

    /* ---- 概览：商人 / 等级 / 地图 / 主线标记 ---- */
    var tags = [it.t + " 发布", "需 Lv" + it.lv];
    if (it.m) tags.push("地图：" + it.m);
    if (it.f) tags.push("仅 " + it.f);
    if (it.pr) tags.push("需转生 ×" + it.pr);
    if (it.k) tags.push("Kappa 线");
    if (it.lk) tags.push("Lightkeeper 线");
    if (it.rs) tags.push("可重接");
    if (it.d) tags.push("接取后延迟 " + it.d + " 秒");
    var tagLine = el("p");
    tags.forEach(function (t, i) {
      if (i) tagLine.appendChild(document.createTextNode("　·　"));
      tagLine.appendChild(el("strong", null, t));
    });
    host.appendChild(tagLine);

    /* ---- 商人台词（接取时）----
       ⚠️ 放在「接取门槛」**之前** —— 这是商人开口说的第一段话，读一个任务
          本来就该先看到它。数据来自三级来源，见生成器的 DIALOGUE 说明。 */
    var say = it.say || [];
    if (say[0]) {
      host.appendChild(h(4, "💬 商人说（接取时）"));
      sayBlock(host, say[0]);
    }

    /* ---- 接取门槛 ---- */
    var g = it.gates || [];
    var needGate = g.length || (it.pre || []).length || (it.oth || []).length;
    if (needGate) {
      host.appendChild(h(4, "🎯 接取门槛"));
      if ((it.pre || []).length) {
        host.appendChild(p("**前置任务**（做完才能接）"));
        host.appendChild(ul(it.pre, questLink));
      }
      if (g.length) {
        var segs = g.map(function (x) {
          var label = x[1] === "level" ? "忠诚 LL" + x[3] : "声望 " + (x[2] || "") + " " + x[3];
          return x[0] + " " + label;
        });
        host.appendChild(p("**商人门槛**：" + segs.join(" ｜ ")));
      }
      if ((it.oth || []).length) {
        host.appendChild(p("**其他条件**"));
        host.appendChild(ul(it.oth));
      }
    }

    /* ---- 任务目标 ---- */
    host.appendChild(h(4, "📋 任务目标"));
    if ((it.o || []).length) host.appendChild(ul(it.o));
    else host.appendChild(p("这个任务在数据端点里没有逐条登记目标。"));

    /* ---- 完成奖励 ---- */
    if ((it.rw || []).length) {
      host.appendChild(h(4, "🎁 完成奖励"));
      var list = document.createElement("ul");
      it.rw.forEach(function (line) {
        var m = String(line).match(/^(\s*)- (.*)$/);
        if (!m) return;
        var li = document.createElement("li");
        /* 生成器用「两个空格缩进」表示子项（声望 / 技能 / 解锁） */
        if (m[1].length >= 2) li.className = "tk-quest-sub";
        li.appendChild(rich(m[2]));
        list.appendChild(li);
      });
      host.appendChild(list);
    }

    /* ---- 出发前必带 ---- */
    /* 行文本由生成器的 carry_lines() 生成，**与商人页同一份**（物品 / 钥匙 / 局内获取
       三类划分也在那边定），这里只排版 —— 两处各写一遍就会漂。 */
    var carry = it.carry || [];
    if (carry.length) {
      host.appendChild(h(4, "📦 出发前必带"));
      host.appendChild(p("**物品**要从仓库带进图、**钥匙**别忘了、"
        + "**局内获取**是本任务里先找到再用同一件 —— 漏带等于白跑。"));
      host.appendChild(ul(carry));
    }

    /* ---- 失败条件 ---- */
    if ((it.fail || []).length) {
      host.appendChild(h(4, "⚠️ 失败条件"));
      host.appendChild(p("动手前先读清 —— 踩中就得重来。"));
      host.appendChild(ul(it.fail));
    }

    /* ---- 后续任务 ---- */
    if ((it.nxt || []).length) {
      host.appendChild(h(4, "🔗 做完放开什么"));
      host.appendChild(p("以下任务把本任务列为前置："));
      host.appendChild(ul(it.nxt, questLink));
    }

    /* ---- 归属 ---- */
    var back = el("p");
    back.appendChild(document.createTextNode("所属商人页："));
    var bl = el("a", null, it.t);
    bl.href = siteRoot() + "quests/" + traderSlug(it.t) + "/";
    back.appendChild(bl);
    host.appendChild(back);

    /* ---- 交任务 / 失败时的台词：放在最后 ----
       顺序照事件发生的先后：接取（开头）→ 目标与奖励 → 交差（这里）。
       读者顺着读下来，正好是「接活 → 干活 → 回话」。 */
    if (say[1]) {
      host.appendChild(h(4, "💬 任务完成对话"));
      sayBlock(host, say[1]);
    }
    if (say[2]) {
      host.appendChild(h(4, "💬 任务失败对话"));
      sayBlock(host, say[2]);
    }

    bindSamePage(host);
  }

  /* ⚠️ **必须自己接管本页内的任务链**。
     从 ?id=A 点到 ?id=B 是**同一个路径**，Material 的 instant navigation 按路径
     判页面、既不重放脚本也不做任何事 —— 不接管的话点了**毫无反应**（2026-10-10
     线上实测：点「货运延误 - 1」，标题与 URL 都不动）。

     ⚠️ **接管后用 `location.replace`，不是 assign、更不是 pushState**。
     三种都线上实测过，结论如下：
       · `pushState` + 自己重渲染 → 与 Material 的历史栈打架，后退时它把内容清掉；
       · `location.assign`（新增历史条目）→ **后退失效**：Material 的 instant
         navigation 自己反复 push/replace（实测 history.length 2 → 4、导航事件 9 次），
         它维护的历史层里没有「上一个任务」，`history.back()` 返回的内容原地不动；
       · `location.replace`（**不新增历史条目**）→ 后退**回到进入详情页之前的页面**
         （通常是商人页）。这是三者里唯一行为一致、可预期的。

     所以本页的语义是「在详情页里连续查看任务，不算独立的浏览历史」——
     想要「返回上一个任务」，用浏览器后退回到商人页再点即可。

     只接管指向本详情页的链接：`quests/quest/` 匹配时**不带前导斜杠** ——
     线上是绝对 URL、本地验证页是相对 URL，两种都要覆盖。 */
  function bindSamePage(host) {
    var as = host.querySelectorAll("a");
    Array.prototype.forEach.call(as, function (a) {
      var href = a.getAttribute("href") || "";
      if (href.indexOf("quests/quest/") === -1) return;
      a.addEventListener("click", function (e) {
        var nid = "";
        try { nid = new URL(a.href, location.href).searchParams.get("id") || ""; }
        catch (err) { return; }
        if (!nid || nid === currentId) return;   /* 自己跳自己：交回浏览器 */
        e.preventDefault();
        location.replace(a.href);
      });
    });
  }

  /* 商人显示名 → nav 里的 slug。**只覆盖 nav 里真实存在的 11 个**，
     对不上就返回空串（调用处会退成纯文本），不猜。 */
  var TRADER_SLUG = {
    "Mechanic": "mechanic", "Prapor": "prapor", "Skier": "skier",
    "Jaeger": "jaeger", "Ragman": "ragman", "Therapist": "therapist",
    "Peacekeeper": "peacekeeper", "Fence": "fence",
    "Ref（竞技场裁判）": "ref", "BTR 司机": "btr-driver", "Lightkeeper": "lightkeeper"
  };

  function traderSlug(label) { return TRADER_SLUG[label] || ""; }

  /* --------------------------------------------------------------- 挂载 */

  function boot() {
    var host = document.getElementById("tk-quest-page");
    if (!host) return;
    var id = (param("id") || "").trim();
    if (!id) { renderEmpty(host); return; }
    host.textContent = "";
    host.appendChild(el("p", null, "正在载入任务数据…"));
    loadShard(id, function (data) {
      var it = data ? data[id] : null;
      if (it) renderDetail(host, id, it);
      else renderMissing(host, id);
    });
  }

  /* ⚠️ 把入口挂到 window，供 toolbox.js 在**每次换页后**回调。
     这是本页能被「从别的页面点进来」的关键 —— 本脚本是异步注入的，
     它自己的 boot() 有可能跑在某次内容换入的间隙里（那时挂载点还不在 DOM 中），
     而 document$ 的通知不会为「脚本刚加载完」再补一次。
     详见 toolbox.js 的 remount()。 */
  window.__tkQuestBoot = boot;

  /* ⚠️ instant 换页会重放脚本，所以每次 boot 都要**重新读一次地址参数** ——
     从一个任务跳到另一个任务时 URL 变了，不能沿用上一次解析的结果。
     本页内的任务链走的是**整页导航**（见 bindSamePage），不经过这里。 */
  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(boot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
