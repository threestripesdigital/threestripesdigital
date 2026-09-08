// User-supplied strategy thresholds, not independently validated market benchmarks.
export const rules = [
 ['cpm','CPM','money','low',35,50,'Test a different creative hook. Review relevance before changing broad targeting.'],
 ['ctr','Link CTR','percent','high',1,.7,'Test new hooks that speak directly to practicing lawyers.'],
 ['cpc','Link CPC','money','low',3,5,'Check CPM and link CTR to isolate creative cost versus a weak hook.'],
 ['play','VSL play rate','percent','high',40,25,'Improve the video thumbnail and the headline above the VSL.'],
 ['retention','VSL 50% retention','percent','high',50,30,'Review the opening promise and shorten the middle of the VSL.'],
 ['application','Application completion','percent','high',60,40,'Reduce manual questions and check form errors on mobile.'],
 ['conversion','Visitor to booked call','percent','high',3,1.5,'Inspect play rate, VSL retention, application completion and scheduler drop-off.'],
 ['scheduled_cost','Cost per booked call','money','low',120,200,'If CPM and CTR are healthy, diagnose the landing page and scheduler.'],
 ['qualified_rate','Qualified rate','percent','high',null,null,'Review sales fit on each booking. No benchmark has been set for this metric.'],
 ['qualified_cost','Cost per qualified call','money','low',150,250,'Make the creative explicitly qualify law firms and practicing attorneys.'],
 ['showed_cost','Cost per showed call','money','low',200,300,'Check the confirmation page, calendar invitation and reminder delivery.'],
 ['show','Show rate','percent','high',65,50,'Improve confirmation videos and the pre-call email and SMS sequence.'],
 ['close','Close rate','percent','high',25,15,'Review call quality, offer fit and the sales conversation.'],
 ['boost','Free boost execution','percent','high',80,50,'Make the free boost the next concrete step on qualified calls.'],
 ['boost_paid','Boost to paid','percent','high',40,20,'Check keyword movement and send the before/after follow-up within 48 hours.'],
 ['cac','Customer acquisition cost','money','low',1000,2000,'Inspect the full funnel and cost per paying client. Rank Boost target shown; Premium target is $1,500.'],
 ['roas','Collected revenue ROAS','ratio','high',3,1.5,'Review collected revenue and acquisition costs over 90 days. Revenue is not profit.'],
 ['payback','Revenue payback','months','low',1,2,'Review CAC relative to average new-client monthly retainer revenue.']
].map(([key,label,format,direction,good,bad,action])=>({key,label,format,direction,good,bad,midpoint:good===null?null:(good+bad)/2,action}));
export function divide(a,b,m=1) { return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a/b*m : null; }
export function classify(value,rule) {
 if(value === null || !Number.isFinite(value)) return 'waiting';
 if(rule.good===null||rule.bad===null)return 'unrated';
 if(rule.direction==='low') return value<=rule.good?'good':value>=rule.bad?'bad':'ok';
 return value>=rule.good?'good':value<rule.bad?'bad':'ok';
}
export function learning(launch, now=Date.now()) {
 const started=Date.parse(launch); const elapsed=Number.isFinite(started)?Math.max(0,now-started):0;
 return {startedAt:Number.isFinite(started)?new Date(started).toISOString():null, locked:!Number.isFinite(started)||elapsed<7*86400000, day:Number.isFinite(started)?Math.floor(elapsed/86400000)+1:0, unlockAt:Number.isFinite(started)?new Date(started+7*86400000).toISOString():null};
}
export function score(values, samples, hold) {
 return rules.map(rule=>{ const value=values[rule.key]??null; const status=classify(value,rule);
 return {...rule,value,status,sample:samples[rule.key]??0,recommendation: status==='bad'?(hold.locked?'Observe only. Revisit after the seven-day hold. '+rule.action:rule.action):status==='waiting'?'Waiting for a measured denominator.':'Keep observing the trend.'}; });
}
export function adMetrics(row) {return {...row,cpm:divide(row.spend,row.impressions,1000),ctr:divide(row.link_clicks,row.impressions,100),cpc:divide(row.spend,row.link_clicks)};}
