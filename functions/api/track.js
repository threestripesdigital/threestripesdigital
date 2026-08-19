// POST /api/track — server-side Conversions API relay for funnel events that
// happen on static pages, so they survive ad blockers like the endpoint-driven
// events already do.
//
// Body: { event_name, event_id, lead_token, fbp, fbc, external_id, page_url }
//
// The browser fires the same event with the same event_id, so Meta dedupes the
// pair. Only funnel events are accepted: this endpoint is public, and an open
// relay would let anyone inject conversions into the dataset.
//
// Requires env: META_CAPI_TOKEN, META_DATASET_ID.

import {
  fromTrustedRouter,
  validFunnelOrigin,
  validFunnelPageUrl,
  verifyLeadToken,
} from "./_security.js";
import { jobStatementUnlessEvent, kickIntegrationJobs } from "./_jobs.js";

// The only event a static page in this funnel legitimately fires. Lead,
// QualifiedLead and Schedule are sent by their own endpoints, which have
// their own inputs and checks, and are deliberately NOT accepted here: this
// URL is public, so anything it accepts is something a stranger could post.
const ALLOWED = new Set(["BookingStarted"]);

function clientIp(request, env) {
  if (fromTrustedRouter(request, env)) {
    const fwd = request.headers.get("X-Forwarded-Client-IP");
    if (fwd) return fwd;
  }
  return request.headers.get("CF-Connecting-IP") || "";
}

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
    country: pick("X-Forwarded-Client-Country", "country"),
  };
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Nothing to validate against, and nothing to leak: fail quietly.
  if (!env.FUNNEL_SIGNING_KEY || !env.LEADS_DB || !validFunnelOrigin(request)) {
    return new Response(null, { status: 204 });
  }
  const contentType = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim();
  if (contentType !== "application/json") return new Response(null, { status: 204 });

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) {
      return new Response(null, { status: 204 });
    }
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(null, { status: 204 });
  }

  const eventName = String(body.event_name || "");
  if (!ALLOWED.has(eventName)) return new Response(null, { status: 204 });

  const claims = await verifyLeadToken(
    env.FUNNEL_SIGNING_KEY,
    String(body.lead_token || "")
  );
  if (!claims) return new Response(null, { status: 204 });

  let lead;
  try {
    lead = await env.LEADS_DB
      .prepare(
        "SELECT name, phone, email, domain FROM leads WHERE lead_ref = ?1 LIMIT 1"
      )
      .bind(claims.ref)
      .first();
  } catch (error) {
    console.log("track_lead_lookup_error", String(error).slice(0, 200));
    return new Response(null, { status: 503 });
  }
  if (!lead) return new Response(null, { status: 204 });
  if (!validFunnelPageUrl(body.page_url)) return new Response(null, { status: 204 });
  const eventId = String(body.event_id || "").slice(0, 80);
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(eventId)) {
    return new Response(null, { status: 204 });
  }

  const geo = clientGeo(request, env);
  const userData = {
    client_ip_address: clientIp(request, env) || undefined,
    client_user_agent: request.headers.get("User-Agent") || undefined,
  };
  if (body.fbp) userData.fbp = String(body.fbp).slice(0, 128);
  if (body.fbc) userData.fbc = String(body.fbc).slice(0, 256);
  if (body.external_id) userData.external_id = [await sha256(String(body.external_id).slice(0, 64))];

  const email = String(lead.email || "").trim().toLowerCase();
  if (email) userData.em = [await sha256(email)];

  let digits = String(lead.phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (digits) userData.ph = [await sha256(digits)];

  const name = String(lead.name || "").trim().toLowerCase();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts[0]) userData.fn = [await sha256(parts[0])];
    const last = parts.slice(1).join(" ");
    if (last) userData.ln = [await sha256(last)];
  }
  if (geo.city) userData.ct = [await sha256(geo.city.toLowerCase().replace(/\s/g, ""))];
  if (geo.region) userData.st = [await sha256(geo.region.toLowerCase().slice(0, 2))];
  if (geo.postal) userData.zp = [await sha256(String(geo.postal).replace(/[^0-9]/g, "").slice(0, 5))];
  if (geo.country) userData.country = [await sha256(geo.country.toLowerCase())];

  const events = [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: String(body.page_url || "").slice(0, 300) || undefined,
        action_source: "website",
        user_data: userData,
        custom_data: {
          content_name: "rank-boost-call",
          domain: String(lead.domain || "").slice(0, 120) || undefined,
        },
      },
  ];

  const eventKey = eventName + ":" + claims.ref;
  try {
    await env.LEADS_DB.batch([
      // Queue first, guarded by the durable receipt. Concurrent first attempts
      // still collapse on the job dedupe key; later replays stay suppressed
      // even after retention removes the completed job.
      jobStatementUnlessEvent(env.LEADS_DB, {
        leadRef: claims.ref,
        kind: "meta.events",
        dedupeKey: `booking-started:${claims.ref}:meta`,
        payload: { events },
      }, eventKey),
      env.LEADS_DB
        .prepare(
          "INSERT OR IGNORE INTO funnel_events (event_key, lead_ref, event_name) VALUES (?1, ?2, ?3)"
        )
        .bind(eventKey, claims.ref, eventName),
    ]);
    kickIntegrationJobs(context);
  } catch (error) {
    console.log("track_job_store_error", String(error).slice(0, 200));
    return new Response(null, { status: 503 });
  }

  // The browser never needs the result, and a body would only invite probing.
  return new Response(null, { status: 204 });
}
