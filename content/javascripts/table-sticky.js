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
  var items = null;        // [{ table, scroller }]
  var path = "";           // 表清单属于哪一页
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
    /* 本站没有用 Material 的 document$，instant 换页是「重放脚本 + 换 DOM」，
       订阅式钩子不存在；用地址变化来判断该不该重收表清单，够用且无依赖。 */
    /* items 为空也要重收：脚本可能在正文挂载之前就跑了（实测首帧 0 张表，
       而手动 collect() 同一时刻能收到 1 张）——空数组是 truthy，不能只判 null。 */
    if (!items || items.length === 0 || path !== location.pathname) {
      path = location.pathname;
      collect();
    }

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
    if (active !== cur) rebuild(active);
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
