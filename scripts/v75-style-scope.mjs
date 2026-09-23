// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='7d5422b02d401e627399dff65581ea17e267bccc';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
for(const file of ['app.js','seller.js','showing.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
const omitAddressFunctions=source=>{
 for(const name of ['normalizeUnitAddress','canonicalLookupStreet','sellerExactHistoryMatch','resolveSellerSubject','publicProperty']) source=source.replace(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}\\n'),'');
 return source.replace(/^  const pendingBasis = .*$/m,'  const pendingBasis = REVIEWED_ADDRESS_MESSAGE;');
};
assert.equal(omitAddressFunctions(now('worker-v11.js')),omitAddressFunctions(old('worker-v11.js')),'Changes escaped address matching/preflight and unmatched email copy');
assert.equal(now('address-input.js').replace('if(p.unit)return;',''),old('address-input.js'),'Changes escaped unit-preservation guard');
const omitFooter=source=>source.replace(/<footer\b[\s\S]*?<\/footer>/,'FOOTER').replace(/address-input.js\?v=\d+/g,'address-input.js?v=REVIEWED');
for(const file of ['index.html','seller.html','showing.html'])assert.equal(omitFooter(now(file)),omitFooter(old(file)),`Changes escaped footer in ${file}`);
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: Comparable selection, valuation, queue/retry logic, navigation, form controls and layout match the accepted baseline; changes limited to address matching/preflight, unit preservation and unmatched report copy; no cashback copy remains in public pages or email renderers.');
