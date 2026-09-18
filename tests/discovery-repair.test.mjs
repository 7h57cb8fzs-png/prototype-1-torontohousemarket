import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker-v11.js";

const home = id => ({
  ListingKey:id, City:"Toronto", UnparsedAddress:`${id} Test Street, Toronto`,
  StandardStatus:"Active", TransactionType:"For Sale", PropertySubType:"Detached",
  ListPrice:999000, OriginalEntryTimestamp:new Date().toISOString(),
  BedroomsTotal:3, BathroomsTotalInteger:2
});

test("discovery uses city count-tail retrieval without unsupported sorting", async t => {
  const calls=[];
  t.mock.method(globalThis,"fetch", async (input, init={}) => {
    const url=new URL(input); calls.push(url);
    assert.equal(init.headers.Authorization,"Bearer idx-fixture");
    if(url.searchParams.has("$count")) {
      assert.match(url.searchParams.get("$filter")||"", /contains\(City,'Toronto'\)/);
      assert.equal(url.searchParams.has("$orderby"),false);
      return Response.json({"@odata.count":650,value:[]});
    }
    assert.equal(url.searchParams.get("$skip"),"150");
    assert.equal(url.searchParams.has("$orderby"),false);
    return Response.json({value:[home("C1000001")]});
  });
  const response=await worker.fetch(
    new Request("https://example.com/api/discovery?city=Toronto&mode=budget&maxPrice=1200000"),
    {PUBLIC_DISCOVERY_ENABLED:"true",AMPRE_TOKEN:"idx-fixture"},{}
  );
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.listings.length,1);
  assert.equal(calls.length,2);
});

test("mobile snapshot thumbnail is wired only from verified listing photos", async () => {
  const html=await import("node:fs").then(fs=>fs.readFileSync("index.html","utf8"));
  const app=await import("node:fs").then(fs=>fs.readFileSync("app.js","utf8"));
  const css=await import("node:fs").then(fs=>fs.readFileSync("styles.css","utf8"));
  assert.match(html,/id="snapshotThumb"/);
  assert.match(app,/snapshotThumbImg\.src = photos\[0\]\.url/);
  assert.match(app,/snapshotThumb\.classList\.add\("hidden"\)/);
  assert.match(css,/\.snapshot-thumb/);
  assert.match(css,/@media\(max-width:720px\)/);
});
