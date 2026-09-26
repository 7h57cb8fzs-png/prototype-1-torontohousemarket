import fs from 'node:fs';
const input=process.argv[2];
if(!input)throw Error('Provide a decrypted QA result path');
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function review(d){
  const report=d?.report, comps=report?.comparables||[],v=report?.valuation||{},f=report?.facts||{};
  if(!report)return {completed:false,available:false,issues:['report_failed'],error:d?.error};
  const issues=[];
  if(!f.property_type || f.property_type==='unknown')issues.push('unresolved_subject');
  const ids=comps.map(c=>c.listingKey).filter(Boolean),addresses=comps.map(c=>norm(c.address));
  if(new Set(ids).size<ids.length||new Set(addresses).size<addresses.length)issues.push('duplicate_comparable');
  if(addresses.includes(norm(f.address)) || comps.some(c=>(report.seller?.evidence?.history||[]).some(h=>h.listingKey===c.listingKey)))issues.push('subject_used_as_comparable');
  if(comps.some(c=>!c.listingKey||!(Number(c.soldPrice)>50000)))issues.push('unverified_sale');
  if(comps.some(c=>{const age=(Date.parse(report.generated_at)-Date.parse(c.soldDate))/864e5;return !Number.isFinite(age)||age<0||age>Number(report.comparable_policy?.windowDays||365)+1;}))issues.push('sale_date_outside_policy');
  if(comps.some(c=>norm(c.propertySubType)!==norm(f.property_type)))issues.push('subtype_mismatch');
  if(v.available&&(!(v.low>0)||!(v.high>=v.low)||!(v.midpoint>=v.low&&v.midpoint<=v.high)||comps.length<3))issues.push('invalid_valuation_range');
  const adjustments=comps.map(c=>{const a=c.adjustedIndication||c.adjustedPrice||c.soldPrice;return {mls:c.listingKey,pct:Math.round((a/c.soldPrice-1)*1000)/10,reason:c.expertAdjustmentReason||c.expertSelectionReason||null};});
  if(adjustments.some(a=>Math.abs(a.pct)>35))issues.push('adjustment_over_35_percent_review');
  if(comps.some(c=>norm(c.cityRegion)&&norm(f.neighbourhood)&&norm(c.cityRegion)!==norm(f.neighbourhood)))issues.push('community_difference_review');
  const history=report.property_history;
  if(history && history.records?.length!==new Set((history.records||[]).map(h=>h.listingKey)).size)issues.push('duplicate_history_id');
  return {completed:true,available:v.available===true,comps:comps.length,midpoint:v.midpoint||null,low:v.low||null,high:v.high||null,confidence:v.confidence,issues,adjustments,historyListed:history?.counts?.listed??null,historyLastSold:history?.lastSold?.date||null,historySummary:history?.summary||null,aiCalls:d.telemetry?.ai_usage||[],seconds:Math.round((d.telemetry?.processing_ms||0)/1000)};
}
const results=data.results.map(p=>({id:p.case.id,mode:p.case.mode,address:p.case.address,before:review(p.before),after:review(p.after)}));
const aggregate=side=>({completed:results.filter(r=>r[side].completed).length,available:results.filter(r=>r[side].available).length,zeroComps:results.filter(r=>r[side].comps===0).length,history:results.filter(r=>r[side].historyListed>0).length,lastSold:results.filter(r=>r[side].historyLastSold).length,issues:results.filter(r=>r[side].issues?.length).map(r=>({id:r.id,issues:r[side].issues}))});
const output={round:data.round,cases:results.length,before:aggregate('before'),after:aggregate('after'),results};
fs.writeFileSync(input.replace(/\.json$/,'.review.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({...output,results:results.map(r=>({id:r.id,address:r.address,before:[r.before.comps,r.before.midpoint,r.before.issues],after:[r.after.comps,r.after.midpoint,r.after.issues],history:r.after.historySummary}))},null,2));
