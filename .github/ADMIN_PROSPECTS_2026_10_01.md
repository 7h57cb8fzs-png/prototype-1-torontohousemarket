# Admin expired / terminated search — 2026-10-01

Published from phase-6 commit 63d010282eecbb2cca70ad328867b52412669ff5. Successful release run: 36907762504.
Worker version: ba7acead-8f7a-4e97-89e7-22fbf22e1758. Rollback: ba600012-6f10-49d9-8c13-475194e963af.

Admin → Expired / terminated → Search & verify. Existing admin credential only. Toronto and York residential sale listings, explicit Owner occupancy, expiry/termination September 1, 2026 onward. All-status, exact-property/unit history checks exclude subsequent listings and withhold incomplete/ambiguous cases. Occupancy remains the MLS declaration, not current physical verification. Searches follow feed cursors until exhausted; no full inventory was generated during deployment. CSV exports contain qualified results only. No lead, report, email, database or scheduler changes.

Verification: 21 focused tests passed. Live isolated integration verified candidate search, a second result page and a conclusive property history check without logging listing records or credentials. Preview and production verified 31 static assets and unauthorized admin requests returning 401. User-facing page left at https://torontohousemarket.com/admin awaiting the user's existing key.

Production now has three modules: entry.mjs, existing.mjs, admin-prospects-api.mjs. existing.mjs is the prior production bundle, byte-for-byte SHA256 b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74. Admin module SHA256 a2b18bef86228ea3902e43b22d658971e0d48b354631cc5be982758b7d8362f8. Future deployments must account for these modules; do not assume a single production module or rerun old pinned release workflows. The repository entry worker-v22.js also delegates only the new /api/admin/prospects/ prefix.

AMPRE requires percent-encoded spaces rather than plus signs. Its next links use webapi-green-gcp.ampre.ca; the new module validates that observed provider hostname/path and rewrites to canonical https://query.ampre.ca, so credentials are never sent to an alternate host. The confirmed fields include TerminatedDate, ExpirationDate, OccupantType and BackOnMarketEntryTimestamp. Residential Condo & Other is a confirmed property-type value. Credentials remain in existing Cloudflare secret bindings.
