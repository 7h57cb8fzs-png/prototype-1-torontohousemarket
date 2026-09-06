import test from 'node:test';
import assert from 'node:assert/strict';
import {propertyReportEmail, reportWithoutUnsupportedRating, reportBuyerChecks, buildValueRating} from '../worker-v11.js';
const fixture = () => ({generated_at:'2026-09-06T00:00:00Z', facts:{listing_key:'N1000001',for_sale:true,list_price:1000000,property_type:'Condo Townhouse',beds:2,baths:2,annual_tax:4800,tax_year:2026,maintenance_fee:{amount:400,frequency:'month',included:['Water']}},valuation:{available:true,low:900000,midpoint:1000000,high:1100000,confidence:'Medium'},comparable_policy:{windowDays:100},comparables:[1,2,3,4,5].map(n=>({listingKey:`N100000${n+1}`,address:`${n} Test Street`,soldPrice:900000+n*10000,soldDate:'2026-08-15',cityRegion:'Test Community'})),narrative:{executive_summary:'Strong value',questions_for_realtor:['What are the planned building repairs?']},ai_generation:{provider:'cloudflare'}});
test('null, zero and unavailable asking prices cannot become bargain ratings',()=>{
 for (const price of [null,undefined,0,-1,'']) {const f=fixture();f.facts.list_price=price;const e=propertyReportEmail('Test', {display_name:'Unassigned'},f);assert.ok(!/Strong value|\/10|below the evidence band/.test(e.html));assert.match(e.html,/Golestan Team/);assert.ok(!e.html.includes('Unassigned'));}
 const f=fixture();f.facts.for_sale=false;const e=propertyReportEmail('Test',{},f);assert.ok(!e.html.includes('Request a showing'));assert.match(e.html,/Request a property review/);
});
test('fewer than three unique valid sales suppress ranges and scores',()=>{
 for(const count of [0,1,2]) {const f=fixture();f.comparables=f.comparables.slice(0,count);const r=reportWithoutUnsupportedRating(f);assert.equal(r.valuation.available,false);assert.equal(r.value_rating.score,null);}
 for(const change of [f=>f.comparables[1]={...f.comparables[0]},f=>f.comparables[1].soldDate='2030-01-01',f=>f.comparables[1].soldDate='2020-01-01',f=>f.comparables[1].soldPrice=0]) {const f=fixture();change(f);assert.equal(reportWithoutUnsupportedRating(f).valuation.available,false);}
});
test('low confidence, relaxed size and stale windows cannot produce a value rating',()=>{
 for(const change of [f=>f.valuation.confidence='Low',f=>f.comparable_policy.sizeFallbackUsed=true,f=>f.comparable_policy.windowDays=600]) {const f=fixture();change(f);const r=reportWithoutUnsupportedRating(f);assert.equal(r.valuation.available,true);assert.equal(r.value_rating.available,false);}
 assert.equal(buildValueRating({list_price:100},{available:true,low:300,midpoint:200,high:100},{},3).available,false);
});
test('email shows every sale behind the range and distinguishes modelled from observed prices',()=>{
 const f=fixture(), e=propertyReportEmail('Test',{},f);
 for(const c of f.comparables) {assert.ok(e.html.includes(c.address));assert.ok(e.text.includes(c.address));}
 assert.match(e.html,/5 qualifying sales shown/);assert.match(e.html,/Observed sold prices/);assert.match(e.html,/PRICE WINDOW TO DISCUSS/);assert.match(e.html,/Distance unavailable/);
 assert.ok(e.html.length<70000,'Avoid Gmail clipping');
});
test('cost subtotal includes only known tax and fees and stays explicit about omissions',()=>{
 const f=fixture(); const e=propertyReportEmail('Test',{},f);assert.match(e.text,/subtotal: about \$800\/month/);assert.match(e.text,/mortgage, insurance, utilities, repairs/);
 f.facts.annual_tax=null;f.facts.maintenance_fee=null;assert.match(propertyReportEmail('Test',{},f).text,/no total has been estimated/);
 assert.ok(reportBuyerChecks(f.facts)[0].includes('status certificate'));assert.ok(!reportBuyerChecks(f.facts).some(x=>x.includes('basement')));
});
test('HTML safely escapes listing facts and links return to the selected home',()=>{
 const e=propertyReportEmail('<script>alert(1)</script>',{display_name:'Golestan Team'},fixture());assert.ok(!e.html.includes('<script>'));assert.ok(e.html.includes('listingKey=N1000001'));assert.ok(e.html.includes('&lt;script&gt;'));
 const f=fixture();f.ai_generation.provider='deterministic_fallback';assert.match(propertyReportEmail('Test',{},f).text,/AI-written narrative was unavailable/);
});
