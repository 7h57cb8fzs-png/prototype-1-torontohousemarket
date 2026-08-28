import assert from "node:assert/strict";
import { discoverDistrictRows, searchProperties, validateSearch } from "./worker-v12.js";

assert.deepEqual(validateSearch({ district:"w05" }), { district:"W05", listed_within_days:19, limit:20 });
assert.deepEqual(validateSearch({ query:"10 King St", listed_within_days:7, limit:5 }), { query:"10 King St", listed_within_days:7, limit:5 });
assert.throws(() => validateSearch({ district:"Toronto W05" }), /district must look like/);
assert.throws(() => validateSearch({ district:"W05", limit:500 }), /limit must be/);
assert.deepEqual(discoverDistrictRows([
  { ListingKey:"A", MlsAreaMajor:"Toronto W05" },
  { ListingKey:"B", MlsAreaMajor:"Toronto C01" },
], "W05"), { rows:[{ ListingKey:"A", MlsAreaMajor:"Toronto W05" }], field:"MlsAreaMajor" });

const originalFetch = globalThis.fetch;
const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  if (String(url).includes("MlsAreaMajor+eq+%27W05%27")) {
    return new Response(JSON.stringify({ value:[{
      ListingKey:"W1234567", UnparsedAddress:"10 Example St", City:"Toronto", CityRegion:"York University Heights",
      MlsAreaMajor:"W05", ListPrice:899000, BedroomsTotal:3, BathroomsTotalInteger:2,
      PropertySubType:"Detached", StandardStatus:"Active", TransactionType:"For Sale",
      OriginalEntryTimestamp:new Date().toISOString(), InternetEntireListingDisplayYN:true, InternetAddressDisplayYN:true,
    }] }), { headers:{ "Content-Type":"application/json" } });
  }
  return new Response(JSON.stringify({ value:[] }), { headers:{ "Content-Type":"application/json" } });
};

const result = await searchProperties({ district:"W05", listed_within_days:19, limit:20 }, { AMPRE_TOKEN:"test-token" });
assert.equal(result.count, 1);
assert.equal(result.listings[0].district, "W05");
assert.equal(result.listings[0].status, "Active");
assert.equal(result.criteria.status, "active");
assert.ok(requested[0].includes("OriginalEntryTimestamp+ge+"));
assert.ok(requested[0].includes("%24top=20"));

globalThis.fetch = originalFetch;
console.log("worker-v12 tests passed");
