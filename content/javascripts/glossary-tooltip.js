/* ==========================================================================
   术语悬浮提示（Glossary Tooltips）
   --------------------------------------------------------------------------
   做什么：把正文里首次出现的塔科夫术语包成可悬停 / 可点击的元素，
           显示"原文 + 一句话释义"。

   数据源：window.TARKOV_TERMS —— 由 scripts/build_glossary.py 从
          content/docs/glossary.md 自动生成。**改了术语表，提示自动跟着变，
          不需要改这里。**

   三条克制的设计（避免"满屏下划线"反而吵）：
     1. 每个术语**每页只标第一次**；
     2. 全页**总量上限**（MAX_PER_PAGE）；
     3. 跳过标题、代码块、链接文字，以及术语速查页自身。

   交互：桌面悬停显示；移动端没有 hover，所以额外支持**点击切换**（并可 Esc 关闭）。
   ========================================================================== */

(function () {
  "use strict";

  var MAX_PER_PAGE = 15;          // 全页最多标注几个术语
  var CLS = "tk-term";

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function makeRe(key) {
    var e = escRe(key);
    // 纯 ASCII 的术语（PMC / FiR / Kappa…）加词边界，避免命中单词内部
    if (/^[\x00-\x7F]+$/.test(key)) return new RegExp("\\b" + e + "\\b", "g");
    return new RegExp(e, "g");
  }

  function buildIndex(terms) {
    var list = [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      for (var j = 0; j < t.keys.length; j++) {
        var k = t.keys[j];
        if (!k) continue;
        list.push({ key: k, full: t.full || "", desc: t.desc || "", re: makeRe(k) });
      }
    }
    // 长 key 优先：避免 "Scav" 抢掉 "Player Scav"
    list.sort(function (a, b) { return b.key.length - a.key.length; });
    return list;
  }

  function wrap(node, item, match) {
    var text = node.nodeValue;
    var before = text.slice(0, match.index);
    var hit = text.slice(match.index, match.index + match[0].length);
    var after = text.slice(match.index + match[0].length);

    var span = document.createElement("span");
    span.className = CLS;
    span.setAttribute("tabindex", "0");
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", item.key + "：" + item.desc);
    span.setAttribute("data-tip", (item.full ? item.full + " —— " : "") + item.desc);
    span.textContent = hit;

    var parent = node.parentNode;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(span, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
    return span;
  }

  function run() {
    var terms = window.TARKOV_TERMS;
    if (!terms || !terms.length) return;

    // 术语速查页自身不必标注
    if (/\/docs\/glossary\/?$/.test(location.pathname)) return;

    var content = document.querySelector(".md-content__inner") ||
                  document.querySelector(".md-content");
    if (!content) return;

    var index = buildIndex(terms);
    var used = {};
    var count = 0;

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(H1|H2|H3|H4|H5|H6|CODE|PRE|SCRIPT|STYLE|A|BUTTON|KBD)$/.test(p.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest("." + CLS)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (var n = 0; n < nodes.length && count < MAX_PER_PAGE; n++) {
      var node = nodes[n];
      if (!node.parentNode) continue;

      // 同一个文本节点里可能有多个术语，逐个包装
      var guard = 0;
      while (count < MAX_PER_PAGE && guard++ < 5) {
        var text = node.nodeValue;
        if (!text) break;
        var best = null;
        for (var i = 0; i < index.length; i++) {
          var item = index[i];
          if (used[item.key]) continue;
          item.re.lastIndex = 0;
          var m = item.re.exec(text);
          if (m && (!best || m.index < best.m.index)) best = { item: item, m: m };
        }
        if (!best) break;
        var span = wrap(node, best.item, best.m);
        used[best.item.key] = true;
        count++;
        // wrap 之后原 node 已被移除；后续循环改用尾部的文本节点
        var next = span.nextSibling;
        if (!next || next.nodeType !== 3) break;
        node = next;
      }
    }
  }

  // Material 的 document$ 在首次加载与每次 instant 切换后都会触发
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(run);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  // 移动端：点击术语切换展开（并支持 Esc / 点别处关闭）
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("." + CLS);
    var open = document.querySelector("." + CLS + ".is-open");
    if (open && open !== el) open.classList.remove("is-open");
    if (el) el.classList.toggle("is-open");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var open = document.querySelector("." + CLS + ".is-open");
      if (open) open.classList.remove("is-open");
    }
  });
})();
