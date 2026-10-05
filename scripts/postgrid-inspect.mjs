import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
const worker='prototype-1-torontohousemarket';
async function cf(p){const r=await fetch(root+p,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare inspection failed '+r.status);return d.result;}
const d=await cf(`/workers/scripts/${worker}/deployments`),active=d.deployments[0];
assert(active.versions.length===1&&active.versions[0].percentage===100,'Split deployment needs review');
const id=active.versions[0].version_id,v=await cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
console.log('THM_POSTGRID_INSPECT',JSON.stringify({activeVersion:id,created:active.created_on,testSecretPresent:v.bindings.some(b=>b.name==='POSTGRID_TEST_API_KEY'&&b.type==='secret_text'),modules:v.modules.map(m=>({name:m.name,sha256:createHash('sha256').update(Buffer.from(m.content_base64,'base64')).digest('hex')}))}));
const live='https://torontohousemarket.com';
const vr=await fetch(live+'/api/version');console.log('PUBLIC_VERSION',vr.status,await vr.text());
for(const p of ['/api/admin/prospects/options','/api/admin/ops/counts']){const r=await fetch(live+p,{method:p.includes('prospects')?'POST':'GET',...(p.includes('prospects')?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});console.log('AUTH_STATUS',p,r.status);}
for(const p of ['admin.html','admin-workspace.js','admin-prospects.js','index.html']){const r=await fetch(live+'/'+p);const b=Buffer.from(await r.arrayBuffer());console.log('LIVE_ASSET',p,r.status,createHash('sha256').update(b).digest('hex'));}
console.log('RECENT_DEPLOYMENTS',JSON.stringify(d.deployments.slice(0,5).map(x=>({created:x.created_on,source:x.source,versions:x.versions}))));
console.log('MODULE_FEATURES',JSON.stringify(v.modules.map(m=>{const s=Buffer.from(m.content_base64,'base64').toString();return {name:m.name,bytes:s.length,hasProspects:s.includes('/api/admin/prospects/'),hasCurrentRelease:s.includes('version-7.6-luna-external-lookup-20260927'),hasScheduled:s.includes('scheduled(')};})));
