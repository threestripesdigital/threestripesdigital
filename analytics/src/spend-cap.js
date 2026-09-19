import {graph,ids,setState} from './meta.js';

const CACHE_MS=5*60*1000;
// Meta documents this int64 sentinel as the way to remove a campaign spend cap:
// https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
const NO_SPEND_CAP=922337203685478;
const CONFIRMATION='REMOVE_CAMPAIGN_CAP';

export class SpendCapError extends Error {
 constructor(message,status=400){super(message);this.status=status;}
}

const accountId=env=>String(env.META_ACCOUNT_ID||'').replace(/^act_/,'');
const cacheKey=id=>'spend_cap:'+id;
const safeError='Could not refresh the campaign spend cap from Meta.';
const removalCampaign=env=>/^\d+$/.test(env.META_SPEND_CAP_CAMPAIGN_ID||'')?env.META_SPEND_CAP_CAMPAIGN_ID:null;
const removalConfigured=(env,id)=>removalCampaign(env)===id&&!!env.META_MANAGEMENT_TOKEN;

function exactCampaign(env,id) {
 if(!/^\d+$/.test(String(id||''))||!ids(env).includes(String(id)))throw new SpendCapError('Campaign is not registered for spend cap monitoring.',404);
 return String(id);
}

async function state(env,key) {return (await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(key).first())?.value;}
async function cache(env,snapshot) {await setState(env,cacheKey(snapshot.campaignId),JSON.stringify(snapshot));}
function cachedSnapshot(raw) {try{const value=JSON.parse(raw);return value&&typeof value==='object'?value:null;}catch{return null;}}
function integer(value,label,{zero=true}={}) {
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<0||(!zero&&number===0))throw Error(`Invalid Meta ${label}`);
 return number;
}
function moneyMinor(value,label) {
 const number=Number(value);
 if(!Number.isFinite(number)||number<0)throw Error(`Invalid Meta ${label}`);
 return Math.round((number+Number.EPSILON)*100);
}
function capMinor(value) {
 if(value===undefined||value===null||value===''||String(value)==='0'||Number(value)===NO_SPEND_CAP)return null;
 return integer(value,'campaign spend cap',{zero:false});
}
function level(cap,spent) {
 if(cap===null)return 'uncapped';
 const percentage=spent/cap*100;
 return percentage>=100?'reached':percentage>=85?'urgent':percentage>=70?'warning':'normal';
}
function unavailable(env,id,error=safeError) {
 const rate=Number(env.META_USD_TO_ACCOUNT_RATE);
 return {campaignId:id,campaignName:null,currency:/^[A-Z]{3}$/.test(env.META_ACCOUNT_CURRENCY||'')?env.META_ACCOUNT_CURRENCY:null,reportingCurrency:/^[A-Z]{3}$/.test(env.CURRENCY||'')?env.CURRENCY:null,fxRate:Number.isFinite(rate)&&rate>0?rate:null,capMinor:null,spentMinor:null,remainingMinor:null,percentUsed:null,dailyBudgetMinor:null,daysRemainingAtBudget:null,level:'unavailable',checkedAt:null,stale:true,error,canRemove:false};
}
function publicSnapshot(value) {const {_guard,...snapshot}=value;return snapshot;}

async function adsets(env,campaign,campaignId) {
 const rows=[];let edge=campaign.adsets;
 for(let page=0;page<20;page++) {
  if(!Array.isArray(edge?.data))throw Error('Meta campaign ad set response incomplete');
  rows.push(...edge.data);
  if(!edge.paging?.next)break;
  const after=edge.paging?.cursors?.after;
  if(!after||page===19)throw Error('Meta campaign ad set pagination incomplete');
  edge=await graph(env,campaignId+'/adsets',{fields:'id,name,status,effective_status,daily_budget',limit:100,after});
 }
 return rows;
}

async function lifetimeSpend(env,campaignId) {
 let after='',total=0,seen=0;
 for(let page=0;page<5;page++) {
  const result=await graph(env,campaignId+'/insights',{fields:'campaign_id,spend',level:'campaign',date_preset:'maximum',limit:100,...(after?{after}:{})});
  if(!Array.isArray(result.data))throw Error('Meta lifetime insights response incomplete');
  for(const row of result.data) {
   if(row.campaign_id&&String(row.campaign_id)!==campaignId)throw Error('Unexpected campaign in Meta lifetime insights');
   total+=moneyMinor(row.spend,'lifetime spend');seen++;
  }
  if(!result.paging?.next)break;
  after=result.paging?.cursors?.after;
  if(!after||page===4)throw Error('Meta lifetime insights pagination incomplete');
 }
 return seen?total:0;
}

function exchangeRate(env,currency) {
 const reporting=String(env.CURRENCY||'');
 if(!/^[A-Z]{3}$/.test(reporting))throw Error('Invalid reporting currency');
 if(currency===reporting)return 1;
 const rate=Number(env.META_USD_TO_ACCOUNT_RATE);
 if(reporting!=='USD'||currency!==env.META_ACCOUNT_CURRENCY||!Number.isFinite(rate)||rate<=0||!/^\d{4}-\d{2}-\d{2}$/.test(env.META_FX_DATE||''))throw Error('Configure a dated account currency exchange rate');
 return rate;
}

export async function freshSpendCap(env,campaignId) {
 const id=exactCampaign(env,campaignId),account=accountId(env);
 if(!/^\d+$/.test(account)||!env.META_ACCESS_TOKEN)throw Error('Meta reporting access is not configured');
 const [accountInfo,campaign]=await Promise.all([
  graph(env,'act_'+account,{fields:'currency'}),
  graph(env,id,{fields:'id,name,account_id,spend_cap,status,effective_status,adsets.limit(100){id,name,status,effective_status,daily_budget}'})
 ]);
 if(String(campaign.id)!==id||String(campaign.account_id)!==account)throw Error('Meta campaign is outside the configured ad account');
 const currency=String(accountInfo.currency||'');
 if(!/^[A-Z]{3}$/.test(currency))throw Error('Invalid Meta account currency');
 const [sets,spent]=await Promise.all([adsets(env,campaign,id),lifetimeSpend(env,id)]);
 const cap=capMinor(campaign.spend_cap);
 const enabled=campaign.status==='ACTIVE'?sets.filter(row=>row.status==='ACTIVE'):[];
 const daily=enabled.reduce((sum,row)=>sum+integer(row.daily_budget||0,'ad set daily budget'),0);
 const remaining=cap===null?null:Math.max(0,cap-spent);
 const percentage=cap===null?null:Math.round(spent/cap*10000)/100;
 const checkedAt=new Date().toISOString();
 return {campaignId:id,campaignName:String(campaign.name||id),currency,reportingCurrency:String(env.CURRENCY),fxRate:exchangeRate(env,currency),capMinor:cap,spentMinor:spent,remainingMinor:remaining,percentUsed:percentage,dailyBudgetMinor:daily,daysRemainingAtBudget:cap!==null&&daily>0?Math.round(remaining/daily*100)/100:null,level:level(cap,spent),checkedAt,stale:false,error:null,canRemove:cap!==null&&removalConfigured(env,id),_guard:{campaignStatus:String(campaign.status||''),adsets:sets.map(row=>({id:String(row.id),status:String(row.status||''),dailyBudget:integer(row.daily_budget||0,'ad set daily budget')})).sort((a,b)=>a.id.localeCompare(b.id))}};
}

export async function getSpendCap(env,campaignId,{fresh=false}={}) {
 const id=exactCampaign(env,campaignId),raw=await state(env,cacheKey(id)),old=cachedSnapshot(raw);
 if(!fresh&&old&&!old.stale&&Date.now()-Date.parse(old.checkedAt)<=CACHE_MS)return {...old,canRemove:Number.isSafeInteger(old.capMinor)&&old.capMinor>0&&removalConfigured(env,id)};
 try {
  const result=publicSnapshot(await freshSpendCap(env,id));await cache(env,result);await setState(env,'spend_cap_error:'+id,'');return result;
 } catch(error) {
  await setState(env,'spend_cap_error:'+id,safeError);
  const fallback=old?{...old,stale:true,error:safeError,canRemove:false}:unavailable(env,id);
  await cache(env,fallback);return fallback;
 }
}

export async function syncSpendCaps(env) {
 const results=await Promise.allSettled(ids(env).map(id=>getSpendCap(env,id,{fresh:true})));
 if(results.some(result=>result.status==='rejected'))console.log('spend_cap_sync_failed');
 return results;
}

async function managementUpdate(env,campaignId) {
 if(!env.META_MANAGEMENT_TOKEN)throw new SpendCapError('Meta campaign management is not configured.',503);
 if(!/^v\d+\.0$/.test(env.META_API_VERSION||''))throw new SpendCapError('Meta campaign management is not configured.',503);
 const url=new URL(`https://graph.facebook.com/${env.META_API_VERSION}/${campaignId}`);
 const body=new URLSearchParams({spend_cap:String(NO_SPEND_CAP)});
 const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${env.META_MANAGEMENT_TOKEN}`,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)});
 const result=await response.json();
 if(!response.ok||result.error||result.success!==true)throw new SpendCapError('Meta did not confirm removal of the campaign spend cap.',502);
}

async function audit(env,key,value) {await setState(env,key,JSON.stringify(value));}

export async function removeSpendCap(env,input) {
 const keys=Object.keys(input||{}).sort();
 if(keys.join(',')!=='campaignId,confirmation,expectedCapMinor'||input.confirmation!==CONFIRMATION||!Number.isSafeInteger(input.expectedCapMinor)||input.expectedCapMinor<=0)throw new SpendCapError('Invalid spend cap removal confirmation.',400);
 const id=exactCampaign(env,input.campaignId);
 if(removalCampaign(env)!==id)throw new SpendCapError('Campaign is not configured for spend cap removal.',403);
 const owner=crypto.randomUUID(),now=Date.now();
 const lease=await env.DB.prepare("INSERT INTO locks VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires < ?").bind('spend-cap-remove:'+id,owner,now+120000,now).run();
 if(!lease.meta.changes)throw new SpendCapError('A spend cap change is already in progress.',409);
 const auditKey='spend_cap_audit:'+new Date().toISOString()+':'+crypto.randomUUID();
 let record={campaignId:id,requestedAt:new Date().toISOString(),expectedCapMinor:input.expectedCapMinor,outcome:'checking'},mutationSent=false;
 try {
  const before=await freshSpendCap(env,id);
  record={...record,before:publicSnapshot(before)};await audit(env,auditKey,record);
  if(before.capMinor===null)throw new SpendCapError('The campaign no longer has a spend cap.',409);
  if(before.capMinor!==input.expectedCapMinor)throw new SpendCapError('The campaign spend cap changed. Refresh before removing it.',409);
  if(!env.META_MANAGEMENT_TOKEN||!/^v\d+\.0$/.test(env.META_API_VERSION||''))throw new SpendCapError('Meta campaign management is not configured.',503);
  mutationSent=true;await managementUpdate(env,id);
  const after=await freshSpendCap(env,id);
  if(after.capMinor!==null)throw new SpendCapError('Meta accepted the request but the spend cap is still present.',502);
  if(JSON.stringify(after._guard)!==JSON.stringify(before._guard))throw new SpendCapError('Meta changed ad set delivery settings unexpectedly. Review the campaign in Ads Manager.',502);
  const snapshot=publicSnapshot(after);await cache(env,snapshot);
  record={...record,after:snapshot,outcome:'removed',completedAt:new Date().toISOString()};await audit(env,auditKey,record);
  return snapshot;
 } catch(error) {
  if(mutationSent)await env.DB.prepare('DELETE FROM state WHERE key=?').bind(cacheKey(id)).run();
  record={...record,outcome:mutationSent?'unverified':'failed',error:error instanceof SpendCapError?error.message:safeError,completedAt:new Date().toISOString()};
  await audit(env,auditKey,record);
  if(error instanceof SpendCapError)throw error;
  throw new SpendCapError(safeError,502);
 } finally {await env.DB.prepare("DELETE FROM locks WHERE key=? AND owner=?").bind('spend-cap-remove:'+id,owner).run();}
}
