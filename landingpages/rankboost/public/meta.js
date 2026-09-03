// Browser-based Meta Pixel measurement for the Rank Boost funnel.
(function () {
  "use strict";

  var EXTERNAL_ID_KEY = "tsd_ext_id";
  var PIXEL_ID = "1015693118133434";

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

  window.tsdMetaTrackingEnabled = true;
  window.tsdExtId = externalId();
  if (window.tsdMetaLoaded) return;
  window.tsdMetaLoaded = true;

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
})();
