import test from 'node:test';import assert from 'node:assert/strict';import {evaluate,fingerprint,preview,stableCreativeFingerprintInput} from './creative-qa.js';
const keys=['advantage_plus_creative','image_auto_crop','image_uncrop','image_enhancement','image_animation','image_background_gen','text_generation','text_optimizations','music_generation'];
function fixture(){return {adset:{targeting:{publisher_platforms:['facebook','instagram'],facebook_positions:['feed'],instagram_positions:['stream','story']}},creative:{contextual_multi_ads:{enroll_status:'OPT_OUT'},degrees_of_freedom_spec:{creative_features_spec:Object.fromEntries(keys.map(k=>[k,{enroll_status:'OPT_OUT'}]))},asset_feed_spec:{optimization_type:'PLACEMENT',images:[{hash:'feed',adlabels:[{name:'feed'}]},{hash:'story',adlabels:[{name:'story'}]}],asset_customization_rules:[{priority:1,image_label:{name:'story'},customization_spec:{publisher_platforms:['instagram'],instagram_positions:['story']}},{priority:2,image_label:{name:'feed'},customization_spec:{publisher_platforms:['facebook','instagram'],facebook_positions:['feed'],instagram_positions:['stream']}}]}}};}
const images={feed:{hash:'feed',width:1080,height:1350},story:{hash:'story',width:1080,height:1920}};
test('checks all four enabled device/placement previews',()=>{const r=evaluate(fixture(),images);assert.deepEqual(r.issues,[]);assert.ok(r.required.includes('DESKTOP_FEED_STANDARD'));assert.ok(r.required.includes('INSTAGRAM_STORY'))});
test('fails closed for enabled or missing enhancements',()=>{const a=fixture();a.creative.degrees_of_freedom_spec.creative_features_spec.audio={enroll_status:'OPT_IN'};assert.match(evaluate(a,images).issues.join(),/audio/);delete a.creative.degrees_of_freedom_spec.creative_features_spec.image_auto_crop;assert.match(evaluate(a,images).issues.join(),/image_auto_crop/)});
test('wrong story asset dimensions block readiness',()=>{assert.match(evaluate(fixture(),{...images,story:{...images.story,height:1350}}).issues.join(),/1080 × 1920/)});
test('new unsupported placements block readiness',()=>{const a=fixture();a.adset.targeting.instagram_positions.push('unknown_future_placement');assert.match(evaluate(a,images).issues.join(),/Unreviewed placement/)});
test('fingerprint ignores object key order but invalidates changed configuration',async()=>{assert.equal(await fingerprint({b:2,a:1}),await fingerprint({a:1,b:2}));assert.notEqual(await fingerprint({creative:'a'}),await fingerprint({creative:'b'}))});

test('stable video identity ignores only rotating signed thumbnail URLs',async()=>{
 const base={asset_feed_spec:{videos:[{video_id:'video-1',thumbnail_hash:'hash-1',thumbnail_url:'https://www.facebook.com/ads/image/?d=old',adlabels:[{name:'feed'}]}]},object_story_spec:{link_data:{message:'copy'}}};
 const input={creative:stableCreativeFingerprintInput(base),targeting:{publisher_platforms:['facebook']},assets:{facebook_feed:{video_id:'video-1',status:'ready',width:1080,height:1350}}};
 const rotated=structuredClone(base);rotated.asset_feed_spec.videos[0].thumbnail_url='https://www.facebook.com/ads/image/?d=new';
 assert.equal(await fingerprint(input),await fingerprint({...input,creative:stableCreativeFingerprintInput(rotated)}));
 assert.equal(base.asset_feed_spec.videos[0].thumbnail_url,'https://www.facebook.com/ads/image/?d=old');
 for(const [path,mutate] of [
  ['video ID',v=>v.creative.asset_feed_spec.videos[0].video_id='video-2'],
  ['thumbnail hash',v=>v.creative.asset_feed_spec.videos[0].thumbnail_hash='hash-2'],
  ['copy',v=>v.creative.object_story_spec.link_data.message='changed'],
  ['targeting',v=>v.targeting.publisher_platforms=['instagram']],
  ['dimensions',v=>v.assets.facebook_feed.width=720]
 ]){const changed=structuredClone(input);mutate(changed);assert.notEqual(await fingerprint(input),await fingerprint(changed),path);}
});

test('thumbnail URL remains fingerprinted without both stable video identifiers',async()=>{
 for(const video of [{video_id:'video-1',thumbnail_url:'old'},{thumbnail_hash:'hash-1',thumbnail_url:'old'}]){
  const changed=structuredClone(video);changed.thumbnail_url='new';
  assert.notEqual(await fingerprint(stableCreativeFingerprintInput({asset_feed_spec:{videos:[video]}})),await fingerprint(stableCreativeFingerprintInput({asset_feed_spec:{videos:[changed]}})));
 }
});

test('video mapping preserves multiword platform and position names',()=>{const a=fixture();a.adset.targeting={publisher_platforms:['facebook','audience_network'],device_platforms:['mobile'],facebook_positions:['facebook_reels'],audience_network_positions:['rewarded_video']};const spec=a.creative.asset_feed_spec;spec.images=[];spec.videos=[{video_id:'vertical',adlabels:[{name:'story'}]},{video_id:'feed',adlabels:[{name:'feed'}]}];spec.asset_customization_rules=[{priority:1,video_label:{name:'story'},customization_spec:{publisher_platforms:['facebook'],facebook_positions:['facebook_reels']}},{priority:2,video_label:{name:'feed'},customization_spec:{publisher_platforms:['audience_network'],audience_network_positions:['rewarded_video']}}];const videos={vertical:{video_id:'vertical',width:1080,height:1920,status:'ready'},feed:{video_id:'feed',width:1080,height:1350,status:'ready'}};const result=evaluate(a,{},videos);assert.deepEqual(result.issues,[]);assert.equal(result.assets.audience_network_rewarded_video.video_id,'feed');assert.equal(result.formatPlacements.FACEBOOK_REELS_MOBILE,'facebook_facebook_reels');videos.vertical.height=1350;assert.match(evaluate(a,{},videos).issues.join(),/1080 × 1920/);});

 test('compact placements require their square asset, not the feed crop',()=>{const a=fixture();a.adset.targeting={publisher_platforms:['facebook'],facebook_positions:['marketplace','right_hand_column']};a.creative.asset_feed_spec.images=[{hash:'compact',adlabels:[{name:'compact'}]}];a.creative.asset_feed_spec.asset_customization_rules=[{priority:1,image_label:{name:'compact'},customization_spec:{publisher_platforms:['facebook'],facebook_positions:['marketplace','right_hand_column']}}];assert.deepEqual(evaluate(a,{compact:{hash:'compact',width:1080,height:1080}}).issues,[]);assert.match(evaluate(a,{compact:{hash:'compact',width:1080,height:1350}}).issues.join(),/1080 × 1080/);});

test('Instagram search uses a portrait asset while retaining visual review requirements',()=>{const a=fixture();a.adset.targeting={publisher_platforms:['instagram'],instagram_positions:['ig_search']};a.creative.asset_feed_spec.asset_customization_rules=[{priority:1,image_label:{name:'feed'},customization_spec:{publisher_platforms:['instagram'],instagram_positions:['ig_search']}}];const r=evaluate(a,images);assert.deepEqual(r.issues,[]);assert.ok(r.required.includes('INSTAGRAM_SEARCH_GRID'));assert.ok(r.required.includes('INSTAGRAM_SEARCH_CHAIN'));assert.match(evaluate(a,{...images,feed:{width:1080,height:1080}}).issues.join(),/1080 × 1350/);});


test('Facebook search requires both live API search previews and its square asset',()=>{
 const a=fixture();a.adset.targeting={publisher_platforms:['facebook'],facebook_positions:['search']};
 a.creative.asset_feed_spec.images=[{hash:'compact',adlabels:[{name:'compact'}]}];
 a.creative.asset_feed_spec.asset_customization_rules=[{priority:1,image_label:{name:'compact'},customization_spec:{publisher_platforms:['facebook'],facebook_positions:['search']}}];
 const r=evaluate(a,{compact:{hash:'compact',width:1080,height:1080}});
 assert.deepEqual(r.issues,[]);
 assert.deepEqual(r.required,['SEARCH_SERP_ADS_MOBILE','MARKETPLACE_SEARCH_ADS_MOBILE']);
 assert.equal(r.formatPlacements.SEARCH_SERP_ADS_MOBILE,'facebook_search');
 assert.equal(r.formatPlacements.MARKETPLACE_SEARCH_ADS_MOBILE,'facebook_search');
 assert.match(evaluate(a,{compact:{width:1080,height:1350}}).issues.join(),/1080 × 1080/);
});


test('Instagram desktop preview sends the unchanged creative specification to Meta',async()=>{
 const originalFetch=globalThis.fetch,creative={id:'456',...fixture().creative},requests=[],writes=[];
 const env={META_API_VERSION:'v25.0',META_ACCOUNT_ID:'123',META_ACCESS_TOKEN:'test',DB:{prepare(sql){return {bind(...args){return {first:async()=>null,run:async()=>{writes.push({sql,args})}}}}}}};
 globalThis.fetch=async url=>{
  requests.push(new URL(url));
  return new Response(JSON.stringify(requests.length===1?creative:{data:[{body:'<iframe src="https://business.facebook.com/preview/test?a=1&amp;b=2"></iframe>'}]}),{status:200});
 };
 try{
  const result=await preview(env,{id:'789',creativeId:'456',fingerprint:'fp',required:['INSTAGRAM_FEED_WEB']},'INSTAGRAM_FEED_WEB');
  assert.equal(requests[0].pathname,'/v25.0/456');
  assert.equal(requests[1].pathname,'/v25.0/act_123/generatepreviews');
  assert.deepEqual(JSON.parse(requests[1].searchParams.get('creative')),fixture().creative);
  assert.equal(requests[1].searchParams.get('ad_format'),'INSTAGRAM_FEED_WEB');
  assert.equal(result.url,'https://business.facebook.com/preview/test?a=1&b=2');
  assert.equal(writes[0].args[0],'meta_preview:full-spec:789:fp:INSTAGRAM_FEED_WEB');
  await assert.rejects(preview(env,{required:[]},'INSTAGRAM_FEED_WEB'),/not enabled/);
 }finally{globalThis.fetch=originalFetch;}
});


test('static video-only exclusions preserve mobile in-stream and do not exempt video creatives',()=>{
 const a=fixture();a.adset.targeting={publisher_platforms:['facebook','audience_network'],facebook_positions:['instream_video'],audience_network_positions:['rewarded_video']};
 a.creative.asset_feed_spec.ad_formats=['SINGLE_IMAGE'];
 let r=evaluate(a,images);
 assert.ok(r.required.includes('INSTREAM_VIDEO_MOBILE'));
 assert.ok(!r.required.includes('INSTREAM_VIDEO_DESKTOP'));
 assert.ok(!r.required.includes('AUDIENCE_NETWORK_REWARDED_VIDEO'));
 assert.equal(r.ineligible.length,2);
 a.creative.asset_feed_spec.ad_formats=['SINGLE_VIDEO'];r=evaluate(a,images);
 assert.ok(r.required.includes('INSTREAM_VIDEO_DESKTOP'));
 assert.ok(r.required.includes('AUDIENCE_NETWORK_REWARDED_VIDEO'));
});
test('verified v2 Reels device eligibility never waives profile desktop or an unknown campaign',()=>{
 const a=fixture();a.campaign={id:'120249151255100545'};
 a.adset.targeting={publisher_platforms:['facebook','instagram'],facebook_positions:['profile_feed'],instagram_positions:['reels']};
 let r=evaluate(a,images);assert.ok(r.required.includes('INSTAGRAM_REELS'));
 assert.ok(!r.required.includes('INSTAGRAM_REELS_WEB'));assert.ok(r.required.includes('FACEBOOK_PROFILE_FEED_DESKTOP'));
 a.campaign.id='other';assert.ok(evaluate(a,images).required.includes('INSTAGRAM_REELS_WEB'));
 a.campaign.id='120249151255100545';a.adset.targeting={publisher_platforms:['instagram'],instagram_positions:['reels'],device_platforms:['desktop']};
 assert.match(evaluate(a,images).issues.join(),/No eligible preview/);
});


test('Explore home rejects square artwork and keeps its portrait visual review',()=>{
 const a=fixture();a.adset.targeting={publisher_platforms:['instagram'],instagram_positions:['explore_home']};
 a.creative.asset_feed_spec.asset_customization_rules=[{priority:1,image_label:{name:'feed'},customization_spec:{publisher_platforms:['instagram'],instagram_positions:['explore_home']}}];
 const result=evaluate(a,images);
 assert.deepEqual(result.issues,[]);assert.deepEqual(result.required,['INSTAGRAM_EXPLORE_GRID_HOME']);
 assert.equal(result.formatPlacements.INSTAGRAM_EXPLORE_GRID_HOME,'instagram_explore_home');
 assert.match(evaluate(a,{...images,feed:{width:1080,height:1080}}).issues.join(),/1080 × 1350/);
 a.creative.asset_feed_spec.images=[];a.creative.asset_feed_spec.videos=[{video_id:'portrait',adlabels:[{name:'feed'}]}];
 a.creative.asset_feed_spec.asset_customization_rules[0].video_label={name:'feed'};
 assert.deepEqual(evaluate(a,{}, {portrait:{width:1080,height:1350,status:'ready'}}).issues,[]);
 assert.match(evaluate(a,{}, {portrait:{width:1080,height:1080,status:'ready'}}).issues.join(),/1080 × 1350/);
});
