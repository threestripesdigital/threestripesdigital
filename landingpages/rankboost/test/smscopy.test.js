import test from 'node:test';
import assert from 'node:assert/strict';
import { smsScan,recoveryText } from '../functions/api/_smscopy.js';
import { prebookingText } from '../functions/api/_prebooking.js';
const row={offer:'boost',first_name:'Zachary',domain:'cruzgoldlaw.com',top_keywords:JSON.stringify([{keyword:'immigration attorney philadelphia',position:25,volume:2900}]),total_boost_fits:72,booking_url:'https://example.test/book'};
test('SMS uses the incremental scan gap, scanned rank and other keyword count',()=>{
 const scan=smsScan(row);assert.equal(scan.gap,'$115,100');assert.equal(scan.others,71);
 const message=prebookingText(row,0);assert.match(message,/#25/);assert.match(message,/71 other qualifying keywords/);assert.match(message,/\$115,100/);assert.doesNotMatch(message,/\$116,000/);
 for(let i=0;i<3;i++){const text=prebookingText(row,i);assert.match(text,/Reply STOP/);assert.match(text,/personally read/);assert.equal((text.match(/https:\/\//g)||[]).length,1);}
});
test('missing or corrupt scan omits monetary claims and recovery stays usable',()=>{
 for(const top_keywords of ['', 'broken', '{}']){
  const scan=smsScan({top_keywords});assert.equal(scan.gap,'');const text=recoveryText('QA','no_show',scan,'https://example.test');assert.doesNotMatch(text,/undefined|\$|\/month/);assert.match(text,/first boost is free/);
 }
 assert.match(recoveryText('QA','no_show',smsScan(row),'https://example.test'),/\$115,100\/month in potential case value/);
});
test('website texts focus on being found and all have one booking action',()=>{
 for(let i=0;i<3;i++){const text=prebookingText({...row,offer:'website'},i);assert.match(text,/Google/);assert.doesNotMatch(text,/contact form|keyboard|screenshot/);assert.match(text,/Reply STOP/);}
});
