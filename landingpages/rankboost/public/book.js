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
    var website = Boolean(lead && lead.offer === "website" && lead.website_eligible === true);
    if (website && !inline) { window.location.replace(STEP1); return; }
    if (!lead || !lead.lead_token || (lead.booking_eligible !== true && !website)) {
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
      if (website) {
        if (lead.domain) params.push("a1=" + encodeURIComponent("Website: https://" + lead.domain));
      } else {
        if (lead.phone) params.push("a1=" + encodeURIComponent(lead.phone));
        if (lead.domain) params.push("a2=" + encodeURIComponent(lead.domain));
      }
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
        body: JSON.stringify({ action: "access", token: lead.lead_token, offer: website ? "website" : "boost" })
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
        if (data && data.eligible) {
          if (website) {
            if (!data.booking_url || !data.booking_url.startsWith("https://calendly.com/")) throw new Error("calendar_unavailable");
            CALENDLY_URL = data.booking_url;
          }
          mountCalendly();
        }
        else if (data) showAccessError();
      }).catch(showAccessError);
    }

    var verificationTimer = null;
    var verificationActive = false;
    var trackedInvitees = new Set();
    function verifyWebsiteBooking(invitee, event, attempt) {
      if (!isCurrent() || (verificationActive && attempt === 0)) return;
      verificationActive = true;
      var panel = document.getElementById("website-confirmation");
      document.getElementById("booking-content").hidden = true;
      panel.hidden = false;
      if (attempt === 0) panel.innerHTML = '<h2 class="step-h" tabindex="-1">Confirming your website consultation...</h2><p class="res-sub">We are checking your booking details. This can take a few seconds.</p>';
      fetch("api/booking", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: lead.lead_token, offer: "website", invitee: invitee, event: event })
      }).then(function (response) { return response.json(); }).then(function (data) {
        if (!isCurrent()) return;
        if (!data.verified || data.offer !== "website") throw new Error("pending");
        verificationActive = false;
        panel.innerHTML = '<p class="res-badge">Website consultation booked</p><h2 class="step-h" tabindex="-1">Thanks. Your website consultation is confirmed.</h2>' +
          '<p class="res-sub" id="website-meeting-time"></p><div class="downsell-reason"><h3>What happens next</h3><p>Check your inbox for your calendar invitation and accept it. Bilal will review your website before the call.</p><p>On the call, you will review the foundations, discuss your options and cover scope and pricing together. No preparation needed.</p></div><p class="res-note">Questions? <a href="mailto:bilal@threestripesdigital.com">Email Bilal</a>.</p>';
        document.getElementById("website-meeting-time").textContent = new Date(data.start).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) + " (your local time).";
        panel.querySelector("h2").focus({ preventScroll: true });
        var bar = document.getElementById("inline-progress-bar");
        bar.style.setProperty("--progress", "100%"); bar.setAttribute("aria-valuenow", "3"); bar.setAttribute("aria-valuetext", "Your website consultation is confirmed.");
        document.querySelectorAll("#inline-track li").forEach(function (li) { li.classList.add("done"); li.classList.remove("current"); li.removeAttribute("aria-current"); li.querySelector(".dot").textContent = "✓"; });
        var id = "websiteconsultationbooked-" + invitee.split("/").pop();
        var alreadyTracked = trackedInvitees.has(id);
        try { alreadyTracked = alreadyTracked || sessionStorage.getItem(id) === "1"; } catch (err) {}
        if (!alreadyTracked) {
          if (window.tsdMetaTrackingEnabled && window.fbq) window.fbq("trackCustom", "WebsiteConsultationBooked", { content_name: "website-consultation" }, { eventID: id });
          if (window.gtag) window.gtag("event", "website_consultation_booked", { event_id: id });
          trackedInvitees.add(id);
          try { sessionStorage.setItem(id, "1"); } catch (err) {}
        }
      }).catch(function () {
        if (!isCurrent()) return;
        if (attempt < 8) { verificationTimer = setTimeout(function () { verifyWebsiteBooking(invitee, event, attempt + 1); }, 1500); return; }
        verificationActive = false;
        panel.innerHTML = '<h2 class="step-h">Check your calendar invitation.</h2><p class="res-sub">Your booking is still syncing. Check your inbox for Calendly’s confirmation before booking again.</p><button class="btn btn-primary" type="button">Check confirmation again</button>';
        panel.querySelector("button").addEventListener("click", function () { verifyWebsiteBooking(invitee, event, 0); });
      });
    }

    function onBookingMessage(e) {
      if (!isCurrent() || e.origin !== "https://calendly.com") return;
      var frame = document.querySelector("#calendly-embed iframe");
      if (!frame || e.source !== frame.contentWindow) return;
      if (e.data && e.data.event === "calendly.event_scheduled") {
        var inviteeUri = (e.data.payload && e.data.payload.invitee && e.data.payload.invitee.uri) || "";
        var eventUri = (e.data.payload && e.data.payload.event && e.data.payload.event.uri) || "";
        var uuid = inviteeUri.split("/").pop();
        var eventId = eventUri.split("/").pop();
        if (!uuid || !eventId) return;
        if (website) {
          try { sessionStorage.setItem("tsd_rb_website_booking", JSON.stringify({ token: lead.lead_token, invitee: inviteeUri, event: eventUri })); } catch (err) {}
          verifyWebsiteBooking(inviteeUri, eventUri, 0);
          return;
        }
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
    removeBookingListener = function () { window.removeEventListener("message", onBookingMessage); clearTimeout(verificationTimer); verificationActive = false; document.getElementById("calendly-embed").innerHTML = ""; };

    if (!website) retryPendingTrack();
    var savedBooking = null;
    try { savedBooking = JSON.parse(sessionStorage.getItem("tsd_rb_website_booking") || "null"); } catch (err) {}
    if (website && savedBooking && savedBooking.token === lead.lead_token) verifyWebsiteBooking(savedBooking.invitee, savedBooking.event, 0);
    else verifyAccess();
  }
  if (inline) {
    window.rankBoostFlow.mountBooking = startBooking;
    window.rankBoostFlow.clearBooking = function () { removeBookingListener(); };
  }
  else startBooking();
})();
