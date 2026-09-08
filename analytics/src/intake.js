import { dayIn } from './meta.js';
export const eventKinds=new Set(['page_view','vsl_play','vsl_25','vsl_50','vsl_75','application_start','scheduler_open']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
export async function intake(body,env,leadRef=null) {
 if(!uuid(body.session_id)) throw Error('Invalid session');
 const now=new Date().toISOString();
 if(body.kind==='session') {
  if(!/^\d{1,30}$/.test(body.campaign_id||'')||!/^\d{1,30}$/.test(body.ad_id||'')) return {accepted:false,reason:'No paid-ad attribution'};
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO sessions(id,started_at,day,campaign_id,ad_id) VALUES(?,?,?,?,?)').bind(body.session_id,now,dayIn(now,env.REPORTING_TIMEZONE),body.campaign_id,body.ad_id),
   env.DB.prepare("INSERT OR IGNORE INTO events VALUES(?,'page_view',?)").bind(body.session_id,now)
  ]);
 } else {
  const session=await env.DB.prepare('SELECT id FROM sessions WHERE id=?').bind(body.session_id).first();
  if(!session) throw Error('Start a session first');
  if(body.kind==='link') {
   if(!leadRef) throw Error('Verified lead token required');
   await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO events VALUES(?,'application_start',?)").bind(body.session_id,now),
    env.DB.prepare('UPDATE sessions SET lead_ref=? WHERE id=? AND (lead_ref IS NULL OR lead_ref=?)').bind(leadRef,body.session_id,leadRef),
    env.DB.prepare("INSERT OR IGNORE INTO events SELECT id,'application_complete',? FROM sessions WHERE id=? AND lead_ref=?").bind(now,body.session_id,leadRef)
   ]);
  } else {
   if(!eventKinds.has(body.kind)) throw Error('Unknown event');
   await env.DB.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?)').bind(body.session_id,body.kind,now).run();
  }
 }
 await env.DB.prepare("INSERT INTO state VALUES('event_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now).run();
 return {accepted:true};
}
