import fs from 'node:fs';
import assert from 'node:assert/strict';
import {projectKeywords} from '../functions/api/_rankmodel.js';
import {qualifiedKeywordEmailFields} from '../functions/api/_emailfields.js';
async function kit(path,method='GET',body){const r=await fetch('https://api.kit.com/v4/'+path,{method,headers:{'X-Kit-Api-Key':process.env.KIT_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Kit '+r.status);return r.json();}
const fields=(await kit('custom_fields')).custom_fields;
if(!fields.some(f=>f.key==='opp_upside'))assert.equal((await kit('custom_fields','POST',{label:'Opp Upside'})).custom_field.key,'opp_upside');
const r=await fetch('https://api.cloudflare.com/client/v4/accounts/17f7c095d40a8771cf3568fdcae11770/d1/database/072ff1b9-a238-424d-9c03-6ae26ecf74a1/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({sql:`SELECT l.email,l.domain,l.top_keywords FROM leads l WHERE l.qualified=1 AND l.email<>'' AND l.id=(SELECT MAX(id) FROM leads newer WHERE lower(newer.email)=lower(l.email))`})});const d=await r.json();assert.ok(d.success);
assert.ok(process.env.RB_UPSIDE_BACKUP);const backup=[];fs.writeFileSync(process.env.RB_UPSIDE_BACKUP,'[]',{flag:'wx',mode:0o600});
let updated=0,skipped=0;
for(const row of d.result[0].results){const sub=(await kit('subscribers?email_address='+encodeURIComponent(row.email))).subscribers?.[0];if(!sub){skipped++;continue;}
 const top=projectKeywords(row.domain,JSON.parse(row.top_keywords||'[]'),8).keywords[0];if(!top){skipped++;continue;}
 // Only backfill when the current subscriber math still refers to this same scan keyword.
 if(sub.fields?.top_keyword!==top.keyword||String(sub.fields?.top_position)!==String(top.position)){skipped++;continue;}
 backup.push({id:sub.id,opp_upside:sub.fields?.opp_upside||'',state:sub.state});fs.writeFileSync(process.env.RB_UPSIDE_BACKUP,JSON.stringify(backup,null,2));
 const opp_upside=qualifiedKeywordEmailFields(top).opp_upside;
 await kit('subscribers/'+sub.id,'PUT',{fields:{opp_upside}});
 const after=(await kit('subscribers/'+sub.id)).subscriber;assert.equal(after.fields.opp_upside,opp_upside);assert.equal(after.state,sub.state);updated++;
}
console.log(JSON.stringify({updated,skipped,enrollments:0}));
