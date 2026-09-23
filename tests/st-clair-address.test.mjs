import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker,{validateAddressEntry,resolveSellerSubject,sellerReportEmail} from '../worker-v11.js';
const unit={ListingKey:'FIXTURE-1227',StreetNumber:'111',StreetName:'St Clair',StreetSuffix:'Avenue',StreetDirSuffix:'W',UnitNumber:'1227',City:'Toronto C02',PropertySubType:'Condo Apartment',UnparsedAddress:'111 St Clair Avenue W Unit 1227, Toronto',OriginalEntryTimestamp:'2026-08-01T00:00:00Z'};
test('Google Saint Clair and punctuation variants identify only the exact unit',async t=>{
 const wrong=[{...unit,ListingKey:'OTHER-UNIT',UnitNumber:'1228'},{...unit,ListingKey:'OTHER-DIRECTION',StreetDirSuffix:'E'},{...unit,ListingKey:'OTHER-NUMBER',StreetNumber:'1110'},{...unit,ListingKey:'OTHER-CITY',City:'Vaughan'}];
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);if(u.pathname.includes("('FIXTURE-1227')"))return Response.json(unit);
  const filter=u.searchParams.get('$filter');assert.match(filter,/contains\(StreetName,'Clair'\)/);return Response.json({value:[...wrong,unit]});
 });
 for(const spelling of ['Saint Clair','St Clair','St. Clair','St.Clair']){
  const address=`1227-111 ${spelling} Avenue West, Toronto`;
  const v=validateAddressEntry(address);assert.equal(v.parsed.unit,'1227');assert.equal(v.parsed.name,'st clair');
  assert.equal((await resolveSellerSubject(address,{city:'Toronto'},{AMPRE_TOKEN:'fixture'}))?.ListingKey,unit.ListingKey);
 }
 assert.equal(validateAddressEntry('12 Saint George Street, Toronto').parsed.name,'saint george');
 assert.equal(validateAddressEntry('12 Main St, Toronto').parsed.name,'main');
});
test('unit prompt requires a confirmed public condo building, not an empty or failed lookup',async t=>{
 let rows=[unit],status=200;
 t.mock.method(globalThis,'fetch',async()=>Response.json({value:rows},{status}));
 const check=()=>worker.fetch(new Request('https://torontohousemarket.com/api/property?validate_only=1&q='+encodeURIComponent('111 Saint Clair Avenue West, Toronto')),{AMPRE_TOKEN:'fixture'},{});
 let r=await check();assert.equal(r.status,400);assert.equal((await r.json()).unitRequired,true);
 for(const candidate of [[],[{...unit,StreetDirSuffix:'E'}],[{...unit,PropertySubType:'Detached',UnitNumber:null}],[{...unit,InternetEntireListingDisplayYN:false}]]){rows=candidate;r=await check();assert.equal(r.status,200);}
 status=503;r=await check();assert.equal(r.status,200);
});
test('unit-specific failure is distinct from insufficient comparable evidence',()=>{
 const address='111 St Clair Avenue West Unit 1227, Toronto';
 const unmatched=sellerReportEmail(address,{valuation:{available:false},seller:{evidence:{subjectMatched:false}},comparables:[]});
 assert.match(unmatched.text,/couldn’t verify this unit’s listing history/);assert.doesNotMatch(unmatched.text,/not enough closely matching sales/);
 const matched=sellerReportEmail(address,{valuation:{available:false},seller:{evidence:{subjectMatched:true}},comparables:[]});assert.match(matched.text,/not enough closely matching sales/);
});
test('Google building selection retains an entered unit in every supported format',()=>{
 const context=vm.createContext({window:{}});vm.runInContext(readFileSync('address-input.js','utf8'),context);
 const {split,combine}=context.window.THMAddress;
 for(const entered of ['1227-111 St.Clair Avenue West, Toronto','111 St Clair Avenue West Unit 1227, Toronto','Unit 1227, 111 St Clair Avenue West, Toronto'])assert.equal(combine('111 Saint Clair Avenue West, Toronto',split(entered).unit),'111 Saint Clair Avenue West Unit 1227, Toronto');
});
