import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sellerQueryRows,sellerActiveComparisons,buildSellerEvidence,calculateSellerEvidence,sellerLocalTrend,sellerSale,validateSellerProfile,resolveSellerSubject,estimateSellerUpgrades,createBuyerRequest,loadPropertyForReport,buildPropertyReport,sellerComparableGeography,sellerSameHome,qualifiedSoldComparableRows,buildSellerReport,buildEmail} from '../worker-v11.js';
const profileInput={homeType:'Detached',city:'Toronto',community:'Example Community',sizeBand:'1500-2000',beds:3,belowBeds:1,basement:'finished',entrance:'yes',kitchens:2,postal:'M6E1A1',condition:'maintained',upgrades:[{id:'kitchen',recency:'0_2',documents:true}],targetPrice:1200000,timing:'3_6',notes:'Owner-provided details <script>never execute</script>',ownerConsent:true,contactConsent:true};
const subject={ListingKey:'C00000001',UnparsedAddress:'101 Example Street, Toronto',StreetNumber:'101',StreetName:'Example',StreetSuffix:'Street',City:'Toronto',CityRegion:'Example Community',PropertySubType:'Detached',LivingAreaRange:'1500-2000',BedroomsTotal:3,PostalCode:'M6E1A1',_sellerReport:true};
const sold=(n,overrides={})=>({...subject,ListingKey:`C0000000${n}`,StreetNumber:String(101+n),UnparsedAddress:`${101+n} Example Street, Toronto`,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:1050000+n*10000,PurchaseContractDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10),...overrides});
const property=(profile,extra={})=>({address:'101 Example Street, Toronto · Demonstration only',propertySubType:profile.homeType,cityRegion:profile.community,city:profile.city,livingAreaRange:profile.sizeBand,sellerProfile:profile,sellerEvidence:{listingMatched:true,listingFactsAgree:true},comparableContext:{available:true,confidence:'Medium',rangeLow:1020000,midpoint:1060000,rangeHigh:1100000,policy:{windowDays:100},comparables:[2,3,4].map(n=>({address:`${101+n} Example Street · Demo`,propertySubType:profile.homeType,cityRegion:profile.community,livingAreaRange:profile.sizeBand,beds:3,soldPrice:1030000+n*10000,soldDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10)}))},...extra});

test('seller identities exclude the subject and deduplicate differently formatted MLS addresses',()=>{
  const pastSubject=sold(9,{UnparsedAddress:'101 Example St Toronto W05 ON M6E 1A1',StreetNumber:'101'});
  assert.equal(sellerSameHome(subject,pastSubject),true);
  const first=sold(2),duplicate={...first,ListingKey:'FORMATTED-RELIST',UnparsedAddress:'103 Example St Toronto W05 ON M6E 1A1'};
  const evidence=calculateSellerEvidence(subject,[pastSubject,first,duplicate,sold(3)]);
  assert.equal(evidence.available,false,'The subject and a relisting must not manufacture a third sold home.');
  assert.equal(evidence.policy.distinctHomes,2);
  assert.equal(evidence.comparables.length,2);
  assert.equal(sellerSameHome(subject,{...pastSubject,StreetDirSuffix:'West'}),false);
});

test('seller condo identities preserve exact units and street directions across address formats',()=>{
  const a={...subject,UnparsedAddress:'185 Oneida Cres Unit 816, Richmond Hill',StreetNumber:'185',StreetName:'Oneida',StreetSuffix:'Crescent',City:'Richmond Hill',CityRegion:'Langstaff',PropertySubType:'Condo Apartment',PropertyType:'Residential Condo & Other',LivingAreaRange:'600-699',UnitNumber:'816',PostalCode:'L4B4L3'};
  const same={...a,ListingKey:'CONDO-HISTORY',UnparsedAddress:'185 Oneida Crescent 816 Richmond Hill ON L4B 4L3',UnitNumber:undefined};
  assert.equal(sellerSameHome(a,same),true);
  assert.equal(sellerSameHome(a,{...same,UnitNumber:'817'}),false,'Structured units must keep separate condos separate.');
  assert.equal(sellerSameHome(a,{...same,UnparsedAddress:'185 Oneida Cres 817 Richmond Hill ON L4B 4L3'}),false,'A parsed unit is required when UnitNumber is absent.');
  const west={...a,UnparsedAddress:'30 Harding Blvd W 417, Richmond Hill',StreetNumber:'30',StreetName:'Harding',StreetSuffix:'Boulevard',StreetDirSuffix:'W',UnitNumber:'417'};
  assert.equal(sellerSameHome(west,{...west,StreetDirSuffix:'West',UnparsedAddress:'30 Harding Boulevard West Unit 417 Richmond Hill ON L4B 4L3'}),true);
  assert.equal(sellerSameHome(west,{...west,StreetDirSuffix:'E',UnparsedAddress:'30 Harding Boulevard East 417 Richmond Hill ON L4B 4L3'}),false);
  const soldCondo=(unit,key,address)=>({...a,ListingKey:key,UnitNumber:unit,UnparsedAddress:address,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:650000,PurchaseContractDate:new Date(Date.now()-30*86400000).toISOString().slice(0,10)});
  const r=calculateSellerEvidence(a,[soldCondo('817','CONDO-817','185 Oneida Cres 817, Richmond Hill'),soldCondo('818','CONDO-818','185 Oneida Crescent 818 Richmond Hill ON L4B 4L3'),soldCondo('819','CONDO-819','185 Oneida Cres Unit 819, Richmond Hill')]);
  assert.equal(r.available,true);
  assert.equal(r.policy.distinctHomes,3,'Separate units in one building remain independent comparable homes.');
});

test('recent same-building condo sales take priority without using asking prices',()=>{
  const home={...subject,UnparsedAddress:'185 Example Cres Unit 816, Toronto',StreetNumber:'185',StreetName:'Example',StreetSuffix:'Crescent',UnitNumber:'816',PropertySubType:'Condo Apartment',PropertyType:'Residential Condo & Other',LivingAreaRange:'800-899',BedroomsAboveGrade:2,PostalCode:'M6E1A1'};
  const unit=(n,building,price,age=30)=>({...home,ListingKey:`UNIT-${building}-${n}`,StreetNumber:String(building),UnitNumber:String(n),UnparsedAddress:`${building} Example Cres Unit ${n}, Toronto`,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:price,PurchaseContractDate:new Date(Date.now()-age*86400000).toISOString(),BedroomsTotal:3});
  const own=[unit(817,185,550000),unit(818,185,560000),unit(819,185,570000)];
  const other=[unit(1,195,750000,5),unit(2,195,760000,6),unit(3,195,770000,7)];
  const result=calculateSellerEvidence(home,[...own,...other]);
  assert.equal(result.policy.sameBuildingOnly,true);
  assert.equal(result.midpoint,560000);
  assert.equal(result.comparables.length,3);
  assert(result.comparables.every(c=>c.beds===2),'Seller sales show above-grade bedrooms consistently with the subject.');
  const sparse=calculateSellerEvidence(home,[own[0],...other]);
  assert.equal(sparse.policy.sameBuildingOnly,false);
  assert.equal(sparse.comparables.length,4);
  const active=[unit(820,185,600000,20),unit(4,195,400000,1)].map(r=>({...r,StandardStatus:'Active',ContractStatus:'Available',ListPrice:r.ClosePrice,OriginalEntryTimestamp:r.PurchaseContractDate}));
  assert.equal(sellerActiveComparisons(home,active)[0].askingPrice,600000);
  assert.deepEqual(calculateSellerEvidence(home,[...own,...other,...active]),result);
});

test('a completed empty case variant cannot hide incomplete seller MLS history',async t=>{
  const history={...subject,OriginalEntryTimestamp:'2025-01-01T00:00:00Z'};
  let pages=0,fullRecordReads=0;
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);
    if(decodeURIComponent(u.pathname).includes("('")){fullRecordReads++;return Response.json(history);}
    if((u.searchParams.get('$filter')||'').includes("'EXAMPLE'"))return Response.json({value:[]});
    pages++;
    return Response.json({value:[{...history,ListingKey:`HISTORY-${pages}`}],'@odata.nextLink':`https://query.ampre.ca/odata/Property?$skiptoken=history-${pages}`});
  });
  const diagnostics={};
  await assert.rejects(()=>resolveSellerSubject(subject.UnparsedAddress,{city:'Toronto'},{AMPRE_TOKEN:'fixture-only'},diagnostics),/history search is incomplete; retry required/);
  assert.equal(pages,20);
  assert.equal(fullRecordReads,0,'Do not accept a latest record from a partially scanned variant.');
  assert.deepEqual(diagnostics.queries.map(q=>q.complete),[false,true]);
});

test('seller scenario 1: detached evidence, independent target, atomic request capture and seller email',async t=>{
  const profile=validateSellerProfile({...profileInput,targetMin:1150000,targetMax:1250000,upgrades:[{id:'kitchen',recency:'within_10',documents:false},{id:'bathrooms',recency:'within_10',documents:false}]});
  assert.throws(()=>validateSellerProfile({...profileInput,targetMin:1200000,targetMax:1000000}));
  assert.throws(()=>validateSellerProfile({...profileInput,targetMin:1200000}));
  assert.throws(()=>validateSellerProfile({...profileInput,ownerConsent:false}));
  assert.throws(()=>validateSellerProfile({...profileInput,targetPrice:'1000000'}));
  assert.throws(()=>validateSellerProfile({...profileInput,upgrades:[{id:'__proto__',recency:'0_2',documents:true}]}));
  const rows=qualifiedSoldComparableRows(subject,[sold(2),sold(3),sold(4),sold(5,{CityRegion:'Another Community'}),sold(6,{LivingAreaRange:'2000-2500'}),sold(7,{City:'Vaughan'}),sold(8,{TransactionType:'For Lease'}),sold(9,{UnparsedAddress:subject.UnparsedAddress,StreetNumber:subject.StreetNumber})],300);
  assert.equal(rows.length,3);assert(sellerSameHome(subject,sold(9,{UnparsedAddress:subject.UnparsedAddress})));
  const marketRows=[sold(2,{ClosePrice:800000}),sold(3,{ClosePrice:1100000}),sold(4,{ClosePrice:1450000}),sold(5,{City:'Vaughan'}),sold(6,{TransactionType:'For Lease'}),sold(7,{LivingAreaRange:'3500-5000'})];
  const market=calculateSellerEvidence(subject,marketRows);
  assert.equal(market.available,true);assert.equal(market.comparables.length,3);assert.equal(market.midpoint,1100000);
  assert(market.rangeLow<market.midpoint&&market.rangeHigh>market.midpoint);
  assert.deepEqual(market,calculateSellerEvidence({...subject,ListPrice:99999999,targetMin:9000000},marketRows));
  assert.equal(calculateSellerEvidence(subject,[...marketRows,sold(99,{UnparsedAddress:marketRows[0].UnparsedAddress,StreetNumber:marketRows[0].StreetNumber})]).comparables.length,3);
  assert.equal(sellerSale(sold(10,{PurchaseContractDate:null,ModificationTimestamp:new Date().toISOString()})),null);
  const old=sold(88,{PurchaseContractDate:new Date(Date.now()-400*86400000).toISOString(),ClosePrice:9900000});
  assert.equal(sellerSale(old),null);
  assert.deepEqual(market,calculateSellerEvidence(subject,[...marketRows,old]));
  assert.equal(market.policy.windowDays,100);
  const sparse=calculateSellerEvidence(subject,[sold(2),sold(3),sold(4,{PurchaseContractDate:new Date(Date.now()-358*86400000).toISOString()})]);
  assert.equal(sparse.available,true);assert.equal(sparse.policy.windowDays,365);assert.equal(sparse.confidence,'Low');
  assert.equal(calculateSellerEvidence(subject,[sold(2),sold(3),old]).available,false);
  const partialReport=await buildSellerReport({}, {},property(profile,{comparableContext:{...sparse,policy:{...sparse.policy,retrievalCapped:true}}}));
  const partialEmail=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:partialReport.facts.address,property_reports:[{report_payload:partialReport}]});
  assert.match(partialEmail.html,/up to 365 days/);assert.match(partialEmail.html,/did not cover every matching market record/);assert.match(partialEmail.text,/did not cover every matching market record/);
  const noSize=calculateSellerEvidence({...subject,LivingAreaRange:null,LotWidth:25},[sold(2,{LotWidth:24}),sold(3,{LotWidth:25}),sold(4,{LotWidth:26})]);
  assert.equal(noSize.available,true);assert.equal(noSize.policy.missingSizeFallback,true);assert.equal(noSize.confidence,'Low');
  const active=sellerActiveComparisons(subject,[sold(22,{StandardStatus:'Active',ContractStatus:'Available',ClosePrice:null,ListPrice:1400000}),sold(23,{StandardStatus:'Active',ContractStatus:'Available',TransactionType:'For Lease',ClosePrice:null,ListPrice:3000}),sold(24,{StandardStatus:'Active',ContractStatus:'Available',CityRegion:'Elsewhere',ListPrice:1000000})]);
  assert.equal(active.length,1);assert.equal(active[0].askingPrice,1400000);
  const report=await buildSellerReport({}, {},property(profile));
  const alternate=await buildSellerReport({}, {},property({...profile,targetPrice:5000000,upgrades:[]}));
  assert.deepEqual(report.valuation,alternate.valuation);assert.equal(report.seller.target_position.label,'Above the window');
  const email=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:report.facts.address,property_reports:[{report_payload:report}]});
  assert.doesNotMatch(email.html,/Your improvements|upgrade contribution|AI-assisted judgment estimate/i);assert.match(email.html,/Your current competition/);assert.match(email.html,/tel:\+16478904704/);assert.match(email.html,/\&lt;script\&gt;/);assert.doesNotMatch(email.html,/<script>|showing.html|Buyer Decision Report|cashback/);
  assert.match(email.text,/50,000 above/);
  assert.doesNotMatch(email.html,/triangle|Three views/);
  assert.equal(report.seller.target_range.low,1150000);
  assert.equal(report.seller.upgrades.length,0);assert.equal(report.seller.upgrade_estimates.items.length,0);
  writeFileSync(new URL('./fixtures/seller-report-example.html',import.meta.url),email.html);
  let captured;
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert(String(url).includes('/rpc/create_phase5_request'));captured=JSON.parse(options.body).p_request;return new Response(JSON.stringify({lead_id:'11111111-2222-4333-8444-555555555555',report_queued:true}),{status:200});});
  const input={name:'Seller Fixture',email:'seller@example.invalid',mobile:'6475550101',property_input:'101 Example Street, Toronto',lead_mode:'seller',seller_profile:profileInput,listing_key:'C_WRONG_KEY',property_snapshot:{listPrice:99999999},request_key:'11111111-2222-4333-8444-555555555555'};
  const request=()=>new Request('https://torontohousemarket.com/api/lead',{method:'POST',body:JSON.stringify(input)});
  const r=await createBuyerRequest(request(),{SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},{});
  assert.equal(r.status,201);assert.equal(captured.lead_mode,'seller');assert.equal(captured.listing_key,null);assert.equal(captured.showing_requested,false);assert.equal(captured.property_snapshot.sellerProfile.targetPrice,1200000);assert.equal(captured.property_snapshot.listPrice,undefined);
});

test('seller scenario 2: condo same-building exception preserves size and exact unit',async t=>{
  const a={...subject,PropertySubType:'Condo Apartment',PropertyType:'Residential Condo & Other',LivingAreaRange:'600-699',City:'Richmond Hill',CityRegion:'Example North',UnparsedAddress:'10 Example Avenue 401, Richmond Hill',StreetNumber:'10',StreetName:'Example',StreetSuffix:'Avenue',UnitNumber:'401',PostalCode:'L4B1A1'};
  const b={...a,ListingKey:'N00000002',UnitNumber:'501',UnparsedAddress:'10 Example Avenue 501, Richmond Hill',CityRegion:'Example South',StandardStatus:'Closed',ClosePrice:630000,TransactionType:'For Sale',PurchaseContractDate:new Date(Date.now()-40*86400000).toISOString().slice(0,10)};
  assert.equal(validateSellerProfile({...profileInput,homeType:'Condo Apartment',sizeBand:'1400-1599'}).sizeBand,'1400-1599');
  assert.throws(()=>validateSellerProfile({...profileInput,homeType:'Condo Apartment',sizeBand:'900-500'}));
  const historyRows=[{...a,ListingKey:'N_HISTORY_NEW',StandardStatus:'Expired',OriginalEntryTimestamp:new Date(Date.now()-365*86400000).toISOString(),ModificationTimestamp:new Date(Date.now()-350*86400000).toISOString(),LivingAreaRange:null},{...a,ListingKey:'N_HISTORY_OLD',StandardStatus:'Canceled',OriginalEntryTimestamp:new Date(Date.now()-700*86400000).toISOString(),ModificationTimestamp:new Date(Date.now()-690*86400000).toISOString()},b];
  t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url),decoded=decodeURIComponent(String(url));assert(!u.searchParams.has('$skip'));assert.equal(u.searchParams.get('$orderby')||'ModificationTimestamp desc,ListingKey desc','ModificationTimestamp desc,ListingKey desc');const full=historyRows.find(r=>decoded.includes(`('${r.ListingKey}')`));return new Response(JSON.stringify(full||(u.searchParams.get('$count')==='true'?{'@odata.count':historyRows.length,value:[]}:{value:historyRows})),{status:200});});
  // An archive older than ten years still supplies specifications.
  historyRows[1].OriginalEntryTimestamp='2010-01-01T00:00:00Z';
  historyRows[1].ModificationTimestamp=new Date().toISOString();
  const recovered=await resolveSellerSubject(a.UnparsedAddress,{city:''},{AMPRE_TOKEN:'fixture-only'});
  const withoutCommas=await resolveSellerSubject('10 Example Avenue Unit 401 Richmond Hill ON L4B 1A1',{city:''},{AMPRE_TOKEN:'fixture-only'});
  assert.equal(withoutCommas?.UnitNumber,'401');
  assert.equal(recovered.ListingKey,'N_HISTORY_NEW');assert.equal(recovered.UnitNumber,'401');assert.equal(recovered.LivingAreaRange,'600-699');assert.equal(recovered._sellerHistory.length,2);assert.equal(recovered._sellerFactSources.LivingAreaRange,'N_HISTORY_OLD');
  assert.equal(recovered._sellerStreetRecords.length,3,'Case variants reuse distinct street records, including other homes.');
  assert(sellerComparableGeography(a,b));assert(!sellerSameHome(a,b));
  assert.equal(qualifiedSoldComparableRows(a,[b],300).length,1);
  assert.equal(qualifiedSoldComparableRows(a,[{...b,LivingAreaRange:'700-799'}],300).length,0);
  assert(!sellerComparableGeography(a,{...b,PostalCode:'L4B2A2'}));
  const condoModel=calculateSellerEvidence(a,[b,{...b,ListingKey:'N03',UnitNumber:'601',UnparsedAddress:'10 Example Avenue 601, Richmond Hill'},{...b,ListingKey:'N04',UnitNumber:'701',UnparsedAddress:'10 Example Avenue 701, Richmond Hill'},{...b,ListingKey:'N05',UnitNumber:'801',UnparsedAddress:'10 Example Avenue 801, Richmond Hill',LivingAreaRange:'700-799'}]);
  assert.equal(condoModel.available,true);assert.equal(condoModel.comparables.length,3);assert.equal(condoModel.policy.condoExactSize,true);
  t.mock.restoreAll();
  const lookups=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);lookups.push(u);const filter=u.searchParams.get('$filter')||'';
    if(u.searchParams.has('$skip'))throw new Error('Oldest-tail query must not be used');
    if(u.searchParams.get('$skiptoken')==='next')return Response.json({value:[{...b,ListingKey:'N04',UnitNumber:'701',UnparsedAddress:'10 Example Avenue 701, Richmond Hill'}]});
    if(filter.includes('CityRegion'))return Response.json({value:[b,{...b,ListingKey:'N03',UnitNumber:'601',UnparsedAddress:'10 Example Avenue 601, Richmond Hill'},{...b,ListingKey:'N06',UnitNumber:'801',UnparsedAddress:'10 Example Avenue 801, Richmond Hill',StandardStatus:'Active',ContractStatus:'Available',ClosePrice:null,ListPrice:710000}],'@odata.nextLink':"https://query.ampre.ca/odata/Property?$skiptoken=next"});
    if(filter.includes("'Available'"))return Response.json({value:[{...b,ListingKey:'N06',UnitNumber:'801',UnparsedAddress:'10 Example Avenue 801, Richmond Hill',StandardStatus:'Active',ContractStatus:'Available',ClosePrice:null,ListPrice:710000}]});
    return Response.json({value:[]});
  });
  const fetched=await buildSellerEvidence(a,{AMPRE_TOKEN:'fixture-only'});
  assert.equal(fetched.available,true);assert.equal(fetched.comparables.length,3);assert.equal(fetched.activeComparables.length,1);assert(lookups.some(u=>u.searchParams.has('$skiptoken')));
  assert.equal(fetched.policy.activeAsksUsedForValuation,false);
  t.mock.restoreAll();
  const cachedRows=[b,{...b,ListingKey:'N03',UnitNumber:'601',UnparsedAddress:'10 Example Avenue 601, Richmond Hill'},{...b,ListingKey:'N04',UnitNumber:'701',UnparsedAddress:'10 Example Avenue 701, Richmond Hill'}];
  t.mock.method(globalThis,'fetch',async url=>{
    assert.match(new URL(url).searchParams.get('$filter'),/CityRegion/,'A completed street history must not be downloaded again.');
    return Response.json({value:[]});
  });
  const cached=await buildSellerEvidence({...a,_sellerStreetRecords:cachedRows,_sellerLookupAudit:[{status:200,complete:true}]},{AMPRE_TOKEN:'fixture-only'});
  assert.equal(cached.available,true);
  assert.equal(cached.policy.sameBuildingOnly,true);
  assert.equal(cached.policy.retrievalCapped,false);
  const profile=validateSellerProfile({...profileInput,homeType:'Condo Apartment',city:'Richmond Hill',sizeBand:'600-699',beds:1,community:'Example North',targetPrice:null,upgrades:[]});
  const report=await buildSellerReport({}, {},property(profile,{comparableContext:{available:false,basis:'Only one matching sale was found.',comparables:[{address:b.UnparsedAddress,soldPrice:630000,soldDate:b.PurchaseContractDate,livingAreaRange:'600-699'}]}}));
  assert.equal(report.valuation.available,false);assert.equal(report.seller.target_position.label,'Open to guidance');
  const email=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:a.UnparsedAddress,property_reports:[{report_payload:report}]});
  assert.match(email.html,/Only one matching sale/);assert.doesNotMatch(email.html,/Green: market window/);
});

test('seller scenario 3: unlisted home address verification and honest missing-evidence handling',async t=>{
  const profile=validateSellerProfile({...profileInput,homeType:'unknown',beds:null,condition:'unknown',city:'',community:'',sizeBand:'unknown',targetPrice:900000,upgrades:[],notes:''});
  const lead={lead_mode:'seller',resolved_address:'33 Example Court, Vaughan',property_snapshot:{sellerProfile:profile}};
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:403}));
  await assert.rejects(()=>sellerQueryRows(["contains(StreetName,'Example')"],{AMPRE_TOKEN:'fixture-only'}),/access was rejected/);
  t.mock.restoreAll();
  const p=await loadPropertyForReport({},lead);
  assert.equal(p.comparableContext.available,false);assert.equal(p.sellerEvidence.listingMatched,false);
  const report=await buildPropertyReport({},lead,p);
  assert.equal(report.report_type,'THM Seller Price Perspective');assert.equal(report.valuation.available,false);assert.equal(report.valuation.low,null);assert.equal(report.seller.upgrade_estimates.available,false);assert.equal(report.seller.target_position.label,'Target saved');
  assert.match(report.valuation.basis,/not configured/);assert(report.valuation.missingFacts.includes('home type'));
  const email=buildEmail({job_type:'email_buyer'},{...lead,property_reports:[{report_payload:report}]});
  assert.match(email.html,/We need to complete the data check/);assert.match(email.html,/\$900,000/);assert.doesNotMatch(email.html,/Needs review|AI value · based on sold homes|appraisal value|low estimate|high estimate|Invalid Date|undefined/);
});
