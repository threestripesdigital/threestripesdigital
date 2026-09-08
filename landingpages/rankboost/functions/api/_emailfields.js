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
