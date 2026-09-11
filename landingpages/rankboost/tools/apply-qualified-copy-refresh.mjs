import fs from 'node:fs';
import assert from 'node:assert/strict';
const plan=JSON.parse(fs.readFileSync(new URL('../ops/qualified-copy-refresh.json',import.meta.url)));
const selected=process.argv.find(arg=>arg.startsWith('--email-id='));
if(selected) {plan.emails=plan.emails.filter(e=>e.id===Number(selected.split('=')[1]));assert.equal(plan.emails.length,1,'Select one known email ID');}
async function kit(path,method='GET',body) {
  const r=await fetch('https://api.kit.com/v4/'+path,{method,headers:{'X-Kit-Api-Key':process.env.KIT_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!r.ok)throw Error(`Kit ${r.status}: ${path}`);
  return r.json();
}
if(!process.argv.includes('--apply')) {console.log(JSON.stringify({planned:plan.emails.map(e=>({id:e.id,subject:e.subject}))}));process.exit(0);}
const backup={sequences:[],emails:[]};
for(const seqId of new Set(plan.emails.map(e=>e.sequence_id))) {
 const sequence=(await kit(`sequences/${seqId}`)).sequence;backup.sequences.push(sequence);
 for(const e of plan.emails.filter(e=>e.sequence_id===seqId))backup.emails.push((await kit(`sequences/${seqId}/emails/${e.id}`)).email);
}
// Mandatory recovery file outside source control before any mutation.
assert.ok(process.env.RB_COPY_BACKUP,'RB_COPY_BACKUP is required');
fs.writeFileSync(process.env.RB_COPY_BACKUP,JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
for(const seq of backup.sequences) {
 try {
  await kit(`sequences/${seq.id}`,'PUT',{active:false});
  for(const e of plan.emails.filter(e=>e.sequence_id===seq.id)) {
   const path=`sequences/${seq.id}/emails/${e.id}`;
   const before=backup.emails.find(x=>x.id===e.id);
   try {
    await kit(path,'PUT',{published:false});
    assert.equal((await kit(path,'PUT',{content:e.content})).email.content,e.content);
   } catch(error) {await kit(path,'PUT',{content:before.content});throw error;}
   finally {await kit(path,'PUT',{published:before.published});}
   const after=(await kit(path)).email;
   for(const key of ['subject','published','delay_value','delay_unit','position'])assert.equal(after[key],before[key]);
   assert.equal(after.content,e.content);
   console.log(JSON.stringify({verified_email:e.id}));
  }
 } finally {await kit(`sequences/${seq.id}`,'PUT',{active:seq.active});}
 assert.equal((await kit(`sequences/${seq.id}`)).sequence.active,seq.active);
}
console.log('Copy verified; original sequence activity, subjects, timing and publication states restored.');
