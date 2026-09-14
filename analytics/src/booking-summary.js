// Qualification is the passed form plus a verified Rank Boost booking.
export function bookingAttribution(call, campaigns) {
 const campaign=call.booking_campaign||call.campaign_id||'';
 if(call.is_test)return {kind:'excluded',reason:'Internal test'};
 if(call.status==='cancelled')return {kind:'excluded',reason:'Cancelled or rescheduled'};
 if(call.booking_source==='meta' || (call.session_id && campaigns.includes(call.campaign_id))) {
  if(campaign && !campaigns.includes(campaign))return {kind:'unattributed',reason:'Campaign is outside reporting scope'};
  return {kind:'verified',reason:campaign?'Recorded Meta campaign':'Meta source recorded; campaign missing'};
 }
 if(call.facebook_click)return {kind:'facebook',reason:'Facebook sourced (fbclid); campaign and ad set unknown'};
 return {kind:'unattributed',reason:call.booking_source?'Source is '+call.booking_source:'Source and ad identifiers missing'};
}
export function summarizeBookings(calls,{start,end,campaigns,selected=''}) {
 const scoped=calls.filter(c=>!c.is_test&&(!selected||((c.booking_campaign||c.campaign_id)===selected&&bookingAttribution(c,campaigns).kind==='verified')));
 const booked=scoped.filter(c=>c.booked_day>=start&&c.booked_day<=end&&c.status!=='cancelled');
 const verified=booked.filter(c=>bookingAttribution(c,campaigns).kind==='verified');
 const facebook=booked.filter(c=>c.facebook_click||bookingAttribution(c,campaigns).kind==='verified');
 return {scoped,booked,verified,facebook,qualified:booked.filter(c=>c.keyword_qualified===1),unattributed:booked.filter(c=>!facebook.includes(c)),paidUnattributed:booked.filter(c=>!verified.includes(c))};
}
