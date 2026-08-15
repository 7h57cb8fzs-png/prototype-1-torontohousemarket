export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/property" && request.method === "GET") {
      return handleProperty(request, env);
    }
    if (url.pathname === "/api/media" && request.method === "GET") {
      return handleMedia(request, env);
    }
    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found." }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};

const AMPRE_BASE = "https://query.ampre.ca/odata";
const SUPABASE_URL = "https://pwbtxyavjjotxtvegrqe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3YnR4eWF2ampvdHh0dmVncnFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MjgzOTEsImV4cCI6MjEwMjMwNDM5MX0.IkLqoz2h_Qu9GpeonQR0I6ZeHdsd9HSccrNECFUtJtU";
const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

async function handleProperty(request, env) {
  if (!env.AMPRE_TOKEN) return json({ ok: false, error: "IDX connection is not configured." }, 503);

  const url = new URL(request.url);
  const listingKeyParam = clean(url.searchParams.get("listingKey"), 40).toUpperCase();
  const rawQuery = clean(url.searchParams.get("q"), 1000);
  const rawInput = listingKeyParam || rawQuery;
  if (!rawInput) return json({ ok: false, error: "Enter an MLS number, street address, or listing URL." }, 400);

  const input = classifyInput(rawInput);
  if (input.type === "link" && !input.listingKey && !looksLikeAddress(input.queryText)) {
    return json({ ok: false, error: "We could not validate that listing URL. Paste the MLS number or street address from the listing." }, 422);
  }

  let subject = null;
  let history = [];
  let resolution = null;
  let validationLabel = null;

  const directKey = /^[A-Z]\d{7,9}$/.test(listingKeyParam) ? listingKeyParam : input.listingKey;
  if (directKey) {
    subject = await fetchPropertyByKey(directKey, env);
    if (!subject) return json({ ok: false, error: "That MLS listing could not be found." }, 404);
    history = await findSameAddressHistory(subject, env);
    resolution = input.type === "link" ? "link_mls" : "mls";
    validationLabel = input.type === "link" ? `Listing URL matched to MLS ${subject.ListingKey}` : `MLS ${subject.ListingKey} verified`;
  } else {
    const found = await resolveAddress(input.queryText || rawQuery, env);
    if (!found.subject) {
      return json({
        ok: true,
        property: buildNoMlsProperty(input.queryText || rawQuery, input.type === "link" ? "Listing URL checked" : "Address checked")
      });
    }
    subject = found.subject.ListingKey ? (await fetchPropertyByKey(found.subject.ListingKey, env) || found.subject) : found.subject;
    history = found.history;
    resolution = found.resolution;
    validationLabel = input.type === "link"
      ? `Listing URL matched to ${subject.ListingKey ? `MLS ${subject.ListingKey}` : "MLS history"}`
      : found.resolution === "address_live"
        ? `Address matched to active MLS ${subject.ListingKey}`
        : "Address matched to MLS history";
  }

  const activeForSale = isActiveForSale(subject);
  const addressDisplayAllowed = subject.InternetAddressDisplayYN !== false;
  const fullDisplayAllowed = subject.InternetEntireListingDisplayYN !== false;
  const displayRestricted = activeForSale && !fullDisplayAllowed;

  const [comparableContext, mediaRecords] = await Promise.all([
    buildComparableContext(subject, env, activeForSale),
    activeForSale && fullDisplayAllowed ? fetchPropertyMedia(subject.ListingKey, env) : Promise.resolve([]),
  ]);

  const historySummary = summarizeHistory(history, subject);
  const priceOpinion = buildPriceOpinion(comparableContext, activeForSale);
  const property = normalizeSubject(subject, {
    activeForSale,
    addressDisplayAllowed,
    fullDisplayAllowed,
    displayRestricted,
    resolution,
    validationLabel,
    comparableContext,
    historySummary,
    priceOpinion,
    photos: normalizeMedia(mediaRecords),
  });

  return json({ ok: true, property });
}

function buildNoMlsProperty(address, validationLabel) {
  return {
    listingKey: null,
    address: address || "Selected property",
    city: null,
    cityRegion: null,
    postalCode: null,
    forSale: false,
    foundInMls: false,
    marketStatus: "Not currently listed",
    status: "Off market",
    transactionType: null,
    propertyType: null,
    propertySubType: null,
    beds: null,
    baths: null,
    livingAreaRange: null,
    buildingAreaTotal: null,
    lotWidth: null,
    lotDepth: null,
    parkingTotal: null,
    garageType: null,
    basement: [],
    kitchensTotal: null,
    remarks: null,
    listPrice: null,
    daysLive: null,
    photos: [],
    inputValidation: { type: "address", label: validationLabel },
    historySummary: { years: 10, appearanceCount: 0, lastStatus: null, lastListPrice: null, lastSeenDate: null, latestSold: null },
    comparableContext: { available: false, matchCount: 0, confidence: "Unavailable", basis: "No matching MLS record was found for this address." },
    priceOpinion: { available: false, label: "Deep report available", note: "A broader owner/property review can still be requested." },
    offerTiming: { type: "not_for_sale", label: "Not for sale", note: "No active for-sale listing was found." },
    showingFocus: { title: "Off-market property", note: "Request a deeper property report or, if you own the home, a seller-focused value review." },
    details: {},
    displayRestricted: false,
    resolution: "no_mls_match",
  };
}

async function fetchPropertyByKey(listingKey, env) {
  if (!listingKey) return null;
  const params = new URLSearchParams();
  params.set("$expand", "Media($select=MediaKey,MediaModificationTimestamp,MediaURL,MediaType;$filter=MediaType eq 'image/jpeg')");
  let response = await amplifyFetch(`${AMPRE_BASE}/Property('${encodeURIComponent(listingKey)}')?${params.toString()}`, env);
  if (!response.ok) response = await amplifyFetch(`${AMPRE_BASE}/Property('${encodeURIComponent(listingKey)}')`, env);
  if (!response.ok) return null;
  return response.json();
}

function classifyInput(value) {
  const raw = String(value || "").trim();
  const direct = detectMlsKey(raw);
  if (!/^https?:\/\//i.test(raw)) {
    return { type: direct ? "mls" : "address", listingKey: direct, queryText: raw };
  }
  try {
    const u = new URL(raw);
    const decoded = decodeURIComponent(`${u.pathname} ${u.search}`)
      .replace(/[+_|-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      type: "link",
      listingKey: detectMlsKey(decoded) || direct,
      queryText: extractAddressLikeText(decoded),
    };
  } catch {
    return { type: "address", listingKey: direct, queryText: raw };
  }
}

function extractAddressLikeText(text) {
  const decoded = String(text || "").replace(/[%/]/g, " ").replace(/\s+/g, " ").trim();
  const match = decoded.match(/\b(\d+[A-Za-z]?)\s+([A-Za-z0-9.' -]{2,60}?)(?:\s+)(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl)\b/i);
  return match ? `${match[1]} ${match[2]} ${match[3]}`.replace(/\s+/g, " ").trim() : decoded;
}

function looksLikeAddress(value) {
  return /^\s*\d+[A-Za-z]?\s+[A-Za-z0-9.' -]{2,}/.test(String(value || ""));
}

function detectMlsKey(value) {
  const match = String(value || "").toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

async function resolveAddress(input, env) {
  const parsed = parseAddress(input);
  if (!parsed.streetNumber || !parsed.streetName) return { subject: null, history: [], resolution: null };

  const number = odataString(parsed.streetNumber);
  const name = odataString(titleCase(parsed.streetName));
  const full = odataString(`${parsed.streetNumber} ${titleCase(parsed.streetName)}${parsed.streetSuffix ? ` ${titleCase(parsed.streetSuffix)}` : ""}`);
  const short = odataString(`${parsed.streetNumber} ${titleCase(parsed.streetName)}`);

  const querySets = [
    [`StreetNumber eq '${number}'`, `contains(StreetName,'${name}')`],
    [`contains(UnparsedAddress,'${full}')`],
    [`contains(UnparsedAddress,'${short}')`],
  ];

  let records = [];
  for (const filters of querySets) {
    records = await queryProperties(filters, env, 100, "ModificationTimestamp desc,ListingKey desc");
    if (records.length) break;
  }

  if (!records.length) {
    records = await queryProperties([`contains(StreetName,'${name}')`], env, 150, "ModificationTimestamp desc,ListingKey desc");
  }

  const scored = records
    .map((r) => ({ r, score: addressMatchScore(parsed, r) }))
    .filter((x) => x.score >= 55)
    .sort((a, b) => b.score - a.score || dateMs(b.r.ModificationTimestamp) - dateMs(a.r.ModificationTimestamp));

  if (!scored.length) return { subject: null, history: [], resolution: null };

  const exact = scored.filter((x) => sameAddressAs(parsed, x.r)).map((x) => x.r);
  const candidates = exact.length ? exact : scored.map((x) => x.r);
  const active = candidates.find(isActiveForSale);
  const subject = active || candidates.slice().sort(mostRecentRecord)[0] || null;
  const history = candidates.filter(withinTenYears);

  return {
    subject,
    history: history.length ? history : [subject].filter(Boolean),
    resolution: active ? "address_live" : "address_history",
  };
}

function parseAddress(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  const firstPart = text.split(",")[0].trim();
  const m = firstPart.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return { streetNumber: null, streetName: null, streetSuffix: null };

  const streetNumber = m[1];
  const tokens = m[2].trim().split(/\s+/);
  const suffixes = new Map([
    ["street", "Street"], ["st", "Street"], ["road", "Road"], ["rd", "Road"],
    ["avenue", "Avenue"], ["ave", "Avenue"], ["drive", "Drive"], ["dr", "Drive"],
    ["crescent", "Crescent"], ["cres", "Crescent"], ["court", "Court"], ["ct", "Court"],
    ["boulevard", "Boulevard"], ["blvd", "Boulevard"], ["lane", "Lane"], ["ln", "Lane"],
    ["way", "Way"], ["trail", "Trail"], ["tr", "Trail"], ["place", "Place"], ["pl", "Place"],
  ]);
  const last = tokens[tokens.length - 1]?.replace(/\./g, "").toLowerCase();
  const streetSuffix = suffixes.get(last) || null;
  if (streetSuffix) tokens.pop();
  return { streetNumber, streetName: tokens.join(" "), streetSuffix };
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function addressMatchScore(parsed, r) {
  let score = 0;
  const num = String(r.StreetNumber || "").trim();
  const name = normalizeText(r.StreetName);
  const suffix = normalizeText(r.StreetSuffix);
  if (num === String(parsed.streetNumber || "").trim()) score += 40;
  if (parsed.streetName && name === normalizeText(parsed.streetName)) score += 40;
  else if (parsed.streetName && name.includes(normalizeText(parsed.streetName))) score += 30;
  if (parsed.streetSuffix && suffix === normalizeText(parsed.streetSuffix)) score += 10;
  if (isActiveForSale(r)) score += 10;
  return Math.min(100, score);
}

function sameAddressAs(parsed, r) {
  const numberMatch = String(r.StreetNumber || "").trim().toLowerCase() === String(parsed.streetNumber || "").trim().toLowerCase();
  const streetMatch = normalizeText(r.StreetName) === normalizeText(parsed.streetName);
  return numberMatch && streetMatch;
}

async function findSameAddressHistory(subject, env) {
  if (!subject?.StreetNumber || !subject?.StreetName) return [subject].filter(Boolean);
  const records = await queryProperties([
    `StreetNumber eq '${odataString(subject.StreetNumber)}'`,
    `contains(StreetName,'${odataString(titleCase(subject.StreetName))}')`,
  ], env, 120, "ModificationTimestamp desc,ListingKey desc");
  const exact = records.filter((r) => samePhysicalAddress(subject, r)).filter(withinTenYears);
  return exact.length ? exact : [subject];
}

function samePhysicalAddress(a, b) {
  const num = String(a.StreetNumber || "").trim().toLowerCase() === String(b.StreetNumber || "").trim().toLowerCase();
  const street = normalizeText(a.StreetName) === normalizeText(b.StreetName);
  const unitA = normalizeText(a.UnitNumber || a.ApartmentNumber || "");
  const unitB = normalizeText(b.UnitNumber || b.ApartmentNumber || "");
  return num && street && (!unitA || !unitB || unitA === unitB);
}

async function fetchPropertyMedia(listingKey, env) {
  if (!listingKey) return [];
  const params = new URLSearchParams();
  params.set("$top", "100");
  params.set("$filter", `ResourceRecordKey eq '${odataString(listingKey)}' and ResourceName eq 'Property'`);
  params.set("$orderby", "MediaModificationTimestamp,MediaKey");
  const response = await amplifyFetch(`${AMPRE_BASE}/Media?${params.toString()}`, env);
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({}));
  return Array.isArray(body.value) ? body.value : [];
}

function normalizeMedia(records) {
  const seen = new Set();
  const output = [];
  for (const m of records || []) {
    const mediaKey = m?.MediaKey;
    const mediaUrl = String(m?.MediaURL || "");
    const type = String(m?.MediaType || "").toLowerCase();
    if (!mediaKey || !mediaUrl) continue;
    if (!(type.startsWith("image/") || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(mediaUrl))) continue;
    if (seen.has(mediaKey)) continue;
    seen.add(mediaKey);
    output.push({
      key: mediaKey,
      url: `/api/media?key=${encodeURIComponent(mediaKey)}`,
      description: cleanText(m.ShortDescription || m.LongDescription),
    });
  }
  return output.slice(0, 60);
}

async function handleMedia(request, env) {
  if (!env.AMPRE_TOKEN) return new Response("", { status: 404 });
  const url = new URL(request.url);
  const key = clean(url.searchParams.get("key"), 120);
  if (!/^[A-Za-z0-9-]{8,120}$/.test(key)) return new Response("", { status: 400 });

  const recordResponse = await amplifyFetch(`${AMPRE_BASE}/Media('${encodeURIComponent(key)}')`, env);
  if (!recordResponse.ok) return new Response("", { status: 404 });
  const media = await recordResponse.json().catch(() => null);
  if (!media?.MediaURL || String(media.ResourceName || "Property") !== "Property") return new Response("", { status: 404 });

  let remoteUrl;
  try {
    remoteUrl = new URL(media.MediaURL);
    if (remoteUrl.protocol !== "https:") return new Response("", { status: 404 });
  } catch {
    return new Response("", { status: 404 });
  }

  let imageResponse = await fetch(remoteUrl.toString(), { headers: { Accept: "image/*" } });
  if (imageResponse.status === 401 || imageResponse.status === 403) {
    imageResponse = await fetch(remoteUrl.toString(), {
      headers: { Accept: "image/*", Authorization: `Bearer ${env.AMPRE_TOKEN}` },
    });
  }
  if (!imageResponse.ok || !imageResponse.body) return new Response("", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", imageResponse.headers.get("Content-Type") || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(imageResponse.body, { status: 200, headers });
}

function normalizeSubject(p, extras) {
  const active = extras.activeForSale;
  const canShowFull = !extras.displayRestricted;
  const address = extras.addressDisplayAllowed ? (p.UnparsedAddress || buildAddress(p)) : "Address display restricted";
  return {
    listingKey: p.ListingKey || null,
    address,
    city: p.City || null,
    cityRegion: p.CityRegion || null,
    postalCode: p.PostalCode || null,
    forSale: active,
    foundInMls: true,
    marketStatus: active ? "For sale" : "Not currently listed",
    status: p.StandardStatus || p.MlsStatus || p.ContractStatus || null,
    transactionType: p.TransactionType || null,
    propertyType: canShowFull ? (p.PropertyType || null) : null,
    propertySubType: canShowFull ? cleanText(p.PropertySubType) : null,
    beds: canShowFull ? numberOrNull(p.BedroomsTotal) : null,
    baths: canShowFull ? numberOrNull(p.BathroomsTotalInteger) : null,
    livingAreaRange: canShowFull ? (p.LivingAreaRange || null) : null,
    buildingAreaTotal: canShowFull ? numberOrNull(p.BuildingAreaTotal) : null,
    lotWidth: canShowFull ? numberOrNull(p.LotWidth) : null,
    lotDepth: canShowFull ? numberOrNull(p.LotDepth) : null,
    parkingTotal: canShowFull ? numberOrNull(p.ParkingTotal) : null,
    garageType: canShowFull ? (p.GarageType || null) : null,
    basement: canShowFull && Array.isArray(p.Basement) ? p.Basement : [],
    kitchensTotal: canShowFull ? numberOrNull(p.KitchensTotal) : null,
    remarks: active && canShowFull ? cleanText(p.PublicRemarks) : null,
    listPrice: active && canShowFull ? numberOrNull(p.ListPrice) : null,
    lastKnownListPrice: !active ? numberOrNull(p.ListPrice) : null,
    daysLive: active ? daysSince(p.OriginalEntryTimestamp) : null,
    photos: active && canShowFull ? extras.photos : [],
    inputValidation: { type: extras.resolution, label: extras.validationLabel || "Property checked" },
    historySummary: extras.historySummary,
    comparableContext: extras.comparableContext,
    priceOpinion: extras.priceOpinion,
    offerTiming: active ? detectOfferTiming(p) : { type: "not_for_sale", label: "Not for sale", note: "No active for-sale listing was found." },
    showingFocus: active ? buildShowingFocus(p) : buildOffMarketFocus(extras.historySummary),
    displayRestricted: extras.displayRestricted,
    resolution: extras.resolution,
    details: canShowFull ? {
      annualTax: numberOrNull(p.TaxAnnualAmount),
      taxYear: numberOrNull(p.TaxYear),
      architecturalStyle: arrayOrValue(p.ArchitecturalStyle),
      construction: arrayOrValue(p.ConstructionMaterials),
      heating: arrayOrValue(Array.isArray(p.HeatTypeMulti) && p.HeatTypeMulti.length ? p.HeatTypeMulti : p.HeatType),
      cooling: arrayOrValue(p.Cooling),
      parking: arrayOrValue(p.ParkingFeatures),
      possession: cleanText(p.PossessionDetails || p.PossessionType),
      crossStreet: cleanText(p.CrossStreet),
      interior: arrayOrValue(p.InteriorFeatures),
      pool: arrayOrValue(p.PoolFeatures),
      direction: cleanText(p.DirectionFaces),
      listingOffice: active ? cleanText(p.ListOfficeName) : null,
      listedAt: p.OriginalEntryTimestamp || null,
    } : {},
  };
}

function isActiveForSale(p) {
  const status = `${p?.StandardStatus || ""} ${p?.MlsStatus || ""} ${p?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(p?.TransactionType || "").toLowerCase();
  const sale = transaction.includes("for sale") || (!transaction && p?.BoardPropertyType !== "Com");
  const inactive = /closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
  const active = /active|available|new/.test(status);
  return sale && active && !inactive;
}

function withinTenYears(r) {
  const d = validDate(r?.OriginalEntryTimestamp) || validDate(r?.ModificationTimestamp) || validDate(r?.SystemModificationTimestamp);
  return !d || Date.now() - d.getTime() <= TEN_YEARS_MS;
}

function summarizeHistory(history, subject) {
  const records = dedupe((history || []).filter(Boolean)).filter(withinTenYears).sort(mostRecentRecord);
  const latest = records[0] || subject;
  return {
    years: 10,
    appearanceCount: records.length,
    lastStatus: latest?.StandardStatus || latest?.MlsStatus || latest?.ContractStatus || null,
    lastListPrice: numberOrNull(latest?.ListPrice),
    lastSeenDate: dateOnly(latest?.OriginalEntryTimestamp || latest?.ModificationTimestamp),
    latestSold: records.map(historicalSoldSummary).filter(Boolean).sort((a, b) => dateMs(b.date) - dateMs(a.date))[0] || null,
  };
}

function historicalSoldSummary(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  if (!/closed|sold/i.test(status)) return null;
  const price = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const date = firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]);
  if (!price || !validDate(date)) return null;
  return { price, date: dateOnly(date) };
}

async function buildComparableContext(subject, env, activeForSale) {
  if (!subject) return unavailableComp("No subject property was available.");
  const base = [];
  if (subject.CityRegion) base.push(`CityRegion eq '${odataString(subject.CityRegion)}'`);
  else if (subject.City) base.push(`City eq '${odataString(subject.City)}'`);
  if (subject.PropertyType) base.push(`PropertyType eq '${odataString(subject.PropertyType)}'`);

  const raw = await queryProperties(base, env, 220, "ModificationTimestamp desc,ListingKey desc");
  const candidates = dedupe(raw)
    .filter((r) => r.ListingKey !== subject.ListingKey)
    .filter(withinTenYears)
    .map((r) => normalizeComparable(subject, r))
    .filter((c) => c.price && c.similarity >= 32)
    .sort(compareComparable)
    .slice(0, 10);

  if (candidates.length < 3) return unavailableComp("The current MLS match set is too thin to force a range.", candidates.length);

  const selected = candidates.slice(0, 7);
  const band = weightedBand(selected);
  const avgScore = selected.reduce((sum, x) => sum + x.similarity, 0) / selected.length;
  const soldCount = selected.filter((x) => x.source === "sold").length;
  const activeCount = selected.filter((x) => x.source === "active").length;
  const confidence = avgScore >= 72 && selected.length >= 5 ? "Strong" : avgScore >= 58 ? "Good" : "Indicative";

  return {
    available: true,
    matchCount: selected.length,
    confidence,
    rangeLow: band.low,
    midpoint: band.mid,
    rangeHigh: band.high,
    soldCount,
    activeCount,
    historicalCount: selected.length - soldCount - activeCount,
    sourceLabel: soldCount >= 3 ? "sold-led match set" : activeCount >= 3 ? "live-market match set" : "blended MLS match set",
    basis: buildBasisText(subject, selected),
    activeForSale,
  };
}

function unavailableComp(basis, matchCount = 0) {
  return { available: false, matchCount, confidence: "Unavailable", basis };
}

function normalizeComparable(subject, r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  const soldLike = /closed|sold/i.test(status);
  const activeLike = isActiveForSale(r);
  const soldPrice = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const listPrice = numberOrNull(r.ListPrice);
  let source = null;
  let price = null;
  if (soldLike && soldPrice) { source = "sold"; price = soldPrice; }
  else if (activeLike && listPrice) { source = "active"; price = listPrice; }
  else if (listPrice) { source = "historical"; price = listPrice; }

  const recordDate = validDate(firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "OriginalEntryTimestamp", "ModificationTimestamp"]));
  return {
    record: r,
    source,
    price,
    similarity: similarityScore(subject, r),
    recency: recencyWeight(recordDate),
    reliability: source === "sold" ? 1 : source === "active" ? 0.82 : 0.58,
  };
}

function similarityScore(subject, c) {
  let earned = 0;
  let possible = 0;
  const add = (weight, score) => { possible += weight; earned += weight * clamp(score, 0, 1); };

  if (subject.CityRegion && c.CityRegion) add(14, sameText(subject.CityRegion, c.CityRegion) ? 1 : 0);
  else if (subject.City && c.City) add(10, sameText(subject.City, c.City) ? 1 : 0);
  if (subject.PropertyType && c.PropertyType) add(10, sameText(subject.PropertyType, c.PropertyType) ? 1 : 0);
  if (subject.PropertySubType && c.PropertySubType) add(24, sameText(subject.PropertySubType, c.PropertySubType) ? 1 : 0);

  const bedA = numberOrNull(subject.BedroomsTotal), bedB = numberOrNull(c.BedroomsTotal);
  if (bedA != null && bedB != null) add(11, diffScore(bedA, bedB, 2));
  const bathA = numberOrNull(subject.BathroomsTotalInteger), bathB = numberOrNull(c.BathroomsTotalInteger);
  if (bathA != null && bathB != null) add(9, diffScore(bathA, bathB, 2));

  const areaA = rangeMid(subject.LivingAreaRange) || numberOrNull(subject.BuildingAreaTotal);
  const areaB = rangeMid(c.LivingAreaRange) || numberOrNull(c.BuildingAreaTotal);
  if (areaA && areaB) add(14, ratioCloseness(areaA, areaB, 0.45));

  const widthA = numberOrNull(subject.LotWidth), widthB = numberOrNull(c.LotWidth);
  if (widthA && widthB) add(7, ratioCloseness(widthA, widthB, 0.6));
  const depthA = numberOrNull(subject.LotDepth), depthB = numberOrNull(c.LotDepth);
  if (depthA && depthB) add(6, ratioCloseness(depthA, depthB, 0.6));

  const parkA = numberOrNull(subject.ParkingTotal), parkB = numberOrNull(c.ParkingTotal);
  if (parkA != null && parkB != null) add(3, diffScore(parkA, parkB, 5));
  const basementA = arrayText(subject.Basement), basementB = arrayText(c.Basement);
  if (basementA && basementB) add(2, tokenOverlap(basementA, basementB));

  return possible ? Math.round((earned / possible) * 100) : 0;
}

function compareComparable(a, b) {
  const aw = a.similarity * 0.76 + a.recency * 16 + a.reliability * 8;
  const bw = b.similarity * 0.76 + b.recency * 16 + b.reliability * 8;
  return bw - aw;
}

function weightedBand(matches) {
  const items = matches.map((m) => ({
    price: m.price,
    weight: Math.max(0.04, Math.pow(m.similarity / 100, 2) * (0.45 + 0.35 * m.recency + 0.20 * m.reliability)),
  })).sort((a, b) => a.price - b.price);
  return {
    low: roundMarket(weightedQuantile(items, 0.2)),
    mid: roundMarket(weightedQuantile(items, 0.5)),
    high: roundMarket(weightedQuantile(items, 0.8)),
  };
}

function weightedQuantile(items, q) {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let running = 0;
  for (const item of items) {
    running += item.weight;
    if (running >= total * q) return item.price;
  }
  return items[items.length - 1]?.price || 0;
}

function buildBasisText(subject, matches) {
  const parts = [];
  const subtypeHits = matches.filter((m) => sameText(subject.PropertySubType, m.record.PropertySubType)).length;
  if (subject.PropertySubType && subtypeHits) parts.push(`${subtypeHits}/${matches.length} same property subtype`);
  const bed = numberOrNull(subject.BedroomsTotal);
  if (bed != null) {
    const hits = matches.filter((m) => {
      const b = numberOrNull(m.record.BedroomsTotal);
      return b != null && Math.abs(b - bed) <= 1;
    }).length;
    if (hits) parts.push(`${hits}/${matches.length} within ±1 bedroom`);
  }
  if (subject.LivingAreaRange || subject.LotWidth) parts.push("size and lot weighted");
  parts.push("recency weighted");
  return parts.join(" · ");
}

function buildPriceOpinion(comp, activeForSale) {
  if (!comp?.available) return { available: false, label: activeForSale ? "Range unavailable" : "Value review available", note: comp?.basis || "Not enough reliable matches." };
  return {
    available: true,
    low: comp.rangeLow,
    midpoint: comp.midpoint,
    high: comp.rangeHigh,
    confidence: comp.confidence,
    label: activeForSale ? "THM market range" : "THM indicative value",
    note: `${comp.sourceLabel}; similarity and recency weighted.`,
  };
}

function detectOfferTiming(p) {
  const text = [p.PublicRemarks, p.PublicRemarksExtras].filter((v) => typeof v === "string").join(" ");
  const offerText = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => /\boffer(?:s|ing)?\b|offer presentation|presentation of offers/i.test(s)).join(" ");
  if (/offers?\s+anytime|any\s*time/i.test(offerText)) return { type: "anytime", label: "Offers anytime", note: "No scheduled presentation was detected in public remarks. Verify before drafting." };
  const date = offerText.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i)?.[0] || null;
  const time = offerText.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i)?.[0] || null;
  if (offerText && (date || time)) return { type: "scheduled", label: [date, time].filter(Boolean).join(" · "), note: "Offer timing was detected in public remarks. Realtor verification required." };
  return { type: "verify", label: "Verify offer timing", note: "No reliable offer date was detected in the public listing remarks." };
}

function buildShowingFocus(p) {
  const remarks = String(p.PublicRemarks || "");
  if (/separate entrance|apartment|unit|income|multi-generational|multi generational/i.test(remarks)) {
    return { title: "Verify suite / income potential", note: "Check entrances, egress, utilities, ceiling heights and whether any secondary-unit use or alterations are legal and permitted." };
  }
  if (/renovat|updated|upgrade|newly/i.test(remarks)) {
    return { title: "Verify renovation quality", note: "Look past finishes. Ask what was replaced, whether permits were required, and inspect the major systems." };
  }
  if (numberOrNull(p.LotWidth) && numberOrNull(p.LotDepth)) {
    return { title: "Walk the lot and structure", note: "Check grading, drainage, exterior condition, parking utility and how the lot actually feels in person." };
  }
  return { title: "Condition + layout", note: "Verify room scale, natural light, noise, mechanical systems and anything photos cannot show." };
}

function buildOffMarketFocus(history) {
  const count = history?.appearanceCount || 0;
  return {
    title: count ? "Review the MLS history" : "Request the deeper property read",
    note: count ? `${count} MLS appearance${count === 1 ? "" : "s"} found in the last 10 years.` : "No active listing was found. A broader property or seller report can still be requested.",
  };
}

async function queryProperties(filters, env, top = 100, orderby = "ModificationTimestamp desc,ListingKey desc") {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  if (filters?.length) params.set("$filter", filters.join(" and "));
  params.set("$orderby", orderby);
  try {
    const response = await amplifyFetch(`${AMPRE_BASE}/Property?${params.toString()}`, env);
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}

async function handleLead(request, env) {
  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request." }, 400); }

  if (typeof payload.website === "string" && payload.website.trim()) return json({ ok: true }, 200);

  const propertyInput = clean(payload.property_input, 1000);
  const listingKey = clean(payload.listing_key, 40).toUpperCase() || null;
  const resolvedAddress = clean(payload.resolved_address, 500) || propertyInput;
  const name = clean(payload.name, 160);
  const mobile = clean(payload.mobile, 50);
  const email = clean(payload.email, 254).toLowerCase() || null;
  const leadMode = ["showing", "buyer_offmarket", "seller"].includes(payload.lead_mode) ? payload.lead_mode : "showing";
  const showingTiming = clean(payload.showing_timing, 40) || (leadMode === "showing" ? "asap" : "report");
  const propertySnapshot = sanitizeSnapshot(payload.property_snapshot);

  if (!propertyInput || !name || !mobile) return json({ ok: false, error: "Property, name and mobile are required." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Please enter a valid email." }, 400);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_lead_v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      p_property_input: propertyInput,
      p_listing_key: listingKey,
      p_resolved_address: resolvedAddress,
      p_name: name,
      p_mobile: mobile,
      p_email: email,
      p_showing_timing: showingTiming,
      p_lead_mode: leadMode,
      p_page_url: clean(payload.page_url, 1000) || null,
      p_referrer: clean(payload.referrer, 1000) || null,
      p_property_snapshot: propertySnapshot,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Lead capture failed", response.status, result);
    return json({ ok: false, error: "We could not save the request. Please try again." }, 502);
  }

  const row = Array.isArray(result) ? result[0] : result;
  return json({
    ok: true,
    lead_id: row?.lead_id || null,
    queued_after_hours: !!row?.queued_after_hours,
    response_due_at: row?.response_due_at || null,
  }, 201);
}

function sanitizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = ["listingKey", "address", "listPrice", "marketStatus", "forSale", "beds", "baths", "propertySubType", "lotWidth", "lotDepth"];
  const out = {};
  for (const key of allowed) {
    const v = value[key];
    if (typeof v === "string") out[key] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[key] = v;
  }
  return out;
}

async function amplifyFetch(endpoint, env) {
  return fetch(endpoint, {
    headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" },
  });
}

function buildAddress(p) {
  return [p.StreetNumber, p.StreetName, p.StreetSuffix, p.UnitNumber, p.City, p.StateOrProvince, p.PostalCode].filter(Boolean).join(" ");
}

function mostRecentRecord(a, b) {
  return dateMs(b?.OriginalEntryTimestamp || b?.ModificationTimestamp) - dateMs(a?.OriginalEntryTimestamp || a?.ModificationTimestamp);
}

function daysSince(value) {
  const d = validDate(value);
  return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null;
}

function recencyWeight(date) {
  if (!date) return 0.25;
  const months = Math.max(0, (Date.now() - date.getTime()) / (86400000 * 30.44));
  return Math.max(0.12, Math.exp(-months / 30));
}

function dateMs(value) { const d = validDate(value); return d ? d.getTime() : 0; }
function validDate(value) { if (!value) return null; const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function dateOnly(value) { const d = validDate(value); return d ? d.toISOString().slice(0, 10) : null; }
function diffScore(a, b, maxDiff) { return Math.max(0, 1 - Math.abs(a - b) / maxDiff); }
function ratioCloseness(a, b, tolerance) { return Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b) / tolerance); }
function sameText(a, b) { return normalizeText(a) === normalizeText(b); }
function normalizeText(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function arrayText(value) { return Array.isArray(value) ? value.join(" ") : String(value || ""); }
function cleanText(value) { return typeof value === "string" ? value.trim() || null : value ?? null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function odataString(value) { return String(value || "").replace(/'/g, "''"); }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function arrayOrValue(value) { if (Array.isArray(value)) return value.filter(Boolean); return value == null || value === "" ? null : value; }
function clean(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

function tokenOverlap(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const token of A) if (B.has(token)) hit++;
  return hit / Math.max(A.size, B.size);
}

function rangeMid(value) {
  const nums = String(value || "").match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
}

function firstFiniteNumber(record, keys) {
  for (const key of keys) {
    const n = Number(record?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function firstValue(record, keys) {
  for (const key of keys) if (record?.[key] != null && record[key] !== "") return record[key];
  return null;
}

function roundMarket(value) {
  if (!Number.isFinite(value)) return null;
  const step = value >= 1000000 ? 10000 : 5000;
  return Math.round(value / step) * step;
}

function dedupe(records) {
  const seen = new Set();
  const out = [];
  for (const r of records || []) {
    const key = r?.ListingKey || JSON.stringify([r?.UnparsedAddress, r?.OriginalEntryTimestamp, r?.ListPrice]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
