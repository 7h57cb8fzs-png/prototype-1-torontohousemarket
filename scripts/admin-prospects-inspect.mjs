import assert from 'node:assert/strict';
let token=process.env.AMPRE_VOW_TOKEN;
if(!token&&process.env.CLOUDFLARE_API_TOKEN){
 const root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
 const cf=async path=>{const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;};
 const deployments=await cf('/workers/scripts/prototype-1-torontohousemarket/deployments');
 const id=deployments.deployments[0].versions[0].version_id;
 const v=await cf('/workers/workers/prototype-1-torontohousemarket/versions/'+id+'?include=modules');
 console.log('current production version',id);
 console.log('credential binding types',v.bindings.filter(b=>['AMPRE_VOW_TOKEN','ADMIN_API_KEY'].includes(b.name)).map(b=>({name:b.name,type:b.type})));
 token=v.bindings.find(b=>b.name==='AMPRE_VOW_TOKEN'&&b.type==='plain_text')?.text;
}
assert(token,'MLS credential remains protected in Cloudflare; schema must be checked inside the Worker');
const base='https://query.ampre.ca/odata/';
async function get(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});return {r,text:await r.text()};}
const meta=await get('$metadata');
console.log('metadata HTTP',meta.r.status);
const entity=meta.text.match(/<EntityType\b[^>]*Name="Property"[\s\S]*?<\/EntityType>/)?.[0]||'';
console.log('relevant fields', [...entity.matchAll(/<Property\b[^>]*Name="([^"]+)"[^>]*Type="([^"]+)"/g)].filter(m=>/Occup|Status|Expir|Terminat|Cancel|OffMarket|ListingContract|OnMarket|OriginalEntry|Street|UnitNumber|City|County|Parcel|Transaction|PropertyType/i.test(m[1])).map(m=>[m[1],m[2]]));
assert(meta.r.ok,'Metadata request failed');
