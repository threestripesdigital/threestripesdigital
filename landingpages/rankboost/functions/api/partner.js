// POST /api/partner — password-gated rank lookup for the outbound agency.
//   { code, website_url }        -> run a lookup, same math as funnel step 2
//   { code, action: "history" }  -> the agency's own past lookups
//
// Takes no name / phone / email and never enters the lead funnel: no Kit tag,
// no Meta events, no booking sequence. Logged to its own D1 table and posted
// to its own Slack channel, with the real DataForSEO cost of each call and a
// running total so Bilal can see the spend as it happens.
//
// Requires env: PARTNER_ACCESS_CODE, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD.
// Slack: SLACK_BOT_TOKEN + SLACK_CHANNEL_ID_PARTNER, else
// SLACK_WEBHOOK_URL_PARTNER, else SLACK_WEBHOOK_URL.

import {
  buildThemes,
  projectKeywords,
  fetchRankedKeywords,
  normalizeDomain,
} from "./_rankmodel.js";
import {
  authFailureStatus,
  fromTrustedRouter,
  sameValue,
} from "./_security.js";

// Every lookup on this endpoint comes from the same partner, so there is
// nothing for them to type.
const PARTNER_LABEL = "EagleRev";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientIp(request, env) {
  if (fromTrustedRouter(request, env)) {
    const fwd = request.headers.get("X-Forwarded-Client-IP");
    if (fwd) return fwd;
  }
  return request.headers.get("CF-Connecting-IP") || "";
}

const money = (n) => "$" + Number(n).toLocaleString("en-US");
const usd = (n) => "$" + Number(n || 0).toFixed(4);

// Its own table, so partner lookups never mix into the real lead list.
async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS partner_lookups (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         domain TEXT, partner TEXT, qualified INTEGER,
         total_boost_fits INTEGER, top_keywords TEXT, opp_value INTEGER,
         status TEXT, ip TEXT, cost REAL DEFAULT 0,
         created_at TEXT DEFAULT CURRENT_TIMESTAMP
       )`
    )
    .run();
  // Tables created before cost tracking existed need the column added.
  try {
    await db.prepare("ALTER TABLE partner_lookups ADD COLUMN cost REAL DEFAULT 0").run();
  } catch {
    /* already present */
  }
}

async function logLookup(context, row) {
  const db = context.env.LEADS_DB;
  if (!db) return;
  try {
    await ensureTable(db);
    await db
      .prepare(
        `INSERT INTO partner_lookups
           (domain, partner, qualified, total_boost_fits, top_keywords, opp_value, status, ip, cost)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(
        row.domain, PARTNER_LABEL, row.qualified ? 1 : 0, row.total || 0,
        JSON.stringify(row.keywords || []), row.oppValue || 0,
        row.status, clientIp(context.request, context.env), row.cost || 0
      )
      .run();
  } catch (err) {
    console.log("partner_log_error", String(err).slice(0, 200));
  }
}

// Lifetime spend on this endpoint, so the Slack line can show a running tab.
async function costTotals(db) {
  try {
    const { results } = await db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost), 0) AS spend FROM partner_lookups")
      .all();
    const r = (results && results[0]) || {};
    return { count: Number(r.n || 0), spend: Number(r.spend || 0) };
  } catch {
    return { count: 0, spend: 0 };
  }
}

function partnerText(row, totals) {
  const flag = row.qualified
    ? "✅ QUALIFIED"
    : row.status === "no_fit"
      ? "❌ no boost fits"
      : "⚠️ " + row.status;

  const lines = [
    ":mag: *Partner rank lookup*  (internal, not a lead)",
    `*Looked up by:*  ${PARTNER_LABEL}`,
    `*Website:*  ${row.domain}`,
    `*Status:*  ${flag}`,
    `*Keywords in 11–50:*  ${row.total || 0}`,
  ];
  if (row.oppValue > 0) {
    lines.push(`*Opportunity:*  ${money(row.oppValue)}/mo across their top ${row.keywords.length} money keyword${row.keywords.length === 1 ? "" : "s"}`);
  }
  if (row.keywords && row.keywords.length) {
    lines.push("*Top money keywords*");
    for (const k of row.keywords.slice(0, 5)) {
      const url = k.url ? `\n      ${k.url}` : "";
      lines.push(`*${k.keyword}*\n      #${k.position} · ${Number(k.volume).toLocaleString("en-US")} searches/mo · ${money(k.opp_value)}/mo at #1${url}`);
    }
  }
  // Running tab: what this call cost, and everything spent here so far.
  lines.push(
    `*Cost:*  ${usd(row.cost)} this lookup  ·  ${usd(totals.spend)} total across ` +
    `${totals.count} lookup${totals.count === 1 ? "" : "s"}`
  );
  return lines.join("\n\n");
}

// Own channel when wired: bot token first, then a dedicated webhook, then
// (last resort) the main lead webhook so a lookup is never silently dropped.
async function notifySlack(context, row, totals) {
  const env = context.env;
  const text = partnerText(row, totals);

  if (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID_PARTNER) {
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        // No link previews: the ranking URLs would each unfurl into a card
        // and bury the actual numbers.
        body: JSON.stringify({
          channel: env.SLACK_CHANNEL_ID_PARTNER,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) return;
      console.log("partner_slack_bot_error", data && data.error);
    } catch (err) {
      console.log("partner_slack_bot_throw", String(err).slice(0, 120));
    }
  }

  const hook = env.SLACK_WEBHOOK_URL_PARTNER || env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
  }).catch(() => {});
}

// The agency's own log of what they have already checked. Cost is
// deliberately omitted: that is Bilal's number, not theirs.
async function history(context) {
  const db = context.env.LEADS_DB;
  if (!db) return json({ lookups: [] });
  try {
    await ensureTable(db);
    const { results } = await db
      .prepare(
        `SELECT domain, qualified, total_boost_fits, opp_value, status, created_at
         FROM partner_lookups ORDER BY id DESC LIMIT 100`
      )
      .all();
    return json({
      lookups: (results || []).map((r) => ({
        domain: r.domain,
        qualified: !!r.qualified,
        total: r.total_boost_fits,
        opp_value: r.opp_value,
        status: r.status,
        at: r.created_at,
      })),
    });
  } catch (err) {
    console.log("partner_history_error", String(err).slice(0, 200));
    return json({ lookups: [] });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.PARTNER_ACCESS_CODE) return json({ error: "not_configured" }, 503);
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim();
  if (contentType !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 4096) return json({ error: "payload_too_large" }, 413);

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4096) {
      return json({ error: "payload_too_large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "bad_request" }, 400);
  }

  if (!sameValue(String(body.code || ""), env.PARTNER_ACCESS_CODE)) {
    const status = await authFailureStatus(request, env, "partner");
    return json({ error: status === 429 ? "rate_limited" : "forbidden" }, status);
  }

  if (body.action === "history") return history(context);

  const domain = normalizeDomain(body.website_url);
  if (!domain) return json({ error: "invalid_domain" }, 400);

  // Atomically reserve an hourly lookup slot before spending DataForSEO
  // credit. The unique counter row prevents concurrent requests racing past
  // the limit.
  const ip = clientIp(request, env);
  if (env.LEADS_DB && ip) {
    try {
      const row = await env.LEADS_DB
        .prepare(
          `INSERT INTO usage_counters (scope, counter_key, bucket, count)
           VALUES ('partner_lookup_hour', ?1, strftime('%Y-%m-%d %H:00:00', 'now'), 1)
           ON CONFLICT(scope, counter_key, bucket)
           DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP
           RETURNING count`
        )
        .bind(ip)
        .first();
      if (Number(row && row.count) > 60) {
        return json({ error: "rate_limited" }, 429);
      }
    } catch {
      return json({ error: "storage_unavailable" }, 503);
    }
  }

  let items, total, cost;
  try {
    const res = await fetchRankedKeywords(env, domain);
    items = res.items;
    total = res.total;
    cost = res.cost;
  } catch (err) {
    const status = err.status || "check_failed";
    await logLookup(context, { domain, qualified: false, status, keywords: [], cost: 0 });
    return json({ error: status === "not_configured" ? "not_configured" : "check_failed" }, 502);
  }

  const allThemes = buildThemes(items);
  const { keywords, displayThemes } = projectKeywords(domain, allThemes, 10);
  const qualified = keywords.length > 0;

  // Headline number: the same summed monthly gap step 2 shows a prospect.
  const oppValue = keywords.reduce(
    (sum, k) => sum + Math.max(0, (Number(k.opp_value) || 0) - (Number(k.now_value) || 0)),
    0
  );

  const row = {
    domain, qualified, total, keywords, oppValue, cost,
    status: qualified ? "qualified" : "no_fit",
  };

  // Log first so the running total includes this call, then notify.
  await logLookup(context, row);
  const totals = env.LEADS_DB ? await costTotals(env.LEADS_DB) : { count: 1, spend: cost };
  try {
    context.waitUntil(notifySlack(context, row, totals));
  } catch {
    await notifySlack(context, row, totals);
  }

  return json({
    qualified, domain, total,
    groups: displayThemes.length,
    opp_value: oppValue,
    keywords,
  });
}
