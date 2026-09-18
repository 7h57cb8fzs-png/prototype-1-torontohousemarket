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
const after=await version(candidate);assert.deepEqual(names(after),names(before),'Binding names/types changed');
for(const b of before.bindings.filter(b=>b.type==='plain_text'&&!['THM_RELEASE','PUBLIC_DISCOVERY_ENABLED'].includes(b.name)))assert(after.bindings.some(n=>n.name===b.name&&n.text===b.text),'Existing setting changed');
async function verify(base){
 const ver=await fetch(base+'/api/version').then(r=>r.json());assert.equal(ver.version,'version-7.4-history-search-20260918');
 for(const file of ['index.html','app.js','styles.css','seller.html','seller.js','seller.css','address-input.js','admin.js','select-controls.js']){const r=await fetch(base+'/'+(file==='index.html'?'':file)+'?v74='+process.env.GITHUB_SHA);assert(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(readFileSync(file)),'Asset mismatch: '+file);}
 const r=await fetch(base+'/api/home-search?city=Toronto&type=condo&mode=all&maxPrice=800000&minBeds=1',{signal:AbortSignal.timeout(45000)});const d=await r.json();assert(r.ok&&d.ok&&Array.isArray(d.listings),'Public search failed');assert(d.listings.every(x=>x.listPrice<=800000&&/Condo/.test(x.propertySubType)),'Search filter mismatch');
 console.log(JSON.stringify({stage:'verified',url:base,assets:9,searchResults:d.listings.length}));
}
await verify(preview);assert.equal(await active(),prior,'Production changed while preparing preview');
console.log(JSON.stringify({stage:'candidate',candidate,preview,prior,priorHash,candidateHash:source(after)}));
if(process.env.PUBLISH!=='true')process.exit(0);
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 await verify('https://torontohousemarket.com');assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');
 console.log(JSON.stringify({stage:'published',version:candidate,rollback:prior,source:source(after)}));
}catch(e){await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:prior,percentage:100}]});throw e;}
