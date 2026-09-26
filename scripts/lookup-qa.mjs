import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,publicEncrypt,createCipheriv} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',repo=process.cwd();
const base=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const hash=s=>createHash('sha256').update(s).digest('hex');
const out=path.join(repo,'qa-output');fs.mkdirSync(out,{recursive:true});
const round=process.env.QA_ROUND||'initial';
async function cf(p){const r=await fetch(base+p,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(30000)});const d=await r.json();assert(r.ok&&d.success,'Cloudflare check failed '+r.status);return d.result;}
const active=async()=>{const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);return d.deployments[0].versions[0].version_id;};
const before=await active();assert.equal(before,process.env.EXPECTED_ACTIVE_VERSION,'Production changed; reconcile first');
const version=await cf(`/workers/workers/${worker}/versions/${before}?include=modules`);
assert.equal(version.modules.length,1);assert.equal(hash(Buffer.from(version.modules[0].content_base64,'base64')),process.env.EXPECTED_ACTIVE_SHA);
const schedule=await cf(`/workers/scripts/${worker}/schedules`);
const plain=Object.fromEntries(version.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
function upload(dir,qa=false){
  const c=JSON.parse(fs.readFileSync(path.join(dir,'wrangler.jsonc'),'utf8'));delete c.secrets;c.vars={...plain};
  if(qa){delete c.assets;delete c.triggers;c.main='scripts/lookup-qa-worker.js';c.vars.THM_LOOKUP_QA_NONCE=nonce;c.vars.THM_LOOKUP_QA_EXPIRES=String(Date.now()+1000*60*40);c.compatibility_flags=[...new Set([...(c.compatibility_flags||[]),'global_fetch_strictly_public'])];}
  const config=path.join(dir,'wrangler.lookup-'+(qa?'qa':'candidate')+'.json');fs.writeFileSync(config,JSON.stringify(c));
  let stdout;try{stdout=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',config],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20e6});}catch(e){throw Error('Unpublished upload failed; private output withheld: '+String(e.status));}
  const id=stdout.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],url=stdout.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(id&&url);return {id,url};
}
const nonce=randomBytes(32).toString('hex');console.log('::add-mask::'+nonce);
const candidate=upload(repo);
const cv=await cf(`/workers/workers/${worker}/versions/${candidate.id}?include=modules`);
const bindings=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();assert.deepEqual(bindings(cv),bindings(version));
const candidateHash=hash(Buffer.from(cv.modules[0].content_base64,'base64'));
const baselineDir=path.join(process.env.RUNNER_TEMP||'/tmp','thm-lookup-baseline');
execFileSync('git',['worktree','add','--detach',baselineDir,'3eba2ef9597e9840f0a39df81ac728236f855499'],{stdio:'pipe'});
fs.copyFileSync('scripts/lookup-qa-worker.js',path.join(baselineDir,'scripts/lookup-qa-worker.js'));
fs.appendFileSync(path.join(baselineDir,'worker-v22.js'),'\nexport {coreEnv};\n');
const baselineAdapter=upload(baselineDir,true),candidateAdapter=upload(repo,true);
async function call(adapter,endpoint,data){const r=await fetch(adapter.url+endpoint,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+nonce,...data?{'Content-Type':'application/json'}:{}},...data?{body:JSON.stringify(data)}:{},signal:AbortSignal.timeout(120000)});const d=await r.json();assert(r.ok,'QA request failed: '+r.status+' '+String(d.error||''));return d;}
const baseline=await call(candidateAdapter,'/baseline');assert.equal(baseline.reports.length,13);
console.log('QUERY_CAPABILITIES',JSON.stringify(await call(candidateAdapter,'/probe')));
const norm=s=>String(s||'').toLowerCase().replace(/\b(avenue|drive|road|street|court|lane)\b/g,m=>({avenue:'ave',drive:'dr',road:'rd',street:'st',court:'ct',lane:'ln'}[m])).replace(/[^a-z0-9]/g,'');
const prior=fs.existsSync('scripts/lookup-qa-exclusions.json')?JSON.parse(fs.readFileSync('scripts/lookup-qa-exclusions.json','utf8')):[];
const excluded=new Set([...baseline.excluded,...baseline.reports.map(r=>r.report_payload.facts?.address)].map(a=>hash(norm(a))));for(const h of prior)excluded.add(h);
const oldMls=new Set();
const inspect=value=>{if(Array.isArray(value))return value.forEach(inspect);if(value&&typeof value==='object'){for(const [key,v] of Object.entries(value)){if(/address/i.test(key)&&typeof v==='string')excluded.add(hash(norm(v)));if(/listingKey|mls/i.test(key)&&typeof v==='string'&&/^[A-Z]\d{7,9}$/.test(v))oldMls.add(v);inspect(v);}}};
for(const f of fs.readdirSync('tests').filter(f=>f.endsWith('.json')))inspect(JSON.parse(fs.readFileSync('tests/'+f,'utf8')));
const randomSeed=randomBytes(16).toString('hex');
const wanted=round==='buyer_retry'?{seller:0,buyer:0}:round==='initial'?{seller:20,buyer:0}:round==='mixed'?{seller:10,buyer:10}:{seller:5,buyer:5};
const cases=round==='initial'?baseline.reports.map((r,i)=>({id:'recent-'+(i+1),mode:'seller',address:r.report_payload.facts.address,originalReportId:r.id,group:'recent'})):[];
const catalogAll=[];
if(round==='buyer_retry'){
  for(let city=0;city<7;city++)catalogAll.push(...(await call(candidateAdapter,'/catalog?city='+city+'&mode=buyer')).rows);
  for(const target of JSON.parse(fs.readFileSync('scripts/lookup-qa-retry.json','utf8'))){const c=catalogAll.find(c=>hash(norm(c.address))===target.hash);assert(c,'Exact prior Buyer retry case missing');cases.push({...c,id:target.id,lookup:target.lookup,group:'buyer_retry'});}
  assert.equal(cases.length,10);
}
for(const mode of ['seller','buyer']){
  if(!wanted[mode])continue;
  const pools=[];
  for(let city=0;city<7;city++){
    const catalog=await call(candidateAdapter,'/catalog?city='+city+'&mode='+mode);
    catalogAll.push(...catalog.rows);
    pools.push(catalog.rows.filter(c=>!excluded.has(hash(norm(c.address)))&&!oldMls.has(c.listingKey)).sort((a,b)=>hash(randomSeed+a.listingKey).localeCompare(hash(randomSeed+b.listingKey))));
  }
  let n=0,pass=0;
  while(n<wanted[mode]&&pass<100){for(const pool of pools){const c=pool.shift();if(!c||excluded.has(hash(norm(c.address))))continue;excluded.add(hash(norm(c.address)));cases.push({...c,id:round+'-'+mode+'-'+(++n),group:round});if(n>=wanted[mode])break;}pass++;}
  assert.equal(n,wanted[mode],'Not enough distinct untested '+mode+' addresses');
}
for(const [i,c] of cases.filter(c=>c.mode==='buyer').entries())c.lookup=i%2===0?'address':'mls';
if(round==='mixed'){
  for(const i of [1,4])cases.push({id:'repair-recent-'+(i+1),group:'repair',mode:'seller',address:baseline.reports[i].report_payload.facts.address});
  for(const h of JSON.parse(fs.readFileSync('scripts/lookup-qa-rechecks.json','utf8'))){const c=catalogAll.find(c=>c.mode==='seller'&&hash(norm(c.address))===h);assert(c,'Previously sampled repair case not recovered');cases.push({...c,id:'repair-'+h.slice(0,8),group:'repair'});}
}
const detail={round,sourceCommit:process.env.GITHUB_SHA,candidate:{...candidate,hash:candidateHash},rollback:before,seed:randomSeed,baselineReports:baseline.reports,cases,results:[]};
function save(){const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(JSON.stringify(detail)),cipher.final()]);const encrypted={key:publicEncrypt({key:fs.readFileSync('scripts/lookup-qa-public.pem'),oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};fs.writeFileSync(path.join(out,'private-results.enc.json'),JSON.stringify(encrypted));}
function summary(d={}){const r=d.report,c=r?.comparables||[],v=r?.valuation;return {ok:!!r,error:d.error||null,matched:r?.seller?.evidence?.subjectMatched??!!r?.facts,available:v?.available===true,comps:c.length,validRange:v?.available!==true||(Number.isFinite(v.low)&&v.low>0&&v.high>=v.low&&c.length>=3),historyCount:r?.property_history?.counts?.listed??null,lastSold:!!r?.property_history?.lastSold,aiCalls:d.telemetry?.ai_usage?.length||0,models:[...new Set((d.telemetry?.ai_usage||[]).map(a=>a.model))],seconds:Math.round(d.telemetry?.processing_ms/1000),duplicateIds:c.length-new Set(c.map(x=>x.listingKey)).size};}
const queue=[...cases];
async function run(){while(queue.length){const c=queue.shift();const pair={case:c};
  // Fresh same-input runs distinguish this change from older stored reports.
  for(const [name,adapter] of (c.group==='repair'?[['after',candidateAdapter]]:[['before',baselineAdapter],['after',candidateAdapter]])){
    try{pair[name]=await call(adapter,'/run',c);}catch(e){pair[name]={error:String(e.message)};}
  }
  detail.results.push(pair);save();console.log('QA_RESULT',JSON.stringify({id:c.id,mode:c.mode,before:summary(pair.before),after:summary(pair.after)}));
}}
await Promise.all([run(),run(),run()]);
assert.equal(await active(),before,'Production changed during QA');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);
const aggregate={round,candidate:{...candidate,hash:candidateHash},rollback:before,sourceCommit:process.env.GITHUB_SHA,cases:cases.length,readOnly:true,emailsSent:0,before:detail.results.map(p=>summary(p.before)),after:detail.results.map(p=>summary(p.after)),exclusions:cases.map(c=>hash(norm(c.address)))};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(aggregate,null,2));console.log('QA_FINISHED',JSON.stringify({round,cases:cases.length,candidate,hash:candidateHash,productionUnchanged:true,emailsSent:0}));
