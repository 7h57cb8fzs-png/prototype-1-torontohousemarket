import app from './worker-v20.js';

// V7.3 scheduler wrapper. Older worker layers enqueue nested waitUntil promises.
// Drain the queue until no new work is added so report jobs actually complete.
export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller, env));
  },
};

async function runScheduled(controller, env) {
  const pending = [];
  const proxy = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
  await app.scheduled(controller, env, proxy);
  let rounds = 0;
  while (pending.length && rounds < 20) {
    const batch = pending.splice(0, pending.length);
    await Promise.allSettled(batch);
    rounds++;
  }
  if (pending.length) console.warn(JSON.stringify({event:'v73_scheduler_drain_limit',remaining:pending.length,rounds}));
}
