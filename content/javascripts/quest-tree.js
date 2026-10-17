/* ==========================================================================
   任务全景图（content/quests/tree.md）—— **惰性模块**（toolbox.js 按需注入）

   504 个任务按 11 位商人分列排布、222 条前置边连起来；数据与布局由
   scripts/gen_quest_tree.py 离线算好（quest-tree-data.js，入库）。
   本文件只负责「画出来 + 交互 + 接进度」。

   与站内其它模块一致的六条做法：
     ① **数据按需加载**：quest-tree-data.js 44 KB，只有本页需要
        （同 map.js 的 maps-data.js 模式；本体注入是 toolbox 管的）。
     ② **进度只读 window.TarkovProgress**；状态判断用「键存在与否」
        （progress.js 的纪律），一次 data() 拿副本、之后纯本地判断 ——
        别在 504 个节点上反复调 taskState()（每次都是 localStorage 读）。
     ③ **写状态只走 TP.setTaskState**，其余概览/地图/进度页靠
        "tarkov:progress" 事件各自刷新 —— 本页也这么做，不另设同步。
     ④ **instant 换页会重放脚本**：window/document 级监听先摘旧再挂新
        （liveRefresh 模式，同 map.js 的 liveFilter）。
     ⑤ **重入查重**：挂载点上的 data-tkMounted 挡第二次渲染。
     ⑥ **失败要显形**：数据加载失败给明确文案，不让「加载中…」挂着。
   ========================================================================== */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  /* 缩放范围：0.22 能让 2740px 宽的画布在 390px 手机上也看到 4~5 列；
     1.6 时卡片字约 19px，是「看清单节点」的舒服上限。 */
  var MIN_SCALE = 0.22, MAX_SCALE = 1.6;

  /* document 级监听只装一次（换页重放脚本时先摘旧再挂新，防累积）。 */
  var bound = false;
  var liveRefresh = null;   // 当前实例的「进度变了」刷新函数
  var liveEsc = null;       // 当前实例的「关闭面板」函数

  function siteRoot() {
    var s =
      document.currentScript ||
      document.querySelector('script[src*="javascripts/quest-tree.js"]');
    if (!s) return "./";
    try {
      return new URL(s.src, location.href).href.replace(/javascripts\/quest-tree\.js.*$/, "");
    } catch (e) {
      return "./";
    }
  }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function sv(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  /* ── 进度快照（一次 data()，之后纯本地判断；同地图页的纪律）── */
  function progressSnap() {
    var TP = window.TarkovProgress;
    if (!TP) return null;
    try {
      var d = TP.data();
      return d.modes[TP.mode()] || null;
    } catch (e) { return null; }
  }
  function stateOf(md, id) {
    if (!md) return "";
    /* ⚠️ 键存在与否 —— 不是值真假（值可能是空字符串，见 progress.js） */
    if (Object.prototype.hasOwnProperty.call(md.quests, id)) return "done";
    if (Object.prototype.hasOwnProperty.call(md.inhand, id)) return "inhand";
    return "";
  }

  function ensureData(cb) {
    if (window.TARKOV_QUEST_TREE) return cb(window.TARKOV_QUEST_TREE);
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/quest-tree-data.js";
    s.onload = function () { cb(window.TARKOV_QUEST_TREE || null); };
    s.onerror = function () { cb(null); };
    document.head.appendChild(s);
  }

  /* ════════════════════════════ 渲染 ════════════════════════════ */

  function render(host, D) {
    host.textContent = "";
    host.classList.add("tk-qt");

    var nodes = [];              // {id, name, col, x, y, lv, flags, el}
    var byId = {};
    var edges = [];              // {a: nodeIdx, b: nodeIdx, path}
    var edgesByNode = {};        // nodeId → [edge...]

    /* ── 控件条 ── */
    var bar = el("div", "tk-qt__bar");
    var input = document.createElement("input");
    input.type = "search";
    input.className = "tk-qt__q";
    input.placeholder = "搜任务名（中文）";
    input.setAttribute("aria-label", "搜索任务");
    bar.appendChild(input);
    var count = el("span", "tk-qt__count");
    count.setAttribute("aria-live", "polite");
    bar.appendChild(count);
    var spacer = el("span", "tk-qt__spacer");
    bar.appendChild(spacer);
    function zbtn(label, txt, fn) {
      var b = el("button", "tk-qt__zbtn", txt);
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", fn);
      bar.appendChild(b);
      return b;
    }
    zbtn("缩小", "−", function () { anchorZoom(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.25); });
    zbtn("放大", "+", function () { anchorZoom(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.25); });
    zbtn("复位视图", "复位", function () { fit(); });
    host.appendChild(bar);

    /* ── 画布与图层 ── */
    var wrap = el("div", "tk-qt__wrap");
    var canvas = el("div", "tk-qt__canvas");
    canvas.style.width = D.W + "px";
    canvas.style.height = D.H + "px";
    var edgeSvg = sv("svg", { class: "tk-qt__edges", width: D.W, height: D.H });
    canvas.appendChild(edgeSvg);
    var nodeLayer = el("div", "tk-qt__nodes");
    canvas.appendChild(nodeLayer);
    wrap.appendChild(canvas);
    host.appendChild(wrap);

    /* 列标题 */
    D.cols.forEach(function (c) {
      var t = el("div", "tk-qt__coltitle", c[1] + " · " + c[3]);
      t.style.left = c[2] + "px";
      t.style.width = D.CARD_W + "px";
      canvas.appendChild(t);
    });

    var frag = document.createDocumentFragment();
    D.nodes.forEach(function (n) {
      var id = n[0], name = n[1], ci = n[2], y = n[3], lv = n[4], flags = n[5];
      var x = D.PAD_X + ci * D.COL_W;
      var d = el("div", "tk-qt__node");
      d.style.left = x + "px";
      d.style.top = y + "px";
      d.style.width = D.CARD_W + "px";
      d.setAttribute("data-id", id);
      /* 线标记用**圆点徽记**（不是左边框色条）—— 左边框要留给状态色
         （完成绿 / 进行中琥珀），两者都占左条会互相盖。 */
      if (flags.indexOf("k") >= 0) {
        var dk = el("span", "tk-qt__dot tk-qt__dot--k");
        dk.title = "Kappa 收藏家线";
        d.appendChild(dk);
      }
      if (flags.indexOf("l") >= 0) {
        var dl = el("span", "tk-qt__dot tk-qt__dot--l");
        dl.title = "Lightkeeper 线";
        d.appendChild(dl);
      }
      var ns = el("span", "tk-qt__n", name);
      d.appendChild(ns);
      if (lv > 0) d.appendChild(el("span", "tk-qt__lv", "Lv." + lv));
      /* 等级徽标进 title，缩放小的时候也能悬停看全名 */
      d.title = name + (lv > 0 ? "（Lv." + lv + "）" : "");
      frag.appendChild(d);
      var rec = { id: id, name: name, col: ci, x: x, y: y, lv: lv, flags: flags, el: d };
      nodes.push(rec);
      byId[id] = rec;
    });
    nodeLayer.appendChild(frag);

    /* ── 边：同列竖线 / 跨列贝塞尔；默认低对比，hover 节点时高亮相关边 ── */
    var edgeFrag = document.createDocumentFragment();
    D.edges.forEach(function (e) {
      var a = byId[e[0]], b = byId[e[1]];
      if (!a || !b) return;
      var ax = a.x + D.CARD_W / 2, ayc = a.y + 28;
      var bx = b.x + D.CARD_W / 2, byc = b.y + 28;
      var d, cls = "tk-qt__edge";
      if (a.col === b.col) {
        /* 同列：走两卡之间的竖线（从上卡下沿到下卡上沿） */
        var y1 = (a.y < b.y) ? a.y + 56 : a.y;
        var y2 = (a.y < b.y) ? b.y : b.y + 56;
        d = "M " + ax + " " + y1 + " L " + bx + " " + y2;
        cls += " tk-qt__edge--same";
      } else {
        var my = (ayc + byc) / 2;
        d = "M " + ax + " " + ayc + " C " + ax + " " + my + ", " + bx + " " + my + ", " + bx + " " + byc;
        cls += " tk-qt__edge--cross";
      }
      var p = sv("path", { d: d, class: cls, "vector-effect": "non-scaling-stroke" });
      edgeFrag.appendChild(p);
      var rec = { a: a, b: b, path: p };
      edges.push(rec);
      (edgesByNode[a.id] || (edgesByNode[a.id] = [])).push(rec);
      (edgesByNode[b.id] || (edgesByNode[b.id] = [])).push(rec);
    });
    edgeSvg.appendChild(edgeFrag);

    /* ── 视图状态 ── */
    var scale = 1, tx = 0, ty = 0;
    function apply() {
      canvas.style.transform =
        "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    }
    function fit() {
      var w = wrap.clientWidth || 800;
      scale = Math.min(1, w / D.W);
      scale = Math.max(MIN_SCALE, scale);
      tx = 0;
      ty = 0;
      apply();
    }
    function anchorZoom(px, py, k) {
      var ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * k));
      if (ns === scale) return;
      /* 锚点（画布内点）缩放前后停在原地：t' = P − (P − t)·(s'/s) */
      tx = px - (px - tx) * (ns / scale);
      ty = py - (py - ty) * (ns / scale);
      scale = ns;
      apply();
    }

    /* ── 平移 + 双指缩放（touch-action: none 由 CSS 给）──
       ⚠️ **点击判定不能挂在 click 事件上**：拖拽用了 setPointerCapture，
       捕获期间指针事件全部重定向到 wrap —— 浏览器随后派发的 click 的
       target 也是 wrap，不是节点本身（实测：物理点击永远开不出面板，
       而脚本 dispatch 的 click 正常）。所以「点节点 / 点空白」在
       pointerup 里用坐标做命中判定（同 map.js 的 elementsFromPoint 思路）。 */
    var drag = null;
    var ptActive = {}, ptPrevDist = 0;
    function ptCount() { var n = 0; for (var k in ptActive) n++; return n; }
    function hitTest(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !el.closest) { closePanel(); return; }
      if (el.closest(".tk-qt__panel")) return;      /* 面板内部的点按不关面板 */
      var nodeEl = el.closest(".tk-qt__node");
      if (nodeEl) openPanel(byId[nodeEl.getAttribute("data-id")]);
      else if (wrap.contains(el)) closePanel();
    }
    wrap.addEventListener("pointerdown", function (e) {
      ptActive[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ptCount() === 2) {
        var ids = Object.keys(ptActive);
        var a = ptActive[ids[0]], b = ptActive[ids[1]];
        ptPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
        wrap.classList.remove("is-dragging");
        return;
      }
      drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false };
      wrap.classList.add("is-dragging");
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    wrap.addEventListener("pointermove", function (e) {
      if (ptActive[e.pointerId]) {
        ptActive[e.pointerId].x = e.clientX;
        ptActive[e.pointerId].y = e.clientY;
      }
      if (ptCount() === 2) {
        var ids = Object.keys(ptActive);
        var a = ptActive[ids[0]], b = ptActive[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (ptPrevDist > 8 && d > 8) {
          var r = wrap.getBoundingClientRect();
          anchorZoom((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / ptPrevDist);
        }
        ptPrevDist = d;
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      apply();
    });
    function endPt(e) {
      delete ptActive[e.pointerId];
      var wasSingle = ptCount() < 2;
      if (ptCount() < 2) ptPrevDist = 0;
      if (drag) {
        var moved = drag.moved;
        drag = null;
        wrap.classList.remove("is-dragging");
        try { wrap.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        /* 无位移的单指抬起 = 点击（在捕获释放之后判定坐标命中） */
        if (!moved && wasSingle) hitTest(e);
      }
    }
    wrap.addEventListener("pointerup", endPt);
    wrap.addEventListener("pointercancel", endPt);
    wrap.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = wrap.getBoundingClientRect();
      anchorZoom(e.clientX - r.left, e.clientY - r.top,
                 e.deltaY > 0 ? 1 / 1.15 : 1.15);
    }, { passive: false });
    /* 自定义事件兜底：Chrome 在双指手势里不派发 wheel，pointer 路线已覆盖；
       这里主要为「触控板双指」保留默认 —— 不额外处理。 */
    window.addEventListener("resize", function () {
      /* 宽度变了：只重算「还没手动缩放过」的初始 fit 是不好判断的，
         所以不重算 —— 只刷新拖拽边界内的一致性。保持用户视图不动。 */
      apply();
    });

    /* ── hover：高亮该节点的全部相关边与邻居 ── */
    function setHover(node, on) {
      var es = edgesByNode[node.id] || [];
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        e.path.classList.toggle("is-hl", on);
        var other = (e.a.id === node.id) ? e.b : e.a;
        other.el.classList.toggle("is-nb", on);
      }
      node.el.classList.toggle("is-hover", on);
    }
    nodes.forEach(function (n) {
      n.el.addEventListener("mouseenter", function () { setHover(n, true); });
      n.el.addEventListener("mouseleave", function () { setHover(n, false); });
    });

    /* ── 详情面板 ── */
    var panel = null;
    function closePanel() {
      if (panel) { panel.remove(); panel = null; }
      nodes.forEach(function (n) { n.el.classList.remove("is-sel"); });
    }
    function openPanel(n) {
      closePanel();
      nodes.forEach(function (x) { x.el.classList.toggle("is-sel", x.id === n.id); });
      panel = el("div", "tk-qt__panel");
      var head = el("div", "tk-qt__phead");
      head.appendChild(el("b", null, n.name));
      var x = el("button", "tk-qt__pclose", "×");
      x.type = "button";
      x.setAttribute("aria-label", "关闭");
      x.addEventListener("click", closePanel);
      head.appendChild(x);
      panel.appendChild(head);
      var meta = el("p", "tk-qt__pmeta",
        D.cols[n.col][1] + (n.lv > 0 ? " · Lv." + n.lv : ""));
      if (n.flags.indexOf("k") >= 0) meta.appendChild(el("i", "tk-qt__pk", "Kappa 线"));
      if (n.flags.indexOf("l") >= 0) meta.appendChild(el("i", "tk-qt__pl", "Lightkeeper 线"));
      panel.appendChild(meta);
      var es = edgesByNode[n.id] || [];
      var up = 0, dn = 0;
      for (var i = 0; i < es.length; i++) {
        if (es[i].b.id === n.id) up++; else dn++;
      }
      panel.appendChild(el("p", "tk-qt__pmeta",
        "前置 " + up + " 个 · 后续 " + dn + " 个（悬停节点看连线）"));

      /* 状态三态 —— 与进度页同一把尺：写走 TP.setTaskState */
      var stRow = el("div", "tk-qt__pst");
      stRow.appendChild(el("span", "tk-qt__pstl", "我的状态"));
      var md0 = progressSnap();
      var cur = stateOf(md0, n.id);
      [["", "未标记"], ["inhand", "进行中"], ["done", "已完成"]].forEach(function (p) {
        var b = el("button", "tk-qt__pbtn", p[1]);
        b.type = "button";
        if (cur === p[0]) b.classList.add("is-on");
        b.addEventListener("click", function () {
          var TP = window.TarkovProgress;
          if (!TP) return;
          TP.setTaskState(n.id, p[0], D.cols[n.col][0]);
          /* 立刻重画本面板的按钮态（事件的 paint 管节点颜色） */
          Array.prototype.forEach.call(stRow.querySelectorAll(".tk-qt__pbtn"), function (bb) {
            bb.classList.remove("is-on");
          });
          b.classList.add("is-on");
        });
        stRow.appendChild(b);
      });
      panel.appendChild(stRow);

      var lk = el("a", "tk-qt__popen", "打开任务详情 →");
      lk.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(n.id);
      panel.appendChild(lk);
      /* 面板上的按下**不能冒泡给画布** —— 否则点按钮 / 拖选文字时，
         鼠标一挪就把地图拖走了。 */
      panel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      wrap.appendChild(panel);
      /* 面板固定 wrap 右上角，不随画布缩放 */
    }
    /* 点击判定的入口是上面的 endPt → hitTest（pointerup 坐标命中），
       不挂 click —— setPointerCapture 会把 click 的 target 改写成 wrap。 */

    /* ── 进度染色 ── */
    function paint() {
      var md = progressSnap();
      var done = 0, inhand = 0;
      for (var i = 0; i < nodes.length; i++) {
        var st = stateOf(md, nodes[i].id);
        nodes[i].el.classList.toggle("is-done", st === "done");
        nodes[i].el.classList.toggle("is-inhand", st === "inhand");
        if (st === "done") done++;
        else if (st === "inhand") inhand++;
      }
      count.textContent = nodes.length + " 个任务 · 已完成 " + done +
        " · 进行中 " + inhand;
    }
    liveRefresh = paint;
    liveEsc = closePanel;
    if (!bound) {
      bound = true;
      document.addEventListener("tarkov:progress", function () {
        if (liveRefresh) liveRefresh();
      });
      /* ESC 关面板：与上面同理 —— document 级监听只装一次 */
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && liveEsc) liveEsc();
      });
    }

    /* ── 搜索：过滤 + 定位到第一个匹配 ── */
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var first = null, hitN = 0;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var hit = !q || n.name.toLowerCase().indexOf(q) >= 0;
        n.el.classList.toggle("is-dim", !hit);
        if (hit && q) { hitN++; if (!first) first = n; }
      }
      for (var j = 0; j < edges.length; j++) {
        var e = edges[j];
        var vis = e.a.el.classList.contains("is-dim") === false
               && e.b.el.classList.contains("is-dim") === false;
        e.path.classList.toggle("is-dim", !vis);
      }
      if (q) {
        count.textContent = "匹配 " + hitN + " 个";
        if (first) {
          /* 把视图移到第一个匹配（画布坐标 → 视口居中） */
          var vw = wrap.clientWidth || 800, vh = wrap.clientHeight || 600;
          tx = vw / 2 - (first.x + 110) * scale;
          ty = vh / 2 - (first.y + 28) * scale;
          apply();
        }
      } else {
        paint();
      }
    });

    fit();
    apply();
    paint();
    /* 兜底：进度脚本可能比本模块晚就绪（脚本顺序），再做一次延迟着色 */
    setTimeout(paint, 800);
  }

  /* ════════════════════════════ 入口 ════════════════════════════ */

  function mount() {
    var host = document.getElementById("tk-quest-tree");
    if (!host || host.dataset.tkMounted === "1" || host.dataset.tkBusy === "1") return;
    host.dataset.tkBusy = "1";
    ensureData(function (D) {
      host.dataset.tkBusy = "0";
      if (!D || !D.nodes) {
        host.textContent =
          "任务全景图的数据没能加载出来（可能是网络问题）。" +
          "本页下方的说明与「我的进度」的依赖树不受影响。";
        host.classList.add("tk-qt--fail");
        return;
      }
      host.dataset.tkMounted = "1";
      render(host, D);
    });
  }

  /* 供 toolbox.js 在每次换页后回调（同 catalog-item.js 的机制）。 */
  window.__tkBootTree = mount;
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
  mount();
})();
