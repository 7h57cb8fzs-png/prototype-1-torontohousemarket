import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { priceCheckSelection, priceCheckRows } from '../worker-v11.js';
const home = (n, fields={}) => ({ ListingKey: `N100000${n}`, StreetNumber: String(n), StreetName: 'Test', StreetSuffix: 'Rd', UnparsedAddress: `${n} Test Rd, Vaughan`, City: 'Vaughan', CityRegion: 'Vellore Village', PostalCode: 'L4H 1A1', PropertySubType: 'Att/Row/Townhouse', LivingAreaRange: '1500-2000', BedroomsTotal: 3, BathroomsTotalInteger: 3, ParkingTotal: 2, ListPrice: 1000000, StandardStatus: 'Active', TransactionType: 'For Sale', ...fields });
const peers = [home(2), home(3), home(4)];
test('semi-detached feed spelling variants retain the same supported type', () => {
  for (const type of ['Semi-Detached ', 'semi-detached', 'Semi Detached', 'Semi–Detached', 'SemiDetached']) {
    const result = priceCheckSelection(home(1, {PropertySubType:type}), peers.map(p => ({...p,PropertySubType:'Semi-Detached'})));
    assert.equal(result.count, 3); assert.equal(result.available, true);
  }
});
test('parking differences remain visible as related homes, never as valuation evidence', () => {
  const result = priceCheckSelection(home(1, {ParkingTotal:10}), peers);
  assert.equal(result.count, 0); assert.equal(result.available, false); assert.equal(result.medianAsk, null);
  assert.equal(result.relatedMatches.length, 3);
  assert.match(result.relatedMatches[0].difference, /2 reported parking spaces.*10/);
});
test('price label is based on other matched asking prices, with explicit boundaries', () => {
  for (const [asking, signal] of [[900000,'below'],[950000,'inline'],[1000000,'inline'],[1050000,'inline'],[1100000,'above'],[500000,'review'],[1600000,'review']]) {
    const result = priceCheckSelection(home(1,{ ListPrice: asking }), peers);
    assert.equal(result.signal, signal); assert.equal(result.medianAsk, 1000000); assert.equal(result.count, 3);
  }
});
test('different types, neighbourhoods, cities, sizes, rooms, parking and nonpublic listings cannot earn a tick', () => {
  const mismatches = [
    {PropertySubType:'Condo Townhouse'}, {CityRegion:'Patterson'}, {City:'Toronto'},
    {LivingAreaRange:'2500-3000'}, {BedroomsTotal:4}, {BathroomsTotalInteger:6}, {ParkingTotal:0},
    {StandardStatus:'Sold',ClosePrice:888888}, {TransactionType:'For Lease'},
    {InternetEntireListingDisplayYN:false}, {InternetAddressDisplayYN:'No'}
  ];
  for (const fields of mismatches) assert.equal(priceCheckSelection(home(1),[home(2),home(3),home(4,fields)]).available,false);
});
test('missing subject facts and open-ended sizes never turn into a numeric rating', () => {
  for (const fields of [{BedroomsTotal:null},{LivingAreaRange:'5000+'},{LivingAreaRange:null},{CityRegion:''},{ListPrice:null},{InternetAddressDisplayYN:false}]) {
    const result = priceCheckSelection(home(1,fields),peers);
    assert.equal(result.available,false); assert.equal(result.medianAsk,null); assert.equal(result.differencePct,null);
  }
});
test('duplicate property addresses and subject relistings cannot inflate evidence', () => {
  const result=priceCheckSelection(home(1),[home(2),home(3),home(4,{StreetNumber:'2'}),home(5,{StreetNumber:'1'})]);
  assert.equal(result.count,2); assert.equal(result.available,false); assert.match(result.reason,/2 matching active/);
});
test('wide asking-price dispersion produces a reason instead of a misleading green tick', () => {
  const result=priceCheckSelection(home(1,{ListPrice:700000}),[home(2,{ListPrice:700000}),home(3),home(4,{ListPrice:1700000})]);
  assert.equal(result.available,false); assert.equal(result.medianAsk,null); assert.match(result.reason,/widely different/);
});
test('comparison response contains current public evidence only', () => {
  const result=priceCheckSelection(home(1),peers.map(r=>({...r,ClosePrice:888888,PrivateRemarks:'SECRET',ListAgentEmail:'private@example.com',Latitude:43.5})));
  for(const forbidden of ['888888','SECRET','private@example.com','Latitude']) assert.ok(!JSON.stringify(result).includes(forbidden));
});
test('price endpoint validates input and configuration before using an API', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not fetch');});
  assert.equal((await worker.fetch(new Request('https://example.com/api/price-check?listingKey=BAD'),{},{})).status,400);
  assert.equal((await worker.fetch(new Request('https://example.com/api/price-check?listingKey=N1000001'),{},{})).status,503);
});
test('live retrieval follows licensed next links, uses IDX only and distinguishes provider failure from no matches', async t => {
  let fail=false;
  t.mock.method(globalThis,'fetch',async (input,init)=>{
    const url=new URL(input); assert.equal(init.headers.Authorization,'Bearer idx-fixture');
    if(fail)return new Response('unavailable',{status:500});
    if(url.pathname.endsWith("('N1000001')"))return Response.json(home(1));
    if(url.searchParams.has('$count'))return Response.json({'@odata.count':3,value:[home(2)]});
    if(url.searchParams.has('$skip'))return Response.json({value:[home(3),home(4)]});
    return Response.json({value:[home(2)],'@odata.nextLink':'https://query.ampre.ca/odata/Property?$skip=100'});
  });
  const request=new Request('https://example.com/api/price-check?listingKey=N1000001');
  const env={PUBLIC_DISCOVERY_ENABLED:'true',AMPRE_TOKEN:'idx-fixture',AMPRE_VOW_TOKEN:'NEVER'};
  const r=await worker.fetch(request,env,{}); assert.equal(r.status,200); assert.equal((await r.json()).count,3);
  fail=true;
  const f=await worker.fetch(request,env,{}); assert.equal(f.status,502); assert.equal((await f.json()).count,undefined);
});
test('foreign pagination is rejected before a credential can leave AMPRE', async t => {
  t.mock.method(globalThis,'fetch',async input=>{
    const u=new URL(input); assert.equal(u.hostname,'query.ampre.ca');
    return Response.json(u.searchParams.has('$count')?{'@odata.count':2,value:[]}:{value:[home(2)],'@odata.nextLink':'https://example.org/steal'});
  });
  await assert.rejects(priceCheckRows(home(1),{AMPRE_TOKEN:'idx-fixture'}),/Invalid pagination/);
});

test('a zero neighbourhood count retries postal retrieval while retaining exact locality', async t => {
  const filters=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const u=new URL(input); filters.push(u.searchParams.get('$filter'));
    if(u.searchParams.has('$count')) return Response.json({'@odata.count':u.searchParams.get('$filter').startsWith('contains')?0:4,value:[]});
    return Response.json({value:[...peers,home(5,{CityRegion:'Patterson'})]});
  });
  const scan=await priceCheckRows(home(1),{AMPRE_TOKEN:'idx-fixture'});
  assert.ok(filters.some(f=>f.startsWith('startswith(PostalCode')));
  assert.equal(priceCheckSelection(home(1),scan.rows).count,3);
});

test('1+1 bedroom layouts cannot earn a tick by comparison with 2+0 layouts', () => {
  const subject=home(1,{BedroomsTotal:2,BedroomsAboveGrade:1,BedroomsBelowGrade:1});
  const same=peers.map(r=>({...r,BedroomsTotal:2,BedroomsAboveGrade:1,BedroomsBelowGrade:1}));
  const different=same.map(r=>({...r,BedroomsAboveGrade:2,BedroomsBelowGrade:0}));
  assert.equal(priceCheckSelection(subject,different).count,0);
  const result=priceCheckSelection(subject,same);
  assert.equal(result.count,3); assert.match(result.criteria,/1\+1 reported bedroom layout/);
  assert.equal(result.matches[0].bedroomLayout,'1+1');
});
