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
