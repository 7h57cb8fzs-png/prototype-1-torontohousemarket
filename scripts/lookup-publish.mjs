import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket', live='https://torontohousemarket.com';
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function cf(path,method='GET',body){const r=await fetch(root+path,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();assert(r.ok&&d.success,'Cloudflare request failed '+r.status);return d.result;}
async function active(){const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);assert.equal(d.deployments[0].versions[0].percentage,100);return d.deployments[0].versions[0].version_id;}
const version=id=>cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
function moduleHash(v){assert.equal(v.modules.length,1,'Review multi-module deployment separately');return hash(Buffer.from(v.modules[0].content_base64,'base64'));}
const bindingNames=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();
const beforeId=await active(),before=await version(beforeId),schedule=await cf(`/workers/scripts/${worker}/schedules`);
assert.equal(beforeId,process.env.EXPECTED_ACTIVE_VERSION,'Production has changed; stop and reconcile');
assert.equal(moduleHash(before),process.env.EXPECTED_ACTIVE_SHA,'Production source mismatch');
const plain=Object.fromEntries(before.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
const configuredAdmin=process.env.ADMIN_API_KEY||plain.ADMIN_API_KEY||null;
if(configuredAdmin)console.log('::add-mask::'+configuredAdmin);
function upload(config,name){fs.writeFileSync(name,JSON.stringify(config));let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',name],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Unpublished upload failed; private configuration output withheld.');}const id=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],url=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(id&&url,'Missing uploaded version identity');return{id,url};}
let candidate=process.env.CANDIDATE_VERSION_ID,preview=process.env.CANDIDATE_PREVIEW_URL;
if(!candidate){assert.notEqual(process.env.PUBLISH,'true','Do not upload and promote without separate preview review');const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));delete config.secrets;config.vars=plain;const r=upload(config,'wrangler.seller-mls-release.json');candidate=r.id;preview=r.url;}
assert(candidate&&preview,'An exact reviewed preview URL is required');
const candidateVersion=await version(candidate),candidateHash=moduleHash(candidateVersion);
if(process.env.PUBLISH==='true')assert.equal(candidateHash,process.env.EXPECTED_CANDIDATE_SHA,'Candidate differs from reviewed source');
assert.deepEqual(bindingNames(candidateVersion),bindingNames(before),'Binding names/types changed');
for(const [key,value] of Object.entries(plain))assert(candidateVersion.bindings.some(b=>b.name===key&&b.type==='plain_text'&&b.text===value),'Existing configuration changed');
assert(candidateVersion.bindings.some(b=>b.name==='ASSETS'&&b.type==='assets'),'Assets binding missing');
const assets=['index.html','app.js','styles.css','seller.html','seller.js','seller.css','address-input.js','interface.css','showing.js','admin.html','admin-workspace.js','admin-workspace.css','admin-view-model.js','admin-insights.js','admin-exports.js','marketing/THM-Selling-Plan-and-Fees-v1.pdf'];
async function verify(base){
 const r=await fetch(base+'/api/version',{cache:'no-store',signal:AbortSignal.timeout(20000)});assert(r.ok);const d=await r.json();assert.equal(d.seller_input,'address_and_historical_mls_only');assert.equal(d.version,'version-7.6-luna-lookup-history-20260926');assert.equal(d.chat_model,'gpt-5.6-luna');
 for(const file of assets){const p=file==='index.html'?'':file;const res=await fetch(base+'/'+p+'?seller_mls_release='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(20000)});assert(res.ok&&hash(Buffer.from(await res.arrayBuffer()))===hash(fs.readFileSync(file)),'Public asset mismatch: '+file);}
 for(const path of ['/api/admin/seller-preview?address=101%20Example%20Avenue%2C%20Toronto','/api/admin/ops/leads'])assert.equal((await fetch(base+path,{signal:AbortSignal.timeout(10000)})).status,401,'Admin authentication changed');
 for(const path of ['/seller-mls-input.js','/seller-archive.js','/worker-v22.js','/lookup-recovery.js','/property-history.js','/scripts/lookup-qa-worker.js','/wrangler.lookup-candidate.json','/wrangler.lookup-qa.json']){const res=await fetch(base+path,{signal:AbortSignal.timeout(10000)});const body=await res.text();assert(!body.includes('historicalSellerProperty')&&!body.includes('SUPABASE_SERVICE_ROLE_KEY')&&!body.includes('chooseLookupPlans')&&!body.includes('THM_LOOKUP_QA_NONCE')&&!body.includes('"vars"'),'Server-only content exposed');}
 console.log(JSON.stringify({stage:'assets-and-auth',base,assets:assets.length,buyerAssetsUnchanged:true,sellerInput:'address_and_historical_mls_only'}));
}
await verify(preview);
// Every protected acceptance request is GET/read-only and uses existing admin
// authentication. A protected, expiring adapter is used only when the admin key
// is a non-exportable Cloudflare secret. It can reach this exact preview only.
const cases=['1469 Venta Avenue, Mississauga','4 Alma Court, Richmond Hill','60 Disera Drive Unit 1404, Vaughan','8 The Esplanade Unit 5403, Toronto'];
let adapter=null,nonce=null;
if(!configuredAdmin && process.env.PUBLISH!=='true'){
 nonce=randomBytes(32).toString('hex');console.log('::add-mask::'+nonce);
 const expires=Date.now()+600000;
 const code=`export default {async fetch(req,env){const u=new URL(req.url);if(req.method!=='GET'||u.pathname!=='/check'||Date.now()>${expires}||req.headers.get('Authorization')!=='Bearer '+env.THM_SELLER_QA_NONCE)return new Response('Not found',{status:404});const cases=${JSON.stringify(cases)};const i=Number(u.searchParams.get('case'));if(!Number.isInteger(i)||i<0||i>=cases.length)return new Response('Not found',{status:404});const r=await fetch(${JSON.stringify(preview)}+'/api/admin/seller-preview?address='+encodeURIComponent(cases[i]),{headers:{Authorization:'Bearer '+env.ADMIN_API_KEY},signal:AbortSignal.timeout(110000)});const d=await r.json();return Response.json({http:r.status,ok:d.ok,readOnly:d.readOnly,facts:d.facts,valuation:d.valuation,policy:d.policy,history:d.history,comparableCount:d.comparables?.length||0,activeComparableCount:d.activeComparables?.length||0,error:d.error},{headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});}};`;
 fs.writeFileSync('worker-seller-mls-acceptance.js',code);
 const c=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));delete c.secrets;delete c.assets;delete c.triggers;c.main='worker-seller-mls-acceptance.js';c.compatibility_flags=[...new Set([...(c.compatibility_flags||[]),'global_fetch_strictly_public'])];c.vars={...plain,THM_SELLER_QA_NONCE:nonce};adapter=upload(c,'wrangler.seller-mls-acceptance.json');
 assert.notEqual(adapter.id,candidate,'Never promote the diagnostic adapter');
}
async function evidence(i,base=preview){
 const url=adapter?adapter.url+'/check?case='+i:base+'/api/admin/seller-preview?address='+encodeURIComponent(cases[i]);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+(adapter?nonce:configuredAdmin)},signal:AbortSignal.timeout(120000)});assert(r.ok,'Acceptance request failed HTTP '+r.status);const d=await r.json();assert(d.ok&&d.readOnly,'Read-only evidence check failed for case '+i);
 const count=d.comparableCount??d.comparables?.length??0;
 return {case:i,address:cases[i],facts:d.facts,valuation:d.valuation,policy:d.policy,history:d.history,comparableCount:count,activeComparableCount:d.activeComparableCount??d.activeComparables?.length??0};
}
const results=[];
if(process.env.PUBLISH!=='true'){
 for(let i=0;i<cases.length;i++){
  const d=await evidence(i);assert.equal(d.policy.subjectFactsSource,'historical_mls');assert.equal(d.policy.sellerAnswersUsed,false);
  if(i===0){assert.equal(d.facts.neighbourhood,'Lakeview');assert.equal(d.facts.kitchens,1);assert.equal(d.facts.living_area,null);assert.equal(d.facts.beds,3);assert.equal(d.facts.below_grade_beds,1);assert(d.history.some(h=>h.listingKey==='W9347469'));}
  if(i===1||i===2){assert(d.history.length>0,'Existing known historical property no longer matched');assert(d.valuation.available&&d.comparableCount>=3,'Known historical property lost valuation');}
  const result={case:i,historyMatched:d.history.length>0,mlsOnly:d.policy.sellerAnswersUsed===false,valuationAvailable:d.valuation.available,comparableCount:d.comparableCount,activeComparableCount:d.activeComparableCount,missingSizeFallback:d.policy.missingSizeFallback===true,retrievalCapped:d.policy.retrievalCapped===true,unitPreserved:!i||!cases[i].includes('Unit')||d.facts.address.includes(cases[i].match(/Unit \w+/)[0]),...(i===0?{source:'reviewed_private_mls_document',historicalFactsVerifiedAgainstSuppliedDocument:true,missingRecordedSizePreserved:d.facts.living_area===null}:{} )};
  results.push(result);console.log('SELLER_ACCEPTANCE',JSON.stringify(result));
 }
}
assert.equal(await active(),beforeId,'Production changed during preview');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);
const reviewed={candidate,preview,candidateHash,rollback:beforeId,rollbackHash:moduleHash(before),checks:results,sourceCommit:process.env.GITHUB_SHA};
console.log('REVIEWED_CANDIDATE',JSON.stringify(reviewed));
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Seller MLS-only release\n```json\n'+JSON.stringify(reviewed,null,2)+'\n```\nNo leads, reports, emails, appointments or consent records created.\n');
if(process.env.PUBLISH!=='true')process.exit(0);
assert(!adapter||adapter.id!==candidate,'Diagnostic adapter is not deployable production');
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 let last;
 for(let i=0;i<4;i++){try{await verify(live);last=null;break;}catch(e){last=e;if(i<3)await new Promise(r=>setTimeout(r,2500));}}
 if(last)throw last;
 assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');
 const published=await version(candidate);assert.equal(moduleHash(published),candidateHash);
 console.log('PUBLISHED',JSON.stringify({candidate,candidateHash,rollback:beforeId,publicAssetsVerified:assets.length,productionCronPreserved:true}));
}catch(error){await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:beforeId,percentage:100}]});console.log('ROLLBACK',JSON.stringify({version:beforeId,reason:error.message}));throw error;}
