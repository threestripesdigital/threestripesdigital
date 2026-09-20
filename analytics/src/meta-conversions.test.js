import test from 'node:test';
import assert from 'node:assert/strict';
import {metaInsightFields,websiteActions} from './meta.js';

test('Meta Insights requests conversions alongside actions',()=>{
 assert.ok(metaInsightFields.split(',').includes('actions'));
 assert.ok(metaInsightFields.split(',').includes('conversions'));
});

test('website SubmitApplication wins without double counting aliases',()=>{
 const actions=[{action_type:'offsite_conversion.fb_pixel_submit_application',value:'1'}];
 const conversions=[{action_type:'submit_application_website',value:'1'},{action_type:'submit_application_total',value:'1'}];
 assert.equal(websiteActions(actions,conversions).formOpens,1);
});

test('preferred zero is preserved instead of falling through to another alias',()=>{
 const actions=[{action_type:'offsite_conversion.fb_pixel_submit_application',value:'4'}];
 const conversions=[{action_type:'submit_application_website',value:'0'},{action_type:'submit_application_total',value:'4'}];
 assert.equal(websiteActions(actions,conversions).formOpens,0);
});

test('legacy action and total conversion remain supported fallbacks',()=>{
 assert.equal(websiteActions([{action_type:'offsite_conversion.fb_pixel_submit_application',value:'3'}]).formOpens,3);
 assert.equal(websiteActions([], [{action_type:'submit_application_total',value:'2'}]).formOpens,2);
});

test('invalid or negative conversion values fail closed',()=>{
 for(const value of ['NaN','Infinity','-1']) {
  assert.throws(()=>websiteActions([], [{action_type:'submit_application_website',value}]),/Invalid Meta website action count/);
 }
});
