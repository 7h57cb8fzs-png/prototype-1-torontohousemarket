import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.THM_SCOPE_BASE||'5eeb589f81af01e5c78d37432a88fc527696625c';
const old=f=>execFileSync('git',['show',`${base}:${f}`],{encoding:'utf8',maxBuffer:4e6});
const current=f=>readFileSync(f,'utf8');
const remove=(s,names)=>names.reduce((s,n)=>s.replace(new RegExp('(?:async )?function '+n+'\\([^]*?\\n}\\n'),'').trim(),s);
let v11=current('worker-v11.js').replace("import { historicalSellerProfile, historicalSellerProperty } from './seller-mls-input.js';\n",'')
  .replace('// Questionnaire fields are saved for the team, never used to identify the home.\n      const checked = validateAddressEntry(data.property_input);','const checked = validateAddressEntry(data.property_input, { city: profile.city, requireUnit: /condo/i.test(profile.homeType) });')
  .replace('      data.property_input = checked.address;','      profile.city = checked.city;\n      data.property_input = checked.address;')
  .replace('if (lead.lead_mode === "seller") return loadSellerPropertyForReport(env, lead, requestId);','if (lead.lead_mode === "seller" && lead.property_snapshot?.sellerProfile) return loadSellerPropertyForReport(env, lead, requestId);')
  .replace('// Historic MLS compound street names may store the suffix as part of StreetName.\n// This normalization is used only by the Seller history resolver.\n','');
v11=remove(v11,['sellerHistoryParsedAddress','sellerHistoryMatches']);
const sellerOnly=['resolveSellerSubject','loadSellerPropertyForReport','buildSellerReport','sellerReportEmail'];
assert.equal(remove(v11,sellerOnly),remove(old('worker-v11.js'),sellerOnly),'Non-Seller runtime code changed');
let v12=current('worker-v12.js').replace('    ...(property.sellerEvidence ? {architecturalStyle: property.architecturalStyle || null, belowGradeBeds: property.belowGradeBeds ?? null, bedroomBasis: property.bedroomBasis || null} : {}),\n','');
assert.equal(remove(v12,['enhanceSellerReport']),remove(old('worker-v12.js'),['enhanceSellerReport']),'Buyer or shared Expert Comp behavior changed');
assert.equal(current('worker-v22.js').replace("seller_condition:'questionnaire saved for team verification; not valuation input',\n      seller_input:'address_and_historical_mls_only',","seller_condition:'native 0-100 renovation context; no fixed renovation markup',"),old('worker-v22.js'),'Shared production pipeline changed');
const permitted=new Set(['worker-v11.js','worker-v12.js','worker-v22.js','seller-archive.js','.assetsignore','tests/seller-v73-policy.test.mjs']);
for(const f of execFileSync('git',['ls-tree','-r','--name-only',base],{encoding:'utf8'}).trim().split('\n')) {
  if(permitted.has(f))continue;
  assert.equal(current(f),old(f),'Existing file outside Seller scope changed: '+f);
}
console.log('PASS: Buyer logic, numeric engines, public APIs, page assets, forms, marketing/consent, admin code and scheduler unchanged. Seller evidence inputs/history and related tests only.');
