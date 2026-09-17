from pathlib import Path
p=Path('worker-v11.js')
s=p.read_text()
old="import { reportFetch, retainReportRows } from './report-runtime.js';\n"
new="""// Keep the historical standalone bundle compatible with existing consumers.
// The report owner supplies scoped operations; public requests use native fetch.
function reportFetch(env, input, init = {}, lifecycle = false) {
  const runtime = env?.THM_REPORT_RUNTIME;
  return runtime?.fetch ? runtime.fetch(env, input, init, lifecycle) : fetch(input, init);
}
function retainReportRows(env, rows, filter = null) {
  env?.THM_REPORT_RUNTIME?.retain?.(env, rows, filter);
}
"""
assert s.count(old)==1
p.write_text(s.replace(old,new,1))
p=Path('report-runtime.js');s=p.read_text()
old='    jobId: job.id, attempt: job.attempts, started,'
assert s.count(old)==1
p.write_text(s.replace(old,'    fetch: reportFetch, retain: retainReportRows,\n'+old,1))
print('Preserved the standalone base bundle without changing legacy test assertions.')
