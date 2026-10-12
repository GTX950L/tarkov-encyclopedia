/* ==========================================================================
   跳蚤市场手续费计算器（纯前端，无外部依赖）
   --------------------------------------------------------------------------
   要解决的问题：本站《跳蚤定价与手续费》第 1 节已经把公式写出来了
   （手续费 = VO × Ti × 4^PO × Q + VR × Tr × 4^PR × Q），也给了「标价越远离
   底价、费率上升越猛烈」的结论 —— 但**公式里最要命的那一段没写出来**：
   PO / PR 不是单纯的对数比，偏离方向不同，指数上还要再乘一次方
   （一侧线性、另一侧 ^1.08）。读者照着那一行是算不出来的。

   本脚本把公式补全成可调的，并给出三样读者真正想要的东西：
     1. 一次挂单的**手续费、到手价、实际费率**；
     2. **费率随标价倍数的分档表** —— 把「指数级上升」从形容变成数字；
     3. **减免对照**（无减免 / 情报中心 Lv3 / 叠加藏身处管理满级），
        直接回答「情报中心值不值得投」。

   三条边界：
     1. **只算公式、不报市场价**。本站不联网、不收实时价（与物品图鉴、
        配方速查同一口径）—— 标价该填多少由市场供需决定，不由本工具决定。
     2. **费率常数可切，默认取本站基线口径**。社区维基那条公式的原始常数是
        0.03，而本站《跳蚤定价与手续费》基本信息表记的现行基础费率是 5% ——
        两者不一致，所以**做成选项而不是替读者猜**，并把差异写在界面上。
     3. **给的是量级与趋势，不是官方数值**。公式结构为社区还原，绝对数值
        以游戏内上架面板为准。

   接入方式与站内其他页内工具一致：toolbox.js 检测到本页有 #tk-flea-calc
   挂载点时注入本文件；本文件可能晚于 Material 的 document$ 首次发出才加载，
   所以除订阅之外还要自己立即尝试一次。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-flea-calc";

  /* 手续费公式（社区还原口径）。⚠️ 两处最容易写错的地方：
       ① PO / PR 的**分段**：不在同一侧取同一个次方。VR ≥ V0 时 PO 走线性，
          VR ≤ V0 时 PR 走线性；另一侧都要再取 ^1.08。
       ② 代入 VR = V0 时两项的 4 的指数都是 0（4^0 = 1），手续费
          = V0·Ti + VR·Tr —— 这是**最快的一条自检**：常数取 0.05 时应为底价的
          10%，取 0.03 时应为 6%。界面上的「口径自检」就把它印出来。 */
  function feeOf(v0, vr, ti, tr, q) {
    var po = vr >= v0
      ? Math.log10(v0 / vr)
      : Math.pow(Math.log10(v0 / vr), 1.08);
    var pr = vr <= v0
      ? Math.log10(vr / v0)
      : Math.pow(Math.log10(vr / v0), 1.08);
    return Math.round(v0 * ti * Math.pow(4, po) * q
                    + vr * tr * Math.pow(4, pr) * q);
  }

  /* 二分/三分求「手续费意义上的极限标价倍数」：超过它，继续加价只会让到手变少。
     ⚠️ 这个数**不是推荐标价**。公式只算手续费、不含需求，而现实中标价受
        供需约束（本页第 7 节的实操是「贴着当前最低报价走」）。所以界面上它
        只作为**公式性质**出现，并明确写出「不要照着它定价」。 */
  function peakMultiplier(ti, tr, disc) {
    var BASE = 1e6;            /* 同 rateOptimalMultiplier：避开整数四舍五入的噪声 */
    function net(x) {                       /* x = 标价 / 底价 */
      var v0 = BASE, vr = BASE * x;
      return vr - feeOf(v0, vr, ti, tr, 1) * (1 - disc);
    }
    var lo = 1, hi = 3000;
    /* 三分搜索：不假设函数可导，只要求单峰（这一段确实单峰，
       已用 1×–200× 整点扫描确认没有第二次转向）。 */
    for (var i = 0; i < 200; i++) {
      var m1 = lo + (hi - lo) / 3;
      var m2 = hi - (hi - lo) / 3;
      if (net(m1) < net(m2)) lo = m1; else hi = m2;
    }
    var best = (lo + hi) / 2;
    if (!isFinite(best) || best >= 2999) return null;
    return best;
  }

  /* 「费率最低点」——与上面那个**不是一回事**，别混：
       · 费率最低点：手续费 ÷ 标价 最小 —— 这是实战该看的；
       · 净收益拐点：标价 − 手续费 最大 —— 那是公式性质，现实中到不了。
     费率曲线是 U 形（已用 0.1×–5× 步进 0.01 扫描确认），最低点落在底价的
     约 1.6 倍处；而 Ti = Tr 时约掉常数 k，所以这个位置**与费率常数、与减免
     幅度都无关** —— 它是一个稳定的经验值，值得单独印出来。

     ⚠️ **基准底价必须取一个「大数」，不能用 1。** feeOf 会把费额四舍五入成
        整数，底价取 1 时费额只有零点几 → 全被抹成 0 或 1，扫描出来的是
        「四舍五入噪声最小的那个倍数」，而不是真正的费率最低点。
        （2026-10-12 的 DOM 冒烟测试抓到：用 1 作基准得到 5.0×，与手算的
        1.63× 差了三倍。）取 1e6 后四舍五入的相对误差 ~1e-6，可忽略；
        而费率对底价是**尺度无关**的，所以换成大数不改变答案。 */
  function rateOptimalMultiplier(ti) {
    var BASE = 1e6;
    var bestX = 1, bestR = Infinity;
    for (var x = 0.2; x <= 5.0001; x += 0.01) {
      var f = feeOf(BASE, BASE * x, ti, ti, 1);
      if (f <= 0) continue;
      var r = f / (BASE * x);
      if (r < bestR) { bestR = r; bestX = x; }
    }
    return { x: bestX, rate: bestR };
  }

  /* -------------------------------------------------------------------- 工具 */

  function siteRoot() {
    /* 优先用 toolbox.js 在首次整页加载时算好并公布的站点根，不要每次现算。
       Material 的 instant navigation 换页时会重建 <script> 元素，重建后的
       .src 按【换页前】的地址解析，得出 <根>/entries/javascripts/xxx.js
       这种错路径 —— 于是所有「换页之后才算 siteRoot()」的代码都拼出 404 地址。
       fallback 保留原写法，供本文件首次计算时使用。 */
    if (window.__tkRoot) return window.__tkRoot;
    var s = document.querySelector('script[src*="flea-fee-calc.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 千分位 + 卢布。负数（理论上不该出现）也照常打，不静默变 0。 */
  function rub(n) {
    var v = Math.round(n);
    var sign = v < 0 ? "-" : "";
    return sign + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ₽";
  }

  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  function mult(x) {
    return (Math.round(x * 100) / 100) + "×";
  }

  /* 减免选项：幅度取本站《跳蚤定价与手续费》第 3 节的原文口径。 */
  var DISCOUNTS = [
    { v: 0, label: "无减免" },
    { v: 0.30, label: "情报中心 Lv3（约 −30%）" },
    { v: 0.45, label: "叠加藏身处管理满级（约 −45%）" }
  ];

  /* -------------------------------------------------------------------- 渲染 */

  function build(host) {
    host.textContent = "";

    var wrap = el("div", "tk-calc");
    var form = el("div", "tk-calc__form");

    function field(label, node, hint) {
      var f = el("label", "tk-calc__field");
      f.appendChild(el("span", "tk-calc__label", label));
      f.appendChild(node);
      if (hint) f.appendChild(el("span", "tk-calc__hint", hint));
      return f;
    }

    function numInput(val, min, max, step) {
      var n = document.createElement("input");
      n.type = "number";
      n.min = String(min);
      n.max = String(max);
      n.step = String(step);
      n.value = String(val);
      n.className = "tk-calc__input";
      return n;
    }

    var v0In = numInput(10000, 1, 100000000, 100);
    var vrIn = numInput(20000, 1, 200000000, 100);
    var qIn = numInput(1, 1, 1000, 1);

    var rateSel = document.createElement("select");
    rateSel.className = "tk-calc__input";
    [["0.05", "5%（本站《跳蚤定价与手续费》基本信息表所记现行基础费率）"],
     ["0.03", "3%（社区维基公式的原始取值）"]].forEach(function (p, i) {
      var o = document.createElement("option");
      o.value = p[0];
      o.textContent = p[1];
      if (i === 0) o.selected = true;
      rateSel.appendChild(o);
    });

    var discSel = document.createElement("select");
    discSel.className = "tk-calc__input";
    DISCOUNTS.forEach(function (d, i) {
      var o = document.createElement("option");
      o.value = String(d.v);
      o.textContent = d.label;
      if (i === 0) o.selected = true;
      discSel.appendChild(o);
    });

    form.appendChild(field("单件底价", v0In, "右键看商人回购价可反推，见本页第 2 节"));
    form.appendChild(field("单件标价", vrIn, "你打算挂的价格"));
    form.appendChild(field("数量", qIn, "同一格挂几件"));
    form.appendChild(field("费率常数 Ti／Tr", rateSel, "两者取同一个值"));
    form.appendChild(field("减免", discSel, "情报中心与技能"));
    wrap.appendChild(form);

    /* —— 主结果 —— */
    var out = el("div", "tk-calc__out");
    var big = el("div", "tk-calc__big");
    var bigNum = el("span", "tk-calc__big-num");
    big.appendChild(bigNum);
    big.appendChild(el("span", "tk-calc__big-lbl", "手续费"));
    out.appendChild(big);

    var verd = el("p", "tk-calc__verdict");
    out.appendChild(verd);

    var facts = el("dl", "tk-calc__facts");
    wrap.appendChild(out);
    wrap.appendChild(facts);

    var tableBox = el("div", "tk-calc__tablebox");
    wrap.appendChild(tableBox);

    var discBox = el("div", "tk-calc__tablebox");
    wrap.appendChild(discBox);

    var note = el("p", "tk-calc__note",
      "口径：公式结构为社区还原口径（非官方公开算法），费率常数随版本调整 —— "
      + "本站基本信息表记的现行基础费率是 5%，社区维基那条公式的原始常数是 3%，"
      + "所以这里做成可切选项，「绝对数值请以游戏内上架面板为准」，本工具用来看"
      + "费率怎么随标价变化。本站不联网、不收实时价，也不报市场价。");
    wrap.appendChild(note);

    host.appendChild(wrap);

    /* ------------------------------------------------------------------ 同步 */

    function readInputs() {
      var b = parseFloat(v0In.value);
      var s = parseFloat(vrIn.value);
      var n = parseFloat(qIn.value);
      if (!isFinite(b) || b <= 0) b = 1;
      if (!isFinite(s) || s <= 0) s = 1;
      if (!isFinite(n) || n < 1) n = 1;
      n = Math.round(n);
      return { b: b, s: s, n: n, ti: parseFloat(rateSel.value), disc: parseFloat(discSel.value) };
    }

    function sync() {
      var v = readInputs();
      var v0 = v.b * v.n;                 /* 整单底价 */
      var vr = v.s * v.n;                 /* 整单标价 */
      var fee = feeOf(v0, vr, v.ti, v.ti, 1);
      var feeNet = fee * (1 - v.disc);
      var take = vr - feeNet;
      var rate = feeNet / vr;

      bigNum.textContent = rub(feeNet);
      big.className = "tk-calc__big "
        + (rate >= 0.20 ? "is-none" : rate >= 0.10 ? "is-chance" : "is-always");

      /* ⚠️ 措辞按**实测的曲线形状**写，不要凭直觉写「标价越高费率越高」：
         费率 = 手续费 ÷ 标价，实测是 U 形（已扫描确认），最低点约在底价的
         1.6 倍处。低于它主要罚「标低」，高于它才罚「标高」——
         而且下偏那一侧的次方是 ^1.08，惩罚更重。
         ⚠️ 「附近」的带宽必须给足（±20%/25%）：最低点附近曲线很平 ——
            2× 的费率 8.95% 与最低点 8.77% 只差 0.2 个百分点，若按
            「大于最低点就报越界」，默认的 2× 会被说成「被指数级课税」，
            那是**用一个真数字说一句偏话**。 */
      var opt = rateOptimalMultiplier(v.ti);
      var rel = v.s / v.b;
      if (rel > opt.x * 1.25) {
        verd.textContent = "标价是底价的 " + mult(rel) + "，高于费率最低点（约 "
          + mult(opt.x) + "）—— 越是往上，超出底价的那部分被课税越重";
      } else if (rel < opt.x * 0.8) {
        verd.textContent = "标价是底价的 " + mult(rel) + "，低于费率最低点（约 "
          + mult(opt.x) + "）—— 公式对「标低」的惩罚比「标高」更狠"
          + "（这一侧的次方是 ^1.08）";
      } else {
        verd.textContent = "标价是底价的 " + mult(rel) + "，落在费率最低点附近（约 "
          + mult(opt.x) + "）—— 这是这条公式最省的位置";
      }
      verd.className = "tk-calc__verdict "
        + (rate >= 0.20 ? "is-none" : rate >= 0.10 ? "is-chance" : "is-always");

      facts.textContent = "";
      [["整单标价", rub(vr) + (v.n > 1 ? "（单件 " + rub(v.s) + " × " + v.n + "）" : "")],
       ["整单底价 VO", rub(v0)],
       ["手续费（未减免）", rub(fee)],
       ["减免后手续费", rub(feeNet) + (v.disc ? "（−" + Math.round(v.disc * 100) + "%）" : "")],
       ["实际费率", pct(rate) + "（手续费 ÷ 标价）"],
       ["到手价", rub(take) + (take < 0 ? " —— 亏的，别挂" : "")]
      ].forEach(function (p) {
        facts.appendChild(el("dt", null, p[0]));
        facts.appendChild(el("dd", null, p[1]));
      });

      /* —— 分档表：费率随标价倍数怎么涨 —— */
      tableBox.textContent = "";
      tableBox.appendChild(el("p", "tk-calc__caption",
        "费率随标价倍数的变化（底价固定为 " + rub(v.b)
        + "／件，数量 " + v.n + "，按当前减免 " + Math.round(v.disc * 100) + "%）："));
      var t1 = document.createElement("table");
      var h1 = document.createElement("thead");
      var r1 = document.createElement("tr");
      ["标价倍数", "整单标价", "手续费", "实际费率", "到手价"].forEach(function (t, i) {
        r1.appendChild(el("th", i >= 1 ? "tk-col-num" : null, t));
      });
      h1.appendChild(r1);
      t1.appendChild(h1);
      var b1 = document.createElement("tbody");
      var cur = v.s / v.b;
      var mults = [1, 1.5, 2, 3, 5, 10, 20];
      mults.forEach(function (m) {
        var s = v.b * m, tot = s * v.n;
        var f = feeOf(v0, tot, v.ti, v.ti, 1) * (1 - v.disc);
        var tr = document.createElement("tr");
        if (Math.abs(m - cur) < 0.005) tr.className = "is-current";
        tr.appendChild(el("td", null, mult(m) + (Math.abs(m - cur) < 0.005 ? "（当前）" : "")));
        tr.appendChild(el("td", "tk-col-num", rub(tot)));
        tr.appendChild(el("td", "tk-col-num", rub(f)));
        tr.appendChild(el("td", "tk-col-num", pct(f / tot)));
        tr.appendChild(el("td", "tk-col-num", rub(tot - f)));
        b1.appendChild(tr);
      });
      t1.appendChild(b1);
      var sc1 = document.createElement("div");
      sc1.className = "md-typeset__table";
      sc1.appendChild(t1);
      tableBox.appendChild(sc1);

      /* 口径自检：VR = V0 时手续费应恰为 V0 × (Ti + Tr)。把它印出来 ——
         这是读者能当场手算验证这条公式「没被抄错」的唯一一处。 */
      var selfCheck = feeOf(v0, v0, v.ti, v.ti, 1);
      var expect = Math.round(v0 * v.ti + v0 * v.ti);
      tableBox.appendChild(el("p", "tk-calc__caption",
        "口径自检：标价 = 底价时，公式给出 " + rub(selfCheck)
        + "，而手算 V0 × (Ti + Tr) = " + rub(expect)
        + " —— 两者相等即说明本工具用的就是本页第 1 节那条公式。"));

      /* —— 减免对照 —— */
      discBox.textContent = "";
      discBox.appendChild(el("p", "tk-calc__caption",
        "减免对照（按你当前的标价 " + rub(v.s) + "／件）："));
      var t2 = document.createElement("table");
      var h2 = document.createElement("thead");
      var r2 = document.createElement("tr");
      ["减免来源", "手续费", "实际费率", "到手价", "相比无减免省下"].forEach(function (t, i) {
        r2.appendChild(el("th", i >= 1 ? "tk-col-num" : null, t));
      });
      h2.appendChild(r2);
      t2.appendChild(h2);
      var b2 = document.createElement("tbody");
      DISCOUNTS.forEach(function (d) {
        var f = fee * (1 - d.v);
        var tr = document.createElement("tr");
        if (Math.abs(d.v - v.disc) < 1e-9) tr.className = "is-current";
        tr.appendChild(el("td", null, d.label + (Math.abs(d.v - v.disc) < 1e-9 ? "（当前）" : "")));
        tr.appendChild(el("td", "tk-col-num", rub(f)));
        tr.appendChild(el("td", "tk-col-num", pct(f / vr)));
        tr.appendChild(el("td", "tk-col-num", rub(vr - f)));
        tr.appendChild(el("td", "tk-col-num", d.v ? rub(fee - f) : "—"));
        b2.appendChild(tr);
      });
      t2.appendChild(b2);
      var sc2 = document.createElement("div");
      sc2.className = "md-typeset__table";
      sc2.appendChild(t2);
      discBox.appendChild(sc2);

      /* —— 两条由公式推出的结论（刻意做成「备注」，不是「推荐值」）——
         ⚠️ 用 v.b 这个真实底价**重算**一次费率，不要直接用 rateOptimalMultiplier
            返回的 rate：那个是在底价 = 1 上扫的，四舍五入会把小费额压成 0。 */
      var optRate = feeOf(v.b, v.b * opt.x, v.ti, v.ti, 1) * (1 - v.disc)
                  / (v.b * opt.x);
      var lead = el("p", "tk-calc__caption",
        "费率最低点：标价约为底价的 " + mult(opt.x) + " 时，费率最低（此处约 "
        + pct(optRate) + "）。低于它主要罚「标低」，高于它才罚「标高」—— "
        + "而这两侧的惩罚并不对称，标低那一侧更重。"
        + "这个位置与费率常数、减免幅度都无关（公式里约掉了），所以它是一个稳定值。");
      discBox.appendChild(lead);

      var pk = peakMultiplier(v.ti, v.ti, v.disc);
      var tail = el("p", "tk-calc__caption");
      if (pk) {
        tail.textContent =
          "另有一条公式性质（不是推荐标价）：标价超过底价约 " + mult(pk)
          + " 之后，公式算出的到手价反而开始下降 —— 因为手续费涨得比标价快。"
          + "但不要照着它定价：该公式只算手续费、不含需求，而现实中标价由供需决定，"
          + "本页第 7 节的实操是「贴着当前最低报价走」。这个数放出来，"
          + "是为了说明手续费能把利润吃掉多少，不是让你去挂一个没人买的价格。";
      } else {
        tail.textContent =
          "标价在可计算范围内没有出现「加价反而到手更少」的拐点。";
      }
      discBox.appendChild(tail);
    }

    [v0In, vrIn, qIn].forEach(function (n) {
      n.addEventListener("input", sync);
      n.addEventListener("change", sync);
    });
    rateSel.addEventListener("change", sync);
    discSel.addEventListener("change", sync);

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
  window.__tkBootFleaFee = mount;
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  /* 暴露纯函数供复算与端到端测试。 */
  window.TarkovFleaFee = {
    _feeOf: feeOf,
    _peakMultiplier: peakMultiplier,
    _rateOptimalMultiplier: rateOptimalMultiplier
  };
})();
