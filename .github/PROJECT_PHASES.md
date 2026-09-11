# Toronto House Market — phase register

## Current phase: Phase 6
Phase 5 was closed by Alireza on 2026-09-11. All subsequent work is Phase 6 unless explicitly reassigned. Closure records a baseline; it does not imply every issue is resolved.

## Phase 5 checkpoint
- Repository: 7h57cb8fzs-png/prototype-1-torontohousemarket
- Checkpoint branch: checkpoint/phase-5-closed-2026-09-11
- Source commit: b0fa51915eef49fa66879aca7f1ec8fd0e7e1533
- Tree: 6457fe09ec3055ef6d7948db8fcf00536c3c61bb
- Cloudflare Worker: prototype-1-torontohousemarket
- Production domain: https://torontohousemarket.com
- Deployed Worker version: 1827ab7a-9599-4c3c-908c-bf4e024ac643
- Worker source SHA256: ed36c246e3a815b57c9640ef66d12ffb7de032b3a7886493d09dda788281b561
- Successful release run: 34643377393
- Supabase project: pwbtxyavjjotxtvegrqe
- This is a code/deployment checkpoint, not a database or credential backup.

## What “go back to Phase 5” means
Use the checkpoint above, not the original Phase 1 README or an earlier Phase 5 iteration. Inspect current deployment and changes since this checkpoint first. Restore the Phase 5 code and matching static assets through the existing guarded GitHub/Cloudflare process. Preserve current secrets, bindings, cron and production lead/report/appointment data. Never reset Supabase or remove newer customer records as part of a code rollback. Check database compatibility before changing code; if incompatible, explain the specific blocker. Do not blindly rerun the old workflow: its expected-source guard describes the production version before that release. Set the guard to the verified current production source and use an explicitly scoped regression sample. If the request is only to review Phase 5, inspect the checkpoint without deployment.

## Phase 5 product baseline
- Toronto House Market is the primary brand; Alireza Golestan and Mehrdad Golestan are identified as sales representatives with CENTURY 21 Leading Edge Realty Inc., Brokerage.
- AI report request comes first; showing is optional via checkbox. Email reports, contact actions, showing calendar requests and backend lead management are implemented.
- Minimal teal design, consistent dropdown controls, clearer address/size typography, condo maintenance in place of lot, restrained eligible-purchase cashback presentation.
- Same-community comparable selection; verified same-building/full-postal-code exception for inconsistent MLS community labels. Condo type and size range still must match.
- Exact condo unit identity must be preserved. Numbered-highway unit parsing fixed in this checkpoint.
- Do not substitute VOW credentials for public IDX access, invent sold evidence or label missing records as off-market.

## Verification and known unresolved issue
Ten newly selected condo properties (4 Toronto, 3 Richmond Hill, 3 Vaughan) are recorded in tests/condo-address-sample.json. Initial address test: 9 passed, 1 failed (2916 Highway 7 #401, N13772410). After correction all ten exact address lookups matched expected MLS keys in preview and production; the failed condo was also verified in the live UI. This was search verification, not ten generated email-report tests. No reports/emails were generated.
898 Portage Parkway #2106, MLS N13611398, remains unresolved: direct IDX request returned 404; address query returned 18 building records without this unit, while an external REALTOR.ca listing was visible. Do not claim the highway parser fix solved this property or that this proves all condo failures are feed issues.

## Phase 6 working rules
Use phase-6 as the working branch. Keep the Phase 5 checkpoint untouched. Approved Phase 6 scope includes a seller landing page, owner-confirmed home facts and upgrades, target-price capture, seller evidence report, email delivery and admin seller details. Public response target is 28 minutes, 9 AM–9 PM.
The user is highly cost-sensitive: run only the specifically requested number of property checks; reuse the selected sample for before/after checks. “Random” means exclude previously tested properties. Never run the entire 139-test/property batch by default. Do not send test emails or create test leads without authorization.
Keep GitHub → Cloudflare Worker + Supabase. Do not migrate hosting or recreate infrastructure. The guarded release workflow now triggers on phase-6. Always verify the production source hash before deployment and preserve secrets, bindings, cron and customer records.

## Seller experience — Phase 6
- Dedicated campaign URL: /seller.html. Homepage seller links and the off-market owner action lead here.
- Owner-provided facts, improvements, recency, document availability, target price, timeline and consent are stored in leads.property_snapshot.sellerProfile using the existing atomic create_phase5_request RPC.
- Seller reports use the protected sold feed after a request. Same community (or verified same condo building), exact type and matching interior-size band are required. No freehold size fallback and no evidence older than 300 days. The owner's target and renovation spending never enter the valuation.
- Unknown size/community produces a useful review report without a fabricated range. Three qualified sold homes are required. Condition and upgrade evidence remain to be reviewed by the team.
- Seller email uses Market evidence / Improvements / Owner target, plus a target-position graphic and call/reply actions. Seller requests stay out of showing scheduling.

Seller verification: three synthetic seller scenarios cover capture, validation, target independence, same-building condo rules and missing-evidence handling. Three previously unused condo addresses were checked in the public seller UI (one per Toronto, Richmond Hill and Vaughan); see tests/seller-address-sample.json. No live test leads or test emails were sent. Larger condo size bands are retained exactly when supplied by the listing. Preview commits do not promote; include [release] in the final commit message after review.
