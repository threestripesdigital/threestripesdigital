// Dedicated PostHog recording and measurement. The old Cloudflare tracker stays off.
(async()=>{
 const query=new URL(window.rankBoostAttribution?.pageUrl()||location.href).searchParams;
 const privacy=navigator.globalPrivacyControl===true?'gpc':navigator.doNotTrack==='1'?'dnt':'none';
 const hadPii=[...query.keys()].some(k=>/token|email|phone|name|lead_ref/i.test(k));
 let internal=false;
 try{
  if(query.get('rb_internal')==='1')localStorage.setItem('rb_analytics_exclude','1');
  if(query.get('rb_internal')==='0')localStorage.removeItem('rb_analytics_exclude');
  internal=localStorage.getItem('rb_analytics_exclude')==='1';
 }catch{internal=false;}
 const properties={funnel:'rank_boost',tracking_version:2,privacy_signal:privacy,url_had_pii:hadPii,internal};
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','campaign_id','adset_id','ad_id']){
  const value=query.get(key);if(value&&value.length<=200)properties[key]=value;
 }
 const cleanUrl=value=>{try{const u=new URL(value);u.search='';u.hash='';return u.href;}catch{return '';}};
 const pending=[],sent=new Set();let ph,leadToken;
 function send(event,extra){const item=['rb_'+event,{...properties,...extra}];if(ph)ph.capture(...item);else pending.push(item);}
 function track(event,extra={}){if(sent.has(event))return;sent.add(event);send(event,extra);}
 function capture(event,extra={}){send(event,extra);}
 function identifyLead(token){
  if(typeof token!=='string'||!token||token===leadToken)return;
  leadToken=token;properties.lead_token=token;if(ph)ph.register({lead_token:token});
 }
 window.rankBoostReplay={track,capture,identifyLead};
 const form=document.getElementById('qualify-form');
 form?.addEventListener('input',()=>track('application_start'),{once:true});
 form?.addEventListener('submit',()=>track('application_start'),{once:true});
 document.querySelectorAll('.hero-vsl wistia-player').forEach(player=>{
  track('vsl_load');player.addEventListener('play',()=>track('vsl_play'));
  player.addEventListener('percent-watched-change',()=>{
   const pct=player.percentWatched;if(!Number.isFinite(pct)||pct<0||pct>1)return;
   for(const n of [25,50,75])if(pct>=n/100){track('vsl_play');track('vsl_'+n);}
  });
 });
 window.addEventListener('message',e=>{
  if(e.origin!=='https://calendly.com')return;
  const raw=e.data?.event;
  if(typeof raw!=='string'||!raw.startsWith('calendly.'))return;
  const name=raw.slice(9);if(!name)return;
  const extra={};
  if(name==='event_scheduled'){
   const invitee=e.data.payload?.invitee?.uri,scheduled=e.data.payload?.event?.uri;
   if(invitee)extra.invitee_uri=invitee;if(scheduled)extra.event_uri=scheduled;
  }
  capture('calendly_'+name,extra);
  if(name==='event_type_viewed')track('scheduler_open');
  if(name==='date_and_time_selected')track('calendly_time_selected');
  if(name==='event_scheduled')track('booking_browser_confirmation');
 });
 try{
  const response=await fetch('api/replay-config');if(!response.ok)return;
  const config=await response.json();if(!config.enabled||!config.token)return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://us-assets.i.posthog.com/static/array.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
  window.posthog.init(config.token,{
   api_host:config.host,ui_host:'https://us.posthog.com',defaults:'2025-05-24',
   person_profiles:'never',capture_pageview:true,capture_pageleave:true,autocapture:true,
   disable_session_recording:false,enable_recording_console_log:false,
   capture_performance:false,capture_exceptions:false,
   session_recording:{maskAllInputs:false,recordHeaders:false,recordBody:false,recordCrossOriginIframes:false},
   before_send:event=>{
    if(!event)return event;
    for(const k of ['$current_url','$referrer','$initial_current_url','$initial_referrer'])if(event.properties?.[k])event.properties[k]=cleanUrl(event.properties[k]);
    return event;
   },
   loaded:instance=>{
    ph=instance;ph.register(properties);
    track('session');for(const item of pending.splice(0))ph.capture(...item);
   }
  });
 }catch{/* Tracking failure must never interrupt the form or booking. */}
})();
