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
    const r = await fetch(`${origin}${url}?release=${process.env.GITHUB_SHA}`, { headers: { "Cache-Control": "no-cache" } });
    check(r.ok && hash(Buffer.from(await r.arrayBuffer())) === hash(readFileSync(path)), `Live asset mismatch: ${path}`);
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
  const ai = await fetch(`${origin}/api/home-assistant`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ listingKey, topic: "costs" }) });
  const answer = await ai.json();
  check(ai.ok && answer.mode === "ai" && answer.facts?.length, "Live AI assistant verification failed");
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
