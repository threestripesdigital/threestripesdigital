// One continuous qualification, results, and booking section.
(function () {
  var form = document.getElementById("qualify-form");
  if (!form) return;
  var tracker = document.getElementById("inline-track");
  var results = document.getElementById("inline-results");
  var booking = document.getElementById("inline-booking");
  var toggle = document.getElementById("qualify-form-toggle");
  var busy = false;
  var mountedToken = null;
  var keys = ["tsd_rb_payload", "tsd_rb_result", "tsd_rb_pending_track", "tsd_rb_booking_started", "tsd_rb_lead_token"];

  function scroll() {
    tracker.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function step(number) {
    tracker.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute("aria-expanded", "true");
    form.hidden = number !== 1;
    results.hidden = number !== 2;
    booking.hidden = number !== 3;
    tracker.querySelectorAll("li").forEach(function (item, index) {
      item.classList.toggle("current", index + 1 === number);
      item.classList.toggle("done", index + 1 < number);
      if (index + 1 === number) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      item.querySelector(".dot").textContent = index + 1 < number ? "✓" : String(index + 1);
    });
    if (window.rankBoostAnalytics && flow.lead && flow.lead.lead_token) {
      window.rankBoostAnalytics.track("link", { lead_token: flow.lead.lead_token });
    }
  }
  function clearSession() {
    try { keys.forEach(function (key) { sessionStorage.removeItem(key); }); } catch (e) {}
  }
  var flow = window.rankBoostFlow = {
    lead: null,
    scroll: scroll,
    start: function (payload, cached, restoring) {
      if (busy) return;
      busy = true;
      mountedToken = null;
      flow.lead = payload;
      if (!restoring) clearSession();
      try { sessionStorage.setItem("tsd_rb_payload", JSON.stringify(payload)); } catch (e) {}
      step(2);
      Promise.resolve(flow.check(payload, cached)).finally(function () { busy = false; });
    },
    book: function () {
      if (!flow.lead || !flow.lead.lead_token || flow.lead.booking_eligible !== true) return;
      step(3);
      scroll();
      document.getElementById("booking-heading").focus({ preventScroll: true });
      if (mountedToken !== flow.lead.lead_token) {
        mountedToken = flow.lead.lead_token;
        flow.mountBooking(flow.lead);
      }
    },
    reset: function () {
      if (busy) return;
      clearSession();
      if (flow.clearBooking) flow.clearBooking();
      flow.lead = null;
      mountedToken = null;
      step(1);
      scroll();
      document.getElementById("website_url").focus({ preventScroll: true });
    }
  };
  document.getElementById("inline-back-results").addEventListener("click", function () {
    step(2);
    scroll();
    var heading = results.querySelector("h1, h2, h3");
    if (heading) heading.focus({ preventScroll: true });
  });
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var payload = JSON.parse(sessionStorage.getItem("tsd_rb_payload") || "null");
      var cached = JSON.parse(sessionStorage.getItem("tsd_rb_result") || "null");
      if (payload && payload.event_id && payload.domain) flow.start(payload, cached, true);
    } catch (e) { /* A fresh form also works when browser storage is unavailable. */ }
  });
})();
