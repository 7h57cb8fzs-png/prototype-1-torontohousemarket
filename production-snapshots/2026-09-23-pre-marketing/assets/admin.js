// Format validation only; a successful check does not verify phone ownership.
function normalizeNorthAmericanPhone(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 24 || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  else if (raw.startsWith('+')) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (digits.slice(1,3) === '11' || digits.slice(4,6) === '11' || /^(\d)\1{9}$/.test(digits) || ['1234567890','0123456789','9876543210'].includes(digits)) return null;
  return '+1' + digits;
}

const $=id=>document.getElementById(id);let token="",agentData=[],leadData=[],manualRequestKey=null;
$("loginForm").addEventListener("submit",e=>{e.preventDefault();token=$("key").value.trim();load();});$("refresh").addEventListener("click",load);
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));["leadsView","agentsView","settingsView"].forEach(id=>$(id).hidden=id!==b.dataset.view);}));
$("addAgent").addEventListener("click",()=>openAgent());$("cancelAgent").addEventListener("click",closeAgent);$("agentForm").addEventListener("submit",saveAgent);$("settingsForm").addEventListener("submit",saveSettings);
async function api(path,options={}){const r=await fetch(path,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})},cache:"no-store"}),b=await r.json().catch(()=>null);if(!r.ok)throw new Error(b?.error||`Request failed (HTTP ${r.status}).`);return b;}
async function load(){if(!token)return;$("error").textContent="";try{const[l,a,s]=await Promise.all([api("/api/admin/leads"),api("/api/admin/agents"),api("/api/admin/settings")]);$("login").hidden=true;$("dashboard").hidden=false;agentData=a.agents||[];$("ownerEmail").value=s.settings?.owner_notification_email||"";leadData=l.leads||[];renderLeads(leadData);renderAgents();}catch(e){$("error").textContent=e.message;$("dashboardError").textContent=e.message;}}
function renderLeads(leads){
  const showing=x=>x.showing_requested || (x.metadata?.lead_mode || x.lead_mode)==='showing';
  $('stats').innerHTML=stat('New',leads.filter(x=>x.status==='new').length)+stat('Report only',leads.filter(x=>!showing(x)).length)+stat('Showing requests',leads.filter(x=>showing(x)&&x.status!=='appointment_confirmed').length)+stat('Confirmed',leads.filter(x=>x.status==='appointment_confirmed').length);
  $('updated').textContent=`Updated ${new Date().toLocaleTimeString()}`;
  const filter=$('leadFilter').value;
  const visible=leads.filter(x=>filter==='seller'?(x.lead_mode||x.metadata?.lead_mode)==='seller':filter==='report'?!showing(x)&&(x.lead_mode||x.metadata?.lead_mode)!=='seller':filter==='showing'?showing(x):filter==='confirmed'?x.status==='appointment_confirmed':true);
  if(filter==='confirmed')visible.sort((a,b)=>Date.parse(a.confirmed_showing_at)-Date.parse(b.confirmed_showing_at));
  $('leads').innerHTML=visible.length?visible.map(card).join(''):'<p>No matching leads.</p>';
  document.querySelectorAll('[data-report-lead]').forEach(d=>d.addEventListener('toggle',()=>{if(d.open&&!d.dataset.loaded)loadReportArchive(d);}));
  document.querySelectorAll('select[data-status-id]').forEach(s=>s.addEventListener('change',()=>updateLead(s.dataset.statusId,{status:s.value}).catch(e=>{alert(e.message);load();})));
  document.querySelectorAll('select[data-agent-id]').forEach(s=>s.addEventListener('change',()=>assignLead(s.dataset.agentId,s.value,s)));
  document.querySelectorAll('[data-remove-lead]').forEach(b=>b.addEventListener('click',()=>removeLead(b.dataset.removeLead,b)));
  document.querySelectorAll('[data-confirm-lead]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();confirmAppointment(form.dataset.confirmLead,form);}));
  for(const lead of visible.filter(x=>x.lead_mode==='seller'&&x.property_snapshot?.sellerProfile)){
    const article=document.querySelector(`[data-remove-lead="${lead.id}"]`)?.closest('article');if(!article)continue;
    const button=document.createElement('button'),result=document.createElement('div');
    button.type='button';button.textContent='Check seller estimate · no email';
    result.setAttribute('role','status');result.style.cssText='white-space:pre-wrap;line-height:1.6;margin:12px 0';
    button.addEventListener('click',async()=>{button.disabled=true;result.textContent='Checking historical records and sold evidence…';try{
      const r=await api('/api/admin/seller-preview?lead_id='+encodeURIComponent(lead.id)),v=r.valuation;
      result.textContent=[r.address,v.available?`Estimated range: ${money(v.low)}–${money(v.high)} · ${v.confidence} confidence`:v.basis,`Historical records: ${r.history?.length||0} · Selected sold homes: ${r.comparables?.length||0}`,...(r.comparables||[]).map(c=>`${c.address} · ${money(c.soldPrice)} · ${c.soldDate}${c.timeAdjustmentPct?` · Time-adjusted indication ${money(c.adjustedPrice)} (${c.timeAdjustmentPct}%)`:''}`),...(r.activeComparables||[]).map(c=>`${c.address} · Asking ${money(c.askingPrice)}`),r.diagnostics?JSON.stringify(r.diagnostics,null,2):'','Read-only check. No lead changes or emails.'].join('\n');
    }catch(e){result.textContent=e.message;}finally{button.disabled=false;}});
    article.append(button,result);
  }
}
$('leadFilter').addEventListener('change',()=>renderLeads(leadData));
$('addLead').addEventListener('click',()=>{$('manualLeadForm').reset();manualRequestKey=crypto.randomUUID();$('manualLeadForm').hidden=false;$('manualError').textContent='';$('manualName').focus();});
$('cancelLead').addEventListener('click',()=>{$('manualLeadForm').hidden=true;});
$('manualLeadForm').addEventListener('submit',async e=>{e.preventDefault();if(!$('manualLeadForm').reportValidity())return;const mobile=normalizeNorthAmericanPhone($('manualMobile').value);if(!mobile){$('manualError').textContent='Enter a valid 10-digit mobile number, with optional +1.';$('manualMobile').focus();return;}const property=$('manualProperty').value.trim(),generate=$('manualGenerate').checked,showing=$('manualShowing').checked;if((generate||showing)&&!property){$('manualError').textContent='Choose a property for a report or showing.';return;}$('manualSave').disabled=true;try{await api('/api/admin/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('manualName').value,mobile,email:$('manualEmail').value,property_input:property,listing_key:/^[A-Z]\d{7,9}$/i.test(property)?property.toUpperCase():null,showing_requested:showing,showing_timing:showing?'asap':'report',lead_mode:showing?'showing':'buyer_report',generate_report:generate,request_key:manualRequestKey})});$('manualLeadForm').hidden=true;await load();}catch(e){$('manualError').textContent=e.message;}finally{$('manualSave').disabled=false;}});
async function removeLead(id,button){if(!confirm('Remove this lead, its saved report and queued jobs? Already sent emails cannot be recalled. This cannot be undone.'))return;button.disabled=true;try{await api(`/api/admin/leads/${id}`,{method:'DELETE'});await load();}catch(e){alert(e.message);}finally{button.disabled=false;}}
async function confirmAppointment(id,form){if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;try{await updateLead(id,{status:'appointment_confirmed',showing_date:form.querySelector('[name=date]').value,showing_time:form.querySelector('[name=time]').value});}catch(e){alert(e.message);}finally{button.disabled=false;}}
function renderAgents(){$("agents").innerHTML=agentData.length?agentData.map(a=>`<article class="agent ${a.active?"":"inactive"}"><div><span>${esc(a.code)} · Order ${a.assignment_order}</span><h2>${esc(a.display_name)}</h2><p>${a.email?esc(a.email):"No email"} · ${a.mobile?esc(a.mobile):"No mobile"}</p></div><div><b>${a.active?"Available":"Unavailable"}</b><button data-edit="${a.id}">Edit</button></div></article>`).join(""):"<p>No agents configured.</p>";document.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openAgent(agentData.find(a=>a.id===b.dataset.edit))));}
function agentOptions(selected){return `<option value="">Choose an agent…</option>`+agentData.filter(a=>a.active||a.id===selected).map(a=>`<option value="${a.id}" ${a.id===selected?"selected":""}>${esc(a.display_name)}${a.email||a.mobile?"":" — missing destination"}</option>`).join("")}
function timing(v){return({asap:"As soon as possible",today:"Today, if available",within_24h:"Within 24 hours",seller_curious:"Just curious",seller_0_3:"0–3 months",seller_3_6:"3–6 months",seller_6_12:"6–12 months"})[v]||String(v||"—").replaceAll("_"," ")}
function calendarParts(value){if(!value)return {date:'',time:''};const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).reduce((a,p)=>(a[p.type]=p.value,a),{});return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
function card(x){
 const a=x.agents||null,report=Array.isArray(x.property_reports)?x.property_reports[0]:x.property_reports,jobs=x.automation_jobs||[],p=report?.report_payload||{},v=p.valuation||{},n=p.narrative||{};
 const showing=x.showing_requested || (x.metadata?.lead_mode||x.lead_mode)==='showing', preferred=calendarParts(x.preferred_showing_at),busy=jobs.some(j=>j.status==='processing');
 const reportView=report?`<details class="report-preview report-archive" data-report-lead="${x.id}"><summary>📄 Saved ${esc((x.lead_mode||x.metadata?.lead_mode)==='seller'?'seller':'buyer')} reports <span>${esc(report.status)} · ${date(report.generated_at)}</span></summary><div class="report-archive-body"><p>Open to view the saved report and email copies.</p></div></details>`:'';
 const sp=x.property_snapshot?.sellerProfile;
 const sellerView=sp?`<details class="report-preview seller-lead"><summary>Seller’s home &amp; pricing goals</summary><div><p><b>Target:</b> ${sp.targetMin?money(sp.targetMin)+'–'+money(sp.targetMax):sp.targetPrice?money(sp.targetPrice):'Open to guidance'} · <b>Timing:</b> ${esc(({exploring:'Exploring options','0_3':'Within 3 months','3_6':'3–6 months','6_12':'6–12 months'})[sp.timing]||sp.timing)}</p><p>${esc(sp.homeType)} · ${esc(sp.city)} · ${esc(sp.community||'Community to confirm')} · ${esc(sp.sizeBand==='unknown'?'Size to confirm':sp.sizeBand+' sq ft')} · ${esc(sp.beds)} above-ground bedrooms</p><p>Basement: ${esc(sp.basement)} · Separate entrance: ${esc(sp.entrance)} · Kitchens: ${esc(sp.kitchens??'To confirm')}</p><p><b>Condition:</b> ${esc(sp.condition)}</p><ul>${(sp.upgrades||[]).map(u=>`<li>${esc(({kitchen:'Kitchen',bathrooms:'Bathrooms',flooring:'Floors & finishes',basement:'Basement',windows:'Windows & doors',roof:'Roof',systems:'Heating & cooling',exterior:'Outdoor space',layout:'Layout & additions'})[u.id]||u.id)} · ${esc(({within_10:'Within the past 10 years','0_2':'Within 2 years','3_5':'3–5 years ago','6_plus':'More than 5 years ago',unknown:'Date to confirm'})[u.recency])}${u.documents?' · Documents available':''}</li>`).join('')||'<li>No individual upgrades selected</li>'}</ul>${sp.notes?`<p><b>Owner notes:</b> ${esc(sp.notes)}</p>`:''}<small>Owner-provided details. Ownership / permission and report contact consent recorded ${date(sp.consentAt)}.</small></div></details>`:'';
 const calendar=showing?`<div class="appointment-admin"><b>${x.confirmed_showing_at&&x.status==='appointment_confirmed'?`Confirmed: ${date(x.confirmed_showing_at)} · Toronto time`:`Requested: ${x.preferred_showing_at?date(x.preferred_showing_at)+' · Toronto time':esc(timing(x.showing_timing))}`}</b>${x.status!=='appointment_confirmed'?`<form data-confirm-lead="${x.id}"><label>Confirmed date<input type="date" name="date" required value="${attr(preferred.date)}"></label><label>Time · Toronto<input type="time" name="time" min="09:00" max="20:30" step="1800" required value="${attr(preferred.time)}"></label><button type="submit">Confirm &amp; email buyer</button></form><small>Confirm availability with the listing side first. The buyer receives the final time and a calendar option.</small>`:''}</div>`:'';
 return `<article class="lead"><div class="leadtop"><div><span>${showing?'Showing + report':esc((x.lead_mode||x.metadata?.lead_mode)==='seller'?'Seller review':'Report / enquiry')} · ${date(x.created_at)}</span><h2>${esc(x.name)} — ${esc(x.resolved_address||x.metadata?.resolved_address||'Property')}</h2><p><a href="tel:${attr(x.mobile)}">${esc(x.mobile)}</a> · <a href="mailto:${attr(x.email)}">${esc(x.email)}</a></p></div><select aria-label="Lead status" data-status-id="${x.id}">${['new','contacted','appointment_pending',...(x.status==='appointment_confirmed'?['appointment_confirmed']:[]),'closed','lost'].map(v=>`<option ${x.status===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="assignment"><label for="agent-${x.id}">Assign to</label><select id="agent-${x.id}" data-agent-id="${x.id}" class="${a?'':'unassigned'}">${agentOptions(a?.id)}</select></div>${calendar}${sellerView}<div class="meta"><span>Agent <b>${esc(a?.display_name||'Awaiting admin')}</b></span><span>Stage <b>${esc(x.stage)}</b></span><span>Report <b>${esc(report?.status||'not requested')}</b></span></div>${reportView}<div class="jobs">${jobs.map(j=>`<span class="${esc(j.status)}">${esc(j.job_type)}: ${esc(j.status)}</span>`).join('')}</div><button class="remove-lead" data-remove-lead="${x.id}" ${busy?'disabled title="Wait for active jobs to finish"':''}>Remove lead</button></article>`;
}
async function assignLead(id,agentId,select){if(!agentId)return;select.disabled=true;try{await updateLead(id,{owner_agent_id:agentId});}catch(e){alert(e.message);await load();}finally{select.disabled=false;}}
async function updateLead(id,payload){await api(`/api/admin/leads/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});await load();}
async function saveSettings(e){e.preventDefault();$("settingsMessage").textContent="";try{await api("/api/admin/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({owner_notification_email:$("ownerEmail").value})});$("settingsMessage").textContent="Saved.";}catch(e){$("settingsMessage").textContent=e.message;}}
function openAgent(a=null){$("agentForm").hidden=false;$("agentFormTitle").textContent=a?"Edit agent":"Add agent";$("agentId").value=a?.id||"";$("agentName").value=a?.display_name||"";$("agentEmail").value=a?.email||"";$("agentMobile").value=a?.mobile||"";$("agentOrder").value=a?.assignment_order||"";$("agentActive").checked=a?.active!==false;$("agentError").textContent="";document.querySelector(".order-field").hidden=!a;$("agentName").focus();}function closeAgent(){$("agentForm").hidden=true;}
async function saveAgent(e){e.preventDefault();const id=$("agentId").value,payload={display_name:$("agentName").value,email:$("agentEmail").value,mobile:$("agentMobile").value,active:$("agentActive").checked};if(id)payload.assignment_order=Number($("agentOrder").value);try{await api(id?`/api/admin/agents/${id}`:"/api/admin/agents",{method:id?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});closeAgent();await load();}catch(e){$("agentError").textContent=e.message;}}
function stat(label,value){return `<article><span>${label}</span><strong>${value}</strong></article>`}function date(v){return v?new Date(v).toLocaleString("en-CA",{timeZone:"America/Toronto"}):"—"}function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0}).format(n):"—"}function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}function attr(v){return esc(v).replace(/`/g,"&#96;")}

// Fresh, read-only checks using the existing admin authorization.
$('sellerAuditForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const addresses=[...new Set($('sellerAuditAddresses').value.split(/\n/).map(v=>v.trim()).filter(Boolean))];
  if(!addresses.length||addresses.length>8){$('sellerAuditStatus').textContent='Enter one to eight addresses.';return;}
  $('sellerAuditRun').disabled=true;$('sellerAuditResults').replaceChildren();
  let completed=0,failed=0;
  try{
    for(const address of addresses){
      $('sellerAuditStatus').textContent=`Checking ${completed+1} of ${addresses.length}: ${address}`;
      const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p');
      article.className='lead';heading.textContent=address;article.append(heading,summary);$('sellerAuditResults').append(article);
      try{
        const r=await api('/api/admin/seller-preview?address='+encodeURIComponent(address)),v=r.valuation;
        summary.textContent=v.available?`${money(v.midpoint)} estimated midpoint · ${money(v.low)}–${money(v.high)} · ${v.confidence} confidence · ${r.comparables.length} sold comparisons`:v.basis;
        const detail=document.createElement('details'),label=document.createElement('summary'),pre=document.createElement('pre');
        label.textContent='Evidence and pricing details';pre.className='seller-audit-json';pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
        const {emailPreview,...evidence}=r;pre.textContent=JSON.stringify(evidence,null,2);detail.append(label,pre);article.append(detail);
        if(emailPreview){const preview=document.createElement('details'),caption=document.createElement('summary'),frame=document.createElement('iframe');caption.textContent='Preview this email report';frame.title='Seller email report for '+address;frame.setAttribute('sandbox','');frame.style.cssText='width:100%;height:900px;border:0;margin-top:12px';frame.srcdoc=emailPreview.html;preview.append(caption,frame);article.append(preview);}
      }catch(error){failed++;summary.textContent='Check failed: '+error.message;}
      completed++;
    }
    $('sellerAuditStatus').textContent=`${completed-failed} of ${completed} checks succeeded${failed?`; ${failed} failed`:""}. No leads, report jobs or emails were created.`;
  }finally{$('sellerAuditRun').disabled=false;}
});

async function loadReportArchive(container){
 const leadId=container.dataset.reportLead,body=container.querySelector('.report-archive-body');container.dataset.loaded='loading';body.textContent='Loading saved copies…';
 try{
  const data=await api('/api/admin/leads/'+leadId+'/reports');body.replaceChildren();
  const copies=[...(data.copies||[])];if(data.current?.status==='ready')copies.push({...data.current,subject:'Latest generated report',exactEmail:false});
  if(!copies.length){body.textContent='The report is still being prepared. Refresh after it is ready.';delete container.dataset.loaded;return;}
  const select=document.createElement('select');select.setAttribute('aria-label','Saved report version');
  copies.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=(c.exactEmail?'Email copy':'Current report')+' · '+date(c.sentAt||c.generatedAt||c.savedAt)+(c.version?' · v'+c.version:'')+' · '+c.status;select.append(o);});
  const status=document.createElement('p'),actions=document.createElement('div'),preview=document.createElement('div');actions.className='report-copy-actions';body.append(select,status,actions,preview);
  let loadSequence=0;
  async function openCopy(){const sequence=++loadSequence;status.textContent='Opening report…';actions.replaceChildren();preview.replaceChildren();try{
    const result=await api('/api/admin/leads/'+leadId+'/reports?copy='+encodeURIComponent(select.value));if(sequence!==loadSequence)return;
    const c=result.copy;status.textContent=c.exactEmail?'Exact saved email copy · '+c.status+' · '+date(c.sentAt||c.savedAt):'Saved report data, displayed with the current template. Select an email copy to see exactly what was sent.';
    const frame=document.createElement('iframe');frame.title=c.subject||'Saved property report';frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer';frame.srcdoc=c.html;preview.append(frame);
    const download=(label,content,type,ext)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download='THM-report-'+leadId+'-'+c.id+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);});actions.append(b);};
    download('Download report',c.html,'text/html;charset=utf-8','html');download('Download text',c.text||'','text/plain;charset=utf-8','txt');
    if(c.report)download('Download report data',JSON.stringify(c.report,null,2),'application/json','json');
  }catch(e){if(sequence===loadSequence)status.textContent=e.message;}}
  select.addEventListener('change',openCopy);await openCopy();container.dataset.loaded='true';
 }catch(e){body.textContent=e.message;delete container.dataset.loaded;}
}
