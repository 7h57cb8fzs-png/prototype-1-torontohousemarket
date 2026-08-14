export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/property" && request.method === "GET") {
      return handleProperty(request, env);
    }
    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleProperty(request, env) {
  const url = new URL(request.url);
  const listingKey = (url.searchParams.get("listingKey") || "").trim().toUpperCase();

  if (!/^[A-Z]\d{7,9}$/.test(listingKey)) {
    return json({ ok: false, error: "Valid MLS number required." }, 400);
  }
  if (!env.AMPRE_TOKEN) {
    return json({ ok: false, error: "IDX connection is not configured." }, 503);
  }

  const response = await amplifyFetch(
    `https://query.ampre.ca/odata/Property('${encodeURIComponent(listingKey)}')`,
    env
  );

  if (response.status === 404) return json({ ok: false, error: "Listing not found." }, 404);
  if (!response.ok) return json({ ok: false, error: "Unable to load MLS listing." }, 502);

  const p = await response.json();
  if (p.InternetAddressDisplayYN === false || p.InternetEntireListingDisplayYN === false) {
    return json({ ok: false, error: "This listing is not permitted for full internet display." }, 403);
  }

  const [comparableContext] = await Promise.all([
    buildComparableContext(p, listingKey, env),
  ]);

  return json({
    ok: true,
    property: {
      listingKey: p.ListingKey,
      address: p.UnparsedAddress,
      city: p.City,
      cityRegion: p.CityRegion || null,
      postalCode: p.PostalCode,
      listPrice: numberOrNull(p.ListPrice),
      status: p.StandardStatus,
      transactionType: p.TransactionType,
      propertyType: p.PropertyType,
      propertySubType: cleanText(p.PropertySubType),
      beds: numberOrNull(p.BedroomsTotal),
      baths: numberOrNull(p.BathroomsTotalInteger),
      livingAreaRange: p.LivingAreaRange,
      lotWidth: numberOrNull(p.LotWidth),
      lotDepth: numberOrNull(p.LotDepth),
      parkingTotal: numberOrNull(p.ParkingTotal),
      garageType: p.GarageType,
      basement: Array.isArray(p.Basement) ? p.Basement : [],
      kitchensTotal: numberOrNull(p.KitchensTotal),
      remarks: p.PublicRemarks,
      originalEntryTimestamp: p.OriginalEntryTimestamp,
      modificationTimestamp: p.ModificationTimestamp,
      daysLive: daysSince(p.OriginalEntryTimestamp),
      offerTiming: detectOfferTiming(p),
      comparableContext,
      showingFocus: buildShowingFocus(p),
    },
  });
}

async function amplifyFetch(endpoint, env) {
  return fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${env.AMPRE_TOKEN}`,
      Accept: "application/json",
    },
  });
}

function detectOfferTiming(p) {
  const remarkFields = [
    "PrivateRemarks", "PrivateRemarksExtras", "BrokerageRemarks", "BrokerRemarks",
    "RemarksForBrokerage", "PublicRemarksExtras", "PublicRemarks"
  ];
  const text = remarkFields
    .map((key) => (typeof p[key] === "string" ? p[key].trim() : ""))
    .filter(Boolean)
    .join(" \n");

  const offerLines = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((part) => /\boffer(?:s|ing)?\b|offer presentation|presentation of offers/i.test(part));
  const relevant = offerLines.join(" ");

  if (/\b(any\s*time|offers?\s+anytime|offers?\s+welcome\s+anytime|accept(?:ing|ed)?\s+offers?\s+anytime)\b/i.test(relevant)) {
    return { type: "anytime", label: "Offers anytime", note: "No scheduled presentation stated in the available remarks. Verify before drafting." };
  }

  const monthDate = relevant.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i);
  const numericDate = relevant.match(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/);
  const time = relevant.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i);
  const date = monthDate?.[0] || numericDate?.[0] || null;

  if (relevant && (date || time)) {
    return {
      type: "scheduled",
      label: [date, time?.[0]].filter(Boolean).join(" · "),
      note: "Offer timing detected in the remarks available to this IDX feed. Realtor verification required."
    };
  }

  if (relevant && /offer presentation|present(?:ing|ation)? offers|review(?:ing)? offers/i.test(relevant)) {
    return { type: "verify", label: "Offer presentation mentioned", note: "Exact timing requires Realtor verification." };
  }

  return {
    type: "anytime",
    label: "Offers anytime*",
    note: "No offer date detected in the remarks available to this feed. Verify with the listing brokerage."
  };
}

async function buildComparableContext(subject, currentListingKey, env) {
  const base = [];
  if (subject.CityRegion) base.push(`CityRegion eq '${odataString(subject.CityRegion)}'`);
  else if (subject.City) base.push(`City eq '${odataString(subject.City)}'`);
  if (subject.PropertyType) base.push(`PropertyType eq '${odataString(subject.PropertyType)}'`);
  if (subject.TransactionType) base.push(`TransactionType eq '${odataString(subject.TransactionType)}'`);

  const soldFilter = [...base, `(StandardStatus eq 'Closed' or contains(MlsStatus,'Sold'))`];
  const activeFilter = [...base, `(StandardStatus eq 'Active' or ContractStatus eq 'Available')`];

  const [soldRaw, activeRaw] = await Promise.all([
    queryProperties(soldFilter, env, 80),
    queryProperties(activeFilter, env, 80),
  ]);

  let broadRaw = [];
  if (soldRaw.length < 3 || activeRaw.length < 3) {
    broadRaw = await queryProperties(base, env, 80);
  }

  const soldPool = dedupe([...soldRaw, ...broadRaw])
    .filter((c) => c.ListingKey !== currentListingKey)
    .map((c) => normalizeCandidate(subject, c, "sold"))
    .filter((c) => c.isSoldLike && c.price);

  const activePool = dedupe([...activeRaw, ...broadRaw])
    .filter((c) => c.ListingKey !== currentListingKey)
    .map((c) => normalizeCandidate(subject, c, "active"))
    .filter((c) => c.isActiveLike && c.price);

  const soldMatches = soldPool.sort(compareMatch).slice(0, 7);
  const activeMatches = activePool.sort(compareMatch).slice(0, 7);

  let basis = null;
  if (soldMatches.length >= 3) basis = { source: "sold", matches: soldMatches };
  else if (activeMatches.length >= 3) basis = { source: "active", matches: activeMatches };
  else if (soldMatches.length) basis = { source: "sold", matches: soldMatches };
  else if (activeMatches.length) basis = { source: "active", matches: activeMatches };

  const latestSold = soldPool
    .filter((c) => c.soldDate)
    .sort((a, b) => b.soldDate.getTime() - a.soldDate.getTime())[0] || null;

  if (!basis || !basis.matches.length) {
    return {
      available: false,
      source: null,
      area: subject.CityRegion || subject.City || null,
      matchCount: 0,
      latestSold: latestSold ? soldSummary(latestSold) : null,
      method: "THM Similarity Engine"
    };
  }

  const band = similarityWeightedBand(basis.matches);
  const avgScore = basis.matches.reduce((sum, item) => sum + item.similarity, 0) / basis.matches.length;
  const confidence = basis.matches.length >= 5 && avgScore >= 68
    ? "Strong match set"
    : basis.matches.length >= 3 && avgScore >= 52
      ? "Good match set"
      : "Broad match set";

  return {
    available: true,
    source: basis.source,
    sourceLabel: basis.source === "sold" ? "Recent sold matches" : "Live asking competition",
    area: subject.CityRegion || subject.City || null,
    matchCount: basis.matches.length,
    confidence,
    rangeLow: band.low,
    midpoint: band.mid,
    rangeHigh: band.high,
    latestSold: latestSold ? soldSummary(latestSold) : null,
    method: "THM Similarity Engine",
    basis: buildBasisText(subject, basis.matches)
  };
}

async function queryProperties(filters, env, top = 80) {
  if (!filters.length) return [];
  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$filter", filters.join(" and "));
  params.set("$orderby", "ModificationTimestamp desc,ListingKey desc");

  try {
    const response = await amplifyFetch(`https://query.ampre.ca/odata/Property?${params.toString()}`, env);
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}

function normalizeCandidate(subject, record, preferredSource) {
  const statusText = `${record.StandardStatus || ""} ${record.MlsStatus || ""} ${record.ContractStatus || ""}`;
  const isSoldLike = /\bclosed\b|\bsold\b/i.test(statusText);
  const isActiveLike = /\bactive\b|\bavailable\b|\bnew\b/i.test(statusText) && !isSoldLike;
  const soldPrice = firstFiniteNumber(record, [
    "ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"
  ]);
  const soldDateRaw = firstValue(record, [
    "PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"
  ]);
  const soldDate = validDate(soldDateRaw);
  const price = preferredSource === "sold" ? soldPrice : firstFiniteNumber(record, ["ListPrice"]);
  const similarity = similarityScore(subject, record);
  const recencyDate = soldDate || validDate(record.OriginalEntryTimestamp) || validDate(record.ModificationTimestamp);
  const recency = recencyWeight(recencyDate);

  return { record, price, soldPrice, soldDate, isSoldLike, isActiveLike, similarity, recency };
}

function similarityScore(subject, c) {
  let earned = 0;
  let possible = 0;
  const add = (weight, value) => { possible += weight; earned += weight * Math.max(0, Math.min(1, value)); };

  if (subject.CityRegion && c.CityRegion) add(18, sameText(subject.CityRegion, c.CityRegion) ? 1 : 0);
  else if (subject.City && c.City) add(12, sameText(subject.City, c.City) ? 1 : 0);

  if (subject.PropertyType && c.PropertyType) add(10, sameText(subject.PropertyType, c.PropertyType) ? 1 : 0);
  if (subject.PropertySubType && c.PropertySubType) add(20, sameText(subject.PropertySubType, c.PropertySubType) ? 1 : 0);

  const bedA = numberOrNull(subject.BedroomsTotal), bedB = numberOrNull(c.BedroomsTotal);
  if (bedA != null && bedB != null) add(11, diffScore(bedA, bedB, 2));
  const bathA = numberOrNull(subject.BathroomsTotalInteger), bathB = numberOrNull(c.BathroomsTotalInteger);
  if (bathA != null && bathB != null) add(9, diffScore(bathA, bathB, 2));

  const areaA = rangeMid(subject.LivingAreaRange), areaB = rangeMid(c.LivingAreaRange);
  if (areaA && areaB) add(14, ratioCloseness(areaA, areaB, 0.45));

  const lotWA = numberOrNull(subject.LotWidth), lotWB = numberOrNull(c.LotWidth);
  if (lotWA && lotWB) add(6, ratioCloseness(lotWA, lotWB, 0.65));
  const lotDA = numberOrNull(subject.LotDepth), lotDB = numberOrNull(c.LotDepth);
  if (lotDA && lotDB) add(5, ratioCloseness(lotDA, lotDB, 0.65));

  const parkA = numberOrNull(subject.ParkingTotal), parkB = numberOrNull(c.ParkingTotal);
  if (parkA != null && parkB != null) add(3, diffScore(parkA, parkB, 5));
  const kitA = numberOrNull(subject.KitchensTotal), kitB = numberOrNull(c.KitchensTotal);
  if (kitA != null && kitB != null) add(2, diffScore(kitA, kitB, 2));

  const basementA = arrayText(subject.Basement), basementB = arrayText(c.Basement);
  if (basementA && basementB) add(2, tokenOverlap(basementA, basementB));

  return possible ? Math.round((earned / possible) * 100) : 0;
}

function compareMatch(a, b) {
  const aWeight = a.similarity * 0.82 + a.recency * 18;
  const bWeight = b.similarity * 0.82 + b.recency * 18;
  return bWeight - aWeight;
}

function similarityWeightedBand(matches) {
  const items = matches.map((m) => ({
    price: m.price,
    weight: Math.max(0.05, Math.pow(m.similarity / 100, 2) * (0.45 + 0.55 * m.recency))
  })).sort((a, b) => a.price - b.price);

  let low = weightedQuantile(items, 0.20);
  let mid = weightedQuantile(items, 0.50);
  let high = weightedQuantile(items, 0.80);

  if (items.length > 1 && low === high) {
    low = items[0].price;
    high = items[items.length - 1].price;
  }

  return { low: roundMarket(low), mid: roundMarket(mid), high: roundMarket(high) };
}

function weightedQuantile(items, q) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return items[Math.floor((items.length - 1) * q)]?.price || 0;
  const target = total * q;
  let running = 0;
  for (const item of items) {
    running += item.weight;
    if (running >= target) return item.price;
  }
  return items[items.length - 1]?.price || 0;
}

function soldSummary(candidate) {
  return {
    price: candidate.soldPrice || candidate.price,
    date: candidate.soldDate ? candidate.soldDate.toISOString().slice(0, 10) : null
  };
}

function buildBasisText(subject, matches) {
  const bits = [];
  if (subject.CityRegion) bits.push("same micro-area");
  if (subject.PropertySubType) bits.push(cleanText(subject.PropertySubType));
  if (subject.BedroomsTotal != null) bits.push(`${subject.BedroomsTotal}±1 bed weighted`);
  if (subject.LivingAreaRange) bits.push("size overlap");
  if (subject.LotWidth || subject.LotDepth) bits.push("lot similarity");
  bits.push("recency weighted");
  return bits.slice(0, 4).join(" · ");
}

function buildShowingFocus(p) {
  const remarks = `${p.PublicRemarks || ""} ${p.PublicRemarksExtras || ""}`;
  const basement = arrayText(p.Basement);
  const kitchens = numberOrNull(p.KitchensTotal) || 0;
  const separate = /separate entrance|side entrance|private entrance/i.test(`${remarks} ${basement}`);
  const permit = /permit|zoning|approval|legal(?:ly)?|retrofit/i.test(remarks);

  if ((kitchens > 1 || separate) && permit) {
    return { title: "Verify suite legality + permits", note: "Check entrances, kitchen setup, egress and municipal approvals before valuing income potential." };
  }
  if (kitchens > 1 || separate) {
    return { title: "Verify secondary-unit setup", note: "Check separation, egress, utilities and whether the configuration is legally recognized." };
  }
  if (/finished/i.test(basement)) {
    return { title: "Inspect finished basement closely", note: "Check moisture, ceiling height, egress and quality of the finished work." };
  }
  if (p.LotDepth && Number(p.LotDepth) >= 130) {
    return { title: "Walk the full lot", note: "Verify rear access, usable depth, grading and any structures or encroachments." };
  }
  return { title: "Verify condition + layout", note: "Focus on the items that could materially change value, repair cost or offer strategy." };
}

function daysSince(value) {
  const d = validDate(value);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function recencyWeight(date) {
  if (!date) return 0.35;
  const days = Math.max(0, (Date.now() - date.getTime()) / 86400000);
  if (days <= 30) return 1;
  if (days <= 90) return 0.82;
  if (days <= 180) return 0.62;
  if (days <= 365) return 0.42;
  return 0.25;
}

function rangeMid(value) {
  if (!value) return null;
  const nums = String(value).match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
}

function diffScore(a, b, tolerance) {
  return Math.max(0, 1 - Math.abs(a - b) / Math.max(1, tolerance));
}

function ratioCloseness(a, b, tolerance) {
  const diff = Math.abs(a - b) / Math.max(a, b);
  return Math.max(0, 1 - diff / tolerance);
}

function tokenOverlap(a, b) {
  const aa = new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const bb = new Set(String(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  aa.forEach((token) => { if (bb.has(token)) shared += 1; });
  return shared / Math.max(aa.size, bb.size);
}

function dedupe(records) {
  const map = new Map();
  records.forEach((r) => { if (r?.ListingKey && !map.has(r.ListingKey)) map.set(r.ListingKey, r); });
  return [...map.values()];
}

function roundMarket(value) {
  if (!Number.isFinite(value)) return null;
  const step = value >= 1000000 ? 10000 : 5000;
  return Math.round(value / step) * step;
}

function odataString(value) { return String(value).replace(/'/g, "''"); }
function cleanText(value) { return typeof value === "string" ? value.trim() : value; }
function sameText(a, b) { return cleanText(String(a)).toLowerCase() === cleanText(String(b)).toLowerCase(); }
function arrayText(value) { return Array.isArray(value) ? value.join(" ") : (value || ""); }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function firstFiniteNumber(record, keys) { for (const key of keys) { const n = Number(record[key]); if (Number.isFinite(n) && n > 0) return n; } return null; }
function firstValue(record, keys) { for (const key of keys) { if (record[key] != null && record[key] !== "") return record[key]; } return null; }
function validDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }

async function handleLead(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Lead system is not configured." }, 503);
  }

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request." }, 400); }

  if (typeof payload.website === "string" && payload.website.trim()) return json({ ok: true }, 200);

  const propertyInput = clean(payload.property_input, 1000);
  const listingKey = clean(payload.listing_key, 32) || null;
  const name = clean(payload.name, 160);
  const mobile = clean(payload.mobile, 50);
  const email = clean(payload.email, 254).toLowerCase() || null;
  const showingTiming = clean(payload.showing_timing, 30) || "asap";

  if (!propertyInput || !name || !mobile) return json({ ok: false, error: "Property, name and mobile are required." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Please enter a valid email." }, 400);

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/create_lead_and_assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      p_property_input: propertyInput,
      p_listing_key: listingKey,
      p_name: name,
      p_mobile: mobile,
      p_email: email,
      p_showing_timing: showingTiming,
      p_page_url: clean(payload.page_url, 1000) || null,
      p_referrer: clean(payload.referrer, 1000) || null,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Lead RPC failed", result);
    return json({ ok: false, error: "Unable to save your request right now." }, 500);
  }

  const row = Array.isArray(result) ? result[0] : result;
  return json({ ok: true, lead_id: row?.lead_id || null }, 201);
}

function clean(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
