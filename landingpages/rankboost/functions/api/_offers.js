// Dedicated offer identities. Never route a website lead to the boost calendar.
export const WEBSITE_EVENT_TYPE_URI = "https://api.calendly.com/event_types/930ff674-3f3e-4f33-9fca-7e5984977ed0";
export const WEBSITE_BOOKING_URL = "https://calendly.com/bilal-threestripesdigital/three-stripes-digital-website-consultation";
export const WEBSITE_TAG_IDS = Object.freeze({ lead: 23211440, booked: 23211441, canceled: 23211442, noShow: 23211443 });
export function websiteEligible(lead) {
  return Boolean(lead && Number(lead.qualified) === 0 &&
    ["no_fit", "booked", "booking_canceled", "no_show"].includes(lead.status));
}
