import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminProspects,classifyCandidate,evaluateHistory,identity,torontoDay} from '../admin-prospects-api.js';
const row={ListingKey:'SYNTHETIC-1',MlsStatus:'Expired',StandardStatus:'Expired',ExpirationDate:'2026-09-01',OccupantType:'Owner',TransactionType:'For Sale',PropertyType:'Residential Freehold',PropertySubType:'Detached',StreetNumber:'123',StreetName:'Synthetic',StreetSuffix:'Rd',City:'Toronto C01',ListingContractDate:'2026-08-01'};
test('date, status, geography and explicit occupancy gates',()=>{
 assert(classifyCandidate(row,'2026-10-01').eligible);
 for(const patch of [{ExpirationDate:'2026-08-31'},{ExpirationDate:'2026-10-02'},{ExpirationDate:null},{OccupantType:'Tenant'},{OccupantType:'Vacant'},{OccupantType:null},{OccupantType:'Owner/Tenant'},{City:'Richmond'},{City:'Mississauga'},{PropertyType:'Commercial'},{TransactionType:'For Lease'},{MlsStatus:'Cancelled'}])assert(!classifyCandidate({...row,...patch},'2026-10-01').eligible,JSON.stringify(patch));
 for(const City of ['Aurora','East Gwillimbury','Georgina','King','Markham','Newmarket','Richmond Hill','Vaughan','Whitchurch-Stouffville','Scarborough','North York','Etobicoke','Toronto E11'])assert(classifyCandidate({...row,City},'2026-10-01').eligible,City);
 assert(classifyCandidate({...row,MlsStatus:'Terminated',TerminationDate:'2026-09-20'},'2026-10-01').eligible);
 assert(!classifyCandidate({...row,MlsStatus:'Terminated',StatusChangeTimestamp:'2026-09-20'},'2026-10-01').eligible);
 assert.equal(torontoDay('2026-10-01T02:00:00Z'),'2026-09-30');
});
test('all-status history, same-day relisting, occupancy changes and incomplete data fail closed',()=>{
 assert.equal(evaluateHistory(row,[row],true).result,'qualified');
 for(const r of [{...row,ListingKey:'NEW',MlsStatus:'Terminated',ListingContractDate:'2026-09-02'},{...row,ListingKey:'NEW',MlsStatus:'Sold',ListingContractDate:'2026-09-01'},{...row,ListingKey:'NEW',MlsStatus:'New',ListingContractDate:'2026-08-31'},{...row,MlsStatus:'New'},{...row,OccupantType:'Tenant'}])assert.equal(evaluateHistory(row,[row,r],true).result,'excluded');
 assert.equal(evaluateHistory(row,[row],false).result,'unverified');assert.equal(evaluateHistory(row,[],true).result,'unverified');
 assert.equal(evaluateHistory(row,[row,{...row,ListingKey:'OTHER',ListingContractDate:null}],true).result,'unverified');
 assert.equal(evaluateHistory(row,[{...row,OnMarketDate:'2026-09-12'}],true).result,'excluded');
});
test('condo identity keeps units separate and catches uncertain addresses',()=>{
 const condo={...row,PropertyType:'Residential Condo',UnitNumber:'0505'};assert.equal(identity(condo),identity({...condo,UnitNumber:'505',StreetSuffix:'Road'}));
 assert.equal(identity({...condo,UnitNumber:null}),null);
 assert.equal(evaluateHistory(condo,[condo,{...condo,ListingKey:'NEXT',UnitNumber:'506',MlsStatus:'New'}],true).result,'qualified');
 assert.equal(evaluateHistory(condo,[condo,{...condo,ListingKey:'NEXT',UnitNumber:'505',MlsStatus:'New'}],true).result,'excluded');
 assert.equal(evaluateHistory(condo,[condo,{...condo,ListingKey:'NEXT',UnitNumber:null,MlsStatus:'New'}],true).result,'unverified');
});
test('authentication precedes MLS access; signed paging rejects forgery; errors expose no records',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('secret upstream details');};
 const request=(body,key='test-admin')=>new Request('https://example.invalid/api/admin/prospects/search',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify(body)});
 try{
  assert.equal((await adminProspects(request({},'bad'),{ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'})).status,401);assert.equal(calls,0);
  assert.equal((await adminProspects(request({cursor:'forged'}),{ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'})).status,400);assert.equal(calls,0);
  const r=await adminProspects(request({}),{ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'});assert.equal(r.status,502);assert(!JSON.stringify(await r.json()).includes('secret upstream'));assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 }finally{globalThis.fetch=original;}
});
test('source paging and history verification use protected, read-only MLS fetches',async()=>{
 const original=globalThis.fetch;const calls=[];const meta='<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="${f.endsWith('Date')?'Edm.Date':'Edm.String'}"/>`).join('')+'</EntityType>';
 globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.equal(options.headers.Authorization,'Bearer private');return String(url).includes('$metadata')?new Response(meta):Response.json({value:[row],'@odata.count':1});};
 const env={ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'},req=(action,body)=>new Request('https://example.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:JSON.stringify(body)});
 try{const r=await adminProspects(req('search',{}),env),b=await r.json();assert.equal(b.complete,true);assert.equal(b.candidates.length,1);assert(!JSON.stringify(b).includes('private'));const v=await adminProspects(req('verify',{proof:b.candidates[0].proof}),env);assert.equal((await v.json()).result,'qualified');assert(calls.every(u=>u.startsWith('https://query.ampre.ca/odata/')));}finally{globalThis.fetch=original;}
});
test('admin tab navigation, scan result escaping and sign out clear private results',async()=>{
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'/tmp/thm-test-deps/node_modules/jsdom/lib/api.js');
 const dom=new JSDOM(readFileSync(new URL('../admin.html',import.meta.url),'utf8'),{url:'https://synthetic.invalid/admin',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.Response=Response;w.Blob=Blob;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path)=>Response.json(path.includes('/prospects/search')?{ok:true,pageId:'one',scanned:1,candidates:[{...row,listingKey:'TEST',address:'Synthetic Rd',proof:'synthetic'}],excluded:{},complete:true}:path.includes('/prospects/verify')?{ok:true,result:'qualified',listingKey:'TEST',address:'<img onerror=alert(1)>',city:'Toronto',region:'Toronto',status:'Expired',eventDate:'2026-09-01',reason:'No later listing',checkedAt:'2026-10-01T12:00:00Z'}:path.includes('/agents')?{ok:true,agents:[]}:path.includes('/counts')?{ok:true,queue:{}}:path.includes('/settings')?{ok:true,settings:{}}:{ok:true,leads:[],total:0});
 const files=['admin-view-model.js','admin-exports.js','admin-insights.js','admin-prospects.js','admin-workspace.js'];const code=files.map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 await w.eval('(async()=>{'+code+"\nstate.token='synthetic';await loadSetup();$('login').hidden=true;$('workspace').hidden=false;await changeView('prospects');await prospects.start();})()");
 assert.equal(d.getElementById('prospectsView').hidden,false);assert.equal(d.getElementById('listView').hidden,true);assert.equal(d.querySelectorAll('#prospectRows tr').length,1);assert.equal(d.querySelector('#prospectRows img'),null);assert.equal(d.getElementById('prospectExport').disabled,false);
 d.getElementById('signOut').click();assert.equal(d.querySelectorAll('#prospectRows tr').length,0);assert.equal(d.getElementById('workspace').hidden,true);dom.window.close();
});
