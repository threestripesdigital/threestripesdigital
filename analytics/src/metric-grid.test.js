import test from 'node:test';
import assert from 'node:assert/strict';
import {gridMetrics,baselineMetric} from '../public/metric-grid.js';
test('provider values occupy the grid without substituting engagement for retention',()=>{
 const data={metrics:['cpm','ctr','cpc','play','retention'].map(key=>({key,value:null})),sources:{wistia:{window:{start:'2026-09-01',end:'2026-09-07',metaValues:{play_rate:12,engagement_rate:25,plays:3}}}},metaWebsite:{landingPageViews:9,websiteLeads:2}};
 const {performance,funnel}=gridMetrics(data);
 assert.equal(funnel.filter(m=>m.key==='play').length,1);
 assert.equal(funnel.find(m=>m.key==='play').value,12);
 assert.equal(funnel.find(m=>m.key==='wistia_engagement').value,25);
 assert.equal(funnel.find(m=>m.key==='retention').value,null);
 assert.equal(performance.find(m=>m.key==='meta_lpv').value,9);
 assert.equal(funnel.find(m=>m.key==='ga4_sessions'),undefined);
});

import {rules, classify} from './metrics.js';
test('Wistia play rate retains strategy targets and classifies boundary values',()=>{
 for(const value of [null,0,1.18,24.99,25,32.5,39.99,40,100]){
  const data={metrics:rules,sources:{wistia:{window:{metaValues:{play_rate:value,loads:254}}}},hold:{locked:true}};
  const play=gridMetrics(data).funnel.find(m=>m.key==='play');
  assert.equal(play.status,classify(value,rules.find(m=>m.key==='play')));
  assert.equal(play.good,40);assert.equal(play.bad,25);assert.equal(play.midpoint,32.5);
  assert.equal(play.source,'Wistia');assert.equal(play.sample,254);
 }
});

test('v1 comparisons preserve unknowns and compare matching costs only',()=>{
 const d={comparison:{totals:{spend:100,impressions:1000,link_clicks:20},metaWebsite:{landingPageViews:10,websiteLeads:2},forms:{ready:true,total:5,qualified:2},bookings:{ready:true,count:0},unknownCampaignBookings:1}};
 assert.equal(baselineMetric(d,'cpm').value,100);
 assert.equal(baselineMetric(d,'cost_form').value,20);
 assert.equal(baselineMetric(d,'form_opens').value,null);
 assert.equal(baselineMetric(d,'scheduled_cost').value,null);
 assert.match(baselineMetric(d,'booked').note,/lacks a campaign ID/);
 assert.equal(baselineMetric(d,'spend').deltaAllowed,false);
 assert.equal(baselineMetric({},'cpm'),null);
});
