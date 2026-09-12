// Dedicated PostHog recording and measurement. The old Cloudflare tracker stays off.
(async()=>{
 if(navigator.globalPrivacyControl===true||navigator.doNotTrack==='1')return;
 const query=new URLSearchParams(location.search);
 if([...query.keys()].some(k=>/token|email|phone|name|lead_ref/i.test(k)))return;
 try{
  if(query.get('rb_internal')==='1')localStorage.setItem('rb_analytics_exclude','1');
  if(query.get('rb_internal')==='0')localStorage.removeItem('rb_analytics_exclude');
  if(localStorage.getItem('rb_analytics_exclude')==='1')return;
 }catch{return;}
 const properties={funnel:'rank_boost',tracking_version:1};
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','campaign_id','adset_id','ad_id']){
  const value=query.get(key);if(value&&value.length<=200)properties[key]=value;
 }
 const cleanUrl=value=>{try{const u=new URL(value);u.search='';u.hash='';return u.href;}catch{return '';}};
 const pending=[],sent=new Set();let ph;
 function track(event,extra={}){
  if(sent.has(event))return;sent.add(event);
  const item=['rb_'+event,{...properties,...extra}];if(ph)ph.capture(...item);else pending.push(item);
 }
 window.rankBoostReplay={track};
 const form=document.getElementById('qualify-form');
 form?.addEventListener('input',()=>track('application_start'),{once:true});
 document.querySelectorAll('.hero-vsl wistia-player').forEach(player=>{
  track('vsl_load');player.addEventListener('play',()=>track('vsl_play'));
  player.addEventListener('percent-watched-change',()=>{
   const pct=player.percentWatched;if(!Number.isFinite(pct)||pct<0||pct>1)return;
   for(const n of [25,50,75])if(pct>=n/100){track('vsl_play');track('vsl_'+n);}
  });
 });
 window.addEventListener('message',e=>{
  if(e.origin!=='https://calendly.com')return;
  if(e.data?.event==='calendly.event_type_viewed')track('scheduler_open');
  if(e.data?.event==='calendly.event_scheduled')track('booking_browser_confirmation');
 });
 try{
  const response=await fetch('api/replay-config');if(!response.ok)return;
  const config=await response.json();if(!config.enabled||!config.token)return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://us-assets.i.posthog.com/static/array.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
  window.posthog.init(config.token,{
   api_host:config.host,ui_host:'https://us.posthog.com',defaults:'2025-05-24',
   person_profiles:'never',capture_pageview:false,capture_pageleave:false,
   autocapture:{mask_all_text:true,mask_all_element_attributes:true},
   disable_session_recording:false,enable_recording_console_log:false,
   capture_performance:false,capture_exceptions:false,
   session_recording:{maskAllInputs:true,maskTextSelector:'#inline-results, #inline-booking, #website-confirmation',blockSelector:'iframe',recordHeaders:false,recordBody:false,recordCrossOriginIframes:false},
   before_send:event=>{
    if(!event)return event;
    for(const k of ['$current_url','$referrer','$initial_current_url','$initial_referrer'])if(event.properties?.[k])event.properties[k]=cleanUrl(event.properties[k]);
    return event;
   },
   loaded:instance=>{
    ph=instance;ph.register(properties);ph.capture('$pageview',{$current_url:cleanUrl(location.href),...properties});
    track('session');for(const item of pending.splice(0))ph.capture(...item);
   }
  });
 }catch{/* Tracking failure must never interrupt the form or booking. */}
})();
