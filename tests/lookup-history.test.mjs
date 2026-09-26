import test from 'node:test';
import assert from 'node:assert/strict';
import {historyEvent,summarizePropertyHistory,reviewRecentSale,reviewSpecialUse} from '../property-history.js';
import {chooseLookupPlans,addressRecoveryPlans} from '../lookup-recovery.js';
import {soldCandidates,normalizeExpertResult,applyExpertRecovery} from '../worker-v12.js';
import {sellerHistoryMatches,sellerHistoryParsedAddress,isSoldWithinDays} from '../worker-v11.js';
import {finalizePayload} from '../worker-v22.js';
test('history counts MLS IDs once, excludes lease listings, never treats update time as sale date',()=>{
  const year=new Date().getUTCFullYear();
  const row={ListingKey:'C00000001',ListingContractDate:`${year}-01-01`,StandardStatus:'Closed',MlsStatus:'Terminated',ModificationTimestamp:`${year}-02-01`};
  const event=historyEvent(row);assert.equal(event.soldDate,null);
  const history=summarizePropertyHistory([event,event,historyEvent({...row,ListingKey:'C00000002',TransactionType:'For Lease'}),historyEvent({...row,ListingKey:'C00000003',MlsStatus:'Sold',PurchaseContractDate:`${year}-02-02`})]);
  assert.equal(history.counts.listed,2);assert.equal(history.counts.terminated,1);assert.equal(history.lastSold.year,year);assert.match(history.summary,/At least 2/);
});
test('Luna can only select supplied plans and exact unit validation remains mandatory',async t=>{
  const parsed=sellerHistoryParsedAddress('88 The Esplanade Unit 4102, Toronto'),plans=addressRecoveryPlans(parsed);
  t.mock.method(globalThis,'fetch',async()=>Response.json({output_text:JSON.stringify({ids:[plans[0].id,'invented',plans[0].id]})}));
  const result=await chooseLookupPlans({OPENAI_API_KEY:'synthetic'},'address',{parsed},plans);assert.equal(result.plans.length,1);
  assert.equal(sellerHistoryMatches(parsed,{StreetNumber:'88',StreetName:'The Esplanade',StreetSuffix:'N/A',UnitNumber:'4103',City:'Toronto'},'Toronto'),false);
});
test('recovery rejects undated, conditional, stale, other-city and duplicate-home sold evidence',()=>{
  const subject={address:'101 Example Avenue, Toronto',city:'Toronto',cityRegion:'Example',propertySubType:'Detached',propertyType:'Residential Freehold'};
  const date=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  const row={ListingKey:'C00000001',UnparsedAddress:'102 Example Avenue, Toronto',StreetNumber:'102',StreetName:'Example',StreetSuffix:'Avenue',City:'Toronto',CityRegion:'Example',PropertySubType:'Detached',PropertyType:'Residential Freehold',MlsStatus:'Sold',ClosePrice:1000000,PurchaseContractDate:date};
  const rows=[row,{...row,ListingKey:'C00000002'},{...row,ListingKey:'C00000003',StreetNumber:'103',UnparsedAddress:'103 Example Avenue, Toronto',PurchaseContractDate:null,ModificationTimestamp:date},{...row,ListingKey:'C00000004',MlsStatus:'Sold Conditional'},{...row,ListingKey:'C00000005',City:'Vaughan'},{...row,ListingKey:'C00000006',PurchaseContractDate:'2020-01-01'}];
  assert.equal(soldCandidates(subject,rows).length,1);
});
test('duplicate model choices cannot manufacture three sales; three unique indications have finite ranges',()=>{
  const candidates=[1,2,3].map(n=>({id:String(n),listingKey:'C0000000'+n,soldPrice:1000000+n*10000,address:`${n} Example` }));
  const one=normalizeExpertResult({comparables:[{id:'1'},{id:'1'},{id:'1'}]},candidates,'ampre_vow');
  const base={valuation:{available:false}};const partial=applyExpertRecovery(base,one);assert.equal(partial.valuation.available,false);assert.equal(partial.comparables.length,1);
  const three=normalizeExpertResult({comparables:candidates.map(c=>({id:c.id}))},candidates,'ampre_vow');
  const report=applyExpertRecovery(base,three);assert.equal(report.valuation.available,true);assert(Number.isFinite(report.valuation.low));assert(report.valuation.high>report.valuation.low);
});
test('buyer core cannot convert a modification timestamp or conditional status into a completed sale',()=>{
  const date=new Date(Date.now()-7*864e5).toISOString();
  const row={StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:1000000,ModificationTimestamp:date};
  assert.equal(isSoldWithinDays(row,365),false);
  assert.equal(isSoldWithinDays({...row,PurchaseContractDate:date,MlsStatus:'Sold Conditional'},365),false);
  assert.equal(isSoldWithinDays({...row,PurchaseContractDate:date,MlsStatus:'Sold'},365),true);
});
test('final presentation cannot invent a valuation from evidence-only rows or narrow existing uncertainty',async()=>{
  const comparables=[1,2,3].map(i=>({listingKey:'C0000000'+i,address:i+' Example Avenue, Toronto',propertySubType:'Detached',soldPrice:1000000+i*10000}));
  const base={facts:{property_type:'Detached'},comparables,valuation:{available:false,low:null,midpoint:null,high:null}};
  assert.equal((await finalizePayload(base,{})).valuation.available,false);
  const valid=await finalizePayload({...base,valuation:{available:true,low:800000,midpoint:1000000,high:1200000,confidence:'Low'}},{});
  assert(valid.valuation.low<=800000);assert(valid.valuation.high>=1200000);
});
test('a large gap from a recent subject sale flags review without using its price to recalculate value',()=>{
  const date=new Date(Date.now()-20*864e5).toISOString().slice(0,10);
  const report={valuation:{available:true,low:1100000,midpoint:1250000,high:1400000},property_history:{lastSold:{date,price:900000}}};
  const r=reviewRecentSale(report);assert.equal(r.valuation.midpoint,1250000);assert.equal(r.valuation.requiresReview,true);assert.equal(r.value_rating.available,false);assert.equal(r.review_flags[0].differencePct,39);
  assert.equal(reviewRecentSale({...report,property_history:{lastSold:{date:'2020-01-01',price:900000}}}).review_flags,undefined);
});
test('advertised development rights cannot become an ordinary residential valuation',async t=>{
  const base={facts:{property_type:'Detached'},comparables:[1,2,3].map(i=>({soldPrice:1000000+i*10000,propertySubType:'Detached'})),valuation:{available:true,low:1000000,midpoint:1100000,high:1200000}};
  const r=reviewSpecialUse(base,{remarks:'Approved zoning for four-unit townhomes.'});assert.equal(r.valuation.available,false);assert.equal(r.valuation.midpoint,null);
  t.mock.method(globalThis,'fetch',()=>{throw Error('A model must not reprice a withheld specialised valuation');});
  assert.equal((await finalizePayload(r,{OPENAI_API_KEY:'synthetic'})).valuation.available,false);
  assert.equal(reviewSpecialUse(base,{remarks:'Renovated home near a new condo development.'}).valuation.available,true);
});
