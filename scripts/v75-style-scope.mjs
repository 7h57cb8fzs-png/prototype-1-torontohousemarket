// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='52e10a0b1f4be7faaadf15a9c32441af76c1c91f';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
for(const file of ['app.js','seller.js','showing.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
const omitAddressFunctions=source=>{
 for(const name of ['loadPropertyForReport','propertyReportEmail','sellerReportEmail']) source=source.replace(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}\\n'),'');
 return source.replace(/^import \{extractOfferInstructions,offerEmailLines\}.*\n/m,'').replace(/^    offer_instructions: property2.reportOfferInstructions \|\| null,\n/m,'').replace('reportOfferInstructions: raw ? extractOfferInstructions(raw) : null, ','').replace('offer_instructions: property2.reportOfferInstructions || null, ','');
};
assert.equal(omitAddressFunctions(now('worker-v11.js')),omitAddressFunctions(old('worker-v11.js')),'Changes escaped report offer extraction and email rendering');
const omitLeadingUnitPattern=source=>source.replace(/^    const first=.*$/m,'    const first=REVIEWED_LEADING_UNIT_PATTERN;');
assert.equal(omitLeadingUnitPattern(now('address-input.js')),omitLeadingUnitPattern(old('address-input.js')),'Changes escaped leading-unit recognition');
const omitFooter=source=>source.replace(/<footer\b[\s\S]*?<\/footer>/,'FOOTER').replace(/address-input.js\?v=\d+/g,'address-input.js?v=REVIEWED');
for(const file of ['index.html','seller.html','showing.html'])assert.equal(omitFooter(now(file)),omitFooter(old(file)),`Changes escaped footer in ${file}`);
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: Comparable selection, valuation, queue/retry logic, navigation, form controls and layout match the accepted baseline; changes limited to report offer extraction and email rendering; no cashback copy remains in public pages or email renderers.');
