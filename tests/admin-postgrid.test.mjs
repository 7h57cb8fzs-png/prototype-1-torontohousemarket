import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminPostgrid,pdfBytes,contact} from '../admin-postgrid-api.js';
import {adminProspects} from '../admin-prospects-api.js';
const env={ADMIN_API_KEY:'test-admin',POSTGRID_TEST_API_KEY:'test_sk_synthetic',AMPRE_VOW_TOKEN:'synthetic-feed',SUPABASE_SERVICE_ROLE_KEY:'synthetic-db'};
const address={firstName:'Synthetic',lastName:'Recipient',addressLine1:'123 Synthetic Rd',city:'Toronto',provinceOrState:'ON',postalOrZip:'M5V 2T6'};
const row={ListingKey:'SYNTHETIC-MAIL',MlsStatus:'Expired',StandardStatus:'Expired',ExpirationDate:'2026-09-15',OccupantType:'Owner',TransactionType:'For Sale',PropertyType:'Residential Freehold',StreetNumber:'123',StreetName:'Synthetic',StreetSuffix:'Rd',City:'Toronto C01',PostalCode:'M5V 2T6',ListingContractDate:'2026-08-01'};
const pdf=Buffer.from('%PDF-1.4\nSynthetic test document\n%%EOF').toString('base64');
const request=(action,body={},key=env.ADMIN_API_KEY)=>new Request('https://test.invalid/api/admin/'+action,{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify(body)});
test('PDF limits handle large uploads; Canadian addresses validate and discard extra fields',()=>{
 assert.throws(()=>pdfBytes(Buffer.from('<html>bad</html>').toString('base64')));assert.throws(()=>pdfBytes(pdf+'!'));
 const large=Buffer.alloc(8*1024*1024,32);large.write('%PDF-1.4');assert.equal(pdfBytes(large.toString('base64')).length,large.length);
 assert.equal(contact({...address,postalOrZip:'m5v2t6',secret:'drop'}).postalOrZip,'M5V 2T6');assert.equal(contact({...address,secret:'drop'}).secret,undefined);assert.throws(()=>contact({...address,postalOrZip:'invalid'}));
});
test('auth, test-only gating, revalidation, atomic duplicate reservation and uncertain outcomes',async()=>{
 const original=globalThis.fetch,db=new Map();let sends=0,reads=0,relisted=false,providerFails=false,providerRejects=false;
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);reads++;
  if(u.hostname==='api.postgrid.com'){
   assert.equal(init.headers['x-api-key'],env.POSTGRID_TEST_API_KEY);assert.equal(init.redirect,'manual');
   if(init.method==='POST'){sends++;assert(init.headers['Idempotency-Key']);assert.equal(init.body.get('to[countryCode]'),'CA');assert.equal(init.body.get('addressPlacement'),'insert_blank_page');assert.equal(init.body.get('pdf').type,'application/pdf');if(providerRejects){await new Promise(r=>setTimeout(r,20));return Response.json({error:{message:'PDF page size invalid '+env.POSTGRID_TEST_API_KEY}},{status:400});}if(providerFails)throw Error('synthetic private error');return Response.json({id:'letter_synthetic'+sends,live:false,status:'ready',url:'https://example.com/preview.pdf'});}
   return Response.json({data:[]});
  }
  if(u.hostname.endsWith('supabase.co')){
   const data=init.body?JSON.parse(init.body):null;
   if(init.method==='POST'){if(db.has(data.fingerprint))return Response.json([]);db.set(data.fingerprint,{...data,created_at:new Date().toISOString()});return Response.json([db.get(data.fingerprint)]);}
   const idFilter=u.searchParams.get('id');const rows=[...db.values()].filter(x=>(!u.searchParams.has('deleted_at')||!x.deleted_at)&&(!u.searchParams.has('mode')||'eq.'+x.mode===u.searchParams.get('mode'))&&(!u.searchParams.has('status')||'eq.'+x.status===u.searchParams.get('status'))&&(!u.searchParams.has('fingerprint')||'eq.'+x.fingerprint===u.searchParams.get('fingerprint'))&&(!idFilter||(idFilter.startsWith('in.(')?idFilter.slice(4,-1).split(',').includes(x.id):'eq.'+x.id===idFilter)));
   if(init.method==='PATCH')rows.forEach(x=>Object.assign(x,data));return Response.json(rows);
  }
  if(u.pathname.endsWith('$metadata'))return new Response('<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="Edm.String"/>`).join('')+'</EntityType>');
  if(u.pathname.includes('Property('))return Response.json(row);
  return Response.json({value:[row,...(relisted?[{...row,ListingKey:'NEW',MlsStatus:'New',ListingContractDate:'2026-10-01'}]:[])],'@odata.count':relisted?2:1});
 };
 const call=async(a,b,e=env)=>{const r=await adminPostgrid(request('postgrid/'+a,b),e);return {status:r.status,...await r.json()};};
 try{
  assert.equal((await adminPostgrid(request('postgrid/status',{},'wrong'),env)).status,401);assert.equal(reads,0);
  assert.equal((await call('status',{}, {...env,POSTGRID_TEST_API_KEY:'live_sk_never'})).status,503);assert.equal(reads,0);
  assert.equal((await call('create',{mode:'live'})).status,403);assert.equal(reads,0);
  const search=await (await adminProspects(request('prospects/search'),env)).json();const checked=await(await adminProspects(request('prospects/verify',{proof:search.candidates[0].proof}),env)).json();assert.equal(checked.result,'qualified');
  const subject=await call('subject',{reviewProof:checked.reviewProof});assert.equal(subject.address.city,'Toronto');assert.equal(subject.address.postalOrZip,'M5V 2T6');
  row.ListAgentFullName='Synthetic Listing Agent';assert.equal((await call('subject',{reviewProof:checked.reviewProof})).address.firstName,'');
  row.OwnerName='Synthetic Owner & Second Owner';assert.equal((await call('subject',{reviewProof:checked.reviewProof})).address.firstName,'Synthetic Owner & Second Owner');
  row.OwnerName='Withheld';assert.equal((await call('subject',{reviewProof:checked.reviewProof})).address.firstName,undefined);delete row.OwnerName;delete row.ListAgentFullName;
  const body={mode:'test',confirmed:true,to:address,from:address,pdfBase64:pdf,pdfName:'synthetic.pdf',color:true,doubleSided:true,reviewProof:subject.reviewProof};
  assert.equal((await call('create',{...body,reviewProof:'forged'})).status,409);assert.equal(sends,0);
  const results=await Promise.all([call('create',body),call('create',body)]);assert(results.every(x=>x.ok));assert.equal(sends,1);assert.equal(results.filter(x=>x.duplicate).length,1);
  assert(!JSON.stringify([...db.values()]).includes(pdf));assert(!JSON.stringify(results).includes(env.POSTGRID_TEST_API_KEY));
  const orderId=results[0].order.id;
  assert.equal((await call('delete',{ids:[orderId]})).status,400);
  assert.equal((await call('delete',{confirmed:true,ids:['bad),mode.eq.live']})).status,400);
  assert.equal((await call('delete',{confirmed:true,ids:Array(101).fill(orderId)})).status,400);
  const removed=await call('delete',{confirmed:true,ids:[orderId,orderId]});assert.deepEqual(removed.deletedIds,[orderId]);assert.equal(sends,1);assert.equal(db.size,1);assert([...db.values()][0].deleted_at);
  assert.equal((await call('history')).orders.length,0);assert.equal((await call('refresh',{id:orderId})).status,404);
  const restored=await call('create',body);assert.equal(restored.duplicate,true);assert.equal(sends,1);assert.equal(restored.order.deletedAt,null);assert.equal((await call('history')).orders.length,1);
  relisted=true;assert.equal((await call('create',{...body,color:false})).status,409);assert.equal(sends,1);relisted=false;
  providerFails=true;assert.equal((await call('create',{...body,color:false})).status,502);assert.equal(sends,2);const retry=await call('create',{...body,color:false});assert(retry.duplicate);assert.equal(retry.order.status,'needs_review');assert.equal(sends,2);
  assert.equal((await call('create',{...body,confirmed:false})).status,400);
  providerFails=false;providerRejects=true;const bad={...body,doubleSided:false};const rejection=await call('create',bad);assert.equal(rejection.status,422);assert.match(rejection.error,/PDF page size invalid/);assert(!rejection.error.includes(env.POSTGRID_TEST_API_KEY));assert.equal([...db.values()].filter(x=>x.status==='rejected').length,1);
  const previous=sends;await Promise.all([call('create',bad),call('create',bad)]);assert.equal(sends,previous+1,'Concurrent rejected retries reserve once');
 }finally{globalThis.fetch=original;}
});
async function uiHarness(){
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'/tmp/thm-test-deps/node_modules/jsdom/lib/api.js');
 const dom=new JSDOM('<main><section id="prospectsView"></section></main>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window,d=w.document,$=id=>d.getElementById(id);const calls=[],saved=[],opened=[];let selection=[],subjectHook=null;
 w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};w.open=()=>({opener:null,location:{replace:url=>opened.push(url)},close(){}});
 w.eval(readFileSync(new URL('../admin-postgrid.js',import.meta.url),'utf8').replace(/^export /gm,'')+';window.init=initAdminPostgrid');
 const post=async(path,body)=>{calls.push({path,body});if(path.endsWith('/status'))return {connected:true};if(path.endsWith('/subject'))return subjectHook?subjectHook(body):{reviewProof:'fresh-'+body.reviewProof,address:{...address,firstName:'',lastName:''}};if(path.endsWith('/history'))return {orders:[...saved]};if(path.endsWith('/delete')){for(let i=saved.length-1;i>=0;i--)if(body.ids.includes(saved[i].id))saved.splice(i,1);return {deletedIds:body.ids};}if(path.endsWith('/refresh'))return {order:{...saved.find(o=>o.id===body.id),previewUrl:'https://example.com/fresh-preview.pdf'}};
  const order={id:'order-'+saved.length,postgridId:'letter_'+saved.length,recipient:body.to,sender:body.from,pdfName:body.pdfName,status:'ready',property:body.reviewProof,createdAt:'2026-10-05T12:00:00Z'};saved.unshift(order);return {order};};
 const app=w.init({$,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getSelected:()=>selection,post});
 const set=rows=>{selection=rows.map(key=>({address:key==='A'?'<script>unsafe</script>':key+' Road',reviewProof:key,listingKey:key}));app.selectionChanged();};
 const fill=()=>{for(const [key,value]of Object.entries(address))if($('mail-from-'+key))$('mail-from-'+key).value=value;selection.forEach((_,i)=>{if($('mail-to-'+i+'-firstName'))$('mail-to-'+i+'-firstName').value='Recipient '+i;});};
 const file=name=>new w.File(['%PDF-1.4 synthetic document\n%%EOF'],name,{type:'application/pdf'});
 const submit=async()=>{$('mailConfirm').checked=true;await $('mailForm').onsubmit({preventDefault(){}});};
 const wait=()=>new Promise(r=>setTimeout(r,250));
 return {dom,w,d,$,app,set,fill,file,submit,wait,calls,saved,opened,hook(fn){subjectHook=fn;}};
}
test('mass and customized modes send the chosen PDFs, default to Golestan Team, and keep history separate',async()=>{
 const h=await uiHarness(),{$,app,dom}=h;
 try{
  assert.equal($('mail-from-companyName').value,'Golestan Team');assert.equal($('mail-from-addressLine1').value,'1053 McNicoll Ave');assert.equal($('mail-from-city').value,'Toronto');assert.equal($('mail-from-postalOrZip').value,'M1W 3W6');assert.equal($('mailHistoryView').hidden,true);
  await $('mailPrepare').onclick();assert.match($('mailError').textContent,/Select qualified/);
  h.set(['A','B']);await $('mailPrepare').onclick();assert.equal($('mail-to-0-firstName').value,'Current Homeowner');assert.equal($('mail-to-1-firstName').value,'Current Homeowner');h.fill();assert.equal(h.d.querySelector('script'),null);assert.equal($('mailForm').hidden,false);
  $('mailCommonPdf').onchange({target:{files:[h.file('shared.pdf')]}});await $('mailForm').onsubmit({preventDefault(){}});assert.equal(h.calls.filter(x=>x.path.endsWith('/create')).length,0);
  await h.submit();let made=h.calls.filter(x=>x.path.endsWith('/create'));assert.deepEqual(made.map(x=>x.body.pdfName),['shared.pdf','shared.pdf']);assert(made.every(x=>x.body.from.companyName==='Golestan Team'&&x.body.mode==='test'));
  $('mailModeCustom').checked=true;$('mailModeCustom').onchange();assert.equal($('mailSharedUpload').hidden,true);
  for(let i=0;i<2;i++)$('mailRecipients').onchange({target:{dataset:{mailFile:String(i)},files:[h.file('custom-'+i+'.pdf')]}});
  await h.submit();made=h.calls.filter(x=>x.path.endsWith('/create'));assert.deepEqual(made.slice(2).map(x=>x.body.pdfName),['custom-0.pdf','custom-1.pdf']);
  await $('mailHistory').onclick();assert.equal($('mailHistoryView').hidden,false);assert.equal($('postgridPanel').querySelector('#mailHistoryResults'),null);assert.match($('mailHistoryCount').textContent,/4 records/);
  $('mailHistorySearch').value='custom-1';$('mailHistorySearch').oninput();assert.equal($('mailHistoryResults').querySelectorAll('.mail-result').length,1);
  $('mailHistoryResults').querySelector('[data-mail-preview]').click();await h.wait();assert.deepEqual(h.opened,['https://example.com/fresh-preview.pdf']);
  app.clear();assert.equal($('mailResults').textContent,'');assert.equal($('mailRecipients').textContent,'');assert.equal($('mailForm').hidden,true);assert.equal($('mail-from-companyName').value,'Golestan Team');
 }finally{app.clear();dom.window.close();}
});
test('selection changes retain matching drafts and shared PDF, discard removed recipients, and never send stale selections',async()=>{
 const h=await uiHarness(),{$,app,dom}=h;
 try{
  h.set(['A','B']);await $('mailPrepare').onclick();h.fill();$('mail-to-1-firstName').value='Keep this name';$('mailCommonPdf').onchange({target:{files:[h.file('shared.pdf')]}});$('mailConfirm').checked=true;
  h.set(['B','C']);assert.equal($('mailConfirm').checked,false);await h.wait();assert.equal($('mail-to-0-firstName').value,'Keep this name');assert.equal($('mail-to-1-firstName').value,'Current Homeowner');assert.equal($('mail-from-companyName').value,'Golestan Team');assert.match($('mail-file-1').textContent,/shared.pdf/);
  $('mail-to-1-firstName').value='New recipient';await h.submit();const made=h.calls.filter(x=>x.path.endsWith('/create'));assert.deepEqual(made.map(x=>x.body.reviewProof),['fresh-B','fresh-C']);
  h.set([]);await h.wait();assert.equal($('mailForm').hidden,true);assert.equal($('mailRecipients').textContent,'');
  h.set(['D']);await h.wait();assert.equal($('mail-to-0-firstName').value,'Current Homeowner');assert.match($('mail-file-0').textContent,/shared.pdf/);
 }finally{app.clear();dom.window.close();}
});
test('sign-out and rapid selection changes ignore late recipient responses',async()=>{
 const h=await uiHarness(),{$,app,dom}=h;let resolve;
 try{
  h.set(['A']);h.hook(()=>new Promise(r=>resolve=r));const pending=$('mailPrepare').onclick();await Promise.resolve();app.clear();resolve({reviewProof:'late',address});await pending;assert.equal($('mailForm').hidden,true);assert.equal($('mailRecipients').textContent,'');assert.equal($('mailStatus').textContent,'');
 }finally{app.clear();dom.window.close();}
});

test('selection changes during recipient loading never copy a removed property name onto another card',async()=>{
 const h=await uiHarness(),{$,app,dom}=h;let resolve;
 try{
  h.set(['A','B']);await $('mailPrepare').onclick();h.fill();$('mail-to-0-firstName').value='Only for A';$('mail-to-1-firstName').value='Only for B';
  h.hook(body=>body.reviewProof==='C'?new Promise(r=>resolve=r):{reviewProof:'fresh-'+body.reviewProof,address:{...address,firstName:'',lastName:''}});
  h.set(['B','C']);await h.wait();assert.equal(typeof resolve,'function');
  h.set(['B','D']);await h.wait();assert.equal($('mail-to-0-firstName').value,'Only for B');assert.equal($('mail-to-1-firstName').value,'Current Homeowner');
  resolve({reviewProof:'late-C',address:{...address,firstName:'Only for C'}});await Promise.resolve();await Promise.resolve();
  assert.equal($('mail-to-0-firstName').value,'Only for B');assert.equal($('mail-to-1-firstName').value,'Current Homeowner');assert.equal(h.d.querySelectorAll('.mail-recipient').length,2);
 }finally{app.clear();dom.window.close();}
});

test('history select all spans pages, filter changes clear selections, and deletion needs explicit review',async()=>{
 const h=await uiHarness(),{$,app,dom}=h;
 try{
  for(let i=0;i<12;i++)h.saved.push({id:'history-'+i,property:'Property '+i,pdfName:'letter.pdf',recipient:{firstName:'Synthetic '+i},status:'ready'});
  await app.loadHistory(false);$('mailHistorySelectAll').checked=true;$('mailHistorySelectAll').onchange({target:$('mailHistorySelectAll')});assert.equal($('mailHistorySelectedCount').textContent,'12 selected');assert.equal(h.d.querySelectorAll('[data-history-pick]:checked').length,10);
  $('mailHistoryNext').onclick();assert.equal(h.d.querySelectorAll('[data-history-pick]:checked').length,2);
  $('mailHistoryDelete').onclick();assert.equal($('mailDeletePrompt').hidden,false);assert.match($('mailDeleteQuestion').textContent,/12 selected records/);assert.equal(h.calls.filter(x=>x.path.endsWith('/delete')).length,0);
  $('mailDeleteCancel').onclick();assert.equal(h.saved.length,12);assert.equal($('mailDeletePrompt').hidden,true);
  $('mailHistorySearch').value='Property 11';$('mailHistorySearch').oninput();assert.equal($('mailHistorySelectedCount').textContent,'0 selected');assert.equal($('mailHistoryDelete').disabled,true);
  $('mailHistorySelectAll').checked=true;$('mailHistorySelectAll').onchange({target:$('mailHistorySelectAll')});$('mailHistoryDelete').onclick();await $('mailDeleteConfirm').onclick();
  assert.equal(JSON.stringify(h.calls.find(x=>x.path.endsWith('/delete')).body),JSON.stringify({ids:['history-11'],confirmed:true}));assert.equal(h.saved.length,11);assert.equal(h.d.querySelectorAll('[data-history-pick]').length,0);
  $('mailHistorySearch').value='';$('mailHistorySearch').oninput();await app.loadHistory(false);assert.match($('mailHistoryCount').textContent,/11 records/);
  app.clear();assert.equal($('mail-from-postalOrZip').value,'M1W 3W6');assert.equal($('mailHistorySelectedCount').textContent,'0 selected');
 }finally{app.clear();dom.window.close();}
});
