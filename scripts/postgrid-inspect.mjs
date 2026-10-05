import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='https://api.cloudflare.com/client/v4/accounts/80022b7ed0560b75d96cc593b0cfaf22';
const worker='prototype-1-torontohousemarket';
async function cf(p){const r=await fetch(root+p,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});const d=await r.json();assert(r.ok&&d.success,'Cloudflare inspection failed '+r.status);return d.result;}
const d=await cf(`/workers/scripts/${worker}/deployments`),active=d.deployments[0];
assert(active.versions.length===1&&active.versions[0].percentage===100,'Split deployment needs review');
const id=active.versions[0].version_id,v=await cf(`/workers/workers/${worker}/versions/${id}?include=modules`);
console.log('THM_POSTGRID_INSPECT',JSON.stringify({activeVersion:id,created:active.created_on,testSecretPresent:v.bindings.some(b=>b.name==='POSTGRID_TEST_API_KEY'&&b.type==='secret_text'),modules:v.modules.map(m=>({name:m.name,sha256:createHash('sha256').update(Buffer.from(m.content_base64,'base64')).digest('hex')}))}));
