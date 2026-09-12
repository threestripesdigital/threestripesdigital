import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('../public/replay.js',import.meta.url),'utf8');
test('replay respects privacy exclusions and captures only a started application',async()=>{
 const events=[],listeners={};let config,requests=0;
 const context={navigator:{},location:{search:'?utm_source=meta&campaign_id=1&adset_id=2&ad_id=3',href:'https://threestripesdigital.com/rank-boost/law-firms/?campaign_id=1'},URL,URLSearchParams,localStorage:{getItem(){return null;},setItem(){},removeItem(){}},window:{addEventListener(){},posthog:{init(_token,c){config=c;c.loaded({register(){},capture(...e){events.push(e);}});}}},document:{getElementById(){return{addEventListener(k,fn){listeners[k]=fn;}};},querySelectorAll(){return[];},createElement(){return{};},head:{appendChild(s){s.onload();}}},fetch:async()=>{requests++;return {ok:true,json:async()=>({enabled:true,token:'public-test',host:'https://us.i.posthog.com'})};}};
 await runInNewContext(script,{...context,navigator:{globalPrivacyControl:true}});assert.equal(requests,0);
 await runInNewContext(script,context);
 context.window.rankBoostReplay.track('application_complete');assert.ok(!events.some(e=>e[0]==='rb_application_complete'));
 listeners.input();context.window.rankBoostReplay.track('application_complete',{keyword_qualified:false});context.window.rankBoostReplay.track('application_complete');
 assert.equal(events.filter(e=>e[0]==='rb_application_complete').length,1);assert.equal(events.at(-1)[1].adset_id,'2');assert.equal(config.session_recording.maskAllInputs,true);
 const clean=config.before_send({properties:{$current_url:'https://example.com/?email=private#token'}});assert.equal(clean.properties.$current_url,'https://example.com/');
});
