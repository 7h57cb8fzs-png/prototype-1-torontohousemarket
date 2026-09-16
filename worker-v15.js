import app from "./worker-v14.js";
import { buildPropertyReport, loadPropertyForReport } from "./worker-v11.js";

const VERSION = "seller-stability-v123-20260916";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        base: "version-7-openai-expert-v122-20260916",
        seller: "stable Phase-6 seller generator runs before V7 buyer expert recovery",
      });
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      await processOneSellerReport(env).catch(error => {
        console.error(JSON.stringify({ event: "seller_stability_failed", error: String(error?.message || error).slice(0, 300) }));
      });
      app.scheduled(controller, env, ctx);
    })());
  },
};

async function processOneSellerReport(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { processed: 0 };

  const jobsResponse = await supabase(env,
    "/rest/v1/automation_jobs?job_type=eq.generate_report&status=in.(queued,processing)&select=id,lead_id,report_id,status,attempts,locked_at,available_at&order=available_at.asc&limit=20"
  );
  const jobs = await jobsResponse.json().catch(() => []);
  if (!jobsResponse.ok || !Array.isArray(jobs)) return { processed: 0 };

  for (const job of jobs) {
    const lead = await loadLead(env, job.lead_id);
    if (!lead || lead.lead_mode !== "seller" || !lead.property_snapshot?.sellerProfile) continue;

    const stale = job.status === "processing" && (!job.locked_at || Date.now() - Date.parse(job.locked_at) > 90_000);
    if (job.status !== "queued" && !stale) continue;

    const now = new Date().toISOString();
    const claim = await supabase(env, `/rest/v1/automation_jobs?id=eq.${job.id}&select=id,status`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "processing",
        locked_at: now,
        updated_at: now,
        last_error: null,
        attempts: Math.max(1, Number(job.attempts || 0)),
      }),
    });
    const claimed = await claim.json().catch(() => []);
    if (!claim.ok || !Array.isArray(claimed) || !claimed.length) continue;

    const requestId = `seller-stable-${job.id}`;
    try {
      const property = await loadPropertyForReport(env, lead, requestId);
      const report = await buildPropertyReport(env, lead, property, requestId);
      await rpc(env, "complete_report_job", {
        p_job_id: job.id,
        p_report_id: job.report_id,
        p_report_payload: report,
      });
      console.log(JSON.stringify({ event: "seller_stability_ready", job_id: job.id, report_id: job.report_id }));
      return { processed: 1, completed: 1 };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 500);
      await rpc(env, "fail_report_job", {
        p_job_id: job.id,
        p_report_id: job.report_id,
        p_error: message,
      }).catch(() => null);
      console.error(JSON.stringify({ event: "seller_stability_generation_failed", job_id: job.id, error: message }));
      return { processed: 1, failed: 1 };
    }
  }
  return { processed: 0 };
}

async function loadLead(env, id) {
  const select = "id,name,email,lead_mode,resolved_address,showing_timing,property_snapshot,metadata,created_at,vow_user_id";
  const response = await supabase(env, `/rest/v1/leads?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}&limit=1`);
  const rows = await response.json().catch(() => []);
  return response.ok && Array.isArray(rows) ? rows[0] || null : null;
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
    signal: init.signal || AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION },
  });
}
