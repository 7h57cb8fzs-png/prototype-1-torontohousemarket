// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='7d2a3318d84058977ec448507b288241f5f6a85c';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
for(const file of ['worker-v11.js','seller.js','showing.js','address-input.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
const statusLabel='    offMarketActionBox.querySelector(".offmarket-label").textContent = listing.forLease ? "FOR LEASE" : hasMls ? "NOT FOR SALE ON MLS" : "LISTING STATUS UNCONFIRMED";\n';
assert.equal(now('app.js').replace(statusLabel,''),old('app.js'),'Buyer changes escaped the missing-listing status label');
assert.equal(now('index.html'),old('index.html').replace('<a class="brand" href="#top"','<a class="brand" href="/"').replace('<span class="offmarket-label">NOT FOR SALE ON MLS</span>','<span class="offmarket-label">PROPERTY REVIEW</span>'),'Page changes escaped logo reset and neutral fallback label');
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: request, search, navigation, valuation, queue/retry logic and existing form controls match the accepted baseline; only the logo destination and missing-listing status label changed; no cashback copy remains in public pages or email renderers.');
