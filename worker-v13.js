import v7App from "./worker-v12.js";
import { deliverEmailJob } from "./worker-v11.js";

const VERSION = "version-7-openai-expert-v121-20260916";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        base: "phase-6-20260915",
        buyer: "strict engine first; OpenAI Expert Comp recovery on weak/no comparable evidence",
        seller: "0-100 renovation context + independent value + likely-sale/listing strategy",
        aiFallback: "OpenAI after existing narrative providers fail",
        privacy: "renovation metadata is removed from seller-facing free-text notes before delivery",
      });
    }

    const automationRoute = ["/api/lead", "/api/vow/accept-terms", "/api/vow/activate-request"].includes(url.pathname);
    if (!automationRoute) return v7App.fetch(request, env, ctx);

    const deferred = [];
    const proxyCtx = { waitUntil(promise) { deferred.push(Promise.resolve(promise)); } };
    const noEmailEnv = { ...env, RESEND_API_KEY: null };
    const response = await v7App.fetch(request, noEmailEnv, proxyCtx);

    if (response.ok) {
      ctx?.waitUntil?.((async () => {
        await Promise.allSettled(deferred);
        await scrubRecentSellerMetadata(env);
        await processEmailJobs(env, 20);
      })());
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      const deferred = [];
      const proxyCtx = { waitUntil(promise) { deferred.push(Promise.resolve(promise)); } };
      await v7App.scheduled(controller, { ...env, RESEND_API_KEY: null }, proxyCtx);
      await Promise.allSettled(deferred);
      await scrubRecentSellerMetadata(env);
      await processEmailJobs(env, 20);
    })());
  },
};

async function scrubRecentSellerMetadata(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  const query = "/rest/v1/leads?lead_mode=eq.seller&select=id,property_snapshot,property_reports(id,status,report_payload)&order=updated_at.desc&limit=20";
  const response = await supabase(env, query);
  const leads = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(leads)) return;

  for (const lead of leads) {
    const snapshot = clone(lead.property_snapshot || {});
    const rawNote = String(snapshot?.sellerProfile?.notes || "");
    const cleanedNote = stripRenovationMarker(rawNote);
    let snapshotChanged = false;
    if (snapshot?.sellerProfile && cleanedNote !== rawNote) {
      snapshot.sellerProfile.notes = cleanedNote;
      snapshotChanged = true;
    }

    if (snapshotChanged) {
      await supabase(env, `/rest/v1/leads?id=eq.${lead.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ property_snapshot: snapshot, updated_at: new Date().toISOString() }),
      }).catch(() => null);
    }

    const reports = Array.isArray(lead.property_reports) ? lead.property_reports : lead.property_reports ? [lead.property_reports] : [];
    for (const row of reports) {
      const report = clone(row?.report_payload || {});
      const profile = report?.seller?.profile;
      if (!profile) continue;
      const note = String(profile.notes || "");
      const cleanNote = stripRenovationMarker(note);
      if (note === cleanNote) continue;
      profile.notes = cleanNote;
      await supabase(env, `/rest/v1/property_reports?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ report_payload: report, updated_at: new Date().toISOString() }),
      }).catch(() => null);
    }
  }
}

function stripRenovationMarker(value) {
  return String(value || "").replace(/\[THM_RENOVATION_PCT:\d{1,3}\]\s*/g, "").trim();
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
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION } }); }
