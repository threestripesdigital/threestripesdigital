import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('../public/attribution.js',import.meta.url),'utf8');
test('return visits retain known tags, but new untagged clicks and internal tests cannot inherit them',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const visit=q=>{const context={location:{href:'https://example.test/'+q},URL,Date,localStorage:storage,window:{}};runInNewContext(script,context);return new URL(context.window.rankBoostAttribution.pageUrl()).searchParams;};
 assert.equal(visit('?utm_source=meta&campaign_id=1&adset_id=2&ad_id=3&fbclid=first').get('ad_id'),'3');assert.equal(visit('').get('ad_id'),'3');assert.equal(visit('?fbclid=second').get('ad_id'),null);assert.equal(visit('').get('ad_id'),null);
 visit('?utm_source=meta&campaign_id=4&adset_id=5&ad_id=6');visit('?rb_internal=1');assert.equal(visit('').get('ad_id'),null);
});
