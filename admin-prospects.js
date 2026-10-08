export function initAdminProspects({$,post,esc,money}){
 let generation=0,running=false,rows=[],seen=new Set(),scanned=0,checked=0,excluded=0,unverified=0,complete=false,optionsLoaded=false,optionsLoading=false,optionsGeneration=0,communities=[],communityNames=[];
 // Display grouping from TRREB's April 2026 MLS HPI community tables:
 // https://www.taleenchouljian.com/hosted/users/48031/202604_TRREB_HPI.pdf
 // Never rewrite MLS option values or infer search filters from these headings.
 const communityAreas={
  "Aurora":["Aurora Estates","Aurora Grove","Aurora Heights","Aurora Highlands","Aurora Village","Bayview Northeast","Bayview Southeast","Bayview Wellington","Hills of St Andrew","Rural Aurora"],
  "East Gwillimbury":["Holland Landing","Mt Albert","Queensville","Rural East Gwillimbury","Sharon"],
  "Georgina":["Baldwin","Historic Lakeshore Communities","Keswick North","Keswick South","Pefferlaw","Sutton & Jackson's Point","Virginia"],
  "King":["King City","Nobleton","Pottageville","Rural King","Schomberg"],
  "Markham":["Aileen-Willowbrook","Angus Glen","Bayview Fairway-Bayview Country Club","Bayview Glen","Berczy","Box Grove","Bullock","Buttonville","Cachet","Cathedraltown","Cedar Grove","Cedarwood","Commerce Valley","Cornell","Devil's Elbow","German Mills","Grandview","Greensborough","Legacy","Markham Village","Markville","Middlefield","Milliken Mills East","Milliken Mills West","Old Markham Village","Raymerville","Rouge Fairways","Rouge River Estates","Royal Orchard","Rural Markham","Sherwood-Amberglen","Thornhill","Thornlea","Unionville","Victoria Manor-Jennings Gate","Victoria Square","Village Green-South Unionville","Vinegar Hill","Wismer"],
  "Newmarket":["Armitage","Bristol-London","Central Newmarket","Glenway Estates","Gorham-College Manor","Huron Heights-Leslie Valley","Stonehaven-Wyndham","Summerhill Estates","Woodland Hill"],
  "Richmond Hill":["Bayview Hill","Beaver Creek Business Park","Crosby","Devonsleigh","Doncrest","Harding","Jefferson","Langstaff","Mill Pond","North Richvale","Oak Ridges","Oak Ridges Lake Wilcox","Observatory","Rouge Woods","Rural Richmond Hill","South Richvale","Westbrook"],
  "Toronto C01":["Bay Street Corridor","Dufferin Grove","Kensington-Chinatown","Little Portugal","Niagara","Palmerston-Little Italy","Trinity Bellwoods","University","Waterfront Communities C1"],
  "Toronto C02":["Annex","Casa Loma","Wychwood","Yonge-St. Clair"],
  "Toronto C03":["Forest Hill South","Humewood-Cedarvale","Oakwood-Vaughan","Yonge-Eglinton"],
  "Toronto C04":["Bedford Park-Nortown","Englemount-Lawrence","Forest Hill North","Lawrence Park North","Lawrence Park South"],
  "Toronto C06":["Bathurst Manor","Clanton Park"],
  "Toronto C07":["Lansing-Westgate","Newtonbrook West","Westminister-Branson","Willowdale West"],
  "Toronto C08":["Cabbagetown-South St. Jamestown","Church-Yonge Corridor","Moss Park","North St. Jamestown","Regent Park","Waterfront Communities C8"],
  "Toronto C09":["Rosedale-Moore Park"],
  "Toronto C10":["Mount Pleasant East","Mount Pleasant West"],
  "Toronto C11":["Flemingdon Park","Leaside","Thorncliffe Park"],
  "Toronto C12":["Bridle Path-Sunnybrook-York Mills","St. Andrew-Windfields"],
  "Toronto C13":["Banbury-Don Mills","Parkwoods-Donalda","Victoria Village"],
  "Toronto C14":["Newtonbrook East","Willowdale East"],
  "Toronto C15":["Bayview Village","Bayview Woods-Steeles","Don Valley Village","Henry Farm","Hillcrest Village","Pleasant View"],
  "Toronto E01":["Blake-Jones","Greenwood-Coxwell","North Riverdale","South Riverdale"],
  "Toronto E02":["East End-Danforth","The Beaches","Woodbine Corridor"],
  "Toronto E03":["Broadview North","Crescent Town","Danforth","Danforth Village-East York","East York","O'Connor-Parkview","Playter Estates-Danforth","Woodbine-Lumsden"],
  "Toronto E04":["Clairlea-Birchmount","Dorset Park","Ionview","Kennedy Park","Wexford-Maryvale"],
  "Toronto E05":["L'Amoreaux","Steeles","Tam O'Shanter-Sullivan"],
  "Toronto E06":["Birchcliffe-Cliffside","Oakridge"],
  "Toronto E07":["Agincourt North","Agincourt South- Malvern West","Milliken"],
  "Toronto E08":["Cliffcrest","Eglinton East","Guildwood","Scarborough Village"],
  "Toronto E09":["Bendale","Morningside","Woburn"],
  "Toronto E10":["Centennial Scarborough","Highland Creek","Rouge E10","West Hill"],
  "Toronto E11":["Malvern","Rouge E11"],
  "Toronto W01":["High Park-Swansea","Roncesvalles","South Parkdale"],
  "Toronto W02":["Dovercourt-Wallace Emerson-Junction","High Park North","Junction Area","Lambton Baby Point","Runnymede-Bloor West Village"],
  "Toronto W03":["Caledonia-Fairbank","Corso Italia-Davenport","Keelesdale-Eglinton West","Rockcliffe-Smythe","Weston-Pellam Park"],
  "Toronto W04":["Beechborough-Greenbrook","Briar Hill-Belgravia","Brookhaven-Amesbury","Humberlea-Pelmo Park W4","Maple Leaf","Mount Dennis","Rustic","Weston","Yorkdale-Glen Park"],
  "Toronto W05":["Black Creek","Downsview-Roding-CFB","Glenfield-Jane Heights","Humber Summit","Humberlea-Pelmo Park W5","Humbermede","York University Heights"],
  "Toronto W06":["Alderwood","Long Branch","Mimico","New Toronto"],
  "Toronto W07":["Stonegate-Queensway"],
  "Toronto W08":["Edenbridge-Humber Valley","Eringate-Centennial-West Deane","Etobicoke West Mall","Islington-City Centre West","Kingsway South","Markland Woods","Princess-Rosethorn"],
  "Toronto W09":["Humber Heights","Kingsview Village-The Westway","Willowridge-Martingrove-Richview"],
  "Toronto W10":["Elms-Old Rexdale","Mount Olive-Silverstone-Jamestown","Rexdale-Kipling","Thistletown-Beaumond Heights","West Humber-Claireville"],
  "Vaughan":["Beverley Glen","Brownridge","Concord","Crestwood-Springfarm-Yorkhill","East Woodbridge","Elder Mills","Glen Shields","Islington Woods","Kleinburg","Lakeview Estates","Maple","Patterson","Rural Vaughan","Sonoma Heights","Uplands","Vaughan Corporate Centre","Vaughan Grove","Vellore Village","West Woodbridge"],
  "Whitchurch-Stouffville":["Ballantrae","Rural Whitchurch-Stouffville","Stouffville"],
 };
 const communityKey=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
 const communityAreaByName=new Map(Object.entries(communityAreas).flatMap(([area,names])=>names.map(name=>[communityKey(name),area])));
 const yorkMunicipalities=Object.keys(communityAreas).filter(area=>!area.startsWith('Toronto '));
 function locationScope(){
  const areas=selected('prospectAreas'),municipalities=selected('prospectMunicipalities'),districts=selected('prospectDistricts');
  return {areas,municipalities,districts};
 }
 function showCommunityChoices(names=communityNames){
  communityNames=names;
  const {areas,municipalities,districts}=locationScope(),q=$('prospectCommunitySearch').value.trim().toLowerCase(),groups=new Map();
  for(const name of names){
   const area=communityAreaByName.get(communityKey(name)),isToronto=area?.startsWith('Toronto ');
   if(!area&&(areas.length||municipalities.length||districts.length))continue;
   if(area&&areas.length&&!areas.includes(isToronto?'Toronto':'York'))continue;
   if(area&&(municipalities.length||districts.length)&&!(isToronto?(municipalities.includes('Toronto')||districts.includes(area.slice(8))):municipalities.includes(area)))continue;
   const heading=area||'Other MLS communities';if(q&&!`${heading} ${name}`.toLowerCase().includes(q))continue;
   if(!groups.has(heading))groups.set(heading,[]);groups.get(heading).push(name);
  }
  $('prospectCommunityBrowse').innerHTML=[...groups].sort(([a],[b])=>a==='Other MLS communities'?1:b==='Other MLS communities'?-1:a.localeCompare(b)).map(([area,values])=>`<div class="prospect-community-group"><h4>${esc(area)}</h4>${values.sort((a,b)=>a.localeCompare(b)).map(name=>`<label class="prospect-choice"><input type="checkbox" data-community-choice value="${esc(name)}" ${communities.some(v=>v.toLowerCase()===name.toLowerCase())?'checked':''}><span>${esc(name)}</span></label>`).join('')}</div>`).join('')||(optionsLoaded?'<p class="footnote">No matching communities. You can enter a community name below.</p>':'');
  $('prospectCommunityOptions').innerHTML=names.map(name=>`<option value="${esc(name)}" label="${esc(communityAreaByName.get(communityKey(name))||'Other MLS communities')}"></option>`).join('');
 }
 function updateLocationChoices(){
  const areas=selected('prospectAreas');
  for(const input of $('prospectMunicipalities').querySelectorAll('input'))input.closest('label').hidden=areas.length>0&&!areas.includes(input.value==='Toronto'?'Toronto':'York');
  $('prospectDistricts').hidden=areas.length>0&&!areas.includes('Toronto');
  showCommunityChoices();
 }
 const conditionLabels={needs_renovation:'Renovation likely needed',no_obvious_renovation:'No obvious renovation needed',unable_to_assess:'Unable to assess',unreviewed:'Not reviewed'};
 let picked=new Set(),reviewing=false,reviewGeneration=0,plans=[],selectionSignature='';const selectionListeners=new Set();
 const qualifiedPicked=()=>rows.filter(r=>r.result==='qualified'&&picked.has(r.listingKey));
 function visibleRows(){
  const region=$('prospectRegion').value,status=$('prospectStatus').value,q=$('prospectSearch').value.toLowerCase().trim(),show=$('prospectReview').checked,condition=$('prospectConditionFilter').value;
  const rank={needs_renovation:0,unable_to_assess:1,unreviewed:2,no_obvious_renovation:3};
  return rows.filter(r=>(show?r.result==='unverified':r.result==='qualified')&&(!region||r.region===region)&&(!status||r.status===status)&&(!q||[r.address,r.city,r.listingKey].join(' ').toLowerCase().includes(q))&&(!condition||(r.assessment?.category||'unreviewed')===condition)).sort((a,b)=>($('prospectConditionSort').value==='renovation'?rank[a.assessment?.category||'unreviewed']-rank[b.assessment?.category||'unreviewed']:0)||b.eventDate.localeCompare(a.eventDate));
 }
 function conditionCell(r){
  if(r.result!=='qualified')return '<td>—</td>';
  if(r.propertyClass==='commercial')return '<td><span class="muted">Residential renovation review does not apply.</span></td>';
  const a=r.assessment;return `<td class="prospect-condition-cell">${a?`<span class="pill ${a.category==='needs_renovation'?'blocked':a.category==='no_obvious_renovation'?'ready':''}">${esc(conditionLabels[a.category]||'Unable to assess')}</span><p class="prospect-quick-note">${esc(a.note)}</p><small>${esc(a.source==='photos'?'Photos · GPT-4.1 mini':a.source==='manual'?'Admin correction':'Listing remarks')} · ${esc(a.confidence||'')}<br>${a.reviewedAt?esc(new Date(a.reviewedAt).toLocaleDateString('en-CA',{timeZone:'America/Toronto'})):''}</small><details><summary>Evidence &amp; suggestions</summary><p>${esc(a.reason||'')}</p>${(a.evidence||[]).map(e=>`<blockquote>${esc(e.text)}<br><small>${esc(e.field)}</small></blockquote>`).join('')}${(a.areas||[]).map(v=>`<p><strong>${esc(v.area)}</strong>: ${esc(v.observation)}<br>${esc(v.suggestion)}${v.photoNumbers?.length?'<br><small>Photos '+v.photoNumbers.map(n=>esc(String(n))).join(', ')+'</small>':''}</p>`).join('')}${a.photos?.length?'<div class="prospect-evidence-photos">'+a.photos.map(p=>`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.url)}" alt="Reviewed photo ${p.number}" loading="lazy" referrerpolicy="no-referrer"><span>${p.number}</span></a>`).join('')+'</div>':''}</details>`:'<span class="muted">Not reviewed</span>'}<details><summary>Correct assessment</summary><label class="sr-only" for="condition-${esc(r.listingKey)}">Renovation category</label><select id="condition-${esc(r.listingKey)}" data-condition-category>${Object.entries(conditionLabels).filter(([k])=>k!=='unreviewed').map(([k,v])=>`<option value="${k}" ${k===(a?.category||'unable_to_assess')?'selected':''}>${v}</option>`).join('')}</select><textarea data-condition-note aria-label="Your condition note" maxlength="400" placeholder="Short note about possible updates">${esc(a?.note||'')}</textarea><button class="secondary" type="button" data-condition-save="${esc(r.listingKey)}" ${running||reviewing?'disabled':''}>Save correction</button></details></td>`;
 }
 function conditionControls(){
  const selected=qualifiedPicked(),signature=selected.map(r=>r.listingKey+':'+r.reviewProof).sort().join('|');if(signature!==selectionSignature){selectionSignature=signature;for(const listener of selectionListeners)listener();}
  const count=qualifiedPicked().length;$('prospectSelectionCount').textContent=count+' selected';
  for(const id of ['prospectRemarks','prospectPhotoQuote'])$(id).disabled=running||reviewing||!count||selected.some(r=>r.propertyClass==='commercial');
  const visible=visibleRows().filter(r=>r.result==='qualified'),all=rows.filter(r=>r.result==='qualified'),selectedVisible=visible.filter(r=>picked.has(r.listingKey)).length;
  $('prospectSelectAll').textContent='Select all verified ('+all.length+')';$('prospectSelectAll').disabled=reviewing||!all.length;
  $('prospectSelectVisible').disabled=reviewing||!visible.length;$('prospectClearSelected').disabled=reviewing||!count;
  const checkbox=$('prospectSelectCheckbox');checkbox.disabled=reviewing||!visible.length;checkbox.checked=!!visible.length&&selectedVisible===visible.length;checkbox.indeterminate=selectedVisible>0&&selectedVisible<visible.length;
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
  const label=values=>values.length?values.length<=3?values.join(' + '):values.length+' selected':'Select…';
  $('prospectAreaSummary').textContent=label(selected('prospectAreas'));
  $('prospectMunicipalitySummary').textContent=label([...selected('prospectMunicipalities'),...selected('prospectDistricts').map(v=>'Toronto '+v)]);
  $('prospectCommunitySummary').textContent=label(communities);
  updateLocationChoices();
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
  $('prospectRows').innerHTML=visible.map(r=>`<tr><td>${r.result==='qualified'?`<input type="checkbox" data-condition-pick="${esc(r.listingKey)}" aria-label="Select ${esc(r.address)} for mailing or review" ${picked.has(r.listingKey)?'checked':''} ${reviewing?'disabled':''}>`:''}</td><td><strong>${esc(r.address)}</strong><br><span class="muted">${esc(r.city)}${r.community?' · '+esc(r.community):''} · ${esc(r.listingKey)}</span></td><td>${esc(r.status)}<br><span class="muted">${esc(r.eventDate)}</span></td><td>${esc(r.propertyType)}<br>${money(r.askingPrice)}</td><td>Owner occupied<br><span class="muted">MLS declaration</span></td><td><span class="pill ${r.result==='qualified'?'ready':'blocked'}">${r.result==='qualified'?'No later listing found':'Unverified'}</span><br><span class="muted">${esc(r.reason)}</span><br><small>${r.checkedAt?'Checked '+esc(new Date(r.checkedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})):''}</small></td>${conditionCell(r)}</tr>`).join('');
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
  const scope=locationScope();
  const areaDefaults=scope.areas.flatMap(area=>area==='Toronto'?['Toronto']:yorkMunicipalities);
  const filters={propertyClass:$('prospectClass').querySelector('input:checked').value,municipalities:scope.municipalities.length||scope.districts.length?scope.municipalities:areaDefaults,districts:scope.districts,communities:[...communities],dateFrom:from.value,dateTo:to.value,status:$('prospectScanStatus').value,minPrice:min.value===''?null:Number(min.value),maxPrice:max.value===''?null:Number(max.value)};
  const scanLabel=[{residential:'All residential',freehold:'Freehold',condo:'Condo & Other',commercial:'Commercial'}[filters.propertyClass],[...filters.municipalities,...filters.districts].join(' + ')||'Toronto + York',filters.communities.join(' + ')||'all communities',filters.dateFrom+' → '+filters.dateTo,filters.status||'both statuses',filters.minPrice!==null||filters.maxPrice!==null?(filters.minPrice!==null?money(filters.minPrice):'No minimum')+' – '+(filters.maxPrice!==null?money(filters.maxPrice):'no maximum'):'all prices'].join(' · ');
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
 async function loadCommunityChoices(){
  if(optionsLoaded||optionsLoading)return;optionsLoading=true;const id=optionsGeneration;$('prospectOptionsNote').textContent='Loading MLS community choices…';
  try{const data=await post('/api/admin/prospects/options',{});if(id!==optionsGeneration)return;const names=(data.communities||[]).filter(x=>typeof x==='string');optionsLoaded=true;showCommunityChoices(names);$('prospectOptionsNote').textContent=names.length?'Select one or several communities.':'Enter the MLS community name, or leave blank for all.';}
  catch{if(id===optionsGeneration)$('prospectOptionsNote').textContent='Suggestions are unavailable. Enter the MLS community name, or leave blank for all.';}
  finally{if(id===optionsGeneration)optionsLoading=false;}
 }
 $('prospectCommunity').addEventListener('focus',loadCommunityChoices);
 $('prospectCommunityPicker').addEventListener('toggle',()=>{if($('prospectCommunityPicker').open)loadCommunityChoices();});
 $('prospectCommunitySearch').addEventListener('focus',loadCommunityChoices);
 $('prospectCommunitySearch').addEventListener('input',()=>showCommunityChoices());
 $('prospectCommunityBrowse').addEventListener('change',event=>{
  const choice=event.target.closest('[data-community-choice]');if(!choice||running)return;
  if(choice.checked){const input=$('prospectCommunity'),pending=input.value;input.value=choice.value;const added=addCommunities();input.value=pending;if(!added)choice.checked=false;}
  else{communities=communities.filter(name=>name.toLowerCase()!==choice.value.toLowerCase());renderSelections();}
  Array.from($('prospectCommunityBrowse').querySelectorAll('input')).find(input=>input.value===choice.value)?.focus();
 });
 $('prospectAreas').addEventListener('change',()=>{
  const areas=selected('prospectAreas');
  if(areas.length){for(const input of $('prospectMunicipalities').querySelectorAll('input'))if(!areas.includes(input.value==='Toronto'?'Toronto':'York'))input.checked=false;if(!areas.includes('Toronto'))for(const input of $('prospectDistricts').querySelectorAll('input'))input.checked=false;}
  renderSelections();
 });
 for(const picker of document.querySelectorAll('.prospect-location-fields > .prospect-location-field > .prospect-picker')){
  picker.addEventListener('toggle',()=>{if(picker.open)for(const other of document.querySelectorAll('.prospect-location-fields .prospect-picker'))if(other!==picker)other.open=false;});
  picker.addEventListener('keydown',event=>{if(event.key==='Escape'){picker.open=false;picker.querySelector('summary').focus();}});
 }

 $('prospectCommunityAdd').addEventListener('click',addCommunities);
 $('prospectCommunity').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCommunities();}});
 $('prospectCommunityChips').addEventListener('click',event=>{const button=event.target.closest('[data-community-remove]');if(button&&!running){communities.splice(Number(button.dataset.communityRemove),1);renderSelections();}});
 for(const id of ['prospectMunicipalities','prospectDistricts','prospectDateFrom','prospectDateTo'])$(id).addEventListener('change',renderSelections);
 for(const button of $('prospectScanFilters').querySelectorAll('[data-prospect-days]'))button.addEventListener('click',()=>{if(!running)dates(button.dataset.prospectDays);});
 function classNote(){const value=$('prospectClass').querySelector('input:checked').value;$('prospectClassNote').textContent=value==='commercial'?'Commercial · owner-occupied sale listings only. Upload a commercial PDF for mailing; residential presentation and renovation review do not apply.':value==='residential'?'All residential includes freehold and condo listings.':'Search '+(value==='freehold'?'freehold':'condo & other')+' listings. Existing owner-occupancy and relisting checks apply.';}
 $('prospectClass').addEventListener('change',classNote);
 $('prospectResetFilters').addEventListener('click',()=>{if(running)return;for(const input of $('prospectScanFilters').querySelectorAll('input[type="checkbox"]'))input.checked=false;$('prospectClass').querySelector('input[value="residential"]').checked=true;classNote();communities=[];$('prospectCommunity').value='';$('prospectCommunitySearch').value='';$('prospectMinPrice').value='';$('prospectMaxPrice').value='';$('prospectScanStatus').value='';$('prospectError').hidden=true;dates();});
 $('prospectStart').addEventListener('click',start);
 $('prospectStop').addEventListener('click',()=>{generation++;running=false;complete=false;$('prospectProgress').textContent='Stopped. Results cover only the checks completed so far. Start again for a fresh full scan.';render();});
 for(const id of ['prospectRegion','prospectStatus','prospectReview','prospectSearch'])$(id).addEventListener('input',render);
 $('prospectExport').addEventListener('click',()=>{
  const values=[['MLS','Address','City','Community','Status','End date','Asking price','Occupancy','Relisting check','Checked at','Coverage','Renovation','Quick note','Assessment source','Assessment date'],...rows.filter(r=>r.result==='qualified').map(r=>[r.listingKey,r.address,r.city,r.community,r.status,r.eventDate,r.askingPrice,'Owner occupied (MLS declaration)',r.reason,r.checkedAt,complete?'Available feed scan completed':'Partial scan',r.assessment?.label||'Not reviewed',r.assessment?.note||'',r.assessment?.source||'',r.assessment?.reviewedAt||''])];
  const csv=values.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'\u0024&").replaceAll('"','""')+'"').join(',')).join('\r\n');
  const href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=href;a.download='THM-expired-terminated-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 });

 $('prospectRows').addEventListener('change',e=>{const key=e.target.dataset.conditionPick;if(key&&!reviewing){e.target.checked?picked.add(key):picked.delete(key);plans=[];$('prospectPhotoEstimate').hidden=true;conditionControls();}});
 $('prospectRows').addEventListener('click',async e=>{const button=e.target.closest('[data-condition-save]');if(!button||running||reviewing)return;const row=rows.find(r=>r.listingKey===button.dataset.conditionSave),box=button.closest('details');if(!row)return;const category=box.querySelector('[data-condition-category]').value,note=box.querySelector('[data-condition-note]').value.trim();if(!note){problem('Enter a short note before saving.');return;}button.disabled=true;const id=reviewGeneration;try{const answer=await conditionPost(row,'manual',{category,note});if(id!==reviewGeneration)return;row.assessment=answer.assessment;render();}catch(e){if(id===reviewGeneration){problem(e.message);button.disabled=false;}}});
 $('prospectSelectAll').addEventListener('click',()=>{if(reviewing)return;rows.filter(r=>r.result==='qualified').forEach(r=>picked.add(r.listingKey));plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectSelectCheckbox').addEventListener('change',e=>{if(reviewing)return;for(const r of visibleRows().filter(r=>r.result==='qualified'))e.target.checked?picked.add(r.listingKey):picked.delete(r.listingKey);plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectSelectVisible').addEventListener('click',()=>{if(reviewing)return;visibleRows().filter(r=>r.result==='qualified').forEach(r=>picked.add(r.listingKey));plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectClearSelected').addEventListener('click',()=>{if(reviewing)return;picked.clear();plans=[];$('prospectPhotoEstimate').hidden=true;render();});
 $('prospectRemarks').addEventListener('click',()=>reviewBatch('remarks'));
 $('prospectPhotoQuote').addEventListener('click',()=>reviewBatch('quote'));
 $('prospectPhotoConfirm').addEventListener('click',photoReview);
 $('prospectPhotoCancel').addEventListener('click',()=>{plans=[];$('prospectPhotoEstimate').hidden=true;});
 $('prospectReviewStop').addEventListener('click',()=>{reviewGeneration++;reviewing=false;plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectConditionProgress').textContent='Stopped. An in-flight review may finish and be saved; load saved assessments to retrieve it.';render();});
 for(const id of ['prospectConditionFilter','prospectConditionSort'])$(id).addEventListener('change',render);
 dates();render();return {start,render,getSelected:()=>qualifiedPicked().map(r=>({...r})),subscribeSelection(listener){selectionListeners.add(listener);listener();return ()=>selectionListeners.delete(listener);},clear(){generation++;reviewGeneration++;reviewing=false;picked.clear();plans=[];$('prospectPhotoEstimate').hidden=true;$('prospectConditionProgress').textContent='';optionsGeneration++;running=false;optionsLoaded=false;optionsLoading=false;$('prospectCommunityOptions').innerHTML='';communityNames=[];$('prospectCommunityBrowse').innerHTML='';$('prospectCommunitySearch').value='';$('prospectOptionsNote').textContent='';rows=[];seen.clear();scanned=checked=excluded=unverified=0;complete=false;$('prospectProgress').textContent='';$('prospectError').hidden=true;render();}};
}
