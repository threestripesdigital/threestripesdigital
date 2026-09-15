export const campaigns = [
 {id:'120249151255100545',version:'v2',name:'Cold Test v2',event:'Form opens',budget:100,archived:false},
 {id:'120249029003230545',version:'v1',name:'Cold Test v1',event:'Keyword-qualified Lead',budget:0,archived:true}
];
export const campaignInfo = id => campaigns.find(c=>c.id===id);
export function completeInventory(rows, inventory, kind, scope) {
 const result=rows.slice(), present=new Set(rows.map(r=>r.id));
 for(const r of inventory) if(r.kind===kind&&scope.includes(kind==='campaign_id'?r.id:r.campaign_id)&&!present.has(r.id)) {
  result.push({id:r.id,name:r.name,campaign_id:kind==='campaign_id'?r.id:r.campaign_id,adset_id:r.adset_id,spend:0,impressions:0,link_clicks:0});present.add(r.id);
 }
 return result;
}
