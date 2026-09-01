import app from "./worker-v10.js";

const VERSION = "phase2-complete-ai-reports-v15-20260826";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json({ok:true,version:VERSION,comparables:"recent-sold-only",reports:"workers-ai-with-deterministic-fallback",operations:"admin-and-job-queue"});
    if (url.pathname === "/api/lead" && request.method === "POST") {
      const response=await app.fetch(request,env,ctx);
      if(response.ok)ctx.waitUntil(processAutomationJobs(env));
      return response;
    }
    if (url.pathname === "/api/admin/leads" && request.method === "GET") return adminLeads(request,env);
    if (url.pathname.startsWith("/api/admin/leads/") && request.method === "PATCH") return updateLead(request,env,url.pathname.split("/").pop(),ctx);
    if (url.pathname === "/api/admin/agents" && request.method === "GET") return adminAgents(request,env);
    if (url.pathname === "/api/admin/agents" && request.method === "POST") return createAgent(request,env);
    if (url.pathname.startsWith("/api/admin/agents/") && request.method === "PATCH") return updateAgent(request,env,url.pathname.split("/").pop());
    if (url.pathname === "/api/admin/settings" && request.method === "GET") return adminSettings(request,env);
    if (url.pathname === "/api/admin/settings" && request.method === "PATCH") return updateSettings(request,env);
    if (url.pathname === "/api/admin/automation/run" && request.method === "POST") return runAutomation(request,env);
    return app.fetch(request,env,ctx);
  },
  async scheduled(_controller,env,ctx){
    ctx.waitUntil(runScheduledNotifications(env));
  }
};

function authorized(request,env) {
  const expected = String(env.ADMIN_API_KEY || "");
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i,"");
  return expected.length >= 24 && supplied.length === expected.length && timingSafeEqual(supplied,expected);
}

async function adminLeads(request,env) {
  if (!authorized(request,env)) return json({ok:false,error:"Unauthorized"},401);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ok:false,error:"Admin database connection is not configured."},503);
  const select = "id,name,mobile,email,lead_mode,status,stage,next_action,next_action_at,first_response_due_at,resolved_address,showing_timing,created_at,updated_at,metadata,agents(id,code,display_name,email,mobile),property_reports(id,status,report_payload,generated_at,updated_at),automation_jobs(id,job_type,status,recipient,attempts,available_at,completed_at,last_error)";
  const response = await supabase(env,`/rest/v1/leads?select=${encodeURIComponent(select)}&order=created_at.desc&limit=100`);
  const data = await response.json().catch(()=>null);
  return response.ok ? json({ok:true,leads:data}) : json({ok:false,error:"Unable to load leads."},502);
}

async function updateLead(request,env,id,ctx) {
  if (!authorized(request,env)) return json({ok:false,error:"Unauthorized"},401);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ok:false,error:"Invalid lead."},400);
  const input = await request.json().catch(()=>({}));
  if ("owner_agent_id" in input) {
    if (!/^[0-9a-f-]{36}$/i.test(String(input.owner_agent_id||""))) return json({ok:false,error:"Choose a valid agent."},400);
    const assigned=await supabase(env,"/rest/v1/rpc/assign_lead_to_agent",{method:"POST",body:JSON.stringify({p_lead_id:id,p_agent_id:input.owner_agent_id})});
    const result=await assigned.json().catch(()=>null);
    if(!assigned.ok)return json({ok:false,error:databaseMessage(result,"Unable to assign this lead.")},409);
  }
  const allowedStatus = ["new","contacted","appointment_pending","appointment_confirmed","closed","lost"];
  const body = {updated_at:new Date().toISOString()};
  if (allowedStatus.includes(input.status)) body.status=input.status;
  if (typeof input.stage === "string" && input.stage.length<=80) body.stage=input.stage;
  if (typeof input.next_action === "string" && input.next_action.length<=120) body.next_action=input.next_action;
  const response = await supabase(env,`/rest/v1/leads?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(body)});
  const data = await response.json().catch(()=>null);
  if(response.ok)ctx.waitUntil(processAutomationJobs(env));
  return response.ok ? json({ok:true,lead:Array.isArray(data)?data[0]:data}) : json({ok:false,error:"Unable to update lead."},502);
}

async function runAutomation(request,env){
  if(!authorized(request,env))return json({ok:false,error:"Unauthorized"},401);
  if(!env.RESEND_API_KEY)return json({ok:false,error:"Resend is not configured."},503);
  const result=await runScheduledNotifications(env);
  return json({ok:true,...result});
}

async function adminSettings(request,env){
  if(!authorized(request,env))return json({ok:false,error:"Unauthorized"},401);
  const response=await supabase(env,"/rest/v1/app_settings?select=key,value&key=in.(owner_notification_email,assignment_method,first_response_sla_minutes,service_hours)"),rows=await response.json().catch(()=>null);
  if(!response.ok)return json({ok:false,error:"Unable to load settings."},502);
  return json({ok:true,settings:Object.fromEntries((rows||[]).map(x=>[x.key,x.value]))});
}

async function updateSettings(request,env){
  if(!authorized(request,env))return json({ok:false,error:"Unauthorized"},401);
  const input=await request.json().catch(()=>({})),email=clean(input.owner_notification_email,254).toLowerCase();
  if(!email||!validEmail(email))return json({ok:false,error:"Enter a valid notification email."},400);
  const response=await supabase(env,"/rest/v1/app_settings?key=eq.owner_notification_email",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({value:email,updated_at:new Date().toISOString()})}),data=await response.json().catch(()=>null);
  return response.ok?json({ok:true,setting:Array.isArray(data)?data[0]:data}):json({ok:false,error:"Unable to save notification email."},502);
}

async function adminAgents(request,env) {
  if (!authorized(request,env)) return json({ok:false,error:"Unauthorized"},401);
  const response=await supabase(env,"/rest/v1/agents?select=id,code,display_name,email,mobile,active,assignment_order,created_at,updated_at&order=assignment_order.asc");
  const data=await response.json().catch(()=>null);
  return response.ok?json({ok:true,agents:data}):json({ok:false,error:"Unable to load agents."},502);
}

async function createAgent(request,env) {
  if (!authorized(request,env)) return json({ok:false,error:"Unauthorized"},401);
  const input=await request.json().catch(()=>({}));
  const displayName=clean(input.display_name,120),email=clean(input.email,254).toLowerCase()||null,mobile=clean(input.mobile,50)||null;
  if(displayName.length<2)return json({ok:false,error:"Agent name is required."},400);
  if(email&&!validEmail(email))return json({ok:false,error:"Enter a valid email."},400);
  const list=await supabase(env,"/rest/v1/agents?select=code,assignment_order&order=assignment_order.asc"),agents=await list.json().catch(()=>[]);
  if(!list.ok)return json({ok:false,error:"Unable to prepare the agent record."},502);
  const codes=new Set(agents.map(a=>a.code));let base=slug(displayName)||"agent",code=base,n=2;while(codes.has(code))code=`${base}_${n++}`;
  const order=Math.max(0,...agents.map(a=>Number(a.assignment_order)||0))+1;
  const response=await supabase(env,"/rest/v1/agents",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({code,display_name:displayName,email,mobile,active:input.active!==false,assignment_order:order})});
  const data=await response.json().catch(()=>null);
  return response.ok?json({ok:true,agent:Array.isArray(data)?data[0]:data},201):json({ok:false,error:databaseMessage(data,"Unable to add agent.")},409);
}

async function updateAgent(request,env,id) {
  if(!authorized(request,env))return json({ok:false,error:"Unauthorized"},401);
  if(!/^[0-9a-f-]{36}$/i.test(id))return json({ok:false,error:"Invalid agent."},400);
  const input=await request.json().catch(()=>({})),body={updated_at:new Date().toISOString()};
  if("display_name" in input){const v=clean(input.display_name,120);if(v.length<2)return json({ok:false,error:"Agent name is required."},400);body.display_name=v;}
  if("email" in input){const v=clean(input.email,254).toLowerCase();if(v&&!validEmail(v))return json({ok:false,error:"Enter a valid email."},400);body.email=v||null;}
  if("mobile" in input)body.mobile=clean(input.mobile,50)||null;
  if(Number.isInteger(Number(input.assignment_order))&&Number(input.assignment_order)>0)body.assignment_order=Number(input.assignment_order);
  if(typeof input.active==="boolean"){
    if(!input.active){const ar=await supabase(env,"/rest/v1/agents?select=id&active=eq.true"),active=await ar.json().catch(()=>[]);if(active.length<=1&&active.some(a=>a.id===id))return json({ok:false,error:"At least one agent must remain active."},409);}
    body.active=input.active;
  }
  const response=await supabase(env,`/rest/v1/agents?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(body)}),data=await response.json().catch(()=>null);
  return response.ok?json({ok:true,agent:Array.isArray(data)?data[0]:data}):json({ok:false,error:databaseMessage(data,"Unable to update agent.")},409);
}

function supabase(env,path,init={}) {
  return fetch(`${env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co"}${path}`,{...init,headers:{"Content-Type":"application/json",apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,...(init.headers||{})}});
}

async function runScheduledNotifications(env){
  await rpc(env,"queue_overdue_sla_notifications",{}).catch(error=>console.error(JSON.stringify({event:"sla_queue_failed",error:String(error)})));
  return processAutomationJobs(env);
}

async function processAutomationJobs(env){
  const reports=await processReportJobs(env,3);
  const emails=await processEmailJobs(env,20);
  return {reports,emails};
}

async function processReportJobs(env,limit=3){
  const jobs=await rpc(env,"claim_report_jobs",{p_limit:limit});
  let completed=0,failed=0;
  for(const job of Array.isArray(jobs)?jobs:[]){
    try{
      const lead=await loadLeadForReport(env,job.lead_id);
      if(!lead)throw new Error("Lead data is unavailable.");
      const property=await loadPropertyForReport(env,lead,job);
      const report=await buildPropertyReport(env,lead,property);
      await rpc(env,"complete_report_job",{p_job_id:job.id,p_report_id:job.report_id,p_report_payload:report});
      completed++;
      console.log(JSON.stringify({event:"report_ready",job_id:job.id,lead_id:job.lead_id,report_id:job.report_id,confidence:report.valuation?.confidence||"Unavailable"}));
    }catch(error){
      failed++;const message=error instanceof Error?error.message:String(error);
      await rpc(env,"fail_report_job",{p_job_id:job.id,p_report_id:job.report_id,p_error:message}).catch(()=>{});
      console.error(JSON.stringify({event:"report_failed",job_id:job.id,lead_id:job.lead_id,error:message.slice(0,300)}));
    }
  }
  return {claimed:Array.isArray(jobs)?jobs.length:0,completed,failed};
}

async function loadLeadForReport(env,id){
  const select="id,name,email,lead_mode,resolved_address,showing_timing,property_snapshot,metadata,created_at";
  const response=await supabase(env,`/rest/v1/leads?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`),rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error("Unable to load report request.");
  return Array.isArray(rows)?rows[0]:null;
}

async function loadPropertyForReport(env,lead,job){
  const url=new URL("https://torontohousemarket.com/api/property");
  const queuedListingKey=clean(job?.payload?.listing_key,40).toUpperCase();
  const listingKey=/^[A-Z]\\d{7,9}$/.test(queuedListingKey)
    ? queuedListingKey
    : lead.property_snapshot?.listingKey||lead.metadata?.listing_key||lead.metadata?.listingKey||null;
  if(listingKey)url.searchParams.set("listingKey",listingKey);
  else url.searchParams.set("q",lead.resolved_address||lead.metadata?.property_input||"");
  const response=await app.fetch(new Request(url.toString(),{method:"GET"}),env,{waitUntil(){}});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body?.ok||!body.property)throw new Error(body?.error||"Property data could not be resolved.");
  return body.property;
}

async function buildPropertyReport(env,lead,property){
  const comp=property.comparableContext||{};
  const comparables=Array.isArray(comp.comparables)?comp.comparables.slice(0,5):[];
  const facts={
    address:property.address||lead.resolved_address||lead.property_input,
    status:property.marketStatus||property.status||"Unknown",
    list_price:property.listPrice||null,
    property_type:property.propertySubType||property.propertyType||null,
    beds:property.beds??null,baths:property.baths??null,
    living_area:property.livingAreaRange||property.buildingAreaTotal||null,
    lot:property.lotWidth&&property.lotDepth?`${property.lotWidth} × ${property.lotDepth} ft`:null,
    parking:property.parkingTotal??null,
    annual_tax:property.details?.annualTax||null,
    days_on_market:property.daysLive??null,
    offer_timing:property.offerTiming||null,
  };
  const valuation={
    available:!!comp.available,
    low:comp.rangeLow||null,midpoint:comp.midpoint||null,high:comp.rangeHigh||null,
    confidence:comp.confidence||"Unavailable",
    basis:comp.basis||"Not enough reliable recent sold matches were available to calculate a range.",
    methodology:"Recent sold AMPRE/PropTx MLS records are filtered for valid sold price/date, scored for property type, location, bedrooms, bathrooms, living area, lot, parking and recency, then outliers are removed and weighted quantiles form the range.",
  };
  const fallback=buildDeterministicNarrative(facts,valuation,comparables,property);
  const ai=await generateAiNarrative(env,facts,valuation,comparables,property).catch(error=>{
    console.warn(JSON.stringify({event:"report_ai_fallback",lead_id:lead.id,error:String(error).slice(0,240)}));
    return null;
  });
  return {
    schema_version:1,generated_at:new Date().toISOString(),report_type:"AI-assisted buyer property report",
    facts,valuation,comparables,narrative:ai||fallback,
    history:property.historySummary||null,
    showing_focus:property.showingFocus||null,
    sources:[
      {name:"AMPRE / PropTx MLS",role:"Authoritative listing facts, listing history and recent sold comparables",url:"https://www.ampre.ca/"},
      {name:"City of Toronto Open Data",role:"Municipal context and datasets; property-specific verification may be required",url:"https://open.toronto.ca/"},
      {name:"Statistics Canada",role:"Census and demographic context",url:"https://www.statcan.gc.ca/"},
      {name:"CMHC",role:"Broader housing-market and mortgage context",url:"https://www.cmhc-schl.gc.ca/"},
      {name:"Toronto District School Board",role:"Official school information and attendance-boundary verification",url:"https://www.tdsb.on.ca/"}
    ],
    limitations:[
      "This is an AI-assisted preliminary market analysis, not an appraisal or guarantee of market value.",
      "MLS facts and sold records should be verified by a registered real estate professional before relying on them.",
      "School boundaries, permits, zoning, taxes, environmental conditions and measurements require verification with the responsible authority.",
      "Realtor.ca, HouseSigma and other consumer portals are not scraped; they may be incorporated only through an authorized licensed feed."
    ]
  };
}

async function generateAiNarrative(env,facts,valuation,comparables,property){
  if(!env.AI)return null;
  const prompt=`You are a careful Toronto real-estate research analyst. Return ONLY valid JSON with string fields executive_summary, market_read, buyer_strategy and string arrays strengths, risks, inspection_priorities, questions_for_realtor. Never invent facts, schools, permits, distances or neighbourhood statistics. Explain uncertainty. Do not call this an appraisal. Use concise, warm Canadian English.\n\nStructured evidence:\n${JSON.stringify({facts,valuation,comparables,public_remarks:property.remarks,showing_focus:property.showingFocus,history:property.historySummary}).slice(0,12000)}`;
  const result=await env.AI.run("@cf/meta/llama-3.1-8b-instruct",{messages:[{role:"system",content:"Ground every statement in supplied evidence. Output JSON only."},{role:"user",content:prompt}],max_tokens:1400,temperature:0.2});
  const raw=typeof result?.response==="string"?result.response:typeof result==="string"?result:"";
  const parsed=parseJsonObject(raw);
  if(!parsed?.executive_summary)return null;
  return sanitizeNarrative(parsed);
}

function buildDeterministicNarrative(facts,valuation,comparables,property){
  const range=valuation.available?`${cad(valuation.low)}–${cad(valuation.high)} (${valuation.confidence.toLowerCase()} confidence)`:"not available from the current reliable match set";
  const strengths=[];if(facts.parking)strengths.push(`${facts.parking} parking space${facts.parking===1?"":"s"} reported`);if(facts.lot)strengths.push(`Reported lot of ${facts.lot}`);if(property.details?.cooling)strengths.push("Cooling information is present in the MLS record");
  return {
    executive_summary:`${facts.address} is reported as ${facts.status.toLowerCase()}. The evidence-based market range is ${range}. This preliminary read should be reviewed with a Realtor against condition, renovations and micro-location.`,
    market_read:valuation.available?`${comparables.length} recent sold MLS comparables support the range. The estimate emphasizes similarity and recency and reduces the effect of outliers.`:valuation.basis,
    buyer_strategy:facts.list_price&&valuation.available?`Compare the ${cad(facts.list_price)} asking price with the weighted midpoint of ${cad(valuation.midpoint)}, then adjust only after inspecting condition and confirming offer timing.`:"Inspect the property and verify material facts before deciding on price or conditions.",
    strengths:strengths.length?strengths:["MLS record and recent market evidence were reviewed"],
    risks:["Interior condition and renovation quality are not proven by MLS data","Measurements, taxes, permits and zoning require independent verification"],
    inspection_priorities:[property.showingFocus?.note||"Verify layout, condition, mechanical systems, water signs and exterior drainage.","Ask about age and service history of roof, HVAC, plumbing and electrical systems."],
    questions_for_realtor:["Which sold comparable is most similar after condition adjustments?","Are there registered offers or a scheduled offer presentation?","Which listing facts or improvements still require documentation?"]
  };
}

function parseJsonObject(value){try{const text=String(value||"").replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");const start=text.indexOf("{"),end=text.lastIndexOf("}");return start>=0&&end>start?JSON.parse(text.slice(start,end+1)):null;}catch{return null;}}
function sanitizeNarrative(v){const strings=k=>clean(v?.[k],2400),list=k=>Array.isArray(v?.[k])?v[k].map(x=>clean(String(x),500)).filter(Boolean).slice(0,6):[];return{executive_summary:strings("executive_summary"),market_read:strings("market_read"),buyer_strategy:strings("buyer_strategy"),strengths:list("strengths"),risks:list("risks"),inspection_priorities:list("inspection_priorities"),questions_for_realtor:list("questions_for_realtor")};}

async function processEmailJobs(env,limit=10){
  if(!env.RESEND_API_KEY)return {claimed:0,sent:0,failed:0,skipped:"missing_resend_key"};
  const jobs=await rpc(env,"claim_email_jobs",{p_limit:limit});
  let sent=0,failed=0;
  for(const job of Array.isArray(jobs)?jobs:[]){
    try{
      const lead=await loadLeadForEmail(env,job.lead_id);
      if(!lead)throw new Error("Lead data is unavailable.");
      const message=buildEmail(job,lead);
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`thm-job-${job.id}-v1`},body:JSON.stringify({from:env.RESEND_FROM_EMAIL||"Toronto House Market <notifications@updates.torontohousemarket.com>",to:[job.recipient],reply_to:"leads@torontohousemarket.com",subject:message.subject,html:message.html,text:message.text})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(`Resend ${response.status}: ${clean(result?.message||result?.name||"delivery rejected",300)}`);
      await rpc(env,"complete_email_job",{p_job_id:job.id,p_provider_id:String(result.id||"")});sent++;
      console.log(JSON.stringify({event:"email_sent",job_id:job.id,lead_id:job.lead_id,type:job.job_type,provider_id:result.id||null}));
    }catch(error){
      failed++;const message=error instanceof Error?error.message:String(error);
      await rpc(env,"fail_email_job",{p_job_id:job.id,p_error:message}).catch(()=>{});
      console.error(JSON.stringify({event:"email_failed",job_id:job.id,lead_id:job.lead_id,error:message.slice(0,300)}));
    }
  }
  return {claimed:Array.isArray(jobs)?jobs.length:0,sent,failed};
}

async function loadLeadForEmail(env,id){
  const select="id,name,mobile,email,status,stage,showing_timing,first_response_due_at,resolved_address,metadata,agents(id,display_name,email,mobile),property_reports(status,report_payload,generated_at)";
  const response=await supabase(env,`/rest/v1/leads?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`),rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error("Unable to load notification details.");
  return Array.isArray(rows)?rows[0]:null;
}

function buildEmail(job,lead){
  const reason=String(job.payload?.reason||job.job_type),address=lead.resolved_address||lead.metadata?.resolved_address||lead.metadata?.property_input||"Property request",agent=lead.agents?.display_name||"Unassigned",timing=timingLabel(lead.showing_timing),due=formatToronto(lead.first_response_due_at);
  let subject="Toronto House Market update",heading="Lead update",intro="There is an update on this property request.",rows=[];
  if(reason==="new_lead_admin_alert"){subject=`New lead: ${address}`;heading="New property lead";intro="A new request is waiting for administrator assignment.";rows=[["Buyer",lead.name],["Mobile",lead.mobile],["Email",lead.email],["Requested time",timing]];}
  else if(reason==="buyer_request_confirmation"){subject=`We received your request for ${address}`;heading="Your request is received";intro="Thank you. An administrator will assign the right Realtor, who will contact you to confirm the next step.";rows=[["Property",address],["Requested time",timing]];}
  else if(reason==="admin_assignment"||job.job_type==="notify_agent"&&reason!=="agent_sla_reminder"){subject=`New lead assigned: ${address}`;heading="A lead has been assigned to you";intro="Please contact the buyer and update the lead status in the administrator dashboard.";rows=[["Buyer",lead.name],["Mobile",lead.mobile],["Email",lead.email],["Requested time",timing],["Response due",due]];}
  else if(reason==="owner_assignment_confirmation"){subject=`Lead assigned to ${agent}: ${address}`;heading="Assignment confirmed";intro="The selected agent has been notified and the response timer has started.";rows=[["Agent",agent],["Buyer",lead.name],["Response due",due]];}
  else if(reason==="agent_reassignment_removed"){subject=`Lead reassigned: ${address}`;heading="This lead was reassigned";intro="You are no longer responsible for this property lead.";rows=[["Property",address],["Buyer",lead.name]];}
  else if(reason==="owner_sla_overdue"){subject=`OVERDUE lead response: ${address}`;heading="Five-minute response target missed";intro="This assigned lead still appears new and requires administrator attention.";rows=[["Agent",agent],["Buyer",lead.name],["Response was due",due]];}
  else if(reason==="agent_sla_reminder"){subject=`Action required: response overdue for ${address}`;heading="Lead response is overdue";intro="Please contact the buyer immediately and update the lead status.";rows=[["Buyer",lead.name],["Mobile",lead.mobile],["Email",lead.email]];}
  else if(reason==="buyer_appointment_confirmed"){subject=`Showing update for ${address}`;heading="Your appointment is confirmed";intro="Your Realtor has updated the showing request as confirmed. They will provide the final appointment details directly.";rows=[["Property",address],["Agent",agent]];}
  else if(reason==="owner_status_update"){subject=`Lead status: ${String(job.payload?.status||lead.status).replaceAll("_"," ")} — ${address}`;heading="Lead status updated";intro="An important lead milestone was recorded.";rows=[["Status",String(job.payload?.status||lead.status).replaceAll("_"," ")],["Agent",agent],["Buyer",lead.name]];}
  else if(job.job_type==="email_buyer")return propertyReportEmail(address,agent,firstRelation(lead.property_reports)?.report_payload||{});
  else{rows=[["Property",address],["Buyer",lead.name],["Status",lead.status]];}
  return emailDocument(subject,heading,intro,rows,reason.startsWith("buyer_")||job.job_type==="email_buyer"?null:"https://torontohousemarket.com/admin.html");
}

function propertyReportEmail(address,agent,report){
  const v=report.valuation||{},n=report.narrative||{},facts=report.facts||{},history=report.history||{},comps=Array.isArray(report.comparables)?report.comparables.slice(0,5):[],sources=Array.isArray(report.sources)?report.sources:[];
  const range=v.available?`${cad(v.low)} – ${cad(v.high)}`:"Range unavailable";
  const factRows=[["Status",facts.status],["Asking price",cad(facts.list_price)],["Property type",facts.property_type],["Beds / baths",[facts.beds,facts.baths].filter(x=>x!=null).join(" / ")],["Living area",facts.living_area],["Lot",facts.lot],["Parking",facts.parking],["Annual property tax",cad(facts.annual_tax)],["Days on market",facts.days_on_market],["Offer timing",facts.offer_timing?.label],["Estimated market range",range],["Weighted midpoint",cad(v.midpoint)],["Confidence",v.confidence]];
  const factsHtml=factRows.filter(([,x])=>x).map(([a,b])=>`<tr><td style="padding:8px 12px;color:#687286;font:600 12px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(a)}</td><td style="padding:8px 12px;color:#11182b;font:600 14px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(b)}</td></tr>`).join("");
  const compsHtml=comps.length?comps.map((c,i)=>`<tr><td style="padding:12px;color:#11182b;font:600 13px Arial,sans-serif;border-bottom:1px solid #edf0f5">${i+1}. ${html(c.address||"MLS comparable")}<br><span style="color:#7a8497;font:400 11px Arial,sans-serif">${html([c.soldDate,c.beds!=null?`${c.beds} bd`:null,c.baths!=null?`${c.baths} ba`:null,c.livingAreaRange,c.lotWidth&&c.lotDepth?`${c.lotWidth} × ${c.lotDepth} ft lot`:null].filter(Boolean).join(" · "))}</span></td><td align="right" style="padding:12px;color:#11182b;font:700 13px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(cad(c.soldPrice))}<br><span style="color:#3155f5;font:600 11px Arial,sans-serif">${html(Math.round(Number(c.similarity)||0))}% match</span></td></tr>`).join(""):`<tr><td style="padding:12px;color:#687286;font:400 13px Arial,sans-serif">No sufficiently reliable recent sold set was available. A Realtor must complete a manual comparable search before using a value conclusion.</td></tr>`;
  const bullets=(items)=>Array.isArray(items)&&items.length?`<ul style="margin:8px 0 0;padding-left:20px">${items.map(x=>`<li style="margin:0 0 7px;color:#566178;font:400 14px Arial,sans-serif;line-height:1.45">${html(x)}</li>`).join("")}</ul>`:"";
  const sourcesHtml=sources.length?`<ul style="margin:8px 0 0;padding-left:20px">${sources.map(s=>`<li style="margin:0 0 8px;color:#566178;font:400 13px Arial,sans-serif;line-height:1.45"><a href="${html(s.url||"#")}" style="color:#3155f5;text-decoration:none">${html(s.name)}</a> — ${html(s.role||"")}</li>`).join("")}</ul>`:"";
  const historyText=history.appearanceCount?`${history.appearanceCount} MLS appearance${history.appearanceCount===1?"":"s"} in the last ${history.years||10} years; latest recorded status ${history.lastStatus||"unknown"}${history.latestSold?`; last sold ${cad(history.latestSold.price)} on ${history.latestSold.date}`:""}.`:"No reliable subject-property sale history was returned in the current MLS record set.";
  const htmlBody=`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;background:#f1f4f9"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 10px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff"><tr><td bgcolor="#10182d" style="padding:28px;background-color:#10182d"><p style="margin:0 0 8px;color:#8ba2ff;font:700 12px Arial,sans-serif">TORONTO HOUSE MARKET · COMPLETE AI-ASSISTED BUYER REPORT</p><h1 style="margin:0;color:#ffffff;font:700 25px Arial,sans-serif;line-height:1.25">${html(address)}</h1><p style="margin:12px 0 0;color:#c9d1e3;font:400 14px Arial,sans-serif;line-height:1.5">A deeper buyer brief based on listing facts, recent sold MLS evidence and official verification sources.</p></td></tr><tr><td style="padding:26px"><h2 style="margin:0 0 8px;color:#11182b;font:700 19px Arial,sans-serif">Executive summary</h2><p style="margin:0 0 22px;color:#566178;font:400 14px Arial,sans-serif;line-height:1.6">${html(n.executive_summary||"A preliminary property analysis was completed; review the evidence and verification items below.")}</p><h2 style="margin:0 0 8px;color:#11182b;font:700 19px Arial,sans-serif">Property and valuation snapshot</h2><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">${factsHtml}</table><h2 style="margin:0 0 8px;color:#11182b;font:700 19px Arial,sans-serif">Recent sold comparables</h2><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px">${compsHtml}</table><p style="margin:0 0 22px;color:#7a8497;font:400 12px Arial,sans-serif;line-height:1.5">${html(v.methodology||"")}</p><h2 style="margin:0 0 8px;color:#11182b;font:700 19px Arial,sans-serif">Market read</h2><p style="margin:0 0 20px;color:#566178;font:400 14px Arial,sans-serif;line-height:1.6">${html(n.market_read||v.basis||"Further Realtor review is required.")}</p><h2 style="margin:0 0 8px;color:#11182b;font:700 19px Arial,sans-serif">Buyer strategy</h2><p style="margin:0 0 20px;color:#566178;font:400 14px Arial,sans-serif;line-height:1.6">${html(n.buyer_strategy||"Confirm condition and material facts before deciding on price or conditions.")}</p><h2 style="margin:0;color:#11182b;font:700 19px Arial,sans-serif">Potential strengths</h2>${bullets(n.strengths)}<h2 style="margin:20px 0 0;color:#11182b;font:700 19px Arial,sans-serif">Risks and unknowns</h2>${bullets(n.risks)}<h2 style="margin:20px 0 0;color:#11182b;font:700 19px Arial,sans-serif">What to verify at the showing</h2>${bullets(n.inspection_priorities)}<h2 style="margin:20px 0 0;color:#11182b;font:700 19px Arial,sans-serif">Questions for your Realtor</h2>${bullets(n.questions_for_realtor)}<h2 style="margin:20px 0 8px;color:#11182b;font:700 19px Arial,sans-serif">MLS history</h2><p style="margin:0 0 20px;color:#566178;font:400 14px Arial,sans-serif;line-height:1.6">${html(historyText)}</p><h2 style="margin:0;color:#11182b;font:700 19px Arial,sans-serif">Sources and verification paths</h2>${sourcesHtml}<p style="margin:24px 0 0;color:#8a93a5;font:400 11px Arial,sans-serif;line-height:1.55">Agent: ${html(agent)}. This AI-assisted preliminary market analysis is not an appraisal, legal advice or a guarantee of value. MLS facts, measurements, taxes, zoning, permits, school boundaries and property condition require professional verification.</p></td></tr></table></td></tr></table></body></html>`;
  const text=[`Toronto House Market — complete AI-assisted buyer report`,address,`Asking price: ${cad(facts.list_price)||"—"}`,`Estimated range: ${range}`,`Confidence: ${v.confidence||"Unavailable"}`,n.executive_summary,"Recent sold comparables:",...(comps.length?comps.map((c,i)=>`${i+1}. ${c.address} — ${cad(c.soldPrice)} — ${Math.round(Number(c.similarity)||0)}% match`):["No sufficiently reliable sold set was returned; manual Realtor review is required."]),"Methodology:",v.methodology,"Market read:",n.market_read,"Buyer strategy:",n.buyer_strategy,"Potential strengths:",...(n.strengths||[]).map(x=>`- ${x}`),"Risks and unknowns:",...(n.risks||[]).map(x=>`- ${x}`),"Showing priorities:",...(n.inspection_priorities||[]).map(x=>`- ${x}`),"Questions for your Realtor:",...(n.questions_for_realtor||[]).map(x=>`- ${x}`),"MLS history:",historyText,"Sources:",...sources.map(s=>`- ${s.name}: ${s.url}`),"This is an AI-assisted preliminary analysis, not an appraisal or guarantee of value."].filter(Boolean).join("\n\n");
  return {subject:`Your AI property report: ${address}`,html:htmlBody,text};
}

function emailDocument(subject,heading,intro,rows,link){
  const tableRows=rows.map(([label,value])=>`<tr><td style="padding:8px 12px;color:#687286;font:600 12px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(label)}</td><td style="padding:8px 12px;color:#11182b;font:600 14px Arial,sans-serif;border-bottom:1px solid #edf0f5">${html(value||"—")}</td></tr>`).join("");
  const cta=link?`<tr><td style="padding:22px 0 0"><a href="${link}" style="display:inline-block;background:#3155f5;color:#fff;text-decoration:none;font:700 14px Arial,sans-serif;padding:12px 18px;border-radius:9px">Open lead dashboard</a></td></tr>`:"";
  const htmlBody=`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;background:#f4f6fa"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 12px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:16px"><tr><td style="padding:28px"><p style="margin:0 0 8px;color:#3155f5;font:700 12px Arial,sans-serif">TORONTO HOUSE MARKET</p><h1 style="margin:0 0 12px;color:#11182b;font:700 24px Arial,sans-serif;line-height:1.25">${html(heading)}</h1><p style="margin:0 0 20px;color:#566178;font:400 15px Arial,sans-serif;line-height:1.55">${html(intro)}</p><table width="100%" cellpadding="0" cellspacing="0" border="0">${tableRows}</table><table cellpadding="0" cellspacing="0" border="0">${cta}</table><p style="margin:24px 0 0;color:#8a93a5;font:400 11px Arial,sans-serif;line-height:1.5">Automated operational message from Toronto House Market.</p></td></tr></table></td></tr></table></body></html>`;
  const textBody=[heading,intro,...rows.map(([a,b])=>`${a}: ${b||"—"}`),link?`Dashboard: ${link}`:""].filter(Boolean).join("\n\n");return {subject,html:htmlBody,text:textBody};
}

async function rpc(env,name,body){const response=await supabase(env,`/rest/v1/rpc/${name}`,{method:"POST",body:JSON.stringify(body)}),data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.message||`Database operation ${name} failed.`);return data;}
function timingLabel(value){return({asap:"As soon as possible",today:"Today, if available",within_24h:"Within 24 hours"})[value]||String(value||"—").replaceAll("_"," ")}
function formatToronto(value){return value?new Date(value).toLocaleString("en-CA",{timeZone:"America/Toronto",dateStyle:"medium",timeStyle:"short"}):"Starts after assignment"}
function cad(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0}).format(n):null}
function firstRelation(value){return Array.isArray(value)?value[0]||null:value&&typeof value==="object"?value:null}
function html(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function timingSafeEqual(a,b){let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function clean(v,max){return typeof v==="string"?v.trim().slice(0,max):""}function slug(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50)}
function validEmail(v){return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(v)}
function databaseMessage(data,fallback){if(data?.code==="23505")return "That assignment order is already in use.";return data?.message&&String(data.message).length<160?data.message:fallback}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION,"X-Content-Type-Options":"nosniff"}});}
