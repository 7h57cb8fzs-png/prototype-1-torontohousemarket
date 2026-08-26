import app from "./worker-v10.js";

const VERSION = "phase2-resend-notifications-v13-20260825";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json({ok:true,version:VERSION,comparables:"recent-sold-only",operations:"admin-and-job-queue"});
    if (url.pathname === "/api/lead" && request.method === "POST") {
      const response=await app.fetch(request,env,ctx);
      if(response.ok&&env.RESEND_API_KEY)ctx.waitUntil(processEmailJobs(env,10));
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
  const select = "id,name,mobile,email,lead_mode,status,stage,next_action,next_action_at,first_response_due_at,resolved_address,showing_timing,created_at,updated_at,metadata,agents(id,code,display_name,email,mobile),property_reports(id,status,generated_at,updated_at),automation_jobs(id,job_type,status,recipient,attempts,available_at,completed_at,last_error)";
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
  if(response.ok&&env.RESEND_API_KEY)ctx.waitUntil(processEmailJobs(env,10));
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
  return processEmailJobs(env,20);
}

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
  else if(job.job_type==="email_buyer"){subject=`Your property report is ready: ${address}`;heading="Your property report is ready";intro="The preliminary AI-assisted property report has been completed. A Realtor will review the findings with you.";rows=[["Property",address],["Agent",agent]];}
  else{rows=[["Property",address],["Buyer",lead.name],["Status",lead.status]];}
  return emailDocument(subject,heading,intro,rows,reason.startsWith("buyer_")||job.job_type==="email_buyer"?null:"https://torontohousemarket.com/admin.html");
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
function html(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function timingSafeEqual(a,b){let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function clean(v,max){return typeof v==="string"?v.trim().slice(0,max):""}function slug(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50)}
function validEmail(v){return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(v)}
function databaseMessage(data,fallback){if(data?.code==="23505")return "That assignment order is already in use.";return data?.message&&String(data.message).length<160?data.message:fallback}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION,"X-Content-Type-Options":"nosniff"}});}
