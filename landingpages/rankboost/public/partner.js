// Internal partner rank lookup. Renders the same opportunity display the
// funnel's step 2 shows, from /api/partner (password gated, no lead capture).
(function () {
  var form = document.getElementById("pt-form");
  var out = document.getElementById("pt-out");
  var err = document.getElementById("pt-err");
  var btn = document.getElementById("pt-submit");
  var codeEl = document.getElementById("pt-code");
  var histWrap = document.getElementById("pt-history");
  var histList = document.getElementById("pt-hist-list");

  // Keep the code only for this browser tab; never persist partner credentials.
  try {
    codeEl.value = sessionStorage.getItem("tsd_partner_code") || "";
  } catch (e) { /* private mode */ }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtMoney(n) { return "$" + Number(n).toLocaleString(); }
  function fmtCount(n) { return n >= 10 ? Math.round(n).toLocaleString() : Number(n).toFixed(1); }
  function displayUrl(u) {
    return String(u || "").replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  }

  function rankClass(pos) {
    var p = Number(pos);
    if (p <= 5) return "ok";
    if (p <= 10) return "warn";
    return "bad";
  }

  function statPair(k) {
    return '<div class="opp-stats">' +
      '<div class="opp-stat"><span class="s-l">Current rank</span>' +
      '<span class="s-v ' + rankClass(k.position) + '">#' + escHtml(k.position) + '</span></div>' +
      '<div class="opp-stat"><span class="s-l">Searches / month</span>' +
      '<span class="s-v">' + Number(k.volume).toLocaleString() + '</span></div>' +
      '</div>';
  }

  function mathTable(k, open) {
    function row(label, why, now, one, strong) {
      var s = strong ? " strong" : "";
      return '<span class="c-l' + s + '">' + label +
        (why ? '<span class="c-why">' + why + '</span>' : '') + '</span>' +
        '<span class="c-v c-now' + s + '">' + now + '</span>' +
        '<span class="c-v c-one' + s + '">' + one + '</span>';
    }
    var vol = Number(k.volume).toLocaleString();
    var nowVisits = Number(k.now_clicks).toLocaleString();
    var oneVisits = Number(k.opp_clicks).toLocaleString();
    var nowLeads = fmtCount(k.now_leads), oneLeads = fmtCount(k.opp_leads);
    var nowCases = fmtCount(k.now_cases), oneCases = fmtCount(k.opp_cases);
    var cv = fmtMoney(k.case_value);
    var gap = Math.max(0, (Number(k.opp_value) || 0) - (Number(k.now_value) || 0));
    return '<div class="opp-math"' + (open ? '' : ' hidden') + '>' +
      '<div class="opp-cmp">' +
      '<span class="c-h c-hl"></span>' +
      '<span class="c-h c-now-h">Today at #' + escHtml(k.position) + '</span>' +
      '<span class="c-h c-one-h">At #1</span>' +
      row("Share of the clicks",
        "Illustrative model: 40% at #1, with a steep decline at lower positions. Actual click-through rates vary.",
        k.ctr_now + "%", "40%") +
      row("Visits a month", "",
        vol + " × " + k.ctr_now + "% = " + nowVisits, vol + " × 40% = " + oneVisits) +
      row("Inquiries a month",
        "Illustrative assumption: 10% of organic visitors inquire. Actual conversion rates vary.",
        nowVisits + " × 10% inquire = " + nowLeads, oneVisits + " × 10% inquire = " + oneLeads) +
      row("Signed cases a month",
        "Illustrative assumption: 20% of inquiries become clients. Actual close rates vary.",
        nowLeads + " × 20% close = " + nowCases, oneLeads + " × 20% close = " + oneCases) +
      row("Fees a month",
        cv + " is a planning assumption for this practice area, not a fee forecast.",
        nowCases + " × " + cv + " = " + fmtMoney(k.now_value),
        oneCases + " × " + cv + " = " + fmtMoney(k.opp_value), true) +
      '</div>' +
      '<div class="opp-diff">' + fmtMoney(k.opp_value) + ' − ' + fmtMoney(k.now_value) +
      ' = <b>' + fmtMoney(gap) + ' a month</b> of modeled upside</div>' +
      '</div>';
  }

  function gapOf(k) {
    return Math.max(0, (Number(k.opp_value) || 0) - (Number(k.now_value) || 0));
  }

  function render(data) {
    var kws = data.keywords || [];
    var totalCount = Math.max(0, Number(data.total) || kws.length);
    if (!kws.length) {
      out.innerHTML =
        '<p class="res-badge no">Not a fit</p>' +
        '<h2 class="step-h">No boost fits for ' + escHtml(data.domain) + '.</h2>' +
        '<p class="res-sub">Nothing ranking in positions 1 to 50 with real search volume today. ' +
        'This one needs foundational SEO before a boost would do anything.</p>';
      return;
    }
    var total = data.opp_value || kws.reduce(function (s, k) { return s + gapOf(k); }, 0);
    var cards = kws.map(function (k, i) {
      var open = i === 0;
      return '<div class="opp-card' + (open ? " first" : "") + '">' +
        '<div class="opp-toggle' + (open ? " opp-open" : "") + '" role="button" tabindex="0">' +
        '<div class="opp-kw">' + escHtml(k.keyword) + '</div>' +
        (k.url ? '<div class="opp-url">' + escHtml(displayUrl(k.url)) + '</div>' : '') +
        statPair(k) +
        '<div class="opp-val">' + fmtMoney(gapOf(k)) +
        '<small>/mo left on the table <span class="opp-caret">▸ math</span></small></div>' +
        '</div>' + mathTable(k, open) +
        '</div>';
    }).join("");

    out.innerHTML =
      '<p class="res-badge">✓ ' + escHtml(data.domain) + ' qualifies</p>' +
      '<p class="res-sub"><strong>' + totalCount + ' keywords</strong> stuck in positions 1 to 50. ' +
      'Their strongest money keywords:</p>' +
      '<div class="opp-list">' +
      '<div class="opp-total">' +
      '<div class="opp-total-lbl">Estimated opportunity they’re missing</div>' +
      '<div class="opp-total-num">' + fmtMoney(total) + '<small>/month</small></div>' +
      '<div class="opp-total-sub">across ' + kws.length + ' money keyword' + (kws.length === 1 ? '' : 's') +
      ' · tap any keyword to open or close its math</div>' +
      '</div>' + cards + '</div>';

    out.querySelectorAll(".opp-toggle").forEach(function (row) {
      row.addEventListener("click", function () {
        var math = row.parentNode.querySelector(".opp-math");
        if (!math) return;
        math.hidden = !math.hidden;
        row.classList.toggle("opp-open", !math.hidden);
      });
    });
  }

  // Past lookups on this endpoint, so the agency can see what they already
  // checked without re-running (and re-billing) a search.
  function loadHistory(code) {
    fetch("api/partner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, action: "history" })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var rows = d.lookups || [];
        histWrap.hidden = false;
        if (!rows.length) {
          histList.innerHTML = '<p class="pt-empty">No lookups yet.</p>';
          return;
        }
        histList.innerHTML = rows.map(function (r) {
          var when = "";
          try {
            // D1 stamps UTC without a zone marker; make it explicit.
            var d2 = new Date((r.at || "").replace(" ", "T") + "Z");
            when = isNaN(d2) ? (r.at || "") : d2.toLocaleString(undefined, {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
            });
          } catch (e) { when = r.at || ""; }
          var value = r.qualified
            ? '<span class="pt-val">' + fmtMoney(r.opp_value) + '/mo</span>'
            : '<span class="pt-no">no fit</span>';
          return '<div class="pt-row">' +
            '<span class="pt-dom">' + escHtml(r.domain) +
            '<span>' + (r.qualified ? escHtml(r.total) + ' keywords in 1 to 50' : 'nothing in 1 to 50') + '</span></span>' +
            value +
            '<span class="pt-when">' + escHtml(when) + '</span>' +
            '</div>';
        }).join("");
      })
      .catch(function () { /* history is a nicety, never block the tool */ });
  }

  // If the code is already saved, show their history straight away.
  if (codeEl.value) loadHistory(codeEl.value);

  var MESSAGES = {
    forbidden: "Wrong access code.",
    invalid_domain: "That doesn't look like a website address.",
    rate_limited: "Too many lookups this hour. Try again shortly.",
    not_configured: "Lookup tool is not configured yet. Ping Bilal.",
    check_failed: "The ranking provider didn't respond. Try again."
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    var code = codeEl.value.trim();
    var website = document.getElementById("pt-url").value.trim();
    if (!code || !website) return;

    btn.disabled = true;
    btn.textContent = "Checking…";
    out.innerHTML =
      '<div class="res-loading"><i class="res-spin" aria-hidden="true"></i>' +
      '<h2 class="step-h">Checking ' + escHtml(website) + ' …</h2>' +
      '<p class="res-sub">Pulling live Google rankings.</p></div>';

    fetch("api/partner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, website_url: website })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = "Check rankings";
        if (!res.ok || (res.data && res.data.error)) {
          out.innerHTML = "";
          err.textContent = MESSAGES[res.data && res.data.error] || "Something went wrong.";
          return;
        }
        try {
          sessionStorage.setItem("tsd_partner_code", code);
        } catch (e2) { /* private mode */ }
        render(res.data);
        loadHistory(code);
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Check rankings";
        out.innerHTML = "";
        err.textContent = "Couldn't reach the lookup service.";
      });
  });
})();
