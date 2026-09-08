import test from "node:test";
import assert from "node:assert/strict";
import { qualifiedKeywordEmailFields, qualifiedBookingEmailFields } from "../functions/api/_emailfields.js";

test("email opportunity figures match the scan including fractional cases", () => {
  const fields = qualifiedKeywordEmailFields({ keyword: "immigration lawyer", volume: 125, position: 27 });
  assert.deepEqual(fields, { ctr_position_1: "40%", current_ctr: "0.3%", current_clicks_per_month: "0", lead_conversion_rate: "10%", close_rate: "20%", cases_per_month: "1", opp_clicks: "50", opp_leads: "5", case_value: "$5,000", opp_value: "$5,000" });
  assert.equal(qualifiedKeywordEmailFields({ keyword: "lawyer", volume: 15, position: 1 }).cases_per_month, "0.12");
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
