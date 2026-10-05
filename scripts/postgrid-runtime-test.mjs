import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');assert.equal(before,'991fc107-c4aa-4604-8e93-6ef7e5b7032b');
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-postgrid-probe-'));
// A never-promoted, ten-minute test harness. All credentials remain in Worker bindings.
// Only synthetic recipient data is submitted to PostGrid, using its test key.
const source=String.raw`import {adminProspects} from './admin-prospects-api.mjs';
import {adminPostgrid} from './admin-postgrid-api.mjs';
export default {async fetch(request,env){
if(request.method!=='POST'||new URL(request.url).pathname!=='/test'||request.headers.get('Authorization')!=='Bearer '+env.THM_POSTGRID_PROBE||Date.now()>Number(env.THM_POSTGRID_PROBE_EXPIRY))return new Response('Not found',{status:404});
const req=(action,body={})=>new Request('https://internal.invalid/api/admin/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
const check=await adminPostgrid(req('postgrid/status'),env),connection=await check.json();
if(!check.ok)return Response.json({connected:false,error:connection.error});
const search=await adminProspects(req('prospects/search'),env),data=await search.json();let qualified;
for(const c of (data.candidates||[]).slice(0,12)){const r=await adminProspects(req('prospects/verify',{proof:c.proof}),env),d=await r.json();if(d.result==='qualified'){qualified=d;break;}}
if(!qualified)return Response.json({connected:true,qualifiedAvailable:false});
const s=await adminPostgrid(req('postgrid/subject',{reviewProof:qualified.reviewProof}),env),subject=await s.json();if(!s.ok)return Response.json({connected:true,subjectSucceeded:false,error:subject.error});
// Minimal valid one-page letter-size PDF with proper byte offsets and xref.
let pdf='%PDF-1.4\n',offsets=[0];const stream='BT /F1 18 Tf 72 700 Td (THM - TEST ONLY - DO NOT MAIL) Tj ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
const contact={companyName:'THM Synthetic Integration Test',addressLine1:'123 Test Street',city:'Toronto',provinceOrState:'ON',postalOrZip:'M5V 2T6'};
const body={mode:'test',confirmed:true,reviewProof:subject.reviewProof,to:contact,from:contact,pdfName:'THM-test-only.pdf',pdfBase64:btoa(pdf),color:false,doubleSided:false};
const created=await adminPostgrid(req('postgrid/create',body),env),order=await created.json();if(!created.ok)return Response.json({connected:true,subjectSucceeded:true,created:false,error:order.error});
const repeated=await adminPostgrid(req('postgrid/create',body),env),duplicate=await repeated.json();
const refreshed=await adminPostgrid(req('postgrid/refresh',{id:order.order.id}),env),updated=await refreshed.json();
return Response.json({connected:true,subjectSucceeded:true,created:true,testOnly:order.order.mode==='test',postgridId:order.order.postgridId,duplicateBlocked:duplicate.duplicate===true&&duplicate.order.id===order.order.id,refreshSucceeded:refreshed.ok,previewAvailable:!!updated.order?.previewUrl},{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'probe.mjs'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js'));writeFileSync(join(temp,'admin-postgrid-api.mjs'),readFileSync('admin-postgrid-api.js','utf8').replace("'./admin-prospects-api.js'","'./admin-prospects-api.mjs'"));
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'probe.mjs');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_POSTGRID_PROBE=nonce;config.vars.THM_POSTGRID_PROBE_EXPIRY=String(Date.now()+600000);
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});let output;
try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Test preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/test',{method:'POST',headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(240000)});assert(r.ok,'Test preview unavailable');const result=await r.json();console.log('POSTGRID_RUNTIME_TEST',JSON.stringify(result));
for(const key of ['connected','subjectSucceeded','created','testOnly','duplicateBlocked','refreshSucceeded'])assert.equal(result[key],true,'Runtime check failed: '+key);
assert.equal(await active(),before);console.log('Production unchanged. No physical mail; no credentials or listing records exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
