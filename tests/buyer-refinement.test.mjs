import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNorthAmericanPhone, condoHasSameSizeRange, comparableHasCompatibleSize, buildComparableContext, priceCheckSelection, propertyReportEmail, createBuyerRequest, reportWithoutUnsupportedRating} from '../worker-v11.js';

const condo=(n,patch={})=>({ListingKey:`N100000${n}`,PropertyType:'Residential Condo & Other',PropertySubType:'Condo Apartment',LivingAreaRange:'700-799',City:'Vaughan',CityRegion:'Vaughan Corporate Centre',UnparsedAddress:`${n} Test Road, Vaughan`,StreetNumber:String(n),StreetName:'Test',StreetSuffix:'Road',BedroomsTotal:2,BathroomsTotalInteger:2,StandardStatus:'Active',TransactionType:'For Sale',ListPrice:700000,...patch});
const report=()=>({generated_at:new Date().toISOString(),facts:{listing_key:'N1000001',for_sale:true,list_price:700000,property_type:'Condo Apartment',living_area:'700-799',neighbourhood:'Vaughan Corporate Centre'},valuation:{available:true,low:680000,midpoint:700000,high:720000,confidence:'Medium'},comparable_policy:{windowDays:100},comparables:[2,3,4].map(n=>({listingKey:`N100000${n}`,address:`${n} Test Road`,soldPrice:680000+n*5000,soldDate:new Date(Date.now()-30*864e5).toISOString().slice(0,10),propertySubType:'Condo Apartment',livingAreaRange:'700-799',cityRegion:'Vaughan Corporate Centre'}))});

test('phone format rejects text, invalid lengths, placeholders and invalid NANP prefixes',()=>{
 for(const value of ['Golestan','1234567890','1111111111','0000000000','9999999999','6478904','647890470400','6478904704junk','1478904704','6471904704','6479114704','+16478904704ext4'])assert.equal(normalizeNorthAmericanPhone(value),null,value);
 for(const value of ['6478904704','(647) 890-4704','647.890.4704','1 647 890 4704','+1 (647) 890-4704'])assert.equal(normalizeNorthAmericanPhone(value),'+16478904704',value);
});
test('invalid phone numbers cannot reach the database or queue email jobs',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No external call allowed for invalid contact');});
 for(const mobile of ['Golestan','1234567890','647890470400','1111111111']){
  const response=await createBuyerRequest(new Request('https://example.com/api/lead',{method:'POST',body:JSON.stringify({name:'Test Buyer',mobile,email:'test@example.invalid',property_input:'Test home'})}),{SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},{});
  assert.equal(response.status,400);assert.match((await response.json()).error,/10-digit mobile/);
 }
});
test('condo sizes require matching bands, handle numeric values and reject unknown or open sizes',()=>{
 for(const [size,expected] of [['700-799',true],['700–799',true],['600-699',false],['800-899',false],['700-899',false],['<700',false],['700+',false],['',false]])assert.equal(condoHasSameSizeRange(condo(1),condo(2,{LivingAreaRange:size})),expected,size);
 assert.equal(condoHasSameSizeRange(condo(1),{BuildingAreaTotal:735}),true);
 assert.equal(condoHasSameSizeRange({BuildingAreaTotal:799},{BuildingAreaTotal:800}),false);
 assert.equal(condoHasSameSizeRange(condo(1),{BuildingAreaTotal:735,BuildingAreaUnits:'Square Metres'}),false);
 assert.equal(comparableHasCompatibleSize(condo(1,{LivingAreaRange:null}),condo(2)),false);
});
test('front-page condos exclude adjacent size bands from both matched and related homes',()=>{
 const selected=priceCheckSelection(condo(1),[condo(2),condo(3),condo(4),condo(5,{LivingAreaRange:'600-699'}),condo(6,{LivingAreaRange:'800-899',BedroomsTotal:1}),condo(7,{LivingAreaRange:null})]);
 assert.equal(selected.count,3);assert.equal(selected.available,true);assert.equal(selected.relatedMatches.length,0);assert.equal(selected.sizeRule,'same_condo_size_range');
 assert.deepEqual(selected.matches.map(c=>c.listingKey).sort(),['N1000002','N1000003','N1000004']);
});
test('sparse condo sold evidence never widens size to manufacture a price range',async t=>{
 const rows=[condo(2),condo(3),condo(4,{LivingAreaRange:'600-699'}),condo(5,{LivingAreaRange:'800-899'})].map(r=>({...r,StandardStatus:'Closed',ClosePrice:700000,PurchaseContractDate:new Date(Date.now()-30*864e5).toISOString()}));
 t.mock.method(globalThis,'fetch',async url=>Response.json(new URL(String(url)).searchParams.get('$count')==='true'?{'@odata.count':rows.length,value:[]}: {value:rows}));
 const result=await buildComparableContext(condo(1),{AMPRE_TOKEN:'fixture'},true);
 assert.equal(result.available,false);assert.equal(result.policy.sizeFallbackUsed,false);assert.equal(result.comparables.length,2);
 assert.ok(result.comparables.every(c=>c.livingAreaRange==='700-799'));
});
test('email excludes stale mismatched condo comparables and the range derived from them',()=>{
 for(const change of [c=>c.livingAreaRange='600-699',c=>c.livingAreaRange=null,c=>c.cityRegion='Another community']){
  const input=report();change(input.comparables[0]);const checked=reportWithoutUnsupportedRating(input);
  assert.equal(checked.comparables.length,2);assert.equal(checked.valuation.available,false);
  const email=propertyReportEmail('Test home',{},input);assert.ok(!email.html.includes('2 Test Road'));assert.ok(!email.html.includes('$680,000'));assert.match(email.text,/interior size range/);
 }
});
test('email uses a styled property link, linked call label and cashback before contact',()=>{
 const email=propertyReportEmail('Test home',{},report(),{appointmentUrl:'https://torontohousemarket.com/showing.html#token=fixture'});
 assert.match(email.html,/<h1 class="report-address"[^>]*><a href="https:\/\/torontohousemarket.com\/\?listingKey=N1000001#lookup"[^>]*color:#ffffff!important/);
 assert.match(email.html,/tel:\+16478904704/);assert.match(email.html,/>Call Golestan Homes<\/a>/);assert.ok(!email.html.includes('647-890-4704'));
 assert.ok(email.html.indexOf('Up to $10,000 cashback')<email.html.indexOf('Questions? Let’s talk'));
 assert.match(email.html,/Inside range/);assert.match(email.text,/within the estimated range/);
 assert.match(email.text,/700-799/);assert.match(email.html,/showing.html#token=fixture/);
});
