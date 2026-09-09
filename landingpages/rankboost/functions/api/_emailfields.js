import { opportunityFor, currentValueFor, ctrFor, LEAD_CONVERSION_RATE, CLOSE_RATE } from "./_rankmodel.js";

const number = (value) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
const percent = (value) => Number(value).toLocaleString("en-US", { style: "percent", maximumFractionDigits: 2 });

export function qualifiedKeywordEmailFields(keyword) {
  const opportunity = opportunityFor(keyword.keyword, keyword.volume);
  const current = currentValueFor(keyword.keyword, keyword.volume, keyword.position);
  return {
    ctr_position_1: percent(ctrFor(1)), current_ctr: percent(current.ctr),
    current_clicks_per_month: number(current.clicks),
    lead_conversion_rate: percent(LEAD_CONVERSION_RATE), close_rate: percent(CLOSE_RATE),
    cases_per_month: number(opportunity.cases), opp_clicks: number(opportunity.clicks),
    opp_leads: number(opportunity.leads), case_value: "$" + number(opportunity.caseValue),
    opp_value: "$" + number(opportunity.monthly),
  };
}

export function qualifiedBookingEmailFields(start, invitee) {
  const fields = { call_date: "", call_time: "", calendly_link: "" };
  const date = new Date(start || "");
  if (Number.isFinite(date.getTime())) {
    let timeZone = String(invitee?.timezone || "UTC");
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(date); }
    catch { timeZone = "UTC"; }
    fields.call_date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
    fields.call_time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  }
  try {
    const link = new URL(invitee?.reschedule_url || "");
    if (link.protocol === "https:" && ["calendly.com", "www.calendly.com"].includes(link.hostname) && !link.username && !link.password) fields.calendly_link = link.href;
  } catch { /* Blank keeps the email's reply-to-reschedule fallback. */ }
  return fields;
}

// Kit interprets custom-date delays in the account timezone, not the invitee's.
// Calculate eligibility at dispatch so delayed webhook retries cannot send old reminders.
export function qualifiedReminderEmailFields(start, now = Date.now()) {
  const fields = { call_24h_due: "", call_2h_due: "", call_24h_eligible: "no", call_2h_eligible: "no" };
  const callTime = Date.parse(start || "");
  if (!Number.isFinite(callTime)) return fields;
  for (const hours of [24, 2]) {
    const due = callTime - hours * 60 * 60 * 1000;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(due)).map(p => [p.type, p.value]));
    fields[`call_${hours}h_due`] = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    // Leave one Kit processing interval so a reminder is not enrolled already overdue.
    fields[`call_${hours}h_eligible`] = due > now + 15 * 60 * 1000 ? "yes" : "no";
  }
  return fields;
}
