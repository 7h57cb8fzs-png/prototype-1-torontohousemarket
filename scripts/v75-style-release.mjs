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
console.log(JSON.stringify({stage:'baseline',version:prior,source:priorHash}));
if(process.env.EXPECTED_ACTIVE_VERSION)assert.equal(prior,process.env.EXPECTED_ACTIVE_VERSION,'Production version changed after review');
assert(process.env.EXPECTED_ACTIVE_VERSION, 'Reviewed production version is required');
if(process.env.EXPECTED_ACTIVE_SHA)assert.equal(priorHash,process.env.EXPECTED_ACTIVE_SHA,'Production source changed after review');
try {const settings=await cf('/workers/account-settings');console.log(JSON.stringify({stage:'workers-plan',default_usage_model:settings.default_usage_model,usage_model:settings.usage_model}));}catch(e){console.log(JSON.stringify({stage:'workers-plan',verified:false,reason:e.message}));}
console.log(JSON.stringify({stage:'worker-plan',usage_model:before.resources?.script?.usage_model||before.usage_model||null}));
let candidate=process.env.CANDIDATE_VERSION_ID,preview;
if(!candidate){
  const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;
  config.vars=Object.fromEntries(before.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_RELEASE='7.4';config.vars.PUBLIC_DISCOVERY_ENABLED='true';
  writeFileSync('wrangler.v74.json',JSON.stringify(config));
  let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.v74.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Preview upload failed; CLI output withheld to protect configuration.');}
  candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing preview identity');
}else{assert.equal(priorHash,process.env.EXPECTED_ACTIVE_SHA,'Production changed after preview');preview=`https://${candidate.slice(0,8)}-${worker}.7h57cb8fzs.workers.dev`;}
const after=await version(candidate);
// This release intentionally updates the two email renderers and their type styles.
// Scope is checked against the accepted commit before upload; promotion pins the reviewed preview hash.
if(process.env.EXPECTED_CANDIDATE_SHA)assert.equal(source(after),process.env.EXPECTED_CANDIDATE_SHA,'Email presentation source differs from reviewed preview');
else assert.notEqual(process.env.PUBLISH,'true','Promotion requires the reviewed candidate source hash');assert.deepEqual(names(after),names(before),'Binding names/types changed');
for(const b of before.bindings.filter(b=>b.type==='plain_text'&&!['THM_RELEASE','PUBLIC_DISCOVERY_ENABLED'].includes(b.name)))assert(after.bindings.some(n=>n.name===b.name&&n.text===b.text),'Existing setting changed');
async function verify(base){
 const ver=await fetch(base+'/api/version').then(r=>r.json());assert.equal(ver.version,'version-7.4-history-search-20260918');
 for(const file of ['index.html','app.js','styles.css','seller.html','seller.js','seller.css','address-input.js','admin.js','admin.html','admin.css','select-controls.js','interface.css','showing.html','address-search.html']){const r=await fetch(base+'/'+(file==='index.html'?'':file)+'?v74='+process.env.GITHUB_SHA);assert(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(readFileSync(file)),'Asset mismatch: '+file);}
 const addressResponse=await fetch(base+'/api/property?validate_only=1&q='+encodeURIComponent('8 Olympic Garden Drive Unit S3504, Toronto'));
 const addressData=await addressResponse.json();assert(addressResponse.ok&&addressData.ok&&addressData.unit==='s3504','Alphanumeric unit validation failed');
 console.log(JSON.stringify({stage:'address-check',address:addressData.normalizedAddress,unit:addressData.unit}));
 for(const listingKey of ['C13813214','W13812424','N13813276','N13813238']) {
  const r=await fetch(base+'/api/property?listingKey='+listingKey,{signal:AbortSignal.timeout(45000)});
  if(!r.ok||!r.headers.get('Content-Type')?.includes('application/json')){const body=await r.text();const code=body.match(/(?:Error|error code:)\s*(\d{3,5})/i)?.[1]||'unknown';throw Error('Listing response failed: '+listingKey+' HTTP '+r.status+' provider error '+code);}
  const d=await r.json();assert(d.ok&&d.property?.listingKey===listingKey,'Listing check failed: '+listingKey);
  const photos=d.property.photos||[];assert.equal(d.property.photoCount,photos.length);
  assert.equal(new Set(photos.map(p=>p.key)).size,photos.length,'Duplicate photo identity');
  console.log(JSON.stringify({stage:'photo-check',listingKey,address:d.property.address,count:photos.length,first:photos.slice(0,5).map(p=>({key:p.key,sequence:p.sequence,primary:p.primary}))}));
  if(listingKey==='W13812424') {
   const comparisonResponse=await fetch(base+'/api/price-check?listingKey='+listingKey,{signal:AbortSignal.timeout(45000)});
   const comparison=await comparisonResponse.json();
   assert(comparisonResponse.ok&&comparison.ok&&comparison.listingKey===listingKey,'Studio comparison request failed');
   assert.equal(comparison.subjectSize,'0–499 sq ft','Studio size band was rejected');
   assert(comparison.coverage?.scanned>0,'Studio comparison did not search inventory');
   console.log(JSON.stringify({stage:'studio-comparison',listingKey,size:comparison.subjectSize,coverage:comparison.coverage,count:comparison.count,related:comparison.relatedMatches?.length,reason:comparison.reason}));
  }
 }
 console.log(JSON.stringify({stage:'verified',url:base,assets:14,listings:4,addressChecks:1}));
}
await verify(preview);assert.equal(await active(),prior,'Production changed while preparing preview');
console.log(JSON.stringify({stage:'candidate',candidate,preview,prior,priorHash,candidateHash:source(after)}));
console.log('::notice title=Verified interface candidate::'+JSON.stringify({candidate,preview,prior,priorHash,candidateHash:source(after)}));
if(process.env.PUBLISH!=='true')process.exit(0);
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 let propagated=false;for(let attempt=0;attempt<15;attempt++){const v=await fetch('https://torontohousemarket.com/api/version?deployment='+candidate,{cache:'no-store'}).then(r=>r.json());if(v.version==='version-7.4-history-search-20260918'){propagated=true;break;}await new Promise(resolve=>setTimeout(resolve,2000));}assert(propagated,'Worker deployment did not propagate');
 let verificationError;for(let attempt=0;attempt<15;attempt++){try{await verify('https://torontohousemarket.com');verificationError=null;break;}catch(error){verificationError=error;if(attempt<14)await new Promise(resolve=>setTimeout(resolve,2000));}}if(verificationError)throw verificationError;
 assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');
 console.log(JSON.stringify({stage:'published',version:candidate,rollback:prior,source:source(after)}));
}catch(e){await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:prior,percentage:100}]});throw e;}
