import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const baseline='4ee5821b4df7ef80782e7f717c6d6f3ca27c32da';
const allowed=new Set(['admin-api.js','admin-workspace.js','admin-workspace.css','admin.html']);
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n');
for(const path of files){if(allowed.has(path))continue;const old=execFileSync('git',['show',`${baseline}:${path}`],{maxBuffer:8e6});assert.deepEqual(readFileSync(path),old,'Change outside admin scope: '+path);}
console.log('PASS: Public website, exactly two seller checkboxes, marketing PDF/email/consent logic, valuation, MLS/photos, assignment intake and scheduler match the latest production baseline byte for byte.');
