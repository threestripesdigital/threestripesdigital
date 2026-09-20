const ratio=(a,b,m=1)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b*m:null;
export function gridMetrics(data) {
 const provider=(key,label,value,format,source,note,stale=false)=>({key,label,value:value??null,format,source,note,stale,status:'unrated',good:null,bad:null,midpoint:null,sample:null,recommendation:note});
 const g=data.sources?.ga4,ga=g?.window?.values||{},ph=data.sources?.posthog;
 const phUsable=ph?.usable===true&&ph?.connected===true&&ph?.stale===false&&ph.totals&&typeof ph.totals==='object';
 const phNote=(typeof ph?.note==='string'&&ph.note.trim())||(typeof ph?.message==='string'&&ph.message.trim())||'PostHog cohort is unavailable.';
 const phCount=key=>{const value=phUsable?ph.totals[key]:null;return Number.isFinite(value)&&value>=0?value:null;};
 const loads=phCount('vsl_load'),plays=phCount('vsl_play'),sessions=phCount('session');
 const rated=(key,value,sample,recommendation)=>{const rule=data.metrics.find(m=>m.key===key)||{};const metric={...provider(key,rule.label||key,value,rule.format||'percent','PostHog',phNote,!!ph?.stale),...rule,value:value??null,source:'PostHog',note:phNote,stale:!!ph?.stale,provisional:false,sample:sample??null};metric.status=!Number.isFinite(metric.value)?'waiting':metric.good==null||metric.bad==null?'unrated':metric.value>=metric.good?'good':metric.value<metric.bad?'bad':'ok';metric.recommendation=phNote+'. '+recommendation+(metric.status==='bad'?' '+(data.hold?.locked?'Observe only during the learning hold. ':'')+(metric.action||''):'');return metric;};
 const play=rated('play',ratio(plays,loads,100),loads,'Unique VSL play sessions / unique player load sessions. A player load means the video player DOM was present, not that it was ready or visible.');
 const retention=rated('retention',ratio(phCount('vsl_50'),plays,100),plays,'Sessions that watched half the VSL / sessions that played.');
 const application=rated('application',ratio(phCount('application_complete'),phCount('application_start'),100),phCount('application_start'),'Completed scans / sessions that started the form. Browser-observed, not a backend submission audit.');
 const playerLoads=provider('vsl_player_loads','VSL player loads',loads,'number','PostHog',phNote,!!ph?.stale);
 playerLoads.recommendation=phNote+'. Unique player load sessions mean the video player DOM was present, not that it was ready or visible.';
 const spend=data.totals?.spend,forms=data.formFillReporting?.ready?data.formFillReporting.total:null;
 const performance=[...data.metrics.slice(0,3),{...data.metrics.find(m=>m.key==='scheduled_cost'),label:'Cost / Booked Call',source:'Calendly',note:'USD · Rank Boost bookings · source=meta',recommendation:'USD ad spend divided by non-cancelled Rank Boost Calendly bookings with source=meta in this period.'},provider('meta_lpv','Landing page views',data.metaWebsite?.landingPageViews,'number','Meta','Meta-attributed website actions',data.stale),provider('meta_leads','Website leads',data.metaWebsite?.websiteLeads,'number','Meta','Meta-attributed leads, not booked calls',data.stale)];
 performance.unshift(provider('form_opens','Form opens',data.formOpenReporting?.count,'number','Meta','SubmitApplication fires on opening the form',data.stale),provider('cost_form_open','Cost / form open',ratio(spend,data.formOpenReporting?.count),'money','Meta','Meta spend / attributed form opens',data.stale));
 performance.push(provider('cost_lpv','Cost / landing page view',ratio(spend,data.metaWebsite?.landingPageViews),'money','Meta','Meta spend / Meta landing page views',data.stale),provider('cost_vsl','Cost / VSL play',null,'money','Meta + PostHog','Not calculated from partial browser capture',!!ph?.stale),provider('form_fills','Completed forms',forms,'number','Funnel database','Meta-source scans, including qualified and unqualified'),provider('cost_form','Cost / completed form',ratio(spend,forms),'money','Meta + Funnel database','Meta spend / completed Meta-source scans'));
 performance.push(provider('lpv_booking_rate','Landing views to booked calls',ratio(data.metaBookings?.ready?data.metaBookings.count:null,data.metaWebsite?.landingPageViews,100),'percent','Meta + Calendly','Period ratio of verified Meta-source bookings / Meta landing page views. Not a matched visitor cohort.',data.stale),provider('scan_qualified_rate','Keyword-qualified scan rate',ratio(data.formFillReporting?.qualified,forms,100),'percent','Funnel database','Keyword-qualified scans / completed Meta-source scans. Booking a Rank Boost meeting after passing the form qualifies the call.'));
 const funnel=[provider('vsl_plays','VSL plays',plays,'number','PostHog',phNote,!!ph?.stale),playerLoads,play,retention,application,provider('posthog_sessions','Recorded Meta sessions',sessions,'number','PostHog',phNote,!!ph?.stale),...['screenPageViews','sessions','activeUsers'].map((key,i)=>provider('ga4_'+key,['Funnel page views','Funnel sessions','Funnel active users'][i],ga[key],'number','GA4','GA4 · Funnel only · All traffic',!!g?.stale)).filter(m=>Number.isFinite(m.value)),...data.metrics.slice(3).filter(m=>!['play','retention','application','scheduled_cost',...(data.sources?.browserTracking===false?['conversion']:[])].includes(m.key))];
 for(const m of funnel){if(['qualified_rate','show','close','boost','boost_paid'].includes(m.key)){m.source='Calendly';m.note=data.bookingReporting?.scope||'All sources';}if(['qualified_cost','showed_cost','cac','payback'].includes(m.key)){m.source='Meta + Calendly';m.note='Verified Meta attribution only';}}
 for(const m of [...performance,...funnel])if(m.value===null||m.value===undefined){
  if(['scheduled_cost','qualified_rate','qualified_cost','showed_cost','show','close','boost','boost_paid','cac','payback'].includes(m.key))m.emptyLabel=['scheduled_cost','qualified_cost'].includes(m.key)&&data.metaBookings?.count===0?'No attributed bookings':data.bookingReporting?.total===0?'No bookings yet':'Needs call outcomes';
  else if(m.key==='roas')m.emptyLabel='Needs revenue records';
  else if(['play','retention'].includes(m.key))m.emptyLabel=phUsable?'Waiting for plays':'PostHog cohort unavailable';
  else if(m.key==='application')m.emptyLabel=phUsable?'Waiting for form starts':'PostHog cohort unavailable';
 }
 return {performance,funnel};
}

// Compare like-for-like measurements only. V1 did not optimize for form opens.
export function baselineMetric(data,key){
 const b=data.comparison;if(!b)return null;
 const t=b.totals||{},f=b.forms||{},w=b.metaWebsite||{},n=b.bookings?.ready?b.bookings.count:null;
 const values={spend:t.spend,cpm:ratio(t.spend,t.impressions,1000),ctr:ratio(t.link_clicks,t.impressions,100),cpc:ratio(t.spend,t.link_clicks),meta_lpv:w.landingPageViews,meta_leads:w.websiteLeads,cost_lpv:ratio(t.spend,w.landingPageViews),form_fills:f.ready?f.total:null,cost_form:ratio(t.spend,f.ready?f.total:null),scheduled_cost:ratio(t.spend,n),lpv_booking_rate:ratio(n,w.landingPageViews,100),scan_qualified_rate:ratio(f.qualified,f.ready?f.total:null),booked:n};
 const notes={form_opens:'Different optimization event',cost_form_open:'Different optimization event',cost_vsl:'No campaign-matched v1 baseline'};
 if(!(key in values)&&!(key in notes))return null;
 return {value:values[key]??null,note:notes[key]||((key==='booked'||key==='scheduled_cost'||key==='lpv_booking_rate')&&b.unknownCampaignBookings?`${b.unknownCampaignBookings} booking lacks a campaign ID`:null),stale:b.stale,period:b.period,deltaAllowed:['cpm','ctr','cpc','cost_lpv','cost_form','scheduled_cost','lpv_booking_rate','scan_qualified_rate'].includes(key)};
}
