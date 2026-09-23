# THM 7.5 — shared Home Finder presentation

Requested on September 22, 2026: extend the Home Finder style to the seller page, public buttons, property addresses and prices; remove cashback messaging from the website and emails. Keep the existing workflows and accepted mobile/navigation fixes.

## Baseline preserved

- Accepted 7.5 source: `5b781ed48c377240e3112ab8b6e74ffceed6514c`.
- Previous production Worker: `88a4e0c0-2b48-4bb9-956c-50e102a1700f`.
- Previous Worker module hash: `b3e54bdabc655d551798a1ff27cc09ec42472f627bf03f0be5b0cc26c50424cd`.
- Closed 7.4 remains a separate checkpoint.

## Changes

- Shared `interface.css` for buyer, seller, showing and address-information pages: Georgia display type, forest-green primary controls, sage secondary controls, subtle terracotta accents.
- Consistent public action sizing and typography; existing responsive header widths and mobile report controls retained.
- Seller landing page, report form and footer matched to the Home Finder; property address and price styles aligned across listing previews, comparison cards and report emails.
- Cashback card, related CSS and HTML/plain-text buyer-email copy removed.
- Worker edits are restricted to the buyer/seller email renderers and presentation styles in `report-graphics.js`. Pricing, retrieval, report generation, queues and delivery logic are unchanged.
- Historic migrations, existing customer records and previously delivered email copies are untouched.

## Verification

- Scope gate compares application code and all existing form controls/element IDs against the accepted 7.5 commit. Search, Back/Forward handling, seller logic and form fields are unchanged.
- Fifteen focused synthetic email/form/comparable checks pass. Cashback is absent from active/inactive buyer emails and seller estimate/review emails; address, amounts, contact and showing actions remain.
- Five existing WebKit navigation checks pass: Back/Forward between previews, reload, duplicate/failed searches, stale request handling, Home Finder selection, and report-linked return behavior.
- WebKit layout checks pass at 320, 375, 390, 430, 768 and 1280 pixels for buyer snapshots, buyer request forms, seller landing and seller forms. Primary buttons use the shared styling and pages fit the viewport.
- Buyer, seller and missing-estimate email previews fit 375px and 1280px browser widths. This is browser rendering, not a claim of testing every email client.
- Preview/promotion checks compare fourteen public assets, reuse the existing four-listing sample and one alphanumeric-unit validation, and preserve bindings/settings/cron. No live leads or emails are created by verification.
- Two older tests fail identically on the accepted baseline and this candidate: `zero comparables suppress stale scores and explain the recorded reason`, and `a completed empty case variant cannot hide incomplete seller MLS history`. These pre-existing failures were reproduced separately and are outside this presentation change.

The style workflow records the exact preview and publication identities in its logs. Promotion requires the reviewed candidate source hash and unchanged prior production identity; it rolls back on failed live verification.

Verified preview: `5f75b82b-fa52-4dce-8367-aaf0c7e64c0b`, module hash `9b68af8ab9aec721b058de5c7ab9dd83a8302684fa0de2539335238cdf5a65d1`; successful preview workflow `35770279373` / job `106889942880`.

## Address and price font refinement — September 22, 2026

At the user’s request, property addresses and prices now use the site’s readable system sans-serif stack with medium weight. Sizes, colours, other headings/buttons and workflows are unchanged; email templates are unchanged by this refinement. Preview `95225d55-916f-4df7-a72d-19430ccfe1c1`, run `35771936209`, retains the identical Worker module hash `9b68af8ab9aec721b058de5c7ab9dd83a8302684fa0de2539335238cdf5a65d1`. Existing responsive and navigation gates passed.


## Form and email refinement — September 22, 2026

User requested removal of the red inner search outlines; matching report and confirmation emails; Toronto House Market sender identity; compact optional renovation and min/max price fields below contact details; aligned seller consent checkboxes.

- Buyer address, seller address and Home Finder fields now use a subtle green outer focus treatment without a duplicate input outline. Keyboard focus remains visible.
- Condition and price expectations sit in a collapsed Optional details section after name/email/mobile/timing. Input IDs, constraints, request payload shape and default unknown/null semantics are preserved. Consent inputs align with the first text line.
- Buyer/seller reports, shared price graphics and confirmation/verification/showing emails use the site palette and serif section headings/buttons, with readable sans-serif addresses and prices. Buyer HTML now declares UTF-8 to preserve punctuation across clients.
- New delivery payloads always use the display name Toronto House Market, preserving the configured verified sending mailbox, and reply to torontohousemarket@gmail.com. Existing frozen retry payloads stay unchanged to preserve idempotency; previously sent email cannot be changed.
- Scope gate now compares against approved source 0e13bc456b6b47eb645d5c123483253b64122453. It explicitly permits these email renderers/sender metadata and two seller helper messages. Valuation, lookup, navigation, lead capture, queue ownership/retries, settings and consent requirements remain unchanged.
- Focused email, sender, retry, validation and seller scenario checks pass. Six WebKit widths pass with no overflow, zero inner search outlines, aligned checkboxes, and successful mocked submissions leaving renovation/min/max blank. Four email previews pass, including confirmation. Five accepted navigation scenarios pass.
- Final preview source 81f0d950944fdacc3cbe2df8edf5be513e2f551b. Workflow 35779963208 / job 106922657829 succeeded. Preview e9b2567e-e675-4aa1-bfd9-ec81657b9504, module hash 276511b92eda0b087bdc6a242f962980c965e2ee193ef1c648ff685d3131910a.
- Visual review includes all report email variants and confirmation on mobile, plus seller form at desktop and a live Wheelwright address preview. No real leads or test emails were sent.
- Promotion pins the reviewed preview and checks fourteen assets, four existing listings and one alphanumeric unit validation; deployment retains rollback 95225d55-916f-4df7-a72d-19430ccfe1c1.

## Email contact and school visibility — September 22, 2026

- Email footers and seller report prompts now display Contact the team instead of the telephone number. HTML contact links still call the team; plain-text reports invite a direct reply.
- Removed the Offer Timing card from the main buyer brief. Schools and ratings are visible immediately with their existing data loading, boundary note and official links, without a disclosure control.
- Presentation gate compares against published source 9d15a7fc575d1fef92c8afdadcb7cc9d3736db22 and permits only email renderer edits and removal of the three offer-display lines in app.js. Report processing, email delivery/retries, forms and school data restrictions are unchanged.
- All 29 focused checks pass locally. The existing six-width layout gate additionally verifies that school information and links are visible without expansion and that the removed offer card is absent.
- Read-only timing review of the reported delayed seller request: confirmation was accepted by the provider within one second; generation completed on attempt two after about 5m18s, and the report email was accepted about one second later. The successful attempt took 46s, including 37s for MLS evidence and 8s for analysis. The first attempt's detailed execution record was overwritten by the successful attempt, so its specific interruption cannot be established from the saved job. No customer data or live test messages are included in this repository.
- Historical Cloudflare log retrieval returned HTTP 403 with the configured token. The timing diagnosis is based on the saved request/job timestamps and Resend acceptance/delivery records; the first interruption's cause remains unverified.
- Preview run 35783814646 passed all focused, navigation and six-width layout checks. Its live-data gate stopped on one studio comparison request; the same listing then compared successfully on production. Re-running the unchanged application candidate with the full gate, without relaxing its assertions.
- Verified preview source ff1bef6848d9145c04d64f3f82a6b9c27ac9832a; workflow 35784230506 / job 106936976658 passed all checks. Candidate f0f7c1af-2786-45d8-a3d8-85989cc262a2, Worker module hash d4b29f2403a8ae76d09d36f2fdeaf84f447c4389254d82f39053e9c5cbad6dfc. Promotion pins this candidate and retains rollback e9b2567e-e675-4aa1-bfd9-ec81657b9504.


## Jules listing lookup and home reset — September 22, 2026

- The user confirmed the Jules Avenue MLS number is N13816334. Live lookup reproduces the missing record by both MLS and address; the separately supplied N13815978 loads as Benson Avenue.
- Read-only upstream checks using the existing Worker bindings found N13816334 absent from IDX (direct 404 and exact collection query 200 with zero rows), but present in VOW. N13815978 is present in both feeds. The diagnostic runs in an authenticated, unpublished preview and verifies that production and cron remain unchanged. No private listing data, leads, reports or emails are created or published by it.
- The buyer THM logo now links to /, starting a new page load and discarding the listing URL, property/form state and unsent chat input. Seller/showing logos already use that destination.
- Missing feed records now say LISTING STATUS UNCONFIRMED in the action card. The previous fixed NOT FOR SALE ON MLS label incorrectly suggested an absence from the feed proved the home was off market. Known off-market and rental records retain their respective labels.
- Scope gate is pinned to the prior published commit 7d2a3318d84058977ec448507b288241f5f6a85c and permits only the home link and status-label changes. Lookup, feed access, report valuation, email delivery and browser Back/Forward logic remain unchanged.
- Existing WebKit navigation checks now include a fresh-document logo reset at 390px and 1280px, unfinished contact/showing/chat state, and missing-feed wording. The four-listing live check includes the supplied Benson listing; together with Jules, no more than five distinct properties are checked.
- Additional upstream visibility inspection confirmed the missing IDX record has InternetAddressDisplayYN and InternetEntireListingDisplayYN enabled in VOW. Those flags alone do not establish IDX participation or explain the feed gap. No VOW-to-public fallback was introduced.
- Preview source 26e18c4ee1a1bd7da5d30c95b6b686d535442d35 passed all checks: workflow 35786345574 / job 106943968290. Candidate 7ea5e19c-de59-47dc-a8cf-3a64552f0dda retains the prior Worker module hash d4b29f2403a8ae76d09d36f2fdeaf84f447c4389254d82f39053e9c5cbad6dfc; only public assets change. Promotion retains rollback f0f7c1af-2786-45d8-a3d8-85989cc262a2.

## Professional footer — September 23, 2026

- Shared buyer, seller and showing footer with brand tagline, service areas, buyer/seller/contact links, existing privacy/terms link, copyright and website Version 7.5.
- Agent names use regular-weight sans-serif at 13px desktop / 12px mobile. Brokerage and professional designations remain visible in a quiet credentials block.
- Responsive lower bar stacks on small screens; keyboard focus and mobile showing-bar clearance are retained. Website release label is 7.5; backend version metadata is unchanged.
- Scope gate pins c9a84f2fa4310f4052c80129dbda0832154bf74f and verifies all application/server logic and form controls remain unchanged. Existing six-width checks capture the footer and verify regular-weight names.
- Preview 88a7ba4c-b521-4d9f-87bc-c845a5f705af passed workflow 35807437534 / job 107011291394. All six responsive widths, navigation/reset checks, focused regressions and live asset/listing checks passed. Mobile 375px and desktop 1280px footer screenshots visually reviewed. Worker module hash remains unchanged.


## Targeted St Clair address correction — 2026-09-23

User authorized small address changes while preserving the current system. Saint Clair, St Clair, St. Clair and St.Clair canonicalize together; historical subject queries use Clair with strict exact address/unit/city/direction checks. Other street names and comparable selection are unchanged. Existing Google unit preservation is covered by regression checks; requireUnit cannot erase an existing unit. Missing-unit seller preflight uses a bounded public IDX check and prompts only for an unambiguous exact condo building. Missing unit history has distinct email copy.

Validation: 26 focused tests plus 7 seller/email scenarios passed. Preview workflow 35811446138 passed navigation and six viewport checks, 14 asset checks and existing listing checks. Protected read-only diagnostics confirmed missing-unit prompt for 111 St Clair. No customer submissions or emails were sent.

Remaining data limitation: the two recovered unit 1227 history records omit street direction; the same building/postal records contain conflicting W/S directions. Strict direction matching remains unchanged. Do not claim this unit now produces comparable evidence. A broader direction-inference change was considered locally and discarded because evidence conflicts.

Reviewed candidate e859eb93-c9c3-42f8-9e28-977ebc61ba39; module hash 05feaf71af7a364d419b07bc66fa82577dd735c84c74ed16d5e31f2729bf2b37.


## Space-separated unit-first input — 2026-09-23

Reported: 761 Bay St 2809 and 2809-761 Bay St worked, but 2809 761 Bay St was misread as street number 2809. Added numeric unit-first recognition to the shared browser address control and server normalizer. All three resolve to 761 Bay Street Unit 2809. Numbered streets and ordinary addresses retain their prior parse. No form, comparable-selection, matching strictness, email, or queue changes. Scope gate now pins accepted baseline 061c6cad74858c795fd3afbf7b5312ec141e4c76 and allows only the two parsing locations plus asset cache-version updates.

27 focused local regression tests passed. Release preflight checks all three reported formats without creating reports or sending emails.
