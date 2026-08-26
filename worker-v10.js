import app from "./worker-v9.js";

const AMPRE = "https://query.ampre.ca/odata";
const VERSION = "phase2-address-v10-20260814-2130";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        addressResolver: "gta-street-type-aware-unparsed-contains",
        media: "unique-large-direct-with-proxy-fallback"
      });
    }

    if (url.pathname === "/api/property" && request.method === "GET") {
      const listingKey = clean(url.searchParams.get("listingKey"), 50);
      const q = clean(url.searchParams.get("q"), 1000);

      // Resolve human street addresses before handing off to the stable MLS-key path.
      if (!listingKey && q && !/^https?:\/\//i.test(q) && !/^[A-Z]\d{7,9}$/i.test(q)) {
        if (!env.AMPRE_TOKEN) return json({ ok:false, error:"IDX connection is not configured." }, 503);

        const parsed = parseAddress(q);
        if (parsed.number && parsed.name) {
          const match = await resolveAddress(parsed, env);
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

async function resolveAddress(a, env) {
  const tokens = a.name.split(" ").filter(Boolean).sort((x, y) => y.length - x.length);
  const searchTerms = [];

  // AMPRE has already proven contains(UnparsedAddress,...) works on this feed.
  // Search the most distinctive street-name token first, never the street type.
  for (const token of tokens) {
    if (token.length >= 3 && !searchTerms.includes(token)) searchTerms.push(token);
  }
  if (!searchTerms.length) searchTerms.push(a.name);

  for (const term of searchTerms.slice(0, 3)) {
    const filter = `contains(UnparsedAddress,'${escapeOData(displayToken(term))}')`;
    const rows = await runQuery(filter, env, 500);
    const exact = rows
      .map((r) => ({ r, score: addressScore(a, r) }))
      .filter((x) => x.score >= 88)
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
    "ListingKey","StreetNumber","StreetName","StreetSuffix","StreetDirPrefix","StreetDirSuffix","UnparsedAddress",
    "City","StateOrProvince","PostalCode","StandardStatus","MlsStatus","ContractStatus","TransactionType",
    "ModificationTimestamp","OriginalEntryTimestamp"
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
  // Use the street-address segment; city/province/postal can follow after commas.
  let first = String(raw || "").replace(/\s+/g, " ").trim().split(",")[0].trim();
  first = first.replace(/^(?:unit|suite|apt|apartment|#)\s*[A-Za-z0-9-]+\s*[-,]?\s*/i, "");

  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};

  const tokens = m[2].trim().replace(/[.]/g, "").split(/\s+/);
  let direction = null;
  let suffix = null;

  // Common forms: Queen St W, Oriole Pkwy, Avenue Rd, Yonge Street North.
  if (tokens.length && DIRECTION_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    direction = DIRECTION_ALIASES.get(normalizeToken(tokens.pop()));
  }
  if (tokens.length && STREET_TYPE_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    suffix = STREET_TYPE_ALIASES.get(normalizeToken(tokens.pop()));
  }
  if (!direction && tokens.length && DIRECTION_ALIASES.has(normalizeToken(tokens[tokens.length - 1]))) {
    direction = DIRECTION_ALIASES.get(normalizeToken(tokens.pop()));
  }

  return {
    number: normalize(m[1]),
    name: normalize(tokens.join(" ")),
    suffix,
    direction,
  };
}

function addressScore(a, r) {
  let score = 0;
  const rowNumber = normalize(r?.StreetNumber);
  const rowName = normalize(r?.StreetName);
  const rowSuffix = canonicalStreetType(r?.StreetSuffix);
  const rowDirection = canonicalDirection(r?.StreetDirSuffix || r?.StreetDirPrefix);
  const unparsed = normalize(r?.UnparsedAddress);

  if (rowNumber === a.number) score += 48;
  if (rowName === a.name) score += 42;
  else if (rowName.includes(a.name) || a.name.includes(rowName)) score += 24;

  // Street type is useful confirmation but not required because AMPRE data can vary.
  if (a.suffix && rowSuffix === a.suffix) score += 5;
  if (a.direction && rowDirection === a.direction) score += 2;
  if (unparsed.startsWith(`${a.number} ${a.name}`)) score += 3;
  if (isActive(r)) score += 5;

  return Math.min(100, score);
}

function canonicalStreetType(v) {
  const key = normalizeToken(v);
  return STREET_TYPE_ALIASES.get(key) || normalize(v);
}

function canonicalDirection(v) {
  const key = normalizeToken(v);
  return DIRECTION_ALIASES.get(key) || normalize(v);
}

const STREET_TYPE_ALIASES = new Map(Object.entries({
  alley:"alley", aly:"alley",
  avenue:"avenue", ave:"avenue", av:"avenue",
  bay:"bay", beach:"beach", bend:"bend",
  boulevard:"boulevard", blvd:"boulevard",
  byway:"byway", campus:"campus", cape:"cape", centre:"centre", center:"centre",
  chase:"chase", circle:"circle", cir:"circle", circuit:"circuit", close:"close",
  common:"common", concession:"concession", corners:"corners", court:"court", ct:"court",
  cove:"cove", crescent:"crescent", cres:"crescent", cr:"crescent",
  crossing:"crossing", dale:"dale", dell:"dell", diversion:"diversion", downs:"downs",
  drive:"drive", dr:"drive", end:"end", esplanade:"esplanade", estates:"estates",
  expressway:"expressway", expy:"expressway", extension:"extension", ext:"extension",
  farm:"farm", field:"field", forest:"forest", freeway:"freeway", front:"front",
  gardens:"gardens", gdns:"gardens", gate:"gate", glade:"glade", glen:"glen",
  green:"green", grounds:"grounds", grove:"grove", harbour:"harbour", harbor:"harbour",
  heath:"heath", heights:"heights", hts:"heights", highlands:"highlands",
  highway:"highway", hwy:"highway", hill:"hill", hollow:"hollow", inlet:"inlet",
  island:"island", key:"key", knoll:"knoll", landing:"landing", lane:"lane", ln:"lane",
  limits:"limits", line:"line", link:"link", lookout:"lookout", loop:"loop", mall:"mall",
  manor:"manor", maze:"maze", meadows:"meadows", mews:"mews", moor:"moor",
  mount:"mount", mountain:"mountain", orchard:"orchard", parade:"parade", park:"park",
  parkway:"parkway", pkwy:"parkway", passage:"passage", path:"path",
  pathway:"pathway", pines:"pines", place:"place", pl:"place", plateau:"plateau",
  plaza:"plaza", point:"point", pt:"point", port:"port", promenade:"promenade",
  quay:"quay", ramp:"ramp", range:"range", ridge:"ridge", rise:"rise",
  road:"road", rd:"road", route:"route", rte:"route", row:"row", run:"run",
  square:"square", sq:"square", street:"street", st:"street",
  subdivision:"subdivision", terrace:"terrace", terr:"terrace", ter:"terrace",
  thicket:"thicket", towers:"towers", townline:"townline", trail:"trail", tr:"trail",
  turnabout:"turnabout", vale:"vale", via:"via", view:"view", village:"village",
  villas:"villas", vista:"vista", walk:"walk", way:"way", wharf:"wharf", wood:"wood", wynd:"wynd"
}));

const DIRECTION_ALIASES = new Map(Object.entries({
  n:"north", north:"north", s:"south", south:"south",
  e:"east", east:"east", w:"west", west:"west",
  ne:"northeast", northeast:"northeast", nw:"northwest", northwest:"northwest",
  se:"southeast", southeast:"southeast", sw:"southwest", southwest:"southwest"
}));

function isActive(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(r?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new|price change/.test(status) &&
    !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}

function displayToken(v) {
  const s = String(v || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}
function normalizeToken(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalize(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function escapeOData(v) { return String(v || "").replace(/'/g, "''"); }
function clean(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function recordTime(r) { const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); }
function json(body, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "X-THM-Version":VERSION,
      "X-Content-Type-Options":"nosniff"
    }
  });
}
