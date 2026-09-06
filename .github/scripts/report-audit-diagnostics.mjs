const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query`;
for (const needle of ["report-job-194", "prototype-1-torontohousemarket"]) {
 const response = await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({queryId:"ten-property-audit",timeframe:{from:Date.parse("2026-09-06T05:10:00Z"),to:Date.now()},view:"events",limit:100,parameters:{needle:{value:needle}}})});
 const result=await response.json();
 console.log(JSON.stringify({query:needle,status:response.status,success:result.success,errors:result.errors,resultKeys:Object.keys(result.result||{})}));
 if(!response.ok) continue;
 const data=result.result||{};
 const events=Array.isArray(data.events)?data.events:data.events?.events||[];
 for(const e of events){
  const raw=typeof e.source==="string"?e.source:JSON.stringify(e.source||{});
  const w=e.$workers||{};
  let s={};try{s=typeof e.source==="string"?JSON.parse(e.source):e.source||{}}catch{}
  const selected={};for(const k of ["event","request_id","report_generation_status","job_id","error_category","error","message","provider","provider_latency_ms","schema_validation_result","subject_listing_key","candidate_counts","status"])if(s[k]!=null)selected[k]=s[k];
  console.log(JSON.stringify({timestamp:e.timestamp,requestId:e.$metadata?.requestId,type:e.$metadata?.type,outcome:w.outcome,wallTimeMs:w.wallTimeMs,cpuTimeMs:w.cpuTimeMs,sourceKeys:Object.keys(s),diagnostic:selected,exceptions:w.exceptions?.map(x=>({name:x.name,message:x.message}))}));
 }
}