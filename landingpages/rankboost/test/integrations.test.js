import { WEBSITE_EMAILS } from "../functions/api/_websiteemailconfig.js";
import { APPOINTMENT_EMAILS } from '../functions/api/_appointmentconfig.js';
import { appointmentSlots, queueAppointmentTimers, appointmentCurrent, registerAppointment, localSmsHour, utcTime } from '../functions/api/_appointments.js';
import { classifyReply, pollSmsReplies } from '../functions/api/_smsreplies.js';
import { recoveryBookingLink } from '../functions/api/_bookinglinks.js';
import { verifyLeadToken } from '../functions/api/_security.js';
import { queueWebsiteEmailTimers, websiteEmailJobCurrent } from "../functions/api/_websiteemails.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { onRequestPost as boostLivePost } from "../functions/api/boost-live.js";
import {
  onRequestPost as calendlyPost,
  pollCalendlyNoShows,
} from "../functions/api/calendly.js";
import { onRequestPost as checkPost } from "../functions/api/check.js";
import {
  processIntegrationJobs,
  repairIntegrationJobs,
  requeueDeadIntegrationJobs,
} from "../functions/api/_jobs.js";
import {
  dispatchIntegrationJob,
  IntegrationError,
} from "../functions/api/_providers.js";
import { KIT_TAG_IDS } from "../functions/api/_kit.js";
import { createLeadToken } from "../functions/api/_security.js";
import { onRequestPost as trackPost } from "../functions/api/track.js";

const CALENDLY_EVENT_TYPE_URI =
  "https://api.calendly.com/event_types/rank-boost-test-event";

test("runtime Kit tag IDs match the verified automation manifest", () => {
  const config = JSON.parse(
    readFileSync(new URL("../ops/kit-email-system.json", import.meta.url), "utf8")
  );
  assert.deepEqual(KIT_TAG_IDS, {
    lead: config.enrollment.unbooked.tag_id,
    booked: config.enrollment.booked.tag_id,
    noShow: config.enrollment.no_show.tag_id,
    boostLive: config.enrollment.boost_live.tag_id,
  });
});

function migratedSqlite() {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_secure_attribution.sql",
    "0003_reliable_integrations.sql",
    "0004_lifecycle_operations.sql",
    "0005_job_dependencies.sql",
    "0006_appointment_followup.sql",
  ]) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  return db;
}

function d1Sqlite(db) {
  return {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          const result = db.prepare(sql).run(...this.args);
          return { meta: { changes: Number(result.changes) || 0 } };
        },
        async first() {
          return db.prepare(sql).get(...this.args) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...this.args) };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const result = db.prepare(statement.sql).run(...statement.args);
          return { meta: { changes: Number(result.changes) || 0 } };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function applyStatements(db, statements) {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...statement.args);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordingDb(rows = [], firstRow = null, calendlyRows = [], options = {}) {
  const batches = [];
  const runs = [];
  return {
    batches,
    runs,
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          if (sql.includes("FROM calendly_invitees")) {
            return { results: calendlyRows };
          }
          return { results: sql.includes("FROM integration_jobs") ? rows : [] };
        },
        async first() {
          return firstRow;
        },
        async run() {
          runs.push({ sql, args: this.args });
          const deniedClaim =
            options.denyCalendlyClaim && sql.includes("SET poll_lease_token = ?1");
          return { meta: { changes: deniedClaim ? 0 : 1 } };
        },
      };
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({
        sql: statement.sql,
        args: statement.args,
      })));
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

async function calendlyRequest(event, key, includeRotatedSignature = false) {
  const body = JSON.stringify({
    created_at: "2026-08-18T12:00:00Z",
    ...event,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${timestamp}.${body}`)
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return new Request("https://example.test/api/calendly", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Calendly-Webhook-Signature":
        `t=${timestamp},` +
        (includeRotatedSignature ? `v1=${"0".repeat(64)},` : "") +
        `v1=${hex}`,
    },
    body,
  });
}

function queuedJobs(db) {
  return db.batches[0]
    .filter(({ sql }) => sql.includes("INTO integration_jobs"))
    .map(({ args }) => ({
      leadRef: args[0],
      kind: args[1],
      dedupeKey: args[2],
      payload: JSON.parse(args[3]),
    }));
}

function rankCheckDb() {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("RETURNING count")) return { count: 1 };
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({
        sql: statement.sql,
        args: statement.args,
      })));
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

test("rank check persists one lead and durable provider jobs", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({
      tasks: [{
        status_code: 20000,
        cost: 0.0125,
        result: [{
          total_count: 1,
          items: [{
            keyword_data: {
              keyword: "personal injury lawyer chicago",
              keyword_info: { search_volume: 100 },
            },
            ranked_serp_element: {
              serp_item: {
                rank_absolute: 18,
                type: "organic",
                url: "https://example.test/injury",
              },
            },
          }],
        }],
      }],
    });
  };
  try {
    const db = rankCheckDb();
    const waits = [];
    const response = await checkPost({
      request: new Request("https://threestripesdigital.com/rank-boost/law-firms/api/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://threestripesdigital.com",
          "CF-Connecting-IP": "192.0.2.10",
        },
        body: JSON.stringify({
          name: "Test Lawyer",
          phone: "+15555550110",
          email: "lawyer@example.test",
          website_url: "https://example.test",
          page_url: "https://threestripesdigital.com/rank-boost/law-firms/",
          event_id: "submission-test-10",
          external_id: "external-test-10",
        }),
      }),
      env: {
        DATAFORSEO_LOGIN: "dataforseo-test-login",
        DATAFORSEO_PASSWORD: "dataforseo-test-password",
        FUNNEL_SIGNING_KEY: "funnel-test-key",
        LEADS_DB: db,
      },
      waitUntil(promise) {
        waits.push(promise);
      },
    });
    await Promise.all(waits);

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.qualified, true);
    assert.ok(data.lead_token);
    const kitPayload = queuedJobs(db).find(({ kind }) => kind === "kit.upsert_tag").payload;
    assert.equal(kitPayload.fields.ctr_position_1, "40%");
    assert.equal(kitPayload.fields.lead_conversion_rate, "10%");
    assert.ok(kitPayload.fields.cases_per_month);
    assert.equal(requests.length, 1);
    const saved = db.batches[0];
    assert.match(saved[0].sql, /INSERT INTO leads/);
    assert.equal(saved[0].args.at(-1), 0.0125);
    assert.deepEqual(
      saved
        .filter(({ sql }) => sql.includes("INTO integration_jobs"))
        .map(({ args }) => args[1]),
      ["slack.webhook", "meta.events", "kit.upsert_tag"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Calendly lifecycle webhooks enqueue durable provider work", async (t) => {
  await t.test("booking queues Slack, Kit, and SMS with stable dedupe keys", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.equal(
        String(url),
        "https://api.calendly.com/scheduled_events/event-1"
      );
      return Response.json({
        resource: {
          uri: "https://api.calendly.com/scheduled_events/event-1",
          event_type: CALENDLY_EVENT_TYPE_URI,
          start_time: "2026-08-20T15:00:00Z",
        },
      });
    };
    try {
      const signingKey = "funnel-test-key";
      const leadToken = await createLeadToken(signingKey, "lead-booking-test", 60);
      const db = recordingDb([], { qualified: 1 });
      const waits = [];
      const key = "calendly-test-key";
      const request = await calendlyRequest({
        event: "invitee.created",
        payload: {
          uri: "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
          event: "https://api.calendly.com/scheduled_events/event-1",
          updated_at: "2026-08-18T12:00:00Z",
          name: "Test Lawyer",
          email: "lawyer@example.test",
          timezone: "America/New_York",
          tracking: { utm_content: leadToken },
          questions_and_answers: [
            { question: "Best phone number", answer: "+15555550100" },
            { question: "Firm website", answer: "example.test" },
          ],
        },
      }, key, true);

      const response = await calendlyPost({
        request,
        env: {
          CALENDLY_WEBHOOK_SIGNING_KEY: key,
          FUNNEL_SIGNING_KEY: signingKey,
          CALENDLY_PAT: "pat-test-value",
          CALENDLY_EVENT_TYPE_URI,
          LEADS_DB: db,
        },
        waitUntil(promise) {
          waits.push(promise);
        },
      });
      await Promise.all(waits);

      assert.equal(response.status, 200);
      const bookingFields = queuedJobs(db).find(({ kind }) => kind === "kit.upsert_tag").payload.fields;
      assert.equal(bookingFields.call_date, "Thursday, August 20, 2026");
      assert.equal(bookingFields.call_time, "11:00 AM EDT");
      assert.deepEqual(queuedJobs(db).map(({ kind }) => kind), [
        "slack.webhook",
        "kit.upsert_tag",
        "roezan.sms",
        "meta.events",
      ]);
      assert.ok(
        queuedJobs(db).every(({ dedupeKey }) => dedupeKey.includes("invitee-1"))
      );
      const inviteeRecord = db.batches[0].find(({ sql }) =>
        sql.includes("INTO calendly_invitees")
      );
      assert.equal(inviteeRecord.args[4], "2026-08-20 15:00:00");
      assert.equal(inviteeRecord.args[7], Date.parse("2026-08-18T12:00:00Z"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("no-show hydrates the invitee before durable acknowledgement", async () => {
    const originalFetch = globalThis.fetch;
    const signingKey = "funnel-test-key";
    const leadToken = await createLeadToken(signingKey, "lead-no-show-test", 60);
    globalThis.fetch = async (url) => {
      if (String(url).includes("/invitees/")) {
        return Response.json({
          resource: {
            uri: "https://api.calendly.com/scheduled_events/event-2/invitees/invitee-2",
            event: "https://api.calendly.com/scheduled_events/event-2",
            name: "No Show",
            email: "noshow@example.test",
            questions_and_answers: [
              { question: "Best phone number", answer: "+15555550101" },
            ],
            tracking: { utm_content: leadToken },
          },
        });
      }
      return Response.json({
        resource: {
          event_type: CALENDLY_EVENT_TYPE_URI,
          start_time: "2026-08-20T16:00:00Z",
        },
      });
    };
    try {
      const db = recordingDb([], { qualified: 1 });
      const waits = [];
      const key = "calendly-test-key";
      const request = await calendlyRequest({
        event: "invitee_no_show.created",
        payload: {
          invitee:
            "https://api.calendly.com/scheduled_events/event-2/invitees/invitee-2",
        },
      }, key);
      const response = await calendlyPost({
        request,
        env: {
          CALENDLY_WEBHOOK_SIGNING_KEY: key,
          FUNNEL_SIGNING_KEY: signingKey,
          CALENDLY_PAT: "pat-test-value",
          CALENDLY_EVENT_TYPE_URI,
          LEADS_DB: db,
        },
        waitUntil(promise) {
          waits.push(promise);
        },
      });
      await Promise.all(waits);

      assert.equal(response.status, 200);
      assert.deepEqual(queuedJobs(db).map(({ kind }) => kind), [
        "slack.webhook",
        "kit.tag_existing",
        "roezan.sms",
        "meta.events",
      ]);
      assert.equal(queuedJobs(db)[1].payload.email, "noshow@example.test");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("unrelated organization bookings are ignored", async () => {
    const db = recordingDb();
    const key = "calendly-test-key";
    const request = await calendlyRequest({
      event: "invitee.created",
      payload: {
        uri: "https://api.calendly.com/scheduled_events/event-3/invitees/invitee-3",
        name: "Other Client",
        email: "other@example.test",
        scheduled_event: {
          event_type: "https://api.calendly.com/event_types/other-client-event",
        },
      },
    }, key);
    const response = await calendlyPost({
      request,
      env: {
        CALENDLY_WEBHOOK_SIGNING_KEY: key,
        FUNNEL_SIGNING_KEY: "funnel-test-key",
        CALENDLY_EVENT_TYPE_URI,
        LEADS_DB: db,
      },
      waitUntil() {},
    });

    assert.equal(response.status, 200);
    assert.equal(db.batches.length, 0);
  });

});

test("Calendly polling converts a marked invitee into durable no-show work", async () => {
  const originalFetch = globalThis.fetch;
  const inviteeUri =
    "https://api.calendly.com/scheduled_events/event-poll/invitees/invitee-poll";
  globalThis.fetch = async (url) => {
    assert.equal(String(url), inviteeUri);
    return Response.json({
      resource: {
        uri: inviteeUri,
        event: "https://api.calendly.com/scheduled_events/event-poll",
        name: "Polling Test",
        email: "polling@example.test",
        no_show: { created_at: "2026-08-18T16:00:00Z" },
        questions_and_answers: [
          { question: "Best phone number", answer: "+15555550102" },
          { question: "Firm website", answer: "example.test" },
        ],
      },
    });
  };
  try {
    const db = recordingDb([], { qualified: 1 }, [{
      invitee_uri: inviteeUri,
      event_uri: "https://api.calendly.com/scheduled_events/event-poll",
      event_type_uri: CALENDLY_EVENT_TYPE_URI,
      lead_ref: "lead-poll-test",
      scheduled_start_at: "2026-08-18 15:00:00",
    }]);
    const summary = await pollCalendlyNoShows({
      CALENDLY_PAT: "pat-test-value",
      CALENDLY_EVENT_TYPE_URI,
      FUNNEL_SIGNING_KEY: "funnel-test-key",
      LEADS_DB: db,
    });

    assert.equal(summary.configured, true);
    assert.equal(summary.claimed, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.checked, 1);
    assert.equal(summary.noShows, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(queuedJobs(db).map(({ kind }) => kind), [
      "slack.webhook",
      "kit.tag_existing",
      "roezan.sms",
      "meta.events",
    ]);
    assert.ok(
      queuedJobs(db).every(({ dedupeKey }) =>
        dedupeKey.startsWith("calendly:no_show:invitee-poll:")
      )
    );
    const inviteeRecord = db.batches[0].find(({ sql }) =>
      sql.includes("INTO calendly_invitees")
    );
    assert.equal(inviteeRecord.args[5], "no_show");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Calendly polling skips invitees claimed by another cron", async () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return Response.json({});
  };
  try {
    const db = recordingDb([], null, [{
      invitee_uri:
        "https://api.calendly.com/scheduled_events/event-busy/invitees/invitee-busy",
      event_uri: "https://api.calendly.com/scheduled_events/event-busy",
      lead_ref: "lead-busy-test",
      scheduled_start_at: "2026-08-18 15:00:00",
    }], { denyCalendlyClaim: true });
    const summary = await pollCalendlyNoShows({
      CALENDLY_PAT: "pat-test-value",
      CALENDLY_EVENT_TYPE_URI,
      FUNNEL_SIGNING_KEY: "funnel-test-key",
      LEADS_DB: db,
    });

    assert.equal(summary.claimed, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.checked, 0);
    assert.equal(fetched, false);
    assert.equal(db.batches.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordered lifecycle keeps no-show precedence in both arrival orders", async () => {
  const key = "calendly-test-key";
  const inviteeUri =
    "https://api.calendly.com/scheduled_events/event-race/invitees/invitee-race";
  async function capture(event, updatedAt, extra = {}) {
    const db = recordingDb();
    const request = await calendlyRequest({
      created_at: updatedAt,
      event,
      payload: {
        uri: inviteeUri,
        event: "https://api.calendly.com/scheduled_events/event-race",
        name: "Terminal Race",
        email: "race@example.test",
        updated_at: updatedAt,
        scheduled_event: {
          event_type: CALENDLY_EVENT_TYPE_URI,
          start_time: "2026-08-18T15:00:00Z",
        },
        questions_and_answers: [
          { question: "Best phone number", answer: "+15555550103" },
        ],
        ...extra,
      },
    }, key);
    const response = await calendlyPost({
      request,
      env: {
        CALENDLY_WEBHOOK_SIGNING_KEY: key,
        FUNNEL_SIGNING_KEY: "funnel-test-key",
        CALENDLY_EVENT_TYPE_URI,
        LEADS_DB: db,
      },
      waitUntil() {},
    });
    assert.equal(response.status, 200);
    return db.batches[0];
  }

  const canceledEarly = await capture(
    "invitee.canceled",
    "2026-08-18T13:00:00Z"
  );
  const canceledLate = await capture(
    "invitee.canceled",
    "2026-08-18T15:00:00Z"
  );
  const noShow = await capture("invitee_no_show.created", "2026-08-18T14:00:00Z", {
    no_show: { created_at: "2026-08-18T16:00:00Z" },
  });
  const cases = [
    [canceledEarly, noShow],
    [noShow, canceledLate],
  ];
  for (const batches of cases) {
    const db = migratedSqlite();
    try {
      applyStatements(db, batches[0]);
      applyStatements(db, batches[1]);
      assert.equal(
        db.prepare("SELECT status FROM calendly_invitees").get().status,
        "no_show"
      );
      assert.equal(
        db.prepare("SELECT status FROM calendly_terminal_transitions").get().status,
        "no_show"
      );
      const leadColumns = db.prepare("PRAGMA table_info(leads)")
        .all()
        .map(({ name }) => name);
      assert.ok(leadColumns.includes("calendly_invitee_uri"));
      assert.ok(leadColumns.includes("calendly_lifecycle_at"));
    } finally {
      db.close();
    }
  }
});

test("rescheduled invitee remains current when webhooks arrive out of order", async () => {
  const key = "calendly-test-key";
  const signingKey = "funnel-test-key";
  const leadRef = "lead-reschedule-test";
  const leadToken = await createLeadToken(signingKey, leadRef, 60);
  const oldInvitee =
    "https://api.calendly.com/scheduled_events/event-old/invitees/invitee-old";
  const newInvitee =
    "https://api.calendly.com/scheduled_events/event-new/invitees/invitee-new";

  async function capture(event, payload) {
    const recorded = recordingDb([], { qualified: 1 });
    const response = await calendlyPost({
      request: await calendlyRequest({
        created_at: payload.updated_at,
        event,
        payload,
      }, key),
      env: {
        CALENDLY_WEBHOOK_SIGNING_KEY: key,
        FUNNEL_SIGNING_KEY: signingKey,
        CALENDLY_EVENT_TYPE_URI,
        LEADS_DB: recorded,
      },
      waitUntil() {},
    });
    assert.equal(response.status, 200);
    return recorded.batches[0];
  }

  function payload(uri, eventUri, updatedAt, relations = {}) {
    return {
      uri,
      event: eventUri,
      updated_at: updatedAt,
      name: "Reschedule Test",
      email: "reschedule@example.test",
      tracking: { utm_content: leadToken },
      scheduled_event: {
        uri: eventUri,
        event_type: CALENDLY_EVENT_TYPE_URI,
        start_time: "2026-08-20T15:00:00Z",
      },
      questions_and_answers: [
        { question: "Best phone number", answer: "+15555550104" },
      ],
      ...relations,
    };
  }

  const oldBooked = await capture(
    "invitee.created",
    payload(
      oldInvitee,
      "https://api.calendly.com/scheduled_events/event-old",
      "2026-08-18T12:00:00Z"
    )
  );
  const oldCanceled = await capture(
    "invitee.canceled",
    payload(
      oldInvitee,
      "https://api.calendly.com/scheduled_events/event-old",
      "2026-08-18T13:00:00Z",
      {
        rescheduled: true,
        cancellation: { created_at: "2026-08-18T13:00:00Z" },
        new_invitee: newInvitee,
      }
    )
  );
  const newBooked = await capture(
    "invitee.created",
    payload(
      newInvitee,
      "https://api.calendly.com/scheduled_events/event-new",
      "2026-08-18T14:00:00Z",
      { old_invitee: oldInvitee }
    )
  );

  const db = migratedSqlite();
  try {
    db.prepare(
      "INSERT INTO leads (lead_ref, status, qualified) VALUES (?1, 'qualified', 1)"
    )
      .run(leadRef);
    applyStatements(db, newBooked);
    applyStatements(db, oldCanceled);
    applyStatements(db, oldBooked);

    const lead = db.prepare(
      "SELECT status, calendly_invitee_uri FROM leads WHERE lead_ref = ?1"
    ).get(leadRef);
    assert.deepEqual({ ...lead }, {
      status: "booked",
      calendly_invitee_uri: newInvitee,
    });
    assert.deepEqual(
      db.prepare(
        "SELECT invitee_uri, status FROM calendly_invitees ORDER BY invitee_uri"
      ).all().map((row) => ({ ...row })),
      [
        { invitee_uri: newInvitee, status: "booked" },
        { invitee_uri: oldInvitee, status: "canceled" },
      ]
    );
    const jobs = db.prepare(
      "SELECT source_resource, source_status FROM integration_jobs ORDER BY id"
    ).all();
    assert.ok(jobs.length >= 3);
    assert.ok(jobs.every((job) =>
      job.source_resource === newInvitee && job.source_status === "booked"
    ));
  } finally {
    db.close();
  }
});

test("reschedule relation binds a new invitee without a redirect token", async () => {
  const originalFetch = globalThis.fetch;
  const key = "calendly-test-key";
  const signingKey = "funnel-test-key";
  const leadRef = "lead-reschedule-relation";
  const leadToken = await createLeadToken(signingKey, leadRef, 60);
  const oldEvent = "https://api.calendly.com/scheduled_events/event-relation-old";
  const newEvent = "https://api.calendly.com/scheduled_events/event-relation-new";
  const oldInvitee = `${oldEvent}/invitees/invitee-relation-old`;
  const newInvitee = `${newEvent}/invitees/invitee-relation-new`;
  const sqlite = migratedSqlite();
  const env = {
    CALENDLY_WEBHOOK_SIGNING_KEY: key,
    FUNNEL_SIGNING_KEY: signingKey,
    CALENDLY_PAT: "pat-test-value",
    CALENDLY_EVENT_TYPE_URI,
    LEADS_DB: d1Sqlite(sqlite),
  };
  const hydrationRequests = [];
  globalThis.fetch = async (url) => {
    hydrationRequests.push(String(url));
    assert.equal(String(url), newInvitee);
    return Response.json({
      resource: {
        uri: newInvitee,
        event: newEvent,
        name: "Updated Relation",
        email: "updated-relation@example.test",
        timezone: "America/Chicago",
        questions_and_answers: [
          { question: "Best phone number", answer: "+15555550199" },
          { question: "Firm website", answer: "updated.example.test" },
        ],
        created_at: "2026-08-18T14:00:00Z",
        updated_at: "2026-08-18T14:00:00Z",
      },
    });
  };

  async function send(event, createdAt, payload) {
    const response = await calendlyPost({
      request: await calendlyRequest({ created_at: createdAt, event, payload }, key),
      env,
    });
    assert.equal(response.status, 200);
  }

  function bookingPayload(uri, eventUri, tracking = null) {
    return {
      uri,
      event: eventUri,
      name: "Relation Test",
      email: "relation@example.test",
      ...(tracking ? { tracking } : {}),
      scheduled_event: {
        uri: eventUri,
        event_type: CALENDLY_EVENT_TYPE_URI,
        start_time: "2026-08-20T15:00:00Z",
      },
      questions_and_answers: [
        { question: "Best phone number", answer: "+15555550105" },
      ],
    };
  }

  try {
    sqlite.prepare(
      "INSERT INTO leads (lead_ref, status, qualified) VALUES (?1, 'qualified', 1)"
    ).run(leadRef);
    await send(
      "invitee.created",
      "2026-08-18T12:00:00Z",
      bookingPayload(oldInvitee, oldEvent, { utm_content: leadToken })
    );
    await send(
      "invitee.created",
      "2026-08-18T14:00:00Z",
      bookingPayload(newInvitee, newEvent)
    );
    assert.equal(
      sqlite.prepare(
        "SELECT lead_ref FROM calendly_invitees WHERE invitee_uri = ?1"
      ).get(newInvitee).lead_ref,
      null
    );
    await send(
      "invitee.canceled",
      "2026-08-18T13:00:00Z",
      {
        ...bookingPayload(oldInvitee, oldEvent),
        rescheduled: true,
        cancellation: { created_at: "2026-08-18T13:00:00Z" },
        new_invitee: newInvitee,
      }
    );

    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status, calendly_invitee_uri
         FROM leads WHERE lead_ref = ?1`
      ).get(leadRef) },
      { status: "booked", calendly_invitee_uri: newInvitee }
    );
    assert.equal(
      sqlite.prepare(
        "SELECT lead_ref FROM calendly_invitees WHERE invitee_uri = ?1"
      ).get(newInvitee).lead_ref,
      leadRef
    );
    assert.deepEqual(
      sqlite.prepare(
        `SELECT kind, payload_json FROM integration_jobs
         WHERE source_resource = ?1 ORDER BY id`
      ).all(newInvitee).map(({ kind }) => kind),
      ["slack.webhook", "kit.upsert_tag", "roezan.sms", "meta.events"]
    );
    const recoveredJobs = sqlite.prepare(
      `SELECT kind, payload_json FROM integration_jobs
       WHERE source_resource = ?1 ORDER BY id`
    ).all(newInvitee).map((job) => ({
      kind: job.kind,
      payload: JSON.parse(job.payload_json),
    }));
    assert.equal(hydrationRequests.length, 1);
    assert.match(recoveredJobs[0].payload.text, /Updated Relation/);
    assert.equal(recoveredJobs[1].payload.email, "updated-relation@example.test");
    assert.equal(recoveredJobs[2].payload.phone, "+15555550199");
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("terminal webhook binds a qualified lead before invitee creation", async () => {
  const key = "calendly-test-key";
  const signingKey = "funnel-test-key";
  const leadRef = "lead-terminal-first";
  const leadToken = await createLeadToken(signingKey, leadRef, 60);
  const eventUri = "https://api.calendly.com/scheduled_events/event-terminal-first";
  const inviteeUri = `${eventUri}/invitees/invitee-terminal-first`;
  const sqlite = migratedSqlite();
  const env = {
    CALENDLY_WEBHOOK_SIGNING_KEY: key,
    FUNNEL_SIGNING_KEY: signingKey,
    CALENDLY_EVENT_TYPE_URI,
    LEADS_DB: d1Sqlite(sqlite),
  };
  const basePayload = {
    uri: inviteeUri,
    event: eventUri,
    name: "Terminal First",
    email: "terminal@example.test",
    scheduled_event: {
      uri: eventUri,
      event_type: CALENDLY_EVENT_TYPE_URI,
      start_time: "2026-08-20T15:00:00Z",
    },
    questions_and_answers: [
      { question: "Best phone number", answer: "+15555550106" },
    ],
  };

  try {
    sqlite.prepare(
      "INSERT INTO leads (lead_ref, status, qualified) VALUES (?1, 'qualified', 1)"
    ).run(leadRef);
    const canceled = await calendlyPost({
      request: await calendlyRequest({
        created_at: "2026-08-18T14:00:00Z",
        event: "invitee.canceled",
        payload: {
          ...basePayload,
          tracking: { utm_content: leadToken },
          cancellation: { created_at: "2026-08-18T14:00:00Z" },
        },
      }, key),
      env,
    });
    assert.equal(canceled.status, 200);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status, calendly_invitee_uri
         FROM leads WHERE lead_ref = ?1`
      ).get(leadRef) },
      { status: "booking_canceled", calendly_invitee_uri: inviteeUri }
    );
    assert.deepEqual(
      sqlite.prepare("SELECT kind FROM integration_jobs ORDER BY id")
        .all()
        .map(({ kind }) => kind),
      ["slack.webhook", "roezan.sms", "meta.events"]
    );

    const created = await calendlyPost({
      request: await calendlyRequest({
        created_at: "2026-08-18T13:00:00Z",
        event: "invitee.created",
        payload: basePayload,
      }, key),
      env,
    });
    assert.equal(created.status, 200);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status, calendly_invitee_uri
         FROM leads WHERE lead_ref = ?1`
      ).get(leadRef) },
      { status: "booking_canceled", calendly_invitee_uri: inviteeUri }
    );
    assert.equal(
      sqlite.prepare(
        "SELECT status FROM calendly_invitees WHERE invitee_uri = ?1"
      ).get(inviteeUri).status,
      "canceled"
    );
  } finally {
    sqlite.close();
  }
});

test("integration providers use idempotent Kit enrollment and redact errors", async (t) => {
  await t.test("late booking dispatch clears reminder eligibility before applying booked tag", async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => { requests.push({ url: String(url), body: JSON.parse(options.body) }); return Response.json({}, { status: 201 }); };
    try {
      await dispatchIntegrationJob({ KIT_API_KEY: "fixture" }, "kit.upsert_tag", { tag_id: 22494644, email: "qa@example.test", qualified_call_start: "2020-01-01T00:00:00Z", fields: { call_24h_eligible: "yes", call_2h_eligible: "yes" } });
      assert.equal(requests[0].body.fields.call_24h_eligible, "no");
      assert.equal(requests[0].body.fields.call_2h_eligible, "no");
      assert.match(requests[1].url, /tags\/22494644\/subscribers$/);
    } finally { globalThis.fetch = originalFetch; }
  });
  await t.test("Kit tag enrollment ensures the subscriber first", async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({}, { status: 201 });
    };
    try {
      await dispatchIntegrationJob(
        { KIT_API_KEY: "kit-test-key" },
        "kit.upsert_tag",
        { tag_id: 22494626, email: "lawyer@example.test" }
      );
      assert.deepEqual(requests.map(({ url }) => url), [
        "https://api.kit.com/v4/subscribers",
        "https://api.kit.com/v4/tags/22494626/subscribers",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("direct Kit sequence enrollment is unsupported", async () => {
    await assert.rejects(
      dispatchIntegrationJob(
        { KIT_API_KEY: "kit-test-key" },
        "kit.add_sequence",
        { sequence_id: 2862358, email: "lawyer@example.test" }
      ),
      (error) => {
        assert.ok(error instanceof IntegrationError);
        assert.equal(error.message, "unknown_job_kind");
        return true;
      }
    );
  });

  await t.test("provider response bodies never enter durable errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("private-provider-detail", { status: 400 });
    try {
      await assert.rejects(
        dispatchIntegrationJob(
          { SLACK_WEBHOOK_URL: "https://example.test/slack" },
          "slack.webhook",
          { text: "test" }
        ),
        (error) => {
          assert.ok(error instanceof IntegrationError);
          assert.equal(error.message, "provider_http_400");
          assert.equal(error.retryable, false);
          assert.doesNotMatch(error.message, /private-provider-detail/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Slack bot delivery remains available without a webhook", async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ ok: true });
    };
    try {
      await dispatchIntegrationJob(
        {
          SLACK_BOT_TOKEN: "slack-test-token",
          SLACK_CHANNEL_ID: "channel-test-id",
        },
        "slack.webhook",
        { text: "test", destination: "leads" }
      );
      assert.equal(requests[0].url, "https://slack.com/api/chat.postMessage");
      assert.equal(
        requests[0].options.headers.Authorization,
        "Bearer slack-test-token"
      );
      assert.deepEqual(JSON.parse(requests[0].options.body), {
        channel: "channel-test-id",
        text: "test",
        unfurl_links: false,
        unfurl_media: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Slack bot replaces a definitively rejected webhook", async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) return new Response(null, { status: 410 });
      return Response.json({ ok: true });
    };
    try {
      await dispatchIntegrationJob(
        {
          SLACK_WEBHOOK_URL: "https://example.test/slack",
          SLACK_BOT_TOKEN: "slack-test-token",
          SLACK_CHANNEL_ID: "channel-test-id",
        },
        "slack.webhook",
        { text: "test", destination: "leads" }
      );
      assert.deepEqual(requests.map(({ url }) => url), [
        "https://example.test/slack",
        "https://slack.com/api/chat.postMessage",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("provider throttling exposes a bounded Retry-After delay", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, {
      status: 429,
      headers: { "Retry-After": "90" },
    });
    try {
      await assert.rejects(
        dispatchIntegrationJob(
          { SLACK_WEBHOOK_URL: "https://example.test/slack" },
          "slack.webhook",
          { text: "test" }
        ),
        (error) => {
          assert.equal(error.retryable, true);
          assert.equal(error.retryAfterSeconds, 90);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Slack 408 and 5xx responses stop automatic replay as ambiguous", async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const status of [408, 500]) {
        globalThis.fetch = async () => new Response(null, { status });
        await assert.rejects(
          dispatchIntegrationJob(
            { SLACK_WEBHOOK_URL: "https://example.test/slack" },
            "slack.webhook",
            { text: "test" }
          ),
          (error) => {
            assert.equal(error.retryable, true);
            assert.equal(error.deliveryUnknown, true);
            assert.equal(error.message, `provider_http_${status}`);
            return true;
          }
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("integration processor dead-letters configuration errors and can requeue them", async () => {
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO integration_jobs (kind, dedupe_key, payload_json)
       VALUES ('slack.webhook', 'test:missing-config', '{"text":"test"}')`
    ).run();
    const db = d1Sqlite(sqlite);
    const summary = await processIntegrationJobs({ LEADS_DB: db }, { limit: 1 });
    assert.equal(summary.claimed, 1);
    assert.equal(summary.dead, 1);
    assert.equal(summary.ambiguous, 0);
    const failed = sqlite.prepare(
      "SELECT status, last_error FROM integration_jobs"
    ).get();
    assert.deepEqual({ ...failed }, {
      status: "failed",
      last_error: "missing_slack_webhook_url",
    });
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM operational_alerts").get().count,
      1
    );
    assert.equal(
      await requeueDeadIntegrationJobs({ LEADS_DB: db }, {
        kind: "slack.webhook",
        limit: 10,
      }),
      1
    );
    assert.equal(
      sqlite.prepare("SELECT status FROM integration_jobs").get().status,
      "pending"
    );
  } finally {
    sqlite.close();
  }
});

test("tracking relay returns 503 when durable lead lookup is unavailable", async () => {
  const signingKey = "funnel-test-key";
  const leadToken = await createLeadToken(signingKey, "lead-test-ref", 60);
  const response = await trackPost({
    request: new Request("https://threestripesdigital.com/api/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://threestripesdigital.com",
      },
      body: JSON.stringify({
        event_name: "BookingStarted",
        event_id: "booking-test-event",
        lead_token: leadToken,
        page_url: "https://threestripesdigital.com/rank-boost/law-firms/results",
      }),
    }),
    env: {
      FUNNEL_SIGNING_KEY: signingKey,
      LEADS_DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() { throw new Error("test outage"); },
          };
        },
      },
    },
  });
  assert.equal(response.status, 503);
});

test("tracking receipt suppresses replay after completed-job retention", async () => {
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO leads
         (name, phone, email, domain, qualified, status, lead_ref)
       VALUES ('Test Lead', '5555550100', 'lead@example.test', 'example.test', 1, 'qualified', 'lead-track-ref')`
    ).run();
    const db = d1Sqlite(sqlite);
    const signingKey = "tracking-replay-signing-key";
    const leadToken = await createLeadToken(signingKey, "lead-track-ref", 60);
    const send = () => trackPost({
      request: new Request("https://threestripesdigital.com/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://threestripesdigital.com",
        },
        body: JSON.stringify({
          event_name: "BookingStarted",
          event_id: "booking-track-event",
          lead_token: leadToken,
          page_url: "https://threestripesdigital.com/rank-boost/law-firms/results",
        }),
      }),
      env: { FUNNEL_SIGNING_KEY: signingKey, LEADS_DB: db },
    });

    assert.equal((await send()).status, 204);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM integration_jobs").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM funnel_events").get().count, 1);

    sqlite.exec("DELETE FROM integration_jobs");
    assert.equal((await send()).status, 204);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM integration_jobs").get().count, 0);
  } finally {
    sqlite.close();
  }
});

test("integration processor leases and completes a queued job", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true });
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO integration_jobs (kind, dedupe_key, payload_json)
       VALUES ('slack.webhook', 'test:slack', '{"text":"test"}')`
    ).run();
    const db = d1Sqlite(sqlite);
    const summary = await processIntegrationJobs(
      { LEADS_DB: db, SLACK_WEBHOOK_URL: "https://example.test/slack" },
      { limit: 1 }
    );

    assert.equal(summary.claimed, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.dead, 0);
    assert.equal(
      sqlite.prepare("SELECT status FROM integration_jobs").get().status,
      "completed"
    );
    assert.deepEqual(
      sqlite.prepare(
        "SELECT event_type FROM integration_job_attempts ORDER BY id"
      ).all().map(({ event_type: eventType }) => eventType),
      ["started", "succeeded"]
    );
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("dependent jobs wait for a completed prerequisite", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let failBookedTag = true;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (failBookedTag) return new Response(null, { status: 500 });
    return Response.json({}, { status: 201 });
  };
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO integration_jobs
         (kind, dedupe_key, payload_json, depends_on_dedupe_key)
       VALUES
         ('kit.upsert_tag', 'boost:booked',
          '{"email":"lawyer@example.test","tag_id":22494644}', NULL),
         ('kit.upsert_tag', 'boost:live',
          '{"email":"lawyer@example.test","tag_id":22511246}', 'boost:booked')`
    ).run();
    const env = { LEADS_DB: d1Sqlite(sqlite), KIT_API_KEY: "kit-test-key" };

    const first = await processIntegrationJobs(env, { limit: 2 });
    assert.equal(first.claimed, 1);
    assert.equal(first.retried, 1);
    assert.equal(requests.length, 1);
    assert.deepEqual(
      sqlite.prepare(
        `SELECT dedupe_key, status, attempts
         FROM integration_jobs ORDER BY id`
      ).all().map((row) => ({ ...row })),
      [
        { dedupe_key: "boost:booked", status: "pending", attempts: 1 },
        { dedupe_key: "boost:live", status: "pending", attempts: 0 },
      ]
    );

    sqlite.prepare(
      `UPDATE integration_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE dedupe_key = 'boost:booked'`
    ).run();
    failBookedTag = false;
    const second = await processIntegrationJobs(env, { limit: 2 });
    assert.equal(second.completed, 1);
    assert.equal(requests.length, 3);
    assert.equal(
      sqlite.prepare(
        "SELECT status FROM integration_jobs WHERE dedupe_key = 'boost:live'"
      ).get().status,
      "completed"
    );
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("ambiguous Slack delivery requires an explicit targeted repair", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("simulated network reset");
  };
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO integration_jobs (lead_ref, kind, dedupe_key, payload_json)
       VALUES ('lead-ambiguous', 'slack.webhook', 'test:ambiguous', '{"text":"test"}')`
    ).run();
    const db = d1Sqlite(sqlite);
    const env = { LEADS_DB: db, SLACK_WEBHOOK_URL: "https://example.test/slack" };
    const processed = await processIntegrationJobs(env, { limit: 1 });
    assert.equal(processed.ambiguous, 1);
    assert.match(
      sqlite.prepare("SELECT last_error FROM integration_jobs").get().last_error,
      /^delivery_unknown:/
    );
    assert.deepEqual(
      await repairIntegrationJobs(env, { leadRef: "lead-ambiguous" }),
      { matched: 1, requeued: 0, skippedUnknown: 1 }
    );
    assert.deepEqual(
      await repairIntegrationJobs(env, {
        leadRef: "lead-ambiguous",
        confirmUnknown: true,
      }),
      { matched: 1, requeued: 1, skippedUnknown: 0 }
    );
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("stale Calendly jobs are completed without contacting providers", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return Response.json({ ok: true });
  };
  const sqlite = migratedSqlite();
  try {
    const oldInvitee =
      "https://api.calendly.com/scheduled_events/event-old/invitees/invitee-old";
    const newInvitee =
      "https://api.calendly.com/scheduled_events/event-new/invitees/invitee-new";
    sqlite.prepare(
      `INSERT INTO leads (lead_ref, status, calendly_invitee_uri)
       VALUES ('lead-stale', 'booked', ?1)`
    ).run(newInvitee);
    sqlite.prepare(
      `INSERT INTO calendly_invitees
         (invitee_uri, event_type_uri, lead_ref, status, provider_event_at_ms)
       VALUES (?1, ?2, 'lead-stale', 'canceled', 1)`
    ).run(oldInvitee, CALENDLY_EVENT_TYPE_URI);
    sqlite.prepare(
      `INSERT INTO integration_jobs
         (lead_ref, kind, dedupe_key, payload_json, source_resource, source_status)
       VALUES ('lead-stale', 'slack.webhook', 'test:stale', '{"text":"test"}', ?1, 'booked')`
    ).run(oldInvitee);
    const summary = await processIntegrationJobs({
      LEADS_DB: d1Sqlite(sqlite),
      SLACK_WEBHOOK_URL: "https://example.test/slack",
    }, { limit: 1 });
    assert.equal(summary.stale, 1);
    assert.equal(fetched, false);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status, last_error FROM integration_jobs"
      ).get() },
      { status: "completed", last_error: "skipped_stale_source" }
    );
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("Boost Live preserves delayed booked state without replaying messages", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({}, { status: 201 });
  };
  const sqlite = migratedSqlite();
  try {
    const invitee =
      "https://api.calendly.com/scheduled_events/event-live/invitees/invitee-live";
    sqlite.prepare(
      `INSERT INTO leads (lead_ref, status, calendly_invitee_uri)
       VALUES ('lead-live', 'boost_live', ?1)`
    ).run(invitee);
    sqlite.prepare(
      `INSERT INTO calendly_invitees
         (invitee_uri, event_type_uri, lead_ref, status, provider_event_at_ms)
       VALUES (?1, ?2, 'lead-live', 'booked', 1)`
    ).run(invitee, CALENDLY_EVENT_TYPE_URI);
    sqlite.prepare(
      `INSERT INTO integration_jobs
         (lead_ref, kind, dedupe_key, payload_json, source_resource, source_status)
       VALUES
         ('lead-live', 'kit.upsert_tag', 'test:live:kit',
          '{"email":"lawyer@example.test","tag_id":22494644}', ?1, 'booked'),
         ('lead-live', 'roezan.sms', 'test:live:sms',
          '{"phone":"+15555550109","message":"stale confirmation"}', ?1, 'booked')`
    ).run(invitee);
    const summary = await processIntegrationJobs({
      LEADS_DB: d1Sqlite(sqlite),
      KIT_API_KEY: "kit-test-key",
      ROEZAN_API_KEY: "roezan-test-key",
    }, { limit: 2 });

    assert.equal(summary.completed, 1);
    assert.equal(summary.stale, 1);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => url.startsWith("https://api.kit.com/")));
    assert.deepEqual(
      sqlite.prepare(
        "SELECT kind, last_error FROM integration_jobs ORDER BY id"
      ).all().map((row) => ({ ...row })),
      [
        { kind: "kit.upsert_tag", last_error: null },
        { kind: "roezan.sms", last_error: "skipped_stale_source" },
      ]
    );
  } finally {
    sqlite.close();
    globalThis.fetch = originalFetch;
  }
});

test("Calendly replays cannot regress a Boost Live lead", async () => {
  const key = "calendly-test-key";
  const leadRef = "lead-live-replay";
  const eventUri = "https://api.calendly.com/scheduled_events/event-live-replay";
  const inviteeUri = `${eventUri}/invitees/invitee-live-replay`;
  const providerAt = Date.parse("2026-08-18T12:00:00Z");
  const sqlite = migratedSqlite();
  try {
    sqlite.prepare(
      `INSERT INTO leads
         (lead_ref, email, status, qualified, boost_live_at,
          calendly_invitee_uri, calendly_provider_event_at_ms)
       VALUES (?1, 'lawyer@example.test', 'boost_live', 1, CURRENT_TIMESTAMP, ?2, ?3)`
    ).run(leadRef, inviteeUri, providerAt);
    sqlite.prepare(
      `INSERT INTO calendly_invitees
         (invitee_uri, event_uri, event_type_uri, lead_ref, status,
          provider_event_at_ms)
       VALUES (?1, ?2, ?3, ?4, 'booked', ?5)`
    ).run(inviteeUri, eventUri, CALENDLY_EVENT_TYPE_URI, leadRef, providerAt);

    const response = await calendlyPost({
      request: await calendlyRequest({
        event: "invitee.created",
        payload: {
          uri: inviteeUri,
          event: eventUri,
          name: "Live Replay",
          email: "lawyer@example.test",
          scheduled_event: {
            uri: eventUri,
            event_type: CALENDLY_EVENT_TYPE_URI,
            start_time: "2026-08-20T15:00:00Z",
          },
        },
      }, key),
      env: {
        CALENDLY_WEBHOOK_SIGNING_KEY: key,
        FUNNEL_SIGNING_KEY: "funnel-test-key",
        CALENDLY_EVENT_TYPE_URI,
        LEADS_DB: d1Sqlite(sqlite),
      },
    });

    assert.equal(response.status, 200);
    assert.equal(
      sqlite.prepare("SELECT status FROM leads WHERE lead_ref = ?1").get(leadRef).status,
      "boost_live"
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM integration_jobs").get().count,
      0
    );
  } finally {
    sqlite.close();
  }
});

test("Boost Live rejects leads outside the booked lifecycle state", async () => {
  const sqlite = migratedSqlite();
  try {
    for (const [index, status] of ["qualified", "booking_canceled", "no_show"].entries()) {
      const email = `state-${index}@example.test`;
      sqlite.prepare(
        `INSERT INTO leads (lead_ref, email, status, qualified)
         VALUES (?1, ?2, ?3, 1)`
      ).run(`lead-state-${index}`, email, status);
      const response = await boostLivePost({
        request: new Request("https://example.test/api/boost-live", {
          method: "POST",
          headers: {
            Authorization: "Bearer boost-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        }),
        env: {
          BOOST_ADMIN_TOKEN: "boost-test-key",
          LEADS_DB: d1Sqlite(sqlite),
        },
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "invalid_lifecycle_state" });
    }
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM integration_jobs").get().count,
      0
    );
  } finally {
    sqlite.close();
  }
});

test("Boost Live atomically records lifecycle state and provider jobs", async () => {
  const db = recordingDb([], {
    id: 9,
    lead_ref: "lead-test-9",
    name: "Test Lawyer",
    phone: "+15555550109",
    email: "lawyer@example.test",
    domain: "example.test",
    top_keywords: JSON.stringify([
      { keyword: "how long does an injury case take" },
      { keyword: "injury lawyer test", position: 12, volume: 100 },
    ]),
    status: "booked",
    qualified: 1,
    boost_live_at: null,
  });
  const waits = [];
  const response = await boostLivePost({
    request: new Request("https://example.test/api/boost-live", {
      method: "POST",
      headers: {
        Authorization: "Bearer boost-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "lawyer@example.test" }),
    }),
    env: {
      BOOST_ADMIN_TOKEN: "boost-test-key",
      LEADS_DB: db,
    },
    waitUntil(promise) {
      waits.push(promise);
    },
  });
  await Promise.all(waits);

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.keyword, "injury lawyer test");
  assert.deepEqual(data.queued, [
    "kit.upsert_tag",
    "kit.upsert_tag",
    "roezan.sms",
    "slack.webhook",
  ]);
  assert.match(db.batches[0][0].sql, /boost_live_at/);
  assert.deepEqual(queuedJobs(db).map(({ kind }) => kind), data.queued);
  assert.deepEqual(
    queuedJobs(db)
      .filter(({ kind }) => kind === "kit.upsert_tag")
      .map(({ payload }) => payload.tag_id),
    [22494644, 22511246]
  );
  const storedJobs = db.batches[0].slice(1);
  const bookedKey = "boost-live:lead-test-9:kit-booked";
  assert.equal(storedJobs[0].args[4], null);
  assert.ok(storedJobs.slice(1).every((statement) => statement.args[4] === bookedKey));
});

test("website booking lifecycle is separate, verified, replay-safe and rejects wrong qualification", async () => {
  const { WEBSITE_EVENT_TYPE_URI, WEBSITE_TAG_IDS } = await import("../functions/api/_offers.js");
  const { onRequestPost: bookingPost } = await import("../functions/api/booking.js");
  const sqlite = migratedSqlite();
  const db = d1Sqlite(sqlite);
  sqlite.exec("INSERT INTO leads (name, phone, email, domain, qualified, status, lead_ref) VALUES ('QA', '', 'qa@example.test', 'example.test', 0, 'no_fit', 'website-test')");
  const signingKey = "website-test-key";
  const token = await createLeadToken(signingKey, "website-test", 60);
  const event = "https://api.calendly.com/scheduled_events/website-event-test";
  const invitee = event + "/invitees/website-invitee-test";
  const env = { LEADS_DB: db, FUNNEL_SIGNING_KEY: signingKey, CALENDLY_EVENT_TYPE_URI, CALENDLY_PAT: "test", CALENDLY_WEBHOOK_SIGNING_KEY: "webhook-test" };
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ resource: { uri: event, event_type: WEBSITE_EVENT_TYPE_URI, start_time: "2026-09-15T15:00:00Z" } });
  const booking = async (body) => bookingPost({env, request: new Request("https://threestripesdigital.com/api/booking", {method:"POST", headers:{Origin:"https://threestripesdigital.com","Content-Type":"application/json"},body:JSON.stringify({token,...body})})});
  const lifecycle = async (kind, at) => {
    const request = await calendlyRequest({event:kind, payload:{uri:invitee,event,updated_at:at,name:"QA",email:"qa@example.test",tracking:{utm_content:token}}}, env.CALENDLY_WEBHOOK_SIGNING_KEY, true);
    // Keep this test offline: no job processor or outbound messages.
    return calendlyPost({request,env,waitUntil(){}});
  };
  try {
    assert.equal((await booking({action:"access",offer:"website"})).status,200);
    assert.equal((await booking({action:"access",offer:"boost"})).status,403);
    assert.equal((await booking({offer:"website",invitee,event})).status,404);
    assert.equal((await lifecycle("invitee.created","2026-09-08T12:00:00Z")).status,200);
    assert.equal((await lifecycle("invitee.created","2026-09-08T12:00:00Z")).status,200);
    const row=sqlite.prepare("SELECT qualified,status FROM leads WHERE lead_ref='website-test'").get();
    assert.equal(row.qualified,0); assert.equal(row.status,"booked");
    const jobs=sqlite.prepare("SELECT kind,payload_json FROM integration_jobs").all();
    assert.equal(jobs.length,3);
    const kit=JSON.parse(jobs.find(j=>j.kind==='kit.upsert_tag').payload_json);
    assert.equal(kit.tag_id,WEBSITE_TAG_IDS.booked);
    const meta=JSON.parse(jobs.find(j=>j.kind==='meta.events').payload_json);
    assert.equal(meta.events[0].event_name,"WebsiteConsultationBooked");
    assert.equal(meta.events[0].event_id,"websiteconsultationbooked-website-invitee-test");
    assert.ok(!jobs.some(j=>j.kind==='roezan.sms'));
    assert.equal((await booking({offer:"website",invitee,event})).status,200);
    assert.equal((await booking({offer:"boost",invitee,event})).status,404);
    assert.equal((await lifecycle("invitee.canceled","2026-09-08T13:00:00Z")).status,200);
    assert.equal((await lifecycle("invitee.created","2026-09-08T12:00:00Z")).status,200);
    assert.equal((await booking({offer:"website",invitee,event})).status,404);
    sqlite.exec("UPDATE leads SET status='check_failed'");
    assert.equal((await booking({action:"access",offer:"website"})).status,403);
    sqlite.exec("UPDATE leads SET status='qualified',qualified=1");
    assert.equal((await booking({action:"access",offer:"website"})).status,403);
    assert.equal((await booking({action:"access",offer:"boost"})).status,200);
  } finally { globalThis.fetch=original; sqlite.close(); }
});

test("website Kit transition removes prior lifecycle tags before setting the new state", async () => {
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async (url,options)=>{calls.push([url,options.method]);return Response.json({subscriber:{id:123}});};
  try {
    await dispatchIntegrationJob({KIT_API_KEY:'test'},'kit.upsert_tag',{email:'qa@example.test',tag_id:23211441,remove_tag_ids:[23211440]});
    assert.deepEqual(calls,[['https://api.kit.com/v4/subscribers','POST'],[`https://api.kit.com/v4/tags/${WEBSITE_EMAILS.tags.everBooked}/subscribers`,'POST'],['https://api.kit.com/v4/tags/23211440/subscribers/123','DELETE'],['https://api.kit.com/v4/tags/23211441/subscribers','POST'],[`https://api.kit.com/v4/sequences/${WEBSITE_EMAILS.sequences.precall}/subscribers`,'POST']]);
  } finally {globalThis.fetch=original;}
});


test("website reminder guard rejects qualified, canceled, replaced, and overdue appointments", () => {
  const payload={website_invitee:'current',website_deadline:'2030-01-01T12:15:00Z'};
  const lead={qualified:0,status:'booked',calendly_invitee_uri:'current'};
  const now=Date.parse('2030-01-01T12:00:00Z');
  assert.equal(websiteEmailJobCurrent(payload,lead,now),true);
  for(const changed of [{qualified:1},{status:'no_show'},{status:'booking_canceled'},{calendly_invitee_uri:'new'}])assert.equal(websiteEmailJobCurrent(payload,{...lead,...changed},now),false);
  assert.equal(websiteEmailJobCurrent(payload,lead,now+16*60000),false);
});

test("website unsubscribes never enroll and late booking jobs apply stop instead", async () => {
  const original=globalThis.fetch; const calls=[]; let state='cancelled';
  globalThis.fetch=async(url,options)=>{calls.push(url);return Response.json({subscriber:{id:123,state}});};
  try {
    await dispatchIntegrationJob({KIT_API_KEY:'test'},'kit.upsert_tag',{email:'qa@example.test',tag_id:23211441});
    assert.equal(calls.length,1);
    calls.length=0;state='active';
    await dispatchIntegrationJob({KIT_API_KEY:'test'},'kit.upsert_tag',{email:'qa@example.test',tag_id:23211441,website_call_start:'2020-01-01T00:00:00Z'});
    assert.ok(calls.some(url=>url.includes('/tags/'+WEBSITE_EMAILS.tags.stop+'/')));
    assert.ok(!calls.some(url=>url.includes('/sequences/')));
  } finally {globalThis.fetch=original;}
});

test("website timer queues once, ignores qualified and last-minute bookings", async () => {
  const sqlite=migratedSqlite(); const db=d1Sqlite(sqlite);
  try {
    for(const [ref,qualified,age] of [['website',0,'-2 days'],['main',1,'-2 days'],['late',0,'-1 minute']]) {
      sqlite.prepare("INSERT INTO leads (lead_ref,email,qualified,status,calendly_invitee_uri) VALUES (?,?,?,'booked',?)").run(ref,'qa@example.test',qualified,ref);
      sqlite.prepare("INSERT INTO calendly_invitees (invitee_uri,event_type_uri,lead_ref,status,scheduled_start_at,created_at) VALUES (?,'website',?,'booked',strftime('%Y-%m-%dT%H:%M:%SZ','now','+24 hours','-2 minutes'),datetime('now',?))").run(ref,ref,age);
    }
    assert.equal((await queueWebsiteEmailTimers({LEADS_DB:db})).queued,1);
    assert.equal((await queueWebsiteEmailTimers({LEADS_DB:db})).queued,0);
    const jobs=sqlite.prepare('SELECT lead_ref,payload_json FROM integration_jobs').all();
    assert.equal(jobs[0].lead_ref,'website');
    assert.equal(JSON.parse(jobs[0].payload_json).website_sequence_id,WEBSITE_EMAILS.sequences.tomorrow);
  } finally {sqlite.close();}
});


test("long-term website tag enrolls monthly nurture without restarting the daily series", async () => {
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url)=>{calls.push(url);return Response.json({subscriber:{id:123,state:'active'}});};
 try {
  await dispatchIntegrationJob({KIT_API_KEY:'test'},'kit.upsert_tag',{email:'qa@example.test',tag_id:WEBSITE_EMAILS.tags.longTerm,website_long_term:true});
  assert.ok(calls.some(url=>url.includes('/sequences/'+WEBSITE_EMAILS.sequences.monthly+'/')));
  assert.ok(!calls.some(url=>url.includes('/sequences/'+WEBSITE_EMAILS.sequences.nurture+'/')));
 }finally{globalThis.fetch=original;}
});

function appointmentFixture(db, {offer='boost', startHours=72}={}) {
  const now=Date.now(), booked=new Date(now-60000).toISOString(), start=new Date(now+startHours*3600000).toISOString();
  db.prepare("INSERT INTO leads(lead_ref,email,phone,qualified,status,calendly_invitee_uri) VALUES ('appointment-lead','qa@example.test','2025550100',?1,'booked','invitee-current')").run(offer==='boost'?1:0);
  db.prepare("INSERT INTO calendly_invitees(invitee_uri,event_type_uri,lead_ref,status,scheduled_start_at,created_at) VALUES ('invitee-current','test-event','appointment-lead','booked',?1,?2)").run(start,booked);
  db.prepare("INSERT INTO appointment_followup(invitee_uri,lead_ref,offer,email,phone,first_name,timezone,starts_at,journey_started_at,booked_at) VALUES ('invitee-current','appointment-lead',?1,'qa@example.test','12025550100','QA','America/New_York',?2,?3,?3)").run(offer,start,booked);
  return {now,booked,start};
}

test('appointment scheduler preserves both approved cadences and repeats the rotation',()=>{
  const origin=Date.parse('2026-09-09T12:00:00Z');
  const row={offer:'boost',starts_at:'2026-10-09T12:00:00Z',journey_started_at:'2026-09-09 12:00:00',booked_at:'2026-09-09 12:00:00'};
  assert.equal(utcTime(row.booked_at),origin);
  for(const [hours,key] of [[0,'Q01'],[10,'Q06'],[24,'Q07'],[34,'Q12'],[48,'Q13'],[184,'Q13']])assert.ok(appointmentSlots(row,origin+hours*3600000).some(s=>s.key===key));
  row.offer='website';
  for(const [hours,key] of [[0,'W0'],[9,'W3'],[24,'W4'],[42,'W7'],[50,'P0'],[114,'P0']])assert.ok(appointmentSlots(row,origin+hours*3600000).some(s=>s.key===key));
  assert.deepEqual(appointmentSlots(row,Date.parse(row.starts_at)-29*60000),[]);
  assert.equal(localSmsHour('America/New_York',Date.parse('2026-09-09T13:00:00Z')),9);
  assert.equal(localSmsHour(''),null);
});

test('appointment timers are idempotent and obsolete/cutoff jobs cannot send',async()=>{
  for(const offer of ['boost','website']) {
    const db=migratedSqlite(),{now}=appointmentFixture(db,{offer}),env={LEADS_DB:d1Sqlite(db),APPOINTMENT_FOLLOWUP_ENABLED:'true'};
    assert.equal((await queueAppointmentTimers(env,now)).queued,2);
    assert.equal((await queueAppointmentTimers(env,now)).queued,0);
    const email=JSON.parse(db.prepare("SELECT payload_json FROM integration_jobs WHERE kind='kit.appointment_email'").get().payload_json);
    assert.equal(await appointmentCurrent(env.LEADS_DB,email,now),true);
    db.prepare("UPDATE leads SET calendly_invitee_uri='replacement'").run();
    assert.equal(await appointmentCurrent(env.LEADS_DB,email,now),false);
    db.prepare("UPDATE leads SET calendly_invitee_uri='invitee-current'").run();
    db.prepare("UPDATE appointment_followup SET starts_at=?1").run(new Date(now+29*60000).toISOString());
    assert.equal(await appointmentCurrent(env.LEADS_DB,email,now),false);
    assert.equal((await queueAppointmentTimers(env,now)).queued,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integration_jobs WHERE kind='kit.appointment_stop'").get().n,1);
    db.close();
  }
});

test('reschedules preserve journey position but get new appointment reminder keys',async()=>{
  const db=migratedSqlite(),{booked}=appointmentFixture(db),env={LEADS_DB:d1Sqlite(db)};
  const start=new Date(Date.now()+72*3600000).toISOString();
  db.prepare("INSERT INTO calendly_invitees(invitee_uri,event_type_uri,lead_ref,status,scheduled_start_at,old_invitee_uri) VALUES ('replacement','test-event','appointment-lead','booked',?1,'invitee-current')").run(start);
  db.prepare("UPDATE leads SET calendly_invitee_uri='replacement'").run();
  assert.equal(await registerAppointment(env,{lead_ref:'appointment-lead',appointment_invitee:'replacement',qualified_call_start:start,email:'qa@example.test'}),true);
  assert.equal(db.prepare("SELECT journey_started_at FROM appointment_followup WHERE invitee_uri='replacement'").get().journey_started_at,booked);
  assert.equal(await registerAppointment(env,{lead_ref:'appointment-lead',appointment_invitee:'invitee-current',email:'qa@example.test'}),false);
  const row={offer:'boost',starts_at:'2026-09-15T12:00:00Z',journey_started_at:booked,booked_at:'2026-09-10T12:00:00Z'};
  assert.ok(appointmentSlots(row,Date.parse('2026-09-14T12:01:00Z')).some(s=>s.key==='R01'));
  row.booked_at='2026-09-14T13:00:00Z';
  assert.ok(!appointmentSlots(row,Date.parse('2026-09-14T12:01:00Z')).some(s=>s.key==='R01'));
  db.close();
});

test('recovery URLs carry verifiable attribution instead of a generic calendar',async()=>{
  const env={FUNNEL_SIGNING_KEY:'recovery-test-secret'},link=await recoveryBookingLink(env,'qualified-page-one');
  const url=new URL(link),claims=await verifyLeadToken(env.FUNNEL_SIGNING_KEY,url.searchParams.get('lead_token'));
  assert.equal(url.pathname,'/rank-boost/law-firms/book');assert.equal(claims.ref,'qualified-page-one');
});

test('SMS replies confirm the current appointment and STOP persists without duplicate notifications',async()=>{
  const db=migratedSqlite(),{booked}=appointmentFixture(db),env={LEADS_DB:d1Sqlite(db),APPOINTMENT_FOLLOWUP_ENABLED:'true',ROEZAN_API_KEY:'test'};
  const original=globalThis.fetch;
  globalThis.fetch=async url=>Response.json(String(url).includes('/messages?')?{messages:[{id:1,content:'YES',created_at:new Date(Date.parse(booked)+1000).toISOString()},{id:2,content:'STOP',created_at:new Date(Date.parse(booked)+2000).toISOString()}]}:{contact:{id:55,opted_in:1}});
  try {
    assert.equal((await pollSmsReplies(env)).received,2);
    assert.ok(db.prepare('SELECT confirmed_at FROM appointment_followup').get().confirmed_at);
    assert.equal(db.prepare('SELECT phone FROM sms_suppression').get().phone,'12025550100');
    db.prepare('UPDATE appointment_followup SET reply_checked_at=NULL').run();
    assert.equal((await pollSmsReplies(env)).received,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integration_jobs WHERE kind='slack.webhook'").get().n,2);
    assert.equal(classifyReply('I have a question'),'needs_reply');
  } finally {globalThis.fetch=original;db.close();}
});

test('managed appointment registration suppresses legacy delivery before clearing cancellations',async()=>{
  const db=migratedSqlite();appointmentFixture(db);db.prepare('DELETE FROM appointment_followup').run();
  const env={LEADS_DB:d1Sqlite(db),APPOINTMENT_FOLLOWUP_ENABLED:'true',KIT_API_KEY:'test'};
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push({url:String(url),method:opts.method});return Response.json({subscriber:{id:11,state:'active'}});};
  try {
    await dispatchIntegrationJob(env,'kit.upsert_tag',{tag_id:22494644,email:'qa@example.test',lead_ref:'appointment-lead',appointment_invitee:'invitee-current',qualified_call_start:new Date(Date.now()+72*3600000).toISOString()});
    const managed=calls.findIndex(c=>c.url.includes('/tags/'+APPOINTMENT_EMAILS.tags.managed+'/'));
    assert.ok(managed>=0&&managed<calls.findIndex(c=>c.method==='DELETE'));
    assert.ok(!calls.some(c=>c.url.includes('/sequences/')));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM appointment_followup').get().n,1);
  } finally {globalThis.fetch=original;db.close();}
});

test('appointment email repeats target only the verified subscriber and stop for obsolete appointments',async()=>{
  const db=migratedSqlite();appointmentFixture(db);const original=globalThis.fetch;const sends=[];let stopped=false;
  globalThis.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path==='/v4/subscribers')return Response.json({subscribers:[{id:11,state:'active'}]});
    if(path==='/v4/subscribers/11/tags')return Response.json({tags:stopped?[{id:23211559}]:[]});
    if(path.endsWith('/subscribers')&&path.includes('/sequences/')){sends.push(JSON.parse(options.body));return Response.json({subscriber:{id:11}});}
    throw Error('Unexpected provider request');
  };
  const payload={email:'qa@example.test',sequence_id:APPOINTMENT_EMAILS.boost.R01.id,appointment_invitee:'invitee-current',appointment_timer:true};
  try {
    for(let i=0;i<2;i++)await dispatchIntegrationJob({KIT_API_KEY:'test',LEADS_DB:d1Sqlite(db)},'kit.appointment_email',payload);
    assert.equal(sends.length,2);assert.deepEqual(sends[0],{email_address:'qa@example.test'});
    stopped=true;
    await dispatchIntegrationJob({KIT_API_KEY:'test',LEADS_DB:d1Sqlite(db)},'kit.appointment_email',payload);
    assert.equal(sends.length,2);
    db.prepare("UPDATE leads SET status='no_show'").run();stopped=false;
    await dispatchIntegrationJob({KIT_API_KEY:'test',LEADS_DB:d1Sqlite(db)},'kit.appointment_email',payload);
    assert.equal(sends.length,2);
  } finally {globalThis.fetch=original;db.close();}
});

test('SMS sends honor both local suppression and the provider opt-out state',async()=>{
  const db=migratedSqlite();appointmentFixture(db);const original=globalThis.fetch,calls=[];
  const env={APPOINTMENT_FOLLOWUP_ENABLED:'true',LEADS_DB:d1Sqlite(db),ROEZAN_API_KEY:'test'};
  const payload={phone:'2025550100',message:'Test',appointment_timezone:'America/New_York'};
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json({contact:{opted_in:0}});};
  try {
    db.prepare("INSERT INTO sms_suppression(phone) VALUES ('12025550100')").run();
    await dispatchIntegrationJob(env,'roezan.sms',payload);assert.equal(calls.length,0);
    db.prepare('DELETE FROM sms_suppression').run();
    await dispatchIntegrationJob(env,'roezan.sms',payload);assert.equal(calls.length,1);assert.ok(!calls[0].includes('/send'));
  } finally {globalThis.fetch=original;db.close();}
});

test('a newer booking from a repeated scan prevents the old lead sending or applying its cutoff',async()=>{
  const db=migratedSqlite();appointmentFixture(db);
  const api=d1Sqlite(db),payload={appointment_invitee:'invitee-current',appointment_timer:true};
  assert.equal(await appointmentCurrent(api,payload),true);
  db.prepare("INSERT INTO appointment_followup(invitee_uri,lead_ref,offer,email,starts_at,journey_started_at,booked_at) VALUES ('new-scan-booking','another-lead','boost','QA@example.test',datetime('now','+3 days'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run();
  assert.equal(await appointmentCurrent(api,payload),false);
  assert.equal(await appointmentCurrent(api,{...payload,appointment_stop:true}),false);
  assert.equal((await queueAppointmentTimers({LEADS_DB:api,APPOINTMENT_FOLLOWUP_ENABLED:'true'})).queued,0);
  db.close();
});

test('first-place-only scan avoids website enrollment and returns an honest result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({tasks:[{status_code:20000,result:[{items:[{
    keyword_data:{keyword:'divorce lawyer chicago',keyword_info:{search_volume:100}},
    ranked_serp_element:{serp_item:{rank_absolute:1,type:'organic'}}
  }]}]}]});
  try {
    const db=rankCheckDb(); const waits=[];
    const response=await checkPost({request:new Request('https://threestripesdigital.com/rank-boost/law-firms/api/check',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'https://threestripesdigital.com','CF-Connecting-IP':'192.0.2.20'},
      body:JSON.stringify({name:'QA',phone:'+15555550110',email:'qa@example.test',website_url:'https://example.test',event_id:'first-place-only-test',page_url:'https://threestripesdigital.com/rank-boost/law-firms/'})
    }),env:{DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test',FUNNEL_SIGNING_KEY:'test-signing-key',LEADS_DB:db},waitUntil(p){waits.push(p)}});
    await Promise.all(waits);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.qualified,false);
    assert.equal(result.reason_not_qualified,'already_first');
    assert.equal(queuedJobs(db).some(j=>j.kind==='kit.upsert_tag'),false);
    assert.equal(db.batches[0].find(s=>s.sql.includes('INSERT INTO leads')).args[7],'already_first');
  } finally {globalThis.fetch=originalFetch;}
});
