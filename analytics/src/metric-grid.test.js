import test from 'node:test';
import assert from 'node:assert/strict';
import {gridMetrics,baselineMetric} from '../public/metric-grid.js';
import {rules,classify} from './metrics.js';

const posthog=(totals,extra={})=>({connected:true,stale:false,usable:true,totals,note:'PostHog · Meta sessions · Sep 19 to Sep 20 · Tests excluded · Synced now',...extra});
const dataWith=(ph)=>({metrics:rules,sources:{posthog:ph,wistia:{window:{metaValues:{play_rate:99,engagement_rate:88,plays:77,loads:78}}}},totals:{spend:100},metaWebsite:{landingPageViews:9,websiteLeads:2}});

test('main VSL and application cards use one usable PostHog cohort',()=>{
 const totals={session:10,vsl_load:8,vsl_play:4,vsl_25:3,vsl_50:2,vsl_75:1,application_start:2,application_complete:1};
 const {performance,funnel}=gridMetrics(dataWith(posthog(totals)));
 assert.equal(funnel.find(m=>m.key==='vsl_plays').value,4);
 assert.equal(funnel.find(m=>m.key==='vsl_player_loads').value,8);
 assert.equal(funnel.find(m=>m.key==='play').value,50);
 assert.equal(funnel.find(m=>m.key==='play').sample,8);
 assert.equal(funnel.find(m=>m.key==='retention').value,50);
 assert.equal(funnel.find(m=>m.key==='application').value,50);
 assert.equal(funnel.find(m=>m.key==='posthog_sessions').value,10);
 assert.equal(funnel.find(m=>m.key==='play').source,'PostHog');
 assert.match(funnel.find(m=>m.key==='play').recommendation,/DOM was present, not that it was ready or visible/);
 assert.match(funnel.find(m=>m.key==='vsl_player_loads').recommendation,/DOM was present, not that it was ready or visible/);
 assert.equal(funnel.find(m=>m.key==='wistia_engagement'),undefined);
 const cost=performance.find(m=>m.key==='cost_vsl');
 assert.equal(cost.value,null);
 assert.equal(cost.note,'Not calculated from partial browser capture');
});

test('usable PostHog zero counts remain zero while rates need denominators',()=>{
 const totals={session:0,vsl_load:0,vsl_play:0,vsl_25:0,vsl_50:0,vsl_75:0,application_start:0,application_complete:0};
 const {funnel}=gridMetrics(dataWith(posthog(totals)));
 assert.equal(funnel.find(m=>m.key==='vsl_plays').value,0);
 assert.equal(funnel.find(m=>m.key==='vsl_player_loads').value,0);
 assert.equal(funnel.find(m=>m.key==='posthog_sessions').value,0);
 assert.equal(funnel.find(m=>m.key==='play').value,null);
 assert.equal(funnel.find(m=>m.key==='retention').value,null);
 assert.equal(funnel.find(m=>m.key==='application').value,null);
});

test('stale and legacy PostHog snapshots fail closed without Wistia fallback',()=>{
 const totals={session:10,vsl_load:8,vsl_play:4,vsl_50:2,application_start:2,application_complete:1};
 for(const ph of [undefined,posthog(totals,{stale:true,message:'PostHog data is stale.'}),{connected:true,stale:false,totals,message:'Legacy snapshot'}]) {
  const {funnel}=gridMetrics(dataWith(ph));
  for(const key of ['vsl_plays','vsl_player_loads','play','retention','application','posthog_sessions'])assert.equal(funnel.find(m=>m.key===key).value,null);
  assert.equal(funnel.find(m=>m.key==='play').source,'PostHog');
 }
});

test('PostHog play rate retains strategy thresholds and uses player loads as sample',()=>{
 for(const [loads,plays] of [[0,0],[10000,0],[10000,118],[10000,2499],[10000,2500],[10000,3999],[10000,4000],[10000,10000]]) {
  const value=loads?plays/loads*100:null;
  const play=gridMetrics(dataWith(posthog({session:loads,vsl_load:loads,vsl_play:plays,vsl_50:0,application_start:0,application_complete:0}))).funnel.find(m=>m.key==='play');
  assert.equal(play.value,value);
  assert.equal(play.status,classify(value,rules.find(m=>m.key==='play')));
  assert.equal(play.good,40);assert.equal(play.bad,25);assert.equal(play.midpoint,32.5);
  assert.equal(play.source,'PostHog');assert.equal(play.sample,loads);
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
