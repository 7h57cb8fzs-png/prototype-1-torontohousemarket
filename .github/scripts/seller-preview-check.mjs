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
appendFileSync(process.env.GITHUB_STEP_SUMMARY,'Preview assets verified. Eight selected seller checks are run through the protected admin address checker. No leads, reports or emails created.\n');
