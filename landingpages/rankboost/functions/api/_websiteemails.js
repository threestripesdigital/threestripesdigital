import { WEBSITE_TAG_IDS } from './_offers.js';
import { WEBSITE_EMAILS } from './_websiteemailconfig.js';

// Appointment-relative reminders are queued by the existing minute processor.
// Exact source and time windows are checked again immediately before dispatch.
export function websiteEmailJobCurrent(payload, lead, now = Date.now()) {
  if (!lead || Number(lead.qualified) !== 0) return false;
  if (payload.website_long_term) return lead.status === 'no_fit';
  if (lead.calendly_invitee_uri !== payload.website_invitee) return false;
  if (lead.status !== 'booked') return false;
  if (payload.website_deadline && Date.parse(payload.website_deadline) <= now) return false;
  return true;
}

export async function queueWebsiteEmailTimers(env) {
  const db = env.LEADS_DB;
  if (!db) return { queued: 0 };
  const statements = [];
  for (const [key, hours] of [['tomorrow', 24], ['soon', 2], ['stop', 0.5]]) {
    const due = `-${hours} hours`;
    const { results = [] } = await db.prepare(`SELECT l.lead_ref,l.email,i.invitee_uri,i.scheduled_start_at
      FROM leads l JOIN calendly_invitees i ON i.invitee_uri=l.calendly_invitee_uri
      WHERE l.qualified=0 AND l.status='booked' AND i.status='booked'
        AND datetime(i.scheduled_start_at, ?1)<=CURRENT_TIMESTAMP
        AND (?2='stop' OR (datetime(i.scheduled_start_at, ?1, '+15 minutes')>CURRENT_TIMESTAMP
          AND i.created_at<datetime(i.scheduled_start_at, ?1)))
        AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.dedupe_key='website-email:'||i.invitee_uri||':'||?2)
      ORDER BY i.scheduled_start_at LIMIT 12`).bind(due,key).all();
    for (const row of results) {
      const payload = { email:row.email, tag_id:key==='stop'?WEBSITE_EMAILS.tags.stop:WEBSITE_TAG_IDS.booked,
        website_invitee:row.invitee_uri,
        ...(key==='stop'?{}:{website_sequence_id:WEBSITE_EMAILS.sequences[key],website_deadline:new Date(Date.parse(row.scheduled_start_at)-hours*3600000+15*60000).toISOString()}) };
      statements.push(db.prepare(`INSERT OR IGNORE INTO integration_jobs (lead_ref,kind,dedupe_key,payload_json)
        VALUES (?1,'kit.upsert_tag',?2,?3)`).bind(row.lead_ref,`website-email:${row.invitee_uri}:${key}`,JSON.stringify(payload)));
    }
  }
  const {results=[]}=await db.prepare(`SELECT lead_ref,email FROM leads l WHERE qualified=0 AND status='no_fit'
    AND created_at<datetime('now','-7 days') AND created_at>=?1
    AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.dedupe_key='website-long-term:'||l.lead_ref)
    ORDER BY created_at LIMIT 12`).bind(WEBSITE_EMAILS.enabledAfter).all();
  for(const row of results)statements.push(db.prepare(`INSERT OR IGNORE INTO integration_jobs (lead_ref,kind,dedupe_key,payload_json)
    VALUES (?1,'kit.upsert_tag',?2,?3)`).bind(row.lead_ref,`website-long-term:${row.lead_ref}`,JSON.stringify({email:row.email,tag_id:WEBSITE_EMAILS.tags.longTerm,website_long_term:true})));
  if(!statements.length)return {queued:0};
  const writes=await db.batch(statements);
  return {queued:writes.reduce((sum,r)=>sum+Number(r.meta?.changes||0),0)};
}
