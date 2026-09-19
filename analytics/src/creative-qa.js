import {graph,ids,setState} from './meta.js';
async function parseInventory(raw){const parsed=JSON.parse(raw||'null');if(parsed?.encoding!=='gzip-base64')return parsed;const bytes=Uint8Array.from(atob(parsed.value),c=>c.charCodeAt(0));return JSON.parse(await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text());}
const critical=['advantage_plus_creative','image_auto_crop','image_uncrop','image_enhancement','image_animation','image_background_gen','text_generation','text_optimizations','music_generation'];
// Preview formats verified against live Graph v25.0 and Meta's placement selector.
// Search formats work in Graph despite being absent from the published SDK enum.
const formats={
 facebook_feed:['DESKTOP_FEED_STANDARD','MOBILE_FEED_STANDARD'],
 facebook_right_hand_column:['RIGHT_COLUMN_STANDARD'],facebook_marketplace:['MARKETPLACE_MOBILE'],
 facebook_search:['SEARCH_SERP_ADS_MOBILE','MARKETPLACE_SEARCH_ADS_MOBILE'],
 facebook_profile_feed:['FACEBOOK_PROFILE_FEED_DESKTOP','FACEBOOK_PROFILE_FEED_MOBILE'],
 facebook_instream_video:['INSTREAM_VIDEO_DESKTOP','INSTREAM_VIDEO_MOBILE'],
 facebook_story:['FACEBOOK_STORY_MOBILE'],facebook_facebook_reels:['FACEBOOK_REELS_MOBILE'],
 instagram_stream:['INSTAGRAM_STANDARD','INSTAGRAM_FEED_WEB'],instagram_story:['INSTAGRAM_STORY','INSTAGRAM_STORY_WEB'],
 instagram_reels:['INSTAGRAM_REELS','INSTAGRAM_REELS_WEB'],instagram_explore_home:['INSTAGRAM_EXPLORE_GRID_HOME'],
 instagram_profile_feed:['INSTAGRAM_PROFILE_FEED'],instagram_ig_search:['INSTAGRAM_SEARCH_GRID','INSTAGRAM_SEARCH_CHAIN'],
 messenger_messenger_home:['MESSENGER_MOBILE_INBOX_MEDIA'],messenger_story:['MESSENGER_MOBILE_STORY_MEDIA'],
 audience_network_classic:['MOBILE_NATIVE','MOBILE_BANNER','MOBILE_INTERSTITIAL'],audience_network_rewarded_video:['AUDIENCE_NETWORK_REWARDED_VIDEO']
};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function fingerprint(value){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function stableCreativeFingerprintInput(creative){
 const stable=structuredClone(creative);
 for(const video of stable?.asset_feed_spec?.videos||[])if(typeof video.video_id==='string'&&video.video_id&&typeof video.thumbnail_hash==='string'&&video.thumbnail_hash)delete video.thumbnail_url;
 return stable;
}
export function evaluate(ad,images,videos={}){
 const c=ad.creative||{},spec=c.asset_feed_spec||{},features=c.degrees_of_freedom_spec?.creative_features_spec||{},target=ad.adset?.targeting||{},issues=[],placements=[];
 for(const platform of target.publisher_platforms||[])for(const position of target[platform+'_positions']||[])placements.push(platform+'_'+position);
 if(!placements.length)issues.push('Placements are missing or automatic. Select explicit placements.');
 const mobileOnly=target.device_platforms?.length===1&&target.device_platforms[0]==='mobile';
 const desktopFormat=f=>f.includes('DESKTOP')||f==='RIGHT_COLUMN_STANDARD'||f.endsWith('_WEB');
 const desktopOnly=target.device_platforms?.length===1&&target.device_platforms[0]==='desktop';
 const formatPlacements=Object.fromEntries(placements.flatMap(p=>(formats[p]||[]).filter(f=>!mobileOnly||!desktopFormat(f)).filter(f=>!desktopOnly||desktopFormat(f)).map(f=>[f,p])));
 const ineligible=[];
 // Meta v25.0 validation and preview responses, verified September 16, 2026.
 // Keep live targeting unchanged; omit only combinations that cannot serve this media/device.
 const staticImage=spec.ad_formats?.length===1&&spec.ad_formats[0]==='SINGLE_IMAGE'&&!spec.videos?.length;
 for(const format of staticImage?['INSTREAM_VIDEO_DESKTOP','AUDIENCE_NETWORK_REWARDED_VIDEO']:[]){
  if(formatPlacements[format]){ineligible.push({format,reason:'Meta requires video for this format; this creative is a static image.'});delete formatPlacements[format];}
 }
 if(ad.campaign?.id==='120249151255100545'&&formatPlacements.INSTAGRAM_REELS_WEB){
  ineligible.push({format:'INSTAGRAM_REELS_WEB',reason:'Meta validation rejects desktop-only Reels for this campaign; the identical mobile targeting validates.'});
  delete formatPlacements.INSTAGRAM_REELS_WEB;
 }
 const required=Object.keys(formatPlacements);
 if(!required.length)issues.push('No eligible preview formats are available for the selected placements and devices.');
 for(const p of placements)if(!formats[p])issues.push('Unreviewed placement: '+p);
 const enabled=Object.keys(features).filter(k=>features[k]?.enroll_status!=='OPT_OUT');
 for(const k of critical)if(features[k]?.enroll_status!=='OPT_OUT')enabled.push(k);
 if(enabled.length)issues.push('Enhancements not explicitly off: '+[...new Set(enabled)].join(', '));
 if(c.contextual_multi_ads?.enroll_status!=='OPT_OUT')issues.push('Multi-advertiser ads are not explicitly off.');
 if(spec.optimization_type!=='PLACEMENT')issues.push('Explicit placement asset selection is required.');
 const assets={};
 for(const placement of placements){
  const platform=(target.publisher_platforms||[]).find(p=>placement.startsWith(p+'_')),position=placement.slice(platform.length+1);
  const rule=(spec.asset_customization_rules||[]).slice().sort((a,b)=>(a.priority||0)-(b.priority||0)).find(r=>r.customization_spec?.publisher_platforms?.includes(platform)&&r.customization_spec?.[platform+'_positions']?.includes(position));
  const asset=(spec.images||[]).find(i=>i.adlabels?.some(l=>l.name===rule?.image_label?.name));
  const video=(spec.videos||[]).find(v=>v.adlabels?.some(l=>l.name===rule?.video_label?.name));
  const img=video?videos[video.video_id]:images[asset?.hash];assets[placement]=img||null;
  const compact=['facebook_right_hand_column','facebook_marketplace','facebook_search','messenger_messenger_home','audience_network_classic'].includes(placement);
  const expected=['story','reels','facebook_reels'].includes(position)?[1080,1920]:compact?[1080,1080]:[1080,1350];
  if(!img||img.width!==expected[0]||img.height!==expected[1])issues.push(placement+' requires '+expected.join(' × ')+' artwork.');
  if(video&&img?.status!=='ready')issues.push(placement+' video is not ready.');
 }
 return {issues,required,ineligible,formatPlacements,placements,assets,enhancementsChecked:Object.keys(features).length,enhancementsOff:!enabled.length};
}
async function all(env,path,params){let result=[],after;for(let i=0;i<10;i++){const r=await graph(env,path,{...params,limit:100,...(after?{after}:{})});result.push(...r.data||[]);if(!r.paging?.next)return result;after=r.paging.cursors?.after;if(!after)break;}throw Error('Incomplete creative inventory');}
export async function inventory(env,{fresh=false}={}){
 const state=await env.DB.prepare("SELECT value FROM state WHERE key='meta_campaign_ids'").first();const campaigns=ids({...env,META_CAMPAIGN_IDS:env.META_CAMPAIGN_IDS||state?.value});
 let cached=null;try{const row=await env.DB.prepare("SELECT value FROM state WHERE key='creative_inventory'").first();cached=await parseInventory(row?.value);}catch{}
 let reuse=!fresh&&cached&&Date.now()-Date.parse(cached.checkedAt)<5*60*1000&&JSON.stringify(cached.campaigns)===JSON.stringify(campaigns),stale=false;
 let ads=reuse?cached.ads:[],images=reuse?cached.images:{},videos=reuse?(cached.videos||{}):{};
 if(!reuse){try{
  for(const campaign of campaigns)ads.push(...await all(env,campaign+'/ads',{fields:'id,name,status,effective_status,campaign{id,name},adset{id,targeting},creative{id,object_story_spec,url_tags,asset_feed_spec,degrees_of_freedom_spec,contextual_multi_ads}'}));
  const hashes=[...new Set(ads.flatMap(a=>(a.creative?.asset_feed_spec?.images||[]).map(i=>i.hash)).filter(Boolean))];
  for(let i=0;i<hashes.length;i+=50){const r=await graph(env,'act_'+env.META_ACCOUNT_ID.replace(/^act_/, '')+'/adimages',{hashes:JSON.stringify(hashes.slice(i,i+50)),fields:'hash,url,width,height',limit:100});for(const image of r.data||[])images[image.hash]=image;}
  const videoIds=[...new Set(ads.flatMap(a=>(a.creative?.asset_feed_spec?.videos||[]).map(v=>v.video_id)).filter(Boolean))];
  for(const id of videoIds){const v=await graph(env,id,{fields:'id,status,format,picture'});const largest=(v.format||[]).slice().sort((a,b)=>b.width*b.height-a.width*a.height)[0];videos[id]={video_id:id,kind:'video',width:largest?.width,height:largest?.height,url:largest?.picture||v.picture,status:v.status?.video_status};}
 }catch(e){if(fresh||!cached||JSON.stringify(cached.campaigns)!==JSON.stringify(campaigns))throw e;reuse=true;stale=true;ads=cached.ads;images=cached.images;videos=cached.videos||{};}}
 const scoped=ads.filter(a=>!['DELETED','ARCHIVED'].includes(a.status));
 const checkedAt=reuse?cached.checkedAt:new Date().toISOString();
 if(!reuse)await setState(env,'creative_inventory',JSON.stringify({checkedAt,campaigns,ads,images,videos}));
 const result=[];
 for(const a of scoped){const evaluation=evaluate(a,images,videos),fp=await fingerprint({creative:stableCreativeFingerprintInput(a.creative),targeting:a.adset?.targeting,assets:Object.fromEntries(Object.entries(evaluation.assets).map(([k,v])=>[k,v?{hash:v.hash,video_id:v.video_id,status:v.status,width:v.width,height:v.height}:null]))});
  const saved=await env.DB.prepare('SELECT value FROM state WHERE key=?').bind('creative_review:'+a.id).first();let review=null;try{review=JSON.parse(saved?.value||'null');}catch{}
  const reviewed=review?.fingerprint===fp&&evaluation.required.every(f=>review.formats?.includes(f));
  const link=a.creative?.object_story_spec?.link_data||{},feed=a.creative?.asset_feed_spec||{};
  result.push({id:a.id,name:a.name,campaign:a.campaign,status:a.effective_status,creativeId:a.creative?.id,fingerprint:fp,...evaluation,reviewed,reviewedAt:reviewed?review.at:null,passed:!stale&&!evaluation.issues.length&&reviewed,copy:{body:feed.bodies?.[0]?.text||link.message||'',title:feed.titles?.[0]?.text||link.name||''}});
 }
 return {checkedAt,fromCache:!!reuse,stale,passed:result.length>0&&result.every(a=>a.passed),ads:result};
}
export async function preview(env,ad,format){
 if(!ad.required.includes(format))throw Error('Placement is not enabled for this ad');
 const fullSpec=['INSTAGRAM_FEED_WEB','INSTAGRAM_STORY_WEB'].includes(format);
 const key='meta_preview:'+(fullSpec?'full-spec:':'')+ad.id+':'+ad.fingerprint+':'+format;
 let cached;try{cached=JSON.parse((await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(key).first())?.value||'null');}catch{}
 if(cached&&Date.now()-cached.savedAt<15*60*1000)return cached;
 let r;
 if(fullSpec){
  // Meta's ad-ID renderer rejects these formats for placement-customized ads.
  // Generate the preview from the exact current creative, preserving every asset rule.
  const creative=await graph(env,ad.creativeId,{fields:'object_story_spec,asset_feed_spec,degrees_of_freedom_spec,contextual_multi_ads,url_tags'});
  delete creative.id;
  r=await graph(env,'act_'+env.META_ACCOUNT_ID.replace(/^act_/, '')+'/generatepreviews',{ad_format:format,creative:JSON.stringify(creative)});
 }else r=await graph(env,ad.id+'/previews',{ad_format:format});
 const match=r.data?.[0]?.body?.match(/src="([^"]+)"/);if(!match)throw Error('Meta preview unavailable');
 const url=new URL(match[1].replaceAll('&amp;','&'));if(url.protocol!=='https:'||url.hostname!=='business.facebook.com')throw Error('Unexpected preview origin');
 const result={url:url.href,format,savedAt:Date.now()};await setState(env,key,JSON.stringify(result));return result;
}
export async function recordReview(env,ad,body){if(ad.issues.length||body.fingerprint!==ad.fingerprint||!ad.required.every(f=>body.formats?.includes(f)))throw Error('Review every enabled placement and resolve all checks first');const review={fingerprint:ad.fingerprint,formats:ad.required,at:new Date().toISOString()};await setState(env,'creative_review:'+ad.id,JSON.stringify(review));return {ok:true};}
