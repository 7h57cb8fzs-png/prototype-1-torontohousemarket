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
assert.equal(before,process.env.EXPECTED_ACTIVE_VERSION,'Production must match the reviewed offer-email release');
// One explicitly requested email, through the existing authorized production endpoint.
writeFileSync('worker-lookup-probe.js',String.raw`import worker from './worker-v22.js';
export default {async fetch(request,env,ctx){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/probe'||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_PROBE_KEY)return new Response('Not found',{status:404});
 const response=await worker.fetch(new Request('https://torontohousemarket.com/api/admin/reports/test-email-by-listing',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({listingKey:'N13816518',recipient:'ali.golestan.reza@gmail.com',subject:{listingKey:'N13816518',address:'30 Riley Reed Lane, Richmond Hill, ON L4S 0M3'}}),signal:AbortSignal.timeout(180000)}),env,ctx);
 const d=await response.json().catch(()=>({error:'Invalid report response'}));return Response.json({http:response.status,ok:d.ok,report_id:d.report_id,lead_id:d.lead_id,comparable_count:d.comparable_count,valuation_available:d.valuation_available,email_status:d.email_job?.status,error:d.error},{headers:{'Cache-Control':'private, no-store'}});
}};`);
writeFileSync('wrangler.lookup-probe.json',JSON.stringify(config));
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.lookup-probe.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Diagnostic preview upload failed; configuration output withheld.');}
const candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing diagnostic preview identity');
const r=await fetch(preview+'/probe',{method:'POST',headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(210000)});assert(r.ok,`Diagnostic response ${r.status}`);const data=await r.json();console.log('REQUESTED_REPORT_SEND',JSON.stringify(data));
assert.equal(await active(),before,'Production changed during read-only diagnostic');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');console.log('Verified production deployment unchanged; isolated sender was never deployed.');
assert(data.ok&&data.email_status==='sent','Check the recorded report/job before attempting another send.');
