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
writeFileSync('worker-lookup-probe.js',`export default {async fetch(request,env){
 if(new URL(request.url).pathname!=='/probe'||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_PROBE_KEY)return new Response('Not found',{status:404});
 const results=[];
 for(const [feed,token]of [['IDX',env.AMPRE_TOKEN],['VOW',env.AMPRE_VOW_TOKEN]]){
  if(!token){results.push({feed,configured:false});continue;}
  for(const key of ['N13816334','N13815978'])for(const mode of ['direct','collection']){
   const url=new URL('https://query.ampre.ca/odata/Property'+(mode==='direct'?"('"+key+"')":''));
   if(mode==='collection')url.searchParams.set('$select','ListingKey,InternetEntireListingDisplayYN,InternetAddressDisplayYN');
   if(mode==='collection'){url.searchParams.set('$filter',"ListingKey eq '"+key+"'");url.searchParams.set('$top','1');}
   try{const r=await fetch(url.href.replaceAll('+','%20'),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(8000)}),d=await r.json().catch(()=>null),rows=Array.isArray(d?.value)?d.value:d?.ListingKey?[d]:[];
    results.push({feed,key,mode,status:r.status,count:rows.length,exactMatch:rows.some(p=>p.ListingKey===key),displayAllowed:rows.length?rows.every(p=>p.InternetEntireListingDisplayYN!==false&&p.InternetAddressDisplayYN!==false):null,...key==='N13816334'&&mode==='direct'&&rows.length?{visibilityFlags:Object.fromEntries(Object.entries(rows[0]).filter(([k,v])=>/IDX|Internet|Syndicat|Recip|OriginalEntryTimestamp|ModificationTimestamp/i.test(k)&&['string','boolean','number'].includes(typeof v)))}:{}});
   }catch(e){results.push({feed,key,mode,error:e.name});}
  }
 }
 return Response.json({results},{headers:{'Cache-Control':'private, no-store'}});
}};`);
writeFileSync('wrangler.lookup-probe.json',JSON.stringify(config));
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.lookup-probe.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Diagnostic preview upload failed; configuration output withheld.');}
const candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing diagnostic preview identity');
const r=await fetch(preview+'/probe',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(80000)});assert(r.ok,`Diagnostic response ${r.status}`);const data=await r.json();console.log('FEED_AVAILABILITY',JSON.stringify(data));
assert.equal(await active(),before,'Production changed during read-only diagnostic');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');console.log('Verified production unchanged; diagnostic version was never deployed.');
