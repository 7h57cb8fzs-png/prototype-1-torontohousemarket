import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000)}),d=await r.json();assert(r.ok&&d.success,`Cloudflare read ${r.status}`);return d.result;}
async function active(){const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);return d.deployments[0].versions[0].version_id;}
const before=await active(),version=await cf(`/workers/workers/${worker}/versions/${before}?include=modules`),schedule=await cf(`/workers/scripts/${worker}/schedules`);
const nonce=randomBytes(32).toString('hex'),config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
delete config.secrets;delete config.assets;delete config.triggers;
config.main='worker-lookup-probe.js';config.vars=Object.fromEntries(version.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_LOOKUP_PROBE_KEY=nonce;
// No customer data, reports, database changes or emails. Never deploy this version.
writeFileSync('worker-lookup-probe.js',`import {resolveSellerSubject,sellerQueryRows} from './worker-v11.js';
export default {async fetch(request,env){
 if(new URL(request.url).pathname!=='/probe'||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_PROBE_KEY)return new Response('Not found',{status:404});
 const results=[];
 for(const [feed,token] of [['IDX',env.AMPRE_TOKEN],['VOW',env.AMPRE_VOW_TOKEN]]) {
  const scoped={...env,AMPRE_TOKEN:token},diagnostics={};
  const rows=await sellerQueryRows(["contains(StreetName,'Bastion') and contains(StreetNumber,'35') and contains(UnitNumber,'1720')"],scoped,300);
  const subject=await resolveSellerSubject('35 Bastion Street Unit 1720, Toronto',{city:'Toronto'},scoped,diagnostics);
  results.push({feed,complete:rows.complete,statuses:rows.audit.map(a=>a.status),matches:rows.rows.map(r=>({key:r.ListingKey,address:r.UnparsedAddress,number:r.StreetNumber,street:r.StreetName,suffix:r.StreetSuffix,unit:r.UnitNumber,city:r.City,status:r.StandardStatus,mlsStatus:r.MlsStatus,transaction:r.TransactionType,display:r.InternetEntireListingDisplayYN,addressDisplay:r.InternetAddressDisplayYN})),subjectMatched:!!subject,queries:diagnostics.queries?.map(q=>({filter:q.filter,rows:q.rows,exactMatches:q.exactMatches,complete:q.complete}))});
 }
 return Response.json({results},{headers:{'Cache-Control':'private, no-store'}});
}};`);
writeFileSync('wrangler.lookup-probe.json',JSON.stringify(config));
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.lookup-probe.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Diagnostic preview upload failed; configuration output withheld.');}
const candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing diagnostic preview identity');
const r=await fetch(preview+'/probe',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(80000)});assert(r.ok,`Diagnostic response ${r.status}`);const data=await r.json();console.log('FEED_AVAILABILITY',JSON.stringify(data));
assert.equal(await active(),before,'Production changed during read-only diagnostic');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');console.log('Verified production unchanged; diagnostic version was never deployed.');
