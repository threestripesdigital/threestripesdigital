// Source copied into the Rank Boost funnel as analytics.js. No customer PII is collected.
(()=>{
 if(navigator.globalPrivacyControl===true||navigator.doNotTrack==='1')return;
 const endpoint=new URL('api/analytics',new URL('.',location.href)).href;
 const key='rb_analytics_session';let session;
 try {
  const params=new URLSearchParams(location.search),campaign=params.get('campaign_id'),ad=params.get('ad_id');
  if(params.get('rb_internal')==='1')localStorage.setItem('rb_analytics_exclude','1');
  if(params.get('rb_internal')==='0')localStorage.removeItem('rb_analytics_exclude');
  if(localStorage.getItem('rb_analytics_exclude')==='1'){sessionStorage.removeItem(key);return;}
  session=JSON.parse(sessionStorage.getItem(key)||'null');
  if(!session||Date.now()-session.created>30*60000||(campaign&&ad&&(campaign!==session.campaign_id||ad!==session.ad_id))) {
   if(!/^\d+$/.test(campaign||'')||!/^\d+$/.test(ad||''))return;
   session={session_id:crypto.randomUUID(),campaign_id:campaign,ad_id:ad,created:Date.now()};sessionStorage.setItem(key,JSON.stringify(session));
  }
 }catch{return;}
 let chain=Promise.resolve();const sent=new Set();
 function track(kind,extra={}) {
  if(sent.has(kind))return chain;
  sent.add(kind);
  chain=chain.catch(()=>{}).then(async()=>{
   for(let attempt=0;attempt<3;attempt++){
    try {const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...session,kind,...extra}),keepalive:true});if(r.ok)return;if(r.status<500&&r.status!==429)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
   }
   sent.delete(kind);
  });return chain;
 }
 window.rankBoostAnalytics={track,sessionId:session.session_id};track('session');
 const form=document.querySelector('#lead-form')||document.querySelector('form');
 if(form)form.addEventListener('input',()=>track('application_start'),{once:true});
 // The verified lead token is issued by the existing /api/check endpoint.
 function link(){try{const result=JSON.parse(sessionStorage.getItem('tsd_rb_result')||'null');const payload=JSON.parse(sessionStorage.getItem('tsd_rb_payload')||'null');const token=sessionStorage.getItem('tsd_rb_lead_token')||result?.data?.lead_token||payload?.lead_token;if(token&&!sent.has('link'))track('link',{lead_token:token});}catch{}}
 link();const timer=setInterval(link,3000);setTimeout(()=>clearInterval(timer),120000);
 document.addEventListener('click',e=>{if(e.target.closest('a[href*="calendly.com"]'))track('scheduler_open');});
 window.addEventListener('message',e=>{if(e.origin==='https://calendly.com'&&e.data?.event==='calendly.event_type_viewed')track('scheduler_open');});
 // Wistia percentWatched measures watched media, not the seek position.
 const attach=player=>{
  player.addEventListener('play',()=>track('vsl_play'));
  const milestones=pct=>{if(!Number.isFinite(pct)||pct<=0||pct>1)return;for(const n of [25,50,75])if(pct>=n/100){track('vsl_play');track('vsl_'+n);}};
  if(player.tagName==='WISTIA-PLAYER')player.addEventListener('percent-watched-change',()=>milestones(player.percentWatched));
  else player.addEventListener('timeupdate',()=>{
   // Native fallback uses the union of played ranges, so replay and seeking cannot inflate it.
   let watched=0;for(let i=0;i<player.played.length;i++)watched+=player.played.end(i)-player.played.start(i);
   milestones(player.duration>0?watched/player.duration:0);
  });
 };
 document.querySelectorAll('.hero-vsl video,.hero-vsl wistia-player').forEach(attach);
})();
