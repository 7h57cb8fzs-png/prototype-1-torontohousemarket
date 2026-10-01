// Private, read-only MLS research. No client, lead, report, email or scheduled side effects.
const BASE='https://query.ampre.ca/odata/';
export const SINCE='2026-09-01';
const encoder=new TextEncoder();
const YCities=new Set(['aurora','east gwillimbury','georgina','king','markham','newmarket','richmond hill','vaughan','whitchurch stouffville']);
const DISTRICTS=[...Array.from({length:10},(_,i)=>'W'+String(i+1).padStart(2,'0')),...Array.from({length:15},(_,i)=>'C'+String(i+1).padStart(2,'0')).filter(v=>v!=='C05'),...Array.from({length:11},(_,i)=>'E'+String(i+1).padStart(2,'0'))];
const MUNICIPALITIES=['Toronto','Aurora','East Gwillimbury','Georgina','King','Markham','Newmarket','Richmond Hill','Vaughan','Whitchurch-Stouffville'];
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
class Unavailable extends Error {constructor(message,status=422){super(message);this.status=status;}}
export function torontoDay(value=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function day(value){
 if(!value)return null;const s=String(value);if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)||!Number.isFinite(Date.parse(s)))return null;
 if(s.length===10)return new Date(s).toISOString().slice(0,10)===s?s:null;
 return torontoDay(s);
}
export function region(row){const c=norm(row.City);if(/^toronto(?: [cew]\d{1,2})?$/.test(c)||['north york','scarborough','etobicoke','east york','york'].includes(c))return 'Toronto';if(YCities.has(c))return 'York';return null;}
export function endEvent(row){
 const m=norm(row.MlsStatus),s=norm(row.StandardStatus);
 if(['expired','exp'].includes(m)||(!m&&s==='expired'))return {status:'Expired',date:day(row.ExpirationDate),field:'ExpirationDate'};
 if(['terminated','ter'].includes(m)){
  for(const field of ['TerminationDate','TerminatedDate','CancellationDate'])if(day(row[field]))return {status:'Terminated',date:day(row[field]),field};
  return {status:'Terminated',date:null,field:null};
 }
 return null; // Cancelled/withdrawn alone must not be silently relabelled terminated.
}
const owner=row=>['owner','owner occupied','owneroccupied'].includes(norm(row.OccupantType));
const unit=v=>norm(v).replace(/^(?:unit|suite|apt|apartment) /,'').replace(/^0+(?=\d)/,'');
const street=v=>norm(v).split(' ').map(x=>({street:'st',avenue:'ave',road:'rd',boulevard:'blvd',drive:'dr',court:'crt',circle:'circ',crescent:'cres',lane:'ln',place:'pl',terrace:'terr',parkway:'pkwy',highway:'hwy',north:'n',south:'s',east:'e',west:'w'})[x]||x).join(' ');
export function identity(row){
 const number=norm(row.StreetNumber),name=street(row.StreetName),r=region(row),city=r==='Toronto'?'toronto':norm(row.City),u=unit(row.UnitNumber);
 if(!number||!name||!r)return null;
 if(/condo|apartment/i.test(clean(row.PropertyType)+' '+clean(row.PropertySubType))&&!u)return null;
 const road=street([row.StreetName,row.StreetSuffix,row.StreetDirPrefix,row.StreetDirSuffix].filter(Boolean).join(' '));
 return [city,number,road,u].join('|');
}
export function classifyCandidate(row,today=torontoDay(),window={dateFrom:SINCE,dateTo:today}){
 const event=endEvent(row);
 if(!event)return {eligible:false,reason:'Other listing status'};
 if(!event.date)return {eligible:false,reason:'Missing expiry / termination date'};
 if(event.date<window.dateFrom||event.date>window.dateTo||event.date>today)return {eligible:false,reason:'Outside date window'};
 if(!region(row))return {eligible:false,reason:'Outside Toronto / York'};
 if(!owner(row))return {eligible:false,reason:'Owner occupancy not explicitly recorded'};
 if(!/^for sale$|^sale$/i.test(clean(row.TransactionType)))return {eligible:false,reason:'Not a sale listing'};
 if(!/^residential(?: freehold| condo(?: & other)?| income| condominium)?$/i.test(clean(row.PropertyType)))return {eligible:false,reason:'Not a residential listing'};
 if(!identity(row))return {eligible:false,reason:'Property / unit identity incomplete'};
 return {eligible:true,event};
}
function summary(row,event=endEvent(row)){
 const address=[row.StreetNumber,row.StreetName,row.StreetSuffix,row.StreetDirPrefix,row.StreetDirSuffix].filter(Boolean).join(' ');
 return {listingKey:clean(row.ListingKey),address:address+(clean(row.UnitNumber)?' #'+clean(row.UnitNumber):''),city:clean(row.City),community:clean(row.CityRegion),region:region(row),status:event?.status,eventDate:event?.date,eventField:event?.field,occupancy:clean(row.OccupantType),propertyType:clean(row.PropertySubType||row.PropertyType),askingPrice:Number(row.ListPrice)>0?Number(row.ListPrice):null};
}
const SELECT='ListingKey,MlsStatus,StandardStatus,ExpirationDate,TerminatedDate,OccupantType,TransactionType,PropertyType,PropertySubType,StreetNumber,StreetName,StreetSuffix,StreetDirPrefix,StreetDirSuffix,UnitNumber,City,CityRegion,PostalCode,ListPrice,ListingContractDate,OriginalEntryTimestamp,BackOnMarketEntryTimestamp,ParcelNumber';
const KEEP=['ListingKey','MlsStatus','StandardStatus','ExpirationDate','TerminationDate','TerminatedDate','CancellationDate','OccupantType','TransactionType','PropertyType','PropertySubType','StreetNumber','StreetName','StreetSuffix','StreetDirPrefix','StreetDirSuffix','UnitNumber','City','CityRegion','PostalCode','ListPrice','ListingContractDate','OnMarketDate','OriginalEntryTimestamp','BackOnMarketEntryTimestamp','ParcelNumber'];
const compact=row=>Object.fromEntries(KEEP.filter(k=>row[k]!=null).map(k=>[k,row[k]]));
async function hmac(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function seal(data,env){const p=b64(encoder.encode(JSON.stringify({...data,expires:Date.now()+3600000}))),s=await crypto.subtle.sign('HMAC',await hmac(env.ADMIN_API_KEY),encoder.encode(p));return p+'.'+b64(new Uint8Array(s));}
async function unseal(value,kind,env){try{if(typeof value!=='string'||value.length>30000)throw Error();const [p,s]=value.split('.');if(!await crypto.subtle.verify('HMAC',await hmac(env.ADMIN_API_KEY),unb64(s),encoder.encode(p)))throw Error();const data=JSON.parse(new TextDecoder().decode(unb64(p)));if(data.kind!==kind||data.expires<Date.now())throw Error();return data;}catch{throw new Unavailable('This search expired. Start a fresh search.',400);}}
function trusted(value){const u=new URL(value,BASE);if(!['query.ampre.ca','webapi-green-gcp.ampre.ca'].includes(u.hostname)||!['https:','http:'].includes(u.protocol)||u.port||!/^\/odata\/Property\/?$/i.test(u.pathname)||u.username||u.password||u.hash)throw new Unavailable('The provider returned an invalid continuation link. Search is incomplete.');u.protocol='https:';u.hostname='query.ampre.ca';return u.href;}
async function feed(env,url,text=false){
 let r;try{r=await fetch(url.replaceAll('+','%20'),{headers:{Authorization:'Bearer '+env.AMPRE_VOW_TOKEN,Accept:text?'application/xml':'application/json'},redirect:'manual',signal:AbortSignal.timeout(45000)});}catch{throw new Unavailable((text?'MLS field-definition request':'MLS listing-page request')+' could not finish. No absence or relisting conclusion was made.',502);}
 if(!r.ok){await r.body?.cancel();throw new Unavailable(r.status===401||r.status===403?'The connected MLS credential does not grant this search.':'The MLS feed could not complete this query (HTTP '+r.status+'). Results are incomplete.',502);}
 // Bounded provider pages; never return raw provider responses or errors to the browser/logs.
 const reader=r.body.getReader();let size=0,parts=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6000000){await reader.cancel();throw new Unavailable('MLS response exceeded the safe page size. Search is incomplete.');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}const content=new TextDecoder().decode(bytes);
 if(text)return content;try{return JSON.parse(content);}catch{throw new Unavailable('MLS response was invalid. Search is incomplete.',502);}
}
async function schema(env){
 const xml=await feed(env,BASE+'$metadata',true),entity=xml.match(/<EntityType\b[^>]*Name="Property"[\s\S]*?<\/EntityType>/)?.[0]||'';
 const fields=new Map([...entity.matchAll(/<Property\b[^>]*Name="([^"]+)"[^>]*Type="([^"]+)"/g)].map(m=>[m[1],m[2]]));
 const required=['ListingKey','MlsStatus','ExpirationDate','OccupantType','StreetName','City'];
 const missing=required.filter(f=>!fields.has(f));
 const termination=['TerminationDate','TerminatedDate','CancellationDate'].find(f=>fields.has(f));if(!termination)missing.push('Termination / cancellation date');
 if(missing.length)throw new Unavailable('The connected feed cannot verify this search: missing '+missing.join(', ')+'. No qualified list can be produced.');
 return {fields,termination};
}
const quoted=v=>"'"+clean(v).replaceAll("'","''")+"'";
export function searchFilters(value={},today=torontoDay()){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Unavailable('Invalid scan filters.',400);
 const many=(input,legacy,max,label)=>{
  const list=input===undefined?(clean(legacy)?[legacy]:[]):input;
  if(!Array.isArray(list)||list.length>max||list.some(v=>typeof v!=='string'))throw new Unavailable('Invalid '+label+' selections.',400);
  return [...new Map(list.map(v=>{const name=clean(v).replace(/\s+/g,' ');return [norm(name),name];}).filter(([,v])=>v)).values()];
 };
 const municipalities=many(value.municipalities,value.municipality,10,'municipality'),districts=many(value.districts,null,35,'district').map(v=>v.toUpperCase()),communities=many(value.communities,value.community,40,'community');
 if(municipalities.some(v=>!MUNICIPALITIES.includes(v)))throw new Unavailable('Choose municipalities in Toronto or York.',400);
 if(districts.some(v=>!DISTRICTS.includes(v)))throw new Unavailable('Choose valid Toronto MLS districts.',400);
 if(communities.some(v=>v.length>120||/[\x00-\x1f\x7f]/.test(v)))throw new Unavailable('Enter valid MLS community names.',400);
 const date=(v,fallback)=>{const d=v===undefined?fallback:clean(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||day(d)!==d||d<'1900-01-01'||d>today)throw new Unavailable('Choose valid dates from 1900 through today.',400);return d;};
 const dateFrom=date(value.dateFrom,SINCE),dateTo=date(value.dateTo,today);
 if(dateFrom>dateTo)throw new Unavailable('The start date must not be after the end date.',400);
 const status=clean(value.status);if(!['','Expired','Terminated'].includes(status))throw new Unavailable('Choose Expired, Terminated or both statuses.',400);
 const price=(value,label)=>{if(value==null||value==='')return null;const n=typeof value==='number'?value:typeof value==='string'&&/^\d+(?:\.\d{1,2})?$/.test(value.trim())?Number(value):NaN;if(!Number.isFinite(n)||n<0||n>1e10)throw new Unavailable('Enter a valid '+label+' asking price.',400);return n;};
 const minPrice=price(value.minPrice,'minimum'),maxPrice=price(value.maxPrice,'maximum');
 if(minPrice!==null&&maxPrice!==null&&minPrice>maxPrice)throw new Unavailable('Minimum price must not exceed maximum price.',400);
 return {municipalities,districts,communities,dateFrom,dateTo,status,minPrice,maxPrice};
}
export function matchesFilters(row,filters){
 const inMunicipality=filters.municipalities.some(v=>v==='Toronto'?region(row)==='Toronto':norm(row.City)===norm(v));
 const inDistrict=filters.districts.some(v=>norm(row.City)===norm('Toronto '+v));
 if((filters.municipalities.length||filters.districts.length)&&!inMunicipality&&!inDistrict)return false;
 if(filters.communities.length&&!filters.communities.some(v=>norm(row.CityRegion)===norm(v)))return false;
 if(filters.status&&endEvent(row)?.status!==filters.status)return false;
 if(filters.minPrice!==null||filters.maxPrice!==null){const n=Number(row.ListPrice);if(!Number.isFinite(n)||n<=0||filters.minPrice!==null&&n<filters.minPrice||filters.maxPrice!==null&&n>filters.maxPrice)return false;}
 return true;
}
export function dateBounds(field,type,from,to){
 if(type==='Edm.Date')return `${field} ge ${from} and ${field} le ${to}`;
 // Broad UTC edges followed by exact Toronto-day checks avoid DST omissions.
 const next=new Date(to+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+2);
 return `${field} ge ${from}T00:00:00Z and ${field} lt ${next.toISOString()}`;
}
async function communityOptions(env){
 // Lookup vocabulary only: loading choices never scans property listings.
 let url=BASE+'Lookup?'+new URLSearchParams({'$filter':"LookupName eq 'CityRegion'",'$top':'1000'});const names=new Set(),links=new Set();
 for(let i=0;url&&i<30;i++){
  const u=new URL(url,BASE);if(!['query.ampre.ca','webapi-green-gcp.ampre.ca'].includes(u.hostname)||!/^\/odata\/Lookup\/?$/i.test(u.pathname)||!['https:','http:'].includes(u.protocol)||u.port||u.username||u.password||u.hash)throw new Unavailable('Community choices are unavailable. You can enter an MLS community name.');u.protocol='https:';u.hostname='query.ampre.ca';
  if(links.has(u.href))throw new Unavailable('Community choices are incomplete. You can enter an MLS community name.');links.add(u.href);
  const data=await feed(env,u.href);for(const row of pageData(data)){const name=clean(row.LookupValue);if(name&&name.length<=120)names.add(name);}
  url=data['@odata.nextLink']||null;
 }
 if(url)throw new Unavailable('Community choices are incomplete. You can enter an MLS community name.');
 return {ok:true,communities:[...names].sort((a,b)=>a.localeCompare(b))};
}
async function firstPage(env,filters){
 const {fields,termination}=await schema(env);
 const ranges=field=>dateBounds(field,fields.get(field),filters.dateFrom,filters.dateTo);
 const expired=`((MlsStatus eq 'Expired' or MlsStatus eq 'EXP') and ${ranges('ExpirationDate')})`,terminated=`((MlsStatus eq 'Terminated' or MlsStatus eq 'TER') and ${ranges(termination)})`;
 const filter=filters.status==='Expired'?expired:filters.status==='Terminated'?terminated:`${expired} or ${terminated}`;
 // Municipalities and districts are a union; communities narrow that union.
 const toronto=['Toronto','North York','Scarborough','Etobicoke','East York','York'];
 const municipalities=filters.municipalities.length||filters.districts.length?filters.municipalities:MUNICIPALITIES;
 const selected=[...new Set(municipalities.flatMap(v=>v==='Toronto'?toronto:[v==='Whitchurch-Stouffville'?'Whitchurch':v]))];
 const areas=[...selected.map(city=>`contains(City,${quoted(city)})`),...filters.districts.map(d=>`City eq ${quoted('Toronto '+d)}`)];
 const scope=areas.join(' or ');
 const extra=[];
 if(filters.communities.length)extra.push('('+filters.communities.map(v=>`tolower(CityRegion) eq ${quoted(v.toLowerCase())}`).join(' or ')+')');
 if(filters.minPrice!==null)extra.push(`ListPrice ge ${filters.minPrice}`);
 if(filters.maxPrice!==null)extra.push(`ListPrice le ${filters.maxPrice}`);
 return BASE+'Property?'+new URLSearchParams({'$filter':`(${filter}) and OccupantType eq 'Owner' and TransactionType eq 'For Sale' and (${scope})${extra.length?' and '+extra.join(' and '):''}`,'$top':'100','$count':'true','$orderby':'ListingKey','$select':SELECT});
}
function pageData(b){if(!Array.isArray(b.value))throw new Unavailable('MLS search returned an invalid page.');if(b.value.length>1000)throw new Unavailable('MLS returned more records than requested.');return b.value;}
export function evaluateHistory(subject,rows,complete,today=torontoDay()){
 const id=identity(subject),event=endEvent(subject);let missing=false,seen=false;
 for(const r of rows){
  const sameParcel=clean(subject.ParcelNumber)&&clean(subject.ParcelNumber)===clean(r.ParcelNumber)&&unit(subject.UnitNumber)===unit(r.UnitNumber);
  if(identity(r)!==id&&!sameParcel){
   // Similar but incomplete addresses must not become a false clean-history result.
   if(norm(r.StreetNumber)===norm(subject.StreetNumber)&&region(r)===region(subject)&&
    street(r.StreetName)===street(subject.StreetName)&&
    (!unit(r.UnitNumber)||!unit(subject.UnitNumber)||unit(r.UnitNumber)===unit(subject.UnitNumber)))missing=true;
   continue;
  }
  if(clean(r.ListingKey)===clean(subject.ListingKey)){
   seen=true;const e=endEvent(r);
   if(!e||e.status!==event?.status||e.date!==event?.date||!owner(r))return {result:'excluded',reason:'Listing status or occupancy changed'};
   if(day(r.OnMarketDate)>event.date||day(r.BackOnMarketEntryTimestamp)>=event.date)return {result:'excluded',reason:'Same MLS listing returned to market after its end date'};
   continue;
  }
  const dates=['ListingContractDate','OnMarketDate','OriginalEntryTimestamp','BackOnMarketEntryTimestamp'].map(f=>day(r[f])).filter(Boolean);
  const active=/^(active|new|back on market|deal fell through|extension|price change|sold conditional|sold conditional escape|leased conditional|leased conditional escape|active under contract|pending|sc|sce|pc|ext)$/i.test(clean(r.MlsStatus))||/^(active|active under contract|pending)$/i.test(clean(r.StandardStatus));
  if(active||dates.some(d=>d>=event.date&&d<=today))return {result:'excluded',reason:'Another listing found on or after the end date'};
  if(!dates.length)missing=true;
 }
 if(!complete||!seen||missing)return {result:'unverified',reason:!complete?'Property history is incomplete':!seen?'The original listing was absent from the history check':'A matching record has no listing date'};
 return {result:'qualified',reason:'No subsequent listing found in the connected MLS history'};
}
async function scan(body,env){
 const filters=body.cursor?null:searchFilters(body.filters);
 const state=body.cursor?await unseal(body.cursor,'scan',env):{url:await firstPage(env,filters),filters,seen:0,startedAt:new Date().toISOString()};
 const scope=searchFilters(state.filters);
 const b=await feed(env,trusted(state.url)),rows=pageData(b),candidates=[],excluded={};
 for(const row of rows){const c=classifyCandidate(row,torontoDay(),scope);if(!c.eligible){excluded[c.reason]=(excluded[c.reason]||0)+1;continue;}if(!matchesFilters(row,scope)){excluded['Outside selected scan filters']=(excluded['Outside selected scan filters']||0)+1;continue;}const data=compact(row);candidates.push({...summary(data,c.event),proof:await seal({kind:'candidate',row:data,filters:scope},env)});}
 const next=b['@odata.nextLink'];if(next&&trusted(next)===trusted(state.url))throw new Unavailable('The MLS feed repeated a page. Search is incomplete.');const seen=state.seen+rows.length,total=Number(b['@odata.count']);
 // A full page without a continuation cannot establish completeness unless count confirms the end.
 const complete=!next&&(Number.isFinite(total)?seen>=total:rows.length<100);
 return {ok:true,filters:scope,candidates,excluded,pageId:b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(state.url)))),scanned:seen,sourceTotal:Number.isFinite(total)?total:null,startedAt:state.startedAt,checkedAt:new Date().toISOString(),since:scope.dateFrom,through:scope.dateTo,historyThrough:torontoDay(),complete,cursor:next?await seal({kind:'scan',url:trusted(next),filters:scope,seen,startedAt:state.startedAt},env):null,incompleteReason:!next&&!complete?'The MLS feed ended without proving all pages were returned.':null};
}
async function verify(body,env){
 const {row,filters:selection}=await unseal(body.proof,'candidate',env),scope=searchFilters(selection),c=classifyCandidate(row,torontoDay(),scope);if(!c.eligible)return {ok:true,...summary(row),result:'excluded',reason:c.reason};
 // Full street queries, all statuses and transaction types, preserve condo units and catch aliases.
 const token=clean(row.StreetName).split(/\s+/).sort((a,b)=>b.length-a.length)[0];
 const variants=[...new Set([token,token.toUpperCase(),token.toLowerCase()])];
 const filters=variants.map(name=>`contains(StreetName,${quoted(name)}) and StreetNumber eq ${quoted(row.StreetNumber)}`);
 if(clean(row.ParcelNumber))filters.push(`ParcelNumber eq ${quoted(row.ParcelNumber)}`);
 const matches=[],seenKeys=new Set(),deadline=Date.now()+45000;let complete=true;
 for(const filter of filters){
  if(Date.now()>deadline){complete=false;break;}
  let url=BASE+'Property?'+new URLSearchParams({'$filter':filter,'$top':'100','$count':'true','$orderby':'ListingKey','$select':SELECT}),count=0;const links=new Set();
  for(let p=0;url&&p<8;p++){
   if(Date.now()>deadline){complete=false;break;}
   if(links.has(url)){complete=false;break;}links.add(url);
   const b=await feed(env,trusted(url)),rows=pageData(b);count+=rows.length;
   for(const r of rows)if(!seenKeys.has(r.ListingKey)){seenKeys.add(r.ListingKey);matches.push(compact(r));}
   const outcome=evaluateHistory(row,matches,false);if(outcome.result==='excluded')return {ok:true,...summary(row),...outcome,checkedAt:new Date().toISOString()};
   const next=b['@odata.nextLink'];if(!next){const total=Number(b['@odata.count']);if(Number.isFinite(total)?count<total:rows.length>=100)complete=false;url=null;}else url=trusted(next);
  }
  if(url)complete=false;
 }
 return {ok:true,...summary(row),...evaluateHistory(row,matches,complete),checkedAt:new Date().toISOString(),coverage:'Connected MLS records only. Owner occupancy is the listing declaration; current occupancy requires confirmation.'};
}
export async function adminProspects(request,env){
 const key=clean(env.ADMIN_API_KEY),actual=request.headers.get('Authorization')||'';
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(actual))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('Bearer '+key)));let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];
 if(!key||delta)return json({ok:false,error:'Your admin key is missing or incorrect.'},401);
 if(request.method!=='POST')return json({ok:false,error:'Use the admin search form.'},405);
 if(!env.AMPRE_VOW_TOKEN)return json({ok:false,error:'The licensed MLS history connection is not configured.'},503);
 try{
  const text=await request.text();if(text.length>35000)throw new Unavailable('Request is too large.',413);let body;try{body=JSON.parse(text)}catch{throw new Unavailable('Invalid request.',400);}
  const path=new URL(request.url).pathname;
  if(path==='/api/admin/prospects/options')return json(await communityOptions(env));
  if(path==='/api/admin/prospects/search')return json(await scan(body,env));
  if(path==='/api/admin/prospects/verify')return json(await verify(body,env));
  return json({ok:false,error:'Unknown admin search action.'},404);
 }catch(error){return json({ok:false,error:error instanceof Unavailable?error.message:'The listing check could not finish. No qualified result was recorded.'},error instanceof Unavailable?error.status:502);}
}
