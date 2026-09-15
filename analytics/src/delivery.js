import {graph,ids,setState} from './meta.js';
export function deliveryFor(state,key,id) {
 let rows=[];try{rows=JSON.parse(state.delivery_inventory||'[]');}catch{}
 const row=rows.find(r=>r.kind===key&&r.id===id);
 const stale=!state.delivery_success||!!state.delivery_error||Date.now()-Date.parse(state.delivery_success)>7200000;
 const status=row?.effective_status||'UNKNOWN';
 return {delivery_status:status,delivery_label:status==='CAMPAIGN_PAUSED'?'Campaign paused':status==='ADSET_PAUSED'?'Ad set paused':status==='PAUSED'?'Paused':status==='ACTIVE'?'Active':status.replaceAll('_',' ').toLowerCase(),delivery_paused:['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED'].includes(status),delivery_stale:stale,delivery_checked_at:state.delivery_success||null};
}
export async function syncDelivery(env) {
 try {
  const prior=await env.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first();
  const campaigns=ids({...env,META_CAMPAIGN_IDS:env.META_CAMPAIGN_IDS||prior?.value});
  const rows=[];
  for(const campaign of campaigns){
   const c=await graph(env,campaign,{fields:'id,name,status,effective_status'});
   rows.push({...c,kind:'campaign_id'});
   for(const [edge,kind] of [['adsets','adset_id'],['ads','ad_id']]){
    let after='';
    for(let page=0;page<20;page++){
     const d=await graph(env,campaign+'/'+edge,{fields:kind==='adset_id'?'id,name,status,effective_status,daily_budget,promoted_object,learning_stage_info':'id,name,status,effective_status,adset_id',limit:100,...(after?{after}:{})});
     rows.push(...(d.data||[]).map(r=>({...r,campaign_id:campaign,kind,effective_status:c.effective_status==='PAUSED'?'CAMPAIGN_PAUSED':r.effective_status})));
     if(!d.paging?.next)break;
     after=d.paging.cursors?.after;if(!after||page===19)throw Error('Delivery status pagination incomplete.');
    }
   }
  }
  await env.DB.batch([env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('delivery_inventory',JSON.stringify(rows)),env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('delivery_success',new Date().toISOString()),env.DB.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('delivery_error','')]);
 }catch{await setState(env,'delivery_error','Could not refresh Meta delivery status. Showing the last known status.');}
}
