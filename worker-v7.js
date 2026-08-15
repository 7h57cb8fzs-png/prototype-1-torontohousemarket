import app from "./worker-v4.js";

const AMPRE = "https://query.ampre.ca/odata";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/property" && request.method === "GET") {
      if (!env.AMPRE_TOKEN) return json({ ok:false, error:"IDX connection is not configured." }, 503);

      let listingKey = clean(url.searchParams.get("listingKey"), 50).toUpperCase();
      const q = clean(url.searchParams.get("q"), 1000);
      let validation = null;

      if (!listingKey && /^[A-Z]\d{7,9}$/i.test(q)) listingKey = q.toUpperCase();

      if (!listingKey && q && !/^https?:\/\//i.test(q)) {
        const parsed = parseAddress(q);
        if (parsed.number && parsed.name) {
          const match = await resolveAddress(parsed, env);
          if (match?.ListingKey) {
            listingKey = String(match.ListingKey).toUpperCase();
            validation = {
              type: "address",
              status: "validated",
              label: `Address matched to MLS ${listingKey}`,
            };
          }
        }
      }

      const forward = new URL(url.origin + "/api/property");
      if (listingKey) forward.searchParams.set("listingKey", listingKey);
      else if (q) forward.searchParams.set("q", q);
      else return json({ ok:false, error:"Enter an MLS number, street address, or listing URL." }, 400);

      const response = await app.fetch(new Request(forward.toString(), {
        method: "GET",
        headers: request.headers,
      }), env, ctx);

      let body;
      try { body = await response.clone().json(); } catch { return response; }
      if (!response.ok || !body?.ok || !body?.property) return response;

      const p = body.property;
      if (validation) {
        p.inputValidation = validation;
        p.resolution = p.forSale ? "address_live" : "address_history";
      }

      if (p.listingKey) {
        const media = await fetchPropertyMedia(p.listingKey, env);
        const normalized = normalizeMedia(media);
        if (normalized.length) {
          p.photos = mergePhotos(normalized, p.photos || []);
          p.photoCount = p.photos.length;
        }
      }

      return json(body, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

async function resolveAddress(a, env) {
  const street = smartCase(a.name);
  const suffix = a.suffix ? smartCase(a.suffix) : "";
  const full = `${a.number} ${street}${suffix ? ` ${suffix}` : ""}`;

  // On this AMPRE feed, string equality filters on these fields return 1109,
  // while contains(UnparsedAddress,...) succeeds. Use the working server-side
  // filter, then verify the exact physical address locally.
  const attempts = [
    `contains(UnparsedAddress,'${odata(full)}')`,
    `contains(UnparsedAddress,'${odata(`${a.number} ${street}`)}')`,
    `contains(UnparsedAddress,'${odata(street)}')`,
  ];

  for (const filter of attempts) {
    const rows = await propertyQuery(filter, env);
    const ranked = rows
      .map((r) => ({ r, score: addressScore(a, r) }))
      .filter((x) => x.score >= 88)
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

async function propertyQuery(filter, env) {
  const params = new URLSearchParams();
  params.set("$top", "250");
  params.set("$filter", filter);
  params.set("$select", [
    "ListingKey","StreetNumber","StreetName","StreetSuffix","UnparsedAddress",
    "City","StateOrProvince","PostalCode","StandardStatus","MlsStatus",
    "ContractStatus","TransactionType","ModificationTimestamp","OriginalEntryTimestamp"
  ].join(","));
  params.set("$orderby", "ModificationTimestamp,ListingKey desc");

  try {
    const r = await api(`${AMPRE}/Property?${params.toString()}`, env);
    if (!r.ok) return [];
    const b = await r.json();
    return Array.isArray(b.value) ? b.value : [];
  } catch { return []; }
}

async function fetchPropertyMedia(listingKey, env) {
  const filters = [
    `contains(ResourceRecordKey,'${odata(listingKey)}')`,
  ];

  for (const filter of filters) {
    const params = new URLSearchParams();
    params.set("$top", "100");
    params.set("$filter", filter);
    params.set("$select", "MediaKey,MediaURL,MediaType,ResourceName,ResourceRecordKey,ImageSizeDescription,ShortDescription,LongDescription,MediaModificationTimestamp");
    params.set("$orderby", "MediaModificationTimestamp,MediaKey");

    try {
      const r = await api(`${AMPRE}/Media?${params.toString()}`, env);
      if (!r.ok) continue;
      const b = await r.json();
      const rows = Array.isArray(b.value) ? b.value : [];
      const exact = rows.filter((m) =>
        String(m.ResourceRecordKey || "").toUpperCase() === String(listingKey).toUpperCase() &&
        String(m.ResourceName || "Property").toLowerCase() === "property"
      );
      if (exact.length) return exact;
    } catch {}
  }
  return [];
}

function normalizeMedia(rows) {
  const seen = new Set();
  const preferred = [...rows].sort((a,b) => imageRank(a) - imageRank(b));
  const out = [];
  for (const m of preferred) {
    const key = String(m?.MediaKey || "");
    const direct = String(m?.MediaURL || "");
    const type = String(m?.MediaType || "").toLowerCase();
    if (!key || !direct) continue;
    if (!(type.startsWith("image/") || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(direct))) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      url: `/api/media?key=${encodeURIComponent(key)}`,
      directUrl: direct,
      description: m?.ShortDescription || m?.LongDescription || null,
    });
  }
  return out.slice(0, 60);
}

function imageRank(m) {
  const s = String(m?.ImageSizeDescription || "").toLowerCase();
  if (s === "large") return 0;
  if (s === "medium") return 1;
  if (s === "thumbnail" || s === "small") return 3;
  return 2;
}

function mergePhotos(primary, existing) {
  const out = [], seen = new Set();
  for (const p of [...primary, ...existing]) {
    if (!p?.url) continue;
    const id = p.key || p.url;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out.slice(0,60);
}

function parseAddress(raw) {
  const first = String(raw || "").replace(/\s+/g," ").trim().split(",")[0].trim();
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
  const last = (tokens[tokens.length-1] || "").replace(/\./g,"").toLowerCase();
  const suffix = suffixMap.get(last) || null;
  if (suffix) tokens.pop();
  return { number:m[1].trim(), name:normalize(tokens.join(" ")), suffix };
}

function addressScore(a,r) {
  let score = 0;
  const num = normalize(r?.StreetNumber);
  const name = normalize(r?.StreetName);
  const suffix = normalize(r?.StreetSuffix);
  const full = normalize(r?.UnparsedAddress);
  if (num === normalize(a.number)) score += 45;
  if (name === a.name) score += 45;
  else if (name.includes(a.name) || a.name.includes(name)) score += 25;
  if (a.suffix && suffix === normalize(a.suffix)) score += 7;
  if (full.startsWith(`${normalize(a.number)} ${a.name}`)) score += 8;
  if (isActive(r)) score += 5;
  return Math.min(100, score);
}

function isActive(r) {
  const status = `${r?.StandardStatus || ""} ${r?.MlsStatus || ""} ${r?.ContractStatus || ""}`.toLowerCase();
  const t = String(r?.TransactionType || "").toLowerCase();
  return t.includes("for sale") && /active|available|new/.test(status) &&
    !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}

function recordTime(r) {
  const d = new Date(r?.ModificationTimestamp || r?.OriginalEntryTimestamp || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function smartCase(v){ return String(v||"").toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()); }
function normalize(v){ return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function odata(v){ return String(v||"").replace(/'/g,"''"); }
function clean(v,max){ return typeof v === "string" ? v.trim().slice(0,max) : ""; }
function api(url,env){ return fetch(url,{headers:{Authorization:`Bearer ${env.AMPRE_TOKEN}`,Accept:"application/json"}}); }
function json(body,status=200){ return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}); }
