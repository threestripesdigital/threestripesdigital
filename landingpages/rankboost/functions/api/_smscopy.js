import { qualifiedKeywordEmailFields } from './_emailfields.js';
import { projectKeywords } from './_rankmodel.js';
export function smsScan(row={}) {
 let keywords=[];
 try { keywords=JSON.parse(row.top_keywords||'[]'); } catch { /* Omit value without scan data. */ }
 const top=projectKeywords(row.domain||'',Array.isArray(keywords)?keywords:[],8).keywords[0];
 return {keyword:top?.keyword||row.keyword||'',position:top?.position||row.position||'',gap:top?qualifiedKeywordEmailFields(top).opp_upside:'',others:Math.max(0,Number(row.total_boost_fits||0)-1)};
}
export function scanLine(s) {return s.keyword&&s.position?`Your scan found "${s.keyword}" at #${s.position}.`:'';}
export function recoveryText(name,kind,scan,url) {
 return `Hi ${name||'there'}, Bilal from Three Stripes Digital here. ${kind==='no_show'?'We missed you on your free boost call.':'Your free boost call was canceled.'} ${scanLine(scan)}${scan.gap?` Can you afford to miss ${scan.gap}/month in potential case value?`:''} Your first boost is free. Rebook: ${url} I personally read every reply. Reply STOP to opt out.`;
}
