/* ============================================================================
   ⚠️ 本文件由 scripts/gen_bundle.py 合并生成，**请勿手动编辑**。
      要改逻辑请改对应的源文件，然后重跑：python scripts/gen_bundle.py
      源文件顺序见脚本里的 ORDER；改完记得一并提交 bundle.js。
   ============================================================================ */

/* ── 站点根广播（必需）───────────────────────────────────────────────────────
   全站 12 个脚本的 siteRoot() 都先读 window.__tkRoot，而唯一赋值处是
   toolbox.js:98 —— 它自己也要靠 `script[src*="toolbox.js"]` 现算。
   合并后页面里没有 toolbox.js 这个 <script>，那条 fallback 会返回 ""，
   于是所有站内绝对链接静默变成相对路径。这里在 bundle 执行时刻先广播一次：
   此刻 document.currentScript 就是 bundle.js 本身，地址一定解析正确。
   正则与 toolbox.js:91 逐字一致（去文件名、保留尾斜杠）。 */
(function () {
  if (window.__tkRoot) return;
  var me = document.currentScript ||
    document.querySelector('script[src*="javascripts/bundle.js"]');
  if (!me || !me.src) return;
  window.__tkRoot = me.src.replace(/javascripts\/[^/]*$/, "");
})();

/* ==== 源文件：scroll-fix.js ==== */
/* ==========================================================================
   导航后回到页面顶部（兜底）
   --------------------------------------------------------------------------
   背景：站点启用了 Material 的 navigation.instant（XHR 换页，不整页刷新）。
   它的滚动复位是间歇性的——同一站点、同样操作，实测有时归零、有时保留
   上一页的滚动位置（读者从长页面点左侧导航，会停在半中间）。

   本脚本共五层兜底。
   ========================================================================== */
(function () {
  "use strict";

  /* 防重复初始化 ----------------------------------------------------------
     instant 切换完成后 Material 会**重放新页面的脚本**（含本文件）——
     不做防重的话，每次换页都会多挂一份监听器与订阅，越积越多。
     监听器挂在 window / document 上，跨切换存续，所以只需装一次。 */
  if (window.__tkScrollFixReady) return;
  window.__tkScrollFixReady = true;

  var guardUntil = 0;   // 「点击导航 → 切换完成 + 缓冲」窗口的截止时刻（ms）

  /* ---------- 第四层：navigate 窗口期的 history.state 消毒 ------------------
     根因（2026-09-30 实测）：Material 沿两个链条写/读 history.state.y ——
       写：滚动位置变化 → 节流后 history.replaceState(offset)；
       读：切换完成 → scrollTo(0, history.state?.y ?? 0)。
     「点击链接 → 新内容到达」之间若发生任何滚动（慢网下等待期的滚动、
     点击时滚动惯性未消、平滑滚动动画余量），脏值 y 会落进**新页面的
     entry**；切换完成后被 revert 读走 —— 表现为「点完了仍停在半中间」，
     且因竞速而间歇。

     修法 a（本函数）：窗口期内每一帧把当前 entry 的 y 清 0。不清位置、
     只清状态 —— replaceState 不动滚动，读者在等待期仍可正常浏览旧页。
     修法 b（第五层）：对 revert 本身的调用做拦截，见下。 */
  function sanitize() {
    if (Date.now() > guardUntil) return;
    try {
      var s = history.state;
      if (s && typeof s === "object" && (s.y || s.x)) {
        var c = Object.assign({}, s);
        c.y = 0;
        c.x = 0;
        history.replaceState(c, "");
      }
    } catch (e) { /* 序列化/权限异常：跳过这一帧 */ }
    requestAnimationFrame(sanitize);
  }

  /* ---------- 第五层：revert 调用拦截 --------------------------------------
     实测发现「脏值写入」与「revert 读取」经常同帧发生（切换完成的瞬间
     连写带读），rAF 消毒插不进去 —— 于是直接兜住最后一步：
     revert 的调用形态是**两参数**的 `scrollTo(0, y)`（y 从 state 读出），
     这是全站唯一会这么调用 scrollTo 的地方（Material 的锚点/标签逻辑、
     本脚本自己都用对象形式 `{top: …}`，全站 grep 无其他两参数调用者）。

     判定条件（同时满足才改写）：导航窗口内 + 两参数 + x≈0 + y 非 0。
     不校验「y 是否等于 state.y」：消毒（第四层）可能刚好把 state 清成 0，
     此时 revert 手里仍拿着清之前读出的旧值 —— 那种「已经对不上」的调用
     恰恰是必须拦截的样本。
     命中则把目标位置改写为 0：切换完成后的「恢复」一律落回顶部。
     （历史导航不经过这里：popstate 会先把窗口关掉。） */
  var origScrollTo = window.scrollTo;
  window.scrollTo = function (a, b) {
    if (
      Date.now() < guardUntil &&
      typeof a === "number" && typeof b === "number" &&
      Math.abs(a) < 1 && Math.abs(b) > 0
    ) {
      b = 0;
    }
    return origScrollTo.apply(this, arguments.length >= 2 ? [a, b] : arguments);
  };

  /* ---------- 第一层：切换完成后复位（内容就绪后的兜底）--------------------
     document$ 是 Material 提供的 observable，首次加载与每次 instant 切换后
     都会触发。两条克制：
       · 带锚点的跳转（#xxx）不处理 —— 那是读者主动要求跳到某处；
       · **历史导航（后退/前进）不处理** —— 浏览器与主题的协同会在
         popstate 后把位置恢复到离开时的地方，这是设计行为，踩一脚会破坏它
         （2026-09-30 基线实测：后退恢复 ≈1032px，本层跳过语义不变）。 */
  document$.subscribe(function () {
    if (window.__tkFromPop) {              // 历史导航：不干预，窗口全关
      guardUntil = 0;
      return;
    }
    /* 切换完成不立刻关窗 —— revert 实测比 document$ 再晚约 100ms 跑，
       窗口延续 1.5 秒把它（以及可能的第二次恢复）覆盖在内。 */
    guardUntil = Math.max(guardUntil, Date.now() + 1500);
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      /* 顺手把新 entry 的 y 清 0：此时当前 entry 就是读者刚点进来的这一页，
         y 本就应该是 0；也让「下一次 revert 迟到时」读到干净值。 */
      try {
        var s = history.state;
        if (s && typeof s === "object" && (s.y || s.x)) {
          var c = Object.assign({}, s);
          c.y = 0;
          c.x = 0;
          history.replaceState(c, "");
        }
      } catch (e) { /* 忽略 */ }
    }
  });

  /* ---------- 第二层：关掉浏览器的自动滚动恢复 ------------------------------
     history.scrollRestoration 默认是 "auto"：它会在我们复位**之后**把上一页
     的滚动位置还回来——于是读者点完左侧导航，仍然停在半中间。实测（整页
     加载长条目 → 滚到 2500px → 点侧栏）：开着 auto 时 scrollY 原样保留
     2500，稳定复现；改成 manual 后才真正归零。 */
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  /* ---------- 第三层：点击导航链接的**那一刻**就先复位 + 开窗 ---------------
     只靠第一层复位有一个体感问题：它要等新页面的内容（XHR）就绪才触发，
     弱网下会明显滞后——实测同一操作有时 80ms 归零、有时要等 500–1000ms。
     所以这里在点下去的瞬间先复位一次，同时打开导航窗口（第四/五层），
     内容到达后再由第一层兜第二次。

     两条放行规则：
       1. 带锚点的链接（#xxx）不处理——那是读者主动要求跳到某处；
       2. **站外**链接不处理——不是站内换页。
     ⚠️ 第 2 条不能用「href 以 http 开头」来判断：Material 构建后，站内导航
     链接的 href 是**绝对 URL**（https://…/entries/bosses/），那一刀会**把
     所有站内链接都误判成外链**（本站踩过）。必须用 origin 比对。
     另三类也不动：非左键（中键/右键）、组合键（新窗口语义）、新窗口打开。 */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href) return;
    var url;
    try {
      url = new URL(a.href, location.href);
    } catch (err) {
      return;
    }
    if (url.origin !== location.origin) return;   // 站外：不管
    if (url.hash) return;                          // 带锚点：读者自己要跳到某处
    if (a.target && a.target !== "_self") return; // 新窗口打开：不动当前页
    if (e.button !== undefined && e.button !== 0) return;                  // 非左键
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;          // 组合键
    window.__tkFromPop = false;                   // 这是一次「点击导航」
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    guardUntil = Date.now() + 6000;               // 导航窗口：至多 6 秒
    sanitize();
  }, true);

  /* ---------- 历史导航标记 -------------------------------------------------
     popstate（后退/前进）时点一个标记：第一层复位跳过、窗口关闭、revert
     拦截失效（恢复原样）。标记持续到下一次「点击导航」为止。 */
  window.addEventListener("popstate", function () {
    guardUntil = 0;
    window.__tkFromPop = true;
  });
})();

/* ==== 源文件：glossary-tooltip.js ==== */
/* ==========================================================================
   术语悬浮提示（Glossary Tooltips）
   --------------------------------------------------------------------------
   做什么：把正文里首次出现的塔科夫术语包成可悬停 / 可点击的元素，
           显示"原文 + 一句话释义"。

   数据源：window.TARKOV_TERMS —— 由 scripts/build_glossary.py 从
          content/docs/glossary.md 自动生成。**改了术语表，提示自动跟着变，
          不需要改这里。**

   三条克制的设计（避免"满屏下划线"反而吵）：
     1. 每个术语**每页只标第一次**；
     2. 全页**总量上限**（MAX_PER_PAGE）；
     3. 跳过标题、代码块、链接文字，以及术语速查页自身。

   ⚠️ **第 3 条里的「跳过链接文字」不是覆盖率低的原因**（第四十七批实测否证）：
   曾按"术语大多以条目链接形式出现"放行正文链接内的标注（表格 / 面包屑 /
   整行就是一个链接的清单仍排除），结果 10 页抽样只多出 **1 个**标注
   （均值 4.2 → 4.3），任务图鉴页 **0 个**——改动撤回。
   真正的约束是「**每术语每页只标第一次**」加上每页出现的**不同**术语数：
   实测均值 4.2 / 上限 15，**上限根本不是瓶颈**。
   想再提高覆盖率，要动的是第 1 条（每术语标几次），那会改掉"克制"这个前提，
   属需要拍板的取舍，见 roadmap。

   交互：桌面悬停显示；移动端没有 hover，所以额外支持**点击切换**（并可 Esc 关闭）。

   定位：气泡默认居中（CSS 里的 left:50%），这里负责在「居中装不下」时把它
         钳回裁剪边之内——见下面「气泡定位」一节。没有这段，贴右缘的术语
         气泡会被裁掉，整页滚动区也会被顶宽。
   ========================================================================== */

(function () {
  "use strict";

  var MAX_PER_PAGE = 15;          // 全页最多标注几个术语
  var CLS = "tk-term";

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function makeRe(key) {
    var e = escRe(key);
    // 纯 ASCII 的术语（PMC / FiR / Kappa…）加词边界，避免命中单词内部
    if (/^[\x00-\x7F]+$/.test(key)) return new RegExp("\\b" + e + "\\b", "g");
    return new RegExp(e, "g");
  }

  function buildIndex(terms) {
    var list = [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      for (var j = 0; j < t.keys.length; j++) {
        var k = t.keys[j];
        if (!k) continue;
        list.push({ key: k, full: t.full || "", desc: t.desc || "", re: makeRe(k) });
      }
    }
    // 长 key 优先：避免 "Scav" 抢掉 "Player Scav"
    list.sort(function (a, b) { return b.key.length - a.key.length; });
    return list;
  }

  function wrap(node, item, match) {
    var text = node.nodeValue;
    var before = text.slice(0, match.index);
    var hit = text.slice(match.index, match.index + match[0].length);
    var after = text.slice(match.index + match[0].length);

    var span = document.createElement("span");
    span.className = CLS;
    span.setAttribute("tabindex", "0");
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", item.key + "：" + item.desc);
    span.setAttribute("data-tip", (item.full ? item.full + " —— " : "") + item.desc);
    span.textContent = hit;

    var parent = node.parentNode;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(span, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
    return span;
  }

  /* --------------------------------------------------------------------------
     气泡定位：把气泡钳进「会裁剪它的那个盒子」的可见区
     --------------------------------------------------------------------------
     CSS 默认让气泡居中（left:50% + translateX(-50%)）。气泡最宽 22rem，术语却
     可能贴着容器右缘，于是右半截伸出可视区；主题又给 html 设了
     overflow-x:hidden + scrollbar-gutter:stable，伸出去的部分既滚不到也看不见，
     实测就等于**被裁**（390px 下 CHANGELOG 的「叛徒」被切 61px）。
     顺带那批「看不见的框」还把整页滚动区顶宽——实测 ammo-table 390px：
     文档 scrollWidth 369 → 469，页面能横向拖走 100px 的空白。

     做法：算出气泡中心该摆哪，把偏移量写进 CSS 变量 --tk-tip-left。

     ⚠️ 两点别踩：
       1. 可见窗口**不总是视口**。宽表格外面套了 overflow-x:auto 的滚动层
          （.md-typeset__table），术语在表格里时裁它的是那一层；按视口钳会算错。
       2. 兜底窗口要用 body.clientWidth，**不能用 documentElement.clientWidth**——
          主题给 html 设了 scrollbar-gutter:stable，后者会把预留的滚动条槽也算进
          来（本机 390px 下报 390，真实内容宽只有 369），按它钳会留下 13px 溢出。
       3. **不能拿 CSS 的 left:50% 当「居中」用，偏移量必须每次显式写。**
          术语跨行断开时（inline 被切成两个 fragment），浏览器算出的 50% 可能是 0：
          实测「PMC 业力」在 390px 下被切成 [298,350] + [16,31] 两段，left 解析成
          **0px**，气泡整块右移，把页面撑宽 82px、气泡被裁。所以这里不留
          「反正居中装得下、不用动」的捷径，一律写死。
     -------------------------------------------------------------------------- */

  var TIP_MARGIN = 8;      // 气泡离裁剪边至少留这么多

  function visibleWindow(el) {
    var p = el.parentElement, guard = 0;
    while (p && p !== document.body && guard++ < 40) {
      var cs = getComputedStyle(p);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        var r = p.getBoundingClientRect();
        var left = r.left + p.clientLeft;
        return { left: left, right: left + p.clientWidth };
      }
      p = p.parentElement;
    }
    return { left: 0, right: document.body.clientWidth };
  }

  function place(el) {
    // 先清掉上次算的——量宽度必须在「没被钳制」的状态下做，否则会读到上一次的布局
    el.style.removeProperty("--tk-tip-left");

    // ⚠️ 必须用**第一段**（getClientRects()[0]），不能用 getBoundingClientRect()。
    //    术语跨行断开时，inline 被切成多个 fragment，边界框给的是所有段的**并集**：
    //    实测「PMC 业力」在 390px 下被切成 [298,350] + [16,31]，并集是 [16,350]（宽 334），
    //    而伪元素的包含块是锚在**第一段**上的（探针实测包含块原点 = 298 = 首段左边）。
    //    拿并集当锚 → 气泡被甩到框外 249px（390px）/ 484px（768px）。
    var rects = el.getClientRects();
    if (!rects.length) return;
    var seg = rects[0];

    var w = parseFloat(getComputedStyle(el, "::after").width) || 0;
    if (!w) return;                        // 气泡没被排版（例如 print 里 display:none），不动

    var win = visibleWindow(el);
    var center = seg.left + seg.width / 2;
    var lo = win.left + w / 2 + TIP_MARGIN;
    var hi = win.right - w / 2 - TIP_MARGIN;
    var target = Math.min(Math.max(center, lo), Math.max(lo, hi));

    el.style.setProperty("--tk-tip-left", (target - seg.left).toFixed(2) + "px");
  }

  function placeAll() {
    var list = document.querySelectorAll("." + CLS);
    for (var i = 0; i < list.length; i++) place(list[i]);
  }

  var resizeRaf = 0;

  function run() {
    var terms = window.TARKOV_TERMS;
    if (!terms || !terms.length) return;

    // 术语速查页自身不必标注
    if (/\/docs\/glossary\/?$/.test(location.pathname)) return;

    var content = document.querySelector(".md-content__inner") ||
                  document.querySelector(".md-content");
    if (!content) return;

    var index = buildIndex(terms);
    var used = {};
    var count = 0;

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(H1|H2|H3|H4|H5|H6|CODE|PRE|SCRIPT|STYLE|A|BUTTON|KBD)$/.test(p.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest("." + CLS)) return NodeFilter.FILTER_REJECT;
        // 面包屑（breadcrumb.js 注入）是导航，不是正文 —— 标注它只会变成噪音
        if (p.closest(".tk-crumb")) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (var n = 0; n < nodes.length && count < MAX_PER_PAGE; n++) {
      var node = nodes[n];
      if (!node.parentNode) continue;

      // 同一个文本节点里可能有多个术语，逐个包装
      var guard = 0;
      while (count < MAX_PER_PAGE && guard++ < 5) {
        var text = node.nodeValue;
        if (!text) break;
        var best = null;
        for (var i = 0; i < index.length; i++) {
          var item = index[i];
          if (used[item.key]) continue;
          item.re.lastIndex = 0;
          var m = item.re.exec(text);
          if (m && (!best || m.index < best.m.index)) best = { item: item, m: m };
        }
        if (!best) break;
        var span = wrap(node, best.item, best.m);
        used[best.item.key] = true;
        count++;
        // wrap 之后原 node 已被移除；后续循环改用尾部的文本节点
        var next = span.nextSibling;
        if (!next || next.nodeType !== 3) break;
        node = next;
      }
    }

    // 标注完立刻摆位：气泡盒本来就在布局里，不摆的话页面当场能横向拖走
    placeAll();

    // 网络字体换上来会改文本宽度，进而改气泡宽度——换完再摆一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(placeAll).catch(function () {});
    }
  }

  // Material 的 document$ 在首次加载与每次 instant 切换后都会触发
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(run);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  /* 摆在哪，取决于「此刻」术语离裁剪边有多远——所以悬停 / 聚焦时现算一次。
     加载时算的那一份会过期：读者把宽表格横向拖过去之后再悬停术语，容器窗口
     没动、术语动了，原来算的偏移就偏了（实测最差偏出 375px）。 */
  function reposition(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var el = t.closest("." + CLS);
    if (el) place(el);
  }
  document.addEventListener("mouseover", reposition, true);
  document.addEventListener("focusin", reposition, true);

  window.addEventListener("resize", function () {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(placeAll);
  }, { passive: true });

  // 移动端：点击术语切换展开（并支持 Esc / 点别处关闭）
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("." + CLS);
    var open = document.querySelector("." + CLS + ".is-open");
    if (open && open !== el) open.classList.remove("is-open");
    if (el) {
      el.classList.toggle("is-open");
      if (el.classList.contains("is-open")) place(el);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var open = document.querySelector("." + CLS + ".is-open");
      if (open) open.classList.remove("is-open");
    }
  });
})();

/* ==== 源文件：search-ready.js ==== */
/* ==========================================================================
   搜索索引未就绪时的兜底提示 + 搜索框提示语本地化
   --------------------------------------------------------------------------
   背景（第四十七批交互层审查实测）：
   Zensical 的全文搜索把 UI 建在 **Shadow DOM** 里，而那个 Shadow DOM 的
   输入框**只有在 `search.json`（本站 2.15 MB 未压缩 / gzip 约 593 KB）
   下载并解析完成之后才被插入**。
   在它插入之前：

     · 点右上角「查找」——没有任何反应；
     · 按按钮上印着的 Ctrl+K——同样没有反应；
     · 页面上找不到任何搜索输入框。

   也就是说，索引没就绪的那段时间里，**搜索入口看起来就是坏的**，而且没有任何
   提示。审查时我本人因此连续误判两次以上。真人读者不会有耐心再点第三次。

   这个脚本不试图"催快"索引（那是构建层的事），只做两件能立刻消除误解的事：

     1. 索引未就绪时，读者点搜索按钮 / 按搜索快捷键 → 显示一条明确的提示，
        告诉他"索引正在载入、稍等几秒"，而不是让他以为站点坏了；
     2. 索引就绪后，把 Shadow DOM 里输入框的 placeholder 由英文 "Search"
        改成中文「搜索」——同一控件的 aria-label 已经是「查找」，两个名字要一致。

   三条克制（避免帮倒忙）：
     · **不拦截任何事件**——不 preventDefault、不 stopPropagation。搜索一旦能
       工作，本脚本必须完全透明（所以"就绪"之后一律直接返回）；
     · **不轮询整页**——先查 body 的直接子元素，再退到全量扫描，找到就停；
     ·**优雅降级**——拿不到 Shadow DOM（浏览器不支持 / 主题换实现）时静默返回，
       不报错、不显示提示。
   ========================================================================== */

(function () {
  "use strict";

  var POLL_INTERVAL = 400;     // 索引就绪的探测间隔
  var POLL_MAX = 150;          // 最多探 60 秒，够了就停（省电、省 CPU）
  var HINT_COOLDOWN = 6000;    // 两次提示之间的最短间隔，防连点刷屏
  var HINT_HIDE_AFTER = 5000;  // 提示自动消失时间

  var ready = false;           // 面板已出现（可点可输入）
  var patched = false;         // placeholder 已本地化
  var tries = 0;
  var lastHint = 0;
  var indexSizeMB = "2.2";     // 供失败提示引用，实测值由 fetch 时校正
  var FAIL_AFTER_MS = 45000;   // 45 秒还没好就改口说「没能载入」
  var hintEl = null;
  var hideTimer = 0;

  /* --------------------------------------------------------------------------
     找搜索输入框所在的 Shadow DOM
     -------------------------------------------------------------------------- */

  function rootOf(el) {
    try {
      return el.shadowRoot;
    } catch (e) {
      return null;            // closed shadow root：拿不到，属正常情况
    }
  }

  function hasInput(sr) {
    return !!(sr && sr.querySelector('input[role="combobox"], input[type="text"]'));
  }

  /* 先查 body 的直接子元素 —— 搜索组件挂在这一层，代价最小。
     找不到再退到全量扫描：只读属性、不触发布局，单次几毫秒。 */
  function findSearchRoot() {
    var i, sr;
    var kids = document.body ? document.body.children : [];
    for (i = 0; i < kids.length; i++) {
      sr = rootOf(kids[i]);
      if (hasInput(sr)) return sr;
    }
    var all = document.querySelectorAll("body > * > *");
    for (i = 0; i < all.length; i++) {
      sr = rootOf(all[i]);
      if (hasInput(sr)) return sr;
    }
    var deep = document.querySelectorAll("div, section, aside, header");
    for (i = 0; i < deep.length; i++) {
      sr = rootOf(deep[i]);
      if (hasInput(sr)) return sr;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     提示条
     -------------------------------------------------------------------------- */

  function ensureHint() {
    if (hintEl && document.body.contains(hintEl)) return hintEl;
    hintEl = document.createElement("div");
    hintEl.className = "tk-searchwait";
    hintEl.setAttribute("role", "status");
    hintEl.setAttribute("aria-live", "polite");
    hintEl.hidden = true;
    document.body.appendChild(hintEl);
    return hintEl;
  }

  /* --------------------------------------------------------------------------     状态：不知道 / 就绪 / 下载中 / 已失败
     登记这个不是为了好看 —— **「全文索引正在载入」这句话本身是个问题**（见下）
     -------------------------------------------------------------------------- */
  var STATE_UNKNOWN = 0, STATE_READY = 1, STATE_LOADING = 2, STATE_FAILED = 3;
  var state = STATE_UNKNOWN;

  var hintEl = null;
  var hideTimer = 0;

  /* 面板已出现但索引仍在下载 —— 这才是「正在载入」该出现的时机。
     ⚠️ 2026-10-07 修正：**旧版把「就绪」判成「Shadow DOM 里有 input」**，
        而 input 是**搜索面板里的输入框**，它要等索引就绪才被插进去；
        于是「面板已开、索引还在下」这段时间里旧版判成未就绪 → 误报「正在载入」。
        实测本地：面板弹出的瞬间输入框就在，索引 2808 条早已就绪，
        所以旧版在本不该报的时候也会报。

     ⚠️ **宿主不一定是 `.md-search`**（2026-10-07 实测）：面板挂在一个
     **没有 class 的 `div`** 上（body 下第 12 个子节点），
     `.md-search` 自己全程只有一个 `button` 子节点。
     任何写成 `document.querySelector('.md-search').shadowRoot` 的探测都会永远失败。
     所以 findSearchRoot() 必须扫 body 的所有子元素，不能假定宿主是谁。 */
  function hasPanel(sr) {
    return !!(sr && sr.querySelector('input'));
  }

  function showHint() {
    if (state === STATE_READY) return;
    var el = ensureHint();
    var now = Date.now();
    /* 冷却只为防「连点刷屏」，**不是**为了压住已经消失的提示——
       提示 5 秒后自动收起，读者再按一次 Ctrl+K 却什么都没发生，
       就又回到「站点的搜索是坏的」这个原始观感（第四十七批实测踩到）。
       所以只在提示**当时还挂着**的时候限流。 */
    if (!el.hidden && now - lastHint < HINT_COOLDOWN) return;
    lastHint = now;
    el.textContent = state === STATE_FAILED
      ? "全文索引没能载入（" + indexSizeMB + " MB）。请刷新页面再试一次；"
        + "若仍不行，直接用左侧导航或站内搜索框按关键词找。"
      : "全文索引正在载入，请稍等几秒再点——期间可用左侧导航浏览全部条目。";
    el.classList.toggle("tk-searchwait--fail", state === STATE_FAILED);
    el.hidden = false;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { el.hidden = true; }, HINT_HIDE_AFTER);
  }

  /* --------------------------------------------------------------------------
     就绪探测 + placeholder 本地化
     -------------------------------------------------------------------------- */

  function patch(sr) {
    var inp = sr.querySelector('input[role="combobox"], input[type="text"]');
    if (!inp) return;
    if (!patched && inp.placeholder && inp.placeholder !== "搜索") {
      inp.placeholder = "搜索";
      patched = true;
    }
  }

  /* --------------------------------------------------------------------------
     索引探测：**主动问一次 search.json，而不是猜主题的内部标记**
     -------------------------------------------------------------------------- */
  var indexChecked = false;

  /*站点根目录 —— **不能用相对路径**（2026-10-07 线上实测踩到）。
     `fetch("search.json")` 在**子目录页面**上会解析成
     `.../quests/item-lookup/search.json` → **404**。
     实测：首页控制台干净，一进 /quests/item-lookup/ 就多一条 404。
     取法与 toolbox.js 的 siteRoot() 同源 —— 从**本脚本自己的 src**反推，
     不用 `document.baseURI`（它在GitHub Pages 的子路径部署下未必可靠，
     而 script.src 是绝对 URL，反推最稳）。 */
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
    var s = document.querySelector("script[src*='search-ready.js']");
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function probeIndex() {
    if (indexChecked) return;
    indexChecked = true;
    var root = siteRoot();
    if (!root) { window.__tkSearchIndexSettled = false; return; }
    /* 主题自己已经在 fetch 这个文件了，这里**只读缓存**，
       同一份响应被两个消费者复用，浏览器会自动去重（同一个绝对 URL 的
       并发 fetch 共享一个网络请求）。所以多这一次探测**不产生额外流量**。
       ⚠️ 这条**实测验证过**（2026-10-08，用 resource timing 的 transferSize）：
          主题的 XHR 条目 transfer = 2.30 MB（真走网络），
          本探针的 fetch 条目 transfer = **0**（走缓存）。
       所以别把这次 fetch 当成优化目标去掉 —— 它不花流量，而去掉它
       就失去了「索引是否就绪」的判据（下面 __tkSearchIndexSettled 靠它）。 */
    try {
      fetch(root + "search.json", { cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) { window.__tkSearchIndexSettled = false; return; }
          /* content-length 只在未压缩时给；取不到就用默认文案里的数字。
             实测线上 gzip 传输约 600 KB、未压缩 2.15 MB（2026-10-08 优化后）。 */
          var cl = r.headers.get("content-length");
          if (cl) indexSizeMB = (parseInt(cl, 10) / 1048576).toFixed(1);
          window.__tkSearchIndexSettled = true;
        })
        .catch(function () { window.__tkSearchIndexSettled = false; });
    } catch (e) { /* fetch 不可用：保持未知，交给面板判据 */ }
  }

  function tick() {
    if (ready) return;
    var sr = findSearchRoot();
    if (sr && hasPanel(sr)) {
      ready = true;
      state = STATE_READY;
      patch(sr);
      if (hintEl) hintEl.hidden = true;
      return;
    }
    tries++;
    var elapsed = tries * POLL_INTERVAL;
    /* 超时就不再说「正在载入」—— 那是**谎报**：读者已经等了 45 秒，
       再等下去也不会好。不��告诉「没能载入、请刷新」，读者才知道要做什么。
       （旧版会一直说「正在载入」直到 60 秒上限，然后默默停止，
         留下一个「站点坏了」的观感—— 第四十七批那轮的原始问题。） */
    if (elapsed > FAIL_AFTER_MS && state !== STATE_FAILED) state = STATE_FAILED;
    if (tries < POLL_MAX) setTimeout(tick, POLL_INTERVAL);
  }

  function start() {
    // 每次 instant 换页后重新起步：面板可能已被主题重建
    ready = false;
    patched = false;
    tries = 0;
    indexChecked = false;
    window.__tkSearchIndexSettled = undefined;
    state = STATE_LOADING;
    probeIndex();
    setTimeout(tick, POLL_INTERVAL);
  }

  /* --------------------------------------------------------------------------
     事件：只在"未就绪"时提示，且绝不拦截
     -------------------------------------------------------------------------- */

  document.addEventListener("click", function (e) {
    if (ready) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".md-search, [class*=md-search]")) showHint();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (ready || e.altKey) return;
    var t = e.target;
    // 在输入框里敲字不算"按了搜索快捷键"
    if (t && t.closest && t.closest("input, textarea, [contenteditable='true']")) return;

    var k = e.key;
    var ctrlK = (k === "k" || k === "K") && (e.ctrlKey || e.metaKey);
    var bare = (k === "/" || k === "f" || k === "s") && !e.ctrlKey && !e.metaKey;
    if (ctrlK || bare) showHint();
  }, true);

  /* 与项目其他脚本一致：Material 的 document$ 在首次加载与每次 instant 切换后触发 */
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(start);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* ==== 源文件：breadcrumb.js ==== */
/* ==========================================================================
   篇章面包屑（打开页面就知道"我在哪一篇"）
   --------------------------------------------------------------------------
   为什么需要：本站的核心组织方式是「八篇 + 任务图鉴」，首页还专门用整屏解释
   "为什么这样排"；但读者一旦是**从搜索或外链直接落到**某一篇（在"搜索优先"
   的策略下这是常态），那套结构就完全不可见 —— 页面顶部只有站名，右侧目录只
   显示当前页的 `##` 小节，**不显示所属篇章**。（第四十七批实测：全站
   `[class*=breadcrumb]` 命中数为 0。）

   为什么用脚本而不是往 114 个页面里各写一行：
   面包屑的内容**就是导航树本身**。写在正文里等于给 nav 造一份手写副本 ——
   以后加一篇、改一篇名，就得再同步一百多处，而这类"手写副本"正是本站吃过
   亏的地方。这里改成**从导航 DOM 反向推导**：读者看到的那棵树是什么样，
   面包屑就是什么样，**零维护**。

   实现：拿当前页在侧栏里的 `.md-nav__link--active`，逐级向上找 `li.md-nav__item`，
   收集每级的标题（分组是 `label`，叶子是 `a`），拼成一条链。

   两条克制：
     · **只在有层级时才渲染** —— 首页、以及任何没有祖先的页面直接跳过；
     · **不改动正文节点** —— 插在 `.md-content__inner` 的最前面，并由
       glossary-tooltip.js 明确排除（见那边对 `.tk-crumb` 的判断），
       免得术语气泡跑到面包屑里去。
   ========================================================================== */

(function () {
  "use strict";

  var CLS = "tk-crumb";

  function norm(pathname) {
    return String(pathname || "")
      .replace(/index\.html$/, "")
      .replace(/\/+$/, "");
  }

  /* 当前页在导航里的那一个链接。
     目录（TOC）里的链接是 `#锚点`，必须排除；两个 active 链接（移动抽屉 /
     桌面侧栏）取任一个的祖先链都一样。 */
  function findActive() {
    var here = norm(location.pathname);
    var cands = document.querySelectorAll(".md-nav__link--active");
    var fallback = null;
    for (var i = 0; i < cands.length; i++) {
      var a = cands[i];
      if (a.tagName !== "A") continue;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("#") > -1) continue;
      var p;
      try {
        p = norm(new URL(a.href, location.href).pathname);
      } catch (e) {
        continue;
      }
      if (p === here) return a;
      if (!fallback) fallback = a;
    }
    return fallback;
  }

  /* 一级 li 的标题与链接（只看直属子节点，避免抓到嵌套的子项）
     ----------------------------------------------------------------------
     ⚠️ **三种形态都要认，顺序不能省**（第四十七批实测，Zensical 0.0.64）：

       ① `li > a.md-nav__link`            叶子项（指向某一篇）
       ② `li > label.md-nav__link`        分组标题（该组没有独立页面时）
       ③ `li > .md-nav__container > a.md-nav__link`
                                          **带 `navigation.sections` 时，有独立页面
                                          的分组会被套进一个容器 div**，标题变成
                                          `div.md-nav__container > a` —— 它不是 li 的
                                          直属子节点。只看 ①② 时这一级取不到，
                                          链条退化成 1 级，面包屑被下面的
                                          `items.length < 2` 静默跳过（本轮就是这么
                                          发现"脚本写了但页面上什么都没有"的）。

     注意：容器里的那个 `label` **没有文字**（只有图标），所以 ③ 必须取 `a` 而不是
     任一 `label`；取错会得到一个空标题的层级。
  */
  function levelOf(li) {
    var el = li.querySelector(
      ":scope > a.md-nav__link, :scope > label.md-nav__link, " +
      ":scope > .md-nav__container > a.md-nav__link"
    );
    if (!el) return null;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    var href = el.tagName === "A" ? el.getAttribute("href") : null;
    // 目录里的锚点不算层级
    if (href && href.indexOf("#") > -1) href = null;
    return { text: text, href: href };
  }

  function chain(active) {
    var out = [];
    var li = active.closest("li.md-nav__item");
    var guard = 0;
    while (li && guard++ < 12) {
      var lv = levelOf(li);
      if (lv) out.unshift(lv);
      var parentNav = li.parentElement;
      li = parentNav ? parentNav.closest("li.md-nav__item") : null;
    }
    return out;
  }

  function rootHref() {
    var logo = document.querySelector(".md-header__button.md-logo, a.md-logo, .md-header__title a");
    return logo && logo.href ? logo.href : location.origin + "/";
  }

  function render() {
    var old = document.querySelector("." + CLS);
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;

    var active = findActive();
    if (!active) return;

    var items = chain(active);
    if (items.length < 2) return;      // 首页 / 顶层页：没有层级可讲

    var nav = document.createElement("nav");
    nav.className = CLS;
    nav.setAttribute("aria-label", "所在位置");

    var home = document.createElement("a");
    home.href = rootHref();
    home.textContent = "首页";
    nav.appendChild(home);

    for (var i = 0; i < items.length; i++) {
      var sep = document.createElement("span");
      sep.className = CLS + "__sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      nav.appendChild(sep);

      var it = items[i];
      var last = i === items.length - 1;
      var node;
      if (it.href && !last) {
        node = document.createElement("a");
        node.href = it.href;
      } else {
        node = document.createElement("span");
        if (last) node.className = CLS + "__here";
      }
      node.textContent = it.text;
      nav.appendChild(node);
    }

    inner.insertBefore(nav, inner.firstChild);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();

/* ==== 源文件：nav-top.js ==== */
/* ==========================================================================
   顶部导航（页头横向菜单）
   --------------------------------------------------------------------------
   要解决的问题：站内 130+ 个页面全靠**左侧抽屉**里的十篇结构导航，
   而页头除了站名、搜索、主题切换之外**什么也没有**——太空了。
   从搜索结果或外链直接落地的读者（本站的常态入口），页头给不出任何方向感。

   参照 [中文 Wiki](https://www.eftarkov.com/) 的做法：页头挂一组横向下拉，
   **下挂的条目直接从左侧导航树反推**，而不是再写一份清单。

   为什么必须反推（这是本脚本存在的前提）：
     站内已经因为「手写副本」吃过亏——面包屑那一轮就明确记过，
     写在正文里的导航等于给 nav 造一份副本，加一篇改一篇名就得同步一百多处。
     顶部导航是同一类东西：**菜单内容就是导航树本身**。
     所以这里只手写「哪几个分组归到页头」这一层映射（GROUPS），
     **条目本身全部从 `.md-nav` 的 DOM 读出来**——加一篇条目、删一篇、改个名，
     页头自动跟着变，一个字都不用动这里。

   两条边界：
     · **只重排，不重命名**。分组名（「任务」「地图」…）是页头这一层自己的
       措辞，条目名一律用导航树里的原文——**站内已经因为同一个概念两种叫法
       付过代价**，这里不能再造一套。
     · **进抽屉的路径一条不减**。页头是加法不是减法：左侧十篇结构原样保留，
       页头只提供「按主题横向切入」的另一条路。窄屏（<76.25em）页头整组隐藏，
       回到抽屉——**手机上顶栏塞七个下拉只会挤掉搜索框**，那才是真损失。

   交互与既有脚本对齐：
     · 挂在 `.md-header__inner`，插在 `.md-search` 之前（与 toolbox.js 同一簇）；
     · Material 的 instant 换页不整块替换页头，所以每次 subscribe 都重挂并先查重；
     · 悬停或点击均可展开，Esc 收起，点面板外收起，转屏收起。
   ========================================================================== */

(function () {
  "use strict";

  var CLS = "tk-topnav";
  var OPEN = "tk-topnav--open";

  /* 页头分组 → 导航树里的篇。
     键是导航树里**分组 label 的原文**，值是页头显示的短名。
     一篇可以映射到多个页头分组（战斗＝第五篇＋第六篇），反之亦可。

     `index` 只有**该篇在 mkdocs.yml 里自带一个独立首页**时才写（第九篇的
     `总览与检索`）——这两页在导航树里是这一级的 <a>，
     不属于任何子项，不显式补一句就会从面板里消失。
     **名字照抄 nav 里的原文**（不写「任务图鉴总览」这种自造说法），
     否则同一个页面在侧栏叫「总览」、在页头叫「任务图鉴总览」，
     又是站内最烦的那类同一概念两种叫法。 */
  var GROUPS = [
    /* 只放**放得下**的七组。页头是快捷入口，不是完整目录：
       实测 1280 宽只能容 7 个下拉，第 8 个起被 CSS 裁掉、连悬停都点不到
       （2026-10-22 用无头浏览器在 1280 / 1440 两档截图核对）。
       放不下的三篇（战局 6 页 / 赛季 10 页 / 世界 2 页）仍在左侧抽屉里，
       「进抽屉的路径一条不减」这条边界不破。 */
    { nav: "第十篇 · 任务图鉴", label: "任务", index: "总览" },
    { nav: "第九篇 · 物品图鉴", label: "物品", index: "总览与检索" },
    { nav: "第二篇 · 地图", label: "地图" },
    { nav: "第三篇 · 装备与枪械", label: "装备" },
    { nav: "第四篇 · 经济与成长", label: "成长" },
    { nav: "第五篇 · 进阶战斗机制", label: "战斗" },
    { nav: "第十一篇 · 参考", label: "参考" }
  ];

  /* 导航树里某一级的标题与链接。
     ⚠️ 三种形态都要认（形态说明见 breadcrumb.js 的 levelOf()，那里的注释更完整）：
       ① li > a.md-nav__link叶子（指向某一篇）
       ② li > label.md-nav__link            分组标题（该组没有独立页面）
       ③ li > .md-nav__container > a.md-nav__link
            带 navigation.sections 时，有独立页面的分组会被套进容器 div
     只看 ①② 时第③ 种取不到，这一级会整个消失。 */
  function levelOf(li) {
    var el = li.querySelector(
      ":scope > a.md-nav__link, :scope > label.md-nav__link, " +
      ":scope > .md-nav__container > a.md-nav__link"
    );
    if (!el) return null;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    var href = el.tagName === "A" ? el.getAttribute("href") : null;
    if (href && href.indexOf("#") > -1) href = null;
    return { text: text, href: href };
  }

  /* 某个 li 直属的子列表。
     ⚠️ **不能只写 `:scope > ul`**（2026-10-07 线上实测踩到）：
     Material 对**嵌套分组**（也就是全部十篇）会把子列表包在
     `<nav class="md-nav">` 里 —— li 的直接子节点是
     `INPUT.md-nav__toggle` + `LABEL.md-nav__link` + `NAV.md-nav`，
     **`<ul>` 是 NAV 的孙子**。只查 `:scope > ul` 会返回 null，
     于是 leavesOf() 交空数组、columnsOf() 交 null，
     九个分组全部被 `continue` 掉，页头一个菜单都不出现，
     **而且不报任何错**——最难查的那种失败。

     顶层那四项（首页 / 读 / 用 / 查）没有这层嵌套，
     走 `:scope > ul` 就够；两种形态都留着，按顺序匹配。 */
  function subListOf(li) {
    return li.querySelector(":scope > ul.md-nav__list, :scope > nav > ul.md-nav__list");
  }

  /* 某个分组下的叶子条目（不含更深层分组）。
     返回 [{text, href}]，href 是导航树里的原始相对路径。 */
  function leavesOf(li) {
    var out = [];
    var ul = subListOf(li);
    if (!ul) return out;
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].classList || !kids[i].classList.contains("md-nav__item")) continue;
      var lv = levelOf(kids[i]);
      /* 有子列表的 li 是子分组，它的标题是分组名不是条目——这里只收叶子。
         组内条目由 columnsOf() 单独处理，避免「组名」混进条目列表。 */
      if (!lv || subListOf(kids[i])) continue;
      if (!lv.href) continue;
      out.push({ text: lv.text, href: lv.href });
    }
    return out;
  }

  /* 某个分组下的子分组（[{label, items}]），用于多列面板。
     ⚠️ 地图篇的结构是「四个子分组 + 一条散落的『转场与 BTR』」
     （2026-10-07 实测）。两种处理都会出错：
       · 只按子组分列 → **转场与 BTR 凭空消失**；
       · 整组退回扁平 → 17 条拉成一屏长条，又回到「地图篇条目最多所以最难用」。
     所以这里返回**分组 + 其余散落叶子**两类，让调用方把散落的那些
     收进第一列（它们在导航树里本来就在最前面，位置语义也对）。
     一个子分组都没有时返回 null，调用方退回纯扁平。 */
  function columnsOf(li) {
    var ul = subListOf(li);
    if (!ul) return null;
    var cols = [];
    var loose = [];
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!k.classList || !k.classList.contains("md-nav__item")) continue;
      var lv = levelOf(k);
      if (!lv) continue;
      if (subListOf(k)) {
        var items = leavesOf(k);
        /* 空子分组（渲染了但一条都没有）直接跳过，不占位列——
           但不能让它让整个多列失效：它本来就没有内容可丢。*/
        if (items.length) cols.push({ label: lv.text, items: items });
      } else if (lv.href) {
        loose.push({ text: lv.text, href: lv.href });
      }
    }
    if (!cols.length) return null;
    if (loose.length) cols.unshift({ label: null, items: loose });
    return cols;
  }

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
    var s = document.querySelector('script[src*="nav-top.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function buildPanel(group, li) {
    var panel = el("div", CLS + "__panel");
    panel.id = CLS + "-" + group.nav;
    panel.hidden = true;

    var cols = columnsOf(li);
    if (cols) {
      /* 分组自身带首页时（见下方「组自带入口页」注释），补在第一列最前。 */
      var ownLv = levelOf(li);
      var head = [];
      if (ownLv && ownLv.href && group.index) {
        head.push({ text: group.index, href: ownLv.href, lead: true });
      }
      for (var c = 0; c < cols.length; c++) {
        var col = el("div", CLS + "__col");
        /* label 为 null 的是「散落叶子」那一列——它们在导航树里没有组名，
           硬造一个组头反而不认识（读者会问「转场与 BTR 属于哪组」）。 */
        if (cols[c].label) col.appendChild(el("span", CLS + "__colhead", cols[c].label));
        var list = head.concat(cols[c].items);
        for (var j = 0; j < list.length; j++) col.appendChild(item(list[j], list[j].lead));
        head = [];
        panel.appendChild(col);
      }
    } else {
      var flat = leavesOf(li);
      /* 分组自身就是一篇页面时（mkdocs.yml 里 `第九篇 · 任务图鉴:` 带了
         `总览: quests/index.md`，于是在导航树里这一级的标题是 <a> 而不是
         <label>）—— **这一页是这一篇的入口，却不是任何子项**，
         所以 leavesOf() 拿不到它。不补这一条，「任务」面板里就没有
         「总览」—— **最该被点到的那一页反而少了**。
         显示名取 GROUPS[].index（照抄 nav 原文），不另造措辞。 */
      var own = levelOf(li);
      if (own && own.href && group.index) {
        flat.unshift({ text: group.index, href: own.href, lead: true });
      }

      var box = el("div", CLS + "__col");
      for (var k = 0; k < flat.length; k++) {
        box.appendChild(item(flat[k], flat[k].lead));
      }
      panel.appendChild(box);
    }
    return panel;
  }

  function item(it, isLead) {
    var a = el("a", CLS + "__link" + (isLead ? " " + CLS + "__link--lead" : ""), it.text);
    /* 导航树里的 href 是**相对当前页**写的（Zensical 每页按目录深度重新生成），
       而面板被插进页头——但 <a> 解析相对路径用的base 就是当前页 URL，
       与它在侧栏里时的 base 完全相同，所以原样赋值即可，不需要换算。 */
    a.href = it.href;
    /* 当前页标记：解析后的 pathname 与当前页一致就标上。
       判据必须用 pathname 而不是字符串相等——导航树里写的是
       `../entries/lighthouse.md`，与 location.pathname 永远不会字面相同。 */
    try {
      if (new URL(a.href, location.href).pathname === location.pathname) {
        a.setAttribute("aria-current", "page");
      }
    } catch (err) { /* URL 解析异常：留着没标记，链接本身不受影响 */ }
    return a;
  }

  /* ---------- 展开 / 收起 ---------- */

  var openHost = null;

  function closeAll() {
    if (!openHost) return;
    var p = openHost.querySelector("." + CLS + "__panel");
    var b = openHost.querySelector("." + CLS + "__btn");
    if (p) p.hidden = true;
    if (b) b.setAttribute("aria-expanded", "false");
    openHost.classList.remove(OPEN);
    openHost = null;
  }

  function open(host) {
    if (openHost && openHost !== host) closeAll();
    var p = host.querySelector("." + CLS + "__panel");
    var b = host.querySelector("." + CLS + "__btn");
    if (!p || !b) return;
    p.hidden = false;
    b.setAttribute("aria-expanded", "true");
    host.classList.add(OPEN);
    openHost = host;
  }

  var listenersInstalled = false;
  function installGlobalListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    document.addEventListener("click", function (e) {
      if (!openHost) return;
      if (e.target && openHost.contains(e.target)) return;
      closeAll();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !openHost) return;
      var b = openHost.querySelector("." + CLS + "__btn");
      closeAll();
      if (b && typeof b.focus === "function") b.focus();
    });

    window.addEventListener("resize", closeAll);
  }

  /* ---------- 挂载 ---------- */

  function mount() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner) return;
    var old = inner.querySelector("." + CLS);
    if (old) old.parentNode.removeChild(old);

    /* 窄屏不挂：手机上页头要留给 logo、搜索、主题切换。
       侧栏抽屉里的十篇结构导航本来就完整，这里不上就不损失什么。 */
    if (window.matchMedia && !window.matchMedia("(min-width: 76.25em)").matches) return;

    var navRoot = document.querySelector(".md-nav");
    if (!navRoot) return;

    /* 建索引：分组 label 原文 → 该组的 li。
       ⚠️ **必须扫全树的每一级，不能只看顶层**（2026-10-07 构建后实测修正）。
       顶层只有四项（首页 / 读 · 从零上手 / 用 · 工具箱 / 查 · 图鉴与速查），
       **十篇全在第二层** —— 「第一篇 · 入门机制」挂在「读」底下，「第十篇 · 任务图鉴」
       挂在「查」底下。2026-10-22 结构调整后，第二层不再只有篇：「用」下面直接是工具页。
       只扫顶层的话 byLabel 会是空的，页头一个菜单都挂不出来（而且不报错）。

       重名取**层级最浅**的那一个：某个 label 在深层再出现一次时，
       浅层那份才是导航意义上的那一组。 */
    var byLabel = {};
    var allLis = navRoot.querySelectorAll("li.md-nav__item");
    for (var i = 0; i < allLis.length; i++) {
      var li = allLis[i];
      var lv = levelOf(li);
      if (!lv) continue;
      var depth = 0;
      for (var p = li.parentElement; p && p !== navRoot; p = p.parentElement) {
        if (p.tagName === "UL") depth++;
      }
      var prev = byLabel[lv.text];
      if (prev === undefined || depth < prev.depth) {
        byLabel[lv.text] = { li: li, depth: depth };
      }
    }

    var host = el("nav", CLS);
    host.setAttribute("aria-label", "顶部导航");

    var made = 0;
    for (var g = 0; g < GROUPS.length; g++) {
      var li = byLabel[GROUPS[g].nav] ? byLabel[GROUPS[g].nav].li : null;
      if (!li) continue;
      if (!leavesOf(li).length && !columnsOf(li)) continue;   /* 空组不占位 */

      var grp = el("div", CLS + "__group");

      var btn = el("button", CLS + "__btn");
      btn.type = "button";
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", CLS + "-" + g);
      btn.title = GROUPS[g].label + "（" + GROUPS[g].nav + "）";
      btn.appendChild(el("span", CLS + "__btntx", GROUPS[g].label));
      btn.appendChild(el("span", CLS + "__caret", "▾"));
      grp.appendChild(btn);

      var panel = buildPanel(GROUPS[g], li);
      panel.id = CLS + "-" + g;
      grp.appendChild(panel);

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var p = this.parentNode.querySelector("." + CLS + "__panel");
        if (p && !p.hidden) closeAll(); else open(this.parentNode);
      });

      /* 悬停展开。**必须靠 open() 的「先关掉别人」来保证只有一个面板开着**
         ——鼠标从左往右扫过九个按钮时，mouseenter 会连续触发九次，
         如果每个都无条件展开，就会像九扇门全开那样**九个面板同时挂出来**
         （2026-10-07 实测截图就是这个效果）。
         下面 open() 的第一句就是 `if (openHost && openHost !== host) closeAll()`，
         所以这里不需要额外判断。

         移出后延迟收起：留140ms 是给「斜着从按钮移到面板」这段路的——
         指针从按钮下缘走到面板上缘的那 20px 若立刻收起，
         面板会在指针到达之前就消失。 */
      grp.addEventListener("mouseenter", function () { open(this); });
      grp.addEventListener("mouseleave", function () {
        var self = this;
        window.setTimeout(function () {
          /* :hover 是关键：延迟期间指针可能已经移回本组（或移进本组面板），
             那就不该收。用 openHost === self 确认期间没被别的组抢走。 */
          if (openHost === self && !self.matches(":hover")) closeAll();
        }, 140);
      });

      /* 键盘：↓ 进面板，Esc 由全局处理。 */
      btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown") return;
        e.preventDefault();
        open(this.parentNode);
        var first = this.parentNode.querySelector("." + CLS + "__link");
        if (first && typeof first.focus === "function") first.focus();
      });

      host.appendChild(grp);
      made++;
    }

    if (!made) return;

    installGlobalListeners();

    /* 插在搜索之前：页头右侧那一簇是「工具箱 → 搜索 → 主题切换」，
       横向菜单属于导航，排在它们左边。 */
    var search = inner.querySelector(".md-search");
    if (search) inner.insertBefore(host, search);
    else inner.appendChild(host);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

/* ==== 源文件：progress-manifest.js ==== */
/* 由 scripts/gen_progress_manifest.py 生成，请勿手工编辑。
   用途：「我的进度」各轨的只读分母与列表（任务 / 剧情章节 / 物品收集 / 藏身处）。
   数据源与 content/quests/*.md、content/entries/hideout-modules.md、
   content/entries/story-chapters.md 同源（storylines.json 手维护、与剧情页对账），
   重抓数据或改动上述页面后，要按脚本头部写的顺序重跑。 */
window.TARKOV_PROGRESS_MANIFEST = {
  "generated": "2026-10-17",
  "source": "scripts/data/quests.json（json.tarkov.dev/regular，持久 PvP） + scripts/data/hideout.json（同源，含 hideout_zh / items_zh 译名） + scripts/data/storylines.json（手维护，与剧情页对账）",
  "baseline": "2026-10-17",
  "total": 503,
  "traders": [
    {
      "slug": "mechanic",
      "name": "Mechanic",
      "count": 72
    },
    {
      "slug": "prapor",
      "name": "Prapor",
      "count": 66
    },
    {
      "slug": "skier",
      "name": "Skier",
      "count": 67
    },
    {
      "slug": "jaeger",
      "name": "Jaeger",
      "count": 64
    },
    {
      "slug": "ragman",
      "name": "Ragman",
      "count": 61
    },
    {
      "slug": "therapist",
      "name": "Therapist",
      "count": 53
    },
    {
      "slug": "peacekeeper",
      "name": "Peacekeeper",
      "count": 51
    },
    {
      "slug": "fence",
      "name": "Fence",
      "count": 16
    },
    {
      "slug": "ref",
      "name": "Ref（竞技场裁判）",
      "count": 20
    },
    {
      "slug": "btr-driver",
      "name": "BTR 司机",
      "count": 19
    },
    {
      "slug": "lightkeeper",
      "name": "Lightkeeper",
      "count": 14
    }
  ],
  "items": {
    "threshold": 3,
    "total": 78,
    "note": "「任务数」是有多少个任务需要它；「合计数量」是这些任务要求的**总件数**（跨任务求和，不是单次需求）。只列被 3 个及以上任务需要的物品。",
    "list": [
      {
        "name": "WIFI摄像头",
        "tasks": 7,
        "qty": 42,
        "traders": "Fence / Skier / Ref / Prapor / Mechanic / Therapist"
      },
      {
        "name": "“凶狠跑刀崽”私酒",
        "tasks": 6,
        "qty": 33,
        "traders": "BTR 司机 / Skier / Ragman / Ref / Lightkeeper"
      },
      {
        "name": "咸狗牛肉肠",
        "tasks": 5,
        "qty": 21,
        "traders": "Jaeger / BTR 司机 / Ref / Lightkeeper"
      },
      {
        "name": "LEDX皮肤透照仪",
        "tasks": 5,
        "qty": 15,
        "traders": "Therapist"
      },
      {
        "name": "卢布",
        "tasks": 4,
        "qty": 3400000,
        "traders": "Skier / Therapist / Fence / Ref"
      },
      {
        "name": "BEAR 狗牌",
        "tasks": 4,
        "qty": 635,
        "traders": "Prapor / Peacekeeper / Fence"
      },
      {
        "name": "Dan Jackiel瓶装威士忌",
        "tasks": 4,
        "qty": 46,
        "traders": "Ragman / Skier / Fence / Ref"
      },
      {
        "name": "Tarkovskaya瓶装伏特加",
        "tasks": 4,
        "qty": 45,
        "traders": "Ragman / BTR 司机 / Skier / Ref"
      },
      {
        "name": "Obdolbos 2 鸡尾酒兴奋剂注射器",
        "tasks": 4,
        "qty": 41,
        "traders": "Therapist / Skier"
      },
      {
        "name": "M.U.L.E. 兴奋剂注射器",
        "tasks": 4,
        "qty": 40,
        "traders": "Therapist / Peacekeeper / Skier"
      },
      {
        "name": "米屈肼注射器",
        "tasks": 4,
        "qty": 40,
        "traders": "Therapist / Peacekeeper / Skier"
      },
      {
        "name": "OLOLO瓶装复合维生素",
        "tasks": 4,
        "qty": 32,
        "traders": "Therapist"
      },
      {
        "name": "邪教徒之刃",
        "tasks": 4,
        "qty": 32,
        "traders": "Fence / Lightkeeper / Skier / Jaeger"
      },
      {
        "name": "6B43 屏障-Sh 防弹衣（数码丛林迷彩）",
        "tasks": 4,
        "qty": 23,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "Salewa急救包",
        "tasks": 4,
        "qty": 22,
        "traders": "Therapist / Jaeger"
      },
      {
        "name": "BNTI Gzhel-K（彩瓷-K）防弹衣",
        "tasks": 4,
        "qty": 21,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "P22 (22 号化合物) 兴奋剂注射器",
        "tasks": 4,
        "qty": 20,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "医用输血工具",
        "tasks": 4,
        "qty": 20,
        "traders": "Skier / Therapist"
      },
      {
        "name": "肾上腺素注射器",
        "tasks": 4,
        "qty": 20,
        "traders": "Therapist"
      },
      {
        "name": "检眼镜",
        "tasks": 4,
        "qty": 16,
        "traders": "Therapist"
      },
      {
        "name": "Obdolbos 鸡尾酒兴奋剂注射器",
        "tasks": 4,
        "qty": 13,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "3-(b-TG) 兴奋剂注射器",
        "tasks": 4,
        "qty": 12,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "AHF1-M 兴奋剂注射器",
        "tasks": 4,
        "qty": 12,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "金属燃料桶",
        "tasks": 4,
        "qty": 10,
        "traders": "Peacekeeper / BTR 司机 / Jaeger"
      },
      {
        "name": "MS2000指示器",
        "tasks": 4,
        "qty": 7,
        "traders": "Skier / BTR 司机 / Lightkeeper"
      },
      {
        "name": "USEC 狗牌",
        "tasks": 3,
        "qty": 285,
        "traders": "Prapor / Peacekeeper / Fence"
      },
      {
        "name": "一堆药",
        "tasks": 3,
        "qty": 48,
        "traders": "Therapist"
      },
      {
        "name": "炖牛肉罐头",
        "tasks": 3,
        "qty": 45,
        "traders": "Therapist / Jaeger / Ref"
      },
      {
        "name": "显示卡",
        "tasks": 3,
        "qty": 42,
        "traders": "Mechanic / Prapor / Skier"
      },
      {
        "name": "Propital 再生兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "SJ12 TGLabs 战斗兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "SJ6 TGLabs 战斗兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "SJ9 TGLabs 战斗兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "eTG-change 再生兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "BNTI Zhuk（甲虫）防弹衣（数码丛林迷彩）",
        "tasks": 3,
        "qty": 31,
        "traders": "Skier / Jaeger / Ragman"
      },
      {
        "name": "Vulkan-5 (火神) LShZ-5 重型防弹头盔 (黑色)",
        "tasks": 3,
        "qty": 31,
        "traders": "Jaeger / Skier / Ragman"
      },
      {
        "name": "呼吸面罩",
        "tasks": 3,
        "qty": 31,
        "traders": "Skier / Ragman"
      },
      {
        "name": "电线",
        "tasks": 3,
        "qty": 31,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "MRE个人即食口粮",
        "tasks": 3,
        "qty": 25,
        "traders": "Peacekeeper / Jaeger / Ref"
      },
      {
        "name": "Emelya黑麦面包块",
        "tasks": 3,
        "qty": 23,
        "traders": "BTR 司机 / Jaeger / Ref"
      },
      {
        "name": "黑麦面包块",
        "tasks": 3,
        "qty": 23,
        "traders": "BTR 司机 / Jaeger / Ref"
      },
      {
        "name": "FORT Defender-2 防弹衣",
        "tasks": 3,
        "qty": 22,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "FORT Redut-M（堡垒-M）防弹衣",
        "tasks": 3,
        "qty": 22,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "xTG-12 解毒剂注射器",
        "tasks": 3,
        "qty": 18,
        "traders": "Therapist"
      },
      {
        "name": "一次性注射器",
        "tasks": 3,
        "qty": 18,
        "traders": "Therapist"
      },
      {
        "name": "Iskra（“火花”）单兵口粮",
        "tasks": 3,
        "qty": 17,
        "traders": "Jaeger / Ref"
      },
      {
        "name": "Trijicon REAP-IR热成像步枪瞄准镜",
        "tasks": 3,
        "qty": 17,
        "traders": "Mechanic / Skier / Lightkeeper"
      },
      {
        "name": "雷硼嬉皮太阳镜",
        "tasks": 3,
        "qty": 17,
        "traders": "Ragman"
      },
      {
        "name": "AFAK单兵急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "AI-2急救组合",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CALOK-B止血剂",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CAT止血带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CMS手术包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Esmarch止血带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Grizzly急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "IFAK单兵急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Surv12野战手术包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Virtex可编程处理器",
        "tasks": 3,
        "qty": 16,
        "traders": "Peacekeeper / Prapor / Skier"
      },
      {
        "name": "军用COFDM无线信号发射器",
        "tasks": 3,
        "qty": 16,
        "traders": "Peacekeeper / Prapor / Skier"
      },
      {
        "name": "军用绷带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "印制电路板",
        "tasks": 3,
        "qty": 16,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "固定夹板",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "无菌绷带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "车载急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "铝固定夹板",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "金公鸡塑像",
        "tasks": 3,
        "qty": 15,
        "traders": "Skier / Ragman"
      },
      {
        "name": "Tigzresq 夹板",
        "tasks": 3,
        "qty": 14,
        "traders": "Jaeger / Therapist / Fence"
      },
      {
        "name": "VOG-25 Khattabka 简易手榴弹",
        "tasks": 3,
        "qty": 14,
        "traders": "BTR 司机 / Prapor / Peacekeeper"
      },
      {
        "name": "便携式除颤器",
        "tasks": 3,
        "qty": 14,
        "traders": "Therapist"
      },
      {
        "name": "纯净水",
        "tasks": 3,
        "qty": 14,
        "traders": "Ragman / Therapist / Ref"
      },
      {
        "name": "电脑CPU",
        "tasks": 3,
        "qty": 13,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "加密U盘",
        "tasks": 3,
        "qty": 12,
        "traders": "Skier / Jaeger / Peacekeeper"
      },
      {
        "name": "盐水溶液",
        "tasks": 3,
        "qty": 11,
        "traders": "Therapist"
      },
      {
        "name": "600 毫升瓶装水",
        "tasks": 3,
        "qty": 10,
        "traders": "Jaeger / Therapist / Ref"
      },
      {
        "name": "L1（去甲肾上腺素）注射器",
        "tasks": 3,
        "qty": 10,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "5升丙烷罐",
        "tasks": 3,
        "qty": 9,
        "traders": "Skier / Peacekeeper"
      },
      {
        "name": "完好的硬盘驱动器",
        "tasks": 3,
        "qty": 6,
        "traders": "Mechanic / Skier / Peacekeeper"
      },
      {
        "name": "裁判的黑料",
        "tasks": 3,
        "qty": 6,
        "traders": "Fence / Ref / Lightkeeper"
      }
    ]
  },
  "collector": {
    "quest": "收藏家",
    "questId": "5c51aac186f77432ea65c552",
    "total": 44,
    "allFir": true,
    "note": "「收藏家」任务的**全部**物品需求。与「物品收集」是两条口径，**共用同一份已囤件数账本** —— 在哪一边改数字，另一边都是同一份。",
    "list": [
      {
        "name": "古董斧头",
        "qty": 1,
        "fir": true
      },
      {
        "name": "破旧的古董书",
        "qty": 1,
        "fir": true
      },
      {
        "name": "#FireKlean牌枪润滑油",
        "qty": 1,
        "fir": true
      },
      {
        "name": "银徽章",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Deadlyslob的胡须油",
        "qty": 1,
        "fir": true
      },
      {
        "name": "金色1GPhone",
        "qty": 1,
        "fir": true
      },
      {
        "name": "假胡子",
        "qty": 1,
        "fir": true
      },
      {
        "name": "乌鸦雕像",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Pestily 瘟疫面具",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Shroud 半面巾",
        "qty": 1,
        "fir": true
      },
      {
        "name": "罐装 Dr. Lupo 咖啡豆",
        "qty": 1,
        "fir": true
      },
      {
        "name": "42 Signature Blend英式茶",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Veritas吉他拨片",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Dunduk 软盘",
        "qty": 1,
        "fir": true
      },
      {
        "name": "罐装六可乐",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Nut Sack 巴拉克拉瓦头套",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Desmondpilak CD 专辑",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Mazoni 金色哑铃",
        "qty": 1,
        "fir": true
      },
      {
        "name": "SheefGG 存钱罐",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Loot Lord毛绒玩具",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Tigzresq 夹板",
        "qty": 1,
        "fir": true
      },
      {
        "name": "GigaBeef 咸牛肉罐头",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Smoke巴拉克拉瓦头套",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Domontovich 毛帽",
        "qty": 1,
        "fir": true
      },
      {
        "name": "LM KC-130 飞机模型",
        "qty": 1,
        "fir": true
      },
      {
        "name": "法国面包房特产法棍",
        "qty": 1,
        "fir": true
      },
      {
        "name": "油墨香车瓶装水",
        "qty": 1,
        "fir": true
      },
      {
        "name": "WZ钱包",
        "qty": 1,
        "fir": true
      },
      {
        "name": "LVNDMARK的老鼠药",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Missam叉车钥匙",
        "qty": 1,
        "fir": true
      },
      {
        "name": "《天雷地火》录像带",
        "qty": 1,
        "fir": true
      },
      {
        "name": "BakeEzy烹饪书",
        "qty": 1,
        "fir": true
      },
      {
        "name": "JohnB 「Liquid DNB」墨镜",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Baddie的红胡子",
        "qty": 1,
        "fir": true
      },
      {
        "name": "DRD防弹衣",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Gingy钥匙串",
        "qty": 1,
        "fir": true
      },
      {
        "name": "金蛋",
        "qty": 1,
        "fir": true
      },
      {
        "name": "记者证（为NoiceGuy签发）",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Axel鹦鹉雕像",
        "qty": 1,
        "fir": true
      },
      {
        "name": "BEAR Buddy毛绒玩具",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Glorious E 面具",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Inseq燃气管扳手",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Viibiin运动鞋",
        "qty": 1,
        "fir": true
      },
      {
        "name": "Tamatthi 苦无飞刀（仿制品）",
        "qty": 1,
        "fir": true
      }
    ]
  },
  "hideout": {
    "total": 26,
    "levelCount": 68,
    "itemCount": 317,
    "source": "json.tarkov.dev/regular（官方数据端点，二级）+ hideout_zh / items_zh（同一套译名）",
    "baseline": "2026-10-21",
    "note": "「材料」是该等级需要的建材与数量；「战局中」标记的必须自己带出，跳蚤市场买的不算数。",
    "list": [
      {
        "en": "generator",
        "name": "发电机",
        "layer": "地基层",
        "alias": "生成器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 100000,
                "fir": false
              },
              {
                "name": "火花塞",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电线",
                "count": 15,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 10,
                "fir": false
              },
              {
                "name": "Bulbex剪线器",
                "count": 1,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 57600,
            "stations": [
              {
                "level": 3,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 3,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "供电单元",
                "count": 5,
                "fir": true
              },
              {
                "name": "电动马达",
                "count": 3,
                "fir": true
              },
              {
                "name": "火花塞",
                "count": 16,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 12,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "solar-power",
        "name": "太阳能",
        "layer": "地基层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 259200,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "完好的液晶显示屏",
                "count": 3,
                "fir": true
              },
              {
                "name": "欧元",
                "count": 25000,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电缆",
                "count": 10,
                "fir": false
              },
              {
                "name": "相控阵单元",
                "count": 6,
                "fir": false
              },
              {
                "name": "直流变压器",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "lavatory",
        "name": "卫生间",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 2000,
                "fir": false
              },
              {
                "name": "卫生纸",
                "count": 1,
                "fir": false
              },
              {
                "name": "牙膏",
                "count": 1,
                "fir": false
              },
              {
                "name": "缝纫锥",
                "count": 1,
                "fir": false
              },
              {
                "name": "肥皂",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "卫生间",
                "en": "lavatory"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一包螺钉",
                "count": 6,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 6,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 3,
                "fir": false
              },
              {
                "name": "针线盒",
                "count": 2,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 25200,
            "stations": [
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "压力表",
                "count": 2,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 6,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "medstation",
        "name": "医疗站",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "无菌绷带",
                "count": 2,
                "fir": false
              },
              {
                "name": "OLOLO瓶装复合维生素",
                "count": 1,
                "fir": false
              },
              {
                "name": "一堆药",
                "count": 1,
                "fir": false
              },
              {
                "name": "一次性注射器",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "医疗站",
                "en": "medstation"
              }
            ],
            "skills": [
              {
                "name": "Health",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 150000,
                "fir": false
              },
              {
                "name": "Esmarch止血带",
                "count": 10,
                "fir": false
              },
              {
                "name": "盐水溶液",
                "count": 6,
                "fir": false
              },
              {
                "name": "医疗工具",
                "count": 3,
                "fir": false
              },
              {
                "name": "医用输血工具",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 43200,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 2,
                "name": "医疗站",
                "en": "medstation"
              }
            ],
            "skills": [
              {
                "name": "Vitality",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "检眼镜",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 500000,
                "fir": false
              },
              {
                "name": "盐水溶液",
                "count": 10,
                "fir": false
              },
              {
                "name": "LEDX皮肤透照仪",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "nutrition-unit",
        "name": "营养部",
        "layer": "生存层",
        "alias": "营养单元",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 2,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 1,
                "fir": false
              },
              {
                "name": "罐装白盐",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 0,
            "stations": [
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 1,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "扳手",
                "count": 4,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 4,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 3,
                "fir": false
              },
              {
                "name": "碱性换热器表面洗涤剂",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 50400,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [
              {
                "name": "Metabolism",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "Smoked Chimney下水道清洁剂",
                "count": 2,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 125000,
                "fir": false
              },
              {
                "name": "碳酸氢钠",
                "count": 5,
                "fir": false
              },
              {
                "name": "罐装 Majaica 咖啡豆",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "rest-space",
        "name": "休息区",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 10000,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 1,
                "fir": false
              },
              {
                "name": "经典火柴",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 75000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 5,
                "fir": false
              },
              {
                "name": "DVD光驱",
                "count": 1,
                "fir": false
              },
              {
                "name": "电磁铁",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 7200,
            "stations": [
              {
                "level": 2,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "电容",
                "count": 5,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              },
              {
                "name": "GreenBat锂电池",
                "count": 4,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "water-collector",
        "name": "集水器",
        "layer": "生存层",
        "alias": "水收集器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 5,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 4,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 7200,
            "stations": [
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [
              {
                "name": "Attention",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "波纹软管",
                "count": 6,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 2,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 57600,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 2,
                "fir": true
              },
              {
                "name": "棘轮扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "air-filtering-unit",
        "name": "空气过滤单元",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 172800,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "防毒面具滤罐",
                "count": 5,
                "fir": true
              },
              {
                "name": "美元",
                "count": 25000,
                "fir": false
              },
              {
                "name": "军用波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "intelligence-center",
        "name": "情报中心",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "地形调查地图",
                "count": 1,
                "fir": false
              },
              {
                "name": "完好的液晶显示屏",
                "count": 1,
                "fir": false
              },
              {
                "name": "工厂地图",
                "count": 1,
                "fir": false
              },
              {
                "name": "情报文件夹",
                "count": 1,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 2,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 2,
                "name": "医疗站",
                "en": "medstation"
              },
              {
                "level": 2,
                "name": "营养部",
                "en": "nutrition-unit"
              },
              {
                "level": 1,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [
              {
                "name": "Attention",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "损坏的硬盘",
                "count": 8,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 7,
                "fir": false
              },
              {
                "name": "加密U盘",
                "count": 3,
                "fir": false
              },
              {
                "name": "情报文件夹",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "军用COFDM无线信号发射器",
                "count": 2,
                "fir": true
              },
              {
                "name": "军用电缆",
                "count": 8,
                "fir": false
              },
              {
                "name": "军用闪存装置",
                "count": 8,
                "fir": false
              },
              {
                "name": "VPX闪存模块",
                "count": 2,
                "fir": false
              },
              {
                "name": "加密磁带盒",
                "count": 2,
                "fir": false
              },
              {
                "name": "GPS信号放大单元",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "vents",
        "name": "通风",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "CPU风扇",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "汽车蓄电池",
                "count": 1,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 36000,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [
              {
                "name": "Strength",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "汽车蓄电池",
                "count": 4,
                "fir": true
              },
              {
                "name": "电动马达",
                "count": 4,
                "fir": true
              },
              {
                "name": "电线",
                "count": 14,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "印制电路板",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "workbench",
        "name": "工作台",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 2,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 2,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 10,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 3,
                "fir": false
              },
              {
                "name": "武器零件",
                "count": 3,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 2,
                "fir": false
              },
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 39604,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 2,
                "fir": true
              },
              {
                "name": "#FireKlean牌枪润滑油",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 395000,
                "fir": false
              },
              {
                "name": "罐装铝热剂",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "bitcoin-farm",
        "name": "比特币矿场",
        "layer": "收益层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 122400,
            "stations": [
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "供电单元",
                "count": 10,
                "fir": true
              },
              {
                "name": "CPU风扇",
                "count": 15,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 15,
                "fir": false
              },
              {
                "name": "T形插座",
                "count": 10,
                "fir": false
              },
              {
                "name": "VPX闪存模块",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 180000,
            "stations": [
              {
                "level": 1,
                "name": "比特币矿场",
                "en": "bitcoin-farm"
              },
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "印制电路板",
                "count": 15,
                "fir": true
              },
              {
                "name": "CPU风扇",
                "count": 15,
                "fir": false
              },
              {
                "name": "供电单元",
                "count": 10,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 381600,
            "stations": [
              {
                "level": 2,
                "name": "比特币矿场",
                "en": "bitcoin-farm"
              },
              {
                "level": 1,
                "name": "太阳能",
                "en": "solar-power"
              },
              {
                "level": 3,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "CPU风扇",
                "count": 25,
                "fir": true
              },
              {
                "name": "硅胶管",
                "count": 15,
                "fir": false
              },
              {
                "name": "压力表",
                "count": 10,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 10,
                "fir": false
              },
              {
                "name": "6-STEN-140-M军用电池",
                "count": 2,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "booze-generator",
        "name": "酿酒处",
        "layer": "收益层",
        "alias": "私酒厂",
        "levels": [
          {
            "level": 1,
            "time": 172800,
            "stations": [
              {
                "level": 3,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 3,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "压力表",
                "count": 2,
                "fir": true
              },
              {
                "name": "模拟温度计",
                "count": 2,
                "fir": true
              },
              {
                "name": "管道扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "硅胶管",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺旋散热器",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "cultist-circle",
        "name": "仪式圈",
        "layer": "收益层",
        "alias": "十字路口 / 供奉",
        "levels": [
          {
            "level": 1,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电灯泡",
                "count": 5,
                "fir": true
              },
              {
                "name": "罐装白盐",
                "count": 3,
                "fir": true
              },
              {
                "name": "Paid杀蟑剂",
                "count": 1,
                "fir": true
              },
              {
                "name": "SurvL幸存者打火机",
                "count": 1,
                "fir": true
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": true
              },
              {
                "name": "WIFI摄像头",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "scav-case",
        "name": "Scav宝箱",
        "layer": "收益层",
        "alias": "Scav 包裹",
        "levels": [
          {
            "level": 1,
            "time": 288000,
            "stations": [
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "金项链",
                "count": 8,
                "fir": true
              },
              {
                "name": "黄金骷髅指环",
                "count": 6,
                "fir": true
              },
              {
                "name": "劳力土潜水金腕表",
                "count": 4,
                "fir": true
              },
              {
                "name": "“凶狠跑刀崽”私酒",
                "count": 3,
                "fir": true
              },
              {
                "name": "青铜狮雕",
                "count": 3,
                "fir": true
              },
              {
                "name": "金公鸡塑像",
                "count": 1,
                "fir": true
              },
              {
                "name": "幸运Scav垃圾箱",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "security",
        "name": "安保",
        "layer": "收益层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [
              {
                "name": "Endurance",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 45000,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 2,
                "fir": false
              },
              {
                "name": "TP-200 砖型TNT",
                "count": 2,
                "fir": false
              },
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 61200,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "完好的液晶显示屏",
                "count": 2,
                "fir": true
              },
              {
                "name": "固态硬盘",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "NIXXOR镜头",
                "count": 8,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "gym",
        "name": "健身区",
        "layer": "成长层",
        "alias": "健身房",
        "levels": [
          {
            "level": 1,
            "time": 14400,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": true
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 5,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "hall-of-fame",
        "name": "荣耀展柜",
        "layer": "成长层",
        "alias": "名人堂",
        "levels": [
          {
            "level": 1,
            "time": 43207,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "圆嘴钳",
                "count": 1,
                "fir": true
              },
              {
                "name": "猫雕像",
                "count": 1,
                "fir": true
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "电灯泡",
                "count": 5,
                "fir": false
              },
              {
                "name": "绒布布料",
                "count": 5,
                "fir": false
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 64800,
            "stations": [
              {
                "level": 1,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "金公鸡塑像",
                "count": 1,
                "fir": true
              },
              {
                "name": "节能灯泡",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 6,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 3,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "KEKTAPE管道胶带",
                "count": 3,
                "fir": true
              },
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "青铜狮雕",
                "count": 1,
                "fir": true
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 15,
                "fir": false
              },
              {
                "name": "T形插座",
                "count": 6,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "library",
        "name": "图书馆",
        "layer": "成长层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 194400,
            "stations": [
              {
                "level": 3,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [
              {
                "name": "HideoutManagement",
                "level": 5
              }
            ],
            "items": [
              {
                "name": "项链",
                "count": 2,
                "fir": true
              },
              {
                "name": "BakeEzy烹饪书",
                "count": 1,
                "fir": true
              },
              {
                "name": "马雕像",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 400000,
                "fir": false
              },
              {
                "name": "技术指导文件",
                "count": 8,
                "fir": false
              },
              {
                "name": "日记",
                "count": 5,
                "fir": false
              },
              {
                "name": "袖珍日记",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "shooting-range",
        "name": "靶场",
        "layer": "成长层",
        "alias": "射击场",
        "levels": [
          {
            "level": 1,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 1,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 1,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 1,
                "name": "靶场",
                "en": "shooting-range"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电动马达",
                "count": 3,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属零件",
                "count": 8,
                "fir": false
              },
              {
                "name": "电线",
                "count": 6,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 6,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 3,
                "fir": false
              },
              {
                "name": "WIFI摄像头",
                "count": 3,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "靶场",
                "en": "shooting-range"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "印制电路板",
                "count": 5,
                "fir": false
              },
              {
                "name": "电容",
                "count": 5,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "defective-wall",
        "name": "易碎墙",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "医疗站",
                "en": "medstation"
              },
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 2,
            "time": 43200,
            "stations": [
              {
                "level": 1,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 4,
            "time": 10800,
            "stations": [
              {
                "level": 3,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Fierce Blow重击锤",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 5,
            "time": 10800,
            "stations": [
              {
                "level": 4,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一套工具",
                "count": 1,
                "fir": false
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 6,
            "time": 43200,
            "stations": [
              {
                "level": 5,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 2,
                "fir": false
              },
              {
                "name": "电灯泡",
                "count": 2,
                "fir": false
              },
              {
                "name": "电线",
                "count": 2,
                "fir": false
              },
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 1,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "gear-rack",
        "name": "装备架",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 21600,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "缝纫锥",
                "count": 1,
                "fir": true
              },
              {
                "name": "针线盒",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 300000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 15,
                "fir": false
              },
              {
                "name": "绒布布料",
                "count": 10,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 8,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 43200,
            "stations": [
              {
                "level": 1,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              },
              {
                "level": 1,
                "name": "装备架",
                "en": "gear-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 800000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 12,
                "fir": false
              },
              {
                "name": "芳纶纤维布料",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 8,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              },
              {
                "level": 2,
                "name": "装备架",
                "en": "gear-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "棘轮扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "防弹衣维修套件",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 1200000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 15,
                "fir": false
              },
              {
                "name": "Cordura聚酰胺面料",
                "count": 10,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "heating",
        "name": "供暖",
        "layer": null,
        "alias": "加热器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              },
              {
                "name": "经典火柴",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [
              {
                "name": "Endurance",
                "level": 1
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "Crickent打火机",
                "count": 5,
                "fir": false
              },
              {
                "name": "固体燃料",
                "count": 5,
                "fir": false
              },
              {
                "name": "Hunter火柴",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 28800,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "相位控制继电器",
                "count": 4,
                "fir": true
              },
              {
                "name": "军用波纹软管",
                "count": 2,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺旋散热器",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "illumination",
        "name": "照明",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 10000,
                "fir": false
              },
              {
                "name": "Crickent打火机",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电灯泡",
                "count": 14,
                "fir": false
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 21600,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电容",
                "count": 7,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "电线",
                "count": 12,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 12,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "stash",
        "name": "仓库",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": []
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 2500000,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 4,
                "fir": false
              },
              {
                "name": "手摇钻",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 43200,
            "stations": [
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 8500000,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 15,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 7,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 4,
            "time": 345600,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "供暖",
                "en": "heating"
              },
              {
                "level": 3,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "棘轮扳手",
                "count": 2,
                "fir": true
              },
              {
                "name": "欧元",
                "count": 200000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 10,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 8,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "weapon-rack",
        "name": "武器架",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 43200,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "手摇钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": true
              },
              {
                "name": "螺栓",
                "count": 15,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 64800,
            "stations": [
              {
                "level": 2,
                "name": "靶场",
                "en": "shooting-range"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 1,
                "name": "武器架",
                "en": "weapon-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "一包螺钉",
                "count": 10,
                "fir": false
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 10,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 10,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "武器零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "靶场",
                "en": "shooting-range"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "武器架",
                "en": "weapon-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "KEKTAPE管道胶带",
                "count": 5,
                "fir": true
              },
              {
                "name": "#FireKlean牌枪润滑油",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 15,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      }
    ]
  },
  "storyline": {
    "total": 10,
    "source": "中文 Wiki 实测（三级来源），经 content/entries/story-chapters.md §2.1 收录",
    "baseline": "2026-09-30",
    "note": "剧情章节是**纯手动记录**（未标记 / 进行中 / 已完成）：官方任务数据里没有「章节」这层结构，本站也没有章节→任务的映射 —— 算不出来就不算，这条轨只记你亲手标的那一下。",
    "list": [
      {
        "id": "tour",
        "en": "Tour",
        "zh": "游览",
        "objectives": 26,
        "axis": true,
        "note": "序章；Mechanic 起手"
      },
      {
        "id": "falling-skies",
        "en": "Falling Skies",
        "zh": "陨落之天",
        "objectives": 20,
        "axis": true,
        "note": "唯一的重大多叉"
      },
      {
        "id": "the-ticket",
        "en": "The Ticket",
        "zh": "车票",
        "objectives": 12,
        "axis": true,
        "note": "终章；四个结局"
      },
      {
        "id": "they-are-already-here",
        "en": "They Are Already Here",
        "zh": "他们已经来了",
        "objectives": 30,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "batya",
        "en": "Batya",
        "zh": null,
        "objectives": 38,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "boreas",
        "en": "Boreas",
        "zh": null,
        "objectives": 67,
        "axis": false,
        "note": "穿插（最长的一章）"
      },
      {
        "id": "the-unheard",
        "en": null,
        "zh": "无名者",
        "objectives": 24,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "accidental-witness",
        "en": null,
        "zh": "意外证人",
        "objectives": 18,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "labyrinth",
        "en": null,
        "zh": "探秘“迷宫”",
        "objectives": 14,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "blue-fire",
        "en": null,
        "zh": "神秘蓝焰",
        "objectives": 8,
        "axis": false,
        "note": "穿插（最短的一章）"
      }
    ]
  }
};

/* ==== 源文件：progress.js ==== */
/* ==========================================================================
   任务进度追踪（纯本地，无账号、无后端）
   --------------------------------------------------------------------------
   要解决的问题：站内第九篇是 504 个任务的逐条明细，读完之后**读者自己记不住
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
       v: 7,
       mode: "pvp" | "pve" | "season",
       modes: { <模式>: { quests, inhand, objectives, items, hideout, storyline, … } }
     }
     （各轨的完整键值说明见下方「存储层」；历史版本 v1→v7 的演进也在那里。）

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

     结构（v6；演进：v2 三条轨 → v3 物品改件数 → v5 加目标与门槛 → v6 加剧情章节）：
       {
         v: 7,
         mode: "pvp" | "pve" | "season",
         modes: { <模式>: { quests, inhand, objectives, items, hideout, storyline, … } }
       }

     各轨独立、共用同一个模式维度：
       · quests / inhand —— 值 = 商人 slug（用于按商人汇总）
       · objectives      —— 键 = `任务id|目标id`，值 = "1"
       · items           —— 值 = 已囤件数（数字字符串）；0/缺失都表示没囤
       · hideout         —— 值 = 等级数字的字符串；0/缺失都表示未建造
       · storyline       —— 值 = "inhand" / "done"（剧情章节三态，**纯手动、不做推断**）
     键：任务用数据端点 id、剧情章节用站内清单 id（scripts/data/storylines.json）；
     物品与藏身处用**中文名**（这两份派生数据里没有 id，见总览页「数据与隐私」
     对名称变动的说明）。
     -------------------------------------------------------------------------- */

  /* v6 新增 storyline 轨（剧情章节三态）。旧数据无需转换 —— load() 会把缺失的
     键补成空表：v5 之前存下的进度照常读入，只是这条轨从「全是未标记」开始。 */
  var SCHEMA_VERSION = 7;

  function blankMode() {
    return {
      quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {},
      /* 五态里的另外两态（v7 · 2026-10-18）：
         · pinned  —— 「这条我要做」，比 inhand 更主动（inhand 是"游戏里已经接了"）
         · ignored —— 「这赛季不做」。它只影响**统计口径**，不改任务本身：
           被忽略的任务不计入「未完成」，列表里以灰行显示、可随时撤销。
         凭什么要它：504 个任务没人做得完，不给出口的话「未完成 380 个」
         这个数字对多数人是噪音，进度页的核心数字就失去意义了。 */
      pinned: {}, ignored: {},
      storyline: {},           // 剧情章节：{ <站内章节id>: "inhand" | "done" }
      ll: {},                 // 商人忠诚度：{ <商人slug>: "1".."4" }
      fence: null,             // Fence 声望：**负值刻度**（如亡羊补牢要求 ≤ −3），与上面的 ll 不是一把尺。null = 未填
      level: 0,               // 我的等级
      faction: "",            // "BEAR" / "USEC" / ""
      prestige: 0,            // 转生次数
    };
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
        /* 目标轨：键是 `任务id|目标id`。
           目标 id 来自官方端点（不是下标）—— 重抓数据时目标顺序会变，
           用下标当键会让「勾过的目标」跑到别的目标上。 */
        objectives: cleanMap(src.objectives),
        pinned: cleanMap(src.pinned),
        ignored: cleanMap(src.ignored),
        /* 剧情章节轨：值只允许 "inhand" / "done"（下面统一过滤），
           键是站内清单 id —— 与生成器 progress-manifest.js 的 storyline 段同源。 */
        storyline: cleanMap(src.storyline),
        ll: cleanMap(src.ll),
        fence: null,
        level: 0,
        faction: "",
        prestige: 0,
      };
      /* 我的等级：只接受 1–99 的整数，其余当没填（0）。
         它不是「进度」而是「筛选条件」，所以单独存、不放进任何一条轨。 */
      var lv = parseInt(src.level, 10);
      mode.level = (isFinite(lv) && lv > 0 && lv < 100) ? lv : 0;
      mode.faction = (src.faction === "BEAR" || src.faction === "USEC") ? src.faction : "";
      /* Fence 声望：独立字段、**允许负数**。它与商人忠诚度不是一套刻度
         ——Fence 用负值（亡羊补牢要求 ≤ −3、≤ −1），LL 只有 1–4 的正值。
         合法区间取 −10 – 10，两端各留一点余量。**null 表示未填**，与「填了 0」
         必须区分：0 是真实值（破镜重圆三条要求 Lightkeeper ≤ 0），判定的方向
         恰好相反，混成一个值会让两批任务同时算错。 */
      var fr = parseInt(src.fence, 10);
      mode.fence = (isFinite(fr) && fr >= -10 && fr <= 10) ? fr : null;
      var pr = parseInt(src.prestige, 10);
      mode.prestige = (isFinite(pr) && pr > 0 && pr < 20) ? pr : 0;
      /* 商人忠诚度：只留 1–4 的整数。 */
      var lls = Object.keys(mode.ll);
      for (var li = 0; li < lls.length; li++) {
        var lvv = parseInt(mode.ll[lls[li]], 10);
        if (!isFinite(lvv) || lvv < 1 || lvv > 4) delete mode.ll[lls[li]];
        else mode.ll[lls[li]] = String(lvv);
      }
      /* 藏身处等级：把明显非法的值（0、负数、非数字）在**读入时**就清掉，
         免得下游三处各自判断。 */
      var hk = Object.keys(mode.hideout);
      for (var j = 0; j < hk.length; j++) {
        var lv = parseInt(mode.hideout[hk[j]], 10);
        if (!isFinite(lv) || lv <= 0) delete mode.hideout[hk[j]];
        else mode.hideout[hk[j]] = String(lv);
      }
      /* 剧情章节：只接受 "inhand" / "done" 两个值 —— 其余（空串、旧版本残留、
         手工改坏）一律按「未标记」处理（清掉键）。 */
      var chk = Object.keys(mode.storyline);
      for (var ci = 0; ci < chk.length; ci++) {
        var csv = mode.storyline[chk[ci]];
        if (csv !== "inhand" && csv !== "done") delete mode.storyline[chk[ci]];
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
    /* 常驻状态条要跟着每一次记录变化重画（v1.79.0 新增）。
       挂在 emit 上而不是各 setter 里 —— emit 是所有写操作的唯一出口，
       挂在这里就绝不会漏掉某条路径。 */
    var sb = document.getElementById("tk-statusbar");
    if (sb && typeof buildStatusStrip === "function") {
      try {
        var bar = document.querySelector(".tk-pgbar");
        if (bar) buildStatusStrip(bar);
      } catch (e) { /* 状态条失败不该影响记录本身 */ }
    }
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

  var TRACKS = ["quests", "inhand", "objectives", "items", "hideout", "storyline"];
  var TRACK_LABEL = {
    quests: "已完成任务", inhand: "进行中任务", objectives: "任务目标",
    items: "物品收集", hideout: "藏身处", storyline: "剧情章节",
  };

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

    /* —— 进行中轨（我当前接在身上的任务） ——
       ⚠️ 存储键**仍然是 `inhand`**：界面上的措辞从「在手」改成了「进行中」，
       但键一旦改掉，读者已经存下来的进度会整体读不出来。**显示词可以改，键不能改。**
       这条轨是「按前置树反推」的**输入**：玩家记得现进行中上有哪些任务，
       但不会记得过去完成了哪些（504 个任务，靠回忆不成立）。
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

    /* 任务的三态：""（未标记）/ "inhand"（进行中）/ "done"（已完成）。
       三态是**互斥**的 —— 写一处必清另一处，否则同一个任务会同时出现在
       「进行中」和「已完成」两个列表里。 */
    taskState: function (qid, m) {
      if (!qid) return "";
      var d = load();
      var md = d.modes[m || d.mode];
      /* ⚠️ 必须用**「键存在与否」**判断，不能用值的真假：
         从看板改状态时拿不到商人 slug，值会存成空字符串 —— 空字符串是
         falsy，用 `if (md.quests[qid])` 会把「已完成」读成「未标记」，
         而计数那边（Object.keys）照样算它一条，两处就此对不上。 */
      if (Object.prototype.hasOwnProperty.call(md.quests, qid)) return "done";
      if (Object.prototype.hasOwnProperty.call(md.inhand, qid)) return "inhand";
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

    /* —— 目标轨 ——
       键是 `任务id|目标id`。目标 id 来自官方端点，**不是下标** ——
       重抓数据时目标顺序会变（站内已有先例），用下标当键会让「勾过的目标」
       跑到同任务的另一个目标上。 */

    objKey: function (qid, oid) { return String(qid) + "|" + String(oid); },

    /* ---- 钉住 / 忽略（v7 · 2026-10-18）------------------------------------
       这两态与三态**正交**，不是第四、第五个互斥状态：
         · pinned 可以与 inhand / done 并存（"我钉住了这条，而且它正在做"）；
         · ignored 与 done **互斥** —— 已完成的没有"不做"可言，标忽略时清 done，
           标完成时清 ignored。
       这样「未完成」= 未完成 − 已忽略，一个数字就能说清还剩多少活。 */
    isPinned: function (qid, m) {
      if (!qid) return false;
      var d = load();
      return Object.prototype.hasOwnProperty.call(
        (d.modes[m || d.mode] || {}).pinned || {}, qid);
    },
    togglePin: function (qid, m) {
      if (!qid) return false;
      var d = load();
      var md = d.modes[m || d.mode];
      var on = !md.pinned[qid];
      if (on) md.pinned[qid] = "1"; else delete md.pinned[qid];
      save(d); emit();
      return on;
    },
    isIgnored: function (qid, m) {
      if (!qid) return false;
      var d = load();
      return Object.prototype.hasOwnProperty.call(
        (d.modes[m || d.mode] || {}).ignored || {}, qid);
    },
    toggleIgnore: function (qid, m) {
      if (!qid) return false;
      var d = load();
      var md = d.modes[m || d.mode];
      var on = !md.ignored[qid];
      if (on) {
        /* 忽略与已完成互斥：标忽略就把 done 摘掉，否则两边同时为真，
           计数会既算「已完成」又算「不做」，怎么读都是错的。 */
        md.ignored[qid] = "1";
        delete md.quests[qid];
        delete md.inhand[qid];
      } else {
        delete md.ignored[qid];
      }
      save(d); emit();
      return on;
    },

    objDone: function (qid, oid, m) {
      if (!qid || !oid) return false;
      var d = load();
      return !!d.modes[m || d.mode].objectives[String(qid) + "|" + String(oid)];
    },

    setObjective: function (qid, oid, on, m) {
      if (!qid || !oid) return;
      var d = load();
      var key = m || d.mode;
      var k = String(qid) + "|" + String(oid);
      if (on) d.modes[key].objectives[k] = "1";
      else delete d.modes[key].objectives[k];
      save(d);
      emit();
    },

    countObjectives: function (qid, oids, m) {
      if (!qid || !oids) return 0;
      var d = load();
      var src = d.modes[m || d.mode].objectives;
      var n = 0;
      for (var i = 0; i < oids.length; i++) if (src[String(qid) + "|" + String(oids[i])]) n++;
      return n;
    },

    /* 直设任务状态时，把目标轨一起对齐：
       · 设为「已完成」→ 勾满它的全部目标，否则展开后会看到「已完成但 0/N」的矛盾
       · 设为「未标记」→ 清空该任务的目标
       · 设为「进行中」→ **保留**已有目标进度（部分完成是真实信息，不该被抹掉） */
    alignObjectives: function (qid, oids, state, m) {
      if (!qid || !oids || !oids.length || state === "inhand") return;
      var d = load();
      var key = m || d.mode;
      for (var i = 0; i < oids.length; i++) {
        var k = String(qid) + "|" + String(oids[i]);
        if (state === "done") d.modes[key].objectives[k] = "1";
        else delete d.modes[key].objectives[k];
      }
      save(d);
      emit();
    },

    /* —— 门槛设置（商人忠诚度 / 阵营 / 转生）——
       都是「筛选条件」而不是「进度」，所以不放进任何一条轨、清轨时也不动。 */

    gates: function (m) {
      var d = load();
      var md = d.modes[m || d.mode];
      return { ll: md.ll, fence: md.fence, faction: md.faction, prestige: md.prestige, level: md.level };
    },

    /* Fence 声望：0 表示「没填」而不是「声望为 0」——后者是一个真实存在且
       会被用到的值（破镜重圆三条要求 Lightkeeper ≤ 0）。所以未填时存 null，
       判定时按「未知」处理成 soft 提示，不阻断也不放行。 */
    setFence: function (n) {
      var d = load();
      if (n === "" || n === null || n === undefined) delete d.modes[d.mode].fence;
      else {
        var v = parseInt(n, 10);
        if (!isFinite(v) || v < -10 || v > 10) delete d.modes[d.mode].fence;
        else d.modes[d.mode].fence = v;
      }
      save(d);
      emit();
    },

    getFence: function () {
      var d = load();
      var v = d.modes[d.mode].fence;
      return (v === undefined || v === null) ? null : v;
    },

    setLL: function (trader, n) {
      if (!trader) return;
      var d = load();
      var v = parseInt(n, 10);
      if (!isFinite(v) || v < 1 || v > 4) delete d.modes[d.mode].ll[trader];
      else d.modes[d.mode].ll[trader] = String(v);
      save(d);
      emit();
    },

    setFaction: function (f) {
      var d = load();
      d.modes[d.mode].faction = (f === "BEAR" || f === "USEC") ? f : "";
      save(d);
      emit();
    },

    setPrestige: function (n) {
      var d = load();
      var v = parseInt(n, 10);
      d.modes[d.mode].prestige = (isFinite(v) && v > 0 && v < 20) ? v : 0;
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

    /* —— 剧情章节轨（三态，纯手动） ——
       剧情章节的「未标记 / 进行中 / 已完成」。**与其它轨最大的不同：不做任何
       推断、也不与任务轨联动** —— 官方任务数据里没有「章节」这层结构、也没有
       章节→任务的映射，算不出来就不算（清单在 progress-manifest.js 的
       storyline 段，出处是 scripts/data/storylines.json，与剧情页成对维护）。
       键 = 清单里的 id（英文名可查的用英文名）——**不用中文名**：章节译名各
       来源不一（见 story-chapters.md 的说明），英文名才是稳的那个。 */

    chapterState: function (chid, m) {
      if (!chid) return "";
      var d = load();
      var v = d.modes[m || d.mode].storyline[chid];
      return (v === "done" || v === "inhand") ? v : "";
    },

    setChapterState: function (chid, state, m) {
      if (!chid) return;
      var d = load();
      var key = m || d.mode;
      if (state === "done" || state === "inhand") d.modes[key].storyline[chid] = state;
      else delete d.modes[key].storyline[chid];
      save(d);
      emit();
    },

    /* 汇总：{ done, inhand, total }。清单由调用方传入 —— 状态条、总览、剧情看板
       三处必须用这一个数：各算一份，迟早出现「同一页两个数字对不上」。 */
    storyCounts: function (list, m) {
      var d = load();
      var src = d.modes[m || d.mode].storyline;
      var arr = list || [];
      var out = { done: 0, inhand: 0, total: arr.length };
      for (var i = 0; i < arr.length; i++) {
        var st = src[arr[i].id];
        if (st === "done") out.done++;
        else if (st === "inhand") out.inhand++;
      }
      return out;
    },

    /* —— 日志同步：批量并入任务状态 ——

       与 setTaskState 的分工：那个是「单条改、交互用」，这个是「整批并、
       同步用」—— 一次 load / save / emit。逐条调 setTaskState 会对
       localStorage 做上百次读写、并触发上百次全站重绘（实测明显卡）。

       **只往强里改**：未标记 → 进行中 → 已完成。不会把已完成的降级 ——
       日志是游戏侧的事实，可以补全、可以升级，但不能因为一次同步把读者
       亲手标过的东西弄丢（与导入的「件数取较大值 / 剧情取较强状态」同一
       精神）。值的形态与 setTaskState 一致（商人 slug，用于按商人汇总）。

       dry = true 时只统计、不落盘 —— 给日志同步的「并入前预览」用：
       预览与真正并入走**同一套规则**，不在调用方复制一份（复制必然漂）。 */
    mergeTasks: function (entries, m, dry) {
      var out = { done: 0, inhand: 0, kept: 0 };
      if (!entries || !entries.length) return out;
      var d = load();
      var key = m || d.mode;
      var md = d.modes[key];
      if (!md) return out;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.id) continue;
        var inDone = Object.prototype.hasOwnProperty.call(md.quests, e.id);
        var inHand = Object.prototype.hasOwnProperty.call(md.inhand, e.id);
        if (e.state === "done") {
          if (inDone) { out.kept++; continue; }
          if (!dry) {
            delete md.inhand[e.id];
            md.quests[e.id] = e.trader || "";
          }
          out.done++;
        } else if (e.state === "inhand") {
          if (inDone || inHand) { out.kept++; continue; }
          if (!dry) md.inhand[e.id] = e.trader || "";
          out.inhand++;
        }
      }
      if (!dry) { save(d); emit(); }
      return out;
    },

    /* 按日志重建任务轨（2026-10-25）—— 清空**这一模式**的任务 / 进行中 / 目标三条，
       然后由 log-sync 把整批事件按时间线写回来。

       为什么需要它：`mergeTasks` 是「只补不降」，这是**故意的** ——
       日志只覆盖本机还留着的那段时间（游戏会清旧会话），允许它降级就等于
       用不完整的数据覆盖完整的手动记录。但转生会把游戏里的任务清空重来，
       于是账本永远降不下来：实测本机 90 个会话，转生前完成、转生后重新接取的
       7 票会被算成「一直完成着」，连带依赖它们的「可接」判定一起偏。

       所以给一个**读者主动触发**的入口，而不是让同步自动降。
       ⚠️ 只动这三条：物品 / 藏身处 / 剧情 / 等级 / 门槛 / 商人声望一律不碰
          —— 转生重置的是任务与声望，但站内声望要读者自己填，不该替他清。 */
    replaceTaskTrack: function (m) {
      var d = load();
      var key = m || d.mode;
      var md = d.modes[key];
      if (!md) return false;
      md.quests = {};
      md.inhand = {};
      md.objectives = {};
      save(d);
      emit();
      return true;
    },

    /* —— 通用 —— */

    /* track 省略 = 清空该模式的所有轨 */
    clear: function (track, m) {
      var d = load();
      var key = m || d.mode;
      if (TRACKS.indexOf(track) >= 0) d.modes[key][track] = {};
      else d.modes[key] = blankMode();
      save(d);
      emit();
    },

    /* 全清：**三个模式**的全部轨，连同等级与门槛（含 Fence 声望）一起回到
       出厂状态 —— 「清空全部进度」按钮用。

       与 clear() 的分工：clear() 只清**当前模式**（一条轨，或省略参数时该模式
       的全部轨）。全清是「把账本扔掉」，所以：
         · 界面上的确认框会**逐项列出将丢失的数量**（数字在点击时才计算，
           见 progress-boards.js 的 allTrackCounts）并提示先导出备份；
         · 模式选择（当前在看 PVP 还是 PVE）**保留** —— 它是视图状态而不是
           进度数据，清空后界面停在原模式，不会突然跳回 PVP；
         · 一次 save + emit（逐模式调 clear 会触发三次全站重绘）。 */
    clearAll: function () {
      var cur = load().mode;
      var d = blankData();
      d.mode = MODES.indexOf(cur) >= 0 ? cur : "pvp";
      save(d);
      emit();
    },

    exportText: function () { return JSON.stringify(load(), null, 2); },

    /* 导入：只接受本功能自己导出的结构。合并不是覆盖 —— 读者的直觉是
       「把我这份并进去」，覆盖会静默毁掉另一台上的进度。
       各轨的合并规则**不一样**（见内层注释）：任务取并集，件数与等级取较大值，
       剧情章节取较强状态。 */
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

            /* 剧情章节：**取较强状态**（done > inhand > 未标记）。
               与「件数取较大值」同精神：导入是换设备合并、不是覆盖 ——
               让较弱的状态回来把「已完成」拉回「进行中」，那是在毁进度。 */
            if (track === "storyline") {
              var rank = { "": 0, "inhand": 1, "done": 2 };
              var imp = (sv === "done" || sv === "inhand") ? sv : "";
              if (!imp) continue;
              if ((rank[d.modes[m][track][id]] || 0) >= rank[imp]) continue;
              d.modes[m][track][id] = imp;
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
        msg: "已并入 " + added + " 条进度（任务取并集、件数与等级取较大值、"
           + "剧情章节取较强状态，都不会覆盖已有）。"
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
     状态分段控件（任务 / 剧情章节共用）

     三个状态（未标记 / 进行中 / 已完成）并排常驻显示、当前项高亮。
     2026-10-07 从原生 <select> 换成分段控件，原因：下拉把「有哪些状态可选」
     藏了起来 —— 要**点开**才知道有哪些选项，改一次状态要点两次，而这是全站
     最高频的动作；状态是整个列表里最重要的信号，却做成了最不起眼的控件。

     控件做成通用工厂：任务与剧情章节的读法/写法不同（任务带商人 slug、
     章节只带站内侧清单 id），但**交互与外观必须一致** —— 差异只允许存在于
     get / set 两个回调里，别再各写一份。
     -------------------------------------------------------------------------- */

  var STATE_OPTS = [["", "未标记"], ["inhand", "进行中"], ["done", "已完成"]];

  function makeSegSelect(opt) {
    var box = document.createElement("div");
    box.className = (opt.cls || "tk-qstate") + " tk-qstate--seg";
    box.setAttribute("role", "group");
    box.setAttribute("data-focus-key", opt.focusKey);
    box.setAttribute("aria-label", opt.ariaLabel);

    var cur = opt.get();
    for (var i = 0; i < STATE_OPTS.length; i++) {
      (function (val, label) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tk-qseg" + (val ? " tk-qseg--" + val : " tk-qseg--none");
        b.textContent = label;
        b.title = val ? ("标为「" + label + "」") : ("不标记" + opt.what + "（当前：" + label + "）");
        b.setAttribute("aria-pressed", val === cur ? "true" : "false");
        b.addEventListener("click", function () {
          if (opt.get() === val) return;      /* 已是当前态，不重绘 */
          /* 先派发再改状态：调用方（如看板）要拿新值去对齐明细，
             那必须在 set 触发整块重建之前跑完。 */
          try {
            box.dispatchEvent(new CustomEvent("tk:state", { bubbles: true, detail: val }));
          } catch (e) {
            box.dispatchEvent(new Event("tk:state"));
          }
          opt.set(val);
        });
        box.appendChild(b);
      })(STATE_OPTS[i][0], STATE_OPTS[i][1]);
    }
    /* 回填仍放在工厂里（v1.75.1 的教训）：看板每次变更都整块重建，
       控件若不自己认当前状态，两个调用点就会显示不一致。 */
    box.setAttribute("data-state", cur);
    return box;
  }

  function makeStateSelect(qid, trader, cls) {
    return makeSegSelect({
      cls: cls, focusKey: "q:" + qid,
      ariaLabel: "该任务在「我的进度」里的状态",
      what: "这个任务",
      get: function () { return api.taskState(qid); },
      set: function (v) { api.setTaskState(qid, v, trader); },
    });
  }

  /* 剧情章节的状态控件：同一套分段控件、同一套存储（只是换一条轨）。 */
  function makeChapterSelect(chid, cls) {
    return makeSegSelect({
      cls: cls, focusKey: "ch:" + chid,
      ariaLabel: "该剧情章节在「我的进度」里的状态",
      what: "这一章",
      get: function () { return api.chapterState(chid); },
      set: function (v) { api.setChapterState(chid, v); },
    });
  }

  /* 分段控件的值同步：整块重建后由调用方对齐高亮。
     （原 select 是靠 .value 赋值，这里是 aria-pressed + data-state。） */
  function syncStateSeg(box, st) {
    if (!box || box.className.indexOf("tk-qstate--seg") < 0) return;
    box.setAttribute("data-state", st || "");
    var bs = box.querySelectorAll(".tk-qseg");
    for (var i = 0; i < bs.length; i++) {
      var v = bs[i].className.indexOf("tk-qseg--inhand") >= 0 ? "inhand"
            : bs[i].className.indexOf("tk-qseg--done") >= 0 ? "done" : "";
      bs[i].setAttribute("aria-pressed", v === (st || "") ? "true" : "false");
    }
  }

  function syncHead(h, qid) {
    var st = api.taskState(qid);
    h.classList.toggle("tk-qdone", st === "done");
    h.classList.toggle("tk-qinhand", st === "inhand");
    syncStateSeg(h.querySelector(".tk-qstate"), st);
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
     剧情章节页（story-chapters.md）的状态控件

     每个 `<span data-chapter="<id>">` 是页面上留的挂点，控件插进去；整行按
     状态着色（沿用任务页的 tk-qdone / tk-qinhand 行样式 —— 全站一套视觉语言，
     不新建第二套）。**这条轨不做推断**，所以这里也没有任何「反推」逻辑：
     只画读者亲手标的状态。
     -------------------------------------------------------------------------- */

  function storySpans() {
    return document.querySelectorAll("[data-chapter]");
  }

  function syncStoryRow(sp, chid) {
    var st = chid ? api.chapterState(chid) : "";
    syncStateSeg(sp.querySelector(".tk-qstate"), st);
    var tr = sp.closest ? sp.closest("tr") : null;
    if (tr) {
      tr.classList.toggle("tk-qdone", st === "done");
      tr.classList.toggle("tk-qinhand", st === "inhand");
    }
  }

  function decorateStory() {
    var sps = storySpans();
    for (var i = 0; i < sps.length; i++) {
      var sp = sps[i];
      var chid = sp.getAttribute("data-chapter");
      if (!chid) continue;
      if (!sp.querySelector(".tk-qstate")) sp.appendChild(makeChapterSelect(chid));
      syncStoryRow(sp, chid);
    }
  }

  /* --------------------------------------------------------------------------
     进度模式切换条（只出现在任务页与总览页）
     -------------------------------------------------------------------------- */

  /* 站点根 URL：从**本脚本自己的 src** 反推。
     比从页头 logo 反推更直接，也不受页面层级影响 —— 站点部署在子路径下
     （本站是 /tarkov-encyclopedia/），硬编码绝对路径会 404。 */
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
    /* 剧情章节页：数的是章节，不数任务 —— 查询位置相同、口径不同，必须在
       这里分开，否则页面从任务页切到剧情页时数字会突然从「任务」变成「章节」
       却看不出换过（同一条状态条在两页给两个含义的数）。 */
    if (storySpans().length && mf && mf.storyline && (mf.storyline.list || []).length) {
      var c = api.storyCounts(mf.storyline.list);
      return "章节：已完成 " + c.done + " · 进行中 " + c.inhand + " / 共 " + c.total;
    }
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
    buildStatusStrip(bar);
    return bar;
  }

  /* 常驻状态条（2026-10-07 新增）
     读者反馈「任务状态总览也不是在最醒目的地方」。原先总览是**第一个分页**，
     要先点进去才看得到；而分页切换后它就消失了 —— 改任务状态时**看不到全局**，
     只能来回切页。做法（参考 tarkovkappa 的 header progress）：
     把「完成 / 进行中 / 未标记」三个数 + 一条分段条**常驻在控制条里**，
     任何分页都在、任何时候都能扫一眼。
     数据来源与总览完全同源（TP.data()），不引入第二套口径。 */
  function buildStatusStrip(bar) {
    var host = document.getElementById("tk-statusbar");
    if (!host) return;
    var md = api.data();
    var md2 = md.modes[md.mode] || {};
    var explicit = md2.quests || {};
    var inhand = md2.inhand || {};
    var total = (window.TARKOV_PROGRESS_MANIFEST || {}).total || 0;

    var ids = Object.keys(explicit);
    var inhandIds = Object.keys(inhand);
    /* 手动 + 进行中 = 已触碰的量。这里**不把「进行中」算进完成** ——
       那是总览「手动 / 推断」那套更细的口径，本条只要一个扫读用的粗数。 */
    var touched = {};
    for (var i = 0; i < ids.length; i++) touched[ids[i]] = 1;
    for (var j = 0; j < inhandIds.length; j++) touched[inhandIds[j]] = 1;
    var doneN = 0;
    for (var dId in explicit) {
      if (api.taskState(dId) === "done") doneN++;
    }

    host.textContent = "";
    var strip = document.createElement("div");
    strip.className = "tk-strip";

    var lead = document.createElement("div");
    lead.className = "tk-strip__lead";
    var big = document.createElement("b");
    big.textContent = doneN;
    lead.appendChild(big);
    var cap = document.createElement("span");
    cap.textContent = " / " + total + " 已完成";
    lead.appendChild(cap);
    strip.appendChild(lead);

    var bar2 = document.createElement("div");
    bar2.className = "tk-strip__bar";
    bar2.setAttribute("role", "img");
    bar2.setAttribute("aria-label", "已完成 " + doneN + " / " + total + "，进行中 " + inhandIds.length
      + "，未标记 " + Math.max(0, total - Object.keys(touched).length));
    [
      ["done", doneN], ["inhand", inhandIds.length],
      ["rest", Math.max(0, total - Object.keys(touched).length)]
    ].forEach(function (pair) {
      var seg = document.createElement("i");
      seg.className = "tk-strip__seg tk-strip__seg--" + pair[0];
      seg.style.width = (total ? (pair[1] / total * 100) : 0) + "%";
      if (!pair[1]) seg.style.display = "none";
      bar2.appendChild(seg);
    });
    strip.appendChild(bar2);

    var lg = document.createElement("div");
    lg.className = "tk-strip__lg";
    [
      ["done", "已完成 " + doneN],
      ["inhand", "进行中 " + inhandIds.length],
      ["rest", "未标记 " + Math.max(0, total - Object.keys(touched).length)]
    ].forEach(function (pair) {
      var sp = document.createElement("span");
      sp.className = "tk-strip__lgi";
      var dot = document.createElement("i");
      dot.className = "tk-strip__dot tk-strip__dot--" + pair[0];
      sp.appendChild(dot);
      sp.appendChild(document.createTextNode(pair[1]));
      lg.appendChild(sp);
    });
    strip.appendChild(lg);

    host.appendChild(strip);
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

  /* ⚠️ **`el()` 在全文件只定义一处** —— 在下面「小工具（核心与看板共用）」那一节。
     这里原本还有一份**逐字相同**的副本（2026-10-12 删）：同一作用域里函数声明会
     互相覆盖、**后定义者胜**，所以那份是死代码 —— 而它的害处不是多占几行，是
     **改了它却不生效**。要加公共小工具请加到那一节，不要就地再定义一份。 */

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

    /* --------------------------------------------------------------------------
     小工具（核心与看板共用）
     -------------------------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* --------------------------------------------------------------------------
     行内强调渲染（`**重点**`）
     --------------------------------------------------------------------------
     背景：看板与日志同步的若干说明文案当初把 `**重点**` 直接写进了字符串、
     交给 el() 的 textContent —— 而 **textContent 不解析 Markdown**，于是星号
     原样显示在页面上（2026-10-12 全站实测 11 处；`progress-manifest.js` 里
     生成的 `note` 也带着同样的标记）。

     为什么不改用 innerHTML：**全站刻意不用 innerHTML**（progress-boards.js
     里一个都没有，唯一例外是别处的 `textContent` 写法）。这里也不破例 ——
     本函数只产「文本节点 + `<b>` 元素」，即便数据里混进 HTML，也只会被显示成
     字面文字，**没有 XSS 面**。这一点是刻意保留的性质，不要为了少写几行改成 innerHTML。

     ⚠️ 与 quest-detail.js 的 `rich()` **不是同一个东西，别合并**：
        · `rich()` 多解析一层 `[[名字|id]]`（物品名 → 图鉴链接），只在任务详情页用；
        · 本函数只认 `**`，供看板 / 日志同步这类纯文案场景用。
        两者共有的只有「`**` = 粗体」这一条规则。

     ⚠️ 标记数为奇数时（`a**b`）**不报错、按最朴素的方式降级**：最后一段照样
        当粗体处理，星号被吃掉而不是留在页面上。宁可少一段粗体，也不要让星号露出来。
     -------------------------------------------------------------------------- */
  function richText(text) {
    var frag = document.createDocumentFragment();
    var parts = String(text === undefined || text === null ? "" : text).split("**");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      frag.appendChild(i % 2 === 1
        ? el("b", null, parts[i])
        : document.createTextNode(parts[i]));
    }
    return frag;
  }

  /* 建元素并塞入 richText 的内容 —— 等价于 `el(tag, cls, text)`，但会渲染 `**`。 */
  function richEl(tag, cls, text) {
    var n = el(tag, cls);
    n.appendChild(richText(text));
    return n;
  }

  /* 某个外部脚本没载进来时给一句提示，而不是留一片空白。
     站点在搜索索引上已有同样的做法（见 search-ready.js），话术保持一致。 */
  function notReady(what) {
    return el("p", "tk-board__notready",
      what + "没有载入成功（可能是网络中断或脚本被拦截）。"
      + "本页其余说明不受影响；刷新一次通常即可恢复。");
  }

  /* --------------------------------------------------------------------------
     通用惰性加载器

     本站有若干「只有某一页用得到」的大文件（任务树 63 KB、任务明细分块、
     看板渲染 40+ KB）。把它们塞进 extra_javascript 等于让 118 个页面都多背一份，
     所以一律按需注入 —— 用同一个加载器，避免三处各写一套。
     -------------------------------------------------------------------------- */

  function loadScript(file, globalKeys, cb) {
    var keys = [].concat(globalKeys || []);
    var i;
    var ready = true;
    for (i = 0; i < keys.length; i++) {
      if (!window[keys[i]]) { ready = false; break; }
    }
    if (ready) { cb(true); return; }
    var url = siteRoot() + "javascripts/" + file;
    if (!url || url.indexOf("javascripts/") === 0) { cb(false); return; }
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    sc.onload = function () { if (!done) { done = true; cb(true); } };
    sc.onerror = function () { if (!done) { done = true; cb(false); } };
    document.head.appendChild(sc);
  }

  /* --------------------------------------------------------------------------
     看板模块（「我的进度」页的总览 / 任务 / 依赖树 / 物品 / 收藏家 / 藏身处 / 剧情章节 / 管理各块）
     -------------------------------------------------------------------------- */

  var BOARD_IDS = ["tk-board-overview", "tk-progress-board", "tk-board-tree", "tk-board-items", "tk-board-collector", "tk-board-hideout", "tk-board-story", "tk-board-ops"];
  var boardsState = 0;   // 0 未开始 / 1 加载中 / 2 就绪 / -1 失败
  var boardsCbs = [];

  function boardMounts() {
    var found = [];
    for (var i = 0; i < BOARD_IDS.length; i++) {
      var host = document.getElementById(BOARD_IDS[i]);
      if (host) found.push(host);
    }
    return found;
  }

  function loadBoards(cb) {
    if (window.TarkovProgressBoards) { cb(window.TarkovProgressBoards); return; }
    if (boardsState === -1) { cb(null); return; }
    boardsCbs.push(cb);
    if (boardsState === 1) return;
    boardsState = 1;
    loadScript("progress-boards.js", ["TarkovProgressBoards"], function (ok) {
      boardsState = ok && window.TarkovProgressBoards ? 2 : -1;
      var cbs = boardsCbs;
      boardsCbs = [];
      for (var i = 0; i < cbs.length; i++) cbs[i](window.TarkovProgressBoards || null);
    });
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  function render() {
    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;

    var mounts = boardMounts();
    var hasQuests = !!document.querySelector("h3[data-qid]");
    var hasStory = storySpans().length > 0;
    if (!mounts.length && !hasQuests && !hasStory) return;   // 其余 100+ 个页面完全不介入

    ensureMigrated();

    /* 每次换页都要重挂：instant 导航会把 .md-content__inner 整块换掉，
       上一页的节点已经不在文档里了。 */
    mountBar();
    if (hasQuests) decorate();
    if (hasStory) decorateStory();

    if (!mounts.length) return;
    for (var i = 0; i < mounts.length; i++) {
      if (!mounts[i].textContent || !mounts[i].firstElementChild) {
        mounts[i].appendChild(el("p", "tk-board__loading", "正在载入看板…"));
      }
    }
    loadBoards(function (mod) {
      if (!mod) {
        for (var j = 0; j < mounts.length; j++) {
          mounts[j].textContent = "";
          mounts[j].appendChild(notReady("进度看板"));
        }
        return;
      }
      mod.render(mounts);
    });
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

    /* 剧情章节页的行状态也要跟着每次写操作重画（含跨标签页同步）。 */
    var sps = storySpans();
    for (var k = 0; k < sps.length; k++) {
      syncStoryRow(sps[k], sps[k].getAttribute("data-chapter"));
    }

    var bar = document.querySelector(".tk-pgbar");
    if (bar) syncBar(bar);

    if (window.TarkovProgressBoards) window.TarkovProgressBoards.sync();
  }

  api.subscribe(repaint);

  /* 多标签页同步：别的标签页写了同一个键时，本页的显示会陈旧。
     只重画显示，不重新读入（数据本身没丢）。 */
  window.addEventListener("storage", function (e) {
    if (e && e.key && e.key !== STORE_KEY) return;
    repaint();
  });

  /* 给惰性模块用的小工具。命名带下划线：**不是公开 API**，
     只是同一个脚本族之间的共享件（看板模块要用它们，但又不能各写一份）。 */
  api._ui = {
    el: el,
    richText: richText,
    richEl: richEl,
    notReady: notReady,
    loadScript: loadScript,
    makeStateSelect: makeStateSelect,
    makeChapterSelect: makeChapterSelect,
    syncStateSeg: syncStateSeg,
    questUrl: questUrl,
    siteRoot: siteRoot,
  };

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();

/* ==== 源文件：quest-needs.js ==== */
/* ==========================================================================
   物品需求 · 共享判定（物品 → 任务，且**读进度**）
   --------------------------------------------------------------------------
   2026-10-17 之前，`quest-items.js` 与 `catalog-item.js` 各写一套「要留 / 不留」，
   判据只有 `rec.n > 0`（被几个任务需要），**完全不看任务做没做**。结果：
   一个已经清完 500 个任务的玩家，打开物品反查仍然满屏「要留」。

   这个模块把判定收成一份，两个消费方都调它：
     · `quest-items.js`  —— 物品反查页
     · `catalog-item.js` —— 物品图鉴单件页

   数据形状（`items_index.json` 的 `keep`）：
     [[任务名, 任务id 或 null], …]
   `null` = 站内重名任务（10 个名字对多个 id），生成器故意不给 id ——
   硬指会指到另一个任务上，所以这类**只计数、不判完成**，宁可保守。

   进度 API 由 progress.js 暴露（全站 extra_javascript 已加载）：
     TP.taskState(qid) → "done" | "inhand" | ""
   没有进度 API / 没有记录时，退回旧行为（「要留」），不凭空说「可出」。
   ========================================================================== */
(function () {
  "use strict";

  function TP() {
    return window.TarkovProgress || null;
  }

  function stateOf(qid) {
    var p = TP();
    if (!p || !qid || typeof p.taskState !== "function") return "";
    try { return p.taskState(qid) || ""; } catch (e) { return ""; }
  }

  /* 把 keep 的 [名字, id] 对展开成带状态的条目。
     `qid` 为空（重名任务）时 state = "unknown" —— 不把它算成已完成，
     否则「可出」会建立在一个没核实的任务上。 */
  function listOf(rec) {
    var keep = (rec && rec.keep) || [];
    return keep.map(function (x) {
      var name = Array.isArray(x) ? x[0] : String(x);
      var qid = Array.isArray(x) ? x[1] : null;
      return {
        name: name || "",
        qid: qid || "",
        state: qid ? stateOf(qid) : "unknown",
      };
    });
  }

  /* 藏身处需求（2026-10-27 新增）。
     数据形状（`items_index.json` 的 `h`）：
       [[模块名, 等级, 数量, fir(0/1)], …]
     `h` 只在有需求时才存在 —— 900 个物品里 119 个有，空数组会白占 5 KB。
     缺失时 `rec.h || []` 兜住，不改变「任务需求」的任何既有判定。 */
  function hideoutOf(rec) {
    var h = (rec && rec.h) || [];
    if (!h.length) return [];
    return h.map(function (x) {
      return {
        station: x[0] || "",
        level: x[1] || 0,
        count: x[2] || 1,
        fir: !!x[3],
      };
    });
  }

  /* 返回：
       cls   keep | partial | sell | hold | unknown
       text  要留 / 还需 N 个任务 / 任务已清 · 可出 / 藏身处要 · 留 / …
       total / done / inhand / remain / items / noProgress
       hList / hStations / hFir
     `remain` 包含「重名未知」的条目 —— 保守，不把未知算成已完成。

     ⚠️ 三条文案的边界（2026-10-27 加藏身处后重排，改任何一条都要同步
        `quests/item-lookup.md` 的判定表，否则页面说的和这里做的不一致）：
        · 任务全清 + 藏身处要 → 「任务已清 · 藏身处还要」（**不能说「可出」**）
        · 任务不要 + 藏身处要 → 「藏身处要 · 留」
        · 两者都不要         → 「任务与藏身处都不需要」（**不能说「任务里不需要」**，
          读者会读成「那可以出」） */
  function verdict(rec) {
    var items = listOf(rec);
    var total = items.length;
    var hlist = hideoutOf(rec);
    var hStations = [];
    hlist.forEach(function (x) {
      if (x.station && hStations.indexOf(x.station) < 0) hStations.push(x.station);
    });
    var hFir = hlist.some(function (x) { return x.fir; });
    var hx = { hList: hlist, hStations: hStations, hFir: hFir };

    function ret(o) {
      o.hList = hx.hList; o.hStations = hx.hStations; o.hFir = hx.hFir;
      return o;
    }

    if (!total) {
      if (hlist.length) {
        return ret({ cls: "hold", text: "藏身处要 · 留", total: 0, done: 0,
                     inhand: 0, remain: 0, items: items, noProgress: false });
      }
      return ret({ cls: "unknown", text: "任务与藏身处都不需要", total: 0,
                   done: 0, inhand: 0, remain: 0, items: items, noProgress: false });
    }
    var known = items.filter(function (x) { return !!x.qid; });
    if (!known.length) {
      return ret({ cls: "keep", text: "要留", total: total, done: 0,
                   inhand: 0, remain: total, items: items, noProgress: true });
    }
    var done = known.filter(function (x) { return x.state === "done"; }).length;
    var inhand = known.filter(function (x) { return x.state === "inhand"; }).length;
    var remain = total - done;
    if (remain === 0) {
      if (hlist.length) {
        return ret({ cls: "hold", text: "任务已清 · 藏身处还要", total: total,
                     done: done, inhand: inhand, remain: 0, items: items,
                     noProgress: false });
      }
      return ret({ cls: "sell", text: "任务已清 · 可出", total: total, done: done,
                   inhand: inhand, remain: 0, items: items, noProgress: false });
    }
    if (done || inhand) {
      return ret({ cls: "partial", text: "还需 " + remain + " 个任务", total: total,
                   done: done, inhand: inhand, remain: remain, items: items,
                   noProgress: false });
    }
    return ret({ cls: "keep", text: "要留", total: total, done: 0, inhand: 0,
                 remain: remain, items: items, noProgress: false });
  }

  window.TKQuestNeeds = {
    verdict: verdict,
    listOf: listOf,
    stateOf: stateOf,
    hideoutOf: hideoutOf,
  };
})();

/* ==== 源文件：table-sticky.js ==== */
/* ==========================================================================
   长表表头吸顶（2026-10-18）
   --------------------------------------------------------------------------
   问题（实测，不是推测）：全站 39 个页面有 ≥40 行的表，最长 338 行
   （`catalog/containers/`）、表体 13,086px。表头滚出视口之后，读者要靠记忆
   分辨「伤害 / 穿深 / 甲伤」这些只差一个字的列 —— 这是本站最高频的查阅面。

   为什么不用 CSS `position: sticky`（试过，两条路都堵死）：
     · 表的横向滚动容器是 `.md-typeset__table`（extra.css 里明确只此一层），
       它同时就是 sticky 的参照系；而它的高度等于内容高度，**永远不会自己
       纵向滚**，所以表头的 sticky 从生效到结束都停在原地，等于没有。
     · 改成给容器封 78vh 让它自己滚：实测 338 行的表被塞进 702px 的盒子，
       读者滚过 700px 后以为表结束了，**后 300 多行就这样被藏起来** —— 比没有
       表头更糟，直接放弃。

   做法：一条**复用**的固定表头栏（position: fixed），当某张表的表头滑到页头
   下沿之上、且表还没结束时出现；列宽逐列从真实表头量出来再用 fixed 布局钉住，
   横向滚动时整栏跟着 `.md-typeset__table` 的 scrollLeft 平移。

   只对 ≥15 行的表生效：短表本来就整张在屏内，多一条栏只是噪音。
   ========================================================================== */
(function () {
  "use strict";

  /* instant 换页会重放脚本，装一次就够 */
  if (window.__tkTableStickyReady) return;
  window.__tkTableStickyReady = true;

  var MIN_ROWS = 15;
  var BAR_H = 34;          // 表头栏高度（约等于 th 行高，用于「表还没结束」的判定）
  var bar = null;          // 复用的固定栏
  var cur = null;          // 当前激活的表（换表才重建）
  var items = null;        // [{ table, scroller }]，每帧重收（见 update 里的说明）
  var frame = 0;

  function headerBottom() {
    var h = document.querySelector(".md-header");
    if (!h) return 0;
    var r = h.getBoundingClientRect();
    /* 页头隐藏（translateY 出去）时 bottom 会为负，不能把栏顶到屏幕外 */
    return Math.max(0, r.bottom);
  }

  function scrollerOf(t) {
    var p = t.parentElement;
    while (p && p !== document.body) {
      var ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") return p;
      p = p.parentElement;
    }
    return null;
  }

  function collect() {
    items = [];
    var tables = document.querySelectorAll(".md-typeset table");
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (!t.tHead || t.rows.length < MIN_ROWS) continue;
      var sc = scrollerOf(t);
      if (!sc) continue;
      items.push({ table: t, scroller: sc });
    }
  }

  function ensureBar() {
    /* instant 换页可能把整棵 body 换掉：挂在 body 上的栏会变成游离节点，
       继续往游离节点上写 style 等于什么都没做，必须重建并重新挂载。 */
    if (bar && !bar.isConnected) bar = null;
    if (bar) return bar;
    bar = document.createElement("div");
    bar.className = "tk-thead-float";
    bar.setAttribute("aria-hidden", "true");
    bar.inert = true;              // 克隆出来的表头不该被 Tab 聚焦第二次
    bar.appendChild(document.createElement("table"));
    document.body.appendChild(bar);
    return bar;
  }

  /* 逐列量宽再钉死：clone 里只有表头、没有表体，自动布局会按表头文字重算列宽，
     结果和真表对不齐（横向滚到第 8 列时就会错位）。 */
  function rebuild(entry) {
    var t = entry.table;
    var headRow = t.tHead.rows[0];
    var ths = headRow.cells;

    var box = ensureBar();
    var clone = document.createElement("table");
    clone.style.tableLayout = "fixed";
    var total = 0;
    for (var i = 0; i < ths.length; i++) total += ths[i].getBoundingClientRect().width;
    clone.style.width = total + "px";

    var thead = document.createElement("thead");
    var tr = document.createElement("tr");
    for (var j = 0; j < ths.length; j++) {
      var th = ths[j].cloneNode(true);
      /* 复制出来的元素不能带 id：同一 id 在文档里出现两次，锚点与搜索都会错 */
      th.removeAttribute("id");
      var inner = th.querySelectorAll("[id]");
      for (var k = 0; k < inner.length; k++) inner[k].removeAttribute("id");
      th.style.width = ths[j].getBoundingClientRect().width + "px";
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    clone.appendChild(thead);

    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(clone);
    cur = entry;
  }

  function place(entry) {
    var sc = entry.scroller;
    var r = sc.getBoundingClientRect();
    var box = ensureBar();
    box.style.top = headerBottom() + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.firstChild.style.transform = "translateX(" + (-sc.scrollLeft) + "px)";
  }

  function update() {
    frame = 0;
    /* ⚠️ 表清单**每帧重收**（2026-10-23 改）。原来按 path 缓存，两个坑：
       ① 脚本的第一遍跑在正文挂载之前 —— 实测首帧 items=0，第二帧只收到 2 张
          （页面上有 3 张合格表），且顺序错位，第一张长表根本没进清单；
       ② instant 换页会把正文整块换掉，旧表和它的滚动容器一起游离，
          rect 恒为 0，`r.bottom > hb + BAR_H` 永远不成立。
       两种情况下整页一条栏都不出，要等一次 resize（onResize 清空 items）才恢复 ——
       读者看到的现象是「这个功能不存在」。

       代价：一次 querySelectorAll + N 次 rows.length。实测 4 张表 < 0.05 ms，
       而 update 已经被 rAF 节流到每帧最多一次，比一次布局便宜。 */
    collect();

    var hb = headerBottom();
    var active = null;
    for (var i = 0; i < items.length; i++) {
      var r = items[i].scroller.getBoundingClientRect();
      /* 表头已滑到页头下沿之上，且表体还没整个走完 */
      if (r.top < hb - 1 && r.bottom > hb + BAR_H) { active = items[i]; break; }
    }

    if (!active) {
      if (bar) bar.classList.remove("is-on");
      cur = null;
      return;
    }
    /* 比较 table 元素本身，不能比较 entry：每帧 collect 出来的都是新对象，
       按对象比会每帧重建克隆表头（10 次/秒的无谓 DOM 操作）。 */
    if (!cur || cur.table !== active.table) rebuild(active);
    place(active);
    bar.classList.add("is-on");
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(update);
  }

  function onResize() {
    /* 列宽随视口变化：让下一帧按新表头重建 */
    cur = null;
    if (bar) bar.classList.remove("is-on");
    items = null;
    onScroll();
  }

  /* scroll 不冒泡，但捕获阶段能收到任何元素（页头、横向滚动容器）的滚动 */
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onResize, { passive: true });

  onScroll();
})();

/* ==== 源文件：toolbox.js ==== */
/* ==========================================================================
   工具箱入口（界面与结构升级）
   --------------------------------------------------------------------------
   要解决的问题：站点的互动能力已经很完整 ——
     · 「我的进度」：任务 / 剧情章节 / 物品 / 藏身处四条轨，任务按前置反推
     · 「任务图鉴」：504 个任务逐条 + 按条件筛选器
     · 「赛季特质模拟器」：34 张卡的点数市场与互斥校验
     · 「物品图鉴」：4,979 件全量物品，检索 / 筛选 / 商人价
     · 「配方速查」：214 条制作 + 855 条交换配方
     · 「术语速查」：全称 / 缩写 / 社区俗称三向可查
     · 「交互地图」：矢量底图 + 任务目标区域，读「我的进度」筛「只看未完成」
     · 「护甲穿透计算器」：穿深 × 甲等 × 耐久 → 穿透概率与临界耐久（页内）
     · 「跳蚤手续费计算器」：手续费、到手价与费率最低点（页内）
     · 「比特币矿场计算器」：出币速率、日产与回本周期（页内）
   但这些工具此前**只在自己那一页出现** —— 首页只提了其中三个，其余一百多页
   更是没有任何入口。也就是说：工具是有的，但事实上被埋住了。

   本脚本负责四处「用工具」的入口：

     1. **全站工具菜单**（页头，任意页 ≤1 次点击到任一工具） ← 本次升级为下拉菜单
     2. 首页「读 / 用」双轨卡的数字回填（HTML 在 content/README.md 里手写）
     3. 首页「工具箱」区块的数字回填
     4. 任务图鉴工具条（quests/index.md 的 #tk-toolstrip 挂载点）

   三条边界：

     · **数字口径只有一处来源**：直接调 progress.js 暴露的
       window.TarkovProgress.count()（＝当前模式下**手动标过**的已完成数，
       不含推断 —— 与进度页顶栏「已标记 N / 总数」同一口径），
       不自己解析 localStorage：两处各读一遍必然漂。API 缺失（脚本被拦截 /
       隐私模式禁用 localStorage）时保留静态文案，不报错、不空白。

     · **工具清单里不写「共 N 条」这类计数**。站点首页的规模数字由
       scripts/gen_home_stats.py 生成、并由 check_entries.py 复算比对，
       是**唯一一处**；在这里再写一遍就会出现第二个会漂的数字源。
       菜单里只描述「这个工具是干什么的」。

     · **不介入其余页面**：只有检测到挂载点或首页元素时才渲染内容；
       页头菜单是唯一全站元素（与面包屑、搜索提示同类）。

   ⚠️ **菜单必须每次换页自动收起。** Material 的 instant 导航在有些情况下
   会**保留页头节点**（不整块替换），于是「在本页展开菜单 → 点链接跳走 →
   新页面菜单还是展开的」。所以 render() 第一件事是 closeMenu()。

   接入方式与站内其他脚本一致：挂 Material 的 document$，instant 换页后
   重新执行；页头节点可能被整块替换，所以每次都重挂、并先查重。
   ========================================================================== */

(function () {
  "use strict";

  var MENU = "tk-toolmenu";

  /* 工具清单（唯一一份，菜单与页内提示共用）。
     ⚠️ 这里**不写计数** —— 见文件头「三条边界」第二条。
     ⚠️ 这里也**不放图标**。第一版给每个工具配了一个几何符号当标记列，
     在 12px 下它们退化成一排看不出区别的小方块；而站内已经有一张
     「图标语义表」（content/template.md），新增字形要同一批回表登记 ——
     为了一个装饰性标记去走那道流程不划算。工具箱的语义由页头那个 🧰 承担，
     行内只留「粗体名称 + 灰色说明」，反而更好扫。 */
  var TOOLS = [
    { slug: "quests/progress/", name: "我的进度", desc: "任务 · 剧情 · 物品 · 藏身处，任务按前置反推" },
    { slug: "quests/", name: "任务图鉴", desc: "逐条要求与奖励，可按条件筛选" },
    { slug: "maps/", name: "交互地图", desc: "矢量底图 + 任务目标区域，可读「我的进度」筛只看未完成" },
    { slug: "entries/season-modifiers/", name: "赛季特质模拟器", desc: "点选构筑，互斥与点数当场校验" },
    { slug: "catalog/", name: "物品图鉴", desc: "全站物品检索、属性与商人价" },
    { slug: "docs/recipes/", name: "配方速查", desc: "制作与交换配方查询" },
    { slug: "docs/glossary/", name: "术语与黑话", desc: "全称 / 缩写 / 社区俗称三向查" },
    { slug: "docs/mechanics/", name: "机制速查表", desc: "一页看懂所有核心规则" },
    /* 两个计算器是**页内工具**（挂在条目里，不是独立页），所以这里带锚点 ——
       带锚点进页面会自动滚到工具那一段，不必让读者再找一遍。 */
    { slug: "entries/ballistics/#pen-calc", name: "护甲穿透计算器", desc: "穿深 × 甲等 × 耐久 → 穿透概率与临界耐久" },
    { slug: "entries/flea-pricing/#flea-calc", name: "跳蚤手续费计算器", desc: "手续费、到手价与费率最低点" },
    { slug: "entries/hideout-modules/#tk-mining-calc", name: "比特币矿场计算器", desc: "出币速率、日产与回本周期" }
  ];

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

  /* ⚠️ **必须在这里、也就是脚本执行时刻算一次并公布给全站**。
     这一刻是首次整页加载，<script> 的 .src 一定解析正确；
     换页之后再去查同一个标签就会拿到错路径（原因见上面 siteRoot 的注释）。
     其它脚本的 siteRoot() 都会优先读 window.__tkRoot。 */
  window.__tkRoot = siteRoot();

  function boardUrl() { return siteRoot() + "quests/progress/"; }

  /* 进度摘要；API 或数据缺失时返回空串（调用方保留静态文案）。 */
  function statText() {
    var api = window.TarkovProgress;
    if (!api || typeof api.count !== "function") return "";
    var done;
    try { done = api.count(); } catch (e) { return ""; }
    if (!done) return "";
    /* 任务总数**不写死**：优先 manifest，其次任务图（都是生成物），
       都没有就只报已记录数 —— 写死一个数会在下次重抓时悄悄漂。 */
    var total = 0;
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    var g = window.TARKOV_QUEST_GRAPH;
    if (mf && mf.total) total = mf.total;
    else if (g && g.total) total = g.total;
    return total ? "已记录 " + done + " / " + total + " 个任务"
                 : "已记录 " + done + " 个任务";
  }

  /* --------------------------------------------------------------------------
     1. 全站工具菜单（页头）
     -------------------------------------------------------------------------- */

  var menuBtn = null;
  var menuPanel = null;

  function menuIsOpen() {
    return !!(menuPanel && !menuPanel.hidden);
  }

  function closeMenu() {
    if (!menuPanel || menuPanel.hidden) {
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
      return;
    }
    menuPanel.hidden = true;
    if (menuBtn) {
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.classList.remove(MENU + "__btn--open");
    }
  }

  function openMenu() {
    if (!menuPanel) return;
    menuPanel.hidden = false;
    if (menuBtn) {
      menuBtn.setAttribute("aria-expanded", "true");
      menuBtn.classList.add(MENU + "__btn--open");
    }
  }

  /* 只在第一次安装全局监听（instant 换页会重放脚本，不查重就会叠加监听器）。 */
  var listenersInstalled = false;
  function installGlobalListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    document.addEventListener("click", function (e) {
      if (!menuIsOpen()) return;
      var host = document.querySelector("." + MENU);
      if (host && e.target && host.contains(e.target)) return;
      closeMenu();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuIsOpen()) {
        closeMenu();
        if (menuBtn && typeof menuBtn.focus === "function") menuBtn.focus();
      }
    });

    /* 视口变化时收起：窄屏下面板是接近全宽的浮层，转屏后位置会错 */
    window.addEventListener("resize", closeMenu);
  }

  function mountHeader() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner || inner.querySelector("." + MENU)) return;
    if (inner.querySelector(".tk-headtool")) return;   // 旧版节点（换页缓存），不重复挂

    installGlobalListeners();

    var host = document.createElement("div");
    host.className = MENU;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = MENU + "__btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", MENU + "-panel");
    btn.setAttribute("aria-label", "工具箱：我的进度、任务图鉴、模拟器、图鉴、配方、术语与三个计算器");
    btn.title = "工具箱（本地保存，无需登录）";

    var ic = document.createElement("span");
    ic.className = MENU + "__ic";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = "🧰";
    btn.appendChild(ic);

    var tx = document.createElement("span");
    tx.className = MENU + "__tx";
    tx.textContent = "工具箱";
    btn.appendChild(tx);

    var car = document.createElement("span");
    car.className = MENU + "__caret";
    car.setAttribute("aria-hidden", "true");
    car.textContent = "▾";
    btn.appendChild(car);

    host.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = MENU + "__panel";
    panel.id = MENU + "-panel";
    panel.hidden = true;

    var head = document.createElement("div");
    head.className = MENU + "__head";
    var hl = document.createElement("b");
    hl.textContent = "工具箱";
    head.appendChild(hl);
    var hb = document.createElement("span");
    hb.className = MENU + "__badge";
    var st = statText();
    hb.textContent = st || "离线可用 · 无需登录";
    head.appendChild(hb);
    panel.appendChild(head);

    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      var a = document.createElement("a");
      a.className = MENU + "__item";
      a.href = siteRoot() + t.slug;
      var at = document.createElement("span");
      at.className = MENU + "__name";
      at.textContent = t.name;
      a.appendChild(at);
      var ad = document.createElement("span");
      ad.className = MENU + "__desc";
      ad.textContent = t.desc;
      a.appendChild(ad);
      panel.appendChild(a);
    }

    host.appendChild(panel);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menuIsOpen()) closeMenu(); else openMenu();
    });

    /* 插在搜索之前：页头右侧从右往左是 主题切换 / 搜索 / 徽标，
       菜单贴在搜索左边 = 视觉上「行动入口都在这一簇」。 */
    var search = inner.querySelector(".md-search");
    if (search) inner.insertBefore(host, search);
    else inner.appendChild(host);

    menuBtn = btn;
    menuPanel = panel;
  }

  /* --------------------------------------------------------------------------
     2/3. 首页：把进度数字填进 [data-tk-toolstat]
        （无数据时保留 HTML 里的静态文案，不替换成「已记录 0」——
          对第一次来的人，「任务 · 剧情 · 物品 · 藏身处」说明这卡是干什么的，
          「已记录 0」什么都不说明。）
     -------------------------------------------------------------------------- */

  function fillHome() {
    var hosts = document.querySelectorAll("[data-tk-toolstat]");
    if (!hosts.length) return;
    var s = statText();
    if (!s) return;
    for (var i = 0; i < hosts.length; i++) hosts[i].textContent = s;
  }

  /* --------------------------------------------------------------------------
     4. 任务图鉴工具条（总览页）
     -------------------------------------------------------------------------- */

  function mountToolstrip() {
    var host = document.getElementById("tk-toolstrip");
    if (!host || host.firstElementChild) return;

    var strip = document.createElement("div");
    strip.className = "tk-toolstrip";

    var ic = document.createElement("span");
    ic.className = "tk-toolstrip__ic";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = "🧰";
    strip.appendChild(ic);

    var tx = document.createElement("span");
    tx.className = "tk-toolstrip__tx";
    var b = document.createElement("b");
    b.textContent = "看任务时顺手记进度：";
    tx.appendChild(b);
    tx.appendChild(document.createTextNode(
      "任务、需求物品与藏身处模块都能勾选，按前置自动反推 —— 进度只存在本机浏览器。"));
    strip.appendChild(tx);

    var s = statText();
    if (s) {
      var stat = document.createElement("span");
      stat.className = "tk-toolstrip__stat";
      stat.textContent = s;
      strip.appendChild(stat);
    }

    var cta = document.createElement("a");
    cta.className = "tk-toolstrip__cta";
    cta.href = boardUrl();
    cta.textContent = "打开我的进度";
    strip.appendChild(cta);

    host.appendChild(strip);
  }

  /* --------------------------------------------------------------------------
     5. 按需注入的页面工具（本体都只在各自那一页加载）
        本文件是全站加载的入口脚本，所以这里只做「发现挂载点 → 注入本体」：
          · 赛季特质模拟器（season-modifiers 页）
          · 配方速查表（docs/recipes 页）
          · 物品图鉴（catalog/ 下的 16 页）
          · 任务筛选器（quests/index 页）
          · 护甲穿透计算器（entries/ballistics 页）
          · 跳蚤手续费计算器（entries/flea-pricing 页）
          · 比特币矿场计算器（entries/hideout-modules 页）
        instant 换页回到这些页面时，本体脚本已在内，它们自己的 document$
        订阅会负责重新挂载。

         ⚠️ **每个工具一个独立的注入标记**。用同一个标记管两个工具，第二个
         就永远不会被注入（一个全局变量只能表示「已注入过一次」）。
     -------------------------------------------------------------------------- */

  function injectScript(file) {
    var url = siteRoot() + "javascripts/" + file;
    if (!url || url.indexOf("javascripts/") === 0) return;
    var sc = document.createElement("script");
    sc.src = url;
    document.head.appendChild(sc);
  }

  var plannerInjected = false;
  var recipesInjected = false;
  var filterInjected = false;
  var itemsInjected = false;
  var catalogInjected = false;
  var itemPageInjected = false;
  var questPageInjected = false;
  var treePageInjected = false;
  var ballisticsCalcInjected = false;
  var fleaCalcInjected = false;
  var miningCalcInjected = false;

  /* ⚠️ **「注入脚本」与「换页后重新挂载」是两件事，不能混为一谈。**
     injectScript 是异步的（新建 <script> 再 appendChild）；而 Material 的
     instant navigation 一次换页会**多次**换入内容。实测（2026-10-10）：
     从 /quests/ 点 💬 跳到 /quests/quest/?id=… 时，quest-detail.js **确实注入了**，
     但它的 boot() 恰好跑在某两次内容换入的**间隙**里 —— 那一刻
     `#tk-quest-page` 还不在 DOM 中，boot() 第一行 `if (!host) return` 直接返回，
     此后**再没有任何人叫它**，页面就永远停在静态占位文案上。

     最坑的是它**一个错都不报**：脚本注入了、脚本也执行了、URL 也对，
     只是内容没渲染 —— 只有量 DOM 才看得出来。

     所以注入过之后，**每次换页都要再叫一次各本体的 boot**。
     本体把入口挂到 `window.__tkBoot*`，这里统一回调（幂等：boot 自己会
     重新读地址参数并重渲染，重复调用没有副作用）。 */
  function remount() {
    if (questPageInjected && document.getElementById("tk-quest-page")
        && typeof window.__tkQuestBoot === "function") {
      window.__tkQuestBoot();
    }
    if (itemPageInjected && document.getElementById("tk-item-page")
        && typeof window.__tkBootItem === "function") {
      window.__tkBootItem();
    }
    /* 任务全景图：注入异步、换页多次 —— 同上面两条，每次换页叫一次 boot
       （幂等：挂载点上的 data-tkMounted 挡第二次渲染）。 */
    if (treePageInjected && document.getElementById("tk-quest-tree")
        && typeof window.__tkBootTree === "function") {
      window.__tkBootTree();
    }
    /* 两个计算器同理：注入是异步的，而 instant 换页会多次换入内容 ——
       注入的时机可能落在两次换入的间隙里，那一刻挂载点还不在 DOM 中。
       两个 boot 都是幂等的（挂载点上的 data-ready 标记挡重复渲染），
       所以每次换页叫一次没有副作用。 */
    if (ballisticsCalcInjected && document.getElementById("tk-ballistics-calc")
        && typeof window.__tkBootBallistics === "function") {
      window.__tkBootBallistics();
    }
    if (fleaCalcInjected && document.getElementById("tk-flea-calc")
        && typeof window.__tkBootFleaFee === "function") {
      window.__tkBootFleaFee();
    }
    if (miningCalcInjected && document.getElementById("tk-mining-calc")
        && typeof window.__tkBootMining === "function") {
      window.__tkBootMining();
    }
  }

  function loadPageTools() {
    if (!plannerInjected && document.getElementById("tk-season-planner")) {
      plannerInjected = true;
      injectScript("season-planner.js");
    }
    if (!recipesInjected && document.getElementById("tk-recipe-browser")) {
      recipesInjected = true;
      injectScript("recipe-browser.js");
    }
    if (!filterInjected && document.getElementById("tk-quest-filter")) {
      filterInjected = true;
      injectScript("quests-filter.js");
    }
    /* 物品反查页：数据文件 124 KB，**只能按需注入**——
       全站 100+ 页每页背 124 KB 是纯浪费，而这一页只用到它一次。
       挂载点有两个（查询区 + 下方需求量表），任一存在就注入。 */
    if (!itemsInjected && (document.getElementById("tk-item-lookup")
                           || document.getElementById("tk-item-table"))) {
      itemsInjected = true;
      injectScript("quest-items.js");
    }
    /* 物品图鉴：catalog-data.js 未压缩 0.74 MB / gzip 约 226 KB，
       全站 130+ 页每页背这个包是纯浪费 —— 只在 /catalog/ 下的 16 页注入。
       **数据文件与本体分两步**：先数据再本体，否则本体读不到 window.TARKOV_CATALOG。 */
    if (!catalogInjected && (document.getElementById("tk-catalog")
                             || document.getElementById("tk-catalog-all")
                             || document.getElementById("tk-catalog-value"))) {
      catalogInjected = true;
      injectScript("catalog-data.js");
      injectScript("catalog.js");
    }
    /* 物品详情页：单次只下 1 片（约 80 KB），但仍然**按需注入** ——
       全站 130+ 页没有理由每页都背这份脚本。
       ⚠️ 它**不需要 catalog-data.js**：分片自包含。所以这里只注入本体。 */
    if (!itemPageInjected && document.getElementById("tk-item-page")) {
      itemPageInjected = true;
      injectScript("catalog-item.js");
    }
    /* 任务详情页：同样按需注入，单次只下 1 片（约 15 KB），自包含。 */
    if (!questPageInjected && document.getElementById("tk-quest-page")) {
      questPageInjected = true;
      injectScript("quest-detail.js");
    }
    /* 任务全景图（quests/tree.md）：本体按需注入；它自己再按需拉数据
       （quest-tree-data.js 44 KB，同 map.js 的 maps-data.js 模式）。 */
    if (!treePageInjected && document.getElementById("tk-quest-tree")) {
      treePageInjected = true;
      injectScript("quest-tree.js");
    }
    /* 两个计算器都是**自包含**的（无数据文件、无网络），所以只注入本体，
       不像图鉴那样要先注入一份数据。体量都在 10 KB 上下。 */
    if (!ballisticsCalcInjected && document.getElementById("tk-ballistics-calc")) {
      ballisticsCalcInjected = true;
      injectScript("ballistics-calc.js");
    }
    if (!fleaCalcInjected && document.getElementById("tk-flea-calc")) {
      fleaCalcInjected = true;
      injectScript("flea-fee-calc.js");
    }
    /* 比特币矿场计算器（藏身处模块详解页）：同样自包含、无数据文件。 */
    if (!miningCalcInjected && document.getElementById("tk-mining-calc")) {
      miningCalcInjected = true;
      injectScript("hideout-mining-calc.js");
    }

    /* ⚠️ **必须放在最后** —— 上面是「第一次见到就注入」，这里是「每次换页
       都再叫一次已注入的本体」。少了这一步，从别的页点进来会白屏（见 remount 的说明）。 */
    remount();
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  function render() {
    /* ⚠️ 先收起菜单：instant 换页有时会保留页头节点，
       不收的话新页面会带着上一页展开的菜单。 */
    closeMenu();
    mountHeader();
    fillHome();
    mountToolstrip();
    loadPageTools();
  }

  /* 两条入口都要。⚠️ 只写 subscribe 的形态在**首次整页加载**时可能错过
     document$ 的第一次通知 —— 于是 /catalog/ 这类「靠 loadPageTools 注入本体」
     的页面在首屏不会被注入。本批实测踩到：分类页的图鉴 UI 不出现，
     而控制台**一个错都不报**（两个 <script> 顺序无保证 + 没有轮询兜底）。 */
  function boot() { render(); }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(boot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

