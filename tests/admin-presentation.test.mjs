import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationSales} from '../admin-prospects-api.js';
import {adminPostgrid} from '../admin-postgrid-api.js';
const subject={ListingKey:'subject',StreetNumber:'261',StreetName:'Howland',StreetSuffix:'Ave',City:'Toronto C02',CityRegion:'Annex',PropertyType:'Residential Freehold',PropertySubType:'Semi-Detached',TransactionType:'For Sale',Latitude:43.67,Longitude:-79.41};
const sale=(n,extra={})=>({...subject,ListingKey:'sold-'+n,StreetNumber:String(n),MlsStatus:'Sold',ClosePrice:1700000,PurchaseContractDate:'2026-09-16',...extra});
test('nearby sold selection rejects unrelated, future, rental, restricted and duplicate property records',()=>{
 const rejected=[sale(1,{City:'Vaughan'}),sale(2,{StreetName:'Elsewhere',CityRegion:'Other'}),sale(3,{PurchaseContractDate:'2026-11-01'}),sale(4,{PurchaseContractDate:'2025-01-01'}),sale(5,{MlsStatus:'Sold Conditional'}),sale(6,{TransactionType:'For Lease'}),sale(7,{ClosePrice:0,ListPrice:2000000}),sale(8,{InternetAddressDisplayYN:false}),sale(9,{InternetEntireListingDisplayYN:false}),sale(10,{Longitude:-80.4}),sale(11,{PropertyType:'Commercial'}),sale(261),sale(12,{PurchaseContractDate:null,ModificationTimestamp:'2026-09-01'})];
 assert.deepEqual(presentationSales(subject,rejected,'2026-10-07'),[]);
 const selected=presentationSales(subject,[...rejected,sale(225),sale(225,{ListingKey:'duplicate'}),sale(170),sale(144)],'2026-10-07');assert.equal(selected.length,3);assert.equal(new Set(selected.map(r=>r.address)).size,3);assert.equal(selected[0].price,1700000);
});
test('condo sales keep units distinct and missing unit identities are excluded',()=>{
 const s={...subject,PropertyType:'Residential Condo & Other',PropertySubType:'Condo Apartment',UnitNumber:'101'};
 const rows=['101','102','103','104',''].map((u,i)=>({...sale(261),ListingKey:'condo-'+i,PropertyType:s.PropertyType,PropertySubType:s.PropertySubType,UnitNumber:u}));
 assert.deepEqual(presentationSales(s,rows,'2026-10-07').map(x=>x.address),['Unit 102 · 261 Howland Ave','Unit 103 · 261 Howland Ave','Unit 104 · 261 Howland Ave']);
});
test('generation authenticates and verifies proof before reading data; no provider or storage access',async()=>{
 const original=fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected request');};
 const req=key=>new Request('https://test.invalid/api/admin/postgrid/presentation',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify({reviewProof:'forged'})});
 try{assert.equal((await adminPostgrid(req('bad'),{ADMIN_API_KEY:'admin'})).status,401);assert.equal((await adminPostgrid(req('admin'),{ADMIN_API_KEY:'admin'})).status,400);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('qualified generation is read-only, returns real sale fields and rechecks relisting',async()=>{
 const {adminProspects,torontoDay}=await import('../admin-prospects-api.js');const env={ADMIN_API_KEY:'synthetic-admin',AMPRE_VOW_TOKEN:'synthetic-vow'},old=fetch;let relisted=false;const origins=[];
 const listing={...subject,MlsStatus:'Expired',StandardStatus:'Expired',ExpirationDate:'2026-09-15',OccupantType:'Owner',ListingContractDate:'2026-08-01',PostalCode:'M5R 3B7'};
 globalThis.fetch=async(url,init)=>{const u=new URL(url);origins.push(u.origin);assert.equal(u.origin,'https://query.ampre.ca');assert.equal(init.headers.Authorization,'Bearer synthetic-vow');assert(!init.method||init.method==='GET');if(u.pathname.endsWith('$metadata'))return new Response('<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="Edm.String"/>`).join('')+'</EntityType>');if(u.pathname.includes('Property('))return Response.json(listing);if(u.pathname.endsWith('/Media'))return Response.json({value:[]});if(u.searchParams.get('$filter')?.includes("MlsStatus eq 'Sold'"))return Response.json({value:[225,170,144].map(n=>sale(n,{PurchaseContractDate:torontoDay()}))});return Response.json({value:[listing,...(relisted?[{...listing,ListingKey:'new',MlsStatus:'New',ListingContractDate:torontoDay()}]:[])],'@odata.count':relisted?2:1});};
 const request=(a,b={})=>new Request('https://internal.invalid/api/admin/'+a,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY},body:JSON.stringify(b)});
 try{const search=await(await adminProspects(request('prospects/search'),env)).json();assert(search.candidates,JSON.stringify(search));const verified=await(await adminProspects(request('prospects/verify',{proof:search.candidates[0].proof}),env)).json();assert.equal(verified.result,'qualified');const r=await adminPostgrid(request('postgrid/presentation',{reviewProof:verified.reviewProof}),env),d=await r.json();assert.equal(r.status,200);assert.equal(d.sales.length,3);assert.equal(d.listingKey,subject.ListingKey);assert.equal(new URL(d.sellerUrl).searchParams.get('address'),d.fullAddress);assert(!JSON.stringify(d).includes(env.AMPRE_VOW_TOKEN));assert(!d.listing);assert(d.sales.every(s=>s.photoData===null));relisted=true;assert.equal((await adminPostgrid(request('postgrid/presentation',{reviewProof:verified.reviewProof}),env)).status,409);assert(origins.length>0);}finally{globalThis.fetch=old;}
});
