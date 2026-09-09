// Shared results and booking popup for both qualification outcomes.
(function () {
  var form = document.getElementById("qualify-form");
  if (!form) return;
  var progress = document.getElementById("inline-progress");
  var progressBar = document.getElementById("inline-progress-bar");
  var tracker = document.getElementById("inline-track");
  var results = document.getElementById("inline-results");
  var booking = document.getElementById("inline-booking");
  var toggle = document.getElementById("qualify-form-toggle");
  var dialog = document.getElementById("boost-dialog");
  var resume = document.getElementById("boost-resume");
  var pageY = 0;
  function openPopup() {
    if (dialog.open) return;
    pageY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = -pageY + "px";
    document.body.style.width = "100%";
    dialog.showModal();
  }
  dialog.addEventListener("close", function () {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    window.scrollTo(0, pageY);
    if (!resume.hidden) resume.focus({ preventScroll: true });
  });
  document.getElementById("boost-close").onclick = function () { dialog.close(); };
  // Dismiss only if both ends of a pointer gesture are on the backdrop.
  var backdropDown = false;
  function outside(event) {
    var rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }
  dialog.addEventListener("pointerdown", function (event) { backdropDown = outside(event); });
  dialog.addEventListener("pointerup", function (event) {
    if (backdropDown && outside(event)) dialog.close();
    backdropDown = false;
  });
  resume.onclick = openPopup;
  var busy = false;
  var mountedToken = null;
  var keys = ["tsd_rb_payload", "tsd_rb_result", "tsd_rb_pending_track", "tsd_rb_booking_started", "tsd_rb_lead_token", "tsd_rb_website_booking"];

  function scroll() {
    if (dialog.open) dialog.scrollTop = 0;
    else form.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function step(number) {
    progress.hidden = number === 1;
    resume.hidden = number === 1;
    if (number === 1) dialog.close();
    else openPopup();
    document.getElementById("boost-step").textContent = "STEP " + number + " OF 3";
    var completed = number === 3 || flow.rankingsReady ? 2 : 1;
    progressBar.style.setProperty("--progress", (completed / 3 * 100) + "%");
    progressBar.setAttribute("aria-valuenow", String(completed));
    progressBar.setAttribute("aria-valuetext", completed === 2 ? (flow.lead && flow.lead.offer === "website" ? "Your next step is ready. Book your consultation to finish." : "Your rankings are ready. Book your call to finish.") : "Your details are submitted. Checking your rankings.");
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
    setOffer: function (offer) {
      var website = offer === "website";
      dialog.setAttribute("aria-label", website ? "Your website consultation" : "Your Rank Boost results");
      resume.textContent = website ? "Continue my website consultation" : "View my Rank Boost results";
      tracker.querySelectorAll("li > span:last-child")[1].textContent = website ? "Your next step" : "Your rankings";
      tracker.querySelectorAll("li > span:last-child")[2].textContent = website ? "Website consultation" : "Book your call";
      results.querySelector(".inline-eyebrow").textContent = website ? "Step 2 of 3 · Your next step" : "Step 2 of 3 · Your rankings";
      document.getElementById("booking-heading").textContent = website ? "Book your free website consultation" : "Book Your Call";
      booking.querySelector(".res-sub").textContent = website ? "Choose 30 minutes with Bilal to review your site, explore a custom rebuild and discuss the scope and fixed price. Your details are already filled in." : "Choose a free 30-minute call with Bilal. We’ll review your keywords, pick the right opportunity, and plan your free boost together.";
      booking.querySelector(".res-note").textContent = website ? "No pressure, no obligation and no preparation needed." : "No credit card, no contract, no site access needed.";
      document.getElementById("inline-back-results").textContent = website ? "Back to your website plan" : "Back to your rankings";
      progressBar.setAttribute("aria-label", website ? "Website consultation progress" : "Free boost progress");
    },
    start: function (payload, cached, restoring) {
      if (busy) return;
      busy = true;
      mountedToken = null;
      flow.setOffer("boost");
      if (flow.clearBooking) flow.clearBooking();
      document.getElementById("website-confirmation").hidden = true;
      document.getElementById("booking-content").hidden = false;
      flow.lead = payload;
      flow.rankingsReady = false;
      if (!restoring) clearSession();
      try { sessionStorage.setItem("tsd_rb_payload", JSON.stringify(payload)); } catch (e) {}
      step(2);
      Promise.resolve(flow.check(payload, cached)).finally(function () { busy = false; });
    },
    book: function () {
      if (!flow.lead || !flow.lead.lead_token || (flow.lead.booking_eligible !== true && flow.lead.website_eligible !== true)) return;
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
      flow.setOffer("boost");
      if (flow.clearBooking) flow.clearBooking();
      flow.lead = null;
      flow.rankingsReady = false;
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
