/* ==========================================================================
   篇章面包屑（打开页面就知道"我在哪一篇"）
   --------------------------------------------------------------------------
   为什么需要：本站的核心组织方式是「八篇 + 任务图鉴」，首页还专门用整屏解释
   "为什么这样排"；但读者一旦是**从搜索或外链直接落到**某一篇（在"搜索优先"
   的策略下这是常态），那套结构就完全不可见 —— 页面顶部只有站名，右侧目录只
   显示当前页的 `##` 小节，**不显示所属篇章**。（第四十七批实测：全站
   `[class*=breadcrumb]` 命中数为 0。）

   为什么用脚本而不是往 114 个页面里各写一行：
   面包屑的内容**就是导航树本身**。写在正文里等于给 nav 造一份手写副本 ——
   以后加一篇、改一篇名，就得再同步一百多处，而这类"手写副本"正是本站吃过
   亏的地方。这里改成**从导航 DOM 反向推导**：读者看到的那棵树是什么样，
   面包屑就是什么样，**零维护**。

   实现：拿当前页在侧栏里的 `.md-nav__link--active`，逐级向上找 `li.md-nav__item`，
   收集每级的标题（分组是 `label`，叶子是 `a`），拼成一条链。

   两条克制：
     · **只在有层级时才渲染** —— 首页、以及任何没有祖先的页面直接跳过；
     · **不改动正文节点** —— 插在 `.md-content__inner` 的最前面，并由
       glossary-tooltip.js 明确排除（见那边对 `.tk-crumb` 的判断），
       免得术语气泡跑到面包屑里去。
   ========================================================================== */

(function () {
  "use strict";

  var CLS = "tk-crumb";

  function norm(pathname) {
    return String(pathname || "")
      .replace(/index\.html$/, "")
      .replace(/\/+$/, "");
  }

  /* 当前页在导航里的那一个链接。
     目录（TOC）里的链接是 `#锚点`，必须排除；两个 active 链接（移动抽屉 /
     桌面侧栏）取任一个的祖先链都一样。 */
  function findActive() {
    var here = norm(location.pathname);
    var cands = document.querySelectorAll(".md-nav__link--active");
    var fallback = null;
    for (var i = 0; i < cands.length; i++) {
      var a = cands[i];
      if (a.tagName !== "A") continue;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("#") > -1) continue;
      var p;
      try {
        p = norm(new URL(a.href, location.href).pathname);
      } catch (e) {
        continue;
      }
      if (p === here) return a;
      if (!fallback) fallback = a;
    }
    return fallback;
  }

  /* 一级 li 的标题与链接（只看直属子节点，避免抓到嵌套的子项）
     ----------------------------------------------------------------------
     ⚠️ **三种形态都要认，顺序不能省**（第四十七批实测，Zensical 0.0.64）：

       ① `li > a.md-nav__link`            叶子项（指向某一篇）
       ② `li > label.md-nav__link`        分组标题（该组没有独立页面时）
       ③ `li > .md-nav__container > a.md-nav__link`
                                          **带 `navigation.sections` 时，有独立页面
                                          的分组会被套进一个容器 div**，标题变成
                                          `div.md-nav__container > a` —— 它不是 li 的
                                          直属子节点。只看 ①② 时这一级取不到，
                                          链条退化成 1 级，面包屑被下面的
                                          `items.length < 2` 静默跳过（本轮就是这么
                                          发现"脚本写了但页面上什么都没有"的）。

     注意：容器里的那个 `label` **没有文字**（只有图标），所以 ③ 必须取 `a` 而不是
     任一 `label`；取错会得到一个空标题的层级。
  */
  function levelOf(li) {
    var el = li.querySelector(
      ":scope > a.md-nav__link, :scope > label.md-nav__link, " +
      ":scope > .md-nav__container > a.md-nav__link"
    );
    if (!el) return null;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    var href = el.tagName === "A" ? el.getAttribute("href") : null;
    // 目录里的锚点不算层级
    if (href && href.indexOf("#") > -1) href = null;
    return { text: text, href: href };
  }

  function chain(active) {
    var out = [];
    var li = active.closest("li.md-nav__item");
    var guard = 0;
    while (li && guard++ < 12) {
      var lv = levelOf(li);
      if (lv) out.unshift(lv);
      var parentNav = li.parentElement;
      li = parentNav ? parentNav.closest("li.md-nav__item") : null;
    }
    return out;
  }

  function rootHref() {
    var logo = document.querySelector(".md-header__button.md-logo, a.md-logo, .md-header__title a");
    return logo && logo.href ? logo.href : location.origin + "/";
  }

  function render() {
    var old = document.querySelector("." + CLS);
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var inner = document.querySelector(".md-content__inner");
    if (!inner) return;

    var active = findActive();
    if (!active) return;

    var items = chain(active);
    if (items.length < 2) return;      // 首页 / 顶层页：没有层级可讲

    var nav = document.createElement("nav");
    nav.className = CLS;
    nav.setAttribute("aria-label", "所在位置");

    var home = document.createElement("a");
    home.href = rootHref();
    home.textContent = "首页";
    nav.appendChild(home);

    for (var i = 0; i < items.length; i++) {
      var sep = document.createElement("span");
      sep.className = CLS + "__sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      nav.appendChild(sep);

      var it = items[i];
      var last = i === items.length - 1;
      var node;
      if (it.href && !last) {
        node = document.createElement("a");
        node.href = it.href;
      } else {
        node = document.createElement("span");
        if (last) node.className = CLS + "__here";
      }
      node.textContent = it.text;
      nav.appendChild(node);
    }

    inner.insertBefore(nav, inner.firstChild);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(render);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
