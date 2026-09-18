import test from 'node:test';
import assert from 'node:assert/strict';
import {basicSearch,homeSearch} from '../discovery-search.js';
import {resolveSellerSubject,discoverySelection} from '../worker-v11.js';
import {reportFetch} from '../report-runtime.js';
const originalFetch=globalThis.fetch;
const json=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
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
