import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const api='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
async function read(id){const r=await fetch(api+'/workers/workers/prototype-1-torontohousemarket/versions/'+id+'?include=modules',{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});assert.ok(r.ok);const b=await r.json();return Buffer.from(b.result.modules.find(m=>m.name==='worker-v11.js').content_base64,'base64').toString();}
const prior=await read('261982d4-544f-4edf-9164-466164cb25b9');
const current=await read('8e7ee114-a217-4893-a5a2-ee12d331c2dd');
const trim=s=>s.replace(/\/\/[#@] sourceMappingURL=.*$/gm,'').trim();
console.log(JSON.stringify({priorLength:prior.length,currentLength:current.length,equalIgnoringSourceMap:trim(prior)===trim(current),currentContainsPrior:current.includes(prior.trim()),priorContainsCurrent:prior.includes(current.trim())}));

const {parse}=await import('/tmp/address-source-review/node_modules/acorn/dist/acorn.mjs');
const pa=parse(prior,{ecmaVersion:'latest',sourceType:'module'}),ca=parse(current,{ecmaVersion:'latest',sourceType:'module'});
const summary=ast=>ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name);
console.log(JSON.stringify({removedFunctions:summary(pa).filter(n=>!summary(ca).includes(n)),addedFunctions:summary(ca).filter(n=>!summary(pa).includes(n))}));
for(const n of ca.body.filter(n=>n.type==='FunctionDeclaration'&&!summary(pa).includes(n)))console.log(current.slice(n.start,n.end));
