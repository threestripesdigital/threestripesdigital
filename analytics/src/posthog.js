import {setState,dayIn,shiftDay} from './meta.js';
const eventNames=['session','vsl_load','vsl_play','vsl_25','vsl_50','vsl_75','application_start','application_complete','scheduler_open','booking_browser_confirmation'];
export async function syncPostHog(env){
 if(!env.POSTHOG_PERSONAL_API_KEY||!/^\d+$/.test(env.POSTHOG_PROJECT_ID||''))return;
 try{
  const start=shiftDay(dayIn(Date.now(),env.REPORTING_TIMEZONE),-90);
  // Fixed query fields only. No visitor identity or recording payloads are copied into this dashboard.
  const query=`SELECT toDate(toTimeZone(timestamp, 'America/New_York')) AS day, properties.campaign_id AS campaign_id, properties.adset_id AS adset_id, properties.ad_id AS ad_id, ${eventNames.map(e=>`uniqExactIf(properties.$session_id, event = 'rb_${e}') AS ${e}`).join(', ')} FROM events WHERE timestamp >= toDateTime('${start} 00:00:00') AND properties.funnel = 'rank_boost' AND properties.utm_source = 'meta' AND properties.$session_id IS NOT NULL GROUP BY day, campaign_id, adset_id, ad_id LIMIT 10000`;
  const r=await fetch(`https://us.posthog.com/api/projects/${env.POSTHOG_PROJECT_ID}/query/`,{method:'POST',headers:{Authorization:'Bearer '+env.POSTHOG_PERSONAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:{kind:'HogQLQuery',query}}),signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error(`PostHog reporting failed (${r.status}).`);
  const d=await r.json();if(!Array.isArray(d.results)||d.results.length>=10000)throw Error('PostHog report incomplete.');
  const rows=d.results.map(row=>{
   if(row.length!==eventNames.length+4||row.slice(4).some(v=>!Number.isInteger(v)||v<0))throw Error('PostHog returned invalid counts.');
   return Object.fromEntries(['day','campaign_id','adset_id','ad_id',...eventNames].map((k,i)=>[k,row[i]]));
  });
  await setState(env,'posthog_daily',JSON.stringify(rows));await setState(env,'posthog_success',new Date().toISOString());await setState(env,'posthog_error','');
 }catch(e){await setState(env,'posthog_error',e.message?.startsWith('PostHog')?e.message:'PostHog import failed.');}
}
export function posthogReport(env,state,start,end,campaigns){
 let rows=[];try{rows=JSON.parse(state.posthog_daily||'[]');}catch{}
 rows=rows.filter(r=>r.day>=start&&r.day<=end&&campaigns.includes(r.campaign_id));
 const totals=Object.fromEntries(eventNames.map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]));
 const connected=!!env.POSTHOG_PROJECT_ID&&!!state.posthog_success&&!state.posthog_error;
 return {connected,stale:!state.posthog_success||Date.now()-Date.parse(state.posthog_success)>7200000,lastSync:state.posthog_success||null,error:state.posthog_error||null,projectId:env.POSTHOG_PROJECT_ID||null,rows,totals:connected?totals:null,message:connected?'PostHog session replay and Meta-source funnel events connected. Recording began September 12, 2026.':state.posthog_error||'Awaiting the first PostHog reporting import.'};
}
