import { queuePrebookingSms, pollPrebookingReplies } from './_prebooking.js';
import { queueWebsiteEmailTimers } from "./_websiteemails.js";
import { queueAppointmentTimers } from "./_appointments.js";
import { pollSmsReplies } from './_smsreplies.js';
import {
  flushOperationalAlerts,
  operationalSummary,
  processIntegrationJobs,
  repairIntegrationJobs,
  resolveOperationalAlert,
  runOperationalRetention,
  upsertOperationalAlert,
} from "./_jobs.js";
import { calendlyNoShowSummary, pollCalendlyNoShows } from "./calendly.js";
import {
  authFailureStatus,
  bearerToken,
  sameValue,
} from "./_security.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function authorized(request, env) {
  const expected = env.JOB_PROCESSOR_TOKEN || env.JOBS_TOKEN;
  return Boolean(
    expected &&
    sameValue(bearerToken(request), expected)
  );
}

async function rejectUnauthorized(request, env) {
  const status = await authFailureStatus(request, env, "process-jobs", 12);
  return json({ error: status === 429 ? "rate_limited" : "forbidden" }, status);
}

async function requestBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 8192) throw new Error("payload_too_large");
  const raw = await request.text();
  if (!raw) return {};
  if (new TextEncoder().encode(raw).length > 8192) {
    throw new Error("payload_too_large");
  }
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim();
  if (contentType !== "application/json") throw new Error("unsupported_media_type");
  const body = JSON.parse(raw);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("bad_request");
  }
  return body;
}

export async function recordPollAlerts(env, noShows) {
  if (!noShows.configured) {
    await upsertOperationalAlert(env, {
      alertKey: "calendly-poll:not-configured",
      category: "calendly_poll_configuration",
      resourceKey: "calendly",
      messageCode: "calendly_poll_not_configured",
    });
    return;
  }
  await resolveOperationalAlert(env, "calendly-poll:not-configured");
  if (Number(noShows.failed) > 0) {
    await upsertOperationalAlert(env, {
      alertKey: "calendly-poll:failed",
      category: "calendly_poll_failure",
      resourceKey: "calendly",
      messageCode: "calendly_poll_failed",
      details: {
        candidates: noShows.candidates,
        checked: noShows.checked,
        failed: noShows.failed,
      },
    });
  } else {
    await resolveOperationalAlert(env, "calendly-poll:failed");
  }
  if (Number(noShows.expired) > 0) {
    await upsertOperationalAlert(env, {
      alertKey: "calendly-poll:expired",
      category: "calendly_poll_expired",
      severity: "warning",
      resourceKey: "calendly",
      messageCode: "booked_invitee_poll_window_expired",
      details: { expired: noShows.expired },
    });
  } else {
    await resolveOperationalAlert(env, "calendly-poll:expired");
  }
}

export async function onRequestPost({ request, env }) {
  if (!await authorized(request, env)) return rejectUnauthorized(request, env);
  let body;
  try {
    body = await requestBody(request);
  } catch (error) {
    const code = String(error && error.message);
    if (code === "payload_too_large") return json({ error: code }, 413);
    if (code === "unsupported_media_type") return json({ error: code }, 415);
    return json({ error: "bad_request" }, 400);
  }

  const action = String(body.action || "process");
  try {
    if (action === "repair") {
      const repaired = await repairIntegrationJobs(env, {
        jobId: body.job_id,
        leadRef: body.lead_ref,
        kind: body.kind,
        limit: body.limit,
        confirmUnknown: body.confirm_unknown === true,
      });
      return json({ ok: true, repaired });
    }
    if (action === "resolve_alert") {
      const resolved = await resolveOperationalAlert(env, body.alert_key);
      return json({ ok: true, resolved });
    }
    if (action !== "process") return json({ error: "invalid_action" }, 400);

    const deadlineAt = Date.now() + 25000;
    const websiteEmails = await queueWebsiteEmailTimers(env);
    const appointments = await queueAppointmentTimers(env);
    const prebookingSms = await queuePrebookingSms(env);
    const jobs = await processIntegrationJobs(env, {
      limit: body.limit || 4,
      budgetMs: Math.min(Number(body.budget_ms) || 10000, 10000),
    });
    const pollTimeoutMs = Math.max(
      500,
      Math.min(8000, deadlineAt - Date.now() - 5500)
    );
    const noShows = await pollCalendlyNoShows(env, {
      limit: body.no_show_limit || 4,
      timeoutMs: pollTimeoutMs,
    });
    const smsReplies = Date.now()<deadlineAt-6500 ? await pollSmsReplies(env) : {skipped:'deadline'};
    const prebookingReplies = Date.now()<deadlineAt-6500 ? await pollPrebookingReplies(env) : {skipped:'deadline'};
    await recordPollAlerts(env, noShows);
    const retention = Date.now() < deadlineAt - 2000
      ? await runOperationalRetention(env)
      : { ran: false, skipped: "deadline" };
    const remaining = deadlineAt - Date.now();
    const notifications = remaining >= 750
      ? await flushOperationalAlerts(env, {
          timeoutMs: Math.min(4000, remaining - 250),
        })
      : { pending: 0, notified: 0, skipped: "deadline" };
    return json({ ok: true, jobs, noShows, retention, notifications, websiteEmails, appointments, smsReplies, prebookingSms, prebookingReplies });
  } catch (error) {
    console.log("job_processor_error", String(error).slice(0, 200));
    try {
      await upsertOperationalAlert(env, {
        alertKey: "job-processor:failed",
        category: "processor_failure",
        resourceKey: "process-jobs",
        messageCode: "job_processor_failed",
      });
    } catch {
      /* return the original processor failure */
    }
    return json({ error: "processor_failed" }, 503);
  }
}

export async function onRequestGet({ request, env }) {
  if (!await authorized(request, env)) return rejectUnauthorized(request, env);
  try {
    const [operations, noShows] = await Promise.all([
      operationalSummary(env),
      calendlyNoShowSummary(env),
    ]);
    return json({ ok: true, operations, noShows });
  } catch (error) {
    console.log("job_summary_error", String(error).slice(0, 200));
    return json({ error: "summary_failed" }, 503);
  }
}
