export function gridMetrics(data) {
 const provider=(key,label,value,format,source,note,stale=false)=>({key,label,value:value??null,format,source,note,stale,status:'unrated',good:null,bad:null,midpoint:null,sample:null,recommendation:note});
 const w=data.sources?.wistia,g=data.sources?.ga4,v=w?.window?.values||{},ga=g?.window?.values||{};
 const videoNote='Wistia · All traffic · '+(w?.window?`${w.window.start} to ${w.window.end}`:'Awaiting import');
 const wc=(key,label,value,format='number')=>provider(key,label,value,format,'Wistia',videoNote,!!w?.stale);
 const playRule=data.metrics.find(m=>m.key==='play');
 const play={...wc('play','VSL play rate',v.play_rate,'percent'),...playRule,value:v.play_rate??null,source:'Wistia',note:videoNote,stale:!!w?.stale,provisional:false,sample:v.unique_loads??null};
 play.status=!Number.isFinite(play.value)?'waiting':play.good==null||play.bad==null?'unrated':play.value>=play.good?'good':play.value<play.bad?'bad':'ok';
 play.recommendation=videoNote+'. Plays relative to player loads. Includes prelaunch views and all embed locations; compared with your strategy target, not a paid-only result.'+(play.status==='bad'?' '+(data.hold?.locked?'Observe only during the learning hold. ':'')+(play.action||''):'');
 const engagement=wc('wistia_engagement','VSL average engagement',v.engagement_rate,'percent');
 engagement.recommendation=videoNote+'. Average portion watched. This is different from the percentage of viewers who watch at least half the video.';
 const performance=[...data.metrics.slice(0,3),provider('meta_lpv','Landing page views',data.metaWebsite?.landingPageViews,'number','Meta','Meta-attributed website actions',data.stale),provider('meta_leads','Website leads',data.metaWebsite?.websiteLeads,'number','Meta','Meta-attributed leads, not booked calls',data.stale)];
 const funnel=[wc('wistia_plays','VSL plays',v.plays),wc('wistia_unique_plays','VSL unique plays',v.unique_plays),wc('wistia_loads','VSL player loads',v.unique_loads),play,engagement,wc('wistia_seconds','VSL time watched (seconds)',v.played_time),...['screenPageViews','sessions','activeUsers'].map((key,i)=>provider('ga4_'+key,['Funnel page views','Funnel sessions','Funnel active users'][i],ga[key],'number','GA4','GA4 · Funnel only · All traffic',!!g?.stale)),...data.metrics.slice(3).filter(m=>m.key!=='play')];
 return {performance,funnel};
}
