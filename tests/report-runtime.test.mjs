import assert from 'node:assert/strict';
import test from 'node:test';
import { createReportRuntime, reportFetch, reportStage, retainReportRows, ReportBudgetError } from '../report-runtime.js';
import { collectBroadSoldPool } from '../worker-v12.js';
import app from '../worker-v22.js';
const originalFetch = globalThis.fetch;
const job = { id: 900001, attempts: 1, lead_id:'00000000-0000-4000-8000-000000000001', report_id:'00000000-0000-4000-8000-000000000002', payload:{report_mode:'idx_ai'}, created_at:new Date().toISOString() };
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});

test('request exhaustion leaves reserved capacity to persist a failure', async () => {
  globalThis.fetch = async () => json({ok:true});
  try {
    const runtime=createReportRuntime(job,{maxDataRequests:3,maxRequests:5}); const env={THM_REPORT_RUNTIME:runtime};
    for(let i=0;i<3;i++) await reportFetch(env,'https://query.ampre.ca/odata/Property');
    await assert.rejects(reportFetch(env,'https://query.ampre.ca/odata/Property'),ReportBudgetError);
    runtime.controller.abort();
    assert.equal((await reportFetch(env,'https://test.supabase.co/rest/v1/rpc/fail_report_attempt',{},true)).status,200);
    assert.equal(runtime.requests,4);
  } finally { globalThis.fetch=originalFetch; }
});

test('a hanging stage aborts and does not silently remain running', async () => {
  const env={THM_REPORT_RUNTIME:createReportRuntime(job)}; let signal;
  await assert.rejects(reportStage(env,'test_hang',10,async e=>{signal=e.THM_REPORT_STAGE_SIGNAL;await new Promise(()=>{});}), /exceeded its time budget/);
  assert.equal(signal.aborted,true); assert.equal(env.THM_REPORT_RUNTIME.stages[0].status,'failed');
});

test('expert fallback reuses verified raw MLS evidence with zero repeat fetches',async()=>{
  const rows=Array.from({length:16},(_,i)=>({ListingKey:`N${80000000+i}`,UnparsedAddress:`100 Test Road ${i}, Markham`,PropertySubType:'Condo Apartment',PropertyType:'Residential Condo & Other',CityRegion:'Unionville',City:'Markham',PostalCode:'L3R 0A1',StandardStatus:'Closed',TransactionType:'For Sale',ClosePrice:550000+i*1000,PurchaseContractDate:'2026-09-01',LivingAreaRange:'800-899'}));
  const runtime=createReportRuntime(job);const env={THM_REPORT_RUNTIME:runtime,AMPRE_VOW_TOKEN:'test-only'};
  retainReportRows(env,rows);globalThis.fetch=()=>{throw new Error('Unnecessary duplicate query');};
  try{const pool=await collectBroadSoldPool(env,{address:'99 Test Road Unit 720, Markham',city:'Markham',cityRegion:'Unionville',postalCode:'L3R 0A1',propertySubType:'Condo Apartment'});assert.equal(pool.length,16);assert.equal(pool[0].soldPrice,rows[0].ClosePrice);}finally{globalThis.fetch=originalFetch;}
});

test('production scheduler finalizes a weak-evidence condo, saves once, and never exposes raw pool',async()=>{
  const subject={ListingKey:'N89999999',UnparsedAddress:'99 Test Boulevard 720, Markham, ON L3R 0A1',StreetNumber:'99',StreetName:'Test',StreetSuffix:'Boulevard',UnitNumber:'720',City:'Markham',CityRegion:'Unionville',PostalCode:'L3R 0A1',PropertyType:'Residential Condo & Other',PropertySubType:'Condo Apartment',StandardStatus:'Active',TransactionType:'For Sale',ListPrice:588000,BedroomsTotal:2,BedroomsAboveGrade:2,BathroomsTotalInteger:2,LivingAreaRange:'700-799',ParkingTotal:1,PublicRemarks:'Test fixture only.',InternetAddressDisplayYN:true,InternetEntireListingDisplayYN:true};
  const rows=Array.from({length:16},(_,i)=>({...subject,ListingKey:`N${80000000+i}`,UnparsedAddress:`100 Test Boulevard ${i}, Markham, ON L3R 0A1`,StreetNumber:'100',UnitNumber:String(i),StandardStatus:'Closed',ClosePrice:550000+i*1000,PurchaseContractDate:'2026-09-01',LivingAreaRange:i===0?'700-799':'800-899'}));
  let claimed=false,saved=null,saveCount=0,requestCount=0,openaiCalls=0,narrativeValuation=null;
  const narrative={executive_summary:'Test fixture summary.',market_read:'Test fixture evidence.',buyer_strategy:'Review the supplied sales.',strengths:['Two bedrooms.'],risks:['Inspect condition.'],inspection_priorities:['Check finishes.'],questions_for_realtor:['Confirm parking.']};
  globalThis.fetch=async (input,init={})=>{
    requestCount++;assert.ok(requestCount<48,'Platform request headroom must be retained');
    const u=new URL(typeof input==='string'?input:input.url||String(input));
    const body=init.body?JSON.parse(init.body):{};
    if(u.hostname.endsWith('.supabase.co')){
      if(u.pathname.endsWith('/recover_stale_report_jobs'))return json(0);
      if(u.pathname.endsWith('/queue_overdue_sla_notifications'))return json(0);
      if(u.pathname.endsWith('/claim_report_jobs')){if(claimed)return json([]);claimed=true;return json([job]);}
      if(u.pathname==='/rest/v1/leads')return json([{id:job.lead_id,lead_mode:'showing',resolved_address:subject.UnparsedAddress,property_snapshot:{listingKey:subject.ListingKey},metadata:{},created_at:job.created_at}]);
      if(u.pathname==='/rest/v1/automation_jobs')return json([]);
      if(u.pathname.endsWith('/complete_report_attempt')){assert.equal(body.p_attempt,1);assert.equal(body.p_report_id,job.report_id);saved=body.p_report_payload;saveCount++;return json(true);}
      if(u.pathname.endsWith('/fail_report_attempt'))throw new Error('Unexpected failure: '+body.p_error);
      if(u.pathname==='/rest/v1/property_reports')return json([]);
      throw new Error('Unexpected database call '+u.pathname);
    }
    if(u.hostname==='query.ampre.ca'){
      if(u.pathname.includes("Property('"))return json(subject);
      if(u.pathname.endsWith('/Media'))return json({value:[]});
      if(u.searchParams.get('$count')==='true')return json({'@odata.count':16,value:[]});
      assert.equal(u.searchParams.has('$select'),false,'Broken select projection must not recur');
      return json({value:rows});
    }
    if(u.hostname==='generativelanguage.googleapis.com'||u.hostname==='openrouter.ai')return json({error:{message:'Fixture provider unavailable'}},400);
    if(u.hostname==='api.openai.com'){
      openaiCalls++;
      const name=body.text.format.name;
      if(name==='thm_buyer_narrative') narrativeValuation=JSON.parse(body.input[1].content).valuation;
      const out=name==='thm_expert_comps'?{confidence:'Moderate',market_read:'Fixture sold evidence reviewed.',comparables:rows.slice(0,4).map(r=>({id:r.ListingKey,weight:0.5,adjusted_indication:560000,selection_reason:'Same local market.',adjustment_reason:'Fixture adjustment.',adjustment_basis:'professional_judgment'}))}:narrative;
      return json({output_text:JSON.stringify(out),usage:{input_tokens:100,output_tokens:100}});
    }
    throw new Error('Unexpected external call '+u.hostname);
  };
  try{
    const env={SUPABASE_SERVICE_ROLE_KEY:'test-only',AMPRE_TOKEN:'test-only',AMPRE_VOW_TOKEN:'test-only',OPENAI_API_KEY:'test-only',GEMINI_API_KEY:'test-only',OPENROUTER_API_KEY:'test-only',AI:{run:async()=>({response:JSON.stringify(narrative)})}};
    const pending=[];await app.scheduled({},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);
    assert.equal(saveCount,1);assert.equal(saved.version_label,'Toronto House Market Version 7.4');
    assert.equal(saved.comparables.length,4);assert.ok(saved.valuation.estimated_market_value>0);
    assert.equal(saved.model_policy.terra_review,false);assert.ok(saved.execution_telemetry.request_count<34);
    assert.deepEqual(narrativeValuation,saved.valuation,'Narrative must see the final published numbers and confidence');
    assert.equal(openaiCalls,2);assert.equal(saved.execution_telemetry.ai_usage.length,2);
    for(const c of saved.comparables)assert.equal(c.soldPrice,rows.find(r=>r.ListingKey===c.listingKey).ClosePrice);
    assert.equal('rawRows' in saved,false);assert.ok(!JSON.stringify(saved).includes('test-only'));
    console.log('REGRESSION_RESULT',JSON.stringify({requests:requestCount,openaiCalls,comps:saved.comparables.length}));
  }finally{globalThis.fetch=originalFetch;}
});
