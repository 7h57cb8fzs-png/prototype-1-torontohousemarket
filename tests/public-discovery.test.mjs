import test from "node:test";
import assert from "node:assert/strict";
import worker, { publicListingFacts, discoveryOptions, discoverySelection } from "../worker-v11.js";

const now = Date.parse("2026-09-06T12:00:00Z");
const home = (id, extra = {}) => ({ ListingKey: id, City: "Vaughan", UnparsedAddress: `${id} Test Street, Vaughan`, StandardStatus: "Active", TransactionType: "For Sale", PropertySubType: "Detached", ListPrice: 1000000, OriginalListPrice: 1100000, OriginalEntryTimestamp: "2026-09-04T12:00:00Z", BedroomsTotal: 3, BathroomsTotalInteger: 2, ...extra });
const options = (extra = {}) => ({ mode: "new", city: "Vaughan", type: "any", maxPrice: null, ...extra });

test("new listings require dates within seven days and public active residential permission", () => {
  const rows = [home("N1000001"), home("N1000001"), home("N1000002", { StandardStatus: "Sold" }), home("N1000003", { TransactionType: "For Lease" }), home("N1000004", { InternetAddressDisplayYN: false }), home("N1000005", { InternetEntireListingDisplayYN: "No" }), home("N1000006", { OriginalEntryTimestamp: null }), home("N1000007", { OriginalEntryTimestamp: "2026-08-01" }), home("N1000008", { OriginalEntryTimestamp: "2026-09-10" }), home("N1000009", { City: "Markham" }), home("N1000010", { PropertySubType: "Office" })];
  assert.deepEqual(discoverySelection(rows, options(), now).map(r => r.listingKey), ["N1000001"]);
});
test("price drops use this listing's original asking price, not sold or fabricated values", () => {
  const rows = [home("N1000001"), home("N1000002", { OriginalListPrice: null }), home("N1000003", { OriginalListPrice: 900000 }), home("N1000004", { OriginalListPrice: 1000000 }), home("N1000005", { OriginalListPrice: 1200000 })];
  const matches = discoverySelection(rows, options({ mode: "drops" }), now);
  assert.deepEqual(matches.map(r => r.listingKey), ["N1000005", "N1000001"]);
  assert.equal(matches[1].priceChange.amount, 100000);
  assert.equal(matches[1].priceChange.percent, 9.1);
});
test("budget cap and freehold/condo townhouse distinction are exact", () => {
  const rows = [home("N1000001", { PropertySubType: "Att/Row/Townhouse", ListPrice: 900000 }), home("N1000002", { PropertySubType: "Condo Townhouse", ListPrice: 800000 }), home("N1000003", { PropertySubType: "Att/Row/Townhouse", ListPrice: 1100000 })];
  const matches = discoverySelection(rows, options({ mode: "budget", maxPrice: 1000000, type: "freehold_town" }), now);
  assert.deepEqual(matches.map(r => r.listingKey), ["N1000001"]);
});
test("public response allowlist excludes protected and contact data", () => {
  const row = home("N1000001", { ClosePrice: 888888, PrivateRemarks: "private", ListAgentEmail: "private@example.com", Latitude: 43.5 });
  const result = JSON.stringify(discoverySelection([row], options(), now));
  for (const forbidden of ["ClosePrice", "888888", "private", "Latitude"]) assert.ok(!result.includes(forbidden));
  assert.equal(publicListingFacts({ ...row, InternetAddressDisplayYN: "false" }), null);
  assert.equal(publicListingFacts({ ...row, StandardStatus: "Sold" }), null);
  assert.equal(publicListingFacts(row).lotUnits, null);
});
test("discovery options reject injected city, unsupported types and invalid budgets", () => {
  for (const search of ["city=Vaughan%27", "type=__proto__", "mode=invalid", "maxPrice=NaN", "maxPrice=-1", "maxPrice=Infinity", "mode=budget", "maxPrice=900000.5"]) {
    assert.throws(() => discoveryOptions(new URL(`https://example.com/api/discovery?${search}`)));
  }
});
test("existing public display restriction stays off by default, without any upstream request", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not fetch"); });
  const response = await worker.fetch(new Request("https://example.com/api/discovery?city=Vaughan"), { AMPRE_TOKEN: "idx-fixture", AMPRE_VOW_TOKEN: "never-use" }, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "discovery_disabled");
  assert.equal(fetch.mock.callCount(), 0);
});
test("enabled discovery uses only IDX, follows nextLink and does not produce a false zero on upstream error", async (t) => {
  let fail = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(init.headers.Authorization, "Bearer idx-fixture");
    if (fail) return new Response("provider error", { status: 400 });
    const second = url.searchParams.has("$skip");
    return Response.json({ value: [home(second ? "N1000002" : "N1000001")], ...(!second ? { "@odata.nextLink": "https://query.ampre.ca/odata/Property?$skip=100" } : {}) });
  });
  const env = { PUBLIC_DISCOVERY_ENABLED: "true", AMPRE_TOKEN: "idx-fixture", AMPRE_VOW_TOKEN: "never-use" };
  const request = new Request("https://example.com/api/discovery?city=Vaughan&mode=budget&maxPrice=1200000");
  const response = await worker.fetch(request, env, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).listings.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("$orderby"), "OriginalEntryTimestamp desc");
  fail = true;
  const failure = await worker.fetch(request, env, {});
  assert.equal(failure.status, 502);
  assert.equal((await failure.json()).listings, undefined);
});
test("pagination refuses foreign hosts and caps scans with honest coverage", async (t) => {
  let foreign = true;
  let page = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).hostname, "query.ampre.ca");
    page++;
    return Response.json({ value: [home(`N100000${page}`)], "@odata.nextLink": foreign ? "https://example.org/steal" : `https://query.ampre.ca/odata/Property?$skip=${page * 100}` });
  });
  const request = new Request("https://example.com/api/discovery?city=Vaughan&mode=drops");
  const env = { PUBLIC_DISCOVERY_ENABLED: "true", AMPRE_TOKEN: "idx-fixture" };
  assert.equal((await worker.fetch(request, env, {})).status, 502);
  assert.equal(page, 1);
  foreign = false;
  page = 0;
  const data = await (await worker.fetch(request, env, {})).json();
  assert.equal(page, 5);
  assert.equal(data.coverage.partial, true);
});

test("public MLS lookup preserves its mode through legacy handlers without querying comparable evidence", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(init.headers.Authorization, "Bearer idx-fixture");
    assert.ok(url.pathname.includes("Property('N1000001')"), `Unexpected extra query: ${url.pathname}`);
    return Response.json(home("N1000001", { ClosePrice: 888888, Media: [{ MediaKey: "photo", MediaType: "image/jpeg", MediaURL: "https://example.com/photo.jpg" }] }));
  });
  const response = await worker.fetch(new Request("https://example.com/api/property?listingKey=N1000001"), { AMPRE_TOKEN: "idx-fixture" }, { waitUntil() {} });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.property.publicListing.priceChange.amount, 100000);
  assert.equal(data.property.comparableContext.available, false);
  assert.ok(!JSON.stringify(data).includes("888888"));
  assert.equal(calls.length, 1);
});

test("address lookup carries public facts into the final snapshot", async (t) => {
  const record = home("N1000001", { UnparsedAddress: "331 Davos Road, Vaughan, ON", StreetNumber: "331", StreetName: "Davos", StreetSuffix: "Road", Media: [{ MediaKey: "photo", MediaType: "image/jpeg", MediaURL: "https://example.com/photo.jpg" }] });
  let collectionCalls = 0;
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    if (url.pathname.includes("Property('N1000001')")) return Response.json(record);
    assert.equal(url.pathname, "/odata/Property");
    assert.match(url.searchParams.get("$filter"), /Davos/);
    collectionCalls++;
    return Response.json({ value: [record] });
  });
  const response = await worker.fetch(new Request("https://example.com/api/property?q=331%20Davos%20Road%2C%20Vaughan"), { AMPRE_TOKEN: "idx-fixture" }, { waitUntil() {} });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.property.publicListing.priceChange.amount, 100000);
  assert.equal(data.property.listingKey, "N1000001");
  assert.ok(collectionCalls >= 1);
});

test("restricted single-property snapshots cannot leak details through older handlers", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(home("N1000001", { InternetAddressDisplayYN: false, PublicRemarks: "PRIVATE ADDRESS DETAIL", ClosePrice: 888888, Media: [{ MediaKey: "photo", MediaType: "image/jpeg", MediaURL: "https://example.com/photo.jpg" }] })));
  const response = await worker.fetch(new Request("https://example.com/api/property?listingKey=N1000001"), { AMPRE_TOKEN: "idx-fixture" }, { waitUntil() {} });
  const data = await response.json();
  assert.equal(data.property.displayRestricted, true);
  assert.deepEqual(data.property.photos, []);
  assert.equal(data.property.listPrice, undefined);
  assert.ok(!JSON.stringify(data).includes("PRIVATE ADDRESS DETAIL"));
});
