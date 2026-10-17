/* ==========================================================================
   交互地图（第十二篇）
   --------------------------------------------------------------------------
   页面挂载点：`<div id="tk-map" data-map="customs">…</div>`（content/maps/*.md）

   数据与底图都是**生成物**：
     · 点位 / 楼层 / 图层  → javascripts/maps-data.js（scripts/gen_maps.py）
     · 底图 SVG            → assets/maps/<Name>.svg（同一支生成器换肤后入库）

   八件事在这里做：

     1. **内联 SVG**（用 fetch 取回后插进 DOM）—— 不内联就没法控制图层、
        也没法把点位叠在同一坐标系里。
     2. **点位叠加**：坐标来自生成器的投影结果，**本文件不做任何坐标计算**。
     3. **楼层互斥显示**：上游用 `<g id="Ground_Level">` 一类分组，切换 display 即可。
     4. **任务搜索与定位**：控件条里的搜索框按中／英名过滤（地名锚点也行），
        选中后地图只剩该任务、弹出信息卡，并把视图移到它的区域上 ——
        「知道名字 → 看到它在哪」一步到位，不用在上百个方框里翻。
     5. **任务清单（地图下方的控制台）**：这张图的任务按商人分组列出，带
        **进度三态**（未标记／进行中／已完成，与「我的进度」同一份本机存储）、
        组内完成度细条、**行前提示**（钥匙／自备）与进度筛选；点一行，
        上面地图就只剩它并自动定位。
     6. **出击规划**：清单行左侧的「+」把任务加进出击清单（可多选），
        汇总条给出区域数与钥匙数，「只看这些」让地图同时显示这几个任务的区域 ——
        一次 raid 推进几个任务时，这是比「单选」更贴战的看法。
    7. **标记小卡**：点地名／撤离点／转场点弹「这是什么 + 去哪读」，
       条目链接是稳定地址（不用位置式锚点，防错位）。
     8. **标注屏幕锚定与避让（2026-10-15 重做）**：所有标注尺寸写
        `calc(Npx / var(--tk-k))`，`--tk-k` = 画布宽 ÷ 视野宽（每用户单位的
        屏幕像素），于是标注在任何图、任何缩放下都是恒定屏幕像素 —— 修掉了
        「工厂巨字糊死全图、街区蚂蚁字看不见」的坐标系 bug；文字位置每帧
        在屏幕空间做**贪心避让**，放不下的先藏字留记号，放大自然浮现；
        另有与测距同源的**比例尺**（左下角，随缩放换档）与**任务区域图层开关**。

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

  /* 跨标签同步与全局快捷键用：这几个指针指向**当前页面**的函数
     （instant 换页后会换人），配套的布尔量保证监听器只装一次。 */
  var liveFilter = null;
  var storageBound = false;
  var liveHidePicker = null;
  var liveHidePop = null;
  var escBound = false;
  var liveResizeBound = null; // resize/全屏监听随换页换人，先摘旧的再挂新的（防累积）

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
    /* 瓦片拼合图（实验室 / 迷宫 / 破冰船）的底图是 `<image href="Labs.webp">`，
       href 按**文件名**写（build_tile_maps.py 的约束：内联后相对地址会按页面
       URL 解析）。内联进 `/maps/<key>/` 后 `Labs.webp` 会解析成
       `/maps/<key>/Labs.webp` → 404，位图从未显示过（页面只剩画布底色，
       2026-10-15 重绘时实测确认）。这里统一补上站点根。
       ⚠️ **隐藏楼层里的位图不补 href（懒加载）**：display:none 的 &lt;image&gt;
       照样会被浏览器预下载（规格如此），拦下载只能不给 href —— 实验室两层
       共 1.85MB，不切「2 层」的读者此前白下 634KB。隐藏层的待补 href 记进
       lazyImages，showFloor 切到那层时才补。矢量 SVG 没有 &lt;image&gt;，零成本。 */
    var lazyImages = []; // {im, attr, file}：隐藏楼层里待加载的位图
    Array.prototype.forEach.call(svg.querySelectorAll("image"), function (im) {
      ["href", "xlink:href"].forEach(function (attr) {
        var h = im.getAttribute(attr);
        if (!h || /^(https?:|data:|\/)/.test(h)) return;
        var pg = im.parentNode;
        var hidden =
          pg && pg.nodeType === 1 && /display\s*:\s*none/.test(pg.getAttribute("style") || "");
        if (hidden) {
          im.removeAttribute(attr);
          im.setAttribute("data-lazy-" + attr, h); // 暂存，切层时用
          lazyImages.push({ im: im, attr: attr, file: h });
        } else {
          im.setAttribute(attr, siteRoot() + "assets/maps/" + h);
        }
      });
    });
    function loadLazyImages(scope) {
      lazyImages = lazyImages.filter(function (it) {
        if (it.im.parentNode !== scope) return true; // 别的层，继续等
        it.im.setAttribute(it.attr, siteRoot() + "assets/maps/" + it.file);
        return false; // 已补，出队
      });
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
      /* `--tk-k` 与全部标注布局都挪进 rAF（layoutLabels）里做：
         getBoundingClientRect 会强制 reflow，滚轮缩放的高频路径上不能每次都读。 */
      scheduleLayout();
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

    /* 视图移到某个任务的所有区域上（搜索选中后调用）。
       「知道名字 → 看到它在哪」是一次搜索的完整收尾 —— 不移视图的话，
       选中的任务可能缩在地图另一个角落：信息卡有了，人仍得自己找。
       宽高比保持与画布一致（SVG 是 xMidYMid meet，比例不符会出黑边），
       放大倍数夹在滚轮同款的 [原尺寸, K_MAX] 里，不打破既有缩放纪律。 */
    function focusZone(qid) {
      var zs = qzAll.filter(function (z) {
        return z.q === qid;
      });
      if (!zs.length) return;
      var x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      zs.forEach(function (z) {
        var w = Math.max(z.w, MIN_PX),
          h = Math.max(z.h, MIN_PX);
        var zx = z.x - (w - z.w) / 2,
          zy = z.y - (h - z.h) / 2;
        if (zx < x0) x0 = zx;
        if (zy < y0) y0 = zy;
        if (zx + w > x1) x1 = zx + w;
        if (zy + h > y1) y1 = zy + h;
      });
      /* 四周留 25% 余量 —— 贴边看不全目标，也看不出它周围是什么 */
      var w = (x1 - x0) * 1.5,
        h = (y1 - y0) * 1.5;
      var ar = vb0[2] / vb0[3];
      if (w / h < ar) w = h * ar;
      else h = w / ar;
      var minW = vb0[2] / K_MAX,
        minH = vb0[3] / K_MAX;
      if (w < minW) {
        w = minW;
        h = minW / ar;
      }
      if (h < minH) {
        h = minH;
        w = minH * ar;
      }
      /* 夹回画布内：宁可少留余量，也不把视图拉到图外看空白 */
      w = Math.min(w, vb0[2]);
      h = Math.min(h, vb0[3]);
      var cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      cur = [
        Math.max(vb0[0], Math.min(cx - w / 2, vb0[0] + vb0[2] - w)),
        Math.max(vb0[1], Math.min(cy - h / 2, vb0[1] + vb0[3] - h)),
        w,
        h,
      ];
      applyVB();
    }

    /* 视图移到某个**点**（地名锚点）上 —— 搜索地名、点小卡定位用。
       与 focusZone 的分工：那个按任务的所有区域取包围盒，这个按单点取景；
       取景宽度用画布的三分之一（点级目标不需要 12× 那么近）。 */
    function focusPoint(x, y) {
      var w = Math.min(Math.max(vb0[2] / 3, vb0[2] / K_MAX), vb0[2]);
      var h = w * (vb0[3] / vb0[2]); // 保持画布宽高比，避免 letterbox
      cur = [
        Math.max(vb0[0], Math.min(x - w / 2, vb0[0] + vb0[2] - w)),
        Math.max(vb0[1], Math.min(y - h / 2, vb0[1] + vb0[3] - h)),
        w,
        h,
      ];
      applyVB();
    }

    svg.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault(); // 否则页面会跟着滚，地图永远停在原地
        zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1 / 1.18 : 1.18);
      },
      { passive: false }
    );

    /* 拖拽平移 + 双指缩放。用 pointer 事件（鼠标与触摸一套代码）。
       点在任务区域上**不拖拽** —— 那一下是「选中这个任务」；
       双指手势不挑落点（第二指落在任务框上也要能缩）。
       ⚠️ 触屏可用性靠 CSS 的 `touch-action: none`（extra.css 的
          .tk-map__canvas svg）—— 没有它，pointermove 会被浏览器中途抢走
          （pointercancel），拖动"挑方向"、双指完全不可用。 */
    var drag = null;
    var ptActive = {};    // pointerId → 最近坐标（双指缩放用）
    var ptPrevDist = 0;   // 上一帧两指距离（增量式缩放的基准）
    function ptCount() { var n = 0; for (var k in ptActive) n++; return n; }
    function ptMid() {
      var ids = Object.keys(ptActive);
      var a = ptActive[ids[0]], b = ptActive[ids[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    svg.addEventListener("pointerdown", function (e) {
      ptActive[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ptCount() === 2) {
        /* 第二指落下 → 进手势模式：取消拖拽判定（含 tk-zq 分支）。 */
        var ids = Object.keys(ptActive);
        var a = ptActive[ids[0]], b = ptActive[ids[1]];
        ptPrevDist = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        drag = null;
        canvas.classList.remove("is-dragging");
        return;
      }
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
      if (ptActive[e.pointerId]) {
        ptActive[e.pointerId].x = e.clientX;
        ptActive[e.pointerId].y = e.clientY;
      }
      /* 双指缩放：**增量式**（当前两指距离 ÷ 上一帧距离），锚点取两指中点。
         中点跟随手指 → 两指整体平移时图跟着走，手感与系统手势一致；
         限幅与滚轮/按钮共用 zoomAt（12× 上限、原尺寸下限）。
         距离过小时不缩（两指重合会得到暴走的倍数）。 */
      if (ptCount() === 2) {
        var ids = Object.keys(ptActive);
        var a = ptActive[ids[0]], b = ptActive[ids[1]];
        var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        if (ptPrevDist > 8 && d > 8) {
          var mid = ptMid();
          zoomAt(mid.x, mid.y, d / ptPrevDist);
        }
        ptPrevDist = d;
        return;
      }
      if (!drag) return;
      var r = svg.getBoundingClientRect();
      var dx = ((e.clientX - drag.x) / r.width) * drag.vb[2];
      var dy = ((e.clientY - drag.y) / r.height) * drag.vb[3];
      cur = [drag.vb[0] - dx, drag.vb[1] - dy, drag.vb[2], drag.vb[3]];
      applyVB();
    });
    function endDrag(e) {
      delete ptActive[e.pointerId];
      if (ptCount() < 2) ptPrevDist = 0;   // 任一指抬起 → 本次手势结束
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

    /* ── 点击：**统一在这里判定选中谁** ──
       为什么不用每个 rect 自己的 click 处理器：SVG 的命中测试只认**最上层**那一个元素。
       任务区域重叠是常态 —— 海关最密处一个点能压着四五个框。只认最上层就意味着
       「下面那几个任务永远点不到」，而这恰恰是读者最需要点准的地方。

       改用 `document.elementsFromPoint()`：它返回该点下的**整叠元素**（不管谁盖着谁），
       于是能把重叠的任务全收集起来：
         · 只压着一个 → 直接选中（保持原有的轻快手感）
         · 压着多个   → 弹一个选择列表，让读者挑（像图形软件里的图层选择）

       另外 `elementsFromPoint` 用的是**屏幕坐标**，缩放平移都不影响 ——
       比「自己拿 viewBox 反算命中区」简单且不会算错。 */
    svg.addEventListener("click", function (e) {
      if (rulerOn) {
        var p = svgPoint(e);
        addRulerPt(p[0], p[1]);
        return;
      }
      hideMarkerPop(); // 点地图任何空白处都收小卡
      var hits = zonesAt(e.clientX, e.clientY);
      if (!hits.length) {
        selectTask(null); // 点空白 = 取消选中
        return;
      }
      if (hits.length === 1) {
        selectTask(hits[0]);
        return;
      }
      showZonePicker(hits, e.clientX, e.clientY);
    });

    /* 双击 = 打开任务详情。同样走 elementsFromPoint，取最上层那个任务。 */
    svg.addEventListener("dblclick", function (e) {
      if (rulerOn) return;
      var hits = zonesAt(e.clientX, e.clientY);
      if (hits.length) {
        location.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(hits[0]);
      }
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
        var show = f.id === id;
        f.el.style.display = show ? "" : "none";
        if (show) loadLazyImages(f.el); // 切到哪层，哪层的位图才开始下载
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

       **绘制顺序 = 命中优先级**：SVG 没有 z-index，后画的在上层、点击时先被命中。
       所以这里**按面积从大到小画** —— 大框在底、小框在顶。反过来的话，
       一个覆盖半张图的击杀区会把下面几十个小框全挡住，那些任务就点不到了。
       （这也是各家地图的共同做法：区域级图层垫底、点级图层在上。）

       尺寸的三处处理，都是实测出来的：
         · **最小可见尺寸按画布比例**，不写死像素 —— 固定 11px 在 1895×1756 的迷宫上
           是 0.6%、在 131×141 的工厂上是 8%，同一个像素值在两种画布上完全不是一回事；
         · **面积分档**（`sz`：s/m/l）交给 CSS：大框退到背景，不跟点级目标抢视线；
         · **超大框本身是语义**，不是坐标错 —— `shoot` 类（「在图里击杀 N 个」）
           中位面积就有画布的 9.6%，而 `plantItem` 只有 0.001%。一个是区域、一个是点。 */
    var qzAll = data.questZones || [];
    var vbw = (data.viewBox || [0, 0, 1000, 600])[2];
    var MIN_PX = Math.max(9, vbw * 0.008); // 画布的 0.8%，但不小于 9px
    /** 千分位。自己算而不用 toLocaleString —— 后者的输出取决于浏览器语言设置，
     *  本站是中文站，固定用「,」比跟随系统更可预期。 */
    function fmtNum(n) {
      var s = String(n == null ? "" : n);
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    var qlayer = el("g", { class: "tk-map__qzones" });
    /* 排序按**显示尺寸**（放大后的），不是原始尺寸 —— 两者会不一致：
       点状目标（w=h=0）原始面积 0、排到最后（最上层，这是对的），
       但放大到 MIN_PX 之后它的显示面积可能超过某个真实的小框；
       若按原始尺寸排，就会出现「看着大、却在上面」的逆序。 */
    function dispArea(z) {
      return Math.max(z.w, MIN_PX) * Math.max(z.h, MIN_PX);
    }
    qzAll
      .slice()
      .sort(function (a, b) {
        return dispArea(b) - dispArea(a); // 大 → 小（大先画，落在下层）
      })
      .forEach(function (z) {
        var w = Math.max(z.w, MIN_PX);
        var h = Math.max(z.h, MIN_PX);
        var r = el("rect", {
          x: (z.x - (w - z.w) / 2).toFixed(1),
          y: (z.y - (h - z.h) / 2).toFixed(1),
          width: w.toFixed(1),
          height: h.toFixed(1),
          class: "tk-zq tk-zq--" + (z.k || "other") + (z.sz ? " tk-zq-" + z.sz : ""),
          "data-q": z.q,
        });
        var tip = z.n + "（" + z.t + "）";
        if (z.px >= 20) {
          /* 区域级目标要说明白 —— 否则读者会以为「这个任务就在这一小块」 */
          tip += "\n⚠ 这是**区域级**目标，占本图约 " + z.px + "% 的面积";
        }
        if (z.d) tip += "\n" + z.d;
        tip += "\n单击=只看这个任务，双击=打开任务详情";
        r.appendChild(el("title", {}, tip));
        qlayer.appendChild(r);
      });
    if (qzAll.length) svg.appendChild(qlayer);

    /* 任务 id → {n 名, en 英文名, kn 钥匙数, pk 需自备, tr 商人, t 类型, nz 几处区域}。
       清单、重叠点选、搜索与出击清单共用。 */
    var zoneByQ = {};
    qzAll.forEach(function (z) {
      if (!zoneByQ[z.q]) {
        zoneByQ[z.q] = {
          q: z.q,
          n: z.n,
          en: z.en || "",
          kn: z.kn || 0, // 钥匙数（任务级，同一任务的区共用）
          pk: z.pk || 0, // 需自备物品
          tr: z.tr || "",
          t: z.t || "",
          nz: 0,
          px: 0,
        };
      }
      zoneByQ[z.q].nz++;
      zoneByQ[z.q].px = Math.max(zoneByQ[z.q].px, z.px || 0);
    });

    /* 任务索引（按商人分组、组内按名字）—— 「任务清单面板」「搜索框」两处共用，
       避免各建一份。定义点在这里（zoneByQ 之后）：控件条在下方才用到它。 */
    var qlist = Object.keys(zoneByQ).map(function (q) {
      return zoneByQ[q];
    });
    qlist.sort(function (a, b) {
      if (a.tr !== b.tr) return a.tr < b.tr ? -1 : 1;
      return a.n < b.n ? -1 : 1;
    });

    /* 屏幕某点下压着哪些任务（**按最上层在前**，同任务的只留一次）。 */
    function zonesAt(cx, cy) {
      if (!document.elementsFromPoint) return [];
      var els = document.elementsFromPoint(cx, cy);
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.classList || !el.classList.contains("tk-zq")) continue;
        var q = el.getAttribute("data-q");
        if (q && out.indexOf(q) < 0) out.push(q);
      }
      return out;
    }

    /* 重叠时的选择列表。
       只在**真的叠了多个**时才出现 —— 单一命中的情况保持原有的「点一下就选中」，不加步骤。 */
    var pickerEl = null;

    function hideZonePicker() {
      if (!pickerEl) return;
      if (pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
      pickerEl = null;
      document.removeEventListener("pointerdown", pickerOutside, true);
    }

    function pickerOutside(e) {
      if (pickerEl && !pickerEl.contains(e.target)) hideZonePicker();
    }

    function showZonePicker(qids, cx, cy) {
      hideZonePicker();
      var box = document.createElement("div");
      box.className = "tk-map__picker";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "重叠的任务");

      var head = document.createElement("div");
      head.className = "tk-map__pickerhead";
      head.textContent = "这里叠着 " + qids.length + " 个任务";
      box.appendChild(head);

      qids.forEach(function (q) {
        var it = zoneByQ[q] || { n: q, t: "", nz: 1, px: 0 };
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tk-qp";
        var nm = document.createElement("b");
        nm.textContent = it.n;
        b.appendChild(nm);
        var ii = document.createElement("i");
        ii.textContent =
          (it.tr ? it.tr + " · " : "") +
          it.t +
          (it.nz > 1 ? " · " + it.nz + " 处" : "") +
          (it.px >= 20 ? " · 区域级" : "");
        b.appendChild(ii);
        if (it.px >= 20) b.classList.add("is-huge");
        b.addEventListener("click", function (ev) {
          ev.stopPropagation();
          hideZonePicker();
          selectTask(q);
        });
        box.appendChild(b);
      });

      var foot = document.createElement("div");
      foot.className = "tk-map__pickerfoot";
      foot.textContent = "Esc 或点别处关闭";
      box.appendChild(foot);

      box.style.position = "fixed";
      box.style.visibility = "hidden";
      document.body.appendChild(box);
      pickerEl = box;

      /* 定位：默认落在指针右下；贴边时翻到另一侧，不盖住点击处。 */
      var pad = 10;
      var bw = box.offsetWidth,
        bh = box.offsetHeight;
      var left = cx + 12,
        top = cy + 12;
      if (left + bw > window.innerWidth - pad) left = Math.max(pad, cx - bw - 12);
      if (top + bh > window.innerHeight - pad) top = Math.max(pad, cy - bh - 12);
      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.visibility = "";

      setTimeout(function () {
        document.addEventListener("pointerdown", pickerOutside, true);
      }, 0);
    }

    /* Esc 关掉选择列表。**监听器只装一次** —— instant 换页会重放本脚本，
       不挡住的话每进一次地图页就多挂一个回调。 */
    if (!escBound) {
      escBound = true;
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (liveHidePicker) liveHidePicker();
        if (liveHidePop) liveHidePop();
      });
    }
    liveHidePicker = hideZonePicker;

    /* ── 标记小卡：点地名 / 撤离点 / 转场点弹出「这是什么 + 去哪读」──
       为什么不直接跳转：条目页的标题锚点是**位置式**的（_1/_2……加一个标题
       就全体错位），而误点一次就翻页走、地图状态全丢，比多看一步更糟。
       所以学 the-hideout.io：点标记 → 小卡 → 卡里给**稳定**的条目链接。
       与重叠点选列表共用一套定位逻辑（指针右下、贴边翻转）。 */
    var popEl = null;

    function hideMarkerPop() {
      if (!popEl) return;
      if (popEl.parentNode) popEl.parentNode.removeChild(popEl);
      popEl = null;
      document.removeEventListener("pointerdown", popOutside, true);
    }

    function popOutside(e) {
      if (popEl && !popEl.contains(e.target)) hideMarkerPop();
    }

    function showMarkerPop(title, lines, links, cx, cy) {
      hideMarkerPop();
      var box = document.createElement("div");
      box.className = "tk-map__pop";
      box.setAttribute("role", "dialog");
      var h = document.createElement("b");
      h.textContent = title;
      box.appendChild(h);
      lines.forEach(function (t) {
        if (!t) return;
        var p = document.createElement("p");
        p.textContent = t;
        box.appendChild(p);
      });
      links.forEach(function (lk) {
        var a = document.createElement("a");
        a.href = lk.href;
        a.textContent = lk.text;
        box.appendChild(a);
      });
      var foot = document.createElement("div");
      foot.className = "tk-map__popfoot";
      foot.textContent = "Esc 或点别处关闭";
      box.appendChild(foot);

      box.style.position = "fixed";
      box.style.visibility = "hidden";
      document.body.appendChild(box);
      popEl = box;

      var pad = 10;
      var bw = box.offsetWidth,
        bh = box.offsetHeight;
      var left = cx + 12,
        top = cy + 12;
      if (left + bw > window.innerWidth - pad) left = Math.max(pad, cx - bw - 12);
      if (top + bh > window.innerHeight - pad) top = Math.max(pad, cy - bh - 12);
      box.style.left = left + "px";
      box.style.top = top + "px";
      box.style.visibility = "";

      setTimeout(function () {
        document.addEventListener("pointerdown", popOutside, true);
      }, 0);
    }
    liveHidePop = hideMarkerPop;

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
    /* 默认进度筛选（2026-10-17，读者反馈「打开地图没先看到我进行中的任务」）：
       有进行中的任务时，默认切到「只看进行中」—— 打开一张图先看到的是
       「我手上这几票在哪」，而不是上百个方框。没有进行中的任务（没记过进度、
       或这张图上恰好没有）就保持「全部」，新读者仍然看到完整的一张图。
       只在**首次挂载**算一次：之后读者手选过筛选、或另一个标签页改进度触发
       liveFilter 时都不再改 —— 不把视图从读者脚下抽走。
       deep link（?q=）不受影响：selected 的显示优先级本来就高于 qzFilter。 */
    (function () {
      var snapInit = progressSnap();
      if (!snapInit) return;
      for (var iInit = 0; iInit < qlist.length; iInit++) {
        if (stateOf(snapInit, qlist[iInit].q) === "inhand") {
          qzFilter = "inhand";
          return;
        }
      }
    })();
    var selected = null; // 选中的任务 id；一非空就切到「只看这一个」
    var qzCount = null; // 控件条上的计数元素，建控件时才赋值

    /* ── 出击清单（多任务同图）──
       planSet 是「这局要做的任务」集合，planOnly 是「图上只画这些」的开关。
       与 selected 的分工：selected 回答「我在看哪一个」，planSet 回答
       「这局要干哪几票」—— 一次 raid 同时推进几个任务时，前者不够用。
       planOnly 优先于 selected：规划视图里点单个区域只是看信息卡，
       不打断全图视野；点清单行 / 搜索结果则退出规划视图（意图是「看这一个」）。 */
    var planSet = {};
    var planOnly = false;

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
        r.classList.toggle("is-sel", !planOnly && selected === q);
        r.classList.toggle("is-plan", planOnly && !!planSet[q]);
        /* 选中时筛选退居其次：读者点某个区域，意图是「看这个」，
           不是「在这个基础上再筛一层」 */
        var ok = planOnly
          ? !!planSet[q]
          : selected
            ? q === selected
            : qzFilter === "all" ||
              (qzFilter === "open" && st !== "done") ||
              (qzFilter === "inhand" && st === "inhand");
        r.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (qzCount) {
        qzCount.textContent = planOnly
          ? "只看出击清单的 " + Object.keys(planSet).length + " 个任务"
          : selected
            ? "只看选中的这 1 个任务"
            : qzFilter === "all"
              ? qzAll.length + " 个目标区域"
              : shown + " / " + qzAll.length + " 个目标区域";
      }
      /* 进度快照这里已经取了一份，顺手把下方清单的三态徽章、组内完成度与
         筛选条计数一起刷掉 —— 别处（另一个标签页）改进度时走的也是这条路。 */
      if (pbody && refreshPanelStates) refreshPanelStates();
    }

    /* ── 选中某个任务：只显示它 + 出一张信息卡 ── */
    var cardHost = null;
    var rowEls = [];   // 下方清单的行引用（{q, el, grp}），建清单时填充
    var grpRefs = [];  // 组头引用（{el, name}）
    var pbody = null;  // 清单面板 body（未建时为 null，applyQzFilter 靠它判存在）
    /* 清单的刷新函数**建好时才赋值** —— 本文件顶层的 liveFilter 同一套写法：
       "use strict" 下块内 function 声明是块级作用域，applyQzFilter（render 作用域）
       直接调会 ReferenceError，所以用指针绕一手。 */
    var refreshPanelStates = null;
    var applyPanelFilter = null;
    var refreshPlanUI = null; // 出击清单的行勾选与汇总条（建面板时赋值）

    /* 出击清单三个操作。都走 applyQzFilter + refreshPlanUI 两条刷新路，
       和 selectTask 一个模式 —— 状态改完，图与清单必须同时跟上。 */
    function planToggle(qid) {
      if (planSet[qid]) delete planSet[qid];
      else planSet[qid] = true;
      /* 清空了就自动退出「只看这些」—— 不然图上会一片空白 */
      if (!Object.keys(planSet).length) planOnly = false;
      applyQzFilter();
      if (refreshPlanUI) refreshPlanUI();
    }

    function planSetOnly(on) {
      if (!Object.keys(planSet).length) return;
      planOnly = on;
      applyQzFilter();
      if (refreshPlanUI) refreshPlanUI();
    }

    function planClear() {
      planSet = {};
      planOnly = false;
      applyQzFilter();
      if (refreshPlanUI) refreshPlanUI();
    }

    function selectTask(qid) {
      hideZonePicker();
      selected = qid || null;
      applyQzFilter();
      renderCard();
      /* 清单里那把选中的行标出来 —— 图上只剩它，清单里也要能找到它 */
      rowEls.forEach(function (r) {
        r.el.classList.toggle("is-sel", selected === r.q);
      });
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
      /* 行前提示：钥匙与自备物品 —— 与清单行同一套数据（questZones 的 kn/pk） */
      if (head.kn) badges.push(["钥匙 " + head.kn, "--key"]);
      if (head.pk) badges.push(["需自备物品", "--pack"]);
      if (planSet[selected]) badges.push(["在出击清单中", "--plan"]);
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

      /* 在出击清单里时，卡片上给一个直接移除的口子 ——
         「不选它了」不该逼读者回清单里找那一行 */
      if (planSet[selected]) {
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "tk-map__cardclear";
        rm.textContent = "从出击清单移除";
        rm.addEventListener("click", function () {
          planToggle(selected);
        });
        cardHost.appendChild(rm);
      }
    }

    /* ── 标注避让（declutter）：字放不下就先藏，记号永远在 ──
       痛点：地名、撤离点、转场点的文字都画在记号旁边，而工厂这类小图
       一屏塞下 27 个地名 + 19 个撤离点，默认视图里文字互相压住，谁也读不了。
       做法（标准地图行为）：
       · 文字相对记号的偏移按**屏幕像素**钉死（12px / 8px），任何图、任何缩放一致
         —— 偏移量 = px ÷ --tk-k（--tk-k 现在就是「每用户单位多少屏幕像素」）；
       · 每次视图变化后在屏幕空间做**贪心避让**：优先级高的先占位，
         放不下的文字先隐藏、只留记号；放大后空间够了自然浮现；
       · 记号（圆点 / 方块 / 三角）**永远显示** —— 点位重叠是数据事实，
         隐藏记号就是说谎；被避让的只是字；
       · 优先级：撤离点 > 转场点 > 地名（行动信息优先于地形信息），
         同级按上游数据顺序（稳定、可复现）；
       · 搜索 / 点击定位的那个标签**强制显示**一次（_force），不被避让挤掉。 */
    var labelItems = []; // {t, ax, ay, kind, text, fs, dx, dy, _force}
    var labelIndex = new Map(); // 数据对象（lb / extract / transit）→ item

    /* 屏幕宽估算：CJK 全宽、ASCII 半宽。不用 getBBox/getClientRect ——
       每帧对上百个 text 调它太贵，估算够避让用了（盒还额外留 10% 余量）。 */
    function estTextW(s, fs) {
      var w = 0;
      for (var i = 0; i < s.length; i++) {
        w += s.charCodeAt(i) > 0x2e7f ? fs : fs * 0.58;
      }
      return w;
    }

    function regLabel(dataObj, t, ax, ay, kind, dx, dy) {
      var it = {
        t: t,
        ax: ax,
        ay: ay,
        kind: kind,
        text: t.textContent,
        fs: kind === "label" ? 13.5 : 10.5,
        dx: dx,
        dy: dy,
      };
      it.w = estTextW(it.text, it.fs);
      labelItems.push(it);
      if (dataObj) labelIndex.set(dataObj, it);
      return it;
    }

    var PRIO = { extract: 0, transit: 1, label: 2 };

    var layoutPending = false;
    function scheduleLayout() {
      if (layoutPending) return;
      layoutPending = true;
      requestAnimationFrame(function () {
        layoutPending = false;
        layoutLabels();
      });
    }

    function layoutLabels() {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      /* `--tk-k` = 当前每 SVG 用户单位对应多少屏幕像素（画布宽 ÷ 视野宽）。
         CSS 里所有标注尺寸都写 `calc(Npx / var(--tk-k))`，两相抵消后
         标注恒等于 N **屏幕像素** —— 与「哪张图」「缩到多深」都无关。
         ⚠️ 旧语义（相对初始视野的放大倍数）是个 bug：工厂 viewBox 宽仅 130、
         街区宽 3000+，同一个 `calc(13.5px / k)` 在工厂渲染成约 90px 的巨字
         （标签糊死整张图）、在街区只有约 4px（蚂蚁字）。屏幕锚定后两边一致。 */
      var k = r.width / cur[2]; // 每用户单位多少屏幕像素
      svg.style.setProperty("--tk-k", k.toFixed(3));
      if (!labelItems.length) {
        updateScalebar(r, k);
        return;
      }
      var placed = [];
      var PAD = 2;
      var order = labelItems.slice().sort(function (a, b) {
        return PRIO[a.kind] - PRIO[b.kind];
      });
      order.forEach(function (it) {
        var sx = ((it.ax - cur[0]) / cur[2]) * r.width;
        var sy = ((it.ay - cur[1]) / cur[3]) * r.height;
        /* 视口外的字直接藏（记号反正也被 viewBox 剪掉了） */
        if (
          sx < -80 || sx > r.width + 80 ||
          sy < -60 || sy > r.height + 60
        ) {
          it.t.setAttribute("display", "none");
          return;
        }
        /* 文字定位：偏移换算成用户单位（px ÷ k），任何缩放下都是恒定屏幕偏移 */
        it.t.setAttribute("x", (it.ax + (it.dx / k)).toFixed(2));
        it.t.setAttribute("y", (it.ay + (it.dy / k)).toFixed(2));
        /* 文字屏幕盒：地名以 (dx,dy) 为中心（text-anchor=middle），
           撤离/转场以它为左基线（SVG text 默认对齐） */
        var w = it.w + PAD * 2;
        var h = it.fs * 1.25 + PAD * 2;
        var bx = it.kind === "label" ? sx + it.dx - w / 2 : sx + it.dx - PAD;
        var by = it.kind === "label" ? sy + it.dy - h / 2 : sy + it.dy - it.fs - PAD;
        var hit = it._force;
        if (!hit) {
          for (var i = 0; i < placed.length; i++) {
            var p = placed[i];
            if (bx < p[0] + p[2] && bx + w > p[0] && by < p[1] + p[3] && by + h > p[1]) {
              hit = true;
              break;
            }
          }
        }
        if (hit) {
          it.t.setAttribute("display", "none");
        } else {
          it.t.removeAttribute("display");
          placed.push([bx, by, w, h]);
        }
      });
      /* _force 是「定位时保显一次」：这次布局用完即清，不长期霸位 */
      labelItems.forEach(function (it) {
        it._force = false;
      });
      updateScalebar(r, k);
    }

    /* ── 比例尺 ──
       与测距同源（同一份 mpp：每用户单位多少米，x/z 方向分别给出），
       尺子取横向（x 方向）。刻度选「好看的整数」：在 50–160px 里挑最长的
       那档（20/50/100/200/500/1000/2000/5000 m），随缩放实时换档。 */
    var scalebar = null;
    var SB_CAND = [20, 50, 100, 200, 500, 1000, 2000, 5000];
    function updateScalebar(r, k) {
      if (!scalebar) return;
      var mpp = (data.mpp || [1, 1])[0]; // 米 / 用户单位（横向）
      if (!mpp || mpp <= 0) return;
      var best = SB_CAND[0];
      for (var i = 0; i < SB_CAND.length; i++) {
        var px = (SB_CAND[i] / mpp) * k;
        if (px <= 160) best = SB_CAND[i];
      }
      var pxW = Math.round((best / mpp) * k);
      if (pxW < 8) {
        scalebar.style.display = "none";
        return;
      }
      scalebar.style.display = "";
      scalebar.style.width = pxW + "px";
      scalebar.textContent = best >= 1000 ? best / 1000 + " km" : best + " m";
    }

    /* ── 点位层 ── */
    var pins = el("g", { class: "tk-map__pins" });
    (data.labels || []).forEach(function (lb) {
      var g = el("g", { class: "tk-map__pin" });
      g.appendChild(el("circle", { cx: lb.x, cy: lb.y, r: 5 }));
      /* 文字的 x/y 由避让布局每帧按屏幕偏移换算设置（这里只是首帧兜底） */
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
      var lbText = g.querySelector("text");
      regLabel(lb, lbText, lb.x, lb.y, "label", 0, -12);
      var title = el("title", {}, lb.cn ? lb.cn + "（" + lb.en + "）" : lb.en);
      title.appendChild(
        document.createTextNode("\n点击查看本地图的百科条目")
      );
      g.appendChild(title);
      /* 点击弹小卡（见 showMarkerPop）：给一个稳定的条目入口。
         条目链接用 maps-data 的 entry 字段（gen_maps.py 的 MAP_ENTRY）。
         **不取消当前选中** —— 选中态是「我在看哪个任务」，与「看这个地方」
         是两件事；硬清掉会让图突然从「只剩一个任务」炸回全部区域。 */
      g.style.cursor = "pointer";
      g.addEventListener("click", function (e) {
        e.stopPropagation();
        hideMarkerPop();
        var it = labelIndex.get(lb);
        if (it) it._force = true; // 定位到的标签这次保显，不被避让挤掉
        focusPoint(lb.x, lb.y);
        var lines = [];
        if (lb.cn) lines.push("英文名 " + lb.en);
        else lines.push("上游名 " + lb.en);
        var links = [];
        if (data.entry) {
          links.push({
            href: siteRoot() + "entries/" + data.entry + "/",
            text: "查看本地图条目 →",
          });
        }
        showMarkerPop(lb.cn || lb.en, lines, links, e.clientX, e.clientY);
      });
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
        /* data-key：锁点的钥匙物品 id。?key= 深链（钥匙页「所在图」列 /
           物品详情「在哪用它」段）按它高亮 —— 见本函数尾部的深链处理。 */
        "data-key": lk.k || "",
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
      /* 名字文字进避让池：撤离点是行动信息，优先级最高（见 PRIO） */
      regLabel(e, g.querySelector("text"), e.p[0], e.p[1], "extract", 8, 4);
      var etip = e.fzh + " 撤离点：" + (e.nzh || e.n);
      /* 多版本图（工厂日/夜、中心区低等级/高难）各版本的撤离点列表不同。
         只标「不是两个版本都有」的那些 —— 标注出来，读者才知道
         「这个出口在我进的那个版本里到底有没有」。实测工厂的「2 号门」只在日间版。 */
      if (e.vzh) etip += "\n⚠ " + e.vzh + (e.vmiss ? "，缺 " + e.vmiss : "");
      /* 缴费要求：车辆撤离要卢布、部分秘密出口要特定物品。
         **PvE 与 PvP 的车辆撤离费用不同**（实测 4 张图：PvE 5,000 / PvP 20,000），
         而海关与立交桥的两个 V-Exit 两边都是 20,000 —— 所以**逐个标，不做全局结论**。 */
      if (e.pay) {
        var pzh = e.pay.zh || "特定物品";
        etip += "\n需缴纳 " + fmtNum(e.pay.n) + " " + pzh;
        if (e.pay.pve) {
          etip += "　⚠ PvE 模式只需 " + fmtNum(e.pay.pve) + " " + pzh;
        }
      }
      etip += "\n（上游名：" + e.n + "）";
      etip += "\n点击查看撤离条件详解";
      g.appendChild(el("title", {}, etip));
      /* 点击弹小卡 → 链到撤离点详解（跨图的统一入口，不做每图锚点） */
      g.style.cursor = "pointer";
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        hideMarkerPop();
        var it = labelIndex.get(e);
        if (it) it._force = true;
        focusPoint(e.p[0], e.p[1]);
        var lines = [e.fzh + " 撤离点：" + (e.nzh || e.n)];
        if (e.vzh) lines.push("⚠ " + e.vzh + (e.vmiss ? "，缺 " + e.vmiss : ""));
        if (e.pay) {
          var pzh2 = e.pay.zh || "特定物品";
          lines.push("需缴纳 " + fmtNum(e.pay.n) + " " + pzh2
            + (e.pay.pve ? "　⚠ PvE 模式只需 " + fmtNum(e.pay.pve) + " " + pzh2 : ""));
        }
        showMarkerPop(e.nzh || e.fzh, lines, [{
          href: siteRoot() + "entries/extraction-points/",
          text: "撤离点详解 →",
        }], ev.clientX, ev.clientY);
      });
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
      regLabel(tr, g.querySelector("text"), tr.p[0], tr.p[1], "transit", 9, 4);
      var ttip = tr.nzh + "（转场：不结束战局直接换图）\n点击查看转场说明";
      g.appendChild(el("title", {}, ttip));
      g.style.cursor = "pointer";
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        hideMarkerPop();
        var it = labelIndex.get(tr);
        if (it) it._force = true;
        focusPoint(tr.p[0], tr.p[1]);
        /* to 为空 = 上游没标明去向：不写「前往 XX」，明说没有 */
        var trTitle = tr.to ? "前往 " + tr.nzh : tr.nzh;
        showMarkerPop(trTitle, ["转场点：不结束战局直接换图"], [{
          href: siteRoot() + "entries/transit/",
          text: "转场与 BTR →",
        }], ev.clientX, ev.clientY);
      });
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
      ].forEach(function (pair) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = pair[0];
        /* 初始高亮跟随**实际的** qzFilter —— 有进行中的任务时它可能
           不是 "all"（见上面的「默认进度筛选」），写死 i===0 会让按钮
           状态和图上画的东西对不上。 */
        if (pair[1] === qzFilter) b.classList.add("is-on");
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

    /* ── 任务搜索：按名字找到 → 直接在地图上只看它 ──
       解决的具体问题：海关一张图有 116 个任务区域，「知道任务名、想在图上找它」
       此前只能靠肉眼在上百个方框里翻，或者展开任务清单逐行扫。
       搜索框把这条路缩成「输入名字 → 选一下 → 只剩它 + 信息卡 + 视图过去」。
       中英都能搜（questZones 带 en 字段，与任务图鉴总览同一口径）；
       商人名也参与匹配 —— 只记得「Mechanic 给的」时同样能列出他的任务。
       2026-10-14 起**地名锚点也进同一个框**（P2-3）：搜「宿舍」直接定位到那片区域，
       不必先去任务清单里碰运气。物品搜索没有做 —— 上游容器数据只给位置不给类型，
       做了就是「画得出来不等于值得画」的反面（总览页有说明）。 */
    if (qlist.length) {
      var sWrap = document.createElement("div");
      sWrap.className = "tk-map__seg tk-map__seg--search";

      var sInput = document.createElement("input");
      sInput.type = "search";
      sInput.className = "tk-map__sq";
      sInput.placeholder = "搜任务名 / 地名…";
      sInput.autocomplete = "off";
      sInput.setAttribute("aria-label", "搜索这张图上的任务（中文或英文名）或地名");
      sWrap.appendChild(sInput);

      var sDrop = document.createElement("div");
      sDrop.className = "tk-map__sdrop";
      sDrop.setAttribute("role", "listbox");
      sDrop.hidden = true;
      sWrap.appendChild(sDrop);
      bar.appendChild(sWrap);

      var S_MAX = 10; // 任务下拉最多列几条 —— 再多就该继续输入，不是继续翻
      var L_MAX = 5;  // 地名同理，且地名是辅助入口，更短

      function questMatches(kw) {
        kw = kw.trim().toLowerCase();
        if (!kw) return [];
        var out = [];
        for (var i = 0; i < qlist.length; i++) {
          var it = qlist[i];
          if ((it.n + " " + it.en + " " + it.tr).toLowerCase().indexOf(kw) >= 0) {
            out.push(it);
            if (out.length >= S_MAX) break;
          }
        }
        return out;
      }

      function labelMatches(kw) {
        kw = kw.trim().toLowerCase();
        if (!kw) return [];
        var out = [];
        var lbs = data.labels || [];
        for (var i = 0; i < lbs.length; i++) {
          if ((lbs[i].cn + " " + lbs[i].en).toLowerCase().indexOf(kw) >= 0) {
            out.push(lbs[i]);
            if (out.length >= L_MAX) break;
          }
        }
        return out;
      }

      function hideSDrop() {
        sDrop.hidden = true;
        sDrop.innerHTML = "";
      }

      function renderSDrop() {
        sDrop.innerHTML = "";
        if (!sInput.value.trim()) {
          hideSDrop();
          return;
        }
        var ms = questMatches(sInput.value);
        var ls = labelMatches(sInput.value);
        if (!ms.length && !ls.length) {
          var none = document.createElement("div");
          none.className = "tk-map__sdrop-empty";
          none.textContent = "没有匹配的任务或地名";
          sDrop.appendChild(none);
        } else {
          /* 两组结果（任务 / 地名）各带组头 —— 混在一起会分不清
             「点它是选中任务」还是「点它定位地方」 */
          if (ms.length) {
            var gh = document.createElement("div");
            gh.className = "tk-map__sdrop-grp";
            gh.textContent = "任务";
            sDrop.appendChild(gh);
            ms.forEach(function (it) {
              var b = document.createElement("button");
              b.type = "button";
              b.className = "tk-qp";
              b.setAttribute("role", "option");
              var bn = document.createElement("b");
              bn.textContent = it.n;
              b.appendChild(bn);
              /* 搜索结果也带进度徽章 —— 与下方清单同一套三态 */
              var bst = document.createElement("span");
              bst.className = "tk-qp__st";
              var st = stateOf(progressSnap(), it.q) || "none";
              bst.textContent = st === "done" ? "已完成" : st === "inhand" ? "进行中" : "未标记";
              bst.classList.add("tk-qp__st--" + st);
              b.appendChild(bst);
              /* 行前提示：钥匙 / 自备（P0-1 与清单行、信息卡同源） */
              if (it.kn) {
                var kb = document.createElement("span");
                kb.className = "tk-qp__key";
                kb.textContent = "钥匙 " + it.kn;
                b.appendChild(kb);
              }
              if (it.pk) {
                var pb2 = document.createElement("span");
                pb2.className = "tk-qp__pack";
                pb2.textContent = "自备";
                b.appendChild(pb2);
              }
              var bi = document.createElement("i");
              bi.textContent =
                (it.tr ? it.tr + " · " : "") +
                it.t +
                (it.nz > 1 ? " · " + it.nz + " 处" : "");
              b.appendChild(bi);
              b.addEventListener("click", function () {
                pickQuest(it.q);
              });
              sDrop.appendChild(b);
            });
            if (ms.length >= S_MAX) {
              var more = document.createElement("div");
              more.className = "tk-map__sdrop-foot";
              more.textContent = "仅显示前 " + S_MAX + " 条 —— 继续输入可缩小范围";
              sDrop.appendChild(more);
            }
          }
          if (ls.length) {
            var lh = document.createElement("div");
            lh.className = "tk-map__sdrop-grp";
            lh.textContent = "地名";
            sDrop.appendChild(lh);
            ls.forEach(function (lb) {
              var b2 = document.createElement("button");
              b2.type = "button";
              b2.className = "tk-qp";
              b2.setAttribute("role", "option");
              var bn2 = document.createElement("b");
              bn2.textContent = lb.cn || lb.en;
              b2.appendChild(bn2);
              var bi2 = document.createElement("i");
              bi2.textContent = lb.cn ? lb.en : "上游地名";
              b2.appendChild(bi2);
              b2.addEventListener("click", function () {
                pickLabel(lb);
              });
              sDrop.appendChild(b2);
            });
          }
        }
        sDrop.hidden = false;
      }

      /* 选中任务：只剩它 + 信息卡 + 视图过去 —— 一次搜索的完整收尾。
         同时退出规划视图：搜索的意图是「看这一个」，不是「在规划里翻」。 */
      function pickQuest(qid) {
        hideSDrop();
        sInput.value = "";
        planOnly = false;
        selectTask(qid);
        focusZone(qid);
        if (refreshPlanUI) refreshPlanUI();
      }

      /* 选地名：视图过去 + 小卡（给条目入口）。不选中任何任务 ——
         「看地方」与「看任务」是两条线，别把任务筛选状态改掉。 */
      function pickLabel(lb) {
        hideSDrop();
        sInput.value = "";
        hideMarkerPop();
        var it = labelIndex.get(lb);
        if (it) it._force = true; // 搜到的地名保显一次，不被避让挤掉
        focusPoint(lb.x, lb.y);
        var links = [];
        if (data.entry) {
          links.push({
            href: siteRoot() + "entries/" + data.entry + "/",
            text: "查看本地图条目 →",
          });
        }
        var b = sInput.getBoundingClientRect();
        showMarkerPop(lb.cn || lb.en, [lb.cn ? "英文名 " + lb.en : "上游名 " + lb.en],
          links, b.left, b.bottom);
      }

      sInput.addEventListener("input", renderSDrop);
      sInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          /* 回车取第一条：唯一命中时零操作，多个命中时先给最相关的那个。
             任务优先于地名 —— 「回车定位」的主路径是任务。 */
          var ms = questMatches(sInput.value);
          if (ms.length) {
            e.preventDefault();
            pickQuest(ms[0].q);
          } else {
            var ls = labelMatches(sInput.value);
            if (ls.length) {
              e.preventDefault();
              pickLabel(ls[0]);
            }
          }
        } else if (e.key === "Escape") {
          sInput.value = "";
          hideSDrop();
        }
      });
      /* 焦点离开就收下拉。用 blur + 延时而不是 document 捕获：点下拉项的
         瞬间会先 blur，延时 150ms 足够让 click 落到按钮上（item 自己的
         pickQuest 会顺手清空输入框）。 */
      sInput.addEventListener("blur", function () {
        setTimeout(hideSDrop, 150);
      });
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
      /* 任务区域也是一层：想纯看地形时整个关掉 ——
         「百来个彩色方框全开」是默认视图糊成一片的另一半原因。 */
      ["任务区域", qlayer, qzAll.length, ""],
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

    /* ── 任务清单面板：地图下方的「控制台」 ──
       参考 eftarkov.com 的地图工具（它右侧那栏「任务 / 剧情目标」）：
       **先在列表里按名字找到任务，再回图上定位**，比在百来个方框里找快得多。
       本站没有侧栏（正文区约 900px），所以放在**地图下方**。

       2026-10-14 起它从「入口」升级为「控制台」：
         · **默认展开** —— 选任务是主操作，不该藏在一次点击后面；
         · 带**进度三态**（未标记／进行中／已完成）与商人组内的完成度，
           数据就是「我的进度」那份 localStorage（questZones 与进度页同一套任务 id），
           「这张图我还剩什么没清」一眼可读；
         · 点一行 → 上面地图只剩它 + 视图自动定位；**不再自动收起** ——
           连挑几个任务是常见动作，每点一次就收起没法用；
         · 进度仍是**只读**的：勾选与取消在「我的进度」页做（两页实时同步），
           这条边界写在总览页，不在这里破。 */
    if (qlist.length) {
      var panel = document.createElement("div");
      panel.className = "tk-map__panel";

      var phead = document.createElement("button");
      phead.type = "button";
      phead.className = "tk-map__panelhead";
      phead.setAttribute("aria-expanded", "true");
      var pt = document.createElement("b");
      pt.textContent = "这张图上的任务 · " + qlist.length + " 个";
      phead.appendChild(pt);
      /* 本图完成度：细条 + 「已完成 n / 总数」。**个人数据只能 JS 画** ——
         静态数据表是生成物，放不了它；放头上是因为「这张图清了百分之几」
         是打开面板第一眼想看到的事。 */
      var progWrap = document.createElement("span");
      progWrap.className = "tk-map__panelprog";
      var progBar = document.createElement("i");
      var progFill = document.createElement("i");
      progBar.appendChild(progFill);
      var progN = document.createElement("em");
      progWrap.appendChild(progBar);
      progWrap.appendChild(progN);
      phead.appendChild(progWrap);
      var pv = document.createElement("span");
      pv.textContent = "收起清单";
      phead.appendChild(pv);

      /* ── 出击清单汇总条 ──
         **钉在筛选条上方、不随列表滚动**；面板收起时也**保持可见** ——
         它是「当前有规划」的常驻提醒，收了清单不该连状态一起看不见。
         没有规划时整条隐藏，不占地方。 */
      var planStrip = document.createElement("div");
      planStrip.className = "tk-map__plan";
      planStrip.hidden = true;
      var psTitle = document.createElement("b");
      planStrip.appendChild(psTitle);
      var psCount = document.createElement("span");
      planStrip.appendChild(psCount);
      var psOnly = document.createElement("button");
      psOnly.type = "button";
      psOnly.className = "tk-map__planbtn tk-map__planbtn--primary";
      psOnly.addEventListener("click", function () {
        planSetOnly(!planOnly);
      });
      planStrip.appendChild(psOnly);
      var psClear = document.createElement("button");
      psClear.type = "button";
      psClear.className = "tk-map__planbtn";
      psClear.textContent = "清空";
      psClear.addEventListener("click", planClear);
      planStrip.appendChild(psClear);

      /* 进度筛选条：**钉在清单顶部、不随列表滚动**（放在滚动容器外面）。
         与控件条那组「任务点位」筛选是两回事：那组管**图上画哪些区域**，
         这组管**清单列哪些行**。按钮沿用「我的进度」页的 tk-qseg，
         三态配色也一致（未标记灰／进行中琥珀／已完成绿）。 */
      var pchips = document.createElement("div");
      pchips.className = "tk-map__panelchips";
      pchips.setAttribute("role", "group");
      pchips.setAttribute("aria-label", "按进度筛选清单");

      pbody = document.createElement("div");
      pbody.className = "tk-map__panelbody";
      pbody.hidden = false; // 默认展开：它现在是主操作面，不是入口

      var plFilter = "all"; // all | none | inhand | done
      var chipEls = {};
      [
        ["all", "全部"],
        ["none", "未标记"],
        ["inhand", "进行中"],
        ["done", "已完成"],
      ].forEach(function (pair) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "tk-qseg tk-qseg--" + pair[0];
        c.setAttribute("aria-pressed", pair[0] === "all" ? "true" : "false");
        c.addEventListener("click", function () {
          plFilter = pair[0];
          Object.keys(chipEls).forEach(function (k) {
            chipEls[k].setAttribute("aria-pressed", k === plFilter ? "true" : "false");
          });
          applyPanelFilter(progressSnap());
        });
        chipEls[pair[0]] = c;
        pchips.appendChild(c);
      });

      /* 空结果提示：筛到某个进度下没有任务时要说一句，别留一片空白 */
      var pempty = document.createElement("div");
      pempty.className = "tk-map__pempty";
      pempty.hidden = true;
      pbody.appendChild(pempty);

      var curTrader = null;
      var curGrpIdx = -1; // 行记**组的序号**、不记元素 —— 元素当对象键会被
                          // 统一转成 "[object HTMLDivElement]"，所有组累计到同一键下
      qlist.forEach(function (it) {
        if (it.tr && it.tr !== curTrader) {
          curTrader = it.tr;
          var g = document.createElement("div");
          g.className = "tk-qp-grp";
          var gName = document.createElement("span");
          gName.textContent = curTrader;
          var gBar = document.createElement("i");
          gBar.className = "tk-qp-grp__bar";
          var gFill = document.createElement("i");
          gBar.appendChild(gFill);
          var gN = document.createElement("em");
          g.appendChild(gName);
          g.appendChild(gBar);
          g.appendChild(gN);
          pbody.appendChild(g);
          grpRefs.push({ el: g, name: curTrader, n: gN, bar: gFill });
          curGrpIdx = grpRefs.length - 1;
        }
        /* 行 = 勾选钮 + 任务钮。分成两个按钮而不是行内嵌复选框：
           <button> 里嵌交互控件是非法 HTML，且点错一次就选中任务会很烦。 */
        var rowWrap = document.createElement("div");
        rowWrap.className = "tk-qp-row";
        var planBtn = document.createElement("button");
        planBtn.type = "button";
        planBtn.className = "tk-qp__plan";
        planBtn.setAttribute("aria-pressed", "false");
        planBtn.title = "加入出击清单（可多选，地图上同时显示）";
        planBtn.textContent = "+";
        planBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          planToggle(it.q);
        });
        rowWrap.appendChild(planBtn);

        var b = document.createElement("button");
        b.type = "button";
        b.className = "tk-qp";
        b.setAttribute("data-q", it.q);
        var bn = document.createElement("b");
        bn.textContent = it.n;
        b.appendChild(bn);
        var bst = document.createElement("span");
        bst.className = "tk-qp__st";
        b.appendChild(bst);
        /* 行前提示（P0-1）：钥匙 / 自备。多数任务两样都没有，行保持干净 */
        if (it.kn) {
          var kb = document.createElement("span");
          kb.className = "tk-qp__key";
          kb.textContent = "钥匙 " + it.kn;
          kb.title = "需要 " + it.kn + " 把钥匙（逐条列在任务详情里）";
          b.appendChild(kb);
        }
        if (it.pk) {
          var pb = document.createElement("span");
          pb.className = "tk-qp__pack";
          pb.textContent = "自备";
          pb.title = "需要从仓库带进图 —— 漏带等于白跑一趟";
          b.appendChild(pb);
        }
        var bi = document.createElement("i");
        bi.textContent = it.t + " · " + it.nz + " 处";
        b.appendChild(bi);
        b.addEventListener("click", function () {
          /* 点行 = 「看这一个」：退出规划视图再选中。规划视图仍在
             「只看这些」按钮上等着，不丢。 */
          planOnly = false;
          selectTask(it.q);
          focusZone(it.q);
          if (refreshPlanUI) refreshPlanUI();
          /* 地图在上方 —— 点完把它带回视口（只在看不见时才滚，不抢滚动位置） */
          if (canvas.scrollIntoView) {
            canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        });
        rowWrap.appendChild(b);
        pbody.appendChild(rowWrap);
        rowEls.push({ q: it.q, el: b, planBtn: planBtn, grp: curGrpIdx });
      });

      /* 页脚：把「只读」这条边界写在离操作最近的地方 */
      var pfoot = document.createElement("div");
      pfoot.className = "tk-map__panelfoot";
      pfoot.appendChild(document.createTextNode("进度三态与「我的进度」页实时同步（本机存储）—— 勾选与取消在那边的页面做："));
      var plink = document.createElement("a");
      plink.href = siteRoot() + "quests/progress/";
      plink.textContent = "我的进度 →";
      pfoot.appendChild(plink);
      pbody.appendChild(pfoot);

      /* —— 三态徽章 / 组内完成度 / 筛选条计数 ——
         progressSnap() 一次取副本，之后纯本地判断（progress.js 的纪律：
         不在循环里反复读 localStorage）。
         ⚠️ 写成**函数表达式赋给 render 作用域的指针**，不用块内 function 声明 ——
         "use strict" 下后者是块级作用域，applyQzFilter 从外面调不到。 */
      applyPanelFilter = function (snap) {
        snap = snap || progressSnap();
        var visible = 0;
        var visByGrp = {}; // 组序号 → 可见行数
        rowEls.forEach(function (r) {
          var st = stateOf(snap, r.q) || "none";
          var ok = plFilter === "all" || plFilter === st;
          r.el.style.display = ok ? "" : "none";
          if (ok) {
            visible++;
            visByGrp[r.grp] = (visByGrp[r.grp] || 0) + 1;
          }
        });
        grpRefs.forEach(function (g, gi) {
          g.el.style.display = visByGrp[gi] ? "" : "none";
        });
        pempty.hidden = visible > 0;
        pempty.textContent =
          plFilter === "done" ? "这张图上还没有已完成的任务。"
          : plFilter === "inhand" ? "这张图上没有进行中的任务。"
          : plFilter === "none" ? "这张图上的任务都动过了。"
          : "";
      };

      refreshPanelStates = function () {
        var snap = progressSnap();
        var cnt = { none: 0, inhand: 0, done: 0 };
        var grpStat = {}; // 组序号 → {done, total}
        rowEls.forEach(function (r) {
          var st = stateOf(snap, r.q) || "none";
          cnt[st]++;
          var gs = (grpStat[r.grp] = grpStat[r.grp] || { done: 0, total: 0 });
          gs.total++;
          if (st === "done") gs.done++;
          var badge = r.el.querySelector(".tk-qp__st");
          badge.textContent = st === "done" ? "已完成" : st === "inhand" ? "进行中" : "未标记";
          badge.className = "tk-qp__st tk-qp__st--" + st;
        });
        /* 组头：完成度细条 + n/N（P2-2）。条与数字都来自同一份 grpStat */
        grpRefs.forEach(function (g, gi) {
          var gs = grpStat[gi] || { done: 0, total: 0 };
          g.n.textContent = gs.done + " / " + gs.total;
          g.bar.style.width = gs.total ? Math.round((gs.done / gs.total) * 100) + "%" : "0%";
        });
        /* 面板头：本图完成度 */
        progFill.style.width = qlist.length ? Math.round((cnt.done / qlist.length) * 100) + "%" : "0%";
        progN.textContent = cnt.done + " / " + qlist.length + " 已完成";
        chipEls.all.textContent = "全部 " + qlist.length;
        chipEls.none.textContent = "未标记 " + cnt.none;
        chipEls.inhand.textContent = "进行中 " + cnt.inhand;
        chipEls.done.textContent = "已完成 " + cnt.done;
        applyPanelFilter(snap);
      };

      /* 出击清单的 UI 刷新：汇总条文案 + 行勾选态。
         与 refreshPanelStates 分开 —— 一个由**进度**驱动，一个由**规划**驱动，
         两条刷新路互不依赖（进度变化不该动勾选，勾选不该动三态徽章）。 */
      refreshPlanUI = function () {
        var ids = Object.keys(planSet);
        var zones = 0,
          keys = 0;
        ids.forEach(function (q) {
          var it = zoneByQ[q];
          if (!it) return;
          zones += it.nz;
          keys += it.kn || 0;
        });
        planStrip.hidden = ids.length === 0;
        psTitle.textContent = "出击清单 · " + ids.length + " 个任务";
        psCount.textContent = "区域 " + zones + " 处" + (keys ? " · 钥匙 " + keys + " 把" : "");
        psOnly.textContent = planOnly ? "看全部任务" : "只看这些";
        rowEls.forEach(function (r) {
          var on = !!planSet[r.q];
          r.planBtn.setAttribute("aria-pressed", on ? "true" : "false");
          r.planBtn.textContent = on ? "✓" : "+";
          r.el.classList.toggle("is-plan", on);
        });
      };

      phead.addEventListener("click", function () {
        var open = pbody.hidden;
        pbody.hidden = !open;
        pchips.hidden = !open; // 筛选条跟着一起收
        /* 出击清单汇总条**不跟着收** —— 它是「当前有规划」的常驻提醒 */
        phead.setAttribute("aria-expanded", open ? "true" : "false");
        pv.textContent = open ? "收起清单" : "展开清单";
      });

      panel.appendChild(phead);
      panel.appendChild(planStrip);
      panel.appendChild(pchips);
      panel.appendChild(pbody);
      host.appendChild(panel); // 放在地图**下方**（信息卡之后、图例之前）

      refreshPanelStates(); // 初始化：徽章、组头完成度、筛选条计数、面板头完成度
      refreshPlanUI();      // 初始化：汇总条（空计划时隐藏）
    }

    /* ── 图例 ──
       按**本图实际有的要素**裁剪：破冰船 / 终点站 / 迷宫没有地名锚点，
       图例再列「地名锚点」就是空话 —— 列了没画的东西比不列更糟。 */
    var legend = document.createElement("ul");
    legend.className = "tk-map__legend";
    [
      ["tk-lg-pin", "地名锚点 —— 点击查看条目", (data.labels || []).length],
      ["tk-lg-ex", "撤离点（带名字，按阵营分色）—— 点击看条件", (data.extracts || []).length],
      ["tk-lg-tr", "转场点 —— 不结束战局直接换图", (data.transits || []).length],
      ["tk-lg-lock", "上锁 —— 点击查需要哪把钥匙", (data.locks || []).length],
      ["tk-lg-hz", "危险区（雷区等）", (data.hazards || []).length],
      ["tk-lg-task", "任务目标区域 —— 单击只看它、双击进详情", qzAll.length],
    ].forEach(function (pair) {
      if (!pair[2]) return; // 本图没有这一层，图例不列
      var li = document.createElement("li");
      var sw = document.createElement("i");
      sw.className = pair[0];
      li.appendChild(sw);
      li.appendChild(document.createTextNode(pair[1]));
      legend.appendChild(li);
    });
    host.appendChild(legend);

    /* ── 比例尺（画布左下角）──
       数据与测距同源（mpp），缩放时由 layoutLabels 一并换档；
       全屏 / 窗口尺寸变化会改画布宽度，也要重算。 */
    scalebar = document.createElement("div");
    scalebar.className = "tk-map__scalebar";
    scalebar.setAttribute("aria-hidden", "true");
    canvas.appendChild(scalebar);

    var layoutTick = null;
    function scheduleLayoutOnResize() {
      if (layoutTick) clearTimeout(layoutTick);
      layoutTick = setTimeout(scheduleLayout, 120); // 连续 resize 防抖
    }
    /* instant 换页会重放脚本：window/document 级监听先摘旧再挂新，
       不做的话每换一次页就多挂一份（旧闭包虽无害但会累积）。 */
    if (liveResizeBound) {
      window.removeEventListener("resize", liveResizeBound);
      document.removeEventListener("fullscreenchange", liveResizeBound);
    }
    liveResizeBound = scheduleLayoutOnResize;
    window.addEventListener("resize", scheduleLayoutOnResize);
    document.addEventListener("fullscreenchange", scheduleLayoutOnResize);

    var note = document.createElement("p");
    note.className = "tk-map__note";
    note.textContent =
      "底图为矢量绘制，可缩放查看。任务点位是目标区域（不是精确站姿点位），" +
      "坐标为上游数据投影所得，仅供参考；精确位置以游戏内为准。";
    host.appendChild(note);

    /* ── 深链：?q=<任务id> 直接把地图开到某个任务上 ──
       「我的下一步」推荐卡与任务详情页都用它落地（选中 + 定位 + 清单行高亮）。
       ⚠️ 2026-10-17 起两个链接方都**只对图上有坐标的任务给链接**（判定见
       scripts/_map_links.py 的 mz），所以这里正常不该再落空；保底分支留给
       旧书签、手工拼的地址、以及数据两端短暂不同步的情况。
       落空时**不再完全静默**，也不再只留一行说明：给出「为什么 + 去哪看」
       —— 一行说明 + 直达任务详情的链接（读者反馈：点了链接看不到位置时，
       最需要的是一条出路）。 */
    var q0 = null;
    try {
      q0 = new URLSearchParams(location.search).get("q");
    } catch (err) {
      q0 = null;
    }
    if (q0 && zoneByQ[q0]) {
      selectTask(q0);
      focusZone(q0);
    } else if (q0) {
      var miss = document.createElement("p");
      miss.className = "tk-map__note";
      miss.appendChild(document.createTextNode(
        "已按链接打开本图，但该任务在图上没有画出的目标区域（上游未提供坐标）—— " +
        "地图与下方清单照常可用；想知道它的具体地点："));
      var missLink = document.createElement("a");
      missLink.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(q0);
      missLink.textContent = "看任务详情 →";
      miss.appendChild(missLink);
      host.appendChild(miss);
    }

    /* ── 深链：?key=<物品id> 高亮某把钥匙的锁点 ──
       入口是物品图鉴的两处（keys 页的「所在图」列 / 物品详情页的「在哪用它」段）：
       点图名 → 跳到本图并高亮这把钥匙的**全部锁点**。匹配的点放大变实、
       其余降透明（「你的门在这几个」一眼可见）；顶部一行说明给出计数与还原办法。
       落空时同样**不静默**：说明它可能落在别的地图上，并指出完整清单在哪 ——
       连锁点的 key 都查了一遍（data-key），查不到才报落空。 */
    var k0 = null;
    try {
      k0 = new URLSearchParams(location.search).get("key");
    } catch (err) {
      k0 = null;
    }
    if (k0) {
      var hitN = 0;
      lockLayer.classList.add("is-keyhl");
      Array.prototype.forEach.call(lockLayer.children, function (g) {
        if (g.getAttribute("data-key") === k0) {
          g.classList.add("is-keyhl");
          hitN++;
        }
      });
      var knote = document.createElement("p");
      knote.className = "tk-map__note";
      if (hitN) {
        knote.textContent = "已按链接高亮这把钥匙在本图的 " + hitN +
          " 个锁点（其余锁点已淡出）。去掉地址里的 ?key= 参数即可还原；" +
          "这把钥匙在别的地图有没有锁点，见物品图鉴钥匙页的「所在图」列。";
      } else {
        knote.appendChild(document.createTextNode(
          "地址里带了钥匙参数，但本图没有这把钥匙的锁点 —— 它可能落在别的地图上" +
          "（或上游锁点数据里没有它的门）。这把钥匙在所有收录地图上的锁点，见："));
        var klink = document.createElement("a");
        klink.href = siteRoot() + "catalog/keys/";
        klink.textContent = "物品图鉴 · 钥匙与门禁 →";
        knote.appendChild(klink);
      }
      host.appendChild(knote);
    }

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
