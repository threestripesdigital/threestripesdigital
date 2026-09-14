import {graph,ids,setState,dayIn,shiftDay} from './meta.js';
export function timingCandidates(rows,call,timezone,campaigns) {
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(call.booked_at)));
 return rows.filter(r=>campaigns.includes(r.campaign_id)&&Number(r.inline_link_clicks)>0&&Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone).slice(0,2))===hour).map(r=>({adset_id:r.adset_id,name:r.adset_name,clicks:Number(r.inline_link_clicks)}));
}
export async function syncBookingTiming(env) {
 try {
  const since=shiftDay(dayIn(Date.now(),env.REPORTING_TIMEZONE),-6);
  const calls=(await env.DB.prepare("SELECT id,booked_at,booked_day FROM calls WHERE is_test=0 AND facebook_click=1 AND COALESCE(booking_source,'')!='meta' AND status!='cancelled' AND booked_day>=? ORDER BY booked_at DESC LIMIT 20").bind(since).all()).results;
  const prior=await env.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first();
  const campaigns=ids({...env,META_CAMPAIGN_IDS:env.META_CAMPAIGN_IDS||prior?.value});
  const evidence={},days=new Map();
  for(const call of calls){
   if(!days.has(call.booked_day)){
    const rows=[];let after='';
    for(let page=0;page<10;page++){
     const d=await graph(env,'act_'+env.META_ACCOUNT_ID.replace(/^act_/,'')+'/insights',{fields:'campaign_id,adset_id,adset_name,inline_link_clicks',level:'adset',time_range:JSON.stringify({since:call.booked_day,until:call.booked_day}),breakdowns:'hourly_stats_aggregated_by_advertiser_time_zone',filtering:JSON.stringify([{field:'campaign.id',operator:'IN',value:campaigns}]),limit:500,...(after?{after}:{})});
     rows.push(...d.data||[]);if(!d.paging?.next)break;after=d.paging.cursors?.after;if(!after||page===9)throw Error('Incomplete hourly report');
    }
    days.set(call.booked_day,rows);
   }
   evidence[call.id]={kind:'timing_candidates',candidates:timingCandidates(days.get(call.booked_day),call,env.REPORTING_TIMEZONE,campaigns),note:'Aggregate clicks in the booking hour, not a verified visitor match. The click may have happened earlier or later in that hour.',checkedAt:new Date().toISOString()};
  }
  await setState(env,'booking_timing',JSON.stringify(evidence));await setState(env,'booking_timing_success',new Date().toISOString());await setState(env,'booking_timing_error','');
 }catch{await setState(env,'booking_timing_error','Hourly click evidence could not be refreshed. No booking attribution was changed.');}
}
