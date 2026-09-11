import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{propertyReportEmail,buildEmail,reportWithoutUnsupportedRating,condoHasSameSizeRange,normalizeNorthAmericanPhone} from '../worker-v11.js';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(read('worker-v11.js').replace(/export \{[\s\S]*?\};\s*\/\/# sourceMappingURL=[^\n]+\s*$/,''),ctx);
const row=(unit='1410',transaction='For Lease')=>({ListingKey:'C1000001',StreetNumber:'10',StreetName:'York',StreetSuffix:'Street',UnitNumber:unit,UnparsedAddress:`10 York Street ${unit}, Toronto`,TransactionType:transaction,StandardStatus:'Active',ListPrice:3000,PropertySubType:'Condo Apartment',Media:[{MediaKey:'p',MediaType:'image/jpeg',MediaURL:'https://example.com/p.jpg'}]});
const report=()=>({generated_at:'2026-09-11T15:00:00Z',facts:{for_sale:true,list_price:399000,property_type:'Condo Apartment',living_area:'700-799',neighbourhood:'Concord'},valuation:{available:true,low:390000,midpoint:400000,high:410000},comparables:[1,2].map(n=>({listingKey:'N'+n,address:n+' Test',soldPrice:400000,soldDate:'2026-08-01',propertySubType:'Condo Apartment',livingAreaRange:'700-799',cityRegion:'Concord'}))});
const cases=[
['unit-first hyphen is preserved',()=>{const p=ctx.parseAddress5('1410 - 10 YORK STREET');assert.equal(p.number,'10');assert.equal(p.unit,'1410');assert.equal(p.name,'york');}],
['unit-first compact format is preserved',()=>{assert.equal(ctx.parseAddress5('1410-10 York Street, Toronto').unit,'1410');}],
['a different apartment can never win by sale status',()=>{const a=ctx.parseAddress5('10 York Street Unit 1410');assert.ok(ctx.addressScore2(a,row('3213','For Sale'))<0);assert.equal(ctx.selectExactAddressMatch(a,[row('3213','For Sale'),row()]).UnitNumber,'1410');}],
['fallback also rejects a different apartment',()=>{assert.ok(ctx.addressMatchScore(ctx.parseAddress('1410-10 York Street'),row('3213','For Sale'))<0);}],
['Court abbreviation remains supported',()=>assert.equal(ctx.parseAddress5('2 Dogleg Crt').suffix,'court')],
['Avenue Road remains supported',()=>assert.equal(ctx.parseAddress5('981 Avenue Road').name,'avenue')],
['phone placeholder is absent and validation retained',()=>{assert.ok(!read('index.html').includes('(416) 234-5678'));assert.equal(normalizeNorthAmericanPhone('Golestan'),null);assert.equal(normalizeNorthAmericanPhone('6478904704'),'+16478904704');}],
['lead emails use the site palette and readable type',()=>{const e=buildEmail({job_type:'notify_admin',payload:{reason:'new_lead_admin_alert'}},{name:'Test',resolved_address:'10 York',email:'test@example.invalid'});assert.ok(e.html.includes('#196b60'));assert.ok(!e.html.includes('#3155f5'));assert.ok(e.html.includes('Arial,Helvetica,sans-serif'));}],
['same report evidence renders identically',()=>{assert.deepEqual(propertyReportEmail('Test home',{},report()),propertyReportEmail('Test home',{},report()));}],
['normalizing report evidence is idempotent',()=>{const once=reportWithoutUnsupportedRating(report());assert.deepEqual(reportWithoutUnsupportedRating(once),once);assert.equal(once.valuation.available,false);}],
['condo sizes cannot widen',()=>{assert.equal(condoHasSameSizeRange({LivingAreaRange:'700-799'},{LivingAreaRange:'600-699'}),false);assert.equal(condoHasSameSizeRange({LivingAreaRange:'700-799'},{LivingAreaRange:'700-799'}),true);}],
['report explains its evidence threshold',()=>assert.ok(propertyReportEmail('Test home',{},report()).html.includes('at least 3 qualifying sales'))],
['specific headline and primary site branding',()=>{const h=read('index.html');assert.ok(h.includes('Get the AI property report.'));assert.ok(h.includes('Book your private showing.'));assert.ok(!/GOLESTAN HOMES|Golestan Homes/.test(h));}],
['lease lookup keeps the selected unit and rental status',async t=>{t.mock.method(globalThis,'fetch',async input=>new URL(input).pathname.includes("Property('C1000001')")?Response.json(row()):Response.json({value:[row('3213','For Sale'),row()]}));const r=await worker.fetch(new Request('https://example.com/api/property?q=1410%20-%2010%20YORK%20STREET'),{AMPRE_TOKEN:'fixture'},{waitUntil(){}});const p=(await r.json()).property;assert.match(p.address,/1410/);assert.equal(p.forLease,true);assert.equal(p.forSale,false);assert.equal(p.listPrice,3000);assert.ok(p.photos.length);}],
['custom menus support keyboard and preserve native fields',()=>{const s=read('select-controls.js');assert.ok(s.includes("setAttribute('role','listbox')"));assert.ok(s.includes("e.key==='Escape'"));assert.ok(s.includes("e.key==='ArrowDown'"));assert.ok(s.includes("select.dispatchEvent(new Event('change'"));}]
];
const selected=JSON.parse(read('tests/focused-review-selection.json'));
for(const index of selected) test(cases[index][0],cases[index][1]);
