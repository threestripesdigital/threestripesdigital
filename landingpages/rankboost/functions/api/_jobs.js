import { prebookingCurrent } from './_prebooking.js';
import { websiteEmailJobCurrent } from "./_websiteemails.js";
import { appointmentCurrent } from "./_appointments.js";
import { WEBSITE_TAG_IDS } from "./_offers.js";
import { dispatchIntegrationJob, IntegrationError } from "./_providers.js";

const MAX_ATTEMPTS = 5;
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;
const DEFAULT_BUDGET_MS = 12000;
const MAX_BUDGET_MS = 20000;
const PROCESSOR_LEASE_SECONDS = 30;
const UNSAFE_REPLAY_KINDS = new Set(["slack.webhook", "roezan.sms", "kit.appointment_email"]);
const JOB_KINDS = new Set([
  "slack.webhook",
  "meta.events",
  "kit.upsert_tag",
  "kit.tag_existing",
  "roezan.sms",
  "kit.appointment_email",
  "kit.appointment_stop",
]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function errorCode(error) {
  const value = String(error && error.message ? error.message : "integration_error");
  return /^[a-z0-9_:-]{1,160}$/i.test(value) ? value : "integration_error";
}

function retryDelaySeconds(attempts, retryAfterSeconds) {
  if (Number(retryAfterSeconds) > 0) {
    return Math.min(Math.max(Math.ceil(Number(retryAfterSeconds)), 1), 3600);
  }
  return Math.min(30 * (2 ** Math.max(0, attempts - 1)), 1800);
}

async function acquireLease(db, name, token, seconds) {
  const modifier = `+${boundedInteger(seconds, 30, 1, 86400)} seconds`;
  await db
    .prepare(
      `INSERT INTO processor_leases
         (name, lease_token, lease_until, updated_at)
       VALUES (?1, ?2, datetime('now', ?3), CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         lease_token = excluded.lease_token,
         lease_until = excluded.lease_until,
         updated_at = CURRENT_TIMESTAMP
       WHERE processor_leases.lease_until < CURRENT_TIMESTAMP`
    )
    .bind(name, token, modifier)
    .run();
  const row = await db
    .prepare("SELECT lease_token FROM processor_leases WHERE name = ?1")
    .bind(name)
    .first();
  return Boolean(row && row.lease_token === token);
}

async function releaseLease(db, name, token) {
  await db
    .prepare("DELETE FROM processor_leases WHERE name = ?1 AND lease_token = ?2")
    .bind(name, token)
    .run();
}

async function recordAttempt(
  db,
  jobId,
  attemptId,
  eventType,
  { status = null, retryable = null, code = null } = {}
) {
  try {
    await db
      .prepare(
        `INSERT INTO integration_job_attempts
           (job_id, attempt_id, event_type, http_status, retryable, error_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        jobId,
        attemptId,
        eventType,
        Number.isFinite(status) ? status : null,
        typeof retryable === "boolean" ? (retryable ? 1 : 0) : null,
        code || null
      )
      .run();
  } catch (error) {
    console.log("integration_attempt_store_error", String(error).slice(0, 160));
  }
}

export async function upsertOperationalAlert(
  env,
  {
    alertKey,
    category,
    severity = "error",
    jobId = null,
    leadRef = null,
    resourceKey = null,
    messageCode,
    details = {},
  }
) {
  if (!env.LEADS_DB || !alertKey || !category || !messageCode) return false;
  const safeDetails = JSON.stringify(details).slice(0, 4000);
  await env.LEADS_DB
    .prepare(
      `INSERT INTO operational_alerts
         (alert_key, category, severity, job_id, lead_ref, resource_key,
          message_code, details_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(alert_key) DO UPDATE SET
         category = excluded.category,
         status = 'open',
         severity = excluded.severity,
         job_id = COALESCE(excluded.job_id, operational_alerts.job_id),
         lead_ref = COALESCE(excluded.lead_ref, operational_alerts.lead_ref),
         resource_key = COALESCE(
           excluded.resource_key, operational_alerts.resource_key
         ),
         message_code = excluded.message_code,
         details_json = excluded.details_json,
         occurrence_count = operational_alerts.occurrence_count + 1,
         last_seen_at = CURRENT_TIMESTAMP,
         notified_at = CASE
           WHEN operational_alerts.status <> 'open' THEN NULL
           ELSE operational_alerts.notified_at
         END,
         notification_attempts = CASE
           WHEN operational_alerts.status <> 'open' THEN 0
           ELSE operational_alerts.notification_attempts
         END,
         next_notification_at = CASE
           WHEN operational_alerts.status <> 'open' THEN NULL
           ELSE operational_alerts.next_notification_at
         END,
         acknowledged_at = CASE
           WHEN operational_alerts.status <> 'open' THEN NULL
           ELSE operational_alerts.acknowledged_at
         END,
         resolved_at = NULL`
    )
    .bind(
      String(alertKey).slice(0, 240),
      String(category).slice(0, 80),
      String(severity).slice(0, 20),
      jobId,
      leadRef,
      resourceKey,
      String(messageCode).slice(0, 160),
      safeDetails
    )
    .run();
  return true;
}

async function claimJob(db, job, leaseToken) {
  const result = await db
    .prepare(
      `UPDATE integration_jobs
       SET status = 'processing', attempts = attempts + 1,
           lease_token = ?1, lease_until = datetime('now', '+60 seconds'),
           last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?2
         AND (
           (status = 'pending' AND available_at <= CURRENT_TIMESTAMP)
           OR (status = 'processing' AND lease_until < CURRENT_TIMESTAMP)
         )`
    )
    .bind(leaseToken, job.id)
    .run();
  return Boolean(result.meta && result.meta.changes === 1);
}

async function sourceIsCurrent(db, job) {
  const emailPayload = JSON.parse(job.payload_json || "{}");
  if (emailPayload.prebooking_lead) return prebookingCurrent(db,emailPayload);
  if (emailPayload.appointment_timer) return appointmentCurrent(db,emailPayload);
  if (emailPayload.website_invitee || emailPayload.website_long_term) {
    if (emailPayload.website_sequence_id) {
      const uuid = emailPayload.website_invitee.split("/").pop();
      const booking = await db.prepare("SELECT status,last_error FROM integration_jobs WHERE dedupe_key=?1").bind(`calendly:booked:${uuid}:kit`).first();
      if (!booking || booking.status === "failed" || booking.last_error === "skipped_stale_source") return false;
      if (booking.status !== "completed") throw new IntegrationError("website_booking_fields_pending", { retryable:true });
    }
    const lead = await db.prepare("SELECT qualified,status,calendly_invitee_uri FROM leads WHERE lead_ref=?1").bind(job.lead_ref).first();
    return websiteEmailJobCurrent(emailPayload,lead);
  }
  if (!job.source_resource || !job.source_status) {
    const payload = JSON.parse(job.payload_json || "{}");
    if (job.kind === "kit.upsert_tag" && payload.tag_id === WEBSITE_TAG_IDS.lead) {
      const lead = await db.prepare("SELECT status FROM leads WHERE lead_ref = ?1").bind(job.lead_ref).first();
      return Boolean(lead && lead.status === "no_fit");
    }
    return true;
  }
  try {
    const row = await db
      .prepare(
        `SELECT i.status AS invitee_status,
                l.calendly_invitee_uri AS lead_invitee_uri,
                l.status AS lead_status
         FROM calendly_invitees AS i
         LEFT JOIN leads AS l ON l.lead_ref = ?2
         WHERE i.invitee_uri = ?1
         LIMIT 1`
      )
      .bind(job.source_resource, job.lead_ref || "")
      .first();
    if (!row || row.invitee_status !== job.source_status) return false;
    if (!job.lead_ref) return true;
    if (row.lead_invitee_uri !== job.source_resource) return false;
    // Boost Live is later than booked. Reapply the idempotent booked Kit tag
    // if it was delayed, but do not replay stale confirmation messages.
    if (job.source_status === "booked" && row.lead_status === "boost_live") {
      return job.kind === "kit.upsert_tag";
    }
    const expectedLeadStatus = job.source_status === "canceled"
      ? "booking_canceled"
      : job.source_status;
    return row.lead_status === expectedLeadStatus;
  } catch {
    throw new IntegrationError("source_verification_failed", { retryable: true });
  }
}

async function finishJob(db, jobId, leaseToken) {
  const result = await db
    .prepare(
      `UPDATE integration_jobs
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
           lease_token = NULL, lease_until = NULL, last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status = 'processing' AND lease_token = ?2`
    )
    .bind(jobId, leaseToken)
    .run();
  return Boolean(result.meta && result.meta.changes === 1);
}

async function skipStaleJob(db, jobId, leaseToken) {
  const result = await db
    .prepare(
      `UPDATE integration_jobs
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
           lease_token = NULL, lease_until = NULL,
           last_error = 'skipped_stale_source', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status = 'processing' AND lease_token = ?2`
    )
    .bind(jobId, leaseToken)
    .run();
  return Boolean(result.meta && result.meta.changes === 1);
}

async function resolveJobAlerts(db, jobId) {
  await db
    .prepare(
      `UPDATE operational_alerts
       SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
       WHERE job_id = ?1 AND status <> 'resolved'`
    )
    .bind(jobId)
    .run();
}

async function failJob(env, job, leaseToken, error, attemptId) {
  if(error?.message==='sms_quiet_hours') {
    const deferred=await env.LEADS_DB.prepare(`UPDATE integration_jobs SET status='pending',available_at=datetime('now','+30 minutes'),
      attempts=MAX(0,attempts-1),lease_token=NULL,lease_until=NULL,last_error='sms_quiet_hours',updated_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND status='processing' AND lease_token=?2`).bind(job.id,leaseToken).run();
    return {state:deferred.meta?.changes?'retry':'lost',deliveryUnknown:false};
  }
  const attempts = Number(job.attempts || 0) + 1;
  const code = errorCode(error);
  const deliveryUnknown = error && error.deliveryUnknown === true;
  const retryable = error && error.retryable !== false;
  const terminal = deliveryUnknown || !retryable || attempts >= MAX_ATTEMPTS;
  const delay = retryDelaySeconds(attempts, error && error.retryAfterSeconds);
  const storedCode = deliveryUnknown ? `delivery_unknown:${code}` : code;
  const result = await env.LEADS_DB
    .prepare(
      `UPDATE integration_jobs
       SET status = ?1, available_at = datetime('now', ?2),
           lease_token = NULL, lease_until = NULL, last_error = ?3,
           last_http_status = ?4,
           completed_at = CASE WHEN ?1 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
           dead_at = CASE WHEN ?1 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?5 AND status = 'processing' AND lease_token = ?6`
    )
    .bind(
      terminal ? "failed" : "pending",
      `+${delay} seconds`,
      storedCode,
      Number.isFinite(error && error.status) ? error.status : null,
      job.id,
      leaseToken
    )
    .run();
  if (!(result.meta && result.meta.changes === 1)) return { state: "lost" };
  await recordAttempt(
    env.LEADS_DB,
    job.id,
    attemptId,
    deliveryUnknown ? "delivery_unknown" : "failed",
    { status: error && error.status, retryable, code: storedCode }
  );
  if (terminal) {
    await upsertOperationalAlert(env, {
      alertKey: `integration-job:${job.id}:${deliveryUnknown ? "unknown" : "failed"}`,
      category: deliveryUnknown ? "delivery_unknown" : "integration_failure",
      jobId: job.id,
      leadRef: job.lead_ref || null,
      resourceKey: job.kind,
      messageCode: storedCode,
      details: { kind: job.kind, attempts, retryable },
    });
  }
  return { state: terminal ? "dead" : "retry", deliveryUnknown };
}

async function markExpiredUnsafeJob(env, job) {
  const result = await env.LEADS_DB
    .prepare(
      `UPDATE integration_jobs
       SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
           dead_at = CURRENT_TIMESTAMP,
           lease_token = NULL, lease_until = NULL,
           last_error = 'delivery_unknown:lease_expired',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status = 'processing'
         AND lease_until < CURRENT_TIMESTAMP`
    )
    .bind(job.id)
    .run();
  if (!(result.meta && result.meta.changes === 1)) return false;
  const attemptId = job.lease_token || crypto.randomUUID();
  await recordAttempt(env.LEADS_DB, job.id, attemptId, "delivery_unknown", {
    retryable: false,
    code: "delivery_unknown:lease_expired",
  });
  await upsertOperationalAlert(env, {
    alertKey: `integration-job:${job.id}:unknown`,
    category: "delivery_unknown",
    jobId: job.id,
    leadRef: job.lead_ref || null,
    resourceKey: job.kind,
    messageCode: "delivery_unknown:lease_expired",
    details: { kind: job.kind, attempts: Number(job.attempts || 0) },
  });
  return true;
}

export function enqueueIntegrationJobs(db, jobs) {
  const statements = (jobs || [])
    .filter((job) => job && job.kind && job.dedupeKey && job.payload)
    .map((job) => db
      .prepare(
        `INSERT OR IGNORE INTO integration_jobs
            (lead_ref, kind, dedupe_key, payload_json, depends_on_dedupe_key)
          VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(
        job.leadRef || null,
        job.kind,
        job.dedupeKey,
        JSON.stringify(job.payload),
        job.dependsOnDedupeKey || null
      ));
  return statements;
}

export function jobStatement(db, job) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO integration_jobs
          (lead_ref, kind, dedupe_key, payload_json, depends_on_dedupe_key)
        VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(
      job.leadRef || null,
      job.kind,
      job.dedupeKey,
      JSON.stringify(job.payload),
      job.dependsOnDedupeKey || null
    );
}

export function jobStatementUnlessEvent(db, job, eventKey) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO integration_jobs
          (lead_ref, kind, dedupe_key, payload_json, depends_on_dedupe_key)
        SELECT ?1, ?2, ?3, ?4, ?5
        WHERE NOT EXISTS (
          SELECT 1 FROM funnel_events WHERE event_key = ?6
        )`
    )
    .bind(
      job.leadRef || null,
      job.kind,
      job.dedupeKey,
      JSON.stringify(job.payload),
      job.dependsOnDedupeKey || null,
      eventKey
    );
}

export function jobStatementForLeadState(db, job, leadId, leadStatus) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO integration_jobs
         (lead_ref, kind, dedupe_key, payload_json, depends_on_dedupe_key)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (
         SELECT 1 FROM leads
         WHERE id = ?6 AND status = ?7 AND boost_live_at IS NOT NULL
       )`
    )
    .bind(
      job.leadRef || null,
      job.kind,
      job.dedupeKey,
      JSON.stringify(job.payload),
      job.dependsOnDedupeKey || null,
      leadId,
      leadStatus
    );
}

export async function processIntegrationJobs(env, options = {}) {
  if (!env.LEADS_DB) throw new Error("integration_database_unavailable");
  const limit = boundedInteger(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const budgetMs = boundedInteger(
    options.budgetMs,
    DEFAULT_BUDGET_MS,
    2000,
    MAX_BUDGET_MS
  );
  const summary = {
    busy: false,
    examined: 0,
    claimed: 0,
    completed: 0,
    retried: 0,
    dead: 0,
    ambiguous: 0,
    stale: 0,
    lost: 0,
    budgetExhausted: false,
  };
  const processorToken = crypto.randomUUID();
  if (!await acquireLease(
    env.LEADS_DB,
    "integration-jobs",
    processorToken,
    PROCESSOR_LEASE_SECONDS
  )) {
    summary.busy = true;
    return summary;
  }
  const deadlineAt = Date.now() + budgetMs;
  try {
    const { results } = await env.LEADS_DB
      .prepare(
        `SELECT job.id, job.lead_ref, job.kind, job.dedupe_key,
                job.payload_json, job.attempts, job.status, job.lease_token,
                job.source_resource, job.source_status,
                job.depends_on_dedupe_key
          FROM integration_jobs AS job
          WHERE (
            (job.status = 'pending' AND job.available_at <= CURRENT_TIMESTAMP)
            OR (job.status = 'processing' AND job.lease_until < CURRENT_TIMESTAMP)
          )
          AND (
            job.depends_on_dedupe_key IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM integration_jobs AS dependency
              WHERE dependency.dedupe_key = job.depends_on_dedupe_key
            )
            OR EXISTS (
              SELECT 1 FROM integration_jobs AS dependency
              WHERE dependency.dedupe_key = job.depends_on_dedupe_key
                AND dependency.status IN ('completed', 'failed')
            )
          )
          ORDER BY job.id
          LIMIT ?1`
      )
      .bind(limit * 2)
      .all();
    for (const job of results || []) {
      if (summary.claimed >= limit) break;
      if (Date.now() >= deadlineAt - 500) {
        summary.budgetExhausted = true;
        break;
      }
      summary.examined += 1;
      if (job.status === "processing" && UNSAFE_REPLAY_KINDS.has(job.kind)) {
        if (await markExpiredUnsafeJob(env, job)) {
          summary.dead += 1;
          summary.ambiguous += 1;
        }
        continue;
      }
      const leaseToken = crypto.randomUUID();
      if (!await claimJob(env.LEADS_DB, job, leaseToken)) {
        summary.lost += 1;
        continue;
      }
      summary.claimed += 1;
      await recordAttempt(env.LEADS_DB, job.id, leaseToken, "started");
      let providerCompleted=false;
      try {
        if (job.depends_on_dedupe_key) {
          const dependency = await env.LEADS_DB
            .prepare(
              "SELECT status FROM integration_jobs WHERE dedupe_key = ?1 LIMIT 1"
            )
            .bind(job.depends_on_dedupe_key)
            .first();
          if (!dependency || dependency.status !== "completed") {
            throw new IntegrationError(
              dependency ? "dependency_failed" : "dependency_missing",
              { status: 409, retryable: false }
            );
          }
        }
        if (!await sourceIsCurrent(env.LEADS_DB, job)) {
          if (await skipStaleJob(env.LEADS_DB, job.id, leaseToken)) {
            summary.stale += 1;
            await recordAttempt(
              env.LEADS_DB,
              job.id,
              leaseToken,
              "skipped_stale",
              { code: "skipped_stale_source" }
            );
            await resolveJobAlerts(env.LEADS_DB, job.id);
          } else {
            summary.lost += 1;
          }
          continue;
        }
        let payload;
        try {
          payload = JSON.parse(job.payload_json);
        } catch {
          throw new IntegrationError("invalid_job_payload", {
            status: 400,
            retryable: false,
          });
        }
        await dispatchIntegrationJob(env, job.kind, payload, {
          timeoutMs: 7000,
          deadlineAt: Math.min(deadlineAt - 250, Date.now() + 7000),
        });
        providerCompleted=true;
        if (await finishJob(env.LEADS_DB, job.id, leaseToken)) {
          summary.completed += 1;
          await recordAttempt(env.LEADS_DB, job.id, leaseToken, "succeeded");
          await resolveJobAlerts(env.LEADS_DB, job.id);
        } else {
          const current = await env.LEADS_DB
            .prepare("SELECT status FROM integration_jobs WHERE id = ?1")
            .bind(job.id)
            .first();
          if (current && current.status === "completed") {
            summary.completed += 1;
            await resolveJobAlerts(env.LEADS_DB, job.id);
          } else {
            summary.lost += 1;
            await recordAttempt(env.LEADS_DB, job.id, leaseToken, "lease_lost", {
              retryable: false,
              code: "completion_lease_lost",
            });
            await upsertOperationalAlert(env, {
              alertKey: `integration-job:${job.id}:completion-lost`,
              category: "delivery_unknown",
              jobId: job.id,
              leadRef: job.lead_ref || null,
              resourceKey: job.kind,
              messageCode: "completion_lease_lost",
              details: { kind: job.kind },
            });
          }
        }
      } catch (error) {
        if(providerCompleted&&UNSAFE_REPLAY_KINDS.has(job.kind))error=new IntegrationError('completion_storage_failed',{deliveryUnknown:true});
        const result = await failJob(env, job, leaseToken, error, leaseToken);
        if (result.state === "retry") summary.retried += 1;
        if (result.state === "dead") summary.dead += 1;
        if (result.state === "lost") summary.lost += 1;
        if (result.deliveryUnknown) summary.ambiguous += 1;
      }
    }
  } finally {
    await releaseLease(env.LEADS_DB, "integration-jobs", processorToken);
  }
  return summary;
}

export async function repairIntegrationJobs(env, options = {}) {
  if (!env.LEADS_DB) throw new Error("integration_database_unavailable");
  const jobId = Number.isInteger(Number(options.jobId)) && Number(options.jobId) > 0
    ? Number(options.jobId)
    : null;
  const leadRef = String(options.leadRef || "").trim();
  const kind = String(options.kind || "").trim();
  if (!jobId && !leadRef && !kind) throw new Error("repair_target_required");
  if (leadRef && !/^[a-z0-9_-]{1,160}$/i.test(leadRef)) {
    throw new Error("invalid_repair_lead_ref");
  }
  if (kind && !JOB_KINDS.has(kind)) throw new Error("invalid_repair_kind");
  const limit = boundedInteger(options.limit, 10, 1, 50);
  const { results } = await env.LEADS_DB
    .prepare(
      `SELECT id, lead_ref, kind, last_error
       FROM integration_jobs
       WHERE status = 'failed'
         AND (?1 IS NULL OR id = ?1)
         AND (?2 = '' OR lead_ref = ?2)
         AND (?3 = '' OR kind = ?3)
       ORDER BY id
       LIMIT ?4`
    )
    .bind(jobId, leadRef, kind, limit)
    .all();
  const summary = { matched: 0, requeued: 0, skippedUnknown: 0 };
  for (const job of results || []) {
    summary.matched += 1;
    if (
      String(job.last_error || "").startsWith("delivery_unknown:") &&
      options.confirmUnknown !== true
    ) {
      summary.skippedUnknown += 1;
      continue;
    }
    const result = await env.LEADS_DB
      .prepare(
        `UPDATE integration_jobs
         SET status = 'pending', attempts = 0,
             available_at = CURRENT_TIMESTAMP,
             lease_token = NULL, lease_until = NULL,
             last_error = NULL, completed_at = NULL, dead_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND status = 'failed'`
      )
      .bind(job.id)
      .run();
    if (!(result.meta && result.meta.changes === 1)) continue;
    summary.requeued += 1;
    await recordAttempt(
      env.LEADS_DB,
      job.id,
      `repair-${crypto.randomUUID()}`,
      "requeued",
      { code: "targeted_repair" }
    );
    await env.LEADS_DB
      .prepare(
        `UPDATE operational_alerts
         SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP,
             resolved_at = NULL
         WHERE job_id = ?1 AND status <> 'resolved'`
      )
      .bind(job.id)
      .run();
  }
  return summary;
}

export async function requeueDeadIntegrationJobs(env, options = {}) {
  const summary = await repairIntegrationJobs(env, options);
  return summary.requeued;
}

export async function operationalSummary(env) {
  if (!env.LEADS_DB) throw new Error("integration_database_unavailable");
  const [jobs, alerts, failures, attempts] = await Promise.all([
    env.LEADS_DB
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM integration_jobs GROUP BY status ORDER BY status`
      )
      .all(),
    env.LEADS_DB
      .prepare(
        `SELECT alert_key, category, status, severity, job_id, resource_key,
                message_code, occurrence_count, first_seen_at, last_seen_at,
                notified_at
         FROM operational_alerts
         WHERE status <> 'resolved'
         ORDER BY last_seen_at DESC LIMIT 50`
      )
      .all(),
    env.LEADS_DB
      .prepare(
        `SELECT kind, last_error, COUNT(*) AS count
         FROM integration_jobs
         WHERE status = 'failed'
         GROUP BY kind, last_error
         ORDER BY count DESC, kind LIMIT 50`
      )
      .all(),
    env.LEADS_DB
      .prepare(
        `SELECT event_type, COUNT(*) AS count
         FROM integration_job_attempts
         WHERE created_at >= datetime('now', '-1 day')
         GROUP BY event_type ORDER BY event_type`
      )
      .all(),
  ]);
  return {
    jobs: jobs.results || [],
    alerts: alerts.results || [],
    failures: failures.results || [],
    attempts24h: attempts.results || [],
  };
}

export async function resolveOperationalAlert(env, alertKey) {
  if (!env.LEADS_DB || !alertKey) return false;
  const result = await env.LEADS_DB
    .prepare(
      `UPDATE operational_alerts
       SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
       WHERE alert_key = ?1 AND status <> 'resolved'`
    )
    .bind(String(alertKey).slice(0, 240))
    .run();
  return Boolean(result.meta && result.meta.changes === 1);
}

export async function flushOperationalAlerts(env, options = {}) {
  if (!env.LEADS_DB) throw new Error("integration_database_unavailable");
  const limit = boundedInteger(options.limit, 10, 1, 20);
  const leaseToken = crypto.randomUUID();
  if (!await acquireLease(
    env.LEADS_DB,
    "operational-alert-notifications",
    leaseToken,
    30
  )) {
    return { pending: 0, notified: 0, configured: true, busy: true };
  }
  try {
    const { results } = await env.LEADS_DB
      .prepare(
        `SELECT alert_key, category, severity, job_id, resource_key,
                message_code, occurrence_count
         FROM operational_alerts
         WHERE status = 'open' AND notified_at IS NULL
           AND notification_attempts < 8
           AND (next_notification_at IS NULL OR next_notification_at <= CURRENT_TIMESTAMP)
         ORDER BY first_seen_at LIMIT ?1`
      )
      .bind(limit)
      .all();
    const alerts = results || [];
    if (!alerts.length) {
      return { pending: 0, notified: 0, configured: true, busy: false };
    }
    const slackConfigured = Boolean(
      env.SLACK_WEBHOOK_URL ||
      (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID)
    );
    if (!slackConfigured) {
      return {
        pending: alerts.length,
        notified: 0,
        configured: false,
        busy: false,
      };
    }
    const lines = alerts.map((alert) =>
      `• ${alert.severity}/${alert.category} ${alert.message_code}` +
      `${alert.resource_key ? ` [${alert.resource_key}]` : ""}` +
      `${alert.job_id ? ` job=${alert.job_id}` : ""}` +
      ` occurrences=${alert.occurrence_count}`
    );
    const timeoutMs = boundedInteger(options.timeoutMs, 4000, 500, 4000);
    let delivered = false;
    try {
      await dispatchIntegrationJob(
        env,
        "slack.webhook",
        {
          text: `Rank Boost operational alerts\n${lines.join("\n")}`,
          unfurl_links: false,
          unfurl_media: false,
        },
        { timeoutMs, deadlineAt: Date.now() + timeoutMs }
      );
      delivered = true;
    } catch {
      delivered = false;
    }
    const statements = alerts.map((alert) => env.LEADS_DB
      .prepare(
        delivered
          ? `UPDATE operational_alerts
             SET notified_at = CURRENT_TIMESTAMP,
                 notification_attempts = notification_attempts + 1,
                 next_notification_at = NULL
             WHERE alert_key = ?1 AND notified_at IS NULL`
          : `UPDATE operational_alerts
             SET notification_attempts = notification_attempts + 1,
                 next_notification_at = datetime(
                   'now',
                   CASE
                     WHEN notification_attempts >= 4 THEN '+6 hours'
                     WHEN notification_attempts >= 2 THEN '+1 hour'
                     ELSE '+15 minutes'
                   END
                 )
             WHERE alert_key = ?1 AND notified_at IS NULL`
      )
      .bind(alert.alert_key));
    await env.LEADS_DB.batch(statements);
    return {
      pending: alerts.length,
      notified: delivered ? alerts.length : 0,
      configured: true,
      busy: false,
    };
  } finally {
    await releaseLease(
      env.LEADS_DB,
      "operational-alert-notifications",
      leaseToken
    );
  }
}

export async function runOperationalRetention(env) {
  if (!env.LEADS_DB) throw new Error("integration_database_unavailable");
  const token = crypto.randomUUID();
  if (!await acquireLease(env.LEADS_DB, "operational-retention", token, 82800)) {
    return { ran: false };
  }
  const eligibleJobs = `SELECT j.id FROM integration_jobs AS j
    WHERE j.status IN ('completed', 'failed')
      AND j.completed_at < datetime('now', '-90 days')
      AND NOT EXISTS (
        SELECT 1 FROM operational_alerts AS a
        WHERE a.job_id = j.id AND a.status <> 'resolved'
      )
    LIMIT 250`;
  const eligibleInvitees = `SELECT i.invitee_uri FROM calendly_invitees AS i
    WHERE i.status IN ('canceled', 'no_show', 'expired')
      AND i.updated_at < datetime('now', '-180 days')
      AND NOT EXISTS (
        SELECT 1 FROM leads AS l WHERE l.calendly_invitee_uri = i.invitee_uri
      )
    LIMIT 250`;
  const statements = [
    `DELETE FROM integration_job_attempts WHERE id IN (
       SELECT a.id FROM integration_job_attempts AS a
       WHERE a.job_id IN (${eligibleJobs})
     )`,
    `DELETE FROM integration_jobs WHERE id IN (${eligibleJobs})`,
    `DELETE FROM calendly_terminal_transitions
     WHERE invitee_uri IN (${eligibleInvitees})`,
    `DELETE FROM calendly_invitees
     WHERE invitee_uri IN (${eligibleInvitees})`,
    `DELETE FROM webhook_events WHERE event_key IN (
       SELECT event_key FROM webhook_events
       WHERE received_at < datetime('now', '-90 days') LIMIT 500
     )`,
    `DELETE FROM auth_attempts WHERE rowid IN (
       SELECT rowid FROM auth_attempts
       WHERE created_at < datetime('now', '-7 days') LIMIT 500
     )`,
    `DELETE FROM usage_counters WHERE rowid IN (
       SELECT rowid FROM usage_counters
       WHERE updated_at < datetime('now', '-45 days') LIMIT 500
     )`,
    `DELETE FROM submissions WHERE submission_id IN (
       SELECT submission_id FROM submissions
       WHERE state IN ('complete', 'failed')
         AND updated_at < datetime('now', '-30 days') LIMIT 250
     )`,
    `DELETE FROM operational_alerts WHERE alert_key IN (
       SELECT alert_key FROM operational_alerts
       WHERE status = 'resolved' AND resolved_at < datetime('now', '-90 days')
       LIMIT 250
     )`,
  ];
  try {
    const results = await env.LEADS_DB.batch(
      statements.map((sql) => env.LEADS_DB.prepare(sql))
    );
    return {
      ran: true,
      deleted: results.map(
        (result) => Number(result.meta && result.meta.changes) || 0
      ),
    };
  } catch (error) {
    await releaseLease(env.LEADS_DB, "operational-retention", token);
    try {
      await upsertOperationalAlert(env, {
        alertKey: "operational-retention:failed",
        category: "retention_failure",
        resourceKey: "d1",
        messageCode: "operational_retention_failed",
      });
    } catch {
      /* preserve the original retention failure */
    }
    throw error;
  }
}

export function kickIntegrationJobs(context, limit = DEFAULT_LIMIT) {
  if (!context || typeof context.waitUntil !== "function") return;
  context.waitUntil(
    processIntegrationJobs(context.env, { limit, budgetMs: 8000 }).catch((error) => {
      console.log("integration_processor_error", String(error).slice(0, 200));
    })
  );
}
