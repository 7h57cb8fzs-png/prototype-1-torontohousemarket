import app from './worker-v20.js';
import reportScheduler from './worker-v15.js';
const QA_TOKEN='v73sync-7f4d9a2c';
export default{
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/internal/v73-run-sync'&&request.method==='POST'){
   if(request.headers.get('X-THM-QA')!==QA_TOKEN)return new Response('Not found',{status:404});
   const started=Date.now();
   await runScheduled({},env);
   return new Response(JSON.stringify({ok:true,elapsed_ms:Date.now()-started}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  return app.fetch(request,env,ctx);
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(controller,env));}
};
async function drain(call){const pending=[];const proxy={waitUntil(p){pending.push(Promise.resolve(p));}};await call(proxy);let rounds=0;while(pending.length&&rounds<30){const batch=pending.splice(0);await Promise.allSettled(batch);rounds++;}}
async function runScheduled(controller,env){
 await drain(proxy=>reportScheduler.scheduled(controller,{...env,OPENAI_MODEL:'gpt-5.6-luna',RESEND_API_KEY:null},proxy));
 await drain(proxy=>app.scheduled(controller,{...env,RESEND_API_KEY:null},proxy));
}
