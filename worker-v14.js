import app from "./worker-v13.js";

const VERSION = "version-7-openai-expert-v122-20260916";
const AMPRE = "https://query.ampre.ca/odata";
const OPENAI = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.6-terra";
const CASES = new Map([
  ["davos", "331 Davos Road, Vaughan, ON L4H 0M8"],
  ["donnacona", "61 Donnacona Drive, Vaughan, ON L4H 0Y6"],
  ["lindbergh", "119 Lindbergh Drive, Vaughan, ON"],
  ["bloomgate", "59 Bloomgate Crescent, Richmond Hill, ON"],
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json({ok:true,version:VERSION,base:"phase-6-20260915",buyer:"strict engine first; OpenAI Expert Comp recovery",seller:"0-100 renovation context + seller strategy",regression:"preview-only four prior insufficient-comparable cases"});
    if (url.pathname === "/api/internal/v7-failed-comp-regression" && request.method === "GET") {
      const preview = url.hostname.endsWith(".workers.dev") && !url.hostname.startsWith("prototype-1-torontohousemarket.");
      if (!preview) return json({ok:false,error:"Not found."},404);
      const id = String(url.searchParams.get("case") || "").toLowerCase();
      const address = CASES.get(id);
      if (!address) return json({ok:false,error:"Unknown regression case."},400);
      return regressionCase(env, id, address);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) { return app.scheduled(controller, env, ctx); },
};

async function regressionCase(env, id, address) {
  if (!env.AMPRE_VOW_TOKEN || !env.OPENAI_API_KEY) return json({ok:false,case:id,configured:false,error:"Required V7 bindings are unavailable."},503);
  const subject = await resolveSubject(address, env.AMPRE_VOW_TOKEN);
  if (!subject) return json({ok:false,case:id,address,subjectResolved:false,error:"Subject could not be resolved in protected MLS data."},422);
  const candidates = await broadPool(subject, env.AMPRE_VOW_TOKEN);
  const expert = candidates.length ? await expertSelect(env, subject, candidates) : {comparables:[],confidence:"Limited",market_read:"No internal sold candidates recovered."};
  const selected = (expert.comparables || []).filter(c => candidates.some(x => x.id === c.id));
  return json({
    ok:true,
    case:id,
    address,
    subjectResolved:true,
    subjectType:subject.PropertySubType || subject.PropertyType || null,
    subjectCommunity:subject.CityRegion || null,
    subjectSize:subject.LivingAreaRange || subject.BuildingAreaTotal || null,
    candidateCount:candidates.length,
    expertUsed:true,
    selectedCount:selected.length,
    valuationRecoverable:selected.length>=2,
    confidence:expert.confidence || "Limited",
    externalSearchWouldRun:selected.length<3,
    selectedSummary:selected.map(c=>({id:c.id,recordedSold:true,adjustmentBasis:c.adjustment_basis,reason:String(c.selection_reason||"").slice(0,180)})),
    note:"Aggregate regression output only. Protected sold prices and addresses are intentionally omitted."
  });
}

async function resolveSubject(address, token) {
  const parsed = parse(address);
  if (!parsed.number || !parsed.street) return null;
  const filter = `contains(StreetName,'${odata(parsed.street.split(/\s+/).sort((a,b)=>b.length-a.length)[0])}')`;
  const rows = await tail(filter, token, 500);
  const matches = rows.filter(r => normalize(r.StreetNumber) === normalize(parsed.number) && normalize(r.StreetName) === normalize(parsed.street));
  const row = matches.sort((a,b)=>Date.parse(b.ModificationTimestamp||0)-Date.parse(a.ModificationTimestamp||0))[0];
  if (!row?.ListingKey) return null;
  const response = await fetch(`${AMPRE}/Property('${encodeURIComponent(row.ListingKey)}')`,{headers:auth(token),signal:AbortSignal.timeout(10000)});
  return response.ok ? response.json() : row;
}

async function broadPool(subject, token) {
  const searches=[];
  const community=clean(subject.CityRegion), postal=String(subject.PostalCode||"").replace(/\s/g,"").slice(0,3).toUpperCase(), city=clean(subject.City)?.replace(/^Toronto\s+[CEW]\d{2}$/i,"Toronto");
  if (community && !/^(toronto )?[cew]\d{2}$/i.test(community)) searches.push(`contains(CityRegion,'${odata(community)}')`);
  if (/^[A-Z]\d[A-Z]$/.test(postal)) searches.push(`startswith(PostalCode,'${postal}')`);
  if (city) searches.push(`contains(UnparsedAddress,'${odata(city)}')`);
  const rows=[];
  for (const filter of [...new Set(searches)]) {
    rows.push(...await tail(filter,token,700));
    if (soldRows(subject,rows).length>=35) break;
  }
  return soldRows(subject,rows).slice(0,60);
}

async function tail(filter,token,limit) {
  let count=null;
  const countUrl=new URL(`${AMPRE}/Property`);countUrl.search=new URLSearchParams({"$filter":filter,"$count":"true","$top":"1"});
  try {const r=await fetch(countUrl,{headers:auth(token),signal:AbortSignal.timeout(9000)});if(r.ok)count=Number((await r.json())?.["@odata.count"]);} catch {}
  let skip=Number.isSafeInteger(count)&&count>limit?count-limit:0;
  const rows=[];
  while(rows.length<limit){
    const u=new URL(`${AMPRE}/Property`);u.search=new URLSearchParams({"$filter":filter,"$top":"100",...(skip?{"$skip":String(skip)}:{})});
    const r=await fetch(u,{headers:auth(token),signal:AbortSignal.timeout(10000)});if(!r.ok)break;
    const body=await r.json().catch(()=>null),page=Array.isArray(body?.value)?body.value:[];rows.push(...page);if(page.length<100)break;skip+=100;
  }
  return rows;
}

function soldRows(subject,rows){
  const seen=new Set(),subjectAddr=normalize(subject.UnparsedAddress),subjectCondo=/condo|condominium/i.test(`${subject.PropertyType||""} ${subject.PropertySubType||""}`);
  return rows.filter(r=>{
    const id=r?.ListingKey;if(!id||seen.has(id))return false;seen.add(id);
    const status=`${r.StandardStatus||""} ${r.MlsStatus||""} ${r.ContractStatus||""} ${r.TransactionType||""}`;
    const price=Number(r.ClosePrice||r.SoldPrice||r.SalePrice||r.FinalSalePrice),d=new Date(r.PurchaseContractDate||r.SoldDate||r.CloseDate||r.ModificationTimestamp||"");
    const condo=/condo|condominium/i.test(`${r.PropertyType||""} ${r.PropertySubType||""}`);
    return /sold|closed|deal firm/i.test(status)&&!/lease|rent/i.test(status)&&price>50000&&Number.isFinite(d.getTime())&&(Date.now()-d.getTime())/864e5<=900&&normalize(r.UnparsedAddress)!==subjectAddr&&condo===subjectCondo;
  }).map(r=>({
    id:String(r.ListingKey),type:r.PropertySubType||r.PropertyType||null,community:r.CityRegion||null,city:r.City||null,postal:r.PostalCode||null,soldPrice:Number(r.ClosePrice||r.SoldPrice||r.SalePrice||r.FinalSalePrice),soldDate:new Date(r.PurchaseContractDate||r.SoldDate||r.CloseDate||r.ModificationTimestamp).toISOString().slice(0,10),beds:num(r.BedroomsTotal),aboveBeds:num(r.BedroomsAboveGrade),baths:num(r.BathroomsTotalInteger),size:r.LivingAreaRange||null,area:num(r.BuildingAreaTotal),lotWidth:num(r.LotWidth),lotDepth:num(r.LotDepth),parking:num(r.ParkingTotal),basement:Array.isArray(r.Basement)?r.Basement.join(" · "):r.Basement||null,remarks:String(r.PublicRemarks||"").slice(0,700)
  })).sort((a,b)=>Date.parse(b.soldDate)-Date.parse(a.soldDate));
}

async function expertSelect(env,subject,candidates){
  const schema={type:"object",additionalProperties:false,properties:{confidence:{type:"string",enum:["Moderate","Low","Limited"]},market_read:{type:"string"},comparables:{type:"array",minItems:1,maxItems:6,items:{type:"object",additionalProperties:false,properties:{id:{type:"string"},weight:{type:"number",minimum:.1,maximum:1},adjusted_indication:{type:"number"},selection_reason:{type:"string"},adjustment_reason:{type:"string"},adjustment_basis:{type:"string",enum:["evidence_supported","professional_judgment","none"]}},required:["id","weight","adjusted_indication","selection_reason","adjustment_reason","adjustment_basis"]}}},required:["confidence","market_read","comparables"]};
  const subjectData={address:subject.UnparsedAddress,type:subject.PropertySubType||subject.PropertyType,community:subject.CityRegion,city:subject.City,postal:subject.PostalCode,beds:num(subject.BedroomsTotal),aboveBeds:num(subject.BedroomsAboveGrade),baths:num(subject.BathroomsTotalInteger),size:subject.LivingAreaRange,area:num(subject.BuildingAreaTotal),lotWidth:num(subject.LotWidth),lotDepth:num(subject.LotDepth),parking:num(subject.ParkingTotal),basement:subject.Basement,remarks:String(subject.PublicRemarks||"").slice(0,900)};
  const response=await fetch(OPENAI,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(22000),body:JSON.stringify({model:String(env.OPENAI_MODEL||MODEL),reasoning:{effort:"medium"},input:[{role:"system",content:"Act as an experienced GTA residential Realtor reviewing comparables after a strict algorithm found too little evidence. Select the economically most relevant REAL sold properties from the supplied candidates. Do not mechanically prioritize bedrooms, lot frontage/depth, age, size or any single field; decide what actually drives value for this home and micro-market. A different bedroom count or somewhat different lot can be acceptable when the overall economic utility is closer. You may reconcile imperfect comps with appraiser-style judgment adjustments, but never alter the recorded sold price or invent a sale. Return JSON only."},{role:"user",content:JSON.stringify({subject:subjectData,candidates})}],text:{format:{type:"json_schema",name:"v7_failed_comp_test",strict:true,schema}}})});
  const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(`OpenAI ${response.status}`);
  const text=typeof data?.output_text==="string"?data.output_text:(data?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text||"").join("");
  return JSON.parse(text);
}

function parse(address){const m=String(address).match(/^\s*(\d+[A-Za-z]?)\s+([^,]+)/);if(!m)return{};let street=m[2].trim().replace(/\b(?:road|rd|drive|dr|crescent|cres|street|st|avenue|ave|court|ct|boulevard|blvd|lane|ln|trail|tr|place|pl)\b.*$/i,"").trim();return{number:m[1],street};}
function auth(token){return{Authorization:`Bearer ${token}`,Accept:"application/json"};}
function odata(v){return String(v||"").replace(/'/g,"''");}
function normalize(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function clean(v){return typeof v==="string"?v.trim()||null:null;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION}});}
