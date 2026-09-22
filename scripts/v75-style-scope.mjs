// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='9d15a7fc575d1fef92c8afdadcb7cc9d3736db22';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
function omitEmailRenderers(source){
  for(const name of ['propertyReportEmail','sellerReportEmail','reportPriceGraphic','emailDocument']){
    const start=source.indexOf(`function ${name}(`),end=source.indexOf(`__name(${name}`,start);
    assert(start>0&&end>start);
    source=source.slice(0,start)+source.slice(end);
  }
  return source;
}
assert.equal(omitEmailRenderers(now('worker-v11.js')),omitEmailRenderers(old('worker-v11.js')),'Server change escaped email presentation');
for(const file of ['seller.js','showing.js','address-input.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
const withoutOfferRenderer=source=>source.split('\n').filter(line=>!line.startsWith('  const offer = visible ? listing.offerTiming')&&!line.includes('$("offerTimingValue").textContent')&&!line.includes('$("offerTimingNote").textContent')).join('\n');
assert.equal(now('app.js'),withoutOfferRenderer(old('app.js')),'Buyer changes escaped removal of the offer timing display');
assert.doesNotMatch(now('app.js'),/offerTimingValue|offerTimingNote/);

for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).filter(id=>file!=='index.html'||!['offerTimingValue','offerTimingNote'].includes(id)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: request, search, navigation, valuation, queue/retry logic and existing form controls match the accepted baseline; only the offer display was removed from application code; no cashback copy remains in public pages or email renderers.');
