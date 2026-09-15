import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const api='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
async function read(id){const r=await fetch(api+'/workers/workers/prototype-1-torontohousemarket/versions/'+id+'?include=modules',{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});assert.ok(r.ok);const b=await r.json();return Buffer.from(b.result.modules.find(m=>m.name==='worker-v11.js').content_base64,'base64').toString();}
const prior=await read('261982d4-544f-4edf-9164-466164cb25b9');
const current=await read('8e7ee114-a217-4893-a5a2-ee12d331c2dd');
const trim=s=>s.replace(/\/\/[#@] sourceMappingURL=.*$/gm,'').trim();
console.log(JSON.stringify({priorLength:prior.length,currentLength:current.length,equalIgnoringSourceMap:trim(prior)===trim(current),currentContainsPrior:current.includes(prior.trim()),priorContainsCurrent:prior.includes(current.trim())}));

const {parse}=await import('/tmp/address-source-review/node_modules/acorn/dist/acorn.mjs');
const clean=(key,value)=>['start','end','raw'].includes(key)?undefined:typeof value==='bigint'?String(value):value;
const ast=s=>JSON.stringify(parse(s,{ecmaVersion:'latest',sourceType:'module'}),clean);
const a=ast(prior),b=ast(current);
console.log(JSON.stringify({identicalSyntax:a===b}));
if(a!==b){let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;console.log(JSON.stringify({firstDifferentPosition:i,priorSyntax:a.slice(Math.max(0,i-150),i+300),currentSyntax:b.slice(Math.max(0,i-150),i+300)}));}
