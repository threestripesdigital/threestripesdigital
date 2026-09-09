import test from "node:test";
import assert from "node:assert/strict";
import { qualifiedKeywordEmailFields, qualifiedBookingEmailFields, qualifiedReminderEmailFields } from "../functions/api/_emailfields.js";

test("email opportunity figures match the scan including fractional cases", () => {
  const fields = qualifiedKeywordEmailFields({ keyword: "immigration lawyer", volume: 125, position: 27 });
  assert.deepEqual(fields, { ctr_position_1: "40%", current_ctr: "0.3%", current_clicks_per_month: "0", lead_conversion_rate: "10%", close_rate: "20%", cases_per_month: "1", opp_clicks: "50", opp_leads: "5", case_value: "$5,000", opp_value: "$5,000" });
  assert.equal(qualifiedKeywordEmailFields({ keyword: "lawyer", volume: 15, position: 1 }).cases_per_month, "0.12");
});

test("Kit reminder timestamps use account local time across daylight saving", () => {
  assert.deepEqual(qualifiedReminderEmailFields("2026-03-08T13:00:00Z", Date.parse("2026-03-06T00:00:00Z")), {
    call_24h_due: "2026-03-07 08:00", call_2h_due: "2026-03-08 07:00", call_24h_eligible: "yes", call_2h_eligible: "yes",
  });
});

test("short notice and stale bookings skip elapsed reminder windows", () => {
  const start = "2026-09-10T16:00:00Z";
  assert.equal(qualifiedReminderEmailFields(start, Date.parse("2026-09-10T01:00:00Z")).call_24h_eligible, "no");
  assert.equal(qualifiedReminderEmailFields(start, Date.parse("2026-09-10T01:00:00Z")).call_2h_eligible, "yes");
  assert.equal(qualifiedReminderEmailFields(start, Date.parse("2026-09-10T13:45:00Z")).call_2h_eligible, "no");
  assert.equal(qualifiedReminderEmailFields(start, Date.parse("2026-09-11T00:00:00Z")).call_2h_eligible, "no");
  assert.deepEqual(qualifiedReminderEmailFields("bad"), { call_24h_due: "", call_2h_due: "", call_24h_eligible: "no", call_2h_eligible: "no" });
});
test("booking fields use the invitee timezone and trusted reschedule link", () => {
  const fields = qualifiedBookingEmailFields("2026-09-10T01:00:00Z", { timezone: "America/Los_Angeles", reschedule_url: "https://calendly.com/reschedulings/fixture" });
  assert.equal(fields.call_date, "Wednesday, September 9, 2026");
  assert.equal(fields.call_time, "6:00 PM PDT");
  assert.equal(fields.calendly_link, "https://calendly.com/reschedulings/fixture");
});
test("missing booking fields clear stale values and invalid zones fall back to UTC", () => {
  assert.deepEqual(qualifiedBookingEmailFields(null, {}), { call_date: "", call_time: "", calendly_link: "" });
  for (const reschedule_url of ["javascript:alert(1)", "https://calendly.com.evil.test/reschedule", "https://user:pass@calendly.com/reschedule"]) {
    const fields = qualifiedBookingEmailFields("2026-09-10T01:00:00Z", { timezone: "invalid-zone", reschedule_url });
    assert.equal(fields.call_time, "1:00 AM UTC");
    assert.equal(fields.calendly_link, "");
  }
});
