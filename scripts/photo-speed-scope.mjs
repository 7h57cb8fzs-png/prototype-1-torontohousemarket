import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='ea377e314df2861f022a5df4344210519b45c792';
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8',maxBuffer:2e6});
const now=file=>readFileSync(file,'utf8');
for(const file of ['seller.js','seller.html','styles.css','interface.css','address-input.js','showing.js','worker-v22.js','worker-v12.js','report-runtime.js','offer-instructions.js','discovery-search.js','home-chat.js','wrangler.jsonc'])assert.equal(now(file),old(file),`${file} changed outside photo scope`);
let worker=now('worker-v11.js');
worker=worker.replace('  const deferPhotos = publicSnapshot && url.searchParams.get("defer_photos") === "1";\n','')
 .replaceAll('!reportEvidence && !deferPhotos','!reportEvidence')
 .replace('  if (deferPhotos && (activeForSale || activeLease) && !displayRestricted) property2.photosPending = true;\n','')
 .replace('    if (source.searchParams.get("defer_photos") === "1") target.searchParams.set("defer_photos", "1");\n','')
 .replace('VERSION4 + "-mls-photos-5"','VERSION4 + "-mls-photos-4"');
const omitDiscovery=s=>s.replace(/async function discoveryPhoto\([^]*?\n}\n/,'');
assert.equal(omitDiscovery(worker),omitDiscovery(old('worker-v11.js')),'Non-photo server behavior changed');
let app=now('app.js').replace('let photoController = null;\n','').replace('apiUrl + "&defer_photos=1"','apiUrl')
 .replace('    loadListingPhotos(liveListing, sequence);\n','').replace('  photoController?.abort();\n','')
 .replace('home.photoUrl + \'&size=preview\'','home.photoUrl')
 .replace('// The snapshot can render before the complete, correctly ordered gallery arrives.\n','');
const omitPhotos=s=>['loadListingPhotos','setPhotoSource','renderPhotos','usePhotoFallback','renderGallery'].reduce((v,name)=>v.replace(new RegExp('(?:async )?function '+name+'\\([^]*?\\n}\\n\\n'),'').trim(),s);
assert.equal(omitPhotos(app),omitPhotos(old('app.js')),'Non-photo client behavior changed');
assert.equal(now('index.html').replace('/app.js?v=7509','/app.js?v=7502'),old('index.html'));
console.log('PASS: Address matching, report generation, offer instructions, valuation, forms, seller flow, navigation and design are unchanged; changes are confined to photo loading and size selection.');
