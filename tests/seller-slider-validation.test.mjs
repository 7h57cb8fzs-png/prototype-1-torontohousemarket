import test from "node:test";
import assert from "node:assert/strict";
import { validateSellerProfile } from "../worker-v11.js";

const base = {
  version:3,
  homeType:"Detached",
  city:"Toronto",
  community:"",
  sizeBand:"1500-2000",
  beds:3,
  belowBeds:0,
  basement:"finished",
  entrance:"no",
  kitchens:1,
  postal:"",
  condition:"owner_reported",
  renovationPct:50,
  upgrades:[],
  targetPrice:null,
  targetMin:null,
  targetMax:null,
  timing:"exploring",
  notes:"[THM_RENOVATION_PCT:50]",
  ownerConsent:true,
  contactConsent:true
};

test("seller v3 renovation slider profile is accepted", () => {
  const result=validateSellerProfile(base);
  assert.equal(result.version,3);
  assert.equal(result.condition,"owner_reported");
  assert.equal(result.renovationPct,50);
});

test("seller renovation slider accepts endpoints and rejects out of range", () => {
  assert.equal(validateSellerProfile({...base,renovationPct:0}).renovationPct,0);
  assert.equal(validateSellerProfile({...base,renovationPct:100}).renovationPct,100);
  assert.throws(()=>validateSellerProfile({...base,renovationPct:101}),/renovation level/i);
});

test("legacy seller condition values remain backward compatible", () => {
  const result=validateSellerProfile({...base,version:2,condition:"maintained",renovationPct:undefined});
  assert.equal(result.version,2);
  assert.equal(result.condition,"maintained");
});
