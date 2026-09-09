import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const file = new URL('ops/downsell-email-system.json', root);
const config = JSON.parse(fs.readFileSync(file));
const stateFile = new URL('ops/downsell-email-live.json', root);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { tags: {}, sequences: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
async function api(path, method='GET', body) {
 for(let n=0;n<8;n++) {
  const r=await fetch('https://api.kit.com/v4/'+path,{method,headers:{'X-Kit-Api-Key':process.env.KIT_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===429){await new Promise(r=>setTimeout(r,15000));continue;}
  const d=await r.json();if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(d));return d;
 }throw Error('Kit rate limit');
}
const names={stop:'rb_website_precall_stop',everBooked:'rb_website_consultation_entered',attended:'rb_website_call_attended',closed:'rb_website_closed',notClosed:'rb_website_not_closed',longTerm:'rb_website_long_term'};
for(const [key,name] of Object.entries(names)){if(!state.tags[key]){state.tags[key]=(await api('tags','POST',{name})).tag.id;save();}}
for(const label of ['Website Calendly Link','Website Call Date','Website Call Time','Website Reschedule Link']) {
 const fields=(await api('custom_fields')).custom_fields;
 if(!fields.some(f=>f.label===label))await api('custom_fields','POST',{label});
}
const excluded=[23211442,23211443,state.tags.stop,state.tags.attended,state.tags.closed,state.tags.notClosed,22494644,22511246];
for(const [key,definition] of Object.entries(config.sequences)) {
 const seq={...definition,emails:[...definition.emails,...Array.from({length:definition.rotation_repetitions||0},()=>definition.rotation_pool).flat()]};
 const target=state.sequences[key] ||= {};
 if(!target.id){target.id=(await api('sequences','POST',{name:seq.name,email_address:config.email_address,email_template_id:config.template_id,active:false,repeat:false,hold:false,send_days:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],send_hour:9,time_zone:'America/New_York',exclude_subscriber_sources:[{type:'tag',ids:key==='nurture'?[...excluded,23211441,state.tags.everBooked]:excluded}]})).sequence.id;save();}
 const existing=(await api(`sequences/${target.id}/emails?include_content=true`)).emails;
 target.emails ||= [];
 for(let i=0;i<seq.emails.length;i++) {
  const desired={...seq.emails[i],position:i,email_template_id:config.template_id,published:true};
  assert.ok(!/[\u2013\u2014]/.test(desired.subject+desired.content));
  const found=existing.find(e=>e.position===i);
  if(found){assert.equal(found.subject,desired.subject);target.emails[i]=found.id;continue;}
  const made=await api(`sequences/${target.id}/emails`,'POST',desired);
  target.emails[i]=made.email.id;save();
  if(i%25===0)console.log(key,'staged',i+1,'of',seq.emails.length);
  await new Promise(r=>setTimeout(r,350));
 }
 const verified=(await api(`sequences/${target.id}/emails?include_content=true`)).emails;
 assert.equal(verified.length,seq.emails.length);
 for(let i=0;i<verified.length;i++){const actual=verified[i],desired=seq.emails[i];for(const field of ['subject','content','delay_value','delay_unit'])assert.equal(actual[field],desired[field]);assert.equal(actual.published,true);}
 target.verified=true;save();console.log(key,'verified',verified.length);
}
if(process.argv.includes('--activate'))for(const target of Object.values(state.sequences)){const seq=(await api('sequences/'+target.id,'PUT',{active:true})).sequence;assert.equal(seq.active,true);target.active=true;save();}
console.log(JSON.stringify({tags:state.tags,sequences:Object.fromEntries(Object.entries(state.sequences).map(([k,v])=>[k,{id:v.id,count:v.emails.length,verified:v.verified,active:v.active||false}]))}));
