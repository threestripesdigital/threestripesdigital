import { APPOINTMENT_EMAILS } from './_appointmentconfig.js';

export const lifecycleEnabled = env => env.APPOINTMENT_FOLLOWUP_ENABLED === 'true';
const HOUR = 3600000;
export const utcTime = value => Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(String(value))?String(value).replace(' ','T')+'Z':value);
export function normalizedPhone(value) {
  const digits=String(value||'').replace(/\D/g,'');
  return digits.length===10?'1'+digits:digits;
}
export function localSmsHour(timezone, now=Date.now()) {
  if(!timezone)return null;
  try {return Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(now));}
  catch {return null;}
}

// Keep the original nurture cadence across reschedules. Fresh rebookings start
// a new journey; reminders always belong to the new appointment.
export function appointmentSlots(row, now=Date.now()) {
  const start=utcTime(row.starts_at), origin=utcTime(row.journey_started_at), booked=utcTime(row.booked_at);
  if(!Number.isFinite(start)||!Number.isFinite(origin)||start<=now+0.5*HOUR)return [];
  const website=row.offer==='website';
  const core=website?[0,3,6,9,24,30,36,42]:[0,2,4,6,8,10,24,26,28,30,32,34];
  const elapsed=(now-origin)/HOUR;
  const slots=core.map((hour,i)=>({key:website?'W'+i:'Q'+String(i+1).padStart(2,'0'),index:'core-'+i,due:origin+hour*HOUR}));
  const rotationStart=website?50:48;
  if(elapsed>=rotationStart) {
    const index=Math.floor((elapsed-rotationStart)/8);
    slots.push({key:website?'P'+index%8:'Q'+String(13+index%17).padStart(2,'0'),index:'rotation-'+index,due:origin+(rotationStart+index*8)*HOUR});
  }
  for(const [key,hours] of [['R01',24],['R02',2]]) {
    const due=start-hours*HOUR;
    if(booked<due)slots.push({key,index:key,due});
  }
  return slots.filter(s=>s.due<=now&&now<s.due+15*60000);
}

export async function registerAppointment(env,payload) {
  const row=await env.LEADS_DB.prepare(`SELECT l.phone,i.invitee_uri,i.old_invitee_uri,i.created_at,i.scheduled_start_at
    FROM leads l JOIN calendly_invitees i ON i.invitee_uri=l.calendly_invitee_uri
    WHERE l.lead_ref=?1 AND l.status='booked' AND i.status='booked'`).bind(payload.lead_ref).first();
  if(!row||row.invitee_uri!==payload.appointment_invitee)return false;
  const previous=row.old_invitee_uri?await env.LEADS_DB.prepare('SELECT journey_started_at FROM appointment_followup WHERE invitee_uri=?1').bind(row.old_invitee_uri).first():null;
  await env.LEADS_DB.prepare(`INSERT OR IGNORE INTO appointment_followup
    (invitee_uri,lead_ref,offer,email,phone,first_name,timezone,starts_at,journey_started_at,booked_at,kit_subscriber_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
    .bind(row.invitee_uri,payload.lead_ref,payload.website_call_start?'website':'boost',payload.email,
      normalizedPhone(payload.appointment_phone||row.phone),payload.first_name||'',payload.appointment_timezone||'',row.scheduled_start_at,
      previous?.journey_started_at||row.created_at,row.created_at,payload.kit_subscriber_id||null).run();
  return true;
}

export async function appointmentCurrent(db,payload,now=Date.now()) {
  const row=await db.prepare(`SELECT a.*,l.status AS lead_status,l.calendly_invitee_uri,i.status AS invitee_status
    FROM appointment_followup a JOIN leads l ON l.lead_ref=a.lead_ref
    JOIN calendly_invitees i ON i.invitee_uri=a.invitee_uri WHERE a.invitee_uri=?1`)
    .bind(payload.appointment_invitee).first();
  if(!row||row.lead_status!=='booked'||row.invitee_status!=='booked'||row.calendly_invitee_uri!==row.invitee_uri)return false;
  if(payload.appointment_stop)return true;
  if(row.stopped_at||utcTime(row.starts_at)<=now+30*60000)return false;
  if(payload.appointment_deadline&&Date.parse(payload.appointment_deadline)<=now)return false;
  return true;
}

export async function queueAppointmentTimers(env,now=Date.now()) {
  if(!lifecycleEnabled(env))return {queued:0};
  const db=env.LEADS_DB;
  const {results=[]}=await db.prepare(`SELECT a.* FROM appointment_followup a
    JOIN leads l ON l.lead_ref=a.lead_ref JOIN calendly_invitees i ON i.invitee_uri=a.invitee_uri
    WHERE a.stopped_at IS NULL AND l.status='booked' AND i.status='booked' AND l.calendly_invitee_uri=a.invitee_uri
    ORDER BY a.starts_at LIMIT 100`).all();
  const statements=[];
  const enqueue=(row,kind,key,payload)=>statements.push(db.prepare(`INSERT OR IGNORE INTO integration_jobs
    (lead_ref,kind,dedupe_key,payload_json) SELECT ?1,?2,?3,?4
    WHERE ?5='' OR NOT EXISTS(SELECT 1 FROM integration_jobs WHERE kind='kit.appointment_email'
      AND status='completed' AND last_error IS NULL AND json_extract(payload_json,'$.journey_key')=?5)`)
    .bind(row.lead_ref,kind,`appointment:${row.invitee_uri}:${key}`,JSON.stringify({email:row.email,kit_subscriber_id:row.kit_subscriber_id,lead_ref:row.lead_ref,appointment_invitee:row.invitee_uri,appointment_timer:true,delivery_key:`${row.invitee_uri}:${key}`,...payload}),payload.journey_key||''));
  for(const row of results) {
    if(utcTime(row.starts_at)<=now+30*60000) {
      enqueue(row,'kit.appointment_stop','stop',{appointment_stop:true});continue;
    }
    if(row.phone)enqueue(row,'roezan.sms','confirmation',{phone:row.phone,first_name:row.first_name,
      appointment_timezone:row.timezone,appointment_deadline:new Date(Math.min(utcTime(row.starts_at)-30*60000,utcTime(row.booked_at)+24*HOUR)).toISOString(),
      message:`Hi ${row.first_name||'there'}, it's Bilal from Three Stripes Digital. Your ${row.offer==='website'?'website consultation':'Rank Boost call'} is booked. Check your Calendly invitation for the time and joining details. Reply YES to confirm. Reply STOP to opt out.`});
    for(const slot of appointmentSlots(row,now)) {
      const sequence=APPOINTMENT_EMAILS[row.offer]?.[slot.key]?.id;
      if(!sequence)throw Error('appointment_sequence_not_configured');
      enqueue(row,'kit.appointment_email','email-'+slot.index,{sequence_id:sequence,
        ...(!slot.index.startsWith('R')?{journey_key:`${row.lead_ref}:${row.journey_started_at}:${slot.index}`} : {}),
        appointment_deadline:new Date(slot.due+15*60000).toISOString()});
      if(slot.key==='R01'||slot.key==='R02')enqueue(row,'roezan.sms','sms-'+slot.key,{phone:row.phone,first_name:row.first_name,appointment_timezone:row.timezone,appointment_deadline:new Date(slot.due+15*60000).toISOString(),message:`Hi ${row.first_name||'there'}, Bilal from Three Stripes Digital here. Your ${row.offer==='website'?'website consultation':'Rank Boost call'} is ${slot.key==='R01'?'tomorrow':'in 2 hours'}. Your Calendly invitation has the joining details. Reply STOP to opt out.`});
    }
  }
  if(!statements.length)return {queued:0};
  const writes=await db.batch(statements);
  return {queued:writes.reduce((n,r)=>n+Number(r.meta?.changes||0),0)};
}
