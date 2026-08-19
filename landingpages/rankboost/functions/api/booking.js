// POST /api/booking — verify a booking against the signed lead and the
// configured Rank Boost event before rendering confirmation details.

import { validFunnelOrigin, verifyLeadToken } from "./_security.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function calendlyIdentifier(value, kind) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-z0-9_-]{20,80}$/i.test(raw)) return { uri: "", id: raw };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "api.calendly.com") return null;
    const pattern = kind === "invitee"
      ? /^\/scheduled_events\/[^/]+\/invitees\/([^/]+)\/?$/
      : /^\/scheduled_events\/([^/]+)\/?$/;
    const match = url.pathname.match(pattern);
    if (!match) return null;
    return { uri: url.href.replace(/\/$/, ""), id: match[1] };
  } catch {
    return null;
  }
}

function matchesIdentifier(resourceUri, identifier) {
  if (!identifier) return true;
  if (identifier.uri) return resourceUri === identifier.uri;
  return String(resourceUri || "").split("/").pop() === identifier.id;
}

function formatBooking(row) {
  return {
    verified: true,
    invitee: row.invitee_uri,
    event: row.event_uri,
    start: row.scheduled_start_at
      ? String(row.scheduled_start_at).replace(" ", "T") + "Z"
      : "",
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.LEADS_DB || !env.FUNNEL_SIGNING_KEY || !env.CALENDLY_EVENT_TYPE_URI) {
    return json(503, { verified: false });
  }
  if (!validFunnelOrigin(request)) return json(403, { verified: false });
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim();
  if (contentType !== "application/json") return json(415, { verified: false });
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 8192) return json(413, { verified: false });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { verified: false });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { verified: false });
  }
  const claims = await verifyLeadToken(env.FUNNEL_SIGNING_KEY, body.token);
  if (!claims) return json(401, { verified: false });

  if (body.action === "access") {
    try {
      const lead = await env.LEADS_DB
        .prepare("SELECT qualified FROM leads WHERE lead_ref = ?1 LIMIT 1")
        .bind(claims.ref)
        .first();
      return Number(lead && lead.qualified) === 1
        ? json(200, { eligible: true })
        : json(403, { eligible: false });
    } catch (error) {
      console.log("booking_access_error", String(error).slice(0, 160));
      return json(503, { eligible: false });
    }
  }

  const expectedInvitee = calendlyIdentifier(body.invitee, "invitee");
  const expectedEvent = calendlyIdentifier(body.event, "event");
  if (!expectedInvitee || !expectedEvent) {
    return json(400, { verified: false });
  }

  try {
    const expectedEventType = String(env.CALENDLY_EVENT_TYPE_URI).replace(/\/$/, "");
    const row = await env.LEADS_DB
      .prepare(
        `SELECT i.invitee_uri, i.event_uri, i.scheduled_start_at
         FROM leads AS l
         JOIN calendly_invitees AS i
           ON i.invitee_uri = l.calendly_invitee_uri
         WHERE l.lead_ref = ?1
           AND l.qualified = 1
           AND l.status = 'booked'
           AND i.status = 'booked'
           AND i.event_type_uri = ?2
           AND i.scheduled_start_at IS NOT NULL
         LIMIT 1`
      )
      .bind(claims.ref, expectedEventType)
      .first();
    if (!row) return json(404, { verified: false, pending: true });
    if (!matchesIdentifier(row.invitee_uri, expectedInvitee)) {
      return json(404, { verified: false });
    }
    if (!matchesIdentifier(row.event_uri, expectedEvent)) {
      return json(404, { verified: false });
    }
    return json(200, formatBooking(row));
  } catch (error) {
    console.log("booking_lookup_error", String(error).slice(0, 200));
    return json(503, { verified: false });
  }
}
