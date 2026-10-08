import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22',worker='prototype-1-torontohousemarket';
async function cf(p,method='GET',body){const r=await fetch(root+p,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert(r.ok&&d.success);return d.result;}
const d=await cf(`/workers/scripts/${worker}/deployments`);assert.equal(d.deployments[0].versions[0].version_id,'1cd51f06-2f99-4657-b7e6-0d4d1a80f6ae');
const good=await cf(`/workers/workers/${worker}/versions/53bc2016-28c9-4548-a14d-91ed0fa3b118?include=modules`);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thm-recovery-'));
try{
for(const m of good.modules)fs.writeFileSync(path.join(dir,m.name),Buffer.from(m.content_base64,'base64'),{mode:0o600});
const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));delete config.secrets;config.main=path.join(dir,'entry.mjs');config.no_bundle=true;config.find_additional_modules=true;config.base_dir=dir;config.rules=[{type:'ESModule',globs:['**/*.mjs']}];config.vars=Object.fromEntries(good.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));config.assets.directory=process.cwd();
const cfg=path.join(dir,'wrangler.json');fs.writeFileSync(cfg,JSON.stringify(config),{mode:0o600});let out;try{out=execFileSync('npx',['--yes','wrangler@4.129.0','versions','upload','--config',cfg],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:12e6});}catch{throw Error('Recovery upload failed; private output withheld');}
const id=out.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];assert(id);const v=await cf(`/workers/workers/${worker}/versions/${id}?include=modules`);assert(v.bindings.some(b=>b.name==='POSTGRID_LIVE_API_KEY'));assert.equal(v.modules.length,4);
await cf(`/workers/scripts/${worker}/deployments`,'POST',{strategy:'percentage',versions:[{version_id:id,percentage:100}]});console.log('RECOVERED_VERSION',id);
for(let i=0;i<10;i++){const r=await fetch('https://torontohousemarket.com/api/version');if(r.ok){console.log('PUBLIC_RESTORED',await r.text());break;}if(i===9)throw Error('Recovery health check failed');await new Promise(r=>setTimeout(r,2000));}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
