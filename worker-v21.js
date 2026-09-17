import app from './worker-v20.js';
const QA_TOKEN='ma1lpc5dzJ9AXXajtHrMtcUNrGo0PTEm';
export default {
  async fetch(request, env, ctx) {
    const u=new URL(request.url);
    if(u.pathname==='/api/internal/v73-drain'&&request.method==='POST'){
      if(request.headers.get('X-THM-QA')!==QA_TOKEN)return new Response('Not found',{status:404});
      ctx.waitUntil(runScheduled({},env));
      return new Response(JSON.stringify({ok:true,queued:true}),{status:202,headers:{'Content-Type':'application/json'}});
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) { ctx.waitUntil(runScheduled(controller, env)); },
};
async function runScheduled(controller, env) {
  const pending=[];const proxy={waitUntil(p){pending.push(Promise.resolve(p));}};
  await app.scheduled(controller,env,proxy);
  let rounds=0;
  while(pending.length&&rounds<30){const batch=pending.splice(0,pending.length);await Promise.allSettled(batch);rounds++;}
  if(pending.length)console.warn(JSON.stringify({event:'v73_scheduler_drain_limit',remaining:pending.length,rounds}));
}
