import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {validateSellerProfile,createBuyerRequest,loadPropertyForReport,buildPropertyReport,sellerComparableGeography,sellerSameHome,qualifiedSoldComparableRows,buildSellerReport,buildEmail} from '../worker-v11.js';
const profileInput={homeType:'Detached',city:'Toronto',community:'Example Community',sizeBand:'1500-2000',beds:3,belowBeds:1,basement:'finished',entrance:'yes',kitchens:2,postal:'M6E1A1',condition:'maintained',upgrades:[{id:'kitchen',recency:'0_2',documents:true}],targetPrice:1200000,timing:'3_6',notes:'Owner-provided details <script>never execute</script>',ownerConsent:true,contactConsent:true};
const subject={ListingKey:'C00000001',UnparsedAddress:'101 Example Street, Toronto',StreetNumber:'101',StreetName:'Example',StreetSuffix:'Street',City:'Toronto',CityRegion:'Example Community',PropertySubType:'Detached',LivingAreaRange:'1500-2000',BedroomsTotal:3,PostalCode:'M6E1A1',_sellerReport:true};
const sold=(n,overrides={})=>({...subject,ListingKey:`C0000000${n}`,StreetNumber:String(101+n),UnparsedAddress:`${101+n} Example Street, Toronto`,StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:1050000+n*10000,PurchaseContractDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10),...overrides});
const property=(profile,extra={})=>({address:'101 Example Street, Toronto · Demonstration only',propertySubType:profile.homeType,cityRegion:profile.community,city:profile.city,livingAreaRange:profile.sizeBand,sellerProfile:profile,sellerEvidence:{listingMatched:true,listingFactsAgree:true},comparableContext:{available:true,confidence:'Medium',rangeLow:1020000,midpoint:1060000,rangeHigh:1100000,policy:{windowDays:100},comparables:[2,3,4].map(n=>({address:`${101+n} Example Street · Demo`,propertySubType:profile.homeType,cityRegion:profile.community,livingAreaRange:profile.sizeBand,beds:3,soldPrice:1030000+n*10000,soldDate:new Date(Date.now()-35*86400000).toISOString().slice(0,10)}))},...extra});

test('seller scenario 1: detached evidence, independent target, atomic request capture and seller email',async t=>{
  const profile=validateSellerProfile(profileInput);
  assert.throws(()=>validateSellerProfile({...profileInput,ownerConsent:false}));
  assert.throws(()=>validateSellerProfile({...profileInput,targetPrice:'1000000'}));
  assert.throws(()=>validateSellerProfile({...profileInput,upgrades:[{id:'__proto__',recency:'0_2',documents:true}]}));
  const rows=qualifiedSoldComparableRows(subject,[sold(2),sold(3),sold(4),sold(5,{CityRegion:'Another Community'}),sold(6,{LivingAreaRange:'2000-2500'}),sold(7,{City:'Vaughan'}),sold(8,{TransactionType:'For Lease'}),sold(9,{UnparsedAddress:subject.UnparsedAddress,StreetNumber:subject.StreetNumber})],300);
  assert.equal(rows.length,3);assert(sellerSameHome(subject,sold(9,{UnparsedAddress:subject.UnparsedAddress})));
  const report=await buildSellerReport({}, {},property(profile));
  const alternate=await buildSellerReport({}, {},property({...profile,targetPrice:5000000,upgrades:[]}));
  assert.deepEqual(report.valuation,alternate.valuation);assert.equal(report.seller.target_position.label,'Above the window');
  const email=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:report.facts.address,property_reports:[{report_payload:report}]});
  assert.match(email.html,/YOUR|Your improvements/);assert.match(email.html,/tel:\+16478904704/);assert.match(email.html,/\&lt;script\&gt;/);assert.doesNotMatch(email.html,/<script>|showing.html|Buyer Decision Report|cashback/);
  assert.match(email.text,/100,000 above/);
  writeFileSync(new URL('./fixtures/seller-report-example.html',import.meta.url),email.html);
  let captured;
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert(String(url).includes('/rpc/create_phase5_request'));captured=JSON.parse(options.body).p_request;return new Response(JSON.stringify({lead_id:'11111111-2222-4333-8444-555555555555',report_queued:true}),{status:200});});
  const input={name:'Seller Fixture',email:'seller@example.invalid',mobile:'6475550101',property_input:'101 Example Street, Toronto',lead_mode:'seller',seller_profile:profileInput,listing_key:'C_WRONG_KEY',property_snapshot:{listPrice:99999999},request_key:'11111111-2222-4333-8444-555555555555'};
  const request=()=>new Request('https://torontohousemarket.com/api/lead',{method:'POST',body:JSON.stringify(input)});
  const r=await createBuyerRequest(request(),{SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},{});
  assert.equal(r.status,201);assert.equal(captured.lead_mode,'seller');assert.equal(captured.listing_key,null);assert.equal(captured.showing_requested,false);assert.equal(captured.property_snapshot.sellerProfile.targetPrice,1200000);assert.equal(captured.property_snapshot.listPrice,undefined);
});

test('seller scenario 2: condo same-building exception preserves size and exact unit',async()=>{
  const a={...subject,PropertySubType:'Condo Apartment',PropertyType:'Residential Condo & Other',LivingAreaRange:'600-699',City:'Richmond Hill',CityRegion:'Example North',UnparsedAddress:'10 Example Avenue 401, Richmond Hill',StreetNumber:'10',StreetName:'Example',StreetSuffix:'Avenue',UnitNumber:'401',PostalCode:'L4B1A1'};
  const b={...a,ListingKey:'N00000002',UnitNumber:'501',UnparsedAddress:'10 Example Avenue 501, Richmond Hill',CityRegion:'Example South',StandardStatus:'Closed',ClosePrice:630000,TransactionType:'For Sale',PurchaseContractDate:new Date(Date.now()-40*86400000).toISOString().slice(0,10)};
  assert.equal(validateSellerProfile({...profileInput,homeType:'Condo Apartment',sizeBand:'1400-1599'}).sizeBand,'1400-1599');
  assert.throws(()=>validateSellerProfile({...profileInput,homeType:'Condo Apartment',sizeBand:'900-500'}));
  assert(sellerComparableGeography(a,b));assert(!sellerSameHome(a,b));
  assert.equal(qualifiedSoldComparableRows(a,[b],300).length,1);
  assert.equal(qualifiedSoldComparableRows(a,[{...b,LivingAreaRange:'700-799'}],300).length,0);
  assert(!sellerComparableGeography(a,{...b,PostalCode:'L4B2A2'}));
  const profile=validateSellerProfile({...profileInput,homeType:'Condo Apartment',city:'Richmond Hill',sizeBand:'600-699',beds:1,community:'Example North',targetPrice:null,upgrades:[]});
  const report=await buildSellerReport({}, {},property(profile,{comparableContext:{available:false,basis:'Only one matching sale was found.',comparables:[{address:b.UnparsedAddress,soldPrice:630000,soldDate:b.PurchaseContractDate,livingAreaRange:'600-699'}]}}));
  assert.equal(report.valuation.available,false);assert.equal(report.seller.target_position.label,'Open to guidance');
  const email=buildEmail({job_type:'email_buyer'},{lead_mode:'seller',resolved_address:a.UnparsedAddress,property_reports:[{report_payload:report}]});
  assert.match(email.html,/Only one matching sale/);assert.doesNotMatch(email.html,/Green: market window/);
});

test('seller scenario 3: unlisted home with uncertain size/community still produces an honest review',async()=>{
  const profile=validateSellerProfile({...profileInput,city:'Vaughan',community:'',sizeBand:'unknown',targetPrice:900000,upgrades:[],notes:''});
  const lead={lead_mode:'seller',resolved_address:'33 Example Court, Vaughan',property_snapshot:{sellerProfile:profile}};
  const p=await loadPropertyForReport({},lead);
  assert.equal(p.comparableContext.available,false);assert.equal(p.sellerEvidence.listingMatched,false);
  const report=await buildPropertyReport({},lead,p);
  assert.equal(report.report_type,'THM Seller Price Perspective');assert.equal(report.valuation.available,false);assert.equal(report.valuation.low,null);assert.equal(report.seller.target_position.label,'Target saved');
  assert.match(report.valuation.basis,/Confirm the interior size/);
  const email=buildEmail({job_type:'email_buyer'},{...lead,property_reports:[{report_payload:report}]});
  assert.match(email.html,/A closer review is needed/);assert.match(email.html,/\$900,000/);assert.doesNotMatch(email.html,/appraisal value|low estimate|high estimate|Invalid Date|undefined/);
});
