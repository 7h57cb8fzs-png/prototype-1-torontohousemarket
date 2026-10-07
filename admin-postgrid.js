export function initAdminPostgrid({$,post,esc,getSelected,onOpenHistory,onNewMail}){
 const host=document.createElement('section');host.id='postgridPanel';host.className='postgrid-panel';$('prospectsView').append(host);
 const history=document.createElement('section');history.id='mailHistoryView';history.className='postgrid-panel mail-history-view';history.hidden=true;$('prospectsView').parentElement.append(history);
 host.innerHTML=`<header class="mail-heading"><div><p class="mail-eyebrow">PRINT &amp; MAIL</p><h2>Prepare your letters</h2><p>Select homes above, then review the recipients and PDFs here.</p></div><span class="mail-test-badge">Test mode · no physical mail</span></header>
 <div class="mail-selection-bar"><div><strong id="mailSelectionCount">No properties selected</strong><p id="mailSelectionNote">Select qualified properties using the checkboxes above.</p></div><div class="mail-actions"><button id="mailPrepare" class="primary" type="button">Prepare selected letters</button><button id="mailHistory" class="secondary" type="button">Mailing history</button></div></div>
 <div class="mail-connection"><span id="mailConnectionStatus">PostGrid test connection</span><button id="mailConnection" class="text-button" type="button">Check connection</button></div>
 <p id="mailStatus" role="status" aria-live="polite"></p><p id="mailError" class="mail-error" role="alert"></p>
 <form id="mailForm" hidden><fieldset id="mailFields"><legend class="sr-only">Prepare test mail</legend>
 <section class="mail-step"><div class="mail-step-heading"><span>1</span><div><h3>Choose your mailing</h3><p>Every selected property keeps its own recipient name and address.</p></div></div>
 <div class="mail-mode-options"><label class="mail-mode-option"><input type="radio" name="mailingMode" id="mailModeMass" value="mass" checked><span><strong>Mass mailing</strong><small>Use the same PDF for every selected property.</small></span></label><label class="mail-mode-option"><input type="radio" name="mailingMode" id="mailModeCustom" value="custom"><span><strong>Customized letters</strong><small>Generate the approved report or upload your own PDF.</small></span></label></div>
 <div id="mailSharedUpload" class="mail-upload"><label for="mailCommonPdf">PDF for all selected properties</label><input type="file" id="mailCommonPdf" accept="application/pdf"><p id="mailCommonPreview"></p></div>
 <p class="mail-help">8.5 × 11-inch pages · PDF up to 8 MB · a separate address page is added.</p>
 <div class="mail-options"><label><input type="checkbox" id="mailColor" checked> Colour</label><label><input type="checkbox" id="mailDuplex" checked> Double-sided</label></div></section>
 <section class="mail-step"><div class="mail-step-heading"><span>2</span><div><h3>Return address</h3><p>The sender information printed on each mailing.</p></div></div><div id="mailSender" class="mail-contact"></div></section>
 <section class="mail-step"><div class="mail-step-heading"><span>3</span><div><h3>Review recipients</h3><p id="mailRecipientHelp">When no recipient name is available, letters are addressed to “Current Homeowner”. You can edit each name before mailing.</p></div></div><div id="mailRecipients"></div></section>
 <div class="mail-submit-bar"><label class="mail-confirm"><input type="checkbox" id="mailConfirm" required> I reviewed the recipient names, addresses and PDFs for these test orders.</label><div class="mail-actions"><button id="mailCreate" class="primary" type="submit">Create test orders</button><span id="mailReadyCount"></span></div></div>
 </fieldset></form><button id="mailStop" class="secondary" type="button" hidden>Stop after current request</button><section id="mailResults" aria-live="polite"></section>`;
 history.innerHTML=`<header class="mail-heading"><div><p class="mail-eyebrow">POSTGRID</p><h2>Mailing history</h2><p>Test orders, documents and status in one place. Nothing is printed or mailed.</p></div><button id="mailNew" class="primary" type="button">Prepare new letters</button></header>
 <div class="mail-history-tools"><label>Search<input id="mailHistorySearch" type="search" placeholder="Property, recipient or PDF"></label><label>Status<select id="mailHistoryFilter"><option value="">All statuses</option><option value="ready">Ready</option><option value="attention">Needs attention</option><option value="other">Other statuses</option></select></label><button id="mailHistoryReload" class="secondary" type="button">Refresh this page</button></div>
 <div class="mail-history-selection"><label class="mail-select-all"><input type="checkbox" id="mailHistorySelectAll"><span id="mailHistorySelectLabel">Select all</span></label><span id="mailHistorySelectedCount" role="status">0 selected</span><button id="mailHistoryClear" type="button" class="text-button" disabled>Clear selection</button><button id="mailHistoryDelete" type="button" class="secondary mail-delete-button" disabled>Delete selected</button></div><div id="mailDeletePrompt" class="mail-delete-prompt" hidden><strong id="mailDeleteQuestion"></strong><p>This removes the selected records from THM mailing history. It does not cancel letters or delete them from PostGrid.</p><div class="mail-actions"><button id="mailDeleteConfirm" type="button" class="primary">Delete from history</button><button id="mailDeleteCancel" type="button" class="secondary">Cancel</button></div></div><p id="mailHistoryStatus" role="status" aria-live="polite"></p><p id="mailHistoryError" class="mail-error" role="alert"></p><div id="mailHistoryResults"></div><div class="mail-history-paging"><span id="mailHistoryCount"></span><div class="mail-actions"><button id="mailHistoryPrev" class="secondary" type="button">Previous</button><button id="mailHistoryNext" class="secondary" type="button">Next</button></div></div>`;
 let entries=[],shared=null,opened=false,busy='',generation=0,stop=false,urls=[],selectionKey='',timer=null,pendingSelection=false;
 let orders=[],page=0,historyGeneration=0,historyBusy=false,historySelected=new Set(),deletedOrders=new Set(),pendingDelete=[],deleting=false;
 const call=(action,body={})=>post('/api/admin/postgrid/'+action,body);
 const error=v=>{$('mailError').textContent=v||'';};
 const fields=[['firstName','Recipient name / first name'],['lastName','Last name (optional)'],['companyName','Company (optional)'],['addressLine1','Street address'],['addressLine2','Unit / suite (optional)'],['city','City'],['provinceOrState','Province'],['postalOrZip','Postal code']];
 const senderFields=[['companyName','Sender / team name'],['addressLine1','Street address'],['addressLine2','Unit / suite (optional)'],['city','City'],['provinceOrState','Province'],['postalOrZip','Postal code']];
 function contactForm(prefix,address={},sender=false){return (sender?senderFields:fields).map(([key,label])=>`<label>${label}<input data-field="${key}" id="${prefix}-${key}" maxlength="150" value="${esc(address[key]||'')}" ${['addressLine1','city','provinceOrState','postalOrZip'].includes(key)?'required':''}></label>`).join('');}
 function senderDefault(){$('mailSender').innerHTML=contactForm('mail-from',{companyName:'Golestan Team',addressLine1:'1053 McNicoll Ave',city:'Toronto',provinceOrState:'ON',postalOrZip:'M1W 3W6'},true);}
 senderDefault();
 const readContact=node=>Object.fromEntries([...node.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value.trim()]));
 const mode=()=>$('mailModeCustom').checked?'custom':'mass';
 const keyOf=rows=>rows.map(r=>r.listingKey+':'+r.reviewProof).sort().join('|');
 const selected=()=>getSelected().map(r=>({...r}));
 function resetReview(){$('mailConfirm').checked=false;}
 function revoke(){urls.forEach(u=>URL.revokeObjectURL(u));urls=[];}
 function preview(file){if(!file)return '';const url=URL.createObjectURL(file);urls.push(url);return `<a href="${url}" target="_blank" rel="noopener noreferrer">Preview PDF · ${esc(file.name)}</a>`;}
 function checkFile(file){if(file&&(!/\.pdf$/i.test(file.name)||file.size>8*1024*1024||file.size<20))throw Error('Choose a PDF of 8 MB or less.');return file||null;}
 function setBusy(value){busy=value;for(const id of ['mailPrepare','mailConnection'])$(id).disabled=!!value;$('mailFields').disabled=!!value;$('mailStop').hidden=!['prepare','send','generate'].includes(value);}
 function showFiles(){
  revoke();$('mailSharedUpload').hidden=mode()!=='mass';$('mailCommonPreview').innerHTML=mode()==='mass'?preview(shared):'';
  entries.forEach((e,i)=>{const box=$('mail-custom-'+i);if(box)box.hidden=mode()!=='custom';const node=$('mail-file-'+i);if(node)node.innerHTML=mode()==='custom'?((preview(e.file)+(e.presentationNote?'<br>'+esc(e.presentationNote):''))||'Generate a customized report, or upload a PDF for this property.'):(shared?esc(shared.name)+' · shared PDF':'The shared PDF will be used for this recipient.');});
  $('mailReadyCount').textContent=entries.length+' '+(entries.length===1?'recipient':'recipients')+' · '+(mode()==='mass'?'same PDF':'individual PDFs');resetReview();
 }
 function saveDrafts(){entries.forEach((e,i)=>{const box=$('mail-to-'+i);if(box)e.address=readContact(box);});}
 function renderRecipients(){
  $('mailRecipients').innerHTML=entries.map((e,i)=>`<article class="mail-recipient"><header><div><span class="mail-recipient-number">${i+1}</span><strong>${esc(e.row.address)}</strong><small>${esc(e.row.listingKey)}</small></div><span class="mail-name-note">${e.address.firstName||e.address.companyName?'Review recipient':'Recipient name required'}</span></header><div id="mail-to-${i}" class="mail-contact">${contactForm('mail-to-'+i,e.address)}</div><div id="mail-custom-${i}" class="mail-upload"><button type="button" class="primary" data-mail-generate="${i}">Generate customized presentation</button><p class="mail-help">Approved two-page design · property QR · three nearby sales · Mehrdad’s contact details.</p><label for="mail-pdf-${i}">Or upload your own PDF</label><input id="mail-pdf-${i}" type="file" data-mail-file="${i}" accept="application/pdf"></div><p id="mail-file-${i}" class="mail-help"></p></article>`).join('');
  $('mailForm').hidden=!entries.length;showFiles();
 }
 async function connection(){const epoch=generation,info=await call('status');if(epoch!==generation)return;$('mailConnectionStatus').textContent=info.connected?'Connected · test orders only':'PostGrid is not connected.';}
 async function prepare(){
  if(busy==='send')return;clearTimeout(timer);saveDrafts();const rows=selected(),drafts=new Map(entries.map(e=>[e.row.listingKey+':'+e.row.reviewProof,e]));const epoch=++generation;selectionKey=keyOf(rows);const nextEntries=[];stop=false;error('');resetReview();$('mailResults').replaceChildren();
  if(!rows.length){entries=[];setBusy('');renderRecipients();$('mailStatus').textContent='Select properties above to continue. Your sender details and mailing settings are kept.';return;}
  if(rows.length>100){entries=[];setBusy('');renderRecipients();error('Prepare up to 100 recipients at a time.');return;}
  opened=true;$('mailSelectionNote').textContent='Recipient cards follow your selection. Sender details and the shared PDF stay in place.';setBusy('prepare');$('mailForm').hidden=true;
  try{for(const row of rows){if(stop||epoch!==generation)break;const old=drafts.get(row.listingKey+':'+row.reviewProof);if(old){nextEntries.push(old);continue;}
    $('mailStatus').textContent='Loading recipient '+(nextEntries.length+1)+' of '+rows.length+' · '+row.address;
    const result=await call('subject',{reviewProof:row.reviewProof});if(epoch!==generation)return;
    const address={...result.address};if(![address.firstName,address.lastName,address.companyName].some(v=>String(v||'').trim()))address.firstName='Current Homeowner';
    nextEntries.push({row,reviewProof:result.reviewProof,address,file:null});
   }
   if(epoch!==generation)return;entries=nextEntries;renderRecipients();$('mailStatus').textContent=stop?'Loading stopped. Prepare selected letters again to finish.':entries.length+' recipients loaded. Review names and PDFs before creating test orders.';
  }catch(e){if(epoch===generation){entries=[];renderRecipients();error(e.message);}}
  finally{if(epoch===generation)setBusy('');}
 }
 function selectionChanged(){
  const rows=selected(),next=keyOf(rows);$('mailSelectionCount').textContent=rows.length?rows.length+' '+(rows.length===1?'property selected':'properties selected'):'No properties selected';$('mailSelectionNote').textContent=opened?'Recipient cards follow your selection. Sender details and the shared PDF stay in place.':'Select qualified properties above, then prepare your letters.';
  if(next===selectionKey)return;selectionKey=next;resetReview();
  if(busy==='send'){stop=true;pendingSelection=true;$('mailStatus').textContent='Selection changed. Stopping after the current letter, then updating recipients.';return;}
  if(opened){generation++;setBusy('prepare');$('mailStatus').textContent='Updating selected recipients…';clearTimeout(timer);timer=setTimeout(prepare,180);}
 }
 $('mailPrepare').onclick=async()=>{if(busy)return;if(!selected().length){error('Select qualified properties using the checkboxes above first.');return;}await prepare();};
 $('mailConnection').onclick=async()=>{if(busy)return;const epoch=generation;setBusy('connection');error('');try{await connection();}catch(e){if(epoch===generation)error(e.message);}finally{if(epoch===generation)setBusy('');}};
 $('mailStop').onclick=()=>{stop=true;$('mailStatus').textContent='Stopping after the current request finishes.';};
 $('mailCommonPdf').onchange=e=>{try{shared=checkFile(e.target.files[0]);error('');showFiles();}catch(err){shared=null;e.target.value='';showFiles();error(err.message);}};
 async function generateReport(index){
  if(busy||mode()!=='custom')return;const entry=entries[index];if(!entry)return;
  saveDrafts();const epoch=generation;setBusy('generate');stop=false;error('');resetReview();
  $('mailStatus').textContent='Finding nearby sold examples and generating the presentation for '+entry.row.address+'…';
  try{
   const data=await call('presentation',{reviewProof:entry.reviewProof});if(stop||epoch!==generation||entries[index]!==entry)return;
   if(data.listingKey!==entry.row.listingKey)throw Error('The property changed. Refresh your selection before generating.');
   const {generatePresentation}=await import('./admin-presentation-pdf.js?v=1');const result=await generatePresentation(data);
   if(stop||epoch!==generation||entries[index]!==entry)return;
   entry.file=checkFile(result.file);entry.reviewProof=data.reviewProof;
   entry.presentationNote='Generated for '+data.address+' · '+new Date(data.generatedAt).toLocaleString('en-CA',{timeZone:'America/Toronto'})+(result.missingPhotos.length?' · '+result.missingPhotos.length+' listing photos unavailable. Check the preview.':' · 3 nearby sold examples.');
   $('mail-pdf-'+index).value='';showFiles();$('mailStatus').textContent='Your customized presentation is ready. Open Preview PDF and review it before creating a test order.';
  }catch(e){if(epoch===generation)error(e.message);}
  finally{if(epoch===generation){setBusy('');if(stop)$('mailStatus').textContent='Generation stopped. No new PDF was attached.';}}
 }
 $('mailRecipients').onclick=e=>{const button=e.target.closest('[data-mail-generate]');if(button)return generateReport(Number(button.dataset.mailGenerate));};
 $('mailRecipients').onchange=e=>{const index=e.target.dataset.mailFile;if(index!==undefined){try{entries[Number(index)].file=checkFile(e.target.files[0]);entries[Number(index)].presentationNote='';error('');showFiles();}catch(err){entries[Number(index)].file=null;e.target.value='';showFiles();error(err.message);}}else resetReview();};
 $('mailRecipients').oninput=e=>{resetReview();const card=e.target.closest('.mail-recipient');if(card){const recipient=readContact(card);card.querySelector('.mail-name-note').textContent=recipient.firstName||recipient.companyName?'Review recipient':'Recipient name required';}};$('mailSender').oninput=resetReview;$('mailColor').onchange=resetReview;$('mailDuplex').onchange=resetReview;
 for(const id of ['mailModeMass','mailModeCustom'])$(id).onchange=showFiles;
 const base64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the PDF.'));reader.readAsDataURL(file);});
 const name=c=>[c?.firstName,c?.lastName,c?.companyName].filter(Boolean).join(' ');
 const date=value=>value?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
 const statusNames={ready:'Ready · test',submitting:'Submitting',rejected:'Rejected',needs_review:'Needs review',printing:'Printing · test',processed_for_delivery:'In delivery · test',completed:'Completed · test',cancelled:'Cancelled'};
 const attention=o=>['rejected','needs_review','submitting'].includes(o.status);
 function orderCard(o,selectable=false){return `<article class="mail-result ${selectable?'mail-selectable':''}" data-order="${esc(o.id)}">${selectable?`<label class="mail-row-pick"><input type="checkbox" data-history-pick="${esc(o.id)}" aria-label="Select history record for ${esc(o.property||o.listingKey)}" ${historySelected.has(o.id)?'checked':''} ${historyBusy||deleting||pendingDelete.length?'disabled':''}></label>`:''}<div><strong>${esc(o.property||o.listingKey)}</strong><p>${esc(name(o.recipient))} · ${esc(o.pdfName)}</p><span class="mail-order-status ${attention(o)?'mail-attention':''}">${esc(statusNames[o.status]||o.status)}</span></div><div class="mail-actions"><button type="button" class="secondary" data-mail-preview="${esc(o.id)}" ${o.postgridId?'':'disabled'}>Print preview</button><button type="button" class="text-button" data-mail-details="${esc(o.id)}">Details</button></div><div class="mail-order-detail" data-detail-for="${esc(o.id)}" hidden>${details(o)}</div></article>`;}
 function details(o){return `<p><strong>To:</strong> ${esc(name(o.recipient))}<br>${esc([o.recipient?.addressLine1,o.recipient?.addressLine2,o.recipient?.city,o.recipient?.provinceOrState,o.recipient?.postalOrZip].filter(Boolean).join(', '))}</p>${o.sender?'<p><strong>From:</strong> '+esc(name(o.sender))+' · '+esc(o.sender.addressLine1||'')+'</p>':''}<p>${esc(date(o.createdAt))} · Test order<br>Reference: ${esc(o.postgridId||o.id)}</p>${o.error?'<p class="mail-error">'+esc(o.error)+'</p>':''}<button type="button" class="text-button" data-mail-refresh="${esc(o.id)}">Refresh status</button>`;}
 function remember(o){if(!o||o.deletedAt||deletedOrders.has(o.id))return;const i=orders.findIndex(x=>x.id===o.id);if(i>=0)orders[i]=o;else orders.unshift(o);}
 $('mailForm').onsubmit=async event=>{
  event.preventDefault();if(busy||!entries.length||!$('mailConfirm').checked)return;
  const rows=selected();if(keyOf(rows)!==selectionKey||rows.length!==entries.length||!entries.every(e=>rows.some(r=>r.listingKey===e.row.listingKey&&r.reviewProof===e.row.reviewProof))){resetReview();await prepare();error('The property selection changed. Review the updated recipients before continuing.');return;}
  if(!$('mailForm').reportValidity())return;saveDrafts();const from=readContact($('mailSender'));if(!from.companyName){error('Enter the sender or team name.');return;}
  const batch=entries.map(e=>({...e,to:{...e.address},file:mode()==='mass'?shared:e.file}));
  if(batch.some(e=>!e.file||(!e.to.firstName&&!e.to.companyName))){error('Every recipient needs a name or company and a PDF.');return;}
  const color=$('mailColor').checked,doubleSided=$('mailDuplex').checked,epoch=generation;setBusy('send');stop=false;pendingSelection=false;error('');$('mailResults').innerHTML='<h3>Latest test batch</h3>';let done=0;
  try{for(const e of batch){if(stop||epoch!==generation)break;$('mailStatus').textContent='Creating test order '+(done+1)+' of '+batch.length+' · '+e.row.address;
    const pdfBase64=await base64(e.file);if(stop||epoch!==generation)break;
    const result=await call('create',{mode:'test',confirmed:true,reviewProof:e.reviewProof,to:e.to,from,pdfName:e.file.name,pdfBase64,color,doubleSided});if(epoch!==generation)return;
    deletedOrders.delete(result.order.id);remember(result.order);$('mailResults').insertAdjacentHTML('beforeend',(result.duplicate?'<p class="mail-help">Matching test order already exists; no duplicate created.</p>':'')+orderCard(result.order));done++;
   }if(epoch===generation)$('mailStatus').textContent=done+' of '+batch.length+' test orders recorded. Open Print preview to see the prepared letter. All records are in Mailing history.';
  }catch(e){if(epoch===generation){error(e.message);$('mailStatus').textContent=done+' orders recorded before stopping. Review Mailing history for the saved result.';}}
  finally{if(epoch===generation){setBusy('');resetReview();if(pendingSelection){pendingSelection=false;await prepare();}}}
 };
 function filtered(){const q=$('mailHistorySearch').value.trim().toLowerCase(),f=$('mailHistoryFilter').value;return orders.filter(o=>(!q||[o.property,o.listingKey,name(o.recipient),o.pdfName,o.postgridId].join(' ').toLowerCase().includes(q))&&(!f||(f==='attention'?attention(o):f==='ready'?o.status==='ready':!attention(o)&&o.status!=='ready')));}
 function historySelectionControls(rows=filtered()){
  const count=rows.filter(o=>historySelected.has(o.id)).length,locked=historyBusy||deleting||pendingDelete.length>0,all=$('mailHistorySelectAll');
  all.checked=!!rows.length&&count===rows.length;all.indeterminate=count>0&&count<rows.length;all.disabled=locked||!rows.length;
  $('mailHistorySelectLabel').textContent='Select all '+rows.length+' matching records';$('mailHistorySelectedCount').textContent=count+' selected';
  $('mailHistoryDelete').disabled=locked||!count;$('mailHistoryClear').disabled=locked||!historySelected.size;
  for(const id of ['mailHistorySearch','mailHistoryFilter'])$(id).disabled=deleting;
  $('mailHistoryReload').disabled=locked;$('mailDeleteConfirm').disabled=deleting;$('mailDeleteCancel').disabled=deleting;
 }
 $('mailHistorySelectAll').onchange=e=>{if(historyBusy||deleting||pendingDelete.length)return;for(const o of filtered())e.target.checked?historySelected.add(o.id):historySelected.delete(o.id);renderHistory();};
 $('mailHistoryResults').addEventListener('change',e=>{const id=e.target.dataset.historyPick;if(!id||historyBusy||deleting||pendingDelete.length)return;e.target.checked?historySelected.add(id):historySelected.delete(id);historySelectionControls();});
 $('mailHistoryClear').onclick=()=>{if(deleting)return;historySelected.clear();renderHistory();};
 $('mailHistoryDelete').onclick=()=>{if(historyBusy||deleting)return;pendingDelete=filtered().filter(o=>historySelected.has(o.id)).map(o=>o.id);if(!pendingDelete.length)return;$('mailDeleteQuestion').textContent='Delete '+pendingDelete.length+' selected '+(pendingDelete.length===1?'record':'records')+' from mailing history?';$('mailDeletePrompt').hidden=false;renderHistory();$('mailDeleteCancel').focus();};
 $('mailDeleteCancel').onclick=()=>{if(deleting)return;pendingDelete=[];$('mailDeletePrompt').hidden=true;renderHistory();};
 $('mailDeleteConfirm').onclick=async()=>{
  if(deleting||!pendingDelete.length)return;const ids=[...pendingDelete],historyEpoch=++historyGeneration;deleting=true;historyBusy=false;renderHistory();$('mailHistoryError').textContent='';$('mailHistoryStatus').textContent='Deleting selected history records…';
  try{const result=await call('delete',{ids,confirmed:true});if(historyEpoch!==historyGeneration)return;
   const removed=new Set(result.deletedIds||[]);for(const id of removed){deletedOrders.add(id);historySelected.delete(id);}
   orders=orders.filter(o=>!removed.has(o.id));for(const node of $('mailResults').querySelectorAll('[data-order]'))if(removed.has(node.dataset.order))node.remove();
   $('mailHistoryStatus').textContent=removed.size+' '+(removed.size===1?'record deleted':'records deleted')+' from THM history.';
  }catch(e){if(historyEpoch===historyGeneration)$('mailHistoryError').textContent=e.message;}
  finally{if(historyEpoch===historyGeneration){deleting=false;pendingDelete=[];$('mailDeletePrompt').hidden=true;renderHistory();}}
 };
 function renderHistory(){const rows=filtered();historySelectionControls(rows);page=Math.min(page,Math.max(0,Math.ceil(rows.length/10)-1));const visible=rows.slice(page*10,page*10+10);$('mailHistoryResults').innerHTML=visible.length?visible.map(o=>orderCard(o,true)).join(''):'<div class="mail-empty">No test orders match this view.</div>';$('mailHistoryCount').textContent=(rows.length?page*10+1:0)+'–'+Math.min(page*10+10,rows.length)+' of '+rows.length+' records · latest 100';$('mailHistoryPrev').disabled=!page||historyBusy||deleting||pendingDelete.length>0;$('mailHistoryNext').disabled=(page+1)*10>=rows.length||historyBusy||deleting||pendingDelete.length>0;}
 async function loadHistory(refresh=true){
  if(deleting||pendingDelete.length)return;const epoch=++historyGeneration;historyBusy=true;$('mailHistoryReload').disabled=true;$('mailHistoryError').textContent='';$('mailHistoryStatus').textContent='Loading test orders…';
  try{const data=await call('history');if(epoch!==historyGeneration)return;orders=(data.orders||[]).filter(o=>!deletedOrders.has(o.id));historySelected=new Set([...historySelected].filter(id=>orders.some(o=>o.id===id)));renderHistory();let failed=0;
   if(refresh)for(const o of filtered().slice(page*10,page*10+10).filter(o=>o.postgridId)){try{const data=await call('refresh',{id:o.id});if(epoch!==historyGeneration)return;remember(data.order);}catch{failed++;}if(epoch!==historyGeneration)return;}
   if(epoch===historyGeneration){renderHistory();$('mailHistoryStatus').textContent='Updated '+date(new Date().toISOString())+(failed?' · '+failed+' status updates unavailable. Saved records shown.':' · test orders only.');}
  }catch(e){if(epoch===historyGeneration)$('mailHistoryError').textContent=e.message;}
  finally{if(epoch===historyGeneration){historyBusy=false;$('mailHistoryReload').disabled=false;renderHistory();}}
 }
 $('mailHistory').onclick=()=>onOpenHistory?onOpenHistory():(history.hidden=false,loadHistory());$('mailNew').onclick=()=>onNewMail?onNewMail():(history.hidden=true);
 $('mailHistoryReload').onclick=()=>loadHistory();for(const id of ['mailHistorySearch','mailHistoryFilter'])$(id).oninput=()=>{if(deleting)return;pendingDelete=[];$('mailDeletePrompt').hidden=true;historySelected.clear();page=0;renderHistory();};
 $('mailHistoryPrev').onclick=()=>{if(page){page--;renderHistory();}};$('mailHistoryNext').onclick=()=>{if((page+1)*10<filtered().length){page++;renderHistory();}};
 async function orderAction(event){
  const button=event.target.closest('[data-mail-preview],[data-mail-refresh],[data-mail-details]');if(!button)return;const id=button.dataset.mailPreview||button.dataset.mailRefresh||button.dataset.mailDetails;
  if(button.hasAttribute('data-mail-details')){const box=button.closest('.mail-result').querySelector('[data-detail-for]');box.hidden=!box.hidden;button.textContent=box.hidden?'Details':'Hide details';return;}
  const inHistory=event.currentTarget===history,epoch=generation,historyEpoch=historyGeneration,isPreview=button.hasAttribute('data-mail-preview');button.disabled=true;button.textContent=isPreview?'Loading preview…':'Refreshing…';
  // Open synchronously to avoid popup blockers; URLs are obtained afresh because PostGrid links expire.
  const win=isPreview?window.open('about:blank','_blank'):null;if(win)win.opener=null;
  try{const data=await call('refresh',{id});if(epoch!==generation||deletedOrders.has(id)||(inHistory&&historyEpoch!==historyGeneration)){win?.close();return;}remember(data.order);
   for(const container of [host,history])for(const node of container.querySelectorAll('[data-order]'))if(node.dataset.order===id)node.outerHTML=orderCard(data.order,container===history);
   if(isPreview){if(data.order.previewUrl&&/^https:\/\//.test(data.order.previewUrl)){if(win)win.location.replace(data.order.previewUrl);else{const a=document.createElement('a');a.href=data.order.previewUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open print preview';const target=inHistory?$('mailHistoryStatus'):$('mailStatus');target.replaceChildren(a);}}else{win?.close();throw Error('PostGrid is still preparing the preview. Try again shortly.');}}
  }catch(e){win?.close();if(epoch===generation&&(!inHistory||historyEpoch===historyGeneration)){(inHistory?$('mailHistoryError'):$('mailError')).textContent=e.message;button.disabled=false;button.textContent=isPreview?'Print preview':'Refresh status';}}
 }
 host.addEventListener('click',orderAction);history.addEventListener('click',orderAction);
 selectionChanged();
 return {selectionChanged,loadHistory,clear(){generation++;historyGeneration++;clearTimeout(timer);stop=true;opened=false;pendingSelection=false;entries=[];orders=[];page=0;shared=null;selectionKey='';revoke();setBusy('');historyBusy=false;deleting=false;historySelected.clear();deletedOrders.clear();pendingDelete=[];$('mailDeletePrompt').hidden=true;historySelectionControls([]);$('mailForm').reset();$('mailForm').hidden=true;for(const id of ['mailRecipients','mailResults','mailHistoryResults','mailCommonPreview'])$(id).replaceChildren();senderDefault();$('mailHistorySearch').value='';$('mailHistoryFilter').value='';$('mailHistoryReload').disabled=false;$('mailStatus').textContent='';$('mailConnectionStatus').textContent='PostGrid test connection';$('mailHistoryStatus').textContent='';$('mailHistoryError').textContent='';error('');selectionChanged();}};
}
