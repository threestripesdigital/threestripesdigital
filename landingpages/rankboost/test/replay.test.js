import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('../public/replay.js',import.meta.url),'utf8');
const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function harness(options={}){
 const state={events:[],registered:[],listeners:{},messages:[],requests:0,config:null};
 const href=options.href||'https://threestripesdigital.com/rank-boost/law-firms/?utm_source=meta&campaign_id=1&adset_id=2&ad_id=3';
 state.context={
  navigator:options.navigator||{},
  location:{href,search:href.slice(href.indexOf('?'))},URL,URLSearchParams,
  localStorage:{getItem(){if(options.storageFails)throw new Error('denied');return options.excluded?'1':null;},setItem(){},removeItem(){}},
  window:{addEventListener(kind,fn){if(kind==='message')state.messages.push(fn);},posthog:{init(_token,config){
   state.config=config;
   config.loaded({register(properties){state.registered.push({...properties});},capture(...event){state.events.push(event);}});
  }}},
  document:{getElementById(){return{addEventListener(kind,fn){state.listeners[kind]=fn;}};},querySelectorAll(){return[];},createElement(){return{};},head:{appendChild(s){s.onload();}}},
  fetch:async()=>{state.requests++;return {ok:true,json:async()=>({enabled:true,token:'public-test',host:'https://us.i.posthog.com'})};}
 };
 return state;
}
const load=async options=>{const state=harness(options);await runInNewContext(script,state.context);return state;};

test('privacy signals, PII URLs and internal browsers are recorded instead of dropping the session',async()=>{
 const gpc=await load({navigator:{globalPrivacyControl:true}});
 assert.equal(gpc.requests,1);assert.equal(gpc.registered[0].privacy_signal,'gpc');
 assert.equal(gpc.registered[0].tracking_version,2);assert.equal(gpc.registered[0].funnel,'rank_boost');
 const dnt=await load({navigator:{doNotTrack:'1'}});
 assert.equal(dnt.requests,1);assert.equal(dnt.registered[0].privacy_signal,'dnt');
 const pii=await load({href:'https://threestripesdigital.com/rank-boost/law-firms/?email=x'});
 assert.equal(pii.requests,1);assert.equal(pii.registered[0].url_had_pii,true);
 assert.equal(pii.config.before_send({properties:{$current_url:'https://example.com/?email=private#token'}}).properties.$current_url,'https://example.com/');
 assert.ok(!pii.events.some(event=>JSON.stringify(event[1]).includes('email')));
 const internal=await load({excluded:true});
 assert.equal(internal.requests,1);assert.equal(internal.registered[0].internal,true);
 const broken=await load({storageFails:true});
 assert.equal(broken.requests,1);assert.equal(broken.registered[0].internal,false);
 const plain=await load();
 assert.equal(plain.registered[0].privacy_signal,'none');
 assert.equal(plain.registered[0].url_had_pii,false);
 assert.equal(plain.registered[0].internal,false);
 assert.equal(plain.registered[0].adset_id,'2');
});

test('application completion no longer needs a recorded start and still sends once',async()=>{
 const state=await load();
 state.context.window.rankBoostReplay.track('application_complete',{keyword_qualified:false});
 state.context.window.rankBoostReplay.track('application_complete');
 const completions=state.events.filter(event=>event[0]==='rb_application_complete');
 assert.equal(completions.length,1);
 assert.equal(completions[0][1].keyword_qualified,false);
 assert.equal(completions[0][1].adset_id,'2');
});

test('Calendly steps are captured every time while dashboard steps stay once per load',async()=>{
 const state=await load();
 const replay=state.context.window.rankBoostReplay;
 replay.capture('calendly_event_type_viewed');replay.capture('calendly_event_type_viewed');
 assert.equal(state.events.filter(event=>event[0]==='rb_calendly_event_type_viewed').length,2);
 const onMessage=state.messages[0];
 onMessage({origin:'https://example.com',data:{event:'calendly.date_and_time_selected'}});
 onMessage({origin:'https://calendly.com',data:{event:'calendly.date_and_time_selected'}});
 assert.equal(state.events.filter(event=>event[0]==='rb_calendly_date_and_time_selected').length,1);
 assert.equal(state.events.filter(event=>event[0]==='rb_calendly_time_selected').length,1);
 onMessage({origin:'https://calendly.com',data:{event:'calendly.date_and_time_selected'}});
 assert.equal(state.events.filter(event=>event[0]==='rb_calendly_date_and_time_selected').length,2);
 assert.equal(state.events.filter(event=>event[0]==='rb_calendly_time_selected').length,1);
 onMessage({origin:'https://calendly.com',data:{event:'calendly.event_scheduled',payload:{invitee:{uri:'invitee-1'},event:{uri:'event-1'}}}});
 const scheduled=state.events.filter(event=>event[0]==='rb_calendly_event_scheduled');
 assert.equal(scheduled.length,1);
 assert.equal(scheduled[0][1].invitee_uri,'invitee-1');
 assert.equal(scheduled[0][1].event_uri,'event-1');
 assert.equal(state.events.filter(event=>event[0]==='rb_booking_browser_confirmation').length,1);
});

test('recording is unmasked and PostHog owns page views',async()=>{
 const state=await load();
 assert.equal(state.config.session_recording.maskAllInputs,false);
 assert.ok(!('blockSelector' in state.config.session_recording));
 assert.ok(!('maskTextSelector' in state.config.session_recording));
 assert.equal(state.config.autocapture,true);
 assert.equal(state.config.capture_pageview,true);
 assert.equal(state.config.capture_pageleave,true);
 assert.equal(state.config.person_profiles,'never');
 assert.equal(state.config.disable_session_recording,false);
 assert.ok(!state.events.some(event=>event[0]==='$pageview'));
});

test('identifyLead registers the signed lead token once',async()=>{
 const state=await load();
 state.context.window.rankBoostReplay.identifyLead('tok');
 state.context.window.rankBoostReplay.identifyLead('tok');
 state.context.window.rankBoostReplay.identifyLead('');
 const tokens=state.registered.filter(properties=>Object.keys(properties).length===1&&properties.lead_token==='tok');
 assert.equal(tokens.length,1);
 assert.deepEqual(tokens[0],{lead_token:'tok'});
 state.context.window.rankBoostReplay.capture('step_3_shown');
 assert.equal(state.events.at(-1)[1].lead_token,'tok');
});

test('funnel hooks are wired into the flow, booking and landing page',()=>{
 const flow=source('inline-flow.js'),booking=source('book.js'),index=source('index.html');
 for(const name of ['step_2_shown','step_3_shown','dialog_closed','identifyLead'])assert.ok(flow.includes(name),name);
 for(const name of ['calendly_fallback_click','calendly_iframe_loaded'])assert.ok(booking.includes(name),name);
 assert.ok(index.includes('form_invalid'));
});
