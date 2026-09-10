import { lifecycleEnabled, normalizedPhone, utcTime } from './_appointments.js';
import { boostBookingLink } from './_bookinglinks.js';
import { WEBSITE_BOOKING_URL } from './_offers.js';
import { qualifiedKeywordEmailFields } from './_emailfields.js';
import { projectKeywords } from './_rankmodel.js';
import { classifyReply } from './_smsreplies.js';

const HOUR=3600000;
export const PREBOOKING_DELAYS=[10*60000,24*HOUR,72*HOUR];
export function prebookingStatement(env,lead,leadRef,token) {
 if(!lifecycleEnabled(env)||!['qualified','no_fit'].includes(lead.status))return null;
 const phone=normalizedPhone(lead.phone);
 if(!/^\d{10,15}$/.test(phone))return null;
 const offer=lead.status==='qualified'?'boost':'website';
 const top=projectKeywords(lead.domain,lead.keywords||[],8).keywords[0];
 return env.LEADS_DB.prepare(`INSERT OR IGNORE INTO prebooking_sms
  (lead_ref,offer,email,phone,first_name,domain,booking_url,keyword,position,opp_value)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
  .bind(leadRef,offer,lead.email||'',phone,(lead.name||'').trim().split(/\s+/)[0],lead.domain,
   offer==='boost'?boostBookingLink(token):WEBSITE_BOOKING_URL+'?utm_content='+encodeURIComponent(token),
   top?.keyword||'',top?String(top.position):'',top?qualifiedKeywordEmailFields(top).opp_value:'');
}

export function prebookingText(row,index) {
 const greeting=`Hi ${row.first_name||'there'}, it's Bilal from Three Stripes Digital.`;
 let text;
 if(row.offer==='boost') {
  const keyword=row.keyword?`Your scan found "${row.keyword}" at #${row.position}.`:`Your scan confirmed that ${row.domain} qualifies for Rank Boost.`;
  text=index===0?`${greeting} You qualify for Rank Boost. ${keyword}${row.opp_value?` At #1, our model estimates ${row.opp_value}/month in potential case value for that keyword.`:''} Book your free boost call:`:
   index===1?`${greeting} Following up on your Rank Boost scan. Let's walk through your keyword opportunity on a 30-minute call. No payment or logins required. Book here:`:
   `${greeting} Last follow-up text about your scan for ${row.domain}. Want to plan your free boost? Choose a time here:`;
 } else {
  text=index===0?`${greeting} Your site didn't qualify for Rank Boost yet. We didn't find it in Google's first 5 pages for the lawyer searches we checked. Let's review how a website built for search could help. Book your website consultation:`:
   index===1?`${greeting} Following up on your website scan. We can review a website plan to get your firm showing up on Google, then re-evaluate Rank Boost after it's live. Book your consultation:`:
   `${greeting} Last follow-up text about ${row.domain}. If you'd like to discuss getting your firm showing up on Google, book your website consultation here:`;
 }
 return `${text} ${row.booking_url} Reply with questions. Reply STOP to opt out.`;
}

export async function prebookingCurrent(db,payload,now=Date.now()) {
 const row=await db.prepare(`SELECT p.*,l.status AS lead_status,l.id AS lead_id FROM prebooking_sms p
  JOIN leads l ON l.lead_ref=p.lead_ref WHERE p.lead_ref=?1`).bind(payload.prebooking_lead).first();
 if(!row||row.stopped_at||row.lead_status!==(row.offer==='boost'?'qualified':'no_fit'))return false;
 if(now>utcTime(row.started_at)+7*24*HOUR||payload.sms_deadline&&now>=Date.parse(payload.sms_deadline))return false;
 // A newer scan, including a failed/manual-review result, supersedes this journey.
 const newer=await db.prepare(`SELECT id FROM leads WHERE id>?1 AND
  ((?2<>'' AND lower(email)=lower(?2)) OR
   ltrim(replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')',''),'1')=ltrim(?3,'1')) LIMIT 1`)
  .bind(row.lead_id,row.email,row.phone).first();
 if(newer)return false;
 // Booking either offer, including on an older submission, stops acquisition texts.
 const booked=await db.prepare(`SELECT a.invitee_uri FROM appointment_followup a JOIN calendly_invitees i ON i.invitee_uri=a.invitee_uri
  WHERE i.status='booked' AND (a.phone=?1 OR (?2<>'' AND lower(a.email)=lower(?2))) LIMIT 1`).bind(row.phone,row.email).first();
 if(booked)return false;
 const bookedLead=await db.prepare(`SELECT lead_ref FROM leads WHERE status='booked' AND
  ((?1<>'' AND lower(email)=lower(?1)) OR
   ltrim(replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')',''),'1')=ltrim(?2,'1')) LIMIT 1`).bind(row.email,row.phone).first();
 return !bookedLead;
}

export async function queuePrebookingSms(env,now=Date.now()) {
 if(!lifecycleEnabled(env))return {queued:0};
 const db=env.LEADS_DB;
 const {results=[]}=await db.prepare(`SELECT p.* FROM prebooking_sms p WHERE stopped_at IS NULL
  AND julianday(started_at)>julianday(?1,'-7 days') AND julianday(started_at)<=julianday(?1,'-10 minutes')
  AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.dedupe_key='prebooking:'||p.lead_ref||':'||
   CASE WHEN julianday(p.started_at)<=julianday(?1,'-72 hours') THEN '2'
        WHEN julianday(p.started_at)<=julianday(?1,'-24 hours') THEN '1' ELSE '0' END)
  ORDER BY started_at LIMIT 100`).bind(new Date(now).toISOString()).all();
 let queued=0;
 for(const row of results) {
  if(!await prebookingCurrent(db,{prebooking_lead:row.lead_ref},now)) {
   await db.prepare("UPDATE prebooking_sms SET stopped_at=CURRENT_TIMESTAMP,stop_reason='superseded_or_booked' WHERE lead_ref=?1 AND stopped_at IS NULL").bind(row.lead_ref).run();continue;
  }
  // A late processor run chooses only the latest due slot, never sends a burst.
  const index=PREBOOKING_DELAYS.findLastIndex(delay=>utcTime(row.started_at)+delay<=now);
  if(index<0)continue;
  const prior=await db.prepare(`SELECT completed_at FROM integration_jobs WHERE lead_ref=?1 AND kind='roezan.sms'
   AND json_extract(payload_json,'$.prebooking_lead') IS NOT NULL AND status='completed' AND last_error IS NULL ORDER BY completed_at DESC LIMIT 1`).bind(row.lead_ref).first();
  if(prior&&now-utcTime(prior.completed_at)<20*HOUR)continue;
  const deadline=utcTime(row.started_at)+(PREBOOKING_DELAYS[index+1]||7*24*HOUR);
  const payload={prebooking_lead:row.lead_ref,phone:row.phone,first_name:row.first_name,message:prebookingText(row,index),sms_deadline:new Date(deadline).toISOString()};
  const result=await db.prepare(`INSERT OR IGNORE INTO integration_jobs(lead_ref,kind,dedupe_key,payload_json)
   VALUES (?1,'roezan.sms',?2,?3)`).bind(row.lead_ref,`prebooking:${row.lead_ref}:${index}`,JSON.stringify(payload)).run();
  queued+=Number(result.meta?.changes||0);
 }
 return {queued};
}

async function roezanGet(env,path) {
 const r=await fetch('https://app.roezan.com/api/integrations/'+path,{headers:{'X-Api-Key':env.ROEZAN_API_KEY},signal:AbortSignal.timeout(2500)});
 if(r.status===404)return null;
 if(!r.ok)throw Error('roezan_reply_http_'+r.status);
 return r.json();
}
export async function checkPrebookingReplies(env,row,knownContact) {
 const contact=knownContact===undefined?(await roezanGet(env,'contacts?phone='+encodeURIComponent(row.phone)))?.contact:knownContact;
 if(!contact)return {received:0};
 const db=env.LEADS_DB;
 if(Number(contact.opted_in)===0||contact.opted_out_at)await db.prepare('INSERT OR IGNORE INTO sms_suppression(phone) VALUES (?1)').bind(row.phone).run();
 const history=await roezanGet(env,`contacts/${contact.id}/messages?direction=inbound&limit=100`);
 let received=0;
 for(const m of history?.messages||[]) {
  if(!Number.isFinite(utcTime(m.created_at))||utcTime(m.created_at)<utcTime(row.started_at))continue;
  const classification=classifyReply(m.content),receipt='roezan:'+m.id;
  // Stop even when the appointment poller has already recorded this reply.
  await db.prepare("UPDATE prebooking_sms SET stopped_at=COALESCE(stopped_at,CURRENT_TIMESTAMP),stop_reason='reply_received' WHERE phone=?1").bind(row.phone).run();
  if(classification==='stop')await db.prepare('INSERT OR IGNORE INTO sms_suppression(phone) VALUES (?1)').bind(row.phone).run();
  const saved=await db.prepare(`INSERT OR IGNORE INTO sms_reply_receipts(receipt,invitee_uri,received_at,classification)
   VALUES (?1,?2,?3,?4)`).bind(receipt,'prebooking:'+row.lead_ref,m.created_at,classification).run();
  if(saved.meta?.changes)received++;
  const title=classification==='stop'?'SMS opt-out received':'SMS reply needs attention';
  const text=`${title}. Review the conversation in Roezan. Pre-booking texts paused.`;
  const blocks=[{type:'header',text:{type:'plain_text',text:title}},{type:'section',text:{type:'plain_text',text:`${row.first_name||'Lead'} | ${row.phone}\n${row.email||row.domain}\nOffer: ${row.offer==='boost'?'Rank Boost':'Website consultation'}`}},{type:'section',text:{type:'plain_text',text:String(m.content||'(empty reply)').slice(0,2500)}},{type:'context',elements:[{type:'plain_text',text:'Pre-booking texts paused. Open this contact in Roezan to reply.'}]}];
  await db.prepare(`INSERT OR IGNORE INTO integration_jobs(lead_ref,kind,dedupe_key,payload_json)
   VALUES (?1,'slack.webhook',?2,?3)`).bind(row.lead_ref,receipt+':notify',JSON.stringify({text,blocks})).run();
 }
 await db.prepare('UPDATE prebooking_sms SET reply_checked_at=CURRENT_TIMESTAMP,roezan_contact_id=?1 WHERE lead_ref=?2').bind(contact.id,row.lead_ref).run();
 return {received};
}
export async function pollPrebookingReplies(env) {
 if(!lifecycleEnabled(env)||!env.ROEZAN_API_KEY)return {checked:0,received:0};
 const {results=[]}=await env.LEADS_DB.prepare(`SELECT p.* FROM prebooking_sms p
  WHERE started_at>datetime('now','-14 days') AND (reply_checked_at IS NULL OR reply_checked_at<datetime('now','-5 minutes'))
  AND EXISTS(SELECT 1 FROM integration_jobs j WHERE j.lead_ref=p.lead_ref AND j.kind='roezan.sms' AND j.status='completed' AND j.last_error IS NULL)
  ORDER BY COALESCE(reply_checked_at,'') LIMIT 1`).all();
 let received=0,failed=0;
 for(const row of results)try {received+=(await checkPrebookingReplies(env,row)).received;}catch {failed++;}
 return {checked:results.length,received,failed};
}
