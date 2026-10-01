import assert from 'node:assert/strict';
assert(process.env.AMPRE_VOW_TOKEN,'Licensed VOW credential unavailable in this runner');
const base='https://query.ampre.ca/odata/';
async function get(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+process.env.AMPRE_VOW_TOKEN},signal:AbortSignal.timeout(30000)});return {r,text:await r.text()};}
const meta=await get('$metadata');
console.log('metadata HTTP',meta.r.status);
const entity=meta.text.match(/<EntityType\b[^>]*Name="Property"[\s\S]*?<\/EntityType>/)?.[0]||'';
console.log('relevant fields', [...entity.matchAll(/<Property\b[^>]*Name="([^"]+)"[^>]*Type="([^"]+)"/g)].filter(m=>/Occup|Status|Expir|Terminat|Cancel|OffMarket|ListingContract|OnMarket|OriginalEntry|Street|UnitNumber|City|County|Parcel|Transaction|PropertyType/i.test(m[1])).map(m=>[m[1],m[2]]));
assert(meta.r.ok,'Metadata request failed');
