import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sellerQueryRows,sellerActiveComparisons,sellerAddressCheck,buildSellerEvidence,calculateSellerEvidence,sellerLocalTrend,sellerSale,validateSellerProfile,resolveSellerSubject,estimateSellerUpgrades,createBuyerRequest,loadPropertyForReport,buildPropertyReport,sellerComparableGeography,sellerSameHome,qualifiedSoldComparableRows,buildSellerReport,buildEmail} from '../worker-v11.js';
const profileInput={homeType:'Detached',city:'Toronto',community:'Example Community',sizeBand:'1500-2000',beds:3,belowBeds:1,basement:'finished',entrance:'yes',kitchens:2,postal:'M6E1A1',condition:'maintained',upgrades:[{id:'kitchen',recency:'0_2',documents:true}],targetPrice:1200000,timing:'3_6',notes:'Owner-provided details <script>never execute</script>',ownerConsent:true,contactConsent:true};
const subject={ListingKey:'C00000001',UnparsedAddress:'101 Example Street, Toronto',StreetNumber:'101',StreetName:'Example',StreetSuffix:'Street',City:'Toronto',CityRegion:'Example Community',PropertySubType:'Detached',LivingAreaRange:'1500-2000',BedroomsTotal:3,PostalCode:'M6E1A1',_sellerReport:true};
const sold=(n,overrides={})=>({...subject,ListingKey:`C0000000${n}`,StreetNumber:String(101+n),UnparsedAddress:`${101+n} Example Street, Toronto`,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:1050000+n*10000,PurchaseContractDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10),...overrides});
const property=(profile,extra={})=>({address:'101 Example Street, Toronto · Demonstration only',propertySubType:profile.homeType,cityRegion:profile.community,city:profile.city,livingAreaRange:profile.sizeBand,sellerProfile:profile,sellerEvidence:{listingMatched:true,listingFactsAgree:true},comparableContext:{available:true,confidence:'Medium',rangeLow:1020000,midpoint:1060000,rangeHigh:1100000,policy:{windowDays:100},comparables:[2,3,4].map(n=>({address:`${101+n} Example Street · Demo`,propertySubType:profile.homeType,cityRegion:profile.community,livingAreaRange:profile.sizeBand,beds:3,soldPrice:1030000+n*10000,soldDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10)}))},...extra});

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
  for(const rate of [.08,-.08,0]){
    const pairs=Array.from({length:5},(_,i)=>[sold(i+20,{ClosePrice:1000000*Math.exp(rate),PublicRemarks:'Well maintained family home.',PurchaseContractDate:new Date(Date.now()-60*86400000).toISOString()}),sold(i+20,{ListingKey:'OLD'+i,ClosePrice:1000000,PublicRemarks:'Well maintained family home.',PurchaseContractDate:new Date(Date.now()-425*86400000).toISOString()})]).flat();
    const trend=sellerLocalTrend(pairs.map(sellerSale));assert.equal(trend.available,true);assert(Math.abs(trend.annualLogRate-rate)<.0001);
    const withHistory=calculateSellerEvidence(subject,pairs.concat(sold(88,{PurchaseContractDate:new Date(Date.now()-500*86400000).toISOString()})));
    assert.equal(withHistory.policy.windowDays,1095);assert(withHistory.comparables.some(c=>c.ageDays>365));
  }
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
  const recovered=await resolveSellerSubject(a.UnparsedAddress,{city:''},{AMPRE_TOKEN:'fixture-only'});
  assert.equal(recovered.UnitNumber,'401');assert.equal(recovered.LivingAreaRange,'600-699');assert.equal(recovered._sellerHistory.length,2);assert.equal(recovered._sellerFactSources.LivingAreaRange,'N_HISTORY_OLD');
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
    if(filter.includes("'Unavailable'"))return Response.json({value:[b,{...b,ListingKey:'N03',UnitNumber:'601',UnparsedAddress:'10 Example Avenue 601, Richmond Hill'}],'@odata.nextLink':"https://query.ampre.ca/odata/Property?$skiptoken=next"});
    if(filter.includes("'Available'"))return Response.json({value:[{...b,ListingKey:'N06',UnitNumber:'801',UnparsedAddress:'10 Example Avenue 801, Richmond Hill',StandardStatus:'Active',ContractStatus:'Available',ClosePrice:null,ListPrice:710000}]});
    return Response.json({value:[]});
  });
  const fetched=await buildSellerEvidence(a,{AMPRE_TOKEN:'fixture-only'});
  assert.equal(fetched.available,true);assert.equal(fetched.comparables.length,3);assert.equal(fetched.activeComparables.length,1);assert(lookups.some(u=>u.searchParams.has('$skiptoken')));
  assert.equal(fetched.policy.activeAsksUsedForValuation,false);
  const profile=validateSellerProfile({...profileInput,homeType:'Condo Apartment',city:'Richmond Hill',sizeBand:'600-699',beds:1,community:'Example North',targetPrice:null,upgrades:[]});
  const report=await buildSellerReport({}, {},property(profile,{comparableContext:{available:false,basis:'Only one matching sale was found.',comparables:[{address:b.UnparsedAddress,soldPrice:630000,soldDate:b.PurchaseContractDate,livingAreaRange:'600-699'}]}}));
  assert.equal(report.valuation.available,false);assert.equal(report.seller.target_position.label,'Open to guidance');
  const email=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:a.UnparsedAddress,property_reports:[{report_payload:report}]});
  assert.match(email.html,/Only one matching sale/);assert.doesNotMatch(email.html,/Green: market window/);
});

test('seller scenario 3: unlisted home address verification and honest missing-evidence handling',async t=>{
  const profile=validateSellerProfile({...profileInput,homeType:'unknown',beds:null,condition:'unknown',city:'',community:'',sizeBand:'unknown',targetPrice:900000,upgrades:[],notes:''});
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);assert.equal(u.hostname,'nominatim.openstreetmap.org');
    return Response.json([{lat:'43.8',lon:'-79.5',address:{house_number:'33',road:'Example Court',city:'Vaughan'}}]);
  });
  const verified=await (await sellerAddressCheck(new Request('https://torontohousemarket.com/api/seller/address?q=33%20Example%20Court%20Vaughan'),{})).json();
  assert.equal(verified.verified,true);assert.equal(verified.city,'Vaughan');
  const wrong=await (await sellerAddressCheck(new Request('https://torontohousemarket.com/api/seller/address?q=34%20Example%20Court%20Vaughan'),{})).json();
  assert.equal(wrong.verified,false);
  t.mock.restoreAll();
  const lead={lead_mode:'seller',resolved_address:'33 Example Court, Vaughan',property_snapshot:{sellerProfile:profile}};
  const p=await loadPropertyForReport({},lead);
  assert.equal(p.comparableContext.available,false);assert.equal(p.sellerEvidence.listingMatched,false);
  const report=await buildPropertyReport({},lead,p);
  assert.equal(report.report_type,'THM Seller Price Perspective');assert.equal(report.valuation.available,false);assert.equal(report.valuation.low,null);assert.equal(report.seller.upgrade_estimates.available,false);assert.equal(report.seller.target_position.label,'Target saved');
  assert.match(report.valuation.basis,/interior size/);assert(report.valuation.missingFacts.includes('home type'));
  const email=buildEmail({job_type:'email_buyer'},{...lead,property_reports:[{report_payload:report}]});
  assert.match(email.html,/One more detail before we estimate/);assert.match(email.html,/\$900,000/);assert.doesNotMatch(email.html,/Needs review|AI value · based on sold homes|appraisal value|low estimate|high estimate|Invalid Date|undefined/);
});
