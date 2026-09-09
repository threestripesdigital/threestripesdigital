import { createLeadToken } from './_security.js';

export const BOOST_BOOKING_PAGE = 'https://threestripesdigital.com/rank-boost/law-firms/book';
export function boostBookingLink(token) {
  return BOOST_BOOKING_PAGE + '?lead_token=' + encodeURIComponent(token);
}
export async function recoveryBookingLink(env, leadRef) {
  return boostBookingLink(await createLeadToken(env.FUNNEL_SIGNING_KEY, leadRef, 180 * 86400));
}
