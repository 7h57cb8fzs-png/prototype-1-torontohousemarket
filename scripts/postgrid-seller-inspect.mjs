import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');assert.equal(before,'9e9a9254-69c8-4d7b-8681-f81d02b37ab8');
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
 const meta=await fetch(base+'$metadata',{headers,redirect:'manual'});const xml=await meta.text();
 const block=xml.match(/<EntityType Name="Property"[^>]*>([\s\S]*?)<\/EntityType>/)?.[1]||'';
 const fields=[...block.matchAll(/<Property Name="([^"]+)"/g)].map(m=>m[1]).filter(n=>/seller|owner|vendor/i.test(n));
 result[binding]={http:meta.status,fields};
 if(!meta.ok)continue;
 const url=base+'Property?'+new URLSearchParams({'$top':'10','$filter':"(MlsStatus eq 'Expired' or MlsStatus eq 'Terminated') and OccupantType eq 'Owner'",'$orderby':'ModificationTimestamp desc'});
 const r=await fetch(url.replaceAll('+','%20'),{headers,redirect:'manual'});const data=await r.json();
 result[binding].sampleStatus=r.status;result[binding].sampleCount=data.value?.length||0;
 result[binding].populatedFields=fields.filter(n=>(data.value||[]).some(row=>typeof row[n]==='string'&&row[n].trim()));
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
