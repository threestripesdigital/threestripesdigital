// Internal Keyword Scout. Any site, any market: top 100 keywords by volume
// from /api/scout (password gated, no lead capture), ranked by commercial
// intent, with positions 2-50 flagged as rank-boost candidates.
(function () {
  var form = document.getElementById("sc-form");
  var out = document.getElementById("sc-out");
  var err = document.getElementById("sc-err");
  var btn = document.getElementById("sc-submit");
  var codeEl = document.getElementById("sc-code");
  var urlEl = document.getElementById("sc-url");
  var locEl = document.getElementById("sc-loc");
  var freshEl = document.getElementById("sc-fresh");
  var histWrap = document.getElementById("sc-history");
  var histList = document.getElementById("sc-hist-list");

  // Mirrors LOCATIONS in functions/api/_scoutmodel.js (keys only; the
  // server owns the DataForSEO codes).
  var LOCATIONS = [
    ["us", "United States"], ["ca", "Canada"], ["gb", "United Kingdom"],
    ["au", "Australia"], ["nz", "New Zealand"], ["ie", "Ireland"], ["in", "India"],
    ["sg", "Singapore"], ["ph", "Philippines"], ["za", "South Africa"],
    ["ae", "United Arab Emirates"], ["de", "Germany"], ["fr", "France"],
    ["es", "Spain"], ["it", "Italy"], ["nl", "Netherlands"], ["se", "Sweden"],
    ["br", "Brazil"], ["mx", "Mexico"], ["jp", "Japan"]
  ];
  LOCATIONS.forEach(function (l) {
    var o = document.createElement("option");
    o.value = l[0];
    o.textContent = l[1];
    locEl.appendChild(o);
  });
  var LOC_LABEL = {};
  LOCATIONS.forEach(function (l) { LOC_LABEL[l[0]] = l[1]; });

  // Keep the code only for this browser tab; never persist credentials.
  try {
    codeEl.value = sessionStorage.getItem("tsd_scout_code") || "";
  } catch (e) { /* private mode */ }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function usd(n) { return "$" + Number(n || 0).toFixed(2); }
  function displayUrl(u) {
    return String(u || "").replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  }
  function safeHref(u) {
    return /^https?:\/\//i.test(String(u || "")) ? u : "";
  }
  function whenOf(at) {
    try {
      // D1 stamps UTC without a zone marker; make it explicit.
      var d = new Date((at || "").replace(" ", "T") + "Z");
      return isNaN(d) ? (at || "") : d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return at || ""; }
  }

  // --- Result state -------------------------------------------------------
  var current = null;   // last response
  var view = { filter: "all", sort: "score", q: "" };

  var SORTS = {
    score: function (a, b) { return b.score - a.score || b.volume - a.volume || a.position - b.position; },
    volume: function (a, b) { return b.volume - a.volume || b.score - a.score; },
    position: function (a, b) { return (a.position || 999) - (b.position || 999) || b.volume - a.volume; },
    cpc: function (a, b) { return b.cpc - a.cpc || b.volume - a.volume; }
  };

  function visibleRows() {
    var rows = (current && current.keywords) || [];
    if (view.filter === "boost") rows = rows.filter(function (k) { return k.boost; });
    if (view.filter === "top") rows = rows.filter(function (k) { return k.position === 1; });
    if (view.q) {
      var q = view.q.toLowerCase();
      rows = rows.filter(function (k) {
        return k.keyword.toLowerCase().indexOf(q) >= 0 ||
          String(k.url || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    return rows.slice().sort(SORTS[view.sort] || SORTS.score);
  }

  function posCell(k) {
    var p = Number(k.position) || 0;
    if (!p) return '<span class="pos none">—</span>';
    if (p === 1) return '<span class="pos one">#1</span>';
    if (k.boost) return '<span class="pos boost">#' + p + '</span>';
    return '<span class="pos far">#' + p + '</span>';
  }

  function rowHtml(k, i) {
    var href = safeHref(k.url);
    var urlBit = k.url
      ? '<span class="u">' + (href
        ? '<a href="' + escHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(displayUrl(k.url)) + '</a>'
        : escHtml(displayUrl(k.url))) + '</span>'
      : '';
    var why = (k.signals && k.signals.length) ? '<span class="sc-why">' + escHtml(k.signals.join(" · ")) + '</span>' : '';
    var cls = (k.boost ? "boost" : "") + (k.brand ? " brand" : "");
    return '<tr class="' + cls.trim() + '">' +
      '<td class="sc-n">' + (i + 1) + '</td>' +
      '<td class="sc-kw">' + escHtml(k.keyword) + (k.boost ? '<span class="tag boostlbl">boost</span>' : '') + urlBit + '</td>' +
      '<td class="sc-num">' + posCell(k) + '</td>' +
      '<td class="sc-num">' + num(k.volume) + '</td>' +
      '<td class="sc-num">' + (k.cpc ? usd(k.cpc) : '<span style="color:var(--muted-2)">—</span>') + '</td>' +
      '<td><span class="tag ' + escHtml(k.intent) + '">' + escHtml(k.intent) + '</span></td>' +
      '<td><div class="score"><span class="bar"><i style="width:' + Math.max(2, Number(k.score) || 0) + '%"></i></span><b>' + (Number(k.score) || 0) + '</b></div>' + why + '</td>' +
      '</tr>';
  }

  function renderTable() {
    var tbody = document.getElementById("sc-tbody");
    var count = document.getElementById("sc-count");
    if (!tbody) return;
    var rows = visibleRows();
    tbody.innerHTML = rows.length
      ? rows.map(rowHtml).join("")
      : '<tr><td colspan="7" class="sc-empty">Nothing matches this view.</td></tr>';
    if (count) count.textContent = rows.length + " shown";
    document.querySelectorAll(".sc-tab").forEach(function (t) {
      t.classList.toggle("on", t.getAttribute("data-filter") === view.filter);
    });
    document.querySelectorAll(".sc-table th[data-sort]").forEach(function (th) {
      th.classList.toggle("on", th.getAttribute("data-sort") === view.sort);
    });
    var sortEl = document.getElementById("sc-sort");
    if (sortEl) sortEl.value = view.sort;
  }

  function csvOf(rows) {
    var head = ["keyword", "position", "boost_candidate", "search_volume", "cpc", "intent", "score", "url"];
    var lines = [head.join(",")];
    rows.forEach(function (k) {
      lines.push([
        k.keyword, k.position, k.boost ? "yes" : "no", k.volume, k.cpc,
        k.intent, k.score, k.url || ""
      ].map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    });
    return lines.join("\n");
  }

  function copyText(text, button, label) {
    var done = function () {
      var old = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { button.textContent = label; }
      document.body.removeChild(ta);
    }
  }

  function render(data) {
    current = data;
    view = { filter: data.boost_count ? "boost" : "all", sort: "score", q: "" };
    var kws = data.keywords || [];
    var market = data.location_label || LOC_LABEL[data.location] || data.location || "";
    var tx = kws.filter(function (k) { return k.intent === "transactional" || k.intent === "commercial"; }).length;
    var boostVol = kws.reduce(function (s, k) { return s + (k.boost ? (Number(k.volume) || 0) : 0); }, 0);

    if (!kws.length) {
      out.innerHTML =
        '<div class="step-result">' +
        '<p class="res-badge no">Nothing found</p>' +
        '<h2 class="step-h">No organic keywords for ' + escHtml(data.domain) + ' in ' + escHtml(market) + '.</h2>' +
        '<p class="res-sub">DataForSEO has no ranked keywords with search volume for this target in this market. ' +
        'Try another market, the bare domain instead of a page, or check the spelling.</p></div>';
      return;
    }

    out.innerHTML =
      '<div class="step-result">' +
      '<p class="res-badge">' + escHtml(data.domain) + ' · ' + escHtml(market) +
      (data.cached ? ' · stored ' + escHtml(whenOf(data.at)) : ' · live') + '</p>' +
      '<h2 class="step-h">' + num(data.boost_count) + ' rank-boost candidate' + (data.boost_count === 1 ? '' : 's') +
      ' out of ' + num(kws.length) + ' keywords.</h2>' +
      '<p class="res-sub">Top ' + num(kws.length) + ' keywords by search volume' +
      (data.total > kws.length ? ' (of ' + num(data.total) + ' ranked in total)' : '') +
      ', ordered by commercial intent. Gold rows sit in positions 2–50: already on Google’s radar, not yet taking the clicks.</p>' +
      '</div>' +
      '<div class="sc-summary">' +
      '<div class="sc-stat gold"><span class="l">Boost candidates</span><span class="v">' + num(data.boost_count) + '</span><span class="s">positions 2–50</span></div>' +
      '<div class="sc-stat"><span class="l">Searches in play</span><span class="v">' + num(boostVol) + '</span><span class="s">monthly volume across boost rows</span></div>' +
      '<div class="sc-stat"><span class="l">Buying intent</span><span class="v">' + num(tx) + '</span><span class="s">transactional or commercial</span></div>' +
      '<div class="sc-stat"><span class="l">Lookup cost</span><span class="v">$' + Number(data.cost || 0).toFixed(3) + '</span><span class="s">' + (data.cached ? 'no new spend' : 'DataForSEO, this pull') + '</span></div>' +
      '</div>' +
      '<div class="sc-tools">' +
      '<div class="sc-tabs">' +
      '<button type="button" class="sc-tab" data-filter="boost">Boost candidates (' + num(data.boost_count) + ')</button>' +
      '<button type="button" class="sc-tab" data-filter="all">All (' + num(kws.length) + ')</button>' +
      '<button type="button" class="sc-tab" data-filter="top">Already #1</button>' +
      '</div>' +
      '<select id="sc-sort" aria-label="Sort">' +
      '<option value="score">Sort: priority</option>' +
      '<option value="volume">Sort: volume</option>' +
      '<option value="position">Sort: position</option>' +
      '<option value="cpc">Sort: CPC</option>' +
      '</select>' +
      '<input type="search" id="sc-q" placeholder="Filter keywords…" aria-label="Filter keywords" />' +
      '<div class="right"><span class="sc-hint" id="sc-count" style="margin:0;align-self:center"></span>' +
      '<button type="button" class="sc-mini" id="sc-copy-csv">Copy CSV</button>' +
      '<button type="button" class="sc-mini" id="sc-copy-kw">Copy keywords</button></div>' +
      '</div>' +
      '<div class="sc-table-wrap"><table class="sc-table">' +
      '<thead><tr>' +
      '<th>#</th>' +
      '<th data-sort="score">Keyword</th>' +
      '<th data-sort="position">Position</th>' +
      '<th data-sort="volume">Volume / mo</th>' +
      '<th data-sort="cpc">CPC</th>' +
      '<th>Intent</th>' +
      '<th data-sort="score">Priority</th>' +
      '</tr></thead><tbody id="sc-tbody"></tbody></table></div>';

    out.querySelectorAll(".sc-tab").forEach(function (t) {
      t.addEventListener("click", function () {
        view.filter = t.getAttribute("data-filter");
        renderTable();
      });
    });
    document.getElementById("sc-sort").addEventListener("change", function (e) {
      view.sort = e.target.value;
      renderTable();
    });
    document.getElementById("sc-q").addEventListener("input", function (e) {
      view.q = e.target.value.trim();
      renderTable();
    });
    out.querySelectorAll(".sc-table th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        view.sort = th.getAttribute("data-sort");
        renderTable();
      });
    });
    var csvBtn = document.getElementById("sc-copy-csv");
    csvBtn.addEventListener("click", function () { copyText(csvOf(visibleRows()), csvBtn, "Copy CSV"); });
    var kwBtn = document.getElementById("sc-copy-kw");
    kwBtn.addEventListener("click", function () {
      copyText(visibleRows().map(function (k) { return k.keyword; }).join("\n"), kwBtn, "Copy keywords");
    });

    renderTable();
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- API -----------------------------------------------------------------
  function api(payload) {
    return fetch("api/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    });
  }

  function loadHistory(code) {
    api({ code: code, action: "history" })
      .then(function (res) {
        if (!res.ok) return;
        var rows = res.data.lookups || [];
        histWrap.hidden = false;
        if (!rows.length) {
          histList.innerHTML = '<p class="sc-empty">No lookups yet.</p>';
          return;
        }
        histList.innerHTML = rows.map(function (r) {
          var ok = r.status === "ok";
          var value = ok
            ? '<span class="sc-val">' + num(r.boost_count) + ' boost' + (r.boost_count === 1 ? '' : 's') + '</span>'
            : '<span class="sc-no">' + escHtml(r.status === "check_failed" ? "failed" : r.status) + '</span>';
          return '<button type="button" class="sc-row" data-id="' + escHtml(r.id) + '"' + (ok ? '' : ' disabled') + '>' +
            '<span class="sc-dom">' + escHtml(r.domain) +
            '<span>' + escHtml(LOC_LABEL[r.location] || r.location || "") +
            (ok ? ' · ' + num(r.total) + ' keywords' : '') + '</span></span>' +
            value +
            '<span class="sc-when">' + escHtml(whenOf(r.at)) + '</span>' +
            '</button>';
        }).join("");
        histList.querySelectorAll(".sc-row[data-id]").forEach(function (b) {
          b.addEventListener("click", function () {
            var id = Number(b.getAttribute("data-id"));
            if (!id) return;
            err.textContent = "";
            api({ code: code, action: "load", id: id })
              .then(function (res) {
                if (!res.ok || res.data.error) {
                  err.textContent = MESSAGES[res.data && res.data.error] || "Couldn't reopen that lookup.";
                  return;
                }
                render(res.data);
              })
              .catch(function () { err.textContent = "Couldn't reach the lookup service."; });
          });
        });
      })
      .catch(function () { /* history is a nicety, never block the tool */ });
  }

  if (codeEl.value) loadHistory(codeEl.value);

  var MESSAGES = {
    forbidden: "Wrong access code.",
    invalid_domain: "That doesn't look like a website address.",
    invalid_location: "Pick a market from the list.",
    rate_limited: "Too many lookups this hour. Try again shortly.",
    not_configured: "Scout is not configured yet (missing secret).",
    check_failed: "The ranking provider didn't respond. Try again.",
    not_found: "That lookup is no longer stored.",
    storage_unavailable: "Storage is unavailable right now."
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    var code = codeEl.value.trim();
    var website = urlEl.value.trim();
    if (!code || !website) return;

    btn.disabled = true;
    btn.textContent = "Pulling…";
    out.innerHTML =
      '<div class="step-result"><div class="res-loading"><i class="res-spin" aria-hidden="true"></i>' +
      '<h2 class="step-h">Pulling keywords for ' + escHtml(website) + ' …</h2>' +
      '<p class="res-sub">Fetching the top 100 by volume from DataForSEO and scoring intent.</p></div></div>';

    api({ code: code, website_url: website, location: locEl.value, fresh: !!freshEl.checked })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = "Pull keywords";
        if (!res.ok || (res.data && res.data.error)) {
          out.innerHTML = "";
          err.textContent = MESSAGES[res.data && res.data.error] || "Something went wrong.";
          return;
        }
        try {
          sessionStorage.setItem("tsd_scout_code", code);
        } catch (e2) { /* private mode */ }
        freshEl.checked = false;
        render(res.data);
        loadHistory(code);
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Pull keywords";
        out.innerHTML = "";
        err.textContent = "Couldn't reach the lookup service.";
      });
  });
})();
