const OPENAI_URL = "https://api.openai.com/v1/responses";
const AMPRE = "https://query.ampre.ca/odata";
const TERRA = "gpt-5.6-terra";
const SUBJECT_KEY = "C12669908";
const LUNA_SHORTLIST = ["C13141592", "C12677370", "C13733576", "C13752820"];
const LUNA_BASELINE = { low: 1870000, midpoint: 1990000, high: 2110000, selectedCount: 4 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/compare" || request.method !== "GET") return json({ ok: false, error: "Not found" }, 404);
    if (!url.hostname.endsWith(".workers.dev") || url.hostname.startsWith("prototype-1-torontohousemarket.")) return json({ ok: false, error: "Preview only" }, 404);
    if (!env.OPENAI_API_KEY || !env.AMPRE_VOW_TOKEN) return json({ ok: false, error: "Required preview secrets unavailable" }, 503);

    const records = await Promise.all([SUBJECT_KEY, ...LUNA_SHORTLIST].map(key => fetchListing(env.AMPRE_VOW_TOKEN, key)));
    const subject = records[0];
    const comps = records.slice(1).filter(Boolean);
    if (!subject || comps.length !== LUNA_SHORTLIST.length) return json({ ok: false, error: "Could not retrieve the subject and all Luna-shortlisted MLS records." }, 502);

    const terra = await terraFinal(env.OPENAI_API_KEY, normalizeSubject(subject), comps.map(normalizeComp));
    const byId = new Map(comps.map(r => [String(r.ListingKey), normalizeComp(r)]));
    const selected = (terra.comparables || []).map(x => {
      const base = byId.get(String(x.id));
      if (!base) return null;
      return {
        listingKey: base.id,
        recordedSoldPrice: base.soldPrice,
        recordedSoldDate: base.soldDate,
        adjustedIndication: Number(x.adjusted_indication),
        weight: Number(x.weight),
        adjustmentBasis: x.adjustment_basis,
        selectionReason: x.selection_reason,
        adjustmentReason: x.adjustment_reason,
      };
    }).filter(Boolean);

    if (selected.length < 2) return json({ ok: false, error: "Terra selected fewer than two usable comps." }, 422);
    const indications = selected.map(x => x.adjustedIndication).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
    const midpointRaw = median(indications);
    const spread = indications.length >= 3 ? Math.max(...indications) - Math.min(...indications) : midpointRaw * 0.16;
    const margin = Math.max(midpointRaw * (indications.length >= 4 ? 0.06 : 0.09), spread * 0.35);
    const hybrid = {
      low: roundMarket(midpointRaw - margin),
      midpoint: roundMarket(midpointRaw),
      high: roundMarket(midpointRaw + margin),
      selectedCount: selected.length,
      confidence: terra.confidence,
      marketRead: terra.market_read,
      likelySaleRange: terra.likely_sale_range,
    };

    return json({
      ok: true,
      architecture: "Existing Luna shortlist -> Terra final reconciliation",
      subject: { address: subject.UnparsedAddress, listingKey: subject.ListingKey },
      lunaBaseline: LUNA_BASELINE,
      hybrid,
      difference: {
        low: hybrid.low - LUNA_BASELINE.low,
        midpoint: hybrid.midpoint - LUNA_BASELINE.midpoint,
        high: hybrid.high - LUNA_BASELINE.high,
        midpointPct: Math.round(((hybrid.midpoint - LUNA_BASELINE.midpoint) / LUNA_BASELINE.midpoint) * 10000) / 100,
      },
      terraSelections: selected,
      note: "The four candidate sales are the exact Luna shortlist from the existing Version 7.1 report. Terra received freshly retrieved raw MLS facts for those four and independently set its own adjusted indications; Luna's prior adjustments were not supplied to Terra."
    });
  }
};

async function fetchListing(token, key) {
  const response = await fetch(`${AMPRE}/Property('${encodeURIComponent(key)}')`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  return response.json();
}

function normalizeSubject(r) {
  return {
    id: r.ListingKey,
    address: r.UnparsedAddress,
    community: r.CityRegion,
    city: r.City,
    postalCode: r.PostalCode,
    propertyType: r.PropertyType,
    propertySubType: r.PropertySubType,
    beds: num(r.BedroomsTotal),
    aboveGradeBeds: num(r.BedroomsAboveGrade),
    baths: num(r.BathroomsTotalInteger),
    livingAreaRange: r.LivingAreaRange || null,
    buildingAreaTotal: num(r.BuildingAreaTotal),
    lotWidth: num(r.LotWidth),
    lotDepth: num(r.LotDepth),
    parking: num(r.ParkingTotal),
    basement: Array.isArray(r.Basement) ? r.Basement.join(" · ") : r.Basement || null,
    garage: r.GarageType || null,
    remarks: String(r.PublicRemarks || "").slice(0, 1400),
  };
}

function normalizeComp(r) {
  return {
    id: String(r.ListingKey),
    address: r.UnparsedAddress,
    community: r.CityRegion,
    city: r.City,
    postalCode: r.PostalCode,
    propertyType: r.PropertyType,
    propertySubType: r.PropertySubType,
    soldPrice: money(r.ClosePrice || r.SoldPrice || r.SalePrice || r.FinalSalePrice),
    soldDate: isoDate(r.PurchaseContractDate || r.SoldDate || r.CloseDate || r.ModificationTimestamp),
    beds: num(r.BedroomsTotal),
    aboveGradeBeds: num(r.BedroomsAboveGrade),
    baths: num(r.BathroomsTotalInteger),
    livingAreaRange: r.LivingAreaRange || null,
    buildingAreaTotal: num(r.BuildingAreaTotal),
    lotWidth: num(r.LotWidth),
    lotDepth: num(r.LotDepth),
    parking: num(r.ParkingTotal),
    basement: Array.isArray(r.Basement) ? r.Basement.join(" · ") : r.Basement || null,
    garage: r.GarageType || null,
    remarks: String(r.PublicRemarks || "").slice(0, 1200),
  };
}

async function terraFinal(apiKey, subject, candidates) {
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      confidence: { type: "string", enum: ["Moderate", "Low", "Limited"] },
      market_read: { type: "string" },
      likely_sale_range: { type: "string" },
      comparables: { type: "array", minItems: 2, maxItems: 4, items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string" },
          weight: { type: "number", minimum: 0.1, maximum: 1 },
          adjusted_indication: { type: "number" },
          selection_reason: { type: "string" },
          adjustment_reason: { type: "string" },
          adjustment_basis: { type: "string", enum: ["evidence_supported", "professional_judgment", "none"] },
        },
        required: ["id", "weight", "adjusted_indication", "selection_reason", "adjustment_reason", "adjustment_basis"]
      } }
    },
    required: ["confidence", "market_read", "likely_sale_range", "comparables"]
  };

  const system = `Act as an experienced GTA residential Realtor performing the FINAL reconciliation of a seller CMA. A cheaper screening model has already narrowed the broad MLS pool to these four genuine sold transactions. Independently decide which of these four deserve final weight and what each sale indicates for the subject. Do not mechanically prioritize bedroom count, frontage, depth, age, or size. Decide what is economically material for this specific Annex semi-detached subject and micro-market. Use the raw MLS facts and remarks supplied here. Never change or invent a recorded sold price. adjusted_indication is your reasoned subject-value indication derived from that sale, not a replacement sold price. Be conservative with unsupported dollar adjustments. Return JSON only.`;

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: TERRA,
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ subject, luna_shortlist_raw_sales: candidates }) }
      ],
      text: { format: { type: "json_schema", name: "howland_terra_final", strict: true, schema } }
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${data?.error?.message || "request failed"}`);
  const text = typeof data?.output_text === "string" ? data.output_text : (data?.output || []).flatMap(x => x?.content || []).filter(x => x?.type === "output_text").map(x => x.text || "").join("");
  if (!text) throw new Error("Terra returned no structured output.");
  return JSON.parse(text);
}

function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function money(v){ const n=Number(v); return Number.isFinite(n)&&n>0?n:null; }
function isoDate(v){ const d=new Date(v||""); return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null; }
function median(a){ const v=a.filter(Number.isFinite).sort((x,y)=>x-y); const m=Math.floor(v.length/2); return v.length%2?v[m]:(v[m-1]+v[m])/2; }
function roundMarket(v){ const step=v>=1000000?10000:5000; return Math.round(v/step)*step; }
function json(body,status=200){ return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}}); }
