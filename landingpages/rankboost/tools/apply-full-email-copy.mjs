import fs from 'node:fs';
import assert from 'node:assert/strict';
const plan=JSON.parse(fs.readFileSync(new URL('../ops/full-email-copy-refresh.json',import.meta.url)));
async function kit(path,method='GET',body){
 for(let n=0;n<6;n++){
  const r=await fetch('https://api.kit.com/v4/'+path,{method,headers:{'X-Kit-Api-Key':process.env.KIT_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===429){await new Promise(resolve=>setTimeout(resolve,10000));continue;}
  if(!r.ok)throw Error(`Kit ${r.status}: ${path}`);return r.json();
 }throw Error('Kit rate limit');
}
if(!process.argv.includes('--apply')){console.log(JSON.stringify({emails:plan.emails.length,published:plan.emails.filter(e=>e.published).length}));process.exit(0);}
assert.ok(process.env.RB_COPY_BACKUP,'Private recovery path required');
const backup={sequences:[],emails:[]};
for(const id of new Set(plan.emails.map(e=>e.sequence_id))){
 backup.sequences.push((await kit('sequences/'+id)).sequence);
 const current=(await kit(`sequences/${id}/emails?include_content=true`)).emails;
 backup.emails.push(...current.map(e=>({...e,sequence_id:id})));
}
fs.writeFileSync(process.env.RB_COPY_BACKUP,JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
const fields=['subject','content','delay_value','delay_unit','published'];
const select=e=>Object.fromEntries(fields.map(k=>[k,e[k]]));
let count=0;
for(const seq of backup.sequences){
 const targets=plan.emails.filter(e=>e.sequence_id===seq.id);
 const originals=backup.emails.filter(e=>e.sequence_id===seq.id);
 for(const e of targets)assert.ok(originals.some(a=>a.id===e.id),'Missing existing email '+e.id);
 await kit(`sequences/${seq.id}`,'PUT',{active:false});
 try{
  for(const e of targets){
   const path=`sequences/${seq.id}/emails/${e.id}`;
   await kit(path,'PUT',{published:false});
   const desired=select(e);delete desired.published;
   await kit(path,'PUT',desired);
   await kit(path,'PUT',{published:e.published});
   const after=(await kit(path)).email;
   for(const k of fields)assert.equal(after[k],e[k],`${e.id} ${k}`);
   const before=originals.find(a=>a.id===e.id);
   for(const k of ['position','email_address','email_template_id','send_days'])assert.deepEqual(after[k],before[k],`${e.id} ${k}`);
   count++;
  }
 }catch(error){
  // Restore the entire sequence batch before enabling delivery again.
  for(const e of originals.filter(a=>targets.some(t=>t.id===a.id))){
   const path=`sequences/${seq.id}/emails/${e.id}`;
   await kit(path,'PUT',{published:false});const data=select(e);delete data.published;
   await kit(path,'PUT',data);await kit(path,'PUT',{published:e.published});
  }
  await kit(`sequences/${seq.id}`,'PUT',{active:seq.active});throw error;
 }
 await kit(`sequences/${seq.id}`,'PUT',{active:seq.active});
 const afterSeq=(await kit(`sequences/${seq.id}`)).sequence;
 for(const k of ['active','repeat','hold','send_days','send_hour','time_zone','exclude_subscriber_sources'])assert.deepEqual(afterSeq[k],seq[k],`${seq.id} ${k}`);
 console.log(JSON.stringify({sequence:seq.id,verified:targets.length,cumulative:count}));
}
console.log(JSON.stringify({verified:count,retired:[10208226],preservedSequenceStates:true}));
