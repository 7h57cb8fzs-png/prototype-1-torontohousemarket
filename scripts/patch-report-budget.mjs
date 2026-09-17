import fs from 'node:fs';
import { parse } from 'acorn';
const paths = ['worker-v11.js','worker-v12.js','worker-v22.js'];
const files = Object.fromEntries(paths.map(p => [p, fs.readFileSync(p,'utf8')]));
function once(p, from, to) {
  const s = files[p];
  if (s.split(from).length !== 2) throw new Error(`Patch anchor is not unique: ${p}: ${from.slice(0,90)}`);
  files[p] = s.replace(from, to);
}
const b='worker-v11.js', c='worker-v12.js', o='worker-v22.js';
if(files[o].includes('version-7.3-request-budget-20260917')) { console.log('Patch already applied.'); process.exit(0); }
// Lower-layer eager promises used to run even when waitUntil was intercepted.
once(b,'async function processAutomationJobs(env) {','async function processAutomationJobs(env) {\n  if (env.THM_SKIP_LEGACY_AUTOMATION) return { deferred: true };');
for(const name of ['generateAiNarrative','generatePublicResearch']) {
  const re=new RegExp(`async function ${name}\\([^)]*\\) \\{`);
  const m=files[b].match(re); if(!m)throw new Error('Missing '+name);
  once(b,m[0],m[0]+'\n  if (env.THM_DEFER_NARRATIVE) return null;');
}
const selectStart=files[b].indexOf('var COMPARABLE_SELECT_FIELDS = [');
const selectEnd=files[b].indexOf('\n];', selectStart);
if(selectStart<0||selectEnd<0)throw new Error('Missing comparable projection');
const selection=files[b].slice(selectStart,selectEnd+3);
once(b,selection,selection.replace('  "UnitNumber"','  "UnitNumber",\n  "PublicRemarks",\n  "BedroomsAboveGrade"'));
// Generate one final narrative, after the expert has reconciled weak evidence.
once(c,'let report = await buildPhase6Report(env, lead, property, requestId);','let report = await buildPhase6Report({ ...env, THM_DEFER_NARRATIVE: property.comparableContext?.available !== true || (property.comparableContext?.comparables || []).length < 3 }, lead, property, requestId);');
once(c,'legacyApp.fetch(request, env, proxyCtx)','legacyApp.fetch(request, { ...env, THM_SKIP_LEGACY_AUTOMATION: true }, proxyCtx)');
once(c,'const requestId = `v7-report-${job.id}`;','const requestId = `v7-report-${job.id}`;\n    setReportStage(env, "subject_and_vow");');
once(c,'const report = await buildVersion7Report(env, lead, property, requestId);','setReportStage(env, "report_reasoning");\n      let report = await buildVersion7Report(env, lead, property, requestId);\n      if (env.THM_FINALIZE_REPORT) report = await env.THM_FINALIZE_REPORT(report);\n      report.telemetry = { ...runtimeSummary(env), queue_wait_ms: Math.max(0, (env.THM_REPORT_RUNTIME?.startedAt || Date.now()) - Date.parse(job.created_at)), job_id: job.id, attempt: job.attempts, completion_write_reserved: true };\n      setReportStage(env, "persist_report");');
once(c,'completed++;\n      console.log','completed++;\n      console.log(JSON.stringify({ event: "report_resource_usage", job_id: job.id, ...runtimeSummary(env) }));\n      console.log');
const poolStart=files[c].indexOf('async function collectBroadSoldPool(');
const poolEnd=files[c].indexOf('\nasync function tailQuery(',poolStart);
if(poolStart<0||poolEnd<0)throw new Error('Missing recovery pool function');
const oldPool=files[c].slice(poolStart,poolEnd);
let newPool=oldPool.replace('  const token = env.AMPRE_VOW_TOKEN;','  setReportStage(env, "broad_comp_recovery");\n  const token = env.AMPRE_VOW_TOKEN;');
newPool=newPool.replace('  const rows = [];','  const rows = [...(env.THM_REPORT_RUNTIME?.vowRows.values() || [])];\n  const reused = soldCandidates(property, rows);\n  if (env.THM_REPORT_RUNTIME) env.THM_REPORT_RUNTIME.reusedCandidates = reused.length;\n  if (reused.length >= 12) return reused.slice(0, 60);');
newPool=newPool.replace('    const batch = await tailQuery(filter, token, seller ? 500 : 700);\n    rows.push(...batch);','    if (!reportHeadroom(env, 6) || (env.THM_REPORT_RUNTIME && env.THM_REPORT_RUNTIME.mlsRequests >= env.THM_REPORT_RUNTIME.mlsLimit)) break;\n    try { rows.push(...await tailQuery(filter, token, seller ? 500 : 700, env)); }\n    catch (error) { if (error?.name === "ReportBudgetError") break; throw error; }');
once(c,oldPool,newPool);
once(c,'async function tailQuery(filter, token, limit) {','async function tailQuery(filter, token, limit, env) {');
once(c,'async function selectExpertComparables(env, property, candidates, seller) {','async function selectExpertComparables(env, property, candidates, seller) {\n  setReportStage(env, "luna_comp_review");');
once(c,'async function openAiJson(env, name, schema, input, webSearch) {','async function openAiJson(env, name, schema, input, webSearch) {\n  setReportStage(env, `openai:${name}`);');
// Keep the same production entry and UI. Long reports run under cron, not the 30s HTTP tail.
once(o,'version-7.3-stable-orchestrator-20260917','version-7.3-request-budget-20260917');
const fetchStart=files[o].indexOf('    const pending=[];');
const fetchEnd=files[o].indexOf('    return response;',fetchStart)+'    return response;'.length;
if(fetchStart<0||fetchEnd<fetchStart)throw new Error('Missing HTTP automation block');
once(o,files[o].slice(fetchStart,fetchEnd),'    return legacyApp.fetch(request, { ...env, THM_SKIP_LEGACY_AUTOMATION: true }, ctx);');
const schedStart=files[o].indexOf('  async scheduled(controller,env,ctx){');
const schedEnd=files[o].indexOf('\n};',schedStart);
if(schedStart<0||schedEnd<0)throw new Error('Missing scheduled handler');
once(o,files[o].slice(schedStart,schedEnd),`  async scheduled(controller,env,ctx){
    const scoped={...env,THM_REPORT_RUNTIME:createReportRuntime()};
    ctx.waitUntil((async()=>{
      await rpc(scoped,'recover_stale_report_jobs',{}).catch(e=>console.error(JSON.stringify({event:'recovery_failed',error:String(e.message).slice(0,200)})));
      const pending=[],proxy={waitUntil(p){pending.push(Promise.resolve(p));}};
      const reportEnv=coreEnv(scoped);
      reportEnv.THM_FINALIZE_REPORT=p=>finalizePayload(scoped,p);
      await reportCore.scheduled(controller,reportEnv,proxy);
      await drain(pending);
      if(reportHeadroom(scoped,8)) await enhanceRecent(scoped,30);
      await emails(scoped,20);
    })().catch(e=>console.error(JSON.stringify({event:'report_pipeline_error',error:String(e.message).slice(0,300),...runtimeSummary(scoped)}))));
  }`);
const decorStart=files[o].indexOf('    let p=decorate(row.report_payload),cx=complexity(p);');
const decorEnd=files[o].indexOf('\n    await db(env,',decorStart);
if(decorStart<0||decorEnd<0)throw new Error('Missing report finalization block');
once(o,files[o].slice(decorStart,decorEnd),'    if (!reportHeadroom(env,5)) break;\n    const p=await finalizePayload(env,row.report_payload);');
files[o]+= `\nasync function finalizePayload(env,source){
  setReportStage(env,'finalize');
  let p=decorate(source),cx=complexity(p);
  p.model_policy={primary:LUNA,terra_review:false,terra_status:'not_required',terra_threshold:'compound severe complexity only',complexity_score:cx.score,complexity_flags:cx.flags};
  if(cx.escalate&&env.OPENAI_API_KEY){
    if(reportHeadroom(env,4)){
      try { const t=await terra(env,p); if(!Number.isFinite(t.estimated_market_value)||!(t.range_low>0&&t.range_low<=t.estimated_market_value&&t.estimated_market_value<=t.range_high))throw new Error('Invalid Terra value ordering'); p=applyTerra(p,t,cx);p.model_policy.terra_status='completed'; }
      catch(error){p.model_policy.terra_status='failed';p.model_policy.terra_error=String(error.message).slice(0,200);}
    }else p.model_policy.terra_status='deferred_budget';
  }
  if(env.THM_REPORT_RUNTIME?.stopped.length||['failed','deferred_budget'].includes(p.model_policy.terra_status)){
    if(p.valuation)p.valuation.confidence='Limited';
    if(p.evidence_quality)p.evidence_quality.label='Limited';
    if(p.decision_summary)p.decision_summary.evidence_confidence='Limited';
    p.resource_warning='The analysis used the retrieved evidence; an optional stage reached its resource budget.';
  }
  p.version=7.3;p.version_label='Toronto House Market Version 7.3';
  p.ai_note=p.model_policy.terra_review?'Version 7.3 · exceptional-complexity Terra review':cx.escalate?'Version 7.3 · exceptional review not completed':'Version 7.3 · Terra not required';
  return p;
}\n`;
once(o,"async function emails(env,limit){if(!env.RESEND_API_KEY)return;","async function emails(env,limit){if(!env.RESEND_API_KEY||!reportHeadroom(env,12))return;limit=Math.min(limit,2);");
// Rewrite real JavaScript fetch calls only; never touch embedded browser scripts or member .fetch calls.
for(const file of paths){
  let source=files[file];
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),positions=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='fetch')positions.push(node.callee.start);
    for(const [k,v] of Object.entries(node)){
      if(['start','end','loc'].includes(k))continue;
      if(Array.isArray(v))for(const n of v)visit(n);else if(v&&typeof v==='object')visit(v);
    }
  }
  visit(tree);
  for(const pos of positions.sort((a,b)=>b-a))source=source.slice(0,pos)+'reportFetch.bind(null, typeof env === "undefined" ? null : env)'+source.slice(pos+5);
  source='import { reportFetch, createReportRuntime, runtimeSummary, reportHeadroom, setReportStage } from "./report-runtime.js";\n'+source;
  parse(source,{ecmaVersion:'latest',sourceType:'module'});
  if(source.length<files[file].length)throw new Error('Unexpected source truncation');
  files[file]=source;
  console.log(file, 'guarded_fetch_sites',positions.length,'bytes',source.length);
}
for(const file of paths) fs.writeFileSync(file,files[file]);
const deploy='.github/workflows/deploy-version72.yml';
let workflow=fs.readFileSync(deploy,'utf8');
workflow=workflow.replace("paths: ['worker-v22.js'","paths: ['report-runtime.js','worker-v11.js','worker-v12.js','worker-v22.js'");
workflow=workflow.replace('node --check worker-v22.js','node --check worker-v22.js\n          node --check worker-v11.js\n          node --check worker-v12.js\n          node --check report-runtime.js\n          node --test tests/report-runtime.test.mjs');
workflow=workflow.replaceAll('version-7.3-stable-orchestrator-20260917','version-7.3-request-budget-20260917');
fs.writeFileSync(deploy,workflow);
// The worker now invokes recovery using its existing secret. No broken GitHub-secret watchdog.
if(fs.existsSync('.github/workflows/v73-watchdog.yml'))fs.unlinkSync('.github/workflows/v73-watchdog.yml');
console.log('Surgical patch complete. Tests must pass before this branch can be promoted.');
