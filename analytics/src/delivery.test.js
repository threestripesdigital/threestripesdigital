import test from 'node:test';
import assert from 'node:assert/strict';
import {syncDelivery} from './delivery.js';

function database(prior='1') {
 const state=new Map([['meta_campaign_ids',prior],['delivery_inventory','old inventory'],['delivery_success','old success']]);
 let batches=0;
 return {state,get batches(){return batches;},prepare(sql){return{async first(){return{value:state.get('meta_campaign_ids')};},bind(...values){return{
  async first(){return{value:state.get('meta_campaign_ids')};},
  async run(){state.set(values[0],String(values[1]));}
 };}};},async batch(statements){batches++;for(const statement of statements)await statement.run();}};
}

test('delivery sync uses nested inventory and follows a bounded edge cursor',async()=>{
 const db=database(),requests=[],oldFetch=globalThis.fetch;
 try{
  globalThis.fetch=async input=>{
   const url=new URL(input);requests.push(url);
   if(url.pathname.endsWith('/1/adsets'))return Response.json({data:[{id:'12',name:'Second set',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'7001'}]});
   if(url.pathname.endsWith('/1/ads'))return Response.json({data:[{id:'22',name:'Second ad',status:'ACTIVE',effective_status:'ACTIVE',adset_id:'12'}]});
   return Response.json({id:'1',name:'Campaign',status:'ACTIVE',effective_status:'ACTIVE',adsets:{data:[{id:'11',name:'First set',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'7001'}],paging:{next:'next',cursors:{after:'set-cursor'}}},ads:{data:[{id:'21',name:'First ad',status:'ACTIVE',effective_status:'ACTIVE',adset_id:'11'}],paging:{next:'next',cursors:{after:'ad-cursor'}}}});
  };
  await syncDelivery({DB:db,META_API_VERSION:'v25.0',META_ACCESS_TOKEN:'test-only'});
  assert.equal(requests.length,3);
  assert.match(requests[0].searchParams.get('fields'),/adsets\.limit\(100\).*ads\.limit\(100\)/);
  assert.equal(requests[1].pathname,'/v25.0/1/adsets');
  assert.equal(requests[1].searchParams.get('after'),'set-cursor');
  assert.equal(requests[1].searchParams.get('fields'),'id,name,status,effective_status,daily_budget');
  assert.equal(requests[2].pathname,'/v25.0/1/ads');
  assert.equal(requests[2].searchParams.get('after'),'ad-cursor');
  assert.equal(requests[2].searchParams.get('fields'),'id,name,status,effective_status,adset_id');
  const inventory=JSON.parse(db.state.get('delivery_inventory'));
  assert.deepEqual(inventory.map(row=>[row.kind,row.id]),[['campaign_id','1'],['adset_id','11'],['adset_id','12'],['ad_id','21'],['ad_id','22']]);
  assert.equal(db.state.get('delivery_error'),'');
  assert.equal(db.batches,1);
 }finally{globalThis.fetch=oldFetch;}
});

test('delivery sync preserves the last good inventory when a paginated read is incomplete',async()=>{
 const db=database(),requests=[],oldFetch=globalThis.fetch;
 try{
  globalThis.fetch=async input=>{
   requests.push(new URL(input));
   if(requests.length===2)return Response.json({});
   return Response.json({id:'1',name:'Campaign',status:'ACTIVE',effective_status:'ACTIVE',adsets:{data:[{id:'11',status:'ACTIVE',effective_status:'ACTIVE'}],paging:{next:'next',cursors:{after:'cursor'}}},ads:{data:[]}});
  };
  await syncDelivery({DB:db,META_API_VERSION:'v25.0',META_ACCESS_TOKEN:'test-only'});
  assert.equal(requests.length,2);
  assert.equal(db.state.get('delivery_inventory'),'old inventory');
  assert.equal(db.state.get('delivery_success'),'old success');
  assert.equal(db.state.get('delivery_error'),'Could not refresh Meta delivery status. Showing the last known status.');
  assert.equal(db.batches,0);
 }finally{globalThis.fetch=oldFetch;}
});
