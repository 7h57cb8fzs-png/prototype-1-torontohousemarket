// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='5b781ed48c377240e3112ab8b6e74ffceed6514c';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
function omitEmailRenderers(source){
  for(const name of ['propertyReportEmail','sellerReportEmail']){
    const start=source.indexOf(`function ${name}(`),end=source.indexOf(`__name(${name}`,start);
    assert(start>0&&end>start);
    source=source.slice(0,start)+source.slice(end);
  }
  return source;
}
assert.equal(omitEmailRenderers(now('worker-v11.js')),omitEmailRenderers(old('worker-v11.js')),'Server change escaped the two email renderers');
for(const file of ['app.js','seller.js','showing.js','address-input.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)),controls(old(file)),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)),ids(old(file)),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: request, search, navigation, valuation and form controls match the accepted 7.5 baseline; no cashback copy remains in public pages or email renderers.');
