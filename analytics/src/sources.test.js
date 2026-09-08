import test from 'node:test';
import assert from 'node:assert/strict';
import {ga4Request,ga4Values,sourceReport} from './sources.js';
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
