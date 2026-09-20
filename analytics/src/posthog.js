import {setState,dayIn,shiftDay,ids} from './meta.js';
import {campaignInfo} from './campaigns.js';
const eventNames=['session','vsl_load','vsl_play','vsl_25','vsl_50','vsl_75','application_start','application_complete','scheduler_open','booking_browser_confirmation'];
const captureStart='2026-09-12T04:00:00.000Z';
const snapshotVersion=2;
const validInstant=value=>{
 const match=typeof value==='string'&&value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
 if(!match||!Number.isFinite(Date.parse(value)))return null;
 // Normalize offsets without losing the stored microsecond precision.
 return new Date(value).toISOString().slice(0,19)+(match[1]||'')+'Z';
};
const sqlInstant=value=>`toDateTime64('${value.replace('T',' ').replace('Z','')}', 6, 'UTC')`;
export function posthogLaunches(env,state){
 return Object.fromEntries(ids({...env,META_CAMPAIGN_IDS:env.META_CAMPAIGN_IDS||state.meta_campaign_ids}).sort().map(id=>[id,validInstant(campaignInfo(id)?.version==='v1'?(env.LAUNCH_AT||state['campaign_launch:'+id]||state.launch_at):state['campaign_launch:'+id])]));
}
export function posthogQuery(env,launches,start,through){
 const timezone=env.REPORTING_TIMEZONE||'America/New_York';
 if(!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(timezone))throw Error('PostHog reporting timezone is invalid.');
 new Intl.DateTimeFormat('en-US',{timeZone:timezone});
 const launched=Object.entries(launches).filter(([,at])=>at);
 if(!launched.length)return null;
 // Deduplicate and anchor attribution inside PostHog. Only daily aggregates leave the project.
 return `SELECT toDate(toTimeZone(first_session, '${timezone}')) AS day, campaign_id, adset_id, ad_id, count() AS session, ${eventNames.slice(1).map(e=>`sum(${e}) AS ${e}`).join(', ')}
 FROM (SELECT properties.$session_id AS sid, minIf(timestamp, event = 'rb_session') AS first_session,
 argMinIf(toString(properties.campaign_id), timestamp, event = 'rb_session') AS campaign_id,
 argMinIf(toString(properties.adset_id), timestamp, event = 'rb_session') AS adset_id,
 argMinIf(toString(properties.ad_id), timestamp, event = 'rb_session') AS ad_id,
 max(coalesce(toString(properties.internal), 'false') IN ('true', '1') OR lower(coalesce(toString(properties.utm_campaign), '')) IN ('qa', 'posthog_verification') OR startsWith(lower(coalesce(toString(properties.utm_campaign), '')), 'qa_')) AS is_test,
 ${eventNames.slice(1).map(e=>`max(event = 'rb_${e}') AS ${e}`).join(', ')}
 FROM events WHERE timestamp >= toDateTime('${start} 00:00:00', '${timezone}') AND timestamp >= ${sqlInstant(captureStart)} AND timestamp < ${sqlInstant(through)}
 AND properties.funnel = 'rank_boost' AND properties.utm_source = 'meta'
 AND properties.$session_id IS NOT NULL AND toString(properties.$session_id) != ''
 AND toString(properties.campaign_id) IN (${Object.keys(launches).map(id=>`'${id}'`).join(', ')})
 GROUP BY sid HAVING countIf(event = 'rb_session') > 0)
 WHERE is_test = 0 AND (${launched.map(([id,at])=>`(campaign_id = '${id}' AND first_session >= ${sqlInstant(at)})`).join(' OR ')})
 GROUP BY day, campaign_id, adset_id, ad_id LIMIT 10000`;
}
export async function syncPostHog(env){
 if(!env.POSTHOG_PERSONAL_API_KEY||!/^\d+$/.test(env.POSTHOG_PROJECT_ID||''))return;
 try{
  const state=Object.fromEntries((await env.DB.prepare('SELECT * FROM state').all()).results.map(r=>[r.key,r.value]));
  const through=new Date().toISOString(),start=shiftDay(dayIn(through,env.REPORTING_TIMEZONE),-90),launches=posthogLaunches(env,state);
  const query=posthogQuery(env,launches,start,through);
  let result=[];
  if(query){
   const r=await fetch(`https://us.posthog.com/api/projects/${env.POSTHOG_PROJECT_ID}/query/`,{method:'POST',headers:{Authorization:'Bearer '+env.POSTHOG_PERSONAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:{kind:'HogQLQuery',query}}),signal:AbortSignal.timeout(25000)});
   if(!r.ok)throw Error(`PostHog reporting failed (${r.status}).`);
   const d=await r.json();if(!Array.isArray(d.results)||d.results.length>=10000)throw Error('PostHog report incomplete.');
   result=d.results;
  }
  const rows=result.map(row=>{
   if(row.length!==eventNames.length+4||!/^\d{4}-\d{2}-\d{2}$/.test(row[0])||!launches[row[1]]||row.slice(4).some(v=>!Number.isInteger(v)||v<0)||row.slice(5).some(v=>v>row[4]))throw Error('PostHog returned invalid counts.');
   return Object.fromEntries(['day','campaign_id','adset_id','ad_id',...eventNames].map((k,i)=>[k,row[i]]));
  });
  await setState(env,'posthog_cohort',JSON.stringify({version:snapshotVersion,projectId:env.POSTHOG_PROJECT_ID,timezone:env.REPORTING_TIMEZONE,start,through,launches,rows}));
  await setState(env,'posthog_success',new Date().toISOString());await setState(env,'posthog_error','');
 }catch(e){await setState(env,'posthog_error',e.message?.startsWith('PostHog')?e.message:'PostHog import failed.');}
}
export function posthogReport(env,state,start,end,campaigns){
 let snapshot=null;try{snapshot=JSON.parse(state.posthog_cohort||'null');}catch{}
 const expected=posthogLaunches(env,state),lastSync=state.posthog_success||null;
 const compatible=snapshot?.version===snapshotVersion&&snapshot.projectId===env.POSTHOG_PROJECT_ID&&snapshot.timezone===env.REPORTING_TIMEZONE&&Array.isArray(snapshot.rows)&&campaigns.every(id=>Object.hasOwn(expected,id)&&snapshot.launches?.[id]===expected[id]);
 const connected=!!env.POSTHOG_PROJECT_ID&&!!lastSync&&!state.posthog_error;
 const stale=!lastSync||!Number.isFinite(Date.parse(lastSync))||Date.now()-Date.parse(lastSync)>7200000;
 const launched=campaigns.filter(id=>expected[id]);
 const usable=connected&&!stale&&compatible&&launched.length===campaigns.length&&campaigns.length>0;
 const rows=usable?snapshot.rows.filter(r=>r.day>=start&&r.day<=end&&campaigns.includes(r.campaign_id)):[];
 const totals=usable?Object.fromEntries(eventNames.map(k=>[k,rows.reduce((n,r)=>n+r[k],0)])):null;
 const coverageStart=compatible?[snapshot.start,dayIn(captureStart,env.REPORTING_TIMEZONE)].sort().at(-1):null;
 const partial=!!coverageStart&&campaigns.some(id=>expected[id]&&[start,dayIn(expected[id],env.REPORTING_TIMEZONE)].sort().at(-1)<coverageStart);
 const syncLabel=lastSync&&Number.isFinite(Date.parse(lastSync))?new Intl.DateTimeFormat('en-US',{timeZone:env.REPORTING_TIMEZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(lastSync)):'awaiting sync';
 const note=`PostHog · Meta sessions · ${start} to ${end} · Postlaunch · Tests excluded · Synced ${syncLabel}${stale?' · Stale':''}${partial?' · Partial history':''}`;
 const reason=state.posthog_error||(stale?'PostHog data needs a refresh.':!compatible?'Waiting for the campaign cohort import.':launched.length!==campaigns.length?'Waiting for the selected campaign launch.':null);
 const message=usable?'Unique Meta sessions after each campaign launch. Internal and QA sessions excluded. '+(partial?'History before '+coverageStart+' is unavailable. ':'')+'Player loads mean the player element was present, not that it was ready or visible.':reason||'Awaiting the first PostHog reporting import.';
 return {connected,stale,usable,lastSync,error:state.posthog_error||null,projectId:env.POSTHOG_PROJECT_ID||null,rows,totals,note,message,cohort:{start,end,timezone:env.REPORTING_TIMEZONE,launches:Object.fromEntries(campaigns.map(id=>[id,expected[id]||null])),captureStart,coverageStart,dataThrough:compatible?snapshot.through:null,partial,testsExcluded:true,deduplication:'session',attribution:'first session event'}};
}
export function posthogVideoRows(groups,key,ph){
 return groups.map(group=>{
  const usable=!!ph?.usable,matches=usable?ph.rows.filter(row=>row[key]===group.id):[];
  const loads=usable?matches.reduce((n,r)=>n+r.vsl_load,0):null,plays=usable?matches.reduce((n,r)=>n+r.vsl_play,0):null;
  return {...group,vsl_loads:loads,vsl_plays:plays,vsl_play_rate:loads>0?plays/loads*100:null,cost_per_vsl_play:null,vsl_source:ph?.note||'PostHog cohort unavailable',vsl_stale:!!ph?.stale};
 });
}
