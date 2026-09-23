import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='f056595f5c929a331f4be79c4dd808567aafd7e9';
const old=path=>execFileSync('git',['show',`${baseline}:${path}`],{maxBuffer:5e6});
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n');
for(const path of files){
 if(['admin.html','worker-v22.js','.assetsignore'].includes(path))continue;
 assert.deepEqual(readFileSync(path),old(path),'File outside admin scope changed: '+path);
}
const worker=readFileSync('worker-v22.js','utf8').replace("import { adminOps } from './admin-api.js';\n",'').replace("    if(url.pathname.startsWith('/api/admin/ops/')) return adminOps(request,env);\n",'');
assert.equal(worker,old('worker-v22.js').toString(),'Public routing or scheduler changed');
assert.equal(readFileSync('.assetsignore','utf8').replace('admin-api.js\n',''),old('.assetsignore').toString());
console.log('PASS: All existing public files, report logic, forms, MLS/photo flows and scheduler are unchanged. Only admin assets and protected admin routing differ.');
