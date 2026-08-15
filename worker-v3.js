import baseWorker from "./worker.js";

const AMPRE = "https://query.ampre.ca/odata";

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/api/property" && request.method === "GET") return property(request, env, ctx);
    if (u.pathname === "/api/media" && request.method === "GET") return mediaProxy(request, env);
    return baseWorker.fetch(request, env, ctx);
  },
};

async function property(request, env, ctx) {
  if (!env.AMPRE_TOKEN) return json({ok:false,error:"IDX connection is not configured."},503);
  const u = new URL(request.url);
  let key = str(u.searchParams.get("listingKey"),50).toUpperCase();
  let q = str(u.searchParams.get("q"),1000);
  let validation = null;

  if (!key && q && /^https?:\/\//i.test(q)) {
    const link = parseLink(q);
    if (!link.ok) return json({ok:false,error:link.error},422);
    key = link.key || "";
    q = link.address || "";
    validation = {type:"listing_link",status:"recognized",label:"Listing link recognized"};
  }

  if (!key && q) {
    const match = await findByAddress(q, env);
    if (match?.ListingKey) {
      key = String(match.ListingKey).toUpperCase();
      validation = {type:"address",status:"validated",label:`Address matched to MLS ${key}`};
    }
  }

  const forward = new URL(u.origin + "/api/property");
  if (key) forward.searchParams.set("listingKey", key);
  else if (q) forward.searchParams.set("q", q);
  else return json({ok:false,error:"Enter an MLS number, street address, or listing URL."},400);

  const base = await baseWorker.fetch(new Request(forward.toString(),{headers:request.headers}), env, ctx);
  let body;
  try { body = await base.clone().json(); } catch { return base; }
  if (!base.ok || !body?.ok || !body?.property) return json(body || {ok:false,error:"Unable to load property."},base.status);

  const p = body.property;
  if (validation) p.inputValidation = validation;

  if (p.listingKey) {
    const [bundle, media] = await Promise.all([
      bundleByKey(p.listingKey, env),
      p.forSale ? mediaByKey(p.listingKey, env) : Promise.resolve([]),
    ]);
    if (bundle) p.details = {...(p.details||{}), ...details(bundle)};
    if (p.details) delete p.details.listingOffice;
    const photos = p.forSale ? mergePhotos(bundle?.Media || [], media, p.photos || []) : [];
    p.photos = photos;
    p.photoCount = photos.length;
  }

  p.fastShowing = p.forSale ? {
    available:true,targetWindow:"1–24 hours",headline:"Fastest available showing",
    note:"Your request is assigned immediately. Actual appointment time depends on listing and seller availability."
  } : {
    available:false,targetWindow:null,headline:"Not currently for sale",
    note:"No active for-sale listing was found. You can still request a deeper property or seller report."
  };

  return json({...body,property:p});
}

async function findByAddress(raw, env) {
  const a = parseAddress(raw);
  if (!a.number || !a.name) return null;
  const n = esc(a.number), s = esc(a.name);
  const full = esc(norm(`${a.number} ${a.name}${a.suffix ? ` ${a.suffix}` : ""}`));
  const short = esc(norm(`${a.number} ${a.name}`));
  const filters = [
    `StreetNumber eq '${n}' and tolower(StreetName) eq '${s}'`,
    `StreetNumber eq '${n}' and contains(tolower(StreetName),'${s}')`,
    `contains(tolower(UnparsedAddress),'${full}')`,
    `contains(tolower(UnparsedAddress),'${short}')`,
  ];
  for (const filter of filters) {
    const rows = await query(filter, env);
    const ranked = rows.map(r=>({r,score:scoreAddress(a,r)})).filter(x=>x.score>=65)
      .sort((x,y)=>(active(y.r)-active(x.r)) || y.score-x.score || stamp(y.r)-stamp(x.r));
    if (ranked.length) return ranked[0].r;
  }
  return null;
}

function parseAddress(raw) {
  const first = String(raw||"").replace(/\s+/g," ").trim().split(",")[0].trim();
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return {};
  const aliases = {street:"street",st:"street",road:"road",rd:"road",avenue:"avenue",ave:"avenue",drive:"drive",dr:"drive",crescent:"crescent",cres:"crescent",court:"court",ct:"court",boulevard:"boulevard",blvd:"boulevard",lane:"lane",ln:"lane",way:"way",trail:"trail",tr:"trail",place:"place",pl:"place",terrace:"terrace",terr:"terrace",circle:"circle",cir:"circle",gardens:"gardens",gdns:"gardens",gate:"gate",grove:"grove",heights:"heights",hts:"heights"};
  const t = m[2].trim().split(/\s+/), last = (t[t.length-1]||"").replace(/\./g,"").toLowerCase();
  const suffix = aliases[last] || null;
  if (suffix) t.pop();
  return {number:m[1].toLowerCase(),name:norm(t.join(" ")),suffix};
}

function scoreAddress(a,r) {
  let s=0; const n=norm(r?.StreetNumber), name=norm(r?.StreetName), suffix=norm(r?.StreetSuffix), full=norm(r?.UnparsedAddress);
  if (n===norm(a.number)) s+=45;
  if (name===a.name) s+=40; else if (name.includes(a.name)||a.name.includes(name)) s+=28;
  if (a.suffix && suffix===a.suffix) s+=7;
  if (full.startsWith(`${norm(a.number)} ${a.name}`)) s+=8;
  if (active(r)) s+=8;
  return Math.min(100,s);
}

async function query(filter, env) {
  const p = new URLSearchParams({"$top":"100","$filter":filter});
  try { const r=await api(`${AMPRE}/Property?${p}`,env); if(!r.ok)return[]; const b=await r.json(); return Array.isArray(b.value)?b.value:[]; } catch{return[];}
}

async function bundleByKey(key, env) {
  const p = new URLSearchParams();
  p.set("$expand","Media($select=MediaKey,MediaURL,MediaType,MediaModificationTimestamp,ShortDescription,LongDescription)");
  try {
    let r=await api(`${AMPRE}/Property('${encodeURIComponent(key)}')?${p}`,env);
    if(!r.ok) r=await api(`${AMPRE}/Property('${encodeURIComponent(key)}')`,env);
    return r.ok ? await r.json() : null;
  } catch{return null;}
}

async function mediaByKey(key, env) {
  const filters=[
    `ResourceRecordKey eq '${esc(key)}' and ResourceName eq 'Property' and ImageSizeDescription eq 'Large'`,
    `ResourceRecordKey eq '${esc(key)}' and ResourceName eq 'Property'`,
    `ResourceRecordKey eq '${esc(key)}'`
  ];
  for(const filter of filters){
    const p=new URLSearchParams({"$top":"100","$filter":filter});
    try{const r=await api(`${AMPRE}/Media?${p}`,env);if(!r.ok)continue;const b=await r.json();if(Array.isArray(b.value)&&b.value.length)return b.value;}catch{}
  }
  return [];
}

function mergePhotos(expanded, independent, existing) {
  const out=[], seen=new Set();
  const raw=m=>{
    const key=m?.MediaKey?String(m.MediaKey):null, direct=m?.MediaURL?String(m.MediaURL):null, type=String(m?.MediaType||"").toLowerCase();
    if(!key&&!direct)return; if(!(type.startsWith("image/")||/\.(jpe?g|png|webp)(\?|$)/i.test(direct||"")))return;
    const d=key||direct;if(seen.has(d))return;seen.add(d);
    out.push({key,url:key?`/api/media?key=${encodeURIComponent(key)}`:direct,directUrl:direct,description:m?.ShortDescription||m?.LongDescription||null});
  };
  expanded.forEach(raw); independent.forEach(raw);
  for(const p of existing||[]){if(!p?.url)continue;const d=p.key||p.url;if(seen.has(d))continue;seen.add(d);out.push(p);}
  return out.slice(0,60);
}

async function mediaProxy(request, env) {
  if(!env.AMPRE_TOKEN)return new Response("",{status:404});
  const key=str(new URL(request.url).searchParams.get("key"),200);
  if(!key||!/^[A-Za-z0-9._:-]{1,200}$/.test(key))return new Response("",{status:400});
  let rec; try{rec=await api(`${AMPRE}/Media('${encodeURIComponent(key)}')`,env);}catch{return new Response("",{status:404});}
  if(!rec.ok)return new Response("",{status:404}); const m=await rec.json().catch(()=>null); if(!m?.MediaURL)return new Response("",{status:404});
  let remote; try{remote=new URL(m.MediaURL);if(remote.protocol!=="https:")throw 0;}catch{return new Response("",{status:404});}
  let img; try{img=await fetch(remote,{headers:{Accept:"image/*"}});if(img.status===401||img.status===403)img=await fetch(remote,{headers:{Accept:"image/*",Authorization:`Bearer ${env.AMPRE_TOKEN}`}});}catch{return new Response("",{status:404});}
  if(!img.ok||!img.body)return new Response("",{status:404});
  return new Response(img.body,{headers:{"Content-Type":img.headers.get("Content-Type")||"image/jpeg","Cache-Control":"public,max-age=3600,s-maxage=86400","X-Content-Type-Options":"nosniff"}});
}

function parseLink(raw){
  let u;try{u=new URL(raw);}catch{return{ok:false,error:"That does not look like a valid listing link."};}
  const m=raw.toUpperCase().match(/\b[A-Z]\d{7,9}\b/);if(m)return{ok:true,key:m[0]};
  const address=addressFromText(decodeURIComponent(u.pathname).replace(/[-_+\/]+/g," "));
  return address?{ok:true,address}:{ok:false,error:"We could not identify the property from that link. Paste the MLS number or street address from the listing."};
}
function addressFromText(t){const s=String(t||"").replace(/\s+/g," ");const x="Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Crescent|Cres|Court|Ct|Boulevard|Blvd|Lane|Ln|Way|Trail|Tr|Place|Pl|Terrace|Terr|Circle|Cir|Gardens|Gdns|Gate|Grove|Heights|Hts";const m=s.match(new RegExp(`\\b\\d+[A-Za-z]?\\s+[A-Za-z0-9.'’ -]{2,60}\\b(?:${x})\\b`,"i"));return m?m[0].trim():null;}
function details(p){return{architecturalStyle:arr(p.ArchitecturalStyle),construction:arr(p.ConstructionMaterials),interior:arr(p.InteriorFeatures),exterior:arr(p.ExteriorFeatures),cooling:arr(p.Cooling),heating:arr(Array.isArray(p.HeatTypeMulti)&&p.HeatTypeMulti.length?p.HeatTypeMulti:(p.HeatType||p.HeatSource)),direction:p.DirectionFaces||null,parking:arr(p.ParkingFeatures),pool:arr(p.PoolFeatures),possession:p.PossessionDetails||p.PossessionType||null,annualTax:num(p.TaxAnnualAmount),taxYear:num(p.TaxYear),cityRegion:p.CityRegion||null,crossStreet:p.CrossStreet||null,listedAt:p.OriginalEntryTimestamp||null};}
function active(p){const s=`${p?.StandardStatus||""} ${p?.MlsStatus||""} ${p?.ContractStatus||""}`.toLowerCase(),t=String(p?.TransactionType||"").toLowerCase();return (t.includes("for sale")||(!t&&p?.BoardPropertyType!=="Com"))&&/active|available|new/.test(s)&&!/closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/.test(s);}
function arr(v){return Array.isArray(v)?v.filter(Boolean):v==null||v===""?[]:[String(v)];}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function norm(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function esc(v){return String(v||"").replace(/'/g,"''");}
function stamp(r){const d=new Date(r?.ModificationTimestamp||r?.OriginalEntryTimestamp||0);return Number.isNaN(d.getTime())?0:d.getTime();}
function str(v,n){return typeof v==="string"?v.trim().slice(0,n):"";}
function api(url,env){return fetch(url,{headers:{Authorization:`Bearer ${env.AMPRE_TOKEN}`,Accept:"application/json"}});}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
