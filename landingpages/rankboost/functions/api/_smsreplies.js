import { lifecycleEnabled, normalizedPhone, utcTime } from './_appointments.js';

export function classifyReply(content) {
  const value=String(content||'').trim().toUpperCase().replace(/[.!]+$/,'');
  if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPT OUT'].includes(value))return 'stop';
  if(['YES','Y','CONFIRM','CONFIRMED'].includes(value))return 'confirmed';
  return 'needs_reply';
}
async function api(env,path) {
  const r=await fetch('https://app.roezan.com/api/integrations/'+path,{headers:{'X-Api-Key':env.ROEZAN_API_KEY},signal:AbortSignal.timeout(2500)});
  if(r.status===404)return null;
  if(!r.ok)throw Error('roezan_reply_http_'+r.status);
  return r.json();
}
export async function pollSmsReplies(env) {
  if(!lifecycleEnabled(env)||!env.ROEZAN_API_KEY)return {checked:0,received:0};
  const db=env.LEADS_DB;
  const {results=[]}=await db.prepare(`SELECT a.*,l.status AS lead_status FROM appointment_followup a JOIN leads l ON l.lead_ref=a.lead_ref
    WHERE a.phone<>'' AND l.calendly_invitee_uri=a.invitee_uri AND datetime(a.starts_at)>datetime('now','-1 day')
    AND a.invitee_uri=(SELECT invitee_uri FROM appointment_followup latest WHERE lower(latest.email)=lower(a.email)
      ORDER BY datetime(latest.booked_at) DESC,latest.rowid DESC LIMIT 1)
    AND (a.reply_checked_at IS NULL OR a.reply_checked_at<datetime('now','-5 minutes'))
    ORDER BY COALESCE(a.reply_checked_at,'') LIMIT 2`).all();
  let received=0,failed=0;
  for(const row of results) {
    try {
      const found=await api(env,'contacts?phone='+encodeURIComponent(row.phone));
      const contact=found?.contact;
      if(contact) {
        if(Number(contact.opted_in)===0||contact.opted_out_at)await db.prepare('INSERT OR IGNORE INTO sms_suppression(phone) VALUES (?1)').bind(normalizedPhone(row.phone)).run();
        const history=await api(env,`contacts/${contact.id}/messages?direction=inbound&limit=100`);
        for(const m of history?.messages||[]) {
          if(utcTime(m.created_at)<utcTime(row.booked_at))continue;
          const classification=classifyReply(m.content),receipt='roezan:'+m.id;
          const saved=await db.prepare('INSERT OR IGNORE INTO sms_reply_receipts(receipt,invitee_uri,received_at,classification) VALUES (?1,?2,?3,?4)').bind(receipt,row.invitee_uri,m.created_at,classification).run();
          if(!saved.meta?.changes)continue;
          received++;
          if(classification==='stop')await db.prepare('INSERT OR IGNORE INTO sms_suppression(phone) VALUES (?1)').bind(normalizedPhone(row.phone)).run();
          if(classification==='confirmed'&&row.lead_status==='booked'&&utcTime(m.created_at)<utcTime(row.starts_at))await db.prepare('UPDATE appointment_followup SET confirmed_at=?1 WHERE invitee_uri=?2 AND confirmed_at IS NULL').bind(m.created_at,row.invitee_uri).run();
          // Alert the owner, without copying arbitrary inbound content into Slack.
          const text=`Rank Boost SMS ${classification==='confirmed'?'attendance confirmed':classification==='stop'?'opt-out received':'reply needs attention'}: ${row.first_name||'Lead'} (${row.email}). Review the conversation in Roezan.`;
          await db.prepare("INSERT OR IGNORE INTO integration_jobs(lead_ref,kind,dedupe_key,payload_json) VALUES (?1,'slack.webhook',?2,?3)").bind(row.lead_ref,receipt+':notify',JSON.stringify({text})).run();
        }
      }
      await db.prepare('UPDATE appointment_followup SET reply_checked_at=CURRENT_TIMESTAMP,roezan_contact_id=?1 WHERE invitee_uri=?2').bind(contact?.id||null,row.invitee_uri).run();
    }catch {failed++;}
  }
  return {checked:results.length,received,failed};
}
