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

const TEN_YEARS_AGO = new Date("2016-08-14T00:00:00Z");

async function handleProperty(request, env) {
  const url = new URL(request.url);
  const listingKey = (url.searchParams.get("listingKey") || "").trim().toUpperCase();
  const query = (url.searchParams.get("q") || "").trim();

  if (!env.AMPRE_TOKEN) {
    return json({ ok: false, error: "IDX connection is not configured." }, 503);
  }

  let subject = null;
  let addressHistory = [];
  let resolution = null;

  if (/^[A-Z]\d{7,9}$/.test(listingKey)) {
    const response = await amplifyFetch(
      `https://query.ampre.ca/odata/Property('${encodeURIComponent(listingKey)}')`,
      env
    );
    if (response.status === 404) return json({ ok: false, error: "Listing not found." }, 404);
    if (!response.ok) return json({ ok: false, error: "Unable to load MLS listing." }, 502);
    subject = await response.json();
    resolution = "mls";
    addressHistory = await findSameAddressHistory(subject, env);
  } else if (query) {
    const found = await resolveAddress(query, env);
    if (!found.subject) {
      return json({
        ok: false,
        error: "We could not match that address in the last 10 years of MLS history.",
        notForSale: true,
        searchedHistoryYears: 10,
        suggestion: "Try the full street address including city or postal code."
      }, 404);
    }
    subject = found.subject;
    addressHistory = found.history;
    resolution = found.resolution;
  } else {
    return json({ ok: false, error: "Enter an MLS number or property address." }, 400);
  }

  const activeForSale = isActiveForSale(subject);
  const displayAllowed = subject.InternetAddressDisplayYN !== false && subject.InternetEntireListingDisplayYN !== false;

  if (activeForSale && !displayAllowed) {
    return json({ ok: false, error: "This active listing is not permitted for full internet display." }, 403);
  }

  const comparableContext = await buildComparableContext(subject, subject.ListingKey, env, activeForSale);
  const historySummary = summarizeHistory(addressHistory, subject);
  const priceOpinion = buildPriceOpinion(subject, comparableContext, historySummary, activeForSale);

  const property = normalizeSubject(subject, {
    activeForSale,
    resolution,
    comparableContext,
    historySummary,
    priceOpinion,
  });

  return json({ ok: true, property }, 200);
}

function normalizeSubject(p, extras) {
  const activeForSale = extras.activeForSale;
  return {
    listingKey: p.ListingKey || null,
    address: p.UnparsedAddress || buildAddress(p),
    city: p.City || null,
    cityRegion: p.CityRegion || null,
    postalCode: p.PostalCode || null,
    forSale: activeForSale,
    marketStatus: activeForSale ? "For sale" : "Not for sale",
    status: p.StandardStatus || p.MlsStatus || p.ContractStatus || null,
    transactionType: p.TransactionType || null,
    propertyType: p.PropertyType || null,
    propertySubType: cleanText(p.PropertySubType),
    beds: numberOrNull(p.BedroomsTotal),
    baths: numberOrNull(p.BathroomsTotalInteger),
    livingAreaRange: p.LivingAreaRange || null,
    buildingAreaTotal: numberOrNull(p.BuildingAreaTotal),
    lotWidth: numberOrNull(p.LotWidth),
    lotDepth: numberOrNull(p.LotDepth),
    parkingTotal: numberOrNull(p.ParkingTotal),
    garageType: p.GarageType || null,
    basement: Array.isArray(p.Basement) ? p.Basement : [],
    kitchensTotal: numberOrNull(p.KitchensTotal),
    remarks: activeForSale ? (p.PublicRemarks || null) : null,
    listPrice: activeForSale ? numberOrNull(p.ListPrice) : null,
    lastKnownListPrice: !activeForSale ? numberOrNull(p.ListPrice) : null,
    originalEntryTimestamp: p.OriginalEntryTimestamp || null,
    modificationTimestamp: p.ModificationTimestamp || null,
    daysLive: activeForSale ? daysSince(p.OriginalEntryTimestamp) : null,
    offerTiming: activeForSale ? detectOfferTiming(p) : {
      type: "not_for_sale",
      label: "Not for sale",
      note: "No active for-sale listing was found for this property."
    },
    comparableContext: extras.comparableContext,
    priceOpinion: extras.priceOpinion,
    historySummary: extras.historySummary,
    showingFocus: activeForSale ? buildShowingFocus(p) : buildOffMarketFocus(p, extras.historySummary),
    resolution: extras.resolution,
  };
}

async function resolveAddress(input, env) {
  const parsed = parseAddress(input);
  const queries = [];

  if (parsed.streetNumber && parsed.streetName) {
    const filters = [
      `StreetNumber eq '${odataString(parsed.streetNumber)}'`,
      `contains(StreetName,'${odataString(parsed.streetName)}')`
    ];
    if (parsed.city) filters.push(`contains(City,'${odataString(parsed.city)}')`);
    queries.push(filters);
  }

  const phrase = parsed.searchPhrase || input.split(",")[0].trim();
  if (phrase.length >= 5) {
    queries.push([`contains(UnparsedAddress,'${odataString(phrase)}')`]);
  }

  let records = [];
  for (const filters of queries) {
    records = await queryProperties(filters, env, 100, "ModificationTimestamp desc,ListingKey desc");
    if (records.length) break;
  }

  if (!records.length && parsed.streetName) {
    const filters = [`contains(StreetName,'${odataString(parsed.streetName)}')`];
    if (parsed.city) filters.push(`contains(City,'${odataString(parsed.city)}')`);
    records = await queryProperties(filters, env, 100, "ModificationTimestamp desc,ListingKey desc");
  }

  const recent = records.filter(withinTenYears);
  const scored = recent
    .map((r) => ({ r, score: addressMatchScore(input, parsed, r) }))
    .filter((x) => x.score >= 62)
    .sort((a, b) => b.score - a.score || dateMs(b.r.ModificationTimestamp) - dateMs(a.r.ModificationTimestamp));

  if (!scored.length) return { subject: null, history: [], resolution: null };

  const sameProperty = scored
    .filter((x) => sameAddressAs(parsed, x.r))
    .map((x) => x.r);

  const active = sameProperty.find(isActiveForSale);
  const subject = active || sameProperty.sort(mostRecentRecord)[0] || scored[0].r;

  return {
    subject,
    history: sameProperty.length ? sameProperty : [subject],
    resolution: active ? "address_live" : "address_history"
  };
}

async function findSameAddressHistory(subject, env) {
  if (!subject?.StreetNumber || !subject?.StreetName) return [subject].filter(Boolean);
  const filters = [
    `StreetNumber eq '${odataString(subject.StreetNumber)}'`,
    `contains(StreetName,'${odataString(subject.StreetName)}')`
  ];
  if (subject.City) filters.push(`City eq '${odataString(subject.City)}'`);
  const records = await queryProperties(filters, env, 100, "ModificationTimestamp desc,ListingKey desc");
  const exact = records.filter(withinTenYears).filter((r) => samePhysicalAddress(subject, r));
  return exact.length ? exact : [subject];
}

function parseAddress(input) {
  let text = String(input || "").trim();
  try {
    if (/^https?:\/\//i.test(text)) {
      const u = new URL(text);
      text = decodeURIComponent(`${u.pathname} ${u.search}`).replace(/[+_\-]+/g, " ");
    }
  } catch {}

  text = text.replace(/\s+/g, " ").trim();
  const firstPart = text.split(",")[0].trim();
  const city = text.split(",")[1]?.trim().split(/\s+/).slice(0, 2).join(" ") || null;
  const m = firstPart.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return { streetNumber: null, streetName: null, city, searchPhrase: firstPart };

  const streetNumber = m[1];
  let streetName = m[2]
    .replace(/\b(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl)\.?$/i, "")
    .trim();

  return { streetNumber, streetName, city, searchPhrase: `${streetNumber} ${streetName}` };
}

function addressMatchScore(input, parsed, r) {
  let score = 0;
  const normalizedInput = normalizeText(input);
  const normalizedAddress = normalizeText(r.UnparsedAddress || buildAddress(r));
  if (normalizedInput && normalizedAddress && normalizedAddress.includes(normalizedInput.split(" toronto")[0])) score += 45;
  if (parsed.streetNumber && String(r.StreetNumber || "").toLowerCase() === parsed.streetNumber.toLowerCase()) score += 28;
  if (parsed.streetName && normalizeText(r.StreetName).includes(normalizeText(parsed.streetName))) score += 25;
  if (parsed.city && normalizeText(r.City).includes(normalizeText(parsed.city))) score += 8;
  return Math.min(100, score);
}

function sameAddressAs(parsed, r) {
  const numberMatch = !parsed.streetNumber || String(r.StreetNumber || "").toLowerCase() === parsed.streetNumber.toLowerCase();
  const streetMatch = !parsed.streetName || normalizeText(r.StreetName).includes(normalizeText(parsed.streetName));
  return numberMatch && streetMatch;
}

function samePhysicalAddress(a, b) {
  const num = String(a.StreetNumber || "").trim().toLowerCase() === String(b.StreetNumber || "").trim().toLowerCase();
  const street = normalizeText(a.StreetName) === normalizeText(b.StreetName);
  const unitA = normalizeText(a.UnitNumber || a.ApartmentNumber || "");
  const unitB = normalizeText(b.UnitNumber || b.ApartmentNumber || "");
  const unit = !unitA || !unitB || unitA === unitB;
  return num && street && unit;
}

function isActiveForSale(p) {
  const status = `${p.StandardStatus || ""} ${p.MlsStatus || ""} ${p.ContractStatus || ""}`.toLowerCase();
  const sale = /for sale/i.test(p.TransactionType || "") || !p.TransactionType;
  const inactive = /closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/i.test(status);
  const active = /active|available|new/i.test(status);
  return sale && active && !inactive;
}

function withinTenYears(r) {
  const d = validDate(r.OriginalEntryTimestamp) || validDate(r.ModificationTimestamp) || validDate(r.SystemModificationTimestamp);
  return !d || d >= TEN_YEARS_AGO;
}

function summarizeHistory(history, subject) {
  const records = dedupe(history.filter(Boolean)).filter(withinTenYears).sort(mostRecentRecord);
  const latest = records[0] || subject;
  const latestSold = records
    .map((r) => historicalSoldSummary(r))
    .filter(Boolean)
    .sort((a, b) => dateMs(b.date) - dateMs(a.date))[0] || null;

  return {
    years: 10,
    appearanceCount: records.length,
    lastStatus: latest?.StandardStatus || latest?.MlsStatus || latest?.ContractStatus || null,
    lastListPrice: numberOrNull(latest?.ListPrice),
    lastSeenDate: dateOnly(latest?.OriginalEntryTimestamp || latest?.ModificationTimestamp),
    latestSold,
  };
}

function historicalSoldSummary(r) {
  const status = `${r.StandardStatus || ""} ${r.MlsStatus || ""} ${r.ContractStatus || ""}`;
  const soldLike = /closed|sold/i.test(status);
  const price = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const date = firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]);
  if (!soldLike || !price || !validDate(date)) return null;
  return { price, date: dateOnly(date) };
}

async function buildComparableContext(subject, currentListingKey, env, activeForSale) {
  const base = [];
  if (subject.CityRegion) base.push(`CityRegion eq '${odataString(subject.CityRegion)}'`);
  else if (subject.City) base.push(`City eq '${odataString(subject.City)}'`);
  if (subject.PropertyType) base.push(`PropertyType eq '${odataString(subject.PropertyType)}'`);
  if (subject.TransactionType && /for sale/i.test(subject.TransactionType)) base.push(`TransactionType eq '${odataString(subject.TransactionType)}'`);

  const [recentRaw, unavailableRaw, activeRaw] = await Promise.all([
    queryProperties(base, env, 180, "ModificationTimestamp desc,ListingKey desc"),
    queryProperties([...base, `ContractStatus ne 'Available'`], env, 140, "ModificationTimestamp desc,ListingKey desc"),
    queryProperties([...base, `ContractStatus eq 'Available'`], env, 100, "ModificationTimestamp desc,ListingKey desc"),
  ]);

  const raw = dedupe([...recentRaw, ...unavailableRaw, ...activeRaw])
    .filter((r) => r.ListingKey !== currentListingKey)
    .filter(withinTenYears);

  const marketIndex = buildTemporalMarketIndex(raw, subject);

  const candidates = raw
    .map((r) => normalizeComparable(subject, r, marketIndex))
    .filter((c) => c.price && c.similarity >= 28)
    .sort(compareMatch);

  const sold = candidates.filter((c) => c.source === "sold").slice(0, 8);
  const active = candidates.filter((c) => c.source === "active").slice(0, 8);
  const historical = candidates.filter((c) => c.source === "historical").slice(0, 10);

  let selected = [];
  let source = "";
  if (sold.length >= 3) {
    selected = sold.slice(0, 7);
    source = "sold";
  } else if (sold.length + active.length >= 4) {
    selected = [...sold.slice(0, 4), ...active.slice(0, 5)].sort(compareMatch).slice(0, 7);
    source = sold.length ? "blended" : "active";
  } else if (active.length + historical.length >= 3) {
    selected = [...active.slice(0, 5), ...historical.slice(0, 6)].sort(compareMatch).slice(0, 7);
    source = active.length ? "market_blend" : "historical";
  } else {
    selected = candidates.slice(0, 5);
    source = selected[0]?.source || "";
  }

  const latestSold = sold
    .filter((c) => c.soldDate)
    .sort((a, b) => b.soldDate.getTime() - a.soldDate.getTime())[0] || null;

  if (!selected.length) {
    return {
      available: false,
      source: null,
      area: subject.CityRegion || subject.City || null,
      matchCount: 0,
      latestSold: latestSold ? soldSummary(latestSold) : null,
      method: "THM Similarity Engine v2",
      basis: "No reliable match set returned from the current IDX feed."
    };
  }

  const band = similarityWeightedBand(selected);
  const avgScore = selected.reduce((sum, item) => sum + item.similarity, 0) / selected.length;
  const sourceLabel = sourceLabelFor(source);
  const confidence = confidenceLabel(selected.length, avgScore, source);

  return {
    available: true,
    source,
    sourceLabel,
    area: subject.CityRegion || subject.City || null,
    matchCount: selected.length,
    confidence,
    rangeLow: band.low,
    midpoint: band.mid,
    rangeHigh: band.high,
    latestSold: latestSold ? soldSummary(latestSold) : null,
    method: "THM Similarity Engine v2",
    basis: buildBasisText(subject, selected),
    historicalAdjustedCount: selected.filter((x) => x.source === "historical").length,
    activeCount: selected.filter((x) => x.source === "active").length,
    soldCount: selected.filter((x) => x.source === "sold").length,
    activeForSale,
  };
}

function normalizeComparable(subject, r, marketIndex) {
  const status = `${r.StandardStatus || ""} ${r.MlsStatus || ""} ${r.ContractStatus || ""}`;
  const soldLike = /closed|sold/i.test(status);
  const activeLike = isActiveForSale(r);
  const soldPrice = firstFiniteNumber(r, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice", "ClosedPrice", "FinalSalePrice"]);
  const soldDateRaw = firstValue(r, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate", "ClosingDate"]);
  const soldDate = validDate(soldDateRaw);
  const listPrice = numberOrNull(r.ListPrice);
  const recordDate = soldDate || validDate(r.OriginalEntryTimestamp) || validDate(r.ModificationTimestamp);

  let source = null;
  let price = null;
  if (soldLike && soldPrice) {
    source = "sold";
    price = soldPrice;
  } else if (activeLike && listPrice) {
    source = "active";
    price = listPrice;
  } else if (!activeLike && listPrice) {
    source = "historical";
    price = timeAdjustHistoricalPrice(listPrice, recordDate, marketIndex);
  }

  const similarity = similarityScore(subject, r);
  const recency = recencyWeight(recordDate);
  const reliability = source === "sold" ? 1 : source === "active" ? 0.78 : 0.58;

  return { record: r, source, price, rawListPrice: listPrice, soldPrice, soldDate, similarity, recency, reliability };
}

function buildTemporalMarketIndex(raw, subject) {
  const nowYear = new Date().getFullYear();
  const groups = new Map();
  for (const r of raw) {
    const price = numberOrNull(r.ListPrice);
    const d = validDate(r.OriginalEntryTimestamp) || validDate(r.ModificationTimestamp);
    if (!price || !d) continue;
    const sim = similarityScore(subject, r);
    if (sim < 30) continue;
    const year = d.getFullYear();
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(price);
  }

  const recentYears = [nowYear, nowYear - 1];
  const recentPrices = recentYears.flatMap((y) => groups.get(y) || []);
  const recentMedian = median(recentPrices);
  return { groups, recentMedian };
}

function timeAdjustHistoricalPrice(price, date, index) {
  if (!price || !date || !index?.recentMedian) return price;
  const yearPrices = index.groups.get(date.getFullYear()) || [];
  const oldMedian = median(yearPrices);
  if (!oldMedian || yearPrices.length < 3) {
    const years = Math.max(0, new Date().getFullYear() - date.getFullYear());
    const gentleFallback = Math.pow(1.025, Math.min(years, 10));
    return roundMarket(price * gentleFallback);
  }
  const factor = clamp(index.recentMedian / oldMedian, 0.65, 1.65);
  return roundMarket(price * factor);
}

function buildPriceOpinion(subject, comp, history, activeForSale) {
  if (!comp?.available) {
    return {
      available: false,
      label: activeForSale ? "THM comp range unavailable" : "THM price opinion unavailable",
      note: "The current IDX match set is too thin to produce a responsible range."
    };
  }

  return {
    available: true,
    low: comp.rangeLow,
    midpoint: comp.midpoint,
    high: comp.rangeHigh,
    label: activeForSale ? "THM comp range" : "THM price opinion",
    confidence: comp.confidence,
    note: activeForSale
      ? `${comp.sourceLabel}; similarity and recency weighted.`
      : `${comp.sourceLabel}; includes up to 10 years of MLS history with older list prices time-adjusted to the current local asking level. This is not an appraisal or CMA.`,
    historyCount: history?.appearanceCount || 0,
  };
}

async function queryProperties(filters, env, top = 100, orderby = "ModificationTimestamp desc,ListingKey desc") {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  if (filters?.length) params.set("$filter", filters.join(" and "));
  params.set("$orderby", orderby);

  try {
    const response = await amplifyFetch(`https://query.ampre.ca/odata/Property?${params.toString()}`, env);
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
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

function similarityScore(subject, c) {
  let earned = 0;
  let possible = 0;
  const add = (weight, value) => { possible += weight; earned += weight * clamp(value, 0, 1); };

  if (subject.CityRegion && c.CityRegion) add(18, sameText(subject.CityRegion, c.CityRegion) ? 1 : 0);
  else if (subject.City && c.City) add(12, sameText(subject.City, c.City) ? 1 : 0);

  if (subject.PropertyType && c.PropertyType) add(10, sameText(subject.PropertyType, c.PropertyType) ? 1 : 0);
  if (subject.PropertySubType && c.PropertySubType) add(20, sameText(subject.PropertySubType, c.PropertySubType) ? 1 : 0);

  const bedA = numberOrNull(subject.BedroomsTotal), bedB = numberOrNull(c.BedroomsTotal);
  if (bedA != null && bedB != null) add(11, diffScore(bedA, bedB, 2));
  const bathA = numberOrNull(subject.BathroomsTotalInteger), bathB = numberOrNull(c.BathroomsTotalInteger);
  if (bathA != null && bathB != null) add(9, diffScore(bathA, bathB, 2));

  const areaA = rangeMid(subject.LivingAreaRange) || numberOrNull(subject.BuildingAreaTotal);
  const areaB = rangeMid(c.LivingAreaRange) || numberOrNull(c.BuildingAreaTotal);
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
  const aWeight = a.similarity * 0.75 + a.recency * 17 + a.reliability * 8;
  const bWeight = b.similarity * 0.75 + b.recency * 17 + b.reliability * 8;
  return bWeight - aWeight;
}

function similarityWeightedBand(matches) {
  const items = matches.map((m) => ({
    price: m.price,
    weight: Math.max(0.04, Math.pow(m.similarity / 100, 2) * (0.35 + 0.45 * m.recency + 0.20 * m.reliability))
  })).sort((a, b) => a.price - b.price);

  let low = weightedQuantile(items, 0.18);
  let mid = weightedQuantile(items, 0.50);
  let high = weightedQuantile(items, 0.82);
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

function soldSummary(c) {
  return { price: c.soldPrice || c.price, date: dateOnly(c.soldDate) };
}

function sourceLabelFor(source) {
  if (source === "sold") return "Recent sold matches";
  if (source === "blended") return "Sold + live market matches";
  if (source === "active") return "Live asking competition";
  if (source === "market_blend") return "Live + historical MLS matches";
  if (source === "historical") return "10-year historical MLS matches";
  return "THM market matches";
}

function confidenceLabel(count, avgScore, source) {
  const reliability = source === "sold" ? 1 : source === "blended" ? 0.9 : source === "active" ? 0.78 : 0.65;
  const composite = avgScore * 0.65 + Math.min(count, 7) / 7 * 20 + reliability * 15;
  if (composite >= 72) return "Strong";
  if (composite >= 58) return "Good";
  return "Indicative";
}

function buildBasisText(subject, matches) {
  const bits = [];
  const subtypeHits = matches.filter((m) => sameText(subject.PropertySubType, m.record.PropertySubType)).length;
  if (subject.PropertySubType && subtypeHits) bits.push(`${subtypeHits}/${matches.length} same subtype`);
  const bed = numberOrNull(subject.BedroomsTotal);
  if (bed != null) {
    const nearBeds = matches.filter((m) => {
      const b = numberOrNull(m.record.BedroomsTotal);
      return b != null && Math.abs(b - bed) <= 1;
    }).length;
    if (nearBeds) bits.push(`${nearBeds}/${matches.length} within ±1 bed`);
  }
  if (subject.LivingAreaRange || subject.LotWidth) bits.push("size/lot weighted");
  bits.push("recency weighted");
  return bits.join(" · ");
}

function buildShowingFocus(p) {
  const remarks = String(p.PublicRemarks || "");
  if (/separate entrance|apartment|unit|income|multi-generational|multi generational/i.test(remarks)) {
    return { title: "Verify unit potential", note: "Check entrances, ceiling heights, egress, utilities and whether any secondary-unit use/alterations are legal and permitted." };
  }
  if (/renovat|updated|upgrade|newly/i.test(remarks)) {
    return { title: "Verify renovation quality", note: "Look past finishes: ask about permits, ages of major systems, workmanship and what was actually replaced." };
  }
  if (numberOrNull(p.LotWidth) && numberOrNull(p.LotDepth)) {
    return { title: "Walk the lot + structure", note: "Check grading, drainage, exterior condition, garage/parking utility and how the lot actually feels in person." };
  }
  return { title: "Condition + layout", note: "Verify the condition, natural light, room scale, noise, mechanical systems and anything photos cannot show." };
}

function buildOffMarketFocus(p, history) {
  const bits = [];
  if (history?.appearanceCount) bits.push(`${history.appearanceCount} MLS appearance${history.appearanceCount === 1 ? "" : "s"} found in 10 years`);
  if (history?.lastStatus) bits.push(`last status: ${history.lastStatus}`);
  return {
    title: "Off-market value check",
    note: bits.length ? bits.join(" · ") : "No active listing. THM is estimating from available historical and current neighbourhood records."
  };
}

function buildAddress(p) {
  return [p.StreetNumber, p.StreetName, p.StreetSuffix, p.UnitNumber, p.City, p.StateOrProvince, p.PostalCode].filter(Boolean).join(" ");
}

function mostRecentRecord(a, b) {
  return dateMs(b.OriginalEntryTimestamp || b.ModificationTimestamp) - dateMs(a.OriginalEntryTimestamp || a.ModificationTimestamp);
}

function dateMs(value) {
  const d = validDate(value);
  return d ? d.getTime() : 0;
}

function daysSince(value) {
  const d = validDate(value);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function recencyWeight(date) {
  if (!date) return 0.25;
  const months = Math.max(0, (Date.now() - date.getTime()) / (86400000 * 30.44));
  return Math.max(0.12, Math.exp(-months / 30));
}

function diffScore(a, b, maxDiff) { return Math.max(0, 1 - Math.abs(a - b) / maxDiff); }
function ratioCloseness(a, b, tolerance) { return Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b) / tolerance); }
function sameText(a, b) { return normalizeText(a) === normalizeText(b); }
function cleanText(value) { return typeof value === "string" ? value.trim() : value || null; }
function normalizeText(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function arrayText(value) { return Array.isArray(value) ? value.join(" ") : String(value || ""); }

function tokenOverlap(a, b) {
  const A = new Set(normalizeText(a).split(" ").filter(Boolean));
  const B = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / Math.max(A.size, B.size);
}

function rangeMid(value) {
  if (!value) return null;
  const nums = String(value).match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite) || [];
  if (!nums.length) return null;
  return nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function validDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(value) {
  const d = validDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function roundMarket(value) {
  if (!Number.isFinite(value)) return null;
  const step = value >= 1000000 ? 10000 : 5000;
  return Math.round(value / step) * step;
}

function median(values) {
  const nums = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function odataString(value) { return String(value || "").replace(/'/g, "''"); }

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

async function amplifyFetch(endpoint, env) {
  return fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${env.AMPRE_TOKEN}`,
      Accept: "application/json",
    },
  });
}

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
