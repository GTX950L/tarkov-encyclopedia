/* ==========================================================================
   比特币矿场收益 / 回本计算器（纯前端，无外部依赖）
   --------------------------------------------------------------------------
   要解决的问题：本站《藏身处模块详解》§3「满级增益总览」里已经写着矿场的显卡插槽
   （+10 → 共 25 → 共 50），但**「多久回本」这个问题读者还是只能靠感觉** ——
   因为它取决于三件本站不收的东西：显卡单价、比特币售价、燃料单价（都是
   随行情变动的动态数值，本站不联网、不收实时价）。

   本脚本把「速率」与「价格」拆开：
     · **速率**用社区实测的公式算（与价格无关，可以放心印出来）；
     · **价格**由读者自己填（示例值已填好，但明确标注为示例）。
   于是「回本周期」这件事第一次可以在本站算出来。

   三条边界：

     1. **速率公式是社区实测，不是官方公开算法。** 本机**没有在游戏里实测过**；
        能确认的只是「公式与它公开的三个标称点（1 / 25 / 50 卡）逐点吻合」——
        这是**内部自洽**，不等于游戏行为一致。页面上必须这么写。
     2. **不报价格。** 显卡单价 / 比特币售价 / 燃料单价三个输入框里的数字是
        **示例值**，不是本站报价 —— 与全站「不联网、不收实时价」同一口径。
     3. **不联网、不保存。** 全部在本页内存里算，没有网络请求、没有 localStorage。

   口径上最要紧的一条（写在界面上）：**燃料是整个藏身处共享的**。本工具按
   「全额计入矿场」算，所以给出的「每天净收益」是**保守下界** —— 如果你还开着
   其它耗油模块，矿场的实际边际成本低于此值。

   接入方式与站内其他页内工具一致：toolbox.js 检测到本页有 #tk-mining-calc
   挂载点时注入本文件；本文件可能晚于 Material 的 document$ 首次发出才加载，
   所以除订阅之外还要自己立即尝试一次。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_ID = "tk-mining-calc";

  /* —— 速率参数（社区实测口径，改这里要想一下页面上的口径块）—— */
  var SECONDS_BASE = 300000;      /* 出币时间 = 300000 / (1 + (卡数−1) × 0.041225) 秒 */
  var CARD_FACTOR = 0.041225;
  var FUEL_PER_MIN = 0.08;        /* 发电机耗油：0.08 单位/分钟 */
  var SOLAR_FACTOR = 0.5;         /* 太阳能：油耗减半 */
  var STASH_LIMIT = 3;            /* 蓄满 3 枚不收即停机 */

  /* 三个等级的显卡槽位 —— 与 §3 的表**同一批数**（那里标注为二级来源）。 */
  var LEVEL_SLOTS = { "1": 10, "2": 25, "3": 50 };

  /* 燃料桶容量（单位） */
  var CANS = { metal: { label: "金属燃料桶", size: 100 },
               camp: { label: "野营燃料桶", size: 60 } };

  function cycleSeconds(cards) {
    return SECONDS_BASE / (1 + (cards - 1) * CARD_FACTOR);
  }

  /* 每天耗油（单位）。1440 分钟/天。 */
  function fuelPerDay(solar) {
    return 1440 * FUEL_PER_MIN * (solar ? SOLAR_FACTOR : 1);
  }

  /* -------------------------------------------------------------------- 工具 */

  function siteRoot() {
    /* 优先用 toolbox.js 在首次整页加载时算好并公布的站点根，不要每次现算。
       Material 的 instant navigation 换页时会重建 <script> 元素，重建后的
       .src 按【换页前】的地址解析，得出 <根>/entries/javascripts/xxx.js
       这种错路径 —— 于是所有「换页之后才算 siteRoot()」的代码都拼出 404 地址。
       fallback 保留原写法，供本文件首次计算时使用。 */
    if (window.__tkRoot) return window.__tkRoot;
    var s = document.querySelector('script[src*="hideout-mining-calc.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 文案里的 `**重点**` —— 借 progress.js 导出的 richText 渲染，**不在这里写第三份**。
     ⚠️ progress.js 在 extra_javascript 里（全站加载），本文件由 toolbox.js 运行时注入，
       所以正常情况下它一定已经在。兜底仍要写：万一它没载入，**把标记去掉**再显示 ——
       宁可少一段粗体，也不让星号露在页面上（与 richText 自己的降级策略一致）。 */
  var UI = (window.TarkovProgress || {})._ui || {};

  function setRich(node, text) {
    node.textContent = "";
    if (typeof UI.richText === "function") node.appendChild(UI.richText(text));
    else node.textContent = String(text).split("**").join("");
  }

  function rub(n) {
    if (!isFinite(n)) return "—";
    var v = Math.round(n);
    var sign = v < 0 ? "-" : "";
    return sign + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ₽";
  }

  function hoursText(h) {
    if (!isFinite(h) || h <= 0) return "—";
    var total = Math.round(h * 60);          /* 分钟 */
    var days = Math.floor(total / 1440);
    var hh = Math.floor((total % 1440) / 60);
    var mm = total % 60;
    var parts = [];
    if (days) parts.push(days + " 天");
    if (hh) parts.push(hh + " 小时");
    parts.push(mm + " 分");
    return parts.join(" ");
  }

  function num(n, digits) {
    if (!isFinite(n)) return "—";
    return n.toFixed(digits === undefined ? 2 : digits);
  }

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

    /* —— 等级 → 槽位 —— */
    var lvSel = document.createElement("select");
    lvSel.className = "tk-calc__input";
    [["3", "3 级（满级）"], ["2", "2 级"], ["1", "1 级"]].forEach(function (p, i) {
      var o = document.createElement("option");
      o.value = p[0];
      o.textContent = p[1];
      if (i === 0) o.selected = true;
      lvSel.appendChild(o);
    });
    lvSel.value = "3";

    /* 显卡数可以低于槽位上限（没插满也照样产出）—— 所以它是独立输入，
       但换等级时会**跟着重置到该级的槽位**，避免留下一个不自洽的值。 */
    var cardsIn = numInput(50, 1, 50, 1);

    /* —— 太阳能：油耗减半 —— */
    var solarSel = document.createElement("select");
    solarSel.className = "tk-calc__input";
    [["0", "未装太阳能"], ["1", "已装太阳能（油耗减半）"]].forEach(function (p, i) {
      var o = document.createElement("option");
      o.value = p[0];
      o.textContent = p[1];
      if (i === 0) o.selected = true;
      solarSel.appendChild(o);
    });
    solarSel.value = "0";

    var canSel = document.createElement("select");
    canSel.className = "tk-calc__input";
    Object.keys(CANS).forEach(function (k, i) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = CANS[k].label + "（" + CANS[k].size + " 单位）";
      if (i === 0) o.selected = true;
      canSel.appendChild(o);
    });
    canSel.value = "metal";

    /* —— 三个价格：**示例值**，不是本站报价 —— */
    var btcIn = numInput(500000, 0, 100000000, 1000);
    var cardIn = numInput(200000, 0, 100000000, 1000);
    var fuelIn = numInput(100000, 0, 10000000, 1000);

    form.appendChild(field("矿场等级", lvSel, "决定显卡槽位上限"));
    form.appendChild(field("显卡数量", cardsIn, "1 级 10 ／ 2 级 25 ／ 3 级 50"));
    form.appendChild(field("太阳能", solarSel, "装了油耗减半"));
    form.appendChild(field("燃料类型", canSel, "决定一桶多少单位"));
    form.appendChild(field("比特币售价", btcIn, "示例值 —— 请填你当下的跳蚤价"));
    form.appendChild(field("显卡单价", cardIn, "示例值 —— 请填你当下的价"));
    form.appendChild(field("燃料单价", fuelIn, "示例值 —— 每桶"));
    wrap.appendChild(form);

    /* —— 主结果 —— */
    var out = el("div", "tk-calc__out");
    var big = el("div", "tk-calc__big");
    var bigNum = el("span", "tk-calc__big-num");
    big.appendChild(bigNum);
    big.appendChild(el("span", "tk-calc__big-lbl", "回本时间"));
    out.appendChild(big);
    var verd = el("p", "tk-calc__verdict");
    out.appendChild(verd);
    var facts = el("dl", "tk-calc__facts");
    wrap.appendChild(out);
    wrap.appendChild(facts);

    var tableBox = el("div", "tk-calc__tablebox");
    wrap.appendChild(tableBox);

    var note = el("p", "tk-calc__note");
    setRich(note,
      "口径（三条，缺一条都会读错）："
      + "① 速率是**社区实测**——出币时间 = 300000 ÷ (1 +（显卡数−1）× 0.041225) 秒、"
      + "发电机耗油 0.08 单位/分钟、太阳能减半。本机**没有在游戏里实测过**，"
      + "能确认的只是「公式与它公开的三个标称点逐点吻合」；"
      + "② **燃料是整个藏身处共享的**，本工具按全额计入矿场，"
      + "所以「每天净收益」是**保守下界** —— 你还开着别的耗油模块时，矿场的边际成本更低；"
      + "③ 蓄满 " + STASH_LIMIT + " 枚不收就停机，所以**长时间不收**会让实际产出低于理论值。"
      + "另：显卡的「入手难度」（战局中拾取）与比特币价格波动都没计入。");
    wrap.appendChild(note);

    host.appendChild(wrap);

    /* ------------------------------------------------------------------ 同步 */

    function readInputs() {
      var cards = parseInt(cardsIn.value, 10);
      if (!isFinite(cards) || cards < 1) cards = 1;
      if (cards > 50) cards = 50;
      function money(inp) {
        var v = parseFloat(inp.value);
        return (isFinite(v) && v > 0) ? v : 0;
      }
      return {
        cards: cards,
        solar: solarSel.value === "1",
        can: CANS[canSel.value] || CANS.metal,
        btc: money(btcIn),
        card: money(cardIn),
        fuel: money(fuelIn)
      };
    }

    function sync() {
      var v = readInputs();
      var sec = cycleSeconds(v.cards);
      var cycleH = sec / 3600;
      var perDay = 24 / cycleH;                       /* 枚/天 */
      var unitsPerDay = fuelPerDay(v.solar);
      var cansPerDay = unitsPerDay / v.can.size;
      var gross = perDay * v.btc;
      var fuelCost = cansPerDay * v.fuel;
      var net = gross - fuelCost;
      var invest = v.cards * v.card;
      var payback = (net > 0 && invest > 0) ? invest / net : Infinity;

      bigNum.textContent = isFinite(payback) ? num(payback, 1) + " 天" : "回不了本";
      big.className = "tk-calc__big "
        + (isFinite(payback) ? (payback <= 30 ? "is-always" : payback <= 90 ? "is-chance" : "is-none")
                             : "is-none");

      if (invest <= 0) {
        setRich(verd, "填上显卡单价才有回本时间 —— 现在算得出速率与日产量，但算不出投入。");
      } else if (net <= 0) {
        setRich(verd, "每天净收益 ≤ 0：按你填的价格，燃料就把收入吃光了 —— "
          + "这时候矿场不是理财，是烧钱。");
      } else {
        setRich(verd, "按你填的价格，约 " + num(payback, 1) + " 天回本（"
          + num(payback / 30.4, 1) + " 个月）。注意这只是**纸面回本**：没算停机、"
          + "没算价格波动、也没算显卡本来是捡来的。");
      }
      verd.className = "tk-calc__verdict "
        + (isFinite(payback) ? (payback <= 30 ? "is-always" : payback <= 90 ? "is-chance" : "is-none")
                             : "is-none");

      facts.textContent = "";
      [["出一枚比特币", hoursText(cycleH) + "（" + num(cycleH, 2) + " 小时）"],
       ["每天产出", num(perDay, 2) + " 枚"],
       ["每天耗油", num(unitsPerDay, 1) + " 单位 ＝ " + num(cansPerDay, 2) + " 桶"],
       ["每天毛收入", rub(gross) + (perDay > 0 && v.btc ? "（" + num(perDay, 2) + " × " + rub(v.btc) + "）" : "")],
       ["每天燃料成本", rub(fuelCost) + (v.solar ? "（太阳能已减半）" : "")],
       ["每天净收益", rub(net)],
       ["显卡总投入", rub(invest) + "（" + v.cards + " × " + rub(v.card) + "）"]
      ].forEach(function (p) {
        facts.appendChild(el("dt", null, p[0]));
        facts.appendChild(el("dd", null, p[1]));
      });

      /* —— 分档表：不同卡数下的出币速度 —— */
      tableBox.textContent = "";
      var cap1 = el("p", "tk-calc__caption");
      setRich(cap1, "出币速度随显卡数的变化（这一栏**与价格无关**，是速率的全貌）：");
      tableBox.appendChild(cap1);
      var t1 = document.createElement("table");
      var h1 = document.createElement("thead");
      var r1 = document.createElement("tr");
      ["显卡数", "出一枚", "每天产出", "每天耗油（单位）"].forEach(function (t, i) {
        r1.appendChild(el("th", i >= 1 ? "tk-col-num" : null, t));
      });
      h1.appendChild(r1);
      t1.appendChild(h1);
      var b1 = document.createElement("tbody");
      [10, 25, 50].forEach(function (n) {
        var h = cycleSeconds(n) / 3600;
        var tr = document.createElement("tr");
        if (n === v.cards) tr.className = "is-current";
        tr.appendChild(el("td", null, String(n) + (n === v.cards ? "（当前）" : "")));
        tr.appendChild(el("td", "tk-col-num", num(h, 2) + " 小时"));
        tr.appendChild(el("td", "tk-col-num", num(24 / h, 2) + " 枚"));
        tr.appendChild(el("td", "tk-col-num", num(fuelPerDay(v.solar), 1)));
        b1.appendChild(tr);
      });
      t1.appendChild(b1);
      /* 与全站其余运行时建表同一条约定：必须自己套 .md-typeset__table
         （extra.css 第 3 节写明它是全站唯一的表格滚动容器）。 */
      var sc = document.createElement("div");
      sc.className = "md-typeset__table";
      sc.appendChild(t1);
      tableBox.appendChild(sc);

      tableBox.appendChild(el("p", "tk-calc__caption",
        "「每天耗油」按" + (v.solar ? "装了太阳能（减半）" : "未装太阳能") + "算，"
        + "与显卡数无关 —— 发电机只要在跑就是这个速率。"));

      /* —— 口径自检：公式与它公开的标称点必须吻合 —— */
      var check = [10, 25, 50].map(function (n) { return num(cycleSeconds(n) / 3600, 2) + "h"; });
      tableBox.appendChild(el("p", "tk-calc__caption",
        "口径自检：公式在这三档给出的出币时间是 " + check.join(" ／ ")
        + "，与公开标称的 60.78h ／ 41.89h ／ 27.59h 逐点吻合 —— "
        + "两者相等即说明本工具用的就是那条公开公式。"));
    }

    lvSel.addEventListener("change", function () {
      var slots = LEVEL_SLOTS[lvSel.value];
      if (slots) cardsIn.value = String(slots);
      sync();
    });
    [cardsIn, btcIn, cardIn, fuelIn].forEach(function (n) {
      n.addEventListener("input", sync);
      n.addEventListener("change", sync);
    });
    solarSel.addEventListener("change", sync);
    canSel.addEventListener("change", sync);

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
     内容换入的间隙里，那一刻挂载点还不在 DOM 中。
     mount 是幂等的（data-ready 挡重复渲染），重复调用无副作用。 */
  window.__tkBootMining = mount;
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  /* 暴露纯函数供复算与端到端测试。 */
  window.TarkovMining = {
    _cycleSeconds: cycleSeconds,
    _fuelPerDay: fuelPerDay,
    _constants: { SECONDS_BASE: SECONDS_BASE, CARD_FACTOR: CARD_FACTOR,
                  FUEL_PER_MIN: FUEL_PER_MIN, SOLAR_FACTOR: SOLAR_FACTOR,
                  LEVEL_SLOTS: LEVEL_SLOTS }
  };
})();
