/* ==========================================================================
   物品需求 · 共享判定（物品 → 任务，且**读进度**）
   --------------------------------------------------------------------------
   2026-10-17 之前，`quest-items.js` 与 `catalog-item.js` 各写一套「要留 / 不留」，
   判据只有 `rec.n > 0`（被几个任务需要），**完全不看任务做没做**。结果：
   一个已经清完 500 个任务的玩家，打开物品反查仍然满屏「要留」。

   这个模块把判定收成一份，两个消费方都调它：
     · `quest-items.js`  —— 物品反查页
     · `catalog-item.js` —— 物品图鉴单件页

   数据形状（`items_index.json` 的 `keep`）：
     [[任务名, 任务id 或 null], …]
   `null` = 站内重名任务（10 个名字对多个 id），生成器故意不给 id ——
   硬指会指到另一个任务上，所以这类**只计数、不判完成**，宁可保守。

   进度 API 由 progress.js 暴露（全站 extra_javascript 已加载）：
     TP.taskState(qid) → "done" | "inhand" | ""
   没有进度 API / 没有记录时，退回旧行为（「要留」），不凭空说「可出」。
   ========================================================================== */
(function () {
  "use strict";

  function TP() {
    return window.TarkovProgress || null;
  }

  function stateOf(qid) {
    var p = TP();
    if (!p || !qid || typeof p.taskState !== "function") return "";
    try { return p.taskState(qid) || ""; } catch (e) { return ""; }
  }

  /* 把 keep 的 [名字, id] 对展开成带状态的条目。
     `qid` 为空（重名任务）时 state = "unknown" —— 不把它算成已完成，
     否则「可出」会建立在一个没核实的任务上。 */
  function listOf(rec) {
    var keep = (rec && rec.keep) || [];
    return keep.map(function (x) {
      var name = Array.isArray(x) ? x[0] : String(x);
      var qid = Array.isArray(x) ? x[1] : null;
      return {
        name: name || "",
        qid: qid || "",
        state: qid ? stateOf(qid) : "unknown",
      };
    });
  }

  /* 藏身处需求（2026-10-27 新增）。
     数据形状（`items_index.json` 的 `h`）：
       [[模块名, 等级, 数量, fir(0/1)], …]
     `h` 只在有需求时才存在 —— 900 个物品里 119 个有，空数组会白占 5 KB。
     缺失时 `rec.h || []` 兜住，不改变「任务需求」的任何既有判定。 */
  function hideoutOf(rec) {
    var h = (rec && rec.h) || [];
    if (!h.length) return [];
    return h.map(function (x) {
      return {
        station: x[0] || "",
        level: x[1] || 0,
        count: x[2] || 1,
        fir: !!x[3],
      };
    });
  }

  /* 返回：
       cls   keep | partial | sell | hold | unknown
       text  要留 / 还需 N 个任务 / 任务已清 · 可出 / 藏身处要 · 留 / …
       total / done / inhand / remain / items / noProgress
       hList / hStations / hFir
     `remain` 包含「重名未知」的条目 —— 保守，不把未知算成已完成。

     ⚠️ 三条文案的边界（2026-10-27 加藏身处后重排，改任何一条都要同步
        `quests/item-lookup.md` 的判定表，否则页面说的和这里做的不一致）：
        · 任务全清 + 藏身处要 → 「任务已清 · 藏身处还要」（**不能说「可出」**）
        · 任务不要 + 藏身处要 → 「藏身处要 · 留」
        · 两者都不要         → 「任务与藏身处都不需要」（**不能说「任务里不需要」**，
          读者会读成「那可以出」） */
  function verdict(rec) {
    var items = listOf(rec);
    var total = items.length;
    var hlist = hideoutOf(rec);
    var hStations = [];
    hlist.forEach(function (x) {
      if (x.station && hStations.indexOf(x.station) < 0) hStations.push(x.station);
    });
    var hFir = hlist.some(function (x) { return x.fir; });
    var hx = { hList: hlist, hStations: hStations, hFir: hFir };

    function ret(o) {
      o.hList = hx.hList; o.hStations = hx.hStations; o.hFir = hx.hFir;
      return o;
    }

    if (!total) {
      if (hlist.length) {
        return ret({ cls: "hold", text: "藏身处要 · 留", total: 0, done: 0,
                     inhand: 0, remain: 0, items: items, noProgress: false });
      }
      return ret({ cls: "unknown", text: "任务与藏身处都不需要", total: 0,
                   done: 0, inhand: 0, remain: 0, items: items, noProgress: false });
    }
    var known = items.filter(function (x) { return !!x.qid; });
    if (!known.length) {
      return ret({ cls: "keep", text: "要留", total: total, done: 0,
                   inhand: 0, remain: total, items: items, noProgress: true });
    }
    var done = known.filter(function (x) { return x.state === "done"; }).length;
    var inhand = known.filter(function (x) { return x.state === "inhand"; }).length;
    var remain = total - done;
    if (remain === 0) {
      if (hlist.length) {
        return ret({ cls: "hold", text: "任务已清 · 藏身处还要", total: total,
                     done: done, inhand: inhand, remain: 0, items: items,
                     noProgress: false });
      }
      return ret({ cls: "sell", text: "任务已清 · 可出", total: total, done: done,
                   inhand: inhand, remain: 0, items: items, noProgress: false });
    }
    if (done || inhand) {
      return ret({ cls: "partial", text: "还需 " + remain + " 个任务", total: total,
                   done: done, inhand: inhand, remain: remain, items: items,
                   noProgress: false });
    }
    return ret({ cls: "keep", text: "要留", total: total, done: 0, inhand: 0,
                 remain: remain, items: items, noProgress: false });
  }

  window.TKQuestNeeds = {
    verdict: verdict,
    listOf: listOf,
    stateOf: stateOf,
    hideoutOf: hideoutOf,
  };
})();
