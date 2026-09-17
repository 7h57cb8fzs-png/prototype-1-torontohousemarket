import app from './worker-v20.js';
import reportScheduler from './worker-v15.js';
const QA_TOKEN='ma1lpc5dzJ9AXXajtHrMtcUNrGo0PTEm';
export default{
 async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/internal/v73-drain'&&request.method==='POST'){if(request.headers.get('X-THM-QA')!==QA_TOKEN)return new Response('Not found',{status:404});ctx.waitUntil(runScheduled({},env));return new Response(JSON.stringify({ok:true,queued:true}),{status:202,headers:{'Content-Type':'application/json'}});}return app.fetch(request,env,ctx);},
 async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(controller,env));}
};
async function drain(call){const pending=[];const proxy={waitUntil(p){pending.push(Promise.resolve(p));}};await call(proxy);let rounds=0;while(pending.length&&rounds<30){const batch=pending.splice(0);await Promise.allSettled(batch);rounds++;}}
async function runScheduled(controller,env){
 // Generate/complete report jobs through the proven V7.1 scheduler directly.
 await drain(proxy=>reportScheduler.scheduled(controller,{...env,OPENAI_MODEL:'gpt-5.6-luna',RESEND_API_KEY:null},proxy));
 // Then let V7.3 decorate ready reports / apply exceptional Terra adjudication.
 await drain(proxy=>app.scheduled(controller,{...env,RESEND_API_KEY:null},proxy));
}
