import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{validateAddressEntry,addressFromPlace,selectExactAddressMatch} from '../worker-v11.js';
const context=vm.createContext({window:{}});
vm.runInContext(readFileSync(new URL('../address-input.js',import.meta.url),'utf8'),context);
const input=context.window.THMAddress;
const origin='https://torontohousemarket.com';
const token='00000000-0000-4000-8000-000000000000';
const request=(path,body)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({sessionToken:token,...body})});

test('street-only house and condo formats no longer require a city, including public preflight',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Preflight must not call a provider');});
 for(const address of ['203 Grandravine Dr','617 Lonsdale Rd','1405-9201 Yonge St','175 Bamburgh Circ 306','100 The Kingsway']){
  const response=await worker.fetch(new Request(origin+'/api/property?strict_address=1&validate_only=1&q='+encodeURIComponent(address)),{},{});
  assert.equal(response.status,200,address);const data=await response.json();assert.equal(data.city,'');assert.ok(data.normalizedAddress);
 }
 assert.equal(validateAddressEntry('9201 Yonge St1405').ok,false);
});

test('pasted condo formats produce the same exact address',()=>{
 for(const value of ['1405-9201 Yonge St, Richmond Hill','Unit 1405, 9201 Yonge St, Richmond Hill','9201 Yonge St Unit 1405 Richmond Hill','9201 Yonge St 1405 Richmond Hill']){
  const parts=input.split(value);assert.equal(parts.street,'9201 Yonge St, Richmond Hill',value);assert.equal(parts.unit,'1405');assert.equal(input.combine(value,''),'9201 Yonge St Unit 1405, Richmond Hill');
 }
 assert.equal(input.combine('175 Bamburgh Circ, Toronto','306'),'175 Bamburgh Circ Unit 306, Toronto');
 assert.equal(input.combine('2916 Highway 7, Vaughan','401'),'2916 Highway 7 Unit 401, Vaughan');
 assert.equal(input.combine('N12345678','401'),'N12345678');
 assert.equal(input.combine('https://example.com/property','401'),'https://example.com/property');
 assert.equal(input.split('203 Grandravine Dr').unit,'');
});

test('missing autocomplete credentials keep manual address entry available without external calls',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No configured API means no network or MLS call');});
 const response=await worker.fetch(request('/api/address-suggestions',{q:'203 grand'}),{},{});
 assert.equal(response.status,200);assert.equal((await response.json()).available,false);assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('suggestions use address-only Places requests with a session and no client-visible key',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(String(url),'https://places.googleapis.com/v1/places:autocomplete');const body=JSON.parse(options.body);assert.equal(body.sessionToken,token);assert.deepEqual(body.includedRegionCodes,['ca']);assert.ok(body.locationRestriction.rectangle);assert.deepEqual(body.includedPrimaryTypes,['street_address','premise','subpremise']);assert.equal(options.headers['X-Goog-Api-Key'],'fixture-secret');
  return Response.json({suggestions:[{placePrediction:{placeId:'fixture_address_id',text:{text:'123 Example Street, Toronto, ON, Canada'}}},{placePrediction:{placeId:'fixture_bad_id',text:{text:'Example Park, Toronto, ON, Canada'}}}]});
 });
 const response=await worker.fetch(request('/api/address-suggestions',{q:'123 exa'}),{GOOGLE_PLACES_API_KEY:'fixture-secret'},{});const body=await response.json();assert.equal(calls,1);assert.equal(body.suggestions.length,1);assert.ok(body.available);assert.ok(!JSON.stringify(body).includes('fixture-secret'));
});

const component=(type,longText,shortText=longText)=>({types:[type],longText,shortText});
const place={addressComponents:[component('street_number','123'),component('route','Example Street'),component('locality','North York'),component('administrative_area_level_1','Ontario','ON'),component('country','Canada','CA')]};
test('selection retrieves only address components and fills the municipality without guessing',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.ok(String(url).includes('/v1/places/fixture_address_id?'));assert.ok(String(url).includes('sessionToken='+token));assert.equal(options.headers['X-Goog-FieldMask'],'addressComponents');return Response.json(place);});
 const response=await worker.fetch(request('/api/address-selection',{placeId:'fixture_address_id'}),{GOOGLE_PLACES_API_KEY:'fixture-secret'},{});const data=await response.json();assert.equal(data.city,'Toronto');assert.equal(data.address,'123 Example Street, Toronto');assert.equal(data.unit,'');
 assert.equal(addressFromPlace({addressComponents:place.addressComponents.filter(c=>!c.types.includes('street_number'))}),null);
 assert.equal(addressFromPlace({addressComponents:place.addressComponents.map(c=>c.types.includes('country')?component('country','United States','US'):c)}),null);
});

test('provider failure, too-short queries and cross-site requests cannot turn into MLS lookups',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Provider unavailable');});
 const env={GOOGLE_PLACES_API_KEY:'fixture-secret'};
 let response=await worker.fetch(request('/api/address-suggestions',{q:'123 exa'}),env,{});assert.equal((await response.json()).available,false);assert.equal(calls,1);
 response=await worker.fetch(request('/api/address-suggestions',{q:'123 e'}),env,{});assert.equal((await response.json()).suggestions.length,0);assert.equal(calls,1);
 response=await worker.fetch(new Request(origin+'/api/address-suggestions',{method:'POST',headers:{Origin:'https://another.example'},body:'{}'}),env,{});assert.equal(response.status,403);assert.equal(calls,1);
});

test('an ambiguous address cannot select another city just because its listing is active',()=>{
 const rows=['Toronto C01','Richmond Hill'].map((City,i)=>({ListingKey:'DEMO'+i,City,StreetNumber:'123',StreetName:'Example',StreetSuffix:'Street',StandardStatus:'Active'}));
 const parsed=validateAddressEntry('123 Example Street').parsed;assert.deepEqual(selectExactAddressMatch(parsed,rows).ambiguousCities,['Toronto','Richmond Hill']);
 assert.equal(selectExactAddressMatch({...parsed,city:'Richmond Hill'},rows)?.City,'Richmond Hill');
});

// Event-level regressions for keyboard choice and delayed replies. Provider data is synthetic.
function addressHarness(fetcher){
 class Element extends EventTarget{
  constructor(id=''){super();this.id=id;this.value='';this.attributes={};this.children=[];this.hidden=true;this.required=false;this.message='';}
  setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];} removeAttribute(k){delete this.attributes[k];}
  setCustomValidity(v){this.message=v;} closest(){return this.row||this;} focus(){document.activeElement=this;} scrollIntoView(){} replaceChildren(){this.children=[];} append(el){this.children.push(el);} contains(el){return this===el||this.children.includes(el);}
 }
 const input=new Element('input'),panel=new Element('panel'),status=new Element('status'),list=new Element('options'),note=new Element('note'),credit=new Element('credit');
 panel.querySelector=selector=>selector==='[role=listbox]'?list:selector==='[role=status]'?note:credit;
 const document=new EventTarget();document.activeElement=input;document.createElement=()=>new Element();
 let next=0;const timers=new Map();
 const context=vm.createContext({window:{},document,crypto:{randomUUID:()=>token},AbortController,AbortSignal,fetch:fetcher,THMInputs:{error:(el,message)=>el.setAttribute('aria-invalid',String(!!message)),check:el=>!el.message},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(readFileSync(new URL('../address-input.js',import.meta.url),'utf8'),context);
 const control=context.window.THMAddress.attach({input,panel,status});
 const fire=(el,type,key)=>{const event=new Event(type,{cancelable:true});if(key)Object.defineProperty(event,'key',{value:key});el.dispatchEvent(event);return event;};
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 return {input,panel,list,control,fire,settle,async suggest(value){input.value=value;input.focus();fire(input,'input');for(const [id,t] of timers)if(t.ms===250){timers.delete(id);t.fn();}await settle();}};
}
const fakeSuggestion={ok:true,available:true,suggestions:[{placeId:'fixture_address_id',label:'123 Example Street, Toronto, ON, Canada'}]};
test('letter-prefixed condo unit survives suggestion selection and exact address validation',async()=>{
 const queries=[];
 const h=addressHarness(async(path,options)=>{
  if(path.endsWith('suggestions')){queries.push(JSON.parse(options.body).q);return Response.json({ok:true,available:true,suggestions:[{placeId:'fixture_olympic_id',label:'8 Olympic Garden Drive, North York, ON'}]});}
  return Response.json({ok:true,available:true,address:'8 Olympic Garden Drive, Toronto',city:'Toronto',unit:''});
 });
 await h.suggest('8 Olympic Garden Dr S3504');
 assert.deepEqual(queries,['8 Olympic Garden Dr']);
 h.fire(h.input,'keydown','ArrowDown');h.fire(h.input,'keydown','Enter');
 const address=await h.control.prepare();assert.equal(address,'8 Olympic Garden Drive Unit S3504, Toronto');
 const entry=validateAddressEntry(address);assert.equal(entry.ok,true);assert.equal(entry.parsed.unit,'s3504');
 const rows=['S3504','3504','N3504'].map((UnitNumber,i)=>({ListingKey:'FIXTURE'+i,City:'Toronto',StreetNumber:'8',StreetName:'Olympic Garden',StreetSuffix:'Drive',UnitNumber,StandardStatus:'Active'}));
 assert.equal(selectExactAddressMatch(entry.parsed,rows).UnitNumber,'S3504');
 h.input.value='150 Glen Cedar Rd';h.fire(h.input,'input');assert.equal(await h.control.prepare(),'150 Glen Cedar Rd');
});
test('keyboard selection fills city, retains the typed unit and does not auto-submit the report',async()=>{
 const h=addressHarness(async path=>Response.json(path.endsWith('suggestions')?fakeSuggestion:{ok:true,available:true,address:'123 Example Street, Toronto',city:'Toronto',unit:''}));
 await h.suggest('Unit 201, 123 Exa');assert.equal(h.panel.hidden,false);
 assert.equal(h.fire(h.input,'keydown','Enter').defaultPrevented,false,'Typing alone must not select the first address');
 h.fire(h.input,'keydown','ArrowDown');assert.equal(h.input.getAttribute('aria-activedescendant'),'options-0');
 assert.equal(h.fire(h.input,'keydown','Enter').defaultPrevented,true);assert.equal(await h.control.prepare(),'123 Example Street Unit 201, Toronto');assert.equal(h.panel.hidden,true);
 h.input.value='456 Different Road';h.fire(h.input,'input');assert.equal(await h.control.prepare(),'456 Different Road','A new home cannot inherit the previous condo unit');
});

test('editing an address discards a delayed place selection; Escape closes choices',async()=>{
 let release;
 const h=addressHarness(async path=>path.endsWith('suggestions')?Response.json(fakeSuggestion):new Promise(resolve=>{release=resolve;}));
 await h.suggest('123 Exa');h.fire(h.input,'keydown','Escape');assert.equal(h.panel.hidden,true);
 await h.suggest('123 Exam');h.fire(h.input,'keydown','ArrowDown');h.fire(h.input,'keydown','Enter');
 h.input.value='456 Different Road';h.fire(h.input,'input');release(Response.json({ok:true,available:true,address:'123 Example Street, Toronto'}));await h.settle();
 assert.equal(h.input.value,'456 Different Road');assert.equal(await h.control.prepare(),'456 Different Road');
});

test('failed place details cannot submit a partial address that the user tried to select',async()=>{
 const h=addressHarness(async path=>Response.json(path.endsWith('suggestions')?fakeSuggestion:{ok:true,available:false}));
 await h.suggest('123 Exa');h.fire(h.input,'keydown','ArrowDown');h.fire(h.input,'keydown','Enter');assert.equal(await h.control.prepare(),null);
 h.input.value='123 Example Street';h.fire(h.input,'input');assert.equal(await h.control.prepare(),'123 Example Street');
});

test('known city ambiguity stops MLS resolution and offers a choice without an invalid-format error',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({value:['Toronto C01','Richmond Hill'].map((City,i)=>({ListingKey:'DEMO'+i,City,StreetNumber:'123',StreetName:'Example',StreetSuffix:'Street',StandardStatus:'Active'}))});});
 const response=await worker.fetch(new Request(origin+'/api/property?q=123%20Example%20Street'),{AMPRE_TOKEN:'fixture-only'},{});
 assert.equal(response.status,409);const body=await response.json();assert.deepEqual(body.cityChoices,['Toronto','Richmond Hill']);assert.notEqual(body.inputError,true);assert.equal(calls,1,'Do not continue searching and silently pick a city');
});

test('a pasted condo remains in one box and replacing it leaves no hidden unit',async()=>{
 const h=addressHarness(async()=>Response.json({ok:true,available:false}));
 await h.suggest('201-123 Example Street');assert.equal(h.input.value,'201-123 Example Street');assert.equal(await h.control.prepare(),'123 Example Street Unit 201');
 h.input.value='456 Different Road';h.fire(h.input,'input');assert.equal(await h.control.prepare(),'456 Different Road');
});
