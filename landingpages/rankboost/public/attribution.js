// Preserve known ad tags on return visits without guessing from a Facebook click ID.
(()=>{
 const key='rb_ad_attribution_v1',fields=['utm_source','utm_medium','utm_campaign','campaign_id','adset_id','ad_id'];
 const current=new URL(location.href);let saved=null;
 try{
  saved=JSON.parse(localStorage.getItem(key)||'null');
  if(!saved||Date.now()-saved.at>30*86400000)saved=null;
  const q=current.searchParams;
  if(q.get('rb_internal')==='1'){localStorage.removeItem(key);saved=null;}
  else if(q.has('utm_source')||q.has('fbclid')){
   // A new untagged click must never inherit an unrelated earlier ad.
   if(q.get('utm_source')?.toLowerCase()==='meta'){
    saved={at:Date.now(),tags:Object.fromEntries(fields.filter(k=>q.get(k)&&q.get(k).length<=200).map(k=>[k,q.get(k)])),click:q.get('fbclid')||''};
    localStorage.setItem(key,JSON.stringify(saved));
   }else if(!q.get('fbclid')||q.get('fbclid')!==saved?.click){saved=null;localStorage.removeItem(key);}
  }
 }catch{saved=null;}
 window.rankBoostAttribution={pageUrl(){const u=new URL(location.href);if(u.searchParams.get('rb_internal')!=='1'&&saved)for(const [k,v] of Object.entries(saved.tags))if(!u.searchParams.has(k))u.searchParams.set(k,v);return u.href;}};
})();
