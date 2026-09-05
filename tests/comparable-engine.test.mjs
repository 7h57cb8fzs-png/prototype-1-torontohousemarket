import test from "node:test";
import assert from "node:assert/strict";
import {
  buildComparableContext,
  comparableHasCompatibleSize,
  comparableIsLocal,
  distanceBetweenProperties,
  exactComparableType,
  filterPriceCluster,
  isSoldWithinDays,
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
  const mapKm = distanceBetweenProperties({ MapLatitude: 43.6901, MapLongitude: -79.3415 }, { MapLatitude: 43.678, MapLongitude: -79.349 });
  assert.ok(mapKm > 1 && mapKm < 2);
});

test("locality accepts only the same community or a verified radius", () => {
  assert.equal(comparableIsLocal({ sameRegion: true, samePostalPrefix: false, distanceKm: null }), true);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: true, distanceKm: null }), false);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: 4.9 }), true);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: 5.1 }), false);
  assert.equal(comparableIsLocal({ sameRegion: false, samePostalPrefix: false, distanceKm: null }), false);
});

test("property subtype matching is exact", () => {
  assert.equal(exactComparableType({ PropertySubType: "Detached" }, { PropertySubType: "Detached" }), true);
  assert.equal(exactComparableType({ PropertySubType: "Detached" }, { PropertySubType: "Semi-Detached" }), false);
  assert.equal(exactComparableType({ PropertySubType: "Att/Row/Townhouse" }, { PropertySubType: "Condo Townhouse" }), false);
});

test("known living-area bands must match exactly", () => {
  const subject = { LivingAreaRange: "2500-3000" };
  assert.equal(comparableHasCompatibleSize(subject, { LivingAreaRange: "2500-3000" }), true);
  assert.equal(comparableHasCompatibleSize(subject, { LivingAreaRange: "2000-2500" }), false);
  assert.equal(comparableHasCompatibleSize(subject, { LivingAreaRange: "1500-2000" }), false);
  assert.equal(comparableHasCompatibleSize(subject, { LivingAreaRange: null }), false);
});

test("closed rental listings cannot become sold comparables", () => {
  const subject = soldRow({ ListPrice: 1128000, ClosePrice: null });
  assert.equal(isSoldWithinDays(soldRow({ TransactionType: "For Lease", ClosePrice: 3950 }), 100, subject), false);
  assert.equal(isSoldWithinDays(soldRow({ MlsStatus: "Leased", ClosePrice: 3900 }), 100, subject), false);
  assert.equal(isSoldWithinDays(soldRow({ TransactionType: "For Sale", ClosePrice: 3800 }), 100, subject), false);
  assert.equal(isSoldWithinDays(soldRow({ TransactionType: "For Sale", ClosePrice: 1050000 }), 100, subject), true);
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
    assert.ok(decodedCalls.every((url) => !url.includes("startswith(PostalCode,'M4J')")), "postal fallback should not run when community evidence is sufficient");
    assert.ok(decodedCalls.every((url) => !url.includes("PropertySubType eq")));
    assert.ok(decodedCalls.some((url) => url.includes("$top=100")));
    assert.ok(calls.every((url) => new URL(url).searchParams.get("$top") !== "1"));
    assert.ok(decodedCalls.every((url) => !url.includes("$orderby=")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("engine uses the postal history scan only when community evidence is insufficient", async () => {
  const subject = soldRow({ ListingKey: "SUBJECT", UnparsedAddress: "494 Donlands Avenue, Toronto", ClosePrice: null });
  const communityRows = [
    soldRow({ ListingKey: "COMMUNITY1", ClosePrice: 950000 }),
    soldRow({ ListingKey: "COMMUNITY2", ClosePrice: 975000 })
  ];
  const postalRows = [
    ...communityRows,
    soldRow({ ListingKey: "POSTAL3", ClosePrice: 1000000 }),
    soldRow({ ListingKey: "POSTAL4", ClosePrice: 1025000 })
  ];
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const decoded = decodeURIComponent(String(url).replaceAll("+", " "));
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") {
      return new Response(JSON.stringify({ "@odata.count": postalRows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const value = decoded.includes("startswith(PostalCode,'M4J')") ? postalRows : communityRows;
    return new Response(JSON.stringify({ value }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "postal-fallback-test");
    assert.equal(result.available, true);
    assert.deepEqual(result.comparables.map((row) => row.listingKey).sort(), ["COMMUNITY1", "COMMUNITY2", "POSTAL3", "POSTAL4"]);
    const decodedCalls = calls.map((url) => decodeURIComponent(url.replaceAll("+", " ")));
    assert.ok(decodedCalls.some((url) => url.includes("contains(CityRegion,'East York')")));
    assert.ok(decodedCalls.some((url) => url.includes("startswith(PostalCode,'M4J')")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("engine does not reuse small-home sales for a materially larger townhouse", async () => {
  const subject = soldRow({
    ListingKey: "DONNACONA",
    PropertySubType: "Att/Row/Townhouse",
    CityRegion: "Vellore Village",
    PostalCode: "L4H 0Y6",
    LivingAreaRange: "2500-3000",
    ListPrice: 1325990,
    ClosePrice: null
  });
  const rows = [
    soldRow({ ListingKey: "DAVOS-COMP-1", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 2M8", LivingAreaRange: "1500-2000", ClosePrice: 885000 }),
    soldRow({ ListingKey: "DAVOS-COMP-2", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 3J5", LivingAreaRange: "1500-2000", ClosePrice: 930000 }),
    soldRow({ ListingKey: "DAVOS-COMP-3", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 1T3", LivingAreaRange: "1500-2000", ClosePrice: 935000 }),
    soldRow({ ListingKey: "LARGE-1", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 0Y1", LivingAreaRange: "2500-3000", ClosePrice: 1160000 }),
    soldRow({ ListingKey: "LARGE-2", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 0Y2", LivingAreaRange: "2500-3000", ClosePrice: 1190000 }),
    soldRow({ ListingKey: "LARGE-3", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 0Y3", LivingAreaRange: "2000-2500", ClosePrice: 1210000 }),
    soldRow({ ListingKey: "LARGE-4", PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 0Y4", LivingAreaRange: "2500-3000", ClosePrice: 1230000 })
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") {
      return new Response(JSON.stringify({ "@odata.count": rows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ value: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "size-gate-test");
    assert.equal(result.available, true);
    assert.deepEqual(result.comparables.map((row) => row.listingKey).sort(), ["LARGE-1", "LARGE-2", "LARGE-4"]);
    assert.ok(result.comparables.every((row) => row.livingAreaRange !== "1500-2000"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a 2000-2500 subject cannot reuse the Davos 1500-2000 comparables", async () => {
  const subject = soldRow({
    ListingKey: "LINDBERGH",
    PropertySubType: "Att/Row/Townhouse",
    CityRegion: "Vellore Village",
    PostalCode: "L4H 1M1",
    LivingAreaRange: "2000-2500",
    ListPrice: 950000,
    ClosePrice: null
  });
  const rows = [
    ...["LAURELHURST", "WARDLAW", "MONTE-CARLO"].map((key, index) => soldRow({ ListingKey: key, PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 2M8", LivingAreaRange: "1500-2000", ClosePrice: 900000 + index * 10000 })),
    ...["EXACT-1", "EXACT-2", "EXACT-3"].map((key, index) => soldRow({ ListingKey: key, PropertySubType: "Att/Row/Townhouse", CityRegion: "Vellore Village", PostalCode: "L4H 1M2", LivingAreaRange: "2000-2500", ClosePrice: 1000000 + index * 10000 }))
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") return new Response(JSON.stringify({ "@odata.count": rows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    assert.match(decodeURIComponent(String(url)), /\$select=.*ListingKey/);
    return new Response(JSON.stringify({ value: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "lindbergh-size-regression");
    assert.equal(result.available, true);
    assert.deepEqual(result.comparables.map((row) => row.listingKey).sort(), ["EXACT-1", "EXACT-2", "EXACT-3"]);
    assert.equal(result.policy.exactLivingAreaBand, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("engine removes the size restriction when fewer than three exact-size sales exist", async () => {
  const subject = soldRow({
    ListingKey: "SPARSE-SUBJECT",
    PropertySubType: "Att/Row/Townhouse",
    CityRegion: "Patterson",
    PostalCode: "L6A 5A1",
    LivingAreaRange: "2500-3000",
    ListPrice: 1389000,
    ClosePrice: null
  });
  const rows = [
    soldRow({ ListingKey: "EXACT-1", PropertySubType: "Att/Row/Townhouse", CityRegion: "Patterson", PostalCode: "L6A 5A2", LivingAreaRange: "2500-3000", ClosePrice: 1325000 }),
    soldRow({ ListingKey: "EXACT-2", PropertySubType: "Att/Row/Townhouse", CityRegion: "Patterson", PostalCode: "L6A 5A3", LivingAreaRange: "2500-3000", ClosePrice: 1375000 }),
    soldRow({ ListingKey: "OTHER-SIZE-1", PropertySubType: "Att/Row/Townhouse", CityRegion: "Patterson", PostalCode: "L6A 4Z1", LivingAreaRange: "2000-2500", ClosePrice: 1300000 }),
    soldRow({ ListingKey: "OTHER-SIZE-2", PropertySubType: "Att/Row/Townhouse", CityRegion: "Patterson", PostalCode: "L6A 4Z2", LivingAreaRange: "1500-2000", ClosePrice: 1350000 }),
    soldRow({ ListingKey: "OTHER-SIZE-3", PropertySubType: "Att/Row/Townhouse", CityRegion: "Patterson", PostalCode: "L6A 4Z3", LivingAreaRange: "2000-2500", ClosePrice: 1400000 }),
    soldRow({ ListingKey: "WRONG-TYPE", PropertySubType: "Semi-Detached", CityRegion: "Patterson", PostalCode: "L6A 4Z4", LivingAreaRange: "2500-3000", ClosePrice: 1350000 })
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") return new Response(JSON.stringify({ "@odata.count": rows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ value: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "size-fallback-test");
    assert.equal(result.available, true);
    assert.equal(result.policy.sizeFallbackUsed, true);
    assert.equal(result.policy.exactLivingAreaBand, false);
    assert.equal(result.policy.sizeRule, "same_type_only_fallback");
    assert.ok(result.comparables.some((row) => row.livingAreaRange !== "2500-3000"));
    assert.ok(result.comparables.every((row) => row.propertySubType === "Att/Row/Townhouse"));
    assert.ok(!result.comparables.some((row) => row.listingKey === "WRONG-TYPE"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("engine expands time to 600 days before weakening property similarity", async () => {
  const subject = soldRow({ ListingKey: "SUBJECT", LivingAreaRange: "2000-2500", ClosePrice: null });
  const rows = ["OLDER-1", "OLDER-2", "OLDER-3"].map((key, index) => soldRow({
    ListingKey: key,
    LivingAreaRange: "2000-2500",
    PurchaseContractDate: new Date(Date.now() - (400 + index) * 864e5).toISOString(),
    ClosePrice: 1000000 + index * 10000
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("$count") === "true") return new Response(JSON.stringify({ "@odata.count": rows.length, value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ value: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await buildComparableContext(subject, { AMPRE_TOKEN: "test-only" }, true, "time-expansion-test");
    assert.equal(result.available, true);
    assert.equal(result.policy.windowDays, 600);
    assert.ok(result.comparables.every((row) => row.livingAreaRange === "2000-2500"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
