import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {rules,classify,divide,learning} from '../../../analytics/src/metrics.js';
import {intake} from '../../../analytics/src/intake.js';
import {report} from '../../../analytics/src/report.js';
import {syncMeta,dayIn} from '../../../analytics/src/meta.js';
import {syncFunnel} from '../../../analytics/src/funnel.js';
import worker from '../../../analytics/src/worker.js';
import {cookie,authorized} from '../../../analytics/src/auth.js';
test('disabled browser collection does not present old events as an active connection',async()=>{
 const e=env();e.BROWSER_TRACKING_ENABLED='false';
 await e.DB.prepare('INSERT INTO state VALUES(?,?)').bind('event_success',new Date().toISOString()).run();
 const r=await report(e,new URL('https://dashboard.test/api/report'));
 assert.equal(r.setup.events,false);assert.equal(r.sources.browserTracking,false);
 assert.ok(r.metrics.slice(3).every(m=>m.value===null&&m.status==='waiting'));
 assert.ok(r.alerts.some(a=>a.title==='Direct source reporting'));
});
function database(migrate=true){
 const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');
 if(migrate)for(const file of ['0001.sql','0002.sql','0003.sql','0004.sql'])raw.exec(readFileSync(new URL('../../../analytics/migrations/'+file,import.meta.url),'utf8'));
 const api={raw,prepare(sql){let args=[];const stmt={bind(...a){args=a;return stmt;},async run(){const result=raw.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};},async first(){return raw.prepare(sql).get(...args)||null;},async all(){return {results:raw.prepare(sql).all(...args)};}};return stmt;},async batch(statements){raw.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());raw.exec('COMMIT');return values;}catch(e){raw.exec('ROLLBACK');throw e;}}};return api;
}
function env(){return {CALENDLY_EVENT_TYPE_URI:'boost-type',DB:database(),REPORTING_TIMEZONE:'America/New_York',CURRENCY:'USD',DAILY_BUDGET:'100',LAUNCH_AT:'2026-01-01T00:00:00.000Z',META_CAMPAIGN_IDS:'111',META_ACCOUNT_ID:'123',META_API_VERSION:'v25.0'};}
const sid='10000000-0000-4000-8000-000000000001';
test('threshold boundaries, midpoints and missing denominators',()=>{const cpm=rules[0];assert.equal(cpm.midpoint,42.5);assert.equal(classify(35,cpm),'good');assert.equal(classify(42.5,cpm),'ok');assert.equal(classify(50,cpm),'bad');assert.equal(classify(null,cpm),'waiting');assert.equal(classify(.7,rules[1]),'ok');assert.equal(classify(.69,rules[1]),'bad');assert.equal(divide(5,0),null);assert.equal(divide(null,5),null);});
test('seven full days are required, prelaunch never unlocks',()=>{const start=Date.parse('2026-01-01T12:00:00Z');assert.equal(learning('',start).locked,true);assert.equal(learning(new Date(start).toISOString(),start+7*86400000-1).locked,true);assert.equal(learning(new Date(start).toISOString(),start+7*86400000).locked,false);});
test('session and event replays deduplicate; application completion needs verified lead',async()=>{const e=env();const body={kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'};await intake(body,e);await intake(body,e);await intake({kind:'vsl_play',session_id:sid},e);await intake({kind:'vsl_play',session_id:sid},e);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM sessions').first()).n,1);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM events').first()).n,2);await assert.rejects(intake({kind:'link',session_id:sid},e));await assert.rejects(intake({kind:'application_complete',session_id:sid},e));await intake({kind:'link',session_id:sid},e,'lead-1');assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM events WHERE kind='application_complete'").first()).n,1);});
test('weighted ad totals, scope filtering, future calls and zero data',async()=>{const e=env(),today=dayIn(Date.now(),e.REPORTING_TIMEZONE);e.DB.raw.prepare('INSERT INTO meta_daily VALUES(?,?,?,?,?,?,?,?,?)').run(today,'222','Hook one','333','111','Rank Boost',30,1000,10);e.DB.raw.prepare('INSERT INTO meta_daily VALUES(?,?,?,?,?,?,?,?,?)').run(today,'223','Hook two','333','111','Rank Boost',10,100,0);e.DB.raw.prepare('INSERT INTO meta_daily VALUES(?,?,?,?,?,?,?,?,?)').run(today,'999','Other','333','999','Other',10000,1,0);await intake({kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'},e);const now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();e.DB.raw.prepare('INSERT INTO calls(id,session_id,booked_at,booked_day,scheduled_at,scheduled_day,status,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('call1',sid,now,today,future,today,'scheduled',now);const r=await report(e,new URL('https://local/api/report?days=7'));assert.equal(r.totals.spend,40);assert.equal(r.metrics.find(m=>m.key==='cpm').value,40/1100*1000);assert.equal(r.metrics.find(m=>m.key==='show').value,null);assert.equal(r.totals.booked,1);const empty=await report(e,new URL('https://local/api/report?campaign=999'));assert.equal(empty.totals.spend,0);});
test('Meta pagination, correction replacement, stable learning start, failure preserves snapshot',async()=>{const e=env();e.META_ACCESS_TOKEN='test-only';const today=dayIn(Date.now(),e.REPORTING_TIMEZONE);const original=globalThis.fetch;let fail=false,spend='30';globalThis.fetch=async(url)=>{if(fail)return Response.json({error:{code:190}},{status:401});const u=new URL(url);if(!u.pathname.endsWith('/insights'))return Response.json({name:'Test',currency:'USD',timezone_name:e.REPORTING_TIMEZONE});if(u.searchParams.get('after'))return Response.json({data:[]});return Response.json({data:[{date_start:today,ad_id:'222',ad_name:'Test',adset_id:'333',campaign_id:'111',campaign_name:'Rank Boost',spend,impressions:'1000',inline_link_clicks:'10'}],paging:{next:'ignored-untrusted-url',cursors:{after:'cursor'}}});};try{await syncMeta(e);const start=(await e.DB.prepare("SELECT value FROM state WHERE key='launch_at'").first()).value;spend='40';await syncMeta(e);assert.equal((await e.DB.prepare('SELECT SUM(spend) n FROM meta_daily').first()).n,40);assert.equal((await e.DB.prepare("SELECT value FROM state WHERE key='launch_at'").first()).value,start);fail=true;await assert.rejects(syncMeta(e));assert.equal((await e.DB.prepare('SELECT SUM(spend) n FROM meta_daily').first()).n,40);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM locks').first()).n,0);}finally{globalThis.fetch=original;}});
test('private routes fail closed; cookies work; remote preview does not bypass auth; CSRF blocks edits',async()=>{const e=env();e.DASHBOARD_PASSWORD='test-only-password';const ctx={waitUntil(){}};assert.equal((await worker.fetch(new Request('https://local/api/report'),e,ctx)).status,401);e.LOCAL_PREVIEW='true';assert.equal(await authorized(new Request('https://public.example/api/report'),e),false);const token=await cookie(e);const req=new Request('https://local/api/report',{headers:{Cookie:'rb_auth='+token}});assert.equal(await authorized(req,e),true);assert.equal((await worker.fetch(new Request('https://local/api/sync',{method:'POST',headers:{Cookie:'rb_auth='+token,Origin:'https://foreign.example'},body:'{}'}),e,ctx)).status,403);});
test('booking import links verified lead and preserves manual outcomes on replay',async()=>{const e=env();e.LEADS_DB=database(false);e.LEADS_DB.raw.exec("CREATE TABLE leads(lead_ref TEXT,qualified INTEGER);CREATE TABLE calendly_invitees(invitee_uri TEXT,lead_ref TEXT,scheduled_start_at TEXT,status TEXT,created_at TEXT,event_type_uri TEXT DEFAULT 'boost-type');");await intake({kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'},e);await intake({kind:'link',session_id:sid},e,'lead-1');e.LEADS_DB.raw.exec("INSERT INTO leads VALUES('lead-1',1);INSERT INTO calendly_invitees(invitee_uri,lead_ref,scheduled_start_at,status,created_at) VALUES('call1','lead-1','2026-09-01T12:00:00Z','booked','2026-08-31 10:00:00');");await syncFunnel(e);assert.equal((await e.DB.prepare('SELECT session_id FROM calls').first()).session_id,sid);e.DB.raw.exec("UPDATE calls SET status='showed',qualified=0,attendance_updated_at='2026-09-01T13:00:00Z',outcome_updated_at='2026-09-01T13:00:00Z'");await syncFunnel(e);const c=await e.DB.prepare('SELECT * FROM calls').first();assert.equal(c.status,'showed');assert.equal(c.qualified,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM calls').first()).n,1);});
test('revenue is idempotent and call outcome requires an actual showed call',async()=>{const e=env();e.LOCAL_PREVIEW='true';const now=new Date().toISOString(),day=dayIn(now,e.REPORTING_TIMEZONE);await intake({kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'},e);e.DB.raw.prepare('INSERT INTO calls(id,session_id,booked_at,booked_day,scheduled_at,scheduled_day,status,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('call1',sid,now,day,now,day,'scheduled',now);const post=(path,b)=>worker.fetch(new Request('http://localhost'+path,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(b)}),e,{waitUntil(){}});const sale={id:'call1',status:'scheduled',qualified:1,boosted:true,paid:true,tier:'rank_boost',monthly_retainer:1500};assert.equal((await post('/api/calls',sale)).status,400);sale.status='showed';assert.equal((await post('/api/calls',sale)).status,200);const payment={id:'invoice-1',call_id:'call1',amount:1500,currency:'USD',paid_at:now};assert.equal((await post('/api/revenue',payment)).status,200);assert.equal((await post('/api/revenue',payment)).status,200);assert.equal((await e.DB.prepare('SELECT SUM(amount) amount FROM revenue').first()).amount,1500);payment.id='refund-1';payment.amount=-100;await post('/api/revenue',payment);assert.equal((await e.DB.prepare('SELECT SUM(amount) amount FROM revenue').first()).amount,1400);});
test('campaign discovery selects Rank Boost only and remembers discovered IDs',async()=>{const e=env();e.META_ACCESS_TOKEN='test-only';e.META_CAMPAIGN_IDS='';e.META_CAMPAIGN_PREFIX='Rank Boost';const original=globalThis.fetch;let seen;globalThis.fetch=async(url)=>{const u=new URL(url);if(u.pathname.endsWith('/campaigns'))return Response.json({data:[{id:'111',name:'Rank Boost | Lawyers | VSL'},{id:'999',name:'Unrelated campaign'}]});if(u.pathname.endsWith('/insights')){seen=JSON.parse(u.searchParams.get('filtering'));return Response.json({data:[]});}return Response.json({name:'Test account',currency:'USD',timezone_name:e.REPORTING_TIMEZONE});};try{await syncMeta(e);assert.deepEqual(seen[0].value,['111']);assert.equal((await e.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first()).value,'111');}finally{globalThis.fetch=original;}});
function trackerHarness(search='?campaign_id=111&ad_id=222', storage=new Map()) {
 const sent=[],listeners={},player={tagName:'WISTIA-PLAYER',currentTime:0,duration:100,percentWatched:0,addEventListener(n,fn){listeners[n]=fn;}};
 const context={navigator:{},location:{href:'https://threestripesdigital.com/rank-boost/law-firms/'+search,search},URL,URLSearchParams,crypto,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},window:{addEventListener(){}},document:{querySelector(){return null;},querySelectorAll(selector){assert.equal(selector,'.hero-vsl video,.hero-vsl wistia-player');return [player];},addEventListener(){}},fetch:async(_url,opts)=>{sent.push(JSON.parse(opts.body));return {ok:true};},setInterval(){return 1;},setTimeout(){return 1;},clearInterval(){}};
 return {context,sent,listeners,player};
}
test('Wistia counts actual watched percentage, ignores seeks and deduplicates replay',async()=>{
 const {runInNewContext}=await import('node:vm'),h=trackerHarness();
 runInNewContext(readFileSync(new URL('../../../analytics/public/tracker.js',import.meta.url),'utf8'),h.context);
 assert.equal(h.listeners['time-update'],undefined);h.listeners.play();
 h.player.currentTime=90;h.listeners['percent-watched-change']();
 await h.context.window.rankBoostAnalytics.track('scheduler_open');
 assert.deepEqual(h.sent.map(e=>e.kind),['session','vsl_play','scheduler_open']);
 h.player.percentWatched=.5;h.listeners['percent-watched-change']();h.listeners['percent-watched-change']();h.listeners.play();
 await h.context.window.rankBoostAnalytics.track('vsl_50');
 assert.deepEqual(h.sent.map(e=>e.kind),['session','vsl_play','scheduler_open','vsl_25','vsl_50']);
 assert.equal(readFileSync(new URL('../../../analytics/public/tracker.js',import.meta.url),'utf8'),readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8'));
});
test('fresh organic visits and persistent internal browser exclusion do not emit paid events',async()=>{
 const {runInNewContext}=await import('node:vm'),code=readFileSync(new URL('../../../analytics/public/tracker.js',import.meta.url),'utf8'),storage=new Map();
 for(const search of ['', '?campaign_id=111&ad_id=222&rb_internal=1','?campaign_id=111&ad_id=222']){
  const h=trackerHarness(search,storage);runInNewContext(code,h.context);assert.equal(h.context.window.rankBoostAnalytics,undefined);assert.equal(h.sent.length,0);
 }
 const h=trackerHarness('?campaign_id=111&ad_id=222&rb_internal=0',storage);runInNewContext(code,h.context);await h.context.window.rankBoostAnalytics.track('session');assert.equal(h.sent.length,1);
});
test('qualification defaults unknown and manual qualification does not block attendance sync',async()=>{
 const e=env();e.LOCAL_PREVIEW='true';e.LEADS_DB=database(false);e.LEADS_DB.raw.exec("CREATE TABLE leads(lead_ref TEXT,qualified INTEGER);CREATE TABLE calendly_invitees(invitee_uri TEXT,lead_ref TEXT,scheduled_start_at TEXT,status TEXT,created_at TEXT,event_type_uri TEXT DEFAULT 'boost-type');INSERT INTO leads VALUES('lead-1',1);INSERT INTO calendly_invitees(invitee_uri,lead_ref,scheduled_start_at,status,created_at) VALUES('call1','lead-1','2026-09-01T12:00:00Z','booked','2026-08-31 10:00:00');");
 await syncFunnel(e);let c=await e.DB.prepare('SELECT * FROM calls').first();assert.equal(c.qualified,null);assert.equal(c.keyword_qualified,1);
 const response=await worker.fetch(new Request('http://localhost/api/calls',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({id:'call1',status:'scheduled',qualified:0,boosted:false,paid:false})}),e,{});assert.equal(response.status,200);
 e.LEADS_DB.raw.exec("UPDATE calendly_invitees SET status='no_show'");await syncFunnel(e);c=await e.DB.prepare('SELECT * FROM calls').first();assert.equal(c.status,'no_show');assert.equal(c.qualified,0);assert.ok(c.qualification_updated_at);assert.equal(c.attendance_updated_at,null);
});
test('show and qualified rates exclude unknowns, future and cancelled calls and flag incompleteness',async()=>{
 const e=env();e.LOCAL_PREVIEW='true';await intake({kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'},e);
 const now=new Date().toISOString(),day=dayIn(now,e.REPORTING_TIMEZONE),past=new Date(Date.now()-60000).toISOString();
 const insert=e.DB.raw.prepare('INSERT INTO calls(id,session_id,booked_at,booked_day,scheduled_at,scheduled_day,status,qualified,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
 for(const [id,status,qualified] of [['a','showed',1],['b','no_show',0],['c','scheduled',null],['d','cancelled',1]])insert.run(id,sid,now,day,past,day,status,qualified,now);
 insert.run('future',sid,now,day,new Date(Date.now()+86400000).toISOString(),day,'scheduled',null,now);
 insert.run('organic',null,now,day,past,day,'showed',1,now);
 const r=await report(e,new URL('https://local/api/report'));assert.equal(r.totals.booked,4);assert.equal(r.totals.showed,1);assert.equal(r.totals.attendanceUnknown,1);assert.equal(r.totals.qualificationUnknown,2);
 for(const key of ['show','qualified_rate']){const m=r.metrics.find(x=>x.key===key);assert.equal(m.value,50);assert.equal(m.sample,2);assert.equal(m.provisional,true);}
 assert.equal(r.calls.length,6); // Organic bookings can be managed but do not enter paid metrics.
 const response=await worker.fetch(new Request('http://localhost/api/calls',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({id:'future',status:'showed',qualified:null,boosted:false,paid:false})}),e,{});assert.equal(response.status,400);
});

test('CAD account spend becomes USD without changing clicks; invalid FX preserves snapshot',async()=>{
 const e=env();Object.assign(e,{META_ACCESS_TOKEN:'test-only',META_ACCOUNT_CURRENCY:'CAD',META_USD_TO_ACCOUNT_RATE:'1.3840',META_FX_DATE:'2026-09-04'});
 const today=dayIn(Date.now(),e.REPORTING_TIMEZONE),original=globalThis.fetch;
 globalThis.fetch=async(url)=>new URL(url).pathname.endsWith('/insights')?Response.json({data:[{date_start:today,ad_id:'222',ad_name:'Test',adset_id:'333',campaign_id:'111',campaign_name:'Rank Boost',spend:'138.40',impressions:'1000',inline_link_clicks:'10'}]}):Response.json({name:'Test',currency:'CAD',timezone_name:e.REPORTING_TIMEZONE});
 try{
  await syncMeta(e);let row=await e.DB.prepare('SELECT * FROM meta_daily').first();assert.ok(Math.abs(row.spend-100)<0.000001);assert.equal(row.impressions,1000);assert.equal(row.link_clicks,10);
  const r=await report(e,new URL('https://local/api/report?days=7'));assert.equal(r.period.currency,'USD');assert.ok(r.notes.some(n=>n.includes('1.3840')&&n.includes('2026-09-04')));
  e.META_USD_TO_ACCOUNT_RATE='0';await assert.rejects(syncMeta(e),/exchange rate/);row=await e.DB.prepare('SELECT * FROM meta_daily').first();assert.ok(Math.abs(row.spend-100)<0.000001);
 }finally{globalThis.fetch=original;}
});


test('prelaunch visits stay out of paid totals and an explicit launch boundary excludes earlier reviews',async()=>{
 const e=env();delete e.LAUNCH_AT;
 await intake({kind:'session',session_id:sid,campaign_id:'111',ad_id:'222'},e);await intake({kind:'vsl_play',session_id:sid},e);
 let r=await report(e,new URL('https://local/api/report'));assert.equal(r.totals.visitors,0);assert.equal(r.events.vsl_play,undefined);assert.ok(r.notes.some(n=>n.includes('has not launched')));
 e.LAUNCH_AT=new Date(Date.now()-1000).toISOString();r=await report(e,new URL('https://local/api/report'));assert.equal(r.totals.visitors,1);
 e.LAUNCH_AT=new Date(Date.now()+1000).toISOString();r=await report(e,new URL('https://local/api/report'));assert.equal(r.totals.visitors,0);
});

test('website consultations do not enter main-offer dashboard booking totals',async()=>{
 const e=env();e.LEADS_DB=database(false);
 e.LEADS_DB.raw.exec("CREATE TABLE leads(lead_ref TEXT,qualified INTEGER);CREATE TABLE calendly_invitees(invitee_uri TEXT,lead_ref TEXT,scheduled_start_at TEXT,status TEXT,created_at TEXT,event_type_uri TEXT DEFAULT 'boost-type');INSERT INTO leads VALUES('website',0),('boost',1);INSERT INTO calendly_invitees(invitee_uri,lead_ref,scheduled_start_at,status,created_at) VALUES('website-call','website','2026-09-15T12:00:00Z','booked','2026-09-08 10:00:00'),('boost-call','boost','2026-09-15T12:00:00Z','booked','2026-09-08 10:00:00');");
 await syncFunnel(e);const rows=await e.DB.prepare('SELECT id FROM calls').all();assert.deepEqual(rows.results.map(r=>r.id),['boost-call']);
});

test('Calendly Meta bookings are counted without browser sessions and exclude other routes and cancelled calls',async()=>{
 const e=env();e.BROWSER_TRACKING_ENABLED='false';const today=dayIn(Date.now(),e.REPORTING_TIMEZONE),now=new Date().toISOString();
 e.DB.raw.prepare('INSERT INTO meta_daily VALUES(?,?,?,?,?,?,?,?,?)').run(today,'222','Ad','333','111','Rank Boost',120,100,3);
 for(const [id,source,type,status] of [['yes','meta','boost-type','scheduled'],['organic','','boost-type','scheduled'],['website','meta','website-type','scheduled'],['cancelled','meta','boost-type','cancelled']]){
  e.DB.raw.prepare('INSERT INTO calls(id,booked_at,booked_day,scheduled_at,scheduled_day,status,updated_at,booking_source,booking_campaign,event_type_uri) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,now,today,now,today,status,now,source,'111',type);
 }
 e.DB.raw.prepare('INSERT INTO state VALUES(?,?)').run('funnel_success',now);
 const r=await report(e,new URL('https://dashboard.test/api/report'));
 assert.equal(r.metaBookings.count,1);assert.equal(r.metrics.find(m=>m.key==='scheduled_cost').value,120);
});
