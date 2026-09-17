from pathlib import Path
import hashlib
root=Path('.')
expected={'worker-v11.js':'15af5cc85d4544abd03ea9dbbf1891ef6415cb3e74ac992ce4cba311a42540da','worker-v12.js':'4088e5ae26c100c6448f5a741e0812aa076e81427273d38919bdf26ee088a4f6','worker-v22.js':'f29149e1e5a06ba29952d21e1387bafb86404b70c5ae123b9ec68bbb4794469d'}
for name,sha in expected.items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha, 'Unexpected source revision: '+name
def replace(s,a,b):
    assert s.count(a)==1,(a[:100],s.count(a))
    return s.replace(a,b,1)
def fn(s,start,end,new):
    a=s.index(start); b=s.index(end,a)
    return s[:a]+new+'\n'+s[b:]
s=(root/'worker-v11.js').read_text()
s="import { reportFetch, retainReportRows } from './report-runtime.js';\n"+s
s=replace(s,'async function processAutomationJobs(env) {','async function processAutomationJobs(env) {\n  if (env.THM_REPORT_QUEUE_ONLY) return { reports: { claimed: 0 }, emails: { claimed: 0 } };')
s=replace(s,'    raw.push(...result.rows);','    raw.push(...result.rows);\n    retainReportRows(env, result.rows, search.filters.join(" and "));')
s=replace(s,'async function querySoldComparableRows(baseFilters, env, top, startSkip = 0, selectFields = COMPARABLE_SELECT_FIELDS) {','async function querySoldComparableRows(baseFilters, env, top, startSkip = 0, selectFields = COMPARABLE_SELECT_FIELDS) {\n  // The connected feed rejects the legacy projection. Do not repeat that 400 on every scan.\n  if (env.THM_REPORT_RUNTIME) selectFields = null;')
s=replace(s,'return fetch(endpoint, {\n    headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`','return reportFetch(env, endpoint, {\n    headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`')
s=replace(s,'return fetch(`${env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co"}${path}`, { ...init, signal: init.signal || AbortSignal.timeout(1e4), headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...init.headers || {} } });','return reportFetch(env, `${env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co"}${path}`, { ...init, signal: init.signal || AbortSignal.timeout(1e4), headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...init.headers || {} } }, true);')
s=s.replace('return fetch(url, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });','return reportFetch(env, url, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });')
s=s.replace('await fetch(`${AMPRE4}/Property?','await reportFetch(env, `${AMPRE4}/Property?')
s=s.replace('await fetch(`${AMPRE3}/Property?','await reportFetch(env, `${AMPRE3}/Property?')
s=s.replace('await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",','await reportFetch(env, "https://generativelanguage.googleapis.com/v1beta/interactions",')
s=s.replace('await fetch("https://openrouter.ai/api/v1/chat/completions",','await reportFetch(env, "https://openrouter.ai/api/v1/chat/completions",')
s=replace(s,'async function resolveComparableCoordinates(record) {','async function resolveComparableCoordinates(record, env = {}) {')
s=replace(s,'const resolved = await resolveFreeCoordinates(address);','const resolved = await resolveFreeCoordinates(address, env);')
s=replace(s,'const subjectCoordinates = await resolveComparableCoordinates(subject);','const subjectCoordinates = await resolveComparableCoordinates(subject, env);')
s=replace(s,'const coordinates = await resolveComparableCoordinates(row);','const coordinates = await resolveComparableCoordinates(row, env);')
s=replace(s,'async function resolveFreeCoordinates(address) {','async function resolveFreeCoordinates(address, env = {}) {')
s=replace(s,'  if (match) {\n    const number = match[1].replace','  if (match && (!env.THM_REPORT_RUNTIME || /,\\s*Toronto\\b/i.test(address))) {\n    const number = match[1].replace')
s=replace(s,'await fetch(`https://gis.toronto.ca/arcgis/rest/services/cot_geospatial27/FeatureServer/101/query?${params}`,','await reportFetch(env, `https://gis.toronto.ca/arcgis/rest/services/cot_geospatial27/FeatureServer/101/query?${params}`,')
s=replace(s,'await fetch(`https://nominatim.openstreetmap.org/search?${params}`,','await reportFetch(env, `https://nominatim.openstreetmap.org/search?${params}`,')
s=replace(s,'  const subjectCoordinates = await resolveComparableCoordinates(subject, env);','  const geocodeStarted = Date.now();\n  const subjectCoordinates = await resolveComparableCoordinates(subject, env);')
s=replace(s,'  for (let index = 0; index < candidates.length; index++) {\n    const row = candidates[index];','  for (let index = 0; index < candidates.length; index++) {\n    if (env.THM_REPORT_RUNTIME && (Date.now()-geocodeStarted > 6000 || env.THM_REPORT_RUNTIME.requests >= 24)) break;\n    const row = candidates[index];')
s=replace(s,'      params.delete("$orderby");\n      response = await amplifyFetch','      params.delete("$orderby");\n      await response.body?.cancel();\n      response = await amplifyFetch')
s=replace(s,'      params.delete("$select");\n      response = await amplifyFetch','      params.delete("$select");\n      await response.body?.cancel();\n      response = await amplifyFetch')
(root/'worker-v11.js').write_text(s)
s=(root/'worker-v12.js').read_text()
s="import { createReportRuntime, reportFetch, reportStage, runtimeSummary } from './report-runtime.js';\n"+s
s=replace(s,'const response = await legacyApp.fetch(request, env, proxyCtx);','const response = await legacyApp.fetch(request, { ...env, THM_REPORT_QUEUE_ONLY: true }, proxyCtx);')
s=replace(s,'if (response.ok) ctx?.waitUntil?.(runV7Automation(env).catch(logAutomationError));','if (response.ok && !env.THM_REPORT_SCHEDULED_ONLY) ctx?.waitUntil?.(runV7Automation(env).catch(logAutomationError));')
start='async function processV7ReportJobs(env, limit = 1) {'
end='async function buildVersion7Report(env, lead, property, requestId) {'
new='''async function processV7ReportJobs(env, limit = 1) {
  const jobs = await rpc(env, "claim_report_jobs", { p_limit: limit });
  let completed = 0, failed = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const requestId = `v7-report-${job.id}`;
    const runtime = createReportRuntime(job);
    const scoped = { ...env, THM_REPORT_RUNTIME: runtime };
    const stopHeartbeat = startReportHeartbeat(scoped, job);
    const checkpoint = async stage => {
      const response = await supabase(scoped, `/rest/v1/automation_jobs?id=eq.${job.id}&report_id=eq.${job.report_id}&status=eq.processing&attempts=eq.${job.attempts}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ payload: { ...job.payload, execution: { ...runtimeSummary(runtime), stage } } })
      });
      if (!response.ok) throw new Error('Could not persist report progress.');
      await response.arrayBuffer();
    };
    try {
      await checkpoint('subject_lookup');
      const lead = await reportStage(scoped, 'load_lead', 8000, e => loadLeadForReportV7(e, job.lead_id));
      if (!lead) throw new Error("Lead data is unavailable.");
      const property = await reportStage(scoped, 'mls_evidence', 50000, e => loadPropertyForReport(e, lead, requestId));
      await checkpoint('analysis');
      let report = await reportStage(scoped, 'analysis', 55000, e => buildVersion7Report(e, lead, property, requestId));
      if (typeof env.THM_FINALIZE_REPORT === 'function') report = await reportStage(scoped, 'decision_summary', 24000, e => env.THM_FINALIZE_REPORT(report, e));
      report.execution_telemetry = runtimeSummary(runtime);
      const saved = await rpc(scoped, 'complete_report_attempt', {
        p_job_id: job.id, p_report_id: job.report_id, p_attempt: job.attempts, p_report_payload: report
      }, 7000);
      if (saved !== true) throw new Error('Report attempt no longer owns the job.');
      completed++;
      console.log(JSON.stringify({ event: 'v7_report_ready', request_id: requestId, report_id: job.report_id, ...runtimeSummary(runtime) }));
    } catch (error) {
      failed++;
      const message = String(error?.message || error);
      runtime.controller.abort();
      try {
        await rpc(scoped, 'fail_report_attempt', { p_job_id: job.id, p_report_id: job.report_id, p_attempt: job.attempts, p_error: message, p_telemetry: runtimeSummary(runtime) }, 7000);
      } catch (saveError) {
        console.error(JSON.stringify({ event: 'report_failure_save_error', job_id: job.id, error: String(saveError?.message || saveError) }));
      }
      console.error(JSON.stringify({ event: 'v7_report_failed', request_id: requestId, error: message.slice(0,300), ...runtimeSummary(runtime) }));
    } finally {
      stopHeartbeat(); runtime.controller.abort();
    }
  }
  return { claimed: Array.isArray(jobs) ? jobs.length : 0, completed, failed };
}

'''
s=fn(s,start,end,new)
s=replace(s,'  const rows = [];\n  for (const filter of [...new Set(searches)].slice(0, 3)) {','  const rows = [...(env.THM_REPORT_RUNTIME?.rawRows?.values() || [])];\n  if (soldCandidates(property, rows).length >= 12) return soldCandidates(property, rows).slice(0, 60);\n  for (const filter of [...new Set(searches)].slice(0, 3)) {\n    if (env.THM_REPORT_RUNTIME?.completedFilters.has(filter)) continue;')
s=replace(s,'await tailQuery(filter, token, seller ? 500 : 700);','await tailQuery(filter, token, seller ? 500 : 700, env);')
s=replace(s,'async function tailQuery(filter, token, limit) {','async function tailQuery(filter, token, limit, env = {}) {')
s=replace(s,'await fetch(countUrl, { headers, signal: AbortSignal.timeout(9000) });','await reportFetch(env, countUrl, { headers, signal: AbortSignal.timeout(9000) });')
s=replace(s,'await fetch(url, { headers, signal: AbortSignal.timeout(10000) });','await reportFetch(env, url, { headers, signal: AbortSignal.timeout(10000) });')
s=replace(s,'await fetch(OPENAI_RESPONSES, {','await reportFetch(env, OPENAI_RESPONSES, {')
s=replace(s,'    const text = responseOutputText(data);','    if (env.THM_REPORT_RUNTIME) (env.THM_REPORT_RUNTIME.aiUsage ||= []).push({ model: body.model, purpose: name, usage: data?.usage || null });\n    const text = responseOutputText(data);')
s=replace(s,'return fetch(`${base}${path}`, {','return reportFetch(env, `${base}${path}`, {')
s=replace(s,'...(init.headers || {}) },\n  });','...(init.headers || {}) },\n  }, true);')
s += '\nexport { processV7ReportJobs, buildVersion7Report, collectBroadSoldPool };\n'
(root/'worker-v12.js').write_text(s)
s=(root/'worker-v22.js').read_text()
s=replace(s,"import reportCore from './worker-v12.js';","import reportCore from './worker-v12.js';\nimport { reportFetch } from './report-runtime.js';")
s=s.replace('version-7.3-stable-orchestrator-20260917','version-7.3-request-budget-20260917')
s=replace(s,'      await reportCore.scheduled(controller,coreEnv(env),proxy);','      await rpc(env, \'recover_stale_report_jobs\', {});\n      await reportCore.scheduled(controller,coreEnv(env),proxy);')
s=replace(s,"function coreEnv(env){return {...env,OPENAI_MODEL:LUNA,OPENAI_EXTERNAL_COMP_SEARCH:'false',RESEND_API_KEY:null};}","function coreEnv(env){return {...env,OPENAI_MODEL:LUNA,OPENAI_EXTERNAL_COMP_SEARCH:'false',RESEND_API_KEY:null,THM_REPORT_SCHEDULED_ONLY:true,THM_FINALIZE_REPORT: finalizePayload};}\n\nasync function finalizePayload(report,env){\n  let p=decorate(report),cx=complexity(p);\n  p.model_policy={primary:LUNA,terra_review:false,terra_threshold:'compound severe complexity only',complexity_score:cx.score,complexity_flags:cx.flags};\n  if(cx.escalate && env.OPENAI_API_KEY){try{p=applyTerra(p,await terra(env,p),cx);}catch(e){p.model_policy.terra_error=String(e?.message||e).slice(0,200);}}\n  p.version=7.3;p.version_label='Toronto House Market Version 7.3';\n  p.ai_note=p.model_policy.terra_review?'Version 7.3 · exceptional-complexity Terra review':'Version 7.3 · primary path; Terra not used';\n  return p;\n}")
s=replace(s,'const r=await fetch(OPENAI,','const r=await reportFetch(env,OPENAI,')
(root/'worker-v22.js').write_text(s)
print('Applied targeted V7.3 resource-budget fix to verified source revisions.')
