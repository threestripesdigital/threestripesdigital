import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { onRequest as functionMiddleware } from "../functions/_middleware.js";
import { onRequestPost as bookingPost } from "../functions/api/booking.js";
import { onRequestGet as boostGet } from "../functions/api/boost-live.js";
import { onRequestGet as leadsGet } from "../functions/api/leads.js";
import {
  onRequestPost as processJobsPost,
  recordPollAlerts,
} from "../functions/api/process-jobs.js";
import { onRequestPost as trackPost } from "../functions/api/track.js";
import { createLeadToken } from "../functions/api/_security.js";
import router from "../router/worker.js";

test("lead viewer ignores query-string credentials", async () => {
  const response = await leadsGet({
    request: new Request("https://example.test/api/leads?key=secret"),
    env: { LEADS_VIEW_KEY: "secret" },
  });
  assert.equal(response.status, 401);
});

test("lead viewer omits non-HTTP provider links", async () => {
  const response = await leadsGet({
    request: new Request("https://example.test/api/leads", {
      headers: { Authorization: "Bearer viewer-secret" },
    }),
    env: {
      LEADS_VIEW_KEY: "viewer-secret",
      LEADS_DB: {
        prepare() {
          return {
            bind() { return this; },
            async all() {
              return {
                results: [{
                  id: 1,
                  created_at: "2026-08-19 12:00:00",
                  name: "Test Lead",
                  phone: "",
                  email: "",
                  domain: "example.test",
                  qualified: 1,
                  status: "qualified",
                  total_boost_fits: 1,
                  top_keywords: JSON.stringify([{
                    keyword: "test lawyer",
                    position: 12,
                    volume: 100,
                    url: "javascript:alert(1)",
                    variants: [],
                  }]),
                }],
              };
            },
          };
        },
      },
    },
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("state-changing boost endpoint rejects GET", async () => {
  const response = boostGet();
  assert.equal(response.status, 405);
});

test("booking verifier rejects an unsigned lead before database access", async () => {
  const response = await bookingPost({
    request: new Request("https://threestripesdigital.com/api/booking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://threestripesdigital.com",
      },
      body: JSON.stringify({ token: "invalid" }),
    }),
    env: {
      FUNNEL_SIGNING_KEY: "configured",
      CALENDLY_EVENT_TYPE_URI: "https://api.calendly.com/event_types/rank-boost",
      LEADS_DB: {},
    },
  });
  assert.equal(response.status, 401);
});

test("booking verifier binds the signed lead to its current Rank Boost event", async () => {
  const signingKey = "booking-test-signing-key";
  const token = await createLeadToken(signingKey, "lead-booking-test", 60);
  const invitee =
    "https://api.calendly.com/scheduled_events/event-booking-test-uuid/invitees/invitee-booking-test";
  const event = "https://api.calendly.com/scheduled_events/event-booking-test-uuid";
  const db = {
    prepare(sql) {
      assert.match(sql, /JOIN calendly_invitees/);
      assert.match(sql, /l\.qualified = 1/);
      return {
        bind(leadRef, eventType) {
          assert.equal(leadRef, "lead-booking-test");
          assert.equal(eventType, "https://api.calendly.com/event_types/rank-boost");
          return this;
        },
        async first() {
          return {
            invitee_uri: invitee,
            event_uri: event,
            scheduled_start_at: "2026-08-20 15:00:00",
          };
        },
      };
    },
  };
  const response = await bookingPost({
    request: new Request("https://threestripesdigital.com/api/booking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://threestripesdigital.com",
      },
      body: JSON.stringify({
        token,
        invitee: "invitee-booking-test",
        event: "event-booking-test-uuid",
      }),
    }),
    env: {
      FUNNEL_SIGNING_KEY: signingKey,
      CALENDLY_EVENT_TYPE_URI: "https://api.calendly.com/event_types/rank-boost",
      LEADS_DB: db,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verified: true,
    invitee,
    event,
    start: "2026-08-20T15:00:00Z",
    offer: "boost",
  });
});

test("booking verifier requires exact event and invitee identifiers", async () => {
  const signingKey = "booking-test-signing-key";
  const token = await createLeadToken(signingKey, "lead-booking-test", 60);
  const response = await bookingPost({
    request: new Request("https://threestripesdigital.com/api/booking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://threestripesdigital.com",
      },
      body: JSON.stringify({ token }),
    }),
    env: {
      FUNNEL_SIGNING_KEY: signingKey,
      CALENDLY_EVENT_TYPE_URI: "https://api.calendly.com/event_types/rank-boost",
      LEADS_DB: {
        prepare() {
          throw new Error("database must not be queried without exact identifiers");
        },
      },
    },
  });
  assert.equal(response.status, 400);
});

test("tracking relay ignores an unsigned event before database access", async () => {
  const response = await trackPost({
    request: new Request("https://example.test/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: "BookingStarted", lead_token: "invalid" }),
    }),
    env: {
      META_CAPI_TOKEN: "configured",
      META_DATASET_ID: "configured",
      FUNNEL_SIGNING_KEY: "configured",
      LEADS_DB: {},
    },
  });
  assert.equal(response.status, 204);
});

test("router fails closed when its shared secret is absent", async () => {
  const response = await router.fetch(new Request("https://example.test/rank-boost/law-firms/"), {});
  assert.equal(response.status, 503);
});

test("router cron invokes the protected durable-job processor", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ ok: true });
  };
  try {
    const waits = [];
    router.scheduled({}, { JOB_PROCESSOR_TOKEN: "jobs-test-token" }, {
      waitUntil(promise) {
        waits.push(promise);
      },
    });
    await Promise.all(waits);

    assert.equal(
      requests[0].url,
      "https://tsd-law-firm-rank-boost.pages.dev/api/process-jobs"
    );
    assert.equal(requests[0].options.method, "POST");
    assert.equal(
      requests[0].options.headers.Authorization,
      "Bearer jobs-test-token"
    );
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      action: "process",
      limit: 4,
      budget_ms: 10000,
      no_show_limit: 4,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public router proof cannot authorize job processor actions", async () => {
  const response = await processJobsPost({
    request: new Request("https://example.test/api/process-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Router-Token": "public-router-token",
      },
      body: JSON.stringify({ action: "repair", job_id: 1 }),
    }),
    env: {
      JOB_PROCESSOR_TOKEN: "private-jobs-token",
      ROUTER_TOKEN: "public-router-token",
    },
  });
  assert.equal(response.status, 403);
});

test("job processor accepts the legacy cron secret alias", async () => {
  const response = await processJobsPost({
    request: new Request("https://example.test/api/process-jobs", {
      method: "POST",
      headers: {
        Authorization: "Bearer legacy-jobs-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "unsupported" }),
    }),
    env: { JOBS_TOKEN: "legacy-jobs-token" },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_action" });
});

test("Calendly polling resolves an expired-window alert after recovery", async () => {
  const statements = [];
  const env = {
    LEADS_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            statements.push({ sql, values });
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };

  await recordPollAlerts(env, {
    configured: true,
    candidates: 0,
    checked: 0,
    failed: 0,
    expired: 0,
  });

  assert.ok(statements.some(({ sql, values }) =>
    /UPDATE operational_alerts/.test(sql) &&
    values[0] === "calendly-poll:expired"
  ));
});

test("Cloudflare release scripts pin the intended account", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const expectedAccount = "17f7c095d40a8771cf3568fdcae11770";
  assert.match(
    packageJson.scripts["migrate:remote"],
    new RegExp(`CLOUDFLARE_ACCOUNT_ID=${expectedAccount}`)
  );
  assert.match(
    packageJson.scripts["deploy:pages"],
    new RegExp(`CLOUDFLARE_ACCOUNT_ID=${expectedAccount}`)
  );
  assert.match(packageJson.scripts["deploy:pages"], /--branch preview/);
  assert.match(packageJson.scripts["deploy:pages"], /--commit-dirty=false/);
  assert.ok(
    packageJson.scripts["deploy:pages"].indexOf("npm run migrate:remote") <
      packageJson.scripts["deploy:pages"].indexOf("wrangler pages deploy")
  );
});

test("booking UI preserves consent and returns to the real form anchor", async () => {
  const source = await readFile(new URL("../public/book.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/book.html", import.meta.url), "utf8");
  assert.doesNotMatch(source, /hide_gdpr_banner/);
  assert.match(source, /\.\/#qualify/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
});

test("browser-based Meta measurement loads automatically without a consent banner", async () => {
  const pageNames = ["index.html", "results.html", "book.html", "thank-you.html", "privacy.html"];
  for (const pageName of pageNames) {
    const page = await readFile(new URL("../public/" + pageName, import.meta.url), "utf8");
    assert.match(page, /<script src="meta\.js"><\/script>/);
    assert.doesNotMatch(page, /consent\.js/);
    assert.doesNotMatch(page, /meta-consent/);
    assert.doesNotMatch(page, /Continue without/);
    assert.doesNotMatch(page, /Allow measurement/);
  }
  const meta = await readFile(new URL("../public/meta.js", import.meta.url), "utf8");
  assert.match(meta, /https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(meta, /1015693118133434/);
  assert.match(meta, /PageView/);
  assert.match(meta, /tsd_ext_id/);
  assert.doesNotMatch(meta, /createElement\("section"\)/);
  assert.doesNotMatch(meta, /Continue without/);
  assert.doesNotMatch(meta, /Allow measurement/);
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(index, /window\.tsdMetaTrackingEnabled === true/);
  assert.match(index, /var fbp = metaAllowed \? readCookie\("_fbp"\) : ""/);
});

test("qualification form uses a one-way accessible disclosure trigger", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const qualifyStart = index.indexOf("hero-qualify");
  const qualifyEnd = index.indexOf('id="trusted"', qualifyStart);
  assert.notEqual(qualifyStart, -1);
  assert.notEqual(qualifyEnd, -1);
  const qualification = index.slice(qualifyStart, qualifyEnd);
  const vslPosition = index.indexOf("hero-vsl-caption");
  assert.notEqual(vslPosition, -1);
  assert.ok(index.slice(vslPosition).includes("qualify-form-toggle"));
  const trigger = /<button class="[^"]*qualify-form-toggle[^"]*" id="qualify-form-toggle" type="button" aria-expanded="false" aria-controls="qualify-form">\s*Get my free boost\s*<\/button>/;
  assert.match(index, trigger);
  assert.match(qualification, trigger);
  assert.match(qualification, /novalidate hidden/);
  assert.match(index, /if \(!form\.hidden\) return;/);
  assert.match(index, /form\.hidden = false/);
  assert.match(index, /formToggle\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(index, /formToggle\.hidden = true/);
  assert.doesNotMatch(index, /qualify-toggle-note/);
  assert.doesNotMatch(index, /We never ask for site access or logins\./);
  assert.doesNotMatch(index, /form\.hidden = !opening/);
  assert.doesNotMatch(index, /aria-expanded", opening \? "true" : "false"/);
  assert.match(styles, /\.hero-qualify \.qualify-form-toggle\[hidden\] \{\s*display: none !important;\s*\}/);
  assert.doesNotMatch(qualification, /Free 60-second check/);
  assert.doesNotMatch(qualification, /See if your firm qualifies/);
  assert.doesNotMatch(qualification, /Enter your firm’s website/);
  assert.doesNotMatch(qualification, /section-head/);
  assert.match(qualification, /Check my current rankings · free/);
  assert.match(index, /<form class="qualify-form" id="qualify-form" action="#" method="post" novalidate hidden>/);
  assert.doesNotMatch(index, /Paste your full URL. We’ll normalize to the bare domain for the ranking check./);
  assert.doesNotMatch(index, /website-hint/);
  assert.match(index, /window\.tsdMetaTrackingEnabled === true && window\.fbq/);
  assert.ok(index.includes("fbq(\"trackCustom\", \"LeadFormOpened\", { content_name: \"rank-boost-qualification\" });"));
  assert.ok(index.indexOf("data-field=\"name\"") < index.indexOf("data-field=\"phone\""));
  assert.ok(index.indexOf("data-field=\"phone\"") < index.indexOf("data-field=\"website_url\""));
  assert.ok(index.indexOf("data-field=\"website_url\"") < index.indexOf("data-field=\"email\""));
});

test("landing page keeps the simplified VSL structure", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(index, /<footer/);
  assert.doesNotMatch(index, /footer-links/);
  assert.doesNotMatch(index, /google\.com\/s2\/favicons/);
  assert.doesNotMatch(index, /senorticket\.com/);
  assert.ok(index.includes("Cruz Gold &amp; Associates"));
  assert.ok(index.includes("Señor Ticket"));
  assert.ok(index.includes("Stuart Allen Law Firm"));
  assert.doesNotMatch(index, /Page-one keywords can qualify too|Already on page one/);
  const sectionIds = [...index.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(sectionIds, ["top", "qualify", "trusted", "wins", "partners", "faq", "final"]);
  const finalSection = index.slice(index.indexOf('id="final"'), index.indexOf("</section>", index.indexOf('id="final"')));
  assert.match(finalSection, /id="year"/);
  assert.doesNotMatch(index, /qualify first\./);
  for (const removedId of ["problem", "how", "different", "inbox-proof", "gserp"]) {
    assert.doesNotMatch(index, new RegExp(`id="${removedId}"`));
  }
  const faqCount = (index.match(/<details class="faq-item"/g) || []).length;
  assert.ok(faqCount >= 5 && faqCount <= 6);
  assert.doesNotMatch(index, /GET MY FREE BOOST NOW/);
});

test("partner access code is session-only", async () => {
  const source = await readFile(new URL("../public/partner.js", import.meta.url), "utf8");
  assert.match(source, /sessionStorage\.getItem\("tsd_partner_code"\)/);
  assert.match(source, /sessionStorage\.setItem\("tsd_partner_code", code\)/);
  assert.doesNotMatch(source, /localStorage/);
});

test("Kit installer verifies sequence identity and preserves rollback content", async () => {
  const source = await readFile(
    new URL("../tools/install-kit-email-system.py", import.meta.url),
    "utf8"
  );
  assert.match(source, /current\.get\("name"\) != TARGET_NAMES\[name\]/);
  assert.match(source, /step:'archive_old'/);
  assert.match(source, /state:'active'/);
  assert.match(source, /activeIds\[index\]===id/);
  assert.doesNotMatch(source, /req\('DELETE','\/api\/v3\/email_templates\//);
});

test("results UI distinguishes durable fallback from unsaved failures", async () => {
  const source = await readFile(new URL("../public/results.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/results.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(source, /Your info was not saved/);
  assert.match(source, /\["check_failed", "not_configured", "rate_limited", "capacity_limited", "invalid_email"\]/);
  assert.match(source, /res\.data && res\.data\.lead_token/);
  assert.match(source, /Booking stays closed until the check succeeds/);
  assert.match(source, /requestCheck\(attempt \+ 1\)/);
  assert.match(source, /tsd_rb_pending_track/);
  assert.match(source, /pending\.lead_token !== payload\.lead_token/);
  assert.match(source, /<details class="fit-assumptions"><summary>/);
  assert.match(source, /heading\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /<h1 class="step-h">/);
  assert.doesNotMatch(source, /<h2 class="step-h">/);
  assert.match(page, /aria-live="polite" aria-atomic="false"/);
  assert.match(styles, /\.marquee-section \{[\s\S]*overflow-x: clip;[\s\S]*contain: paint;/);
});

test("thank-you welcomes visitors and verifies personalized booking details", async () => {
  const source = await readFile(new URL("../public/thank-you.html", import.meta.url), "utf8");
  assert.match(source, /<h1 id="ty-title">Thanks for booking\. Your meeting is confirmed\.<\/h1>/);
  assert.match(source, /id="booking-actions" hidden/);
  assert.match(source, /\.ty-actions\[hidden\] \{ display: none !important; \}/);
  assert.match(source, /title\.textContent = "Thanks for booking\. Your meeting is confirmed\."/);
  assert.match(source, /textContent === "Thanks for booking\. Your meeting is confirmed\."/);
  assert.match(source, /retryPendingTrack\(0\)/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /tsd_rb_lead_token/);
  assert.match(source, /var token = q\.get\("lead_token"\) \|\| q\.get\("utm_content"\) \|\| ""/);
  assert.match(source, /function cleanTokenState\(\)/);
  assert.match(source, /if \(!booking\.verified \|\| !apply\(booking\)\)/);
  assert.ok(
    source.indexOf('var token = q.get("lead_token")') <
      source.indexOf('sessionStorage.getItem("tsd_rb_lead_token")')
  );
  assert.ok(
    source.lastIndexOf("cleanTokenState();") >
      source.indexOf('title.textContent = "Thanks for booking. Your meeting is confirmed."')
  );
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /el\.setAttribute\("role", "slider"\)/);
  assert.match(source, /e\.key === "ArrowLeft"/);
  assert.match(source, /img\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(source, /lightboxTrigger\.focus\(\)/);
  assert.doesNotMatch(source, /apply\(q\.get\("event_start_time"/);
});

test("thank-you page orders urgency video, breakouts, testimonials, next steps", async () => {
  const source = await readFile(new URL("../public/thank-you.html", import.meta.url), "utf8");
  const sectionIds = Array.from(
    source.matchAll(/<section\b[^>]*\bid="([^"]+)"/g),
    (match) => match[1]
  );
  assert.deepEqual(sectionIds, [
    "ty-urgency",
    "ty-calendar",
    "ty-breakouts",
    "ty-testimonials",
    "ty-next-steps",
  ]);

  for (const slot of [
    "founder-urgency",
    "breakout-why-free",
    "breakout-difference",
    "breakout-safety",
    "breakout-timing",
    "breakout-competitors",
  ]) {
    assert.match(source, new RegExp(`data-video-slot="${slot}"`));
  }

  const embeds = [...source.matchAll(/<wistia-player media-id="([a-z0-9]+)" aspect="0.5625"/g)];
  assert.equal(embeds.length, 6);
  assert.equal(new Set(embeds.map((match) => match[1])).size, 6);
  for (const [, id] of embeds) {
    assert.ok(source.includes(`src="https://fast.wistia.com/embed/${id}.js"`));
  }
  assert.equal((source.match(/src="https:\/\/fast.wistia.com\/player.js"/g) || []).length, 1);
  assert.doesNotMatch(source, /seconds with Bilal|ty-video-meta/);
  assert.doesNotMatch(source, /Video coming soon/);
  assert.ok(source.indexOf('id="booking-actions" hidden') > source.indexOf('id="ty-next-steps"'));
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(withoutComments, /<wistia-player\b/);
  assert.doesNotMatch(source, /src="wins\//);
  assert.doesNotMatch(source, /<footer/);
});

test("lead form validation mirrors server limits and exposes accessible errors", async () => {
  const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /maxlength="120" aria-describedby="name-error"/);
  assert.match(source, /maxlength="40" aria-describedby="phone-error"/);
  assert.match(source, /role="alert">Enter a phone number with 7–15 digits/);
  assert.match(source, /control\.setAttribute\("aria-invalid"/);
  assert.match(source, /phoneDigits\.length <= 15/);
  assert.match(source, /labels\.length < 2/);
});

test("static responses enforce transport and browser security policy", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const middlewareResponse = await functionMiddleware({
    request: new Request("https://example.test/"),
    next: async function () { return new Response("ok"); },
  });
  const middlewarePolicy = middlewareResponse.headers.get("Content-Security-Policy");
  const requiredPolicies = [
    "form-action 'self' https://www.facebook.com https://*.facebook.com",
    "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://assets.calendly.com https://static.cloudflareinsights.com",
    "frame-src https://www.facebook.com https://*.facebook.com https://calendly.com https://*.calendly.com",
    "connect-src 'self' https://www.facebook.com https://*.facebook.com https://connect.facebook.net https://calendly.com https://*.calendly.com https://cloudflareinsights.com https://*.cloudflareinsights.com",
  ];
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
  for (const policy of requiredPolicies) {
    assert.ok(headers.includes(policy), "public/_headers missing " + policy);
    assert.ok(middlewarePolicy && middlewarePolicy.includes(policy), "middleware CSP missing " + policy);
  }
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /\/\*\.html[\s\S]*Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.js[\s\S]*Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.css[\s\S]*Cache-Control: no-cache/);
});

test("hero VSL renders the Wistia embed and the CSP allows it", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(index, /<wistia-player\b[^>]*media-id="8uioqg3047"[^>]*><\/wistia-player>/);
  assert.ok(index.includes('poster="https://threestripesdigital.com/rank-boost/law-firms/assets/rankboost-vsl-page-one.png"'));
  assert.ok(index.includes("https://fast.wistia.com/player.js"));
  assert.ok(index.includes("https://fast.wistia.com/embed/8uioqg3047.js"));
  assert.doesNotMatch(index, /hero-vsl-placeholder/);
  assert.ok(index.indexOf('<script src="meta.js"></script>') < index.indexOf("fast.wistia.com/player.js"));

  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const middlewareResponse = await functionMiddleware({
    request: new Request("https://example.test/"),
    next: async function () { return new Response("ok"); },
  });
  const middlewarePolicy = middlewareResponse.headers.get("Content-Security-Policy");
  const requiredPolicies = [
    /script-src[^;]*https:\/\/\*\.wistia\.com/,
    /connect-src[^;]*https:\/\/\*\.wistia\.com/,
    /media-src[^;]*https:\/\/\*\.wistia\.com/,
    /frame-src[^;]*https:\/\/fast\.wistia\.com/,
    /worker-src 'self' blob:/,
  ];
  for (const policy of requiredPolicies) {
    assert.match(headers, policy);
    assert.match(middlewarePolicy, policy);
  }
});

test("Function responses receive the same security baseline", async () => {
  const response = await functionMiddleware({
    request: new Request("https://example.test/api/check"),
    next: async () => Response.json({ ok: true }),
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");

  const asset = await functionMiddleware({
    request: new Request("https://example.test/styles.css"),
    next: async () => new Response("body{}", {
      headers: { "Cache-Control": "public, max-age=3600" },
    }),
  });
  assert.equal(asset.headers.get("Cache-Control"), "public, max-age=3600");
});
