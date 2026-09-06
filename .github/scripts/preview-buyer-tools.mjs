import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import assert from "node:assert/strict";
const worker = "prototype-1-torontohousemarket";
const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function cf(path) {
  const r = await fetch(`${api}${path}`, { headers });
  if (!r.ok) throw new Error(`Cloudflare read failed: ${r.status}`);
  const b = await r.json(); assert.equal(b.success, true); return b.result;
}
const deployment = await cf(`/workers/scripts/${worker}/deployments`);
const active = deployment.deployments[0].versions.find(v => v.percentage === 100).version_id;
const before = await cf(`/workers/workers/${worker}/versions/${active}?include=modules`);
const source = Buffer.from(before.modules.find(m => m.name === "worker-v11.js").content_base64, "base64");
console.log(`Active source SHA-256: ${hash(source)}`);
assert.equal(hash(source), process.env.EXPECTED_ACTIVE_SHA);
const args = ["--yes", "wrangler@4.129.0", "versions", "upload", "--no-bundle", "--preview-alias", "buyer-ai"];
for (const b of before.bindings) if (b.type === "plain_text" && b.name !== "PUBLIC_DISCOVERY_ENABLED") args.push("--var", `${b.name}:${b.text}`);
args.push("--var", "PUBLIC_DISCOVERY_ENABLED:true");
let log;
try { log = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }); }
catch { throw new Error("Version upload failed. CLI output withheld because it may contain binding values."); }
const versionId = log.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];
const preview = log.match(/Version Preview URL:\s*(https:\/\/[^\s]+)/i)?.[1];
assert.ok(versionId, "Version ID missing"); assert.ok(preview, "Preview URL missing");
console.log(JSON.stringify({ versionId, preview }));
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Preview version: ${versionId}\n\n${preview}\n\n`);
const after = await cf(`/workers/workers/${worker}/versions/${versionId}?include=modules`);
assert.equal(hash(Buffer.from(after.modules.find(m => m.name === "worker-v11.js").content_base64, "base64")), hash(readFileSync("worker-v11.js")));
const bindings = value => value.filter(b => !["ASSETS", "PUBLIC_DISCOVERY_ENABLED"].includes(b.name)).map(b => `${b.name}:${b.type}`).sort();
assert.deepEqual(bindings(after.bindings), bindings(before.bindings));
assert.equal((await cf(`/workers/scripts/${worker}/deployments`)).deployments[0].versions[0].version_id, active);
const home = await fetch(preview); assert.equal(home.status, 200); assert.match(await home.text(), /AI HOME ASSISTANT/);
const checks = [];
let aiListingKey;
for (const city of ["Toronto", "Vaughan"]) for (const mode of ["new", "drops", "budget"]) {
  const url = new URL("/api/discovery", preview); url.search = new URLSearchParams({ city, mode, maxPrice: "2000000" });
  const r = await fetch(url); const data = await r.json();
  checks.push({ city, mode, status: r.status, count: data.listings?.length, code: data.code || null });
  if (r.ok && data.listings?.length) {
    const listing = data.listings[0];
    const p = await (await fetch(new URL(`/api/property?listingKey=${listing.listingKey}`, preview))).json();
    assert.equal(p.property?.listingKey, listing.listingKey); assert.equal(p.property?.forSale, true); assert.equal(p.property?.listPrice, listing.listPrice);
    assert.ok(p.property?.publicListing); assert.equal(p.property.comparableContext.available, false);
    if (!aiListingKey) aiListingKey = listing.listingKey;
  }
}
console.log(JSON.stringify({ discoveryChecks: checks }));
appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```json\n" + JSON.stringify(checks, null, 2) + "\n```\n");
assert.ok(checks.every(c => c.status === 200 && c.count > 0), "Live IDX discovery needs correction; production unchanged");
const response = await fetch(new URL("/api/home-assistant", preview), { method: "POST", headers: { Origin: new URL(preview).origin, "Content-Type": "application/json" }, body: JSON.stringify({ listingKey: aiListingKey, topic: "costs" }) });
const answer = await response.json();
console.log(JSON.stringify({ assistantStatus: response.status, assistantMode: answer.mode, factCount: answer.facts?.length }));
assert.equal(response.status, 200); assert.equal(answer.mode, "ai");
console.log("Preview verified. Production deployment has not changed. No lead, report or email endpoint invoked.");
