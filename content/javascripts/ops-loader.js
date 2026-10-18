/* 作战台脚本的按需加载器（2026-10-18）
   --------------------------------------------------------------------------
   ops-board.js 约 48 KB（gzip 16 KB），只有 /ops/ 一个页面需要。
   它此前挂在 extra_javascript 里 —— 等于让其余 166 页都为它付一次下载。
   本加载器只有几百字节：**检测到 `#tk-ops` 挂载点才注入 ops-board.js**。

   为什么不写在 ops/index.md 里用内联 <script> 注入（第一版就是这么写的，已废弃）：
   Material 把 extra_javascript 放在 </body> 之前，而页面正文里的内联脚本先执行 ——
   那一刻 DOM 里只有主题的 bundle（`assets/javascripts/...`），没有任何一份站内
   `javascripts/*.js` 可供反推地址，加载器只能静默退出（实测：左栏/右栏全空）。
   放进 extra_javascript 就与 map-loader.js 完全同构，也才能订阅 `document$`。

   instant 换页（navigation.instant）不会重跑 extra_javascript，
   所以订阅 `document$`，每次换页后再检查一次；data-tk-ops-boot 保证只注入一次。 */
(function () {
  var me = document.currentScript ||
    document.querySelector('script[src*="ops-loader.js"]');
  var src = me ? me.src : "";

  function boot() {
    if (!document.getElementById("tk-ops")) return;
    if (document.querySelector("script[data-tk-ops-boot]")) return;
    if (!src) return;

    var s = document.createElement("script");
    s.src = src.replace(/ops-loader\.js(?:\?.*)?$/, "ops-board.js");
    s.async = false;
    s.setAttribute("data-tk-ops-boot", "1");
    s.onerror = function () {
      var host = document.getElementById("tk-ops");
      if (host) {
        host.textContent =
          "作战台脚本没能加载出来（可能是网络问题）。本页下方的文字说明不受影响。";
      }
    };
    document.head.appendChild(s);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(boot);
  } else {
    document.addEventListener("DOMContentLoaded", boot);
  }
  boot();
})();
