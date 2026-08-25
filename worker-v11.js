import app from "./worker-v10.js";

const VERSION = "phase2-ops-v11-20260825";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/version") return json({ok:true,version:VERSION,comparables:"recent-sold-only",operations:"admin-and-job-queue"});
    if (url.pathname === "/api/admin/leads" && request.method === "GET") return adminLeads(request,env);
    if (url.pathname.startsWith("/api/admin/leads/") && request.method === "PATCH") return updateLead(request,env,url.pathname.split("/").pop());
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

function supabase(env,path,init={}) {
  return fetch(`${env.SUPABASE_URL || "https://pwbtxyavjjotxtvegrqe.supabase.co"}${path}`,{...init,headers:{"Content-Type":"application/json",apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,...(init.headers||{})}});
}
function timingSafeEqual(a,b){let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-THM-Version":VERSION,"X-Content-Type-Options":"nosniff"}});}
