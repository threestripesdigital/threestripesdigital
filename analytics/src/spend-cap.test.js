import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {getSpendCap,removeSpendCap,SpendCapError} from './spend-cap.js';

const CAMPAIGN='120249151255100545';
const ACCOUNT='358826439854169';

function database(initial={}) {
 const state=new Map(Object.entries(initial)),locks=new Map();
 return {state,locks,prepare(sql){return {bind(...values){return {
  async first(){
   if(sql.startsWith('SELECT value FROM state'))return state.has(values[0])?{value:state.get(values[0])}:null;
   throw Error('Unexpected first: '+sql);
  },
  async run(){
   if(sql.startsWith('INSERT INTO state')){state.set(values[0],String(values[1]));return {meta:{changes:1}};}
   if(sql.startsWith('DELETE FROM state')){state.delete(values[0]);return {meta:{changes:1}};}
   if(sql.startsWith('INSERT INTO locks')){const [key,owner,expires,now]=values,old=locks.get(key);if(old&&old.expires>=now)return {meta:{changes:0}};locks.set(key,{owner,expires});return {meta:{changes:1}};}
   if(sql.startsWith('DELETE FROM locks')){const [key,owner]=values;if(locks.get(key)?.owner===owner)locks.delete(key);return {meta:{changes:1}};}
   throw Error('Unexpected run: '+sql);
  }
 };}};}};
}

function environment(db=database()) {return {DB:db,META_API_VERSION:'v25.0',META_ACCESS_TOKEN:'read-token',META_MANAGEMENT_TOKEN:'management-token',META_ACCOUNT_ID:ACCOUNT,META_CAMPAIGN_IDS:CAMPAIGN,META_SPEND_CAP_CAMPAIGN_ID:CAMPAIGN,META_ACCOUNT_CURRENCY:'CAD',META_USD_TO_ACCOUNT_RATE:'1.4002',META_FX_DATE:'2026-09-18',CURRENCY:'USD'};}

function metaFetch({cap='96500',spend='700.00',spendMissing=false,campaignCurrency='CAD',campaignCaps=[],campaignStatuses=[],campaignEffectiveStatuses=[],adsetEffectiveStatuses=[]}={}) {
 const requests=[];let campaignRead=0;
 const fetch=async (input,init={})=>{
  const url=new URL(input),method=init.method||'GET';requests.push({url,init,method});
  if(method==='POST')return Response.json({success:true});
  if(url.pathname.endsWith('/act_'+ACCOUNT))return Response.json({currency:campaignCurrency});
  if(url.pathname.endsWith('/'+CAMPAIGN+'/insights'))return Response.json({data:spend===null?[]:[spendMissing?{campaign_id:CAMPAIGN}:{campaign_id:CAMPAIGN,spend}]});
  if(url.pathname.endsWith('/'+CAMPAIGN)){
   const index=campaignRead++,current=campaignCaps.length?campaignCaps[Math.min(index,campaignCaps.length-1)]:cap;
   const status=campaignStatuses[Math.min(index,campaignStatuses.length-1)]||'ACTIVE',effective=campaignEffectiveStatuses[Math.min(index,campaignEffectiveStatuses.length-1)]||'ACTIVE',adsetEffective=adsetEffectiveStatuses[Math.min(index,adsetEffectiveStatuses.length-1)]||'ACTIVE';
   return Response.json({id:CAMPAIGN,name:'Rank Boost v2',account_id:ACCOUNT,spend_cap:current,status,effective_status:effective,adsets:{data:[{id:'120249151260230545',status:'ACTIVE',effective_status:adsetEffective,daily_budget:'7001'},{id:'120249151260660545',status:'ACTIVE',effective_status:adsetEffective,daily_budget:'7001'}]}});
  }
  return Response.json({error:{code:100}},{status:400});
 };
 return {fetch,requests};
}

test('reads full-lifetime spend in minor units and computes warning pace separately',async()=>{
 const oldFetch=globalThis.fetch,{fetch,requests}=metaFetch();globalThis.fetch=fetch;
 try {
  const result=await getSpendCap(environment(),CAMPAIGN,{fresh:true});
  assert.deepEqual({...result,checkedAt:'checked'}, {campaignId:CAMPAIGN,campaignName:'Rank Boost v2',currency:'CAD',reportingCurrency:'USD',fxRate:1.4002,capMinor:96500,spentMinor:70000,remainingMinor:26500,percentUsed:72.54,dailyBudgetMinor:14002,daysRemainingAtBudget:1.89,level:'warning',checkedAt:'checked',stale:false,error:null,canRemove:true});
  const insights=requests.find(request=>request.url.pathname.endsWith('/insights')).url;
  assert.equal(insights.searchParams.get('date_preset'),'maximum');
  assert.equal(insights.searchParams.get('level'),'campaign');
  assert.equal(insights.searchParams.has('time_range'),false);
 } finally {globalThis.fetch=oldFetch;}
});

test('represents verified empty spend and an absent cap without inventing unknown values',async()=>{
 const oldFetch=globalThis.fetch,{fetch}=metaFetch({cap:'0',spend:null});globalThis.fetch=fetch;
 try {
  const result=await getSpendCap(environment(),CAMPAIGN,{fresh:true});
  assert.equal(result.spentMinor,0);assert.equal(result.capMinor,null);assert.equal(result.level,'uncapped');assert.equal(result.canRemove,false);
 } finally {globalThis.fetch=oldFetch;}
});

test('uses configured enabled budgets when the reached cap stops effective delivery',async()=>{
 const oldFetch=globalThis.fetch,{fetch}=metaFetch({spend:'965.00',campaignEffectiveStatuses:['PAUSED'],adsetEffectiveStatuses:['CAMPAIGN_PAUSED']});globalThis.fetch=fetch;
 try {
  const result=await getSpendCap(environment(),CAMPAIGN,{fresh:true});
  assert.equal(result.level,'reached');assert.equal(result.dailyBudgetMinor,14002);assert.equal(result.daysRemainingAtBudget,0);
 } finally {globalThis.fetch=oldFetch;}
});

test('fails closed with null metrics when Meta is unavailable and marks old cache stale',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{code:190}},{status:401});
 try {
  const db=database(),env=environment(db),empty=await getSpendCap(env,CAMPAIGN,{fresh:true});
  assert.equal(empty.level,'unavailable');assert.equal(empty.spentMinor,null);assert.equal(empty.capMinor,null);assert.equal(empty.stale,true);assert.equal(empty.canRemove,false);
  db.state.set('spend_cap:'+CAMPAIGN,JSON.stringify({campaignId:CAMPAIGN,capMinor:96500,spentMinor:70000,checkedAt:'2026-09-18T00:00:00.000Z',stale:false,error:null,canRemove:true}));
  const stale=await getSpendCap(env,CAMPAIGN,{fresh:true});assert.equal(stale.spentMinor,70000);assert.equal(stale.stale,true);assert.equal(stale.canRemove,false);assert.ok(stale.error);
  assert.equal(JSON.parse(db.state.get('spend_cap:'+CAMPAIGN)).stale,true);
 } finally {globalThis.fetch=oldFetch;}
});

test('rejects a lifetime insight row with missing spend instead of converting it to zero',async()=>{
 const oldFetch=globalThis.fetch,{fetch}=metaFetch({spendMissing:true});globalThis.fetch=fetch;
 try {const result=await getSpendCap(environment(),CAMPAIGN,{fresh:true});assert.equal(result.level,'unavailable');assert.equal(result.spentMinor,null);}
 finally {globalThis.fetch=oldFetch;}
});

test('removes only the spend cap after exact confirmation and tolerates effective delivery changes',async()=>{
 const oldFetch=globalThis.fetch,{fetch,requests}=metaFetch({campaignCaps:['96500','922337203685478'],campaignEffectiveStatuses:['ACTIVE','PAUSED'],adsetEffectiveStatuses:['ACTIVE','CAMPAIGN_PAUSED']});globalThis.fetch=fetch;
 const db=database();
 try {
  const result=await removeSpendCap(environment(db),{campaignId:CAMPAIGN,expectedCapMinor:96500,confirmation:'REMOVE_CAMPAIGN_CAP'});
  assert.equal(result.capMinor,null);assert.equal(result.level,'uncapped');assert.equal(result.dailyBudgetMinor,14002);
  const write=requests.find(request=>request.method==='POST');
  assert.equal(write.url.pathname,'/v25.0/'+CAMPAIGN);
  assert.equal(write.init.headers.Authorization,'Bearer management-token');
  assert.equal(String(write.init.body),'spend_cap=922337203685478');
  assert.deepEqual([...new URLSearchParams(write.init.body).keys()],['spend_cap']);
  const audits=[...db.state.entries()].filter(([key])=>key.startsWith('spend_cap_audit:'));
  assert.equal(audits.length,1);assert.equal(JSON.parse(audits[0][1]).outcome,'removed');assert.equal(db.locks.size,0);
 } finally {globalThis.fetch=oldFetch;}
});

test('restricts mutation to the dedicated spend cap campaign even when another campaign is monitored',async()=>{
 const env={...environment(),META_CAMPAIGN_IDS:CAMPAIGN+',111'};
 await assert.rejects(removeSpendCap(env,{campaignId:'111',expectedCapMinor:96500,confirmation:'REMOVE_CAMPAIGN_CAP'}),error=>error instanceof SpendCapError&&error.status===403);
});

test('invalidates cached removal state and audits unverified when post-write guards change',async()=>{
 const oldFetch=globalThis.fetch,{fetch}=metaFetch({campaignCaps:['96500','922337203685478'],campaignStatuses:['ACTIVE','PAUSED']});globalThis.fetch=fetch;
 const key='spend_cap:'+CAMPAIGN,db=database({[key]:JSON.stringify({campaignId:CAMPAIGN,capMinor:96500,canRemove:true,checkedAt:new Date().toISOString(),stale:false})});
 try {
  await assert.rejects(removeSpendCap(environment(db),{campaignId:CAMPAIGN,expectedCapMinor:96500,confirmation:'REMOVE_CAMPAIGN_CAP'}),error=>error instanceof SpendCapError&&error.status===502);
  assert.equal(db.state.has(key),false);
  const audits=[...db.state.entries()].filter(([auditKey])=>auditKey.startsWith('spend_cap_audit:'));
  assert.equal(JSON.parse(audits[0][1]).outcome,'unverified');
 } finally {globalThis.fetch=oldFetch;}
});

test('rejects stale expected caps and malformed or unregistered requests before mutation',async()=>{
 const oldFetch=globalThis.fetch,{fetch,requests}=metaFetch();globalThis.fetch=fetch;
 try {
  await assert.rejects(removeSpendCap(environment(),{campaignId:CAMPAIGN,expectedCapMinor:90000,confirmation:'REMOVE_CAMPAIGN_CAP'}),error=>error instanceof SpendCapError&&error.status===409);
  assert.equal(requests.some(request=>request.method==='POST'),false);
  await assert.rejects(removeSpendCap(environment(),{campaignId:CAMPAIGN,expectedCapMinor:96500,confirmation:'REMOVE_CAMPAIGN_CAP',status:'PAUSED'}),/Invalid spend cap removal/);
  await assert.rejects(removeSpendCap(environment(),{campaignId:'999',expectedCapMinor:96500,confirmation:'REMOVE_CAMPAIGN_CAP'}),error=>error.status===404);
 } finally {globalThis.fetch=oldFetch;}
});

test('worker requires authentication and same-origin mutation requests',async()=>{
 const unauthenticated=await worker.fetch(new Request('https://dashboard.example/api/spend-cap?campaign='+CAMPAIGN),{},{waitUntil(){}});
 assert.equal(unauthenticated.status,401);
 const crossOrigin=await worker.fetch(new Request('http://localhost/api/spend-cap/remove',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'}),{LOCAL_PREVIEW:'true'},{waitUntil(){}});
 assert.equal(crossOrigin.status,403);assert.deepEqual(await crossOrigin.json(),{error:'Invalid origin'});
});
