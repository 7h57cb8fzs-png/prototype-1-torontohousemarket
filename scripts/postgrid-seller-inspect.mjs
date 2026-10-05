import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');assert.equal(before,'22620825-0f31-4220-87a2-e8b3b97d8c14');
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-postgrid-probe-'));
// A never-promoted, ten-minute test harness. All credentials remain in Worker bindings.
// Read-only seller-field metadata and presence counts. No names or addresses are logged.
const source=String.raw`import {adminProspects} from './admin-prospects-api.mjs';
export default {async fetch(request,env){
if(request.method!=='POST'||new URL(request.url).pathname!=='/test'||request.headers.get('Authorization')!=='Bearer '+env.THM_POSTGRID_PROBE||Date.now()>Number(env.THM_POSTGRID_PROBE_EXPIRY))return new Response('Not found',{status:404});
const result={};
const base='https://query.ampre.ca/odata/';
for(const binding of ['AMPRE_VOW_TOKEN','AMPRE_TOKEN']){
 if(!env[binding])continue;
 const headers={Authorization:'Bearer '+env[binding]};
 let meta=await fetch(base+'$metadata',{headers,redirect:'manual'});if(meta.status>=500){await meta.body?.cancel();meta=await fetch(base+'$metadata',{headers,redirect:'manual'});}const xml=await meta.text();
 const block=xml.match(/<EntityType Name="Property"[^>]*>([\s\S]*?)<\/EntityType>/)?.[1]||'';
 const fields=[...block.matchAll(/<Property\b[^>]*\bName="([^"]+)"/g)].map(m=>m[1]).filter(n=>/seller|owner|vendor/i.test(n));
 result[binding]={http:meta.status,fields,nameFields:[...block.matchAll(/<Property\b[^>]*\bName="([^"]+)"/g)].map(m=>m[1]).filter(n=>/name/i.test(n)),relatedEntities:[...xml.matchAll(/<EntityType\b[^>]*\bName="([^"]+)"/g)].map(m=>m[1]).filter(n=>/seller|owner|party|contact/i.test(n))};
 if(!meta.ok)continue;
 const ownerTag=block.match(/<Property\b[^>]*\bName="OwnerName"[^>]*>/)?.[0]||'';
 result[binding].ownerFieldType=ownerTag.match(/\bType="([^"]+)"/)?.[1]||null;
 result[binding].targets=[];
 for(const key of ['N13642122','N13687590']){
  const target={};
  for(const [label,suffix]of [['full',''],['explicit','?$select=ListingKey,OwnerName']]){
   const response=await fetch(base+"Property('"+key+"')"+suffix,{headers,redirect:'manual',signal:AbortSignal.timeout(30000)});let item;try{item=await response.json();}catch{}
   target[label]={http:response.status,matchingListing:item?.ListingKey===key,ownerFieldPresent:item?Object.hasOwn(item,'OwnerName'):false,ownerValueType:item?.OwnerName===null?'null':Array.isArray(item?.OwnerName)?'array':typeof item?.OwnerName,nameLength:typeof item?.OwnerName==='string'?item.OwnerName.trim().length:null};
  }
  result[binding].targets.push(target);
 }


}
return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'probe.mjs'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js'));writeFileSync(join(temp,'admin-postgrid-api.mjs'),readFileSync('admin-postgrid-api.js','utf8').replace("'./admin-prospects-api.js'","'./admin-prospects-api.mjs'"));
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'probe.mjs');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_POSTGRID_PROBE=nonce;config.vars.THM_POSTGRID_PROBE_EXPIRY=String(Date.now()+600000);
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});let output;
try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Test preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/test',{method:'POST',headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(240000)});assert(r.ok,'Test preview unavailable');const result=await r.json();console.log('SELLER_FIELDS',JSON.stringify(result));
assert.equal(await active(),before);console.log('Production unchanged. No physical mail; no credentials or listing records exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
