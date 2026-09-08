import {validFunnelOrigin,verifyLeadToken,fromTrustedRouter} from './_security.js';
import {intake} from '../../../../analytics/src/intake.js';
import {limited,readBody} from '../../../../analytics/src/auth.js';
export async function onRequestPost({request,env}) {
 const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!validFunnelOrigin(request))return respond({error:'Forbidden origin'},403);
 if(!env.ANALYTICS_DB)return respond({error:'Analytics not configured'},503);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return respond({error:'JSON required'},415);
 const reporting={DB:env.ANALYTICS_DB,REPORTING_TIMEZONE:env.REPORTING_TIMEZONE||'America/New_York'};
 const ip=(fromTrustedRouter(request,env)?request.headers.get('X-Forwarded-Client-IP'):request.headers.get('CF-Connecting-IP'))||'unknown';
 try {
  if(await limited(reporting,'events:'+ip,120,60))return respond({error:'Rate limit'},429);
  const body=await readBody(request);
  const claims=body.kind==='link'?await verifyLeadToken(env.FUNNEL_SIGNING_KEY,body.lead_token):null;
  return respond(await intake(body,reporting,claims?.ref));
 }catch(error){
  const invalid=error instanceof SyntaxError||['Invalid session','Start a session first','Verified lead token required','Unknown event','Request too large','Missing body','Invalid body'].includes(error.message);
  return respond({error:invalid?'Invalid analytics event':'Analytics temporarily unavailable'},invalid?400:503);
 }
}
