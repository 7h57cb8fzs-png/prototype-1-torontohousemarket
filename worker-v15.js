import app from "./worker-v14.js";
import { deliverEmailJob } from "./worker-v11.js";

const VERSION = "version-7.1-luna-seller-routing-20260916";
const OPENAI_MODEL = "gpt-5.6-luna";
const AUTOMATION_ROUTES = new Set(["/api/lead", "/api/vow/accept-terms", "/api/vow/activate-request"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        base: "Version 7 / Phase 6 UI",
        openai_model: OPENAI_MODEL,
        openai_policy: "Luna only for all OpenAI calls",
        buyer: "strict THM engine first; Luna Expert Comp recovery when evidence is weak or missing",
        seller: "seller reports are held until Version 7.1 processing is confirmed; weak/no-price reports are rebuilt through Expert Comp before email delivery",
        renovation: "0-100 owner condition context retained in seller analysis",
      });
    }

    const lunaEnv = { ...env, OPENAI_MODEL };
    if (!AUTOMATION_ROUTES.has(url.pathname)) return app.fetch(request, lunaEnv, ctx);

    // Suppress delivery inside lower layers. We release the report email only
    // after Version 7.1 has verified or repaired the seller report.
    const deferred = [];
    const proxyCtx = { waitUntil(promise) { deferred.push(Promise.resolve(promise)); } };
    const response = await app.fetch(request, { ...lunaEnv, RESEND_API_KEY: null }, proxyCtx);
    if (response.ok) ctx?.waitUntil?.(finalizeV71(env, deferred).catch(logError));
    return response;
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runV71Scheduled(controller, env).catch(logError));
  },
};

async function runV71Scheduled(controller, env) {
  const deferred = [];
  const proxyCtx = { waitUntil(promise) { deferred.push(Promise.resolve(promise)); } };
  await app.scheduled(controller, { ...env, OPENAI_MODEL, RESEND_API_KEY: null }, proxyCtx);
  await Promise.allSettled(deferred);
  await finalizeV71(env, []);
}

async function finalizeV71(env, deferred) {
  if (deferred?.length) await Promise.allSettled(deferred);

  // If an older report worker somehow won the job claim, do not email it.
  // Requeue only seller reports that have a pending customer report email and
  // are ready without a Version 7 marker. Then run one Luna-only V7 cycle.
  const repaired = await repairPendingSellerReports(env, 3);
  if (repaired > 0) {
    const retryDeferred = [];
    const proxyCtx = { waitUntil(promise) { retryDeferred.push(Promise.resolve(promise)); } };
    await app.scheduled({}, { ...env, OPENAI_MODEL, RESEND_API_KEY: null }, proxyCtx);
    await Promise.allSettled(retryDeferred);
  }

  await stampPendingReportsV71(env, 20);
  await processEmailJobs(env, 20);
}

async function repairPendingSellerReports(env, limit = 3) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  const jobsRes = await supabase(env, `/rest/v1/automation_jobs?job_type=eq.email_buyer&status=eq.queued&select=id,lead_id,report_id&order=created_at.asc&limit=${limit}`);
  const jobs = await jobsRes.json().catch(() => []);
  if (!jobsRes.ok || !Array.isArray(jobs)) return 0;

  let repaired = 0;
  for (const job of jobs) {
    if (!job?.lead_id || !job?.report_id) continue;
    const [leadRes, reportRes] = await Promise.all([
      supabase(env, `/rest/v1/leads?id=eq.${encodeURIComponent(job.lead_id)}&select=id,lead_mode&limit=1`),
      supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(job.report_id)}&select=id,status,report_payload&limit=1`),
    ]);
    const lead = (await leadRes.json().catch(() => []))?.[0];
    const report = (await reportRes.json().catch(() => []))?.[0];
    if (lead?.lead_mode !== "seller" || !report || report.status !== "ready") continue;

    const payload = report.report_payload || {};
    const version = String(payload.version_label || payload.version || "");
    if (/Version 7|^7(?:\.1)?$/.test(version)) continue;

    const now = new Date().toISOString();
    const resetReport = await supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(job.report_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "queued", report_payload: null, error_message: null, generated_at: null, updated_at: now }),
    });
    if (!resetReport.ok) continue;

    const resetJob = await supabase(env, `/rest/v1/automation_jobs?report_id=eq.${encodeURIComponent(job.report_id)}&job_type=eq.generate_report`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "queued", attempts: 0, available_at: now, locked_at: null, completed_at: null, last_error: null, updated_at: now }),
    });
    if (resetJob.ok) repaired++;
  }
  return repaired;
}

async function stampPendingReportsV71(env, limit = 20) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  const jobsRes = await supabase(env, `/rest/v1/automation_jobs?job_type=eq.email_buyer&status=eq.queued&select=report_id&order=created_at.asc&limit=${limit}`);
  const jobs = await jobsRes.json().catch(() => []);
  if (!jobsRes.ok || !Array.isArray(jobs)) return;

  for (const job of jobs) {
    if (!job?.report_id) continue;
    const reportRes = await supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(job.report_id)}&status=eq.ready&select=id,report_payload&limit=1`);
    const row = (await reportRes.json().catch(() => []))?.[0];
    if (!row?.report_payload) continue;

    const payload = clone(row.report_payload);
    payload.version = 7.1;
    payload.version_label = "Toronto House Market Version 7.1";
    payload.generated_by = "Phase 6 evidence engine + Version 7.1 Luna expert recovery";
    payload.openai_model = OPENAI_MODEL;
    if (payload.ai_generation?.provider === "openai") payload.ai_generation.model = OPENAI_MODEL;
    if (payload.expert_comp_mode?.used) payload.expert_comp_mode.model = OPENAI_MODEL;
    if (payload.seller) payload.seller.openai_model = OPENAI_MODEL;

    await supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(job.report_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ report_payload: payload, updated_at: new Date().toISOString() }),
    }).catch(() => null);
  }
}

async function processEmailJobs(env, limit) {
  if (!env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0 };
  const jobs = await rpc(env, "claim_email_jobs", { p_limit: limit }).catch(() => []);
  let sent = 0, failed = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try {
      await deliverEmailJob(env, job);
      sent++;
    } catch (error) {
      failed++;
      await rpc(env, "fail_email_job", { p_job_id: job.id, p_error: String(error?.message || error).slice(0, 300) }).catch(() => null);
    }
  }
  return { claimed: Array.isArray(jobs) ? jobs.length : 0, sent, failed };
}

async function rpc(env, name, body) {
  const response = await supabase(env, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Database operation ${name} failed.`);
  return data;
}

function supabase(env, path, init = {}) {
  const base = env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co";
  return fetch(`${base}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
function logError(error) { console.error(JSON.stringify({ event: "v7_1_error", error: String(error?.message || error).slice(0, 300) })); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION } }); }
