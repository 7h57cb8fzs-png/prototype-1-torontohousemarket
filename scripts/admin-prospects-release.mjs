import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const worker='prototype-1-torontohousemarket',live='https://torontohousemarket.com';
const root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
const expectedVersion='058d67d7-242f-41ff-ad90-e7ab1986f90f',expectedHash='b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74';
const hash=v=>createHash('sha256').update(v).digest('hex');
const beforeRef=execFileSync('git',['rev-parse','bf2d27b3fb2def248b96001d31355a02c9d23e71'],{encoding:'utf8'}).trim();
const allowed=new Set(['admin.html','admin-workspace.js','admin-prospects.js','admin-prospects.css','admin-prospects-api.js','tests/admin-prospects.test.mjs','scripts/admin-prospects-inspect.mjs','scripts/admin-prospects-release.mjs','.github/workflows/admin-prospects.yml']);
for(const f of execFileSync('git',['diff','--name-only',beforeRef,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean))assert(allowed.has(f),'Out-of-scope change: '+f);
assert.equal(fs.readFileSync('worker-v22.js','utf8'),execFileSync('git',['show',beforeRef+':worker-v22.js'],{encoding:'utf8'}),'Existing worker behavior changed');
async function cf(p,method='GET',body){const r=await fetch(root+p,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();assert(r.ok&&d.success,'Cloudflare request failed '+r.status);return d.result;}
async function active(){const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions.length,1);assert.equal(d.deployments[0].versions[0].percentage,100);return d.deployments[0].versions[0].version_id;}
const version=id=>cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
const beforeId=await active(),before=await version(beforeId),schedule=await cf(`/workers/scripts/${worker}/schedules`);
assert.equal(beforeId,expectedVersion,'Production changed; stop and reconcile');assert.equal(before.modules.length,3);const beforeModules=new Map(before.modules.map(m=>[m.name,Buffer.from(m.content_base64,'base64')]));const existing=beforeModules.get('existing.mjs');assert.equal(hash(existing),expectedHash);assert.equal(hash(beforeModules.get('admin-prospects-api.mjs')),hash(execFileSync('git',['show',beforeRef+':admin-prospects-api.js'])));
const plain=Object.fromEntries(before.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
const names=v=>v.bindings.filter(b=>b.name!=='ASSETS').map(b=>b.name+':'+b.type).sort();
const patterns=fs.readFileSync('.assetsignore','utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
function ignored(file){return patterns.some(p=>p.endsWith('/**')?file.startsWith(p.slice(0,-2)):new RegExp('^'+p.split('*').map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(file));}
const assets=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>p&&!p.startsWith('.')&&!ignored(p));
async function bytes(base,file){const r=await fetch(base+'/'+(file==='index.html'?'':file)+'?prospects='+process.env.GITHUB_SHA,{signal:AbortSignal.timeout(20000)});assert(r.ok,'Asset request failed: '+file+' HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}
const changed=new Set(['admin.html','admin-workspace.js','admin-prospects.js','admin-prospects.css']),added=new Set();
for(const f of assets.filter(p=>!added.has(p)))assert.equal(hash(await bytes(live,f)),hash(changed.has(f)?execFileSync('git',['show',beforeRef+':'+f]):fs.readFileSync(f)),'Production asset drift: '+f);
let candidate=process.env.CANDIDATE_VERSION_ID,preview=process.env.CANDIDATE_PREVIEW_URL;
const entry="import existing from './existing.mjs';\nimport {adminProspects} from './admin-prospects-api.mjs';\nexport default {...existing,fetch(request,env,ctx){if(new URL(request.url).pathname.startsWith('/api/admin/prospects/'))return adminProspects(request,env);return existing.fetch(request,env,ctx);}};\n";
assert.equal(hash(beforeModules.get('entry.mjs')),hash(entry),'Production route wrapper changed');
if(!candidate){
 assert.notEqual(process.env.PUBLISH,'true','A reviewed preview is required before promotion');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'thm-prospects-'));
 try{
  fs.writeFileSync(path.join(temp,'existing.mjs'),existing,{mode:0o600});fs.writeFileSync(path.join(temp,'admin-prospects-api.mjs'),fs.readFileSync('admin-prospects-api.js'));fs.writeFileSync(path.join(temp,'entry.mjs'),entry);
  const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));delete config.secrets;config.main=path.join(temp,'entry.mjs');config.no_bundle=true;config.find_additional_modules=true;config.base_dir=temp;config.rules=[{type:'ESModule',globs:['**/*.mjs']}];config.vars=plain;config.assets.directory=process.cwd();
  const cfg=path.join(temp,'wrangler.json');fs.writeFileSync(cfg,JSON.stringify(config),{mode:0o600});let output;
  try{output=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',cfg],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Preview upload failed; private config output withheld');}
  candidate=output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];preview=output.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];assert(candidate&&preview);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
const after=await version(candidate),modules=new Map(after.modules.map(m=>[m.name,Buffer.from(m.content_base64,'base64')]));
assert.equal(modules.size,3);assert.equal(hash(modules.get('existing.mjs')),expectedHash,'Public server code changed');assert.equal(hash(modules.get('admin-prospects-api.mjs')),hash(fs.readFileSync('admin-prospects-api.js')));assert.equal(hash(modules.get('entry.mjs')),hash(entry));
assert.deepEqual(names(after),names(before));for(const [name,text] of Object.entries(plain))assert(after.bindings.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text),'Existing setting changed');
async function verify(base){
 for(const f of assets)assert.equal(hash(await bytes(base,f)),hash(fs.readFileSync(f)),'Asset mismatch: '+f);
 for(const p of ['/api/admin/prospects/options','/api/admin/prospects/search','/api/admin/prospects/verify','/api/admin/ops/counts']){const r=await fetch(base+p,{method:p.includes('/prospects/')?'POST':'GET',headers:{'Content-Type':'application/json'},...(p.includes('/prospects/')?{body:'{}'}:{}),signal:AbortSignal.timeout(20000)});assert.equal(r.status,401,'Admin auth failed: '+p);}
 const v=await fetch(base+'/api/version').then(r=>r.json());assert.equal(v.version,'version-7.6-luna-external-lookup-20260927');
 for(const f of ['admin-prospects-api.js','scripts/admin-prospects-inspect.mjs'])assert.equal((await fetch(base+'/'+f)).status,404,'Server source exposed');
 console.log('VERIFY',JSON.stringify({base,assets:assets.length,publicCodeUnchanged:true,adminAuthRequired:true}));
}
await verify(preview);assert.equal(await active(),beforeId);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);
const review={candidate,preview,rollback:beforeId,publicServerHash:expectedHash,adminModuleHash:hash(modules.get('admin-prospects-api.mjs')),assets:assets.length};console.log('PROSPECTS_REVIEW',JSON.stringify(review));
if(process.env.PUBLISH!=='true')process.exit(0);
try{
 await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:candidate,percentage:100}]});
 let failure;for(let i=0;i<4;i++){try{await verify(live);failure=null;break;}catch(e){failure=e;if(i<3)await new Promise(r=>setTimeout(r,2500));}}if(failure)throw failure;
 assert.equal(await active(),candidate);assert.deepEqual(await cf(`/workers/scripts/${worker}/schedules`),schedule);console.log('PROSPECTS_PUBLISHED',JSON.stringify(review));
}catch(e){if(await active()===candidate)await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:beforeId,percentage:100}]});throw e;}
