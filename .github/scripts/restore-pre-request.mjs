import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const worker='prototype-1-torontohousemarket',target='287a06e2-ef44-4fef-8ef7-7e24d752ba23';
const api='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
const headers={Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function cf(path,body){const r=await fetch(api+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});assert(r.ok,'Cloudflare status '+r.status);const d=await r.json();assert(d.success,'Cloudflare rejected operation');return d.result;}
async function active(){return (await cf('/workers/scripts/'+worker+'/deployments')).deployments[0].versions;}
const before=await active(),restored=await cf('/workers/workers/'+worker+'/versions/'+target+'?include=modules');
const module=restored.modules.find(m=>m.name==='worker-v11.js');assert(module,'Known rollback source missing');
assert.equal(hash(Buffer.from(module.content_base64,'base64')),'7b2fd318de7863416865c7f95a75829d0006a5189f80c22522e51e1ec4afd119');
assert.equal(hash(readFileSync('worker-v11.js')),'7b2fd318de7863416865c7f95a75829d0006a5189f80c22522e51e1ec4afd119');
for(const name of ['AMPRE_TOKEN','AMPRE_VOW_TOKEN','SUPABASE_SERVICE_ROLE_KEY','ADMIN_API_KEY','RESEND_API_KEY','ASSETS'])assert(restored.bindings.some(b=>b.name===name),'Rollback binding missing: '+name);
const schedule=await cf('/workers/scripts/'+worker+'/schedules');
console.log(JSON.stringify({previousDeployment:before,restoringVersion:target,verifiedSource:true}));
assert.deepEqual(await active(),before,'Concurrent deployment changed; stopped');
await cf('/workers/scripts/'+worker+'/deployments',{strategy:'percentage',versions:[{version_id:target,percentage:100}],annotations:{'workers/message':'User requested restoration to before last seller revision'}});
assert.deepEqual(await active(),[{version_id:target,percentage:100}]);
assert.deepEqual(await cf('/workers/scripts/'+worker+'/schedules'),schedule);
const paths=['index.html','app.js','styles.css','admin.html','admin.js','admin.css','showing.html','showing.js','select-controls.js','seller.html','seller.js','seller.css'];
for(const path of paths){let good=false,status;
 for(let attempt=0;attempt<5;attempt++){
  const r=await fetch('https://torontohousemarket.com/'+(path==='index.html'?'':path)+'?restore='+process.env.GITHUB_SHA+'&attempt='+attempt,{signal:AbortSignal.timeout(20000)});
  status=r.status;good=r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(readFileSync(path));
  if(good)break;await new Promise(r=>setTimeout(r,2000));
 }
 console.log(JSON.stringify({asset:path,verified:good,status}));assert(good,'Restored asset mismatch: '+path);
}
console.log(JSON.stringify({restoredVersion:target,all12AssetsVerified:true,customerDataUnchanged:true}));
