import baseWorker from "./worker.js";

const ALLOWED_LINK_HOSTS = [
  "realtor.ca",
  "www.realtor.ca",
  "housesigma.com",
  "www.housesigma.com",
  "torontohousemarket.com",
  "www.torontohousemarket.com",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/property" && request.method === "GET") {
      return handleEnhancedProperty(request, env, ctx);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleEnhancedProperty(request, env, ctx) {
  const originalUrl = new URL(request.url);
  let listingKey = (originalUrl.searchParams.get("listingKey") || "").trim().toUpperCase();
  let query = (originalUrl.searchParams.get("q") || "").trim();
  let inputValidation = null;

  if (query && /^https?:\/\//i.test(query)) {
    const resolved = await resolveListingLink(query);
    if (!resolved.ok) {
      return json({
        ok: false,
        error: resolved.error,
        invalidLink: true,
        linkHost: resolved.host || null,
      }, 400);
    }

    inputValidation = {
      type: "listing_link",
      host: resolved.host,
      status: resolved.validationStatus,
      label: resolved.label,
    };

    if (resolved.listingKey) {
      listingKey = resolved.listingKey;
      query = "";
    } else if (resolved.address) {
      query = resolved.address;
    } else {
      return json({
        ok: false,
        error: "The link is valid, but we could not identify the property. Paste the MLS number or full address instead.",
        invalidLink: false,
        linkValidated: true,
      }, 422);
    }
  }

  const forwardUrl = new URL(originalUrl.origin + "/api/property");
  if (listingKey) forwardUrl.searchParams.set("listingKey", listingKey);
  else if (query) forwardUrl.searchParams.set("q", query);

  const baseRequest = new Request(forwardUrl.toString(), {
    method: "GET",
    headers: request.headers,
  });

  const baseResponse = await baseWorker.fetch(baseRequest, env, ctx);
  let result;
  try {
    result = await baseResponse.clone().json();
  } catch {
    return baseResponse;
  }

  if (!baseResponse.ok || !result?.ok || !result?.property) {
    if (inputValidation) result.inputValidation = inputValidation;
    return json(result, baseResponse.status);
  }

  const property = result.property;
  const key = property.listingKey;

  if (inputValidation) property.inputValidation = inputValidation;

  if (key && env.AMPRE_TOKEN) {
    const [rawDetails, photos] = await Promise.all([
      fetchPropertyDetails(key, env),
      property.forSale ? fetchPropertyPhotos(key, env) : Promise.resolve([]),
    ]);

    if (rawDetails) property.details = normalizeDetails(rawDetails);
    property.photos = photos;
    property.photoCount = photos.length;
  } else {
    property.photos = [];
    property.photoCount = 0;
  }

  property.fastShowing = property.forSale ? {
    available: true,
    targetWindow: "1–24 hours",
    headline: "Target showing: 1–24 hours",
    note: "We route your request immediately. Actual showing time depends on the listing, seller and property-access availability.",
  } : {
    available: false,
    targetWindow: null,
    headline: "Not currently for sale",
    note: "No active for-sale listing was found. You can still request a deeper AI property or seller report.",
  };

  return json({ ...result, property }, 200);
}

async function resolveListingLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That does not look like a valid listing link." };
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_LINK_HOSTS.includes(host)) {
    return {
      ok: false,
      host,
      error: "For link lookup, use a Realtor.ca or HouseSigma property link. You can always paste any MLS number or full address.",
    };
  }

  const mls = raw.toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  if (mls) {
    return {
      ok: true,
      host,
      listingKey: mls[0],
      validationStatus: "validated",
      label: host.includes("realtor") ? "Realtor.ca link validated" : host.includes("housesigma") ? "HouseSigma link validated" : "Property link validated",
    };
  }

  let address = addressFromSlug(url.pathname);
  let fetched = false;

  if (!address && (host.includes("realtor.ca") || host.includes("housesigma.com"))) {
    try {
      const response = await fetch(url.toString(), {
        redirect: "follow",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; TorontoHouseMarket/1.0)",
        },
      });
      fetched = response.ok;
      if (response.ok) {
        const html = (await response.text()).slice(0, 350000);
        const title = extractMeta(html, "og:title") || extractTitle(html);
        address = addressFromText(title);
      }
    } catch {}
  }

  return {
    ok: true,
    host,
    address,
    validationStatus: fetched ? "validated" : "recognized",
    label: fetched ? "Listing link validated" : "Listing link recognized",
  };
}

function addressFromSlug(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  const candidates = parts
    .map((part) => decodeURIComponent(part).replace(/[-_+]+/g, " ").trim())
    .filter((part) => /^\d+[a-z]?\s+/i.test(part));

  for (const candidate of candidates.reverse()) {
    const parsed = trimAfterStreetSuffix(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function trimAfterStreetSuffix(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const suffix = /\b(street|st|road|rd|avenue|ave|drive|dr|crescent|cres|court|ct|boulevard|blvd|lane|ln|way|trail|tr|place|pl|terrace|terr|circle|cir|gardens|gdns|gate|grove|grv|heights|hts)\b/i;
  const match = suffix.exec(clean);
  if (!match) return null;
  const end = match.index + match[0].length;
  const street = clean.slice(0, end).trim();
  const remainder = clean.slice(end).trim();
  const city = /\btoronto\b/i.test(remainder) ? "Toronto" : /\bvaughan\b/i.test(remainder) ? "Vaughan" : /\bmarkham\b/i.test(remainder) ? "Markham" : /\brichmond hill\b/i.test(remainder) ? "Richmond Hill" : /\bmississauga\b/i.test(remainder) ? "Mississauga" : null;
  return city ? `${street}, ${city}` : street;
}

function addressFromText(text) {
  if (!text) return null;
  const normalized = String(text).replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const match = normalized.match(/\b\d+[A-Za-z]?\s+[A-Za-z0-9.'’ -]{2,60}\b(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl|Terrace|Terr|Circle|Cir|Gardens|Gdns|Gate|Grove|Grv|Heights|Hts)\b/i);
  if (!match) return null;
  const city = /\bToronto\b/i.test(normalized) ? "Toronto" : /\bVaughan\b/i.test(normalized) ? "Vaughan" : /\bMarkham\b/i.test(normalized) ? "Markham" : /\bRichmond Hill\b/i.test(normalized) ? "Richmond Hill" : /\bMississauga\b/i.test(normalized) ? "Mississauga" : null;
  return city ? `${match[0]}, ${city}` : match[0];
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i").exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i").exec(html);
  return (a?.[1] || b?.[1] || "").trim() || null;
}

function extractTitle(html) {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim() || null;
}

async function fetchPropertyDetails(listingKey, env) {
  const fields = [
    "ListingKey","ArchitecturalStyle","ConstructionMaterials","InteriorFeatures","ExteriorFeatures",
    "Cooling","HeatType","HeatSource","DirectionFaces","ParkingFeatures","PoolFeatures","PossessionType",
    "PossessionDetails","TaxAnnualAmount","TaxYear","ListOfficeName","CityRegion","CrossStreet",
    "OriginalEntryTimestamp","PhotosChangeTimestamp","InternetAddressDisplayYN","InternetEntireListingDisplayYN"
  ].join(",");

  const endpoint = `https://query.ampre.ca/odata/Property('${encodeURIComponent(listingKey)}')?$select=${fields}`;
  try {
    const response = await amplifyFetch(endpoint, env);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchPropertyPhotos(listingKey, env) {
  const params = new URLSearchParams();
  params.set("$top", "60");
  params.set("$filter", `ResourceRecordKey eq '${odataString(listingKey)}' and ResourceName eq 'Property' and ImageSizeDescription eq 'Large'`);

  let records = [];
  try {
    let response = await amplifyFetch(`https://query.ampre.ca/odata/Media?${params.toString()}`, env);
    if (response.ok) {
      const body = await response.json();
      records = Array.isArray(body.value) ? body.value : [];
    }

    if (!records.length) {
      const fallback = new URLSearchParams();
      fallback.set("$top", "60");
      fallback.set("$filter", `ResourceRecordKey eq '${odataString(listingKey)}' and ResourceName eq 'Property'`);
      response = await amplifyFetch(`https://query.ampre.ca/odata/Media?${fallback.toString()}`, env);
      if (response.ok) {
        const body = await response.json();
        records = Array.isArray(body.value) ? body.value : [];
      }
    }
  } catch {
    return [];
  }

  const images = records
    .filter((m) => m?.MediaURL && (!m.MediaType || String(m.MediaType).toLowerCase().startsWith("image/")))
    .map((m, index) => ({
      url: m.MediaURL,
      key: m.MediaKey || `${listingKey}-${index}`,
      order: finite(m.Order) ?? finite(m.MediaOrder) ?? finite(m.SequenceNumber) ?? index,
      description: m.ShortDescription || m.LongDescription || null,
    }))
    .sort((a, b) => a.order - b.order);

  const seen = new Set();
  return images.filter((img) => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  }).slice(0, 36);
}

function normalizeDetails(p) {
  return {
    architecturalStyle: arrayValue(p.ArchitecturalStyle),
    construction: arrayValue(p.ConstructionMaterials),
    interior: arrayValue(p.InteriorFeatures),
    exterior: arrayValue(p.ExteriorFeatures),
    cooling: arrayValue(p.Cooling),
    heating: arrayValue(p.HeatType || p.HeatSource),
    direction: p.DirectionFaces || null,
    parking: arrayValue(p.ParkingFeatures),
    pool: arrayValue(p.PoolFeatures),
    possession: p.PossessionDetails || p.PossessionType || null,
    annualTax: finite(p.TaxAnnualAmount),
    taxYear: finite(p.TaxYear),
    listingOffice: p.ListOfficeName || null,
    cityRegion: p.CityRegion || null,
    crossStreet: p.CrossStreet || null,
    listedAt: p.OriginalEntryTimestamp || null,
  };
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function odataString(value) {
  return String(value || "").replace(/'/g, "''");
}

async function amplifyFetch(endpoint, env) {
  return fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${env.AMPRE_TOKEN}`,
      Accept: "application/json",
    },
  });
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
