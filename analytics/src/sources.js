import {dayIn,shiftDay,setState} from './meta.js';

const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function googleToken(env) {
 const account=JSON.parse(env.GA4_SERVICE_ACCOUNT);
 const now=Math.floor(Date.now()/1000);
 const message=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const pem=account.private_key.replace(/-----[^-]+-----|\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message));
 const jwt=message+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),signal:AbortSignal.timeout(20000)});
 const result=await r.json();
 if(!r.ok||!result.access_token)throw Error('Google reporting authentication failed. Check the saved service account.');
 return result.access_token;
}

export function ga4Request(start,end) {
 return {dateRanges:[{startDate:start,endDate:end}],metrics:[{name:'screenPageViews'},{name:'sessions'},{name:'activeUsers'}],dimensionFilter:{andGroup:{expressions:[
  {filter:{fieldName:'hostName',inListFilter:{values:['threestripesdigital.com','www.threestripesdigital.com']}}},
  {filter:{fieldName:'pagePath',stringFilter:{matchType:'FULL_REGEXP',value:'/rank-boost/law-firms(/.*)?'}}}
 ]}}};
}
export function ga4Values(result) {
 const row=result.rows?.[0];
 if(!row)return null;
 const values=Object.fromEntries(result.metricHeaders.map((h,i)=>[h.name,Number(row.metricValues[i]?.value)]));
 if(['screenPageViews','sessions','activeUsers'].some(k=>!Number.isFinite(values[k])||values[k]<0))throw Error('Google returned invalid reporting metrics.');
 return values;
}
export async function syncGA4(env) {
 if(!env.GA4_PROPERTY_ID||!env.GA4_SERVICE_ACCOUNT)return;
 try {
  if(!/^\d+$/.test(env.GA4_PROPERTY_ID))throw Error('Invalid Google Analytics property.');
  const token=await googleToken(env),end=dayIn(Date.now(),env.REPORTING_TIMEZONE),windows={};
  for(const days of [1,7,30,90]) {
   const start=shiftDay(end,1-days);
   const r=await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(ga4Request(start,end)),signal:AbortSignal.timeout(20000)});
   const result=await r.json();
   if(!r.ok)throw Error(`Google Analytics reporting failed (${r.status}). Check property access and API permissions.`);
   if(result.metadata?.timeZone!==env.REPORTING_TIMEZONE)throw Error('Google Analytics timezone does not match the dashboard.');
   windows[days]={start,end,values:ga4Values(result),thresholded:!!result.metadata?.subjectToThresholding};
  }
  // Replace all windows together. A failed request preserves the prior snapshot.
  await setState(env,'ga4_snapshot',JSON.stringify({property:env.GA4_PROPERTY_ID,windows}));
  await setState(env,'ga4_success',new Date().toISOString());await setState(env,'ga4_error','');
 }catch(e){await setState(env,'ga4_error',e.message?.startsWith('Google')?e.message:'Google Analytics import failed. Check the reporting configuration.');}
}

export function wistiaValues(result) {
 const values={};
 for(const key of ['plays','unique_plays','unique_loads','unique_visitors','played_time']) {
  if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<0)throw Error('Wistia returned invalid counts.');
  values[key]=result[key];
 }
 for(const key of ['play_rate','engagement_rate']) {
  const value=result[key];
  if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1))throw Error('Wistia returned an invalid rate.');
  values[key]=value===null?null:value*100;
 }
 return values;
}
export async function syncWistia(env) {
 if(!env.WISTIA_API_TOKEN||!env.WISTIA_MEDIA_ID)return;
 try {
  if(!/^[a-z0-9]{10}$/.test(env.WISTIA_MEDIA_ID))throw Error('Wistia media ID is invalid.');
  const end=dayIn(Date.now(),env.REPORTING_TIMEZONE),windows={};
  for(const days of [1,7,30,90]) {
   const start=shiftDay(end,1-days),exclusiveEnd=shiftDay(end,1);
   const url=new URL(`https://api.wistia.com/modern/analytics/medias/${env.WISTIA_MEDIA_ID}`);
   url.searchParams.set('start_date',start);url.searchParams.set('end_date',exclusiveEnd);
   const r=await fetch(url,{headers:{Authorization:'Bearer '+env.WISTIA_API_TOKEN,'X-Wistia-API-Version':'2026-07'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error(`Wistia reporting failed (${r.status}). Check Read detailed stats permission and media access.`);
   windows[days]={start,end,values:wistiaValues(await r.json())};
  }
  await setState(env,'wistia_snapshot',JSON.stringify({media:env.WISTIA_MEDIA_ID,windows}));
  await setState(env,'wistia_success',new Date().toISOString());await setState(env,'wistia_error','');
 }catch(e){await setState(env,'wistia_error',e.message?.startsWith('Wistia')?e.message:'Wistia import failed. Check the reporting configuration.');}
}

export function sourceReport(env,state,days,end) {
 let snapshot;try{snapshot=JSON.parse(state.ga4_snapshot||'null');}catch{}
 const window=snapshot?.property===env.GA4_PROPERTY_ID?snapshot?.windows?.[days]:null;
 let video;try{video=JSON.parse(state.wistia_snapshot||'null');}catch{}
 const videoWindow=video?.media===env.WISTIA_MEDIA_ID?video?.windows?.[days]:null;
 const videoStale=!state.wistia_success||Date.now()-Date.parse(state.wistia_success)>7200000||videoWindow?.end!==end;
 return {
  browserTracking:env.BROWSER_TRACKING_ENABLED!=='false',
  ga4:{configured:!!env.GA4_PROPERTY_ID&&!!env.GA4_SERVICE_ACCOUNT,property:env.GA4_PROPERTY_ID||null,lastSync:state.ga4_success||null,error:state.ga4_error||null,stale:!state.ga4_success||Date.now()-Date.parse(state.ga4_success)>7200000||window?.end!==end,window:window||null},
  wistia:{connected:!!env.WISTIA_API_TOKEN&&!!state.wistia_success&&!state.wistia_error&&!videoStale,lastSync:state.wistia_success||null,error:state.wistia_error||null,stale:videoStale,window:videoWindow||null,media:env.WISTIA_MEDIA_ID||null,message:state.wistia_error||(state.wistia_success?'Direct Wistia report for the main VSL, across all embed locations and traffic sources. Includes prelaunch activity. Average engagement is not the percentage of viewers who watched half the video.':'Waiting for a direct Wistia reporting import.')},
  posthog:{connected:false,message:'No Three Stripes project was found in the available PostHog account. It is optional when GA4 supplies site reporting.'}
 };
}
