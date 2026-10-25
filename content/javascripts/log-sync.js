/* ==========================================================================
   从游戏日志同步（Logs → 「我的进度」）—— **惰性模块**

   要解决的问题：站内 504 个任务要读者自己勾，而游戏**把任务接取 / 完成
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
     · `templateId` 首段（24 位十六进制）= 任务 id，**与站内 504 个任务
       同一批 id**（不需要任何名字匹配）；
     · `<会话前缀> application_000.log` 里的 `Session mode:` 行决定写进
       哪个账本（Pve→PVE、Regular→PVP、Season→赛季）。
     · ⚠️ `output_000.log` 是同一批事件的大副本（单会话数 MB，实测 51 个
       会话合计 509 MB）——**实测其中没有通知文件里缺的事件（独占 = 0）**，
       所以默认**不读**它；只有某会话缺 push-notifications 文件时才回退
       读它的 output（兜底，保留正确性）。

   第二件事：地图与模式统计（v1.107.0 起）
   --------------------------------------
   同一个 `application_000.log` 里还有一行**每场战局都会写**的地图记录：

       scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset

   它比任务事件更早出现（地图加载时就写），所以**读文件时顺手就能拿到**，
   不需要额外的文件读取，也不需要联网。

   ⚠️ 为什么用这一行、而不是另外两种看起来更「正规」的候选（2026-10-12 实测
      本机 54 个会话 / 550 MB 日志对比出来）：
        · `[Transit] ... Locations:<名>` —— 只出现 **85** 次，而
          `LocationLoaded` 出现 **106** 次。**它跟的是转场机制、不是每场战局**
          （实测 15 场海关只记下 15 次里的少数），拿它统计会系统性少算。
          注意 `Locations:` 里的值还可能是**别名**（如 `Interchange`），
          与本行的 `rcid:` 不是同一个命名空间。
        · 只有 `scene preset path` 出现 **111** 次，与 `LocationLoaded` 的
          106 次基本对齐（多出的几条是转场时的再次加载）。
     结论：**以 `scene preset path` 为准**，并把「转场会多记一条」写进界面说明。

   统计的三条纪律：
     · 只统计**日志覆盖到的范围**（游戏会清理旧会话），界面上必须写清这一点，
       否则会被读成「我一共只打过这么多场」；
     · 认不出的内部名**原样显示并照常计数**，不静默丢弃 —— 认不出的是映射表
       的缺口，不是数据的问题；
     · 与任务同步**共用一次文件读取**，不为了地图再读一遍磁盘。

   口径：任务表是**持久 PvP 口径的 504 条**。日常 / 周常与 PvE 专属任务
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
  /* ⚠️ 文案里带 `**重点**` 的一律用 richEl（见 progress.js 的 richText）——
     el 走 textContent，**不解析 Markdown**，星号会原样显示在页面上。
     上一批本模块的口径说明就踩了这个坑（v1.107.0 上线后自查发现）。 */
  var richEl = UI.richEl;
  var MODE_LABEL = TP.MODE_LABEL;
  /* ⚠️ 站点根只能从 UI 借（progress.js 的 _ui.siteRoot），本文件自己没有 ——
     写成裸 siteRoot() 会在运行时报 ReferenceError，而**只有在有地图记录时
     才走到那一行**，所以读起来像「统计功能时灵时不灵」。 */
  function siteRoot() { return UI.siteRoot ? UI.siteRoot() : ""; }

  /* --------------------------------------------------------------------------
     〇、增量水印（2026-10-17）
     --------------------------------------------------------------------------
     每次同步都重读全部日志是不可接受的：文件头记录过 54 个会话 / 550 MB。
     这里按「文件名 + 大小 + lastModified」记住已处理文件，第二次只读新增 /
     变化的；`application_*.log` **例外**（永远读）—— 它只有几十 KB，却决定
     这批事件写进 PVP / PVE / 赛季哪个账本，跳过它会把模式判错。

     水印只在读者点「并入我的进度」之后才写：预览到一半关页面，下次还能重来。
     -------------------------------------------------------------------------- */
  var WM_KEY = "tarkov_log_sync_v1";
  /* 地图场次记录必须**单独持久化**（2026-10-18）。
     原因：它此前只活在本次扫描的内存里 —— 而本版起 application 日志也会被
     增量跳过（指纹没变就不读）。不落盘的话，跳过几个文件，历史场次就从统计里
     消失了，读者会看到「我的场次从 100 场变成 10 场」。
     去重键含会话名，所以重复读到同一行不会重复计数；上限 4000 条防止无限增长。 */
  var RAID_KEY = "tarkov_raids_v1";
  var RAID_MAX = 4000;

  function readWM() {
    try {
      var raw = window.localStorage.getItem(WM_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === "object") ? o : { at: "", files: {} };
    } catch (e) { return { at: "", files: {} }; }
  }

  /* 水位标记的结构（v2 · 2026-10-18）：
       files[文件名] = { s: 字节数, m: 修改时间, mode: "pve"|"pvp"|"season"|"" }
     为什么要把 mode 一起存：application 日志只在**开头**写 `Session mode:`，
     一旦支持「只读新增部分」（见下面的增量读取），就读不到那一行了 ——
     模式必须缓存下来，否则同一个会话第二次同步会被判成 PvP。
     ⚠️ v1 的格式是字符串 "size|lastModified"。读的时候要能认出来（见 wmEntry），
        否则升级当天所有人都会被判成「全部文件都没同步过」。 */
  function wmEntry(wm, name) {
    var v = wm && wm.files && wm.files[name];
    if (!v) return null;
    if (typeof v === "string") {
      return { s: parseInt(v, 10) || 0, m: 0, mode: "" };   // v1 兼容
    }
    return { s: v.s || 0, m: v.m || 0, mode: v.mode || "" };
  }

  function writeWM(files, modes) {
    try {
      var old = readWM(), map = {};
      // 只保留最近 800 个文件，防止 localStorage 无限长（日志会被游戏轮转）
      var names = Object.keys(old.files || {});
      names.slice(-800).forEach(function (n) { map[n] = old.files[n]; });
      (files || []).forEach(function (f) {
        var r = roleOf(f.name);
        if (!r) return;
        var prev = wmEntry(old, f.name);
        map[f.name] = {
          s: f.size,
          m: f.lastModified,
          /* 模式优先取本次解析到的；本次没解析（增量跳过）就沿用旧的。 */
          mode: (modes && modes[f.name]) || (prev && prev.mode) || "",
        };
      });
      window.localStorage.setItem(WM_KEY, JSON.stringify({
        at: new Date().toISOString(), files: map,
      }));
    } catch (e) { /* 隐私模式 / 配额满：静默降级，不影响本次同步 */ }
  }

  /* 从本机累积的地图场次起步 —— 与下面的 saveRaids 成对（存什么、读什么）。
     ⚠️ 2026-10-18 的「清死函数」批次（v1.135.0）把它当成死代码删了，但
        `run()` 的 ④ 之前仍在调它 —— 于是**每次同步都在读文件之前抛
        ReferenceError**：页面停在「正在整理文件清单…」，一条都不写。
        从 v1.135.0 到 v1.147.5（2026-10-25 修）这段时间，日志同步是死的。
        check_js_lint 只查「定义了没人调用」，查不出「调用了没定义」——
        这类崩溃只有真人点一次才会暴露，所以本次修复补了端到端用例
        （tests/test_log_sync_flow.py：真的跑 run()，而不是只测纯函数）。 */
  function loadRaids() {
    try {
      var raw = window.localStorage.getItem(RAID_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.list)) {
        return { list: o.list, seen: o.seen || {}, trunc: !!o.trunc };
      }
    } catch (e) { /* 坏数据当作没有：宁可重算，也不要让统计整块消失 */ }
    return { list: [], seen: {}, trunc: false };
  }

  function saveRaids(raids) {
    try {
      var list = raids.list;
      if (list.length > RAID_MAX) {
        /* 只保留最近的：list 是按扫描顺序追加的，前段是最旧的会话。
           seen 不裁剪会让它无限长大，所以**随 list 一起重建**。 */
        list = list.slice(list.length - RAID_MAX);
        var seen = {};
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          seen[r.session + "|" + r.date + " " + r.time + "|" + r.key] = 1;
        }
        raids.list = list;
        raids.seen = seen;
        raids.trunc = true;
      }
      window.localStorage.setItem(RAID_KEY, JSON.stringify({
        list: raids.list, seen: raids.seen, trunc: raids.trunc,
        at: new Date().toISOString(),
      }));
    } catch (e) { /* 配额满：本次统计仍在页面上显示，只是不跨会话累积 */ }
  }

  function clearRaids() {
    try { window.localStorage.removeItem(RAID_KEY); } catch (e) { /* 忽略 */ }
  }

  /* 只清「同步水位」—— 不动目录授权，也不动地图场次（2026-10-25）。
     给「按日志重建任务轨」用：水位还在的话，同步会认为所有文件都处理过、
     一句「没有新增日志」就打发了，重建出来是一本空账。 */
  function resetWatermark() {
    try { window.localStorage.removeItem(WM_KEY); } catch (e) { /* 隐私模式：忽略 */ }
  }

  function lastSyncText() {
    var wm = readWM();
    if (!wm.at) return "";
    try {
      var d = new Date(wm.at);
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
        + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

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

  /* 地图加载行（见文件头「第二件事」）。取 `maps/<名>_preset.bundle` 而不是
     `rcid:` —— 两者语义相同，但前者在实测里更稳定地存在（rcid 在个别会话
     缺过），且 `_preset.bundle` 这个后缀本身就是这道判据的锚。 */
  var SCENE_RE = /scene preset path:maps\/([A-Za-z0-9_]+)_preset\.bundle/;
  /* 行首时间戳：`2026-10-11 23:07:53.321|1.2.0.0.47965|Info|application|…` */
  var LINE_TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}/;
  /* 事件时刻（精确到秒）。任务事件的先后必须靠它判断 —— 见 eat() 的说明。 */
  var FULL_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

  /* 内部场景名 → 站内地图条目。
     · 已在本机日志实测到的（2026-10-12，54 个会话）：bigmap / sandbox /
       sandbox_high / sandbox_start / Sandbox_SL / shoreline / woods /
       Shopping_Mall / factory_day / city / laboratory；
     · 其余按社区口径列入（储备站、灯塔、终点站、破冰船、迷宫等）——
       本机日志里没出现过，所以**没有实测证据**，但名字是通行的。
     · **认不出的原样显示并照常计数**（见 renderRaidStats），不静默丢弃。 */
  var MAP_NAMES = {
    /* ⚠️ **同一个地名在不同游戏版本可能是不同写法**（2026-10-18 用本机
       70 个会话 / 763 MB 真实日志核对过）：
         · 1.1.5 时代写 `bigmap` / `Shoreline` / `Woods`（大写开头）
         · 1.2.5 起改成 `customs` / `shoreline` / `woods`（全小写）
       只按原写法建表，实测 **79/147 次加载（53%）认不出**，海关会显示成
       英文字面量 customs。所以：① 两种写法都收；② `mapOf` 再做一次
       大小写不敏感的回退，以后上游再改大小写也不会崩。 */
    bigmap: ["海关", "customs"],
    customs: ["海关", "customs"],
    Woods: ["森林", "woods"],
    woods: ["森林", "woods"],
    Shoreline: ["海岸线", "shoreline"],
    shoreline: ["海岸线", "shoreline"],
    Shopping_Mall: ["立交桥", "interchange"],
    Interchange: ["立交桥", "interchange"],
    city: ["街区", "streets"],
    TarkovStreets: ["街区", "streets"],
    RezervBase: ["储备站", "reserve"],
    Lighthouse: ["灯塔", "lighthouse"],
    laboratory: ["实验室", "labs"],
    Laboratory: ["实验室", "labs"],
    factory_day: ["工厂（白天）", "factory"],
    factory_night: ["工厂（夜间）", "factory"],
    factory4_day: ["工厂（白天）", "factory"],
    factory4_night: ["工厂（夜间）", "factory"],
    /* 中心区有四个场景变体（含 _SL 变体），归到同一篇 */
    sandbox: ["中心区", "ground-zero"],
    sandbox_high: ["中心区", "ground-zero"],
    sandbox_start: ["中心区", "ground-zero"],
    Sandbox_SL: ["中心区", "ground-zero"],
    labyrinth: ["迷宫", "labyrinth"],
    Labyrinth: ["迷宫", "labyrinth"],
    terminal: ["终点站", "terminal"],
    Terminal: ["终点站", "terminal"],
    icebreaker: ["破冰船", "icebreaker"],
    Icebreaker: ["破冰船", "icebreaker"]
  };

  /* 查到就返回；查不到再做一次**小写比对**（上游改过大小写，见上面注释）。
     仍然查不到就原样显示、`known: false` —— 不静默丢弃，认不出是映射表的缺口，
     不是数据的问题。 */
  var MAP_LOWER = null;
  function mapOf(key) {
    var m = MAP_NAMES[key];
    if (!m) {
      if (!MAP_LOWER) {
        MAP_LOWER = {};
        for (var k in MAP_NAMES) {
          if (Object.prototype.hasOwnProperty.call(MAP_NAMES, k)) {
            MAP_LOWER[k.toLowerCase()] = MAP_NAMES[k];
          }
        }
      }
      m = MAP_LOWER[String(key).toLowerCase()];
    }
    return m ? { zh: m[0], slug: m[1], known: true }
             : { zh: key, slug: "", known: false };
  }

  /* --------------------------------------------------------------------------
     二、解析（纯函数，测试可直接调 _scanText）
     -------------------------------------------------------------------------- */

  /* 从一段日志文本里抽事件、喂给 sink。
     两处「块边界」防御：JSON 起点找不到 / 块尾找不到时**放弃这一条** ——
     游戏边玩边写，读到半截 JSON 块是常态，不能把半截块当 JSON 解析。
     `_scanText` 供单测直接调用 —— **必须能拿到每条事件的时间戳**，
     否则「转生后重新接取」会被当成「一直没完成」（见 eat 的说明）。 */
  function scanText(text, sink) {
    if (text.indexOf("ChatMessageReceived") < 0) return;   // 快速剔除：绝大多数行与它无关
    var lines = text.split("\n");
    var n = lines.length;
    var i = 0;
    while (i < n) {
      if (!NOTIF_RE.test(lines[i])) { i++; continue; }

      /* 事件时刻取 `Got notification` 那行的行首（精确到秒）。
         精确到分钟不够：同一分钟内「接取 → 完成」的连续事件会被判成同一时刻，
         排序就退化成「谁先被读到谁赢」。 */
      var tsm = FULL_TS_RE.exec(lines[i]);
      var ts = tsm ? tsm[1] : "";

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
        eat(JSON.parse(lines.slice(j, k + 1).join("\n")), sink, ts);
      } catch (e) { /* 半截 JSON：忽略这一条 */ }
      i = k + 1;
    }
  }

  function eat(obj, sink, ts) {
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
    if (!sink.isTask(qid)) { sink.outside++; return; }      // 当前任务表外（日常/周常等）

    /* 每个任务只留**时间最晚**的那条事件（2026-10-25 改）。
       原来是「完成优先」：同一批事件里只要有 type 12 就判已完成，不看先后。
       这对普通推进没问题，但对**转生**是错的 —— 转生会把任务清空重来，
       日志里就变成「10-02 完成 → 10-09 又接取」，而完成优先仍判已完成。
       实测本机 90 个会话：完成优先得 104 完成 / 65 进行中，
       按时间线取最后一条是 97 / 72 —— 差的 7 票全是「完成过又被重新接取」。

       ⚠️ 文件处理顺序**不是**时间顺序（目录遍历顺序未定义、跨会话交错），
          所以不能「后到者覆盖」，必须比时间戳。空时间戳按最旧处理。 */
    var bucket = sink.modes[sink.mode] || (sink.modes[sink.mode] = { seen: {} });
    var state = type === 12 ? "done" : "inhand";
    var prev = bucket.seen[qid];
    if (!prev || String(ts) >= String(prev.ts)) {
      bucket.seen[qid] = { state: state, ts: ts, trader: sink.traderOf(qid) };
    }
  }

  /* --------------------------------------------------------------------------
     二·b、地图记录（纯函数，测试可直接调 _collectRaids）
     -------------------------------------------------------------------------- */

  /* 从 application 日志里抽「地图加载」记录，推进 out.list。 */
  function collectRaids(text, session, out) {
    if (text.indexOf("scene preset path") < 0) return;   // 快速剔除
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = SCENE_RE.exec(lines[i]);
      if (!m) continue;
      var t = LINE_TS_RE.exec(lines[i]);
      var date = t ? (t[1] + "-" + t[2] + "-" + t[3]) : "";
      /* ⚠️ 正则里第 4 组已经是 `HH:MM`（秒是**未捕获**的 `\d{2}`），
         原来写成 `t[4] + ":" + t[5]` → 表格里显示 `16:14:undefined`
         （2026-10-18 用真实日志才看见，仿真日志的时间恰好也没暴露）。 */
      var time = t ? t[4] : "";
      /* 去重键 = 会话 + 秒级时刻 + 场景。同一次加载偶尔被写两遍。
         ⚠️ **不要**跨会话去重（不同会话的同一时刻是两场），也不要按图去重
         （同一张图会打很多场）—— 这两种去重都会把统计压小。 */
      var dedup = session + "|" + date + " " + time + "|" + m[1];
      if (out.seen[dedup]) continue;
      out.seen[dedup] = 1;
      out.list.push({ session: session, key: m[1], date: date, time: time });
    }
  }

  /* 一张小表 —— 与站内其余运行时建表同一条约定：必须自己套
     .md-typeset__table（extra.css 第 3 节写明它是全站唯一的表格滚动容器）。 */
  function miniTable(headers, rows) {
    var tb = document.createElement("table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    for (var i = 0; i < headers.length; i++) {
      hr.appendChild(el("th", i === 0 ? null : "tk-col-num", headers[i]));
    }
    thead.appendChild(hr);
    tb.appendChild(thead);
    var tbody = document.createElement("tbody");
    for (var j = 0; j < rows.length; j++) {
      var tr = document.createElement("tr");
      for (var k = 0; k < rows[j].length; k++) {
        var cell = rows[j][k];
        var td = el("td", k === 0 ? null : "tk-col-num", null);
        /* 单元格允许是 DOM 节点（地图名要能点进条目），也可以是纯文本。 */
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? "" : String(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tb.appendChild(tbody);
    var wrap = document.createElement("div");
    wrap.className = "md-typeset__table";
    wrap.appendChild(tb);
    return wrap;
  }

  function renderRaidStats(host, raids, modeOf) {
    var list = raids.list;
    if (!list.length) return;

    var byMap = {}, byMode = {}, i, k;
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      var mp = mapOf(r.key);
      /* 认不出的内部名**原样显示并照常计数** —— 认不出是映射表的缺口，
         不是数据的问题；静默丢弃会让「地图分布」少掉一整块。 */
      var mk = mp.known ? mp.zh : r.key;
      if (!byMap[mk]) byMap[mk] = { n: 0, slug: mp.slug, known: mp.known, raw: [] };
      byMap[mk].n++;
      if (byMap[mk].raw.indexOf(r.key) < 0) byMap[mk].raw.push(r.key);
      var mode = modeOf[r.session] || "pvp";
      byMode[mode] = (byMode[mode] || 0) + 1;
    }

    var box = el("div", "tk-board__maps");

    /* —— 地图分布 —— */
    var mapRows = Object.keys(byMap)
      .map(function (name) { return [name, byMap[name]]; })
      .sort(function (a, b) { return b[1].n - a[1].n; })
      .map(function (p) {
        var name = p[0], rec = p[1];
        var first;
        if (rec.known && rec.slug) {
          /* 能对上站内条目就给一条路：这个统计的价值有一半在「接着去哪读」 */
          var a = el("a", null, name);
          a.href = siteRoot() + "entries/" + rec.slug + "/";
          first = a;
        } else {
          first = el("span", null, name);
        }
        var cells = [first, String(rec.n),
          Math.round(rec.n / list.length * 100) + "%"];
        /* 归到同一篇的几个内部名（如中心区的 4 个变体）在这里列出原名，
           让读者能自己核对我们有没有归错。 */
        if (rec.raw.length > 1) cells.push(rec.raw.join(" / "));
        return cells;
      });
    var headers = ["地图", "场次", "占比"];
    if (mapRows.some(function (r) { return r.length > 3; })) headers.push("日志里的内部名");
    box.appendChild(el("h5", null, "打过哪些图"));
    box.appendChild(miniTable(headers, mapRows));

    /* —— 模式分布 —— */
    var modeRows = Object.keys(byMode)
      .sort(function (a, b) { return byMode[b] - byMode[a]; })
      .map(function (m) {
        return [MODE_LABEL[m] || m, String(byMode[m]),
          Math.round(byMode[m] / list.length * 100) + "%"];
      });
    box.appendChild(el("h5", null, "在哪个模式打的"));
    box.appendChild(miniTable(["模式", "场次", "占比"], modeRows));

    /* —— 最近 10 场 —— */
    var recent = list.slice().sort(function (a, b) {
      var ka = a.date + " " + a.time, kb = b.date + " " + b.time;
      return ka < kb ? 1 : (ka > kb ? -1 : 0);
    }).slice(0, 10);
    box.appendChild(el("h5", null, "最近 " + recent.length + " 场（新 → 旧）"));
    box.appendChild(miniTable(["时间", "地图", "模式"], recent.map(function (r) {
      var mp = mapOf(r.key);
      return [
        (r.date || "—") + " " + (r.time || ""),
        mp.known ? mp.zh : r.key,
        MODE_LABEL[modeOf[r.session] || "pvp"] || "PVP"
      ];
    })));

    /* —— 口径（必须写，否则会被读成「我一共只打过这么多场」）—— */
    var raidNote = "口径：统计**从你第一次同步起累积**在本机（记录存在这个浏览器里），"
      + "所以即使游戏后来清理了旧会话，已经记下的场次不会消失。"
      + "地图按日志里的场景加载记录计，**一次转场会各记一条**"
      + "（实测 111 条加载 vs 106 次 LocationLoaded），所以场次可能略多于实际战局数。"
      + "地图名由场景名映射到站内条目，没有列进映射表的会原样显示。"
      + "与任务进度一样：日志原文只在本页内存里解析，不上传、不联网。";
    if (raids.trunc) {
      raidNote += "**只保留最近 " + RAID_MAX + " 场** —— 更早的记录为了控制存储已滚出。";
    }
    box.appendChild(richEl("p", "tk-board__mapnote", raidNote));

    host.appendChild(box);
  }

  /* --------------------------------------------------------------------------
     三、环境准备（任务图 / 文件读取）
     -------------------------------------------------------------------------- */

  /* 任务图（quests-graph.js）有两件事离不开它：
       · 判定「这个 id 在不在当前任务表里」（口径外过滤）；
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

  /* 读文件文本。fromByte > 0 时**只读尾部** —— 「游戏边写边同步」的关键：
     application 日志动辄几 MB，每次全读等于把整段历史重新解析一遍。
     ⚠️ 从字节偏移切会切断多字节字符与半行，所以**丢弃第一行**（见 cutHead）——
        这对 `scene preset path` 这种整行记录是安全的，对跨行的 JSON 块**不安全**，
        所以只有 application 日志用增量，push-notifications 永远整读（见 run）。 */
  function readText(file, fromByte) {
    return new Promise(function (resolve) {
      try {
        var blob = (fromByte > 0 && fromByte < file.size) ? file.slice(fromByte) : file;
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || "")); };
        fr.onerror = function () { resolve(""); };
        fr.readAsText(blob);
      } catch (e) { resolve(""); }
    });
  }

  /* 增量读时，首行可能是被切断的半行 —— 但**不能无条件丢**：
     实测「只追加一行」的情况下，从旧 size 开始读恰好就是那一整行，
     无条件丢会把这条记录吃掉（第 3 轮追加的 Woods 加载记录就这么丢过）。
     日志每行都以 `2026-10-18 10:00:01.000|…` 开头，所以按**行首时间戳**判定
     是否完整：像时间戳就留下，不像才丢。 */
  function dropBrokenHead(text) {
    var i = text.indexOf("\n");
    if (i < 0) return text;
    return LINE_TS_RE.test(text) ? text : text.slice(i + 1);
  }

  /* --------------------------------------------------------------------------
     四、主流程：读取 → 解析 → 预览 → 并入
     -------------------------------------------------------------------------- */

  function run(files, host, opts) {
    if (!host) return;
    opts = opts || {};
    host.textContent = "";

    /* ── 增量过滤（v2 · 2026-10-18 重做）─────────────────────────────
       旧版是「application 永远整读」—— 因为要在里面找 `Session mode:`。
       实测代价很大：一个会话的 application 日志动辄几 MB，54 个会话就是几百 MB，
       而绝大多数内容上次已经解析过了。现在分三种情况：

         · 指纹没变           → 整个跳过（application 也一样）
         · 指纹变了且只是变大 → **只读新增的尾巴**（模式从水位标记里取）
         · 变小 / 首次 / 没法比 → 整读（文件被轮转或重写，旧偏移不可信）

       ⚠️ push-notifications **不做尾部增量**：它的事件是一个跨多行的 JSON 块，
          从任意字节切开会把 JSON 劈成半截，解析静默失败 —— 比慢更糟。
          它只会「指纹没变就跳过」，变了就整读（那正是正在玩的那个会话，通常很小）。 */
    var origFiles = Array.prototype.slice.call(files || []);
    var wm = readWM(), skipped = 0, kept = [], tailOnly = 0;
    origFiles.forEach(function (f) {
      var r = roleOf(f.name);
      if (!r) return;
      var prev = wmEntry(wm, f.name);
      if (prev && prev.s === f.size && prev.m === f.lastModified) {
        skipped++;
        return;
      }
      var from = 0;
      if (r.key === "app" && prev && prev.s > 0 && f.size > prev.s && prev.mode) {
        from = prev.s;          // 只读新增部分；模式用缓存的那份
        tailOnly++;
      }
      kept.push({ f: f, from: from, mode: prev ? prev.mode : "" });
    });
    files = kept;

    if (!files.length) {
      /* quiet（自动同步）时只说一句「已是最新」——
         每次打开页面都刷一大段「没有新增日志…」是噪音。 */
      var none = el("p", "tk-board__logline",
        opts.quiet
          ? "日志已是最新（上次同步 " + (lastSyncText() || "—") + "）"
          : "没有新增日志 —— 上次同步是 " + (lastSyncText() || "—")
            + "，选中的 " + origFiles.length + " 个文件都已处理过。"
            + "如需重读全部，先点下方「断开连接」清除同步记录。");
      host.appendChild(none);
      return;
    }

    var box = el("div", "tk-board__logrun");
    var scope = "正在整理文件清单…";
    if (skipped || tailOnly) {
      scope = "增量：" + skipped + " 个文件没变、直接跳过"
        + (tailOnly ? "，" + tailOnly + " 个只读新增部分" : "")
        + "；本次需处理 " + files.length + " 个。";
    }
    var line = el("p", "tk-board__logline", scope);
    var prog = el("div", "tk-board__logprog");
    var fill = el("i");
    prog.appendChild(fill);
    box.appendChild(line);
    box.appendChild(prog);
    host.appendChild(box);

    /* —— ① 分组：会话前缀 → { app, notif, out } ——
       文件项是 { f: File, from: 起始字节, mode: 缓存的模式 }（见上面的增量过滤）。 */
    var bySess = {}, matched = 0, i;
    for (i = 0; i < files.length; i++) {
      var r = roleOf(files[i].f.name);
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
      for (a = 0; a < g2.app.length; a++) queue.push(g2.app[a]);
      if (g2.notif.length) {
        for (a = 0; a < g2.notif.length; a++) queue.push(g2.notif[a]);
      } else if (g2.out.length) {
        fallbackOut++;
        for (a = 0; a < g2.out.length; a++) queue.push(g2.out[a]);
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
      /* 判不出模式时的落点：**调用方给的当前页面模式**，而不是硬编码 PVP。
         作战台传 S.mode、进度页传账本的 d.mode（见 log-source.js 的
         currentMode）—— 读者在 PVE 页面同步，最可能就是在 PVE 玩。 */
      var fallback = (opts.fallbackMode && MODE_LABEL[opts.fallbackMode]) ? opts.fallbackMode : "pvp";
      /* 地图记录与任务事件**共用这一趟文件读取** —— 不为地图再读一遍磁盘。 */
      /* 从本机累积记录起步（见 RAID_KEY 的说明）——跳过文件不会丢历史场次。 */
      var raids = loadRaids();
      var sink = {
        seen: {}, modes: {}, events: 0, outside: 0, fails: 0, mode: fallback,
        unknown: {},
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
        var fobj = item.f, sessKey = roleOf(fobj.name).session;
        var keyRole = roleOf(fobj.name).key;
        readText(fobj, item.from).then(function (rawText) {
          /* 尾部增量读会把第一行切成半截 —— 丢掉它（模式/地图行都是整行记录，
             丢一行不影响正确性；不丢才可能解析出半个字段）。 */
          var text = item.from > 0 ? dropBrokenHead(rawText) : rawText;
          if (keyRole === "app") {
            /* 模式：整读时从 `Session mode:` 取；增量读时**用缓存的** ——
               那一行在文件开头，尾部里根本没有。 */
            var m = MODE_RE.exec(text);
            var mapped = m ? MODE_MAP[String(m[1]).toLowerCase()] : "";
            if (mapped) modeOf[sessKey] = mapped;
            else if (item.mode) modeOf[sessKey] = item.mode;
            /* 同一份文本里顺手抽地图加载记录（见文件头「第二件事」）。 */
            collectRaids(text, sessKey, raids);
          } else {
            /* 兜底顺序（2026-10-25 修）：modeOf（本次 app 读到的）→ item.mode
               （这个文件自己的水位里缓存的）→ 调用方给的当前模式 → PVP。

               ⚠️ 原来只有第一级，第二级明明在手边却没用：一旦某会话的
               application 没读到 `Session mode:`（日志轮转到 `_001`、或读者
               只用「或选日志文件」没选 application），那一整批事件就被静默
               写进 **PVP** 账本 —— PVE 读者同步完在 PVE 账本里一条也看不到。 */
            if (!modeOf[sessKey]) {
              if (item.mode) {
                modeOf[sessKey] = item.mode;
              } else {
                modeOf[sessKey] = fallback;
                sink.unknown[sessKey] = 1;
              }
            }
            sink.mode = modeOf[sessKey];
            scanText(text, sink);
          }
          /* 每 6 个文件让出一次主线程，进度条才有机会重绘。 */
          if (idx % 6 === 0) setTimeout(step, 0); else step();
        });
      }

      function finish() {
        prog.hidden = true;

        /* 地图场次立刻落盘：它是**只读事实**，没有「待确认」的语义，
           不需要等读者点并入。任务状态另走下面的合并按钮。 */
        saveRaids(raids);

        /* —— ④ 展开：每个任务一条，状态已由 eat() 按**时间最晚**的事件定好。——
           此前这里是「完成优先」的第二次覆盖：只要同一批里出现过 type 12 就判完成，
           不看先后 —— 转生（任务清空重来）会被它算成「一直完成着」。
           现在只做展开，不再二次裁决：裁决只有一个地方（eat）。 */
        var modes = Object.keys(sink.modes);
        var plans = [], mi, key;
        for (mi = 0; mi < modes.length; mi++) {
          var bucket = sink.modes[modes[mi]];
          var entries = [];
          for (key in bucket.seen) {
            entries.push({
              id: key,
              state: bucket.seen[key].state,
              trader: bucket.seen[key].trader,
            });
          }
          if (!entries.length) continue;
          /* 预览用合并规则本身干跑一遍（dry）—— 不在本模块复制一份规则。 */
          plans.push({ mode: modes[mi], entries: entries, plan: TP.mergeTasks(entries, modes[mi], true) });
        }

        /* 模式口径要分开说 —— 「没有 application 日志」和「有日志但读不到
           Session mode」是两件事，合成一句会让读者以为自己的日志缺文件。
           后者从 2026-10-25 起不再静默计 PVP，而是按当前页面模式并写明。 */
        var unknownN = Object.keys(sink.unknown).length;
        var modeNote = [];
        if (noApp) modeNote.push(noApp + " 个会话没有 application 日志");
        if (unknownN) {
          modeNote.push(unknownN + " 个会话读不到模式，已按当前页面的「"
            + (MODE_LABEL[fallback] || fallback) + "」计");
        }

        line.textContent = "扫描完成：" + sessKeys.length + " 个会话 · 读到任务事件 " + sink.events + " 条（去重后）"
          + (sink.outside ? "，其中 " + sink.outside + " 条不在当前 " + Object.keys(tasks).length + " 任务表（日常 / 周常等），已跳过" : "")
          + (sink.fails ? "；另有 " + sink.fails + " 条失败事件（本站没有失败轨）" : "")
          + (fallbackOut ? "；" + fallbackOut + " 个会话缺通知文件，已回退读 output" : "")
          + (modeNote.length ? "；" + modeNote.join("、") : "")
          + (skipped ? "；跳过 " + skipped + " 个已处理文件" : "")
          /* 这里是**累积**条数（含以前同步过、这次因没变而跳过的会话）——
             写成「本次读到」会让人以为跳过的文件没进统计。 */
          + (raids.list.length ? "；累计 " + raids.list.length + " 场地图记录" : "");

        /* ⚠️ 地图统计**放在「有没有任务事件」这个分支之前**：
           它的数据来源与任务事件无关（地图行每场都写，任务事件可能一场都没有）。
           放在分支后面，读者会得到「这份日志什么都没有」的错觉 ——
           而实际上他可能只是那段时间没做任务。 */
        renderRaidStats(box, raids, modeOf);

        if (!plans.length) {
          box.appendChild(el("p", "tk-board__logline" + (raids.list.length ? "" : " is-bad"),
            raids.list.length
              ? "没有可并入的任务状态 —— 这段时间的日志里没有任务接取 / 完成事件"
                + "（上面的地图统计不受影响）。"
              : "没有可并入的任务状态 —— 可能这份日志里本来就没有任务事件，或选的不是塔科夫日志。"));
          /* 没有待确认的任务状态 → **可以推进水位**（2026-10-18）：
             否则下一轮还会把同一批文件重读一遍。地图记录已在上面落盘，
             任务侧本来就没有东西可丢，所以这次推进是安全的。
             ⚠️ 反过来不成立：**有**任务事件时必须等读者点并入才推进，
                否则他会「预览过就算同步过」，账本里一条也没有。 */
          var modeByName2 = {};
          origFiles.forEach(function (f) {
            var rr = roleOf(f.name);
            if (rr && modeOf[rr.session]) modeByName2[f.name] = modeOf[rr.session];
          });
          writeWM(origFiles, modeByName2);
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
        /* 并入动作抽成函数：手动点按钮与「自动并入」共用同一条路径 ——
           两条路径分开写迟早会分叉（一边补了水位、另一边忘了）。 */
        function doMerge(auto) {
          var parts = [];
          for (var pi = 0; pi < plans.length; pi++) {
            /* 「按日志重建」模式（2026-10-25）：先清空这一模式的任务轨，再整批写入。
               ⚠️ 清空与写入必须在**同一个循环体**里紧接着做 —— 分开做的话，
                  中途任何一步失败都会留下「清空了但没写进去」的空账本。
               普通同步绝不清空（见 mergeTasks 的「只补不降」）。 */
            var wiped = false;
            if (opts.replaceTrack && TP.replaceTaskTrack) {
              try { wiped = TP.replaceTaskTrack(plans[pi].mode); } catch (e) { wiped = false; }
            }
            var rr = TP.mergeTasks(plans[pi].entries, plans[pi].mode);
            parts.push((MODE_LABEL[plans[pi].mode] || plans[pi].mode)
              + (wiped ? "（已按日志重建）" : "")
              + " 已完成 +" + rr.done + " · 进行中 +" + rr.inhand
              + (rr.kept && !wiped ? "（" + rr.kept + " 条已有标记未动）" : ""));
          }
          if (!auto) {
            btnMerge.disabled = true;
            btnMerge.style.opacity = "0.55";
          }
          sum.appendChild(el("p", "tk-board__logok", "已并入：" + parts.join("；")
            + "。如需退回：先用上方「导出进度」备份，再「清空已完成任务 / 清空进行中任务」。"));
          /* 并入成功后才推进水印 —— 预览到一半关页面，下次仍能重来。 */
          /* 把「会话前缀 → 模式」换算成「文件名 → 模式」再写水位，
             下次增量读 application 时才能直接拿到模式。 */
          var modeByName = {};
          origFiles.forEach(function (f) {
            var rr = roleOf(f.name);
            if (rr && modeOf[rr.session]) modeByName[f.name] = modeOf[rr.session];
          });
          writeWM(origFiles, modeByName);
          if (typeof opts.onMerged === "function") {
            try { opts.onMerged(lastSyncText()); } catch (e) { /* 界面刷新失败不影响账本 */ }
          }
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
        }
        btnMerge.addEventListener("click", function () { doMerge(false); });
        acts.appendChild(btnMerge);
        box.appendChild(acts);

        /* 自动并入（默认关，读者自己在同步区勾选）：
           直接走同一条 doMerge —— 只补不降，且会给出「已并入 …」的说明。 */
        if (opts.autoMerge) {
          acts.appendChild(el("p", "tk-board__logline",
            "自动并入已开启 —— 已直接写入，无需再点按钮。"));
          try { doMerge(true); } catch (e) { /* 失败时按钮仍可点，读者手动重试 */ }
          /* 写完之后把按钮禁掉：留着它等于邀请读者再点一次，
             虽然 mergeTasks 幂等（已有标记不动），但没有任何收益。 */
          btnMerge.disabled = true;
          btnMerge.style.opacity = "0.45";
          btnMerge.textContent = "已自动并入";
        }
      }

      step();
    });
  }

  /* 编解码/解析同时挂出来：端到端测试直接调 _scanText / _roleOf / _collectRaids
     做往返与规则验证 —— 只靠「点按钮 + 看界面」定位不到出错的那一步。 */
  window.TarkovLogSync = {
    run: run,
    /* 给「断开连接」用：一并清掉累积的地图场次记录。
       不清的话，读者点了断开、重新选一个目录，还会看到上一份日志的场次。 */
    clearRaids: clearRaids,
    /* 给「按日志重建」用：只清水位，保留目录授权与地图场次。 */
    resetWatermark: resetWatermark,
    _scanText: scanText,
    _roleOf: roleOf,
    _collectRaids: collectRaids,
    _mapOf: mapOf
  };
})();
