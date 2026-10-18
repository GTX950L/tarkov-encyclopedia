/* ==========================================================================
   从游戏日志同步 —— 共享层（2026-10-18）

   **为什么单独成文件**：这套东西原来只长在「我的进度 → 进度管理」那一页里，
   作战台 `/ops/` 想用就得复制一遍 —— 而复制权限/句柄/增量这套代码，
   两边迟早分叉（这是本项目反复吃过的亏：一处补了水位、另一处忘了）。

   本文件负责三件事，两页共用：
     1. **权限与句柄**：IndexedDB 存 FileSystemDirectoryHandle；
        `showDirectoryPicker` 选目录；`queryPermission` 判断能否自动同步。
     2. **文件收集**：递归遍历目录，按 `collect` 的节奏分片让出主线程。
     3. **控件**：`mount(host, opts)` 生成同一套按钮与开关（compact 版给作战台）。

   解析仍归 log-sync.js（惰性加载），本文件只负责「把 File[] 递给它」。

   ⚠️ 三条硬约束（改之前先读）：
     · IDB 库名 / store / 键名（tk-logs / handles / "logs"）**不能改** ——
       改了两页就不再共享同一份授权，读者要在每个页面各授权一次。
     · 控件里**不能用 `<label>`**：MkDocs Material 的页签组件靠
       `.tabbed-set label` 选择器工作，页面里任何 `<label>` 都会被当成一个
       tab 赋上隐藏样式（实测 offsetParent: null、尺寸全 0，读者点不到）。
     · 自动同步只在 `queryPermission() === "granted"` 时发生 ——
       即读者授权时选了「每次访问都允许」。其余情况一律退化为「点一下」，
       不假装在自动。
   ========================================================================== */
(function () {
  "use strict";

  var IDB_NAME = "tk-logs";
  var IDB_STORE = "handles";
  var IDB_KEY = "logs";
  var WM_KEY = "tarkov_log_sync_v1";
  var AUTO_KEY = "tarkov_log_automerge";

  var state = {
    handle: null,
    autoTried: false,
    busy: false,
  };

  /* ---------------------------------------------------------------- 小工具 */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* `**重点**` → <b>。站点统一约定（见 progress.js 的 richText / richEl），
     本模块自己实现一份而不是依赖 progress.js —— 作战台不一定加载那一页的脚本。 */
  function richEl(tag, cls, text) {
    var n = el(tag, cls);
    var parts = String(text == null ? "" : text).split("**");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      n.appendChild(i % 2 === 1
        ? el("b", null, parts[i])
        : document.createTextNode(parts[i]));
    }
    return n;
  }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式：忽略 */ }
    return null;
  }

  function drop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }

  /* 站根：按**本脚本的 src** 反推。不能按 location.pathname ——
     在 /ops/ 下会得到 "/ops/"，拼出的 javascripts/x.js 直接 404。 */
  function siteRoot() {
    var s = document.querySelector('script[src*="javascripts/log-source.js"]')
      || document.currentScript;
    if (!s) return "./";
    try {
      return new URL(s.src, location.href).href.replace(/javascripts\/log-source\.js.*$/, "");
    } catch (e) { return "./"; }
  }

  /* 惰性加载解析器；已存在就不重复注入。 */
  function loadSyntax(cb) {
    if (window.TarkovLogSync) { cb(true); return; }
    var s = document.createElement("script");
    s.src = siteRoot() + "javascripts/log-sync.js";
    s.onload = function () { cb(!!window.TarkovLogSync); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------- IndexedDB */
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("no-idb")); return; }
      var r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(IDB_STORE)) {
          r.result.createObjectStore(IDB_STORE);
        }
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("idb")); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(IDB_STORE, "readonly");
        var q = t.objectStore(IDB_STORE).get(key);
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }

  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(IDB_STORE, "readwrite");
        t.objectStore(IDB_STORE).put(val, key);
        t.oncomplete = function () { res(true); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction(IDB_STORE, "readwrite");
        t.objectStore(IDB_STORE).delete(key);
        t.oncomplete = function () { res(true); };
        t.onerror = function () { res(false); };
      });
    });
  }

  /* ------------------------------------------------------------ 目录遍历 */
  /* 递归收集目录里的文件。用 `for await (dir.values())` —— 这是
     FileSystemDirectoryHandle 的异步迭代器，Chromium 才有。 */
  async function collectDir(dir, out) {
    out = out || [];
    for await (var ent of dir.values()) {
      if (ent.kind === "file") out.push(await ent.getFile());
      else if (ent.kind === "directory") await collectDir(ent, out);
    }
    return out;
  }

  /* ---------------------------------------------------------------- 状态 */
  function lastSyncAt() {
    try {
      var o = JSON.parse(store(WM_KEY) || "null");
      return (o && o.at) || "";
    } catch (e) { return ""; }
  }

  function lastSyncLabel() {
    var at = lastSyncAt();
    if (!at) return "";
    try {
      var d = new Date(at), p = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
        + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  function autoMergeOn() { return store(AUTO_KEY) === "1"; }
  function setAutoMerge(on) { store(AUTO_KEY, on ? "1" : "0"); }

  /* ------------------------------------------------------------ 控件挂载 */

  /* opts:
       compact   true = 作战台用的紧凑版（一句说明、按钮更小）
       title     可选，覆盖默认标题
       onStatus  function({connected, lastSync, autoMerge}) —— 每次状态变化回调
       toast     function(text, ok) —— 可选，覆盖默认的临时提示
   返回 { refresh(), syncNow(), forget(), hasHandle() }  */
  function mount(host, opts) {
    opts = opts || {};
    host.classList.add("tk-logsrc");
    if (opts.compact) host.classList.add("tk-logsrc--compact");

    function notify(msg, ok) {
      if (typeof opts.toast === "function") { opts.toast(msg, ok); return; }
      var t = el("p", "tk-logsrc__toast" + (ok === false ? " is-bad" : ""), msg);
      host.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
    }

    if (!opts.compact) {
      host.appendChild(el("h4", null, opts.title || "从游戏日志同步（可选）"));
      host.appendChild(richEl("p", "tk-logsrc__note",
        "读你本机的塔科夫日志，把已经发生的「接取 / 完成」补进账本 —— "
        + "在**本页内存**里解析：不上传、不保存、不联网。藏身处、等级、目标级勾选与"
        + "物品数量日志里没有，仍需手勾。日志位置：Steam 版 "
        + "`…\\Escape from Tarkov\\build\\Logs`，独立版 `…\\EFT\\Logs`。"));
    } else {
      host.appendChild(el("div", "tk-logsrc__cap", opts.title || "从游戏日志同步"));
      host.appendChild(el("p", "tk-logsrc__note tk-logsrc__note--short",
        "读本机日志把「接取 / 完成」补进账本，只读、不上传。"
        + "授权时选「每次访问都允许」→ 以后打开这页自动补。"));
    }

    var bar = el("div", "tk-logsrc__bar");
    var dirBtn = el("button", "tk-logsrc__btn", "选择 Logs 文件夹");
    dirBtn.type = "button";
    var fileBtn = el("button", "tk-logsrc__btn tk-logsrc__btn--ghost", "或选日志文件");
    fileBtn.type = "button";
    var forgetBtn = el("button", "tk-logsrc__btn tk-logsrc__btn--ghost", "断开");
    forgetBtn.type = "button";
    forgetBtn.hidden = true;
    forgetBtn.title = "清除已保存的 Logs 目录授权与同步记录；不会删除任何日志文件";

    /* 自动并入开关（默认关）。**不能是 <label>** —— 见文件头。 */
    var autoWrap = el("div", "tk-logsrc__auto");
    var autoChk = document.createElement("input");
    autoChk.type = "checkbox";
    autoChk.checked = autoMergeOn();
    var autoTxt = el("span", null, "自动并入");
    autoTxt.title = "开启后，自动同步会直接把结果写进账本（只补不降）。"
      + "关闭时只准备预览，仍需点一次「并入我的进度」。";
    autoTxt.addEventListener("click", function () {
      autoChk.checked = !autoChk.checked;
      autoChk.dispatchEvent(new Event("change"));
    });
    autoChk.addEventListener("change", function () {
      setAutoMerge(autoChk.checked);
      notify(autoChk.checked
        ? "已开启自动并入：自动同步会直接写入账本（只补不降）。"
        : "已关闭自动并入：自动同步只准备预览，需手动确认。", true);
    });
    autoWrap.appendChild(autoChk);
    autoWrap.appendChild(autoTxt);

    var count = el("span", "tk-logsrc__count");
    bar.appendChild(dirBtn);
    bar.appendChild(fileBtn);
    bar.appendChild(forgetBtn);
    bar.appendChild(autoWrap);
    bar.appendChild(count);
    host.appendChild(bar);

    var dirInput = document.createElement("input");
    dirInput.type = "file";
    dirInput.multiple = true;
    dirInput.setAttribute("webkitdirectory", "");
    dirInput.setAttribute("data-logdir", "");
    dirInput.hidden = true;

    var pickInput = document.createElement("input");
    pickInput.type = "file";
    pickInput.multiple = true;
    pickInput.setAttribute("data-logpick", "");
    pickInput.hidden = true;

    host.appendChild(dirInput);
    host.appendChild(pickInput);

    var out = el("div", "tk-logsrc__out");
    host.appendChild(out);

    function status() {
      return {
        connected: !!state.handle,
        lastSync: lastSyncLabel(),
        autoMerge: autoMergeOn(),
      };
    }

    function emitStatus() {
      if (typeof opts.onStatus === "function") {
        try { opts.onStatus(status()); } catch (e) { /* 回调失败不影响同步 */ }
      }
    }

    function refresh() {
      var at = lastSyncLabel();
      dirBtn.textContent = state.handle
        ? (at ? (opts.compact ? "同步（" + at + "）" : "同步新增（上次 " + at + "）")
              : "同步新增日志")
        : "选择 Logs 文件夹";
      forgetBtn.hidden = !(state.handle || at);
      emitStatus();
    }

    /* 把 File[] 交给解析器 */
    function runFiles(list, o) {
      var files = Array.prototype.slice.call(list || []);
      if (!files.length) return;
      o = o || {};
      count.textContent = "已选 " + files.length + " 个文件";
      loadSyntax(function (ok) {
        if (!ok || !window.TarkovLogSync) {
          notify("解析模块没有载入成功（可能是网络中断）—— 刷新一次再试。", false);
          return;
        }
        window.TarkovLogSync.run(files, out, {
          /* 自动同步：无新增时只说一句「已是最新」，不铺开整段解释。 */
          quiet: !!o.auto,
          /* 只有「自动触发」时才谈自动并入 —— 手动点按钮时读者在等预览，
             替他写账本是越权。 */
          autoMerge: !!o.auto && autoMergeOn(),
          onMerged: function (at) {
            count.textContent = at ? "上次同步 " + at : "";
            refresh();
          },
        });
      });
    }

    /* 点击「同步新增」：requestPermission 必须**直接**在点击回调里调用
       （用户手势）—— 先 await queryPermission 再 request，部分浏览器会把
       手势丢掉。 */
    function useHandle() {
      state.busy = true;
      return state.handle.requestPermission({ mode: "read" }).then(function (p) {
        if (p !== "granted") throw new Error("denied");
        return collectDir(state.handle);
      }).then(function (files) {
        state.busy = false;
        runFiles(files, {});
      }).catch(function (e) {
        state.busy = false;
        if (e && e.name === "AbortError") return;
        notify("读取 Logs 目录失败：" + (e && e.message ? e.message : e)
          + "。可以改用「或选日志文件」。", false);
      });
    }

    /* 自动同步：条件触发，不是魔法 —— 见文件头第三条硬约束。 */
    function autoSyncOnce() {
      if (state.autoTried || !state.handle || !state.handle.queryPermission) return;
      state.autoTried = true;
      state.handle.queryPermission({ mode: "read" }).then(function (p) {
        if (p !== "granted") {
          dirBtn.title = "浏览器没有长期保留授权 —— 点一次即可同步"
            + "（下次选目录时选「每次访问都允许」就能自动同步）";
          return;
        }
        count.textContent = "正在自动同步…";
        return collectDir(state.handle).then(function (files) {
          runFiles(files, { auto: true });
        });
      }).catch(function () { /* 自动同步失败不该弹错：按钮还在，读者可以手动点 */ });
    }

    dirInput.addEventListener("change", function () {
      runFiles(dirInput.files, {});
      dirInput.value = "";
    });
    pickInput.addEventListener("change", function () {
      runFiles(pickInput.files, {});
      pickInput.value = "";
    });

    dirBtn.addEventListener("click", function () {
      if (state.handle) { useHandle(); return; }
      if (!window.showDirectoryPicker) { dirInput.click(); return; }
      window.showDirectoryPicker({ mode: "read" }).then(function (h) {
        state.handle = h;
        idbSet(IDB_KEY, h).catch(function () { /* 存不下不影响本次 */ });
        refresh();
        return collectDir(h);
      }).then(function (files) {
        runFiles(files, {});
      }).catch(function (e) {
        if (e && e.name === "AbortError") return;   // 用户取消：不报错
        notify("打开目录失败：" + (e && e.message ? e.message : e)
          + "。浏览器不支持时请用「或选日志文件」。", false);
      });
    });

    fileBtn.addEventListener("click", function () { pickInput.click(); });

    forgetBtn.addEventListener("click", function () {
      idbDel(IDB_KEY).catch(function () {});
      drop(WM_KEY);
      /* 累积的地图场次也一并清掉 —— 不然断开后换一个目录，还会看到
         上一份日志的统计，读者会以为新目录里有那些场次。 */
      if (window.TarkovLogSync && window.TarkovLogSync.clearRaids) {
        try { window.TarkovLogSync.clearRaids(); } catch (e) { /* 忽略 */ }
      }
      state.handle = null;
      state.autoTried = false;
      out.textContent = "";
      refresh();
      notify("已断开 Logs 目录连接，并清除同步记录与地图场次统计。", true);
    });

    /* 初始化：读回句柄（不弹权限框），权限已持久则直接同步一次。 */
    if (window.indexedDB) {
      idbGet(IDB_KEY).then(function (h) {
        state.handle = h || null;
        refresh();
        autoSyncOnce();
      }).catch(function () { refresh(); });
    } else {
      refresh();
    }

    return {
      refresh: refresh,
      syncNow: function () { if (state.handle) useHandle(); },
      forget: function () { forgetBtn.click(); },
      hasHandle: function () { return !!state.handle; },
      status: status,
    };
  }

  window.TarkovLogSource = {
    mount: mount,
    status: function () {
      return {
        connected: !!state.handle,
        lastSync: lastSyncLabel(),
        autoMerge: autoMergeOn(),
      };
    },
    collectDir: collectDir,
    /* 给测试用：不必真的弹目录选择器也能走完整链路 */
    _state: state,
  };
})();
