import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const worker = "prototype-1-torontohousemarket";
const origin = "https://torontohousemarket.com";
const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const candidate = process.env.CANDIDATE_VERSION_ID;
const expectedBefore = process.env.EXPECTED_BEFORE_SHA;
const hash = value => createHash("sha256").update(value).digest("hex");
function check(ok, message) { if (!ok) throw new Error(message); }
async function cf(path, body) {
  const response = await fetch(`${api}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  check(response.ok, `Cloudflare request failed: ${response.status}`);
  const data = await response.json(); check(data.success, "Cloudflare API reported failure"); return data.result;
}
async function activeVersion() {
  const result = await cf(`/workers/scripts/${worker}/deployments`);
  const versions = result.deployments[0].versions;
  check(versions.length === 1 && versions[0].percentage === 100, "Expected one active production version");
  return versions[0].version_id;
}
async function version(id) { return cf(`/workers/workers/${worker}/versions/${id}?include=modules`); }
function source(value) { return Buffer.from(value.modules.find(m => m.name === "worker-v11.js").content_base64, "base64"); }
function expectedAsset(path) {
  // Static asset routes bypass the Worker; compare complete unmodified bytes.
  return readFileSync(path);
}
const names = value => value.bindings.filter(b => !["ASSETS", "PUBLIC_DISCOVERY_ENABLED"].includes(b.name)).map(b => `${b.name}:${b.type}`).sort();
check(/^[a-f0-9-]{36}$/.test(candidate || ""), "Candidate must be a verified preview version");
const previous = await activeVersion();
const before = await version(previous);
const next = await version(candidate);
check(hash(source(before)) === expectedBefore, "Production source changed after verification");
check(hash(source(next)) === hash(readFileSync("worker-v11.js")), "Preview source differs from this release commit");
check(isDeepStrictEqual(names(before), names(next)), "Binding names or types changed unexpectedly");
check(next.bindings.some(b => b.name === "ASSETS"), "Static assets missing");
check(next.bindings.some(b => b.name === "PUBLIC_DISCOVERY_ENABLED" && b.type === "plain_text" && b.text === "true"), "Verified discovery flag missing");
for (const b of before.bindings.filter(b => b.type === "plain_text" && b.name !== "PUBLIC_DISCOVERY_ENABLED")) {
  check(next.bindings.some(n => n.name === b.name && n.type === b.type && n.text === b.text), "Existing configuration differs from the preview");
}
const schedule = await cf(`/workers/scripts/${worker}/schedules`);
const previewOrigin = `https://${candidate.slice(0, 8)}-${worker}.7h57cb8fzs.workers.dev`;
for (const path of ["index.html", "app.js", "styles.css"]) {
  const url = path === "index.html" ? "/" : `/${path}`;
  const response = await fetch(`${previewOrigin}${url}?release=${process.env.GITHUB_SHA}`);
  const actual = Buffer.from(await response.arrayBuffer());
  const expected = expectedAsset(path);
  if (hash(actual) !== hash(expected)) {
    const a = actual.toString("utf8"), e = expected.toString("utf8");
    let first = 0; while (first < Math.min(a.length, e.length) && a[first] === e[first]) first++;
    console.log(JSON.stringify({ asset: path, status: response.status, contentType: response.headers.get("content-type"), actualBytes: actual.length, expectedBytes: expected.length, firstDifference: first, actualExcerpt: a.slice(Math.max(0, first - 50), first + 300), expectedExcerpt: e.slice(Math.max(0, first - 50), first + 300) }));
  }
  check(response.ok && hash(actual) === hash(expected), `Preview asset mismatch before promotion: ${path}`);
}
async function checkBedroomPricing(base) {
  const r = await fetch(`${base}/api/price-check?listingKey=N13748512`);
  const p = await r.json();
  check(r.ok && p.ok && p.matches.every(row => row.bedroomLayout === "1+1"), "Bedroom layout comparison failed");
  if (p.count < 3) check(!p.available && p.medianAsk === null, "Sparse bedroom layout received a price label");
  console.log(JSON.stringify({ bedroomLayoutCheck: { listingKey: p.listingKey, matches: p.count, signal: p.signal } }));
}
async function checkAvenueAddress(base) {
  let matchedKey;
  for (const query of ['981 avenue rd', '981 Avenue Road']) {
    const response = await fetch(`${base}/api/property?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    const property = data.property;
    console.log(JSON.stringify({ addressDiagnostic: { query, status: response.status, ok: data.ok, error: data.error, listingKey: property?.listingKey, address: property?.address, resolvedFromAddress: property?.resolvedFromAddress, inputValidation: property?.inputValidation, resolution: property?.resolution } }));
    check(response.ok && data.ok && property?.listingKey && property.resolvedFromAddress && /^981 Avenue (Road|Rd)\b/i.test(property.address), `Address search failed: ${query}`);
    check(!matchedKey || matchedKey === property.listingKey, 'Address variants resolve to different listings');
    matchedKey = property.listingKey;
    console.log(JSON.stringify({ addressSearch: { query, listingKey: matchedKey, address: property.address, forSale: property.forSale } }));
  }
}
async function checkWhitburn(base) {
  const response = await fetch(`${base}/api/price-check?listingKey=W13676100`);
  const p = await response.json();
  console.log(JSON.stringify({ whitburn: p }));
  check(response.ok && p.ok && p.criteria && !p.reason.includes('supported home type'), 'Whitburn type matching failed');
  const ai = await fetch(`${base}/api/home-assistant`, {method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({listingKey:'W13676100',topic:'overview'})});
  const brief = await ai.json();
  check(ai.ok && brief.ok && brief.summary && brief.facts.length && brief.checks.length, 'Whitburn automatic snapshot failed');
  console.log(JSON.stringify({whitburnSnapshot:{mode:brief.mode,summary:brief.summary,aiStatus:brief.aiStatus}}));
  check(brief.mode === 'ai', 'Whitburn AI must pass in preview before release');
}
await checkWhitburn(previewOrigin);
await checkAvenueAddress(previewOrigin);
await checkBedroomPricing(previewOrigin);
const positivePreview = await (await fetch(`${previewOrigin}/api/price-check?listingKey=N13519308`)).json();
check(positivePreview.ok && positivePreview.available && positivePreview.count >= 3, "Preview freehold Price Check failed");
const deploy = id => cf(`/workers/scripts/${worker}/deployments`, { strategy: "percentage", versions: [{ percentage: 100, version_id: id }], annotations: { "workers/message": id === candidate ? "Verified public buyer tools and no-comparable rating guard" : "Automatic rollback after buyer-tools verification failure" } });
let attempted = false;
try {
  check(await activeVersion() === previous, "Concurrent deployment detected");
  attempted = true;
  await deploy(candidate);
  let current;
  for (let i = 0; i < 6; i++) { current = await activeVersion(); if (current === candidate) break; await new Promise(r => setTimeout(r, 2000)); }
  check(current === candidate, "Candidate did not become active");
  check(isDeepStrictEqual(schedule, await cf(`/workers/scripts/${worker}/schedules`)), "Cron schedule changed");
  for (const path of ["index.html", "app.js", "styles.css"]) {
    const url = path === "index.html" ? "/" : `/${path}`;
    let matched = false, actual, status;
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = await fetch(`${origin}${url}?release=${process.env.GITHUB_SHA}&attempt=${attempt}`, { headers: { "Cache-Control": "no-cache" } });
      status = r.status; actual = Buffer.from(await r.arrayBuffer());
      matched = r.ok && hash(actual) === hash(expectedAsset(path));
      if (matched) break;
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    if (!matched) {
      const a = actual.toString("utf8"), e = expectedAsset(path).toString("utf8");
      let first = 0; while (first < Math.min(a.length, e.length) && a[first] === e[first]) first++;
      console.log(JSON.stringify({ liveAsset: path, status, actualBytes: actual.length, expectedBytes: expectedAsset(path).length, firstDifference: first, actualExcerpt: a.slice(Math.max(0, first - 50), first + 300), expectedExcerpt: e.slice(Math.max(0, first - 50), first + 300) }));
    }
    check(matched, `Live asset mismatch after propagation window: ${path}`);
  }
  const health = await (await fetch(`${origin}/api/version`)).json();
  check(health.ok && health.vowAccess, "Version or VOW configuration health failed");
  let listingKey;
  for (const mode of ["new", "luxury", "budget"]) {
    const r = await fetch(`${origin}/api/discovery?city=Vaughan&mode=${mode}&maxPrice=${mode === "luxury" ? "" : "2000000"}`);
    const data = await r.json();
    check(r.ok && data.ok && data.listings.length, `Live ${mode} discovery failed`);
    if (!listingKey) listingKey = data.listings[0].listingKey;
    console.log(JSON.stringify({ mode, count: data.listings.length, status: r.status }));
  }
  const p = await (await fetch(`${origin}/api/property?listingKey=${listingKey}`)).json();
  check(p.property?.forSale && p.property?.publicListing && !p.property.comparableContext.available, "Public snapshot verification failed");
  let ai, answer;
  for (let attempt = 0; attempt < 3; attempt++) {
    ai = await fetch(`${origin}/api/home-assistant`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ listingKey, topic: "costs" }) });
    answer = await ai.json();
    console.log(JSON.stringify({liveAssistantCheck:{attempt:attempt+1,status:ai.status,mode:answer.mode,facts:answer.facts?.length,error:answer.error}}));
    if (ai.ok && answer.mode === 'ai' && answer.facts?.length) break;
    // Factual fallbacks are cached for 30 seconds; allow recovery, not a weaker gate.
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 32000));
  }
  check(ai.ok && answer.mode === "ai" && answer.facts?.length, "Live AI assistant verification failed after three attempts");
  const schoolProperty = await (await fetch(`${origin}/api/property?listingKey=W13676100`)).json();
  const schoolToken = schoolProperty.property?.schoolResearchToken;
  if (schoolToken) {
    const schoolResponse = await fetch(`${origin}/api/school-enrichment?token=${encodeURIComponent(schoolToken)}`, {signal:AbortSignal.timeout(26000)}).catch(()=>null);
    const schoolBody = await schoolResponse?.json().catch(()=>null);
    console.log(JSON.stringify({schoolCardCheck:{status:schoolResponse?.status,name:schoolBody?.schoolSummary?.name,source:schoolBody?.schoolSummary?.source,available:!!schoolBody?.schoolSummary?.name}}));
  } else console.log(JSON.stringify({schoolCardCheck:{name:schoolProperty.property?.schoolSummary?.name,tokenAvailable:false}}));
  await checkWhitburn(origin);
  await checkAvenueAddress(origin);
  await checkBedroomPricing(origin);
  const priceResponse = await fetch(`${origin}/api/price-check?listingKey=N13519308`);
  const price = await priceResponse.json();
  check(priceResponse.ok && price.ok && price.listingKey === "N13519308" && price.available && price.count >= 3 && price.medianAsk > 0, "Live Price Check verification failed");
  console.log(JSON.stringify({ priceCheck: { listingKey: price.listingKey, signal: price.signal, matches: price.count, differencePct: price.differencePct } }));
  console.log(JSON.stringify({ deployedVersion: candidate, previousVersion: previous, sourceSha256: hash(source(next)), aiMode: answer.mode }));
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Deployed verified version ${candidate}.\n\nSource, bindings, cron, assets, public IDX, and AI checks passed. No lead/report/email test requests were made.\n`);
} catch (error) {
  if (attempted && await activeVersion() === candidate) {
    await deploy(previous);
    let restored;
    for (let i = 0; i < 6; i++) { restored = await activeVersion(); if (restored === previous) break; await new Promise(r => setTimeout(r, 2000)); }
    check(restored === previous, "Rollback did not become active; inspect deployment before proceeding");
    console.log("Previous production version restored.");
  }
  throw error;
}
