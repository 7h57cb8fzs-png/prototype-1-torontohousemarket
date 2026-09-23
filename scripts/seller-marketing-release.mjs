import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket';
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function cf(path,method='GET',body){const r=await fetch(root+path,{method,headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();assert(r.ok&&d.success,`Cloudflare ${r.status}: ${d.errors?.map(x=>x.code).join(',')}`);return d.result;}
async function active(){const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);return d.deployments[0].versions[0].version_id;}
const version=id=>cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
const source=v=>hash(JSON.stringify(v.modules.map(m=>[m.name,hash(Buffer.from(m.content_base64,'base64'))]).sort()));
const names=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();
const prior=await active(),before=await version(prior),priorHash=source(before),schedule=await cf(`/workers/scripts/${worker}/schedules`);
const adminKey=null;
if(adminKey)console.log('::add-mask::'+adminKey);
// A Cloudflare secret cannot be read back. Preserve it; never weaken authentication to test.

assert.equal(prior,process.env.EXPECTED_ACTIVE_VERSION,'Production version changed after review');
assert.equal(priorHash,process.env.EXPECTED_ACTIVE_SHA,'Production source changed after review');
console.log(JSON.stringify({stage:'baseline',version:prior,source:priorHash}));
const baseline='6a659c9adeb1f3d252120e019514b655d7030177';
for(const file of ['index.html','app.js','styles.css','seller.html','seller.js','seller.css','address-input.js','interface.css','showing.html','showing.js','form-inputs.js','select-controls.js','admin.html','admin-workspace.js','admin-workspace.css','admin-view-model.js']){
 const r=await fetch('https://torontohousemarket.com/'+(file==='index.html'?'':file),{signal:AbortSignal.timeout(20000)});
 assert(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(execFileSync('git',['show',baseline+':'+file],{maxBuffer:5e6})),'Production baseline asset changed: '+file);
}
let candidate=process.env.CANDIDATE_VERSION_ID,preview;
if(!candidate){
 const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;
 config.vars=Object.fromEntries(before.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 writeFileSync('wrangler.marketing.json',JSON.stringify(config));
 let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.marketing.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Preview upload failed; CLI output withheld to protect configuration.');}
 candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing preview identity');
}else preview=`https://${candidate.slice(0,8)}-${worker}.7h57cb8fzs.workers.dev`;
console.log(JSON.stringify({stage:'preview-ready',candidate,preview}));
const after=await version(candidate);
if(process.env.EXPECTED_CANDIDATE_SHA)assert.equal(source(after),process.env.EXPECTED_CANDIDATE_SHA,'Candidate source differs from reviewed preview');
else assert.notEqual(process.env.PUBLISH,'true','Promotion requires the reviewed candidate source hash');
assert.deepEqual(names(after),names(before),'Binding names/types changed');
for(const b of before.bindings.filter(b=>b.type==='plain_text'))assert(after.bindings.some(n=>n.name===b.name&&n.text===b.text),'Existing configuration changed');
async function get(base,path,auth=false){const r=await fetch(base+path,{headers:auth?{Authorization:'Bearer '+adminKey}:{},signal:AbortSignal.timeout(45000),cache:'no-store'});assert(r.ok,`GET ${path.split('?')[0]} returned ${r.status}`);return r.json();}
async function verify(base){
 const ver=await get(base,'/api/version');assert.equal(ver.version,'version-7.4-history-search-20260918');
 const assets=['index.html','app.js','styles.css','seller.html','seller.js','seller.css','address-input.js','interface.css','showing.html','showing.js','form-inputs.js','select-controls.js','admin.html','admin-workspace.js','admin-workspace.css','admin-view-model.js','marketing/THM-Selling-Plan-and-Fees-v1.pdf','marketing/thm-team-v1.png'];
 for(const file of assets){const r=await fetch(base+'/'+(file==='index.html'?'':file)+'?admin_release='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(20000)});assert(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(readFileSync(file)),'Asset mismatch: '+file);}
 assert.equal((await fetch(base+'/api/admin/ops/counts',{signal:AbortSignal.timeout(20000)})).status,401,'Admin API is publicly accessible');
 let counts,ready;
 if(adminKey){
 counts=await get(base,'/api/admin/ops/counts',true);
 assert.equal(counts.ok,true);assert(Number.isInteger(counts.active)&&Number.isInteger(counts.archived));
 const leads=await get(base,'/api/admin/ops/leads?size=25',true),jobs=await get(base,'/api/admin/ops/jobs?size=25&status=attention',true);
 assert.equal(leads.total,counts.active);assert(leads.leads.length<=25&&jobs.jobs.length<=25);
 assert(leads.leads.every(x=>x.archived_at===null));
 const archive=await get(base,'/api/admin/ops/leads?archive=1',true);assert.equal(archive.total,counts.archived);
 ready=leads.leads.find(x=>(Array.isArray(x.property_reports)?x.property_reports[0]:x.property_reports)?.status==='ready');
 if(ready){const detail=await get(base,'/api/admin/ops/leads/'+ready.id,true);assert.equal(detail.lead.id,ready.id);const saved=await get(base,'/api/admin/leads/'+ready.id+'/reports',true);assert(saved.current?.status==='ready');const copy=await get(base,'/api/admin/leads/'+ready.id+'/reports?copy=current',true);assert(copy.copy?.html?.includes('Toronto House Market'));assert(copy.copy.report);}
 }
 const invalid=await fetch(base+'/api/marketing/unsubscribe?token=invalid');assert.equal(invalid.status,400);
 const confirm=await fetch(base+'/api/marketing/unsubscribe?token=11111111-2222-4333-8444-555555555555');assert.equal(confirm.status,200);assert.match(await confirm.text(),/Unsubscribe from marketing/);
 const seller=readFileSync('seller.html','utf8');assert.match(seller,/<input id="sellerMarketingConsent" type="checkbox" aria-describedby="sellerMarketingFooter">/);
 console.log(JSON.stringify({stage:'verified',url:base,assets:assets.length,optionalOptIn:true,unsubscribeGet:true,adminAuthRequired:true,noLeadsOrEmailsCreated:true}));
}
await verify(preview);
assert.equal(await active(),prior,'Production changed while preparing preview');
console.log('::notice title=Verified seller marketing candidate::'+JSON.stringify({candidate,preview,prior,priorHash,candidateHash:source(after)}));
if(process.env.PUBLISH!=='true')process.exit(0);
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 let failure;for(let i=0;i<12;i++){try{await verify('https://torontohousemarket.com');failure=null;break;}catch(e){failure=e;if(i<11)await new Promise(resolve=>setTimeout(resolve,2000));}}if(failure)throw failure;
 assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');
 console.log(JSON.stringify({stage:'published',version:candidate,rollback:prior,source:source(after)}));
}catch(e){await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:prior,percentage:100}]});throw e;}
