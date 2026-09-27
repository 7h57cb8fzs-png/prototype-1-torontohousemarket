# Conditional Luna outside-source recovery — 2026-09-27

Internal strict and broadened MLS recovery run first. When fewer than three usable comparisons remain, Luna web search discovers external listing leads. Exact licensed MLS records establish prices, dates, subtype and locality; unverified leads are cited separately and cannot set a valuation. No PDF upload is required for research. Missing subject facts still prevent an estimate.

Candidate source: 39f7dec5962c880ba454bcbaeb556a3df09fa2b7
Reviewed Worker: 0ee2f48d-a4b5-47f3-aec6-8b3c92edab58
Bundle SHA-256: b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74
Rollback Worker: 52c942f2-2042-4d77-89e9-8c99ced92c2b

Validation:
- 34 focused automated checks passed, including synthetic empty-feed recovery, API failures, unmatched subjects, duplicate homes, citations, time budgets and one atomic report save.
- Twenty distinct newly sampled properties: ten off-market seller homes and ten buyer listings. Prior saved searches, prior test hashes and known test MLS identifiers excluded.
- Forty initial before/draft report executions, followed by twenty final-candidate executions on the same random cohort. No new cohort was substituted after review.
- Final cohort: 20/20 reports and estimates available; 3–8 selected comparables per report; no unsupported adjustment flags.
- All twenty already recovered enough internal evidence. Final outside-search calls: zero, confirming the conditional trigger.
- Draft integration exercised seven actual Luna web-search requests (all HTTP 200): 25 source-grounded listing leads and 23 MLS-verified eligible sale records.
- Draft condo elevation inference correctly withheld one estimate; existing safeguard retained. No such inference remained in the final cohort.
- Coverage stayed 100% in this cohort; no valuation-accuracy improvement percentage can be inferred. Model reconciliation changed some midpoints by up to 7.2%; property-history listing counts were preserved.
- Live checks used read-only adapters with database mutations and email calls blocked; archive fallback disabled. No leads/reports/consents/emails created.
- An existing unrelated email-acknowledgement fixture fails identically on baseline and candidate. Focused runtime test's stale 7.4 version expectation was updated to 7.6.

QA workflows: 36342181455 (before/draft), 36342733348 (final).
Exact reviewed version promotion is controlled by external-publish.yml, with asset/auth/config/cron checks and rollback on failure.


Published successfully by workflow 36343201271. Production bundle/version verified; all 16 checked public assets, admin authentication, existing bindings and cron preserved. No rollback required.
