/* ==========================================================================
   从游戏日志同步（Logs → 「我的进度」）—— **惰性模块**

   要解决的问题：站内 515 个任务要读者自己勾，而游戏**把任务接取 / 完成
   都写进了本机日志**。本模块让读者**手动选一次 Logs 文件夹**，把已经
   发生的事实一次性补进账本；之后继续手勾增量（日志只覆盖「本机还留着
   日志的那段时间」——游戏会清理旧会话）。

   三条边界（决定了这个功能**是**什么、**不是**什么）：

     1. **不在后台自动读。** 网页不会自己碰读者磁盘 —— 没有 watcher、
        没有常驻进程；只有读者点了按钮、**亲自在系统对话框里选中目录**
        之后，文件才会被读。
     2. **不上传、不保存。** 解析全程在**本页内存**完成，没有任何网络
        请求；日志原文用完即弃，只有「任务 id → 状态」写进 localStorage。
        页面关掉，中间数据不留痕。
     3. **只补不降。** 日志是游戏侧的事实：可以补全空白、可以把「进行中」
        升级成「已完成」，但**不会**把已完成的降级 —— 与导入的「取较强
        状态」同一精神（见 progress.js 的 mergeTasks）。

   日志格式（2026-10-10 实测，1.1.5.1 与 1.2.0.0 两个版本一致）：
     · 事件写在 `<会话前缀> push-notifications_000.log`：行首
       `Got notification | ChatMessageReceived` + 紧随一个 JSON 块；
     · `message.type`：10=接取 / 11=失败 / 12=完成（与官方枚举同源）；
     · `templateId` 首段（24 位十六进制）= 任务 id，**与站内 515 个任务
       同一批 id**（不需要任何名字匹配）；
     · `<会话前缀> application_000.log` 里的 `Session mode:` 行决定写进
       哪个账本（Pve→PVE、Regular→PVP、Season→赛季）。
     · ⚠️ `output_000.log` 是同一批事件的大副本（单会话数 MB，实测 51 个
       会话合计 509 MB）——**实测其中没有通知文件里缺的事件（独占 = 0）**，
       所以默认**不读**它；只有某会话缺 push-notifications 文件时才回退
       读它的 output（兜底，保留正确性）。

   口径：任务表是**持久 PvP 口径的 515 条**。日常 / 周常与 PvE 专属任务
   不在其中 —— 那些事件**跳过并计数**，不硬塞（否则会污染分母）。

   入口在「我的进度 → 进度管理」：progress-boards.js 渲染按钮与文件输入，
   本文件只负责「读取 → 解析 → 预览 → 并入」与进度 / 摘要的绘制。
   ========================================================================== */

(function () {
  "use strict";

  var TP = window.TarkovProgress;
  if (!TP) return;
  var UI = TP._ui || {};
  var el = UI.el;
  var MODE_LABEL = TP.MODE_LABEL;

  /* --------------------------------------------------------------------------
     一、日志识别
     -------------------------------------------------------------------------- */

  /* 实测文件名：`2026.10.10_0-59-17_1.2.0.0.47965 push-notifications_000.log`
     —— 空格前是**会话前缀**（时间戳 + 游戏版本），空格后是角色 + 轮转序号。
     ⚠️ 按**文件名**判定会话而不是路径：目录入口（webkitdirectory）与文件
     入口（多选）给出的相对路径长得不一样（前者带目录层级），文件名却总是
     同一种写法 —— 一套判定同时喂两个入口。 */
  var NAME_RE = /^(.+?) (application|push-notifications|output)_\d+\.log$/i;
  var ROLE_KEY = { "application": "app", "push-notifications": "notif", "output": "out" };

  function roleOf(name) {
    var m = NAME_RE.exec(String(name || ""));
    if (!m) return null;
    return { session: m[1], key: ROLE_KEY[m[2].toLowerCase()] };
  }

  /* 事件行与字段。`Got notification |` 这个前缀不能省：同一段日志里还有一行
     `Received notification: Type: ChatMessageReceived`（处理器的回显），
     它也含 ChatMessageReceived，但不是事件本身 —— 只按前缀匹配才唯一。 */
  var NOTIF_RE = /Got notification \| ChatMessageReceived/;
  var HEX24_RE = /^([0-9a-f]{24})(?:\s|$)/;
  var MODE_RE = /Session mode: (\w+)/;
  var MODE_MAP = { pve: "pve", pvp: "pvp", regular: "pvp", season: "season" };

  /* --------------------------------------------------------------------------
     二、解析（纯函数，测试可直接调 _scanText）
     -------------------------------------------------------------------------- */

  /* 从一段日志文本里抽事件、喂给 sink。
     两处「块边界」防御：JSON 起点找不到 / 块尾找不到时**放弃这一条** ——
     游戏边玩边写，读到半截 JSON 块是常态，不能把半截块当 JSON 解析。 */
  function scanText(text, sink) {
    if (text.indexOf("ChatMessageReceived") < 0) return;   // 快速剔除：绝大多数行与它无关
    var lines = text.split("\n");
    var n = lines.length;
    var i = 0;
    while (i < n) {
      if (!NOTIF_RE.test(lines[i])) { i++; continue; }

      /* 找 JSON 起点：理论上一行就到（实测如此），容忍 6 行杂项。 */
      var j = i + 1, tries = 0;
      while (j < n && tries < 6 && lines[j].trim() !== "{") { j++; tries++; }
      if (j >= n || lines[j].trim() !== "{") { i++; continue; }

      /* 找块尾：顶层 `}` **独占一行**（JSON 子对象的收尾都带缩进，字符串
         里不可能有换行）—— 所以精确比较，不能用 trim（会把 `  }` 认成结尾）。
         兼容 CRLF 的 `}\r`。最多容忍 400 行，超了放弃这一条。 */
      var k = j, depth = 0;
      while (k < n && depth < 400) {
        var ln = lines[k];
        if (ln === "}" || ln === "}\r") break;
        k++; depth++;
      }
      if (k >= n || depth >= 400) break;                    // 到文件尾都没收尾：结束

      try {
        eat(JSON.parse(lines.slice(j, k + 1).join("\n")), sink);
      } catch (e) { /* 半截 JSON：忽略这一条 */ }
      i = k + 1;
    }
  }

  function eat(obj, sink) {
    var msg = (obj && obj.message) || {};
    var type = msg.type;
    if (type !== 10 && type !== 11 && type !== 12) return;  // 跳蚤 / 保险 / TwitchDrop 等非任务事件
    var eid = obj.eventId;
    if (eid) {
      /* 同一条通知会同时出现在 output 与 push-notifications 两个文件里；
         重开游戏也可能重复推送 —— 按 eventId 全局去重。 */
      if (sink.seen[eid]) return;
      sink.seen[eid] = 1;
    }
    if (type === 11) { sink.fails++; return; }              // 失败：本站没有对应轨
    var m = HEX24_RE.exec(String(msg.templateId || ""));
    if (!m) return;
    var qid = m[1];
    sink.events++;
    if (!sink.isTask(qid)) { sink.outside++; return; }      // 515 口径外（日常/周常等）
    var bucket = sink.modes[sink.mode] || (sink.modes[sink.mode] = { done: {}, inhand: {} });
    if (type === 12) bucket.done[qid] = sink.traderOf(qid);
    else bucket.inhand[qid] = sink.traderOf(qid);
  }

  /* --------------------------------------------------------------------------
     三、环境准备（任务图 / 文件读取）
     -------------------------------------------------------------------------- */

  /* 任务图（quests-graph.js）有两件事离不开它：
       · 判定「这个 id 在不在 515 任务表里」（口径外过滤）；
       · 取每个任务的商人（写进账本的值 —— 与手勾路径存的值同构）。
     优先借看板模块的 ensureGraph（它自带「多个等待者」的合并逻辑）；
     拿不到就从脚本加载器走原路。两条路都以「全局已存在」短路。 */
  function withGraph(cb) {
    if (window.TARKOV_QUEST_GRAPH) { cb(window.TARKOV_QUEST_GRAPH); return; }
    var Boards = window.TarkovProgressBoards;
    if (Boards && typeof Boards.ensureGraph === "function") { Boards.ensureGraph(cb); return; }
    UI.loadScript("quests-graph.js", ["TARKOV_QUEST_GRAPH"], function () {
      cb(window.TARKOV_QUEST_GRAPH || null);
    });
  }

  function readText(file) {
    return new Promise(function (resolve) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || "")); };
        fr.onerror = function () { resolve(""); };
        fr.readAsText(file);
      } catch (e) { resolve(""); }
    });
  }

  /* --------------------------------------------------------------------------
     四、主流程：读取 → 解析 → 预览 → 并入
     -------------------------------------------------------------------------- */

  function run(files, host) {
    if (!host) return;
    host.textContent = "";

    var box = el("div", "tk-board__logrun");
    var line = el("p", "tk-board__logline", "正在整理文件清单…");
    var prog = el("div", "tk-board__logprog");
    var fill = el("i");
    prog.appendChild(fill);
    box.appendChild(line);
    box.appendChild(prog);
    host.appendChild(box);

    /* —— ① 分组：会话前缀 → { app, notif, out } —— */
    var bySess = {}, matched = 0, i;
    for (i = 0; i < files.length; i++) {
      var r = roleOf(files[i].name);
      if (!r) continue;
      matched++;
      var g = bySess[r.session] || (bySess[r.session] = { app: [], notif: [], out: [] });
      g[r.key].push(files[i]);
    }

    if (!matched) {
      line.className = "tk-board__logline is-bad";
      line.textContent = "没找到塔科夫日志文件 —— 请选择 Logs 文件夹（Steam 版在 "
        + "…\\Escape from Tarkov\\build\\Logs，独立版在 …\\EFT\\Logs），"
        + "或直接多选其中的日志文件（文件名形如「… push-notifications_000.log」）。";
      prog.hidden = true;
      return;
    }

    /* —— ② 读取队列：先小文件（application / push-notifications）后大文件。
           output 只在会话缺通知文件时兜底（实测它没有独占事件，见文件头）。 —— */
    var queue = [], sessKeys = Object.keys(bySess), noApp = 0, fallbackOut = 0;
    for (i = 0; i < sessKeys.length; i++) {
      var s = sessKeys[i], g2 = bySess[s], a;
      if (!g2.app.length) noApp++;
      for (a = 0; a < g2.app.length; a++) queue.push([g2.app[a], s, "app"]);
      if (g2.notif.length) {
        for (a = 0; a < g2.notif.length; a++) queue.push([g2.notif[a], s, "notif"]);
      } else if (g2.out.length) {
        fallbackOut++;
        for (a = 0; a < g2.out.length; a++) queue.push([g2.out[a], s, "out"]);
      }
    }

    /* —— ③ 图数据到位后再解析 —— */
    withGraph(function (graph) {
      var tasks = (graph && graph.tasks) || null;
      if (!tasks) {
        line.className = "tk-board__logline is-bad";
        line.textContent = "任务数据（quests-graph.js）没有载入成功 —— 刷新页面再试。日志没有被解析。";
        prog.hidden = true;
        return;
      }

      var modeOf = {};
      var sink = {
        seen: {}, modes: {}, events: 0, outside: 0, fails: 0, mode: "pvp",
        isTask: function (qid) { return !!tasks[qid]; },
        traderOf: function (qid) { var node = tasks[qid]; return node ? (node[1] || "") : ""; },
      };

      var idx = 0, total = queue.length;

      function step() {
        if (idx >= total) { finish(); return; }
        var item = queue[idx];
        idx++;
        line.textContent = "正在读取 " + idx + " / " + total + " 个文件…";
        fill.style.width = Math.round(idx / total * 100) + "%";
        readText(item[0]).then(function (text) {
          if (item[2] === "app") {
            var m = MODE_RE.exec(text);
            var mapped = m ? MODE_MAP[String(m[1]).toLowerCase()] : "";
            if (mapped) modeOf[item[1]] = mapped;
          } else {
            sink.mode = modeOf[item[1]] || "pvp";   // 判不出模式时按 PVP 处理，并在摘要里说明
            scanText(text, sink);
          }
          /* 每 6 个文件让出一次主线程，进度条才有机会重绘。 */
          if (idx % 6 === 0) setTimeout(step, 0); else step();
        });
      }

      function finish() {
        prog.hidden = true;

        /* —— ④ 收敛：同一任务「先接取、后完成」时，完成胜出。—— */
        var modes = Object.keys(sink.modes);
        var plans = [], mi, key;
        for (mi = 0; mi < modes.length; mi++) {
          var bucket = sink.modes[modes[mi]];
          for (key in bucket.inhand) if (bucket.done[key]) delete bucket.inhand[key];
          var entries = [];
          for (key in bucket.done) entries.push({ id: key, state: "done", trader: bucket.done[key] });
          for (key in bucket.inhand) entries.push({ id: key, state: "inhand", trader: bucket.inhand[key] });
          if (!entries.length) continue;
          /* 预览用合并规则本身干跑一遍（dry）—— 不在本模块复制一份规则。 */
          plans.push({ mode: modes[mi], entries: entries, plan: TP.mergeTasks(entries, modes[mi], true) });
        }

        line.textContent = "扫描完成：" + sessKeys.length + " 个会话 · 读到任务事件 " + sink.events + " 条（去重后）"
          + (sink.outside ? "，其中 " + sink.outside + " 条不在 515 任务表（日常 / 周常等），已跳过" : "")
          + (sink.fails ? "；另有 " + sink.fails + " 条失败事件（本站没有失败轨）" : "")
          + (fallbackOut ? "；" + fallbackOut + " 个会话缺通知文件，已回退读 output" : "")
          + (noApp ? "；" + noApp + " 个会话没有模式记录，按 PVP 计" : "");

        if (!plans.length) {
          box.appendChild(el("p", "tk-board__logline is-bad",
            "没有可并入的任务状态 —— 可能这份日志里本来就没有任务事件，或选的不是塔科夫日志。"));
          return;
        }

        var sum = el("div", "tk-board__logsum");
        for (mi = 0; mi < plans.length; mi++) {
          var pl = plans[mi];
          var label = MODE_LABEL[pl.mode] || pl.mode;
          var nDone = 0, nIn = 0;
          for (i = 0; i < pl.entries.length; i++) {
            if (pl.entries[i].state === "done") nDone++; else nIn++;
          }
          var row = el("p");
          row.appendChild(el("b", null, label + "："));
          row.appendChild(document.createTextNode("已完成 " + nDone + " · 进行中 " + nIn
            + " —— 将并入：已完成 +" + pl.plan.done + " · 进行中 +" + pl.plan.inhand
            + (pl.plan.kept ? "（" + pl.plan.kept + " 条已有标记，不会覆盖）" : "")));
          sum.appendChild(row);
        }
        sum.appendChild(el("p", null,
          "并入的是各模式自己的账本（与当前页面显示的模式无关）。"
          + "「已完成」只会补全与升级，不会把已标记的改为未标记。"));
        box.appendChild(sum);

        var acts = el("div", "tk-board__logbar");
        var btnMerge = el("button", "tk-board__btn", "并入我的进度");
        btnMerge.type = "button";
        btnMerge.addEventListener("click", function () {
          var parts = [];
          for (var pi = 0; pi < plans.length; pi++) {
            var rr = TP.mergeTasks(plans[pi].entries, plans[pi].mode);
            parts.push((MODE_LABEL[plans[pi].mode] || plans[pi].mode)
              + " 已完成 +" + rr.done + " · 进行中 +" + rr.inhand
              + (rr.kept ? "（" + rr.kept + " 条已有标记未动）" : ""));
          }
          btnMerge.disabled = true;
          btnMerge.style.opacity = "0.55";
          sum.appendChild(el("p", "tk-board__logok", "已并入：" + parts.join("；")
            + "。如需退回：先用上方「导出进度」备份，再「清空已完成任务 / 清空进行中任务」。"));
          /* 并入的模式与当前页面模式不同时**必须指路**：看板与状态条都按
             当前模式显示 —— 不说明的话，读者在 PVP 模式下同步了 PVE 日志，
             会看到界面「什么都没发生」，以为功能没生效。 */
          var cur = TP.mode(), hasCur = false, want = [], wi;
          for (wi = 0; wi < plans.length; wi++) {
            if (plans[wi].mode === cur) hasCur = true;
            want.push(MODE_LABEL[plans[wi].mode] || plans[wi].mode);
          }
          if (!hasCur) {
            sum.appendChild(el("p", null, "当前页面显示的模式是「" + (MODE_LABEL[cur] || cur)
              + "」—— 在页面顶部的进度模式条切到「" + want.join(" / ")
              + "」，即可看到刚并入的进度。"));
          }
        });
        acts.appendChild(btnMerge);
        box.appendChild(acts);
      }

      step();
    });
  }

  /* 编解码/解析同时挂出来：端到端测试直接调 _scanText / _roleOf 做往返与
     规则验证 —— 只靠「点按钮 + 看界面」定位不到出错的那一步。 */
  window.TarkovLogSync = { run: run, _scanText: scanText, _roleOf: roleOf };
})();
