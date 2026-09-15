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

## Seller revision — 2026-09-14
Superseded valuation policy: Seller Evidence v1 now runs independently of buildComparableContext (buyer model). See the latest section below.
- Address-first single form, optional collapsed home details, simple upgrade chips for work within ten years, optional minimum/maximum expectations. No triangle.
- Report subject recovery checks up to three exact-address/unit records from the last ten years, including expired/cancelled listings, and records field provenance. Ambiguous cities are not silently selected. Missing owner facts may use recovered specifications; old asking prices never enter valuation.
- Email has two labelled bands on one scale: sold-based AI value and owner expectations. Owner goals cannot change the valuation.
- Upgrade contribution is a separate AI-assisted judgment estimate, not measured ROI. Category ceiling assumptions, overlap reduction and 6% combined cap are explicit; zero is possible. Never added automatically to the sold-derived value. No dollar guess without sufficient sold evidence. Condo shared roof/exterior/basement work needs review.
- Version 2 profiles preserve legacy target-price support and use the existing JSON capture without a schema migration. Admin/team summaries show minimum–maximum.
- Verification remains three synthetic scenarios and at most the three addresses already in tests/seller-address-sample.json. No live leads or emails created.

## Independent Seller Evidence v1
- Historical subject lookup uses street-scoped, recent-tail paginated records with select fallback, rather than number-only equality and a fixed first page. Exact address/unit/city checks remain. HTTP failure is distinguished from no matching home.
- Seller valuation has its own ranking/calculation. Distinct sold homes only; same subtype and community or verified condo building. Freehold interior-size midpoint tolerance 25%; condo exact range retained. Bedroom count and lot frontage affect similarity. Owner goals and upgrade guesses do not influence price.
- Up to eight ranked homes; weighted median and weighted 20th/80th percentile spread with explicit heuristic uncertainty floors. This is not a calibrated statistical confidence interval or an appraisal. No arbitrary buyer ±10% price cluster.
- Normally sales within 365 days. Sales up to 1095 days require a local repeat-sale trend from at least five distinct homes, recent anchors, compatible size/type, available remarks without known renovations, and bounded rate/dispersion. Unreported renovations remain a limitation. Both declining and flat trends are supported.
- Insufficient evidence produces a short next-step email, not an empty AI valuation with repeated upgrade placeholders. Upgrades remain owner-reported judgment ranges, separate from sold value.
- Admin seller cards have a read-only fresh evidence check using existing admin authorization; no new credential, auth bypass, saved lead/report mutation or email send.
- Validation: three synthetic scenarios only. Live protected MLS requests remain unverified because supplied credentials returned 401 in this environment despite the user's dashboard working. Do not claim that 33 Russett or another live seller now has a verified estimate.
- Model design informed by IAAO sales-comparison principles (https://www.iaao.org/wp-content/uploads/StandardOnMassAppraisal.pdf); heuristic coefficients are not claimed to be IAAO-approved or Toronto-calibrated.


## Seller off-market revision — 2026-09-15 (preview)
- Baseline is the restored Phase 6 deployment `287a06e2-ef44-4fef-8ef7-7e24d752ba23`; SHA256 `7b2fd318de7863416865c7f95a75829d0006a5189f80c22522e51e1ec4afd119`. Do not deploy main/worker-v13.
- Remove upgrades from seller form and seller email. Keep the existing page design, public address lookup, buyer assets and buyer report calculations. No database/schema migration.
- Recover exact street number/name/type/direction, city and unit from protected VOW history. Query unavailable records, then all statuses to catch relisting. Follow provider cursors, disclose incomplete retrieval, and sort the recovered records by listing entry/contract date rather than sync edits. Keep provenance when an older record fills missing specifications.
- Seller Evidence v2: exact subtype and community, verified same-building condo exception, same condo size band. Freehold area tolerance 25%; missing-area fallback requires recorded bedrooms and comparable lot frontage, disclosed with lower confidence. Prefer area-known comparables when at least three qualify.
- Prefer qualified sold homes within 100 days; expand to 300 days and then 365 days only when necessary, with low confidence and additional uncertainty at 365 days. Three distinct sold homes minimum. No historical asking price, owner target, upgrade guess or assumed appreciation enters valuation. Recent active asks are separately dated and labelled as competition.
- Seller email shows estimated midpoint, range, current status, history, sold evidence, active competition, owner expectations and contact actions. Missing history is not described as confirmed off-market; provider errors/incomplete scans are not described as zero market evidence.
- Eight focused tests passed (three synthetic seller scenarios plus five existing buyer email checks). One broader Phase 5 test expects the old literal brand `Golestan Homes`; it fails identically on baseline and candidate and was not altered.
- Protected MLS verification requires the existing admin login. No live leads, report jobs or emails have been created during this revision. Preview workflow `.github/workflows/seller-evidence-preview.yml` preserves bindings and verifies all 12 application assets without promotion.

- Live provider checks: the VOW binding returns cancelled/expired/closed records. AMPRE rejects sort/equality combinations; multiword contains scopes returned zero, while single street/community tokens and postal prefixes work. Scans are bounded and include opposite ends of larger collections; no assumption that offset order is a sale date.
- Exact history remains absent for 55 Calvington Drive (64 street records) and 64 Ampezzo Ave (7 street records), including uppercase variants. This is an unresolved feed coverage issue, not proof the houses lack MLS history. Do not claim either address has a verified numeric estimate.
- 112 Andrea Lane recovered two exact listing records, recent matching sold records and two active competitors. Evidence initially remained below three within 300 days; 365-day sparse fallback is explicitly disclosed and retains fresh-sale weighting.

- Verified preview `309013ea-742e-4e77-ba09-cb12565ea9f7`: 112 Andrea Lane yields midpoint $945,000, range $800,000–$1,090,000, Low confidence. Selected sold homes: 275 Aberdeen (2026-07-10, $945,000), 10 Ashcroft (2026-06-10, $822,500), 51 Andrea (2025-09-22, $1,160,000). Two active competitors: 237 Terra ($1,049,000) and 130 Andrea ($939,999). This is a read-only estimate check, not a sent email. The final email discloses incomplete market retrieval and the 365-day fallback.

- Release prepared from the verified seller preview. The guarded promotion verifies the restored production source, candidate source, bindings, cron and all 12 application assets, with automatic rollback if live assets fail. The buyer page and buyer valuation functions are unchanged. The missing exact history for 55 Calvington and 64 Ampezzo remains open.
