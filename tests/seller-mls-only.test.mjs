import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerRequest, loadPropertyForReport, resolveSellerSubject, buildSellerReport, sellerReportEmail, calculateSellerEvidence, sellerParsedAddress} from '../worker-v11.js';
import {buildVersion7Report} from '../worker-v12.js';
import {historicalSellerProperty} from '../seller-mls-input.js';
import {validatedArchive} from '../seller-archive.js';

// Synthetic fixtures only; no licensed source records or client information.
const address = '101 Example Avenue, Toronto';
const mls = {ListingKey:'C00000001',UnparsedAddress:address,StreetNumber:'101',StreetName:'Example',StreetSuffix:'Avenue',City:'Toronto',CityRegion:'Example Community',PostalCode:'M6E1A1',PropertySubType:'Detached',PropertyType:'Residential Freehold',ArchitecturalStyle:['Bungalow-Raised'],BedroomsAboveGrade:3,BedroomsBelowGrade:1,BedroomsTotal:4,BathroomsTotalInteger:3,LotWidth:50,LotDepth:120,LotSizeUnits:'Feet',KitchensTotal:1,Basement:['Finished','Separate Entrance'],OriginalEntryTimestamp:'2021-01-12T00:00:00Z',StandardStatus:'Closed'};
const profile = {homeType:'Detached',city:'Toronto',community:'Wrong seller community',sizeBand:'1500-2000',beds:9,belowBeds:5,basement:'apartment',entrance:'no',kitchens:4,postal:'L4X1C9',condition:'owner_reported',renovationPct:100,upgrades:[],targetPrice:9999999,targetMin:8000000,targetMax:9000000,timing:'0_3',notes:'OWNER_ONLY_SENTINEL',ownerConsent:true,contactConsent:true,marketingConsent:false};
const lead = p => ({lead_mode:'seller',resolved_address:address,metadata:{property_input:address},property_snapshot:{sellerProfile:p}});
const sold = n => ({...mls,ListingKey:`C0000000${n}`,StreetNumber:String(101+n),UnparsedAddress:`${101+n} Example Avenue, Toronto`,OriginalEntryTimestamp:'2026-08-01T00:00:00Z',PurchaseContractDate:'2026-08-20',TransactionType:'For Sale',ClosePrice:1000000+n*10000,LivingAreaRange:'1500-2000'});
const parsed = sellerParsedAddress(address);
function suppliedProperty(p) {
  const h=historicalSellerProperty(mls,address,parsed);
  return {...h,sellerProfile:p,sellerEvidence:{listingMatched:true,subjectMatched:true,listingFactsAgree:true,history:[]},comparableContext:calculateSellerEvidence(mls,[sold(2),sold(3),sold(4)])};
}
function stable(report){const r=structuredClone(report);delete r.generated_at;if(r.facts)delete r.facts.checked_at;return r;}

test('MLS-only evidence and AI inputs are invariant to all seller questionnaire answers',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-26T05:00:00Z')});
  const aiInputs=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(new URL(url).hostname,'api.openai.com','No external data writes are allowed in this fixture');
    aiInputs.push(JSON.parse(init.body).input);
    return Response.json({output_text:JSON.stringify({independent_market_read:'Historical MLS facts require a current condition review.',listing_strategy:'Confirm present condition before pricing.',value_drivers:[],preparation_priorities:[],expectation_comparison:''})});
  });
  const different={...profile,homeType:'Condo Apartment',city:'Vaughan',community:address,sizeBand:'700-799',beds:1,belowBeds:0,basement:'none',kitchens:8,condition:'original',renovationPct:0,targetMin:600000,targetMax:700000,targetPrice:650000,notes:'DIFFERENT_OWNER_ONLY_SENTINEL'};
  const a=await buildVersion7Report({OPENAI_API_KEY:'mock-only'},lead(profile),suppliedProperty(profile),'fixture-a');
  const b=await buildVersion7Report({OPENAI_API_KEY:'mock-only'},lead(different),suppliedProperty(different),'fixture-b');
  assert.deepEqual(stable(a),stable(b));
  assert.equal(a.facts.living_area,null,'Missing MLS size must never use seller size');
  assert.equal(a.facts.neighbourhood,'Example Community');assert.equal(a.facts.beds,3);assert.equal(a.facts.below_grade_beds,1);assert.equal(a.facts.kitchens,1);
  assert.equal(a.valuation.available,true,'Recorded bedrooms and lot frontage allow existing missing-size math');
  assert.equal(a.comparable_policy.missingSizeFallback,true);
  assert.deepEqual(aiInputs[0],aiInputs[1]);
  assert.doesNotMatch(JSON.stringify(aiInputs),/OWNER_ONLY_SENTINEL|Wrong seller community|9999999|renovationPct/);
  assert.equal(a.seller.profile.targetPrice,null);assert.equal(a.seller.profile.renovationPct,null);
  const email=sellerReportEmail(address,a);assert.doesNotMatch(email.html,/OWNER_ONLY_SENTINEL|Owner-reported renovation context/);
});

test('no historical match cannot turn seller-supplied details into valuation evidence',async t=>{
  const queries=[];
  t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);queries.push(u.searchParams.get('$filter')||'');return Response.json({value:[]});});
  const saved=lead(profile),before=structuredClone(saved);
  const p=await loadPropertyForReport({AMPRE_VOW_TOKEN:'fixture-only'},saved,'no-history');
  assert.deepEqual(saved,before,'The stored questionnaire is not modified');
  assert.equal(p.sellerEvidence.subjectMatched,false);assert.equal(p.propertySubType,'unknown');assert.equal(p.beds,null);assert.equal(p.livingAreaRange,null);assert.equal(p.cityRegion,null);
  assert.equal(p.comparableContext.comparables.length,0);
  assert(queries.every(q=>!q.includes('CityRegion')&&!q.includes('ClosePrice')&&!q.includes('Wrong seller')),'No guessed comparable search follows a failed identity');
  const report=await buildSellerReport({},saved,p,'no-history');assert.equal(report.valuation.available,false);
});

test('empty title-case lookup tries uppercase and recovers old MLS without seller city or age filters',async t=>{
  const queries=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url),filter=u.searchParams.get('$filter')||'';
    if(u.pathname.includes("Property('")) return Response.json(mls);
    queries.push(filter);assert(!/Timestamp|Date|Status|Wrong seller|Vaughan/.test(filter));
    return Response.json({value:filter.includes("'EXAMPLE'")?[mls]:[]});
  });
  const raw=await resolveSellerSubject(address,{city:'Vaughan'}, {AMPRE_TOKEN:'fixture-only'},{});
  assert.equal(raw.ListingKey,mls.ListingKey);assert.equal(raw._sellerHistory[0].recordedAt,'2021-01-12T00:00:00.000Z');
  assert(queries.some(q=>q.includes("'Example'")));assert(queries.some(q=>q.includes("'EXAMPLE'")));
  assert.equal(raw._sellerFactSources.KitchensTotal,mls.ListingKey);
});

test('compound street names preserve exact condo unit; incomplete history stays flagged',async t=>{
  const condo={...mls,ListingKey:'C00000011',StreetNumber:'88',StreetName:'The Esplanade',StreetSuffix:'N/A',UnitNumber:'4102',UnparsedAddress:'88 The Esplanade N/A 4102, Toronto',PropertySubType:'Condo Apartment',LivingAreaRange:'700-799'};
  const filters=[];
  t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);if(u.pathname.includes("Property('"))return Response.json(condo);filters.push(u.searchParams.get('$filter')||'');return Response.json({value:[{...condo,ListingKey:'C00000012',UnitNumber:'4103'},condo]});});
  const raw=await resolveSellerSubject('88 The Esplanade Unit 4102, Toronto',{}, {AMPRE_TOKEN:'fixture-only'},{});
  assert.equal(raw.ListingKey,condo.ListingKey);assert.equal(raw.UnitNumber,'4102');assert(filters.every(f=>!f.includes("StreetName,'The'")));
  t.mock.restoreAll();
  let n=0;
  t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);if(u.pathname.includes("Property('"))return Response.json(mls);if((u.searchParams.get('$filter')||'').includes("'EXAMPLE'"))return Response.json({value:[]});return Response.json({value:[mls],'@odata.nextLink':`https://query.ampre.ca/odata/Property?$skiptoken=${++n}`});});
  const partial=await resolveSellerSubject(address,{}, {AMPRE_TOKEN:'fixture-only'},{});assert.equal(partial._sellerHistoryComplete,false);
});

test('private reviewed MLS archives require provenance and exclude historic prices and owner fields',()=>{
  const ref='urn:thm:mls-document:file_'+ 'a'.repeat(32);
  const row={id:'synthetic',source_url:ref,source_label:'Synthetic reviewed MLS document',source_date:'2021-01-12',verified_at:'2026-09-25',facts:{...mls,ClosePrice:1234567,ListPrice:7777777,OwnerNotes:'DO_NOT_USE',_provenance:{kind:'reviewed_mls',listingKey:mls.ListingKey}}};
  const archived=validatedArchive(row,parsed,'Toronto',()=>true);
  assert.equal(archived.ListingKey,mls.ListingKey);assert.equal(archived._sellerArchive.sourceUrl,null);assert.equal(archived._sellerArchive.sourceKind,'reviewed_mls_document');
  for(const field of ['ClosePrice','ListPrice','OwnerNotes','LivingAreaRange'])assert.equal(archived[field],undefined);
  assert.equal(archived.KitchensTotal,1);assert.deepEqual(archived.ArchitecturalStyle,['Bungalow-Raised']);
  assert.equal(archived.StandardStatus,'Unknown');assert.equal(archived._sellerHistoryComplete,false);
  assert.equal(validatedArchive({...row,facts:{...mls}},parsed,'Toronto',()=>true),null);
  assert.equal(validatedArchive({...row,source_url:'javascript:bad'},parsed,'Toronto',()=>true),null);
  assert.equal(validatedArchive(row,parsed,'Toronto',()=>false),null);
});

test('Seller capture retains questionnaire for the team without changing address identity or Buyer capture',async t=>{
  let captured;
  t.mock.method(globalThis,'fetch',async (url,init)=>{assert(String(url).includes('/rpc/create_phase5_request'));captured=JSON.parse(init.body).p_request;return Response.json({lead_id:'11111111-2222-4333-8444-555555555555',report_queued:false});});
  const input={name:'Synthetic QA',mobile:'4165550110',email:'fixture@example.invalid',lead_mode:'seller',property_input:address,resolved_address:address,seller_profile:{...profile,city:'Vaughan',homeType:'Condo Apartment',sizeBand:'700-799'},request_key:'11111111-2222-4333-8444-555555555555'};
  const r=await createBuyerRequest(new Request('https://thm.test/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),{SUPABASE_SERVICE_ROLE_KEY:'mock-only'}, {waitUntil(){throw Error('Must not schedule jobs');}});
  assert.equal(r.status,201);assert.equal(captured.property_input,address);
  assert.equal(captured.property_snapshot.sellerProfile.community,profile.community);assert.equal(captured.property_snapshot.sellerProfile.kitchens,4);assert.equal(captured.property_snapshot.sellerProfile.renovationPct,100);assert.equal(captured.property_snapshot.sellerProfile.notes,profile.notes);assert.equal(captured.property_snapshot.sellerProfile.city,'Vaughan');
  assert.equal(captured.showing_requested,false);
});

test('full Seller loader derives identical historical facts and comparisons for different saved questionnaires',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-26T05:00:00Z')});
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);
    if(u.pathname.includes("Property('"))return Response.json(mls);
    if(u.searchParams.get('$count')==='true')return Response.json({'@odata.count':4,value:[]});
    return Response.json({value:[mls,sold(2),sold(3),sold(4)]});
  });
  const a=await loadPropertyForReport({AMPRE_VOW_TOKEN:'mock-only'},lead(profile),'first');
  const b=await loadPropertyForReport({AMPRE_VOW_TOKEN:'mock-only'},lead({...profile,community:address,city:'Vaughan',homeType:'Condo Apartment',sizeBand:'700-799',beds:1,kitchens:9,notes:'CHANGED',renovationPct:0}),'second');
  assert.deepEqual(a,b);assert.equal(a.cityRegion,mls.CityRegion);assert.equal(a.beds,3);assert.equal(a.kitchens,1);assert.equal(a.livingAreaRange,null);
  assert.equal(a.sellerEvidence.sellerAnswersUsed,false);assert.equal(a.comparableContext.available,true);
  assert.equal(a.comparableContext.comparables.length,3);
});
