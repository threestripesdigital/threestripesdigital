import { dayIn, setState } from './meta.js';
const iso = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z').toISOString() : null;
export async function syncFunnel(env) {
 if(!env.LEADS_DB) return;
 try {
 // Deliberately read only non-PII reporting columns from the existing verified Calendly integration.
 const {results}=await env.LEADS_DB.prepare(`SELECT i.invitee_uri, i.lead_ref, i.scheduled_start_at, i.status,
 i.created_at, l.qualified FROM calendly_invitees i JOIN leads l ON l.lead_ref=i.lead_ref
 WHERE i.scheduled_start_at IS NOT NULL ORDER BY i.created_at DESC LIMIT 2000`).all();
 if(results.length===2000) throw Error('Booking import needs pagination');
 const statements=[];
 for(const c of results) {
  const booked=iso(c.created_at), scheduled=iso(c.scheduled_start_at);
  const status=c.status==='no_show'?'no_show':c.status==='canceled'?'cancelled':'scheduled';
  statements.push(env.DB.prepare(`INSERT INTO calls(id,session_id,booked_at,booked_day,scheduled_at,scheduled_day,status,keyword_qualified,updated_at)
   VALUES(?,(SELECT id FROM sessions WHERE lead_ref=? ORDER BY started_at LIMIT 1),?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=COALESCE(calls.session_id,excluded.session_id),
   scheduled_at=excluded.scheduled_at,scheduled_day=excluded.scheduled_day,keyword_qualified=excluded.keyword_qualified,
   status=CASE WHEN calls.attendance_updated_at IS NULL THEN excluded.status ELSE calls.status END`)
   .bind(c.invitee_uri,c.lead_ref,booked,dayIn(booked,env.REPORTING_TIMEZONE),scheduled,dayIn(scheduled,env.REPORTING_TIMEZONE),status,c.qualified?1:0,new Date().toISOString()));
 }
 if(statements.length)await env.DB.batch(statements);
 await setState(env,'funnel_success',new Date().toISOString());await setState(env,'funnel_error','');
 } catch {await setState(env,'funnel_error','Could not read verified booking records. Check the lead database schema and binding.');}
}
