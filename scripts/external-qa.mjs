import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,publicEncrypt,createCipheriv} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function cf(p){const r=await fetch(root+p,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(30000)});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed '+r.status);return d.result;}
const active=async()=>{const d=await cf('/workers/scripts/'+worker+'/deployments');assert.equal(d.deployments[0].versions.length,1);assert.equal(d.deployments[0].versions[0].percentage,100);return d.deployments[0].versions[0].version_id;};
const before=await active();assert.equal(before,process.env.EXPECTED_ACTIVE_VERSION);
const version=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');assert.equal(version.modules.length,1);assert.equal(hash(Buffer.from(version.modules[0].content_base64,'base64')),process.env.EXPECTED_ACTIVE_SHA);
const schedules=await cf('/workers/scripts/'+worker+'/schedules');
const plain=Object.fromEntries(version.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
const nonce=randomBytes(32).toString('hex');console.log('::add-mask::'+nonce);
function upload(dir,qa){
  const c=JSON.parse(fs.readFileSync(path.join(dir,'wrangler.jsonc'),'utf8'));delete c.secrets;c.vars={...plain};
  if(qa){delete c.assets;delete c.triggers;c.main='scripts/external-qa-worker.js';c.vars.THM_LOOKUP_QA_NONCE=nonce;c.vars.THM_LOOKUP_QA_EXPIRES=String(Date.now()+1200000);}
  const config=path.join(dir,'wrangler.lookup-external-'+(qa?'qa':'candidate')+'.json');fs.writeFileSync(config,JSON.stringify(c));
  let out;try{out=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',config],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20e6});}catch(e){throw Error('Unpublished upload failed: '+e.status+'; private configuration output withheld');}
  const id=out.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],url=out.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(id&&url);return {id,url};
}
const candidate=upload(process.cwd(),false);
const cv=await cf('/workers/workers/'+worker+'/versions/'+candidate.id+'?include=modules');
const bindings=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();assert.deepEqual(bindings(cv),bindings(version));
for(const [k,v] of Object.entries(plain))assert(cv.bindings.some(b=>b.name===k&&b.type==='plain_text'&&b.text===v));
candidate.hash=hash(Buffer.from(cv.modules[0].content_base64,'base64'));
const baselineDir=path.join(process.env.RUNNER_TEMP,'thm-external-baseline');
execFileSync('git',['worktree','add','--detach',baselineDir,'444a5595d57db6291b038885e665a9862a60b46b'],{stdio:'pipe'});
fs.copyFileSync('scripts/external-qa-worker.js',path.join(baselineDir,'scripts/external-qa-worker.js'));
const baseline=upload(baselineDir,true),after=upload(process.cwd(),true);
const normalize=s=>String(s||'').toLowerCase().replace(/\b(avenue|drive|road|street|court|lane|boulevard|crescent)\b/g,m=>({avenue:'ave',drive:'dr',road:'rd',street:'st',court:'ct',lane:'ln',boulevard:'blvd',crescent:'cres'}[m])).replace(/[^a-z0-9]/g,'');
const priorNormalize=s=>String(s||'').toLowerCase().replace(/\b(avenue|drive|road|street|court|lane)\b/g,m=>({avenue:'ave',drive:'dr',road:'rd',street:'st',court:'ct',lane:'ln'}[m])).replace(/[^a-z0-9]/g,'');
const prior=new Set(JSON.parse(fs.readFileSync('scripts/lookup-qa-exclusions.json','utf8'))),oldMls=new Set();
const excluded=a=>prior.has(hash(normalize(a)))||prior.has(hash(priorNormalize(a)));
const exclude=a=>{if(a){prior.add(hash(normalize(a)));prior.add(hash(priorNormalize(a)));}};
function inspect(v){if(Array.isArray(v))return v.forEach(inspect);if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(/address|property_input/i.test(k)&&typeof x==='string')exclude(x);if(/mls|listingKey/i.test(k)&&typeof x==='string')oldMls.add(x);inspect(x);}if(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v))prior.add(v);}
for(const dir of ['tests','scripts'])for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json')))inspect(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
for(const a of ['29 Stonedene Boulevard, Toronto','1469 Venta Avenue, Mississauga','4 Alma Court, Richmond Hill','60 Disera Drive Unit 1404, Vaughan','8 The Esplanade Unit 5403, Toronto'])exclude(a);
async function get(endpoint){const r=await fetch(after.url+endpoint,{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(60000)});assert(r.ok,'Catalog/exclusion HTTP '+r.status);return r.json();}
for(const a of (await get('/prior')).addresses)exclude(a);
const seed=randomBytes(32).toString('hex'),cases=[];
for(const mode of ['seller','buyer']){
  const pools=[];
  for(let city=0;city<7;city++)pools.push((await get('/catalog?city='+city+'&mode='+mode)).rows.filter(c=>!excluded(c.address)&&!oldMls.has(c.listingKey)).sort((a,b)=>hash(seed+a.listingKey).localeCompare(hash(seed+b.listingKey))));
  let n=0;
  for(let round=0;n<10&&round<100;round++)for(const pool of pools){
    const c=pool.shift();if(!c||excluded(c.address))continue;
    exclude(c.address);cases.push({...c,id:mode+'-'+(++n),skipArchive:true});if(n===10)break;
  }
  assert.equal(n,10,'Not enough new random '+mode+' listings');
}
console.log('RANDOM_SELECTION',JSON.stringify({seller:10,buyer:10,priorExclusions:prior.size,oldMlsExclusions:oldMls.size,newAddressesOnly:true,seed}));
function summary(d){const r=d?.report;return {ok:!!r,error:d?.error||null,available:r?.valuation?.available===true,comps:r?.comparables?.length||0,matched:r?.seller?.evidence?.subjectMatched,external:r?.external_research?{attempted:r.external_research.attempted,status:r.external_research.status,reason:r.external_research.reason,candidates:r.external_research.candidates.length,verified:r.external_research.verified_count,searches:r.external_research.search_calls}:null,seconds:Math.round((d?.telemetry?.processing_ms||0)/1000),ai:d?.telemetry?.ai_usage?.map(x=>({purpose:x.purpose,http:x.http_status,model:x.model,usage:x.usage}))||[]};}
async function run(adapter,c){const r=await fetch(adapter.url+'/run',{method:'POST',headers:{Authorization:'Bearer '+nonce,'Content-Type':'application/json'},body:JSON.stringify(c),signal:AbortSignal.timeout(120000)});assert(r.ok,'QA HTTP '+r.status);return r.json();}
const results=[];
const queue=[...cases];
async function compare(){while(queue.length){const c=queue.shift();
  const [old,updated]=await Promise.all([run(baseline,c),run(after,c)]);
  results.push({case:c,before:old,after:updated});
  console.log('EXTERNAL_QA_CASE',JSON.stringify({id:c.id,before:summary(old),after:summary(updated)}));
}}
await Promise.all([compare(),compare()]);
const data={candidate,results,sourceCommit:process.env.GITHUB_SHA};
const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);
console.log('EXTERNAL_QA_PRIVATE',JSON.stringify({key:publicEncrypt({key:fs.readFileSync('scripts/external-qa-public.pem'),oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));
assert.equal(await active(),before);assert.deepEqual(await cf('/workers/scripts/'+worker+'/schedules'),schedules);
assert(results.every(x=>x.after.report&&!x.after.error),'A report failed; inspect private results');
assert.equal(results.length,20);
const ext=results.filter(x=>x.after.report.external_research);
console.log('FALLBACK_COVERAGE',JSON.stringify({reportsWithFallback:ext.length,actualSearches:ext.filter(x=>x.after.report.external_research.search_calls>0).length}));
console.log('NEW_TEST_EXCLUSIONS',JSON.stringify(cases.map(c=>hash(normalize(c.address)))));
console.log('EXTERNAL_QA_FINISHED',JSON.stringify({candidate,cases:cases.length,reportExecutions:cases.length*2,productionUnchanged:true,emailsSent:0}));
