import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{adminLeadReports,discoverySelection,propertyReportEmail,sellerReportEmail} from '../worker-v11.js';
import {homeChat,signChatState,readChatState,validChatFilters} from '../home-chat.js';
const env={OPENAI_API_KEY:'fixture',PUBLIC_DISCOVERY_ENABLED:'true',ADMIN_API_KEY:'admin-fixture-test-key-1234567890',SUPABASE_SERVICE_ROLE_KEY:'db-fixture',AMPRE_TOKEN:'idx-fixture'};
const filters={cities:['Richmond Hill'],type:'condo',mode:'all',minPrice:0,maxPrice:800000,minBeds:2,maxBeds:2,minBaths:0,minParking:0,minSqft:0,area:'',sort:'newest',checks:[]};
const homes=Array.from({length:12},(_,i)=>({listingKey:'N100000'+i,address:`${i+1} Fixture Road, Richmond Hill`,city:'Richmond Hill',listPrice:600000+i*1000,beds:2,baths:2,propertySubType:'Condo Apartment',livingAreaRange:'800-899'}));
const response=d=>Response.json(d);
const request=(message,state)=>new Request('https://example.com/api/home-chat',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({message,state})});
const events=async r=>(await r.text()).trim().split('\n').map(x=>JSON.parse(x));
const llm=d=>response({output_text:JSON.stringify(d)});

test('chat context rejects tampering and keeps server-verified listing facts',async()=>{
 const token=await signChatState({filters,pool:homes},env);assert.equal((await readChatState(token,env)).pool[0].listPrice,600000);
 const [payload,signature]=token.split('.');const data=JSON.parse(Buffer.from(payload,'base64url'));data.pool[0].listPrice=1;
 assert.equal(await readChatState(Buffer.from(JSON.stringify(data)).toString('base64url')+'.'+signature,env),null);
 assert.equal(validChatFilters({...filters,maxBeds:1}),false);assert.equal(validChatFilters({...filters,cities:['Montreal']}),false);
});
test('AI chat searches, retains context, pages distinct homes, and answers without requerying MLS',async t=>{
 let action='search',calls=0,plans=0;const seen=[];
 t.mock.method(globalThis,'fetch',async (_url,options)=>{
   const body=JSON.parse(options.body),input=JSON.parse(body.input[1].content);assert.equal(body.model,'gpt-5.6-luna');
   if(body.text.format.name==='thm_conversation_plan'){plans++;seen.push(input);return llm({action,filters,propertyQuery:'',clarification:''});}
   return llm({reply:'These condos have two reported bathrooms. Which area would you like next?',followups:['Try Vaughan'],referencedListingKeys:input.currentHomes.slice(0,1).map(h=>h.listingKey)});
 });
 const app={fetch:async r=>{calls++;const u=new URL(r.url);assert.equal(u.pathname,'/api/discovery');assert.equal(u.searchParams.get('maxBeds'),'2');assert.equal(u.searchParams.get('city'),'Richmond Hill');return response({ok:true,listings:homes,coverage:{partial:true,matched:12},checkedAt:new Date().toISOString()});}};
 let out=await events(await homeChat(request('2 bed condos in Richmond Hill under800k'),env,null,app));
 assert.deepEqual(out.find(x=>x.type==='results').listings.map(x=>x.listingKey),homes.slice(0,6).map(x=>x.listingKey));assert.equal(out.at(-1).ai,true);let state=out.at(-1).state;
 action='more';out=await events(await homeChat(request('Show more',state),env,null,app));assert.deepEqual(out.find(x=>x.type==='results').listings.map(x=>x.listingKey),homes.slice(6).map(x=>x.listingKey));state=out.at(-1).state;
 action='answer';out=await events(await homeChat(request('Which has most bathrooms?',state),env,null,app));assert.equal(out.some(x=>x.type==='results'),false);assert.equal(calls,1);assert.equal(plans,3);assert.equal(seen[2].previousHomes.length,12);assert.equal(seen[2].conversation.length,4);
});
test('more choices with a changed budget searches the new filters instead of paging old homes',async t=>{
 const changed={...filters,maxPrice:605000};let calls=0;
 const state=await signChatState({filters,pool:homes,offset:6,recent:homes.slice(0,6)},env);
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.input[1].content);
  if(body.text.format.name==='thm_conversation_plan')return llm({action:'more',filters:changed,propertyQuery:'',clarification:''});
  assert.equal(input.filters.maxPrice,605000);return llm({reply:'Here are the homes within your new budget.',followups:[],referencedListingKeys:[]});
 });
 const app={fetch:async r=>{calls++;assert.equal(new URL(r.url).searchParams.get('maxPrice'),'605000');return response({ok:true,listings:homes.filter(h=>h.listPrice<=605000)});}};
 const out=await events(await homeChat(request('Show more but under $605k',state),env,null,app)),result=out.find(x=>x.type==='results');
 assert.equal(calls,1);assert.equal(result.filters.maxPrice,605000);assert.ok(result.listings.every(h=>h.listPrice<=605000));assert.equal(result.shown,6);
});
test('clarification produces no guessed listings and external origin is rejected',async t=>{
 t.mock.method(globalThis,'fetch',async()=>llm({action:'clarify',filters,propertyQuery:'',clarification:'Which GTA city would you like?'}));
 const out=await events(await homeChat(request('homes in Montreal'),env,null,{fetch:()=>{throw Error('Must not query');}}));assert.equal(out.at(-1).reply,'Which GTA city would you like?');
 const r=await homeChat(new Request('https://example.com/api/home-chat',{method:'POST'}),env,null,{});assert.equal(r.status,403);
});
test('a failed model does not fabricate an AI response or erase saved context',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503}));
 const out=await events(await homeChat(request('Show homes in Toronto'),env,null,{}));assert.equal(out.at(-1).type,'error');assert.equal(out.some(x=>x.type==='answer'),false);
});
test('inventory uses bounded parallel pages and shares them between filter refinements',async t=>{
 const cache=new Map(),pending=[],oldCaches=globalThis.caches;globalThis.caches={default:{match:async k=>cache.get(k.url)?.clone(),put:async(k,r)=>{cache.set(k.url,r.clone());}}};t.after(()=>{if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;});
 let calls=0,active=0,maxActive=0;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
  calls++;const u=new URL(input);assert.equal(options.headers.Authorization,'Bearer idx-fixture');assert.equal(u.searchParams.has('$orderby'),false);
  if(u.searchParams.has('$count'))return response({'@odata.count':650,value:[]});
  const skip=Number(u.searchParams.get('$skip'));assert.ok(skip>=150&&skip<=550);active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;
  return response({value:Array.from({length:100},(_,i)=>({ListingKey:'N'+(1000000+skip+i),City:'Richmond Hill',UnparsedAddress:'Fixture',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Condo Apartment',ListPrice:600000,BedroomsAboveGrade:2,BathroomsTotalInteger:2}))});
 });
 const ctx={waitUntil:p=>pending.push(p)};
 let r=await worker.fetch(new Request('https://example.com/api/discovery?city=Richmond%20Hill&mode=all&type=condo&maxPrice=800000'),env,ctx);assert.equal(r.status,200);await Promise.all(pending);
 r=await worker.fetch(new Request('https://example.com/api/discovery?city=Richmond%20Hill&mode=all&type=condo&maxPrice=700000'),env,ctx);assert.equal(r.status,200);assert.equal(calls,6);assert.ok(maxActive>1);assert.equal((await r.json()).coverage.partial,true);
});
test('saved report copies require admin and remain exact after newer report generation',async t=>{
 const id='00000000-0000-4000-8000-000000000001',url='https://example.com/api/admin/leads/'+id+'/reports?copy=530';let calls=0;
 t.mock.method(globalThis,'fetch',async input=>{calls++;assert.match(String(input),/lead_id=eq\.00000000/);return response([{id:530,status:'sent',payload:{frozen_email:{subject:'Original report',html:'<p>Original range</p>',text:'Original range'},report_archive:{version:7.4,report:{valuation:{low:1,high:2}}}}}]);});
 assert.equal((await adminLeadReports(new Request(url),env,id)).status,401);assert.equal(calls,0);
 const r=await adminLeadReports(new Request(url,{headers:{Authorization:'Bearer admin-fixture-test-key-1234567890'}}),env,id),d=await r.json();assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(d.copy.html,'<p>Original range</p>');assert.equal(d.copy.exactEmail,true);assert.equal(d.copy.version,7.4);
});
test('report summary cards preserve AI wording and separate current asks from sold evidence',()=>{
 const report={version:7.4,generated_at:'2026-09-18',facts:{property_type:'Detached',for_sale:false},valuation:{available:true,midpoint:900000,low:800000,high:1000000,confidence:'Limited'},comparables:Array.from({length:3},(_,i)=>({listingKey:'C'+i,address:'Fixture '+i,soldPrice:900000,soldDate:'2026-09-01'})),narrative:{executive_summary:'The deep lot is the main distinction. Confirm the interior condition.'},seller:{strategy:{independent_market_read:'The deep lot is the main distinction. Confirm the interior condition.',listing_strategy:'Review these sales before choosing an asking price.'},evidence:{}}};
 for(const email of [propertyReportEmail('Fixture',{},report),sellerReportEmail('Fixture',report)]){assert.match(email.html,/YOUR 30-SECOND READ/);assert.match(email.html,/The deep lot is the main distinction/);assert.match(email.html,/Version 7.4/);}
});

test('property chat canonicalizes the explicit MLS and uses fresh public listing data',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.input[1].content);
  if(body.text.format.name==='thm_conversation_plan')return llm({action:'property',filters,propertyQuery:'MLS N1000000.',clarification:''});
  assert.equal(input.currentHomes[0].listingKey,'N1000000');assert.equal(input.currentHomes[0].listPrice,600000);
  return llm({reply:'This home asks $600,000. Confirm the condition before viewing.',followups:[],referencedListingKeys:['N1000000']});
 });
 const app={fetch:async r=>{const u=new URL(r.url);assert.equal(u.pathname,'/api/property');assert.equal(u.searchParams.get('listingKey'),'N1000000');return response({ok:true,property:{...homes[0],forSale:true}});}};
 const out=await events(await homeChat(request('Tell me about MLS N1000000. What should I check?'),env,null,app));
 assert.equal(out.find(x=>x.type==='results').listings.length,1);assert.equal(out.at(-1).ai,true);
});

test('neighbourhood and brokerage searches query their MLS scope, then enforce all public filters',async t=>{
 const calls=[];
 const records=[{ListingKey:'C9876543',City:'Toronto',CityRegion:'Annex',UnparsedAddress:'12 Annex Street',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Condo Apartment',ListPrice:750000,BedroomsAboveGrade:2,ListOfficeName:'CENTURY 21 LEADING EDGE REALTY INC.'},{ListingKey:'C9876544',City:'Toronto',CityRegion:'Annex',UnparsedAddress:'14 Annex Street',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Condo Apartment',ListPrice:700000,BedroomsAboveGrade:2,ListOfficeName:'Another Brokerage'},{ListingKey:'C9876545',City:'Toronto',CityRegion:'Annex',UnparsedAddress:'Hidden Street',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Condo Apartment',ListPrice:600000,BedroomsAboveGrade:2,ListOfficeName:'CENTURY 21 LEADING EDGE REALTY INC.',InternetAddressDisplayYN:false}];
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(input);calls.push(u);assert.equal(u.searchParams.get('$filter'),"contains(CityRegion,'Annex')");return response({'@odata.count':records.length,value:records});});
 const r=await worker.fetch(new Request('https://example.com/api/discovery?query=true&city=Toronto&mode=all&area=the%20annex&minBeds=2&brokerage=Century%2021%20Leading%20Edge'),env,{}),d=await r.json();
 assert.equal(d.ok,true);assert.equal(calls.length,1);assert.equal(d.coverage.partial,false);assert.deepEqual(d.listings.map(h=>h.listingKey),['C9876543']);
});

test('scope inventory is shared across bedroom and brokerage refinements',async t=>{
 const cache=new Map(),old=globalThis.caches,pending=[];globalThis.caches={default:{match:async k=>cache.get(k.url)?.clone(),put:async(k,r)=>cache.set(k.url,r.clone())}};t.after(()=>{if(old===undefined)delete globalThis.caches;else globalThis.caches=old;});
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response({'@odata.count':1,value:[{ListingKey:'C9876543',City:'Toronto',CityRegion:'Annex',UnparsedAddress:'12 Annex Street',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Detached',ListPrice:1500000,BedroomsAboveGrade:3}]});});
 for(const beds of [2,3]){const r=await worker.fetch(new Request('https://example.com/api/discovery?query=true&city=Toronto&mode=all&area=Annex&minBeds='+beds),env,{waitUntil:p=>pending.push(p)});assert.equal(r.status,200);await Promise.all(pending);}
 assert.equal(calls,1);
});

test('listing query literals are escaped and brokerage matching cannot broaden to another office',async()=>{
 const {listingFilter,brokerageMatches}=await import('../listing-query.js');
 const filter=listingFilter({city:'Toronto',area:"O'Brien",brokerage:'Century 21 Leading Edge',maxPrice:900000,minBeds:2},['Condo Apartment']);
 assert.match(filter,/o''brien/);assert.match(filter,/ListPrice le 900000/);assert.match(filter,/BedroomsAboveGrade ge 2/);
 assert.equal(brokerageMatches('CENTURY 21 LEADING EDGE REALTY INC.','Century 21 Leading Edge'),true);assert.equal(brokerageMatches('CENTURY 21 OTHER REALTY','Century 21 Leading Edge'),false);
});

test('provider failures produce an error, never an empty-market claim',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('upstream unavailable',{status:503}));
 const r=await worker.fetch(new Request('https://example.com/api/discovery?query=true&city=Toronto&mode=all&area=Annex'),env,{});assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
});

test('email infographics use actual sold prices and omit unsupported value ranges',async()=>{
 const {valueRangeGraphic,soldComparisonGraphic}=await import('../report-graphics.js');
 const comps=[{address:'One',soldPrice:800000,adjustedPrice:900000,soldDate:'2026-08-01'},{address:'Two',soldPrice:1000000,soldDate:'2026-08-02'},{address:'Three',soldPrice:900000,soldDate:'2026-08-03'}];
 const chart=soldComparisonGraphic(comps);assert.match(chart,/width="80.00%"/);assert.match(chart,/Adjusted comparison: \$900,000/);assert.match(chart,/Every bar starts at \$0/);
 assert.equal(valueRangeGraphic({valuation:{available:false},comparables:comps}),'');
 assert.equal(valueRangeGraphic({valuation:{available:true,low:800000,midpoint:900000,high:1000000},comparables:comps.slice(0,2)}),'');
 assert.match(valueRangeGraphic({valuation:{available:true,low:800000,midpoint:900000,high:1000000},comparables:comps}),/YOUR VALUE AT A GLANCE/);
});
