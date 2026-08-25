import app from "./worker-v10.js";

const VERSION = "phase2-ops-v11-20260825";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json({ok:true,version:VERSION,comparables:"recent-sold-only",operations:"admin-and-job-queue"});
    if (url.pathname === "/api/admin/leads" && request.method === "GET") return adminLeads(request,env);
    if (url.pathname.startsWith("/api/admin/leads/") && request.method === "PATCH") return updateLead(request,env,url.pathname.split("/").pop());
    if (url.pathname === "/api/admin/agents" && request.method === "GET") return adminAgents(request,env);
    if (url.pathname === "/api/admin/agents" && request.method === "POST") return createAgent(request,env);
    if (url.pathname.startsWith("/api/admin/agents/") && request.method === "PATCH") return updateAgent(request,env,url.pathname.split("/").pop());
    return app.fetch(request,env,ctx);
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
  const select = "id,name,mobile,email,lead_mode,status,stage,next_action,next_action_at,first_response_due_at,resolved_address,showing_timing,created_at,updated_at,metadata,agents(code,display_name,email,mobile),property_reports(id,status,generated_at,updated_at),automation_jobs(id,job_type,status,recipient,attempts,available_at,completed_at,last_error)";
  const response = await supabase(env,`/rest/v1/leads?select=${encodeURIComponent(select)}&order=created_at.desc&limit=100`);
  const data = await response.json().catch(()=>null);
  return response.ok ? json({ok:true,leads:data}) : json({ok:false,error:"Unable to load leads."},502);
}

async function updateLead(request,env,id) {
  if (!authorized(request,env)) return json({ok:false,error:"Unauthorized"},401);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ok:false,error:"Invalid lead."},400);
  const input = await request.json().catch(()=>({}));
  const allowedStatus = ["new","contacted","appointment_pending","appointment_confirmed","closed","lost"];
  const body = {updated_at:new Date().toISOString()};
  if (allowedStatus.includes(input.status)) body.status=input.status;
  if (typeof input.stage === "string" && input.stage.length<=80) body.stage=input.stage;
  if (typeof input.next_action === "string" && input.next_action.length<=120) body.next_action=input.next_action;
  const response = await supabase(env,`/rest/v1/leads?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(body)});
  const data = await response.json().catch(()=>null);
  return response.ok ? json({ok:true,lead:Array.isArray(data)?data[0]:data}) : json({ok:false,error:"Unable to update lead."},502);
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
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({ok:false,error:"Enter a valid email."},400);
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
  if("email" in input){const v=clean(input.email,254).toLowerCase();if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return json({ok:false,error:"Enter a valid email."},400);body.email=v||null;}
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
function timingSafeEqual(a,b){let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function clean(v,max){return typeof v==="string"?v.trim().slice(0,max):""}function slug(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50)}
function databaseMessage(data,fallback){return data?.code==="23505"?"That assignment order is already in use.":fallback}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION,"X-Content-Type-Options":"nosniff"}});}
