import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSellerReport, sellerReportEmail } from "../worker-v11.js";

test("seller report preserves renovation slider context", async () => {
  const property={
    address:"38 Oak Avenue, Richmond Hill",
    marketStatus:"Listing status unconfirmed",
    propertySubType:"Detached",
    cityRegion:"Oak Ridges",
    city:"Richmond Hill",
    postalCode:"L4E 3S2",
    livingAreaRange:"1500-2000",
    beds:3,
    basement:"Finished",
    kitchens:1,
    sellerProfile:{
      version:3,homeType:"Detached",city:"Richmond Hill",community:"Oak Ridges",sizeBand:"1500-2000",
      beds:3,belowBeds:0,basement:"finished",entrance:"no",kitchens:1,postal:"L4E3S2",
      condition:"owner_reported",renovationPct:50,upgrades:[],targetMin:null,targetMax:null,targetPrice:null,
      timing:"exploring",notes:"[THM_RENOVATION_PCT:50]",ownerConsent:true,contactConsent:true
    },
    comparableContext:{available:false,basis:"test",comparables:[]},
    sellerEvidence:{listingMatched:false,listingFactsAgree:false,history:[],diagnostics:{}}
  };
  const report=await buildSellerReport({}, {lead_mode:"seller"}, property, "test");
  assert.equal(report.seller.profile.condition,"owner_reported");
  assert.equal(report.seller.profile.renovationPct,50);
  const email=sellerReportEmail(property.address,report);
  assert.doesNotMatch(email.html,/THM_RENOVATION_PCT/);
  assert.match(email.html,/Owner-reported renovation context: 50%/);
});

test("seller history is exact-address-first and bounded", () => {
  const src=fs.readFileSync("worker-v11.js","utf8");
  assert.match(src,/StreetNumber eq/);
  assert.match(src,/contains\(City/);
  assert.match(src,/contains\(UnparsedAddress/);
  assert.match(src,/await runFilters\(exactQueries, 300\)/);
  assert.match(src,/await runFilters\(fallbackQueries, 500\)/);
  assert.doesNotMatch(src,/sellerQueryRows\(\[filter\], env, 2e3\)/);
});

test("seller V7 policy has no mechanical condition multiplier", () => {
  const src=fs.readFileSync("worker-v12.js","utf8");
  assert.doesNotMatch(src,/condition_adjustment_pct/);
  assert.doesNotMatch(src,/Number\(base\.low\) \* \(1 \+ adjustment\)/);
  assert.match(src,/treatment: "context_only"/);
});


test("seller report loader preserves owner-reported slider profile and broad recovery uses City", () => {
  const v11=fs.readFileSync("worker-v11.js","utf8");
  const v12=fs.readFileSync("worker-v12.js","utf8");
  assert.doesNotMatch(v11,/lead\.property_snapshot\.sellerProfile, upgrades: \[\], condition: "unknown"/);
  assert.match(v12,/searches\.push\(`contains\(City/);
  assert.doesNotMatch(v12,/searches\.push\(`contains\(UnparsedAddress/);
});
