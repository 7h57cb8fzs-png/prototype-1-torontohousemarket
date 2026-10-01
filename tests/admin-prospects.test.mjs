import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminProspects,classifyCandidate,evaluateHistory,identity,torontoDay,searchFilters,matchesFilters,dateBounds} from '../admin-prospects-api.js';
const row={ListingKey:'SYNTHETIC-1',MlsStatus:'Expired',StandardStatus:'Expired',ExpirationDate:'2026-09-01',OccupantType:'Owner',TransactionType:'For Sale',PropertyType:'Residential Freehold',PropertySubType:'Detached',StreetNumber:'123',StreetName:'Synthetic',StreetSuffix:'Rd',City:'Toronto C01',ListingContractDate:'2026-08-01'};
test('scan scope validates prices and matches municipality, exact community and inclusive asking prices',()=>{
 const filters=searchFilters({municipality:'Toronto',community:'  Test Community  ',minPrice:'500000',maxPrice:'1000000'});
 assert(matchesFilters({...row,CityRegion:'TEST COMMUNITY',ListPrice:500000},filters));
 assert(matchesFilters({...row,CityRegion:'Test Community',ListPrice:1000000},filters));
 for(const patch of [{City:'Markham'},{CityRegion:'Other Community'},{CityRegion:null},{ListPrice:499999},{ListPrice:1000001},{ListPrice:null}])assert(!matchesFilters({...row,CityRegion:'Test Community',ListPrice:800000,...patch},filters));
 assert(matchesFilters({...row,ListPrice:null},searchFilters()));
 assert(matchesFilters({...row,City:'Whitchurch-Stouffville'},searchFilters({municipality:'Whitchurch-Stouffville'})));
 for(const invalid of [{minPrice:100,maxPrice:99},{minPrice:-1},{minPrice:'1 or 1 eq 1'},{maxPrice:Infinity},{municipality:'Mississauga'},{community:'a'.repeat(121)}])assert.throws(()=>searchFilters(invalid));
});
test('scan filters reach the provider, remain signed across pages, and never restrict relisting history',async()=>{
 const original=globalThis.fetch,calls=[];let pages=0;
 const selected={...row,City:'Richmond Hill',CityRegion:'North Richvale',ListPrice:900000};
 const next='https://webapi-green-gcp.ampre.ca/odata/Property?$skiptoken=second';
 const meta='<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="${f.endsWith('Date')?'Edm.Date':'Edm.String'}"/>`).join('')+'</EntityType>';
 globalThis.fetch=async(url)=>{const u=new URL(url);calls.push(u);if(u.pathname.endsWith('$metadata'))return new Response(meta);if(u.searchParams.get('$filter')?.includes('StreetName'))return Response.json({value:[selected,{...selected,ListingKey:'LATER',CityRegion:'Changed label',ListPrice:1200000,MlsStatus:'New',ListingContractDate:'2026-09-20'}],'@odata.count':2});pages++;return Response.json({value:[selected,{...selected,ListingKey:'WRONG',City:'Vaughan'},{...selected,ListingKey:'OVER',ListPrice:900001}],'@odata.count':6,...(pages===1?{'@odata.nextLink':next}:{})});};
 const env={ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'},req=(action,body)=>new Request('https://example.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:JSON.stringify(body)});
 try{
  const filters={municipality:'Richmond Hill',community:'North Richvale',minPrice:900000,maxPrice:900000};
  const b=await(await adminProspects(req('search',{filters}),env)).json();assert.equal(b.candidates.length,1);assert(b.cursor);
  const expression=calls.find(u=>u.pathname.endsWith('Property')).searchParams.get('$filter');assert(expression.includes("contains(City,'Richmond Hill')"));assert(expression.includes("tolower(CityRegion) eq 'north richvale'"));assert(expression.includes('ListPrice ge 900000'));assert(expression.includes('ListPrice le 900000'));
  const p=await(await adminProspects(req('search',{cursor:b.cursor,filters:{municipality:'Vaughan'}}),env)).json();assert.equal(p.complete,true);assert.deepEqual(p.filters,searchFilters(filters));assert.equal(p.candidates.length,1);
  const v=await(await adminProspects(req('verify',{proof:b.candidates[0].proof}),env)).json();assert.equal(v.result,'excluded');
  const history=calls.find(u=>u.searchParams.get('$filter')?.includes('StreetName')).searchParams.get('$filter');assert(!history.includes('CityRegion'));assert(!history.includes('ListPrice'));
 }finally{globalThis.fetch=original;}
});
test('community suggestions read lookup vocabulary only and require admin authentication',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url)=>{calls.push(new URL(url));return Response.json({value:[{LookupValue:'North Richvale'},{LookupValue:'Annex'},{LookupValue:'Annex'}]});};
 const env={ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'},req=key=>new Request('https://example.invalid/api/admin/prospects/options',{method:'POST',headers:{Authorization:'Bearer '+key},body:'{}'});
 try{assert.equal((await adminProspects(req('wrong'),env)).status,401);assert.equal(calls.length,0);const result=await(await adminProspects(req('test-admin'),env)).json();assert.deepEqual(result.communities,['Annex','North Richvale']);assert(calls.every(u=>u.pathname==='/odata/Lookup'));}finally{globalThis.fetch=original;}
});
test('multiple municipalities and districts form a union, with any selected community and status',()=>{
 const filters=searchFilters({municipalities:['Richmond Hill','Vaughan'],districts:['W04','w05'],communities:['North Richvale','Maple','Weston'],status:'Expired'});
 for(const [City,CityRegion] of [['Richmond Hill','North Richvale'],['Vaughan','Maple'],['Toronto W04','Weston'],['Toronto W05','Weston']])assert(matchesFilters({...row,City,CityRegion},filters));
 for(const [City,CityRegion] of [['Toronto W03','Weston'],['Markham','Maple'],['Richmond Hill','Unselected']])assert(!matchesFilters({...row,City,CityRegion},filters));
 assert(!matchesFilters({...row,City:'Vaughan',CityRegion:'Maple',MlsStatus:'Terminated',TerminatedDate:'2026-09-10'},filters));
 const districts=searchFilters({districts:['W04','W05']});assert(matchesFilters({...row,City:'Toronto W05'},districts));assert(!matchesFilters({...row,City:'Vaughan'},districts));
 assert(matchesFilters({...row,City:'Toronto E11'},searchFilters({municipalities:['Toronto'],districts:['W04']})));
 for(const invalid of [{districts:['W99']},{municipalities:'Vaughan'},{communities:['Good',{}]},{dateFrom:'2026-02-30'},{dateFrom:'2026-08-31',dateTo:'2026-08-01'},{dateTo:'2099-01-01'},{status:'Sold'}])assert.throws(()=>searchFilters(invalid));
});
test('historical date selection survives signed verification and relisting is checked through today',async()=>{
 const original=globalThis.fetch,calls=[];
 const old={...row,City:'Toronto W04',CityRegion:'Weston',ExpirationDate:'2026-08-15',ListingContractDate:'2026-07-01'};
 const meta='<EntityType Name="Property">'+['ListingKey','MlsStatus','ExpirationDate','TerminationDate','OccupantType','StreetName','City'].map(f=>`<Property Name="${f}" Type="${f.endsWith('Date')?'Edm.Date':'Edm.String'}"/>`).join('')+'</EntityType>';
 let relisted=false;
 globalThis.fetch=async(url)=>{const u=new URL(url);calls.push(u);if(u.pathname.endsWith('$metadata'))return new Response(meta);const history=u.searchParams.get('$filter')?.includes('StreetName');const rows=history?[old,...(relisted?[{...old,ListingKey:'LATER',MlsStatus:'Sold',ListingContractDate:'2026-09-20'}]:[])]:[old,{...old,ListingKey:'EARLY',ExpirationDate:'2026-07-31'},{...old,ListingKey:'LATE',ExpirationDate:'2026-09-01'}];return Response.json({value:rows,'@odata.count':rows.length});};
 const env={ADMIN_API_KEY:'test-admin',AMPRE_VOW_TOKEN:'private'},req=(action,body)=>new Request('https://example.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:JSON.stringify(body)});
 try{
  const filters={municipalities:['Richmond Hill','Vaughan'],districts:['W04','W05'],communities:['Weston','Maple','North Richvale'],dateFrom:'2026-08-01',dateTo:'2026-08-31',status:'Expired'};
  const b=await(await adminProspects(req('search',{filters}),env)).json();assert.equal(b.candidates.length,1);assert.equal(b.since,'2026-08-01');assert.equal(b.through,'2026-08-31');assert.equal(b.historyThrough,torontoDay());
  const expression=calls.find(u=>u.pathname.endsWith('Property')).searchParams.get('$filter');for(const part of ["contains(City,'Richmond Hill')","contains(City,'Vaughan')","City eq 'Toronto W04'","City eq 'Toronto W05'","tolower(CityRegion) eq 'weston'","tolower(CityRegion) eq 'maple'","ExpirationDate ge 2026-08-01","ExpirationDate le 2026-08-31"])assert(expression.includes(part),part);
  const proof=b.candidates[0].proof;const qualified=await(await adminProspects(req('verify',{proof}),env)).json();assert.equal(qualified.result,'qualified');
  relisted=true;const excluded=await(await adminProspects(req('verify',{proof,dateTo:'2026-08-31'}),env)).json();assert.equal(excluded.result,'excluded');
  for(const u of calls.filter(u=>u.searchParams.get('$filter')?.includes('StreetName')))assert(!u.searchParams.get('$filter').includes('2026-08-31'));
 }finally{globalThis.fetch=original;}
 const window={dateFrom:'2026-03-08',dateTo:'2026-03-08'};
 assert(classifyCandidate({...old,ExpirationDate:'2026-03-09T03:59:00Z'},'2026-10-01',window).eligible);
 assert(!classifyCandidate({...old,ExpirationDate:'2026-03-09T04:00:00Z'},'2026-10-01',window).eligible);
 assert.equal(dateBounds('ExpirationDate','Edm.Date','2026-03-08','2026-03-08'),'ExpirationDate ge 2026-03-08 and ExpirationDate le 2026-03-08');
 assert(dateBounds('ExpirationDate','Edm.DateTimeOffset','2026-03-08','2026-03-08').includes('2026-03-10T00:00:00.000Z'));
});
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
 const requests=[];w.fetch=async(path,options)=>{requests.push({path,body:options?.body?JSON.parse(options.body):null});return Response.json(path.includes('/prospects/search')?{ok:true,pageId:'one',scanned:1,candidates:[{...row,listingKey:'TEST',address:'Synthetic Rd',proof:'synthetic'}],excluded:{},complete:true}:path.includes('/prospects/verify')?{ok:true,result:'qualified',listingKey:'TEST',address:'<img onerror=alert(1)>',city:'Toronto',region:'Toronto',status:'Expired',eventDate:'2026-09-01',reason:'No later listing',checkedAt:'2026-10-01T12:00:00Z'}:path.includes('/agents')?{ok:true,agents:[]}:path.includes('/counts')?{ok:true,queue:{}}:path.includes('/settings')?{ok:true,settings:{}}:{ok:true,leads:[],total:0});};
 const files=['admin-view-model.js','admin-exports.js','admin-insights.js','admin-prospects.js','admin-workspace.js'];const code=files.map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 await w.eval('(async()=>{'+code+"\nstate.token='synthetic';await loadSetup();$('login').hidden=true;$('workspace').hidden=false;await changeView('prospects');$('prospectMunicipalities').querySelector('[value=\"Richmond Hill\"]').checked=true;$('prospectMunicipalities').querySelector('[value=Vaughan]').checked=true;$('prospectDistricts').querySelector('[value=W04]').checked=true;$('prospectDistricts').querySelector('[value=W05]').checked=true;$('prospectCommunity').value='North Richvale, South Richvale, Maple';$('prospectDateFrom').value='2026-08-01';$('prospectDateTo').value='2026-08-31';$('prospectMinPrice').value='900000';$('prospectMaxPrice').value='800000';await prospects.start();window.testStart=prospects.start;})()");
 assert.equal(requests.filter(r=>r.path.includes('/prospects/search')).length,0);assert.match(d.getElementById('prospectError').textContent,/Minimum price/);
 d.getElementById('prospectMaxPrice').value='1000000';await w.testStart();
 assert.deepEqual(requests.find(r=>r.path.includes('/prospects/search')).body.filters,{municipalities:['Richmond Hill','Vaughan'],districts:['W04','W05'],communities:['North Richvale','South Richvale','Maple'],dateFrom:'2026-08-01',dateTo:'2026-08-31',status:'',minPrice:900000,maxPrice:1000000});assert.equal(d.getElementById('prospectScanFilters').disabled,false);
 assert.equal(d.getElementById('prospectsView').hidden,false);assert.equal(d.getElementById('listView').hidden,true);assert.equal(d.querySelectorAll('#prospectRows tr').length,1);assert.equal(d.querySelector('#prospectRows img'),null);assert.equal(d.getElementById('prospectExport').disabled,false);
 assert.equal(d.querySelectorAll('[data-community-remove]').length,3);d.querySelector('[data-community-remove=\"1\"]').click();assert.equal(d.querySelectorAll('[data-community-remove]').length,2);d.querySelector('[data-prospect-days=\"30\"]').click();assert.equal(d.getElementById('prospectDateTo').value,torontoDay());d.getElementById('prospectResetFilters').click();assert.equal(d.querySelectorAll('#prospectScanFilters input:checked').length,0);assert.equal(d.querySelectorAll('[data-community-remove]').length,0);assert.equal(d.getElementById('prospectDateFrom').value,'2026-09-01');
 d.getElementById('signOut').click();assert.equal(d.querySelectorAll('#prospectRows tr').length,0);assert.equal(d.getElementById('workspace').hidden,true);dom.window.close();
});
