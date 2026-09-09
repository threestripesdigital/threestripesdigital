import fs from 'node:fs';
import assert from 'node:assert/strict';
import { boostBookingLink } from '../functions/api/_bookinglinks.js';
const root=new URL('../',import.meta.url);
const backupFile=new URL('ops/main-booking-link-backup.json',root);
const backup=fs.existsSync(backupFile)?JSON.parse(fs.readFileSync(backupFile)):{emails:[]};
async function kit(path,method='GET',body) {
  for(let n=0;n<8;n++) {
    const r=await fetch('https://api.kit.com/v4/'+path,{method,headers:{'X-Kit-Api-Key':process.env.KIT_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(r.status===429){await new Promise(resolve=>setTimeout(resolve,15000));continue;}
    const d=await r.json();if(!r.ok)throw Error('Kit '+r.status+' '+path);return d;
  }throw Error('Kit rate limit');
}
const apply=process.argv.includes('--apply');
const fallback='https://threestripesdigital.com/rank-boost/law-firms/#qualify';
const old='https://calendly.com/bilal-threestripesdigital/three-stripes-digital-rank-boost';
const replacement=`{{ subscriber.rank_boost_booking_link | default: '${fallback}' }}`;
let changed=0;
for(const seq of [2862358,2862378]) {
  backup.sequences ||= {};
  if(!backup.sequences[seq]) {backup.sequences[seq]=(await kit('sequences/'+seq)).sequence;fs.writeFileSync(backupFile,JSON.stringify(backup,null,2)+'\n');}
  if(apply)await kit('sequences/'+seq,'PUT',{active:false});
  const {emails}=await kit(`sequences/${seq}/emails?include_content=true`);
  for(const e of emails) {
    if(!backup.emails.some(x=>x.id===e.id)){backup.emails.push({...e,sequence_id:seq});fs.writeFileSync(backupFile,JSON.stringify(backup,null,2)+'\n');}
    let content=e.content.replaceAll(old,replacement);
    const eligibilityCopy=seq===2862358&&(content.includes('11 through 50')||e.position===0);
    if(seq===2862358)content=content.replaceAll('11 through 50','1 through 50');
    if(eligibilityCopy && !content.includes('Page-one firms qualify too'))content+='<p>Page-one firms qualify too, including position one. Your existing page-one visibility does not disqualify you from Rank Boost.</p>';
    if(content!==e.content){changed++;if(apply){
      // Live verification found content writes ignored while published. Pause
      // the sequence and unpublish this same email ID before editing its body.
      await kit(`sequences/${seq}/emails/${e.id}`,'PUT',{published:false});
      assert.equal((await kit(`sequences/${seq}/emails/${e.id}`,'PUT',{content})).email.content,content);
    }}
    if(apply)await kit(`sequences/${seq}/emails/${e.id}`,'PUT',{published:backup.emails.find(x=>x.id===e.id).published});
    if(apply){const verified=(await kit(`sequences/${seq}/emails/${e.id}`)).email;assert.equal(verified.content,content);assert.ok(!verified.content.includes(old));}
  }
  if(apply)await kit('sequences/'+seq,'PUT',{active:backup.sequences[seq].active});
}
// Restore attribution fields for existing qualified leads without applying tags
// or enrolling anyone. Never print contact details or bearer links.
let backfilled=0;
if(apply) {
  const url='https://api.cloudflare.com/client/v4/accounts/17f7c095d40a8771cf3568fdcae11770/d1/database/072ff1b9-a238-424d-9c03-6ae26ecf74a1/query';
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({sql:`SELECT l.email,s.response_json FROM leads l JOIN submissions s ON s.lead_ref=l.lead_ref
    WHERE l.qualified=1 AND l.email<>'' AND s.response_json IS NOT NULL ORDER BY l.created_at ASC`})});
  const data=await r.json();if(!data.success)throw Error('Lead backfill query failed');
  for(const row of data.result[0].results) {
    const token=JSON.parse(row.response_json).lead_token;if(!token)continue;
    const existing=(await kit('subscribers?email_address='+encodeURIComponent(row.email))).subscribers?.[0];
    if(!existing)continue;
    await kit('subscribers','POST',{email_address:row.email,fields:{rank_boost_booking_link:boostBookingLink(token)}});backfilled++;
  }
}
console.log(JSON.stringify({apply,changed,backfilled}));
