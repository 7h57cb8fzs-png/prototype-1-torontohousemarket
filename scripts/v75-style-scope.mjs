// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='c9a84f2fa4310f4052c80129dbda0832154bf74f';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
for(const file of ['app.js','worker-v11.js','seller.js','showing.js','address-input.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
const omitFooter=source=>source.replace(/<footer\b[\s\S]*?<\/footer>/,'FOOTER').replace('/interface.css?v=7506','/interface.css?v=7505');
for(const file of ['index.html','seller.html','showing.html'])assert.equal(omitFooter(now(file)),omitFooter(old(file)),`Changes escaped footer in ${file}`);
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: request, search, navigation, valuation, queue/retry logic and existing form controls match the accepted baseline; only footer markup and styles changed; no cashback copy remains in public pages or email renderers.');
