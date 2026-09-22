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
    assert.ok([150,250,350,450,550].includes(Number(url.searchParams.get("$skip"))));
    assert.equal(url.searchParams.has("$orderby"),false);
    return Response.json({value:[home(`C1000${url.searchParams.get("$skip")}`)]});
  });
  const response=await worker.fetch(
    new Request("https://example.com/api/discovery?city=Toronto&mode=budget&maxPrice=1200000"),
    {PUBLIC_DISCOVERY_ENABLED:"true",AMPRE_TOKEN:"idx-fixture"},{}
  );
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.listings.length,5);
  assert.equal(calls.length,6);
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

test("discovery thumbnail uses first MLS sequence despite blank Order and later preferred image", async t => {
  const media = (key, sequence, preferred=false) => ({MediaKey:key,MediaURL:`https://photos.example/${key}.jpg`,MediaType:'image/jpeg',Order:null,MediaOrder:sequence,PreferredPhotoYN:preferred,ImageSizeDescription:'Large'});
  const rows=[media('later-photo',8,true),media('first-photo',1),media('middle-photo',3)];
  let selected;
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);
    if(url.pathname.includes('/Property('))return Response.json({...home('C13718090'),Media:rows});
    if(url.pathname.includes('/Media(')){selected=decodeURIComponent(url.pathname).match(/Media\('([^']+)'\)/)[1];return Response.json(rows.find(x=>x.MediaKey===selected));}
    return new Response('photo',{headers:{'Content-Type':'image/jpeg'}});
  });
  const r=await worker.fetch(new Request('https://example.com/api/discovery-photo?listingKey=C13718090'),{PUBLIC_DISCOVERY_ENABLED:'true',AMPRE_TOKEN:'idx-fixture'},{});
  assert.equal(r.status,200);assert.equal(selected,'first-photo');
});
