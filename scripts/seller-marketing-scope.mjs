import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='6a659c9adeb1f3d252120e019514b655d7030177';
const old=p=>execFileSync('git',['show',`${baseline}:${p}`],{maxBuffer:5e6}).toString();
const allowed=new Set(['worker-v11.js','worker-v22.js','seller.html','seller.js','admin-api.js','admin-workspace.js','admin.html','.assetsignore']);
for(const p of execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n')){
 if(!allowed.has(p))assert.equal(readFileSync(p,'utf8'),old(p),'Outside marketing scope: '+p);
}
const w11=readFileSync('worker-v11.js','utf8').replace("import { marketingConsent } from './seller-marketing.js';\n",'').replace('...marketingConsent(value.marketingConsent), ','');
assert.equal(w11,old('worker-v11.js'),'Existing report and transactional email behavior changed');
const w22=readFileSync('worker-v22.js','utf8').replace("import { processSellerMarketing, marketingUnsubscribe } from './seller-marketing.js';\n",'').replace("    if(url.pathname==='/api/marketing/unsubscribe') return marketingUnsubscribe(request,env);\n",'').replace('    ctx.waitUntil(processSellerMarketing(env));\n','');
assert.equal(w22,old('worker-v22.js'),'Existing routing or report scheduling changed');
const s=readFileSync('seller.js','utf8').replace(",marketingConsent:$('sellerMarketingConsent').checked",'');assert.equal(s,old('seller.js'),'Existing seller form behavior changed');
console.log('Scope verified: valuation, report delivery, buyer/search/photos, showing and existing admin behavior preserved.');
