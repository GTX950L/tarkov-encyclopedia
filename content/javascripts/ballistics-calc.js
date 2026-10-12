/* ==========================================================================
   护甲穿透概率计算器（纯前端，无外部依赖）
   --------------------------------------------------------------------------
   要解决的问题：本站《弹道与穿透机制》把「穿深足够 → 穿透、不足 → 被吸收」
   讲清了，也给了「残甲要换」的结论，但**没有一处能把数算出来**：读者手上
   是「40 穿深的弹 + 6 级甲 + 还有 60 点耐久」，想知道到底有没有机会穿，只能
   去翻社区表格。

   本脚本把该页第 2 节那条链条（穿深 × 护甲等级 × 当前耐久）变成一个可调
   的计算器，并在同一处给出**两个反解**——这比正算更有用：
     · 穿透临界耐久：这副甲掉到多少耐久，这发弹才开始有机会；
     · 必穿耐久：掉到多少耐久以下，这发弹就必穿。
   两者都是「残甲要换」的量化依据，也是换弹种时的判据。

   三条边界（决定了它是什么、不是什么）：

     1. **只算公开公式、不猜游戏内部实现**。用的是社区长期使用的还原式
        （见下方 FORMULA_NOTE），**不是官方公开的算法** —— 页面上必须标明。
     2. **不含跳弹**。跳弹是头盔独有的**前置**判定，且忽略弹药类型
        （该页第 5 节已写明）—— 本计算器回答的是「假设这一发进入穿透判定，
        穿透的概率是多少」，不是「这一枪最终能不能造成伤害」。两句话都要
        出现在结果旁边，否则会被读成「命中结果」。
     3. **不联网、不保存**。全部在本页内存里算，没有网络请求、没有 localStorage。

   接入方式与站内其他页内工具一致：toolbox.js 检测到本页有
   #tk-ballistics-calc 挂载点时注入本文件；本文件可能晚于 Material 的
   document$ 首次发出才加载，所以除订阅之外还要自己立即尝试一次。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-ballistics-calc";

  /* 公式来源（社区还原口径，非官方公开算法）：
       a = (121 − 5000 / (45 + 2d)) × c / 10
       a − 15 < p < a  →  概率 = 0.4 × (a − p − 15)² / 100
       p ≥ a           →  概率 = (100 + p / (0.9a − p)) / 100
       否则            →  0
     其中 d = 当前耐久（0–100）、c = 护甲等级、p = 弹药穿深。
     ⚠️ 两支在 p = a 处连续（都等于 0.9），且随 p 单调不减 —— 这是它没写错的
        一个旁证；不要为了「看起来更合理」去改分支边界。 */
  var FORMULA_NOTE =
    "公式为社区还原口径（非官方公开算法），不含跳弹判定。";

  var aOf = function (d, c) {
    return (121 - 5000 / (45 + 2 * d)) * c / 10;
  };

  function penOf(d, c, p) {
    var a = aOf(d, c);
    if (a - 15 < p && p < a) return 0.4 * Math.pow(a - p - 15, 2) / 100;
    if (p >= a) {
      var den = 0.9 * a - p;
      if (den === 0) return 1;
      var r = (100 + p / den) / 100;
      return r < 0 ? 0 : (r > 1 ? 1 : r);
    }
    return 0;
  }

  /* 反解（都返回显式分类，**不要返回裸数字或裸 null**）----------------------
     ⚠️ 这里踩过一个实打实的坑（2026-10-12，由全矩阵 726 组合的
        pen-invariants 检查扫出）：第一版用「解出的耐久」一个数表达三种情形，
        把「无解」当成「任何耐久都没机会」—— 而**无解恰恰是「任何耐久都有机会」**。
        同一个 null 背上两种相反语义，读数的人（包括我自己）必然读反一次。
        所以改成 {kind, d}：kind 只有 "all" / "none" / "below" 三种，
        含义写死在名字里。

     a(d) 随耐久**递增**（a(0)=0.9889c，a(100)=10.059c），这是全部分支的依据：
       · 机会 ⟺ a − 15 < p ⟺ a 小 ⟺ 耐久**低**；
       · 必穿 ⟺ a ≤ p   ⟺ a 小 ⟺ 耐久**低**。
     两者都在「低耐久一侧」，所以 kind "below" 一律表示「低于 d 才行」。 */

  /* 反解 1：a − 15 = p 的耐久 —— 这发弹「开始有机会」的分界。 */
  function chanceDurability(c, p) {
    var den = 121 - (p + 15) * 10 / c;
    if (den <= 0) return { kind: "all", d: null };   /* p+15 ≥ 12.1c > a(100) */
    var d = (5000 / den - 45) / 2;
    if (!isFinite(d)) return { kind: "all", d: null };
    if (d <= 0) return { kind: "none", d: null };    /* p+15 ≤ a(0)：见底也挡得住 */
    if (d >= 100) return { kind: "all", d: null };   /* 满耐久就已有机会 */
    return { kind: "below", d: d };
  }

  /* 反解 2：a = p 的耐久 —— 这发弹「进入必穿分支」的分界。 */
  function alwaysDurability(c, p) {
    var den = 121 - p * 10 / c;
    if (den <= 0) return { kind: "all", d: null };   /* p ≥ 12.1c > a(100) */
    var d = (5000 / den - 45) / 2;
    if (!isFinite(d)) return { kind: "all", d: null };
    if (d <= 0) return { kind: "none", d: null };    /* p ≤ a(0)：永不进必穿 */
    if (d >= 100) return { kind: "all", d: null };
    return { kind: "below", d: d };
  }

  /* -------------------------------------------------------------------- 工具 */

  function siteRoot() {
    /* 优先用 toolbox.js 在首次整页加载时算好并公布的站点根，不要每次现算。
       Material 的 instant navigation 换页时会重建 <script> 元素，重建后的
       .src 按【换页前】的地址解析，得出 <根>/entries/javascripts/xxx.js
       这种错路径 —— 于是所有「换页之后才算 siteRoot()」的代码都拼出 404 地址。
       fallback 保留原写法，供本文件首次计算时使用。 */
    if (window.__tkRoot) return window.__tkRoot;
    var s = document.querySelector('script[src*="ballistics-calc.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /* 语义判定：把概率翻成一句人话。阈值刻意粗（99 / 50），
     因为读者要的是「能不能打」，不是小数点后一位。 */
  function verdict(pen) {
    if (pen >= 0.99) return { k: "always", t: "基本必定穿透 —— 这发弹对这副甲已无阻力" };
    if (pen >= 0.5) return { k: "likely", t: "多半穿透 —— 但不稳，别把胜负押在单发上" };
    if (pen > 0) return { k: "chance", t: "概率穿透 —— 有机会但不稳，属于「赌一发」" };
    return { k: "none", t: "打不穿 —— 换弹种，或等这副甲掉耐久" };
  }

  /* -------------------------------------------------------------------- 渲染 */

  function build(host) {
    host.textContent = "";

    var wrap = el("div", "tk-calc");

    /* —— 输入区 —— */
    var form = el("div", "tk-calc__form");

    function field(label, node, hint) {
      var f = el("label", "tk-calc__field");
      f.appendChild(el("span", "tk-calc__label", label));
      f.appendChild(node);
      if (hint) f.appendChild(el("span", "tk-calc__hint", hint));
      return f;
    }

    var pIn = document.createElement("input");
    pIn.type = "number";
    pIn.min = "0";
    pIn.max = "120";
    pIn.step = "1";
    pIn.value = "40";
    pIn.className = "tk-calc__input";

    var cSel = document.createElement("select");
    cSel.className = "tk-calc__input";
    [1, 2, 3, 4, 5, 6].forEach(function (n) {
      var o = document.createElement("option");
      o.value = String(n);
      o.textContent = n + " 级";
      if (n === 4) o.selected = true;
      cSel.appendChild(o);
    });
    /* ⚠️ 再把默认值显式钉一次，不依赖 option 的 selected —— 只靠
       `o.selected = true` 在个别实现下会退回第一个选项，而默认落到 1 级甲会
       让首屏显示「几乎必然穿透」的假象（1 级甲 a ≈ 10，40 穿深 → 98.7%），
       读者会以为工具坏了。4 级是更常见的中期甲。 */
    cSel.value = "4";

    var dIn = document.createElement("input");
    dIn.type = "number";
    dIn.min = "0";
    dIn.max = "100";
    dIn.step = "1";
    dIn.value = "100";
    dIn.className = "tk-calc__input";

    form.appendChild(field("弹药穿深", pIn, "0–120"));
    form.appendChild(field("护甲等级", cSel, "1–6 级"));
    form.appendChild(field("护甲当前耐久", dIn, "0–100（满耐久 = 100）"));
    wrap.appendChild(form);

    /* —— 主结果：大字概率 —— */
    var out = el("div", "tk-calc__out");
    var big = el("div", "tk-calc__big");
    var bigNum = el("span", "tk-calc__big-num");
    var bigLbl = el("span", "tk-calc__big-lbl", "穿透概率");
    big.appendChild(bigNum);
    big.appendChild(bigLbl);
    out.appendChild(big);

    var verd = el("p", "tk-calc__verdict");
    out.appendChild(verd);

    var facts = el("dl", "tk-calc__facts");
    wrap.appendChild(out);
    wrap.appendChild(facts);

    /* —— 分档表：耐久掉到多少，概率变多少 —— */
    var tableBox = el("div", "tk-calc__tablebox");
    wrap.appendChild(tableBox);

    /* —— 口径说明 —— */
    var note = el("p", "tk-calc__note",
      "口径：" + FORMULA_NOTE
      + "「穿透概率」说的是「假设这一发进入穿透判定」时穿透的可能性；"
      + "它不含跳弹（跳弹是头盔独有的前置判定，且忽略弹药类型，见本页第 5 节），"
      + "也不等于「这一枪最终能造成伤害」。实际数值以游戏内结算为准。");
    wrap.appendChild(note);

    host.appendChild(wrap);

    /* ------------------------------------------------------------------ 同步 */

    function readInputs() {
      var p = parseFloat(pIn.value);
      var c = parseInt(cSel.value, 10);
      var d = parseFloat(dIn.value);
      if (!isFinite(p) || p < 0) p = 0;
      if (!isFinite(c) || c < 1) c = 1;
      if (!isFinite(d)) d = 0;
      if (d < 0) d = 0;
      if (d > 100) d = 100;
      return { p: p, c: c, d: d };
    }

    function sync() {
      var v = readInputs();
      var pen = penOf(v.d, v.c, v.p);
      var vd = verdict(pen);

      bigNum.textContent = pct(pen);
      big.className = "tk-calc__big is-" + vd.k;

      verd.textContent = vd.t;
      verd.className = "tk-calc__verdict is-" + vd.k;

      /* 事实行：a 值与两个反解 —— 反解才是这个工具真正的输出 */
      facts.textContent = "";
      var rows = [
        ["护甲有效阈值 a", round1(aOf(v.d, v.c)) + "（穿深达到它即必定穿透）"]
      ];

      /* 三个分支一一对应 chanceDurability 的三种 kind，措辞不许跨支复用 ——
         这一支的注释里记着为什么（"all" 曾经被读成 "none"）。 */
      var dc = chanceDurability(v.c, v.p);
      if (dc.kind === "all") {
        /* ⚠️ 不要在这里补「把握很小」之类的评价：这一支同时覆盖「阈值在 0 以下」
           （概率很高）与「阈值在 100 以上」（概率可能只有几个百分点，如 5 级甲
           挡 40 穿深只有 8.85%）—— 加评价必错一半。量级交给上面那行大字概率。 */
        rows.push(["穿透临界耐久",
          "任何耐久都有机会 —— 临界阈值落在 0–100 点耐久之外，满耐久也不是零概率"]);
      } else if (dc.kind === "none") {
        rows.push(["穿透临界耐久",
          "任何耐久都没有机会 —— 这副甲即使耐久见底，这发弹也穿不过判定阈值"]);
      } else {
        rows.push(["穿透临界耐久",
          round1(dc.d) + " 点 —— 耐久掉到它以下，这发弹才开始有机会"]);
      }

      /* ⚠️ 措辞写「进入必穿分支」而不是「必定穿透」：该分支给的是
         (100 + p/(0.9a−p))/100，在 p = a 处恰为 90%，随 p 增大趋近 100%
         但取不到 100 —— 写成「必定」是**可以被读者当场证伪**的措辞。 */
      var da = alwaysDurability(v.c, v.p);
      if (da.kind === "all") {
        rows.push(["必穿耐久",
          "满耐久就已进入必穿区间（a ≤ 穿深、概率 ≥ 90%）—— 这副甲挡不住这发弹"]);
      } else if (da.kind === "none") {
        /* ⚠️「永不进必穿」**不等于零概率**：它只表示 a 始终大于穿深、概率被封在
           90% 以内。第一版写成「概率为 0」，而实测 c=1 / p=13 的概率是 96.7%
           （走的是概率穿透分支）—— 假得一眼可证。
           （由 pen-invariants 的全矩阵 726 组合扫出。） */
        rows.push(["必穿耐久",
          "任何耐久都不会进入必穿区间（a 始终大于穿深）—— 概率封顶在 90% 以内"]);
      } else {
        rows.push(["必穿耐久",
          round1(da.d) + " 点 —— 耐久掉到它以下即进入必穿区间（a ≤ 穿深，概率 ≥ 90%）"]);
      }

      rows.forEach(function (r) {
        facts.appendChild(el("dt", null, r[0]));
        facts.appendChild(el("dd", null, r[1]));
      });

      /* 分档表：固定耐久档 × 当前穿深 → 概率。用来一眼看出「残甲」的陡坡。 */
      tableBox.textContent = "";
      var cap = el("p", "tk-calc__caption",
        "同一副甲（" + v.c + " 级）在耐久下滑时，这发弹（穿深 " + v.p + "）的概率怎么变：");
      tableBox.appendChild(cap);

      var tb = document.createElement("table");
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["护甲耐久", "耐久％", "有效阈值 a", "穿透概率", "判定"].forEach(function (t, i) {
        hr.appendChild(el("th", i >= 2 ? "tk-col-num" : null, t));
      });
      thead.appendChild(hr);
      tb.appendChild(thead);

      var tbody = document.createElement("tbody");
      var marks = [];
      [100, 80, 60, 50, 40, 20, 0].forEach(function (d) {
        if (marks.indexOf(d) < 0) marks.push(d);
        /* 把两个反解插进档位里：读者才能看到「跨越点」落在哪一段。
           只有 kind === "below" 才有具体的点可插。 */
        [dc, da].forEach(function (x) {
          if (!x || x.kind !== "below") return;
          var step = 5;
          var snapped = Math.round(x.d / step) * step;
          if (marks.indexOf(snapped) < 0) marks.push(snapped);
        });
      });
      /* ⚠️ 当前耐久必须**始终**进表：只在输入刚好是整十档时才高亮，
         等于这个高亮在大多数输入下都不出现（读者会以为高亮坏了）。 */
      if (marks.indexOf(v.d) < 0) marks.push(v.d);
      marks.sort(function (a, b) { return b - a; });

      marks.forEach(function (d) {
        var pv = penOf(d, v.c, v.p);
        var vv = verdict(pv);
        var tr = document.createElement("tr");
        if (d === v.d) tr.className = "is-current";
        tr.appendChild(el("td", null, d + (d === v.d ? "（当前）" : "")));
        tr.appendChild(el("td", null, d + "%"));
        tr.appendChild(el("td", "tk-col-num", round1(aOf(d, v.c))));
        tr.appendChild(el("td", "tk-col-num", pct(pv)));
        tr.appendChild(el("td", "tk-calc__vd is-" + vv.k, vv.t.split(" —— ")[0]));
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);

      /* 与全站其余运行时建表同一条约定：必须自己套 .md-typeset__table
         （extra.css 第 3 节写明它是全站唯一的表格滚动容器），
         否则窄屏下整页被撑宽。 */
      var scroller = document.createElement("div");
      scroller.className = "md-typeset__table";
      scroller.appendChild(tb);
      tableBox.appendChild(scroller);

      var tail = el("p", "tk-calc__caption",
        "表里的「当前」行跟着上面的输入走。「穿透临界耐久」与「必穿耐久」"
        + "就是「残甲要换」的量化依据 —— 换弹种时也可以反过来用："
        + "保持弹药不变、只改护甲等级，看阈值怎么移动。");
      tableBox.appendChild(tail);
    }

    [pIn, dIn].forEach(function (n) {
      n.addEventListener("input", sync);
      n.addEventListener("change", sync);
    });
    cSel.addEventListener("change", sync);

    sync();
  }

  /* -------------------------------------------------------------------- 挂载 */

  function mount() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (host.getAttribute("data-ready")) return;    /* 防重复渲染 */
    host.setAttribute("data-ready", "1");
    build(host);
  }

  /* 两条入口都要：订阅负责 instant 换页；立即尝试负责「本脚本晚于
     document$ 首次发出才被注入」的情形（toolbox.js 是动态注入本文件的）。
     另外把 mount 公布给 toolbox.js 的 remount —— 注入的时机可能落在两次
     内容换入的间隙里，那一刻挂载点还不在 DOM 中（见 toolbox.js 的说明）。
     mount 是幂等的（data-ready 挡重复渲染），重复调用无副作用。 */
  window.__tkBootBallistics = mount;
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  /* 暴露纯函数供复算与端到端测试 —— 只靠「拖数字看界面」定位不到算错的那一步。 */
  window.TarkovBallistics = {
    _aOf: aOf, _penOf: penOf,
    _chanceDurability: chanceDurability, _alwaysDurability: alwaysDurability
  };
})();
