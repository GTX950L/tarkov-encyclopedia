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
       v: 1,
       mode: "pvp" | "pve" | "season",
       modes: { <模式>: { q: { <任务数据 id>: <商人 slug> } } }
     }

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

     结构（v2）：
       {
         v: 2,
         mode: "pvp" | "pve" | "season",
         modes: { <模式>: { quests: {}, items: {}, hideout: {} } }
       }

     三条轨各自独立、共用同一个模式维度：
       · quests   —— 值 = 商人 slug（用于按商人汇总）
       · items    —— 值 = "1"（只需要「囤了没有」两态）
       · hideout  —— 值 = 等级数字的字符串；0/缺失都表示未建造
     键：任务用数据端点 id；物品与藏身处用**中文名**（这两份派生数据里没有 id，
     见总览页「数据与隐私」对名称变动的说明）。
     -------------------------------------------------------------------------- */

  var SCHEMA_VERSION = 5;

  function blankMode() {
    return {
      quests: {}, inhand: {}, items: {}, hideout: {}, objectives: {},
      ll: {},                 // 商人忠诚度：{ <商人slug>: "1".."4" }
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
        ll: cleanMap(src.ll),
        level: 0,
        faction: "",
        prestige: 0,
      };
      /* 我的等级：只接受 1–99 的整数，其余当没填（0）。
         它不是「进度」而是「筛选条件」，所以单独存、不放进任何一条轨。 */
      var lv = parseInt(src.level, 10);
      mode.level = (isFinite(lv) && lv > 0 && lv < 100) ? lv : 0;
      mode.faction = (src.faction === "BEAR" || src.faction === "USEC") ? src.faction : "";
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

  var TRACKS = ["quests", "inhand", "objectives", "items", "hideout"];
  var TRACK_LABEL = {
    quests: "已完成任务", inhand: "进行中任务", objectives: "任务目标",
    items: "物品收集", hideout: "藏身处",
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
      return { ll: md.ll, faction: md.faction, prestige: md.prestige, level: md.level };
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

    /* —— 通用 —— */

    /* track 省略 = 清空该模式的三条轨 */
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
       三条轨的合并规则**不一样**（见内层注释）：任务取并集，件数与等级取较大值。 */
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
        msg: "已并入 " + added + " 条进度（任务取并集、件数与等级取较大值，都不会覆盖已有）。"
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
     任务标题上的勾选框
     -------------------------------------------------------------------------- */

  /* --------------------------------------------------------------------------
     任务标题上的状态控件

     用**三态下拉**而不是勾选框：「进行中」是按前置树反推已完成的**输入**，
     只有两态时读者没法表达「我正拿着它」。三态也顺带解决了
     「我不记得之前完成了什么」—— 那本来就不该由读者回答。
     -------------------------------------------------------------------------- */

  var STATE_OPTS = [["", "未标记"], ["inhand", "进行中"], ["done", "已完成"]];

  function makeStateSelect(qid, trader, cls) {
    var sel = document.createElement("select");
    sel.className = cls || "tk-qstate";
    sel.setAttribute("data-focus-key", "q:" + qid);
    sel.setAttribute("aria-label", "该任务在「我的进度」里的状态");
    for (var i = 0; i < STATE_OPTS.length; i++) {
      var o = document.createElement("option");
      o.value = STATE_OPTS[i][0];
      o.textContent = STATE_OPTS[i][1];
      sel.appendChild(o);
    }
    /* ⚠️ 回填必须在这里做，不能只靠调用方。
       「我的进度」看板的列表每次状态变更都**整块重建**；新建的 select 若停在
       第一个选项，读者会看到「进行中 / 已完成」区里的任务、行首却写着「未标记」
       —— 而他明明标过。任务页那边由 syncHead() 回填，看板当初漏了这一步，
       于是同一份数据在两处的显示不一致。把回填放进工厂里，两个调用点就都不会漏。
       （v1.75.1 修复：读者报「选的进行中，但前面还是写着未标记」。） */
    sel.value = api.taskState(qid);
    sel.addEventListener("change", function () {
      api.setTaskState(qid, sel.value, trader);
    });
    return sel;
  }

  function syncHead(h, qid) {
    var st = api.taskState(qid);
    h.classList.toggle("tk-qdone", st === "done");
    h.classList.toggle("tk-qinhand", st === "inhand");
    var sel = h.querySelector(".tk-qstate");
    if (sel && sel.value !== st) sel.value = st;
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
     进度模式切换条（只出现在任务页与总览页）
     -------------------------------------------------------------------------- */

  /* 站点根 URL：从**本脚本自己的 src** 反推。
     比从页头 logo 反推更直接，也不受页面层级影响 —— 站点部署在子路径下
     （本站是 /tarkov-encyclopedia/），硬编码绝对路径会 404。 */
  function siteRoot() {
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
    return bar;
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
     看板模块（「我的进度」页的任务 / 物品 / 藏身处 / 管理四块）
     -------------------------------------------------------------------------- */

  var BOARD_IDS = ["tk-progress-board", "tk-board-items", "tk-board-hideout", "tk-board-ops"];
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
    if (!mounts.length && !hasQuests) return;   // 其余 100+ 个页面完全不介入

    ensureMigrated();

    /* 每次换页都要重挂：instant 导航会把 .md-content__inner 整块换掉，
       上一页的节点已经不在文档里了。 */
    mountBar();
    if (hasQuests) decorate();

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
