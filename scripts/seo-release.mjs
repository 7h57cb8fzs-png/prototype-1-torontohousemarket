import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Asset-only SEO release: reuse the deployed server module byte for byte.
const worker='prototype-1-torontohousemarket',live='https://torontohousemarket.com';
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const baseline='f714b5c0c685d59b4a981979d652be7e495cee8c';
const expectedVersion='0ee2f48d-a4b5-47f3-aec6-8b3c92edab58';
const expectedHash='b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74';
const hash=v=>createHash('sha256').update(v).digest('hex');
const changedAssets=['index.html','seller.html','seo.css','robots.txt','sitemap.xml'];
const allowed=new Set([...changedAssets,'scripts/seo-release.mjs','.github/workflows/seo-release.yml']);
for(const file of execFileSync('git',['diff','--name-only',baseline,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean))assert(allowed.has(file),'Out-of-scope change: '+file);

// Verify existing forms, handlers, application scripts and control IDs are preserved.
for(const file of ['index.html','seller.html']){
 const prior=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}),current=fs.readFileSync(file,'utf8');
 const forms=s=>[...s.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m=>m[0]);
 const scripts=s=>[...s.matchAll(/<script\b(?![^>]*type="application\/ld\+json")[\s\S]*?<\/script>/g)].map(m=>m[0]);
 assert.deepEqual(forms(current),forms(prior),'Existing form changed: '+file);
 assert.deepEqual(scripts(current),scripts(prior),'Existing JavaScript changed: '+file);
 for(const id of [...prior.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))assert.equal([...current.matchAll(new RegExp('\\bid="'+id+'"','g'))].length,1,'Control ID changed: '+id);
 const canonical=file==='index.html'?live+'/':live+'/seller';
 assert.equal([...current.matchAll(/rel="canonical"/g)].length,1);assert(current.includes('rel="canonical" href="'+canonical+'"'));
 for(const m of current.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))assert.equal(JSON.parse(m[1])['@context'],'https://schema.org');
 assert(current.includes('index,follow,max-image-preview:large'));
}
assert.equal([...fs.readFileSync('sitemap.xml','utf8').matchAll(/<loc>/g)].length,2);
assert(fs.readFileSync('robots.txt','utf8').includes('Sitemap: '+live+'/sitemap.xml'));
assert(fs.readFileSync('admin.html','utf8').includes('noindex,nofollow'));
assert(fs.readFileSync('showing.html','utf8').includes('noindex,nofollow'));
console.log('SEO scope, forms, application scripts, canonical URLs and structured data verified.');

async function cf(resource,method='GET',body){
 const r=await fetch(root+resource,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const d=await r.json();assert(r.ok&&d.success,'Cloudflare request failed '+r.status);return d.result;
}
async function active(){const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);assert.equal(d.deployments[0].versions[0].percentage,100);return d.deployments[0].versions[0].version_id;}
const version=id=>cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
function moduleHash(v){assert.equal(v.modules.length,1,'Review a multi-module deployment separately');return hash(Buffer.from(v.modules[0].content_base64,'base64'));}
const bindingNames=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();
const beforeId=await active(),before=await version(beforeId),schedule=await cf(`/workers/scripts/${worker}/schedules`);
assert.equal(beforeId,expectedVersion,'Production changed; reconcile before proceeding');
assert.equal(moduleHash(before),expectedHash,'Production source differs from accepted release');
const plain=Object.fromEntries(before.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
console.log(JSON.stringify({stage:'production-baseline',version:beforeId,serverHash:moduleHash(before)}));

const patterns=fs.readFileSync('.assetsignore','utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
function ignored(file){return patterns.some(p=>p.endsWith('/**')?file.startsWith(p.slice(0,-2)):new RegExp('^'+p.split('*').map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(file));}
const assets=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>p&&!p.startsWith('.')&&!ignored(p));
async function bytes(base,file){const r=await fetch(base+'/'+(file==='index.html'?'':file)+'?seo_check='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(20000)});assert(r.ok,'Asset request failed: '+file+' HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}
// Do not overwrite newer production assets with an older repository copy.
for(const file of assets.filter(p=>!['seo.css','robots.txt','sitemap.xml'].includes(p))){const original=changedAssets.includes(file)?execFileSync('git',['show',baseline+':'+file]):fs.readFileSync(file);assert.equal(hash(await bytes(live,file)),hash(original),'Production asset drift: '+file);}

let candidate=process.env.CANDIDATE_VERSION_ID,preview=process.env.CANDIDATE_PREVIEW_URL;
if(!candidate){
 assert.notEqual(process.env.PUBLISH,'true','Preview must be reviewed before publication');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'thm-seo-'));
 try{
  const moduleName=before.modules[0].name;assert.equal(path.basename(moduleName),moduleName,'Unexpected module path');
  fs.writeFileSync(path.join(temp,moduleName),Buffer.from(before.modules[0].content_base64,'base64'),{mode:0o600});
  const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));delete config.secrets;
  config.main=path.join(temp,moduleName);config.no_bundle=true;config.vars=plain;
  config.assets.directory=process.cwd();
  const configPath=path.join(temp,'wrangler.json');fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  let output;try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',configPath],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('SEO preview upload failed; private configuration output withheld');}
  candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];
  assert(candidate&&preview,'Missing preview identity');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
assert(candidate&&preview,'Reviewed preview is required');
const after=await version(candidate);
assert.equal(moduleHash(after),expectedHash,'Server code changed during asset-only release');
assert.deepEqual(bindingNames(after),bindingNames(before),'Existing bindings changed');
for(const [name,text] of Object.entries(plain))assert(after.bindings.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text),'Existing setting changed');
assert(after.bindings.some(b=>b.name==='ASSETS'&&b.type==='assets'));
async function verify(base){
 for(const file of assets)assert.equal(hash(await bytes(base,file)),hash(fs.readFileSync(file)),'Published asset mismatch: '+file);
 for(const p of ['/','/seller']){const r=await fetch(base+p,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);assert.equal(new URL(r.url).pathname,p);assert(!(r.headers.get('x-robots-tag')||'').includes('noindex'));}
 const sitemap=await fetch(base+'/sitemap.xml');assert.equal(sitemap.status,200);assert(sitemap.headers.get('content-type')?.includes('xml'));assert.equal(await sitemap.text(),fs.readFileSync('sitemap.xml','utf8'));
 const robots=await fetch(base+'/robots.txt');assert.equal(robots.status,200);assert(robots.headers.get('content-type')?.includes('text/plain'));
 const api=await fetch(base+'/api/version').then(r=>r.json());assert.equal(api.version,'version-7.6-luna-external-lookup-20260927');assert.equal(api.external_comparable_search,'luna_web_search_with_mls_verification');
 for(const p of ['/api/admin/ops/leads','/api/admin/seller-preview?address=101%20Example%20Avenue%2C%20Toronto'])assert.equal((await fetch(base+p)).status,401,'Admin authentication changed');
 console.log(JSON.stringify({stage:'verified',base,publicAssets:assets.length,serverUnchanged:true,sitemap:'200 XML',robots:'200 text/plain',adminAuth:'preserved'}));
}
await verify(preview);assert.equal(await active(),beforeId);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);
const review={candidate,preview,serverHash:moduleHash(after),rollback:beforeId,assets:assets.length,commit:process.env.GITHUB_SHA};
console.log('SEO_REVIEW',JSON.stringify(review));
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## THM SEO release\n```json\n'+JSON.stringify(review,null,2)+'\n```\nNo property reports, leads, emails or customer records created. Server module unchanged.\n');
if(process.env.PUBLISH!=='true')process.exit(0);
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 let failure;for(let i=0;i<4;i++){try{await verify(live);failure=null;break;}catch(e){failure=e;if(i<3)await new Promise(r=>setTimeout(r,2500));}}if(failure)throw failure;
 assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);
 console.log('SEO_PUBLISHED',JSON.stringify(review));
}catch(e){if(await active()===candidate)await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:beforeId,percentage:100}]});throw e;}
