import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminProspects,screenRemarks,conditionPhotos,validatePhotoAssessment} from '../admin-prospects-api.js';
const row={ListingKey:'SYNTHETIC-CONDITION',MlsStatus:'Expired',StandardStatus:'Expired',ExpirationDate:'2026-09-15',OccupantType:'Owner',TransactionType:'For Sale',PropertyType:'Residential Freehold',StreetNumber:'123',StreetName:'Synthetic',StreetSuffix:'Rd',City:'Toronto C01',ListingContractDate:'2026-08-01',PublicRemarks:'Needs TLC. Original kitchen cabinets and worn flooring.'};
const media=Array.from({length:4},(_,i)=>({ResourceRecordKey:row.ListingKey,ResourceName:'Property',MediaKey:'photo-'+i+'-m',MediaType:'image/jpeg',MediaURL:'https://photos.example.com/'+i+'.jpg',ImageSizeDescription:'Medium',Order:i}));
const output={category:'needs_renovation',note:'Kitchen cabinets appear dated; consider refreshing doors and hardware.',reason:'Visible dated cabinet finishes.',confidence:'medium',interiorPhotoCount:3,roomsSeen:['kitchen','bathroom','living area'],areas:[{area:'Kitchen',observation:'Dated cabinets.',suggestion:'Consider a cabinet refresh.',photoNumbers:[2]}]};
test('remarks distinguish broad updates, partial updates, negation and conflicting descriptions, with grounded notes',()=>{
 assert.equal(screenRemarks({PublicRemarks:'Fully renovated throughout.'}).category,'no_obvious_renovation');
 assert.equal(screenRemarks({PrivateRemarks:'Handyman special. Needs TLC.'}).category,'needs_renovation');
 for(const text of ['New roof. Sold as-is.','Renovated kitchen.','Not fully renovated.','Could be fully renovated.','No renovation needed.','Fully renovated. Needs TLC.','Fully renovated in 1980.','Fully renovated. Original kitchen and worn flooring.'])assert.equal(screenRemarks({PublicRemarks:text}).category,'unable_to_assess',text);
 const result=screenRemarks(row);assert.equal(result.category,'needs_renovation');assert.match(result.note,/kitchen|flooring/i);assert(result.evidence.every(e=>row[e.field].includes(e.text)));assert(!result.note.includes('bathroom'));
});
test('photos preserve listing identity, deduplicate variants and sample across gallery',()=>{
 const photos=conditionPhotos([...media,{...media[0],MediaKey:'photo-0-l',ImageSizeDescription:'Large'}, {...media[0],ResourceRecordKey:'WRONG'},{...media[0],MediaKey:'bad',MediaURL:'http://localhost/test.jpg'}],row.ListingKey);
 assert.equal(photos.length,4);assert.equal(photos[0].key,'photo-0-m');assert.equal(conditionPhotos(media,'WRONG').length,0);
 const many=Array.from({length:30},(_,i)=>({...media[0],MediaKey:'key-'+i,Order:i}));const sample=conditionPhotos(many,row.ListingKey);assert.equal(sample.length,12);assert.equal(sample.at(-1).sequence,29);
});
test('photo classifications require useful interior evidence and valid references',()=>{
 const photos=conditionPhotos(media,row.ListingKey);assert.equal(validatePhotoAssessment(output,photos).category,'needs_renovation');
 assert.equal(validatePhotoAssessment({...output,interiorPhotoCount:0,areas:[]},photos).category,'unable_to_assess');
 assert.equal(validatePhotoAssessment({...output,category:'no_obvious_renovation',interiorPhotoCount:2,areas:[]},photos).category,'unable_to_assess');
 assert.throws(()=>validatePhotoAssessment({...output,areas:[{...output.areas[0],photoNumbers:[99]}]},photos));
 assert.throws(()=>validatePhotoAssessment({...output,note:null},photos));
 assert.equal(validatePhotoAssessment({...output,category:'no_obvious_renovation',roomsSeen:['living area','bedroom']},photos).category,'unable_to_assess');
});
test('authenticated qualified results only; remarks are free, photo estimates do not charge, saved reviews reuse and manual overrides persist',async()=>{
 const original=globalThis.fetch,db=new Map();let paid=0,detail=0;
 const meta='<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="Edm.String"/>`).join('')+'</EntityType>';
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);
  if(u.hostname.endsWith('supabase.co')){
   const payload=init.body?JSON.parse(init.body):null;
   if(init.method==='POST'){if(init.headers.Prefer.includes('ignore-duplicates')&&db.has(payload.cache_key))return Response.json([]);db.set(payload.cache_key,payload);return init.headers.Prefer.includes('representation')?Response.json([payload]):new Response(null,{status:201});}
   if(u.searchParams.get('mode'))return Response.json([...db.values()].filter(x=>x.mode==='photos'));
   return Response.json([...db.values()].filter(x=>x.state==='ready').map(x=>({mode:x.mode,assessment:x.assessment})));
  }
  if(u.hostname==='api.openai.com'){paid++;const p=JSON.parse(init.body);assert.equal(p.model,'gpt-4.1-mini');assert.equal(p.store,false);assert.equal(p.messages[1].content.filter(c=>c.type==='image_url').length,4);assert.equal(p.response_format.json_schema.strict,true);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1000,completion_tokens:100}});}
  assert.equal(init.headers.Authorization,'Bearer private');if(u.pathname.endsWith('$metadata'))return new Response(meta);if(u.pathname.endsWith('Media'))return Response.json({value:media});if(u.pathname.includes('Property(')){detail++;return Response.json(row);}return Response.json({value:[row],'@odata.count':1});
 };
 const env={ADMIN_API_KEY:'test',AMPRE_VOW_TOKEN:'private',SUPABASE_SERVICE_ROLE_KEY:'db-private',OPENAI_API_KEY:'ai-private'},req=(action,body,auth='test')=>new Request('https://example.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify(body)});
 const call=async(action,body)=>{const r=await adminProspects(req(action,body),env);assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  assert.equal((await adminProspects(req('condition',{},'wrong'),env)).status,401);assert.equal(detail,0);
  assert.equal((await adminProspects(req('condition',{reviewProof:'fake'}),env)).status,400);assert.equal(detail,0);
  const search=await call('search',{});assert.equal((await adminProspects(req('condition',{reviewProof:search.candidates[0].proof}),env)).status,400);
  const verified=await call('verify',{proof:search.candidates[0].proof});assert.equal(verified.result,'qualified');const reviewProof=verified.reviewProof;assert(reviewProof);
  const remarks=await call('condition',{reviewProof});assert.equal(remarks.assessment.source,'remarks');assert.equal(paid,0);
  const quote=await call('condition',{reviewProof,mode:'quote'});assert(quote.quote);assert.equal(paid,0);
  assert.equal((await adminProspects(req('condition',{reviewProof,mode:'photos',quote:'fake'}),env)).status,400);assert.equal(paid,0);
  const photo=await call('condition',{reviewProof,mode:'photos',quote:quote.quote});assert.equal(photo.assessment.source,'photos');assert.match(photo.assessment.note,/Kitchen/);assert.equal(paid,1);
  const again=await call('condition',{reviewProof,mode:'photos',quote:quote.quote});assert.equal(again.cached,true);assert.equal(paid,1);
  const manual=await call('condition',{reviewProof,mode:'manual',category:'no_obvious_renovation',note:'Visited: kitchen has since been updated.'});assert.equal(manual.assessment.source,'manual');assert.equal(manual.assessment.previousAssessment.source,'photos');
  const saved=await call('condition',{reviewProof});assert.equal(saved.assessment.source,'manual');assert.equal(paid,1);
 }finally{globalThis.fetch=original;}
});
test('admin selection, remarks notes, filtering, estimate gate and sign-out are functional',async()=>{
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'/tmp/thm-test-deps/node_modules/jsdom/lib/api.js');
 const dom=new JSDOM(readFileSync(new URL('../admin.html',import.meta.url),'utf8'),{runScripts:'outside-only',url:'https://example.invalid'}),w=dom.window,d=w.document;const calls=[];
 const code=readFileSync(new URL('../admin-prospects.js',import.meta.url),'utf8').replace(/^export /gm,'');w.eval(code+';window.init=initAdminProspects');
 const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const post=async(path,b)=>{calls.push([path,b]);if(path.endsWith('/options'))return {communities:['Crosby','Downsview-Roding-CFB','Unmapped community']};if(path.endsWith('/search'))return {pageId:'one',scanned:1,candidates:[{listingKey:'TEST',proof:'proof',address:'Test'}],excluded:{},complete:true};if(path.endsWith('/verify'))return {result:'qualified',listingKey:'TEST',reviewProof:'qualified',address:'Test',city:'Toronto',status:'Expired',eventDate:'2026-09-15'};if(b.mode==='quote')return {quote:'estimate',photoCount:4,estimatedUsd:.1};return {assessment:{...screenRemarks(row),note:'<script>unsafe</script> Kitchen may need a refresh.'}};};
 const app=w.init({$:id=>d.getElementById(id),post,esc,money:String});
 const browse=d.getElementById('prospectCommunityBrowse');browse.dispatchEvent(new w.Event('focus'));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(browse.querySelector('option[value="Crosby"]').parentElement.label,'Richmond Hill');
 assert.equal(browse.querySelector('option[value="Downsview-Roding-CFB"]').parentElement.label,'Toronto W05');
 assert.equal(browse.querySelector('option[value="Unmapped community"]').parentElement.label,'Other MLS communities');
 for(const name of ['Crosby','Downsview-Roding-CFB']){browse.value=name;browse.dispatchEvent(new w.Event('change'));assert.equal(d.getElementById('prospectCommunity').value,name);d.getElementById('prospectCommunityAdd').click();}
 d.getElementById('prospectCommunity').value='Manual community';
 await app.start();
 assert.deepEqual(Array.from(calls.find(([path])=>path.endsWith('/search'))[1].filters.communities),['Crosby','Downsview-Roding-CFB','Manual community']);
 assert.equal(calls.filter(([path])=>path.endsWith('/options')).length,1);
 d.getElementById('prospectSelectVisible').click();assert.equal(d.getElementById('prospectRemarks').disabled,false);
 const wait=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));};d.getElementById('prospectRemarks').click();await wait();assert(d.getElementById('prospectRows').textContent.includes('Kitchen'));assert.equal(d.querySelector('#prospectRows script'),null);
 d.getElementById('prospectPhotoQuote').click();await wait();assert.equal(d.getElementById('prospectPhotoEstimate').hidden,false);assert(!calls.some(([,b])=>b.mode==='photos'));
 d.getElementById('prospectConditionFilter').value='no_obvious_renovation';d.getElementById('prospectConditionFilter').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('#prospectRows tr').length,0);
 app.clear();assert.equal(d.getElementById('prospectPhotoEstimate').hidden,true);assert.equal(d.getElementById('prospectSelectionCount').textContent,'0 selected');dom.window.close();
});

test('verified listing bulk selection works as results arrive and never selects unverified records',async()=>{
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'/tmp/thm-test-deps/node_modules/jsdom/lib/api.js');
 const dom=new JSDOM(readFileSync(new URL('../admin.html',import.meta.url),'utf8'),{runScripts:'outside-only'}),w=dom.window,d=w.document,$=id=>d.getElementById(id);let release;
 w.eval(readFileSync(new URL('../admin-prospects.js',import.meta.url),'utf8').replace(/^export /gm,'')+';window.init=initAdminProspects');
 const record=key=>({result:key==='U'?'unverified':'qualified',listingKey:key,reviewProof:'proof-'+key,address:key+' Road',city:'Toronto',status:'Expired',eventDate:'2026-09-15'});
 const post=async(path,b)=>path.endsWith('/search')?{pageId:'one',scanned:3,candidates:['A','B','U'].map(key=>({listingKey:key,proof:key,address:key})),complete:true,excluded:{}}:b.proof==='B'?new Promise(r=>release=()=>r(record('B'))):record(b.proof);
 const app=w.init({$,post,esc:String,money:String});
 try{
  const scan=app.start();for(let i=0;i<20&&!release;i++)await new Promise(r=>setTimeout(r,1));assert.equal(typeof release,'function');
  assert.equal($('prospectSelectAll').disabled,false);$('prospectSelectAll').click();assert.equal(app.getSelected().length,1);assert.equal(app.getSelected()[0].listingKey,'A');
  release();await scan;assert.equal(app.getSelected().length,1,'New arrivals are not silently selected');assert.equal($('prospectSelectCheckbox').indeterminate,true);
  $('prospectSelectAll').click();assert.equal(app.getSelected().length,2);assert.equal($('prospectSelectCheckbox').checked,true);
  $('prospectSearch').value='B Road';$('prospectSearch').dispatchEvent(new w.Event('input'));$('prospectSelectCheckbox').checked=false;$('prospectSelectCheckbox').dispatchEvent(new w.Event('change'));assert.equal(app.getSelected().length,1);assert.equal(app.getSelected()[0].listingKey,'A');
  $('prospectSelectAll').click();assert.equal(app.getSelected().length,2,'Select all verified includes filtered-out verified rows');$('prospectClearSelected').click();assert.equal(app.getSelected().length,0);
 }finally{app.clear();dom.window.close();}
});
