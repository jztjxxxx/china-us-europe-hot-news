// 中美欧热点新闻 — 读取 data/news.json 并在客户端渲染。
// 直接用浏览器打开 index.html 时 fetch 会被 file:// 限制，
// 请用 `python3 -m http.server` 后访问，或部署到 GitHub Pages。
//
// 翻译：页面用免费的 GTranslate 小部件（cdn.gtranslate.net，无需 key，
// 非商业网站免费）。设置在 index.html 里定义，dropdown.js 用 defer
// 加载，在 .gtranslate_wrapper 里生成一个语言下拉框，点选语言后整页翻译。
// 动态内容与漏翻处理 — 新闻是 fetch 后才渲染进 DOM 的，
// 对照 GTranslate 自身源码（dropdown.js / lib.min.js）核对后：
//  1) 翻译库自带 DOM 变化监听（MutationObserver），新节点加入时会
//     停掉当前一轮、重新走一遍整个页面；但一轮翻完后它会把监听
//     的开关关掉（this.h=false），之后再有渲染变化就不一定触发，
//     特别是切走地区/分类再切回“全部”时头条是同一条内容重建，
//     翻译库全身文本对比可能看不出变化。
//  2) 翻译库只优先翻视口内的节点，视口外的先放一放（约 200px
//     余量），等滚到附近再翻；而且是分批逐步翻的。所以页脚
//     （页面最底下）和刚好在首屏外的头条，在短时间检查里没翻完
//     是正常的，不是被跳过了。
//  3) window.doGTranslate("zh-CN|en") 在已经翻成英文时再调是空操作：
//     翻译库内部只有语言真的变了、或还没有翻译对象时才会开新一轮，
//     同语言再调只会直接报 100%。所以“再调一次 doGTranslate”
//     并不能补翻漏掉的节点——旧版就是这么写的，它其实不起作用。
//  4) 真正能强制同一语言重翻的办法是 __GT.translator.revert()
//     （恢复原文、清空已存语言）再调 __GT.translator.translate()：
//     revert 后翻译库会新建翻译对象、重新走一遍整个页面。这是
//     小部件自己暴露的全局对象（doGTranslate 内部调的就是它），
//     不是编造的 API。代价是整页会先短暂恢复中文再重翻，所以
//     只在确实看到缺口时才用，每个 render 周期最多两次、每页最多 20 次
//     （安全上限，防止来回闪）。上一轮没翻完时不放弃：轮询会一直等到
//     它翻完再查缺口，而不是只查两次就停。
// 做法见 pollEnsureTranslation：每次 render() 后开始一轮轮询
// （首次约 0.9 秒、之后每 2 秒一次、持续约 90 秒），只在“已选非中文、
// 翻译库已就绪、上一轮已结束、头条或页脚在视口内却仍是中文原文”时才
// 强制重翻；滚动时（防抖）也触发一轮检查，覆盖滚到底部才看到的页脚。
// 后台标签页的定时器会被浏览器节流，90 秒轮询可能在切走期间悄悄
// 过期、错过补翻：render 发生在后台时先不启动轮询、只记一个待处理
// 标记，poll 轮到后台时也停下等；切回前台（visibilitychange）时再
// 重新开始一轮轮询。见 scheduleEnsureTranslation / pollEnsureTranslation。
// 此前用的 Google 翻译小部件已于 2026-10-01 停服、实测无法渲染下拉框，
// 故全部移除，改用 GTranslate（见 README“翻译”一节）。
(function () {
  "use strict";

  var REGIONS = ["中国", "美国", "欧洲"];
  var state = { items: [], updatedAt: "", region: "全部", category: "全部", query: "" };

  var newsEl = document.getElementById("news");
  var statusEl = document.getElementById("status");
  var emptyEl = document.getElementById("empty");
  var headlineEl = document.getElementById("headline");
  var updatedEl = document.getElementById("updated-at");
  var dateEl = document.getElementById("today-date");
  var searchEl = document.getElementById("search");

  /* ---- 互动效果（原生实现，概念参考 21st.dev 的 Marquee /
     Spotlight Card / Blur Fade / Magnetic Button；代码是本站
     自己写的，没有复制它们的源码）----
     全部效果都只在合适时启用：减动效偏好（prefers-reduced-motion）
     时不做淡入和磁吸；光晕和磁吸只在能悬停的设备上启用，触屏
     不受任何影响。 */
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* Blur Fade 的安全门：只有浏览器支持 IntersectionObserver、
     且用户没有减动效偏好时，才给 <html> 加 js-fade（CSS 据此把
     卡片/头条先藏起来，等滚进视口再淡入）。没有 JS、或不支持
     IntersectionObserver 时，这个类永远不会出现，内容默认可见。 */
  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-fade");
  }

  /* ---- 1) 跑马灯：取前 8 条标题，两组相同内容拼成无缝循环 ---- */
  var tickerEl = document.getElementById("ticker");
  var tickerTrack = document.getElementById("ticker-track");

  function buildTicker() {
    if (!tickerEl || !tickerTrack) return;
    var items = state.items.slice(0, 8);
    if (!items.length) { tickerEl.hidden = true; return; }
    var group = items.map(function (it) {
      return '<a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(it.title) + '</a><span class="ticker-sep" aria-hidden="true">✦</span>';
    }).join("");
    tickerTrack.innerHTML =
      '<span class="ticker-group">' + group + '</span>' +
      '<span class="ticker-group" aria-hidden="true">' + group + '</span>';
    tickerEl.hidden = false;
  }

  /* ---- 3) 滚动模糊淡入：滚进视口的卡片/头条加 .in-view 淡入 ----
     每次 render() 都会重建 DOM，所以每次渲染后都要重新观察新节点。
     已经在视口内的节点，observe 后会立刻回调、马上淡入，不用等滚动。 */
  var fadeObserver = null;

  function observeFade() {
    if (!document.documentElement.classList.contains("js-fade")) return;
    if (!fadeObserver) {
      fadeObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            fadeObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    }
    var targets = document.querySelectorAll(".card, .headline");
    for (var i = 0; i < targets.length; i++) {
      if (!targets[i].hidden) fadeObserver.observe(targets[i]);
    }
  }

  /* ---- 2) 卡片光晕：鼠标在卡片上移动时，把光标位置写进
     --mx / --my，CSS 的 ::before 径向渐变就跟着光标走。
     事件委托挂在 #news 容器上，render 重建卡片也不用重新绑定。 */
  if (finePointer && !prefersReducedMotion) {
    newsEl.addEventListener("mousemove", function (e) {
      var card = e.target && e.target.closest ? e.target.closest(".card") : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
      card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
    });
  }

  /* ---- 4) 磁吸按钮：地区/分类页签在鼠标靠近时朝光标方向
     轻移最多 4px，松开（mouseleave）后靠 CSS 过渡弹回原位。
     只改 transform，不动点击逻辑，页签切换照常工作。 */
  if (finePointer && !prefersReducedMotion) {
    var magButtons = document.querySelectorAll("#region-tabs button, #category-tabs button");
    for (var i = 0; i < magButtons.length; i++) {
      (function (btn) {
        btn.addEventListener("mousemove", function (e) {
          var r = btn.getBoundingClientRect();
          var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          btn.style.transform = "translate(" + (dx * 4).toFixed(1) + "px," + (dy * 4).toFixed(1) + "px)";
        });
        btn.addEventListener("mouseleave", function () { btn.style.transform = ""; });
      })(magButtons[i]);
    }
  }

  /* ---- GTranslate：渲染后检查头条 / 页脚是否真的被翻了 ----
     见文件头注释：同语言再调 doGTranslate() 是空操作，真正能强制
     同一语言重翻的是 __GT.translator.revert() + translate()。
     只在确实看到缺口时才用，避免整页来回闪。 */
  var FOOTER_ORIGINAL = "新闻内容版权属于原来源，本站仅做摘要聚合；点击标题可阅读原文。";
  /* 轮询状态：每轮 render 开始一轮检查，持续约 90 秒。
     forcedThisCycle：本轮已强制重翻次数（上限 2，第一次重翻完
     验证仍有缺口才允许第二次）；forcedPassesTotal：每页累计
     安全上限 20，防止极端情况下来回闪。旧版的问题：每页上限
     只有 3 次，切几个分类就用完了；而且只在 0.9 秒 / 3.5 秒
     查两次，上一轮还在翻（finished===false，一轮要几十秒）
     时就直接放弃、再也不查。 */
  var forcedPassesTotal = 0;
  var forcedThisCycle = 0;
  var lastForceAt = 0;
  var ensureTimer = null;
  var ensureDeadline = 0;
  var scrollCheckTimer = null;
  /* render 或 poll 发生在后台标签页时记一个待处理标记：后台定时器
     会被浏览器节流，90 秒轮询不能在后台白白烧掉，切回前台时凭这
     个标记重新开始一轮（见 visibilitychange 处理）。 */
  var ensurePending = false;

  /* 已选的目标语言，存在 localStorage 的 __GT_TRANSLATE_LANGS 里
     （{"srcLang": "zh-CN", "tgtLang": "en"} 这种格式，与
     dropdown.js / lib.min.js 的读写一致，已核对过源码）。 */
  function storedTargetLang() {
    try {
      var stored = JSON.parse(localStorage.getItem("__GT_TRANSLATE_LANGS") || "null");
      if (stored && typeof stored.tgtLang === "string") return stored.tgtLang;
    } catch (e) { /* 忽略读取失败 */ }
    return "";
  }

  /* 标签页是否在后台（老浏览器没有 document.hidden 时按可见处理）。 */
  function isHidden() {
    return typeof document.hidden === "boolean" && document.hidden;
  }

  function currentHeadlineItem() {
    if (state.region !== "全部" || state.category !== "全部" || state.query) return null;
    var filtered = state.items.filter(matches);
    return filtered.length ? filtered[0] : null;
  }

  function rectInViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  /* 头条或页脚在视口内、却仍显示中文原文 → 有真实缺口。
     不在视口内时不算缺口：翻译库本来就会等滚到附近再翻。 */
  function hasVisibleGap() {
    var item = currentHeadlineItem();
    if (item && !headlineEl.hidden) {
      var h2 = headlineEl.querySelector("h2");
      if (h2 && rectInViewport(headlineEl) &&
          h2.textContent.trim() === item.title) return true;
    }
    var fp = document.querySelector("footer p");
    if (fp && rectInViewport(fp) &&
        fp.textContent.trim() === FOOTER_ORIGINAL) return true;
    return false;
  }

  /* 本轮轮询还没到 90 秒截止时，2 秒后再查一次。 */
  function rescheduleEnsure() {
    if (Date.now() < ensureDeadline) {
      ensureTimer = setTimeout(pollEnsureTranslation, 2000);
    } else {
      ensureTimer = null;
    }
  }

  /* 检查一次头条 / 页脚是否真的被翻了，有真实缺口时强制重翻。
     关键：上一轮还在翻（finished===false）或翻译库还没就绪时
     不放弃，只是等 2 秒再查——GTranslate 一轮要几十秒，只查
     两次必然撞上“还在翻”。强制重翻后也继续轮询，等新一轮翻
     完再验证缺口还在不在；还在且本轮没用完 2 次，才再强制一次。 */
  function pollEnsureTranslation() {
    ensureTimer = null;
    if (isHidden()) {   // 在后台时停下、不消耗轮询期限，切回前台再重开
      ensurePending = true;
      return;
    }
    var lang = storedTargetLang();
    if (!lang || lang === "zh-CN") return;   // 没选翻译 / 选回中文，停
    var gt = window.__GT && window.__GT.translator;
    if (!gt || typeof gt.revert !== "function" ||
        typeof gt.translate !== "function") { rescheduleEnsure(); return; }
    if (gt.libReady === false) { rescheduleEnsure(); return; }  // 库还没加载完，继续等
    if (gt.finished === false) { rescheduleEnsure(); return; }  // 上一轮还在翻，等它翻完再看
    if (!hasVisibleGap()) return;   // 没缺口，翻译已完成，停
    if (forcedThisCycle >= 2 || forcedPassesTotal >= 20) return;  // 本轮 / 全页上限，停
    if (forcedThisCycle > 0 && Date.now() - lastForceAt < 10000) {
      rescheduleEnsure(); return;   // 两次强制重翻至少隔 10 秒
    }
    try {
      /* revert() 会把整页先恢复成中文原文、并清空已存语言，
         紧接着的 translate() 因此会新建翻译对象、重新走一遍
         整个页面（含头条和页脚）。 */
      gt.revert();
      gt.translate("zh-CN", lang);
      forcedThisCycle++;
      forcedPassesTotal++;
      lastForceAt = Date.now();
    } catch (e) { /* 翻译失败时不影响新闻本身 */ }
    rescheduleEnsure();   // 继续轮询，验证新一轮翻完后缺口还在不在
  }

  /* 每次 render() 后开始一轮轮询：首次约 0.9 秒查，之后每 2 秒
     查一次、持续约 90 秒（覆盖 GTranslate 几十秒一轮的时长）。
     render 发生在后台时不启动轮询、只记待处理标记，切回前台时
     由 visibilitychange 处理重新开始，避免 90 秒在后台被节流烧掉。 */
  function scheduleEnsureTranslation() {
    if (ensureTimer) clearTimeout(ensureTimer);
    forcedThisCycle = 0;
    if (isHidden()) {
      ensurePending = true;
      ensureTimer = null;
      return;
    }
    ensurePending = false;
    ensureDeadline = Date.now() + 90000;
    ensureTimer = setTimeout(pollEnsureTranslation, 900);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "";
    return d.toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      hour12: false
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) + " " + week;
  }

  function matches(item) {
    if (state.region !== "全部" && item.region !== state.region) return false;
    if (state.category !== "全部" && item.category !== state.category) return false;
    if (state.query) {
      var hay = (item.title + " " + item.summary).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  }

  function cardHtml(item) {
    return '<article class="card">' +
      '<span class="category">' + escapeHtml(item.category) + '</span>' +
      '<h3><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(item.title) + "</a></h3>" +
      '<p class="summary">' + escapeHtml(item.summary) + "</p>" +
      '<p class="meta"><span>' + escapeHtml(item.source) + "</span>" +
      "<span>" + escapeHtml(formatTime(item.published_at)) + "</span></p>" +
      "</article>";
  }

  function render() {
    var filtered = state.items.filter(matches);
    var headline = null;
    if (state.region === "全部" && state.category === "全部" && !state.query && filtered.length > 0) {
      headline = filtered[0];
      filtered = filtered.slice(1);
    }

    if (headline) {
      headlineEl.innerHTML =
        '<p class="kicker">头条 · ' + escapeHtml(headline.region) + " · " + escapeHtml(headline.category) + "</p>" +
        '<h2><a href="' + escapeHtml(headline.url) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(headline.title) + "</a></h2>" +
        '<p>' + escapeHtml(headline.summary) + "</p>" +
        '<p class="meta" style="font-family:system-ui,sans-serif;font-size:12.5px;color:#6b6b6b;">' +
        escapeHtml(headline.source) + " · " + escapeHtml(formatTime(headline.published_at)) + "</p>";
      headlineEl.hidden = false;
    } else {
      headlineEl.hidden = true;
      headlineEl.innerHTML = "";
    }

    var regions = state.region === "全部" ? REGIONS : [state.region];
    var html = "";
    regions.forEach(function (region) {
      var list = filtered.filter(function (it) { return it.region === region; });
      if (!list.length) return;
      html += '<section class="region-section"><h2>' + escapeHtml(region) +
        " <span>" + list.length + " 条</span></h2>" +
        '<div class="cards">' + list.map(cardHtml).join("") + "</div></section>";
    });
    newsEl.innerHTML = html;
    emptyEl.hidden = filtered.length !== 0;
    statusEl.hidden = true;
    /* 地区 / 分类 / 搜索切换后重新渲染了卡片与头条，开始一轮轮询：
       头条、页脚是否真的被翻了，有缺口时强制重翻（见文件头注释）。 */
    scheduleEnsureTranslation();
    /* 渲染重建了卡片 DOM，重新观察新节点做滚动淡入。 */
    observeFade();
  }

  function bindTabs(id, key) {
    document.getElementById(id).addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      state[key] = btn.getAttribute("data-" + key);
      var buttons = document.querySelectorAll("#" + id + " button");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle("active", buttons[i] === btn);
      }
      render();
    });
  }

  bindTabs("region-tabs", "region");
  bindTabs("category-tabs", "category");
  searchEl.addEventListener("input", function () {
    state.query = searchEl.value.trim().toLowerCase();
    render();
  });

  /* 切回前台时补一次检查：后台期间定时器被节流，90 秒轮询可能
     过期、错过补翻。有待处理标记、或当前没有轮询在跑时，重开一轮；
     没选翻译、或已选回中文时什么也不做（poll 里会直接退出）。 */
  document.addEventListener("visibilitychange", function () {
    if (isHidden()) return;
    var lang = storedTargetLang();
    if (!lang || lang === "zh-CN") return;
    if (ensurePending || !ensureTimer) scheduleEnsureTranslation();
  });

  /* 滚动时也检查（防抖）：覆盖滚到底部才进入视口的页脚，
     以及滚回顶部才看到的头条。已有轮询在跑时只延长截止时间；
     没有轮询在跑时新开一轮。 */
  window.addEventListener("scroll", function () {
    if (scrollCheckTimer) clearTimeout(scrollCheckTimer);
    scrollCheckTimer = setTimeout(function () {
      if (ensureTimer) {
        ensureDeadline = Math.max(ensureDeadline, Date.now() + 30000);
      } else {
        scheduleEnsureTranslation();
      }
    }, 800);
  }, { passive: true });

  fetch("data/news.json")
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(function (data) {
      state.items = Array.isArray(data.items) ? data.items : [];
      state.updatedAt = data.updated_at || "";
      updatedEl.textContent = state.updatedAt
        ? formatDate(state.updatedAt) + " " + formatTime(state.updatedAt)
        : "未知";
      dateEl.textContent = state.updatedAt
        ? formatDate(state.updatedAt)
        : formatDate(new Date().toISOString());
      if (!state.items.length) {
        statusEl.textContent = "暂无新闻数据。";
        return;
      }
      buildTicker();
      render();
    })
    .catch(function (err) {
      statusEl.textContent = "新闻加载失败（" + err.message +
        "）。请用 python3 -m http.server 启动后访问，或检查 data/news.json 是否存在。";
    });
})();
