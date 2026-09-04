// POST /api/scout — password-gated Keyword Scout for Bilal.
//   { code, website_url, location?, fresh? } -> top 100 keywords for ANY site,
//                                              scored by commercial intent,
//                                              positions 2-50 flagged as boosts
//   { code, action: "history" }               -> past lookups (ids, no keywords)
//   { code, action: "load", id }              -> a stored lookup, no re-billing
//
// Niche-agnostic and never touches the lead funnel: no Slack, no Kit, no
// Meta, no lead rows. Results are stored in their own D1 table so a domain
// looked up again within a day comes back from storage instead of costing
// another DataForSEO call (pass fresh: true to force a live pull).
//
// Requires env: SCOUT_ACCESS_CODE, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD.

import {
  buildScoutRows,
  fetchScoutKeywords,
  resolveLocation,
  DEFAULT_LOCATION,
} from "./_scoutmodel.js";
import { normalizeDomain } from "./_rankmodel.js";
import {
  authFailureStatus,
  fromTrustedRouter,
  sameValue,
} from "./_security.js";

const CACHE_WINDOW = "-1 day";

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

async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS scout_lookups (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         domain TEXT, location TEXT, status TEXT,
         total INTEGER DEFAULT 0, boost_count INTEGER DEFAULT 0,
         keywords TEXT, cost REAL DEFAULT 0, ip TEXT,
         created_at TEXT DEFAULT CURRENT_TIMESTAMP
       )`
    )
    .run();
}

async function saveLookup(context, row) {
  const db = context.env.LEADS_DB;
  if (!db) return null;
  try {
    await ensureTable(db);
    const res = await db
      .prepare(
        `INSERT INTO scout_lookups
           (domain, location, status, total, boost_count, keywords, cost, ip)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         RETURNING id, created_at`
      )
      .bind(
        row.domain, row.location, row.status, row.total || 0, row.boostCount || 0,
        JSON.stringify(row.keywords || []), row.cost || 0,
        clientIp(context.request, context.env)
      )
      .first();
    return res || null;
  } catch (err) {
    console.log("scout_log_error", String(err).slice(0, 200));
    return null;
  }
}

function boostCount(rows) {
  return rows.reduce((n, r) => n + (r.boost ? 1 : 0), 0);
}

function responseFor(domain, location, rows, extra) {
  return {
    domain,
    location: location.key,
    location_label: location.label,
    total: extra.total || rows.length,
    boost_count: boostCount(rows),
    keywords: rows,
    cost: Number(extra.cost || 0),
    cached: Boolean(extra.cached),
    id: extra.id || null,
    at: extra.at || null,
  };
}

async function history(context) {
  const db = context.env.LEADS_DB;
  if (!db) return json({ lookups: [] });
  try {
    await ensureTable(db);
    const { results } = await db
      .prepare(
        `SELECT id, domain, location, status, total, boost_count, cost, created_at
         FROM scout_lookups ORDER BY id DESC LIMIT 80`
      )
      .all();
    return json({
      lookups: (results || []).map((r) => ({
        id: r.id,
        domain: r.domain,
        location: r.location,
        status: r.status,
        total: r.total,
        boost_count: r.boost_count,
        cost: r.cost,
        at: r.created_at,
      })),
    });
  } catch (err) {
    console.log("scout_history_error", String(err).slice(0, 200));
    return json({ lookups: [] });
  }
}

async function load(context, id) {
  const db = context.env.LEADS_DB;
  if (!db) return json({ error: "storage_unavailable" }, 503);
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId <= 0) return json({ error: "bad_request" }, 400);
  try {
    await ensureTable(db);
    const r = await db
      .prepare(
        `SELECT id, domain, location, status, total, keywords, cost, created_at
         FROM scout_lookups WHERE id = ?1 AND status = 'ok'`
      )
      .bind(rowId)
      .first();
    if (!r) return json({ error: "not_found" }, 404);
    const location = resolveLocation(r.location) || resolveLocation(DEFAULT_LOCATION);
    let rows = [];
    try { rows = JSON.parse(r.keywords || "[]"); } catch { rows = []; }
    return json(responseFor(r.domain, location, rows, {
      total: r.total, cost: r.cost, cached: true, id: r.id, at: r.created_at,
    }));
  } catch (err) {
    console.log("scout_load_error", String(err).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }
}

async function recentLookup(db, domain, locationKey) {
  try {
    await ensureTable(db);
    return await db
      .prepare(
        `SELECT id, total, keywords, cost, created_at
         FROM scout_lookups
         WHERE domain = ?1 AND location = ?2 AND status = 'ok'
           AND created_at > datetime('now', '${CACHE_WINDOW}')
         ORDER BY id DESC LIMIT 1`
      )
      .bind(domain, locationKey)
      .first();
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SCOUT_ACCESS_CODE) return json({ error: "not_configured" }, 503);
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

  if (!sameValue(String(body.code || ""), env.SCOUT_ACCESS_CODE)) {
    const status = await authFailureStatus(request, env, "scout");
    return json({ error: status === 429 ? "rate_limited" : "forbidden" }, status);
  }

  if (body.action === "history") return history(context);
  if (body.action === "load") return load(context, body.id);

  const domain = normalizeDomain(body.website_url);
  if (!domain) return json({ error: "invalid_domain" }, 400);
  const location = resolveLocation(body.location || DEFAULT_LOCATION);
  if (!location) return json({ error: "invalid_location" }, 400);

  // Stored result from the last day unless a fresh pull was asked for.
  if (env.LEADS_DB && !body.fresh) {
    const recent = await recentLookup(env.LEADS_DB, domain, location.key);
    if (recent) {
      let rows = [];
      try { rows = JSON.parse(recent.keywords || "[]"); } catch { rows = []; }
      return json(responseFor(domain, location, rows, {
        total: recent.total, cost: recent.cost, cached: true,
        id: recent.id, at: recent.created_at,
      }));
    }
  }

  // Reserve an hourly slot before spending DataForSEO credit.
  const ip = clientIp(request, env);
  if (env.LEADS_DB && ip) {
    try {
      const row = await env.LEADS_DB
        .prepare(
          `INSERT INTO usage_counters (scope, counter_key, bucket, count)
           VALUES ('scout_lookup_hour', ?1, strftime('%Y-%m-%d %H:00:00', 'now'), 1)
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
    const res = await fetchScoutKeywords(env, domain, location);
    items = res.items;
    total = res.total;
    cost = res.cost;
  } catch (err) {
    const status = err.status || "check_failed";
    await saveLookup(context, {
      domain, location: location.key, status, keywords: [], cost: Number(err.cost || 0),
    });
    return json(
      { error: status === "not_configured" ? "not_configured" : "check_failed" },
      status === "not_configured" ? 503 : 502
    );
  }

  const rows = buildScoutRows(items, domain);
  const saved = await saveLookup(context, {
    domain, location: location.key, status: "ok", total, cost,
    boostCount: boostCount(rows), keywords: rows,
  });

  return json(responseFor(domain, location, rows, {
    total, cost, cached: false,
    id: saved && saved.id, at: saved && saved.created_at,
  }));
}
