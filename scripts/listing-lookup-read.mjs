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
writeFileSync('worker-lookup-probe.js',String.raw`import {extractOfferInstructions} from './offer-instructions.js';
export default {async fetch(request,env){
 if(new URL(request.url).pathname!=='/probe'||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_PROBE_KEY)return new Response('Not found',{status:404});
 const r=await fetch("https://query.ampre.ca/odata/Property('N13816518')",{headers:{Authorization:'Bearer '+env.AMPRE_VOW_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
 const d=await r.json();
 const key=await crypto.subtle.importKey('jwk',{"kty":"RSA","n":"nb33If4CgNXkXsFC8RWXmJSl4Y4C846Ub-Rc2w8T3FpvsuyT50PK_ZOZD-piThTKqnPhBSN6iNE2OBts9AMCHc9FKG10bFzc0k8x7O8zwUt8WaY3sa9a6vnkVAptlM7l0S7BKcbDvaWpVMROT6Q7bqWOWW9MIesX9KshDrBdaHUMb-GUjvGmhHPfqAYWN7CMP1V7YzuZ9rp3h_VYs7TA12z6Jkhy3ELhtxJ2DDqpElOPXCipjXRvFKQgwMTQqhrcIfoXof-gI8vccZn92RXuhuyYvjkQyhMOwb9btcEr-1WZQFEHEVZ1rx5g-SHRZEKcfTi_SyWwa4eElrvac2J2RQ","e":"AQAB"},{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const bytes=new TextEncoder().encode(JSON.stringify({private:d.PrivateRemarks,public:d.PublicRemarks})),encrypted=[];
 for(let i=0;i<bytes.length;i+=180){const c=await crypto.subtle.encrypt({name:'RSA-OAEP'},key,bytes.slice(i,i+180));encrypted.push(btoa(String.fromCharCode(...new Uint8Array(c))));}
 return Response.json({encrypted,http:r.status,key:d.ListingKey,address:d.UnparsedAddress,instructions:extractOfferInstructions(d),remarkFields:Object.keys(d).filter(k=>/offer|remark/i.test(k)&&d[k])},{headers:{'Cache-Control':'private, no-store'}});
}};`);
writeFileSync('wrangler.lookup-probe.json',JSON.stringify(config));
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config','wrangler.lookup-probe.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Diagnostic preview upload failed; configuration output withheld.');}
const candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1],preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview,'Missing diagnostic preview identity');
const r=await fetch(preview+'/probe',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(80000)});assert(r.ok,`Diagnostic response ${r.status}`);const data=await r.json();console.log('FEED_AVAILABILITY',JSON.stringify(data));
assert.equal(await active(),before,'Production changed during read-only diagnostic');assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule,'Cron changed');console.log('Verified production unchanged; diagnostic version was never deployed.');
