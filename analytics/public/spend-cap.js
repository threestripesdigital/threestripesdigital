const CAMPAIGN='120249151255100545';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(minor,currency)=>Number.isFinite(minor)?new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:2}).format(minor/100):'Unavailable';
const count=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US').format(n):'Unavailable';
const at=value=>value?new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not yet';
export function initSpendCap(request,reviewResults){
 let snapshot=null,busy=false,loading=false,dialogGeneration=0,confirmedCapMinor=null;
 const estimate=minor=>snapshot?.currency===snapshot?.reportingCurrency?money(minor,snapshot.currency):Number.isFinite(snapshot?.fxRate)&&snapshot.fxRate>0&&Number.isFinite(minor)?'≈ '+money(minor/snapshot.fxRate,snapshot.reportingCurrency):'Unavailable';
 const removable=()=>!!snapshot?.canRemove&&!snapshot.stale&&!snapshot.error&&Number.isFinite(snapshot.capMinor)&&snapshot.capMinor>0;
 function render(){
  const s=snapshot,level=s?.stale||s?.error?'unavailable':s?.level||'unavailable';
  const labels={normal:'Cap in place',warning:'Approaching cap',urgent:'Nearly at cap',reached:'Cap reached',uncapped:'No campaign cap',unavailable:'Needs refresh'};
  $('#cap-status').textContent=labels[level]||labels.unavailable;
  $('#cap-status').className='badge '+({normal:'unrated',warning:'ok',urgent:'bad',reached:'bad',uncapped:'unrated'}[level]||'unrated');
  $('#spend-cap-panel').dataset.level=level;
  const messages={normal:'Your total spending limit is in place. Warnings start at 70%, then become urgent at 85%.',warning:'You have used at least 70% of the cap. Review your results before the remaining budget runs out.',urgent:'You have used at least 85% of the cap. Review your results now to avoid an interruption.',reached:'The reported spend has reached the cap. Meta may stop delivery at this limit. Review results before continuing.',uncapped:'No campaign spending cap is set. Enabled ads continue under their daily budgets.',unavailable:'Current cap information is unavailable. Refresh before changing it.'};
  $('#cap-message').textContent=messages[level]||messages.unavailable;
  const metrics=[['Total spent',s?.spentMinor],['Remaining',s?.remainingMinor],['Campaign cap',s?.capMinor]];
  $('#cap-metrics').innerHTML=metrics.map(([label,value])=>`<div><span>${label}</span><strong>${level==='uncapped'&&label!=='Total spent'?'No cap':estimate(value)}</strong></div>`).join('');
  const progress=Number.isFinite(s?.percentUsed)&&s.capMinor>0;
  $('#cap-progress-wrap').classList.toggle('hidden',!progress);
  if(progress){$('#cap-progress').value=Math.min(100,Math.max(0,s.percentUsed));$('#cap-progress-label').textContent=`${s.percentUsed.toFixed(1)}% of the campaign cap used${s.stale?' (last known)':''}`;}
  const pace=Number.isFinite(s?.daysRemainingAtBudget)&&s.daysRemainingAtBudget>0?` ${s.daysRemainingAtBudget<1?'Less than 1 day':'About '+s.daysRemainingAtBudget.toFixed(1)+' days'} remaining at the current daily budget.`:'';
  $('#cap-note').textContent=s?`${money(s.spentMinor,s.currency)} spent${s.capMinor>0?' of '+money(s.capMinor,s.currency):''} in Meta billing currency. Full campaign spend, independent of the date filter. ${Number.isFinite(s.dailyBudgetMinor)?estimate(s.dailyBudgetMinor)+'/day across enabled ad sets.':'Enabled daily budget is unavailable.'}${pace} Reporting can lag.`:'Waiting for a current Meta reading.';
  $('#cap-last-sync').textContent='Cap checked '+at(s?.checkedAt)+(s?.stale?' (stale)':'');
  $('#cap-remove').disabled=busy||!removable();$('#cap-remove').classList.toggle('hidden',level==='uncapped');
 }
 async function load(){if(loading||busy)return;loading=true;try{snapshot=await request(`/api/spend-cap?campaign=${CAMPAIGN}`);}catch{snapshot={...snapshot,stale:true,error:'Cap refresh failed',canRemove:false};}finally{loading=false;render();}}
 function performance(report){
  const forms=report.formFillReporting?.ready?report.formFillReporting.total:null;
  const bookings=report.bookingReporting?.ready?report.bookingReporting.verifiedMeta:null;
  const spend=report.totals?.spend;
  const currency=report.period?.currency||'USD';
  const cost=(n)=>Number.isFinite(spend)&&n>0?money(spend/n*100,currency):'Not available';
  const stale=report.stale||report.bookingReporting?.stale;
  return `<h3>Full-run results before you decide</h3><p class="section-note">${esc(report.period?.start)} to ${esc(report.period?.end)}. ${stale?'Some performance data is stale. ':''}Small samples are directional.</p><div class="cap-outcomes"><div><span>Form fills</span><strong>${count(forms)}</strong><small>${cost(forms)} per form</small></div><div><span>Verified booked calls</span><strong>${count(bookings)}</strong><small>${cost(bookings)} per call</small></div></div><div class="table-wrap"><table><thead><tr><th>Ad set</th><th class="num">Spend</th><th class="num">Forms</th><th class="num">Cost / form</th></tr></thead><tbody>${(report.adsets||[]).map(row=>`<tr><td>${esc(row.name)}</td><td class="num">${money(row.spend*100,currency)}</td><td class="num">${count(row.form_fills)}</td><td class="num">${Number.isFinite(row.cost_per_form)?money(row.cost_per_form*100,currency):'Not available'}</td></tr>`).join('')}</tbody></table></div><p class="section-note">Form fills are completed applications. Booked calls have verified campaign attribution. Review quality as well as cost.</p>`;
 }
 $('#cap-review-results').onclick=reviewResults;
 $('#cap-remove').onclick=async()=>{
  if(!removable()||busy)return;
  const generation=++dialogGeneration;confirmedCapMinor=snapshot.capMinor;
  $('#cap-confirm-detail').textContent=`Remove the ${money(snapshot.capMinor,snapshot.currency)} total cap for ${snapshot.campaignName||'the v2 campaign'}? The current enabled daily budget is ${estimate(snapshot.dailyBudgetMinor)} in total.`;
  $('#cap-dialog-result').textContent='';$('#cap-results').textContent='Loading full-run results...';$('#cap-confirm').disabled=false;$('#cap-dialog').showModal();
  try{const report=await request(`/api/report?campaign=${CAMPAIGN}&days=history&compare=0`);if(generation===dialogGeneration)$('#cap-results').innerHTML=performance(report);}catch{if(generation===dialogGeneration)$('#cap-results').textContent='Performance data could not be loaded. Review your results in Meta before deciding.';}
 };
 function close(){if(busy)return;dialogGeneration++;$('#cap-dialog').close();}
 $('#cap-dialog-close').onclick=close;$('#cap-cancel').onclick=close;
 $('#cap-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else dialogGeneration++;});
 $('#cap-confirm').onclick=async()=>{
  if(busy||!removable())return;busy=true;$('#cap-confirm').disabled=true;$('#cap-cancel').disabled=true;$('#cap-dialog-close').disabled=true;$('#cap-dialog-result').textContent='Removing cap and verifying Meta...';render();
  try{
   const result=await request('/api/spend-cap/remove',{campaignId:CAMPAIGN,expectedCapMinor:confirmedCapMinor,confirmation:'REMOVE_CAMPAIGN_CAP'});
   snapshot=result.snapshot||result;
   if(snapshot.level!=='uncapped'||snapshot.stale||snapshot.error)throw Error('Removal has not been verified. Refresh the cap before trying again.');
   $('#cap-dialog').close();dialogGeneration++;render();
  }catch(error){$('#cap-dialog-result').textContent=error.message||'Removal could not be verified. Refresh the cap before trying again.';snapshot={...snapshot,stale:true,canRemove:false};render();}
  finally{busy=false;$('#cap-cancel').disabled=false;$('#cap-dialog-close').disabled=false;$('#cap-confirm').disabled=!removable();render();}
 };
 $('#refresh').addEventListener('click',()=>{load();setTimeout(load,6000);});
 load();setInterval(()=>{if(!document.hidden&&!$('#cap-dialog').open)load();},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#cap-dialog').open)load();});
}
