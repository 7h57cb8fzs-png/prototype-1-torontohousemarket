import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function page(fetchImpl = async () => { throw new Error("Unexpected network call"); }) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "unique HTML IDs");
  const elements = new Map(ids.map(id => [id, {
    textContent: "", innerHTML: "", value: "", disabled: false, handlers: {}, dataset: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    querySelectorAll() { return []; }, focus() {}, scrollIntoView() {}, reportValidity() { return true; },
    requestSubmit() { this.submitted = true; }
  }]));
  const context = vm.createContext({ document: {
    getElementById(id) { assert.ok(elements.has(id), `HTML element ${id} exists`); return elements.get(id); },
    querySelectorAll() { return []; }, addEventListener() {}, body: { classList: { add() {}, remove() {} } }
  }, window: { location: { search: "", hash: "" }, addEventListener() {}, setTimeout, clearTimeout }, history: { pushState() {} }, URLSearchParams, AbortController, fetch: fetchImpl, console });
  vm.runInContext(script, context);
  return { elements, context };
}
test("public page initializes without fetching a report or missing an element", () => { page(); });
test("1+1 condos retain the reported layout without asserting a basement bedroom", () => {
  const { elements, context } = page();
  context.condoFixture = { forSale:true,isCondominium:true,beds:2,baths:2,publicListing:{bedroomsAboveGrade:1,bedroomsBelowGrade:1},remarks:'Luxury apartment',basement:['None'] };
  vm.runInContext('renderQuickFacts(condoFixture); renderAiBrief(condoFixture)',context);
  assert.equal(elements.get('factBeds').textContent,'1+1');
  assert.ok(!elements.get('flagSignalText').textContent.includes('below grade'));
  assert.equal(elements.get('showingSignal').textContent,'Review fees & building records');
});
test("snapshot renders facts and costs, never a supplied sold range or score", () => {
  const { elements, context } = page();
  context.listingFixture = { forSale: true, address: "Fixture home", listingKey: "N1000001", listPrice: 1000000, beds: 3, baths: 2, daysLive: 2, livingAreaRange: "1500-2000", parkingTotal: 2, photos: [], details: { annualTax: 4800, taxYear: 2026, possession: "Flexible" }, maintenanceFee: { amount: 400, frequency: "month", included: ["Water"] }, publicListing: { priceChange: { original: 1100000, amount: 100000, percent: 9.1 }, updatedAt: "2026-09-05" }, priceOpinion: { available: true, low: 888888, high: 999999 }, comparableContext: { available: true, comparables: [{ address: "PRIVATE SOLD ADDRESS", soldPrice: 888888 }] } };
  vm.runInContext("renderListing(listingFixture)", context);
  assert.match(elements.get("priceSignalText").textContent, /100,000.*9.1%/);
  assert.match(elements.get("snapshotTaxNote").textContent, /400.*tax alone/);
  assert.match(elements.get("snapshotFeeNote").textContent, /Water/);
  const visible = [...elements.values()].map(e => e.textContent + e.innerHTML).join(" ");
  assert.ok(!visible.includes("PRIVATE SOLD ADDRESS"));
  assert.ok(!visible.includes("888,888"));
  vm.runInContext("renderListing({ forSale: true, photos: [] })", context);
  assert.equal(elements.get("snapshotTaxValue").textContent, "Not reported");
  assert.equal(elements.get("snapshotFeeValue").textContent, "Not reported");
  assert.equal(elements.get("flagSignal").textContent, "Size not reported");
  assert.ok(!elements.get("priceSignalText").textContent.includes("100,000"), "no stale facts from the previous property");
});
test("discovery empty, error and escaped result states use only the discovery endpoint", async () => {
  let mode = "empty";
  const paths = [];
  const { elements, context } = page(async url => {
    paths.push(url);
    assert.ok(url.startsWith("/api/discovery?"));
    if (mode === "error") return Response.json({ ok: false, error: "IDX unavailable" }, { status: 502 });
    return Response.json({ ok: true, listings: mode === "empty" ? [] : [{ listingKey: "N1000001", address: '<img src=x onerror="alert(1)">', listPrice: 900000, propertySubType: "Detached", daysLive: 1 }], coverage: { partial: true }, note: "Not the full market." });
  });
  elements.get("discoveryCity").value = "Vaughan";
  elements.get("discoveryType").value = "any";
  vm.runInContext("openDiscovery('luxury')", context);
  const submit = elements.get("discoveryForm").handlers.submit;
  await submit({ preventDefault() {} });
  assert.match(elements.get("discoveryStatus").textContent, /No matches in the listings checked/);
  mode = "error";
  await submit({ preventDefault() {} });
  assert.equal(elements.get("discoveryStatus").textContent, "IDX unavailable");
  assert.equal(elements.get("discoveryResults").innerHTML, "");
  mode = "result";
  await submit({ preventDefault() {} });
  assert.ok(elements.get("discoveryResults").innerHTML.includes("&lt;img"));
  assert.ok(!elements.get("discoveryResults").innerHTML.includes("<img"));
  assert.equal(elements.get("discoverySubmit").disabled, false);
  assert.equal(paths.length, 3);
  assert.ok(!elements.get("leadForm").submitted);
});

test('Price Check displays its basis and clears all evidence for the next property', () => {
  const {elements,context}=page();
  context.priceFixture={available:true,signal:'below',label:'Lower asking price',asking:900000,medianAsk:1000000,differencePct:-10,count:3,criteria:'Vellore Village · Townhouse',matches:[{listingKey:'N1000002',address:'<img src=x>',asking:1000000,size:'1500–2000 sq ft',beds:3,baths:3}]};
  vm.runInContext('renderPriceCheck(priceFixture)',context);
  assert.match(elements.get('priceCheckBadge').textContent,/✓ Lower/);
  assert.equal(elements.get('priceCheckQuickStatus').textContent, elements.get('priceCheckBadge').textContent);
  assert.match(elements.get('priceCheckSummary').textContent,/10% below.*3 matching active/);
  assert.ok(!elements.get('priceCheckMatches').innerHTML.includes('<img'));
  vm.runInContext('renderListing({forSale:true,listingKey:"N1000009",photos:[]})',context);
  assert.equal(elements.get('priceCheckMatches').innerHTML,'');
  assert.equal(elements.get('priceCheckNumbers').innerHTML,'');
  vm.runInContext('renderPriceCheck({available:false,count:0,reason:"Only 0 matching active listings were found."})',context);
  assert.equal(elements.get('priceCheckBadge').textContent,'More evidence needed');
  assert.equal(elements.get('priceCheckQuickStatus').textContent,'More evidence needed');
  assert.equal(elements.get('priceCheckNumbers').innerHTML,'');
});
test('late Price Check response cannot overwrite a different property snapshot', async () => {
  let finish;
  const {elements,context}=page(async()=>await new Promise(resolve=>{finish=resolve;}));
  const pending=vm.runInContext('liveListing={forSale:true,listingKey:"N1000001",listPrice:900000}; loadPriceCheck(liveListing)',context);
  vm.runInContext('liveListing={forSale:true,listingKey:"N1000002",photos:[]}; renderListing(liveListing)',context);
  finish(Response.json({ok:true,listingKey:'N1000001',available:true,signal:'below',label:'OLD RESULT',count:3,medianAsk:1000000,asking:900000,differencePct:-10}));
  await pending;
  assert.ok(!elements.get('priceCheckBadge').textContent.includes('OLD RESULT'));
  assert.ok(!elements.get('priceCheckQuickStatus').textContent.includes('OLD RESULT'));
});
