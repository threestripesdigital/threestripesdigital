import { WEBSITE_TAG_IDS, WEBSITE_BOOKING_URL } from "./_offers.js";
import { boostBookingLink } from "./_bookinglinks.js";
import { qualifiedKeywordEmailFields } from "./_emailfields.js";
// POST /api/check — instant DataForSEO qualify check for the rank-boost LP.
// Body: { name, phone, website_url }
// Returns: { qualified, domain, total, groups, keywords: [{ keyword,
//   position, volume, url, case_value, opp_clicks, opp_leads, opp_cases,
//   opp_value }] } — keywords are commercial-intent only, with the ranking
//   URL and the $/mo opportunity model at #1 per keyword.
//
// Requires env: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD.
// Every submission (qualified, not-fit, or check-failed) is saved to the
// dedicated rankboost-leads D1 database (binding: LEADS_DB) — deliberately
// separate from the main threestripesdigital.com submissions store.

import {
  moneyKeywordTest,
  caseValueFor,
  ctrFor,
  opportunityFor,
  buildThemes,
  projectKeywords,
  fetchRankedKeywords,
  normalizeDomain,
} from "./_rankmodel.js";
import {
  createLeadToken,
  fromTrustedRouter,
  validFunnelOrigin,
  validFunnelPageUrl,
} from "./_security.js";
import { jobStatement, kickIntegrationJobs } from "./_jobs.js";
import { KIT_TAG_IDS } from "./_kit.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function slackJobForLead(lead, leadRef) {
  // Skip noisy statuses; a rate-limited flood should not spam Slack.
  if (
    lead.status === "rate_limited" ||
    lead.status === "not_configured" ||
    lead.status === "missing_email"
  ) return;

  const flag = lead.qualified
    ? "✅ QUALIFIED"
    : lead.status === "no_fit"
      ? "❌ no boost fits"
      : "⚠️ " + lead.status + " (run manually)";

  // One labelled line per field. Internal partner lookups are titled and
  // routed differently so they never read like a real inbound lead.
  const internal = lead.source === "partner";
  const isMoney = moneyKeywordTest(lead.domain);
  const money = (lead.keywords || []).filter((k) => isMoney(k.keyword));
  const shown = (money.length ? money : lead.keywords || []).slice(0, 3);

  // Total monthly gap across the shown money keywords, the same figure the
  // prospect sees on step 2.
  let totalGap = 0;
  for (const k of shown) {
    const opp = opportunityFor(k.keyword, k.volume);
    const now = Math.round(((Number(k.volume) || 0) * ctrFor(k.position) * 0.1 * 0.2 * opp.caseValue) / 100) * 100;
    totalGap += Math.max(0, opp.monthly - now);
  }
  const money$ = (n) => "$" + Number(n).toLocaleString("en-US");

  // Blocks are joined with a blank line between them so the message is
  // scannable instead of a wall of text.
  const lines = [];
  lines.push(internal
    ? ":mag: *Partner rank lookup* (internal, not a lead)"
    : ":rotating_light: *New rank-boost lead*");
  if (!internal) {
    lines.push(`*Name:*  ${lead.name || "—"}`);
    lines.push(`*Phone:*  ${lead.phone || "—"}`);
    lines.push(`*Email:*  ${lead.email || "—"}`);
  } else {
    lines.push(`*Looked up by:*  ${lead.partner || "partner"}`);
  }
  lines.push(`*Website:*  ${lead.domain || "—"}`);
  lines.push(`*Status:*  ${flag}`);
  lines.push(`*Keywords in 1 to 50:*  ${lead.total || 0}`);
  if (totalGap > 0) {
    lines.push(`*Opportunity:*  ${money$(totalGap)}/mo across their top ${shown.length} money keyword${shown.length === 1 ? "" : "s"}`);
  }
  if (shown.length) {
    const kws = shown.map((k) => {
      const opp = opportunityFor(k.keyword, k.volume);
      const url = k.url ? `\n      ${k.url}` : "";
      return `*${k.keyword}*\n      #${k.position} · ${Number(k.volume).toLocaleString("en-US")} searches/mo · ${money$(opp.monthly)}/mo at #1${url}`;
    });
    lines.push("*Top money keywords*");
    lines.push(...kws);
  }
  const text = lines.join("\n\n");

  // Partner lookups go to their own channel when one is configured, so the
  // real lead channel stays clean.
  return {
    leadRef,
    kind: "slack.webhook",
    dedupeKey: `lead:${leadRef}:slack`,
    payload: {
      text,
      destination: internal ? "partner" : "leads",
      unfurl_links: false,
      unfurl_media: false,
    },
  };
}

// Real client IP / country. When served via the threestripesdigital.com
// router Worker, the direct CF headers describe the Worker hop, so the
// router forwards the originals in X-Forwarded-Client-* headers. The
// forwarded headers are only trusted when the router's token matches;
// otherwise anyone hitting pages.dev directly could spoof them to bypass
// the rate limiter.
function clientIp(request, env) {
  if (fromTrustedRouter(request, env)) {
    const fwd = request.headers.get("X-Forwarded-Client-IP");
    if (fwd) return fwd;
  }
  return request.headers.get("CF-Connecting-IP") || "";
}

function clientCountry(request, env) {
  if (fromTrustedRouter(request, env)) {
    const fwd = request.headers.get("X-Forwarded-Client-Country");
    if (fwd) return fwd;
  }
  return (request.cf && request.cf.country) || "";
}

// City/region/postal follow the same trust model: forwarded headers from the
// router (which sees the real visitor's cf object), else this request's cf.
function clientGeo(request, env) {
  const viaRouter = fromTrustedRouter(request, env);
  const pick = (header, cfKey) => {
    if (viaRouter) {
      const fwd = request.headers.get(header);
      if (fwd) return fwd;
    }
    return (request.cf && request.cf[cfKey]) || "";
  };
  return {
    city: pick("X-Forwarded-Client-City", "city"),
    region: pick("X-Forwarded-Client-Region", "regionCode"),
    postal: pick("X-Forwarded-Client-Postal", "postalCode"),
  };
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Server-side Meta Conversions API Lead event. Shares event_id with the
// browser pixel's Lead so Meta dedupes the pair. Best-effort like Slack.
async function metaJobForLead(context, lead, leadRef) {
  const env = context.env;
  if (
    lead.status === "rate_limited" ||
    lead.status === "not_configured" ||
    lead.status === "missing_email"
  ) return;

  const userData = {
    client_ip_address: clientIp(context.request, env) || undefined,
    client_user_agent: context.request.headers.get("User-Agent") || undefined,
  };
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.email) userData.em = [await sha256(lead.email.trim().toLowerCase())];
  if (lead.phone) {
    let digits = lead.phone.replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (digits) userData.ph = [await sha256(digits)];
  }
  if (lead.name) {
    const parts = lead.name.trim().toLowerCase().split(/\s+/);
    if (parts[0]) userData.fn = [await sha256(parts[0])];
    const last = parts.slice(1).join(" ");
    if (last) userData.ln = [await sha256(last)];
  }
  const country = clientCountry(context.request, env);
  if (country) userData.country = [await sha256(country.toLowerCase())];
  // IP-derived geo (ct/st/zp) — free match-quality lift, Meta normalization:
  // city lowercase letters only, state 2-letter lowercase, zip first 5 digits.
  const geo = clientGeo(context.request, env);
  const city = (geo.city || "").toLowerCase().replace(/[^a-z]/g, "");
  if (city) userData.ct = [await sha256(city)];
  const region = (geo.region || "").toLowerCase().slice(0, 2);
  if (/^[a-z]{2}$/.test(region)) userData.st = [await sha256(region)];
  const zip = String(geo.postal || "").replace(/[^0-9]/g, "").slice(0, 5);
  if (zip) userData.zp = [await sha256(zip)];
  if (lead.external_id) userData.external_id = [await sha256(lead.external_id)];

  const baseEventId = lead.event_id || crypto.randomUUID();
  const baseEvent = {
    event_time: Math.floor(Date.now() / 1000),
    event_source_url:
      lead.page_url || "https://threestripesdigital.com/rank-boost/law-firms/",
    action_source: "website",
    user_data: userData,
    custom_data: {
      content_name: "rank-check",
      status: lead.status,
      qualified: lead.qualified ? "yes" : "no",
      boost_fits: lead.total || 0,
    },
  };
  const events = [{ ...baseEvent, event_name: lead.qualified ? "Lead" : "RankCheckCompleted", event_id: baseEventId }];
  // Separate qualified signal so campaigns can optimize on real prospects
  // instead of every form fill. Dedupes with the browser's QualifiedLead.
  if (lead.qualified) {
    events.push({
      ...baseEvent,
      event_name: "QualifiedLead",
      event_id: baseEventId + "-q",
    });
  }
  return {
    leadRef,
    kind: "meta.events",
    dedupeKey: `lead:${leadRef}:meta`,
    payload: { events },
  };
}

// Kit (v4 API, X-Kit-Api-Key auth): only qualified emailed leads get
// `lp-form` (22494626). No-fit / failed checks must not enter the
// book-the-call sequence. Two steps: upsert subscriber, then tag.
function kitJobForLead(lead, leadRef, leadToken) {
  if (!lead.email) return;
  if (!["qualified", "no_fit"].includes(lead.status)) return;
  if (lead.status === "no_fit") return {
    leadRef, kind: "kit.upsert_tag", dedupeKey: `lead:${leadRef}:kit`,
    payload: { email: lead.email, first_name: (lead.name || "").trim().split(/\s+/)[0],
      fields: { domain: lead.domain || "", phone: lead.phone || "", boost_fits: "0", website_calendly_link: WEBSITE_BOOKING_URL + "?utm_content=" + encodeURIComponent(leadToken) },
      tag_id: WEBSITE_TAG_IDS.lead }
  };

  const firstName = (lead.name || "").trim().split(/\s+/)[0] || "";
  // Per-lead keyword data from the rank check, so emails can talk about
  // THEIR keywords instead of keywords in the abstract. Only high
  // commercial intent keywords reach the emails: no informational
  // queries, no brand searches for their own firm name.
  const isMoneyKeyword = moneyKeywordTest(lead.domain);
  const all = lead.keywords || [];
  const money = all.filter((k) => isMoneyKeyword(k.keyword));
  const kws = money.length ? money : all;
  const fmt = (k) =>
    k ? `${k.keyword} (#${k.position}, ${Number(k.volume).toLocaleString("en-US")}/mo)` : "";
  const fields = {
    domain: lead.domain || "",
    phone: lead.phone || "",
    boost_fits: String(lead.total || 0),
    rank_boost_booking_link: boostBookingLink(leadToken),
  };
  if (kws[0]) {
    fields.top_keyword = kws[0].keyword;
    fields.top_position = String(kws[0].position);
    fields.top_volume = Number(kws[0].volume).toLocaleString("en-US");
    Object.assign(fields, qualifiedKeywordEmailFields(kws[0]));
  }
  if (kws[1]) fields.keyword_two = fmt(kws[1]);
  if (kws[2]) fields.keyword_three = fmt(kws[2]);
  return {
    leadRef,
    kind: "kit.upsert_tag",
    dedupeKey: `lead:${leadRef}:kit`,
    payload: {
      email: lead.email,
      first_name: firstName,
      fields,
      tag_id: KIT_TAG_IDS.lead,
    },
  };
}

function sqliteTime(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

async function claimSubmission(db, submissionId) {
  const leaseToken = crypto.randomUUID();
  const leaseUntil = sqliteTime(Date.now() + 2 * 60 * 1000);
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO submissions
         (submission_id, lease_token, lease_until)
       VALUES (?1, ?2, ?3)`
    )
    .bind(submissionId, leaseToken, leaseUntil)
    .run();
  if (inserted.meta && inserted.meta.changes === 1) {
    return { owner: true, leaseToken };
  }

  const existing = await db
    .prepare(
      `SELECT state, response_json, response_status
       FROM submissions WHERE submission_id = ?1`
    )
    .bind(submissionId)
    .first();
  if (existing && existing.state === "complete" && existing.response_json) {
    return {
      owner: false,
      cached: JSON.parse(existing.response_json),
      status: Number(existing.response_status) || 200,
    };
  }

  const takeover = await db
    .prepare(
      `UPDATE submissions
       SET lease_token = ?1, lease_until = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE submission_id = ?3 AND state = 'processing'
         AND lease_until < CURRENT_TIMESTAMP`
    )
    .bind(leaseToken, leaseUntil, submissionId)
    .run();
  return {
    owner: Boolean(takeover.meta && takeover.meta.changes === 1),
    leaseToken,
    processing: !(takeover.meta && takeover.meta.changes === 1),
  };
}

async function reserveUsage(db, scope, key, bucketExpression) {
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (scope, counter_key, bucket, count)
       VALUES (?1, ?2, ${bucketExpression}, 1)
       ON CONFLICT(scope, counter_key, bucket)
       DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP
       RETURNING count`
    )
    .bind(scope, key)
    .first();
  return Number(row && row.count) || 0;
}

async function saveLead(context, lead, submission, responseStatus, buildResponse) {
  const db = context.env.LEADS_DB;
  if (!db || !context.env.FUNNEL_SIGNING_KEY) throw new Error("lead_store_not_configured");
  const renewed = await db
    .prepare(
      `UPDATE submissions
       SET lease_until = ?1, updated_at = CURRENT_TIMESTAMP
       WHERE submission_id = ?2 AND lease_token = ?3 AND state = 'processing'`
    )
    .bind(
      sqliteTime(Date.now() + 2 * 60 * 1000),
      submission.submissionId,
      submission.leaseToken
    )
    .run();
  if (!renewed.meta || renewed.meta.changes !== 1) {
    throw new Error("submission_lease_lost");
  }
  const leadRef = crypto.randomUUID();
  const leadToken = await createLeadToken(
    context.env.FUNNEL_SIGNING_KEY,
    leadRef,
    60 * 60 * 24 * 180
  );
  const responseBody = buildResponse(leadToken);
  const jobs = [
    slackJobForLead(lead, leadRef),
    await metaJobForLead(context, lead, leadRef),
    kitJobForLead(lead, leadRef, leadToken),
  ].filter(Boolean);
  const statements = [
    db
    .prepare(
      `INSERT INTO leads
         (name, phone, email, domain, qualified, total_boost_fits,
          top_keywords, status, ip, ip_country, user_agent, page_url,
          lead_ref, submission_id, dataforseo_cost)
       VALUES
         (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
    )
    .bind(
      lead.name,
      lead.phone,
      lead.email || "",
      lead.domain,
      lead.qualified ? 1 : 0,
      lead.total || 0,
      JSON.stringify(lead.keywords || []),
      lead.status,
      clientIp(context.request, context.env),
      clientCountry(context.request, context.env),
      context.request.headers.get("User-Agent") || "",
      lead.page_url || "",
      leadRef,
      submission.submissionId,
      Number(lead.cost || 0)
    ),
    ...jobs.map((job) => jobStatement(db, job)),
    db
      .prepare(
        `UPDATE submissions
         SET state = 'complete', lead_ref = ?1, response_json = ?2,
             response_status = ?3, updated_at = CURRENT_TIMESTAMP
         WHERE submission_id = ?4 AND lease_token = ?5`
      )
      .bind(
        leadRef,
        JSON.stringify(responseBody),
        responseStatus,
        submission.submissionId,
        submission.leaseToken
      ),
  ];
  const results = await db.batch(statements);
  const completion = results[results.length - 1];
  if (!completion.meta || completion.meta.changes !== 1) {
    throw new Error("submission_lease_lost");
  }
  kickIntegrationJobs(context);
  return { body: responseBody, status: responseStatus };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!validFunnelOrigin(request)) return json({ error: "forbidden_origin" }, 403);
  const contentType = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 8192) return json({ error: "payload_too_large" }, 413);

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) {
      return json({ error: "payload_too_large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "bad_request" }, 400);
  }

  // Honeypot: real users never see this field; bots fill it.
  if (String(body.company || "").trim()) {
    return json({ error: "bad_request" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const pageUrl = typeof body.page_url === "string" ? body.page_url.slice(0, 300) : "";
  const domain = normalizeDomain(body.website_url);
  // Meta attribution context from the browser (pixel cookies + shared
  // dedup id); carried on the lead object, never stored in D1.
  const metaCtx = {
    event_id: String(body.event_id || "").slice(0, 80),
    fbp: String(body.fbp || "").slice(0, 128),
    fbc: String(body.fbc || "").slice(0, 256),
    external_id: String(body.external_id || "").slice(0, 64),
  };

  if (!domain) return json({ error: "invalid_domain" }, 400);
  if (!name || name.length > 120) return json({ error: "invalid_name" }, 400);
  const phoneDigits = phone.replace(/\D/g, "");
  if (phone.length > 40 || phoneDigits.length < 7 || phoneDigits.length > 15) {
    return json({ error: "invalid_phone" }, 400);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }
  if (!validFunnelPageUrl(pageUrl)) return json({ error: "invalid_page_url" }, 400);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(metaCtx.event_id)) {
    return json({ error: "invalid_submission_id" }, 400);
  }
  // Fail before spending DataForSEO credit when durable lead storage or the
  // signing key needed for the booking handoff is unavailable.
  if (!env.LEADS_DB || !env.FUNNEL_SIGNING_KEY) {
    return json({ error: "storage_unavailable" }, 503);
  }
  const ip = clientIp(request, env);
  if (!ip) return json({ error: "client_identity_unavailable" }, 503);

  let submission;
  try {
    submission = await claimSubmission(env.LEADS_DB, metaCtx.event_id);
  } catch (error) {
    console.log("submission_claim_error", String(error).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }
  if (submission.cached) return json(submission.cached, submission.status);
  if (!submission.owner) {
    return json({ error: "processing", retry_after_ms: 1000 }, 409);
  }

  const leadBase = {
    name,
    phone,
    email,
    domain,
    page_url: pageUrl,
    ...metaCtx,
  };
  try {
    const ipCount = await reserveUsage(
      env.LEADS_DB,
      "rank_check_ip_hour",
      ip,
      "strftime('%Y-%m-%d %H:00:00', 'now')"
    );
    const dailyCount = await reserveUsage(
      env.LEADS_DB,
      "rank_check_global_day",
      "all",
      "date('now')"
    );
    const dailyLimit = Math.max(50, Number(env.MAX_DAILY_CHECKS) || 500);
    if (ipCount > 5 || dailyCount > dailyLimit) {
      const limited = await saveLead(
        context,
        {
          ...leadBase,
          qualified: false,
          status: ipCount > 5 ? "rate_limited" : "capacity_limited",
        },
        { submissionId: metaCtx.event_id, leaseToken: submission.leaseToken },
        429,
        (leadToken) => ({
          error: ipCount > 5 ? "rate_limited" : "capacity_limited",
          saved: true,
          lead_token: leadToken,
        })
      );
      return json(limited.body, limited.status);
    }
  } catch (error) {
    console.log("usage_reservation_error", String(error).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }

  // Reuse a recent result for the same public domain. This avoids charging
  // DataForSEO repeatedly when colleagues or browser retries check one firm.
  let cachedResult = null;
  try {
    cachedResult = await env.LEADS_DB
      .prepare(
        `SELECT qualified, total_boost_fits, top_keywords, status
         FROM leads
         WHERE domain = ?1 AND status IN ('qualified', 'no_fit')
           AND created_at > datetime('now', '-15 minutes')
         ORDER BY id DESC LIMIT 1`
      )
      .bind(domain)
      .first();
  } catch (error) {
    console.log("domain_cache_error", String(error).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }

  // The check itself, the keyword filter and the money math all live in
  // _rankmodel.js so the partner lookup returns identical numbers.
  let allThemes;
  let total;
  let cost = 0;
  if (cachedResult) {
    try {
      allThemes = JSON.parse(cachedResult.top_keywords || "[]");
    } catch {
      allThemes = [];
    }
    total = Number(cachedResult.total_boost_fits) || 0;
  } else {
    try {
      const res = await fetchRankedKeywords(env, domain);
      allThemes = buildThemes(res.items);
      total = res.total;
      cost = res.cost;
    } catch (err) {
      const status = err.status || "check_failed";
      try {
        const saved = await saveLead(
          context,
          {
            ...leadBase,
            qualified: false,
            status,
            cost: Number(err.cost || 0),
          },
          { submissionId: metaCtx.event_id, leaseToken: submission.leaseToken },
          status === "not_configured" ? 500 : 502,
          (leadToken) => ({
            error: status === "not_configured" ? "not_configured" : "check_failed",
            saved: true,
            lead_token: leadToken,
          })
        );
        return json(saved.body, saved.status);
      } catch (saveErr) {
        console.log("lead_store_error", String(saveErr).slice(0, 200));
        return json({ error: "storage_unavailable" }, 503);
      }
    }
  }

  const { keywords, displayThemes } = projectKeywords(domain, allThemes, 8);

  const qualified = keywords.length > 0;

  try {
    const saved = await saveLead(
      context,
      {
        ...leadBase,
        qualified,
        total,
        keywords: allThemes,
        cost,
        status: qualified ? "qualified" : "no_fit",
      },
      { submissionId: metaCtx.event_id, leaseToken: submission.leaseToken },
      200,
      (leadToken) => ({
        qualified,
        reason_not_qualified: qualified ? null : "no_supported_keywords",
        domain,
        total,
        groups: displayThemes.length,
        keywords,
        lead_token: leadToken,
        cached: Boolean(cachedResult),
      })
    );
    return json(saved.body, saved.status);
  } catch (err) {
    console.log("lead_store_error", String(err).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }
}
