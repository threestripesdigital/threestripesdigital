import test from 'node:test';
import assert from 'node:assert/strict';
import {gridMetrics} from '../public/metric-grid.js';
test('provider values occupy the grid without substituting engagement for retention',()=>{
 const data={metrics:['cpm','ctr','cpc','play','retention'].map(key=>({key,value:null})),sources:{wistia:{window:{start:'2026-09-01',end:'2026-09-07',values:{play_rate:12,engagement_rate:25,plays:3}}}},metaWebsite:{landingPageViews:9,websiteLeads:2}};
 const {performance,funnel}=gridMetrics(data);
 assert.equal(funnel.filter(m=>m.key==='play').length,1);
 assert.equal(funnel.find(m=>m.key==='play').value,12);
 assert.equal(funnel.find(m=>m.key==='wistia_engagement').value,25);
 assert.equal(funnel.find(m=>m.key==='retention').value,null);
 assert.equal(performance.find(m=>m.key==='meta_lpv').value,9);
 assert.equal(funnel.find(m=>m.key==='ga4_sessions').value,null);
});
