import {graph,ids,setState} from './meta.js';
async function parseInventory(raw){const parsed=JSON.parse(raw||'null');if(parsed?.encoding!=='gzip-base64')return parsed;const bytes=Uint8Array.from(atob(parsed.value),c=>c.charCodeAt(0));return JSON.parse(await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text());}
const critical=['advantage_plus_creative','image_auto_crop','image_uncrop','image_enhancement','image_animation','image_background_gen','text_generation','text_optimizations','music_generation'];
const formats={facebook_feed:['DESKTOP_FEED_STANDARD','MOBILE_FEED_STANDARD'],instagram_stream:['INSTAGRAM_STANDARD'],instagram_story:['INSTAGRAM_STORY']};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function fingerprint(value){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function evaluate(ad,images){
 const c=ad.creative||{},spec=c.asset_feed_spec||{},features=c.degrees_of_freedom_spec?.creative_features_spec||{},target=ad.adset?.targeting||{},issues=[],placements=[];
 for(const platform of target.publisher_platforms||[])for(const position of target[platform+'_positions']||[])placements.push(platform+'_'+position);
 if(!placements.length)issues.push('Placements are missing or automatic. Select explicit placements.');
 const required=[...new Set(placements.flatMap(p=>formats[p]||[]))];
 for(const p of placements)if(!formats[p])issues.push('Unreviewed placement: '+p);
 const enabled=Object.keys(features).filter(k=>features[k]?.enroll_status!=='OPT_OUT');
 for(const k of critical)if(features[k]?.enroll_status!=='OPT_OUT')enabled.push(k);
 if(enabled.length)issues.push('Enhancements not explicitly off: '+[...new Set(enabled)].join(', '));
 if(c.contextual_multi_ads?.enroll_status!=='OPT_OUT')issues.push('Multi-advertiser ads are not explicitly off.');
 if(spec.optimization_type!=='PLACEMENT')issues.push('Explicit placement asset selection is required.');
 const assets={};
 for(const placement of placements){
  const [platform,position]=placement.split('_');
  const rule=(spec.asset_customization_rules||[]).slice().sort((a,b)=>(a.priority||0)-(b.priority||0)).find(r=>r.customization_spec?.publisher_platforms?.includes(platform)&&r.customization_spec?.[platform+'_positions']?.includes(position));
  const asset=(spec.images||[]).find(i=>i.adlabels?.some(l=>l.name===rule?.image_label?.name));
  const img=images[asset?.hash];assets[placement]=img||null;
  const expected=position==='story'?[1080,1920]:[1080,1350];
  if(!img||img.width!==expected[0]||img.height!==expected[1])issues.push(placement+' requires '+expected.join(' × ')+' artwork.');
 }
 return {issues,required,placements,assets,enhancementsChecked:Object.keys(features).length,enhancementsOff:!enabled.length};
}
async function all(env,path,params){let result=[],after;for(let i=0;i<10;i++){const r=await graph(env,path,{...params,limit:100,...(after?{after}:{})});result.push(...r.data||[]);if(!r.paging?.next)return result;after=r.paging.cursors?.after;if(!after)break;}throw Error('Incomplete creative inventory');}
export async function inventory(env,{fresh=false}={}){
 const state=await env.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first();const campaigns=ids({...env,META_CAMPAIGN_IDS:env.META_CAMPAIGN_IDS||state?.value});
 let cached=null;try{const row=await env.DB.prepare("SELECT value FROM state WHERE key='creative_inventory'").first();cached=await parseInventory(row?.value);}catch{}
 let reuse=!fresh&&cached&&Date.now()-Date.parse(cached.checkedAt)<5*60*1000&&JSON.stringify(cached.campaigns)===JSON.stringify(campaigns),stale=false;
 let ads=reuse?cached.ads:[],images=reuse?cached.images:{};
 if(!reuse){try{
  for(const campaign of campaigns)ads.push(...await all(env,campaign+'/ads',{fields:'id,name,status,effective_status,campaign{id,name},adset{id,targeting},creative{id,object_story_spec,url_tags,asset_feed_spec,degrees_of_freedom_spec,contextual_multi_ads}'}));
  const hashes=[...new Set(ads.flatMap(a=>(a.creative?.asset_feed_spec?.images||[]).map(i=>i.hash)).filter(Boolean))];
  for(let i=0;i<hashes.length;i+=50){const r=await graph(env,'act_'+env.META_ACCOUNT_ID.replace(/^act_/, '')+'/adimages',{hashes:JSON.stringify(hashes.slice(i,i+50)),fields:'hash,url,width,height',limit:100});for(const image of r.data||[])images[image.hash]=image;}
 }catch(e){if(fresh||!cached||JSON.stringify(cached.campaigns)!==JSON.stringify(campaigns))throw e;reuse=true;stale=true;ads=cached.ads;images=cached.images;}}
 const scoped=ads.filter(a=>!['DELETED','ARCHIVED'].includes(a.status));
 const checkedAt=reuse?cached.checkedAt:new Date().toISOString();
 if(!reuse)await setState(env,'creative_inventory',JSON.stringify({checkedAt,campaigns,ads,images}));
 const result=[];
 for(const a of scoped){const evaluation=evaluate(a,images),fp=await fingerprint({creative:a.creative,targeting:a.adset?.targeting,assets:Object.fromEntries(Object.entries(evaluation.assets).map(([k,v])=>[k,v?{hash:v.hash,width:v.width,height:v.height}:null]))});
  const saved=await env.DB.prepare('SELECT value FROM state WHERE key=?').bind('creative_review:'+a.id).first();let review=null;try{review=JSON.parse(saved?.value||'null');}catch{}
  const reviewed=review?.fingerprint===fp&&evaluation.required.every(f=>review.formats?.includes(f));
  const link=a.creative?.object_story_spec?.link_data||{},feed=a.creative?.asset_feed_spec||{};
  result.push({id:a.id,name:a.name,campaign:a.campaign,status:a.effective_status,creativeId:a.creative?.id,fingerprint:fp,...evaluation,reviewed,reviewedAt:reviewed?review.at:null,passed:!stale&&!evaluation.issues.length&&reviewed,copy:{body:feed.bodies?.[0]?.text||link.message||'',title:feed.titles?.[0]?.text||link.name||''}});
 }
 return {checkedAt,fromCache:!!reuse,stale,passed:result.length>0&&result.every(a=>a.passed),ads:result};
}
export async function preview(env,ad,format){if(!ad.required.includes(format))throw Error('Placement is not enabled for this ad');const key='meta_preview:'+ad.creativeId+':'+format;let cached;try{cached=JSON.parse((await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(key).first())?.value||'null');}catch{}if(cached&&Date.now()-cached.savedAt<15*60*1000)return cached;const r=await graph(env,ad.creativeId+'/previews',{ad_format:format});const match=r.data?.[0]?.body?.match(/src="([^"]+)"/);if(!match)throw Error('Meta preview unavailable');const url=new URL(match[1].replaceAll('&amp;','&'));if(url.protocol!=='https:'||url.hostname!=='business.facebook.com')throw Error('Unexpected preview origin');const result={url:url.href,format,savedAt:Date.now()};await setState(env,key,JSON.stringify(result));return result;}
export async function recordReview(env,ad,body){if(ad.issues.length||body.fingerprint!==ad.fingerprint||!ad.required.every(f=>body.formats?.includes(f)))throw Error('Review every enabled placement and resolve all checks first');const review={fingerprint:ad.fingerprint,formats:ad.required,at:new Date().toISOString()};await setState(env,'creative_review:'+ad.id,JSON.stringify(review));return {ok:true};}
