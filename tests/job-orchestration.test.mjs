import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPropertyForReport, deliverEmailJob, startReportHeartbeat } from "../worker-v11.js";

const source = readFileSync(new URL("../worker-v11.js", import.meta.url), "utf8");

test("active report attempts keep their lease and stop renewing after completion", async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const originalFetch=globalThis.fetch, calls=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init});return new Response(null,{status:204});};
  const stop=startReportHeartbeat({SUPABASE_SERVICE_ROLE_KEY:'test'},{id:77,attempts:2});
  try {
    t.mock.timers.tick(30000);
    await Promise.resolve();
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/id=eq.77&status=eq.processing&attempts=eq.2/);
    assert.ok(Date.parse(JSON.parse(calls[0].init.body).locked_at));
    assert.ok(calls[0].init.signal);
    stop();t.mock.timers.tick(120000);await Promise.resolve();
    assert.equal(calls.length,1);
  } finally {stop();globalThis.fetch=originalFetch;t.mock.timers.reset();}
});

test("lost delivery acknowledgement is retried without sending a second email", async () => {
  const originalFetch=globalThis.fetch;
  let sends=0, completions=0;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    if(url.includes('/rest/v1/leads?')) return Response.json([{id:'test-lead',name:'QA',resolved_address:'Test home',metadata:{},property_reports:{status:'ready',report_payload:{generated_at:new Date().toISOString(),facts:{for_sale:false},valuation:{available:false},comparables:[]}}}]);
    if(url==='https://api.resend.com/emails') {sends++;assert.equal(new Headers(init.headers).get('Idempotency-Key'),'thm-job-1-v1');assert.ok(init.signal);return Response.json({id:'accepted-once'});}
    if(url.endsWith('/rpc/complete_email_job')) {completions++;assert.ok(init.signal);assert.equal(JSON.parse(init.body).p_provider_id,'accepted-once');if(completions===1)throw new TypeError('connection reset after acceptance');return Response.json(null);}
    throw new Error('Unexpected request');
  };
  try {await deliverEmailJob({SUPABASE_SERVICE_ROLE_KEY:'test',RESEND_API_KEY:'test'},{id:1,lead_id:'test-lead',job_type:'email_buyer',recipient:'qa@example.com'});assert.equal(sends,1);assert.equal(completions,2);}
  finally {globalThis.fetch=originalFetch;}
});

test("full report request preserves evidence-only mode through every legacy wrapper", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const subject = { ListingKey: "N7000001", UnparsedAddress: "50 Test Road, Vaughan", StreetNumber: "50", StreetName: "Test", CityRegion: "Maple", City: "Vaughan", PostalCode: "L6A 1A1", PropertySubType: "Detached", StandardStatus: "Active", TransactionType: "For Sale", ListPrice: 1000000, BedroomsTotal: 3, BathroomsTotalInteger: 2, LivingAreaRange: "1500-2000", Media: [{MediaKey:"photo-l",MediaURL:"https://example.com/photo.jpg",MediaType:"image/jpeg"}] };
  const rows = [1,2,3].map(n => ({...subject,ListingKey:`N700000${n+1}`,UnparsedAddress:`${n} Other Road, Vaughan`,StandardStatus:"Closed",ClosePrice:950000+n*10000,PurchaseContractDate:new Date(Date.now()-30*86400000).toISOString()}));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const auth = new Headers(init.headers).get("Authorization");
    calls.push({url,auth});
    if (url.pathname.includes("/Property(")) return Response.json(subject);
    if (url.searchParams.get("$count") === "true") return Response.json({"@odata.count":rows.length,value:[]});
    if (url.pathname.endsWith("/Property")) return Response.json({value:rows});
    throw new Error(`Unexpected extra lookup: ${url.pathname}`);
  };
  try {
    const property = await loadPropertyForReport({AMPRE_TOKEN:"public-test",AMPRE_VOW_TOKEN:"protected-test"},{property_snapshot:{listingKey:subject.ListingKey},metadata:{}});
    assert.equal(property.comparableContext.comparables.length,3);
    assert.equal(property.reportDataPipeline.subjectFacts,"rechecked_current_idx");
    assert.equal(property.historySummary.appearanceCount,1);
    const protectedCalls = calls.filter(c => c.auth === "Bearer protected-test");
    assert.ok(protectedCalls.length > 1);
    assert.ok(protectedCalls.every(c => !c.url.pathname.includes("/Media")),"protected evidence must not load photos");
    assert.ok(protectedCalls.every(c => !c.url.searchParams.has("$expand")),"protected subject must not expand media");
    assert.ok(protectedCalls.every(c => !c.url.searchParams.has("$orderby")),"report mode must skip full address-history scans");
  } finally { globalThis.fetch = originalFetch; }
});

test("scheduled automation delivers ready emails before expensive report generation", () => {
  const match = source.match(/async function processAutomationJobs\(env\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "processAutomationJobs must exist");

  const body = match[1];
  const emailIndex = body.indexOf("await processEmailJobs(env, 20)");
  const reportIndex = body.indexOf("await processReportJobs(env, 1)");
  const secondEmailIndex = body.indexOf("await processEmailJobs(env, 20)", emailIndex + 1);

  assert.ok(emailIndex >= 0, "email processing call must exist");
  assert.ok(reportIndex >= 0, "report processing call must exist");
  assert.ok(emailIndex < reportIndex, "ready emails must be processed before reports");
  assert.ok(secondEmailIndex > reportIndex, "a newly generated report email must be processed in the same cron invocation");
  assert.ok(body.includes("await processReportJobs(env, 1)"), "a cron invocation must claim only one expensive report");
  assert.ok(body.includes("await reconcileRecentEmailDeliveries(env, 5)"), "provider acceptance must be reconciled with Resend delivery status");
});

test("report generation rechecks public facts server-side and skips expensive address-history scans", () => {
  const loadMatch = source.match(/async function loadPropertyForReport\(env, lead, requestId = null\) \{([\s\S]*?)\n\}/);
  assert.ok(loadMatch);
  assert.ok(loadMatch[1].includes('mergeCurrentIdxWithVow(currentBody.property, vowBody.property, "rechecked_current_idx")'));
  assert.ok(loadMatch[1].includes('publicProperty(new Request(url.toString())'));
  assert.ok(!loadMatch[1].includes('mergeCurrentIdxWithVow(capturedSnapshot'), "untrusted browser prices cannot replace current verified listing facts");
  assert.ok(source.includes("publicSnapshot || reportEvidence ? [subject] : await findSameAddressHistory(subject, env)"));
});

test("delivery reconciliation reads the Resend ID from the existing JSON payload", () => {
  assert.ok(source.includes("job.payload?.provider_id"));
  assert.ok(source.includes("encodeURIComponent(job.payload.provider_id)"));
  assert.ok(!source.includes('select = "id,provider_id,payload"'));
});

test("admin diagnostics can audit twenty MLS listings without creating report jobs", () => {
  const consoleMatch = source.match(/function adminDiagnosticConsole\(\) \{([\s\S]*?)\n\}/);
  assert.ok(consoleMatch, "admin diagnostic console must exist");
  const body = consoleMatch[1];
  assert.ok(body.includes('id="batch"'));
  assert.ok(body.includes("slice(0,30)"));
  assert.ok(body.includes("Load 20 current active listings"));
  assert.ok(source.includes('url.pathname === "/api/admin/vow/active-sample"'));
  assert.ok(body.includes("/[A-Z]\\\\d{7,9}/g"), "rendered console must preserve the MLS digit matcher");
  assert.ok(body.includes("Run read-only batch"));
  assert.ok(body.includes("/api/admin/vow/diagnostics?listingKey="));
  assert.ok(body.includes("auditPause"), "batch diagnostics must throttle requests");
  assert.ok(body.includes("HTTP '+response.status"), "batch errors must expose the HTTP status");
});

test("comparable diagnostics expose the facts needed for a realtor audit", () => {
  const diagnosticMatch = source.match(/async function vowDiagnostics\(request, env\) \{([\s\S]*?)\n\}/);
  assert.ok(diagnosticMatch, "VOW diagnostics must exist");
  const body = diagnosticMatch[1];
  for (const field of [
    "listPrice",
    "propertySubType",
    "livingAreaRange",
    "beds",
    "baths",
    "soldPrice",
    "soldDate",
    "distanceKm",
    "similarity"
  ]) assert.ok(body.includes(field), `diagnostics must include ${field}`);
});

test("isolated listing sender cannot notify an unverified recipient or general queue", () => {
  const senderMatch = source.match(/async function createAndSendListingTestEmail\(request, env\) \{([\s\S]*?)\n\}/);
  assert.ok(senderMatch, "isolated listing sender must exist");
  const body = senderMatch[1];
  assert.ok(body.includes('recipient !== "ali.golestan.reza@gmail.com"'));
  assert.ok(body.includes('email: null'), "lead must be inserted without email so the confirmation trigger cannot fire");
  assert.ok(body.includes('source: "admin_test"'));
  assert.ok(body.includes("await runTestReportEmail(request, env, leadId)"));
  assert.ok(!body.includes("processAutomationJobs"));
  assert.ok(source.includes('url.pathname === "/api/admin/reports/test-email-by-listing"'));
});
