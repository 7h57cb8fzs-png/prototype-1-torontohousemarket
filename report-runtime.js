/* Per-report resource budget. Private execution state never enters a public snapshot. */
export class ReportBudgetError extends Error {
  constructor(message) { super(message); this.name = 'ReportBudgetError'; }
}
export function createReportRuntime(job, options = {}) {
  const started = Date.now();
  return {
    fetch: reportFetch, retain: retainReportRows,
    jobId: job.id, attempt: job.attempts, started,
    deadline: started + (options.totalMs ?? 110000),
    maxDataRequests: options.maxDataRequests ?? 80,
    maxRequests: options.maxRequests ?? 90,
    requests: 0, byService: {}, stages: [], rawRows: new Map(),
    queryCache: new Map(), completedFilters: new Set(),
    controller: new AbortController(),
    queueWaitMs: Math.max(0, started - Date.parse(job.created_at || new Date(started).toISOString()))
  };
}
export function runtimeSummary(runtime) {
  return { job_id: runtime.jobId, attempt: runtime.attempt,
    processing_ms: Date.now() - runtime.started, queue_wait_ms: runtime.queueWaitMs,
    request_count: runtime.requests, requests_by_service: runtime.byService,
    candidate_rows_retained: runtime.rawRows.size, stages: runtime.stages,
    ai_usage: runtime.aiUsage || [] };
}
export async function reportFetch(env, input, init = {}, lifecycle = false) {
  // AMPRE's OData query parser needs RFC 3986 spaces. Form-style '+' makes
  // operators invalid and turns multiword address literals into non-matches.
  if (typeof input === 'string' && input.startsWith('https://query.ampre.ca/')) input = input.replaceAll('+', '%20');
  const r = env?.THM_REPORT_RUNTIME;
  if (!r) return fetch(input, init);
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  const database = /\.supabase\.co$/.test(url.hostname);
  const reserved = lifecycle && database;
  if (!reserved && (r.controller.signal.aborted || Date.now() >= r.deadline)) {
    throw new ReportBudgetError('Report deadline reached before ' + url.hostname);
  }
  if (r.requests >= (reserved ? r.maxRequests : r.maxDataRequests)) {
    throw new ReportBudgetError('Report request budget reached; capacity reserved for saving the result.');
  }
  r.requests++;
  const service = database ? 'database' : url.hostname;
  r.byService[service] = (r.byService[service] || 0) + 1;
  const timeout = AbortSignal.timeout(reserved ? 7000 : Math.max(1, Math.min(url.hostname === 'api.openai.com' ? 25000 : 10000, r.deadline - Date.now())));
  const signals = [timeout, init.signal, ...reserved ? [] : [r.controller.signal, env.THM_REPORT_STAGE_SIGNAL]].filter(Boolean);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
}
export async function reportStage(env, name, milliseconds, fn) {
  const r = env?.THM_REPORT_RUNTIME;
  if (!r) return fn(env);
  const began = Date.now();
  const limit = Math.max(1, Math.min(milliseconds, r.deadline - began));
  const controller = new AbortController();
  const scoped = { ...env, THM_REPORT_STAGE_SIGNAL: controller.signal };
  const stage = { name, started_ms: began - r.started, status: 'running' };
  r.stages.push(stage);
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new ReportBudgetError(name + ' exceeded its time budget.'));
    }, limit); });
    const result = await Promise.race([Promise.resolve().then(() => fn(scoped)), timeout]);
    stage.status = 'completed';
    return result;
  } catch (error) {
    stage.status = 'failed'; stage.error = String(error?.message || error).slice(0, 240);
    throw error;
  } finally {
    clearTimeout(timer); stage.duration_ms = Date.now() - began;
    controller.abort();
    console.log(JSON.stringify({ event: 'report_stage', job_id: r.jobId, attempt: r.attempt, ...stage, requests: r.requests }));
  }
}
export function retainReportRows(env, rows, filter = null) {
  const r = env?.THM_REPORT_RUNTIME;
  if (!r) return;
  for (const row of rows || []) if (row?.ListingKey && r.rawRows.size < 2500) r.rawRows.set(String(row.ListingKey), row);
  if (filter) r.completedFilters.add(filter);
}
