import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker-v11.js";

test("production worker owns address suggestion routes", async t => {
  t.mock.method(globalThis,"fetch", async (input, init={}) => {
    const url=new URL(input);
    if(url.hostname==="places.googleapis.com" && url.pathname.endsWith("/places:autocomplete")) {
      return Response.json({suggestions:[{placePrediction:{placeId:"abc1234567890",text:{text:"38 Oak Street, Toronto, ON, Canada"}}}]});
    }
    throw new Error("Unexpected fetch "+input);
  });
  const req=new Request("https://torontohousemarket.com/api/address-suggestions",{
    method:"POST",
    headers:{"Content-Type":"application/json","Origin":"https://torontohousemarket.com"},
    body:JSON.stringify({q:"38 oak",sessionToken:"abcdefghijklmnop"})
  });
  const res=await worker.fetch(req,{GOOGLE_PLACES_API_KEY:"fixture"},{});
  const data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.available,true);
  assert.equal(data.suggestions.length,1);
  assert.equal(data.suggestions[0].label,"38 Oak Street, Toronto, ON, Canada");
});
