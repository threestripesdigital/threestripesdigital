const enc=new TextEncoder();
export async function digest(s) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function sign(secret,s) {const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function equal(a,b) {return await digest(a)===await digest(b);}
export async function cookie(env) {const expiry=String(Date.now()+12*3600000);return expiry+'.'+await sign(env.DASHBOARD_PASSWORD,expiry);}
export async function authorized(req,env) {
 const u=new URL(req.url);
 if(env.LOCAL_PREVIEW==='true'&&['localhost','127.0.0.1'].includes(u.hostname)) return true;
 if(!env.DASHBOARD_PASSWORD) return false;
 const token=(req.headers.get('Cookie')||'').match(/(?:^|; )rb_auth=([^;]+)/)?.[1]||'';
 const [expiry,sig]=token.split('.');
 return /^\d{13}$/.test(expiry||'')&&Number(expiry)>Date.now()&&Number(expiry)<Date.now()+13*3600000&&await equal(sig||'',await sign(env.DASHBOARD_PASSWORD,expiry));
}
export async function limited(env,key,max=30,seconds=60) {
 const now=Date.now(), bucket=Math.floor(now/(seconds*1000));
 const hashed=await digest(key+':'+bucket);
 const row=await env.DB.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(hashed,now+seconds*1000).first();
 return row.count>max;
}
export async function readBody(req) {
 if(Number(req.headers.get('Content-Length'))>8192) throw Error('Request too large');
 const reader=req.body?.getReader(); if(!reader) throw Error('Missing body');
 let size=0, chunks=[];
 while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('Request too large');}chunks.push(value);}
 const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}
 const b=JSON.parse(new TextDecoder().decode(raw));if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Invalid body');return b;
}
