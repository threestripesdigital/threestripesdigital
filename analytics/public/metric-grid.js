const ratio=(a,b,m=1)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b*m:null;
export function gridMetrics(data) {
 const provider=(key,label,value,format,source,note,stale=false)=>({key,label,value:value??null,format,source,note,stale,status:'unrated',good:null,bad:null,midpoint:null,sample:null,recommendation:note});
 const w=data.sources?.wistia,g=data.sources?.ga4,v=w?.window?.metaValues||{},ga=g?.window?.values||{};
 const videoNote='Wistia · Meta source only · '+(w?.window?`${w.window.metaStart||w.window.start} to ${w.window.end}`:'Awaiting import');
 const wc=(key,label,value,format='number')=>provider(key,label,value,format,'Wistia',videoNote,!!w?.stale);
 const playRule=data.metrics.find(m=>m.key==='play');
 const play={...wc('play','VSL play rate',v.play_rate,'percent'),...playRule,value:v.play_rate??null,source:'Wistia',note:videoNote,stale:!!w?.stale,provisional:false,sample:v.loads??null};
 play.status=!Number.isFinite(play.value)?'waiting':play.good==null||play.bad==null?'unrated':play.value>=play.good?'good':play.value<play.bad?'bad':'ok';
 play.recommendation=videoNote+'. Plays relative to player loads. Only visits tagged utm_source=meta are included. Unknown and other sources are excluded.'+(play.status==='bad'?' '+(data.hold?.locked?'Observe only during the learning hold. ':'')+(play.action||''):'');
 const engagement=wc('wistia_engagement','VSL average engagement',v.engagement_rate,'percent');
 engagement.recommendation=videoNote+'. Average portion watched. This is different from the percentage of viewers who watch at least half the video.';
 const spend=data.totals?.spend,forms=data.formFillReporting?.ready?data.formFillReporting.total:null;
 const performance=[...data.metrics.slice(0,3),{...data.metrics.find(m=>m.key==='scheduled_cost'),label:'Cost / Booked Call',source:'Calendly',note:'USD · Rank Boost bookings · source=meta',recommendation:'USD ad spend divided by non-cancelled Rank Boost Calendly bookings with source=meta in this period.'},provider('meta_lpv','Landing page views',data.metaWebsite?.landingPageViews,'number','Meta','Meta-attributed website actions',data.stale),provider('meta_leads','Website leads',data.metaWebsite?.websiteLeads,'number','Meta','Meta-attributed leads, not booked calls',data.stale)];
 performance.push(provider('cost_lpv','Cost / landing page view',ratio(spend,data.metaWebsite?.landingPageViews),'money','Meta','Meta spend / Meta landing page views',data.stale),provider('cost_vsl','Cost / VSL play',ratio(spend,v.plays),'money','Meta + Wistia','Meta spend / Meta-tagged Wistia plays',!!w?.stale),provider('form_fills','Completed forms',forms,'number','Funnel database','Meta-source scans, including qualified and unqualified'),provider('cost_form','Cost / completed form',ratio(spend,forms),'money','Meta + Funnel database','Meta spend / completed Meta-source scans'));
 performance.push(provider('lpv_booking_rate','Landing views to booked calls',ratio(data.metaBookings?.ready?data.metaBookings.count:null,data.metaWebsite?.landingPageViews,100),'percent','Meta + Calendly','Period ratio of verified Meta-source bookings / Meta landing page views. Not a matched visitor cohort.',data.stale),provider('scan_qualified_rate','Keyword-qualified scan rate',ratio(data.formFillReporting?.qualified,forms,100),'percent','Funnel database','Keyword-qualified scans / completed Meta-source scans. Not sales-qualified calls.'));
 const funnel=[wc('wistia_plays','VSL plays',v.plays),wc('wistia_loads','VSL player loads',v.loads),play,engagement,...['screenPageViews','sessions','activeUsers'].map((key,i)=>provider('ga4_'+key,['Funnel page views','Funnel sessions','Funnel active users'][i],ga[key],'number','GA4','GA4 · Funnel only · All traffic',!!g?.stale)).filter(m=>Number.isFinite(m.value)),...data.metrics.slice(3).filter(m=>!['play','scheduled_cost',...(data.sources?.browserTracking===false?['conversion']:[])].includes(m.key))];
 const ph=data.sources?.posthog,t=ph?.totals;
 if(ph?.connected&&t){
  const note='PostHog · Meta source · Since Sep 12, 2026'+(ph.stale?' · Stale':'');
  for(const [key,a,b] of [['retention','vsl_50','vsl_play'],['application','application_complete','application_start']]){
   const i=funnel.findIndex(m=>m.key===key);if(i>=0){const m=funnel[i];const value=ratio(t[a],t[b],100);funnel[i]={...m,value,sample:t[b],source:'PostHog',note,stale:ph.stale,status:value===null?'waiting':m.good==null?'unrated':value>=m.good?'good':value<m.bad?'bad':'ok',recommendation:note+'. '+(key==='retention'?'Sessions that watched half the VSL / sessions that played.':'Completed scans / sessions that started the form. Browser-observed, not a backend submission audit.')};}
  }
  funnel.push(provider('posthog_sessions','Recorded Meta sessions',t.session,'number','PostHog',note,ph.stale));
 }
 for(const m of [...performance,...funnel])if(m.value===null||m.value===undefined){
  if(['scheduled_cost','qualified_rate','qualified_cost','showed_cost','show','close','boost','boost_paid','cac','payback'].includes(m.key))m.emptyLabel=data.metaBookings?.count===0?'No bookings yet':'Needs call outcomes';
  else if(m.key==='roas')m.emptyLabel='Needs revenue records';
  else if(m.key==='retention')m.emptyLabel='Waiting for plays';
  else if(m.key==='application')m.emptyLabel='Waiting for form starts';
 }
 return {performance,funnel};
}
