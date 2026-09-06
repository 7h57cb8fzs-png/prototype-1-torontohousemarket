import test from "node:test";
import assert from "node:assert/strict";
import worker, { homeBriefCandidates, generateHomeBrief } from "../worker-v11.js";

const candidates = homeBriefCandidates({ listPrice: 900000, beds: 3, baths: 2, parkingTotal: 1, details: { annualTax: 4800 }, maintenanceFee: { amount: 400, frequency: "month" }, isCondominium: true }, "costs");
test("AI returns only server-defined facts and check IDs", async () => {
  const result = await generateHomeBrief({ AI: { run: async () => ({ response: '{"facts":["fee","tax"],"checks":["condo","costs"]}' }) } }, candidates, "costs");
  assert.equal(result.ai, true);
  assert.deepEqual(result.facts, ["fee", "tax"]);
});
test("unsupported AI claims, missing provider, and failures use labeled deterministic fallback", async () => {
  for (const AI of [undefined, { run: async () => { throw new Error("Unavailable"); } }, { run: async () => ({ response: '{"facts":["worth_2million"],"checks":["buy_now"]}' }) }]) {
    const result = await generateHomeBrief({ AI }, candidates, "costs");
    assert.equal(result.ai, false);
    assert.ok(!JSON.stringify(result).includes("2million"));
  }
});
test("missing costs stay unknown and sold data does not enter public AI candidates", () => {
  const data = homeBriefCandidates({ comparableContext: { comparables: [{ soldPrice: 888888 }] }, value_rating: { score: 8.5 } }, "costs");
  assert.equal(data.facts.length, 0);
  assert.ok(!JSON.stringify(data).includes("888888"));
  assert.ok(!JSON.stringify(data).includes("8.5"));
});
test("assistant rejects cross-origin requests and unexpected personal input before fetching", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not fetch"); });
  const request = (body, origin = "https://example.com") => new Request("https://example.com/api/home-assistant", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await worker.fetch(request({ listingKey: "N1000001", topic: "costs" }, "https://other.example"), {}, {})).status, 403);
  assert.equal((await worker.fetch(request({ listingKey: "N1000001", topic: "costs", email: "do-not-accept@example.com" }), {}, {})).status, 400);
  assert.equal((await worker.fetch(request({ listingKey: "N1000001", topic: "a".repeat(600) }), {}, {})).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});
test("preview versions refuse report and lead writes", async () => {
  for (const path of ["/api/lead", "/api/admin/automation/run", "/api/admin/reports/test-email-by-listing"]) {
    assert.equal((await worker.fetch(new Request(`https://preview-prototype-1-torontohousemarket.example.workers.dev${path}`, { method: "POST" }), {}, {})).status, 403);
  }
});
