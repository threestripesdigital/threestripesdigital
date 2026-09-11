import {dayIn,setState,shiftDay} from './meta.js';
export function formAttribution(row){try{const p=new URL(row.page_url).searchParams;if(p.get('rb_internal')==='1'||p.get('utm_source')?.toLowerCase()!=='meta')return null;const campaign_id=p.get('campaign_id')||'',ad_id=p.get('ad_id')||'',adset_id=p.get('adset_id')||'';return {campaign_id,ad_id,adset_id,attributed:[campaign_id,ad_id,adset_id].every(x=>/^\d+$/.test(x))};}catch{return null;}}
export async function syncFormFills(env){if(!env.LEADS_DB)return;try{
 const since=shiftDay(dayIn(Date.now(),env.REPORTING_TIMEZONE),-90);
 const excluded=(env.INTERNAL_TEST_LEAD_IDS||'').split(',').filter(x=>/^\d+$/.test(x));
 const {results}=await env.LEADS_DB.prepare(`SELECT id,created_at,qualified,page_url FROM leads WHERE created_at>=? ${excluded.length?'AND id NOT IN ('+excluded.map(()=>'?').join(',')+')':''} ORDER BY id LIMIT 10000`).bind(since,...excluded).all();
 if(results.length===10000)throw Error('Form reporting pagination required');
 const groups={};
 for(const row of results){const a=formAttribution(row);if(!a)continue;const created=/[zZ]|[+-]\d\d:\d\d$/.test(row.created_at)?row.created_at:row.created_at.replace(' ','T')+'Z';if(!Number.isFinite(Date.parse(env.LAUNCH_AT))||Date.parse(created)<Date.parse(env.LAUNCH_AT))continue;const day=dayIn(created,env.REPORTING_TIMEZONE),key=[day,a.campaign_id,a.adset_id,a.ad_id].join(':');const g=groups[key]||{day,...a,forms:0,qualified:0};g.forms++;g.qualified+=row.qualified===1?1:0;groups[key]=g;}
 await setState(env,'form_fill_daily',JSON.stringify(Object.values(groups)));await setState(env,'form_fill_success',new Date().toISOString());await setState(env,'form_fill_error','');
 }catch{await setState(env,'form_fill_error','Completed form attribution could not be imported. Counts are unavailable.');}}
