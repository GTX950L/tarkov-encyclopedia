/* ==========================================================================
   导航后回到页面顶部（兜底）
   --------------------------------------------------------------------------
   背景：站点启用了 Material 的 navigation.instant（XHR 换页，不整页刷新）。
   它的滚动复位是间歇性的——同一站点、同样操作，实测有时归零、有时保留
   上一页的滚动位置（读者从长页面点左侧导航，会停在半中间）。

   本脚本共五层兜底。
   ========================================================================== */
(function () {
  "use strict";

  /* 防重复初始化 ----------------------------------------------------------
     instant 切换完成后 Material 会**重放新页面的脚本**（含本文件）——
     不做防重的话，每次换页都会多挂一份监听器与订阅，越积越多。
     监听器挂在 window / document 上，跨切换存续，所以只需装一次。 */
  if (window.__tkScrollFixReady) return;
  window.__tkScrollFixReady = true;

  var guardUntil = 0;   // 「点击导航 → 切换完成 + 缓冲」窗口的截止时刻（ms）

  /* ---------- 第四层：navigate 窗口期的 history.state 消毒 ------------------
     根因（2026-09-30 实测）：Material 沿两个链条写/读 history.state.y ——
       写：滚动位置变化 → 节流后 history.replaceState(offset)；
       读：切换完成 → scrollTo(0, history.state?.y ?? 0)。
     「点击链接 → 新内容到达」之间若发生任何滚动（慢网下等待期的滚动、
     点击时滚动惯性未消、平滑滚动动画余量），脏值 y 会落进**新页面的
     entry**；切换完成后被 revert 读走 —— 表现为「点完了仍停在半中间」，
     且因竞速而间歇。

     修法 a（本函数）：窗口期内每一帧把当前 entry 的 y 清 0。不清位置、
     只清状态 —— replaceState 不动滚动，读者在等待期仍可正常浏览旧页。
     修法 b（第五层）：对 revert 本身的调用做拦截，见下。 */
  function sanitize() {
    if (Date.now() > guardUntil) return;
    try {
      var s = history.state;
      if (s && typeof s === "object" && (s.y || s.x)) {
        var c = Object.assign({}, s);
        c.y = 0;
        c.x = 0;
        history.replaceState(c, "");
      }
    } catch (e) { /* 序列化/权限异常：跳过这一帧 */ }
    requestAnimationFrame(sanitize);
  }

  /* ---------- 第五层：revert 调用拦截 --------------------------------------
     实测发现「脏值写入」与「revert 读取」经常同帧发生（切换完成的瞬间
     连写带读），rAF 消毒插不进去 —— 于是直接兜住最后一步：
     revert 的调用形态是**两参数**的 `scrollTo(0, y)`（y 从 state 读出），
     这是全站唯一会这么调用 scrollTo 的地方（Material 的锚点/标签逻辑、
     本脚本自己都用对象形式 `{top: …}`，全站 grep 无其他两参数调用者）。

     判定条件（同时满足才改写）：导航窗口内 + 两参数 + x≈0 + y 非 0。
     不校验「y 是否等于 state.y」：消毒（第四层）可能刚好把 state 清成 0，
     此时 revert 手里仍拿着清之前读出的旧值 —— 那种「已经对不上」的调用
     恰恰是必须拦截的样本。
     命中则把目标位置改写为 0：切换完成后的「恢复」一律落回顶部。
     （历史导航不经过这里：popstate 会先把窗口关掉。） */
  var origScrollTo = window.scrollTo;
  window.scrollTo = function (a, b) {
    if (
      Date.now() < guardUntil &&
      typeof a === "number" && typeof b === "number" &&
      Math.abs(a) < 1 && Math.abs(b) > 0
    ) {
      b = 0;
    }
    return origScrollTo.apply(this, arguments.length >= 2 ? [a, b] : arguments);
  };

  /* ---------- 第一层：切换完成后复位（内容就绪后的兜底）--------------------
     document$ 是 Material 提供的 observable，首次加载与每次 instant 切换后
     都会触发。两条克制：
       · 带锚点的跳转（#xxx）不处理 —— 那是读者主动要求跳到某处；
       · **历史导航（后退/前进）不处理** —— 浏览器与主题的协同会在
         popstate 后把位置恢复到离开时的地方，这是设计行为，踩一脚会破坏它
         （2026-09-30 基线实测：后退恢复 ≈1032px，本层跳过语义不变）。 */
  document$.subscribe(function () {
    if (window.__tkFromPop) {              // 历史导航：不干预，窗口全关
      guardUntil = 0;
      return;
    }
    /* 切换完成不立刻关窗 —— revert 实测比 document$ 再晚约 100ms 跑，
       窗口延续 1.5 秒把它（以及可能的第二次恢复）覆盖在内。 */
    guardUntil = Math.max(guardUntil, Date.now() + 1500);
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      /* 顺手把新 entry 的 y 清 0：此时当前 entry 就是读者刚点进来的这一页，
         y 本就应该是 0；也让「下一次 revert 迟到时」读到干净值。 */
      try {
        var s = history.state;
        if (s && typeof s === "object" && (s.y || s.x)) {
          var c = Object.assign({}, s);
          c.y = 0;
          c.x = 0;
          history.replaceState(c, "");
        }
      } catch (e) { /* 忽略 */ }
    }
  });

  /* ---------- 第二层：关掉浏览器的自动滚动恢复 ------------------------------
     history.scrollRestoration 默认是 "auto"：它会在我们复位**之后**把上一页
     的滚动位置还回来——于是读者点完左侧导航，仍然停在半中间。实测（整页
     加载长条目 → 滚到 2500px → 点侧栏）：开着 auto 时 scrollY 原样保留
     2500，稳定复现；改成 manual 后才真正归零。 */
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  /* ---------- 第三层：点击导航链接的**那一刻**就先复位 + 开窗 ---------------
     只靠第一层复位有一个体感问题：它要等新页面的内容（XHR）就绪才触发，
     弱网下会明显滞后——实测同一操作有时 80ms 归零、有时要等 500–1000ms。
     所以这里在点下去的瞬间先复位一次，同时打开导航窗口（第四/五层），
     内容到达后再由第一层兜第二次。

     两条放行规则：
       1. 带锚点的链接（#xxx）不处理——那是读者主动要求跳到某处；
       2. **站外**链接不处理——不是站内换页。
     ⚠️ 第 2 条不能用「href 以 http 开头」来判断：Material 构建后，站内导航
     链接的 href 是**绝对 URL**（https://…/entries/bosses/），那一刀会**把
     所有站内链接都误判成外链**（本站踩过）。必须用 origin 比对。
     另三类也不动：非左键（中键/右键）、组合键（新窗口语义）、新窗口打开。 */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href) return;
    var url;
    try {
      url = new URL(a.href, location.href);
    } catch (err) {
      return;
    }
    if (url.origin !== location.origin) return;   // 站外：不管
    if (url.hash) return;                          // 带锚点：读者自己要跳到某处
    if (a.target && a.target !== "_self") return; // 新窗口打开：不动当前页
    if (e.button !== undefined && e.button !== 0) return;                  // 非左键
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;          // 组合键
    window.__tkFromPop = false;                   // 这是一次「点击导航」
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    guardUntil = Date.now() + 6000;               // 导航窗口：至多 6 秒
    sanitize();
  }, true);

  /* ---------- 历史导航标记 -------------------------------------------------
     popstate（后退/前进）时点一个标记：第一层复位跳过、窗口关闭、revert
     拦截失效（恢复原样）。标记持续到下一次「点击导航」为止。 */
  window.addEventListener("popstate", function () {
    guardUntil = 0;
    window.__tkFromPop = true;
  });
})();
