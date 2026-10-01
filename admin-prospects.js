export function initAdminProspects({$,post,esc,money}){
 let generation=0,running=false,rows=[],seen=new Set(),scanned=0,checked=0,excluded=0,unverified=0,complete=false,optionsLoaded=false,optionsLoading=false;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function render(){
  $('prospectThrough').textContent=today();
  $('prospectStats').innerHTML=[['Qualified',rows.filter(x=>x.result==='qualified').length],['Checked',checked],['Excluded',excluded],['Unverified',unverified]].map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-number">${value}</strong></div>`).join('');
  const region=$('prospectRegion').value,status=$('prospectStatus').value,q=$('prospectSearch').value.toLowerCase().trim(),show=$('prospectReview').checked;
  const visible=rows.filter(r=>(show?r.result==='unverified':r.result==='qualified')&&(!region||r.region===region)&&(!status||r.status===status)&&(!q||[r.address,r.city,r.listingKey].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.eventDate.localeCompare(a.eventDate));
  $('prospectRows').innerHTML=visible.map(r=>`<tr><td><strong>${esc(r.address)}</strong><br><span class="muted">${esc(r.city)}${r.community?' · '+esc(r.community):''} · ${esc(r.listingKey)}</span></td><td>${esc(r.status)}<br><span class="muted">${esc(r.eventDate)}</span></td><td>${esc(r.propertyType)}<br>${money(r.askingPrice)}</td><td>Owner occupied<br><span class="muted">MLS declaration</span></td><td><span class="pill ${r.result==='qualified'?'ready':'blocked'}">${r.result==='qualified'?'No later listing found':'Unverified'}</span><br><span class="muted">${esc(r.reason)}</span><br><small>${r.checkedAt?'Checked '+esc(new Date(r.checkedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})):''}</small></td></tr>`).join('');
  $('prospectEmpty').hidden=visible.length>0;$('prospectEmpty').textContent=running?'Searching and checking property history…':complete?'No listings match this view.':'Start a search to check the connected MLS records.';
  $('prospectScanFilters').disabled=running;
  $('prospectExport').disabled=!rows.some(r=>r.result==='qualified');$('prospectStart').disabled=running;$('prospectStop').hidden=!running;
 }
 async function start(){
  if(running)return;
  const min=$('prospectMinPrice'),max=$('prospectMaxPrice');
  for(const input of [min,max])if(!input.reportValidity())return;
  if(min.value!==''&&max.value!==''&&Number(min.value)>Number(max.value)){$('prospectError').textContent='Minimum price must not exceed maximum price.';$('prospectError').hidden=false;return;}
  const filters={municipality:$('prospectMunicipality').value,community:$('prospectCommunity').value.trim(),minPrice:min.value===''?null:Number(min.value),maxPrice:max.value===''?null:Number(max.value)};
  const scanLabel=[filters.municipality||'Toronto + York',filters.community||'all communities',filters.minPrice!==null||filters.maxPrice!==null?(filters.minPrice!==null?money(filters.minPrice):'No minimum')+' – '+(filters.maxPrice!==null?money(filters.maxPrice):'no maximum'):'all prices'].join(' · ');
  const id=++generation;running=true;rows=[];seen=new Set();scanned=checked=excluded=unverified=0;complete=false;$('prospectError').hidden=true;render();let cursor=null;const cursors=new Set();
  try{
   do{
    $('prospectProgress').textContent=`Searching expired and terminated listings… ${scanned} source records scanned. ${scanLabel}`;
    const page=await post('/api/admin/prospects/search',{cursor,...(!cursor?{filters}:{})});if(id!==generation)return;
    if(cursors.has(page.pageId))throw Error('The provider repeated a page. Search is incomplete.');cursors.add(page.pageId);
    scanned=page.scanned;excluded+=Object.values(page.excluded||{}).reduce((a,b)=>a+b,0);
    for(const candidate of page.candidates||[]){
     if(seen.has(candidate.listingKey))continue;seen.add(candidate.listingKey);
     $('prospectProgress').textContent=`Checking ${candidate.address} · ${scanned} source records scanned · ${checked} histories checked.`;
     let result;try{result=await post('/api/admin/prospects/verify',{proof:candidate.proof});}catch(e){result={...candidate,proof:undefined,result:'unverified',reason:e.message};}
     if(id!==generation)return;checked++;if(result.result==='qualified'){
      const key=[result.city,result.address].join('|').toLowerCase();const prior=rows.findIndex(r=>r.result==='qualified'&&[r.city,r.address].join('|').toLowerCase()===key);
      if(prior<0)rows.push(result);else if(result.eventDate>rows[prior].eventDate)rows[prior]=result;
     }else if(result.result==='excluded')excluded++;else {unverified++;rows.push(result);}render();
    }
    cursor=page.cursor;complete=page.complete;
    if(page.incompleteReason)throw Error(page.incompleteReason);
   }while(cursor&&id===generation);
   $('prospectProgress').textContent=`${complete?'Available feed scan finished':'Incomplete search'} · ${scanned} records scanned · ${checked} histories checked. ${scanLabel}. ${unverified?'Unverified records are excluded from qualified results.':''}`;
  }catch(e){if(id!==generation)return;$('prospectError').textContent=e.message;$('prospectError').hidden=false;$('prospectProgress').textContent='Search incomplete. Displayed results cover only completed checks.';}
  finally{if(id===generation){running=false;render();}}
 }
 $('prospectCommunity').addEventListener('focus',async()=>{
  if(optionsLoaded||optionsLoading)return;optionsLoading=true;const id=generation;$('prospectOptionsNote').textContent='Loading MLS community choices…';
  try{const data=await post('/api/admin/prospects/options',{});if(id!==generation)return;const names=(data.communities||[]).filter(x=>typeof x==='string');$('prospectCommunityOptions').innerHTML=names.map(x=>`<option value="${esc(x)}"></option>`).join('');optionsLoaded=true;$('prospectOptionsNote').textContent=names.length?'Choose or enter a community within your selected municipality.':'Enter the MLS community name, or leave blank for all.';}
  catch{if(id===generation)$('prospectOptionsNote').textContent='Suggestions are unavailable. Enter the MLS community name, or leave blank for all.';}
  finally{optionsLoading=false;}
 });
 $('prospectStart').addEventListener('click',start);
 $('prospectStop').addEventListener('click',()=>{generation++;running=false;complete=false;$('prospectProgress').textContent='Stopped. Results cover only the checks completed so far. Start again for a fresh full scan.';render();});
 for(const id of ['prospectRegion','prospectStatus','prospectReview','prospectSearch'])$(id).addEventListener('input',render);
 $('prospectExport').addEventListener('click',()=>{
  const values=[['MLS','Address','City','Community','Status','End date','Asking price','Occupancy','Relisting check','Checked at','Coverage'],...rows.filter(r=>r.result==='qualified').map(r=>[r.listingKey,r.address,r.city,r.community,r.status,r.eventDate,r.askingPrice,'Owner occupied (MLS declaration)',r.reason,r.checkedAt,complete?'Available feed scan completed':'Partial scan'])];
  const csv=values.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'\u0024&").replaceAll('"','""')+'"').join(',')).join('\r\n');
  const href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=href;a.download='THM-expired-terminated-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 });
 render();return {start,render,clear(){generation++;running=false;optionsLoaded=false;optionsLoading=false;$('prospectCommunityOptions').innerHTML='';$('prospectOptionsNote').textContent='';rows=[];seen.clear();scanned=checked=excluded=unverified=0;complete=false;$('prospectProgress').textContent='';$('prospectError').hidden=true;render();}};
}
