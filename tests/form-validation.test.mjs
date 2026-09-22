import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{validateAddressEntry,sellerParsedAddress,resolveSellerSubject,normalizeNorthAmericanPhone,sellerReportEmail,propertyReportEmail} from '../worker-v11.js';

test('common condo formats preserve the street, city and exact unit',()=>{
 for(const input of ['1405-9201 Yonge St, Richmond Hill','9201 Yonge St 1405 Richmond Hill','9201 Yonge St, Unit 1405, Richmond Hill','Unit 1405, 9201 Yonge St, Richmond Hill']){
  const result=validateAddressEntry(input,{requireCity:true,requireUnit:true});
  assert.equal(result.ok,true,input);assert.equal(result.parsed.number,'9201');assert.equal(result.parsed.name,'yonge');assert.equal(result.parsed.unit,'1405');assert.equal(result.city,'Richmond Hill');
 }
 for(const input of ['175 Bamburgh Circ 306','175 Bamburgh Circ unit 306']){
  const parsed=sellerParsedAddress(input);assert.equal(parsed.name,'bamburgh');assert.equal(parsed.suffix,'circle');assert.equal(parsed.unit,'306');
 }
});

test('malformed and incomplete street inputs are rejected before any MLS query',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Invalid addresses must not query MLS');});
 for(const address of ['9201 Yonge St1405, Richmond Hill','Yonge St, Richmond Hill','9201 Yonge St, Unit, Richmond Hill']){
  const r=await worker.fetch(new Request('https://torontohousemarket.com/api/property?strict_address=1&q='+encodeURIComponent(address)),{},{});
  assert.equal(r.status,400,address);const body=await r.json();assert.doesNotMatch(body.error,/Yonge|Ferris|example:/);assert.equal(body.inputError,true);
 }
 const missingUnit=validateAddressEntry('9201 Yonge St, Richmond Hill',{requireCity:true,requireUnit:true});assert.equal(missingUnit.ok,false);assert.match(missingUnit.error,/condo number/);
});

test('seller format preflight confirms the exact unit without waiting for MLS',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Format preflight must not query MLS');});
 const response=await worker.fetch(new Request('https://torontohousemarket.com/api/property?strict_address=1&validate_only=1&q='+encodeURIComponent('175 Bamburgh Circ 306, Toronto')),{},{});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.normalizedAddress,'175 Bamburgh Circle Unit 306, Toronto');assert.equal(body.unit,'306');assert.equal(body.city,'Toronto');
});

test('the two Bamburgh report formats recover the exact archived unit, never a neighbour',async t=>{
 // Synthetic MLS records reproduce the parser failure; no real prices or customer data.
 const matching={ListingKey:'DEMO-BAMBURGH-306',StreetNumber:'175',StreetName:'Bamburgh',StreetSuffix:'Circ',UnitNumber:'306',City:'Toronto E05',UnparsedAddress:'175 Bamburgh Circ 306 Toronto E05 ON M1W 3X8',StandardStatus:'Canceled',OriginalEntryTimestamp:'2026-08-01T00:00:00Z'};
 const rows=[matching,{...matching,ListingKey:'OTHER-UNIT',UnitNumber:'307',UnparsedAddress:'175 Bamburgh Circ 307 Toronto E05',OriginalEntryTimestamp:'2026-09-01T00:00:00Z'},{...matching,ListingKey:'OTHER-CITY',City:'Richmond Hill',UnparsedAddress:'175 Bamburgh Circ 306 Richmond Hill',OriginalEntryTimestamp:'2026-09-02T00:00:00Z'}];
 t.mock.method(globalThis,'fetch',async url=>Response.json(decodeURIComponent(String(url)).includes("('DEMO-BAMBURGH-306')")?matching:{value:rows}));
 for(const address of ['175 Bamburgh Circ 306','175 Bamburgh Circ unit 306']){
  const record=await resolveSellerSubject(address,{city:'Toronto'},{AMPRE_TOKEN:'fixture-only'});
  assert.equal(record?.ListingKey,'DEMO-BAMBURGH-306');assert.equal(record.UnitNumber,'306');
 }
});

test('phone validation agrees in browser and server, including obvious fake numbers',()=>{
 const context=vm.createContext({window:{},document:{addEventListener(){}}});vm.runInContext(readFileSync(new URL('../form-inputs.js',import.meta.url),'utf8'),context);
 for(const input of ['3333333333','333333333','1234567890','647-123-4567','+44 7700 900123','64789047040','6478904704 ext 3']){assert.equal(normalizeNorthAmericanPhone(input),null,input);assert.equal(context.window.THMInputs.phone(input),null,input);}
 for(const input of ['647-890-4704','(647) 890-4704','+1 647 890 4704','16478904704']){assert.equal(normalizeNorthAmericanPhone(input),'+16478904704');assert.equal(context.window.THMInputs.phone(input),'+16478904704');}
});

test('no-match email explains the gap simply and offers a working call or reply',()=>{
 const email=sellerReportEmail('Example home',{facts:{},valuation:{available:false,missingFacts:['home type']},seller:{evidence:{listingMatched:false}},comparables:[]});
 for(const content of [email.html,email.text]){assert.match(content,/couldn’t confidently match your home/);assert.match(content,/647-890-4704/);assert.match(content,/Reply to this email/);assert.doesNotMatch(content,/lot frontage|floor plan|previous MLS number|Reply with the home type/i);}
 assert.match(email.html,/href="tel:\+16478904704"/);
 const dataError=sellerReportEmail('Example home',{valuation:{available:false,dataUnavailable:true},comparables:[]});assert.match(dataError.text,/couldn’t complete the market check/);
});

test('buyer email shares seller price typography and preserves the infographic and report sections',()=>{
 const email=propertyReportEmail('Example home',{}, {facts:{for_sale:true,list_price:1100000},valuation:{available:true,low:900000,high:1050000,midpoint:975000,confidence:'Medium'},comparables:[1,2,3].map(i=>({address:`${i} Demo Rd`,soldPrice:900000+i*30000,soldDate:'2026-08-20'}))});
 assert.match(email.html,/font-family:Arial,Helvetica,sans-serif;font-size:26px/);
 for(const content of ['Below range','Inside range','Above range','YOUR PRICE PICTURE','HOME AT A GLANCE','Recent comparable sales','WHAT THE NUMBERS SAY','KNOWN MONTHLY COSTS','CHECK BEFORE AN OFFER','YOUR NEXT MOVE'])assert.ok(email.html.includes(content),content);
});
