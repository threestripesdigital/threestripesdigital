import {syncMeta,dayIn,setState} from './meta.js';
import {syncFunnel} from './funnel.js';
import {syncGA4,syncWistia} from './sources.js';
import {report} from './report.js';
import {authorized,cookie,equal,limited,readBody} from './auth.js';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
async function assets(env,request,path) {const u=new URL(request.url);if(path)u.pathname=path;return env.ASSETS.fetch(new Request(u,request));}
async function runSync(env) {
 const outcomes=await Promise.allSettled([syncMeta(env),syncFunnel(env),syncGA4(env),syncWistia(env)]);
 await env.DB.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(Date.now()).run();
 if(outcomes.some(x=>x.status==='rejected')) console.log('reporting_sync_failed');
}
async function route(req,env,ctx) {
 const url=new URL(req.url),path=url.pathname;
 if(path==='/health') return json({ok:true,service:'rank-boost-analytics'});
 if(path==='/login'&&req.method==='GET') return assets(env,req,'/login.html');
 if(path==='/login'&&req.method==='POST') {
  if(req.headers.get('Origin')!==url.origin)return json({error:'Invalid origin'},403);
  if(await limited(env,'login:'+req.headers.get('CF-Connecting-IP'),10,900))return json({error:'Too many attempts. Try again in 15 minutes.'},429);
  const body=await readBody(req);
  if(!env.DASHBOARD_PASSWORD||typeof body.password!=='string'||!await equal(body.password,env.DASHBOARD_PASSWORD))return json({error:'Incorrect password'},401);
  return json({ok:true},200,{'Set-Cookie':`rb_auth=${await cookie(env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`});
 }
 if(path==='/login.js'||path==='/style.css')return assets(env,req);
 // All reporting pages and APIs are private. Secrets are never returned to browsers.
 if(!await authorized(req,env))return path.startsWith('/api/')?json({error:'Sign in required'},401):Response.redirect(url.origin+'/login',302);
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==url.origin) return json({error:'Invalid origin'},403);
 if(path==='/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':'rb_auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
 if(path==='/api/report'&&req.method==='GET')return json(await report(env,url));
 if(path==='/api/sync'&&req.method==='POST') {
  if(await limited(env,'manual-sync',1,60))return json({error:'A sync was recently requested. Please wait one minute.'},429);
  ctx.waitUntil(runSync(env));return json({accepted:true},202);
 }
 if(path==='/api/calls'&&req.method==='POST') {
  const b=await readBody(req),old=await env.DB.prepare('SELECT * FROM calls WHERE id=?').bind(String(b.id||'')).first();
  if(!old)return json({error:'Call not found'},404);
  if(!['scheduled','showed','no_show','cancelled'].includes(b.status)||![null,0,1].includes(b.qualified))return json({error:'Invalid call outcome'},400);
  if(['showed','no_show'].includes(b.status)&&Date.parse(old.scheduled_at)>Date.now())return json({error:'Attendance can only be recorded after the scheduled start time'},400);
  if(typeof b.boosted!=='boolean'||typeof b.paid!=='boolean')return json({error:'Invalid boost or payment outcome'},400);
  if((b.boosted||b.paid)&&b.status!=='showed')return json({error:'Mark the call showed before recording boost or sale outcomes'},400);
  if(b.paid&&(!['rank_boost','premium'].includes(b.tier)||!Number.isFinite(b.monthly_retainer)||b.monthly_retainer<=0))return json({error:'A paid client requires a tier and positive monthly retainer'},400);
  const now=new Date().toISOString();
  await env.DB.prepare('UPDATE calls SET status=?,qualified=?,boosted_at=?,paid_at=?,tier=?,monthly_retainer=?,updated_at=?,outcome_updated_at=?,attendance_updated_at=?,qualification_updated_at=? WHERE id=?').bind(b.status,b.qualified,b.boosted?(old.boosted_at||now):null,b.paid?(old.paid_at||now):null,b.paid?b.tier:null,b.paid?b.monthly_retainer:null,now,now,b.status!==old.status?now:old.attendance_updated_at,b.qualified!==old.qualified?now:old.qualification_updated_at,old.id).run();
  return json({ok:true});
 }
 if(path==='/api/revenue'&&req.method==='POST') {
  const b=await readBody(req);
  if(typeof b.id!=='string'||!/^[-\w:.]{3,100}$/.test(b.id)||typeof b.call_id!=='string'||!Number.isFinite(b.amount)||Math.abs(b.amount)>1000000||b.currency!==env.CURRENCY||!Number.isFinite(Date.parse(b.paid_at))||Date.parse(b.paid_at)>Date.now()+60000) return json({error:'Invalid payment. Use an invoice ID, valid date and account currency.'},400);
  const call=await env.DB.prepare('SELECT paid_at FROM calls WHERE id=?').bind(b.call_id).first();
  if(!call?.paid_at)return json({error:'Record the paying client before recording collected revenue'},400);
  const old=await env.DB.prepare('SELECT call_id FROM revenue WHERE id=?').bind(b.id).first();
  if(old&&old.call_id!==b.call_id)return json({error:'Invoice ID belongs to another call'},409);
  const paid=new Date(b.paid_at).toISOString();
  await env.DB.prepare('INSERT INTO revenue VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paid_at=excluded.paid_at,day=excluded.day,amount=excluded.amount').bind(b.id,b.call_id,paid,dayIn(paid,env.REPORTING_TIMEZONE),b.amount,b.currency).run();
  await setState(env,'revenue_success',new Date().toISOString());return json({ok:true});
 }
 if(path.startsWith('/api/')) return json({error:'Not found'},404);
 if(req.method!=='GET'&&req.method!=='HEAD')return json({error:'Method not allowed'},405);
 return assets(env,req,path==='/'?'/index.html':undefined);
}
export default {
 async fetch(req,env,ctx) {
  let response;
  try{response=await route(req,env,ctx);}catch(e){console.log('dashboard_request_failed',e instanceof SyntaxError?'invalid_json':'request_error');response=json({error:'Request failed. Check the input and service configuration.'},400);}
  const secured=new Response(response.body,response);
  secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','no-referrer');secured.headers.set('Cache-Control','no-store');
  secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return secured;
 },
 async scheduled(_event,env,ctx){ctx.waitUntil(runSync(env));}
};
