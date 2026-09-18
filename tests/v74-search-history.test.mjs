import test from 'node:test';
import {shouldUseExpertComp} from '../worker-v12.js';
import assert from 'node:assert/strict';
import {basicSearch,homeSearch} from '../discovery-search.js';
import {resolveSellerSubject,discoverySelection,buildSellerEvidence} from '../worker-v11.js';
import {reportFetch,createReportRuntime} from '../report-runtime.js';
import {validatedArchive,sellerArchiveKey} from '../seller-archive.js';
import {reportPriceGraphic,sellerReportEmail} from '../worker-v11.js';
const originalFetch=globalThis.fetch;
const json=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
test('reviewed archives preserve exact identity and never import historical prices',()=>{
  const parsed={number:'38',name:'oak',suffix:'avenue',city:'Richmond Hill'};
  assert.equal(sellerArchiveKey(parsed),'38|oak|avenue|||richmondhill');
  const row={id:'fixture',verified_at:'2026-09-18',source_date:'2017-01-27',source_url:'https://example.com/archive',facts:{UnparsedAddress:'38 Oak Avenue, Richmond Hill',City:'Richmond Hill',PropertySubType:'Detached',BedroomsAboveGrade:4,ClosePrice:6500,ListPrice:6500}};
  const r=validatedArchive(row,parsed,'Richmond Hill',()=>true);assert.ok(r._sellerArchive);assert.equal(r.ClosePrice,undefined);assert.equal(r.ListPrice,undefined);assert.equal(r.StandardStatus,'Unknown');
  assert.equal(validatedArchive(row,parsed,'Toronto',()=>false),null);
  assert.equal(validatedArchive({...row,verified_at:null},parsed,'Richmond Hill',()=>true),null);
});
test('new confidence labels remain visible and an empty seller report makes no calculation claim',()=>{
  for(const confidence of ['Moderate','Strong','Limited'])assert.equal(reportPriceGraphic({valuation:{available:true,low:800000,high:900000,confidence},comparables:[{},{},{}]}).confidence,confidence);
  const email=sellerReportEmail('Fixture',{valuation:{available:false},seller:{evidence:{}}});assert.ok(!email.text.includes('Calculated from recovered MLS evidence'));assert.match(email.text,/No price has been calculated/);
});
test('AMPRE query URLs encode OData operators and multiword literals with percent spaces',async()=>{
  let url;globalThis.fetch=async input=>{url=String(input);return json({value:[]});};
  try{await reportFetch({},'https://query.ampre.ca/odata/Property?'+new URLSearchParams({'$filter':"StreetNumber eq '38' and City eq 'Richmond Hill'",'$top':'1'}));assert.ok(!url.includes('+'));assert.ok(url.includes('Richmond%20Hill'));assert.equal(new URL(url).searchParams.get('$filter'),"StreetNumber eq '38' and City eq 'Richmond Hill'");}finally{globalThis.fetch=originalFetch;}
});
test('plain search parses condo, multiword city, budget and bedrooms without model spend',()=>{
  const f=basicSearch('2 bedroom condo in Richmondhill under $750K');
  assert.equal(f.city,'Richmond Hill');assert.equal(f.type,'condo');assert.equal(f.minBeds,2);assert.equal(f.maxPrice,750000);assert.equal(f.needsModel,false);
  const t=basicSearch('3-bed townhouse in Vaughan under $1.2 million');assert.equal(t.type,'townhouse');assert.equal(t.maxPrice,1200000);
});
test('search uses public route and never trusts model-produced property facts',async()=>{
  globalThis.fetch=()=>{throw Error('Simple filter search must not call AI')};
  let url;
  try{
    const r=await homeSearch(new Request('https://thm.test/api/home-search?q='+encodeURIComponent('2 bed condo in Toronto under 700k')),{PUBLIC_DISCOVERY_ENABLED:'true',OPENAI_API_KEY:'fixture'},null,{fetch:async r=>{url=new URL(r.url);return json({ok:true,listings:[{listingKey:'C12345678'}]});}});
    assert.equal(r.status,200);assert.equal(url.pathname,'/api/discovery');assert.equal(url.searchParams.get('minBeds'),'2');assert.equal(url.searchParams.get('maxPrice'),'700000');
  }finally{globalThis.fetch=originalFetch;}
});
test('older exact seller record is recovered without a recency filter; wrong unit and city are rejected',async()=>{
  const row={ListingKey:'N1234567',StreetNumber:'38',StreetName:'Oak',StreetSuffix:'Avenue',City:'Richmond Hill',UnparsedAddress:'38 Oak Avenue, Richmond Hill',OriginalEntryTimestamp:'2017-01-01T00:00:00Z',PropertySubType:'Detached',BedroomsTotal:3};
  let calls=0;
  globalThis.fetch=async input=>{calls++;const u=new URL(input);assert.equal(u.searchParams.has('$orderby'),false);assert.ok(!/Timestamp|Date/.test(u.searchParams.get('$filter')||''));return u.pathname.includes("Property('")?json(row):json({value:[{...row,ListingKey:'C1111111',City:'Toronto'},{...row,ListingKey:'N2222222',UnitNumber:'2'},row]});};
  try{const diagnostics={};const r=await resolveSellerSubject('38 Oak Avenue, Richmond Hill',{city:'Richmond Hill'},{AMPRE_TOKEN:'fixture'},diagnostics);assert.equal(r.ListingKey,row.ListingKey);assert.equal(r._sellerHistory[0].recordedAt,'2017-01-01T00:00:00.000Z');assert.equal(calls,2);}finally{globalThis.fetch=originalFetch;}
});
test('public bedroom and reduction filters require real reported evidence',()=>{
  const common={ListingKey:'N12345678',UnparsedAddress:'Example',City:'Vaughan',PropertySubType:'Detached',StandardStatus:'Active',TransactionType:'For Sale',ListPrice:900000,BedroomsAboveGrade:3,BedroomsTotal:4};
  const f={city:'Vaughan',mode:'all',type:'any',maxPrice:null,minBeds:4};assert.equal(discoverySelection([common],f).length,0);
  f.minBeds=3;f.mode='reduced';assert.equal(discoverySelection([common],f).length,0);assert.equal(discoverySelection([{...common,OriginalListPrice:950000}],f).length,1);
});

test('conversational refinements preserve prior city, type and beds and reset area on a city change',()=>{
 const first=basicSearch('2 bedroom condos in Richmond Hill under $800K');
 const next=basicSearch('Under $700K','Toronto',first);
 assert.equal(next.city,'Richmond Hill');assert.equal(next.type,'condo');assert.equal(next.minBeds,2);assert.equal(next.maxPrice,700000);assert.equal(next.needsModel,false);
 const third=basicSearch('How about Vaughan?','Toronto',{...next,area:'Langstaff'});
 assert.equal(third.city,'Vaughan');assert.equal(third.area,'');assert.equal(third.type,'condo');assert.equal(third.maxPrice,700000);
 const reset=basicSearch('Any home type, any price, any bedrooms','Toronto',third);
 assert.equal(reset.type,'any');assert.equal(reset.maxPrice,null);assert.equal(reset.minBeds,0);
});

test('archived seller facts with missing interior size receive the broader Luna review',()=>{
 assert.equal(shouldUseExpertComp({valuation:{available:true,confidence:'Low'},comparables:Array(8).fill({}),comparable_policy:{missingSizeFallback:true,windowDays:100}}),true);
 assert.equal(shouldUseExpertComp({valuation:{available:true,confidence:'Medium'},comparables:Array(5).fill({}),comparable_policy:{windowDays:100}}),false);
});

test('seller email includes pricing reasoning and does not turn missing condition into zero percent',()=>{
 const report={valuation:{available:true,low:800000,high:1000000,midpoint:900000},comparables:[{},{},{}],seller:{profile:{renovationPct:null},strategy:{independent_market_read:'The deep lot is a key comparison.',listing_strategy:'Confirm condition before pricing.'}}};
 const message=sellerReportEmail('Fixture',report);
 assert.match(message.text,/The deep lot is a key comparison/);assert.match(message.html,/Confirm condition before pricing/);assert.doesNotMatch(message.text,/renovation context: 0%/);
});

test('URL-object OData requests also preserve spaces',async()=>{
 let sent;globalThis.fetch=async input=>{sent=String(input);return json({value:[]});};
 try{await reportFetch({},new URL('https://query.ampre.ca/odata/Property?'+new URLSearchParams({'$filter':"contains(CityRegion,'South Richvale')"})));assert.ok(sent.includes('South%20Richvale'));assert.ok(!sent.includes('+'));}finally{globalThis.fetch=originalFetch;}
});
test('seller tail-page sales remain available to subsequent expert recovery',async()=>{
 const subject={ListingKey:'SUBJECT',PropertySubType:'Detached',CityRegion:'Fixture',City:'Toronto',LivingAreaRange:'2000-2500',BedroomsTotal:4,LotWidth:50,StreetName:'Fixture'};
 const runtime=createReportRuntime({id:1,attempts:1});
 const sale=(id,date)=>({...subject,ListingKey:id,UnparsedAddress:id+' Fixture Street, Toronto',StreetNumber:id,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:1200000,PurchaseContractDate:date});
 globalThis.fetch=async input=>{
  const u=new URL(input);if(u.searchParams.get('$count'))return json({'@odata.count':1600,value:[]});
  const skip=Number(u.searchParams.get('$skip')||0);
  if(skip>=400)return json({value:[sale('TAIL-RECENT','2026-09-01')]});
  return json({value:Array.from({length:100},(_,i)=>sale('OLD-'+(skip+i),'2024-01-01')),'@odata.nextLink':'https://query.ampre.ca/odata/Property?$skip='+(skip+100)});
 };
 try{await buildSellerEvidence(subject,{AMPRE_TOKEN:'fixture',THM_REPORT_RUNTIME:runtime});assert.ok(runtime.rawRows.has('TAIL-RECENT'),'recent tail must be available to Luna alongside first pages');}finally{globalThis.fetch=originalFetch;}
});
