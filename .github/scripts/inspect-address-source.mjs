import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const api='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
async function read(id){const r=await fetch(api+'/workers/workers/prototype-1-torontohousemarket/versions/'+id+'?include=modules',{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});assert.ok(r.ok);const b=await r.json();return Buffer.from(b.result.modules.find(m=>m.name==='worker-v11.js').content_base64,'base64').toString();}
const prior=await read('261982d4-544f-4edf-9164-466164cb25b9');
const current=await read('8e7ee114-a217-4893-a5a2-ee12d331c2dd');
const trim=s=>s.replace(/\/\/[#@] sourceMappingURL=.*$/gm,'').trim();
console.log(JSON.stringify({priorLength:prior.length,currentLength:current.length,equalIgnoringSourceMap:trim(prior)===trim(current),currentContainsPrior:current.includes(prior.trim()),priorContainsCurrent:prior.includes(current.trim())}));

const {parse}=await import('/tmp/address-source-review/node_modules/acorn/dist/acorn.mjs');
function norm(v){
 if(!v||typeof v!=='object')return v;
 if(Array.isArray(v))return v.map(norm).filter(x=>x!==null);
 if(v.type==='VariableDeclaration'&&v.declarations.every(d=>/^__(?:name|defProp)\d*$/.test(d.id?.name||'')))return null;
 if(v.type==='ExpressionStatement'&&v.expression.type==='CallExpression'&&/^__name\d*$/.test(v.expression.callee?.name||''))return null;
 if(v.type==='CallExpression'&&/^__name\d*$/.test(v.callee?.name||''))return norm(v.arguments[0]);
 return Object.fromEntries(Object.entries(v).filter(([k])=>!['start','end','raw'].includes(k)).map(([k,x])=>[k,norm(x)]));
}
const ast=s=>JSON.stringify(norm(parse(s,{ecmaVersion:'latest',sourceType:'module'})),(k,v)=>typeof v==='bigint'?String(v):v);
const a=ast(prior),b=ast(current);
console.log(JSON.stringify({identicalWithoutBundlerNameHelpers:a===b}));
if(a!==b){let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;console.log(JSON.stringify({firstDifferentPosition:i,priorSyntax:a.slice(Math.max(0,i-150),i+300),currentSyntax:b.slice(Math.max(0,i-150),i+300)}));}

const mismatches={};let other=0;
function compare(a,b,path=''){
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(a?.type==='Identifier'&&b?.type==='Identifier'){const k=a.name+' -> '+b.name;mismatches[k]=(mismatches[k]||0)+1;return;}
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){other++;return;}
 for(const k of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[k],b[k],path+'.'+k);
}
compare(JSON.parse(a),JSON.parse(b));console.log(JSON.stringify({identifierRenames:mismatches,otherChanges:other}));
