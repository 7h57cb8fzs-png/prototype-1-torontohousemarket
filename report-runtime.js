/* V7.3 resource guard. State is private to ONE invocation; never patch global fetch. */
export class ReportBudgetError extends Error {
  constructor(code, stage) { super(`${code}: ${stage}`); this.name = 'ReportBudgetError'; this.code = code; }
}
export function createReportRuntime(options = {}) {
  return {
    startedAt: Date.now(), deadline: Date.now() + (options.timeoutMs ?? 85000),
    limit: options.limit ?? 38, criticalLimit: options.criticalLimit ?? 45,
    mlsLimit: options.mlsLimit ?? 24, requests: 0, mlsRequests: 0,
    cacheHits: 0, stage: 'queue', requestsByHost: {}, events: [], usage: [],
    vowRows: new Map(), cache: new Map(), stopped: [],
    fetchImpl: options.fetchImpl || globalThis.fetch.bind(globalThis),
  };
}
export function runtimeSummary(env) {
  const s = env?.THM_REPORT_RUNTIME;
  if (!s) return null;
  return {
    elapsed_ms: Date.now() - s.startedAt, instrumented_requests: s.requests,
    request_budget: s.limit, critical_request_limit: s.criticalLimit,
    mls_requests: s.mlsRequests, reused_http_requests: s.cacheHits,
    retained_vow_records: s.vowRows.size, reused_sold_candidates: s.reusedCandidates || 0,
    requests_by_host: { ...s.requestsByHost }, stages: s.events.slice(-60),
    resource_stops: s.stopped.slice(-8), openai_usage: s.usage.slice(-4),
  };
}
export function setReportStage(env, stage) {
  const s = env?.THM_REPORT_RUNTIME;
  if (s) { s.stage = stage; s.events.push({ stage, at_ms: Date.now() - s.startedAt }); }
}
export function reportHeadroom(env, required = 1) {
  const s = env?.THM_REPORT_RUNTIME;
  return !s || (s.requests + required <= s.limit && Date.now() < s.deadline);
}
function criticalRequest(url, method) {
  return method === 'POST' && /\/rest\/v1\/rpc\/(?:complete_report_job|fail_report_job|claim_report_jobs|recover_stale_report_jobs|fail_email_job)$/.test(url.pathname);
}
export async function reportFetch(env, input, init = {}) {
  const s = env?.THM_REPORT_RUNTIME;
  if (!s) return globalThis.fetch(input, init);
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || input?.headers || {});
  const mls = url.hostname === 'query.ampre.ca';
  const critical = criticalRequest(url, method);
  // Credential is deliberately part of the private cache key: IDX and VOW cannot share cache entries.
  const key = mls && method === 'GET' ? `${headers.get('authorization') || ''}|${url.href}` : null;
  if (key && s.cache.has(key)) {
    s.cacheHits++;
    const cached = s.cache.get(key);
    return new Response(cached.body, { status: cached.status, headers: cached.headers });
  }
  const stop = code => {
    s.stopped.push({ code, stage: s.stage, requests: s.requests });
    throw new ReportBudgetError(code, s.stage);
  };
  if (s.requests >= (critical ? s.criticalLimit : s.limit)) stop('THM_REQUEST_BUDGET');
  if (!critical && Date.now() >= s.deadline) stop('THM_STAGE_DEADLINE');
  if (mls && s.mlsRequests >= s.mlsLimit) stop('THM_MLS_REQUEST_BUDGET');
  s.requests++;
  if (mls) s.mlsRequests++;
  s.requestsByHost[url.hostname] = (s.requestsByHost[url.hostname] || 0) + 1;
  const started = Date.now();
  const timeoutMs = critical ? 8000 : Math.max(1, Math.min(12000, s.deadline - Date.now()));
  // OpenAI retains its caller's deadline (18/22 seconds), within the overall report deadline.
  const boundedMs = url.hostname === 'api.openai.com' && !critical ? Math.max(1, Math.min(24000, s.deadline - Date.now())) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ReportBudgetError('THM_FETCH_TIMEOUT', s.stage)), boundedMs);
  const existingSignal = init.signal || input?.signal;
  const signal = existingSignal ? AbortSignal.any([existingSignal, controller.signal]) : controller.signal;
  try {
    const response = await s.fetchImpl(input, { ...init, headers, signal, redirect: 'error' });
    if (response.ok && (mls || url.hostname === 'api.openai.com')) {
      const body = await response.text();
      let data;
      try { data = JSON.parse(body); } catch { data = null; }
      if (mls && env.AMPRE_VOW_TOKEN && headers.get('authorization') === `Bearer ${env.AMPRE_VOW_TOKEN}`) {
        for (const row of Array.isArray(data?.value) ? data.value : data?.ListingKey ? [data] : []) {
          if (row?.ListingKey && (s.vowRows.has(String(row.ListingKey)) || s.vowRows.size < 2000)) {
            const id = String(row.ListingKey);
            s.vowRows.set(id, { ...(s.vowRows.get(id) || {}), ...row });
          }
        }
      }
      if (url.hostname === 'api.openai.com') s.usage.push({ model: data?.model || null, usage: data?.usage || null, latency_ms: Date.now() - started });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length');
      const saved = { body, status: response.status, headers: [...responseHeaders.entries()] };
      if (key && data && s.cache.size < 32) s.cache.set(key, saved);
      s.events.push({ stage: s.stage, host: url.hostname, status: response.status, latency_ms: Date.now() - started });
      return new Response(body, { status: response.status, headers: responseHeaders });
    }
    s.events.push({ stage: s.stage, host: url.hostname, status: response.status, latency_ms: Date.now() - started });
    return response;
  } catch (error) {
    s.events.push({ stage: s.stage, host: url.hostname, error: error?.name || 'Error', latency_ms: Date.now() - started });
    throw error;
  } finally { clearTimeout(timer); }
}
