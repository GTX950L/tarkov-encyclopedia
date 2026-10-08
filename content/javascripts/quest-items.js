/* ==========================================================================
   物品反查（Item Reverse Lookup · 物品 → 任务）
   --------------------------------------------------------------------------
   要解决的两个读者痛点（2026-10-07 读者原话）：

     ① 「查找我正在做的任务时，我不知道这个任务是不是需要我额外带钥匙或者
         其他物品进图放置，总是到了任务地点才发现东西没带」
     ② 「一个后期要交的物品，我在前期就找到了，不知道是不是应该保留」

   痛点① 由 `gen_quests.py` 在**任务侧**解决（页首标记列 + 每条的「出发前必带」
   那一栏）；本脚本解决痛点②，**方向是反的**：从物品出发。

   为什么必须是「反的」：
     站内原本已有一节「物品需求反查」（gen_quest_items.py 写的），但它是
     **任务 → 物品** 的方向—— 回答「这张物品被几个任务要」。
     读者手上拿着一个东西时，问的是**反过来的那个问题**：「这个东西我要不要留」。
     这一跳站里原本没有。加上它之后才形成闭环：
         任务侧「带什么」 ←→ 物品侧「要不要留」

   为什么**只被 1 个任务需要**的物品也必须能查：
     既有那节只列「被 3 个及以上任务需要」的物品（79 种）。而痛点② 最典型的
     场景恰恰是「我只认识这一件物品，不确定有没有用」——**那是 1 个任务的情况**。
     漏掉单任务物品，这一节的命中率会低到读者以为查不到东西。

   数据来源：scripts/data/items_index.json（由 scripts/gen_quest_carrier.py 生成）
   —— **本文件不含任何物品数据的手写副本**，与站内其余生成器的口径一致。
   ========================================================================== */

(function () {
  "use strict";

  var HOST_LOOKUP = "tk-item-lookup";
  var HOST_TABLE = "tk-item-table";
  var DATA_FILE = "items_index.js";
  var DATA_KEY = "TARKOV_ITEM_INDEX";

  var f = {
    lookup: document.getElementById(HOST_LOOKUP),
    table: document.getElementById(HOST_TABLE)
  };
  if (!f.lookup && !f.table) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function siteRoot() {
    var s = document.querySelector('script[src*="quest-items.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  /* ---------------------------------------------------------------- 图鉴链接
     本页回答「这物品要不要留」，读者紧接着会问「那它长什么样、去哪弄」——
     那一跳由第九篇·物品图鉴承接。data.pages 是构建期算好的映射：

       · [slug, id] → **精确链接**到图鉴该页的那一行，并自动展开详情面板
       · null       → 图鉴里有**多个同名型号**（50 个名字属于这种），
                      硬指一件会指错，所以改链到搜索让读者自己挑
       · undefined  → **任务专属道具**，根本不在图鉴里（111 种），
                      此时**不给链接**，并把原因写在 title 上 ——
                      给一个点进去查无此物的链接比不给更糟
  ------------------------------------------------------------------------ */
  var PAGE_MAP = {};

  /* ⚠️ ``styleCls`` 只负责**外观**（字号、间距），可点的标识类
     ``tk-il__link`` 由本函数自己加 —— 第一版把两者混成一个参数，
     结果传「tk-il__name」时链接就丢掉了标识类，样式里那套虚线全不生效，
     而**页面上看不出任何异常**（链接还在、也能点，只是不像链接）。
     外层的测试用例正是靠 ``tk-il__link`` 找链接的，所以直接报「0 个链接」。 */
  function itemAnchor(name, styleCls) {
    var p = PAGE_MAP[name];
    var root = siteRoot();
    var cls = (styleCls ? styleCls + " " : "") + "tk-il__link";
    var a;
    if (p && p.length === 2) {
      a = el("a", cls, name);
      a.href = root + "catalog/" + p[0] + "/#item-" + p[1];
      a.title = "在物品图鉴里看它的属性、怎么拿到、哪些任务要它";
      return a;
    }
    if (p === null) {
      a = el("a", cls, name);
      a.href = root + "catalog/#q=" + encodeURIComponent(name);
      a.title = "图鉴里有多个同名型号 —— 点开自己挑";
      return a;
    }
    var span = el("span", styleCls || "tk-il__name", name);
    span.title = "任务专属道具，不在物品图鉴收录范围内";
    return span;
  }

  function load(cb) {
    if (window[DATA_KEY]) { cb(window[DATA_KEY]); return; }
    var url = siteRoot() + "javascripts/" + DATA_FILE;
    if (!url || url.indexOf("javascripts/") === 0) { cb(null); return; }
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    sc.onload = function () { if (!done) { done = true; cb(window[DATA_KEY] || null); } };
    sc.onerror = function () { if (!done) { done = true; cb(null); } };
    document.head.appendChild(sc);
  }

  /* --------------------------------------------------------------------------
     匹配：中文名与英文/型号串都试一次，大小写与全半角不敏感。
     为什么不用「转拼音」那套：站内物品名以中文为主，读者也是照中文名输入，
     子串匹配足够；引入拼音索引要额外一份映射，而站内没有权威的读音来源。
     -------------------------------------------------------------------------- */
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  function search(items, q) {
    var n = norm(q);
    if (!n) return [];
    var out = [];
    for (var k in items) {
      if (norm(k).indexOf(n) >= 0) out.push(k);
    }
    /* 需求多的排前面 —— 同样匹配上，先看最值得留的那个。*/
    out.sort(function (a, b) { return items[b].n - items[a].n; });
    return out;
  }

  /* --------------------------------------------------------------------------
     单条结果
     -------------------------------------------------------------------------- */
  function verdict(rec) {
    /* 「要留」与「不用留」是**两个不同的问题**，别混成一个布尔值：
         n > 0  → 有任务要它 → 留
         n === 0 → 站点收录的任务里没有它要 → 本页答不了「留不留」
       第三种必须显式说「本页答不了」，而不是含糊地显示「不留」——
       那会让读者以为「这玩意儿没用」，而真相可能只是它属于装备类、不在任务里。 */
    if (rec.n > 0) return { cls: "keep", text: "要留" };
    return { cls: "unknown", text: "任务里不需要" };
  }

  function resultCard(name, rec) {
    var card = el("div", "tk-il__card");

    var head = el("div", "tk-il__cardhead");
    head.appendChild(itemAnchor(name, "tk-il__name"));
    var v = verdict(rec);
    head.appendChild(el("span", "tk-il__verdict tk-il__verdict--" + v.cls, v.text));
    card.appendChild(head);

    /* 要留 / 不要留 —— 一句话说清「为什么」 */
    if (rec.n > 0) {
      var why = el("p", "tk-il__why");
      why.appendChild(el("b", null, "要做 " + rec.n + " 个任务："));
      why.appendChild(document.createTextNode(rec.keep.join("、")));
      card.appendChild(why);

      if (rec.traders && rec.traders.length) {
        card.appendChild(row("发布者", rec.traders.join(" / ")));
      }
      if (rec.maps && rec.maps.length) {
        card.appendChild(row("涉及地图", rec.maps.join("、")));
      }
    } else {
      var none = el("p", "tk-il__why tk-il__why--muted");
      none.textContent = "本页收录的 515 个任务里没有它要上交或放置 —— " +
        "若是装备类物品，请查护甲与弹药图鉴；这不等于它没用。";
      card.appendChild(none);
    }

    /* 商人兑换：查不到**要照实说**，不能显示成「无」。 */
    var b = rec.barter || [];
    if (b.length) {
      var by = {};
      b.forEach(function (x) {
        var key = x.trader + " LL" + x.level;
        by[key] = (by[key] || 0) + 1;
      });
      card.appendChild(row("可从商人换到", Object.keys(by).join("、")));
    } else {
      var nb = el("p", "tk-il__nobarter");
      nb.textContent = "未收录商人兑换途径（多数是跳蚤市场流通物品；" +
        "本站配方表只收录 855 条以物换物，查不到不等于买不到）";
      card.appendChild(nb);
    }

    return card;
  }

  function row(k, v) {
    var p = el("p", "tk-il__row");
    p.appendChild(el("span", "tk-il__k", k));
    p.appendChild(el("span", "tk-il__v", v));
    return p;
  }

  /* --------------------------------------------------------------------------
     挂载
     -------------------------------------------------------------------------- */
  function buildLookup(host, data) {
    host.textContent = "";

    var box = el("div", "tk-il");
    var bar = el("div", "tk-il__bar");
    var inp = el("input", "tk-il__input");
    inp.type = "search";
    inp.placeholder = "输入物品名的一部分，例如 信号干扰器 / 摄像头 / 显卡…";
    inp.setAttribute("aria-label", "物品反查输入框");
    var out = el("div", "tk-il__out");
    bar.appendChild(inp);
    box.appendChild(bar);

    var hint = el("p", "tk-il__hint");
    hint.textContent = "共 " + Object.keys(data.items).length +
      " 种物品可查（数据抓取 " + (data.fetched || "—") + "）。" +
      "输入后按「要留吗」那一行做决定即可。";
    box.appendChild(hint);
    box.appendChild(out);
    host.appendChild(box);

    function render() {
      var q = inp.value.trim();
      out.textContent = "";
      if (!q) {
        var idle = el("p", "tk-il__hint");
        idle.textContent = "在上方输入物品名开始。带关键词如「摄像头」会列出全部同类。";
        out.appendChild(idle);
        return;
      }
      var hits = search(data.items, q);
      if (!hits.length) {
        var miss = el("p", "tk-il__miss");
        miss.textContent = "本页收录的 " + Object.keys(data.items).length +
          " 种任务物品里没有「" + q + "」。若它是装备（枪、护甲、头盔、弹药），" +
          "本页不收——见护甲与弹药图鉴。";
        out.appendChild(miss);
        return;
      }
      var cap = el("p", "tk-il__hint");
      cap.textContent = "命中 " + hits.length + " 个：";
      out.appendChild(cap);
      /* 最多渲染 40 条：命中太多时（比如打「一」）后面的价值递减，
         而 833 张卡一次全铺会拖慢页面、也读不完。 */
      hits.slice(0, 40).forEach(function (name) {
        out.appendChild(resultCard(name, data.items[name]));
      });
      if (hits.length > 40) {
        var more = el("p", "tk-il__hint");
        more.textContent = "另有 " + (hits.length - 40) + " 条未显示 —— 请补长关键词。";
        out.appendChild(more);
      }
    }

    inp.addEventListener("input", render);
    render();
  }

  function buildTable(host, data) {
    host.textContent = "";
    var items = data.items;
    var names = Object.keys(items);
    names.sort(function (a, b) {
      var d = items[b].n - items[a].n;
      return d !== 0 ? d : a.localeCompare(b, "zh");
    });

    var wrap = el("div", "tk-ilt");
    var box = el("div", "tk-ilt__scroll");
    var tbl = el("table", "tk-ilt__tbl");

    var thead = el("thead");
    var tr = el("tr");
    ["物品", "任务数", "发布者", "能换到"].forEach(function (h) {
      tr.appendChild(el("th", null, h));
    });
    thead.appendChild(tr);
    tbl.appendChild(thead);

    var tbody = el("tbody");
    names.slice(0, 60).forEach(function (name) {
      var rec = items[name];
      var r = el("tr");
      var td = el("td", "tk-ilt__name");
      td.appendChild(itemAnchor(name, "tk-ilt__name"));
      r.appendChild(td);
      r.appendChild(el("td", "tk-ilt__n", String(rec.n)));
      r.appendChild(el("td", null, (rec.traders || []).join(" / ") || "—"));
      r.appendChild(el("td", null, (rec.barter || []).length
        ? (rec.barter || []).map(function (x) { return x.trader + " LL" + x.level; }).join("、")
        : "—"));
      tbody.appendChild(r);
    });
    tbl.appendChild(tbody);
    box.appendChild(tbl);
    wrap.appendChild(box);

    var cap = el("p", "tk-ilt__cap");
    cap.textContent = "共 " + names.length + " 种，此处列前 60 种。完整清单用上方搜索框逐个查。";
    wrap.appendChild(cap);
    host.appendChild(wrap);
  }

  load(function (data) {
    if (!data || !data.items) {
      if (f.lookup) f.lookup.textContent =
        "物品数据未加载 —— 需要 JavaScript 与 scripts/data/items_index.json。";
      return;
    }
    PAGE_MAP = data.pages || {};
    if (f.lookup) buildLookup(f.lookup, data);
    if (f.table) buildTable(f.table, data);
  });
})();