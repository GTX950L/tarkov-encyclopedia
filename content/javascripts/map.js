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
      r.appendChild(el("title", {}, tip));
      r.style.cursor = "pointer";
      r.addEventListener("click", function () {
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

    function applyQzFilter() {
      if (!qzAll.length) return;
      var snap = qzFilter === "all" ? null : progressSnap();
      var shown = 0;
      Array.prototype.forEach.call(qlayer.children, function (r) {
        var st = snap ? stateOf(snap, r.getAttribute("data-q")) : "";
        /* 「全部」模式不做过滤，但**把已完成的弱化** —— 这样即使不筛，
           也能一眼看出哪些是回头任务 */
        var ok =
          qzFilter === "all" ||
          (qzFilter === "open" && st !== "done") ||
          (qzFilter === "inhand" && st === "inhand");
        r.style.display = ok ? "" : "none";
        r.classList.toggle("is-done", st === "done");
        if (ok) shown++;
      });
      if (qzCount) {
        qzCount.textContent =
          qzFilter === "all"
            ? qzAll.length + " 个目标区域"
            : shown + " / " + qzAll.length + " 个目标区域";
      }
    }
    var qzCount = null;

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
      applyQzFilter(); // 初始化：同时把计数填上
    }

    if (bar.children.length) host.appendChild(bar);

    /* ── 图例 ── */
    var legend = document.createElement("ul");
    legend.className = "tk-map__legend";
    [
      ["tk-lg-pin", "地名锚点（上游 labels 投影）"],
      ["tk-lg-task", "任务目标区域（悬停看任务，点击进任务详情）"],
      ["tk-lg-locked", "上锁房间 / 需要钥匙"],
      ["tk-lg-danger", "危险区（雷区等）"],
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
