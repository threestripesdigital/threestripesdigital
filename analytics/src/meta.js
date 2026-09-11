export const dayIn = (date, tz) => new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
export const shiftDay = (day, n) => new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const ids = env => (env.META_CAMPAIGN_IDS||'').split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x));
export function websiteActions(actions=[]) {
 const value=type=>{const n=Number(actions.find(a=>a.action_type===type)?.value||0);if(!Number.isFinite(n)||n<0)throw Error('Invalid Meta website action count');return n;};
 return {landingPageViews:value('landing_page_view'),websiteLeads:value('offsite_conversion.fb_pixel_lead')};
}
export function reportingSpendFactor(env, accountCurrency) {
 if(accountCurrency===env.CURRENCY)return 1;
 const rate=Number(env.META_USD_TO_ACCOUNT_RATE);
 if(env.CURRENCY!=='USD'||accountCurrency!==env.META_ACCOUNT_CURRENCY||!Number.isFinite(rate)||rate<=0||!/^\d{4}-\d{2}-\d{2}$/.test(env.META_FX_DATE||''))throw Error('Configure a dated exchange rate before importing a different account currency.');
 return 1/rate;
}
export async function setState(env,key,value) {await env.DB.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,String(value)).run();}
export async function graph(env,path,params={}) {
 if(!/^v\d+\.0$/.test(env.META_API_VERSION||'')) throw Error('Set a supported Meta API version');
 const url=new URL(`https://graph.facebook.com/${env.META_API_VERSION}/${path}`);
 for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
 const response=await fetch(url,{headers:{Authorization:`Bearer ${env.META_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
 const body=await response.json();
 if(!response.ok||body.error) throw Error(`Meta request failed (${response.status}, code ${Number(body.error?.code)||0}). Check ads_read permission and token expiry.`);
 return body;
}
export async function syncMeta(env) {
 if(!env.META_ACCESS_TOKEN||!env.META_ACCOUNT_ID) {await setState(env,'meta_error','Connect a Meta reporting token with ads_read access to the Three Stripes ad account.');return;}
 const owner=crypto.randomUUID(), now=Date.now();
 const lease=await env.DB.prepare("INSERT INTO locks VALUES('meta',?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires < ?").bind(owner,now+900000,now).run();
 if(!lease.meta.changes) return;
 try {
 const account=env.META_ACCOUNT_ID.replace(/^act_/,'');
 if(!/^\d+$/.test(account)) throw Error('Invalid Meta account ID');
 const info=await graph(env,'act_'+account,{fields:'name,currency,timezone_name'});
 if(info.timezone_name!==env.REPORTING_TIMEZONE) throw Error('Reporting timezone does not match the Meta account.');
 const spendFactor=reportingSpendFactor(env,info.currency);
 let selected=ids(env);
 if(!selected.length) {
  const prefix=(env.META_CAMPAIGN_PREFIX||'Rank Boost').trim().toLowerCase();
  let cursor='';
  for(let page=0;page<10;page++) {
   const list=await graph(env,'act_'+account+'/campaigns',{fields:'id,name',limit:100,...(cursor?{after:cursor}:{})});
   selected.push(...(list.data||[]).filter(c=>String(c.name).toLowerCase().startsWith(prefix)).map(c=>c.id));
   if(!list.paging?.next)break;
   cursor=list.paging?.cursors?.after;
   if(!cursor||page===9)throw Error('Campaign discovery incomplete. Configure exact campaign IDs.');
  }
  // Preserve previously discovered campaigns if a campaign is renamed later.
  const previous=await env.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first();
  selected=[...new Set([...selected,...ids({META_CAMPAIGN_IDS:previous?.value})])];
 }
 if(!selected.length) {
  await setState(env,'meta_success',new Date().toISOString());await setState(env,'meta_error','');
  await setState(env,'meta_account_name',info.name);return;
 }
 const until=dayIn(now,env.REPORTING_TIMEZONE), since=shiftDay(until,-89);
 const params={fields:'date_start,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions',level:'ad',time_increment:1,time_range:JSON.stringify({since,until}),filtering:JSON.stringify([{field:'campaign.id',operator:'IN',value:selected}]),limit:500};
 const rows=[];let after='';
 for(let page=0;page<20;page++) {
  const b=await graph(env,'act_'+account+'/insights',{...params,...(after?{after}:{})});
  for(const r of b.data||[]) {
   if(!selected.includes(r.campaign_id)) throw Error('Unexpected campaign in Meta response');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date_start)||!r.ad_id) throw Error('Malformed Meta daily row');
   for(const k of ['spend','impressions','inline_link_clicks']) if(!Number.isFinite(Number(r[k]||0))||Number(r[k]||0)<0) throw Error('Invalid Meta metric');
   rows.push(r);
  }
  if(!b.paging?.next) break;
  after=b.paging?.cursors?.after;
  if(!after||page===19) throw Error('Meta pagination limit reached. Narrow campaign scope.');
 }
 if(rows.length>5000) throw Error('Reporting scope exceeds 5,000 daily ad rows. Narrow campaign scope.');
 // Replace the complete fetched range atomically, including rows removed by Meta corrections.
 const statements=[env.DB.prepare('DELETE FROM meta_daily WHERE day BETWEEN ? AND ?').bind(since,until)];
 for(const r of rows) statements.push(env.DB.prepare('INSERT INTO meta_daily VALUES(?,?,?,?,?,?,?,?,?)').bind(r.date_start,r.ad_id,r.ad_name||r.ad_id,r.adset_id,r.campaign_id,r.campaign_name||r.campaign_id,Number(r.spend||0)*spendFactor,Number(r.impressions||0),Number(r.inline_link_clicks||0)));
 const actionDays=Object.values(rows.reduce((acc,r)=>{const key=r.date_start+':'+r.campaign_id;const counts=websiteActions(r.actions);const row=acc[key]||{day:r.date_start,campaign_id:r.campaign_id,landingPageViews:0,websiteLeads:0};row.landingPageViews+=counts.landingPageViews;row.websiteLeads+=counts.websiteLeads;acc[key]=row;return acc;},{}));
 statements.push(env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('meta_website_actions',JSON.stringify(actionDays)));
 const adActions=rows.map(r=>({day:r.date_start,ad_id:r.ad_id,adset_id:r.adset_id,adset_name:r.adset_name||r.adset_id,campaign_id:r.campaign_id,...websiteActions(r.actions)}));
 statements.push(env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('meta_ad_actions',JSON.stringify(adActions)));
 const successfulAt=new Date().toISOString();
 for(const [k,v] of [['meta_success',successfulAt],['meta_error',''],['meta_account_name',info.name],['meta_campaign_ids',selected.join(',')]]) statements.push(env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,v));
 const first=rows.filter(r=>Number(r.spend)>0).map(r=>r.date_start).sort()[0];
 if(first) statements.push(env.DB.prepare("INSERT OR IGNORE INTO state VALUES('launch_at',?)").bind(first===until?successfulAt:shiftDay(first,1)+'T23:59:59Z'));
 await env.DB.batch(statements);
 } catch(e) {await setState(env,'meta_error',e.message);throw e;}
 finally {await env.DB.prepare("DELETE FROM locks WHERE key='meta' AND owner=?").bind(owner).run();}
}
