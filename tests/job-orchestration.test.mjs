import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../worker-v11.js", import.meta.url), "utf8");

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

test("report generation reuses the captured public snapshot and skips address-history scans", () => {
  const loadMatch = source.match(/async function loadPropertyForReport\(env, lead, requestId = null\) \{([\s\S]*?)\n\}/);
  assert.ok(loadMatch);
  assert.ok(loadMatch[1].includes('mergeCurrentIdxWithVow(capturedSnapshot, vowBody.property, "captured_idx_snapshot")'));
  assert.ok(!loadMatch[1].includes("public_snapshot"), "report generation must not reload public IDX facts already captured on the lead");
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
