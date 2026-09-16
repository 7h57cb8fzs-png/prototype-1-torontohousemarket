import app from "./worker-v15.js";
import { deliverEmailJob } from "./worker-v11.js";

const VERSION = "version-7.1-luna-fast-seller-20260916";
const OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const AMPRE = "https://query.ampre.ca/odata";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        openai_model: OPENAI_MODEL,
        openai_policy: "Luna only",
        seller: "fast expert recovery for weak/no-price seller reports before email delivery",
        stale_worker_guard: true,
      });
    }

    const response = await app.fetch(request, { ...env, OPENAI_MODEL }, ctx);
    if (response.ok && ["/api/lead", "/api/vow/accept-terms", "/api/vow/activate-request"].includes(url.pathname)) {
      ctx?.waitUntil?.(recoverRecentSellerReport(env).catch(logError));
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      await recoverRecentSellerReport(env).catch(logError);
      await app.scheduled(controller, { ...env, OPENAI_MODEL }, ctx);
    })());
  },
};

async function recoverRecentSellerReport(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.AMPRE_VOW_TOKEN || !env.OPENAI_API_KEY) return { recovered: 0 };

  // Only touch recent seller report emails that are still waiting. This avoids
  // reviving old historical queues while providing a fast path for new reports.
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const emailRes = await supabase(env,
    `/rest/v1/automation_jobs?job_type=eq.email_buyer&status=eq.queued&created_at=gte.${encodeURIComponent(cutoff)}&select=id,lead_id,report_id,recipient,payload,attempts,created_at&order=created_at.asc&limit=3`
  );
  const emailJobs = await emailRes.json().catch(() => []);
  if (!emailRes.ok || !Array.isArray(emailJobs)) return { recovered: 0 };

  for (const emailJob of emailJobs) {
    if (!emailJob?.lead_id || !emailJob?.report_id) continue;

    const [leadRes, reportRes, genRes] = await Promise.all([
      supabase(env, `/rest/v1/leads?id=eq.${encodeURIComponent(emailJob.lead_id)}&select=id,name,email,lead_mode,resolved_address,property_snapshot,metadata,created_at&limit=1`),
      supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(emailJob.report_id)}&select=id,status,report_payload,error_message,updated_at&limit=1`),
      supabase(env, `/rest/v1/automation_jobs?report_id=eq.${encodeURIComponent(emailJob.report_id)}&job_type=eq.generate_report&select=id,status,attempts,locked_at,last_error&limit=1`),
    ]);

    const lead = (await leadRes.json().catch(() => []))?.[0];
    const report = (await reportRes.json().catch(() => []))?.[0];
    const genJob = (await genRes.json().catch(() => []))?.[0];
    if (lead?.lead_mode !== "seller" || !lead.resolved_address || !genJob) continue;

    const existing = report?.report_payload || {};
    if (report?.status === "ready" && existing?.valuation?.available === true && String(existing?.version_label || "").includes("Version 7.1")) {
      await sendSpecificEmailJob(env, emailJob);
      return { recovered: 0, emailed: 1 };
    }

    try {
      const payload = await buildFastSellerReport(env, lead);
      const now = new Date().toISOString();

      const saved = await supabase(env, `/rest/v1/property_reports?id=eq.${encodeURIComponent(emailJob.report_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "ready",
          report_payload: payload,
          generated_at: now,
          error_message: null,
          updated_at: now,
        }),
      });
      if (!saved.ok) throw new Error("Could not save the recovered seller report.");

      // Take ownership of this job. The guarded complete_report_job RPC prevents
      // an older long-running worker from overwriting the finished report later.
      await supabase(env, `/rest/v1/automation_jobs?id=eq.${genJob.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "completed",
          completed_at: now,
          locked_at: null,
          last_error: null,
          updated_at: now,
        }),
      });

      await sendSpecificEmailJob(env, emailJob);
      console.log(JSON.stringify({ event: "v7_1_fast_seller_recovered", lead_id: lead.id, report_id: emailJob.report_id, email_job_id: emailJob.id, comps: payload.comparables.length, low: payload.valuation.low, high: payload.valuation.high }));
      return { recovered: 1, emailed: 1 };
    } catch (error) {
      console.error(JSON.stringify({ event: "v7_1_fast_seller_failed", lead_id: lead.id, report_id: emailJob.report_id, error: String(error?.message || error).slice(0, 300) }));
    }
  }
  return { recovered: 0 };
}

async function buildFastSellerReport(env, lead) {
  const subject = await resolveSubject(lead.resolved_address, env.AMPRE_VOW_TOKEN);
  if (!subject) throw new Error("The seller property could not be resolved in protected MLS history.");

  const candidates = await broadSoldPool(subject, env.AMPRE_VOW_TOKEN);
  if (candidates.length < 2) throw new Error("Not enough real sold evidence was recovered for expert review.");

  const profile = lead.property_snapshot?.sellerProfile || {};
  const expert = await lunaSellerExpert(env, subject, candidates, profile);
  const byId = new Map(candidates.map(c => [String(c.id), c]));
  const selected = (expert.comparables || []).map(chosen => {
    const base = byId.get(String(chosen.id));
    if (!base) return null;
    return {
      ...base,
      adjustedIndication: money(chosen.adjusted_indication) || base.soldPrice,
      expertSelectionReason: clean(chosen.selection_reason),
      expertAdjustmentReason: clean(chosen.adjustment_reason),
      expertAdjustmentBasis: clean(chosen.adjustment_basis) || "professional_judgment",
      weight: Math.max(0.1, Math.min(1, Number(chosen.weight) || 0.5)),
    };
  }).filter(Boolean).slice(0, 6);

  if (selected.length < 2) throw new Error("Luna did not select enough genuine sold comparables.");

  const indications = selected.map(c => Number(c.adjustedIndication)).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
  const midpoint = median(indications);
  const spread = indications.length >= 3 ? Math.max(...indications) - Math.min(...indications) : midpoint * 0.16;
  const margin = Math.max(midpoint * (indications.length >= 4 ? 0.06 : 0.09), spread * 0.35);
  const low = roundMarket(midpoint - margin);
  const high = roundMarket(midpoint + margin);
  const renovationPct = readRenovationPct(profile);
  const targetLow = money(profile.targetMin);
  const targetHigh = money(profile.targetMax);

  const comps = selected.map(c => ({
    listingKey: c.listingKey,
    address: c.address,
    propertySubType: c.propertySubType,
    soldPrice: c.soldPrice,
    soldDate: c.soldDate,
    beds: c.beds,
    baths: c.baths,
    livingAreaRange: c.livingAreaRange,
    lotWidth: c.lotWidth,
    lotDepth: c.lotDepth,
    cityRegion: c.community,
    postalCode: c.postalCode,
    adjustedPrice: c.adjustedIndication,
    adjustedIndication: c.adjustedIndication,
    expertSelectionReason: c.expertSelectionReason,
    expertAdjustmentReason: c.expertAdjustmentReason,
    expertAdjustmentBasis: c.expertAdjustmentBasis,
    evidenceSource: "AMPRE/VOW",
  }));

  const facts = {
    address: subject.UnparsedAddress || lead.resolved_address,
    status: clean(subject.StandardStatus || subject.MlsStatus || "Historical MLS record"),
    list_price: money(subject.ListPrice),
    property_type: clean(subject.PropertySubType || subject.PropertyType),
    beds: num(subject.BedroomsTotal),
    baths: num(subject.BathroomsTotalInteger),
    living_area: clean(subject.LivingAreaRange) || num(subject.BuildingAreaTotal),
    lot: num(subject.LotWidth) && num(subject.LotDepth) ? `${num(subject.LotWidth)} × ${num(subject.LotDepth)} ft` : null,
    parking: num(subject.ParkingTotal),
    taxes: money(subject.TaxAnnualAmount),
    community: clean(subject.CityRegion),
  };

  const targetRange = targetLow && targetHigh ? { low: targetLow, high: targetHigh, label: "Seller expectation", note: clean(expert.expectation_comparison) || "Compared only after the independent market value was formed." } : null;

  return {
    report_type: "THM Seller Price Perspective",
    version: 7.1,
    version_label: "Toronto House Market Version 7.1",
    generated_by: "Version 7.1 fast seller recovery + Luna Expert Comp",
    openai_model: OPENAI_MODEL,
    facts,
    valuation: {
      available: true,
      low,
      midpoint: roundMarket(midpoint),
      high,
      confidence: clean(expert.confidence) || "Limited",
      basis: `${comps.length} genuine sold MLS properties were selected and reconciled by Luna after the strict seller evidence path could not produce a supported price. Recorded sold prices were not altered.`,
      methodology: "Version 7.1 fast recovery uses the verified subject record and a broad pool of genuine sold AMPRE/VOW transactions. Luna decides which differences are economically material for this specific property and micro-market and may apply explicit professional-judgment reconciliation to imperfect comps.",
    },
    comparables: comps,
    active_comparables: [],
    comparable_policy: {
      strictEngineFirst: true,
      expertMode: true,
      fastSellerRecovery: true,
      candidateCount: candidates.length,
      selectedCount: comps.length,
      externalEvidenceCount: 0,
    },
    seller: {
      profile,
      target_range: targetRange,
      target_position: targetRange ? { low: targetLow, high: targetHigh, label: "Compared after independent valuation", note: clean(expert.expectation_comparison) } : null,
      renovation_pct: renovationPct,
      renovation_label: renovationPct == null ? "Not provided" : renovationLabel(renovationPct),
      strategy: {
        independent_market_read: clean(expert.market_read),
        likely_sale_range: clean(expert.likely_sale_range),
        suggested_listing_range: Number.isFinite(Number(expert.suggested_listing_low)) && Number.isFinite(Number(expert.suggested_listing_high)) ? { low: roundMarket(Number(expert.suggested_listing_low)), high: roundMarket(Number(expert.suggested_listing_high)) } : null,
        listing_strategy: clean(expert.listing_strategy),
        expectation_comparison: clean(expert.expectation_comparison),
        value_drivers: Array.isArray(expert.value_drivers) ? expert.value_drivers.map(clean).filter(Boolean).slice(0, 5) : [],
        preparation_priorities: Array.isArray(expert.preparation_priorities) ? expert.preparation_priorities.map(clean).filter(Boolean).slice(0, 5) : [],
      },
      evidence: { listingMatched: true, source: "AMPRE/VOW protected MLS history" },
      openai_model: OPENAI_MODEL,
    },
    narrative: {
      executive_summary: clean(expert.market_read) || `The current evidence supports an indicated value around ${roundMarket(midpoint)}.`,
      market_read: clean(expert.market_read),
      buyer_strategy: clean(expert.listing_strategy),
      strengths: Array.isArray(expert.value_drivers) ? expert.value_drivers.map(clean).filter(Boolean).slice(0, 5) : [],
      risks: [],
      inspection_priorities: Array.isArray(expert.preparation_priorities) ? expert.preparation_priorities.map(clean).filter(Boolean).slice(0, 5) : [],
      questions_for_realtor: ["Which selected sale is the best condition match?", "Would a conventional list price or offer strategy fit current competition better?"],
    },
    expert_comp_mode: {
      used: true,
      model: OPENAI_MODEL,
      selectedCount: comps.length,
      externalEvidenceCount: 0,
      confidence: clean(expert.confidence) || "Limited",
      marketRead: clean(expert.market_read),
    },
    ai_generation: { provider: "openai", model: OPENAI_MODEL, fallback_used: true, expert_comp_mode: true },
    ai_note: "Version 7.1 · Luna-only seller recovery",
    analysis_mode: "Verified MLS subject + real sold evidence + Luna Expert Comp seller reasoning",
  };
}

async function lunaSellerExpert(env, subject, candidates, profile) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      confidence: { type: "string", enum: ["Moderate", "Low", "Limited"] },
      market_read: { type: "string" },
      likely_sale_range: { type: "string" },
      suggested_listing_low: { type: "number" },
      suggested_listing_high: { type: "number" },
      listing_strategy: { type: "string" },
      expectation_comparison: { type: "string" },
      value_drivers: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      preparation_priorities: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      comparables: { type: "array", minItems: 2, maxItems: 6, items: {
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
    required: ["confidence", "market_read", "likely_sale_range", "suggested_listing_low", "suggested_listing_high", "listing_strategy", "expectation_comparison", "value_drivers", "preparation_priorities", "comparables"],
  };

  const subjectData = {
    address: subject.UnparsedAddress,
    type: subject.PropertySubType || subject.PropertyType,
    community: subject.CityRegion,
    city: subject.City,
    postal: subject.PostalCode,
    beds: num(subject.BedroomsTotal),
    baths: num(subject.BathroomsTotalInteger),
    size: subject.LivingAreaRange,
    area: num(subject.BuildingAreaTotal),
    lotWidth: num(subject.LotWidth),
    lotDepth: num(subject.LotDepth),
    parking: num(subject.ParkingTotal),
    basement: subject.Basement,
    remarks: String(subject.PublicRemarks || "").slice(0, 1000),
  };

  const ownerExpectation = money(profile.targetMin) && money(profile.targetMax) ? { low: money(profile.targetMin), high: money(profile.targetMax) } : null;
  const renovationPct = readRenovationPct(profile);
  const system = `Act as an experienced GTA residential listing Realtor performing a CMA-style recovery analysis because the strict seller engine could not produce enough clean comparable evidence quickly. Select the economically most relevant REAL sold properties from the supplied MLS candidate pool. Do not mechanically prioritize bedroom count, lot frontage, lot depth, age, size or any single field; decide what actually drives value for this specific home and micro-market. Recorded sold prices are facts and must never be altered or invented. adjusted_indication is your reasoned indication for the SUBJECT after reconciling material differences. Form your independent market view before looking at the owner's expected range. The renovation percentage, when supplied, is broad owner context only and must never become a fixed percentage or dollar adjustment. Suggested listing price may differ from expected sale value because listing strategy can be conventional or competitive. Return JSON only.`;
  const user = JSON.stringify({ subject: subjectData, renovationPct, ownerExpectation, candidates });

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "medium" },
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      text: { format: { type: "json_schema", name: "thm_v71_seller_recovery", strict: true, schema } },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${clean(data?.error?.message || "request failed")}`);
  const text = typeof data?.output_text === "string" ? data.output_text : (data?.output || []).flatMap(x => x?.content || []).filter(x => x?.type === "output_text").map(x => x.text || "").join("");
  if (!text) throw new Error("Luna returned no structured seller output.");
  return JSON.parse(text);
}

async function resolveSubject(address, token) {
  const parsed = parseAddress(address);
  if (!parsed.number || !parsed.street) return null;
  const rows = await tailQuery(`contains(StreetName,'${odata(parsed.street)}')`, token, 400);
  const matches = rows.filter(r => normalize(r.StreetNumber) === normalize(parsed.number) && normalize(r.StreetName) === normalize(parsed.street));
  const row = matches.sort((a,b)=>Date.parse(b.ModificationTimestamp || 0) - Date.parse(a.ModificationTimestamp || 0))[0];
  if (!row?.ListingKey) return null;
  const response = await fetch(`${AMPRE}/Property('${encodeURIComponent(row.ListingKey)}')`, { headers: auth(token), signal: AbortSignal.timeout(10000) });
  return response.ok ? response.json() : row;
}

async function broadSoldPool(subject, token) {
  const searches = [];
  const community = clean(subject.CityRegion);
  const postal = String(subject.PostalCode || "").replace(/\s/g, "").slice(0, 3).toUpperCase();
  const city = clean(subject.City)?.replace(/^Toronto\s+[CEW]\d{2}$/i, "Toronto");
  if (community && !/^(toronto )?[cew]\d{2}$/i.test(community)) searches.push(`contains(CityRegion,'${odata(community)}')`);
  if (/^[A-Z]\d[A-Z]$/.test(postal)) searches.push(`startswith(PostalCode,'${postal}')`);
  if (city) searches.push(`contains(UnparsedAddress,'${odata(city)}')`);

  const rows = [];
  for (const filter of [...new Set(searches)].slice(0, 3)) {
    rows.push(...await tailQuery(filter, token, 700));
    if (soldRows(subject, rows).length >= 35) break;
  }
  return soldRows(subject, rows).slice(0, 60);
}

async function tailQuery(filter, token, limit) {
  let count = null;
  const countUrl = new URL(`${AMPRE}/Property`);
  countUrl.search = new URLSearchParams({ "$filter": filter, "$count": "true", "$top": "1" });
  try {
    const r = await fetch(countUrl, { headers: auth(token), signal: AbortSignal.timeout(8000) });
    if (r.ok) count = Number((await r.json())?.["@odata.count"]);
  } catch {}

  let skip = Number.isSafeInteger(count) && count > limit ? count - limit : 0;
  const rows = [];
  while (rows.length < limit) {
    const u = new URL(`${AMPRE}/Property`);
    u.search = new URLSearchParams({ "$filter": filter, "$top": "100", ...(skip ? { "$skip": String(skip) } : {}) });
    const r = await fetch(u, { headers: auth(token), signal: AbortSignal.timeout(9000) });
    if (!r.ok) break;
    const body = await r.json().catch(() => null);
    const page = Array.isArray(body?.value) ? body.value : [];
    rows.push(...page);
    if (page.length < 100) break;
    skip += 100;
  }
  return rows;
}

function soldRows(subject, rows) {
  const seen = new Set();
  const subjectAddress = normalize(subject.UnparsedAddress);
  const subjectCondo = /condo|condominium/i.test(`${subject.PropertyType || ""} ${subject.PropertySubType || ""}`);
  return (rows || []).filter(r => {
    const id = r?.ListingKey;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    const status = `${r.StandardStatus || ""} ${r.MlsStatus || ""} ${r.ContractStatus || ""} ${r.TransactionType || ""}`;
    const price = money(r.ClosePrice || r.SoldPrice || r.SalePrice || r.FinalSalePrice);
    const soldDate = new Date(r.PurchaseContractDate || r.SoldDate || r.CloseDate || r.ModificationTimestamp || "");
    const condo = /condo|condominium/i.test(`${r.PropertyType || ""} ${r.PropertySubType || ""}`);
    return /sold|closed|deal firm/i.test(status) && !/lease|rent/i.test(status) && price > 50000 && Number.isFinite(soldDate.getTime()) && (Date.now() - soldDate.getTime()) / 864e5 <= 900 && normalize(r.UnparsedAddress) !== subjectAddress && condo === subjectCondo;
  }).map(r => ({
    id: String(r.ListingKey),
    listingKey: String(r.ListingKey),
    address: clean(r.UnparsedAddress),
    propertySubType: clean(r.PropertySubType || r.PropertyType),
    community: clean(r.CityRegion),
    city: clean(r.City),
    postalCode: clean(r.PostalCode),
    soldPrice: money(r.ClosePrice || r.SoldPrice || r.SalePrice || r.FinalSalePrice),
    soldDate: new Date(r.PurchaseContractDate || r.SoldDate || r.CloseDate || r.ModificationTimestamp).toISOString().slice(0, 10),
    beds: num(r.BedroomsTotal),
    baths: num(r.BathroomsTotalInteger),
    livingAreaRange: clean(r.LivingAreaRange),
    lotWidth: num(r.LotWidth),
    lotDepth: num(r.LotDepth),
    parking: num(r.ParkingTotal),
    basement: Array.isArray(r.Basement) ? r.Basement.join(" · ") : clean(r.Basement),
    remarks: String(r.PublicRemarks || "").slice(0, 700),
  })).sort((a,b)=>Date.parse(b.soldDate)-Date.parse(a.soldDate));
}

async function sendSpecificEmailJob(env, emailJob) {
  if (!env.RESEND_API_KEY || !emailJob?.id) return false;
  const latestRes = await supabase(env, `/rest/v1/automation_jobs?id=eq.${emailJob.id}&select=*&limit=1`);
  const latest = (await latestRes.json().catch(() => []))?.[0];
  if (!latest || latest.status === "sent" || latest.status === "completed") return true;
  if (latest.status !== "queued") return false;

  const now = new Date().toISOString();
  const claimed = await supabase(env, `/rest/v1/automation_jobs?id=eq.${latest.id}&status=eq.queued&select=*&limit=1`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "processing", attempts: Number(latest.attempts || 0) + 1, locked_at: now, updated_at: now, last_error: null }),
  });
  const rows = await claimed.json().catch(() => []);
  const job = rows?.[0];
  if (!claimed.ok || !job) return false;

  try {
    await deliverEmailJob(env, job);
    return true;
  } catch (error) {
    await supabase(env, `/rest/v1/automation_jobs?id=eq.${job.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "queued", locked_at: null, last_error: String(error?.message || error).slice(0, 300), updated_at: new Date().toISOString() }),
    }).catch(() => null);
    throw error;
  }
}

function readRenovationPct(profile) {
  if (Number.isFinite(Number(profile?.renovationPct))) return Math.max(0, Math.min(100, Number(profile.renovationPct)));
  const match = String(profile?.notes || "").match(/\[THM_RENOVATION_PCT:(\d{1,3})\]/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}
function renovationLabel(n) { return n <= 10 ? "Mostly original / dated" : n <= 35 ? "Some updates" : n <= 60 ? "Partially renovated" : n <= 85 ? "Extensively renovated" : "Fully renovated / recent finish"; }
function parseAddress(value) { const m = String(value || "").match(/^\s*(\d+[A-Za-z]?)\s+([^,]+)/); if (!m) return {}; const street = m[2].trim().replace(/\b(?:road|rd|drive|dr|crescent|cres|street|st|avenue|ave|court|ct|boulevard|blvd|lane|ln|trail|tr|place|pl)\b.*$/i, "").trim(); return { number: m[1], street }; }
function auth(token) { return { Authorization: `Bearer ${token}`, Accept: "application/json" }; }
function odata(v) { return String(v || "").replace(/'/g, "''"); }
function normalize(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function clean(v) { return typeof v === "string" ? v.trim() || null : v == null ? null : String(v); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function money(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function median(values) { const a = values.filter(Number.isFinite).sort((x,y)=>x-y); if (!a.length) return null; const m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2; }
function roundMarket(v) { if (!Number.isFinite(v)) return null; const step = v >= 1e6 ? 10000 : 5000; return Math.round(v / step) * step; }
function logError(error) { console.error(JSON.stringify({ event: "v7_1_fast_seller_error", error: String(error?.message || error).slice(0, 300) })); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION } }); }

function supabase(env, path, init = {}) {
  const base = env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co";
  return fetch(`${base}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(12000),
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}
