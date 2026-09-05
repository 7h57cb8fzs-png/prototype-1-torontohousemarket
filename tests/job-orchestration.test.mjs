import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../worker-v11.js", import.meta.url), "utf8");

test("scheduled automation delivers ready emails before expensive report generation", () => {
  const match = source.match(/async function processAutomationJobs\(env\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "processAutomationJobs must exist");

  const body = match[1];
  const emailIndex = body.indexOf("await processEmailJobs(env, 20)");
  const reportIndex = body.indexOf("await processReportJobs(env, 3)");

  assert.ok(emailIndex >= 0, "email processing call must exist");
  assert.ok(reportIndex >= 0, "report processing call must exist");
  assert.ok(emailIndex < reportIndex, "ready emails must be processed before reports");
});
