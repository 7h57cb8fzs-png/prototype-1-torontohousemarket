import test from 'node:test';
import assert from 'node:assert/strict';
import {historyEvent,summarizePropertyHistory} from '../property-history.js';
import {chooseLookupPlans,addressRecoveryPlans} from '../lookup-recovery.js';
import {soldCandidates,normalizeExpertResult,applyExpertRecovery} from '../worker-v12.js';
import {sellerHistoryMatches,sellerHistoryParsedAddress} from '../worker-v11.js';
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
  const base={valuation:{available:false}};assert.equal(applyExpertRecovery(base,one),base);
  const three=normalizeExpertResult({comparables:candidates.map(c=>({id:c.id}))},candidates,'ampre_vow');
  const report=applyExpertRecovery(base,three);assert.equal(report.valuation.available,true);assert(Number.isFinite(report.valuation.low));assert(report.valuation.high>report.valuation.low);
});
