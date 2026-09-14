import test from 'node:test';import assert from 'node:assert/strict';
import {deliveryFor} from './delivery.js';import {timingCandidates} from './booking-timing.js';
test('parent pauses and stale status remain explicit without losing historical metrics',()=>{
 const state={delivery_success:new Date().toISOString(),delivery_inventory:JSON.stringify([{kind:'adset_id',id:'2',effective_status:'CAMPAIGN_PAUSED'}])};
 assert.equal(deliveryFor(state,'adset_id','2').delivery_paused,true);assert.equal(deliveryFor(state,'adset_id','2').delivery_label,'Campaign paused');assert.equal(deliveryFor(state,'adset_id','2').delivery_stale,false);
 state.delivery_error='failure';assert.equal(deliveryFor(state,'adset_id','2').delivery_stale,true);assert.equal(deliveryFor(state,'adset_id','missing').delivery_status,'UNKNOWN');
});
test('hourly timing candidates never select a winner and respect account timezone',()=>{
 const rows=[{campaign_id:'1',adset_id:'2',adset_name:'A',inline_link_clicks:'3',hourly_stats_aggregated_by_advertiser_time_zone:'08:00:00 - 08:59:59'},{campaign_id:'1',adset_id:'3',adset_name:'B',inline_link_clicks:'1',hourly_stats_aggregated_by_advertiser_time_zone:'08:00:00 - 08:59:59'}];
 assert.equal(timingCandidates(rows,{booked_at:'2026-09-14T12:47:56Z'},'America/New_York',['1']).length,2);assert.equal(timingCandidates(rows,{booked_at:'2026-09-14T13:00:00Z'},'America/New_York',['1']).length,0);
});
