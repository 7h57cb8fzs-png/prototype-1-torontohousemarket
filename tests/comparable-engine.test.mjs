import test from "node:test";
import assert from "node:assert/strict";
import {
  buildComparableContext,
  comparableIsLocal,
  distanceBetweenProperties,
  exactComparableType,
  filterPriceCluster,
  locateRecentHistoryStart,
  numberOrNull,
  queryPropertyCount,
  safeAmpreNextLink
} from "../worker-v11.js";

function soldRow(overrides = {}) {
  return {
    ListingKey: crypto.randomUUID(),
    PropertySubType: "Detached",
    PropertyType: "Single Family Residence",
    CityRegion: "East York",
    PostalCode: "M4J 3A1",
    StandardStatus: "Closed",
    ClosePrice: 1000000,
    PurchaseContractDate: new Date(Date.now() - 30 * 864e5).toISOString(),
    BedroomsTotal: 3,
    BathroomsTotalInteger: 2,
    ...overrides
  };
}

test("missing numeric values stay null", () => {
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull(undefined), null);
  assert.equal(numberOrNull(""), null);
  assert.equal(numberOrNull("   "), null);
  assert.equal(numberOrNull("43.7"), 43.7);
});

test("distance is calculated only from real coordinates", () => {
  assert.equal(distanceBetweenProperties({}, {}), null);
  assert.equal(distanceBetweenProperties({ Latitude: null, Longitude: null }, { Latitude: 43.7, Longitude: -79.3 }), null);
  const km = distanceBetweenProperties({ Latitude: 43.6901, Longitude: -79.3415 }, { Latitude: 43.678, Longitude: -79.349 });
  assert.ok(km > 1 && km < 2);
});

test("locality accepts same community, same postal prefix, or verified radius only", () => {
  assert.equal(comparableIsLocal({ sameRegion: true, samePostalPrefix: false, distanceKm: null }), true);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: true, distanceKm: null }), true);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: 4.9 }), true);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: 5.1 }), false);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: null }), false);
});

test("property subtype matching is exact", () => {
  assert.equal(exactComparableType({ PropertySubType: "Detached" }, { PropertySubType: "Detached" }), true);
  assert.equal(exactComparableType({ PropertySubType: "Detached" }, { PropertySubType: "Semi-Detached" }), false);
  assert.equal(exactComparableType({ PropertySubType: "Att/Row/Townhouse" }, { PropertySubType: "Condo Townhouse" }), false);
});

test("price screen uses the geographically qualified candidate median", () => {
  const result = filterPriceCluster([
    { price: 900000 },
    { price: 950000 },
    { price: 1000000 },
    { price: 1050000 },
    { price: 1400000 }
  ], 0.1);
  assert.equal(result.median, 1000000);
  assert.deepEqual(result.matches.map((row) => row.price), [900000, 950000, 1000000, 1050000]);
});

test("pagination links cannot leave the licensed AMPRE origin", () => {
  assert.equal(safeAmpreNextLink("https://evil.example/odata/Property?$skip=1"), null);
  assert.match(safeAmpreNextLink("https://query.ampre.ca/odata/Property?$skip=250"), /^https:\/\/query\.ampre\.ca\/odata\/Property/);
});

test("dynamic tail discovery scans the newest bounded history window", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const skip = Number(parsed.searchParams.get("$skip") || 0);
    calls.push(skip);
    const value = skip <= 2700 ? [{ ListingKey: `ROW-${skip}` }] : [];
    return new Response(JSON.stringify({ value }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await locateRecentHistoryStart(["startswith(PostalCode,'L4H')"], { AMPRE_TOKEN: "test-only" }, 1000, 100, 1000);
    assert.equal(result.startSkip, 1800);
    assert.equal(result.tailSkip, 2700);
    assert.equal(result.reliable, true);
    assert.ok(calls.includes(1000));
    assert.ok(calls.includes(2000));
    assert.ok(calls.some((skip) => skip > 2700));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("property count locates the newest history window in one request", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ "@odata.count": 2701, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await queryPropertyCount(["startswith(PostalCode,'L4H')"], { AMPRE_TOKEN: "test-only" });
    assert.equal(result.count, 2701);
    assert.equal(calls.length, 1);
    const decoded = decodeURIComponent(calls[0].replaceAll("+", " "));
    assert.ok(decoded.includes("$count=true"));
    assert.ok(decoded.includes("$top=0"));
    assert.ok(decoded.includes("startswith(PostalCode,'L4H')"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("engine excludes unrelated communities before applying the price screen", async () => {
  const subject = soldRow({ ListingKey: "SUBJECT", UnparsedAddress: "494 Donlands Avenue, Toronto", ClosePrice: null });
  const rows = [
    soldRow({ ListingKey: "LOCAL1", ClosePrice: 900000 }),
    soldRow({ ListingKey: "LOCAL2", ClosePrice: 950000 }),
    soldRow({ ListingKey: "LOCAL3", ClosePrice: 1000000 }),
    soldRow({ ListingKey: "LOCAL4", ClosePrice: 1050000 }),
    soldRow({ ListingKey: "DISTANT", CityRegion: "Mimico", PostalCode: "M8V 1A1", ClosePrice: 1000000 }),
    soldRow({ ListingKey: "WRONGTYPE", PropertySubType: "Semi-Detached", ClosePrice: 1000000 })
  ];
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") {
      return new Response(JSON.stringify({ "@odata.count": rows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ value: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "test-request");
    assert.equal(result.available, true);
    assert.deepEqual(result.comparables.map((row) => row.listingKey).sort(), ["LOCAL1", "LOCAL2", "LOCAL3", "LOCAL4"]);
    assert.ok(result.comparables.every((row) => row.cityRegion === "East York"));
    const decodedCalls = calls.map((url) => decodeURIComponent(url.replaceAll("+", " ")));
    assert.ok(decodedCalls.some((url) => url.includes("contains(CityRegion,'East York')")));
    assert.ok(decodedCalls.some((url) => url.includes("startswith(PostalCode,'M4J')")));
    assert.ok(decodedCalls.every((url) => !url.includes("PropertySubType eq")));
    assert.ok(decodedCalls.some((url) => url.includes("$top=100")));
    assert.ok(decodedCalls.some((url) => url.includes("$count=true") && url.includes("$top=0")));
    assert.ok(calls.every((url) => new URL(url).searchParams.get("$top") !== "1"));
    assert.ok(decodedCalls.every((url) => !url.includes("$orderby=")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
