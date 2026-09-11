import test from 'node:test';
import assert from 'node:assert/strict';
import {ga4Request,ga4Values,sourceReport,syncWistia,wistiaValues,metaVideoValues} from './sources.js';
import {websiteActions} from './meta.js';
test('Wistia converts native rates, uses exclusive end dates and preserves snapshots on failure',async()=>{
 const fixture={plays:3,unique_plays:3,unique_loads:254,unique_visitors:254,played_time:47,play_rate:.01,engagement_rate:.05};
 assert.equal(wistiaValues(fixture).engagement_rate,5);assert.equal(wistiaValues({...fixture,engagement_rate:null}).engagement_rate,null);
 assert.throws(()=>wistiaValues({...fixture,plays:undefined}));
 const state=new Map(),requests=[],old=globalThis.fetch;
 const e={WISTIA_API_TOKEN:'test-only',WISTIA_MEDIA_ID:'8uioqg3047',REPORTING_TIMEZONE:'America/New_York',DB:{prepare(){return{bind(k,v){return{async run(){state.set(k,v);}};}};}}};
 try{
  globalThis.fetch=async url=>{requests.push(new URL(url));return Response.json(new URL(url).pathname.endsWith("/traffic")?[{utm_source:"meta",loads:4,plays:1,engagement_rate:.5},{utm_source:"email",loads:100,plays:90}]:fixture);};
  await syncWistia(e);assert.equal(requests.length,8);
  const saved=state.get('wistia_snapshot'),report=JSON.parse(saved);
  assert.equal(Date.parse(requests[0].searchParams.get('end_date'))-Date.parse(report.windows[1].end),86400000);
  assert.equal(report.windows[7].values.plays,3);assert.equal(state.get('wistia_error'),'');
  globalThis.fetch=async()=>Response.json({error:'denied'},{status:403});
  await syncWistia(e);assert.equal(state.get('wistia_snapshot'),saved);assert.match(state.get('wistia_error'),/403/);
 }finally{globalThis.fetch=old;}
});
test('Meta website actions do not add overlapping lead aggregates',()=>{
 assert.deepEqual(websiteActions([{action_type:'landing_page_view',value:'12'},{action_type:'offsite_conversion.fb_pixel_lead',value:'3'},{action_type:'lead',value:'3'},{action_type:'omni_lead',value:'3'}]),{landingPageViews:12,websiteLeads:3});
 assert.deepEqual(websiteActions(),{landingPageViews:0,websiteLeads:0});
 assert.throws(()=>websiteActions([{action_type:'landing_page_view',value:'NaN'}]));
});
test('GA4 is restricted to the funnel and reports a missing result as unavailable',()=>{
 const request=ga4Request('2026-09-01','2026-09-08');
 const filters=request.dimensionFilter.andGroup.expressions;
 assert.deepEqual(filters[0].filter.inListFilter.values,['threestripesdigital.com','www.threestripesdigital.com']);
 const pattern=new RegExp('^'+filters[1].filter.stringFilter.value+'$');
 assert.ok(pattern.test('/rank-boost/law-firms/'));assert.ok(pattern.test('/rank-boost/law-firms/book'));
 assert.ok(!pattern.test('/rank-boost/law-firms-other'));assert.ok(!pattern.test('/rank-boost/medical/'));
 assert.equal(ga4Values({}),null);
 const headers=['screenPageViews','sessions','activeUsers'].map(name=>({name}));
 assert.deepEqual(ga4Values({metricHeaders:headers,rows:[{metricValues:['12','7','6'].map(value=>({value}))}]}),{screenPageViews:12,sessions:7,activeUsers:6});
 assert.throws(()=>ga4Values({metricHeaders:headers,rows:[{metricValues:[{value:'invalid'}]}]}));
});
test('a different property or reporting day cannot look current',()=>{
 const state={ga4_success:new Date().toISOString(),ga4_snapshot:JSON.stringify({property:'123',windows:{7:{end:'2026-09-01',values:{sessions:10}}}})};
 const e={GA4_PROPERTY_ID:'123',GA4_SERVICE_ACCOUNT:'configured',BROWSER_TRACKING_ENABLED:'false'};
 assert.equal(sourceReport(e,state,7,'2026-09-08').ga4.stale,true);
 assert.equal(sourceReport({...e,GA4_PROPERTY_ID:'456'},state,7,'2026-09-01').ga4.window,null);
 assert.equal(sourceReport(e,state,7,'2026-09-01').browserTracking,false);
});

test('Meta video breakdown excludes organic and unknown sources, with no fake zero rate',()=>{
 assert.deepEqual(metaVideoValues([{utm_source:'meta',loads:20,plays:5,engagement_rate:.5},{utm_source:null,loads:100,plays:99},{utm_source:'email',loads:10,plays:9}]),{loads:20,plays:5,play_rate:25,engagement_rate:50});
 assert.equal(metaVideoValues([]).play_rate,null);
 assert.throws(()=>metaVideoValues([{utm_source:'meta',loads:null,plays:0}]));
});
