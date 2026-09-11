import { dayIn, setState } from './meta.js';
const iso = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z').toISOString() : null;
export async function syncFunnel(env) {
 if(!env.LEADS_DB) return;
 try {
 // Deliberately read only non-PII reporting columns from the existing verified Calendly integration.
 const {results}=await env.LEADS_DB.prepare(`SELECT i.invitee_uri, i.lead_ref, i.scheduled_start_at, i.status,
 i.created_at, l.qualified FROM calendly_invitees i JOIN leads l ON l.lead_ref=i.lead_ref
 WHERE i.scheduled_start_at IS NOT NULL AND l.qualified = 1 AND i.event_type_uri = ? ORDER BY i.created_at DESC LIMIT 2000`).bind(env.CALENDLY_EVENT_TYPE_URI).all();
 if(results.length===2000) throw Error('Booking import needs pagination');
 const statements=[];
 for(const c of results) {
  const booked=iso(c.created_at), scheduled=iso(c.scheduled_start_at);
  const status=c.status==='no_show'?'no_show':c.status==='canceled'?'cancelled':'scheduled';
  statements.push(env.DB.prepare(`INSERT INTO calls(id,session_id,booked_at,booked_day,scheduled_at,scheduled_day,status,keyword_qualified,updated_at,event_type_uri)
   VALUES(?,(SELECT id FROM sessions WHERE lead_ref=? ORDER BY started_at LIMIT 1),?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=COALESCE(calls.session_id,excluded.session_id),
   event_type_uri=excluded.event_type_uri,scheduled_at=excluded.scheduled_at,scheduled_day=excluded.scheduled_day,keyword_qualified=excluded.keyword_qualified,
   status=CASE WHEN calls.attendance_updated_at IS NULL THEN excluded.status ELSE calls.status END`)
   .bind(c.invitee_uri,c.lead_ref,booked,dayIn(booked,env.REPORTING_TIMEZONE),scheduled,dayIn(scheduled,env.REPORTING_TIMEZONE),status,c.qualified?1:0,new Date().toISOString(),env.CALENDLY_EVENT_TYPE_URI));
 }
 if(statements.length)await env.DB.batch(statements);
 if (!env.CALENDLY_PAT) throw Error('Calendly reporting credential missing');
 const pending=(await env.DB.prepare('SELECT id FROM calls WHERE source_checked_at IS NULL LIMIT 100').all()).results;
 for(const call of pending) {
  if(!/^https:\/\/api\.calendly\.com\/scheduled_events\/[^/]+\/invitees\/[^/]+$/.test(call.id)) throw Error('Invalid invitee URI');
  const response=await fetch(call.id,{headers:{Authorization:'Bearer '+env.CALENDLY_PAT},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw Error('Calendly attribution lookup failed');
  const {resource}=await response.json();
  if(resource?.uri!==call.id) throw Error('Calendly invitee mismatch');
  const source=String(resource.tracking?.utm_source||'').trim().toLowerCase();
  const campaign=String(resource.tracking?.utm_campaign||'').trim();
  await env.DB.prepare('UPDATE calls SET booking_source=?,booking_campaign=?,source_checked_at=? WHERE id=?')
   .bind(source,campaign,new Date().toISOString(),call.id).run();
 }
 if(pending.length===100) throw Error('Calendly attribution backfill still running');
 await setState(env,'funnel_success',new Date().toISOString());await setState(env,'funnel_error','');
 } catch {await setState(env,'funnel_error','Could not read verified booking records. Check the lead database schema and binding.');}
}
