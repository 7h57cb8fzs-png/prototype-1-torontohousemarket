import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
async function cf(path){const r=await fetch(root+path,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare read failed');return d.result;}
async function active(){const d=await cf('/workers/scripts/'+worker+'/deployments');return d.deployments[0].versions[0].version_id;}
const before=await active(),v=await cf('/workers/workers/'+worker+'/versions/'+before+'?include=modules');
assert.equal(before,'ba7acead-8f7a-4e97-89e7-22fbf22e1758');
// Isolated, never-promoted preview. The credential stays inside its existing Worker binding.
// A dedicated short-lived key protects metadata-only inspection; it cannot access listing rows.
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-schema-'));
const source=String.raw`import {adminProspects} from './admin-prospects-api.mjs';
export default {async fetch(request,env){
if(new URL(request.url).pathname!=='/schema'||request.headers.get('Authorization')!=='Bearer '+env.THM_SCHEMA_KEY)return new Response('Not found',{status:404});
const testRequest=(action,body)=>new Request('https://internal.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
const search=await adminProspects(testRequest('search',{}),env);const data=await search.json();
const integration={searchSucceeded:search.ok,searchHttp:search.status,searchError:data.error||null,adminCredentialPresent:!!env.ADMIN_API_KEY,candidateAvailable:!!data.candidates?.length,continuationAvailable:!!data.cursor};
if(data.cursor){const next=await adminProspects(testRequest('search',{cursor:data.cursor}),env);integration.secondPageSucceeded=next.ok;}
const choices=await adminProspects(testRequest('options',{}),env),options=await choices.json();integration.communityOptionsSupported=choices.ok;integration.communityOptionsAvailable=Array.isArray(options.communities)&&options.communities.length>0;
const candidate=data.candidates?.find(c=>c.community&&c.askingPrice>0);
if(candidate){
 const municipality=candidate.region==='Toronto'?'Toronto':candidate.city;
 const filters={municipality,community:candidate.community.toLowerCase(),minPrice:candidate.askingPrice,maxPrice:candidate.askingPrice};
 const narrowed=await adminProspects(testRequest('search',{filters}),env),filtered=await narrowed.json();
 integration.filteredSearchSucceeded=narrowed.ok;integration.knownCandidateIncluded=filtered.candidates?.some(c=>c.listingKey===candidate.listingKey)||false;
 integration.allCandidatesMatch=!!filtered.candidates?.length&&filtered.candidates.every(c=>c.community.toLowerCase()===candidate.community.toLowerCase()&&c.askingPrice===candidate.askingPrice&&(municipality==='Toronto'?c.region==='Toronto':c.city===municipality));
 integration.filterError=filtered.error||null;
 if(filtered.cursor){const next=await adminProspects(testRequest('search',{cursor:filtered.cursor}),env),page=await next.json();integration.filteredContinuationSucceeded=next.ok&&JSON.stringify(page.filters)===JSON.stringify(filtered.filters);}
 const verification=await adminProspects(testRequest('verify',{proof:candidate.proof}),env),outcome=await verification.json();integration.verificationSucceeded=verification.ok;integration.historyCheckConclusive=['qualified','excluded'].includes(outcome.result);
}else integration.knownCandidateIncluded=false;
return Response.json({integration},{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'schema.js'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js')); 
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'schema.js');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_SCHEMA_KEY=nonce;
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Schema preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/schema',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(100000)});assert(r.ok,'Schema preview unavailable');
const result=await r.json();console.log('FILTER_INTEGRATION',JSON.stringify(result));for(const key of ['searchSucceeded','secondPageSucceeded','communityOptionsSupported','communityOptionsAvailable','filteredSearchSucceeded','knownCandidateIncluded','allCandidatesMatch','verificationSucceeded','historyCheckConclusive'])assert.equal(result.integration[key],true,'Integration check failed: '+key);assert.equal(await active(),before);console.log('Production unchanged; no listing records or credentials exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
