/* ==========================================================================
   搜索索引未就绪时的兜底提示 + 搜索框提示语本地化
   --------------------------------------------------------------------------
   背景（第四十七批交互层审查实测）：
   Zensical 的全文搜索把 UI 建在 **Shadow DOM** 里，而那个 Shadow DOM 的
   输入框**只有在 `search.json`（本站 2.0 MB）下载并解析完成之后才被插入**。
   在它插入之前：

     · 点右上角「查找」——没有任何反应；
     · 按按钮上印着的 Ctrl+K——同样没有反应；
     · 页面上找不到任何搜索输入框。

   也就是说，索引没就绪的那段时间里，**搜索入口看起来就是坏的**，而且没有任何
   提示。审查时我本人因此连续误判两次以上。真人读者不会有耐心再点第三次。

   这个脚本不试图"催快"索引（那是构建层的事），只做两件能立刻消除误解的事：

     1. 索引未就绪时，读者点搜索按钮 / 按搜索快捷键 → 显示一条明确的提示，
        告诉他"索引正在载入、稍等几秒"，而不是让他以为站点坏了；
     2. 索引就绪后，把 Shadow DOM 里输入框的 placeholder 由英文 "Search"
        改成中文「搜索」——同一控件的 aria-label 已经是「查找」，两个名字要一致。

   三条克制（避免帮倒忙）：
     · **不拦截任何事件**——不 preventDefault、不 stopPropagation。搜索一旦能
       工作，本脚本必须完全透明（所以"就绪"之后一律直接返回）；
     · **不轮询整页**——先查 body 的直接子元素，再退到全量扫描，找到就停；
     ·**优雅降级**——拿不到 Shadow DOM（浏览器不支持 / 主题换实现）时静默返回，
       不报错、不显示提示。
   ========================================================================== */

(function () {
  "use strict";

  var POLL_INTERVAL = 400;     // 索引就绪的探测间隔
  var POLL_MAX = 150;          // 最多探 60 秒，够了就停（省电、省 CPU）
  var HINT_COOLDOWN = 6000;    // 两次提示之间的最短间隔，防连点刷屏
  var HINT_HIDE_AFTER = 5000;  // 提示自动消失时间

  var ready = false;           // 面板已出现（可点可输入）
  var patched = false;         // placeholder 已本地化
  var tries = 0;
  var lastHint = 0;
  var indexSizeMB = "2.5";     // 供失败提示引用，实测值由 fetch 时校正
  var FAIL_AFTER_MS = 45000;   // 45 秒还没好就改口说「没能载入」
  var hintEl = null;
  var hideTimer = 0;

  /* --------------------------------------------------------------------------
     找搜索输入框所在的 Shadow DOM
     -------------------------------------------------------------------------- */

  function rootOf(el) {
    try {
      return el.shadowRoot;
    } catch (e) {
      return null;            // closed shadow root：拿不到，属正常情况
    }
  }

  function hasInput(sr) {
    return !!(sr && sr.querySelector('input[role="combobox"], input[type="text"]'));
  }

  /* 先查 body 的直接子元素 —— 搜索组件挂在这一层，代价最小。
     找不到再退到全量扫描：只读属性、不触发布局，单次几毫秒。 */
  function findSearchRoot() {
    var i, sr;
    var kids = document.body ? document.body.children : [];
    for (i = 0; i < kids.length; i++) {
      sr = rootOf(kids[i]);
      if (hasInput(sr)) return sr;
    }
    var all = document.querySelectorAll("body > * > *");
    for (i = 0; i < all.length; i++) {
      sr = rootOf(all[i]);
      if (hasInput(sr)) return sr;
    }
    var deep = document.querySelectorAll("div, section, aside, header");
    for (i = 0; i < deep.length; i++) {
      sr = rootOf(deep[i]);
      if (hasInput(sr)) return sr;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     提示条
     -------------------------------------------------------------------------- */

  function ensureHint() {
    if (hintEl && document.body.contains(hintEl)) return hintEl;
    hintEl = document.createElement("div");
    hintEl.className = "tk-searchwait";
    hintEl.setAttribute("role", "status");
    hintEl.setAttribute("aria-live", "polite");
    hintEl.hidden = true;
    document.body.appendChild(hintEl);
    return hintEl;
  }

  /* --------------------------------------------------------------------------     状态：不知道 / 就绪 / 下载中 / 已失败
     登记这个不是为了好看 —— **「全文索引正在载入」这句话本身是个问题**（见下）
     -------------------------------------------------------------------------- */
  var STATE_UNKNOWN = 0, STATE_READY = 1, STATE_LOADING = 2, STATE_FAILED = 3;
  var state = STATE_UNKNOWN;

  var hintEl = null;
  var hideTimer = 0;

  /* 面板已出现但索引仍在下载 —— 这才是「正在载入」该出现的时机。
     ⚠️ 2026-10-07 修正：**旧版把「就绪」判成「Shadow DOM 里有 input」**，
        而 input 是**搜索面板里的输入框**，它要等索引就绪才被插进去；
        于是「面板已开、索引还在下」这段时间里旧版判成未就绪 → 误报「正在载入」。
        实测本地：面板弹出的瞬间输入框就在，索引 2808 条早已就绪，
        所以旧版在本不该报的时候也会报。

     ⚠️ **宿主不一定是 `.md-search`**（2026-10-07 实测）：面板挂在一个
     **没有 class 的 `div`** 上（body 下第 12 个子节点），
     `.md-search` 自己全程只有一个 `button` 子节点。
     任何写成 `document.querySelector('.md-search').shadowRoot` 的探测都会永远失败。
     所以 findSearchRoot() 必须扫 body 的所有子元素，不能假定宿主是谁。 */
  function hasPanel(sr) {
    return !!(sr && sr.querySelector('input'));
  }

  function showHint() {
    if (state === STATE_READY) return;
    var el = ensureHint();
    var now = Date.now();
    /* 冷却只为防「连点刷屏」，**不是**为了压住已经消失的提示——
       提示 5 秒后自动收起，读者再按一次 Ctrl+K 却什么都没发生，
       就又回到「站点的搜索是坏的」这个原始观感（第四十七批实测踩到）。
       所以只在提示**当时还挂着**的时候限流。 */
    if (!el.hidden && now - lastHint < HINT_COOLDOWN) return;
    lastHint = now;
    el.textContent = state === STATE_FAILED
      ? "全文索引没能载入（" + indexSizeMB + " MB）。请刷新页面再试一次；"
        + "若仍不行，直接用左侧导航或站内搜索框按关键词找。"
      : "全文索引正在载入，请稍等几秒再点——期间可用左侧导航浏览全部条目。";
    el.classList.toggle("tk-searchwait--fail", state === STATE_FAILED);
    el.hidden = false;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { el.hidden = true; }, HINT_HIDE_AFTER);
  }

  /* --------------------------------------------------------------------------
     就绪探测 + placeholder 本地化
     -------------------------------------------------------------------------- */

  function patch(sr) {
    var inp = sr.querySelector('input[role="combobox"], input[type="text"]');
    if (!inp) return;
    if (!patched && inp.placeholder && inp.placeholder !== "搜索") {
      inp.placeholder = "搜索";
      patched = true;
    }
  }

  /* --------------------------------------------------------------------------
     索引探测：**主动问一次 search.json，而不是猜主题的内部标记**
     -------------------------------------------------------------------------- */
  var indexChecked = false;

  function probeIndex() {
    if (indexChecked) return;
    indexChecked = true;
    /* 主题自己已经在 fetch 这个文件了，这里**只读缓存**，
       同一份响应被两个消费者复用，浏览器会自动去重（同一个 URL 的并发
       fetch 共享一个网络请求）。所以多这一次探测**不产生额外流量**。
       ⚠️ 但它会**等主题先取完**才 resolve（response.text() 只能读一次），
       所以这里不用 await —— 只挂一个 onload 去记账。 */
    try {
      fetch("search.json", { cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) { window.__tkSearchIndexSettled = false; return; }
          /* content-length 只在未压缩时给；取不到就用默认文案里的数字。
             实测产物 2.54 MB / gzip 后约 0.4 MB。 */
          var cl = r.headers.get("content-length");
          if (cl) indexSizeMB = (parseInt(cl, 10) / 1048576).toFixed(1);
          window.__tkSearchIndexSettled = true;
        })
        .catch(function () { window.__tkSearchIndexSettled = false; });
    } catch (e) { /* fetch 不可用：保持未知，交给面板判据 */ }
  }

  function tick() {
    if (ready) return;
    var sr = findSearchRoot();
    if (sr && hasPanel(sr)) {
      ready = true;
      state = STATE_READY;
      patch(sr);
      if (hintEl) hintEl.hidden = true;
      return;
    }
    tries++;
    var elapsed = tries * POLL_INTERVAL;
    /* 超时就不再说「正在载入」—— 那是**谎报**：读者已经等了 45 秒，
       再等下去也不会好。不��告诉「没能载入、请刷新」，读者才知道要做什么。
       （旧版会一直说「正在载入」直到 60 秒上限，然后默默停止，
         留下一个「站点坏了」的观感—— 第四十七批那轮的原始问题。） */
    if (elapsed > FAIL_AFTER_MS && state !== STATE_FAILED) state = STATE_FAILED;
    if (tries < POLL_MAX) setTimeout(tick, POLL_INTERVAL);
  }

  function start() {
    // 每次 instant 换页后重新起步：面板可能已被主题重建
    ready = false;
    patched = false;
    tries = 0;
    indexChecked = false;
    window.__tkSearchIndexSettled = undefined;
    state = STATE_LOADING;
    probeIndex();
    setTimeout(tick, POLL_INTERVAL);
  }

  /* --------------------------------------------------------------------------
     事件：只在"未就绪"时提示，且绝不拦截
     -------------------------------------------------------------------------- */

  document.addEventListener("click", function (e) {
    if (ready) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".md-search, [class*=md-search]")) showHint();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (ready || e.altKey) return;
    var t = e.target;
    // 在输入框里敲字不算"按了搜索快捷键"
    if (t && t.closest && t.closest("input, textarea, [contenteditable='true']")) return;

    var k = e.key;
    var ctrlK = (k === "k" || k === "K") && (e.ctrlKey || e.metaKey);
    var bare = (k === "/" || k === "f" || k === "s") && !e.ctrlKey && !e.metaKey;
    if (ctrlK || bare) showHint();
  }, true);

  /* 与项目其他脚本一致：Material 的 document$ 在首次加载与每次 instant 切换后触发 */
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(start);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
