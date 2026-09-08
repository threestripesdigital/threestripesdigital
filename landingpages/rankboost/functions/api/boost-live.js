// Manual "boost is live" trigger. Bilal hits this the moment a client's boost
// launches; it flips the lead into the boost-live Kit track (K5-K8) and fires
// the "go google your keyword right now" SMS while the ranking is actually up.
//
//   POST /api/boost-live
//   Authorization: Bearer <BOOST_ADMIN_TOKEN>
//   JSON: { "email": "lead@example.com", "dry": true }
//
// Provider calls are queued atomically with the D1 lifecycle update. Replays
// are safe: every provider job has a stable unique key.

import {
  authFailureStatus,
  bearerToken,
  sameValue,
} from "./_security.js";
import { jobStatementForLeadState, kickIntegrationJobs } from "./_jobs.js";
import { KIT_TAG_IDS } from "./_kit.js";
import { projectKeywords } from "./_rankmodel.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BOOST_ADMIN_TOKEN) return json({ error: "not_configured" }, 503);
  if (!sameValue(bearerToken(request), env.BOOST_ADMIN_TOKEN)) {
    const status = await authFailureStatus(request, env, "boost-live");
    return json({ error: status === 429 ? "rate_limited" : "forbidden" }, status);
  }

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
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }
  const dry = body.dry === true;

  const db = env.LEADS_DB;
  if (!db) return json({ error: "no_db" }, 503);
  let row;
  try {
    row = await db
      .prepare(
        `SELECT id, lead_ref, name, phone, email, domain, top_keywords,
                status, qualified, boost_live_at
         FROM leads
         WHERE lower(email) = ?1 ORDER BY created_at DESC LIMIT 1`
      )
      .bind(email)
      .first();
  } catch {
    return json({ error: "storage_unavailable" }, 503);
  }
  if (!row) return json({ error: "lead_not_found", email }, 404);
  if (Number(row.qualified) !== 1) return json({ error: "not_boost_qualified" }, 409);

  const firstName = (row.name || "").trim().split(/\s+/)[0] || "";

  // The first persisted money-keyword theme is the same source used to build
  // the lead's personalized Kit fields.
  let keyword = "";
  try {
    const themes = JSON.parse(row.top_keywords || "[]");
    const projected = projectKeywords(row.domain || "", themes, 1).keywords;
    if (projected[0] && projected[0].keyword) {
      keyword = String(projected[0].keyword).slice(0, 100);
    }
  } catch {
    /* leave empty */
  }

  const result = {
    ok: true,
    dry,
    email,
    name: row.name || "",
    phone: row.phone || "",
    keyword,
    already_live: Boolean(row.boost_live_at),
    queued: [],
  };
  if (dry) return json(result);

  if (row.boost_live_at) {
    kickIntegrationJobs(context, 4);
    return json(result);
  }
  if (row.status !== "booked") {
    return json({ error: "invalid_lifecycle_state" }, 409);
  }

  const leadRef = row.lead_ref || `legacy-${row.id}`;
  const sourceKey = `boost-live:${leadRef}`;
  const bookedTagKey = `${sourceKey}:kit-booked`;
  const jobs = [
    {
      leadRef: row.lead_ref || null,
      kind: "kit.upsert_tag",
      dedupeKey: bookedTagKey,
      payload: {
        email,
        first_name: firstName,
        tag_id: KIT_TAG_IDS.booked,
      },
    },
    {
      leadRef: row.lead_ref || null,
      kind: "kit.upsert_tag",
      dedupeKey: `${sourceKey}:kit`,
      dependsOnDedupeKey: bookedTagKey,
      payload: {
        email,
        first_name: firstName,
        tag_id: KIT_TAG_IDS.boostLive,
      },
    },
  ];

  if (row.phone) {
    jobs.push({
      leadRef: row.lead_ref || null,
      kind: "roezan.sms",
      dedupeKey: `${sourceKey}:roezan`,
      dependsOnDedupeKey: bookedTagKey,
      payload: {
        phone: row.phone,
        first_name: firstName,
        message:
          `Hey ${firstName || "there"}, Bilal here. Your rank boost just went ` +
          `LIVE. Open Google right now and search "${keyword || "your keyword"}" ` +
          `and look for your firm. Screenshot where you land—that's your ` +
          `before-and-after. Reply STOP to opt out.`,
      },
    });
  }

  jobs.push({
    leadRef: row.lead_ref || null,
    kind: "slack.webhook",
    dedupeKey: `${sourceKey}:slack`,
    dependsOnDedupeKey: bookedTagKey,
    payload: {
      text:
        `:rocket: *Boost LIVE trigger* — ${row.name || email}\n` +
        `Keyword: ${keyword || "?"} · durable Kit/SMS delivery queued`,
      unfurl_links: false,
      unfurl_media: false,
    },
  });

  try {
    const stored = await db.batch([
      db
        .prepare(
          `UPDATE leads SET status = 'boost_live',
             boost_live_at = COALESCE(boost_live_at, CURRENT_TIMESTAMP)
           WHERE id = ?1 AND status = 'booked' AND qualified = 1 AND boost_live_at IS NULL`
        )
        .bind(row.id),
      ...jobs.map((job) =>
        jobStatementForLeadState(db, job, row.id, "boost_live")
      ),
    ]);
    const transitioned = Number(stored[0] && stored[0].meta && stored[0].meta.changes) === 1;
    if (!transitioned) {
      const current = await db
        .prepare("SELECT status, boost_live_at FROM leads WHERE id = ?1")
        .bind(row.id)
        .first();
      if (current && current.status === "boost_live" && current.boost_live_at) {
        result.already_live = true;
        kickIntegrationJobs(context, 4);
        return json(result);
      }
      return json({ error: "invalid_lifecycle_state" }, 409);
    }
  } catch (error) {
    console.log("boost_live_job_store_error", String(error).slice(0, 200));
    return json({ error: "storage_unavailable" }, 503);
  }

  result.queued = jobs.map((job) => job.kind);
  kickIntegrationJobs(context, 4);
  return json(result);
}

export function onRequestGet() {
  return json({ error: "method_not_allowed" }, 405);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
