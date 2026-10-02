export function initAdminProspects({$,post,esc,money}){
 let generation=0,running=false,rows=[],seen=new Set(),scanned=0,checked=0,excluded=0,unverified=0,complete=false,optionsLoaded=false,optionsLoading=false,optionsGeneration=0,communities=[];
 const conditionLabels={needs_renovation:'Renovation likely needed',no_obvious_renovation:'No obvious renovation needed',unable_to_assess:'Unable to assess',unreviewed:'Not reviewed'};
 let picked=new Set(),reviewing=false,reviewGeneration=0,plans=[];
 const qualifiedPicked=()=>rows.filter(r=>r.result==='qualified'&&picked.has(r.listingKey));
 function visibleRows(){
  const region=$('prospectRegion').value,status=$('prospectStatus').value,q=$('prospectSearch').value.toLowerCase().trim(),show=$('prospectReview').checked,condition=$('prospectConditionFilter').value;
  const rank={needs_renovation:0,unable_to_assess:1,unreviewed:2,no_obvious_renovation:3};
  return rows.filter(r=>(show?r.result==='unverified':r.result==='qualified')&&(!region||r.region===region)&&(!status||r.status===status)&&(!q||[r.address,r.city,r.listingKey].join(' ').toLowerCase().includes(q))&&(!condition||(r.assessment?.category||'unreviewed')===condition)).sort((a,b)=>($('prospectConditionSort').value==='renovation'?rank[a.assessment?.category||'unreviewed']-rank[b.assessment?.category||'unreviewed']:0)||b.eventDate.localeCompare(a.eventDate));
 }
 function conditionCell(r){
  if(r.result!=='qualified')return '<td>—</td>';
  const a=r.assessment;return `<td class="prospect-condition-cell">${a?`<span class="pill ${a.category==='needs_renovation'?'blocked':a.category==='no_obvious_renovation'?'ready':''}">${esc(conditionLabels[a.category]||'Unable to assess')}</span><p class="prospect-quick-note">${esc(a.note)}</p><small>${esc(a.source==='photos'?'Photos · GPT-4.1 mini':a.source==='manual'?'Admin correction':'Listing remarks')} · ${esc(a.confidence||'')}<br>${a.reviewedAt?esc(new Date(a.reviewedAt).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})):''}</small><details><summary>Evidence &amp; suggestions</summary><p>${esc(a.reason||'')}</p>${(a.evidence||[]).map(e=>`<blockquote>${esc(e.text)}<br><small>${esc(e.field)}</small></blockquote>`).join('')}${(a.areas||[]).map(v=>`<p><strong>${esc(v.area)}</strong>: ${esc(v.observation)}<br>${esc(v.suggestion)}${v.photoNumbers?.length?'<br><small>Photos '+v.photoNumbers.map(n=>esc(String(n))).join(', ')+'</small>':''}</p>`).join('')}${a.photos?.length?'<div class="prospect-evidence-photos">'+a.photos.map(p=>`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.url)}" alt="Reviewed photo ${p.number}" loading="lazy" referrerpolicy="no-referrer"><span>${p.number}</span></a>`).join('')+'</div>':''}</details>`:'<span class="muted">Not reviewed</span>'}<details><summary>Correct assessment</summary><label class="sr-only" for="condition-${esc(r.listingKey)}">Renovation category</label><select id="condition-${esc(r.listingKey)}" data-condition-category>${Object.entries(conditionLabels).filter(([k])=>k!=='unreviewed').map(([k,v])=>`<option value="${k}" ${k===(a?.category||'unable_to_assess')?'selected':''}>${v}</option>`).join('')}</select><textarea data-condition-note aria-label="Your condition note" maxlength="400" placeholder="Short note about possible updates">${esc(a?.note||'')}</textarea><button class="secondary" type="button" data-condition-save="${esc(r.listingKey)}" ${running||reviewing?'disabled':''}>Save correction</button></details></td>`;
 }
 function conditionControls(){
  const count=qualifiedPicked().length;$('prospectSelectionCount').textContent=count+' selected';
  for(const id of ['prospectRemarks','prospectPhotoQuote'])$(id).disabled=running||reviewing||!count;
  for(const id of ['prospectSelectVisible','prospectClearSelected'])$(id).disabled=running||reviewing;
  $('prospectReviewStop').hidden=!reviewing;
  const qualified=rows.filter(r=>r.result==='qualified');$('prospectConditionCounts').textContent=Object.entries(conditionLabels).map(([key,label])=>qualified.filter(r=>(r.assessment?.category||'unreviewed')===key).length+' '+label.toLowerCase()).join(' · ');
 }
 const conditionPost=(r,mode,extras={})=>post('/api/admin/prospects/condition',{reviewProof:r.reviewProof,mode,...extras});
 async function reviewBatch(mode){
  if(running||reviewing)return;const selected=qualifiedPicked();if(!selected.length)return;
  plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectError').hidden=true;reviewing=true;const id=++reviewGeneration;let done=0,errors=0;render();
  try{for(const r of selected){if(id!==reviewGeneration)return;$('prospectConditionProgress').textContent=(mode==='quote'?'Preparing photos for ':'Checking remarks for ')+r.address+' · '+done+'/'+selected.length;
    try{const answer=await conditionPost(r,mode);if(id!==reviewGeneration)return;if(answer.assessment)r.assessment=answer.assessment;else if(answer.quote)plans.push({row:r,quote:answer.quote,estimatedUsd:answer.estimatedUsd,photoCount:answer.photoCount,retryWarning:answer.retryWarning});}
    catch(e){if(id!==reviewGeneration)return;errors++;problem(e.message);}
    done++;render();
   }
   $('prospectConditionProgress').textContent=done+' homes checked.'+(errors?' '+errors+' could not be reviewed.':'');
   if(mode==='quote'&&plans.length){$('prospectPhotoEstimateText').textContent=`Review ${plans.length} homes with GPT-4.1 mini (${plans.reduce((n,p)=>n+p.photoCount,0)} photos). Planning estimate: up to about US$${plans.reduce((n,p)=>n+p.estimatedUsd,0).toFixed(2)}. Actual token billing may differ. Saved photo reviews were skipped. Brief upgrade notes are included.${plans.some(p=>p.retryWarning)?' A previous attempt failed or timed out and may have incurred a charge. Starting again authorizes a new paid attempt.':''}`;$('prospectPhotoEstimate').hidden=false;}
  }finally{if(id===reviewGeneration){reviewing=false;render();}}
 }
 async function photoReview(){
  if(running||reviewing||!plans.length)return;const batch=[...plans];plans=[];$('prospectPhotoEstimate').hidden=true;reviewing=true;const id=++reviewGeneration;let done=0;render();
  try{for(const p of batch){if(id!==reviewGeneration)return;$('prospectConditionProgress').textContent=`Reviewing photos for ${p.row.address} · ${done}/${batch.length}`;
    try{const answer=await conditionPost(p.row,'photos',{quote:p.quote});if(id!==reviewGeneration)return;p.row.assessment=answer.assessment;done++;}
    catch(e){if(id!==reviewGeneration)return;problem(e.message);}render();
   }$('prospectConditionProgress').textContent=`Photo review finished: ${done} of ${batch.length} assessments saved.`;
  }finally{if(id===reviewGeneration){reviewing=false;render();}}
 }

 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const selected=id=>Array.from($(id).querySelectorAll('input:checked'),input=>input.value);
 const problem=message=>{$('prospectError').textContent=message;$('prospectError').hidden=false;};
 function renderSelections(){
  const label=values=>values.length?values.length<=3?values.join(' + '):values.length+' selected':'None selected';
  $('prospectMunicipalitySummary').textContent=label(selected('prospectMunicipalities'));
  $('prospectDistrictSummary').textContent=label(selected('prospectDistricts'));
  $('prospectCommunityChips').innerHTML=communities.map((name,i)=>`<button type="button" class="prospect-chip" data-community-remove="${i}" aria-label="Remove ${esc(name)}">${esc(name)} <span aria-hidden="true">×</span></button>`).join('');
  $('prospectDateWindow').textContent=($('prospectDateFrom').value||'Choose start')+' → '+($('prospectDateTo').value||'Choose end');
 }
 function addCommunities(){
  if(running)return false;
  const input=$('prospectCommunity'),names=input.value.split(/[,;\n]+/).map(v=>v.trim().replace(/\s+/g,' ')).filter(Boolean);
  if(names.some(v=>v.length>120)){problem('Each community name must be 120 characters or fewer.');return false;}
  const next=[...new Map([...communities,...names].map(v=>[v.toLowerCase(),v])).values()];
  if(next.length>40){problem('Choose up to 40 communities in one scan.');return false;}
  communities=next;input.value='';$('prospectError').hidden=true;renderSelections();return true;
 }
 function dates(preset='default'){
  const through=today(),from=new Date(through+'T12:00:00Z');if(preset!=='default')from.setUTCDate(from.getUTCDate()-Number(preset)+1);
  $('prospectDateFrom').value=preset==='default'?'2026-09-01':from.toISOString().slice(0,10);$('prospectDateTo').value=through;
  $('prospectDateFrom').max=$('prospectDateTo').max=through;renderSelections();
 }
 function render(){
  $('prospectThrough').textContent=today();renderSelections();
  $('prospectStats').innerHTML=[['Qualified',rows.filter(x=>x.result==='qualified').length],['Checked',checked],['Excluded',excluded],['Unverified',unverified]].map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-number">${value}</strong></div>`).join('');
  const visible=visibleRows();
  $('prospectRows').innerHTML=visible.map(r=>`<tr><td>${r.result==='qualified'?`<input type="checkbox" data-condition-pick="${esc(r.listingKey)}" aria-label="Select ${esc(r.address)} for review" ${picked.has(r.listingKey)?'checked':''} ${running||reviewing?'disabled':''}>`:''}</td><td><strong>${esc(r.address)}</strong><br><span class="muted">${esc(r.city)}${r.community?' · '+esc(r.community):''} · ${esc(r.listingKey)}</span></td><td>${esc(r.status)}<br><span class="muted">${esc(r.eventDate)}</span></td><td>${esc(r.propertyType)}<br>${money(r.askingPrice)}</td><td>Owner occupied<br><span class="muted">MLS declaration</span></td><td><span class="pill ${r.result==='qualified'?'ready':'blocked'}">${r.result==='qualified'?'No later listing found':'Unverified'}</span><br><span class="muted">${esc(r.reason)}</span><br><small>${r.checkedAt?'Checked '+esc(new Date(r.checkedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})):''}</small></td>${conditionCell(r)}</tr>`).join('');
  $('prospectEmpty').hidden=visible.length>0;$('prospectEmpty').textContent=running?'Searching and checking property history…':complete?'No listings match this view.':'Start a search to check the connected MLS records.';
  $('prospectScanFilters').disabled=running;
  $('prospectExport').disabled=!rows.some(r=>r.result==='qualified');$('prospectStart').disabled=running||reviewing;conditionControls();$('prospectStop').hidden=!running;
 }
 async function start(){
  if(running||reviewing)return;
  const min=$('prospectMinPrice'),max=$('prospectMaxPrice'),from=$('prospectDateFrom'),to=$('prospectDateTo');from.max=to.max=today();
  for(const input of [min,max,from,to])if(!input.reportValidity())return;
  if(min.value!==''&&max.value!==''&&Number(min.value)>Number(max.value)){problem('Minimum price must not exceed maximum price.');return;}
  if(from.value>to.value){problem('The start date must not be after the end date.');return;}
  if(!addCommunities())return;
  const filters={municipalities:selected('prospectMunicipalities'),districts:selected('prospectDistricts'),communities:[...communities],dateFrom:from.value,dateTo:to.value,status:$('prospectScanStatus').value,minPrice:min.value===''?null:Number(min.value),maxPrice:max.value===''?null:Number(max.value)};
  const scanLabel=[[...filters.municipalities,...filters.districts].join(' + ')||'Toronto + York',filters.communities.join(' + ')||'all communities',filters.dateFrom+' → '+filters.dateTo,filters.status||'both statuses',filters.minPrice!==null||filters.maxPrice!==null?(filters.minPrice!==null?money(filters.minPrice):'No minimum')+' – '+(filters.maxPrice!==null?money(filters.maxPrice):'no maximum'):'all prices'].join(' · ');
  const id=++generation;reviewGeneration++;picked.clear();plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectConditionProgress').textContent='';running=true;rows=[];seen=new Set();scanned=checked=excluded=unverified=0;complete=false;$('prospectError').hidden=true;render();let cursor=null;const cursors=new Set();
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
  if(optionsLoaded||optionsLoading)return;optionsLoading=true;const id=optionsGeneration;$('prospectOptionsNote').textContent='Loading MLS community choices…';
  try{const data=await post('/api/admin/prospects/options',{});if(id!==optionsGeneration)return;const names=(data.communities||[]).filter(x=>typeof x==='string');$('prospectCommunityOptions').innerHTML=names.map(x=>`<option value="${esc(x)}"></option>`).join('');optionsLoaded=true;$('prospectOptionsNote').textContent=names.length?'Choose communities within your selected areas, and press Add for each.':'Enter the MLS community name, or leave blank for all.';}
  catch{if(id===optionsGeneration)$('prospectOptionsNote').textContent='Suggestions are unavailable. Enter the MLS community name, or leave blank for all.';}
  finally{if(id===optionsGeneration)optionsLoading=false;}
 });
 $('prospectCommunityAdd').addEventListener('click',addCommunities);
 $('prospectCommunity').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCommunities();}});
 $('prospectCommunityChips').addEventListener('click',event=>{const button=event.target.closest('[data-community-remove]');if(button&&!running){communities.splice(Number(button.dataset.communityRemove),1);renderSelections();}});
 for(const id of ['prospectMunicipalities','prospectDistricts','prospectDateFrom','prospectDateTo'])$(id).addEventListener('change',renderSelections);
 for(const button of $('prospectScanFilters').querySelectorAll('[data-prospect-days]'))button.addEventListener('click',()=>{if(!running)dates(button.dataset.prospectDays);});
 $('prospectResetFilters').addEventListener('click',()=>{if(running)return;for(const input of $('prospectScanFilters').querySelectorAll('input[type="checkbox"]'))input.checked=false;communities=[];$('prospectCommunity').value='';$('prospectMinPrice').value='';$('prospectMaxPrice').value='';$('prospectScanStatus').value='';$('prospectError').hidden=true;dates();});
 $('prospectStart').addEventListener('click',start);
 $('prospectStop').addEventListener('click',()=>{generation++;running=false;complete=false;$('prospectProgress').textContent='Stopped. Results cover only the checks completed so far. Start again for a fresh full scan.';render();});
 for(const id of ['prospectRegion','prospectStatus','prospectReview','prospectSearch'])$(id).addEventListener('input',render);
 $('prospectExport').addEventListener('click',()=>{
  const values=[['MLS','Address','City','Community','Status','End date','Asking price','Occupancy','Relisting check','Checked at','Coverage','Renovation','Quick note','Assessment source','Assessment date'],...rows.filter(r=>r.result==='qualified').map(r=>[r.listingKey,r.address,r.city,r.community,r.status,r.eventDate,r.askingPrice,'Owner occupied (MLS declaration)',r.reason,r.checkedAt,complete?'Available feed scan completed':'Partial scan',r.assessment?.label||'Not reviewed',r.assessment?.note||'',r.assessment?.source||'',r.assessment?.reviewedAt||''])];
  const csv=values.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'\u0024&").replaceAll('"','""')+'"').join(',')).join('\r\n');
  const href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=href;a.download='THM-expired-terminated-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 });

 $('prospectRows').addEventListener('change',e=>{const key=e.target.dataset.conditionPick;if(key&&!running&&!reviewing){e.target.checked?picked.add(key):picked.delete(key);plans=[];$('prospectPhotoEstimate').hidden=true;conditionControls();}});
 $('prospectRows').addEventListener('click',async e=>{const button=e.target.closest('[data-condition-save]');if(!button||running||reviewing)return;const row=rows.find(r=>r.listingKey===button.dataset.conditionSave),box=button.closest('details');if(!row)return;const category=box.querySelector('[data-condition-category]').value,note=box.querySelector('[data-condition-note]').value.trim();if(!note){problem('Enter a short note before saving.');return;}button.disabled=true;const id=reviewGeneration;try{const answer=await conditionPost(row,'manual',{category,note});if(id!==reviewGeneration)return;row.assessment=answer.assessment;render();}catch(e){if(id===reviewGeneration){problem(e.message);button.disabled=false;}}});
 $('prospectSelectVisible').addEventListener('click',()=>{if(running||reviewing)return;visibleRows().filter(r=>r.result==='qualified').forEach(r=>picked.add(r.listingKey));plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectClearSelected').addEventListener('click',()=>{if(running||reviewing)return;picked.clear();plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectRemarks').addEventListener('click',()=>reviewBatch('remarks'));
 $('prospectPhotoQuote').addEventListener('click',()=>reviewBatch('quote'));
 $('prospectPhotoConfirm').addEventListener('click',photoReview);
 $('prospectPhotoCancel').addEventListener('click',()=>{plans=[];$('prospectPhotoEstimate').hidden=true;});
 $('prospectReviewStop').addEventListener('click',()=>{reviewGeneration++;reviewing=false;plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectConditionProgress').textContent='Stopped. An in-flight review may finish and be saved; load saved assessments to retrieve it.';render();});
 for(const id of ['prospectConditionFilter','prospectConditionSort'])$(id).addEventListener('change',render);
 dates();render();return {start,render,clear(){generation++;reviewGeneration++;reviewing=false;picked.clear();plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectConditionProgress').textContent='';optionsGeneration++;running=false;optionsLoaded=false;optionsLoading=false;$('prospectCommunityOptions').innerHTML='';$('prospectOptionsNote').textContent='';rows=[];seen.clear();scanned=checked=excluded=unverified=0;complete=false;$('prospectProgress').textContent='';$('prospectError').hidden=true;render();}};
}
