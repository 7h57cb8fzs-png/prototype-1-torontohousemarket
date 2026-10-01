# Admin expired / terminated search — 2026-10-01

Published from phase-6 commit 63d010282eecbb2cca70ad328867b52412669ff5. Successful release run: 36907762504.
Worker version: ba7acead-8f7a-4e97-89e7-22fbf22e1758. Rollback: ba600012-6f10-49d9-8c13-475194e963af.

Admin → Expired / terminated → Search & verify. Existing admin credential only. Toronto and York residential sale listings, explicit Owner occupancy, expiry/termination September 1, 2026 onward. All-status, exact-property/unit history checks exclude subsequent listings and withhold incomplete/ambiguous cases. Occupancy remains the MLS declaration, not current physical verification. Searches follow feed cursors until exhausted; no full inventory was generated during deployment. CSV exports contain qualified results only. No lead, report, email, database or scheduler changes.

Verification: 21 focused tests passed. Live isolated integration verified candidate search, a second result page and a conclusive property history check without logging listing records or credentials. Preview and production verified 31 static assets and unauthorized admin requests returning 401. User-facing page left at https://torontohousemarket.com/admin awaiting the user's existing key.

Production now has three modules: entry.mjs, existing.mjs, admin-prospects-api.mjs. existing.mjs is the prior production bundle, byte-for-byte SHA256 b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74. Admin module SHA256 a2b18bef86228ea3902e43b22d658971e0d48b354631cc5be982758b7d8362f8. Future deployments must account for these modules; do not assume a single production module or rerun old pinned release workflows. The repository entry worker-v22.js also delegates only the new /api/admin/prospects/ prefix.

AMPRE requires percent-encoded spaces rather than plus signs. Its next links use webapi-green-gcp.ampre.ca; the new module validates that observed provider hostname/path and rewrites to canonical https://query.ampre.ca, so credentials are never sent to an alternate host. The confirmed fields include TerminatedDate, ExpirationDate, OccupantType and BackOnMarketEntryTimestamp. Residential Condo & Other is a confirmed property-type value. Credentials remain in existing Cloudflare secret bindings.


## Pre-scan filters — same-day follow-up

Published from phase-6 commit 50821c67c55c6b239190e2d1acf663cda3565f63; successful guarded release run 36915703438. Current Worker version: 058d67d7-242f-41ff-ad90-e7ab1986f90f. Rollback: ba7acead-8f7a-4e97-89e7-22fbf22e1758. Admin module SHA256: efba55e8f8613f4d04e0b576a8955b529664ee40f730e81be5644c51b2f7379e. The public server hash above and three-module layout are unchanged.

The admin expired/terminated tool now has optional Municipality, Community, Minimum asking price and Maximum asking price controls before Search & verify. Defaults retain the full Toronto + York scan. Community suggestions load the licensed CityRegion lookup vocabulary only, without scanning property listings; they are not a municipality-specific catalogue. Enter the exact MLS community name. Price refers to the listing's last asking price, with inclusive bounds. Selections are sent to the provider, reapplied to returned rows and signed into every continuation cursor. Invalid price ranges do not start a search. Existing region/status/text/unverified filters and CSV export remain. Community is displayed and included in CSV.

Relisting history deliberately remains unrestricted by scan price/community to catch a later listing with changed details. Owner occupancy, September 1 onward dates, exact unit identity and fail-closed incomplete-history handling remain unchanged.

Verification: 24 focused tests passed, including UI validation/request parameters, signed paging, lookup-only suggestions and relisting outside the selected price/community. Isolated live integration run 36915498289 verified suggestions, filtered inclusion of an existing eligible record, all returned candidates matching the selection, normal paging and a conclusive history check; no licensed records or credentials were logged. Release verified 31 assets, admin authorization and unchanged public server bundle before and after promotion. No full inventory scan, customer records, reports, emails or database changes. Screenshot QA was unavailable because the local browser download failed; UI interactions were checked with JSDOM.

The release/inspection scripts are pinned to the previous version and should not be blindly rerun after this deployment. Reconcile the current production version, all three modules, bindings, cron and asset baseline before the next change.
