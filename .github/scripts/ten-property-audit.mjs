import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket';
const api=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const headers={Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`};
const hash=b=>createHash('sha256').update(b).digest('hex');
mkdirSync('audit-output',{recursive:true});
async function cf(path) {const r=await fetch(api+path,{headers,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`Cloudflare read ${r.status}`);const b=await r.json();assert.ok(b.success);return b.result;}
async function get(url) {const start=Date.now();const r=await fetch(url,{signal:AbortSignal.timeout(90000)});const b=await r.json();assert.ok(r.ok,`Property check failed: ${r.status}`);return {data:b,elapsedMs:Date.now()-start};}
const deployment=await cf(`/workers/scripts/${worker}/deployments`);
const versions=deployment.deployments[0].versions;
assert.ok(versions.length===1&&versions[0].percentage===100);
const active=versions[0].version_id;
const before=await cf(`/workers/workers/${worker}/versions/${active}?include=modules`);
const source=Buffer.from(before.modules.find(m=>m.name==='worker-v11.js').content_base64,'base64');
console.log(JSON.stringify({activeVersion:active,activeSourceSha:hash(source)}));
assert.equal(hash(source),process.env.EXPECTED_ACTIVE_SHA,'Production changed since review');
const args=['--yes','wrangler@4.129.0','versions','upload','--no-bundle','--preview-alias','report-audit'];
for(const b of before.bindings) if(b.type==='plain_text') args.push('--var',`${b.name}:${b.text}`);
let log;
try {log=execFileSync('npx',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:10*1024*1024});}
catch {throw new Error('Preview upload failed; CLI output withheld because it can contain configuration.');}
const candidate=log.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];
const preview=log.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];
assert.ok(candidate&&preview);
const after=await cf(`/workers/workers/${worker}/versions/${candidate}?include=modules`);
assert.equal(hash(Buffer.from(after.modules.find(m=>m.name==='worker-v11.js').content_base64,'base64')),hash(readFileSync('worker-v11.js')));
const names=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>`${b.name}:${b.type}`).sort();
assert.deepEqual(names(after),names(before));
for(const b of before.bindings.filter(b=>b.type==='plain_text')) assert.ok(after.bindings.some(a=>a.name===b.name&&a.text===b.text));
assert.equal((await cf(`/workers/scripts/${worker}/deployments`)).deployments[0].versions[0].version_id,active);
const release={active,candidate,preview,beforeSha:hash(source),candidateSha:hash(readFileSync('worker-v11.js'))};
writeFileSync('audit-output/release.json',JSON.stringify(release,null,2));
console.log(JSON.stringify(release));
const seed=randomBytes(16).toString('hex'),results=[],pools=[];
console.log(JSON.stringify({randomSeed:seed,method:'One random home per city and property-type stratum, from the returned current IDX pool'}));
for(const [city,types] of Object.entries({Toronto:['condo','semi'],Vaughan:['detached','freehold_town'],Mississauga:['condo_town','semi'],Oakville:['condo','detached'],Whitby:['detached','freehold_town']})) for(const type of types) {
 const url=new URL('/api/discovery',preview);url.search=new URLSearchParams({mode:'new',city,type});
 const pool=(await get(url)).data;
 assert.ok(pool.ok&&pool.listings?.length>=1,`${city} needs a current home for this type`);
 const chosen=[...pool.listings].sort((a,b)=>hash(seed+a.listingKey).localeCompare(hash(seed+b.listingKey))).slice(0,1);
 pools.push({city,type,poolSize:pool.listings.length,listingKeys:pool.listings.map(p=>p.listingKey),coverage:pool.coverage});
 for(const row of chosen) {
  const publicResult=await get(new URL(`/api/property?listingKey=${row.listingKey}`,preview));
  const p=publicResult.data.property;
  assert.ok(p&&p.listingKey===row.listingKey&&p.forSale===true&&p.listPrice===row.listPrice,'Public snapshot mismatch');
  assert.ok(!p.comparableContext?.available&&!(p.comparableContext?.comparables?.length),'Protected sold data appeared in public snapshot');
  const priceResult=await get(new URL(`/api/price-check?listingKey=${row.listingKey}`,preview));
  const price=priceResult.data;
  assert.ok(price.ok&&price.listingKey===p.listingKey);
  if(price.available) assert.ok(price.count>=3&&price.medianAsk>0&&Number.isFinite(price.differencePct));
  else assert.equal(price.medianAsk,null);
  let photo=null;
  if(p.photos?.[0]) {
   const media=p.photos[0]; const r=await fetch(new URL(media.fallbackUrl||media.url,preview),{signal:AbortSignal.timeout(30000)});
   photo={status:r.status,type:r.headers.get('content-type'),bytes:(await r.arrayBuffer()).byteLength};
  }
  const result={city,listingKey:p.listingKey,address:p.address,publicMs:publicResult.elapsedMs,priceMs:priceResult.elapsedMs,priceCheck:price,photo,property:p};
  results.push(result);
  writeFileSync('audit-output/properties.json',JSON.stringify({seed,pools,results},null,2));
  console.log(JSON.stringify({city,listingKey:p.listingKey,address:p.address,propertyType:p.propertySubType,snapshot:'passed',priceSignal:price.signal,photoStatus:photo?.status,publicMs:publicResult.elapsedMs}));
 }
}
assert.equal(results.length,10);
const check=await fetch(new URL('/api/home-assistant',preview),{method:'POST',headers:{Origin:new URL(preview).origin,'Content-Type':'application/json'},body:JSON.stringify({listingKey:results[0].listingKey,topic:'costs'}),signal:AbortSignal.timeout(60000)});
const ai=await check.json();assert.ok(check.ok&&ai.facts?.length);console.log(JSON.stringify({assistant:ai.mode}));
writeFileSync('audit-output/summary.json',JSON.stringify({release,seed,count:results.length,aiMode:ai.mode,noEmailsSent:true},null,2));
appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Preview: ${preview}\n\n10 randomly selected homes, two from each of five GTA cities. Public snapshots and asking-price guards checked. No email or lead created.\n`);
