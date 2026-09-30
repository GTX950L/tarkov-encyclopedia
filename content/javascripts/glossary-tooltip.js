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
