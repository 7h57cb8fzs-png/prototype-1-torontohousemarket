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
assert.equal(before,'91c867a9-1d98-401d-a237-01237b8a4d79');
// Isolated, never-promoted preview. The credential stays inside its existing Worker binding.
// A dedicated short-lived key protects metadata-only inspection; it cannot access listing rows.
const nonce=randomBytes(32).toString('hex'),temp=mkdtempSync(join(tmpdir(),'thm-schema-'));
const source=String.raw`import {adminProspects,searchFilters,matchesFilters} from './admin-prospects-api.mjs';
export default {async fetch(request,env){
if(new URL(request.url).pathname!=='/schema'||request.headers.get('Authorization')!=='Bearer '+env.THM_SCHEMA_KEY)return new Response('Not found',{status:404});
const testRequest=(action,body)=>new Request('https://internal.invalid/api/admin/prospects/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
const search=await adminProspects(testRequest('search',{}),env);const data=await search.json();
const integration={searchSucceeded:search.ok,searchHttp:search.status,searchError:data.error||null,adminCredentialPresent:!!env.ADMIN_API_KEY,candidateAvailable:!!data.candidates?.length,continuationAvailable:!!data.cursor};
if(data.cursor){const next=await adminProspects(testRequest('search',{cursor:data.cursor}),env);integration.secondPageSucceeded=next.ok;}
let qualified=null;
for(const candidate of (data.candidates||[]).slice(0,8)){
 const checked=await adminProspects(testRequest('verify',{proof:candidate.proof}),env),row=await checked.json();
 if(row.result==='qualified'){qualified=row;break;}
}
integration.qualifiedAvailable=!!qualified;
if(qualified){
 const reviewProof=qualified.reviewProof;
 const remarksResponse=await adminProspects(testRequest('condition',{reviewProof}),env),remarks=await remarksResponse.json();
 integration.remarksSucceeded=remarksResponse.ok;integration.noteAvailable=typeof remarks.assessment?.note==='string'&&remarks.assessment.note.length>0;integration.remarksError=remarks.error||null;
 const quoteResponse=await adminProspects(testRequest('condition',{reviewProof,mode:'quote'}),env),quote=await quoteResponse.json();
 integration.quoteSucceeded=quoteResponse.ok;integration.archivedPhotosAvailable=!!quote.photoCount||!!quote.assessment?.photos?.length;integration.quoteError=quote.error||null;
 if(quote.quote){
  const photoResponse=await adminProspects(testRequest('condition',{reviewProof,mode:'photos',quote:quote.quote}),env),photo=await photoResponse.json();
  integration.photoSucceeded=photoResponse.ok;integration.photoNoteAvailable=!!photo.assessment?.note;integration.photoError=photo.error||null;integration.model=photo.assessment?.model||null;integration.estimatedActualUsd=photo.assessment?.estimatedActualUsd||null;
  const repeat=await adminProspects(testRequest('condition',{reviewProof}),env),saved=await repeat.json();integration.savedPhotoReused=repeat.ok&&saved.cached===true&&saved.assessment?.source==='photos';
 }else if(quote.cached&&quote.assessment?.source==='photos'){integration.photoSucceeded=true;integration.photoNoteAvailable=!!quote.assessment.note;integration.savedPhotoReused=true;}
}
return Response.json({integration},{headers:{'Cache-Control':'private, no-store'}});
}};`;
try{
writeFileSync(join(temp,'schema.js'),source,{mode:0o600});writeFileSync(join(temp,'admin-prospects-api.mjs'),readFileSync('admin-prospects-api.js')); 
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));delete config.secrets;delete config.assets;delete config.triggers;
config.main=join(temp,'schema.js');config.vars=Object.fromEntries(v.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.vars.THM_SCHEMA_KEY=nonce;
writeFileSync(join(temp,'wrangler.json'),JSON.stringify(config),{mode:0o600});
let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',join(temp,'wrangler.json')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Schema preview upload failed; private config output withheld');}
const preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(preview);
const r=await fetch(preview+'/schema',{headers:{Authorization:'Bearer '+nonce},signal:AbortSignal.timeout(170000)});assert(r.ok,'Schema preview unavailable');
const result=await r.json();console.log('FILTER_INTEGRATION',JSON.stringify(result));for(const key of ['searchSucceeded','qualifiedAvailable','remarksSucceeded','noteAvailable','quoteSucceeded','archivedPhotosAvailable','photoSucceeded','photoNoteAvailable','savedPhotoReused'])assert.equal(result.integration[key],true,'Integration check failed: '+key);assert.equal(await active(),before);console.log('Production unchanged; no listing records or credentials exported.');
}finally{rmSync(temp,{recursive:true,force:true});}
