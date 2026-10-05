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
// Connection, preparation, history and status checks; creates no orders.
// Exercises history deletion with a new random ID that matches no existing order.
const source=String.raw`import {adminProspects} from './admin-prospects-api.mjs';
import {adminPostgrid} from './admin-postgrid-api.mjs';
export default {async fetch(request,env){
if(request.method!=='POST'||new URL(request.url).pathname!=='/test'||request.headers.get('Authorization')!=='Bearer '+env.THM_POSTGRID_PROBE||Date.now()>Number(env.THM_POSTGRID_PROBE_EXPIRY))return new Response('Not found',{status:404});
const req=(action,body={})=>new Request('https://internal.invalid/api/admin/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
const check=await adminPostgrid(req('postgrid/status'),env),connection=await check.json();
if(!check.ok){
 const diagnostics={};
 for(const [name,url,headers]of [['storage',(env.SUPABASE_URL||'https://pwbtxyavjjotxtvegrqe.supabase.co')+'/rest/v1/admin_postgrid_orders?select=id&limit=1',{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}],['postgrid','https://api.postgrid.com/print-mail/v1/letters?limit=1',{'x-api-key':String(env.POSTGRID_TEST_API_KEY||'').trim()}]]){
  try{const r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});diagnostics[name]={status:r.status,contentType:r.headers.get('Content-Type')};try{await r.json();diagnostics[name].json=true;}catch{diagnostics[name].json=false;}}catch(e){diagnostics[name]={errorType:e.name};}
 }
 return Response.json({connected:false,error:connection.error,diagnostics});
}
const search=await adminProspects(req('prospects/search'),env),data=await search.json();let qualified;
for(const c of (data.candidates||[]).slice(0,12)){const r=await adminProspects(req('prospects/verify',{proof:c.proof}),env),d=await r.json();if(d.result==='qualified'){qualified=d;break;}}
if(!qualified)return Response.json({connected:true,qualifiedAvailable:false});
const s=await adminPostgrid(req('postgrid/subject',{reviewProof:qualified.reviewProof}),env),subject=await s.json();if(!s.ok)return Response.json({connected:true,subjectSucceeded:false,error:subject.error});
const historyResponse=await adminPostgrid(req('postgrid/history'),env),history=await historyResponse.json();
const order=(history.orders||[]).find(o=>o.postgridId);let refreshed=false;
if(order){const response=await adminPostgrid(req('postgrid/refresh',{id:order.id}),env);refreshed=response.ok;}
const deletion=await adminPostgrid(req('postgrid/delete',{confirmed:true,ids:[crypto.randomUUID()]}),env),deleted=await deletion.json();
return Response.json({connected:true,subjectSucceeded:true,recipientNameAvailable:!!subject.address?.firstName,historySucceeded:historyResponse.ok,deletionSucceeded:deletion.ok&&deleted.deletedIds?.length===0,recordDetailsAvailable:!!history.orders?.[0]?.sender,testOnly:(history.orders||[]).every(o=>o.mode==='test'),refreshSucceeded:!order||refreshed},{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'probe.mjs'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js'));writeFileSync(join(temp,'admin-postgrid-api.mjs'),readFileSync('admin-postgrid-api.js','utf8').replace("'./admin-prospects-api.js'","'./admin-prospects-api.mjs'"));
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'probe.mjs');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_POSTGRID_PROBE=nonce;config.vars.THM_POSTGRID_PROBE_EXPIRY=String(Date.now()+600000);
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});let output;
try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Test preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/test',{method:'POST',headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(240000)});assert(r.ok,'Test preview unavailable');const result=await r.json();console.log('POSTGRID_RUNTIME_TEST',JSON.stringify(result));
for(const key of ['connected','subjectSucceeded','historySucceeded','deletionSucceeded','recordDetailsAvailable','testOnly','refreshSucceeded'])assert.equal(result[key],true,'Runtime check failed: '+key);
assert.equal(await active(),before);console.log('Production unchanged. No physical mail; no credentials or listing records exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
