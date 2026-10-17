/* 交互地图脚本的按需加载器（2026-10-17）
   --------------------------------------------------------------------------
   map.js 约 93 KB（gzip 32 KB），只有带 `#tk-map` 挂载点的地图页需要。
   它此前挂在 extra_javascript 里 —— 等于让全部 166 页都为它付一次下载。
   本加载器只有几百字节：**检测到挂载点才注入 map.js**。

   instant 换页（navigation.instant）不会重跑 extra_javascript，
   所以这里订阅 `document$`，每次换页后再检查一次；`data-tk-map-boot`
   保证同一文档里只注入一次。

   注入失败的兜底与 map.js 自身一致：给一句明确的话，不让「加载中…」一直挂着。 */
(function () {
  var me = document.currentScript ||
    document.querySelector('script[src*="map-loader.js"]');
  var src = me ? me.src : "";

  function boot() {
    if (!document.getElementById("tk-map")) return;
    if (document.querySelector("script[data-tk-map-boot]")) return;
    if (!src) return;

    var s = document.createElement("script");
    s.src = src.replace(/map-loader\.js(?:\?.*)?$/, "map.js");
    s.async = false;
    s.setAttribute("data-tk-map-boot", "1");
    s.onerror = function () {
      var host = document.getElementById("tk-map");
      if (host) {
        host.textContent =
          "地图脚本没能加载出来（可能是网络问题）。本页下方的文字说明不受影响。";
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
