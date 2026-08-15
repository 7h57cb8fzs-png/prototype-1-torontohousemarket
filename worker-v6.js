import app from "./worker-v5.js";

const AMPRE = "https://query.ampre.ca/odata";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/debug-address" && request.method === "GET") {
      return debugAddress(env);
    }
    return app.fetch(request, env, ctx);
  },
};

async function debugAddress(env) {
  if (!env.AMPRE_TOKEN) return j({ ok:false, error:"missing token" }, 503);
  const cases = [
    ["key-control", "ListingKey eq 'W13676100'"],
    ["street-number", "StreetNumber eq '24'"],
    ["street-name", "StreetName eq 'Whitburn'"],
    ["street-both", "StreetNumber eq '24' and StreetName eq 'Whitburn'"],
    ["unparsed-contains", "contains(UnparsedAddress,'Whitburn')"],
    ["unparsed-prefix", "startswith(UnparsedAddress,'24 Whitburn Crescent')"],
  ];
  const results = [];
  for (const [name, filter] of cases) {
    const p = new URLSearchParams();
    p.set("$top", "5");
    p.set("$filter", filter);
    p.set("$select", "ListingKey,StreetNumber,StreetName,StreetSuffix,UnparsedAddress,StandardStatus,MlsStatus,ContractStatus,TransactionType");
    const target = `${AMPRE}/Property?${p.toString()}`;
    try {
      const r = await fetch(target, { headers:{ Authorization:`Bearer ${env.AMPRE_TOKEN}`, Accept:"application/json" }});
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      results.push({
        name,
        filter,
        status:r.status,
        ok:r.ok,
        count:Array.isArray(body?.value) ? body.value.length : null,
        rows:Array.isArray(body?.value) ? body.value : null,
        error: r.ok ? null : (body || text.slice(0,500)),
      });
    } catch (e) {
      results.push({name,filter,status:null,ok:false,error:String(e)});
    }
  }
  return j({ok:true,results});
}

function j(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
