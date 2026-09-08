// Funnel step 3: book the call. Prefills Calendly from the lead captured on
// step 1 and hands off to the thank-you page (which fires the Schedule pixel
// event) once Calendly reports a completed booking.
(function () {
  var inline = Boolean(window.rankBoostFlow);
  var removeBookingListener = function () {};
  function startBooking(inlineLead) {
    removeBookingListener();
    var PAYLOAD_KEY = "tsd_rb_payload";
    var RESULT_KEY = "tsd_rb_result";
    var TRACK_KEY = "tsd_rb_pending_track";
    var TOKEN_KEY = "tsd_rb_lead_token";
    var CALENDLY_URL = "https://calendly.com/bilal-threestripesdigital/three-stripes-digital-rank-boost";
    var STEP1 = "./#qualify";

    var lead = null;
    try {
      lead = JSON.parse(sessionStorage.getItem(PAYLOAD_KEY) || "null");
    } catch (e) { /* treat as absent */ }
    if (inlineLead) lead = inlineLead;
    var queryToken = new URLSearchParams(location.search).get("lead_token") || "";
    if (queryToken && !inline) {
      lead = { lead_token: queryToken, booking_eligible: true };
    }
    if (!lead || !lead.lead_token || lead.booking_eligible !== true) {
      if (inline) window.rankBoostFlow.reset();
      else window.location.replace(STEP1);
      return;
    }
    var tokenStored = false;
    if (lead && lead.lead_token) {
      try {
        sessionStorage.setItem(TOKEN_KEY, lead.lead_token);
        tokenStored = true;
      } catch (e) { /* append the signed token to the redirect instead */ }
    }

    function retryPendingTrack() {
      var pending = null;
      try { pending = JSON.parse(sessionStorage.getItem(TRACK_KEY) || "null"); } catch (e) {}
      if (!pending) return;
      fetch("api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(pending)
      }).then(function (response) {
        if (!response.ok) return;
        try { sessionStorage.removeItem(TRACK_KEY); } catch (e) {}
      }).catch(function () { /* a later page visit can retry the same event */ });
    }

    function calendlyLink() {
      var params = [];
      if (lead.name) params.push("name=" + encodeURIComponent(lead.name));
      if (lead.email) params.push("email=" + encodeURIComponent(lead.email));
      if (lead.phone) params.push("a1=" + encodeURIComponent(lead.phone));
      if (lead.domain) params.push("a2=" + encodeURIComponent(lead.domain));
      if (lead.lead_token) params.push("utm_content=" + encodeURIComponent(lead.lead_token));
      return params.length ? CALENDLY_URL + "?" + params.join("&") : CALENDLY_URL;
    }

    var fallback = document.getElementById("calendly-fallback");
    if (fallback) {
      fallback.removeAttribute("href");
      fallback.setAttribute("aria-disabled", "true");
    }

    var back = document.getElementById("step-back-link");
    if (back) back.href = STEP1;

    function isCurrent() { return !inline || window.rankBoostFlow.lead === lead; }

    function mountCalendly() {
      if (!isCurrent()) return;
      var host = document.getElementById("calendly-embed");
      if (!host) return;
      var url = calendlyLink();
      if (fallback) {
        fallback.href = url;
        fallback.removeAttribute("aria-disabled");
      }
      function init() {
        if (!isCurrent()) return;
        host.innerHTML = "";
        window.Calendly.initInlineWidget({ url: url, parentElement: host });
      }
      if (window.Calendly && window.Calendly.initInlineWidget) { init(); return; }
      var s = document.createElement("script");
      s.src = "https://assets.calendly.com/assets/external/widget.js";
      s.onload = init;
      s.onerror = function () {
        host.innerHTML = '<p class="res-note">The calendar could not load. Use the booking link below, or return to your rankings and try again.</p>';
      };
      document.head.appendChild(s);
    }

    function showAccessError() {
      if (!isCurrent()) return;
      var host = document.getElementById("calendly-embed");
      if (!host) return;
      host.innerHTML = "";
      var message = document.createElement("p");
      message.setAttribute("role", "status");
      message.textContent = "We couldn’t verify booking access. Check your connection and try again.";
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-ghost";
      retry.textContent = "Try again";
      retry.addEventListener("click", verifyAccess);
      host.appendChild(message);
      host.appendChild(retry);
    }

    function verifyAccess() {
      fetch("api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "access", token: lead.lead_token })
      }).then(function (response) {
        if (!isCurrent()) return null;
        if (response.ok) return response.json();
        if (response.status === 401 || response.status === 403) {
          if (inline) window.rankBoostFlow.reset();
          else window.location.replace(STEP1);
          return null;
        }
        throw new Error("access_unavailable");
      }).then(function (data) {
        if (data && data.eligible) mountCalendly();
        else if (data) showAccessError();
      }).catch(showAccessError);
    }

    function onBookingMessage(e) {
      if (!isCurrent() || e.origin !== "https://calendly.com") return;
      if (e.data && e.data.event === "calendly.event_scheduled") {
        var inviteeUri = (e.data.payload && e.data.payload.invitee && e.data.payload.invitee.uri) || "";
        var eventUri = (e.data.payload && e.data.payload.event && e.data.payload.event.uri) || "";
        var uuid = inviteeUri.split("/").pop();
        var eventId = eventUri.split("/").pop();
        if (!uuid || !eventId) return;
        var params = [];
        if (uuid) params.push("invitee_uuid=" + encodeURIComponent(uuid));
        if (eventId) params.push("booking=" + encodeURIComponent(eventId));
        if (lead && lead.lead_token && !tokenStored) {
          params.push("lead_token=" + encodeURIComponent(lead.lead_token));
        }
        // The funnel is finished; clear the session so a later visit starts clean.
        try {
          sessionStorage.removeItem(PAYLOAD_KEY);
          sessionStorage.removeItem(RESULT_KEY);
        } catch (err) {}
        window.location.href = "thank-you" + (params.length ? "?" + params.join("&") : "");
      }
    }
    window.addEventListener("message", onBookingMessage);
    removeBookingListener = function () { window.removeEventListener("message", onBookingMessage); };

    retryPendingTrack();
    verifyAccess();
  }
  if (inline) {
    window.rankBoostFlow.mountBooking = startBooking;
    window.rankBoostFlow.clearBooking = function () { removeBookingListener(); };
  }
  else startBooking();
})();
