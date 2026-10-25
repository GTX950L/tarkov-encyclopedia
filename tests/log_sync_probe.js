/* log-sync.js 的端到端探针 —— 由 tests/test_log_sync_flow.py 通过 node 调用。
 *
 * 为什么不能只测纯函数：`_scanText` / `_collectRaids` 都是好的，
 * 但 2026-10-18 那次「清死函数」把 `loadRaids()` 删了、调用还在 ——
 * 纯函数用例全绿，真人一点同步就 ReferenceError，整整七版没被发现。
 * 所以这里**真的跑 run()**，喂内存里的 File 对象，看 TP.mergeTasks 收到什么。
 *
 * 输出一行 JSON：{ "full": "<mode>", "notifOnly": "<mode>", "rotated": "<mode>" }
 * 任何一步崩了就是非零退出 —— 让测试红在崩溃上，而不是红在断言上。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "content", "javascripts", "log-sync.js");
const code = fs.readFileSync(SRC, "utf8");

/* ---------------------------------------------------------------- 极简 DOM */
function mkNode(tag) {
  return {
    tagName: String(tag || "div").toUpperCase(),
    nodeType: 1,
    className: "", textContent: "", hidden: false,
    style: {}, dataset: {}, children: [], _handlers: {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    setAttribute() {}, remove() {}, scrollIntoView() {},
    closest() { return null; }, querySelector() { return null; },
  };
}

/* 从渲染树里找「并入我的进度」按钮的 click 回调 —— 并入动作是它触发的 */
function findMergeHandler(host) {
  const stack = [host];
  while (stack.length) {
    const n = stack.shift();
    if (n.textContent === "并入我的进度" && n._handlers.click) return n._handlers.click[0];
    (n.children || []).forEach(c => stack.push(c));
  }
  return null;
}

/* ------------------------------------------------------------- 内存 File */
class FakeFile {
  constructor(name, text, mtime) {
    this.name = name;
    this.__text = text;
    this.size = Buffer.byteLength(text, "utf8");
    this.lastModified = mtime || 1000;
  }
  slice(from) {
    const buf = Buffer.from(this.__text, "utf8").slice(from || 0);
    const f = new FakeFile(this.name, buf.toString("utf8"), this.lastModified);
    f.size = buf.length;
    return f;
  }
}

/* --------------------------------------------------------------- 合成日志 */
const QID_DONE = "5c51a1a486f7740a8609b6b5";
const QID_HAND = "5c51a1a486f7740a8609b6b6";
const SESS = "2026.10.25_20-00-00_1.2.5.0.48100";

function notifBlock(eventId, type, qid, ts) {
  return [
    (ts || "2026-10-25 20:01:02") + ".100|1.2.5.0.48100|Info|Default|Got notification | ChatMessageReceived",
    "{",
    '  "eventId": "' + eventId + '",',
    '  "message": {',
    '    "type": ' + type + ',',
    '    "templateId": "' + qid + ' ' + qid + '"',
    "  }",
    "}",
    "",
  ].join("\n");
}

/* `mode` 为 null 时不写 Session mode 行 —— 模拟 application 轮转到 _001 */
function appLog(mode) {
  const lines = [];
  if (mode) lines.push("2026-10-25 20:00:50.000|1.2.5.0.48100|Info|application|Session mode: " + mode);
  lines.push("2026-10-25 20:00:58.000|1.2.5.0.48100|Info|application|scene preset path:maps/customs_preset.bundle");
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ 环境 */
function buildEnv() {
  const store = new Map();
  const merged = [];

  const TP = {
    MODE_LABEL: { pvp: "PVP", pve: "PVE", season: "赛季" },
    mode: () => "pvp",
    mergeTasks(entries, m, dry) {
      if (!dry) merged.push({ mode: m, entries: entries.slice() });
      return {
        done: entries.filter(e => e.state === "done").length,
        inhand: entries.filter(e => e.state === "inhand").length,
        kept: 0,
      };
    },
    _ui: {
      el: (t, c, x) => { const n = mkNode(t); if (c) n.className = c; if (x != null) n.textContent = String(x); return n; },
      richEl: (t, c, x) => { const n = mkNode(t); if (c) n.className = c; if (x != null) n.textContent = String(x); return n; },
      siteRoot: () => "./",
      loadScript: (f, k, cb) => cb && cb(),
    },
  };

  const graph = { tasks: {} };
  graph.tasks[QID_DONE] = ["测试任务甲", "prapor", 1, [], "", "", {}, ""];
  graph.tasks[QID_HAND] = ["测试任务乙", "prapor", 1, [], "", "", {}, ""];

  const win = {
    TarkovProgress: TP,
    TarkovProgressBoards: { ensureGraph: cb => cb(graph) },
    TARKOV_QUEST_GRAPH: graph,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      createElement: t => mkNode(t),
      createTextNode: t => { const n = mkNode("#text"); n.textContent = String(t); return n; },
    },
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: win.document,
    console, Promise, Date, Object, String, Number, Array, JSON, Math,
    parseInt, RegExp, setTimeout,
    FileReader: function () {
      const fr = this;
      fr.readAsText = function (file) {
        const txt = file && file.__text != null ? file.__text : "";
        setTimeout(() => { fr.result = txt; fr.onload && fr.onload(); }, 0);
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { win, merged };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 跑一轮：喂文件 → 等解析 → 点「并入我的进度」→ 取写进的账本 */
async function round(files, opts) {
  const d = await roundDetail(files, opts);
  return d ? d.mode : "";
}
async function roundDetail(files, opts) {
  const { win, merged } = buildEnv();
  const host = mkNode("div");
  win.TarkovLogSync.run(files, host, opts || { fallbackMode: "pve" });
  await sleep(160);
  const cb = findMergeHandler(host);
  if (cb) cb();
  return merged.length ? merged[0] : null;
}
/* 某个任务最终被写成什么状态（找不到就是 undefined） */
function stateOf(d, qid) {
  if (!d) return "(no-merge)";
  const e = (d.entries || []).filter(x => x.id === qid)[0];
  return e ? e.state : "(absent)";
}

(async () => {
  const out = {};

  /* ① 常规：application 带 Session mode: Pve */
  out.full = await round([
    new FakeFile(SESS + " application_000.log", appLog("Pve"), 1000),
    new FakeFile(SESS + " push-notifications_000.log",
      notifBlock("ev-1", 12, QID_DONE) + notifBlock("ev-2", 10, QID_HAND), 1000),
  ]);

  /* ② 只选通知文件（界面上的「或选日志文件」）—— 没有 application */
  out.notifOnly = await round([
    new FakeFile(SESS + " push-notifications_000.log", notifBlock("ev-9", 12, QID_DONE), 2000),
  ]);

  /* ③ application 轮转到 _001，开头没有 Session mode 行 */
  out.rotated = await round([
    new FakeFile(SESS + " application_001.log", appLog(null), 3000),
    new FakeFile(SESS + " push-notifications_000.log", notifBlock("ev-11", 12, QID_DONE), 3000),
  ]);

  /* ④ 转生：同一任务**先完成、后重新接取** —— 状态要取时间更晚的那条（inhand）。
     这是 2026-10-25 修的那条：原来的「完成优先」会判成 done，
     本机 90 个会话里因此多算 7 票已完成。 */
  {
    const d = await roundDetail([
      new FakeFile(SESS + " application_000.log", appLog("Pve"), 4000),
      new FakeFile(SESS + " push-notifications_000.log",
        notifBlock("ev-21", 12, QID_DONE, "2026-10-02 20:01:02")     // 先完成
        + notifBlock("ev-22", 10, QID_DONE, "2026-10-09 20:55:00"),  // 转生后又接取
        4000),
    ]);
    out.afterPrestige = stateOf(d, QID_DONE);
  }

  /* ⑤ 正常推进：先接取、后完成 —— 结论必须是 done（别把 ④ 修过头） */
  {
    const d = await roundDetail([
      new FakeFile(SESS + " application_000.log", appLog("Pve"), 5000),
      new FakeFile(SESS + " push-notifications_000.log",
        notifBlock("ev-31", 10, QID_HAND, "2026-10-25 20:00:00")
        + notifBlock("ev-32", 12, QID_HAND, "2026-10-25 21:30:00"),
        5000),
    ]);
    out.normalFlow = stateOf(d, QID_HAND);
  }

  /* ⑥ 文件处理顺序不是时间顺序 —— 时间更早的事件**后**被读到，不能覆盖状态。
     目录遍历顺序未定义、跨会话还会交错，所以 eat() 必须比时间戳而不是「后到者赢」。 */
  {
    const d = await roundDetail([
      new FakeFile("log_b application_000.log", appLog("Pve"), 6000),
      new FakeFile("log_b push-notifications_000.log",
        notifBlock("ev-41", 10, QID_DONE, "2026-10-20 10:00:00"), 6000),   // 晚的先进
      new FakeFile("log_a push-notifications_000.log",
        notifBlock("ev-42", 12, QID_DONE, "2026-10-01 10:00:00"), 6000),   // 早的后到
    ]);
    out.outOfOrder = stateOf(d, QID_DONE);
  }

  process.stdout.write(JSON.stringify(out) + "\n");
})().catch(e => {
  console.error("probe failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
