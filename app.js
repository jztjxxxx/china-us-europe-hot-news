// 中美欧热点新闻 — 读取 data/news.json 并在客户端渲染。
// 无外部依赖；直接用浏览器打开 index.html 时 fetch 会被 file:// 限制，
// 请用 `python3 -m http.server` 后访问，或部署到 GitHub Pages。
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
      render();
    })
    .catch(function (err) {
      statusEl.textContent = "新闻加载失败（" + err.message +
        "）。请用 python3 -m http.server 启动后访问，或检查 data/news.json 是否存在。";
    });
})();
