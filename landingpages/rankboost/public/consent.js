// Optional advertising measurement. The funnel remains fully usable when a
// visitor declines; the browser does not contact Meta until they opt in.
(function () {
  "use strict";

  var CONSENT_KEY = "tsd_meta_consent";
  var EXTERNAL_ID_KEY = "tsd_ext_id";
  var PIXEL_ID = "1015693118133434";
  var choice = "";

  try { choice = localStorage.getItem(CONSENT_KEY) || ""; } catch (e) {}
  window.tsdMetaConsent = choice;
  window.tsdExtId = "";

  function externalId() {
    var value = "";
    try {
      value = localStorage.getItem(EXTERNAL_ID_KEY) || "";
      if (!value) {
        value = window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : "x-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        localStorage.setItem(EXTERNAL_ID_KEY, value);
      }
    } catch (e) {
      value = "x-" + Date.now();
    }
    return value;
  }

  function loadMeta() {
    if (window.tsdMetaLoaded) return;
    window.tsdMetaLoaded = true;
    window.tsdExtId = externalId();

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    window.fbq("init", PIXEL_ID, { external_id: window.tsdExtId });
    window.fbq("track", "PageView");
  }

  function clearMeasurementState() {
    window.tsdExtId = "";
    try { localStorage.removeItem(EXTERNAL_ID_KEY); } catch (e) {}
    document.cookie = "_fbp=; Max-Age=0; Path=/; SameSite=Lax";
    document.cookie = "_fbc=; Max-Age=0; Path=/; SameSite=Lax";
  }

  function removeBanner() {
    var banner = document.getElementById("meta-consent");
    if (banner) banner.remove();
  }

  function saveChoice(value) {
    choice = value;
    window.tsdMetaConsent = value;
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
    removeBanner();
    if (value === "granted") loadMeta();
    else clearMeasurementState();
  }

  function action(label, className, value) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", function () { saveChoice(value); });
    return button;
  }

  function showChoices() {
    removeBanner();
    var banner = document.createElement("section");
    banner.id = "meta-consent";
    banner.className = "meta-consent";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Optional advertising measurement choices");

    var inner = document.createElement("div");
    inner.className = "meta-consent__inner";
    var copy = document.createElement("p");
    copy.appendChild(document.createTextNode(
      "We use optional browser-based Meta measurement only if you allow it. "
    ));
    var privacy = document.createElement("a");
    privacy.href = "privacy";
    privacy.textContent = "Privacy details";
    copy.appendChild(privacy);

    var actions = document.createElement("div");
    actions.className = "meta-consent__actions";
    actions.appendChild(action("Continue without", "btn btn-ghost", "denied"));
    actions.appendChild(action("Allow measurement", "btn btn-primary", "granted"));
    inner.appendChild(copy);
    inner.appendChild(actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);
  }

  window.tsdOpenPrivacyChoices = showChoices;
  if (choice === "granted") {
    loadMeta();
  } else if (!choice) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showChoices, { once: true });
    } else {
      showChoices();
    }
  }
})();
