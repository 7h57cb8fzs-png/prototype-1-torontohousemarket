import app from "./worker-v7.js";

const AMPRE = "https://query.ampre.ca/odata";
const VERSION = "phase2-address-v8-20260814-2120";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({ ok: true, version: VERSION, addressResolver: "unparsed-contains-local-exact" });
    }

    if (url.pathname === "/api/property" && request.method === "GET") {
      const directKey = clean(url.searchParams.get("listingKey"), 50);
      const q = clean(url.searchParams.get("q"), 1000);

      if (!directKey && q && !/^https?:\/\//i.test(q) && !/^[A-Z]\d{7,9}$/i.test(q)) {
        if (!env.AMPRE_TOKEN) return json({ ok:false, error:"IDX connection is not configured." }, 503);
        const parsed = parseAddress(q);
        if (parsed.number && parsed.name) {
          const match = await resolveByUnparsedAddress(parsed, env);
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
              body.property.resolvedFromAddress = true;
              return json(body, response.status);
            }
            return response;
          }
        }
      }
    }

    return app.fetch(request, env, ctx);
  },
};

async function resolveByUnparsedAddress(a, env) {
  const streetTokens = a.name.split(" ").filter(Boolean).sort((x, y) => y.length - x.length);
  const bestToken = displayToken(streetTokens[0] || a.name);
  const number = escapeOData(a.number);

  // This exact OData shape is based on the live AMPRE diagnostic that succeeded:
  // contains(UnparsedAddress,'Whitburn') -> 200 and returned W13676100.
  // Do not add $orderby or equality filters here; this feed rejected those combinations.
  const filters = [
    `contains(UnparsedAddress,'${escapeOData(bestToken)}')`,
    `contains(UnparsedAddress,'${number}')`,
  ];

  for (const filter of filters) {
    const rows = await runQuery(filter, env, filter.includes(bestToken) ? 250 : 1000);
    const exact = rows
      .map((r) => ({ r, score: exactAddressScore(a, r) }))
      .filter((x) => x.score >= 90)
      .sort((x, y) => {
        const activeDiff = Number(isActive(y.r)) - Number(isActive(x.r));
        if (activeDiff) return activeDiff;
        if (y.score !== x.score) return y.score - x.score;
        return recordTime(y.r) - recordTime(x.r);
      });
    if (exact.length) return exact[0].r;
  }
  return null;
}

async function runQuery(filter, env, top) {
  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$filter", filter);
  params.set("$select", [
    "ListingKey","StreetNumber","StreetName","StreetSuffix","UnparsedAddress",
    "City","StateOrProvince","PostalCode","StandardStatus","MlsStatus",
    "ContractStatus","TransactionType","ModificationTimestamp","OriginalEntryTimestamp"
  ].join(","));

  try {
    const response = await fetch(`${AMPRE}/Property?${params.toString()}`, {
      headers: { Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.value) ? body.value : [];
  } catch {
    return [];
  }
}

function parseAddress(raw) {
  const first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};

  const suffixMap = new Map([
    ["street","street"],["st","street"],["road","road"],["rd","road"],
    ["avenue","avenue"],["ave","avenue"],["drive","drive"],["dr","drive"],
    ["crescent","crescent"],["cres","crescent"],["court","court"],["ct","court"],
    ["boulevard","boulevard"],["blvd","boulevard"],["lane","lane"],["ln","lane"],
    ["way","way"],["trail","trail"],["tr","trail"],["place","place"],["pl","place"],
    ["terrace","terrace"],["terr","terrace"],["circle","circle"],["cir","circle"],
    ["gardens","gardens"],["gdns","gardens"],["gate","gate"],["grove","grove"],
    ["heights","heights"],["hts","heights"],
  ]);

  const tokens = m[2].trim().split(/\s+/);
  const last = normalize(tokens[tokens.length - 1]);
  const suffix = suffixMap.get(last) || null;
  if (suffix) tokens.pop();

  return {
    number: normalize(m[1]),
    name: normalize(tokens.join(" ")),
    suffix,
  };
}

function exactAddressScore(a, r) {
  let score = 0;
  const rowNumber = normalize(r?.StreetNumber);
  const rowName = normalize(r?.StreetName);
  const rowSuffix = normalize(r?.StreetSuffix);
  const unparsed = normalize(r?.UnparsedAddress);

  if (rowNumber === a.number) score += 45;
  if (rowName === a.name) score += 45;
  else if (rowName.includes(a.name) || a.name.includes(rowName)) score += 25;
  if (a.suffix && rowSuffix === a.suffix) score += 8;
  if (unparsed.startsWith(`${a.number} ${a.name}`)) score += 8;
  if (isActive(r)) score += 5;
  return Math.min(100, score);
}

function isActive(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(r?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new|price change/.test(status) &&
    !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}

function displayToken(v) {
  const s = String(v || "");
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function normalize(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function escapeOData(v) { return String(v || "").replace(/'/g, "''"); }
function clean(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function recordTime(r) { const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); }
function json(body, status=200) { return new Response(JSON.stringify(body), { status, headers:{ "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-THM-Version":VERSION } }); }
