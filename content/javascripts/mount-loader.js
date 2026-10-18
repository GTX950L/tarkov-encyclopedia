/* 挂载点脚本的按需加载器（2026-10-18，2026-10-19 从 ops-loader.js 改名）
   --------------------------------------------------------------------------
   有两个页内脚本只服务一个页面，却都不该进 extra_javascript：

     · ops-board.js   48 KB（gzip 16 KB）—— 只有 /ops/ 需要
     · home-ops.js    12 KB（gzip 3.5 KB）—— 只有首页需要

   挂在 extra_javascript 里 = 其余 166 页每页为它们各付一次下载
   （2026-10-18 实测：每页 JS 294 → 246 KB）。本加载器不到 1 KB：
   **看到挂载点才注入对应脚本**，其余页面一个字节都不付。

   为什么不写在页面正文里用内联 <script> 注入（第一版就是这么写的，已废弃）：
   Material 把 extra_javascript 放在 </body> 之前，而正文里的内联脚本先执行 ——
   那一刻 DOM 里只有主题的 bundle（`assets/javascripts/...`），没有任何一份站内
   `javascripts/*.js` 可供反推地址，加载器只能静默退出（实测：左栏/右栏全空）。
   放进 extra_javascript 就与 map-loader.js 完全同构，也才能订阅 `document$`。

   instant 换页（navigation.instant）不会重跑 extra_javascript，
   所以订阅 `document$`，每次换页后再检查一次；注入过的脚本自带 data-tk-boot 标记，
   不会重复注入 —— 这一条对首页尤其关键：从别的页点「首页」是 instant 换页，
   <script> 标签根本不会执行。 */
(function () {
  /* [挂载点 id, 页内脚本, 专属样式表(可选)]
     tk-ops.css 31 KB（gzip ≈9 KB）是 /ops/ 专用的版面规则，2026-10-19 从
     extra.css 拆出来 —— 它以前是 167 页每页都付一次渲染阻塞的下载。 */
  var MOUNTS = [
    ["tk-ops", "ops-board.js", "tk-ops.css"],
    ["tk-home-ops", "home-ops.js"]
  ];

  var me = document.currentScript ||
    document.querySelector('script[src*="mount-loader.js"]');
  var src = me ? me.src : "";

  function boot() {
    if (!src) return;
    for (var i = 0; i < MOUNTS.length; i++) {
      var id = MOUNTS[i][0];
      var file = MOUNTS[i][1];
      var css = MOUNTS[i][2];
      if (!document.getElementById(id)) continue;
      if (document.querySelector('script[data-tk-boot="' + file + '"]')) continue;

      if (css && !document.querySelector('link[data-tk-css="' + css + '"]')) {
        var l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = src.replace(/javascripts\/mount-loader\.js(?:\?.*)?$/, "stylesheets/" + css);
        l.setAttribute("data-tk-css", css);
        document.head.appendChild(l);
      }

      var s = document.createElement("script");
      s.src = src.replace(/mount-loader\.js(?:\?.*)?$/, file);
      s.async = false;
      s.setAttribute("data-tk-boot", file);
      s.onerror = (function (host, name) {
        return function () {
          var el = document.getElementById(host);
          if (!el) return;
          var p = document.createElement("p");
          p.className = "tk-hint";
          p.textContent = name + "的脚本没能加载出来（可能是网络问题），页面其余部分不受影响。";
          el.appendChild(p);
        };
      })(id, file === "ops-board.js" ? "作战台" : "任务清单");
      document.head.appendChild(s);
    }
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(boot);
  } else {
    document.addEventListener("DOMContentLoaded", boot);
  }
  boot();
})();
