import app from "./worker-v4.js";

const AMPRE = "https://query.ampre.ca/odata";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/property" && request.method === "GET") {
      const listingKey = clean(url.searchParams.get("listingKey"), 50).toUpperCase();
      const q = clean(url.searchParams.get("q"), 1000);

      // MLS and URLs continue through the normal property pipeline.
      if (listingKey || !q || /^https?:\/\//i.test(q) || /^[A-Z]\d{7,9}$/i.test(q)) {
        return app.fetch(request, env, ctx);
      }

      const parsed = parseAddress(q);
      if (parsed.number && parsed.name && env.AMPRE_TOKEN) {
        const match = await resolveAddressFromAmpre(parsed, env);
        if (match?.ListingKey) {
          const direct = new URL(url.origin + "/api/property");
          direct.searchParams.set("listingKey", String(match.ListingKey));
          const response = await app.fetch(new Request(direct.toString(), {
            method: "GET",
            headers: request.headers,
          }), env, ctx);

          let body;
          try { body = await response.clone().json(); } catch { return response; }
          if (response.ok && body?.ok && body?.property) {
            body.property.inputValidation = {
              type: "address",
              status: "validated",
              label: `Address matched to MLS ${match.ListingKey}`,
            };
            body.property.resolution = body.property.forSale ? "address_live" : "address_history";
            return json(body, response.status);
          }
          return response;
        }
      }
    }

    return app.fetch(request, env, ctx);
  },
};

async function resolveAddressFromAmpre(a, env) {
  const number = odata(a.number);
  const street = smartCase(a.name);
  const suffix = a.suffix ? smartCase(a.suffix) : "";
  const full = `${a.number} ${street}${suffix ? ` ${suffix}` : ""}`;

  // AMPRE documents contains/startswith, but not tolower/toupper.
  // Try narrow documented filters first, then a number-only query and
  // perform case-insensitive matching locally as the reliable fallback.
  const attempts = [
    { filter: `startswith(UnparsedAddress,'${odata(full)}')`, top: 100 },
    { filter: `StreetNumber eq '${number}' and StreetName eq '${odata(street)}'`, top: 100 },
    { filter: `StreetNumber eq '${number}' and startswith(StreetName,'${odata(street)}')`, top: 100 },
    { filter: `StreetNumber eq '${number}' and contains(StreetName,'${odata(street)}')`, top: 100 },
    { filter: `StreetNumber eq '${number}'`, top: 10000 },
  ];

  for (const attempt of attempts) {
    const rows = await propertyQuery(attempt.filter, attempt.top, env);
    const ranked = rows
      .map((r) => ({ r, score: addressScore(a, r) }))
      .filter((x) => x.score >= 78)
      .sort((x, y) => {
        const activeDiff = Number(isActive(y.r)) - Number(isActive(x.r));
        if (activeDiff) return activeDiff;
        if (y.score !== x.score) return y.score - x.score;
        return recordTime(y.r) - recordTime(x.r);
      });
    if (ranked.length) return ranked[0].r;
  }

  return null;
}

async function propertyQuery(filter, top, env) {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$filter", filter);
  params.set("$select", [
    "ListingKey","StreetNumber","StreetName","StreetSuffix","UnparsedAddress",
    "City","StateOrProvince","PostalCode","StandardStatus","MlsStatus",
    "ContractStatus","TransactionType","ModificationTimestamp","OriginalEntryTimestamp"
  ].join(","));
  params.set("$orderby", "ModificationTimestamp,ListingKey desc");

  try {
    const response = await fetch(`${AMPRE}/Property?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${env.AMPRE_TOKEN}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}

function parseAddress(raw) {
  const input = String(raw || "").replace(/\s+/g, " ").trim();
  const first = input.split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};

  const suffixMap = new Map([
    ["street","Street"],["st","Street"],["road","Road"],["rd","Road"],
    ["avenue","Avenue"],["ave","Avenue"],["drive","Drive"],["dr","Drive"],
    ["crescent","Crescent"],["cres","Crescent"],["court","Court"],["ct","Court"],
    ["boulevard","Boulevard"],["blvd","Boulevard"],["lane","Lane"],["ln","Lane"],
    ["way","Way"],["trail","Trail"],["tr","Trail"],["place","Place"],["pl","Place"],
    ["terrace","Terrace"],["terr","Terrace"],["circle","Circle"],["cir","Circle"],
    ["gardens","Gardens"],["gdns","Gardens"],["gate","Gate"],["grove","Grove"],
    ["heights","Heights"],["hts","Heights"],
  ]);

  const tokens = m[2].trim().split(/\s+/);
  const last = (tokens[tokens.length - 1] || "").replace(/\./g, "").toLowerCase();
  const suffix = suffixMap.get(last) || null;
  if (suffix) tokens.pop();

  return {
    number: m[1].trim(),
    name: normalize(tokens.join(" ")),
    suffix,
  };
}

function addressScore(a, r) {
  let score = 0;
  const num = normalize(r?.StreetNumber);
  const name = normalize(r?.StreetName);
  const suffix = normalize(r?.StreetSuffix);
  const unparsed = normalize(r?.UnparsedAddress);

  if (num === normalize(a.number)) score += 45;
  if (name === a.name) score += 45;
  else if (name.includes(a.name) || a.name.includes(name)) score += 30;
  if (a.suffix && suffix === normalize(a.suffix)) score += 7;
  if (unparsed.startsWith(`${normalize(a.number)} ${a.name}`)) score += 8;
  if (isActive(r)) score += 5;
  return Math.min(100, score);
}

function isActive(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(r?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new/.test(status) &&
    !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}

function recordTime(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function smartCase(v) {
  return String(v || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function normalize(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function odata(v) {
  return String(v || "").replace(/'/g, "''");
}

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
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
