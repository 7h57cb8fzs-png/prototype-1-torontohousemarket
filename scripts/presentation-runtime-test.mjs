import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');assert.equal(before,'83bbb9ba-6777-484d-b7f0-c2e4889a9c4b');
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-postgrid-probe-'));
// A never-promoted, expiring read-only MLS test. No PostGrid, database, email or AI writes.
const source=String.raw`import {adminProspects} from './admin-prospects-api.mjs';
import {adminPostgrid} from './admin-postgrid-api.mjs';
export default {async fetch(request,env){
if(request.method!=='POST'||!['/test','/routing'].includes(new URL(request.url).pathname)||request.headers.get('Authorization')!=='Bearer '+env.THM_POSTGRID_PROBE||Date.now()>Number(env.THM_POSTGRID_PROBE_EXPIRY))return new Response('Not found',{status:404});
if(new URL(request.url).pathname==='/routing'){
 const {base}=await request.json();
 if(base!=='https://torontohousemarket.com'&&!/^https:\/\/[a-f0-9]{8}-prototype-1-torontohousemarket\.7h57cb8fzs\.workers\.dev$/.test(base))return new Response('Invalid target',{status:400});
 const checks=await Promise.all(['freehold','condo','commercial','invalid-class'].map(async propertyClass=>{
  const response=await fetch(base+'/api/admin/prospects/search',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({filters:{propertyClass}}),redirect:'manual',signal:AbortSignal.timeout(60000)});
  const data=await response.json();return {propertyClass,http:response.status,appliedClass:data.filters?.propertyClass||null,count:data.candidates?.length||0,matchingClass:(data.candidates||[]).every(row=>row.propertyClass===propertyClass)};
 }));
 return Response.json({ok:checks.every(c=>c.propertyClass==='invalid-class'?c.http===400:c.http===200&&c.appliedClass===c.propertyClass&&c.matchingClass),checks});
}
const req=(action,body={})=>new Request('https://internal.invalid/api/admin/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
const classChecks=await Promise.all(['freehold','condo','commercial'].map(async propertyClass=>{const r=await adminProspects(req('prospects/search',{filters:{propertyClass}}),env),d=await r.json();return {propertyClass,http:r.status,count:d.candidates?.length,matchingClass:(d.candidates||[]).every(c=>c.propertyClass===propertyClass),error:d.error};}));
const search=await adminProspects(req('prospects/search'),env),data=await search.json();const attempts=[];
for(const c of (data.candidates||[]).slice(0,10)){
 const r=await adminProspects(req('prospects/verify',{proof:c.proof}),env),d=await r.json();if(d.result!=='qualified')continue;
 const response=await adminPostgrid(req('postgrid/presentation',{reviewProof:d.reviewProof}),env),report=await response.json();
 if(!response.ok){attempts.push({http:response.status,error:report.error});if(attempts.length>=3)break;continue;}
 const photos=report.sales.map(s=>({present:!!s.photoData,encodedLength:s.photoData?.length||0}));
 return Response.json({ok:true,classChecks,sales:report.sales.length,matchingListing:report.listingKey===d.listingKey,qrPrefillsCorrectAddress:new URL(report.sellerUrl).searchParams.get('address')===report.fullAddress,photos,attempts});
}
return Response.json({ok:false,classChecks,candidates:data.candidates?.length||0,attempts,error:data.error});
}};`;
try{
writeFileSync(join(temp,'probe.mjs'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js'));writeFileSync(join(temp,'admin-postgrid-api.mjs'),readFileSync('admin-postgrid-api.js','utf8').replace("'./admin-prospects-api.js'","'./admin-prospects-api.mjs'"));
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'probe.mjs');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_POSTGRID_PROBE=nonce;config.vars.THM_POSTGRID_PROBE_EXPIRY=String(Date.now()+600000);
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});let output;
try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Test preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
writeFileSync('/tmp/thm-route-probe.json',JSON.stringify({url:preview,nonce}),{mode:0o600});
const diagnostic=await fetch(preview+'/routing',{method:'POST',headers:{Authorization:'Bearer '+nonce,'Content-Type':'application/json'},body:JSON.stringify({base:'https://torontohousemarket.com'}),signal:AbortSignal.timeout(120000)});assert(diagnostic.ok,'Live route diagnostic unavailable');console.log('PRODUCTION_CLASS_DIAGNOSTIC',JSON.stringify(await diagnostic.json()));
const r=await fetch(preview+'/test',{method:'POST',headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(240000)});assert(r.ok,'Test preview unavailable');const result=await r.json();console.log('PRESENTATION_RUNTIME_TEST',JSON.stringify(result));
assert.equal(result.classChecks?.length,3);assert(result.classChecks.every(c=>c.http===200&&c.matchingClass),'Live class search failed');
assert.equal(result.ok,true,'No report generated from the live read-only feed');assert.equal(result.matchingListing,true);assert.equal(result.qrPrefillsCorrectAddress,true);assert.equal(result.sales,3);assert(result.photos.every(p=>p.present),'Live sold images were unavailable');
assert.equal(await active(),before);console.log('Production unchanged. No physical mail; no credentials or listing records exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
