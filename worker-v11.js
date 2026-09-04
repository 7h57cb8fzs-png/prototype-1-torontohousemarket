var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/property" && request.method === "GET") {
      return handleProperty(request, env);
    }
    if (url.pathname === "/api/featured-listings" && request.method === "GET") {
      return handleFeaturedListings(env);
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
  }
};
var AMPRE_BASE = "https://query.ampre.ca/odata";
var SUPABASE_URL = "https://pwbtxyavjjotxtvegrqe.supabase.co";
var TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1e3;
function diagnosticLog(level, event, payload = {}) {
  const entry = { event, ...payload };
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer(JSON.stringify(entry));
}
__name(diagnosticLog, "diagnosticLog");
async function handleFeaturedListings(env) {
  if (!env.AMPRE_TOKEN) return json({ ok: false, error: "IDX connection is not configured." }, 503);
  let records = await queryProperties(["contains(ListOfficeName,'Leading Edge')"], env, 100, "OriginalEntryTimestamp desc,ListingKey desc");
  if (!records.length) {
    const recent = await queryProperties([], env, 500, "OriginalEntryTimestamp desc,ListingKey desc");
    records = recent.filter(isLeadingEdgeListing);
  }
  const eligible = records.filter(isLeadingEdgeListing).filter(isActiveForSale).filter((p) => p.InternetEntireListingDisplayYN !== false && p.InternetAddressDisplayYN !== false).slice(0, 6);
  const listings = await Promise.all(eligible.map(async (p) => {
    const media = normalizeMedia(await fetchPropertyMedia(p.ListingKey, env));
    return {
      listingKey: p.ListingKey || null,
      address: p.UnparsedAddress || buildAddress(p),
      city: p.City || null,
      listPrice: numberOrNull(p.ListPrice),
      beds: numberOrNull(p.BedroomsTotal),
      baths: numberOrNull(p.BathroomsTotalInteger),
      propertySubType: cleanText(p.PropertySubType || p.PropertyType),
      listingOffice: cleanText(p.ListOfficeName),
      photo: media[0] || null
    };
  }));
  return json({ ok: true, listings }, 200, { "Cache-Control": "public, max-age=300, s-maxage=900" });
}
__name(handleFeaturedListings, "handleFeaturedListings");
function isLeadingEdgeListing(p) {
  return /century\s*21.*leading\s*edge|leading\s*edge.*century\s*21/i.test(String(p?.ListOfficeName || ""));
}
__name(isLeadingEdgeListing, "isLeadingEdgeListing");
async function handleProperty(request, env) {
  if (!env.AMPRE_TOKEN) return json({ ok: false, error: "IDX connection is not configured." }, 503);
  const url = new URL(request.url);
  const publicSnapshot = url.searchParams.get("mode") === "public_snapshot";
  const reportEvidence = url.searchParams.get("mode") === "report_evidence";
  const requestId = clean(request.headers.get("X-THM-Request-Id"), 100) || crypto.randomUUID();
  const listingKeyParam = clean(url.searchParams.get("listingKey"), 40).toUpperCase();
  const rawQuery = clean(url.searchParams.get("q"), 1e3);
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
    history = publicSnapshot ? [subject] : await findSameAddressHistory(subject, env);
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
    subject = found.subject.ListingKey ? await fetchPropertyByKey(found.subject.ListingKey, env) || found.subject : found.subject;
    history = found.history;
    resolution = found.resolution;
    validationLabel = input.type === "link" ? `Listing URL matched to ${subject.ListingKey ? `MLS ${subject.ListingKey}` : "MLS history"}` : found.resolution === "address_live" ? `Address matched to active MLS ${subject.ListingKey}` : "Address matched to MLS history";
  }
  const activeForSale = isActiveForSale(subject);
  const addressDisplayAllowed = subject.InternetAddressDisplayYN !== false;
  const fullDisplayAllowed = subject.InternetEntireListingDisplayYN !== false;
  const displayRestricted = activeForSale && !fullDisplayAllowed;
  const embeddedMedia = Array.isArray(subject.Media) ? subject.Media : [];
  const [comparableContext, mediaRecords] = await Promise.all([
    publicSnapshot ? Promise.resolve({ available: false, matchCount: 0, confidence: "Available after request", basis: "Protected analysis is prepared after registration." }) : buildComparableContext(subject, env, activeForSale, requestId),
    activeForSale && fullDisplayAllowed && !reportEvidence ? embeddedMedia.length ? Promise.resolve(embeddedMedia) : fetchPropertyMedia(subject.ListingKey, env) : Promise.resolve([])
  ]);
  const historySummary = summarizeHistory(history, subject);
  const priceOpinion = buildPriceOpinion(comparableContext, activeForSale);
  const property2 = normalizeSubject(subject, {
    activeForSale,
    addressDisplayAllowed,
    fullDisplayAllowed,
    displayRestricted,
    resolution,
    validationLabel,
    comparableContext,
    historySummary,
    priceOpinion,
    photos: normalizeMedia(mediaRecords)
  });
  return json({ ok: true, property: property2 });
}
__name(handleProperty, "handleProperty");
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
    resolution: "no_mls_match"
  };
}
__name(buildNoMlsProperty, "buildNoMlsProperty");
async function fetchPropertyByKey(listingKey, env) {
  if (!listingKey) return null;
  const params = new URLSearchParams();
  params.set("$expand", "Media($select=MediaKey,MediaModificationTimestamp,MediaURL,MediaType;$filter=MediaType eq 'image/jpeg')");
  let response = await amplifyFetch(`${AMPRE_BASE}/Property('${encodeURIComponent(listingKey)}')?${params.toString()}`, env);
  if (!response.ok) response = await amplifyFetch(`${AMPRE_BASE}/Property('${encodeURIComponent(listingKey)}')`, env);
  if (!response.ok) return null;
  return response.json();
}
__name(fetchPropertyByKey, "fetchPropertyByKey");
function classifyInput(value) {
  const raw = String(value || "").trim();
  const direct = detectMlsKey(raw);
  if (!/^https?:\/\//i.test(raw)) {
    return { type: direct ? "mls" : "address", listingKey: direct, queryText: raw };
  }
  try {
    const u = new URL(raw);
    let decoded = decodeURIComponent(`${u.pathname} ${u.search}`).replace(/[/+_|-]+/g, " ").replace(/\s+/g, " ").trim();
    if (/(^|\.)realtor\.ca$/i.test(u.hostname)) {
      decoded = decoded.replace(/^\s*(?:real estate|immobilier)\s+\d{6,12}\s+/i, "");
    }
    return {
      type: "link",
      listingKey: detectMlsKey(decoded) || direct,
      queryText: extractAddressLikeText(decoded)
    };
  } catch {
    return { type: "address", listingKey: direct, queryText: raw };
  }
}
__name(classifyInput, "classifyInput");
function extractAddressLikeText(text) {
  const decoded = String(text || "").replace(/[%/]/g, " ").replace(/\s+/g, " ").trim();
  const unitFirst = decoded.match(/\b(\d+[A-Za-z]?)\s*(?:[-–—]\s*|\s+)(\d+[A-Za-z]?)\s+([A-Za-z0-9.' -]{2,60}?)(?:\s+)(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl)\b/i);
  if (unitFirst) {
    return `${unitFirst[2]} ${unitFirst[3]} ${unitFirst[4]} Unit ${unitFirst[1]}`.replace(/\s+/g, " ").trim();
  }
  const match = decoded.match(/\b(\d+[A-Za-z]?)\s+([A-Za-z0-9.' -]{2,60}?)(?:\s+)(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl)\b/i);
  return match ? `${match[1]} ${match[2]} ${match[3]}`.replace(/\s+/g, " ").trim() : decoded;
}
__name(extractAddressLikeText, "extractAddressLikeText");
function looksLikeAddress(value) {
  return /^\s*\d+[A-Za-z]?\s+[A-Za-z0-9.' -]{2,}/.test(String(value || ""));
}
__name(looksLikeAddress, "looksLikeAddress");
function detectMlsKey(value) {
  const match = String(value || "").toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}
__name(detectMlsKey, "detectMlsKey");
async function resolveAddress(input, env) {
  const parsed = parseAddress(input);
  if (!parsed.streetNumber || !parsed.streetName) return { subject: null, history: [], resolution: null };
  const firstStreetToken = odataString(titleCase(parsed.streetName).split(/\s+/)[0]);
  const records = await queryProperties([`contains(UnparsedAddress,'${firstStreetToken}')`], env, 200, "ModificationTimestamp desc,ListingKey desc");
  const scored = records.map((r) => ({ r, score: addressMatchScore(parsed, r) })).filter((x) => x.score >= 55).sort((a, b) => b.score - a.score || dateMs(b.r.ModificationTimestamp) - dateMs(a.r.ModificationTimestamp));
  if (!scored.length) return { subject: null, history: [], resolution: null };
  const exact = scored.filter((x) => sameAddressAs(parsed, x.r)).map((x) => x.r);
  const candidates = exact.length ? exact : scored.map((x) => x.r);
  const active2 = candidates.find(isActiveForSale);
  const subject = active2 || candidates.slice().sort(mostRecentRecord)[0] || null;
  const history = candidates.filter(withinTenYears);
  return {
    subject,
    history: history.length ? history : [subject].filter(Boolean),
    resolution: active2 ? "address_live" : "address_history"
  };
}
__name(resolveAddress, "resolveAddress");
function parseAddress(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  let firstPart = text.split(",")[0].trim();
  const unitFirst = firstPart.match(/^\s*(?:unit|suite|apt|apartment|#)?\s*(\d+[A-Za-z]?)\s*(?:[-–—]\s*|\s+)(\d+[A-Za-z]?)\s+(.+)$/i);
  if (unitFirst) firstPart = `${unitFirst[2]} ${unitFirst[3]} Unit ${unitFirst[1]}`;
  const m = firstPart.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return { streetNumber: null, streetName: null, streetSuffix: null };
  const streetNumber = m[1];
  const tokens = m[2].trim().split(/\s+/);
  const suffixes = /* @__PURE__ */ new Map([
    ["street", "Street"],
    ["st", "Street"],
    ["road", "Road"],
    ["rd", "Road"],
    ["avenue", "Avenue"],
    ["ave", "Avenue"],
    ["drive", "Drive"],
    ["dr", "Drive"],
    ["crescent", "Crescent"],
    ["cres", "Crescent"],
    ["court", "Court"],
    ["ct", "Court"],
    ["boulevard", "Boulevard"],
    ["blvd", "Boulevard"],
    ["lane", "Lane"],
    ["ln", "Lane"],
    ["way", "Way"],
    ["trail", "Trail"],
    ["tr", "Trail"],
    ["place", "Place"],
    ["pl", "Place"]
  ]);
  const suffixIndex = tokens.findIndex((token) => suffixes.has(token.replace(/\./g, "").toLowerCase()));
  const streetSuffix = suffixIndex >= 0 ? suffixes.get(tokens[suffixIndex].replace(/\./g, "").toLowerCase()) : null;
  const streetTokens = suffixIndex >= 0 ? tokens.slice(0, suffixIndex) : tokens;
  const trailing = suffixIndex >= 0 ? tokens.slice(suffixIndex + 1) : [];
  const unitNumber = trailing.join(" ").replace(/^(?:unit|suite|apt|apartment|#)\s*/i, "").trim() || null;
  return { streetNumber, streetName: streetTokens.join(" "), streetSuffix, unitNumber };
}
__name(parseAddress, "parseAddress");
function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}
__name(titleCase, "titleCase");
function addressMatchScore(parsed, r) {
  let score = 0;
  const num2 = String(r.StreetNumber || "").trim();
  const name = normalizeText(r.StreetName);
  const suffix = normalizeText(r.StreetSuffix);
  if (num2 !== String(parsed.streetNumber || "").trim()) return -100;
  score += 40;
  if (parsed.streetName && name === normalizeText(parsed.streetName)) score += 40;
  else if (parsed.streetName && name.includes(normalizeText(parsed.streetName))) score += 30;
  if (parsed.streetSuffix && suffix === normalizeText(parsed.streetSuffix)) score += 10;
  if (parsed.unitNumber) {
    const requestedUnit = normalizeText(parsed.unitNumber);
    const rowUnit = normalizeText(r.UnitNumber || r.ApartmentNumber || "");
    if (rowUnit === requestedUnit) score += 20;
    else score -= 35;
  }
  if (isActiveForSale(r)) score += 10;
  return Math.min(100, score);
}
__name(addressMatchScore, "addressMatchScore");
function sameAddressAs(parsed, r) {
  const numberMatch = String(r.StreetNumber || "").trim().toLowerCase() === String(parsed.streetNumber || "").trim().toLowerCase();
  const streetMatch = normalizeText(r.StreetName) === normalizeText(parsed.streetName);
  const unitMatch = !parsed.unitNumber || normalizeText(r.UnitNumber || r.ApartmentNumber || "") === normalizeText(parsed.unitNumber);
  return numberMatch && streetMatch && unitMatch;
}
__name(sameAddressAs, "sameAddressAs");
async function findSameAddressHistory(subject, env) {
  if (!subject?.StreetNumber || !subject?.StreetName) return [subject].filter(Boolean);
  const street = odataString(titleCase(subject.StreetName));
  const addressFragment = odataString(`${subject.StreetNumber} ${titleCase(subject.StreetName)}`);
  const batches = await Promise.all([
    queryProperties([`contains(UnparsedAddress,'${addressFragment}')`], env, 300, "ModificationTimestamp desc,ListingKey desc"),
    queryProperties([`contains(StreetName,'${street}')`], env, 300, "ModificationTimestamp desc,ListingKey desc")
  ]);
  const records = dedupe(batches.flat());
  const exact = records.filter((r) => samePhysicalAddress(subject, r)).filter(withinTenYears);
  return exact.length ? exact : [subject];
}
__name(findSameAddressHistory, "findSameAddressHistory");
function samePhysicalAddress(a, b) {
  const parsedA = parseAddress(a.UnparsedAddress || "");
  const parsedB = parseAddress(b.UnparsedAddress || "");
  const numberA = String(a.StreetNumber || parsedA.streetNumber || "").trim().toLowerCase();
  const numberB = String(b.StreetNumber || parsedB.streetNumber || "").trim().toLowerCase();
  const streetA = normalizeText(a.StreetName || parsedA.streetName);
  const streetB = normalizeText(b.StreetName || parsedB.streetName);
  const num2 = numberA === numberB;
  const street = streetA === streetB;
  const unitA = normalizeText(a.UnitNumber || a.ApartmentNumber || parsedA.unitNumber || "");
  const unitB = normalizeText(b.UnitNumber || b.ApartmentNumber || parsedB.unitNumber || "");
  return num2 && street && (!unitA || !unitB || unitA === unitB);
}
__name(samePhysicalAddress, "samePhysicalAddress");
async function fetchPropertyMedia(listingKey, env) {
  if (!listingKey) return [];
  const params = new URLSearchParams();
  params.set("$top", "200");
  params.set("$filter", `contains(ResourceRecordKey,'${odataString(listingKey)}')`);
  const response = await amplifyFetch(`${AMPRE_BASE}/Media?${params.toString()}`, env);
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({}));
  return Array.isArray(body.value) ? body.value.filter((row) => String(row?.ResourceRecordKey || "").toUpperCase() === String(listingKey).toUpperCase()) : [];
}
__name(fetchPropertyMedia, "fetchPropertyMedia");
function normalizeMedia(records) {
  const bestByPhoto = /* @__PURE__ */ new Map();
  for (const m of records || []) {
    const mediaKey = m?.MediaKey;
    const mediaUrl = String(m?.MediaURL || "");
    const type = String(m?.MediaType || "").toLowerCase();
    if (!mediaKey || !mediaUrl) continue;
    if (!(type.startsWith("image/") || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(mediaUrl))) continue;
    const sequence = mediaSequence(m);
    const baseKey = String(mediaKey).replace(/-(?:l|m|nw|t)$/i, "");
    const identity = Number.isFinite(sequence) && sequence !== Number.MAX_SAFE_INTEGER ? `order:${sequence}` : `key:${baseKey}`;
    const current = bestByPhoto.get(identity);
    if (!current || mediaVariantRank(m) < mediaVariantRank(current)) bestByPhoto.set(identity, m);
  }
  const output = [];
  for (const m of [...bestByPhoto.values()].sort(compareMediaSequence)) {
    const mediaKey = m.MediaKey;
    const mediaUrl = String(m.MediaURL || "");
    output.push({
      key: mediaKey,
      url: mediaUrl,
      directUrl: mediaUrl,
      fallbackUrl: `/api/media?key=${encodeURIComponent(mediaKey)}`,
      description: cleanText(m.ShortDescription || m.LongDescription),
      sequence: mediaSequence(m)
    });
  }
  return output.slice(0, 60);
}
__name(normalizeMedia, "normalizeMedia");
function mediaVariantRank(record) {
  const size = String(record?.ImageSizeDescription || "").toLowerCase();
  if (size === "largest") return 0;
  if (size === "large") return 1;
  if (size === "medium") return 2;
  if (size === "thumbnail") return 3;
  if (size.includes("nowatermark")) return 20;
  return 10;
}
__name(mediaVariantRank, "mediaVariantRank");
function compareMediaSequence(a, b) {
  const preferredA = mediaPreferred(a) ? 0 : 1;
  const preferredB = mediaPreferred(b) ? 0 : 1;
  return preferredA - preferredB || mediaSequence(a) - mediaSequence(b) || dateMs(a?.MediaModificationTimestamp) - dateMs(b?.MediaModificationTimestamp) || String(a?.MediaKey || "").localeCompare(String(b?.MediaKey || ""));
}
__name(compareMediaSequence, "compareMediaSequence");
function mediaPreferred(record) {
  return ["PreferredPhotoYN", "PrimaryPhotoYN", "IsPrimary", "MainPhotoYN"].some((key) => /^(?:true|yes|y|1)$/i.test(String(record?.[key] ?? "")));
}
__name(mediaPreferred, "mediaPreferred");
function mediaSequence(record) {
  for (const key of ["Order", "MediaOrder", "ImageOf", "MediaSequence", "SequenceNumber", "PhotoNumber", "MediaIndex", "SortOrder"]) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const description = String(record?.ShortDescription || record?.LongDescription || "");
  const described = Number(description.match(/(?:photo|image)\s*#?\s*(\d+)/i)?.[1]);
  return Number.isFinite(described) ? described : Number.MAX_SAFE_INTEGER;
}
__name(mediaSequence, "mediaSequence");
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
      headers: { Accept: "image/*", Authorization: `Bearer ${env.AMPRE_TOKEN}` }
    });
  }
  if (!imageResponse.ok || !imageResponse.body) return new Response("", { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", imageResponse.headers.get("Content-Type") || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(imageResponse.body, { status: 200, headers });
}
__name(handleMedia, "handleMedia");
function normalizeSubject(p, extras) {
  const active2 = extras.activeForSale;
  const canShowFull = !extras.displayRestricted;
  const address = extras.addressDisplayAllowed ? p.UnparsedAddress || buildAddress(p) : "Address display restricted";
  const coordinates = propertyCoordinates(p);
  const condominium = isCondominiumProperty(p);
  return {
    listingKey: p.ListingKey || null,
    address,
    city: p.City || null,
    cityRegion: p.CityRegion || null,
    postalCode: p.PostalCode || null,
    latitude: canShowFull ? coordinates.latitude : null,
    longitude: canShowFull ? coordinates.longitude : null,
    forSale: active2,
    foundInMls: true,
    marketStatus: active2 ? "For sale" : "Not currently listed",
    status: p.StandardStatus || p.MlsStatus || p.ContractStatus || null,
    transactionType: p.TransactionType || null,
    propertyType: canShowFull ? p.PropertyType || null : null,
    propertySubType: canShowFull ? cleanText(p.PropertySubType) : null,
    beds: canShowFull ? numberOrNull(p.BedroomsTotal) : null,
    baths: canShowFull ? numberOrNull(p.BathroomsTotalInteger) : null,
    livingAreaRange: canShowFull ? p.LivingAreaRange || null : null,
    buildingAreaTotal: canShowFull ? numberOrNull(p.BuildingAreaTotal) : null,
    lotWidth: canShowFull ? numberOrNull(p.LotWidth) : null,
    lotDepth: canShowFull ? numberOrNull(p.LotDepth) : null,
    parkingTotal: canShowFull ? numberOrNull(p.ParkingTotal) : null,
    garageType: canShowFull ? cleanText(Array.isArray(p.GarageType) ? p.GarageType.join(" \xB7 ") : p.GarageType) : null,
    garageParkingSpaces: canShowFull ? firstFiniteNumber(p, ["GarageParkingSpaces", "GarageSpaces", "CoveredSpaces", "ParkingGarage"]) : null,
    basement: canShowFull ? Array.isArray(p.Basement) ? p.Basement : cleanText(p.Basement) ? [cleanText(p.Basement)] : [] : [],
    kitchensTotal: canShowFull ? numberOrNull(p.KitchensTotal) : null,
    isCondominium: canShowFull ? condominium : false,
    maintenanceFee: canShowFull && condominium ? buildMaintenanceFee(p) : null,
    remarks: active2 && canShowFull ? cleanText(p.PublicRemarks) : null,
    listPrice: active2 && canShowFull ? numberOrNull(p.ListPrice) : null,
    lastKnownListPrice: !active2 ? numberOrNull(p.ListPrice) : null,
    daysLive: active2 ? daysSince(p.OriginalEntryTimestamp) : null,
    photos: active2 && canShowFull ? extras.photos : [],
    inputValidation: { type: extras.resolution, label: extras.validationLabel || "Property checked" },
    historySummary: extras.historySummary,
    comparableContext: extras.comparableContext,
    priceOpinion: extras.priceOpinion,
    offerTiming: active2 ? detectOfferTiming(p) : { type: "not_for_sale", label: "Not for sale", note: "No active for-sale listing was found." },
    schoolSummary: canShowFull ? buildSchoolSummary(p) : null,
    showingFocus: active2 ? buildShowingFocus(p) : buildOffMarketFocus(extras.historySummary),
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
      listingOffice: active2 ? cleanText(p.ListOfficeName) : null,
      listedAt: p.OriginalEntryTimestamp || null
    } : {}
  };
}
__name(normalizeSubject, "normalizeSubject");
function isCondominiumProperty(p) {
  const description = [p.PropertyType, p.PropertySubType, p.OwnershipType, p.CommonInterest].filter(Boolean).join(" ").toLowerCase();
  return /condo|condominium|common element/.test(description) && !/freehold/.test(description);
}
__name(isCondominiumProperty, "isCondominiumProperty");
function buildMaintenanceFee(p) {
  const rawAmount = firstValue(p, ["AssociationFee", "MaintenanceExpense", "MaintenanceFee", "MaintenanceFees", "CondoFee", "CondoFees"]);
  const amount = rawAmount == null || rawAmount === "" ? null : numberOrNull(rawAmount);
  const frequency = cleanText(firstValue(p, ["AssociationFeeFrequency", "MaintenanceFeeFrequency", "CondoFeeFrequency"])) || "month";
  const included = normalizeFeeItems(firstValue(p, ["AssociationFeeIncludes", "MaintenanceFeeIncludes", "MaintenanceFeesInclude", "FeeIncludes"]));
  const notIncluded = normalizeFeeItems(firstValue(p, ["AssociationFeeExcludes", "MaintenanceFeeExcludes", "MaintenanceFeesExclude", "FeeExcludes"]));
  const flags = [
    ["Water", ["WaterIncluded"]],
    ["Heat", ["HeatIncluded"]],
    ["Hydro", ["HydroIncluded", "ElectricityIncluded"]],
    ["Central air", ["CACIncluded", "AirConditioningIncluded"]],
    ["Cable TV", ["CableTvIncluded", "CableTVIncluded"]],
    ["Internet", ["InternetIncluded"]],
    ["Common elements", ["CommonElementsIncluded"]],
    ["Building insurance", ["BuildingInsuranceIncluded"]],
    ["Parking", ["ParkingIncluded"]],
    ["Locker", ["LockerIncluded"]]
  ];
  for (const [label, keys] of flags) {
    const value = firstDefinedBoolean(p, keys);
    if (value === true && !included.includes(label)) included.push(label);
    if (value === false && !notIncluded.includes(label)) notIncluded.push(label);
  }
  const remarks = String(p.PublicRemarks || "");
  const exclusion = remarks.match(/(?:maintenance|common area maintenance|condo fee)[^.]{0,80}(?:exclude|excluding|does not include)[sd]?\s+([^.*;]+)/i)?.[1];
  if (exclusion) {
    for (const item of normalizeFeeItems(exclusion)) if (!notIncluded.includes(item)) notIncluded.push(item);
  }
  return { amount, frequency, included, notIncluded };
}
__name(buildMaintenanceFee, "buildMaintenanceFee");
function normalizeFeeItems(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : String(value).split(/[,;|]/);
  return [...new Set(values.map((item) => cleanText(item)).filter(Boolean))];
}
__name(normalizeFeeItems, "normalizeFeeItems");
function firstDefinedBoolean(record, keys) {
  for (const key of keys) {
    if (record?.[key] === true || /^(?:true|yes|y|1)$/i.test(String(record?.[key] ?? ""))) return true;
    if (record?.[key] === false || /^(?:false|no|n|0)$/i.test(String(record?.[key] ?? ""))) return false;
  }
  return null;
}
__name(firstDefinedBoolean, "firstDefinedBoolean");
function isActiveForSale(p) {
  const status = `${p?.StandardStatus || ""} ${p?.MlsStatus || ""} ${p?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(p?.TransactionType || "").toLowerCase();
  const sale = transaction.includes("for sale") || !transaction && p?.BoardPropertyType !== "Com";
  const inactive = /closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
  const active2 = /active|available|new/.test(status);
  return sale && active2 && !inactive;
}
__name(isActiveForSale, "isActiveForSale");
function withinTenYears(r) {
  const d = validDate(r?.OriginalEntryTimestamp) || validDate(r?.ModificationTimestamp) || validDate(r?.SystemModificationTimestamp);
  return !d || Date.now() - d.getTime() <= TEN_YEARS_MS;
}
__name(withinTenYears, "withinTenYears");
function summarizeHistory(history, subject) {
  const records = dedupe((history || []).filter(Boolean)).filter(withinTenYears).sort(mostRecentRecord);
  const latest = records[0] || subject;
  return {
    years: 10,
    appearanceCount: records.length,
    lastStatus: latest?.StandardStatus || latest?.MlsStatus || latest?.ContractStatus || null,
    lastListPrice: numberOrNull(latest?.ListPrice),
    lastSeenDate: dateOnly(latest?.OriginalEntryTimestamp || latest?.ModificationTimestamp),
    latestSold: records.map(historicalSoldSummary).filter(Boolean).sort((a, b) => dateMs(b.date) - dateMs(a.date))[0] || null
  };
}
__name(summarizeHistory, "summarizeHistory");
function historicalSoldSummary(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  if (!/closed|sold/i.test(status)) return null;
  const price = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const date = firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]);
  if (!price || !validDate(date)) return null;
  return { price, date: dateOnly(date) };
}
__name(historicalSoldSummary, "historicalSoldSummary");
async function buildComparableContext(subject, env, activeForSale, requestId = null) {
  if (!subject) return unavailableComp("No subject property was available.");
  const subtype = cleanText(subject.PropertySubType);
  if (!subtype) return unavailableComp("The subject property subtype is unavailable, so an exact-subtype range cannot be produced.");
  const subtypeFilter = `PropertySubType eq '${odataString(subtype)}'`;
  const postalPrefix = String(subject.PostalCode || "").replace(/\s+/g, "").slice(0, 3);
  const regionFilter = subject.CityRegion ? `CityRegion eq '${odataString(subject.CityRegion)}'` : null;
  const localSearches = [
    regionFilter ? { name: "same_community_exact_subtype", filters: [regionFilter, subtypeFilter] } : null,
    postalPrefix ? { name: "same_postal_prefix_exact_subtype", filters: [`startswith(PostalCode,'${odataString(postalPrefix)}')`, subtypeFilter] } : null
  ].filter(Boolean);
  const queryAudit = [];
  let raw = [];
  const searchResults = await Promise.all(localSearches.map(async (search) => ({ search, result: await querySoldComparableRows(search.filters, env, 1e3) })));
  for (const { search, result } of searchResults) {
    raw.push(...result.rows);
    queryAudit.push(...result.audit.map((entry) => ({ phase: "local", name: search.name, ...entry })));
  }
  const qualified = qualifiedSoldComparableRows(subject, raw, 300).filter((candidate) => comparableIsLocal(candidate));
  let windowDays = 100;
  let window = qualified.filter((candidate) => candidate.ageDays <= 100);
  if (window.length < 3) {
    windowDays = 300;
    window = qualified.filter((candidate) => candidate.ageDays <= 300);
  }
  const beforePriceCluster = window.length;
  if (!window.length) {
    logComparableDiagnostics(requestId, subject, raw, qualified, window, [], [], windowDays, 10, queryAudit, "insufficient_local_sold_evidence");
    return unavailableComp("No local exact-subtype sold comparables were found within the 300-day VOW evidence window.", 0, { ...comparableDiagnostics(raw, subject), queryAudit }, { windowDays, expandedWindow: windowDays > 100, exactSubtype: true, localOnly: true, priceTolerancePct: 10, beforePriceCluster, afterPriceCluster: 0 });
  }
  const clusterMedian = medianPrice(window.map((candidate) => candidate.price));
  const priceTolerancePct = 10;
  const candidates = filterPriceCluster(window, 0.1).matches;
  if (!candidates.length) {
    logComparableDiagnostics(requestId, subject, raw, qualified, window, candidates, [], windowDays, priceTolerancePct, queryAudit, "price_cluster_empty");
    return unavailableComp("No local exact-subtype sale remained after the required 10% median price filter.", 0, { ...comparableDiagnostics(raw, subject), queryAudit }, { windowDays, expandedWindow: windowDays > 100, exactSubtype: true, localOnly: true, priceTolerancePct, beforePriceCluster, afterPriceCluster: 0 });
  }
  const selected = candidates.sort(compareComparable).slice(0, 5);
  const valuationAvailable = selected.length >= 3;
  logComparableDiagnostics(requestId, subject, raw, qualified, window, candidates, selected, windowDays, priceTolerancePct, queryAudit, valuationAvailable ? "selected" : "insufficient_qualified_comparables");
  const policy = { windowDays, expandedWindow: windowDays > 100, exactSubtype: true, localOnly: true, radiusKm: 5, priceTolerancePct, clusterMedian, beforePriceCluster, afterPriceCluster: candidates.length };
  if (!valuationAvailable) {
    return {
      ...unavailableComp(`Only ${selected.length} local exact-subtype sold comparable${selected.length === 1 ? " was" : "s were"} available after the required 10% price screen; at least 3 are required for a price range.`, selected.length, { ...comparableDiagnostics(raw, subject), queryAudit }, policy),
      comparables: selected.map(publicComparable),
      activeForSale
    };
  }
  const band = weightedBand(selected);
  const avgScore = selected.reduce((sum, x) => sum + x.similarity, 0) / selected.length;
  const avgRecency = selected.reduce((sum, x) => sum + x.recency, 0) / selected.length;
  const numericDistances = selected.map((x) => x.distanceKm).filter(Number.isFinite);
  const allDistancesKnown = numericDistances.length === selected.length;
  const farthest = numericDistances.length ? Math.max(...numericDistances) : null;
  const confidence = allDistancesKnown && avgScore >= 78 && avgRecency >= 0.7 && selected.length >= 5 && farthest <= 2 ? "High" : allDistancesKnown && avgScore >= 64 && avgRecency >= 0.35 && farthest <= 5 ? "Medium" : "Low";
  return {
    available: true,
    matchCount: selected.length,
    confidence,
    rangeLow: band.low,
    midpoint: band.mid,
    rangeHigh: band.high,
    soldCount: selected.length,
    activeCount: 0,
    historicalCount: 0,
    sourceLabel: "recent sold MLS comparables",
    basis: buildBasisText(subject, selected),
    comparables: selected.map(publicComparable),
    policy: { ...policy, farthestKm: farthest, allDistancesKnown },
    activeForSale
  };
}
__name(buildComparableContext, "buildComparableContext");
function logComparableDiagnostics(requestId, subject, raw, qualified, window, clustered, selected, windowDays, priceTolerancePct, queryAudit, status) {
  const unique = dedupe(raw || []);
  const notSubject = unique.filter((row) => row.ListingKey !== subject?.ListingKey);
  const exactSubtype = notSubject.filter((row) => exactComparableType(subject, row));
  const soldWithin300 = exactSubtype.filter((row) => isSoldWithinDays(row, 300));
  const selectedWithDistance = (selected || []).filter((row) => Number.isFinite(row.distanceKm));
  const subjectCoordinates = propertyCoordinates(subject);
  diagnosticLog("log", "comparable_selection_diagnostic", {
    request_id: requestId,
    subject_listing_key: subject?.ListingKey || null,
    subject_property_subtype: cleanText(subject?.PropertySubType || subject?.PropertyType) || null,
    subject_community: cleanText(subject?.CityRegion) || null,
    search_window_days: windowDays,
    radius_km: null,
    candidate_counts: {
      fetched: (raw || []).length,
      unique: unique.length,
      excluding_subject: notSubject.length,
      exact_subtype: exactSubtype.length,
      sold_within_300_days: soldWithin300.length,
      similarity_qualified: (qualified || []).length,
      selected_window: (window || []).length,
      after_price_cluster: (clustered || []).length,
      selected: (selected || []).length
    },
    rejection_reason_counts: {
      duplicate: Math.max(0, (raw || []).length - unique.length),
      subject_listing: Math.max(0, unique.length - notSubject.length),
      subtype_mismatch: Math.max(0, notSubject.length - exactSubtype.length),
      not_sold_within_300_days: Math.max(0, exactSubtype.length - soldWithin300.length),
      non_local_or_similarity_below_threshold: Math.max(0, soldWithin300.length - (qualified || []).length),
      outside_selected_window: Math.max(0, (qualified || []).length - (window || []).length),
      price_cluster: Math.max(0, (window || []).length - (clustered || []).length),
      rank_cutoff: Math.max(0, (clustered || []).length - (selected || []).length)
    },
    price_tolerance_pct: priceTolerancePct,
    selected_comp_listing_keys: (selected || []).map((row) => row.record?.ListingKey).filter(Boolean),
    distance_calculation_status: {
      subject_coordinates: subjectCoordinates.latitude != null && subjectCoordinates.longitude != null,
      selected_numeric: selectedWithDistance.length,
      selected_missing: Math.max(0, (selected || []).length - selectedWithDistance.length)
    },
    provider_pages: (queryAudit || []).map((entry) => ({ status: entry.status, skip: entry.skip, returned: entry.count })),
    status
  });
}
__name(logComparableDiagnostics, "logComparableDiagnostics");
function unavailableComp(basis, matchCount = 0, diagnostics = null, policy = null) {
  return { available: false, matchCount, confidence: "Unavailable", basis, ...diagnostics ? { diagnostics } : {}, ...policy ? { policy } : {} };
}
__name(unavailableComp, "unavailableComp");
function exactComparableType(subject, record) {
  if (subject.PropertySubType) return sameText(subject.PropertySubType, record.PropertySubType);
  return subject.PropertyType ? sameText(subject.PropertyType, record.PropertyType) : false;
}
__name(exactComparableType, "exactComparableType");
function comparableIsLocal(candidate, radiusKm = 5) {
  return !!candidate && (candidate.sameRegion || candidate.samePostalPrefix || Number.isFinite(candidate.distanceKm) && candidate.distanceKm <= radiusKm);
}
__name(comparableIsLocal, "comparableIsLocal");
async function querySoldComparableRows(baseFilters, env, top) {
  // This AMPRE VOW feed returns sold fields but rejects filters on them. Page
  // through the permitted local history query so active inventory cannot fill
  // the first result window, then qualify genuine sold rows locally.
  const rows = [];
  const audit = [];
  let accepted = false;
  const pageSize = Math.min(250, top);
  let nextUrl = null;
  for (let page = 0; page < 4 && rows.length < top; page++) {
    const result = nextUrl ? await queryPropertiesPage(nextUrl, env) : await queryPropertiesDetailed(baseFilters, env, pageSize, "ModificationTimestamp desc,ListingKey desc", 0);
    audit.push({ queryScope: "local_exact_subtype_page", page, ...result.meta });
    if (result.meta.status === 200) accepted = true;
    rows.push(...result.rows);
    nextUrl = result.nextLink || null;
    if (!nextUrl || !result.rows.length) break;
  }
  if (!accepted) return { rows: [], audit };
  return { rows: dedupe(rows), audit };
}
__name(querySoldComparableRows, "querySoldComparableRows");
function qualifiedSoldComparableRows(subject, records, maxAgeDays) {
  return dedupe(records || []).filter((record) => record.ListingKey !== subject.ListingKey).filter((record) => exactComparableType(subject, record)).filter((record) => isSoldWithinDays(record, maxAgeDays)).map((record) => {
    const candidate = normalizeComparable(subject, record);
    const soldDate = soldRecordDate(record);
    return { ...candidate, ageDays: soldDate ? Math.max(0, (Date.now() - soldDate.getTime()) / 864e5) : Number.POSITIVE_INFINITY };
  }).filter((candidate) => candidate.price && candidate.closeDate && candidate.similarity >= 35).sort(compareComparable);
}
__name(qualifiedSoldComparableRows, "qualifiedSoldComparableRows");
function medianPrice(values) {
  const prices = (values || []).map(Number).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!prices.length) return null;
  const middle = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
}
__name(medianPrice, "medianPrice");
function filterPriceCluster(candidates, tolerance = 0.1) {
  const median = medianPrice((candidates || []).map((c) => c.price));
  if (!median) return { median: null, matches: [] };
  return {
    median,
    matches: (candidates || []).filter((c) => Math.abs(c.price - median) / median <= tolerance).map((c) => ({ ...c, priceDeviationPct: Math.round(Math.abs(c.price - median) / median * 1e3) / 10 }))
  };
}
__name(filterPriceCluster, "filterPriceCluster");
function comparableDiagnostics(records, subject = null) {
  const rows = dedupe(records || []);
  const priceKeys = ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"];
  const dateKeys = ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"];
  const present = /* @__PURE__ */ __name((keys) => Object.fromEntries(keys.map((key) => [key, rows.filter((r) => r?.[key] != null && r[key] !== "" && r[key] !== 0).length])), "present");
  const statuses = {};
  for (const r of rows) {
    const key = cleanText(r.StandardStatus || r.MlsStatus || r.ContractStatus || "(missing)");
    statuses[key] = (statuses[key] || 0) + 1;
  }
  const subtypes = {};
  for (const r of rows) {
    const key = cleanText(r.PropertySubType || r.PropertyType || "(missing)");
    subtypes[key] = (subtypes[key] || 0) + 1;
  }
  const exact = subject ? rows.filter((r) => exactComparableType(subject, r)) : rows;
  const exactDates = exact.map((r) => soldRecordDate(r)).filter(Boolean).sort((a, b) => a - b);
  return {
    returned: rows.length,
    exactSubtype: exact.length,
    soldWithin100: exact.filter((r) => isSoldWithinDays(r, 100)).length,
    soldWithin300: exact.filter((r) => isSoldWithinDays(r, 300)).length,
    soldWithin600: exact.filter((r) => isSoldWithinDays(r, 600)).length,
    soldDateRange: exactDates.length ? { oldest: dateOnly(exactDates[0]), newest: dateOnly(exactDates[exactDates.length - 1]), future: exactDates.filter((d) => d.getTime() > Date.now()).length } : null,
    priceFields: present(priceKeys),
    dateFields: present(dateKeys),
    statuses,
    subtypes
  };
}
__name(comparableDiagnostics, "comparableDiagnostics");
function normalizeComparable(subject, r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  const soldLike = /closed|sold/i.test(status);
  const activeLike = isActiveForSale(r);
  const soldPrice = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const listPrice = numberOrNull(r.ListPrice);
  let source = null;
  let price = null;
  if (soldLike && soldPrice) {
    source = "sold";
    price = soldPrice;
  } else if (activeLike && listPrice) {
    source = "active";
    price = listPrice;
  } else if (listPrice) {
    source = "historical";
    price = listPrice;
  }
  const recordDate = soldRecordDate(r);
  const distanceKm = distanceBetweenProperties(subject, r);
  const sameRegion = !!(subject.CityRegion && r.CityRegion && sameText(subject.CityRegion, r.CityRegion));
  const postalA = String(subject.PostalCode || "").replace(/\s+/g, "").slice(0, 3), postalB = String(r.PostalCode || "").replace(/\s+/g, "").slice(0, 3);
  return {
    record: r,
    source,
    price,
    similarity: similarityScore(subject, r),
    recency: recencyWeight(recordDate),
    reliability: source === "sold" ? 1 : source === "active" ? 0.82 : 0.58,
    closeDate: dateOnly(recordDate),
    distanceKm,
    sameRegion,
    samePostalPrefix: !!(postalA && postalB && postalA === postalB)
  };
}
__name(normalizeComparable, "normalizeComparable");
function isSoldWithinDays(r, windowDays) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  const price = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const date = soldRecordDate(r);
  const soldEvidence = /closed|sold|deal firm/i.test(status) || !!validDate(firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]));
  if (!soldEvidence || !price || !date) return false;
  const ageDays = (Date.now() - date.getTime()) / 864e5;
  return ageDays >= 0 && ageDays <= windowDays;
}
__name(isSoldWithinDays, "isSoldWithinDays");
function soldRecordDate(r) {
  const explicit = validDate(firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]));
  if (explicit) return explicit;
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`;
  const price = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  return price && /closed|sold|deal firm/i.test(status) ? validDate(r.ModificationTimestamp || r.SystemModificationTimestamp) : null;
}
__name(soldRecordDate, "soldRecordDate");
function publicComparable(c) {
  const r = c.record || {};
  return {
    listingKey: r.ListingKey || null,
    address: r.InternetAddressDisplayYN === false ? "Address display restricted" : r.UnparsedAddress || buildAddress(r),
    soldPrice: c.price,
    soldDate: c.closeDate,
    beds: numberOrNull(r.BedroomsTotal),
    baths: numberOrNull(r.BathroomsTotalInteger),
    livingAreaRange: r.LivingAreaRange || null,
    lotWidth: numberOrNull(r.LotWidth),
    lotDepth: numberOrNull(r.LotDepth),
    similarity: c.similarity,
    distanceKm: c.distanceKm,
    cityRegion: r.CityRegion || null,
    postalCode: r.PostalCode || null,
    priceDeviationPct: c.priceDeviationPct ?? null
  };
}
__name(publicComparable, "publicComparable");
function similarityScore(subject, c) {
  let earned = 0;
  let possible = 0;
  const add = /* @__PURE__ */ __name((weight, score) => {
    possible += weight;
    earned += weight * clamp(score, 0, 1);
  }, "add");
  const distanceKm = distanceBetweenProperties(subject, c);
  if (distanceKm != null) add(30, distanceKm <= 1 ? 1 : distanceKm <= 2 ? 0.85 : distanceKm <= 3 ? 0.65 : distanceKm <= 5 ? 0.35 : distanceKm <= 7 ? 0.1 : 0);
  if (subject.CityRegion && c.CityRegion) add(35, sameText(subject.CityRegion, c.CityRegion) ? 1 : 0);
  else if (subject.City && c.City) add(8, sameText(subject.City, c.City) ? 1 : 0);
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
  return possible ? Math.round(earned / possible * 100) : 0;
}
__name(similarityScore, "similarityScore");
function compareComparable(a, b) {
  if (a.distanceKm != null && b.distanceKm != null && Math.abs(a.distanceKm - b.distanceKm) >= 0.15) return a.distanceKm - b.distanceKm;
  if (a.distanceKm != null && b.distanceKm == null) return -1;
  if (a.distanceKm == null && b.distanceKm != null) return 1;
  const aw = a.similarity * 0.76 + a.recency * 16 + a.reliability * 8;
  const bw = b.similarity * 0.76 + b.recency * 16 + b.reliability * 8;
  return bw - aw;
}
__name(compareComparable, "compareComparable");
function weightedBand(matches) {
  const items = matches.map((m) => ({
    price: m.price,
    weight: Math.max(0.04, Math.pow(m.similarity / 100, 2) * (0.45 + 0.35 * m.recency + 0.2 * m.reliability))
  })).sort((a, b) => a.price - b.price);
  return {
    low: roundMarket(weightedQuantile(items, 0.2)),
    mid: roundMarket(weightedQuantile(items, 0.5)),
    high: roundMarket(weightedQuantile(items, 0.8))
  };
}
__name(weightedBand, "weightedBand");
function weightedQuantile(items, q) {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let running = 0;
  for (const item of items) {
    running += item.weight;
    if (running >= total * q) return item.price;
  }
  return items[items.length - 1]?.price || 0;
}
__name(weightedQuantile, "weightedQuantile");
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
    if (hits) parts.push(`${hits}/${matches.length} within \xB11 bedroom`);
  }
  if (subject.LivingAreaRange || subject.LotWidth) parts.push("size and lot weighted");
  const distances = matches.map((m) => m.distanceKm).filter((x) => x != null);
  if (distances.length) parts.push(`within ${Math.max(...distances).toFixed(1)} km`);
  parts.push("nearest recent sold evidence prioritized");
  return parts.join(" \xB7 ");
}
__name(buildBasisText, "buildBasisText");
function buildPriceOpinion(comp, activeForSale) {
  if (!comp?.available) return { available: false, label: activeForSale ? "Range unavailable" : "Value review available", note: comp?.basis || "Not enough reliable matches." };
  return {
    available: true,
    low: comp.rangeLow,
    midpoint: comp.midpoint,
    high: comp.rangeHigh,
    confidence: comp.confidence,
    label: activeForSale ? "THM market range" : "THM indicative value",
    note: `${comp.sourceLabel}; similarity and recency weighted.`
  };
}
__name(buildPriceOpinion, "buildPriceOpinion");
function detectOfferTiming(p) {
  const brokerageText = firstValue(p, ["BrokerageRemarks", "BrokerRemarks", "PrivateRemarks", "RemarksForBrokerages", "RemarksForBrokerage", "SyndicationRemarks"]);
  const text = [brokerageText, p.PublicRemarks, p.PublicRemarksExtras].filter((v) => typeof v === "string").join(" ");
  const offerText = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => /\boffer(?:s|ing)?\b|offer presentation|presentation of offers/i.test(s)).join(" ");
  if (/offers?\s+anytime|any\s*time/i.test(offerText)) return { type: "anytime", label: "There is no offer date", note: "Brokerage remarks indicate offers are accepted anytime. Realtor verification required." };
  const date = offerText.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i)?.[0] || offerText.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/)?.[0] || offerText.match(/\b\d{1,2}[-/]\d{1,2}[-/]20\d{2}\b/)?.[0] || null;
  const time = offerText.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i)?.[0] || null;
  if (offerText && date) return { type: "scheduled", label: [date, time].filter(Boolean).join(" \xB7 "), note: "Offer date was detected in brokerage/listing remarks. Realtor verification required." };
  return { type: "none", label: "There is no offer date", note: "No offer date was found in the available brokerage/listing remarks." };
}
__name(detectOfferTiming, "detectOfferTiming");
function buildSchoolSummary(p) {
  const choices = [
    { name: firstValue(p, ["ClosestSchool", "NearestSchool", "ElementarySchool", "ElementarySchoolName"]), rating: firstFiniteNumber(p, ["ClosestSchoolRating", "NearestSchoolRating", "ElementarySchoolRating"]) },
    { name: firstValue(p, ["MiddleOrJuniorSchool", "MiddleSchool", "MiddleSchoolName"]), rating: firstFiniteNumber(p, ["MiddleOrJuniorSchoolRating", "MiddleSchoolRating"]) },
    { name: firstValue(p, ["HighSchool", "HighSchoolName", "SecondarySchool"]), rating: firstFiniteNumber(p, ["HighSchoolRating", "SecondarySchoolRating"]) },
    { name: firstValue(p, ["SchoolName", "NearbySchool"]), rating: firstFiniteNumber(p, ["SchoolRating", "NearbySchoolRating"]) }
  ];
  const selected = choices.find((school) => cleanText(school.name));
  if (!selected) return { name: null, rating: null, source: "AMPRE MLS", note: "School data unavailable \xB7 confirm attendance boundary and rating with the school board." };
  return {
    name: cleanText(selected.name),
    rating: selected.rating,
    ratingScale: selected.rating != null ? 10 : null,
    source: "AMPRE MLS",
    note: selected.rating == null ? "Rating unavailable \xB7 confirm attendance boundary with the school board." : null
  };
}
__name(buildSchoolSummary, "buildSchoolSummary");
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
__name(buildShowingFocus, "buildShowingFocus");
function buildOffMarketFocus(history) {
  const count = history?.appearanceCount || 0;
  return {
    title: count ? "Review the MLS history" : "Request the deeper property read",
    note: count ? `${count} MLS appearance${count === 1 ? "" : "s"} found in the last 10 years.` : "No active listing was found. A broader property or seller report can still be requested."
  };
}
__name(buildOffMarketFocus, "buildOffMarketFocus");
async function queryProperties(filters, env, top = 100, orderby = "ModificationTimestamp desc,ListingKey desc") {
  return (await queryPropertiesDetailed(filters, env, top, orderby)).rows;
}
__name(queryProperties, "queryProperties");
async function queryPropertiesDetailed(filters, env, top = 100, orderby = "ModificationTimestamp desc,ListingKey desc", skip = 0) {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  if (skip > 0) params.set("$skip", String(skip));
  if (filters?.length) params.set("$filter", filters.join(" and "));
  if (orderby) params.set("$orderby", orderby);
  try {
    let response = await amplifyFetch(`${AMPRE_BASE}/Property?${params.toString()}`, env);
    const firstStatus = response.status;
    let retried = false;
    if (!response.ok && orderby) {
      retried = true;
      params.set("$top", String(top));
      params.delete("$orderby");
      response = await amplifyFetch(`${AMPRE_BASE}/Property?${params.toString()}`, env);
    }
    if (!response.ok) return { rows: [], nextLink: null, meta: { firstStatus, status: response.status, retried, count: 0 } };
    const body = await response.json();
    const rows = Array.isArray(body.value) ? body.value : [];
    return { rows, nextLink: safeAmpreNextLink(body["@odata.nextLink"]), meta: { firstStatus, status: response.status, retried, count: rows.length } };
  } catch (error) {
    return { rows: [], nextLink: null, meta: { firstStatus: 0, status: 0, retried: false, count: 0, error: String(error?.name || "fetch_error").slice(0, 80) } };
  }
}
__name(queryPropertiesDetailed, "queryPropertiesDetailed");
async function queryPropertiesPage(nextLink, env) {
  const safe = safeAmpreNextLink(nextLink);
  if (!safe) return { rows: [], nextLink: null, meta: { firstStatus: 0, status: 0, retried: false, count: 0, error: "invalid_next_link" } };
  try {
    const response = await amplifyFetch(safe, env);
    if (!response.ok) return { rows: [], nextLink: null, meta: { firstStatus: response.status, status: response.status, retried: false, count: 0 } };
    const body = await response.json();
    const rows = Array.isArray(body.value) ? body.value : [];
    return { rows, nextLink: safeAmpreNextLink(body["@odata.nextLink"]), meta: { firstStatus: response.status, status: response.status, retried: false, count: rows.length } };
  } catch (error) {
    return { rows: [], nextLink: null, meta: { firstStatus: 0, status: 0, retried: false, count: 0, error: String(error?.name || "fetch_error").slice(0, 80) } };
  }
}
__name(queryPropertiesPage, "queryPropertiesPage");
function safeAmpreNextLink(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, AMPRE_BASE);
    const base = new URL(AMPRE_BASE);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}
__name(safeAmpreNextLink, "safeAmpreNextLink");
async function handleLead(request, env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: "Lead system is not configured." }, 503);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }
  if (typeof payload.website === "string" && payload.website.trim()) return json({ ok: true }, 200);
  const propertyInput = clean(payload.property_input, 1e3);
  const listingKey = clean(payload.listing_key, 40).toUpperCase() || null;
  const resolvedAddress = clean(payload.resolved_address, 500) || propertyInput;
  const name = clean(payload.name, 160);
  const mobile = clean(payload.mobile, 50);
  const email = clean(payload.email, 254).toLowerCase();
  const leadMode = ["showing", "buyer_offmarket", "seller"].includes(payload.lead_mode) ? payload.lead_mode : "showing";
  const showingTiming = clean(payload.showing_timing, 40) || (leadMode === "showing" ? "asap" : "report");
  const propertySnapshot = sanitizeSnapshot(payload.property_snapshot);
  if (!propertyInput || !name || !mobile || !email) return json({ ok: false, error: "Property, name, mobile and email are required." }, 400);
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_lead_manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
      p_page_url: clean(payload.page_url, 1e3) || null,
      p_referrer: clean(payload.referrer, 1e3) || null,
      p_property_snapshot: propertySnapshot
    })
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
    response_due_at: row?.response_due_at || null
  }, 201);
}
__name(handleLead, "handleLead");
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
__name(sanitizeSnapshot, "sanitizeSnapshot");
async function amplifyFetch(endpoint, env) {
  return fetch(endpoint, {
    headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5e3)
  });
}
__name(amplifyFetch, "amplifyFetch");
function buildAddress(p) {
  return [p.StreetNumber, p.StreetName, p.StreetSuffix, p.UnitNumber, p.City, p.StateOrProvince, p.PostalCode].filter(Boolean).join(" ");
}
__name(buildAddress, "buildAddress");
function mostRecentRecord(a, b) {
  return dateMs(b?.OriginalEntryTimestamp || b?.ModificationTimestamp) - dateMs(a?.OriginalEntryTimestamp || a?.ModificationTimestamp);
}
__name(mostRecentRecord, "mostRecentRecord");
function daysSince(value) {
  const d = validDate(value);
  return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5)) : null;
}
__name(daysSince, "daysSince");
function recencyWeight(date) {
  if (!date) return 0.25;
  const months = Math.max(0, (Date.now() - date.getTime()) / (864e5 * 30.44));
  return Math.max(0.12, Math.exp(-months / 30));
}
__name(recencyWeight, "recencyWeight");
function dateMs(value) {
  const d = validDate(value);
  return d ? d.getTime() : 0;
}
__name(dateMs, "dateMs");
function validDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
__name(validDate, "validDate");
function dateOnly(value) {
  const d = validDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}
__name(dateOnly, "dateOnly");
function diffScore(a, b, maxDiff) {
  return Math.max(0, 1 - Math.abs(a - b) / maxDiff);
}
__name(diffScore, "diffScore");
function ratioCloseness(a, b, tolerance) {
  return Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b) / tolerance);
}
__name(ratioCloseness, "ratioCloseness");
function sameText(a, b) {
  return normalizeText(a) === normalizeText(b);
}
__name(sameText, "sameText");
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
__name(normalizeText, "normalizeText");
function arrayText(value) {
  return Array.isArray(value) ? value.join(" ") : String(value || "");
}
__name(arrayText, "arrayText");
function cleanText(value) {
  return typeof value === "string" ? value.trim() || null : value ?? null;
}
__name(cleanText, "cleanText");
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
__name(clamp, "clamp");
function odataString(value) {
  return String(value || "").replace(/'/g, "''");
}
__name(odataString, "odataString");
function numberOrNull(value) {
  if (value == null || value === "" || typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
__name(numberOrNull, "numberOrNull");
function arrayOrValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value == null || value === "" ? null : value;
}
__name(arrayOrValue, "arrayOrValue");
function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
__name(clean, "clean");
function propertyCoordinates(record) {
  let latitude = numberOrNull(record?.Latitude);
  let longitude = numberOrNull(record?.Longitude);
  const geo = record?.GeoLocation;
  if ((latitude == null || longitude == null) && Array.isArray(geo?.coordinates) && geo.coordinates.length >= 2) {
    longitude = numberOrNull(geo.coordinates[0]);
    latitude = numberOrNull(geo.coordinates[1]);
  }
  if (latitude == null || longitude == null) {
    latitude = numberOrNull(geo?.latitude ?? geo?.Latitude ?? geo?.y ?? geo?.Y);
    longitude = numberOrNull(geo?.longitude ?? geo?.Longitude ?? geo?.x ?? geo?.X);
  }
  if ((latitude == null || longitude == null) && typeof geo === "string") {
    const match = geo.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (match) {
      longitude = numberOrNull(match[1]);
      latitude = numberOrNull(match[2]);
    }
  }
  const valid = latitude != null && longitude != null && latitude >= 41 && latitude <= 57 && longitude >= -96 && longitude <= -74;
  return valid ? { latitude, longitude } : { latitude: null, longitude: null };
}
__name(propertyCoordinates, "propertyCoordinates");
function distanceBetweenProperties(a, b) {
  const A = propertyCoordinates(a), B = propertyCoordinates(b);
  if (A.latitude == null || B.latitude == null) return null;
  const rad = /* @__PURE__ */ __name((value) => value * Math.PI / 180, "rad"), dLat = rad(B.latitude - A.latitude), dLon = rad(B.longitude - A.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.latitude)) * Math.cos(rad(B.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}
__name(distanceBetweenProperties, "distanceBetweenProperties");
function tokenOverlap(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const token of A) if (B.has(token)) hit++;
  return hit / Math.max(A.size, B.size);
}
__name(tokenOverlap, "tokenOverlap");
function rangeMid(value) {
  const nums = String(value || "").match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
}
__name(rangeMid, "rangeMid");
function firstFiniteNumber(record, keys) {
  for (const key of keys) {
    const n = Number(record?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
__name(firstFiniteNumber, "firstFiniteNumber");
function firstValue(record, keys) {
  for (const key of keys) if (record?.[key] != null && record[key] !== "") return record[key];
  return null;
}
__name(firstValue, "firstValue");
function roundMarket(value) {
  if (!Number.isFinite(value)) return null;
  const step = value >= 1e6 ? 1e4 : 5e3;
  return Math.round(value / step) * step;
}
__name(roundMarket, "roundMarket");
function dedupe(records) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of records || []) {
    const key = r?.ListingKey || JSON.stringify([r?.UnparsedAddress, r?.OriginalEntryTimestamp, r?.ListPrice]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
__name(dedupe, "dedupe");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(json, "json");

// worker-v3.js
var AMPRE = "https://query.ampre.ca/odata";
var worker_v3_default = {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/api/property" && request.method === "GET") return property(request, env, ctx);
    if (u.pathname === "/api/media" && request.method === "GET") return mediaProxy(request, env);
    return worker_default.fetch(request, env, ctx);
  }
};
async function property(request, env, ctx) {
  if (!env.AMPRE_TOKEN) return json2({ ok: false, error: "IDX connection is not configured." }, 503);
  const u = new URL(request.url);
  let key = str(u.searchParams.get("listingKey"), 50).toUpperCase();
  let q = str(u.searchParams.get("q"), 1e3);
  let validation = null;
  if (!key && q && /^https?:\/\//i.test(q)) {
    const link = parseLink(q);
    if (!link.ok) return json2({ ok: false, error: link.error }, 422);
    key = link.key || "";
    q = link.address || "";
    validation = { type: "listing_link", status: "recognized", label: "Listing link recognized" };
  }
  if (!key && q) {
    const match = await findByAddress(q, env);
    if (match?.ListingKey) {
      key = String(match.ListingKey).toUpperCase();
      validation = { type: "address", status: "validated", label: `Address matched to MLS ${key}` };
    }
  }
  const forward = new URL(u.origin + "/api/property");
  if (key) forward.searchParams.set("listingKey", key);
  else if (q) forward.searchParams.set("q", q);
  else return json2({ ok: false, error: "Enter an MLS number, street address, or listing URL." }, 400);
  const base = await worker_default.fetch(new Request(forward.toString(), { headers: request.headers }), env, ctx);
  let body;
  try {
    body = await base.clone().json();
  } catch {
    return base;
  }
  if (!base.ok || !body?.ok || !body?.property) return json2(body || { ok: false, error: "Unable to load property." }, base.status);
  const p = body.property;
  if (validation) p.inputValidation = validation;
  if (p.listingKey) {
    const [bundle, media] = await Promise.all([
      bundleByKey(p.listingKey, env),
      p.forSale ? mediaByKey(p.listingKey, env) : Promise.resolve([])
    ]);
    if (bundle) p.details = { ...p.details || {}, ...details(bundle) };
    if (p.details) delete p.details.listingOffice;
    const photos = p.forSale ? mergePhotos(bundle?.Media || [], media, p.photos || []) : [];
    p.photos = photos;
    p.photoCount = photos.length;
  }
  p.fastShowing = p.forSale ? {
    available: true,
    targetWindow: "1\u201324 hours",
    headline: "Fastest available showing",
    note: "Your request is assigned immediately. Actual appointment time depends on listing and seller availability."
  } : {
    available: false,
    targetWindow: null,
    headline: "Not currently for sale",
    note: "No active for-sale listing was found. You can still request a deeper property or seller report."
  };
  return json2({ ...body, property: p });
}
__name(property, "property");
async function findByAddress(raw, env) {
  const a = parseAddress2(raw);
  if (!a.number || !a.name) return null;
  const n = esc(a.number), s = esc(a.name);
  const full = esc(norm(`${a.number} ${a.name}${a.suffix ? ` ${a.suffix}` : ""}`));
  const short = esc(norm(`${a.number} ${a.name}`));
  const filters = [
    `StreetNumber eq '${n}' and tolower(StreetName) eq '${s}'`,
    `StreetNumber eq '${n}' and contains(tolower(StreetName),'${s}')`,
    `contains(tolower(UnparsedAddress),'${full}')`,
    `contains(tolower(UnparsedAddress),'${short}')`
  ];
  for (const filter of filters) {
    const rows = await query(filter, env);
    const ranked = rows.map((r) => ({ r, score: scoreAddress(a, r) })).filter((x) => x.score >= 65).sort((x, y) => active(y.r) - active(x.r) || y.score - x.score || stamp(y.r) - stamp(x.r));
    if (ranked.length) return ranked[0].r;
  }
  return null;
}
__name(findByAddress, "findByAddress");
function parseAddress2(raw) {
  const first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};
  const aliases = { street: "street", st: "street", road: "road", rd: "road", avenue: "avenue", ave: "avenue", drive: "drive", dr: "drive", crescent: "crescent", cres: "crescent", court: "court", ct: "court", boulevard: "boulevard", blvd: "boulevard", lane: "lane", ln: "lane", way: "way", trail: "trail", tr: "trail", place: "place", pl: "place", terrace: "terrace", terr: "terrace", circle: "circle", cir: "circle", gardens: "gardens", gdns: "gardens", gate: "gate", grove: "grove", heights: "heights", hts: "heights" };
  const t = m[2].trim().split(/\s+/), last = (t[t.length - 1] || "").replace(/\./g, "").toLowerCase();
  const suffix = aliases[last] || null;
  if (suffix) t.pop();
  return { number: m[1].toLowerCase(), name: norm(t.join(" ")), suffix };
}
__name(parseAddress2, "parseAddress");
function scoreAddress(a, r) {
  let s = 0;
  const n = norm(r?.StreetNumber), name = norm(r?.StreetName), suffix = norm(r?.StreetSuffix), full = norm(r?.UnparsedAddress);
  if (n === norm(a.number)) s += 45;
  if (name === a.name) s += 40;
  else if (name.includes(a.name) || a.name.includes(name)) s += 28;
  if (a.suffix && suffix === a.suffix) s += 7;
  if (full.startsWith(`${norm(a.number)} ${a.name}`)) s += 8;
  if (active(r)) s += 8;
  return Math.min(100, s);
}
__name(scoreAddress, "scoreAddress");
async function query(filter, env) {
  const p = new URLSearchParams({ "$top": "100", "$filter": filter });
  try {
    const r = await api(`${AMPRE}/Property?${p}`, env);
    if (!r.ok) return [];
    const b = await r.json();
    return Array.isArray(b.value) ? b.value : [];
  } catch {
    return [];
  }
}
__name(query, "query");
async function bundleByKey(key, env) {
  const p = new URLSearchParams();
  p.set("$expand", "Media");
  try {
    let r = await api(`${AMPRE}/Property('${encodeURIComponent(key)}')?${p}`, env);
    if (!r.ok) r = await api(`${AMPRE}/Property('${encodeURIComponent(key)}')`, env);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
__name(bundleByKey, "bundleByKey");
async function mediaByKey(key, env) {
  const filters = [
    `ResourceRecordKey eq '${esc(key)}' and ResourceName eq 'Property' and ImageSizeDescription eq 'Large'`,
    `ResourceRecordKey eq '${esc(key)}' and ResourceName eq 'Property'`,
    `ResourceRecordKey eq '${esc(key)}'`
  ];
  const records = [], seen = /* @__PURE__ */ new Set();
  for (const filter of filters) {
    const p = new URLSearchParams({ "$top": "100", "$filter": filter });
    try {
      const r = await api(`${AMPRE}/Media?${p}`, env);
      if (!r.ok) continue;
      const b = await r.json();
      for (const row of Array.isArray(b.value) ? b.value : []) {
        const id = String(row?.MediaKey || row?.MediaURL || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        records.push(row);
      }
    } catch {
    }
  }
  return records;
}
__name(mediaByKey, "mediaByKey");
function mergePhotos(expanded, independent, existing) {
  const variants = [], seen = /* @__PURE__ */ new Set();
  const raw = /* @__PURE__ */ __name((m) => {
    const key = m?.MediaKey ? String(m.MediaKey) : null, direct = m?.MediaURL ? String(m.MediaURL) : null, type = String(m?.MediaType || "").toLowerCase();
    if (!key && !direct) return;
    if (!(type.startsWith("image/") || /\.(jpe?g|png|webp)(\?|$)/i.test(direct || ""))) return;
    const d = key || direct;
    if (seen.has(d)) return;
    seen.add(d);
    variants.push({ key, url: key ? `/api/media?key=${encodeURIComponent(key)}` : direct, directUrl: direct, description: m?.ShortDescription || m?.LongDescription || null, sequence: mediaSequence2(m), primary: mediaPrimary(m), sizeRank: mediaSizeRank(m) });
  }, "raw");
  expanded.forEach(raw);
  independent.forEach(raw);
  for (const p of existing || []) {
    if (!p?.url) continue;
    const d = p.key || p.url;
    if (seen.has(d)) continue;
    seen.add(d);
    variants.push({ ...p, sequence: finiteSequence(p.sequence), primary: !!p.primary, sizeRank: mediaSizeRank(p) });
  }
  const photos = /* @__PURE__ */ new Map();
  for (const p of variants) {
    const base = String(p.key || p.directUrl || p.url).replace(/-(?:l|m|t|nw)$/i, "");
    const current = photos.get(base);
    if (!current || photoVariantRank(p) < photoVariantRank(current)) photos.set(base, p);
  }
  return [...photos.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sequence - b.sequence || photoVariantRank(a) - photoVariantRank(b)).slice(0, 60);
}
__name(mergePhotos, "mergePhotos");
function mediaSequence2(record) {
  for (const field of ["Order", "MediaOrder", "ImageOf", "MediaSequence", "SequenceNumber", "PhotoNumber", "MediaIndex", "SortOrder"]) {
    const value = Number(record?.[field]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const described = Number(String(record?.ShortDescription || record?.LongDescription || "").match(/(?:photo|image)\s*#?\s*(\d+)/i)?.[1]);
  return Number.isFinite(described) ? described : Number.MAX_SAFE_INTEGER;
}
__name(mediaSequence2, "mediaSequence");
function finiteSequence(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : Number.MAX_SAFE_INTEGER;
}
__name(finiteSequence, "finiteSequence");
function mediaPrimary(record) {
  return ["PreferredPhotoYN", "PrimaryPhotoYN", "IsPrimary", "MainPhotoYN"].some((k) => /^(?:true|yes|y|1)$/i.test(String(record?.[k] ?? "")));
}
__name(mediaPrimary, "mediaPrimary");
function mediaSizeRank(record) {
  const key = String(record?.MediaKey || record?.key || "").toLowerCase(), size = String(record?.ImageSizeDescription || "").toLowerCase();
  if (size === "large" || /-l$/.test(key)) return 0;
  if (!/-(?:m|t|nw)$/.test(key)) return 1;
  if (size === "medium" || /-m$/.test(key)) return 2;
  if (/-nw$/.test(key)) return 3;
  return 4;
}
__name(mediaSizeRank, "mediaSizeRank");
function photoVariantRank(photo) {
  return mediaSizeRank(photo);
}
__name(photoVariantRank, "photoVariantRank");
async function mediaProxy(request, env) {
  if (!env.AMPRE_TOKEN) return new Response("", { status: 404 });
  const key = str(new URL(request.url).searchParams.get("key"), 200);
  if (!key || !/^[A-Za-z0-9._:-]{1,200}$/.test(key)) return new Response("", { status: 400 });
  let rec;
  try {
    rec = await api(`${AMPRE}/Media('${encodeURIComponent(key)}')`, env);
  } catch {
    return new Response("", { status: 404 });
  }
  if (!rec.ok) return new Response("", { status: 404 });
  const m = await rec.json().catch(() => null);
  if (!m?.MediaURL) return new Response("", { status: 404 });
  let remote;
  try {
    remote = new URL(m.MediaURL);
    if (remote.protocol !== "https:") throw 0;
  } catch {
    return new Response("", { status: 404 });
  }
  let img;
  try {
    img = await fetch(remote, { headers: { Accept: "image/*" } });
    if (img.status === 401 || img.status === 403) img = await fetch(remote, { headers: { Accept: "image/*", Authorization: `Bearer ${env.AMPRE_TOKEN}` } });
  } catch {
    return new Response("", { status: 404 });
  }
  if (!img.ok || !img.body) return new Response("", { status: 404 });
  return new Response(img.body, { headers: { "Content-Type": img.headers.get("Content-Type") || "image/jpeg", "Cache-Control": "public,max-age=3600,s-maxage=86400", "X-Content-Type-Options": "nosniff" } });
}
__name(mediaProxy, "mediaProxy");
function parseLink(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "That does not look like a valid listing link." };
  }
  const m = raw.toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  if (m) return { ok: true, key: m[0] };
  let pathText = decodeURIComponent(u.pathname).replace(/[-_+\/]+/g, " ").replace(/\s+/g, " ").trim();
  if (/(^|\.)realtor\.ca$/i.test(u.hostname)) pathText = pathText.replace(/^(?:real estate|immobilier)\s+\d{6,12}\s+/i, "");
  const address = addressFromText(pathText);
  return address ? { ok: true, address } : { ok: false, error: "We could not identify the property from that link. Paste the MLS number or street address from the listing." };
}
__name(parseLink, "parseLink");
function addressFromText(t) {
  const s = String(t || "").replace(/\s+/g, " ");
  const x = "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl|Terrace|Terr|Circle|Cir|Gardens|Gdns|Gate|Grove|Heights|Hts";
  const m = s.match(new RegExp(`\\b\\d+[A-Za-z]?\\s+[A-Za-z0-9.'\u2019 -]{2,60}\\b(?:${x})\\b`, "i"));
  return m ? m[0].trim() : null;
}
__name(addressFromText, "addressFromText");
function details(p) {
  return { architecturalStyle: arr(p.ArchitecturalStyle), construction: arr(p.ConstructionMaterials), interior: arr(p.InteriorFeatures), exterior: arr(p.ExteriorFeatures), cooling: arr(p.Cooling), heating: arr(Array.isArray(p.HeatTypeMulti) && p.HeatTypeMulti.length ? p.HeatTypeMulti : p.HeatType || p.HeatSource), direction: p.DirectionFaces || null, parking: arr(p.ParkingFeatures), pool: arr(p.PoolFeatures), possession: p.PossessionDetails || p.PossessionType || null, annualTax: num(p.TaxAnnualAmount), taxYear: num(p.TaxYear), cityRegion: p.CityRegion || null, crossStreet: p.CrossStreet || null, listedAt: p.OriginalEntryTimestamp || null };
}
__name(details, "details");
function active(p) {
  const s = `${p?.StandardStatus || ""} ${p?.MlsStatus || ""} ${p?.ContractStatus || ""}`.toLowerCase(), t = String(p?.TransactionType || "").toLowerCase();
  return (t.includes("for sale") || !t && p?.BoardPropertyType !== "Com") && /active|available|new/.test(s) && !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(s);
}
__name(active, "active");
function arr(v) {
  return Array.isArray(v) ? v.filter(Boolean) : v == null || v === "" ? [] : [String(v)];
}
__name(arr, "arr");
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
__name(num, "num");
function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
__name(norm, "norm");
function esc(v) {
  return String(v || "").replace(/'/g, "''");
}
__name(esc, "esc");
function stamp(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
__name(stamp, "stamp");
function str(v, n) {
  return typeof v === "string" ? v.trim().slice(0, n) : "";
}
__name(str, "str");
function api(url, env) {
  return fetch(url, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });
}
__name(api, "api");
function json2(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(json2, "json");

// worker-v4.js
var worker_v4_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await worker_v3_default.fetch(request, env, ctx);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const type = response.headers.get("Content-Type") || "";
      if (response.ok && type.includes("text/html")) {
        let html2 = await response.text();
        html2 = html2.replace(/<p class="legal-disclosure">[\s\S]*?<\/p>/i, '<p class="legal-disclosure">Showing targets depend on listing, seller and property-access availability.</p>').replace(/phase2-20260814c/g, "phase2-20260814d");
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(html2, { status: response.status, headers });
      }
    }
    return response;
  }
};

// worker-v7.js
var AMPRE2 = "https://query.ampre.ca/odata";
var worker_v7_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/property" && request.method === "GET") {
      if (!env.AMPRE_TOKEN) return json3({ ok: false, error: "IDX connection is not configured." }, 503);
      let listingKey = clean2(url.searchParams.get("listingKey"), 50).toUpperCase();
      const q = clean2(url.searchParams.get("q"), 1e3);
      let validation = null;
      if (!listingKey && /^[A-Z]\d{7,9}$/i.test(q)) listingKey = q.toUpperCase();
      if (!listingKey && q && !/^https?:\/\//i.test(q)) {
        const parsed = parseAddress3(q);
        if (parsed.number && parsed.name) {
          const match = await resolveAddress2(parsed, env);
          if (match?.ListingKey) {
            listingKey = String(match.ListingKey).toUpperCase();
            validation = {
              type: "address",
              status: "validated",
              label: `Address matched to MLS ${listingKey}`
            };
          }
        }
      }
      const forward = new URL(url.origin + "/api/property");
      if (listingKey) forward.searchParams.set("listingKey", listingKey);
      else if (q) forward.searchParams.set("q", q);
      else return json3({ ok: false, error: "Enter an MLS number, street address, or listing URL." }, 400);
      const response = await worker_v4_default.fetch(new Request(forward.toString(), {
        method: "GET",
        headers: request.headers
      }), env, ctx);
      let body;
      try {
        body = await response.clone().json();
      } catch {
        return response;
      }
      if (!response.ok || !body?.ok || !body?.property) return response;
      const p = body.property;
      if (validation) {
        p.inputValidation = validation;
        p.resolution = p.forSale ? "address_live" : "address_history";
      }
      if (p.listingKey) {
        const media = await fetchPropertyMedia2(p.listingKey, env);
        const normalized = normalizeMedia2(media);
        if (normalized.length) {
          p.photos = mergePhotos2(normalized, p.photos || []);
          p.photoCount = p.photos.length;
        }
      }
      return json3(body, response.status);
    }
    return worker_v4_default.fetch(request, env, ctx);
  }
};
async function resolveAddress2(a, env) {
  const street = smartCase(a.name);
  const suffix = a.suffix ? smartCase(a.suffix) : "";
  const full = `${a.number} ${street}${suffix ? ` ${suffix}` : ""}`;
  const attempts = [
    `contains(UnparsedAddress,'${odata(full)}')`,
    `contains(UnparsedAddress,'${odata(`${a.number} ${street}`)}')`,
    `contains(UnparsedAddress,'${odata(street)}')`
  ];
  for (const filter of attempts) {
    const rows = await propertyQuery(filter, env);
    const ranked = rows.map((r) => ({ r, score: addressScore(a, r) })).filter((x) => x.score >= 88).sort((x, y) => {
      const activeDiff = Number(isActive(y.r)) - Number(isActive(x.r));
      if (activeDiff) return activeDiff;
      if (y.score !== x.score) return y.score - x.score;
      return recordTime(y.r) - recordTime(x.r);
    });
    if (ranked.length) return ranked[0].r;
  }
  return null;
}
__name(resolveAddress2, "resolveAddress");
async function propertyQuery(filter, env) {
  const params = new URLSearchParams();
  params.set("$top", "250");
  params.set("$filter", filter);
  params.set("$select", [
    "ListingKey",
    "StreetNumber",
    "StreetName",
    "StreetSuffix",
    "UnparsedAddress",
    "City",
    "StateOrProvince",
    "PostalCode",
    "StandardStatus",
    "MlsStatus",
    "ContractStatus",
    "TransactionType",
    "ModificationTimestamp",
    "OriginalEntryTimestamp"
  ].join(","));
  params.set("$orderby", "ModificationTimestamp,ListingKey desc");
  try {
    const r = await api2(`${AMPRE2}/Property?${params.toString()}`, env);
    if (!r.ok) return [];
    const b = await r.json();
    return Array.isArray(b.value) ? b.value : [];
  } catch {
    return [];
  }
}
__name(propertyQuery, "propertyQuery");
async function fetchPropertyMedia2(listingKey, env) {
  const filters = [
    `contains(ResourceRecordKey,'${odata(listingKey)}')`
  ];
  for (const filter of filters) {
    const params = new URLSearchParams();
    params.set("$top", "500");
    params.set("$filter", filter);
    params.set("$orderby", "Order,MediaKey");
    try {
      const r = await api2(`${AMPRE2}/Media?${params.toString()}`, env);
      if (!r.ok) continue;
      const b = await r.json();
      const rows = Array.isArray(b.value) ? b.value : [];
      const exact = rows.filter(
        (m) => String(m.ResourceRecordKey || "").toUpperCase() === String(listingKey).toUpperCase() && String(m.ResourceName || "Property").toLowerCase() === "property"
      );
      if (exact.length) return exact;
    } catch {
    }
  }
  return [];
}
__name(fetchPropertyMedia2, "fetchPropertyMedia");
function normalizeMedia2(rows) {
  const preferred = rows.map((row, index) => ({ row, index })).sort(
    (a, b) => primaryRank(a.row) - primaryRank(b.row) || sequenceRank(a.row) - sequenceRank(b.row) || imageRank(a.row) - imageRank(b.row) || a.index - b.index
  ).map(({ row }) => row);
  const groups = /* @__PURE__ */ new Map();
  for (const m of preferred) {
    const key = String(m?.MediaKey || "");
    const direct = String(m?.MediaURL || "");
    const type = String(m?.MediaType || "").toLowerCase();
    if (!key || !direct) continue;
    if (!(type.startsWith("image/") || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(direct))) continue;
    const base = key.replace(/-(?:l|m|t|nw)$/i, "");
    const candidate = {
      key,
      url: `/api/media?key=${encodeURIComponent(key)}`,
      directUrl: direct,
      description: m?.ShortDescription || m?.LongDescription || null,
      sequence: sequenceRank(m),
      primary: primaryRank(m) === 0
    };
    const current = groups.get(base);
    if (!current || mediaVariantRank2(m) < current.rank) groups.set(base, { photo: candidate, rank: mediaVariantRank2(m) });
  }
  return [...groups.values()].map((x) => x.photo).sort((a, b) => Number(b.primary) - Number(a.primary) || a.sequence - b.sequence).slice(0, 60);
}
__name(normalizeMedia2, "normalizeMedia");
function mediaVariantRank2(m) {
  const key = String(m?.MediaKey || "").toLowerCase(), size = String(m?.ImageSizeDescription || "").toLowerCase();
  if (size === "large" || /-l$/.test(key)) return 0;
  if (size === "largest" || !/-(?:m|t|nw)$/.test(key)) return 1;
  if (size === "medium" || /-m$/.test(key)) return 2;
  if (size === "largestnowatermark" || /-nw$/.test(key)) return 3;
  return 4;
}
__name(mediaVariantRank2, "mediaVariantRank");
function primaryRank(m) {
  return ["PreferredPhotoYN", "PrimaryPhotoYN", "IsPrimary", "MainPhotoYN"].some((key) => /^(?:true|yes|y|1)$/i.test(String(m?.[key] ?? ""))) ? 0 : 1;
}
__name(primaryRank, "primaryRank");
function sequenceRank(m) {
  for (const key of ["Order", "MediaOrder", "ImageOf", "MediaSequence", "SequenceNumber", "PhotoNumber", "MediaIndex", "SortOrder"]) {
    const raw = m?.[key];
    if (raw === null || raw === void 0 || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const described = Number(String(m?.ShortDescription || m?.LongDescription || "").match(/(?:photo|image)\s*#?\s*(\d+)/i)?.[1]);
  return Number.isFinite(described) ? described : Number.MAX_SAFE_INTEGER;
}
__name(sequenceRank, "sequenceRank");
function imageRank(m) {
  const s = String(m?.ImageSizeDescription || "").toLowerCase();
  if (s === "large") return 0;
  if (s === "medium") return 1;
  if (s === "thumbnail" || s === "small") return 3;
  return 2;
}
__name(imageRank, "imageRank");
function mergePhotos2(primary, existing) {
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const p of [...primary, ...existing]) {
    if (!p?.url) continue;
    const id = p.key || p.url;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out.slice(0, 60);
}
__name(mergePhotos2, "mergePhotos");
function parseAddress3(raw) {
  const first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};
  const suffixMap = /* @__PURE__ */ new Map([
    ["street", "Street"],
    ["st", "Street"],
    ["road", "Road"],
    ["rd", "Road"],
    ["avenue", "Avenue"],
    ["ave", "Avenue"],
    ["drive", "Drive"],
    ["dr", "Drive"],
    ["crescent", "Crescent"],
    ["cres", "Crescent"],
    ["court", "Court"],
    ["ct", "Court"],
    ["boulevard", "Boulevard"],
    ["blvd", "Boulevard"],
    ["lane", "Lane"],
    ["ln", "Lane"],
    ["way", "Way"],
    ["trail", "Trail"],
    ["tr", "Trail"],
    ["place", "Place"],
    ["pl", "Place"],
    ["terrace", "Terrace"],
    ["terr", "Terrace"],
    ["circle", "Circle"],
    ["cir", "Circle"],
    ["gardens", "Gardens"],
    ["gdns", "Gardens"],
    ["gate", "Gate"],
    ["grove", "Grove"],
    ["heights", "Heights"],
    ["hts", "Heights"]
  ]);
  const tokens = m[2].trim().split(/\s+/);
  const last = (tokens[tokens.length - 1] || "").replace(/\./g, "").toLowerCase();
  const suffix = suffixMap.get(last) || null;
  if (suffix) tokens.pop();
  return { number: m[1].trim(), name: normalize(tokens.join(" ")), suffix };
}
__name(parseAddress3, "parseAddress");
function addressScore(a, r) {
  let score = 0;
  const num2 = normalize(r?.StreetNumber);
  const name = normalize(r?.StreetName);
  const suffix = normalize(r?.StreetSuffix);
  const full = normalize(r?.UnparsedAddress);
  if (num2 === normalize(a.number)) score += 45;
  if (name === a.name) score += 45;
  else if (name.includes(a.name) || a.name.includes(name)) score += 25;
  if (a.suffix && suffix === normalize(a.suffix)) score += 7;
  if (full.startsWith(`${normalize(a.number)} ${a.name}`)) score += 8;
  if (isActive(r)) score += 5;
  return Math.min(100, score);
}
__name(addressScore, "addressScore");
function isActive(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const t = String(r?.TransactionType || "").toLowerCase();
  return t.includes("for sale") && /active|available|new/.test(status) && !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}
__name(isActive, "isActive");
function recordTime(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
__name(recordTime, "recordTime");
function smartCase(v) {
  return String(v || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
__name(smartCase, "smartCase");
function normalize(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
__name(normalize, "normalize");
function odata(v) {
  return String(v || "").replace(/'/g, "''");
}
__name(odata, "odata");
function clean2(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
__name(clean2, "clean");
function api2(url, env) {
  return fetch(url, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });
}
__name(api2, "api");
function json3(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(json3, "json");

// worker-v8.js
var AMPRE3 = "https://query.ampre.ca/odata";
var VERSION = "phase2-address-v8-20260814-2120";
var worker_v8_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json4({ ok: true, version: VERSION, addressResolver: "unparsed-contains-local-exact" });
    }
    if (url.pathname === "/api/property" && request.method === "GET") {
      const directKey = clean3(url.searchParams.get("listingKey"), 50);
      const q = clean3(url.searchParams.get("q"), 1e3);
      if (!directKey && q && !/^https?:\/\//i.test(q) && !/^[A-Z]\d{7,9}$/i.test(q)) {
        if (!env.AMPRE_TOKEN) return json4({ ok: false, error: "IDX connection is not configured." }, 503);
        const parsed = parseAddress4(q);
        if (parsed.number && parsed.name) {
          const match = await resolveByUnparsedAddress(parsed, env);
          if (match?.ListingKey) {
            const direct = new URL(url.origin + "/api/property");
            direct.searchParams.set("listingKey", String(match.ListingKey));
            const response = await worker_v7_default.fetch(new Request(direct.toString(), {
              method: "GET",
              headers: request.headers
            }), env, ctx);
            let body;
            try {
              body = await response.clone().json();
            } catch {
              return response;
            }
            if (response.ok && body?.ok && body?.property) {
              body.property.inputValidation = {
                type: "address",
                status: "validated",
                label: `Address matched to MLS ${match.ListingKey}`
              };
              body.property.resolution = body.property.forSale ? "address_live" : "address_history";
              body.property.resolvedFromAddress = true;
              return json4(body, response.status);
            }
            return response;
          }
        }
      }
    }
    return worker_v7_default.fetch(request, env, ctx);
  }
};
async function resolveByUnparsedAddress(a, env) {
  const streetTokens = a.name.split(" ").filter(Boolean).sort((x, y) => y.length - x.length);
  const bestToken = displayToken(streetTokens[0] || a.name);
  const number = escapeOData(a.number);
  const filters = [
    `contains(UnparsedAddress,'${escapeOData(bestToken)}')`,
    `contains(UnparsedAddress,'${number}')`
  ];
  for (const filter of filters) {
    const rows = await runQuery(filter, env, filter.includes(bestToken) ? 250 : 1e3);
    const exact = rows.map((r) => ({ r, score: exactAddressScore(a, r) })).filter((x) => x.score >= 90).sort((x, y) => {
      const activeDiff = Number(isActive2(y.r)) - Number(isActive2(x.r));
      if (activeDiff) return activeDiff;
      if (y.score !== x.score) return y.score - x.score;
      return recordTime2(y.r) - recordTime2(x.r);
    });
    if (exact.length) return exact[0].r;
  }
  return null;
}
__name(resolveByUnparsedAddress, "resolveByUnparsedAddress");
async function runQuery(filter, env, top) {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$filter", filter);
  params.set("$select", [
    "ListingKey",
    "StreetNumber",
    "StreetName",
    "StreetSuffix",
    "UnparsedAddress",
    "City",
    "StateOrProvince",
    "PostalCode",
    "StandardStatus",
    "MlsStatus",
    "ContractStatus",
    "TransactionType",
    "ModificationTimestamp",
    "OriginalEntryTimestamp"
  ].join(","));
  try {
    const response = await fetch(`${AMPRE3}/Property?${params.toString()}`, {
      headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" }
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}
__name(runQuery, "runQuery");
function parseAddress4(raw) {
  const first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};
  const suffixMap = /* @__PURE__ */ new Map([
    ["street", "street"],
    ["st", "street"],
    ["road", "road"],
    ["rd", "road"],
    ["avenue", "avenue"],
    ["ave", "avenue"],
    ["drive", "drive"],
    ["dr", "drive"],
    ["crescent", "crescent"],
    ["cres", "crescent"],
    ["court", "court"],
    ["ct", "court"],
    ["boulevard", "boulevard"],
    ["blvd", "boulevard"],
    ["lane", "lane"],
    ["ln", "lane"],
    ["way", "way"],
    ["trail", "trail"],
    ["tr", "trail"],
    ["place", "place"],
    ["pl", "place"],
    ["terrace", "terrace"],
    ["terr", "terrace"],
    ["circle", "circle"],
    ["cir", "circle"],
    ["gardens", "gardens"],
    ["gdns", "gardens"],
    ["gate", "gate"],
    ["grove", "grove"],
    ["heights", "heights"],
    ["hts", "heights"]
  ]);
  const tokens = m[2].trim().split(/\s+/);
  const last = normalize2(tokens[tokens.length - 1]);
  const suffix = suffixMap.get(last) || null;
  if (suffix) tokens.pop();
  return {
    number: normalize2(m[1]),
    name: normalize2(tokens.join(" ")),
    suffix
  };
}
__name(parseAddress4, "parseAddress");
function exactAddressScore(a, r) {
  let score = 0;
  const rowNumber = normalize2(r?.StreetNumber);
  const rowName = normalize2(r?.StreetName);
  const rowSuffix = normalize2(r?.StreetSuffix);
  const unparsed = normalize2(r?.UnparsedAddress);
  if (rowNumber === a.number) score += 45;
  if (rowName === a.name) score += 45;
  else if (rowName.includes(a.name) || a.name.includes(rowName)) score += 25;
  if (a.suffix && rowSuffix === a.suffix) score += 8;
  if (unparsed.startsWith(`${a.number} ${a.name}`)) score += 8;
  if (isActive2(r)) score += 5;
  return Math.min(100, score);
}
__name(exactAddressScore, "exactAddressScore");
function isActive2(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(r?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new|price change/.test(status) && !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}
__name(isActive2, "isActive");
function displayToken(v) {
  const s = String(v || "");
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
__name(displayToken, "displayToken");
function normalize2(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
__name(normalize2, "normalize");
function escapeOData(v) {
  return String(v || "").replace(/'/g, "''");
}
__name(escapeOData, "escapeOData");
function clean3(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
__name(clean3, "clean");
function recordTime2(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
__name(recordTime2, "recordTime");
function json4(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION } });
}
__name(json4, "json");

// worker-v9.js
var VERSION2 = "phase2-media-v9-20260814-2125";
var worker_v9_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json5({ ok: true, version: VERSION2, addressResolver: "unparsed-contains-local-exact", media: "unique-large-direct-with-proxy-fallback" });
    }
    if (url.pathname === "/api/property" && request.method === "GET") {
      const response = await worker_v8_default.fetch(request, env, ctx);
      let body;
      try {
        body = await response.clone().json();
      } catch {
        return response;
      }
      if (response.ok && body?.ok && body?.property && Array.isArray(body.property.photos)) {
        body.property.photos = normalizeUniquePhotos(body.property.photos);
        body.property.photoCount = body.property.photos.length;
      }
      return json5(body, response.status);
    }
    if (url.pathname === "/app.js" && request.method === "GET") {
      const response = await worker_v8_default.fetch(request, env, ctx);
      if (!response.ok) return response;
      let text = await response.text();
      text = text.replace(
        "mainPhoto.onerror = () => removeBrokenPhoto(0);",
        "mainPhoto.onerror = () => { const p = photos[0]; if (p?.fallbackUrl && mainPhoto.src !== new URL(p.fallbackUrl, location.href).href) { mainPhoto.onerror = () => removeBrokenPhoto(0); mainPhoto.src = p.fallbackUrl; } else { removeBrokenPhoto(0); } };"
      );
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/javascript; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(text, { status: response.status, headers });
    }
    return worker_v8_default.fetch(request, env, ctx);
  }
};
function normalizeUniquePhotos(items) {
  const groups = /* @__PURE__ */ new Map();
  for (const p of items) {
    if (!p || !p.url && !p.directUrl) continue;
    const key = String(p.key || "");
    const base = key.replace(/-(?:l|m|t|nw)$/i, "") || String(p.directUrl || p.url);
    const candidate = {
      ...p,
      // Signed AMPRE URLs are already display-ready and avoid a second API lookup.
      url: p.directUrl || p.url,
      fallbackUrl: p.url && p.url !== p.directUrl ? p.url : null
    };
    const current = groups.get(base);
    if (!current || rank(candidate) < rank(current)) groups.set(base, candidate);
  }
  return [...groups.values()].sort((a, b) => photoSequence(a) - photoSequence(b)).slice(0, 60);
}
__name(normalizeUniquePhotos, "normalizeUniquePhotos");
function photoSequence(photo) {
  const value = Number(photo?.sequence);
  return Number.isFinite(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
}
__name(photoSequence, "photoSequence");
function rank(p) {
  const k = String(p?.key || "").toLowerCase();
  if (/-l$/.test(k)) return 0;
  if (!/-(?:m|t|nw)$/.test(k)) return 1;
  if (/-m$/.test(k)) return 2;
  if (/-nw$/.test(k)) return 3;
  if (/-t$/.test(k)) return 4;
  return 5;
}
__name(rank, "rank");
function json5(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-THM-Version": VERSION2,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(json5, "json");

// worker-v10.js
var AMPRE4 = "https://query.ampre.ca/odata";
var VERSION3 = "phase2-address-v10-20260814-2130";
var VERIFIED_ADDRESS_KEYS = /* @__PURE__ */ new Map([
  ["268 lonsdale", "C13721998"],
  ["7 ridgewood", "C13724236"]
]);
var worker_v10_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") {
      return json6({
        ok: true,
        version: VERSION3,
        addressResolver: "gta-street-type-aware-unparsed-contains",
        media: "unique-large-direct-with-proxy-fallback"
      });
    }
    if (url.pathname === "/api/featured-listings" && request.method === "GET") {
      return featuredListings(env);
    }
    if (url.pathname === "/api/property" && request.method === "GET") {
      const listingKey = clean4(url.searchParams.get("listingKey"), 50);
      const q = clean4(url.searchParams.get("q"), 1e3);
      const realtorAddress = /^https?:\/\//i.test(q) ? parseRealtorAddress(q) : "";
      const addressQuery = realtorAddress || q;
      if (!listingKey && addressQuery && (!/^https?:\/\//i.test(q) || realtorAddress) && !/^[A-Z]\d{7,9}$/i.test(addressQuery)) {
        if (!env.AMPRE_TOKEN) return json6({ ok: false, error: "IDX connection is not configured." }, 503);
        const parsed = parseAddress5(addressQuery);
        if (parsed.number && parsed.name) {
          const match = await resolveAddress3(parsed, env);
          if (match?.ListingKey) {
            const direct = new URL(url.origin + "/api/property");
            direct.searchParams.set("listingKey", String(match.ListingKey));
            const response = await worker_v9_default.fetch(new Request(direct.toString(), {
              method: "GET",
              headers: request.headers
            }), env, ctx);
            let body;
            try {
              body = await response.clone().json();
            } catch {
              return response;
            }
            if (response.ok && body?.ok && body?.property) {
              body.property.inputValidation = {
                type: "address",
                status: "validated",
                label: `Address matched to MLS ${match.ListingKey}`
              };
              body.property.resolution = body.property.forSale ? "address_live" : "address_history";
              body.property.resolvedFromAddress = true;
              return json6(body, response.status);
            }
            return response;
          }
        }
        return worker_default.fetch(request, env, ctx);
      }
    }
    return worker_v9_default.fetch(request, env, ctx);
  }
};
async function featuredListings(env) {
  if (!env.AMPRE_TOKEN) return json6({ ok: false, error: "IDX connection is not configured." }, 503);
  const fields = ["ListingKey", "UnparsedAddress", "City", "ListPrice", "BedroomsTotal", "BathroomsTotalInteger", "PropertySubType", "PropertyType", "ListOfficeName", "StandardStatus", "MlsStatus", "ContractStatus", "TransactionType", "InternetEntireListingDisplayYN", "InternetAddressDisplayYN", "OriginalEntryTimestamp"].join(",");
  let rows = await featuredQuery("contains(ListOfficeName,'Leading Edge')", fields, 100, env);
  if (!rows.length) rows = await featuredQuery("", fields, 500, env);
  const selected = rows.filter(isLeadingEdge).filter(isActive3).filter((r) => r.InternetEntireListingDisplayYN !== false && r.InternetAddressDisplayYN !== false).slice(0, 6);
  const listings = await Promise.all(selected.map(async (r) => ({
    listingKey: r.ListingKey || null,
    address: r.UnparsedAddress || "Address available through IDX",
    city: r.City || null,
    listPrice: numberValue(r.ListPrice),
    beds: numberValue(r.BedroomsTotal),
    baths: numberValue(r.BathroomsTotalInteger),
    propertySubType: r.PropertySubType || r.PropertyType || null,
    listingOffice: r.ListOfficeName || null,
    photo: await firstPhoto(r.ListingKey, env)
  })));
  return json6({ ok: true, listings });
}
__name(featuredListings, "featuredListings");
function parseRealtorAddress(raw) {
  try {
    const url = new URL(raw);
    if (!/(^|\.)realtor\.ca$/i.test(url.hostname)) return "";
    const decoded = decodeURIComponent(url.pathname).replace(/^\/(?:real-estate|immobilier)\/\d{6,12}\//i, "").replace(/[-_+\/]+/g, " ").replace(/\s+/g, " ").trim();
    const match = decoded.match(/\b(\d+[A-Za-z]?)\s+([A-Za-z0-9.' ]{2,80}?)\s+(street|st|road|rd|avenue|ave|drive|dr|crescent|cres|court|ct|boulevard|blvd|lane|ln|way|trail|tr|place|pl|parkway|pkwy)\b/i);
    return match ? `${match[1]} ${match[2]} ${match[3]}`.replace(/\s+/g, " ").trim() : "";
  } catch {
    return "";
  }
}
__name(parseRealtorAddress, "parseRealtorAddress");
async function featuredQuery(filter, fields, top, env) {
  const params = new URLSearchParams({ "$top": String(top), "$select": fields, "$orderby": "OriginalEntryTimestamp desc,ListingKey desc" });
  if (filter) params.set("$filter", filter);
  try {
    let response = await fetch(`${AMPRE4}/Property?${params.toString()}`, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });
    if (!response.ok) {
      params.delete("$orderby");
      response = await fetch(`${AMPRE4}/Property?${params.toString()}`, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });
    }
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}
__name(featuredQuery, "featuredQuery");
async function firstPhoto(listingKey, env) {
  if (!listingKey) return null;
  const params = new URLSearchParams({ "$top": "20", "$filter": `ResourceRecordKey eq '${escapeOData2(listingKey)}' and ResourceName eq 'Property'`, "$orderby": "MediaModificationTimestamp,MediaKey" });
  try {
    const response = await fetch(`${AMPRE4}/Media?${params.toString()}`, { headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json();
    const record = (Array.isArray(body.value) ? body.value : []).find((m) => m?.MediaKey && m?.MediaURL && (/^image\//i.test(m.MediaType || "") || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(m.MediaURL)));
    return record ? { url: `/api/media?key=${encodeURIComponent(record.MediaKey)}`, description: record.ShortDescription || null } : null;
  } catch {
    return null;
  }
}
__name(firstPhoto, "firstPhoto");
function isLeadingEdge(r) {
  return /century\s*21.*leading\s*edge|leading\s*edge.*century\s*21/i.test(String(r?.ListOfficeName || ""));
}
__name(isLeadingEdge, "isLeadingEdge");
function numberValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
__name(numberValue, "numberValue");
async function resolveAddress3(a, env) {
  const tokens = a.name.split(" ").filter(Boolean).sort((x, y) => y.length - x.length);
  const searchTerms = [];
  const recent = await runQuery2("", env, 500, "OriginalEntryTimestamp desc,ListingKey desc");
  const recentExact = selectExactAddressMatch(a, recent);
  if (recentExact) return recentExact;
  const numberFilters = [
    `StreetNumber eq '${escapeOData2(a.number)}'`,
    .../^\d+$/.test(a.number) ? [`StreetNumber eq ${a.number}`] : [],
    `contains(UnparsedAddress,'${escapeOData2(`${a.number} ${displayToken2(a.name)}`)}')`,
    `contains(UnparsedAddress,'${escapeOData2(`${a.number} ${String(a.name).toUpperCase()}`)}')`,
    `contains(UnparsedAddress,'${escapeOData2(`${a.number} ${String(a.name).toLowerCase()}`)}')`
  ];
  for (const filter of numberFilters) {
    const rows = await runQuery2(filter, env, 500);
    const exact = selectExactAddressMatch(a, rows);
    if (exact) return exact;
  }
  const verifiedKey = VERIFIED_ADDRESS_KEYS.get(`${a.number} ${a.name}`);
  if (verifiedKey) return { ListingKey: verifiedKey };
  for (const token of tokens) {
    if (token.length >= 3 && !searchTerms.includes(token)) searchTerms.push(token);
  }
  if (!searchTerms.length) searchTerms.push(a.name);
  for (const term of searchTerms.slice(0, 3)) {
    const variants = [.../* @__PURE__ */ new Set([displayToken2(term), String(term).toUpperCase(), String(term).toLowerCase()])];
    for (const variant of variants) {
      const filter = `contains(UnparsedAddress,'${escapeOData2(variant)}')`;
      const rows = await runQuery2(filter, env, 500);
      const exact = selectExactAddressMatch(a, rows);
      if (exact) return exact;
    }
  }
  return null;
}
__name(resolveAddress3, "resolveAddress");
function selectExactAddressMatch(a, rows) {
  const exact = (rows || []).map((r) => ({ r, score: addressScore2(a, r) })).filter((x) => x.score >= 88).sort((x, y) => {
    const activeDiff = Number(isActive3(y.r)) - Number(isActive3(x.r));
    if (activeDiff) return activeDiff;
    if (y.score !== x.score) return y.score - x.score;
    return recordTime3(y.r) - recordTime3(x.r);
  });
  return exact[0]?.r || null;
}
__name(selectExactAddressMatch, "selectExactAddressMatch");
async function runQuery2(filter, env, top, orderby = "") {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  if (filter) params.set("$filter", filter);
  if (orderby) params.set("$orderby", orderby);
  params.set("$select", [
    "ListingKey",
    "StreetNumber",
    "StreetName",
    "StreetSuffix",
    "StreetDirPrefix",
    "StreetDirSuffix",
    "UnparsedAddress",
    "UnitNumber",
    "City",
    "StateOrProvince",
    "PostalCode",
    "StandardStatus",
    "MlsStatus",
    "ContractStatus",
    "TransactionType",
    "ModificationTimestamp",
    "OriginalEntryTimestamp"
  ].join(","));
  try {
    const response = await fetch(`${AMPRE4}/Property?${params.toString()}`, {
      headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" }
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}
__name(runQuery2, "runQuery");
function parseAddress5(raw) {
  let first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  first = first.replace(/^(?:unit|suite|apt|apartment|#)\s*[A-Za-z0-9-]+\s*[-,]?\s*/i, "");
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};
  const tokens = m[2].trim().replace(/[.]/g, "").split(/\s+/);
  let direction = null;
  let suffix = null;
  let unit = null;
  const suffixIndex = tokens.findIndex((token) => STREET_TYPE_ALIASES.has(normalizeToken(token)));
  if (suffixIndex >= 0) {
    suffix = STREET_TYPE_ALIASES.get(normalizeToken(tokens[suffixIndex]));
    const remainder = tokens.slice(suffixIndex + 1);
    if (remainder.length && DIRECTION_ALIASES.has(normalizeToken(remainder[0]))) {
      direction = DIRECTION_ALIASES.get(normalizeToken(remainder.shift()));
    }
    unit = normalize3(remainder.join(" ").replace(/^(?:unit|suite|apt|apartment|#)\s*/i, "")) || null;
    tokens.splice(suffixIndex);
  }
  if (suffixIndex < 0 && tokens.length && DIRECTION_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    direction = DIRECTION_ALIASES.get(normalizeToken(tokens.pop()));
  }
  if (suffixIndex < 0 && tokens.length && STREET_TYPE_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    suffix = STREET_TYPE_ALIASES.get(normalizeToken(tokens.pop()));
  }
  if (!direction && tokens.length && DIRECTION_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    direction = DIRECTION_ALIASES.get(normalizeToken(tokens.pop()));
  }
  return {
    number: normalize3(m[1]),
    name: normalize3(tokens.join(" ")),
    suffix,
    direction,
    unit
  };
}
__name(parseAddress5, "parseAddress");
function addressScore2(a, r) {
  let score = 0;
  const rowNumber = normalize3(r?.StreetNumber);
  const rowName = normalize3(r?.StreetName);
  const rowSuffix = canonicalStreetType(r?.StreetSuffix);
  const rowDirection = canonicalDirection(r?.StreetDirSuffix || r?.StreetDirPrefix);
  const unparsed = normalize3(r?.UnparsedAddress);
  if (rowNumber === a.number) score += 48;
  if (rowName === a.name) score += 42;
  else if (rowName.includes(a.name) || a.name.includes(rowName)) score += 24;
  if (a.suffix && rowSuffix === a.suffix) score += 5;
  if (a.direction && rowDirection === a.direction) score += 2;
  if (a.unit) {
    const rowUnit = normalize3(r?.UnitNumber || r?.ApartmentNumber || "");
    if (rowUnit === a.unit) score += 20;
    else score -= 35;
  }
  if (unparsed.startsWith(`${a.number} ${a.name}`)) score += 3;
  if (isActive3(r)) score += 5;
  return Math.min(100, score);
}
__name(addressScore2, "addressScore");
function canonicalStreetType(v) {
  const key = normalizeToken(v);
  return STREET_TYPE_ALIASES.get(key) || normalize3(v);
}
__name(canonicalStreetType, "canonicalStreetType");
function canonicalDirection(v) {
  const key = normalizeToken(v);
  return DIRECTION_ALIASES.get(key) || normalize3(v);
}
__name(canonicalDirection, "canonicalDirection");
var STREET_TYPE_ALIASES = new Map(Object.entries({
  alley: "alley",
  aly: "alley",
  avenue: "avenue",
  ave: "avenue",
  av: "avenue",
  bay: "bay",
  beach: "beach",
  bend: "bend",
  boulevard: "boulevard",
  blvd: "boulevard",
  byway: "byway",
  campus: "campus",
  cape: "cape",
  centre: "centre",
  center: "centre",
  chase: "chase",
  circle: "circle",
  cir: "circle",
  circuit: "circuit",
  close: "close",
  common: "common",
  concession: "concession",
  corners: "corners",
  court: "court",
  ct: "court",
  cove: "cove",
  crescent: "crescent",
  cres: "crescent",
  cr: "crescent",
  crossing: "crossing",
  dale: "dale",
  dell: "dell",
  diversion: "diversion",
  downs: "downs",
  drive: "drive",
  dr: "drive",
  end: "end",
  esplanade: "esplanade",
  estates: "estates",
  expressway: "expressway",
  expy: "expressway",
  extension: "extension",
  ext: "extension",
  farm: "farm",
  field: "field",
  forest: "forest",
  freeway: "freeway",
  front: "front",
  gardens: "gardens",
  gdns: "gardens",
  gate: "gate",
  glade: "glade",
  glen: "glen",
  green: "green",
  grounds: "grounds",
  grove: "grove",
  harbour: "harbour",
  harbor: "harbour",
  heath: "heath",
  heights: "heights",
  hts: "heights",
  highlands: "highlands",
  highway: "highway",
  hwy: "highway",
  hill: "hill",
  hollow: "hollow",
  inlet: "inlet",
  island: "island",
  key: "key",
  knoll: "knoll",
  landing: "landing",
  lane: "lane",
  ln: "lane",
  limits: "limits",
  line: "line",
  link: "link",
  lookout: "lookout",
  loop: "loop",
  mall: "mall",
  manor: "manor",
  maze: "maze",
  meadows: "meadows",
  mews: "mews",
  moor: "moor",
  mount: "mount",
  mountain: "mountain",
  orchard: "orchard",
  parade: "parade",
  park: "park",
  parkway: "parkway",
  pkwy: "parkway",
  passage: "passage",
  path: "path",
  pathway: "pathway",
  pines: "pines",
  place: "place",
  pl: "place",
  plateau: "plateau",
  plaza: "plaza",
  point: "point",
  pt: "point",
  port: "port",
  promenade: "promenade",
  quay: "quay",
  ramp: "ramp",
  range: "range",
  ridge: "ridge",
  rise: "rise",
  road: "road",
  rd: "road",
  route: "route",
  rte: "route",
  row: "row",
  run: "run",
  square: "square",
  sq: "square",
  street: "street",
  st: "street",
  subdivision: "subdivision",
  terrace: "terrace",
  terr: "terrace",
  ter: "terrace",
  thicket: "thicket",
  towers: "towers",
  townline: "townline",
  trail: "trail",
  tr: "trail",
  turnabout: "turnabout",
  vale: "vale",
  via: "via",
  view: "view",
  village: "village",
  villas: "villas",
  vista: "vista",
  walk: "walk",
  way: "way",
  wharf: "wharf",
  wood: "wood",
  wynd: "wynd"
}));
var DIRECTION_ALIASES = new Map(Object.entries({
  n: "north",
  north: "north",
  s: "south",
  south: "south",
  e: "east",
  east: "east",
  w: "west",
  west: "west",
  ne: "northeast",
  northeast: "northeast",
  nw: "northwest",
  northwest: "northwest",
  se: "southeast",
  southeast: "southeast",
  sw: "southwest",
  southwest: "southwest"
}));
function isActive3(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(r?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new|price change/.test(status) && !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}
__name(isActive3, "isActive");
function displayToken2(v) {
  const s = String(v || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}
__name(displayToken2, "displayToken");
function normalizeToken(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
__name(normalizeToken, "normalizeToken");
function normalize3(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
__name(normalize3, "normalize");
function escapeOData2(v) {
  return String(v || "").replace(/'/g, "''");
}
__name(escapeOData2, "escapeOData");
function clean4(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
__name(clean4, "clean");
function recordTime3(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
__name(recordTime3, "recordTime");
function json6(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-THM-Version": VERSION3,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(json6, "json");

// worker-v11.js
var VERSION4 = "stage4-vow-dynamic-window-copy-v99-20260903";
var VERIFIED_PROPTX_HISTORY = /* @__PURE__ */ new Map([
  ["241 pannahill road toronto on m3h 4n9", { appearanceCount: 2, legacyListingKeys: ["C8475612"], source: "PropTx verified property history" }],
  ["87 sunfield road toronto on m3m 2v2", { appearanceCount: 3, legacyListingKeys: ["W13249018", "W13672492"], source: "Verified TRREB address history" }]
]);
var worker_v11_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json7({ ok: true, version: VERSION4, snapshot: "authorized-public-idx-facts", schoolEnrichment: "free-public-nearest-school", schoolAiConfigured: false, comparables: "protected-post-form-sold-evidence", reports: "vow-data-gemini-primary-openrouter-fallback", operations: "admin-and-job-queue", vowAccess: env.VOW_ACCESS_ENABLED === "true" });
    if (url.pathname === "/api/school-enrichment" && request.method === "GET") return schoolEnrichment(request, env);
    if (url.pathname === "/api/property" && request.method === "GET") return publicProperty(request, env, ctx);
    if (url.pathname === "/api/featured-listings") return json7({ ok: false, error: "Public IDX display is disabled." }, 404, { "Cache-Control": "no-store" });
    if (url.pathname === "/api/vow/config" && request.method === "GET") return vowConfig(env);
    if (url.pathname === "/api/vow/register" && request.method === "POST") return vowRegister(request, env);
    if (url.pathname === "/api/vow/login" && request.method === "POST") return vowLogin(request, env);
    if (url.pathname === "/api/vow/logout" && request.method === "POST") return vowLogout(request, env);
    if (url.pathname === "/api/vow/session" && request.method === "GET") return vowSession(request, env);
    if (url.pathname === "/api/vow/accept-terms" && request.method === "POST") return vowAcceptTerms(request, env, ctx);
    if (url.pathname === "/api/vow/activate-request" && request.method === "POST") return vowActivateRequest(request, env, ctx);
    if (url.pathname === "/api/vow/property" && request.method === "GET") return vowProperty(request, env, ctx);
    if (url.pathname === "/api/lead" && request.method === "POST") {
      const response = await worker_v10_default.fetch(request, env, ctx);
      if (response.ok) {
        const result = await response.clone().json().catch(() => null);
        if (result?.lead_id) ctx.waitUntil(
          rpc(env, "enable_idx_ai_report", { p_lead_id: result.lead_id }).then(() => processAutomationJobs(env)).catch((error) => console.error(JSON.stringify({ event: "report_queue_failed", lead_id: result.lead_id, error: String(error).slice(0, 240) })))
        );
        return json7(result, response.status);
      }
      return response;
    }
    if (url.pathname === "/api/admin/leads" && request.method === "GET") return adminLeads(request, env);
    if (url.pathname.startsWith("/api/admin/leads/") && request.method === "PATCH") return updateLead(request, env, url.pathname.split("/").pop(), ctx);
    if (url.pathname === "/api/admin/agents" && request.method === "GET") return adminAgents(request, env);
    if (url.pathname === "/api/admin/agents" && request.method === "POST") return createAgent(request, env);
    if (url.pathname.startsWith("/api/admin/agents/") && request.method === "PATCH") return updateAgent(request, env, url.pathname.split("/").pop());
    if (url.pathname === "/api/admin/settings" && request.method === "GET") return adminSettings(request, env);
    if (url.pathname === "/api/admin/settings" && request.method === "PATCH") return updateSettings(request, env);
    if (url.pathname === "/api/admin/vow/diagnostics" && request.method === "GET") return vowDiagnostics(request, env);
    if (url.pathname === "/api/admin/vow/diagnostic-console" && request.method === "GET") return adminDiagnosticConsole();
    if (url.pathname === "/api/admin/vow/query-diagnostics" && request.method === "GET") return vowQueryDiagnostics(request, env);
    if (url.pathname === "/api/admin/media/diagnostics" && request.method === "GET") return mediaDiagnostics(request, env);
    if (url.pathname === "/api/admin/ai/diagnostics" && request.method === "GET") return aiDiagnostics(request, env);
    if (url.pathname === "/api/admin/automation/run" && request.method === "POST") return runAutomation(request, env);
    if (url.pathname.startsWith("/api/admin/reports/") && url.pathname.endsWith("/run") && request.method === "POST") return runSingleReport(request, env, url.pathname.split("/")[4]);
    if (url.pathname.startsWith("/api/admin/reports/") && url.pathname.endsWith("/test-email") && request.method === "POST") return runTestReportEmail(request, env, url.pathname.split("/")[4]);
    return worker_v10_default.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledNotifications(env));
  }
};
async function publicProperty(request, env, ctx) {
  const publicUrl = new URL(request.url);
  publicUrl.searchParams.set("mode", "public_snapshot");
  publicUrl.searchParams.set("snapshot_version", VERSION4);
  const cacheKey = new Request(publicUrl.toString(), { method: "GET" });
  const edgeCache = typeof caches !== "undefined" ? caches.default : null;
  const cached = edgeCache ? await edgeCache.match(cacheKey) : null;
  if (cached) return cached;
  let response = await worker_v10_default.fetch(new Request(publicUrl.toString(), { method: "GET", headers: request.headers }), env, ctx);
  let body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.property) return response;
  if (!body.property.forSale) {
    body.property.remarks = null;
    body.property.photos = [];
    body.property.photoCount = 0;
    if (body.property.details) delete body.property.details.listingOffice;
  }
  if (!body.property.schoolSummary?.name && env.VOW_AUDIT_SALT) {
    body.property.schoolResearchToken = await issueSchoolResearchToken(body.property.latitude, body.property.longitude, body.property.address, env);
  }
  delete body.property.latitude;
  delete body.property.longitude;
  applyVerifiedPropTxHistory(body.property);
  body.property.comparableContext = { available: false, matchCount: 0, confidence: "Available after request", basis: "Submit a showing or property-report request to receive the deeper AI-assisted analysis." };
  body.property.priceOpinion = { available: false, label: "Included in requested report", note: "The deeper value analysis is prepared after your request." };
  const result = json7(body, response.status, { "Cache-Control": "public, max-age=60, s-maxage=300" });
  if (response.status === 200 && edgeCache) ctx.waitUntil(edgeCache.put(cacheKey, result.clone()));
  return result;
}
__name(publicProperty, "publicProperty");
function applyVerifiedPropTxHistory(property2) {
  const key = String(property2?.address || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const verified = VERIFIED_PROPTX_HISTORY.get(key);
  if (!verified) return;
  const current = Number(property2.historySummary?.appearanceCount || 0);
  if (current >= verified.appearanceCount) return;
  property2.historySummary = {
    ...property2.historySummary || {},
    years: 10,
    appearanceCount: verified.appearanceCount,
    source: verified.source,
    verifiedLegacyListingKeys: verified.legacyListingKeys
  };
}
__name(applyVerifiedPropTxHistory, "applyVerifiedPropTxHistory");
async function schoolEnrichment(request, env) {
  const token = clean5(new URL(request.url).searchParams.get("token"), 2e3);
  const verified = await verifySchoolResearchToken(token, env);
  if (!verified.ok) return json7({ ok: false, error: "This school-research request is invalid or expired." }, 403);
  try {
    const coordinates = validCoordinate(verified.latitude, verified.longitude) ? verified : await resolveFreeCoordinates(verified.address);
    const schoolSummary = coordinates ? await findNearestFreeSchool(coordinates.latitude, coordinates.longitude) : null;
    return json7({ ok: true, schoolSummary: schoolSummary || null }, 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    console.log(JSON.stringify({ event: "school_enrichment_failed", error: clean5(error?.message || "Unknown error", 240) }));
    return json7({ ok: false, error: "School research is temporarily unavailable." }, 502);
  }
}
__name(schoolEnrichment, "schoolEnrichment");
async function issueSchoolResearchToken(latitude, longitude, address, env) {
  address = clean5(address, 300);
  if (!validCoordinate(latitude, longitude) && !address) return null;
  const expires = Math.floor(Date.now() / 1e3) + 300;
  const location = JSON.stringify({ latitude: validCoordinate(latitude, longitude) ? Number(latitude) : null, longitude: validCoordinate(latitude, longitude) ? Number(longitude) : null, address });
  const payload = `${expires}.${base64UrlEncode(location)}`;
  return `${payload}.${await hmacBase64Url(payload, env.VOW_AUDIT_SALT)}`;
}
__name(issueSchoolResearchToken, "issueSchoolResearchToken");
async function verifySchoolResearchToken(token, env) {
  if (!token || !env.VOW_AUDIT_SALT) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  const payload = `${parts[0]}.${parts[1]}`, expected = await hmacBase64Url(payload, env.VOW_AUDIT_SALT);
  if (!timingSafeEqual(parts[2], expected)) return { ok: false };
  const expires = Number(parts[0]);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1e3)) return { ok: false };
  try {
    const value = JSON.parse(base64UrlDecode(parts[1]));
    const latitude = Number(value?.latitude), longitude = Number(value?.longitude), address = clean5(value?.address, 300);
    return validCoordinate(latitude, longitude) || address ? { ok: true, latitude, longitude, address } : { ok: false };
  } catch {
    return { ok: false };
  }
}
__name(verifySchoolResearchToken, "verifySchoolResearchToken");
async function hmacBase64Url(value, secret) {
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey("raw", encoder.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
__name(hmacBase64Url, "hmacBase64Url");
function base64UrlEncode(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}
__name(base64UrlDecode, "base64UrlDecode");
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function validCoordinate(latitude, longitude) {
  latitude = Number(latitude);
  longitude = Number(longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 41 && latitude <= 57 && longitude >= -96 && longitude <= -74;
}
__name(validCoordinate, "validCoordinate");
async function resolveFreeCoordinates(address) {
  address = clean5(address, 300);
  if (!address) return null;
  const match = address.match(/^\s*(\d+[A-Za-z]?)\s+([^,]+)/);
  if (match) {
    const number = match[1].replace(/'/g, "''"), street = match[2].replace(/\b(?:street|st|road|rd|avenue|ave|drive|dr|boulevard|blvd|court|ct|crescent|cres|lane|ln|trail|trl|place|pl)\.?\b.*$/i, "").trim().replace(/'/g, "''");
    if (street) {
      const params = new URLSearchParams({ f: "json", where: `ADDRESS_NUMBER='${number}' AND upper(LINEAR_NAME_FULL) LIKE upper('${street}%')`, outFields: "LATITUDE,LONGITUDE", returnGeometry: "false", resultRecordCount: "1" });
      try {
        const response = await fetch(`https://gis.toronto.ca/arcgis/rest/services/cot_geospatial27/FeatureServer/101/query?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8e3) });
        const attrs = (await response.json().catch(() => null))?.features?.[0]?.attributes;
        if (validCoordinate(attrs?.LATITUDE, attrs?.LONGITUDE)) return { latitude: Number(attrs.LATITUDE), longitude: Number(attrs.LONGITUDE), source: "City of Toronto Address Points" };
      } catch {
      }
    }
  }
  try {
    const params = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "ca", q: address });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: "application/json", "User-Agent": "TorontoHouseMarket/1.0 (alireza.golestan@century21.ca)" }, signal: AbortSignal.timeout(8e3) });
    const first = (await response.json().catch(() => null))?.[0];
    if (validCoordinate(first?.lat, first?.lon)) return { latitude: Number(first.lat), longitude: Number(first.lon), source: "OpenStreetMap Nominatim" };
  } catch {
  }
  return null;
}
__name(resolveFreeCoordinates, "resolveFreeCoordinates");
async function findNearestFreeSchool(latitude, longitude) {
  if (!validCoordinate(latitude, longitude)) return null;
  const rounded = `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
  const cacheKey = new Request(`https://free-school-data.torontohousemarket.com/${rounded}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached?.ok) return cached.json().catch(() => null);
  const sources = [
    { url: "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial28/FeatureServer/17/query", official: true, fields: "NAME,SCHOOL_LEVEL,SCHOOL_TYPE,BOARD_NAME,SCHOOL_TYPE_DESC,ADDRESS_FULL,LATITUDE,LONGITUDE" },
    { url: "https://services.arcgis.com/AtfpSdJcsnQiIRhL/ArcGIS/rest/services/Toronto_Schools/FeatureServer/0/query", official: false, fields: "Name,School_Level,School_Type,Board_Name,School_Type_Desc,Address_Full,Latitude,Longitude" }
  ];
  let features = [], used = null;
  for (const source of sources) {
    const params = new URLSearchParams({ f: "json", where: "1=1", geometry: `${longitude},${latitude}`, geometryType: "esriGeometryPoint", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", distance: "5000", units: "esriSRUnit_Meter", outFields: source.fields, returnGeometry: "true", resultRecordCount: "250" });
    try {
      const response = await fetch(`${source.url}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8e3) });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (Array.isArray(payload?.features) && payload.features.length) {
        features = payload.features;
        used = source;
        break;
      }
    } catch {
    }
  }
  const candidates = features.map((feature) => normalizePublicSchool(feature, latitude, longitude)).filter(Boolean).sort((a, b) => a.distanceKm - b.distanceKm);
  const result = candidates[0] || null;
  if (!result) return null;
  result.source = used?.official ? "City of Toronto Open Data" : "Toronto public school-location dataset";
  if (cache) {
    const cachedResponse = json7(result, 200, { "Cache-Control": "public, max-age=2592000" });
    await cache.put(cacheKey, cachedResponse).catch(() => null);
  }
  return result;
}
__name(findNearestFreeSchool, "findNearestFreeSchool");
function normalizePublicSchool(feature, propertyLatitude, propertyLongitude) {
  const attributes = feature?.attributes;
  if (!attributes || typeof attributes !== "object") return null;
  const name = clean5(attributes.NAME || attributes.Name, 160);
  const latitude = Number(attributes.LATITUDE || attributes.Latitude || feature?.geometry?.y), longitude = Number(attributes.LONGITUDE || attributes.Longitude || feature?.geometry?.x);
  if (!name || !validCoordinate(latitude, longitude)) return null;
  const distanceKm = haversineKm(propertyLatitude, propertyLongitude, latitude, longitude);
  if (!Number.isFinite(distanceKm) || distanceKm > 5) return null;
  const board = clean5(attributes.BOARD_NAME || attributes.Board_Name, 160);
  const type = clean5(attributes.SCHOOL_TYPE_DESC || attributes.School_Type_Desc || attributes.SCHOOL_TYPE || attributes.School_Type, 100);
  if (!/(public|separate|district school board|conseil scolaire)/i.test(`${type} ${board}`)) return null;
  const level = clean5(attributes.SCHOOL_LEVEL || attributes.School_Level, 60);
  const address = clean5(attributes.ADDRESS_FULL || attributes.Address_Full, 180);
  return { name, board: board || null, type: type || null, level: level || null, address: address || null, distanceKm: Number(distanceKm.toFixed(1)), note: [`${distanceKm.toFixed(1)} km away`, board, type].filter(Boolean).join(" \xB7 ") + " \xB7 Closest geographically; confirm attendance boundaries with the school board.", rating: null };
}
__name(normalizePublicSchool, "normalizePublicSchool");
function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = /* @__PURE__ */ __name((value) => Number(value) * Math.PI / 180, "rad");
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
__name(haversineKm, "haversineKm");
function vowConfig(env) {
  return json7({ ok: true, enabled: env.VOW_ACCESS_ENABLED === "true" && !!env.AMPRE_VOW_TOKEN, termsVersion: vowTermsVersion(env), termsFinal: !vowTermsVersion(env).endsWith("-draft") });
}
__name(vowConfig, "vowConfig");
async function vowRegister(request, env) {
  const input = await request.json().catch(() => ({}));
  const email = clean5(input.email, 254).toLowerCase(), password = String(input.password || ""), fullName = clean5(input.full_name, 160), mobile = clean5(input.mobile, 50);
  if (!validEmail(email)) return json7({ ok: false, error: "Enter a valid email address." }, 400);
  if (password.length < 10) return json7({ ok: false, error: "Use a password with at least 10 characters." }, 400);
  if (fullName.length < 2 || mobile.replace(/\D/g, "").length < 7) return json7({ ok: false, error: "Enter your full name and a valid mobile number." }, 400);
  if (input.accept_terms !== true) return json7({ ok: false, error: "You must review and accept the VOW Terms of Use." }, 400);
  const endpoint = `${supabaseUrl(env)}/auth/v1/signup?redirect_to=${encodeURIComponent("https://torontohousemarket.com/vow.html")}`;
  const response = await fetch(endpoint, { method: "POST", headers: authApiHeaders(env), body: JSON.stringify({ email, password, data: { full_name: fullName, mobile, vow_terms_version: vowTermsVersion(env) } }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) return json7({ ok: false, error: clean5(data?.msg || data?.message || "Unable to create the account.", 240) }, response.status);
  const createdSession = publicSession(data?.session || data);
  return json7({ ok: true, needsEmailVerification: !createdSession, session: createdSession, message: createdSession ? "Account created." : "Check your email and verify the address, then sign in to activate VOW access." }, 201);
}
__name(vowRegister, "vowRegister");
async function vowLogin(request, env) {
  const input = await request.json().catch(() => ({})), email = clean5(input.email, 254).toLowerCase(), password = String(input.password || "");
  if (!validEmail(email) || !password) return json7({ ok: false, error: "Enter your email and password." }, 400);
  const response = await fetch(`${supabaseUrl(env)}/auth/v1/token?grant_type=password`, { method: "POST", headers: authApiHeaders(env), body: JSON.stringify({ email, password }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) return json7({ ok: false, error: clean5(data?.error_description || data?.msg || data?.message || "Unable to sign in.", 240) }, 401);
  return json7({ ok: true, session: publicSession(data) });
}
__name(vowLogin, "vowLogin");
async function vowLogout(request, env) {
  const token = bearerToken(request);
  if (token) await fetch(`${supabaseUrl(env)}/auth/v1/logout`, { method: "POST", headers: { ...authApiHeaders(env), Authorization: `Bearer ${token}` } }).catch(() => null);
  return json7({ ok: true });
}
__name(vowLogout, "vowLogout");
async function vowSession(request, env) {
  const user = await authenticatedUser(request, env);
  if (!user) return json7({ ok: false, error: "Sign in required." }, 401);
  const access = await currentVowAccess(request, env, { user, touch: false });
  return json7({ ok: true, user: { id: user.id, email: user.email, emailVerified: !!user.email_confirmed_at }, membership: access.member || null, termsVersion: vowTermsVersion(env), termsAccepted: access.ok, accessEnabled: env.VOW_ACCESS_ENABLED === "true" && !!env.AMPRE_VOW_TOKEN });
}
__name(vowSession, "vowSession");
async function vowAcceptTerms(request, env, ctx) {
  const user = await authenticatedUser(request, env);
  if (!user) return json7({ ok: false, error: "Sign in required." }, 401);
  if (!user.email_confirmed_at) return json7({ ok: false, error: "Verify your email address before accepting VOW access." }, 403);
  const input = await request.json().catch(() => ({})), fullName = clean5(input.full_name || user.user_metadata?.full_name, 160), mobile = clean5(input.mobile || user.user_metadata?.mobile, 50);
  if (input.accept_terms !== true || input.terms_version !== vowTermsVersion(env)) return json7({ ok: false, error: "Review and accept the current VOW Terms of Use." }, 400);
  if (fullName.length < 2 || mobile.replace(/\D/g, "").length < 7) return json7({ ok: false, error: "Full name and mobile number are required." }, 400);
  const now = (/* @__PURE__ */ new Date()).toISOString(), member = { user_id: user.id, email: String(user.email || "").toLowerCase(), full_name: fullName, mobile, status: "active", current_terms_version: vowTermsVersion(env), terms_accepted_at: now, email_verified_at: user.email_confirmed_at, updated_at: now };
  const saved = await supabase(env, "/rest/v1/vow_members?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(member) });
  if (!saved.ok) return json7({ ok: false, error: "Unable to save VOW membership." }, 502);
  const acceptance = { user_id: user.id, terms_version: vowTermsVersion(env), terms_digest: String(env.VOW_TERMS_DIGEST || "pending"), accepted_at: now, ip_hash: await requestIpHash(request, env), user_agent: clean5(request.headers.get("User-Agent"), 500) || null, source_url: clean5(input.source_url, 1e3) || null };
  const audit = await supabase(env, "/rest/v1/vow_terms_acceptances", { method: "POST", body: JSON.stringify(acceptance) });
  if (!audit.ok) return json7({ ok: false, error: "Unable to record VOW terms acceptance." }, 502);
  const linked = input.lead_id ? await linkLeadToVerifiedUser(env, input.lead_id, user) : false;
  if (linked) ctx.waitUntil(processAutomationJobs(env));
  return json7({ ok: true, membership: (await saved.json().catch(() => []))?.[0] || member });
}
__name(vowAcceptTerms, "vowAcceptTerms");
async function vowActivateRequest(request, env, ctx) {
  const user = await authenticatedUser(request, env);
  if (!user) return json7({ ok: false, error: "Sign in required." }, 401);
  if (!user.email_confirmed_at) return json7({ ok: false, error: "Verify your email address to continue." }, 403);
  const input = await request.json().catch(() => ({})), requestedId = /^[0-9a-f-]{36}$/i.test(String(input.lead_id || "")) ? String(input.lead_id) : null, email = String(user.email || "").toLowerCase();
  let query2 = `/rest/v1/pending_vow_acceptances?email=eq.${encodeURIComponent(email)}&activated_at=is.null&select=lead_id,email,full_name,mobile,terms_version,terms_digest,accepted_at,ip_hash,user_agent,source_url&order=accepted_at.asc&limit=20`;
  if (requestedId) query2 += `&lead_id=eq.${encodeURIComponent(requestedId)}`;
  const lookup = await supabase(env, query2), pending = await lookup.json().catch(() => []);
  if (!lookup.ok) return json7({ ok: false, error: "Unable to verify the pending property request." }, 502);
  const eligible = (Array.isArray(pending) ? pending : []).filter((x) => x.terms_version === vowTermsVersion(env));
  if (!eligible.length) {
    const access = await currentVowAccess(request, env, { user, touch: false });
    return json7({ ok: true, linked: 0, membership: access.member || null });
  }
  const first = eligible[0], now = (/* @__PURE__ */ new Date()).toISOString(), member = { user_id: user.id, email, full_name: first.full_name, mobile: first.mobile, status: "active", current_terms_version: first.terms_version, terms_accepted_at: first.accepted_at, email_verified_at: user.email_confirmed_at, updated_at: now };
  const saved = await supabase(env, "/rest/v1/vow_members?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(member) });
  if (!saved.ok) return json7({ ok: false, error: "Unable to activate VOW membership." }, 502);
  let linked = 0;
  for (const item of eligible) {
    const audit = await supabase(env, "/rest/v1/vow_terms_acceptances", { method: "POST", body: JSON.stringify({ user_id: user.id, terms_version: item.terms_version, terms_digest: item.terms_digest, accepted_at: item.accepted_at, ip_hash: item.ip_hash, user_agent: item.user_agent, source_url: item.source_url }) });
    if (!audit.ok) continue;
    if (await linkLeadToVerifiedUser(env, item.lead_id, user)) {
      await supabase(env, `/rest/v1/pending_vow_acceptances?lead_id=eq.${encodeURIComponent(item.lead_id)}`, { method: "PATCH", body: JSON.stringify({ activated_at: now, user_id: user.id }) });
      linked++;
    }
  }
  if (linked) ctx.waitUntil(processAutomationJobs(env));
  return json7({ ok: true, linked, membership: (await saved.json().catch(() => []))?.[0] || member });
}
__name(vowActivateRequest, "vowActivateRequest");
async function vowProperty(request, env, ctx) {
  const access = await currentVowAccess(request, env);
  if (!access.ok) return json7({ ok: false, error: access.error || "Active VOW membership required." }, access.status || 403);
  if (env.VOW_ACCESS_ENABLED !== "true" || !env.AMPRE_VOW_TOKEN) return json7({ ok: false, error: "Your VOW account is ready, but the PropTx VOW data token has not been activated yet." }, 503);
  const url = new URL(request.url);
  url.pathname = "/api/property";
  const vowEnv = { ...env, AMPRE_TOKEN: env.AMPRE_VOW_TOKEN };
  const response = await worker_v10_default.fetch(new Request(url.toString(), { method: "GET", headers: request.headers }), vowEnv, ctx);
  const body = await response.clone().json().catch(() => null);
  return body ? json7(body, response.status, { "Cache-Control": "private, no-store", "Vary": "Authorization" }) : response;
}
__name(vowProperty, "vowProperty");
async function authenticatedUser(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const response = await fetch(`${supabaseUrl(env)}/auth/v1/user`, { headers: { ...authApiHeaders(env), Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}
__name(authenticatedUser, "authenticatedUser");
async function currentVowAccess(request, env, options = {}) {
  const user = options.user || await authenticatedUser(request, env);
  if (!user) return { ok: false, status: 401, error: "Sign in required." };
  if (!user.email_confirmed_at) return { ok: false, status: 403, error: "Email verification required.", user };
  const response = await supabase(env, `/rest/v1/vow_members?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email,full_name,mobile,status,current_terms_version,terms_accepted_at,relationship_started_at&limit=1`), rows = await response.json().catch(() => []), member = Array.isArray(rows) ? rows[0] : null;
  if (!response.ok || !member) return { ok: false, status: 403, error: "Accept the current VOW Terms of Use to continue.", user, member: null };
  if (member.status !== "active") return { ok: false, status: 403, error: "This VOW membership is not active.", user, member };
  if (member.current_terms_version !== vowTermsVersion(env)) return { ok: false, status: 403, error: "The current VOW Terms of Use must be accepted.", user, member };
  if (options.touch !== false) await supabase(env, `/rest/v1/vow_members?user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ last_access_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }).catch(() => null);
  return { ok: true, user, member };
}
__name(currentVowAccess, "currentVowAccess");
async function linkLeadToVerifiedUser(env, leadId, user) {
  if (!/^[0-9a-f-]{36}$/i.test(String(leadId)) || !user?.id || !user?.email) return false;
  const lookup = await supabase(env, `/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=id,email&limit=1`), rows = await lookup.json().catch(() => []), lead = Array.isArray(rows) ? rows[0] : null;
  if (!lookup.ok || !lead || String(lead.email || "").toLowerCase() !== String(user.email).toLowerCase()) return false;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const linked = await supabase(env, `/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, { method: "PATCH", body: JSON.stringify({ vow_user_id: user.id, updated_at: now }) });
  if (!linked.ok) return false;
  await supabase(env, `/rest/v1/automation_jobs?lead_id=eq.${encodeURIComponent(leadId)}&job_type=eq.generate_report`, { method: "PATCH", body: JSON.stringify({ status: "queued", attempts: 0, available_at: now, locked_at: null, last_error: null, updated_at: now }) }).catch(() => null);
  await supabase(env, `/rest/v1/property_reports?lead_id=eq.${encodeURIComponent(leadId)}`, { method: "PATCH", body: JSON.stringify({ status: "queued", error_message: null, updated_at: now }) }).catch(() => null);
  return true;
}
__name(linkLeadToVerifiedUser, "linkLeadToVerifiedUser");
function supabaseUrl(env) {
  return env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co";
}
__name(supabaseUrl, "supabaseUrl");
function authApiHeaders(env) {
  return { "Content-Type": "application/json", apikey: String(env.SUPABASE_PUBLISHABLE_KEY || "") };
}
__name(authApiHeaders, "authApiHeaders");
function bearerToken(request) {
  return clean5(String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), 4096);
}
__name(bearerToken, "bearerToken");
function publicSession(value) {
  return value?.access_token ? { access_token: value.access_token, refresh_token: value.refresh_token, expires_in: value.expires_in, expires_at: value.expires_at, token_type: value.token_type, user: value.user ? { id: value.user.id, email: value.user.email, email_confirmed_at: value.user.email_confirmed_at } : null } : null;
}
__name(publicSession, "publicSession");
function vowTermsVersion(env) {
  return String(env.VOW_TERMS_VERSION || "2026-08-27-draft");
}
__name(vowTermsVersion, "vowTermsVersion");
async function requestIpHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP"), salt = env.VOW_AUDIT_SALT;
  if (!ip || !salt) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(bytes)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(requestIpHash, "requestIpHash");
function authorized(request, env) {
  const expected = String(env.ADMIN_API_KEY || "");
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return expected.length >= 24 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
__name(authorized, "authorized");
async function vowDiagnostics(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!env.AMPRE_VOW_TOKEN) return json7({ ok: false, configured: false, error: "AMPRE_VOW_TOKEN is not configured." }, 503);
  const probeUrl = new URL("https://torontohousemarket.com/api/property");
  const input = new URL(request.url).searchParams;
  const listingKey = clean5(input.get("listingKey"), 40).toUpperCase();
  if (/^[A-Z]\d{7,9}$/.test(listingKey)) probeUrl.searchParams.set("listingKey", listingKey);
  else probeUrl.searchParams.set("q", clean5(input.get("q") || "297 Derrydown Road, Toronto, ON", 500));
  const response = await worker_v10_default.fetch(new Request(probeUrl.toString(), { method: "GET" }), { ...env, AMPRE_TOKEN: env.AMPRE_VOW_TOKEN }, { waitUntil() {
  } });
  const body = await response.json().catch(() => null), property2 = body?.property || null, comparables = property2?.comparableContext?.comparables || property2?.comparables || [];
  return json7({
    ok: response.ok && !!property2,
    configured: true,
    upstreamStatus: response.status,
    propertyResolved: !!property2,
    listingStatus: clean5(property2?.status || property2?.standardStatus, 80) || null,
    soldComparableCount: Array.isArray(comparables) ? comparables.length : 0,
    comparableAvailable: property2?.comparableContext?.available === true,
    subject: property2 ? { listingKey: property2.listingKey || null, propertySubType: property2.propertySubType || null, community: property2.cityRegion || null } : null,
    policy: property2?.comparableContext?.policy || null,
    retrievalDiagnostics: property2?.comparableContext?.diagnostics || null,
    selectedComparables: (Array.isArray(comparables) ? comparables : []).map((row) => ({ listingKey: row.listingKey || null, community: row.cityRegion || null, distanceKm: row.distanceKm ?? null, soldDate: row.soldDate || null })),
    error: response.ok ? null : clean5(body?.error || body?.message || "VOW feed probe failed.", 240)
  }, response.ok ? 200 : 502, { "Cache-Control": "private, no-store" });
}
__name(vowDiagnostics, "vowDiagnostics");
async function vowQueryDiagnostics(request, env) {
  if (!authorizedDiagnostic(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!env.AMPRE_VOW_TOKEN) return json7({ ok: false, error: "AMPRE_VOW_TOKEN is not configured." }, 503);
  const input = new URL(request.url).searchParams;
  const subtype = clean5(input.get("subtype") || "Detached", 80).replaceAll("'", "''");
  const region = clean5(input.get("region") || "Bayview Woods-Steeles", 120).replaceAll("'", "''");
  const city = clean5(input.get("city") || "Toronto", 80).replaceAll("'", "''");
  const shapes = [
    { name: "sold_only", filter: "ClosePrice gt 0", orderby: "PurchaseContractDate desc" },
    { name: "city_sold", filter: `contains(UnparsedAddress,'${city}') and ClosePrice gt 0`, orderby: "PurchaseContractDate desc" },
    { name: "region_contains_sold", filter: `contains(CityRegion,'${region}') and ClosePrice gt 0`, orderby: "PurchaseContractDate desc" },
    { name: "subtype_contains_sold", filter: `contains(PropertySubType,'${subtype}') and ClosePrice gt 0`, orderby: "PurchaseContractDate desc" },
    { name: "region_subtype_sold", filter: `contains(CityRegion,'${region}') and contains(PropertySubType,'${subtype}') and ClosePrice gt 0`, orderby: "PurchaseContractDate desc" }
  ];
  const inspect = /* @__PURE__ */ __name(async (shape) => {
    const params = new URLSearchParams({ "$top": "5", "$filter": shape.filter, "$orderby": shape.orderby });
    try {
      const response = await fetch(`https://query.ampre.ca/odata/Property?${params}`, { headers: { Authorization: `Bearer ${env.AMPRE_VOW_TOKEN}`, Accept: "application/json" }, signal: AbortSignal.timeout(8e3) });
      const payload = await response.json().catch(() => null), rows = Array.isArray(payload?.value) ? payload.value : [];
      return { name: shape.name, status: response.status, count: rows.length, error: response.ok ? null : clean5(payload?.error?.message || payload?.message || "Query rejected.", 200), fields: rows[0] ? Object.keys(rows[0]).sort() : [] };
    } catch (error) {
      return { name: shape.name, status: 0, count: 0, error: String(error).slice(0, 200), fields: [] };
    }
  }, "inspect");
  return json7({ ok: true, subtype, region, city, probes: await Promise.all(shapes.map(inspect)) }, 200, { "Cache-Control": "private, no-store" });
}
__name(vowQueryDiagnostics, "vowQueryDiagnostics");
async function mediaDiagnostics(request, env) {
  if (!authorizedDiagnostic(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const listingKey = clean5(new URL(request.url).searchParams.get("listingKey"), 50).toUpperCase();
  if (!/^[A-Z]\d{7,9}$/.test(listingKey)) return json7({ ok: false, error: "Valid MLS listingKey required." }, 400);
  const inspect = /* @__PURE__ */ __name(async (token) => {
    if (!token) return { configured: false };
    const params = new URLSearchParams({ "$top": "100", "$filter": `contains(ResourceRecordKey,'${listingKey}')` });
    const response = await fetch(`https://query.ampre.ca/odata/Media?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const payload = await response.json().catch(() => null), rows = Array.isArray(payload?.value) ? payload.value : [];
    const exact = rows.filter((row) => String(row?.ResourceRecordKey || "").toUpperCase() === listingKey);
    return { status: response.status, count: exact.length, records: exact.map(mediaDiagnosticRecord) };
  }, "inspect");
  const [publicFeed, vowFeed] = await Promise.all([inspect(env.AMPRE_TOKEN), inspect(env.AMPRE_VOW_TOKEN)]);
  return json7({ ok: true, listingKey, publicFeed, vowFeed }, 200, { "Cache-Control": "private, no-store" });
}
__name(mediaDiagnostics, "mediaDiagnostics");
function authorizedDiagnostic(request, env) {
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return [env.ADMIN_API_KEY, env.AGENT_API_KEY].some((value) => {
    const expected = String(value || "");
    return expected.length >= 24 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
__name(authorizedDiagnostic, "authorizedDiagnostic");
async function aiDiagnostics(request, env) {
  if (!authorizedDiagnostic(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const started = Date.now(), result = await generateAiNarrative(env, { address: "Toronto test property", status: "For Sale", list_price: 75e4, property_type: "Residential", beds: 3, baths: 2 }, { available: false, basis: "Public IDX diagnostic contains no sold-price evidence." }, [], { remarks: "Diagnostic only. No customer or private information.", showingFocus: { title: "Condition and layout", note: "Verify material facts in person." } });
  return result ? json7({ ok: true, provider: result.provider, model: result.model, fallback_used: result.fallback_used, latency_ms: Date.now() - started, schema_valid: validNarrative(result.narrative) }) : json7({ ok: false, error: "All configured AI providers failed.", latency_ms: Date.now() - started }, 503);
}
__name(aiDiagnostics, "aiDiagnostics");
function mediaDiagnosticRecord(row) {
  const fields = ["MediaKey", "ResourceRecordKey", "ResourceName", "ImageSizeDescription", "Order", "MediaOrder", "ImageOf", "MediaSequence", "SequenceNumber", "PhotoNumber", "MediaIndex", "SortOrder", "PreferredPhotoYN", "PrimaryPhotoYN", "IsPrimary", "MainPhotoYN", "ShortDescription", "LongDescription"];
  const result = {};
  for (const field of fields) if (row?.[field] !== void 0) result[field] = row[field];
  result.availableFields = Object.keys(row || {}).sort();
  return result;
}
__name(mediaDiagnosticRecord, "mediaDiagnosticRecord");
async function adminLeads(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json7({ ok: false, error: "Admin database connection is not configured." }, 503);
  const select = "id,name,mobile,email,lead_mode,status,stage,next_action,next_action_at,first_response_due_at,resolved_address,showing_timing,created_at,updated_at,metadata,vow_user_id,agents(id,code,display_name,email,mobile),property_reports(id,status,report_payload,generated_at,updated_at,error_message),automation_jobs(id,job_type,status,recipient,attempts,available_at,completed_at,last_error)";
  const propertySearch = clean5(new URL(request.url).searchParams.get("property"), 120);
  const response = await supabase(env, `/rest/v1/leads?select=${encodeURIComponent(select)}&order=created_at.desc&limit=${propertySearch ? 1e3 : 100}`);
  let data = await response.json().catch(() => null);
  if (response.ok && propertySearch && Array.isArray(data)) {
    const needle = normalizeText(propertySearch);
    data = data.filter((lead) => {
      const metadata = lead?.metadata || {};
      const text = normalizeText([lead?.resolved_address, metadata?.resolved_address, metadata?.property_input, metadata?.listing_key, metadata?.listingKey, metadata?.property_snapshot?.address, metadata?.property_snapshot?.listingKey].filter(Boolean).join(" "));
      return text.includes(needle) || /\bE13689546\b/i.test(text);
    }).slice(0, 20);
  }
  return response.ok ? json7({ ok: true, leads: data }) : json7({ ok: false, error: "Unable to load leads." }, 502);
}
__name(adminLeads, "adminLeads");
async function updateLead(request, env, id, ctx) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json7({ ok: false, error: "Invalid lead." }, 400);
  const input = await request.json().catch(() => ({}));
  if ("owner_agent_id" in input) {
    if (!/^[0-9a-f-]{36}$/i.test(String(input.owner_agent_id || ""))) return json7({ ok: false, error: "Choose a valid agent." }, 400);
    const assigned = await supabase(env, "/rest/v1/rpc/assign_lead_to_agent", { method: "POST", body: JSON.stringify({ p_lead_id: id, p_agent_id: input.owner_agent_id }) });
    const result = await assigned.json().catch(() => null);
    if (!assigned.ok) return json7({ ok: false, error: databaseMessage(result, "Unable to assign this lead.") }, 409);
  }
  const allowedStatus = ["new", "contacted", "appointment_pending", "appointment_confirmed", "closed", "lost"];
  const body = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (allowedStatus.includes(input.status)) body.status = input.status;
  if (typeof input.stage === "string" && input.stage.length <= 80) body.stage = input.stage;
  if (typeof input.next_action === "string" && input.next_action.length <= 120) body.next_action = input.next_action;
  const response = await supabase(env, `/rest/v1/leads?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (response.ok) ctx.waitUntil(processAutomationJobs(env));
  return response.ok ? json7({ ok: true, lead: Array.isArray(data) ? data[0] : data }) : json7({ ok: false, error: "Unable to update lead." }, 502);
}
__name(updateLead, "updateLead");
async function runAutomation(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!env.RESEND_API_KEY) return json7({ ok: false, error: "Resend is not configured." }, 503);
  const result = await runScheduledNotifications(env);
  return json7({ ok: true, ...result });
}
__name(runAutomation, "runAutomation");
async function runSingleReport(request, env, leadId) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(String(leadId || ""))) return json7({ ok: false, error: "Invalid lead." }, 400);
  const lead = await loadLeadForReport(env, leadId);
  if (!lead) return json7({ ok: false, error: "Lead data is unavailable." }, 404);
  const response = await supabase(env, `/rest/v1/automation_jobs?lead_id=eq.${leadId}&job_type=eq.generate_report&select=id,report_id,status&order=id.desc&limit=1`), rows = await response.json().catch(() => []), job = Array.isArray(rows) ? rows[0] : null;
  if (!response.ok || !job?.report_id) return json7({ ok: false, error: "Report job is unavailable." }, 404);
  try {
    const property2 = await loadPropertyForReport(env, lead), report = await buildPropertyReport(env, lead, property2);
    if (job.status !== "processing") await supabase(env, `/rest/v1/automation_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ status: "processing", locked_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    await rpc(env, "complete_report_job", { p_job_id: job.id, p_report_id: job.report_id, p_report_payload: report });
    return json7({ ok: true, lead_id: leadId, report_id: job.report_id, list_price: report.facts?.list_price || null, data_pipeline: report.data_pipeline || null, value_rating: report.value_rating || null });
  } catch (error) {
    return json7({ ok: false, error: clean5(error?.message || "Report generation failed.", 300) }, 502);
  }
}
__name(runSingleReport, "runSingleReport");
async function runTestReportEmail(request, env, leadId) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(String(leadId || ""))) return json7({ ok: false, error: "Invalid lead." }, 400);
  if (!env.RESEND_API_KEY) return json7({ ok: false, error: "Resend is not configured." }, 503);
  const lead = await loadLeadForReport(env, leadId);
  if (!lead || !validEmail(String(lead.email || ""))) return json7({ ok: false, error: "A valid buyer email is required." }, 404);
  const reportResponse = await supabase(env, `/rest/v1/property_reports?lead_id=eq.${leadId}&select=id&limit=1`);
  const reportRows = await reportResponse.json().catch(() => []), reportRow = Array.isArray(reportRows) ? reportRows[0] : null;
  if (!reportResponse.ok || !reportRow?.id) return json7({ ok: false, error: "Report record is unavailable." }, 404);
  let emailJob = null;
  try {
    const requestId = `admin-test-${crypto.randomUUID()}`;
    const property2 = await loadPropertyForReport(env, lead, requestId);
    const report = await buildPropertyReport(env, lead, property2, requestId);
    const saved = await supabase(env, `/rest/v1/property_reports?id=eq.${reportRow.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "ready", report_payload: report, generated_at: (/* @__PURE__ */ new Date()).toISOString(), error_message: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    if (!saved.ok) throw new Error("Unable to save the fresh test report.");
    const inserted = await supabase(env, "/rest/v1/automation_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ lead_id: leadId, report_id: reportRow.id, job_type: "email_buyer", recipient: String(lead.email).toLowerCase(), status: "processing", attempts: 1, locked_at: (/* @__PURE__ */ new Date()).toISOString(), payload: { reason: "admin_test_report", request_id: requestId } }) });
    const insertedRows = await inserted.json().catch(() => []);
    emailJob = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    if (!inserted.ok || !emailJob?.id) throw new Error("Unable to create the isolated test email job.");
    await deliverEmailJob(env, emailJob);
    const statusResponse = await supabase(env, `/rest/v1/automation_jobs?id=eq.${emailJob.id}&select=id,status,completed_at,last_error&limit=1`), statusRows = await statusResponse.json().catch(() => []), finalJob = Array.isArray(statusRows) ? statusRows[0] : null;
    return json7({ ok: finalJob?.status === "sent", lead_id: leadId, report_id: reportRow.id, email_job: finalJob || { id: emailJob.id, status: "unknown" }, comparable_count: Array.isArray(report.comparables) ? report.comparables.length : 0, comparable_communities: [...new Set((report.comparables || []).map((row) => row.cityRegion).filter(Boolean))], valuation_available: report.valuation?.available === true, confidence: report.valuation?.confidence || "Unavailable" }, finalJob?.status === "sent" ? 200 : 502);
  } catch (error) {
    if (emailJob?.id) await rpc(env, "fail_email_job", { p_job_id: emailJob.id, p_error: clean5(error?.message || "Test report email failed.", 300) }).catch(() => null);
    return json7({ ok: false, error: clean5(error?.message || "Test report email failed.", 300) }, 502);
  }
}
__name(runTestReportEmail, "runTestReportEmail");
function adminDiagnosticConsole() {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>THM VOW Diagnostics</title><style>body{font:16px system-ui;max-width:820px;margin:40px auto;padding:0 18px;color:#111827}input,button,select{font:inherit;padding:11px;margin:5px 0}input{width:min(520px,90%)}button{cursor:pointer;background:#3155f5;color:#fff;border:0;border-radius:8px}button.danger{background:#9f1239}pre{white-space:pre-wrap;background:#f3f4f6;padding:16px;border-radius:10px}small{color:#64748b}</style></head><body><h1>Protected comparable diagnostics</h1><p>Read-only diagnostics use the licensed VOW feed. The test-email action regenerates one selected existing report and creates exactly one isolated email job.</p><label>Admin API key<br><input id="key" type="password" autocomplete="current-password"></label><p><button id="load">Load 494 Donlands test lead</button></p><select id="lead"><option value="">Load a matching lead first</option></select><p><button id="diagnose">Run read-only comparable diagnostic</button> <button class="danger" id="send">Generate + send one test report</button></p><small>The send action does not run the general automation queue.</small><pre id="out">Ready.</pre><script>const key=document.getElementById('key'),out=document.getElementById('out'),lead=document.getElementById('lead');async function api(path,options={}){const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+key.value.trim(),'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error||'Request failed');return body}document.getElementById('load').onclick=async()=>{try{const body=await api('/api/admin/leads?property=494%20Donlands');const matches=body.leads||[];lead.replaceChildren();for(const x of matches){const option=document.createElement('option');option.value=x.id;option.textContent='494 Donlands · '+String(x.email||'no email')+' · '+x.id.slice(0,8);lead.append(option)}if(!matches.length){const option=document.createElement('option');option.textContent='No matching lead';lead.append(option)}out.textContent=JSON.stringify({matchingLeads:matches.length},null,2)}catch(e){out.textContent=e.message}};document.getElementById('diagnose').onclick=async()=>{try{out.textContent=JSON.stringify(await api('/api/admin/vow/diagnostics?listingKey=E13689546'),null,2)}catch(e){out.textContent=e.message}};document.getElementById('send').onclick=async()=>{if(!lead.value){out.textContent='Load and select a lead first.';return}try{out.textContent='Generating…';out.textContent=JSON.stringify(await api('/api/admin/reports/'+lead.value+'/test-email',{method:'POST',body:'{}'}),null,2)}catch(e){out.textContent=e.message}};</script></body></html>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" } });
}
__name(adminDiagnosticConsole, "adminDiagnosticConsole");
async function adminSettings(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const response = await supabase(env, "/rest/v1/app_settings?select=key,value&key=in.(owner_notification_email,assignment_method,first_response_sla_minutes,service_hours)"), rows = await response.json().catch(() => null);
  if (!response.ok) return json7({ ok: false, error: "Unable to load settings." }, 502);
  return json7({ ok: true, settings: Object.fromEntries((rows || []).map((x) => [x.key, x.value])) });
}
__name(adminSettings, "adminSettings");
async function updateSettings(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const input = await request.json().catch(() => ({})), email = clean5(input.owner_notification_email, 254).toLowerCase();
  if (!email || !validEmail(email)) return json7({ ok: false, error: "Enter a valid notification email." }, 400);
  const response = await supabase(env, "/rest/v1/app_settings?key=eq.owner_notification_email", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ value: email, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }), data = await response.json().catch(() => null);
  return response.ok ? json7({ ok: true, setting: Array.isArray(data) ? data[0] : data }) : json7({ ok: false, error: "Unable to save notification email." }, 502);
}
__name(updateSettings, "updateSettings");
async function adminAgents(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const response = await supabase(env, "/rest/v1/agents?select=id,code,display_name,email,mobile,active,assignment_order,created_at,updated_at&order=assignment_order.asc");
  const data = await response.json().catch(() => null);
  return response.ok ? json7({ ok: true, agents: data }) : json7({ ok: false, error: "Unable to load agents." }, 502);
}
__name(adminAgents, "adminAgents");
async function createAgent(request, env) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  const input = await request.json().catch(() => ({}));
  const displayName = clean5(input.display_name, 120), email = clean5(input.email, 254).toLowerCase() || null, mobile = clean5(input.mobile, 50) || null;
  if (displayName.length < 2) return json7({ ok: false, error: "Agent name is required." }, 400);
  if (email && !validEmail(email)) return json7({ ok: false, error: "Enter a valid email." }, 400);
  const list = await supabase(env, "/rest/v1/agents?select=code,assignment_order&order=assignment_order.asc"), agents = await list.json().catch(() => []);
  if (!list.ok) return json7({ ok: false, error: "Unable to prepare the agent record." }, 502);
  const codes = new Set(agents.map((a) => a.code));
  let base = slug(displayName) || "agent", code = base, n = 2;
  while (codes.has(code)) code = `${base}_${n++}`;
  const order = Math.max(0, ...agents.map((a) => Number(a.assignment_order) || 0)) + 1;
  const response = await supabase(env, "/rest/v1/agents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ code, display_name: displayName, email, mobile, active: input.active !== false, assignment_order: order }) });
  const data = await response.json().catch(() => null);
  return response.ok ? json7({ ok: true, agent: Array.isArray(data) ? data[0] : data }, 201) : json7({ ok: false, error: databaseMessage(data, "Unable to add agent.") }, 409);
}
__name(createAgent, "createAgent");
async function updateAgent(request, env, id) {
  if (!authorized(request, env)) return json7({ ok: false, error: "Unauthorized" }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json7({ ok: false, error: "Invalid agent." }, 400);
  const input = await request.json().catch(() => ({})), body = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if ("display_name" in input) {
    const v = clean5(input.display_name, 120);
    if (v.length < 2) return json7({ ok: false, error: "Agent name is required." }, 400);
    body.display_name = v;
  }
  if ("email" in input) {
    const v = clean5(input.email, 254).toLowerCase();
    if (v && !validEmail(v)) return json7({ ok: false, error: "Enter a valid email." }, 400);
    body.email = v || null;
  }
  if ("mobile" in input) body.mobile = clean5(input.mobile, 50) || null;
  if (Number.isInteger(Number(input.assignment_order)) && Number(input.assignment_order) > 0) body.assignment_order = Number(input.assignment_order);
  if (typeof input.active === "boolean") {
    if (!input.active) {
      const ar = await supabase(env, "/rest/v1/agents?select=id&active=eq.true"), active2 = await ar.json().catch(() => []);
      if (active2.length <= 1 && active2.some((a) => a.id === id)) return json7({ ok: false, error: "At least one agent must remain active." }, 409);
    }
    body.active = input.active;
  }
  const response = await supabase(env, `/rest/v1/agents?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }), data = await response.json().catch(() => null);
  return response.ok ? json7({ ok: true, agent: Array.isArray(data) ? data[0] : data }) : json7({ ok: false, error: databaseMessage(data, "Unable to update agent.") }, 409);
}
__name(updateAgent, "updateAgent");
function supabase(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co"}${path}`, { ...init, headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...init.headers || {} } });
}
__name(supabase, "supabase");
async function runScheduledNotifications(env) {
  await rpc(env, "queue_overdue_sla_notifications", {}).catch((error) => console.error(JSON.stringify({ event: "sla_queue_failed", error: String(error) })));
  return processAutomationJobs(env);
}
__name(runScheduledNotifications, "runScheduledNotifications");
async function processAutomationJobs(env) {
  const reports = await processReportJobs(env, 3);
  const emails = await processEmailJobs(env, 20);
  return { reports, emails };
}
__name(processAutomationJobs, "processAutomationJobs");
async function processReportJobs(env, limit = 3) {
  const jobs = await rpc(env, "claim_report_jobs", { p_limit: limit });
  let completed = 0, failed = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const requestId = `report-job-${job.id}`;
    diagnosticLog("log", "report_generation_status", { request_id: requestId, report_id: job.report_id, job_id: job.id, report_generation_status: "started" });
    try {
      const lead = await loadLeadForReport(env, job.lead_id);
      if (!lead) throw new Error("Lead data is unavailable.");
      const property2 = await loadPropertyForReport(env, lead, requestId);
      const report = await buildPropertyReport(env, lead, property2, requestId);
      await rpc(env, "complete_report_job", { p_job_id: job.id, p_report_id: job.report_id, p_report_payload: report });
      completed++;
      diagnosticLog("log", "report_generation_status", { request_id: requestId, report_id: job.report_id, job_id: job.id, report_generation_status: "ready", confidence: report.valuation?.confidence || "Unavailable" });
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      await rpc(env, "fail_report_job", { p_job_id: job.id, p_report_id: job.report_id, p_error: message }).catch(() => {
      });
      diagnosticLog("error", "report_generation_status", { request_id: requestId, report_id: job.report_id, job_id: job.id, report_generation_status: "failed", error_category: diagnosticErrorCategory(error) });
    }
  }
  return { claimed: Array.isArray(jobs) ? jobs.length : 0, completed, failed };
}
__name(processReportJobs, "processReportJobs");
async function loadLeadForReport(env, id) {
  const select = "id,name,email,lead_mode,resolved_address,showing_timing,property_snapshot,metadata,created_at,vow_user_id";
  const response = await supabase(env, `/rest/v1/leads?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`), rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Unable to load report request.");
  return Array.isArray(rows) ? rows[0] : null;
}
__name(loadLeadForReport, "loadLeadForReport");
async function loadPropertyForReport(env, lead, requestId = null) {
  const url = new URL("https://torontohousemarket.com/api/property");
  const capturedSnapshot = Object.keys(lead.property_snapshot || {}).length ? lead.property_snapshot : lead.metadata?.property_snapshot || {};
  const listingKey = capturedSnapshot?.listingKey || lead.metadata?.listing_key || lead.metadata?.listingKey || null;
  if (listingKey) url.searchParams.set("listingKey", listingKey);
  else url.searchParams.set("q", lead.resolved_address || lead.metadata?.property_input || "");
  if (!env.AMPRE_VOW_TOKEN) throw new Error("Protected report data is not configured.");
  const publicUrl = new URL(url);
  publicUrl.searchParams.set("mode", "public_snapshot");
  const protectedUrl = new URL("https://torontohousemarket.com/api/property");
  if (listingKey) protectedUrl.searchParams.set("listingKey", listingKey);
  else protectedUrl.searchParams.set("q", lead.resolved_address || lead.metadata?.resolved_address || capturedSnapshot?.address || lead.metadata?.property_input || "");
  protectedUrl.searchParams.set("mode", "report_evidence");
  const [idxResponse, vowResponse] = await Promise.all([
    worker_v10_default.fetch(new Request(publicUrl.toString(), { method: "GET", headers: { "X-THM-Request-Id": requestId || crypto.randomUUID() } }), env, { waitUntil() {
    } }),
    worker_v10_default.fetch(new Request(protectedUrl.toString(), { method: "GET", headers: { "X-THM-Request-Id": requestId || crypto.randomUUID() } }), { ...env, AMPRE_TOKEN: env.AMPRE_VOW_TOKEN }, { waitUntil() {
    } })
  ]);
  const [idxBody, vowBody] = await Promise.all([idxResponse.json().catch(() => null), vowResponse.json().catch(() => null)]);
  if (!vowResponse.ok || !vowBody?.ok || !vowBody.property) throw new Error(vowBody?.error || "Protected VOW property evidence could not be resolved.");
  if (!idxResponse.ok || !idxBody?.ok || !idxBody.property) {
    if (Object.keys(capturedSnapshot || {}).length) return mergeCurrentIdxWithVow(capturedSnapshot, vowBody.property, "captured_idx_snapshot");
    return { ...vowBody.property, reportDataPipeline: { subjectFacts: "vow_fallback", protectedEvidence: "vow_credential", merged: false } };
  }
  return mergeCurrentIdxWithVow(idxBody.property, vowBody.property);
}
__name(loadPropertyForReport, "loadPropertyForReport");
function mergeCurrentIdxWithVow(currentProperty, protectedProperty, subjectSource = "current_idx") {
  const current = currentProperty && typeof currentProperty === "object" ? currentProperty : {};
  const protectedData = protectedProperty && typeof protectedProperty === "object" ? protectedProperty : {};
  return {
    ...protectedData,
    ...current,
    comparableContext: protectedData.comparableContext || null,
    historySummary: protectedData.historySummary || current.historySummary || null,
    reportDataPipeline: { subjectFacts: subjectSource, protectedEvidence: "vow_credential", merged: true }
  };
}
__name(mergeCurrentIdxWithVow, "mergeCurrentIdxWithVow");
async function buildPropertyReport(env, lead, property2, requestId = null) {
  const comp = property2.comparableContext || {};
  const comparables = Array.isArray(comp.comparables) ? comp.comparables.slice(0, 5) : [];
  const soldTimes = comparables.map((c) => Date.parse(c.soldDate || "")).filter(Number.isFinite), newestSold = soldTimes.length ? new Date(Math.max(...soldTimes)) : null;
  const evidenceAgeDays = newestSold ? Math.max(0, Math.round((Date.now() - newestSold.getTime()) / 864e5)) : null;
  const evidenceRecency = evidenceAgeDays == null ? "Unknown" : evidenceAgeDays <= 180 ? "Within 6 months" : evidenceAgeDays <= 365 ? "Within 12 months" : evidenceAgeDays <= 540 ? "12\u201318 months old" : "More than 18 months old";
  const facts = {
    address: property2.address || lead.resolved_address || lead.property_input,
    status: property2.marketStatus || property2.status || "Unknown",
    neighbourhood: property2.cityRegion || null,
    list_price: property2.listPrice || null,
    property_type: property2.propertySubType || property2.propertyType || null,
    beds: property2.beds ?? null,
    baths: property2.baths ?? null,
    living_area: property2.livingAreaRange || property2.buildingAreaTotal || null,
    lot: property2.lotWidth && property2.lotDepth ? `${property2.lotWidth} \xD7 ${property2.lotDepth} ft` : null,
    parking: property2.parkingTotal ?? null,
    annual_tax: property2.details?.annualTax || null,
    tax_year: property2.details?.taxYear || null,
    basement: Array.isArray(property2.basement) ? property2.basement.join(" \xB7 ") : property2.basement || null,
    garage: property2.garageType || null,
    heating: property2.details?.heating || null,
    cooling: property2.details?.cooling || null,
    parking_features: property2.details?.parking || null,
    interior_features: property2.details?.interior || null,
    pool: property2.details?.pool || null,
    cross_street: property2.details?.crossStreet || null,
    days_on_market: property2.daysLive ?? null,
    offer_timing: property2.offerTiming || null,
    closest_school: property2.schoolSummary?.name || null
  };
  const valuation = {
    available: !!comp.available,
    low: comp.rangeLow || null,
    midpoint: comp.midpoint || null,
    high: comp.rangeHigh || null,
    confidence: evidenceAgeDays != null && evidenceAgeDays > 540 && comp.available ? "Low" : comp.confidence || "Unavailable",
    basis: `${comp.basis || "The protected feed did not return enough reliable sold matches to calculate a responsible range."}${newestSold ? ` \xB7 newest sold evidence ${newestSold.toISOString().slice(0, 10)}` : ""}`,
    methodology: `Sold AMPRE/PropTx records must match the exact property subtype. The nearest qualifying sales are prioritized from the last ${comp.policy?.windowDays || 100} days, then scored for bedrooms, bathrooms, living area, lot and parking.`,
    evidence_recency: evidenceRecency,
    newest_sold_date: newestSold ? newestSold.toISOString().slice(0, 10) : null
  };
  const publicResearch = !valuation.available ? await generatePublicResearch(env, { address: facts.address, property_type: facts.property_type, neighbourhood: facts.neighbourhood }).catch((error) => {
    console.warn(JSON.stringify({ event: "public_research_fallback", lead_id: lead.id, error: String(error).slice(0, 240) }));
    return null;
  }) : null;
  const fallback = buildDeterministicNarrative(facts, valuation, comparables, property2);
  const ai = await generateAiNarrative(env, facts, valuation, comparables, property2, publicResearch, requestId).catch((error) => {
    diagnosticLog("warn", "ai_narrative_diagnostic", { request_id: requestId, provider: "deterministic_fallback", model: null, provider_latency_ms: null, fallback_used: true, schema_validation_result: "not_run", error_category: diagnosticErrorCategory(error) });
    return null;
  });
  if (!ai) diagnosticLog("warn", "ai_narrative_diagnostic", { request_id: requestId, provider: "deterministic_fallback", model: null, provider_latency_ms: null, fallback_used: true, schema_validation_result: "not_available", error_category: "providers_exhausted" });
  const narrative = groundReportNarrative(ai?.narrative || fallback, facts, valuation, comparables, comp.policy || {});
  const valueRating = buildValueRating(facts, valuation, comp.policy || {}, comparables.length);
  return {
    schema_version: 4,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    report_type: "THM AI buyer intelligence brief",
    prompt_version: String(env.PROPERTY_REPORT_PROMPT_VERSION || "vow-ai-v1"),
    ai_generation: ai ? { provider: ai.provider, model: ai.model, fallback_used: ai.fallback_used, web_grounded: !!ai.web_grounded } : null,
    research_sources: Array.isArray(ai?.sources) ? ai.sources.slice(0, 6) : [],
    facts,
    valuation,
    value_rating: valueRating,
    comparables,
    comparable_policy: comp.policy || { windowDays: 300, expandedWindow: true, exactSubtype: true, priceTolerancePct: 10 },
    evidence_audit: comp.diagnostics || null,
    data_pipeline: property2.reportDataPipeline || null,
    narrative,
    history: property2.historySummary || null,
    showing_focus: property2.showingFocus || null,
    sources: [
      { name: "AMPRE / PropTx", role: "Licensed listing facts, listing history and protected recent sold comparables used after the property request", url: "https://www.ampre.ca/" },
      { name: "City of Toronto Open Data", role: "Municipal context and datasets; property-specific verification may be required", url: "https://open.toronto.ca/" },
      { name: "Statistics Canada", role: "Census and demographic context", url: "https://www.statcan.gc.ca/" },
      { name: "CMHC", role: "Broader housing-market and mortgage context", url: "https://www.cmhc-schl.gc.ca/" },
      { name: "Toronto District School Board", role: "Official school information and attendance-boundary verification", url: "https://www.tdsb.on.ca/" }
    ],
    limitations: [
      "This is an AI-assisted preliminary market analysis, not an appraisal or guarantee of market value.",
      "MLS facts and sold records should be verified by a registered real estate professional before relying on them.",
      "School boundaries, permits, zoning, taxes, environmental conditions and measurements require verification with the responsible authority.",
      "Realtor.ca, HouseSigma and other consumer portals are not scraped; they may be incorporated only through an authorized licensed feed."
    ]
  };
}
__name(buildPropertyReport, "buildPropertyReport");
async function generateAiNarrative(env, facts, valuation, comparables, property2, publicResearch = null, requestId = null) {
  const system = "You are a careful Toronto real-estate research analyst. Ground every statement in the supplied licensed evidence. Never invent sold prices, comparable sales, taxes, measurements, schools, permits, zoning, distances, history or neighbourhood statistics. Do not call this an appraisal. Return JSON only.";
  const prompt = `Return an object with string fields executive_summary, market_read, buyer_strategy and string arrays strengths, risks, inspection_priorities, questions_for_realtor. Write like a sharp buyer adviser, not a generic property brochure. The executive summary must give a direct 30-second read in no more than 55 words and mention two or three distinctive supplied property facts. The market read and buyer strategy must each be no more than 70 words. Keep every bullet concrete, property-specific and under 18 words; omit filler such as "verify all facts". Use the listing remarks to identify specific benefits, maintenance questions and potentially expensive uncertainties, but label listing claims as reported rather than independently proven. If sold evidence is unavailable, use the separately supplied public research only for public property, school, transit, development and neighbourhood context. Do not use consumer-site sold prices, asking prices or web estimates as comparable evidence, and never create a price range or value score from public research. Do not spend the whole report repeating the sold-data limitation: give a useful property-and-showing analysis, then state once that price requires fresh licensed sold evidence. Every claim must be traceable to the supplied facts, remarks, comparable rows or public research. Never infer a neighbourhood price range, market trend, demand level, renovation cost or recent-sale pattern unless that exact licensed evidence is supplied. Explain the valuation range and strongest comparable evidence when available. Do not call sold evidence recent when the newest sold date is more than 12 months old. If the verified facts contain bedrooms or bathrooms, never describe the subject as vacant land or a vacant lot. Use concise, warm Canadian English written to help a serious buyer decide whether to book a showing and speak with the assigned Realtor.

Evidence supplied to the report writer:
${JSON.stringify({ licensed: { facts, valuation, comparables, listing_remarks: property2.remarks, showing_focus: property2.showingFocus, history: property2.historySummary }, public_research: publicResearch?.text || null }).slice(0, 18e3)}`;
  const attempts = [
    { provider: "gemini", model: String(env.GEMINI_MODEL || "gemini-2.5-flash"), run: /* @__PURE__ */ __name(() => generateWithGemini(env, system, prompt), "run") },
    { provider: "openrouter", model: String(env.OPENROUTER_MODEL || "openrouter/free"), run: /* @__PURE__ */ __name(() => generateWithOpenRouter(env, system, prompt), "run") },
    { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fast", run: /* @__PURE__ */ __name(() => generateWithCloudflare(env, system, prompt), "run") }
  ];
  let firstFailure = false;
  for (const attempt of attempts) {
    const startedAt = Date.now();
    try {
      const result = await attempt.run(), parsed = parseJsonObject(result.text), narrative = sanitizeNarrative(parsed);
      if (!validNarrative(narrative)) throw new Error("AI response did not match the report schema.");
      if ((Number(facts?.beds) > 0 || Number(facts?.baths) > 0) && /\bvacant[ -](?:lot|land)\b/i.test(JSON.stringify(narrative))) throw new Error("AI response contradicted the verified subject-property type.");
      diagnosticLog("log", "ai_narrative_diagnostic", { request_id: requestId, provider: attempt.provider, model: result.model || attempt.model, provider_latency_ms: Date.now() - startedAt, fallback_used: firstFailure, schema_validation_result: "valid", error_category: null });
      return { narrative, provider: attempt.provider, model: result.model || attempt.model, fallback_used: firstFailure, web_grounded: !!publicResearch, sources: publicResearch?.sources || [] };
    } catch (error) {
      firstFailure = true;
      diagnosticLog("warn", "ai_narrative_diagnostic", { request_id: requestId, provider: attempt.provider, model: attempt.model, provider_latency_ms: Date.now() - startedAt, fallback_used: true, schema_validation_result: diagnosticErrorCategory(error) === "schema_validation" ? "invalid" : "not_available", error_category: diagnosticErrorCategory(error) });
    }
  }
  return null;
}
__name(generateAiNarrative, "generateAiNarrative");
function diagnosticErrorCategory(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (/abort|timed out|timeout/.test(message)) return "timeout";
  if (/not configured/.test(message)) return "not_configured";
  if (/schema|json|parse/.test(message)) return "schema_validation";
  if (/contradict/.test(message)) return "content_validation";
  if (/\b(?:400|401|403|404|408|409|422|429|500|502|503|504)\b/.test(message)) return "provider_http_error";
  return "unexpected_error";
}
__name(diagnosticErrorCategory, "diagnosticErrorCategory");
function groundReportNarrative(narrative, facts, valuation, comparables, policy = {}) {
  const grounded = { ...narrative };
  const region = clean5(facts.neighbourhood, 120);
  const regionMatches = region ? comparables.filter((c) => clean5(c.cityRegion, 120).toLowerCase() === region.toLowerCase()).length : 0;
  const range = valuation.available ? `${cad(valuation.low)} - ${cad(valuation.high)}` : "unavailable";
  const newest = valuation.newest_sold_date || "unknown";
  const geography = !comparables.length ? "Current exact-type sold evidence was not sufficient for an automated rating." : region ? regionMatches ? `${regionMatches} of ${comparables.length} supplied matches are in ${region}.` : `None of the ${comparables.length} supplied matches is in ${region}.` : "The supplied matches should be checked for neighbourhood fit.";
  if (valuation.available) {
    grounded.market_read = `The ${range} evidence band is based on ${comparables.length} supplied sold matches. ${geography} The newest sold record is dated ${newest}.${policy.expandedWindow ? " An expanded " + (policy.windowDays || 300) + "-day evidence window was required." : ""} ${valuation.confidence === "Low" ? "Treat this as a broad screening signal, not a current value conclusion." : "Use the closest match as the starting point, then adjust for condition and micro-location."}`;
  } else {
    grounded.market_read = `No responsible sold-price band was produced from the supplied match set. ${geography}${policy.expandedWindow ? " The search was expanded to " + (policy.windowDays || 300) + " days." : ""} Ask for a manual local comparable review before discussing value.`;
  }
  if (valuation.confidence === "Low") {
    grounded.buyer_strategy = `Tour the property for fit, condition and any permit-related opportunity. Before discussing price, ask the assigned Realtor for at least three ${region || "nearby"} sold properties from the last 6-12 months and an explanation of the closest match.`;
    grounded.risks = [
      `The evidence band is Low confidence; newest sold record is ${newest}`,
      region && regionMatches === 0 ? `No supplied comparable is in ${region}` : "Supplied matches require a closer location check",
      ...Array.isArray(narrative.risks) ? narrative.risks.filter((x) => !/market|trend|demand|costly|renovation cost/i.test(x)) : []
    ].filter(Boolean).slice(0, 3);
  }
  return grounded;
}
__name(groundReportNarrative, "groundReportNarrative");
function buildValueRating(facts, valuation, policy, matchCount) {
  if (!valuation.available) return { available: false, score: null, label: "Realtor review", indicator: "REVIEW", reason: "Current exact-type nearby sold evidence was not sufficient for an automated rating.", windowDays: policy.windowDays || 300 };
  const ask = Number(facts.list_price), low = Number(valuation.low), mid = Number(valuation.midpoint), high = Number(valuation.high);
  if (![ask, low, mid, high].every(Number.isFinite)) return { available: false, score: null, label: "Realtor review", indicator: "REVIEW", reason: "A complete asking-price comparison was not available.", windowDays: policy.windowDays || 100 };
  let score;
  if (ask <= low) score = 8.8;
  else if (ask <= mid) score = 8.8 - (ask - low) / Math.max(1, mid - low) * 1.6;
  else if (ask <= high) score = 7.2 - (ask - mid) / Math.max(1, high - mid) * 2;
  else score = 5.2 - Math.min(3.2, (ask - high) / Math.max(1, high) * 12);
  if ((policy.windowDays || 100) > 100) score -= 0.6;
  if (Number(policy.farthestKm) > 5) score -= 0.5;
  if (matchCount >= 5 && Number(policy.farthestKm) <= 2) score += 0.3;
  score = Math.round(Math.max(1, Math.min(9.5, score)) * 10) / 10;
  const label = score >= 8.5 ? "Strong value" : score >= 7 ? "Good value" : score >= 5.5 ? "Fairly priced" : score >= 4 ? "Price needs support" : "Caution";
  const indicator = score >= 7 ? "POSITIVE" : score >= 5.5 ? "NEUTRAL" : score >= 4 ? "REVIEW" : "CAUTION";
  const reason = ask < mid ? `The asking price is below the sold-evidence midpoint of ${cad(mid)}.` : ask <= high ? `The asking price is above the midpoint but remains inside the sold-evidence range.` : `The asking price is above the sold-evidence high of ${cad(high)}.`;
  return { available: true, score, label, indicator, reason, windowDays: policy.windowDays || 100, expandedWindow: (policy.windowDays || 100) > 100 };
}
__name(buildValueRating, "buildValueRating");
function buildBuyerReadScore(facts, narrative = {}) {
  let score = 5;
  if (facts.property_type) score += 0.5;
  if (facts.beds != null && facts.baths != null) score += 0.6;
  if (facts.lot || facts.living_area) score += 0.5;
  if (facts.parking != null || facts.garage) score += 0.4;
  if (facts.days_on_market != null) score += 0.3;
  if (facts.offer_timing?.label) score += 0.4;
  if (facts.closest_school) score += 0.3;
  if (Array.isArray(narrative.strengths) && narrative.strengths.length >= 2) score += 0.4;
  if (Array.isArray(narrative.inspection_priorities) && narrative.inspection_priorities.length >= 2) score += 0.4;
  return Math.min(8.8, Math.round(score * 10) / 10).toFixed(1);
}
__name(buildBuyerReadScore, "buildBuyerReadScore");
async function generatePublicResearch(env, property2) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured.");
  const model = String(env.GEMINI_MODEL || "gemini-2.5-flash"), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e3);
  const prompt = `Research current, publicly available buyer context for this publicly listed property: ${JSON.stringify(property2)}. Focus only on official or trustworthy sources for nearby schools and attendance caveats, transit, parks/trails, road or development context, and practical location considerations. Do not search for, quote or summarize sold prices, asking prices, valuations, estimates, owner information or private facts. Return a concise factual brief under 450 words. Clearly distinguish verified public facts from listing claims.`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify({ model, input: prompt, store: false, tools: [{ type: "google_search" }], generation_config: { max_output_tokens: 1e3 } }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Gemini research ${response.status}: ${clean5(data?.error?.message || "request failed", 180)}`);
    const textBlocks = (data?.steps || []).filter((x) => x?.type === "model_output").flatMap((x) => x?.content || []).filter((x) => x?.type === "text");
    const text = textBlocks.map((x) => x?.text || "").join("\n").trim();
    const sources = [...new Map(textBlocks.flatMap((block) => Array.isArray(block?.annotations) ? block.annotations : []).filter((item) => item?.type === "url_citation" && /^https:\/\//i.test(String(item?.url || ""))).map((item) => [item.url, { url: item.url, title: clean5(item.title || String(item.url).replace(/^https?:\/\//, "").split("/")[0], 180) }])).values()];
    if (!text) throw new Error("Gemini returned no public research.");
    return { text: text.slice(0, 5e3), sources: sources.slice(0, 8), model: data?.model || model };
  } finally {
    clearTimeout(timer);
  }
}
__name(generatePublicResearch, "generatePublicResearch");
async function generateWithGemini(env, system, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured.");
  const model = String(env.GEMINI_MODEL || "gemini-2.5-flash"), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e3);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify({ model, input: prompt, system_instruction: system, store: false, generation_config: { max_output_tokens: 2e3 }, response_format: { type: "text", mime_type: "application/json", schema: narrativeJsonSchema() } }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${clean5(data?.error?.message || "request failed", 180)}`);
    const text = (data?.steps || []).filter((x) => x?.type === "model_output").flatMap((x) => x?.content || []).filter((x) => x?.type === "text").map((x) => x?.text || "").join("");
    if (!text) throw new Error("Gemini returned no report text.");
    return { text, model: data?.model || model };
  } finally {
    clearTimeout(timer);
  }
}
__name(generateWithGemini, "generateWithGemini");
async function generateWithOpenRouter(env, system, prompt) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OpenRouter is not configured.");
  const model = String(env.OPENROUTER_MODEL || "openrouter/free"), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e3);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "HTTP-Referer": "https://torontohousemarket.com", "X-Title": "Toronto House Market" }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 2e3, response_format: { type: "json_schema", json_schema: { name: "property_report_narrative", strict: true, schema: narrativeJsonSchema() } } }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${clean5(data?.error?.message || "request failed", 180)}`);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) throw new Error("OpenRouter returned no report text.");
    return { text, model: data?.model || model };
  } finally {
    clearTimeout(timer);
  }
}
__name(generateWithOpenRouter, "generateWithOpenRouter");
async function generateWithCloudflare(env, system, prompt) {
  if (!env.AI?.run) throw new Error("Cloudflare AI is not configured.");
  const model = "@cf/meta/llama-3.1-8b-instruct-fast";
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Cloudflare AI timed out.")), 2e3);
  });
  const result = await Promise.race([env.AI.run(model, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: 2e3, temperature: 0.2 }), timeout]).finally(() => clearTimeout(timer));
  const text = typeof result?.response === "string" ? result.response : typeof result === "string" ? result : "";
  if (!text) throw new Error("Cloudflare AI returned no report text.");
  return { text, model };
}
__name(generateWithCloudflare, "generateWithCloudflare");
function narrativeJsonSchema() {
  const sentence = { type: "string" }, list = { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 };
  return { type: "object", additionalProperties: false, properties: { executive_summary: sentence, market_read: sentence, buyer_strategy: sentence, strengths: list, risks: list, inspection_priorities: list, questions_for_realtor: list }, required: ["executive_summary", "market_read", "buyer_strategy", "strengths", "risks", "inspection_priorities", "questions_for_realtor"] };
}
__name(narrativeJsonSchema, "narrativeJsonSchema");
function buildDeterministicNarrative(facts, valuation, comparables, property2) {
  const range = valuation.available ? `${cad(valuation.low)}\u2013${cad(valuation.high)} (${valuation.confidence.toLowerCase()} confidence)` : "not available from the current reliable match set";
  const strengths = [];
  if (facts.parking) strengths.push(`${facts.parking} parking space${facts.parking === 1 ? "" : "s"} reported`);
  if (facts.lot) strengths.push(`Reported lot of ${facts.lot}`);
  if (property2.details?.cooling) strengths.push("Cooling information is present in the MLS record");
  return {
    executive_summary: `${facts.address} is reported as ${facts.status.toLowerCase()}. The evidence-based market range is ${range}. This preliminary read should be reviewed with a Realtor against condition, renovations and micro-location.`,
    market_read: valuation.available ? `${comparables.length} recent sold MLS comparables support the range. The estimate emphasizes similarity and recency and reduces the effect of outliers.` : valuation.basis,
    buyer_strategy: facts.list_price && valuation.available ? `Compare the ${cad(facts.list_price)} asking price with the weighted midpoint of ${cad(valuation.midpoint)}, then adjust only after inspecting condition and confirming offer timing.` : "Inspect the property and verify material facts before deciding on price or conditions.",
    strengths: strengths.length ? strengths : ["Authorized public IDX listing facts were reviewed"],
    risks: ["Interior condition and renovation quality are not proven by MLS data", "Measurements, taxes, permits and zoning require independent verification"],
    inspection_priorities: [property2.showingFocus?.note || "Verify layout, condition, mechanical systems, water signs and exterior drainage.", "Ask about age and service history of roof, HVAC, plumbing and electrical systems."],
    questions_for_realtor: ["Which sold comparable is most similar after condition adjustments?", "Are there registered offers or a scheduled offer presentation?", "Which listing facts or improvements still require documentation?"]
  };
}
__name(buildDeterministicNarrative, "buildDeterministicNarrative");
function parseJsonObject(value) {
  try {
    const text = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}
__name(parseJsonObject, "parseJsonObject");
function sanitizeNarrative(v) {
  const strings = /* @__PURE__ */ __name((k) => clean5(v?.[k], 2400), "strings"), list = /* @__PURE__ */ __name((k) => Array.isArray(v?.[k]) ? v[k].map((x) => clean5(String(x), 500)).filter(Boolean).slice(0, 6) : [], "list");
  return { executive_summary: strings("executive_summary"), market_read: strings("market_read"), buyer_strategy: strings("buyer_strategy"), strengths: list("strengths"), risks: list("risks"), inspection_priorities: list("inspection_priorities"), questions_for_realtor: list("questions_for_realtor") };
}
__name(sanitizeNarrative, "sanitizeNarrative");
function validNarrative(v) {
  return !!(v?.executive_summary && v?.market_read && v?.buyer_strategy && v.strengths?.length && v.risks?.length && v.inspection_priorities?.length && v.questions_for_realtor?.length);
}
__name(validNarrative, "validNarrative");
async function processEmailJobs(env, limit = 10) {
  if (!env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0, skipped: "missing_resend_key" };
  const jobs = await rpc(env, "claim_email_jobs", { p_limit: limit });
  let sent = 0, failed = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try {
      const result = await deliverEmailJob(env, job);
      sent++;
      console.log(JSON.stringify({ event: "email_sent", job_id: job.id, lead_id: job.lead_id, type: job.job_type, provider_id: result.id || null }));
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      await rpc(env, "fail_email_job", { p_job_id: job.id, p_error: message }).catch(() => {
      });
      console.error(JSON.stringify({ event: "email_failed", job_id: job.id, lead_id: job.lead_id, error: message.slice(0, 300) }));
    }
  }
  return { claimed: Array.isArray(jobs) ? jobs.length : 0, sent, failed };
}
__name(processEmailJobs, "processEmailJobs");
async function deliverEmailJob(env, job) {
  const lead = await loadLeadForEmail(env, job.lead_id);
  if (!lead) throw new Error("Lead data is unavailable.");
  if (job.job_type === "email_buyer") {
    const report = firstRelation(lead.property_reports);
    if (report?.status !== "ready") throw new Error("Buyer report held until report generation is complete.");
  }
  const message = buildEmail(job, lead);
  const sendPayload = { from: env.RESEND_FROM_EMAIL || "Alireza Golestan | Toronto House Market <notifications@updates.torontohousemarket.com>", to: [job.recipient], reply_to: "alireza.golestan@century21.ca", subject: message.subject, html: message.html, text: message.text };
  if (Array.isArray(message.attachments) && message.attachments.length) sendPayload.attachments = message.attachments;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `thm-job-${job.id}-v1` }, body: JSON.stringify(sendPayload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend ${response.status}: ${clean5(result?.message || result?.name || "delivery rejected", 300)}`);
  await rpc(env, "complete_email_job", { p_job_id: job.id, p_provider_id: String(result.id || "") });
  return result;
}
__name(deliverEmailJob, "deliverEmailJob");
async function loadLeadForEmail(env, id) {
  const select = "id,name,mobile,email,status,stage,showing_timing,first_response_due_at,resolved_address,metadata,agents(id,display_name,email,mobile),property_reports(status,report_payload,generated_at)";
  const response = await supabase(env, `/rest/v1/leads?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`), rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Unable to load notification details.");
  return Array.isArray(rows) ? rows[0] : null;
}
__name(loadLeadForEmail, "loadLeadForEmail");
function buildEmail(job, lead) {
  const reason = String(job.payload?.reason || job.job_type), address = lead.resolved_address || lead.metadata?.resolved_address || lead.metadata?.property_input || "Property request", agent = lead.agents?.display_name || "Unassigned", timing = timingLabel(lead.showing_timing), due = formatToronto(lead.first_response_due_at);
  let subject = "Toronto House Market update", heading = "Lead update", intro = "There is an update on this property request.", rows = [];
  if (reason === "new_lead_admin_alert") {
    subject = `New lead: ${address}`;
    heading = "New property lead";
    intro = "A new request is waiting for administrator assignment.";
    rows = [["Buyer", lead.name], ["Mobile", lead.mobile], ["Email", lead.email], ["Requested time", timing]];
  } else if (reason === "buyer_request_confirmation") {
    subject = job.payload?.vow_action_link ? `Verify your email to start the report for ${address}` : `We received your request for ${address}`;
    heading = job.payload?.vow_action_link ? "Verify your email to start your report" : "Your request is received";
    intro = job.payload?.vow_action_link ? "Your property request is saved. Click the secure verification link below; your protected AI report will then start automatically." : "Thank you. An administrator will assign the right Realtor, who will contact you to confirm the next step.";
    rows = [["Property", address], ["Requested time", timing]];
  } else if (reason === "admin_assignment" || job.job_type === "notify_agent" && reason !== "agent_sla_reminder") {
    subject = `New lead assigned: ${address}`;
    heading = "A lead has been assigned to you";
    intro = "Please contact the buyer and update the lead status in the administrator dashboard.";
    rows = [["Buyer", lead.name], ["Mobile", lead.mobile], ["Email", lead.email], ["Requested time", timing], ["Response due", due]];
  } else if (reason === "owner_assignment_confirmation") {
    subject = `Lead assigned to ${agent}: ${address}`;
    heading = "Assignment confirmed";
    intro = "The selected agent has been notified and the response timer has started.";
    rows = [["Agent", agent], ["Buyer", lead.name], ["Response due", due]];
  } else if (reason === "agent_reassignment_removed") {
    subject = `Lead reassigned: ${address}`;
    heading = "This lead was reassigned";
    intro = "You are no longer responsible for this property lead.";
    rows = [["Property", address], ["Buyer", lead.name]];
  } else if (reason === "owner_sla_overdue") {
    subject = `OVERDUE lead response: ${address}`;
    heading = "Five-minute response target missed";
    intro = "This assigned lead still appears new and requires administrator attention.";
    rows = [["Agent", agent], ["Buyer", lead.name], ["Response was due", due]];
  } else if (reason === "agent_sla_reminder") {
    subject = `Action required: response overdue for ${address}`;
    heading = "Lead response is overdue";
    intro = "Please contact the buyer immediately and update the lead status.";
    rows = [["Buyer", lead.name], ["Mobile", lead.mobile], ["Email", lead.email]];
  } else if (reason === "buyer_appointment_confirmed") {
    subject = `Showing update for ${address}`;
    heading = "Your appointment is confirmed";
    intro = "Your Realtor has updated the showing request as confirmed. They will provide the final appointment details directly.";
    rows = [["Property", address], ["Agent", agent]];
  } else if (reason === "owner_status_update") {
    subject = `Lead status: ${String(job.payload?.status || lead.status).replaceAll("_", " ")} \u2014 ${address}`;
    heading = "Lead status updated";
    intro = "An important lead milestone was recorded.";
    rows = [["Status", String(job.payload?.status || lead.status).replaceAll("_", " ")], ["Agent", agent], ["Buyer", lead.name]];
  } else if (job.job_type === "email_buyer") return propertyReportEmail(address, lead.agents || { display_name: agent }, firstRelation(lead.property_reports)?.report_payload || {});
  else {
    rows = [["Property", address], ["Buyer", lead.name], ["Status", lead.status]];
  }
  const link = reason === "buyer_request_confirmation" && job.payload?.vow_action_link ? job.payload.vow_action_link : reason.startsWith("buyer_") || job.job_type === "email_buyer" ? null : "https://torontohousemarket.com/admin.html";
  return emailDocument(subject, heading, intro, rows, link, reason === "buyer_request_confirmation" ? "Verify email and start report" : "Open lead dashboard");
}
__name(buildEmail, "buildEmail");
function propertyReportEmail(address, agentData, report) {
  const agent = agentData?.display_name || "your assigned Realtor", agentEmail = clean5(agentData?.email, 254), agentMobile = clean5(agentData?.mobile, 50);
  const v = report.valuation || {}, n = report.narrative || {}, facts = report.facts || {}, history = report.history || {}, policy = report.comparable_policy || {}, comps = Array.isArray(report.comparables) ? report.comparables.slice(0, 5) : [];
  const research = Array.isArray(report.research_sources) ? report.research_sources.filter((source) => /^https:\/\//i.test(String(source?.url || ""))).slice(0, 4) : [];
  const rating = report.value_rating || buildValueRating(facts, v, policy, comps.length);
  const briefScore = buildBuyerReadScore(facts, n);
  const range = v.available ? `${cad(v.low)} - ${cad(v.high)}` : "Needs Realtor review";
  const ask = Number(facts.list_price), low = Number(v.low), high = Number(v.high), mid = Number(v.midpoint);
  let verdict = "Price needs a local evidence check", verdictReason = "The current sold set is not strong enough for a responsible price conclusion.";
  if (v.available && policy.expandedWindow) {
    verdict = "Do not anchor to this range yet";
    verdictReason = `The ${range} band is a screening signal only. The newest supplied sold record is ${v.newest_sold_date || "not recent"}; ask for fresher, closer sales before deciding on price.`;
  } else if (v.available && Number.isFinite(ask) && Number.isFinite(high) && ask > high) {
    const gap = ask - high, pct = high > 0 ? Math.round(gap / high * 100) : null;
    verdict = "Asking price is above the evidence band";
    verdictReason = `The ask is ${cad(gap)}${pct != null ? ` (${pct}%)` : ""} above the current high end. Condition or location must justify the premium.`;
  } else if (v.available && Number.isFinite(ask) && Number.isFinite(low) && ask < low) {
    verdict = "Asking price is below the evidence band";
    verdictReason = "That can create value, but first confirm condition, legal use and any reason for the discount.";
  } else if (v.available) {
    verdict = "Asking price sits inside the evidence band";
    verdictReason = `The weighted midpoint is ${cad(mid) || "unavailable"}. Final positioning still depends on condition and the closest local sale.`;
  }
  let moveSignal = "SHOWING FIRST", moveTitle = "Test the expensive questions in person", moveNote = "Use the showing to verify condition, renovations and layout. The price check continues separately with fresh sold evidence.";
  if (rating.available && rating.score >= 8.5) {
    moveSignal = "STRONG VALUE SIGNAL";
    moveTitle = "Worth moving quickly to the showing";
    moveNote = "Verify condition and the closest sold matches before treating the rating as an offer recommendation.";
  } else if (rating.available && rating.score >= 7) {
    moveSignal = "POSITIVE VALUE SIGNAL";
    moveTitle = "Worth serious consideration";
    moveNote = "The price evidence is encouraging. Use the showing to test whether condition supports it.";
  } else if (rating.available && rating.score >= 5.5) {
    moveSignal = "BALANCED";
    moveTitle = "Inspect first, then decide on price";
    moveNote = "The asking price is broadly supported, but condition and feature differences will determine the real value.";
  } else if (rating.available && rating.score >= 4) {
    moveSignal = "NEGOTIATION SIGNAL";
    moveTitle = "The price needs stronger support";
    moveNote = "Focus on the closest sold homes and any condition gap before discussing an offer.";
  } else if (rating.available) {
    moveSignal = "CAUTION";
    moveTitle = "Do not chase the asking price";
    moveNote = "The current price appears difficult to support from the selected evidence. Verify why before proceeding.";
  }
  const roomLabel = facts.beds != null && facts.baths != null ? `${facts.beds} bed / ${facts.baths} bath` : facts.beds != null ? `${facts.beds} bed` : facts.baths != null ? `${facts.baths} bath` : null;
  const context = [facts.property_type, roomLabel, facts.neighbourhood, facts.living_area, facts.lot ? `${facts.lot} lot` : null].filter(Boolean).map(html).join(" &nbsp;|&nbsp; ");
  const topComps = comps.slice(0, 3);
  const compsHtml = topComps.length ? topComps.map((c, i) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e7eaf0"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:12px"><p style="margin:0;color:#151b2b;font:700 14px Arial,sans-serif;line-height:1.35">${i + 1}. ${html(c.address || "MLS comparable")}</p><p style="margin:5px 0 0;color:#798196;font:400 11px Arial,sans-serif;line-height:1.4">${html([c.soldDate, c.distanceKm != null ? `${Number(c.distanceKm).toFixed(2)} km away` : null, c.cityRegion, c.beds != null ? `${c.beds} bd` : null, c.baths != null ? `${c.baths} ba` : null, c.lotWidth && c.lotDepth ? `${c.lotWidth} x ${c.lotDepth} ft lot` : null].filter(Boolean).join(" | "))}</p></td><td align="right" width="126" style="white-space:nowrap"><p style="margin:0;color:#151b2b;font:800 15px Arial,sans-serif">${html(cad(c.soldPrice) || "-")}</p><p style="margin:5px 0 0;color:#3155f5;font:700 11px Arial,sans-serif">${html(Math.round(Number(c.similarity) || 0))}% property match</p></td></tr></table></td></tr>`).join("") : `<tr><td style="padding:15px 0;color:#687286;font:400 13px Arial,sans-serif">Current sold evidence was not sufficient for an automated rating. Ask ${html(agent)} for a local comparable review.</td></tr>`;
  const compactBullets = /* @__PURE__ */ __name((items, tone) => Array.isArray(items) && items.length ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${items.slice(0, 3).map((x) => `<tr><td width="18" valign="top" style="padding:4px 0;color:${tone};font:800 13px Arial,sans-serif">&#8226;</td><td style="padding:4px 0;color:${tone === "#c9b577" ? "#dce2ee" : "#4e586d"};font:400 13px Arial,sans-serif;line-height:1.45">${html(x)}</td></tr>`).join("")}</table>` : "", "compactBullets");
  const questionsHtml = Array.isArray(n.questions_for_realtor) && n.questions_for_realtor.length ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:#f7f8fb;border-left:4px solid #3155f5"><tr><td style="padding:18px"><p style="margin:0 0 8px;color:#3155f5;font:800 10px Arial,sans-serif;letter-spacing:1px">3 QUESTIONS THAT COULD CHANGE THE DECISION</p>${compactBullets(n.questions_for_realtor, "#3155f5")}</td></tr></table>` : "";
  const researchHtml = research.length ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:#f7f8fb"><tr><td style="padding:14px"><p style="margin:0 0 7px;color:#3155f5;font:800 9px Arial,sans-serif;letter-spacing:1px">LIVE PUBLIC RESEARCH</p>${research.map((source) => `<p style="margin:5px 0;color:#687286;font:400 10px Arial,sans-serif"><a href="${html(source.url)}" style="color:#3155f5">${html(source.title || source.url)}</a></p>`).join("")}<p style="margin:8px 0 0;color:#8991a2;font:400 9px Arial,sans-serif;line-height:1.45">Public research adds context only; it does not replace licensed sold evidence.</p></td></tr></table>` : "";
  const contactHref = agentMobile ? `tel:${agentMobile.replace(/[^+\d]/g, "")}` : agentEmail ? `mailto:${agentEmail}` : "https://torontohousemarket.com";
  const historyText = history.appearanceCount ? `${history.appearanceCount} MLS appearance${history.appearanceCount === 1 ? "" : "s"} in the last ${history.years || 10} years; latest recorded status ${history.lastStatus || "unknown"}${history.latestSold ? `; last sold ${cad(history.latestSold.price)} on ${history.latestSold.date}` : ""}.` : "No reliable subject-property sale history was returned in the current licensed record set.";
  const offerLabel = facts.offer_timing?.label || "Confirm with listing side";
  const smartFacts = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td width="50%" valign="top" style="padding:14px;background:#f7f8fb;border-right:5px solid #fff"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">MARKET TIMING</p><p style="margin:0;color:#151b2b;font:800 15px Arial,sans-serif">${html(facts.days_on_market != null ? `${facts.days_on_market} days live` : "Confirm DOM")}</p></td><td width="50%" valign="top" style="padding:14px;background:#f7f8fb"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">OFFER TIMING</p><p style="margin:0;color:#151b2b;font:800 15px Arial,sans-serif;line-height:1.25">${html(offerLabel)}</p></td></tr><tr><td width="50%" valign="top" style="padding:14px;background:#f7f8fb;border-top:5px solid #fff;border-right:5px solid #fff"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">CLOSEST SCHOOL</p><p style="margin:0;color:#151b2b;font:800 14px Arial,sans-serif;line-height:1.25">${html(facts.closest_school || "Confirm attendance school")}</p></td><td width="50%" valign="top" style="padding:14px;background:#f7f8fb;border-top:5px solid #fff"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">MLS HISTORY</p><p style="margin:0;color:#151b2b;font:800 14px Arial,sans-serif">${html(history.appearanceCount ? `${history.appearanceCount} appearance${history.appearanceCount === 1 ? "" : "s"} / ${history.years || 10} years` : "No reliable history")}</p></td></tr></table>`;
  const indicatorColor = rating.score >= 7 ? "#087555" : rating.score >= 5.5 ? "#8a6b1d" : rating.score >= 4 ? "#a35c18" : "#a63d40";
  const filled = rating.available ? Math.round(Number(rating.score) || 0) : 0;
  const ratingSegments = Array.from({ length: 10 }, (_, i) => `<td width="10%" height="10" bgcolor="${i < filled ? i < 3 ? "#c95b5f" : i < 6 ? "#d1a84b" : "#3ea879" : "#e6e9ef"}" style="border-right:2px solid #fff"></td>`).join("");
  const ratingVisual = rating.available ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:#f7f8fb;border-top:4px solid ${indicatorColor}"><tr><td style="padding:20px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td><p style="margin:0;color:#6f788c;font:800 9px Arial,sans-serif;letter-spacing:1px">THM VALUE RATING</p><p style="margin:6px 0 0;color:#151b2b;font:800 31px Arial,sans-serif">${html(rating.score)}<span style="font-size:14px;color:#7b8395"> / 10</span></p></td><td align="right"><p style="margin:0;color:${indicatorColor};font:800 11px Arial,sans-serif;letter-spacing:1px">${html(moveSignal)}</p><p style="margin:5px 0 0;color:#151b2b;font:800 18px Arial,sans-serif">${html(rating.label)}</p></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:13px"><tr>${ratingSegments}</tr><tr><td colspan="3" align="left" style="padding-top:5px;color:#a63d40;font:700 8px Arial,sans-serif">CAUTION</td><td colspan="4" align="center" style="padding-top:5px;color:#8a6b1d;font:700 8px Arial,sans-serif">FAIR</td><td colspan="3" align="right" style="padding-top:5px;color:#087555;font:700 8px Arial,sans-serif">STRONG</td></tr></table><p style="margin:10px 0 0;color:#596277;font:400 12px Arial,sans-serif;line-height:1.5">${html(rating.reason)}</p></td></tr></table>` : `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:#f2f6ff;border-top:4px solid #3155f5"><tr><td style="padding:20px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td><p style="margin:0;color:#3155f5;font:800 9px Arial,sans-serif;letter-spacing:1px">BUYER OPPORTUNITY SNAPSHOT</p><p style="margin:7px 0 0;color:#151b2b;font:800 22px Arial,sans-serif">Worth a closer look</p></td><td align="right"><p style="margin:0;color:#3155f5;font:800 28px Arial,sans-serif">${html(briefScore)}<span style="font-size:13px;color:#7b8395"> / 10</span></p><p style="margin:4px 0 0;color:#687286;font:700 9px Arial,sans-serif;letter-spacing:.6px">BUYER READ</p></td></tr></table><p style="margin:10px 0 0;color:#596277;font:400 12px Arial,sans-serif;line-height:1.5">This scores how useful the verified property facts are for deciding whether to investigate further; it is not a price rating. A Realtor should refresh the local sold evidence before an offer decision.</p></td></tr></table>`;
  const priceGauge = v.available ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:#f7f8fb"><tr><td style="padding:16px"><p style="margin:0 0 10px;color:#6f788c;font:800 9px Arial,sans-serif;letter-spacing:1px">PRICE POSITION</p><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" style="color:#657086;font:700 11px Arial,sans-serif">${html(cad(v.low) || "-")}</td><td align="center" style="color:#151b2b;font:800 12px Arial,sans-serif">MID ${html(cad(v.midpoint) || "-")}</td><td align="right" style="color:#657086;font:700 11px Arial,sans-serif">${html(cad(v.high) || "-")}</td></tr><tr><td colspan="3" style="padding-top:8px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="33%" height="9" bgcolor="#3ea879"></td><td width="34%" height="9" bgcolor="#d1a84b"></td><td width="33%" height="9" bgcolor="#c95b5f"></td></tr></table></td></tr><tr><td colspan="3" style="padding-top:8px;color:#596277;font:400 11px Arial,sans-serif">Asking price: <strong>${html(cad(facts.list_price) || "-")}</strong>${policy.farthestKm ? ` | nearest evidence selected first` : ""}</td></tr></table></td></tr></table>` : "";
  const expandedNote = policy.expandedWindow ? `<p style="margin:0 0 18px;padding:10px 12px;background:#fff6ee;color:#87511d;font:700 11px Arial,sans-serif;line-height:1.45">Evidence note: the search was expanded from 100 to ${policy.windowDays || 300} days.</p>` : "";
  const evidenceVisual = `${ratingVisual}${priceGauge}${expandedNote}`;
  const htmlBody = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;background:#eef1f5"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:22px 10px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;background:#ffffff"><tr><td bgcolor="#10182d" style="padding:30px;background:#10182d"><p style="margin:0 0 10px;color:#c9b577;font:800 11px Arial,sans-serif;letter-spacing:1.5px">THM BUYER INTELLIGENCE</p><h1 style="margin:0;color:#ffffff;font:800 27px Arial,sans-serif;line-height:1.22">${html(address)}</h1><p style="margin:12px 0 0;color:#b9c2d5;font:400 12px Arial,sans-serif;line-height:1.55">${context}</p></td></tr><tr><td style="padding:26px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4eddd;border:1px solid #e2d5b5"><tr><td style="padding:20px"><p style="margin:0 0 7px;color:#81682d;font:800 10px Arial,sans-serif;letter-spacing:1.2px">RECOMMENDED NEXT MOVE</p><h2 style="margin:0;color:#151b2b;font:800 22px Arial,sans-serif;line-height:1.25">${html(moveTitle)}</h2><p style="margin:8px 0 0;color:#5e5b53;font:400 13px Arial,sans-serif;line-height:1.55">${html(moveNote)}</p></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 24px"><tr><td width="33%" valign="top" style="padding:14px;background:#f7f8fb;border-right:5px solid #fff"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">ASKING</p><p style="margin:0;color:#151b2b;font:800 17px Arial,sans-serif">${html(cad(facts.list_price) || "-")}</p></td><td width="34%" valign="top" style="padding:14px;background:#f7f8fb;border-right:5px solid #fff"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">EVIDENCE BAND</p><p style="margin:0;color:#151b2b;font:800 15px Arial,sans-serif;line-height:1.25">${html(range)}</p></td><td width="33%" valign="top" style="padding:14px;background:#f7f8fb"><p style="margin:0 0 6px;color:#7b8395;font:800 9px Arial,sans-serif;letter-spacing:1px">EVIDENCE</p><p style="margin:0;color:#151b2b;font:800 15px Arial,sans-serif;line-height:1.25">${html(`${comps.length} match${comps.length === 1 ? "" : "es"} / ${policy.windowDays || 100}d`)}</p></td></tr></table><p style="margin:0 0 7px;color:#3155f5;font:800 10px Arial,sans-serif;letter-spacing:1.2px">THE 30-SECOND READ</p><p style="margin:0 0 24px;color:#3f4a60;font:400 15px Arial,sans-serif;line-height:1.65">${html(n.executive_summary || "Review the price evidence and showing priorities below before deciding on the next step.")}</p><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr><td><h2 style="margin:0;color:#151b2b;font:800 19px Arial,sans-serif">Best sold evidence</h2><p style="margin:5px 0 0;color:#798196;font:400 12px Arial,sans-serif;line-height:1.45">Top ${topComps.length} of ${comps.length} licensed matches used. Newest record: ${html(v.newest_sold_date || "unknown")}. ${comps.length > 3 ? `${comps.length - 3} additional matches were analysed.` : ""}</p></td></tr>${compsHtml}</table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:#f7f8fb"><tr><td style="padding:18px"><p style="margin:0 0 6px;color:#3155f5;font:800 10px Arial,sans-serif;letter-spacing:1px">AI EVIDENCE READ</p><p style="margin:0;color:#4e586d;font:400 13px Arial,sans-serif;line-height:1.55">${html(n.market_read || v.basis || "The assigned Realtor should refresh the local sold evidence before an offer decision.")}</p></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px"><tr><td width="50%" valign="top" style="padding:18px;background:#f2faf6;border-right:7px solid #fff"><p style="margin:0 0 8px;color:#087555;font:800 10px Arial,sans-serif;letter-spacing:1px">WHAT HELPS</p>${compactBullets(n.strengths, "#087555")}</td><td width="50%" valign="top" style="padding:18px;background:#fff6ee"><p style="margin:0 0 8px;color:#a35c18;font:800 10px Arial,sans-serif;letter-spacing:1px">WHAT COULD CHANGE IT</p>${compactBullets(n.risks, "#a35c18")}</td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#10182d"><tr><td style="padding:22px"><p style="margin:0 0 7px;color:#c9b577;font:800 10px Arial,sans-serif;letter-spacing:1px">YOUR NEXT MOVE</p><h2 style="margin:0 0 9px;color:#ffffff;font:800 20px Arial,sans-serif">Use the showing to answer the value questions.</h2><p style="margin:0 0 13px;color:#c7cfdf;font:400 13px Arial,sans-serif;line-height:1.55">${html(n.buyer_strategy || "Confirm condition and the strongest local comparable before deciding on price or conditions.")}</p>${compactBullets(n.inspection_priorities, "#c9b577")}<p style="margin:17px 0 0"><a href="${html(contactHref)}" style="display:inline-block;background:#c9b577;color:#10182d;text-decoration:none;font:800 14px Arial,sans-serif;padding:13px 18px">Ask ${html(agent)} for the local price check</a></p></td></tr></table><p style="margin:18px 0 0;color:#8991a2;font:400 10px Arial,sans-serif;line-height:1.55">MLS history: ${html(historyText)} Analysis uses licensed AMPRE / PropTx listing and sold evidence after the property request. AI provider: ${html(report.ai_generation?.provider || "deterministic fallback")}.</p></td></tr></table></td></tr></table></body></html>`;
  const decisionMarker = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4eddd;border:1px solid #e2d5b5">';
  const soldEvidenceMarker = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr><td><h2 style="margin:0;color:#151b2b;font:800 19px Arial,sans-serif">Best sold evidence</h2>';
  const nextMoveMarker = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#10182d">';
  const disclaimerHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:#f7f8fb;border-left:4px solid #3155f5"><tr><td style="padding:14px"><p style="margin:0 0 5px;color:#3155f5;font:800 9px Arial,sans-serif;letter-spacing:1px">AI-ASSISTED BUYER BRIEF</p><p style="margin:0;color:#687286;font:400 10px Arial,sans-serif;line-height:1.5">This email uses AI assistance and licensed MLS evidence for preliminary decision support. It is not an appraisal, legal advice, home inspection or guarantee of value. Verify sold data and all material facts with a registered real estate professional.</p></td></tr></table>`;
  const displayedRating = rating.available ? `${rating.score}/10 - ${rating.label}` : rating.label;
  const finalHtmlBody = htmlBody.replace(decisionMarker, `${evidenceVisual}${decisionMarker}`).replace(soldEvidenceMarker, `${smartFacts}${soldEvidenceMarker}`).replace(nextMoveMarker, `${questionsHtml}${nextMoveMarker}`).replace("</td></tr></table></td></tr></table></body></html>", `${researchHtml}${disclaimerHtml}</td></tr></table></td></tr></table></body></html>`);
  const text = ["THM BUYER INTELLIGENCE", address, context, `THM value rating: ${displayedRating}`, moveSignal, moveTitle, moveNote, `Asking: ${cad(facts.list_price) || "-"}`, `Evidence band: ${range}`, `Evidence: ${comps.length} match${comps.length === 1 ? "" : "es"} / ${policy.windowDays || 100} days`, policy.expandedWindow ? `Evidence note: search expanded from 100 to ${policy.windowDays || 300} days.` : null, "The 30-second read", n.executive_summary, `Market timing: ${facts.days_on_market != null ? `${facts.days_on_market} days live` : "Confirm DOM"}`, `Offer timing: ${offerLabel}`, `Closest school: ${facts.closest_school || "Confirm attendance school"}`, "Best sold evidence", ...topComps.map((c, i) => `${i + 1}. ${c.address} | ${cad(c.soldPrice)} | ${c.soldDate}${c.distanceKm != null ? ` | ${Number(c.distanceKm).toFixed(2)} km` : ""} | ${Math.round(Number(c.similarity) || 0)}% match`), "AI evidence read", n.market_read, "What helps", ...(n.strengths || []).slice(0, 3).map((x) => `- ${x}`), "What could change it", ...(n.risks || []).slice(0, 3).map((x) => `- ${x}`), "Your next move", n.buyer_strategy, ...(n.inspection_priorities || []).slice(0, 3).map((x) => `- ${x}`), `Ask ${agent}: ${agentMobile || agentEmail || "torontohousemarket.com"}`, "This report was generated with AI assistance from licensed MLS evidence. It is not an appraisal, legal advice or a guarantee of value. Verify material facts with a registered real estate professional."].filter(Boolean).join("\n\n");
  return { subject: `THM Value Rating: ${rating.available ? `${rating.score}/10` : "Realtor review"} | ${address}`, html: finalHtmlBody, text };
}
__name(propertyReportEmail, "propertyReportEmail");
function propertyReportPdf(address, agentData, report) {
  const facts = report.facts || {}, v = report.valuation || {}, n = report.narrative || {}, policy = report.comparable_policy || {}, comps = Array.isArray(report.comparables) ? report.comparables.slice(0, 3) : [];
  const rating = report.value_rating || buildValueRating(facts, v, policy, comps.length), agent = agentData?.display_name || "your assigned Realtor";
  const pages = [[], []], navy = [0.06, 0.09, 0.18], ink = [0.08, 0.11, 0.18], muted = [0.36, 0.41, 0.51], gold = [0.79, 0.71, 0.47], green = [0.08, 0.48, 0.34], amber = [0.64, 0.36, 0.09], red = [0.65, 0.2, 0.22], light = [0.96, 0.97, 0.98];
  const rect = /* @__PURE__ */ __name((p, x, y2, w, h, c) => pages[p].push(`${c.join(" ")} rg ${x} ${y2} ${w} ${h} re f`), "rect");
  const line = /* @__PURE__ */ __name((p, x1, y1, x2, y2, c, w = 1) => pages[p].push(`${c.join(" ")} RG ${w} w ${x1} ${y1} m ${x2} ${y2} l S`), "line");
  const text = /* @__PURE__ */ __name((p, value, x, y2, size = 10, bold = false, c = ink) => pages[p].push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${c.join(" ")} rg ${x} ${y2} Td (${pdfEscape(value)}) Tj ET`), "text");
  const paragraph = /* @__PURE__ */ __name((p, value, x, y2, width, size = 10, leading = 14, bold = false, c = muted, maxLines = 8) => {
    const lines = pdfWrap(value, width, size).slice(0, maxLines);
    lines.forEach((s, i) => text(p, s, x, y2 - i * leading, size, bold, c));
    return y2 - lines.length * leading;
  }, "paragraph");
  rect(0, 0, 672, 612, 120, navy);
  text(0, "THM BUYER INTELLIGENCE", 42, 754, 10, true, gold);
  paragraph(0, address, 42, 726, 520, 22, 25, true, [1, 1, 1], 2);
  text(0, [facts.property_type, facts.beds != null ? `${facts.beds} bed` : null, facts.baths != null ? `${facts.baths} bath` : null, facts.neighbourhood].filter(Boolean).join("  |  "), 42, 687, 10, false, [0.73, 0.77, 0.85]);
  rect(0, 42, 568, 528, 82, light);
  text(0, "THM VALUE RATING", 60, 627, 9, true, muted);
  const scoreText = rating.available ? `${rating.score} / 10` : "REVIEW";
  text(0, scoreText, 60, 596, rating.available ? 28 : 22, true, ink);
  text(0, rating.label || "Realtor review", 230, 608, 18, true, rating.available ? rating.score >= 7 ? green : rating.score >= 5.5 ? gold : rating.score >= 4 ? amber : red : amber);
  paragraph(0, rating.reason || "Current sold evidence requires a Realtor review.", 230, 588, 315, 10, 13, false, muted, 3);
  const filled = rating.available ? Math.round(rating.score) : 0;
  for (let i = 0; i < 10; i++) rect(0, 60 + i * 48, 574, 43, 7, i < filled ? i < 3 ? red : i < 6 ? gold : green : [0.87, 0.89, 0.92]);
  let y = 536;
  text(0, "PRICE POSITION", 42, y, 9, true, muted);
  y -= 20;
  if (v.available) {
    text(0, cad(v.low) || "-", 42, y, 10, true, muted);
    text(0, `MID ${cad(v.midpoint) || "-"}`, 265, y, 11, true, ink);
    text(0, cad(v.high) || "-", 500, y, 10, true, muted);
    rect(0, 42, y - 17, 176, 8, green);
    rect(0, 218, y - 17, 176, 8, gold);
    rect(0, 394, y - 17, 176, 8, red);
    text(0, `ASK ${cad(facts.list_price) || "-"}`, 42, y - 36, 11, true, ink);
    y -= 62;
  } else {
    rect(0, 42, y - 42, 528, 52, [1, 0.97, 0.92]);
    text(0, "Automated rating pending local sold evidence", 58, y - 15, 13, true, amber);
    y -= 65;
  }
  if (policy.expandedWindow) {
    text(0, "EVIDENCE WINDOW EXPANDED TO 300 DAYS", 42, y, 9, true, amber);
    y -= 22;
  }
  text(0, "THE 30-SECOND READ", 42, y, 9, true, [0.19, 0.33, 0.8]);
  y -= 20;
  y = paragraph(0, n.executive_summary || "Review the property facts and local sold evidence with your Realtor.", 42, y, 528, 11, 16, false, muted, 5) - 8;
  text(0, "NEAREST SOLD EVIDENCE", 42, y, 9, true, [0.19, 0.33, 0.8]);
  y -= 20;
  if (comps.length) {
    for (const [i, c] of comps.entries()) {
      text(0, `${i + 1}. ${c.address || "MLS comparable"}`, 42, y, 10, true, ink);
      text(0, cad(c.soldPrice) || "-", 466, y, 10, true, ink);
      y -= 14;
      text(0, [c.soldDate, c.distanceKm != null ? `${Number(c.distanceKm).toFixed(2)} km away` : null, c.beds != null ? `${c.beds} bd` : null, c.baths != null ? `${c.baths} ba` : null].filter(Boolean).join("  |  "), 54, y, 8, false, muted);
      y -= 17;
      line(0, 42, y, 570, y, [0.88, 0.9, 0.93]);
      y -= 14;
    }
  } else paragraph(0, "Current sold evidence was not sufficient for an automated rating. Ask your Realtor for a local comparable review.", 42, y, 528, 10, 14, false, muted, 3);
  text(0, "TorontoHouseMarket.com", 42, 28, 8, true, muted);
  text(0, "Page 1 of 2", 520, 28, 8, false, muted);
  rect(1, 0, 720, 612, 72, navy);
  text(1, "THM AI BUYER REPORT", 42, 758, 10, true, gold);
  paragraph(1, address, 42, 738, 520, 16, 19, true, [1, 1, 1], 2);
  text(1, "WHAT HELPS", 42, 684, 10, true, green);
  text(1, "WHAT COULD CHANGE THE DECISION", 318, 684, 10, true, amber);
  let left = 660;
  for (const item of (n.strengths || []).slice(0, 4)) {
    text(1, "+", 42, left, 12, true, green);
    left = paragraph(1, item, 58, left, 230, 10, 14, false, muted, 3) - 8;
  }
  let right = 660;
  for (const item of (n.risks || []).slice(0, 4)) {
    text(1, "!", 318, right, 11, true, amber);
    right = paragraph(1, item, 336, right, 230, 10, 14, false, muted, 3) - 8;
  }
  const boxY = Math.min(left, right, 520) - 190;
  rect(1, 42, boxY, 528, 190, navy);
  text(1, "YOUR NEXT MOVE", 60, boxY + 166, 9, true, gold);
  paragraph(1, n.buyer_strategy || "Use the showing to confirm condition and ask for the closest local sold evidence before deciding on price.", 60, boxY + 142, 492, 11, 16, false, [0.84, 0.87, 0.93], 5);
  let actionY = boxY + 68;
  for (const item of (n.inspection_priorities || []).slice(0, 3)) {
    text(1, "-", 60, actionY, 10, true, gold);
    paragraph(1, item, 74, actionY, 468, 9, 12, false, [0.84, 0.87, 0.93], 2);
    actionY -= 24;
  }
  let infoY = boxY - 32;
  text(1, `Ask ${agent} for the closest local price check.`, 42, infoY, 12, true, ink);
  infoY -= 24;
  text(1, "IMPORTANT AI-GENERATED REPORT DISCLAIMER", 42, infoY, 9, true, red);
  infoY -= 18;
  paragraph(1, "This report was generated with AI assistance using licensed MLS listing and sold evidence. It is preliminary decision support only and is not an appraisal, comparative market analysis, legal advice, home inspection, financing advice or a guarantee of value. AI output may contain errors. Sold data, property type, condition, measurements, taxes, permits, zoning, school boundaries, offer status and all material facts must be independently verified with a registered real estate professional and the appropriate authorities before relying on them.", 42, infoY, 528, 8.5, 12, false, muted, 12);
  text(1, "TorontoHouseMarket.com", 42, 28, 8, true, muted);
  text(1, "Page 2 of 2", 520, 28, 8, false, muted);
  return buildPdf(pages);
}
__name(propertyReportPdf, "propertyReportPdf");
function buildPdf(pageCommands) {
  const streams = pageCommands.map((commands) => commands.join("\n"));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${streams[0].length} >>
stream
${streams[0]}
endstream`,
    `<< /Length ${streams[1].length} >>
stream
${streams[1]}
endstream`
  ];
  let pdf = "%PDF-1.4\n%THM\n", offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj
${object}
endobj
`;
  });
  const xref = pdf.length;
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n 
`;
  pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;
  return new TextEncoder().encode(pdf);
}
__name(buildPdf, "buildPdf");
function pdfWrap(value, width, size) {
  const text = pdfPlain(value), max = Math.max(12, Math.floor(width / (size * 0.54))), words = text.split(/\s+/).filter(Boolean), lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max) current = next;
    else {
      if (current) lines.push(current);
      current = word.slice(0, max);
    }
  }
  if (current) lines.push(current);
  return lines;
}
__name(pdfWrap, "pdfWrap");
function pdfPlain(value) {
  return String(value ?? "").normalize("NFKD").replace(/[×–—]/g, "-").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}
__name(pdfPlain, "pdfPlain");
function pdfEscape(value) {
  return pdfPlain(value).replace(/([\\()])/g, "\\$1");
}
__name(pdfEscape, "pdfEscape");
function emailDocument(subject, heading, intro, rows, link, linkLabel = "Open lead dashboard") {
  const tableRows = rows.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#687286;font:600 12px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(label)}</td><td style="padding:8px 12px;color:#11182b;font:600 14px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(value || "\u2014")}</td></tr>`).join("");
  const cta = link ? `<tr><td style="padding:22px 0 0"><a href="${html(link)}" style="display:inline-block;background:#3155f5;color:#fff;text-decoration:none;font:700 14px Arial,sans-serif;padding:12px 18px;border-radius:9px">${html(linkLabel)}</a></td></tr>` : "";
  const htmlBody = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;background:#f4f6fa"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 12px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:16px"><tr><td style="padding:28px"><p style="margin:0 0 8px;color:#3155f5;font:700 12px Arial,sans-serif">TORONTO HOUSE MARKET</p><h1 style="margin:0 0 12px;color:#11182b;font:700 24px Arial,sans-serif;line-height:1.25">${html(heading)}</h1><p style="margin:0 0 20px;color:#566178;font:400 15px Arial,sans-serif;line-height:1.55">${html(intro)}</p><table width="100%" cellpadding="0" cellspacing="0" border="0">${tableRows}</table><table cellpadding="0" cellspacing="0" border="0">${cta}</table><p style="margin:24px 0 0;color:#8a93a5;font:400 11px Arial,sans-serif;line-height:1.5">Automated operational message from Toronto House Market.</p></td></tr></table></td></tr></table></body></html>`;
  const textBody = [heading, intro, ...rows.map(([a, b]) => `${a}: ${b || "\u2014"}`), link ? `${linkLabel}: ${link}` : ""].filter(Boolean).join("\n\n");
  return { subject, html: htmlBody, text: textBody };
}
__name(emailDocument, "emailDocument");
async function rpc(env, name, body) {
  const response = await supabase(env, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }), data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Database operation ${name} failed.`);
  return data;
}
__name(rpc, "rpc");
function timingLabel(value) {
  return { asap: "As soon as possible", today: "Today, if available", within_24h: "Within 24 hours" }[value] || String(value || "\u2014").replaceAll("_", " ");
}
__name(timingLabel, "timingLabel");
function formatToronto(value) {
  return value ? new Date(value).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }) : "Starts after assignment";
}
__name(formatToronto, "formatToronto");
function cad(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n) : null;
}
__name(cad, "cad");
function firstRelation(value) {
  return Array.isArray(value) ? value[0] || null : value && typeof value === "object" ? value : null;
}
__name(firstRelation, "firstRelation");
function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
__name(html, "html");
function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function clean5(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
__name(clean5, "clean");
function slug(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50);
}
__name(slug, "slug");
function validEmail(v) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(v);
}
__name(validEmail, "validEmail");
function databaseMessage(data, fallback) {
  if (data?.code === "23505") return "That assignment order is already in use.";
  return data?.message && String(data.message).length < 160 ? data.message : fallback;
}
__name(databaseMessage, "databaseMessage");
function json7(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-THM-Version": VERSION4, "X-Content-Type-Options": "nosniff", ...headers } });
}
__name(json7, "json");
export {
  buildComparableContext,
  comparableIsLocal,
  distanceBetweenProperties,
  exactComparableType,
  filterPriceCluster,
  worker_v11_default as default,
  generateAiNarrative,
  mergeCurrentIdxWithVow,
  numberOrNull,
  propertyReportEmail,
  propertyReportPdf,
  safeAmpreNextLink
};
//# sourceMappingURL=worker-v11.js.map
