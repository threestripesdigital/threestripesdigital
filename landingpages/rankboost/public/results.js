// Shared rank-check results for the inline funnel and existing results route.
// Cache completed answers and reuse the submission event ID on refresh.
(function () {
  var PAYLOAD_KEY = "tsd_rb_payload";
  var RESULT_KEY = "tsd_rb_result";
  var TRACK_KEY = "tsd_rb_pending_track";
  var CALENDLY_URL = "https://calendly.com/bilal-threestripesdigital/three-stripes-digital-rank-boost";
  var STEP1 = "./#qualify";

  var inline = Boolean(window.rankBoostFlow);
  var resultEl = document.getElementById("step-result");
  var lastLead = null;

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

  function calendlyLink() {
    if (!lastLead) return CALENDLY_URL;
    var params = [];
    if (lastLead.name) params.push("name=" + encodeURIComponent(lastLead.name));
    if (lastLead.email) params.push("email=" + encodeURIComponent(lastLead.email));
    if (lastLead.phone) params.push("a1=" + encodeURIComponent(lastLead.phone));
    if (lastLead.domain) params.push("a2=" + encodeURIComponent(lastLead.domain));
    return params.length ? CALENDLY_URL + "?" + params.join("&") : CALENDLY_URL;
  }

  function show(html) {
    resultEl.innerHTML = inline ? html.replace(/<h1\b/g, "<h2").replace(/<\/h1>/g, "</h2>") : html;
    var heading = resultEl.querySelector("h1, h2, h3");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    if (inline) window.rankBoostFlow.scroll();
    else window.scrollTo(0, 0);
  }

  // Rank tiers: top 5 white, 6-10 amber, outside the top 10 red.
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
    var nowLeads = fmtCount(k.now_leads);
    var oneLeads = fmtCount(k.opp_leads);
    var nowCases = fmtCount(k.now_cases);
    var oneCases = fmtCount(k.opp_cases);
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
        "Illustrative assumption: 10% of organic visitors inquire. Your conversion rate may differ.",
        nowVisits + " × 10% inquire = " + nowLeads, oneVisits + " × 10% inquire = " + oneLeads) +
      row("Signed cases a month",
        "Illustrative assumption: 20% of inquiries become clients. Your close rate may differ.",
        nowLeads + " × 20% close = " + nowCases, oneLeads + " × 20% close = " + oneCases) +
      row("Fees a month",
        cv + " is a planning assumption for this practice area, not a forecast of your fees.",
        nowCases + " × " + cv + " = " + fmtMoney(k.now_value),
        oneCases + " × " + cv + " = " + fmtMoney(k.opp_value), true) +
      '</div>' +
      '<div class="opp-diff">' + fmtMoney(k.opp_value) + ' − ' + fmtMoney(k.now_value) +
      ' = <b>' + fmtMoney(gap) + ' a month</b> of modeled upside at these assumptions</div>' +
      '</div>';
  }

  // Booking lives on step 3. Both CTAs on this page point there, so the next
  // action is unmistakable from the top of the page and again at the bottom.
  function ctaBlock(hero) {
    return '<div class="step-cta-wrap' + (hero ? " hero" : "") + '">' +
      '<a class="step-cta" href="book">Step 3: Book Your Call ' +
      '<span aria-hidden="true">→</span></a>' +
      '<p class="step-cta-note">Step 3 of 3 · 30-minute call · ' +
      'Choose a time to review your keywords and start your free boost.</p>' +
      '</div>';
  }

  // Every keyword card collapses, including the first one, which merely
  // starts open.
  function wireToggles() {
    resultEl.querySelectorAll(".opp-toggle").forEach(function (row) {
      row.addEventListener("click", function () {
        var math = row.parentNode.querySelector(".opp-math");
        if (!math) return;
        math.hidden = !math.hidden;
        row.classList.toggle("opp-open", !math.hidden);
        row.setAttribute("aria-expanded", String(!math.hidden));
      });
      row.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        row.click();
      });
    });
  }

  function renderFit(data) {
    var kws = data.keywords || [];
    function gapOf(k) {
      return Math.max(0, (Number(k.opp_value) || 0) - (Number(k.now_value) || 0));
    }
    var total = kws.reduce(function (s, k) { return s + gapOf(k); }, 0);
    var cards = kws.map(function (k, i) {
      var open = i === 0;
      return '<div class="opp-card' + (open ? " first" : "") + '">' +
        '<div class="opp-toggle' + (open ? " opp-open" : "") + '" role="button" tabindex="0" aria-expanded="' + String(open) + '">' +
        '<div class="opp-kw">' + escHtml(k.keyword) + '</div>' +
        (k.url ? '<div class="opp-url">' + escHtml(displayUrl(k.url)) + '</div>' : '') +
        statPair(k) +
        '<div class="opp-val">' + fmtMoney(gapOf(k)) +
        '<small>/mo modeled upside <span class="opp-caret">▸ assumptions</span></small></div>' +
        '</div>' + mathTable(k, open) +
        '</div>';
    }).join("");
    var totalTxt = data.total > 1 ? data.total + " keywords" : "1 keyword";
    show(
      '<p class="res-badge">✓ Boost fits found</p>' +
      '<h1 class="step-h">' + escHtml(data.domain) + ' qualifies.</h1>' +
      '<p class="res-sub">We found <strong>' + totalTxt + '</strong> stuck in positions 11–50. ' +
      'These are real searches where you currently rank below page one. Here is an illustrative opportunity model:</p>' +
      ctaBlock(true) +
      '<div class="opp-list">' +
      '<div class="opp-total">' +
      '<div class="opp-total-lbl">Illustrative monthly opportunity at #1</div>' +
      '<div class="opp-total-num">' + fmtMoney(total) + '<small>/month</small></div>' +
      '<div class="opp-total-sub">across ' + kws.length + ' money keyword' + (kws.length === 1 ? '' : 's') +
      ' stuck on pages 2–5 · estimates use stated assumptions, not guaranteed outcomes</div>' +
      '</div>' +
      cards + '</div>' +
      ctaBlock(false)
    );
    wireToggles();
    mountStickyCta(total);
  }

  // On phones the page is long, so the booking CTA follows them down as a
  // bottom bar once the in-page hero CTA has scrolled away.
  // Named opp-sticky, not sticky-cta: the sales page already owns that id.
  function mountStickyCta(total) {
    if (inline || document.getElementById("opp-sticky")) return;
    var bar = document.createElement("div");
    bar.id = "opp-sticky";
    bar.className = "opp-sticky";
    bar.innerHTML =
      '<div class="opp-sticky-inner">' +
      '<div class="opp-sticky-copy"><b>' + fmtMoney(total) + '/mo</b><span>on the table</span></div>' +
      '<a class="opp-sticky-btn" href="book">Book the call <span aria-hidden="true">→</span></a>' +
      '</div>';
    document.body.appendChild(bar);

    var heroCta = resultEl.querySelector(".step-cta-wrap.hero");
    if (!heroCta || !("IntersectionObserver" in window)) {
      bar.classList.add("is-visible");
      return;
    }
    // Show the bar only while the hero CTA is off screen.
    new IntersectionObserver(function (entries) {
      bar.classList.toggle("is-visible", !entries[0].isIntersecting);
    }, { rootMargin: "-10px 0px 0px 0px" }).observe(heroCta);
  }

  function renderNoFit(data) {
    show(
      '<p class="res-badge no">Not a fit, for now</p>' +
      '<h1 class="step-h">No boost fits found for ' + escHtml(data.domain) + '.</h1>' +
      '<p class="res-sub">The free boost needs keywords already ranking in positions 11–50 with real ' +
      'search volume, and we didn’t find any today. That usually means the site needs foundational SEO ' +
      'before a boost makes sense. Straight answer, no sales call.</p>' +
      '<p class="res-note"><a class="step-back" href="' + STEP1 + '">Check a different website</a></p>'
    );
  }

  // A saved but failed/rate-limited check must not open booking. The booking
  // route is reserved for a positively verified qualification result.
  function renderFallback(data) {
    var message = data && data.error === "rate_limited"
      ? "This browser has reached the ranking-check limit. Your details were saved; please try again later."
      : data && data.error === "capacity_limited"
        ? "Today’s ranking-check capacity has been reached. Your details were saved; please try again later."
        : "Your details were saved, but we couldn’t verify qualification. Booking stays closed until the check succeeds.";
    show(
      '<h1 class="step-h">We couldn’t verify your ranking check.</h1>' +
      '<p class="res-sub">' + escHtml(message) + '</p>' +
      '<p class="res-note"><a class="step-back" href="' + STEP1 + '">Return to the form</a></p>'
    );
  }

  function renderSubmissionError() {
    show(
      '<h1 class="step-h">We couldn’t complete your ranking check.</h1>' +
      '<p class="res-sub">Your info was not saved. Please go back and try again.</p>' +
      '<p class="res-note"><a class="step-back" href="' + STEP1 + '">Go back and try again</a></p>'
    );
  }

  function renderResult(res) {
    if (res.data && res.data.lead_token && payload) {
      payload.lead_token = res.data.lead_token;
      payload.booking_eligible = Boolean(
        res.ok && res.data.qualified === true
      );
      try { sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(payload)); } catch (e) {}
    }
    if (inline && payload) {
      window.rankBoostFlow.lead = payload;
      var progressBar = document.getElementById("inline-progress-bar");
      window.rankBoostFlow.rankingsReady = Boolean(res.ok && res.data && res.data.qualified === true);
      if (window.rankBoostFlow.rankingsReady) {
        progressBar.style.setProperty("--progress", "66.6667%");
        progressBar.setAttribute("aria-valuenow", "2");
        progressBar.setAttribute("aria-valuetext", "Your rankings are ready. Book your call to finish.");
      } else {
        progressBar.setAttribute("aria-valuetext", "Ranking check finished. Review the result below.");
      }
    }
    if (res.ok && res.data && res.data.qualified === true) renderFit(res.data);
    else if (res.ok && res.data && res.data.qualified === false) renderNoFit(res.data);
    else if (
      res.data && res.data.lead_token &&
      ["check_failed", "not_configured", "rate_limited", "capacity_limited", "invalid_email"].indexOf(res.data.error) !== -1
    ) renderFallback(res.data);
    else renderSubmissionError();
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function requestCheck(attempt) {
    return fetch("api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json()
          .catch(function () { return { error: "invalid_response" }; })
          .then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
      })
      .then(function (res) {
        var processing = res.status === 409 && res.data && res.data.error === "processing";
        var storageRetry = res.status === 503 && res.data &&
          (res.data.error === "storage_unavailable" || res.data.error === "processor_unavailable");
        if ((processing || storageRetry) && attempt < 6) {
          var hinted = Number(res.data && res.data.retry_after_ms) || 1000;
          return wait(Math.max(500, Math.min(hinted, 2500)))
            .then(function () { return requestCheck(attempt + 1); });
        }
        return res;
      })
      .catch(function (error) {
        if (attempt >= 2) throw error;
        return wait(750 * (attempt + 1))
          .then(function () { return requestCheck(attempt + 1); });
      });
  }

  function sendPendingTrack(track) {
    return fetch("api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(track)
    }).then(function (response) {
      if (!response.ok) return;
      try { sessionStorage.removeItem(TRACK_KEY); } catch (e) {}
    }).catch(function () { /* book.js retries the durable event */ });
  }

  // Count a booking start only when a qualified visitor actually clicks from
  // their results into the calendar. The API validates the signed lead token
  // and deduplicates replays before sending its matching CAPI event.
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".step-cta, .opp-sticky-btn");
    if (inline && event.target.closest && event.target.closest("#step-result .step-back")) {
      event.preventDefault();
      window.rankBoostFlow.reset();
      return;
    }
    if (!link || !payload || !payload.lead_token) return;
    if (inline) {
      event.preventDefault();
      if (!payload.booking_eligible) return;
      window.rankBoostFlow.book();
    }
    var onceKey = "tsd_rb_booking_started";
    if (inline && payload.booking_started) return;
    if (inline) payload.booking_started = true;
    var pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(TRACK_KEY) || "null");
      if (pending && pending.lead_token !== payload.lead_token) {
        sessionStorage.removeItem(TRACK_KEY);
        sessionStorage.removeItem(onceKey);
        pending = null;
      }
      if (sessionStorage.getItem(onceKey) && !pending) return;
      sessionStorage.setItem(onceKey, "1");
    } catch (e) { /* server still deduplicates */ }

    if (!pending) {
      var eventId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "bs-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      if (window.tsdMetaTrackingEnabled === true && window.fbq) {
        fbq("trackCustom", "BookingStarted", { content_name: "rank-boost-call" }, { eventID: eventId });
      }
      pending = {
        event_name: "BookingStarted",
        event_id: eventId,
        lead_token: payload.lead_token,
        fbp: payload.fbp || "",
        fbc: payload.fbc || "",
        external_id: payload.external_id || "",
        page_url: location.href
      };
      try { sessionStorage.setItem(TRACK_KEY, JSON.stringify(pending)); } catch (e) {}
    }
    sendPendingTrack(pending);
  });

  var payload = null;
  function startCheck(nextPayload, cached) {
    payload = nextPayload;
    lastLead = { name: payload.name, phone: payload.phone, email: payload.email, domain: payload.domain };
    if (cached) { renderResult(cached); return; }
    show(
      '<div class="res-loading"><i class="res-spin" aria-hidden="true"></i>' +
      '<h1 class="step-h">Checking your current rankings...</h1>' +
      '<p class="res-sub">Give us a few seconds. We’re checking ' + escHtml(payload.domain) +
      ' for keywords that could fit your free boost.</p>' +
      '<p class="res-note">Looking for relevant searches and rankings in positions 11 to 50.</p></div>'
    );
    resultEl.setAttribute("aria-busy", "true");
    var slow = setTimeout(function () {
      var note = resultEl.querySelector(".res-note");
      if (note) note.textContent = "Still checking. Some websites take a little longer. You can stay right here.";
    }, 12000);
    return requestCheck(0).then(function (res) {
      if (window.tsdMetaTrackingEnabled === true && window.fbq &&
          res.data && res.data.lead_token && res.data.error !== "rate_limited") {
        fbq("track", "Lead", { content_name: "rank-check" }, { eventID: payload.event_id });
        if (res.ok && res.data.qualified === true) {
          fbq("trackCustom", "QualifiedLead", { content_name: "rank-check" }, { eventID: payload.event_id + "-q" });
        }
      }
      if (res.ok && res.data && typeof res.data.qualified === "boolean") {
        try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(res)); } catch (e) {}
      }
      renderResult(res);
    }).catch(renderSubmissionError).finally(function () {
      clearTimeout(slow);
      resultEl.removeAttribute("aria-busy");
    });
  }
  if (inline) {
    window.rankBoostFlow.check = startCheck;
    return;
  }
  var cached = null;
  try {
    payload = JSON.parse(sessionStorage.getItem(PAYLOAD_KEY) || "null");
    cached = JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null");
  } catch (e) {}
  if (!payload) { window.location.replace(STEP1); return; }
  startCheck(payload, cached);
})();
