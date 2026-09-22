// Release gate: this presentation change cannot modify request/valuation logic.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='0e13bc456b6b47eb645d5c123483253b64122453';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const now=file=>readFileSync(file,'utf8');
function omitEmailRenderers(source){
  for(const name of ['propertyReportEmail','sellerReportEmail','reportPriceGraphic','emailDocument']){
    const start=source.indexOf(`function ${name}(`),end=source.indexOf(`__name(${name}`,start);
    assert(start>0&&end>start);
    source=source.slice(0,start)+source.slice(end);
  }
  source=source.replace('sendPayload = { from: env.RESEND_FROM_EMAIL || "Alireza Golestan | Toronto House Market <notifications@updates.torontohousemarket.com>", to: [job.recipient], reply_to: "alireza.golestan@century21.ca",', 'SEND_IDENTITY');
  source=source.replace('const configuredFrom = String(env.RESEND_FROM_EMAIL || "notifications@updates.torontohousemarket.com");\n    const senderAddress = configuredFrom.match(/<([^<>]+)>/)?.[1] || configuredFrom.trim();\n    sendPayload = { from: `Toronto House Market <${senderAddress}>`, to: [job.recipient], reply_to: "torontohousemarket@gmail.com",', 'SEND_IDENTITY');
  return source;
}
assert.equal(omitEmailRenderers(now('worker-v11.js')),omitEmailRenderers(old('worker-v11.js')),'Server change escaped email presentation and authorized sender identity');
for(const file of ['app.js','showing.js','address-input.js','worker-v22.js','worker-v12.js','report-runtime.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed`);
assert.equal(now('seller.js'),old('seller.js').replace('Move the slider if you know the home’s condition, or leave it unchanged. Unknown condition stays unknown in your report.','Leave unchanged if you’re unsure.').replace('The report compares this condition with the local market; it is not a mechanical value adjustment.','Condition context only; not a fixed value adjustment.'),'Seller changes escaped the two helper messages');
for(const file of ['index.html','seller.html','showing.html']){
  const controls=html=>[...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)].map(m=>m[0]);
  assert.deepEqual(controls(now(file)).sort(),controls(old(file)).sort(),`Form controls changed in ${file}`);
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(now(file)).sort(),ids(old(file)).sort(),`Element identity changed in ${file}`);
}
for(const file of ['index.html','seller.html','showing.html','worker-v11.js'])assert.doesNotMatch(now(file),/cashback|cash back|10,000 back/i);
console.log('PASS: request, search, navigation, valuation, queue/retry logic and existing form controls match the accepted 7.5 baseline; no cashback copy remains in public pages or email renderers.');
