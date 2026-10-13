/* ==========================================================================
   交互地图（第十二篇）
   --------------------------------------------------------------------------
   页面挂载点：`<div id="tk-map" data-map="customs">…</div>`（content/maps/*.md）

   数据与底图都是**生成物**：
     · 点位 / 楼层 / 图层  → javascripts/maps-data.js（scripts/gen_maps.py）
     · 底图 SVG            → assets/maps/<Name>.svg（同一支生成器换肤后入库）

   三件事在这里做：

     1. **内联 SVG**（用 fetch 取回后插进 DOM）—— 不内联就没法控制图层、
        也没法把点位叠在同一坐标系里。
     2. **点位叠加**：坐标来自生成器的投影结果，**本文件不做任何坐标计算**。
     3. **楼层互斥显示**：上游用 `<g id="Ground_Level">` 一类分组，切换 display 即可。

   三条边界（与站内其他脚本一致）：

     · **站点根用本脚本自己的 src 反推**，不写死绝对路径 —— 站点部署在
       `/tarkov-encyclopedia/` 子路径下，写死会全站 404。
     · **取不到数据或取不到 SVG 时保留静态降级文案**，不报错、不空白。
     · **重复挂载要挡住**：Material 的 instant 换页会重放脚本，
       不查重会把点位叠两遍（表现为标签重影、圆点变粗）。

   接入方式与站内其他脚本一致：优先挂 Material 的 `document$`，
   换页后重新执行；另外自己立即尝试一次（脚本晚于首次 `document$` 注入时兜底）。
   ========================================================================== */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  /* 跨标签同步用：`liveFilter` 指向当前页面的筛选函数（instant 换页后会换人），
     `storageBound` 保证监听器只装一次。 */
  var liveFilter = null;
  var storageBound = false;

  /* 站点根：从本脚本的 src 反推，末尾带 `/`。 */
  function siteRoot() {
    var s =
      document.currentScript ||
      document.querySelector('script[src*="javascripts/map.js"]');
    if (!s) return "./";
    try {
      return new URL(s.src, location.href).href.replace(/javascripts\/map\.js.*$/, "");
    } catch (e) {
      return "./";
    }
  }

  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    }
    if (text != null) n.textContent = text;
    return n;
  }

  function render(host, data, svgText) {
    host.innerHTML = "";
    host.classList.add("tk-map--ready");

    /* ── 底图 ── */
    var canvas = document.createElement("div");
    canvas.className = "tk-map__canvas";
    canvas.innerHTML = svgText;
    var svg = canvas.querySelector("svg");
    if (!svg) {
      host.textContent = "底图解析失败，请刷新重试。";
      host.classList.remove("tk-map--ready");
      return;
    }
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "交互地图底图");
    host.appendChild(canvas);

    /* ── 视图控制：滚轮缩放 + 拖拽平移 ──
       直接操作 SVG 的 `viewBox`，**不套 CSS transform** —— 点位、任务区域、地名
       全都画在同一个 viewBox 坐标系里，改 viewBox 就是三者一起动，不会错位。
       缩放以**指针位置为锚点**（不是左上角），否则每滚一下图就往外跑。
       ⚠️ 标注字号要按放大倍数**反向缩**（`--tk-k`），否则放大后字比楼还大；
       这也是竞品地图的共同做法：底图放大、标注保持屏幕大小。 */
    var vb0 = (data.viewBox || [0, 0, 1000, 600]).slice();
    var cur = vb0.slice();
    var K_MIN = 1, K_MAX = 12; // 相对原始 viewBox 的放大上限（K_MIN=1 即不缩小，避免图缩成一小块）

    function applyVB() {
      svg.setAttribute(
        "viewBox",
        cur[0].toFixed(2) + " " + cur[1].toFixed(2) + " " + cur[2].toFixed(2) + " " + cur[3].toFixed(2)
      );
      svg.style.setProperty("--tk-k", (vb0[2] / cur[2]).toFixed(3));
    }

    function zoomAt(clientX, clientY, k) {
      /* `k` 是**放大倍数**（>1 = 放大）：视野的宽高除以 k。
         ⚠️ 这里曾经把 k 乘上去，表现为「滚轮往上滚反而缩小」。
         锚点公式与宽高**必须用同一个方向**，否则缩放中心也会跟着错。 */
      var nw = cur[2] / k;
      var nh = cur[3] / k;
      if (nw > vb0[2] || nw < vb0[2] / K_MAX) return; // 夹在 [原尺寸, 12×] 之间
      var r = svg.getBoundingClientRect();
      /* 屏幕坐标 → 当前 viewBox 内的用户坐标 */
      var ux = cur[0] + ((clientX - r.left) / r.width) * cur[2];
      var uy = cur[1] + ((clientY - r.top) / r.height) * cur[3];
      /* 让这个点缩放前后停在原地：新左上角 = 锚点 −（锚点到旧左上角的距离 ÷ k） */
      cur = [ux - (ux - cur[0]) / k, uy - (uy - cur[1]) / k, nw, nh];
      applyVB();
    }

    function resetView() {
      cur = vb0.slice();
      applyVB();
    }

    /* 以**画布中心**为锚点的缩放 —— 给按钮用（滚轮那条走指针位置） */
    function zoomCenter(k) {
      var r = svg.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
    }

    svg.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault(); // 否则页面会跟着滚，地图永远停在原地
        zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1 / 1.18 : 1.18);
      },
      { passive: false }
    );

    /* 拖拽平移。用 pointer 事件（鼠标与触摸一套代码）。
       点在任务区域上**不拖拽** —— 那一下是「选中这个任务」。 */
    var drag = null;
    svg.addEventListener("pointerdown", function (e) {
      if (e.target.classList && e.target.classList.contains("tk-zq")) return;
      drag = { x: e.clientX, y: e.clientY, vb: cur.slice() };
      canvas.classList.add("is-dragging");
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 忽略：某些浏览器对已释放的 pointer 会抛 */
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var r = svg.getBoundingClientRect();
      var dx = ((e.clientX - drag.x) / r.width) * drag.vb[2];
      var dy = ((e.clientY - drag.y) / r.height) * drag.vb[3];
      cur = [drag.vb[0] - dx, drag.vb[1] - dy, drag.vb[2], drag.vb[3]];
      applyVB();
    });
    function endDrag(e) {
      if (!drag) return;
      drag = null;
      canvas.classList.remove("is-dragging");
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* 同上 */
      }
    }
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    /* 点空白处 = 取消选中；**测距模式下则记一个点**（点任务区域时会被 stopPropagation 挡掉） */
    svg.addEventListener("click", function (e) {
      if (rulerOn) {
        var p = svgPoint(e);
        addRulerPt(p[0], p[1]);
        return;
      }
      if (e.target === svg) selectTask(null);
    });

    applyVB();

    /* 楼层互斥：先只留第一层，避免所有楼层叠在一起 */
    var floorGroups = (data.floors || [])
      .map(function (f) {
        return { id: f.id, cn: f.cn, el: svg.querySelector('g[id="' + f.id + '"]') };
      })
      .filter(function (f) {
        return f.el;
      });

    function showFloor(id) {
      floorGroups.forEach(function (f) {
        f.el.style.display = f.id === id ? "" : "none";
      });
    }
    if (floorGroups.length) showFloor(floorGroups[0].id);

    /* ── 危险区（**最底层**：它是大面积多边形，画在任何东西下面都最合适）── */
    var hazLayer = el("g", { class: "tk-map__hazards" });
    (data.hazards || []).forEach(function (h) {
      var poly = el("polygon", {
        points: h.pts
          .map(function (q) {
            return q[0] + "," + q[1];
          })
          .join(" "),
        class: "tk-hz",
      });
      poly.appendChild(el("title", {}, h.tzh));
      hazLayer.appendChild(poly);
    });
    if (hazLayer.children.length) svg.appendChild(hazLayer);

    /* ── 任务点位层（zones）──
       放在地名点**之下**：任务区域是大面积半透明矩形，压在地名上会盖住字。
       每个 zone 是一条「任务目标区域」，可能比一个点大得多（放置/到访类常是
       一整栋楼的范围），所以画矩形而不是点。 */
    var qzAll = data.questZones || [];
    var qlayer = el("g", { class: "tk-map__qzones" });
    qzAll.forEach(function (z) {
      /* 单点点位（w/h 为 0）放大到能看见 —— 否则点不中也看不出在哪 */
      var w = Math.max(z.w, 11);
      var h = Math.max(z.h, 11);
      var r = el("rect", {
        x: (z.x - (w - z.w) / 2).toFixed(1),
        y: (z.y - (h - z.h) / 2).toFixed(1),
        width: w.toFixed(1),
        height: h.toFixed(1),
        class: "tk-zq tk-zq--" + (z.k || "other"),
        "data-q": z.q,
      });
      var tip = z.n + "（" + z.t + "）";
      if (z.d) tip += "\n" + z.d;
      tip += "\n单击=只看这个任务，双击=打开任务详情";
      r.appendChild(el("title", {}, tip));
      r.addEventListener("click", function (e) {
        /* 测距模式下点在任务区域上也算「取一个点」—— 否则盖在区域上的目标量不了。
           这里**不** stopPropagation，让事件冒到 svg 由测距逻辑接住。 */
        if (rulerOn) return;
        e.stopPropagation(); // 别让「点空白处取消选中」把它一起清掉
        selectTask(z.q);
      });
      r.addEventListener("dblclick", function () {
        location.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(z.q);
      });
      qlayer.appendChild(r);
    });
    if (qzAll.length) svg.appendChild(qlayer);

    /* ── 与「我的进度」联动 ──
       站内进度存在 localStorage `tarkov_progress_v1`，**任务 id 与这里的
       questZones 是同一套键**，所以不需要任何桥接表。
       两条纪律照抄 progress.js 自己写的：
         · 状态要用**「键存在与否」**判断，不能用值的真假（值可能是空字符串）；
         · **不要**在循环里反复调 taskState()，那会做上百次 localStorage 读取
           （progress.js 的注释专门警告过）—— 所以这里一次 data() 拿副本，
           之后纯本地判断。 */
    function progressSnap() {
      var P = window.TarkovProgress;
      if (!P || typeof P.data !== "function") return null;
      try {
        var d = P.data();
        var md = (d.modes || {})[d.mode] || {};
        return { quests: md.quests || {}, inhand: md.inhand || {} };
      } catch (e) {
        return null;
      }
    }

    function stateOf(snap, qid) {
      if (!snap) return "";
      if (Object.prototype.hasOwnProperty.call(snap.quests, qid)) return "done";
      if (Object.prototype.hasOwnProperty.call(snap.inhand, qid)) return "inhand";
      return "";
    }

    var qzFilter = "all"; // all（全部） | open（只看未完成） | inhand（只看进行中）
    var selected = null; // 选中的任务 id；一非空就切到「只看这一个」
    var qzCount = null; // 控件条上的计数元素，建控件时才赋值

    function applyQzFilter() {
      if (!qzAll.length) return;
      /* ⚠️ 「全部」模式**也要**取进度快照 —— 它要用来把已完成的任务区域标淡。
         早先那版在 all 模式下把快照置空，于是「已完成自动变淡」这个设计**根本没生效**，
         只有切到筛选时才看得出差别。 */
      var snap = progressSnap();
      var shown = 0;
      Array.prototype.forEach.call(qlayer.children, function (r) {
        var q = r.getAttribute("data-q");
        var st = stateOf(snap, q);
        r.classList.toggle("is-done", st === "done");
        r.classList.toggle("is-sel", selected === q);
        /* 选中时筛选退居其次：读者点某个区域，意图是「看这个」，
           不是「在这个基础上再筛一层」 */
        var ok = selected
          ? q === selected
          : qzFilter === "all" ||
            (qzFilter === "open" && st !== "done") ||
            (qzFilter === "inhand" && st === "inhand");
        r.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (qzCount) {
        qzCount.textContent = selected
          ? "只看选中的这 1 个任务"
          : qzFilter === "all"
            ? qzAll.length + " 个目标区域"
            : shown + " / " + qzAll.length + " 个目标区域";
      }
    }

    /* ── 选中某个任务：只显示它 + 出一张信息卡 ── */
    var cardHost = null;

    function selectTask(qid) {
      selected = qid || null;
      applyQzFilter();
      renderCard();
    }

    function renderCard() {
      if (!cardHost) return;
      cardHost.innerHTML = "";
      if (!selected) {
        cardHost.style.display = "none";
        return;
      }
      cardHost.style.display = "";
      var zs = qzAll.filter(function (z) {
        return z.q === selected;
      });
      var head = zs[0] || {};

      var nameEl = document.createElement("b");
      nameEl.textContent = head.n || selected;
      cardHost.appendChild(nameEl);

      var badges = [
        [head.t || "", ""],
        [zs.length + " 处区域", "--dim"],
      ];
      var st = stateOf(progressSnap(), selected);
      if (st) badges.push([st === "done" ? "已完成" : "进行中", "--" + st]);
      badges.forEach(function (pair) {
        if (!pair[0]) return;
        var s = document.createElement("span");
        s.className = "tk-map__badge" + (pair[1] ? " tk-map__badge" + pair[1] : "");
        s.textContent = pair[0];
        cardHost.appendChild(s);
      });

      if (head.d) {
        var p = document.createElement("p");
        p.className = "tk-map__carddesc";
        p.textContent = head.d;
        cardHost.appendChild(p);
      }

      var a = document.createElement("a");
      a.className = "tk-map__cardlink";
      a.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(selected);
      a.textContent = "打开任务详情 →";
      cardHost.appendChild(a);

      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "tk-map__cardclear";
      clear.textContent = "取消选中";
      clear.addEventListener("click", function () {
        selectTask(null);
      });
      cardHost.appendChild(clear);
    }

    /* ── 点位层 ── */
    var pins = el("g", { class: "tk-map__pins" });
    (data.labels || []).forEach(function (lb) {
      var g = el("g", { class: "tk-map__pin" });
      g.appendChild(el("circle", { cx: lb.x, cy: lb.y, r: 5 }));
      g.appendChild(
        el(
          "text",
          {
            x: lb.x,
            y: lb.y - 9,
            "text-anchor": "middle",
            "font-size": 13.5,
          },
          lb.cn || lb.en
        )
      );
      var title = el("title", {}, lb.cn ? lb.cn + "（" + lb.en + "）" : lb.en);
      g.appendChild(title);
      pins.appendChild(g);
    });
    svg.appendChild(pins);

    /* ── 上锁：方块 + 点击查钥匙 ──
       钥匙 id 是 tarkov.dev 的物品 id，**与站内物品图鉴同一套键** —— 直接链过去，
       不另建映射。这条链接是这一层真正的价值：它把「这里有扇门」接到「要哪把钥匙」。 */
    var lockLayer = el("g", { class: "tk-map__locks" });
    (data.locks || []).forEach(function (lk) {
      var g = el("g", {
        class: "tk-lk",
        transform: "translate(" + lk.p[0] + "," + lk.p[1] + ")",
      });
      g.appendChild(el("rect", { x: -4.2, y: -4.2, width: 8.4, height: 8.4, rx: 1.6 }));
      var tip = lk.tzh + (lk.pw ? "（需要供电）" : "");
      tip += lk.k ? "\n需要钥匙 —— 点击查看这件钥匙" : "\n无需钥匙";
      g.appendChild(el("title", {}, tip));
      if (lk.k) {
        g.style.cursor = "pointer";
        g.addEventListener("click", function (e) {
          e.stopPropagation();
          location.href = siteRoot() + "catalog/item/?id=" + encodeURIComponent(lk.k);
        });
      }
      lockLayer.appendChild(g);
    });
    if (lockLayer.children.length) svg.appendChild(lockLayer);

    /* ── 撤离点：方块 + 阵营色 + **可读名** ──
       名字这件事是参考小喵塔科夫与 eftarkov 补上的：它们都显示「铁路通道」「加油站」，
       而本站此前只有方块 —— 上游给的名字是 `ex_customs_scav_gasstation` 这种内部 id，
       不转一遍等于没写（转换规则见 scripts/gen_maps.py 的 humanize_extract）。
       ⚠️ 阵营色来自上游的 `faction` 字段，**不代表「谁能用」**。 */
    var exLayer = el("g", { class: "tk-map__extracts" });
    (data.extracts || []).forEach(function (e) {
      var g = el("g", {
        class: "tk-ex tk-ex--" + (e.f || "shared"),
        transform: "translate(" + e.p[0] + "," + e.p[1] + ")",
      });
      g.appendChild(el("rect", { x: -5, y: -5, width: 10, height: 10, rx: 1.2 }));
      g.appendChild(el("text", { x: 8, y: 4, class: "tk-ex__lbl" }, e.nzh || e.fzh));
      g.appendChild(
        el("title", {}, e.fzh + " 撤离点：" + (e.nzh || e.n) + "\n（上游名：" + e.n + "）")
      );
      exLayer.appendChild(g);
    });
    if (exLayer.children.length) svg.appendChild(exLayer);

    /* ── 转场点：三角 + 「前往 XX」──
       转场＝不结束战局直接换图（站内有[转场与 BTR](../entries/transit.md)）。
       上游的 transits 只有目标图 id、没有名字，名字由生成器按目标图推出来。 */
    var trLayer = el("g", { class: "tk-map__transits" });
    (data.transits || []).forEach(function (tr) {
      var g = el("g", {
        class: "tk-tr",
        transform: "translate(" + tr.p[0] + "," + tr.p[1] + ")",
      });
      g.appendChild(el("polygon", { points: "0,-6.5 6.5,5 -6.5,5" }));
      g.appendChild(el("text", { x: 9, y: 4, class: "tk-tr__lbl" }, tr.nzh));
      g.appendChild(el("title", {}, tr.nzh + "（转场：不结束战局直接换图）"));
      trLayer.appendChild(g);
    });
    if (trLayer.children.length) svg.appendChild(trLayer);

    /* ── 控件 ── */
    var bar = document.createElement("div");
    bar.className = "tk-map__bar";

    if (floorGroups.length > 1) {
      var fl = document.createElement("div");
      fl.className = "tk-map__seg";
      fl.setAttribute("role", "group");
      fl.setAttribute("aria-label", "楼层");
      floorGroups.forEach(function (f, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = f.cn;
        if (i === 0) b.classList.add("is-on");
        b.addEventListener("click", function () {
          showFloor(f.id);
          Array.prototype.forEach.call(fl.children, function (c) {
            c.classList.toggle("is-on", c === b);
          });
        });
        fl.appendChild(b);
      });
      bar.appendChild(fl);
    }

    if ((data.labels || []).length) {
      var lb2 = document.createElement("div");
      lb2.className = "tk-map__seg";
      lb2.setAttribute("role", "group");
      lb2.setAttribute("aria-label", "标注");
      [["显示地名", true], ["隐藏地名", false]].forEach(function (pair) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = pair[0];
        if (pair[1]) b.classList.add("is-on");
        b.addEventListener("click", function () {
          pins.style.display = pair[1] ? "" : "none";
          Array.prototype.forEach.call(lb2.children, function (c) {
            c.classList.toggle("is-on", c === b);
          });
        });
        lb2.appendChild(b);
      });
      bar.appendChild(lb2);
    }

    if (qzAll.length) {
      var qzSeg = document.createElement("div");
      qzSeg.className = "tk-map__seg";
      qzSeg.setAttribute("role", "group");
      qzSeg.setAttribute("aria-label", "任务点位");
      [
        ["全部任务", "all"],
        ["只看未完成", "open"],
        ["只看进行中", "inhand"],
      ].forEach(function (pair, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = pair[0];
        if (i === 0) b.classList.add("is-on");
        b.addEventListener("click", function () {
          qzFilter = pair[1];
          applyQzFilter();
          Array.prototype.forEach.call(qzSeg.children, function (c) {
            c.classList.toggle("is-on", c === b);
          });
        });
        qzSeg.appendChild(b);
      });
      bar.appendChild(qzSeg);

      qzCount = document.createElement("span");
      qzCount.className = "tk-map__count";
      bar.appendChild(qzCount);
      applyQzFilter(); // 初始化：同时把计数与「已完成」标记填上
    }

    /* ── 测距：点两点量直线距离 ──
       距离用**世界坐标**算：像素差 × 每像素米数（`mpp`，生成器按 bounds 与
       viewBox 算出）。x 与 z 的比例尺**不同**，所以两个方向分别乘、不能取平均。
       ⚠️ 标的是**直线距离**，不是走路距离 —— 站内没有路网数据，
       说「走过去 200 米」是不诚实的。 */
    var rulerOn = false;
    var rulerPts = [];
    var rulerTip = null; // 控件条上的提示文字（建控件时赋值）
    var rulerG = el("g", { class: "tk-map__ruler" });
    svg.appendChild(rulerG);

    /* 屏幕坐标 → 当前 viewBox 内的用户坐标（缩放平移之后也要准，所以用 cur 现算） */
    function svgPoint(e) {
      var r = svg.getBoundingClientRect();
      return [
        cur[0] + ((e.clientX - r.left) / r.width) * cur[2],
        cur[1] + ((e.clientY - r.top) / r.height) * cur[3],
      ];
    }

    function clearRuler() {
      rulerPts = [];
      while (rulerG.firstChild) rulerG.removeChild(rulerG.firstChild);
      if (rulerTip) rulerTip.textContent = rulerOn ? "点两个点量距离" : "";
    }

    function addRulerPt(x, y) {
      if (rulerPts.length >= 2) clearRuler(); // 第三次点击 = 重新开始
      rulerPts.push([x, y]);
      rulerG.appendChild(el("circle", { cx: x, cy: y, r: 4.5, class: "tk-rl-dot" }));
      if (rulerPts.length !== 2) {
        if (rulerTip) rulerTip.textContent = "再点第二个点";
        return;
      }
      var a = rulerPts[0];
      var b = rulerPts[1];
      rulerG.appendChild(
        el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "tk-rl-line" })
      );
      var mpp = data.mpp || [1, 1];
      var dx = (b[0] - a[0]) * mpp[0];
      var dy = (b[1] - a[1]) * mpp[1];
      var meters = Math.round(Math.sqrt(dx * dx + dy * dy));
      var t = el("text", {
        x: (a[0] + b[0]) / 2,
        y: (a[1] + b[1]) / 2 - 7,
        "text-anchor": "middle",
        class: "tk-rl-txt",
      });
      t.textContent = meters + " 米";
      rulerG.appendChild(t);
      if (rulerTip) rulerTip.textContent = "直线距离约 " + meters + " 米（再点一次可重画）";
    }

    function toggleRuler(on) {
      rulerOn = on;
      canvas.classList.toggle("is-ruling", on);
      clearRuler();
      if (rulerTip) rulerTip.textContent = on ? "点两个点量距离" : "";
    }

    /* ── 图层开关（撤离点 / 上锁 / 危险区）──
       与「任务筛选」是两回事：筛选管**看哪些**，开关管**看不看**。
       按钮上带**条数**、悬停给出**细分** —— 参考 eftarkov 的做法：
       它左栏那份清单（撤离点 28 → PMC 11 / SCAV 13 / 转移点 4）比
       单纯的开关有用得多，读者一眼就知道「这图有多少、都是什么」。 */
    function tally(list, key) {
      var c = {};
      list.forEach(function (x) {
        var k = x[key] || "—";
        c[k] = (c[k] || 0) + 1;
      });
      return Object.keys(c)
        .map(function (k) {
          return k + " " + c[k];
        })
        .join(" / ");
    }

    var layerToggles = [
      ["撤离点", exLayer, (data.extracts || []).length, tally(data.extracts || [], "fzh")],
      ["转场点", trLayer, (data.transits || []).length, ""],
      ["上锁", lockLayer, (data.locks || []).length, tally(data.locks || [], "tzh")],
      ["危险区", hazLayer, (data.hazards || []).length, ""],
    ].filter(function (t) {
      return t[1] && t[1].children.length;
    });

    if (layerToggles.length) {
      var lySeg = document.createElement("div");
      lySeg.className = "tk-map__seg";
      lySeg.setAttribute("role", "group");
      lySeg.setAttribute("aria-label", "图层");
      layerToggles.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t[2] ? t[0] + " " + t[2] : t[0];
        b.title = t[0] + " " + t[2] + (t[3] ? "：" + t[3] : "") + "　（点击开关这一层）";
        b.classList.add("is-on"); // 三个图层默认都开
        b.addEventListener("click", function () {
          var on = !b.classList.contains("is-on");
          b.classList.toggle("is-on", on);
          t[1].style.display = on ? "" : "none";
        });
        lySeg.appendChild(b);
      });
      bar.appendChild(lySeg);
    }

    /* 缩放按钮：滚轮之外给一个**显式入口** —— 触屏、以及不习惯滚轮的读者都用得上。
       「重置」另外兼任「迷路之后找回全图」。 */
    var zoomSeg = document.createElement("div");
    zoomSeg.className = "tk-map__seg";
    zoomSeg.setAttribute("role", "group");
    zoomSeg.setAttribute("aria-label", "缩放");
    [
      ["放大", function () { zoomCenter(1.4); }],
      ["缩小", function () { zoomCenter(1 / 1.4); }],
      ["重置", resetView],
    ].forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[0];
      b.addEventListener("click", pair[1]);
      zoomSeg.appendChild(b);
    });
    /* 测距是 toggle，单独建按钮（前三个都是「一按就动」） */
    var rulerBtn = document.createElement("button");
    rulerBtn.type = "button";
    rulerBtn.textContent = "测距";
    rulerBtn.addEventListener("click", function () {
      var on = !rulerBtn.classList.contains("is-on");
      rulerBtn.classList.toggle("is-on", on);
      toggleRuler(on);
    });
    zoomSeg.appendChild(rulerBtn);

    /* 全屏 —— 地图要看得清（参考项目也有这一项，成本极低） */
    var fsBtn = document.createElement("button");
    fsBtn.type = "button";
    fsBtn.textContent = "全屏";
    fsBtn.addEventListener("click", function () {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (host.requestFullscreen) {
        host.requestFullscreen();
      }
    });
    zoomSeg.appendChild(fsBtn);

    bar.appendChild(zoomSeg);

    rulerTip = document.createElement("span");
    rulerTip.className = "tk-map__count";
    bar.appendChild(rulerTip);

    if (bar.children.length) host.appendChild(bar);

    /* 任务信息卡：选中某个任务后出现 */
    cardHost = document.createElement("div");
    cardHost.className = "tk-map__card";
    cardHost.style.display = "none";
    host.appendChild(cardHost);

    /* ── 任务清单面板：这张图上有哪些任务 ──
       参考 eftarkov.com 的地图工具（它右侧那栏「任务 / 剧情目标」）。
       它的做法值得学：**先按名字在列表里找到任务，再回图上定位** ——
       比「在一百多个方框里找一个」快得多，也解决了「不知道任务叫啥、只记得商人」的情况。
       本站没有侧栏（正文区约 900px），所以放在**地图上方**、默认折叠：
       地图才是主角，清单是入口。 */
    var qlist = [];
    var seenQ = {};
    qzAll.forEach(function (z) {
      if (!seenQ[z.q]) {
        seenQ[z.q] = { q: z.q, n: z.n, tr: z.tr || "", t: z.t, nz: 0 };
        qlist.push(seenQ[z.q]);
      }
      seenQ[z.q].nz++;
    });
    qlist.sort(function (a, b) {
      if (a.tr !== b.tr) return a.tr < b.tr ? -1 : 1;
      return a.n < b.n ? -1 : 1;
    });

    if (qlist.length) {
      var panel = document.createElement("div");
      panel.className = "tk-map__panel";

      var phead = document.createElement("button");
      phead.type = "button";
      phead.className = "tk-map__panelhead";
      phead.setAttribute("aria-expanded", "false");
      var pt = document.createElement("b");
      pt.textContent = "这张图上的任务 · " + qlist.length + " 个";
      phead.appendChild(pt);
      var pv = document.createElement("span");
      pv.textContent = "展开清单";
      phead.appendChild(pv);

      var pbody = document.createElement("div");
      pbody.className = "tk-map__panelbody";
      pbody.hidden = true;

      var curTrader = null;
      qlist.forEach(function (it) {
        if (it.tr && it.tr !== curTrader) {
          curTrader = it.tr;
          var g = document.createElement("div");
          g.className = "tk-qp-grp";
          g.textContent = curTrader;
          pbody.appendChild(g);
        }
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tk-qp";
        b.setAttribute("data-q", it.q);
        var bn = document.createElement("b");
        bn.textContent = it.n;
        b.appendChild(bn);
        var bi = document.createElement("i");
        bi.textContent = it.t + " · " + it.nz + " 处";
        b.appendChild(bi);
        b.addEventListener("click", function () {
          selectTask(it.q);
          /* 选完就收起 —— 面板是入口，地图才是要看的东西 */
          pbody.hidden = true;
          phead.setAttribute("aria-expanded", "false");
          pv.textContent = "展开清单";
        });
        pbody.appendChild(b);
      });

      phead.addEventListener("click", function () {
        var open = pbody.hidden;
        pbody.hidden = !open;
        phead.setAttribute("aria-expanded", open ? "true" : "false");
        pv.textContent = open ? "收起清单" : "展开清单";
      });
      panel.appendChild(phead);
      panel.appendChild(pbody);
      host.insertBefore(panel, canvas); // 放在地图**上方**
    }

    /* ── 图例 ── */
    var legend = document.createElement("ul");
    legend.className = "tk-map__legend";
    [
      ["tk-lg-pin", "地名锚点"],
      ["tk-lg-ex", "撤离点（带名字，按阵营分色）"],
      ["tk-lg-tr", "转场点 —— 不结束战局直接换图"],
      ["tk-lg-lock", "上锁 —— 点击查需要哪把钥匙"],
      ["tk-lg-hz", "危险区（雷区等）"],
      ["tk-lg-task", "任务目标区域 —— 单击只看它、双击进详情"],
    ].forEach(function (pair) {
      var li = document.createElement("li");
      var sw = document.createElement("i");
      sw.className = pair[0];
      li.appendChild(sw);
      li.appendChild(document.createTextNode(pair[1]));
      legend.appendChild(li);
    });
    host.appendChild(legend);

    var note = document.createElement("p");
    note.className = "tk-map__note";
    note.textContent =
      "底图为矢量绘制，可缩放查看。任务点位是目标区域（不是精确站姿点位），" +
      "坐标为上游数据投影所得，仅供参考；精确位置以游戏内为准。";
    host.appendChild(note);

    /* 别处（另一个标签页）改了进度 → 地图跟着更新。
       零成本、且不需要读者手动刷新。**监听器只装一次**，指向当前的
       `liveFilter` —— instant 换页会重放本脚本，不挡住会越装越多。 */
    liveFilter = applyQzFilter;
    if (!storageBound) {
      storageBound = true;
      window.addEventListener("storage", function (e) {
        if (e.key === "tarkov_progress_v1" && liveFilter) liveFilter();
      });
    }
  }

  /* 数据按需加载：maps-data.js 约 20 KB，只有带挂载点的页面才需要，
     不适合像 progress-manifest.js 那样全站引入。 */
  function ensureData(cb) {
    if (window.TARKOV_MAPS) return cb(window.TARKOV_MAPS);
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/maps-data.js";
    s.onload = function () {
      cb(window.TARKOV_MAPS || null);
    };
    s.onerror = function () {
      cb(null);
    };
    document.head.appendChild(s);
  }

  function mount() {
    var host = document.getElementById("tk-map");
    /* 查重：instant 换页会重放脚本，不挡会把点位叠两遍 */
    if (!host || host.dataset.tkMounted === "1") return;
    if (host.dataset.tkMapBusy === "1") return;

    var key = host.getAttribute("data-map") || "customs";
    host.dataset.tkMapBusy = "1";

    ensureData(function (maps) {
      var data = maps && maps[key];
      if (!data) {
        /* 点位数据没取到：同样给明确提示，不让「加载中…」一直挂着 */
        host.dataset.tkMapBusy = "0";
        host.textContent = "地图数据没能加载出来（可能是网络问题）。本页下方的文字说明不受影响。";
        host.classList.add("tk-map--fail");
        return;
      }
      fetch(siteRoot() + "assets/maps/" + data.svg)
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (text) {
          host.dataset.tkMounted = "1";
          render(host, data, text);
        })
        .catch(function () {
          host.dataset.tkMapBusy = "0";
          /* 取不到底图时给**明确**的失败提示。
             ⚠️ 不能让页面里那句「加载中…」一直挂着 —— 挂着会让读者以为还在等，
             实际已经失败了。**「静默等待」是最坏的一种失败表现形式。** */
          if (host.dataset.tkMounted !== "1") {
            host.textContent =
              "底图没能加载出来（可能是网络问题，或资源被浏览器扩展拦了）。" +
              "本页下方的文字说明不受影响；也可直接进游戏按 O 键查看官方地图。";
            host.classList.add("tk-map--fail");
          }
        });
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
  mount();
})();
