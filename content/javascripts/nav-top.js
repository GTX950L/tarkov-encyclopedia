/* ==========================================================================
   顶部导航（页头横向菜单）
   --------------------------------------------------------------------------
   要解决的问题：站内 130+ 个页面全靠**左侧抽屉**里的十篇结构导航，
   而页头除了站名、搜索、主题切换之外**什么也没有**——太空了。
   从搜索结果或外链直接落地的读者（本站的常态入口），页头给不出任何方向感。

   参照 [中文 Wiki](https://www.eftarkov.com/) 的做法：页头挂一组横向下拉，
   **下挂的条目直接从左侧导航树反推**，而不是再写一份清单。

   为什么必须反推（这是本脚本存在的前提）：
     站内已经因为「手写副本」吃过亏——面包屑那一轮就明确记过，
     写在正文里的导航等于给 nav 造一份副本，加一篇改一篇名就得同步一百多处。
     顶部导航是同一类东西：**菜单内容就是导航树本身**。
     所以这里只手写「哪几个分组归到页头」这一层映射（GROUPS），
     **条目本身全部从 `.md-nav` 的 DOM 读出来**——加一篇条目、删一篇、改个名，
     页头自动跟着变，一个字都不用动这里。

   两条边界：
     · **只重排，不重命名**。分组名（「任务」「地图」…）是页头这一层自己的
       措辞，条目名一律用导航树里的原文——**站内已经因为同一个概念两种叫法
       付过代价**，这里不能再造一套。
     · **进抽屉的路径一条不减**。页头是加法不是减法：左侧十篇结构原样保留，
       页头只提供「按主题横向切入」的另一条路。窄屏（<76.25em）页头整组隐藏，
       回到抽屉——**手机上顶栏塞七个下拉只会挤掉搜索框**，那才是真损失。

   交互与既有脚本对齐：
     · 挂在 `.md-header__inner`，插在 `.md-search` 之前（与 toolbox.js 同一簇）；
     · Material 的 instant 换页不整块替换页头，所以每次 subscribe 都重挂并先查重；
     · 悬停或点击均可展开，Esc 收起，点面板外收起，转屏收起。
   ========================================================================== */

(function () {
  "use strict";

  var CLS = "tk-topnav";
  var OPEN = "tk-topnav--open";

  /* 页头分组 → 导航树里的篇。
     键是导航树里**分组 label 的原文**，值是页头显示的短名。
     一篇可以映射到多个页头分组（战斗＝第五篇＋第六篇），反之亦可。

     `index` 只有**该篇在 mkdocs.yml 里自带一个独立首页**时才写（第九篇的
     `总览`、第十篇的 `项目欢迎页`）——这两页在导航树里是这一级的 <a>，
     不属于任何子项，不显式补一句就会从面板里消失。
     **名字照抄 nav 里的原文**（不写「任务图鉴总览」这种自造说法），
     否则同一个页面在侧栏叫「总览」、在页头叫「任务图鉴总览」，
     又是站内最烦的那类同一概念两种叫法。 */
  var GROUPS = [
    { nav: "第九篇 · 任务图鉴", label: "任务", index: "总览" },
    { nav: "第二篇 · 地图", label: "地图" },
    { nav: "第三篇 · 装备与枪械", label: "装备" },
    { nav: "第四篇 · 经济与成长", label: "成长" },
    { nav: "第五篇 · 进阶战斗机制", label: "战斗" },
    { nav: "第六篇 · 战局内行为手册", label: "战局" },
    { nav: "第七篇 · 赛季与衍生内容", label: "赛季" },
    { nav: "第八篇 · 世界与背景", label: "世界" },
    { nav: "第十篇 · 参考", label: "参考", index: "项目欢迎页" }
  ];

  /* 导航树里某一级的标题与链接。
     ⚠️ 三种形态都要认（形态说明见 breadcrumb.js 的 levelOf()，那里的注释更完整）：
       ① li > a.md-nav__link叶子（指向某一篇）
       ② li > label.md-nav__link            分组标题（该组没有独立页面）
       ③ li > .md-nav__container > a.md-nav__link
            带 navigation.sections 时，有独立页面的分组会被套进容器 div
     只看 ①② 时第③ 种取不到，这一级会整个消失。 */
  function levelOf(li) {
    var el = li.querySelector(
      ":scope > a.md-nav__link, :scope > label.md-nav__link, " +
      ":scope > .md-nav__container > a.md-nav__link"
    );
    if (!el) return null;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    var href = el.tagName === "A" ? el.getAttribute("href") : null;
    if (href && href.indexOf("#") > -1) href = null;
    return { text: text, href: href };
  }

  /* 某个 li 直属的子列表。
     ⚠️ **不能只写 `:scope > ul`**（2026-10-07 线上实测踩到）：
     Material 对**嵌套分组**（也就是全部十篇）会把子列表包在
     `<nav class="md-nav">` 里 —— li 的直接子节点是
     `INPUT.md-nav__toggle` + `LABEL.md-nav__link` + `NAV.md-nav`，
     **`<ul>` 是 NAV 的孙子**。只查 `:scope > ul` 会返回 null，
     于是 leavesOf() 交空数组、columnsOf() 交 null，
     九个分组全部被 `continue` 掉，页头一个菜单都不出现，
     **而且不报任何错**——最难查的那种失败。

     顶层那三项（首页 / 百科条目 / 查阅栏目）没有这层嵌套，
     走 `:scope > ul` 就够；两种形态都留着，按顺序匹配。 */
  function subListOf(li) {
    return li.querySelector(":scope > ul.md-nav__list, :scope > nav > ul.md-nav__list");
  }

  /* 某个分组下的叶子条目（不含更深层分组）。
     返回 [{text, href}]，href 是导航树里的原始相对路径。 */
  function leavesOf(li) {
    var out = [];
    var ul = subListOf(li);
    if (!ul) return out;
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].classList || !kids[i].classList.contains("md-nav__item")) continue;
      var lv = levelOf(kids[i]);
      /* 有子列表的 li 是子分组，它的标题是分组名不是条目——这里只收叶子。
         组内条目由 columnsOf() 单独处理，避免「组名」混进条目列表。 */
      if (!lv || subListOf(kids[i])) continue;
      if (!lv.href) continue;
      out.push({ text: lv.text, href: lv.href });
    }
    return out;
  }

  /* 某个分组下的子分组（[{label, items}]），用于多列面板。
     ⚠️ 地图篇的结构是「四个子分组 + 一条散落的『转场与 BTR』」
     （2026-10-07 实测）。两种处理都会出错：
       · 只按子组分列 → **转场与 BTR 凭空消失**；
       · 整组退回扁平 → 17 条拉成一屏长条，又回到「地图篇条目最多所以最难用」。
     所以这里返回**分组 + 其余散落叶子**两类，让调用方把散落的那些
     收进第一列（它们在导航树里本来就在最前面，位置语义也对）。
     一个子分组都没有时返回 null，调用方退回纯扁平。 */
  function columnsOf(li) {
    var ul = subListOf(li);
    if (!ul) return null;
    var cols = [];
    var loose = [];
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!k.classList || !k.classList.contains("md-nav__item")) continue;
      var lv = levelOf(k);
      if (!lv) continue;
      if (subListOf(k)) {
        var items = leavesOf(k);
        /* 空子分组（渲染了但一条都没有）直接跳过，不占位列——
           但不能让它让整个多列失效：它本来就没有内容可丢。*/
        if (items.length) cols.push({ label: lv.text, items: items });
      } else if (lv.href) {
        loose.push({ text: lv.text, href: lv.href });
      }
    }
    if (!cols.length) return null;
    if (loose.length) cols.unshift({ label: null, items: loose });
    return cols;
  }

  function siteRoot() {
    var s = document.querySelector('script[src*="nav-top.js"]');
    if (!s || !s.src) return "";
    return s.src.replace(/javascripts\/[^/]*$/, "");
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function buildPanel(group, li) {
    var panel = el("div", CLS + "__panel");
    panel.id = CLS + "-" + group.nav;
    panel.hidden = true;

    var cols = columnsOf(li);
    if (cols) {
      /* 分组自身带首页时（见下方「组自带入口页」注释），补在第一列最前。 */
      var ownLv = levelOf(li);
      var head = [];
      if (ownLv && ownLv.href && group.index) {
        head.push({ text: group.index, href: ownLv.href, lead: true });
      }
      for (var c = 0; c < cols.length; c++) {
        var col = el("div", CLS + "__col");
        /* label 为 null 的是「散落叶子」那一列——它们在导航树里没有组名，
           硬造一个组头反而不认识（读者会问「转场与 BTR 属于哪组」）。 */
        if (cols[c].label) col.appendChild(el("span", CLS + "__colhead", cols[c].label));
        var list = head.concat(cols[c].items);
        for (var j = 0; j < list.length; j++) col.appendChild(item(list[j], list[j].lead));
        head = [];
        panel.appendChild(col);
      }
    } else {
      var flat = leavesOf(li);
      /* 分组自身就是一篇页面时（mkdocs.yml 里 `第九篇 · 任务图鉴:` 带了
         `总览: quests/index.md`，于是在导航树里这一级的标题是 <a> 而不是
         <label>）—— **这一页是这一篇的入口，却不是任何子项**，
         所以 leavesOf() 拿不到它。不补这一条，「任务」面板里就没有
         「总览」—— **最该被点到的那一页反而少了**。
         显示名取 GROUPS[].index（照抄 nav 原文），不另造措辞。 */
      var own = levelOf(li);
      if (own && own.href && group.index) {
        flat.unshift({ text: group.index, href: own.href, lead: true });
      }

      var box = el("div", CLS + "__col");
      for (var k = 0; k < flat.length; k++) {
        box.appendChild(item(flat[k], flat[k].lead));
      }
      panel.appendChild(box);
    }
    return panel;
  }

  function item(it, isLead) {
    var a = el("a", CLS + "__link" + (isLead ? " " + CLS + "__link--lead" : ""), it.text);
    /* 导航树里的 href 是**相对当前页**写的（Zensical 每页按目录深度重新生成），
       而面板被插进页头——但 <a> 解析相对路径用的base 就是当前页 URL，
       与它在侧栏里时的 base 完全相同，所以原样赋值即可，不需要换算。 */
    a.href = it.href;
    /* 当前页标记：解析后的 pathname 与当前页一致就标上。
       判据必须用 pathname 而不是字符串相等——导航树里写的是
       `../entries/lighthouse.md`，与 location.pathname 永远不会字面相同。 */
    try {
      if (new URL(a.href, location.href).pathname === location.pathname) {
        a.setAttribute("aria-current", "page");
      }
    } catch (err) { /* URL 解析异常：留着没标记，链接本身不受影响 */ }
    return a;
  }

  /* ---------- 展开 / 收起 ---------- */

  var openHost = null;

  function closeAll() {
    if (!openHost) return;
    var p = openHost.querySelector("." + CLS + "__panel");
    var b = openHost.querySelector("." + CLS + "__btn");
    if (p) p.hidden = true;
    if (b) b.setAttribute("aria-expanded", "false");
    openHost.classList.remove(OPEN);
    openHost = null;
  }

  function open(host) {
    if (openHost && openHost !== host) closeAll();
    var p = host.querySelector("." + CLS + "__panel");
    var b = host.querySelector("." + CLS + "__btn");
    if (!p || !b) return;
    p.hidden = false;
    b.setAttribute("aria-expanded", "true");
    host.classList.add(OPEN);
    openHost = host;
  }

  var listenersInstalled = false;
  function installGlobalListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    document.addEventListener("click", function (e) {
      if (!openHost) return;
      if (e.target && openHost.contains(e.target)) return;
      closeAll();
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !openHost) return;
      var b = openHost.querySelector("." + CLS + "__btn");
      closeAll();
      if (b && typeof b.focus === "function") b.focus();
    });

    window.addEventListener("resize", closeAll);
  }

  /* ---------- 挂载 ---------- */

  function mount() {
    var inner = document.querySelector(".md-header__inner");
    if (!inner) return;
    var old = inner.querySelector("." + CLS);
    if (old) old.parentNode.removeChild(old);

    /* 窄屏不挂：手机上页头要留给 logo、搜索、主题切换。
       侧栏抽屉里的十篇结构导航本来就完整，这里不上就不损失什么。 */
    if (window.matchMedia && !window.matchMedia("(min-width: 76.25em)").matches) return;

    var navRoot = document.querySelector(".md-nav");
    if (!navRoot) return;

    /* 建索引：分组 label 原文 → 该组的 li。
       ⚠️ **必须扫全树的每一级，不能只看顶层**（2026-10-07 构建后实测修正）。
       顶层只有三项（首页 / 百科条目 / 查阅栏目），**十篇全在第二层**——
       「第一篇 · 入门机制」是挂在「百科条目」底下的子分组。
       只扫顶层的话 byLabel 会是空的，页头一个菜单都挂不出来（而且不报错）。

       重名取**层级最浅**的那一个：某个 label 在深层再出现一次时，
       浅层那份才是导航意义上的那一组。 */
    var byLabel = {};
    var allLis = navRoot.querySelectorAll("li.md-nav__item");
    for (var i = 0; i < allLis.length; i++) {
      var li = allLis[i];
      var lv = levelOf(li);
      if (!lv) continue;
      var depth = 0;
      for (var p = li.parentElement; p && p !== navRoot; p = p.parentElement) {
        if (p.tagName === "UL") depth++;
      }
      var prev = byLabel[lv.text];
      if (prev === undefined || depth < prev.depth) {
        byLabel[lv.text] = { li: li, depth: depth };
      }
    }

    var host = el("nav", CLS);
    host.setAttribute("aria-label", "顶部导航");

    var made = 0;
    for (var g = 0; g < GROUPS.length; g++) {
      var li = byLabel[GROUPS[g].nav] ? byLabel[GROUPS[g].nav].li : null;
      if (!li) continue;
      if (!leavesOf(li).length && !columnsOf(li)) continue;   /* 空组不占位 */

      var grp = el("div", CLS + "__group");

      var btn = el("button", CLS + "__btn");
      btn.type = "button";
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", CLS + "-" + g);
      btn.title = GROUPS[g].label + "（" + GROUPS[g].nav + "）";
      btn.appendChild(el("span", CLS + "__btntx", GROUPS[g].label));
      btn.appendChild(el("span", CLS + "__caret", "▾"));
      grp.appendChild(btn);

      var panel = buildPanel(GROUPS[g], li);
      panel.id = CLS + "-" + g;
      grp.appendChild(panel);

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var p = this.parentNode.querySelector("." + CLS + "__panel");
        if (p && !p.hidden) closeAll(); else open(this.parentNode);
      });

      /* 悬停展开。**必须靠 open() 的「先关掉别人」来保证只有一个面板开着**
         ——鼠标从左往右扫过九个按钮时，mouseenter 会连续触发九次，
         如果每个都无条件展开，就会像九扇门全开那样**九个面板同时挂出来**
         （2026-10-07 实测截图就是这个效果）。
         下面 open() 的第一句就是 `if (openHost && openHost !== host) closeAll()`，
         所以这里不需要额外判断。

         移出后延迟收起：留140ms 是给「斜着从按钮移到面板」这段路的——
         指针从按钮下缘走到面板上缘的那 20px 若立刻收起，
         面板会在指针到达之前就消失。 */
      grp.addEventListener("mouseenter", function () { open(this); });
      grp.addEventListener("mouseleave", function () {
        var self = this;
        window.setTimeout(function () {
          /* :hover 是关键：延迟期间指针可能已经移回本组（或移进本组面板），
             那就不该收。用 openHost === self 确认期间没被别的组抢走。 */
          if (openHost === self && !self.matches(":hover")) closeAll();
        }, 140);
      });

      /* 键盘：↓ 进面板，Esc 由全局处理。 */
      btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown") return;
        e.preventDefault();
        open(this.parentNode);
        var first = this.parentNode.querySelector("." + CLS + "__link");
        if (first && typeof first.focus === "function") first.focus();
      });

      host.appendChild(grp);
      made++;
    }

    if (!made) return;

    installGlobalListeners();

    /* 插在搜索之前：页头右侧那一簇是「工具箱 → 搜索 → 主题切换」，
       横向菜单属于导航，排在它们左边。 */
    var search = inner.querySelector(".md-search");
    if (search) inner.insertBefore(host, search);
    else inner.appendChild(host);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(mount);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();