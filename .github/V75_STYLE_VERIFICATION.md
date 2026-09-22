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
