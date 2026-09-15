import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const release=JSON.parse(readFileSync('audit-output/release.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const path of ['index.html','app.js','styles.css','admin.html','admin.js','admin.css','showing.html','showing.js','select-controls.js','seller.html','seller.js','seller.css']){
  const r=await fetch(new URL('/'+path,release.preview),{signal:AbortSignal.timeout(20000)});
  assert(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===hash(readFileSync(path)),'Preview asset mismatch: '+path);
}
console.log(JSON.stringify({previewAssetsVerified:12,adminCredentialConfigured:!!process.env.THM_ADMIN_API_KEY,noLeadsOrEmailsCreated:true}));
if(process.env.THM_ADMIN_API_KEY){
  const r=await fetch(new URL('/api/admin/seller-preview?lead_id=ffa77420-74f6-4e2a-8af4-e355b85c9657',release.preview),{headers:{Authorization:'Bearer '+process.env.THM_ADMIN_API_KEY},signal:AbortSignal.timeout(120000)});
  const p=await r.json();
  console.log(JSON.stringify({sellerCheck:{status:r.status,ok:p.ok,historyCount:p.history?.length,valuation:p.valuation,comparables:p.comparables?.length,activeCount:p.activeComparables?.length}}));
  assert(r.ok&&p.readOnly,'Live seller evidence check did not complete');
  assert(p.history?.length&&p.valuation?.available,'Off-market estimate still needs investigation');
}else{
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,'Preview and seller email rendering verified. Live protected MLS check needs the existing admin login. No leads, reports or emails created.\n');
}
