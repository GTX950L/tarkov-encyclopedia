/* ==========================================================================
   任务进度追踪（纯本地，无账号、无后端）
   --------------------------------------------------------------------------
   要解决的问题：站内第九篇是 515 个任务的逐条明细，读完之后**读者自己记不住
   做到哪了** ——「这个任务我交了没有」每局都要靠回忆，而回忆会出错。
   游戏内不提供任务完成度的整体视图，这大概是站内唯一一处「读者不得不自己记」
   的地方。本脚本把这件事变成「读的时候顺手勾一下」：任务明细标题左侧出现一个
   方框，点一下即标记完成；页首那张索引表同步点亮；另有总览页按商人汇总。

   三条边界（决定了这个功能**是**什么、**不是**什么）：

     1. **不登录、不联网。** 数据只写在本机浏览器的 localStorage 里。换浏览器、
        换设备、清缓存 = 进度归零 —— 这一点必须在总览页写明，不能让人以为
        存在账号上，那是另一种承诺。
     2. **不猜、不推断。** 只记录读者亲手勾的那一下。不做「前置都完成了，这个
        大概也完成了」这类推断：任务有失败条件、有分支、有跨商人的进度计数器
        （见任务图鉴总览对「进度计数」字段的说明），推断出来的进度比没有进度
        更危险 —— 读者会据此跳过准备。
     3. **不因为勾选改动正文。** 要求 / 奖励 / 前置一个字都不动，勾选只影响
        视觉状态。进度是可丢失的本地数据，正文是站点资产，两者不能混。

   存储结构（localStorage 键 `tarkov_progress_v1`）：
     {
       v: 6,
       mode: "pvp" | "pve" | "season",
       modes: { <模式>: { quests, inhand, objectives, items, hideout, storyline, … } }
     }
     （各轨的完整键值说明见下方「存储层」；历史版本 v1→v6 的演进也在那里。）

   两个刻意的选择：
     · **值存商人 slug**，于是「按商人汇总」不需要另建一张 id→商人 的表；
     · **键用数据端点的 id**（24 位十六进制）而不是页面锚点 `q01` —— `q01` 在
       11 个商人页里各出现一次，拿它当键会让「Prapor 的 q01」与「Skier 的
       q01」互相覆盖。id 由生成器写在 `data-qid` 上。

   接入方式与站内其他脚本一致：优先挂在 Material 的 `document$` 上，
   这样 `navigation.instant` 换页后也会重新执行。
   ========================================================================== */

(function () {
  "use strict";

  var STORE_KEY = "tarkov_progress_v1";
  var MODES = ["pvp", "pve", "season"];
  var MODE_LABEL = { pvp: "PVP", pve: "PVE", season: "赛季" };
  var EVT = "tarkov:progress";

  /* 是否为「任务图鉴」那一页的商人 slug。目录页 `quests/progress` 不是商人，
     必须排除 —— 否则它会被当成一个叫 progress 的商人在总览里多出一行。 */
  var NON_TRADER = { progress: 1, index: 1 };

  /* --------------------------------------------------------------------------
     存储层

     结构（v6；演进：v2 三条轨 → v3 物品改件数 → v5 加目标与门槛 → v6 加剧情章节）：
       {
         v: 6,
         mode: "pvp" | "pve" | "season",
         modes: { <模式>: { quests, inhand, objectives, items, hideout, storyline, … } }
       }

     各轨独立、共用同一个模式维度：
       · quests / inhand —— 值 = 商人 slug（用于按商人汇总）
       · objectives      —— 键 = `任务id|目标id`，值 = "1"
       · items           —— 值 = 已囤件数（数字字符串）；0/缺失都表示没囤
       · hideout         —— 值 = 等级数字的字符串；0/缺失都表示未建造
       · storyline       —— 值 = "inhand" / "done"（剧情章节三态，**纯手动、不做推断**）
     键：任务用数据端点 id、剧情章节用站内清单 id（scripts/data/storylines.json）；
     物品与藏身处用**中文名**（这两份派生数据里没有 id，见总览页「数据与隐私」
     对名称变动的说明）。
     -------------------------------------------------------------------------- */

  /* v6 新增 storyline 轨（剧情章节三态）。旧数据无需转换 —— load() 会把缺失的
     键补成空表：v5 之前存下的进度照常读入，只是这条轨从「全是未标记」开始。 */
  var SCHEMA_VERSION = 6;

  function blankMode() {
    return {
      quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {},
      storyline: {},           // 剧情章节：{ <站内章节id>: "inhand" | "done" }
      ll: {},                 // 商人忠诚度：{ <商人slug>: "1".."4" }
      fence: null,             // Fence 声望：**负值刻度**（如亡羊补牢要求 ≤ −3），与上面的 ll 不是一把尺。null = 未填
      level: 0,               // 我的等级
      faction: "",            // "BEAR" / "USEC" / ""
      prestige: 0,            // 转生次数
    };
  }

  function blankData() {
    return {
      v: SCHEMA_VERSION,
      mode: "pvp",
      modes: { pvp: blankMode(), pve: blankMode(), season: blankMode() }
    };
  }

  /* 逐键清洗。localStorage 里的东西是「外部输入」：可能被旧版本写过、可能被
     别的脚本塞过、也可能被手工改坏。整块 JSON.parse 抛错会让整个功能静默失效，
     所以一律补齐而不是报错。 */
  function cleanMap(src) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (typeof k !== "string" || !k) continue;
      var v = src[k];
      out[k] = (v === undefined || v === null) ? "" : String(v);
    }
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return blankData(); }
    if (!raw) return blankData();

    var d = null;
    try { d = JSON.parse(raw); } catch (e) { return blankData(); }
    if (!d || typeof d !== "object") return blankData();

    var out = blankData();
    out.mode = MODES.indexOf(d.mode) >= 0 ? d.mode : "pvp";

    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      var src = (d.modes && d.modes[m]) || {};
      /* ⚠️ v1 → v2 迁移：v1 的任务进度存在 `q` 字段里（值同样是商人 slug），
         v2 改名 `quests` 并新增两条轨。不迁移的话，已经勾过的人升级当天
         进度会**凭空消失**。 */
      var quests = (src.quests && typeof src.quests === "object") ? src.quests : src.q;
      var mode = {
        quests: cleanMap(quests),
        inhand: cleanMap(src.inhand),
        items: cleanMap(src.items),
        hideout: cleanMap(src.hideout),
        /* 目标轨：键是 `任务id|目标id`。
           目标 id 来自官方端点（不是下标）—— 重抓数据时目标顺序会变，
           用下标当键会让「勾过的目标」跑到别的目标上。 */
        objectives: cleanMap(src.objectives),
        /* 剧情章节轨：值只允许 "inhand" / "done"（下面统一过滤），
           键是站内清单 id —— 与生成器 progress-manifest.js 的 storyline 段同源。 */
        storyline: cleanMap(src.storyline),
        ll: cleanMap(src.ll),
        fence: null,
        level: 0,
        faction: "",
        prestige: 0,
      };
      /* 我的等级：只接受 1–99 的整数，其余当没填（0）。
         它不是「进度」而是「筛选条件」，所以单独存、不放进任何一条轨。 */
      var lv = parseInt(src.level, 10);
      mode.level = (isFinite(lv) && lv > 0 && lv < 100) ? lv : 0;
      mode.faction = (src.faction === "BEAR" || src.faction === "USEC") ? src.faction : "";
      /* Fence 声望：独立字段、**允许负数**。它与商人忠诚度不是一套刻度
         ——Fence 用负值（亡羊补牢要求 ≤ −3、≤ −1），LL 只有 1–4 的正值。
         合法区间取 −10 – 10，两端各留一点余量。**null 表示未填**，与「填了 0」
         必须区分：0 是真实值（破镜重圆三条要求 Lightkeeper ≤ 0），判定的方向
         恰好相反，混成一个值会让两批任务同时算错。 */
      var fr = parseInt(src.fence, 10);
      mode.fence = (isFinite(fr) && fr >= -10 && fr <= 10) ? fr : null;
      var pr = parseInt(src.prestige, 10);
      mode.prestige = (isFinite(pr) && pr > 0 && pr < 20) ? pr : 0;
      /* 商人忠诚度：只留 1–4 的整数。 */
      var lls = Object.keys(mode.ll);
      for (var li = 0; li < lls.length; li++) {
        var lvv = parseInt(mode.ll[lls[li]], 10);
        if (!isFinite(lvv) || lvv < 1 || lvv > 4) delete mode.ll[lls[li]];
        else mode.ll[lls[li]] = String(lvv);
      }
      /* 藏身处等级：把明显非法的值（0、负数、非数字）在**读入时**就清掉，
         免得下游三处各自判断。 */
      var hk = Object.keys(mode.hideout);
      for (var j = 0; j < hk.length; j++) {
        var lv = parseInt(mode.hideout[hk[j]], 10);
        if (!isFinite(lv) || lv <= 0) delete mode.hideout[hk[j]];
        else mode.hideout[hk[j]] = String(lv);
      }
      /* 剧情章节：只接受 "inhand" / "done" 两个值 —— 其余（空串、旧版本残留、
         手工改坏）一律按「未标记」处理（清掉键）。 */
      var chk = Object.keys(mode.storyline);
      for (var ci = 0; ci < chk.length; ci++) {
        var csv = mode.storyline[chk[ci]];
        if (csv !== "inhand" && csv !== "done") delete mode.storyline[chk[ci]];
      }
      out.modes[m] = mode;
    }
    return out;
  }

  function save(d) {
    /* 隐私模式下 localStorage 会抛 QuotaExceededError / SecurityError。
       勾选本身仍要工作（本次会话内有效），所以这里吞掉异常、不打断交互。 */
    try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* 忽略 */ }
  }

  function emit() {
    /* 常驻状态条要跟着每一次记录变化重画（v1.79.0 新增）。
       挂在 emit 上而不是各 setter 里 —— emit 是所有写操作的唯一出口，
       挂在这里就绝不会漏掉某条路径。 */
    var sb = document.getElementById("tk-statusbar");
    if (sb && typeof buildStatusStrip === "function") {
      try {
        var bar = document.querySelector(".tk-pgbar");
        if (bar) buildStatusStrip(bar);
      } catch (e) { /* 状态条失败不该影响记录本身 */ }
    }
    try { document.dispatchEvent(new Event(EVT)); } catch (e) { /* 忽略 */ }
  }

  /* 惰性迁移：load() 只把老结构**读成**新结构，不落盘（它被调用得很频繁，
     不该每次写存储）。若从不落盘，只读不点的读者会一直留着 v1 结构 ——
     功能上无害，但旧字段 `q` 会长期留在存储里，以后加轨时就容易踩到。
     所以进过「我的进度」相关页面时补一次写回，之后 v 相等就直接返回。 */
  function ensureMigrated() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var d = null;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== "object" || d.v === SCHEMA_VERSION) return;
    save(load());
  }

  /* --------------------------------------------------------------------------
     公开 API
     -------------------------------------------------------------------------- */

  var TRACKS = ["quests", "inhand", "objectives", "items", "hideout", "storyline"];
  var TRACK_LABEL = {
    quests: "已完成任务", inhand: "进行中任务", objectives: "任务目标",
    items: "物品收集", hideout: "藏身处", storyline: "剧情章节",
  };

  /* —— 藏身处清单的两把小工具（供看板与 API 共用） ——
     清单结构（来自 progress-manifest.js）：
       { name, en, layer, alias, levels: [ { level, time, stations:[{name,level}],
                                            skills:[{name,level}],
                                            items:[{name,count,fir}] } ] } */

  function topLevel(mod) {
    var lv = (mod && mod.levels) || [];
    var top = 0;
    for (var i = 0; i < lv.length; i++) {
      var n = parseInt(lv[i].level, 10);
      if (isFinite(n) && n > top) top = n;
    }
    return top;
  }

  /* 当前等级 s 的「下一级」需求；已到顶返回 null。 */
  function nextLevelReq(mod, cur) {
    var want = (parseInt(cur, 10) || 0) + 1;
    var lv = (mod && mod.levels) || [];
    for (var i = 0; i < lv.length; i++) {
      if (parseInt(lv[i].level, 10) === want) {
        return { level: want, time: lv[i].time, stations: lv[i].stations || [],
                 skills: lv[i].skills || [], items: lv[i].items || [] };
      }
    }
    return null;
  }

  var api = {
    MODES: MODES,
    MODE_LABEL: MODE_LABEL,
    TRACKS: TRACKS,
    TRACK_LABEL: TRACK_LABEL,
    KEY: STORE_KEY,

    mode: function () { return load().mode; },

    /* 整块读一次（归一化后的副本）。给看板用 —— 逐个字段调 API 会对
       localStorage 做几百次读取，那是纯浪费。返回值是副本，改它不影响存储。 */
    data: function () { return load(); },

    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return;
      var d = load();
      if (d.mode === m) return;
      d.mode = m;
      save(d);
      emit();
    },

    /* —— 任务轨 —— */

    count: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].quests).length;
    },

    /* —— 进行中轨（我当前接在身上的任务） ——
       ⚠️ 存储键**仍然是 `inhand`**：界面上的措辞从「在手」改成了「进行中」，
       但键一旦改掉，读者已经存下来的进度会整体读不出来。**显示词可以改，键不能改。**
       这条轨是「按前置树反推」的**输入**：玩家记得现进行中上有哪些任务，
       但不会记得过去完成了哪些（515 个任务，靠回忆不成立）。
       值同样记商人 slug，便于按商人汇总。 */
    inHand: function (qid, m) {
      if (!qid) return false;
      var d = load();
      return !!d.modes[m || d.mode].inhand[qid];
    },

    setInHand: function (qid, on, trader, m) {
      if (!qid) return;
      var d = load();
      var key = m || d.mode;
      if (on) d.modes[key].inhand[qid] = trader || "";
      else delete d.modes[key].inhand[qid];
      save(d);
      emit();
    },

    countInHand: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].inhand).length;
    },

    /* 任务的三态：""（未标记）/ "inhand"（进行中）/ "done"（已完成）。
       三态是**互斥**的 —— 写一处必清另一处，否则同一个任务会同时出现在
       「进行中」和「已完成」两个列表里。 */
    taskState: function (qid, m) {
      if (!qid) return "";
      var d = load();
      var md = d.modes[m || d.mode];
      /* ⚠️ 必须用**「键存在与否」**判断，不能用值的真假：
         从看板改状态时拿不到商人 slug，值会存成空字符串 —— 空字符串是
         falsy，用 `if (md.quests[qid])` 会把「已完成」读成「未标记」，
         而计数那边（Object.keys）照样算它一条，两处就此对不上。 */
      if (Object.prototype.hasOwnProperty.call(md.quests, qid)) return "done";
      if (Object.prototype.hasOwnProperty.call(md.inhand, qid)) return "inhand";
      return "";
    },

    setTaskState: function (qid, state, trader, m) {
      if (!qid) return;
      var d = load();
      var key = m || d.mode;
      delete d.modes[key].quests[qid];
      delete d.modes[key].inhand[qid];
      if (state === "done") d.modes[key].quests[qid] = trader || "";
      else if (state === "inhand") d.modes[key].inhand[qid] = trader || "";
      save(d);
      emit();
    },

    /* —— 我的等级（筛选条件，不属任何一条轨） —— */
    myLevel: function (m) {
      var d = load();
      return d.modes[m || d.mode].level || 0;
    },

    setMyLevel: function (n) {
      var d = load();
      var v = parseInt(n, 10);
      d.modes[d.mode].level = (isFinite(v) && v > 0 && v < 100) ? v : 0;
      save(d);
      emit();
    },

    /* —— 目标轨 ——
       键是 `任务id|目标id`。目标 id 来自官方端点，**不是下标** ——
       重抓数据时目标顺序会变（站内已有先例），用下标当键会让「勾过的目标」
       跑到同任务的另一个目标上。 */

    objKey: function (qid, oid) { return String(qid) + "|" + String(oid); },

    objDone: function (qid, oid, m) {
      if (!qid || !oid) return false;
      var d = load();
      return !!d.modes[m || d.mode].objectives[String(qid) + "|" + String(oid)];
    },

    setObjective: function (qid, oid, on, m) {
      if (!qid || !oid) return;
      var d = load();
      var key = m || d.mode;
      var k = String(qid) + "|" + String(oid);
      if (on) d.modes[key].objectives[k] = "1";
      else delete d.modes[key].objectives[k];
      save(d);
      emit();
    },

    countObjectives: function (qid, oids, m) {
      if (!qid || !oids) return 0;
      var d = load();
      var src = d.modes[m || d.mode].objectives;
      var n = 0;
      for (var i = 0; i < oids.length; i++) if (src[String(qid) + "|" + String(oids[i])]) n++;
      return n;
    },

    /* 直设任务状态时，把目标轨一起对齐：
       · 设为「已完成」→ 勾满它的全部目标，否则展开后会看到「已完成但 0/N」的矛盾
       · 设为「未标记」→ 清空该任务的目标
       · 设为「进行中」→ **保留**已有目标进度（部分完成是真实信息，不该被抹掉） */
    alignObjectives: function (qid, oids, state, m) {
      if (!qid || !oids || !oids.length || state === "inhand") return;
      var d = load();
      var key = m || d.mode;
      for (var i = 0; i < oids.length; i++) {
        var k = String(qid) + "|" + String(oids[i]);
        if (state === "done") d.modes[key].objectives[k] = "1";
        else delete d.modes[key].objectives[k];
      }
      save(d);
      emit();
    },

    /* —— 门槛设置（商人忠诚度 / 阵营 / 转生）——
       都是「筛选条件」而不是「进度」，所以不放进任何一条轨、清轨时也不动。 */

    gates: function (m) {
      var d = load();
      var md = d.modes[m || d.mode];
      return { ll: md.ll, fence: md.fence, faction: md.faction, prestige: md.prestige, level: md.level };
    },

    /* Fence 声望：0 表示「没填」而不是「声望为 0」——后者是一个真实存在且
       会被用到的值（破镜重圆三条要求 Lightkeeper ≤ 0）。所以未填时存 null，
       判定时按「未知」处理成 soft 提示，不阻断也不放行。 */
    setFence: function (n) {
      var d = load();
      if (n === "" || n === null || n === undefined) delete d.modes[d.mode].fence;
      else {
        var v = parseInt(n, 10);
        if (!isFinite(v) || v < -10 || v > 10) delete d.modes[d.mode].fence;
        else d.modes[d.mode].fence = v;
      }
      save(d);
      emit();
    },

    getFence: function () {
      var d = load();
      var v = d.modes[d.mode].fence;
      return (v === undefined || v === null) ? null : v;
    },

    setLL: function (trader, n) {
      if (!trader) return;
      var d = load();
      var v = parseInt(n, 10);
      if (!isFinite(v) || v < 1 || v > 4) delete d.modes[d.mode].ll[trader];
      else d.modes[d.mode].ll[trader] = String(v);
      save(d);
      emit();
    },

    setFaction: function (f) {
      var d = load();
      d.modes[d.mode].faction = (f === "BEAR" || f === "USEC") ? f : "";
      save(d);
      emit();
    },

    setPrestige: function (n) {
      var d = load();
      var v = parseInt(n, 10);
      d.modes[d.mode].prestige = (isFinite(v) && v > 0 && v < 20) ? v : 0;
      save(d);
      emit();
    },

    /* —— 物品轨（数量） ——
       v3 起「已囤」是件数而不是两态：清单里 79 项有 75 项合计数量 ≥10，
       两态表达不了「还差多少」。值存数字字符串，0/缺失都表示没囤。 */

    itemCount: function (name, m) {
      if (!name) return 0;
      var d = load();
      var v = parseInt(d.modes[m || d.mode].items[name], 10);
      return (isFinite(v) && v > 0) ? v : 0;
    },

    setItemCount: function (name, n) {
      if (!name) return;
      var d = load();
      var v = parseInt(n, 10);
      if (!isFinite(v) || v <= 0) delete d.modes[d.mode].items[name];
      else d.modes[d.mode].items[name] = String(v);
      save(d);
      emit();
    },

    addItem: function (name, delta) {
      api.setItemCount(name, api.itemCount(name) + (parseInt(delta, 10) || 0));
    },

    /* 「已囤」的物品条数（有值的键数）—— 用于「已囤 N 件」这类绝对数。 */
    countItems: function (m) {
      var d = load();
      return Object.keys(d.modes[m || d.mode].items).length;
    },

    /* 达标数：已囤件数 ≥ 该物品的需求。需求由调用方传入（来自清单）。 */
    countItemsMet: function (reqs, m) {
      var d = load();
      var src = d.modes[m || d.mode].items;
      var n = 0;
      for (var i = 0; i < reqs.length; i++) {
        var got = parseInt(src[reqs[i].name], 10);
        if (isFinite(got) && got >= reqs[i].need) n++;
      }
      return n;
    },

    /* —— 藏身处轨（等级） —— */

    hideoutLevel: function (name, m) {
      if (!name) return 0;
      var d = load();
      var v = parseInt(d.modes[m || d.mode].hideout[name], 10);
      return (isFinite(v) && v > 0) ? v : 0;
    },

    setHideoutLevel: function (name, lv) {
      if (!name) return;
      var d = load();
      var n = parseInt(lv, 10);
      /* 0 与「未建造」是同一件事 —— 存 0 会让「已建造数」的统计多一次判断，
         直接从表里删掉更干净。 */
      if (!isFinite(n) || n <= 0) delete d.modes[d.mode].hideout[name];
      else d.modes[d.mode].hideout[name] = String(n);
      save(d);
      emit();
    },

    builtCount: function (m) {
      var d = load();
      var h = d.modes[m || d.mode].hideout;
      var n = 0;
      var keys = Object.keys(h);
      for (var i = 0; i < keys.length; i++) {
        if (parseInt(h[keys[i]], 10) > 0) n++;
      }
      return n;
    },

    /* 已建满：模块等级 == 该模块在清单里的最高等级。
       26 个模块**全部**有确定的上限（来自数据端点），所以这个数不会有
       「上限未知的模块永远计不进」的问题 —— 分母 26 是确定的。 */
    maxedCount: function (list, m) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var top = topLevel(list[i]);
        if (top && api.hideoutLevel(list[i].name, m) >= top) n++;
      }
      return n;
    },

    /* 可升下一级：还有下一级，且该级的材料已囤齐（件数全部达标）。
       前置设施与技能不在这个判据里 —— 那两样本站只做提示，不做判定：
       技能等级与设施等级都是「游戏内状态」，本站没有数据可依据。 */
    readyCount: function (list, m) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var nxt = nextLevelReq(list[i], api.hideoutLevel(list[i].name, m));
        if (!nxt) continue;
        if (nxt.items.length === 0) continue;
        if (api.countItemsMet(nxt.items, m) === nxt.items.length) n++;
      }
      return n;
    },

    /* —— 剧情章节轨（三态，纯手动） ——
       剧情章节的「未标记 / 进行中 / 已完成」。**与其它轨最大的不同：不做任何
       推断、也不与任务轨联动** —— 官方任务数据里没有「章节」这层结构、也没有
       章节→任务的映射，算不出来就不算（清单在 progress-manifest.js 的
       storyline 段，出处是 scripts/data/storylines.json，与剧情页成对维护）。
       键 = 清单里的 id（英文名可查的用英文名）——**不用中文名**：章节译名各
       来源不一（见 story-chapters.md 的说明），英文名才是稳的那个。 */

    chapterState: function (chid, m) {
      if (!chid) return "";
      var d = load();
      var v = d.modes[m || d.mode].storyline[chid];
      return (v === "done" || v === "inhand") ? v : "";
    },

    setChapterState: function (chid, state, m) {
      if (!chid) return;
      var d = load();
      var key = m || d.mode;
      if (state === "done" || state === "inhand") d.modes[key].storyline[chid] = state;
      else delete d.modes[key].storyline[chid];
      save(d);
      emit();
    },

    /* 汇总：{ done, inhand, total }。清单由调用方传入 —— 状态条、总览、剧情看板
       三处必须用这一个数：各算一份，迟早出现「同一页两个数字对不上」。 */
    storyCounts: function (list, m) {
      var d = load();
      var src = d.modes[m || d.mode].storyline;
      var arr = list || [];
      var out = { done: 0, inhand: 0, total: arr.length };
      for (var i = 0; i < arr.length; i++) {
        var st = src[arr[i].id];
        if (st === "done") out.done++;
        else if (st === "inhand") out.inhand++;
      }
      return out;
    },

    /* —— 日志同步：批量并入任务状态 ——

       与 setTaskState 的分工：那个是「单条改、交互用」，这个是「整批并、
       同步用」—— 一次 load / save / emit。逐条调 setTaskState 会对
       localStorage 做上百次读写、并触发上百次全站重绘（实测明显卡）。

       **只往强里改**：未标记 → 进行中 → 已完成。不会把已完成的降级 ——
       日志是游戏侧的事实，可以补全、可以升级，但不能因为一次同步把读者
       亲手标过的东西弄丢（与导入的「件数取较大值 / 剧情取较强状态」同一
       精神）。值的形态与 setTaskState 一致（商人 slug，用于按商人汇总）。

       dry = true 时只统计、不落盘 —— 给日志同步的「并入前预览」用：
       预览与真正并入走**同一套规则**，不在调用方复制一份（复制必然漂）。 */
    mergeTasks: function (entries, m, dry) {
      var out = { done: 0, inhand: 0, kept: 0 };
      if (!entries || !entries.length) return out;
      var d = load();
      var key = m || d.mode;
      var md = d.modes[key];
      if (!md) return out;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.id) continue;
        var inDone = Object.prototype.hasOwnProperty.call(md.quests, e.id);
        var inHand = Object.prototype.hasOwnProperty.call(md.inhand, e.id);
        if (e.state === "done") {
          if (inDone) { out.kept++; continue; }
          if (!dry) {
            delete md.inhand[e.id];
            md.quests[e.id] = e.trader || "";
          }
          out.done++;
        } else if (e.state === "inhand") {
          if (inDone || inHand) { out.kept++; continue; }
          if (!dry) md.inhand[e.id] = e.trader || "";
          out.inhand++;
        }
      }
      if (!dry) { save(d); emit(); }
      return out;
    },

    /* —— 通用 —— */

    /* track 省略 = 清空该模式的所有轨 */
    clear: function (track, m) {
      var d = load();
      var key = m || d.mode;
      if (TRACKS.indexOf(track) >= 0) d.modes[key][track] = {};
      else d.modes[key] = blankMode();
      save(d);
      emit();
    },

    exportText: function () { return JSON.stringify(load(), null, 2); },

    /* 导入：只接受本功能自己导出的结构。合并不是覆盖 —— 读者的直觉是
       「把我这份并进去」，覆盖会静默毁掉另一台上的进度。
       各轨的合并规则**不一样**（见内层注释）：任务取并集，件数与等级取较大值，
       剧情章节取较强状态。 */
    importText: function (text) {
      var src = null;
      try { src = JSON.parse(text); } catch (e) { return { ok: false, msg: "不是合法的 JSON 文件。" }; }
      if (!src || typeof src !== "object" || !src.modes) {
        return { ok: false, msg: "文件结构不对：不是本站导出的进度文件。" };
      }
      var d = load();
      var added = 0;
      for (var i = 0; i < MODES.length; i++) {
        var m = MODES[i];
        var sm = src.modes[m] || {};
        for (var t = 0; t < TRACKS.length; t++) {
          var track = TRACKS[t];
          /* 兼容 v1 文件：旧文件的任务进度在 `q` 里 */
          var srcMap = (sm[track] && typeof sm[track] === "object") ? sm[track]
                     : (track === "quests" && sm.q && typeof sm.q === "object") ? sm.q
                     : null;
          if (!srcMap) continue;
          var keys = Object.keys(srcMap);
          for (var k = 0; k < keys.length; k++) {
            var id = keys[k];
            if (!id) continue;
            var v = srcMap[id];
            var sv = (v === undefined || v === null) ? "" : String(v);

            if (track === "quests" || track === "inhand") {
              /* 任务类：取并集、保留已有 —— 值只是「哪个商人」，没有大小之分 */
              if (d.modes[m][track][id]) continue;
              d.modes[m][track][id] = sv;
              added++;
              continue;
            }

            /* 剧情章节：**取较强状态**（done > inhand > 未标记）。
               与「件数取较大值」同精神：导入是换设备合并、不是覆盖 ——
               让较弱的状态回来把「已完成」拉回「进行中」，那是在毁进度。 */
            if (track === "storyline") {
              var rank = { "": 0, "inhand": 1, "done": 2 };
              var imp = (sv === "done" || sv === "inhand") ? sv : "";
              if (!imp) continue;
              if ((rank[d.modes[m][track][id]] || 0) >= rank[imp]) continue;
              d.modes[m][track][id] = imp;
              added++;
              continue;
            }

            /* 物品件数与藏身处等级：**取较大值**。
               这两条轨的键值都是「进度」，而导入的用途是「换设备同步」——
               保留较旧的小值会让读者以为导入失败（实测踩到：本地 2 级 +
               导入 3 级，结果仍是 2 级）。 */
            var inc = parseInt(sv, 10);
            if (!isFinite(inc) || inc <= 0) continue;
            var cur = parseInt(d.modes[m][track][id], 10);
            if (isFinite(cur) && cur >= inc) continue;
            d.modes[m][track][id] = String(inc);
            added++;
          }
        }
      }
      if (src.mode && MODES.indexOf(src.mode) >= 0) d.mode = src.mode;
      save(d);
      emit();
      return {
        ok: true,
        msg: "已并入 " + added + " 条进度（任务取并集、件数与等级取较大值、"
           + "剧情章节取较强状态，都不会覆盖已有）。"
      };
    },

    subscribe: function (fn) {
      document.addEventListener(EVT, fn);
      return function () { document.removeEventListener(EVT, fn); };
    }
  };


  window.TarkovProgress = api;

  /* --------------------------------------------------------------------------
     当前页上下文
     -------------------------------------------------------------------------- */

  /* 商人 slug 从 URL 末段取（目录式 URL：/quests/prapor/）。
     只在有 h3[data-qid] 的页面上调用，所以不必担心命中别的栏目。 */
  function traderSlug() {
    var p = String(location.pathname || "").replace(/index\.html$/, "");
    var m = p.match(/\/quests\/([a-z0-9-]+)\/?$/);
    var s = m ? m[1] : "";
    return NON_TRADER[s] ? "" : s;
  }

  function qidOf(h) { return h.getAttribute("data-qid") || ""; }

  /* 取链接指向的锚点 id。
     ⚠️ 这里**必须**用 `a.hash`，不能用 `getAttribute("href")` 去掉首字符 ——
     Material 的 instant 导航会把正文里的相对链接**规范化成绝对 URL**，
     于是源码里的 `href="#q01"` 在 DOM 里变成
     `http://host/quests/prapor/#q01`。用 href 前缀匹配（`[href^="#q"]`）
     会一条都选不中，`getAttribute("href").slice(1)` 会拿到一串 URL 去
     `getElementById`，结果恒为 null。这一条是实测踩到的，不是理论风险。 */
  function hashId(a) {
    var h = a.hash || "";
    return h.charAt(0) === "#" ? h.slice(1) : "";
  }

  /* 页首索引表里的任务链接（排除标题自带的 ¶ 永久链接）。 */
  function indexLinks() {
    var all = document.querySelectorAll(".md-content__inner a[href]");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (a.classList && a.classList.contains("headerlink")) continue;
      if (!hashId(a)) continue;
      out.push(a);
    }
    return out;
  }

  function pageTotal() { return document.querySelectorAll("h3[data-qid]").length; }

  /* --------------------------------------------------------------------------
     状态分段控件（任务 / 剧情章节共用）

     三个状态（未标记 / 进行中 / 已完成）并排常驻显示、当前项高亮。
     2026-10-07 从原生 <select> 换成分段控件，原因：下拉把「有哪些状态可选」
     藏了起来 —— 要**点开**才知道有哪些选项，改一次状态要点两次，而这是全站
     最高频的动作；状态是整个列表里最重要的信号，却做成了最不起眼的控件。

     控件做成通用工厂：任务与剧情章节的读法/写法不同（任务带商人 slug、
     章节只带站内侧清单 id），但**交互与外观必须一致** —— 差异只允许存在于
     get / set 两个回调里，别再各写一份。
     -------------------------------------------------------------------------- */

  var STATE_OPTS = [["", "未标记"], ["inhand", "进行中"], ["done", "已完成"]];

  function makeSegSelect(opt) {
    var box = document.createElement("div");
    box.className = (opt.cls || "tk-qstate") + " tk-qstate--seg";
    box.setAttribute("role", "group");
    box.setAttribute("data-focus-key", opt.focusKey);
    box.setAttribute("aria-label", opt.ariaLabel);

    var cur = opt.get();
    for (var i = 0; i < STATE_OPTS.length; i++) {
      (function (val, label) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tk-qseg" + (val ? " tk-qseg--" + val : " tk-qseg--none");
        b.textContent = label;
        b.title = val ? ("标为「" + label + "」") : ("不标记" + opt.what + "（当前：" + label + "）");
        b.setAttribute("aria-pressed", val === cur ? "true" : "false");
        b.addEventListener("click", function () {
          if (opt.get() === val) return;      /* 已是当前态，不重绘 */
          /* 先派发再改状态：调用方（如看板）要拿新值去对齐明细，
             那必须在 set 触发整块重建之前跑完。 */
          try {
            box.dispatchEvent(new CustomEvent("tk:state", { bubbles: true, detail: val }));
          } catch (e) {
            box.dispatchEvent(new Event("tk:state"));
          }
          opt.set(val);
        });
        box.appendChild(b);
      })(STATE_OPTS[i][0], STATE_OPTS[i][1]);
    }
    /* 回填仍放在工厂里（v1.75.1 的教训）：看板每次变更都整块重建，
       控件若不自己认当前状态，两个调用点就会显示不一致。 */
    box.setAttribute("data-state", cur);
    return box;
  }

  function makeStateSelect(qid, trader, cls) {
    return makeSegSelect({
      cls: cls, focusKey: "q:" + qid,
      ariaLabel: "该任务在「我的进度」里的状态",
      what: "这个任务",
      get: function () { return api.taskState(qid); },
      set: function (v) { api.setTaskState(qid, v, trader); },
    });
  }

  /* 剧情章节的状态控件：同一套分段控件、同一套存储（只是换一条轨）。 */
  function makeChapterSelect(chid, cls) {
    return makeSegSelect({
      cls: cls, focusKey: "ch:" + chid,
      ariaLabel: "该剧情章节在「我的进度」里的状态",
      what: "这一章",
      get: function () { return api.chapterState(chid); },
      set: function (v) { api.setChapterState(chid, v); },
    });
  }

  /* 分段控件的值同步：整块重建后由调用方对齐高亮。
     （原 select 是靠 .value 赋值，这里是 aria-pressed + data-state。） */
  function syncStateSeg(box, st) {
    if (!box || box.className.indexOf("tk-qstate--seg") < 0) return;
    box.setAttribute("data-state", st || "");
    var bs = box.querySelectorAll(".tk-qseg");
    for (var i = 0; i < bs.length; i++) {
      var v = bs[i].className.indexOf("tk-qseg--inhand") >= 0 ? "inhand"
            : bs[i].className.indexOf("tk-qseg--done") >= 0 ? "done" : "";
      bs[i].setAttribute("aria-pressed", v === (st || "") ? "true" : "false");
    }
  }

  function syncHead(h, qid) {
    var st = api.taskState(qid);
    h.classList.toggle("tk-qdone", st === "done");
    h.classList.toggle("tk-qinhand", st === "inhand");
    syncStateSeg(h.querySelector(".tk-qstate"), st);
  }

  function decorate() {
    var heads = document.querySelectorAll("h3[data-qid]");
    if (!heads.length) return;

    var trader = traderSlug();
    var byAnchor = {};
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var qid = qidOf(h);
      if (!qid) continue;
      if (h.id) byAnchor[h.id] = qid;
      if (!h.querySelector(".tk-qstate")) {
        /* 插在标题**文字之前**（不是末尾）—— 状态控件要在行首才读得像清单 */
        h.insertBefore(makeStateSelect(qid, trader), h.firstChild);
      }
      syncHead(h, qid);
    }

    /* 页首索引表同步点亮（锚点判读见 hashId 的说明）。 */
    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var qid2 = byAnchor[hashId(a)];
      if (!qid2) continue;
      var row = a.closest("tr") || a;
      var st2 = api.taskState(qid2);
      row.classList.toggle("tk-qdone", st2 === "done");
      row.classList.toggle("tk-qinhand", st2 === "inhand");
    }
  }

  /* --------------------------------------------------------------------------
     剧情章节页（story-chapters.md）的状态控件

     每个 `<span data-chapter="<id>">` 是页面上留的挂点，控件插进去；整行按
     状态着色（沿用任务页的 tk-qdone / tk-qinhand 行样式 —— 全站一套视觉语言，
     不新建第二套）。**这条轨不做推断**，所以这里也没有任何「反推」逻辑：
     只画读者亲手标的状态。
     -------------------------------------------------------------------------- */

  function storySpans() {
    return document.querySelectorAll("[data-chapter]");
  }

  function syncStoryRow(sp, chid) {
    var st = chid ? api.chapterState(chid) : "";
    syncStateSeg(sp.querySelector(".tk-qstate"), st);
    var tr = sp.closest ? sp.closest("tr") : null;
    if (tr) {
      tr.classList.toggle("tk-qdone", st === "done");
      tr.classList.toggle("tk-qinhand", st === "inhand");
    }
  }

  function decorateStory() {
    var sps = storySpans();
    for (var i = 0; i < sps.length; i++) {
      var sp = sps[i];
      var chid = sp.getAttribute("data-chapter");
      if (!chid) continue;
      if (!sp.querySelector(".tk-qstate")) sp.appendChild(makeChapterSelect(chid));
      syncStoryRow(sp, chid);
    }
  }

  /* --------------------------------------------------------------------------
     进度模式切换条（只出现在任务页与总览页）
     -------------------------------------------------------------------------- */

  /* 站点根 URL：从**本脚本自己的 src** 反推。
     比从页头 logo 反推更直接，也不受页面层级影响 —— 站点部署在子路径下
     （本站是 /tarkov-encyclopedia/），硬编码绝对路径会 404。 */
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
    var s = document.querySelector('script[src*="progress.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function boardUrl() { return siteRoot() + "quests/progress/"; }

  /* 某个任务的明细直达链接。`link` 形如 "prapor#q07"，由生成器写入前置树。 */
  function questUrl(link) {
    if (!link) return "";
    var parts = String(link).split("#");
    if (parts.length !== 2) return "";
    return siteRoot() + "quests/" + parts[0] + "/#" + parts[1];
  }

  function onBoardPage() { return !!document.getElementById("tk-progress-board"); }

  function barStat() {
    var total = pageTotal();
    if (total) {
      var done = 0;
      var heads = document.querySelectorAll("h3[data-qid]");
      for (var i = 0; i < heads.length; i++) {
        if (api.taskState(qidOf(heads[i])) === "done") done++;
      }
      return "本页已标记 " + done + " / " + total;
    }
    var mf = window.TARKOV_PROGRESS_MANIFEST;
    /* 剧情章节页：数的是章节，不数任务 —— 查询位置相同、口径不同，必须在
       这里分开，否则页面从任务页切到剧情页时数字会突然从「任务」变成「章节」
       却看不出换过（同一条状态条在两页给两个含义的数）。 */
    if (storySpans().length && mf && mf.storyline && (mf.storyline.list || []).length) {
      var c = api.storyCounts(mf.storyline.list);
      return "章节：已完成 " + c.done + " · 进行中 " + c.inhand + " / 共 " + c.total;
    }
    /* 措辞必须与看板区分开：这里只数**手动标记**的完成数，
       而看板的「已完成」还含前置树推断出来的那些。写「全部 / 已完成」
       会让两处数字对不上，读者会以为有一个是错的。 */
    return "已标记 " + api.count() + (mf && mf.total ? " / " + mf.total : "");
  }

  function syncBar(bar) {
    var modes = bar.querySelectorAll(".tk-pgbar__mode");
    for (var i = 0; i < modes.length; i++) {
      var on = modes[i].getAttribute("data-mode") === api.mode();
      modes[i].classList.toggle("is-on", on);
      modes[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var stat = bar.querySelector(".tk-pgbar__stat");
    if (stat) stat.textContent = barStat();
  }

  function buildBar() {
    var bar = document.createElement("div");
    bar.className = "tk-pgbar";

    var lbl = document.createElement("span");
    lbl.className = "tk-pgbar__lbl";
    lbl.textContent = "进度模式";
    bar.appendChild(lbl);

    var group = document.createElement("div");
    group.className = "tk-pgbar__modes";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "选择要查看与记录的进度模式");
    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tk-pgbar__mode";
      b.setAttribute("data-mode", m);
      b.setAttribute("aria-pressed", "false");
      b.textContent = MODE_LABEL[m];
      b.addEventListener("click", function (e) {
        api.setMode(e.currentTarget.getAttribute("data-mode"));
      });
      group.appendChild(b);
    }
    bar.appendChild(group);

    var stat = document.createElement("span");
    stat.className = "tk-pgbar__stat";
    bar.appendChild(stat);

    var url = boardUrl();
    if (url && !onBoardPage()) {
      var link = document.createElement("a");
      link.className = "tk-pgbar__link";
      link.href = url;
      link.textContent = "进度总览";
      bar.appendChild(link);
    }

    var hint = document.createElement("span");
    hint.className = "tk-pgbar__hint";
    hint.textContent = "进度只存在本机浏览器";
    bar.appendChild(hint);

    syncBar(bar);
    buildStatusStrip(bar);
    return bar;
  }

  /* 常驻状态条（2026-10-07 新增）
     读者反馈「任务状态总览也不是在最醒目的地方」。原先总览是**第一个分页**，
     要先点进去才看得到；而分页切换后它就消失了 —— 改任务状态时**看不到全局**，
     只能来回切页。做法（参考 tarkovkappa 的 header progress）：
     把「完成 / 进行中 / 未标记」三个数 + 一条分段条**常驻在控制条里**，
     任何分页都在、任何时候都能扫一眼。
     数据来源与总览完全同源（TP.data()），不引入第二套口径。 */
  function buildStatusStrip(bar) {
    var host = document.getElementById("tk-statusbar");
    if (!host) return;
    var md = api.data();
    var md2 = md.modes[md.mode] || {};
    var explicit = md2.quests || {};
    var inhand = md2.inhand || {};
    var total = (window.TARKOV_PROGRESS_MANIFEST || {}).total || 0;

    var ids = Object.keys(explicit);
    var inhandIds = Object.keys(inhand);
    /* 手动 + 进行中 = 已触碰的量。这里**不把「进行中」算进完成** ——
       那是总览「手动 / 推断」那套更细的口径，本条只要一个扫读用的粗数。 */
    var touched = {};
    for (var i = 0; i < ids.length; i++) touched[ids[i]] = 1;
    for (var j = 0; j < inhandIds.length; j++) touched[inhandIds[j]] = 1;
    var doneN = 0;
    for (var dId in explicit) {
      if (api.taskState(dId) === "done") doneN++;
    }

    host.textContent = "";
    var strip = document.createElement("div");
    strip.className = "tk-strip";

    var lead = document.createElement("div");
    lead.className = "tk-strip__lead";
    var big = document.createElement("b");
    big.textContent = doneN;
    lead.appendChild(big);
    var cap = document.createElement("span");
    cap.textContent = " / " + total + " 已完成";
    lead.appendChild(cap);
    strip.appendChild(lead);

    var bar2 = document.createElement("div");
    bar2.className = "tk-strip__bar";
    bar2.setAttribute("role", "img");
    bar2.setAttribute("aria-label", "已完成 " + doneN + " / " + total + "，进行中 " + inhandIds.length
      + "，未标记 " + Math.max(0, total - Object.keys(touched).length));
    [
      ["done", doneN], ["inhand", inhandIds.length],
      ["rest", Math.max(0, total - Object.keys(touched).length)]
    ].forEach(function (pair) {
      var seg = document.createElement("i");
      seg.className = "tk-strip__seg tk-strip__seg--" + pair[0];
      seg.style.width = (total ? (pair[1] / total * 100) : 0) + "%";
      if (!pair[1]) seg.style.display = "none";
      bar2.appendChild(seg);
    });
    strip.appendChild(bar2);

    var lg = document.createElement("div");
    lg.className = "tk-strip__lg";
    [
      ["done", "已完成 " + doneN],
      ["inhand", "进行中 " + inhandIds.length],
      ["rest", "未标记 " + Math.max(0, total - Object.keys(touched).length)]
    ].forEach(function (pair) {
      var sp = document.createElement("span");
      sp.className = "tk-strip__lgi";
      var dot = document.createElement("i");
      dot.className = "tk-strip__dot tk-strip__dot--" + pair[0];
      sp.appendChild(dot);
      sp.appendChild(document.createTextNode(pair[1]));
      lg.appendChild(sp);
    });
    strip.appendChild(lg);

    host.appendChild(strip);
  }

  function mountBar() {
    var inner = document.querySelector(".md-content__inner");
    if (!inner || inner.querySelector(".tk-pgbar")) return;
    var bar = buildBar();
    /* 挂在 h1 之后：页面标题必须仍是正文第一行，控制条是附属信息。
       面包屑同理（它回答「我在哪一篇」），而它在脚本顺序上可能更晚插入 ——
       它自己会插到 .md-content__inner 的最前面，不受这里影响。 */
    var ref = inner.querySelector("h1") || inner.querySelector(".tk-crumb");
    if (ref) inner.insertBefore(bar, ref.nextSibling);
    else inner.insertBefore(bar, inner.firstChild);
  }

  /* --------------------------------------------------------------------------
     进度总览看板（`<div id="tk-progress-board">` 由 Markdown 提供挂载点）
     -------------------------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 立刻 revoke 在部分浏览器上会取消下载，延后一拍更稳。 */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

    /* --------------------------------------------------------------------------
     小工具（核心与看板共用）
     -------------------------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 某个外部脚本没载进来时给一句提示，而不是留一片空白。
     站点在搜索索引上已有同样的做法（见 search-ready.js），话术保持一致。 */
  function notReady(what) {
    return el("p", "tk-board__notready",
      what + "没有载入成功（可能是网络中断或脚本被拦截）。"
      + "本页其余说明不受影响；刷新一次通常即可恢复。");
  }

  /* --------------------------------------------------------------------------
     通用惰性加载器

     本站有若干「只有某一页用得到」的大文件（任务树 63 KB、任务明细分块、
     看板渲染 40+ KB）。把它们塞进 extra_javascript 等于让 118 个页面都多背一份，
     所以一律按需注入 —— 用同一个加载器，避免三处各写一套。
     -------------------------------------------------------------------------- */

  function loadScript(file, globalKeys, cb) {
    var keys = [].concat(globalKeys || []);
    var i;
    var ready = true;
    for (i = 0; i < keys.length; i++) {
      if (!window[keys[i]]) { ready = false; break; }
    }
    if (ready) { cb(true); return; }
    var url = siteRoot() + "javascripts/" + file;
    if (!url || url.indexOf("javascripts/") === 0) { cb(false); return; }
    var sc = document.createElement("script");
    sc.src = url;
    var done = false;
    sc.onload = function () { if (!done) { done = true; cb(true); } };
    sc.onerror = function () { if (!done) { done = true; cb(false); } };
    document.head.appendChild(sc);
  }

  /* --------------------------------------------------------------------------
     看板模块（「我的进度」页的任务 / 依赖树 / 物品 / 藏身处 / 剧情章节 / 管理各块）
     -------------------------------------------------------------------------- */

  var BOARD_IDS = ["tk-board-overview", "tk-progress-board", "tk-board-tree", "tk-board-items", "tk-board-hideout", "tk-board-story", "tk-board-ops"];
  var boardsState = 0;   // 0 未开始 / 1 加载中 / 2 就绪 / -1 失败
  var boardsCbs = [];

  function boardMounts() {
    var found = [];
    for (var i = 0; i < BOARD_IDS.length; i++) {
      var host = document.getElementById(BOARD_IDS[i]);
      if (host) found.push(host);
    }
    return found;
  }

  function loadBoards(cb) {
    if (window.TarkovProgressBoards) { cb(window.TarkovProgressBoards); return; }
    if (boardsState === -1) { cb(null); return; }
    boardsCbs.push(cb);
    if (boardsState === 1) return;
    boardsState = 1;
    loadScript("progress-boards.js", ["TarkovProgressBoards"], function (ok) {
      boardsState = ok && window.TarkovProgressBoards ? 2 : -1;
      var cbs = boardsCbs;
      boardsCbs = [];
      for (var i = 0; i < cbs.length; i++) cbs[i](window.TarkovProgressBoards || null);
    });
  }

  /* --------------------------------------------------------------------------
     入口
     -------------------------------------------------------------------------- */

  function render() {
    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;

    var mounts = boardMounts();
    var hasQuests = !!document.querySelector("h3[data-qid]");
    var hasStory = storySpans().length > 0;
    if (!mounts.length && !hasQuests && !hasStory) return;   // 其余 100+ 个页面完全不介入

    ensureMigrated();

    /* 每次换页都要重挂：instant 导航会把 .md-content__inner 整块换掉，
       上一页的节点已经不在文档里了。 */
    mountBar();
    if (hasQuests) decorate();
    if (hasStory) decorateStory();

    if (!mounts.length) return;
    for (var i = 0; i < mounts.length; i++) {
      if (!mounts[i].textContent || !mounts[i].firstElementChild) {
        mounts[i].appendChild(el("p", "tk-board__loading", "正在载入看板…"));
      }
    }
    loadBoards(function (mod) {
      if (!mod) {
        for (var j = 0; j < mounts.length; j++) {
          mounts[j].textContent = "";
          mounts[j].appendChild(notReady("进度看板"));
        }
        return;
      }
      mod.render(mounts);
    });
  }

  /* 勾选或换模式后，只重画状态，不重挂节点。
     三个看板里**都有输入控件**（数量框 / 等级下拉 / 搜索框），所以一律走各自的
     __tkSync 局部刷新 —— 整块重画会替换掉正在聚焦的元素（实测：改完藏身处
     等级后焦点掉到 BODY；任务看板重画还会把搜索词与光标位置一起丢掉）。 */
  function repaint() {
    var heads = document.querySelectorAll("h3[data-qid]");
    for (var i = 0; i < heads.length; i++) syncHead(heads[i], qidOf(heads[i]));

    var links = indexLinks();
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var h = document.getElementById(hashId(a));
      var qid = h ? qidOf(h) : "";
      if (!qid) continue;
      var row = a.closest("tr") || a;
      var st = api.taskState(qid);
      row.classList.toggle("tk-qdone", st === "done");
      row.classList.toggle("tk-qinhand", st === "inhand");
    }

    /* 剧情章节页的行状态也要跟着每次写操作重画（含跨标签页同步）。 */
    var sps = storySpans();
    for (var k = 0; k < sps.length; k++) {
      syncStoryRow(sps[k], sps[k].getAttribute("data-chapter"));
    }

    var bar = document.querySelector(".tk-pgbar");
    if (bar) syncBar(bar);

    if (window.TarkovProgressBoards) window.TarkovProgressBoards.sync();
  }

  api.subscribe(repaint);

  /* 多标签页同步：别的标签页写了同一个键时，本页的显示会陈旧。
     只重画显示，不重新读入（数据本身没丢）。 */
  window.addEventListener("storage", function (e) {
    if (e && e.key && e.key !== STORE_KEY) return;
    repaint();
  });

  /* 给惰性模块用的小工具。命名带下划线：**不是公开 API**，
     只是同一个脚本族之间的共享件（看板模块要用它们，但又不能各写一份）。 */
  api._ui = {
    el: el,
    notReady: notReady,
    loadScript: loadScript,
    makeStateSelect: makeStateSelect,
    makeChapterSelect: makeChapterSelect,
    syncStateSeg: syncStateSeg,
    questUrl: questUrl,
    siteRoot: siteRoot,
  };

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
