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
   const rows=[...db.values()].filter(x=>(!u.searchParams.has('status')||'eq.'+x.status===u.searchParams.get('status'))&&(!u.searchParams.has('fingerprint')||'eq.'+x.fingerprint===u.searchParams.get('fingerprint'))&&(!u.searchParams.has('id')||'eq.'+x.id===u.searchParams.get('id')));
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
  const body={mode:'test',confirmed:true,to:address,from:address,pdfBase64:pdf,pdfName:'synthetic.pdf',color:true,doubleSided:true,reviewProof:subject.reviewProof};
  assert.equal((await call('create',{...body,reviewProof:'forged'})).status,409);assert.equal(sends,0);
  const results=await Promise.all([call('create',body),call('create',body)]);assert(results.every(x=>x.ok));assert.equal(sends,1);assert.equal(results.filter(x=>x.duplicate).length,1);
  assert(!JSON.stringify([...db.values()]).includes(pdf));assert(!JSON.stringify(results).includes(env.POSTGRID_TEST_API_KEY));
  relisted=true;assert.equal((await call('create',{...body,color:false})).status,409);assert.equal(sends,1);relisted=false;
  providerFails=true;assert.equal((await call('create',{...body,color:false})).status,502);assert.equal(sends,2);const retry=await call('create',{...body,color:false});assert(retry.duplicate);assert.equal(retry.order.status,'needs_review');assert.equal(sends,2);
  assert.equal((await call('create',{...body,confirmed:false})).status,400);
  providerFails=false;providerRejects=true;const bad={...body,doubleSided:false};const rejection=await call('create',bad);assert.equal(rejection.status,422);assert.match(rejection.error,/PDF page size invalid/);assert(!rejection.error.includes(env.POSTGRID_TEST_API_KEY));assert.equal([...db.values()].filter(x=>x.status==='rejected').length,1);
  const previous=sends;await Promise.all([call('create',bad),call('create',bad)]);assert.equal(sends,previous+1,'Concurrent rejected retries reserve once');
 }finally{globalThis.fetch=original;}
});
test('UI requires selected recipients and review; per-recipient PDF overrides common PDF; clear removes private data',async()=>{
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'/tmp/thm-test-deps/node_modules/jsdom/lib/api.js');
 const dom=new JSDOM('<section id="prospectsView"></section>',{runScripts:'outside-only',url:'https://test.invalid'}),w=dom.window,d=w.document,$=id=>d.getElementById(id);let selected=[],calls=[];
 w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};
 w.eval(readFileSync(new URL('../admin-postgrid.js',import.meta.url),'utf8').replace(/^export /gm,'')+';window.init=initAdminPostgrid');
 const app=w.init({$,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getSelected:()=>selected,post:async(path,body)=>{calls.push({path,body});if(path.endsWith('/status'))return {connected:true};if(path.endsWith('/subject'))return {reviewProof:'fresh',address};return {order:{id:'synthetic',recipient:body.to,pdfName:body.pdfName,status:'ready',property:'Synthetic'}};}});
 await $('mailPrepare').onclick();assert.match($('mailError').textContent,/Select qualified/);assert.equal(calls.length,0);
 selected=[{address:'<script>unsafe</script>',reviewProof:'proof',listingKey:'synthetic'}];await $('mailPrepare').onclick();assert.equal($('mailForm').hidden,false);assert.equal(d.querySelector('script'),null);
 for(const [key,value]of Object.entries(address))$('mail-from-'+key).value=value;
 const file=name=>new w.File(['%PDF-1.4 synthetic document\n%%EOF'],name,{type:'application/pdf'});
 $('mailCommonPdf').onchange({target:{files:[file('common.pdf')]}});$('mailRecipients').onchange({target:{dataset:{mailFile:'0'},files:[file('personal.pdf')]}});
 await $('mailForm').onsubmit({preventDefault(){}});assert.equal(calls.filter(x=>x.path.endsWith('/create')).length,0);
 $('mailConfirm').checked=true;await $('mailForm').onsubmit({preventDefault(){}});const created=calls.find(x=>x.path.endsWith('/create'));assert.equal(created.body.pdfName,'personal.pdf');assert.equal(created.body.reviewProof,'fresh');assert.equal(created.body.mode,'test');assert($('mailResults').textContent.includes('personal.pdf'));
 app.clear();assert.equal($('mailResults').textContent,'');assert.equal($('mailRecipients').textContent,'');assert.equal($('mailForm').hidden,true);dom.window.close();
});
