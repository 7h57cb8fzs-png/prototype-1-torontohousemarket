import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');
assert.equal(before,'ba600012-6f10-49d9-8c13-475194e963af');
// Isolated, never-promoted preview. The credential stays inside its existing Worker binding.
// A dedicated short-lived key protects metadata-only inspection; it cannot access listing rows.
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-schema-'));
const source=String.raw`export default {async fetch(request,env){
if(new URL(request.url).pathname!=='/schema'||request.headers.get('Authorization')!=='Bearer '+env.THM_SCHEMA_KEY)return new Response('Not found',{status:404});
const r=await fetch('https://query.ampre.ca/odata/$metadata',{headers:{Authorization:'Bearer '+env.AMPRE_VOW_TOKEN},signal:AbortSignal.timeout(15000)});
const xml=await r.text(),entity=xml.match(/<EntityType\b[^>]*Name="Property"[\s\S]*?<\/EntityType>/)?.[0]||'';
const fields=[...entity.matchAll(/<Property\b[^>]*Name="([^"]+)"[^>]*Type="([^"]+)"/g)].filter(m=>/Occup|Status|Expir|Terminat|Cancel|OffMarket|ListingContract|OnMarket|OriginalEntry|Street|UnitNumber|City|County|Parcel|Transaction|PropertyType/i.test(m[1])).map(m=>[m[1],m[2]]);
const probes=[];
for(const filter of ["((MlsStatus eq 'Expired' or MlsStatus eq 'EXP') and ExpirationDate ge 2026-09-01) or ((MlsStatus eq 'Terminated' or MlsStatus eq 'TER') and TerminatedDate ge 2026-09-01)","OccupantType eq 'Owner'"]){
 const q=await fetch('https://query.ampre.ca/odata/Property?'+new URLSearchParams({'$filter':filter,'$top':'1','$count':'true','$orderby':'ListingKey'}).toString().replaceAll('+','%20'),{headers:{Authorization:'Bearer '+env.AMPRE_VOW_TOKEN},signal:AbortSignal.timeout(10000)});const b=await q.json().catch(()=>({}));
 probes.push({querySupported:q.ok,http:q.status,hasContinuation:!!b['@odata.nextLink'],hasCount:Number.isInteger(b['@odata.count']),returnedRecord:Array.isArray(b.value)&&b.value.length>0,fieldNames:Object.keys(b.value?.[0]||{}).filter(k=>/Occupant|MlsStatus|Date|City|Type/.test(k))});
}
const lookups={};for(const field of ['MlsStatus','OccupantType','PropertyType','TransactionType']){
 const q=await fetch('https://query.ampre.ca/odata/Lookup?'+new URLSearchParams({'$filter':"LookupName eq '"+field+"'",'$top':'100'}).toString().replaceAll('+','%20'),{headers:{Authorization:'Bearer '+env.AMPRE_VOW_TOKEN},signal:AbortSignal.timeout(10000)});const b=await q.json().catch(()=>({}));lookups[field]=q.ok?(b.value||[]).map(x=>({value:x.LookupValue,name:x.StandardLookupValue})):q.status;
}
return Response.json({status:r.status,fields,probes,lookups},{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'schema.js'),source,{mode:0o600});
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'schema.js');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_SCHEMA_KEY=nonce;
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Schema preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/schema',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(100000)});assert(r.ok,'Schema preview unavailable');
console.log('FIELD_SCHEMA',JSON.stringify(await r.json()));assert.equal(await active(),before);console.log('Production unchanged; no listing records requested or exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
