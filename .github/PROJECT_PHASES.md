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


## Seller off-market revision — 2026-09-15
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

- Published and verified: Worker version `01a877b8-24fd-4616-8b7c-caacc868f42f`, source SHA256 `90e854d35333f036f8a4fc5a33df185fbbd8302f68112b7cba59dbfa8d3b5eab`, release commit `4bcbcba8c02d804437869b8963b716c992767aea`, successful GitHub Actions run `34924857922`. Guarded promotion verified all 12 live assets, source, bindings and cron. Live seller page shows the revised copy and no upgrade section. Previous rollback version is `287a06e2-ef44-4fef-8ef7-7e24d752ba23`. No customer records, report jobs or emails were created by verification.


## Eight-address seller audit and presentation — 2026-09-15 (in progress)
- User requested two properties from each of four unavailable-listing lists. The fixed eight-address sample is tests/seller-requested-eight-addresses.json. Reuse these eight for any necessary before/after checks.
- Seller identity fixes exclude the subject across address formatting differences and deduplicate repeated sales/listings by exact home, retaining condo units and street directions. Regressions reproduced both previously false three-comparable estimates.
- Every attempted history case-variant search must complete before claiming a complete latest-history lookup. A capped query followed by a completed empty query now requires retry.
- Added an authenticated, read-only address option to /api/admin/seller-preview and a one-to-eight address checker in the existing admin UI. It creates no leads, report jobs, emails or persisted consents. The same admin credential remains required.
- Seller landing page and sellerReportEmail redesigned with cream/teal, address-first capture, optional expectations, prominent estimate/range and nearby evidence limitations, sold/active separation, and reply/call action. No upgrade section.
- Remote preview source commit 68f2279aadb5f4f9d158a4c9f981572a1e9688d8; verified preview d9d629c1-077f-4914-84ec-c3352e901045; source SHA f5db09c50a95da4c005b58af82c462f305de613ad55ca5ba6fea6c67adc9b302. Run 34926220199 passed 11 focused tests and all 12 asset checks. Follow-up copy/color alignment retains this worker source.
- Production remains 01a877b8-24fd-4616-8b7c-caacc868f42f; source 90e854d35333f036f8a4fc5a33df185fbbd8302f68112b7cba59dbfa8d3b5eab. Do not claim the eight live estimates or browser layout verification complete yet. Existing dashboard login needs secure re-entry after refreshing to new controls.

- Latest verified preview: `4126bf79-1b11-48ef-9f65-16ae75892bf4`, remote commit `7fa8dbf17d08f3e545a2540d644c55f632d75d74`, successful run `34971917515`; same Worker source SHA `f5db09c50a95da4c005b58af82c462f305de613ad55ca5ba6fea6c67adc9b302`. All 12 assets and 11 focused tests passed. Preview concurrency is isolated from skipped production workflows, which had cancelled the intermediate preview before any job started.
- Desktop screenshot of latest seller page verified; 18 Ferris Rd public address entry advances to the report form with an honest no-public-listing-match notice. This is NOT a completed protected valuation test. No lead/email submitted. Email mobile visual QA and all eight protected MLS estimates remain pending. The secure admin sign-in timed out and browser session was cleared; do not infer auth success.


## Seller audit follow-up — 2026-09-15
- Verified candidate 9039b6ee-62a2-4a2f-96fe-8502d8d7c87b (source 780f12bac807a8c148c48ab2e09cf5b77811247f59ea531bb0a3c38f359a87ee): 12 focused tests and 12 asset checks passed, run 34983506942.
- Ran the fixed eight requested addresses through the signed-in admin checker. Four condos and 18 Ferris returned complete report payloads; 204 Derrydown, 168 Ruggles and 178 Alpine returned generic request failures on retry. Their prices remain unverified.
- Five returned estimates were all Low confidence. The condos disclose capped market retrieval. Ferris expanded to 300 days and had a broad spread across adjacent size bands. This is preliminary evidence, not a list-price recommendation. Raw licensed MLS evidence is not committed or published as an asset.
- Complete street records recovered for the subject are now reused privately during the same request instead of being discarded and downloaded again in a smaller sample. Bulk street data is not included in report payloads.
- At least three qualified condo sales in the same verified building and current time window take priority over other buildings. Active competition prioritizes same building and bedroom match. Seller sold-comparison bedroom display now uses above-grade counts consistently with the subject.
- Final refinement: at least three freehold sales in the exact size band and current time window take priority over adjacent bands; the existing 25% area tolerance remains a sparse-evidence fallback. Synthetic regression and offline replay of the previously recovered Ferris comparison subset pass. This refinement has NOT had a fresh full protected MLS scan.
- Browser security explicitly blocked direct access to the failing seller diagnostic URL (ERR_BLOCKED_BY_CLIENT / URL policy). Do not retry through alternate URLs, browser surfaces, or indirect execution. A server tail returned no preview request observations and did not establish a backend cause. No auth token was extracted. Existing admin tab was kept signed in.
- Desktop seller form and generated email header/price card visually reviewed. Phone-width rendering and every email client have not been independently verified. Matching cream/teal presentation, short report capture, separate sales/current asks, and reply/call action are implemented.
- Final code checks: 13 focused tests. Audit checker now reports successful and failed counts separately and includes HTTP status on generic failures. audit-output is excluded from public assets. Temporary diagnostic workflows are removed. No leads, jobs, or emails were created by these checks.

- Published successfully: candidate `78fc6552-9f2f-4053-95db-ab83c0ff561b`, source SHA256 `871df70ace83b34fefbf43f7f0ddffb22f6f5a31b6740f12bd9de8dc3fa2b050`, release commit `31dde55df667841870fbf56997a9abfa9f23b49d`, successful run `34984712646`. All 13 focused tests and 12 live asset hashes passed; source, bindings and cron verified. Public browser confirmed the new seller page at `https://torontohousemarket.com/seller`. Rollback version: `01a877b8-24fd-4616-8b7c-caacc868f42f`.
- Remaining scope: fresh protected verification for the three failed houses, a fresh full Ferris scan after exact-size prioritization, and independent phone-width/email-client visual QA. Do not claim these passed. User did not receive test emails during this audit.


## Address and form feedback refinement — 2026-09-15
- The two latest seller reports both used 175 Bamburgh Circ, unit 306. Read-only saved diagnostics showed complete HTTP 200 street queries with 322 records but no exact matches. The parser lacked Circ as a Circle alias and absorbed the suffix/unit into the street name; this stopped subject recovery before comparable selection. The form also allowed a missing city. No customer records were changed.
- Normalize common unit-first and street-first condo entries; preserve city and exact unit. Reject concatenated suffix/unit inputs, missing street details, and missing city in new public form searches. Seller condo capture requires a unit. Browser errors are visibly red and phone format validation rejects short or obvious fake numbers, without claiming phone ownership verification.
- Optional minimum/maximum expectations are visible. Consent boxes align with the first text line. Restrained neutral field focus replaces stacked green outlines. Names are removed from the seller conversation section; brokerage/footer identity is retained.
- Buyer email keeps its sections, pricing rules and position infographic with the seller cream/teal palette and Georgia price typography. Missing seller estimates use simple reasons with call/reply actions. Showing messaging uses a within-24-hours target subject to availability. Header actions distinguish Home value and Get my AI report.
- New synthetic regression fixtures cover the actual address parsing failure, malformed inputs before MLS access, phone validation and email content. No live leads or emails are created. Previous protected-diagnostic URL policy restriction remains in force; this release does not claim a fresh protected valuation scan.
- Preview f99e2e59-46df-4b8d-ae3a-00df642c7621 passed all 33 focused tests and 13 asset checks. Public Bamburgh input now advances with canonical unit 306 and city Toronto; this is address-format verification, not a fresh protected estimate. Desktop form QA confirmed visible min/max, aligned checks and red fake-phone feedback. Phone-width buyer/no-match email QA passed. Mobile header QA found and removed a legacy link margin that clipped the primary action.
- Mobile QA also reproduced an MLS timeout. Seller entry now verifies syntax/city/unit through a fast public format-only check before requesting optional listing details. A later timeout can continue to the form with a clear notice; an invalid format still cannot continue. Stale lookup results cannot replace a newly edited address. Format preflight never queries MLS or writes records.
- Final preview 01af3042-e708-4e5d-a68b-a0c78dcac46d, source SHA256 8bced649a3f18405e0709079481fc02da0ee6a2e2ad1b923852a6050224782a5, commit 0205ebdd8a961f95816750ce827fa26f96dc96a9, successful run 34992684033. All 34 focused tests and 13 asset checks passed. The phone-width seller form advanced with canonical Bamburgh unit/city, visible expectations and the corrected capture controls. Buyer and seller email price cards and the no-match call/reply email were visually reviewed at phone and desktop widths. Browser email rendering is not verification in every email client. Prepared for guarded promotion; no live leads or emails created.
- Published successfully: Worker version 01af3042-e708-4e5d-a68b-a0c78dcac46d, source SHA256 8bced649a3f18405e0709079481fc02da0ee6a2e2ad1b923852a6050224782a5, release commit d226e4fcb3609a8daee6f69084009936a2b00b94, successful run 34993016985. All 34 focused tests passed; all 13 live assets, source, bindings and cron verified. Production browser confirmed the updated seller page at https://torontohousemarket.com/seller. Rollback version is 78fc6552-9f2f-4053-95db-ab83c0ff561b. Saved reports were diagnosed read-only; neither prior report was regenerated or emailed. A fresh protected Unit 306 valuation remains unverified, as do the earlier outstanding protected scans.
