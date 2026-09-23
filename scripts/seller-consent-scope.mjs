import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const baseline='b8c4cb6f3172e76692baedcd863aa801b94d0175';
const allowed=new Set(['seller.html','seller.js','seller.css','tests/seller-marketing.test.mjs','scripts/v75-style-layout.mjs']);
for(const file of execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n')){
 if(!allowed.has(file))assert.deepEqual(readFileSync(file),execFileSync('git',['show',baseline+':'+file],{maxBuffer:10e6}),'Unrelated file changed: '+file);
}
console.log('Release scope: seller consent UI only; server, valuation, email, admin, buyer and showing code unchanged.');
