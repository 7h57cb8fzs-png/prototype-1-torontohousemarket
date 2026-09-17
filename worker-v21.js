import app from './worker-v20.js';
const QA_TOKEN='ma1lpc5dzJ9AXXajtHrMtcUNrGo0PTEm';
export default {
 async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/internal/v73-drain'&&request.method==='POST'){if(request.headers.get('X-THM-QA')!==QA_TOKEN)return new Response('Not found',{status:404});const probe=await probeSupabase(env);ctx.waitUntil(runScheduled({},env));return j({ok:true,queued:true,bindings:{supabase:!!env.SUPABASE_SERVICE_ROLE_KEY,ampre:!!env.AMPRE_TOKEN,vow:!!env.AMPRE_VOW_TOKEN,openai:!!env.OPENAI_API_KEY},probe});}return app.fetch(request,env,ctx);},
 async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(controller,env));}
};
async function probeSupabase(env){if(!env.SUPABASE_SERVICE_ROLE_KEY)return{status:0,error:'missing_service_key'};try{const r=await fetch('https://pwbtxyavjjotxtvegrqe.supabase.co/rest/v1/automation_jobs?select=id,status&limit=1',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});return{status:r.status,ok:r.ok};}catch(e){return{status:0,error:String(e?.message||e).slice(0,120)}}}
async function runScheduled(controller,env){const pending=[],errors=[],proxy={waitUntil(p){pending.push(Promise.resolve(p).catch(e=>{errors.push(String(e?.message||e).slice(0,200));throw e;}));}};try{await app.scheduled(controller,env,proxy);}catch(e){errors.push('scheduled:'+String(e?.message||e).slice(0,200));}let rounds=0;while(pending.length&&rounds<30){const batch=pending.splice(0);await Promise.allSettled(batch);rounds++;}if(errors.length)console.error(JSON.stringify({event:'v73_scheduler_errors',errors,rounds}));}
function j(x){return new Response(JSON.stringify(x),{status:202,headers:{'Content-Type':'application/json'}})}
