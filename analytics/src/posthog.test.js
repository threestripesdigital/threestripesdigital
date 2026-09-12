import test from 'node:test';
import assert from 'node:assert/strict';
import {syncPostHog,posthogReport} from './posthog.js';
test('PostHog import stores only aggregate rows and preserves snapshot on failure',async()=>{
 const state={},old=globalThis.fetch;
 const env={POSTHOG_PROJECT_ID:'605937',POSTHOG_PERSONAL_API_KEY:'test',REPORTING_TIMEZONE:'America/New_York',DB:{prepare(){return {bind(k,v){return {async run(){state[k]=v;}};}};}}};
 try{
  globalThis.fetch=async(url,opts)=>{assert.match(url,/605937\/query/);const q=JSON.parse(opts.body).query.query;assert.match(q,/properties.utm_source = 'meta'/);assert.match(q,/uniqExactIf/);return Response.json({results:[['2026-09-12','1','2','3',2,2,1,1,0,0,1,1,0,0]]});};
  await syncPostHog(env);assert.equal(state.posthog_error,'');
  const r=posthogReport(env,state,'2026-09-12','2026-09-12',['1']);assert.equal(r.totals.session,2);assert.equal(r.totals.vsl_play,1);
  assert.equal(posthogReport(env,state,'2026-09-12','2026-09-12',['9']).totals.session,0);
  const saved=state.posthog_daily;globalThis.fetch=async()=>Response.json({},{status:403});await syncPostHog(env);assert.equal(state.posthog_daily,saved);assert.equal(posthogReport(env,state,'2026-09-12','2026-09-12',['1']).connected,false);
 }finally{globalThis.fetch=old;}
});
