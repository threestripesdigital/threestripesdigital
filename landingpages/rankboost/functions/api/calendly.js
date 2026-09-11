import { smsScan, recoveryText } from './_smscopy.js';
import { WEBSITE_EMAILS } from "./_websiteemailconfig.js";
import { recoveryBookingLink } from "./_bookinglinks.js";
import { lifecycleEnabled } from "./_appointments.js";
import { WEBSITE_EVENT_TYPE_URI, WEBSITE_TAG_IDS, websiteEligible } from "./_offers.js";
import { qualifiedBookingEmailFields } from "./_emailfields.js";
// POST /api/calendly — Calendly webhook receiver (invitee.created / canceled).
// Verifies the Calendly signature, posts a BOOKED/CANCELED note to Slack with
// the qualifying answers, and flips the matching lead's status in D1.
// No-shows are also accepted defensively as webhooks, but the documented API
// exposes them on invitee resources, so the cron processor polls booked records.
//
// Requires env: CALENDLY_WEBHOOK_SIGNING_KEY, SLACK_WEBHOOK_URL (optional),
// LEADS_DB binding.

import { sameValue, verifyLeadToken } from "./_security.js";
import { kickIntegrationJobs } from "./_jobs.js";
import { KIT_TAG_IDS } from "./_kit.js";

const CALENDLY_POLL_LIMIT = 10;
const CALENDLY_POLL_WINDOW_DAYS = 14;

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function reject(status) {
  return new Response(JSON.stringify({ ok: false }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function validSignature(request, rawBody, key) {
  const header = request.headers.get("Calendly-Webhook-Signature") || "";
  if (!header || header.length > 2048) return false;
  let timestampValue = "";
  const signatures = [];
  for (const segment of header.split(",")) {
    const separator = segment.indexOf("=");
    if (separator < 1) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name === "t" && !timestampValue) timestampValue = value;
    if (name === "v1" && /^[a-f0-9]{64}$/i.test(value)) signatures.push(value);
  }
  if (!/^\d{9,12}$/.test(timestampValue) || !signatures.length) return false;
  const timestamp = Number(timestampValue);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", cryptoKey, enc.encode(timestampValue + "." + rawBody)
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let valid = false;
  for (const signature of signatures) {
    if (sameValue(hex, signature.toLowerCase())) valid = true;
  }
  return valid;
}

function normalizeDomain(raw) {
  if (!raw) return "";
  let value = String(raw).trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

function answerFor(qa, needle) {
  const hit = (qa || []).find((q) =>
    String(q.question || "").toLowerCase().includes(needle)
  );
  return hit ? String(hit.answer || "") : "";
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Server-side Meta CAPI Schedule event. event_id derives from the Calendly
// invitee UUID, matching the browser event fired on /thank-you.
async function metaLifecycleJob(
  eventName,
  { inviteeUri, name, email, phone },
  leadRef,
  sourceKey
) {
  const uuid = String(inviteeUri || "").split("/").pop();
  if (!uuid) return;

  const userData = {};
  if (email) userData.em = [await sha256(email.trim().toLowerCase())];
  if (phone) {
    let digits = phone.replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (digits) userData.ph = [await sha256(digits)];
  }
  if (name) {
    const parts = name.trim().toLowerCase().split(/\s+/);
    if (parts[0]) userData.fn = [await sha256(parts[0])];
    const last = parts.slice(1).join(" ");
    if (last) userData.ln = [await sha256(last)];
  }

  const events = [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id:
          eventName === "Schedule"
            ? "sched-" + uuid
            : eventName.toLowerCase() + "-" + uuid,
        event_source_url:
          eventName.startsWith("WebsiteConsultation")
            ? "https://threestripesdigital.com/rank-boost/law-firms/#qualify"
            : "https://threestripesdigital.com/rank-boost/law-firms/thank-you",
        action_source: "website",
        user_data: userData,
        custom_data: {
          content_name: eventName.startsWith("WebsiteConsultation") ? "website-consultation" : "rank-boost-call",
          lifecycle_status: eventName,
        },
      },
  ];
  return {
    leadRef,
    kind: "meta.events",
    dedupeKey: `${sourceKey}:meta`,
    payload: { events },
  };
}


// Roezan: fire the booking-confirmation SMS the thank-you page promises,
// from the verified toll-free number, asking for the YES reply.
function bookingSmsJob({ phone, firstName, startIso, tz }, leadRef, sourceKey) {
  if (!phone) return null;
  let when = "your booked time";
  try {
    const d = new Date(startIso);
    if (!isNaN(d)) {
      const zone = tz || "America/New_York";
      const day = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(d);
      const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(d);
      when = day + " at " + time;
    }
  } catch {
    /* fall back to generic wording */
  }
  const message =
    `Hey ${firstName || "there"}, it's Bilal from Three Stripes Digital. ` +
    `You're locked in for ${when}. Your first boost is free. Reply YES to confirm. Reply STOP to opt out.`;
  return {
    leadRef,
    kind: "roezan.sms",
    dedupeKey: `${sourceKey}:roezan`,
    payload: { phone, message, first_name: firstName || "" },
  };
}

async function followupSmsJob(env, kind, { phone, firstName }, leadRef, sourceKey) {
  if (!phone) return null;
  const bookingUrl = await recoveryBookingLink(env, leadRef);
  const lead=await env.LEADS_DB.prepare('SELECT domain,top_keywords,total_boost_fits FROM leads WHERE lead_ref=?1').bind(leadRef).first();
  const message=recoveryText(firstName,kind,smsScan(lead||{}),bookingUrl);
  return {
    leadRef,
    kind: "roezan.sms",
    dedupeKey: `${sourceKey}:roezan`,
    payload: { phone, message, first_name: firstName || "" },
  };
}

function websiteBookingFields(start, invitee) {
  const fields = qualifiedBookingEmailFields(start, invitee);
  return { website_call_date: fields.call_date, website_call_time: fields.call_time, website_reschedule_link: fields.calendly_link };
}

function kitUpsertTagJob(tagId, email, firstName, leadRef, sourceKey, fields, callStartIso) {
  if (!tagId || !email) return null;
  return {
    leadRef,
    kind: "kit.upsert_tag",
    dedupeKey: `${sourceKey}:kit`,
    payload: {
      tag_id: tagId,
      ...(Object.values(WEBSITE_TAG_IDS).includes(tagId) ? { remove_tag_ids: [...Object.values(WEBSITE_TAG_IDS).filter(id => id !== tagId), ...(tagId === WEBSITE_TAG_IDS.booked ? [WEBSITE_EMAILS.tags.stop] : [])] } : {}),
      email,
      first_name: firstName || "",
      ...(fields ? { fields } : {}),
      ...(callStartIso ? (tagId === WEBSITE_TAG_IDS.booked ? { website_call_start: callStartIso } : { qualified_call_start: callStartIso }) : {}),
    },
  };
}


function calendlyApiUri(value, requiredPath) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "api.calendly.com") return "";
    if (requiredPath && !url.pathname.includes(requiredPath)) return "";
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function inviteeUriFromPayload(p) {
  if (!p) return "";
  const inv = p.invitee;
  if (typeof inv === "string") return calendlyApiUri(inv, "/invitees/");
  if (inv && typeof inv === "object" && inv.uri) {
    return calendlyApiUri(inv.uri, "/invitees/");
  }
  if (p.uri) return calendlyApiUri(p.uri, "/invitees/");
  return "";
}

function directEventTypeUri(p) {
  const scheduled = p && p.scheduled_event;
  const value = scheduled && typeof scheduled === "object"
    ? scheduled.event_type
    : p && p.event_type;
  return calendlyApiUri(value, "/event_types/");
}

function scheduledEventUri(p) {
  const scheduled = p && p.scheduled_event;
  if (typeof scheduled === "string") {
    return calendlyApiUri(scheduled, "/scheduled_events/");
  }
  if (scheduled && typeof scheduled === "object" && scheduled.uri) {
    return calendlyApiUri(scheduled.uri, "/scheduled_events/");
  }
  const direct = calendlyApiUri(p && p.event, "/scheduled_events/");
  if (direct) return direct;
  const invitee = inviteeUriFromPayload(p);
  if (!invitee) return "";
  try {
    const url = new URL(invitee);
    url.pathname = url.pathname.replace(/\/invitees\/[^/]+\/?$/, "");
    return calendlyApiUri(url.href, "/scheduled_events/");
  } catch {
    return "";
  }
}

function relatedInviteeUri(p, key) {
  const value = p && p[key];
  if (typeof value === "string") return calendlyApiUri(value, "/invitees/");
  if (value && typeof value === "object") {
    return calendlyApiUri(value.uri, "/invitees/");
  }
  return "";
}

function providerEventAtMs(p, envelopeCreatedAt, kind = "") {
  const cancellation = p && p.cancellation;
  const noShow = p && p.no_show;
  const transitionTime = kind.includes("no_show")
    ? noShow && noShow.created_at
    : kind === "invitee.canceled"
      ? cancellation && cancellation.created_at
      : "";
  for (const value of [
    transitionTime,
    envelopeCreatedAt,
    p && p.updated_at,
    p && p.created_at,
  ]) {
    const timestamp = Date.parse(String(value || ""));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function sqliteTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function calendlyInviteeStatement(
  db,
  {
    inviteeUri,
    eventUri,
    eventTypeUri,
    leadRef,
    start,
    status,
    noShowAt,
    providerAt,
    oldInviteeUri,
    rescheduledToUri,
  }
) {
  if (!inviteeUri || !eventTypeUri || !Number.isFinite(providerAt)) return null;
  return db
    .prepare(
      `INSERT INTO calendly_invitees
         (invitee_uri, event_uri, event_type_uri, lead_ref,
           scheduled_start_at, status, no_show_at, provider_event_at_ms,
           old_invitee_uri, rescheduled_to_uri)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(invitee_uri) DO UPDATE SET
          event_uri = COALESCE(excluded.event_uri, calendly_invitees.event_uri),
          event_type_uri = excluded.event_type_uri,
          lead_ref = COALESCE(calendly_invitees.lead_ref, excluded.lead_ref),
         scheduled_start_at = COALESCE(
           excluded.scheduled_start_at, calendly_invitees.scheduled_start_at
         ),
          status = CASE
            WHEN calendly_invitees.status = 'no_show' THEN 'no_show'
            WHEN excluded.status = 'no_show' THEN 'no_show'
            WHEN calendly_invitees.status = 'canceled'
              AND excluded.status = 'booked' THEN 'canceled'
            ELSE excluded.status
          END,
          no_show_at = CASE
            WHEN excluded.status = 'no_show'
              THEN COALESCE(excluded.no_show_at, calendly_invitees.no_show_at)
            ELSE calendly_invitees.no_show_at
          END,
         poll_attempts = CASE
           WHEN excluded.status = 'no_show'
             THEN calendly_invitees.poll_attempts + 1
           ELSE calendly_invitees.poll_attempts
         END,
         last_checked_at = CASE
           WHEN excluded.status = 'no_show' THEN CURRENT_TIMESTAMP
           ELSE calendly_invitees.last_checked_at
         END,
         last_http_status = CASE
           WHEN excluded.status = 'no_show' THEN 200
           ELSE calendly_invitees.last_http_status
         END,
         last_error = CASE
           WHEN excluded.status = 'no_show' THEN NULL
           ELSE calendly_invitees.last_error
         END,
         poll_lease_token = CASE
           WHEN excluded.status IN ('canceled', 'no_show') THEN NULL
           ELSE calendly_invitees.poll_lease_token
         END,
          poll_lease_until = CASE
            WHEN excluded.status IN ('canceled', 'no_show') THEN NULL
            ELSE calendly_invitees.poll_lease_until
          END,
          provider_event_at_ms = excluded.provider_event_at_ms,
          old_invitee_uri = COALESCE(
            excluded.old_invitee_uri, calendly_invitees.old_invitee_uri
          ),
          rescheduled_to_uri = COALESCE(
            excluded.rescheduled_to_uri, calendly_invitees.rescheduled_to_uri
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE calendly_invitees.provider_event_at_ms IS NULL
           OR excluded.provider_event_at_ms >= calendly_invitees.provider_event_at_ms`
    )
    .bind(
      inviteeUri,
      eventUri || null,
      eventTypeUri,
      leadRef || null,
      sqliteTimestamp(start),
      status,
      status === "no_show"
        ? sqliteTimestamp(noShowAt) || sqliteTimestamp(Date.now())
        : null,
      providerAt,
      oldInviteeUri || null,
      rescheduledToUri || null
    );
}

function leadLifecycleStatement(
  db,
  {
    leadRef,
    inviteeUri,
    status,
    providerAt,
    oldInviteeUri,
    suppressTerminal,
    isWebsite = false,
  }
) {
  if (!leadRef || !inviteeUri || !Number.isFinite(providerAt)) return null;
  if (status === "booked") {
    return db
      .prepare(
        `UPDATE leads
         SET status = 'booked', calendly_invitee_uri = ?1,
              calendly_lifecycle_at = CURRENT_TIMESTAMP,
              calendly_provider_event_at_ms = ?3
          WHERE lead_ref = ?2
            AND qualified = ${isWebsite ? 0 : 1}
            AND status <> 'boost_live'
            AND EXISTS (
              SELECT 1 FROM calendly_invitees
              WHERE invitee_uri = ?1 AND status = 'booked'
                AND provider_event_at_ms = ?3
            )
            AND (
              calendly_provider_event_at_ms IS NULL
              OR ?3 > calendly_provider_event_at_ms
              OR (
                ?3 = calendly_provider_event_at_ms
                AND (
                  calendly_invitee_uri IS NULL
                  OR calendly_invitee_uri = ?1
                  OR (?4 IS NOT NULL AND calendly_invitee_uri = ?4)
                )
              )
            )`
      )
      .bind(inviteeUri, leadRef, providerAt, oldInviteeUri || null);
  }
  return db
    .prepare(
      `UPDATE leads
       SET status = ?1, calendly_invitee_uri = COALESCE(calendly_invitee_uri, ?2),
            calendly_lifecycle_at = CURRENT_TIMESTAMP,
            calendly_provider_event_at_ms = ?4
        WHERE lead_ref = ?3
          AND qualified = ${isWebsite ? 0 : 1}
          AND status <> 'boost_live'
           AND (
             calendly_invitee_uri = ?2 OR calendly_invitee_uri IS NULL
           )
          AND ?5 = 0
          AND (
            calendly_provider_event_at_ms IS NULL
            OR ?4 >= calendly_provider_event_at_ms
          )
          AND EXISTS (
            SELECT 1 FROM calendly_invitees
            WHERE invitee_uri = ?2
              AND status = CASE WHEN ?1 = 'booking_canceled' THEN 'canceled' ELSE ?1 END
              AND provider_event_at_ms = ?4
          )`
    )
    .bind(status, inviteeUri, leadRef, providerAt, suppressTerminal ? 1 : 0);
}

function calendlyJobStatement(
  db,
  { leadRef = null, kind, dedupeKey, payload },
  inviteeUri,
  sourceStatus,
  providerAt,
  isWebsite = false
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO integration_jobs
         (lead_ref, kind, dedupe_key, payload_json,
          source_resource, source_status)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (
         SELECT 1 FROM calendly_invitees
         WHERE invitee_uri = ?5 AND status = ?6
           AND provider_event_at_ms = ?7
       )
       AND (
         ?1 IS NULL OR EXISTS (
           SELECT 1 FROM leads
           WHERE lead_ref = ?1 AND calendly_invitee_uri = ?5
             AND qualified = ${isWebsite ? 0 : 1}
             AND status = CASE
               WHEN ?6 = 'canceled' THEN 'booking_canceled'
               ELSE ?6
             END
         )
       )`
    )
    .bind(
      leadRef,
      kind,
      dedupeKey,
      JSON.stringify(payload),
      inviteeUri,
      sourceStatus,
      providerAt
    );
}

async function resolveScheduledEvent(env, p) {
  const directEventType = directEventTypeUri(p);
  const scheduled = p && p.scheduled_event;
  const directStart = scheduled && typeof scheduled === "object"
    ? scheduled.start_time || ""
    : "";
  const eventUri = scheduledEventUri(p);
  const pat = env.CALENDLY_PAT || env.CALENDLY_PAT_THREESTRIPES;
  if (directEventType && directStart) {
    return { eventUri, eventTypeUri: directEventType, startTime: directStart };
  }
  if (!eventUri || !pat) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(eventUri, {
      headers: { Authorization: "Bearer " + pat },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const resource = data && data.resource;
    if (!resource || typeof resource !== "object") return null;
    const eventTypeUri = calendlyApiUri(
      resource.event_type || directEventType,
      "/event_types/"
    );
    if (!eventTypeUri) return null;
    return {
      eventUri,
      eventTypeUri,
      startTime: resource.start_time || directStart || "",
      status: resource.status || "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Some lifecycle payloads ship only an invitee URI. Hydrate from Calendly when
// provider jobs need the invitee's current identity and answers.
async function hydrateCalendlyInvitee(env, p) {
  const nested = p.invitee && typeof p.invitee === "object" ? p.invitee : {};
  const email = p.email || nested.email || "";
  const name = p.name || nested.name || "";
  if (email) {
    return {
      ...p,
      email,
      name: name || p.name || "",
      questions_and_answers: p.questions_and_answers || nested.questions_and_answers || [],
    };
  }
  const uri = inviteeUriFromPayload(p);
  const pat = env.CALENDLY_PAT || env.CALENDLY_PAT_THREESTRIPES;
  if (!uri || !pat) {
    console.log("calendly_invitee_missing_identity", Boolean(uri), Boolean(pat));
    return p;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(uri, {
      headers: {
        Authorization: "Bearer " + pat,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log("calendly_invitee_fetch_error", res.status);
      return p;
    }
    const data = await res.json();
    const r = data.resource || {};
    return {
      ...p,
      email: r.email || "",
      name: r.name || name || "",
      questions_and_answers: r.questions_and_answers || p.questions_and_answers || [],
      timezone: r.timezone || p.timezone || "",
      uri: r.uri || p.uri || "",
      event: r.event || p.event || "",
      tracking: r.tracking || p.tracking || null,
      created_at: r.created_at || p.created_at || "",
      updated_at: r.updated_at || p.updated_at || "",
    };
  } catch {
    console.log("calendly_invitee_hydrate_error");
    return p;
  } finally {
    clearTimeout(timer);
  }
}

// Look up an existing Kit subscriber by email, then apply a tag.
// Does not upsert / create a subscriber (booked path still does).
function kitTagExistingJob(tagId, email, leadRef, sourceKey) {
  if (!tagId || !email) return null;
  return {
    leadRef,
    kind: "kit.tag_existing",
    dedupeKey: `${sourceKey}:kit`,
    payload: { tag_id: tagId, email },
  };
}

async function resolveStoredLeadRef(db, inviteeUri, oldInviteeUri) {
  const row = await db
    .prepare(
      `SELECT lead_ref FROM (
         SELECT lead_ref,
                CASE
                  WHEN invitee_uri = ?1 THEN 0
                  WHEN rescheduled_to_uri = ?1 THEN 1
                  ELSE 2
                END AS binding_priority
         FROM calendly_invitees
         WHERE lead_ref IS NOT NULL
           AND (
             invitee_uri = ?1 OR invitee_uri = ?2
             OR rescheduled_to_uri = ?1
           )
         UNION ALL
         SELECT lead_ref, 3 AS binding_priority FROM leads
         WHERE calendly_invitee_uri = ?1
       )
       ORDER BY binding_priority
       LIMIT 1`
    )
    .bind(inviteeUri, oldInviteeUri || "")
    .first();
  return row && row.lead_ref ? String(row.lead_ref) : "";
}

async function resolveEligibleLeadRef(db, storedLeadRef, claimedLeadRef, isWebsite = false) {
  const leadRef = storedLeadRef || claimedLeadRef;
  if (!leadRef) return "";
  const row = await db
    .prepare("SELECT qualified, status FROM leads WHERE lead_ref = ?1 LIMIT 1")
    .bind(leadRef)
    .first();
  if (isWebsite ? !websiteEligible(row) : (!row || Number(row.qualified) !== 1)) return "";
  return leadRef;
}

async function storedBookedReschedule(db, inviteeUri, leadRef) {
  if (!inviteeUri || !leadRef) return null;
  const row = await db
    .prepare(
      `SELECT invitee_uri, event_uri, lead_ref, scheduled_start_at,
              provider_event_at_ms
       FROM calendly_invitees
       WHERE invitee_uri = ?1 AND status = 'booked'
       LIMIT 1`
    )
    .bind(inviteeUri)
    .first();
  if (
    !row ||
    row.provider_event_at_ms == null ||
    !Number.isFinite(Number(row.provider_event_at_ms))
  ) return null;
  if (row.lead_ref) return null;
  return {
    inviteeUri: row.invitee_uri,
    eventUri: row.event_uri || "",
    start: row.scheduled_start_at
      ? String(row.scheduled_start_at).replace(" ", "T") + "Z"
      : "",
    providerAt: Number(row.provider_event_at_ms),
  };
}

function terminalTransitionStatement(
  db,
  { inviteeUri, sourceStatus, transitionToken, providerAt }
) {
  if (sourceStatus === "booked" || !transitionToken) return null;
  return db
    .prepare(
      `INSERT INTO calendly_terminal_transitions
         (invitee_uri, status, transition_token, provider_event_at_ms)
       SELECT ?1, ?2, ?3, ?4
       WHERE EXISTS (
         SELECT 1 FROM calendly_invitees
         WHERE invitee_uri = ?1 AND status = ?2
           AND provider_event_at_ms = ?4
       )
       ON CONFLICT(invitee_uri) DO UPDATE SET
         status = excluded.status,
         transition_token = excluded.transition_token,
         provider_event_at_ms = excluded.provider_event_at_ms,
         created_at = CURRENT_TIMESTAMP
       WHERE calendly_terminal_transitions.provider_event_at_ms IS NULL
          OR excluded.provider_event_at_ms >=
             calendly_terminal_transitions.provider_event_at_ms`
    )
    .bind(inviteeUri, sourceStatus, transitionToken, providerAt);
}

async function recordCalendlyLifecycle(context, kind, payload, rawBody, options = {}) {
  const { env } = context;
  const isBooked = kind === "invitee.created";
  const isCanceled = kind === "invitee.canceled";
  const isNoShow =
    kind === "invitee.no_show" ||
    kind === "invitee_no_show.created" ||
    kind === "invitee_no_show.polled";
  if (!isBooked && !isCanceled && !isNoShow) return ok();
  if (!env.LEADS_DB || !env.FUNNEL_SIGNING_KEY || !env.CALENDLY_EVENT_TYPE_URI) {
    return reject(503);
  }

  let p = payload || {};
  const directTarget = directEventTypeUri(p);
  if (
    directTarget &&
    ![String(env.CALENDLY_EVENT_TYPE_URI).replace(/\/$/, ""), WEBSITE_EVENT_TYPE_URI].includes(directTarget)
  ) {
    return ok();
  }
  if (isNoShow || !p.email) {
    p = await hydrateCalendlyInvitee(env, p);
  }
  const eventContext = await resolveScheduledEvent(env, p);
  if (!eventContext || !eventContext.eventTypeUri || !eventContext.startTime) {
    return reject(503);
  }
  const isWebsite = eventContext.eventTypeUri === WEBSITE_EVENT_TYPE_URI;
  if (!isWebsite && eventContext.eventTypeUri !== String(env.CALENDLY_EVENT_TYPE_URI).replace(/\/$/, "")) {
    return ok();
  }
  const inviteeUri = inviteeUriFromPayload(p);
  if (!inviteeUri) return reject(503);
  const oldInviteeUri = relatedInviteeUri(p, "old_invitee");
  const rescheduledToUri = relatedInviteeUri(p, "new_invitee") ||
    relatedInviteeUri(p, "rescheduled_to");
  const providerAt = Number.isFinite(options.providerEventAtMs)
    ? options.providerEventAtMs
    : providerEventAtMs(p, options.envelopeCreatedAt, kind);
  if (!Number.isFinite(providerAt)) return reject(503);
  const qa = p.questions_and_answers || [];
  const name = p.name || "?";
  const email = p.email || "";
  const phone = answerFor(qa, "phone");
  const website = answerFor(qa, "website");
  const budget = answerFor(qa, "budget");
  const revenue = answerFor(qa, "revenue");
  const marketing = answerFor(qa, "marketing");
  const domain = normalizeDomain(website);
  const attribution = String(
    (p.tracking && p.tracking.utm_content) || p.utm_content || ""
  );
  const leadClaims = await verifyLeadToken(env.FUNNEL_SIGNING_KEY, attribution);
  const claimedLeadRef = options.leadRef || (leadClaims && leadClaims.ref) || "";
  let leadRef = "";
  try {
    const storedLeadRef = await resolveStoredLeadRef(
      env.LEADS_DB,
      inviteeUri,
      oldInviteeUri
    );
    leadRef = await resolveEligibleLeadRef(
      env.LEADS_DB,
      storedLeadRef,
      claimedLeadRef, isWebsite
    );
  } catch (error) {
    console.log("calendly_lead_binding_error", String(error).slice(0, 160));
    return reject(503);
  }
  const start = eventContext.startTime;
  const when = start ? start.slice(0, 16).replace("T", " ") + " UTC" : "?";

  const booked = isBooked;
  const newStatus = isBooked ? "booked" : isNoShow ? "no_show" : "booking_canceled";
  const inviteeUuid = String(inviteeUri).split("/").pop();
  const eventKey = inviteeUuid
    ? `${kind}:${inviteeUuid}:${providerAt}`
    : await sha256(rawBody);
  const normalizedKind = isBooked ? "booked" : isNoShow ? "no_show" : "canceled";
  const sourceStatus = normalizedKind;
  const transitionToken = booked ? null : crypto.randomUUID();
  const sourceKey = `calendly:${normalizedKind}:${inviteeUuid || eventKey}`;
  const isRescheduledCancel = isCanceled && Boolean(
    rescheduledToUri || p.rescheduled === true
  );
  let recoveredBooking = null;
  let recoveredInvitee = null;
  if (isRescheduledCancel && leadRef && rescheduledToUri) {
    try {
      recoveredBooking = await storedBookedReschedule(
        env.LEADS_DB,
        rescheduledToUri,
        leadRef
      );
      if (recoveredBooking) {
        recoveredInvitee = await hydrateCalendlyInvitee(env, {
          uri: recoveredBooking.inviteeUri,
        });
        if (
          !recoveredInvitee.email ||
          inviteeUriFromPayload(recoveredInvitee) !== recoveredBooking.inviteeUri
        ) {
          return reject(503);
        }
      }
    } catch (error) {
      console.log("calendly_reschedule_lookup_error", String(error).slice(0, 160));
      return reject(503);
    }
  }
  const firstName = (name || "").trim().split(/\s+/)[0] || "";
  const text = booked
    ? `:calendar: *${isWebsite ? "Website consultation" : "Rank-boost call"} BOOKED*\n*${name}* · ${phone || "?"}${email ? " · " + email : ""}\n` +
      `${domain || website || "?"} · ${when}\n` +
      `Budget: ${budget || "?"} · Revenue: ${revenue || "?"}\n` +
      `Marketing now: ${marketing || "?"}`
    : isNoShow
      ? `:no_entry: *${isWebsite ? "Website consultation" : "Rank-boost call"} NO-SHOW*\n*${name}*${email ? " · " + email : ""} · ${domain || website || "?"} · was ${when}`
      : `:x: *${isWebsite ? "Website consultation" : "Rank-boost call"} CANCELED*\n*${name}*${email ? " · " + email : ""} · ${domain || website || "?"} · was ${when}`;

  const jobs = isRescheduledCancel || !leadRef
    ? []
    : [
        {
          leadRef,
          kind: "slack.webhook",
          dedupeKey: `${sourceKey}:slack`,
          payload: { text, unfurl_links: false, unfurl_media: false },
        },
      ];

  if (leadRef && booked) {
    jobs.push(
      kitUpsertTagJob(
        isWebsite ? WEBSITE_TAG_IDS.booked : KIT_TAG_IDS.booked,
        email,
        firstName,
        leadRef,
        sourceKey,
        isWebsite ? websiteBookingFields(start, p) : qualifiedBookingEmailFields(start, p),
        start
      ),
      !lifecycleEnabled(env) && !isWebsite && bookingSmsJob(
        { phone, firstName, startIso: start, tz: p.timezone },
        leadRef,
        sourceKey
      )
    );
    if (leadRef) {
      jobs.push(
        await metaLifecycleJob(
          isWebsite ? "WebsiteConsultationBooked" : "Schedule",
          { inviteeUri, name, email, phone },
          leadRef,
          sourceKey
        )
      );
    }
  } else if (leadRef && isNoShow) {
    jobs.push(
      isWebsite ? kitUpsertTagJob(WEBSITE_TAG_IDS.noShow, email, firstName, leadRef, sourceKey) : kitTagExistingJob(
        KIT_TAG_IDS.noShow,
        email,
        leadRef,
        sourceKey
      ),
      !isWebsite && await followupSmsJob(env, "no_show", { phone, firstName }, leadRef, sourceKey)
    );
    if (leadRef) {
      jobs.push(
        await metaLifecycleJob(
          isWebsite ? "WebsiteConsultationNoShow" : "BookingNoShow",
          { inviteeUri, name, email, phone },
          leadRef,
          sourceKey
        )
      );
    }
  } else if (leadRef && !isRescheduledCancel) {
    jobs.push(
      isWebsite && kitUpsertTagJob(WEBSITE_TAG_IDS.canceled, email, firstName, leadRef, sourceKey),
      !isWebsite && lifecycleEnabled(env) && kitTagExistingJob(Number(env.KIT_TAG_CANCELED_ID)||22622480,email,leadRef,sourceKey),
      !isWebsite && await followupSmsJob(env, "canceled", { phone, firstName }, leadRef, sourceKey)
    );
    if (leadRef) {
      jobs.push(
        await metaLifecycleJob(
          isWebsite ? "WebsiteConsultationCanceled" : "BookingCanceled",
          { inviteeUri, name, email, phone },
          leadRef,
          sourceKey
        )
      );
    }
  }

  let recoveredJobs = [];
  if (recoveredBooking && recoveredInvitee) {
    const recoveredUuid = String(recoveredBooking.inviteeUri).split("/").pop();
    const recoveredSourceKey = `calendly:booked:${recoveredUuid}`;
    const recoveredQa = recoveredInvitee.questions_and_answers || [];
    const recoveredName = recoveredInvitee.name || "?";
    const recoveredEmail = recoveredInvitee.email;
    const recoveredPhone = answerFor(recoveredQa, "phone");
    const recoveredWebsite = answerFor(recoveredQa, "website");
    const recoveredBudget = answerFor(recoveredQa, "budget");
    const recoveredRevenue = answerFor(recoveredQa, "revenue");
    const recoveredMarketing = answerFor(recoveredQa, "marketing");
    const recoveredDomain = normalizeDomain(recoveredWebsite);
    const recoveredFirstName = recoveredName.trim().split(/\s+/)[0] || "";
    const recoveredWhen = recoveredBooking.start
      ? recoveredBooking.start.slice(0, 16).replace("T", " ") + " UTC"
      : "?";
    recoveredJobs = [
      {
        leadRef,
        kind: "slack.webhook",
        dedupeKey: `${recoveredSourceKey}:slack`,
        payload: {
          text:
            `:calendar: *${isWebsite ? "Website consultation" : "Rank-boost call"} BOOKED*\n*${recoveredName}* · ` +
            `${recoveredPhone || "?"} · ${recoveredEmail}\n` +
            `${recoveredDomain || recoveredWebsite || "?"} · ${recoveredWhen}\n` +
            `Budget: ${recoveredBudget || "?"} · ` +
            `Revenue: ${recoveredRevenue || "?"}\n` +
            `Marketing now: ${recoveredMarketing || "?"}`,
          unfurl_links: false,
          unfurl_media: false,
        },
      },
      kitUpsertTagJob(
        isWebsite ? WEBSITE_TAG_IDS.booked : KIT_TAG_IDS.booked,
        recoveredEmail,
        recoveredFirstName,
        leadRef,
        recoveredSourceKey,
        isWebsite ? websiteBookingFields(recoveredBooking.start, recoveredInvitee) : qualifiedBookingEmailFields(recoveredBooking.start, recoveredInvitee),
        recoveredBooking.start
      ),
      !lifecycleEnabled(env) && !isWebsite && bookingSmsJob(
        {
          phone: recoveredPhone,
          firstName: recoveredFirstName,
          startIso: recoveredBooking.start,
          tz: recoveredInvitee.timezone,
        },
        leadRef,
        recoveredSourceKey
      ),
      await metaLifecycleJob(
        isWebsite ? "WebsiteConsultationBooked" : "Schedule",
        {
          inviteeUri: recoveredBooking.inviteeUri,
          name: recoveredName,
          email: recoveredEmail,
          phone: recoveredPhone,
        },
        leadRef,
        recoveredSourceKey
      ),
    ].filter(Boolean);
  }

  if (lifecycleEnabled(env)) {
    for (const [list, uri, invitee] of [[jobs, inviteeUri, p], [recoveredJobs, recoveredBooking?.inviteeUri, recoveredInvitee]]) {
      for (const job of list.filter(Boolean)) {
        if(!isWebsite&&job.kind==='kit.tag_existing')job.payload.fields={rank_boost_booking_link:await recoveryBookingLink(env,leadRef)};
        if (job.kind === 'kit.upsert_tag' && (job.payload.qualified_call_start || job.payload.website_call_start)) {
          Object.assign(job.payload, {lead_ref:leadRef, appointment_invitee:uri,
            appointment_timezone:invitee?.timezone||'', appointment_phone:answerFor(invitee?.questions_and_answers||[], 'phone')});
        }
        if(job.kind==='roezan.sms') Object.assign(job.payload,{email,lead_ref:leadRef,appointment_timezone:invitee?.timezone||''});
      }
    }
  }

  // The receipt is an audit key; the remaining statements stay idempotent so
  // same-timestamp retries can repair a previously missing lead relationship.
  const statements = [
    env.LEADS_DB
      .prepare(
        "INSERT OR IGNORE INTO webhook_events (event_key, event_name) VALUES (?1, ?2)"
      )
      .bind(eventKey, kind),
  ];
  const inviteeStatement = calendlyInviteeStatement(env.LEADS_DB, {
    inviteeUri,
    eventUri: eventContext.eventUri,
    eventTypeUri: eventContext.eventTypeUri,
    leadRef,
    start,
    status: sourceStatus,
    noShowAt: p.no_show && p.no_show.created_at,
    providerAt,
    oldInviteeUri,
    rescheduledToUri,
  });
  if (inviteeStatement) statements.push(inviteeStatement);
  const transitionStatement = terminalTransitionStatement(env.LEADS_DB, {
    inviteeUri,
    sourceStatus,
    transitionToken,
    providerAt,
  });
  if (transitionStatement) statements.push(transitionStatement);
  const leadStatement = leadLifecycleStatement(env.LEADS_DB, {
    leadRef,
    inviteeUri,
    status: newStatus,
    providerAt,
    oldInviteeUri,
    suppressTerminal: isRescheduledCancel,
    isWebsite,
  });
  if (leadStatement) statements.push(leadStatement);
  statements.push(
    ...jobs
      .filter(Boolean)
      .map((job) =>
        calendlyJobStatement(
          env.LEADS_DB,
          job,
          inviteeUri,
          sourceStatus,
          providerAt, isWebsite
        )
      )
  );
  if (recoveredBooking) {
    statements.push(
      env.LEADS_DB
        .prepare(
          `UPDATE calendly_invitees
           SET lead_ref = COALESCE(lead_ref, ?2), updated_at = CURRENT_TIMESTAMP
           WHERE invitee_uri = ?1 AND status = 'booked'
             AND (lead_ref IS NULL OR lead_ref = ?2)`
        )
        .bind(recoveredBooking.inviteeUri, leadRef)
    );
    const recoveredLeadStatement = leadLifecycleStatement(env.LEADS_DB, {
      leadRef,
      inviteeUri: recoveredBooking.inviteeUri,
      status: "booked",
      providerAt: recoveredBooking.providerAt,
      oldInviteeUri: inviteeUri,
      suppressTerminal: false,
      isWebsite,
    });
    if (recoveredLeadStatement) statements.push(recoveredLeadStatement);
    statements.push(
      ...recoveredJobs.map((job) =>
        calendlyJobStatement(
          env.LEADS_DB,
          job,
          recoveredBooking.inviteeUri,
          "booked",
          recoveredBooking.providerAt, isWebsite
        )
      )
    );
  }

  try {
    await env.LEADS_DB.batch(statements);
  } catch (error) {
    console.log("calendly_job_store_error", String(error).slice(0, 200));
    return reject(503);
  }
  if (options.kick !== false) kickIntegrationJobs(context, 4);
  return ok();
}

async function claimCalendlyPoll(db, inviteeUri, leaseToken, eventTypeUri) {
  const claim = await db
    .prepare(
      `UPDATE calendly_invitees
       SET poll_lease_token = ?1,
           poll_lease_until = datetime('now', '+60 seconds'),
           updated_at = CURRENT_TIMESTAMP
        WHERE invitee_uri = ?2
          AND event_type_uri = ?3
         AND status = 'booked'
         AND scheduled_start_at <= datetime('now', '-15 minutes')
         AND scheduled_start_at >= datetime('now', '-${CALENDLY_POLL_WINDOW_DAYS} days')
         AND (
           last_checked_at IS NULL
           OR last_checked_at <= datetime('now', '-15 minutes')
         )
         AND (poll_lease_until IS NULL OR poll_lease_until < CURRENT_TIMESTAMP)`
    )
    .bind(leaseToken, inviteeUri, eventTypeUri)
    .run();
  return Boolean(claim.meta && claim.meta.changes === 1);
}

async function markCalendlyPoll(db, inviteeUri, leaseToken, status, error) {
  await db
    .prepare(
      `UPDATE calendly_invitees
       SET poll_attempts = poll_attempts + 1,
           last_checked_at = CURRENT_TIMESTAMP,
           last_http_status = ?2,
           last_error = ?3,
           poll_lease_token = NULL,
           poll_lease_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE invitee_uri = ?1 AND status = 'booked'
         AND poll_lease_token = ?4`
    )
    .bind(inviteeUri, status, error || null, leaseToken)
    .run();
}

export async function pollCalendlyNoShows(env, options = {}) {
  if (!env.LEADS_DB) throw new Error("calendly_poll_database_unavailable");
  const pat = env.CALENDLY_PAT || env.CALENDLY_PAT_THREESTRIPES;
  if (!pat || !env.CALENDLY_EVENT_TYPE_URI || !env.FUNNEL_SIGNING_KEY) {
    return {
      configured: false,
      candidates: 0,
      claimed: 0,
      skipped: 0,
      checked: 0,
      noShows: 0,
      failed: 0,
      expired: 0,
    };
  }
  const limit = Math.max(
    1,
    Math.min(
      Math.floor(Number(options.limit) || CALENDLY_POLL_LIMIT),
      CALENDLY_POLL_LIMIT
    )
  );
  const requestTimeoutMs = Math.max(
    500,
    Math.min(Math.floor(Number(options.timeoutMs) || 8000), 8000)
  );
  const eventTypeUri = String(env.CALENDLY_EVENT_TYPE_URI).replace(/\/$/, "");
  const expired = await env.LEADS_DB
    .prepare(
      `UPDATE calendly_invitees
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'booked'
          AND event_type_uri IN (?1, ?2)
          AND scheduled_start_at < datetime('now', '-${CALENDLY_POLL_WINDOW_DAYS} days')`
    )
    .bind(eventTypeUri, WEBSITE_EVENT_TYPE_URI)
    .run();
  const { results } = await env.LEADS_DB
    .prepare(
      `SELECT invitee_uri, event_uri, event_type_uri, lead_ref, scheduled_start_at
       FROM calendly_invitees
       WHERE status = 'booked'
          AND event_type_uri IN (?1, ?3)
         AND scheduled_start_at <= datetime('now', '-15 minutes')
         AND scheduled_start_at >= datetime('now', '-${CALENDLY_POLL_WINDOW_DAYS} days')
          AND (
            last_checked_at IS NULL
            OR last_checked_at <= datetime('now', '-15 minutes')
          )
          AND (poll_lease_until IS NULL OR poll_lease_until < CURRENT_TIMESTAMP)
       ORDER BY scheduled_start_at ASC
       LIMIT ?2`
    )
    .bind(eventTypeUri, limit, WEBSITE_EVENT_TYPE_URI)
    .all();
  const candidates = results || [];
  const summary = {
    configured: true,
    candidates: candidates.length,
    claimed: 0,
    skipped: 0,
    checked: 0,
    noShows: 0,
    failed: 0,
    expired: Number(expired.meta && expired.meta.changes) || 0,
  };

  await Promise.all(candidates.map(async (candidate) => {
    const leaseToken = crypto.randomUUID();
    if (!(await claimCalendlyPoll(
      env.LEADS_DB,
      candidate.invitee_uri,
      leaseToken,
      candidate.event_type_uri || eventTypeUri
    ))) {
      summary.skipped += 1;
      return;
    }
    summary.claimed += 1;
    const inviteeUri = calendlyApiUri(candidate.invitee_uri, "/invitees/");
    if (!inviteeUri) {
      summary.failed += 1;
      await markCalendlyPoll(
        env.LEADS_DB,
        candidate.invitee_uri,
        leaseToken,
        null,
        "invalid_invitee_uri"
      );
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(inviteeUri, {
        headers: {
          Authorization: "Bearer " + pat,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      summary.checked += 1;
      if (!response.ok) {
        summary.failed += 1;
        await markCalendlyPoll(
          env.LEADS_DB,
          inviteeUri,
          leaseToken,
          response.status,
          `provider_http_${response.status}`
        );
        return;
      }
      const data = await response.json();
      const resource = data && data.resource;
      if (!resource || typeof resource !== "object") {
        summary.failed += 1;
        await markCalendlyPoll(
          env.LEADS_DB,
          inviteeUri,
          leaseToken,
          200,
          "invalid_response"
        );
        return;
      }
      if (!resource.no_show) {
        await markCalendlyPoll(env.LEADS_DB, inviteeUri, leaseToken, 200, null);
        return;
      }
      const start = candidate.scheduled_start_at
        ? String(candidate.scheduled_start_at).replace(" ", "T") + "Z"
        : "";
      const polledPayload = {
        ...resource,
        scheduled_event: {
          uri: candidate.event_uri || resource.event || "",
          event_type: candidate.event_type_uri,
          start_time: start,
        },
      };
      const lifecycleResponse = await recordCalendlyLifecycle(
        { env },
        "invitee_no_show.polled",
        polledPayload,
        JSON.stringify({ event: "invitee_no_show.polled", payload: polledPayload }),
        {
          leadRef: candidate.lead_ref || "",
          kick: false,
          providerEventAtMs: providerEventAtMs(
            { updated_at: resource.no_show.created_at || resource.updated_at },
            ""
          ) || Date.now(),
        }
      );
      if (lifecycleResponse.ok) {
        summary.noShows += 1;
      } else {
        summary.failed += 1;
        await markCalendlyPoll(
          env.LEADS_DB,
          inviteeUri,
          leaseToken,
          lifecycleResponse.status,
          "lifecycle_store_failed"
        );
      }
    } catch {
      summary.failed += 1;
      await markCalendlyPoll(
        env.LEADS_DB,
        inviteeUri,
        leaseToken,
        null,
        "network_error"
      );
    } finally {
      clearTimeout(timer);
    }
  }));
  return summary;
}

export async function calendlyNoShowSummary(env) {
  if (!env.LEADS_DB) throw new Error("calendly_poll_database_unavailable");
  const { results } = await env.LEADS_DB
    .prepare(
      `SELECT status, COUNT(*) AS count,
              MIN(scheduled_start_at) AS oldest_scheduled,
              MAX(last_checked_at) AS latest_check
       FROM calendly_invitees
       GROUP BY status
       ORDER BY status`
    )
    .all();
  return results || [];
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim();
  if (contentType !== "application/json") return reject(415);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 131072) return reject(413);
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > 131072) return reject(413);
  if (
    !env.CALENDLY_WEBHOOK_SIGNING_KEY ||
    !env.FUNNEL_SIGNING_KEY ||
    !env.CALENDLY_EVENT_TYPE_URI
  ) return reject(503);
  if (!(await validSignature(request, rawBody, env.CALENDLY_WEBHOOK_SIGNING_KEY))) {
    return reject(401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reject(400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400);
  return recordCalendlyLifecycle(context, body.event, body.payload || {}, rawBody, {
    envelopeCreatedAt: body.created_at || "",
  });
}
