import test from "node:test";
import assert from "node:assert/strict";
import { slackJobForLead } from "../functions/api/_slacklead.js";
import { dispatchIntegrationJob } from "../functions/api/_providers.js";

test("lead cards distinguish qualified, website, failed and internal scans without mentions", () => {
  const base = { name: "<!channel>", email: "test@example.com", domain: "example.com", total: 1,
    keywords: [{ keyword: "personal injury lawyer", position: 12, volume: 100 }] };
  const qualified = slackJobForLead({ ...base, qualified: true, status: "qualified" }, "lead-test");
  assert.match(qualified.payload.blocks[0].text.text, /Qualified/);
  assert.ok(!qualified.payload.text.includes("<!channel>"));
  assert.ok(qualified.payload.blocks[1].fields.every(f => f.type === "plain_text"));
  for (const [status, expected] of [["no_fit", "Website offer"], ["capacity_limited", "Scan needs review"]]) {
    const job = slackJobForLead({ ...base, status, keywords: [] }, "lead-test");
    assert.ok(job.payload.blocks[0].text.text.includes(expected));
  }
  const partner = slackJobForLead({ ...base, source: "partner" }, "partner-test");
  assert.equal(partner.payload.destination, "partner");
  assert.match(partner.payload.blocks[0].text.text, /internal/);
  assert.equal(slackJobForLead({ status: "rate_limited" }, "skip"), undefined);
});

test("both Slack transports preserve blocks and plain-text fallback", async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ ok: true }); };
  try {
    const { payload } = slackJobForLead({ name: "Test", domain: "example.com", status: "no_fit" }, "lead-test");
    for (const env of [{ SLACK_WEBHOOK_URL: "https://example.test/hook" }, { SLACK_BOT_TOKEN: "test", SLACK_CHANNEL_ID: "test" }]) {
      await dispatchIntegrationJob(env, "slack.webhook", payload);
    }
    assert.equal(sent.length, 2);
    for (const message of sent) {
      assert.deepEqual(message.blocks, payload.blocks);
      assert.equal(message.text, payload.text);
      assert.equal(message.unfurl_links, false);
    }
  } finally { globalThis.fetch = original; }
});
