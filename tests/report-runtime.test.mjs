import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportRuntime, reportFetch, runtimeSummary, setReportStage } from '../report-runtime.js';
const db='https://test.supabase.co/rest/v1';
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function envFor(fetchImpl,options={}){return { AMPRE_VOW_TOKEN:'test-vow-only',THM_REPORT_RUNTIME:createReportRuntime({fetchImpl,...options})};}
test('exhausted optional requests cannot consume failure/complete capacity',async()=>{
  const calls=[];const env=envFor(async(url)=>{calls.push(String(url));return response({ok:true});});
  for(let i=0;i<38;i++)await reportFetch(env,`${db}/rows?i=${i}`);
  await assert.rejects(reportFetch(env,`${db}/rows?tooMany=1`),e=>e.code==='THM_REQUEST_BUDGET');
  assert.equal(calls.length,38);
  await reportFetch(env,`${db}/rpc/fail_report_job`,{method:'POST',body:'{}'});
  await reportFetch(env,`${db}/rpc/complete_report_job`,{method:'POST',body:'{}'});
  assert.equal(calls.length,40);
  assert.equal(runtimeSummary(env).resource_stops[0].code,'THM_REQUEST_BUDGET');
});
test('MLS scan ceiling leaves capacity for the AI and database',async()=>{
  let calls=0;const env=envFor(async()=>{calls++;return response({value:[]});},{mlsLimit:2});
  await reportFetch(env,'https://query.ampre.ca/odata/Property?$skip=0');
  await reportFetch(env,'https://query.ampre.ca/odata/Property?$skip=100');
  await assert.rejects(reportFetch(env,'https://query.ampre.ca/odata/Property?$skip=200'),e=>e.code==='THM_MLS_REQUEST_BUDGET');
  await reportFetch(env,`${db}/rpc/complete_report_job`,{method:'POST'});
  assert.equal(calls,3);
});
test('same invocation reuses MLS responses and retains genuine source rows',async()=>{
  let calls=0;const env=envFor(async()=>{calls++;return response({value:[{ListingKey:'TEST1',ClosePrice:100,PublicRemarks:'test fixture'}]});});
  const opts={headers:{Authorization:'Bearer test-vow-only'}};
  const url='https://query.ampre.ca/odata/Property?$top=100';
  await reportFetch(env,url,opts);await reportFetch(env,url,opts);
  assert.equal(calls,1);assert.equal(env.THM_REPORT_RUNTIME.vowRows.get('TEST1').ClosePrice,100);
  assert.equal(runtimeSummary(env).reused_http_requests,1);
});
test('IDX/VOW and independent invocations never share protected cache data',async()=>{
  let calls=0;const mock=async()=>{calls++;return response({value:[{ListingKey:'TEST1',ClosePrice:100}]});};
  const a=envFor(mock),b=envFor(mock),url='https://query.ampre.ca/odata/Property';
  await reportFetch(a,url,{headers:{Authorization:'Bearer test-idx'}});
  assert.equal(a.THM_REPORT_RUNTIME.vowRows.size,0);
  await reportFetch(a,url,{headers:{Authorization:'Bearer test-vow-only'}});
  await reportFetch(b,url,{headers:{Authorization:'Bearer test-vow-only'}});
  assert.equal(calls,3);assert.equal(b.THM_REPORT_RUNTIME.requests,1);
});
test('wall-clock deadline blocks more evidence requests but still saves failure',async()=>{
  const calls=[];const env=envFor(async(url)=>{calls.push(String(url));return response({ok:true});});
  env.THM_REPORT_RUNTIME.deadline=Date.now()-1;
  await assert.rejects(reportFetch(env,`${db}/rows`),e=>e.code==='THM_STAGE_DEADLINE');
  await reportFetch(env,`${db}/rpc/fail_report_job`,{method:'POST'});
  assert.equal(calls.length,1);
});
test('timeout aborts a hanging external fetch',async()=>{
  const env=envFor(async(_url,init)=>new Promise((_resolve,reject)=>{
    if(init.signal.aborted)return reject(init.signal.reason);
    init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }),{timeoutMs:20});
  setReportStage(env,'test-hanging-service');
  await assert.rejects(reportFetch(env,'https://query.ampre.ca/odata/Property'));
  assert.ok(runtimeSummary(env).elapsed_ms<1000);
});
test('OpenAI token usage is recorded without retaining the request or secret',async()=>{
  const env=envFor(async()=>response({model:'test-model',usage:{input_tokens:10,output_tokens:4},output:[]}));
  await reportFetch(env,'https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer test-secret'},body:'{"private":"test"}'});
  const summary=runtimeSummary(env);
  assert.equal(summary.openai_usage[0].usage.input_tokens,10);
  assert.ok(!JSON.stringify(summary).includes('test-secret'));
  assert.ok(!JSON.stringify(summary).includes('private'));
});
test('five independent report scopes have independent request limits',async()=>{
  const scopes=Array.from({length:5},()=>envFor(async()=>response({ok:true}),{limit:2}));
  await Promise.all(scopes.map(async env=>{
    await reportFetch(env,`${db}/rows`);await reportFetch(env,`${db}/rows`);
    await assert.rejects(reportFetch(env,`${db}/rows`),e=>e.code==='THM_REQUEST_BUDGET');
    await reportFetch(env,`${db}/rpc/fail_report_job`,{method:'POST'});
  }));
  assert.ok(scopes.every(env=>env.THM_REPORT_RUNTIME.requests===3));
});
test('patched scheduler uses one report claim and its own recovery credential path',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init={})=>{
    const u=String(input);calls.push(u);
    if(u.endsWith('/rpc/recover_stale_report_jobs'))return response(0);
    if(u.endsWith('/rpc/queue_overdue_sla_notifications'))return response(0);
    if(u.endsWith('/rpc/claim_report_jobs'))return response([]);
    if(u.includes('/property_reports?'))return response([]);
    throw new Error('Unexpected request '+u);
  };
  try {
    const {default:worker}=await import('../worker-v22.js');
    const pending=[];
    await worker.scheduled({}, {SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_URL:'https://test.supabase.co'}, {waitUntil(p){pending.push(p);}});
    await Promise.all(pending);
    assert.equal(calls.filter(u=>u.endsWith('/rpc/claim_report_jobs')).length,1);
    assert.equal(calls.filter(u=>u.endsWith('/rpc/recover_stale_report_jobs')).length,1);
  }finally{globalThis.fetch=original;}
});
