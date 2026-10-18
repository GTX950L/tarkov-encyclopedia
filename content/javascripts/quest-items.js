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
  var HOST_BATCH = "tk-item-batch";
  var DATA_FILE = "items_index.js";
  var DATA_KEY = "TARKOV_ITEM_INDEX";

  var f = {
    lookup: document.getElementById(HOST_LOOKUP),
    table: document.getElementById(HOST_TABLE),
    batch: document.getElementById(HOST_BATCH),
  };
  if (!f.lookup && !f.table && !f.batch) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 「要做 N 个任务」里的任务名 —— 数据是 `[名字, 任务id 或 null]` 对
     （由 gen_quest_carrier.py 产出）。id 为 null ＝ **重名任务**，生成器已判定
     不给链接（硬指会指到另一个任务上），退成纯文本。
     ⚠️ 兼容纯字符串，别让旧数据渲染成 [object Object]。 */
  function questNode(pair) {
    var name = Array.isArray(pair) ? pair[0] : pair;
    var id = Array.isArray(pair) ? pair[1] : null;
    if (!id) return document.createTextNode(name);
    var a = el("a", "tk-il__quest", name);
    a.href = siteRoot() + "quests/quest/?id=" + encodeURIComponent(id);
    return a;
  }

function siteRoot() {
    /* 优先用 toolbox.js 在首次整页加载时算好并公布的站点根，不要每次现算。
       Material 的 instant navigation 换页时会重建 <script> 元素，重建后的
       .src 按【换页前】的地址解析，得出 <根>/quests/javascripts/toolbox.js
       这种错路径 —— 于是所有「换页之后才算 siteRoot()」的代码都拼出 404 地址。

       实测（2026-10-10）：从任务图鉴总览点「台词」入口进任务详情页，注入的脚本
       请求到了 /quests/javascripts/quest-detail.js（404），页面永远停在静态
       占位文案上，而控制台一个错都不报。

       fallback 保留原写法，供 toolbox.js 自己首次计算时使用。 */
    if (window.__tkRoot) return window.__tkRoot;
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
    /* ⚠️ **用 query 不用 hash**：Material 的 instant navigation 会把跨页 hash
       改写成 ``#_1``，参数整个丢掉 —— 点击后落地一张干净的表格、详情不展开，
       而控制台一个错都不报。query 不经过那套改写。详见 catalog.js 的同名注释。 */
    if (p && p.length === 2) {
      a = el("a", cls, name);
      a.href = root + "catalog/" + p[0] + "/?item=" + p[1];
      a.title = "在物品图鉴里看它的属性、怎么拿到、哪些任务要它";
      return a;
    }
    if (p === null) {
      a = el("a", cls, name);
      a.href = root + "catalog/?q=" + encodeURIComponent(name);
      a.title = "图鉴里有多个同名型号 —— 点开自己挑";
      return a;
    }
    var span = el("span", styleCls || "tk-il__name", name);
    span.title = "任务专属道具，不在物品图鉴收录范围内";
    return span;
  }

  /* ---------------------------------------------------------------- 物品图标
     名字 → 官方图标 id 的映射在 item-icons.js（scripts/gen_item_icons.py 生成），
     图标文件在 assets/items/icons/<id>.webp。与物品索引**依次**加载：
     索引是内容（没有它就整页降级），图标是增强（加载失败只是不显示图）。 */
  var ICON_MAP = {};

  function itemIcon(name) {
    var id = ICON_MAP[name];
    if (!id) return null;
    var img = document.createElement("img");
    img.className = "tk-item-icon";
    img.src = siteRoot() + "assets/items/icons/" + id + ".webp";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
    return img;
  }

  function loadOne(file, key, cb) {
    if (window[key]) { cb(true); return; }
    var url = siteRoot() + "javascripts/" + file;
    if (!url || url.indexOf("javascripts/") === 0) { cb(false); return; }
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    sc.onload = function () { if (!done) { done = true; cb(!!window[key]); } };
    sc.onerror = function () { if (!done) { done = true; cb(false); } };
    document.head.appendChild(sc);
  }

  function load(cb) {
    loadOne(DATA_FILE, DATA_KEY, function (ok) {
      if (!ok) { cb(null); return; }
      loadOne("item-icons.js", "TARKOV_ITEM_ICONS", function () {
        ICON_MAP = window.TARKOV_ITEM_ICONS || {};
        cb(window[DATA_KEY]);
      });
    });
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
    /* 2026-10-17：判定改为**读进度**（共享模块 quest-needs.js）。
       旧逻辑只看 rec.n > 0，任务清完后仍说「要留」—— 那是错的。
       没有共享模块 / 没有进度时退回旧文案，不凭空说「可出」。 */
    if (window.TKQuestNeeds) return window.TKQuestNeeds.verdict(rec);
    if (rec.n > 0) {
      return { cls: "keep", text: "要留", total: rec.n, done: 0,
               inhand: 0, remain: rec.n, items: [], noProgress: true };
    }
    return { cls: "unknown", text: "任务里不需要", total: 0, done: 0,
             inhand: 0, remain: 0, items: [], noProgress: false };
  }

  function dataTotal() {
    var d = window.TARKOV_ITEM_INDEX;
    return (d && d.tasksTotal) ? d.tasksTotal : 0;
  }

  function resultCard(name, rec) {
    var card = el("div", "tk-il__card");

    var head = el("div", "tk-il__cardhead");
    var ic = itemIcon(name);
    if (ic) head.appendChild(ic);
    head.appendChild(itemAnchor(name, "tk-il__name"));
    var v = verdict(rec);
    head.appendChild(el("span", "tk-il__verdict tk-il__verdict--" + v.cls, v.text));
    card.appendChild(head);

    /* 要留 / 可出 —— 一句话说清「为什么」，并按**未完成任务**排序。
       已完成的沉到 <details> 里：它们不再影响「要不要留」这个决定。 */
    if (v.total > 0) {
      var why = el("p", "tk-il__why");
      why.appendChild(el("b", null, "共 " + v.total + " 个任务要它"));
      var bits = [];
      if (v.done) bits.push("已完成 " + v.done);
      if (v.inhand) bits.push("进行中 " + v.inhand);
      if (bits.length) why.appendChild(document.createTextNode("（" + bits.join(" · ") + "）"));
      why.appendChild(document.createTextNode("："));

      var rem = v.items.filter(function (x) { return x.state !== "done"; });
      if (!rem.length) {
        why.appendChild(document.createTextNode("没有未完成任务"));
      } else {
        rem.forEach(function (x, i) {
          if (i) why.appendChild(document.createTextNode("、"));
          why.appendChild(questNode([x.name, x.qid || null]));
        });
      }
      card.appendChild(why);

      var doneList = v.items.filter(function (x) { return x.state === "done"; });
      if (doneList.length) {
        var det = document.createElement("details");
        det.className = "tk-il__done";
        var sum = document.createElement("summary");
        sum.textContent = "已完成 " + doneList.length + " 个（不再需要为它们留）";
        det.appendChild(sum);
        var dul = document.createElement("p");
        dul.className = "tk-il__why tk-il__why--muted";
        doneList.forEach(function (x, i) {
          if (i) dul.appendChild(document.createTextNode("、"));
          dul.appendChild(questNode([x.name, x.qid || null]));
        });
        det.appendChild(dul);
        card.appendChild(det);
      }

      if (v.remain === 0) {
        var sell = el("p", "tk-il__sell");
        sell.textContent = "这些任务都已标记完成 —— 从任务角度可以出掉。"
          + "藏身处材料、以物换物配方另查；本页不判断那两类用途。";
        card.appendChild(sell);
      }
      if (v.noProgress) {
        card.appendChild(el("p", "tk-il__hint",
          "尚未记录进度，先按全部任务算。到「我的进度」标几条，这里会按未完成任务重算。"));
      }

      var have = 0;
      try {
        have = (window.TarkovProgress && window.TarkovProgress.itemCount)
          ? (window.TarkovProgress.itemCount(name) || 0) : 0;
      } catch (e) { have = 0; }
      if (have > 0) card.appendChild(row("已囤", have + " 件（物品收集账本）"));

      if (rec.traders && rec.traders.length) {
        card.appendChild(row("发布者", rec.traders.join(" / ")));
      }
      if (rec.maps && rec.maps.length) {
        card.appendChild(row("涉及地图", rec.maps.join("、")));
      }
    } else {
      var none = el("p", "tk-il__why tk-il__why--muted");
      none.textContent = "本页收录的 " + (dataTotal() || "当前") + " 个任务里没有它要上交或放置 —— " +
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
      var ic = itemIcon(name);
      if (ic) td.appendChild(ic);
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

  /* --------------------------------------------------------------------------
     批量判读（2026-10-17）：一次贴进多个物品名，出一张「留 / 可出」表。
     只做文本匹配，不做截图 OCR（那需要把图片传出本页）。
     -------------------------------------------------------------------------- */
  function buildBatch(host, data) {
    host.textContent = "";
    var items = data.items;
    var box = el("div", "tk-ilb");
    box.appendChild(el("p", "tk-il__hint",
      "把一背包的物品名贴进来（每行一个，或用逗号 / 顿号分隔），一次得到「留 / 可出」表。"
      + "匹配本页收录的 " + Object.keys(items).length + " 种任务物品；"
      + "**不上传、不识别截图**。"));

    var ta = el("textarea", "tk-ilb__ta");
    ta.rows = 5;
    ta.setAttribute("aria-label", "批量物品输入框");
    ta.placeholder = "信号干扰器\n摄像头、显卡\n螺栓";
    box.appendChild(ta);

    var bar = el("div", "tk-ilb__bar");
    var go = el("button", "tk-ilb__btn tk-ilb__btn--primary", "判一批");
    go.type = "button";
    var cp = el("button", "tk-ilb__btn", "复制结果");
    cp.type = "button";
    bar.appendChild(go);
    bar.appendChild(cp);
    box.appendChild(bar);

    var out = el("div", "tk-ilb__out");
    box.appendChild(out);
    host.appendChild(box);

    var lastRows = [];

    function run() {
      var raw = ta.value || "";
      var toks = raw.split(/[\n,，、;；]+/).map(function (s) { return s.trim(); })
        .filter(function (s) { return !!s; });
      out.textContent = "";
      lastRows = [];
      if (!toks.length) {
        out.appendChild(el("p", "tk-il__hint", "先贴几个物品名。"));
        return;
      }
      var miss = [];
      var rows = [];
      toks.forEach(function (tok) {
        var rec = items[tok], name = tok;
        if (!rec) {
          var n = norm(tok);
          for (var k in items) {
            if (norm(k).indexOf(n) >= 0) { rec = items[k]; name = k; break; }
          }
        }
        if (!rec) { miss.push(tok); return; }
        var v = verdict(rec);
        var rem = v.items.filter(function (x) { return x.state !== "done"; });
        var qty = 0, fir = false;
        (rec.d || []).forEach(function (d) {
          var keep = rem.some(function (x) { return x.qid === d[0]; });
          if (keep) { qty += d[1] || 1; fir = fir || !!d[2]; }
        });
        rows.push({ name: name, rec: rec, v: v, rem: rem, qty: qty, fir: fir });
      });

      var head = el("p", "tk-il__hint");
      head.textContent = "判出 " + rows.length + " 行"
        + (miss.length ? "；未收录 " + miss.length + " 个：" + miss.join("、") : "")
        + "。";
      out.appendChild(head);

      if (rows.length) {
        var wrap = el("div", "tk-ilb__scroll");
        var tbl = el("table", "tk-ilb__tbl");
        var thead = el("thead");
        var htr = el("tr");
        ["物品", "判定", "未完成任务", "要几个", "必须局内找到", "已囤"].forEach(function (h) {
          htr.appendChild(el("th", null, h));
        });
        thead.appendChild(htr);
        tbl.appendChild(thead);
        var tbody = el("tbody");
        rows.forEach(function (r) {
          var tr = el("tr");
          var td = el("td", "tk-ilb__name");
          var ic = itemIcon(r.name);
          if (ic) td.appendChild(ic);
          td.appendChild(itemAnchor(r.name, "tk-ilb__nm"));
          tr.appendChild(td);
          var cls = "tk-il__verdict tk-il__verdict--" + r.v.cls;
          var tdV = el("td");
          tdV.appendChild(el("span", cls, r.v.text));
          tr.appendChild(tdV);
          var tdTasks = el("td");
          r.rem.forEach(function (x, i) {
            if (i) tdTasks.appendChild(document.createTextNode("、"));
            tdTasks.appendChild(questNode([x.name, x.qid || null]));
          });
          if (!r.rem.length) tdTasks.textContent = "—";
          tr.appendChild(tdTasks);
          tr.appendChild(el("td", "tk-ilb__num", r.v.remain === 0 ? "—" : String(r.qty)));
          tr.appendChild(el("td", null, r.fir ? "是" : "否"));
          var have = 0;
          try {
            have = (window.TarkovProgress && window.TarkovProgress.itemCount)
              ? (window.TarkovProgress.itemCount(r.name) || 0) : 0;
          } catch (e) { have = 0; }
          tr.appendChild(el("td", "tk-ilb__num", have ? String(have) : "—"));
          tbody.appendChild(tr);
          lastRows.push([r.name, r.v.text, r.rem.map(function (x) { return x.name; }).join("、"),
                         r.v.remain === 0 ? 0 : r.qty, r.fir ? "是" : "否", have]);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        out.appendChild(wrap);
        cp.hidden = false;
      } else {
        cp.hidden = true;
      }
    }
    go.addEventListener("click", run);
    ta.addEventListener("input", function () { /* 手动点按钮再判，避免每键全表重算 */ });
    cp.addEventListener("click", function () {
      var lines = ["物品\t判定\t未完成任务\t要几个\t必须局内找到\t已囤"];
      lastRows.forEach(function (r) {
        lines.push(r[0] + "\t" + r[1] + "\t" + (r[2] || "—") + "\t"
          + (r[3] || "—") + "\t" + r[4] + "\t" + (r[5] || "—"));
      });
      var txt = lines.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt);
      } else {
        var ta2 = document.createElement("textarea");
        ta2.value = txt;
        document.body.appendChild(ta2);
        ta2.select();
        try { document.execCommand("copy"); } catch (e) { /* 老浏览器 */ }
        document.body.removeChild(ta2);
      }
      cp.textContent = "已复制";
      setTimeout(function () { cp.textContent = "复制结果"; }, 1500);
    });
  }

  load(function (data) {
    if (!data || !data.items) {
      if (f.lookup) f.lookup.textContent =
        "物品数据未加载 —— 需要 JavaScript 与 scripts/data/items_index.json。";
      return;
    }
    PAGE_MAP = data.pages || {};
    if (f.batch) buildBatch(f.batch, data);
    if (f.lookup) buildLookup(f.lookup, data);
    if (f.table) buildTable(f.table, data);
  });
})();