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

  const offerTiming = detectOfferTiming(p);
  const soldContext = await getNearbySoldContext(p, listingKey, env);

  return json({
    ok: true,
    property: {
      listingKey: p.ListingKey,
      address: p.UnparsedAddress,
      city: p.City,
      cityRegion: p.CityRegion || null,
      postalCode: p.PostalCode,
      listPrice: p.ListPrice,
      status: p.StandardStatus,
      transactionType: p.TransactionType,
      propertyType: p.PropertyType,
      propertySubType: p.PropertySubType,
      beds: p.BedroomsTotal,
      baths: p.BathroomsTotalInteger,
      livingAreaRange: p.LivingAreaRange,
      lotWidth: p.LotWidth,
      lotDepth: p.LotDepth,
      parkingTotal: p.ParkingTotal,
      garageType: p.GarageType,
      basement: p.Basement,
      kitchensTotal: p.KitchensTotal,
      remarks: p.PublicRemarks,
      originalEntryTimestamp: p.OriginalEntryTimestamp,
      modificationTimestamp: p.ModificationTimestamp,
      offerTiming,
      soldContext,
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
    "PrivateRemarks",
    "PrivateRemarksExtras",
    "BrokerageRemarks",
    "BrokerRemarks",
    "RemarksForBrokerage",
    "PublicRemarksExtras",
    "PublicRemarks",
  ];

  const availableRemarks = remarkFields
    .map((key) => (typeof p[key] === "string" ? p[key].trim() : ""))
    .filter(Boolean);

  const text = availableRemarks.join(" \n");
  if (!text) {
    return {
      type: "anytime",
      label: "Offers anytime",
      note: "No offer date detected in IDX-accessible remarks. Realtor verification required.",
    };
  }

  const offerParts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((part) => /\boffer(?:s|ing)?\b|offer presentation|presentation of offers/i.test(part));

  const relevant = offerParts.join(" ");

  if (/\b(any\s*time|offers?\s+anytime|offers?\s+welcome\s+anytime|accept(?:ing|ed)?\s+offers?\s+anytime)\b/i.test(relevant)) {
    return {
      type: "anytime",
      label: "Offers anytime",
      note: "No scheduled offer presentation detected. Realtor verification required.",
    };
  }

  const monthDate = relevant.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i);
  const numericDate = relevant.match(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/);
  const time = relevant.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i);
  const date = monthDate?.[0] || numericDate?.[0] || null;

  if (relevant && (date || time)) {
    const pieces = [date, time?.[0]].filter(Boolean);
    return {
      type: "scheduled",
      label: `Offer date: ${pieces.join(" · ")}`,
      note: "Offer timing detected in IDX-accessible remarks. Realtor will verify before submission.",
    };
  }

  if (relevant && /offer presentation|present(?:ing|ation)? offers|review(?:ing)? offers/i.test(relevant)) {
    return {
      type: "verify",
      label: "Offer presentation mentioned",
      note: "A specific offer-presentation reference was detected; exact timing requires Realtor verification.",
    };
  }

  return {
    type: "anytime",
    label: "Offers anytime",
    note: "No offer date detected in IDX-accessible remarks. Realtor verification required.",
  };
}

async function getNearbySoldContext(p, currentListingKey, env) {
  const baseFilters = ["StandardStatus eq 'Closed'", "TransactionType eq 'For Sale'"];
  const areaFilter = p.CityRegion
    ? `CityRegion eq '${odataString(p.CityRegion)}'`
    : p.City
      ? `City eq '${odataString(p.City)}'`
      : null;

  if (areaFilter) baseFilters.push(areaFilter);
  if (p.PropertyType) baseFilters.push(`PropertyType eq '${odataString(p.PropertyType)}'`);

  const strictFilters = [...baseFilters];
  if (p.PropertySubType) strictFilters.push(`PropertySubType eq '${odataString(p.PropertySubType)}'`);
  if (Number.isFinite(p.BedroomsTotal)) {
    const minBeds = Math.max(0, Number(p.BedroomsTotal) - 1);
    const maxBeds = Number(p.BedroomsTotal) + 1;
    strictFilters.push(`BedroomsTotal ge ${minBeds}`, `BedroomsTotal le ${maxBeds}`);
  }

  let records = await querySold(strictFilters, env);
  if (records.length < 3) records = await querySold(baseFilters, env);

  const sold = records
    .filter((record) => record.ListingKey !== currentListingKey)
    .map((record) => {
      const price = firstFiniteNumber(record, ["ClosePrice", "SoldPrice", "SalePrice", "PurchaseContractPrice"]);
      const dateRaw = firstValue(record, ["PurchaseContractDate", "SoldDate", "CloseDate", "ContractDate"]);
      const date = validDate(dateRaw);
      return price && date ? { price, date } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (!sold.length) {
    return {
      available: false,
      area: p.CityRegion || p.City || null,
      sampleSize: 0,
    };
  }

  const recent = sold.slice(0, 5);
  const prices = recent.map((item) => item.price).sort((a, b) => a - b);
  const latest = sold[0];

  return {
    available: true,
    area: p.CityRegion || p.City || null,
    sampleSize: recent.length,
    rangeLow: prices[0],
    rangeHigh: prices[prices.length - 1],
    latestSoldPrice: latest.price,
    latestSoldDate: latest.date.toISOString().slice(0, 10),
  };
}

async function querySold(filters, env) {
  const params = new URLSearchParams();
  params.set("$top", "40");
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

function odataString(value) {
  return String(value).replace(/'/g, "''");
}

function firstFiniteNumber(record, keys) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function firstValue(record, keys) {
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key];
  }
  return null;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function handleLead(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Lead system is not configured." }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  if (typeof payload.website === "string" && payload.website.trim()) {
    return json({ ok: true }, 200);
  }

  const propertyInput = clean(payload.property_input, 1000);
  const listingKey = clean(payload.listing_key, 32) || null;
  const name = clean(payload.name, 160);
  const mobile = clean(payload.mobile, 50);
  const email = clean(payload.email, 254).toLowerCase() || null;
  const showingTiming = clean(payload.showing_timing, 30) || "asap";

  if (!propertyInput || !name || !mobile) {
    return json({ ok: false, error: "Property, name and mobile are required." }, 400);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please enter a valid email." }, 400);
  }

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

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
