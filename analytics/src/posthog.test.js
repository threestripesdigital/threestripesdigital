import test from 'node:test';
import assert from 'node:assert/strict';
import {syncPostHog,posthogReport,posthogQuery,posthogVideoRows,posthogLaunches} from './posthog.js';
const campaign='120249151255100545',v1='120249029003230545';
const launch='2026-09-19T19:26:26.545831Z';
function setup(){
 const state={['campaign_launch:'+campaign]:launch};
 const env={META_CAMPAIGN_IDS:v1+','+campaign,LAUNCH_AT:'2026-09-11T15:24:44.002443Z',POSTHOG_PROJECT_ID:'605937',POSTHOG_PERSONAL_API_KEY:'test',REPORTING_TIMEZONE:'America/New_York',DB:{prepare(){return {async all(){return {results:Object.entries(state).map(([key,value])=>({key,value}))};},bind(k,v){return {async run(){state[k]=v;}};}};}}};
 return {env,state};
}
const row=(day,c=campaign,ad='3',n=2)=>[day,c,'2',ad,n,n,1,1,0,0,1,1,0,0];
test('cohort import stores only aggregates, scopes by launch, and preserves snapshot on failure',async()=>{
 const {state,env}=setup(),old=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{
   assert.match(url,/605937\/query/);
   const q=JSON.parse(opts.body).query.query;
   assert.match(q,/properties.utm_source = 'meta'/);
   assert.match(q,/GROUP BY sid HAVING countIf\(event = 'rb_session'\) > 0/);
   assert.match(q,/max\(event = 'rb_vsl_play'\)/);
   assert.match(q,/first_session >= toDateTime64\('2026-09-19 19:26:26.545831', 6, 'UTC'\)/);
   assert.match(q,/WHERE is_test = 0/);assert.match(q,/posthog_verification/);assert.match(q,/'qa_'/);
   return Response.json({results:[row('2026-09-19'),row('2026-09-14',v1)]});
  };
  await syncPostHog(env);assert.equal(state.posthog_error,'');
  const saved=state.posthog_cohort,snapshot=JSON.parse(saved);
  assert.equal(snapshot.version,2);assert.equal(snapshot.launches[campaign],launch);
  assert.equal(snapshot.rows[0].session,2);assert.equal('sid' in snapshot.rows[0],false);
  const r=posthogReport(env,state,'2026-09-14','2026-09-20',[campaign]);
  assert.equal(r.usable,true);assert.equal(r.totals.session,2);assert.equal(r.totals.vsl_play,1);assert.equal(r.rows.length,1);
  assert.equal(r.cohort.partial,false);assert.match(r.note,/Tests excluded/);
  assert.equal(posthogReport(env,state,'2026-09-20','2026-09-20',[campaign]).totals.session,0);
  assert.equal(posthogReport(env,state,'2026-09-11','2026-09-15',[v1]).cohort.partial,true);
  state.posthog_daily=JSON.stringify([{day:'2026-09-19',campaign_id:campaign,session:999,vsl_play:999}]);
  assert.equal(posthogReport(env,state,'2026-09-14','2026-09-20',[campaign]).totals.session,2);
  state['campaign_launch:'+campaign]='2026-09-19T20:00:00Z';
  assert.equal(posthogReport(env,state,'2026-09-14','2026-09-20',[campaign]).totals,null);
  state['campaign_launch:'+campaign]=launch;
  globalThis.fetch=async()=>Response.json({},{status:403});await syncPostHog(env);
  assert.equal(state.posthog_cohort,saved);assert.equal(posthogReport(env,state,'2026-09-14','2026-09-20',[campaign]).usable,false);
 }finally{globalThis.fetch=old;}
});
test('legacy, mismatched, stale or unlaunched snapshots cannot produce current campaign counts',()=>{
 const {state,env}=setup();state.posthog_success=new Date().toISOString();state.posthog_daily='[]';
 const report=()=>posthogReport(env,state,'2026-09-14','2026-09-20',[campaign]);
 assert.equal(report().totals,null);
 state.posthog_cohort=JSON.stringify({version:2,projectId:env.POSTHOG_PROJECT_ID,timezone:env.REPORTING_TIMEZONE,start:'2026-09-01',through:new Date().toISOString(),launches:posthogLaunches(env,state),rows:[]});
 assert.equal(report().usable,true);assert.equal(report().totals.session,0);
 state.posthog_success=new Date(Date.now()-3*3600000).toISOString();assert.equal(report().stale,true);assert.equal(report().totals,null);
 state.posthog_success='invalid';assert.equal(report().stale,true);assert.equal(report().totals,null);
 state.posthog_success=new Date().toISOString();assert.equal(posthogReport({...env,POSTHOG_PROJECT_ID:'999'},state,'2026-09-14','2026-09-20',[campaign]).totals,null);
 delete state['campaign_launch:'+campaign];assert.equal(report().usable,false);
 assert.equal(posthogLaunches(env,state)[campaign],null);
 const q=posthogQuery(env,posthogLaunches(env,state),'2026-09-01','2026-09-20T13:00:00.000Z');
 assert.ok(!q.includes(`campaign_id = '${campaign}' AND first_session`));
});
test('campaign, ad set and ad video rows use the same cohort and preserve zero and unavailable states',()=>{
 const ph={usable:true,stale:false,note:'PostHog cohort',rows:[{campaign_id:campaign,adset_id:'2',ad_id:'3',vsl_load:4,vsl_play:1}]};
 for(const [key,id] of [['campaign_id',campaign],['adset_id','2'],['ad_id','3']]){
  const [r]=posthogVideoRows([{id,spend:100}],key,ph);assert.equal(r.vsl_loads,4);assert.equal(r.vsl_plays,1);assert.equal(r.vsl_play_rate,25);assert.equal(r.cost_per_vsl_play,null);
 }
 const [zero]=posthogVideoRows([{id:'4'}],'ad_id',ph);assert.equal(zero.vsl_plays,0);assert.equal(zero.vsl_play_rate,null);
 const [unavailable]=posthogVideoRows([{id:'3'}],'ad_id',{...ph,usable:false,stale:true});assert.equal(unavailable.vsl_loads,null);assert.equal(unavailable.vsl_plays,null);assert.equal(unavailable.vsl_stale,true);
});
test('invalid aggregate counts fail closed and cannot replace a prior cohort snapshot',async()=>{
 const {env,state}=setup(),old=globalThis.fetch;state.posthog_cohort='previous';
 try{globalThis.fetch=async()=>Response.json({results:[['2026-09-19',campaign,'2','3',1,2,0,0,0,0,0,0,0,0]]});await syncPostHog(env);assert.match(state.posthog_error,/invalid counts/);assert.equal(state.posthog_cohort,'previous');}finally{globalThis.fetch=old;}
});
