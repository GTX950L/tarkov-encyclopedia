/* ==========================================================================
   单件物品详情视图页（content/catalog/item.md）
   --------------------------------------------------------------------------
   定位：**一个视图页承载 4979 件物品的详情**，不是 4979 个 HTML。

   为什么不做成每件一个页面
   ------------------------
   实测每页平均 146 KB，其中绝大部分是站点框架（侧栏 nav + 主题）；4979 页
   合计约 700 MB，逼近 GitHub Pages 的 1 GB 上限，而每页真正的内容只有 1 KB。
   所以这一页按地址里的 ``?id=<物品id>`` 渲染 —— 链接可分享、可收藏、可刷新恢复。

   数据从哪来
   ----------
   ``catalog-item-<NN>.js`` 共 32 片（由 scripts/gen_items_catalog.py 生成），
   按**物品 id 的十六进制数字之和 % 32** 定位。

   ⚠️ 片数 32 与分片算法在**生成器与本文件各写一遍**，改一处必须改另一处。
      不一致的表现是：拉错片 → 查不到该 id → 静默显示「找不到这件物品」。
   ⚠️ 为什么不用 id 首字符：实测塔科夫物品 id 的首字符**只有 5 与 6 两种**
      （2148 / 2831 件），按它切只有 2 片、单片 1.2 MB。

   本页**不加载 catalog-data.js**（0.93 MB）——分片自包含（名称、数值、获取途径、
   任务需求、官方介绍都在里面）。这是「弱网可读」的关键：单次只下约 80 KB。
   ========================================================================== */

(function () {
  "use strict";

  var SHARD_COUNT = 32;   /* ⚠️ 必须等于 scripts/gen_items_catalog.py 的 SHARD_COUNT */
  var shardCache = {};    /* 片名 → 数据，避免同一轮浏览里重复请求同一片 */

  function siteRoot() {
    var s = document.querySelector('script[src*="toolbox.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function shardKey(id) {
    var s = 0;
    for (var i = 0; i < id.length; i++) {
      var v = parseInt(id.charAt(i), 16);
      if (!isNaN(v)) s += v;
    }
    return s % SHARD_COUNT;
  }

  function shardFile(id) {
    var k = shardKey(id);
    return "catalog-item-" + (k < 10 ? "0" + k : String(k)) + ".js";
  }

  function param(name) {
    try { return new URLSearchParams(location.search || "").get(name); }
    catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- DOM */

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function link(href, txt) {
    var a = el("a", null, txt);
    a.href = href;
    return a;
  }

  function h(level, txt) { return el("h" + level, null, txt); }

  /* ------------------------------------------------------------- 数值 */

  function parseNum(s) {
    if (s === "—" || s === "" || s == null) return null;
    var m = String(s).replace(/,/g, "").match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function fmtNum(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* 单格价值 = 商人最高回收 ÷ 占地格数。口径与图鉴页一致（商人回收，不是跳蚤价）。 */
  function slotValue(it) {
    var p = parseNum(it.s);
    var z = (typeof it.z === "number" && it.z > 0) ? it.z : null;
    if (p == null || z == null) return null;
    return p / z;
  }

  /* --------------------------------------------------------------- 数据 */

  function loadShard(id, cb) {
    var f = shardFile(id);
    if (shardCache[f]) { cb(shardCache[f]); return; }
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/" + f;
    s.onload = function () {
      /* 分片脚本执行时把数据挂到 window.TARKOV_ITEM —— 必须**在 onload 里立刻取走**，
         否则下一片加载会把它覆盖掉。 */
      shardCache[f] = window.TARKOV_ITEM || {};
      cb(shardCache[f]);
    };
    s.onerror = function () { cb(null); };
    document.head.appendChild(s);
  }

  /* --------------------------------------------------------------- 渲染 */

  function renderMissing(host, id) {
    host.textContent = "";
    var p = el("p", null, "");
    p.appendChild(document.createTextNode("找不到 ID 为 "));
    p.appendChild(el("code", null, id || "（空）"));
    p.appendChild(document.createTextNode(
      " 的物品。可能是 ID 抄错了，也可能这件物品在当前版本已被移除。"));
    host.appendChild(p);
    var p2 = el("p", null, "");
    p2.appendChild(document.createTextNode("去"));
    p2.appendChild(link(siteRoot() + "catalog/", "物品图鉴总览"));
    p2.appendChild(document.createTextNode("按名字找，或用"));
    p2.appendChild(link(siteRoot() + "quests/item-lookup/", "物品反查"));
    p2.appendChild(document.createTextNode("看看它有没有被任务需要。"));
    host.appendChild(p2);
  }

  function renderEmpty(host) {
    host.textContent = "";
    var p = el("p", null, "");
    p.appendChild(document.createTextNode(
      "这一页要用物品 ID 打开 —— 从"));
    p.appendChild(link(siteRoot() + "catalog/", "物品图鉴"));
    p.appendChild(document.createTextNode(
      "里点任意一件物品，或在物品名上右键复制链接，即可直达它的详情页。"
      + "地址形如 catalog/item/?id=<物品ID>。"));
    host.appendChild(p);
  }

  function renderDetail(host, id, it) {
    host.textContent = "";

    /* ---- 标题与标识 ---- */
    host.appendChild(h(3, it.n));
    var ident = el("p", null, "");
    if (it.e) {
      ident.appendChild(document.createTextNode("英文名 "));
      ident.appendChild(el("code", null, it.e));
      ident.appendChild(document.createTextNode("　｜　"));
    }
    ident.appendChild(document.createTextNode("物品 ID "));
    ident.appendChild(el("code", null, id));
    host.appendChild(ident);

    /* ---- 官方介绍 ---- */
    if (it.d) {
      host.appendChild(h(4, "💡 官方介绍"));
      /* 游戏内描述含换行的有 30 件，按段拆开，别把 \n 直接丢进 HTML */
      it.d.split(/\n+/).forEach(function (seg) {
        var t = seg.trim();
        if (t) host.appendChild(el("p", null, t));
      });
    } else {
      host.appendChild(h(4, "💡 官方介绍"));
      host.appendChild(el("p", null, "这件物品官方没有提供中文本地化描述。"));
    }

    /* ---- 关键数值 ---- */
    host.appendChild(h(4, "📐 关键数值"));
    var sv = slotValue(it);
    var dl = document.createElement("dl");
    [
      ["重量", typeof it.w === "number" ? it.w + " 千克" : "—"],
      ["占地", (typeof it.z === "number" && it.z > 0) ? it.z + " 格" : "—"],
      ["商人最低售价", it.b || "—"],
      ["商人最高回收", it.s || "—"],
      ["单格价值", sv == null ? "—（缺回收价或格数）" : fmtNum(sv) + " 卢布／格"]
    ].forEach(function (pair) {
      dl.appendChild(el("dt", null, pair[0]));
      dl.appendChild(el("dd", null, pair[1]));
    });
    host.appendChild(dl);
    host.appendChild(el("p", null, it.p || "该物品没有数值属性。"));

    /* ---- 怎么拿到它 ---- */
    host.appendChild(h(4, "📦 怎么拿到它"));
    var routes = it.r || [];
    var bought = it.b && String(it.b).indexOf("—") !== 0;
    if (!routes.length && !bought) {
      var e1 = el("p", null, "");
      e1.appendChild(document.createTextNode("这件物品不在站内收录的以物换物与制作配方里。"
        + "这不等于拿不到 —— 只表示它得靠搜刮或跳蚤市场，而站内不给点位与实时价。"));
      host.appendChild(e1);
    } else {
      if (bought) {
        var bp = el("p", null, "");
        bp.appendChild(el("strong", null, "商人出售　"));
        bp.appendChild(document.createTextNode(it.b));
        host.appendChild(bp);
      }
      routes.forEach(function (r) {
        var rp = el("p", null, "");
        rp.appendChild(el("strong", null,
          (r.k === "barter" ? "以物换物　" : "藏身处制作　")));
        rp.appendChild(document.createTextNode(r.s + (r.lv ? "　" + r.lv + " 级" : "")));
        host.appendChild(rp);
        var ul = document.createElement("ul");
        (r.m || []).forEach(function (m) {
          var li = document.createElement("li");
          li.textContent = m[0] + " × " + m[1] + (m[2] ? "（工具，不消耗）" : "");
          ul.appendChild(li);
        });
        host.appendChild(ul);
      });
    }
    host.appendChild(el("p", null,
      "以上是确定的获取途径（配方可复核），不含「哪张图能刷到」——"
      + "站内的散落刷新数据只覆盖少数物品，给出来反而会让人以为只有那几张图有。"));

    /* ---- 有任务要它吗 ---- */
    host.appendChild(h(4, "🎯 有任务要它吗"));
    var q = it.q;
    if (!q) {
      host.appendChild(el("p", null,
        "没有任务需要这件物品（或它是任务专属道具，不在图鉴收录范围内）。"));
    } else {
      host.appendChild(el("p", null,
        "被 " + (q.n || 0) + " 个任务需要"
        + ((q.keep || []).length ? "，建议保留。" : "。")));
      if ((q.keep || []).length) {
        var qul = document.createElement("ul");
        q.keep.slice(0, 12).forEach(function (t) { qul.appendChild(el("li", null, t)); });
        if (q.keep.length > 12) {
          qul.appendChild(el("li", null, "…等共 " + q.keep.length + " 个"));
        }
        host.appendChild(qul);
      }
      if ((q.maps || []).length) {
        var mp = el("p", null, "");
        mp.appendChild(document.createTextNode("需要它的任务在：" + q.maps.join("、") + "。"));
        mp.appendChild(el("strong", null, "这是任务所在地图、不是物品的刷新位置"));
        mp.appendChild(document.createTextNode("。"));
        host.appendChild(mp);
      }
      var lk = el("p", null, "");
      lk.appendChild(link(siteRoot() + "quests/item-lookup/", "去物品反查页看完整任务列表 →"));
      host.appendChild(lk);
    }

    /* ---- 归属与外部链接 ---- */
    host.appendChild(h(4, "🔗 归属与外部链接"));
    var gl = el("p", null, "");
    gl.appendChild(document.createTextNode("所属分类："));
    gl.appendChild(link(siteRoot() + "catalog/" + it.g + "/", it.gt || it.g));
    host.appendChild(gl);
    if (it.k) {
      var wl = el("p", null, "");
      wl.appendChild(document.createTextNode("官方 Wiki（英文）："));
      wl.appendChild(link(it.k, "escapefromtarkov.fandom.com"));
      host.appendChild(wl);
    }
  }

  /* --------------------------------------------------------------- 挂载 */

  function boot() {
    var host = document.getElementById("tk-item-page");
    if (!host) return;
    var id = (param("id") || "").trim();
    if (!id) { renderEmpty(host); return; }
    host.textContent = "";
    host.appendChild(el("p", null, "正在载入物品数据…"));
    loadShard(id, function (data) {
      var it = data ? data[id] : null;
      if (it) renderDetail(host, id, it);
      else renderMissing(host, id);
    });
  }

  /* 两条入口都要（toolbox.js 注入的脚本可能晚于 document$ 首次发出）。
     ⚠️ instant 换页会重放脚本，所以每次 boot 都要**重新读一次地址参数** ——
        从 A 物品跳到 B 物品时 URL 变了，不能沿用上一次解析的结果。 */
  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(boot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
