import app from "./worker-v11.js";

const AMPRE = "https://query.ampre.ca/odata";
const VERSION = "phase2-agent-mcp-v21-20260827";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_BODY_BYTES = 65536;
const MAX_RESULTS = 50;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({
        ok:true, version:VERSION, comparables:"recent-sold-only",
        reports:"workers-ai-with-deterministic-fallback", operations:"admin-and-job-queue",
        agents:"authenticated-rest-and-streamable-http-mcp",
      });
    }

    if (url.pathname === "/mcp") return authenticatedAgentRequest(request, env, () => handleMcp(request, env));
    if (url.pathname === "/api/agent/search") return authenticatedAgentRequest(request, env, () => handleAgentSearch(request, env));
    if (url.pathname.startsWith("/api/agent/listing/")) {
      return authenticatedAgentRequest(request, env, () => handleAgentListing(request, env, url));
    }

    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};

async function authenticatedAgentRequest(request, env, handler) {
  if (request.method === "OPTIONS") return new Response(null, { status:204, headers:{ Allow:"GET, POST, OPTIONS" } });
  const expected = String(env.AGENT_API_KEY || "");
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || !supplied || !(await secureEqual(supplied, expected))) {
    return json({ ok:false, error:"Unauthorized" }, 401, { "WWW-Authenticate":'Bearer realm="TorontoHouseMarket MLS"' });
  }

  const rate = await checkBestEffortRateLimit(supplied);
  const rateHeaders = {
    "X-RateLimit-Limit":"60", "X-RateLimit-Remaining":String(rate.remaining),
    "X-RateLimit-Reset":rate.reset,
  };
  if (!rate.allowed) return json({ ok:false, error:"Rate limit exceeded" }, 429, { ...rateHeaders, "Retry-After":"60" });

  try {
    const response = await handler();
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(rateHeaders)) headers.set(key, value);
    return new Response(response.body, { status:response.status, headers });
  } catch (error) {
    console.error(JSON.stringify({ event:"agent_request_failed", error:safeError(error) }));
    return json({ ok:false, error:error instanceof AgentInputError ? error.message : "Unable to process MLS request." }, error instanceof AgentInputError ? 400 : 502, rateHeaders);
  }
}

async function checkBestEffortRateLimit(token) {
  const minute = Math.floor(Date.now() / 60000);
  const hash = await sha256Hex(token);
  const cacheKey = new Request(`https://rate-limit.internal/${hash}/${minute}`);
  let count = 0;
  try {
    const cached = await caches.default.match(cacheKey);
    count = cached ? Number(await cached.text()) || 0 : 0;
    count += 1;
    await caches.default.put(cacheKey, new Response(String(count), { headers:{ "Cache-Control":"max-age=65" } }));
  } catch (error) {
    console.warn(JSON.stringify({ event:"agent_rate_limit_cache_unavailable", error:safeError(error) }));
    count = 1;
  }
  return { allowed:count <= 60, remaining:Math.max(0, 60 - count), reset:new Date((minute + 1) * 60000).toISOString() };
}

async function handleMcp(request, env) {
  if (request.method !== "POST") return json({ error:"Method not allowed" }, 405, { Allow:"POST" });
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return json({ error:"Request too large" }, 413);

  let message;
  try { message = await request.json(); }
  catch { return rpcError(null, -32700, "Parse error"); }
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(rpcId(message), -32600, "Invalid Request");
  const id = rpcId(message);

  if (message.method === "notifications/initialized") return new Response(null, { status:202 });
  if (message.method === "initialize") {
    return rpcResult(id, {
      protocolVersion:MCP_PROTOCOL_VERSION,
      capabilities:{ tools:{ listChanged:false } },
      serverInfo:{ name:"toronto-house-market-mls", version:"1.0.0" },
    });
  }
  if (message.method === "ping") return rpcResult(id, {});
  if (message.method === "tools/list") return rpcResult(id, { tools:TOOL_DEFINITIONS });
  if (message.method === "tools/call") {
    const params = isObject(message.params) ? message.params : {};
    if (typeof params.name !== "string") return rpcError(id, -32602, "Tool name is required");
    try {
      const result = await callTool(params.name, params.arguments, env);
      return rpcResult(id, {
        content:[{ type:"text", text:JSON.stringify(result) }],
        structuredContent:{ data:result },
      });
    } catch (error) {
      const safe = error instanceof AgentInputError || error instanceof MlsNotFoundError ? error.message : "MLS tool call failed";
      if (!(error instanceof AgentInputError || error instanceof MlsNotFoundError)) {
        console.error(JSON.stringify({ event:"mcp_tool_failed", tool:params.name, error:safeError(error) }));
      }
      return rpcResult(id, { content:[{ type:"text", text:safe }], isError:true });
    }
  }
  return rpcError(id, -32601, "Method not found");
}

async function handleAgentSearch(request, env) {
  if (request.method !== "GET" && request.method !== "POST") return json({ ok:false, error:"Method not allowed" }, 405, { Allow:"GET, POST" });
  const url = new URL(request.url);
  const input = request.method === "POST" ? await boundedJson(request) : Object.fromEntries(url.searchParams);
  return json({ ok:true, ...(await searchProperties(validateSearch(input), env)) });
}

async function handleAgentListing(request, env, url) {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed" }, 405, { Allow:"GET" });
  const parts = url.pathname.split("/").filter(Boolean);
  const mls = clean(parts[3], 40).toUpperCase();
  const view = clean(parts[4] || "details", 20).toLowerCase();
  const tool = ({ status:"get_listing_status", media:"get_listing_media", comps:"find_comparables", details:"get_listing_details" })[view];
  if (!tool) throw new AgentInputError("Listing view must be details, status, media, or comps");
  return json({ ok:true, data:await callTool(tool, { mls_number:mls }, env) });
}

async function callTool(name, raw, env) {
  const args = isObject(raw) ? raw : {};
  if (name === "search_properties") return searchProperties(validateSearch(args), env);
  const mls = requiredString(args, "mls_number", 2, 40).toUpperCase();
  const property = await loadProperty(mls, env);
  if (name === "lookup_listing" || name === "get_listing_details") return property;
  if (name === "get_listing_status") {
    return {
      mls_number:property.listingKey || mls,
      status:normalizeStatus(property.status || property.marketStatus, property.transactionType),
      source_status:property.status || property.marketStatus || null,
      transaction_type:property.transactionType || null,
      for_sale:!!property.forSale,
      listed_at:property.details?.listedAt || null,
      days_live:property.daysLive ?? null,
    };
  }
  if (name === "get_listing_media") {
    const limit = boundedNumber(args.limit, 50, 1, 60, true, "limit");
    return { mls_number:property.listingKey || mls, photos:(property.photos || []).slice(0, limit), count:Math.min(property.photos?.length || 0, limit) };
  }
  if (name === "find_comparables") {
    return { mls_number:property.listingKey || mls, subject:{ address:property.address, list_price:property.listPrice }, comparable_context:property.comparableContext || null };
  }
  throw new AgentInputError(`Unknown tool: ${name}`);
}

async function loadProperty(mls, env) {
  const url = new URL("https://torontohousemarket.com/api/property");
  url.searchParams.set("listingKey", mls);
  const response = await app.fetch(new Request(url, { headers:{ Accept:"application/json" } }), env, { waitUntil(){} });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok || !body.property) throw new MlsNotFoundError(body?.error || `MLS ${mls} was not found`);
  return body.property;
}

export async function searchProperties(input, env) {
  if (!env.AMPRE_TOKEN) throw new Error("AMPRE is not configured");
  if (input.query && !input.district) {
    const url = new URL("https://torontohousemarket.com/api/property");
    if (/^[A-Z]\d{7,9}$/i.test(input.query)) url.searchParams.set("listingKey", input.query.toUpperCase());
    else url.searchParams.set("q", input.query);
    const response = await app.fetch(new Request(url), env, { waitUntil(){} });
    const body = await response.json().catch(() => null);
    return { listings:response.ok && body?.property ? [body.property] : [], count:response.ok && body?.property ? 1 : 0, criteria:input };
  }

  const since = new Date(Date.now() - input.listed_within_days * 86400000).toISOString();
  const district = odata(input.district);
  const districtAttempts = [
    { field:"MlsAreaMajor", filter:`MlsAreaMajor eq '${district}'` },
    { field:"MlsAreaMajor", filter:`MlsAreaMajor eq 'Toronto ${district}'` },
    { field:"MlsAreaMajor", filter:`contains(MlsAreaMajor,'${district}')` },
    { field:"MlsAreaMinor", filter:`contains(MlsAreaMinor,'${district}')` },
    { field:"CityRegion", filter:`CityRegion eq '${district}'` },
  ];
  const dateFilter = `OriginalEntryTimestamp ge ${since}`;
  let rows = [];
  let matchedField = null;
  for (const attempt of districtAttempts) {
    const result = await queryAgentListings(`${attempt.filter} and ${dateFilter}`, attempt.field, input.limit, env);
    if (result.ok && result.rows.length) { rows = result.rows; matchedField = attempt.field; break; }
  }

  // This AMPRE contract exposes TRREB communities in CityRegion but omits the
  // board district fields. Resolve supported district codes through their
  // constituent communities, then apply the requested listing-date cutoff.
  const communities = DISTRICT_COMMUNITIES[input.district];
  if (!rows.length && communities) {
    const recentRows = await queryRecentPages(env, input.listed_within_days);
    const communitySet = new Set(communities.map(normalizeDistrict));
    rows = recentRows.filter((row) => {
      const region = normalizeDistrict(row.CityRegion);
      return [...communitySet].some((community) => region === community || region.endsWith(community));
    });
    matchedField = rows.length ? `CityRegion (${input.district} community map)` : null;
  }

  // Some AMPRE contracts return board-specific district fields but reject those
  // fields in $filter/$select. In that case, keep the date filter upstream and
  // match only area-like fields locally over the bounded recent result set.
  if (!rows.length) {
    const recent = await queryRecentListings(dateFilter, env);
    const discovered = discoverDistrictRows(recent, input.district);
    rows = discovered.rows;
    matchedField = discovered.field;
  }

  rows = rows.filter((row) => listedWithinDays(row, input.listed_within_days))
    .filter(isActiveForSale)
    .filter((row) => row.InternetEntireListingDisplayYN !== false && row.InternetAddressDisplayYN !== false)
    .slice(0, input.limit);
  return {
    listings:rows.map(publicListing), count:rows.length,
    criteria:{ ...input, listed_since:since.slice(0, 10), status:"active" },
    district_field:matchedField,
    note:matchedField ? null : "No matching displayable listings were returned by the configured AMPRE district fields.",
  };
}

async function queryRecentPages(env, days) {
  const fields = [
    "ListingKey","UnparsedAddress","City","CityRegion","PostalCode","ListPrice",
    "BedroomsTotal","BathroomsTotalInteger","PropertyType","PropertySubType","StandardStatus",
    "MlsStatus","ContractStatus","TransactionType","OriginalEntryTimestamp","ModificationTimestamp",
    "InternetEntireListingDisplayYN","InternetAddressDisplayYN","ListOfficeName",
  ].join(",");
  const rows = [];
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      "$top":"500", "$skip":String(page * 500), "$select":fields,
    });
    let response;
    try {
      response = await fetch(`${AMPRE}/Property?${params}`, { headers:{ Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" }, signal:AbortSignal.timeout(15000) });
    } catch (error) {
      console.warn(JSON.stringify({ event:"agent_ampre_page_failed", page, error:safeError(error) }));
      break;
    }
    if (!response.ok) break;
    const body = await response.json().catch(() => null);
    const batch = Array.isArray(body?.value) ? body.value : [];
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  return dedupeListings(rows).filter((row) => listedWithinDays(row, days));
}

const DISTRICT_COMMUNITIES = {
  W05:[
    "Black Creek", "Downsview-Roding-CFB", "Glenfield-Jane Heights",
    "Humber Summit", "Humbermede", "York University Heights",
  ],
};

function listedWithinDays(row, days) {
  const value = row?.OriginalEntryTimestamp;
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= days * 86400000;
}

function dedupeListings(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row?.ListingKey || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function queryRecentListings(dateFilter, env) {
  const params = new URLSearchParams({ "$top":"500", "$orderby":"OriginalEntryTimestamp desc,ListingKey desc" });
  if (dateFilter) params.set("$filter", dateFilter);
  let response;
  try {
    response = await fetch(`${AMPRE}/Property?${params}`, { headers:{ Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" }, signal:AbortSignal.timeout(15000) });
    if (!response.ok) {
      params.delete("$orderby");
      response = await fetch(`${AMPRE}/Property?${params}`, { headers:{ Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" }, signal:AbortSignal.timeout(15000) });
    }
  } catch (error) {
    console.warn(JSON.stringify({ event:"agent_ampre_recent_query_failed", error:safeError(error) }));
    return [];
  }
  if (!response.ok) return [];
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.value) ? body.value : [];
}

export function discoverDistrictRows(rows, district) {
  const wanted = normalizeDistrict(district);
  let field = null;
  const matches = (rows || []).filter((row) => {
    for (const [key, value] of Object.entries(row || {})) {
      if (!/(?:area|district|region|community|municipality)/i.test(key)) continue;
      const normalized = normalizeDistrict(value);
      if (normalized === wanted || normalized.endsWith(wanted)) { field ||= key; return true; }
    }
    return false;
  });
  return { rows:matches, field };
}

async function queryAgentListings(filter, districtField, limit, env) {
  const fields = [
    "ListingKey","UnparsedAddress","City","CityRegion",districtField,"PostalCode","ListPrice",
    "BedroomsTotal","BathroomsTotalInteger","PropertyType","PropertySubType","StandardStatus",
    "MlsStatus","ContractStatus","TransactionType","OriginalEntryTimestamp","ModificationTimestamp",
    "InternetEntireListingDisplayYN","InternetAddressDisplayYN","ListOfficeName",
  ].filter((value, index, all) => all.indexOf(value) === index).join(",");
  const params = new URLSearchParams({ "$top":String(limit), "$filter":filter, "$select":fields, "$orderby":"OriginalEntryTimestamp desc,ListingKey desc" });
  let response;
  try {
    response = await fetch(`${AMPRE}/Property?${params}`, { headers:{ Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" }, signal:AbortSignal.timeout(15000) });
  } catch (error) {
    console.warn(JSON.stringify({ event:"agent_ampre_query_failed", field:districtField, error:safeError(error) }));
    return { ok:false, rows:[] };
  }
  if (!response.ok) return { ok:false, rows:[] };
  const body = await response.json().catch(() => null);
  return { ok:true, rows:Array.isArray(body?.value) ? body.value : [] };
}

export function validateSearch(raw) {
  const input = isObject(raw) ? raw : {};
  const query = optionalString(input, "query", 2, 500);
  const district = optionalString(input, "district", 2, 30)?.toUpperCase();
  if (!query && !district) throw new AgentInputError("Provide query or district");
  if (district && !/^[A-Z]\d{2}$/.test(district)) throw new AgentInputError("district must look like W05, C01, or E03");
  return {
    ...(query ? { query } : {}), ...(district ? { district } : {}),
    listed_within_days:boundedNumber(input.listed_within_days, 19, 1, 365, true, "listed_within_days"),
    limit:boundedNumber(input.limit, 20, 1, MAX_RESULTS, true, "limit"),
  };
}

function publicListing(row) {
  return {
    listing_key:row.ListingKey || null,
    address:row.UnparsedAddress || null,
    city:row.City || null,
    community:row.CityRegion || null,
    district:row.MlsAreaMajor || row.MlsAreaMinor || null,
    postal_code:row.PostalCode || null,
    list_price:numberOrNull(row.ListPrice),
    beds:numberOrNull(row.BedroomsTotal), baths:numberOrNull(row.BathroomsTotalInteger),
    property_type:row.PropertySubType || row.PropertyType || null,
    status:row.StandardStatus || row.MlsStatus || row.ContractStatus || null,
    transaction_type:row.TransactionType || null,
    listed_at:row.OriginalEntryTimestamp || null,
    listing_office:row.ListOfficeName || null,
  };
}

function isActiveForSale(row) {
  const status = `${row?.StandardStatus || ""} ${row?.MlsStatus || ""} ${row?.ContractStatus || ""}`.toLowerCase();
  const transaction = String(row?.TransactionType || "").toLowerCase();
  return transaction.includes("for sale") && /active|available|new|price change/.test(status) && !/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(status);
}

const TOOL_DEFINITIONS = [
  tool("lookup_listing", "Look up a listing by exact MLS number.", { mls_number:stringSchema(2,40) }, ["mls_number"]),
  tool("search_properties", "Search by MLS/address, or list active properties in a TRREB district such as W05 within a recent-day window.", { query:stringSchema(2,500), district:{ type:"string", pattern:"^[A-Z][0-9]{2}$" }, listed_within_days:integerSchema(1,365), limit:integerSchema(1,50) }, []),
  tool("get_listing_status", "Get normalized and source listing status.", { mls_number:stringSchema(2,40) }, ["mls_number"]),
  tool("get_listing_details", "Get full permitted listing details.", { mls_number:stringSchema(2,40) }, ["mls_number"]),
  tool("get_listing_media", "Get permitted listing photos.", { mls_number:stringSchema(2,40), limit:integerSchema(1,60) }, ["mls_number"]),
  tool("find_comparables", "Get the existing recent-sold comparable analysis for a listing, where feed permissions allow.", { mls_number:stringSchema(2,40) }, ["mls_number"]),
];

function tool(name, description, properties, required) { return { name, description, inputSchema:{ type:"object", properties, required, additionalProperties:false } }; }
function stringSchema(minLength,maxLength){return{type:"string",minLength,maxLength};}
function integerSchema(minimum,maximum){return{type:"integer",minimum,maximum};}
function rpcResult(id,result){return json({jsonrpc:"2.0",id,result});}
function rpcError(id,code,message){return json({jsonrpc:"2.0",id,error:{code,message}});}
function rpcId(value){return isObject(value)&&(typeof value.id==="string"||typeof value.id==="number"||value.id===null)?value.id:null;}
function isObject(value){return !!value&&typeof value==="object"&&!Array.isArray(value);}
function requiredString(input,key,min,max){const value=optionalString(input,key,min,max);if(!value)throw new AgentInputError(`${key} is required`);return value;}
function optionalString(input,key,min,max){if(input[key]===undefined||input[key]===null||input[key]==="")return undefined;if(typeof input[key]!=="string")throw new AgentInputError(`${key} must be text`);const value=input[key].trim();if(value.length<min||value.length>max)throw new AgentInputError(`${key} must be ${min}-${max} characters`);return value;}
function boundedNumber(value,fallback,min,max,integer,label){if(value===undefined||value===null||value==="")return fallback;const number=Number(value);if(!Number.isFinite(number)||number<min||number>max||(integer&&!Number.isInteger(number)))throw new AgentInputError(`${label} must be ${min}-${max}`);return number;}
function numberOrNull(value){const number=Number(value);return Number.isFinite(number)?number:null;}
function clean(value,max){return typeof value==="string"?value.trim().slice(0,max):"";}
function odata(value){return String(value||"").replaceAll("'","''");}
function normalizeDistrict(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
function normalizeStatus(status,transaction){const value=String(status||"").toLowerCase();const type=String(transaction||"").toLowerCase();if(/closed|sold/.test(value))return type.includes("lease")?"leased":"sold";if(/active|available|new|price change/.test(value))return"active";if(/pending|deal firm/.test(value))return"pending";if(/withdrawn|cancel|expired|terminated|suspend/.test(value))return"off_market";return value?"other":"unknown";}
async function boundedJson(request){const length=Number(request.headers.get("Content-Length")||0);if(length>MAX_BODY_BYTES)throw new AgentInputError("Request is too large");try{return await request.json();}catch{throw new AgentInputError("Invalid JSON");}}
async function secureEqual(left,right){const encoder=new TextEncoder();const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(left)),crypto.subtle.digest("SHA-256",encoder.encode(right))]);const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
async function sha256Hex(value){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
function safeError(error){return error instanceof Error?error.message.slice(0,300):String(error).slice(0,300);}
function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION,"X-Content-Type-Options":"nosniff",...extra}});}

class AgentInputError extends Error {}
class MlsNotFoundError extends Error {}
