// Query the requested neighbourhood/office and price criteria at the MLS source.
// The caller still applies active status, residential type and display permissions.
const BASE='https://query.ampre.ca/odata/Property';
const quote=value=>String(value).replace(/'/g,"''");
export const searchText=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function brokerageMatches(value,requested){
  const actual=searchText(value),wanted=searchText(requested).replace(/\b(realty|inc|incorporated|brokerage|ltd|limited)\b/g,'').trim();
  return !wanted||wanted.split(/\s+/).every(word=>actual.split(' ').includes(word));
}
const districtAreas={annex:'Annex','the annex':'Annex','south richvale':'South Richvale','north richvale':'North Richvale'};
export function canonicalArea(value){const clean=String(value||'').trim();return districtAreas[clean.toLowerCase()]||clean.replace(/^the\s+/i,'').replace(/\b\w/g,c=>c.toUpperCase());}
export function listingFilter(o,types){
  const filters=[`contains(City,'${quote(o.city)}')`,"StandardStatus eq 'Active'","TransactionType eq 'For Sale'"];
  if(o.area)filters.push(`(contains(tolower(CityRegion),'${quote(canonicalArea(o.area).toLowerCase())}') or contains(tolower(City),'${quote(o.area.toLowerCase())}'))`);
  if(o.brokerage)for(const token of searchText(o.brokerage).split(' ').filter(t=>!['realty','inc','brokerage','ltd'].includes(t)))filters.push(`contains(tolower(ListOfficeName),'${quote(token)}')`);
  if(types?.length)filters.push('('+types.map(t=>`PropertySubType eq '${quote(t)}'`).join(' or ')+')');
  if(o.minPrice||o.mode==='luxury')filters.push(`ListPrice ge ${Math.max(o.minPrice||0,o.mode==='luxury'?2000000:0)}`);
  if(o.maxPrice)filters.push(`ListPrice le ${o.maxPrice}`);
  if(o.minBeds)filters.push(`BedroomsAboveGrade ge ${o.minBeds}`);
  if(o.maxBeds)filters.push(`BedroomsAboveGrade le ${o.maxBeds}`);
  if(o.minBaths)filters.push(`BathroomsTotalInteger ge ${o.minBaths}`);
  if(o.minParking)filters.push(`ParkingTotal ge ${o.minParking}`);
  if(o.mode==='new')filters.push(`OriginalEntryTimestamp ge ${new Date(Date.now()-8*86400000).toISOString()}`);
  if(o.mode==='reduced')filters.push('OriginalListPrice gt ListPrice');
  return filters.join(' and ');
}
const inflight=new Map();
export async function queryListingInventory(options,types,origin,env,ctx,read){
  const filter=listingFilter(options,types),order=options.sort==='price_asc'?'ListPrice asc,ListingKey desc':options.sort==='price_desc'?'ListPrice desc,ListingKey desc':options.sort==='beds_desc'?'BedroomsAboveGrade desc,ListingKey desc':'OriginalEntryTimestamp desc,ListingKey desc';
  const cache=typeof caches!=='undefined'?caches.default:null,key=new Request(new URL('/internal-idx-query/v1?'+new URLSearchParams({filter,order}),origin));
  const hit=await cache?.match(key);if(hit)return hit.json();
  if(inflight.has(key.url))return inflight.get(key.url);
  const task=(async()=>{
    async function page(expression,sort,skip=0,count=false){
      const u=new URL(BASE);u.search=new URLSearchParams({'$filter':expression,'$top':'100','$skip':String(skip),...(count?{'$count':'true'}:{}),...(sort?{'$orderby':sort}:{})}).toString();
      const r=await read(u.href.replace(/\+/g,'%20'),env);
      if(!r.ok){const e=Error('MLS query could not be completed');e.status=r.status;throw e;}
      const d=await r.json();if(!Array.isArray(d.value))throw Error('Invalid MLS response');return d;
    }
    let first,sort=order,scope=filter,method='filtered';
    try{first=await page(scope,sort,0,true);}catch(e){
      if(![400,422,501].includes(e.status))throw e;
      sort='';try{first=await page(scope,sort,0,true);}catch(inner){if(![400,422,501].includes(inner.status))throw inner;}
    }
    // Some licensed feeds support only simple string scopes. Scope these requests
    // to the named area/office, never the last 500 rows of an entire city.
    if(!first||(!first.value.length&&(options.area||options.brokerage))){
      const area=canonicalArea(options.area);
      const office=searchText(options.brokerage).split(' ').filter(t=>!['century','realty','brokerage','inc','ltd'].includes(t)).sort((a,b)=>b.length-a.length)[0];
      scope=area?`contains(CityRegion,'${quote(area)}')`:office?`contains(ListOfficeName,'${quote(office.toUpperCase())}')`:`contains(City,'${quote(options.city)}')`;
      sort='';method='scoped';first=await page(scope,sort,0,true);
    }
    const count=Number(first['@odata.count']);
    if(!Number.isSafeInteger(count)||count<0)throw Error('MLS result count unavailable');
    const cap=method==='filtered'?200:1000,offsets=[];
    for(let offset=100;offset<Math.min(count,cap);offset+=100)offsets.push(offset);
    // If a simple scope is capped, include the opposite end as well. Its offset
    // is not described as date order; all dates and statuses are checked locally.
    if(method==='scoped'&&count>cap){for(let i=offsets.length/2|0;i<offsets.length;i++)offsets[i]=Math.max(100,count-(offsets.length-i)*100);}
    const batches=await Promise.all(offsets.map(offset=>page(scope,sort,offset)));
    const rows=[...new Map([first,...batches].flatMap(d=>d.value).map(r=>[r.ListingKey,r])).values()];
    const data={rows,skipped:Math.max(0,count-rows.length),partial:rows.length<count,checkedAt:new Date().toISOString(),method};
    if(cache&&ctx?.waitUntil)ctx.waitUntil(cache.put(key,new Response(JSON.stringify(data),{headers:{'Cache-Control':'max-age=120','Content-Type':'application/json'}})));
    return data;
  })();
  inflight.set(key.url,task);try{return await task;}finally{inflight.delete(key.url);}
}
