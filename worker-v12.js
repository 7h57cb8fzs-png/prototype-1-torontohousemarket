import { createReportRuntime, reportFetch, reportStage, runtimeSummary } from './report-runtime.js';
import legacyApp, {
  buildPropertyReport as buildPhase6Report,
  deliverEmailJob,
  loadPropertyForReport,
  startReportHeartbeat,
} from "./worker-v11.js";

const VERSION = "version-7-openai-expert-v120-20260916";
const AMPRE = "https://query.ampre.ca/odata";
const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        base: "phase-6-20260915",
        buyer: "strict THM first; OpenAI Expert Comp recovery only when sold evidence is weak or missing",
        seller: "Phase 6 seller evidence + 0-100 renovation context + OpenAI pricing/positioning reasoning",
        aiFallback: "existing providers first; OpenAI fallback before deterministic narrative",
        testing: "focused regression on prior insufficient-comparable cases",
      });
    }

    if (url.pathname === "/seller.js" && request.method === "GET") {
      const response = await legacyApp.fetch(request, env, ctx);
      if (!response.ok) return response;
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/javascript; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(`${await response.text()}\n;(${sellerRenovationPatch.toString()})();\n`, {
        status: response.status,
        headers,
      });
    }

    // Phase 6 immediately starts its own automation from these routes. For V7 we
    // suppress that one background kickoff so Expert Mode gets first chance to
    // build the report, then we run the email queue ourselves.
    if (["/api/lead", "/api/vow/accept-terms", "/api/vow/activate-request"].includes(url.pathname)) {
      const deferred = [];
      const proxyCtx = { ...ctx, waitUntil(promise) { deferred.push(promise); } };
      const response = await legacyApp.fetch(request, { ...env, THM_REPORT_QUEUE_ONLY: true }, proxyCtx);
      if (response.ok && !env.THM_REPORT_SCHEDULED_ONLY) ctx?.waitUntil?.(runV7Automation(env).catch(logAutomationError));
      return response;
    }

    return legacyApp.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runV7Scheduled(env));
  },
};

function sellerRenovationPatch() {
  const form = document.getElementById("sellerForm");
  const expectations = document.querySelector(".seller-expectations");
  if (!form || !expectations || document.getElementById("sellerRenovationV7")) return;

  const style = document.createElement("style");
  style.textContent = `
    .seller-renovation-v7{margin:22px 0;padding:20px;border:1px solid rgba(18,63,57,.14);border-radius:15px;background:#f8f9f5}
    .seller-renovation-v7 .top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:10px}
    .seller-renovation-v7 h3{margin:0;font-size:19px;color:#123f39}
    .seller-renovation-v7 output{font:700 23px/1 Georgia,serif;color:#236b5e;white-space:nowrap}
    .seller-renovation-v7 input[type=range]{width:100%;accent-color:#236b5e;min-height:32px}
    .seller-renovation-scale{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#69766f;margin-top:2px}
    .seller-renovation-note{margin:10px 0 0;font-size:13px;line-height:1.5;color:#53655e}
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.id = "sellerRenovationV7";
  section.className = "seller-renovation-v7";
  section.innerHTML = `
    <div class="top"><div><span class="seller-kicker">CURRENT CONDITION</span><h3>How renovated is your home?</h3></div><output id="sellerRenovationValue">50%</output></div>
    <p class="seller-help">Use this as an overall feel. It gives the analysis context; it does not add a fixed dollar amount to your home.</p>
    <input id="sellerRenovation" type="range" min="0" max="100" value="50" step="5" aria-label="Renovation level from original to fully renovated">
    <div class="seller-renovation-scale"><span>0 · Original</span><span>25</span><span>50</span><span>75</span><span>100 · Fully renovated</span></div>
    <p id="sellerRenovationNote" class="seller-renovation-note"></p>`;
  expectations.parentNode.insertBefore(section, expectations);

  const slider = document.getElementById("sellerRenovation");
  const output = document.getElementById("sellerRenovationValue");
  const note = document.getElementById("sellerRenovationNote");
  const describe = n => n <= 10 ? "Mostly original / dated" : n <= 35 ? "Some updates" : n <= 60 ? "Partially renovated" : n <= 85 ? "Extensively renovated" : "Fully renovated / recent finish";
  const render = () => {
    const n = Number(slider.value);
    output.value = `${n}%`;
    output.textContent = `${n}%`;
    note.textContent = `${n}% — ${describe(n)}. Expert analysis decides whether condition is important for this specific home and market.`;
  };
  slider.addEventListener("input", render);
  form.addEventListener("reset", () => setTimeout(render, 0));
  render();

  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST" && /\/api\/lead(?:$|\?)/.test(url) && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body?.lead_mode === "seller" && body?.seller_profile) {
          const pct = Math.max(0, Math.min(100, Number(slider.value) || 0));
          body.seller_profile.renovationPct = pct;
          const existing = String(body.seller_profile.notes || "").trim();
          body.seller_profile.notes = `[THM_RENOVATION_PCT:${pct}]${existing ? ` ${existing}` : ""}`;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
    }
    return originalFetch(input, init);
  };
}

async function runV7Scheduled(env) {
  await rpc(env, "queue_overdue_sla_notifications", {}).catch(() => null);
  return runV7Automation(env);
}

async function runV7Automation(env) {
  const emailsBefore = await processEmailJobs(env, 20);
  const reports = await processV7ReportJobs(env, 1);
  const emailsAfter = reports.completed ? await processEmailJobs(env, 20) : { claimed: 0, sent: 0, failed: 0 };
  return {
    reports,
    emails: {
      claimed: Number(emailsBefore.claimed || 0) + Number(emailsAfter.claimed || 0),
      sent: Number(emailsBefore.sent || 0) + Number(emailsAfter.sent || 0),
      failed: Number(emailsBefore.failed || 0) + Number(emailsAfter.failed || 0),
    },
  };
}

async function processV7ReportJobs(env, limit = 1) {
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


async function buildVersion7Report(env, lead, property, requestId) {
  let report = await buildPhase6Report(env, lead, property, requestId);
  const sellerVerified = lead.lead_mode !== "seller" || (report.seller?.evidence?.subjectMatched ?? report.seller?.evidence?.listingMatched) === true;
  const needsExpert = sellerVerified && shouldUseExpertComp(report);

  if (needsExpert && env.OPENAI_API_KEY && env.AMPRE_VOW_TOKEN) {
    try {
      const recovered = await recoverExpertComparables(env, lead, property, report, requestId);
      if (recovered?.comparables?.length) report = applyExpertRecovery(report, recovered);
    } catch (error) {
      console.warn(JSON.stringify({ event: "v7_expert_comp_failed", request_id: requestId, error: String(error?.message || error).slice(0, 240) }));
    }
  }

  // Establish one final numeric result before asking a model to explain it.
  if (typeof env.THM_FINALIZE_REPORT === 'function') report = await reportStage(env, 'decision_summary', 24000, e => env.THM_FINALIZE_REPORT(report, e));
  if (lead.lead_mode === "seller" && sellerVerified && report.comparables?.length >= 3) {
    report = await enhanceSellerReport(env, lead, property, report, requestId).catch(error => {
      console.warn(JSON.stringify({ event: "v7_seller_ai_failed", request_id: requestId, error: String(error?.message || error).slice(0, 240) }));
      return report;
    });
  } else if (lead.lead_mode !== "seller" && (report.expert_comp_mode?.used || report.ai_generation?.provider === "deterministic_fallback")) {
    const narrative = await openAiBuyerNarrative(env, report, property).catch(() => null);
    if (narrative) {
      report = {
        ...report,
        narrative,
        ai_generation: {
          provider: "openai",
          model: String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL),
          fallback_used: true,
          expert_comp_mode: report.expert_comp_mode?.used === true,
        },
      };
    }
  }

  return {
    ...report,
    version: report.version || 7,
    version_label: report.version_label || "Toronto House Market Version 7",
    ...(report.decision_summary ? {decision_summary:{...report.decision_summary,market_read:report.narrative?.market_read || report.seller?.strategy?.independent_market_read || report.decision_summary.market_read,strategy:report.narrative?.buyer_strategy || report.seller?.strategy?.listing_strategy || report.decision_summary.strategy}} : {}),
    generated_by: "phase-6 base + OpenAI expert recovery",
  };
}

export function shouldUseExpertComp(report) {
  const count = Array.isArray(report?.comparables) ? report.comparables.length : 0;
  const policy = report?.comparable_policy || {};
  const confidence = String(report?.valuation?.confidence || "").toLowerCase();
  return report?.valuation?.available !== true || count < 3 || (/^(low|limited)$/.test(confidence) && (policy.sizeFallbackUsed || policy.missingSizeFallback || report.seller?.evidence?.archiveSubject || Number(policy.windowDays || 0) > 300));
}

async function recoverExpertComparables(env, lead, property, report, requestId) {
  const pool = await collectBroadSoldPool(env, property, lead.lead_mode === "seller");
  let selected = null;
  if (pool.length) selected = await selectExpertComparables(env, property, pool, lead.lead_mode === "seller");

  if ((!selected?.comparables || selected.comparables.length < 3) && env.OPENAI_EXTERNAL_COMP_SEARCH !== "false") {
    const external = await externalSoldResearch(env, property, report).catch(() => null);
    if (external?.comparables?.length) {
      const combined = mergeExpertResults(selected, external);
      if (combined.comparables.length >= 2) selected = combined;
    }
  }

  if (!selected?.comparables?.length) return null;
  console.log(JSON.stringify({ event: "v7_expert_comp_used", request_id: requestId, candidates: pool.length, selected: selected.comparables.length, external: selected.comparables.filter(c => c.sourceType === "external").length }));
  return selected;
}

async function collectBroadSoldPool(env, property, seller = false) {
  const token = env.AMPRE_VOW_TOKEN;
  if (!token) return [];
  const searches = [];
  const community = clean(property.cityRegion);
  const city = clean(property.city).replace(/^Toronto\s+[CEW]\d{2}$/i, "Toronto");
  const postal = String(property.postalCode || "").replace(/\s/g, "").slice(0, 3).toUpperCase();
  if (community && !/^(toronto )?[cew]\d{2}$/i.test(community)) searches.push(`contains(CityRegion,'${odata(community)}')`);
  if (/^[A-Z]\d[A-Z]$/.test(postal)) searches.push(`startswith(PostalCode,'${postal}')`);
  if (city) searches.push(`contains(City,'${odata(city)}')`);

  const rows = [...(env.THM_REPORT_RUNTIME?.rawRows?.values() || [])];
  if (soldCandidates(property, rows).length >= 12) return soldCandidates(property, rows).slice(0, 60);
  for (const filter of [...new Set(searches)].slice(0, 3)) {
    if (env.THM_REPORT_RUNTIME?.completedFilters.has(filter)) continue;
    const batch = await tailQuery(filter, token, seller ? 500 : 700, env);
    rows.push(...batch);
    if (soldCandidates(property, rows).length >= 35) break;
  }
  return soldCandidates(property, rows).slice(0, 60);
}

async function tailQuery(filter, token, limit, env = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const countUrl = new URL(`${AMPRE}/Property`);
  countUrl.search = new URLSearchParams({ "$filter": filter, "$count": "true", "$top": "1" }).toString();
  let count = null;
  try {
    const r = await reportFetch(env, countUrl, { headers, signal: AbortSignal.timeout(9000) });
    if (r.ok) count = Number((await r.json())?.["@odata.count"]);
  } catch {}
  const start = Number.isSafeInteger(count) && count > limit ? count - limit : 0;
  const rows = [];
  let skip = start;
  while (rows.length < limit) {
    const url = new URL(`${AMPRE}/Property`);
    url.search = new URLSearchParams({ "$filter": filter, "$top": "100", ...(skip ? { "$skip": String(skip) } : {}) }).toString();
    const r = await reportFetch(env, url, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) break;
    const data = await r.json().catch(() => null);
    const page = Array.isArray(data?.value) ? data.value : [];
    rows.push(...page);
    if (page.length < 100) break;
    skip += 100;
  }
  return rows;
}

function soldCandidates(subject, rows) {
  const seen = new Set();
  const subjectCondo = /condo|condominium/i.test(`${subject.propertyType || ""} ${subject.propertySubType || ""}`);
  const subjectAddress = normalizeAddress(subject.address);
  return (rows || []).filter(r => {
    const key = r?.ListingKey || `${r?.UnparsedAddress}|${r?.PurchaseContractDate}|${r?.ClosePrice}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""} ${r?.TransactionType || ""}`;
    if (!/sold|closed|deal firm/i.test(status) || /lease|rent/i.test(status)) return false;
    const price = money(r?.ClosePrice || r?.SoldPrice || r?.SalePrice || r?.FinalSalePrice);
    const sold = new Date(r?.PurchaseContractDate || r?.SoldDate || r?.CloseDate || r?.ModificationTimestamp || "");
    if (!(price > 50000) || !Number.isFinite(sold.getTime())) return false;
    const age = (Date.now() - sold.getTime()) / 864e5;
    if (age < 0 || age > 900) return false;
    if (normalizeAddress(r?.UnparsedAddress) === subjectAddress) return false;
    const condo = /condo|condominium/i.test(`${r?.PropertyType || ""} ${r?.PropertySubType || ""}`);
    if (condo !== subjectCondo) return false;
    return true;
  }).map(r => ({
    id: String(r.ListingKey || crypto.randomUUID()),
    listingKey: r.ListingKey || null,
    address: clean(r.UnparsedAddress) || null,
    city: clean(r.City) || null,
    community: clean(r.CityRegion) || null,
    postalCode: clean(r.PostalCode) || null,
    propertyType: clean(r.PropertyType) || null,
    propertySubType: clean(r.PropertySubType) || null,
    soldPrice: money(r.ClosePrice || r.SoldPrice || r.SalePrice || r.FinalSalePrice),
    soldDate: new Date(r.PurchaseContractDate || r.SoldDate || r.CloseDate || r.ModificationTimestamp).toISOString().slice(0, 10),
    beds: number(r.BedroomsTotal),
    aboveGradeBeds: number(r.BedroomsAboveGrade),
    baths: number(r.BathroomsTotalInteger),
    livingAreaRange: clean(r.LivingAreaRange) || null,
    buildingAreaTotal: number(r.BuildingAreaTotal),
    lotWidth: number(r.LotWidth),
    lotDepth: number(r.LotDepth),
    parking: number(r.ParkingTotal),
    basement: Array.isArray(r.Basement) ? r.Basement.join(" · ") : clean(r.Basement),
    remarks: clean(r.PublicRemarks || r.PublicRemarksExtras)?.slice(0, 900) || null,
    sourceType: "ampre_vow",
  })).sort((a, b) => Date.parse(b.soldDate) - Date.parse(a.soldDate));
}

async function selectExpertComparables(env, property, candidates, seller) {
  const schema = expertSchema();
  const subject = subjectForAi(property);
  const instructions = `Act as an experienced GTA residential Realtor doing a careful CMA-style comparable review. The strict automated engine did not produce strong enough evidence. Select the economically most relevant REAL sold properties from the supplied candidates and reconcile them to the subject. Do not mechanically prioritize bedroom count, lot frontage, lot depth, age, size or any one field. Decide which characteristics actually drive value for this specific home, housing form and micro-market. A 3-bedroom can be a better comp than a 4-bedroom; a 30-foot lot can be economically similar to a 33- or 35-foot lot; depth differences may or may not matter. Explain why. You may make appraiser-style judgment adjustments, but never alter the recorded sold price. Use adjusted_indication only as your reasoned indication for the subject. Do not invent properties or facts. Prefer 3-6 comps. For condos, strongly prefer the same building or same community and similar interior size unless you can clearly justify a broader match. Return JSON only.`;
  const result = await openAiJson(env, "thm_expert_comps", schema, [
    { role: "system", content: instructions },
    { role: "user", content: JSON.stringify({ mode: seller ? "seller" : "buyer", subject, candidates }) },
  ], false);
  return normalizeExpertResult(result, candidates, "ampre_vow");
}

async function externalSoldResearch(env, property, report) {
  const schema = externalSchema();
  const subject = subjectForAi(property);
  const prompt = `The licensed feed did not provide enough usable sold comparables for this GTA residential property. Search the web for genuine identifiable MLS sale evidence only. A result must identify a real property address, actual sold price, sold date, and a source URL. MLS number is strongly preferred. Do not use an AVM estimate, asking price, hypothetical property, or your memory as a sold comparable. Do not fabricate a transaction. Find up to 5 economically relevant sales and explain material differences. This is recovery evidence, so broader bedroom/lot/size differences are acceptable when professionally justified. If you cannot verify a genuine sale, return fewer results or none.`;
  const result = await openAiJson(env, "thm_external_sales", schema, [
    { role: "system", content: prompt },
    { role: "user", content: JSON.stringify({ subject, existingEvidence: report.comparables || [] }) },
  ], true);
  const comps = (result?.comparables || []).filter(c => c && c.address && money(c.soldPrice) > 50000 && /^20\d{2}-\d{2}-\d{2}$/.test(c.soldDate || "") && /^https:\/\//i.test(c.sourceUrl || "")).map((c, i) => ({
    id: `external-${i}`,
    listingKey: /^[A-Z]\d{7,9}$/i.test(c.mlsNumber || "") ? String(c.mlsNumber).toUpperCase() : null,
    address: clean(c.address),
    propertySubType: clean(c.propertySubType),
    soldPrice: money(c.soldPrice),
    soldDate: c.soldDate,
    beds: number(c.beds),
    baths: number(c.baths),
    livingAreaRange: clean(c.livingAreaRange),
    lotWidth: number(c.lotWidth),
    lotDepth: number(c.lotDepth),
    sourceUrl: c.sourceUrl,
    sourceType: "external",
    adjusted_indication: money(c.adjusted_indication) || money(c.soldPrice),
    adjustment_reason: clean(c.adjustment_reason),
    selection_reason: clean(c.selection_reason),
  }));
  return { comparables: comps, market_read: clean(result?.market_read), confidence: "Limited" };
}

function mergeExpertResults(local, external) {
  const rows = [...(local?.comparables || []), ...(external?.comparables || [])];
  const seen = new Set();
  return {
    comparables: rows.filter(c => {
      const key = normalizeAddress(c.address);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6),
    market_read: [local?.market_read, external?.market_read].filter(Boolean).join(" "),
    confidence: local?.confidence || external?.confidence || "Limited",
  };
}

function normalizeExpertResult(result, candidates, sourceType) {
  const byId = new Map(candidates.map(c => [String(c.id), c]));
  const rows = [];
  for (const chosen of Array.isArray(result?.comparables) ? result.comparables : []) {
    const base = byId.get(String(chosen.id));
    if (!base) continue;
    rows.push({
      ...base,
      sourceType,
      adjusted_indication: money(chosen.adjusted_indication) || base.soldPrice,
      selection_reason: clean(chosen.selection_reason),
      adjustment_reason: clean(chosen.adjustment_reason),
      adjustment_basis: clean(chosen.adjustment_basis) || "professional_judgment",
      weight: Math.max(0.1, Math.min(1, Number(chosen.weight) || 0.5)),
    });
  }
  return { comparables: rows.slice(0, 6), market_read: clean(result?.market_read), confidence: clean(result?.confidence) || "Limited" };
}

function applyExpertRecovery(report, expert) {
  const comps = expert.comparables.map(c => ({
    listingKey: c.listingKey || null,
    address: c.address,
    propertySubType: c.propertySubType || null,
    soldPrice: c.soldPrice,
    soldDate: c.soldDate,
    beds: c.beds ?? null,
    baths: c.baths ?? null,
    livingAreaRange: c.livingAreaRange || null,
    buildingAreaTotal: c.buildingAreaTotal ?? null,
    lotWidth: c.lotWidth ?? null,
    lotDepth: c.lotDepth ?? null,
    cityRegion: c.community || c.cityRegion || null,
    postalCode: c.postalCode || null,
    similarity: null,
    distanceKm: null,
    expertSelectionReason: c.selection_reason || null,
    expertAdjustmentReason: c.adjustment_reason || null,
    expertAdjustmentBasis: c.adjustment_basis || null,
    adjustedIndication: c.adjusted_indication || c.soldPrice,
    evidenceSource: c.sourceType,
    sourceUrl: c.sourceUrl || null,
  }));
  const indications = comps.map(c => Number(c.adjustedIndication)).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
  if (indications.length < 2) return report;
  const midpoint = median(indications);
  const spread = indications.length >= 3 ? Math.max(indications) - Math.min(indications) : midpoint * 0.16;
  const margin = Math.max(midpoint * (indications.length >= 4 ? 0.06 : 0.09), spread * 0.35);
  const low = roundMarket(midpoint - margin);
  const high = roundMarket(midpoint + margin);
  const externalCount = comps.filter(c => c.evidenceSource === "external").length;
  const confidence = comps.length >= 4 && externalCount === 0 ? "Low" : "Limited";
  return {
    ...report,
    comparables: comps,
    valuation: {
      ...(report.valuation || {}),
      available: true,
      low,
      midpoint: roundMarket(midpoint),
      high,
      confidence,
      basis: `${comps.length} real sold properties were reconciled in Expert Comp Mode after the strict algorithm could not establish a normal comparable set. Recorded sold prices were not altered; adjusted indications reflect professional-judgment reconciliation.`,
      methodology: "Version 7 Expert Comp Mode: strict THM evidence runs first. When it is insufficient, OpenAI reviews a broader pool of real sold evidence, decides which differences are economically material for this specific property and micro-market, and may reconcile imperfect comps with explicit judgment adjustments. No fabricated sale is permitted.",
    },
    value_rating: { available: false, score: null, label: "Expert comp review", reason: "The range uses broadened professionally reconciled evidence, so no automated value score is assigned." },
    comparable_policy: {
      ...(report.comparable_policy || {}),
      expertMode: true,
      sizeFallbackUsed: true,
      expandedWindow: true,
      windowDays: Math.max(900, Number(report.comparable_policy?.windowDays || 0)),
      externalEvidenceCount: externalCount,
      strictEngineFirst: true,
    },
    expert_comp_mode: {
      used: true,
      selectedCount: comps.length,
      externalEvidenceCount: externalCount,
      marketRead: expert.market_read || null,
      confidence,
    },
  };
}

async function enhanceSellerReport(env, lead, property, report, requestId) {
  const pct = sellerRenovationPct(report?.seller?.profile?.notes || property?.sellerProfile?.notes || "");
  const expectation = report?.seller?.target_range || null;
  const schema = sellerStrategySchema();
  const payload = {
    subject: report.facts,
    historicalSubjectSource: report.seller?.evidence?.archiveSubject || null,
    renovationPct: pct,
    valuation: report.valuation,
    soldComparables: report.comparables,
    activeCompetition: report.active_comparables,
    sellerExpectation: expectation ? { low: expectation.low, high: expectation.high } : null,
  };
  const system = `Act as an experienced GTA listing Realtor. Produce seller-specific pricing and positioning reasoning. The renovation percentage is the owner's broad subjective description, not a mechanical price adjustment. Use it only as qualitative context when interpreting the sold evidence and current competition. Do not output or apply a percentage adjustment to the valuation. Decide whether condition is materially value-driving for this particular property and market. Never let the seller's expected minimum/maximum set or bias the independent valuation; compare expectations only after forming your view. Use sold evidence first and active listings only as competition/context. Use the supplied final valuation midpoint, low, high and confidence exactly; do not calculate a different likely sale range. Distinguish a suggested asking price from the likely sale range. Treat archived home specifications as historical, never as current verified condition. Do not promise a sale price. Keep market read and listing strategy each under 110 words; at most four concise bullets per list. Return JSON only.`;
  const result = await openAiJson(env, "thm_seller_strategy", schema, [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ], false);

  const valuation = report.valuation || {};

  return {
    ...report,
    valuation,
    seller: {
      ...(report.seller || {}),
      renovation_pct: pct,
      renovation_label: renovationLabel(pct),
      condition_context: {
        renovation_pct: pct,
        treatment: "context_only",
        note: "Owner-reported renovation level informs the Realtor-style interpretation of evidence; it is not applied as a fixed percentage or dollar adjustment."
      },
      strategy: {
        independent_market_read: clean(result?.independent_market_read),
        likely_sale_range: valuation.available ? `Preliminary likely sale range: $${Number(valuation.low).toLocaleString("en-CA")}–$${Number(valuation.high).toLocaleString("en-CA")}. ${valuation.confidence} confidence; current home specifications and condition require confirmation.` : null,
        listing_strategy: clean(result?.listing_strategy),
        value_drivers: Array.isArray(result?.value_drivers) ? result.value_drivers.map(clean).filter(Boolean).slice(0,5) : [],
        preparation_priorities: Array.isArray(result?.preparation_priorities) ? result.preparation_priorities.map(clean).filter(Boolean).slice(0,5) : [],
        expectation_comparison: clean(result?.expectation_comparison),
      },
    },
    narrative: {
      ...(report.narrative || {}),
      executive_summary: clean(result?.independent_market_read) || report.narrative?.executive_summary,
      preparation_checks: Array.isArray(result?.preparation_priorities) && result.preparation_priorities.length ? result.preparation_priorities.map(clean).filter(Boolean).slice(0,5) : report.narrative?.preparation_checks,
    },
    ai_note: `OpenAI seller strategy · renovation context ${pct}% · owner expectation excluded from independent valuation`,
    analysis_mode: "Version 7: calculated sold evidence + OpenAI listing-Realtor reasoning",
  };
}

async function openAiBuyerNarrative(env, report, property) {
  const schema = buyerNarrativeSchema();
  const system = `Write a concise GTA buyer decision narrative grounded only in the supplied property facts and real sold evidence. If Expert Comp Mode was used, explain that the normal strict engine was insufficient and that broader real sales were professionally reconciled. Never invent a sale or property fact. Use the final valuation numbers and confidence exactly as supplied; do not recompute them. Distinguish above-grade and basement bedrooms. Executive summary at most 55 words; market read and strategy at most 80 words each; bullets at most 22 words. Do not call this an appraisal. Return JSON only.`;
  return openAiJson(env, "thm_buyer_narrative", schema, [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify({ facts: report.facts, valuation: report.valuation, comparables: report.comparables, expert: report.expert_comp_mode, remarks: property?.remarks }) },
  ], false);
}

async function openAiJson(env, name, schema, input, webSearch) {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), webSearch ? 28000 : 18000);
  try {
    const body = {
      model: String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL),
      reasoning: { effort: "medium" },
      input,
      text: { format: { type: "json_schema", name, strict: true, schema } },
      ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "auto" } : {}),
    };
    const response = await reportFetch(env, OPENAI_RESPONSES, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${clean(data?.error?.message || "request failed")}`);
    if (env.THM_REPORT_RUNTIME) (env.THM_REPORT_RUNTIME.aiUsage ||= []).push({ model: body.model, purpose: name, usage: data?.usage || null });
    const text = responseOutputText(data);
    if (!text) throw new Error("OpenAI returned no structured output.");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function responseOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || []).filter(x => x?.type === "message").flatMap(x => x?.content || []).filter(x => x?.type === "output_text").map(x => x.text || "").join("");
}

function expertSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      confidence: { type: "string", enum: ["Moderate", "Low", "Limited"] },
      market_read: { type: "string" },
      comparables: { type: "array", minItems: 1, maxItems: 6, items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string" },
          weight: { type: "number", minimum: 0.1, maximum: 1 },
          adjusted_indication: { type: "number" },
          selection_reason: { type: "string" },
          adjustment_reason: { type: "string" },
          adjustment_basis: { type: "string", enum: ["evidence_supported", "professional_judgment", "none"] },
        },
        required: ["id", "weight", "adjusted_indication", "selection_reason", "adjustment_reason", "adjustment_basis"],
      } },
    },
    required: ["confidence", "market_read", "comparables"],
  };
}

function externalSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      market_read: { type: "string" },
      comparables: { type: "array", maxItems: 5, items: {
        type: "object", additionalProperties: false,
        properties: {
          address: { type: "string" }, mlsNumber: { type: ["string", "null"] }, propertySubType: { type: ["string", "null"] }, soldPrice: { type: "number" }, soldDate: { type: "string" }, sourceUrl: { type: "string" }, beds: { type: ["number", "null"] }, baths: { type: ["number", "null"] }, livingAreaRange: { type: ["string", "null"] }, lotWidth: { type: ["number", "null"] }, lotDepth: { type: ["number", "null"] }, adjusted_indication: { type: "number" }, selection_reason: { type: "string" }, adjustment_reason: { type: "string" },
        },
        required: ["address", "mlsNumber", "propertySubType", "soldPrice", "soldDate", "sourceUrl", "beds", "baths", "livingAreaRange", "lotWidth", "lotDepth", "adjusted_indication", "selection_reason", "adjustment_reason"],
      } },
    },
    required: ["market_read", "comparables"],
  };
}

function sellerStrategySchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      independent_market_read: { type: "string" },
      likely_sale_range: { type: "string" },
      listing_strategy: { type: "string" },
      expectation_comparison: { type: "string" },
      value_drivers: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      preparation_priorities: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
    },
    required: ["independent_market_read", "likely_sale_range", "listing_strategy", "expectation_comparison", "value_drivers", "preparation_priorities"],
  };
}

function buyerNarrativeSchema() {
  const list = { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } };
  return {
    type: "object", additionalProperties: false,
    properties: {
      executive_summary: { type: "string" }, market_read: { type: "string" }, buyer_strategy: { type: "string" }, strengths: list, risks: list, inspection_priorities: list, questions_for_realtor: list,
    },
    required: ["executive_summary", "market_read", "buyer_strategy", "strengths", "risks", "inspection_priorities", "questions_for_realtor"],
  };
}

function subjectForAi(property) {
  return {
    address: property.address || null,
    city: property.city || null,
    community: property.cityRegion || null,
    postalCode: property.postalCode || null,
    propertyType: property.propertyType || null,
    propertySubType: property.propertySubType || null,
    beds: property.beds ?? null,
    baths: property.baths ?? null,
    livingAreaRange: property.livingAreaRange || null,
    buildingAreaTotal: property.buildingAreaTotal ?? null,
    lotWidth: property.lotWidth ?? null,
    lotDepth: property.lotDepth ?? null,
    parking: property.parkingTotal ?? null,
    basement: property.basement || null,
    garage: property.garageType || null,
    historicalSubjectSource: property.sellerEvidence?.archiveSubject || null,
    remarks: clean(property.remarks)?.slice(0, 1200) || null,
  };
}

function sellerRenovationPct(notes) {
  const match = String(notes || "").match(/\[THM_RENOVATION_PCT:(\d{1,3})\]/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : 50;
}

function renovationLabel(n) {
  return n <= 10 ? "Mostly original / dated" : n <= 35 ? "Some updates" : n <= 60 ? "Partially renovated" : n <= 85 ? "Extensively renovated" : "Fully renovated / recent finish";
}

async function processEmailJobs(env, limit) {
  if (!env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0 };
  const jobs = await rpc(env, "claim_email_jobs", { p_limit: limit });
  let sent = 0, failed = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try { await deliverEmailJob(env, job); sent++; }
    catch (error) {
      failed++;
      await rpc(env, "fail_email_job", { p_job_id: job.id, p_error: String(error?.message || error).slice(0, 300) }).catch(() => null);
    }
  }
  return { claimed: Array.isArray(jobs) ? jobs.length : 0, sent, failed };
}

async function loadLeadForReportV7(env, id) {
  const select = "id,name,email,lead_mode,resolved_address,showing_timing,property_snapshot,metadata,created_at,vow_user_id";
  const response = await supabase(env, `/rest/v1/leads?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`);
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Unable to load report request.");
  return Array.isArray(rows) ? rows[0] : null;
}

async function completeJob(env, name, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await rpc(env, name, body, 9000); }
    catch (error) { if (attempt === 2) throw error; }
  }
}

async function rpc(env, name, body, timeoutMs = 10000) {
  const response = await supabase(env, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Database operation ${name} failed.`);
  return data;
}

function supabase(env, path, init = {}) {
  const base = env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co";
  return reportFetch(env, `${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...(init.headers || {}) },
  }, true);
}

function normalizeAddress(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function odata(value) { return String(value || "").replace(/'/g, "''"); }
function clean(value) { return typeof value === "string" ? value.trim() || null : value == null ? null : String(value); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function money(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function median(values) { const a = values.filter(Number.isFinite).sort((x,y)=>x-y); if (!a.length) return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function roundMarket(value) { if (!Number.isFinite(value)) return null; const step = value >= 1e6 ? 10000 : 5000; return Math.round(value / step) * step; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION } }); }
function logAutomationError(error) { console.error(JSON.stringify({ event: "v7_automation_error", error: String(error?.message || error).slice(0, 300) })); }

export { processV7ReportJobs, buildVersion7Report, collectBroadSoldPool };
